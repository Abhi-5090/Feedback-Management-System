import { Class } from '../models/Class.js';
import { Feedback } from '../models/Feedback.js';
import { User } from '../models/User.js';
import { Batch } from '../models/Batch.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { escapeRegex } from '../services/analyticsService.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { assertWithinQuota } from '../services/quotaService.js';

/**
 * A subject's optional default mentor. Optional because staffing is a per-batch
 * decision — "C Programming" is delivered by Abraham for one first-year batch
 * and Naveen for another, so the catalog cannot name one true owner. This is
 * only a convenience pre-fill for the batch editor.
 */
async function assertTrainerExists(trainerId) {
  if (!trainerId) return null;
  const trainer = await User.findOne({ _id: trainerId, role: 'trainer', isActive: true });
  if (!trainer) throw badRequest('Default mentor not found or inactive', 'BAD_TRAINER');
  return trainer;
}

// POST /api/classes  (admin)
export const createClass = asyncHandler(async (req, res) => {
  await assertWithinQuota(req.organization?._id, 'maxClasses');

  const { name, description, trainer } = req.body;
  await assertTrainerExists(trainer);

  const clash = await Class.findOne({ name: name.trim(), archivedAt: null }).lean();
  if (clash) throw conflict(`A subject called "${name}" already exists`, 'CLASS_EXISTS');

  const klass = await Class.create({ name, description, trainer: trainer || null });

  recordAudit(req, {
    action: 'class.create',
    entity: 'class',
    entityId: klass._id,
    entityName: klass.name,
  });

  res.status(201).json({ class: await klass.populate('trainer', 'name email') });
});

/**
 * GET /api/classes  (admin)
 * Query: page, limit, q, archived=live|archived|all
 *
 * Paginated server-side for the same reason as batches: the list only grows,
 * and filtering in the browser stops working the moment it matters.
 */
