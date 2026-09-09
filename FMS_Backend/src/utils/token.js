import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const AUTH_COOKIE = 'fms_token';
export const DEVICE_COOKIE = 'fms_device';

/**
 * Sign a JWT carrying the user id, role and session generation.
 *
 * `ver` mirrors `user.tokenVersion`. requireAuth rejects a token whose `ver`
 * is behind the stored value, which is what makes a password change (or an
 * explicit "sign out everywhere") revoke tokens that were already issued.
 * Without it a stolen 7-day token outlives the very action meant to kill it.
 */
export function signAuthToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, ver: user.tokenVersion || 0 },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

export function verifyAuthToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

/**
 * Options for the auth cookie — httpOnly so JS can never read the JWT.
 *
 * The frontend is served same-origin with the API (vite proxy in dev, nginx
 * reverse-proxy in the container), so `sameSite: 'lax'` is correct AND adds
 * CSRF protection that `'none'` would forfeit. `secure` is driven by
 * `env.cookieSecure` (defaults on in production, but can be turned off for a
 * plain-HTTP demo) rather than hard-coded to NODE_ENV, so an HTTP deployment
 * doesn't silently drop a `Secure` cookie the browser then refuses to send.
 */
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    // 'lax' unless the deployment genuinely serves the SPA and API from
    // different origins — see env.cookieSameSite for what 'none' costs.
    sameSite: env.cookieSameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

/** Options for the first-party device cookie (anti-duplicate Layer 2). */
export function deviceCookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    maxAge: 180 * 24 * 60 * 60 * 1000, // long-lived; scopes "this device"
    path: '/',
  };
}
