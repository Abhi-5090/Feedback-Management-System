/**
 * reconcile-counters.js — bring Batch.submittedCount back in line with reality.
 *
 * WHY THIS IS NEEDED. `Batch.submittedCount` is a denormalised counter. It has
 * to be: it is the guard that enforces the response cap, and enforcing a cap
 * requires a single atomic increment, not a count query per submission. But a
 * denormalised copy drifts the moment data changes outside the application —
 * deleting feedback rows straight in the database leaves the counter claiming
 * submissions that no longer exist, and every "answered %" built on it becomes
 * a fiction.
 *
 * The analytics endpoints now DERIVE what they display from the feedback rows,
 * so a drift no longer misleads anyone. This script fixes the stored counter
 * too, which matters for two things the derived figures cannot cover:
 *   - the live "submitted / expected" counter on an open batch, and
 *   - the cap itself: a counter stuck above the cap silently refuses every
 *     further submission, which looks like the form being broken.
 *
 * HOW THE TRUE VALUE IS DERIVED. One submission writes exactly one Feedback row
 * per class in the batch, so the number of students who answered equals the MAX
 * row count across that batch's classes. Max rather than dividing the total by
 * the class count, so the answer stays correct if a subject was added to the
 * batch after collection had begun.
 *
 * Also prunes DeviceLock rows whose batch no longer exists — orphans left by a
 * batch being hard-deleted, which would otherwise block a device forever.
 *
 * Run:  npm run reconcile            (apply)
 *       npm run reconcile -- --dry-run
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { Batch } from '../models/Batch.js';
import { Feedback } from '../models/Feedback.js';
import { DeviceLock } from '../models/DeviceLock.js';

const DRY = process.argv.includes('--dry-run');

async function main() {
  await connectDB();

  const batches = await Batch.find({})
    .select('name expectedCount submittedCount status round')
    .lean();

  // One aggregation for every batch, rather than a query per batch.
  const perBatchClass = await Feedback.aggregate([
    { $group: { _id: { batch: '$batch', class: '$class' }, n: { $sum: 1 } } },
  ]);
  const answered = new Map(); // batchId -> students who answered
  for (const row of perBatchClass) {
    const k = String(row._id.batch);
    answered.set(k, Math.max(answered.get(k) || 0, row.n));
  }

  const changes = [];
  for (const b of batches) {
    const truth = answered.get(String(b._id)) || 0;
    if ((b.submittedCount || 0) !== truth) {
      changes.push({ b, from: b.submittedCount || 0, to: truth });
    }
  }

  console.log(`\nBatches: ${batches.length} · counters out of step: ${changes.length}`);
  if (changes.length) {
    console.log('\n  batch                          counter   actual   action');
    console.log('  ' + '─'.repeat(62));
    for (const c of changes) {
      const note =
        c.to === 0
          ? 'reset (no feedback rows)'
          : c.to < c.from
            ? 'lowered to match rows'
            : 'raised to match rows';
      console.log(
        '  ' +
          c.b.name.padEnd(30) +
          String(c.from).padStart(7) +
          String(c.to).padStart(9) +
          '   ' +
          note
      );
      /* A counter stuck ABOVE the cap is the dangerous case: the conditional
         increment then matches nothing and every submission is refused with
         "this batch has reached its expected number of responses", which reads
         as a broken form rather than a stale number. */
      if (c.b.status === 'open' && c.b.expectedCount > 0 && c.from >= c.b.expectedCount && c.to < c.from) {
        console.log('        ^ this OPEN batch was refusing submissions because of that');
      }
    }
  }

  /* ── Orphaned device locks ─────────────────────────────────────────────
     A lock exists to say "this device already submitted". If the submission it
     refers to is gone, the lock only blocks a real student from answering.
     Two ways that happens:
       - the batch was hard-deleted, leaving the lock pointing at nothing;
       - a round's feedback was deleted, leaving locks for submissions that no
         longer exist.
     Both are cleaned. A lock is NOT removed while its round still has feedback
     rows: there the lock is someone's genuine submission and deleting it would
     let them answer twice. */
  const batchIds = new Set(batches.map((b) => String(b._id)));
  const allLocks = await DeviceLock.find({}).select('batch round').lean();

  // (batch, round) pairs that still have feedback behind them.
  const roundsWithRows = new Set(
    (
      await Feedback.aggregate([
        { $group: { _id: { batch: '$batch', round: '$round' } } },
      ])
    ).map((r) => `${r._id.batch}|${r._id.round ?? 0}`)
  );

  const orphanIds = [];
  let missingBatch = 0;
  let emptyRound = 0;
  for (const l of allLocks) {
    if (!batchIds.has(String(l.batch))) {
      orphanIds.push(l._id);
      missingBatch += 1;
    } else if (!roundsWithRows.has(`${l.batch}|${l.round ?? 0}`)) {
      orphanIds.push(l._id);
      emptyRound += 1;
    }
  }
  const orphanCount = orphanIds.length;

  console.log(`\nDevice locks: ${allLocks.length} total, ${orphanCount} blocking nothing`);
  if (missingBatch) console.log(`  ${missingBatch} point at a batch that no longer exists`);
  if (emptyRound) console.log(`  ${emptyRound} belong to a round whose feedback was deleted`);

  if (DRY) {
    console.log('\nDRY RUN — nothing was written.\n');
    await disconnectDB();
    process.exit(0);
  }

  if (changes.length) {
    await Batch.bulkWrite(
      changes.map((c) => ({
        updateOne: { filter: { _id: c.b._id }, update: { $set: { submittedCount: c.to } } },
      }))
    );
  }
  if (orphanCount) {
    await DeviceLock.deleteMany({ _id: { $in: orphanIds } });
  }

  console.log(
    `\nApplied: ${changes.length} counter(s) corrected, ${orphanCount} orphan lock(s) removed.\n`
  );

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[reconcile] failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
