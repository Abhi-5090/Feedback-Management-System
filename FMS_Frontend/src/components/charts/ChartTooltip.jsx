/**
 * Shared Recharts tooltip body.
 *
 * A real component rather than Recharts' inline `contentStyle` so it inherits
 * the app's type scale, radii, shadow and theme tokens — a tooltip that looks
 * like it belongs to a different product is a small but constant tell.
 *
 * Values wear ink tokens; the series colour appears only as a small swatch
 * beside them. Text must never be painted in the series colour — on a light
 * mark that fails contrast, and it couples legibility to encoding.
 */
export default function ChartTooltip({ active, payload, label, rows }) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload ?? {};
  const lines = typeof rows === 'function' ? rows(point) : null;

  return (
    <div className="rounded-xl border border-line bg-card/95 px-3 py-2 shadow-pop backdrop-blur">
      {label != null && (
        <p className="mb-1.5 text-xs font-semibold leading-none text-ink">{label}</p>
      )}
      <ul className="space-y-1">
        {(lines || payload.map((p) => ({ label: p.name, value: p.value, color: p.color }))).map(
          (row, i) => (
            <li key={i} className="flex items-center gap-2 text-xs leading-none">
              {row.color && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: row.color }}
                />
              )}
              <span className="text-muted">{row.label}</span>
              <span className="tnum ml-auto font-semibold text-ink">{row.value}</span>
            </li>
          )
        )}
      </ul>
    </div>
  );
}
