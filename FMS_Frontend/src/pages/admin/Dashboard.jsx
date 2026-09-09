import { useEffect, useState, useCallback } from 'react';
import { AnalyticsAPI, DashboardAPI } from '../../api/endpoints.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useToast } from '../../components/Toast.jsx';
import StatTile from '../../components/StatTile.jsx';
import Card from '../../components/Card.jsx';
import Hero from '../../components/Hero.jsx';
import OpenBatchesPanel from '../../components/OpenBatchesPanel.jsx';
import CommentsFeed from '../../components/CommentsFeed.jsx';
import ThemesPanel from '../../components/ThemesPanel.jsx';
import ExportButtons from '../../components/ExportButtons.jsx';
import { SkeletonBlock } from '../../components/Spinner.jsx';
import ParamBarChart from '../../components/charts/ParamBarChart.jsx';
import TrendLineChart from '../../components/charts/TrendLineChart.jsx';
import VolumeBarChart from '../../components/charts/VolumeBarChart.jsx';

/** Skeleton mirrors the real layout so nothing shifts when data lands. */
function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} height={104} className="rounded-2xl" />
        ))}
      </div>
      <SkeletonBlock height={92} className="rounded-2xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <SkeletonBlock height={300} className="rounded-2xl" />
        <SkeletonBlock height={300} className="rounded-2xl" />
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  /* Batch and subject options for the comment filters. Fetched once — the
     dashboard polls every 8s and these change only when an admin edits the
     catalog, so refetching them on every tick would be pure noise. */
  const [commentFilters, setCommentFilters] = useState({ batches: [], classes: [] });

  useEffect(() => {
    let alive = true;
    AnalyticsAPI.sessions()
      .then((d) => {
        if (!alive) return;
        const batches = new Map();
        for (const s of d.sessions) batches.set(s.batchId, s.batchName);
        setCommentFilters({
          batches: [...batches].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
          classes: d.filters.classes,
        });
      })
      .catch(() => {
        /* The filters are an enhancement; the feed works without them. */
      });
    return () => {
      alive = false;
    };
  }, []);


  const load = useCallback(async () => {
    try {
      const d = await DashboardAPI.admin();
      setData(d);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Poll for live counters.
  usePolling(load, 8000, true);

  const k = data?.kpis;

  return (
    <div className="space-y-5">
      {/* Hero answers "how are we doing?" before any detail is read */}
      <Hero
        eyebrow="Admin workspace"
        title="System overview"
        subtitle="Every class, trainer, batch and anonymous response across the platform."
        metricLabel="Overall rating"
        metric={k ? k.overallAverage.toFixed(2) : '—'}
        metricSuffix="/ 5"
        stats={
          k
            ? [
                { label: 'Responses', value: k.feedbackCount },
                { label: 'Open now', value: k.openBatches },
              ]
            : []
        }
      />

      {/* Exports live here on their own. The dashboard is deliberately the
          whole-system view — narrowing to one class or batch is what the
          Feedbacks section is for, so a filter bar here only duplicated it. */}
      <div className="flex justify-end">
        <ExportButtons path="/export/dashboard/admin" baseName="admin_dashboard" />
      </div>

      {loading && !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* KPI tiles — every one carries a tooltip so the dashboard teaches itself */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <StatTile label="Mentors" value={k.trainers} icon="users" accent="violet" delay={0}
              hint="Active mentors. Each sees feedback only for sessions they are staffed on, as main or support." />
            <StatTile label="Classes" value={k.classes} icon="book" accent="sky" delay={40}
              hint="Training subjects. Staffing is decided per batch, so the same subject can run with different mentor teams for different cohorts." />
            <StatTile label="Batches" value={k.batches} icon="ticket" accent="brand" delay={80}
              hint="Cohorts. Each batch spans several subjects, owns its passcode, and has its own open/closed window." />
            <StatTile label="Open now" value={k.openBatches} icon="unlock" accent="emerald" delay={120}
              hint="Batches currently accepting feedback (unlocked window)." />
            <StatTile label="Feedback" value={k.feedbackCount} icon="inbox" accent="amber" delay={160}
              hint="Total anonymous responses collected across the platform." />
            <StatTile label="Avg rating" value={k.overallAverage.toFixed(2)} icon="star" accent="rose" delay={200}
              sub="out of 5"
              hint="Mean of every star given across all rated parameters." />
            {/* A raw feedback count cannot tell you whether a survey landed.
                812 responses is excellent from 900 students and poor from
                1,740 — so the rate is shown alongside the total. */}
            <StatTile
              label="Response rate"
              value={`${k.responseRate ?? 0}%`}
              icon="activity"
              accent="teal"
              delay={240}
              sub={`${k.submittedResponses ?? 0} of ${k.expectedResponses ?? 0}`}
              hint="Students who have responded, against the expected cohort sizes of every batch with a cap set. This is the number that tells you whether a survey actually reached people."
            />
          </div>

          {/* Charts */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="Average stars per parameter"
              icon="barChart"
              hint="How students rate each dimension on average (1–5), in the admin-defined parameter order. Switch to Table for exact values."
            >
              <ParamBarChart data={data.charts.perParameter} />
            </Card>
            <Card
              title="Rating trend over time"
              icon="trendUp"
              hint="Daily average rating — watch for dips after specific sessions."
            >
              <TrendLineChart data={data.charts.trend} />
            </Card>
          </div>

          {/* Each of these gets its own full-width row. Side by side they were
              cramped: the volume chart squeezes its class labels, and the open
              batches list wraps to two columns of narrow cards. */}
          <Card
            title="Feedback volume per class"
            icon="building"
            hint="How many responses each class has collected, highest first."
          >
            <VolumeBarChart data={data.charts.volumePerClass} />
          </Card>

          <OpenBatchesPanel batches={data.openBatchList} />

          <ThemesPanel />

          <CommentsFeed
            comments={data.comments}
            total={data.commentTotal}
            /* The dashboard is the whole system, so BOTH dropdowns are useful
               here — narrow to a cohort, or to a subject across cohorts.
               Options come from the session list, which is already scoped to
               what this account may see, so a mentor's dropdowns never
               advertise a batch they cannot open. */
            filterOptions={commentFilters}
          />
        </>
      )}
    </div>
  );
}
