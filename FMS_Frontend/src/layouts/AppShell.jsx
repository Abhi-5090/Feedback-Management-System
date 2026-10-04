import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import PhaseFilter from '../phase/PhaseFilter.jsx';
import { usePhaseScope } from '../phase/PhaseScope.jsx';
import Icon from '../components/Icon.jsx';

/**
 * Shared responsive shell used by both the Admin and Trainer areas.
 * `nav` is [{to,label,icon,end,hint}].
 *
 * The sidebar follows the THEME rather than being permanently inked: in light
 * mode it is a white panel separated from the workspace by a hairline and a
 * one-step-darker background; in dark mode it darkens with everything else.
 * A permanently dark rail in a light UI reads as a stray artifact rather than
 * a deliberate frame, so the shell now sits flush — no inset, no rounding, no
 * dark gutter around the content.
 *
 * Motion budget: this chrome appears on every page view, so it gets almost
 * none — nav links are colour-only transitions and the active indicator does
 * not slide. The only real animation is the mobile drawer (occasional), on the
 * iOS drawer curve so it reads as being pulled rather than played.
 */
/* Routes whose content is feedback. Anything not listed shows no figures the
   phase could narrow, so the control is hidden there rather than offered and
   ignored. */
const FEEDBACK_ROUTES = [
  /^\/admin\/?$/, /^\/admin\/feedbacks/, /^\/admin\/compare/, /^\/admin\/cohorts/,
  /^\/admin\/classes/, /^\/admin\/class\//, /^\/admin\/batch\//, /^\/admin\/comments/,
  /^\/trainer\/?$/, /^\/trainer\/feedbacks/, /^\/trainer\/batches/,
  /^\/trainer\/class\//, /^\/trainer\/batch\//,
];


/**
 * The sidebar, at module level rather than inside AppShell.
 *
 * Declared inside the parent it was a NEW component type on every render, so
 * React unmounted and remounted the whole rail whenever anything in the shell
 * changed — a route change, the theme, the phase filter. That threw away the
 * active-pill's layout animation each time and would discard any state held
 * here, including the overflow check below.
 *
 * THE LAYOUT IS THREE ZONES, and the middle one is the only one that scrolls.
 * Previously the rail was a single flex column with no overflow handling at
 * all: twelve admin nav items, the brand block and the account card come to
 * more than a laptop viewport is tall, so the bottom of the column — the
 * account card and the log out button — was simply clipped away, with no
 * scrollbar to reach it because scrollbars are hidden globally. Log out was
 * unreachable on any short screen.
 *
 * Pinning the account zone with `shrink-0` fixes that independently of how
 * many nav items exist or how short the window is: the nav gives up height
 * instead, and log out is always on screen.
 */
