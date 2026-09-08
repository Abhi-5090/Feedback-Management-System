import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound, badRequest } from '../utils/ApiError.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Feedback } from '../models/Feedback.js';
import { Parameter } from '../models/Parameter.js';
import { User } from '../models/User.js';
import {
  periodDeltas,
  trainerComparison,
  commentThemes,
} from '../services/insightsService.js';
import {
  trainerClassIds,
  buildFeedbackMatch,
  batchIdsForCohort,
  andMatch,
  perParameterAverages,
  overallStats,
  roleSplitStats,
  trendOverTime,
  recentComments,
  commentsMatching,
  classYearGroupBreakdown,
  sessionCards,
  yearGroupCards,
  staffs,
  rolesOn,
  shapeEntry,
  round as r2,
} from '../services/analyticsService.js';

/**
 * Resolve the caller's visibility scope.
 *  - admin   → { scopeTrainerId: null }  (everything)
 *  - trainer → { scopeTrainerId: <their id> }  (hard server-side cap; feedback
 *              is isolated by the denormalised mentor rosters, so per-batch
 *              staffing is honoured automatically)
 */
export function resolveScope(req) {
  if (req.user.role === 'admin') return { scopeTrainerId: null };
  return { scopeTrainerId: req.user._id };
}

/** The role filter, if the caller asked for one. Anything else is ignored. */
function resolveRole(req) {
  const role = String(req.query.role || '').toLowerCase();
  return role === 'main' || role === 'support' ? role : undefined;
}

/**
 * Common narrowing filters shared by every analytics endpoint: class, batch,
 * mentor, role, cohort (year group / dept) and a date window.
 *
 * The cohort filter has to be resolved to a batch-id list first, because a
 * Feedback row carries no year group — that belongs to the batch. Returns a
 * ready-to-use `$match`.
 */
async function resolveMatch(req, { scopeTrainerId, classId, batchId } = {}) {
  const q = req.query;
  const base = buildFeedbackMatch({
    scopeTrainerId,
    role: resolveRole(req),
    classId: classId ?? q.classId,
    batchId: batchId ?? q.batchId,
    trainerId: q.trainerId,
    from: q.from,
    to: q.to,
  });

  const cohortBatchIds = await batchIdsForCohort({ yearGroup: q.yearGroup, dept: q.dept });
  if (!cohortBatchIds) return base;
  // An empty cohort must match nothing, not everything.
  return andMatch(base, { batch: { $in: cohortBatchIds } });
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
 *  - trainer → only subjects they are staffed on (hard server-side scope; the
 *              client never supplies the filter)
 *
 * Everything a card needs is aggregated here rather than fetched per-card,
 * so the page is a single request no matter how many classes exist.
 */
export const classesOverview = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const role = resolveRole(req);

  // For a trainer, the card list is the subjects they're involved with (owned
  // or staffed via a batch). For admin, every class.
  let classFilter = { archivedAt: null };
  if (scopeTrainerId) {
    const involved = await trainerClassIds(scopeTrainerId, { role });
    if (!involved.length) return res.json({ classes: [] });
    classFilter = { archivedAt: null, _id: { $in: involved } };
  }
  const classes = await Class.find(classFilter)
    .populate('trainer', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  const ids = classes.map((c) => c._id);
  if (!ids.length) return res.json({ classes: [] });

  // Feedback figures are scoped to the mentor's own rosters, so a class's card
  // shows only the sessions they actually staffed.
  const fbScope = scopeTrainerId
    ? buildFeedbackMatch({ scopeTrainerId, role })
    : {};
  // Batch counts likewise: for a trainer, only batches where they staff the class.
  const batchTrainerMatch = scopeTrainerId
    ? {
        $or: [
          ...(role !== 'support' ? [{ 'classes.mainTrainers': scopeTrainerId }] : []),
          ...(role !== 'main' ? [{ 'classes.supportTrainers': scopeTrainerId }] : []),
        ],
      }
    : {};

  // Three grouped aggregations instead of N queries per class.
  const [fbStats, batchStats, paramTop] = await Promise.all([
    Feedback.aggregate([
      { $match: andMatch({ class: { $in: ids } }, fbScope) },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: '$class',
          avg: { $avg: '$ratings.stars' },
          feedbackIds: { $addToSet: '$_id' },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $project: { avg: 1, lastAt: 1, responses: { $size: '$feedbackIds' } } },
    ]),
    // A batch holds many { class, mainTrainers, supportTrainers } entries —
    // unwind so each class in scope is credited for the batches it appears in.
    // For a trainer, only the entries where THEY are staffed count.
    Batch.aggregate([
      {
        $match: andMatch(
          { 'classes.class': { $in: ids }, archivedAt: null },
          batchTrainerMatch
        ),
      },
      { $unwind: '$classes' },
      { $match: andMatch({ 'classes.class': { $in: ids } }, batchTrainerMatch) },
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
      { $match: andMatch({ class: { $in: ids } }, fbScope) },
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
  for (const row of paramTop) {
    const key = String(row._id.c);
    if (!byClassParams.has(key)) byClassParams.set(key, []);
    byClassParams.get(key).push({ label: labelById.get(String(row._id.p)) || '—', avg: row.avg });
  }

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
        average: r2(f?.avg),
        lastFeedbackAt: f?.lastAt || null,
        strongest: ps.length ? { label: ps[0].label, average: r2(ps[0].avg) } : null,
        weakest:
          ps.length > 1
            ? { label: ps[ps.length - 1].label, average: r2(ps[ps.length - 1].avg) }
            : null,
      };
    }),
  });
});

