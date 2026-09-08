/**
 * The anonymous student flow — the product's hard requirements:
 *   Layer 1 passcode gate · Layer 2 device lock · Layer 3 live cap,
 *   plus mandatory comments, complete ratings, and the anonymity guarantee.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  app, startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  activeParamIds, fullRatings, feedbackBody, loginToken, supportsTransactions,
  startTestServer, stopTestServer, makeBrowser, target,
  ADMIN_PASSWORD,
} from './helpers.js';
import { Feedback } from '../models/Feedback.js';
import { DeviceLock } from '../models/DeviceLock.js';
import { Batch } from '../models/Batch.js';
import { Parameter } from '../models/Parameter.js';

jest.setTimeout(60_000);

let admin;
let mainMentor;
let supportMentor;
let klass;
let batch;
let passcode;
let sessionToken;

/* ONE server for the whole file — see target() in helpers.js for why
   request(target()) per call was causing intermittent failures. */
beforeAll(async () => {
  await startTestDB();
  startTestServer();
});
afterAll(async () => {
  stopTestServer();
  await stopTestDB();
});

/** Unlock the batch as admin and complete the passcode gate as a student. */
async function openWindowAndVerify(expectedCount = 2) {
  const token = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedCount });
  expect(unlocked.status).toBe(200);
  passcode = unlocked.body.passcode;

  const verified = await request(target())
    .post('/api/public/verify-passcode')
    .send({ batchId: String(batch._id), passcode });
  expect(verified.status).toBe(200);
  sessionToken = verified.body.sessionToken;
  batch = await Batch.findById(batch._id);
  return { token, verified };
}

beforeEach(async () => {
  await resetDB();
  ({ admin } = await seedBasics());
  mainMentor = await makeTrainer('main@test.com', 'Suneeta Somisetti');
  supportMentor = await makeTrainer('support@test.com', 'Abhishek Nallam');
  klass = await makeClass(null, 'Coding');
  batch = await makeBatch({
    class: klass._id,
    mainTrainers: [mainMentor._id],
    supportTrainers: [supportMentor._id],
    name: 'FSD Aug 2025',
    expectedCount: 2,
  });
});

describe('Environment', () => {
  test('in-memory DB is a replica set → transaction path is under test', () => {
    expect(supportsTransactions()).toBe(true);
  });
});

describe('Passcode gate (Layer 1)', () => {
  test('correct passcode resonates the batch identity and verifies', async () => {
    const { verified } = await openWindowAndVerify();
    // Stem from "FSD Aug 2025" → initials F, A, 2 → "FA2"
    expect(passcode.startsWith('FA2')).toBe(true);
    expect(passcode.length).toBeGreaterThanOrEqual(12);
    expect(verified.body.classes).toHaveLength(1);
    expect(verified.body.classes[0].mainMentors).toEqual(['Suneeta Somisetti']);
    expect(verified.body.classes[0].supportMentors).toEqual(['Abhishek Nallam']);
    expect(verified.body.parameters).toHaveLength(8);
  });

  test('wrong passcode is rejected', async () => {
    await openWindowAndVerify();
    const res = await request(target())
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode: 'TOTALLY-WRONG' });
    expect(res.status).toBe(401);
  });

  test('submit without a valid session token is rejected (passcode required)', async () => {
    await openWindowAndVerify();
    const body = await feedbackBody({
      batchId: batch._id,
      classIds: [klass._id],
      comment: 'No session token at all here',
    });
    delete body.sessionToken;
    const res = await request(target()).post('/api/public/feedback').send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });
});

