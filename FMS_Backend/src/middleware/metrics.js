import client from 'prom-client';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * Prometheus metrics.
 *
 * Logs answer "what happened to this one request". Metrics answer "is the
 * system healthy right now" — p95 latency, error rate, how close the database
 * pool is to exhaustion — which is the question you need answered BEFORE
 * someone reports a problem.
 *
 * The endpoint is protected by a bearer token when METRICS_TOKEN is set.
 * Request counts by route are not secret, but they do describe usage patterns
 * and the deployment is public, so it should not be world-readable.
 */

export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'fms-api', env: env.nodeEnv });
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  // Labelled by ROUTE PATTERN, never the raw URL: `/api/batch/:id` is one
  // series, `/api/batch/<every objectid>` is a new series per batch and would
  // blow the cardinality budget out within a week.
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

const httpErrors = new client.Counter({
  name: 'http_requests_errors_total',
  help: 'HTTP responses with status >= 400',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const feedbackSubmissions = new client.Counter({
  name: 'fms_feedback_submissions_total',
  help: 'Feedback submissions accepted',
  labelNames: ['outcome'],
  registers: [registry],
});

const dbPool = new client.Gauge({
  name: 'fms_mongo_connection_state',
  help: 'Mongoose connection readyState (0 disconnected, 1 connected, 2 connecting, 3 disconnecting)',
  registers: [registry],
  collect() {
    this.set(mongoose.connection?.readyState ?? 0);
  },
});

export const recordFeedback = (outcome) => feedbackSubmissions.inc({ outcome });

/** Route pattern for labelling, falling back to a bucket rather than the URL. */
function routeLabel(req) {
  if (req.route?.path) return (req.baseUrl || '') + req.route.path;
  const path = req.originalUrl.split('?')[0];
  // Unmatched (404) paths are an unbounded label space — one bucket for all.
  return path.startsWith('/api') ? 'unmatched' : 'static';
}

export function metricsMiddleware(req, res, next) {
  if (!env.metricsEnabled) return next();
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
    end(labels);
    if (res.statusCode >= 400) httpErrors.inc(labels);
  });
  return next();
}

/** GET /api/metrics — Prometheus scrape target. */
export async function metricsHandler(req, res) {
  if (!env.metricsEnabled) return res.status(404).json({ error: 'Metrics are disabled' });
  if (env.metricsToken) {
    const presented = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    // Length-safe comparison: a plain === on secrets leaks length by timing.
    const ok = presented.length === env.metricsToken.length && presented === env.metricsToken;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }
  res.setHeader('Content-Type', registry.contentType);
  return res.send(await registry.metrics());
}

export { dbPool };
