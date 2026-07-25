import { Router } from 'express';
import {
  login, me, logout, updateMe, forgotPassword, resetPassword, updateDigest,
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
// Password reset. Rate-limited with the login limiter: both are unauthenticated
// endpoints that accept an email address and must not be brute-forceable.
router.patch('/me/digest', requireAuth, validate(digestSchema), updateDigest);
router.post('/forgot-password', loginLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', loginLimiter, validate(resetPasswordSchema), resetPassword);
router.post('/logout', logout);

export default router;
