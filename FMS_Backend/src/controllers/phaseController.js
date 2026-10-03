import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, conflict, notFound } from '../utils/ApiError.js';
import { Phase } from '../models/Phase.js';
import { Batch } from '../models/Batch.js';
import {
  assertWindowIsFree,
  resyncPhaseMembership,
  phaseStats,
  unassignedStats,
  collectingPhase,
} from '../services/phaseService.js';
import { recordAudit } from '../services/auditService.js';

/** Shape a phase for the wire, with its counts. */
async function shape(doc) {
  const stats = await phaseStats(doc._id);
  const now = new Date();
  return {
    _id: doc._id,
    name: doc.name,
    code: doc.code,
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    status: doc.status,
    notes: doc.notes || '',
    closedAt: doc.closedAt || null,
    /* Past its end date and still open. The dashboard nudges on this rather
       than closing automatically: auto-close will eventually lock a batch
       while a class is mid-form, and a survey that dies under someone's hands
       is a worse failure than a phase left open a day too long. */
    overdue: doc.status === 'open' && now >= doc.endsAt,
    collecting: doc.status === 'open' && now >= doc.startsAt && now < doc.endsAt,
    ...stats,
  };
}

// GET /api/v1/phases
export const listPhases = asyncHandler(async (req, res) => {
  const docs = await Phase.find().sort({ startsAt: -1 }).lean();
  const phases = await Promise.all(docs.map(shape));
  res.json({ phases, unassigned: await unassignedStats() });
});

// GET /api/v1/phases/current — the phase a new submission would land in.
export const currentPhase = asyncHandler(async (_req, res) => {
  const p = await collectingPhase();
  res.json({ phase: p ? await shape(p) : null });
});

// GET /api/v1/phases/:id
export const getPhase = asyncHandler(async (req, res) => {
  const doc = await Phase.findById(req.params.id).lean();
  if (!doc) throw notFound('Phase not found');
  res.json({ phase: await shape(doc) });
});

// POST /api/v1/phases
export const createPhase = asyncHandler(async (req, res) => {
  const { name, code, startsAt, endsAt, notes = '', status = 'draft' } = req.body;
  const from = new Date(startsAt);
  const to = new Date(endsAt);

  await assertWindowIsFree({ startsAt: from, endsAt: to });
  if (status === 'open') await assertNoOtherOpenPhase();

  const existing = await Phase.findOne({ code: String(code).toUpperCase() }).lean();
  if (existing) throw conflict(`The code "${code}" is already used by "${existing.name}".`, 'PHASE_CODE_TAKEN');

  const phase = await Phase.create({ name, code, startsAt: from, endsAt: to, notes, status });

  /* Claim any feedback already inside the window. This is what lets a phase be
     declared RETROACTIVELY — "September was Phase 1" — without a separate
     migration every time. */
  const moved = await resyncPhaseMembership(phase);

  recordAudit(req, {
    action: 'phase.create',
    entity: 'phase',
    entityId: phase._id,
    entityName: phase.name,
    meta: { code: phase.code, claimed: moved.claimed },
  });

  res.status(201).json({ phase: await shape(phase.toObject()), claimed: moved.claimed });
});

/** At most one phase may be open — see the note in phaseService. */
async function assertNoOtherOpenPhase(exceptId) {
  const q = { status: 'open' };
  if (exceptId) q._id = { $ne: exceptId };
  const open = await Phase.findOne(q).lean();
  if (open) {
    throw conflict(
      `"${open.name}" is already open. Close it before opening another — with two phases open, ` +
        'a submission has no single answer for which exercise it belongs to.',
      'PHASE_ALREADY_OPEN'
    );
  }
}

