import { useState, useId } from 'react';

/**
 * Wraps a chart with a Chart / Table toggle.
 *
 * Every chart must have a table view: colour and position encode the data
 * visually, but a screen-reader user, a colourblind reader comparing two close
 * hues, and anyone who just wants the exact number all need the values
 * themselves. The chart is hidden from assistive tech (the table is the
 * accessible representation) rather than being read out as meaningless nodes.
 */
export default function ChartFrame({ columns, rows, children, caption }) {
  const [view, setView] = useState('chart');
  const id = useId();
  const hasData = Array.isArray(rows) && rows.length > 0;

  return (
    <div>
      {hasData && (
        <div className="mb-3 flex justify-end">
          <div
            role="tablist"
            aria-label="Chart display mode"
            className="inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-inset ring-line"
          >
            {['chart', 'table'].map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                aria-controls={`${id}-${v}`}
                onClick={() => setView(v)}
                className={`focus-ring rounded-[6px] px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors duration-150 ${
                  view === v ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'chart' ? (
        <div id={`${id}-chart`} aria-hidden={hasData ? 'true' : undefined}>
          {children}
        </div>
      ) : (
        <div id={`${id}-table`} className="max-h-[280px] overflow-auto rounded-xl ring-1 ring-inset ring-line">
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted ${
                      c.numeric ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line/60">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-ink ${c.numeric ? 'tnum text-right' : 'text-left'}`}
                    >
                      {r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
