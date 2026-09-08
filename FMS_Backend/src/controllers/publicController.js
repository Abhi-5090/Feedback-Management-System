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
import {
  computeSignatureHash,
  issueDeviceToken,
  hasReliableDeviceToken,
} from '../utils/deviceSignature.js';
import { DEVICE_COOKIE, deviceCookieOptions } from '../utils/token.js';
import { supportsTransactions } from '../config/db.js';
import { env } from '../config/env.js';
import { getActiveParameters } from '../services/parameterCache.js';

const SESSION_PURPOSE = 'feedback-session';

/**
 * Short-lived proof that the caller passed the passcode gate for this batch.
 *
 * The token PINS the form the student was actually shown: the batch, the
 * collection round, and the exact parameter ids rendered. Submission validates
 * against this pinned set rather than against whatever is active now, which
 * fixes a real failure mode — an admin deactivating a parameter mid-window used
 * to make every in-flight student's submission fail with INCOMPLETE_RATINGS and
 * lose their answers, through no fault of their own.
 */
function signPasscodeSession(batch, parameterIds) {
  return jwt.sign(
    {
      batchId: String(batch._id),
      round: batch.round || 0,
      params: parameterIds.map(String),
      purpose: SESSION_PURPOSE,
    },
    env.jwtSecret,
    { expiresIn: '3h' }
  );
}

/** Decode and check a session token; returns the payload or null. */
function readPasscodeSession(token, batchId) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.purpose !== SESSION_PURPOSE) return null;
    if (payload.batchId !== String(batchId)) return null;
    if (!Array.isArray(payload.params) || payload.params.length === 0) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * POST /api/public/verify-passcode   { batchId, passcode }
 *
 * Layer 1 of the anti-duplicate model (the passcode gate). On success:
 *  - issues the first-party httpOnly device cookie (Layer 2 seed) if absent,
 *  - returns the active parameters to render the form,
 *  - returns a short-lived session token pinning batch + round + parameters.
 */
export const verifyPasscode = asyncHandler(async (req, res) => {
  const { batchId, passcode } = req.body;
  const batch = await Batch.findById(batchId);
  if (!batch) throw notFound('Batch not found');
  if (batch.archivedAt) throw badRequest('This feedback window is closed.', 'WINDOW_CLOSED');
  if (batch.status !== 'open' || !batch.passcodeHash) {
    throw badRequest('This feedback window is closed.', 'WINDOW_CLOSED');
  }

  /* Issue the device token BEFORE checking the passcode, not after.
     Two reasons, both practical:
       - Rate limiting. The per-device budget can only apply once a browser has
         a cookie; issuing it only on success means every failed attempt — and
         every student's first request — is counted against the shared per-IP
         bucket instead of their own.
       - Brute force. Someone guessing passcodes never succeeded, so under the
         old order they never received a cookie and were never subject to the
         per-device limit at all.
     The token is an opaque random value that grants nothing on its own; it only
     becomes meaningful when combined server-side with the batch, round and
     secret salt. Handing one to an unauthenticated caller is safe. */
  if (!req.cookies?.[DEVICE_COOKIE]) {
    res.cookie(DEVICE_COOKIE, issueDeviceToken(), deviceCookieOptions());
  }

  const ok = await comparePasscode(passcode, batch.passcodeHash);
  if (!ok) throw unauthorized('Incorrect passcode.');

  // Cached: the same eight documents for every student in the cohort.
  const parameters = await getActiveParameters();
  if (parameters.length === 0) {
    throw badRequest(
      'This feedback form has no rating parameters configured yet.',
      'NO_PARAMETERS'
    );
  }

  // The classes the student will rate — one section per class, in batch order.
  // The mentors shown are the batch's EFFECTIVE rosters for that class. Surfaced
  // so the student knows who each class is about; NOT stored on the anonymous
  // feedback (the rosters ARE stored, but they describe the session, not the
  // respondent).
  await batch.populate([
    { path: 'classes.mainTrainers', select: 'name' },
    { path: 'classes.supportTrainers', select: 'name' },
  ]);
  const classDocs = await Class.find({ _id: { $in: batch.classes.map((e) => e.class) } })
    .select('name description')
    .lean();
  const byId = new Map(classDocs.map((c) => [String(c._id), c]));

  const classes = batch.classes.map((e) => {
    const c = byId.get(String(e.class));
    return {
      id: String(e.class),
      name: c?.name || 'Class',
      description: c?.description || '',
      mainMentors: (e.mainTrainers || []).map((t) => t?.name).filter(Boolean),
      supportMentors: (e.supportTrainers || []).map((t) => t?.name).filter(Boolean),
    };
  });

  const full = batch.expectedCount > 0 && batch.submittedCount >= batch.expectedCount;

  res.json({
    ok: true,
    batchId: String(batch._id),
    batchName: batch.name,
    yearGroup: batch.yearGroup || '',
    dept: batch.dept || '',
    round: batch.round || 0,
    classes,
    parameters,
    full, // if the cap is already reached the client can show a friendly message
    sessionToken: signPasscodeSession(batch, parameters.map((p) => p._id)),
  });
});

