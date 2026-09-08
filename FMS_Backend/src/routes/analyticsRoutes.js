import { Router } from 'express';
import { requireAuth, requireRole, requirePasswordChanged } from '../middleware/auth.js';
import {
  classAnalytics,
  batchAnalytics,
  trainerAnalytics,
  trainerBatchesOverview,
  classesOverview,
  trainersComparison,
  cohorts,
  mentorLoad,
  myRoleSplit,
  themes,
  deltas,
  comments,
  sessions,
  years,
} from '../controllers/analyticsController.js';

const router = Router();
router.use(requireAuth);
// Accounts still on an issued password are held at the change-password gate.
router.use(requirePasswordChanged);

// Trainer-scoped.
router.get('/trainer/me', requireRole('trainer'), trainerAnalytics);
// The trainer's own batches (as cards), scoped to batches they staff.
router.get('/trainer/batches', requireRole('trainer'), trainerBatchesOverview);
// My figures as main mentor vs as support mentor.
router.get('/role-split', requireRole('trainer'), myRoleSplit);

// Class cards for the Feedbacks tab — both roles; scoped inside the controller.
// Declared before '/class/:classId' so 'classes' is never read as an id.
router.get('/classes', classesOverview);
// Session cards (one per batch+class) and the year-group cards above them.
// Both roles; scoped inside the controllers.
router.get('/sessions', sessions);
router.get('/years', years);
// Cross-mentor ranking (admin only — enforced in the controller too).
router.get('/trainers', requireRole('admin'), trainersComparison);
// Year-group roll-up and the mentor deployment matrix (admin only).
router.get('/cohorts', requireRole('admin'), cohorts);
router.get('/mentor-load', requireRole('admin'), mentorLoad);
// Comment themes + period deltas, both role-scoped inside the controller.
router.get('/themes', themes);
// Comments behind a theme (keyword drill-down).
router.get('/comments', comments);
router.get('/deltas', deltas);

// class/batch analytics are readable by admin (all) and trainer (own only —
// enforced inside the controller against the mentor rosters).
router.get('/class/:classId', classAnalytics);
router.get('/batch/:batchId', batchAnalytics);

export default router;
