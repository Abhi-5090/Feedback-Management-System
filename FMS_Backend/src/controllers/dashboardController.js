import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import {
  trainerClassIds,
  buildFeedbackMatch,
  perParameterAverages,
  overallStats,
  trendOverTime,
  volumePerClass,
  recentComments,
  openBatches,
} from '../services/analyticsService.js';

// GET /api/dashboard/admin — whole-system KPIs + chart series.
// Supports optional ?class= / ?batch= / ?trainer= filters that drive every widget.
export const adminDashboard = asyncHandler(async (req, res) => {
  const { class: classId, batch: batchId, trainer: trainerId } = req.query;
  const match = await buildFeedbackMatch({ classId, batchId, trainerId });

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
    openBatchList,
  ] = await Promise.all([
    User.countDocuments({ role: 'trainer' }),
    Class.countDocuments(),
    Batch.countDocuments(),
    Batch.countDocuments({ status: 'open' }),
    overallStats(match),
    perParameterAverages(match),
    trendOverTime(match),
    volumePerClass(match),
    recentComments(match, 25),
    openBatches({}),
  ]);

  res.json({
    kpis: {
      trainers,
      classes,
      batches,
      openBatches: openBatchCount,
      feedbackCount: overall.feedbackCount,
      overallAverage: overall.overallAverage,
    },
    charts: { perParameter, trend, volumePerClass: volume },
    openBatchList,
    comments,
  });
});

// GET /api/dashboard/trainer/me — the same shape, hard-scoped to the trainer.
export const trainerDashboard = asyncHandler(async (req, res) => {
  const scopeTrainerId = req.user._id;
  const { batch: batchId } = req.query;
  const match = buildFeedbackMatch({ scopeTrainerId, batchId });

  const [myClasses, myBatches, overall, perParameter, trend, volume, comments, openBatchList] =
    await Promise.all([
      // Classes the trainer is involved with (owned or taught via a batch override).
      trainerClassIds(scopeTrainerId).then((ids) => ids.length),
      // Batches where the trainer teaches at least one class.
      Batch.countDocuments({ 'classes.trainer': scopeTrainerId, archivedAt: null }),
      overallStats(match),
      perParameterAverages(match),
      trendOverTime(match),
      volumePerClass(match),
      recentComments(match, 25),
      openBatches({ scopeTrainerId }),
    ]);

  res.json({
    kpis: {
      myClasses,
      myBatches,
      feedbackCount: overall.feedbackCount,
      overallAverage: overall.overallAverage,
    },
    charts: { perParameter, trend, volumePerClass: volume },
    openBatchList,
    comments,
  });
});
