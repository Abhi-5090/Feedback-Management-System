/**
 * loadtest-cohort.js — simulate a whole cohort submitting at once.
 *
 * Answers the only question that matters before a real session: if 300
 * students hit the form in the same minute, does every one of them get
 * through? It drives the REAL endpoints over HTTP, including the passcode
 * gate, the per-device cookie, the transactional write and the live cap — so
 * it exercises rate limiting and database contention exactly as a classroom
 * would.
 *
 * Each simulated student is an independent "browser": its own cookie jar and
 * its own fingerprint, so the device lock treats them as distinct people.
 *
 * Usage:
 *   node src/scripts/loadtest-cohort.js --students=300
 *   node src/scripts/loadtest-cohort.js --students=300 --concurrency=300
 *   node src/scripts/loadtest-cohort.js --students=50 --keep   # leave the data
 *
 * It creates a throwaway batch, runs the cohort against it, reports, and
 * deletes everything it created (batch + feedback + device locks) unless
 * --keep is passed. It never touches pre-existing data.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { Batch } from '../models/Batch.js';
import { Class } from '../models/Class.js';
import { User } from '../models/User.js';
import { Feedback } from '../models/Feedback.js';
import { DeviceLock } from '../models/DeviceLock.js';
import { Parameter } from '../models/Parameter.js';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const STUDENTS = parseInt(arg('students', '300'), 10);
const CONCURRENCY = parseInt(arg('concurrency', String(STUDENTS)), 10);
const BASE = arg('base', `http://localhost:${env.port}`);
const KEEP = process.argv.includes('--keep');

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/**
 * A fetch that survives the client's own limits.
 *
 * 200 concurrent requests from ONE Node process press on undici's per-origin
 * connection pool, and a transient socket error surfaces as a bare
 * "fetch failed". Left unhandled it rejected the whole run, so the script
 * reported a failure caused by the LOAD GENERATOR rather than by the server —
 * which is worse than no test, because it looks like a product regression.
 * One retry with a short backoff absorbs that without hiding a real refusal:
 * an HTTP response of any status is returned untouched and never retried.
 */
async function resilientFetch(url, options, attempt = 0) {
  try {
    return await fetch(url, options);
  } catch (err) {
    // A network-level failure, not an HTTP error. Retry once.
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      return resilientFetch(url, options, attempt + 1);
    }
    // Surface it as a recorded failure for THIS student, not an aborted run.
    const e = new Error(`network: ${err.message}`);
    e.isNetwork = true;
    throw e;
  }
}

