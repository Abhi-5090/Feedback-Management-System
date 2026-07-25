import { motion, useReducedMotion } from 'framer-motion';
import Icon from '../../components/Icon.jsx';

/**
 * Step 3 — warm confirmation. Also handles "already recorded" / "session full".
 *
 * This is the one screen in the product that may celebrate: it is seen once,
 * at the end of a task the user chose to complete. The burst is decorative,
 * runs for ~1s, and is fully suppressed under reduced-motion — where the
 * message stands on its own without any of the motion.
 *
 * The icon scales in from 0.9, never from 0. Nothing in the real world appears
 * out of nothing; starting from a visible size reads as arriving rather than
 * being conjured.
 */

// Fixed offsets rather than Math.random(): a burst that differs every render is
// impossible to tune, and re-renders would re-roll it mid-flight.
// Confetti is drawn as small tinted shapes, not emoji — same celebratory read,
// but it inherits the brand palette and renders identically on every platform.
const BURST = [
  { x: -68, y: -74, r: -38, c: 'bg-brand-500', s: 7 },
  { x: -44, y: -96, r: -18, c: 'bg-amber-400', s: 5 },
  { x: -18, y: -84, r: 12, c: 'bg-emerald-500', s: 6 },
  { x: 8, y: -102, r: -8, c: 'bg-brand-400', s: 5 },
  { x: 34, y: -80, r: 26, c: 'bg-sky-500', s: 7 },
  { x: 60, y: -92, r: 40, c: 'bg-amber-400', s: 5 },
  { x: -56, y: -52, r: -26, c: 'bg-violet-500', s: 6 },
  { x: 52, y: -56, r: 22, c: 'bg-emerald-500', s: 5 },
];

export default function ThankYou({ result, batchName }) {
  const reduce = useReducedMotion();
  const duplicate = result?.alreadyRecorded;
  const capReached = result?.capReached;
  const success = !duplicate && !capReached;

  const title = duplicate
    ? 'Already recorded'
    : capReached
      ? 'All responses collected'
      : 'Thank you!';
  const message = duplicate
    ? 'Feedback was already submitted from this device for this session. Each device can submit once.'
    : capReached
      ? 'This session has already collected all of its expected responses. Thanks for showing up!'
      : 'Your feedback has been recorded anonymously. It helps your trainer make the next session even better.';
  const icon = duplicate ? 'checkCircle' : capReached ? 'users' : 'sparkle';

  const tone = success
    ? 'from-brand-500/15 ring-brand-500/25'
    : 'from-slate-500/10 ring-line';

  return (
    <div className="card p-8 text-center">
      {/* Celebratory burst — success only, and never under reduced motion */}
      {success && !reduce && (
        <div className="pointer-events-none relative mx-auto h-0 w-0" aria-hidden="true">
          {BURST.map((b, i) => (
            <motion.span
              key={i}
              className={`absolute block rounded-[2px] ${b.c}`}
              style={{ width: b.s, height: b.s }}
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.5, rotate: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                x: b.x,
                y: b.y,
                scale: 1,
                rotate: b.r,
              }}
              transition={{
                duration: 1.05,
                delay: 0.12 + i * 0.028,
                ease: [0.23, 1, 0.32, 1],
                times: [0, 0.15, 0.7, 1],
              }}
            />
          ))}
        </div>
      )}

      {/* The confirmation COPY uses CSS entrances. This is the screen that tells
          a student their submission worked — it must never be able to sit blank
          because a JS animation didn't settle. Only the burst above is JS. */}
      <div
        className={`animate-scale-in mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-b to-transparent ring-1 ring-inset ${tone} ${
          success ? 'text-brand-600 dark:text-brand-400' : 'text-muted'
        }`}
      >
        <Icon name={icon} size={34} strokeWidth={1.5} />
      </div>

      <h2 className="animate-fade-up text-xl font-bold tracking-tight text-ink" style={{ animationDelay: '80ms' }}>
        {title}
      </h2>

      <p
        className="animate-fade-up mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted"
        style={{ animationDelay: '140ms' }}
      >
        {message}
      </p>

      {batchName && (
        <p className="animate-fade-in mt-3 text-xs text-muted" style={{ animationDelay: '220ms' }}>
          Session: <span className="font-medium text-ink">{batchName}</span>
        </p>
      )}

      <div
        className="animate-fade-in mt-6 flex items-start gap-2 rounded-xl border border-line bg-surface-2/60 p-3 text-left text-xs leading-relaxed text-muted"
        style={{ animationDelay: '280ms' }}
      >
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden="true" className="mt-px shrink-0">
          <path
            d="M4 6.5V4.8a3.5 3.5 0 117 0v1.7M3.5 6.5h8v6h-8z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        You can safely close this page. Your response is anonymous and can’t be traced back to you.
      </div>
    </div>
  );
}
