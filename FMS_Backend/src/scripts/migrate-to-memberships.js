/**
 * Turn each user's single organization into a Membership row.
 *
 * Before this, where someone worked was a field on their account, so one
 * person could be at one institution. Membership makes it a row, which is
 * what allows a mentor to teach at two — and carries the role per
 * organization, since running one institution grants nothing at another.
 *
 * IDEMPOTENT. Re-running adopts only what has no row yet, so it is safe after
 * a partial failure or a later deploy. A dry run reports what it would do and
 * writes nothing.
 *
 *   node src/scripts/migrate-to-memberships.js --dry-run
 *   node src/scripts/migrate-to-memberships.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { isMain } from '../utils/isMain.js';

export async function migrateToMemberships({ dryRun = false } = {}) {
  return runUnscoped(async () => {
    const report = { dryRun, scanned: 0, created: 0, alreadyPresent: 0, skipped: [] };

    const users = await User.find({ role: { $ne: 'superadmin' } })
      .select('name email role organization')
      .lean();

    for (const u of users) {
      report.scanned += 1;

      /* The field is an array now, and a pre-migration document holds either
         a bare id or nothing. Both shapes are normalised here rather than
         assumed, because the one that is assumed is the one that is wrong. */
      const orgs = Array.isArray(u.organization)
        ? u.organization
        : u.organization
          ? [u.organization]
          : [];

      if (!orgs.length) {
        /* A member belonging nowhere cannot be given a membership, and
           guessing one would put a stranger inside somebody's institution. */
        report.skipped.push({ email: u.email, reason: 'no organization' });
        continue;
      }

      for (const organization of orgs) {
        const exists = await Membership.findOne({ user: u._id, organization }).lean();
        if (exists) {
          report.alreadyPresent += 1;
          continue;
        }
        report.created += 1;
        if (!dryRun) {
          await Membership.create({
            user: u._id,
            organization,
            /* The role they already had. Nobody gains or loses authority in a
               migration — that would be a permissions change disguised as a
               data change. */
            role: u.role === 'admin' ? 'admin' : 'trainer',
            isActive: true,
          });
        }
      }
    }

    return report;
  });
}

if (isMain(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGO_URI);
  const r = await migrateToMemberships({ dryRun });

  console.log(`\n${dryRun ? 'DRY RUN — nothing was written' : 'Migration complete'}\n`);
  console.log(`  accounts scanned     ${r.scanned}`);
  console.log(`  memberships created  ${r.created}`);
  console.log(`  already present      ${r.alreadyPresent}`);
  if (r.skipped.length) {
    console.log(`\n  skipped (${r.skipped.length}) — these accounts belong nowhere:`);
    for (const s of r.skipped) console.log(`    ${s.email}  (${s.reason})`);
  }
  await mongoose.disconnect();
}