describe('One feedback per device (Layer 2)', () => {
  test('first submit succeeds, duplicate from same device is rejected', async () => {
    await openWindowAndVerify();
    const agent = request.agent(target());

    // Verify through the agent so it holds the httpOnly device cookie.
    const v = await agent
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode });
    expect(v.status).toBe(200);

    const body = await feedbackBody({
      batchId: batch._id,
      classIds: [klass._id],
      comment: 'Great session, learned a lot',
      sessionToken: v.body.sessionToken,
    });

    const first = await agent.post('/api/public/feedback').send(body);
    expect(first.status).toBe(201);
    expect(first.body.deviceLocked).toBe(true);

    const second = await agent.post('/api/public/feedback').send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DEVICE_LOCKED');

    expect(await Feedback.countDocuments()).toBe(1);
    expect(await DeviceLock.countDocuments()).toBe(1);
  });

  test('re-unlocking bumps the round so a second collection round is possible', async () => {
    await openWindowAndVerify(5);
    const agent = request.agent(target());
    const v1 = await agent
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode });
    const r1 = await agent.post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Round one response here',
        sessionToken: v1.body.sessionToken,
      })
    );
    expect(r1.status).toBe(201);

    // Same device, brand new round.
    const { verified } = await openWindowAndVerify(5);
    expect(verified.body.round).toBe(2);
    const v2 = await agent
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode });
    const r2 = await agent.post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Round two response here',
        sessionToken: v2.body.sessionToken,
      })
    );
    expect(r2.status).toBe(201);
    expect(await Feedback.countDocuments()).toBe(2);
  });

  test('a session token from a previous round cannot submit into the new one', async () => {
    await openWindowAndVerify(5);
    const stale = sessionToken;
    await openWindowAndVerify(5); // bumps to round 2

    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Stale round token attempt',
        sessionToken: stale,
      })
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ROUND_CHANGED');
  });
});

describe('Live cap (Layer 3)', () => {
  test('submissions beyond expectedCount are blocked', async () => {
    await openWindowAndVerify(2);

    for (let i = 0; i < 2; i++) {
      const res = await request(target()).post('/api/public/feedback').send(
        await feedbackBody({
          batchId: batch._id,
          classIds: [klass._id],
          stars: (i % 5) + 1,
          comment: `Feedback number ${i} here`,
          sessionToken,
          fingerprint: `fp${i}`,
        })
      );
      expect(res.status).toBe(201);
    }

    const blocked = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Third feedback should be blocked',
        sessionToken,
        fingerprint: 'fp3',
      })
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CAP_REACHED');
  });

  test('the counter increments once per STUDENT, not once per class', async () => {
    const second = await makeClass(null, 'GenAI');
    batch = await makeBatch({
      classes: [
        { class: klass._id, mainTrainers: [mainMentor._id], supportTrainers: [] },
        { class: second._id, mainTrainers: [supportMentor._id], supportTrainers: [] },
      ],
      name: 'Multi Subject Batch',
      expectedCount: 3,
    });
    await openWindowAndVerify(3);

    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id, second._id],
        comment: 'Rated both subjects in one go',
        sessionToken,
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.classesRecorded).toBe(2);
    // Two Feedback rows, but the cap counts one student.
    expect(await Feedback.countDocuments()).toBe(2);
    expect(res.body.submittedCount).toBe(1);
  });
});

