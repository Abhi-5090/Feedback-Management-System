import { Class } from '../models/Class.js';
import { User } from '../models/User.js';
import { Batch } from '../models/Batch.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { badRequest, notFound } from '../utils/ApiError.js';

async function assertTrainerExists(trainerId) {
  const trainer = await User.findOne({ _id: trainerId, role: 'trainer', isActive: true });
  if (!trainer) throw badRequest('Assigned trainer not found or inactive', 'BAD_TRAINER');
  return trainer;
}

// POST /api/classes  (admin)
export const createClass = asyncHandler(async (req, res) => {
  const { name, description, trainer } = req.body;
  await assertTrainerExists(trainer);
  const klass = await Class.create({ name, description, trainer });
  res.status(201).json({ class: await klass.populate('trainer', 'name email') });
});

// GET /api/classes  (admin) — with trainer + batch count
export const listClasses = asyncHandler(async (_req, res) => {
  const classes = await Class.find({ archivedAt: null }).populate('trainer', 'name email').sort({ createdAt: -1 }).lean();
  // A class can now belong to many batches — unwind the batch's classes array
  // and count how many batches each class appears in.
  const counts = await Batch.aggregate([
    { $match: { archivedAt: null } },
    { $unwind: '$classes' },
    { $group: { _id: '$classes.class', batches: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.batches]));
  res.json({
    classes: classes.map((c) => ({ ...c, batchCount: byId.get(String(c._id)) || 0 })),
  });
});

// PATCH /api/classes/:id  (admin)
export const updateClass = asyncHandler(async (req, res) => {
  const { name, description, trainer, isActive } = req.body;
  const klass = await Class.findById(req.params.id);
  if (!klass) throw notFound('Class not found');

  if (trainer) {
    await assertTrainerExists(trainer);
    klass.trainer = trainer;
  }
  if (name !== undefined) klass.name = name;
  if (description !== undefined) klass.description = description;
  if (typeof isActive === 'boolean') klass.isActive = isActive;

  await klass.save();
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
