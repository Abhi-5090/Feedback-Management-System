import mongoose from 'mongoose';
import { Feedback } from '../models/Feedback.js';
import { Class } from '../models/Class.js';
import { User } from '../models/User.js';
import { round } from './analyticsService.js';

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
    { $match: { ...match, createdAt: { $gte: from, $lt: to } } },
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
export async function trainerComparison() {
  const [trainers, classes] = await Promise.all([
    User.find({ role: 'trainer' }).select('name email isActive').lean(),
    Class.find({ archivedAt: null }).select('name trainer').lean(),
  ]);

  const classesByTrainer = new Map();
  for (const c of classes) {
    const k = String(c.trainer);
    if (!classesByTrainer.has(k)) classesByTrainer.set(k, []);
    classesByTrainer.get(k).push(c);
  }

  const allClassIds = classes.map((c) => c._id);
  if (!allClassIds.length) return { trainers: [], parameters: [] };

  // Two grouped aggregations for the whole comparison, not one per trainer.
  const [overall, perParam] = await Promise.all([
    Feedback.aggregate([
      { $match: { class: { $in: allClassIds } } },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: '$class',
          avg: { $avg: '$ratings.stars' },
          ids: { $addToSet: '$_id' },
          last: { $max: '$createdAt' },
        },
      },
      { $project: { avg: 1, last: 1, responses: { $size: '$ids' } } },
    ]),
    Feedback.aggregate([
      { $match: { class: { $in: allClassIds } } },
      { $unwind: '$ratings' },
      {
        $group: {
          _id: { c: '$class', p: '$ratings.parameter' },
          avg: { $avg: '$ratings.stars' },
        },
      },
    ]),
  ]);

  const byClass = new Map(overall.map((o) => [String(o._id), o]));
  const { Parameter } = await import('../models/Parameter.js');
  const params = await Parameter.find({ isActive: true }).sort({ order: 1 }).select('label').lean();
  const paramIds = params.map((p) => String(p._id));

  // class -> parameter -> avg
  const paramByClass = new Map();
  for (const r of perParam) {
    const c = String(r._id.c);
    if (!paramByClass.has(c)) paramByClass.set(c, {});
    paramByClass.get(c)[String(r._id.p)] = r.avg;
  }

  const rows = trainers.map((t) => {
    const own = classesByTrainer.get(String(t._id)) || [];
    let sum = 0;
    let n = 0;
    let responses = 0;
    let last = null;
    const paramSums = {};

    for (const c of own) {
      const st = byClass.get(String(c._id));
      if (st) {
        sum += st.avg * st.responses;
        n += st.responses;
        responses += st.responses;
        if (!last || (st.last && st.last > last)) last = st.last;
      }
      const pmap = paramByClass.get(String(c._id)) || {};
      for (const pid of paramIds) {
        if (pmap[pid] != null) {
          paramSums[pid] = paramSums[pid] || { sum: 0, n: 0 };
          paramSums[pid].sum += pmap[pid];
          paramSums[pid].n += 1;
        }
      }
    }

    return {
      id: String(t._id),
      name: t.name,
      email: t.email,
      isActive: t.isActive !== false,
      classes: own.length,
      responses,
      // Weighted by response count so a class with 40 responses counts more
      // than one with 2 — a plain mean of class means would let a single
      // two-response class swing a trainer's score.
      average: n > 0 ? round(sum / n, 2) : null,
      lastFeedbackAt: last,
      perParameter: params.map((p) => {
        const agg = paramSums[String(p._id)];
        return {
          label: p.label,
          average: agg ? round(agg.sum / agg.n, 2) : null,
        };
      }),
    };
  });

  // Rated trainers first (best → worst), then unrated ones alphabetically.
  rows.sort((a, b) => {
    if (a.average == null && b.average == null) return a.name.localeCompare(b.name);
    if (a.average == null) return 1;
    if (b.average == null) return -1;
    return b.average - a.average;
  });

  return { trainers: rows, parameters: params.map((p) => p.label) };
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
  const { Batch } = await import('../models/Batch.js');
  const { Class } = await import('../models/Class.js');
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
