/**
 * migrate-mentor-rosters.js — one-off, idempotent.
 *
 * Third and final step of the batch/class rework, introducing the MAIN /
 * SUPPORT mentor model.
 *
 *   Migration 1: Batch.class            → Batch.classes = [ObjectId]
 *   Migration 2: Batch.classes[]        → [{ class, trainer }]
 *   THIS ONE:    [{ class, trainer }]   → [{ class, mainTrainers[], supportTrainers[] }]
 *                Feedback.trainer       → Feedback.mainTrainers[] + supportTrainers[]
 *
 * The old single `trainer` becomes the sole MAIN mentor and support starts
 * empty, because that is exactly what the old data meant — there was no way to
 * record an assisting mentor, so nobody was one.
 *
 * Also backfills:
 *   - Batch.round      → 1 for any batch that has ever been opened, else 0, so
 *                        existing device locks keep matching (they were hashed
 *                        without a round, which computeSignatureHash treats as
 *                        round 0 — hence "already opened" batches move to 1
 *                        ONLY if they are closed; an OPEN batch stays at 0 so
 *                        in-flight students are not locked out mid-window).
 *   - Feedback.round   → 0 (the pre-rounds era).
 *   - User.shortName   → first word of the name, if unset.
 *   - User.tokenVersion→ 0.
 *
 * Idempotent: every step skips documents already in the new shape, so running
 * it twice is a no-op. Safe to run against a live database.
 *
 * Run:  node src/scripts/migrate-mentor-rosters.js
 *       node src/scripts/migrate-mentor-rosters.js --dry-run
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';

const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(DRY ? '[dry]' : '[mig]', ...a);

async function main() {
  await connectDB();
  const db = mongoose.connection;
  const batches = db.collection('batches');
  const feedbacks = db.collection('feedbacks');
  const users = db.collection('users');
  const devicelocks = db.collection('devicelocks');

  const stats = {
    batchesConverted: 0,
    batchEntriesConverted: 0,
    batchesRoundBackfilled: 0,
    feedbackConverted: 0,
    feedbackRoundBackfilled: 0,
    usersShortName: 0,
    usersTokenVersion: 0,
    deviceLocksRound: 0,
  };

  // ── 1. Batch.classes[].trainer → mainTrainers[] / supportTrainers[] ───────
  const cursor = batches.find({});
  for await (const b of cursor) {
    const entries = Array.isArray(b.classes) ? b.classes : [];
    // Already migrated if every entry carries a mainTrainers array.
    const needsWork = entries.some((e) => e && !Array.isArray(e.mainTrainers));
    if (needsWork) {
      const converted = entries.map((e) => {
        if (Array.isArray(e.mainTrainers)) return e; // leave migrated entries alone
        const main = e.trainer ? [e.trainer] : [];
        stats.batchEntriesConverted += 1;
        return { class: e.class, mainTrainers: main, supportTrainers: [] };
      });
      // An entry with no trainer at all cannot satisfy the new schema's
      // "at least one main mentor". Report it rather than writing a document
      // that will fail validation on the next save.
      const orphan = converted.find((e) => !e.mainTrainers.length);
      if (orphan) {
        console.warn(
          `[mig] SKIPPED batch ${b._id} ("${b.name}") — class ${orphan.class} has no trainer to promote. Assign one in the admin UI, then re-run.`
        );
      } else {
        if (!DRY) await batches.updateOne({ _id: b._id }, { $set: { classes: converted } });
        stats.batchesConverted += 1;
      }
    }

    // Round backfill. A CLOSED batch moves to round 1; an OPEN one stays at 0
    // so its existing (round-less → round 0) device locks keep matching and
    // nobody mid-window is asked to submit twice.
    if (b.round === undefined || b.round === null) {
      const round = b.status === 'open' ? 0 : b.openedAt ? 1 : 0;
      if (!DRY) await batches.updateOne({ _id: b._id }, { $set: { round } });
      stats.batchesRoundBackfilled += 1;
    }
  }

  // ── 2. Feedback.trainer → mainTrainers[] ─────────────────────────────────
  // Aggregation-pipeline update: one server-side pass instead of streaming
  // every row through the app. Only touches rows still missing the new field.
  const fbToConvert = await feedbacks.countDocuments({
    mainTrainers: { $exists: false },
    trainer: { $exists: true },
  });
  if (fbToConvert && !DRY) {
    await feedbacks.updateMany({ mainTrainers: { $exists: false }, trainer: { $exists: true } }, [
      { $set: { mainTrainers: ['$trainer'], supportTrainers: [] } },
    ]);
  }
  stats.feedbackConverted = fbToConvert;

  const fbNoRound = await feedbacks.countDocuments({ round: { $exists: false } });
  if (fbNoRound && !DRY) {
    await feedbacks.updateMany({ round: { $exists: false } }, { $set: { round: 0 } });
  }
  stats.feedbackRoundBackfilled = fbNoRound;

  // ── 3. DeviceLock.round backfill (pre-rounds locks are round 0) ──────────
  const dlNoRound = await devicelocks.countDocuments({ round: { $exists: false } });
  if (dlNoRound && !DRY) {
    await devicelocks.updateMany({ round: { $exists: false } }, { $set: { round: 0 } });
  }
  stats.deviceLocksRound = dlNoRound;

  // ── 4. User.shortName + tokenVersion ─────────────────────────────────────
  const noShort = await users
    .find({ $or: [{ shortName: { $exists: false } }, { shortName: '' }] })
    .project({ name: 1 })
    .toArray();
  for (const u of noShort) {
    const short = String(u.name || '').trim().split(/\s+/)[0] || '';
    if (!short) continue;
    if (!DRY) await users.updateOne({ _id: u._id }, { $set: { shortName: short } });
    stats.usersShortName += 1;
  }

  const noVer = await users.countDocuments({ tokenVersion: { $exists: false } });
  if (noVer && !DRY) {
    await users.updateMany({ tokenVersion: { $exists: false } }, { $set: { tokenVersion: 0 } });
  }
  stats.usersTokenVersion = noVer;

  // ── 5. Drop the superseded single-trainer fields ─────────────────────────
  // Done LAST, and only for documents that already have the new shape, so an
  // interrupted run can always be resumed from the original data.
  if (!DRY) {
    await batches.updateMany({ 'classes.mainTrainers': { $exists: true } }, {
      $unset: { 'classes.$[].trainer': '' },
    });
    await feedbacks.updateMany({ mainTrainers: { $exists: true } }, { $unset: { trainer: '' } });
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(DRY ? ' DRY RUN — nothing was written' : ' MIGRATION COMPLETE');
  console.log('─────────────────────────────────────────────');
  for (const [k, v] of Object.entries(stats)) console.log(` ${k.padEnd(26)} ${v}`);
  console.log('─────────────────────────────────────────────\n');

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[mig] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
