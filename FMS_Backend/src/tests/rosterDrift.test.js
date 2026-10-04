import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, startTestServer, stopTestServer, target,
} from './helpers.js';
import { Feedback } from '../models/Feedback.js';
import {
  sessionCards,
  overallStats,
  buildScopedMatch,
  MATCH_NOTHING,
} from '../services/analyticsService.js';
import { findRosterDrift } from '../services/rosterDriftService.js';

jest.setTimeout(60_000);

/**
 * Roster drift — the real defect behind "the admin can see this feedback and I
 * cannot".
 *
 * Every Feedback carries a COPY of the rosters as they were at submit time, so
 * a later staffing change cannot rewrite who taught a session that has already
 * been rated. Mentor scoping queries that copy. Both are correct.
 *
 * The consequence is invisible: an admin corrects a batch's roster, and the
 * mentor they just added opens their account to find the session listed with
 * ZERO responses while the admin sees 73. Nothing is broken; nothing explains
 * it. These tests pin down the behaviour AND the explanation.
 */

let adminToken;
let alice;
let bob;
let carol;
let klass;
let batch;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  alice = await makeTrainer('alice@test.com', 'Alice Anand');
  bob = await makeTrainer('bob@test.com', 'Bob Bhat');
  carol = await makeTrainer('carol@test.com', 'Carol Chandra');
  klass = await makeClass(null, 'GenAI');
  batch = await makeBatch({ class: klass._id, mainTrainers: [alice._id], supportTrainers: [], name: 'Cohort' });
});

const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);
const api = (p) => `/api/v1${p}`;

