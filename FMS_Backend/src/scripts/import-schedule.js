/**
 * import-schedule.js — build the FMS catalog from the Torii training board.
 *
 * Reads the board's schedule (a local snapshot by default, or live with
 * --fetch) and creates, idempotently:
 *
 *   - one trainer account per mentor on the roster,
 *   - one Class per distinct SUBJECT ("C Programming", "GenAI", "Coding", …),
 *   - one Batch per cohort, carrying yearGroup / dept / expectedCount and, for
 *     each subject it runs, the MAIN and SUPPORT mentor rosters.
 *
 * HOW THE BOARD MAPS ONTO FMS
 *   Torii models the TIMETABLE: a batch has many rows, one per day+slot, and
 *   the same subject appears several times (GenAI runs twice on Friday).
 *   FMS models FEEDBACK: a batch holds each subject ONCE, and a student rates
 *   that subject once for the cohort. So rows are MERGED per (batch, subject),
 *   unioning both mentor rosters across every session of it.
 *
 *   Where a person is main on one session of a subject and support on another,
 *   MAIN WINS — delivering the class is the stronger claim, and the schema
 *   forbids holding both roles on one entry. Every such collapse is reported.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED
 *   Days, slots, times and halls. FMS asks "how was this subject for this
 *   cohort?", which no timetable coordinate changes. Mirroring the grid here
 *   would create a second source of truth that silently drifts from the board.
 *
 * Idempotent: matches accounts by email, subjects by name, batches by name.
 * Re-running updates rosters in place rather than duplicating anything. An
 * OPEN batch is never restaffed (that would invalidate in-flight feedback);
 * it is reported and skipped.
 *
 * Run:
 *   node src/scripts/import-schedule.js                 # local snapshot
 *   node src/scripts/import-schedule.js --fetch         # live board
 *   node src/scripts/import-schedule.js --dry-run       # report only
 *   node src/scripts/import-schedule.js --password=...  # initial mentor password
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { Parameter } from '../models/Parameter.js';
import { hashPassword, generateStrongPassword } from '../utils/password.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');
const BOARD_API = 'https://torii-schedule-api.onrender.com/api/schedule';

const DRY = process.argv.includes('--dry-run');
const FETCH = process.argv.includes('--fetch');
const passwordArg = process.argv.find((a) => a.startsWith('--password='));

const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
};

/** Load the board, from the network or the committed snapshot. */
async function loadBoard() {
  if (FETCH) {
    console.log(`[import] fetching live board: ${BOARD_API}`);
    const res = await fetch(BOARD_API, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`board API returned ${res.status}`);
    return res.json();
  }
  const file = path.join(DATA, 'torii-schedule.json');
  console.log(`[import] reading snapshot: ${file}`);
  return JSON.parse(await readFile(file, 'utf8'));
}

async function loadRoster() {
  return JSON.parse(await readFile(path.join(DATA, 'torii-mentors.json'), 'utf8'));
}

/* ── Mentors ──────────────────────────────────────────────────────────────── */

/**
 * Create or update one account per mentor. Accounts are keyed on EMAIL, the
 * only stable identifier — names on the board are short forms and change.
 *
 * Every account starts with `mustChangePassword: true`. The shared initial
 * password is a starting credential, and until each person replaces it that one
 * secret opens all of these accounts, so the server holds them at the
 * change-password gate.
 */
