import mongoose from 'mongoose';

/**
 * An organization — the tenant boundary.
 *
 * Every other collection in this product belongs to exactly one organization,
 * and nothing is readable across that line. The institution that was here
 * first (NCET) becomes one row in this table rather than a special case, so
 * there is no "default tenant" code path that behaves differently from the
 * rest and therefore never gets exercised.
 *
 * A super admin belongs to NO organization. That is deliberate: membership is
 * what grants access, so an account with no membership has no tenant data by
 * default and must name the organization it wants to act on, explicitly, on
 * every request.
 */
const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    /* A stable, human-readable handle. Used in URLs and in the super admin's
       organization picker, so it must not change when someone edits the
       display name. */
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Slug must be 3–40 lowercase letters, digits or hyphens'],
    },

    /* Suspension is not deletion. An institution that stops paying, or is
       being investigated, must become unreachable WITHOUT its feedback being
       destroyed — the data is still theirs and may be needed. Login is
       refused while suspended; the rows stay. */
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },

    // Free text for whoever administers the platform. Never shown to members.
    notes: { type: String, maxlength: 2000, default: '' },

    /**
     * Settings that belong to the institution rather than the platform.
     *
     * TIMEZONE IS THE ONE THAT CHANGES WHAT PEOPLE READ. Feedback is stamped
     * in UTC, which is correct for storage and wrong for every sentence a
     * human reads: a session collected at 9pm in Hyderabad is "the 30th"
     * there and "the 29th" in UTC, so a phase boundary, a collection date and
     * a daily trend can all be off by one. Rendering in the institution's own
     * zone is the difference between a report being right and being nearly
     * right.
     */
    settings: {
      timezone: { type: String, default: 'Asia/Kolkata', maxlength: 64 },
      /* Shown on exports and the sign-in screen. A tenant that sees its own
         name is a tenant that believes the system is theirs. */
      displayName: { type: String, default: '', maxlength: 120 },
      /* Where a report's week starts. Changing it silently reshapes every
         weekly figure, so it is a setting rather than an assumption. */
      weekStartsOn: { type: String, enum: ['monday', 'sunday'], default: 'monday' },

      /* The NAME mail appears to come from. Only the display name — the
         address stays the platform's, because sending as someone else's
         domain without their DNS records is how mail gets marked as spam for
         everybody on the shared sender. A mentor who sees their own
         institution's name opens the mail; one who sees a product they have
         never heard of does not. */
      emailFromName: { type: String, default: '', maxlength: 120 },
    },

    /**
     * Ceilings on what this tenant may create.
     *
     * Not billing — a bound on blast radius. One organization importing a
     * malformed spreadsheet of fifty thousand mentors degrades the database
     * for every other organization on the same cluster, and the people who
     * suffer are not the ones who made the mistake. A limit turns that into
     * an error message for the person who can actually fix it.
     *
     * 0 means unlimited, so an institution can be let off the leash
     * deliberately rather than by editing code.
     */
    limits: {
      maxUsers: { type: Number, default: 500, min: 0 },
      maxClasses: { type: Number, default: 200, min: 0 },
      maxBatches: { type: Number, default: 500, min: 0 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

organizationSchema.index({ archivedAt: 1, name: 1 });

organizationSchema.methods.isUsable = function isUsable() {
  return this.status === 'active' && !this.archivedAt;
};

export const Organization =
  mongoose.models.Organization || mongoose.model('Organization', organizationSchema);
