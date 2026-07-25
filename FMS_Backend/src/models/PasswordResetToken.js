import mongoose from 'mongoose';

/**
 * A single-use password-reset grant.
 *
 * Only a SHA-256 hash of the token is stored — the raw value exists solely in
 * the emailed link. A database dump therefore cannot be used to reset anyone's
 * password, which is the same reasoning behind hashing batch passcodes.
 *
 * `expiresAt` carries a TTL index so Mongo removes stale grants itself; there
 * is no cleanup job to forget to run. `usedAt` makes the token single-use even
 * before expiry, so a link sitting in an inbox (or a mail-server log) can't be
 * replayed after the reset has already happened.
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// TTL: Mongo deletes the document once expiresAt passes.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetToken = mongoose.model('PasswordResetToken', schema);
