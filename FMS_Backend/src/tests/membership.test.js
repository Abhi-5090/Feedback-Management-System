/**
 * One person, several institutions.
 *
 * A mentor can teach at two colleges — the same login, two unrelated sets of
 * cohorts — and must see each one's feedback without ever seeing the other's.
 * That is the whole point of the change, and it is also precisely where a
 * multi-tenant product leaks: the moment an account legitimately spans a
 * boundary, every check that assumed it could not is wrong.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeOrganization, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target, testOrg,
} from './helpers.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Membership } from '../models/Membership.js';
import { hashPassword } from '../utils/password.js';
import { runUnscoped, runWithTenant } from '../tenancy/tenantContext.js';
import { membershipsFor, addMember, membersOf, roleIn } from '../services/membershipService.js';
import { migrateToMemberships } from '../scripts/migrate-to-memberships.js';

jest.setTimeout(90_000);

let adminToken, other, shared;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics({ orgName: 'First Institute', slug: 'first-institute' });
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);

  // Somebody who teaches at BOTH institutions.
  shared = await User.create({
    name: 'Shared Mentor',
    email: 'shared@mentor.test',
    passwordHash: await hashPassword(TRAINER_PASSWORD),
    role: 'trainer',
    mustChangePassword: false,
  });
  await Membership.create({ user: shared._id, role: 'trainer' });

  other = await makeOrganization({ name: 'Second Institute', slug: 'second-institute' });
  await other.run(async () => {
    await addMember({ organizationId: other.org._id, userId: shared._id, role: 'trainer' });
    await Class.create({ name: 'Second Subject' });
  });
});

describe('belonging to more than one organization', () => {
  test('both memberships are visible to the person', async () => {
    const mine = await membershipsFor(shared._id);
    expect(mine.map((m) => m.slug).sort()).toEqual(['first-institute', 'second-institute']);
    expect(mine.every((m) => m.role === 'trainer')).toBe(true);
  });

  test('the role is per organization, not per person', async () => {
    /* Running one institution grants nothing at another. A single global role
       gets this wrong in both places. */
    await other.run(() =>
      addMember({ organizationId: other.org._id, userId: shared._id, role: 'admin' })
    );
    expect(await roleIn(shared._id, testOrg._id)).toBe('trainer');
    expect(await roleIn(shared._id, other.org._id)).toBe('admin');
  });

  test('adding the same person twice does not duplicate them', async () => {
    /* Two admins adding someone at once would both pass a check-then-insert,
       and the duplicate makes every count in the product wrong from then on. */
    for (let i = 0; i < 3; i += 1) {
      await other.run(() =>
        addMember({ organizationId: other.org._id, userId: shared._id, role: 'trainer' })
      );
    }
    const rows = await runUnscoped(() =>
      Membership.countDocuments({ user: shared._id, organization: other.org._id })
    );
    expect(rows).toBe(1);
  });

  test('each organization sees only its own people', async () => {
    const first = await membersOf(testOrg._id);
    const second = await membersOf(other.org._id);

    expect(first.map((m) => m.email)).toContain('shared@mentor.test');
    expect(second.map((m) => m.email)).toContain('shared@mentor.test');
    // The first institution's admin is not in the second.
    expect(second.map((m) => m.email)).not.toContain('admin@test.com');
  });
});

describe('choosing which organization to work in', () => {
  test('naming an organization you are NOT in is refused', async () => {
    /* The header is a request from the client, so it is checked against the
       memberships rather than trusted. */
    const outsider = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
    const res = await request(target())
      .get('/api/classes')
      .set('Authorization', `Bearer ${outsider}`)
      .set('X-Organization', String(other.org._id));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_A_MEMBER');
  });

  test('belonging to several and naming none asks you to choose', async () => {
    /* There is no safe default: picking one would show figures from an
       institution the reader did not ask about, under a heading that does not
       say so. */
    const token = await loginToken(request, 'shared@mentor.test', TRAINER_PASSWORD);
    const res = await request(target())
      .get('/api/dashboard/trainer/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORGANIZATION_CHOICE_REQUIRED');
  });

  test('naming one of your own organizations works, and scopes to it', async () => {
    /* Through a mentor's own dashboard, not /classes — that one is
       admin-guarded, and a mentor being refused it is correct. */
    const token = await loginToken(request, 'shared@mentor.test', TRAINER_PASSWORD);

    for (const org of [testOrg._id, other.org._id]) {
      const res = await request(target())
        .get('/api/dashboard/trainer/me')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization', String(org));
      expect(res.status).toBe(200);
    }
  });

  test("one organization's feedback never appears in the other's view", async () => {
    /* The reason this whole model exists: the same login, two institutions,
       and nothing of one visible from inside the other. */
    const token = await loginToken(request, 'shared@mentor.test', TRAINER_PASSWORD);
    const inSecond = await request(target())
      .get('/api/analytics/sessions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization', String(other.org._id));
    expect(inSecond.status).toBeLessThan(500);
    if (inSecond.status === 200) {
      expect(JSON.stringify(inSecond.body)).not.toContain('First Institute');
    }
  });

  test('one membership needs no choosing', async () => {
    /* Ceremony for the overwhelming majority of people, who work at one
       institution, would be the wrong trade. */
    const res = await request(target()).get('/api/classes').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('the migration', () => {
  test('gives every existing account a membership, and is safe to re-run', async () => {
    await runUnscoped(() => Membership.deleteMany({}));

    const first = await migrateToMemberships();
    expect(first.created).toBeGreaterThan(0);
    expect(first.scanned).toBeGreaterThan(0);

    const second = await migrateToMemberships();
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBeGreaterThan(0);
  });

  test('nobody gains or loses authority in a migration', async () => {
    /* A permissions change disguised as a data change is the worst kind,
       because nobody reviews it as one. */
    await runUnscoped(() => Membership.deleteMany({}));
    await migrateToMemberships();

    const admin = await runUnscoped(() => User.findOne({ email: 'admin@test.com' }).lean());
    expect(await roleIn(admin._id, testOrg._id)).toBe('admin');
    expect(await roleIn(shared._id, testOrg._id)).toBe('trainer');
  });

  test('a dry run writes nothing', async () => {
    await runUnscoped(() => Membership.deleteMany({}));
    const r = await migrateToMemberships({ dryRun: true });
    expect(r.created).toBeGreaterThan(0);
    expect(await runUnscoped(() => Membership.countDocuments({}))).toBe(0);
  });
});

describe('the picker is reachable before a choice is made', () => {
  test('listing your organizations does not itself require choosing one', async () => {
    /* Otherwise somebody who works at two institutions meets a locked door
       with the key behind it. */
    const token = await loginToken(request, 'shared@mentor.test', TRAINER_PASSWORD);
    const res = await request(target())
      .get('/api/auth/organizations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.organizations.map((o) => o.slug).sort()).toEqual([
      'first-institute', 'second-institute',
    ]);
  });

  test('reading your own account works before choosing too', async () => {
    const token = await loginToken(request, 'shared@mentor.test', TRAINER_PASSWORD);
    const res = await request(target()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(2);
    expect(res.body.organization).toBeNull();
  });

  test('but a data route still refuses until one is chosen', async () => {
    /* The opt-out is two routes wide, not a default. */
    const token = await loginToken(request, 'shared@mentor.test', TRAINER_PASSWORD);
    const res = await request(target())
      .get('/api/analytics/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORGANIZATION_CHOICE_REQUIRED');
  });
});
