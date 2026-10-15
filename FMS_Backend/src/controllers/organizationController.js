import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { Feedback } from '../models/Feedback.js';
import { Parameter } from '../models/Parameter.js';
import { Phase } from '../models/Phase.js';
import { AuditLog } from '../models/AuditLog.js';
import { DeviceLock } from '../models/DeviceLock.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import {
  hashPassword,
  generateStrongPassword,
  validatePasswordStrength,
} from '../utils/password.js';
import { recordAudit } from '../services/auditService.js';
import { runWithTenant, runUnscoped } from '../tenancy/tenantContext.js';
import { quotaUsage } from '../services/quotaService.js';
import { DEFAULT_PARAMETERS } from '../config/defaultParameters.js';


/**
 * Platform administration: the organizations themselves.
 *
 * Every handler here runs UNSCOPED — these are the only routes in the product
 * that legitimately see across tenants, which is why they are gated on
 * requireSuperAdmin and kept in their own file rather than mixed into the
 * admin controllers. Writes into a specific organization are wrapped in
 * runWithTenant so the rows they create are owned correctly.
 */


/**
 * The password a new admin starts with.
 *
 * Either the operator types one — which is what makes handing an account over
 * a single conversation rather than a copied secret — or one is generated and
 * shown once. A typed password is checked against the same strength rules the
 * rest of the product uses; a platform operator in a hurry is exactly who
 * would otherwise set "password123" on an account that owns an institution's
 * entire feedback history.
 */
function resolveInitialPassword({ password, name, email }) {
  if (!password) return { plain: generateStrongPassword(), generated: true };
  const problem = validatePasswordStrength(password, { name, email });
  if (problem) throw badRequest(problem, 'WEAK_PASSWORD');
  return { plain: password, generated: false };
}

const shape = (o, stats) => ({
  id: String(o._id),
  name: o.name,
  slug: o.slug,
  status: o.status,
  notes: o.notes || '',
  createdAt: o.createdAt,
  archivedAt: o.archivedAt || null,
  limits: {
    maxUsers: o.limits?.maxUsers ?? 500,
    maxClasses: o.limits?.maxClasses ?? 200,
    maxBatches: o.limits?.maxBatches ?? 500,
  },
  settings: {
    timezone: o.settings?.timezone || 'Asia/Kolkata',
    displayName: o.settings?.displayName || '',
    weekStartsOn: o.settings?.weekStartsOn || 'monday',
  },
  ...(stats || {}),
});

