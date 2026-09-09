import mongoose from 'mongoose';
import { Feedback } from '../models/Feedback.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Parameter } from '../models/Parameter.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Escape a user-supplied string so it is safe to embed in a RegExp. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolve the list of Class _ids a mentor is INVOLVED with — subjects they own
 * in the catalog OR are staffed on (either role) in any batch. Used to decide
 * which class cards a trainer may browse and open; the feedback figures
 * themselves are scoped by the denormalised rosters on Feedback.
 */
export async function trainerClassIds(trainerId, { role } = {}) {
  const id = oid(trainerId);

  // Which staffing rosters count for this question.
  const rosterMatch = [];
  if (role !== 'support') rosterMatch.push({ 'classes.mainTrainers': id });
  if (role !== 'main') rosterMatch.push({ 'classes.supportTrainers': id });

  /* UNWIND BEFORE MATCHING — this is the whole point of the aggregation.
     `Batch.distinct('classes.class', { 'classes.supportTrainers': id })` looks
     equivalent and is not: the filter selects whole BATCHES that contain a
     matching entry, and distinct then returns every class in them. A batch
     running Coding and GenAI where the mentor only assists on Coding would
     therefore report GenAI as theirs too — granting access to a class they are
     not staffed on. Unwinding first evaluates the roster test per ENTRY, so
     only the classes they are actually on come back. */
  const [owned, staffed] = await Promise.all([
    // A catalog default only counts when we're not asking a role-specific
    // question — "what do I support?" must not include a subject merely
    // because the trainer is its nominal owner.
    role ? [] : Class.find({ trainer: id }).select('_id').lean(),
    Batch.aggregate([
      { $match: { archivedAt: null, $or: rosterMatch } },
      { $unwind: '$classes' },
      { $match: { $or: rosterMatch } },
      { $group: { _id: '$classes.class' } },
    ]),
  ]);

  const byId = new Map();
  owned.forEach((c) => byId.set(String(c._id), c._id));
  staffed.forEach((row) => byId.set(String(row._id), row._id));
  return [...byId.values()];
}

/**
 * Build a Mongo `$match` on the Feedback collection from a filter spec.
 *
 * MENTOR ISOLATION is by the denormalised rosters on each Feedback row, so:
 *   - a mentor matches if they are in EITHER roster (default),
 *   - `role: 'main'` narrows to sessions they delivered,
 *   - `role: 'support'` narrows to sessions they assisted.
 * A per-batch staffing change therefore routes feedback to whoever actually
 * taught, and one mentor can never see another's batch.
 *
 *  - scopeTrainerId: hard server-side cap (the logged-in trainer's id).
 *  - trainerId:      admin UI filter "show me this mentor's feedback".
 *  - classId/batchId/yearGroup/from/to: optional narrowing filters.
 *
 * scopeTrainerId wins over a client-supplied trainerId, so a trainer can never
 * widen their own scope by passing a different id.
 *
 * Conditions are accumulated into `$and` rather than merged onto one object,
 * because the roster check is itself an `$or` — merging would let a second
 * `$or` (a date range, a keyword) silently overwrite it and leak another
 * mentor's rows.
 */
export function buildFeedbackMatch({
  scopeTrainerId,
  classId,
  batchId,
  trainerId,
  role,
  round,
  from,
  to,
  comment,
} = {}) {
  const and = [];

  const t = scopeTrainerId || trainerId;
  if (t) {
    const id = oid(t);
    if (role === 'main') and.push({ mainTrainers: id });
    else if (role === 'support') and.push({ supportTrainers: id });
    else and.push({ $or: [{ mainTrainers: id }, { supportTrainers: id }] });
  }

  if (classId) and.push({ class: oid(classId) });
  if (batchId) and.push({ batch: oid(batchId) });
  if (Number.isInteger(round)) and.push({ round });

  if (from || to) {
    const range = {};
    if (from) range.$gte = from instanceof Date ? from : new Date(from);
    if (to) range.$lte = to instanceof Date ? to : new Date(to);
    // Ignore an unparseable date rather than matching nothing silently.
    if (Object.values(range).every((d) => d instanceof Date && !Number.isNaN(+d))) {
      and.push({ createdAt: range });
    }
  }

  if (comment) {
    // Word-boundary match, mirroring how the theme extractor counted the term
    // (see commentsMatching). Tolerates the plural/possessive forms the
    // singulariser folds together.
    and.push({ comment: { $regex: `\\b${escapeRegex(comment)}(s|es|'s)?\\b`, $options: 'i' } });
  }

  if (!and.length) return {};
  if (and.length === 1) return and[0];
  return { $and: and };
}

/**
 * Resolve the set of batch ids matching a yearGroup / dept filter.
 *
 * Feedback rows don't carry the year group (it belongs to the cohort, not the
 * response), so a year filter has to become a batch-id list first. Returns
 * null when no such filter is active, so callers can skip the extra clause.
 */
