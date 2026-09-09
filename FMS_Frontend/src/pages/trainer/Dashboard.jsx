import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnalyticsAPI, DashboardAPI } from '../../api/endpoints.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import StatTile from '../../components/StatTile.jsx';
import RoleSplitPanel from '../../components/RoleSplitPanel.jsx';
import Card from '../../components/Card.jsx';
import Hero from '../../components/Hero.jsx';
import OpenBatchesPanel from '../../components/OpenBatchesPanel.jsx';
import CommentsFeed from '../../components/CommentsFeed.jsx';
import ThemesPanel from '../../components/ThemesPanel.jsx';
import ExportButtons from '../../components/ExportButtons.jsx';
import { SkeletonBlock } from '../../components/Spinner.jsx';
import Icon from '../../components/Icon.jsx';
import ParamBarChart from '../../components/charts/ParamBarChart.jsx';
import TrendLineChart from '../../components/charts/TrendLineChart.jsx';
import VolumeBarChart from '../../components/charts/VolumeBarChart.jsx';

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
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

export default function TrainerDashboard() {
  const { user } = useAuth();
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
      setData(await DashboardAPI.trainerMe());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  usePolling(load, 8000, true);

  const k = data?.kpis;

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Trainer workspace"
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle="Everything here is scoped to the classes assigned to you — never anyone else's data."
        metricLabel="My rating"
        metric={k ? k.overallAverage.toFixed(2) : '—'}
        metricSuffix="/ 5"
        stats={
          k
            ? [
                { label: 'Responses', value: k.feedbackCount },
                { label: 'Classes', value: k.myClasses },
              ]
            : []
        }
        actions={<ExportButtons path="/export/trainer/me" baseName="my_feedback" />}
      />

      {loading && !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="I deliver" value={k.mainClasses ?? k.myClasses} icon="user-check" accent="sky" delay={0}
              sub="as main mentor"
              hint="Classes you are the main mentor for — the ones you deliver." />
            <StatTile label="I assist on" value={k.supportClasses ?? 0} icon="users" accent="violet" delay={50}
              sub="as support mentor"
              hint="Classes you support. Another mentor delivers these; you assist the session." />
            <StatTile label="Responses" value={k.feedbackCount} icon="inbox" accent="amber" delay={100}
              hint="Anonymous responses across every class you are staffed on, in either role." />
            <StatTile label="My avg rating" value={k.overallAverage.toFixed(2)} icon="star" accent="rose" delay={150}
              sub="out of 5"
              hint="Mean of all stars across every rated parameter, both roles combined. The split below separates them." />
          </div>

          {/* The blended average above is a summary; this is the honest
              version. A weak score on a class someone else delivered should
              not read as a weak score on your own teaching. */}
          {data.roleSplit && (
            <Card
              title="My ratings by role"
              icon="sliders"
              hint="Feedback on sessions you delivered, separated from sessions you assisted on."
            >
              <RoleSplitPanel split={data.roleSplit} />
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="My average per parameter"
              icon="barChart"
              hint="How your students rate each dimension on average (1–5). Switch to Table for exact values."
            >
              <ParamBarChart data={data.charts.perParameter} />
            </Card>
            <Card title="My rating trend" icon="trendUp" hint="Your daily average rating over time.">
              <TrendLineChart data={data.charts.trend} />
            </Card>
          </div>

          {/* Full-width rows — see the note on the admin dashboard. */}
          <Card
            title="Responses per class"
            icon="building"
              hint="How much feedback each of your classes has collected. Select a class below to drill down."
            >
              <VolumeBarChart data={data.charts.volumePerClass} />
              {data.charts.volumePerClass?.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Drill into a class
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.charts.volumePerClass.map((c) => (
                      <Link
                        key={c.classId}
                        to={`/trainer/class/${c.classId}`}
          state={{ from: '/trainer' }}
                        className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-500/20 transition-colors duration-150 hover:bg-brand-500/20 dark:text-brand-300"
                      >
                        {c.className}
                        <span className="tnum text-brand-600/70 dark:text-brand-400/70">
                          {c.responses}
                        </span>
                        <Icon name="chevronRight" size={13} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
          </Card>

          <OpenBatchesPanel
            batches={data.openBatchList}
            hint="Your batches currently accepting feedback, with a live submitted/expected counter."
          />

          <ThemesPanel params={{}} />

          <CommentsFeed
            comments={data.comments}
            total={data.commentTotal}
            /* The dashboard is the whole system, so BOTH dropdowns are useful
               here — narrow to a cohort, or to a subject across cohorts.
               Options come from the session list, which is already scoped to
               what this account may see, so a mentor's dropdowns never
               advertise a batch they cannot open. */
            filterOptions={commentFilters}
            title="What your students are saying"
          />
        </>
      )}
    </div>
  );
}
