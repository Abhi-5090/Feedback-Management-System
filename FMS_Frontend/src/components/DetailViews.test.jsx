import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClassFeedbackView from './ClassFeedbackView.jsx';
import BatchFeedbackView from './BatchFeedbackView.jsx';
import { ToastProvider } from './Toast.jsx';

/**
 * These two views must MOUNT.
 *
 * That sounds trivial and is the exact bug this file exists for: a refactor
 * added `useLocation()` to BatchFeedbackView without adding it to the import
 * list. A bare identifier looks like a global to the bundler, so `vite build`
 * succeeded and the failure only appeared in the browser — every "View
 * feedback" link opened a blank page.
 *
 * A render test catches that class of mistake, which no amount of type-free
 * bundling will. Rendering is also enough to catch a missing provider, a bad
 * hook order, or a destructure of an undefined prop.
 *
 * Recharts measures its container, which jsdom reports as 0×0 and then warns
 * about; the charts are not what is under test here.
 */
vi.mock('./charts/ParamBarChart.jsx', () => ({ default: () => <div data-testid="param-chart" /> }));
vi.mock('./charts/TrendLineChart.jsx', () => ({ default: () => <div data-testid="trend-chart" /> }));
vi.mock('./charts/VolumeBarChart.jsx', () => ({ default: () => <div data-testid="volume-chart" /> }));

const paramRow = (label, average) => ({
  parameterId: label,
  label,
  order: 0,
  average,
  responses: 4,
});

const classPayload = {
  class: { id: 'c1', name: 'GenAI', description: '', defaultTrainer: null },
  teams: [],
  feedbackCount: 12,
  overallAverage: 4.25,
  perParameter: [paramRow('Content clarity', 4.5)],
  trend: [],
  comments: [],
  breakdown: {
    consolidated: { yearGroupCount: 2, batchCount: 3, responses: 12, expected: 100, submitted: 12 },
    yearGroups: [
      {
        yearGroup: 'Third Year',
        batchCount: 2,
        openBatches: 0,
        responses: 8,
        average: 3.66,
        expected: 60,
        submitted: 8,
        responseRate: 13.3,
        lastFeedbackAt: null,
        perParameter: [paramRow('Content clarity', 3.6)],
        batches: [
          {
            id: 'b1',
            name: 'AI Ready 2028 · Batch-1',
            dept: 'CSE',
            status: 'locked',
            round: 1,
            expectedCount: 30,
            submittedCount: 8,
            responseRate: 26.7,
            responses: 8,
            average: 3.66,
            lastFeedbackAt: null,
            perParameter: [],
            mainTrainerNames: ['Bhargava R'],
            supportTrainerNames: ['Jayanth M'],
          },
        ],
      },
      {
        yearGroup: 'Final Year',
        batchCount: 1,
        openBatches: 0,
        responses: 4,
        average: 4.57,
        expected: 40,
        submitted: 4,
        responseRate: 10,
        lastFeedbackAt: null,
        perParameter: [paramRow('Content clarity', 4.9)],
        batches: [],
      },
    ],
  },
};

const batchPayload = {
  batch: {
    id: 'b1',
    name: 'AI Ready 2027 · Batch-1',
    yearGroup: 'Final Year',
    dept: '',
    round: 1,
    classes: [
      {
        id: 'c1',
        name: 'GenAI',
        mainTrainers: [{ id: 't1', name: 'Bhargava R' }],
        supportTrainers: [],
        mainTrainerNames: ['Bhargava R'],
        supportTrainerNames: [],
        mainTrainerIds: ['t1'],
        supportTrainerIds: [],
      },
    ],
    classCount: 1,
    submittedCount: 12,
    expectedCount: 139,
    status: 'locked',
  },
  classesBreakdown: [
    {
      id: 'c1',
      name: 'GenAI',
      mainTrainerNames: ['Bhargava R'],
      supportTrainerNames: [],
      mainTrainers: [],
      supportTrainers: [],
      mainTrainerIds: [],
      supportTrainerIds: [],
      feedbackCount: 12,
      overallAverage: 4.25,
      perParameter: [paramRow('Content clarity', 4.5)],
    },
  ],
  feedbackCount: 12,
  overallAverage: 4.25,
  perParameter: [paramRow('Content clarity', 4.5)],
  trend: [],
  comments: [],
};

