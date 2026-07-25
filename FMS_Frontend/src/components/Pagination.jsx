import { useState, useMemo, useEffect } from 'react';
import Icon from './Icon.jsx';

/**
 * Client-side pagination.
 *
 * Client-side is the right call at this scale: a training org has tens or low
 * hundreds of trainers, the list already arrives in one request, and paging in
 * the browser keeps search/sort instant with no extra round trips. If a
 * customer ever reaches thousands of rows this should move server-side — the
 * hook boundary below is deliberately small so that swap stays cheap.
 */
export function usePagination(items, perPage, resetKey) {
  const [page, setPage] = useState(1);
  const total = items?.length || 0;
  const pages = Math.max(1, Math.ceil(total / perPage));

  // If the list shrinks (a filter, a deletion) the current page can fall off
  // the end — clamp back instead of showing an empty table.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  /* Jump back to page 1 whenever `resetKey` changes (a search query, say).
     Clamping alone isn't enough: searching from page 3 of a long list into a
     result set that still has 3+ pages would silently leave you on page 3 of
     the new results, which reads as "my search found nothing". Optional, so
     callers without a filter are unaffected. */
  useEffect(() => {
    if (resetKey !== undefined) setPage(1);
  }, [resetKey]);

  const slice = useMemo(
    () => (items || []).slice((page - 1) * perPage, page * perPage),
    [items, page, perPage]
  );

  return { page, setPage, pages, total, slice, from: total ? (page - 1) * perPage + 1 : 0, to: Math.min(page * perPage, total) };
}

/** Compact page list with ellipses — never renders more than ~7 buttons. */
function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, '…', pages];
  if (page >= pages - 3) return [1, '…', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, '…', page - 1, page, page + 1, '…', pages];
}

export default function Pagination({ page, pages, setPage, from, to, total, unit = 'items' }) {
  if (total === 0) return null;

  const Btn = ({ children, onClick, disabled, active, label }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`focus-ring grid h-8 min-w-8 place-items-center rounded-lg px-2 text-xs font-semibold transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none ${
        active
          ? 'bg-brand-600 text-white'
          : 'text-muted hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
      <p className="text-xs text-muted">
        Showing <span className="tnum font-semibold text-ink">{from}</span>–
        <span className="tnum font-semibold text-ink">{to}</span> of{' '}
        <span className="tnum font-semibold text-ink">{total}</span> {unit}
      </p>

      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <Btn onClick={() => setPage(page - 1)} disabled={page === 1} label="Previous page">
            <Icon name="chevronLeft" size={14} />
          </Btn>

          {pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-subtle">
                …
              </span>
            ) : (
              <Btn
                key={p}
                onClick={() => setPage(p)}
                active={p === page}
                label={`Page ${p}`}
              >
                {p}
              </Btn>
            )
          )}

          <Btn onClick={() => setPage(page + 1)} disabled={page === pages} label="Next page">
            <Icon name="chevronRight" size={14} />
          </Btn>
        </nav>
      )}
    </div>
  );
}
