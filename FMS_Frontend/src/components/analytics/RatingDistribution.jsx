import Card from '../Card.jsx';

/* Semantic, matching StatTile's vocabulary: a 5 is not "series one", it is a
   good outcome, and the colour should say so without a legend. */
const BAR = {
  5: 'bg-emerald-500',
  4: 'bg-emerald-400',
  3: 'bg-amber-400',
  2: 'bg-rose-400',
  1: 'bg-rose-500',
};

/**
 * How the stars are spread, not merely where they average.
 *
 * The single most misleading number on any feedback dashboard is the mean.
 * "4.2 out of 5" describes a cohort that was uniformly content and a cohort
 * that split between delighted and disaffected, and those two call for
 * opposite responses from whoever reads it. This panel exists so nobody
 * presents the first when the data is the second.
 *
 * The sentiment bar runs first because it answers the question people actually
 * arrive with — is this good? — and the histogram underneath answers the one
 * they ask second, which is how sure can I be.
 */
export default function RatingDistribution({ data }) {
  if (!data || !data.total) {
    return (
      <Card title="Rating distribution" icon="barChart">
        <p className="p-5 text-sm text-muted">No ratings yet.</p>
      </Card>
    );
  }

  const max = Math.max(...data.buckets.map((b) => b.count), 1);
  const segments = [
    { key: 'promoters', label: 'Positive', sub: '4–5★', pct: data.promoterPct, n: data.promoters, cls: 'bg-emerald-500' },
    { key: 'passives', label: 'Neutral', sub: '3★', pct: data.passivePct, n: data.passives, cls: 'bg-amber-400' },
    { key: 'detractors', label: 'Negative', sub: '1–2★', pct: data.detractorPct, n: data.detractors, cls: 'bg-rose-500' },
  ];

  /* A population standard deviation is the right statistic and the wrong
     label: nobody acts on "σ = 0.83". The thresholds turn it back into the
     judgement it stands for. */
  const consensus =
    data.stdDev <= 0.6
      ? { word: 'Strong agreement', tone: 'text-emerald-600 dark:text-emerald-400' }
      : data.stdDev <= 1.0
        ? { word: 'Some variation', tone: 'text-amber-600 dark:text-amber-400' }
        : { word: 'Sharply divided', tone: 'text-rose-600 dark:text-rose-400' };

  return (
    <Card
      title="Rating distribution"
      icon="barChart"
      subtitle={`${data.total.toLocaleString()} individual ratings`}
      hint="Every star given, grouped by value. An average alone cannot tell a contented cohort from a split one."
    >
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="tnum text-display leading-none text-ink">{data.average.toFixed(2)}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">mean rating</p>
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${consensus.tone}`}>{consensus.word}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              spread <span className="tnum font-medium text-ink">±{data.stdDev.toFixed(2)}</span> around the mean
            </p>
          </div>
        </div>

        {/* Sentiment split — one bar, because the three shares are parts of a
            whole and three separate bars would hide that. */}
        <div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
            {segments.map(
              (s) =>
                s.pct > 0 && (
                  <div
                    key={s.key}
                    className={`${s.cls} transition-[width] duration-500 ease-out-expo`}
                    style={{ width: `${s.pct}%` }}
                    title={`${s.label} ${s.sub}: ${s.n.toLocaleString()} (${s.pct}%)`}
                  />
                )
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.cls}`} />
                <span className="text-[11px] text-muted">
                  <span className="tnum font-semibold text-ink">{s.pct}%</span> {s.label}{' '}
                  <span className="text-subtle">{s.sub}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* The histogram proper, 5 at the top: people read a rating scale
            downwards from best, and reversing it makes every glance a puzzle. */}
        <ul className="space-y-1.5" data-testid="histogram">
          {[...data.buckets].reverse().map((b) => (
            <li key={b.stars} className="flex items-center gap-3">
              <span className="tnum w-6 shrink-0 text-right text-xs font-semibold text-muted">{b.stars}★</span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-2">
                <div
                  className={`h-full rounded-md ${BAR[b.stars]} transition-[width] duration-500 ease-out-expo`}
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </div>
              <span className="tnum w-20 shrink-0 text-right text-xs text-muted">
                <span className="font-semibold text-ink">{b.count.toLocaleString()}</span>
                <span className="ml-1 text-subtle">{b.pct}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
