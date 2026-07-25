import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Counts a metric up to its value.
 *
 * The whole reason this is a component rather than three lines inline is the
 * polling: these dashboards refetch every ~8s, so a naive counter would replay
 * its whole animation on every poll and the numbers would never sit still. This
 * only animates when the value ACTUALLY CHANGES — a poll returning the same
 * number is a no-op — and it counts from the previous value, not from zero, so
 * 41 → 42 ticks by one instead of racing up from nothing.
 *
 * Uses requestAnimationFrame with an ease-out curve; under reduced motion it
 * renders the final value immediately.
 */
export default function AnimatedNumber({ value, decimals = 0, duration = 900, className = '' }) {
  const reduce = useReducedMotion();
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    // First paint animates from zero (there's nothing to preserve yet);
    // afterwards it animates from wherever the number already was.
    const from = mounted.current ? fromRef.current : 0;
    mounted.current = true;

    if (reduce || from === target) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out-expo: most of the distance covered early, so the number
      // "arrives" quickly and then settles rather than crawling the whole way.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(from + (target - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, reduce]);

  return <span className={className}>{shown.toFixed(decimals)}</span>;
}
