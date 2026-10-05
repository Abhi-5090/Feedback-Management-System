/**
 * The dashboard statistics, checked against figures worked out by hand.
 *
 * An aggregation that is subtly wrong still returns a plausible number, and a
 * plausible number on a dashboard is believed. Every expectation here is
 * arithmetic done on paper first: 8 parameters per submission, so N
 * submissions at S stars contribute exactly 8N rating lines of value S.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target, DEFAULT_PARAMS,
} from './helpers.js';
import {
  ratingDistribution, parameterBySubject, sessionRanking, commentDepth, collectionHealth,
  coverageTotals,
} from '../services/dashboardStatsService.js';
import { Phase } from '../models/Phase.js';
import { Feedback } from '../models/Feedback.js';
import { buildScopedMatch } from '../services/analyticsService.js';

jest.setTimeout(60_000);

const P = DEFAULT_PARAMS.length; // 8 rating lines per submission
let alice, bob, coding, genai, codingBatch, genaiBatch, adminToken;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

/** n submissions to one batch, every parameter at `stars`. */
async function submitMany(batch, classIds, { n, stars, comment }) {
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 500 });
  expect(unlocked.status).toBe(200);

  for (let i = 0; i < n; i += 1) {
    const verified = await request(target())
      .post('/api/public/verify-passcode')
      .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
    const res = await request(target()).post('/api/public/feedback').send(
      await feedbackBody({
        batchId: batch._id,
        classIds,
        stars,
        comment,
        sessionToken: verified.body.sessionToken,
        fingerprint: `fp-${batch._id}-${stars}-${i}-${Math.random()}`,
      })
    );
    expect(res.status).toBe(201);
  }
}

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  alice = await makeTrainer('alice@test.com', 'Alice Anand');
  bob = await makeTrainer('bob@test.com', 'Bob Bhat');
  coding = await makeClass(null, 'Coding');
  genai = await makeClass(null, 'GenAI');
  codingBatch = await makeBatch({
    class: coding._id, mainTrainers: [alice._id], supportTrainers: [],
    name: 'Coding Cohort', yearGroup: 'Final Year',
  });
  genaiBatch = await makeBatch({
    class: genai._id, mainTrainers: [bob._id], supportTrainers: [],
    name: 'GenAI Cohort', yearGroup: 'Third Year',
  });
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
});

describe('rating distribution — the figure a mean hides', () => {
  test('buckets, percentages and the promoter split are exact', async () => {
    // 3 submissions at 5★ and 2 at 2★ → 24 lines of 5, 16 lines of 2, 40 total.
    await submitMany(codingBatch, [coding._id], { n: 3, stars: 5 });
    await submitMany(codingBatch, [coding._id], { n: 2, stars: 2 });

    const d = await ratingDistribution({});
    expect(d.total).toBe(5 * P);
    expect(d.buckets.find((b) => b.stars === 5)).toEqual({ stars: 5, count: 3 * P, pct: 60 });
    expect(d.buckets.find((b) => b.stars === 2)).toEqual({ stars: 2, count: 2 * P, pct: 40 });
    expect(d.buckets.find((b) => b.stars === 4).count).toBe(0);

    // (24×5 + 16×2) / 40 = 3.8
    expect(d.average).toBe(3.8);
    expect(d.promoters).toBe(3 * P);
    expect(d.detractors).toBe(2 * P);
    expect(d.passives).toBe(0);
    expect(d.promoterPct).toBe(60);
    expect(d.detractorPct).toBe(40);

    /* Population variance = (24·1.2² + 16·1.8²)/40 = 2.16 → σ ≈ 1.47.
       A 3.8 average made of 5s and 2s and nothing between — which is the
       whole reason this number is on the page. */
    expect(d.stdDev).toBe(1.47);
  });

  test('a unanimous cohort has zero spread', async () => {
    await submitMany(codingBatch, [coding._id], { n: 4, stars: 4 });
    const d = await ratingDistribution({});
    expect(d.average).toBe(4);
    expect(d.stdDev).toBe(0);
    expect(d.promoterPct).toBe(100);
  });

  test('no feedback yields zeroes rather than NaN', async () => {
    const d = await ratingDistribution({});
    expect(d).toMatchObject({ total: 0, average: 0, stdDev: 0, promoterPct: 0 });
    expect(d.buckets).toHaveLength(5);
  });
});

