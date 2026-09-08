import mongoose from 'mongoose';
import { Feedback } from '../models/Feedback.js';
import { Class } from '../models/Class.js';
import { Batch } from '../models/Batch.js';
import { User } from '../models/User.js';
import { Parameter } from '../models/Parameter.js';
import { round, andMatch } from './analyticsService.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/* ═══════════════════════════════════════════════════════════════════════════
   PERIOD-OVER-PERIOD DELTAS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compare the last `days` against the `days` immediately before them.
 *
 * A trend line shows movement; a delta STATES it. "4.50, up 0.30 from last
 * month" is the sentence a head of training repeats in a meeting, and it's the
 * one thing a chart alone never gives you.
 *
 * Returns nulls rather than zeros when a period has no data — "no change" and
 * "nothing to compare" are different claims, and showing +0.00 for a brand new
 * class would be a lie of precision.
 */
export async function periodDeltas(match, days = 30) {
  const now = new Date();
  const currentFrom = new Date(now.getTime() - days * 86400_000);
  const previousFrom = new Date(now.getTime() - days * 2 * 86400_000);

  const [current, previous] = await Promise.all([
    windowStats(match, currentFrom, now),
    windowStats(match, previousFrom, currentFrom),
  ]);

  const delta = (a, b) => (a == null || b == null ? null : round(a - b, 2));

  return {
    days,
    current,
    previous,
    change: {
      average: delta(current.average, previous.average),
      responses: current.responses - previous.responses,
      // Percentage change in volume, guarded against a zero base.
      responsesPct:
        previous.responses > 0
          ? round(((current.responses - previous.responses) / previous.responses) * 100, 1)
          : null,
    },
  };
}

