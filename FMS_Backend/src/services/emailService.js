import nodemailer from 'nodemailer';
import { env, isProd, isTest } from '../config/env.js';

/**
 * Email delivery.
 *
 * Transport is chosen from the environment, with a deliberate order:
 *   1. SMTP is configured  → send for real
 *   2. NODE_ENV=test       → collect in memory so tests can assert on mail
 *   3. otherwise           → log the message (including any action link) to the
 *                            console so local development works with no setup
 *
 * The console fallback matters: without it, a developer running this app with
 * no SMTP account would find password reset silently broken with no way to get
 * the link. Printing it means the flow is fully testable out of the box.
 *
 * Sending NEVER throws into the caller. A failed welcome email must not roll
 * back a created trainer, and a failed reset email must not reveal to the
 * requester whether an address exists. Failures are logged and reported in the
 * return value instead.
 */

let transporter = null;
let mode = 'console';

/** Messages captured under NODE_ENV=test, for assertions. */
export const sentMail = [];

function getTransport() {
  if (transporter || mode !== 'console') return transporter;

  if (env.smtp.host && env.smtp.user) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
    mode = 'smtp';
  }
  return transporter;
}

/** Which transport is active — surfaced in Settings so an admin can see it. */
export function mailStatus() {
  if (env.smtp.host && env.smtp.user) return { mode: 'smtp', host: env.smtp.host, configured: true };
  if (isTest) return { mode: 'test', configured: false };
  return { mode: 'console', configured: false };
}

export async function sendMail({ to, subject, html, text }) {
  const message = {
    from: env.smtp.from,
    to,
    subject,
    text: text || stripHtml(html),
    html,
  };

  try {
    if (isTest) {
      sentMail.push(message);
      return { ok: true, mode: 'test' };
    }

    const t = getTransport();
    if (t) {
      await t.sendMail(message);
      return { ok: true, mode: 'smtp' };
    }

    // Console fallback — print enough to complete the flow by hand.
    console.log(
      `\n──── EMAIL (no SMTP configured) ────\n To: ${to}\n Subject: ${subject}\n\n${message.text}\n────────────────────────────────────\n`
    );
    return { ok: true, mode: 'console' };
  } catch (err) {
    // Never surface delivery failure to the caller's happy path.
    console.error('[mail] delivery failed:', err.message);
    return { ok: false, error: err.message };
  }
}

const stripHtml = (s = '') =>
  s.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/* ── Templates ─────────────────────────────────────────────────────────────
   Inline styles only: every major email client strips <style> blocks, and a
   table-free layout keeps it readable in the ones that also strip flexbox. */

const shell = (heading, body, cta) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f8fa;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <div style="background:#ea5829;padding:20px 24px">
      <p style="margin:0;color:#fff;font-size:17px;font-weight:700">${env.appName}</p>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:19px;color:#111827">${heading}</h1>
      <div style="font-size:14px;line-height:1.65;color:#4b5563">${body}</div>
      ${
        cta
          ? `<p style="margin:24px 0 8px"><a href="${cta.url}" style="display:inline-block;background:#ea5829;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:14px;font-weight:600">${cta.label}</a></p>
             <p style="margin:12px 0 0;font-size:12px;color:#6b7280;word-break:break-all">If the button doesn't work, paste this into your browser:<br>${cta.url}</p>`
          : ''
      }
    </div>
    <div style="padding:14px 24px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af">
      Sent by ${env.appName}. If you weren't expecting this, you can ignore it.
    </div>
  </div>
</div>`;

export function welcomeEmail({ name, email, password, loginUrl }) {
  return {
    subject: `Your ${env.appName} account`,
    html: shell(
      `Welcome, ${name}`,
      `<p>An account has been created for you.</p>
       <p style="background:#f7f8fa;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:16px 0">
         <strong>Email:</strong> ${email}<br>
         ${password ? `<strong>Temporary password:</strong> <code style="font-family:monospace;font-size:15px">${password}</code>` : ''}
       </p>
       <p>You'll be asked to choose your own password the first time you sign in.</p>`,
      { url: loginUrl, label: 'Sign in' }
    ),
  };
}

export function resetEmail({ name, resetUrl, minutes }) {
  return {
    subject: `Reset your ${env.appName} password`,
    html: shell(
      'Reset your password',
      `<p>Hi ${name || 'there'},</p>
       <p>We received a request to reset your password. This link is valid for <strong>${minutes} minutes</strong> and can be used once.</p>
       <p>If you didn't request it, no action is needed — your password hasn't changed.</p>`,
      { url: resetUrl, label: 'Choose a new password' }
    ),
  };
}

export function digestEmail({ name, period, stats, topClasses, appUrl }) {
  const rows = topClasses
    .map(
      (c) =>
        `<tr><td style="padding:6px 0;color:#111827">${c.name}</td>
             <td style="padding:6px 0;text-align:right;color:#6b7280">${c.responses} responses</td>
             <td style="padding:6px 0;text-align:right;font-weight:600;color:#111827">${c.average.toFixed(2)}</td></tr>`
    )
    .join('');

  return {
    subject: `${env.appName} — your ${period} summary`,
    html: shell(
      `Your ${period} summary`,
      `<p>Hi ${name || 'there'}, here's what came in.</p>
       <p style="background:#f7f8fa;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:16px 0">
         <strong>${stats.responses}</strong> new responses ·
         <strong>${stats.average ? stats.average.toFixed(2) : '—'}</strong> average rating ·
         <strong>${stats.openBatches}</strong> batches open
       </p>
       ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>` : '<p>No responses in this period.</p>'}`,
      { url: appUrl, label: 'Open the dashboard' }
    ),
  };
}