describe('subject × parameter grid', () => {
  test('each subject gets a dense row aligned to the parameter list', async () => {
    await submitMany(codingBatch, [coding._id], { n: 2, stars: 5 });
    await submitMany(genaiBatch, [genai._id], { n: 2, stars: 3 });

    const g = await parameterBySubject({});
    expect(g.parameters).toHaveLength(P);
    expect(g.subjects).toHaveLength(2);
    for (const s of g.subjects) {
      expect(s.cells).toHaveLength(g.parameters.length); // dense, never sparse
      expect(s.cells.every((c) => c !== null)).toBe(true);
    }
    // Weakest first — the ordering the panel depends on.
    expect(g.subjects.map((s) => s.name)).toEqual(['GenAI', 'Coding']);
    expect(g.subjects[0].average).toBe(3);
    expect(g.subjects[1].average).toBe(5);
  });
});

describe('session ranking refuses to rank noise', () => {
  test('a session below the response floor is excluded and counted', async () => {
    await submitMany(codingBatch, [coding._id], { n: 12, stars: 5 });
    await submitMany(genaiBatch, [genai._id], { n: 3, stars: 1 }); // too few to judge

    const r = await sessionRanking({}, { minResponses: 10 });
    expect(r.ranked).toBe(1);
    expect(r.belowFloor).toBe(1);
    expect(r.top.map((s) => s.batchName)).toEqual(['Coding Cohort']);
    // The 1★ session must NOT appear at the bottom — three responses is not a verdict.
    expect(r.bottom.map((s) => s.batchName)).not.toContain('GenAI Cohort');
  });

  test('averages and response counts on a ranked row are right', async () => {
    await submitMany(codingBatch, [coding._id], { n: 10, stars: 4 });
    const r = await sessionRanking({}, { minResponses: 10 });
    expect(r.top[0]).toMatchObject({ responses: 10, average: 4, batchName: 'Coding Cohort' });
  });
});

describe('comment depth', () => {
  test('buckets comments by how much they actually say', async () => {
    /* The form requires a comment, so coverage is 100% by construction and the
       informative axis is length. */
    await submitMany(codingBatch, [coding._id], { n: 2, stars: 5, comment: 'Great pacing' });
    await submitMany(genaiBatch, [genai._id], {
      n: 1, stars: 5,
      comment:
        'The session was thorough and the worked examples genuinely helped me follow the ' +
        'harder parts of the material today, and I would happily sit through it again next term',
    });

    const c = await commentDepth({});
    expect(c.total).toBe(3);
    expect(c.withComment).toBe(3);
    expect(c.pct).toBe(100);
    expect(c.brief).toBe(2);     // "Great pacing" = 2 words
    expect(c.detailed).toBe(1);  // 29 words
    expect(c.moderate).toBe(0);
    expect(c.avgWords).toBeGreaterThan(6);
  });

  test('no feedback yields zeroes rather than NaN', async () => {
    const c = await commentDepth({});
    expect(c).toMatchObject({ total: 0, avgWords: 0, briefPct: 0 });
  });
});

describe('collection health is scoped like everything else', () => {
  test("a mentor's view covers only their own cohorts", async () => {
    await submitMany(codingBatch, [coding._id], { n: 5, stars: 5 });
    await submitMany(genaiBatch, [genai._id], { n: 5, stars: 5 });

    const all = await collectionHealth({});
    expect(all.map((b) => b.name).sort()).toEqual(['Coding Cohort', 'GenAI Cohort']);

    const mine = await collectionHealth({ scopeBatchIds: [codingBatch._id] });
    expect(mine.map((b) => b.name)).toEqual(['Coding Cohort']);
    expect(mine[0]).toMatchObject({ answered: 5, expected: 500, rate: 1 });
  });

  test('worst turnout first, because that is what needs acting on', async () => {
    await submitMany(codingBatch, [coding._id], { n: 20, stars: 5 });
    await submitMany(genaiBatch, [genai._id], { n: 2, stars: 5 });
    const rows = await collectionHealth({});
    expect(rows[0].name).toBe('GenAI Cohort');
  });
});

