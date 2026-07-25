import Card, { EmptyState } from './Card.jsx';
import StarRating from './StarRating.jsx';

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

export default function CommentsFeed({ comments, title = 'Recent feedback', hint }) {
  return (
    <Card
      title={title}
      icon="message"
      hint={
        hint ||
        'The latest anonymous comments, each with its overall rating. No student identity is attached — comments can never be traced back to a person.'
      }
      subtitle={comments?.length ? `${comments.length} most recent` : undefined}
    >
      {!comments?.length ? (
        <EmptyState
          title="No comments yet"
          hint="Student comments appear here as soon as feedback is submitted."
          icon="message"
        />
      ) : (
        <ul className="-mr-1 flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
          {comments.map((c) => (
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
    </Card>
  );
}
