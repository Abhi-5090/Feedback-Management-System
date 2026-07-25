import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BatchesAPI, ClassesAPI, TrainersAPI } from '../../api/endpoints.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useToast } from '../../components/Toast.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import ExportButtons from '../../components/ExportButtons.jsx';
import InfoTooltip from '../../components/InfoTooltip.jsx';
import Icon from '../../components/Icon.jsx';
import TableSearch, { useSearchFilter } from '../../components/TableSearch.jsx';

/**
 * Copy state that resolves itself. A toast alone is easy to miss when the user's
 * eye is on the button they just pressed, so the button answers in place: the
 * label swaps to a checkmark for ~1.5s, then quietly returns.
 */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      return false;
    }
  }, []);

  return [copied, copy];
}

/** A read-only value paired with a copy button that confirms itself. */
function CopyField({ label, value, mono, hint }) {
  const toast = useToast();
  const [copied, copy] = useCopy();
  const id = useId();

  const onCopy = async () => {
    if (await copy(value)) toast.success(`${label} copied`);
    else toast.error('Copy failed — select and copy manually');
  };

  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          className={`input ${mono ? 'font-mono tracking-wider' : ''}`}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="btn-outline shrink-0"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/**
 * A metric in the summary strip: number at display size, label in small caps
 * beneath it. The figure is what the operator is scanning for.
 */
function SummaryStat({ icon, value, label, children, tooltip }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="tnum text-display-sm leading-none text-ink">{value}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {children}
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </p>
      </div>
    </div>
  );
}

/**
 * Live progress toward the expected head-count. Animated with scaleX rather
 * than width: width relayouts the row on every frame, scaleX is composited.
 */
