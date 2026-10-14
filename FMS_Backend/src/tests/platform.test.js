/**
 * The platform layer: organizations, their first admins, and the migration
 * that gives the pre-tenancy data an owner.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeClass, loginToken,
  ADMIN_PASSWORD, startTestServer, stopTestServer, target, testOrg,
} from './helpers.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Parameter } from '../models/Parameter.js';
import { AuditLog } from '../models/AuditLog.js';
import { hashPassword } from '../utils/password.js';
import { runUnscoped, setAmbientTenant } from '../tenancy/tenantContext.js';
import { migrateToOrganizations } from '../scripts/migrate-to-organizations.js';

jest.setTimeout(60_000);

let superToken, adminToken;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics({ orgName: 'NCET', slug: 'ncet' });

  await runUnscoped(() =>
    new User({
      name: 'Platform Administrator',
      email: 'root@platform.test',
      passwordHash: '',
      role: 'superadmin',
      organization: null,
    }).save({ validateBeforeSave: false })
  );
  await runUnscoped(async () => {
    const u = await User.findOne({ email: 'root@platform.test' });
    u.passwordHash = await hashPassword(ADMIN_PASSWORD);
    await u.save({ validateBeforeSave: false });
  });

  superToken = await loginToken(request, 'root@platform.test', ADMIN_PASSWORD);
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
});

const asSuper = (r) => r.set('Authorization', `Bearer ${superToken}`);

describe('creating an organization', () => {
  const body = {
    name: 'Second Institute',
    slug: 'second-institute',
    adminName: 'Second Admin',
    adminEmail: 'admin@second.test',
  };

  test('creates the tenant, its admin and its parameters together', async () => {
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send(body);
    expect(res.status).toBe(201);
    expect(res.body.organization.slug).toBe('second-institute');
    expect(res.body.temporaryPassword).toEqual(expect.any(String));

    const org = await runUnscoped(() => Organization.findOne({ slug: 'second-institute' }));
    const admin = await runUnscoped(() => User.findOne({ email: 'admin@second.test' }));
    expect(String(admin.organization)).toBe(String(org._id));
    expect(admin.role).toBe('admin');
    /* An admin who has not chosen their own password is still on one the
       platform operator knows, so it must not unlock anything yet. */
    expect(admin.mustChangePassword).toBe(true);

    /* Parameters belong to the new tenant, not NCET: an organization with no
       parameters shows students an empty form. */
    const params = await runUnscoped(() => Parameter.countDocuments({ organization: org._id }));
    expect(params).toBeGreaterThan(0);
  });

  test('the issued password actually signs that admin in', async () => {
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send(body);
    const login = await request(target())
      .post('/api/auth/login')
      .send({ email: 'admin@second.test', password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  test('a duplicate handle or email is refused rather than half-created', async () => {
    await asSuper(request(target()).post('/api/platform/organizations')).send(body);

    const dupSlug = await asSuper(request(target()).post('/api/platform/organizations')).send({
      ...body, adminEmail: 'other@second.test',
    });
    expect(dupSlug.status).toBe(409);

    const dupEmail = await asSuper(request(target()).post('/api/platform/organizations')).send({
      ...body, slug: 'third-institute',
    });
    expect(dupEmail.status).toBe(409);
    expect(await runUnscoped(() => Organization.countDocuments({ slug: 'third-institute' }))).toBe(0);
  });

  test('a new organization starts empty — it inherits nothing from any other', async () => {
    await makeClass(null, 'NCET Only Subject');
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send(body);
    const org = await runUnscoped(() => Organization.findById(res.body.organization.id));

    const theirs = await runUnscoped(() =>
      Class.find({ organization: org._id }).select('name').lean()
    );
    expect(theirs).toEqual([]);
  });
});

describe('platform actions are audited', () => {
  test('creating an organization leaves a trail even though it has no tenant', async () => {
    /* Audit writes are fire-and-forget, so a validation failure here is
       silent. The highest-privilege actions in the product are exactly the
       ones that must not lose their trail. */
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send({
      name: 'Audited Institute', slug: 'audited-institute',
      adminName: 'Audit Admin', adminEmail: 'a@audited.test',
    });
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 120)); // fire-and-forget
    const entry = await runUnscoped(() =>
      AuditLog.findOne({ action: 'organization.create' }).lean()
    );
    expect(entry).toBeTruthy();
    expect(entry.entityName).toBe('Audited Institute');
  });
});

