import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { User } from '../models/User.js';
import { DeviceLock } from '../models/DeviceLock.js';
import { Feedback } from '../models/Feedback.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { generateBatchPasscode, PASSCODE_ENTROPY_BITS } from '../utils/passcode.js';
import { hashPasscode } from '../utils/password.js';
import { recordAudit } from '../services/auditService.js';
import { escapeRegex, shapeEntry } from '../services/analyticsService.js';

const populateClasses = [
  { path: 'classes.class', select: 'name' },
  { path: 'classes.mainTrainers', select: 'name shortName' },
  { path: 'classes.supportTrainers', select: 'name shortName' },
];

// Shape a batch for the client WITHOUT ever leaking the passcode hash.
function publicBatch(b, scopeTrainerId) {
  const obj = b.toObject ? b.toObject() : b;
  const classes = (obj.classes || []).map((e) => shapeEntry(e, scopeTrainerId));
  return {
    _id: obj._id,
    classes,
    classCount: classes.length,
    // Distinct mentor headcount across the batch, both roles — the number an
    // admin actually reads off a batch card.
    mentorCount: new Set(
      classes.flatMap((c) => [...c.mainTrainerIds, ...c.supportTrainerIds])
    ).size,
    name: obj.name,
    yearGroup: obj.yearGroup || '',
    dept: obj.dept || '',
    status: obj.status,
    round: obj.round || 0,
    expectedCount: obj.expectedCount,
    submittedCount: obj.submittedCount,
    hasPasscode: Boolean(obj.passcodeHash),
    openedAt: obj.openedAt,
    closedAt: obj.closedAt,
    archivedAt: obj.archivedAt || null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

/**
 * Validate and normalise a batch's class list. Each entry names a subject and
 * the mentor team staffing it in this batch. Rules:
 *   - every class must exist and be non-archived,
 *   - no class may appear twice in one batch,
 *   - every entry must end up with at least one MAIN mentor (falling back to
 *     the subject's catalog default when none is named),
 *   - every named mentor must be an active trainer,
 *   - nobody may hold both roles on the same class.
 * Returns [{ class, mainTrainers, supportTrainers }] with concrete rosters.
 */
async function resolveClasses(entries) {
  const list = entries || [];
  if (list.length === 0) throw badRequest('Select at least one class', 'NO_CLASSES');

  const classIds = list.map((e) => String(e.class));
  if (new Set(classIds).size !== classIds.length) {
    throw badRequest('A class can only be added to a batch once', 'DUPLICATE_CLASS');
  }

  const classes = await Class.find({ _id: { $in: classIds }, archivedAt: null })
    .select('trainer name')
    .lean();
  if (classes.length !== classIds.length) {
    throw badRequest('One or more selected classes were not found', 'BAD_CLASS');
  }
  const byId = new Map(classes.map((c) => [String(c._id), c]));

  // Resolve each entry's rosters, defaulting main to the subject's owner.
  const resolved = list.map((e) => {
    const cid = String(e.class);
    const subject = byId.get(cid);
    let main = [...new Set((e.mainTrainers || []).map(String))];
    const support = [...new Set((e.supportTrainers || []).map(String))];

    if (main.length === 0 && subject?.trainer) main = [String(subject.trainer)];
    if (main.length === 0) {
      throw badRequest(
        `"${subject?.name || 'This class'}" needs at least one main mentor`,
        'NO_MAIN_TRAINER'
      );
    }
    const clash = main.find((id) => support.includes(id));
    if (clash) {
      throw badRequest(
        `A mentor cannot be both main and support for "${subject?.name || 'a class'}"`,
        'ROLE_CONFLICT'
      );
    }
    return { class: cid, mainTrainers: main, supportTrainers: support };
  });

  // Every named mentor must be a real, active trainer. One query for all of
  // them rather than per-entry: a 50-class batch would otherwise issue 50+
  // round trips just to validate.
  const trainerIds = [
    ...new Set(resolved.flatMap((e) => [...e.mainTrainers, ...e.supportTrainers])),
  ];
  const valid = await User.find({
    _id: { $in: trainerIds },
    role: 'trainer',
    isActive: true,
  })
    .select('_id')
    .lean();
  if (valid.length !== trainerIds.length) {
    const ok = new Set(valid.map((u) => String(u._id)));
    const bad = trainerIds.filter((id) => !ok.has(id));
    throw badRequest(
      `${bad.length} selected mentor(s) were not found or are inactive`,
      'BAD_TRAINER'
    );
  }

  return resolved;
}

// POST /api/batches  (admin)
export const createBatch = asyncHandler(async (req, res) => {
  const { classes, name, yearGroup, dept, expectedCount } = req.body;
  const classEntries = await resolveClasses(classes);

  const created = await Batch.create({
    classes: classEntries,
    name,
    yearGroup: yearGroup || '',
    dept: dept || '',
    expectedCount: expectedCount || 0,
  });
  const batch = await Batch.findById(created._id).populate(populateClasses);

  recordAudit(req, {
    action: 'batch.create',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
    meta: {
      classCount: classEntries.length,
      yearGroup: batch.yearGroup,
      mentorCount: new Set(
        classEntries.flatMap((e) => [...e.mainTrainers, ...e.supportTrainers])
      ).size,
    },
  });

  res.status(201).json({ batch: publicBatch(batch) });
});

/**
 * PATCH /api/batches/:id  (admin) — rename and/or restaff.
 *
 * Changing the classes of an OPEN batch mid-collection would make already-
 * submitted feedback reference classes no longer "in" the batch, so it is only
 * allowed while the batch is locked. Renaming and adjusting the expected count
 * are safe at any time.
 */
export const updateBatch = asyncHandler(async (req, res) => {
  const { name, classes, yearGroup, dept, expectedCount } = req.body;
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw notFound('Batch not found');

  if (classes !== undefined) {
    if (batch.status === 'open') {
      throw badRequest('Lock the batch before changing its classes or mentors', 'BATCH_OPEN');
    }
    batch.classes = await resolveClasses(classes);
  }
  if (name !== undefined) batch.name = name;
  if (yearGroup !== undefined) batch.yearGroup = yearGroup;
  if (dept !== undefined) batch.dept = dept;
  if (expectedCount !== undefined) {
    // Never let the cap drop below what has already come in, or the
    // conditional increment would wedge the batch closed with no explanation.
    if (expectedCount > 0 && expectedCount < batch.submittedCount) {
      throw badRequest(
        `This batch already has ${batch.submittedCount} responses — the expected count cannot be lower`,
        'CAP_BELOW_SUBMITTED'
      );
    }
    batch.expectedCount = expectedCount;
  }
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

/**
 * GET /api/batches  (admin)
 * Query: page, limit, q, archived=live|archived|all, status, class, yearGroup, trainer
 *
 * Paginated server-side. This list only grows — an institution two years in has
 * hundreds of cohorts, and shipping all of them to the browser to filter is the
 * kind of thing that works in a demo and falls over in week three.
 */
export const listBatches = asyncHandler(async (req, res) => {
  const { page, limit, q, archived, status, yearGroup } = req.query;

  const filter = {};
  if (archived === 'live') filter.archivedAt = null;
  else if (archived === 'archived') filter.archivedAt = { $ne: null };

  if (status) filter.status = status;
  if (yearGroup) filter.yearGroup = yearGroup;

  /* Class and mentor filters must be satisfied by the SAME class entry.
     Written as sibling keys — { 'classes.class': c, 'classes.mainTrainers': t }
     — Mongo lets DIFFERENT array elements satisfy them, so asking for
     "Industry Readiness taught by Suneeta" would also return a batch where she
     teaches Coding and someone else teaches Industry Readiness. $elemMatch
     asks the question actually intended. */
  const rosterOr = req.query.trainer
    ? [
        { mainTrainers: req.query.trainer },
        { supportTrainers: req.query.trainer },
      ]
    : null;

  if (req.query.class && rosterOr) {
    filter.classes = { $elemMatch: { class: req.query.class, $or: rosterOr } };
  } else if (req.query.class) {
    // A batch matches ?class=<id> when that class is among its classes.
    filter['classes.class'] = req.query.class;
  } else if (rosterOr) {
    filter.classes = { $elemMatch: { $or: rosterOr } };
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    // The roster/class filters now live under `classes.$elemMatch`, so the
    // free-text search owns $or outright and cannot clobber them.
    filter.$or = [{ name: rx }, { yearGroup: rx }, { dept: rx }];
  }

  const [batches, total, yearGroups] = await Promise.all([
    Batch.find(filter)
      .populate(populateClasses)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Batch.countDocuments(filter),
    // Powers the year-group filter dropdown without a second round trip.
    Batch.distinct('yearGroup', { archivedAt: null }),
  ]);

  res.json({
    batches: batches.map((b) => publicBatch(b)),
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    filters: { yearGroups: yearGroups.filter(Boolean).sort() },
  });
});

/**
 * POST /api/batches/:id/unlock   (admin)
 * Body: { expectedCount }
 *
 * Generates a FRESH passcode (rotating any previous one), stores only its
 * bcrypt hash, opens the window, resets the live counter, BUMPS THE ROUND, and
 * returns the plaintext passcode EXACTLY ONCE. There is no endpoint that can
 * return this plaintext again — the admin must copy it now or re-unlock to
 * rotate.
 *
 * The round bump is what makes a legitimate second collection round possible.
 * Device locks are hashed with the round mixed in, so round 2 starts from a
 * clean namespace instead of silently rejecting every student who answered
 * round 1 while the counter still read 0/N.
 */
export const unlockBatch = asyncHandler(async (req, res) => {
  const { expectedCount } = req.body;
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw notFound('Batch not found');
  if (batch.archivedAt) {
    throw badRequest('Restore this batch before unlocking it', 'BATCH_ARCHIVED');
  }

  const passcode = generateBatchPasscode(batch.name);
  batch.passcodeHash = await hashPasscode(passcode);
  batch.status = 'open';
  batch.expectedCount = expectedCount;
  batch.submittedCount = 0; // fresh window → fresh count
  batch.round = (batch.round || 0) + 1; // fresh device-lock namespace
  batch.openedAt = new Date();
  batch.closedAt = null;
  await batch.save();

  recordAudit(req, {
    action: 'batch.unlock',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
    meta: { expectedCount, round: batch.round },
  });

  await batch.populate(populateClasses);
  res.json({
    batch: publicBatch(batch),
    // Shown once. Not persisted in plaintext anywhere.
    passcode,
    entropyBits: PASSCODE_ENTROPY_BITS,
    round: batch.round,
    notice:
      batch.round > 1
        ? `Copy this passcode now — it will not be shown again. This is round ${batch.round}; students who answered earlier rounds can respond again.`
        : 'Copy this passcode now — it will not be shown again. Re-unlock to rotate.',
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
    meta: { submittedCount: batch.submittedCount, round: batch.round },
  });

  await batch.populate(populateClasses);
  res.json({ batch: publicBatch(batch) });
});

// POST /api/batches/:id/passcode  (admin)
// Passcodes are stored hashed and shown only once at unlock. To hand out a new
// code, this ROTATES: it regenerates, re-hashes, and returns the new plaintext.
// It is a POST because it mutates state (a GET must be safe/idempotent).
//
// The round is deliberately NOT bumped here: rotating is for "the code leaked,
// give me a new one mid-round", and bumping would let everyone who already
// answered this round answer again.
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
  res.json({
    batch: publicBatch(batch),
    passcode,
    entropyBits: PASSCODE_ENTROPY_BITS,
    rotated: true,
  });
});

/**
 * GET /api/batches/:id/rounds  (admin)
 * How many devices each collection round locked, and how many responses it
 * produced — so "we re-ran this cohort" is visible rather than implied.
 */
export const batchRounds = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id).select('name round submittedCount');
  if (!batch) throw notFound('Batch not found');

  const [locks, responses] = await Promise.all([
    DeviceLock.aggregate([
      { $match: { batch: batch._id } },
      { $group: { _id: '$round', devices: { $sum: 1 }, firstAt: { $min: '$createdAt' } } },
      { $sort: { _id: 1 } },
    ]),
    Feedback.aggregate([
      { $match: { batch: batch._id } },
      { $group: { _id: '$round', rows: { $sum: 1 } } },
    ]),
  ]);
  const rowsByRound = new Map(responses.map((r) => [r._id, r.rows]));

  res.json({
    batch: { id: String(batch._id), name: batch.name, currentRound: batch.round || 0 },
    rounds: locks.map((l) => ({
      round: l._id,
      devicesLocked: l.devices,
      feedbackRows: rowsByRound.get(l._id) || 0,
      startedAt: l.firstAt,
    })),
  });
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
