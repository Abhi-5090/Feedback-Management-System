import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { ClusterMemoryStore } from '../middleware/clusterRateStore.js';

/**
 * The per-account sign-in budget.
 *
 * The production limiter is disabled under NODE_ENV=test (max 1,000,000), so
 * this rebuilds it with the same options and a small max. What is under test is
 * not our arithmetic but express-rate-limit's semantics: `skipSuccessfulRequests`
 * is the whole fix, and "successful requests are not counted" is an assumption
 * about a dependency, which is exactly the kind of thing worth proving.
 */
const MAX = 3;
const makeApp = ({ skipSuccessfulRequests }) => {
  const app = express();
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: MAX,
      skipSuccessfulRequests,
      standardHeaders: true,
      legacyHeaders: false,
      store: new ClusterMemoryStore(`test-${Math.random()}`),
      keyGenerator: (req) => `id:${String(req.body?.email || '').toLowerCase()}`,
      handler: (_req, res) => res.status(429).json({ error: 'Too many', code: 'RATE_LIMITED' }),
    })
  );
  // 200 when the password is right, 401 when it is not — the real shape.
  app.post('/login', (req, res) =>
    req.body.password === 'correct' ? res.json({ ok: true }) : res.status(401).json({ error: 'bad' })
  );
  return app;
};

const post = (app, password, email = 'admin@test.com') =>
  request(app).post('/login').send({ email, password });

describe('per-account sign-in limiter', () => {
  test('WITHOUT the fix, successful sign-ins exhaust the budget', async () => {
    // The behaviour that produced "I always get 429" while testing a deployment.
    const app = makeApp({ skipSuccessfulRequests: false });
    for (let i = 0; i < MAX; i++) expect((await post(app, 'correct')).status).toBe(200);
    expect((await post(app, 'correct')).status).toBe(429);
  });

  test('WITH the fix, correct sign-ins never lock the account out', async () => {
    const app = makeApp({ skipSuccessfulRequests: true });
    for (let i = 0; i < MAX * 4; i++) {
      expect((await post(app, 'correct')).status).toBe(200);
    }
  });

  test('WITH the fix, wrong passwords are still counted and still blocked', async () => {
    /* The protection this limiter exists for. If the fix also stopped counting
       failures it would be a hole, not an improvement. */
    const app = makeApp({ skipSuccessfulRequests: true });
    for (let i = 0; i < MAX; i++) expect((await post(app, 'wrong')).status).toBe(401);
    const blocked = await post(app, 'wrong');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  test('a locked-out account does not lock out a different one', async () => {
    const app = makeApp({ skipSuccessfulRequests: true });
    for (let i = 0; i < MAX + 1; i++) await post(app, 'wrong', 'victim@test.com');
    expect((await post(app, 'wrong', 'victim@test.com')).status).toBe(429);
    expect((await post(app, 'wrong', 'someone-else@test.com')).status).toBe(401);
  });
});