export const listClasses = asyncHandler(async (req, res) => {
  const { page, limit, q, archived } = req.query;

  const filter = {};
  if (archived === 'live') filter.archivedAt = null;
  else if (archived === 'archived') filter.archivedAt = { $ne: null };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { description: rx }];
  }

  const [classes, total] = await Promise.all([
    Class.find(filter)
      .populate('trainer', 'name email')
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Class.countDocuments(filter),
  ]);

  const ids = classes.map((c) => c._id);

  // A class belongs to many batches, each staffing it with a mentor team.
  // Unwind so each subject reports how many batches use it AND who currently
  // teaches it — the two things the list is actually read for.
  const staffing = ids.length
    ? await Batch.aggregate([
        { $match: { archivedAt: null, 'classes.class': { $in: ids } } },
        { $unwind: '$classes' },
        { $match: { 'classes.class': { $in: ids } } },
        {
          $group: {
            _id: '$classes.class',
            batches: { $sum: 1 },
            open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
            mains: { $addToSet: '$classes.mainTrainers' },
            supports: { $addToSet: '$classes.supportTrainers' },
          },
        },
      ])
    : [];

  // Resolve every referenced mentor name in one query rather than per class.
  const mentorIds = [
    ...new Set(
      staffing.flatMap((s) => [...s.mains.flat(), ...s.supports.flat()]).map(String)
    ),
  ];
  const mentors = mentorIds.length
    ? await User.find({ _id: { $in: mentorIds } }).select('name').lean()
    : [];
  const nameById = new Map(mentors.map((m) => [String(m._id), m.name]));

  const byId = new Map(
    staffing.map((s) => [
      String(s._id),
      {
        batches: s.batches,
        open: s.open,
        mainMentors: [...new Set(s.mains.flat().map(String))]
          .map((id) => nameById.get(id))
          .filter(Boolean),
        supportMentors: [...new Set(s.supports.flat().map(String))]
          .map((id) => nameById.get(id))
          .filter(Boolean),
      },
    ])
  );

  res.json({
    classes: classes.map((c) => {
      const s = byId.get(String(c._id)) || {
        batches: 0,
        open: 0,
        mainMentors: [],
        supportMentors: [],
      };
      return {
        ...c,
        batchCount: s.batches,
        openBatchCount: s.open,
        mainMentors: s.mainMentors,
        supportMentors: s.supportMentors,
      };
    }),
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

// PATCH /api/classes/:id  (admin)
export const updateClass = asyncHandler(async (req, res) => {
  const { name, description, trainer, isActive } = req.body;
  const klass = await Class.findById(req.params.id);
  if (!klass) throw notFound('Class not found');

  // `null` explicitly clears the default mentor; `undefined` leaves it alone.
  if (trainer !== undefined) {
    await assertTrainerExists(trainer);
    klass.trainer = trainer || null;
  }
  if (name !== undefined && name.trim() !== klass.name) {
    const clash = await Class.findOne({
      name: name.trim(),
      archivedAt: null,
      _id: { $ne: klass._id },
    }).lean();
    if (clash) throw conflict(`A subject called "${name}" already exists`, 'CLASS_EXISTS');
    klass.name = name;
  }
  if (description !== undefined) klass.description = description;
  if (typeof isActive === 'boolean') klass.isActive = isActive;

  await klass.save();

  recordAudit(req, {
    action: 'class.update',
    entity: 'class',
    entityId: klass._id,
    entityName: klass.name,
  });

  res.json({ class: await klass.populate('trainer', 'name email') });
});

/**
 * PATCH /api/classes/:id/archive   (admin)   { archived: true|false }
 *
 * Soft delete. The class disappears from every list and picker, but its batches
 * and the feedback beneath them are untouched — a hard delete would destroy
 * historical responses that the analytics and exports still legitimately need.
 */
export const archiveClass = asyncHandler(async (req, res) => {
  const archived = req.body?.archived !== false;
  const klass = await Class.findById(req.params.id);
  if (!klass) throw notFound('Class not found');

  // Archiving a subject that an OPEN batch is still collecting on would leave
  // students rating a class the admin believes is gone. Name the batches so the
  // message is actionable rather than a bare refusal.
  if (archived) {
    const openUses = await Batch.find({
      'classes.class': klass._id,
      status: 'open',
      archivedAt: null,
    })
      .select('name')
      .lean();
    if (openUses.length) {
      throw badRequest(
        `Lock these open batches first: ${openUses.map((b) => b.name).join(', ')}`,
        'CLASS_IN_OPEN_BATCH'
      );
    }
  }

  klass.archivedAt = archived ? new Date() : null;
  await klass.save();

  recordAudit(req, {
    action: archived ? 'class.archive' : 'class.restore',
    entity: 'class',
    entityId: klass._id,
    entityName: klass.name,
  });

  res.json({ class: klass });
});

/**
 * DELETE /api/v1/classes/:id
 *
 * Permanent removal, and only when nothing depends on it.
 *
 * ARCHIVING IS THE USUAL ANSWER and stays the default: a subject that has
 * been taught has feedback attached, and deleting it would orphan responses
 * students gave in good faith. This exists for the other case — a subject
 * created by mistake, with nothing behind it — where archiving leaves a
 * permanent monument to a typo.
 *
 * So the refusal names what is in the way rather than saying no: an admin who
 * is told "3 cohorts use this" knows exactly what to do next.
 */
export const deleteClass = asyncHandler(async (req, res) => {
  const klass = await Class.findById(req.params.id);
  if (!klass) throw notFound('Subject not found');

  const [batches, responses] = await Promise.all([
    Batch.countDocuments({ 'classes.class': klass._id }),
    Feedback.countDocuments({ class: klass._id }),
  ]);

  if (batches > 0 || responses > 0) {
    throw badRequest(
      `"${klass.name}" is used by ${batches} cohort${batches === 1 ? '' : 's'} and holds ` +
        `${responses} response${responses === 1 ? '' : 's'}. Archive it instead — deleting it ` +
        'would discard feedback students have already given.',
      'IN_USE'
    );
  }

  await Class.deleteOne({ _id: klass._id });
  recordAudit(req, {
    action: 'class.delete',
    entity: 'class',
    entityId: klass._id,
    entityName: klass.name,
  });
  res.json({ deleted: true });
});
