import crypto from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238), implemented here rather than
 * pulled in.
 *
 * It is about forty lines of HMAC and a counter, and the alternative is
 * another dependency in the tree of an application that holds students'
 * anonymous testimony. A library would have to earn that, and for this it
 * cannot: there is nothing here to get subtly wrong that the RFC's own test
 * vectors do not catch, and those run in the suite.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[=\s]/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh secret. 20 bytes is what RFC 4226 recommends for HMAC-SHA1. */
export const generateSecret = () => toBase32(crypto.randomBytes(20));

/** The code for one 30-second step. Exported so the tests can drive time. */
export function codeFor(secret, counter, digits = 6) {
  const key = fromBase32(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(buf).digest();
  // Dynamic truncation, RFC 4226 §5.3.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const STEP_SECONDS = 30;

export const currentCode = (secret, at = Date.now()) =>
  codeFor(secret, Math.floor(at / 1000 / STEP_SECONDS));

/**
 * Verify a submitted code.
 *
 * ONE STEP of tolerance either side, not more. Phones drift and people finish
 * typing a second late, which a zero-width window punishes for no security
 * gain; a wide window is just a longer-lived password. Compared in constant
 * time, because a timing difference leaks how much of a guess was right.
 */
export function verifyCode(secret, submitted, { at = Date.now(), window = 1 } = {}) {
  const clean = String(submitted || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  const step = Math.floor(at / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i += 1) {
    const expected = codeFor(secret, step + i);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app reads from a QR code. */
export function otpauthURL({ secret, account, issuer = 'Feedback Management' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
