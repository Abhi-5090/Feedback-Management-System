import Card from '../Card.jsx';

/**
 * Every subject against every parameter.
 *
 * A weakness is almost never uniform. It lives in one parameter of one
 * subject — pace in C Programming, doubt resolution in Python — and both
 * marginal views average it into invisibility: the per-subject chart says C is
 * 4.1, the per-parameter chart says pace is 4.0, and neither says that pace in
 * C is 3.2. Only the crossing does.
 *
 * Colour carries the value, so the grid is read by scanning for the dark cell
 * rather than by comparing numbers. The numbers stay anyway, because a colour
 * scale alone cannot be read precisely and some readers cannot read it at all.
 */
const cellTone = (v) => {
  if (v == null) return 'bg-surface-2 text-subtle';
  if (v >= 4.5) return 'bg-emerald-500/90 text-white';
  if (v >= 4.0) return 'bg-emerald-400/70 text-emerald-950 dark:text-emerald-50';
  if (v >= 3.5) return 'bg-amber-400/70 text-amber-950 dark:text-amber-50';
  if (v >= 3.0) return 'bg-orange-400/80 text-orange-950 dark:text-orange-50';
  return 'bg-rose-500/90 text-white';
};

export default function ParameterHeatmap({ data }) {
  if (!data?.subjects?.length) {
    return (
      <Card title="Where the weakness sits" icon="grid">
        <p className="p-5 text-sm text-muted">Not enough feedback to break down yet.</p>
      </Card>
    );
  }

  const { parameters, subjects } = data;

  return (
    <Card
      title="Where the weakness sits"
      icon="grid"
      subtitle="Each subject scored against each parameter — weakest subject first"
      hint="A low score in one parameter of one subject disappears from both the per-subject and per-parameter averages. This is the only view that shows it."
    >
      {/* Horizontal scroll rather than shrinking the cells: a heatmap whose
          cells are too small to carry a number is decoration. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                Subject
              </th>
              {parameters.map((p) => (
                <th
                  key={p.id}
                  className="px-1.5 py-3 text-center text-[10px] font-semibold leading-tight text-muted"
                  title={p.label}
                >
                  {/* Parameter names are long and the columns are narrow, so
                      they wrap to two lines rather than being truncated into
                      ambiguity ("Quality of…" / "Quality of…"). */}
                  <span className="mx-auto block max-w-[72px]">{p.label}</span>
                </th>
              ))}
              <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">
                Avg
              </th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.id} className="group">
                <td className="sticky left-0 z-10 max-w-[180px] truncate bg-card px-5 py-2 text-sm font-medium text-ink group-hover:bg-surface-2/60">
                  {s.name}
                  <span className="ml-2 tnum text-[11px] font-normal text-subtle">{s.ratings.toLocaleString()}</span>
                </td>
                {s.cells.map((c, i) => (
                  <td key={parameters[i].id} className="px-1 py-1">
                    <div
                      className={`grid h-9 place-items-center rounded-lg text-xs font-semibold tabular-nums transition-transform duration-150 ease-out-expo hover:scale-105 ${cellTone(c?.average)}`}
                      title={
                        c
                          ? `${s.name} · ${parameters[i].label}: ${c.average.toFixed(2)} from ${c.count} ratings`
                          : `${s.name} · ${parameters[i].label}: no ratings`
                      }
                    >
                      {c ? c.average.toFixed(1) : '·'}
                    </div>
                  </td>
                ))}
                <td className="tnum px-3 py-2 text-right text-sm font-bold text-ink">{s.average.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
