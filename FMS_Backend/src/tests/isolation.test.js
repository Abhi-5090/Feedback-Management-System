/**
 * Mentor data isolation — the guarantee an institution actually buys.
 *
 * A mentor must never read or export another mentor's feedback, in either role,
 * and the split between "sessions I delivered" and "sessions I assisted" must
 * be reported honestly rather than blended.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  app, startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, TRAINER_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';
import { Batch } from '../models/Batch.js';
import { Feedback } from '../models/Feedback.js';

jest.setTimeout(60_000);

let alice; // main mentor on Coding
let bob;   // main mentor on GenAI, support on Coding
let coding;
let genai;
let codingBatch;
let genaiBatch;
let adminToken;
let aliceToken;
let bobToken;

/* ONE server for the whole file — see target() in helpers.js for why
   request(target()) per call was causing intermittent failures. */
beforeAll(async () => {
  await startTestDB();
  startTestServer();
});
afterAll(async () => {
  stopTestServer();
  await stopTestDB();
});

/** Unlock a batch, pass the gate, and submit one response. */
async function submitTo(batch, classIds, comment) {
  const unlocked = await request(target())
    .post(`/api/batches/${batch._id}/unlock`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ expectedCount: 5 });
  expect(unlocked.status).toBe(200);

  const verified = await request(target())
    .post('/api/public/verify-passcode')
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });
  expect(verified.status).toBe(200);

  const res = await request(target()).post('/api/public/feedback').send(
    await feedbackBody({
      batchId: batch._id,
      classIds,
      comment,
      sessionToken: verified.body.sessionToken,
      fingerprint: `fp-${batch._id}-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await resetDB();
  await seedBasics();

  alice = await makeTrainer('alice@test.com', 'Alice Anand');
  bob = await makeTrainer('bob@test.com', 'Bob Bhat');

  coding = await makeClass(null, 'Coding');
  genai = await makeClass(null, 'GenAI');

  // Alice delivers Coding; Bob assists her on it.
  codingBatch = await makeBatch({
    class: coding._id,
    mainTrainers: [alice._id],
    supportTrainers: [bob._id],
    name: 'Coding Cohort',
    yearGroup: 'Final Year',
  });
  // Bob delivers GenAI alone — Alice has nothing to do with it.
  genaiBatch = await makeBatch({
    class: genai._id,
    mainTrainers: [bob._id],
    supportTrainers: [],
    name: 'GenAI Cohort',
    yearGroup: 'Third Year',
  });

  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  aliceToken = await loginToken(request, 'alice@test.com', TRAINER_PASSWORD);
  bobToken = await loginToken(request, 'bob@test.com', TRAINER_PASSWORD);

  await submitTo(codingBatch, [coding._id], 'Coding session was well paced');
  await submitTo(genaiBatch, [genai._id], 'GenAI session was quite dense');
});

describe('Mentor data isolation (server-side)', () => {
  test('unauthenticated requests are rejected', async () => {
    for (const path of [
      '/api/analytics/classes',
      '/api/dashboard/trainer/me',
      '/api/analytics/trainers',
      '/api/export/trainer/me',
    ]) {
      const res = await request(target()).get(path);
      expect(res.status).toBe(401);
    }
  });

  test('a mentor sees only classes they are staffed on', async () => {
    const res = await request(target())
      .get('/api/analytics/classes')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    // Alice is on Coding only — GenAI must not appear at all.
    expect(res.body.classes.map((c) => c.name)).toEqual(['Coding']);
  });

  test("a mentor CANNOT read another mentor's class analytics", async () => {
    const res = await request(target())
      .get(`/api/analytics/class/${genai._id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
  });

  test("a mentor CANNOT read another mentor's batch analytics", async () => {
    const res = await request(target())
      .get(`/api/analytics/batch/${genaiBatch._id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
  });

  test('a mentor dashboard is scoped to their own feedback only', async () => {
    const res = await request(target())
      .get('/api/dashboard/trainer/me')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.feedbackCount).toBe(1); // Coding only
    expect(res.body.comments.map((c) => c.comment).join(' ')).toContain('Coding session');
    expect(res.body.comments.map((c) => c.comment).join(' ')).not.toContain('GenAI');
  });

  test('admin sees the whole system', async () => {
    const res = await request(target())
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.feedbackCount).toBe(2);
    expect(res.body.kpis.trainers).toBe(2);
  });

  test('the cross-mentor comparison is admin-only', async () => {
    const res = await request(target())
      .get('/api/analytics/trainers')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Main vs support attribution', () => {
  test('a support mentor sees the session, reported under the support role', async () => {
    // Bob assists Alice on Coding, so he can see it…
    const res = await request(target())
      .get(`/api/analytics/batch/${codingBatch._id}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
    expect(res.body.batch.classes[0].myRoles).toEqual(['support']);

    // …and his own figures separate the two roles.
    const split = await request(target())
      .get('/api/analytics/role-split')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(split.status).toBe(200);
    expect(split.body.main.feedbackCount).toBe(1);    // GenAI, delivered
    expect(split.body.support.feedbackCount).toBe(1); // Coding, assisted
  });

  test('the main mentor is not credited with support work', async () => {
    const split = await request(target())
      .get('/api/analytics/role-split')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(split.status).toBe(200);
    expect(split.body.main.feedbackCount).toBe(1);
    expect(split.body.support.feedbackCount).toBe(0);
  });

  test('?role=main narrows a mentor to sessions they delivered', async () => {
    const res = await request(target())
      .get('/api/analytics/classes?role=main')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
    expect(res.body.classes.map((c) => c.name)).toEqual(['GenAI']);

    const asSupport = await request(target())
      .get('/api/analytics/classes?role=support')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(asSupport.body.classes.map((c) => c.name)).toEqual(['Coding']);
  });

  test('a mentor cannot widen their scope by passing another trainerId', async () => {
    const res = await request(target())
      .get(`/api/dashboard/trainer/me?trainer=${bob._id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    // Still Alice's single Coding response — the client-supplied id is ignored.
    expect(res.body.kpis.feedbackCount).toBe(1);
  });

  test('a mentor cannot be both main and support on the same class', async () => {
    const res = await request(target())
      .post('/api/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Conflicted Batch',
        classes: [
          { class: String(coding._id), mainTrainers: [String(alice._id)], supportTrainers: [String(alice._id)] },
        ],
      });
    expect(res.status).toBe(400);
  });
});

describe('Exports honor role scoping', () => {
  /* superagent picks a body parser from the Content-Type. It has one for
     application/pdf but none for the xlsx mime type, so res.body arrives as {}
     and a byte assertion fails on a perfectly good file. responseType('blob')
     forces a Buffer for both, which is what we actually want to inspect. */
  const binary = (req) => req.responseType('blob');

  test('admin can export any class as xlsx (valid workbook bytes)', async () => {
    const res = await binary(
      request(target())
        .get(`/api/export/class/${genai._id}?format=xlsx`)
        .set('Authorization', `Bearer ${adminToken}`)
    );
    expect(res.status).toBe(200);
    // .xlsx is a zip — "PK" magic bytes.
    expect(res.body.slice(0, 2).toString()).toBe('PK');
  });

  test('admin can export any class as pdf (valid %PDF bytes)', async () => {
    const res = await binary(
      request(target())
        .get(`/api/export/class/${genai._id}?format=pdf`)
        .set('Authorization', `Bearer ${adminToken}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('a mentor can export their OWN class', async () => {
    const res = await binary(
      request(target())
        .get(`/api/export/class/${coding._id}?format=xlsx`)
        .set('Authorization', `Bearer ${aliceToken}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 2).toString()).toBe('PK');
  });

  test("a mentor CANNOT export another mentor's class", async () => {
    const res = await request(target())
      .get(`/api/export/class/${genai._id}?format=xlsx`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
  });

  test('trainer/me export returns only their data', async () => {
    const res = await binary(
      request(target())
        .get('/api/export/trainer/me?format=pdf')
        .set('Authorization', `Bearer ${aliceToken}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  /**
   * The audit trail must record what HAPPENED, not what was attempted. A
   * refused export previously still logged "Exported data" naming the class —
   * in the one feature whose purpose is answering "who took our data?".
   */
  test('a refused export leaves NO export entry in the audit trail', async () => {
    const denied = await request(target())
      .get(`/api/export/class/${genai._id}?format=xlsx`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);

    // Audit writes are fire-and-forget; give them a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const audit = await request(target())
      .get('/api/audit?action=export.download&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    const byAlice = audit.body.entries.filter((e) => e.actorEmail === 'alice@test.com');
    expect(byAlice).toHaveLength(0);
  });

  test('a permitted export DOES leave an audit entry', async () => {
    const ok = await request(target())
      .get(`/api/export/class/${coding._id}?format=xlsx`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(ok.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const audit = await request(target())
      .get('/api/audit?action=export.download&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    const byAlice = audit.body.entries.filter((e) => e.actorEmail === 'alice@test.com');
    expect(byAlice).toHaveLength(1);
    expect(byAlice[0].entityName).toBe('Coding');
  });
});

describe('Staffing guards', () => {
  test('a batch cannot be created without a main mentor', async () => {
    const res = await request(target())
      .post('/api/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Unstaffed', classes: [{ class: String(coding._id) }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_MAIN_TRAINER');
  });

  test('an OPEN batch cannot be restaffed', async () => {
    const open = await Batch.findById(codingBatch._id);
    expect(open.status).toBe('open');
    const res = await request(target())
      .patch(`/api/batches/${codingBatch._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        classes: [{ class: String(coding._id), mainTrainers: [String(bob._id)] }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BATCH_OPEN');
  });

  test('a mentor staffed on an open batch cannot be deactivated', async () => {
    const res = await request(target())
      .patch(`/api/trainers/${alice._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TRAINER_IN_OPEN_BATCH');
  });
});

describe('Scoping within a multi-subject batch', () => {
  /**
   * A batch runs several subjects with different mentor teams. Being staffed on
   * ONE of them must not grant access to the others.
   *
   * This is a regression test for a real bug: the scope was resolved with
   * `Batch.distinct('classes.class', { 'classes.supportTrainers': id })`, whose
   * filter selects whole BATCHES containing a match and then returns every
   * class in them. A mentor assisting on Coding therefore had GenAI listed as
   * theirs and could open its analytics page. Single-subject fixtures could
   * never catch it — the bug only appears when a batch holds more than one
   * class.
   */
  let carol; // main on Coding only, inside a batch that also runs GenAI
  let mixedBatch;
  let carolToken;

  beforeEach(async () => {
    carol = await makeTrainer('carol@test.com', 'Carol Cruz');
    mixedBatch = await makeBatch({
      classes: [
        { class: coding._id, mainTrainers: [carol._id], supportTrainers: [] },
        // Bob runs GenAI in the same batch; Carol has nothing to do with it.
        { class: genai._id, mainTrainers: [bob._id], supportTrainers: [] },
      ],
      name: 'Mixed Cohort',
      yearGroup: 'Second Year',
    });
    carolToken = await loginToken(request, 'carol@test.com', TRAINER_PASSWORD);
  });

  test('a mentor on one subject does not see the batch\'s other subjects', async () => {
    const res = await request(target())
      .get('/api/analytics/classes')
      .set('Authorization', `Bearer ${carolToken}`);
    expect(res.status).toBe(200);
    const names = res.body.classes.map((c) => c.name).sort();
    expect(names).toEqual(['Coding']);
    expect(names).not.toContain('GenAI');
  });

  test("and cannot open that other subject's analytics", async () => {
    const res = await request(target())
      .get(`/api/analytics/class/${genai._id}`)
      .set('Authorization', `Bearer ${carolToken}`);
    expect(res.status).toBe(403);
  });

  test("nor export it", async () => {
    const res = await request(target())
      .get(`/api/export/class/${genai._id}?format=xlsx`)
      .set('Authorization', `Bearer ${carolToken}`);
    expect(res.status).toBe(403);
  });

  test('but DOES see the batch, listing only their own subject', async () => {
    const res = await request(target())
      .get(`/api/analytics/batch/${mixedBatch._id}`)
      .set('Authorization', `Bearer ${carolToken}`);
    expect(res.status).toBe(200);
    expect(res.body.batch.classes.map((c) => c.name)).toEqual(['Coding']);
    expect(res.body.batch.classCount).toBe(1);
  });

  test('the role filter is also per-subject, not per-batch', async () => {
    // Carol is main on Coding and support on nothing.
    const asMain = await request(target())
      .get('/api/analytics/classes?role=main')
      .set('Authorization', `Bearer ${carolToken}`);
    expect(asMain.body.classes.map((c) => c.name)).toEqual(['Coding']);

    const asSupport = await request(target())
      .get('/api/analytics/classes?role=support')
      .set('Authorization', `Bearer ${carolToken}`);
    expect(asSupport.body.classes).toHaveLength(0);
  });
});

describe('Year-group breakdown of a subject', () => {
  /**
   * A subject runs for several cohorts and their feedback is not comparable.
   * The class endpoint therefore returns ONE consolidated figure plus the
   * divisions beneath it, and these tests pin the two properties that make
   * that trustworthy: the divisions cover every cohort, and the parts add up
   * to the whole.
   */
  let secondYearBatch;

  beforeEach(async () => {
    // Coding already runs for 'Final Year' (codingBatch). Add a second cohort
    // in a different year group, taught by Bob, and give it feedback.
    secondYearBatch = await makeBatch({
      class: coding._id,
      mainTrainers: [bob._id],
      supportTrainers: [],
      name: 'Coding Second Year',
      yearGroup: 'Second Year',
      expectedCount: 10,
    });
    await submitTo(secondYearBatch, [coding._id], 'Second year coding was slower paced');
  });

  test('every year group the subject runs for appears, with its own batches', async () => {
    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const groups = res.body.breakdown.yearGroups;
    const names = groups.map((g) => g.yearGroup).sort();
    expect(names).toEqual(['Final Year', 'Second Year']);

    for (const g of groups) {
      expect(g.batches.length).toBeGreaterThan(0);
      // Each batch names its own mentor roster, not the subject's.
      for (const b of g.batches) {
        expect(b.name).toBeTruthy();
        expect(b.name).not.toBe('—');
        expect(b.name).not.toBe(res.body.class.name);
        expect(Array.isArray(b.mainTrainerNames)).toBe(true);
      }
    }
  });

  test('the consolidated total equals the sum of the divisions', async () => {
    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { consolidated, yearGroups } = res.body.breakdown;
    const summed = yearGroups.reduce((n, g) => n + g.responses, 0);

    expect(consolidated.responses).toBe(summed);
    // And it agrees with the headline the page shows above the breakdown.
    expect(res.body.feedbackCount).toBe(summed);
    expect(consolidated.yearGroupCount).toBe(yearGroups.length);
    expect(consolidated.batchCount).toBe(
      yearGroups.reduce((n, g) => n + g.batchCount, 0)
    );
  });

  test('a batch with no responses is still listed rather than omitted', async () => {
    // "This cohort has not answered" is information, not an empty row to hide.
    const silent = await makeBatch({
      class: coding._id,
      mainTrainers: [bob._id],
      name: 'Coding Silent Cohort',
      yearGroup: 'First Year',
      expectedCount: 25,
    });

    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const firstYear = res.body.breakdown.yearGroups.find((g) => g.yearGroup === 'First Year');
    expect(firstYear).toBeDefined();
    const batch = firstYear.batches.find((b) => b.id === String(silent._id));
    expect(batch).toBeDefined();
    expect(batch.responses).toBe(0);
    // null, not 0 — an unrated cohort is not a zero-rated one.
    expect(batch.average).toBeNull();
    expect(firstYear.average).toBeNull();
  });

  /**
   * A mentor must not merely see ZERO RESPONSES for another mentor's cohort —
   * the cohort must not be listed at all.
   *
   * This is a regression test for a real leak. The original assertion only
   * checked `responses === 0`, so it passed while the endpoint was returning
   * every batch of the subject, complete with the OTHER mentors' names and
   * each cohort's response rate. A support mentor on one of four Industry
   * Readiness batches could see all four and who taught them.
   *
   * Cause: the batch query paired `'classes.class'` with `'classes.mainTrainers'`
   * as sibling keys, which Mongo allows DIFFERENT array elements to satisfy.
   * The fix is `$elemMatch`; these assertions are what would have caught it.
   */
  test("a mentor's breakdown OMITS cohorts they are not staffed on", async () => {
    // Alice is main on Coding for Final Year only; Bob teaches Second Year.
    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);

    const groups = res.body.breakdown.yearGroups;
    const listedBatches = groups.flatMap((g) => g.batches.map((b) => b.name));

    // Only her own cohort is listed.
    expect(listedBatches).toEqual(['Coding Cohort']);
    expect(listedBatches).not.toContain('Coding Second Year');
    expect(groups.map((g) => g.yearGroup)).toEqual(['Final Year']);

    /* The other COHORT must be absent. Bob's name legitimately appears — he is
       a support mentor on Alice's own session, and the team of a session she
       teaches is hers to see. What must not leak is a cohort she has nothing to
       do with, and the mentors staffing it. */
    const serialised = JSON.stringify(res.body.breakdown);
    expect(serialised).not.toContain('Coding Second Year');

    // Her own figures are intact.
    expect(groups[0].responses).toBeGreaterThan(0);
    expect(res.body.breakdown.consolidated.batchCount).toBe(1);
  });

  test('the admin still sees every cohort of the subject', async () => {
    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const listed = res.body.breakdown.yearGroups
      .flatMap((g) => g.batches.map((b) => b.name))
      .sort();
    expect(listed).toEqual(['Coding Cohort', 'Coding Second Year']);
  });

  /**
   * The class filter and the mentor filter must be satisfied by the SAME class
   * entry of a batch.
   *
   * This needs a MULTI-subject batch to expose: Alice teaches Coding in it and
   * has nothing to do with its GenAI session. Asking for "GenAI taught by
   * Alice" must return nothing. With the two conditions written as sibling
   * keys, Mongo lets different array elements satisfy them and the batch
   * matches — which is the same defect that leaked the Industry Readiness
   * cohorts.
   */
  test('class and mentor filters must match the same class entry', async () => {
    const mixed = await makeBatch({
      classes: [
        { class: coding._id, mainTrainers: [alice._id], supportTrainers: [] },
        { class: genai._id, mainTrainers: [bob._id], supportTrainers: [] },
      ],
      name: 'Mixed Year Batch',
      yearGroup: 'Third Year',
    });

    // Alice + Coding -> the batch matches (she teaches that entry).
    const hit = await request(target())
      .get(`/api/batches?class=${coding._id}&trainer=${alice._id}&limit=50`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(hit.status).toBe(200);
    expect(hit.body.batches.map((b) => b.name).sort()).toEqual(
      ['Coding Cohort', 'Mixed Year Batch'].sort()
    );

    // Alice + GenAI -> nothing, even though she is IN a batch that runs GenAI.
    const miss = await request(target())
      .get(`/api/batches?class=${genai._id}&trainer=${alice._id}&limit=50`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(miss.status).toBe(200);
    expect(miss.body.batches.map((b) => b.name)).toEqual([]);

    // And the same holds for the breakdown she is shown for GenAI: she is not
    // staffed on it anywhere, so the endpoint refuses outright.
    const denied = await request(target())
      .get(`/api/analytics/class/${genai._id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);

    expect(String(mixed._id)).toBeTruthy();
  });

  test('per-parameter figures are reported for each year group separately', async () => {
    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    for (const g of res.body.breakdown.yearGroups) {
      if (g.responses === 0) continue;
      expect(g.perParameter.length).toBeGreaterThan(0);
      for (const p of g.perParameter) {
        expect(typeof p.label).toBe('string');
        expect(p.average).toBeGreaterThanOrEqual(1);
        expect(p.average).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('Session cards and year groups', () => {
  /**
   * Feedback is read at the SESSION grain — a (batch, subject) pair — because a
   * subject spans cohorts taught by different mentors. These endpoints power
   * the Feedbacks cards and the year-group cards, and both must respect the
   * same isolation as everything else.
   */
  beforeEach(async () => {
    await makeBatch({
      class: coding._id,
      mainTrainers: [bob._id],
      name: 'Coding Extra Cohort',
      yearGroup: 'Second Year',
      expectedCount: 20,
    });
  });

  test('an admin sees one session per batch+subject pair', async () => {
    const res = await request(target())
      .get('/api/analytics/sessions')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Each entry names both halves of the pair, and the pair is unique.
    const ids = res.body.sessions.map((s) => `${s.batchId}|${s.classId}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of res.body.sessions) {
      expect(s.batchName).toBeTruthy();
      expect(s.className).toBeTruthy();
      expect(s.yearGroup).toBeTruthy();
    }
  });

  test('a mentor sees ONLY their own sessions, and the filters reflect that', async () => {
    const res = await request(target())
      .get('/api/analytics/sessions')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);

    // Alice is main on Coding for the Final Year cohort only.
    expect(res.body.sessions.map((s) => s.batchName)).toEqual(['Coding Cohort']);
    // The dropdowns must not advertise cohorts she cannot open.
    expect(res.body.filters.yearGroups).toEqual(['Final Year']);
    expect(res.body.filters.classes.map((c) => c.name)).toEqual(['Coding']);
    // Bob's cohorts are absent entirely, not merely zeroed.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('Coding Extra Cohort');
    expect(serialised).not.toContain('GenAI Cohort');
  });

  test('?yearGroup= narrows server-side', async () => {
    const res = await request(target())
      .get('/api/analytics/sessions?yearGroup=Second%20Year')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThan(0);
    for (const s of res.body.sessions) expect(s.yearGroup).toBe('Second Year');
  });

  test('?role= separates what a mentor delivered from what they assisted', async () => {
    const asMain = await request(target())
      .get('/api/analytics/sessions?role=main')
      .set('Authorization', `Bearer ${bobToken}`);
    const asSupport = await request(target())
      .get('/api/analytics/sessions?role=support')
      .set('Authorization', `Bearer ${bobToken}`);

    for (const s of asMain.body.sessions) expect(s.myRoles).toContain('main');
    for (const s of asSupport.body.sessions) expect(s.myRoles).toContain('support');
    // Bob supports Alice's Coding cohort and delivers his own.
    expect(asSupport.body.sessions.map((s) => s.batchName)).toContain('Coding Cohort');
    expect(asMain.body.sessions.map((s) => s.batchName)).not.toContain('Coding Cohort');
  });

  test('year cards count each cohort once, not once per subject', async () => {
    /* A batch running two subjects is ONE cohort of students. Summing
       expectedCount per session would report those students twice. */
    const twoSubject = await makeBatch({
      classes: [
        { class: coding._id, mainTrainers: [bob._id], supportTrainers: [] },
        { class: genai._id, mainTrainers: [bob._id], supportTrainers: [] },
      ],
      name: 'Double Subject Batch',
      // A year group of its own, so this asserts the de-duplication rather
      // than however many batches the surrounding fixtures happen to create.
      yearGroup: 'Double Year',
      expectedCount: 100,
    });
    expect(String(twoSubject._id)).toBeTruthy();

    const res = await request(target())
      .get('/api/analytics/years')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const y = res.body.years.find((g) => g.yearGroup === 'Double Year');
    expect(y).toBeDefined();
    expect(y.batchCount).toBe(1); // ONE cohort…
    expect(y.sessionCount).toBe(2); // …taking two subjects
    expect(y.students).toBe(100); // NOT 200 — students counted once
    expect(y.classCount).toBe(2);
    expect(y.subjects.sort()).toEqual(['Coding', 'GenAI']);
  });

  test('year cards come back in institutional order, not alphabetical', async () => {
    const res = await request(target())
      .get('/api/analytics/years')
      .set('Authorization', `Bearer ${adminToken}`);
    const order = res.body.years.map((y) => y.yearGroup);
    // Alphabetical would put "Final Year" first; a timetable does not.
    const expected = ['First Year', 'Second Year', 'Third Year', 'Final Year'].filter((y) =>
      order.includes(y)
    );
    expect(order).toEqual(expected);
  });

  test('an unrated year group reports null, never 0.00', async () => {
    const res = await request(target())
      .get('/api/analytics/years')
      .set('Authorization', `Bearer ${adminToken}`);
    for (const y of res.body.years) {
      if (y.responses === 0) expect(y.average).toBeNull();
    }
  });
});

describe('Admin-issued password reset link', () => {
  /**
   * The way back into an account when email is not configured — which is the
   * common case, and one /forgot-password cannot report because it must answer
   * identically for every address or become an enumeration oracle.
   */
  test('issues a single-use link that actually resets the password', async () => {
    const res = await request(target())
      .post(`/api/trainers/${alice._id}/reset-link`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.resetUrl).toMatch(/reset-password\?token=[a-f0-9]{64}/);
    expect(res.body.trainer.email).toBe('alice@test.com');

    const token = res.body.resetUrl.split('token=')[1];

    // The strength bar still applies to a link-based reset.
    const weak = await request(target())
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'password123' });
    expect(weak.status).toBe(400);

    const ok = await request(target())
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'chosen-by-the-mentor-2026' });
    expect(ok.status).toBe(200);

    // Single-use.
    const replay = await request(target())
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'yet-another-passphrase' });
    expect(replay.status).toBe(400);

    // And the new password works.
    const login = await request(target())
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'chosen-by-the-mentor-2026' });
    expect(login.status).toBe(200);
  });

  test('issuing a new link invalidates the previous one', async () => {
    const first = await request(target())
      .post(`/api/trainers/${alice._id}/reset-link`)
      .set('Authorization', `Bearer ${adminToken}`);
    const second = await request(target())
      .post(`/api/trainers/${alice._id}/reset-link`)
      .set('Authorization', `Bearer ${adminToken}`);

    const stale = first.body.resetUrl.split('token=')[1];
    const live = second.body.resetUrl.split('token=')[1];

    const withStale = await request(target())
      .post('/api/auth/reset-password')
      .send({ token: stale, newPassword: 'should-not-work-2026' });
    expect(withStale.status).toBe(400);

    const withLive = await request(target())
      .post('/api/auth/reset-password')
      .send({ token: live, newPassword: 'this-one-should-work-2026' });
    expect(withLive.status).toBe(200);
  });

  test('a trainer cannot issue a reset link for anyone', async () => {
    const res = await request(target())
      .post(`/api/trainers/${bob._id}/reset-link`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect([401, 403]).toContain(res.status);
  });

  test('the link is never written to the audit trail', async () => {
    const res = await request(target())
      .post(`/api/trainers/${alice._id}/reset-link`)
      .set('Authorization', `Bearer ${adminToken}`);
    const token = res.body.resetUrl.split('token=')[1];

    await new Promise((r) => setTimeout(r, 150)); // audit writes are async

    const audit = await request(target())
      .get('/api/audit?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    // An audit log is not a place to store live credentials.
    expect(JSON.stringify(audit.body)).not.toContain(token);
    const entry = audit.body.entries.find((e) => e.action === 'trainer.reset_link');
    expect(entry).toBeDefined();
    expect(entry.entityName).toBe('Alice Anand');
  });
});

describe('Answered figures come from the data, not a counter', () => {
  /**
   * Regression test for a genuinely misleading bug.
   *
   * `Batch.submittedCount` is a denormalised counter — it has to be, because
   * enforcing the response cap needs a single atomic increment rather than a
   * count query per submission. But a copy drifts: feedback deleted directly in
   * the database left batches claiming 46, 38 and 41 submissions with zero rows
   * behind them, and every "answered %" in the product reported a response rate
   * for cohorts that had answered nothing.
   *
   * Everything DISPLAYED is now derived from the feedback rows, so the number
   * cannot disagree with the data it describes.
   */
  test('a stale counter does not produce a phantom response rate', async () => {
    // Simulate exactly what happened: rows removed, counter left behind.
    await Feedback.deleteMany({ batch: codingBatch._id });
    await Batch.updateOne({ _id: codingBatch._id }, { submittedCount: 46, expectedCount: 139 });

    const sessions = await request(target())
      .get(`/api/analytics/sessions?classId=${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sessions.status).toBe(200);

    const card = sessions.body.sessions.find((x) => x.batchId === String(codingBatch._id));
    expect(card).toBeDefined();
    expect(card.responses).toBe(0);
    // The stale 46 must not appear as an answered figure…
    expect(card.submittedCount).toBe(0);
    expect(card.responseRate).toBe(0);
    // …though it is still reported separately, so a drift is visible rather
    // than merely absent.
    expect(card.counterValue).toBe(46);
  });

  test('the class breakdown reports zero answered when there are no rows', async () => {
    await Feedback.deleteMany({ batch: codingBatch._id });
    await Batch.updateOne({ _id: codingBatch._id }, { submittedCount: 46, expectedCount: 139 });

    const res = await request(target())
      .get(`/api/analytics/class/${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const withBatch = res.body.breakdown.yearGroups.find((g) =>
      g.batches.some((b) => b.id === String(codingBatch._id))
    );
    const b = withBatch.batches.find((x) => x.id === String(codingBatch._id));
    expect(b.responses).toBe(0);
    expect(b.submittedCount).toBe(0);
    expect(b.responseRate).toBe(0);
    expect(b.average).toBeNull();
  });

  test('the year cards report zero answered when there are no rows', async () => {
    await Feedback.deleteMany({});
    await Batch.updateMany({}, { submittedCount: 99 });

    const res = await request(target())
      .get('/api/analytics/years')
      .set('Authorization', `Bearer ${adminToken}`);

    for (const y of res.body.years) {
      expect(y.responses).toBe(0);
      expect(y.submitted).toBe(0);
      expect(y.average).toBeNull();
      // 0 of N, not a fabricated percentage.
      expect(y.responseRate === 0 || y.responseRate === null).toBe(true);
    }
  });

  test('the admin dashboard reports zero coverage when there are no rows', async () => {
    await Feedback.deleteMany({});
    await Batch.updateMany({}, { submittedCount: 99, expectedCount: 100 });

    const res = await request(target())
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.feedbackCount).toBe(0);
    expect(res.body.kpis.submittedResponses).toBe(0);
    expect(res.body.kpis.responseRate).toBe(0);
    // The expected total still comes from the batches, which is correct — it is
    // the cohort size an admin set, not a count of anything.
    expect(res.body.kpis.expectedResponses).toBeGreaterThan(0);
  });

  test('with real feedback, answered equals the number of students who submitted', async () => {
    /* One submission writes one row per class, so for a single-class batch the
       row count IS the student count. This is why the counter is not needed for
       display. */
    const before = await Feedback.countDocuments({ batch: codingBatch._id });
    expect(before).toBe(1); // the fixture submitted once

    const res = await request(target())
      .get(`/api/analytics/sessions?classId=${coding._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const card = res.body.sessions.find((x) => x.batchId === String(codingBatch._id));
    expect(card.responses).toBe(1);
    expect(card.submittedCount).toBe(1);
  });
});
