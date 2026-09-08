import mongoose from 'mongoose';

/**
 * Class — a named training subject ("C Programming", "GenAI", "Coding").
 *
 * A subject is a CATALOG entry. Who teaches it is decided per batch, because
 * the same subject is staffed by different mentor teams for different cohorts
 * (C Programming runs with Abraham for one first-year batch and Naveen for
 * another). `trainer` is therefore an OPTIONAL convenience default used to
 * pre-fill the main-mentor roster when a batch entry is created — never the
 * source of truth for who owns the feedback. That lives on the Batch and is
 * denormalised onto each Feedback row.
 */
const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    // Optional default main mentor. Null is normal and expected.
    trainer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    isActive: { type: Boolean, default: true },
    // Soft delete. Archiving hides a record from every normal list without
    // destroying the feedback attached to it — deleting a class would orphan
    // months of responses, which is never what an admin actually wants.
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

classSchema.index({ archivedAt: 1, createdAt: -1 });
// Subject names are the natural key an admin searches and must not collide
// among live records. Partial so archived duplicates don't block a re-create.
classSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } }
);

export const Class = mongoose.model('Class', classSchema);
