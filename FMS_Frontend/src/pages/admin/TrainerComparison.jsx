import { useEffect, useState, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AnalyticsAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * Cross-trainer comparison — the question the dashboard raises but never
 * answered: how does each trainer compare on the same parameters?
 *
 * This is the most sensitive screen in the product, so it is built to be read
 * fairly rather than to produce a league table:
 *  - trainers with no responses are shown as "Not yet rated", never ranked last;
 *  - the per-parameter breakdown is always one click away, so a low overall
 *    score reads as "pace, specifically" rather than a verdict on a person;
 *  - the response count sits beside every average, because 4.2 from 40 people
 *    and 4.2 from 2 people are not the same claim.
 */

function tone(v) {
  if (v == null) return 'text-subtle';
  if (v >= 4) return 'text-emerald-600 dark:text-emerald-400';
  if (v >= 3) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}
function barColor(v) {
  if (v == null) return 'transparent';
  if (v >= 4) return '#10b981';
  if (v >= 3) return '#f59e0b';
  return '#ea5829';
}

export default function TrainerComparison() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showUnrated, setShowUnrated] = useState(false);
  /* Which role's feedback to rank on. This matters for fairness: blending a
     mentor's own teaching with sessions they merely assisted produces a
     ranking that penalises helpful people and flatters ones who never assist.
     Scoping is applied SERVER-side, so this refetches. */
  const [role, setRole] = useState('');
  const reduce = useReducedMotion();

  useEffect(() => {
    (async () => {
      setData(null);
      try {
        setData(await AnalyticsAPI.trainers(role ? { role } : {}));
      } catch (e) {
        toast.error(e.message);
        setData({ trainers: [], parameters: [] });
      }
    })();
  }, [toast, role]);

  const rated = useMemo(() => (data?.trainers || []).filter((t) => t.average != null), [data]);
  const unrated = useMemo(() => (data?.trainers || []).filter((t) => t.average == null), [data]);

  const summary = useMemo(() => {
    if (!rated.length) return null;
    const responses = rated.reduce((n, t) => n + t.responses, 0);
    const avg = rated.reduce((n, t) => n + t.average * t.responses, 0) / (responses || 1);
    return { avg, responses, best: rated[0], needs: rated[rated.length - 1] };
  }, [rated]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analytics"
        title="Mentor comparison"
        subtitle="Every mentor measured on the same parameters. Averages are weighted by response count, so a class of forty counts for more than a class of two, and attribution follows who actually taught each session rather than who owns the subject."
      />

      {/* Ranking on blended feedback is unfair in both directions: it charges a
          mentor for sessions someone else delivered, and rewards those who
          never assist. So the role being ranked is an explicit, visible
          choice rather than a hidden default. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Rank on
        </span>
        <div
          role="radiogroup"
          aria-label="Role to rank on"
          className="inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line"
        >
          {[
            { v: '', label: 'Both roles', title: 'All feedback from sessions each mentor was staffed on' },
            { v: 'main', label: 'As main mentor', title: 'Only sessions each mentor delivered — their own teaching record' },
            { v: 'support', label: 'As support mentor', title: 'Only sessions each mentor assisted on' },
          ].map((opt) => (
            <button
              key={opt.v || 'all'}
              type="button"
              role="radio"
              aria-checked={role === opt.v}
              title={opt.title}
              onClick={() => setRole(opt.v)}
              className={`focus-ring rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                role === opt.v ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {role && (
          <p className="text-xs text-muted">
            Showing only feedback from sessions each mentor{' '}
            {role === 'main' ? 'delivered' : 'assisted on'}.
          </p>
        )}
      </div>

      {summary && (
        <div className="panel animate-fade-up divide-y divide-line sm:grid sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Fig label="Rated mentors" value={rated.length} icon="users" />
          <Fig label="Total responses" value={summary.responses} icon="inbox" />
          <Fig label="Highest rated" value={summary.best.average.toFixed(2)} icon="trendUp" sub={summary.best.name} tone="emerald" />
          <Fig label="Needs support" value={summary.needs.average.toFixed(2)} icon="alert" sub={summary.needs.name} tone="amber" />
        </div>
      )}

      <Card
        title="Ranked by average rating"
        icon="barChart"
        hint="Weighted by number of responses. Open a row to see the same parameters broken out — a single weak dimension usually explains a low overall score."
        subtitle={data ? `${rated.length} rated · ${unrated.length} not yet rated` : undefined}
        bodyClass="p-0"
      >
        {!data ? (
          <div className="p-5"><SkeletonRows rows={6} /></div>
        ) : rated.length === 0 ? (
          <EmptyState
            icon="barChart"
            title="No rated trainers yet"
            hint="Once students submit feedback, every trainer appears here ranked on the same parameters."
          />
        ) : (
          <ul className="divide-y divide-line/60">
            {rated.map((t, i) => {
              const open = expanded === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : t.id)}
                    aria-expanded={open}
                    className={`focus-ring flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors duration-200 ${
                      open ? 'bg-surface-2/40' : 'hover:bg-surface-2/50'
                    }`}
                  >
                    <span
                      className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold transition-colors duration-200 ${
                        open
                          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                          : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {i + 1}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{t.name}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        <span className="tnum">{t.classes}</span> {t.classes === 1 ? 'class' : 'classes'} ·{' '}
                        <span className="tnum">{t.responses}</span> {t.responses === 1 ? 'response' : 'responses'}
                        {!t.isActive && <span className="ml-1.5 text-rose-500">· disabled</span>}
                      </span>
                    </span>

                    {/* Bar + number: the bar makes rows comparable at a glance,
                        the number keeps it precise. */}
                    <span className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:block">
                      <span
                        className="block h-full origin-left rounded-full transition-transform duration-500 ease-out-expo"
                        style={{ transform: `scaleX(${t.average / 5})`, width: '100%', backgroundColor: barColor(t.average) }}
                      />
                    </span>
                    <span className={`tnum w-12 shrink-0 text-right text-base font-bold ${tone(t.average)}`}>
                      {t.average.toFixed(2)}
                    </span>
                    <motion.span
                      className="shrink-0 text-subtle"
                      animate={{ rotate: open ? 180 : 0 }}
                      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <Icon name="chevronDown" size={16} />
                    </motion.span>
                  </button>

                  {/* The panel unrolls to its natural height, then each
                      parameter row cascades in and its bar draws from zero.
                      Sequencing matters: if the bars animated at the same time
                      as the height, they'd be growing inside a container that
                      is itself still growing, and the whole thing reads as
                      sliding rather than as measurements appearing. */}
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="detail"
                        initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                        exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{
                          height: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          // Fade in slightly behind the unroll, and out ahead of
                          // it, so the collapse never shows clipped content.
                          opacity: { duration: open ? 0.22 : 0.12, delay: open ? 0.06 : 0 },
                        }}
                        className="overflow-hidden border-t border-line bg-surface-2/30"
                      >
                        <div className="px-5 py-4">
                          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                            Average by parameter
                          </p>
                          <ul className="grid gap-2.5 sm:grid-cols-2">
                            {t.perParameter.map((p, pi) => (
                              <motion.li
                                key={p.label}
                                className="flex items-center gap-3"
                                initial={reduce ? false : { opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                  duration: 0.28,
                                  ease: [0.23, 1, 0.32, 1],
                                  // 35ms apart: enough to read as a cascade,
                                  // short enough that eight rows still land in
                                  // well under half a second.
                                  delay: reduce ? 0 : 0.1 + pi * 0.035,
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                                  {p.label}
                                </span>
                                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                                  <motion.span
                                    className="block h-full origin-left rounded-full"
                                    style={{ width: '100%', backgroundColor: barColor(p.average) }}
                                    initial={reduce ? false : { scaleX: 0 }}
                                    animate={{ scaleX: (p.average || 0) / 5 }}
                                    transition={{
                                      duration: 0.55,
                                      ease: [0.23, 1, 0.32, 1],
                                      delay: reduce ? 0 : 0.16 + pi * 0.035,
                                    }}
                                  />
                                </span>
                                <span
                                  className={`tnum w-9 text-right text-xs font-semibold ${tone(p.average)}`}
                                >
                                  {p.average == null ? '—' : p.average.toFixed(1)}
                                </span>
                              </motion.li>
                            ))}
                          </ul>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Unrated trainers, deliberately separate — absence of data is not a low score. */}
      {unrated.length > 0 && (
        <Card
          title="Not yet rated"
          icon="info"
          hint="These trainers have no responses yet. They are listed separately rather than ranked last, because no feedback is not the same as poor feedback."
          subtitle={`${unrated.length} ${unrated.length === 1 ? 'trainer' : 'trainers'}`}
          actions={
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setShowUnrated((s) => !s)}>
              {showUnrated ? 'Hide' : 'Show'}
            </button>
          }
        >
          {showUnrated && (
            <ul className="flex flex-wrap gap-2">
              {unrated.map((t) => (
                <li key={t.id} className="chip-neutral">
                  {t.name}
                  <span className="tnum text-subtle">
                    {t.classes} {t.classes === 1 ? 'class' : 'classes'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted">
        <span className="mt-0.5 shrink-0"><Icon name="info" size={13} /></span>
        Ratings reflect what students reported, not a performance review. Response counts vary
        widely between classes — read a score next to its sample size, and open a row before drawing
        a conclusion.{' '}
        <Link to="/admin/feedbacks" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Browse by class
        </Link>
      </p>
    </div>
  );
}

function Fig({ label, value, icon, sub, tone: t = 'brand' }) {
  const tones = {
    brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
    emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  };
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[t]}`}>
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="tnum text-display-sm leading-none text-ink">{value}</p>
        <p className="mt-1.5 truncate text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p>}
      </div>
    </div>
  );
}
