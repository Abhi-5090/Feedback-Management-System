import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useToast } from './Toast.jsx';
import Card, { EmptyState } from './Card.jsx';
import StatTile from './StatTile.jsx';
import { SkeletonBlock } from './Spinner.jsx';
import ExportButtons from './ExportButtons.jsx';
import CommentsFeed from './CommentsFeed.jsx';
import ParamBarChart from './charts/ParamBarChart.jsx';
import TrendLineChart from './charts/TrendLineChart.jsx';
import Icon from './Icon.jsx';
import { MentorRosterBadges } from './MentorRosterPicker.jsx';

const BackLink = ({ onClick }) => (
  <button
    type="button"
    className="focus-ring -ml-1 mb-1.5 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm text-muted transition-colors duration-150 hover:text-ink"
    onClick={onClick}
  >
    <Icon name="chevronLeft" size={14} />
    Back
  </button>
);

/** Rating tone, matching the class cards. */
function tone(v) {
  if (!v) return { text: 'text-muted', bg: 'bg-surface-2', ring: 'ring-line' };
  if (v >= 4) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' };
  if (v >= 3) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/20' };
  return { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/20' };
}

/**
 * One class inside the batch. Shows this class's own rating within the cohort,
 * its strongest/weakest parameter, and a link to the full class drill-down —
 * this is the "separate class feedback" that lives inside the batch feedback.
 */
function ClassBreakdownCard({ c, basePath }) {
  const t = tone(c.overallAverage);
  const hasData = c.feedbackCount > 0;
  const sorted = [...(c.perParameter || [])].sort((a, b) => b.average - a.average);
  const best = sorted[0];
  const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null;

  return (
    <article className="card lift group flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold tracking-tight text-ink">{c.name}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Icon name="user" size={12} />
            {/* Both rosters: a co-taught session has several mentors, and
                naming only one of them misattributes the other's work. */}
            <MentorRosterBadges
              mainTrainerNames={c.mainTrainerNames}
              supportTrainerNames={c.supportTrainerNames}
              compact
            />
          </p>
        </div>
        <div className={`shrink-0 rounded-2xl px-3 py-2 text-center ring-1 ring-inset ${t.bg} ${t.ring}`}>
          <p className={`tnum text-lg font-bold leading-none ${t.text}`}>
            {hasData ? c.overallAverage.toFixed(2) : '—'}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">of 5</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4">
        <div className="rounded-xl bg-surface-2/60 px-2.5 py-2">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <Icon name="inbox" size={11} /> Responses
          </p>
          <p className="tnum mt-0.5 text-base font-bold text-ink">{c.feedbackCount}</p>
        </div>
        <div className="rounded-xl bg-surface-2/60 px-2.5 py-2">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <Icon name="sliders" size={11} /> Parameters
          </p>
          <p className="tnum mt-0.5 text-base font-bold text-ink">{c.perParameter?.length || 0}</p>
        </div>
      </div>

      {hasData && best ? (
        <div className="mt-3 space-y-1.5 px-4 text-xs">
          <p className="flex items-center gap-1.5 text-muted">
            <Icon name="trendUp" size={12} className="text-emerald-600 dark:text-emerald-400" />
            <span className="truncate">
              Best: <span className="font-medium text-ink">{best.label}</span>
            </span>
            <span className="tnum ml-auto font-semibold text-emerald-600 dark:text-emerald-400">
              {best.average.toFixed(1)}
            </span>
          </p>
          {worst && (
            <p className="flex items-center gap-1.5 text-muted">
              <Icon name="alert" size={12} className="text-amber-600 dark:text-amber-400" />
              <span className="truncate">
                Needs work: <span className="font-medium text-ink">{worst.label}</span>
              </span>
              <span className="tnum ml-auto font-semibold text-amber-600 dark:text-amber-400">
                {worst.average.toFixed(1)}
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 px-4 text-xs text-muted">
          <Icon name="info" size={12} /> No feedback yet
        </p>
      )}

      <div className="mt-4 flex items-center justify-end border-t border-line px-4 py-3">
        <Link
          to={`${basePath}/class/${c.id}`}
          className="btn-outline !px-3 !py-1.5 text-xs"
          aria-label={`Open full feedback for ${c.name}`}
        >
          Class feedback
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

/**
 * Batch drill-down used by both admin and trainer. Shows BOTH the batch-level
 * aggregate (across every class in the batch) and a per-class breakdown — the
 * "batch feedback" and "separate class feedback" the batch-holds-many-classes
 * model exists to provide. `fetcher` returns AnalyticsAPI.batch(); role scoping
 * happens server-side (a trainer only sees their own classes here).
 */
export default function BatchFeedbackView({ fetcher, exportPath, exportName, backTo, basePath, reloadKey }) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  /* Back should return to the page you ARRIVED from, not to a fixed one.
     This view is reachable from Feedbacks, from Classes/Batches, and from the
     year-group breakdown, and a hardcoded target sent people somewhere they
     had never been — pressing Back from a subject opened via Feedbacks landed
     on Classes. Linking pages pass their own path in router state; `backTo`
     stays as the fallback for a direct URL or a page refresh, where there is
     no in-app history to return to. */
  const backTarget = location.state?.from || backTo;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  /* The fetcher is held in a ref and the effect is keyed on `reloadKey`, not on
     the function identity.
     Depending on [fetcher] looked correct and was a trap: a caller that passes
     an inline arrow gets a new identity on every render, so the effect re-ran,
     set state, re-rendered, and re-ran — an infinite loop that fires a toast
     per iteration and never reaches the error UI. Today's callers happen to
     wrap theirs in useCallback, so the bug was latent rather than visible;
     keying on the id makes it impossible to reintroduce. */
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    (async () => {
      try {
        const d = await fetcherRef.current();
        if (alive) setData(d);
      } catch (e) {
        if (!alive) return;
        setError(e.message);
        toast.error(e.message);
      }
    })();
    return () => {
      alive = false;
    };
    // toast is a stable context value; reloadKey identifies WHAT to load.
  }, [reloadKey, toast]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink onClick={() => navigate(backTarget)} />
        <Card>
          <EmptyState
            title="Couldn’t load this batch"
            hint={error}
            icon="alert"
            action={<button className="btn-outline" onClick={() => navigate(backTarget)}>Go back</button>}
          />
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <SkeletonBlock height={60} className="max-w-sm rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} height={104} className="rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} height={200} className="rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const b = data.batch;
  const isOpen = b?.status === 'open';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <BackLink onClick={() => navigate(backTarget)} />
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">{b?.name}</h1>
            <span className={isOpen ? 'chip-open' : 'chip-locked'}>
              <Icon name={isOpen ? 'unlock' : 'lock'} size={12} strokeWidth={1.8} />
              {isOpen ? 'Open' : 'Locked'}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            <span className="tnum font-medium text-ink">{b?.classCount}</span>{' '}
            {b?.classCount === 1 ? 'class' : 'classes'} ·{' '}
            <span className="tnum font-medium text-ink">{b?.submittedCount}</span>
            {' / '}
            {b?.expectedCount || '∞'} responses
          </p>
        </div>
        <ExportButtons path={exportPath} baseName={exportName} />
      </div>

      {/* Batch-level KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Classes" value={b?.classCount || 0} icon="book" accent="violet" delay={0}
          hint="Classes included in this batch. Each is rated separately below." />
        <StatTile label="Responses" value={data.feedbackCount} icon="inbox" accent="amber" delay={50}
          hint="Total anonymous rows across every class in this batch." />
        <StatTile label="Overall avg" value={data.overallAverage.toFixed(2)} icon="star" accent="rose" delay={100}
          sub="out of 5" hint="Mean of every star across all classes and parameters in this batch." />
        <StatTile label="Students" value={b?.submittedCount || 0} icon="users" accent="emerald" delay={150}
          hint="Distinct submissions. One student rates every class in a single submission." />
      </div>

      {/* Per-class breakdown — the "separate class feedback" inside the batch. */}
      <Card
        title="Feedback by class"
        icon="book"
        hint="Each class in this batch, rated on its own. Open one for its full parameter breakdown, trend and comments."
        subtitle={b?.classCount ? `${b.classCount} ${b.classCount === 1 ? 'class' : 'classes'} in this batch` : undefined}
        bodyClass="p-0"
      >
        {(data.classesBreakdown || []).length === 0 ? (
          <div className="p-5">
            <EmptyState icon="book" title="No classes to show" hint="This batch has no classes you can view." />
          </div>
        ) : (
          <div className="stagger grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5">
            {data.classesBreakdown.map((c) => (
              <ClassBreakdownCard key={c.id} c={c} basePath={basePath} />
            ))}
          </div>
        )}
      </Card>

      {/* Batch-level aggregate charts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Average stars per parameter"
          icon="barChart"
          hint="Across every class in this batch (1–5). Switch to Table for exact values."
        >
          <ParamBarChart data={data.perParameter} />
        </Card>
        <Card title="Rating trend over time" icon="trendUp" hint="Daily average rating across this batch.">
          <TrendLineChart data={data.trend} />
        </Card>
      </div>

      <CommentsFeed comments={data.comments} title="Comments across this batch" />
    </div>
  );
}
