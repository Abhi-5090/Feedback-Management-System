import { User } from '../models/User.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { resolveTenantFor, enterResolvedTenant } from './tenant.js';
import { perOrganizationLimiter } from './rateLimit.js';
import { AUTH_COOKIE, verifyAuthToken } from '../utils/token.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { unauthorized, forbidden, badRequest } from '../utils/ApiError.js';

/**
 * requireAuth — verifies the JWT from the httpOnly cookie (falls back to a
 * Bearer header for API testing), loads the user, and attaches it to req.user.
 */
export const requireAuth = asyncHandler(async (req, res, next) => {
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

  /* Unscoped by necessity: this IS the lookup that establishes which tenant
     the request belongs to, so it cannot already be filtered by one. Every
     query after it runs inside the tenant that resolveTenant then enters. */
  const user = await runUnscoped(() => User.findById(payload.sub));
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

  /* Tenant resolution is part of authenticating, not a separate step a route
     can forget to add. Nothing enters a tenant context before this point, so
     an authenticated route that somehow skipped it would throw on its first
     query rather than run across every organization. */
  /* A handful of routes must work BEFORE an organization is chosen — the one
     that lists the choices, and the one that reads your own account. Without
     this, somebody who works at two institutions meets a locked door with the
     key behind it. The opt-out is explicit and names itself at the route, so
     it cannot be inherited by accident. */
  let org = null;
  try {
    org = await resolveTenantFor(req);
  } catch (err) {
    if (!(req.tenantOptional && err?.code === 'ORGANIZATION_CHOICE_REQUIRED')) throw err;
    org = null;
  }
  /* Entered HERE rather than inside the resolver: enterWith() binds to the
     current execution context, so it must happen on the synchronous path to
     next() or the handlers downstream never see it. */
  enterResolvedTenant(org);

  /* The per-organization budget runs from here because here is the first
     point the organization is known. Mounted on a router instead, it would
     either run before the tenant was resolved (and key everything into one
     bucket) or have to be remembered on every router that exists. */
  return perOrganizationLimiter(req, res, next);
});

/**
 * requireRole('admin') — must run after requireAuth. Enforces role at the
 * route boundary. Trainer data isolation is additionally enforced inside each
 * trainer-scoped query (never trust the client to filter).
 */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());

  /* A super admin administering a chosen organization acts as its admin —
     there is deliberately no second copy of the admin API for them, because
     two copies drift and only one of them gets the next security fix.
     
     THE ORGANIZATION IS MANDATORY HERE. A super admin with none selected is
     UNSCOPED, and unscoped is correct for the platform routes (list every
     tenant) and catastrophic for these (return every tenant's feedback under
     a heading that says "your classes"). Refusing is the only safe reading:
     there is no sensible organization to guess. */
  /* PERMISSIONS COME FROM THE MEMBERSHIP, not the person. A mentor at one
     institution who administers another must be an admin only where a
     membership row says so — reading the global role here would carry their
     authority across the line. */
  const effective = req.membershipRole || req.user.role;

  if (req.user.role === 'superadmin' && roles.includes('admin')) {
    if (!req.organization) {
      return next(
        badRequest(
          'Choose an organization before using the admin screens.',
          'ORGANIZATION_REQUIRED'
        )
      );
    }
    return next();
  }

  if (!roles.includes(effective)) return next(forbidden('Insufficient permissions'));
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

/**
 * Marks a route as reachable before an organization has been chosen.
 *
 * Deliberately a separate middleware written at the route rather than a
 * default: a route that forgets it fails loudly with "choose an
 * organization", while a route that silently inherited it would run with no
 * tenant at all.
 */
export const tenantOptional = (req, _res, next) => {
  req.tenantOptional = true;
  next();
};
