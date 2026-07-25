import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AnalyticsAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Card, { EmptyState } from '../components/Card.jsx';
import { SkeletonRows } from '../components/Spinner.jsx';
import StarRating from '../components/StarRating.jsx';
import Icon from '../components/Icon.jsx';

/**
 * The comments behind a theme.
 *
 * Reached by clicking a batch under a theme in "What students keep mentioning".
 * Everything that got you here is carried in the URL (`?term=&batchId=`), so
 * the view is linkable and shareable — an admin can send "here are the 14
 * comments about pace in FSD-Aug" to a trainer as a URL rather than a
 * screenshot.
 *
 * The matched term is highlighted in every comment: the reason a comment is in
 * this list should never be something the reader has to hunt for.
 */

function highlight(text, term) {
  if (!term) return text;
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Same word-boundary + plural rule the API filtered on, so what's highlighted
  // is exactly what matched.
  const rx = new RegExp(`(\\b${safe}(?:s|es|'s)?\\b)`, 'ig');
  const parts = String(text || '').split(rx);
  return parts.map((p, i) =>
    rx.test(p) && i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded bg-brand-500/20 px-0.5 font-semibold text-ink"
      >
        {p}
      </mark>
    ) : (
      p
    )
  );
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

export default function Comments() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const term = params.get('term') || '';
  const batchId = params.get('batchId') || '';
  const classId = params.get('classId') || '';
  const base = user?.role === 'admin' ? '/admin' : '/trainer';

  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    (async () => {
      try {
        const d = await AnalyticsAPI.comments({
          ...(term ? { term } : {}),
          ...(batchId ? { batchId } : {}),
          ...(classId ? { classId } : {}),
        });
        if (alive) setData(d);
      } catch (e) {
        toast.error(e.message);
        if (alive) setData({ comments: [], total: 0 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [term, batchId, classId, toast]);

  const where = data?.context
    ? data.context.type === 'batch'
      ? `${data.context.name}${data.context.className ? ` · ${data.context.className}` : ''}`
      : data.context.name
    : null;

  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="focus-ring -ml-1 mb-1.5 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm text-muted transition-colors duration-150 hover:text-ink"
        >
          <Icon name="chevronLeft" size={14} />
          Back
        </button>
        <PageHeader
          eyebrow="Feedback"
          title={term ? `Comments mentioning “${term}”` : 'Comments'}
          subtitle={
            where
              ? `From ${where}. Only responses that mention this word are shown.`
              : 'Every comment matching this search.'
          }
        />
      </div>

      {/* The active filters, each removable — it must always be obvious why
          this list is shorter than the full feedback set. */}
      <div className="flex flex-wrap items-center gap-2">
        {term && (
          <span className="chip-brand">
            <Icon name="message" size={12} />
            {term}
          </span>
        )}
        {where && (
          <span className="chip-neutral">
            <Icon name={data.context.type === 'batch' ? 'ticket' : 'book'} size={12} />
            {where}
          </span>
        )}
        {data && (
          <span className="text-xs text-muted">
            <span className="tnum font-semibold text-ink">{data.total}</span>{' '}
            {data.total === 1 ? 'comment' : 'comments'}
          </span>
        )}
        <button
          className="btn-ghost ml-auto !px-3 !py-1.5 text-xs"
          onClick={() => navigate(`${base}/feedbacks`)}
        >
          All feedback
          <Icon name="chevronRight" size={12} />
        </button>
      </div>

      <Card title="Matching comments" icon="message" bodyClass="p-0">
        {!data ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : data.comments.length === 0 ? (
          <EmptyState
            icon="message"
            title="No comments match"
            hint={
              term
                ? `No responses here mention “${term}”. It may have been mentioned in a different batch.`
                : 'There are no comments for this selection yet.'
            }
            action={
              <button className="btn-outline" onClick={() => navigate(`${base}/feedbacks`)}>
                Browse all feedback
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-line/60">
            {data.comments.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <StarRating value={c.average} readOnly size={13} />
                    <span
                      className={`tnum text-xs font-bold ${
                        c.average >= 4
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : c.average >= 3
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {c.average.toFixed(2)}
                    </span>
                  </div>
                  <time
                    dateTime={c.createdAt}
                    title={new Date(c.createdAt).toLocaleString()}
                    className="shrink-0 text-[11px] text-subtle"
                  >
                    {timeAgo(c.createdAt)}
                  </time>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-ink">
                  {highlight(c.comment, term)}
                </p>

                <p className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="chip-neutral !py-0.5 text-[10px]">{c.className}</span>
                  <span className="chip-neutral !py-0.5 text-[10px]">{c.batchName}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted">
        <span className="mt-0.5 shrink-0">
          <Icon name="shield" size={13} />
        </span>
        These comments are anonymous. Nothing here identifies which student wrote them — only which
        cohort the response came from.
      </p>
    </div>
  );
}
