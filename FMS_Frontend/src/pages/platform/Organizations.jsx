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

/* Three states, because they call for three different actions: still
   collecting needs nothing, gone quiet is worth a conversation, never started
   was never onboarded. */
const HEALTH = {
  active: { label: 'Active', cls: 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-400' },
  dormant: { label: 'Dormant', cls: 'bg-amber-500/14 text-amber-700 dark:text-amber-400' },
  'never-used': { label: 'Never used', cls: 'bg-rose-500/14 text-rose-700 dark:text-rose-400' },
};

/* A missing number renders as a dash rather than taking the page down. A
   dashboard is the wrong place to discover a shape mismatch by white screen. */
const num = (v) => (typeof v === 'number' ? v.toLocaleString() : '—');

const ago = (days) =>
  days === null || days === undefined
    ? 'no responses yet'
    : days === 0
      ? 'today'
      : days === 1
        ? 'yesterday'
        : days < 60
          ? `${days} days ago`
          : `${Math.round(days / 30)} months ago`;

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
      /* ONE source for both halves of this page. The table used to come from
         /organizations while the tiles came from /overview, and the moment
         the richer shape landed on only one of them the rows referenced
         fields that were not there — a white screen, from two endpoints
         answering the same question differently. The totals are summed from
         these rows server-side, so the headline cannot drift from the table
         either. */
      const ov = await PlatformAPI.overview();
      setData(ov.organizations);
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
          <StatTile label="Organizations" value={overview.organizations} icon="building" tone="neutral"
            sub={overview.suspended > 0 ? `${overview.suspended} suspended` : 'all active'} />
          {/* The two tiles that are a worklist rather than a figure. */}
          <StatTile label="Dormant" value={overview.dormant} icon="alert" delay={40}
            tone={overview.dormant > 0 ? 'warn' : 'good'}
            hint="No feedback collected in the last 45 days. A big dormant customer is the one about to leave." />
          <StatTile label="Never used" value={overview.neverUsed} icon="x" delay={80}
            tone={overview.neverUsed > 0 ? 'bad' : 'good'}
            hint="Created but never collected anything — almost always an onboarding that stopped halfway." />
          <StatTile label="Collecting now" value={overview.openBatches} icon="unlock" delay={120}
            tone={overview.openBatches > 0 ? 'good' : 'neutral'} sub="cohorts open" />
          <StatTile label="Responses" value={overview.responses} icon="inbox" tone="neutral" delay={160}
            sub={`${num(overview.responsesLast30 ?? 0)} in 30 days`} />
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
          <ul className="stagger divide-y divide-line">
            {data.map((o) => (
              <li
                key={o.id}
                /* Hover gated behind a real pointer: a touch device fires
                   hover on tap, which leaves the row stuck looking focused
                   after the finger lifts. */
                className="group flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors duration-150 ease-out [@media(hover:hover)and(pointer:fine)]:hover:bg-surface-2/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-ink">
                    {o.name}
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        (HEALTH[o.health] || HEALTH.active).cls
                      }`}
                    >
                      {(HEALTH[o.health] || HEALTH.active).label}
                    </span>
                    {o.status === 'suspended' && (
                      <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                        Suspended
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {o.slug} · {o.people ?? 0} people · {o.classes ?? 0} subjects · {o.batches ?? 0} cohorts
                    {o.openBatches > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {' '}· {o.openBatches} collecting now
                      </span>
                    )}
                  </p>
                </div>

                {/* Volume, recency and rating together: a big dormant customer
                    is the one about to leave, and a count alone hides that. */}
                <div className="flex shrink-0 items-center gap-5 text-right">
                  <div>
                    <p className="tnum text-sm font-bold text-ink">{num(o.responses)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-subtle">responses</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="tnum text-sm font-bold text-ink">
                      {typeof o.averageRating === 'number' ? o.averageRating.toFixed(2) : '—'}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-subtle">avg rating</p>
                  </div>
                  <div className="hidden md:block">
                    <p className="text-xs font-medium text-ink">{ago(o.daysSinceLastResponse)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-subtle">last response</p>
                  </div>
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
