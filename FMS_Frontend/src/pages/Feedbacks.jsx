import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnalyticsAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Card, { EmptyState } from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { SkeletonBlock } from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';
import InfoTooltip from '../components/InfoTooltip.jsx';
import { MentorRosterBadges } from '../components/MentorRosterPicker.jsx';

/**
 * Feedbacks — one card per SESSION, a session being a (batch, subject) pair.
 *
 * WHY NOT ONE CARD PER SUBJECT. That was the previous shape and it hid the
 * thing people came to see. "Industry Readiness 1" is four separate second-year
 * batches with different mentors; one card averaging all four belongs to nobody
 * and every one of them looked identical. A card per session is a card per
 * thing that actually happened: this cohort, this subject, these mentors.
 *
 * Filters, in the order they matter here:
 *   - YEAR GROUP, because that is the first cut anyone makes;
 *   - subject, to compare the same thing across cohorts;
 *   - role (mentors only), separating what they delivered from what they
 *     assisted;
 *   - a sort, kept from the previous version.
 *
 * Year and subject are applied SERVER-side (the scoping must not be
 * client-side for a mentor), and live in the URL so a view is linkable and
 * Back works. Sorting is local — it needs no round trip.
 */

const SORTS = [
  { v: 'recent', label: 'Most recent' },
  { v: 'rating', label: 'Highest rated' },
  { v: 'lowest', label: 'Lowest rated' },
  { v: 'responses', label: 'Most responses' },
  { v: 'answered', label: 'Best answered %' },
  { v: 'name', label: 'Batch name' },
];

