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

const day = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

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

  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', requirePasswordChange: true });
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

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
              {org.slug} · created {day(org.createdAt)}
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
