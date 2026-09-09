import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const commentsSpy = vi.fn();
vi.mock('../api/endpoints.js', () => ({
  AnalyticsAPI: { comments: (...a) => commentsSpy(...a) },
}));

import CommentsFeed from './CommentsFeed.jsx';

const mk = (i) => ({
  id: `c${i}`,
  comment: `Comment ${i}`,
  average: 4,
  className: i % 2 ? 'GenAI' : 'Coding',
  batchName: 'AI Ready 2028 · Batch-2',
  createdAt: new Date().toISOString(),
});
const page1 = Array.from({ length: 20 }, (_, i) => mk(i + 1));

describe('CommentsFeed', () => {
  beforeEach(() => {
    commentsSpy.mockReset();
    commentsSpy.mockResolvedValue({ comments: Array.from({ length: 20 }, (_, i) => mk(i + 21)), total: 132 });
  });

  it('shows 20 per page and states the real total', () => {
    render(<CommentsFeed comments={page1} total={132} />);
    // 20 rendered, not the whole 132 and not a fixed slice of 30.
    expect(screen.getAllByText(/^Comment \d+$/)).toHaveLength(20);
    expect(screen.getByText('1–20 of 132')).toBeInTheDocument();
  });

  it('does NOT fetch for page 1 — it is already in the props', () => {
    render(<CommentsFeed comments={page1} total={132} />);
    expect(commentsSpy).not.toHaveBeenCalled();
  });

  it('pages with numbered buttons, fetching only what it needs', async () => {
    const user = userEvent.setup();
    render(<CommentsFeed comments={page1} total={132} />);

    await user.click(screen.getByRole('button', { name: /page 2/i }));

    await waitFor(() => expect(commentsSpy).toHaveBeenCalledTimes(1));
    expect(commentsSpy.mock.calls[0][0]).toMatchObject({ page: 2, limit: 20 });
    expect(await screen.findByText('Comment 21')).toBeInTheDocument();
    expect(screen.getByText('21–40 of 132')).toBeInTheDocument();
  });

  it('filters by subject and always keeps the caller scope', async () => {
    const user = userEvent.setup();
    render(
      <CommentsFeed
        comments={page1}
        total={132}
        scope={{ batchId: 'b1', round: 2 }}
        filterOptions={{ classes: [{ id: 'c1', name: 'GenAI' }, { id: 'c2', name: 'Coding' }] }}
      />
    );

    await user.selectOptions(screen.getByLabelText(/Filter comments by class/i), 'c1');

    await waitFor(() => expect(commentsSpy).toHaveBeenCalled());
    /* The scope is non-negotiable: paging or filtering must never widen past
       the batch and round the page claims to be showing. */
    expect(commentsSpy.mock.calls.at(-1)[0]).toMatchObject({
      batchId: 'b1',
      round: 2,
      classId: 'c1',
      page: 1,
    });
  });

  it('puts the dropdowns in the card header, on the title row', () => {
    render(
      <CommentsFeed
        comments={page1}
        total={132}
        title="Comments across this batch"
        filterOptions={{
          batches: [{ id: 'b1', name: 'Batch A' }, { id: 'b2', name: 'Batch B' }],
          classes: [{ id: 'c1', name: 'GenAI' }, { id: 'c2', name: 'Coding' }],
        }}
      />
    );

    const heading = screen.getByRole('heading', { name: /Comments across this batch/i });
    const header = heading.closest('header');
    expect(header).toBeTruthy();

    /* Both selects must live in the SAME header element as the title, which is
       what puts them on its row and aligned right. A strip above the list —
       the previous layout — would place them outside it. */
    expect(header).toContainElement(screen.getByLabelText(/Filter comments by batch/i));
    expect(header).toContainElement(screen.getByLabelText(/Filter comments by class/i));

    // And the labelled "Narrow to" strip is gone entirely.
    expect(screen.queryByText(/narrow to/i)).not.toBeInTheDocument();
  });

  it('offers no dropdown when there is only one option to pick', () => {
    render(
      <CommentsFeed
        comments={page1}
        total={20}
        filterOptions={{ classes: [{ id: 'c1', name: 'GenAI' }] }}
      />
    );
    // A select with a single option implies something to switch to.
    expect(screen.queryByLabelText(/Filter comments by class/i)).not.toBeInTheDocument();
  });

  it('hides pagination when everything fits on one page', () => {
    render(<CommentsFeed comments={page1.slice(0, 5)} total={5} />);
    expect(screen.queryByRole('button', { name: /page 2/i })).not.toBeInTheDocument();
    expect(screen.getByText('all 5')).toBeInTheDocument();
  });

  it('resets to page 1 when the caller swaps the underlying set', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CommentsFeed comments={page1} total={132} scope={{ batchId: 'b1' }} />);
    await user.click(screen.getByRole('button', { name: /page 2/i }));
    await waitFor(() => expect(screen.getByText('21–40 of 132')).toBeInTheDocument());

    // Switching collection round changes the scope; page 4 of the old set must
    // not be requested for the new one.
    rerender(<CommentsFeed comments={page1} total={40} scope={{ batchId: 'b1', round: 3 }} />);
    await waitFor(() => expect(screen.getByText('1–20 of 40')).toBeInTheDocument());
  });
});