export async function batchIdsForCohort({ yearGroup, dept } = {}) {
  if (!yearGroup && !dept) return null;
  const filter = {};
  if (yearGroup) filter.yearGroup = yearGroup;
  if (dept) filter.dept = { $regex: escapeRegex(dept), $options: 'i' };
  const ids = await Batch.distinct('_id', filter);
  return ids;
}

/** Average stars per parameter (joined to the parameter label), + response count. */
export async function perParameterAverages(match) {
  const rows = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: '$ratings.parameter',
        avg: { $avg: '$ratings.stars' },
        count: { $sum: 1 },
      },
    },
  ]);
  const params = await Parameter.find().select('label order').lean();
  const labelById = new Map(params.map((p) => [String(p._id), p]));
  return rows
    .map((r) => ({
      parameterId: String(r._id),
      label: labelById.get(String(r._id))?.label || 'Removed parameter',
      order: labelById.get(String(r._id))?.order ?? 999,
      average: round(r.avg, 2),
      responses: r.count,
    }))
    .sort((a, b) => a.order - b.order);
}

/** Overall totals: number of feedback docs + grand average across all stars. */
export async function overallStats(match) {
  const [agg] = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: null,
        avg: { $avg: '$ratings.stars' },
        ratingCount: { $sum: 1 },
        feedbackIds: { $addToSet: '$_id' },
      },
    },
    { $project: { avg: 1, ratingCount: 1, feedbackCount: { $size: '$feedbackIds' } } },
  ]);
  return {
    feedbackCount: agg?.feedbackCount || 0,
    overallAverage: round(agg?.avg || 0, 2),
  };
}

/**
 * A mentor's figures split by the role they held.
 *
 * This is the payoff of storing both rosters: "4.6 across 12 sessions you
 * delivered, 4.2 across 4 you assisted" is a genuinely different statement
 * from one blended number, and a support mentor should not carry the score of
 * a class someone else taught as though it were their own.
 */
export async function roleSplitStats({ trainerId, classId, batchId, from, to } = {}) {
  const forRole = (role) =>
    buildFeedbackMatch({ scopeTrainerId: trainerId, role, classId, batchId, from, to });

  const [main, support] = await Promise.all([
    overallStats(forRole('main')),
    overallStats(forRole('support')),
  ]);

  return {
    main: { ...main, role: 'main' },
    support: { ...support, role: 'support' },
  };
}

/** Rating trend over time — average stars + response count grouped by day. */
export async function trendOverTime(match) {
  const rows = await Feedback.aggregate([
    { $match: match },
    {
      $project: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        avgStars: { $avg: '$ratings.stars' },
      },
    },
    {
      $group: {
        _id: '$day',
        average: { $avg: '$avgStars' },
        responses: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ date: r._id, average: round(r.average, 2), responses: r.responses }));
}

/** Feedback volume (and average) per class. */
export async function volumePerClass(match) {
  const rows = await Feedback.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$class',
        responses: { $sum: 1 },
        avg: { $avg: { $avg: '$ratings.stars' } },
      },
    },
    { $sort: { responses: -1 } },
  ]);
  const classes = await Class.find().select('name').lean();
  const nameById = new Map(classes.map((c) => [String(c._id), c.name]));
  return rows.map((r) => ({
    classId: String(r._id),
    className: nameById.get(String(r._id)) || 'Unknown class',
    responses: r.responses,
    average: round(r.avg || 0, 2),
  }));
}

/**
 * How many comments exist in a scope.
 *
 * Every submission carries a mandatory comment, so this equals the response
 * count — but it is queried rather than assumed, because a page that shows
 * "30 most recent" without saying 30 of WHAT reads as "there are 30", and a
 * cohort of 66 then looks like it half failed to answer.
 */
export async function commentTotal(match) {
  return Feedback.countDocuments(andMatch(match, { comment: { $exists: true, $ne: '' } }));
}

/** Recent feedback with its comment + resolved class/batch names + own average. */
export async function recentComments(match, limit = 20) {
  const rows = await Feedback.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    {
      $project: {
        comment: 1,
        createdAt: 1,
        class: 1,
        batch: 1,
        average: { $avg: '$ratings.stars' },
      },
    },
  ]);
  return decorateComments(rows);
}

/** Resolve class/batch names for a list of projected comment rows. */
async function decorateComments(rows) {
  const classIds = [...new Set(rows.map((r) => String(r.class)))];
  const batchIds = [...new Set(rows.map((r) => String(r.batch)))];
  const [classes, batches] = await Promise.all([
    Class.find({ _id: { $in: classIds } }).select('name').lean(),
    Batch.find({ _id: { $in: batchIds } }).select('name yearGroup dept').lean(),
  ]);
  const className = new Map(classes.map((c) => [String(c._id), c.name]));
  const batchById = new Map(batches.map((b) => [String(b._id), b]));
  return rows.map((r) => {
    const b = batchById.get(String(r.batch));
    return {
      id: String(r._id),
      comment: r.comment,
      average: round(r.average || 0, 2),
      className: className.get(String(r.class)) || '—',
      batchName: b?.name || '—',
      yearGroup: b?.yearGroup || '',
      dept: b?.dept || '',
      classId: String(r.class),
      batchId: String(r.batch),
      createdAt: r.createdAt,
    };
  });
}