// PATCH /api/v1/phases/:id
export const updatePhase = asyncHandler(async (req, res) => {
  const phase = await Phase.findById(req.params.id);
  if (!phase) throw notFound('Phase not found');

  /* The freeze rule. A closed phase's numbers have been reported on and acted
     on; a number that moves after someone has acted on it is worse than no
     number at all. Reopening is deliberately not offered. */
  if (phase.status === 'closed') {
    throw conflict(
      `"${phase.name}" is closed and cannot be changed. Its figures have already been reported. ` +
        'Create a new phase for any further collection.',
      'PHASE_CLOSED'
    );
  }

  const { name, code, startsAt, endsAt, notes, status } = req.body;
  const windowChanged = startsAt !== undefined || endsAt !== undefined;
  const from = startsAt !== undefined ? new Date(startsAt) : phase.startsAt;
  const to = endsAt !== undefined ? new Date(endsAt) : phase.endsAt;

  if (windowChanged) await assertWindowIsFree({ startsAt: from, endsAt: to, exceptId: phase._id });
  if (status === 'open' && phase.status !== 'open') await assertNoOtherOpenPhase(phase._id);
  if (status === 'closed') throw badRequest('Use POST /phases/:id/close to close a phase', 'USE_CLOSE');

  if (name !== undefined) phase.name = name;
  if (notes !== undefined) phase.notes = notes;
  if (status !== undefined) phase.status = status;
  if (code !== undefined) {
    const taken = await Phase.findOne({ code: String(code).toUpperCase(), _id: { $ne: phase._id } }).lean();
    if (taken) throw conflict(`The code "${code}" is already used by "${taken.name}".`, 'PHASE_CODE_TAKEN');
    phase.code = code;
  }
  phase.startsAt = from;
  phase.endsAt = to;
  await phase.save();

  // Re-stamp, so a widened window picks up responses and a narrowed one lets go.
  const moved = await resyncPhaseMembership(phase);

  recordAudit(req, {
    action: 'phase.update',
    entity: 'phase',
    entityId: phase._id,
    entityName: phase.name,
    meta: { claimed: moved.claimed, released: moved.releasedFromThis },
  });

  res.json({ phase: await shape(phase.toObject()), ...moved });
});

// POST /api/v1/phases/:id/close
export const closePhase = asyncHandler(async (req, res) => {
  const phase = await Phase.findById(req.params.id);
  if (!phase) throw notFound('Phase not found');
  if (phase.status === 'closed') throw conflict('That phase is already closed.', 'PHASE_CLOSED');

  /* Closing a phase must also stop its batches collecting. Otherwise a student
     submits on Tuesday into an exercise reported on Monday, and the response
     lands nowhere — the phase will not claim it, so it shows as Unassigned and
     looks like data loss. Locking the batches makes the end of a phase mean
     what an admin thinks it means. */
  const locked = await Batch.updateMany(
    { status: 'open' },
    { $set: { status: 'locked', closedAt: new Date() } }
  );

  phase.status = 'closed';
  phase.closedAt = new Date();
  phase.closedBy = req.user?._id || null;
  await phase.save();

  recordAudit(req, {
    action: 'phase.close',
    entity: 'phase',
    entityId: phase._id,
    entityName: phase.name,
    meta: { batchesLocked: locked.modifiedCount },
  });

  res.json({ phase: await shape(phase.toObject()), batchesLocked: locked.modifiedCount });
});

// DELETE /api/v1/phases/:id — only while nothing depends on it.
export const deletePhase = asyncHandler(async (req, res) => {
  const phase = await Phase.findById(req.params.id);
  if (!phase) throw notFound('Phase not found');
  if (phase.status === 'closed') throw conflict('A closed phase cannot be deleted.', 'PHASE_CLOSED');

  const stats = await phaseStats(phase._id);
  if (stats.responses > 0) {
    throw conflict(
      `"${phase.name}" holds ${stats.responses} responses. Deleting it would leave them unaccounted for — ` +
        'narrow its window instead, or close it.',
      'PHASE_HAS_RESPONSES'
    );
  }

  await phase.deleteOne();
  recordAudit(req, { action: 'phase.delete', entity: 'phase', entityId: phase._id, entityName: phase.name });
  res.json({ ok: true });
});
