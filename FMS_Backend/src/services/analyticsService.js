import mongoose from 'mongoose';
import { Feedback } from '../models/Feedback.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Parameter } from '../models/Parameter.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Resolve the list of Class _ids a trainer is INVOLVED with — classes they own
 * in the catalog OR are the effective trainer for in any batch (via a per-batch
 * override). Used to decide which class cards a trainer may browse and open;
 * the feedback figures themselves are scoped by the effective-trainer field.
 */
export async function trainerClassIds(trainerId) {
  const [owned, taught] = await Promise.all([
    Class.find({ trainer: trainerId }).select('_id').lean(),
    Batch.distinct('classes.class', { 'classes.trainer': trainerId }),
  ]);
  const byId = new Map();
  owned.forEach((c) => byId.set(String(c._id), c._id));
  taught.forEach((id) => byId.set(String(id), id));
  return [...byId.values()];
}

/**
 * Build a Mongo `$match` on the Feedback collection from a filter spec.
 *
 * Trainer isolation is by the denormalised EFFECTIVE trainer on each Feedback
 * row (`feedback.trainer`), not by class ownership — so a per-batch trainer
 * override routes feedback to whoever actually taught, and one trainer can
 * never see another's batch even for a class they both touch.
 *
 *  - scopeTrainerId: hard server-side cap (the logged-in trainer's id).
 *  - trainerId:      admin UI filter "show me this trainer's feedback".
 *  - classId/batchId: optional narrowing filters.
 *
 * scopeTrainerId wins over a client-supplied trainerId, so a trainer can never
 * widen their own scope by passing a different id.
 */
export function buildFeedbackMatch({ scopeTrainerId, classId, batchId, trainerId } = {}) {
  const match = {};
  const t = scopeTrainerId || trainerId;
  if (t) match.trainer = oid(t);
  if (classId) match.class = oid(classId);
  if (batchId) match.batch = oid(batchId);
  return match;
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
  const classIds = [...new Set(rows.map((r) => String(r.class)))];
  const batchIds = [...new Set(rows.map((r) => String(r.batch)))];
  const [classes, batches] = await Promise.all([
    Class.find({ _id: { $in: classIds } }).select('name').lean(),
    Batch.find({ _id: { $in: batchIds } }).select('name').lean(),
  ]);
  const className = new Map(classes.map((c) => [String(c._id), c.name]));
  const batchName = new Map(batches.map((b) => [String(b._id), b.name]));
  return rows.map((r) => ({
    id: String(r._id),
    comment: r.comment,
    average: round(r.average || 0, 2),
    className: className.get(String(r.class)) || '—',
    batchName: batchName.get(String(r.batch)) || '—',
    createdAt: r.createdAt,
  }));
}

/** Detailed feedback rows (one per submission, one column per parameter) for exports. */
export async function detailRows(match) {
  const [params, rows] = await Promise.all([
    Parameter.find().sort({ order: 1, createdAt: 1 }).select('label').lean(),
    Feedback.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $lookup: { from: 'classes', localField: 'class', foreignField: '_id', as: 'classDoc' },
      },
      { $lookup: { from: 'batches', localField: 'batch', foreignField: '_id', as: 'batchDoc' } },
      {
        $project: {
          createdAt: 1,
          comment: 1,
          ratings: 1,
          className: { $arrayElemAt: ['$classDoc.name', 0] },
          batchName: { $arrayElemAt: ['$batchDoc.name', 0] },
          average: { $avg: '$ratings.stars' },
        },
      },
    ]),
  ]);

  const paramList = params.map((p) => ({ id: String(p._id), label: p.label }));
  const data = rows.map((r) => {
    const byParam = new Map(r.ratings.map((x) => [String(x.parameter), x.stars]));
    const starCols = {};
    for (const p of paramList) starCols[p.label] = byParam.get(p.id) ?? '';
    return {
      className: r.className || '—',
      batchName: r.batchName || '—',
      ...starCols,
      average: round(r.average || 0, 2),
      comment: r.comment,
      submittedAt: r.createdAt,
    };
  });
  return { parameters: paramList, rows: data };
}

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

/** Live open-batches panel data (admin: all; trainer: only classes they teach). */
export async function openBatches({ scopeTrainerId } = {}) {
  const filter = { status: 'open', archivedAt: null };
  // A batch is in scope if the trainer teaches AT LEAST ONE of its classes.
  if (scopeTrainerId) filter['classes.trainer'] = oid(scopeTrainerId);
  const batches = await Batch.find(filter)
    .populate({ path: 'classes.class', select: 'name' })
    .populate({ path: 'classes.trainer', select: 'name' })
    .sort({ openedAt: -1 })
    .lean();
  return batches.map((b) => {
    // A trainer only sees the classes in this batch that THEY teach.
    const visible = (b.classes || []).filter(
      (e) => !scopeTrainerId || String(e.trainer?._id || e.trainer) === String(scopeTrainerId)
    );
    return {
      id: String(b._id),
      name: b.name,
      classes: visible.map((e) => ({
        id: String(e.class?._id || e.class),
        name: e.class?.name || '—',
        trainerName: e.trainer?.name || '—',
      })),
      classCount: visible.length,
      submittedCount: b.submittedCount,
      expectedCount: b.expectedCount,
      hasPasscode: Boolean(b.passcodeHash),
      openedAt: b.openedAt,
    };
  });
}


/**
 * Comments matching a keyword, for the theme drill-down.
 *
 * The term is matched the same way the theme extractor counted it — on word
 * BOUNDARIES, not as a substring. Without \b, searching "pace" would also
 * return every comment containing "space" or "paced", and the count shown on
 * the theme chip would not match the number of comments the user actually
 * sees. Any mismatch there reads as a bug even when both numbers are
 * defensible, so they are computed the same way on purpose.
 */
export async function commentsMatching(match, term, limit = 200) {
  const rows = await Feedback.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $limit: 1000 },
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

  const clean = String(term || '').trim();
  let filtered = rows;
  if (clean) {
    // Escape the term before it becomes a regex — a user searching "c++" must
    // not blow up the query.
    const safe = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Tolerate the plural/possessive forms the singulariser folded together.
    const rx = new RegExp(`\\b${safe}(s|es|'s)?\\b`, 'i');
    filtered = rows.filter((r) => rx.test(r.comment || ''));
  }

  const classIds = [...new Set(filtered.map((r) => String(r.class)))];
  const batchIds = [...new Set(filtered.map((r) => String(r.batch)))];
  const [classes, batches] = await Promise.all([
    Class.find({ _id: { $in: classIds } }).select('name').lean(),
    Batch.find({ _id: { $in: batchIds } }).select('name').lean(),
  ]);
  const className = new Map(classes.map((c) => [String(c._id), c.name]));
  const batchName = new Map(batches.map((b) => [String(b._id), b.name]));

  return {
    term: clean,
    total: filtered.length,
    comments: filtered.slice(0, limit).map((r) => ({
      id: String(r._id),
      comment: r.comment,
      average: round(r.average || 0, 2),
      className: className.get(String(r.class)) || '—',
      batchName: batchName.get(String(r.batch)) || '—',
      classId: String(r.class),
      batchId: String(r.batch),
      createdAt: r.createdAt,
    })),
  };
}
