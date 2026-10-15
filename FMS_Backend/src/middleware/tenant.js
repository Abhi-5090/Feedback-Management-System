import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { Batch } from '../models/Batch.js';
import { enterTenant, enterUnscoped, runUnscoped } from '../tenancy/tenantContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { membershipsFor } from '../services/membershipService.js';
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

  if (user.role === 'superadmin') {
    /* A super admin belongs to no organization and names one per request.
       Nothing until they do, which is what lets the platform views see
       across tenants. */
    const raw = req.headers['x-organization'] || req.query.org;
    if (!raw || raw === 'all') {
      req.organization = null;
      req.membershipRole = null;
      return null;
    }
    if (!mongoose.Types.ObjectId.isValid(String(raw))) {
      throw badRequest(`"${raw}" is not a valid organization id`, 'BAD_ORGANIZATION');
    }
    const org = await runUnscoped(() => Organization.findById(raw));
    if (!org) throw notFound('Organization not found');
    req.organization = org;
    /* Acting as an administrator of whichever tenant they opened, without a
       membership row — the platform role is what grants it. */
    req.membershipRole = 'admin';
    return org;
  }

  /* A MEMBER NAMES THEIR ORGANIZATION TOO, now that one person can be in
     several. The header is a request from the client and is therefore
     checked against their memberships rather than trusted: naming an
     organization you do not belong to must fail, not succeed quietly. */
  const memberships = await membershipsFor(user._id);
  if (!memberships.length) {
    throw forbidden('Your account is not attached to an organization.', 'NO_ORGANIZATION');
  }

  const asked = String(req.headers['x-organization'] || req.query.org || '').trim();
  let chosen;
  if (asked && asked !== 'all') {
    chosen = memberships.find((m) => m.id === asked);
    if (!chosen) {
      /* Deliberately the same answer as "no such organization". Telling
         somebody that an id is real but not theirs confirms its existence to
         an account with no business knowing. */
      throw forbidden('You are not a member of that organization.', 'NOT_A_MEMBER');
    }
  } else if (memberships.length === 1) {
    /* One membership needs no choosing. Making the single-organization case
       pick from a list of one would be ceremony for the overwhelming
       majority of people. */
    [chosen] = memberships;
  } else {
    /* Several, and none named. There is no safe default — picking one would
       show figures from an institution they did not ask about, under a
       heading that does not say so. The client sends them to the picker. */
    req.organization = null;
    req.membershipRole = null;
    req.memberships = memberships;
    throw badRequest(
      'Choose which organization you are working in.',
      'ORGANIZATION_CHOICE_REQUIRED'
    );
  }

  const org = await runUnscoped(() => Organization.findById(chosen.id));
  if (!org || !org.isUsable()) {
    throw forbidden('This organization is suspended or no longer available.', 'ORG_UNAVAILABLE');
  }

  req.organization = org;
  /* Authoritative for permissions. Never user.role: somebody who administers
     one institution has no standing in another unless a membership says so. */
  req.membershipRole = chosen.role;
  req.memberships = memberships;
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
