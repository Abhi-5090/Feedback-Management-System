import crypto from 'crypto';
import { User } from '../models/User.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { comparePassword, hashPassword, validatePasswordStrength } from '../utils/password.js';
import { unauthorized, badRequest, conflict } from '../utils/ApiError.js';
import { env, isProd } from '../config/env.js';
import { supportsTransactions } from '../config/db.js';
import { PASSCODE_ENTROPY_BITS } from '../utils/passcode.js';
import { MIN_PASSWORD_LENGTH } from '../utils/password.js';
import { sendMail, resetEmail, mailStatus } from '../services/emailService.js';
import { recordAudit } from '../services/auditService.js';

import {
  AUTH_COOKIE,
  signAuthToken,
  authCookieOptions,
} from '../utils/token.js';

/** Reset tokens are stored hashed — the raw value only ever lives in the email. */
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !user.isActive) throw unauthorized('Invalid credentials');

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid credentials');

  const token = signAuthToken(user);
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  // Also return the token in the body so header-based clients (tests, mobile)
  // can authenticate without cookies.
  recordAudit(req, { action: 'auth.login', entity: 'user', entityId: user._id, entityName: user.name, actor: user });

  res.json({ user, token, role: user.role });
});

// GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

/**
 * PATCH /api/auth/me   { name?, email?, currentPassword?, newPassword? }
 *
 * Self-service account management for BOTH roles. Until now nobody could change
 * their own password — an admin could reset a trainer's, but had no way to
 * rotate their own, which is a hard blocker for a product being sold.
 *
 * Changing the password requires the CURRENT one. Without that check, anyone
 * who walks up to an unlocked session could lock the real owner out, and a
 * stolen session cookie would become permanent account takeover.
 */
export const updateMe = asyncHandler(async (req, res) => {
  const { name, email, currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) throw unauthorized('Account not found');

  if (newPassword) {
    if (!currentPassword) throw badRequest('Enter your current password to set a new one.', 'CURRENT_PASSWORD_REQUIRED');
    const ok = await comparePassword(currentPassword, user.passwordHash);
    if (!ok) throw unauthorized('Your current password is incorrect.');
    /* The zod schema already applied the generic rules; this adds the checks
       that need to know WHO is setting it (own name, own email local-part),
       which a schema has no access to. */
    const weak = validatePasswordStrength(newPassword, { name: user.name, email: user.email });
    if (weak) throw badRequest(weak, 'WEAK_PASSWORD');
    if (await comparePassword(newPassword, user.passwordHash)) {
      throw badRequest('Your new password must be different from the current one.', 'PASSWORD_REUSED');
    }
    user.passwordHash = await hashPassword(newPassword);
    // Clear the bulk-import flag once a real password has been chosen.
    user.mustChangePassword = false;
    /* Revoke every token issued under the old password. "Change my password"
       is the action people take when they think someone else has access, so it
       has to actually end those sessions — a stateless JWT otherwise stays
       valid for its full 7 days. The caller's own cookie is re-issued below so
       the person doing the change isn't logged out of the tab they're in. */
    user.tokenVersion = (user.tokenVersion || 0) + 1;
  }

  if (email && email.toLowerCase() !== user.email) {
    const clash = await User.findOne({ email: email.toLowerCase() });
    if (clash) throw conflict('That email is already in use.', 'EMAIL_TAKEN');
    user.email = email;
  }
  if (name !== undefined) user.name = name;

  await user.save();

  if (newPassword) {
    // Keep THIS session alive with a token carrying the new generation.
    res.cookie(AUTH_COOKIE, signAuthToken(user), authCookieOptions());
    recordAudit(req, {
      action: 'auth.password_changed',
      entity: 'user',
      entityId: user._id,
      entityName: user.name,
      meta: { otherSessionsRevoked: true },
    });
  }

  res.json({ user, ...(newPassword ? { token: signAuthToken(user) } : {}) });
});

