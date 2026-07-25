import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import Pagination, { usePagination } from './Pagination.jsx';

const list = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe('usePagination', () => {
  it('slices the first page and reports from/to/total/pages', () => {
    const { result } = renderHook(() => usePagination(list(23), 10));
    expect(result.current.slice).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.current).toMatchObject({ page: 1, pages: 3, total: 23, from: 1, to: 10 });
  });

  it('slices a middle page and a short final page', () => {
    const { result } = renderHook(() => usePagination(list(23), 10));

    act(() => result.current.setPage(2));
    expect(result.current.slice).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.current.from).toBe(11);
    expect(result.current.to).toBe(20);

    act(() => result.current.setPage(3));
    expect(result.current.slice).toEqual([21, 22, 23]);
    expect(result.current.from).toBe(21);
    // `to` must not run past the end of the list.
    expect(result.current.to).toBe(23);
  });

  it('reports from = 0 and one page for an empty list', () => {
    const { result } = renderHook(() => usePagination([], 10));
    expect(result.current).toMatchObject({ total: 0, pages: 1, from: 0, to: 0 });
    expect(result.current.slice).toEqual([]);
  });

  it('treats null/undefined items as empty rather than throwing', () => {
    const { result } = renderHook(() => usePagination(undefined, 10));
    expect(result.current.total).toBe(0);
    expect(result.current.slice).toEqual([]);
  });

  it('clamps back to the last page when the list shrinks under the cursor', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 10), {
      initialProps: { items: list(23) },
    });

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    // A filter or a deletion drops the list to a single page.
    rerender({ items: list(8) });

    expect(result.current.page).toBe(1);
    expect(result.current.pages).toBe(1);
    // The key symptom this guards against: an empty table on a dead page.
    expect(result.current.slice).toEqual(list(8));
    expect(result.current.from).toBe(1);
    expect(result.current.to).toBe(8);
  });

  it('clamps to the new last page, not all the way to page 1', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 10), {
      initialProps: { items: list(50) },
    });

    act(() => result.current.setPage(5));
    rerender({ items: list(23) });

    expect(result.current.page).toBe(3);
    expect(result.current.slice).toEqual([21, 22, 23]);
  });

  it('clamping to an empty list lands on page 1 with an empty slice', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 10), {
      initialProps: { items: list(30) },
    });

    act(() => result.current.setPage(3));
    rerender({ items: [] });

    expect(result.current.page).toBe(1);
    expect(result.current.slice).toEqual([]);
    expect(result.current.from).toBe(0);
  });
});

describe('<Pagination />', () => {
  const setup = (props) => {
    const setPage = vi.fn();
    render(
      <Pagination
        page={1}
        pages={1}
        setPage={setPage}
        from={1}
        to={10}
        total={10}
        {...props}
      />
    );
    return { setPage };
  };

  const pageButtons = () =>
    screen.getAllByRole('button').filter((b) => /^Page \d+$/.test(b.getAttribute('aria-label')));

  it('renders nothing at all when there is nothing to show', () => {
    const { container } = render(
      <Pagination page={1} pages={1} setPage={() => {}} from={0} to={0} total={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the range summary with the supplied unit', () => {
    setup({ from: 11, to: 20, total: 23, page: 2, pages: 3, unit: 'trainers' });
    const summary = screen.getByText(/Showing/);
    expect(summary).toHaveTextContent('Showing 11–20 of 23 trainers');
  });

  it('hides the nav when there is only one page but still shows the count', () => {
    setup({ total: 6, from: 1, to: 6, pages: 1 });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
  });

  it('lists every page without ellipses when there are 7 or fewer', () => {
    setup({ page: 1, pages: 7, total: 70, to: 10 });
    expect(pageButtons().map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });

  it('renders a trailing ellipsis and at most 7 buttons near the start', () => {
    setup({ page: 2, pages: 20, total: 200, to: 20 });
    const labels = pageButtons().map((b) => b.textContent);
    expect(labels).toEqual(['1', '2', '3', '4', '5', '20']);
    expect(labels.length).toBeLessThanOrEqual(7);
    expect(screen.getAllByText('…')).toHaveLength(1);
  });

  it('renders ellipses on both sides in the middle of a long list', () => {
    setup({ page: 10, pages: 20, total: 200, to: 100 });
    const labels = pageButtons().map((b) => b.textContent);
    expect(labels).toEqual(['1', '9', '10', '11', '20']);
    expect(labels.length).toBeLessThanOrEqual(7);
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('renders a leading ellipsis near the end', () => {
    setup({ page: 19, pages: 20, total: 200, to: 190 });
    const labels = pageButtons().map((b) => b.textContent);
    expect(labels).toEqual(['1', '16', '17', '18', '19', '20']);
    expect(labels.length).toBeLessThanOrEqual(7);
    expect(screen.getAllByText('…')).toHaveLength(1);
  });

  it('marks the current page with aria-current', () => {
    setup({ page: 3, pages: 5, total: 50, from: 21, to: 30 });
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 2' })).not.toHaveAttribute('aria-current');
  });

  it('disables previous on the first page and next on the last', () => {
    const { unmount } = render(
      <Pagination page={1} pages={4} setPage={() => {}} from={1} to={10} total={40} />
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    unmount();

    render(<Pagination page={4} pages={4} setPage={() => {}} from={31} to={40} total={40} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('calls setPage with the neighbouring page for prev / next', async () => {
    const user = userEvent.setup();
    const { setPage } = setup({ page: 3, pages: 5, total: 50, from: 21, to: 30 });

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(setPage).toHaveBeenLastCalledWith(4);

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(setPage).toHaveBeenLastCalledWith(2);
  });

  it('calls setPage with the number that was clicked', async () => {
    const user = userEvent.setup();
    const { setPage } = setup({ page: 1, pages: 5, total: 50, to: 10 });

    await user.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(setPage).toHaveBeenCalledExactlyOnceWith(4);
  });
});
