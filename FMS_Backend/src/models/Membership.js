import mongoose from 'mongoose';
import { tenantPlugin } from '../tenancy/tenantPlugin.js';

/**
 * One person's place in one organization.
 *
 * WHY THIS IS A ROW AND NOT A FIELD ON USER. A mentor can teach at two
 * institutions — the same person, the same login, two unrelated sets of
 * cohorts — and a single `organization` on the user makes that impossible to
 * express. An array of ids would nearly work, but it cannot carry a ROLE per
 * organization: somebody can run one institution and merely teach at another,
 * and flattening that to one global role gets it wrong in both places.
 *
 * It also makes removal honest. Taking someone off an institution is deleting
 * a row with an audit trail, rather than splicing an array and hoping the
 * before-and-after was captured somewhere.
 *
 * USER IS NOW A GLOBAL IDENTITY. It carries who someone is — name, email,
 * password, second factor — and nothing about where they work. Membership
 * carries where they work, and is tenant-scoped like everything else, so an
 * organization can only ever see its own.
 */
const membershipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /* The role IN THIS ORGANIZATION. Never read from the user — a person who
       administers one institution has no standing in another unless a row
       here says so. */
    role: {
      type: String,
      enum: ['admin', 'trainer'],
      required: true,
    },

    /* Suspending one membership must not touch the person's access elsewhere,
       which is the whole reason this lives here rather than on the user. */
    isActive: { type: Boolean, default: true },

    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

membershipSchema.plugin(tenantPlugin);

/* One row per person per organization. The unique index is what makes "add
   them again" idempotent instead of quietly creating a duplicate that then
   makes every count wrong. */
membershipSchema.index({ organization: 1, user: 1 }, { unique: true });
membershipSchema.index({ organization: 1, role: 1, isActive: 1 });

export const Membership =
  mongoose.models.Membership || mongoose.model('Membership', membershipSchema);