/** GET /api/v1/platform/organizations — every tenant, with its size. */
export const listOrganizations = asyncHandler(async (req, res) => {
  const orgs = await Organization.find({ archivedAt: null }).sort({ name: 1 }).lean();
  const ids = orgs.map((o) => o._id);

  /* One grouped pass per collection rather than four queries per organization
     — with twenty tenants that is the difference between 5 round trips and
     80. Counted unscoped on purpose: this is the cross-tenant view. */
  const countBy = async (Model, extra = {}) => {
    const rows = await Model.aggregate([
      { $match: { organization: { $in: ids }, ...extra } },
      { $group: { _id: '$organization', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  };

  const [admins, trainers, classes, batches, responses] = await Promise.all([
    countBy(User, { role: 'admin', isActive: true }),
    countBy(User, { role: 'trainer', isActive: true }),
    countBy(Class, { archivedAt: null }),
    countBy(Batch, { archivedAt: null }),
    countBy(Feedback),
  ]);

  res.json({
    organizations: orgs.map((o) =>
      shape(o, {
        admins: admins.get(String(o._id)) || 0,
        trainers: trainers.get(String(o._id)) || 0,
        classes: classes.get(String(o._id)) || 0,
        batches: batches.get(String(o._id)) || 0,
        responses: responses.get(String(o._id)) || 0,
      })
    ),
  });
});

/**
 * POST /api/v1/platform/organizations
 * Creates the tenant, its first admin, and its feedback parameters together.
 *
 * All three in one call deliberately. An organization with no admin cannot be
 * entered, and one with no parameters cannot take feedback — a student would
 * meet an empty form. Creating them separately means every one of those
 * states is reachable and someone eventually ships one.
 */
export const createOrganization = asyncHandler(async (req, res) => {
  const { name, slug, adminName, adminEmail, notes, adminPassword, requirePasswordChange } =
    req.body;

  const email = String(adminEmail || '').toLowerCase().trim();
  const cleanSlug = String(slug || '').toLowerCase().trim();

  const [slugTaken, emailTaken] = await Promise.all([
    Organization.findOne({ slug: cleanSlug }).lean(),
    User.findOne({ email }).lean(),
  ]);
  if (slugTaken) throw conflict(`The handle "${cleanSlug}" is already in use`, 'SLUG_TAKEN');
  /* Email is unique across the PLATFORM, not per tenant — sign-in resolves an
     account from an address alone, so the same address in two organizations
     would leave the login form with no way to choose. */
  if (emailTaken) throw conflict(`${email} already has an account`, 'EMAIL_TAKEN');

  /* THE PASSWORD IS SETTLED BEFORE ANYTHING IS WRITTEN. Validating it after
     creating the organization left a tenant with no admin behind every
     rejected password — an organization nobody can enter, which is exactly
     the broken state creating these three things together is meant to
     prevent. Cheap checks first, writes second. */
  const { plain, generated } = resolveInitialPassword({
    password: adminPassword,
    name: adminName,
    email,
  });

  const org = await Organization.create({
    name: String(name).trim(),
    slug: cleanSlug,
    notes: notes || '',
    createdBy: req.user._id,
  });

  let admin;
  try {
    admin = await runWithTenant(org._id, async () => {
      const created = await User.create({
        name: String(adminName).trim(),
        email,
        passwordHash: await hashPassword(plain),
        role: 'admin',
        mustChangePassword: requirePasswordChange !== false,
      });
      /* The membership is what actually lets them in. Creating the account
         without one makes a person who exists and belongs nowhere — able to
         sign in and reach nothing, with no error that explains why. */
      await Membership.create({ user: created._id, role: 'admin', invitedBy: req.user?._id });
      // Seed the feedback parameters, or the student form has nothing to ask.
      await Parameter.insertMany(DEFAULT_PARAMETERS.map((label, i) => ({ label, order: i })));
      return created;
    });
  } catch (err) {
    /* Unwind rather than leave an organization nobody can enter. These three
       writes are not in one transaction because they span collections on a
       deployment that may be a standalone mongod, so the cleanup is explicit.
       It is best-effort: if it fails too, the original error is still what the
       caller needs to see. */
    await Organization.deleteOne({ _id: org._id }).catch(() => {});
    await runWithTenant(org._id, async () => {
      await User.deleteMany({ organization: org._id }).catch(() => {});
      await Parameter.deleteMany({ organization: org._id }).catch(() => {});
    }).catch(() => {});
    throw err;
  }

  recordAudit(req, {
    action: 'organization.create',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { slug: org.slug, adminEmail: email },
  });

  res.status(201).json({
    organization: shape(org),
    admin: {
      id: String(admin._id),
      name: admin.name,
      email: admin.email,
      mustChangePassword: admin.mustChangePassword,
    },
    /* Returned ONLY when this end generated it. Echoing back a password the
       operator typed puts a secret they already hold into a response body, a
       log and a browser's memory for nothing. */
    ...(generated ? { temporaryPassword: plain } : {}),
  });
});

/** PATCH /api/v1/platform/organizations/:id */
export const updateOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) throw notFound('Organization not found');

  const { name, status, notes, settings, limits } = req.body;
  const before = { name: org.name, status: org.status, settings: { ...org.settings } };

  if (name !== undefined) org.name = String(name).trim();
  if (notes !== undefined) org.notes = notes;
  if (limits) {
    org.limits = { ...(org.limits?.toObject?.() ?? org.limits ?? {}), ...limits };
  }
  if (settings) {
    /* Merged, not replaced: a client sending only a timezone must not reset
       the other settings to their defaults as a side effect. */
    org.settings = { ...(org.settings?.toObject?.() ?? org.settings ?? {}), ...settings };
  }
  if (status !== undefined) {
    if (!['active', 'suspended'].includes(status)) throw badRequest('Unknown status');
    org.status = status;
  }
  await org.save();

  recordAudit(req, {
    action: 'organization.update',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { before, after: { name: org.name, status: org.status, settings: { ...org.settings } } },
  });

  res.json({ organization: shape(org) });
});

/**
 * POST /api/v1/platform/organizations/:id/admins
 * Add another admin to an existing organization.
 */
export const addOrganizationAdmin = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) throw notFound('Organization not found');

  const email = String(req.body.email || '').toLowerCase().trim();
  if (await User.findOne({ email }).lean()) {
    throw conflict(`${email} already has an account`, 'EMAIL_TAKEN');
  }

  const { plain, generated } = resolveInitialPassword({
    password: req.body.password,
    name: req.body.name,
    email,
  });
  const admin = await runWithTenant(org._id, async () =>
    User.create({
      name: String(req.body.name).trim(),
      email,
      passwordHash: await hashPassword(plain),
      role: 'admin',
      mustChangePassword: req.body.requirePasswordChange !== false,
    }).then(async (created) => {
      await Membership.create({ user: created._id, role: 'admin', invitedBy: req.user?._id });
      return created;
    })
  );

  recordAudit(req, {
    action: 'organization.admin.create',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { adminEmail: email },
  });

  res.status(201).json({
    admin: {
      id: String(admin._id),
      name: admin.name,
      email: admin.email,
      mustChangePassword: admin.mustChangePassword,
    },
    ...(generated ? { temporaryPassword: plain } : {}),
  });
});

