/**
 * migrate-batch-classes.js — one-off, idempotent migration.
 *
 * The Batch↔Class relationship was inverted: a batch used to belong to a single
 * `class` (ObjectId); it now holds many in `classes` (ObjectId[]). Today's data
 * maps cleanly — each existing batch keeps its one class as a one-element array
 * — so this is a low-risk backfill, NOT a rewrite of any feedback.
 *
 * For every batch that still has the legacy single `class` field:
 *   - set   classes = [class]   (unless classes is already populated)
 *   - unset class
 *
 * Feedback documents are untouched: they already carry both `batch` and `class`
 * and remain valid as-is.
 *
 * Idempotent: re-running skips batches that already have a non-empty `classes`
 * array and no legacy field. Safe to run repeatedly.
 *
 * Run:  node src/scripts/migrate-batch-classes.js
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';

async function main() {
  await connectDB();
  // Raw collection access on purpose: the Mongoose schema no longer defines
  // `class`, so reading/writing it must bypass the model's field stripping.
  const col = mongoose.connection.collection('batches');

  const legacy = await col
    .find({ class: { $exists: true } })
    .project({ class: 1, classes: 1, name: 1 })
    .toArray();

  console.log(`[migrate] found ${legacy.length} batch(es) with a legacy 'class' field`);

  let migrated = 0;
  let skipped = 0;
  for (const b of legacy) {
    const hasClasses = Array.isArray(b.classes) && b.classes.length > 0;
    const update = { $unset: { class: '' } };
    if (!hasClasses && b.class) {
      update.$set = { classes: [b.class] };
      migrated += 1;
    } else {
      // classes already set (or class was null) — just drop the stale field.
      skipped += 1;
    }
    await col.updateOne({ _id: b._id }, update);
    console.log(
      `[migrate]  ${b.name || b._id}: ${update.$set ? `classes=[${b.class}]` : 'classes kept'} , class unset`
    );
  }

  // Report any batch that ended up with no classes — should never happen, but
  // it's the one state the new model forbids, so surface it loudly.
  const orphans = await col.countDocuments({
    $or: [{ classes: { $exists: false } }, { classes: { $size: 0 } }],
  });

  console.log('\n──────────────────────────────────────────────');
  console.log(' BATCH → CLASSES MIGRATION COMPLETE');
  console.log('──────────────────────────────────────────────');
  console.log(` Backfilled classes[] : ${migrated}`);
  console.log(` Already migrated     : ${skipped}`);
  console.log(` Batches with NO classes (needs attention): ${orphans}`);
  console.log('──────────────────────────────────────────────\n');

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[migrate] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
