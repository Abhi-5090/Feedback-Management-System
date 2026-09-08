/**
 * Test harness: spins up an in-memory MongoDB REPLICA SET (so the feedback
 * transaction path is exercised, not just the fallback), connects via the
 * app's own connectDB (which runs the transaction-support probe), and seeds
 * the fixtures most tests need.
 *
 * MONGOMS_SYSTEM_BINARY is honoured if set, so CI/offline runs can point at a
 * local mongod instead of downloading a binary.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB, supportsTransactions } from '../config/db.js';
import { createApp } from '../app.js';
import { User } from '../models/User.js';
import { Parameter } from '../models/Parameter.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { hashPassword } from '../utils/password.js';
import { bustParameterCache } from '../services/parameterCache.js';

let replset;

export const DEFAULT_PARAMS = [
  'Content clarity',
  "Trainer's subject knowledge",
  'Pace of the session',
  'Engagement & interaction',
  'Doubt resolution',
  'Real-world / practical examples',
  'Quality of materials',
  'Overall experience',
];

/**
 * Passwords used by the fixtures. They must satisfy the real strength rules
 * (>= 8 chars, not on the ban list, not the user's own name) — using 'adminpass'
 * here would pass the fixture but fail the endpoint, which is the sort of
 * mismatch that makes a suite lie about what production accepts.
 */
export const ADMIN_PASSWORD = 'admin-fixture-2026';
export const TRAINER_PASSWORD = 'trainer-fixture-2026';

export async function startTestDB() {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDB(replset.getUri());
  return replset;
}

export async function stopTestDB() {
  await disconnectDB();
  if (replset) await replset.stop();
}

export async function resetDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  /* Wiping the database has to invalidate anything cached from it. The active
     parameter list is memoised for 15s (see services/parameterCache.js), and
     tests re-seed faster than that — so without this a test would hand the
     student a form pinned to the PREVIOUS test's parameter ids and every
     submission would fail validation. The cache is left ON for the rest of the
     run on purpose, so the caching path is exercised rather than bypassed. */
  bustParameterCache();
}

export { supportsTransactions };
export const app = createApp();

/**
 * Bind the app to ONE real ephemeral port for the duration of a test file.
 *
 * `request(app)` and `request.agent(app)` each start a throwaway server per
 * call. That is fine for a handful of requests and NOT fine for a concurrency
 * test: forty simulated students meant eighty servers being created and torn
 * down at once, which passed in isolation and failed intermittently inside the
 * full suite — a flaky test, which is worse than no test because it teaches
 * people to re-run rather than read.
 *
 * One long-lived server also matches how the code actually runs.
 */
let httpServer = null;
export function startTestServer() {
  if (httpServer) return `http://127.0.0.1:${httpServer.address().port}`;
  httpServer = app.listen(0);
  return `http://127.0.0.1:${httpServer.address().port}`;
}
export function stopTestServer() {
  if (httpServer) httpServer.close();
  httpServer = null;
}

/**
 * One simulated browser against that server: keeps its own cookie jar, exactly
 * as a student's phone would. Written on fetch rather than supertest so there
 * is one connection pool for the whole burst instead of one server per request.
 */
export function makeBrowser(baseUrl) {
  let cookie = '';
  return {
    async post(path, body) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { error: text };
      }
      return { status: res.status, body: parsed ?? {} };
    },
  };
}

/** Seed parameters + an admin. */
export async function seedBasics() {
  await Parameter.insertMany(DEFAULT_PARAMS.map((label, i) => ({ label, order: i })));
  const admin = await User.create({
    name: 'Admin',
    email: 'admin@test.com',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: 'admin',
  });
  return { admin };
}

export async function makeTrainer(email = 'trainer@test.com', name) {
  return User.create({
    name: name || `Trainer ${email}`,
    shortName: (name || email).split(/[\s@]/)[0],
    email,
    passwordHash: await hashPassword(TRAINER_PASSWORD),
    role: 'trainer',
  });
}

/**
 * A catalog subject. `trainerId` is the OPTIONAL default mentor — staffing is
 * decided per batch, so most fixtures leave it null and name the rosters on the
 * batch instead.
 */
export async function makeClass(trainerId = null, name = 'React Fundamentals') {
  return Class.create({ name, trainer: trainerId || null });
}

/**
 * A batch holding one or more subjects, each with a MAIN and SUPPORT roster.
 *
 * Accepts either shape:
 *   makeBatch({ classes: [{ class, mainTrainers, supportTrainers }], ... })
 *   makeBatch({ class: id, mainTrainers: [id], supportTrainers: [id], ... })
 * The second is the common single-subject case and keeps the tests readable.
 */
export async function makeBatch({
  classes,
  class: singleClass,
  mainTrainers = [],
  supportTrainers = [],
  name = 'Batch One',
  expectedCount = 2,
  yearGroup = 'First Year',
  dept = 'A, B',
} = {}) {
  const entries =
    classes ||
    [
      {
        class: singleClass,
        mainTrainers,
        supportTrainers,
      },
    ];
  return Batch.create({ classes: entries, name, expectedCount, yearGroup, dept });
}

/** Fetch active parameter ids to build a complete ratings array. */
export async function activeParamIds() {
  const params = await Parameter.find({ isActive: true }).sort({ order: 1 });
  return params.map((p) => String(p._id));
}

/** A full ratings array (every active parameter) at the given star value. */
export async function fullRatings(stars = 5) {
  const ids = await activeParamIds();
  return ids.map((parameter) => ({ parameter, stars }));
}

/**
 * Build the body for POST /api/public/feedback.
 *
 * The endpoint takes ONE block per class in the batch — a submission covers the
 * whole cohort, not a single subject — so this assembles a block for every
 * class id it is given.
 */
export async function feedbackBody({
  batchId,
  classIds,
  stars = 5,
  comment = 'A perfectly adequate comment for testing.',
  sessionToken,
  fingerprint = 'fp',
}) {
  const ratings = await fullRatings(stars);
  return {
    batchId: String(batchId),
    classes: classIds.map((classId) => ({ classId: String(classId), ratings, comment })),
    sessionToken,
    fingerprint,
  };
}

/**
 * Log in and return the Bearer token (header auth, so tests need no cookie jar).
 *
 * Targets the shared server when one is running — see `target()`.
 */
export async function loginToken(request, email, password) {
  const res = await request(target()).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

/**
 * What supertest should be pointed at: the shared server's URL if one has been
 * started, otherwise the app itself.
 *
 * WHY THIS MATTERS. `request(app)` starts a THROWAWAY server per call. The
 * isolation suite makes about ten HTTP calls per test in setup alone, so a
 * single run created a couple of hundred servers — and that churn produced
 * intermittent failures that looked like product bugs: a hook occasionally
 * exceeding its 60s timeout, and a request landing on a socket whose server
 * had already been torn down, surfacing as a bare 404. Both vanish when every
 * request goes to one long-lived server, which is also how the code really runs.
 *
 * Call `startTestServer()` in a top-level `beforeAll` and pass `target()` to
 * supertest instead of `app`.
 */
export function target() {
  return httpServer ? `http://127.0.0.1:${httpServer.address().port}` : app;
}