/**
 * POST /api/auth/forgot-password   { email }
 *
 * ALWAYS returns 200, whether or not the address exists. Responding
 * differently would turn this endpoint into a free account-enumeration oracle:
 * anyone could discover which staff emails are registered by watching the
 * status code. The user-visible copy says "if that address exists, we've sent
 * a link", which is true either way.
 *
 * Any previously-issued grants for the account are invalidated first, so
 * requesting a second link cannot leave an older one live.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const user = await User.findOne({ email });

  if (user && user.isActive) {
    await PasswordResetToken.updateMany(
      { user: user._id, usedAt: null },
      { usedAt: new Date() }
    );

    const raw = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({
      user: user._id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + env.resetTokenMinutes * 60_000),
      requestedIp: req.ip || '',
    });

    const resetUrl = `${env.appUrl}/reset-password?token=${raw}`;
    const mail = resetEmail({
      name: user.name,
      resetUrl,
      minutes: env.resetTokenMinutes,
    });
    await sendMail({ to: user.email, ...mail });
  }

  res.json({
    ok: true,
    message: 'If that email is registered, a reset link is on its way.',
  });
});

/**
 * POST /api/auth/reset-password   { token, newPassword }
 *
 * Consumes the grant, sets the password, and clears `mustChangePassword` —
 * choosing your own password through a reset satisfies the same requirement as
 * doing it through the first-login gate.
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  const grant = await PasswordResetToken.findOne({
    tokenHash: hashToken(token),
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!grant) throw badRequest('That reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');

  const user = await User.findById(grant.user);
  if (!user || !user.isActive) throw badRequest('That account is no longer active.', 'INACTIVE');

  const weak = validatePasswordStrength(newPassword, { name: user.name, email: user.email });
  if (weak) throw badRequest(weak, 'WEAK_PASSWORD');

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  // A reset is a recovery action — every existing session must die with the
  // old password, including whoever may have been using it.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  // Single-use: burn the grant, and any siblings issued for this account.
  grant.usedAt = new Date();
  await grant.save();
  await PasswordResetToken.updateMany({ user: user._id, usedAt: null }, { usedAt: new Date() });

  recordAudit(req, {
    action: 'auth.password_reset', entity: 'user', entityId: user._id, entityName: user.name, actor: user,
  });

  res.json({ ok: true, message: 'Your password has been changed. You can sign in now.' });
});

/**
 * PATCH /api/auth/me/digest   { enabled, frequency }
 * Opt in/out of the scheduled email summary. Per-user, both roles.
 */
export const updateDigest = asyncHandler(async (req, res) => {
  const { enabled, frequency } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) throw unauthorized('Account not found');

  user.digest = {
    enabled,
    frequency: frequency || user.digest?.frequency || 'weekly',
    // Reset the clock when enabling, so opting in doesn't immediately fire a
    // digest covering a period the user never asked about.
    lastSentAt: enabled ? new Date() : user.digest?.lastSentAt || null,
  };
  await user.save();
  res.json({ user });
});

// POST /api/auth/logout
export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

/**
 * POST /api/auth/logout-all
 *
 * Ends every session for this account, on every device, immediately. Clearing
 * one cookie only ends the session doing the clearing; this bumps the token
 * generation so all the others are refused too. The obvious thing to reach for
 * after "I left myself signed in on a lab machine".
 */
export const logoutEverywhere = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw unauthorized('Account not found');

  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined });
  recordAudit(req, {
    action: 'auth.logout_all',
    entity: 'user',
    entityId: user._id,
    entityName: user.name,
  });
  res.json({ ok: true, message: 'Signed out on all devices.' });
});

/**
 * GET /api/auth/system  (any signed-in user)
 *
 * What the Settings page needs to tell the truth about the deployment: is mail
 * actually configured, are transactions available, how strong is a passcode.
 * Previously `mailStatus()` existed but nothing imported it, so Settings showed
 * a hardcoded picture and the health check was a raw same-origin `fetch` that
 * reported "down" on any cross-origin deploy.
 */
export const systemStatus = asyncHandler(async (req, res) => {
  const admin = req.user.role === 'admin';
  res.json({
    ok: true,
    service: 'fms-api',
    appName: env.appName,
    environment: env.nodeEnv,
    /* Which commit this API is running. The frontend shows it beside its own,
       because the two deploy independently and can drift — a web build
       expecting fields an older API does not send yet is a real failure mode,
       and it happened: the API sat two commits behind for a day. Render
       injects RENDER_GIT_COMMIT on every deploy. */
    version: {
      commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown').slice(0, 7),
      branch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || 'unknown',
    },
    // Deployment internals are an admin concern; a trainer just needs "ok".
    ...(admin
      ? {
          mail: mailStatus(),
          transactions: supportsTransactions(),
          cookieSecure: env.cookieSecure,
          digestsEnabled: env.digestsEnabled,
          passcodeEntropyBits: PASSCODE_ENTROPY_BITS,
          minPasswordLength: MIN_PASSWORD_LENGTH,
          isProduction: isProd,
          rateLimits: {
            publicPerDevicePerMin: env.publicMaxPerDevice,
            publicPerIpPerMin: env.publicIpMax,
            loginPerIdentityPer15Min: env.loginMaxPerIdentity,
          },
        }
      : { minPasswordLength: MIN_PASSWORD_LENGTH }),
  });
});
