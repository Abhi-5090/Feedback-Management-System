import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { startDigestScheduler, stopDigestScheduler } from './services/digestService.js';
import { startKeepAlive, stopKeepAlive } from './services/keepAlive.js';
import { warnIfMailUnconfigured } from './services/emailService.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { initSentry, captureException } from './config/sentry.js';

async function start() {
  // Before connectDB: a failure to reach Atlas is exactly the kind of startup
  // error that should be reported rather than only printed.
  await initSentry();
  await connectDB();

  /* Only ONE worker schedules digests. Four workers each running an hourly
     timer would do four times the work to send the same mail. The sends are
     also claimed atomically in the database, so a mistake here still cannot
     produce a duplicate — this is the cheap layer, that is the correct one. */
  const workerIndex = process.env.WORKER_INDEX;
  if (!workerIndex || workerIndex === '1') {
    startDigestScheduler();
    // Once per deployment, not once per worker.
    warnIfMailUnconfigured();
    // Same reasoning: one pinger, not one per worker.
    startKeepAlive();
  }
  const app = createApp();

  const server = app.listen(env.port, () => {
    const who = process.env.WORKER_INDEX ? ` worker#${process.env.WORKER_INDEX} pid ${process.pid}` : '';
      logger.info({ port: env.port, env: env.nodeEnv, worker: process.env.WORKER_INDEX || null, commit: env.commit || undefined }, `listening on :${env.port}${who}`);
  });

  /* Keep-alive tuning for life behind a load balancer. If the server closes an
     idle connection at the same moment the balancer reuses it, the balancer
     reports a 502 that never touched application code — a genuinely confusing
     class of intermittent failure. The fix is to make the server's timeout
     LONGER than the balancer's idle timeout (AWS ALB defaults to 60s). */
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  /**
   * Graceful shutdown.
   *
   * Without this, a redeploy or Ctrl-C kills the process mid-request. The
   * feedback write is a multi-document transaction, so a hard kill between the
   * device lock and the counter increment is exactly the case the transaction
   * exists to prevent — and on a standalone Mongo (no transaction) it would
   * leave a lock with no response behind it. Draining first lets in-flight
   * writes finish or abort cleanly.
   */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received — draining connections');

    stopDigestScheduler();
    stopKeepAlive();

    // Stop accepting new connections, then wait for the open ones.
    const closed = new Promise((resolve) => server.close(resolve));
    // Don't hang forever on a stuck keep-alive socket.
    const timeout = new Promise((resolve) => setTimeout(resolve, 10_000).unref?.());
    await Promise.race([closed, timeout]);

    await disconnectDB().catch((err) => logger.error({ err: err.message }, 'database close failed'));
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  /* An unhandled rejection leaves the process in an unknown state. Log loudly
     and exit so the supervisor restarts a clean one, rather than serving
     requests from a half-broken instance. */
  process.on('unhandledRejection', (err) => {
    logger.fatal({ err: err?.message, stack: err?.stack }, 'unhandled rejection');
  captureException(err, { phase: 'unhandledRejection' });
    shutdown('unhandledRejection');
  });

  return server;
}

start().catch((err) => {
  logger.fatal({ err: err?.message, stack: err?.stack }, 'failed to start');
  captureException(err, { phase: 'startup' });
  process.exit(1);
});
