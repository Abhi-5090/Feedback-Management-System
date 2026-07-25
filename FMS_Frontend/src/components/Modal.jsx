import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog.
 *
 * Motion: scales from centre (a modal is NOT anchored to a trigger, so unlike a
 * popover it should not scale from one) and starts at 0.97 rather than 0 —
 * nothing in the real world appears from nothing. The exit is deliberately
 * faster than the enter: opening is the system presenting itself, closing is
 * the system getting out of the user's way, and it should feel immediate.
 *
 * Correctness the user never notices: focus moves in on open, is trapped while
 * open, and returns to the trigger on close; background scroll is locked so the
 * page behind doesn't drift.
 */
export default function Modal({ open, onClose, title, description, children, maxWidth = 'max-w-lg' }) {
  const panelRef = useRef(null);
  const restoreTo = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /**
   * Held in a ref and bound ONCE per open.
   *
   * This used to be a useCallback dependent on `onClose`, with the focus effect
   * depending on the callback. Callers pass an inline arrow (`onClose={() =>
   * setOpen(false)}`), so `onClose` was a new reference on every render — the
   * effect tore down and re-ran after EVERY keystroke, and its focus-in step
   * yanked the caret back to the first field. The visible symptom was that no
   * modal input would accept more than one character.
   */
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      // Focus trap — cycle within the dialog instead of escaping to the page.
      const nodes = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  // Depends on `open` ALONE. Anything else here re-runs mid-typing and steals
  // focus (see the note on keyHandlerRef above).
  useEffect(() => {
    if (!open) return undefined;

    restoreTo.current = document.activeElement;
    const { overflow, paddingRight } = document.body.style;
    // Compensate for the removed scrollbar so the page doesn't shift sideways.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    // Stable listener that always calls the latest handler via the ref.
    const listener = (e) => keyHandlerRef.current?.(e);
    document.addEventListener('keydown', listener, true);

    // Move focus in on the next frame, once the panel has mounted.
    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector(FOCUSABLE);
      (target || panelRef.current)?.focus?.();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', listener, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      restoreTo.current?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4 sm:p-6">
          <motion.div
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{
              duration: 0.24,
              ease: [0.23, 1, 0.32, 1],
              // Exit snaps back faster than the entrance.
              exit: { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
            }}
            className={`card relative z-10 max-h-[88vh] w-full overflow-y-auto ${maxWidth} shadow-pop`}
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-card/95 px-5 py-4 backdrop-blur">
              <div className="min-w-0">
                <h3 className="text-base font-semibold leading-tight text-ink">{title}</h3>
                {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="focus-ring -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 3.5l8 8m0-8l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
