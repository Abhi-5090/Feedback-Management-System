import mongoose from 'mongoose';
import { env } from './env.js';

let transactionsSupported = false;

/**
 * Whether the connected MongoDB deployment supports multi-document
 * transactions (i.e. it is a replica set or mongos). We probe once on connect
 * and cache the answer so the feedback write can pick transaction vs. ordered
 * best-effort mode without paying a probe cost per request.
 */
export const supportsTransactions = () => transactionsSupported;

export async function connectDB(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  /* Pool size is PER PROCESS, and clustering multiplies it.
     MONGO_MAX_POOL_SIZE is the budget for the whole deployment, so it is
     divided by the worker count here. Without this, 8 workers × 150 would open
     1,200 connections against an Atlas shared tier that caps the cluster at
     500 — the app would come up, run fine under light load, and then start
     refusing connections during exactly the burst it was scaled for. */
  const workers = Math.max(1, parseInt(process.env.WEB_CONCURRENCY || '1', 10));
  const perProcessPool = Math.max(10, Math.floor(env.mongoMaxPoolSize / workers));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: perProcessPool,
    // Keep a warm floor so a burst isn't paying TLS handshakes to Atlas at the
    // exact moment it is busiest.
    minPoolSize: Math.min(5, perProcessPool),
    // Do not queue forever behind an exhausted pool: fail the request with a
    // clear error instead of holding a student's browser open indefinitely.
    waitQueueTimeoutMS: 10000,
  });

  // Probe transaction support RELIABLY via the `hello` command. Multi-document
  // transactions require a replica set (`setName` present) or a sharded cluster
  // (`msg === 'isdbgrid'`). A standalone reports neither. (An empty
  // start/abort transaction can succeed on a standalone without contacting the
  // server, so we must NOT infer support from that.)
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    transactionsSupported = false;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[db] connected (${mongoose.connection.host}) — transactions: ${
      transactionsSupported ? 'enabled' : 'unavailable (standalone) → ordered-write fallback'
    }, pool ${perProcessPool}${workers > 1 ? ` (${env.mongoMaxPoolSize} shared across ${workers} workers)` : ''}`
  );
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
