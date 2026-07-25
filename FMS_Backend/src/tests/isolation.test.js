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
} from './helpers.js';

jest.setTimeout(60000);

let adminToken;
let trainerAToken;
let classA;
let classB;

async function login(email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.token;
}

async function seedFeedback(batch, paramIds) {
  const device = request.agent(app);
  const v = await device.post('/api/public/verify-passcode').send({ batchId: String(batch._id), passcode: batch._passcode });
  await device.post('/api/public/feedback').send({
    batchId: String(batch._id),
    ratings: paramIds.map((id) => ({ parameter: id, stars: 5 })),
    comment: 'Seeded feedback for isolation test',
    sessionToken: v.body.sessionToken,
    fingerprint: `fp-${Math.random()}`,
  });
}

beforeAll(startTestDB);
afterAll(stopTestDB);

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await login('admin@test.com', 'adminpass');
  const paramIds = await activeParamIds();

  const trainerA = await makeTrainer('a@test.com');
  const trainerB = await makeTrainer('b@test.com');
  classA = await makeClass(trainerA._id, 'Class A');
  classB = await makeClass(trainerB._id, 'Class B');
  const batchA = await makeBatch(classA._id, 'Batch A', 5);
  const batchB = await makeBatch(classB._id, 'Batch B', 5);

  // Unlock both and seed one feedback each.
  const uA = await request(app).post(`/api/batches/${batchA._id}/unlock`).set('Authorization', `Bearer ${adminToken}`).send({ expectedCount: 5 });
  const uB = await request(app).post(`/api/batches/${batchB._id}/unlock`).set('Authorization', `Bearer ${adminToken}`).send({ expectedCount: 5 });
  batchA._passcode = uA.body.passcode;
  batchB._passcode = uB.body.passcode;
  await seedFeedback(batchA, paramIds);
  await seedFeedback(batchB, paramIds);

  trainerAToken = await login('a@test.com', 'trainerpass');
});

describe('Trainer data isolation (server-side)', () => {
  test('trainer sees only their own classes in analytics', async () => {
    const own = await request(app).get(`/api/analytics/class/${classA._id}`).set('Authorization', `Bearer ${trainerAToken}`);
    expect(own.status).toBe(200);
    expect(own.body.feedbackCount).toBe(1);
  });

  test('trainer CANNOT read another trainer\'s class analytics', async () => {
    const other = await request(app).get(`/api/analytics/class/${classB._id}`).set('Authorization', `Bearer ${trainerAToken}`);
    expect(other.status).toBe(403);
  });

  test('trainer dashboard is scoped to their own feedback only', async () => {
    const dash = await request(app).get('/api/dashboard/trainer/me').set('Authorization', `Bearer ${trainerAToken}`);
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.feedbackCount).toBe(1); // not 2
    expect(dash.body.kpis.myClasses).toBe(1);
  });

  test('admin sees the whole system', async () => {
    const dash = await request(app).get('/api/dashboard/admin').set('Authorization', `Bearer ${adminToken}`);
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.feedbackCount).toBe(2);
    expect(dash.body.kpis.trainers).toBe(2);
  });

  test('unauthenticated requests are rejected', async () => {
    const res = await request(app).get('/api/dashboard/admin');
    expect(res.status).toBe(401);
  });
});

describe('Exports honor role scoping', () => {
  test('admin can export any class as xlsx (valid workbook bytes)', async () => {
    const res = await request(app)
      .get(`/api/export/class/${classB._id}?format=xlsx`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.body[0]).toBe(0x50); // 'P' of PK zip header
    expect(res.body[1]).toBe(0x4b); // 'K'
  });

  test('admin can export any class as pdf (valid %PDF bytes)', async () => {
    const res = await request(app)
      .get(`/api/export/class/${classA._id}?format=pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('trainer can export their OWN class', async () => {
    const res = await request(app).get(`/api/export/class/${classA._id}?format=xlsx`).set('Authorization', `Bearer ${trainerAToken}`);
    expect(res.status).toBe(200);
  });

  test('trainer CANNOT export another trainer\'s class', async () => {
    const res = await request(app).get(`/api/export/class/${classB._id}?format=xlsx`).set('Authorization', `Bearer ${trainerAToken}`);
    expect(res.status).toBe(403);
  });

  test('trainer/me export returns only their data', async () => {
    const res = await request(app).get('/api/export/trainer/me?format=xlsx').set('Authorization', `Bearer ${trainerAToken}`);
    expect(res.status).toBe(200);
  });
});
