import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClassesAPI, ClassesArchiveAPI, TrainersAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';
import Icon from '../../components/Icon.jsx';
import Pagination, { usePagination } from '../../components/Pagination.jsx';
import TableSearch, { useSearchFilter } from '../../components/TableSearch.jsx';

/* ── Small presentational helpers (local to this page) ───────────────────── */

/** Status always pairs colour WITH text — colour alone is not an accessible signal. */
function StatusChip({ active }) {
  return (
    <span className={active ? 'chip-open' : 'chip-locked'}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-subtle'}`}
        aria-hidden="true"
      />
      {active ? 'Active' : 'Disabled'}
    </span>
  );
}

/** Trainer cell — an unassigned class is a real problem, so it reads as one. */
function TrainerLabel({ trainer }) {
  if (!trainer?.name) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
        <Icon name="alert" size={14} />
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-muted">
      <Icon name="user" size={14} className="shrink-0 text-subtle" />
      <span className="truncate">{trainer.name}</span>
    </span>
  );
}

/**
 * One figure in the summary strip. The number leads at display size and the
 * label sits under it in small caps — the eye lands on the value, not the word.
 */
function Metric({ icon, label, value, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400',
    positive: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    warn: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  };
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-display-sm tnum leading-none text-ink">{value}</p>
        <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </p>
      </div>
    </div>
  );
}

const PER_PAGE = 7;

/* Searchable fields for a class row — includes the assigned trainer's name so
   "find everything Asha teaches" works from this table. */
const CLASS_FIELDS = (c) => [
  c.name,
  c.description,
  c.trainer?.name,
  c.trainer?.email,
  c.isActive ? 'active' : 'disabled',
];

