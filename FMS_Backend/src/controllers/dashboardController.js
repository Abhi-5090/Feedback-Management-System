import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Phase } from '../models/Phase.js';
import {
  commentTotal,
  trainerClassIds,
  trainerSessionPairs,
  buildScopedMatch,
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
import {
  ratingDistribution,
  parameterBySubject,
  sessionRanking,
  commentDepth,
  collectionHealth,
  coverageTotals,
} from '../services/dashboardStatsService.js';

/** Shared filter resolution for both dashboards. */
async function dashboardMatch(req, scopeTrainerId) {
  const { class: classId, batch: batchId, trainer: trainerId, yearGroup, dept, phase, from, to } = req.query;
  const role = ['main', 'support'].includes(req.query.role) ? req.query.role : undefined;

  const base = await buildScopedMatch({
    scopeTrainerId,
    classId,
    batchId,
    phase,
    trainerId,
    role,
    from,
    to,
  });
  const cohortIds = await batchIdsForCohort({ yearGroup, dept });
  return cohortIds ? andMatch(base, { batch: { $in: cohortIds } }) : base;
}


/**
 * Resolve ?phase= into the Phase document the panels need.
 *
 * Returns null for "overall" and the literal 'unassigned' for feedback
 * belonging to no exercise — both are real selections, not absences.
 * `isCurrent` says whether this phase is the one that would claim a submission
 * made right now, which is what lets an open cohort appear in its collection
 * before it has any responses.
 */
async function resolvePhase(req) {
  const raw = req.query.phase;
  if (!raw) return { phase: null, phaseIsCurrent: false };
  if (raw === 'unassigned') return { phase: 'unassigned', phaseIsCurrent: false };
  if (!mongoose.Types.ObjectId.isValid(String(raw))) {
    // buildScopedMatch raises the 400 for a malformed id; don't double-report.
    return { phase: null, phaseIsCurrent: false };
  }
  const phase = await Phase.findById(raw);
  if (!phase) return { phase: null, phaseIsCurrent: false };
  return { phase, phaseIsCurrent: phase.isCollecting() };
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
    distribution,
    heatmap,
    ranking,
    commentStats,
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
    ratingDistribution(match),
    parameterBySubject(match),
    sessionRanking(match),
    commentDepth(match),
  ]);

  /* Phase-aware, and the single source for both the headline rate and the
     per-cohort panel — see coverageTotals on why those must not be two
     separate computations. */
  const { phase, phaseIsCurrent } = await resolvePhase(req);
  const health = await collectionHealth({ phase, phaseIsCurrent });
  const cov = coverageTotals(health);

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
      responseRate: cov.responseRate,
    },
    charts: { perParameter, trend, volumePerClass: volume },
    /* The analytical half of the page: how the stars are spread, where a
       weakness actually sits, which sessions stand out, and how far the
       collection can be trusted. */
    stats: { distribution, heatmap, ranking, comments: commentStats, health },
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
    distribution,
    heatmap,
    ranking,
    commentStats,
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
    ratingDistribution(match),
    parameterBySubject(match),
    sessionRanking(match),
    commentDepth(match),
  ]);

  /* Collection health reads Batch directly rather than through `match`, so it
     has to be told the mentor's batches explicitly — otherwise it would report
     turnout for cohorts they are not on. */
  const myPairs = await trainerSessionPairs(scopeTrainerId);
  const { phase, phaseIsCurrent } = await resolvePhase(req);
  const health = await collectionHealth({
    scopeBatchIds: [...new Set(myPairs.map((p) => String(p.batch)))].map(
      (id) => new mongoose.Types.ObjectId(id)
    ),
    phase,
    phaseIsCurrent,
  });

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
    stats: { distribution, heatmap, ranking, comments: commentStats, health },
    openBatchList,
    comments,
    commentTotal: totalComments,
    commentPageSize: 50,
  });
});