/**
 * GET /api/v1/platform/organizations/:id — one tenant in full.
 *
 * Its people as well as its size, because the question a platform operator
 * actually arrives with is "who can get into this one, and should they still
 * be able to" — and that is not answerable from a row in a list.
 */
export const getOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id).lean();
  if (!org) throw notFound('Organization not found');

  const [people, classes, batches, responses, lastResponse] = await Promise.all([
    User.find({ organization: org._id })
      .select('name email role isActive mustChangePassword createdAt')
      .sort({ role: 1, name: 1 })
      .lean(),
    Class.countDocuments({ organization: org._id, archivedAt: null }),
    Batch.countDocuments({ organization: org._id, archivedAt: null }),
    Feedback.countDocuments({ organization: org._id }),
    Feedback.findOne({ organization: org._id }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);

  const shapePerson = (u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    /* Surfaced because an admin who has never signed in is the commonest
       reason an organization looks set up and is not. */
    pendingFirstSignIn: Boolean(u.mustChangePassword),
    createdAt: u.createdAt,
  });

  const quota = await runWithTenant(org._id, () => quotaUsage(org._id));

  res.json({
    quota,
    organization: shape(org, {
      classes,
      batches,
      responses,
      admins: people.filter((u) => u.role === 'admin').length,
      trainers: people.filter((u) => u.role === 'trainer').length,
      lastResponseAt: lastResponse?.createdAt || null,
    }),
    admins: people.filter((u) => u.role === 'admin').map(shapePerson),
    trainers: people.filter((u) => u.role === 'trainer').map(shapePerson),
  });
});

/**
 * POST /api/v1/platform/organizations/:id/admins/:userId/reset-password
 *
 * Issues a fresh one-time password for an admin who has lost theirs. The old
 * one stops working immediately, and every session signed in with it is
 * revoked — a password being reissued usually means somebody could not get in,
 * and occasionally means somebody got in who should not have.
 */
export const resetAdminPassword = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) throw notFound('Organization not found');

  const user = await User.findOne({ _id: req.params.userId, organization: org._id });
  if (!user) throw notFound('That admin is not in this organization');
  if (user.role !== 'admin') throw badRequest('Only an organization admin can be reset here');

  const tempPassword = generateStrongPassword();
  user.passwordHash = await hashPassword(tempPassword);
  user.mustChangePassword = true;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out existing sessions
  await user.save();

  recordAudit(req, {
    action: 'organization.admin.reset_password',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { adminEmail: user.email },
  });

  res.json({ admin: { id: String(user._id), name: user.name, email: user.email }, temporaryPassword: tempPassword });
});


