import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { Batch } from '../models/Batch.js';
import { enterTenant, enterUnscoped, runUnscoped } from '../tenancy/tenantContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, badRequest, notFound } from '../utils/ApiError.js';

/**
 * Decide which organization this request acts on, and enter it.
 *
 * THERE IS NO DEFAULT. The application enters no tenant context at the top of
 * the stack, so a route that reaches a model without passing through here
 * throws instead of running. That is the point: the dangerous failure is a
 * query that quietly runs across every tenant, and this turns it into an
 * immediate, loud one. A forgotten middleware becomes a 500 in a test rather
 * than another institution's feedback in a response.
 *
 * For a member (admin or trainer) the organization is read from their own
 * record — never from the request — so there is nothing for a client to
 * tamper with. A super admin has no organization of their own and must name
 * one per request; until they do they are unscoped, which is what lets the
 * platform-level views list every tenant.
 */
/**
 * Resolve — but deliberately do NOT enter — the tenant for this request.
 *
 * Entering has to happen in the caller, synchronously, immediately before
 * next(). AsyncLocalStorage.enterWith() binds the store to the CURRENT
 * execution context and its descendants; called inside this awaited function
 * it would bind to this function's context and be gone by the time the caller
 * resumes, leaving every downstream handler unscoped. That failure is
 * invisible in a test suite that sets an ambient fallback (the queries quietly
 * use the fallback and look right) and total in production, where there is no
 * fallback and every request throws.
 *
 * Returns the organization document, or null meaning "deliberately unscoped".
 */
export async function resolveTenantFor(req) {
  const user = req.user;
  if (!user) throw forbidden('Authentication required');

  if (user.role !== 'superadmin') {
    if (!user.organization) {
      /* A member with no organization cannot be scoped to anything, and
         running them unscoped would hand them the platform. Refuse. */
      throw forbidden('Your account is not attached to an organization.', 'NO_ORGANIZATION');
    }
    const org = await runUnscoped(() => Organization.findById(user.organization));
    if (!org || !org.isUsable()) {
      throw forbidden('This organization is suspended or no longer available.', 'ORG_UNAVAILABLE');
    }
    req.organization = org;
    return org;
  }

  /* Super admin. The organization picker sends its choice; "all" (or nothing)
     means the cross-organization view. */
  const raw = req.headers['x-organization'] || req.query.org;
  if (!raw || raw === 'all') {
    req.organization = null;
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(String(raw))) {
    throw badRequest(`"${raw}" is not a valid organization id`, 'BAD_ORGANIZATION');
  }
  const org = await runUnscoped(() => Organization.findById(raw));
  if (!org) throw notFound('Organization not found');

  req.organization = org;
  return org;
}

/**
 * Enter the resolved tenant. Separated from resolution so the caller can do
 * this synchronously on the path to next() — see the note on resolveTenantFor.
 */
export function enterResolvedTenant(org) {
  if (org) enterTenant(org._id);
  else enterUnscoped();
}

/** Express form, for anywhere that needs it as standalone middleware. */
export const resolveTenant = asyncHandler(async (req, _res, next) => {
  const org = await resolveTenantFor(req);
  enterResolvedTenant(org);
  next();
});

/**
 * The student flow carries no session, so the tenant comes from the batch
 * being answered — the one thing the request does identify. Looked up
 * unscoped by id, then the request is pinned to that batch's organization for
 * everything that follows, so a submission can only ever land in the tenant
 * that owns the cohort.
 */
export const resolvePublicTenant = asyncHandler(async (req, _res, next) => {
  const batchId = req.body?.batchId || req.params?.batchId || req.query?.batchId;
  if (!batchId || !mongoose.Types.ObjectId.isValid(String(batchId))) {
    throw badRequest('A valid batchId is required');
  }
  const batch = await runUnscoped(() =>
    Batch.findById(batchId).select('organization').lean()
  );
  if (!batch) throw notFound('Batch not found');

  // Entered here, synchronously before next() — same reason as above.
  enterTenant(batch.organization);
  return next();
});

/** Platform routes: only a super admin, and deliberately not tenant-scoped. */
export const requireSuperAdmin = (req, _res, next) => {
  if (req.user?.role !== 'superadmin') return next(forbidden('Insufficient permissions'));
  enterUnscoped();
  return next();
};
