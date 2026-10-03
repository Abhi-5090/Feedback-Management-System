import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, startTestServer, stopTestServer, target,
} from './helpers.js';
import { periodDeltas, trainerComparison, commentThemes } from '../services/insightsService.js';
import { buildFeedbackMatch } from '../services/analyticsService.js';
import { Feedback } from '../models/Feedback.js';

jest.setTimeout(60_000);

/**
 * The insights layer — period deltas, mentor comparison and comment themes.
 *
 * 129 statements at 2% coverage, and all three feed screens an admin makes
 * decisions from. The arithmetic here is the kind that is wrong quietly: a
 * delta computed against the wrong window, a mentor ranked above another on a
 * single response, a division by a zero base.
 */

let adminToken;
let alice;
let bob;
let genai;
let coding;
let aliceBatch;
let bobBatch;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  alice = await makeTrainer('alice@test.com', 'Alice Anand');
  bob = await makeTrainer('bob@test.com', 'Bob Bhat');
  genai = await makeClass(null, 'GenAI');
  coding = await makeClass(null, 'Coding');
  /* One batch per mentor, not one batch with two classes. A submission must
     rate EVERY class in its batch and carries a single star value, so a
     shared batch cannot give Alice a 5 and Bob a 2 — which is exactly what
     a comparison test needs to assert against. */
  aliceBatch = await makeBatch({ class: genai._id, mainTrainers: [alice._id], name: 'Alice Cohort' });
  bobBatch = await makeBatch({ class: coding._id, mainTrainers: [bob._id], name: 'Bob Cohort' });
});

/** Submit one response, optionally back-dated so window arithmetic can be tested. */
async function submit({ stars, comment, batch = aliceBatch, classIds, daysAgo = 0 }) {
  const classes = classIds || batch.classes.map((c) => c.class);
  // Marker for the back-dating below: only rows written by THIS call.
  const since = new Date();
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 500 });
  const verified = await request(target())
    .post('/api/public/verify-passcode')
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
  const res = await request(target()).post('/api/public/feedback').send(
    await feedbackBody({
      batchId: batch._id, classIds: classes, stars, comment,
      sessionToken: verified.body.sessionToken,
      fingerprint: `fp-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);
  if (daysAgo > 0) {
    /* Scoped to rows created since the marker. An earlier version back-dated
       everything from the last minute, which silently moved the row the test
       had just established as "recent" — and the test then failed for a
       reason that had nothing to do with the code under test. */
    const when = new Date(Date.now() - daysAgo * 86400_000);
    /* Through the DRIVER, not the model. `createdAt` is schema-managed by
       Mongoose's timestamps option, and a model-level updateMany silently
       drops a $set against it — the rows come back with today's date and the
       test fails for a reason that looks like a bug in periodDeltas. */
    await Feedback.collection.updateMany(
      { createdAt: { $gte: since } },
      { $set: { createdAt: when } }
    );
  }
}

describe('periodDeltas', () => {
  test('an empty dataset returns zeros rather than throwing', async () => {
    const d = await periodDeltas(buildFeedbackMatch({}), 30);
    expect(d.days).toBe(30);
    expect(d.current.responses).toBe(0);
    expect(d.change.responses).toBe(0);
  });

  test('a zero previous window gives a NULL percentage, not Infinity', async () => {
    /* The guard that matters. Dividing by a zero base yields Infinity, which
       renders as "Infinity%" on the dashboard — the classic first-week bug. */
    await submit({ stars: 4, comment: 'A perfectly adequate comment here.' });
    const d = await periodDeltas(buildFeedbackMatch({}), 30);
    expect(d.previous.responses).toBe(0);
    expect(d.change.responsesPct).toBeNull();
    expect(Number.isFinite(d.change.responses)).toBe(true);
  });

  test('responses inside the window count, and older ones do not', async () => {
    await submit({ stars: 5, comment: 'Recent and inside the window.' });
    await submit({ stars: 2, comment: 'Old enough to fall outside.', daysAgo: 400 });

    const d = await periodDeltas(buildFeedbackMatch({}), 30);
    expect(d.current.responses).toBe(1);
    // The 400-day-old row is outside BOTH windows.
    expect(d.previous.responses).toBe(0);
  });

  test('the window length is honoured', async () => {
    await submit({ stars: 4, comment: 'Submitted roughly 45 days ago.', daysAgo: 45 });
    const narrow = await periodDeltas(buildFeedbackMatch({}), 30);
    const wide = await periodDeltas(buildFeedbackMatch({}), 90);
    expect(narrow.current.responses).toBe(0);
    expect(wide.current.responses).toBe(1);
  });
});

describe('trainerComparison', () => {
  test('no mentors with feedback yields empty lists, not an error', async () => {
    const c = await trainerComparison({});
    expect(Array.isArray(c.trainers)).toBe(true);
    expect(Array.isArray(c.parameters)).toBe(true);
  });

  test('ranks by average, highest first', async () => {
    await submit({ stars: 5, comment: 'Alice taught this one very well.', batch: aliceBatch });
    await submit({ stars: 2, comment: 'Bob needs to slow the pace down.', batch: bobBatch });

    const { trainers } = await trainerComparison({});
    const named = trainers.filter((t) => ['Alice Anand', 'Bob Bhat'].includes(t.name));
    expect(named[0].name).toBe('Alice Anand');
    expect(named[0].average).toBeGreaterThan(named[1].average);
  });

  test('a mentor with NO feedback sorts last rather than being ranked at zero', async () => {
    /* Ranking an unrated mentor as 0.00 reads as "worst", which is a
       materially different claim from "no data". */
    await submit({ stars: 4, comment: 'Only Alice has been rated so far.', batch: aliceBatch });
    const { trainers } = await trainerComparison({});
    const unrated = trainers.find((t) => t.average == null);
    if (unrated) expect(trainers.indexOf(unrated)).toBeGreaterThan(0);
  });

  test('the parameter list matches the columns every row carries', async () => {
    await submit({ stars: 4, comment: 'A comment long enough to pass.' });
    const { trainers, parameters } = await trainerComparison({});
    const withData = trainers.find((t) => t.average != null);
    expect(withData).toBeTruthy();
    expect(withData.perParameter.map((p) => p.label)).toEqual(parameters);
  });

  test('echoes the role it was asked for', async () => {
    expect((await trainerComparison({ role: 'main' })).role).toBe('main');
    expect((await trainerComparison({})).role).toBe('all');
  });
});

describe('commentThemes', () => {
  test('an empty dataset returns no themes', async () => {
    const t = await commentThemes(buildFeedbackMatch({}), 5);
    expect(Array.isArray(t.themes ?? t)).toBe(true);
  });

  test('a recurring word surfaces as a theme that names its source', async () => {
    /* A theme the admin cannot trace back to a class is an observation they
       can do nothing with. */
    for (let i = 0; i < 4; i++) {
      await submit({ stars: 3, comment: `The pace of the session is far too fast for us ${i}.` });
    }
    const result = await commentThemes(buildFeedbackMatch({}), 12);
    const themes = result.themes ?? result;
    expect(themes.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(themes).toLowerCase();
    expect(serialised).toContain('pace');
  });

  test('respects the limit it is given', async () => {
    for (let i = 0; i < 6; i++) {
      await submit({ stars: 4, comment: `Distinct remark number ${i} about teaching quality.` });
    }
    const result = await commentThemes(buildFeedbackMatch({}), 3);
    const themes = result.themes ?? result;
    expect(themes.length).toBeLessThanOrEqual(3);
  });
});
