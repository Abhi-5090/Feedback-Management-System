import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/ApiError.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Feedback } from '../models/Feedback.js';
import { Parameter } from '../models/Parameter.js';
import {
  periodDeltas,
  trainerComparison,
  commentThemes,
} from '../services/insightsService.js';
import {
  trainerClassIds,
  buildFeedbackMatch,
  perParameterAverages,
  overallStats,
  trendOverTime,
  recentComments,
  commentsMatching,
} from '../services/analyticsService.js';

/**
 * Resolve the caller's visibility scope.
 *  - admin   → { scopeTrainerId: null }  (everything)
 *  - trainer → { scopeTrainerId: <their id> }  (hard server-side cap; feedback
 *              is isolated by the effective-trainer field, so a per-batch
 *              override is honoured automatically)
 */
export async function resolveScope(req) {
  if (req.user.role === 'admin') return { scopeTrainerId: null };
  return { scopeTrainerId: req.user._id };
}

/** Assemble the standard analytics payload for a given Feedback match. */
async function analyticsPayload(match) {
  const [perParameter, overall, trend, comments] = await Promise.all([
    perParameterAverages(match),
    overallStats(match),
    trendOverTime(match),
    recentComments(match, 30),
  ]);
  return { ...overall, perParameter, trend, comments };
}

/**
 * GET /api/analytics/classes
 *
 * The card list behind the "Feedbacks" tab. ONE endpoint serves both roles:
 *  - admin   → every class
 *  - trainer → only classes assigned to them (hard server-side scope; the
 *              client never supplies the filter)
 *
 * Everything a card needs is aggregated here rather than fetched per-card,
 * so the page is a single request no matter how many classes exist.
 */
export const classesOverview = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = await resolveScope(req);

  // For a trainer, the card list is the classes they're involved with (own or
  // teach via a batch override). For admin, every class.
  let classFilter = {};
  if (scopeTrainerId) {
    const involved = await trainerClassIds(scopeTrainerId);
    if (!involved.length) return res.json({ classes: [] });
    classFilter = { _id: { $in: involved } };
  }
  const classes = await Class.find(classFilter)
    .populate('trainer', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  const ids = classes.map((c) => c._id);
  if (!ids.length) return res.json({ classes: [] });

  // Feedback figures are scoped to the EFFECTIVE trainer for a trainer, so a
  // class's card shows only the batches they actually taught.
  const fbScope = scopeTrainerId ? { trainer: scopeTrainerId } : {};
  // Batch counts likewise: for a trainer, only batches where they teach the class.
  const batchTrainerMatch = scopeTrainerId ? { 'classes.trainer': scopeTrainerId } : {};

  // Three grouped aggregations instead of N queries per class.
  const [fbStats, batchStats, paramTop] = await Promise.all([
    Feedback.aggregate([
      { $match: { class: { $in: ids }, ...fbScope } },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: '$class',
          avg: { $avg: '$ratings.stars' },
          feedbackIds: { $addToSet: '$_id' },
          lastAt: { $max: '$createdAt' },
        },
      },
      {
        $project: {
          avg: 1,
          lastAt: 1,
          responses: { $size: '$feedbackIds' },
        },
      },
    ]),
    // A batch holds many { class, trainer } entries now — unwind so each class
    // in scope is credited for the batches it appears in. For a trainer, only
    // the entries where THEY teach the class count.
    Batch.aggregate([
      { $match: { 'classes.class': { $in: ids }, archivedAt: null, ...batchTrainerMatch } },
      { $unwind: '$classes' },
      { $match: { 'classes.class': { $in: ids }, ...batchTrainerMatch } },
      {
        $group: {
          _id: '$classes.class',
          batches: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
        },
      },
    ]),
    // Best / worst rated parameter per class — the one insight that makes a
    // card worth reading rather than just a link.
    Feedback.aggregate([
      { $match: { class: { $in: ids }, ...fbScope } },
      { $unwind: '$ratings' },
      { $group: { _id: { c: '$class', p: '$ratings.parameter' }, avg: { $avg: '$ratings.stars' } } },
    ]),
  ]);

  const fbBy = new Map(fbStats.map((f) => [String(f._id), f]));
  const batchBy = new Map(batchStats.map((b) => [String(b._id), b]));

  // Resolve parameter labels once for the best/worst callouts.
  const params = await Parameter.find().select('label').lean();
  const labelById = new Map(params.map((p) => [String(p._id), p.label]));

  const byClassParams = new Map();
  for (const r of paramTop) {
    const key = String(r._id.c);
    if (!byClassParams.has(key)) byClassParams.set(key, []);
    byClassParams.get(key).push({ label: labelById.get(String(r._id.p)) || '—', avg: r.avg });
  }

  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  res.json({
    classes: classes.map((c) => {
      const key = String(c._id);
      const f = fbBy.get(key);
      const b = batchBy.get(key) || { batches: 0, open: 0 };
      const ps = (byClassParams.get(key) || []).sort((x, y) => y.avg - x.avg);

      return {
        id: key,
        name: c.name,
        description: c.description || '',
        isActive: c.isActive !== false,
        trainer: c.trainer?.name || null,
        batches: b.batches,
        openBatches: b.open,
        responses: f?.responses || 0,
        average: round(f?.avg),
        lastFeedbackAt: f?.lastAt || null,
        strongest: ps.length ? { label: ps[0].label, average: round(ps[0].avg) } : null,
        weakest: ps.length > 1 ? { label: ps[ps.length - 1].label, average: round(ps[ps.length - 1].avg) } : null,
      };
    }),
  });
});