// GET /api/analytics/class/:classId
export const classAnalytics = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const klass = await Class.findById(req.params.classId).populate('trainer', 'name');
  if (!klass) throw notFound('Class not found');

  // Mentor isolation: a trainer may only read a subject they own or are staffed
  // on in some batch. The feedback shown is further scoped to their own rosters.
  if (scopeTrainerId) {
    const involved = await trainerClassIds(scopeTrainerId);
    if (!involved.some((id) => String(id) === String(klass._id))) {
      throw forbidden('You do not have access to this class.');
    }
  }

  const match = await resolveMatch(req, { scopeTrainerId, classId: klass._id });

  // Who currently staffs this subject, across live batches — so the class page
  // can name the mentor team rather than just a single catalog owner.
  const staffing = await Batch.find({ 'classes.class': klass._id, archivedAt: null })
    .populate({ path: 'classes.mainTrainers', select: 'name' })
    .populate({ path: 'classes.supportTrainers', select: 'name' })
    .select('name yearGroup classes status')
    .lean();

  const teams = staffing
    .map((b) => {
      const entry = (b.classes || []).find((e) => String(e.class) === String(klass._id));
      if (!entry) return null;
      if (scopeTrainerId && !staffs(entry, scopeTrainerId)) return null;
      return {
        batchId: String(b._id),
        batchName: b.name,
        yearGroup: b.yearGroup || '',
        status: b.status,
        ...shapeEntry(entry, scopeTrainerId),
      };
    })
    .filter(Boolean);

  /* The consolidated payload AND the divisions beneath it, in one response.
     Returning the whole breakdown means toggling between year groups in the UI
     is instant rather than a round trip per tab — and the headline figure is
     computed from the same stars as the divisions, so they can never disagree.
     The breakdown is deliberately NOT narrowed by a ?yearGroup= filter: it is
     the navigation, so it always lists every cohort the subject runs for. */
  const breakdown = await classYearGroupBreakdown({
    classId: klass._id,
    match: buildFeedbackMatch({
      scopeTrainerId,
      role: resolveRole(req),
      from: req.query.from,
      to: req.query.to,
    }),
    scopeTrainerId,
  });

  res.json({
    class: {
      id: String(klass._id),
      name: klass.name,
      description: klass.description || '',
      defaultTrainer: klass.trainer?.name || null,
    },
    teams,
    ...(await analyticsPayload(match)),
    // Subject → year group → batch. See classYearGroupBreakdown.
    breakdown,
    ...(scopeTrainerId
      ? { roleSplit: await roleSplitStats({ trainerId: scopeTrainerId, classId: klass._id }) }
      : {}),
  });
});

