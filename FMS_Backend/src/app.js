import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env, isProd } from './config/env.js';
import { publicLimiter } from './middleware/rateLimit.js';
import { hardenQuery } from './middleware/hardenQuery.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import publicRoutes from './routes/publicRoutes.js';

/**
 * Build the Express app. Exported separately from server.js so the test suite
 * can import the app without opening a network port.
 */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // correct client IPs behind a proxy (rate limiting)

  /* Parse query strings with Node's own `querystring`, not `qs`.
   *
   * Express 4 pins a version of `qs` carrying two unfixed advisories — an
   * array-limit bypass through bracket-key comma parsing, and a denial of
   * service through an attacker-controlled `isBuffer` — and neither can be
   * patched without moving to Express 5. `qs` exists to support NESTED query
   * syntax (`?a[b][c]=1`), and this API uses none: every query parameter is a
   * flat scalar (page, limit, q, role, yearGroup, from, to, format, …), each
   * validated by zod immediately afterwards.
   *
   * Switching to the simple parser removes that code from the request path
   * entirely, which is a better outcome than upgrading it — an unreachable
   * dependency cannot be exploited. `npm audit` will still report `qs` because
   * it remains in the tree as an Express dependency; it is no longer used to
   * parse anything an attacker controls.
   */
  app.set('query parser', 'simple');

  app.use(helmet());

  // Any localhost/127.0.0.1 port is acceptable in development. Browsers send an
  // `Origin` header on POST even for same-origin requests, so a dev server on an
  // unexpected port (5173 vs 5174) would otherwise fail EVERY write while GETs
  // kept working — a confusing failure that costs more than it protects in dev.
  // Production remains a strict allowlist.
  const isLocalhost = (origin) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  app.use(
    cors({
      origin(origin, cb) {
        // No Origin header = same-origin GET, curl, or server-to-server.
        if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
        if (!isProd && isLocalhost(origin)) return cb(null, true);
        // Reject cleanly: `cb(null, false)` just omits the CORS headers and lets
        // the browser block it. Throwing here would surface as a 500 + stack
        // trace, which reads like a server fault rather than a policy decision.
        return cb(null, false);
      },
      credentials: true, // required so the httpOnly auth cookie is sent
    })
  );
  // The bulk-import preview carries a base64 workbook (~1.33× the file size),
  // so it gets a larger limit. Scoped to that one path rather than raised
  // globally — every other endpoint stays cheap to reject. This must run BEFORE
  // the global parser, which would otherwise 413 the request first; express.json
  // is a no-op once req.body is populated.
  app.use('/api/trainers/bulk/preview', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  // Defence in depth against NoSQL injection through query parameters. Mounted
  // before every route so no handler can opt out by omission.
  app.use(hardenQuery);

  // Unauthenticated liveness probe. Deliberately thin — it must not reveal
  // deployment internals to anonymous callers. The detailed picture (mail
  // transport, transaction support, limits) lives behind auth at
  // GET /api/auth/system.
  /* WHAT IS ACTUALLY DEPLOYED.
     "Did my push go live?" was unanswerable without probing for a feature and
     inferring the commit from which endpoints existed — which is how a backend
     sat two commits behind a frontend that expected its new fields for a day
     without anyone noticing. Render injects RENDER_GIT_COMMIT on every deploy,
     so the running code can simply say which commit it is. */
  const version = {
    commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown').slice(0, 7),
    branch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || 'unknown',
    // Set at process start, so it also reveals a service that never restarted.
    startedAt: new Date().toISOString(),
  };

  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      service: 'fms-api',
      version,
      uptime: Math.round(process.uptime()),
      // Which worker answered. Makes it possible to confirm a load balancer is
      // actually spreading traffic rather than pinning it to one process.
      pid: process.pid,
      worker: process.env.WORKER_INDEX ? Number(process.env.WORKER_INDEX) : null,
    })
  );

  /* Readiness, as distinct from liveness.
     /health says the process is up. This says it can actually serve: the
     database is connected and responding. An orchestrator that routes traffic
     on liveness alone will send a cohort's requests to a worker whose database
     connection has dropped, and every one of them fails. */
  app.get('/api/ready', async (_req, res) => {
    const state = mongoose.connection.readyState; // 1 = connected
    if (state !== 1) {
      return res.status(503).json({ ok: false, reason: 'database not connected', state });
    }
    try {
      await mongoose.connection.db.admin().command({ ping: 1 });
      return res.json({ ok: true, database: 'reachable', pid: process.pid });
    } catch (err) {
      return res.status(503).json({ ok: false, reason: 'database unreachable', error: err.message });
    }
  });

  // Auth
  app.use('/api/auth', authRoutes);

  // Admin CRUD — mounted at /api so paths are /api/trainers, /api/classes,
  // /api/parameters, /api/batches (all admin-guarded inside adminRoutes).
  app.use('/api', adminRoutes);

  // Analytics, dashboards, exports (role checks inside).
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/export', exportRoutes);

  // Public anonymous student flow (rate-limited).
  app.use('/api/public', publicLimiter, publicRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