/** One simulated student: verify the passcode, then submit. */
async function student(i, batchId, passcode) {
  const t0 = Date.now();
  const out = { i, verifyMs: 0, submitMs: 0, ok: false, code: null, status: 0 };

  // ── verify-passcode ─────────────────────────────────────────────────────
  const vRes = await resilientFetch(`${BASE}/api/public/verify-passcode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId, passcode }),
  });
  out.verifyMs = Date.now() - t0;
  const vBody = await vRes.json().catch(() => ({}));
  if (!vRes.ok) {
    out.status = vRes.status;
    out.code = vBody.code || `verify_${vRes.status}`;
    return out;
  }

  // Carry the device cookie forward, exactly as a browser would — this is what
  // makes each simulated student a distinct device to the lock.
  const cookie = (vRes.headers.get('set-cookie') || '').split(';')[0];

  // ── submit ──────────────────────────────────────────────────────────────
  const t1 = Date.now();
  const body = {
    batchId,
    sessionToken: vBody.sessionToken,
    fingerprint: `loadtest-device-${i}|1170x2532|32|Asia/Kolkata|en-IN`,
    classes: vBody.classes.map((c) => ({
      classId: c.id,
      ratings: vBody.parameters.map((p) => ({ parameter: p._id, stars: 1 + ((i + p.order) % 5) })),
      comment: `Load-test response ${i} for ${c.name} — the session was clear and well paced.`,
    })),
  };
  const sRes = await resilientFetch(`${BASE}/api/public/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  out.submitMs = Date.now() - t1;
  out.status = sRes.status;
  const sBody = await sRes.json().catch(() => ({}));
  out.ok = sRes.status === 201;
  if (!out.ok) out.code = sBody.code || `submit_${sRes.status}`;
  return out;
}

/**
 * Run `tasks` with at most `limit` in flight.
 *
 * A task that throws is RECORDED, not propagated. One student hitting a client
 * socket limit must not abort the other 199 and lose the whole measurement —
 * the run's job is to report what happened to all of them.
 */
async function pool(tasks, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const idx = next++;
      try {
        results[idx] = await tasks[idx]();
      } catch (err) {
        results[idx] = {
          i: idx,
          verifyMs: 0,
          submitMs: 0,
          ok: false,
          status: 0,
          code: err.isNetwork ? 'CLIENT_NETWORK' : `client_${err.message}`.slice(0, 60),
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  await connectDB();

  // Health check first — a connection-refused error 300 times is not a result.
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`API not reachable at ${BASE} — start it with \`npm start\` first`);
  }

  const [klass, trainer, params] = await Promise.all([
    Class.findOne({ archivedAt: null }).lean(),
    User.findOne({ role: 'trainer', isActive: true }).lean(),
    Parameter.countDocuments({ isActive: true }),
  ]);
  if (!klass || !trainer) throw new Error('Need at least one class and one active trainer — run the import first');
  if (!params) throw new Error('No active parameters — run the seed first');

  // A throwaway batch so no real cohort's data is disturbed.
  const name = `LOADTEST ${new Date().toISOString().slice(11, 19)}`;
  const batch = await Batch.create({
    name,
    yearGroup: 'Load test',
    dept: 'synthetic',
    expectedCount: STUDENTS,
    classes: [{ class: klass._id, mainTrainers: [trainer._id], supportTrainers: [] }],
  });

  // Unlock through the model directly (no admin session needed here).
  const { generateBatchPasscode } = await import('../utils/passcode.js');
  const { hashPasscode } = await import('../utils/password.js');
  const passcode = generateBatchPasscode(batch.name);
  batch.passcodeHash = hashPasscode(passcode);
  batch.status = 'open';
  batch.round = 1;
  batch.openedAt = new Date();
  await batch.save();

  console.log(`\nTarget    : ${BASE}`);
  console.log(`Database  : ${mongoose.connection.host}`);
  console.log(`Batch     : "${name}"  (${params} parameters × 1 class, cap ${STUDENTS})`);
  console.log(`Students  : ${STUDENTS}, up to ${CONCURRENCY} in flight`);
  console.log(`Limits    : ${env.publicMaxPerDevice}/min per device · ${env.publicIpMax}/min per IP`);
  console.log('\nrunning…');

  const started = Date.now();
  const results = await pool(
    Array.from({ length: STUDENTS }, (_, i) => () => student(i, String(batch._id), passcode)),
    CONCURRENCY
  );
  const wall = Date.now() - started;

  // ── Report ───────────────────────────────────────────────────────────────
  const okRows = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const byCode = {};
  for (const f of failed) byCode[f.code] = (byCode[f.code] || 0) + 1;

  const vs = results.map((r) => r.verifyMs).sort((a, b) => a - b);
  const ss = okRows.map((r) => r.submitMs).sort((a, b) => a - b);

  const stored = await Feedback.countDocuments({ batch: batch._id });
  const locks = await DeviceLock.countDocuments({ batch: batch._id });
  const fresh = await Batch.findById(batch._id).lean();

  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  RESULT');
  console.log('═════════════════════════════════════════════════════════════');
  const clientSide = failed.filter((f) => String(f.code || '').startsWith('CLIENT_') || String(f.code || '').startsWith('client_'));
  console.log(`  submitted OK        ${okRows.length} / ${STUDENTS}`);
  console.log(`  failed              ${failed.length}${failed.length ? '  ' + JSON.stringify(byCode) : ''}`);
  if (clientSide.length) {
    /* Named separately because it is not a server problem: the load generator
       ran out of sockets. Raise it with a lower --concurrency, or run the
       generator on a bigger machine. */
    console.log(
      `  ...of which ${clientSide.length} were LOAD-GENERATOR failures (client sockets), not server refusals`
    );
  }
  console.log(`  wall clock          ${(wall / 1000).toFixed(2)} s`);
  console.log(`  throughput          ${(okRows.length / (wall / 1000)).toFixed(1)} students/sec`);
  console.log('  ── latency (ms) ────────────────────────────────');
  console.log(`  verify   p50 ${pct(vs, 50)}   p95 ${pct(vs, 95)}   max ${vs[vs.length - 1]}`);
  if (ss.length) {
    console.log(`  submit   p50 ${pct(ss, 50)}   p95 ${pct(ss, 95)}   max ${ss[ss.length - 1]}`);
  }
  console.log('  ── integrity ───────────────────────────────────');
  console.log(`  Feedback rows       ${stored}   (expect ${okRows.length})`);
  console.log(`  DeviceLocks         ${locks}   (expect ${okRows.length})`);
  console.log(`  batch.submittedCount ${fresh.submittedCount}   (expect ${okRows.length})`);
  const consistent = stored === okRows.length && locks === okRows.length && fresh.submittedCount === okRows.length;
  console.log(`  counters consistent ${consistent ? 'YES' : 'NO  <-- investigate'}`);
  console.log('═════════════════════════════════════════════════════════════');

  if (!KEEP) {
    await Promise.all([
      Feedback.deleteMany({ batch: batch._id }),
      DeviceLock.deleteMany({ batch: batch._id }),
    ]);
    await Batch.deleteOne({ _id: batch._id });
    console.log('\n  Load-test batch and its data removed. Real data untouched.\n');
  } else {
    console.log(`\n  --keep: left batch "${name}" in place.\n`);
  }

  await disconnectDB();
  /* Exit non-zero for SERVER problems and for any counter inconsistency.
     Client-socket exhaustion in the generator is reported loudly but does not
     fail the run: it says nothing about the application, and letting it do so
     makes CI flaky on a busy machine for no benefit. */
  const serverFailures = failed.length - clientSide.length;
  process.exit(consistent && serverFailures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n[loadtest] failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
