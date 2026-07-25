import { User } from '../models/User.js';
import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { Feedback } from '../models/Feedback.js';
import { sendMail, digestEmail } from './emailService.js';
import { round } from './analyticsService.js';
import { env } from '../config/env.js';

/**
 * Scheduled email digests.
 *
 * Keeps the product in an admin's inbox instead of waiting to be visited —
 * which for a tool used weekly rather than daily is the difference between
 * being renewed and being forgotten.
 *
 * Implemented with a plain interval rather than a cron dependency: the schedule
 * is "once a day, send anything due", which needs no cron expression parsing.
 * The interval ticks hourly and each recipient is sent at most one digest per
 * period, tracked on the user document — so a restart, a redeploy, or two app
 * instances racing cannot produce duplicate mail.
 */

const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 };

/** Build the digest payload for one recipient. */
async function buildDigest(user, days) {
  const since = new Date(Date.now() - days * 86400_000);

  // Admins see everything; trainers see only feedback they were the effective
  // trainer for (honours per-batch overrides).
  const scopeTrainerId = user.role === 'admin' ? null : user._id;
  const match = { createdAt: { $gte: since } };
  if (scopeTrainerId) match.trainer = scopeTrainerId;

  const [agg] = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    { $group: { _id: null, avg: { $avg: '$ratings.stars' }, ids: { $addToSet: '$_id' } } },
    { $project: { avg: 1, responses: { $size: '$ids' } } },
  ]);

  const perClass = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    { $group: { _id: '$class', avg: { $avg: '$ratings.stars' }, ids: { $addToSet: '$_id' } } },
    { $project: { avg: 1, responses: { $size: '$ids' } } },
    { $sort: { responses: -1 } },
    { $limit: 5 },
  ]);

  const classes = await Class.find({ _id: { $in: perClass.map((p) => p._id) } })
    .select('name')
    .lean();
  const nameById = new Map(classes.map((c) => [String(c._id), c.name]));

  const openFilter = { status: 'open', archivedAt: null };
  // A batch is "open for this trainer" if they teach at least one of its classes.
  if (scopeTrainerId) openFilter['classes.trainer'] = scopeTrainerId;
  const openBatches = await Batch.countDocuments(openFilter);

  const responses = agg?.responses || 0;

  // Nothing happened and nothing is live — sending "0 responses" every week is
  // how a digest becomes the thing people filter to spam.
  if (responses === 0 && openBatches === 0) return null;

  return {
    responses,
    average: agg ? round(agg.avg, 2) : null,
    openBatches,
    topClasses: perClass.map((p) => ({
      name: nameById.get(String(p._id)) || 'Unknown class',
      responses: p.responses,
      average: round(p.avg, 2),
    })),
  };
}

/** Send any digests that are due. Safe to call repeatedly. */
export async function runDigests({ force = false } = {}) {
  const recipients = await User.find({
    isActive: true,
    'digest.enabled': true,
  }).lean();

  const results = { considered: recipients.length, sent: 0, skipped: 0 };

  for (const user of recipients) {
    const frequency = user.digest?.frequency || 'weekly';
    const days = PERIOD_DAYS[frequency] || 7;

    // Due only if we've never sent, or a full period has elapsed.
    const last = user.digest?.lastSentAt ? new Date(user.digest.lastSentAt) : null;
    const due = force || !last || Date.now() - last.getTime() >= days * 86400_000;
    if (!due) {
      results.skipped++;
      continue;
    }

    const stats = await buildDigest(user, days);
    if (!stats) {
      // Nothing to report — record the attempt so we don't retry hourly.
      await User.updateOne({ _id: user._id }, { 'digest.lastSentAt': new Date() });
      results.skipped++;
      continue;
    }

    const mail = digestEmail({
      name: user.name,
      period: frequency,
      stats,
      topClasses: stats.topClasses,
      appUrl: `${env.appUrl}/${user.role === 'admin' ? 'admin' : 'trainer'}`,
    });
    const r = await sendMail({ to: user.email, ...mail });

    // Stamp regardless of delivery outcome: a bouncing address must not cause
    // an infinite retry loop every hour.
    await User.updateOne({ _id: user._id }, { 'digest.lastSentAt': new Date() });
    if (r.ok) results.sent++;
  }

  return results;
}

let timer = null;

/** Start the hourly scheduler. No-op under test. */
export function startDigestScheduler() {
  if (timer || env.nodeEnv === 'test' || !env.digestsEnabled) return;

  const tick = async () => {
    try {
      const r = await runDigests();
      if (r.sent) console.log(`[digest] sent ${r.sent} of ${r.considered}`);
    } catch (err) {
      console.error('[digest] run failed:', err.message);
    }
  };

  // Every hour; `runDigests` decides what is actually due.
  timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.(); // never hold the process open just for the scheduler
  console.log('[digest] scheduler started (hourly check)');
}

export function stopDigestScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
