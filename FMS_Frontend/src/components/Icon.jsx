/**
 * Icon system.
 *
 * A single stroked set replaces every emoji in the product. Emoji were the
 * biggest thing making the app read as a demo: they render differently on every
 * OS, can't inherit colour, can't be sized optically, and carry a casual tone.
 * These are 24×24, 1.6 stroke, round caps/joins, and inherit `currentColor` —
 * so one icon works in the sidebar, in a card, and inside a button, in either theme.
 *
 * Usage:  <Icon name="users" />              (16px, inherits colour)
 *         <Icon name="star" size={20} />
 *         <Icon name="check" className="text-emerald-600" />
 */

const P = {
  // ── Navigation / domain ──────────────────────────────────────────────────
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="4.5" rx="1.6" />
      <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  /* A person with a tick — the main mentor who delivers a class, as distinct
     from `users` (the support team who assist). */
  'user-check': (
    <>
      <path d="M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20" />
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="m16.5 11 2 2 4-4" />
    </>
  ),
  users: (
    <>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6" />
    </>
  ),
  user: (
    <>
      <path d="M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 0 4 19.5z" />
      <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H20" />
      <path d="M9 7.5h6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8.5V6.5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V13.5a2.5 2.5 0 0 0 0-5z" />
      <path d="M14 6v2M14 11v2M14 16v1.5" strokeDasharray="0.1 3" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18M5 21V5.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5.5V21" />
      <path d="M15 10h3.5A1.5 1.5 0 0 1 20 11.5V21" />
      <path d="M8.5 8h3M8.5 12h3M8.5 16h3" />
    </>
  ),
  inbox: (
    <>
      <path d="M20 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V12" />
      <path d="M4 12l2.2-7A1.5 1.5 0 0 1 7.6 4h8.8a1.5 1.5 0 0 1 1.4 1L20 12h-4.5l-1 2.5h-5l-1-2.5z" />
    </>
  ),
  message: (
    <>
      <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V6.5A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5z" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85z" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  graduation: (
    <>
      <path d="M12 4L2.5 8.5 12 13l9.5-4.5z" />
      <path d="M6.5 10.8V15c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.2" />
      <path d="M21.5 8.5V14" />
    </>
  ),

  // ── Charts ───────────────────────────────────────────────────────────────
  barChart: (
    <>
      <path d="M3 21h18" />
      <rect x="5" y="11" width="3.6" height="7" rx="1" />
      <rect x="10.2" y="6.5" width="3.6" height="11.5" rx="1" />
      <rect x="15.4" y="14" width="3.6" height="4" rx="1" />
    </>
  ),
  trendUp: (
    <>
      <path d="M3 17.5l5.5-5.5 3.5 3.5L20.5 7" />
      <path d="M15.5 7h5v5" />
    </>
  ),
  activity: <path d="M3 12h3.5l2.5-7 4.5 14 2.5-7H21" />,

  // ── State / status ───────────────────────────────────────────────────────
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10" width="15" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.2l2.8 2.8L16.2 9.5" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <path d="M12 4.5L21 19.5H3z" />
      <path d="M12 10v4M12 16.8v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.2" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z" />
      <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>
  ),

  // ── Actions ──────────────────────────────────────────────────────────────
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11M8 10.5l4 4 4-4" />
      <path d="M4 19.5h16" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 12.5A8 8 0 0 0 17.7 17.7L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.5-1.5" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8.5V20l-4-2.5v-4z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9M6.3 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.6-.7" />
      <path d="M10 10a2.8 2.8 0 0 0 3.9 3.9" />
      <path d="M3.5 3.5l17 17" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3.5" />
      <path d="M15 8l4 4-4 4M19 12H9.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,

  // ── Arrows / chevrons ────────────────────────────────────────────────────
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5m0 0l6-6m-6 6l6 6" />,
  arrowRight: <path d="M5 12h14m0 0l-6-6m6 6l-6 6" />,
};

export default function Icon({ name, size = 16, className = '', strokeWidth = 1.6, ...rest }) {
  const path = P[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}

/** Filled star — the one icon that needs a solid variant (ratings). */
export function StarIcon({ size = 16, filled = true, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85z" />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(P);
