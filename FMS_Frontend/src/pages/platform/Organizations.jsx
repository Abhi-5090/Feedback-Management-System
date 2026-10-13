import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlatformAPI } from '../../api/endpoints.js';
import { useOrgScope } from '../../platform/OrgScope.jsx';
import { useToast } from '../../components/Toast.jsx';
import Hero from '../../components/Hero.jsx';
import Card from '../../components/Card.jsx';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import StatTile from '../../components/StatTile.jsx';
import { SkeletonBlock } from '../../components/Spinner.jsx';

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * The tenants themselves — the only screen in the product that sees across
 * organizations.
 *
 * Creating one creates its first admin and its feedback parameters in the same
 * call, because an organization missing either is a broken state someone would
 * otherwise have to notice and repair: no admin means nobody can enter it, no
 * parameters means a student meets an empty form.
 */
export default function Organizations() {
  const toast = useToast();
  const { setOrg } = useOrgScope();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const [form, setForm] = useState({ name: '', slug: '', adminName: '', adminEmail: '' });
  const [slugEdited, setSlugEdited] = useState(false);

  const load = useCallback(async () => {
    try {
      const [orgs, ov] = await Promise.all([PlatformAPI.organizations(), PlatformAPI.overview()]);
      setData(orgs.organizations);
      setOverview(ov.kpis);
    } catch (e) {
      toast.error(e.message);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await PlatformAPI.create({ ...form, slug: form.slug || slugify(form.name) });
      /* Shown once and never again. The only recovery is a password reset,
         which is the correct shape for a credential. */
      setIssued(res);
      setCreating(false);
      setForm({ name: '', slug: '', adminName: '', adminEmail: '' });
      setSlugEdited(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (o) => {
    try {
      await PlatformAPI.update(o.id, { status: o.status === 'active' ? 'suspended' : 'active' });
      toast.success(`${o.name} ${o.status === 'active' ? 'suspended' : 'reactivated'}`);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <Hero
        icon="building"
        title="Organizations"
        subtitle="Every institution on the platform, and the admins who run them."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            New organization
          </button>
        }
      />

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Organizations" value={overview.organizations} icon="building" tone="neutral" />
          <StatTile label="Suspended" value={overview.suspended} icon="lock"
            tone={overview.suspended > 0 ? 'warn' : 'neutral'} delay={40} />
          <StatTile label="People" value={overview.users} icon="users" tone="neutral" delay={80} />
          <StatTile label="Cohorts" value={overview.batches} icon="ticket" tone="neutral" delay={120} />
          <StatTile label="Responses" value={overview.responses} icon="inbox" tone="neutral" delay={160} />
        </div>
      )}

      {!data ? (
        <SkeletonBlock height={260} className="rounded-2xl" />
      ) : (
        <Card title="All organizations" icon="building" subtitle={`${data.length} on the platform`}>
          <ul className="divide-y divide-line">
            {data.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-ink">
                    {o.name}
                    {o.status === 'suspended' && (
                      <span className="rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Suspended
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {o.slug} · {o.admins} admin{o.admins === 1 ? '' : 's'} · {o.trainers} mentors ·{' '}
                    {o.classes} subjects · {o.batches} cohorts ·{' '}
                    <span className="tnum font-medium text-ink">{o.responses.toLocaleString()}</span> responses
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="btn-outline !py-1.5 text-xs"
                    onClick={() => { setOrg(o.id); navigate('/admin'); }}
                  >
                    Open
                  </button>
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => toggleStatus(o)}>
                    {o.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New organization"
        description="Creates the institution, its first admin, and its default feedback parameters.">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="org-name">Institution name</label>
            <input id="org-name" className="input" required value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({ ...f, name, slug: slugEdited ? f.slug : slugify(name) }));
              }}
              placeholder="Narayana College of Engineering" />
          </div>
          <div>
            <label className="label" htmlFor="org-slug">Handle</label>
            <input id="org-slug" className="input" required value={form.slug}
              onChange={(e) => { setSlugEdited(true); setForm((f) => ({ ...f, slug: slugify(e.target.value) })); }}
              placeholder="ncet" />
            <p className="hint">Lowercase letters, digits and hyphens. Used in links; it does not change when the name does.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="admin-name">First admin</label>
              <input id="admin-name" className="input" required value={form.adminName}
                onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="admin-email">Their email</label>
              <input id="admin-email" type="email" className="input" required value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            A one-time password is generated and shown once. Pass it on yourself — it is never emailed
            from here, and they must replace it before they can do anything.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(issued)} onClose={() => setIssued(null)} title="Organization created"
        description="Copy the password now — it cannot be shown again.">
        {issued && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2/60 p-4">
              <p className="text-sm font-semibold text-ink">{issued.organization.name}</p>
              <p className="mt-0.5 text-[11px] text-muted">{issued.admin.name} · {issued.admin.email}</p>
            </div>
            <div>
              <p className="label">One-time password</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink">
                  {issued.temporaryPassword}
                </code>
                <button className="btn-outline !py-2"
                  onClick={() => { navigator.clipboard?.writeText(issued.temporaryPassword); toast.success('Copied'); }}>
                  <Icon name="copy" size={15} />
                </button>
              </div>
              <p className="hint">They must choose a new one before they can use the account.</p>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setIssued(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
