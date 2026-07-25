import { useMemo } from 'react';
import InfoTooltip from './InfoTooltip.jsx';

/**
 * Admin filter bar (trainer / class / batch) that drives EVERY widget on the
 * dashboard. Selections cascade: choosing a trainer narrows classes; choosing a
 * class narrows batches.
 *
 * Per the dataviz interaction spec, filters live in ONE row above the charts —
 * not scattered per panel — so it's unambiguous that they scope the whole view.
 * The active count is surfaced explicitly: a filtered dashboard that looks
 * identical to an unfiltered one is how people misread numbers.
 */
export default function FilterBar({ trainers = [], classes = [], batches = [], value, onChange, right }) {
  const filteredClasses = useMemo(
    () =>
      value.trainer
        ? classes.filter((c) => String(c.trainer?._id || c.trainer) === value.trainer)
        : classes,
    [classes, value.trainer]
  );
  const filteredBatches = useMemo(
    () => (value.class ? batches.filter((b) => String(b.class?._id || b.class) === value.class) : batches),
    [batches, value.class]
  );

  const set = (patch) => onChange({ ...value, ...patch });
  const activeCount = [value.trainer, value.class, value.batch].filter(Boolean).length;

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5 pb-2.5 text-sm font-semibold text-ink">
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path
              d="M2 3.5h11L9 8v4.5L6 11V8L2 3.5z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="tnum grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
          <InfoTooltip text="These filters scope every KPI, chart, comment and export on this page. Leave them blank to see the whole system." />
        </div>

        <Field label="Trainer" id="f-trainer">
          <select
            id="f-trainer"
            className="input"
            value={value.trainer}
            onChange={(e) => set({ trainer: e.target.value, class: '', batch: '' })}
          >
            <option value="">All trainers</option>
            {trainers.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Class" id="f-class">
          <select
            id="f-class"
            className="input"
            value={value.class}
            onChange={(e) => set({ class: e.target.value, batch: '' })}
          >
            <option value="">All classes</option>
            {filteredClasses.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Batch" id="f-batch">
          <select
            id="f-batch"
            className="input"
            value={value.batch}
            onChange={(e) => set({ batch: e.target.value })}
          >
            <option value="">All batches</option>
            {filteredBatches.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>

        {activeCount > 0 && (
          <button
            type="button"
            className="btn-ghost !px-3 !py-2 text-xs"
            onClick={() => onChange({ trainer: '', class: '', batch: '' })}
          >
            Clear all
          </button>
        )}

        {right && <div className="ml-auto pb-0.5">{right}</div>}
      </div>
    </div>
  );
}

function Field({ label, id, children }) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