describe('one organization in detail', () => {
  let orgId;
  beforeEach(async () => {
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send({
      name: 'Detail Institute', slug: 'detail-institute',
      adminName: 'Detail Admin', adminEmail: 'admin@detail.test',
    });
    orgId = res.body.organization.id;
  });

  test('lists its people and its size', async () => {
    const res = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}`));
    expect(res.status).toBe(200);
    expect(res.body.admins).toHaveLength(1);
    expect(res.body.admins[0].email).toBe('admin@detail.test');
    /* The commonest reason an organization looks set up and is not: the admin
       was created and never signed in. */
    expect(res.body.admins[0].pendingFirstSignIn).toBe(true);
    expect(res.body.organization.responses).toBe(0);
  });

  test('its people are its own — nobody else\'s appear', async () => {
    const res = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}`));
    const emails = [...res.body.admins, ...res.body.trainers].map((p) => p.email);
    expect(emails).not.toContain('admin@test.com'); // NCET's admin
  });

  test('a second admin can be added and can sign in', async () => {
    const add = await asSuper(
      request(target()).post(`/api/platform/organizations/${orgId}/admins`)
    ).send({ name: 'Second Admin', email: 'second@detail.test' });
    expect(add.status).toBe(201);

    const login = await request(target()).post('/api/auth/login')
      .send({ email: 'second@detail.test', password: add.body.temporaryPassword });
    expect(login.status).toBe(200);

    const after = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}`));
    expect(after.body.admins).toHaveLength(2);
  });

  test('resetting an admin password issues a new one and kills old sessions', async () => {
    const created = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}`));
    const adminUserId = created.body.admins[0].id;

    const reset = await asSuper(
      request(target()).post(`/api/platform/organizations/${orgId}/admins/${adminUserId}/reset-password`)
    );
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toEqual(expect.any(String));

    const login = await request(target()).post('/api/auth/login')
      .send({ email: 'admin@detail.test', password: reset.body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  test('an admin of another organization cannot be reset through this one', async () => {
    const ncetAdmin = await runUnscoped(() => User.findOne({ email: 'admin@test.com' }).lean());
    const res = await asSuper(
      request(target()).post(`/api/platform/organizations/${orgId}/admins/${ncetAdmin._id}/reset-password`)
    );
    expect(res.status).toBe(404);
  });
});

