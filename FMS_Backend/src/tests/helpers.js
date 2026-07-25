/**
 * Test harness: spins up an in-memory MongoDB REPLICA SET (so the feedback
 * transaction path is exercised, not just the fallback), connects via the
 * app's own connectDB (which runs the transaction-support probe), and seeds
 * the fixtures most tests need.
 *
 * We point mongodb-memory-server at the system mongod binary
 * (MONGOMS_SYSTEM_BINARY) so no binary is downloaded in CI/offline.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB, supportsTransactions } from '../config/db.js';
import { createApp } from '../app.js';
import { User } from '../models/User.js';
import { Parameter } from '../models/Parameter.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { hashPassword } from '../utils/password.js';

let replset;

export const DEFAULT_PARAMS = [
  'Content clarity',
  "Trainer's subject knowledge",
  'Pace of the session',
  'Engagement & interaction',
  'Doubt resolution',
  'Real-world / practical examples',
  'Quality of materials',
  'Overall experience',
];

export async function startTestDB() {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDB(replset.getUri());
  return replset;
}

export async function stopTestDB() {
  await disconnectDB();
  if (replset) await replset.stop();
}

export async function resetDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export { supportsTransactions };
export const app = createApp();

/** Seed parameters + an admin and return admin credentials/token helpers. */
export async function seedBasics() {
  await Parameter.insertMany(DEFAULT_PARAMS.map((label, i) => ({ label, order: i })));
  const admin = await User.create({
    name: 'Admin',
    email: 'admin@test.com',
    passwordHash: await hashPassword('adminpass'),
    role: 'admin',
  });
  return { admin };
}

export async function makeTrainer(email = 'trainer@test.com') {
  return User.create({
    name: `Trainer ${email}`,
    email,
    passwordHash: await hashPassword('trainerpass'),
    role: 'trainer',
  });
}

export async function makeClass(trainerId, name = 'React Fundamentals') {
  return Class.create({ name, trainer: trainerId });
}

export async function makeBatch(classId, name = 'Batch One', expectedCount = 2) {
  return Batch.create({ class: classId, name, expectedCount });
}

/** Fetch active parameter ids to build a complete ratings array. */
export async function activeParamIds() {
  const params = await Parameter.find({ isActive: true }).sort({ order: 1 });
  return params.map((p) => String(p._id));
}
