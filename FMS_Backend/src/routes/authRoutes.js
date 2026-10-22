import { Router } from 'express';
import {
  login, me, logout, logoutEverywhere, updateMe, forgotPassword, resetPassword,
  updateDigest, systemStatus,  startTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  myOrganizations,
} from '../controllers/authController.js';
import { requireAuth, tenantOptional } from '../middleware/auth.js';
import { validate } from '../utils/validate.js';
import {
  loginSchema, updateMeSchema, forgotPasswordSchema, resetPasswordSchema, digestSchema,
} from '../utils/schemas.js';
import { loginLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), login);
router.get('/me', tenantOptional, requireAuth, me);
/* ACCOUNT ROUTES DO NOT NEED AN ORGANIZATION CHOSEN.
   
   Everything below is about the PERSON — their password, their second
   factor, their digest, signing out everywhere — and none of it belongs to
   an institution, so none of it should ask which one you are in.
   
   Only /me and /organizations had the exemption, and the gap deadlocked
   anybody who worked at two colleges and had been given a password by an
   admin: the client shows the change-password screen because they are
   locked, the change-password request demands a choice, and making that
   choice is a screen they cannot reach while locked. They could not get in
   at all, and nothing on screen said why.
   
   Data routes deliberately keep demanding the choice. Feedback belongs to an
   institution, so reading it has to say which. */
router.get('/organizations', tenantOptional, requireAuth, myOrganizations);
// Self-service account update (name / email / password) for both roles.
router.patch('/me', tenantOptional, requireAuth, validate(updateMeSchema), updateMe);
// Digest opt-in/out. Reachable from Settings for both roles — this endpoint
// existed for a while with no UI behind it, which meant the whole digest
// feature could never be switched on by anyone.
router.patch('/me/digest', tenantOptional, requireAuth, validate(digestSchema), updateDigest);
// Deployment facts for the Settings page (mail transport, transactions, limits).
router.get('/system', tenantOptional, requireAuth, systemStatus);

/* Enrolment is two steps on purpose — see startTwoFactor. */
router.post('/2fa/start', tenantOptional, requireAuth, startTwoFactor);
router.post('/2fa/enable', tenantOptional, requireAuth, enableTwoFactor);
router.post('/2fa/disable', tenantOptional, requireAuth, disableTwoFactor);
// Password reset. Rate-limited with the login limiter: both are unauthenticated
// endpoints that accept an email address and must not be brute-forceable.
router.post('/forgot-password', loginLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', loginLimiter, validate(resetPasswordSchema), resetPassword);
router.post('/logout', logout);
router.post('/logout-all', tenantOptional, requireAuth, logoutEverywhere);

export default router;