describe('the mentor dashboard reports these over their own sessions only', () => {
  test('a mentor sees their distribution, not the institution\'s', async () => {
    await submitMany(codingBatch, [coding._id], { n: 2, stars: 5 }); // Alice
    await submitMany(genaiBatch, [genai._id], { n: 2, stars: 1 });   // Bob

    const aliceMatch = await buildScopedMatch({ scopeTrainerId: alice._id });
    const d = await ratingDistribution(aliceMatch);
    expect(d.total).toBe(2 * P);
    expect(d.average).toBe(5);
    expect(d.detractors).toBe(0); // Bob's 1★ cohort is not hers to see

    const token = await loginToken(request, 'alice@test.com', TRAINER_PASSWORD);
    const res = await request(target())
      .get('/api/dashboard/trainer/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.distribution.average).toBe(5);
    expect(res.body.stats.health.map((b) => b.name)).toEqual(['Coding Cohort']);
  });
});

describe('collection health under a phase filter', () => {
  /**
   * The bug: selecting a phase that had collected nothing still showed the
   * PREVIOUS phase's turnout. Response rate and the per-cohort panel both
   * queried Batch directly and never saw the phase, so a dashboard scoped to
   * November reported September's 57.8% and looked like work already done.
   */
  let phase1, phase2;

  const makePhase = (name, startsAt, endsAt) =>
    Phase.create({ name, code: name.toLowerCase().replace(/\W+/g, '-'), startsAt, endsAt, status: 'open' });

  beforeEach(async () => {
    phase1 = await makePhase('Phase 1', new Date('2026-01-01'), new Date('2026-02-01'));
    phase2 = await makePhase('Phase 2', new Date('2026-02-01'), new Date('2026-03-01'));
    await submitMany(codingBatch, [coding._id], { n: 5, stars: 5 });
    // Stamp everything collected so far onto phase 1.
    await Feedback.updateMany({}, { $set: { phase: phase1._id } });
  });

  test('a phase that has collected nothing reports nothing, not the last one', async () => {
    const h2 = await collectionHealth({ phase: phase2 });
    expect(h2).toEqual([]);
    expect(coverageTotals(h2)).toMatchObject({ expected: 0, submitted: 0, responseRate: 0 });

    // And the phase that DID collect is unaffected.
    const h1 = await collectionHealth({ phase: phase1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toMatchObject({ name: 'Coding Cohort', answered: 5 });
  });

  test('a cohort collected in another phase does not appear at 0%', async () => {
    /* Listing it at 0% would read as a cohort that refused to answer, which is
       a different and much worse claim than "this round has not started". */
    const names = (await collectionHealth({ phase: phase2 })).map((b) => b.name);
    expect(names).not.toContain('Coding Cohort');
  });

  test('a cohort open in the CURRENT phase appears, so the panel fills in live', async () => {
    /* The batch-by-batch view: unlock a cohort and it should show up straight
       away with its turnout climbing, not only once collection is finished. */
    await request(target())
      .post(`/api/batches/${genaiBatch._id}/unlock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expectedCount: 50 });

    const live = await collectionHealth({ phase: phase2, phaseIsCurrent: true });
    expect(live.map((b) => b.name)).toContain('GenAI Cohort');
    expect(live.find((b) => b.name === 'GenAI Cohort')).toMatchObject({ answered: 0, rate: 0 });

    // Not current → an open cohort is not pulled into a phase that is not collecting.
    const notLive = await collectionHealth({ phase: phase2, phaseIsCurrent: false });
    expect(notLive.map((b) => b.name)).not.toContain('GenAI Cohort');
  });

  test('with no phase selected the overall figures are unchanged', async () => {
    const all = await collectionHealth({});
    expect(all.map((b) => b.name).sort()).toEqual(['Coding Cohort', 'GenAI Cohort']);
  });

  test('the headline rate always equals the panel it summarises', async () => {
    /* One computation, deliberately: these were two aggregations over two
       definitions, which is how the KPI and the panel came to disagree. */
    for (const opts of [{}, { phase: phase1 }, { phase: phase2 }]) {
      const h = await collectionHealth(opts);
      const c = coverageTotals(h);
      expect(c.submitted).toBe(h.reduce((n, b) => n + b.answered, 0));
      expect(c.expected).toBe(h.reduce((n, b) => n + b.expected, 0));
    }
  });

  test('the admin dashboard reports the phase it was asked for', async () => {
    const res = await request(target())
      .get(`/api/dashboard/admin?phase=${phase2._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.health).toEqual([]);
    expect(res.body.kpis.expectedResponses).toBe(0);
    expect(res.body.kpis.responseRate).toBe(0);

    const one = await request(target())
      .get(`/api/dashboard/admin?phase=${phase1._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(one.body.stats.health).toHaveLength(1);
    expect(one.body.kpis.submittedResponses).toBe(5);
  });
});
