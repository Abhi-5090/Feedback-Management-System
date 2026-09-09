import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';

/**
 * The year-group cards that open the catalog.
 *
 * WHY YEARS AND NOT SUBJECTS. There are seven subjects but four distinct
 * student populations, and a subject on its own is not something anyone asks
 * about — "how is C Programming doing?" only means anything once you say which
 * year, because it runs as four separate first-year batches with different
 * mentors. Starting from the year group matches how the timetable is actually
 * organised, and puts the batches one click away instead of behind a subject
 * that spans cohorts.
 *
 * Deliberately NO mentor on these cards. Mentors are assigned per BATCH, not
 * per subject — the same subject runs with different teams for different
 * cohorts — so naming one here would be a fiction the batch rosters contradict.
 */
export default function YearCards({ years, selected, onSelect, basePath }) {
  if (!years?.length) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {years.map((y, i) => (
        <YearCard
          key={y.yearGroup}
          y={y}
          active={selected === y.yearGroup}
          onSelect={onSelect}
          basePath={basePath}
          delay={i * 40}
        />
      ))}
    </div>
  );
}

function YearCard({ y, active, onSelect, basePath, delay }) {
  const hasFeedback = y.responses > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(active ? null : y.yearGroup)}
      aria-pressed={active}
      style={{ animationDelay: `${delay}ms` }}
      /* flex flex-col, not the default button layout: a <button> does not
         reliably stretch its children to full width or pin them to the top —
         browsers lay button content out in their own anonymous box and some
         centre it — which left the accent strip sitting slightly differently
         on each card. A flex column makes the strip the first row at full
         width on every card, in every browser.

         ring-INSET matters just as much: a normal ring is painted OUTSIDE the
         border box, so the selected card grew 2px on every side while its
         neighbours did not, and its strip visibly shifted out of line with
         theirs. Inset keeps every card exactly the same size. */
      className={`card animate-fade-up group relative flex flex-col overflow-hidden p-0 text-left transition-shadow duration-200 hover:shadow-card-lg ${
        active ? 'ring-2 ring-inset ring-brand-500' : ''
      }`}
    >
      {/* The accent rule. shrink-0 so it keeps its exact height when the card
          below it grows; a flex child with h-1 would otherwise be compressible. */}
      <span
        aria-hidden="true"
        className={`block h-1 w-full shrink-0 ${
          active ? 'bg-brand-600' : 'bg-line group-hover:bg-brand-500/40'
        }`}
      />

      {/* flex-1 so every card's body fills the same height — the grid stretches
          the cards to match the tallest, and without this the content stopped
          short and the footer floated. */}
      <span className="flex flex-1 flex-col p-4">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-base font-bold text-ink">{y.yearGroup}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {y.subjects.join(' · ')}
            </span>
          </span>
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              y.openBatches
                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                : 'bg-surface-2 text-subtle'
            }`}
          >
            <Icon name="graduation" size={17} />
          </span>
        </span>

        {/* The two figures an admin actually wants off a year card. */}
        <span className="mt-3.5 grid grid-cols-2 gap-2">
          <Metric
            value={y.batchCount}
            label={y.batchCount === 1 ? 'batch' : 'batches'}
            note={y.openBatches ? `${y.openBatches} collecting` : 'none open'}
            noteTone={y.openBatches ? 'good' : 'muted'}
          />
          <Metric
            value={y.students.toLocaleString()}
            label="students"
            note={`${y.classCount} subject${y.classCount === 1 ? '' : 's'}`}
          />
        </span>

        {/* Feedback state. "No feedback yet" rather than 0.00 — an unrated
            cohort is not a zero-rated one. mt-auto pins this block to the
            bottom so the figure sits on the same line across all four cards
            even when their subject lists wrap to different heights. */}
        <span className="mt-auto block border-t border-line pt-3">
          {hasFeedback ? (
            <span className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">
                <span className="tnum font-bold text-ink">{y.average.toFixed(2)}</span> ★ average
              </span>
              <span className="tnum text-muted">
                {y.responses.toLocaleString()} response{y.responses === 1 ? '' : 's'}
              </span>
            </span>
          ) : (
            <span className="text-xs text-subtle">No feedback collected yet</span>
          )}

          {y.responseRate != null && (
            <span className="mt-2 block">
              <span className="flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <span
                    className={`block h-full rounded-full ${
                      y.responseRate >= 60
                        ? 'bg-emerald-500'
                        : y.responseRate >= 30
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(100, y.responseRate)}%` }}
                  />
                </span>
                <span className="tnum text-[11px] font-semibold text-muted">
                  {y.responseRate}%
                </span>
              </span>
              <span className="mt-1 block text-[10px] text-subtle">
                {y.submitted.toLocaleString()} of {y.students.toLocaleString()} students answered
              </span>
            </span>
          )}
        </span>

        <span
          className={`mt-3 flex items-center gap-1 text-[11px] font-semibold ${
            active ? 'text-brand-700 dark:text-brand-300' : 'text-muted group-hover:text-ink'
          }`}
        >
          {active ? 'Showing batches below' : `View ${y.batchCount} batches`}
          <Icon name={active ? 'check' : 'chevronRight'} size={12} />
        </span>
      </span>
    </button>
  );
}

function Metric({ value, label, note, noteTone }) {
  return (
    <span className="block rounded-xl bg-surface-2/60 px-2.5 py-2">
      <span className="tnum block text-lg font-bold leading-tight text-ink">{value}</span>
      <span className="block text-[11px] text-muted">{label}</span>
      {note && (
        <span
          className={`mt-0.5 block text-[10px] ${
            noteTone === 'good'
              ? 'font-semibold text-emerald-700 dark:text-emerald-400'
              : 'text-subtle'
          }`}
        >
          {note}
        </span>
      )}
    </span>
  );
}

/**
 * Totals across every year group, for the strip above the cards.
 * Students are summed from the year cards, which already de-duplicate a
 * cohort that takes several subjects.
 */
export function YearTotals({ years }) {
  if (!years?.length) return null;
  const t = years.reduce(
    (acc, y) => ({
      batches: acc.batches + y.batchCount,
      open: acc.open + y.openBatches,
      students: acc.students + y.students,
      responses: acc.responses + y.responses,
      submitted: acc.submitted + y.submitted,
    }),
    { batches: 0, open: 0, students: 0, responses: 0, submitted: 0 }
  );
  const rate = t.students ? Math.round((t.submitted / t.students) * 1000) / 10 : null;

  return (
    <div className="panel divide-y divide-line sm:grid sm:grid-cols-4 sm:divide-x sm:divide-y-0">
      <Fig label="Year groups" value={years.length} icon="graduation" />
      <Fig label="Batches" value={t.batches} icon="ticket" sub={t.open ? `${t.open} collecting` : 'none open'} />
      <Fig label="Students" value={t.students.toLocaleString()} icon="users" />
      <Fig
        label="Answered"
        value={rate == null ? '—' : `${rate}%`}
        icon="inbox"
        sub={`${t.submitted.toLocaleString()} of ${t.students.toLocaleString()}`}
      />
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
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
          {label === 'Students' && (
            <InfoTooltip text="Expected cohort size across every batch in the year, taken from the count set when each batch is unlocked. A cohort taking several subjects is counted once." />
          )}
        </p>
        <p className="tnum mt-0.5 text-xl font-bold text-ink">{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-subtle">{sub}</p>}
      </div>
    </div>
  );
}
