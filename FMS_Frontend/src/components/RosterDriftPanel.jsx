import { useCallback, useEffect, useState } from 'react';
import { BatchesAPI } from '../api/endpoints.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';

const day = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';

/**
 * Sessions whose feedback is attributed to a different mentor team from the
 * one the batch now names.
 *
 * WHY IT NEEDS SAYING OUT LOUD. Every response carries a COPY of the rosters
 * as they stood when it was submitted, so that changing a batch's staffing
 * later cannot rewrite who taught a session that has already been rated. That
 * is correct, and it is also completely invisible: an admin fixes a roster,
 * and the mentor they just added opens their account to find the session
 * listed with zero responses while the admin sees seventy-three. Nothing is
 * broken and nothing explains it.
 *
 * So the disagreement is shown, with the one thing an admin needs in order to
 * decide — who gains the feedback and who loses it — and the repair is an
 * explicit action rather than something that happens quietly.
 */
export default function RosterDriftPanel() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await BatchesAPI.rosterDrift());
    } catch {
      // Never break the Batches page over a diagnostic.
      setData({ drift: [], responses: 0 });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data || !data.drift.length) return null;

  const apply = async () => {
    setBusy(true);
    try {
      const res = await BatchesAPI.reattribute(confirming.batchId, confirming.classId);
      toast.success(`${res.modified} response(s) moved to the current mentor team`);
      setConfirming(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-ink">
              {data.drift.length} session{data.drift.length === 1 ? '' : 's'} attributed to a previous mentor team
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Feedback records the mentors who were staffed when it was submitted, so changing a batch&rsquo;s roster
              afterwards does not move it. These <span className="tnum font-semibold text-ink">{data.responses}</span>{' '}
              responses still belong to the earlier team — which is why a mentor you have just added sees the session
              with no responses in it.
            </p>

            <ul className="mt-3.5 space-y-2.5">
              {data.drift.map((d) => (
                <li
                  key={`${d.batchId}-${d.classId}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-card px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {d.batchName} <span className="font-normal text-muted">· {d.className}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      <span className="tnum font-semibold text-ink">{d.responses}</span> responses collected{' '}
                      {day(d.collectedFrom)}
                      {day(d.collectedFrom) !== day(d.collectedTo) && <> – {day(d.collectedTo)}</>}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                      <span className="font-semibold text-ink">Now held by</span>{' '}
                      {[...d.stamped.mainTrainers, ...d.stamped.supportTrainers].join(', ') || '—'}
                      {' · '}
                      <span className="font-semibold text-ink">batch names</span>{' '}
                      {[...d.current.mainTrainers, ...d.current.supportTrainers].join(', ') || '—'}
                    </p>
                  </div>
                  <button className="btn-outline shrink-0 !py-1.5 text-xs" onClick={() => setConfirming(d)}>
                    Re-attribute
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[11px] leading-relaxed text-subtle">
              Leave it alone if the team genuinely changed partway through — the feedback belongs to whoever taught
              those sessions. Re-attribute only if the roster was entered wrongly to begin with.
            </p>
          </div>
        </div>
      </section>

      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Move this feedback to the current team?"
        description={confirming ? `${confirming.batchName} · ${confirming.className}` : undefined}
      >
        {confirming && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2/50 p-3.5 text-sm">
              <p className="tnum text-display-sm leading-none text-ink">{confirming.responses}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                responses will move
              </p>
            </div>

            <ul className="space-y-2 text-sm">
              {confirming.wouldGain.length > 0 && (
                <li className="flex gap-2.5">
                  <Icon name="plus" size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <strong>{confirming.wouldGain.join(', ')}</strong> will gain these responses — they appear in their
                    ratings and on their dashboard.
                  </span>
                </li>
              )}
              {confirming.wouldLose.length > 0 && (
                <li className="flex gap-2.5">
                  <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-rose-600" />
                  <span>
                    <strong>{confirming.wouldLose.join(', ')}</strong> will lose them. If they actually taught these
                    sessions, this removes a record of their work.
                  </span>
                </li>
              )}
              <li className="flex gap-2.5">
                <Icon name="shield" size={15} className="mt-0.5 shrink-0 text-muted" />
                <span>Recorded in the audit trail, including who held the feedback before.</span>
              </li>
            </ul>

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="btn-primary" onClick={apply} disabled={busy}>
                {busy ? 'Moving…' : 'Re-attribute'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
