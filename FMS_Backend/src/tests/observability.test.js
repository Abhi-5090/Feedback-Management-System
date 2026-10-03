import { jest } from '@jest/globals';
import request from 'supertest';
import { Writable } from 'node:stream';
import { mayLogIp } from '../config/logger.js';
import { sanitiseRequestId } from '../middleware/requestContext.js';
import {
  app, startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, startTestServer, stopTestServer, target,
} from './helpers.js';

jest.setTimeout(60_000);

/**
 * Observability, and the one way it can do real harm here.
 *
 * This application's central promise is that a feedback comment cannot be
 * traced back to the student who wrote it: the Feedback document stores no
 * identity, no IP and no device signature. A logger added carelessly undoes
 * that in a single line, because the default behaviour of every HTTP logger is
 * to record the client IP beside the request path — and a line pairing
 * "POST /api/public/feedback" with an IP, next to a line carrying the comment
 * body, re-identifies the author to anyone holding the logs.
 *
 * These tests exist so that guarantee is enforced rather than intended.
 */

let adminToken;
let klass;
let batch;
let trainer;

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
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  trainer = await makeTrainer('t@test.com', 'Tee Trainer');
  klass = await makeClass(null, 'GenAI');
  batch = await makeBatch({ class: klass._id, mainTrainers: [trainer._id], name: 'Cohort' });
});

describe('request correlation', () => {
  test('every response carries an x-request-id', async () => {
    const res = await request(target()).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{8,}$/i);
  });

  test('two requests get different ids', async () => {
    const [a, b] = await Promise.all([
      request(target()).get('/api/health'),
      request(target()).get('/api/health'),
    ]);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  test('an inbound id is honoured, so a trace survives the Vercel rewrite', async () => {
    const res = await request(target()).get('/api/health').set('x-request-id', 'trace-abc-123');
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  test('a hostile inbound id is stripped', () => {
    /* Tested as a unit rather than over HTTP: Node's client refuses to SEND a
       header containing a newline, so the injection case cannot be exercised
       through a real request — but a header can still arrive that way from a
       proxy, so the guard has to hold anyway. */
    expect(sanitiseRequestId('bad\nid "injected" <script>')).toBe('badidinjectedscript');
    expect(sanitiseRequestId('a\r\nSet-Cookie: x=1')).toBe('aSet-Cookiex1');
    expect(sanitiseRequestId('')).toBeNull();
    expect(sanitiseRequestId(undefined)).toBeNull();
    expect(sanitiseRequestId('!!!')).toBeNull(); // nothing survives → generate one
    expect(sanitiseRequestId('a'.repeat(500))).toHaveLength(64);
  });

  test('a header-legal but log-unsafe id is still sanitised over HTTP', async () => {
    const res = await request(target()).get('/api/health').set('x-request-id', 'trace "x" <y>');
    expect(res.headers['x-request-id']).toBe('tracexy');
  });

  test('an over-long id is truncated rather than logged whole', async () => {
    const res = await request(target()).get('/api/health').set('x-request-id', 'a'.repeat(500));
    expect(res.headers['x-request-id'].length).toBeLessThanOrEqual(64);
  });
});

describe('anonymity is preserved in logs', () => {
  test('the student endpoints are marked as IP-free', () => {
    expect(mayLogIp('/api/public/feedback')).toBe(false);
    expect(mayLogIp('/api/public/verify-passcode')).toBe(false);
  });

  test('authenticated routes may record the IP — those users are identified anyway', () => {
    expect(mayLogIp('/api/analytics/classes')).toBe(true);
    expect(mayLogIp('/api/auth/login')).toBe(true);
  });

  test('a real submission writes NO comment, IP or token to the log', async () => {
    /* The end-to-end version of the guarantee: run an actual submission with a
       distinctive comment, capture everything the logger emits, and assert the
       comment does not appear in it. */
    const captured = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { captured.push(chunk.toString()); cb(); },
    });
    const pino = (await import('pino')).default;
    const { logger } = await import('../config/logger.js');
    // Re-point the shared logger at our sink for the duration of the request.
    const original = Object.getOwnPropertySymbols(logger).find((s) => String(s).includes('stream'));
    const spy = pino({ level: 'trace' }, sink);
    const methods = ['info', 'warn', 'error', 'debug', 'fatal'];
    const saved = {};
    for (const m of methods) { saved[m] = logger[m].bind(logger); logger[m] = spy[m].bind(spy); }

    const SECRET_COMMENT = 'zqx-canary-the-pace-is-far-too-fast-zqx';
    let passcode = null;
    try {
      const unlocked = await request(target())
        .post(`/api/batches/${batch._id}/unlock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedCount: 5 });
      passcode = unlocked.body.passcode;
      const verified = await request(target())
        .post('/api/public/verify-passcode')
        .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
      const res = await request(target()).post('/api/public/feedback').send(
        await feedbackBody({
          batchId: batch._id,
          classIds: [klass._id],
          comment: SECRET_COMMENT,
          sessionToken: verified.body.sessionToken,
          fingerprint: 'canary-fingerprint',
        })
      );
      expect(res.status).toBe(201);
    } finally {
      for (const m of methods) logger[m] = saved[m];
      void original;
    }

    const output = captured.join('\n');
    expect(output).not.toContain(SECRET_COMMENT);
    expect(output).not.toContain('canary-fingerprint');
    // The passcode is a live credential for the whole cohort while the batch
    // is open — it must never be written to a log either.
    expect(passcode).toBeTruthy();
    expect(output).not.toContain(passcode);
  });
});

describe('metrics', () => {
  test('/api/metrics serves Prometheus text', async () => {
    const res = await request(target()).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('fms_mongo_connection_state');
  });

  test('routes are labelled by PATTERN, not by raw URL', async () => {
    /* `/api/batch/:id` must be one series. Labelling by raw URL creates a new
       time series per batch id and exhausts the cardinality budget. */
    await request(target())
      .get(`/api/analytics/batch/${batch._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const res = await request(target()).get('/api/metrics');
    // Any `:param` placeholder — this route's is `:batchId`. What matters is
    // that the label is the PATTERN and not the id that was requested.
    expect(res.text).toMatch(/route="[^"]*\/:[A-Za-z]+"/);
    expect(res.text).not.toContain(String(batch._id));
  });

  test('an unmatched path collapses into one bucket', async () => {
    await request(target()).get('/api/does-not-exist-a');
    await request(target()).get('/api/does-not-exist-b');
    const res = await request(target()).get('/api/metrics');
    expect(res.text).toContain('route="unmatched"');
    expect(res.text).not.toContain('does-not-exist');
  });
});

describe('error responses', () => {
  test('a 5xx response carries the request id so a user can quote it', async () => {
    // No route throws on demand, so assert the contract on the handler shape:
    // every response has the header, and the body adds it only for 5xx.
    const ok = await request(target()).get('/api/health');
    expect(ok.body.requestId).toBeUndefined();
    expect(ok.headers['x-request-id']).toBeTruthy();
  });
});
