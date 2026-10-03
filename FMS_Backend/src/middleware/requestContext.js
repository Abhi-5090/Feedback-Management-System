import { randomUUID } from 'node:crypto';
import { logger, runWithContext, mayLogIp } from '../config/logger.js';

/**
 * Give every request an id, and log it when it finishes.
 *
 * WHY AN ID. Without one, a 500 in the log is an orphan: you can see that
 * something failed but not which of the forty lines around it belong to the
 * same request, and a user reporting "it broke" gives you a timestamp at best.
 * The id is returned in the `x-request-id` response header, so a user can read
 * it off a failed request and you can find every line for exactly that call.
 *
 * An inbound `x-request-id` is honoured so a trace survives across the Vercel
 * rewrite, but it is length-capped and stripped of anything that is not safe
 * in a log line — an attacker-supplied header must not be able to forge or
 * break log structure.
 *
 * WHAT IS NOT LOGGED. Never the body: on /api/public/feedback it holds the
 * student's comment, and a log pairing a comment with an IP re-identifies its
 * author. The IP itself is recorded only on non-public routes (see mayLogIp).
 */

const MAX_ID = 64;
const SAFE_ID = /[^A-Za-z0-9._-]/g;

/**
 * Sanitise a caller-supplied request id.
 *
 * Exported so it can be tested directly: Node's HTTP client refuses to SEND a
 * header containing a newline, so the injection case cannot be exercised over
 * a real request — but a header can still arrive that way from a proxy, and
 * the guard has to hold regardless.
 */
export function sanitiseRequestId(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const cleaned = raw.replace(SAFE_ID, '').slice(0, MAX_ID);
  return cleaned || null;
}

const incomingId = (req) => sanitiseRequestId(req.headers['x-request-id']);

/** Paths that are noise at info level: health checks and the keep-alive ping. */
const QUIET = new Set(['/api/health', '/api/ready', '/api/metrics']);

export function requestContext(req, res, next) {
  const id = incomingId(req) || randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);

  const child = logger.child({ requestId: id });
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = {
      method: req.method,
      path: req.route?.path ? req.baseUrl + req.route.path : req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      // Present only once auth middleware has run, which is the point: an
      // authenticated actor is identified, an anonymous student is not.
      userId: req.user?._id ? String(req.user._id) : undefined,
      role: req.user?.role,
      ip: mayLogIp(req.originalUrl) ? req.ip : undefined,
    };

    /* Level by outcome, so a sink can alert on `level >= error` and mean it.
       Health checks drop to debug: 480 keep-alive pings a day at info level
       bury everything that matters. */
    if (res.statusCode >= 500) child.error(line, 'request failed');
    else if (res.statusCode >= 400) child.warn(line, 'request rejected');
    else if (QUIET.has(line.path)) child.debug(line, 'request');
    else child.info(line, 'request');
  });

  // AsyncLocalStorage: anything downstream can call log() and get this child
  // without the id being threaded through every function signature.
  runWithContext({ requestId: id, logger: child }, () => next());
}
