import { asyncHandler } from '../utils/asyncHandler.js';
import { runDigests } from '../services/digestService.js';
import { recordAudit } from '../services/auditService.js';
import { sendMail, mailStatus } from '../services/emailService.js';
import { env } from '../config/env.js';
import { badRequest } from '../utils/ApiError.js';
import { ACTION_LABELS } from '../services/auditService.js';

/**
 * POST /api/system/digests/run  (admin)
 *
 * Fires any digests that are due, right now. The scheduler already does this
 * hourly; this exists because "did the digest actually work?" is otherwise
 * unanswerable without waiting an hour and reading server logs.
 * `force: true` ignores the per-recipient period so a test send is possible.
 */
export const runDigestsNow = asyncHandler(async (req, res) => {
  const force = req.query.force === 'true' || req.body?.force === true;
  const result = await runDigests({ force });

  recordAudit(req, {
    action: 'system.digest_run',
    entity: 'system',
    entityName: 'Email digests',
    meta: result,
  });

  res.json({ ok: true, ...result, forced: force });
});

/** GET /api/system/audit-actions — the human labels for the audit viewer. */
export const auditActions = asyncHandler(async (_req, res) => {
  res.json({ labels: ACTION_LABELS });
});

/**
 * POST /api/system/mail/test  (admin)   { to? }
 *
 * Sends a real message through whatever transport is configured and reports
 * exactly what happened.
 *
 * Without this, "is email working?" can only be answered by triggering a
 * password reset for a real person and asking them — and if it silently falls
 * back to the console, the answer looks identical to success. This distinguishes
 * "delivered by SMTP" from "printed to the server log", and surfaces the SMTP
 * error verbatim when the credentials are wrong, which is the single most
 * common cause.
 */
export const sendTestMail = asyncHandler(async (req, res) => {
  const to = String(req.body?.to || req.user.email || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw badRequest('Give a valid address to send the test to.', 'BAD_EMAIL');
  }

  const status = mailStatus();
  const when = new Date().toLocaleString();
  const result = await sendMail({
    to,
    subject: `${env.appName} — test message`,
    html: `<p>This is a test from ${env.appName}.</p>
           <p>If you are reading it in your inbox, password-reset and welcome
              mail will reach your mentors.</p>
           <p style="color:#6b7280;font-size:12px">Requested by ${req.user.name} at ${when}.</p>`,
  });

  recordAudit(req, {
    action: 'system.mail_test',
    entity: 'system',
    entityName: 'Email test',
    meta: { to, mode: result.mode, delivered: Boolean(result.delivered), ok: result.ok },
  });

  if (!result.ok) {
    // Pass the transport's own error through — "Invalid login" or "self-signed
    // certificate" tells an admin what to fix; "could not send" does not.
    return res.status(502).json({
      ok: false,
      configured: status.configured,
      mode: result.mode,
      error: result.error,
      hint: 'Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS. Gmail and most providers require an app-specific password, not the account password.',
    });
  }

  res.json({
    ok: true,
    configured: status.configured,
    mode: result.mode,
    delivered: Boolean(result.delivered),
    to,
    notice: result.delivered
      ? `Sent to ${to} via ${status.host || result.mode}. Check the inbox (and the spam folder).`
      : 'Email is NOT configured, so nothing was sent — the message was printed to the server log. Set SMTP_HOST, SMTP_USER and SMTP_PASS to deliver for real.',
  });
});
