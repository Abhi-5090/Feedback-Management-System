import { useEffect, useRef } from 'react';

/**
 * Call `fn` immediately and then every `ms` while `enabled`. Used for the live
 * "submitted / expected" counters on the dashboards (polling is acceptable per
 * the spec — no WebSocket needed).
 */
export function usePolling(fn, ms = 8000, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const tick = () => alive && saved.current();
    tick();
    const id = setInterval(tick, ms);
    return () => { alive = false; clearInterval(id); };
  }, [ms, enabled]);
}
