import Card from '../Card.jsx';
import Icon from '../Icon.jsx';

const Row = ({ s, rank, tone }) => (
  <li className="flex items-center gap-3 px-5 py-2.5">
    <span
      className={`tnum grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold ${
        tone === 'good'
          ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
          : 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
      }`}
    >
      {rank}
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-ink">{s.className}</p>
      <p className="truncate text-[11px] text-muted">{s.batchName}</p>
    </div>
    <div className="shrink-0 text-right">
      <p
        className={`tnum text-sm font-bold ${
          tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {s.average.toFixed(2)}
      </p>
      <p className="tnum text-[10px] text-subtle">{s.responses} responses</p>
    </div>
  </li>
);

/**
 * The best and worst sessions, with a volume floor.
 *
 * The floor is the entire design. Rank sessions by average with no minimum and
 * whichever session collected three responses owns both ends of the table —
 * and a league table driven by sample noise is worse than no table, because
 * someone acts on it. Sessions below the floor are reported as a count, not
 * silently dropped: "4 sessions have too few responses to rank" is itself
 * information, and hiding them would make the list look more complete than it
 * is.
 */
export default function SessionRanking({ data }) {
  if (!data || (!data.top.length && !data.bottom.length)) {
    return (
      <Card title="Strongest and weakest sessions" icon="trophy">
        <p className="p-5 text-sm text-muted">
          {data?.belowFloor
            ? `No session yet has the ${data.minResponses} responses needed to rank it fairly.`
            : 'No sessions to rank yet.'}
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Strongest and weakest sessions"
      icon="trophy"
      subtitle={`Ranked among ${data.ranked} session${data.ranked === 1 ? '' : 's'} with at least ${data.minResponses} responses`}
      hint="Sessions with fewer responses are excluded. With a handful of responses an average is mostly noise, and ranking on it would be misleading."
    >
      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-card">
          <p className="flex items-center gap-1.5 px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            <Icon name="trendUp" size={13} /> Highest rated
          </p>
          <ul className="divide-y divide-line/60">
            {data.top.map((s, i) => (
              <Row key={s.id} s={s} rank={i + 1} tone="good" />
            ))}
          </ul>
        </div>
        <div className="bg-card">
          <p className="flex items-center gap-1.5 px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            <Icon name="trendDown" size={13} /> Needs attention
          </p>
          <ul className="divide-y divide-line/60">
            {data.bottom.map((s, i) => (
              <Row key={s.id} s={s} rank={i + 1} tone="bad" />
            ))}
          </ul>
        </div>
      </div>

      {data.belowFloor > 0 && (
        <p className="border-t border-line px-5 py-2.5 text-[11px] text-subtle">
          {data.belowFloor} session{data.belowFloor === 1 ? '' : 's'} not ranked — fewer than {data.minResponses}{' '}
          responses.
        </p>
      )}
    </Card>
  );
}
