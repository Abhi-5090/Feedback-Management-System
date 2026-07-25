import { useTheme } from '../../theme/ThemeContext.jsx';

/**
 * Chart colour tokens — Torii Minds palette.
 *
 * VALIDATED with the dataviz palette checker (scripts/validate_palette.js)
 * against the surface the charts actually sit on — the CARD, not the app
 * background — in both modes:
 *
 *   light  #ea5829 #0ea5e9 #10b981 #8b5cf6 #f59e0b  on #ffffff  → PASS*
 *   dark   #ea5829 #0284c7 #059669 #7c3aed #d97706  on #111726  → ALL PASS
 *
 * *Light carries a CONTRAST warning: sky/emerald/amber fall just under 3:1 on
 *  white. The skill treats that as an obligation, not a dismissal — relief is
 *  required, and it's already in place: every chart direct-labels its values
 *  and ships a Table view, so no value depends on discriminating those fills.
 *
 * Torii's light categorical values are kept EXACTLY as the website uses them —
 * that palette is the brand. Dark mode re-steps the same hues because Torii's
 * light values sit outside the dark lightness band (a dark theme has to be
 * selected, never an automatic flip).
 *
 * The categorical order is FIXED and never cycled. Dashboard charts here are
 * single-series, so each uses the brand vermilion alone and the panel title
 * names the series — no legend needed. Grid/axis/label text always wears ink
 * tokens, never the series colour.
 */
export function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  return {
    dark,
    // Single-series mark — Torii-gate vermilion in both themes (it clears
    // contrast and the lightness band on white AND on the dark navy card).
    mark: '#ea5829',
    markSoft: dark ? 'rgba(234,88,41,.18)' : 'rgba(234,88,41,.10)',
    line: '#ea5829',

    // Recessive chrome — visible enough to guide the eye, quiet enough to ignore
    grid: dark ? 'rgba(148,158,178,.16)' : 'rgba(107,114,128,.15)',
    axis: dark ? '#949eb2' : '#6b7280',
    ink: dark ? '#edf0f7' : '#111827',
    muted: dark ? '#949eb2' : '#6b7280',
    surface: dark ? '#111726' : '#ffffff',
    border: dark ? '#272f43' : '#e5e7eb',

    // Validated fixed-order categorical set for any multi-series use.
    categorical: dark
      ? ['#ea5829', '#0284c7', '#059669', '#7c3aed', '#d97706']
      : ['#ea5829', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b'],
  };
}

/**
 * Recharts cursor styling. The tooltip body itself is a real React component
 * (see ChartTooltip) so it inherits our type scale and theme tokens instead of
 * Recharts' inline defaults.
 */
export function cursorStyle(t, axis = 'bar') {
  return axis === 'bar'
    ? { fill: t.markSoft }
    : { stroke: t.axis, strokeWidth: 1, strokeDasharray: '3 3' };
}

/**
 * Format a 0–5 average consistently everywhere (2dp, no trailing jitter).
 *
 * The null/empty check is explicit and comes FIRST. `Number.isFinite(+v)` alone
 * is not enough: `+null`, `+''` and `+false` all coerce to 0, so "no ratings
 * yet" rendered as 0.00 — visually identical to the worst possible score — while
 * `undefined` correctly gave an em dash. Which one you got depended on how the
 * API happened to spell "empty".
 */
export const fmtAvg = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return '—';
  return Number.isFinite(+v) ? (+v).toFixed(2) : '—';
};
