import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';

/**
 * A mentor's figures split by the role they held: sessions they DELIVERED as
 * main mentor, vs sessions they ASSISTED as support mentor.
 *
 * Why this is a panel and not one number. A mentor who delivers three subjects
 * and assists on five has two different bodies of feedback, and blending them
 * into a single average is actively misleading in both directions: a weak score
 * on a class someone else taught drags down their own teaching record, and a
 * strong one can mask it. Separating them is the difference between a number
 * you can act on and a number you have to argue with.
 *
 * "No responses yet" is shown rather than 0.00 — an unrated role is not a
 * zero-rated one, and printing 0.00 next to a person's name is a false claim.
 */
export default function RoleSplitPanel({ split, className = '' }) {
  if (!split) return null;

  const roles = [
    {
      key: 'main',
      label: 'As main mentor',
      help: 'Sessions you delivered. This is your own teaching record.',
      icon: 'user-check',
      stats: split.main,
      tone: {
        ring: 'ring-brand-500/20',
        bg: 'bg-brand-500/8',
        text: 'text-brand-700 dark:text-brand-300',
        chip: 'bg-brand-500/12 text-brand-700 dark:text-brand-300',
      },
    },
    {
      key: 'support',
      label: 'As support mentor',
      help: 'Sessions you assisted on. The main mentor delivered these.',
      icon: 'users',
      stats: split.support,
      tone: {
        ring: 'ring-violet-500/20',
        bg: 'bg-violet-500/8',
        text: 'text-violet-700 dark:text-violet-300',
        chip: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
      },
    },
  ];

  const nothing = roles.every((r) => !r.stats?.feedbackCount);

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      {roles.map((r) => {
        const count = r.stats?.feedbackCount || 0;
        const avg = r.stats?.overallAverage;
        return (
          <div
            key={r.key}
            className={`rounded-2xl p-4 ring-1 ring-inset ${r.tone.bg} ${r.tone.ring}`}
          >
            <div className="flex items-center gap-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${r.tone.chip}`}>
                <Icon name={r.icon} size={14} />
              </span>
              <span className={`text-xs font-bold uppercase tracking-wide ${r.tone.text}`}>
                {r.label}
              </span>
              <InfoTooltip text={r.help} />
            </div>

            {count === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No responses yet
                {nothing && <span className="block text-xs text-subtle">Once a batch you are staffed on collects feedback, it appears here.</span>}
              </p>
            ) : (
              <div className="mt-3 flex items-baseline gap-2">
                <span className="tnum text-2xl font-bold text-ink">
                  {typeof avg === 'number' ? avg.toFixed(2) : '—'}
                </span>
                <span className="text-sm text-muted">★</span>
                <span className="ml-auto text-xs text-muted">
                  <span className="tnum font-semibold text-ink">{count}</span>{' '}
                  {count === 1 ? 'response' : 'responses'}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
