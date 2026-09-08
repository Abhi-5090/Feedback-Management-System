import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Card from './Card.jsx';
import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import ParamBarChart from './charts/ParamBarChart.jsx';
import { MentorRosterBadges } from './MentorRosterPicker.jsx';

/**
 * A subject's feedback, consolidated at the top and divided by YEAR GROUP
 * underneath.
 *
 * The same subject runs for several cohorts, and those cohorts are not
 * comparable — GenAI scores 4.57 with final-year students and 3.66 with
 * third-year ones. A single average for the subject is the right headline and
 * a useless basis for a decision, so the divisions are one click away rather
 * than on another page.
 *
 * Everything arrives in the parent's single response, so switching tabs is
 * instant and the totals can never disagree with the parts — both are computed
 * from the same stars server-side.
 *
 * "All years" leads with a comparison rather than repeating the headline
 * number: seeing 4.57 next to 3.66 is the entire point of the view, and a
 * reader should not have to click twice and hold two figures in their head.
 */
export default function YearGroupBreakdown({ breakdown, basePath, subjectName }) {
  const groups = breakdown?.yearGroups || [];
  const [selected, setSelected] = useState('all'); // 'all' | yearGroup name

  const multiYear = groups.length > 1;
  const active = selected === 'all' ? null : groups.find((g) => g.yearGroup === selected);

  // Parameters that exist anywhere, in display order — the row labels for the
  // cross-year comparison.
  const paramLabels = useMemo(() => {
    const seen = new Map();
    for (const g of groups) {
      for (const p of g.perParameter) if (!seen.has(p.label)) seen.set(p.label, p.order ?? 999);
    }
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  }, [groups]);

  if (groups.length === 0) return null;

  return (
    <Card
      title="By year group"
      icon="graduation"
      subtitle={
        multiYear
          ? `${subjectName} runs for ${groups.length} year groups — their feedback is not comparable, so it is kept separate`
          : `${subjectName} runs for ${groups[0].yearGroup} only`
      }
    >
      {/* ── Toggle ─────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Year group"
        className="mb-4 flex flex-wrap gap-1.5 rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-line"
      >
        <Tab
          active={selected === 'all'}
          onClick={() => setSelected('all')}
          label="All years"
          count={breakdown.consolidated.responses}
        />
        {groups.map((g) => (
          <Tab
            key={g.yearGroup}
            active={selected === g.yearGroup}
            onClick={() => setSelected(g.yearGroup)}
            label={g.yearGroup}
            count={g.responses}
            average={g.average}
          />
        ))}
      </div>

      {selected === 'all' ? (
        <AllYears groups={groups} paramLabels={paramLabels} multiYear={multiYear} basePath={basePath} />
      ) : (
        <OneYear group={active} basePath={basePath} />
      )}
    </Card>
  );
}

function Tab({ active, onClick, label, count, average }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`focus-ring flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150 ${
        active ? 'bg-card shadow-sm' : 'hover:bg-card/60'
      }`}
    >
      <span className={`text-xs font-bold ${active ? 'text-ink' : 'text-muted'}`}>{label}</span>
      {typeof average === 'number' && average !== null ? (
        <span className={`tnum text-xs font-semibold ${active ? 'text-brand-700 dark:text-brand-300' : 'text-subtle'}`}>
          {average.toFixed(2)}★
        </span>
      ) : null}
      <span className="tnum rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-muted">
        {count}
      </span>
    </button>
  );
}

/* ── All years: the comparison ─────────────────────────────────────────── */

function AllYears({ groups, paramLabels, multiYear, basePath }) {
  const rated = groups.filter((g) => g.average != null);
  const spread =
    rated.length > 1
      ? Math.max(...rated.map((g) => g.average)) - Math.min(...rated.map((g) => g.average))
      : null;

  return (
    <div className="space-y-5">
      {/* Headline per year group, side by side. */}
      <div className={`grid gap-3 ${groups.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {groups.map((g) => (
          <YearSummary key={g.yearGroup} g={g} />
        ))}
      </div>

      {/* A gap worth naming. Two cohorts of the same subject a full point
          apart is a staffing or pacing question, not a rounding artefact. */}
      {spread != null && spread >= 0.5 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs ring-1 ring-inset ring-amber-500/20">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="text-ink">
            These cohorts are <span className="font-semibold">{spread.toFixed(2)} stars apart</span> on
            the same subject. Worth comparing the per-parameter rows below before reading the
            combined average as a single verdict.
          </span>
        </p>
      )}

      {/* Per-parameter, year beside year. This is the table that answers
          "is it the pace, or is it the cohort?" */}
      {multiYear && paramLabels.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            Per parameter, by year group
            <InfoTooltip text="The same rating dimension across every cohort taking this subject. A row that is weak everywhere is a course problem; a row weak in one cohort is a delivery problem." />
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="th text-left">Parameter</th>
                  {groups.map((g) => (
                    <th key={g.yearGroup} className="th text-left">
                      {g.yearGroup}
                    </th>
                  ))}
                  <th className="th text-left">Gap</th>
                </tr>
              </thead>
              <tbody>
                {paramLabels.map((label) => {
                  const vals = groups.map(
                    (g) => g.perParameter.find((p) => p.label === label)?.average ?? null
                  );
                  const present = vals.filter((v) => v != null);
                  const gap =
                    present.length > 1 ? Math.max(...present) - Math.min(...present) : null;
                  const lowest = present.length ? Math.min(...present) : null;
                  return (
                    <tr key={label} className="tr-hover border-b border-line last:border-0">
                      <td className="td font-medium text-ink">{label}</td>
                      {vals.map((v, i) => (
                        <td key={groups[i].yearGroup} className="td">
                          {v == null ? (
                            <span className="text-subtle">—</span>
                          ) : (
                            <ScoreChip value={v} weakest={v === lowest && gap >= 0.5} />
                          )}
                        </td>
                      ))}
                      <td className="td tnum text-xs text-muted">
                        {gap == null ? '—' : gap.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Single-year subject: no comparison to draw, so show the chart. */}
      {!multiYear && groups[0].perParameter.length > 0 && (
        <ParamBarChart data={groups[0].perParameter} />
      )}

      {/* Every batch, grouped by year. */}
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.yearGroup}>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              {g.yearGroup}
            </p>
            <BatchTable batches={g.batches} basePath={basePath} />
          </div>
        ))}
      </div>
    </div>
  );
}

function YearSummary({ g }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{g.yearGroup}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="tnum text-2xl font-bold text-ink">
          {g.average == null ? '—' : g.average.toFixed(2)}
        </span>
        {g.average != null && <span className="text-sm text-muted">★</span>}
      </div>
      <dl className="mt-2.5 space-y-1 text-[11px]">
        <Row label="Responses" value={g.responses} />
        <Row label="Batches" value={`${g.batchCount}${g.openBatches ? ` · ${g.openBatches} open` : ''}`} />
        <Row
          label="Answered"
          value={g.responseRate == null ? '—' : `${g.submitted}/${g.expected} (${g.responseRate}%)`}
        />
      </dl>
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="text-subtle">{label}</dt>
    <dd className="tnum font-semibold text-ink">{value}</dd>
  </div>
);

/* ── One year group ────────────────────────────────────────────────────── */

function OneYear({ group, basePath }) {
  if (!group) return null;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Fig label="Average" value={group.average == null ? '—' : group.average.toFixed(2)} sub="out of 5" />
        <Fig label="Responses" value={group.responses} />
        <Fig
          label="Answered"
          value={group.responseRate == null ? '—' : `${group.responseRate}%`}
          sub={`${group.submitted} of ${group.expected}`}
        />
        <Fig
          label="Batches"
          value={group.batchCount}
          sub={group.openBatches ? `${group.openBatches} open now` : 'all locked'}
        />
      </div>

      {group.perParameter.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
            Average per parameter — {group.yearGroup}
          </p>
          <ParamBarChart data={group.perParameter} />
        </div>
      ) : (
        <p className="rounded-xl bg-surface-2/60 px-3.5 py-3 text-sm text-muted">
          No responses from this year group yet.
        </p>
      )}

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Batches in {group.yearGroup}
        </p>
        <BatchTable batches={group.batches} basePath={basePath} />
      </div>
    </div>
  );
}

const Fig = ({ label, value, sub }) => (
  <div className="rounded-xl border border-line bg-surface-2/40 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
    <p className="tnum mt-0.5 text-xl font-bold text-ink">{value}</p>
    {sub && <p className="mt-0.5 text-[11px] text-subtle">{sub}</p>}
  </div>
);

/* ── Batches ───────────────────────────────────────────────────────────── */

function BatchTable({ batches, basePath }) {
  // Returning from a batch should come back to THIS subject page, including
  // the year-group tab the user was on when they left.
  const location = useLocation();
  const here = location.pathname + location.search;
  if (!batches?.length) {
    return <p className="text-sm text-subtle">No batches.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th className="th text-left">Batch</th>
            <th className="th text-left">Mentors</th>
            <th className="th text-left">Avg</th>
            <th className="th text-left">Responses</th>
            <th className="th text-left">Answered</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="tr-hover border-b border-line last:border-0">
              <td className="td">
                {/* Deep link into the batch drill-down, so the division is a
                    path to the detail rather than a dead end. */}
                {/* Link, not <a href>: a raw anchor reloads the whole SPA,
                    throwing away the router state that Back depends on and
                    re-downloading the bundle. */}
                <Link
                  to={`${basePath}/batch/${b.id}`}
                  state={{ from: here }}
                  className="font-semibold text-ink underline decoration-dotted decoration-line underline-offset-2 hover:decoration-solid"
                >
                  {b.name}
                </Link>
                <span className="block text-[11px] text-subtle">
                  {b.dept || '—'}
                  {b.status === 'open' && (
                    <span className="ml-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                      open
                    </span>
                  )}
                  {b.round > 1 && <span className="ml-1.5 text-subtle">round {b.round}</span>}
                </span>
              </td>
              <td className="td">
                <MentorRosterBadges
                  mainTrainerNames={b.mainTrainerNames}
                  supportTrainerNames={b.supportTrainerNames}
                  compact
                />
              </td>
              <td className="td">
                {b.average == null ? (
                  <span className="text-subtle">—</span>
                ) : (
                  <ScoreChip value={b.average} />
                )}
              </td>
              <td className="td tnum">{b.responses}</td>
              <td className="td">
                {b.responseRate == null ? (
                  <span className="text-subtle">no cap</span>
                ) : (
                  <span className="text-xs">
                    <span className="tnum font-semibold text-ink">{b.responseRate}%</span>
                    <span className="tnum text-subtle">
                      {' '}
                      ({b.submittedCount}/{b.expectedCount})
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A score with a band. Colour carries the same information as the number so a
 * table can be scanned rather than read; the number is always present, because
 * colour alone fails for anyone who cannot distinguish these hues.
 */
function ScoreChip({ value, weakest = false }) {
  const tone =
    value >= 4
      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
      : value >= 3.5
        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
        : 'bg-rose-500/12 text-rose-700 dark:text-rose-400';
  return (
    <span
      className={`tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
      title={weakest ? 'Lowest of the cohorts for this parameter' : undefined}
    >
      {value.toFixed(2)}
      {weakest && <Icon name="alert" size={9} />}
    </span>
  );
}
