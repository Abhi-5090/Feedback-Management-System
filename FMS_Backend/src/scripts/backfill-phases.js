/**
 * Assign existing feedback to a phase.
 *
 * Every response collected before phases existed carries `phase: null`. They
 * are not lost — they show as "Unassigned" — but a report that cannot account
 * for 1,259 responses is a report nobody trusts.
 *
 * This creates one phase per CALENDAR MONTH that has feedback in it, named
 * "Phase N — Month Year", and claims that month's responses. A month is the
 * right default for a backfill even though it is the wrong primitive going
 * forward: the exercises already happened, their dates are known, and a month
 * boundary cannot split an exercise that has already finished inside one.
 *
 *   node src/scripts/backfill-phases.js --dry-run
 *   node src/scripts/backfill-phases.js --database=<name>
 *
 * The target database must be named, like every other destructive script here
 * — this rewrites every feedback document. See utils/destructiveGuard.js.
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { Feedback } from '../models/Feedback.js';
import { Phase } from '../models/Phase.js';
import { isMain } from '../utils/isMain.js';
import { assertDestructiveAllowed, DestructiveRefusal } from '../utils/destructiveGuard.js';
import { monthRange, assertWindowIsFree, resyncPhaseMembership } from '../services/phaseService.js';

const DRY = process.argv.includes('--dry-run');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Which months hold feedback, oldest first. */
export async function monthsWithFeedback() {
  const rows = await Feedback.aggregate([
    { $match: { phase: null } },
    {
      $group: {
        _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
        n: { $sum: 1 },
        first: { $min: '$createdAt' },
        last: { $max: '$createdAt' },
      },
    },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
  ]);
  return rows.map((r) => ({
    year: r._id.y,
    monthIndex: r._id.m - 1, // $month is 1-based, Date is 0-based
    responses: r.n,
    first: r.first,
    last: r.last,
  }));
}

async function main() {
  await connectDB();

  const months = await monthsWithFeedback();
  const unassigned = months.reduce((s, m) => s + m.responses, 0);

  console.log(`\nUnassigned feedback: ${unassigned} response(s) across ${months.length} month(s)\n`);
  if (!months.length) {
    console.log('  Nothing to do — every response already belongs to a phase.\n');
    await disconnectDB();
    return;
  }

  // Number phases from whatever already exists, so a re-run does not collide.
  const existing = await Phase.countDocuments();
  let n = existing;

  const plan = [];
  for (const m of months) {
    const { startsAt, endsAt } = monthRange(m.year, m.monthIndex);
    n += 1;
    plan.push({
      ...m,
      startsAt,
      endsAt,
      name: `Phase ${n} — ${MONTHS[m.monthIndex]} ${m.year}`,
      code: `P${n}`,
    });
  }

  console.log('  phase                            window                     responses');
  console.log('  ' + '─'.repeat(74));
  for (const p of plan) {
    console.log(
      '  ' + p.name.padEnd(33) +
      `${p.startsAt.toISOString().slice(0, 10)} → ${p.endsAt.toISOString().slice(0, 10)}`.padEnd(27) +
      String(p.responses).padStart(9)
    );
    console.log('    ' + `actual feedback ran ${p.first.toISOString().slice(0, 10)} → ${p.last.toISOString().slice(0, 10)}`);
  }

  if (DRY) {
    console.log('\n  DRY RUN — nothing was written.\n');
    await disconnectDB();
    return;
  }

  try {
    assertDestructiveAllowed({
      uri: process.env.MONGO_URI,
      action: `create ${plan.length} phase(s) and re-stamp ${unassigned} feedback document(s)`,
    });
  } catch (err) {
    if (!(err instanceof DestructiveRefusal)) throw err;
    console.error(`\n  ${err.message}\n`);
    await disconnectDB();
    process.exit(2);
  }

  let created = 0;
  let claimed = 0;
  for (const p of plan) {
    // Never silently collide with a phase an admin already made by hand.
    try {
      await assertWindowIsFree({ startsAt: p.startsAt, endsAt: p.endsAt });
    } catch (err) {
      console.log(`\n  SKIPPED ${p.name}: ${err.message}`);
      continue;
    }
    const phase = await Phase.create({
      name: p.name,
      code: p.code,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      /* Closed, not open. These exercises are over — their numbers have
         already been read and acted on, and leaving them open would let a
         straggler land in a finished exercise. */
      status: 'closed',
      closedAt: new Date(),
      notes: 'Created by backfill-phases from existing feedback.',
    });
    // Claim BEFORE the status freeze would block it: resync skips closed
    // phases, so the membership is written here directly.
    const res = await Feedback.updateMany(
      { phase: null, createdAt: { $gte: p.startsAt, $lt: p.endsAt } },
      { $set: { phase: phase._id } }
    );
    created += 1;
    claimed += res.modifiedCount;
    console.log(`  created ${phase.code.padEnd(4)} ${phase.name.padEnd(33)} claimed ${res.modifiedCount}`);
  }

  const left = await Feedback.countDocuments({ phase: null });
  console.log(`\n  ${created} phase(s) created · ${claimed} response(s) assigned · ${left} still unassigned\n`);
  await disconnectDB();
}

if (isMain(import.meta.url)) {
  main().catch(async (err) => {
    console.error('[backfill-phases] failed:', err.message);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
}
