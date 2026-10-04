import Card from '../Card.jsx';

const tone = (r) =>
  r >= 75 ? 'bg-emerald-500' : r >= 40 ? 'bg-amber-400' : 'bg-rose-500';

/**
 * Turnout per cohort, worst first.
 *
 * An institution-wide response rate hides the cohort that returned 20%, and
 * that cohort is the one whose numbers deserve the least trust — a mean drawn
 * from a fifth of a room is a mean of whoever felt strongly enough to answer.
 * Showing turnout next to the rating is what stops a confident-looking 4.6
 * from being read as the cohort's verdict when it is eleven people's.
 *
 * Sorted by the worst, because a list sorted by name is a reference table and
 * a list sorted by severity is a worklist.
 */
export default function CollectionHealth({ data, limit = 8 }) {
  if (!data?.length) {
    return (
      <Card title="Collection health" icon="target">
        <p className="p-5 text-sm text-muted">No cohorts with an expected size set.</p>
      </Card>
    );
  }

  const shown = data.slice(0, limit);
  const totalExpected = data.reduce((n, b) => n + b.expected, 0);
  const totalAnswered = data.reduce((n, b) => n + b.answered, 0);
  const overall = totalExpected ? Math.round((totalAnswered / totalExpected) * 1000) / 10 : 0;

  return (
    <Card
      title="Collection health"
      icon="target"
      subtitle={`${totalAnswered.toLocaleString()} of ${totalExpected.toLocaleString()} students responded — ${overall}% overall`}
      hint="How much of each cohort actually answered. A rating drawn from a small share of a cohort represents the people who chose to reply, not the cohort."
    >
      <ul className="divide-y divide-line/60">
        {shown.map((b) => (
          <li key={b.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium text-ink">
                {b.name}
                {b.yearGroup && <span className="ml-2 text-[11px] font-normal text-subtle">{b.yearGroup}</span>}
              </p>
              <p className="tnum shrink-0 text-xs text-muted">
                <span className="font-bold text-ink">{b.answered}</span>
                <span className="text-subtle">/{b.expected}</span>
                <span className="ml-2 font-semibold text-ink">{b.rate}%</span>
              </p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${tone(b.rate)} transition-[width] duration-500 ease-out-expo`}
                style={{ width: `${Math.min(100, b.rate)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {data.length > limit && (
        <p className="border-t border-line px-5 py-2.5 text-[11px] text-subtle">
          Showing the {limit} lowest of {data.length} cohorts.
        </p>
      )}
    </Card>
  );
}
