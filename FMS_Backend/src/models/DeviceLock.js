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
 *
 * ROUNDS: the batch's `round` counter is mixed into the hashed signature, so
 * re-unlocking a batch for a second collection round yields entirely different
 * signatures. Round 1's locks stay on disk (a record that the round happened)
 * but can never collide with round 2. `round` is also stored plainly here so an
 * admin can see how many devices a given round locked.
 */
const deviceLockSchema = new mongoose.Schema(
  {
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
      required: true,
    },
    // sha256(batch + round + cookieToken + fingerprint + salt)
    signatureHash: { type: String, required: true },
    round: { type: Number, default: 0, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The core uniqueness guarantee: one signature per batch. `round` is already
// folded into signatureHash, so it must NOT be part of the key — including it
// would let a stale client replay a round-1 signature under round 2.
deviceLockSchema.index({ batch: 1, signatureHash: 1 }, { unique: true });
// "How many devices did round N lock?" for the admin's round summary.
deviceLockSchema.index({ batch: 1, round: 1 });

export const DeviceLock = mongoose.model('DeviceLock', deviceLockSchema);
