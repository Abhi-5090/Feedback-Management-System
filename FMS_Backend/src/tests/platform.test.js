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

  test('a dry run reports what it would do and writes nothing', async () => {
    await runUnscoped(() => Organization.deleteMany({ slug: 'preview-org' }));
    const report = await migrateToOrganizations({ orgName: 'Preview', slug: 'preview-org', dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(await runUnscoped(() => Organization.countDocuments({ slug: 'preview-org' }))).toBe(0);
    setAmbientTenant({ organization: testOrg._id });
  });
});
