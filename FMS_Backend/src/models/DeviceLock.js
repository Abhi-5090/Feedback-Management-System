import mongoose from 'mongoose';

/**
 * DeviceLock — Layer 2 of the anti-duplicate model (see ARCHITECTURE §4).
 *
 * Stores ONLY an irreversible salted hash of a device signature, in a
 * collection SEPARATE from Feedback. The unique compound index
 * { batch, signatureHash } is the real database-level guard against a repeat
 * submission from the same device for the same batch.
 *
 * Because the hash is one-way and lives outside Feedback, it is not PII and
 * cannot be traced back to a student — anonymity is preserved while still
 * blocking the casual double-submit.
 */
const deviceLockSchema = new mongoose.Schema(
  {
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
      required: true,
    },
    signatureHash: { type: String, required: true }, // sha256(batch + cookieToken + fingerprint + salt)
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The core uniqueness guarantee: one signature per batch.
deviceLockSchema.index({ batch: 1, signatureHash: 1 }, { unique: true });

export const DeviceLock = mongoose.model('DeviceLock', deviceLockSchema);