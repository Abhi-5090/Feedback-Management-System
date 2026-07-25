import {
  createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, forwardRef,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon.jsx';

const ToastContext = createContext(null);
let idc = 0;

/**
 * Toasts.
 *
 * Spatial consistency: they enter from the bottom-right and exit to the RIGHT,
 * which is also the swipe-to-dismiss direction. Because the exit matches the
 * gesture, flicking one away feels like it obeyed you rather than like the app
 * played an unrelated animation.
 *
 * Edge cases handled invisibly (the user should never notice these):
 *  - the auto-dismiss timer PAUSES while the tab is hidden, so a toast fired
 *    just before you switched tabs is still there when you come back;
 *  - the timer pauses on hover, so a message can't expire while being read;
 *  - a quick flick dismisses on VELOCITY, not distance — you shouldn't have to
 *    drag the full width to get rid of it.
 */

const TONES = {
  success: {
    ring: 'ring-emerald-500/25',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  error: {
    ring: 'ring-rose-500/25',
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    icon: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  },
  info: {
    ring: 'ring-brand-500/25',
    bg: 'bg-brand-50 dark:bg-brand-500/10',
    icon: 'bg-brand-500/15 text-brand-600 dark:text-brand-400',
  },
};

const Glyph = ({ type }) => (
  <Icon
    name={type === 'success' ? 'check' : type === 'error' ? 'x' : 'info'}
    size={13}
    strokeWidth={2.2}
  />
);

/**
 * forwardRef is REQUIRED here: <AnimatePresence mode="popLayout"> reparents its
 * children during exit and needs a handle on the DOM node. Without it React
 * warns "Function components cannot be given refs" and the pop-layout exit
 * silently degrades.
 */
const Toast = forwardRef(function Toast({ toast, onDismiss }, ref) {
  const { id, message, type, ttl } = toast;
  const remaining = useRef(ttl);
  const startedAt = useRef(Date.now());
  const timer = useRef(null);
  const [paused, setPaused] = useState(false);

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };

  const resume = useCallback(() => {
    if (!ttl || timer.current) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => onDismiss(id), remaining.current);
  }, [id, onDismiss, ttl]);

  const pause = useCallback(() => {
    if (!ttl || !timer.current) return;
    clear();
    remaining.current -= Date.now() - startedAt.current;
  }, [ttl]);

  useEffect(() => {
    resume();
    // A toast should not burn its lifetime while the tab is in the background.
    const onVisibility = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pause, resume]);

  useEffect(() => {
    paused ? pause() : resume();
  }, [paused, pause, resume]);

  const tone = TONES[type] || TONES.info;

  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 32, scale: 0.98, transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
      transition={{ type: 'spring', duration: 0.45, bounce: 0.16 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.02, right: 0.7 }}
      onDragStart={() => setPaused(true)}
      onDragEnd={(_, info) => {
        // Velocity OR distance — a quick flick shouldn't need the full swipe.
        if (info.offset.x > 80 || info.velocity.x > 380) onDismiss(id);
        else setPaused(false);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`group pointer-events-auto flex cursor-grab items-start gap-3 rounded-xl border border-line px-4 py-3 text-sm shadow-pop ring-1 ring-inset active:cursor-grabbing ${tone.bg} ${tone.ring}`}
    >
      <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${tone.icon}`}>
        <Glyph type={type} />
      </span>
      <span className="min-w-0 flex-1 font-medium leading-relaxed text-ink">{message}</span>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        className="focus-ring -mr-1 shrink-0 rounded-md p-1 text-subtle opacity-0 transition-opacity duration-150 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Icon name="x" size={12} strokeWidth={2} />
      </button>
    </motion.li>
  );
});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((message, type = 'info', ttl = 4000) => {
    const id = ++idc;
    // Cap the stack so a burst of errors can't wallpaper the screen.
    setToasts((t) => [...t.slice(-2), { id, message, type, ttl }]);
    return id;
  }, []);

  const toast = useMemo(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error', 6000),
      info: (m) => push(m, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ul className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,400px)] flex-col gap-2.5">
        {/* Keys sit on the Toast itself — an intermediate wrapper would hide the
            exiting child from AnimatePresence and kill the exit animation. */}
        <AnimatePresence initial={false} mode="popLayout">
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </ul>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
