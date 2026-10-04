/**
 * The roster is the permission — swept across every endpoint a mentor can reach.
 *
 * Access to a session's feedback is granted by one thing: the batch roster an
 * admin edits in Batches → Edit. That rule is only worth anything if it holds
 * on EVERY route, not just the dashboard that was being looked at when it was
 * written. A single aggregation that forgets to apply the scope leaks another
 * mentor's cohort, and it leaks quietly, because the response still looks
 * perfectly well-formed.
 *
 * So rather than assert endpoint by endpoint, this walks the whole mentor-
 * reachable surface and asserts that nothing belonging to a cohort the mentor
 * is not staffed on appears ANYWHERE in the response — not the batch name, not
 * its id, and above all not the students' free-text comments, which is the
 * material that actually matters if it escapes.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';

jest.setTimeout(60_000);

let alice, bob, coding, genai, codingBatch, genaiBatch;
let adminToken, aliceToken;

const SECRET_COMMENT = 'zzqq-genai-only-comment-xyzzy';

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

async function submitTo(batch, classIds, comment) {
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 5 });
  const verified = await request(target())
    .post('/api/public/verify-passcode')
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
  const res = await request(target()).post('/api/public/feedback').send(
    await feedbackBody({
      batchId: batch._id,
      classIds,
      comment,
      sessionToken: verified.body.sessionToken,
      fingerprint: `fp-${batch._id}-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await resetDB();
  await seedBasics();

  alice = await makeTrainer('alice@test.com', 'Alice Anand');
  bob = await makeTrainer('bob@test.com', 'Bob Bhat');
  coding = await makeClass(null, 'Coding');
  genai = await makeClass(null, 'GenAI');

  codingBatch = await makeBatch({
    class: coding._id, mainTrainers: [alice._id], supportTrainers: [],
    name: 'Coding Cohort', yearGroup: 'Final Year',
  });
  // Alice is on no roster of this one, in either role.
  genaiBatch = await makeBatch({
    class: genai._id, mainTrainers: [bob._id], supportTrainers: [],
    name: 'ZZGenAI Cohort', yearGroup: 'Third Year',
  });

  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  aliceToken = await loginToken(request, 'alice@test.com', TRAINER_PASSWORD);

  await submitTo(codingBatch, [coding._id], 'Coding session was well paced');
  await submitTo(genaiBatch, [genai._id], SECRET_COMMENT);
});

/* Every GET a logged-in mentor may reach. Ids are placeholders because
   test.each() is evaluated at COLLECTION time, long before the fixtures in
   beforeEach exist — reading them here yields undefined. */
const MENTOR_ROUTES = [
  '/api/dashboard/trainer/me',
  '/api/analytics/trainer/me',
  '/api/analytics/trainer/batches',
  '/api/analytics/role-split',
  '/api/analytics/classes',
  '/api/analytics/sessions',
  '/api/analytics/years',
  '/api/analytics/themes',
  '/api/analytics/comments',
  '/api/analytics/deltas',
  '/api/batches',
  '/api/classes',
  '/api/parameters',
  '/api/phases',
  '/api/phases/current',
  '/api/auth/me',
  '/api/analytics/class/:ownClass',
  '/api/analytics/batch/:ownBatch',
  '/api/batches/:ownBatch/rounds',
  // Asking directly for the cohort they are not on must refuse or return
  // nothing — never answer with its contents.
  '/api/analytics/batch/:foreignBatch',
  '/api/analytics/class/:foreignClass',
];

const resolve = (route) =>
  route
    .replace(':ownClass', String(coding._id))
    .replace(':ownBatch', String(codingBatch._id))
    .replace(':foreignBatch', String(genaiBatch._id))
    .replace(':foreignClass', String(genai._id));

describe('nothing from a cohort the mentor is not staffed on ever appears', () => {
  test.each(MENTOR_ROUTES)('%s leaks no foreign cohort', async (route) => {
    const res = await request(target())
      .get(resolve(route))
      .set('Authorization', `Bearer ${aliceToken}`);
    // 200 or a clean refusal both acceptable; a 500 is not.
    expect(res.status).toBeLessThan(500);
    if (res.status !== 200) return;

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_COMMENT);
    expect(body).not.toContain('ZZGenAI Cohort');
    expect(body).not.toContain(String(genaiBatch._id));
  });

  test('and the admin, by contrast, does see it — so the sweep is meaningful', async () => {
    /* A sweep that passes because every endpoint returns nothing proves
       nothing. The same data must be reachable by someone. */
    const res = await request(target())
      .get('/api/analytics/comments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(SECRET_COMMENT);
  });
});

describe('the roster grants access, and revokes it', () => {
  /* A batch still taking responses cannot be restaffed, so lock it first —
     without this the PATCH 400s and a test asserting "does NOT contain" would
     pass for entirely the wrong reason. */
  const lock = () =>
    request(target())
      .post(`/api/batches/${genaiBatch._id}/lock`)
      .set('Authorization', `Bearer ${adminToken}`);

  const restaff = (main, support = []) =>
    request(target())
      .patch(`/api/batches/${genaiBatch._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        classes: [{
          class: String(genai._id),
          mainTrainers: main.map(String),
          supportTrainers: support.map(String),
        }],
      });

  test('adding a mentor to a batch hands them its existing feedback', async () => {
    expect((await lock()).status).toBe(200);
    expect((await restaff([bob._id], [alice._id])).status).toBe(200);

    const res = await request(target())
      .get('/api/analytics/comments')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(SECRET_COMMENT);
  });

  test('removing them takes it away again', async () => {
    expect((await lock()).status).toBe(200);
    expect((await restaff([bob._id], [alice._id])).status).toBe(200);
    expect((await restaff([bob._id], [])).status).toBe(200); // Alice off again

    const res = await request(target())
      .get('/api/analytics/comments')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_COMMENT);
  });
});
