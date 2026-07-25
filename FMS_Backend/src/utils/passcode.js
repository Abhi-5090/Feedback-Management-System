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
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // A–Z without I, O, L
const DIGITS = '23456789'; // 2–9 without 0, 1
const ALNUM = LETTERS + DIGITS;

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

  return stem.toUpperCase().slice(0, 4).padEnd(2, 'X');
}

/**
 * Generate a fresh batch passcode. Length lands in the 8–12 range.
 *
 * Shape:  STEM  SYM  (letter digit digit letter)  SYM  digit
 * Example: batch "Full Stack Aug 2025"
 *          stem "FSA" → e.g.  FSA @ K73X # 9  → "FSA@K73X#9"
 *
 * The interleaving (stem, symbol, mixed alnum, symbol, digit) makes the code
 * read as ONE identity token rather than "name" glued to "random junk".
 */
export function generateBatchPasscode(batchName) {
  const stem = stemFromName(batchName); // 2–4 chars of identity

  // Mixed random middle: letter, two digits, letter  → e.g. "K73X"
  const mixed = randChars(LETTERS, 1) + randChars(DIGITS, 2) + randChars(LETTERS, 1);

  let code = `${stem}${pick(SYMBOLS)}${mixed}${pick(SYMBOLS)}${randChars(DIGITS, 1)}`;

  // Guarantee the 8–12 length window even for very short stems: top up with
  // random alphanumerics if we are under 8. (A 4-char stem already yields 11.)
  while (code.length < 8) code += pick(ALNUM);
  if (code.length > 12) code = code.slice(0, 12);

  return code;
}
