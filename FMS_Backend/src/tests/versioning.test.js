import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, loginToken, ADMIN_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';

jest.setTimeout(60_000);

/**
 * API versioning.
 *
 * Domain routes live under /api/v1. The unprefixed /api/* paths remain as a
 * deprecated alias, because introducing a prefix by breaking the deployed
 * frontend is not a migration, it is an outage: Vercel and Render deploy
 * independently, so for a few minutes every release serves a new backend to an
 * old bundle.
 */

let adminToken;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });
beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
});

const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);

describe('the versioned path is canonical', () => {
  test.each([
    ['/api/v1/trainers'],
    ['/api/v1/classes'],
    ['/api/v1/batches'],
    ['/api/v1/parameters'],
    ['/api/v1/analytics/years'],
    ['/api/v1/dashboard/admin'],
  ])('%s answers', async (path) => {
    const res = await auth(request(target()).get(path));
    expect(res.status).toBe(200);
  });

  test('carries no deprecation headers', async () => {
    const res = await auth(request(target()).get('/api/v1/classes'));
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.sunset).toBeUndefined();
  });

  test('the public student routes are versioned too', async () => {
    const res = await request(target())
      .post('/api/v1/public/verify-passcode')
      .send({ batchId: '000000000000000000000000', passcode: 'nope' });
    /* A domain 404 ("Batch not found"), not a routing one ("Route not
       found") — the status alone cannot tell those apart, so assert on the
       body. An earlier version of this test checked only the status and would
       have passed even if the route were never mounted. */
    expect(res.body.error).toMatch(/batch not found/i);
    expect(res.body.error).not.toMatch(/route not found/i);
  });
});

describe('the unversioned alias still works, and says it is going', () => {
  test('answers identically to the versioned path', async () => {
    const [legacy, versioned] = await Promise.all([
      auth(request(target()).get('/api/classes')),
      auth(request(target()).get('/api/v1/classes')),
    ]);
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(versioned.body);
  });

  test('is marked deprecated, with a DATE and a successor', async () => {
    /* A Sunset header with no date is a deprecation nobody acts on, and a
       Deprecation header with no successor is a dead end. */
    const res = await auth(request(target()).get('/api/classes'));
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBeTruthy();
    expect(new Date(res.headers.sunset).toString()).not.toBe('Invalid Date');
    expect(res.headers.link).toContain('rel="successor-version"');
  });

  test('legacy usage is COUNTED, so removing it is a decision with a number behind it', async () => {
    await auth(request(target()).get('/api/classes'));
    const metrics = await request(target()).get('/api/metrics');
    expect(metrics.text).toContain('fms_legacy_api_requests_total');
    expect(metrics.text).toMatch(/fms_legacy_api_requests_total\{[^}]*group="classes"/);
  });

  test('an unknown path does NOT mint a new metric series', async () => {
    /* The label space has to be bounded. Labelling by the raw segment lets any
       outsider inflate the metrics endpoint by requesting /api/<random>. */
    await request(target()).get('/api/zzz-not-a-route-aaa');
    await request(target()).get('/api/zzz-not-a-route-bbb');
    const metrics = await request(target()).get('/api/metrics');
    expect(metrics.text).toContain('group="other"');
    expect(metrics.text).not.toContain('zzz-not-a-route');
  });
});

describe('operational endpoints are deliberately NOT versioned', () => {
  test.each(['/api/health', '/api/ready'])('%s stays where it is', async (path) => {
    /* Render's healthCheckPath and any scrape config point at fixed URLs. A
       version bump that moves them fails every deploy, for a reason nobody
       connects back to the change. */
    const res = await request(target()).get(path);
    expect(res.status).toBe(200);
  });

  test('they are not marked deprecated', async () => {
    const res = await request(target()).get('/api/health');
    expect(res.headers.deprecation).toBeUndefined();
  });

  test('and they are NOT served under /v1', async () => {
    // One canonical URL each; two would be two things to keep working.
    expect((await request(target()).get('/api/v1/health')).status).toBe(404);
  });
});
