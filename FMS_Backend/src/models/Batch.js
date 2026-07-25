import mongoose from 'mongoose';

/**
 * Batch — a cohort of students in a time window, holding MANY classes, each
 * taught by a specific trainer FOR THIS BATCH.
 *
 * `classes` is a list of { class, trainer } pairs. The trainer is stored
 * concretely per batch, defaulting to the class's catalog trainer but
 * overridable — the same subject (catalog Class) can be taught by a different
 * trainer in a different batch. Feedback ownership follows THIS trainer (the
 * "effective" trainer), denormalised onto each Feedback row, so trainer
 * isolation is by who actually taught, not by who owns the catalog class.
 *
 * A student who enters the batch's passcode rates every class in `classes`
 * across all parameters, so one submission produces one Feedback document per
 * class. The passcode, open/closed window and cap live HERE; the cap and the
 * live counter count STUDENTS (one increment per submission), never per-class.
 *
 * Lifecycle:
 *   locked  → no passcode, window closed, cannot submit.
 *   open    → passcodeHash set, window open, students may submit until the cap.
 * Unlocking (re)generates the passcode; locking nulls it and closes the window.
 */
const batchClassSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    // The trainer teaching this class IN THIS BATCH (the effective trainer).
    // Concrete, not derived — defaults to the class's catalog trainer at
    // create time but can be overridden per batch.
    trainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false }
);

const batchSchema = new mongoose.Schema(
  {
    classes: {
      type: [batchClassSchema],
      required: true,
      validate: [(v) => Array.isArray(v) && v.length > 0, 'A batch must contain at least one class'],
    },
    name: { type: String, required: true, trim: true }, // e.g. "FSD-Aug-2025"

    // bcrypt hash of the current passcode; null while locked. Plaintext is NEVER
    // persisted — it is returned to the admin exactly once at unlock time.
    passcodeHash: { type: String, default: null },

    status: { type: String, enum: ['locked', 'open'], default: 'locked', index: true },

    expectedCount: { type: Number, default: 0, min: 0 }, // cohort size / cap (students)
    submittedCount: { type: Number, default: 0, min: 0 }, // denormalised live counter (students)

    openedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    // Soft delete. Archiving hides a record from every normal list without
    // destroying the feedback attached to it.
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// "Which batches include this class?" and "which batches does this trainer
// teach in?" drive the class cards and the trainer views respectively.
batchSchema.index({ 'classes.class': 1, status: 1 });
batchSchema.index({ 'classes.trainer': 1, status: 1 });

// Convenience virtual: is the cap reached?
batchSchema.virtual('isFull').get(function isFull() {
  return this.expectedCount > 0 && this.submittedCount >= this.expectedCount;
});

export const Batch = mongoose.model('Batch', batchSchema);
