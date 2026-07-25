import mongoose from 'mongoose';

/**
 * Feedback — one anonymous submission tied to a Batch.
 *
 * ANONYMITY GUARANTEE: this document deliberately stores NO student identity,
 * NO IP address, and NO device signature. The device signature that enforces
 * "one per device" lives in the separate DeviceLock collection, so a comment
 * can never be correlated back to a device even by the admin or DBA.
 */
const ratingSchema = new mongoose.Schema(
  {
    parameter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parameter',
      required: true,
    },
    stars: { type: Number, required: true, min: 1, max: 5 },
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
      required: true,
      index: true,
    },
    // Denormalised for fast trainer/admin analytics (avoids a join to Batch).
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
      index: true,
    },
    // The EFFECTIVE trainer for this (batch, class) — copied from the batch's
    // class entry at submission time. Trainer isolation scopes on THIS field,
    // so a per-batch trainer override correctly routes the feedback to whoever
    // actually taught, not to the class's catalog owner. Denormalised so every
    // trainer-scoped aggregation is a single indexed match with no join.
    trainer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    ratings: {
      type: [ratingSchema],
      required: true,
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one rating is required'],
    },
    comment: { type: String, required: true, trim: true, minlength: 10 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Feedback = mongoose.model('Feedback', feedbackSchema);