/**
 * Adding somebody who already works somewhere else.
 *
 * This is the path the whole membership model exists for, and it used to end
 * in "Duplicate entry" — the lookup ran inside the organization, so a mentor
 * at another college was invisible, and the create that followed collided
 * with the global unique index on email.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeOrganization, loginToken,
  ADMIN_PASSWORD, startTestServer, stopTestServer, target, testOrg,
} from './helpers.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { AuditLog } from '../models/AuditLog.js';
import { hashPassword } from '../utils/password.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { membershipsFor, membersOf } from '../services/membershipService.js';

jest.setTimeout(90_000);

const THEIR_PASSWORD = 'Harbour-Lantern-42';
let adminToken, other, elsewhere;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics({ orgName: 'First Institute', slug: 'first-institute' });
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);

  other = await makeOrganization({ name: 'Other Institute', slug: 'other-institute' });
  await other.run(async () => {
    elsewhere = await User.create({
      name: 'Meera Mentor',
      email: 'meera@elsewhere.test',
      passwordHash: await hashPassword(THEIR_PASSWORD),
      role: 'trainer',
      mustChangePassword: false,
    });
    await Membership.create({ user: elsewhere._id, role: 'trainer' });
  });
});

const add = (body) =>
  request(target()).post('/api/trainers').set('Authorization', `Bearer ${adminToken}`).send(body);

describe('adding a mentor who already has an account', () => {
  test('adds them to this organization instead of failing', async () => {
    const res = await add({
      name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99',
    });
    expect(res.status).toBe(201);
    expect(res.body.addedExisting).toBe(true);
    expect(res.body.trainer.id).toBe(String(elsewhere._id));
  });

  test('no second account is created for the same person', async () => {
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });
    const accounts = await runUnscoped(() =>
      User.countDocuments({ email: 'meera@elsewhere.test' })
    );
    expect(accounts).toBe(1);
  });

  test('their existing password still works, and the new one is ignored', async () => {
    /* Issuing a fresh credential for an account somebody already uses is both
       confusing and a reason to reset something that did not need resetting. */
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });
    await expect(loginToken(request, 'meera@elsewhere.test', THEIR_PASSWORD)).resolves.toEqual(
      expect.any(String)
    );
    await expect(loginToken(request, 'meera@elsewhere.test', 'Ignored-Pass-99')).rejects.toThrow();
  });

  test('they now belong to BOTH institutions', async () => {
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });
    const mine = await membershipsFor(elsewhere._id);
    expect(mine.map((m) => m.slug).sort()).toEqual(['first-institute', 'other-institute']);
  });

  test('and appear in this organization\'s mentor list', async () => {
    /* The tenant filter matches on the array, so the organization has to be
       added to it or a new member stays invisible to every scoped query. */
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });
    const res = await request(target()).get('/api/trainers').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const emails = (res.body.trainers || res.body.items || []).map((t) => t.email);
    expect(emails).toContain('meera@elsewhere.test');
  });

  test('adding them twice is refused with a sentence that says why', async () => {
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });
    const again = await add({
      name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_A_MEMBER');
    expect(again.body.error).toMatch(/already in this organization/i);
  });

  test('it is audited, because it grants access to a stranger', async () => {
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });
    await new Promise((r) => setTimeout(r, 150));
    const entry = await runUnscoped(() => AuditLog.findOne({ action: 'trainer.add_existing' }).lean());
    expect(entry).toBeTruthy();
    expect(entry.entityName).toBe('Meera Mentor');
  });

  test('a platform account cannot be absorbed into an organization', async () => {
    await runUnscoped(async () => {
      const root = new User({
        name: 'Root', email: 'root@platform.test',
        passwordHash: await hashPassword(THEIR_PASSWORD), role: 'superadmin', organization: [],
      });
      await root.save({ validateBeforeSave: false });
    });
    const res = await add({ name: 'Root', email: 'root@platform.test', password: 'x-Pass-1234' });
    expect(res.status).toBe(409);
  });
});

describe('what one organization may learn about another', () => {
  test("an admin never sees which OTHER institutions their mentor works at", async () => {
    /* Adding somebody tells you they exist. It must not tell you where else
       they teach — that is another customer's staff list. */
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });

    const list = await request(target()).get('/api/trainers').set('Authorization', `Bearer ${adminToken}`);
    expect(JSON.stringify(list.body)).not.toContain('other-institute');
    expect(JSON.stringify(list.body)).not.toContain('Other Institute');

    const members = await membersOf(testOrg._id);
    expect(JSON.stringify(members)).not.toContain('Other Institute');
  });

  test('removing them here leaves the other institution untouched', async () => {
    await add({ name: 'Meera Mentor', email: 'meera@elsewhere.test', password: 'Ignored-Pass-99' });

    const res = await request(target())
      .delete(`/api/trainers/${elsewhere._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    /* The account survives, because they still have a job. */
    expect(res.body.accountDeleted).toBe(false);

    const left = await membershipsFor(elsewhere._id);
    expect(left.map((m) => m.slug)).toEqual(['other-institute']);
    await expect(loginToken(request, 'meera@elsewhere.test', THEIR_PASSWORD)).resolves.toEqual(
      expect.any(String)
    );
  });
});
