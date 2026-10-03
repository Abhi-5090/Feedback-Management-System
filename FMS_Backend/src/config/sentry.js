import { env, isProd } from './env.js';
import { logger } from './logger.js';

/**
 * Error tracking — opt-in, and a no-op unless SENTRY_DSN is set.
 *
 * Sentry is loaded DYNAMICALLY rather than imported at the top of the file so
 * the package is not a hard dependency: without a DSN nothing is required,
 * nothing is initialised, and no data leaves the process. That matters for a
 * deployment handling student feedback, where "an error reporter quietly
 * shipped a payload off-site" is a real risk rather than a theoretical one.
 *
 * What is scrubbed before anything is sent:
 *   - request bodies (a feedback body contains the student's comment),
 *   - cookies and authorization headers,
 *   - the client IP on anonymous student routes.
 */

let sentry = null;

export async function initSentry() {
  if (!env.sentryDsn) {
    logger.info('error tracking disabled (no SENTRY_DSN)');
    return null;
  }
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: env.sentryDsn,
      environment: env.nodeEnv,
      release: env.commit || undefined,
      tracesSampleRate: isProd ? env.sentrySampleRate : 0,
      // Never send PII automatically; what we do send is chosen below.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.data; // bodies: may contain a student comment
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.cookie;
            delete event.request.headers.authorization;
            delete event.request.headers['x-feedback-session'];
          }
          const url = event.request.url || '';
          if (url.includes('/api/public')) delete event.user; // includes ip_address
        }
        return event;
      },
    });
    sentry = Sentry;
    logger.info({ release: env.commit || 'unknown' }, 'error tracking enabled');
    return Sentry;
  } catch (err) {
    // A missing optional package must not stop the server booting.
    logger.warn({ err: err.message }, 'SENTRY_DSN is set but @sentry/node could not be loaded');
    return null;
  }
}

/** Report an exception if tracking is on. Safe to call unconditionally. */
export function captureException(err, context) {
  if (!sentry) return;
  sentry.captureException(err, context ? { extra: context } : undefined);
}

export const sentryEnabled = () => Boolean(sentry);
