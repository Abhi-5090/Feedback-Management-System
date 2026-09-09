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

  /* One card per BATCH, not per (batch, subject).
     The session grain is right for the data and wrong for this page: a batch
     running Coding and GenAI produced two cards with the same title, differing
     only by a chip, so "AI Ready 2028 · Batch-2" appeared twice and neither
     card described the cohort. The per-subject split belongs INSIDE the batch,
     which is what "Feedback by class" on the batch page already does.

     Aggregated on the client because the session list already carries
     everything needed and is already correctly scoped — a mentor's sessions are
     only their own, so the batch card built from them is too. */
  const batches = useMemo(() => {
    const all = data?.sessions || [];
    const byBatch = new Map();

    for (const s of all) {
      if (!byBatch.has(s.batchId)) {
        byBatch.set(s.batchId, {
          batchId: s.batchId,
          batchName: s.batchName,
          yearGroup: s.yearGroup,
          dept: s.dept,
          status: s.status,
          round: s.round,
          expectedCount: s.expectedCount,
          subjects: [],
          mentors: new Set(),
          myRoles: new Set(),
          responses: 0,
          starSum: 0,
          starWeight: 0,
          lastFeedbackAt: null,
          openSessions: 0,
        });
      }
      const b = byBatch.get(s.batchId);
      b.subjects.push({
        classId: s.classId,
        name: s.className,
        responses: s.responses,
        average: s.average,
        mainTrainerNames: s.mainTrainerNames,
        supportTrainerNames: s.supportTrainerNames,
      });
      for (const n of [...s.mainTrainerNames, ...s.supportTrainerNames]) b.mentors.add(n);
      for (const r of s.myRoles || []) b.myRoles.add(r);
      /* Students who answered is the MAX across the batch's subjects, not the
         sum: one submission writes a row per subject, so summing would report
         a two-subject cohort as having answered twice. */
      b.responses = Math.max(b.responses, s.responses);
      if (s.average != null && s.responses) {
        b.starSum += s.average * s.responses;
        b.starWeight += s.responses;
      }
      if (s.lastFeedbackAt && (!b.lastFeedbackAt || s.lastFeedbackAt > b.lastFeedbackAt)) {
        b.lastFeedbackAt = s.lastFeedbackAt;
      }
      if (s.status === 'open') b.openSessions += 1;
    }

    return [...byBatch.values()].map((b) => ({
      ...b,
      mentors: [...b.mentors],
      myRoles: [...b.myRoles],
      subjects: b.subjects.sort((x, y) => x.name.localeCompare(y.name)),
      average: b.starWeight ? Math.round((b.starSum / b.starWeight) * 100) / 100 : null,
      responseRate:
        b.expectedCount > 0
          ? Math.round((b.responses / b.expectedCount) * 1000) / 10
          : null,
    }));
  }, [data]);

  const shown = useMemo(() => {
    const all = batches;
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? all.filter(
          (b) =>
            b.batchName.toLowerCase().includes(needle) ||
            b.yearGroup.toLowerCase().includes(needle) ||
            b.dept.toLowerCase().includes(needle) ||
            b.subjects.map((x) => x.name).join(' ').toLowerCase().includes(needle) ||
            b.mentors.join(' ').toLowerCase().includes(needle)
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
  }, [batches, q, sort]);

  const totals = useMemo(() => {
    if (!batches.length) return null;
    const rated = batches.filter((b) => b.average != null);
    return {
      sessions: (data?.sessions || []).length,
      batches: batches.length,
      responses: batches.reduce((n, b) => n + b.responses, 0),
      // Weighted, so a 140-student batch counts more than a 60-student one.
      average: rated.length
        ? rated.reduce((n, b) => n + b.average * b.responses, 0) /
          (rated.reduce((n, b) => n + b.responses, 0) || 1)
        : null,
      open: batches.filter((b) => b.status === 'open').length,
    };
  }, [batches, data]);

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
          <Fig label="Batches" value={totals.batches} icon="ticket" sub={`${totals.sessions} subject sessions`} />
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
            {shown.map((b, i) => (
              <BatchCard key={b.batchId} b={b} basePath={basePath} delay={i * 25} />
            ))}
          </div>
          <p className="text-center text-xs text-muted">
            <span className="tnum font-semibold text-ink">{shown.length}</span> of{' '}
            <span className="tnum">{batches.length}</span>{' '}
            {batches.length === 1 ? 'batch' : 'batches'}
            {totals?.sessions ? ` · ${totals.sessions} subject sessions` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/* ── One session ────────────────────────────────────────────────────────── */

/**
 * One card per BATCH, naming the subjects it ran.
 *
 * The batch is the headline because that is what people look for — "Industry
 * Readiness Batch - 3", never "the GenAI one". The subjects appear as a list
 * inside it, each with its own rating, which is the information the two
 * separate cards used to carry without ever saying they belonged together.
 * Opening the card goes to the batch page, where "Feedback by class" breaks
 * each subject out in full.
 */
function BatchCard({ b, basePath, delay }) {
  const rated = b.average != null;

  return (
    <Link
      to={`${basePath}/batch/${b.batchId}`}
      state={{ from: `${basePath}/feedbacks${window.location.search}` }}
      style={{ animationDelay: `${delay}ms` }}
      className="card animate-fade-up group flex flex-col overflow-hidden p-0 transition-shadow duration-200 hover:shadow-card-lg"
    >
      <span
        aria-hidden="true"
        className={`block h-1 w-full shrink-0 ${
          b.status === 'open' ? 'bg-emerald-500' : 'bg-line group-hover:bg-brand-500/40'
        }`}
      />

      <span className="flex flex-1 flex-col p-4">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{b.batchName}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {b.yearGroup}
              {b.dept ? ` · ${b.dept}` : ''}
            </span>
          </span>
          {b.status === 'open' ? (
            <span className="chip-open shrink-0 !py-0.5 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Live
            </span>
          ) : (
            <span className="chip bg-surface-2 shrink-0 !py-0.5 text-[10px] text-muted">Locked</span>
          )}
        </span>

        {/* The subjects, each with its own rating. This is why one card per
            batch loses nothing: the per-subject figures are right here. */}
        <span className="mt-3 block space-y-1">
          {b.subjects.map((sub) => (
            <span key={sub.classId} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="chip bg-surface-2 !py-0.5 text-[10px] font-semibold text-ink">
                  {sub.name}
                </span>
              </span>
              <span className="shrink-0 tnum text-muted">
                {sub.average != null ? (
                  <>
                    <span className="font-semibold text-ink">{sub.average.toFixed(2)}</span>★
                    <span className="text-subtle"> · {sub.responses}</span>
                  </>
                ) : (
                  <span className="text-subtle">no responses</span>
                )}
              </span>
            </span>
          ))}
        </span>

        {/* Mentors across the whole batch, de-duplicated. Naming them per
            subject here would repeat the same two or three names three times. */}
        {b.mentors.length > 0 && (
          <span className="mt-2.5 block truncate text-[11px] text-muted">
            <Icon name="users" size={11} className="mr-1 inline align-[-1px]" />
            {b.mentors.slice(0, 3).join(', ')}
            {b.mentors.length > 3 ? ` +${b.mentors.length - 3}` : ''}
          </span>
        )}

        {b.myRoles?.length > 0 && (
          <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            You: {b.myRoles.map((r) => (r === 'main' ? 'main mentor' : 'support mentor')).join(' + ')}
          </span>
        )}

        <span className="mt-auto block border-t border-line pt-3">
          <span className="grid grid-cols-3 gap-2">
            <Stat
              value={rated ? b.average.toFixed(2) : '—'}
              label={rated ? '★ average' : 'no rating'}
              tone={rated ? (b.average >= 4 ? 'good' : b.average >= 3.5 ? 'warn' : 'bad') : 'muted'}
            />
            <Stat
              value={b.responses}
              label={b.responses === 1 ? 'student' : 'students'}
            />
            <Stat
              value={b.responseRate == null ? '—' : `${b.responseRate}%`}
              label="answered"
              tone={
                b.responseRate == null
                  ? 'muted'
                  : b.responseRate >= 60
                    ? 'good'
                    : b.responseRate >= 30
                      ? 'warn'
                      : 'bad'
              }
            />
          </span>

          <span className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-muted group-hover:text-ink">
            View feedback by class
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
