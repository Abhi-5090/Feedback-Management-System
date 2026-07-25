import crypto from 'crypto';
import { User } from '../models/User.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { unauthorized, badRequest, conflict } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { sendMail, resetEmail } from '../services/emailService.js';
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
    user.passwordHash = await hashPassword(newPassword);
    // Clear the bulk-import flag once a real password has been chosen.
    user.mustChangePassword = false;
  }

  if (email && email.toLowerCase() !== user.email) {
    const clash = await User.findOne({ email: email.toLowerCase() });
    if (clash) throw conflict('That email is already in use.', 'EMAIL_TAKEN');
    user.email = email;
  }
  if (name !== undefined) user.name = name;

  await user.save();

  if (newPassword) {
    recordAudit(req, { action: 'auth.password_changed', entity: 'user', entityId: user._id, entityName: user.name });
  }

  res.json({ user });
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

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
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
