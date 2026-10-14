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
import OneTimeSecret from '../../components/OneTimeSecret.jsx';
import AdminCredentialFields from '../../components/AdminCredentialFields.jsx';
import { fetchApiBuild, isMissingFeature } from '../../platform/apiBuild.js';

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
  const [form, setForm] = useState({
    name: '', slug: '', adminName: '', adminEmail: '',
    password: '', requirePasswordChange: true,
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [staleApi, setStaleApi] = useState(null);

  const load = useCallback(async () => {
    try {
      const [orgs, ov] = await Promise.all([PlatformAPI.organizations(), PlatformAPI.overview()]);
      setData(orgs.organizations);
      setOverview(ov.kpis);
    } catch (e) {
      /* A 404 here does not mean the request was wrong — it means the server
         answering has no such route, i.e. it predates this feature. Saying so,
         with the commit it is running, turns an inexplicable failure into a
         deployment you can go and do. */
      if (isMissingFeature(e)) {
        setStaleApi((await fetchApiBuild()) || { commit: null });
        return;
      }
      toast.error(e.message);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { password, ...rest } = form;
      const res = await PlatformAPI.create({
        ...rest,
        slug: form.slug || slugify(form.name),
        // Omitted entirely when blank, so the server generates one.
        ...(password ? { adminPassword: password } : {}),
      });
      /* Shown once and never again. The only recovery is a password reset,
         which is the correct shape for a credential. */
      setIssued(res);
      setCreating(false);
      setForm({ name: '', slug: '', adminName: '', adminEmail: '', password: '', requirePasswordChange: true });
      setSlugEdited(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Hero
        eyebrow="Platform"
        title="Organizations"
        subtitle="Every institution on the platform, and the admins who run them."
        actions={
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

      {staleApi && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-5">
          <div className="flex items-start gap-3">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink">The API has not been deployed yet</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                This screen is asking for organization management, and the server answering has no such
                routes — it is running an older build
                {staleApi.commit && (
                  <> (<code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-ink">{staleApi.commit}</code>)</>
                )}
                . Nothing here is broken: deploy the backend and this page will work.
              </p>
              <p className="mt-2 text-[11px] text-subtle">
                Until then the rest of the product is unaffected — existing organizations carry on as before.
              </p>
            </div>
          </div>
        </section>
      )}

      {!data && !staleApi ? (
        <SkeletonBlock height={260} className="rounded-2xl" />
      ) : !data ? null : (
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
                    onClick={() => navigate(`/platform/organizations/${o.id}`)}
                  >
                    Manage
                  </button>
                  <button
                    className="btn-ghost !py-1.5 text-xs"
                    disabled={o.status === 'suspended'}
                    title={o.status === 'suspended' ? 'Reactivate it first' : undefined}
                    onClick={() => { setOrg(o.id); navigate('/admin'); }}
                  >
                    Open workspace
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
          <AdminCredentialFields
            value={{ password: form.password, requirePasswordChange: form.requirePasswordChange }}
            onChange={(v) => setForm((f) => ({ ...f, ...v }))}
            idPrefix="new-org"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </div>
        </form>
      </Modal>

      <OneTimeSecret
        open={Boolean(issued)}
        onClose={() => setIssued(null)}
        title="Organization created"
        who={issued?.admin}
        secret={issued?.temporaryPassword}
        note="They can create their own mentors, subjects and cohorts straight away."
      />
    </div>
  );
}
