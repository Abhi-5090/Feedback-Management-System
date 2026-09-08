import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import { MentorRosterBadges } from './MentorRosterPicker.jsx';

/**
 * Every SESSION in a scope, one row each — a session being a (batch, subject)
 * pair.
 *
 * This is the table behind a year-group card. "First Year" holds six batches
 * across two subjects (four C Programming, two Python), and each of those is a
 * distinct thing taught by a distinct team to a distinct group of students. A
 * row per subject would collapse four C Programming batches into one line that
 * describes none of them.
 */
export default function SessionTable({ sessions, basePath, emptyHint }) {
  const location = useLocation();
  const here = location.pathname + location.search;

  if (!sessions?.length) {
    return (
      <p className="rounded-xl bg-surface-2/60 px-4 py-6 text-center text-sm text-muted">
        {emptyHint || 'No batches here yet.'}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th className="th text-left">Batch</th>
            <th className="th text-left">Subject</th>
            <th className="th text-left">
              <span className="inline-flex items-center gap-1.5">
                Mentors
                <InfoTooltip text="Assigned per batch, not per subject — the same subject runs with different teams for different cohorts. Orange is the main mentor who delivers it; violet assists." />
              </span>
            </th>
            <th className="th text-left">Status</th>
            <th className="th text-left">Answered</th>
            <th className="th text-left">Rating</th>
            <th className="th text-right">Feedback</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="tr-hover border-b border-line last:border-0">
              <td className="td">
                <span className="block font-semibold text-ink">{s.batchName}</span>
                <span className="block text-[11px] text-subtle">
                  {s.dept || '—'}
                  {s.round > 1 && <span className="ml-1.5">round {s.round}</span>}
                </span>
              </td>
              <td className="td">
                <span className="chip bg-surface-2 !py-0.5 text-[11px] font-medium text-ink">
                  {s.className}
                </span>
              </td>
              <td className="td">
                <MentorRosterBadges
                  mainTrainerNames={s.mainTrainerNames}
                  supportTrainerNames={s.supportTrainerNames}
                  compact
                />
              </td>
              <td className="td">
                {s.status === 'open' ? (
                  <span className="chip-open !py-0.5 text-[10px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    Collecting
                  </span>
                ) : (
                  <span className="chip bg-surface-2 !py-0.5 text-[10px] text-muted">Locked</span>
                )}
              </td>
              <td className="td">
                {s.responseRate == null ? (
                  <span className="text-xs text-subtle">no cap set</span>
                ) : (
                  <span className="text-xs">
                    <span className="tnum font-semibold text-ink">{s.responseRate}%</span>
                    <span className="tnum text-subtle">
                      {' '}
                      ({s.submittedCount}/{s.expectedCount})
                    </span>
                  </span>
                )}
              </td>
              <td className="td">
                {s.average == null ? (
                  /* Not 0.00 — an unrated session is not a badly rated one, and
                     printing a zero beside a mentor's name is a false claim. */
                  <span className="text-xs text-subtle">
                    {s.responses === 0 ? 'no responses' : '—'}
                  </span>
                ) : (
                  <span className="text-xs">
                    <span
                      className={`tnum rounded-full px-2 py-0.5 font-semibold ${
                        s.average >= 4
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                          : s.average >= 3.5
                            ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                            : 'bg-rose-500/12 text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {s.average.toFixed(2)}
                    </span>
                    <span className="tnum ml-1.5 text-subtle">{s.responses} resp</span>
                  </span>
                )}
              </td>
              <td className="td text-right">
                <Link
                  to={`${basePath}/batch/${s.batchId}`}
                  state={{ from: here }}
                  className="btn-ghost !px-2.5 !py-1.5 text-xs"
                >
                  <Icon name="barChart" size={13} />
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
