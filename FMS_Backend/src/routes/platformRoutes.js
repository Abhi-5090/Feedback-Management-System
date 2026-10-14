import { Router } from 'express';
import { requireAuth, requirePasswordChanged } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';
import { validate } from '../utils/validate.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  addOrgAdminSchema,
} from '../utils/schemas.js';
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  addOrganizationAdmin,
  platformOverview,
  getOrganization,
  resetAdminPassword,
  exportOrganization,
  deleteOrganization,
} from '../controllers/organizationController.js';

/**
 * Platform administration — the only routes in the product that see across
 * organizations.
 *
 * requireSuperAdmin both checks the role and enters the unscoped context, so
 * the two cannot come apart: there is no way to reach these handlers with a
 * tenant filter still applied, and no way to reach them without the role.
 */
const router = Router();

router.use(requireAuth, requirePasswordChanged, requireSuperAdmin);

router.get('/overview', platformOverview);
router.get('/organizations', listOrganizations);
router.post('/organizations', validate(createOrganizationSchema), createOrganization);
router.patch('/organizations/:id', validate(updateOrganizationSchema), updateOrganization);
router.get('/organizations/:id', getOrganization);
router.post('/organizations/:id/admins', validate(addOrgAdminSchema), addOrganizationAdmin);
router.post('/organizations/:id/admins/:userId/reset-password', resetAdminPassword);
router.get('/organizations/:id/export', exportOrganization);
/* Permanent, and gated on the organization already being suspended plus the
   handle typed back — see the controller for why both. */
router.delete('/organizations/:id', deleteOrganization);

export default router;
