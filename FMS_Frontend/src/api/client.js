import axios from 'axios';

/**
 * Central axios instance.
 *  - baseURL: VITE_API_URL if set (cross-origin), else same-origin '/api/v1'
 *    (dev proxy in vite.config.js / nginx forwards to the backend).
 *  - withCredentials so the httpOnly auth cookie rides along. The browser is
 *    same-origin with the API in both the dev-proxy and nginx deployments, so
 *    the first-party cookie is the sole auth transport — the JWT is NEVER stored
 *    in JS-readable storage (no localStorage), which keeps it out of reach of XSS.
 */
/* /api/v1, not /api. The unversioned paths still answer — the backend keeps
   them as a dated alias — but this client should be on the canonical one, and
   the Sunset header exists so the alias does not become permanent by default.
   VITE_API_BASE is an escape hatch for pointing a build at another version. */
const API_VERSION = import.meta.env.VITE_API_BASE || '/api/v1';
const baseURL = (import.meta.env.VITE_API_URL || '') + API_VERSION;

export const api = axios.create({ baseURL, withCredentials: true });

/* ── Failover between two backends ─────────────────────────────────────────
 *
 * BOTH ARE REACHED THROUGH THIS ORIGIN, never by their own hostnames. That is
 * the whole design, and it is forced by how the product authenticates: the
 * session is an httpOnly, SameSite=lax cookie and there is no token in
 * JS-readable storage, deliberately, so an XSS cannot steal a session. A
 * lax cookie is NOT sent on a cross-site request — so calling
 * fms-api-xxxx.onrender.com directly would reach a healthy server with no
 * session attached, and every failover request would arrive as a stranger.
 * Routing the spare through /api-backup on our own domain keeps one cookie
 * jar and one origin, and costs nothing.
 *
 * WHAT COUNTS AS "THIS BACKEND IS DOWN" is deliberately narrow. A request with
 * no response at all (the host is unreachable), or 502/503/504, which is a
 * proxy saying it could not reach the app — a suspended Render service answers
 * exactly this. A 500 does NOT qualify: the app was reached and threw, and the
 * other copy runs the same code against the same database, so it will throw
 * too. Nor does any 4xx, which is a real answer to a real question.
 */
const PRIMARY = API_VERSION;
const BACKUP = (import.meta.env.VITE_API_BACKUP || '/api-backup') + '/v1';

/* How long to keep using the spare after a failover before trying the primary
   again. Short enough that recovery is noticed quickly; long enough that a
   genuinely dead primary is not re-probed on every single request, which would
   put its timeout in front of everything the page does. */
const STICKY_MS = 60_000;

let activeBase = PRIMARY;
let switchedAt = 0;

const DOWN_STATUSES = new Set([502, 503, 504]);

/** True when the failure means "could not reach the app", not "the app said no". */
export function looksUnreachable(error) {
  if (!error) return false;
  if (error.code === 'ECONNABORTED') return true;        // timed out
  if (!error.response) return true;                       // network / DNS / refused
  return DOWN_STATUSES.has(error.response.status);
}

/** Which base the next request should use, expiring the sticky window. */
function currentBase() {
  if (activeBase !== PRIMARY && Date.now() - switchedAt > STICKY_MS) {
    activeBase = PRIMARY;
  }
  return activeBase;
}

function useOther(base) {
  return base === PRIMARY ? BACKUP : PRIMARY;
}

/** Exposed for tests and for a status read-out; never set from a component. */
export const failoverState = () => ({ activeBase, primary: PRIMARY, backup: BACKUP });
export function __resetFailover() {
  activeBase = PRIMARY;
  switchedAt = 0;
}

api.interceptors.request.use((config) => {
  /* The base is chosen per request rather than pinned at creation, so a
     failover applies to everything in flight afterwards without rebuilding
     the client. */
  config.baseURL = currentBase();
  return config;
});

/* ── Phase scope ───────────────────────────────────────────────────────────
 * The selected collection phase, appended to every feedback-bearing GET.
 *
 * Injected HERE rather than threaded through each page's fetch. There are a
 * dozen call sites across the dashboard, feedbacks, comments, comparison,
 * cohorts and both drill-downs, plus the exports — passing a parameter through
 * each one means a dependency array to get right in each one, and the failure
 * when you miss one is silent: that page keeps showing every phase while the
 * filter says otherwise, and the two screens disagree without saying so.
 *
 * Set from the PhaseScope provider, read by the interceptor. A module-level
 * value because an axios interceptor cannot use a hook.
 */
let phaseParam;
export function setPhaseParam(next) {
  phaseParam = next || undefined;
}

/**
 * Which organization a super admin is currently acting on.
 *
 * Unlike the phase, this is NOT an allow-listed filter — it is the tenant the
 * whole request belongs to, so it rides on every call without exception. A
 * route that forgot it would be answered in the wrong organization, or, since
 * the server refuses to guess, not answered at all.
 *
 * Members (admin, trainer) never set this: their organization comes from their
 * own account server-side and cannot be influenced from the client.
 */
