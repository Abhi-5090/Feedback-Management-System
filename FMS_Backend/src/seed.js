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

const DEFAULT_PARAMETERS = [
  'Content clarity',
  "Trainer's subject knowledge",
  'Pace of the session',
  'Engagement & interaction',
  'Doubt resolution',
  'Real-world / practical examples',
  'Quality of materials',
  'Overall experience',
];

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

async function main() {
  await connectDB();
  const { email, password } = await seedAdmin();
  await seedParameters();

  console.log('\n──────────────────────────────────────────────');
  console.log(' SEED COMPLETE');
  console.log('──────────────────────────────────────────────');
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

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