async function upsertMentors(roster, sharedPassword) {
  const all = [...roster.mentors, ...roster.rosterOnly];
  const passwordHash = DRY ? null : await hashPassword(sharedPassword);
  const byShortName = new Map();
  let created = 0;
  let updated = 0;

  for (const m of all) {
    const email = m.email.toLowerCase();
    let user = await User.findOne({ email });

    if (!user) {
      if (DRY) {
        created += 1;
        byShortName.set(m.shortName, { _id: `dry-${m.shortName}`, name: m.name });
        continue;
      }
      user = await User.create({
        name: m.name,
        shortName: m.shortName,
        email,
        passwordHash,
        role: 'trainer',
        isActive: true,
        mustChangePassword: true,
      });
      created += 1;
    } else {
      /* Keep the display name AND board label in sync with the roster file,
         which is the declared source of truth for who is on the schedule.
         A password is never touched — re-running the import must not reset
         anyone's credentials. */
      const changes = [];
      if (user.name !== m.name) changes.push(`name "${user.name}" -> "${m.name}"`);
      if (user.shortName !== m.shortName) changes.push(`shortName -> "${m.shortName}"`);
      if (changes.length) {
        if (!DRY) {
          user.name = m.name;
          user.shortName = m.shortName;
          await user.save();
        }
        console.log(`  ~ ${m.email}: ${changes.join(', ')}`);
        updated += 1;
      }
    }
    byShortName.set(m.shortName, user);
  }

  return { byShortName, created, updated, total: all.length };
}

/* ── Subjects ─────────────────────────────────────────────────────────────── */

/**
 * One Class per distinct subject on the board.
 *
 * No default trainer is set: the board proves a subject is staffed differently
 * per cohort (C Programming runs with Abraham for three first-year batches and
 * Naveen for a fourth), so naming one catalog owner would be a fiction the
 * batch rosters immediately contradict.
 */
async function upsertSubjects(board) {
  const subjects = [
    ...new Set(board.batches.flatMap((b) => (b.rows || []).map((r) => r.subject))),
  ]
    .filter(Boolean)
    .sort();

  const byName = new Map();
  let created = 0;

  for (const name of subjects) {
    let klass = await Class.findOne({ name, archivedAt: null });
    if (!klass) {
      if (DRY) {
        byName.set(name, { _id: `dry-${name}`, name });
        created += 1;
        continue;
      }
      klass = await Class.create({ name, description: '', trainer: null });
      created += 1;
    }
    byName.set(name, klass);
  }

  return { byName, created, total: subjects.length };
}

/* ── Batches ──────────────────────────────────────────────────────────────── */

/**
 * Collapse a cohort's timetable rows into one entry per subject.
 *
 * Returns [{ subject, mainShort:Set, supportShort:Set, sessions }].
 */
function mergeRowsBySubject(batch) {
  const bySubject = new Map();

  for (const row of batch.rows || []) {
    const subject = row.subject;
    if (!subject) continue;
    if (!bySubject.has(subject)) {
      bySubject.set(subject, {
        subject,
        mainShort: new Set(),
        supportShort: new Set(),
        sessions: 0,
      });
    }
    const e = bySubject.get(subject);
    e.sessions += 1;
    for (const n of row.mainList || []) e.mainShort.add(n);
    for (const n of row.supportList || []) e.supportShort.add(n);
  }

  // Main outranks support: a person listed both ways across a subject's
  // sessions is recorded as main, and the overlap is reported.
  for (const e of bySubject.values()) {
    for (const n of [...e.supportShort]) {
      if (e.mainShort.has(n)) {
        e.supportShort.delete(n);
        warn(
          `${batch.name} · ${e.subject}: "${n}" appears as both main and support across sessions — recorded as MAIN.`
        );
      }
    }
  }

  return [...bySubject.values()];
}

