import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';

/**
 * Choose which COLLECTION of a batch to look at.
 *
 * Feedback is gathered repeatedly — weekly here — and each unlock opens a new
 * window, stamping every response written during it. Without this control all
 * of those windows pile into one blended average, so a cohort whose ratings
 * slipped from 4.5 to 3.2 between two weeks shows a flat 3.85 and the decline
 * is invisible. Comparing weeks is the entire reason for asking repeatedly.
 *
 * Labelled by DATE, not by round number, because that is what people remember —
 * "the one we took on the 8th", never "round 3". The number is kept as a
 * secondary hint for the case where two collections land on the same day.
 */
const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A collection spanning days reads as a range; one day reads as a date. */
function label(c) {
  if (!c.days?.length) return `Round ${c.round}`;
  const first = fmtDay(c.days[0]);
  if (c.days.length === 1) return first;
  return `${fmtDay(c.days[0])} – ${fmtDay(c.days[c.days.length - 1])}`;
}

export default function CollectionPicker({ collections, value, onChange, loading = false }) {
  // One collection is not a choice — showing a dropdown with a single option
  // implies there is something to switch to.
  if (!collections?.length || collections.length < 2) {
    if (!collections?.length) return null;
    const only = collections[0];
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Icon name="inbox" size={13} />
        Collected {label(only)} ·{' '}
        <span className="tnum font-semibold text-ink">{only.responses}</span> responses
      </p>
    );
  }

  const total = collections.reduce((n, c) => n + c.responses, 0);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-[210px] flex-col gap-1">
        <label
          htmlFor="collection-picker"
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted"
        >
          Collection
          <InfoTooltip text="Each time this batch was unlocked for feedback is a separate collection. Pick one to see only that week's responses, or All to see them combined." />
        </label>
        <div className="relative">
          <select
            id="collection-picker"
            className="input pr-9"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            disabled={loading}
          >
            <option value="">All collections · {total} responses</option>
            {collections.map((c) => (
              <option key={c.round} value={c.round}>
                {label(c)} · {c.responses} responses
                {c.average != null ? ` · ${c.average.toFixed(2)}★` : ''}
              </option>
            ))}
          </select>
          {/* A spinner inside the control, so the thing you just changed is the
              thing that shows it is working. */}
          {loading && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            </span>
          )}
        </div>
      </div>

      {value != null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={loading}
          className="btn-ghost !px-2.5 !py-2 text-xs"
        >
          <Icon name="x" size={13} />
          All collections
        </button>
      )}
    </div>
  );
}

/**
 * A soft "reloading" veil for the content below the picker.
 *
 * Deliberately not a skeleton: the numbers on screen are still the previous
 * collection's real numbers, and replacing them with grey blocks makes a 300ms
 * refetch feel like a page rebuild. Dimming and desaturating instead says
 * "these are being replaced" while keeping the layout perfectly still, so
 * nothing jumps when the new data lands.
 */
export function Reloading({ active, children }) {
  return (
    <div className="relative">
      <div
        className={`transition-[opacity,filter] duration-300 ease-out ${
          active ? 'pointer-events-none select-none opacity-40 saturate-50' : 'opacity-100'
        }`}
        aria-busy={active || undefined}
      >
        {children}
      </div>
      {active && (
        <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
          <span className="flex items-center gap-2 rounded-full bg-card px-3.5 py-1.5 text-xs font-semibold text-ink shadow-card-lg ring-1 ring-line">
            <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            Loading that collection…
          </span>
        </div>
      )}
    </div>
  );
}
