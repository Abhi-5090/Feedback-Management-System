/**
 * cluster.js — run the API across every CPU core.
 *
 * Node executes JavaScript on ONE thread, so a single process saturates around
 * 15–18 submissions/second at typical cloud database latency. That is a hard
 * ceiling no amount of query tuning moves. Forking one worker per core lifts it
 * roughly linearly, and the kernel load-balances accepts across them, so a
 * cohort of 400 arriving together is spread over every core instead of queueing
 * behind one.
 *
 * What this file has to get right, because clustering is where "it worked on
 * my machine" usually dies:
 *
 *   1. RATE LIMITS. Per-process counters would multiply every limit by the
 *      worker count. The primary hosts the counters; workers ask it.
 *      (middleware/clusterRateStore.js)
 *
 *   2. THE DIGEST SCHEDULER. Four workers each running an hourly timer is four
 *      times the work for the same mail. Only worker #1 schedules. The sends
 *      are also individually claimed in the database, so even if this election
 *      were wrong, nobody would get a duplicate.
 *
 *   3. CRASH RECOVERY. A worker that dies is replaced. A worker that dies
 *      *immediately and repeatedly* is a broken build, not a blip — restarting
 *      it forever would spin the CPU and bury the real error, so repeated fast
 *      crashes stop the whole process with a clear message.
 *
 *   4. GRACEFUL SHUTDOWN. SIGTERM is forwarded to every worker, which drains
 *      in-flight requests before exiting. The feedback write is transactional,
 *      so killing mid-request is exactly what the transaction exists to avoid.
 *
 * Run:  npm run start:cluster            (one worker per core)
 *       WEB_CONCURRENCY=4 npm run start:cluster
 *
 * A single process is still `npm start`, and remains the right choice for
 * development and for containers where the orchestrator does the scaling.
 */
import cluster from 'node:cluster';
import os from 'node:os';
import process from 'node:process';
import { installPrimaryRateLimitHub } from './middleware/clusterRateStore.js';

const cpus = os.availableParallelism?.() ?? os.cpus().length;
const requested = parseInt(process.env.WEB_CONCURRENCY || '', 10);
/* Cap at 8: past that, workers contend for the database connection pool and
   the network card more than they add throughput, and Atlas shared tiers cap
   total connections per cluster. */
const WORKERS = Math.max(1, Math.min(requested || cpus, 8));

/** A worker crashing this soon after boot is a broken build, not bad luck. */
const CRASH_WINDOW_MS = 10_000;
const MAX_FAST_CRASHES = 5;

if (cluster.isPrimary) {
  let fastCrashes = 0;
  let shuttingDown = false;

  console.log(`[cluster] primary ${process.pid} starting ${WORKERS} worker(s) on ${cpus} core(s)`);
  installPrimaryRateLimitHub();

  const fork = (index) => {
    const worker = cluster.fork({
      WORKER_INDEX: String(index),
      // Workers divide the deployment-wide connection pool between them.
      WEB_CONCURRENCY: String(WORKERS),
    });
    worker.startedAt = Date.now();
    worker.workerIndex = index;
    return worker;
  };

  for (let i = 0; i < WORKERS; i++) fork(i + 1);

  cluster.on('online', (worker) =>
    console.log(`[cluster] worker ${worker.process.pid} (#${worker.workerIndex}) online`)
  );

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;

    const lifetime = Date.now() - worker.startedAt;
    console.error(
      `[cluster] worker ${worker.process.pid} (#${worker.workerIndex}) exited ` +
        `(code ${code}, signal ${signal || 'none'}) after ${lifetime}ms`
    );

    if (lifetime < CRASH_WINDOW_MS) {
      fastCrashes += 1;
      if (fastCrashes >= MAX_FAST_CRASHES) {
        console.error(
          `[cluster] ${MAX_FAST_CRASHES} workers died within ${CRASH_WINDOW_MS}ms of starting — ` +
            'this is a startup failure, not a transient crash. Check the error above ' +
            '(bad MONGO_URI or a weak secret rejected by the boot guard are the usual causes). Exiting.'
        );
        process.exit(1);
      }
    } else {
      // A long-lived worker dying is an isolated incident; forget old crashes.
      fastCrashes = 0;
    }

    fork(worker.workerIndex);
  });

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster] ${signal} — draining ${Object.keys(cluster.workers).length} worker(s)`);

    for (const worker of Object.values(cluster.workers)) {
      worker.process.kill(signal); // each worker drains via its own handler
    }

    // Backstop: if a worker will not go, do not hang the deploy forever.
    const timer = setTimeout(() => {
      console.error('[cluster] workers did not exit in 15s — forcing');
      for (const worker of Object.values(cluster.workers)) worker.kill('SIGKILL');
      process.exit(1);
    }, 15_000);
    timer.unref?.();

    const check = setInterval(() => {
      if (Object.keys(cluster.workers).length === 0) {
        clearInterval(check);
        clearTimeout(timer);
        console.log('[cluster] all workers exited');
        process.exit(0);
      }
    }, 200);
    check.unref?.();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  // Worker: the ordinary server. Importing it starts it listening; the OS
  // balances incoming connections across every worker bound to the port.
  await import('./server.js');
}
