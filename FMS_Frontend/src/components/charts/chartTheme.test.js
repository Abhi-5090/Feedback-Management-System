import { describe, it, expect } from 'vitest';
import { fmtAvg, cursorStyle } from './chartTheme.js';

describe('fmtAvg', () => {
  it('formats a 0–5 average to exactly two decimals', () => {
    expect(fmtAvg(4)).toBe('4.00');
    expect(fmtAvg(4.2)).toBe('4.20');
    expect(fmtAvg(4.267)).toBe('4.27');
    expect(fmtAvg(0)).toBe('0.00');
  });

  it('accepts numeric strings from the API', () => {
    expect(fmtAvg('4.5')).toBe('4.50');
    expect(fmtAvg('0')).toBe('0.00');
  });

  it('renders an em dash for anything not finite', () => {
    // "no ratings yet" must show as — rather than NaN, which would leak
    // straight into the chart label.
    expect(fmtAvg(undefined)).toBe('—');
    expect(fmtAvg('n/a')).toBe('—');
    expect(fmtAvg(NaN)).toBe('—');
    expect(fmtAvg(Infinity)).toBe('—');
    expect(fmtAvg({})).toBe('—');
  });

  it('renders an em dash for every spelling of "empty"', () => {
    // +null, +'' and +false all coerce to 0, so a bare Number.isFinite check
    // rendered "no ratings yet" as 0.00 — visually identical to the worst
    // possible score. These must all be the em dash.
    expect(fmtAvg(null)).toBe('—');
    expect(fmtAvg('')).toBe('—');
    expect(fmtAvg(false)).toBe('—');
  });
});

describe('cursorStyle', () => {
  const theme = { markSoft: 'rgba(234,88,41,.10)', axis: '#6b7280' };

  it('fills the cursor for bar charts', () => {
    expect(cursorStyle(theme)).toEqual({ fill: theme.markSoft });
    expect(cursorStyle(theme, 'bar')).toEqual({ fill: theme.markSoft });
  });

  it('draws a dashed stroke for non-bar axes', () => {
    expect(cursorStyle(theme, 'line')).toEqual({
      stroke: theme.axis,
      strokeWidth: 1,
      strokeDasharray: '3 3',
    });
  });
});
