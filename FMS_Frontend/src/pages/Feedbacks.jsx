import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AnalyticsAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { EmptyState } from '../components/Card.jsx';
import { SkeletonBlock } from '../components/Spinner.jsx';
import Icon, { StarIcon } from '../components/Icon.jsx';
import InfoTooltip from '../components/InfoTooltip.jsx';

/**
 * "Feedbacks" — the browse-by-class entry point, shared by admin and trainer.
 *
 * One page, one component: the API scopes the class list by role server-side
 * (admin sees every class, a trainer sees only their own), so there is no
 * role-branching UI to keep in sync and no way for the client to widen its own
 * scope by asking differently.
 *
 * Each card answers "how is this class doing?" at a glance — rating, responses,
 * and its strongest/weakest parameter — then hands off to the full drill-down.
 * Deliberately shallow: a card should be readable in about two seconds.
 */

/** Rating tone thresholds, matching the Torii feedback page. */
function tone(v) {
  if (!v) return { text: 'text-muted', bg: 'bg-surface-2', ring: 'ring-line' };
  if (v >= 4) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' };
  if (v >= 3) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/20' };
  return { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/20' };
}

function timeAgo(d) {
  if (!d) return null;
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

function ClassCard({ c, basePath, showTrainer }) {
  const t = tone(c.average);
  const pct = c.average ? (c.average / 5) * 100 : 0;
  const hasData = c.responses > 0;

  return (
    <article className="card lift group flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">{c.name}</h3>
          {showTrainer && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <Icon name="user" size={12} />
              <span className="truncate">{c.trainer || 'Unassigned'}</span>
            </p>
          )}
          {c.description && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{c.description}</p>
          )}
        </div>

        {/* Rating badge — the headline number for this class */}
        <div
          className={`shrink-0 rounded-2xl px-3 py-2 text-center ring-1 ring-inset ${t.bg} ${t.ring}`}
        >
          <p className={`tnum text-xl font-bold leading-none ${t.text}`}>
            {hasData ? c.average.toFixed(2) : '—'}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">of 5</p>
        </div>
      </div>

      {/* Rating bar — the same value as a length, which is easier to compare
          across cards than reading four separate numbers. */}
      <div className="px-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full origin-left rounded-full transition-transform duration-500 ease-out-expo"
            style={{
              transform: `scaleX(${pct / 100})`,
              width: '100%',
              backgroundColor: c.average >= 4 ? '#10b981' : c.average >= 3 ? '#f59e0b' : '#ea5829',
            }}
          />
        </div>
      </div>

      {/* Facts */}
      <div className="mt-4 grid grid-cols-3 gap-2 px-5">
        <Fact icon="inbox" label="Responses" value={c.responses} />
        <Fact icon="ticket" label="Batches" value={c.batches} />
        <Fact
          icon="unlock"
          label="Open now"
          value={c.openBatches}
          highlight={c.openBatches > 0}
        />
      </div>

      {/* Strongest / weakest — one genuine insight per card */}
      {hasData && c.strongest && (
        <div className="mt-4 space-y-1.5 px-5 text-xs">
          <p className="flex items-center gap-1.5 text-muted">
            <Icon name="trendUp" size={12} className="text-emerald-600 dark:text-emerald-400" />
            <span className="truncate">
              Best: <span className="font-medium text-ink">{c.strongest.label}</span>
            </span>
            <span className="tnum ml-auto font-semibold text-emerald-600 dark:text-emerald-400">
              {c.strongest.average.toFixed(1)}
            </span>
          </p>
          {c.weakest && (
            <p className="flex items-center gap-1.5 text-muted">
              <Icon name="alert" size={12} className="text-amber-600 dark:text-amber-400" />
              <span className="truncate">
                Needs work: <span className="font-medium text-ink">{c.weakest.label}</span>
              </span>
              <span className="tnum ml-auto font-semibold text-amber-600 dark:text-amber-400">
                {c.weakest.average.toFixed(1)}
              </span>
            </p>
          )}
        </div>
      )}

      {!hasData && (
        <p className="mt-4 flex items-center gap-1.5 px-5 text-xs text-muted">
          <Icon name="info" size={12} />
          No feedback submitted yet
        </p>
      )}

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
        <span className="text-[11px] text-subtle">
          {c.lastFeedbackAt ? `Last response ${timeAgo(c.lastFeedbackAt)}` : 'Awaiting responses'}
        </span>
        {/* The arrow nudges right on hover — a tiny directional cue that the
            action takes you somewhere, on an element you only hover briefly. */}
        <Link
          to={`${basePath}/class/${c.id}`}
          className="btn-primary !px-3.5 !py-1.5 text-xs"
          aria-label={`View feedback for ${c.name}`}
        >
          View feedback
          <Icon
            name="chevronRight"
            size={13}
            className="transition-transform duration-200 ease-out-expo group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </article>
  );
}

