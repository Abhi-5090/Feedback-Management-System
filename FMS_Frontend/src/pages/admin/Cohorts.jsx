import { useEffect, useMemo, useState } from 'react';
import { AnalyticsAPI, downloadExport } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import Icon from '../../components/Icon.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';

/**
 * Cohorts & deployment — the two institution-level views the per-class pages
 * cannot answer.
 *
 * 1. YEAR-GROUP ROLL-UP. "How is second year doing?" is the question a head of
 *    training actually asks, and it spans several batches and subjects. The
 *    response RATE leads rather than the raw count: 240 responses is excellent
 *    from 300 students and poor from 1,700, and only the rate distinguishes
 *    them.
 *
 * 2. MENTOR DEPLOYMENT MATRIX. Who delivers, who assists, how much, and what
 *    each role scores. This mirrors the training board's workload view but
 *    adds the thing the board cannot know: whether the deployment is working.
 *    "Unassigned" mentors are surfaced deliberately — several people sit on the
 *    roster with no sessions, and that is a staffing decision waiting to be
 *    made, not an empty row to hide.
 */
export default function Cohorts() {
  const toast = useToast();
  const [cohorts, setCohorts] = useState(null);
  const [mentors, setMentors] = useState(null);
  const [sort, setSort] = useState('load');

  useEffect(() => {
    (async () => {
      try {
        const [c, m] = await Promise.all([AnalyticsAPI.cohorts(), AnalyticsAPI.mentorLoad()]);
        setCohorts(c);
        setMentors(m);
      } catch (e) {
        toast.error(e.message);
        setCohorts([]);
        setMentors([]);
      }
    })();
  }, [toast]);

  const totals = useMemo(() => {
    if (!cohorts?.length) return null;
    const expected = cohorts.reduce((n, c) => n + c.expected, 0);
    const submitted = cohorts.reduce((n, c) => n + c.submitted, 0);
    return {
      expected,
      submitted,
      rate: expected ? Math.round((submitted / expected) * 1000) / 10 : 0,
      batches: cohorts.reduce((n, c) => n + c.batches, 0),
      responses: cohorts.reduce((n, c) => n + c.responses, 0),
    };
  }, [cohorts]);

  const sortedMentors = useMemo(() => {
    if (!mentors) return [];
    const list = [...mentors];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'main') list.sort((a, b) => b.asMain.classes - a.asMain.classes);
    else if (sort === 'support') list.sort((a, b) => b.asSupport.classes - a.asSupport.classes);
    else if (sort === 'unassigned')
      list.sort((a, b) => a.totalClasses - b.totalClasses || a.name.localeCompare(b.name));
    else list.sort((a, b) => b.totalClasses - a.totalClasses || a.name.localeCompare(b.name));
    return list;
  }, [mentors, sort]);

  const unassigned = useMemo(
    () => (mentors || []).filter((m) => m.totalClasses === 0),
    [mentors]
  );

  const exportMatrix = async (format) => {
    try {
      await downloadExport('/export/mentors', { format }, `mentor_matrix.${format}`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analytics"
        title="Cohorts & deployment"
        subtitle="Feedback rolled up by year group, and how every mentor is deployed across the schedule."
      />

      {/* ── Institution totals ──────────────────────────────────────────── */}
      {totals && (
        <div className="panel animate-fade-up divide-y divide-line sm:grid sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Fig
            label="Response rate"
            value={`${totals.rate}%`}
            sub={`${totals.submitted.toLocaleString()} of ${totals.expected.toLocaleString()} students`}
            icon="activity"
            tone={totals.rate >= 60 ? 'emerald' : totals.rate >= 30 ? 'amber' : 'rose'}
          />
          <Fig label="Year groups" value={cohorts.length} icon="graduation" />
          <Fig label="Batches" value={totals.batches} icon="ticket" />
          <Fig label="Feedback rows" value={totals.responses.toLocaleString()} icon="inbox" />
        </div>
      )}

      {/* ── Year-group roll-up ──────────────────────────────────────────── */}
      <Card
        title="By year group"
        icon="graduation"
        hint="Every batch grouped by its year group. Response rate is submissions against the expected cohort size."
      >
        {!cohorts ? (
          <SkeletonRows rows={4} />
        ) : cohorts.length === 0 ? (
          <EmptyState icon="graduation" title="No batches yet">
            Create a batch and give it a year group to see cohorts here.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="th text-left">Year group</th>
                  <th className="th text-left">Batches</th>
                  <th className="th text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Response rate
                      <InfoTooltip text="Students who responded, against the total expected cohort size of every batch in this year group that has a cap set." />
                    </span>
                  </th>
                  <th className="th text-left">Responses</th>
                  <th className="th text-left">Avg rating</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.yearGroup} className="tr-hover border-b border-line last:border-0">
                    <td className="td">
                      <span className="font-semibold text-ink">{c.yearGroup}</span>
                      {c.openBatches > 0 && (
                        <span className="ml-2 chip-open !py-0.5 text-[10px]">
                          {c.openBatches} open
                        </span>
                      )}
                    </td>
                    <td className="td tnum">{c.batches}</td>
                    <td className="td">
                      <RateBar rate={c.responseRate} submitted={c.submitted} expected={c.expected} />
                    </td>
                    <td className="td tnum">{c.responses.toLocaleString()}</td>
                    <td className="td tnum font-semibold">
                      {c.average ? c.average.toFixed(2) : <span className="text-subtle">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Mentor deployment matrix ────────────────────────────────────── */}
      <Card
        title="Mentor deployment"
        icon="users"
        subtitle="Classes delivered vs assisted, with what each role scores"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="mentor-sort" className="sr-only">
              Sort mentors
            </label>
            <select
              id="mentor-sort"
              className="input !h-8 w-auto !py-1 text-xs"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="load">Busiest first</option>
              <option value="main">Most delivered</option>
              <option value="support">Most assisted</option>
              <option value="unassigned">Unassigned first</option>
              <option value="name">By name</option>
            </select>
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => exportMatrix('xlsx')}>
              <Icon name="download" size={13} />
              Excel
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => exportMatrix('pdf')}>
              <Icon name="download" size={13} />
              PDF
            </button>
          </div>
        }
      >
        {unassigned.length > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs ring-1 ring-inset ring-amber-500/20">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <span className="text-ink">
              <span className="font-semibold">
                {unassigned.length} mentor{unassigned.length === 1 ? '' : 's'}
              </span>{' '}
              {unassigned.length === 1 ? 'is' : 'are'} on the roster but not staffed on any live
              batch: {unassigned.map((m) => m.name).join(', ')}.
            </span>
          </p>
        )}

        {!mentors ? (
          <SkeletonRows rows={6} />
        ) : mentors.length === 0 ? (
          <EmptyState icon="users" title="No mentors yet">
            Add mentors, then staff them on a batch.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="th text-left">Mentor</th>
                  <th className="th text-left">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="user-check" size={12} />
                      Delivers
                    </span>
                  </th>
                  <th className="th text-left">Avg as main</th>
                  <th className="th text-left">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="users" size={12} />
                      Assists
                    </span>
                  </th>
                  <th className="th text-left">Avg as support</th>
                  <th className="th text-left">Deployment</th>
                </tr>
              </thead>
              <tbody>
                {sortedMentors.map((m) => (
                  <tr key={m.id} className="tr-hover border-b border-line last:border-0">
                    <td className="td">
                      <span className="font-semibold text-ink">{m.name}</span>
                      {m.shortName && m.shortName !== m.name && (
                        <span className="ml-1.5 text-[11px] text-subtle">({m.shortName})</span>
                      )}
                    </td>
                    <td className="td">
                      <Load classes={m.asMain.classes} batches={m.asMain.batches} />
                    </td>
                    <td className="td">
                      <Score stats={m.asMain} />
                    </td>
                    <td className="td">
                      <Load classes={m.asSupport.classes} batches={m.asSupport.batches} />
                    </td>
                    <td className="td">
                      <Score stats={m.asSupport} />
                    </td>
                    <td className="td">
                      <span
                        className={`chip !py-0.5 text-[10px] ${
                          m.deployment === 'Unassigned'
                            ? 'bg-surface-2 text-muted'
                            : 'bg-brand-500/12 text-brand-700 dark:text-brand-300'
                        }`}
                      >
                        {m.deployment}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Load as "3 classes · 2 batches", or a dash when there is none. */
function Load({ classes, batches }) {
  if (!classes) return <span className="text-subtle">—</span>;
  return (
    <span className="text-xs">
      <span className="tnum font-semibold text-ink">{classes}</span>{' '}
      <span className="text-muted">{classes === 1 ? 'class' : 'classes'}</span>
      <span className="text-subtle"> · </span>
      <span className="tnum text-muted">{batches}</span>{' '}
      <span className="text-muted">{batches === 1 ? 'batch' : 'batches'}</span>
    </span>
  );
}

/**
 * A role's score. "No responses" rather than 0.00 — an unrated role is not a
 * zero-rated one, and printing 0.00 beside a person's name is a false claim
 * about their teaching.
 */
function Score({ stats }) {
  if (!stats.responses) return <span className="text-xs text-subtle">No responses</span>;
  return (
    <span className="text-xs">
      <span className="tnum font-semibold text-ink">{stats.average.toFixed(2)}</span>
      <span className="text-muted"> ★ </span>
      <span className="tnum text-subtle">({stats.responses})</span>
    </span>
  );
}

/** Response rate as a labelled bar — the proportion is the point, not the digits. */
function RateBar({ rate, submitted, expected }) {
  if (!expected) return <span className="text-subtle">No cap set</span>;
  const tone = rate >= 60 ? 'bg-emerald-500' : rate >= 30 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, rate)}%` }}
        />
      </span>
      <span className="tnum text-xs font-semibold text-ink">{rate}%</span>
      <span className="tnum text-[11px] text-subtle">
        {submitted}/{expected}
      </span>
    </span>
  );
}

function Fig({ label, value, sub, icon, tone }) {
  const toneCls =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'rose'
          ? 'text-rose-700 dark:text-rose-400'
          : 'text-ink';
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className={`tnum mt-0.5 text-xl font-bold ${toneCls}`}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-subtle">{sub}</p>}
      </div>
    </div>
  );
}
