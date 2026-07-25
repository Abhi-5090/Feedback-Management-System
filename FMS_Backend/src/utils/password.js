import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

// Passcodes are hashed with the same bcrypt primitive as passwords.
export const hashPasscode = (plain) => bcrypt.hash(plain, ROUNDS);
export const comparePasscode = (plain, hash) => bcrypt.compare(plain, hash);

/** Generate a reasonably strong human-typeable password (for seeding admin). */
export function generateStrongPassword(len = 14) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  return Array.from({ length: len }, () => chars[crypto.randomInt(chars.length)]).join('');
}
