import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** A whole month as a half-open UTC range — the same arithmetic as the server. */
export function monthRange(year, monthIndex) {
  return {
    startsAt: new Date(Date.UTC(year, monthIndex, 1)),
    endsAt: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);
/* The stored end is EXCLUSIVE — a phase covering October ends at 1 Nov 00:00 —
   but "ends 1 November" reads as though November is included. Everything shown
   to a person is the last day the phase actually covers. */
const inclusiveEnd = (endsAt) => iso(new Date(new Date(endsAt).getTime() - 1));
const fromInclusive = (dateStr) => new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + 86400000);

/**
 * Pick a month, then adjust the dates if the collection ran over.
 *
 * WHY BOTH. "A phase is a calendar month" is how the institution thinks, and
 * the month grid is the fast path — one click fills everything in. But a month
 * is the wrong PRIMITIVE: in the September data each batch collected in a
 * single sitting while the whole exercise spanned 21 days, finishing on the
 * 30th with one day to spare. Start a week later and the tail lands in
 * November, and a month-shaped phase would split that exercise in two with
 * neither half being true.
 *
 * So the month fills the dates, and the dates are what is stored. The
 * adjustment is there for the month it is needed and invisible the rest of the
 * time.
 */
export default function MonthRangePicker({ value, onChange, disabled = false }) {
  const today = new Date();
  const [year, setYear] = useState(() =>
    value?.startsAt ? new Date(value.startsAt).getUTCFullYear() : today.getUTCFullYear()
  );
  const [custom, setCustom] = useState(false);

  const selected = useMemo(() => {
    if (!value?.startsAt) return null;
    const d = new Date(value.startsAt);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  }, [value]);

  /** True when the window is exactly one calendar month — the common case. */
  const isWholeMonth = useMemo(() => {
    if (!value?.startsAt || !value?.endsAt) return false;
    const a = new Date(value.startsAt);
    const b = new Date(value.endsAt);
    const whole = monthRange(a.getUTCFullYear(), a.getUTCMonth());
    return +a === +whole.startsAt && +b === +whole.endsAt;
  }, [value]);

  const pickMonth = (m) => {
    if (disabled) return;
    const r = monthRange(year, m);
    onChange({ startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() });
    setCustom(false);
  };

  const setBoundary = (which, dateStr) => {
    if (!dateStr) return;
    const next = { ...value };
    if (which === 'start') next.startsAt = new Date(`${dateStr}T00:00:00.000Z`).toISOString();
    else next.endsAt = fromInclusive(dateStr).toISOString();
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30"
            onClick={() => setYear((y) => y - 1)}
            disabled={disabled}
            aria-label="Previous year"
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <span className="tnum min-w-[3.5rem] text-center text-sm font-bold text-ink">{year}</span>
          <button
            type="button"
            className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30"
            onClick={() => setYear((y) => y + 1)}
            disabled={disabled}
            aria-label="Next year"
          >
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
        {value?.startsAt && (
          <p className="text-xs text-muted">
            {isWholeMonth ? 'Whole month' : 'Custom dates'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Choose a month">
        {MONTHS.map((label, m) => {
          const on = selected && selected.y === year && selected.m === m;
          const isThisMonth = year === today.getUTCFullYear() && m === today.getUTCMonth();
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => pickMonth(m)}
              aria-pressed={Boolean(on)}
              className={`focus-ring rounded-xl px-2 py-2.5 text-sm font-semibold transition-colors duration-150 ease-out disabled:opacity-40 ${
                on
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-2 text-ink hover:bg-brand-500/10 hover:text-brand-600'
              }`}
            >
              {label}
              {/* The current month, so "which one is now?" needs no arithmetic. */}
              {isThisMonth && !on && (
                <span className="mx-auto mt-1 block h-1 w-1 rounded-full bg-brand-500" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {value?.startsAt && (
        <div className="rounded-xl border border-line bg-surface-2/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink">
                {iso(value.startsAt)} → {inclusiveEnd(value.endsAt)}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                {isWholeMonth
                  ? `All of ${FULL[new Date(value.startsAt).getUTCMonth()]}. If collection runs past the month end, extend it.`
                  : 'Adjusted — these exact dates are what the phase covers.'}
              </p>
            </div>
            {!disabled && (
              <button
                type="button"
                className="btn-ghost shrink-0 !px-2.5 !py-1 text-xs"
                onClick={() => setCustom((c) => !c)}
              >
                {custom ? 'Done' : 'Adjust'}
              </button>
            )}
          </div>

          {custom && !disabled && (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                  First day
                </span>
                <input
                  type="date"
                  className="input !py-1.5 text-xs"
                  value={iso(value.startsAt)}
                  onChange={(e) => setBoundary('start', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Last day
                </span>
                <input
                  type="date"
                  className="input !py-1.5 text-xs"
                  value={inclusiveEnd(value.endsAt)}
                  onChange={(e) => setBoundary('end', e.target.value)}
                />
                <span className="mt-1 block text-[10px] text-subtle">Inclusive — the phase covers this day.</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
