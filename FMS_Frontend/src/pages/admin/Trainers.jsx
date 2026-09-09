import { useEffect, useState } from 'react';
import { TrainersAPI } from '../../api/endpoints.js';
import { useToast } from '../../components/Toast.jsx';
import Card, { EmptyState } from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import { SkeletonRows } from '../../components/Spinner.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import BulkUploadTrainers from '../../components/BulkUploadTrainers.jsx';
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
        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`}
        aria-hidden="true"
      />
      {active ? 'Active' : 'Disabled'}
    </span>
  );
}

/** Initials avatar — gives each row a fixed anchor point so the list scans vertically. */
function Avatar({ name }) {
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-500/20 dark:text-brand-300"
      aria-hidden="true"
    >
      {initials}
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
    neutral: 'bg-surface-2 text-muted',
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

const PER_PAGE = 10;

/* Fields a trainer row can be matched on. Kept beside the page (not inline)
   so the reference is stable and useSearchFilter's memo actually holds. */
/* Searchable fields. `deployment` is included as plain words so typing
   "support" or "unassigned" filters the roster by how a mentor is actually
   deployed — the question an admin asks when staffing a new batch. */
const TRAINER_FIELDS = (t) => [
  t.name,
  t.shortName,
  t.email,
  t.phone,
  t.deployment,
  t.isActive ? 'active' : 'disabled inactive',
];

export default function Trainers() {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [query, setQuery] = useState('');
  const toast = useToast();
  const [trainers, setTrainers] = useState(null);
  const [modal, setModal] = useState(null); // null | 'create' | trainerObj
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      // Paginated now; ask for a wide window and keep the existing
      // client-side search over it. `archived: 'all'` so deactivated
      // mentors stay visible and can be reactivated.
      const res = await TrainersAPI.list({ limit: 200, archived: 'all' });
      setTrainers(res.trainers);
    } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const openCreate = () => { setForm({ name: '', email: '', password: '' }); setModal('create'); };
  const openEdit = (t) => { setForm({ name: t.name, email: t.email, password: '' }); setModal(t); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal === 'create') {
        await TrainersAPI.create(form);
        toast.success('Trainer created');
      } else {
        const patch = { name: form.name, email: form.email };
        if (form.password) patch.password = form.password;
        await TrainersAPI.update(modal._id, patch);
        toast.success('Trainer updated');
      }
      setModal(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  /* Reset link. Shown in a modal rather than copied straight to the clipboard:
     it is a live credential, so the admin should see who it is for, that it is
     single-use, and when it expires before passing it on. */
  const [resetLink, setResetLink] = useState(null);
  const [issuing, setIssuing] = useState(null);
  const [copied, setCopied] = useState(false);

  const issueResetLink = async (t) => {
    setIssuing(t._id);
    try {
      const r = await TrainersAPI.resetLink(t._id);
      setResetLink(r);
      setCopied(false);
    } catch (err) {
      toast.error(err.message || 'Could not create a reset link');
    } finally {
      setIssuing(null);
    }
  };

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLink.resetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions); the
      // link is on screen and selectable, so this is not a dead end.
      toast.error('Could not copy — select the link and copy it manually.');
    }
  };

  const toggleActive = async (t) => {
    try {
      await TrainersAPI.setActive(t._id, !t.isActive);
      toast.success(t.isActive ? `${t.name} deactivated` : `${t.name} reactivated`);
      load();
    } catch (e) {
      /* The server refuses to deactivate a mentor staffed on an OPEN batch and
         names the batches in the message — pass it through verbatim rather
         than flattening it to "could not update", because the message is the
         actionable part. */
      toast.error(e.message);
    }
  };

  const isCreate = modal === 'create';
  const activeCount = trainers?.filter((t) => t.isActive).length ?? 0;
  /* Total staffed slots across live batches, both roles. The old figure counted
     catalog ownership (Class.trainer), which understated every mentor staffed
     per batch and ignored support work entirely. */
  const classTotal = trainers?.reduce((n, t) => n + (t.classCount || 0), 0) ?? 0;
  const unassignedCount = trainers?.filter((t) => t.isActive && !t.classCount).length ?? 0;
  const shown = useSearchFilter(trainers, query, TRAINER_FIELDS);
  const pg = usePagination(shown, PER_PAGE, query);
  const newTrainerBtn = (
    <button className="btn-primary" onClick={openCreate}>
      <Icon name="plus" size={16} /> New trainer
    </button>
  );

  /* Import sits beside "New trainer" as a secondary action: it's the faster
     path for onboarding a cohort, but creating one person stays the default. */
  const headerActions = (
    <>
      <button className="btn-outline" onClick={() => setBulkOpen(true)}>
        <Icon name="download" size={15} className="rotate-180" /> Import Excel
      </button>
      {newTrainerBtn}
    </>
  );

  /* Row action cluster — shared by the table and the mobile card list so the
     two layouts can never drift apart. Deliberately a plain function, not a
     component: a component declared in the render body gets a new identity each
     render, so the reload after toggling would remount these buttons and steal
     focus from the key the user just pressed. */
  const rowActions = (t) => (
    <>
      <button
        className="btn-ghost !px-2.5 !py-1.5 text-xs"
        onClick={() => openEdit(t)}
        aria-label={`Edit ${t.name}`}
      >
        <Icon name="pencil" size={14} /> Edit
      </button>
      {t.isActive && (
        <button
          className="btn-ghost !px-2.5 !py-1.5 text-xs"
          onClick={() => issueResetLink(t)}
          disabled={issuing === t._id}
          aria-label={`Create a password reset link for ${t.name}`}
          title="Create a single-use password reset link you can pass on directly. Works even when email is not configured."
        >
          <Icon name="link" size={14} /> {issuing === t._id ? 'Creating…' : 'Reset link'}
        </button>
      )}
      {t.isActive ? (
        <button
          className="btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600 hover:!bg-rose-500/10 hover:!text-rose-700 dark:text-rose-400"
          onClick={() => toggleActive(t)}
          aria-label={`Disable ${t.name}`}
        >
          <Icon name="lock" size={14} /> Disable
        </button>
      ) : (
        <button
          className="btn-outline !px-2.5 !py-1.5 text-xs"
          onClick={() => toggleActive(t)}
          aria-label={`Enable ${t.name}`}
        >
          <Icon name="unlock" size={14} /> Enable
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Trainers"
        subtitle="Create and manage the people who teach classes. A trainer can view feedback only for their own classes."
        action={headerActions}
      />

      {/* Summary strip — the three numbers an admin checks before doing anything
          else. Dividers switch axis with the layout so the grid never orphans. */}
      <div className="panel animate-fade-up divide-y divide-line sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {!trainers ? (
          <>
            <div className="px-5 py-4"><div className="skeleton h-10 w-24" /></div>
            <div className="px-5 py-4"><div className="skeleton h-10 w-24" /></div>
            <div className="px-5 py-4"><div className="skeleton h-10 w-24" /></div>
          </>
        ) : (
          <>
            <Metric icon="users" label="Total trainers" value={trainers.length} />
            <Metric icon="checkCircle" label="Active" value={activeCount} tone="positive" />
            <Metric icon="book" label="Classes covered" value={classTotal} tone="neutral" />
          </>
        )}
      </div>

      <Card
        title="All trainers"
        icon={<Icon name="graduation" size={15} className="text-brand-600 dark:text-brand-400" />}
        hint="A trainer is a staff account that owns one or more classes. They sign in with this email and see feedback only for the classes assigned to them."
        subtitle={
          trainers
            ? query
              ? `${shown.length} of ${trainers.length} matching “${query}”`
              : `${trainers.length} total · ${activeCount} active`
            : 'Loading…'
        }
        actions={
          trainers?.length ? (
            <TableSearch
              label="trainers"
              value={query}
              onChange={setQuery}
              placeholder="Search name or email…"
            />
          ) : null
        }
        bodyClass="p-0"
      >
        {!trainers ? (
          <div className="p-4 sm:p-5">
            <SkeletonRows rows={5} />
          </div>
        ) : trainers.length === 0 ? (
          <EmptyState
            title="No trainers yet"
            hint="Create your first trainer, then assign classes to them so they can start receiving feedback."
            icon={<Icon name="users" size={24} className="text-muted" />}
            action={newTrainerBtn}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No trainers match that search"
            hint={`Nothing matched “${query}”. Try a different name or email.`}
            icon={<Icon name="search" size={24} className="text-muted" />}
            action={<button className="btn-outline" onClick={() => setQuery('')}>Clear search</button>}
          />
        ) : (
          <>
            {/* ── Mobile: stacked cards. A 5-column table is unreadable under 640px. ── */}
            <ul className="stagger divide-y divide-line/60 sm:hidden">
              {pg.slice.map((t) => (
                <li key={t._id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={t.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{t.name}</p>
                      <p className="truncate text-xs text-muted">{t.email}</p>
                    </div>
                    <StatusChip active={t.isActive} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <Icon name="book" size={14} className="text-subtle" />
                      <span className="tnum font-semibold text-ink">{t.classCount}</span>
                      {t.classCount === 1 ? 'class' : 'classes'}
                    </span>
                    <div className="flex items-center gap-1">
                      {rowActions(t)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* ── Desktop: full table ── */}
            <div className="hidden max-h-[34rem] overflow-auto sm:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="th">Name</th>
                    <th scope="col" className="th">Email</th>
                    <th scope="col" className="th">
                      <span className="inline-flex items-center gap-1.5">
                        Deployment
                        <InfoTooltip text="How this mentor is staffed across live batches. Main = classes they deliver; Support = classes they assist on. A person can hold either role, or both, on different classes." />
                      </span>
                    </th>
                    <th scope="col" className="th">Status</th>
                    <th scope="col" className="th">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {pg.slice.map((t) => (
                    <tr key={t._id} className="tr-hover">
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <Avatar name={t.name} />
                          <span className="font-medium text-ink">{t.name}</span>
                        </div>
                      </td>
                      <td className="td text-muted">{t.email}</td>
                      <td className="td">
                        <DeploymentCell t={t} />
                      </td>
                      <td className="td"><StatusChip active={t.isActive} /></td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {rowActions(t)}
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
              unit={query ? "matching trainers" : "trainers"}
            />
          </>
        )}
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isCreate ? 'New trainer' : 'Edit trainer'}
        description={
          isCreate
            ? 'They will sign in with this email and password. You can assign classes to them straight after.'
            : 'Update this trainer’s details. Leave the password blank to keep their current one.'
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor="trainer-name">Full name</label>
            <input
              id="trainer-name"
              className="input"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className="label" htmlFor="trainer-email">Email</label>
            <input
              id="trainer-email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="jane@example.com"
            />
            <p className="hint">Used as their sign-in ID — it must be unique.</p>
          </div>
          <div>
            <label className="label" htmlFor="trainer-password">
              {isCreate ? 'Password' : 'New password (optional)'}
            </label>
            <input
              id="trainer-password"
              className="input"
              type="password"
              minLength={6}
              required={isCreate}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 6 characters"
            />
            <p className="hint">
              {isCreate
                ? 'At least 6 characters. Share it with the trainer so they can sign in.'
                : 'Leave blank to keep the existing password.'}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
      <BulkUploadTrainers open={bulkOpen} onClose={() => setBulkOpen(false)} onImported={load} />
    </div>
  );
}

/**
 * A mentor's staffing at a glance: how many classes they deliver vs assist on.
 *
 * Two counts rather than one total, because they are different kinds of work
 * and the roster is read to answer "who is free to lead something?" — a total
 * of 8 hides whether that is eight classes taught or eight assisted.
 * "Unassigned" is called out rather than shown as 0/0: several people on the
 * roster genuinely have no sessions yet, and that is the actionable state.
 */
function DeploymentCell({ t }) {
  const main = t.mainClassCount || 0;
  const support = t.supportClassCount || 0;

  if (!main && !support) {
    return (
      <span
        className="chip bg-surface-2 text-muted"
        title="Not staffed on any live batch. Assign them when creating or editing a batch."
      >
        Unassigned
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {main > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          title={`Delivers ${main} class${main === 1 ? '' : 'es'} across ${t.mainBatchCount || 0} batch${(t.mainBatchCount || 0) === 1 ? '' : 'es'}`}
        >
          <Icon name="user-check" size={10} />
          <span className="tnum">{main}</span> main
        </span>
      )}
      {support > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
          title={`Assists on ${support} class${support === 1 ? '' : 'es'} across ${t.supportBatchCount || 0} batch${(t.supportBatchCount || 0) === 1 ? '' : 'es'}`}
        >
          <Icon name="users" size={10} />
          <span className="tnum">{support}</span> support
        </span>
      )}
    </span>
  );
}
