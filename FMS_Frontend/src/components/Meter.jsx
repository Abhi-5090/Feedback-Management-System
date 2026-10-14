/**
 * A bar that fills by transform rather than width.
 *
 * `width` is a layout property: animating it runs layout, paint and composite
 * on every frame, on the main thread, for every bar on screen. `scaleX` is
 * composited alone, so a list of twenty cohorts animates as cheaply as one.
 *
 * `transform-origin: left` is what makes it read as filling rather than
 * growing out of its own centre, and the inner span undoes the horizontal
 * squash so rounded ends stay round instead of being flattened into ellipses.
 */
export default function Meter({ pct, className = '', trackClass = '', height = 'h-1.5', label }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div
      className={`${height} overflow-hidden rounded-full bg-surface-2 ${trackClass}`}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <div
        className={`h-full origin-left rounded-full transition-transform duration-[280ms] ease-out-expo ${className}`}
        style={{ transform: `scaleX(${value / 100})` }}
      />
    </div>
  );
}
