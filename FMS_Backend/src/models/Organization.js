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
