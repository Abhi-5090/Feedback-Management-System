import { Router } from 'express';
import { requireAuth, requireRole, requirePasswordChanged } from '../middleware/auth.js';
import { adminDashboard, trainerDashboard } from '../controllers/dashboardController.js';

const router = Router();
router.use(requireAuth);
// Accounts still on an issued password are held at the change-password gate.
router.use(requirePasswordChanged);

router.get('/admin', requireRole('admin'), adminDashboard);
router.get('/trainer/me', requireRole('trainer'), trainerDashboard);

export default router;
