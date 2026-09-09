import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import {
  commentTotal,
  trainerClassIds,
  buildFeedbackMatch,
  batchIdsForCohort,
  andMatch,
  perParameterAverages,
  overallStats,
  roleSplitStats,
  trendOverTime,
  volumePerClass,
  recentComments,
  openBatches,
} from '../services/analyticsService.js';

/** Shared filter resolution for both dashboards. */
async function dashboardMatch(req, scopeTrainerId) {
  const { class: classId, batch: batchId, trainer: trainerId, yearGroup, dept, from, to } = req.query;
  const role = ['main', 'support'].includes(req.query.role) ? req.query.role : undefined;

  const base = buildFeedbackMatch({
    scopeTrainerId,
    classId,
    batchId,
    trainerId,
    role,
    from,
    to,
  });
  const cohortIds = await batchIdsForCohort({ yearGroup, dept });
  return cohortIds ? andMatch(base, { batch: { $in: cohortIds } }) : base;
}

// GET /api/dashboard/admin — whole-system KPIs + chart series.
// Supports ?class= / ?batch= / ?trainer= / ?role= / ?yearGroup= / ?dept= /
// ?from= / ?to= filters that drive every widget.
export const adminDashboard = asyncHandler(async (req, res) => {
  const match = await dashboardMatch(req, null);

  const [
    trainers,
    classes,
    batches,
    openBatchCount,
    overall,
    perParameter,
    trend,
    volume,
    comments,
    totalComments,
    openBatchList,
    coverage,
  ] = await Promise.all([
    User.countDocuments({ role: 'trainer', isActive: true }),
    Class.countDocuments({ archivedAt: null }),
    Batch.countDocuments({ archivedAt: null }),
    Batch.countDocuments({ status: 'open', archivedAt: null }),
    overallStats(match),
    perParameterAverages(match),
    trendOverTime(match),
    volumePerClass(match),
    recentComments(match, 50),
    commentTotal(match),
    openBatches({}),
    /* Institution-wide response coverage: how much of the expected cohort has
       actually answered. A raw feedback count says nothing about whether a
       survey landed; 812/1740 does.

       `submitted` is DERIVED from the feedback rows rather than summed from
       Batch.submittedCount. That counter exists to enforce the cap atomically
       during collection and is a denormalised copy of the truth — delete
       feedback directly in the database and it keeps claiming submissions that
       no longer exist, which is exactly how this dashboard came to report a
       response rate for cohorts with zero responses. Within one batch every
       student answers each subject once, so the number who answered is the MAX
       row count across its classes. */
    Batch.aggregate([
      { $match: { archivedAt: null, expectedCount: { $gt: 0 } } },
      {
        $lookup: {
          from: 'feedbacks',
          localField: '_id',
          foreignField: 'batch',
          as: 'rows',
          pipeline: [{ $group: { _id: '$class', n: { $sum: 1 } } }],
        },
      },
      {
        $project: {
          expectedCount: 1,
          answered: { $max: { $ifNull: [{ $map: { input: '$rows', as: 'r', in: '$$r.n' } }, [0]] } },
        },
      },
      {
        $group: {
          _id: null,
          expected: { $sum: '$expectedCount' },
          submitted: { $sum: { $ifNull: ['$answered', 0] } },
        },
      },
    ]),
  ]);

  const cov = coverage[0] || { expected: 0, submitted: 0 };

  res.json({
    kpis: {
      trainers,
      classes,
      batches,
      openBatches: openBatchCount,
      feedbackCount: overall.feedbackCount,
      overallAverage: overall.overallAverage,
      expectedResponses: cov.expected,
      submittedResponses: cov.submitted,
      responseRate: cov.expected
        ? Math.round((cov.submitted / cov.expected) * 1000) / 10
        : 0,
    },
    charts: { perParameter, trend, volumePerClass: volume },
    openBatchList,
    comments,
    // The page is 50; this says how many exist so the feed can offer the rest.
    commentTotal: totalComments,
    commentPageSize: 50,
  });
});

// GET /api/dashboard/trainer/me — the same shape, hard-scoped to the trainer.
export const trainerDashboard = asyncHandler(async (req, res) => {
  const scopeTrainerId = req.user._id;
  const match = await dashboardMatch(req, scopeTrainerId);

  const [
    myClasses,
    myBatches,
    mainClasses,
    supportClasses,
    overall,
    perParameter,
    trend,
    volume,
    comments,
    totalComments,
    openBatchList,
    roleSplit,
  ] = await Promise.all([
    // Subjects the mentor is involved with (owned or staffed in any batch).
    trainerClassIds(scopeTrainerId).then((ids) => ids.length),
    // Batches where the mentor staffs at least one class, either role.
    Batch.countDocuments({
      archivedAt: null,
      $or: [
        { 'classes.mainTrainers': scopeTrainerId },
        { 'classes.supportTrainers': scopeTrainerId },
      ],
    }),
    trainerClassIds(scopeTrainerId, { role: 'main' }).then((ids) => ids.length),
    trainerClassIds(scopeTrainerId, { role: 'support' }).then((ids) => ids.length),
    overallStats(match),
    perParameterAverages(match),
    trendOverTime(match),
    volumePerClass(match),
    recentComments(match, 50),
    commentTotal(match),
    openBatches({ scopeTrainerId }),
    roleSplitStats({ trainerId: scopeTrainerId }),
  ]);

  res.json({
    kpis: {
      myClasses,
      myBatches,
      // The main/support split is the headline for a mentor: "you deliver 3
      // subjects and assist on 5" is their actual week.
      mainClasses,
      supportClasses,
      feedbackCount: overall.feedbackCount,
      overallAverage: overall.overallAverage,
    },
    roleSplit,
    charts: { perParameter, trend, volumePerClass: volume },
    openBatchList,
    comments,
    commentTotal: totalComments,
    commentPageSize: 50,
  });
});
