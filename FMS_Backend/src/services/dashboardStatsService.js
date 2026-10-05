/**
 * The statistics a feedback dashboard needs before it can claim to explain
 * itself, as opposed to merely reporting a number.
 *
 * Everything here takes an already-scoped `match` (see buildScopedMatch), so a
 * mentor's dashboard computes the same figures over their own sessions and
 * nobody else's. None of it re-derives scope.
 */
import mongoose from 'mongoose';
import { Feedback } from '../models/Feedback.js';
import { Class } from '../models/Class.js';
import { Parameter } from '../models/Parameter.js';
import { Batch } from '../models/Batch.js';

const round = (n, dp = 2) => {
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * How the stars are actually spread, not just where they average.
 *
 * This is the figure a single mean hides most dangerously. "4.2 out of 5"
 * describes a room where everyone was content AND a room that split down the
 * middle between delighted and disaffected, and those call for opposite
 * responses from whoever reads the report. The split matters more than the
 * mean whenever anyone is deciding what to actually do.
 *
 * Reported in the shape people already reason about from NPS — promoters,
 * passives, detractors — because "11% of ratings were 1s or 2s" is a sentence
 * a head of department can act on, where a standard deviation of 0.83 is not.
 */
export async function ratingDistribution(match) {
  const rows = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: '$ratings.stars',
        count: { $sum: 1 },
      },
    },
  ]);

  const [spread] = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: null,
        stdDev: { $stdDevPop: '$ratings.stars' },
        avg: { $avg: '$ratings.stars' },
        total: { $sum: 1 },
      },
    },
  ]);

  const byStar = new Map(rows.map((r) => [r._id, r.count]));
  const total = rows.reduce((n, r) => n + r.count, 0);

  const buckets = [1, 2, 3, 4, 5].map((stars) => {
    const count = byStar.get(stars) || 0;
    return { stars, count, pct: total ? round((count / total) * 100, 1) : 0 };
  });

  const sum = (from, to) =>
    buckets.filter((b) => b.stars >= from && b.stars <= to).reduce((n, b) => n + b.count, 0);

  const detractors = sum(1, 2);
  const passives = sum(3, 3);
  const promoters = sum(4, 5);

  return {
    buckets,
    total,
    average: round(spread?.avg ?? 0),
    /* Population, not sample: these ARE every rating given, not a draw from
       some larger pool we are trying to infer about. */
    stdDev: round(spread?.stdDev ?? 0),
    promoters,
    passives,
    detractors,
    promoterPct: total ? round((promoters / total) * 100, 1) : 0,
    passivePct: total ? round((passives / total) * 100, 1) : 0,
    detractorPct: total ? round((detractors / total) * 100, 1) : 0,
  };
}

/**
 * Every subject against every parameter — the grid that turns "the average is
 * 4.1" into "Communication is fine everywhere; Pace is where C Programming
 * loses people".
 *
 * A weakness is almost never uniform. It lives in one parameter of one
 * subject, and both marginal views — per-subject and per-parameter — average
 * it away into invisibility. Only the crossing shows it.
 */