async function windowStats(match, from, to) {
  const [agg] = await Feedback.aggregate([
    // andMatch, not a spread: `match` may already carry an $and/$or (the
    // mentor-roster check is an $or), and merging keys would silently drop it.
    { $match: andMatch(match, { createdAt: { $gte: from, $lt: to } }) },
    { $unwind: '$ratings' },
    {
      $group: {
        _id: null,
        avg: { $avg: '$ratings.stars' },
        ids: { $addToSet: '$_id' },
      },
    },
    { $project: { avg: 1, responses: { $size: '$ids' } } },
  ]);

  return {
    // null (not 0) when the window is empty — see the note above.
    average: agg ? round(agg.avg, 2) : null,
    responses: agg?.responses || 0,
    from,
    to,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRAINER COMPARISON  (admin only)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every trainer ranked on the same parameters.
 *
 * This is the question the dashboard raises but never answers. It is also the
 * most sensitive view in the product, so two deliberate choices:
 *  - trainers with NO responses are returned with `responses: 0` and a null
 *    average rather than being ranked last, because "unrated" is not "bad";
 *  - each trainer's per-parameter averages come back too, so a low overall
 *    score can be read as "pace, specifically" instead of a bare verdict.
 */
export async function trainerComparison({ role } = {}) {
  const [trainers, params] = await Promise.all([
    User.find({ role: 'trainer' }).select('name shortName email isActive').lean(),
    Parameter.find({ isActive: true }).sort({ order: 1 }).select('label').lean(),
  ]);
  if (!trainers.length) return { trainers: [], parameters: [] };

  /* Which roster(s) count for this comparison.
     This used to be computed from `Class.trainer` — catalog ownership — which
     is no longer the source of truth and was never right for a co-taught
     subject: two mentors delivering the same class both deserve its score, and
     the catalog can only name one. Attribution now comes from the rosters
     denormalised onto each Feedback row, so it follows who actually taught. */
  const rosters = [];
  if (role !== 'support') rosters.push('mainTrainers');
  if (role !== 'main') rosters.push('supportTrainers');

  /** Aggregate per-mentor figures by unwinding one roster field. */
  const perRoster = (field) => [
    { $unwind: `$${field}` },
    {
      $facet: {
        overall: [
          { $unwind: '$ratings' },
          {
            $group: {
              _id: `$${field}`,
              sum: { $sum: '$ratings.stars' },
              n: { $sum: 1 },
              ids: { $addToSet: '$_id' },
              last: { $max: '$createdAt' },
              classes: { $addToSet: '$class' },
              batches: { $addToSet: '$batch' },
            },
          },
        ],
        byParam: [
          { $unwind: '$ratings' },
          {
            $group: {
              _id: { t: `$${field}`, p: '$ratings.parameter' },
              sum: { $sum: '$ratings.stars' },
              n: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];

  const facets = await Promise.all(
    rosters.map((f) => Feedback.aggregate(perRoster(f)).then((r) => r[0] || { overall: [], byParam: [] }))
  );

  // Merge the rosters. A mentor who both delivers and assists has their
  // figures summed across both, weighted by rating count — the same weighting
  // used for the per-class roll-up, so one two-response session cannot swing
  // a mentor's score.
  const agg = new Map(); // trainerId -> { sum, n, ids:Set, last, classes:Set, batches:Set }
  const byParam = new Map(); // trainerId -> paramId -> { sum, n }

  for (const facet of facets) {
    for (const row of facet.overall) {
      const k = String(row._id);
      const cur = agg.get(k) || {
        sum: 0, n: 0, ids: new Set(), last: null,
        classes: new Set(), batches: new Set(),
      };
      cur.sum += row.sum;
      cur.n += row.n;
      row.ids.forEach((id) => cur.ids.add(String(id)));
      row.classes.forEach((id) => cur.classes.add(String(id)));
      row.batches.forEach((id) => cur.batches.add(String(id)));
      if (row.last && (!cur.last || row.last > cur.last)) cur.last = row.last;
      agg.set(k, cur);
    }
    for (const row of facet.byParam) {
      const k = String(row._id.t);
      const pid = String(row._id.p);
      if (!byParam.has(k)) byParam.set(k, new Map());
      const m = byParam.get(k);
      const cur = m.get(pid) || { sum: 0, n: 0 };
      cur.sum += row.sum;
      cur.n += row.n;
      m.set(pid, cur);
    }
  }

  // Current staffing load, so an unrated mentor still shows what they teach.
  const staffFields = rosters.map((f) => `classes.${f}`);
  const load = await Batch.aggregate([
    { $match: { archivedAt: null } },
    { $unwind: '$classes' },
    {
      $project: {
        staff: {
          $setUnion: staffFields.map((f) => ({ $ifNull: [`$${f}`, []] })),
        },
      },
    },
    { $unwind: '$staff' },
    { $group: { _id: '$staff', classes: { $sum: 1 }, batches: { $addToSet: '$_id' } } },
    { $project: { classes: 1, batches: { $size: '$batches' } } },
  ]);
  const loadBy = new Map(load.map((l) => [String(l._id), l]));

  const rows = trainers.map((t) => {
    const k = String(t._id);
    const a = agg.get(k);
    const pm = byParam.get(k) || new Map();
    const l = loadBy.get(k) || { classes: 0, batches: 0 };

    return {
      id: k,
      name: t.name,
      shortName: t.shortName || '',
      email: t.email,
      isActive: t.isActive !== false,
      classes: l.classes,
      batches: l.batches,
      responses: a ? a.ids.size : 0,
      // Weighted by rating count so a session with 40 responses counts more
      // than one with 2.
      average: a && a.n > 0 ? round(a.sum / a.n, 2) : null,
      lastFeedbackAt: a?.last || null,
      perParameter: params.map((p) => {
        const x = pm.get(String(p._id));
        return { label: p.label, average: x && x.n ? round(x.sum / x.n, 2) : null };
      }),
    };
  });

  // Rated mentors first (best → worst), then unrated ones alphabetically.
  rows.sort((a, b) => {
    if (a.average == null && b.average == null) return a.name.localeCompare(b.name);
    if (a.average == null) return 1;
    if (b.average == null) return -1;
    return b.average - a.average;
  });

  return { trainers: rows, parameters: params.map((p) => p.label), role: role || 'all' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMMENT THEMES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Stop words. Deliberately generous — without this the "top themes" of any
 * feedback set are "the", "was" and "very", which is worse than showing nothing.
 */
const STOP = new Set(`
a about above after again against all am an and any are aren't as at be because been before being
below between both but by can cannot could couldn't did didn't do does doesn't doing don't down
during each few for from further had hadn't has hasn't have haven't having he her here hers herself
him himself his how i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most
mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same
shan't she should shouldn't so some such than that the their theirs them themselves then there these
they this those through to too under until up very was wasn't we were weren't what when where which
while who whom why with won't would wouldn't you your yours yourself yourselves
also just get got really much many lot bit even still able make made makes going go went
session sessions class classes trainer trainers course topic topics thing things
`.trim().split(/\s+/));

/** Phrases worth surfacing as a unit rather than as two separate words. */
const BIGRAM_KEEP = /^(real world|time management|group discussion|hands on|mock interview|body language|problem solving|doubt clearing|practical example|practical examples|question paper|study material|study materials)$/;

/**
 * Extract recurring themes from free-text comments, each with the average
 * rating of the responses that mention it.
 *
 * The rating association is what makes this actionable: "pace — 23 mentions,
 * avg 2.9" tells you what to fix, whereas a bare word cloud tells you only what
 * people talked about. Terms mentioned once are dropped; a "theme" of one is
 * an anecdote.
 */
export async function commentThemes(match, limit = 12) {
  const docs = await Feedback.aggregate([
    { $match: match },
    {
      $project: {
        comment: 1,
        average: { $avg: '$ratings.stars' },
        createdAt: 1,
        batch: 1,
        class: 1,
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 2000 }, // bounded: this runs on a request, not a batch job
  ]);

  // Resolve batch and class names once so every theme can name its sources.
  // A source is now a (batch, class) PAIR: a batch holds many classes, and each
  // comment belongs to one specific class within it, so tracing a theme back to
  // just the batch would lose which class the students were actually talking
  // about. The drill-down link carries both ids.
  const batchIds = [...new Set(docs.map((d) => String(d.batch)))];
  const classIds = [...new Set(docs.map((d) => String(d.class)))];
  const [batches, classes] = await Promise.all([
    Batch.find({ _id: { $in: batchIds } }).select('name').lean(),
    Class.find({ _id: { $in: classIds } }).select('name').lean(),
  ]);
  const batchNameById = new Map(batches.map((b) => [String(b._id), b.name]));
  const classNameById = new Map(classes.map((c) => [String(c._id), c.name]));

  // term -> { count, sum, sources: Map("batchId|classId" -> count) }
  const terms = new Map();

  const bump = (term, rating, batchId, classId) => {
    const cur = terms.get(term) || { count: 0, sum: 0, sources: new Map() };
    cur.count += 1;
    cur.sum += rating || 0;
    // Track WHERE each mention came from — the batch AND the class — so a theme
    // can be traced back to the exact cohort+subject that produced it.
    if (batchId) {
      const k = `${batchId}|${classId}`;
      cur.sources.set(k, (cur.sources.get(k) || 0) + 1);
    }
    terms.set(term, cur);
  };

  for (const d of docs) {
    const words = String(d.comment || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    // Count each term ONCE per comment: a person repeating "pace" four times is
    // still one person with an opinion about pace.
    const seen = new Set();

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) {
        const stem = singular(w);
        if (!seen.has(stem)) {
          seen.add(stem);
          bump(stem, d.average, String(d.batch), String(d.class));
        }
      }
      if (i < words.length - 1) {
        const bg = `${words[i]} ${words[i + 1]}`;
        if (BIGRAM_KEEP.test(bg) && !seen.has(bg)) {
          seen.add(bg);
          bump(bg, d.average, String(d.batch), String(d.class));
        }
      }
    }
  }

  const themes = [...terms.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([term, v]) => ({
      term,
      mentions: v.count,
      average: round(v.sum / v.count, 2),
      // Which cohort+class each mention came from, busiest first — the entry
      // point for "show me the actual comments behind this number". `id` is the
      // composite key (unique per row); batchId/classId drive the drill-down.
      sources: [...v.sources.entries()]
        .map(([key, count]) => {
          const [batchId, classId] = key.split('|');
          return {
            id: key,
            batchId,
            classId,
            name: batchNameById.get(batchId) || 'Unknown batch',
            className: classNameById.get(classId) || '—',
            count,
          };
        })
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.mentions - a.mentions || a.average - b.average)
    .slice(0, limit);

  return {
    themes,
    analysed: docs.length,
    // Split for the UI: what people praise vs what needs attention.
    positive: themes.filter((t) => t.average >= 4).slice(0, 6),
    negative: themes.filter((t) => t.average < 3.5).slice(0, 6),
  };
}

/** Crude English singulariser — enough to merge "examples"/"example". */
function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
