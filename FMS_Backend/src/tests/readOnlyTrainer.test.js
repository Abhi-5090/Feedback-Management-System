/**
 * A mentor may read their feedback and change nothing else.
 *
 * Hiding a button is not a permission. The guarantee has to hold against a
 * request made by hand, so this sweeps every domain write in the product and
 * asserts a mentor is refused — and then asserts an admin is allowed through
 * the same door, because a sweep that passes by refusing everyone proves
 * nothing at all.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';

jest.setTimeout(90_000);

let trainerToken, adminToken, klass, batch, mentor;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  mentor = await makeTrainer('mentor@test.com', 'Mentor One');
  klass = await makeClass(null, 'Coding');
  batch = await makeBatch({
    class: klass._id, mainTrainers: [mentor._id], supportTrainers: [], name: 'Cohort A',
  });
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  trainerToken = await loginToken(request, 'mentor@test.com', TRAINER_PASSWORD);
});

/* Every write that changes somebody else's data. Ids are placeholders:
   test.each() is evaluated at COLLECTION time, long before the fixtures in
   beforeEach exist, so reading them here yields undefined. */
const WRITES = [
  ['post', '/api/trainers', { name: 'X', email: 'x@test.com', password: 'Harbour-Lantern-42' }],
  ['patch', '/api/trainers/:mentor', { name: 'Renamed' }],
  ['post', '/api/classes', { name: 'New Subject' }],
  ['patch', '/api/classes/:class', { name: 'Renamed Subject' }],
  ['patch', '/api/classes/:class/archive', { archived: true }],
  ['post', '/api/batches', { name: 'New Cohort', classes: [] }],
  ['patch', '/api/batches/:batch', { name: 'Renamed Cohort' }],
  ['patch', '/api/batches/:batch/archive', { archived: true }],
  ['post', '/api/batches/:batch/unlock', { expectedCount: 10 }],
  ['post', '/api/batches/:batch/lock', {}],
  ['post', '/api/parameters', { label: 'New Parameter' }],
  ['post', '/api/phases', { name: 'P', code: 'p', startsAt: '2026-01-01', endsAt: '2026-02-01' }],
];

const resolve = (path) =>
  path
    .replace(':mentor', String(mentor._id))
    .replace(':class', String(klass._id))
    .replace(':batch', String(batch._id));

describe('a mentor cannot change anything', () => {
  test.each(WRITES)('%s %s is refused', async (method, path, body) => {
    const res = await request(target())[method](resolve(path))
      .set('Authorization', `Bearer ${trainerToken}`)
      .send(body);
    /* 403 is the answer. A 400 would mean the request got far enough to be
       validated, which is further than it should ever travel. */
    expect(res.status).toBe(403);
  });

  test('and an admin IS allowed through the same doors', async () => {
    /* Without this, the sweep above could pass because every route is broken. */
    const ok = await request(target()).post('/api/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Can Create' });
    expect(ok.status).toBe(201);
  });
});

describe('what a mentor CAN do', () => {
  test('read their own feedback', async () => {
    const res = await request(target())
      .get('/api/dashboard/trainer/me')
      .set('Authorization', `Bearer ${trainerToken}`);
    expect(res.status).toBe(200);
  });

  test('change their own password', async () => {
    /* Not a loophole — it is required of them. A mentor created by an admin
       starts on a password two people know, and is locked out of every data
       route until they replace it. */
    const res = await request(target()).patch('/api/auth/me')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ currentPassword: TRAINER_PASSWORD, newPassword: 'Harbour-Lantern-42' });
    expect(res.status).toBe(200);
  });

  test('turn their own digest email on and off', async () => {
    const res = await request(target()).patch('/api/auth/me/digest')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ enabled: true, frequency: 'weekly' });
    expect(res.status).toBe(200);
  });

  test('but NOT change another account', async () => {
    const res = await request(target()).patch(`/api/trainers/${mentor._id}`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ name: 'Self Promotion' });
    expect(res.status).toBe(403);
  });
});

describe('deleting is possible, but refuses to discard feedback', () => {
  test('a mentor cannot delete anything either', async () => {
    for (const path of [`/api/classes/${klass._id}`, `/api/batches/${batch._id}`, `/api/trainers/${mentor._id}`]) {
      const res = await request(target()).delete(path).set('Authorization', `Bearer ${trainerToken}`);
      expect(res.status).toBe(403);
    }
  });

  test('a subject in use is refused, and the refusal says what is using it', async () => {
    /* "No" is useless; "3 cohorts use this" tells an admin what to do next. */
    const res = await request(target()).delete(`/api/classes/${klass._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IN_USE');
    expect(res.body.error).toMatch(/cohort/);
  });

  test('an unused subject deletes cleanly', async () => {
    const made = await request(target()).post('/api/classes')
      .set('Authorization', `Bearer ${adminToken}`).send({ name: 'Mistake Subject' });
    const id = made.body.class?._id || made.body.class?.id || made.body._id;

    const res = await request(target()).delete(`/api/classes/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('an open cohort must be locked first', async () => {
    await request(target()).post(`/api/batches/${batch._id}/unlock`)
      .set('Authorization', `Bearer ${adminToken}`).send({ expectedCount: 10 });

    const res = await request(target()).delete(`/api/batches/${batch._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('STILL_OPEN');
  });

  test('removing a mentor who works nowhere else deletes the account', async () => {
    const res = await request(target()).delete(`/api/trainers/${mentor._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.accountDeleted).toBe(true);
  });
});