let organizationId;
export function setOrganizationHeader(next) {
  organizationId = next || undefined;
}

api.interceptors.request.use((config) => {
  if (organizationId) {
    config.headers = { ...(config.headers || {}), 'X-Organization': organizationId };
  }
  return config;
});

/* Only the routes whose content IS feedback. An allow-list rather than a
   deny-list: a new endpoint should have to opt in, because silently filtering
   something that was never meant to be filtered is the harder bug to spot. */
const PHASE_SCOPED = [/^\/dashboard\//, /^\/analytics\//, /^\/export\//];

api.interceptors.request.use((config) => {
  if (!phaseParam) return config;
  const url = config.url || '';
  if (!PHASE_SCOPED.some((re) => re.test(url))) return config;
  // An explicit phase on the call wins — a page asking for one specific phase
  // must not be overridden by the global scope.
  if (config.params?.phase !== undefined) return config;
  config.params = { ...(config.params || {}), phase: phaseParam };
  return config;
});


/**
 * True at most once per RELOAD_WINDOW, across reloads.
 *
 * Storage can throw (private browsing, blocked site data) and can come back
 * empty, so a failure to read is treated as "do not reload": refusing a
 * recovery reload leaves one stale page, while allowing an unbounded one
 * leaves a tab that never stops reloading.
 */
const RELOAD_KEY = 'fms.pwChangeReloadAt';
const RELOAD_WINDOW = 10_000;

function shouldReloadForPasswordChange() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < RELOAD_WINDOW) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Called once a new password is accepted, so a later lock can still recover. */
export function clearPasswordChangeReload() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* nothing to clear */
  }
}

// Normalise error messages so UI can show err.message directly.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    /* FAILOVER FIRST. Everything below this reads a response body to decide
       what to do, and an unreachable backend has none — so the retry has to
       happen before any of it, or a suspended service is read as an
       unclassifiable error and the spare is never tried.

       One attempt, marked on the config so a retry can never retry itself.
       If the spare is also down the original failure surfaces, which is the
       honest outcome: both are gone, and pretending otherwise would just
       double every timeout. */
    const cfg = error.config || {};
    if (looksUnreachable(error) && !cfg.__failedOver) {
      const other = useOther(cfg.baseURL || currentBase());
      cfg.__failedOver = true;
      cfg.baseURL = other;
      try {
        const res = await api.request(cfg);
        /* Only stick to the spare once it has actually answered. Switching on
           the attempt would strand every later request on a backend that is
           equally dead. */
        activeBase = other;
        switchedAt = Date.now();
        return res;
      } catch {
        /* Fall through to the normal handling with the ORIGINAL error: the
           spare failing tells the user nothing useful about their request. */
      }
    }

    const data = error.response?.data;
    error.message = data?.error || error.message || 'Request failed';
    error.code = data?.code;
    error.details = data?.details;
    error.status = error.response?.status;

    /* The account is still on an admin-issued password. Any in-flight request
       can come back this way — including a poll that fires seconds after the
       flag is set elsewhere — so reload to let ProtectedRoute show the
       change-password screen rather than leaving a half-dead page behind a
       wall of failing requests.
       
       THE GUARD HAS TO SURVIVE THE RELOAD. It used to be a property on
       `window`, which the reload destroys along with the rest of the page:
       the next load made the same request, got the same 403, found the flag
       missing and reloaded again. That is an endless reload loop, and what it
       looks like to the person using it is the change-password screen
       flickering and never settling. sessionStorage outlives the reload and
       dies with the tab, which is exactly the lifetime this needs. */
    if (data?.code === 'PASSWORD_CHANGE_REQUIRED' && shouldReloadForPasswordChange()) {
      window.location.reload();
    }

    /* The account works; it just has not said which institution it is in.
       
       RETRY BEFORE REDIRECTING. If a choice has already been made and this
       request simply went out without it — a race between navigating into an
       organization and the header being applied — then sending the person
       back to the picker is wrong twice over: they already answered, and the
       answer is sitting right here. One retry carrying the header fixes it
       invisibly, and anything still refused after that genuinely needs the
       question asked.
       
       Marked on the config so a retry can never retry itself. */
    if (data?.code === 'ORGANIZATION_CHOICE_REQUIRED') {
      const cfg = error.config || {};
      const sentNothing = !cfg.headers?.['X-Organization'];

      if (organizationId && sentNothing && !cfg.__orgRetry) {
        cfg.__orgRetry = true;
        cfg.headers = { ...(cfg.headers || {}), 'X-Organization': organizationId };
        return api.request(cfg);
      }

      /* Guarded against looping on the picker itself, which is allowed to
         make this very request. */
      if (!window.location.pathname.startsWith('/choose-organization')) {
        window.location.assign('/choose-organization');
      }
    }
    return Promise.reject(error);
  }
);
