import { render, screen, within } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import RatingDistribution from './RatingDistribution.jsx';
import SessionRanking from './SessionRanking.jsx';
import CollectionHealth from './CollectionHealth.jsx';
import ParameterHeatmap from './ParameterHeatmap.jsx';

const dist = (over = {}) => ({
  total: 100,
  average: 4.3,
  stdDev: 0.92,
  promoters: 83, passives: 12, detractors: 5,
  promoterPct: 83, passivePct: 12, detractorPct: 5,
  buckets: [
    { stars: 1, count: 2, pct: 2 },
    { stars: 2, count: 3, pct: 3 },
    { stars: 3, count: 12, pct: 12 },
    { stars: 4, count: 30, pct: 30 },
    { stars: 5, count: 53, pct: 53 },
  ],
  ...over,
});

describe('RatingDistribution', () => {
  test('shows the mean and names what the spread means', () => {
    render(<RatingDistribution data={dist()} />);
    expect(screen.getByText('4.30')).toBeInTheDocument();
    expect(screen.getByText('Some variation')).toBeInTheDocument();
  });

  test('a unanimous cohort reads as agreement, a split one as division', () => {
    const { rerender } = render(<RatingDistribution data={dist({ stdDev: 0.2 })} />);
    expect(screen.getByText('Strong agreement')).toBeInTheDocument();
    rerender(<RatingDistribution data={dist({ stdDev: 1.4 })} />);
    expect(screen.getByText('Sharply divided')).toBeInTheDocument();
  });

  test('renders every bucket, 5 first', () => {
    render(<RatingDistribution data={dist()} />);
    /* Scoped to the histogram: the sentiment legend also prints "3★" as the
       label for Neutral, and an unscoped query conflates the two. */
    const hist = within(screen.getByTestId('histogram'));
    const labels = hist.getAllByText(/^[1-5]★$/).map((n) => n.textContent);
    expect(labels).toEqual(['5★', '4★', '3★', '2★', '1★']);
  });

  test('empty data does not crash or render NaN', () => {
    render(<RatingDistribution data={{ total: 0, buckets: [] }} />);
    expect(screen.getByText('No ratings yet.')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('SessionRanking', () => {
  const s = (id, name, avg, n) => ({ id, className: name, batchName: `${name} Cohort`, average: avg, responses: n, spread: 0.5 });

  test('says how many sessions were excluded for having too few responses', () => {
    render(
      <SessionRanking
        data={{ top: [s('a', 'Java', 4.7, 50)], bottom: [s('b', 'Coding', 3.3, 40)], ranked: 2, belowFloor: 4, minResponses: 10 }}
      />
    );
    expect(screen.getByText(/4 sessions not ranked/)).toBeInTheDocument();
    expect(screen.getByText(/fewer than 10/)).toBeInTheDocument();
  });

  test('when nothing clears the floor it says so rather than showing an empty table', () => {
    render(<SessionRanking data={{ top: [], bottom: [], ranked: 0, belowFloor: 3, minResponses: 10 }} />);
    expect(screen.getByText(/No session yet has the 10 responses/)).toBeInTheDocument();
  });
});

describe('CollectionHealth', () => {
  const b = (id, name, answered, expected) => ({
    id, name, yearGroup: '', status: 'closed', answered, expected,
    rate: Math.round((answered / expected) * 1000) / 10,
  });

  test('reports the overall share and lists cohorts given to it', () => {
    render(<CollectionHealth data={[b('1', 'IR Batch-3', 34, 180), b('2', 'C Batch-4', 120, 120)]} />);
    expect(screen.getByText(/154 of 300 students responded/)).toBeInTheDocument();
    expect(screen.getByText('IR Batch-3')).toBeInTheDocument();
  });

  test('caps the list and says what it is hiding', () => {
    const many = Array.from({ length: 12 }, (_, i) => b(String(i), `Batch ${i}`, i, 100));
    render(<CollectionHealth data={many} limit={8} />);
    expect(screen.getByText(/Showing the 8 lowest of 12 cohorts/)).toBeInTheDocument();
  });
});

describe('ParameterHeatmap', () => {
  test('renders a cell for every parameter of every subject', () => {
    const parameters = [{ id: 'p1', label: 'Pace' }, { id: 'p2', label: 'Clarity' }];
    render(
      <ParameterHeatmap
        data={{
          parameters,
          subjects: [
            { id: 'c1', name: 'Coding', ratings: 100, average: 3.79, cells: [{ average: 3.66, count: 50 }, { average: 3.9, count: 50 }] },
          ],
        }}
      />
    );
    expect(screen.getByText('Coding')).toBeInTheDocument();
    expect(screen.getByText('3.7')).toBeInTheDocument(); // 3.66 → one decimal in-cell
    expect(screen.getByText('3.79')).toBeInTheDocument(); // row average, two decimals
  });

  test('a missing cell renders a placeholder rather than an empty box', () => {
    render(
      <ParameterHeatmap
        data={{
          parameters: [{ id: 'p1', label: 'Pace' }],
          subjects: [{ id: 'c1', name: 'Python', ratings: 10, average: 4, cells: [null] }],
        }}
      />
    );
    expect(screen.getByText('·')).toBeInTheDocument();
  });
});
