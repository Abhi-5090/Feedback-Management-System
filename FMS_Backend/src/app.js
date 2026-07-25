import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env, isProd } from './config/env.js';
import { publicLimiter } from './middleware/rateLimit.js';
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

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'fms-api' }));

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