export async function parameterBySubject(match, { minRatings = 1 } = {}) {
  const rows = await Feedback.aggregate([
    { $match: match },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: { class: '$class', parameter: '$ratings.parameter' },
        avg: { $avg: '$ratings.stars' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (!rows.length) return { parameters: [], subjects: [] };

  const [classes, params] = await Promise.all([
    Class.find({ _id: { $in: [...new Set(rows.map((r) => r._id.class))] } })
      .select('name')
      .lean(),
    Parameter.find().select('label order').lean(),
  ]);

  const className = new Map(classes.map((c) => [String(c._id), c.name]));
  const paramMeta = new Map(params.map((p) => [String(p._id), p]));

  // Only parameters that actually appear, in their configured order.
  const usedParamIds = [...new Set(rows.map((r) => String(r._id.parameter)))];
  const parameters = usedParamIds
    .map((id) => ({
      id,
      label: paramMeta.get(id)?.label || 'Removed parameter',
      order: paramMeta.get(id)?.order ?? 999,
    }))
    .sort((a, b) => a.order - b.order);

  const bySubject = new Map();
  for (const r of rows) {
    const cid = String(r._id.class);
    if (!bySubject.has(cid)) {
      bySubject.set(cid, { id: cid, name: className.get(cid) || 'Removed subject', cells: new Map(), total: 0, sum: 0 });
    }
    const s = bySubject.get(cid);
    s.cells.set(String(r._id.parameter), { average: round(r.avg), count: r.count });
    s.total += r.count;
    s.sum += r.avg * r.count;
  }

  const subjects = [...bySubject.values()]
    .filter((s) => s.total >= minRatings)
    .map((s) => ({
      id: s.id,
      name: s.name,
      ratings: s.total,
      average: round(s.sum / s.total),
      // Dense row aligned to `parameters`, so the UI never has to look up.
      cells: parameters.map((p) => s.cells.get(p.id) || null),
    }))
    .sort((a, b) => a.average - b.average); // weakest first — that is the point

  return { parameters, subjects };
}

/**
 * Sessions ranked, with a volume floor.
 *
 * The floor is the whole design. Sorting sessions by average with no minimum
 * puts whichever session happened to collect three responses at the top and
 * the bottom of the table, and a league table driven by sample noise is worse
 * than none: someone acts on it. A session below the floor is reported as
 * "not enough responses to say", which is the honest answer.
 */
export async function sessionRanking(match, { minResponses = 10, limit = 5 } = {}) {
  const rows = await Feedback.aggregate([
    { $match: match },
    {
      $group: {
        _id: { batch: '$batch', class: '$class' },
        responses: { $sum: 1 },
        starSum: { $sum: { $sum: '$ratings.stars' } },
        starCount: { $sum: { $size: '$ratings' } },
        stdDev: { $stdDevPop: { $avg: '$ratings.stars' } },
      },
    },
  ]);
  if (!rows.length) return { top: [], bottom: [], ranked: 0, belowFloor: 0, minResponses };

  const [batches, classes] = await Promise.all([
    Batch.find({ _id: { $in: [...new Set(rows.map((r) => r._id.batch))] } })
      .select('name yearGroup')
      .lean(),
    Class.find({ _id: { $in: [...new Set(rows.map((r) => r._id.class))] } })
      .select('name')
      .lean(),
  ]);
  const batchMeta = new Map(batches.map((b) => [String(b._id), b]));
  const className = new Map(classes.map((c) => [String(c._id), c.name]));

  const shaped = rows.map((r) => ({
    id: `${r._id.batch}|${r._id.class}`,
    batchId: String(r._id.batch),
    batchName: batchMeta.get(String(r._id.batch))?.name || 'Removed batch',
    yearGroup: batchMeta.get(String(r._id.batch))?.yearGroup || '',
    className: className.get(String(r._id.class)) || 'Removed subject',
    responses: r.responses,
    average: r.starCount ? round(r.starSum / r.starCount) : 0,
    // How divided the room was about this session, independent of its mean.
    spread: round(r.stdDev ?? 0),
  }));

  const eligible = shaped.filter((s) => s.responses >= minResponses);
  const byScore = [...eligible].sort((a, b) => b.average - a.average);

  return {
    top: byScore.slice(0, limit),
    bottom: [...byScore].reverse().slice(0, limit),
    ranked: eligible.length,
    belowFloor: shaped.length - eligible.length,
    minResponses,
  };
}

/**
 * How substantive the written feedback is.
 *
 * NOT "what share of responses had a comment" — the form requires one, so that
 * figure is 100% by construction and would sit on the dashboard looking like a
 * measurement while being a restatement of the validation rule. A number that
 * cannot vary tells a reader nothing and costs them attention to read.
 *
 * What does vary is depth. A cohort whose comments run to two words apiece has
 * complied with the form; one averaging thirty has actually told you
 * something, and only the second can carry a thematic analysis. That
 * distinction decides how much weight the comments deserve.
 */
export async function commentDepth(match) {
  const [agg] = await Feedback.aggregate([
    { $match: match },
    {
      $project: {
        words: {
          $cond: [
            { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$comment', ''] } } } }, 0] },
            {
              $size: {
                $filter: {
                  input: { $split: [{ $trim: { input: { $ifNull: ['$comment', ''] } } }, ' '] },
                  as: 'w',
                  cond: { $gt: [{ $strLenCP: '$$w' }, 0] },
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        withComment: { $sum: { $cond: [{ $gt: ['$words', 0] }, 1, 0] } },
        words: { $sum: '$words' },
        brief: { $sum: { $cond: [{ $and: [{ $gt: ['$words', 0] }, { $lte: ['$words', 5] }] }, 1, 0] } },
        moderate: { $sum: { $cond: [{ $and: [{ $gt: ['$words', 5] }, { $lte: ['$words', 20] }] }, 1, 0] } },
        detailed: { $sum: { $cond: [{ $gt: ['$words', 20] }, 1, 0] } },
      },
    },
  ]);

  const total = agg?.total || 0;
  const withComment = agg?.withComment || 0;
  const pctOf = (n) => (withComment ? round((n / withComment) * 100, 1) : 0);

  return {
    total,
    withComment,
    pct: total ? round((withComment / total) * 100, 1) : 0,
    avgWords: withComment ? round((agg?.words || 0) / withComment, 1) : 0,
    brief: agg?.brief || 0,
    moderate: agg?.moderate || 0,
    detailed: agg?.detailed || 0,
    briefPct: pctOf(agg?.brief || 0),
    moderatePct: pctOf(agg?.moderate || 0),
    detailedPct: pctOf(agg?.detailed || 0),
  };
}

/**
 * Collection health per cohort: who answered, who did not.
 *
 * A response rate quoted for the institution hides the cohort that returned
 * 20%. Averages over cohorts of wildly different sizes are not comparable, and
 * the under-collected ones are precisely the ones whose numbers should be
 * trusted least.
 *
 * `answered` is the MAX row count across a batch's subjects, not the sum:
 * within one batch each student answers every subject once, so a two-subject
 * batch writes two rows per student and summing would double its apparent
 * turnout. (This is the same arithmetic that makes 1259 rows and 993 students
 * both correct figures.)
 *
 * PHASE. When a phase is selected this must answer "how is THAT collection
 * going", not "how did collection go, ever". Those differ completely the
 * moment a second phase is opened: without the filter, selecting a phase that
 * has collected nothing still reported the previous phase's turnout, so a
 * dashboard scoped to November showed September's 57.8% and looked like work
 * that had already happened.
 *
 * A cohort belongs to a phase's collection when it has responses stamped with
 * that phase, or when it is open right now and that phase is the one currently
 * claiming submissions. The second half is what makes the panel fill in batch
 * by batch as a round is collected, rather than appearing all at once at the
 * end; the first is what keeps a finished phase readable afterwards.
 */
export async function collectionHealth({
  scopeBatchIds = null,
  phase = null,
  phaseIsCurrent = false,
  limit = 0,
} = {}) {
  const filter = { archivedAt: null, expectedCount: { $gt: 0 } };
  if (scopeBatchIds) filter._id = { $in: scopeBatchIds };

  /* The lookup counts only this phase's rows. `phase: null` is a real choice
     (feedback belonging to no exercise), so an explicit 'unassigned' is
     matched as such rather than treated as "no filter". */
  const feedbackMatch =
    phase === 'unassigned'
      ? [{ $match: { phase: null } }]
      : phase
        ? [{ $match: { phase: phase._id } }]
        : [];

  const rows = await Batch.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: 'feedbacks',
        localField: '_id',
        foreignField: 'batch',
        as: 'rows',
        pipeline: [...feedbackMatch, { $group: { _id: '$class', n: { $sum: 1 } } }],
      },
    },
    {
      $project: {
        name: 1,
        yearGroup: 1,
        status: 1,
        expectedCount: 1,
        answered: {
          $max: { $ifNull: [{ $map: { input: '$rows', as: 'r', in: '$$r.n' } }, [0]] },
        },
      },
    },
  ]);

  const shaped = rows
    .map((b) => {
      const answered = b.answered || 0;
      return {
        id: String(b._id),
        name: b.name,
        yearGroup: b.yearGroup || '',
        status: b.status,
        expected: b.expectedCount,
        answered,
        rate: b.expectedCount ? round((answered / b.expectedCount) * 100, 1) : 0,
      };
    })
    /* Under a phase, a cohort that has not been collected in it is not at 0% —
       it is not part of this exercise at all, and listing it at 0% would read
       as a failure to respond rather than a round that has not started. The
       exception is a cohort open right now, which IS this phase's collection
       in progress and should show its turnout climbing. */
    .filter((b) => !phase || b.answered > 0 || (phaseIsCurrent && b.status === 'open'))
    .sort((a, b) => a.rate - b.rate);

  return limit ? shaped.slice(0, limit) : shaped;
}

/**
 * The institution-wide response rate, derived from the very same rows the
 * per-cohort panel is drawn from.
 *
 * Kept as one computation deliberately. The headline and the breakdown under
 * it were previously two separate aggregations over two different definitions,
 * which is how the KPI and the panel came to disagree once a phase was
 * selected — and a dashboard whose summary contradicts its own detail teaches
 * the reader to trust neither.
 */
export function coverageTotals(health) {
  const expected = health.reduce((n, b) => n + b.expected, 0);
  const submitted = health.reduce((n, b) => n + b.answered, 0);
  return {
    expected,
    submitted,
    responseRate: expected ? round((submitted / expected) * 100, 1) : 0,
  };
}
