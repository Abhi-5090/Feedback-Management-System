import { Parameter } from '../models/Parameter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/ApiError.js';
import { bustParameterCache } from '../services/parameterCache.js';
import { recordAudit } from '../services/auditService.js';

// GET /api/parameters  — admin sees all; ?activeOnly=1 filters to active
export const listParameters = asyncHandler(async (req, res) => {
  const filter = req.query.activeOnly ? { isActive: true } : {};
  const parameters = await Parameter.find(filter).sort({ order: 1, createdAt: 1 });
  res.json({ parameters });
});

// POST /api/parameters  (admin) — appends at the end by default
export const createParameter = asyncHandler(async (req, res) => {
  const { label, description, order } = req.body;
  const nextOrder =
    order ?? ((await Parameter.findOne().sort({ order: -1 }).select('order'))?.order ?? -1) + 1;
  const parameter = await Parameter.create({ label, description, order: nextOrder });
  // The student form reads a cached copy — make an admin's edit visible now.
  bustParameterCache();
  recordAudit(req, { action: 'parameter.create', entity: 'parameter', entityId: parameter._id, entityName: parameter.label });
  res.status(201).json({ parameter });
});

// PATCH /api/parameters/:id  (admin) — rename / reorder / toggle
export const updateParameter = asyncHandler(async (req, res) => {
  const parameter = await Parameter.findById(req.params.id);
  if (!parameter) throw notFound('Parameter not found');

  const { label, description, order, isActive } = req.body;
  if (label !== undefined) parameter.label = label;
  if (description !== undefined) parameter.description = description;
  if (order !== undefined) parameter.order = order;
  if (typeof isActive === 'boolean') parameter.isActive = isActive;

  await parameter.save();
  bustParameterCache();
  recordAudit(req, { action: 'parameter.update', entity: 'parameter', entityId: parameter._id, entityName: parameter.label });
  res.json({ parameter });
});

// DELETE /api/parameters/:id  (admin) — SOFT delete so historical feedback
// that references this parameter can still resolve its label.
export const deleteParameter = asyncHandler(async (req, res) => {
  const parameter = await Parameter.findById(req.params.id);
  if (!parameter) throw notFound('Parameter not found');
  parameter.isActive = false;
  await parameter.save();
  bustParameterCache();
  recordAudit(req, { action: 'parameter.delete', entity: 'parameter', entityId: parameter._id, entityName: parameter.label });
  res.json({ parameter, softDeleted: true });
});