// GET /api/analytics/batch/:batchId
//
// Returns BOTH the batch-level aggregate (across every class in the batch) and
// a per-class breakdown — "batch feedback" and "separate class feedback" in one
// payload, which is the whole point of the batch-holds-many-classes model.
// A trainer sees only the classes they staff within the batch, and the batch
// aggregate is likewise restricted to those.
export const batchAnalytics = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const batch = await Batch.findById(req.params.batchId)
    .populate({ path: 'classes.class', select: 'name' })
    .populate({ path: 'classes.mainTrainers', select: 'name' })
    .populate({ path: 'classes.supportTrainers', select: 'name' });
  if (!batch) throw notFound('Batch not found');

  // A trainer only sees the classes in this batch that THEY staff.
  const visibleEntries = (batch.classes || []).filter(
    (e) => !scopeTrainerId || staffs(e, scopeTrainerId)
  );
  if (scopeTrainerId && visibleEntries.length === 0) {
    throw forbidden('You do not have access to this batch.');
  }

  // Batch-level aggregate (scoped to the trainer's own rosters for a trainer).
  const match = await resolveMatch(req, { scopeTrainerId, batchId: batch._id });

  // Per-class breakdown within this batch.
  const classesBreakdown = await Promise.all(
    visibleEntries.map(async (e) => {
      const classId = e.class?._id || e.class;
      const cMatch = buildFeedbackMatch({
        scopeTrainerId,
        role: resolveRole(req),
        batchId: batch._id,
        classId,
      });
      const [overall, perParameter] = await Promise.all([
        overallStats(cMatch),
        perParameterAverages(cMatch),
      ]);
      return {
        id: String(classId),
        name: e.class?.name || '—',
        ...shapeEntry(e, scopeTrainerId),
        ...overall,
        perParameter,
      };
    })
  );

  res.json({
    batch: {
      id: String(batch._id),
      name: batch.name,
      yearGroup: batch.yearGroup || '',
      dept: batch.dept || '',
      round: batch.round || 0,
      classes: visibleEntries.map((e) => shapeEntry(e, scopeTrainerId)),
      classCount: visibleEntries.length,
      submittedCount: batch.submittedCount,
      expectedCount: batch.expectedCount,
      status: batch.status,
    },
    classesBreakdown,
    ...(await analyticsPayload(match)),
    ...(scopeTrainerId
      ? { roleSplit: await roleSplitStats({ trainerId: scopeTrainerId, batchId: batch._id }) }
      : {}),
  });
});

// GET /api/analytics/trainer/me  (trainer-scoped)
export const trainerAnalytics = asyncHandler(async (req, res) => {
  const match = await resolveMatch(req, { scopeTrainerId: req.user._id });
  const [payload, roleSplit] = await Promise.all([
    analyticsPayload(match),
    roleSplitStats({ trainerId: req.user._id }),
  ]);
  res.json({ ...payload, roleSplit });
});

/**
 * GET /api/analytics/trainer/batches  (trainer-scoped)
 *
 * The trainer's own batches as cards. A batch is included only if the trainer
 * staffs at least one of its classes; each card lists only THAT trainer's
 * classes, the role they hold on each, and their own feedback figures.
 */
export const trainerBatchesOverview = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const role = resolveRole(req);

  const staffFilters = [];
  if (role !== 'support') staffFilters.push({ 'classes.mainTrainers': me });
  if (role !== 'main') staffFilters.push({ 'classes.supportTrainers': me });

  const batches = await Batch.find({ archivedAt: null, $or: staffFilters })
    .populate({ path: 'classes.class', select: 'name' })
    .populate({ path: 'classes.mainTrainers', select: 'name' })
    .populate({ path: 'classes.supportTrainers', select: 'name' })
    .sort({ createdAt: -1 })
    .lean();

  const ids = batches.map((b) => b._id);
  // This trainer's own feedback stats per batch, split by role.
  const stats = ids.length
    ? await Feedback.aggregate([
        {
          $match: andMatch(
            { batch: { $in: ids } },
            buildFeedbackMatch({ scopeTrainerId: me, role })
          ),
        },
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

  res.json({
    batches: batches.map((b) => {
      const mine = (b.classes || []).filter((e) => staffs(e, me));
      const s = statBy.get(String(b._id));
      return {
        id: String(b._id),
        name: b.name,
        yearGroup: b.yearGroup || '',
        dept: b.dept || '',
        status: b.status,
        round: b.round || 0,
        classes: mine.map((e) => shapeEntry(e, me)),
        classCount: mine.length,
        // How this trainer is deployed on this batch — the Torii board's
        // main/support split, per cohort.
        mainClassCount: mine.filter((e) => rolesOn(e, me).includes('main')).length,
        supportClassCount: mine.filter((e) => rolesOn(e, me).includes('support')).length,
        submittedCount: b.submittedCount,
        expectedCount: b.expectedCount,
        responses: s?.responses || 0,
        average: r2(s?.avg),
        lastFeedbackAt: s?.last || null,
        openedAt: b.openedAt,
        createdAt: b.createdAt,
      };
    }),
  });
});

/**
 * GET /api/analytics/trainers  (admin only)
 * Every mentor ranked on the same parameters, with their main/support split.
 */
export const trainersComparison = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('Admins only.');
  res.json(await trainerComparison({ role: resolveRole(req) }));
});