// GET /api/analytics/class/:classId
export const classAnalytics = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = await resolveScope(req);
  const klass = await Class.findById(req.params.classId).populate('trainer', 'name');
  if (!klass) throw notFound('Class not found');

  // Trainer isolation: a trainer may only read a class they own or teach in
  // some batch. The feedback shown is further scoped to their own batches.
  if (scopeTrainerId) {
    const involved = await trainerClassIds(scopeTrainerId);
    if (!involved.some((id) => String(id) === String(klass._id))) {
      throw forbidden('You do not have access to this class.');
    }
  }

  const match = buildFeedbackMatch({ scopeTrainerId, classId: klass._id });
  res.json({
    class: { id: String(klass._id), name: klass.name, trainer: klass.trainer?.name },
    ...(await analyticsPayload(match)),
  });
});

// GET /api/analytics/batch/:batchId
//
// Returns BOTH the batch-level aggregate (across every class in the batch) and
// a per-class breakdown — "batch feedback" and "separate class feedback" in one
// payload, which is the whole point of the batch-holds-many-classes model.
// A trainer sees only their own classes within the batch, and the batch
// aggregate is likewise restricted to those classes.
export const batchAnalytics = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = await resolveScope(req);
  const batch = await Batch.findById(req.params.batchId)
    .populate({ path: 'classes.class', select: 'name' })
    .populate({ path: 'classes.trainer', select: 'name' });
  if (!batch) throw notFound('Batch not found');

  // A trainer only sees the classes in this batch that THEY teach.
  const visibleEntries = (batch.classes || []).filter(
    (e) => !scopeTrainerId || String(e.trainer?._id || e.trainer) === String(scopeTrainerId)
  );
  if (scopeTrainerId && visibleEntries.length === 0) {
    throw forbidden('You do not have access to this batch.');
  }

  // Batch-level aggregate (scoped to the trainer's own feedback for a trainer).
  const match = buildFeedbackMatch({ scopeTrainerId, batchId: batch._id });

  // Per-class breakdown within this batch.
  const classesBreakdown = await Promise.all(
    visibleEntries.map(async (e) => {
      const classId = e.class?._id || e.class;
      const cMatch = buildFeedbackMatch({ scopeTrainerId, batchId: batch._id, classId });
      const [overall, perParameter] = await Promise.all([overallStats(cMatch), perParameterAverages(cMatch)]);
      return {
        id: String(classId),
        name: e.class?.name || '—',
        trainerName: e.trainer?.name || '—',
        ...overall,
        perParameter,
      };
    })
  );

  res.json({
    batch: {
      id: String(batch._id),
      name: batch.name,
      classes: visibleEntries.map((e) => ({
        id: String(e.class?._id || e.class),
        name: e.class?.name || '—',
        trainerName: e.trainer?.name || '—',
      })),
      classCount: visibleEntries.length,
      submittedCount: batch.submittedCount,
      expectedCount: batch.expectedCount,
      status: batch.status,
    },
    classesBreakdown,
    ...(await analyticsPayload(match)),
  });
});

// GET /api/analytics/trainer/me  (trainer-scoped)
export const trainerAnalytics = asyncHandler(async (req, res) => {
  const match = buildFeedbackMatch({ scopeTrainerId: req.user._id });
  res.json(await analyticsPayload(match));
});