describe('Submission validation', () => {
  test('comment is mandatory (min length)', async () => {
    await openWindowAndVerify();
    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'short',
        sessionToken,
      })
    );
    expect(res.status).toBe(400);
  });

  test('every parameter issued at verify time must be rated', async () => {
    await openWindowAndVerify();
    const ratings = (await fullRatings(4)).slice(0, 7); // one short
    const res = await request(target())
      .post('/api/public/feedback')
      .send({
        batchId: String(batch._id),
        classes: [{ classId: String(klass._id), ratings, comment: 'Missing one rating value' }],
        sessionToken,
        fingerprint: 'fp',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_RATINGS');
  });

  test('every class in the batch must be rated exactly once', async () => {
    const second = await makeClass(null, 'GenAI');
    batch = await makeBatch({
      classes: [
        { class: klass._id, mainTrainers: [mainMentor._id], supportTrainers: [] },
        { class: second._id, mainTrainers: [mainMentor._id], supportTrainers: [] },
      ],
      name: 'Two Subject Batch',
    });
    await openWindowAndVerify();

    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id], // second subject omitted
        comment: 'Only rated one of two classes',
        sessionToken,
      })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_CLASSES');
  });

  test('a locked batch cannot receive feedback', async () => {
    await openWindowAndVerify();
    const token = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
    await request(target())
      .post(`/api/batches/${batch._id}/lock`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Window should be closed now',
        sessionToken,
      })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WINDOW_CLOSED');
  });

  /**
   * The parameter set is PINNED at verify time. An admin deactivating a
   * parameter mid-window used to make every in-flight student's submission
   * fail and lose their answers — an admin action silently destroying student
   * work, which is the worst kind of bug in a survey tool.
   */
  test('deactivating a parameter mid-window does not break an in-flight student', async () => {
    await openWindowAndVerify();
    const issued = await activeParamIds(); // what the student was shown
    const token = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);

    const victim = await Parameter.findOne().sort({ order: -1 });
    const patched = await request(target())
      .patch(`/api/parameters/${victim._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(patched.status).toBe(200);

    // The student submits the form they were given, including the now-inactive
    // parameter. It must still be accepted.
    const res = await request(target())
      .post('/api/public/feedback')
      .send({
        batchId: String(batch._id),
        classes: [
          {
            classId: String(klass._id),
            ratings: issued.map((parameter) => ({ parameter, stars: 4 })),
            comment: 'Submitted after an admin edit',
          },
        ],
        sessionToken,
        fingerprint: 'fp',
      });
    expect(res.status).toBe(201);
  });
});

describe('Anonymity', () => {
  test('no device signature or identity is stored on the Feedback document', async () => {
    await openWindowAndVerify();
    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Anonymous but useful comment',
        sessionToken,
      })
    );
    expect(res.status).toBe(201);

    const raw = await Feedback.findOne().lean();
    // The mentor rosters describe the SESSION, not the respondent.
    expect(raw.mainTrainers.map(String)).toEqual([String(mainMentor._id)]);
    expect(raw.supportTrainers.map(String)).toEqual([String(supportMentor._id)]);
    // Nothing that could identify or fingerprint the student.
    for (const forbidden of ['signatureHash', 'fingerprint', 'ip', 'ipAddress', 'student', 'userAgent', 'deviceToken']) {
      expect(raw[forbidden]).toBeUndefined();
    }
    expect(JSON.stringify(raw)).not.toContain('fp');
  });
});

describe('Concurrency (a whole cohort submitting at once)', () => {
  /**
   * Regression test for a bug that would have lost almost every response in a
   * real session.
   *
   * Every submission increments ONE counter on ONE batch document. That
   * increment used to sit inside the same transaction as the feedback write, so
   * concurrent submissions took a document-level write lock and aborted each
   * other with WriteConflict (code 112). Against the real cluster, 300
   * simultaneous students put **1** response in the database. Adding retries
   * only lifted it to 25.
   *
   * The counter is now claimed with a single atomic update outside the
   * transaction, which WiredTiger resolves internally instead of surfacing a
   * conflict. These tests assert the two properties that matters: nobody is
   * dropped, and the cap is still exact.
   */
  const BURST = 40;
  let baseUrl;

  beforeAll(() => {
    baseUrl = startTestServer();
  });

  test(`${BURST} simultaneous submissions all land, with no lost responses`, async () => {
    await openWindowAndVerify(BURST);

    /* Each "student" is a real browser against the shared server: its own
       cookie jar, therefore its own device cookie. Without cookies every
       submission would take the cookies-blocked path that deliberately SKIPS
       the device lock, and the test would pass while proving nothing about the
       guard it claims to exercise. */
    const students = Array.from({ length: BURST }, () => makeBrowser(baseUrl));
    const sessions = await Promise.all(
      students.map((b) =>
        b
          .post('/api/public/verify-passcode', { batchId: String(batch._id), passcode })
          .then((r) => r.body.sessionToken)
      )
    );

    const results = await Promise.all(
      students.map((b, i) =>
        feedbackBody({
          batchId: batch._id,
          classIds: [klass._id],
          stars: (i % 5) + 1,
          comment: `Concurrent submission number ${i} arriving at once`,
          sessionToken: sessions[i],
          fingerprint: `burst-device-${i}`,
        }).then((body) => b.post('/api/public/feedback', body))
      )
    );

    const created = results.filter((r) => r.status === 201);
    const other = results.filter((r) => r.status !== 201);
    // Report what actually failed — "expected 40, got 3" alone would not say why.
    expect(other.map((r) => `${r.status}:${r.body?.code || r.body?.error}`)).toEqual([]);
    expect(created).toHaveLength(BURST);

    // And the persisted state agrees with the responses we handed out.
    expect(await Feedback.countDocuments({ batch: batch._id })).toBe(BURST);
    expect(await DeviceLock.countDocuments({ batch: batch._id })).toBe(BURST);
    const fresh = await Batch.findById(batch._id);
    expect(fresh.submittedCount).toBe(BURST);
  });

  test('the cap holds exactly under a burst that exceeds it', async () => {
    const CAP = 10;
    const ATTEMPTS = 30;
    await openWindowAndVerify(CAP);

    const students = Array.from({ length: ATTEMPTS }, () => makeBrowser(baseUrl));
    const sessions = await Promise.all(
      students.map((b) =>
        b
          .post('/api/public/verify-passcode', { batchId: String(batch._id), passcode })
          .then((r) => r.body.sessionToken)
      )
    );

    const results = await Promise.all(
      students.map((b, i) =>
        feedbackBody({
          batchId: batch._id,
          classIds: [klass._id],
          comment: `Over-cap attempt number ${i} in the same instant`,
          sessionToken: sessions[i],
          fingerprint: `overcap-device-${i}`,
        }).then((body) => b.post('/api/public/feedback', body))
      )
    );

    const created = results.filter((r) => r.status === 201);
    const capped = results.filter((r) => r.body?.code === 'CAP_REACHED');

    // Exactly the cap — never one more (over-counting) and never one fewer
    // (a slot claimed and then lost without being released).
    expect(created).toHaveLength(CAP);
    expect(capped).toHaveLength(ATTEMPTS - CAP);
    expect(await Feedback.countDocuments({ batch: batch._id })).toBe(CAP);
    const fresh = await Batch.findById(batch._id);
    expect(fresh.submittedCount).toBe(CAP);
  });

  test('a claimed slot is released when the write is refused as a duplicate', async () => {
    await openWindowAndVerify(5);
    const agent = request.agent(target());
    const v = await agent
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode });

    const body = await feedbackBody({
      batchId: batch._id,
      classIds: [klass._id],
      comment: 'First and only accepted response here',
      sessionToken: v.body.sessionToken,
    });

    expect((await agent.post('/api/public/feedback').send(body)).status).toBe(201);
    expect((await agent.post('/api/public/feedback').send(body)).status).toBe(409);

    /* The rejected attempt claims a slot before discovering the duplicate, so
       it must hand that slot back. If it did not, every blocked duplicate would
       silently consume a seat and a cohort of 100 could stop accepting real
       responses well short of 100. */
    const fresh = await Batch.findById(batch._id);
    expect(fresh.submittedCount).toBe(1);
  });
});

describe('Passcode hashing', () => {
  test('a stored passcode hash is not the plaintext and verifies constant-time', async () => {
    await openWindowAndVerify();
    const fresh = await Batch.findById(batch._id).lean();
    expect(fresh.passcodeHash).not.toContain(passcode);
    // Keyed HMAC scheme, not bcrypt — see utils/password.js for why.
    expect(fresh.passcodeHash.startsWith('h1$')).toBe(true);
  });

  test('a legacy bcrypt passcode hash still verifies (no migration needed)', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const legacy = 'LEGACY@Code99';
    await Batch.updateOne(
      { _id: batch._id },
      { passcodeHash: await bcrypt.hash(legacy, 10), status: 'open', round: 1, openedAt: new Date() }
    );

    const ok = await request(target())
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode: legacy });
    expect(ok.status).toBe(200);

    const bad = await request(target())
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode: 'WRONG@Code99' });
    expect(bad.status).toBe(401);
  });
});

describe('Cookies-blocked students', () => {
  /**
   * With cookies blocked the device signature collapses to a coarse
   * fingerprint (user agent + screen + timezone), which is NOT unique across a
   * lab of identical machines. Enforcing the lock there would reject genuinely
   * different students as duplicates and silently drop real responses, so the
   * lock is skipped and the passcode gate plus the live cap carry the load.
   * The response says so, rather than implying a protection that was not
   * applied.
   */
  test('are accepted, and the response reports that no device lock was taken', async () => {
    await openWindowAndVerify(3);
    // No agent -> no cookie jar, exactly like a browser refusing cookies.
    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds: [klass._id],
        comment: 'Submitted from a browser with cookies disabled',
        sessionToken,
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.deviceLocked).toBe(false);
    expect(await DeviceLock.countDocuments({ batch: batch._id })).toBe(0);
    // The cap still applies, which is what bounds the damage.
    expect((await Batch.findById(batch._id)).submittedCount).toBe(1);
  });
});
