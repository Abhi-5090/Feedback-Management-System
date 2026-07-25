/**
 * Spinner.
 *
 * Deliberately spins FASTER than the browser default (0.6s vs ~1s). A quicker
 * spinner makes the same wait feel shorter — perceived performance is a real
 * lever, and this one costs nothing.
 */
export default function Spinner({ label, className = '', size = 20 }) {
  return (
    <div className={`flex items-center gap-3 text-muted ${className}`} role="status">
      <span
        aria-hidden="true"
        className="inline-block shrink-0 animate-spin rounded-full border-2 border-line border-t-brand-600"
        style={{ width: size, height: size, animationDuration: '0.6s' }}
      />
      {label && <span className="text-sm">{label}</span>}
      <span className="sr-only">{label || 'Loading'}</span>
    </div>
  );
}

/**
 * Skeleton rows. Showing the SHAPE of what's coming beats a bare spinner: the
 * layout doesn't jump when data lands, and the wait reads as progress.
 */
export function SkeletonRows({ rows = 5, className = '' }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-9 w-9 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3" style={{ width: `${68 - i * 4}%` }} />
            <div className="skeleton h-2.5" style={{ width: `${44 - i * 3}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Card-shaped placeholder for KPI tiles and chart panels. */
export function SkeletonBlock({ className = '', height = 120 }) {
  return <div className={`skeleton ${className}`} style={{ height }} aria-hidden="true" />;
}
