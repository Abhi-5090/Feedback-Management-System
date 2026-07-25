import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from './Toast.jsx';
import Card, { EmptyState } from './Card.jsx';
import StatTile from './StatTile.jsx';
import { SkeletonBlock } from './Spinner.jsx';
import ExportButtons from './ExportButtons.jsx';
import CommentsFeed from './CommentsFeed.jsx';
import ParamBarChart from './charts/ParamBarChart.jsx';
import TrendLineChart from './charts/TrendLineChart.jsx';
import Icon from './Icon.jsx';

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
export default function ClassFeedbackView({ fetcher, exportPath, exportName, backTo }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetcher();
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e.message);
        toast.error(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetcher]); // eslint-disable-line

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink onClick={() => navigate(backTo)} />
        <Card>
          <EmptyState
            title="Couldn’t load this class"
            hint={error}
            icon="alert"
            action={
              <button className="btn-outline" onClick={() => navigate(backTo)}>
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
          <BackLink onClick={() => navigate(backTo)} />
          <h1 className="truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {data.class?.name}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            Trainer: <span className="font-medium text-ink">{data.class?.trainer || '—'}</span>
          </p>
        </div>
        <ExportButtons path={exportPath} baseName={exportName} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Responses" value={data.feedbackCount} icon="inbox" accent="amber" delay={0}
          hint="Total anonymous submissions for this class." />
        <StatTile label="Overall avg" value={data.overallAverage.toFixed(2)} icon="star" accent="rose" delay={50}
          sub="out of 5"
          hint="Mean of every star across all parameters." />
        <StatTile label="Parameters" value={data.perParameter.length} icon="sliders" accent="sky" delay={100}
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

      <CommentsFeed comments={data.comments} title="Comments for this class" />
    </div>
  );
}
