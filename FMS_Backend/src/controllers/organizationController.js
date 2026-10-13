import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { Feedback } from '../models/Feedback.js';
import { Parameter } from '../models/Parameter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { hashPassword, generateStrongPassword } from '../utils/password.js';
import { recordAudit } from '../services/auditService.js';
import { runWithTenant, runUnscoped } from '../tenancy/tenantContext.js';
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

const shape = (o, stats) => ({
  id: String(o._id),
  name: o.name,
  slug: o.slug,
  status: o.status,
  notes: o.notes || '',
  createdAt: o.createdAt,
  archivedAt: o.archivedAt || null,
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
  const { name, slug, adminName, adminEmail, notes } = req.body;

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

  const org = await Organization.create({
    name: String(name).trim(),
    slug: cleanSlug,
    notes: notes || '',
    createdBy: req.user._id,
  });

  /* A password nobody chose and nobody has reused, shown once and required to
     be replaced on first sign-in. The super admin passes it on out of band;
     it is never stored in readable form or emailed from here. */
  const tempPassword = generateStrongPassword();

  const admin = await runWithTenant(org._id, async () => {
    const created = await User.create({
      name: String(adminName).trim(),
      email,
      passwordHash: await hashPassword(tempPassword),
      role: 'admin',
      mustChangePassword: true,
    });
    // Seed the feedback parameters, or the student form has nothing to ask.
    await Parameter.insertMany(DEFAULT_PARAMETERS.map((label, i) => ({ label, order: i })));
    return created;
  });

  recordAudit(req, {
    action: 'organization.create',
    entity: 'organization',
    entityId: org._id,
    entityName: org.name,
    meta: { slug: org.slug, adminEmail: email },
  });

  res.status(201).json({
    organization: shape(org),
    admin: { id: String(admin._id), name: admin.name, email: admin.email },
    /* Returned exactly once. There is no endpoint that will show it again —
       the only recovery is a reset, which is the correct shape for a
       credential. */
    temporaryPassword: tempPassword,
  });
});

/** PATCH /api/v1/platform/organizations/:id */
export const updateOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) throw notFound('Organization not found');

  const { name, status, notes } = req.body;
  const before = { name: org.name, status: org.status };

  if (name !== undefined) org.name = String(name).trim();
  if (notes !== undefined) org.notes = notes;
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
    meta: { before, after: { name: org.name, status: org.status } },
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

  const tempPassword = generateStrongPassword();
  const admin = await runWithTenant(org._id, async () =>
    User.create({
      name: String(req.body.name).trim(),
      email,
      passwordHash: await hashPassword(tempPassword),
      role: 'admin',
      mustChangePassword: true,
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
    admin: { id: String(admin._id), name: admin.name, email: admin.email },
    temporaryPassword: tempPassword,
  });
});

/**
 * GET /api/v1/platform/overview — the platform dashboard.
 * Totals across every tenant, plus the per-organization breakdown that the
 * organization picker is built from.
 */
export const platformOverview = asyncHandler(async (_req, res) => {
  const [orgs, totalOrgs, suspended, users, responses, batches] = await Promise.all([
    Organization.find({ archivedAt: null }).select('name slug status').sort({ name: 1 }).lean(),
    Organization.countDocuments({ archivedAt: null }),
    Organization.countDocuments({ status: 'suspended', archivedAt: null }),
    User.countDocuments({ isActive: true, role: { $ne: 'superadmin' } }),
    Feedback.countDocuments({}),
    Batch.countDocuments({ archivedAt: null }),
  ]);

  res.json({
    kpis: { organizations: totalOrgs, suspended, users, responses, batches },
    organizations: orgs.map((o) => ({
      id: String(o._id),
      name: o.name,
      slug: o.slug,
      status: o.status,
    })),
  });
});
