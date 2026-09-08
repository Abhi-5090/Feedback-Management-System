import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound, badRequest } from '../utils/ApiError.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import {
  trainerClassIds,
  buildFeedbackMatch,
  batchIdsForCohort,
  andMatch,
  overallStats,
  roleSplitStats,
  perParameterAverages,
  detailRows,
  staffs,
  shapeEntry,
} from '../services/analyticsService.js';
import { buildExcel } from '../export/excelBuilder.js';
import { buildPdf } from '../export/pdfBuilder.js';
import { recordAudit } from '../services/auditService.js';
import { trainerComparison } from '../services/insightsService.js';

/** Assemble the shared report payload consumed by both builders. */
async function assembleReport(match, { title, filterContext, roleSplit }) {
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
    roleSplit: roleSplit || null,
    summary, // [{ label, average, responses }]
    parameters: detail.parameters, // [{ id, label }]
    rows: detail.rows,
    truncated: detail.truncated,
    rowLimit: detail.limit,
  };
}

/** Stream the assembled report as xlsx or pdf with correct headers. */
async function sendReport(res, report, format, baseName) {
  const safe = baseName.replace(/[^\w.-]+/g, '_').slice(0, 120);
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

function roleFilter(req) {
  return ['main', 'support'].includes(req.query.role) ? req.query.role : undefined;
}

/** Cohort narrowing shared by the exports, mirroring the analytics filters. */
async function withCohort(req, base) {
  const ids = await batchIdsForCohort({
    yearGroup: req.query.yearGroup,
    dept: req.query.dept,
  });
  return ids ? andMatch(base, { batch: { $in: ids } }) : base;
}

/* ── A note on audit ordering ──────────────────────────────────────────────
   recordAudit is called AFTER every authorization and validation check, never
   before. It used to be the first statement in each handler, which meant a
   trainer refused with 403 still left an "Exported data" entry naming a class
   they never received — in the one feature whose entire purpose is answering
   "who exported our data?". An audit trail that logs attempts as though they
   were successes is worse than no trail, because it is trusted. */

// GET /api/export/class/:id?format=xlsx|pdf
export const exportClass = asyncHandler(async (req, res) => {
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

  const match = await withCohort(
    req,
    buildFeedbackMatch({ scopeTrainerId, role: roleFilter(req), classId: klass._id })
  );
  const report = await assembleReport(match, {
    title: `Class Feedback — ${klass.name}`,
    filterContext: [
      `Class: ${klass.name}`,
      req.query.yearGroup ? `Year: ${req.query.yearGroup}` : null,
      roleFilter(req) ? `Role: ${roleFilter(req)} mentor` : null,
      scopeTrainerId ? `Scope: ${req.user.name} (own sessions only)` : 'Scope: all mentors',
    ]
      .filter(Boolean)
      .join(' · '),
    roleSplit: scopeTrainerId
      ? await roleSplitStats({ trainerId: scopeTrainerId, classId: klass._id })
      : null,
  });

  recordAudit(req, {
    action: 'export.download',
    entity: 'class',
    entityId: klass._id,
    entityName: klass.name,
    meta: { format, rows: report.rows.length, truncated: report.truncated },
  });

  await sendReport(res, report, format, `class_${klass.name}`);
});

// GET /api/export/batch/:id?format=xlsx|pdf
export const exportBatch = asyncHandler(async (req, res) => {
  const format = parseFormat(req);
  const scopeTrainerId = scopeTrainer(req);
  const batch = await Batch.findById(req.params.id)
    .populate('classes.class', 'name')
    .populate('classes.mainTrainers', 'name')
    .populate('classes.supportTrainers', 'name');
  if (!batch) throw notFound('Batch not found');

  // A trainer only exports the classes in this batch that THEY staff.
  const visible = (batch.classes || []).filter(
    (e) => !scopeTrainerId || staffs(e, scopeTrainerId)
  );
  if (scopeTrainerId && visible.length === 0) {
    throw forbidden('You can only export your own batches.');
  }

  const match = buildFeedbackMatch({
    scopeTrainerId,
    role: roleFilter(req),
    batchId: batch._id,
  });
  const shaped = visible.map((e) => shapeEntry(e, scopeTrainerId));
  const classList = shaped.map((e) => e.name).join(', ') || '—';
  const mentorList =
    [...new Set(shaped.flatMap((e) => [...e.mainTrainerNames, ...e.supportTrainerNames]))].join(
      ', '
    ) || '—';

  const report = await assembleReport(match, {
    title: `Batch Feedback — ${batch.name}`,
    filterContext: [
      `Batch: ${batch.name}`,
      batch.yearGroup ? `Year: ${batch.yearGroup}` : null,
      batch.dept ? `Dept: ${batch.dept}` : null,
      `Classes: ${classList}`,
      `Mentors: ${mentorList}`,
      `${batch.submittedCount}/${batch.expectedCount} responses`,
      batch.round > 1 ? `Round ${batch.round}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    roleSplit: scopeTrainerId
      ? await roleSplitStats({ trainerId: scopeTrainerId, batchId: batch._id })
      : null,
  });

  recordAudit(req, {
    action: 'export.download',
    entity: 'batch',
    entityId: batch._id,
    entityName: batch.name,
    meta: { format, rows: report.rows.length, truncated: report.truncated },
  });

  await sendReport(res, report, format, `batch_${batch.name}`);
});

// GET /api/export/trainer/me?format=xlsx|pdf  (trainer's own data only)
export const exportTrainerMe = asyncHandler(async (req, res) => {
  const format = parseFormat(req);
  const role = roleFilter(req);
  const match = await withCohort(
    req,
    buildFeedbackMatch({ scopeTrainerId: req.user._id, role })
  );
  const report = await assembleReport(match, {
    title: `My Feedback — ${req.user.name}`,
    filterContext: [
      `Mentor: ${req.user.name}`,
      role ? `Role: ${role} mentor only` : 'Both roles (main + support)',
      req.query.yearGroup ? `Year: ${req.query.yearGroup}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    roleSplit: await roleSplitStats({ trainerId: req.user._id }),
  });

  recordAudit(req, {
    action: 'export.download',
    entity: 'trainer',
    entityId: req.user._id,
    entityName: req.user.name,
    meta: { format, rows: report.rows.length, role: role || 'all' },
  });

  await sendReport(res, report, format, `mentor_${req.user.name}`);
});

// GET /api/export/dashboard/admin?format=xlsx|pdf  — honors the same filters
export const exportAdminDashboard = asyncHandler(async (req, res) => {
  const format = parseFormat(req);
  const { class: classId, batch: batchId, trainer: trainerId, yearGroup, dept } = req.query;
  const role = roleFilter(req);

  const match = await withCohort(
    req,
    buildFeedbackMatch({ classId, batchId, trainerId, role, from: req.query.from, to: req.query.to })
  );

  const ctxParts = [];
  if (yearGroup) ctxParts.push(`Year: ${yearGroup}`);
  if (dept) ctxParts.push(`Dept: ${dept}`);
  if (classId) ctxParts.push(`class=${classId}`);
  if (batchId) ctxParts.push(`batch=${batchId}`);
  if (trainerId) ctxParts.push(`mentor=${trainerId}`);
  if (role) ctxParts.push(`role=${role}`);

  const report = await assembleReport(match, {
    title: 'Admin Dashboard — Feedback Export',
    filterContext: ctxParts.length ? ctxParts.join(' · ') : 'All data',
  });

  recordAudit(req, {
    action: 'export.download',
    entity: 'dashboard',
    entityId: '',
    entityName: 'Admin dashboard',
    meta: { format, rows: report.rows.length, truncated: report.truncated },
  });

  await sendReport(res, report, format, 'admin_dashboard');
});

/**
 * GET /api/export/mentors?format=xlsx|pdf  (admin)
 * The mentor workload + score matrix — the Torii board's deployment summary,
 * with what each role actually scores attached.
 */
export const exportMentors = asyncHandler(async (req, res) => {
  const format = parseFormat(req);
  const data = await trainerComparison({ role: roleFilter(req) });

  const report = {
    title: 'Mentor Workload & Ratings',
    filterContext: `${data.trainers.length} mentors · role: ${data.role}`,
    generatedAt: new Date(),
    overall: {
      feedbackCount: data.trainers.reduce((n, t) => n + t.responses, 0),
      overallAverage: 0,
    },
    summary: [],
    parameters: data.parameters.map((label) => ({ id: label, label })),
    // This report's rows are mentors, not feedback submissions, so it declares
    // its own column layout rather than borrowing the feedback one.
    detailColumns: [
      { header: 'Mentor', key: 'mentor', width: 30 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Classes', key: 'classes', width: 12 },
      { header: 'Batches', key: 'batches', width: 12 },
      { header: 'Responses', key: 'responses', width: 14 },
      { header: 'Average', key: 'average', width: 12 },
      ...data.parameters.map((label) => ({ header: label, key: label, width: 16 })),
    ],
    rows: data.trainers.map((t) => ({
      mentor: t.name,
      email: t.email,
      classes: t.classes,
      batches: t.batches,
      responses: t.responses,
      average: t.average ?? '',
      ...Object.fromEntries(t.perParameter.map((p) => [p.label, p.average ?? ''])),
    })),
    truncated: false,
  };

  recordAudit(req, {
    action: 'export.download',
    entity: 'mentors',
    entityId: '',
    entityName: 'Mentor matrix',
    meta: { format, rows: report.rows.length },
  });

  await sendReport(res, report, format, 'mentor_matrix');
});
