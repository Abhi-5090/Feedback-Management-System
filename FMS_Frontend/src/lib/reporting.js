/**
 * Client-side error reporting — opt-in, and a no-op unless VITE_SENTRY_DSN is
 * set at build time.
 *
 * WHY THIS EXISTS. A render error in the browser is invisible to the server.
 * Three of them reached production in this project's history — `useLocation`
 * used without importing it, `useEffect` likewise, and `IconAction` undefined
 * after a refactor — and each was found by a person saying "the page is
 * blank", not by any system. ErrorBoundary catches them now; this is what
 * makes them visible without waiting for a report.
 *
 * WHAT IS SCRUBBED. The student feedback form holds the comment in component
 * state, and a breadcrumb or an error payload can carry it off-site. So:
 * breadcrumbs that capture console output and fetch bodies are off, and
 * anything originating on a /feedback route is sent without URL or user
 * context. The anonymity guarantee is a property of the whole system, not just
 * the database.
 */

let client = null;
let loading = null;

const DSN = import.meta.env.VITE_SENTRY_DSN || '';
const RELEASE = import.meta.env.VITE_COMMIT_SHA || undefined;
const ENVIRONMENT = import.meta.env.MODE || 'production';

const onStudentRoute = () =>
  typeof window !== 'undefined' && /\/feedback(\/|$)/.test(window.location?.pathname || '');

/** Load and initialise on first use, so the SDK is never in the initial bundle. */
async function ensureClient() {
  if (client || !DSN) return client;
  if (!loading) {
    loading = import('@sentry/browser')
      .then((Sentry) => {
        Sentry.init({
          dsn: DSN,
          release: RELEASE,
          environment: ENVIRONMENT,
          sendDefaultPii: false,
          // Default integrations capture console output and fetch bodies as
          // breadcrumbs; on the student form both can contain the comment.
          defaultIntegrations: false,
          beforeSend(event) {
            if (onStudentRoute()) {
              delete event.request;
              delete event.user;
              event.tags = { ...event.tags, route: 'student-form' };
            }
            delete event.breadcrumbs;
            return event;
          },
        });
        client = Sentry;
        return Sentry;
      })
      .catch(() => null); // a blocked CDN must never break the app
  }
  return loading;
}

/** Report an error. Safe to call unconditionally and before init. */
export async function reportError(error, context) {
  if (!DSN) return false;
  const Sentry = await ensureClient();
  if (!Sentry) return false;
  Sentry.captureException(error, context ? { extra: context } : undefined);
  return true;
}

/**
 * Catch what React's boundary cannot: errors thrown outside render, and
 * promise rejections nobody handled.
 */
export function installGlobalHandlers(target = window) {
  if (!DSN || target.__fmsHandlersInstalled) return false;
  target.__fmsHandlersInstalled = true;
  target.addEventListener('error', (e) => {
    if (e?.error) reportError(e.error, { kind: 'window.onerror' });
  });
  target.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason instanceof Error ? e.reason : new Error(String(e?.reason));
    reportError(reason, { kind: 'unhandledrejection' });
  });
  return true;
}

export const reportingEnabled = () => Boolean(DSN);
