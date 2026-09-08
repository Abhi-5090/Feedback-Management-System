import mongoose from 'mongoose';

/**
 * Batch — a cohort of students in a time window, holding MANY classes, each
 * staffed by a team of mentors FOR THIS BATCH.
 *
 * MENTOR MODEL (mirrors the Torii training board):
 *   Every { class } entry carries TWO rosters:
 *     - mainTrainers    — deliver the class. At least one, often several
 *                         ("Coding" runs with Suneeta AND Abhishek).
 *     - supportTrainers — assist the session. Zero or more.
 *   Both are stored concretely PER BATCH rather than derived from the class,
 *   because the same subject is staffed differently for different cohorts.
 *   A person may not appear in both rosters for the same class.
 *
 * Feedback ownership follows these two rosters (denormalised onto each
 * Feedback row), so isolation is by who actually taught — and a mentor's
 * analytics can be split by the role they held.
 *
 * A student who enters the batch's passcode rates every class in `classes`
 * across all parameters, so one submission produces one Feedback document per
 * class. The passcode, open/closed window and cap live HERE; the cap and the
 * live counter count STUDENTS (one increment per submission), never per-class.
 *
 * Lifecycle:
 *   locked  → no passcode, window closed, cannot submit.
 *   open    → passcodeHash set, window open, students may submit until the cap.
 * Unlocking (re)generates the passcode, resets the counter and BUMPS `round`.
 * `round` is mixed into the device signature, so a second collection round on
 * the same batch starts from a clean namespace instead of being blocked by the
 * first round's locks — while the old locks remain as a record of round 1.
 */
const batchClassSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },

    // Mentors who DELIVER this class in this batch. At least one.
    mainTrainers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: [
        (v) => Array.isArray(v) && v.length > 0,
        'Each class needs at least one main mentor',
      ],
    },

    // Mentors who ASSIST this class in this batch. May be empty.
    supportTrainers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
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
    name: { type: String, required: true, trim: true }, // e.g. "C · Batch-1"

    // Where this cohort sits in the institution. Free text rather than an enum:
    // year-group naming is an institutional convention ("Final Year", "III
    // Year", "2028 Batch") and an enum would need a migration every time it
    // changes. Indexed because both are first-class dashboard filters.
    yearGroup: { type: String, default: '', trim: true, index: true }, // "Final Year"
    dept: { type: String, default: '', trim: true },                   // "CSE - A, B"

    // bcrypt hash of the current passcode; null while locked. Plaintext is NEVER
    // persisted — it is returned to the admin exactly once at unlock time.
    passcodeHash: { type: String, default: null },

    status: { type: String, enum: ['locked', 'open'], default: 'locked', index: true },

    expectedCount: { type: Number, default: 0, min: 0 }, // cohort size / cap (students)
    submittedCount: { type: Number, default: 0, min: 0 }, // denormalised live counter (students)

    // Monotonic round number, bumped on every unlock. Mixed into the device
    // signature so a second collection round on the same batch is not blocked
    // by the first round's locks.
    round: { type: Number, default: 0, min: 0 },

    openedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    // Soft delete. Archiving hides a record from every normal list without
    // destroying the feedback attached to it.
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// "Which batches include this class?" drives the class cards.
batchSchema.index({ 'classes.class': 1, status: 1 });
// "Which batches does this mentor work in?" — one index per role, because the
// trainer views ask the question both ways ("what do I deliver?" vs "what do I
// assist?") and a single index cannot serve a $or across two fields.
batchSchema.index({ 'classes.mainTrainers': 1, status: 1 });
batchSchema.index({ 'classes.supportTrainers': 1, status: 1 });
// Archived-batch filtering appears in nearly every list query.
batchSchema.index({ archivedAt: 1, createdAt: -1 });

// Convenience virtual: is the cap reached?
batchSchema.virtual('isFull').get(function isFull() {
  return this.expectedCount > 0 && this.submittedCount >= this.expectedCount;
});

/** Every mentor on this batch, either role, de-duplicated. */
batchSchema.methods.allTrainerIds = function allTrainerIds() {
  const out = new Map();
  for (const e of this.classes || []) {
    for (const t of [...(e.mainTrainers || []), ...(e.supportTrainers || [])]) {
      out.set(String(t?._id || t), t?._id || t);
    }
  }
  return [...out.values()];
};

export const Batch = mongoose.model('Batch', batchSchema);
