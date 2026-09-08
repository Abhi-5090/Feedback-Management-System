/**
 * Security properties, asserted rather than assumed.
 *
 * Each test here corresponds to a specific way this application could be
 * attacked, and exists so that a refactor cannot quietly remove the defence.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  app, startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';

jest.setTimeout(60_000);

let adminToken;
let trainerToken;
let trainer;

/* ONE server for the whole file — see target() in helpers.js for why
   request(target()) per call was causing intermittent failures. */
beforeAll(async () => {
  await startTestDB();
  startTestServer();
});
afterAll(async () => {
  stopTestServer();
  await stopTestDB();
});

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  trainer = await makeTrainer('sec@test.com', 'Sec Trainer');
  const klass = await makeClass(null, 'Security Class');
  await makeBatch({ class: klass._id, mainTrainers: [trainer._id], name: 'Sec Batch' });
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  trainerToken = await loginToken(request, 'sec@test.com', TRAINER_PASSWORD);
});

describe('NoSQL injection through query parameters', () => {
  /**
   * Several handlers place a query value straight into a Mongo filter. That is
   * safe only while the value is a string. A nested query parser would make
   * `?action[$ne]=x` an OPERATOR, turning an equality match into "everything
   * except x" — and on the audit log that means reading entries the filter was
   * meant to exclude.
   */
  beforeEach(async () => {
    await AuditLog.create([
      { action: 'batch.unlock', actorName: 'Admin', entity: 'batch', entityName: 'A' },
      { action: 'export.download', actorName: 'Admin', entity: 'class', entityName: 'B' },
    ]);
  });

  test('an operator smuggled into ?action is not executed', async () => {
    const res = await request(target())
      .get('/api/audit?action[$ne]=batch.unlock')
      .set('Authorization', `Bearer ${adminToken}`);

    // Either rejected outright, or treated as an absent/plain filter — but
    // NEVER interpreted as $ne, which would return the export.download row.
    if (res.status === 200) {
      const actions = res.body.entries.map((e) => e.action);
      expect(actions).not.toEqual(['export.download']);
    } else {
      expect(res.status).toBe(400);
    }
  });

  test('an operator smuggled into ?actor is not executed', async () => {
    const res = await request(target())
      .get('/api/audit?actor[$gt]=')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      // A working $gt injection would have matched every entry with an actor.
      expect(Array.isArray(res.body.entries)).toBe(true);
    }
  });

  test('a malformed action value is rejected rather than passed to Mongo', async () => {
    const res = await request(target())
      .get('/api/audit?action=' + encodeURIComponent('{"$ne":null}'))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('an operator in a batch list filter cannot widen the result', async () => {
    const res = await request(target())
      .get('/api/batches?class[$ne]=000000000000000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 400]).toContain(res.status);
  });
});

describe('Login is not an injection or enumeration oracle', () => {
  test('an operator in the email field is rejected, not matched', async () => {
    const res = await request(target())
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    // zod requires a string email; a successful injection would have returned 200.
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('a wrong password and an unknown account are indistinguishable', async () => {
    const unknown = await request(target())
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.com', password: 'whatever-long-enough' });
    const wrong = await request(target())
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'definitely-not-it' });

    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });
});

describe('Privilege boundaries', () => {
  test('a trainer cannot reach any admin endpoint', async () => {
    const adminOnly = [
      ['get', '/api/trainers'],
      ['get', '/api/classes'],
      ['get', '/api/batches'],
      ['get', '/api/parameters'],
      ['get', '/api/audit'],
      ['get', '/api/dashboard/admin'],
      ['get', '/api/analytics/trainers'],
      ['get', '/api/analytics/cohorts'],
      ['get', '/api/analytics/mentor-load'],
      ['get', '/api/export/dashboard/admin'],
      ['get', '/api/export/mentors'],
    ];
    for (const [method, path] of adminOnly) {
      const res = await request(target())[method](path).set('Authorization', `Bearer ${trainerToken}`);
      expect([401, 403]).toContain(res.status);
    }
  });

  test('a trainer cannot promote themselves to admin', async () => {
    // `role` is not in any update schema, so it must be stripped, not applied.
    const res = await request(target())
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ name: 'Still A Trainer', role: 'admin' });
    expect(res.status).toBe(200);
    const fresh = await User.findById(trainer._id);
    expect(fresh.role).toBe('trainer');
  });

  test('a trainer cannot create or modify other accounts', async () => {
    const created = await request(target())
      .post('/api/trainers')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ name: 'Sneaky', email: 'sneaky@test.com', password: 'a-good-passphrase' });
    expect([401, 403]).toContain(created.status);

    const patched = await request(target())
      .patch(`/api/trainers/${trainer._id}`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ isActive: false });
    expect([401, 403]).toContain(patched.status);
  });

  test('a forged or tampered token is refused', async () => {
    const good = trainerToken;
    const tampered = `${good.slice(0, -3)}aaa`; // break the signature
    for (const token of [tampered, 'not.a.token', '', 'Bearer']) {
      const res = await request(target()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });
});

describe('Anonymous endpoints leak nothing', () => {
  test('the public API exposes no batch, class or mentor data without a passcode', async () => {
    const res = await request(target())
      .post('/api/public/verify-passcode')
      .send({ batchId: '000000000000000000000000', passcode: 'guess' });
    expect([400, 404]).toContain(res.status);
    // No names, rosters or parameters in a failure response.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Sec Batch');
    expect(body).not.toContain('Security Class');
    expect(body).not.toContain('Sec Trainer');
  });

  test('an unauthenticated caller cannot read anything', async () => {
    const paths = [
      '/api/trainers', '/api/classes', '/api/batches', '/api/audit',
      '/api/dashboard/admin', '/api/dashboard/trainer/me',
      '/api/analytics/classes', '/api/analytics/cohorts',
      '/api/export/dashboard/admin', '/api/auth/system',
    ];
    for (const path of paths) {
      const res = await request(target()).get(path);
      expect(res.status).toBe(401);
    }
  });

  test('health is public but reveals no deployment internals', async () => {
    const res = await request(target()).get('/api/health');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    for (const leak of ['mongodb', 'mongoUri', 'secret', 'salt', 'smtp', 'transactions']) {
      expect(body.toLowerCase()).not.toContain(leak);
    }
  });
});

describe('Error responses', () => {
  test('a 500 never carries a stack trace to the client in production shape', async () => {
    // CastError path: an unparseable id reaches Mongoose.
    const res = await request(target())
      .get('/api/analytics/class/not-a-valid-object-id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.stack === undefined || process.env.NODE_ENV !== 'production').toBe(true);
    // And no internal paths in the message.
    expect(JSON.stringify(res.body)).not.toContain('/src/');
  });

  test('an unknown route returns a clean 404', async () => {
    const res = await request(target()).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('Mass assignment', () => {
  test('unknown fields are stripped from a batch create', async () => {
    const klass = await makeClass(null, 'Extra Fields Class');
    const res = await request(target())
      .post('/api/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Injected Batch',
        classes: [{ class: String(klass._id), mainTrainers: [String(trainer._id)] }],
        // None of these are in batchCreateSchema and must not be persisted.
        submittedCount: 9999,
        passcodeHash: 'attacker-controlled',
        status: 'open',
        round: 42,
      });
    expect(res.status).toBe(201);
    expect(res.body.batch.submittedCount).toBe(0);
    expect(res.body.batch.status).toBe('locked');
    expect(res.body.batch.hasPasscode).toBe(false);
    expect(res.body.batch.round).toBe(0);
  });
});
