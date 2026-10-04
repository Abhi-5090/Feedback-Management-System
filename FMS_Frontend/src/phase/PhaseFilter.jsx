import { useId } from 'react';
import Icon from '../components/Icon.jsx';
import { usePhaseScope, ALL, UNASSIGNED } from './PhaseScope.jsx';

const monthLabel = (d) =>
  new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The phase selector, shown wherever feedback is.
 *
 * ONE control in ONE place, not a copy per page. It sits in the workspace top
 * bar so it is in the same spot on every screen, and because the thing it
 * changes — which collection exercise you are reading — applies to the whole
 * workspace rather than to one panel on one page.
 *
 * The first option is ALWAYS "All phases". A dashboard that opens pre-filtered
 * to the newest phase is a dashboard that lies by omission to anyone who does
 * not notice the filter, and the figure people quote is the one they saw first.
 *
 * It is a native <select>: the list is short, the OS dropdown is correct on
 * touch, and it is keyboard- and screen-reader-correct for free.
 */
export default function PhaseFilter({ showUnassigned = false, className = '' }) {
  const { phase, setPhase, phases, loaded } = usePhaseScope();
  const id = useId();

  // Nothing to choose between until a phase exists.
  if (loaded && phases.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label
        htmlFor={id}
        className="hidden shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted sm:flex"
      >
        <Icon name="calendar" size={13} />
        Phase
      </label>
      <select
        id={id}
        className="input !h-9 w-auto max-w-[15rem] !py-1.5 text-xs"
        value={phase}
        onChange={(e) => setPhase(e.target.value)}
        aria-label="Filter by collection phase"
      >
        <option value={ALL}>All phases</option>
        {phases.map((p) => (
          <option key={p._id} value={p._id}>
            {p.name}
            {p.collecting ? ' · collecting' : ''}
          </option>
        ))}
        {/* Admin only: a mentor has no view of feedback outside their own
            sessions, so "unassigned across the institution" means nothing to
            them and the figures behind it are not theirs to see. */}
        {showUnassigned && <option value={UNASSIGNED}>Unassigned</option>}
      </select>
    </div>
  );
}

/**
 * A quiet line stating what is on screen, for pages whose numbers would
 * otherwise be ambiguous once the top-bar filter scrolls out of view.
 */
export function PhaseScopeNote({ className = '' }) {
  const { isAll, active, phase } = usePhaseScope();
  if (isAll) return null;
  const text =
    phase === UNASSIGNED
      ? 'Showing only feedback that belongs to no phase.'
      : active
        ? `Showing ${active.name} only — ${monthLabel(active.startsAt)}.`
        : null;
  if (!text) return null;
  return (
    <p className={`flex items-center gap-1.5 text-xs text-muted ${className}`}>
      <Icon name="filter" size={12} className="shrink-0" />
      {text}
    </p>
  );
}
