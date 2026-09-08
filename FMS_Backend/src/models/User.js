import mongoose from 'mongoose';

/**
 * User — admin + trainer share this collection, discriminated by `role`.
 * Students are anonymous and never appear here.
 */
const userSchema = new mongoose.Schema(
  {
    // Display name used everywhere in the product. The bulk importer accepts
    // separate first/last columns and joins them here, so the rest of the app
    // (dashboards, exports, comments) keeps working off one field.
    name: { type: String, required: true, trim: true },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Contact number. Kept as a string — numbers lose leading zeros and country
    // prefixes, and no arithmetic is ever done on it.
    phone: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'trainer'], required: true },
    isActive: { type: Boolean, default: true },
    // Set when the account was created by a bulk import with a shared default
    // password — useful for prompting a change on first login later.
    mustChangePassword: { type: Boolean, default: false },

    /**
     * Monotonic session generation, embedded in every JWT as `ver`.
     *
     * JWTs are stateless, so without this a stolen 7-day token stays valid for
     * 7 days even after the owner changes their password — which is precisely
     * the moment they are trying to revoke it. Bumping this invalidates every
     * token issued earlier, making "change my password" a real logout-everywhere.
     */
    tokenVersion: { type: Number, default: 0 },

    /**
     * The short name this person is known by on the training board ("Bhargav"
     * for "Bhargava R", "Peter" for "Jonathan Peters"). Stored so the schedule
     * importer can match a board entry to an account deterministically instead
     * of re-guessing a fuzzy string match on every run.
     */
    shortName: { type: String, trim: true, default: '', index: true },

    // Email digest preferences. `lastSentAt` is what makes the scheduler
    // idempotent — a restart or a second app instance can't double-send.
    digest: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' },
      lastSentAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Never leak the password hash when a user document is serialised to JSON.
userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

export const User = mongoose.model('User', userSchema);