const mount = (ui) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

describe('ClassFeedbackView', () => {
  it('renders the subject, the consolidated figures and the year-group divisions', async () => {
    mount(
      <ClassFeedbackView
        fetcher={() => Promise.resolve(classPayload)}
        exportPath="/export/class/c1"
        exportName="class_feedback"
        backTo="/admin/feedbacks"
        basePath="/admin"
        reloadKey="c1"
      />
    );

    expect(await screen.findByText('GenAI')).toBeInTheDocument();
    // Consolidated headline.
    expect(await screen.findByText('4.25')).toBeInTheDocument();
    // Both divisions are offered as tabs.
    expect(await screen.findByRole('tab', { name: /All years/i })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /Third Year/i })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /Final Year/i })).toBeInTheDocument();
  });

  it('shows the batch name, not the subject name, in the breakdown', async () => {
    mount(
      <ClassFeedbackView
        fetcher={() => Promise.resolve(classPayload)}
        exportPath="/export/class/c1"
        exportName="class_feedback"
        backTo="/admin/feedbacks"
        basePath="/admin"
        reloadKey="c1"
      />
    );
    // A shapeEntry spread once clobbered `name` with the class's, rendering
    // every batch row as the subject or as an em dash.
    expect(await screen.findByRole('link', { name: /AI Ready 2028 · Batch-1/ })).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering nothing', async () => {
    mount(
      <ClassFeedbackView
        fetcher={() => Promise.reject(new Error('scope denied'))}
        exportPath="/export/class/c1"
        exportName="class_feedback"
        backTo="/admin/feedbacks"
        basePath="/admin"
        reloadKey="c1"
      />
    );
    expect(await screen.findByText(/Couldn’t load this class/i)).toBeInTheDocument();
    /* The message appears twice on purpose — once in the empty state and once
       in a toast — so this asserts "at least one", not "exactly one".
       findByText throws on multiple matches. */
    expect(await screen.findAllByText(/scope denied/i)).not.toHaveLength(0);
  });
});

describe('BatchFeedbackView', () => {
  it('mounts and renders the batch', async () => {
    // The regression: this threw "useLocation is not defined" and produced a
    // blank page, while the production build reported success.
    mount(
      <BatchFeedbackView
        fetcher={() => Promise.resolve(batchPayload)}
        exportPath="/export/batch/b1"
        exportName="batch_feedback"
        backTo="/admin/batches"
        basePath="/admin"
        reloadKey="b1"
      />
    );
    expect(await screen.findByText('AI Ready 2027 · Batch-1')).toBeInTheDocument();
  });

  it('names the mentors on each class of the batch', async () => {
    mount(
      <BatchFeedbackView
        fetcher={() => Promise.resolve(batchPayload)}
        exportPath="/export/batch/b1"
        exportName="batch_feedback"
        backTo="/admin/batches"
        basePath="/admin"
        reloadKey="b1"
      />
    );
    expect(await screen.findAllByText(/Bhargava R/)).not.toHaveLength(0);
  });

  it('surfaces a load failure instead of rendering nothing', async () => {
    mount(
      <BatchFeedbackView
        fetcher={() => Promise.reject(new Error('no access to this batch'))}
        exportPath="/export/batch/b1"
        exportName="batch_feedback"
        backTo="/admin/batches"
        basePath="/admin"
        reloadKey="b1"
      />
    );
    // Shown in the empty state AND raised as a toast, hence findAllByText.
    expect(await screen.findAllByText(/no access to this batch/i)).not.toHaveLength(0);
  });
});
