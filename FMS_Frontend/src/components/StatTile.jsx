import InfoTooltip from './InfoTooltip.jsx';
import Icon from './Icon.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';

/**
 * A KPI tile. Every tile carries a tooltip so a newcomer can learn what the
 * number means just by hovering — part of the self-documenting dashboard goal.
 *
 * Redesign notes:
 *  - The number is the tile. It's set at display size with tabular figures, and
 *    the label is demoted to a small caps eyebrow. Previously label and value
 *    competed at similar weight, which is why the row read as flat.
 *  - The icon sits in a tinted chip rather than floating next to the number, so
 *    the tile has a consistent anchor point at any value length.
 *  - The entrance is a CSS animation: it's predetermined (nothing to interrupt),
 *    runs off the main thread, and can't strand the value invisible.
 */
/**
 * Accent colours from the Torii chart palette (ACCENTS in their charts.jsx),
 * so a tile and a chart series referring to the same thing agree.
 */
const ACCENTS = {
  brand: '#ea5829',
  sky: '#0ea5e9',
  emerald: '#10b981',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  rose: '#f43f5e',
  teal: '#14b8a6',
  indigo: '#6366f1',
};

export default function StatTile({ label, value, hint, icon, accent = 'brand', delay = 0, sub }) {
  const color = ACCENTS[accent] || ACCENTS.brand;

  // Only numeric values count up; "—" or a formatted string renders as-is.
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value));
  const decimals = numeric && String(value).includes('.') ? String(value).split('.')[1].length : 0;

  return (
    <div
      className="card animate-fade-up group relative overflow-hidden p-4 sm:p-5 transition-shadow duration-200 ease-out-expo hover:shadow-card-hover"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Torii's signature: a solid accent rule across the top of the tile.
          It colour-codes the metric without tinting the whole card, so a row of
          six tiles stays calm while remaining individually identifiable. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: color }}
      />

      <div className="relative flex items-start justify-between gap-2 pt-1">
        {/* Icon lifts slightly on hover — gated to real pointers by the
            group-hover only firing where hover exists. */}
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 ease-out-expo group-hover:-translate-y-0.5 group-hover:scale-105"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          <Icon name={icon} size={18} />
        </span>
        {hint && <InfoTooltip text={hint} />}
      </div>

      <p className="relative mt-3.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>

      <p className="tnum relative mt-1.5 flex items-baseline gap-1.5 text-display-sm text-ink">
        {numeric ? <AnimatedNumber value={Number(value)} decimals={decimals} /> : value}
        {sub && <span className="text-xs font-medium text-subtle">{sub}</span>}
      </p>
    </div>
  );
}
