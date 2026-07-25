import { useState, useEffect } from 'react';
import { AuthAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Card from '../components/Card.jsx';
import Icon from '../components/Icon.jsx';

const MIN_PASSWORD = 6;

/**
 * Settings — account, appearance and system info, for both roles.
 *
 * The account section closes a real gap: until now nobody could change their
 * own password. An admin could reset a trainer's, but had no way to rotate
 * their own, which is not shippable for a product being sold.
 */
export default function Settings() {
  const { user, refresh } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();

  const [profile, setProfile] = useState({ name: '', email: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [health, setHealth] = useState(null);

  useEffect(() => {
    if (user) setProfile({ name: user.name || '', email: user.email || '' });
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/health');
        setHealth(r.ok ? 'ok' : 'down');
      } catch {
        setHealth('down');
      }
    })();
  }, []);

  const dirty = user && (profile.name !== user.name || profile.email !== user.email);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!dirty || savingProfile) return;
    setSavingProfile(true);
    try {
      await AuthAPI.updateMe({ name: profile.name.trim(), email: profile.email.trim() });
      toast.success('Profile updated');
      await refresh?.();
    } catch (err) {
      toast.error(err.message || 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const pwTooShort = pw.newPassword.length > 0 && pw.newPassword.length < MIN_PASSWORD;
  const pwMismatch = pw.confirm.length > 0 && pw.newPassword !== pw.confirm;
  const canChangePw =
    pw.currentPassword.length > 0 &&
    pw.newPassword.length >= MIN_PASSWORD &&
    pw.newPassword === pw.confirm &&
    !savingPw;

  const changePassword = async (e) => {
    e.preventDefault();
    if (!canChangePw) return;
    setSavingPw(true);
    try {
      await AuthAPI.updateMe({
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      toast.success('Password changed');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      toast.error(err.message || 'Could not change password');
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        subtitle="Your profile, sign-in credentials and how this workspace looks."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <Card title="Profile" icon="user" subtitle="How you appear in this workspace">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface-2/40 p-3.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-500/20 dark:text-brand-300">
                {(user?.name || '?')
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                <p className="mt-0.5">
                  <span className="chip-brand !py-0.5 text-[10px] uppercase tracking-wider">
                    {user?.role}
                  </span>
                </p>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="set-name">
                Full name
              </label>
              <input
                id="set-name"
                className="input"
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label" htmlFor="set-email">
                Email
              </label>
              <input
                id="set-email"
                type="email"
                className="input"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                autoComplete="email"
              />
              <p className="hint">This is the address you sign in with.</p>
            </div>

            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={!dirty || savingProfile}>
                {savingProfile ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Card>

        {/* ── Password ────────────────────────────────────────────────────── */}
        <Card title="Password" icon="lock" subtitle="Change the password you sign in with">
          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label className="label" htmlFor="set-cur">
                Current password
              </label>
              <div className="relative">
                <input
                  id="set-cur"
                  type={showPw ? 'text' : 'password'}
                  className="input pr-11"
                  value={pw.currentPassword}
                  onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide passwords' : 'Show passwords'}
                  className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
                </button>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="set-new">
                New password
              </label>
              <input
                id="set-new"
                type={showPw ? 'text' : 'password'}
                className="input"
                value={pw.newPassword}
                onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
                placeholder={`At least ${MIN_PASSWORD} characters`}
                autoComplete="new-password"
                aria-invalid={pwTooShort ? 'true' : undefined}
              />
              {pwTooShort && (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Must be at least {MIN_PASSWORD} characters.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="set-conf">
                Confirm new password
              </label>
              <input
                id="set-conf"
                type={showPw ? 'text' : 'password'}
                className="input"
                value={pw.confirm}
                onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                autoComplete="new-password"
                aria-invalid={pwMismatch ? 'true' : undefined}
              />
              {pwMismatch && (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Passwords don’t match.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={!canChangePw}>
                {savingPw ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </Card>

        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <Card title="Appearance" icon="sun" subtitle="Applies to this browser">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-2/40 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Theme</p>
              <p className="mt-0.5 text-xs text-muted">
                Currently {theme === 'dark' ? 'dark' : 'light'}. Your choice is remembered on this
                device.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Theme"
              className="inline-flex shrink-0 rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line"
            >
              {['light', 'dark'].map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={theme === m}
                  onClick={() => {
                    if (theme !== m) toggle();
                  }}
                  className={`focus-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors duration-150 ${
                    theme === m ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  <Icon name={m === 'dark' ? 'moon' : 'sun'} size={13} />
                  {m}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* ── System ──────────────────────────────────────────────────────── */}
        <Card title="System" icon="activity" subtitle="Environment and connectivity">
          <dl className="divide-y divide-line text-sm">
            <Row label="API status">
              {health === null ? (
                <span className="text-muted">Checking…</span>
              ) : health === 'ok' ? (
                <span className="chip-open">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Connected
                </span>
              ) : (
                <span className="chip bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300">
                  <Icon name="alert" size={12} />
                  Unreachable
                </span>
              )}
            </Row>
            <Row label="Signed in as">
              <span className="truncate text-ink">{user?.email}</span>
            </Row>
            <Row label="Role">
              <span className="capitalize text-ink">{user?.role}</span>
            </Row>
            <Row label="Account created">
              <span className="text-ink">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
              </span>
            </Row>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}
