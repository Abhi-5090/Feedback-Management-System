import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnalyticsAPI } from '../api/endpoints.js';
import Card, { EmptyState } from './Card.jsx';
import StarRating from './StarRating.jsx';
import Pagination from './Pagination.jsx';
import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';

const PER_PAGE = 20;

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

/** Tint the rating chip by sentiment — but always with the number beside it. */
function ratingTone(avg) {
  if (avg >= 4) return 'text-emerald-600 dark:text-emerald-400';
  if (avg >= 3) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

/**
 * The comment feed: paged, filterable, and tall enough to read.
 *
 * Three things it fixes, all of which made a large body of feedback unusable:
 *
 *   - It used to render a fixed slice the server happened to send (25 on a
 *     dashboard, 30 on a batch) labelled "N most recent", so 132 comments
 *     looked like 30 and the rest were reachable from nowhere. It now pages
 *     through all of them, 20 at a time, with numbered pages.
 *
 *   - A batch running two subjects interleaved their comments, so "the pace was
 *     too fast" sat next to another subject's remark about pace with no way to
 *     tell them apart at a glance. Batch and class dropdowns narrow the feed to
 *     one thing at a time.
 *
 *   - The panel was short enough to show two comments, which turns reading
 *     feedback into scrolling a window. It now holds six or seven before it
 *     scrolls.
 *
 * Fetching lives here rather than in each of the four callers: paging plus two
 * filters is enough state that duplicating it four ways would guarantee they
 * drifted. A caller supplies its SCOPE (the filters that always apply) and the
 * first page it already received.
 */
export default function CommentsFeed({
  comments,
  total,
  scope = {},
  filterOptions,
  title = 'Recent feedback',
  hint,
  loading = false,
}) {
  const [page, setPage] = useState(1);
  const [batchId, setBatchId] = useState('');
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState(null); // null = use the page-1 prop
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  /* The scope is an object literal at most call sites, so a new identity every
     render. Serialising it gives a stable dependency — depending on the object
     itself would refetch forever. */
  const scopeKey = JSON.stringify(scope);

  /* A scope change (switching collection round, opening another batch) resets
     the view. Without this, page 4 of the previous batch would be requested
     for the new one and come back empty. */
  useEffect(() => {
    setPage(1);
    setBatchId('');
    setClassId('');
    setRows(null);
    setCount(null);
    setFailed(null);
  }, [scopeKey, comments]);

  const filtersActive = Boolean(batchId || classId);
  const needsFetch = page > 1 || filtersActive;

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const res = await AnalyticsAPI.comments({
        ...JSON.parse(scopeKey),
        ...(batchId ? { batchId } : {}),
        ...(classId ? { classId } : {}),
        page,
        limit: PER_PAGE,
      });
      setRows(res.comments);
      setCount(res.total);
    } catch (err) {
      setFailed(err.message || 'Could not load comments');
    } finally {
      setBusy(false);
    }
  }, [scopeKey, batchId, classId, page]);

  useEffect(() => {
    if (!needsFetch) {
      setRows(null);
      setCount(null);
      return;
    }
    load();
  }, [needsFetch, load]);

  /* Page 1 unfiltered is already in the props — no request needed for the
     view everyone lands on. */
  const shown = needsFetch ? rows || [] : (comments || []).slice(0, PER_PAGE);
  const knownTotal = needsFetch
    ? (count ?? 0)
    : typeof total === 'number'
      ? total
      : (comments || []).length;
  const pages = Math.max(1, Math.ceil(knownTotal / PER_PAGE));
  const from = knownTotal === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, knownTotal);

  const hasFilters =
    (filterOptions?.batches?.length || 0) > 1 || (filterOptions?.classes?.length || 0) > 1;

  const subtitle = useMemo(() => {
    if (!knownTotal) return undefined;
    if (pages > 1) return `${from}–${to} of ${knownTotal}`;
    return `all ${knownTotal}`;
  }, [from, to, knownTotal, pages]);

  const busyOrLoading = busy || loading;

  return (
    <Card title={title} icon="message" subtitle={subtitle} hint={hint || undefined}>
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      {hasFilters && (
        <div className="mb-3 flex flex-wrap items-end gap-2 border-b border-line pb-3">
          <span className="flex items-center gap-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <Icon name="filter" size={12} />
            Narrow to
            <InfoTooltip text="A batch running several subjects interleaves their comments. Pick one to read that subject's feedback on its own." />
          </span>

          {(filterOptions?.batches?.length || 0) > 1 && (
            <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
              <label htmlFor="cf-batch" className="sr-only">
                Filter comments by batch
              </label>
              <select
                id="cf-batch"
                className="input !h-9 !py-1.5 text-xs sm:w-auto"
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All batches</option>
                {filterOptions.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(filterOptions?.classes?.length || 0) > 1 && (
            <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
              <label htmlFor="cf-class" className="sr-only">
                Filter comments by class
              </label>
              <select
                id="cf-class"
                className="input !h-9 !py-1.5 text-xs sm:w-auto"
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All subjects</option>
                {filterOptions.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {filtersActive && (
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1.5 text-xs"
              onClick={() => {
                setBatchId('');
                setClassId('');
                setPage(1);
              }}
            >
              <Icon name="x" size={12} />
              Clear
            </button>
          )}
        </div>
      )}

      {failed && (
        <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400">
          <Icon name="alert" size={12} />
          {failed}
        </p>
      )}

      {/* ── The list ────────────────────────────────────────────────────────
          Tall enough for six or seven comments before it scrolls. Uncapped on
          a phone, where a fixed-height scroller nested in a scrolling page is
          worse than simply letting the page grow. */}
      {busyOrLoading && !shown.length ? (
        <div className="grid place-items-center py-14">
          <span className="flex items-center gap-2 text-sm text-muted">
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            Loading comments…
          </span>
        </div>
      ) : !shown.length ? (
        <EmptyState
          title={filtersActive ? 'No comments match that filter' : 'No comments yet'}
          hint={
            filtersActive
              ? 'Try clearing the batch or subject.'
              : 'Student comments appear here as soon as feedback is submitted.'
          }
          icon="message"
        />
      ) : (
        <ul
          className={`space-y-2 sm:max-h-[42rem] sm:overflow-y-auto sm:pr-1 ${
            busyOrLoading ? 'pointer-events-none opacity-50 transition-opacity duration-200' : ''
          }`}
        >
          {shown.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-line bg-surface-2/30 p-3 transition-colors duration-150 hover:bg-surface-2/60"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <StarRating value={c.average} readOnly size={13} />
                  <span className={`tnum text-xs font-bold ${ratingTone(c.average)}`}>
                    {c.average.toFixed(2)}
                  </span>
                </div>
                <time
                  dateTime={c.createdAt}
                  className="shrink-0 text-[11px] text-subtle"
                  title={new Date(c.createdAt).toLocaleString()}
                >
                  {timeAgo(c.createdAt)}
                </time>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-ink">{c.comment}</p>

              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                <span className="chip-neutral !py-0.5">{c.className}</span>
                <span className="chip-neutral !py-0.5">{c.batchName}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* ── Numbered pages ─────────────────────────────────────────────── */}
      {pages > 1 && (
        <div className="mt-3 border-t border-line pt-3">
          <Pagination
            page={page}
            pages={pages}
            setPage={setPage}
            from={from}
            to={to}
            total={knownTotal}
            unit="comments"
          />
        </div>
      )}
    </Card>
  );
}