export default function Classes() {
  const [query, setQuery] = useState('');
  const toast = useToast();
  const [classes, setClasses] = useState(null);
  const [trainers, setTrainers] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', trainer: '' });
  const [busy, setBusy] = useState(false);
  /* The class awaiting archive confirmation. Held separately from `modal` so the
     edit form and the destructive confirm can never share state. */
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);

  const load = async () => {
    try {
      const [c, t] = await Promise.all([ClassesAPI.list(), TrainersAPI.list()]);
      setClasses(c); setTrainers(t.filter((x) => x.isActive));
    } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const openCreate = () => { setForm({ name: '', description: '', trainer: trainers[0]?._id || '' }); setModal('create'); };
  const openEdit = (c) => { setForm({ name: c.name, description: c.description || '', trainer: c.trainer?._id || '' }); setModal(c); };

  const save = async (e) => {
    e.preventDefault();
    if (!form.trainer) return toast.error('Assign a trainer first (create one if none exist).');
    setBusy(true);
    try {
      if (modal === 'create') { await ClassesAPI.create(form); toast.success('Class created'); }
      else { await ClassesAPI.update(modal._id, form); toast.success('Class updated'); }
      setModal(null); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const toggleActive = async (c) => {
    try { await ClassesAPI.update(c._id, { isActive: !c.isActive }); load(); }
    catch (e) { toast.error(e.message); }
  };

  /* Archiving is a soft delete: the record and all its feedback stay in the
     database, the class is just filtered out of the lists. The row disappears
     after load() because archived classes are excluded server-side. */
  const doArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await ClassesArchiveAPI.archive(archiveTarget._id, true);
      toast.success('Class archived');
      setArchiveTarget(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setArchiving(false); }
  };

  const isCreate = modal === 'create';
  const noTrainers = trainers.length === 0;
  const activeCount = classes?.filter((c) => c.isActive).length ?? 0;
  const unassignedCount = classes?.filter((c) => !c.trainer?.name).length ?? 0;
  const shown = useSearchFilter(classes, query, CLASS_FIELDS);
  const pg = usePagination(shown, PER_PAGE, query);

  const newClassBtn = (
    <button className="btn-primary" onClick={openCreate}>
      <Icon name="plus" size={16} /> New class
    </button>
  );

  /* Row action cluster — shared by the table and the mobile card list so the
     two layouts can never drift apart. Deliberately a plain function, not a
     component: a component declared in the render body gets a new identity each
     render, so the reload after toggling would remount these buttons and steal
     focus from the key the user just pressed. */
  const rowActions = (c) => (
    <>
      <Link
        className="btn-ghost !px-2.5 !py-1.5 text-xs"
        to={`/admin/class/${c._id}`}
        aria-label={`View feedback for ${c.name}`}
      >
        <Icon name="barChart" size={14} /> View feedback
      </Link>
      <button
        className="btn-ghost !px-2.5 !py-1.5 text-xs"
        onClick={() => openEdit(c)}
        aria-label={`Edit ${c.name}`}
      >
        <Icon name="pencil" size={14} /> Edit
      </button>
      {c.isActive ? (
        <button
          className="btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600 hover:!bg-rose-500/10 hover:!text-rose-700 dark:text-rose-400"
          onClick={() => toggleActive(c)}
          aria-label={`Disable ${c.name}`}
        >
          <Icon name="lock" size={14} /> Disable
        </button>
      ) : (
        <button
          className="btn-outline !px-2.5 !py-1.5 text-xs"
          onClick={() => toggleActive(c)}
          aria-label={`Enable ${c.name}`}
        >
          <Icon name="unlock" size={14} /> Enable
        </button>
      )}
      <button
        className="btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600 hover:!bg-rose-500/10 hover:!text-rose-700 dark:text-rose-400"
        onClick={() => setArchiveTarget(c)}
        aria-label={`Archive ${c.name}`}
      >
        <Icon name="trash" size={14} /> Archive
      </button>
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Curriculum"
        title="Classes"
        subtitle="A class is a training subject assigned to one trainer. Feedback is collected per batch of a class."
        action={newClassBtn}
      />

      {/* A class cannot exist without a trainer — surface that before the user
          hits the form and gets rejected. */}
      {classes && noTrainers && (
        <div className="well flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="flex items-start gap-2 text-sm text-muted">
            <Icon
              name="alert"
              size={16}
              className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400"
            />
            <span>
              <span className="font-medium text-ink">No active trainers.</span>{' '}
              Every class must be assigned to one, so add a trainer before creating classes.
            </span>
          </p>
          <Link className="btn-outline !px-3 !py-1.5 text-xs" to="/admin/trainers">
            Go to trainers <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      )}

      {/* Summary strip — totals plus the one number that signals a problem.
          Dividers switch axis with the layout so the grid never orphans. */}
      <div className="panel animate-fade-up divide-y divide-line sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {!classes ? (
          <>
            <div className="px-5 py-4"><div className="skeleton h-10 w-24" /></div>
            <div className="px-5 py-4"><div className="skeleton h-10 w-24" /></div>
            <div className="px-5 py-4"><div className="skeleton h-10 w-24" /></div>
          </>
        ) : (
          <>
            <Metric icon="book" label="Total classes" value={classes.length} />
            <Metric icon="checkCircle" label="Active" value={activeCount} tone="positive" />
            <Metric
              icon="alert"
              label="Unassigned"
              value={unassignedCount}
              tone={unassignedCount > 0 ? 'warn' : 'brand'}
            />
          </>
        )}
      </div>

      <Card
        title="All classes"
        icon={<Icon name="book" size={15} className="text-brand-600 dark:text-brand-400" />}
        hint="A class is a subject you train. It belongs to exactly one trainer, and each run of it is a batch — feedback is collected per batch."
        subtitle={
          classes
            ? query
              ? `${shown.length} of ${classes.length} matching “${query}”`
              : `${classes.length} total · ${activeCount} active`
            : 'Loading…'
        }
        actions={
          classes?.length ? (
            <TableSearch
              label="classes"
              value={query}
              onChange={setQuery}
              placeholder="Search class or trainer…"
            />
          ) : null
        }
        bodyClass="p-0"
      >
        {!classes ? (
          <div className="p-4 sm:p-5">
            <SkeletonRows rows={5} />
          </div>
        ) : classes.length === 0 ? (
          <EmptyState
            title="No classes yet"
            hint="Create a class, assign it to a trainer, then open batches under it to start collecting feedback."
            icon={<Icon name="book" size={24} className="text-muted" />}
            action={newClassBtn}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No classes match that search"
            hint={`Nothing matched “${query}”. Try a different class or trainer name.`}
            icon={<Icon name="search" size={24} className="text-muted" />}
            action={<button className="btn-outline" onClick={() => setQuery('')}>Clear search</button>}
          />
        ) : (
          <>
            {/* ── Mobile: stacked cards. A 5-column table is unreadable under 640px. ── */}
            <ul className="stagger divide-y divide-line/60 sm:hidden">
              {pg.slice.map((c) => (
                <li key={c._id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                      {c.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
                          {c.description}
                        </p>
                      )}
                    </div>
                    <StatusChip active={c.isActive} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <TrainerLabel trainer={c.trainer} />
                    <span aria-hidden="true" className="text-subtle">·</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="ticket" size={14} className="text-subtle" />
                      <span className="tnum font-semibold text-ink">{c.batchCount}</span>
                      {c.batchCount === 1 ? 'batch' : 'batches'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {rowActions(c)}
                  </div>
                </li>
              ))}
            </ul>

            {/* ── Desktop: full table ── */}
            <div className="hidden max-h-[28rem] overflow-auto sm:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="th">Class</th>
                    <th scope="col" className="th">
                      <span className="inline-flex items-center gap-1.5">
                        Trainer
                        <InfoTooltip text="Each class is assigned to exactly one trainer. They are the only trainer who can see this class's feedback." />
                      </span>
                    </th>
                    <th scope="col" className="th">
                      <span className="inline-flex items-center gap-1.5">
                        Batches
                        <InfoTooltip text="A batch is one run of this class with a specific group of students. Feedback is collected per batch." />
                      </span>
                    </th>
                    <th scope="col" className="th">
                      <span className="inline-flex items-center gap-1.5">
                        Status
                        <InfoTooltip text="Disabling a class hides it from new batches and feedback collection. Existing batches and their feedback are kept." />
                      </span>
                    </th>
                    <th scope="col" className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {pg.slice.map((c) => (
                    <tr key={c._id} className="tr-hover">
                      <td className="td">
                        <p className="font-medium text-ink">{c.name}</p>
                        {c.description && (
                          <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">
                            {c.description}
                          </p>
                        )}
                      </td>
                      <td className="td"><TrainerLabel trainer={c.trainer} /></td>
                      <td className="td tnum">{c.batchCount}</td>
                      <td className="td"><StatusChip active={c.isActive} /></td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {rowActions(c)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={pg.page}
              pages={pg.pages}
              setPage={pg.setPage}
              from={pg.from}
              to={pg.to}
              total={pg.total}
              unit={query ? "matching classes" : "classes"}
            />
          </>
        )}
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isCreate ? 'New class' : 'Edit class'}
        description="A class belongs to exactly one trainer — only they can see its feedback. Each run of the class is a batch, and feedback is collected per batch."
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor="class-name">Class name</label>
            <input
              id="class-name"
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="React Fundamentals"
            />
            <p className="hint">The subject as students will recognise it.</p>
          </div>
          <div>
            <label className="label" htmlFor="class-description">Description (optional)</label>
            <input
              id="class-description"
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Intro to hooks, state, effects…"
            />
            <p className="hint">Shown to students when they give feedback.</p>
          </div>
          <div>
            <label className="label" htmlFor="class-trainer">Assigned trainer</label>
            <select
              id="class-trainer"
              className="input"
              required
              value={form.trainer}
              onChange={(e) => setForm({ ...form, trainer: e.target.value })}
              aria-invalid={noTrainers ? 'true' : undefined}
              aria-describedby={noTrainers ? 'class-trainer-error' : undefined}
            >
              <option value="" disabled>Select a trainer</option>
              {trainers.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            {noTrainers ? (
              <p
                id="class-trainer-error"
                className="hint flex items-center gap-1.5 text-rose-600 dark:text-rose-400"
                role="alert"
              >
                <Icon name="alert" size={13} className="shrink-0" />
                No active trainers — create one first.
              </p>
            ) : (
              <p className="hint">Only this trainer will see feedback for the class.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Archive confirm. Destructive-looking but recoverable — the copy leads
          with what is kept, so the operator isn't guessing what they just lost. */}
      <Modal
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title={`Archive “${archiveTarget?.name}”?`}
        description="Archiving hides a class from the lists. It is not a delete."
      >
        <div className="space-y-4">
          <div className="well space-y-2.5 p-4 text-sm leading-relaxed text-muted">
            <p className="flex items-start gap-2.5">
              <Icon name="eyeOff" size={15} className="mt-0.5 shrink-0 text-subtle" />
              <span>
                <span className="font-medium text-ink">{archiveTarget?.name}</span> will be hidden
                from the classes list and from the batch-creation picker.
                {archiveTarget?.batchCount > 0 && (
                  <> Its <span className="tnum font-medium text-ink">{archiveTarget.batchCount}</span>{' '}
                  {archiveTarget.batchCount === 1 ? 'batch' : 'batches'} go with it.</>
                )}
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="checkCircle" size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                All feedback and history is <span className="font-medium text-ink">preserved</span> —
                nothing is deleted, and the class can be restored later.
              </span>
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={() => setArchiveTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={doArchive} disabled={archiving}>
              {archiving ? 'Archiving…' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
