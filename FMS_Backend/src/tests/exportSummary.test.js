/**
 * The dashboard export's summary: one row per SESSION — a (batch, subject)
 * pair — carrying its rating and the mentor team that delivered it.
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
import { sessionRatings, yearRank, buildFeedbackMatch } from '../services/analyticsService.js';

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

const find = (rows, batchName, className) =>
  rows.find((r) => r.batchName === batchName && r.className === className);

describe('yearRank', () => {
  test('orders the years academically, not alphabetically', () => {
    const shuffled = ['Final Year', 'Second Year', 'First Year', 'Third Year'];
    expect([...shuffled].sort((a, b) => yearRank(a) - yearRank(b))).toEqual([
      'First Year',
      'Second Year',
      'Third Year',
      'Final Year',
    ]);
    /* Sorted as text this comes out Final, First, Second, Third — the report
       would open on the outgoing cohort and bury the incoming one. */
    expect([...shuffled].sort()).not.toEqual(['First Year', 'Second Year', 'Third Year', 'Final Year']);
  });

  test('an unknown or missing year sorts last rather than disappearing', () => {
    expect(yearRank('Unassigned')).toBeGreaterThan(yearRank('Final Year'));
    expect(yearRank('')).toBeGreaterThan(yearRank('Final Year'));
    expect(yearRank(undefined)).toBeGreaterThan(yearRank('Final Year'));
  });
});

describe('sessionRatings', () => {
  test('one row per SESSION, naming the whole mentor team', async () => {
    await submitTo(codingBatch, [coding._id], 4);
    const rows = await sessionRatings(buildFeedbackMatch({}));

    // Alice delivered it, Bob assisted — one row, both named, in their roles.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      batchName: 'Coding Cohort',
      className: 'Coding',
      mainMentors: ['Alice'],
      supportMentors: ['Bob'],
      average: 4,
      responses: 1,
    });
  });

  test('a mentor on BOTH rosters is a main mentor, listed once', async () => {
    /* Without the $setDifference their name prints twice on one row — once
       under main and again under support — which reads as a data error. */
    const both = await makeBatch({
      class: coding._id,
      mainTrainers: [alice._id],
      supportTrainers: [alice._id, bob._id],
      name: 'Solo Cohort',
    });
    await submitTo(both, [coding._id], 5);

    const row = find(await sessionRatings(buildFeedbackMatch({})), 'Solo Cohort', 'Coding');
    expect(row.mainMentors).toEqual(['Alice']);
    expect(row.supportMentors).toEqual(['Bob']);
  });

  test('a batch teaching TWO subjects reports each one separately', async () => {
    /* The case that prompted the layout: "2nd Year Credit Course is there, in
       that we have two things, like a Java and DS". */
    const java = await makeClass(null, 'JAVA');
    const ds = await makeClass(null, 'DS');
    const credit = await makeBatch({
      classes: [
        { class: java._id, mainTrainers: [alice._id], supportTrainers: [bob._id] },
        { class: ds._id, mainTrainers: [bob._id], supportTrainers: [] },
      ],
      name: '2nd Year Credit Course',
      yearGroup: 'Second Year',
    });
    await submitTo(credit, [java._id, ds._id], 5);

    const rows = (await sessionRatings(buildFeedbackMatch({}))).filter(
      (r) => r.batchName === '2nd Year Credit Course'
    );
    expect(rows.map((r) => r.className)).toEqual(['DS', 'JAVA']);
    expect(find(rows, '2nd Year Credit Course', 'JAVA').mainMentors).toEqual(['Alice']);
    expect(find(rows, '2nd Year Credit Course', 'JAVA').supportMentors).toEqual(['Bob']);
    expect(find(rows, '2nd Year Credit Course', 'DS').supportMentors).toEqual([]);
  });

  test('responses counts submissions, not rating lines', async () => {
    // One submission carries one star per parameter (8 of them by default).
    await submitTo(codingBatch, [coding._id], 5);
    await submitTo(codingBatch, [coding._id], 3);
    const row = find(await sessionRatings(buildFeedbackMatch({})), 'Coding Cohort', 'Coding');
    expect(row.responses).toBe(2);
    expect(row.average).toBe(4); // mean of 5 and 3, not a sum over 16 lines
  });

  test('rows come back in ACADEMIC year order, not alphabetical', async () => {
    const solo = await makeClass(null, 'Solo');
    const finalYear = await makeBatch({
      class: solo._id, mainTrainers: [alice._id], name: 'Z Final', yearGroup: 'Final Year',
    });
    const firstYear = await makeBatch({
      class: solo._id, mainTrainers: [alice._id], name: 'A First', yearGroup: 'First Year',
    });
    await submitTo(finalYear, [solo._id], 4);
    await submitTo(firstYear, [solo._id], 4);

    const rows = (await sessionRatings(buildFeedbackMatch({}))).filter((r) =>
      ['Z Final', 'A First'].includes(r.batchName)
    );
    // Alphabetically "A First" also comes first, so assert on the YEAR.
    expect(rows.map((r) => r.yearGroup)).toEqual(['First Year', 'Final Year']);
  });

  test('filtering to one mentor keeps only the sessions they were on', async () => {
    await submitTo(codingBatch, [coding._id], 4);
    await submitTo(genaiBatch, [genai._id], 2);
    const rows = await sessionRatings(buildFeedbackMatch({ trainerId: alice._id }), {
      onlyMentorId: alice._id,
    });
    // Alice has nothing to do with the GenAI cohort.
    expect(rows.map((r) => r.batchName)).toEqual(['Coding Cohort']);
  });

  test('an empty dataset returns no rows rather than throwing', async () => {
    await expect(sessionRatings(buildFeedbackMatch({}))).resolves.toEqual([]);
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
