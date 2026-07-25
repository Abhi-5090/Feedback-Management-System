import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { generateBatchPasscode } from '../utils/passcode.js';
import { hashPasscode } from '../utils/password.js';
import { recordAudit } from '../services/auditService.js';

/**
 * Normalise a batch's class entries to a flat, populated-or-not-safe shape:
 *   { _id: classId, name, trainer: { _id, name }, trainerName }
 * Works whether `classes` came back populated (objects) or raw (ids), so every
 * endpoint returns the same shape and the client never has to branch.
 */
function shapeClasses(classes) {
  return (classes || []).map((e) => {
    const c = e.class;
    const t = e.trainer;
    const classObj = c && c._id ? c : null;
    const trainerObj = t && t._id ? t : null;
    return {
      _id: classObj ? classObj._id : c, // classId either way
      name: classObj ? classObj.name : undefined,
      trainer: trainerObj ? { _id: trainerObj._id, name: trainerObj.name } : t ? { _id: t } : null,
      trainerName: trainerObj ? trainerObj.name : undefined,
    };
  });
}

// Shape a batch for the client WITHOUT ever leaking the passcode hash.
function publicBatch(b) {
  const obj = b.toObject ? b.toObject() : b;
  return {
    _id: obj._id,
    classes: shapeClasses(obj.classes),
    classCount: Array.isArray(obj.classes) ? obj.classes.length : 0,
    name: obj.name,
    status: obj.status,
    expectedCount: obj.expectedCount,
    submittedCount: obj.submittedCount,
    hasPasscode: Boolean(obj.passcodeHash),
    openedAt: obj.openedAt,
    closedAt: obj.closedAt,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const populateClasses = [
  { path: 'classes.class', select: 'name' },
  { path: 'classes.trainer', select: 'name' },
];

/**
 * Validate and normalise a batch's class list. Each entry names a class and,
 * optionally, the trainer teaching it in this batch. Rules:
 *   - every class must exist and be non-archived,
 *   - no class may appear twice in one batch,
 *   - the trainer (override if given, else the class's catalog trainer) must be
 *     an active trainer.
 * Returns [{ class, trainer }] with a concrete trainer on every entry.
 */
async function resolveClasses(entries) {
  const list = (entries || []).map((e) => ({
    class: String(e.class),
    trainer: e.trainer ? String(e.trainer) : null,
  }));
  if (list.length === 0) throw badRequest('Select at least one class', 'NO_CLASSES');

  const classIds = list.map((e) => e.class);
  if (new Set(classIds).size !== classIds.length) {
    throw badRequest('A class can only be added to a batch once', 'DUPLICATE_CLASS');
  }

  const classes = await Class.find({ _id: { $in: classIds }, archivedAt: null })
    .select('trainer')
    .lean();
  if (classes.length !== classIds.length) {
    throw badRequest('One or more selected classes were not found', 'BAD_CLASS');
  }
  const defaultTrainerByClass = new Map(classes.map((c) => [String(c._id), String(c.trainer)]));

  // Resolve each entry's effective trainer (override ?? class default).
  const resolved = list.map((e) => ({
    class: e.class,
    trainer: e.trainer || defaultTrainerByClass.get(e.class),
  }));

  // Every effective trainer must be a real, active trainer.
  const trainerIds = [...new Set(resolved.map((e) => e.trainer))];
  const validTrainers = await User.countDocuments({
    _id: { $in: trainerIds },
    role: 'trainer',
    isActive: true,
  });
  if (validTrainers !== trainerIds.length) {
    throw badRequest('One or more selected trainers were not found or are inactive', 'BAD_TRAINER');
  }

  return resolved;
}

// POST /api/batches  (admin)
export const createBatch = asyncHandler(async (req, res) => {
  const { classes, name, expectedCount } = req.body;
  const classEntries = await resolveClasses(classes);

  const created = await Batch.create({ classes: classEntries, name, expectedCount: expectedCount || 0 });
  const batch = await Batch.findById(created._id).populate(populateClasses);

  recordAudit(req, {
    action: 'batch.create',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
    meta: { classCount: classEntries.length },
  });

  res.status(201).json({ batch: publicBatch(batch) });
});

/**
 * PATCH /api/batches/:id  (admin) — rename and/or change the class set.
 *
 * Changing the classes of an OPEN batch mid-collection would make already-
 * submitted feedback reference classes no longer "in" the batch, so it is only
 * allowed while the batch is locked.
 */
export const updateBatch = asyncHandler(async (req, res) => {
  const { name, classes } = req.body;
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw notFound('Batch not found');

  if (classes !== undefined) {
    if (batch.status === 'open') {
      throw badRequest('Lock the batch before changing its classes', 'BATCH_OPEN');
    }
    batch.classes = await resolveClasses(classes); // [{ class, trainer }]
  }
  if (name !== undefined) batch.name = name;
  await batch.save();

  const populated = await Batch.findById(batch._id).populate(populateClasses);

  recordAudit(req, {
    action: 'batch.update',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
  });

  res.json({ batch: publicBatch(populated) });
});

// GET /api/batches  (admin) — optional ?class=<id> and ?status=open|locked
export const listBatches = asyncHandler(async (req, res) => {
  const filter = { archivedAt: null };
  // A batch matches ?class=<id> when that class is among its classes.
  if (req.query.class) filter['classes.class'] = req.query.class;
  if (req.query.status) filter.status = req.query.status;
  const batches = await Batch.find(filter).populate(populateClasses).sort({ createdAt: -1 });
  res.json({ batches: batches.map(publicBatch) });
});

/**
 * POST /api/batches/:id/unlock   (admin)
 * Body: { expectedCount }
 *
 * Generates a FRESH passcode (rotating any previous one), stores only its
 * bcrypt hash, opens the window, resets the live counter, and returns the
 * plaintext passcode EXACTLY ONCE. There is no endpoint that can return this
 * plaintext again — the admin must copy it now or re-unlock to rotate.
 */
export const unlockBatch = asyncHandler(async (req, res) => {
  const { expectedCount } = req.body;
  const batch = await Batch.findById(req.params.id).populate(populateClasses);
  if (!batch) throw notFound('Batch not found');

  const passcode = generateBatchPasscode(batch.name);
  batch.passcodeHash = await hashPasscode(passcode);
  batch.status = 'open';
  batch.expectedCount = expectedCount;
  batch.submittedCount = 0; // fresh window → fresh count
  batch.openedAt = new Date();
  batch.closedAt = null;
  await batch.save();

  recordAudit(req, {
    action: 'batch.unlock',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
    meta: { expectedCount },
  });

  res.json({
    batch: publicBatch(batch),
    // Shown once. Not persisted in plaintext anywhere.
    passcode,
    notice: 'Copy this passcode now — it will not be shown again. Re-unlock to rotate.',
  });
});

/**
 * POST /api/batches/:id/lock  (admin)
 * Closes the window and nulls the passcode so no further submissions are
 * possible and the old code can never be reused.
 */
export const lockBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw notFound('Batch not found');

  batch.status = 'locked';
  batch.passcodeHash = null;
  batch.closedAt = new Date();
  await batch.save();

  recordAudit(req, {
    action: 'batch.lock',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
    meta: { submittedCount: batch.submittedCount },
  });

  await batch.populate(populateClasses);
  res.json({ batch: publicBatch(batch) });
});