/* Every collection that belongs to a tenant, in the order a human would read
   them back: the shape of the institution first, then what students said. */
const TENANT_COLLECTIONS = [
  ['organization', null],
  ['users', User],
  ['classes', Class],
  ['batches', Batch],
  ['parameters', Parameter],
  ['phases', Phase],
  ['feedback', Feedback],
  ['auditLog', AuditLog],
];

/**
 * GET /api/v1/platform/organizations/:id/export
 *
 * Everything one organization owns, as a single JSON document.
 *
 * An institution that leaves has a right to its data, and the people who run
 * it are the ones who will need it — so this is a plain, readable archive
 * rather than a database dump that only this application can open. It is also
 * the thing that makes deletion safe to offer at all: a delete with no way to
 * take a copy first is a delete nobody should ever be asked to confirm.
 *
 * Password hashes are stripped. They are useless to the recipient, they are
 * the one field whose leak compounds across every other system those people
 * use, and an export is the likeliest copy of this data to end up on someone's
 * laptop.
 */
export const exportOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id).lean();
  if (!org) throw notFound('Organization not found');

  const archive = {
    exportedAt: new Date().toISOString(),
    exportedBy: req.user?.email || 'unknown',
    organization: {
      id: String(org._id),
      name: org.name,
      slug: org.slug,
      status: org.status,
      createdAt: org.createdAt,
    },
    counts: {},
    data: {},
  };

  await runWithTenant(org._id, async () => {
    for (const [key, Model] of TENANT_COLLECTIONS) {
      if (!Model) continue;
      const rows = await Model.find({}).lean();
      archive.data[key] = rows.map((r) => {
        if (Model !== User) return r;
        /* eslint-disable-next-line no-unused-vars */
        const { passwordHash, tokenVersion, ...safe } = r;
        return safe;
      });
      archive.counts[key] = rows.length;
    }
  });

  recordAudit(req, {
    action: 'organization.export',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { counts: archive.counts },
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${org.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(archive, null, 2));
});

/**
 * DELETE /api/v1/platform/organizations/:id
 *
 * Permanent removal of a tenant and everything in it.
 *
 * THREE GATES, because this is the one action in the product that cannot be
 * undone and destroys other people's data:
 *
 *   1. the organization must already be SUSPENDED — so removal is always a
 *      second, deliberate decision taken after access was cut, never the
 *      first thing a misclick can reach;
 *   2. the caller must type the handle back, which is the difference between
 *      confirming and acknowledging;
 *   3. what was destroyed is recorded BEFORE destroying it, since afterwards
 *      there is nothing left to count.
 *
 * The audit entry survives deliberately: it belongs to the platform, not to
 * the tenant, so the record of what happened outlives what it happened to.
 */
export const deleteOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) throw notFound('Organization not found');

  if (org.status !== 'suspended') {
    throw badRequest(
      'Suspend the organization before deleting it. Deletion is permanent, so it is deliberately a second step.',
      'SUSPEND_FIRST'
    );
  }
  if (String(req.body?.confirm || '').trim().toLowerCase() !== org.slug) {
    throw badRequest(`Type the handle "${org.slug}" to confirm.`, 'CONFIRM_REQUIRED');
  }

  const removed = {};
  await runWithTenant(org._id, async () => {
    for (const [key, Model] of TENANT_COLLECTIONS) {
      if (!Model) continue;
      removed[key] = await Model.countDocuments({});
    }
    // DeviceLock is scoped too, and belongs to the tenant's collection windows.
    removed.deviceLocks = await DeviceLock.countDocuments({});
    for (const [, Model] of TENANT_COLLECTIONS) {
      if (Model && Model !== AuditLog) await Model.deleteMany({});
    }
    await DeviceLock.deleteMany({});
  });

  /* The audit rows are removed LAST and unscoped, after the entry recording
     this deletion has been written — otherwise the act of deleting erases its
     own evidence. */
  recordAudit(req, {
    action: 'organization.delete',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { slug: org.slug, removed },
  });

  await runWithTenant(org._id, () => AuditLog.deleteMany({ organization: org._id }));
  await Organization.deleteOne({ _id: org._id });

  res.json({ deleted: true, organization: { name: org.name, slug: org.slug }, removed });
});