export default function Feedbacks() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const basePath = isAdmin ? '/admin' : '/trainer';

  const [params, setParams] = useSearchParams();
  const year = params.get('year') || '';
  const subject = params.get('subject') || '';
  const role = params.get('role') || '';

  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await AnalyticsAPI.sessions({
          ...(year ? { yearGroup: year } : {}),
          ...(subject ? { classId: subject } : {}),
          ...(role ? { role } : {}),
        });
        if (alive) setData(d);
      } catch (e) {
        if (alive) {
          toast.error(e.message);
          setData({ sessions: [], filters: { yearGroups: [], classes: [] } });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast, year, subject, role]);

  const setParam = (key, value) => {
    if (value) params.set(key, value);
    else params.delete(key);
    setParams(params, { replace: true });
  };

  const shown = useMemo(() => {
    const all = data?.sessions || [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? all.filter(
          (s) =>
            s.batchName.toLowerCase().includes(needle) ||
            s.className.toLowerCase().includes(needle) ||
            s.dept.toLowerCase().includes(needle) ||
            [...s.mainTrainerNames, ...s.supportTrainerNames]
              .join(' ')
              .toLowerCase()
              .includes(needle)
        )
      : all;

    const out = [...filtered];
    /* Unrated sessions sort LAST in every rating order rather than as zero —
       "no responses yet" is not "rated badly", and letting a null masquerade
       as 0.00 would put a brand-new batch at the bottom of a quality list. */
    const byRating = (dir) => (a, b) => {
      if (a.average == null && b.average == null) return a.batchName.localeCompare(b.batchName);
      if (a.average == null) return 1;
      if (b.average == null) return -1;
      return dir * (a.average - b.average);
    };
    if (sort === 'rating') out.sort(byRating(-1));
    else if (sort === 'lowest') out.sort(byRating(1));
    else if (sort === 'responses') out.sort((a, b) => b.responses - a.responses);
    else if (sort === 'answered')
      out.sort((a, b) => (b.responseRate ?? -1) - (a.responseRate ?? -1));
    else if (sort === 'name')
      out.sort(
        (a, b) => a.batchName.localeCompare(b.batchName) || a.className.localeCompare(b.className)
      );
    else
      out.sort(
        (a, b) => new Date(b.lastFeedbackAt || 0) - new Date(a.lastFeedbackAt || 0)
      );
    return out;
  }, [data, q, sort]);

  const totals = useMemo(() => {
    const all = data?.sessions || [];
    if (!all.length) return null;
    const rated = all.filter((s) => s.average != null);
    const responses = all.reduce((n, s) => n + s.responses, 0);
    return {
      sessions: all.length,
      batches: new Set(all.map((s) => s.batchId)).size,
      responses,
      // Weighted, so a 140-student batch counts more than a 60-student one.
      average: rated.length
        ? rated.reduce((n, s) => n + s.average * s.responses, 0) /
          (rated.reduce((n, s) => n + s.responses, 0) || 1)
        : null,
      open: all.filter((s) => s.status === 'open').length,
    };
  }, [data]);

  const filters = data?.filters || { yearGroups: [], classes: [] };
  const activeCount = [year, subject, role].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Feedback"
        title="Feedback by batch"
        subtitle={
          isAdmin
            ? 'Every batch and the subject it ran, with the mentors on it. Filter by year group to compare cohorts.'
            : 'Every batch you are staffed on. Filter by year group, or by whether you delivered or assisted.'
        }
      />

      {/* ── Totals for the current filter ───────────────────────────────── */}
      {totals && (
        <div className="panel divide-y divide-line sm:grid sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Fig label="Batches" value={totals.batches} icon="ticket" sub={`${totals.sessions} sessions`} />
          <Fig label="Collecting now" value={totals.open} icon="unlock" />
          <Fig label="Responses" value={totals.responses.toLocaleString()} icon="inbox" />
          <Fig
            label="Average"
            value={totals.average == null ? '—' : totals.average.toFixed(2)}
            icon="star"
            sub={totals.average == null ? 'no responses yet' : 'out of 5'}
          />
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="card p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-2.5 sm:gap-3">
          <div className="flex items-center gap-1.5 pb-2.5 text-sm font-semibold text-ink">
            <Icon name="filter" size={14} />
            Filters
            {activeCount > 0 && (
              <span className="tnum grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                {activeCount}
              </span>
            )}
            <InfoTooltip text="Year group and subject are applied on the server, so a mentor's own scoping always holds. Sorting and search are local to what you can already see." />
          </div>

          <Field label="Year group" id="fb-year">
            <select
              id="fb-year"
              className="input"
              value={year}
              onChange={(e) => setParam('year', e.target.value)}
            >
              <option value="">All years</option>
              {filters.yearGroups.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Subject" id="fb-subject">
            <select
              id="fb-subject"
              className="input"
              value={subject}
              onChange={(e) => setParam('subject', e.target.value)}
            >
              <option value="">All subjects</option>
              {filters.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Only a mentor holds two roles; for an admin this control would do
              nothing, so it is not rendered. */}
          {!isAdmin && (
            <Field label="My role" id="fb-role">
              <select
                id="fb-role"
                className="input"
                value={role}
                onChange={(e) => setParam('role', e.target.value)}
              >
                <option value="">Both roles</option>
                <option value="main">Delivered (main)</option>
                <option value="support">Assisted (support)</option>
              </select>
            </Field>
          )}

          <Field label="Sort" id="fb-sort">
            <select
              id="fb-sort"
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORTS.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="relative w-full min-w-0 flex-1 sm:w-auto sm:min-w-[200px]">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">
              <Icon name="search" size={15} />
            </span>
            <label htmlFor="fb-search" className="sr-only">
              Search batches
            </label>
            <input
              id="fb-search"
              className="input pl-10"
              placeholder="Batch, subject, department or mentor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {(activeCount > 0 || q) && (
            <button
              type="button"
              className="btn-ghost w-full !px-2.5 !py-2 text-xs sm:w-auto"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              <Icon name="x" size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Cards ───────────────────────────────────────────────────────── */}
      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} height={230} className="rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={data.sessions.length ? 'search' : 'inbox'}
            title={
              data.sessions.length
                ? 'Nothing matches those filters'
                : isAdmin
                  ? 'No batches yet'
                  : role === 'main'
                    ? 'You are not the main mentor on any batch'
                    : role === 'support'
                      ? 'You are not a support mentor on any batch'
                      : 'You are not staffed on any batch yet'
            }
            hint={
              data.sessions.length
                ? 'Try clearing the year group or subject.'
                : isAdmin
                  ? 'Create a batch, pick its subjects and assign mentors to each.'
                  : 'An admin assigns mentors when they create a batch.'
            }
            action={
              data.sessions.length ? (
                <button
                  className="btn-outline"
                  onClick={() => {
                    setQ('');
                    setParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  Clear filters
                </button>
              ) : isAdmin ? (
                <Link to="/admin/batches" className="btn-primary">
                  Go to Batches
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s, i) => (
              <SessionCard key={s.id} s={s} basePath={basePath} delay={i * 25} />
            ))}
          </div>
          <p className="text-center text-xs text-muted">
            <span className="tnum font-semibold text-ink">{shown.length}</span> of{' '}
            <span className="tnum">{data.sessions.length}</span> sessions
          </p>
        </>
      )}
    </div>
  );
}

/* ── One session ────────────────────────────────────────────────────────── */

