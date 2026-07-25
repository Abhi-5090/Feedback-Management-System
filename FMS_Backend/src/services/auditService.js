import { AuditLog } from '../models/AuditLog.js';

/**
 * Write an audit entry.
 *
 * NEVER throws and is never awaited on the request path. An audit write failing
 * must not fail the action it describes — refusing to unlock a batch because the
 * log was momentarily unavailable would be a worse outcome than a gap in the
 * trail. Failures are logged to stderr so they are still noticed.
 *
 * Call it AFTER the operation succeeds, so the log records what happened rather
 * than what was attempted.
 */
export function recordAudit(req, { action, entity, entityId, entityName, meta, actor }) {
  // `actor` is an explicit override for the routes where the acting user isn't
  // on req yet (login, password reset). Never spread req to fake it: `ip` is a
  // prototype getter, so {...req}.ip is undefined and the entry loses its IP.
  const u = actor || req?.user;
  AuditLog.create({
    actor: u?._id || null,
    actorName: u?.name || 'System',
    actorEmail: u?.email || '',
    actorRole: u?.role || 'system',
    action,
    entity: entity || '',
    entityId: entityId ? String(entityId) : '',
    entityName: entityName || '',
    meta: meta || {},
    ip: req?.ip || '',
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 200),
  }).catch((err) => {
    console.error('[audit] write failed:', action, err.message);
  });
}

/** Human-readable labels for the viewer. Unlisted actions fall back to the key. */
export const ACTION_LABELS = {
  'auth.login': 'Signed in',
  'auth.password_changed': 'Changed own password',
  'auth.password_reset': 'Reset password via email',
  'trainer.create': 'Created trainer',
  'trainer.update': 'Updated trainer',
  'trainer.bulk_import': 'Imported trainers',
  'class.create': 'Created class',
  'class.update': 'Updated class',
  'class.archive': 'Archived class',
  'class.restore': 'Restored class',
  'parameter.create': 'Added parameter',
  'parameter.update': 'Updated parameter',
  'parameter.delete': 'Removed parameter',
  'batch.create': 'Created batch',
  'batch.unlock': 'Unlocked batch',
  'batch.lock': 'Locked batch',
  'batch.rotate_passcode': 'Rotated passcode',
  'batch.archive': 'Archived batch',
  'batch.restore': 'Restored batch',
  'export.download': 'Exported data',
};
