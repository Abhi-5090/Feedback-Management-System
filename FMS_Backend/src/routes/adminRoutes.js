import { Router } from 'express';
import { requireAuth, requireRole, requirePasswordChanged } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import {
  trainerCreateSchema,
  trainerUpdateSchema,
  trainerBulkSchema,
  trainerBulkPreviewSchema,
  classCreateSchema,
  classUpdateSchema,
  parameterCreateSchema,
  parameterUpdateSchema,
  batchCreateSchema,
  batchUpdateSchema,
  batchUnlockSchema,
  listQuerySchema,
  auditQuerySchema,
} from '../utils/schemas.js';
import {
  createTrainer,
  listTrainers,
  updateTrainer,
  bulkCreateTrainers,
  bulkPreview,
  bulkTemplate,
  issueResetLink,
} from '../controllers/trainerController.js';
import { createClass, listClasses, updateClass, archiveClass } from '../controllers/classController.js';
import { listAudit } from '../controllers/auditController.js';
import { runDigestsNow, auditActions, sendTestMail } from '../controllers/systemController.js';
import {
  listParameters,
  createParameter,
  updateParameter,
  deleteParameter,
} from '../controllers/parameterController.js';
import {
  createBatch,
  updateBatch,
  listBatches,
  unlockBatch,
  lockBatch,
  rotatePasscode,
  archiveBatch,
  batchRounds,
} from '../controllers/batchController.js';

const router = Router();

// Admin guard applied PER-ROUTE (not via router.use), so this router — mounted
// at '/api' — only intercepts its own resource paths and lets unrelated /api/*
// requests (public, analytics, dashboard, export) fall through untouched.
const admin = [requireAuth, requirePasswordChanged, requireRole('admin')];

// The list endpoints share one query schema (page/limit/q/filters). Validated
// on `query` so the controllers receive coerced numbers and safe defaults
// instead of re-parsing strings and clamping by hand in five places.
const listQuery = validate(listQuerySchema, 'query');

// Trainers
router.post('/trainers', admin, validate(trainerCreateSchema), createTrainer);
// Registered before '/trainers/:id' patterns so 'bulk' is never read as an id.
router.get('/trainers/bulk/template', admin, bulkTemplate);
router.post('/trainers/bulk/preview', admin, validate(trainerBulkPreviewSchema), bulkPreview);
router.post('/trainers/bulk', admin, validate(trainerBulkSchema), bulkCreateTrainers);
router.get('/trainers', admin, listQuery, listTrainers);
router.patch('/trainers/:id', admin, validate(trainerUpdateSchema), updateTrainer);
// Hand a mentor a single-use reset link directly — the way back into an account
// when email is not configured or not reaching them.
router.post('/trainers/:id/reset-link', admin, issueResetLink);

// Classes
router.post('/classes', admin, validate(classCreateSchema), createClass);
router.get('/classes', admin, listQuery, listClasses);
router.patch('/classes/:id', admin, validate(classUpdateSchema), updateClass);
router.patch('/classes/:id/archive', admin, archiveClass);

// Parameters
router.get('/parameters', admin, listParameters);
router.post('/parameters', admin, validate(parameterCreateSchema), createParameter);
router.patch('/parameters/:id', admin, validate(parameterUpdateSchema), updateParameter);
router.delete('/parameters/:id', admin, deleteParameter);

// Batches (+ passcode lifecycle)
router.post('/batches', admin, validate(batchCreateSchema), createBatch);
router.get('/batches', admin, listQuery, listBatches);
router.patch('/batches/:id', admin, validate(batchUpdateSchema), updateBatch);
router.post('/batches/:id/unlock', admin, validate(batchUnlockSchema), unlockBatch);
router.post('/batches/:id/lock', admin, lockBatch);
// POST (not GET): rotating the passcode mutates state, so it must not be a GET.
router.post('/batches/:id/passcode', admin, rotatePasscode);
router.get('/batches/:id/rounds', admin, batchRounds);
router.patch('/batches/:id/archive', admin, archiveBatch);

// Audit trail (admin only) — who did what, when.
router.get('/audit', admin, validate(auditQuerySchema, 'query'), listAudit);
router.get('/audit/actions', admin, auditActions);

// System operations
router.post('/system/digests/run', admin, runDigestsNow);
router.post('/system/mail/test', admin, sendTestMail);

export default router;
