import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Pick the MAIN and SUPPORT mentor rosters for one class in a batch.
 *
 * Both rosters are multi-select because that is what the training board
 * actually holds: "Coding" runs with Suneeta AND Abhishek delivering it while
 * Harika and Sampath assist. A single-select control could not express the
 * real schedule.
 *
 * The two lists are mutually exclusive. Rather than letting someone pick an
 * invalid pair and then rejecting it on save, a name already chosen as main is
 * disabled in the support list and vice versa, with the reason shown on hover —
 * the constraint is visible before it is violated.
 */
export default function MentorRosterPicker({
  trainers,
  mainTrainers = [],
  supportTrainers = [],
  onChange,
  disabled = false,
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trainers;
    return trainers.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.shortName || '').toLowerCase().includes(q) ||
        (t.email || '').toLowerCase().includes(q)
    );
  }, [trainers, query]);

  const toggle = (role, id) => {
    if (disabled) return;
    const other = role === 'main' ? supportTrainers : mainTrainers;
    if (other.includes(id)) return; // held by the other role
    const list = role === 'main' ? mainTrainers : supportTrainers;
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    onChange(
      role === 'main'
        ? { mainTrainers: next, supportTrainers }
        : { mainTrainers, supportTrainers: next }
    );
  };

  const nameOf = (id) => trainers.find((t) => t._id === id)?.name || 'Unknown';

  return (
    <div className="space-y-3">
      {trainers.length > 8 && (
        <label className="relative block">
          <span className="sr-only">Filter mentors</span>
          <Icon
            name="search"
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter mentors…"
            disabled={disabled}
            className="input !py-1.5 !pl-8 !text-xs"
          />
        </label>
      )}

      <Roster
        role="main"
        label="Main mentors"
        help="Deliver the class. At least one is required."
        icon="user-check"
        selected={mainTrainers}
        blocked={supportTrainers}
        blockedReason="already a support mentor for this class"
        trainers={filtered}
        onToggle={toggle}
        disabled={disabled}
        nameOf={nameOf}
        tone="brand"
      />

      <Roster
        role="support"
        label="Support mentors"
        help="Assist the session. Optional."
        icon="users"
        selected={supportTrainers}
        blocked={mainTrainers}
        blockedReason="already a main mentor for this class"
        trainers={filtered}
        onToggle={toggle}
        disabled={disabled}
        nameOf={nameOf}
        tone="violet"
      />

      {mainTrainers.length === 0 && !disabled && (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          <Icon name="alert" size={12} />
          Pick at least one main mentor — the class cannot be saved without one.
        </p>
      )}
    </div>
  );
}

function Roster({
  role, label, help, icon, selected, blocked, blockedReason,
  trainers, onToggle, disabled, nameOf, tone,
}) {
  const toneCls =
    tone === 'brand'
      ? 'bg-brand-600 text-white border-brand-600'
      : 'bg-violet-600 text-white border-violet-600';

  return (
    <fieldset className="rounded-xl border border-line p-2.5">
      <legend className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-muted">
        <Icon name={icon} size={12} />
        {label}
        {selected.length > 0 && (
          <span className="font-semibold normal-case tracking-normal text-subtle">
            · {selected.length}
          </span>
        )}
      </legend>
      <p className="mb-2 px-1 text-[11px] text-subtle">{help}</p>

      {/* Chosen names first, so the current state is readable without scanning
          the whole roster for highlighted rows. */}
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5 px-1">
          {selected.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onToggle(role, id)}
                disabled={disabled}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneCls} disabled:opacity-60`}
                title={`Remove ${nameOf(id)}`}
              >
                {nameOf(id)}
                {!disabled && <Icon name="x" size={10} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="max-h-40 overflow-y-auto px-1">
        {trainers.length === 0 ? (
          <p className="py-2 text-[11px] text-subtle">No mentors match that filter.</p>
        ) : (
          <ul className="space-y-0.5">
            {trainers.map((t) => {
              const on = selected.includes(t._id);
              const isBlocked = blocked.includes(t._id);
              return (
                <li key={t._id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs ${
                      isBlocked ? 'cursor-not-allowed opacity-45' : 'hover:bg-surface-2'
                    }`}
                    title={isBlocked ? `${t.name} is ${blockedReason}` : t.email}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled || isBlocked}
                      onChange={() => onToggle(role, t._id)}
                      className="h-3.5 w-3.5 shrink-0 accent-brand-600"
                    />
                    <span className="truncate font-medium text-ink">{t.name}</span>
                    {t.shortName && t.shortName !== t.name && (
                      <span className="shrink-0 text-[10px] text-subtle">({t.shortName})</span>
                    )}
                    {isBlocked && (
                      <span className="ml-auto shrink-0 text-[10px] font-semibold text-subtle">
                        {blockedReason.includes('main') ? 'main' : 'support'}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Read-only display of a class's mentor team. Used on batch cards and detail
 * pages, where the roster is information rather than an editable control.
 */
export function MentorRosterBadges({ mainTrainerNames = [], supportTrainerNames = [], compact = false }) {
  if (!mainTrainerNames.length && !supportTrainerNames.length) {
    return <span className="text-[11px] text-subtle">Unstaffed</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {mainTrainerNames.map((n) => (
        <span
          key={`m-${n}`}
          title={`${n} — main mentor (delivers the class)`}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
        >
          {!compact && <Icon name="user-check" size={9} />}
          {n}
        </span>
      ))}
      {supportTrainerNames.map((n) => (
        <span
          key={`s-${n}`}
          title={`${n} — support mentor (assists)`}
          className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
        >
          {!compact && <Icon name="users" size={9} />}
          {n}
        </span>
      ))}
    </span>
  );
}
