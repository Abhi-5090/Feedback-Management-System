import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
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
export default function AppShell({ brand, roleLabel, nav }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
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

  const SidebarInner = () => (
    <div className="flex h-full flex-col gap-7 p-4">
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 pt-1.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand">
          <Icon name="activity" size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink">
            {brand}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
            {roleLabel}
          </p>
        </div>
      </div>

      {/* Nav
          The active pill is ONE shared element (layoutId) rather than a class
          toggled per item, so switching tabs makes it travel to the new item
          instead of blinking out and in. That movement is the whole point: it
          shows the two tabs are positions in one list, which a cross-fade never
          communicates. It's a spring so an impatient double-click retargets
          mid-flight from wherever it is, rather than restarting. */}
      <nav className="flex flex-col gap-1.5" aria-label="Main">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `focus-ring group relative flex items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[15px] font-semibold transition-colors duration-200 ${
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
                    transition={
                      reduce
                        ? { duration: 0.01 }
                        : { type: 'spring', duration: 0.45, bounce: 0.2 }
                    }
                  />
                )}

                {/* Idle hover wash sits UNDER the pill so the two never fight */}
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

                {/* Chevron slides in on the active item — a small "you're here"
                    flourish that costs nothing when it isn't shown. */}
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

      {/* Account */}
      <div className="mt-auto space-y-2">
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
        <button
          onClick={doLogout}
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="logout" size={14} />
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop sidebar — a card-white panel in light, dark in dark, always
          separated from the workspace by a hairline rather than a gutter. */}
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-line bg-card lg:block">
        <SidebarInner />
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
              <SidebarInner />
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
          <div className="ml-auto flex items-center gap-1.5">
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
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
