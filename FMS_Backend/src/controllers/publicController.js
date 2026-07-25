import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { Parameter } from '../models/Parameter.js';
import { Feedback } from '../models/Feedback.js';
import { DeviceLock } from '../models/DeviceLock.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound, conflict, unauthorized } from '../utils/ApiError.js';
import { comparePasscode } from '../utils/password.js';
import { computeSignatureHash, issueDeviceToken } from '../utils/deviceSignature.js';
import { DEVICE_COOKIE, deviceCookieOptions } from '../utils/token.js';
import { supportsTransactions } from '../config/db.js';
import { env } from '../config/env.js';

const SESSION_PURPOSE = 'feedback-session';

/** Short-lived proof that the caller passed the passcode gate for this batch. */
function signPasscodeSession(batchId) {
  return jwt.sign({ batchId: String(batchId), purpose: SESSION_PURPOSE }, env.jwtSecret, {
    expiresIn: '2h',
  });
}
function verifyPasscodeSession(token, batchId) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    return payload.purpose === SESSION_PURPOSE && payload.batchId === String(batchId);
  } catch {
    return false;
  }
}

/**
 * POST /api/public/verify-passcode   { batchId, passcode }
 *
 * Layer 1 of the anti-duplicate model (the passcode gate). On success:
 *  - issues the first-party httpOnly device cookie (Layer 2 seed) if absent,
 *  - returns the active parameters to render the form,
 *  - returns a short-lived session token proving the gate was passed.
 */
