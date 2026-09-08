import { User } from '../models/User.js';
import { AUTH_COOKIE, verifyAuthToken } from '../utils/token.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { unauthorized, forbidden } from '../utils/ApiError.js';

/**
 * requireAuth — verifies the JWT from the httpOnly cookie (falls back to a
 * Bearer header for API testing), loads the user, and attaches it to req.user.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.[AUTH_COOKIE] || bearer;
  if (!token) throw unauthorized('Authentication required');

  let payload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    throw unauthorized('Invalid or expired session');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Account not found or disabled');

  /* Session generation check — the revocation half of the JWT story.
     A token minted before the user's last password change (or explicit
     "sign out everywhere") carries a stale `ver` and is refused here, even
     though its signature and expiry are both still valid. Tokens issued
     before this field existed have no `ver`; they are treated as generation 0
     so an in-flight session survives the upgrade rather than 401-ing
     everyone the moment this deploys. */
  const tokenVer = Number.isInteger(payload.ver) ? payload.ver : 0;
  if (tokenVer < (user.tokenVersion || 0)) {
    throw unauthorized('Your session has been signed out. Please sign in again.', 'SESSION_REVOKED');
  }

  req.user = user;
  next();
});

/**
 * requireRole('admin') — must run after requireAuth. Enforces role at the
 * route boundary. Trainer data isolation is additionally enforced inside each
 * trainer-scoped query (never trust the client to filter).
 */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden('Insufficient permissions'));
  return next();
};

/**
 * requirePasswordChanged — blocks accounts still on an issued password.
 *
 * Bulk-imported trainers all share one default password chosen by the admin.
 * Until each person replaces it, that single secret opens every one of those
 * accounts, so the flag has to actually gate something: this refuses every
 * data route with 403 PASSWORD_CHANGE_REQUIRED, which the client turns into a
 * forced change-password screen.
 *
 * Mounted per-router rather than globally so `/api/auth/me` and
 * `PATCH /api/auth/me` stay reachable — the user must be able to read who they
 * are and set a new password while locked out of everything else.
 */
export const requirePasswordChanged = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    return next(
      forbidden('Please choose a new password before continuing.', 'PASSWORD_CHANGE_REQUIRED')
    );
  }
  return next();
};
