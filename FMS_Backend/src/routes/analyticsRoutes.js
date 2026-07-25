import { Router } from 'express';
import { requireAuth, requireRole, requirePasswordChanged } from '../middleware/auth.js';
import {
  classAnalytics,
  batchAnalytics,
  trainerAnalytics,
  trainerBatchesOverview,
  classesOverview,
  trainersComparison,
  themes,
  deltas,
  comments,
} from '../controllers/analyticsController.js';

const router = Router();
router.use(requireAuth);
// Accounts still on an issued password are held at the change-password gate.
router.use(requirePasswordChanged);

// Trainer-scoped (must precede the admin routes conceptually; both roles hit
// class/batch but access is checked inside the controllers).
router.get('/trainer/me', requireRole('trainer'), trainerAnalytics);
// The trainer's own batches (as cards), scoped to batches they teach in.
router.get('/trainer/batches', requireRole('trainer'), trainerBatchesOverview);

// Class cards for the Feedbacks tab — both roles; scoped inside the controller.
// Declared before '/class/:classId' so 'classes' is never read as an id.
router.get('/classes', classesOverview);
// Cross-trainer ranking (admin only — enforced in the controller too).
router.get('/trainers', requireRole('admin'), trainersComparison);
// Comment themes + period deltas, both role-scoped inside the controller.
router.get('/themes', themes);
// Comments behind a theme (keyword drill-down).
router.get('/comments', comments);
router.get('/deltas', deltas);

// class/batch analytics are readable by admin (all) and trainer (own only —
// enforced inside the controller against class.trainer).
router.get('/class/:classId', classAnalytics);
router.get('/batch/:batchId', batchAnalytics);

export default router;