/**
 * POST /api/public/feedback
 *   { batchId, classes: [{ classId, ratings[], comment }], fingerprint }
 * Header/body sessionToken from the verify step.
 *
 * A single submission covers EVERY class in the batch: one Feedback document
 * per class, one DeviceLock, and one increment of the batch counter. The cap
 * and the counter track STUDENTS, so the increment is +1 per submission
 * regardless of how many classes it contains.
 *
 * The write is deliberately in TWO stages (see below): the shared counter is
 * claimed with a single atomic update outside any transaction, then this
 * student's own documents are written inside one. Putting the counter in the
 * transaction is what made a cohort-sized burst livelock on WriteConflict.
 * If the second stage fails the slot is handed back, so the only cost of a
 * crash between them is one unused seat — never a lost or duplicated response.
 *
 * PRIVACY NOTE: this is a privacy-preserving *best-effort* uniqueness model.
 * No student identity is ever collected, so a determined user on a second
 * device could still submit twice; the three layers make that require effort,
 * bound it by the cap, and keep it visible to the admin. For hard guarantees,
 * see the "one-time token per seat" extension point noted at the bottom.
 */
export const submitFeedback = asyncHandler(async (req, res) => {
  const { batchId, classes: classBlocks, fingerprint } = req.body;
  const sessionToken = req.body.sessionToken || req.headers['x-feedback-session'] || null;

  // ── (1) Batch exists and is open ────────────────────────────────────────
  const batch = await Batch.findById(batchId);
  if (!batch) throw notFound('Batch not found');
  if (batch.status !== 'open' || batch.archivedAt) {
    throw badRequest('This feedback window is closed.', 'WINDOW_CLOSED');
  }

  // ── (2) Passcode session token valid ────────────────────────────────────
  const session = sessionToken ? readPasscodeSession(sessionToken, batchId) : null;
  if (!session) {
    throw unauthorized('Your session expired. Please re-enter the passcode.', 'SESSION_EXPIRED');
  }
  // A session minted for an earlier collection round must not submit into the
  // current one: the form it described (and the cohort it belonged to) is gone.
  if ((session.round || 0) !== (batch.round || 0)) {
    throw unauthorized(
      'This feedback window has been reopened. Please re-enter the passcode.',
      'ROUND_CHANGED'
    );
  }

  // ── (3) The submitted classes are EXACTLY the batch's classes ───────────
  // Map each class to its effective rosters for this batch, so every Feedback
  // row can be stamped with who actually taught and who assisted.
  const staffByClass = new Map(
    batch.classes.map((e) => [
      String(e.class),
      {
        mainTrainers: (e.mainTrainers || []).map((t) => String(t?._id || t)),
        supportTrainers: (e.supportTrainers || []).map((t) => String(t?._id || t)),
      },
    ])
  );
  const batchClassIds = new Set(staffByClass.keys());
  const submittedClassIds = classBlocks.map((c) => String(c.classId));
  const submittedSet = new Set(submittedClassIds);
  const everyClassRated = [...batchClassIds].every((id) => submittedSet.has(id));
  const noUnknownClass = submittedClassIds.every((id) => batchClassIds.has(id));
  const noDuplicateClass = submittedSet.size === submittedClassIds.length;
  if (!everyClassRated || !noUnknownClass || !noDuplicateClass) {
    throw badRequest('Please rate every class in this batch exactly once.', 'INCOMPLETE_CLASSES');
  }

  // ── (4) Each class: a star (1–5) for EVERY PINNED parameter, comment ≥10 ─
  // Validated against the parameter set issued at verify time (session.params),
  // not the currently-active set. An admin toggling a parameter mid-window is
  // an admin action; it must not invalidate a student's half-filled form.
  const pinnedIds = new Set(session.params.map(String));
  for (const block of classBlocks) {
    const ratedIds = new Set(block.ratings.map((r) => String(r.parameter)));
    const everyPinnedRated = [...pinnedIds].every((id) => ratedIds.has(id));
    const noUnknownRated = [...ratedIds].every((id) => pinnedIds.has(id));
    if (!everyPinnedRated || !noUnknownRated || ratedIds.size !== pinnedIds.size) {
      throw badRequest('Please rate every parameter for every class.', 'INCOMPLETE_RATINGS');
    }
    if (!block.comment || block.comment.trim().length < 10) {
      throw badRequest('Each class needs a comment of at least 10 characters.', 'COMMENT_REQUIRED');
    }
  }
  /* The pinned parameters must still EXIST — a hard-deleted one would leave
     ratings pointing at nothing and break every label lookup later.
     (Deactivation is a soft delete, so the normal case is satisfied by the
     cached active list without touching the database at all; only the rare
     case where a pinned id is NOT currently active needs a real lookup.) */
  const activeNow = new Set((await getActiveParameters()).map((p) => String(p._id)));
  const unaccounted = [...pinnedIds].filter((id) => !activeNow.has(id));
  if (unaccounted.length) {
    const stillExist = await Parameter.countDocuments({ _id: { $in: unaccounted } });
    if (stillExist !== unaccounted.length) {
      throw badRequest(
        'This form is out of date. Please reload and re-enter the passcode.',
        'STALE_FORM'
      );
    }
  }

  // ── (5) Device signature (Layer 2) — one lock per device per BATCH+ROUND ─
  const cookieToken = req.cookies?.[DEVICE_COOKIE] || '';
  const deviceReliable = hasReliableDeviceToken(cookieToken);
  const signatureHash = computeSignatureHash({
    batchId,
    round: batch.round || 0,
    cookieToken,
    fingerprint,
  });

  /* With no first-party cookie the signature collapses to the coarse
     fingerprint alone, which is NOT unique across a lab of identical machines.
     Enforcing it there rejects genuinely different students as duplicates and
     silently drops real responses, so the lock is skipped and the passcode gate
     plus the live cap carry the load. This is recorded on the response so an
     admin can see that a submission arrived unlocked. */
  /* No pre-check for an existing lock. The unique { batch, signatureHash }
     index is the authoritative guard and returns exactly the same 409 through
     the E11000 path below, so a lookup here only bought a marginally tidier
     code path — at the cost of one database round trip on EVERY submission,
     including the overwhelming majority that are not duplicates. During a
     cohort burst that is hundreds of round trips spent to speed up the error
     case at the expense of the success case. */

  // ── (6) Cap not exceeded (friendly pre-check) ───────────────────────────
  if (batch.expectedCount > 0 && batch.submittedCount >= batch.expectedCount) {
    throw conflict('This batch has reached its expected number of responses.', 'CAP_REACHED');
  }

  // ── (7) Atomic write: DeviceLock + counter (+1 student) + N Feedback ─────
  const feedbackDocs = classBlocks.map((block) => {
    const staff = staffByClass.get(String(block.classId));
    return {
      batch: batch._id,
      class: block.classId,
      // Effective rosters for this class in this batch — the fields isolation
      // and role-split analytics scope on. Guaranteed present: step (3)
      // verified every submitted class is one of the batch's classes, and the
      // Batch schema guarantees at least one main mentor per entry.
      mainTrainers: staff.mainTrainers,
      supportTrainers: staff.supportTrainers,
      round: batch.round || 0,
      ratings: block.ratings.map((r) => ({ parameter: r.parameter, stars: r.stars })),
      comment: block.comment.trim(),
    };
  });

  const useTxn = supportsTransactions();

  /* ── (7a) CLAIM A SLOT — a single atomic update, OUTSIDE any transaction ──
   *
   * This is the one write every student contends on, and it must not sit
   * inside a transaction. A transaction takes a document-level write lock and
   * aborts its rivals with WriteConflict (112), which the application then has
   * to retry over a network round trip — so 300 students arriving together
   * livelock. Measured on the real cluster: 1/300 succeeded without retries,
   * 25/300 with them.
   *
   * A bare `findOneAndUpdate` on one document behaves completely differently.
   * WiredTiger resolves contention internally, in microseconds, without
   * surfacing a conflict — this is the ordinary way to run a counter, and it
   * scales to the whole cohort.
   *
   * The condition is unchanged, so the cap is still exact and can never be
   * overshot however concurrent the submissions: the update only matches while
   * the batch is open, on this round, and under the cap.
   */
  const claimed = await Batch.findOneAndUpdate(
    {
      _id: batch._id,
      status: 'open',
      round: batch.round || 0,
      $expr: {
        $or: [
          { $lte: ['$expectedCount', 0] },
          { $lt: ['$submittedCount', '$expectedCount'] },
        ],
      },
    },
    { $inc: { submittedCount: 1 } },
    { new: true }
  );
  if (!claimed) {
    // Cap reached, window closed, or the round advanced since the pre-check.
    throw conflict('This batch has reached its expected number of responses.', 'CAP_REACHED');
  }

  /** Give the slot back. Used whenever the writes below do not land. */
  const releaseSlot = () =>
    Batch.updateOne(
      { _id: batch._id, round: batch.round || 0, submittedCount: { $gt: 0 } },
      { $inc: { submittedCount: -1 } }
    ).catch((err) => {
      // Losing a slot is survivable (one fewer response accepted) and must
      // never mask the original failure, so this is logged, not thrown.
      console.error('[feedback] could not release a claimed slot:', err.message);
    });

  /* ── (7b) WRITE — device lock + one Feedback per class ────────────────────
   *
   * These touch only THIS student's documents, so they do not contend with
   * anyone else and a transaction here is cheap. It buys real atomicity: a
   * failure between the lock and the rows would otherwise leave the student
   * locked out with nothing recorded.
   */
  const writeDocs = async (opts) => {
    if (deviceReliable) {
      await DeviceLock.create(
        [{ batch: batch._id, signatureHash, round: batch.round || 0 }],
        opts
      );
    }
    await Feedback.insertMany(feedbackDocs, { ordered: true, ...opts });
  };

  try {
    if (useTxn) {
      const dbSession = await mongoose.startSession();
      try {
        await dbSession.withTransaction(async () => writeDocs({ session: dbSession }), {
          // The cap is a hard promise, so a student is only told "recorded"
          // once the write is durable on a majority.
          writeConcern: { w: 'majority' },
          maxCommitTimeMS: 15_000,
        });
      } finally {
        await dbSession.endSession();
      }
    } else {
      // Standalone Mongo: ordered writes. The unique DeviceLock index is still
      // the authoritative duplicate guard, and the slot claim above still caps.
      await writeDocs({});
    }
  } catch (err) {
    /* The slot was claimed but nothing was written, so hand it back — otherwise
       a duplicate attempt would permanently consume a seat from the cohort. */
    await releaseSlot();

    /* On a replica set the transaction rolled the device lock back with
       everything else. WITHOUT a transaction (standalone Mongo) it did not: the
       lock was already committed, so a failure between it and the feedback rows
       would leave this student locked out with nothing recorded — blocked
       forever from a submission that never happened. Remove it explicitly.
       Skipped for a duplicate-key error, where the lock is someone's genuine
       earlier submission and deleting it would UNDO their protection. */
    if (!useTxn && deviceReliable && err.code !== 11000) {
      await DeviceLock.deleteOne({ batch: batch._id, signatureHash }).catch((e) =>
        console.error('[feedback] could not release an orphaned device lock:', e.message)
      );
    }

    if (err.code === 11000) {
      throw conflict('Feedback already recorded for this device.', 'DEVICE_LOCKED');
    }
    throw err;
  }

  return res.status(201).json({
    ok: true,
    message: 'Thank you! Your feedback has been recorded.',
    classesRecorded: feedbackDocs.length,
    submittedCount: claimed.submittedCount,
    expectedCount: claimed.expectedCount,
    deviceLocked: deviceReliable,
  });
});

/*
 * ── EXTENSION POINT: strict "one-time token per seat" mode ─────────────────
 * To upgrade from best-effort to hard uniqueness, add a `SeatToken` collection
 * of N single-use codes generated at unlock (one per seat). verify-passcode
 * would consume a seat token instead of (or in addition to) the shared batch
 * passcode, and submit would mark it used inside this same transaction. The
 * DeviceLock/cap machinery above stays exactly as-is; only the gate changes.
 */