async function upsertBatches(board, subjectsByName, mentorsByShort) {
  const stats = { created: 0, updated: 0, skippedOpen: 0, entries: 0, total: board.batches.length };

  for (const b of board.batches) {
    const merged = mergeRowsBySubject(b);
    if (!merged.length) {
      warn(`${b.name}: no sessions on the board — skipped (a batch needs at least one class).`);
      continue;
    }

    // Resolve short names to accounts.
    const classes = [];
    let unresolved = false;
    for (const e of merged) {
      const klass = subjectsByName.get(e.subject);
      if (!klass) {
        warn(`${b.name}: unknown subject "${e.subject}" — skipped.`);
        unresolved = true;
        continue;
      }
      const resolve = (set, role) =>
        [...set]
          .map((short) => {
            const u = mentorsByShort.get(short);
            if (!u) {
              warn(
                `${b.name} · ${e.subject}: board names ${role} mentor "${short}", who is not in torii-mentors.json — omitted.`
              );
              return null;
            }
            return u._id;
          })
          .filter(Boolean);

      const mainTrainers = resolve(e.mainShort, 'main');
      const supportTrainers = resolve(e.supportShort, 'support');

      if (!mainTrainers.length) {
        warn(
          `${b.name} · ${e.subject}: no resolvable main mentor — the whole batch is skipped, since the schema requires one.`
        );
        unresolved = true;
        continue;
      }
      classes.push({ class: klass._id, mainTrainers, supportTrainers });
    }

    if (unresolved || !classes.length) continue;

    const existing = await Batch.findOne({ name: b.name });

    if (existing && existing.status === 'open') {
      warn(
        `${b.name}: currently OPEN for feedback — staffing left unchanged. Lock it and re-run to restaff.`
      );
      stats.skippedOpen += 1;
      continue;
    }

    const doc = {
      name: b.name,
      yearGroup: b.group || '',
      dept: b.dept || '',
      // The board's headcount becomes the cap, so unlocking doesn't require
      // retyping a number the institution already knows.
      expectedCount: Number(b.count) || 0,
      classes,
    };

    if (DRY) {
      stats[existing ? 'updated' : 'created'] += 1;
      stats.entries += classes.length;
      continue;
    }

    if (existing) {
      Object.assign(existing, doc);
      await existing.save();
      stats.updated += 1;
    } else {
      await Batch.create(doc);
      stats.created += 1;
    }
    stats.entries += classes.length;
  }

  return stats;
}

/* ── Parameters ───────────────────────────────────────────────────────────── */

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

async function ensureParameters() {
  const existing = await Parameter.countDocuments();
  if (existing > 0) return { created: 0, existing };
  if (DRY) return { created: DEFAULT_PARAMETERS.length, existing: 0 };
  await Parameter.insertMany(
    DEFAULT_PARAMETERS.map((label, i) => ({ label, order: i, isActive: true }))
  );
  return { created: DEFAULT_PARAMETERS.length, existing: 0 };
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  await connectDB();

  const [board, roster] = await Promise.all([loadBoard(), loadRoster()]);
  console.log(
    `[import] board: ${board.trainers?.length ?? 0} mentors · ${board.batches.length} batches · ${board.groups?.length ?? 0} year groups`
  );
  if (DRY) console.log('[import] DRY RUN — nothing will be written\n');

  const sharedPassword = passwordArg
    ? passwordArg.split('=').slice(1).join('=')
    : generateStrongPassword(14);

  console.log('→ Parameters');
  const params = await ensureParameters();

  console.log('→ Mentors');
  const mentors = await upsertMentors(roster, sharedPassword);

  console.log('→ Subjects');
  const subjects = await upsertSubjects(board);

  console.log('→ Batches');
  const batches = await upsertBatches(board, subjects.byName, mentors.byShortName);

  console.log('\n═════════════════════════════════════════════════════');
  console.log(DRY ? ' DRY RUN SUMMARY' : ' IMPORT COMPLETE');
  console.log('═════════════════════════════════════════════════════');
  console.log(` Parameters   : ${params.created} created, ${params.existing} already present`);
  console.log(
    ` Mentors      : ${mentors.created} created, ${mentors.updated} updated (${mentors.total} on roster)`
  );
  console.log(` Subjects     : ${subjects.created} created (${subjects.total} total)`);
  console.log(
    ` Batches      : ${batches.created} created, ${batches.updated} updated, ${batches.skippedOpen} skipped (open)`
  );
  console.log(` Batch-classes: ${batches.entries} staffed entries`);
  if (mentors.created > 0 && !DRY) {
    console.log('\n─────────────────────────────────────────────────────');
    console.log(` Initial mentor password : ${sharedPassword}`);
    console.log(' Shown once. Every account is held at the change-password');
    console.log(' gate until the person sets their own.');
    console.log('─────────────────────────────────────────────────────');
  }
  if (warnings.length) {
    console.log(`\n ${warnings.length} warning(s) — see above.`);
  }
  console.log('');

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[import] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
