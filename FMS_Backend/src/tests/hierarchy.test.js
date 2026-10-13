/**
 * The whole chain, end to end, in a brand-new organization.
 *
 * superadmin → creates the organization and its admin
 *   admin    → creates mentors, a subject, a cohort; opens it for feedback
 *     student → submits anonymously
 *   admin    → reads the results
 *   mentor   → reads only their own
 *
 * Every link is covered somewhere by a narrower test. None of those would
 * notice if a FRESH tenant were missing something the first one happens to
 * have — no feedback parameters, a role that cannot reach its own screens —
 * because every other suite builds its world with fixtures rather than
 * through the product. This one only uses the API, exactly as a new customer
 * would on their first day.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, loginToken, ADMIN_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { runUnscoped } from '../tenancy/tenantContext.js';

jest.setTimeout(90_000);

const CHOSEN_PASSWORD = 'Delta-Harbour-77';
const MENTOR_PASSWORD = 'Mentor-Harbour-77';
const COMMENT = 'The pace was good and the examples landed well for most of us';

let superToken;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics({ orgName: 'NCET', slug: 'ncet' });
  await runUnscoped(async () => {
    const u = new User({
      name: 'Platform Administrator',
      email: 'root@platform.test',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: 'superadmin',
      organization: null,
    });
    await u.save({ validateBeforeSave: false });
  });
  superToken = await loginToken(request, 'root@platform.test', ADMIN_PASSWORD);
});

const as = (token, r) => r.set('Authorization', `Bearer ${token}`);

describe('a new customer, from nothing to a read report', () => {
  test('the whole chain works through the API alone', async () => {
    // ── 1. The operator creates the organization and names the password ────
    const created = await as(superToken, request(target()).post('/api/platform/organizations')).send({
      name: 'Delta Institute',
      slug: 'delta-institute',
      adminName: 'Deepa Admin',
      adminEmail: 'deepa@delta.test',
      adminPassword: CHOSEN_PASSWORD,
      requirePasswordChange: false,
    });
    expect(created.status).toBe(201);
    /* A password the operator typed must NOT come back: they already hold it,
       and echoing it writes a live secret into a response body and a log. */
    expect(created.body.temporaryPassword).toBeUndefined();

    // ── 2. The admin signs in with exactly that password ───────────────────
    const adminToken = await loginToken(request, 'deepa@delta.test', CHOSEN_PASSWORD);

    // ── 3. And can build their world: mentor, subject, cohort ──────────────
    const mentor = await as(adminToken, request(target()).post('/api/trainers')).send({
      name: 'Meera Mentor',
      email: 'meera@delta.test',
      password: MENTOR_PASSWORD,
    });
    expect(mentor.status).toBe(201);

    const klass = await as(adminToken, request(target()).post('/api/classes')).send({
      name: 'Delta Python',
    });
    expect(klass.status).toBe(201);
    const classId = klass.body.class?._id || klass.body.class?.id || klass.body._id;

    const batch = await as(adminToken, request(target()).post('/api/batches')).send({
      name: 'Delta Batch-1',
      yearGroup: 'First Year',
      classes: [{ class: String(classId), mainTrainers: [String(mentor.body.trainer?.id || mentor.body.trainer?._id)], supportTrainers: [] }],
    });
    expect(batch.status).toBe(201);
    const batchId = batch.body.batch?._id || batch.body.batch?.id;

    // ── 4. Parameters came with the organization ──────────────────────────
    /* Without them the student meets an empty form, which is the failure a
       fresh tenant is most likely to have and no other suite would catch. */
    const params = await as(adminToken, request(target()).get('/api/parameters'));
    expect(params.status).toBe(200);
    const paramList = params.body.parameters || params.body;
    expect(paramList.length).toBeGreaterThan(0);
    /* THESE ids, not the fixture's. Every organization has its own parameter
       documents, so the ids differ per tenant — submitting another tenant's is
       correctly refused, and a test that reached for the shared fixture would
       be testing NCET's form against Delta's cohort. */
    const ratings = paramList.map((p) => ({ parameter: String(p._id || p.id), stars: 5 }));

    // ── 5. Open it, and a student answers anonymously ──────────────────────
    const unlocked = await as(adminToken,
      request(target()).post(`/api/batches/${batchId}/unlock`)).send({ expectedCount: 30 });
    expect(unlocked.status).toBe(200);

    const verified = await request(target()).post('/api/public/verify-passcode')
      .send({ batchId: String(batchId), passcode: unlocked.body.passcode });
    expect(verified.status).toBe(200);

    const submitted = await request(target()).post('/api/public/feedback').send({
      batchId: String(batchId),
      classes: [{ classId: String(classId), ratings, comment: COMMENT }],
      sessionToken: verified.body.sessionToken,
      fingerprint: 'delta-device-1',
    });
    expect(submitted.status).toBe(201);

    // ── 6. The admin reads it ─────────────────────────────────────────────
    const dash = await as(adminToken, request(target()).get('/api/dashboard/admin'));
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.feedbackCount).toBe(1);
    expect(JSON.stringify(dash.body)).toContain(COMMENT);

    // ── 7. The mentor reads their own, and only their own ─────────────────
    /* A mentor created by an admin starts on the admin's password, so they are
       locked out of every data route until they replace it. Walked in full
       rather than worked around: it is the path every real mentor takes, and
       the step most likely to be broken for a brand-new tenant. */
    const firstToken = await loginToken(request, 'meera@delta.test', MENTOR_PASSWORD);
    const locked = await as(firstToken, request(target()).get('/api/dashboard/trainer/me'));
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await as(firstToken, request(target()).patch('/api/auth/me')).send({
      currentPassword: MENTOR_PASSWORD,
      newPassword: 'Harbour-Lantern-42',
    });
    expect(changed.status).toBe(200);

    const mentorToken = await loginToken(request, 'meera@delta.test', 'Harbour-Lantern-42');
    const mine = await as(mentorToken, request(target()).get('/api/dashboard/trainer/me'));
    expect(mine.status).toBe(200);
    expect(mine.body.kpis.feedbackCount).toBe(1);

    // ── 8. And none of it reached the other organization ──────────────────
    const ncetToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
    const ncet = await as(ncetToken, request(target()).get('/api/dashboard/admin'));
    expect(ncet.body.kpis.feedbackCount).toBe(0);
    expect(JSON.stringify(ncet.body)).not.toContain(COMMENT);
  });
});

