import { AuditLog } from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * GET /api/audit  (admin)
 * Query: page, limit, action, entity, actor, q, from, to
 *
 * Server-side paginated because this collection only grows. Filters are applied
 * in the database rather than the client for the same reason — an institution
 * six months in will have tens of thousands of entries, and shipping them all
 * to the browser to filter would not survive a demo, let alone production.
 */
export const listAudit = asyncHandler(async (req, res) => {
  /* Query is validated by auditQuerySchema on the route, so these arrive as
     coerced numbers and pattern-checked strings. They are still assigned as
     scalars only — a value that reached a Mongo filter as an OBJECT would turn
     an equality match into an operator (`?action[$ne]=x`), which is why the
     schema constrains the shape rather than merely the length. */
  const { page, limit } = req.query;

  const filter = {};
  if (req.query.action) filter.action = String(req.query.action);
  if (req.query.entity) filter.entity = String(req.query.entity);
  if (req.query.actor) filter.actor = String(req.query.actor);

  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  // Free-text across the denormalised actor/entity labels.
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ actorName: rx }, { actorEmail: rx }, { entityName: rx }, { action: rx }];
  }

  const [entries, total, actions, actors] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
    // Distinct values power the filter dropdowns without a second round trip.
    AuditLog.distinct('action'),
    AuditLog.aggregate([
      { $group: { _id: '$actor', name: { $first: '$actorName' }, role: { $first: '$actorRole' } } },
      { $sort: { name: 1 } },
      { $limit: 100 },
    ]),
  ]);

  res.json({
    entries,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    filters: {
      actions: actions.sort(),
      actors: actors.filter((a) => a._id).map((a) => ({ id: String(a._id), name: a.name, role: a.role })),
    },
  });
});
