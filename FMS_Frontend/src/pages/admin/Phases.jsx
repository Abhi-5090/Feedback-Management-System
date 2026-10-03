import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PhasesAPI } from '../../api/endpoints.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import SummaryStat, { SummaryStrip } from '../../components/SummaryStat.jsx';
import MonthRangePicker, { monthRange } from '../../components/MonthRangePicker.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/* The stored end is exclusive; a person reading "ends 1 November" would think
   November is included. Always show the last day actually covered. */
const lastDay = (endsAt) => day(new Date(new Date(endsAt).getTime() - 1));

function StatusChip({ phase }) {
  const map = {
    draft: { label: 'Draft', cls: 'bg-surface-2 text-muted ring-line', icon: 'pencil' },
    open: { label: 'Collecting', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25', icon: 'activity' },
    closed: { label: 'Closed', cls: 'bg-brand-500/10 text-brand-700 dark:text-brand-400 ring-brand-500/20', icon: 'lock' },
  };
  const s = map[phase.status] || map.draft;
  return (
    <span className={`chip ${s.cls}`}>
      <Icon name={s.icon} size={11} />
      {s.label}
    </span>
  );
}

export default function Phases() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // phase | 'new'
  const [closing, setClosing] = useState(null);
  const [form, setForm] = useState({ name: '', code: '', startsAt: '', endsAt: '', notes: '' });

  const load = useCallback(async () => {
    try {
      setData(await PhasesAPI.list());
    } catch (e) {
      toast.error(e.message);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const phases = data?.phases || [];
  const unassigned = data?.unassigned || { responses: 0 };
  const collecting = phases.find((p) => p.collecting);
  const overdue = phases.filter((p) => p.overdue);

  const openNew = () => {
    /* Default to the CURRENT month and the next number in sequence. The admin
       starting a phase has almost always just started collecting, so the
       common case should need a name and nothing else. */
    const now = new Date();
    const r = monthRange(now.getUTCFullYear(), now.getUTCMonth());
    const n = phases.length + 1;
    setForm({
      name: `Phase ${n} — ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
      code: `P${n}`,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      notes: '',
    });
    setEditing('new');
  };

  const openEdit = (p) => {
    setForm({ name: p.name, code: p.code, startsAt: p.startsAt, endsAt: p.endsAt, notes: p.notes || '' });
    setEditing(p);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.startsAt) return toast.error('Pick a month for this phase.');
    setBusy(true);
    try {
      if (editing === 'new') {
        const res = await PhasesAPI.create(form);
        toast.success(
          res.claimed
            ? `${form.name} created — ${res.claimed} existing response${res.claimed === 1 ? '' : 's'} assigned to it`
            : `${form.name} created`
        );
      } else {
        const res = await PhasesAPI.update(editing._id, form);
        const moved = (res.claimed || 0) + (res.releasedFromThis || 0);
        toast.success(moved ? `Updated — ${moved} response(s) re-assigned` : 'Phase updated');
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (p, status) => {
    try {
      await PhasesAPI.update(p._id, { status });
      toast.success(status === 'open' ? `${p.name} is now collecting` : `${p.name} set to draft`);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const doClose = async () => {
    setBusy(true);
    try {
      const res = await PhasesAPI.close(closing._id);
      toast.success(
        res.batchesLocked
          ? `${closing.name} closed — ${res.batchesLocked} batch(es) locked`
          : `${closing.name} closed`
      );
      setClosing(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    try {
      await PhasesAPI.remove(p._id);
      toast.success(`${p.name} deleted`);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const totalResponses = phases.reduce((s, p) => s + p.responses, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Collection"
        title="Phases"
        subtitle="Each phase is one round of collection. Name the month you are collecting in, and every response that arrives lands in it — so Phase 1 and Phase 2 stay separate and can be compared."
        actions={<button className="btn-primary" onClick={openNew}><Icon name="plus" size={15} /> New phase</button>}
      />

      <SummaryStrip>
        <SummaryStat label="Phases" value={phases.length} icon="calendar" />
        <SummaryStat
          label="Collecting now"
          value={collecting ? 1 : 0}
          icon="activity"
          tone={collecting ? 'positive' : 'neutral'}
          sub={collecting ? collecting.name : 'no phase is open'}
        />
        <SummaryStat label="Responses in a phase" value={totalResponses.toLocaleString()} icon="inbox" />
        <SummaryStat
          label="Unassigned"
          value={unassigned.responses.toLocaleString()}
          icon="alert"
          tone={unassigned.responses > 0 ? 'warn' : 'neutral'}
          valueTone={unassigned.responses > 0 ? 'danger' : 'default'}
          hint="Feedback that falls outside every phase. It is collected and safe — but it belongs to no exercise, so it appears in no phase report. Widen a phase's dates, or create one covering those days."
          sub={unassigned.responses > 0 ? `${day(unassigned.firstAt)} – ${day(unassigned.lastAt)}` : 'all accounted for'}
        />
      </SummaryStrip>

      {/* The nudge that replaces auto-closing. Auto-close would eventually lock
          a batch while a class is mid-form; a reminder cannot. */}
      {overdue.map((p) => (
        <div key={p._id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <Icon name="alert" size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">{p.name}</span> passed its end date on {lastDay(p.endsAt)} and is still
            collecting. Close it when the last class has answered, or extend its dates.
          </p>
          <button className="btn-outline !py-1.5 text-xs" onClick={() => setClosing(p)}>Close phase</button>
        </div>
      ))}

      <Card
        title="All phases"
        icon="calendar"
        subtitle={phases.length ? `${phases.length} total · newest first` : undefined}
        hint="A response is stamped with the phase it was collected in, at the moment it is submitted. Editing a phase's dates re-assigns responses — except for closed phases, which never change."
      >
        {!data ? (
          <SkeletonRows rows={3} />
        ) : !phases.length ? (
          <EmptyState
            icon="calendar"
            title="No phases yet"
            hint="Create one for the month you are collecting in. Any feedback already inside those dates is assigned to it automatically."
            action={<button className="btn-primary" onClick={openNew}>New phase</button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {phases.map((p) => (
              <li key={p._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip bg-surface-2 text-muted ring-line">{p.code}</span>
                    <span className="truncate text-sm font-bold text-ink">{p.name}</span>
                    <StatusChip phase={p} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {day(p.startsAt)} – {lastDay(p.endsAt)}
                    {p.firstAt && (
                      <> · feedback ran {day(p.firstAt)} – {day(p.lastAt)}</>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <p className="tnum text-sm font-bold text-ink">{p.responses.toLocaleString()}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">responses</p>
                  </div>
                  <div className="text-right">
                    <p className="tnum text-sm font-bold text-ink">{p.average == null ? '—' : p.average.toFixed(2)}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">avg</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {p.responses > 0 && (
                    <Link to={`/admin?phase=${p._id}`} className="btn-ghost !px-2.5 !py-1.5 text-xs">
                      <Icon name="barChart" size={13} /> View
                    </Link>
                  )}
                  {p.status === 'draft' && (
                    <button className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => setStatus(p, 'open')}>
                      Start collecting
                    </button>
                  )}
                  {p.status === 'open' && (
                    <button className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => setClosing(p)}>
                      Close
                    </button>
                  )}
                  {p.status !== 'closed' && (
                    <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                      <Icon name="pencil" size={13} />
                    </button>
                  )}
                  {p.status !== 'closed' && p.responses === 0 && (
                    <button className="btn-ghost !px-2 !py-1.5 text-xs text-rose-600" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Create / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New phase' : `Edit ${editing?.name || ''}`}
        description="Pick the month you are collecting in. Feedback already inside those dates is assigned to this phase straight away."
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor="phase-name">Name</label>
            <input
              id="phase-name"
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Phase 2 — November 2026"
            />
          </div>

          <div>
            <label className="label" htmlFor="phase-code">
              Short code <span className="font-normal text-subtle">(for exports and chips)</span>
            </label>
            <input
              id="phase-code"
              className="input w-32 uppercase"
              required
              maxLength={12}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="P2"
            />
          </div>

          <div>
            <span className="label flex items-center gap-1.5">
              Month
              <InfoTooltip text="Picking a month fills in the whole month. If collection runs past the month end — which it will if it starts late — adjust the last day so the exercise is not split across two phases." />
            </span>
            <MonthRangePicker
              value={{ startsAt: form.startsAt, endsAt: form.endsAt }}
              onChange={(r) => setForm({ ...form, ...r })}
            />
          </div>

          <div>
            <label className="label" htmlFor="phase-notes">
              Notes <span className="font-normal text-subtle">(optional)</span>
            </label>
            <textarea
              id="phase-notes"
              rows={2}
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="What changed since the last phase?"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Create phase' : 'Save changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Close confirmation — irreversible, so it says exactly what happens. */}
      <Modal
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title={`Close ${closing?.name || ''}?`}
        description="Closing finishes this round of collection."
      >
        <div className="space-y-4">
          <ul className="space-y-2 text-sm text-ink">
            <li className="flex gap-2.5">
              <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-muted" />
              <span>Any batch still collecting is <strong>locked</strong>, so nothing can be submitted into a phase you have already reported on.</span>
            </li>
            <li className="flex gap-2.5">
              <Icon name="shield" size={15} className="mt-0.5 shrink-0 text-muted" />
              <span>Its <strong>{closing?.responses?.toLocaleString() || 0} responses are frozen</strong>. The figures can never change afterwards — which is what makes a phase report safe to circulate.</span>
            </li>
            <li className="flex gap-2.5">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-amber-600" />
              <span>This <strong>cannot be undone</strong>. A later straggler will not join it; create a new phase for further collection.</span>
            </li>
          </ul>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setClosing(null)}>Cancel</button>
            <button className="btn-primary" onClick={doClose} disabled={busy}>
              {busy ? 'Closing…' : 'Close phase'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
