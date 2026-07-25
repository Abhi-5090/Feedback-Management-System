/**
 * migrate-batch-class-trainer.js — one-off, idempotent.
 *
 * Second step of the batch/class rework. Migration 1 turned Batch.class into
 * Batch.classes = [ObjectId]. This turns each entry into { class, trainer },
 * where trainer defaults to the class's catalog trainer (no overrides existed
 * historically), and backfills the new denormalised Feedback.trainer field
 * (= the class's catalog trainer, since every past batch used the default).
 *
 * Idempotent:
 *   - a batch whose classes are already { class, trainer } objects is skipped,
 *   - a feedback that already has `trainer` is skipped.
 *
 * Run:  node src/scripts/migrate-batch-class-trainer.js
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';

async function main() {
  await connectDB();
  const db = mongoose.connection;
  const batches = db.collection('batches');
  const feedbacks = db.collection('feedbacks');
  const classesCol = db.collection('classes');

  // class _id -> default trainer _id
  const classDocs = await classesCol.find({}).project({ trainer: 1 }).toArray();
  const trainerByClass = new Map(classDocs.map((c) => [String(c._id), c.trainer]));

  // ── Batches: classes:[ObjectId] → classes:[{class, trainer}] ──────────────
  const allBatches = await batches.find({}).project({ classes: 1, name: 1 }).toArray();
  let batchMigrated = 0;
  let batchSkipped = 0;
  let missingTrainer = 0;
  for (const b of allBatches) {
    const arr = Array.isArray(b.classes) ? b.classes : [];
    // Already migrated if entries are objects carrying a `class` field.
    const alreadyObjects = arr.length > 0 && arr[0] && typeof arr[0] === 'object' && arr[0].class;
    if (alreadyObjects) {
      batchSkipped += 1;
      continue;
    }
    const rebuilt = arr.map((id) => {
      const trainer = trainerByClass.get(String(id)) || null;
      if (!trainer) missingTrainer += 1;
      return { class: id, trainer };
    });
    await batches.updateOne({ _id: b._id }, { $set: { classes: rebuilt } });
    batchMigrated += 1;
    console.log(`[migrate] batch ${b.name || b._id}: ${rebuilt.length} class entr${rebuilt.length === 1 ? 'y' : 'ies'} → {class,trainer}`);
  }

  // ── Feedback: backfill trainer = class default trainer ────────────────────
  const needTrainer = await feedbacks
    .find({ trainer: { $exists: false } })
    .project({ class: 1 })
    .toArray();
  let fbMigrated = 0;
  let fbOrphan = 0;
  for (const f of needTrainer) {
    const trainer = trainerByClass.get(String(f.class));
    if (!trainer) {
      fbOrphan += 1;
      continue; // class deleted — leave untouched, nothing sensible to set
    }
    await feedbacks.updateOne({ _id: f._id }, { $set: { trainer } });
    fbMigrated += 1;
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(' BATCH CLASS+TRAINER MIGRATION COMPLETE');
  console.log('──────────────────────────────────────────────');
  console.log(` Batches migrated       : ${batchMigrated}`);
  console.log(` Batches already migrated: ${batchSkipped}`);
  console.log(` Batch entries w/o trainer (class had none): ${missingTrainer}`);
  console.log(` Feedback trainer backfilled: ${fbMigrated}`);
  console.log(` Feedback left (class deleted): ${fbOrphan}`);
  console.log('──────────────────────────────────────────────\n');

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[migrate] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
