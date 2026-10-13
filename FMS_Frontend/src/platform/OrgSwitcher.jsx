import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useOrgScope } from './OrgScope.jsx';
import Icon from '../components/Icon.jsx';

const ALL = '__all__';

const initials = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Which organization the super admin is acting on.
 *
 * A NATIVE <select> IS THE WRONG CONTROL HERE, even though it is the right one
 * for the phase filter beside it. Every figure on every screen below this means
 * something different depending on it, and a destructive action taken in the
 * wrong tenant is not recoverable by the person who took it. The control needs
 * to carry what a native option list cannot: which organization is live now,
 * which are suspended, and — once there are more than a handful — a way to find
 * one by typing. It is also the one control that must never be changed by
 * accident, which argues for a deliberate open-and-choose rather than a
 * scroll-wheel away from a different tenant.
 *
 * Built as a listbox rather than reached for from a library: it needs six
 * keyboard behaviours and a status badge, not a dependency.
 */
export default function OrgSwitcher() {
  const { isSuper, organizations, orgId, setOrg, loaded } = useOrgScope();
  const navigate = useNavigate();
  const location = useLocation();
  const reduce = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const buttonRef = useRef(null);
  const listId = useId();

  const items = useMemo(() => {
    const all = [{ id: ALL, name: 'All organizations', status: 'active', platform: true }, ...organizations];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) => o.name.toLowerCase().includes(q) || (o.slug || '').includes(q));
  }, [organizations, query]);

  const current = organizations.find((o) => o.id === orgId) || null;

  const choose = useCallback(
    (id) => {
      const next = id === ALL ? '' : id;
      setOrg(next);
      setOpen(false);
      setQuery('');
      buttonRef.current?.focus();
      /* Moving INTO a tenant means the admin screens; stepping back out means
         the platform screens. Without this, clearing the selection strands
         them on an admin page belonging to no organization, which the server
         correctly refuses to answer. */
      if (next && location.pathname.startsWith('/platform')) navigate('/admin');
      else if (!next && location.pathname.startsWith('/admin')) navigate('/platform');
    },
    [setOrg, navigate, location.pathname]
  );

  // Close on an outside click or Escape, the two ways people expect to dismiss.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, items.findIndex((o) => (orgId ? o.id === orgId : o.id === ALL))));
    // Focus the field only when it is actually shown, or the panel opens with
    // focus nowhere and the arrow keys do nothing.
    const t = setTimeout(() => searchRef.current?.focus(), 10);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold. Guarded
  // because scrollIntoView is absent in some environments (jsdom among them),
  // and a scrolling convenience must not be able to take down the control that
  // chooses which organization you are looking at.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) choose(items[active].id);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  if (!isSuper) return null;

  const label = current ? current.name : 'All organizations';
  const searchable = organizations.length > 6;

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!loaded}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Organization: ${label}`}
        className="focus-ring group flex h-9 min-w-0 max-w-[260px] items-center gap-2 rounded-full border border-line bg-card pl-1.5 pr-2.5 text-sm transition-[border-color,background-color,transform] duration-150 ease-out hover:border-brand-500/40 hover:bg-surface-2/60 active:scale-[0.98] disabled:opacity-60"
      >
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
            current
              ? 'bg-brand-500/14 text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-300'
              : 'bg-surface-2 text-muted'
          }`}
          aria-hidden="true"
        >
          {current ? initials(current.name) : <Icon name="building" size={13} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-semibold text-ink">{label}</span>
        {current?.status === 'suspended' && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        )}
        <Icon
          name="chevronDown"
          size={14}
          className={`shrink-0 text-muted transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            /* Scales from the top-left, where the trigger is, so it reads as
               coming OUT of the button rather than appearing over it. Starting
               at 0.96 rather than 0: nothing in the world appears from nothing. */
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -2 }}
            transition={{ duration: reduce ? 0.01 : 0.17, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: 'top left' }}
            className="absolute left-0 z-50 mt-1.5 w-[clamp(240px,80vw,320px)] overflow-hidden rounded-2xl border border-line bg-card shadow-pop"
          >
            {searchable && (
              <div className="border-b border-line p-2">
                <div className="relative">
                  <Icon
                    name="search"
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                  />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    placeholder="Find an organization…"
                    aria-label="Find an organization"
                    className="input !h-9 !py-1.5 !pl-8 text-sm"
                  />
                </div>
              </div>
            )}

            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Organization"
              tabIndex={-1}
              className="max-h-[320px] overflow-y-auto p-1.5"
            >
              {items.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted">
                  Nothing matches “{query}”.
                </li>
              )}

              {items.map((o, i) => {
                const selected = o.id === ALL ? !orgId : o.id === orgId;
                return (
                  <li key={o.id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-active={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(o.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-100 ${
                        i === active ? 'bg-surface-2' : ''
                      }`}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${
                          o.platform
                            ? 'bg-surface-2 text-muted'
                            : 'bg-brand-500/14 text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-300'
                        }`}
                        aria-hidden="true"
                      >
                        {o.platform ? <Icon name="dashboard" size={14} /> : initials(o.name)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{o.name}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {o.platform ? 'Platform overview' : o.slug}
                        </span>
                      </span>

                      {o.status === 'suspended' && (
                        <span className="shrink-0 rounded-md bg-amber-500/14 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          Suspended
                        </span>
                      )}
                      {selected && (
                        <Icon name="check" size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
