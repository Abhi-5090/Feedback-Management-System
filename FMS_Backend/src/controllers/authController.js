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
import { sendMail, resetEmail, mailStatus, orgFromName } from '../services/emailService.js';
import { recordAudit } from '../services/auditService.js';

import {
  AUTH_COOKIE,
  signAuthToken,
  authCookieOptions,
} from '../utils/token.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { generateSecret, verifyCode, otpauthURL, currentCode } from '../utils/totp.js';

/** Reset tokens are stored hashed — the raw value only ever lives in the email. */
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  /* Identity lookups are platform-wide: an email identifies one person
     across the whole product, and at sign-in nobody knows their tenant yet.
     Email uniqueness stays global for exactly this reason — a per-tenant
     unique index would make the same address resolve to two accounts and give
     the login form no way to choose. */
  const user = await runUnscoped(() => User.findOne({ email: email.toLowerCase() }));
  if (!user || !user.isActive) throw unauthorized('Invalid credentials');

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid credentials');

  /* SECOND FACTOR, before any session exists.
     
     Returning a token and then asking for a code would mean the password
     alone had already bought a working session — which is the thing a second
     factor is for. The account is identified, nothing is issued, and the
     client comes back with the code. */
  if (user.twoFactor?.enabledAt) {
    const withSecret = await runUnscoped(() =>
      User.findById(user._id).select('+twoFactor.secret')
    );
    const code = String(req.body?.code || '').trim();
    if (!code) {
      return res.status(200).json({
        twoFactorRequired: true,
        /* Deliberately no token, no user object: until the code arrives this
           request has proved one factor, and the response should not look
           like a sign-in. */
      });
    }
    if (!verifyCode(withSecret.twoFactor.secret, code)) {
      recordAudit(req, {
        action: 'auth.2fa_failed',
        entity: 'user',
        entityId: user._id,
        entityName: user.name,
        actor: user,
      });
      throw unauthorized('That code is not right. Codes change every 30 seconds.', 'BAD_2FA_CODE');
    }
  }

  const token = signAuthToken(user);
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  // Also return the token in the body so header-based clients (tests, mobile)
  // can authenticate without cookies.
  recordAudit(req, { action: 'auth.login', entity: 'user', entityId: user._id, entityName: user.name, actor: user });

  res.json({ user, token, role: user.role });
});

// GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  /* The organization rides along because the client needs its TIMEZONE before
     it renders a single date. Fetching it separately would mean every screen
     either waits for a second request or renders once in the wrong zone and
     then corrects itself, which is worse than being consistently wrong. */
  const organization = req.organization
    ? {
        id: String(req.organization._id),
        name: req.organization.name,
        slug: req.organization.slug,
        settings: {
          timezone: req.organization.settings?.timezone || 'Asia/Kolkata',
          displayName: req.organization.settings?.displayName || '',
          weekStartsOn: req.organization.settings?.weekStartsOn || 'monday',
        },
      }
    : null;
  res.json({ user: req.user, organization });
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
  const user = await runUnscoped(() => User.findById(req.user._id));
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
    const clash = await runUnscoped(() => User.findOne({ email: email.toLowerCase() }));
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
  const user = await runUnscoped(() => User.findOne({ email }));

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
    await sendMail({ to: user.email, ...mail, fromName: orgFromName(req) });
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

  const user = await runUnscoped(() => User.findById(grant.user));
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
  const user = await runUnscoped(() => User.findById(req.user._id));
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
  const user = await runUnscoped(() => User.findById(req.user._id));
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

/**
 * POST /api/auth/2fa/start — begin enrolment.
 *
 * Returns a secret and the otpauth URI an authenticator app reads. It is NOT
 * enabled yet: a secret handed out and switched on in the same step locks
 * people out of their own accounts when the QR code does not scan, and the
 * account that most needs a second factor is the one it is most costly to be
 * locked out of.
 */
export const startTwoFactor = asyncHandler(async (req, res) => {
  const secret = generateSecret();
  const user = await runUnscoped(() => User.findById(req.user._id).select('+twoFactor.secret'));
  user.twoFactor.secret = secret;
  user.twoFactor.enabledAt = null; // not live until a code is proved
  await user.save({ validateBeforeSave: false });

  res.json({
    secret,
    otpauthUrl: otpauthURL({ secret, account: user.email }),
  });
});

/** POST /api/auth/2fa/enable  { code } — prove the app works, then switch on. */
export const enableTwoFactor = asyncHandler(async (req, res) => {
  const user = await runUnscoped(() => User.findById(req.user._id).select('+twoFactor.secret'));
  if (!user.twoFactor?.secret) throw badRequest('Start enrolment first', 'NO_ENROLMENT');
  if (!verifyCode(user.twoFactor.secret, req.body?.code)) {
    throw badRequest('That code is not right. Codes change every 30 seconds.', 'BAD_2FA_CODE');
  }

  user.twoFactor.enabledAt = new Date();
  /* Existing sessions are revoked. Turning on a second factor is usually a
     response to a worry about who else is signed in, and leaving those
     sessions alive answers the worry with "not yet". */
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });

  recordAudit(req, { action: 'auth.2fa_enabled', entity: 'user', entityId: user._id, entityName: user.name });
  res.json({ enabled: true, enabledAt: user.twoFactor.enabledAt, token: signAuthToken(user) });
});

/** POST /api/auth/2fa/disable  { currentPassword, code } — both, deliberately. */
export const disableTwoFactor = asyncHandler(async (req, res) => {
  const user = await runUnscoped(() => User.findById(req.user._id).select('+passwordHash +twoFactor.secret'));
  if (!user.twoFactor?.enabledAt) throw badRequest('Two-factor is not enabled', 'NOT_ENABLED');

  /* Password AND a code. Someone sitting at an unlocked laptop has neither,
     which is exactly the person this is defending against. */
  const okPassword = await comparePassword(String(req.body?.currentPassword || ''), user.passwordHash);
  if (!okPassword) throw badRequest('Current password is required', 'BAD_PASSWORD');
  if (!verifyCode(user.twoFactor.secret, req.body?.code)) {
    throw badRequest('That code is not right.', 'BAD_2FA_CODE');
  }

  user.twoFactor.secret = null;
  user.twoFactor.enabledAt = null;
  await user.save({ validateBeforeSave: false });

  recordAudit(req, { action: 'auth.2fa_disabled', entity: 'user', entityId: user._id, entityName: user.name });
  res.json({ enabled: false });
});
