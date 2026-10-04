import { useEffect, useState, useCallback } from 'react';
import { AnalyticsAPI, DashboardAPI } from '../../api/endpoints.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useToast } from '../../components/Toast.jsx';
import StatTile, { ratingTone, rateTone } from '../../components/StatTile.jsx';
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
import RatingDistribution from '../../components/analytics/RatingDistribution.jsx';
import ParameterHeatmap from '../../components/analytics/ParameterHeatmap.jsx';
import SessionRanking from '../../components/analytics/SessionRanking.jsx';
import CollectionHealth from '../../components/analytics/CollectionHealth.jsx';

/** Skeleton mirrors the real layout so nothing shifts when data lands. */
function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
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
      {/* The hero says WHERE you are. It used to repeat three numbers —
          overall rating, responses, open now — that the tiles immediately
          below already carry, in a second visual style: the same fact stated
          twice, which makes a reader check whether the two agree instead of
          reading either. The tiles own the numbers now. */}
      <Hero
        eyebrow="Admin workspace"
        title="System overview"
        subtitle="Every class, mentor, batch and anonymous response across the platform."
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
          {/* KPI tiles. Four across at most, never seven: at 1440px a
              seven-column row gives each tile about 100px, which is not enough
              for "0 of 25" to sit beside a number without wrapping. Two rows of
              calm tiles read faster than one row of cramped ones.

              Colour is SEMANTIC here (see TONES in StatTile). Counts are
              neutral because a count has no good or bad; the two tiles that do
              carry a judgement — the rating and the response rate — take their
              colour from their own value, so a row that is fine looks fine at a
              glance and a row that is not shows exactly where. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile label="Mentors" value={k.trainers} icon="users" tone="neutral" delay={0}
              hint="Active mentors. Each sees feedback only for sessions they are staffed on, as main or support." />
            <StatTile label="Classes" value={k.classes} icon="book" tone="neutral" delay={40}
              hint="Training subjects. Staffing is decided per batch, so the same subject can run with different mentor teams for different cohorts." />
            <StatTile label="Batches" value={k.batches} icon="ticket" tone="neutral" delay={80}
              hint="Cohorts. Each batch spans several subjects, owns its passcode, and has its own open/closed window." />
            {/* An open batch is a live state worth seeing; zero open is simply
                the resting state, not a problem. */}
            <StatTile label="Open now" value={k.openBatches} icon="unlock" delay={120}
              tone={k.openBatches > 0 ? 'good' : 'neutral'}
              hint="Batches currently accepting feedback (unlocked window)." />
            <StatTile label="Feedback" value={k.feedbackCount} icon="inbox" tone="neutral" delay={160}
              hint="Total anonymous responses collected across the platform." />
            <StatTile label="Avg rating" value={k.overallAverage.toFixed(2)} icon="star" delay={200}
              tone={ratingTone(k.overallAverage)}
              sub="out of 5"
              hint="Mean of every star given across all rated parameters." />
            {/* A raw feedback count cannot tell you whether a survey landed.
                812 responses is excellent from 900 students and poor from
                1,740 — so the rate is shown alongside the total. */}
            <StatTile
              label="Response rate"
              value={`${k.responseRate ?? 0}%`}
              icon="activity"
              tone={rateTone(k.responseRate)}
              delay={240}
              sub={`${k.submittedResponses ?? 0} of ${k.expectedResponses ?? 0}`}
              hint="Students who have responded, against the expected cohort sizes of every batch with a cap set. This is the number that tells you whether a survey actually reached people."
            />
          </div>

          {/* ORDER IS THE ARGUMENT. The distribution comes before every chart
             because it qualifies the headline average directly above it: a
             reader who takes "4.2" at face value and scrolls on has misread
             the data, and this is the panel that stops them. Collection health
             sits beside it for the same reason — it says how much of the
             cohort that 4.2 actually speaks for. */}
          <div className="grid gap-5 lg:grid-cols-2">
            <RatingDistribution data={data.stats?.distribution} />
            <CollectionHealth data={data.stats?.health} />
          </div>

          {/* Then the diagnosis: which session, and which parameter of which
              subject. Both are actionable in a way an average never is. */}
          <SessionRanking data={data.stats?.ranking} />

          <ParameterHeatmap data={data.stats?.heatmap} />

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
