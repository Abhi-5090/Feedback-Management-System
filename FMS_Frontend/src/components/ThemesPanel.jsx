import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AnalyticsAPI } from '../api/endpoints.js';
import Card, { EmptyState } from './Card.jsx';
import { SkeletonRows } from './Spinner.jsx';
import Icon from './Icon.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

/**
 * What students actually keep writing about.
 *
 * A word cloud tells you what was mentioned; this pairs every term with the
 * average rating of the responses that mention it, which is what makes it
 * actionable — "pace · 23 mentions · 2.9" tells you what to fix, while "pace ·
 * 23 mentions" only tells you people talked about it.
 *
 * Two sections only: terms that show up alongside LOW ratings, and terms that
 * show up alongside HIGH ratings. A combined "most mentioned" list used to sit
 * below them, but it repeated the same terms — so clicking one opened two
 * copies of the same dropdown at once, and the section added no information
 * the two tone-split lists didn't already carry.
 *
 * Terms mentioned once are dropped server-side: a theme of one is an anecdote.
 */

/** Rows visible before the source list starts scrolling. */
const VISIBLE_SOURCES = 5;

/**
 * Chip appearance, by the rating a term travels with.
 *
 * Idle chips wear their own tone as a soft tint, so a glance across the row
 * still reads "these are the good ones / these are the sore points". The OPEN
 * chip inverts to a solid fill with white content — the dropdown below can be
 * long enough to push the chip row out of easy view, and a filled chip is the
 * one thing on screen that says which term you're looking at. A ring alone was
 * too quiet to answer that from across the card.
 *
 * The solid steps are 700 for emerald/amber (600 leaves white text under 4.5:1)
 * and 600 for rose, which already clears it.
 */
const CHIP_TONES = {
  high: {
    idle: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-emerald-500/20',
    active: 'bg-emerald-700 dark:bg-emerald-600 text-white ring-emerald-700 dark:ring-emerald-600',
  },
  mid: {
    idle: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 ring-amber-500/20',
    active: 'bg-amber-700 dark:bg-amber-600 text-white ring-amber-700 dark:ring-amber-600',
  },
  low: {
    idle: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 ring-rose-500/20',
    active: 'bg-rose-600 dark:bg-rose-500 text-white ring-rose-600 dark:ring-rose-500',
  },
};

/** A term's tone comes from the average rating of the comments mentioning it. */
const chipClass = (average, isOpen) => {
  const t = CHIP_TONES[average >= 4 ? 'high' : average >= 3 ? 'mid' : 'low'];
  return isOpen ? t.active : t.idle;
};

export default function ThemesPanel({ params = {}, title = 'What students keep mentioning' }) {
  const { user } = useAuth();
  const base = user?.role === 'admin' ? '/admin' : '/trainer';
  const reduce = useReducedMotion();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  /* Keyed by "section:term", not term alone. The two lists are mutually
     exclusive today, but keying by section means a term appearing in both
     could never again open two dropdowns from one click. */
  const [open, setOpen] = useState(null);

  // Serialised so a caller passing an inline object literal doesn't refetch
  // on every render.
  const key = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await AnalyticsAPI.themes(JSON.parse(key));
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const hasAny = data && (data.negative.length > 0 || data.positive.length > 0);

  return (
    <Card
      title={title}
      icon="message"
      hint="Recurring words in the comments, grouped by the ratings they appear alongside. Open one to see which batches mentioned it, then jump to those exact comments."
      subtitle={data ? `from ${data.analysed} ${data.analysed === 1 ? 'comment' : 'comments'}` : undefined}
    >
      {error ? (
        <EmptyState icon="alert" title="Couldn’t analyse comments" hint={error} />
      ) : !data ? (
        <SkeletonRows rows={4} />
      ) : !hasAny ? (
        <EmptyState
          icon="message"
          title="Not enough comments yet"
          hint="Themes appear once several students mention the same thing. A word used only once isn’t a theme."
        />
      ) : (
        <div className="space-y-5">
          {/* Praise first, then problems. */}
          <ThemeGroup
            id="high"
            label="Mentioned alongside high ratings"
            icon="trendUp"
            labelClass="text-emerald-600 dark:text-emerald-400"
            themes={data.positive}
            empty="No standout positives yet."
            open={open}
            setOpen={setOpen}
            base={base}
            reduce={reduce}
          />

          <ThemeGroup
            id="low"
            label="Mentioned alongside low ratings"
            icon="alert"
            labelClass="text-rose-600 dark:text-rose-400"
            themes={data.negative}
            empty="Nothing is clustering around low ratings — a good sign."
            open={open}
            setOpen={setOpen}
            base={base}
            reduce={reduce}
          />
        </div>
      )}
    </Card>
  );
}

/**
 * One tone-grouped list of theme chips, plus the inline dropdown for whichever
 * chip is open.
 *
 * The dropdown is INLINE — it pushes the content below it down rather than
 * floating over it. An absolutely-positioned menu inside a card gets clipped by
 * the card's own overflow and covers the group underneath; taking real space
 * keeps everything readable and means the list can scroll without fighting a
 * z-index stack.
 */
