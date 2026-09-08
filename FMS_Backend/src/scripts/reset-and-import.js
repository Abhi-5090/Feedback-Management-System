/**
 * reset-and-import.js — wipe the application data and rebuild it from the board.
 *
 * DESTRUCTIVE. This deletes every document in the collections listed in
 * `WIPE` and then rebuilds: admin, parameters, mentors, subjects, batches.
 *
 * Safety, in order:
 *   1. It BACKS UP every collection to a timestamped JSON file first, always,
 *      even in --dry-run. A restore path is printed at the end.
 *   2. It refuses to run without `--yes`. A destructive default is how a
 *      database gets emptied by a typo in a shell history.
 *   3. It NAMES the target host and database and shows the document counts it
 *      is about to destroy, so a wrong connection string is visible before the
 *      damage rather than after.
 *   4. `--keep-users` preserves accounts (and therefore passwords) while
 *      rebuilding everything else — usually what you want on a second run,
 *      because a full wipe re-issues one shared password to everybody.
 *
 * Run:
 *   node src/scripts/reset-and-import.js --dry-run
 *   node src/scripts/reset-and-import.js --yes --password='Chosen#2026'
 *   node src/scripts/reset-and-import.js --yes --keep-users
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(HERE, '..', '..', 'backups');

const DRY = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');
const KEEP_USERS = process.argv.includes('--keep-users');
const passwordArg = process.argv.find((a) => a.startsWith('--password='));

/**
 * Collections this script owns. Listed explicitly rather than dropping the
 * whole database: an explicit list cannot accidentally take out something a
 * future feature added and nobody remembered to consider.
 */
const WIPE = [
  'batches',
  'classes',
  'feedbacks',
  'devicelocks',
  'parameters',
  'passwordresettokens',
  'auditlogs',
  'users',
];

/** Everything gets backed up, including collections we are not wiping. */
const BACKUP = [...new Set([...WIPE, 'users'])];

/** Redact credentials before a URI is ever printed or written to a file. */
const safeUri = (uri) => String(uri).replace(/\/\/([^:]+):([^@]+)@/, '//$1:<redacted>@');

function run(args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n──── ${label} ────`);
    const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: path.join(HERE, '..', '..') });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))
    );
    child.on('error', reject);
  });
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  TARGET DATABASE');
  console.log('═════════════════════════════════════════════════════════════');
  console.log(`  host : ${mongoose.connection.host}`);
  console.log(`  db   : ${mongoose.connection.name}`);
  console.log(`  uri  : ${safeUri(env.mongoUri)}`);
  const isAtlas = /mongodb\.net/.test(env.mongoUri);
  if (isAtlas) console.log('  ** THIS IS A REMOTE ATLAS CLUSTER **');
  console.log('═════════════════════════════════════════════════════════════');

  // ── Counts before ────────────────────────────────────────────────────────
  const existing = await db.listCollections().toArray();
  const names = new Set(existing.map((c) => c.name));
  const counts = {};
  for (const name of BACKUP) {
    counts[name] = names.has(name) ? await db.collection(name).countDocuments() : 0;
  }

  console.log('\n  Documents currently present:');
  for (const [name, n] of Object.entries(counts)) {
    const willWipe = WIPE.includes(name) && !(KEEP_USERS && name === 'users');
    console.log(`    ${name.padEnd(22)} ${String(n).padStart(6)}   ${willWipe ? '→ DELETE' : '→ keep'}`);
  }
  const total = Object.entries(counts)
    .filter(([n]) => WIPE.includes(n) && !(KEEP_USERS && n === 'users'))
    .reduce((s, [, n]) => s + n, 0);
  console.log(`  ${'TOTAL TO DELETE'.padEnd(22)} ${String(total).padStart(6)}`);

  // ── Backup, always ───────────────────────────────────────────────────────
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `backup-${mongoose.connection.name}-${stamp}.json`);

  const dump = { _meta: { takenAt: new Date().toISOString(), host: mongoose.connection.host, db: mongoose.connection.name, counts } };
  for (const name of BACKUP) {
    dump[name] = names.has(name) ? await db.collection(name).find({}).toArray() : [];
  }
  await writeFile(file, JSON.stringify(dump, null, 2));
  console.log(`\n  Backup written: ${file}`);
  console.log('  (Contains password HASHES, not passwords. Keep it private — it is gitignored.)');

  if (!YES) {
    console.log('\n  Nothing was deleted. Re-run with --yes to proceed.');
    if (DRY) console.log('  (--dry-run also stops here by design.)');
    await disconnectDB();
    process.exit(0);
  }
  if (DRY) {
    console.log('\n  DRY RUN — stopping before any deletion.');
    await disconnectDB();
    process.exit(0);
  }

  // ── Wipe ─────────────────────────────────────────────────────────────────
  console.log('\n──── deleting ────');
  for (const name of WIPE) {
    if (KEEP_USERS && name === 'users') {
      console.log(`  ${name.padEnd(22)} kept (--keep-users)`);
      continue;
    }
    if (!names.has(name)) {
      console.log(`  ${name.padEnd(22)} absent`);
      continue;
    }
    const res = await db.collection(name).deleteMany({});
    console.log(`  ${name.padEnd(22)} deleted ${res.deletedCount}`);
  }

  /* Drop indexes on the wiped collections so the models rebuild them from the
     CURRENT schema. An index left over from an older shape (the single-trainer
     era) can silently reject a valid write or, worse, keep enforcing a
     uniqueness rule that no longer exists in the code. */
  console.log('\n──── rebuilding indexes ────');
  for (const name of WIPE) {
    if (KEEP_USERS && name === 'users') continue;
    if (!names.has(name)) continue;
    try {
      await db.collection(name).dropIndexes();
      console.log(`  ${name.padEnd(22)} indexes dropped (models will recreate)`);
    } catch (err) {
      // A collection with only the default _id index reports this; harmless.
      if (!/index not found|ns not found/i.test(err.message)) throw err;
    }
  }

  await disconnectDB();

  // ── Rebuild, in separate processes so each script runs its own connect ───
  await run(['src/seed.js'], 'seed: admin + 8 parameters');
  const importArgs = ['src/scripts/import-schedule.js'];
  if (passwordArg) importArgs.push(passwordArg);
  await run(importArgs, 'import: mentors + subjects + batches');

  // ── Verify ───────────────────────────────────────────────────────────────
  await connectDB();
  const after = {};
  for (const name of BACKUP) {
    after[name] = await mongoose.connection.db.collection(name).countDocuments();
  }

  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  RESULT');
  console.log('═════════════════════════════════════════════════════════════');
  for (const [name, n] of Object.entries(after)) {
    console.log(`    ${name.padEnd(22)} ${String(n).padStart(6)}`);
  }
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`  Backup of the previous contents: ${file}`);
  console.log('═════════════════════════════════════════════════════════════\n');

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n[reset] FAILED:', err.message);
  console.error('[reset] The backup file (if written above) still holds the previous contents.');
  await disconnectDB().catch(() => {});
  process.exit(1);
});
