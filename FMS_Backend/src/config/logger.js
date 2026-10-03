import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { env, isProd, isTest } from './env.js';

/**
 * Structured logging.
 *
 * Replaces 164 scattered `console.*` calls. The difference that matters is not
 * the formatting — it is that every line is a queryable object carrying the
 * request id, so "a trainer says it failed yesterday afternoon" becomes a
 * filter rather than a guess.
 *
 * ── THE ANONYMITY CONSTRAINT ──────────────────────────────────────────────
 * This application's central promise is that a feedback comment cannot be
 * traced to the student who wrote it. The Feedback document deliberately
 * stores no identity, no IP and no device signature — and a logger added
 * carelessly undoes all of that in one line, because the default thing every
 * HTTP logger does is record the client IP next to the request path. A log of
 *
 *     POST /api/public/feedback  ip=10.1.2.3  body={comment:"the pace is too fast"}
 *
 * re-identifies the author of that comment to anyone holding the logs, which
 * is exactly what the schema was designed to prevent.
 *
 * So: request bodies are NEVER logged, and the client IP is recorded only for
 * authenticated and administrative routes. On the anonymous student endpoints
 * it is dropped before the line is written. See `redactIp` below.
 */

/* Fields that must never reach a log sink, wherever they appear. Pino's
   redaction runs on the serialised object, so this covers nested occurrences
   in error payloads as well as the top level. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-feedback-session"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'passwordHash',
  'passcode',
  'passcodeHash',
  'sessionToken',
  'token',
  'tokenHash',
  'fingerprint',
  'comment',
  '*.password',
  '*.passcode',
  '*.sessionToken',
  '*.comment',
];

export const logger = pino({
  level: env.logLevel,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'fms-api', env: env.nodeEnv, commit: env.commit || undefined },
  // ISO timestamps: log aggregators parse them, and a human reading a raw file
  // can tell what time it was without converting epoch millis.
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // `level: "info"` rather than `level: 30` — readable in every sink.
    level: (label) => ({ level: label }),
  },
  // Human-readable locally, newline-delimited JSON in production where
  // something else is doing the parsing.
  transport:
    !isProd && !isTest
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } }
      : undefined,
  enabled: !isTest || env.logLevel === 'debug',
});

/**
 * Per-request context, so any code anywhere can log with the request id
 * without that id being threaded through every function signature.
 */
const store = new AsyncLocalStorage();

export const runWithContext = (context, fn) => store.run(context, fn);
export const getContext = () => store.getStore() || null;

/**
 * The logger to use inside a request. Carries the request id and, when the
 * caller is authenticated, who they are — an audit trail needs the actor, and
 * an authenticated user has no anonymity expectation to protect.
 */
export function log() {
  const ctx = getContext();
  return ctx?.logger || logger;
}

/**
 * Whether the client IP may be recorded for this path.
 *
 * Anonymous student traffic: no. Everything else: yes, because the ability to
 * answer "which account did this, from where?" is the point of an audit trail
 * and those users are identified anyway.
 */
export function mayLogIp(path) {
  return !String(path || '').startsWith('/api/public');
}

export default logger;
