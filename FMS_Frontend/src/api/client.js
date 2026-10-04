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
       wall of failing requests. */
    if (data?.code === 'PASSWORD_CHANGE_REQUIRED' && !window.__fmsReloading) {
      window.__fmsReloading = true;
      window.location.reload();
    }
    return Promise.reject(error);
  }
);
