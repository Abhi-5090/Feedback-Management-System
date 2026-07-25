import { jest } from '@jest/globals';
import request from 'supertest';
import {
  app,
  startTestDB,
  stopTestDB,
  resetDB,
  seedBasics,
  makeTrainer,
  makeClass,
  makeBatch,
  activeParamIds,
  supportsTransactions,
} from './helpers.js';

jest.setTimeout(60000);

let adminToken;
let batch;
let passcode;
let paramIds;

async function adminLogin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'adminpass' });
  return res.body.token;
}

/** A fresh "device": a supertest agent that persists the device cookie. */
function newDevice() {
  return request.agent(app);
}

async function verifyAndGetSession(device) {
  const res = await device.post('/api/public/verify-passcode').send({ batchId: String(batch._id), passcode });
  return { sessionToken: res.body.sessionToken, res };
}

function fullRatings(stars = 4) {
  return paramIds.map((id) => ({ parameter: id, stars }));
}

beforeAll(startTestDB);
afterAll(stopTestDB);

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  const trainer = await makeTrainer();
  const klass = await makeClass(trainer._id, 'Full Stack Aug 2025');
  batch = await makeBatch(klass._id, 'FSD Aug 2025', 2); // cap = 2
  adminToken = await adminLogin();
  paramIds = await activeParamIds();

  // Unlock via the admin API to get the plaintext passcode.
  const unlock = await request(app)
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 2 });
  passcode = unlock.body.passcode;
});

describe('Environment', () => {
  test('in-memory DB is a replica set → transaction path is under test', () => {
    expect(supportsTransactions()).toBe(true);
  });
});

describe('Passcode gate (Layer 1)', () => {
  test('correct passcode resonates the batch identity and verifies', async () => {
    // "FSD Aug 2025" → initials F,A,2 → stem "FA2"
    expect(passcode).toMatch(/^FA2/);
    const device = newDevice();
    const { res } = await verifyAndGetSession(device);
    expect(res.status).toBe(200);
    expect(res.body.parameters).toHaveLength(8);
  });

  test('wrong passcode is rejected', async () => {
    const res = await request(app)
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode: 'NOPE@42' });
    expect(res.status).toBe(401);
  });

  test('submit without a valid session token is rejected (passcode required)', async () => {
    const device = newDevice();
    await verifyAndGetSession(device); // issues device cookie but we omit the token
    const res = await device
      .post('/api/public/feedback')
      .send({ batchId: String(batch._id), ratings: fullRatings(), comment: 'No session token at all here' });
    expect(res.status).toBe(401);
  });
});

describe('One feedback per device (Layer 2)', () => {
  test('first submit succeeds, duplicate from same device is rejected', async () => {
    const device = newDevice();
    const { sessionToken } = await verifyAndGetSession(device);
    const body = { batchId: String(batch._id), ratings: fullRatings(), comment: 'Great session, learned a lot', sessionToken, fingerprint: 'fp' };

    const first = await device.post('/api/public/feedback').send(body);
    expect(first.status).toBe(201);
    expect(first.body.submittedCount).toBe(1);

    const dup = await device.post('/api/public/feedback').send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DEVICE_LOCKED');
  });
});

describe('Live cap (Layer 3)', () => {
  test('submissions beyond expectedCount are blocked', async () => {
    // Two distinct devices fill the cap of 2.
    for (let i = 0; i < 2; i += 1) {
      const d = newDevice();
      const { sessionToken } = await verifyAndGetSession(d);
      const r = await d
        .post('/api/public/feedback')
        .send({ batchId: String(batch._id), ratings: fullRatings((i % 5) + 1), comment: `Feedback number ${i} here`, sessionToken, fingerprint: `fp${i}` });
      expect(r.status).toBe(201);
    }
    // Third device is blocked by the cap.
    const d3 = newDevice();
    const { sessionToken } = await verifyAndGetSession(d3);
    const blocked = await d3
      .post('/api/public/feedback')
      .send({ batchId: String(batch._id), ratings: fullRatings(), comment: 'Third feedback should be blocked', sessionToken, fingerprint: 'fp3' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CAP_REACHED');
  });
});

describe('Submission validation', () => {
  test('comment is mandatory (min length)', async () => {
    const device = newDevice();
    const { sessionToken } = await verifyAndGetSession(device);
    const res = await device
      .post('/api/public/feedback')
      .send({ batchId: String(batch._id), ratings: fullRatings(), comment: 'short', sessionToken, fingerprint: 'fp' });
    expect(res.status).toBe(400);
  });

  test('every active parameter must be rated', async () => {
    const device = newDevice();
    const { sessionToken } = await verifyAndGetSession(device);
    const res = await device
      .post('/api/public/feedback')
      .send({ batchId: String(batch._id), ratings: fullRatings().slice(0, 7), comment: 'Missing one rating value', sessionToken, fingerprint: 'fp' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_RATINGS');
  });

  test('a locked batch cannot receive feedback', async () => {
    await request(app).post(`/api/batches/${batch._id}/lock`).set('Authorization', `Bearer ${adminToken}`);
    const device = newDevice();
    const v = await device.post('/api/public/verify-passcode').send({ batchId: String(batch._id), passcode });
    expect(v.status).toBe(400); // window closed
  });
});

describe('Anonymity', () => {
  test('no device signature or identity is stored on the Feedback document', async () => {
    const device = newDevice();
    const { sessionToken } = await verifyAndGetSession(device);
    await device
      .post('/api/public/feedback')
      .send({ batchId: String(batch._id), ratings: fullRatings(), comment: 'Anonymous but useful comment', sessionToken, fingerprint: 'fp' });

    const { Feedback } = await import('../models/Feedback.js');
    const doc = await Feedback.findOne().lean();
    expect(doc).toBeTruthy();
    expect(doc).not.toHaveProperty('signatureHash');
    expect(doc).not.toHaveProperty('ip');
    expect(doc).not.toHaveProperty('device');
    expect(JSON.stringify(doc)).not.toContain('fp'); // the fingerprint never lands here
  });
});