/**
 * GET /api/analytics/trainer/batches  (trainer-scoped)
 *
 * The trainer's own batches as cards. A batch is included only if the trainer
 * is the effective trainer for at least one of its classes; each card lists
 * only THAT trainer's classes and their own feedback figures for the batch.
 */
export const trainerBatchesOverview = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const batches = await Batch.find({ 'classes.trainer': me, archivedAt: null })
    .populate({ path: 'classes.class', select: 'name' })
    .sort({ createdAt: -1 })
    .lean();

  const ids = batches.map((b) => b._id);
  // This trainer's own feedback stats per batch (honours overrides).
  const stats = ids.length
    ? await Feedback.aggregate([
        { $match: { trainer: me, batch: { $in: ids } } },
        { $unwind: '$ratings' },
        {
          $group: {
            _id: '$batch',
            avg: { $avg: '$ratings.stars' },
            fids: { $addToSet: '$_id' },
            last: { $max: '$createdAt' },
          },
        },
        { $project: { avg: 1, last: 1, responses: { $size: '$fids' } } },
      ])
    : [];
  const statBy = new Map(stats.map((s) => [String(s._id), s]));
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  res.json({
    batches: batches.map((b) => {
      const mine = (b.classes || []).filter((e) => String(e.trainer) === String(me));
      const s = statBy.get(String(b._id));
      return {
        id: String(b._id),
        name: b.name,
        status: b.status,
        classes: mine.map((e) => ({ id: String(e.class?._id || e.class), name: e.class?.name || '—' })),
        classCount: mine.length,
        submittedCount: b.submittedCount,
        expectedCount: b.expectedCount,
        responses: s?.responses || 0,
        average: round(s?.avg),
        lastFeedbackAt: s?.last || null,
        openedAt: b.openedAt,
        createdAt: b.createdAt,
      };
    }),
  });
});


/**
 * GET /api/analytics/trainers  (admin only)
 * Every trainer ranked on the same parameters.
 */
export const trainersComparison = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('Admins only.');
  res.json(await trainerComparison());
});

/**
 * GET /api/analytics/themes   ?classId=&batchId=&trainerId=
 * Recurring words/phrases in comments, each with the average rating of the
 * responses that mention it. Role-scoped like every other analytics route.
 */
export const themes = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = await resolveScope(req);
  const match = buildFeedbackMatch({
    scopeTrainerId,
    classId: req.query.classId,
    batchId: req.query.batchId,
    trainerId: req.query.trainerId,
  });
  res.json(await commentThemes(match));
});

/**
 * GET /api/analytics/deltas   ?days=30&classId=&batchId=&trainerId=
 * Current period vs the period immediately before it.
 */
export const deltas = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = await resolveScope(req);
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '30', 10)));
  const match = buildFeedbackMatch({
    scopeTrainerId,
    classId: req.query.classId,
    batchId: req.query.batchId,
    trainerId: req.query.trainerId,
  });
  res.json(await periodDeltas(match, days));
});


/**
 * GET /api/analytics/comments   ?term=&batchId=&classId=&trainerId=
 *
 * The comments behind a theme. Role-scoped like everything else: a trainer
 * drilling into "pace" sees only their own students' comments, never another
 * trainer's, even if the same word appears there.
 */
export const comments = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = await resolveScope(req);
  const match = buildFeedbackMatch({
    scopeTrainerId,
    classId: req.query.classId,
    batchId: req.query.batchId,
    trainerId: req.query.trainerId,
  });

  const data = await commentsMatching(match, req.query.term);

  // Echo back the batch/class being viewed so the page can title itself
  // without a second round trip.
  let context = null;
  if (req.query.batchId) {
    const b = await Batch.findById(req.query.batchId).lean();
    if (b) {
      // A batch spans many classes; if the drill-down is also class-filtered,
      // name that class so the page can title itself precisely.
      let className;
      if (req.query.classId) {
        const c = await Class.findById(req.query.classId).select('name').lean();
        className = c?.name;
      }
      context = { type: 'batch', id: String(b._id), name: b.name, className };
    }
  } else if (req.query.classId) {
    const c = await Class.findById(req.query.classId).lean();
    if (c) context = { type: 'class', id: String(c._id), name: c.name };
  }

  res.json({ ...data, context });
});
