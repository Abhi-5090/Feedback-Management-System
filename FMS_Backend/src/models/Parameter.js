import mongoose from 'mongoose';

/**
 * Parameter — one admin-configurable rating dimension (rated 1–5 stars).
 * The 8 defaults are seeded; the admin can rename / reorder / add / deactivate.
 * We soft-delete (isActive:false) rather than hard-delete so historical
 * feedback that references a parameter still resolves its label.
 */
const parameterSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    order: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Parameter = mongoose.model('Parameter', parameterSchema);