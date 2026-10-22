/**
 * Somebody who works at two institutions must still be able to set their
 * password.
 *
 * The reported symptom was "set password is not working" for one mentor. He
 * had two memberships and `mustChangePassword` set, which is the exact
 * combination that deadlocks:
 *
 *   the client shows the change-password screen because he is locked
 *     → the change-password request needs an organization to be chosen
 *       → choosing one is a screen he cannot reach while locked
 *
 * Changing your own password is an act about YOU, not about an institution.
 * It has no business asking which one you are in.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeOrganization, testOrg,
  loginToken, TRAINER_PASSWORD, startTestServer, stopTestServer, target,
} from './helpers.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { hashPassword } from '../utils/password.js';
import { addMember } from '../services/membershipService.js';
import { repairUserOrganizations } from '../scripts/repair-user-organizations.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import mongoose from 'mongoose';

jest.setTimeout(90_000);

const NEW_PASSWORD = 'Harbour-Lantern-42';
let locked, other, testOrgId;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics({ orgName: 'First Institute', slug: 'first-institute' });

  locked = await User.create({
    name: 'Abhilash Two-Colleges',
    email: 'two@colleges.test',
    passwordHash: await hashPassword(TRAINER_PASSWORD),
    role: 'trainer',
    // Created by an admin, so held at the gate until he picks his own.
    mustChangePassword: true,
  });
  await Membership.create({ user: locked._id, role: 'trainer' });

  testOrgId = testOrg._id;
  other = await makeOrganization({ name: 'Second Institute', slug: 'second-institute' });
  await other.run(() =>
    addMember({ organizationId: other.org._id, userId: locked._id, role: 'trainer' })
  );
});

const auth = async () => {
  const token = await loginToken(request, 'two@colleges.test', TRAINER_PASSWORD);
  return (r) => r.set('Authorization', `Bearer ${token}`);
};

describe('a locked account with two memberships', () => {
  test('can read itself, so the screen can render at all', async () => {
    const as = await auth();
    const res = await as(request(target()).get('/api/auth/me'));
    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(2);
  });

  test('CAN SET ITS PASSWORD without first choosing an institution', async () => {
    /* The whole bug. Changing your own password is an act about you, not
       about an institution. */
    const as = await auth();
    const res = await as(request(target()).patch('/api/auth/me')).send({
      currentPassword: TRAINER_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
  });

  test('and the new password then works', async () => {
    const as = await auth();
    await as(request(target()).patch('/api/auth/me')).send({
      currentPassword: TRAINER_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    await expect(loginToken(request, 'two@colleges.test', NEW_PASSWORD)).resolves.toEqual(
      expect.any(String)
    );
  });

  test('the lock lifts once the password is their own', async () => {
    const as = await auth();
    await as(request(target()).patch('/api/auth/me')).send({
      currentPassword: TRAINER_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    const token = await loginToken(request, 'two@colleges.test', NEW_PASSWORD);
    const me = await request(target()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.mustChangePassword).toBe(false);
  });

  test('other self-management also works before choosing', async () => {
    /* All of these are about the person, not the institution. */
    const as = await auth();
    const digest = await as(request(target()).patch('/api/auth/me/digest'))
      .send({ enabled: true, frequency: 'weekly' });
    expect(digest.status).toBe(200);

    const twoFactor = await as(request(target()).post('/api/auth/2fa/start'));
    expect(twoFactor.status).toBe(200);

    const everywhere = await as(request(target()).post('/api/auth/logout-all'));
    expect(everywhere.status).toBeLessThan(400);
  });

  test('but a DATA route still demands the choice', async () => {
    /* The exemption is for self-management only. Feedback belongs to an
       institution, so reading it has to say which. */
    const as = await auth();
    const res = await as(request(target()).get('/api/analytics/sessions'));
    expect([400, 403]).toContain(res.status);
  });
});

describe('the tenant list and the memberships must agree', () => {
  test('a membership with no entry in the list makes somebody invisible to their own institution', async () => {
    /* The worse of the two faults: they ARE a member, every scoped query
       filters on the list, so they join and simply are not there. Nothing
       errors. */
    const before = await runUnscoped(() => User.findById(locked._id).lean());
    await runUnscoped(() =>
      User.updateOne({ _id: locked._id }, { $set: { organization: [before.organization[0]] } })
    );

    const visible = await other.run(() => User.countDocuments({ _id: locked._id }));
    expect(visible).toBe(0); // a member of this organization, invisible to it

    const report = await repairUserOrganizations();
    expect(report.gained).toBeGreaterThan(0);

    const after = await other.run(() => User.countDocuments({ _id: locked._id }));
    expect(after).toBe(1);
  });

  test('a scalar organization is reshaped into a list', async () => {
    /* $addToSet refuses to touch a non-array, so adding one of these people
       to a second institution fails at exactly the step that matters. */
    await runUnscoped(() =>
      User.collection.updateOne(
        { _id: locked._id },
        { $set: { organization: new mongoose.Types.ObjectId(String(testOrgId)) } }
      )
    );
    const raw = await runUnscoped(() => User.collection.findOne({ _id: locked._id }));
    expect(Array.isArray(raw.organization)).toBe(false);

    const report = await repairUserOrganizations();
    expect(report.reshaped).toBeGreaterThan(0);

    const fixed = await runUnscoped(() => User.collection.findOne({ _id: locked._id }));
    expect(Array.isArray(fixed.organization)).toBe(true);
    expect(fixed.organization).toHaveLength(2);
  });

  test('memberships are the truth, so a stale entry is pruned', async () => {
    /* A membership is what an admin created on purpose; the list is a
       denormalised index. When a cache and its source disagree, the source
       wins. */
    const ghost = new mongoose.Types.ObjectId();
    await runUnscoped(() =>
      User.updateOne({ _id: locked._id }, { $addToSet: { organization: ghost } })
    );

    const report = await repairUserOrganizations();
    expect(report.pruned).toBeGreaterThan(0);

    const after = await runUnscoped(() => User.findById(locked._id).lean());
    expect(after.organization.map(String)).not.toContain(String(ghost));
  });

  test('running it twice changes nothing the second time', async () => {
    await repairUserOrganizations();
    const second = await repairUserOrganizations();
    expect(second.reshaped).toBe(0);
    expect(second.gained).toBe(0);
    expect(second.pruned).toBe(0);
  });

  test('a dry run writes nothing', async () => {
    await runUnscoped(() =>
      User.collection.updateOne(
        { _id: locked._id },
        { $set: { organization: new mongoose.Types.ObjectId(String(testOrgId)) } }
      )
    );
    const r = await repairUserOrganizations({ dryRun: true });
    expect(r.reshaped).toBeGreaterThan(0);
    const raw = await runUnscoped(() => User.collection.findOne({ _id: locked._id }));
    expect(Array.isArray(raw.organization)).toBe(false);
  });
});