function ThemeGroup({ id, label, icon, labelClass, themes, empty, open, setOpen, base, reduce }) {
  const active = themes.find((t) => open === `${id}:${t.term}`);

  return (
    <div>
      <p className={`mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${labelClass}`}>
        <Icon name={icon} size={12} />
        {label}
      </p>

      {themes.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {themes.map((t) => {
              const isOpen = open === `${id}:${t.term}`;
              return (
                <li key={t.term}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : `${id}:${t.term}`)}
                    aria-expanded={isOpen}
                    /* Only colour/shadow transition — no `all`, and no layout
                       properties, so opening a chip can't reflow the row. */
                    className={`chip focus-ring ring-1 ring-inset transition-[color,background-color,box-shadow] duration-150 ${chipClass(
                      t.average,
                      isOpen
                    )} ${isOpen ? 'shadow-sm' : ''}`}
                  >
                    <span className="font-semibold">{t.term}</span>
                    <span className={`tnum ${isOpen ? 'text-white/75' : 'opacity-70'}`}>×{t.mentions}</span>
                    <span className="tnum font-bold">{t.average.toFixed(1)}</span>
                    <motion.span
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                      className="grid place-items-center"
                    >
                      <Icon name="chevronDown" size={11} />
                    </motion.span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* One dropdown per group, rendered under the chips it belongs to.

              The OUTER panel has a STABLE key, so switching from one chip to
              another never unmounts it — it stays open and simply resizes. It
              used to be keyed by term, which made every switch collapse the
              panel to zero and re-expand it: the list appeared to shoot up and
              drop back down. `layout` eases the height difference when the new
              term has a different number of batches.

              Only the INNER content is keyed by term, so the rows swap out and
              the new ones cascade in from the top. */}
          <AnimatePresence initial={false}>
            {active && (
              <motion.div
                key={`${id}-panel`}
                layout={!reduce}
                initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{
                  height: { duration: 0.28, ease: [0.23, 1, 0.32, 1] },
                  opacity: { duration: 0.18 },
                  layout: { duration: 0.26, ease: [0.23, 1, 0.32, 1] },
                }}
                className="overflow-hidden"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={active.term}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <SourceList
                      theme={active}
                      base={base}
                      reduce={reduce}
                      onClose={() => setOpen(null)}
                    />
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/**
 * The batches a theme came from. Each row links to that batch's comments,
 * pre-filtered to this exact word — the drill-down this panel exists for.
 *
 * Caps the visible rows and scrolls beyond that, so a term mentioned across
 * twenty cohorts can't push the rest of the dashboard off screen.
 */
function SourceList({ theme, base, onClose, reduce }) {
  const sources = theme.sources || [];
  const scrolls = sources.length > VISIBLE_SOURCES;

  return (
    <div className="mt-2.5 rounded-2xl border border-line bg-surface-2/50 p-2.5">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          “{theme.term}” mentioned in{' '}
          <span className="tnum text-ink">{sources.length}</span>{' '}
          {sources.length === 1 ? 'batch' : 'batches'}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close list"
          className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded-md text-subtle transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="x" size={11} />
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="px-1 pb-1 text-[11px] text-muted">No batch attribution available.</p>
      ) : (
        <ul
          /* Exactly five rows tall, then scroll. Fixed max-height rather than
             a count-based one so a long batch name that wraps can't make the
             list taller than intended. */
          className={`space-y-0.5 ${scrolls ? 'max-h-[14.5rem] overflow-y-auto pr-1' : ''}`}
        >
          {sources.map((s, i) => (
            /* Each row drops in just after the one above it, so switching
               terms reads as the list refilling from the top rather than a
               block of text being replaced. Capped so a long list still
               finishes quickly instead of trickling in. */
            <motion.li
              key={s.id}
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.22,
                ease: [0.23, 1, 0.32, 1],
                delay: reduce ? 0 : Math.min(i * 0.045, 0.32),
              }}
            >
              <Link
                to={`${base}/comments?term=${encodeURIComponent(theme.term)}&batchId=${s.batchId}&classId=${s.classId}`}
                className="focus-ring group flex items-center gap-2.5 rounded-xl bg-card px-2.5 py-2 text-xs ring-1 ring-inset ring-line transition-colors duration-150 hover:bg-surface-2"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                  <Icon name="ticket" size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{s.name}</span>
                  <span className="block truncate text-[10px] text-muted">{s.className}</span>
                </span>
                <span className="tnum shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted">
                  ×{s.count}
                </span>
                <Icon
                  name="chevronRight"
                  size={13}
                  className="shrink-0 text-subtle transition-transform duration-150 group-hover:translate-x-0.5"
                />
              </Link>
            </motion.li>
          ))}
        </ul>
      )}

      {scrolls && (
        <p className="px-1 pt-2 text-[10px] text-subtle">
          Showing {VISIBLE_SOURCES} of {sources.length} — scroll for more
        </p>
      )}
    </div>
  );
}
