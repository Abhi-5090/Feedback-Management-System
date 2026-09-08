import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Compute the irreversible device signature used by Layer 2 of the
 * anti-duplicate model (ARCHITECTURE §4).
 *
 *   signatureHash = sha256(batchId + round + cookieToken + fingerprint + salt)
 *
 * - `batchId`      scopes the lock to one batch (same device may submit to a
 *                  different batch).
 * - `round`        scopes it to one COLLECTION ROUND. Re-unlocking a batch
 *                  bumps the round, so a legitimate second round is not
 *                  blocked by the first round's locks.
 * - `cookieToken`  first-party httpOnly token issued on first form load — the
 *                  strongest of the signals (survives across the session but
 *                  is per-browser).
 * - `fingerprint`  a lightweight, non-identifying client hint (userAgent +
 *                  screen + timezone). Coarse on purpose: we want a soft
 *                  device signal, not a tracking-grade fingerprint.
 * - `serverSalt`   secret pepper so the hash cannot be reproduced off-server
 *                  and rainbow tables are useless.
 *
 * The result is a one-way hash stored in DeviceLock — never reversible to a
 * student, so it is not PII.
 */
export function computeSignatureHash({ batchId, round = 0, cookieToken, fingerprint }) {
  return crypto
    .createHash('sha256')
    .update(
      `${batchId}::r${round}::${cookieToken || ''}::${fingerprint || ''}::${env.deviceSalt}`
    )
    .digest('hex');
}

/** Issue a fresh random device token to store in the httpOnly cookie. */
export function issueDeviceToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Whether a submission has a usable first-party device token.
 *
 * With cookies blocked the signature collapses to
 * sha256(batch + round + '' + fingerprint + salt), and a coarse fingerprint
 * (UA + screen + timezone) is NOT unique across a lab of identical machines —
 * so two different students would collide and the second would be wrongly
 * rejected as a duplicate. The caller uses this to skip the device lock and
 * fall back to the passcode gate + live cap, which is the correct trade: a
 * false "you already submitted" silently loses a real response, while the
 * remaining layers still bound the damage.
 */
export const hasReliableDeviceToken = (cookieToken) =>
  typeof cookieToken === 'string' && cookieToken.length >= 24;