function LiveCount({ submitted, expected, live }) {
  const pct = expected > 0 ? Math.min(100, Math.round((submitted / expected) * 100)) : 0;
  const complete = expected > 0 && submitted >= expected;

  return (
    <div className="flex items-center gap-2.5">
      {live && (
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse-ring rounded-full bg-emerald-500"
          aria-hidden="true"
        />
      )}
      <span className="tnum shrink-0 text-sm font-semibold text-ink">
        {submitted}
        <span className="font-normal text-muted">/{expected || '—'}</span>
      </span>
      <div
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}% — ${submitted} of ${expected || 'unknown'} responses received`}
        aria-label={`${submitted} of ${expected || 'unknown'} responses received`}
      >
        <div
          className={`h-full w-full origin-left rounded-full transition-transform duration-200 ease-out-expo ${
            complete ? 'bg-emerald-500' : 'bg-brand-500'
          }`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
    </div>
  );
}

/** Open / locked, as an icon plus a word — never colour alone. */
function StatusChip({ open }) {
  return (
    <span className={open ? 'chip-open' : 'chip-locked'}>
      <Icon name={open ? 'unlock' : 'lock'} size={12} strokeWidth={1.8} />
      {open ? 'Open' : 'Locked'}
    </span>
  );
}

/* Searchable fields for a batch row. A batch now spans several classes, so all
   of their names and trainers are searchable. Status is included as plain words
   so typing "open" filters to live cohorts without a separate status control. */
const BATCH_FIELDS = (b) => [
  b.name,
  ...(b.classes || []).map((c) => c?.name),
  ...(b.classes || []).map((c) => c?.trainer?.name),
  b.status,
  b.status === 'open' ? 'open live accepting' : 'locked closed',
];

export default function Batches() {
  const [query, setQuery] = useState('');
  const toast = useToast();
  const [batches, setBatches] = useState(null);
  const [classes, setClasses] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [createModal, setCreateModal] = useState(false);
  // classes: [{ class: id, trainer: id }] — trainer defaults to the class's
  // catalog trainer but is overridable per batch.
  const [form, setForm] = useState({ classes: [], name: '', expectedCount: 30 });
  const [unlockModal, setUnlockModal] = useState(null); // batch
  const [expected, setExpected] = useState(30);
  const [reveal, setReveal] = useState(null); // { batch, passcode }
  const [busy, setBusy] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null); // batch awaiting confirm
  const [archiving, setArchiving] = useState(false);

  const classId = useId();
  const nameId = useId();
  const expectedId = useId();
  const unlockExpectedId = useId();

  const load = useCallback(async () => {
    try { setBatches(await BatchesAPI.list()); } catch (e) { toast.error(e.message); }
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        const [cls, trs] = await Promise.all([ClassesAPI.list(), TrainersAPI.list()]);
        setClasses(cls);
        setTrainers(trs.filter((t) => t.isActive !== false));
      } catch (e) {
        toast.error(e.message);
      }
    })();
  }, [toast]);
  usePolling(load, 8000, true); // live submitted/expected

  useEffect(() => {
    if (!copiedLinkId) return undefined;
    const t = setTimeout(() => setCopiedLinkId(null), 1500);
    return () => clearTimeout(t);
  }, [copiedLinkId]);

  const studentLink = (b) => `${window.location.origin}/feedback/${b._id}`;

  const openCreate = () => {
    setForm({ classes: [], name: '', expectedCount: 30 });
    setCreateModal(true);
  };

  // Toggle a class in/out of the batch. Adding it defaults its trainer to the
  // class's catalog trainer, which the admin can then override per batch.
  const toggleClass = (klass) =>
    setForm((f) => {
      const on = f.classes.some((e) => e.class === klass._id);
      return {
        ...f,
        classes: on
          ? f.classes.filter((e) => e.class !== klass._id)
          : [...f.classes, { class: klass._id, trainer: klass.trainer?._id || '' }],
      };
    });

  const setClassTrainer = (classId, trainerId) =>
    setForm((f) => ({
      ...f,
      classes: f.classes.map((e) => (e.class === classId ? { ...e, trainer: trainerId } : e)),
    }));

  const create = async (e) => {
    e.preventDefault();
    if (!form.classes.length) return toast.error('Select at least one class.');
    if (form.classes.some((e) => !e.trainer)) return toast.error('Pick a trainer for every selected class.');
    setBusy(true);
    try {
      await BatchesAPI.create({ classes: form.classes, name: form.name, expectedCount: Number(form.expectedCount) });
      toast.success('Batch created'); setCreateModal(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const doUnlock = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await BatchesAPI.unlock(unlockModal._id, Number(expected));
      setUnlockModal(null);
      setReveal({ batch: res.batch, passcode: res.passcode });
      toast.success('Batch unlocked — passcode generated');
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const doLock = async (b) => {
    if (!confirm(`Lock "${b.name}"? This closes the window and invalidates the passcode.`)) return;
    try { await BatchesAPI.lock(b._id); toast.success('Batch locked'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const rotate = async (b) => {
    try {
      const res = await BatchesAPI.rotatePasscode(b._id);
      setReveal({ batch: res.batch, passcode: res.passcode });
      toast.success('New passcode generated');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const copyLink = async (b) => {
    try {
      await navigator.clipboard.writeText(studentLink(b));
      setCopiedLinkId(b._id);
      toast.success('Student link copied');
    } catch {
      toast.error('Copy failed — open the batch and copy manually');
    }
  };

  /* Soft delete: submissions stay in the database, the batch is just filtered
     out of the list. The server also closes an open window and invalidates the
     passcode as a side effect — the confirm dialog says so before we get here. */
  const doArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await BatchesAPI.archive(archiveTarget._id, true);
      toast.success('Batch archived');
      setArchiveTarget(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setArchiving(false); }
  };

  /* Re-read the pending target from the polled list: the 8s refresh can lock a
     batch or land new responses while the dialog is open, and the open-batch
     passcode warning has to reflect what is true now, not at click time. */
  const archiveBatch = archiveTarget
    ? batches?.find((b) => b._id === archiveTarget._id) || archiveTarget
    : null;

  const openCount = batches?.filter((b) => b.status === 'open').length || 0;
  const shown = useSearchFilter(batches, query, BATCH_FIELDS);
  const totalSubmitted = batches?.reduce((s, b) => s + (b.submittedCount || 0), 0) || 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Collection"
        title="Batches"
        subtitle="Each batch is a cohort spanning one or more classes, with its own passcode and open/closed window. Unlock to generate a passcode and open feedback; lock to close it."
        action={
          <button className="btn-primary" onClick={openCreate}>
            <Icon name="plus" size={15} />
            New batch
          </button>
        }
      />

      {/* Operational summary. Open batches are the only ones actively taking
          submissions, so that count carries the live indicator. */}
      <section className="panel animate-fade-in p-5">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
          <SummaryStat
            icon="unlock"
            value={batches === null ? '—' : openCount}
            label="Open now"
            tooltip="An open batch is accepting submissions: its passcode works and students can rate it until you lock it or the expected count is reached."
          >
            {openCount > 0 && (
              <span
                className="h-1.5 w-1.5 shrink-0 animate-pulse-ring rounded-full bg-emerald-500"
                aria-hidden="true"
              />
            )}
          </SummaryStat>

          <div className="hidden h-10 w-px bg-line sm:block" aria-hidden="true" />

          <SummaryStat
            icon="inbox"
            value={batches === null ? '—' : totalSubmitted}
            label="Responses collected"
          />

          {batches !== null && (
            <p className="max-w-xs text-sm leading-relaxed text-muted">
              <span className="tnum font-semibold text-ink">{batches.length}</span> batch
              {batches.length === 1 ? '' : 'es'} total · live counts refresh every few seconds.
            </p>
          )}
        </div>
      </section>

      <Card
        title="All batches"
        icon={<Icon name="ticket" size={15} />}
        hint="A batch is one cohort — the unit students submit against — spanning one or more classes. Unlocking opens its feedback window and mints a fresh passcode."
        subtitle={
          batches === null
            ? undefined
            : query
              ? `${shown.length} of ${batches.length} matching “${query}”`
              : `${batches.length} total · ${openCount} accepting submissions`
        }
        actions={
          batches?.length ? (
            <TableSearch
              label="batches"
              value={query}
              onChange={setQuery}
              placeholder="Search batch, class or status…"
            />
          ) : null
        }
        bodyClass="p-0"
      >
        {!batches ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={5} /></div>
        ) : batches.length === 0 ? (
          <EmptyState
            title="No batches yet"
            hint="Create a batch, select its classes, then unlock it to generate a passcode and start collecting feedback."
            icon={<Icon name="ticket" size={22} className="text-muted" />}
            action={
              <button className="btn-primary" onClick={openCreate}>
                <Icon name="plus" size={15} />
                Create your first batch
              </button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No batches match that search"
            hint={`Nothing matched “${query}”. Try a batch name, class, trainer, or “open”.`}
            icon={<Icon name="search" size={22} className="text-muted" />}
            action={<button className="btn-outline" onClick={() => setQuery('')}>Clear search</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="th text-left">Batch</th>
                  <th className="th text-left">Classes</th>
                  <th className="th text-left">Status</th>
                  <th className="th text-left">
                    <span className="inline-flex items-center gap-1.5">
                      Live count
                      <InfoTooltip text="Submitted / expected. Refreshes every few seconds while a batch is open. Submissions are blocked once the expected count is reached." />
                    </span>
                  </th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => {
                  const isOpen = b.status === 'open';
                  return (
                    <tr key={b._id} className="tr-hover border-b border-line last:border-0">
                      <td className="td">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                              isOpen
                                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                                : 'bg-surface-2 text-subtle'
                            }`}
                          >
                            <Icon name="ticket" size={15} />
                          </span>
                          <span className="font-semibold text-ink">{b.name}</span>
                        </div>
                      </td>
                      <td className="td">
                        {(b.classes || []).length === 0 ? (
                          <span className="text-subtle">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {b.classes.slice(0, 3).map((c) => (
                              <span
                                key={c._id}
                                className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink"
                                title={c.trainer?.name ? `${c.name} · ${c.trainer.name}` : c.name}
                              >
                                {c.name}
                              </span>
                            ))}
                            {b.classes.length > 3 && (
                              <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                                +{b.classes.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="td">
                        <StatusChip open={isOpen} />
                      </td>
                      <td className="td">
                        <LiveCount
                          submitted={b.submittedCount || 0}
                          expected={b.expectedCount || 0}
                          live={isOpen}
                        />
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {isOpen ? (
                            <>
                              <button
                                className="btn-ghost !px-2.5 !py-1.5 text-xs"
                                onClick={() => copyLink(b)}
                                aria-label={`Copy student link for ${b.name}`}
                              >
                                <Icon name={copiedLinkId === b._id ? 'check' : 'link'} size={13} />
                                {copiedLinkId === b._id ? 'Copied' : 'Link'}
                              </button>
                              <button
                                className="btn-ghost !px-2.5 !py-1.5 text-xs"
                                onClick={() => rotate(b)}
                                aria-label={`Generate a new passcode for ${b.name}`}
                              >
                                <Icon name="refresh" size={13} />
                                New code
                              </button>
                              <button
                                className="btn-outline !px-2.5 !py-1.5 text-xs"
                                onClick={() => doLock(b)}
                                aria-label={`Lock ${b.name}`}
                              >
                                <Icon name="lock" size={13} />
                                Lock
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-primary !px-2.5 !py-1.5 text-xs"
                              onClick={() => { setUnlockModal(b); setExpected(b.expectedCount || 30); }}
                              aria-label={`Unlock ${b.name}`}
                            >
                              <Icon name="unlock" size={13} />
                              Unlock
                            </button>
                          )}
                          <Link
                            to={`/admin/batch/${b._id}`}
                            className="btn-ghost !px-2.5 !py-1.5 text-xs"
                            aria-label={`View feedback for ${b.name}`}
                          >
                            <Icon name="barChart" size={13} />
                            Feedback
                          </Link>
                          <span className="[&_button]:!px-2.5 [&_button]:!py-1.5 [&_button]:!text-xs">
                            <ExportButtons path={`/export/batch/${b._id}`} baseName={`batch_${b.name}`} />
                          </span>
                          <button
                            className="btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600 hover:!bg-rose-500/10 hover:!text-rose-700 dark:text-rose-400"
                            onClick={() => setArchiveTarget(b)}
                            aria-label={`Archive ${b.name}`}
                          >
                            <Icon name="trash" size={14} />
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create batch */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="New batch"
        description="A batch is a cohort that can span several classes. Students rate every class in it. It starts locked — unlock it when you're ready to collect."
      >
        <form onSubmit={create} className="space-y-4">
          <div>
            <label className="label" htmlFor={classId}>
              Classes <span className="font-normal text-subtle">(one or more)</span>
            </label>
            {classes.length === 0 ? (
              <p className="mt-1.5 text-xs text-rose-500">Create a class first.</p>
            ) : (
              <div
                id={classId}
                className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-line p-1.5"
              >
                {classes.map((c) => {
                  const entry = form.classes.find((e) => e.class === c._id);
                  const on = Boolean(entry);
                  return (
                    <div key={c._id} className={`rounded-lg ${on ? 'bg-brand-500/10' : ''}`}>
                      <button
                        type="button"
                        onClick={() => toggleClass(c)}
                        aria-pressed={on}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150 ${
                          on ? '' : 'hover:bg-surface-2'
                        }`}
                      >
                        <span
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors duration-150 ${
                            on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line'
                          }`}
                        >
                          {on && <Icon name="check" size={11} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-semibold text-ink">{c.name}</span>
                          {c.trainer?.name && <span className="text-subtle"> · default {c.trainer.name}</span>}
                        </span>
                      </button>
                      {/* Per-batch trainer for THIS class — defaults to the
                          class's catalog trainer, overridable here. */}
                      {on && (
                        <div className="flex items-center gap-2 px-2.5 pb-2 pl-9">
                          <span className="shrink-0 text-[11px] font-medium text-muted">Trainer</span>
                          <select
                            className="input !h-8 !py-1 text-xs"
                            value={entry.trainer}
                            onChange={(e) => setClassTrainer(c._id, e.target.value)}
                            aria-label={`Trainer for ${c.name}`}
                          >
                            <option value="" disabled>Select trainer</option>
                            {trainers.map((t) => (
                              <option key={t._id} value={t._id}>
                                {t.name}
                                {String(t._id) === String(c.trainer?._id) ? ' (default)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="hint">
              <span className="tnum font-semibold text-ink">{form.classes.length}</span> selected · students
              rate every selected class. Each class can have its own trainer for this batch.
            </p>
          </div>
          <div>
            <label className="label" htmlFor={nameId}>Batch name</label>
            <input
              id={nameId}
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="FSD-Aug-2025"
            />
            <p className="hint">The passcode is derived from this name (e.g. “FSD Aug 2025” → stem “FA2”).</p>
          </div>
          <div>
            <label className="label" htmlFor={expectedId}>Expected responses <span className="font-normal text-subtle">(class size)</span></label>
            <input
              id={expectedId}
              className="input tnum"
              type="number"
              min={0}
              value={form.expectedCount}
              onChange={(e) => setForm({ ...form, expectedCount: e.target.value })}
            />
            <p className="hint">Sets the target for the live counter. You can change it when you unlock.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setCreateModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      {/* Unlock */}
      <Modal
        open={!!unlockModal}
        onClose={() => setUnlockModal(null)}
        title={`Unlock “${unlockModal?.name}”`}
        description="Unlocking generates a fresh passcode (any old one stops working) and opens the feedback window."
      >
        <form onSubmit={doUnlock} className="space-y-4">
          <div>
            <label className="label" htmlFor={unlockExpectedId}>
              <span className="inline-flex items-center gap-1.5">
                Expected responses (cap)
                <InfoTooltip text="A hard cap, not just a target. Once this many responses arrive the batch stops accepting submissions — it keeps a cohort's feedback from being padded out." />
              </span>
            </label>
            <input
              id={unlockExpectedId}
              className="input tnum"
              type="number"
              min={1}
              required
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
            <p className="hint">Submissions are blocked once this many responses arrive.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setUnlockModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock & generate'}</button>
          </div>
        </form>
      </Modal>

      {/* Passcode reveal — shown ONCE, so it gets the whole stage. */}
      <Modal
        open={!!reveal}
        onClose={() => setReveal(null)}
        title="Passcode — copy it now"
        description={reveal ? `For “${reveal.batch?.name}”. This is the only time it will be displayed.` : undefined}
      >
        {reveal && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              <span className="mt-px shrink-0">
                <Icon name="alert" size={14} />
              </span>
              <p>
                This passcode is shown <b>once</b>. Only a hash is stored, so it cannot be looked up later —
                if you lose it, generate a replacement with “New code”.
              </p>
            </div>

            <PasscodeReveal passcode={reveal.passcode} />

            <CopyField
              label="Student link"
              value={`${window.location.origin}/feedback/${reveal.batch._id}`}
              hint="Share the link and the passcode together. Students rate every class in the batch on all parameters and leave a comment per class — anonymously."
            />

            <div className="flex justify-end pt-1">
              <button className="btn-primary" onClick={() => setReveal(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Archive confirm. An open batch loses its window and its passcode the
          moment this succeeds, so that consequence gets its own callout rather
          than being buried in a sentence. */}
      <Modal
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title={`Archive “${archiveBatch?.name}”?`}
        description="Archiving hides a batch from the lists. It is not a delete."
      >
        <div className="space-y-4">
          <div className="well space-y-2.5 p-4 text-sm leading-relaxed text-muted">
            <p className="flex items-start gap-2.5">
              <Icon name="eyeOff" size={15} className="mt-0.5 shrink-0 text-subtle" />
              <span>
                <span className="font-medium text-ink">{archiveBatch?.name}</span> will be hidden
                from the batches list and from exports and reports that read it.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="checkCircle" size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Its{' '}
                <span className="tnum font-medium text-ink">{archiveBatch?.submittedCount || 0}</span>{' '}
                collected {archiveBatch?.submittedCount === 1 ? 'response' : 'responses'} and all
                history are <span className="font-medium text-ink">preserved</span> — nothing is
                deleted, and the batch can be restored later.
              </span>
            </p>
          </div>

          {archiveBatch?.status === 'open' && (
            <div
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
              role="alert"
            >
              <span className="mt-px shrink-0">
                <Icon name="alert" size={14} />
              </span>
              <p>
                This batch is <b>open</b>. Archiving closes its feedback window and invalidates the
                current passcode — students holding it will no longer be able to submit. Reopening
                later requires generating a new passcode.
              </p>
            </div>
          )}

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

/**
 * The passcode itself. Set large, monospace and widely tracked so it can be read
 * aloud to a room or transcribed off a projector without ambiguity — this string
 * is never recoverable, so legibility here is the whole job.
 */
function PasscodeReveal({ passcode }) {
  const toast = useToast();
  const [copied, copy] = useCopy();

  const onCopy = async () => {
    if (await copy(passcode)) toast.success('Passcode copied');
    else toast.error('Copy failed — select and copy manually');
  };

  return (
    <div className="well animate-scale-in overflow-hidden p-5 text-center">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Passcode</p>
      <p
        className="tnum select-all break-all font-mono text-3xl font-bold leading-tight text-ink sm:text-4xl"
        style={{ letterSpacing: '0.18em', textIndent: '0.18em' }}
      >
        {passcode}
      </p>
      <button
        type="button"
        onClick={onCopy}
        className="btn-primary mt-4"
        aria-label="Copy passcode to clipboard"
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? 'Copied to clipboard' : 'Copy passcode'}
      </button>
    </div>
  );
}
