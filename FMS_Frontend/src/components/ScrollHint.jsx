import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * A horizontally scrollable region that SAYS it scrolls.
 *
 * Wide tables already scroll inside their own container, which keeps the page
 * from moving sideways. What they do not do is admit it: on a phone the table
 * is cut off at the screen edge with no visual cue, so the columns to the right
 * — status, ratings, the actions — simply look absent. People do not swipe
 * something they have no reason to think continues.
 *
 * So this adds a fading edge and a one-time nudge, both of which disappear once
 * you reach the end, and neither of which appears at all when the content fits.
 */
export default function ScrollHint({ children, className = '' }) {
  const ref = useRef(null);
  const [state, setState] = useState({ overflowing: false, atStart: true, atEnd: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const overflowing = el.scrollWidth > el.clientWidth + 4;
      setState({
        overflowing,
        atStart: el.scrollLeft <= 4,
        // -4 tolerance: fractional widths mean scrollLeft rarely lands exactly.
        atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      });
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    /* Re-measure on resize AND on content change — a table that gains rows
       after a fetch can start overflowing when it did not a moment ago.

       Feature-detected rather than assumed. ResizeObserver is absent in jsdom
       (so every test rendering a table crashed on mount) and in older mobile
       browsers, and this component is decoration — a missing fade must never
       take the page down with it. Without it we fall back to window resize,
       which covers rotating a phone, the case that matters most here. */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
      for (const child of el.children) ro.observe(child);
    } else {
      window.addEventListener('resize', measure);
    }

    return () => {
      el.removeEventListener('scroll', measure);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [children]);

  return (
    <div className={`relative ${className}`}>
      <div ref={ref} className="overflow-x-auto">
        {children}
      </div>

      {/* A fade at whichever edge has more content behind it. Pointer-events
          off so it never intercepts a swipe or a click on a row beneath. */}
      {state.overflowing && !state.atEnd && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card to-transparent"
        />
      )}
      {state.overflowing && !state.atStart && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-card to-transparent"
        />
      )}

      {/* The nudge, only while there is unseen content to the right and only on
          touch-sized screens, where the fade alone is easy to miss. */}
      {state.overflowing && state.atStart && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ink/80 px-2 py-1 text-[10px] font-semibold text-surface sm:hidden"
        >
          Swipe
          <Icon name="chevronRight" size={10} />
        </span>
      )}
    </div>
  );
}
