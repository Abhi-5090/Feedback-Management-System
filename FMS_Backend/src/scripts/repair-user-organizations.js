/**
 * Make every user's tenant list agree with their memberships.
 *
 * TWO FAULTS, ONE REPAIR.
 *
 * The first is a shape problem. Before multi-membership, `organization` held
 * a single id; it is a list now, but the documents written under the old
 * shape still hold a bare id. `$addToSet` refuses to touch a non-array —
 * "Cannot apply $addToSet to non-array field" — so adding one of those people
 * to a second institution fails at exactly the step that matters.
 *
 * The second is drift. A membership can exist while the list does not mention
 * its organization, which is the worse of the two: the person IS a member,
 * and every scoped query filters on the list, so they join an institution and
 * remain invisible to it. Nothing errors. They simply are not there.
 *
 * The repair treats MEMBERSHIPS AS THE TRUTH and rebuilds the list from them.
 * That direction is deliberate: a membership row is what an admin created on
 * purpose, while the list is a denormalised index that exists to make scoped
 * queries cheap. When a cache and its source disagree, the source wins.
 *
 *   node src/scripts/repair-user-organizations.js --dry-run
 *   node src/scripts/repair-user-organizations.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { runUnscoped } from '../tenancy/tenantContext.js';
import { isMain } from '../utils/isMain.js';

export async function repairUserOrganizations({ dryRun = false } = {}) {
  return runUnscoped(async () => {
    const report = { scanned: 0, reshaped: 0, gained: 0, pruned: 0, unchanged: 0, details: [] };

    const users = await User.find({ role: { $ne: 'superadmin' } })
      .select('name email organization')
      .lean();

    for (const u of users) {
      report.scanned += 1;

      const rows = await Membership.find({ user: u._id, isActive: true })
        .select('organization')
        .lean();
      const should = [...new Set(rows.map((r) => String(r.organization)))].sort();

      const wasArray = Array.isArray(u.organization);
      const current = (wasArray ? u.organization : u.organization ? [u.organization] : [])
        .map(String)
        .sort();

      const gained = should.filter((id) => !current.includes(id));
      const pruned = current.filter((id) => !should.includes(id));
      const sameSet = gained.length === 0 && pruned.length === 0;

      if (sameSet && wasArray) {
        report.unchanged += 1;
        continue;
      }

      if (!wasArray) report.reshaped += 1;
      if (gained.length) report.gained += gained.length;
      if (pruned.length) report.pruned += pruned.length;

      report.details.push({
        email: u.email,
        reshaped: !wasArray,
        gained: gained.length,
        pruned: pruned.length,
      });

      if (!dryRun) {
        /* $set, not $addToSet: the field may still be a scalar, and the whole
           point is to replace it with the list the memberships describe. */
        await User.updateOne(
          { _id: u._id },
          { $set: { organization: should.map((id) => new mongoose.Types.ObjectId(id)) } }
        );
      }
    }

    return report;
  });
}

if (isMain(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGO_URI);
  const r = await repairUserOrganizations({ dryRun });

  console.log(`\n${dryRun ? 'DRY RUN — nothing was written' : 'Repair complete'}\n`);
  console.log(`  accounts scanned        ${r.scanned}`);
  console.log(`  reshaped to a list      ${r.reshaped}`);
  console.log(`  organizations restored  ${r.gained}   (membership existed, list did not say so)`);
  console.log(`  stale entries removed   ${r.pruned}`);
  console.log(`  already correct         ${r.unchanged}`);
  if (r.details.length) {
    console.log('\n  changed:');
    for (const d of r.details) {
      const bits = [d.reshaped && 'reshaped', d.gained && `+${d.gained}`, d.pruned && `-${d.pruned}`]
        .filter(Boolean)
        .join(' ');
      console.log(`    ${d.email.padEnd(32)} ${bits}`);
    }
  }
  await mongoose.disconnect();
}
