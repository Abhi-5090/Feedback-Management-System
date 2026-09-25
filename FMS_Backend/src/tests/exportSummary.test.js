/**
 * The dashboard export's summary: one row per (batch, subject, mentor) with the
 * rating that session received.
 *
 * This is now the ENTIRE content of the dashboard PDF, so the aggregation
 * behind it has to be right about the things that are easy to get wrong and
 * invisible once printed: who appears, how often, and what number sits beside
 * their name.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';
import { mentorRatings, buildFeedbackMatch } from '../services/analyticsService.js';

jest.setTimeout(60_000);

let alice; // main on Coding
let bob;   // support on Coding, main on GenAI
let coding;
let genai;
let codingBatch;
let genaiBatch;
let adminToken;

beforeAll(async () => {
  await startTestDB();
  startTestServer();
});
afterAll(async () => {
  stopTestServer();
  await stopTestDB();
});

async function submitTo(batch, classIds, stars) {
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 20 });
  expect(unlocked.status).toBe(200);

  const verified = await request(target())
    .post('/api/public/verify-passcode')
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
  expect(verified.status).toBe(200);

  const res = await request(target()).post('/api/public/feedback').send(
    await feedbackBody({
      batchId: batch._id,
      classIds,
      stars,
      comment: 'A perfectly adequate comment for testing.',
      sessionToken: verified.body.sessionToken,
      fingerprint: `fp-${batch._id}-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);

  alice = await makeTrainer('alice@test.com', 'Alice Anand');
  bob = await makeTrainer('bob@test.com', 'Bob Bhat');

  coding = await makeClass(null, 'Coding');
  genai = await makeClass(null, 'GenAI');

  codingBatch = await makeBatch({
    class: coding._id,
    mainTrainers: [alice._id],
    supportTrainers: [bob._id],
    name: 'Coding Cohort',
  });
  genaiBatch = await makeBatch({
    class: genai._id,
    mainTrainers: [bob._id],
    supportTrainers: [],
    name: 'GenAI Cohort',
  });
});

const find = (rows, batchName, mentorName) =>
  rows.find((r) => r.batchName === batchName && r.mentorName === mentorName);

describe('mentorRatings', () => {
  test('lists every mentor of a session, in either role', async () => {
    await submitTo(codingBatch, [coding._id], 4);
    const rows = await mentorRatings(buildFeedbackMatch({}));

    // Alice delivered it, Bob assisted — both taught the batch, both appear.
    expect(rows.map((r) => r.mentorName).sort()).toEqual(['Alice', 'Bob']);
    expect(find(rows, 'Coding Cohort', 'Alice').average).toBe(4);
    expect(find(rows, 'Coding Cohort', 'Bob').average).toBe(4);
  });

  test('a mentor listed on TWO batches gets a row for each', async () => {
    await submitTo(codingBatch, [coding._id], 4);
    await submitTo(genaiBatch, [genai._id], 2);
    const rows = await mentorRatings(buildFeedbackMatch({}));

    expect(rows).toHaveLength(3); // Alice/Coding, Bob/Coding, Bob/GenAI
    expect(find(rows, 'Coding Cohort', 'Bob').average).toBe(4);
    expect(find(rows, 'GenAI Cohort', 'Bob').average).toBe(2);
  });

  test('a mentor on BOTH rosters of one session is counted once, not twice', async () => {
    /* The rosters are folded with $setUnion before unwinding. Without that,
       someone listed as main AND support on the same class produces two
       identical rows — and a printed sheet showing the same name twice under
       one batch looks like a data error nobody can explain. */
    const both = await makeBatch({
      class: coding._id,
      mainTrainers: [alice._id],
      supportTrainers: [alice._id],
      name: 'Solo Cohort',
    });
    await submitTo(both, [coding._id], 5);

    const rows = (await mentorRatings(buildFeedbackMatch({}))).filter(
      (r) => r.batchName === 'Solo Cohort'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].average).toBe(5);
    expect(rows[0].responses).toBe(1);
  });

  test('responses counts submissions, not rating lines', async () => {
    // One submission carries one star per parameter (8 of them by default).
    await submitTo(codingBatch, [coding._id], 5);
    await submitTo(codingBatch, [coding._id], 3);
    const row = find(await mentorRatings(buildFeedbackMatch({})), 'Coding Cohort', 'Alice');
    expect(row.responses).toBe(2);
    expect(row.average).toBe(4); // mean of 5 and 3, not a sum over 16 lines
  });

  test('filtering to one mentor drops their team-mates', async () => {
    await submitTo(codingBatch, [coding._id], 4);
    const rows = await mentorRatings(buildFeedbackMatch({ trainerId: alice._id }), {
      onlyMentorId: alice._id,
    });
    // The match admits every response Alice was part of — which includes the
    // ones Bob assisted on. Asking for Alice must not return Bob.
    expect(rows.map((r) => r.mentorName)).toEqual(['Alice']);
  });

  test('an empty dataset returns no rows rather than throwing', async () => {
    await expect(mentorRatings(buildFeedbackMatch({}))).resolves.toEqual([]);
  });

  test('rows are ordered by batch, then subject, then rating descending', async () => {
    await submitTo(codingBatch, [coding._id], 4);
    await submitTo(genaiBatch, [genai._id], 2);
    const rows = await mentorRatings(buildFeedbackMatch({}));
    expect(rows.map((r) => `${r.batchName}/${r.className}/${r.mentorName}`)).toEqual([
      'Coding Cohort/Coding/Alice',
      'Coding Cohort/Coding/Bob',
      'GenAI Cohort/GenAI/Bob',
    ]);
  });

  test('a batch teaching TWO subjects reports each one separately', async () => {
    /* The case that prompted the layout: "2nd Year Credit Course is there, in
       that we have two things, like a Java and DS". One cohort, two subjects,
       two different scores — collapsing them to one row per mentor would
       average away the only distinction that matters. */
    const java = await makeClass(null, 'JAVA');
    const ds = await makeClass(null, 'DS');
    const credit = await makeBatch({
      classes: [
        { class: java._id, mainTrainers: [alice._id], supportTrainers: [] },
        { class: ds._id, mainTrainers: [bob._id], supportTrainers: [] },
      ],
      name: '2nd Year Credit Course',
    });
    await submitTo(credit, [java._id, ds._id], 5);

    const rows = (await mentorRatings(buildFeedbackMatch({}))).filter(
      (r) => r.batchName === '2nd Year Credit Course'
    );
    expect(rows.map((r) => `${r.className}/${r.mentorName}`)).toEqual(['DS/Bob', 'JAVA/Alice']);
  });

  test('a mentor teaching two subjects in one batch gets a row for each', async () => {
    const java = await makeClass(null, 'JAVA');
    const ds = await makeClass(null, 'DS');
    const credit = await makeBatch({
      classes: [
        { class: java._id, mainTrainers: [alice._id], supportTrainers: [] },
        { class: ds._id, mainTrainers: [alice._id], supportTrainers: [] },
      ],
      name: '2nd Year Credit Course',
    });
    await submitTo(credit, [java._id, ds._id], 4);

    const rows = (await mentorRatings(buildFeedbackMatch({}))).filter(
      (r) => r.batchName === '2nd Year Credit Course'
    );
    // Two rows for Alice, one per subject — not one row averaging both.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.className)).toEqual(['DS', 'JAVA']);
    expect(rows.every((r) => r.mentorName === 'Alice')).toBe(true);
  });
});

describe('GET /api/export/dashboard/admin', () => {
  beforeEach(async () => {
    await submitTo(codingBatch, [coding._id], 4);
    await submitTo(genaiBatch, [genai._id], 2);
  });

  test('the PDF downloads as a real PDF', async () => {
    const res = await request(target())
      .get('/api/export/dashboard/admin?format=pdf')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer()
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('the spreadsheet KEEPS the per-response detail the PDF drops', async () => {
    /* Only the PDF became a summary. An xlsx is for analysis, and dropping
       row-level data from it would be a real loss rather than a tidy-up. */
    const res = await request(target())
      .get('/api/export/dashboard/admin?format=xlsx')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer()
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    // xlsx is a zip; a Detail sheet means the rows are still being assembled.
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
    expect(res.body.length).toBeGreaterThan(3000);
  });

  test('a trainer is still refused the admin dashboard export', async () => {
    const trainerToken = await loginToken(request, 'alice@test.com', 'trainer-fixture-2026');
    const res = await request(target())
      .get('/api/export/dashboard/admin?format=pdf')
      .set('Authorization', `Bearer ${trainerToken}`);
    expect(res.status).toBe(403);
  });
});
