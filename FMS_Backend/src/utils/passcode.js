import crypto from 'crypto';

/**
 * ============================================================================
 * BATCH PASSCODE ALGORITHM  (ARCHITECTURE §3 — the tricky requirement)
 * ============================================================================
 *
 * Goal: produce a passcode that simultaneously
 *   (a) RESONATES the batch's identity — a human glancing at it can tell which
 *       batch it belongs to, because it starts from a stem derived from the
 *       batch name;
 *   (b) is RANDOM and unguessable — the bulk of the code is cryptographically
 *       random entropy from crypto.randomInt (never Math.random);
 *   (c) ROTATES on every unlock — this is a pure function of (name, randomness),
 *       so every call yields a fresh code and the previous one dies.
 *
 * ENTROPY. The stem is public information: it is derived from a batch name the
 * students already know, so it contributes ZERO secrecy and must not be
 * counted. Only the random tail is a secret. The tail is 8 characters drawn
 * from a 31-symbol alphabet plus 2 independently-placed symbols from an
 * 8-symbol set:
 *
 *   8 × log2(31) + 2 × log2(8)  ≈  39.6 + 6  ≈  45 bits
 *
 * ~3.5 × 10^13 candidates. Behind bcrypt (≈100ms/guess) and the per-device
 * rate limiter, an online attack is hopeless, and an offline attack on a
 * stolen hash is bounded by bcrypt's work factor. The previous shape yielded
 * only ~24 bits (≈17M), which is inside reach of a determined offline attacker
 * once the hash leaks — hence the widening.
 *
 * Safety of the charset:
 *   - Ambiguous glyphs are excluded to reduce student typos: 0 O, 1 l I.
 *     => letters are A–Z minus I, O, L; digits are 2–9.
 *   - Symbols are limited to a URL/DB-safe set: ! @ # $ % & * ?
 *     (we avoid < > " ' / \ and whitespace).
 *
 * Storage: only bcrypt(passcode) is persisted (see batch controller). The
 * plaintext returned here is shown to the admin exactly once at unlock time.
 * ============================================================================
 */

const SYMBOLS = '!@#$%&*?';
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // A–Z without I, O, L  (23)
const DIGITS = '23456789'; // 2–9 without 0, 1                     (8)
const ALNUM = LETTERS + DIGITS; //                                 (31)

/** Cryptographically pick one character from a set. */
const pick = (set) => set[crypto.randomInt(set.length)];

/** Build a string of `n` cryptographically-random chars from `set`. */
const randChars = (set, n) => Array.from({ length: n }, () => pick(set)).join('');

/**
 * Derive a short, recognisable STEM from the batch name.
 *  - Strip non-alphanumerics.
 *  - Multi-word name  → initials of each word ("Full Stack Aug" → "FSA").
 *  - Single-word name → its leading characters ("React" → "REAC").
 *  - Uppercase, clamp to 4 chars, pad short stems with 'X' so the code always
 *    opens with an identity block of at least 2 chars.
 *
 * Note the stem is deliberately typo-safe too: characters outside the safe
 * alphabet (I, O, L, 0, 1) are folded to their unambiguous look-alikes so a
 * student never has to guess whether they are reading an I or a 1.
 */
export function stemFromName(name = '') {
  const cleaned = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  let stem;
  if (words.length > 1) {
    stem = words.map((w) => w[0]).join(''); // initials of each word
  } else {
    stem = (words[0] || '').replace(/[^A-Za-z0-9]/g, ''); // single word → leading chars
  }

  return stem
    .toUpperCase()
    .replace(/[IL]/g, 'J')
    .replace(/O/g, 'Q')
    .replace(/0/g, '2')
    .replace(/1/g, '7')
    .slice(0, 4)
    .padEnd(2, 'X');
}

/**
 * Generate a fresh batch passcode. Length lands in the 12–14 range.
 *
 * Shape:  STEM  SYM  (4 random alnum)  SYM  (4 random alnum)
 * Example: batch "C · Batch-1"
 *          stem "CB7" → e.g.  CB7 @ K73X # 9WQ4  → "CB7@K73X#9WQ4"
 *
 * The interleaving (stem, symbol, random, symbol, random) makes the code read
 * as ONE identity token rather than "name" glued to "random junk", while every
 * character after the stem is cryptographically random.
 */
export function generateBatchPasscode(batchName) {
  const stem = stemFromName(batchName); // 2–4 chars of PUBLIC identity

  const code = [
    stem,
    pick(SYMBOLS),
    randChars(ALNUM, 4),
    pick(SYMBOLS),
    randChars(ALNUM, 4),
  ].join('');

  return code;
}

/**
 * Bits of secrecy in a generated passcode — the random tail only, never the
 * name-derived stem. Exported so the admin UI can state the strength honestly
 * and so a test can assert it never regresses.
 */
export const PASSCODE_ENTROPY_BITS = Math.round(
  8 * Math.log2(ALNUM.length) + 2 * Math.log2(SYMBOLS.length)
);