function Fact({ icon, label, value, highlight }) {
  return (
    <div className="rounded-xl bg-surface-2/60 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <Icon name={icon} size={11} />
        {label}
      </p>
      <p
        className={`tnum mt-0.5 text-base font-bold ${
          highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function Feedbacks() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const basePath = isAdmin ? '/admin' : '/trainer';

  const [classes, setClasses] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    (async () => {
      try {
        setClasses(await AnalyticsAPI.classes());
      } catch (e) {
        toast.error(e.message);
        setClasses([]);
      }
    })();
  }, [toast]);

  const shown = useMemo(() => {
    if (!classes) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? classes.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.trainer || '').toLowerCase().includes(needle)
        )
      : classes;

    const sorted = [...filtered];
    if (sort === 'rating') sorted.sort((a, b) => b.average - a.average);
    else if (sort === 'lowest') sorted.sort((a, b) => (a.average || 99) - (b.average || 99));
    else if (sort === 'responses') sorted.sort((a, b) => b.responses - a.responses);
    else sorted.sort((a, b) => new Date(b.lastFeedbackAt || 0) - new Date(a.lastFeedbackAt || 0));
    return sorted;
  }, [classes, q, sort]);

  const totals = useMemo(() => {
    if (!classes?.length) return null;
    const withData = classes.filter((c) => c.responses > 0);
    const responses = classes.reduce((n, c) => n + c.responses, 0);
    const avg = withData.length
      ? withData.reduce((n, c) => n + c.average, 0) / withData.length
      : 0;
    return { classes: classes.length, responses, avg, open: classes.reduce((n, c) => n + c.openBatches, 0) };
  }, [classes]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Feedback"
        title={isAdmin ? 'Class feedback' : 'My class feedback'}
        subtitle={
          isAdmin
            ? 'Every class with its rating so far. Open one to see each parameter, the trend and what students wrote.'
            : 'The classes assigned to you. Open one to see each parameter, the trend and what your students wrote.'
        }
      />

      {/* Summary strip */}
      {totals && (
        <div className="panel animate-fade-up divide-y divide-line sm:grid sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Summary label={isAdmin ? 'Classes' : 'My classes'} value={totals.classes} icon="book" />
          <Summary label="Responses" value={totals.responses} icon="inbox" />
          <Summary label="Open batches" value={totals.open} icon="unlock" />
          <Summary
            label="Average rating"
            value={totals.avg ? totals.avg.toFixed(2) : '—'}
            icon="star"
            suffix={totals.avg ? '/ 5' : ''}
          />
        </div>
      )}

      {/* Controls — a search box and a sort. Deliberately nothing more. */}
      {classes?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">
              <Icon name="search" size={15} />
            </span>
            <label htmlFor="fb-search" className="sr-only">
              Search classes
            </label>
            <input
              id="fb-search"
              className="input pl-10"
              placeholder={isAdmin ? 'Search class or trainer…' : 'Search your classes…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <label htmlFor="fb-sort" className="sr-only">
            Sort classes
          </label>
          <select
            id="fb-sort"
            className="input w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Most recent</option>
            <option value="rating">Highest rated</option>
            <option value="lowest">Lowest rated</option>
            <option value="responses">Most responses</option>
          </select>
          <span className="ml-auto text-xs text-muted">
            <span className="tnum font-semibold text-ink">{shown.length}</span>{' '}
            {shown.length === 1 ? 'class' : 'classes'}
          </span>
        </div>
      )}

      {/* Cards */}
      {!classes ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} height={280} className="rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={classes.length ? 'search' : 'book'}
            title={classes.length ? 'No classes match that search' : 'No classes yet'}
            hint={
              classes.length
                ? 'Try a different name, or clear the search.'
                : isAdmin
                  ? 'Create a class and assign it to a trainer, then unlock a batch to start collecting feedback.'
                  : 'No classes have been assigned to you yet. Your admin assigns classes to trainers.'
            }
            action={
              classes.length ? (
                <button className="btn-outline" onClick={() => setQ('')}>
                  Clear search
                </button>
              ) : isAdmin ? (
                <Link to="/admin/classes" className="btn-primary">
                  <Icon name="plus" size={15} /> Create a class
                </Link>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <ClassCard key={c.id} c={c} basePath={basePath} showTrainer={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, icon, suffix }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="tnum flex items-baseline gap-1 text-display-sm leading-none text-ink">
          {value}
          {suffix && <span className="text-xs font-medium text-subtle">{suffix}</span>}
        </p>
        <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </p>
      </div>
    </div>
  );
}