/** Detailed feedback rows (one per submission, one column per parameter) for exports. */
export async function detailRows(match, { limit = 50_000 } = {}) {
  const [params, rows] = await Promise.all([
    Parameter.find().sort({ order: 1, createdAt: 1 }).select('label').lean(),
    Feedback.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      // Bound the export so one click can never try to buffer an unbounded
      // result set in memory. 50k rows is far beyond any real cohort and still
      // builds well inside the container's heap.
      { $limit: limit + 1 },
      {
        $lookup: { from: 'classes', localField: 'class', foreignField: '_id', as: 'classDoc' },
      },
      { $lookup: { from: 'batches', localField: 'batch', foreignField: '_id', as: 'batchDoc' } },
      {
        $lookup: { from: 'users', localField: 'mainTrainers', foreignField: '_id', as: 'mainDocs' },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'supportTrainers',
          foreignField: '_id',
          as: 'supportDocs',
        },
      },
      {
        $project: {
          createdAt: 1,
          comment: 1,
          ratings: 1,
          round: 1,
          className: { $arrayElemAt: ['$classDoc.name', 0] },
          batchName: { $arrayElemAt: ['$batchDoc.name', 0] },
          yearGroup: { $arrayElemAt: ['$batchDoc.yearGroup', 0] },
          dept: { $arrayElemAt: ['$batchDoc.dept', 0] },
          mainNames: '$mainDocs.name',
          supportNames: '$supportDocs.name',
          average: { $avg: '$ratings.stars' },
        },
      },
    ]),
  ]);

  const truncated = rows.length > limit;
  const kept = truncated ? rows.slice(0, limit) : rows;

  const paramList = params.map((p) => ({ id: String(p._id), label: p.label }));
  const data = kept.map((r) => {
    const byParam = new Map(r.ratings.map((x) => [String(x.parameter), x.stars]));
    const starCols = {};
    for (const p of paramList) starCols[p.label] = byParam.get(p.id) ?? '';
    return {
      yearGroup: r.yearGroup || '—',
      className: r.className || '—',
      batchName: r.batchName || '—',
      dept: r.dept || '—',
      mainMentors: (r.mainNames || []).join(', ') || '—',
      supportMentors: (r.supportNames || []).join(', ') || '—',
      ...starCols,
      average: round(r.average || 0, 2),
      comment: r.comment,
      submittedAt: r.createdAt,
    };
  });
  return { parameters: paramList, rows: data, truncated, limit };
}

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

/** Live open-batches panel data (admin: all; trainer: only batches they staff). */
export async function openBatches({ scopeTrainerId } = {}) {
  const filter = { status: 'open', archivedAt: null };
  // A batch is in scope if the mentor staffs AT LEAST ONE of its classes.
  if (scopeTrainerId) {
    const id = oid(scopeTrainerId);
    filter.$or = [{ 'classes.mainTrainers': id }, { 'classes.supportTrainers': id }];
  }
  const batches = await Batch.find(filter)
    .populate({ path: 'classes.class', select: 'name' })
    .populate({ path: 'classes.mainTrainers', select: 'name' })
    .populate({ path: 'classes.supportTrainers', select: 'name' })
    .sort({ openedAt: -1 })
    .lean();

  return batches.map((b) => {
    // A trainer only sees the classes in this batch that THEY are staffed on.
    const visible = (b.classes || []).filter((e) => !scopeTrainerId || staffs(e, scopeTrainerId));
    return {
      id: String(b._id),
      name: b.name,
      yearGroup: b.yearGroup || '',
      dept: b.dept || '',
      round: b.round || 0,
      classes: visible.map((e) => shapeEntry(e, scopeTrainerId)),
      classCount: visible.length,
      submittedCount: b.submittedCount,
      expectedCount: b.expectedCount,
      hasPasscode: Boolean(b.passcodeHash),
      openedAt: b.openedAt,
    };
  });
}

/** Is `trainerId` staffed on this batch-class entry, in either role? */
export function staffs(entry, trainerId) {
  const id = String(trainerId);
  const has = (list) => (list || []).some((t) => String(t?._id || t) === id);
  return has(entry.mainTrainers) || has(entry.supportTrainers);
}

/** The role(s) `trainerId` holds on this entry — for badges in the UI. */
export function rolesOn(entry, trainerId) {
  const id = String(trainerId);
  const has = (list) => (list || []).some((t) => String(t?._id || t) === id);
  const out = [];
  if (has(entry.mainTrainers)) out.push('main');
  if (has(entry.supportTrainers)) out.push('support');
  return out;
}

