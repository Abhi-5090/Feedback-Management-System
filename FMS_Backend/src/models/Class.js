import mongoose from 'mongoose';

/**
 * Class — a named training subject, assigned by the admin to exactly one
 * trainer. A class has many batches (cohorts) over time.
 */
const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    trainer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

export const Class = mongoose.model('Class', classSchema);
