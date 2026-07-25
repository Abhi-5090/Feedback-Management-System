import { useEffect, useId, useState } from 'react';
import { ParametersAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';
import Icon from '../../components/Icon.jsx';

/**
 * Reorder control. Two stacked chevrons rather than drag-and-drop: the list is
 * short, and arrows are keyboard-reachable and touch-safe by default. Both ends
 * of the list disable rather than hide their button so the control never
 * changes size mid-list — a shifting row is worse than a dimmed button.
 */
function ReorderButton({ dir, label, disabled, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-ring grid h-6 w-7 place-items-center rounded-md text-subtle transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-25"
    >
      <Icon name={dir === 'up' ? 'chevronUp' : 'chevronDown'} size={13} strokeWidth={2} />
    </button>
  );
}

/**
 * A metric in the summary strip: the number carries display weight, the label
 * sits under it in small caps. The eye lands on the figure, not the word.
 */
function SummaryStat({ icon, value, label, tone = 'ink', tooltip }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p
          className={`tnum text-display-sm leading-none ${
            tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : tone === 'subtle' ? 'text-subtle' : 'text-ink'
          }`}
        >
          {value}
        </p>
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </p>
      </div>
    </div>
  );
}

export default function Parameters() {
  const toast = useToast();
  const [params, setParams] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ label: '', description: '', order: 0 });
  const [busy, setBusy] = useState(false);
  // Which row was just reordered — gets a brief tint so the eye can follow it.
  const [movedId, setMovedId] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const labelId = useId();
  const descId = useId();
  const orderId = useId();

  const load = async () => {
    try { setParams(await ParametersAPI.list()); } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  // The tint is a confirmation, not decoration — it clears itself quickly.
  useEffect(() => {
    if (!movedId) return undefined;
    const t = setTimeout(() => setMovedId(null), 900);
    return () => clearTimeout(t);
  }, [movedId]);

  const openCreate = () => { setForm({ label: '', description: '', order: (params?.length || 0) }); setModal('create'); };
  const openEdit = (p) => { setForm({ label: p.label, description: p.description || '', order: p.order }); setModal(p); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { label: form.label, description: form.description, order: Number(form.order) };
      if (modal === 'create') { await ParametersAPI.create(body); toast.success('Parameter added'); }
      else { await ParametersAPI.update(modal._id, body); toast.success('Parameter updated'); }
      setModal(null); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const toggleActive = async (p) => {
    setPendingId(p._id);
    try { await ParametersAPI.update(p._id, { isActive: !p.isActive }); await load(); }
    catch (e) { toast.error(e.message); }
    finally { setPendingId(null); }
  };
  const move = async (p, dir) => {
    setPendingId(p._id);
    try { await ParametersAPI.update(p._id, { order: p.order + dir }); setMovedId(p._id); await load(); }
    catch (e) { toast.error(e.message); }
    finally { setPendingId(null); }
  };
  // Soft delete: history keeps the label, students simply stop seeing it.
  const softDelete = async (p) => { // eslint-disable-line no-unused-vars
    if (!confirm(`Deactivate "${p.label}"? Historical feedback keeps its label; it just won't be shown to new students.`)) return;
    try { await ParametersAPI.remove(p._id); toast.success('Parameter deactivated'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const activeCount = params?.filter((p) => p.isActive).length || 0;
  const total = params?.length || 0;
  const inactiveCount = total - activeCount;
  const blocked = params !== null && activeCount === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Feedback form"
        title="Rating parameters"
        subtitle="The star dimensions students rate (1–5). Rename, reorder, add or deactivate them. Students see only active parameters, top to bottom in exactly the order below."
        action={
          <button className="btn-primary" onClick={openCreate}>
            <Icon name="plus" size={15} />
            Add parameter
          </button>
        }
      />

      {/* Summary strip. The active count is the number that actually governs the
          student form, so it is set at display size rather than buried in prose. */}
      <section className="panel animate-fade-in p-5">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
          <SummaryStat
            icon="sliders"
            value={params === null ? '—' : activeCount}
            label="Active"
            tone={blocked ? 'rose' : 'ink'}
            tooltip="Students must give a 1–5 rating to every active parameter before they can submit. Deactivated ones are hidden from the form but kept on past feedback."
          />

          <div className="hidden h-10 w-px bg-line sm:block" aria-hidden="true" />

          <SummaryStat
            icon="eyeOff"
            value={params === null ? '—' : inactiveCount}
            label="Deactivated"
            tone="subtle"
          />

          {!blocked && total > 0 && (
            <p className="max-w-xs text-sm leading-relaxed text-muted">
              Every active parameter is mandatory — a student cannot submit until all
              {' '}<span className="tnum font-semibold text-ink">{activeCount}</span> are rated.
            </p>
          )}
        </div>
      </section>

      {blocked && (
        <div
          role="alert"
          className="flex animate-fade-up items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <Icon name="alert" size={16} />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">No active parameters — students cannot submit</p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800/80 dark:text-amber-300/80">
              The feedback form needs at least one active rating dimension. Activate an existing parameter or add a new one.
            </p>
          </div>
        </div>
      )}

      <Card
        title="Parameters"
        icon={<Icon name="sliders" size={15} />}
        hint="Order here is the order students see. Use the arrows to move a parameter up or down."
        subtitle={params === null ? undefined : `${total} total · shown top to bottom on the student form`}
        bodyClass="p-0"
      >
        {!params ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={5} /></div>
        ) : params.length === 0 ? (
          <EmptyState
            title="No parameters yet"
            hint="Add the rating dimensions students will score — things like content clarity, pace, or trainer knowledge."
            icon={<Icon name="sliders" size={22} className="text-muted" />}
            action={
              <button className="btn-primary" onClick={openCreate}>
                <Icon name="plus" size={15} />
                Add your first parameter
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {params.map((p, i) => {
              const isPending = pendingId === p._id;
              return (
                <li
                  key={p._id}
                  className={`flex items-center gap-3 px-4 py-3.5 transition-colors duration-200 ease-out sm:px-5 ${
                    movedId === p._id ? 'bg-brand-500/[0.08]' : 'bg-transparent'
                  } ${isPending ? 'opacity-70' : ''}`}
                >
                  <div className="flex shrink-0 flex-col">
                    <ReorderButton
                      dir="up"
                      label={`Move "${p.label}" up`}
                      disabled={i === 0 || isPending}
                      onClick={() => move(p, -1)}
                    />
                    <ReorderButton
                      dir="down"
                      label={`Move "${p.label}" down`}
                      disabled={i === params.length - 1 || isPending}
                      onClick={() => move(p, 1)}
                    />
                  </div>

                  {/* Position in the student form — a chip, because the number is
                      an identity here, not a stray digit next to the label. */}
                  <span
                    className="tnum hidden h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-300 sm:grid"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${p.isActive ? 'text-ink' : 'text-muted'}`}>{p.label}</p>
                    {p.description && <p className="truncate text-xs leading-relaxed text-muted">{p.description}</p>}
                  </div>

                  <span className={p.isActive ? 'chip-open' : 'chip-neutral'}>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.isActive ? 'bg-emerald-500' : 'bg-subtle'}`}
                      aria-hidden="true"
                    />
                    {p.isActive ? 'Active' : 'Deactivated'}
                  </span>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="btn-ghost !px-2.5 !py-1.5 text-xs"
                      onClick={() => openEdit(p)}
                      aria-label={`Edit "${p.label}"`}
                    >
                      <Icon name="pencil" size={13} />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    <button
                      className="btn-outline !px-2.5 !py-1.5 text-xs"
                      disabled={isPending}
                      onClick={() => toggleActive(p)}
                      aria-label={`${p.isActive ? 'Deactivate' : 'Activate'} "${p.label}"`}
                    >
                      <Icon name={p.isActive ? 'eyeOff' : 'check'} size={13} />
                      <span className="hidden sm:inline">{p.isActive ? 'Deactivate' : 'Activate'}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Add parameter' : 'Edit parameter'}
        description={
          modal === 'create'
            ? 'New parameters start active, so students will be asked to rate this straight away.'
            : 'Renaming is safe — past feedback keeps the label it was collected under.'
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor={labelId}>Label</label>
            <input
              id={labelId}
              className="input"
              required
              autoFocus
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Content clarity"
            />
            <p className="hint">Shown next to the stars. Keep it short enough to scan.</p>
          </div>
          <div>
            <label className="label" htmlFor={descId}>Description <span className="font-normal text-subtle">(optional)</span></label>
            <input
              id={descId}
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="How clear and well-structured the content was"
            />
            <p className="hint">A one-line clarification so students rate consistently.</p>
          </div>
          <div>
            <label className="label" htmlFor={orderId}>Order</label>
            <input
              id={orderId}
              className="input tnum"
              type="number"
              min={0}
              value={form.order}
              onChange={(e) => setForm({ ...form, order: e.target.value })}
            />
            <p className="hint">Lower numbers appear first. You can also reorder with the arrows in the list.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
