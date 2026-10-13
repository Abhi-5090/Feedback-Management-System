import axios from 'axios';

/**
 * Which build of the API is actually answering.
 *
 * A deployment that lags the frontend fails in the most confusing way
 * available: the screen is there, the button is there, and the request comes
 * back 404 — which reads as a bug in a feature that is in fact working
 * perfectly on a server that has not been given it yet. Several hours were
 * spent on exactly this.
 *
 * `/api/health` is unauthenticated and carries the commit, so when a platform
 * call 404s we can say WHICH build is running instead of leaving someone to
 * guess whether they typed something wrong.
 */
export async function fetchApiBuild() {
  try {
    /* Deliberately not the shared axios instance: that one is pinned to
       /api/v1 and carries auth and tenant headers this does not need. */
    const base = (import.meta.env.VITE_API_URL || '') + '/api';
    const { data } = await axios.get(`${base}/health`, { timeout: 8000 });
    return {
      commit: data?.version?.commit || null,
      branch: data?.version?.branch || null,
      startedAt: data?.version?.startedAt || null,
    };
  } catch {
    return null;
  }
}

/** True when the failure is "this server has no such route", not a real error. */
export const isMissingFeature = (err) =>
  err?.status === 404 || err?.response?.status === 404;
