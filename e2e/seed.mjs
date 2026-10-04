/**
 * Fixtures for the E2E run: one admin, one mentor, two subjects, one batch.
 *
 * Deliberately small. These tests are slow and exist to prove the FLOW works
 * in a browser — cookies, the device lock, the one-shot session token — not to
 * cover analytics, which the API suite already does far more cheaply.
 */
import { User } from '../FMS_Backend/src/models/User.js';
import { Class } from '../FMS_Backend/src/models/Class.js';
import { Batch } from '../FMS_Backend/src/models/Batch.js';
import { Parameter } from '../FMS_Backend/src/models/Parameter.js';
import { Phase } from '../FMS_Backend/src/models/Phase.js';
import { hashPassword } from '../FMS_Backend/src/utils/password.js';

export const ADMIN = { email: 'e2e-admin@test.local', password: 'e2e-admin-pass-2026' };
export const PARAMETERS = ['Content clarity', 'Pace of the session', 'Overall experience'];

export async function seedE2E() {
  await Promise.all([
    User.deleteMany({}), Class.deleteMany({}), Batch.deleteMany({}), Parameter.deleteMany({}),
    Phase.deleteMany({}),
  ]);

  /* One closed phase, so the page is reviewed with content rather than in its
     empty state — the empty state is already covered by a unit test. */
  const now = new Date();
  await Phase.create({
    name: 'Phase 1 — September 2026', code: 'P1',
    startsAt: new Date(Date.UTC(2026, 8, 1)), endsAt: new Date(Date.UTC(2026, 9, 1)),
    status: 'closed', closedAt: now, notes: 'First collection after the rollout.',
  });

  await Parameter.insertMany(PARAMETERS.map((label, order) => ({ label, order })));

  const admin = await User.create({
    name: 'E2E Admin',
    email: ADMIN.email,
    passwordHash: await hashPassword(ADMIN.password),
    role: 'admin',
    // Otherwise every test would have to clear the change-password gate first.
    mustChangePassword: false,
  });

  const mentor = await User.create({
    name: 'Bhargav Rao',
    shortName: 'Bhargav',
    email: 'e2e-mentor@test.local',
    passwordHash: await hashPassword('e2e-mentor-pass-2026'),
    role: 'trainer',
    mustChangePassword: false,
  });

  const genai = await Class.create({ name: 'GenAI', trainer: null });
  const coding = await Class.create({ name: 'Coding', trainer: null });

  /* TWO subjects on purpose. A single-subject batch would not catch the bug
     class that actually bites here: a student must rate every subject in the
     batch, and the submission is one transaction across both. */
  const batch = await Batch.create({
    name: 'E2E Cohort 2026',
    yearGroup: 'Third Year',
    dept: 'AIML',
    expectedCount: 25,
    classes: [
      { class: genai._id, mainTrainers: [mentor._id], supportTrainers: [] },
      { class: coding._id, mainTrainers: [mentor._id], supportTrainers: [] },
    ],
  });

  return {
    adminId: String(admin._id),
    batchId: String(batch._id),
    batchName: batch.name,
    classIds: [String(genai._id), String(coding._id)],
    parameterCount: PARAMETERS.length,
  };
}
