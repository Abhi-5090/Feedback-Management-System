/**
 * Boot the REAL backend against a disposable database, for the E2E suite.
 *
 * Playwright's `webServer` runs a command; it cannot hand that command a URI
 * that does not exist until the command starts. So this script owns both: it
 * brings up an in-memory Mongo replica set (replica set, not standalone, so
 * the feedback transaction path is the one actually exercised), seeds the
 * fixtures the tests need, exports MONGO_URI, and only then imports the
 * server — which reads the variable at module load like it always does.
 *
 * Nothing here is a test double. The server, the routes, the middleware, the
 * rate limiters and the transaction are all the production code paths. What is
 * disposable is the data.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = process.env.E2E_API_PORT || '5051';

const replset = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});

process.env.MONGO_URI = replset.getUri('fms_e2e');
process.env.PORT = PORT;
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = process.env.E2E_LOG_LEVEL || 'warn';
/* A secret long enough to clear the boot guard. Disposable by construction:
   the database it protects is destroyed when this process exits. */
process.env.JWT_SECRET = 'e2e-only-secret-'.padEnd(64, 'x');
process.env.DEVICE_SALT = 'e2e-only-salt-'.padEnd(64, 'y');
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';
process.env.CLIENT_ORIGINS = `http://localhost:${process.env.E2E_WEB_PORT || 5174}`;
process.env.DIGESTS_ENABLED = 'false';
// No keep-alive, no error reporting: a test run must reach nothing external.
delete process.env.KEEP_ALIVE_URL;
delete process.env.SENTRY_DSN;

const { connectDB } = await import('../FMS_Backend/src/config/db.js');
await connectDB(process.env.MONGO_URI);

const { seedE2E } = await import('./seed.mjs');
const fixtures = await seedE2E();

/* The tests need the seeded ids. Written to a file rather than exposed on an
   endpoint: an endpoint that dumps fixture ids is one more thing that could
   ship by accident, and a file cannot. */
const { writeFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '.fixtures.json'), JSON.stringify(fixtures, null, 2));

const { createApp } = await import('../FMS_Backend/src/app.js');
const app = createApp();

app.listen(Number(PORT), () => {
  // Playwright waits for this line's port to answer; the fixture dump lets the
  // tests know the ids without re-deriving them.
  process.stdout.write(`[e2e] api on :${PORT} with ${JSON.stringify(fixtures)}\n`);
});

const shutdown = async () => {
  await replset.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
