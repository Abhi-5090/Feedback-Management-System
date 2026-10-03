import { Phase } from '../models/Phase.js';
import { Feedback } from '../models/Feedback.js';
import { badRequest, conflict } from '../utils/ApiError.js';
import { log } from '../config/logger.js';

/**
 * Phases — the rules that make a collection exercise a first-class thing.
 *
 * Three invariants are enforced here rather than hoped for, because each one
 * is what makes a different guarantee possible:
 *
 *   1. NO TWO PHASES OVERLAP. Every instant belongs to at most one phase, so
 *      "which phase is this response in?" is computed, never chosen, and can
 *      never be ambiguous.
 *   2. A CLOSED PHASE IS FROZEN. Its membership, window and code can never
 *      change again — reports built on it have already been circulated, and a
 *      number that moves after you have acted on it is worse than no number.
 *   3. AT MOST ONE PHASE IS OPEN. Unlocking a batch then needs no extra
 *      decision from the admin, which is the decision they would eventually
 *      get wrong at 9am with a class waiting.
 */

/** A whole calendar month as a half-open range, in the server's timezone. */
export function monthRange(year, monthIndex) {
  return {
    startsAt: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    endsAt: new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0)),
  };
}

/**
 * Any phase whose window overlaps [startsAt, endsAt), excluding one id.
 *
 * Half-open comparison: two ranges overlap when each starts before the other
 * ends. Using <= on both sides would make a phase ending 1 Nov 00:00 "overlap"
 * one starting at exactly 1 Nov 00:00, which is the off-by-one that makes
 * back-to-back months impossible to create.
 */
export async function findOverlapping({ startsAt, endsAt, exceptId } = {}) {
  const q = { startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt } };
  if (exceptId) q._id = { $ne: exceptId };
  return Phase.find(q).sort({ startsAt: 1 }).lean();
}

/** Reject a window that is empty, backwards, or collides with another phase. */
export async function assertWindowIsFree({ startsAt, endsAt, exceptId } = {}) {
  if (!(startsAt instanceof Date) || !(endsAt instanceof Date) || Number.isNaN(+startsAt) || Number.isNaN(+endsAt)) {
    throw badRequest('A phase needs a valid start and end date', 'BAD_WINDOW');
  }
  if (endsAt <= startsAt) {
    throw badRequest('A phase must end after it starts', 'BAD_WINDOW');
  }
  const clashes = await findOverlapping({ startsAt, endsAt, exceptId });
  if (clashes.length) {
    const names = clashes.map((p) => `${p.name} (${fmt(p.startsAt)} – ${fmt(p.endsAt)})`).join(', ');
    throw conflict(
      `That window overlaps ${clashes.length === 1 ? 'an existing phase' : 'existing phases'}: ${names}. ` +
        'Phases cannot overlap, because a response would then belong to two of them.',
      'PHASE_OVERLAP'
    );
  }
}

const fmt = (d) => new Date(d).toISOString().slice(0, 10);

/** The phase a given instant falls into, or null. */
export async function phaseAt(when = new Date()) {
  return Phase.findOne({ startsAt: { $lte: when }, endsAt: { $gt: when } }).lean();
}

/** The phase currently collecting: open AND containing now. */
export async function collectingPhase(at = new Date()) {
  return Phase.findOne({ status: 'open', startsAt: { $lte: at }, endsAt: { $gt: at } }).lean();
}

/**
 * Stamp a submission with the phase it falls into.
 *
 * Returns null when no phase covers this instant — a legitimate state, not an
 * error: an institution may simply not have declared a phase yet, and refusing
 * the student's submission over an admin's bookkeeping would be the wrong
 * trade every time. The response is collected and shows as Unassigned.
 *
 * A CLOSED phase never claims new submissions. If a straggler arrives after
 * the exercise was closed off, it stays unassigned rather than reopening a
 * frozen number.
 */
export async function phaseForSubmission(at = new Date()) {
  const p = await Phase.findOne({
    status: { $in: ['open', 'draft'] },
    startsAt: { $lte: at },
    endsAt: { $gt: at },
  })
    .select('_id')
    .lean();
  return p?._id || null;
}

/**
 * Re-stamp every response that falls inside a phase's window.
 *
 * Run when a phase is created or its window edited, which is how a phase can
 * be declared RETROACTIVELY — "September was Phase 1" — without a separate
 * migration each time.
 *
 * Responses already belonging to a CLOSED phase are never touched. That is the
 * freeze rule doing its job: an edit to one phase must not be able to reach
 * into another that has already been reported on.
 *
 * @returns {{ claimed: number, releasedFromThis: number }}
 */
export async function resyncPhaseMembership(phase) {
  if (phase.status === 'closed') {
    return { claimed: 0, releasedFromThis: 0, skipped: 'closed' };
  }

  const closedIds = (await Phase.find({ status: 'closed' }).select('_id').lean()).map((p) => p._id);

  // Claim everything in the window that is not spoken for by a closed phase.
  const claim = await Feedback.updateMany(
    {
      createdAt: { $gte: phase.startsAt, $lt: phase.endsAt },
      phase: { $nin: closedIds },
      $or: [{ phase: null }, { phase: { $ne: phase._id } }],
    },
    { $set: { phase: phase._id } }
  );

  /* And release anything this phase holds that its window no longer covers —
     the case where an admin SHRINKS a window. Without this the phase keeps
     claiming responses outside its own dates, which is the quiet kind of wrong
     that only shows up when two reports disagree. */
  const release = await Feedback.updateMany(
    {
      phase: phase._id,
      $or: [{ createdAt: { $lt: phase.startsAt } }, { createdAt: { $gte: phase.endsAt } }],
    },
    { $set: { phase: null } }
  );

  log().info(
    { phase: String(phase._id), code: phase.code, claimed: claim.modifiedCount, released: release.modifiedCount },
    'phase membership resynced'
  );
  return { claimed: claim.modifiedCount, releasedFromThis: release.modifiedCount };
}

/** Counts for one phase, for the list and the detail header. */
export async function phaseStats(phaseId) {
  const [agg] = await Feedback.aggregate([
    { $match: { phase: phaseId } },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: null,
        starSum: { $sum: '$ratings.stars' },
        starCount: { $sum: 1 },
        ids: { $addToSet: '$_id' },
        batches: { $addToSet: '$batch' },
        first: { $min: '$createdAt' },
        last: { $max: '$createdAt' },
      },
    },
  ]);
  if (!agg) return { responses: 0, batches: 0, average: null, firstAt: null, lastAt: null };
  return {
    responses: agg.ids.length,
    batches: agg.batches.length,
    average: agg.starCount ? Math.round((agg.starSum / agg.starCount) * 100) / 100 : null,
    firstAt: agg.first,
    lastAt: agg.last,
  };
}

/** How much feedback belongs to no phase at all. Surfaced, never hidden. */
export async function unassignedStats() {
  const [agg] = await Feedback.aggregate([
    { $match: { phase: null } },
    { $group: { _id: null, n: { $sum: 1 }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
  ]);
  return agg ? { responses: agg.n, firstAt: agg.first, lastAt: agg.last } : { responses: 0, firstAt: null, lastAt: null };
}
