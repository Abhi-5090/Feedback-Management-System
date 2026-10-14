import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { PlatformAPI } from '../../api/endpoints.js';
import { useOrgScope } from '../../platform/OrgScope.jsx';
import { useToast } from '../../components/Toast.jsx';
import Card from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import StatTile from '../../components/StatTile.jsx';
import OneTimeSecret from '../../components/OneTimeSecret.jsx';
import AdminCredentialFields from '../../components/AdminCredentialFields.jsx';
import { SkeletonBlock } from '../../components/Spinner.jsx';
import { useTenantTime } from '../../platform/useTenantTime.js';



/**
 * One organization, in full.
 *
 * The question a platform operator arrives with is rarely "how many responses
 * does this one have" — it is "who can get into it, and should they still be
 * able to". So the people come first and the figures sit above them as
 * context.
 */
export default function OrganizationDetail() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { setOrg } = useOrgScope();
  const { formatFull: day } = useTenantTime();

  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', requirePasswordChange: true });
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await PlatformAPI.get(id));
    } catch (e) {
      toast.error(e.message);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <SkeletonBlock height={420} className="rounded-2xl" />;

  const org = data.organization;
  const suspended = org.status === 'suspended';

  const addAdmin = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { password, ...rest } = form;
      const res = await PlatformAPI.addAdmin(id, {
        ...rest,
        ...(password ? { password } : {}),
      });
      setIssued({ title: 'Admin added', who: res.admin, secret: res.temporaryPassword });
      setAdding(false);
      setForm({ name: '', email: '', password: '', requirePasswordChange: true });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resetAdmin = async (person) => {
    try {
      const res = await PlatformAPI.resetAdmin(id, person.id);
      setIssued({ title: 'New password issued', who: res.admin, secret: res.temporaryPassword });
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const setStatus = async (status) => {
    try {
      await PlatformAPI.update(id, { status });
      toast.success(status === 'suspended' ? `${org.name} suspended` : `${org.name} reactivated`);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const blob = await PlatformAPI.exportOrg(id);
      /* Handed straight to the browser as a download rather than shown: it is
         a file the operator keeps, and it holds every student comment. */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${org.slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  };

  const removeOrg = async (e) => {
    e.preventDefault();
    try {
      const res = await PlatformAPI.remove(id, confirmText);
      toast.success(`${res.organization.name} deleted`);
      navigate('/platform');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      await PlatformAPI.update(id, { settings: draftSettings });
      setSettingsOpen(false);
      toast.success('Settings saved');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const rename = async (e) => {
    e.preventDefault();
    try {
      await PlatformAPI.update(id, { name: draftName.trim() });
      setRenaming(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link to="/platform" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-ink">
          <Icon name="arrowLeft" size={14} /> All organizations
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-display-sm text-ink">
              <span className="truncate">{org.name}</span>
              {suspended && (
                <span className="rounded-md bg-amber-500/14 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Suspended
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {org.slug} · {org.settings?.timezone || 'Asia/Kolkata'} · created {day(org.createdAt)}
              {org.lastResponseAt && <> · last response {day(org.lastResponseAt)}</>}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              className="btn-outline"
              onClick={() => { setDraftName(org.name); setRenaming(true); }}
            >
              <Icon name="pencil" size={15} /> Rename
            </button>
            <button className="btn-ghost" onClick={() => setStatus(suspended ? 'active' : 'suspended')}>
              <Icon name={suspended ? 'unlock' : 'lock'} size={15} />
              {suspended ? 'Reactivate' : 'Suspend'}
            </button>
            <button
              className="btn-primary"
              disabled={suspended}
              onClick={() => { setOrg(id); navigate('/admin'); }}
              title={suspended ? 'Reactivate it first' : undefined}
            >
              Open workspace
            </button>
          </div>
        </div>
      </div>

      {suspended && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-ink">
          <strong>Nobody can sign in to this organization.</strong> Its data is untouched — suspension
          blocks access, it does not delete anything.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Admins" value={org.admins} icon="shield" tone="neutral" />
        <StatTile label="Mentors" value={org.trainers} icon="users" tone="neutral" delay={40} />
        <StatTile label="Subjects" value={org.classes} icon="book" tone="neutral" delay={80} />
        <StatTile label="Cohorts" value={org.batches} icon="ticket" tone="neutral" delay={120} />
        <StatTile label="Responses" value={org.responses} icon="inbox" tone="neutral" delay={160} />
      </div>

      <Card
        title="Admins"
        icon="shield"
        subtitle="Who can administer this organization"
        hint="An admin who has never signed in is the commonest reason an organization looks set up and is not."
        actions={
          <button className="btn-outline !py-1.5 text-xs" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Add admin
          </button>
        }
      >
        <ul className="divide-y divide-line">
          {data.admins.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                <p className="truncate text-[11px] text-muted">{p.email}</p>
              </div>
              {p.pendingFirstSignIn && (
                <span className="rounded-md bg-sky-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  Never signed in
                </span>
              )}
              <button className="btn-ghost shrink-0 !py-1.5 text-xs" onClick={() => resetAdmin(p)}>
                Reset password
              </button>
            </li>
          ))}
          {data.admins.length === 0 && (
            <li className="px-5 py-6 text-sm text-muted">
              No admins — nobody can enter this organization. Add one.
            </li>
          )}
        </ul>
      </Card>

      <Card title="Mentors" icon="users" subtitle={`${data.trainers.length} in this organization`}>
        {data.trainers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">
            No mentors yet. Its admin adds them from inside the workspace.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.trainers.slice(0, 12).map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{p.name}</p>
                  <p className="truncate text-[11px] text-muted">{p.email}</p>
                </div>
                {!p.isActive && <span className="text-[11px] text-subtle">inactive</span>}
              </li>
            ))}
          </ul>
        )}
        {data.trainers.length > 12 && (
          <p className="border-t border-line px-5 py-2.5 text-[11px] text-subtle">
            Showing 12 of {data.trainers.length}. The full list lives inside the workspace.
          </p>
        )}
      </Card>

      {/* Kept to the bottom and visually separate. These two actions are the
          only ones here that leave the product's data different afterwards,
          and one of them cannot be undone. */}
      <section className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.04] p-5">
        <h2 className="text-sm font-bold text-ink">Leaving the platform</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          An institution that leaves has a right to its data and to its removal. Take the export
          first — after deletion there is nothing left to take a copy of.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-outline !py-2 text-xs" onClick={exportData} disabled={exporting}>
            <Icon name="download" size={15} />
            {exporting ? 'Preparing…' : 'Export all data'}
          </button>
          <button
            className="btn-ghost !py-2 text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            onClick={() => { setConfirmText(''); setDeleting(true); }}
            disabled={!suspended}
            title={suspended ? undefined : 'Suspend the organization first'}
          >
            <Icon name="trash" size={15} /> Delete permanently
          </button>
        </div>
        {!suspended && (
          <p className="mt-2 text-[11px] text-subtle">
            Deletion is available once the organization is suspended — it is deliberately a second,
            separate decision.
          </p>
        )}
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add an admin"
        description={`They will be able to administer ${org.name}.`}>
        <form onSubmit={addAdmin} className="space-y-4">
          <div>
            <label className="label" htmlFor="a-name">Name</label>
            <input id="a-name" className="input" required value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="a-email">Email</label>
            <input id="a-email" type="email" className="input" required value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <AdminCredentialFields
            value={{ password: form.password, requirePasswordChange: form.requirePasswordChange }}
            onChange={(v) => setForm((f) => ({ ...f, ...v }))}
            idPrefix="add-admin"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Adding…' : 'Add admin'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Organization settings"
        description="These change what this institution's own people see."
      >
        {draftSettings && (
          <form onSubmit={saveSettings} className="space-y-4">
            <div>
              <label className="label" htmlFor="tz">Timezone</label>
              <select
                id="tz"
                className="input"
                value={draftSettings.timezone}
                onChange={(e) => setDraftSettings((d) => ({ ...d, timezone: e.target.value }))}
              >
                {/* Read from the browser's own tz database where it is
                    available, so the list cannot go stale the way a
                    hand-written one does. */}
                {(typeof Intl.supportedValuesOf === 'function'
                  ? Intl.supportedValuesOf('timeZone')
                  : ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York']
                ).map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="hint">
                Feedback is stored in UTC and shown in this zone. A session collected at 9pm is
                &ldquo;the 30th&rdquo; here and &ldquo;the 29th&rdquo; in UTC &mdash; this is what makes
                dates in their reports match the days their students remember.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="week-start">Weeks start on</label>
              <select
                id="week-start"
                className="input"
                value={draftSettings.weekStartsOn}
                onChange={(e) => setDraftSettings((d) => ({ ...d, weekStartsOn: e.target.value }))}
              >
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Save settings</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename organization"
        description="The handle stays the same, so existing links keep working.">
        <form onSubmit={rename} className="space-y-4">
          <div>
            <label className="label" htmlFor="o-name">Name</label>
            <input id="o-name" className="input" required value={draftName}
              onChange={(e) => setDraftName(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setRenaming(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${org.name}?`}
        description="This cannot be undone."
      >
        <form onSubmit={removeOrg} className="space-y-4">
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3.5">
            <p className="text-xs leading-relaxed text-ink">
              Everything belonging to this organization is destroyed:{' '}
              <strong>{org.admins + org.trainers} people</strong>, <strong>{org.classes} subjects</strong>,{' '}
              <strong>{org.batches} cohorts</strong> and{' '}
              <strong className="tnum">{org.responses.toLocaleString()}</strong> student responses.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="confirm-slug">
              Type <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-ink">{org.slug}</code> to confirm
            </label>
            <input
              id="confirm-slug"
              className="input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              placeholder={org.slug}
            />
            <p className="hint">Typing it back is the difference between confirming and acknowledging.</p>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleting(false)}>Cancel</button>
            <button
              type="submit"
              className="btn-primary !bg-rose-600 hover:!bg-rose-700"
              disabled={confirmText.trim().toLowerCase() !== org.slug}
            >
              Delete permanently
            </button>
          </div>
        </form>
      </Modal>

      <OneTimeSecret
        open={Boolean(issued)}
        onClose={() => setIssued(null)}
        title={issued?.title || ''}
        who={issued?.who}
        secret={issued?.secret}
      />
    </div>
  );
}