export const verifyPasscode = asyncHandler(async (req, res) => {
  const { batchId, passcode } = req.body;
  const batch = await Batch.findById(batchId);
  if (!batch) throw notFound('Batch not found');
  if (batch.status !== 'open' || !batch.passcodeHash) {
    throw badRequest('This feedback window is closed.', 'WINDOW_CLOSED');
  }

  const ok = await comparePasscode(passcode, batch.passcodeHash);
  if (!ok) throw unauthorized('Incorrect passcode.');

  // Issue a device token cookie on first form load (Layer 2 seed).
  if (!req.cookies?.[DEVICE_COOKIE]) {
    res.cookie(DEVICE_COOKIE, issueDeviceToken(), deviceCookieOptions());
  }

  const parameters = await Parameter.find({ isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .select('label description order');

  // The classes the student will rate — one section per class, in batch order.
  // The trainer shown is the batch's EFFECTIVE trainer for that class (the
  // per-batch override, not necessarily the catalog owner). Surfaced so the
  // student knows who each class is about; NOT stored on the anonymous feedback.
  await batch.populate({ path: 'classes.trainer', select: 'name' });
  const classDocs = await Class.find({ _id: { $in: batch.classes.map((e) => e.class) } })
    .select('name description')
    .lean();
  const nameById = new Map(classDocs.map((c) => [String(c._id), c]));

  const classes = batch.classes.map((e) => {
    const c = nameById.get(String(e.class));
    return {
      id: String(e.class),
      name: c?.name || 'Class',
      description: c?.description || '',
      trainerName: e.trainer?.name || '',
    };
  });

  const full = batch.expectedCount > 0 && batch.submittedCount >= batch.expectedCount;

  res.json({
    ok: true,
    batchId: String(batch._id),
    batchName: batch.name,
    classes,
    parameters,
    full, // if the cap is already reached the client can show a friendly message
    sessionToken: signPasscodeSession(batch._id),
  });
});

/**
 * POST /api/public/feedback
 *   { batchId, classes: [{ classId, ratings[], comment }], fingerprint }
 * Header/body sessionToken from the verify step.
 *
 * A single submission covers EVERY class in the batch. It writes one Feedback
 * document per class plus one DeviceLock and one counter increment, all
 * ATOMICALLY — either the student's whole submission lands or none of it does.
 * The cap and the counter track STUDENTS, so the increment is +1 per
 * submission regardless of how many classes it contains.
 *
 * PRIVACY NOTE: this is a privacy-preserving *best-effort* uniqueness model.
 * No student identity is ever collected, so a determined user on a second
 * device could still submit twice; the three layers make that require effort,
 * bound it by the cap, and keep it visible to the admin. For hard guarantees,
 * see the "one-time token per seat" extension point noted at the bottom.
 */
export const submitFeedback = asyncHandler(async (req, res) => {
  const { batchId, classes: classBlocks, fingerprint } = req.body;
  const sessionToken =
    req.body.sessionToken || req.headers['x-feedback-session'] || null;

  // ── (1) Batch exists and is open ────────────────────────────────────────
  const batch = await Batch.findById(batchId);
  if (!batch) throw notFound('Batch not found');
  if (batch.status !== 'open') throw badRequest('This feedback window is closed.', 'WINDOW_CLOSED');

  // ── (2) Passcode session token valid ────────────────────────────────────
  if (!sessionToken || !verifyPasscodeSession(sessionToken, batchId)) {
    throw unauthorized('Your session expired. Please re-enter the passcode.');
  }

  // ── (3) The submitted classes are EXACTLY the batch's classes ───────────
  // Map each class to its effective trainer for this batch, so every Feedback
  // row can be stamped with who actually taught it.
  const trainerByClass = new Map(batch.classes.map((e) => [String(e.class), e.trainer]));
  const batchClassIds = new Set(trainerByClass.keys());
  const submittedClassIds = classBlocks.map((c) => String(c.classId));
  const submittedSet = new Set(submittedClassIds);
  const everyClassRated = [...batchClassIds].every((id) => submittedSet.has(id));
  const noUnknownClass = submittedClassIds.every((id) => batchClassIds.has(id));
  const noDuplicateClass = submittedSet.size === submittedClassIds.length;
  if (!everyClassRated || !noUnknownClass || !noDuplicateClass) {
    throw badRequest('Please rate every class in this batch exactly once.', 'INCOMPLETE_CLASSES');
  }

  // ── (4) Each class: a star (1–5) for EVERY active parameter, comment ≥10 ─
  const activeParams = await Parameter.find({ isActive: true }).select('_id').lean();
  const activeIds = new Set(activeParams.map((p) => String(p._id)));

  for (const block of classBlocks) {
    const ratedIds = new Set(block.ratings.map((r) => String(r.parameter)));
    const everyActiveRated = [...activeIds].every((id) => ratedIds.has(id));
    const noUnknownRated = [...ratedIds].every((id) => activeIds.has(id));
    if (!everyActiveRated || !noUnknownRated || ratedIds.size !== activeIds.size) {
      throw badRequest('Please rate every parameter for every class.', 'INCOMPLETE_RATINGS');
    }
    if (!block.comment || block.comment.trim().length < 10) {
      throw badRequest('Each class needs a comment of at least 10 characters.', 'COMMENT_REQUIRED');
    }
  }

  // ── (5) Device signature (Layer 2) — one lock per device per BATCH ──────
  const cookieToken = req.cookies?.[DEVICE_COOKIE] || '';
  const signatureHash = computeSignatureHash({ batchId, cookieToken, fingerprint });

  // Friendly pre-check (the unique index is the authoritative guard below).
  const already = await DeviceLock.findOne({ batch: batchId, signatureHash }).lean();
  if (already) throw conflict('Feedback already recorded for this device.', 'DEVICE_LOCKED');

  // ── (6) Cap not exceeded (friendly pre-check) ───────────────────────────
  if (batch.expectedCount > 0 && batch.submittedCount >= batch.expectedCount) {
    throw conflict('This batch has reached its expected number of responses.', 'CAP_REACHED');
  }

  // ── (7) Atomic write: DeviceLock + counter (+1 student) + N Feedback ─────
  const feedbackDocs = classBlocks.map((block) => ({
    batch: batch._id,
    class: block.classId,
    // Effective trainer for this class in this batch — the field trainer
    // isolation scopes on. Guaranteed present: step (3) verified every
    // submitted class is one of the batch's classes.
    trainer: trainerByClass.get(String(block.classId)),
    ratings: block.ratings.map((r) => ({ parameter: r.parameter, stars: r.stars })),
    comment: block.comment.trim(),
  }));

  const useTxn = supportsTransactions();
  const session = useTxn ? await mongoose.startSession() : null;

  try {
    if (useTxn) session.startTransaction();

    // Layer 2 authoritative guard: unique { batch, signatureHash }. A racing
    // duplicate throws E11000 → mapped to 409 below.
    await DeviceLock.create([{ batch: batch._id, signatureHash }], session ? { session } : {});

    // Layer 3 authoritative cap guard: conditional atomic increment. Only
    // succeeds while the batch is open AND (there is no cap OR
    // submittedCount < expectedCount), so concurrent submissions can never
    // overshoot the cap. `expectedCount <= 0` means "uncapped" — matched here
    // exactly as in the friendly pre-check above, so the two never disagree.
    // One increment per STUDENT submission, not per class.
    const updated = await Batch.findOneAndUpdate(
      {
        _id: batch._id,
        status: 'open',
        $expr: {
          $or: [
            { $lte: ['$expectedCount', 0] },
            { $lt: ['$submittedCount', '$expectedCount'] },
          ],
        },
      },
      { $inc: { submittedCount: 1 } },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!updated) {
      // Cap reached (or closed) between the pre-check and now.
      throw conflict('This batch has reached its expected number of responses.', 'CAP_REACHED');
    }

    // One Feedback per class. insertMany with ordered:true so a failure rolls
    // the whole submission back inside the transaction.
    await Feedback.insertMany(feedbackDocs, { ordered: true, ...(session ? { session } : {}) });

    if (useTxn) await session.commitTransaction();

    return res.status(201).json({
      ok: true,
      message: 'Thank you! Your feedback has been recorded.',
      classesRecorded: feedbackDocs.length,
      submittedCount: updated.submittedCount,
      expectedCount: updated.expectedCount,
    });
  } catch (err) {
    if (useTxn) await session.abortTransaction().catch(() => {});
    if (err.code === 11000) {
      throw conflict('Feedback already recorded for this device.', 'DEVICE_LOCKED');
    }
    throw err;
  } finally {
    if (session) await session.endSession();
  }
});

/*
 * ── EXTENSION POINT: strict "one-time token per seat" mode ─────────────────
 * To upgrade from best-effort to hard uniqueness, add a `SeatToken` collection
 * of N single-use codes generated at unlock (one per seat). verify-passcode
 * would consume a seat token instead of (or in addition to) the shared batch
 * passcode, and submit would mark it used inside this same transaction. The
 * DeviceLock/cap machinery above stays exactly as-is; only the gate changes.
 */
