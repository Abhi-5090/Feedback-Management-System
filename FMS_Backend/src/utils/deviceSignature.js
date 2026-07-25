import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Compute the irreversible device signature used by Layer 2 of the
 * anti-duplicate model (ARCHITECTURE §4).
 *
 *   signatureHash = sha256(batchId + cookieToken + fingerprint + serverSalt)
 *
 * - `batchId`      scopes the lock to one batch (same device may submit to a
 *                  different batch).
 * - `cookieToken`  first-party httpOnly token issued on first form load — the
 *                  strongest of the three signals (survives across the session
 *                  but is per-browser).
 * - `fingerprint`  a lightweight, non-identifying client hint (userAgent +
 *                  screen + timezone). Coarse on purpose: we want a soft
 *                  device signal, not a tracking-grade fingerprint.
 * - `serverSalt`   secret pepper so the hash cannot be reproduced off-server
 *                  and rainbow tables are useless.
 *
 * The result is a one-way hash stored in DeviceLock — never reversible to a
 * student, so it is not PII.
 */
export function computeSignatureHash({ batchId, cookieToken, fingerprint }) {
  return crypto
    .createHash('sha256')
    .update(`${batchId}::${cookieToken || ''}::${fingerprint || ''}::${env.deviceSalt}`)
    .digest('hex');
}

/** Issue a fresh random device token to store in the httpOnly cookie. */
export function issueDeviceToken() {
  return crypto.randomBytes(24).toString('hex');
}