/** Normalise a populated-or-raw batch-class entry for the API surface. */
export function shapeEntry(entry, scopeTrainerId) {
  const name = (t) => (t && t.name ? t.name : null);
  const ids = (list) => (list || []).map((t) => String(t?._id || t));
  return {
    id: String(entry.class?._id || entry.class),
    name: entry.class?.name || '—',
    mainTrainers: (entry.mainTrainers || []).map((t) => ({
      id: String(t?._id || t),
      name: name(t),
    })),
    supportTrainers: (entry.supportTrainers || []).map((t) => ({
      id: String(t?._id || t),
      name: name(t),
    })),
    mainTrainerNames: (entry.mainTrainers || []).map(name).filter(Boolean),
    supportTrainerNames: (entry.supportTrainers || []).map(name).filter(Boolean),
    mainTrainerIds: ids(entry.mainTrainers),
    supportTrainerIds: ids(entry.supportTrainers),
    myRoles: scopeTrainerId ? rolesOn(entry, scopeTrainerId) : undefined,
  };
}

/**
 * Comments matching a keyword, for the theme drill-down.
 *
 * The keyword is matched IN THE DATABASE (see buildFeedbackMatch's `comment`
 * clause) on word BOUNDARIES. Two reasons this is not done in JS any more:
 *   - Correctness at scale. The old version pulled the newest 1000 rows and
 *     filtered them in memory, so once a term's matches sat outside that
 *     window the count on the theme chip disagreed with the list underneath it.
 *   - Boundaries, not substrings. Without \b, "pace" also matches "space" and
 *     the count is wrong for a second, subtler reason.
 * `total` is now a real count of every matching row, and the page is a real
 * page of it.
 */
export async function commentsMatching(match, term, { limit = 100, page = 1 } = {}) {
  const clean = String(term || '').trim();
  const scoped = clean ? andMatch(match, buildFeedbackMatch({ comment: clean })) : match;

  const skip = Math.max(0, (page - 1) * limit);
  const [rows, total] = await Promise.all([
    Feedback.aggregate([
      { $match: scoped },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          comment: 1,
          createdAt: 1,
          class: 1,
          batch: 1,
          average: { $avg: '$ratings.stars' },
        },
      },
    ]),
    Feedback.countDocuments(scoped),
  ]);

  return {
    term: clean,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    comments: await decorateComments(rows),
  };
}

/**
 * Combine two `$match` objects without either clobbering the other's `$or`.
 * Exported because the controllers compose scope + cohort filters the same way.
 */
export function andMatch(a, b) {
  const parts = [a, b].filter((m) => m && Object.keys(m).length);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  const flat = [];
  for (const p of parts) {
    if (p.$and) flat.push(...p.$and);
    else flat.push(p);
  }
  return { $and: flat };
}

/**
 * A subject's feedback broken down SUBJECT → YEAR GROUP → BATCH.
 *
 * The same subject runs for several cohorts, and those cohorts are not
 * comparable: "GenAI" is delivered to final-year students and to third-year
 * students by different mentor teams, and a single blended average for the
 * subject hides which of them is struggling. One consolidated number is the
 * right headline; the divisions underneath it are where the decisions live.
 *
 * Everything comes from TWO aggregations regardless of how many years or
 * batches exist, then rolls up in memory. The obvious alternative — one query
 * per year group and one per batch — would issue a dozen round trips to build a
 * single page.
 *
 * Averages are weighted by RATING COUNT at every level, so a batch of 140
 * counts more than one of 60 and the year-group figure equals what you would
 * get by averaging the underlying stars directly. Averaging the batch averages
 * instead would let a tiny batch swing a whole cohort's score.
 *
 * `match` carries the caller's scope (mentor isolation, role, date window), so
 * a trainer sees only their own sessions here too.
 */
