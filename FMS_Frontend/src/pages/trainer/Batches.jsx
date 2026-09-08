import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnalyticsAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { EmptyState } from '../../components/Card.jsx';
import { SkeletonBlock } from '../../components/Spinner.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * "My batches" for a trainer — the cohorts they teach in, as cards. Each card
 * links to that batch's feedback (scoped to the trainer's own classes). This is
 * the trainer's read-only counterpart to the admin Batches page: no passcode or
 * lifecycle controls, just their view of what's being collected.
 */
function tone(v) {
  if (!v) return { text: 'text-muted', bg: 'bg-surface-2', ring: 'ring-line' };
  if (v >= 4) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' };
  if (v >= 3) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/20' };
  return { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/20' };
}

function timeAgo(d) {
  if (!d) return null;
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

function BatchCard({ b }) {
  const t = tone(b.average);
  const hasData = b.responses > 0;
  const isOpen = b.status === 'open';
  const pct = b.expectedCount > 0 ? Math.min(100, Math.round((b.submittedCount / b.expectedCount) * 100)) : 0;

  return (
    <article className="card lift group flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">{b.name}</h3>
            <span className={isOpen ? 'chip-open' : 'chip-locked'}>
              <Icon name={isOpen ? 'unlock' : 'lock'} size={11} strokeWidth={1.8} />
              {isOpen ? 'Open' : 'Locked'}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap gap-1">
            {b.classes.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink"
              >
                {c.name}
              </span>
            ))}
          </p>
        </div>
        <div className={`shrink-0 rounded-2xl px-3 py-2 text-center ring-1 ring-inset ${t.bg} ${t.ring}`}>
          <p className={`tnum text-xl font-bold leading-none ${t.text}`}>{hasData ? b.average.toFixed(2) : '—'}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">of 5</p>
        </div>
      </div>

      {/* Live progress toward the expected head-count */}
      <div className="px-5">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted">
            <span className="tnum font-semibold text-ink">{b.submittedCount}</span>
            <span className="text-muted"> / {b.expectedCount || '∞'}</span> responses
          </span>
          <span className="tnum text-muted">{b.expectedCount ? `${pct}%` : ''}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full origin-left rounded-full transition-transform duration-500 ease-out-expo ${
              isOpen ? 'bg-brand-500' : 'bg-subtle'
            }`}
            style={{ transform: `scaleX(${pct / 100})`, width: '100%' }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 px-5">
        <Fact icon="book" label="My classes" value={b.classCount} />
        <Fact icon="inbox" label="My responses" value={b.responses} />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
        <span className="text-[11px] text-subtle">
          {b.lastFeedbackAt ? `Last response ${timeAgo(b.lastFeedbackAt)}` : 'Awaiting responses'}
        </span>
        <Link
          to={`/trainer/batch/${b.id}`}
          state={{ from: '/trainer/batches' }}
          className="btn-primary !px-3.5 !py-1.5 text-xs"
          aria-label={`View feedback for ${b.name}`}
        >
          View feedback
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

function Fact({ icon, label, value }) {
  return (
    <div className="rounded-xl bg-surface-2/60 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <Icon name={icon} size={11} />
        {label}
      </p>
      <p className="tnum mt-0.5 text-base font-bold text-ink">{value}</p>
    </div>
  );
}

export default function TrainerBatches() {
  const toast = useToast();
  const [batches, setBatches] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setBatches(await AnalyticsAPI.trainerBatches());
      } catch (e) {
        toast.error(e.message);
        setBatches([]);
      }
    })();
  }, [toast]);

  const shown = useMemo(() => {
    if (!batches) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return batches;
    return batches.filter(
      (b) =>
        b.name.toLowerCase().includes(needle) ||
        b.classes.some((c) => c.name.toLowerCase().includes(needle))
    );
  }, [batches, q]);

  const openCount = batches?.filter((b) => b.status === 'open').length || 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Collection"
        title="My batches"
        subtitle="The cohorts you teach in. Open one to see the feedback for your classes in that batch."
      />

      {batches?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">
              <Icon name="search" size={15} />
            </span>
            <label htmlFor="tb-search" className="sr-only">Search batches</label>
            <input
              id="tb-search"
              className="input pl-10"
              placeholder="Search batch or class…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="ml-auto text-xs text-muted">
            <span className="tnum font-semibold text-ink">{shown.length}</span>{' '}
            {shown.length === 1 ? 'batch' : 'batches'}
            {openCount > 0 && <> · <span className="tnum font-semibold text-emerald-600 dark:text-emerald-400">{openCount}</span> open</>}
          </span>
        </div>
      )}

      {!batches ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} height={240} className="rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={batches.length ? 'search' : 'ticket'}
            title={batches.length ? 'No batches match that search' : 'No batches yet'}
            hint={
              batches.length
                ? 'Try a different name, or clear the search.'
                : 'You are not teaching in any batch yet. Your admin adds you to batches when they create them.'
            }
            action={
              batches.length ? (
                <button className="btn-outline" onClick={() => setQ('')}>Clear search</button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((b) => (
            <BatchCard key={b.id} b={b} />
          ))}
        </div>
      )}
    </div>
  );
}