/**
 * GET /api/analytics/themes   ?classId=&batchId=&trainerId=&role=&yearGroup=
 * Recurring words/phrases in comments, each with the average rating of the
 * responses that mention it. Role-scoped like every other analytics route.
 */
export const themes = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const match = await resolveMatch(req, { scopeTrainerId });
  res.json(await commentThemes(match));
});

/**
 * GET /api/analytics/deltas   ?days=30&classId=&batchId=&trainerId=
 * Current period vs the period immediately before it.
 */
export const deltas = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '30', 10)));
  const match = await resolveMatch(req, { scopeTrainerId });
  res.json(await periodDeltas(match, days));
});

/**
 * GET /api/analytics/comments   ?term=&batchId=&classId=&trainerId=&page=&limit=
 *
 * The comments behind a theme. Role-scoped like everything else: a trainer
 * drilling into "pace" sees only their own students' comments, never another
 * mentor's, even if the same word appears there.
 *
 * Paginated, and the keyword is matched in the database — so `total` is the
 * real number of matches rather than "matches within the newest 1000 rows",
 * which used to make the count on a theme chip disagree with the list under it.
 */
export const comments = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const match = await resolveMatch(req, { scopeTrainerId });

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
  const data = await commentsMatching(match, req.query.term, { page, limit });

  // Echo back the batch/class being viewed so the page can title itself
  // without a second round trip.
  let context = null;
  if (req.query.batchId) {
    const b = await Batch.findById(req.query.batchId).select('name yearGroup dept').lean();
    if (b) {
      // A batch spans many classes; if the drill-down is also class-filtered,
      // name that class so the page can title itself precisely.
      let className;
      if (req.query.classId) {
        const c = await Class.findById(req.query.classId).select('name').lean();
        className = c?.name;
      }
      context = {
        type: 'batch',
        id: String(b._id),
        name: b.name,
        yearGroup: b.yearGroup || '',
        className,
      };
    }
  } else if (req.query.classId) {
    const c = await Class.findById(req.query.classId).select('name').lean();
    if (c) context = { type: 'class', id: String(c._id), name: c.name };
  }

  res.json({ ...data, context });
});

/**
 * GET /api/analytics/cohorts  (admin)
 * Roll-up by year group — the view an institution head actually asks for
 * ("how is second year doing?") and which no per-class page answers.
 */
export const cohorts = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('Admins only.');

  const batches = await Batch.find({ archivedAt: null })
    .select('name yearGroup dept expectedCount submittedCount status')
    .lean();
  if (!batches.length) return res.json({ cohorts: [] });

  const rows = await Feedback.aggregate([
    { $group: { _id: '$batch', avg: { $avg: { $avg: '$ratings.stars' } }, responses: { $sum: 1 } } },
  ]);
  const statBy = new Map(rows.map((x) => [String(x._id), x]));

  const byGroup = new Map();
  for (const b of batches) {
    const key = b.yearGroup || 'Unassigned';
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        yearGroup: key,
        batches: 0,
        openBatches: 0,
        expected: 0,
        submitted: 0,
        responses: 0,
        avgSum: 0,
        avgN: 0,
      });
    }
    const g = byGroup.get(key);
    const s = statBy.get(String(b._id));
    g.batches += 1;
    if (b.status === 'open') g.openBatches += 1;
    g.expected += b.expectedCount || 0;
    g.submitted += b.submittedCount || 0;
    g.responses += s?.responses || 0;
    if (s?.avg) {
      g.avgSum += s.avg * (s.responses || 1);
      g.avgN += s.responses || 1;
    }
  }

  res.json({
    cohorts: [...byGroup.values()]
      .map((g) => ({
        yearGroup: g.yearGroup,
        batches: g.batches,
        openBatches: g.openBatches,
        expected: g.expected,
        submitted: g.submitted,
        responses: g.responses,
        average: g.avgN ? r2(g.avgSum / g.avgN) : 0,
        // Response rate against the expected cohort size — the number that
        // tells an admin whether a survey actually landed.
        responseRate: g.expected ? r2((g.submitted / g.expected) * 100, 1) : 0,
      }))
      .sort((a, b) => b.responses - a.responses),
  });
});

/**
 * GET /api/analytics/mentor-load  (admin)
 * The Torii board's workload matrix, from the feedback side: how many classes
 * each mentor delivers vs assists, and what each role scores.
 */
