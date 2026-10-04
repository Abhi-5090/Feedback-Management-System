import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer, makeClass, makeBatch,
  feedbackBody, loginToken, ADMIN_PASSWORD, startTestServer, stopTestServer, target,
} from './helpers.js';
import { Phase } from '../models/Phase.js';
import { Feedback } from '../models/Feedback.js';
import { monthRange } from '../services/phaseService.js';

jest.setTimeout(60_000);

/**
 * Phases — the collection exercise a response belongs to.
 *
 * Three invariants carry the whole feature, and each exists because its
 * absence breaks a different promise:
 *
 *   1. no two phases overlap  → "which phase?" always has exactly one answer
 *   2. a closed phase is frozen → a reported number never moves afterwards
 *   3. at most one phase is open → unlocking needs no extra decision
 *
 * The fourth property is that membership is STAMPED, not derived: editing a
 * window must not silently rewrite a report that has already been circulated.
 */

let adminToken;
let klass;
let batch;
let trainer;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });

beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
  trainer = await makeTrainer('t@test.com', 'Tee');
  klass = await makeClass(null, 'GenAI');
  batch = await makeBatch({ class: klass._id, mainTrainers: [trainer._id], name: 'Cohort' });
});

const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);
const api = (p) => `/api/v1${p}`;