describe('the password the operator types', () => {
  const base = {
    name: 'Weak Institute', slug: 'weak-institute',
    adminName: 'Weak Admin', adminEmail: 'weak@weak.test',
  };

  test('a weak one is refused rather than quietly accepted', async () => {
    /* A platform operator in a hurry is exactly who would set "password123"
       on an account that owns an institution's entire feedback history. */
    const res = await as(superToken, request(target()).post('/api/platform/organizations'))
      .send({ ...base, adminPassword: 'password' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  test('a refused password leaves no half-made organization behind', async () => {
    await as(superToken, request(target()).post('/api/platform/organizations'))
      .send({ ...base, adminPassword: '123' });
    const after = await as(superToken, request(target()).get('/api/platform/organizations'));
    expect(after.body.organizations.map((o) => o.slug)).not.toContain('weak-institute');
  });

  test('omitting it still generates one, shown once', async () => {
    const res = await as(superToken, request(target()).post('/api/platform/organizations'))
      .send({ ...base, slug: 'generated-institute' });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    expect(res.body.admin.mustChangePassword).toBe(true);
    await loginToken(request, 'weak@weak.test', res.body.temporaryPassword);
  });

  test('by default the admin must replace it, because two people know it', async () => {
    const res = await as(superToken, request(target()).post('/api/platform/organizations'))
      .send({ ...base, slug: 'forced-institute', adminPassword: CHOSEN_PASSWORD });
    expect(res.body.admin.mustChangePassword).toBe(true);

    const token = await loginToken(request, 'weak@weak.test', CHOSEN_PASSWORD);
    const blocked = await as(token, request(target()).get('/api/dashboard/admin'));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
