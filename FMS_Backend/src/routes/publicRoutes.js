import { Router } from 'express';
import { validate } from '../utils/validate.js';
import { verifyPasscodeSchema, feedbackSubmitSchema } from '../utils/schemas.js';
import { verifyPasscode, submitFeedback } from '../controllers/publicController.js';

const router = Router();

// No auth. Rate limiting is applied where this router is mounted (app.js).
router.post('/verify-passcode', validate(verifyPasscodeSchema), verifyPasscode);
router.post('/feedback', validate(feedbackSubmitSchema), submitFeedback);

export default router;