const makePhase = (over = {}) =>
  auth(request(target()).post(api('/phases'))).send({
    name: 'Phase 1 — September', code: 'P1',
    startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

/** Submit one response, optionally back-dated into a given month. */
async function submit({ at } = {}) {
  const unlocked = await auth(request(target()).post(`/api/v1/batches/${batch._id}/unlock`)).send({ expectedCount: 99 });
  const verified = await request(target())
    .post(api('/public/verify-passcode'))
    .send({ batchId: String(batch._id), passcode: unlocked.body.passcode });

  const before = await Feedback.countDocuments();
  const res = await request(target()).post(api('/public/feedback')).send(
    await feedbackBody({
      batchId: batch._id, classIds: [klass._id], stars: 4,
      comment: 'A perfectly adequate comment for testing.',
      sessionToken: verified.body.sessionToken, fingerprint: `fp-${Math.random()}`,
    })
  );
  expect(res.status).toBe(201);

  if (at) {
    /* Target the rows THIS call inserted, by id.
       An earlier version filtered on `createdAt >= now`, which quietly swept
       up any fixture already back-dated to a FUTURE date — and since the suite
       runs in early October, a fixture dated "October 15" is the future. The
       result was a test failing for a reason that had nothing to do with
       phases. Ids are insertion-ordered; dates in a fixture are not.

       The stamp is cleared alongside the date: back-dating means "pretend this
       was collected then", and a response collected then would carry whatever
       phase covered that moment, which each test sets up explicitly. */
    const inserted = (await Feedback.countDocuments()) - before;
    const ids = (await Feedback.find().sort({ _id: -1 }).limit(inserted).select('_id').lean()).map((r) => r._id);
    await Feedback.collection.updateMany({ _id: { $in: ids } }, { $set: { createdAt: at, phase: null } });
  }
}

describe('creating a phase', () => {
  test('a phase is created with its window and code', async () => {
    const res = await makePhase();
    expect(res.status).toBe(201);
    expect(res.body.phase).toMatchObject({ code: 'P1', status: 'draft', responses: 0 });
  });

  test('a backwards window is refused', async () => {
    const res = await makePhase({ startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  test('a duplicate code is refused by name', async () => {
    await makePhase();
    const res = await makePhase({ name: 'Another', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already used by "Phase 1 — September"/);
  });
});

describe('INVARIANT: no two phases may overlap', () => {
  test('an overlapping window is refused, and the clash is named', async () => {
    await makePhase();
    const res = await makePhase({
      name: 'Overlaps', code: 'P2',
      startsAt: '2026-09-15T00:00:00.000Z', endsAt: '2026-10-15T00:00:00.000Z',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHASE_OVERLAP');
    expect(res.body.error).toMatch(/Phase 1 — September/);
  });

  test('a window that fully CONTAINS another is refused', async () => {
    await makePhase();
    const res = await makePhase({
      name: 'Whole autumn', code: 'P2',
      startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
    });
    expect(res.status).toBe(409);
  });

  test('back-to-back months are allowed — the range is half-open', async () => {
    /* September ends at 1 Oct 00:00 and October starts at 1 Oct 00:00. With an
       inclusive end these would "overlap" by one instant, which is the
       off-by-one that makes consecutive phases impossible to create. */
    expect((await makePhase()).status).toBe(201);
    const oct = await makePhase({
      name: 'Phase 2 — October', code: 'P2',
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(oct.status).toBe(201);
  });
});

describe('INVARIANT: at most one phase is open', () => {
  test('opening a second phase is refused while one is open', async () => {
    await makePhase({ status: 'open' });
    const res = await makePhase({
      name: 'Phase 2', code: 'P2', status: 'open',
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHASE_ALREADY_OPEN');
  });

  test('a second DRAFT phase is fine — only one may collect', async () => {
    await makePhase({ status: 'open' });
    const res = await makePhase({
      name: 'Phase 2', code: 'P2',
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
  });
});

describe('membership is STAMPED at submit', () => {
  test('a submission lands in the open phase covering now', async () => {
    const now = new Date();
    const { startsAt, endsAt } = monthRange(now.getUTCFullYear(), now.getUTCMonth());
    await makePhase({ name: 'Now', code: 'NOW', status: 'open', startsAt, endsAt });

    await submit();
    const rows = await Feedback.find().lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.phase)).toBe(true);
  });

  test('with no phase covering now, the response is still COLLECTED', async () => {
    /* Refusing a student's submission over an admin's bookkeeping would be the
       wrong trade every time. It is collected and shows as Unassigned. */
    await submit();
    const rows = await Feedback.find().lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.phase === null)).toBe(true);

    const list = await auth(request(target()).get(api('/phases')));
    expect(list.body.unassigned.responses).toBe(rows.length);
  });

  test('a CLOSED phase never claims a new submission', async () => {
    const now = new Date();
    const { startsAt, endsAt } = monthRange(now.getUTCFullYear(), now.getUTCMonth());
    const made = await makePhase({ name: 'Now', code: 'NOW', status: 'open', startsAt, endsAt });
    await auth(request(target()).post(api(`/phases/${made.body.phase._id}/close`)));

    await submit();
    const rows = await Feedback.find().lean();
    expect(rows.every((r) => r.phase === null)).toBe(true);
  });
});

describe('retroactive declaration', () => {
  test('creating a phase claims feedback already inside its window', async () => {
    // The case that matters: 1,259 responses collected before phases existed.
    await submit({ at: new Date('2026-09-15T10:00:00.000Z') });
    const before = await Feedback.countDocuments({ phase: null });
    expect(before).toBeGreaterThan(0);

    const res = await makePhase();
    expect(res.body.claimed).toBe(before);
    expect(await Feedback.countDocuments({ phase: null })).toBe(0);
  });

  test('widening a window picks up more; narrowing lets go', async () => {
    await submit({ at: new Date('2026-09-05T10:00:00.000Z') });
    await submit({ at: new Date('2026-09-25T10:00:00.000Z') });

    const made = await makePhase({ startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-10T00:00:00.000Z' });
    const id = made.body.phase._id;
    expect((await auth(request(target()).get(api(`/phases/${id}`)))).body.phase.responses).toBe(1);

    await auth(request(target()).patch(api(`/phases/${id}`))).send({ endsAt: '2026-10-01T00:00:00.000Z' });
    expect((await auth(request(target()).get(api(`/phases/${id}`)))).body.phase.responses).toBe(2);

    // Narrow it again — the later response must be RELEASED, not kept.
    await auth(request(target()).patch(api(`/phases/${id}`))).send({ endsAt: '2026-09-10T00:00:00.000Z' });
    expect((await auth(request(target()).get(api(`/phases/${id}`)))).body.phase.responses).toBe(1);
    expect(await Feedback.countDocuments({ phase: null })).toBe(1);
  });
});

describe('INVARIANT: a closed phase is frozen', () => {
  let id;
  beforeEach(async () => {
    await submit({ at: new Date('2026-09-15T10:00:00.000Z') });
    const made = await makePhase({ status: 'open' });
    id = made.body.phase._id;
  });

  test('closing records who did it and when', async () => {
    const res = await auth(request(target()).post(api(`/phases/${id}/close`)));
    expect(res.status).toBe(200);
    expect(res.body.phase.status).toBe('closed');
    const doc = await Phase.findById(id).lean();
    expect(doc.closedAt).toBeTruthy();
    expect(doc.closedBy).toBeTruthy();
  });

  test('closing LOCKS any open batch, so nothing submits into a reported phase', async () => {
    await auth(request(target()).post(`/api/v1/batches/${batch._id}/unlock`)).send({ expectedCount: 50 });
    const res = await auth(request(target()).post(api(`/phases/${id}/close`)));
    expect(res.body.batchesLocked).toBeGreaterThan(0);
  });

  test('a closed phase cannot be edited', async () => {
    await auth(request(target()).post(api(`/phases/${id}/close`)));
    const res = await auth(request(target()).patch(api(`/phases/${id}`))).send({ name: 'Renamed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHASE_CLOSED');
  });

  test('its membership cannot be stolen by editing a NEIGHBOURING phase', async () => {
    /* The subtle one. Widening an adjacent phase must not reach into a frozen
       one — the overlap rule blocks the window, and the resync skips anything
       a closed phase holds. */
    await auth(request(target()).post(api(`/phases/${id}/close`)));
    const held = (await auth(request(target()).get(api(`/phases/${id}`)))).body.phase.responses;
    expect(held).toBeGreaterThan(0);

    const other = await makePhase({
      name: 'Phase 2', code: 'P2',
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    });
    const grab = await auth(request(target()).patch(api(`/phases/${other.body.phase._id}`)))
      .send({ startsAt: '2026-09-01T00:00:00.000Z' });
    expect(grab.status).toBe(409); // refused by the overlap rule

    expect((await auth(request(target()).get(api(`/phases/${id}`)))).body.phase.responses).toBe(held);
  });

  test('a closed phase cannot be deleted', async () => {
    await auth(request(target()).post(api(`/phases/${id}/close`)));
    expect((await auth(request(target()).delete(api(`/phases/${id}`)))).status).toBe(409);
  });
});

describe('deletion', () => {
  test('a phase holding responses is not deletable', async () => {
    await submit({ at: new Date('2026-09-15T10:00:00.000Z') });
    const made = await makePhase();
    const res = await auth(request(target()).delete(api(`/phases/${made.body.phase._id}`)));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/would leave them unaccounted for/);
  });

  test('an empty phase is deletable', async () => {
    const made = await makePhase();
    expect((await auth(request(target()).delete(api(`/phases/${made.body.phase._id}`)))).status).toBe(200);
  });
});

describe('access', () => {
  let mentor;
  beforeEach(async () => {
    const t = await loginToken(request, 't@test.com', 'trainer-fixture-2026');
    mentor = (r) => r.set('Authorization', `Bearer ${t}`);
  });

  test('a mentor can READ the phase list — it populates their own filter', async () => {
    await makePhase();
    const res = await mentor(request(target()).get(api('/phases')));
    expect(res.status).toBe(200);
    expect(res.body.phases).toHaveLength(1);
    expect(res.body.phases[0]).toMatchObject({ code: 'P1', name: 'Phase 1 — September' });
  });

  test('but NOT the institution-wide figures on it', async () => {
    /* The isolation guarantee the product rests on: a mentor sees their own
       sessions and nothing else. Total responses, batch count and the overall
       average are everyone's data — handing them over through a filter
       dropdown would undo it quietly. */
    await submit({ at: new Date('2026-09-15T10:00:00.000Z') });
    await makePhase();

    const res = await mentor(request(target()).get(api('/phases')));
    const p = res.body.phases[0];
    expect(p.responses).toBeUndefined();
    expect(p.batches).toBeUndefined();
    expect(p.average).toBeUndefined();
    // And the unassigned roll-up, which is also institution-wide.
    expect(res.body.unassigned).toBeNull();

    // The admin still sees all of it.
    const asAdmin = await auth(request(target()).get(api('/phases')));
    expect(asAdmin.body.phases[0].responses).toBeGreaterThan(0);
    expect(asAdmin.body.unassigned).not.toBeNull();
  });

  test('a mentor cannot create, edit, close or delete a phase', async () => {
    const made = await makePhase();
    const id = made.body.phase._id;
    expect((await mentor(request(target()).post(api('/phases')))).status).toBe(403);
    expect((await mentor(request(target()).patch(api(`/phases/${id}`)))).status).toBe(403);
    expect((await mentor(request(target()).post(api(`/phases/${id}/close`)))).status).toBe(403);
    expect((await mentor(request(target()).delete(api(`/phases/${id}`)))).status).toBe(403);
  });

  test('a mentor cannot read one phase in full either', async () => {
    // The detail endpoint returns the figures, so it stays admin-only.
    const made = await makePhase();
    expect((await mentor(request(target()).get(api(`/phases/${made.body.phase._id}`)))).status).toBe(403);
  });
});

describe('the payoff: phases actually segregate the data', () => {
  /**
   * The reason the feature exists. Without this, "Avg rating 4.30" is a number
   * with no baseline; with it, "3.36 in Phase 1, 4.10 in Phase 2" tells you
   * whether what you changed after reading Phase 1 worked.
   */
  let p1;
  let p2;

  beforeEach(async () => {
    // Two exercises, two months, different ratings.
    await submit({ at: new Date('2026-09-15T10:00:00.000Z') });
    await submit({ at: new Date('2026-10-15T10:00:00.000Z') });

    p1 = (await makePhase({ name: 'Phase 1', code: 'P1' })).body.phase;
    p2 = (await makePhase({
      name: 'Phase 2', code: 'P2',
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    })).body.phase;
  });

  test('each phase holds only its own responses', async () => {
    expect(p1.responses).toBe(1);
    expect(p2.responses).toBe(1);
  });

  test('the dashboard narrows to one phase', async () => {
    const all = await auth(request(target()).get(api('/dashboard/admin')));
    expect(all.body.kpis.feedbackCount).toBe(2);

    const only1 = await auth(request(target()).get(api(`/dashboard/admin?phase=${p1._id}`)));
    expect(only1.body.kpis.feedbackCount).toBe(1);
  });

  test('"unassigned" is selectable, and finds feedback in no phase', async () => {
    await submit({ at: new Date('2026-12-15T10:00:00.000Z') }); // outside both
    const res = await auth(request(target()).get(api('/dashboard/admin?phase=unassigned')));
    expect(res.body.kpis.feedbackCount).toBe(1);
  });

  test('an export can be scoped to one phase', async () => {
    const res = await auth(request(target()).get(api(`/export/dashboard/admin?format=xlsx&phase=${p1._id}`)))
      .buffer()
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
  });

  test('a bad phase id is refused rather than silently matching everything', async () => {
    /* The dangerous failure mode: an unparseable filter that quietly returns
       the whole dataset, so a phase report shows every phase and nobody
       notices. */
    const res = await auth(request(target()).get(api('/dashboard/admin?phase=not-an-id')));
    expect(res.status).toBe(400);
  });
});
