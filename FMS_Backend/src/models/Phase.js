import mongoose from 'mongoose';

/**
 * Phase — one collection exercise, named by the admin.
 *
 * WHAT PROBLEM THIS SOLVES. `Batch.round` already existed, but it is PER
 * BATCH: in the September data round 1 ran 11–30 Sep while round 2 ran 9–24
 * Sep, so one batch's round 2 and another's round 1 were the same exercise.
 * Nothing in the system could answer "show me Phase 1".
 *
 * WHY A DATE RANGE AND NOT A MONTH. The obvious model is "a phase is a
 * calendar month", and it is wrong for a reason the real data shows. Each
 * batch collects in a single sitting, but the fourteen batches come up on
 * different days as the timetable allows, so the whole exercise spanned 21
 * days — 9 to 30 September, finishing on the last day of the month with one
 * day to spare. Start a week later and the tail falls into November, and the
 * exercise silently splits across two phases with neither number being true.
 *
 * So a phase owns an explicit [startsAt, endsAt] window. The UI still offers a
 * calendar and still defaults to a whole month, because that is how the
 * institution thinks; the range is what makes the straddling case survivable.
 *
 * NO TWO PHASES MAY OVERLAP. Enforced in the service, not merely hoped for.
 * It is what makes "which phase does this response belong to?" have exactly
 * one answer for every instant, which in turn is what lets the answer be
 * computed rather than chosen.
 */
const phaseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    /* A short label for exports, chips and column headers, where
       "Phase 2 — November 2026" will not fit. */
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },

    /* The window. Inclusive of startsAt, EXCLUSIVE of endsAt — stored as the
       instant the phase stops accepting, so a phase covering October holds
       01 Oct 00:00 to 01 Nov 00:00. Half-open ranges cannot overlap by one
       millisecond at the boundary the way inclusive ones can, which is the
       classic off-by-one in any date-range feature. */
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },

    /**
     * draft  — created, not yet collecting. Editable.
     * open   — the live phase. Submissions land here. Still editable.
     * closed — frozen. Membership can never change again, because reports
     *          built on it have already been circulated.
     */
    status: {
      type: String,
      enum: ['draft', 'open', 'closed'],
      default: 'draft',
      index: true,
    },

    notes: { type: String, default: '', trim: true, maxlength: 2000 },

    closedAt: { type: Date, default: null },
    /* Who closed it. Closing freezes numbers an institution acts on, so it is
       an accountable action rather than a state change. */
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/* Resolution is "which phase contains this instant", so the range is the key.
   Sorted descending by start, because the newest phase is the one almost every
   lookup wants and it is then the first document examined. */
phaseSchema.index({ startsAt: -1, endsAt: -1 });
phaseSchema.index({ code: 1 }, { unique: true });

/** A phase is collecting if it is open and now falls inside its window. */
phaseSchema.methods.isCollecting = function isCollecting(at = new Date()) {
  return this.status === 'open' && at >= this.startsAt && at < this.endsAt;
};

/** Past its end date but not yet closed — what the dashboard nudges about. */
phaseSchema.methods.isOverdue = function isOverdue(at = new Date()) {
  return this.status === 'open' && at >= this.endsAt;
};

export const Phase = mongoose.model('Phase', phaseSchema);