// POST /api/batches/:id/passcode  (admin)
// Passcodes are stored hashed and shown only once at unlock. To hand out a new
// code, this ROTATES: it regenerates, re-hashes, and returns the new plaintext.
// It is a POST because it mutates state (a GET must be safe/idempotent).
export const rotatePasscode = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw notFound('Batch not found');
  if (batch.status !== 'open') throw badRequest('Unlock the batch before rotating its passcode');

  const passcode = generateBatchPasscode(batch.name);
  batch.passcodeHash = await hashPasscode(passcode);
  await batch.save();

  recordAudit(req, {
    action: 'batch.rotate_passcode',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
  });

  await batch.populate(populateClasses);
  res.json({ batch: publicBatch(batch), passcode, rotated: true });
});


/**
 * PATCH /api/batches/:id/archive   (admin)   { archived: true|false }
 *
 * Soft delete for a cohort. A batch is archived, never removed: its feedback is
 * the historical record the dashboards are built from.
 */
export const archiveBatch = asyncHandler(async (req, res) => {
  const archived = req.body?.archived !== false;
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw notFound('Batch not found');

  // Archiving an open batch would leave a live passcode pointing at a hidden
  // cohort — close the window as part of the same action.
  if (archived && batch.status === 'open') {
    batch.status = 'locked';
    batch.passcodeHash = null;
    batch.closedAt = new Date();
  }
  batch.archivedAt = archived ? new Date() : null;
  await batch.save();

  recordAudit(req, {
    action: archived ? 'batch.archive' : 'batch.restore',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
  });

  await batch.populate(populateClasses);
  res.json({ batch: publicBatch(batch) });
});