async function submit() {
  const unlocked = await auth(request(target()).post(api(`/batches/${batch._id}/unlock`))).send({ expectedCount: 99 });
  const verified = await request(target())
    .post(api('/public/verify-passcode'))
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
  const res = await request(target()).post(api('/public/feedback')).send(
    await feedbackBody({
      batchId: batch._id, classIds: [klass._id], stars: 4,
      comment: 'A perfectly adequate comment for testing.',
      sessionToken: verified.body.sessionToken, fingerprint: `fp-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);
}

/** Replace the batch's roster, the way an admin correcting a mistake would. */
const restaff = (main, support = []) =>
  auth(request(target()).patch(api(`/batches/${batch._id}`))).send({
    classes: [{ class: String(klass._id), mainTrainers: main.map(String), supportTrainers: support.map(String) }],
  });

describe('the reported symptom', () => {
  test('a mentor added AFTER collection sees the feedback that session holds', async () => {
    /* What was reported: the admin saw 1 response on this session and the
       newly-added mentor saw the card with 0. The roster is what grants
       access, so putting Bob and Carol on the batch hands them the session
       AND what it holds. */
    await submit();
    const locked = await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    expect(locked.status).toBe(200);
    expect((await restaff([bob._id], [carol._id])).status).toBe(200);

    for (const t of [bob, carol]) {
      const cards = await sessionCards({ scopeTrainerId: t._id });
      expect(cards.sessions).toHaveLength(1);
      expect(cards.sessions[0].responses).toBe(1);
    }

    /* And Alice, taken off the batch, no longer sees it. This is the real cost
       of roster-as-permission and it is deliberate: access follows the roster
       in BOTH directions, so the Edit screen is the whole truth about who can
       read what. The feedback still records that Alice taught it. */
    const forAlice = await sessionCards({ scopeTrainerId: alice._id });
    expect(forAlice.sessions).toHaveLength(0);
  });
});

describe('a mentor dashboard cannot contradict itself', () => {
  /**
   * The session list and the KPIs above it were computed from different
   * sources — the CURRENT batch roster and the STAMPED one — so whenever a
   * roster changed they disagreed:
   *
   *   a removed mentor read "1 response, avg 4.00" above an EMPTY list,
   *   an added mentor saw a session card above "0 responses".
   *
   * Neither number was wrong on its own, which is what made it so hard to
   * see. Both now come from the roster, so there is no second opinion.
   */
  const kpiFor = async (t) => overallStats(await buildScopedMatch({ scopeTrainerId: t._id }));

  test('a mentor REMOVED from a batch loses sight of it entirely', async () => {
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([bob._id]);

    const cards = await sessionCards({ scopeTrainerId: alice._id });
    const kpi = await kpiFor(alice);
    expect(cards.sessions).toHaveLength(0);
    expect(kpi.feedbackCount).toBe(0);
  });

  test('a mentor ADDED to a batch sees the session and its responses', async () => {
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([bob._id]);

    const cards = await sessionCards({ scopeTrainerId: bob._id });
    const kpi = await kpiFor(bob);
    expect(cards.sessions).toHaveLength(1);
    expect(cards.sessions[0].responses).toBe(kpi.feedbackCount);
    expect(kpi.feedbackCount).toBe(1);
  });

  test("the totals across a mentor's cards equal their KPI, re-attributed or not", async () => {
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([bob._id]);
    await auth(request(target()).post(api(`/batches/${batch._id}/reattribute`)))
      .send({ classId: String(klass._id) });

    for (const t of [alice, bob]) {
      const cards = await sessionCards({ scopeTrainerId: t._id });
      const kpi = await kpiFor(t);
      const summed = cards.sessions.reduce((n, c) => n + c.responses, 0);
      expect(summed).toBe(kpi.feedbackCount);
    }
  });

  test('a mentor still sees NOTHING of a batch they were never on', async () => {
    /* The guarantee the product is sold on, re-asserted after changing what
       grants access. Widening access is exactly where isolation breaks. */
    await submit();
    const cards = await sessionCards({ scopeTrainerId: carol._id });
    expect(cards.sessions).toHaveLength(0);
    expect((await kpiFor(carol)).feedbackCount).toBe(0);
  });

  test('a mentor staffed on NOTHING sees nothing, not everything', async () => {
    /* The failure mode that matters most: an empty scope collapsing to `{}`
       and returning the whole institution. Carol is on no roster at all. */
    await submit();
    const clause = await buildScopedMatch({ scopeTrainerId: carol._id });
    expect(clause).toEqual(MATCH_NOTHING);
    expect((await overallStats(clause)).feedbackCount).toBe(0);
  });
});

describe('drift is DETECTED and named', () => {
  test('a matching roster reports no drift', async () => {
    await submit();
    expect(await findRosterDrift()).toEqual([]);
  });

  test('a changed roster is reported, with who gains and who loses', async () => {
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([bob._id], [carol._id]);

    const [d] = await findRosterDrift();
    expect(d).toMatchObject({
      batchName: 'Cohort',
      className: 'GenAI',
      responses: 1,
      stamped: { mainTrainers: ['Alice'], supportTrainers: [] },
      current: { mainTrainers: ['Bob'], supportTrainers: ['Carol'] },
    });
    /* The two facts an admin needs to decide, stated rather than implied. */
    expect(d.wouldGain.sort()).toEqual(['Bob', 'Carol']);
    expect(d.wouldLose).toEqual(['Alice']);
  });

  test('the endpoint totals the responses affected', async () => {
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([bob._id]);
    const res = await auth(request(target()).get(api('/batches/roster-drift')));
    expect(res.status).toBe(200);
    expect(res.body.responses).toBe(1);
    expect(res.body.drift).toHaveLength(1);
  });

  test('"roster-drift" is not mistaken for a batch id', async () => {
    const res = await auth(request(target()).get(api('/batches/roster-drift')));
    expect(res.status).toBe(200);
  });
});

describe('drift is REPAIRED only when asked', () => {
  beforeEach(async () => {
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([bob._id], [carol._id]);
  });

  test('nothing moves on its own — detecting does not repair', async () => {
    await auth(request(target()).get(api('/batches/roster-drift')));
    const row = await Feedback.findOne().lean();
    expect(row.mainTrainers.map(String)).toEqual([String(alice._id)]);
  });

  test('re-attributing moves the feedback to the current roster', async () => {
    const res = await auth(request(target()).post(api(`/batches/${batch._id}/reattribute`)))
      .send({ classId: String(klass._id) });
    expect(res.status).toBe(200);
    expect(res.body.modified).toBe(1);

    const row = await Feedback.findOne().lean();
    expect(row.mainTrainers.map(String)).toEqual([String(bob._id)]);
    expect(row.supportTrainers.map(String)).toEqual([String(carol._id)]);
  });

  test('and then the mentor can actually SEE it — the point of the exercise', async () => {
    await auth(request(target()).post(api(`/batches/${batch._id}/reattribute`)))
      .send({ classId: String(klass._id) });

    const forBob = await sessionCards({ scopeTrainerId: bob._id });
    expect(forBob.sessions[0].responses).toBe(1);

    // And Alice, who no longer teaches it, no longer has it.
    const forAlice = await sessionCards({ scopeTrainerId: alice._id });
    expect(forAlice.sessions).toHaveLength(0);
  });

  test('afterwards there is no drift left', async () => {
    await auth(request(target()).post(api(`/batches/${batch._id}/reattribute`)))
      .send({ classId: String(klass._id) });
    expect(await findRosterDrift()).toEqual([]);
  });

  test('it is AUDITED with the previous attribution', async () => {
    /* This rewrites a performance record. "Who did it hold before?" has to be
       answerable afterwards. */
    await auth(request(target()).post(api(`/batches/${batch._id}/reattribute`)))
      .send({ classId: String(klass._id) });

    const audit = await auth(request(target()).get(api('/audit?action=batch.reattribute')));
    expect(audit.body.entries.length).toBeGreaterThan(0);
    const entry = audit.body.entries[0];
    expect(entry.meta.responses).toBe(1);
    expect(entry.meta.from.mainTrainers).toEqual(['Alice']);
    expect(entry.meta.to.mainTrainers).toEqual(['Bob']);
  });

  test('a class not in the batch is refused, not silently ignored', async () => {
    const other = await makeClass(null, 'Elsewhere');
    const res = await auth(request(target()).post(api(`/batches/${batch._id}/reattribute`)))
      .send({ classId: String(other._id) });
    expect(res.body.modified).toBe(0);
    expect(res.body.reason).toBe('class-not-in-batch');
  });

  test('a mentor cannot re-attribute anything', async () => {
    const t = await loginToken(request, 'alice@test.com', 'trainer-fixture-2026');
    const res = await request(target())
      .post(api(`/batches/${batch._id}/reattribute`))
      .set('Authorization', `Bearer ${t}`)
      .send({ classId: String(klass._id) });
    expect(res.status).toBe(403);
  });
});

describe('what must NOT change', () => {
  test('a roster edit never rewrites who the feedback says taught the session', async () => {
    /* Visibility follows the roster now, but ATTRIBUTION still does not. Bob
       joining lets Bob read the session; it must not make the record claim he
       was in a room he was never in. Only an explicit re-attribution does
       that, and it is audited. */
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([alice._id], [bob._id]); // Alice stays, Bob joins

    const row = await Feedback.findOne({ batch: batch._id, class: klass._id }).lean();
    expect(row.mainTrainers.map(String)).toEqual([String(alice._id)]);
    expect(row.supportTrainers.map(String)).toEqual([]);
  });

  test('the roster is the whole truth about who can read a session', async () => {
    /* Both directions, asserted together, because this is the property the
       admin is promised when they edit a roster: whoever is on it sees the
       feedback, whoever is off it does not. */
    await submit();
    await auth(request(target()).post(api(`/batches/${batch._id}/lock`)));
    await restaff([alice._id], [bob._id]);

    for (const t of [alice, bob]) {
      const cards = await sessionCards({ scopeTrainerId: t._id });
      expect(cards.sessions).toHaveLength(1);
      expect(cards.sessions[0].responses).toBe(1);
    }
    // Carol is on no roster and sees nothing, stamp or no stamp.
    expect((await sessionCards({ scopeTrainerId: carol._id })).sessions).toHaveLength(0);
  });
});
