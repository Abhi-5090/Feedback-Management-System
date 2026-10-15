import { Membership } from '../models/Membership.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { runUnscoped, runWithTenant } from '../tenancy/tenantContext.js';

/**
 * Where one person works, and as what.
 *
 * Read UNSCOPED on purpose: the question "which organizations is this person
 * in" spans tenants by definition, and it is the question the sign-in flow
 * has to answer before any tenant has been chosen. It is only ever asked
 * about the caller's own account.
 */
export async function membershipsFor(userId) {
  const rows = await runUnscoped(() =>
    Membership.find({ user: userId, isActive: true }).select('organization role').lean()
  );
  if (!rows.length) return [];

  const orgs = await runUnscoped(() =>
    Organization.find({ _id: { $in: rows.map((r) => r.organization) }, archivedAt: null })
      .select('name slug status settings')
      .lean()
  );
  const byId = new Map(orgs.map((o) => [String(o._id), o]));

  return rows
    .map((r) => {
      const org = byId.get(String(r.organization));
      if (!org) return null; // organization deleted out from under the row
      return {
        id: String(org._id),
        name: org.name,
        slug: org.slug,
        status: org.status,
        role: r.role,
        timezone: org.settings?.timezone || 'Asia/Kolkata',
      };
    })
    .filter(Boolean)
    /* Suspended institutions sort last rather than being hidden: a mentor who
       cannot get in needs to see WHY, not watch an organization disappear. */
    .sort((a, b) => {
      if ((a.status === 'suspended') !== (b.status === 'suspended')) {
        return a.status === 'suspended' ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
}

/** The caller's role in one organization, or null if they are not in it. */
export async function roleIn(userId, organizationId) {
  const row = await runUnscoped(() =>
    Membership.findOne({ user: userId, organization: organizationId, isActive: true })
      .select('role')
      .lean()
  );
  return row?.role || null;
}

/**
 * Add someone to an organization, or re-activate them if they were removed.
 *
 * Idempotent by the unique index rather than by checking first: two admins
 * adding the same person at once would both pass a check-then-insert, and the
 * duplicate makes every count in the product wrong from then on.
 */
export async function addMember({ organizationId, userId, role, invitedBy }) {
  return runWithTenant(organizationId, () =>
    Membership.findOneAndUpdate(
      { organization: organizationId, user: userId },
      { $set: { role, isActive: true }, $setOnInsert: { invitedBy } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  );
}

/** Everyone in one organization, with their identity attached. */
export async function membersOf(organizationId, { role } = {}) {
  const filter = { organization: organizationId, isActive: true };
  if (role) filter.role = role;

  const rows = await runWithTenant(organizationId, () =>
    Membership.find(filter).select('user role createdAt').lean()
  );
  if (!rows.length) return [];

  const users = await runUnscoped(() =>
    User.find({ _id: { $in: rows.map((r) => r.user) } })
      .select('name email shortName isActive mustChangePassword')
      .lean()
  );
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return rows
    .map((r) => {
      const u = byId.get(String(r.user));
      return u
        ? {
            id: String(u._id),
            membershipId: String(r._id),
            name: u.name,
            email: u.email,
            shortName: u.shortName || '',
            role: r.role,
            isActive: u.isActive,
            pendingFirstSignIn: Boolean(u.mustChangePassword),
            joinedAt: r.createdAt,
          }
        : null;
    })
    .filter(Boolean);
}