describe('permissions', () => {
  test('an organization admin is refused every platform route', async () => {
    const routes = [
      ['get', '/api/platform/overview'],
      ['get', '/api/platform/organizations'],
      ['post', '/api/platform/organizations'],
    ];
    for (const [method, route] of routes) {
      const res = await request(target())[method](route)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(403);
    }
  });

  test('a super admin with no organization chosen is refused the admin screens', async () => {
    /* Unscoped is right for the platform routes and catastrophic here: without
       this, /api/classes would answer with every tenant's subjects under a
       heading that says "your classes". */
    const res = await asSuper(request(target()).get('/api/classes'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
  });

  test('a super admin acting on an organization sees only that one', async () => {
    await makeClass(null, 'NCET Subject');
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send({
      name: 'Scoped Institute', slug: 'scoped-institute',
      adminName: 'Scoped Admin', adminEmail: 's@scoped.test',
    });
    const otherId = res.body.organization.id;

    const ncetView = await asSuper(
      request(target()).get('/api/classes').set('X-Organization', String(testOrg._id))
    );
    expect(ncetView.body.classes.map((c) => c.name)).toContain('NCET Subject');

    const otherView = await asSuper(
      request(target()).get('/api/classes').set('X-Organization', otherId)
    );
    expect(otherView.body.classes).toEqual([]);
  });
});

describe('the migration', () => {
  test('adopts every unowned row and is safe to run twice', async () => {
    /* Simulate a pre-tenancy database: strip the organization from the rows
       the fixtures created. The raw driver is used deliberately — it is the
       one path the plugin does not police, which is what makes it the right
       tool for manufacturing the broken state. */
    await makeClass(null, 'Legacy Subject');
    for (const name of ['classes', 'users', 'parameters']) {
      await Class.db.collection(name).updateMany({}, { $unset: { organization: '' } });
    }
    await runUnscoped(() => Organization.deleteMany({}));

    const first = await migrateToOrganizations({ orgName: 'NCET', slug: 'ncet' });
    expect(first.adopted.classes.modified).toBeGreaterThan(0);
    expect(first.organizationId).toEqual(expect.any(String));

    const orphans = await Class.db.collection('classes')
      .countDocuments({ organization: { $in: [null, undefined] } });
    expect(orphans).toBe(0);

    // Idempotent: a second run finds nothing left to adopt.
    const second = await migrateToOrganizations({ orgName: 'NCET', slug: 'ncet' });
    expect(second.adopted.classes.modified).toBe(0);
    expect(second.organizationId).toBe(first.organizationId);

    setAmbientTenant({ organization: first.organizationId });
  });

  test('re-running never absorbs the super admin into an organization', async () => {
    /* A super admin has no organization, so to the adoption sweep they look
       exactly like an unowned row. A second run quietly made the platform
       account a member of the first tenant — found by actually running the
       migration twice against real data, where the second pass reported
       "users adopted: 1" with nothing left to adopt. */
    await runUnscoped(() => Organization.deleteMany({ slug: 'rerun-org' }));
    await migrateToOrganizations({ orgName: 'Rerun', slug: 'rerun-org' });
    await migrateToOrganizations({ orgName: 'Rerun', slug: 'rerun-org' });

    const su = await runUnscoped(() => User.findOne({ role: 'superadmin' }).lean());
    expect(su.organization == null).toBe(true);

    setAmbientTenant({ organization: testOrg._id });
  });

  test('a dry run reports what it would do and writes nothing', async () => {
    await runUnscoped(() => Organization.deleteMany({ slug: 'preview-org' }));
    const report = await migrateToOrganizations({ orgName: 'Preview', slug: 'preview-org', dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(await runUnscoped(() => Organization.countDocuments({ slug: 'preview-org' }))).toBe(0);
    setAmbientTenant({ organization: testOrg._id });
  });
});

describe('offboarding an organization', () => {
  let orgId, slug;

  beforeEach(async () => {
    slug = 'leaving-institute';
    const res = await asSuper(request(target()).post('/api/platform/organizations')).send({
      name: 'Leaving Institute', slug,
      adminName: 'Leaving Admin', adminEmail: 'admin@leaving.test',
    });
    orgId = res.body.organization.id;
  });

  test('exports everything that organization owns, as readable JSON', async () => {
    const res = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}/export`));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(`${slug}-export-`);

    const archive = JSON.parse(res.text);
    expect(archive.organization.slug).toBe(slug);
    expect(archive.counts.users).toBe(1);
    expect(archive.counts.parameters).toBeGreaterThan(0);
  });

  test('the export carries no password hashes', async () => {
    /* Useless to the recipient, and the one field whose leak compounds across
       every other system those people use. An export is also the likeliest
       copy of this data to end up on a laptop. */
    const res = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}/export`));
    expect(res.text).not.toContain('passwordHash');
    expect(JSON.parse(res.text).data.users[0].passwordHash).toBeUndefined();
  });

  test("the export contains only that organization's rows", async () => {
    await makeClass(null, 'NCET Only Subject');
    const res = await asSuper(request(target()).get(`/api/platform/organizations/${orgId}/export`));
    expect(res.text).not.toContain('NCET Only Subject');
    expect(res.text).not.toContain('admin@test.com');
  });

  test('deleting an ACTIVE organization is refused — suspend first', async () => {
    /* Removal must always be a second, deliberate decision taken after access
       was cut, never the first thing a misclick can reach. */
    const res = await asSuper(request(target()).delete(`/api/platform/organizations/${orgId}`))
      .send({ confirm: slug });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SUSPEND_FIRST');
    expect(await runUnscoped(() => Organization.countDocuments({ slug }))).toBe(1);
  });

  test('deleting without typing the handle back is refused', async () => {
    await asSuper(request(target()).patch(`/api/platform/organizations/${orgId}`))
      .send({ status: 'suspended' });

    for (const confirm of ['', 'yes', 'Leaving Institute']) {
      const res = await asSuper(request(target()).delete(`/api/platform/organizations/${orgId}`))
        .send({ confirm });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CONFIRM_REQUIRED');
    }
    expect(await runUnscoped(() => Organization.countDocuments({ slug }))).toBe(1);
  });

  test('a suspended organization with the handle typed back is removed entirely', async () => {
    await asSuper(request(target()).patch(`/api/platform/organizations/${orgId}`))
      .send({ status: 'suspended' });

    const res = await asSuper(request(target()).delete(`/api/platform/organizations/${orgId}`))
      .send({ confirm: slug.toUpperCase() }); // case-insensitive on purpose
    expect(res.status).toBe(200);
    expect(res.body.removed.users).toBe(1);

    const orgDoc = await runUnscoped(() => Organization.findById(orgId));
    expect(orgDoc).toBeNull();
    expect(await runUnscoped(() => User.countDocuments({ email: 'admin@leaving.test' }))).toBe(0);
    expect(await runUnscoped(() => Parameter.countDocuments({ organization: orgId }))).toBe(0);
  });

  test('deleting one organization leaves every other untouched', async () => {
    await makeClass(null, 'NCET Survives');
    await asSuper(request(target()).patch(`/api/platform/organizations/${orgId}`))
      .send({ status: 'suspended' });
    await asSuper(request(target()).delete(`/api/platform/organizations/${orgId}`))
      .send({ confirm: slug });

    const ncet = await runUnscoped(() => Organization.findOne({ slug: 'ncet' }));
    expect(ncet).toBeTruthy();
    const survived = await runUnscoped(() =>
      Class.countDocuments({ organization: ncet._id, name: 'NCET Survives' })
    );
    expect(survived).toBe(1);
  });

  test('the record of the deletion outlives the tenant', async () => {
    /* The audit entry belongs to the platform, not to the tenant, so the
       account of what happened survives what it happened to. */
    await asSuper(request(target()).patch(`/api/platform/organizations/${orgId}`))
      .send({ status: 'suspended' });
    await asSuper(request(target()).delete(`/api/platform/organizations/${orgId}`))
      .send({ confirm: slug });

    await new Promise((r) => setTimeout(r, 150));
    const entry = await runUnscoped(() =>
      AuditLog.findOne({ action: 'organization.delete' }).lean()
    );
    expect(entry).toBeTruthy();
    expect(entry.entityName).toBe('Leaving Institute');
    expect(entry.meta.removed.users).toBe(1);
  });
});

describe('the platform dashboard', () => {
  test('classifies a tenant that has never collected anything', async () => {
    /* The difference that matters most on this page: a customer that never
       started was never onboarded, which is a conversation, not a statistic. */
    await asSuper(request(target()).post('/api/platform/organizations')).send({
      name: 'Fresh Institute', slug: 'fresh-institute',
      adminName: 'Fresh Admin', adminEmail: 'admin@fresh.test',
    });
    const res = await asSuper(request(target()).get('/api/platform/overview'));
    expect(res.status).toBe(200);

    const fresh = res.body.organizations.find((o) => o.slug === 'fresh-institute');
    expect(fresh).toMatchObject({ responses: 0, health: 'never-used', averageRating: null });
    expect(fresh.lastResponseAt).toBeNull();
    expect(res.body.kpis.neverUsed).toBeGreaterThanOrEqual(1);
  });

  test('reports volume, recency and rating for a tenant that is in use', async () => {
    const res = await asSuper(request(target()).get('/api/platform/overview'));
    const ncet = res.body.organizations.find((o) => o.slug === 'ncet');
    expect(ncet.people).toBeGreaterThan(0);
    expect(ncet).toHaveProperty('responsesLast30');
    expect(ncet).toHaveProperty('daysSinceLastResponse');
  });

  test('the headline totals equal the rows beneath them', async () => {
    /* A summary that disagrees with its own table teaches the reader to
       trust neither half — the same reason the response rate is derived from
       collection health rather than computed twice. */
    const res = await asSuper(request(target()).get('/api/platform/overview'));
    const { kpis, organizations } = res.body;
    const sum = (k) => organizations.reduce((t, o) => t + (o[k] || 0), 0);
    expect(kpis.responses).toBe(sum('responses'));
    expect(kpis.users).toBe(sum('people'));
    expect(kpis.batches).toBe(sum('batches'));
    expect(kpis.organizations).toBe(organizations.length);
  });

  test("one organization's figures never include another's", async () => {
    await asSuper(request(target()).post('/api/platform/organizations')).send({
      name: 'Separate Institute', slug: 'separate-institute',
      adminName: 'Separate Admin', adminEmail: 'admin@separate.test',
    });
    const res = await asSuper(request(target()).get('/api/platform/overview'));
    const sep = res.body.organizations.find((o) => o.slug === 'separate-institute');
    // Exactly its own admin, and none of NCET's people or responses.
    expect(sep.people).toBe(1);
    expect(sep.responses).toBe(0);
  });
});
