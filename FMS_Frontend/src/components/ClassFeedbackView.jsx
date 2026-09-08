import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from './Toast.jsx';
import Card, { EmptyState } from './Card.jsx';
import StatTile from './StatTile.jsx';
import { SkeletonBlock } from './Spinner.jsx';
import ExportButtons from './ExportButtons.jsx';
import CommentsFeed from './CommentsFeed.jsx';
import ParamBarChart from './charts/ParamBarChart.jsx';
import TrendLineChart from './charts/TrendLineChart.jsx';
import Icon from './Icon.jsx';
import YearGroupBreakdown from './YearGroupBreakdown.jsx';

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

/**
 * Shared class drill-down used by both admin and trainer. `fetcher` returns the
 * analytics payload; `exportPath` is the matching export endpoint (both already
 * role-scoped server-side).
 */
export default function ClassFeedbackView({
  fetcher, reloadKey, exportPath, exportName, backTo, basePath,
}) {
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
            title="Couldn’t load this class"
            hint={error}
            icon="alert"
            action={
              <button className="btn-outline" onClick={() => navigate(backTarget)}>
                Go back
              </button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <SkeletonBlock height={60} className="max-w-sm rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} height={104} className="rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <SkeletonBlock height={300} className="rounded-2xl" />
          <SkeletonBlock height={300} className="rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <BackLink onClick={() => navigate(backTarget)} />
          <h1 className="truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {data.class?.name}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {/* A subject has no single owner any more — staffing is per batch.
                The default is shown only as a hint; the real teams are listed
                per cohort below. */}
            Default mentor:{' '}
            <span className="font-medium text-ink">{data.class?.defaultTrainer || 'none'}</span>
          </p>
        </div>
        <ExportButtons path={exportPath} baseName={exportName} />
      </div>

      {/* The CONSOLIDATED figures. They are the headline, and the breakdown
          below says what they are made of — a subject taught to two different
          year groups has one average and two very different realities. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Responses" value={data.feedbackCount} icon="inbox" accent="amber" delay={0}
          sub={
            data.breakdown
              ? `across ${data.breakdown.consolidated.batchCount} batch${data.breakdown.consolidated.batchCount === 1 ? '' : 'es'}`
              : undefined
          }
          hint="Total anonymous submissions for this subject, every cohort combined." />
        <StatTile label="Overall avg" value={data.overallAverage.toFixed(2)} icon="star" accent="rose" delay={50}
          sub="out of 5"
          hint="Mean of every star across all parameters and all cohorts. The breakdown below separates them — cohorts of the same subject often differ by more than a point." />
        <StatTile
          label="Year groups"
          value={data.breakdown?.consolidated.yearGroupCount ?? 1}
          icon="graduation"
          accent="violet"
          delay={100}
          hint="How many year groups take this subject. Their feedback is kept separate below because it is not comparable." />
        <StatTile label="Parameters" value={data.perParameter.length} icon="sliders" accent="sky" delay={150}
          hint="Rating dimensions with at least one response." />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Average stars per parameter"
          icon="barChart"
          hint="How students rate each dimension for this class (1–5). Switch to Table for exact values."
        >
          <ParamBarChart data={data.perParameter} />
        </Card>
        <Card title="Rating trend over time" icon="trendUp" hint="Daily average rating for this class.">
          <TrendLineChart data={data.trend} />
        </Card>
      </div>

      {/* Subject → year group → batch. The consolidated view stays above; this
          is where it gets divided. */}
      {data.breakdown && (
        <YearGroupBreakdown
          breakdown={data.breakdown}
          basePath={basePath}
          subjectName={data.class?.name || 'This subject'}
        />
      )}

      <CommentsFeed comments={data.comments} title="Comments for this class" />
    </div>
  );
}