export async function classYearGroupBreakdown({ classId, match = {}, scopeTrainerId } = {}) {
  const scoped = andMatch({ class: oid(classId) }, match);

  const [perBatch, perBatchParam, batches, params] = await Promise.all([
    Feedback.aggregate([
      { $match: scoped },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: '$batch',
          starSum: { $sum: '$ratings.stars' },
          starCount: { $sum: 1 },
          responseIds: { $addToSet: '$_id' },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $project: { starSum: 1, starCount: 1, lastAt: 1, responses: { $size: '$responseIds' } } },
    ]),
    Feedback.aggregate([
      { $match: scoped },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: { batch: '$batch', parameter: '$ratings.parameter' },
          starSum: { $sum: '$ratings.stars' },
          starCount: { $sum: 1 },
        },
      },
    ]),
    /* Every batch running this subject that the CALLER may see, including
       those with no feedback yet — "this cohort has not answered" is
       information, not an empty row to omit.

       The $elemMatch is the whole security of this query. A mentor must only
       see cohorts they are staffed on FOR THIS SUBJECT. Writing the roster
       test as sibling keys —
         { 'classes.class': id, 'classes.mainTrainers': me }
       — is subtly wrong: those conditions may be satisfied by DIFFERENT array
       elements, so a batch that runs Coding (which she teaches) and Industry
       Readiness (which she does not) would match for Industry Readiness too.
       $elemMatch requires ONE element to satisfy both, which is the actual
       question being asked.

       Without it, a support mentor on one of four Industry Readiness batches
       was shown all four, along with the other batches' mentor rosters. */
    Batch.find(
      scopeTrainerId
        ? {
            archivedAt: null,
            classes: {
              $elemMatch: {
                class: oid(classId),
                $or: [
                  { mainTrainers: oid(scopeTrainerId) },
                  { supportTrainers: oid(scopeTrainerId) },
                ],
              },
            },
          }
        : { 'classes.class': oid(classId), archivedAt: null }
    )
      .populate({ path: 'classes.mainTrainers', select: 'name' })
      .populate({ path: 'classes.supportTrainers', select: 'name' })
      .select('name yearGroup dept status round expectedCount submittedCount classes openedAt')
      .lean(),
    Parameter.find().select('label order').lean(),
  ]);

  const statsByBatch = new Map(perBatch.map((r) => [String(r._id), r]));
  const paramMeta = new Map(params.map((p) => [String(p._id), p]));

  // batchId -> parameterId -> { starSum, starCount }
  const paramsByBatch = new Map();
  for (const row of perBatchParam) {
    const b = String(row._id.batch);
    if (!paramsByBatch.has(b)) paramsByBatch.set(b, new Map());
    paramsByBatch.get(b).set(String(row._id.parameter), row);
  }

  /** Turn a parameterId -> {starSum,starCount} map into the API's shape. */
  const shapeParams = (byParam) =>
    [...byParam.entries()]
      .map(([pid, agg]) => ({
        parameterId: pid,
        label: paramMeta.get(pid)?.label || 'Removed parameter',
        order: paramMeta.get(pid)?.order ?? 999,
        average: round(agg.starSum / agg.starCount, 2),
        responses: agg.starCount,
      }))
      .sort((a, b) => a.order - b.order);

  // Group the batches by year group, accumulating as we go.
  const groups = new Map();
  for (const b of batches) {
    const entry = (b.classes || []).find((e) => String(e.class) === String(classId));
    if (!entry) continue;

    const key = b.yearGroup || 'Unassigned';
    if (!groups.has(key)) {
      groups.set(key, {
        yearGroup: key,
        batches: [],
        starSum: 0,
        starCount: 0,
        responses: 0,
        expected: 0,
        submitted: 0,
        openBatches: 0,
        lastAt: null,
        byParam: new Map(),
      });
    }
    const g = groups.get(key);

    const st = statsByBatch.get(String(b._id));
    const bParams = paramsByBatch.get(String(b._id)) || new Map();

    g.batches.push({
      id: String(b._id),
      name: b.name,
      dept: b.dept || '',
      status: b.status,
      round: b.round || 0,
      expectedCount: b.expectedCount || 0,
      /* Derived from the rows, not from Batch.submittedCount — one row per
         student per class means the row count for THIS class is the number of
         students who answered it. The stored counter is the cap guard and can
         drift from the data (see sessionCards). */
      submittedCount: st?.responses || 0,
      counterValue: b.submittedCount || 0,
      // Against the cohort size, so a low response count reads as "few
      // answered" rather than "badly rated".
      responseRate:
        b.expectedCount > 0 ? round(((st?.responses || 0) / b.expectedCount) * 100, 1) : null,
      responses: st?.responses || 0,
      average: st ? round(st.starSum / st.starCount, 2) : null,
      lastFeedbackAt: st?.lastAt || null,
      perParameter: shapeParams(bParams),
      /* Take only the ROSTER fields from the shaped entry. Spreading the whole
         thing would overwrite `id` and `name` with the CLASS's id and name —
         every batch would render as the subject, or as "—" when the class ref
         is not populated. */
      ...(() => {
        const e = shapeEntry(entry, scopeTrainerId);
        return {
          mainTrainers: e.mainTrainers,
          supportTrainers: e.supportTrainers,
          mainTrainerNames: e.mainTrainerNames,
          supportTrainerNames: e.supportTrainerNames,
          myRoles: e.myRoles,
        };
      })(),
    });

    if (st) {
      g.starSum += st.starSum;
      g.starCount += st.starCount;
      g.responses += st.responses;
      if (st.lastAt && (!g.lastAt || st.lastAt > g.lastAt)) g.lastAt = st.lastAt;
    }
    g.expected += b.expectedCount || 0;
    // Derived, matching the per-batch figure above.
    g.submitted += st?.responses || 0;
    if (b.status === 'open') g.openBatches += 1;

    for (const [pid, agg] of bParams) {
      const cur = g.byParam.get(pid) || { starSum: 0, starCount: 0 };
      cur.starSum += agg.starSum;
      cur.starCount += agg.starCount;
      g.byParam.set(pid, cur);
    }
  }

  const yearGroups = [...groups.values()]
    .map((g) => ({
      yearGroup: g.yearGroup,
      batchCount: g.batches.length,
      openBatches: g.openBatches,
      responses: g.responses,
      average: g.starCount ? round(g.starSum / g.starCount, 2) : null,
      expected: g.expected,
      submitted: g.submitted,
      responseRate: g.expected ? round((g.submitted / g.expected) * 100, 1) : null,
      lastFeedbackAt: g.lastAt,
      perParameter: shapeParams(g.byParam),
      // Busiest cohort first; an unanswered batch sorts last rather than
      // interleaving with rated ones.
      batches: g.batches.sort(
        (a, b) => b.responses - a.responses || a.name.localeCompare(b.name)
      ),
    }))
    // Most-answered year group first, so the page opens on the one with
    // something to say.
    .sort((a, b) => b.responses - a.responses || a.yearGroup.localeCompare(b.yearGroup));

  return {
    yearGroups,
    // The consolidated figure, computed from the same stars — so the headline
    // and the divisions can never disagree.
    consolidated: {
      yearGroupCount: yearGroups.length,
      batchCount: yearGroups.reduce((n, g) => n + g.batchCount, 0),
      responses: yearGroups.reduce((n, g) => n + g.responses, 0),
      expected: yearGroups.reduce((n, g) => n + g.expected, 0),
      submitted: yearGroups.reduce((n, g) => n + g.submitted, 0),
    },
  };
}