/**
 * GET /api/v1/platform/overview — the platform dashboard.
 * Totals across every tenant, plus the per-organization breakdown that the
 * organization picker is built from.
 */
export const platformOverview = asyncHandler(async (_req, res) => {
  const [orgs, suspended] = await Promise.all([
    Organization.find({ archivedAt: null }).select('name slug status createdAt').sort({ name: 1 }).lean(),
    Organization.countDocuments({ status: 'suspended', archivedAt: null }),
  ]);
  const ids = orgs.map((o) => o._id);

  /* One grouped pass per collection rather than four queries per tenant: at
     twenty organizations that is the difference between 5 round trips and 80.
     Counted unscoped deliberately — this is the one view that sees across. */
  const groupBy = async (Model, extra = {}, stage = null) => {
    const rows = await Model.aggregate([
      { $match: { organization: { $in: ids }, ...extra } },
      stage || { $group: { _id: '$organization', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r]));
  };

  const THIRTY_DAYS = new Date(Date.now() - 30 * 86400_000);

  const [people, classes, batches, openBatches, responses, recent, quality] = await Promise.all([
    groupBy(User, { isActive: true, role: { $ne: 'superadmin' } }),
    groupBy(Class, { archivedAt: null }),
    groupBy(Batch, { archivedAt: null }),
    groupBy(Batch, { status: 'open', archivedAt: null }),
    groupBy(Feedback),
    groupBy(Feedback, { createdAt: { $gte: THIRTY_DAYS } }),
    /* Average star and last activity in one pass. A tenant's health is not
       how much data it holds — a big dormant customer is the one about to
       leave — so recency sits beside volume rather than under it. */
    Feedback.aggregate([
      { $match: { organization: { $in: ids } } },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: '$organization',
          starSum: { $sum: '$ratings.stars' },
          starCount: { $sum: 1 },
          lastAt: { $max: '$createdAt' },
        },
      },
    ]).then((rows) => new Map(rows.map((r) => [String(r._id), r]))),
  ]);

  const n = (map, id) => map.get(String(id))?.n || 0;

  const organizations = orgs.map((o) => {
    const id = String(o._id);
    const q = quality.get(id);
    const lastAt = q?.lastAt || null;
    const daysSince = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400_000) : null;

    /* Three states, because they call for three different actions: a customer
       still collecting needs nothing, one that has gone quiet is worth a
       conversation, and one that never started was never onboarded. The
       difference matters more than any count on this page. */
    const health =
      n(responses, o._id) === 0 ? 'never-used' : daysSince !== null && daysSince <= 45 ? 'active' : 'dormant';

    return {
      id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      createdAt: o.createdAt,
      people: n(people, o._id),
      classes: n(classes, o._id),
      batches: n(batches, o._id),
      openBatches: n(openBatches, o._id),
      responses: n(responses, o._id),
      responsesLast30: n(recent, o._id),
      averageRating: q?.starCount ? Math.round((q.starSum / q.starCount) * 100) / 100 : null,
      lastResponseAt: lastAt,
      daysSinceLastResponse: daysSince,
      health,
    };
  });

  const sum = (key) => organizations.reduce((t, o) => t + (o[key] || 0), 0);

  res.json({
    kpis: {
      organizations: orgs.length,
      suspended,
      /* Counted here rather than summed from the rows so the headline cannot
         drift from what the table beneath it says. */
      users: sum('people'),
      batches: sum('batches'),
      openBatches: sum('openBatches'),
      responses: sum('responses'),
      responsesLast30: sum('responsesLast30'),
      dormant: organizations.filter((o) => o.health === 'dormant').length,
      neverUsed: organizations.filter((o) => o.health === 'never-used').length,
    },
    organizations,
  });
});
