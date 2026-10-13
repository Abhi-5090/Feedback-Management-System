import { Router } from 'express';
import { validate } from '../utils/validate.js';
import { verifyPasscodeSchema, feedbackSubmitSchema } from '../utils/schemas.js';
import { verifyPasscode, submitFeedback } from '../controllers/publicController.js';
import { resolvePublicTenant } from '../middleware/tenant.js';

const router = Router();

// No auth. Rate limiting is applied where this router is mounted (app.js).
/* The student carries no session, so the batch being answered is what names
   the tenant. Resolved before the handler runs, so a submission can only land
   in the organization that owns that cohort. */
router.post('/verify-passcode', validate(verifyPasscodeSchema), resolvePublicTenant, verifyPasscode);
router.post('/feedback', validate(feedbackSubmitSchema), resolvePublicTenant, submitFeedback);

export default router;