function SessionCard({ s, basePath, delay }) {
  const rated = s.average != null;

  return (
    <Link
      to={`${basePath}/batch/${s.batchId}`}
      state={{ from: `${basePath}/feedbacks${window.location.search}` }}
      style={{ animationDelay: `${delay}ms` }}
      className="card animate-fade-up group flex flex-col overflow-hidden p-0 transition-shadow duration-200 hover:shadow-card-lg"
    >
      {/* shrink-0 so the strip keeps its exact height as the card grows — a
          flex child with only h-1 is compressible, which made the rule look
          thinner on taller cards. */}
      <span
        aria-hidden="true"
        className={`block h-1 w-full shrink-0 ${
          s.status === 'open' ? 'bg-emerald-500' : 'bg-line group-hover:bg-brand-500/40'
        }`}
      />

      <span className="flex flex-1 flex-col p-4">
        {/* Batch is the headline, subject the qualifier — you look for
            "Industry Readiness Batch - 3", not for the subject. */}
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{s.batchName}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="chip bg-surface-2 !py-0.5 text-[10px] font-semibold text-ink">
                {s.className}
              </span>
              <span className="text-[11px] text-muted">{s.yearGroup}</span>
            </span>
          </span>
          {s.status === 'open' ? (
            <span className="chip-open shrink-0 !py-0.5 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Live
            </span>
          ) : (
            <span className="chip bg-surface-2 shrink-0 !py-0.5 text-[10px] text-muted">Locked</span>
          )}
        </span>

        {s.dept && (
          <span className="mt-1.5 block truncate text-[11px] text-subtle">{s.dept}</span>
        )}

        {/* Who taught it. The reason a card exists per batch rather than per
            subject: these names differ between cohorts of the same subject. */}
        <span className="mt-2.5 block">
          <MentorRosterBadges
            mainTrainerNames={s.mainTrainerNames}
            supportTrainerNames={s.supportTrainerNames}
          />
        </span>

        {/* My role on this session, for a mentor. */}
        {s.myRoles?.length > 0 && (
          <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            You: {s.myRoles.map((r) => (r === 'main' ? 'main mentor' : 'support mentor')).join(' + ')}
          </span>
        )}

        <span className="mt-auto block border-t border-line pt-3">
          <span className="grid grid-cols-3 gap-2">
            <Stat
              value={rated ? s.average.toFixed(2) : '—'}
              label={rated ? '★ average' : 'no rating'}
              tone={rated ? (s.average >= 4 ? 'good' : s.average >= 3.5 ? 'warn' : 'bad') : 'muted'}
            />
            <Stat value={s.responses} label={s.responses === 1 ? 'response' : 'responses'} />
            <Stat
              value={s.responseRate == null ? '—' : `${s.responseRate}%`}
              label="answered"
              tone={
                s.responseRate == null
                  ? 'muted'
                  : s.responseRate >= 60
                    ? 'good'
                    : s.responseRate >= 30
                      ? 'warn'
                      : 'bad'
              }
            />
          </span>

          {/* The one insight that makes a card worth reading rather than
              just clicking through. */}
          {rated && s.weakest && s.strongest && (
            <span className="mt-2.5 block space-y-0.5 text-[11px]">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-muted">Best: {s.strongest.label}</span>
                <span className="tnum shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">
                  {s.strongest.average.toFixed(2)}
                </span>
              </span>
              {s.weakest.label !== s.strongest.label && (
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted">Weakest: {s.weakest.label}</span>
                  <span className="tnum shrink-0 font-semibold text-amber-700 dark:text-amber-400">
                    {s.weakest.average.toFixed(2)}
                  </span>
                </span>
              )}
            </span>
          )}

          <span className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-muted group-hover:text-ink">
            View feedback
            <Icon name="chevronRight" size={12} />
          </span>
        </span>
      </span>
    </Link>
  );
}

function Stat({ value, label, tone }) {
  const cls =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-rose-700 dark:text-rose-400'
          : tone === 'muted'
            ? 'text-subtle'
            : 'text-ink';
  return (
    <span className="block">
      <span className={`tnum block text-sm font-bold leading-tight ${cls}`}>{value}</span>
      <span className="block truncate text-[10px] text-muted">{label}</span>
    </span>
  );
}

function Field({ label, id, children }) {
  return (
    /* Full width on a phone: four 140px selects wrap into a ragged grid and
       each is an awkward tap target. From sm they sit in a row as before. */
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[150px]">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Fig({ label, value, sub, icon }) {
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="tnum mt-0.5 text-xl font-bold text-ink">{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-subtle">{sub}</p>}
      </div>
    </div>
  );
}
