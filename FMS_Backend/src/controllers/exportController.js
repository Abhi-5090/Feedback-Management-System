import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound, badRequest } from '../utils/ApiError.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import {
  trainerClassIds,
  buildFeedbackMatch,
  overallStats,
  perParameterAverages,
  detailRows,
} from '../services/analyticsService.js';
import { buildExcel } from '../export/excelBuilder.js';
import { buildPdf } from '../export/pdfBuilder.js';
import { recordAudit } from '../services/auditService.js';

/** Assemble the shared report payload consumed by both builders. */
async function assembleReport(match, { title, filterContext }) {
  const [overall, summary, detail] = await Promise.all([
    overallStats(match),
    perParameterAverages(match),
    detailRows(match),
  ]);
  return {
    title,
    filterContext,
    generatedAt: new Date(),
    overall,
    summary, // [{ label, average, responses }]
    parameters: detail.parameters, // [{ id, label }]
    rows: detail.rows,
  };
}

/** Stream the assembled report as xlsx or pdf with correct headers. */
async function sendReport(res, report, format, baseName) {
  const safe = baseName.replace(/[^\w.-]+/g, '_');
  if (format === 'pdf') {
    const buf = await buildPdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    return res.send(buf);
  }
  if (format === 'xlsx') {
    const buf = await buildExcel(report);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
    return res.send(buf);
  }
  throw badRequest('format must be xlsx or pdf', 'BAD_FORMAT');
}

function parseFormat(req) {
  const f = (req.query.format || 'xlsx').toLowerCase();
  if (!['xlsx', 'pdf'].includes(f)) throw badRequest('format must be xlsx or pdf', 'BAD_FORMAT');
  return f;
}

// The logged-in trainer's id (their hard scope), or null for an admin.
function scopeTrainer(req) {
  return req.user.role === 'admin' ? null : req.user._id;
}

// GET /api/export/class/:id?format=xlsx|pdf
export const exportClass = asyncHandler(async (req, res) => {
  recordAudit(req, { action: 'export.download', entity: 'class', entityId: req.params.id || '', meta: { format: req.query.format || 'xlsx' } });
  const format = parseFormat(req);
  const scopeTrainerId = scopeTrainer(req);
  const klass = await Class.findById(req.params.id).populate('trainer', 'name');
  if (!klass) throw notFound('Class not found');
  if (scopeTrainerId) {
    const involved = await trainerClassIds(scopeTrainerId);
    if (!involved.some((id) => String(id) === String(klass._id))) {
      throw forbidden('You can only export your own classes.');
    }
  }

  const match = buildFeedbackMatch({ scopeTrainerId, classId: klass._id });
  const report = await assembleReport(match, {
    title: `Class Feedback — ${klass.name}`,
    filterContext: `Class: ${klass.name} · Trainer: ${klass.trainer?.name || '—'}`,
  });
  await sendReport(res, report, format, `class_${klass.name}`);
});

// GET /api/export/batch/:id?format=xlsx|pdf
export const exportBatch = asyncHandler(async (req, res) => {
  recordAudit(req, { action: 'export.download', entity: 'batch', entityId: req.params.id || '', meta: { format: req.query.format || 'xlsx' } });
  const format = parseFormat(req);
  const scopeTrainerId = scopeTrainer(req);
  const batch = await Batch.findById(req.params.id).populate('classes.class', 'name');
  if (!batch) throw notFound('Batch not found');
  // A trainer only exports the classes in this batch that THEY teach.
  const visibleClasses = (batch.classes || []).filter(
    (e) => !scopeTrainerId || String(e.trainer) === String(scopeTrainerId)
  );
  if (scopeTrainerId && visibleClasses.length === 0) {
    throw forbidden('You can only export your own batches.');
  }

  const match = buildFeedbackMatch({ scopeTrainerId, batchId: batch._id });
  const classList = visibleClasses.map((e) => e.class?.name).filter(Boolean).join(', ') || '—';
  const report = await assembleReport(match, {
    title: `Batch Feedback — ${batch.name}`,
    filterContext: `Batch: ${batch.name} · Classes: ${classList} · ${batch.submittedCount}/${batch.expectedCount} responses`,
  });
  await sendReport(res, report, format, `batch_${batch.name}`);
});

// GET /api/export/trainer/me?format=xlsx|pdf  (trainer's own data only)
export const exportTrainerMe = asyncHandler(async (req, res) => {
  recordAudit(req, { action: 'export.download', entity: 'trainer', entityId: req.params.id || '', meta: { format: req.query.format || 'xlsx' } });
  const format = parseFormat(req);
  const match = buildFeedbackMatch({ scopeTrainerId: req.user._id });
  const report = await assembleReport(match, {
    title: `My Feedback — ${req.user.name}`,
    filterContext: `Trainer: ${req.user.name} (all classes taught)`,
  });
  await sendReport(res, report, format, `trainer_${req.user.name}`);
});

// GET /api/export/dashboard/admin?format=xlsx|pdf  — honors the same filters
export const exportAdminDashboard = asyncHandler(async (req, res) => {
  recordAudit(req, { action: 'export.download', entity: 'dashboard', entityId: req.params.id || '', meta: { format: req.query.format || 'xlsx' } });
  const format = parseFormat(req);
  const { class: classId, batch: batchId, trainer: trainerId } = req.query;
  const match = await buildFeedbackMatch({ classId, batchId, trainerId });

  const ctxParts = [];
  if (classId) ctxParts.push(`class=${classId}`);
  if (batchId) ctxParts.push(`batch=${batchId}`);
  if (trainerId) ctxParts.push(`trainer=${trainerId}`);

  const report = await assembleReport(match, {
    title: 'Admin Dashboard — Feedback Export',
    filterContext: ctxParts.length ? ctxParts.join(' · ') : 'All data',
  });
  await sendReport(res, report, format, 'admin_dashboard');
});