export function Sidebar({ brand, roleLabel, nav, user, initials, reduce, onLogout }) {
  const scrollRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  /* Scrollbars are suppressed product-wide, so an overflowing nav gives the
     reader no hint that there is more below. A fade at the boundary puts that
     affordance back without reinstating a scrollbar. */
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, nav.length]);

  return (
    <div className="flex h-full flex-col">
      {/* Brand — pinned */}
      <div className="flex shrink-0 items-center gap-3 px-6 pb-4 pt-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand">
          <Icon name="activity" size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink">{brand}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
            {roleLabel}
          </p>
        </div>
      </div>

      {/* Nav — the only zone that scrolls. `min-h-0` is load-bearing: a flex
          child defaults to min-height:auto and will not shrink below its
          content, so overflow-y-auto alone would do nothing here. */}
      <div className="relative min-h-0 flex-1">
        <nav
          ref={scrollRef}
          className="flex h-full flex-col gap-1 overflow-y-auto overscroll-contain px-4 pb-3"
          aria-label="Main"
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `focus-ring group relative flex shrink-0 items-center gap-3.5 rounded-2xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors duration-200 ${
                  isActive ? 'text-white' : 'text-muted hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active-pill"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 shadow-brand"
                      transition={reduce ? { duration: 0.01 } : { type: 'spring', duration: 0.45, bounce: 0.2 }}
                    />
                  )}
                  {!isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-2xl bg-surface-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    />
                  )}
                  <motion.span
                    className="relative z-10 grid place-items-center"
                    animate={reduce ? {} : { scale: isActive ? 1.08 : 1 }}
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
                  >
                    <Icon name={n.icon} size={19} strokeWidth={isActive ? 2 : 1.7} />
                  </motion.span>
                  <span className="relative z-10 truncate">{n.label}</span>
                  {isActive && !reduce && (
                    <motion.span
                      className="relative z-10 ml-auto"
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 0.9, x: 0 }}
                      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1], delay: 0.08 }}
                    >
                      <Icon name="chevronRight" size={15} />
                    </motion.span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {overflowing && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent"
          />
        )}
      </div>

      {/* Account — pinned. The hairline is what tells the reader the list above
          it has run out rather than been cut off. The bottom padding clears the
          iOS home indicator, which otherwise sits on top of the button. */}
      <div className="shrink-0 border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface-2/60 p-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-500/20 dark:text-brand-300"
            aria-hidden="true"
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-ink">{user?.name}</p>
            <p className="truncate text-[11px] text-muted">{user?.email}</p>
          </div>
        </div>

        {/* Press feedback, because a control that ends the session should
            visibly acknowledge the press before the screen changes under it.
            Rose on hover only: leaving is not destructive, but it is not an
            ordinary navigation either, and it should not be clicked by accident
            while reaching for Settings directly above. */}
        <button
          onClick={onLogout}
          className="focus-ring mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px] font-semibold text-muted transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600 active:scale-[0.97] dark:hover:text-rose-400"
        >
          <Icon name="logout" size={15} />
          Log out
        </button>
      </div>
    </div>
  );
}

export default function AppShell({ brand, roleLabel, nav }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const showsFeedback = FEEDBACK_ROUTES.some((re) => re.test(location.pathname));
  const { phase } = usePhaseScope();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = (user?.name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sidebarProps = { brand, roleLabel, nav, user, initials, reduce, onLogout: doLogout };

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop sidebar — a card-white panel in light, dark in dark, always
          separated from the workspace by a hairline rather than a gutter. */}
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-line bg-card lg:block">
        <Sidebar {...sidebarProps} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              className="fixed inset-y-0 left-0 z-50 w-[264px] border-r border-line bg-card shadow-pop lg:hidden"
              initial={{ transform: 'translateX(-100%)' }}
              animate={{ transform: 'translateX(0%)' }}
              exit={{ transform: 'translateX(-100%)' }}
              transition={reduce ? { duration: 0.01 } : { duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
            >
              <Sidebar {...sidebarProps} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Content — flush to the viewport, no inset frame */}
      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/85 px-4 py-3.5 backdrop-blur supports-[backdrop-filter]:bg-surface/75 sm:px-6">
          <button
            onClick={() => setOpen(true)}
            className="btn-ghost !px-2.5 !py-2 lg:hidden"
            aria-label="Open navigation menu"
            aria-expanded={open}
          >
            <Icon name="menu" size={18} />
          </button>
          <p className="hidden text-sm font-medium text-muted lg:block">{roleLabel} workspace</p>

          {/* The phase filter lives here, and only here: one control in one
              place, in the same spot on every screen, because the thing it
              changes — which collection exercise you are reading — applies to
              the whole workspace rather than to one panel on one page.

              Hidden on routes that show no feedback (Settings, Parameters, the
              mentor roster, the audit trail). A filter that cannot affect
              anything on screen is noise, and worse, it implies the page IS
              filtered when it is not. */}
          {showsFeedback && (
            <div className="ml-auto mr-1 min-w-0">
              <PhaseFilter showUnassigned={roleLabel === 'Admin'} />
            </div>
          )}

          <div className={`${showsFeedback ? '' : 'ml-auto'} flex items-center gap-1.5`}>
            <button
              onClick={toggle}
              className="btn-ghost !px-2.5 !py-2"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
          </div>
        </header>

        {/* Route transition. Short (220ms) and travel-light (8px) on purpose:
            this fires on every navigation, so anything longer would read as
            latency rather than polish. Keyed on pathname so each page animates
            in as a distinct thing. */}
        <main className="mx-auto max-w-7xl p-4 sm:p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            >
              {/* Keyed on the phase, so changing it REMOUNTS the current page
                  and its fetches run again with the new scope.

                  The alternative is adding `phase` to the dependency array of
                  every data effect on every page — a dozen of them — where
                  missing one fails silently: that page keeps showing every
                  phase while the filter says otherwise, and two screens
                  disagree without either admitting it. Remounting costs a
                  re-render and resets page-local state like pagination, which
                  is the correct behaviour anyway: the dataset underneath has
                  changed. */}
              <Outlet key={phase} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
