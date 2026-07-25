import mongoose from 'mongoose';

/**
 * An immutable record of a consequential action.
 *
 * Institutions ask "who unlocked that batch?" and "who exported our data?" —
 * questions the app previously could not answer at all. Entries are written
 * once and never updated, and the actor's name/role/email are DENORMALISED at
 * write time on purpose: an audit trail that says "user 64f2…" is useless after
 * that account is renamed or deactivated, and a trail that changes retroactively
 * when a name changes isn't an audit trail.
 *
 * Reads are always "most recent first, optionally filtered", hence the
 * compound indexes on createdAt with action/entity/actor.
 */
const auditSchema = new mongoose.Schema(
  {
    // Who — snapshotted, not joined.
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'System' },
    actorEmail: { type: String, default: '' },
    actorRole: { type: String, default: 'system' },

    // What — a stable dot-notation verb, e.g. 'batch.unlock', 'export.download'.
    action: { type: String, required: true, index: true },
    entity: { type: String, default: '' },       // 'batch' | 'class' | 'trainer' | …
    entityId: { type: String, default: '' },
    entityName: { type: String, default: '' },   // human label at the time

    // Small, non-sensitive extras (counts, formats, statuses).
    // NEVER passwords, passcodes, tokens or feedback content.
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ actor: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
