import { Router } from 'express';
import {
  login, me, logout, logoutEverywhere, updateMe, forgotPassword, resetPassword,
  updateDigest, systemStatus,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import {
  loginSchema, updateMeSchema, forgotPasswordSchema, resetPasswordSchema, digestSchema,
} from '../utils/schemas.js';
import { loginLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), login);
router.get('/me', requireAuth, me);
// Self-service account update (name / email / password) for both roles.
router.patch('/me', requireAuth, validate(updateMeSchema), updateMe);
// Digest opt-in/out. Reachable from Settings for both roles — this endpoint
// existed for a while with no UI behind it, which meant the whole digest
// feature could never be switched on by anyone.
router.patch('/me/digest', requireAuth, validate(digestSchema), updateDigest);
// Deployment facts for the Settings page (mail transport, transactions, limits).
router.get('/system', requireAuth, systemStatus);
// Password reset. Rate-limited with the login limiter: both are unauthenticated
// endpoints that accept an email address and must not be brute-forceable.
router.post('/forgot-password', loginLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', loginLimiter, validate(resetPasswordSchema), resetPassword);
router.post('/logout', logout);
router.post('/logout-all', requireAuth, logoutEverywhere);

export default router;
