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
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
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
    }`
  );
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
