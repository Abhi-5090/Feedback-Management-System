import { Feedback } from '../models/Feedback.js';
import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { User } from '../models/User.js';
import { log } from '../config/logger.js';

/**
 * Roster drift — when a batch's CURRENT mentor team disagrees with the team
 * stamped on feedback already collected for it.
 *
 * WHY THIS HAPPENS, AND WHY IT IS NOT A BUG. Every Feedback document carries a
 * copy of the rosters as they were at submit time, deliberately: a later
 * staffing change must not rewrite who taught a session that has already been
 * rated. Mentor scoping queries that stamped copy, which is what makes "you
 * see your own sessions" mean "the sessions you actually taught".
 *
 * The consequence is invisible and surprising. An admin fixes a batch's roster;
 * the mentor they just added opens their account and finds the session listed
 * with ZERO responses, while the admin sees 73. Nothing is broken and nothing
 * explains it. That is the real defect — not the scoping, the silence.
 *
 * So drift is detected, named, and either explained or repaired explicitly.
 * It is never repaired automatically: re-stamping moves a performance record
 * from one mentor to another, and doing that on a guess is worse than leaving
 * it visible.
 */

const key = (ids) => [...new Set((ids || []).map(String))].sort().join(',');

/**
 * Every (batch, class) whose stamped roster differs from the batch's current
 * one, with the counts and names needed to explain it.
 *
 * @param {object} filter  optional { batchId } to narrow to one batch
 */
export async function findRosterDrift({ batchId } = {}) {
  const batchFilter = { archivedAt: null };
  if (batchId) batchFilter._id = batchId;

  const [batches, classes, users] = await Promise.all([
    Batch.find(batchFilter).select('name classes yearGroup').lean(),
    Class.find().select('name').lean(),
    User.find({ role: 'trainer' }).select('name shortName').lean(),
  ]);
  const className = new Map(classes.map((c) => [String(c._id), c.name]));
  const label = new Map(users.map((u) => [String(u._id), u.shortName || u.name]));
  const names = (ids) => (ids || []).map((i) => label.get(String(i)) || 'Unknown');

  const drift = [];
  for (const b of batches) {
    for (const entry of b.classes || []) {
      const nowMain = key(entry.mainTrainers);
      const nowSupport = key(entry.supportTrainers);

      /* Grouped by the stamped pair, so a session collected across two
         different staffings reports each one separately rather than
         collapsing them into a single misleading row. */
      const groups = await Feedback.aggregate([
        { $match: { batch: b._id, class: entry.class } },
        {
          $group: {
            _id: { m: '$mainTrainers', s: '$supportTrainers' },
            responses: { $sum: 1 },
            first: { $min: '$createdAt' },
            last: { $max: '$createdAt' },
          },
        },
      ]);

      for (const g of groups) {
        if (key(g._id.m) === nowMain && key(g._id.s) === nowSupport) continue;
        drift.push({
          batchId: String(b._id),
          batchName: b.name,
          yearGroup: b.yearGroup || '',
          classId: String(entry.class),
          className: className.get(String(entry.class)) || 'Unknown subject',
          responses: g.responses,
          collectedFrom: g.first,
          collectedTo: g.last,
          stamped: { mainTrainers: names(g._id.m), supportTrainers: names(g._id.s) },
          current: { mainTrainers: names(entry.mainTrainers), supportTrainers: names(entry.supportTrainers) },
          /* Who LOSES this feedback and who GAINS it if re-attributed — the
             two facts an admin needs to decide, stated rather than implied. */
          wouldGain: names(entry.mainTrainers.concat(entry.supportTrainers))
            .filter((n) => !names(g._id.m.concat(g._id.s)).includes(n)),
          wouldLose: names(g._id.m.concat(g._id.s))
            .filter((n) => !names(entry.mainTrainers.concat(entry.supportTrainers)).includes(n)),
        });
      }
    }
  }
  return drift;
}

/**
 * Re-stamp one session's feedback with the batch's CURRENT roster.
 *
 * Only ever called explicitly by an admin who has been shown what moves. This
 * is the right action when the original roster was simply wrong — which is
 * exactly what happened here: two Industry Readiness batches had their teams
 * entered the wrong way round, and 107 responses sat against mentors who never
 * taught those sessions.
 *
 * It is the WRONG action when a mentor genuinely joined later, because it hands
 * them feedback for sessions they were not in and takes it from whoever was.
 * The service cannot tell those apart; the admin can, which is why this is not
 * automatic.
 */
export async function reattributeSession({ batchId, classId, actor }) {
  const batch = await Batch.findById(batchId).lean();
  if (!batch) return { matched: 0, modified: 0, reason: 'batch-not-found' };

  const entry = (batch.classes || []).find((e) => String(e.class) === String(classId));
  if (!entry) return { matched: 0, modified: 0, reason: 'class-not-in-batch' };

  const before = await Feedback.aggregate([
    { $match: { batch: batch._id, class: entry.class } },
    { $group: { _id: { m: '$mainTrainers', s: '$supportTrainers' }, n: { $sum: 1 } } },
  ]);

  const res = await Feedback.updateMany(
    { batch: batch._id, class: entry.class },
    { $set: { mainTrainers: entry.mainTrainers, supportTrainers: entry.supportTrainers } }
  );

  log().warn(
    {
      batch: String(batch._id),
      batchName: batch.name,
      class: String(entry.class),
      modified: res.modifiedCount,
      actor: actor ? String(actor) : null,
      previous: before.map((g) => ({ main: g._id.m.map(String), support: (g._id.s || []).map(String), n: g.n })),
    },
    're-attributed feedback to the current mentor roster'
  );

  return { matched: res.matchedCount, modified: res.modifiedCount, previous: before };
}
