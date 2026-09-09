import { useEffect, useState } from 'react';
import Card, { EmptyState } from './Card.jsx';
import StarRating from './StarRating.jsx';
import Icon from './Icon.jsx';
import Spinner from './Spinner.jsx';

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
 * The comment feed, paginated.
 *
 * It used to render whatever fixed slice the server sent — 25 on a dashboard,
 * 30 on a batch — with a subtitle reading "30 most recent" and no way to reach
 * the rest. A cohort of 66 therefore appeared to have commented 30 times. Now
 * the count states the whole truth ("50 of 66") and `loadPage` fetches the
 * remainder on demand.
 *
 * `loadPage(page)` is optional: a caller that has everything already can leave
 * it out and the control simply does not appear.
 */
export default function CommentsFeed({
  comments,
  total,
  pageSize = 50,
  loadPage,
  title = 'Recent feedback',
  hint,
  loading = false,
}) {
  const [extra, setExtra] = useState([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  /* Reset when the parent swaps the underlying set — changing the collection
     round, or a filter. Without this, pages fetched for the previous scope
     would stay appended below the new first page. */
  useEffect(() => {
    setExtra([]);
    setPage(1);
    setFailed(null);
  }, [comments]);

  const shown = [...(comments || []), ...extra];
  const knownTotal = typeof total === 'number' ? total : shown.length;
  const hasMore = Boolean(loadPage) && shown.length < knownTotal;

  const more = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const next = page + 1;
      const rows = await loadPage(next);
      setExtra((prev) => [...prev, ...rows]);
      setPage(next);
    } catch (err) {
      setFailed(err.message || 'Could not load more comments');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={title}
      icon="message"
      hint={
        hint ||
        'Anonymous comments, each with its overall rating. No student identity is attached — comments can never be traced back to a person.'
      }
      subtitle={
        shown.length
          ? knownTotal > shown.length
            ? `showing ${shown.length} of ${knownTotal}`
            : `all ${knownTotal}`
          : undefined
      }
    >
      {loading ? (
        <div className="grid place-items-center py-10">
          <Spinner label="Loading comments…" />
        </div>
      ) : !shown.length ? (
        <EmptyState
          title="No comments yet"
          hint="Student comments appear here as soon as feedback is submitted."
          icon="message"
        />
      ) : (
        <ul className="-mr-1 flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
          {shown.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-line bg-surface-2/30 p-3 transition-colors duration-150 hover:border-line hover:bg-surface-2/60"
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

      {/* Reaching the rest. Only rendered when there IS more and the caller
          supplied a way to fetch it, so a fully-loaded feed shows nothing. */}
      {hasMore && (
        <div className="mt-3 flex flex-col items-center gap-2 border-t border-line pt-3">
          {failed && (
            <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
              <Icon name="alert" size={12} />
              {failed}
            </p>
          )}
          <button
            type="button"
            onClick={more}
            disabled={busy}
            className="btn-outline w-full sm:w-auto"
          >
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Loading…
              </>
            ) : (
              <>
                <Icon name="chevronDown" size={14} />
                Load {Math.min(pageSize, knownTotal - shown.length)} more
              </>
            )}
          </button>
          <p className="tnum text-[11px] text-subtle">
            {shown.length} of {knownTotal} comments
          </p>
        </div>
      )}
    </Card>
  );
}