/**
 * One entry per SESSION — a (batch, class) pair.
 *
 * This is the grain the product is actually read at. A subject is not a unit of
 * delivery: "C Programming" runs as four separate first-year batches with
 * different mentors, and "Industry Readiness 1" as four second-year ones. Rolled
 * up to the subject, those four become one number that belongs to nobody;
 * rolled up to the batch, each is a thing a specific mentor did with a specific
 * group of students, which is what anyone looking at feedback wants.
 *
 * Two aggregations plus one batch query, regardless of how many sessions exist.
 *
 * SCOPING: a mentor sees only the sessions they are staffed on. The $elemMatch
 * is load-bearing — pairing `classes.class` with `classes.mainTrainers` as
 * sibling keys lets DIFFERENT array elements satisfy them, which is exactly how
 * a support mentor on one Industry Readiness batch came to see all four.
 */
export async function sessionCards({ scopeTrainerId, role, yearGroup, classId, from, to } = {}) {
  const id = scopeTrainerId ? oid(scopeTrainerId) : null;

  // Which rosters count, for a role-filtered request.
  const rosterOr = [];
  if (id) {
    if (role !== 'support') rosterOr.push({ mainTrainers: id });
    if (role !== 'main') rosterOr.push({ supportTrainers: id });
  }

  const batchFilter = { archivedAt: null };
  if (yearGroup) batchFilter.yearGroup = yearGroup;
  if (id || classId) {
    const elem = {};
    if (classId) elem.class = oid(classId);
    if (rosterOr.length) elem.$or = rosterOr;
    batchFilter.classes = { $elemMatch: elem };
  }

  const feedbackScope = buildFeedbackMatch({ scopeTrainerId, role, from, to });

  const [batches, perSession, perSessionParam, params] = await Promise.all([
    Batch.find(batchFilter)
      .populate({ path: 'classes.class', select: 'name' })
      .populate({ path: 'classes.mainTrainers', select: 'name shortName' })
      .populate({ path: 'classes.supportTrainers', select: 'name shortName' })
      .select('name yearGroup dept status round expectedCount submittedCount classes openedAt createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    Feedback.aggregate([
      { $match: feedbackScope },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: { batch: '$batch', class: '$class' },
          starSum: { $sum: '$ratings.stars' },
          starCount: { $sum: 1 },
          ids: { $addToSet: '$_id' },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $project: { starSum: 1, starCount: 1, lastAt: 1, responses: { $size: '$ids' } } },
    ]),
    Feedback.aggregate([
      { $match: feedbackScope },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: { batch: '$batch', class: '$class', parameter: '$ratings.parameter' },
          starSum: { $sum: '$ratings.stars' },
          starCount: { $sum: 1 },
        },
      },
    ]),
    Parameter.find().select('label order').lean(),
  ]);

  const key = (b, c) => `${b}|${c}`;
  const statsBy = new Map(perSession.map((r) => [key(r._id.batch, r._id.class), r]));
  const paramMeta = new Map(params.map((p) => [String(p._id), p]));

  const paramsBy = new Map();
  for (const row of perSessionParam) {
    const k = key(row._id.batch, row._id.class);
    if (!paramsBy.has(k)) paramsBy.set(k, []);
    paramsBy.get(k).push({
      parameterId: String(row._id.parameter),
      label: paramMeta.get(String(row._id.parameter))?.label || 'Removed parameter',
      order: paramMeta.get(String(row._id.parameter))?.order ?? 999,
      average: round(row.starSum / row.starCount, 2),
      responses: row.starCount,
    });
  }

  const sessions = [];
  for (const b of batches) {
    for (const entry of b.classes || []) {
      // Respect the class filter and the mentor's staffing per ENTRY, not per
      // batch — a batch matching the query does not mean every session in it
      // is visible.
      if (classId && String(entry.class?._id || entry.class) !== String(classId)) continue;
      if (id && !staffs(entry, id)) continue;
      if (id && role && !rolesOn(entry, id).includes(role)) continue;

      const cid = String(entry.class?._id || entry.class);
      const k = key(b._id, cid);
      const st = statsBy.get(k);
      const ps = (paramsBy.get(k) || []).sort((x, y) => x.order - y.order);

      sessions.push({
        // Identity of a SESSION is the pair, so a stable key for React lists.
        id: k,
        batchId: String(b._id),
        batchName: b.name,
        yearGroup: b.yearGroup || 'Unassigned',
        dept: b.dept || '',
        status: b.status,
        round: b.round || 0,
        classId: cid,
        className: entry.class?.name || '—',
        ...(() => {
          const e = shapeEntry(entry, id);
          return {
            mainTrainerNames: e.mainTrainerNames,
            supportTrainerNames: e.supportTrainerNames,
            myRoles: e.myRoles,
          };
        })(),
        responses: st?.responses || 0,
        average: st ? round(st.starSum / st.starCount, 2) : null,
        lastFeedbackAt: st?.lastAt || null,
        expectedCount: b.expectedCount || 0,
        /* "Answered" is DERIVED from the feedback rows, not read from
           Batch.submittedCount.
           A student's submission writes exactly one row per class, so for a
           single session the row count IS the number of students who answered
           it — no counter required. `submittedCount` remains on the batch as
           the atomic guard that enforces the cap during collection, but it is
           a denormalised copy, and a copy drifts: deleting feedback directly
           in the database left three batches reporting 46, 38 and 41
           submissions with zero rows behind them, and the UI dutifully showed
           "33% answered" for cohorts that had answered nothing. Deriving the
           displayed figure makes that impossible — the number cannot disagree
           with the data it describes. */
        submittedCount: st?.responses || 0,
        // Also carried so an admin can SEE a drift rather than only its effect.
        counterValue: b.submittedCount || 0,
        responseRate:
          b.expectedCount > 0 ? round(((st?.responses || 0) / b.expectedCount) * 100, 1) : null,
        strongest: ps.length ? { label: ps[0].label, average: ps[0].average } : null,
        weakest: ps.length ? (() => {
          const sorted = [...ps].sort((x, y) => x.average - y.average);
          return { label: sorted[0].label, average: sorted[0].average };
        })() : null,
        openedAt: b.openedAt,
      });
    }
  }

  // Filter values for the UI, derived from what the CALLER can see — a mentor's
  // year dropdown must not advertise cohorts they have no access to.
  const yearGroups = [...new Set(sessions.map((s) => s.yearGroup))].sort();
  const subjectMap = new Map();
  for (const s of sessions) subjectMap.set(s.classId, s.className);

  return {
    sessions,
    filters: {
      yearGroups,
      classes: [...subjectMap.entries()]
        .map(([id2, name]) => ({ id: id2, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/**
 * Year-group cards: the top level of the catalog.
 *
 * A "class" is not a useful unit to browse — there are seven subjects but they
 * belong to four distinct student populations, and nobody asks "how is C
 * Programming doing?" without meaning "for first year". So the entry point is
 * the year group, with the sessions inside it one click down.
 */
export async function yearGroupCards({ scopeTrainerId } = {}) {
  const { sessions } = await sessionCards({ scopeTrainerId });

  const byYear = new Map();
  for (const s of sessions) {
    if (!byYear.has(s.yearGroup)) {
      byYear.set(s.yearGroup, {
        yearGroup: s.yearGroup,
        batchIds: new Set(),
        classIds: new Set(),
        subjects: new Set(),
        depts: new Set(),
        openBatchIds: new Set(),
        sessionCount: 0,
        responses: 0,
        starSum: 0,
        starCount: 0,
        lastFeedbackAt: null,
      });
    }
    const g = byYear.get(s.yearGroup);
    g.batchIds.add(s.batchId);
    g.classIds.add(s.classId);
    g.subjects.add(s.className);
    if (s.dept) g.depts.add(s.dept);
    if (s.status === 'open') g.openBatchIds.add(s.batchId);
    g.sessionCount += 1;
    g.responses += s.responses;
    if (s.average != null && s.responses) {
      // Weighted by responses, so a 140-student batch counts more than a 60.
      g.starSum += s.average * s.responses;
      g.starCount += s.responses;
    }
    if (s.lastFeedbackAt && (!g.lastFeedbackAt || s.lastFeedbackAt > g.lastFeedbackAt)) {
      g.lastFeedbackAt = s.lastFeedbackAt;
    }
  }

  /* Student totals are counted per BATCH, not per session. A batch running four
     subjects has ONE cohort of students, so summing per-session numbers would
     report them four times over.
     `expected` comes from the batch (the cohort size an admin set at unlock).
     `submitted` is DERIVED: within one batch every student answers each of its
     subjects once, so the number who answered is the MAX row count across its
     sessions — max rather than a division, so it stays correct if a subject was
     added to the batch after collection began. Deliberately not
     Batch.submittedCount: that counter is the cap guard and can drift from the
     rows (see sessionCards). */
  const answeredByBatch = new Map();
  for (const s of sessions) {
    answeredByBatch.set(s.batchId, Math.max(answeredByBatch.get(s.batchId) || 0, s.responses));
  }

  const allBatchIds = [...answeredByBatch.keys()];
  const batchTotals = allBatchIds.length
    ? await Batch.find({ _id: { $in: allBatchIds } })
        .select('yearGroup expectedCount submittedCount')
        .lean()
    : [];
  const studentsByYear = new Map();
  for (const b of batchTotals) {
    const k = b.yearGroup || 'Unassigned';
    const cur = studentsByYear.get(k) || { expected: 0, submitted: 0 };
    cur.expected += b.expectedCount || 0;
    cur.submitted += answeredByBatch.get(String(b._id)) || 0;
    studentsByYear.set(k, cur);
  }

  // Institutional order, not alphabetical — "First, Second, Third, Final" is
  // how a timetable reads, and sorting it as text puts Final in the middle.
  const ORDER = ['First Year', 'Second Year', 'Third Year', 'Final Year'];
  const rank = (y) => {
    const i = ORDER.indexOf(y);
    return i === -1 ? ORDER.length + 1 : i;
  };

  return [...byYear.values()]
    .map((g) => {
      const st = studentsByYear.get(g.yearGroup) || { expected: 0, submitted: 0 };
      return {
        yearGroup: g.yearGroup,
        batchCount: g.batchIds.size,
        openBatches: g.openBatchIds.size,
        classCount: g.classIds.size,
        subjects: [...g.subjects].sort(),
        departments: [...g.depts].sort(),
        sessionCount: g.sessionCount,
        students: st.expected,
        submitted: st.submitted,
        responseRate: st.expected ? round((st.submitted / st.expected) * 100, 1) : null,
        responses: g.responses,
        average: g.starCount ? round(g.starSum / g.starCount, 2) : null,
        lastFeedbackAt: g.lastFeedbackAt,
      };
    })
    .sort((a, b) => rank(a.yearGroup) - rank(b.yearGroup));
}

/**
 * The COLLECTION ROUNDS of a batch, newest first.
 *
 * Feedback is gathered repeatedly — weekly, in this deployment — and each
 * unlock bumps `Batch.round`, stamping every response written during that
 * window. So a round is exactly one collection: "the feedback we took on the
 * 8th". Without this, every week's responses pile into one undifferentiated
 * average and a decline between weeks is invisible, which is the whole point of
 * asking repeatedly.
 *
 * Grouped by round rather than by day because a window can legitimately span
 * days (a class that answers Monday and the stragglers on Tuesday is ONE
 * collection). The days it actually covers are listed so the UI can label a
 * round by date rather than by number, which is what people remember.
 */
export async function batchCollections({ batchId, scopeTrainerId, classId } = {}) {
  const match = andMatch(
    { batch: oid(batchId) },
    buildFeedbackMatch({ scopeTrainerId, classId })
  );

  const rows = await Feedback.aggregate([
    { $match: match },
    {
      $group: {
        _id: { round: { $ifNull: ['$round', 0] } },
        firstAt: { $min: '$createdAt' },
        lastAt: { $max: '$createdAt' },
        rowCount: { $sum: 1 },
        classes: { $addToSet: '$class' },
        days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
        starSum: { $sum: { $sum: '$ratings.stars' } },
        starCount: { $sum: { $size: '$ratings' } },
      },
    },
    { $sort: { '_id.round': -1 } },
  ]);

  return rows.map((r) => {
    /* One submission writes one row per class, so the number of STUDENTS who
       answered a round is its row count divided by the classes they rated —
       reporting rows would double-count a two-subject batch. */
    const classCount = Math.max(1, r.classes.length);
    return {
      round: r._id.round,
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      days: [...r.days].sort(),
      classCount,
      rows: r.rowCount,
      responses: Math.round(r.rowCount / classCount),
      average: r.starCount ? round(r.starSum / r.starCount, 2) : null,
    };
  });
}
