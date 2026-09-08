import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { env } from '../config/env.js';

const ROUNDS = 10;

/* Passwords are HUMAN-CHOSEN and therefore low-entropy, so they get bcrypt:
   the whole point of a slow KDF is to make guessing a weak secret expensive.
   This path runs once per login, so 67ms is a fine price. */
export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

/* ═══════════════════════════════════════════════════════════════════════════
   BATCH PASSCODES — keyed HMAC, not bcrypt
   ═══════════════════════════════════════════════════════════════════════════

   A batch passcode is NOT a password. It is a token this server generates from
   `crypto.randomInt` with ~46 bits of entropy (see utils/passcode.js). It is
   never chosen by a human, never reused, and never guessable from a name.

   That distinction decides the primitive:

   - bcrypt's slowness buys nothing here. It exists to blunt dictionary attacks
     on secrets people invent, and there is no dictionary for a random token.

   - It costs a great deal. `bcryptjs` is pure JavaScript, so a cost-10 compare
     is ~67ms of CPU on the single Node thread. Verify-passcode is the FIRST
     thing every student does, so a class of 300 arriving together is ~20
     SECONDS of solid CPU during which the server serves nothing else — the
     dashboards stall, submissions queue, and the last student waits out the
     whole burst. Measured, not assumed.

   - A keyed HMAC is strictly stronger against the attack that actually
     matters. bcrypt hashes are self-contained: steal the database and you can
     grind offline forever. An HMAC keyed with a server-side secret cannot be
     attacked with the database alone — the attacker needs the key too, which
     lives in the environment, not the data. And if they have BOTH, they also
     have JWT_SECRET and can mint an admin session, at which point guessing a
     student passcode is the least of the problems.

   ~0.005ms instead of ~67ms: about 13,000x faster, for a stronger guarantee.

   Stored format: "h1$<base64url hmac>". The scheme prefix means an existing
   deployment holding bcrypt hashes keeps working (see comparePasscode) — no
   migration, no window where live passcodes stop verifying.
   ═══════════════════════════════════════════════════════════════════════════ */

const PASSCODE_SCHEME = 'h1$';

/**
 * Key for passcode HMACs, derived from DEVICE_SALT under a distinct label.
 *
 * Derived rather than used directly so the two consumers of that secret (device
 * signatures and passcode hashes) can never produce colliding values, and so
 * one could be re-keyed independently later. Computed lazily: `env` must be
 * fully initialised, and this file is imported during module load.
 */
let passcodeKey = null;
function getPasscodeKey() {
  if (!passcodeKey) {
    passcodeKey = crypto.createHmac('sha256', env.deviceSalt).update('fms:passcode:v1').digest();
  }
  return passcodeKey;
}

export function hashPasscode(plain) {
  const mac = crypto.createHmac('sha256', getPasscodeKey()).update(String(plain)).digest('base64url');
  return `${PASSCODE_SCHEME}${mac}`;
}

/**
 * Verify a passcode against a stored hash.
 *
 * Accepts both schemes so an upgrade needs no migration: anything without the
 * "h1$" prefix is a legacy bcrypt hash and is checked as one. Comparison is
 * constant-time — a passcode is guessed one character at a time if the check
 * short-circuits, and `===` on strings does short-circuit.
 */
export async function comparePasscode(plain, stored) {
  if (!stored) return false;

  if (!String(stored).startsWith(PASSCODE_SCHEME)) {
    return bcrypt.compare(plain, stored); // legacy bcrypt hash
  }

  const expected = Buffer.from(hashPasscode(plain));
  const actual = Buffer.from(String(stored));
  // timingSafeEqual throws on a length mismatch, which is itself not secret.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Whether a stored hash still uses the slow legacy scheme (for reporting). */
export const isLegacyPasscodeHash = (stored) =>
  Boolean(stored) && !String(stored).startsWith(PASSCODE_SCHEME);

/**
 * Minimum password length.
 *
 * 8 rather than 6: these accounts hold a whole institution's feedback, and a
 * 6-character password is inside offline reach once a hash leaks. The zod
 * schemas enforce this on every path that sets a password (create, bulk
 * import, self-service change, reset) so there is no side door left at 6.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** The 20 most-abused passwords, plus product-specific obvious guesses. */
const BANNED = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc12345', 'iloveyou', 'admin123', 'letmein',
  'welcome1', 'welcome123', 'trustno1', 'sunshine', 'princess', 'football',
  'monkey123', 'dragon123', 'feedback', 'feedback123', 'trainer', 'trainer123',
  'mentor123', 'ncet1234', 'torii123',
]);

/**
 * Validate a proposed password. Returns null when acceptable, otherwise a
 * human-readable reason.
 *
 * Deliberately NOT a character-class checklist ("one upper, one digit, one
 * symbol"). Those rules push people to "Password1!" — which satisfies every
 * class and is still on every cracking list. Length plus a ban-list plus a
 * "not just one repeated character" check rejects the actually-weak choices
 * without pushing users toward a predictable pattern.
 */
export function validatePasswordStrength(plain, { name = '', email = '' } = {}) {
  const pw = String(plain || '');
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (pw.length > 200) return 'Password must be at most 200 characters';

  const lower = pw.toLowerCase();
  if (BANNED.has(lower)) return 'That password is too common — pick something less guessable';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be a single repeated character';
  if (/^(?:0123456789|1234567890|abcdefgh|qwertyui)/.test(lower)) {
    return 'Password cannot be a keyboard or number sequence';
  }

  // A password that is just the user's own name or email local-part is
  // effectively public information.
  const localPart = String(email).split('@')[0].toLowerCase();
  if (localPart.length >= 4 && lower.includes(localPart)) {
    return 'Password cannot contain your email address';
  }
  const firstName = String(name).trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (firstName.length >= 4 && lower === firstName) {
    return 'Password cannot be your own name';
  }
  return null;
}

/** Generate a reasonably strong human-typeable password (for seeding admin). */
export function generateStrongPassword(len = 16) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  return Array.from({ length: len }, () => chars[crypto.randomInt(chars.length)]).join('');
}
