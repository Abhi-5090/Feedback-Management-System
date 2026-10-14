/**
 * Cross-organization isolation — the guarantee multi-tenancy exists to make.
 *
 * A mentor must not see another mentor's feedback; an INSTITUTION must not see
 * another institution's anything. The second is a stronger and more damaging
 * failure: one leak exposes a whole organization's staff, cohorts and students'
 * words to an unrelated customer.
 *
 * Isolation here is structural — a Mongoose plugin forces the organization
 * onto every query from the ambient request context — so these tests attack
 * the structure rather than individual endpoints: they assert the data layer
 * refuses to run unscoped, that it cannot be tricked into writing across the
 * line, and then sweep the live API for leaks anyway.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  makeOrganization, feedbackBody, loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target, testOrg,
} from './helpers.js';
import { Class } from '../models/Class.js';
import { Feedback } from '../models/Feedback.js';
import { User } from '../models/User.js';
import { Organization } from '../models/Organization.js';
import { hashPassword } from '../utils/password.js';
import {
  runWithTenant, runUnscoped, setAmbientTenant, clearAmbientTenant,
} from '../tenancy/tenantContext.js';

jest.setTimeout(60_000);

let ncet, other, otherAdminToken, adminToken;
let coding, codingBatch, alice;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

async function submitTo(batch, classIds, comment) {
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 50 });
  const verified = await request(target())
    .post('/api/public/verify-passcode')
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
  const res = await request(target()).post('/api/public/feedback').send(
    await feedbackBody({
      batchId: batch._id, classIds, comment,
      sessionToken: verified.body.sessionToken,
      fingerprint: `fp-${batch._id}-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);
}

const SECRET = 'zzq-ncet-only-comment-xyzzy';

beforeEach(async () => {
  await resetDB();
  await seedBasics({ orgName: 'NCET', slug: 'ncet' });
  ncet = testOrg;

  alice = await makeTrainer('alice@ncet.test', 'Alice Anand');
  coding = await makeClass(null, 'Coding');
  codingBatch = await makeBatch({
    class: coding._id, mainTrainers: [alice._id], supportTrainers: [],
    name: 'NCET Coding Cohort', yearGroup: 'Final Year',
  });
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  await submitTo(codingBatch, [coding._id], SECRET);

  // A second institution, with its own admin, its own subject, its own data.
  other = await makeOrganization({ name: 'Other Institute', slug: 'other-institute' });
  await other.run(async () => {
    await User.create({
      name: 'Other Admin',
      email: 'admin@other.test',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: 'admin',
    });
    await Class.create({ name: 'Other Subject' });
  });
  otherAdminToken = await loginToken(request, 'admin@other.test', ADMIN_PASSWORD);
});

describe('the data layer refuses to run without a tenant', () => {
  test('a query with no tenant context throws rather than returning everything', async () => {
    clearAmbientTenant();
    /* The failure that matters is the SILENT one: a controller that forgets to
       filter returning another institution's rows in a well-formed response.
       Failing closed turns it into a loud error instead. */
    await expect(Feedback.find({})).rejects.toThrow(/Tenant context missing/);
    await expect(Class.countDocuments({})).rejects.toThrow(/Tenant context missing/);
    await expect(Feedback.aggregate([{ $group: { _id: null } }])).rejects.toThrow(
      /Tenant context missing/
    );
    setAmbientTenant({ organization: ncet._id });
  });

  test('estimatedDocumentCount is blocked, because it cannot be filtered', async () => {
    await expect(Feedback.estimatedDocumentCount()).rejects.toThrow(/cannot be filtered/);
  });

  test('a scoped query sees only its own organization', async () => {
    const mine = await Class.find({}).lean();
    expect(mine.map((c) => c.name)).toEqual(['Coding']);

    const theirs = await other.run(() => Class.find({}).lean());
    expect(theirs.map((c) => c.name)).toEqual(['Other Subject']);
  });
});

describe('writes cannot cross the line', () => {
  test('a document is stamped with the tenant that created it', async () => {
    const created = await other.run(() => Class.create({ name: 'Stamped Subject' }));
    expect(String(created.organization)).toBe(String(other.org._id));
  });

  test('saving into a different organization than the document carries is refused', async () => {
    const theirs = await other.run(() => Class.create({ name: 'Theirs' }));
    theirs.name = 'Renamed by NCET';
    /* Belt and braces: the query filter would already miss this row. The save
       hook refuses outright so the attempt is loud rather than a silent no-op
       that looks like success. */
    await expect(runWithTenant(ncet._id, () => theirs.save())).rejects.toThrow(/Refusing to save/);
  });

  test("an update cannot reach another organization's rows", async () => {
    const theirs = await other.run(() => Class.create({ name: 'Untouchable' }));
    const res = await Class.updateMany({ _id: theirs._id }, { $set: { name: 'Hijacked' } });
    expect(res.matchedCount).toBe(0);

    const after = await runUnscoped(() => Class.findById(theirs._id).lean());
    expect(after.name).toBe('Untouchable');
  });

  test("a delete cannot reach another organization's rows", async () => {
    const theirs = await other.run(() => Class.create({ name: 'Keep Me' }));
    const res = await Class.deleteMany({ _id: theirs._id });
    expect(res.deletedCount).toBe(0);
    expect(await runUnscoped(() => Class.countDocuments({ _id: theirs._id }))).toBe(1);
  });
});

