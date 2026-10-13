/**
 * Backfill the existing single-tenant data into one organization, and create
 * the platform's super admin.
 *
 * Everything that existed before multi-tenancy belongs to the institution that
 * was already using the product. This gives that data an owner so the tenant
 * filter — which fails closed — can see it at all; without the backfill every
 * existing row becomes invisible rather than shared, which is the safe
 * direction to fail but not a working application.
 *
 * IDEMPOTENT. Re-running adopts only rows that still have no organization and
 * leaves the rest alone, so it is safe to run again after a partial failure or
 * a later deploy. It reports what it would change before changing anything.
 *
 *   node src/scripts/migrate-to-organizations.js --dry-run
 *   node src/scripts/migrate-to-organizations.js --org="NCET" --slug=ncet \
 *        --superadmin=root@example.com
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Feedback } from '../models/Feedback.js';
import { Parameter } from '../models/Parameter.js';
import { Phase } from '../models/Phase.js';
import { AuditLog } from '../models/AuditLog.js';
import { DeviceLock } from '../models/DeviceLock.js';
import { hashPassword, generateStrongPassword } from '../utils/password.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { isMain } from '../utils/isMain.js';

const TENANT_MODELS = [
  ['users', User],
  ['classes', Class],
  ['batches', Batch],
  ['feedback', Feedback],
  ['parameters', Parameter],
  ['phases', Phase],
  ['audit log', AuditLog],
  ['device locks', DeviceLock],
];

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

export async function migrateToOrganizations({
  orgName = 'NCET',
  slug = 'ncet',
  superAdminEmail = null,
  dryRun = false,
} = {}) {
  /* The whole migration is unscoped: it exists precisely to create the
     organization that scoping will later depend on, so it cannot run inside
     one. */
  return runUnscoped(async () => {
    const report = { orgName, slug, adopted: {}, created: {}, dryRun };

    /* Count what is unowned BEFORE touching anything. These counts are the
       whole safety story — if a model reports more unowned rows than exist in
       total, something else is wrong and the operator should stop. */
    for (const [label, Model] of TENANT_MODELS) {
      const [orphan, total] = await Promise.all([
        Model.countDocuments({ organization: { $in: [null, undefined] } }),
        Model.countDocuments({}),
      ]);
      report.adopted[label] = { orphan, total };
    }

    let org = await Organization.findOne({ slug });
    report.created.organization = !org;
    if (!org && !dryRun) {
      org = await Organization.create({ name: orgName, slug });
    }

    if (!dryRun && org) {
      for (const [label, Model] of TENANT_MODELS) {
        const res = await Model.updateMany(
          { organization: { $in: [null, undefined] } },
          { $set: { organization: org._id } }
        );
        report.adopted[label].modified = res.modifiedCount;
      }

      /* A super admin belongs to no organization, so it is created AFTER the
         adoption sweep — otherwise the sweep would hand it one and silently
         demote it to a member of NCET. */
      if (superAdminEmail) {
        const email = superAdminEmail.toLowerCase().trim();
        const existing = await User.findOne({ email });
        if (existing) {
          existing.role = 'superadmin';
          existing.organization = null;
          await existing.save({ validateBeforeSave: false });
          report.created.superAdmin = { email, existing: true };
        } else {
          const password = generateStrongPassword();
          const doc = new User({
            name: 'Platform Administrator',
            email,
            passwordHash: await hashPassword(password),
            role: 'superadmin',
            organization: null,
            mustChangePassword: true,
          });
          await doc.save({ validateBeforeSave: false });
          report.created.superAdmin = { email, password, existing: false };
        }
      }
    }

    report.organizationId = org ? String(org._id) : null;
    return report;
  });
}

/* Executed only when run directly — importing this file must never migrate a
   database as a side effect. */
if (isMain(import.meta.url)) {
  const dryRun = has('dry-run');
  await mongoose.connect(process.env.MONGO_URI);
  const report = await migrateToOrganizations({
    orgName: arg('org', 'NCET'),
    slug: arg('slug', 'ncet'),
    superAdminEmail: arg('superadmin'),
    dryRun,
  });

  console.log(`\n${dryRun ? 'DRY RUN — nothing was written' : 'Migration complete'}\n`);
  console.log(`Organization: ${report.orgName} (${report.slug})  ${report.organizationId || '—'}`);
  console.log('\n  collection        unowned   total   adopted');
  for (const [label, c] of Object.entries(report.adopted)) {
    console.log(
      `  ${label.padEnd(16)} ${String(c.orphan).padStart(7)} ${String(c.total).padStart(7)}` +
        `   ${c.modified === undefined ? '—' : c.modified}`
    );
  }
  if (report.created.superAdmin) {
    const sa = report.created.superAdmin;
    console.log(`\nSuper admin: ${sa.email}`);
    if (sa.password) console.log(`Temporary password: ${sa.password}   (must be changed at first sign-in)`);
    else console.log('(existing account promoted — its password is unchanged)');
  }
  await mongoose.disconnect();
}
