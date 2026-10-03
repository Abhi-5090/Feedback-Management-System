import { jest } from '@jest/globals';
import { isMain } from '../utils/isMain.js';
import { planCounterChanges, answeredByBatch } from '../scripts/reconcile-counters.js';

/**
 * The maintenance scripts.
 *
 * These were the least-tested code in the project at 0% and the most dangerous:
 * they run once, against production, usually under pressure, and they rewrite
 * documents. Two defects were found in the course of covering them —
 *
 *   1. every script executed on IMPORT, so reading a helper out of one
 *      connected to whatever MONGO_URI pointed at and began writing;
 *   2. `reset-and-import.js` would wipe whatever database the URI named, with
 *      `--yes` as the only gate (see destructiveGuard.test.js).
 *
 * — and both are guarded here.
 */

describe('scripts do not execute on import', () => {
  test('isMain is false when the module was imported, not invoked', () => {
    /* The property that makes the rest of this file possible. If this ever
       regresses, importing a migration starts writing to the database the
       developer's .env happens to point at. */
    expect(isMain(import.meta.url)).toBe(false);
  });

  test('isMain is true for the file node was actually asked to run', () => {
    const invoked = `file://${process.argv[1]}`;
    expect(isMain(invoked)).toBe(true);
  });

  test('a path that does not exist is not main, and does not throw', () => {
    expect(isMain('file:///nope/does/not/exist.js')).toBe(false);
  });
});

describe('answeredByBatch', () => {
  const row = (batch, cls, n) => ({ _id: { batch, class: cls }, n });

  test('takes the MAX across classes, never the sum', () => {
    /* The rule the whole script turns on. A student submits one row per class,
       so a 2-class batch answered by 40 students holds 80 rows and has been
       answered 40 times. Summing would double the counter, push it past
       expectedCount, and wedge an open batch closed — every submission then
       refused with "this batch has reached its expected number of responses",
       which reads as a broken form rather than a stale number. */
    const answered = answeredByBatch([row('b1', 'c1', 40), row('b1', 'c2', 40)]);
    expect(answered.get('b1')).toBe(40);
  });

  test('uneven classes take the largest, because that is how many people answered', () => {
    // 40 answered GenAI, 38 of them also answered Coding → 40 students.
    const answered = answeredByBatch([row('b1', 'c1', 40), row('b1', 'c2', 38)]);
    expect(answered.get('b1')).toBe(40);
  });

  test('keeps batches separate', () => {
    const answered = answeredByBatch([row('b1', 'c1', 10), row('b2', 'c1', 3)]);
    expect(answered.get('b1')).toBe(10);
    expect(answered.get('b2')).toBe(3);
  });

  test('no rows means no entry, not zero', () => {
    expect(answeredByBatch([]).size).toBe(0);
  });

  test('ObjectId-ish keys are normalised to strings', () => {
    const oid = { toString: () => 'abc123' };
    expect(answeredByBatch([row(oid, 'c1', 5)]).get('abc123')).toBe(5);
  });
});

describe('planCounterChanges', () => {
  const batch = (over = {}) => ({
    _id: 'b1', name: 'Cohort', submittedCount: 0, expectedCount: 100, status: 'locked', ...over,
  });

  test('a counter matching reality is left alone', () => {
    const plan = planCounterChanges([batch({ submittedCount: 40 })], new Map([['b1', 40]]));
    expect(plan).toEqual([]);
  });

  test('a counter ABOVE reality is lowered — the case that wedges a batch shut', () => {
    /* The real incident this script was written for: batches reporting 46, 38
       and 41 submissions with zero rows behind them, refusing every new
       submission because the conditional increment could not match. */
    const plan = planCounterChanges([batch({ submittedCount: 46, status: 'open' })], new Map());
    expect(plan).toEqual([{ b: expect.objectContaining({ _id: 'b1' }), from: 46, to: 0 }]);
  });

  test('a counter BELOW reality is raised', () => {
    const plan = planCounterChanges([batch({ submittedCount: 10 })], new Map([['b1', 66]]));
    expect(plan[0]).toMatchObject({ from: 10, to: 66 });
  });

  test('a missing counter is treated as zero, not skipped', () => {
    const plan = planCounterChanges([batch({ submittedCount: undefined })], new Map([['b1', 5]]));
    expect(plan[0]).toMatchObject({ from: 0, to: 5 });
  });

  test('is IDEMPOTENT — applying the plan leaves nothing to do', () => {
    /* A migration that is not idempotent cannot be re-run safely, and these
       get re-run: someone always wonders whether the first attempt finished. */
    const batches = [batch({ submittedCount: 46 }), batch({ _id: 'b2', submittedCount: 0 })];
    const answered = new Map([['b1', 40], ['b2', 7]]);

    const first = planCounterChanges(batches, answered);
    expect(first).toHaveLength(2);

    const applied = batches.map((b) => {
      const change = first.find((c) => c.b._id === b._id);
      return change ? { ...b, submittedCount: change.to } : b;
    });
    expect(planCounterChanges(applied, answered)).toEqual([]);
  });

  test('an empty database produces an empty plan rather than throwing', () => {
    expect(planCounterChanges([], new Map())).toEqual([]);
  });
});
