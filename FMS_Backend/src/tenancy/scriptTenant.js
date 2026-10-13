import { Organization } from '../models/Organization.js';
import { runUnscoped, setAmbientTenant } from './tenantContext.js';

/**
 * Pick the organization a command-line script operates on.
 *
 * Scripts run outside any request, so nothing has decided their tenant. The
 * data layer refuses to guess — correctly, since the two available guesses are
 * "nothing", which breaks the script, and "everything", which lets a
 * maintenance job rewrite another institution's rows.
 *
 * So the operator says. With one organization on the platform the choice is
 * unambiguous and the flag may be omitted; with several it is required, because
 * running an import or a counter rebuild against the wrong institution is not
 * something the operator would notice until much later.
 *
 *   node src/scripts/import-schedule.js --org=ncet
 */
export async function resolveScriptTenant({ required = true } = {}) {
  const flag = process.argv.find((a) => a.startsWith('--org='));
  const slug = flag ? flag.slice(6).trim().toLowerCase() : null;

  const all = await runUnscoped(() =>
    Organization.find({ archivedAt: null }).select('name slug').sort({ name: 1 }).lean()
  );

  if (!all.length) {
    throw new Error(
      'No organizations exist yet. Run src/scripts/migrate-to-organizations.js first.'
    );
  }

  let org;
  if (slug) {
    org = all.find((o) => o.slug === slug);
    if (!org) {
      throw new Error(
        `No organization with handle "${slug}". Available: ${all.map((o) => o.slug).join(', ')}`
      );
    }
  } else if (all.length === 1) {
    [org] = all;
  } else if (required) {
    throw new Error(
      `--org=<handle> is required when more than one organization exists. ` +
        `Available: ${all.map((o) => o.slug).join(', ')}`
    );
  }

  if (org) {
    setAmbientTenant({ organization: org._id });
    console.log(`[tenant] operating on ${org.name} (${org.slug})`);
  }
  return org;
}
