import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatTile, { ratingTone, rateTone } from './StatTile.jsx';

/**
 * Semantic tone on a KPI tile.
 *
 * The tiles used to carry seven categorical accent colours — violet, sky,
 * amber, rose, teal — which is a chart legend, not a dashboard. Colour that
 * means nothing spends the reader's whole colour budget before any of it has
 * said anything, and the one tile that DOES need attention cannot stand out
 * because six others are already shouting.
 *
 * These assert the mapping, because the value of the feature is entirely in
 * the thresholds being right.
 */

describe('ratingTone', () => {
  it.each([
    [4.8, 'good'], [4.2, 'good'],
    [4.19, 'warn'], [3.5, 'warn'],
    [3.49, 'bad'], [1.0, 'bad'],
  ])('%s → %s', (value, expected) => {
    expect(ratingTone(value)).toBe(expected);
  });

  it('treats "no data" as neutral, never as bad', () => {
    /* A cohort that has not been rated is not a cohort rated zero. Showing it
       red would invent a judgement the data does not support. */
    expect(ratingTone(0)).toBe('neutral');
    expect(ratingTone(null)).toBe('neutral');
    expect(ratingTone(undefined)).toBe('neutral');
  });
});

describe('rateTone', () => {
  it.each([
    [100, 'good'], [75, 'good'],
    [74, 'warn'], [40, 'warn'],
    [39, 'bad'], [5, 'bad'],
  ])('%s%% → %s', (value, expected) => {
    expect(rateTone(value)).toBe(expected);
  });

  it('treats "nothing collected yet" as neutral', () => {
    expect(rateTone(0)).toBe('neutral');
    expect(rateTone(null)).toBe('neutral');
  });
});

describe('StatTile rendering', () => {
  it('renders its label and value', () => {
    render(<StatTile label="Response rate" value="82%" icon="activity" tone="good" />);
    expect(screen.getByText('Response rate')).toBeInTheDocument();
  });

  it('renders a non-numeric value verbatim rather than counting it up', () => {
    render(<StatTile label="Avg rating" value="—" icon="star" tone="neutral" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('still honours the categorical accent, for tiles paired with a chart series', () => {
    // Charts are categorical; a tile beside one has to agree with it.
    const { container } = render(<StatTile label="GenAI" value={12} icon="book" accent="sky" />);
    const rule = container.querySelector('span[aria-hidden="true"]');
    expect(rule).toHaveStyle({ backgroundColor: '#0ea5e9' });
  });

  it('a tone overrides the accent, so a value-driven colour always wins', () => {
    const { container } = render(<StatTile label="x" value={1} icon="star" accent="sky" tone="bad" />);
    const rule = container.querySelector('span[aria-hidden="true"]');
    expect(rule).toHaveStyle({ backgroundColor: '#f43f5e' });
  });
});
