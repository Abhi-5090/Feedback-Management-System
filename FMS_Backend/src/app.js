import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env, isProd } from './config/env.js';
import { publicLimiter } from './middleware/rateLimit.js';
import { hardenQuery } from './middleware/hardenQuery.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { metricsMiddleware, metricsHandler, legacyApiRequests } from './middleware/metrics.js';

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
/** Operational paths, exempt from versioning and from the deprecation notice. */
const OPERATIONAL = new Set(['/health', '/ready', '/metrics']);

/** The route groups the legacy alias actually serves. Anything else is 'other'. */
const LEGACY_GROUPS = new Set([
  'auth', 'analytics', 'dashboard', 'export', 'public',
  'trainers', 'classes', 'batches', 'parameters', 'audit', 'system',
]);

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

  /* FIRST, before anything that can fail: every later log line, every error
     report and every metric needs the request id, so nothing may run ahead of
     it — including helmet, whose own failures would otherwise be unattributed. */
  app.use(requestContext);
  app.use(metricsMiddleware);

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

  /* Operational endpoints. /api/metrics sits beside health rather than under a
     feature route because it describes the PROCESS, not the domain. */
  app.get('/api/metrics', metricsHandler);

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
  /* ── API versioning ──────────────────────────────────────────────────────
     Every domain route is mounted under /api/v1. The unprefixed /api/* paths
     stay as a DEPRECATED ALIAS onto the same routers, because a version prefix
     introduced by breaking the deployed frontend is not a migration, it is an
     outage: Vercel and Render deploy independently, so for a few minutes a new
     backend always serves an old bundle.

     The alias answers identically and adds RFC 8594 Deprecation and Sunset
     headers, so the old path is visibly dated rather than quietly permanent.

     NOT versioned, deliberately: /api/health, /api/ready and /api/metrics.
     They describe the PROCESS, not the domain — Render's healthCheckPath and
     any scrape config point at fixed URLs, and a version bump that moves them
     fails every deploy for a reason nobody connects to the change. */
  const mountDomainRoutes = (prefix) => {
    app.use(`${prefix}/auth`, authRoutes);
    // Admin CRUD mounts at the root so paths are …/trainers, …/classes,
    // …/parameters, …/batches (all admin-guarded inside adminRoutes).
    app.use(prefix, adminRoutes);
    app.use(`${prefix}/analytics`, analyticsRoutes);
    app.use(`${prefix}/dashboard`, dashboardRoutes);
    app.use(`${prefix}/export`, exportRoutes);
    // Public anonymous student flow (rate-limited).
    app.use(`${prefix}/public`, publicLimiter, publicRoutes);
  };

  mountDomainRoutes('/api/v1');

  /* The legacy alias. Marked on the way out so a client can see it, and
     counted in the metrics so there is a number behind "can we remove it yet?"
     rather than a guess. */
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/v1/') || OPERATIONAL.has(req.path)) return next();
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', env.apiSunset);
    res.setHeader('Link', '</api/v1>; rel="successor-version"');
    /* Bucketed to a KNOWN group. Labelling by the raw segment means every
       404 to /api/<anything> mints a new time series — the same unbounded
       cardinality the route labels are careful to avoid, and a trivial way
       for an outsider to bloat the metrics endpoint. */
    const group = req.path.split('/')[1] || '';
    legacyApiRequests.inc({ group: LEGACY_GROUPS.has(group) ? group : 'other' });
    return next();
  });
  mountDomainRoutes('/api');

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
