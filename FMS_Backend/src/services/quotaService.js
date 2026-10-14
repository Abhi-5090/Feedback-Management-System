import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { badRequest } from '../utils/ApiError.js';

/**
 * What a tenant may create, and how close it is to the ceiling.
 *
 * These are not a billing construct. They bound blast radius: one institution
 * importing a malformed spreadsheet of fifty thousand mentors degrades the
 * cluster for every other institution on it, and the people who suffer are
 * not the ones who made the mistake. A limit turns a shared outage into an
 * error message addressed to the person who can fix it.
 *
 * Checked at the moment of creation rather than enforced by a database
 * constraint, because the useful version of this is a sentence explaining
 * which ceiling was reached and what it is — not a write that fails.
 */
const COUNTERS = {
  maxUsers: { label: 'people', Model: User, filter: { isActive: true } },
  maxClasses: { label: 'subjects', Model: Class, filter: { archivedAt: null } },
  maxBatches: { label: 'cohorts', Model: Batch, filter: { archivedAt: null } },
};

const limitsFor = async (organizationId) => {
  const org = await runUnscoped(() => Organization.findById(organizationId).select('limits').lean());
  return {
    maxUsers: org?.limits?.maxUsers ?? 500,
    maxClasses: org?.limits?.maxClasses ?? 200,
    maxBatches: org?.limits?.maxBatches ?? 500,
  };
};

/** Current usage against each ceiling, for the settings screen. */
export async function quotaUsage(organizationId) {
  const limits = await limitsFor(organizationId);
  const out = {};
  for (const [key, { label, Model, filter }] of Object.entries(COUNTERS)) {
    const used = await Model.countDocuments({ organization: organizationId, ...filter });
    const limit = limits[key];
    out[key] = {
      label,
      used,
      limit,
      unlimited: limit === 0,
      /* Null rather than 0 when unlimited: a progress bar at 0% reads as
         "nothing used", which is the opposite of what no limit means. */
      pct: limit === 0 ? null : Math.min(100, Math.round((used / limit) * 100)),
    };
  }
  return out;
}

/**
 * Refuse a creation that would cross a ceiling.
 *
 * `adding` is how many the caller is about to create, so a bulk import of 400
 * mentors into a tenant with 150 headroom is refused ONCE with a number the
 * admin can act on, rather than importing 150 and failing partway — which
 * leaves the spreadsheet and the database disagreeing about what happened.
 */
export async function assertWithinQuota(organizationId, key, adding = 1) {
  const spec = COUNTERS[key];
  if (!spec) return;
  const limits = await limitsFor(organizationId);
  const limit = limits[key];
  if (!limit) return; // 0 means deliberately unlimited

  const used = await spec.Model.countDocuments({ organization: organizationId, ...spec.filter });
  if (used + adding <= limit) return;

  const room = Math.max(0, limit - used);
  throw badRequest(
    adding === 1
      ? `This organization has reached its limit of ${limit} ${spec.label}.`
      : `Adding ${adding} ${spec.label} would exceed the limit of ${limit}. There is room for ${room}.`,
    'QUOTA_EXCEEDED'
  );
}
