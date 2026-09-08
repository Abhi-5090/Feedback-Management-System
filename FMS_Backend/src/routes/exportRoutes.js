import { Router } from 'express';
import { requireAuth, requireRole, requirePasswordChanged } from '../middleware/auth.js';
import {
  exportClass,
  exportBatch,
  exportTrainerMe,
  exportAdminDashboard,
  exportMentors,
} from '../controllers/exportController.js';

const router = Router();
router.use(requireAuth);
// Accounts still on an issued password are held at the change-password gate.
router.use(requirePasswordChanged);

// Trainer's own data (scoped inside the controller).
router.get('/trainer/me', requireRole('trainer'), exportTrainerMe);

// Admin exports honor the same filters as the dashboards.
router.get('/dashboard/admin', requireRole('admin'), exportAdminDashboard);
router.get('/mentors', requireRole('admin'), exportMentors);

// class/batch exports: admin (any) + trainer (own only — enforced in controller).
router.get('/class/:id', exportClass);
router.get('/batch/:id', exportBatch);

export default router;
