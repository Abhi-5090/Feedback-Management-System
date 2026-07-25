import { useState, useId, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
const STARS = [1, 2, 3, 4, 5];

function Star({ fill = 'full', size, gradientId }) {
  // `fill` is 'full' | 'half' | 'empty'. The half state needs a gradient whose
  // id is UNIQUE per instance — a shared id makes every half-star on the page
  // resolve to whichever node rendered last.
  const paint = fill === 'full' ? 'currentColor' : fill === 'half' ? `url(#${gradientId})` : 'none';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="block" aria-hidden="true">
      {fill === 'half' && (
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.9l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.5z"
        fill={paint}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Interactive (onChange provided) or read-only star row.
 *
 * Interaction notes:
 *  - The "pop" fires only on SELECTION, never on hover. A scale keyframe on
 *    every hover makes dragging across the row feel noisy and slightly broken;
 *    hover is a colour change only, which is the cheap, calm signal.
 *  - Hover previews are gated behind a fine pointer: on touch, hover fires on
 *    tap and would light up stars the user never chose.
 *  - Full radiogroup semantics with arrow-key support and a roving tabindex, so
 *    the whole form is completable from the keyboard.
 */
export default function StarRating({
  value = 0,
  onChange,
  size = 40,
  readOnly = false,
  showLabel = true,
  name,
}) {
  const [hover, setHover] = useState(0);
  const [justPicked, setJustPicked] = useState(0);
  const reduce = useReducedMotion();
  const uid = useId();
  const groupRef = useRef(null);

  if (readOnly) {
    const full = Math.floor(value);
    const frac = value - full;
    const hasHalf = frac >= 0.25 && frac < 0.85;
    return (
      <span
        className="inline-flex items-center gap-0.5 text-amber-400"
        role="img"
        aria-label={`${Number(value).toFixed(1)} out of 5`}
      >
        {STARS.map((i) => (
          <Star
            key={i}
            size={size}
            gradientId={`${uid}-half-${i}`}
            fill={i <= full ? 'full' : hasHalf && i === full + 1 ? 'half' : 'empty'}
          />
        ))}
      </span>
    );
  }

  const shown = hover || value;

  const pick = (i) => {
    onChange?.(i);
    setJustPicked(i);
  };

  const onKeyDown = (e) => {
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    if (!back && !fwd && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 1 : e.key === 'End' ? 5 : Math.min(5, Math.max(1, (value || 0) + (fwd ? 1 : -1)));
    pick(next);
    groupRef.current?.querySelector(`[data-star="${next}"]`)?.focus();
  };

  return (
    <div className="flex items-center gap-3">
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={name || 'Rating'}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHover(0)}
        className="flex items-center gap-1"
      >
        {STARS.map((i) => {
          const active = i <= shown;
          return (
            <motion.button
              key={i}
              type="button"
              data-star={i}
              role="radio"
              aria-checked={value === i}
              aria-label={`${i} star${i > 1 ? 's' : ''} — ${LABELS[i]}`}
              // Roving tabindex: one stop for the whole group, not five.
              tabIndex={value === i || (!value && i === 1) ? 0 : -1}
              onMouseEnter={() => setHover(i)}
              onClick={() => pick(i)}
              whileTap={reduce ? undefined : { scale: 0.86 }}
              animate={!reduce && justPicked === i ? { scale: [1, 1.22, 1] } : { scale: 1 }}
              onAnimationComplete={() => justPicked === i && setJustPicked(0)}
              transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
              className={`focus-ring rounded-lg p-1 transition-colors duration-150 ${
                active ? 'text-amber-400' : 'text-line hover:text-amber-200'
              }`}
            >
              <Star size={size} gradientId={`${uid}-i-${i}`} fill={active ? 'full' : 'empty'} />
            </motion.button>
          );
        })}
      </div>

      {showLabel && (
        <span
          className={`min-w-[76px] text-sm font-semibold transition-colors duration-150 ${
            shown ? 'text-ink' : 'text-subtle'
          }`}
        >
          {shown ? LABELS[shown] : 'Tap to rate'}
        </span>
      )}
    </div>
  );
}
