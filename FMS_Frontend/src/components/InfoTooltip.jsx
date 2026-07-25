import { useState, useId, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * A small "?" affordance that reveals an explanatory tooltip. Used all over the
 * dashboards so every metric/section is self-documenting (what a "batch" is,
 * what "device lock" prevents, etc.). Accessible: focusable + describedby.
 *
 * Two details that make a toolbar of these feel fast rather than fussy:
 *  1. The FIRST tooltip waits ~350ms so brushing past a row doesn't flash text.
 *  2. Once one has been shown, neighbouring tooltips open INSTANTLY with no
 *     delay and no animation — scanning a row of metrics then feels immediate
 *     without defeating the purpose of the initial delay.
 * Keyboard focus always opens instantly: that intent is already explicit.
 */

const OPEN_DELAY = 350;
const GRACE = 400; // window after closing during which peers open instantly
let lastClosedAt = 0;

export default function InfoTooltip({ text, className = '' }) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const timer = useRef(null);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback((immediate) => {
    clearTimeout(timer.current);
    const warm = immediate || Date.now() - lastClosedAt < GRACE;
    if (warm) {
      setInstant(true);
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => {
      setInstant(false);
      setOpen(true);
    }, OPEN_DELAY);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen((wasOpen) => {
      if (wasOpen) lastClosedAt = Date.now();
      return false;
    });
  }, []);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label="More information"
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          open ? hide() : show(true);
        }}
        className="focus-ring grid h-4 w-4 place-items-center rounded-full border border-line text-[10px] font-bold leading-none text-muted transition-colors duration-150 hover:border-brand-500 hover:text-brand-600"
      >
        ?
      </button>

      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96, y: 3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 2 }}
            // Instant on warm hover; otherwise a quick 125ms ease-out.
            transition={instant ? { duration: 0 } : { duration: 0.125, ease: [0.23, 1, 0.32, 1] }}
            // Scale from the trigger it belongs to, not from its own centre.
            style={{ transformOrigin: 'bottom center' }}
            className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl border border-line bg-card px-3 py-2 text-xs font-normal leading-relaxed text-ink shadow-pop"
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
