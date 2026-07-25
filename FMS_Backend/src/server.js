import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { startDigestScheduler } from './services/digestService.js';
import { env } from './config/env.js';

async function start() {
  await connectDB();
  startDigestScheduler();
  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${env.port}  (${env.nodeEnv})`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to start:', err);
  process.exit(1);
});