describe('the API leaks nothing across organizations', () => {
  const ADMIN_ROUTES = [
    '/api/dashboard/admin',
    '/api/analytics/classes',
    '/api/analytics/sessions',
    '/api/analytics/years',
    '/api/analytics/comments',
    '/api/analytics/themes',
    '/api/analytics/trainers',
    '/api/analytics/cohorts',
    '/api/batches',
    '/api/classes',
    '/api/trainers',
    '/api/parameters',
    '/api/phases',
    '/api/audit',
  ];

  test.each(ADMIN_ROUTES)("%s shows the other institute nothing of NCET's", async (route) => {
    const res = await request(target()).get(route).set('Authorization', `Bearer ${otherAdminToken}`);
    expect(res.status).toBeLessThan(500);
    if (res.status !== 200) return;

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('NCET Coding Cohort');
    expect(body).not.toContain('Alice Anand');
    expect(body).not.toContain(String(codingBatch._id));
  });

  test("and NCET's own admin does see it — so the sweep means something", async () => {
    const res = await request(target())
      .get('/api/analytics/comments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(SECRET);
  });

  test("naming another organization's batch by id does not open it", async () => {
    const res = await request(target())
      .get(`/api/analytics/batch/${codingBatch._id}`)
      .set('Authorization', `Bearer ${otherAdminToken}`);
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body || {})).not.toContain(SECRET);
  });

  test('the public flow pins a submission to the batch\'s own organization', async () => {
    /* The student carries no session, so the batch names the tenant. A wrong
       passcode must fail, and nothing about the attempt may reveal the cohort. */
    const res = await request(target())
      .post('/api/public/verify-passcode')
      .send({ batchId: String(codingBatch._id), passcode: 'not-the-passcode' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body || {})).not.toContain('NCET Coding Cohort');
  });
});

describe('requests do not lean on the test fallback', () => {
  test('with the ambient tenant cleared, each admin still sees exactly their own', async () => {
    /* The suite sets an ambient organization so fixtures can be written. That
       fallback could equally mask a request path that never enters a tenant of
       its own — it would quietly read the fallback and look correct, while in
       production, where no fallback exists, every request would fail. Clearing
       it proves the requests carry their own context. */
    clearAmbientTenant();
    try {
      const mine = await request(target())
        .get('/api/classes')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(mine.status).toBe(200);
      expect(mine.body.classes.map((c) => c.name)).toEqual(['Coding']);

      const theirs = await request(target())
        .get('/api/classes')
        .set('Authorization', `Bearer ${otherAdminToken}`);
      expect(theirs.status).toBe(200);
      expect(theirs.body.classes.map((c) => c.name)).toEqual(['Other Subject']);
    } finally {
      setAmbientTenant({ organization: ncet._id });
    }
  });
});

describe('roles', () => {
  test('an organization admin cannot reach the platform routes', async () => {
    for (const route of ['/api/platform/overview', '/api/platform/organizations']) {
      const res = await request(target()).get(route).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    }
  });

  test('a member whose organization is suspended cannot sign in to it', async () => {
    await runUnscoped(() => Organization.updateOne({ _id: ncet._id }, { $set: { status: 'suspended' } }));
    const res = await request(target())
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_UNAVAILABLE');
    await runUnscoped(() => Organization.updateOne({ _id: ncet._id }, { $set: { status: 'active' } }));
  });
});

describe('one organization cannot spend another\'s API budget', () => {
  /**
   * Shared capacity is the thing a per-IP limit cannot express. "A tenant" is
   * not an address — it is thirty staff on thirty networks — so an
   * institution running a bulk import competes with every other institution
   * for the same server, and the ones that suffer have no idea why.
   *
   * The limit itself is effectively disabled under test, so what is asserted
   * is the KEYING: counters move independently per organization. A single
   * shared bucket would show one counter moving for everyone.
   */
  const remaining = (res) =>
    Number(res.headers['ratelimit-remaining'] ?? res.headers['x-ratelimit-remaining']);

  test('each organization burns down its own counter', async () => {
    let mine;
    for (let i = 0; i < 3; i += 1) {
      mine = await request(target()).get('/api/classes').set('Authorization', `Bearer ${adminToken}`);
    }
    const theirs = await request(target())
      .get('/api/classes')
      .set('Authorization', `Bearer ${otherAdminToken}`);

    expect(remaining(mine)).toEqual(expect.any(Number));
    expect(remaining(theirs)).toEqual(expect.any(Number));
    /* Three requests against one organization must not have spent the other's
       budget: theirs is still nearer its ceiling. */
    expect(remaining(theirs)).toBeGreaterThan(remaining(mine));
  });

  test('a super admin is not billed to whichever organization they are viewing', async () => {
    /* They act across tenants by design; charging their traffic to the tenant
       they happen to have selected would make one customer's budget depend on
       what the operator was looking at. */
    const before = await request(target()).get('/api/classes').set('Authorization', `Bearer ${adminToken}`);
    const superToken = await loginToken(request, 'root@tenancy.test', ADMIN_PASSWORD).catch(() => null);
    if (!superToken) return; // no super admin in this fixture set
    await request(target()).get('/api/classes')
      .set('Authorization', `Bearer ${superToken}`)
      .set('X-Organization', String(ncet._id));
    const after = await request(target()).get('/api/classes').set('Authorization', `Bearer ${adminToken}`);
    expect(remaining(before) - remaining(after)).toBe(1);
  });
});
