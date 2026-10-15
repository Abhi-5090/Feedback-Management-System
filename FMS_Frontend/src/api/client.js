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
  (error) => {
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
       Sending them to the picker turns a dead screen full of failed requests
       into the one question that unblocks it. Guarded against looping on the
       picker itself, which is allowed to make this very request. */
    if (
      data?.code === 'ORGANIZATION_CHOICE_REQUIRED' &&
      !window.location.pathname.startsWith('/choose-organization')
    ) {
      window.location.assign('/choose-organization');
    }
    return Promise.reject(error);
  }
);
