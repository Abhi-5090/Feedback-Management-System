import axios from 'axios';

/**
 * Central axios instance.
 *  - baseURL: VITE_API_URL if set (cross-origin), else same-origin '/api'
 *    (dev proxy in vite.config.js / nginx forwards to the backend).
 *  - withCredentials so the httpOnly auth cookie rides along. The browser is
 *    same-origin with the API in both the dev-proxy and nginx deployments, so
 *    the first-party cookie is the sole auth transport — the JWT is NEVER stored
 *    in JS-readable storage (no localStorage), which keeps it out of reach of XSS.
 */
const baseURL = (import.meta.env.VITE_API_URL || '') + '/api';

export const api = axios.create({ baseURL, withCredentials: true });

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
