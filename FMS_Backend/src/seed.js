/**
 * seed.js — idempotent seeding for a fresh install.
 *   - creates one admin (email from env, password from env or auto-generated),
 *   - seeds the 8 default rating parameters (only if none exist).
 *
 * Run:  npm run seed
 */
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { User } from './models/User.js';
import { Parameter } from './models/Parameter.js';
import { hashPassword, generateStrongPassword } from './utils/password.js';
import { isMain } from './utils/isMain.js';
import { DEFAULT_PARAMETERS } from './config/defaultParameters.js';
import { Organization } from './models/Organization.js';
import { Membership } from './models/Membership.js';
import { runUnscoped, setAmbientTenant } from './tenancy/tenantContext.js';


async function seedAdmin() {
  const email = env.seedAdminEmail.toLowerCase();
  let admin = await User.findOne({ email });
  if (admin) {
    console.log(`[seed] admin already exists: ${email} (password unchanged)`);
    return { email, password: null };
  }
  const password = env.seedAdminPassword || generateStrongPassword();
  admin = await User.create({
    name: 'Administrator',
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
  });
    await Membership.create({ user: admin._id, role: 'admin' });
  console.log(`[seed] created admin: ${email}`);
  return { email, password };
}

async function seedParameters() {
  const existing = await Parameter.countDocuments();
  if (existing > 0) {
    console.log(`[seed] parameters already present (${existing}) — skipping`);
    return;
  }
  await Parameter.insertMany(
    DEFAULT_PARAMETERS.map((label, i) => ({ label, order: i, isActive: true }))
  );
  console.log(`[seed] inserted ${DEFAULT_PARAMETERS.length} default parameters`);
}

/**
 * The organization the seeded admin and parameters belong to.
 *
 * Seeding predates multi-tenancy, and the models now fail closed, so this has
 * to establish a tenant before anything else is written — otherwise the seed
 * throws rather than quietly creating unowned rows that nobody could ever see.
 */
async function seedOrganization() {
  const slug = process.env.SEED_ORG_SLUG || 'ncet';
  const name = process.env.SEED_ORG_NAME || 'NCET';
  let org = await runUnscoped(() => Organization.findOne({ slug }));
  if (!org) {
    org = await runUnscoped(() => Organization.create({ name, slug }));
    console.log(`[seed] created organization ${name} (${slug})`);
  } else {
    console.log(`[seed] organization ${org.name} (${slug}) already exists`);
  }
  setAmbientTenant({ organization: org._id });
  return org;
}

async function main() {
  await connectDB();
  const org = await seedOrganization();
  const { email, password } = await seedAdmin();
  await seedParameters();

  console.log('\n──────────────────────────────────────────────');
  console.log(' SEED COMPLETE');
  console.log('──────────────────────────────────────────────');
  console.log(` Organization   : ${org.name} (${org.slug})`);
  console.log(` Admin email    : ${email}`);
  if (password) {
    console.log(` Admin password : ${password}`);
    console.log(' (Shown once — store it securely.)');
  } else {
    console.log(' Admin password : (unchanged — user already existed)');
  }
  console.log('──────────────────────────────────────────────\n');

  await disconnectDB();
  process.exit(0);
}

if (isMain(import.meta.url)) {
  main().catch(async (err) => {
    console.error('[seed] failed:', err);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
}
