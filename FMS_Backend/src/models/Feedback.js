import mongoose from 'mongoose';

/**
 * Feedback — one anonymous submission about one class of one batch.
 *
 * ANONYMITY GUARANTEE: this document deliberately stores NO student identity,
 * NO IP address, and NO device signature. The device signature that enforces
 * "one per device" lives in the separate DeviceLock collection, so a comment
 * can never be correlated back to a device even by the admin or DBA.
 *
 * ATTRIBUTION: a session is rated once and that rating belongs to the whole
 * mentor team, split by the role each person held. Both rosters are copied
 * from the batch's class entry at submission time, so:
 *   - a mentor sees a session's feedback if they are in EITHER roster,
 *   - their dashboard can separate "as main" from "as support",
 *   - a later change to the batch's staffing never rewrites history.
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

    // The EFFECTIVE mentor rosters for this (batch, class), copied at
    // submission time. Isolation and role-split analytics scope on these.
    mainTrainers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one main mentor is required'],
      index: true,
    },
    supportTrainers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      index: true,
    },

    // Which round of collection this belongs to (Batch.round at submit time),
    // so re-running a batch produces comparable, separable cohorts.
    round: { type: Number, default: 0, min: 0 },

    ratings: {
      type: [ratingSchema],
      required: true,
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one rating is required'],
    },
    comment: { type: String, required: true, trim: true, minlength: 10 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/* ── Indexes ───────────────────────────────────────────────────────────────
   Every analytics query is "match a scope, then sort or bucket by time", so
   each scoping field is paired with createdAt. Without the createdAt half,
   the trend/recent-comments/date-range queries sort in memory after a full
   scan of the scope — which is exactly what a dashboard polling every 8s
   must not do. */
feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ batch: 1, createdAt: -1 });
feedbackSchema.index({ class: 1, createdAt: -1 });
feedbackSchema.index({ mainTrainers: 1, createdAt: -1 });
feedbackSchema.index({ supportTrainers: 1, createdAt: -1 });
// The batch drill-down always narrows to a class within the batch.
feedbackSchema.index({ batch: 1, class: 1 });
// Comment/theme search runs as a regex on comment inside a scoped match;
// a text index lets the common "scope + keyword" pair stay indexed.
feedbackSchema.index({ comment: 'text' });

export const Feedback = mongoose.model('Feedback', feedbackSchema);