export const mentorLoad = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('Admins only.');

  const trainers = await User.find({ role: 'trainer', isActive: true })
    .select('name shortName email')
    .sort({ name: 1 })
    .lean();
  if (!trainers.length) return res.json({ mentors: [] });

  const [staffing, mainStats, supportStats] = await Promise.all([
    Batch.aggregate([
      { $match: { archivedAt: null } },
      { $unwind: '$classes' },
      {
        $facet: {
          main: [
            { $unwind: '$classes.mainTrainers' },
            { $group: { _id: '$classes.mainTrainers', classes: { $sum: 1 }, batches: { $addToSet: '$_id' } } },
            { $project: { classes: 1, batches: { $size: '$batches' } } },
          ],
          support: [
            { $unwind: '$classes.supportTrainers' },
            { $group: { _id: '$classes.supportTrainers', classes: { $sum: 1 }, batches: { $addToSet: '$_id' } } },
            { $project: { classes: 1, batches: { $size: '$batches' } } },
          ],
        },
      },
    ]),
    Feedback.aggregate([
      { $unwind: '$mainTrainers' },
      { $unwind: '$ratings' },
      { $group: { _id: '$mainTrainers', avg: { $avg: '$ratings.stars' }, ids: { $addToSet: '$_id' } } },
      { $project: { avg: 1, responses: { $size: '$ids' } } },
    ]),
    Feedback.aggregate([
      { $unwind: '$supportTrainers' },
      { $unwind: '$ratings' },
      { $group: { _id: '$supportTrainers', avg: { $avg: '$ratings.stars' }, ids: { $addToSet: '$_id' } } },
      { $project: { avg: 1, responses: { $size: '$ids' } } },
    ]),
  ]);

  const facet = staffing[0] || { main: [], support: [] };
  const mainLoad = new Map(facet.main.map((x) => [String(x._id), x]));
  const suppLoad = new Map(facet.support.map((x) => [String(x._id), x]));
  const mainScore = new Map(mainStats.map((x) => [String(x._id), x]));
  const suppScore = new Map(supportStats.map((x) => [String(x._id), x]));

  res.json({
    mentors: trainers.map((t) => {
      const id = String(t._id);
      const ml = mainLoad.get(id) || { classes: 0, batches: 0 };
      const sl = suppLoad.get(id) || { classes: 0, batches: 0 };
      const ms = mainScore.get(id);
      const ss = suppScore.get(id);
      return {
        id,
        name: t.name,
        shortName: t.shortName || '',
        email: t.email,
        asMain: {
          classes: ml.classes,
          batches: ml.batches,
          responses: ms?.responses || 0,
          average: r2(ms?.avg),
        },
        asSupport: {
          classes: sl.classes,
          batches: sl.batches,
          responses: ss?.responses || 0,
          average: r2(ss?.avg),
        },
        totalClasses: ml.classes + sl.classes,
        // "Unassigned" is a real state worth surfacing: the Torii board has
        // several mentors on the roster with no sessions yet.
        deployment:
          ml.classes && sl.classes
            ? 'Main + Support'
            : ml.classes
              ? 'Main'
              : sl.classes
                ? 'Support'
                : 'Unassigned',
      };
    }),
  });
});

/** GET /api/analytics/role-split (trainer) — my figures as main vs as support. */
export const myRoleSplit = asyncHandler(async (req, res) => {
  if (req.user.role !== 'trainer') throw badRequest('Trainers only.', 'TRAINER_ONLY');
  res.json(await roleSplitStats({ trainerId: req.user._id, from: req.query.from, to: req.query.to }));
});

/**
 * GET /api/analytics/sessions   ?yearGroup=&classId=&role=&from=&to=
 *
 * One card per SESSION — a (batch, class) pair. This is the grain feedback is
 * actually read at: "Industry Readiness 1" is four separate second-year batches
 * with different mentors, and one number covering all four belongs to nobody.
 *
 * Role-scoped server-side: a mentor gets only the sessions they are staffed on,
 * and the filter lists it returns describe only what they can see.
 */
export const sessions = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  const data = await sessionCards({
    scopeTrainerId,
    role: resolveRole(req),
    yearGroup: req.query.yearGroup || undefined,
    classId: req.query.classId || undefined,
    from: req.query.from,
    to: req.query.to,
  });
  res.json(data);
});

/**
 * GET /api/analytics/years
 *
 * The year-group cards that open the catalog: how many batches and students
 * each year has, what subjects it takes, and how much feedback has come in.
 * Deliberately NOT a list of subjects — seven subjects belong to four distinct
 * student populations, and "how is C Programming doing?" only means anything
 * once you say which year.
 */
export const years = asyncHandler(async (req, res) => {
  const { scopeTrainerId } = resolveScope(req);
  res.json({ years: await yearGroupCards({ scopeTrainerId }) });
});
