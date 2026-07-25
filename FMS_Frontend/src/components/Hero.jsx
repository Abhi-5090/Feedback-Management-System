/**
 * Dashboard hero band.
 *
 * The job of a hero here is not decoration — it's to answer "how are we doing?"
 * before the user reads anything else. So the headline metric is set at display
 * size with its own star row, and the supporting counts sit beside it as glass
 * tiles. Everything below the hero is detail; this is the summary.
 *
 * The mesh is pure CSS gradients (see .hero in index.css) — no image request,
 * crisp at any width, and themeable.
 */
import AnimatedNumber from './AnimatedNumber.jsx';

const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v));
const decimalsOf = (v) => (String(v).includes('.') ? String(v).split('.')[1].length : 0);

export default function Hero({ eyebrow, title, subtitle, metric, metricLabel, metricSuffix, stats = [], actions }) {
  return (
    <section className="hero px-5 py-6 sm:px-7 sm:py-8">
      <div className="hero-body flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/70">{subtitle}</p>
          )}

          {actions && <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Headline metric */}
          {metric != null && (
            <div className="hero-tile min-w-[168px] px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
                {metricLabel}
              </p>
              <p className="tnum mt-1 flex items-baseline gap-1.5 text-display-sm text-white">
                {isNum(metric) ? (
                  <AnimatedNumber value={Number(metric)} decimals={decimalsOf(metric)} />
                ) : (
                  metric
                )}
                {metricSuffix && (
                  <span className="text-sm font-medium text-white/60">{metricSuffix}</span>
                )}
              </p>
            </div>
          )}

          {/* Supporting counts */}
          {stats.map((s) => (
            <div
              key={s.label}
              className="hero-tile min-w-[104px] px-4 py-3.5 transition-colors duration-200 hover:bg-white/[0.16]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
                {s.label}
              </p>
              <p className="tnum mt-0.5 text-xl font-bold text-white">
                {isNum(s.value) ? (
                  <AnimatedNumber value={Number(s.value)} decimals={decimalsOf(s.value)} />
                ) : (
                  s.value
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
