import { useState, useEffect } from 'react';
import { AuthAPI, SystemAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Card from '../components/Card.jsx';
import Icon from '../components/Icon.jsx';

const MIN_PASSWORD = 8;

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

  /* System facts come from GET /api/auth/system, through the shared axios
     client. This used to be a raw `fetch('/api/health')`, which bypassed
     VITE_API_URL and so reported "Unreachable" on any cross-origin deploy —
     and could only ever show liveness, never whether mail was configured. */
  const [system, setSystem] = useState(null);
  const [health, setHealth] = useState(null);

  // Email digest preferences. The endpoint existed with no UI behind it, so
  // the whole digest feature was unreachable and never had any recipients.
  const [digest, setDigest] = useState({ enabled: false, frequency: 'weekly' });
  const [savingDigest, setSavingDigest] = useState(false);
  const [runningDigest, setRunningDigest] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [testingMail, setTestingMail] = useState(false);

  useEffect(() => {
    if (user) setProfile({ name: user.name || '', email: user.email || '' });
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const s = await AuthAPI.system();
        setSystem(s);
        setHealth('ok');
      } catch {
        setHealth('down');
      }
    })();
  }, []);

  useEffect(() => {
    if (user?.digest) {
      setDigest({
        enabled: Boolean(user.digest.enabled),
        frequency: user.digest.frequency || 'weekly',
      });
    }
  }, [user]);

  const saveDigest = async (next) => {
    setSavingDigest(true);
    const previous = digest;
    setDigest(next); // optimistic: a toggle that lags feels broken
    try {
      await AuthAPI.updateDigest(next);
      await refresh?.();
      toast.success(next.enabled ? `Digest on — ${next.frequency}` : 'Digest off');
    } catch (err) {
      setDigest(previous);
      toast.error(err.message || 'Could not save digest preference');
    } finally {
      setSavingDigest(false);
    }
  };

  const runDigestNow = async () => {
    setRunningDigest(true);
    try {
      const r = await SystemAPI.runDigests(true);
      toast.success(
        r.sent
          ? `Sent ${r.sent} digest${r.sent === 1 ? '' : 's'} of ${r.considered} recipient(s)`
          : `Nothing to send — ${r.considered} recipient(s) considered, ${r.skipped} skipped`
      );
    } catch (err) {
      toast.error(err.message || 'Could not run digests');
    } finally {
      setRunningDigest(false);
    }
  };

  const sendTestMail = async () => {
    setTestingMail(true);
    try {
      const r = await SystemAPI.testMail();
      // Delivered and "printed to a log" are very different outcomes, so they
      // get different toasts rather than a shared "done".
      if (r.delivered) toast.success(r.notice);
      else toast.error(r.notice);
    } catch (err) {
      toast.error(err.message || 'Could not send the test message');
    } finally {
      setTestingMail(false);
    }
  };

  const signOutEverywhere = async () => {
    setSigningOutAll(true);
    try {
      await AuthAPI.logoutEverywhere();
      toast.success('Signed out on all devices');
      // This session's cookie is gone too, so send them to the login screen
      // rather than leaving a page whose every request will now 401.
      window.location.assign(`${import.meta.env.BASE_URL}login`);
    } catch (err) {
      toast.error(err.message || 'Could not sign out everywhere');
      setSigningOutAll(false);
    }
  };

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
              {pwTooShort ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Must be at least {MIN_PASSWORD} characters.
                </p>
              ) : (
                <p className="hint">
                  A memorable phrase beats a short password with symbols in it. Very common
                  passwords and your own name or email are rejected.
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

            <p className="flex items-start gap-1.5 rounded-xl bg-surface-2/60 px-3 py-2 text-[11px] text-muted">
              <Icon name="info" size={12} className="mt-0.5 shrink-0" />
              Changing your password signs you out everywhere else. This tab stays signed in.
            </p>

            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={!canChangePw}>
                {savingPw ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>

          <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Sign out everywhere</p>
              <p className="mt-0.5 text-xs text-muted">
                Ends every session on every device, including this one. Useful after signing in on
                a shared machine.
              </p>
            </div>
            <button
              type="button"
              onClick={signOutEverywhere}
              disabled={signingOutAll}
              className="btn-ghost shrink-0 text-rose-600 hover:!bg-rose-500/10 hover:!text-rose-700 dark:text-rose-400"
            >
              <Icon name="logout" size={15} />
              {signingOutAll ? 'Signing out…' : 'Sign out all'}
            </button>
          </div>
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

        {/* ── Email digest ────────────────────────────────────────────────── */}
        <Card
          title="Email digest"
          icon="inbox"
          subtitle="A periodic summary of what came in"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-2/40 p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Send me a summary</p>
                <p className="mt-0.5 text-xs text-muted">
                  {digest.enabled
                    ? 'Response counts, averages and your busiest classes.'
                    : 'Off — nothing is emailed to you.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={digest.enabled}
                aria-label="Email digest"
                disabled={savingDigest}
                onClick={() => saveDigest({ ...digest, enabled: !digest.enabled })}
                className={`focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-60 ${
                  digest.enabled ? 'bg-brand-600' : 'bg-line'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    digest.enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {digest.enabled && (
              <div>
                <span className="label mb-1.5 block">Frequency</span>
                <div
                  role="radiogroup"
                  aria-label="Digest frequency"
                  className="inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line"
                >
                  {['daily', 'weekly', 'monthly'].map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={digest.frequency === f}
                      disabled={savingDigest}
                      onClick={() => digest.frequency !== f && saveDigest({ ...digest, frequency: f })}
                      className={`focus-ring rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors duration-150 disabled:opacity-60 ${
                        digest.frequency === f ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  Sent at most once per period. A period with no responses and no open batches is
                  skipped rather than emailing you a row of zeros.
                </p>
              </div>
            )}

            {user?.role === 'admin' && (
              <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Send now</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Fires every due digest immediately, so you can confirm delivery works without
                    waiting for the schedule.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runDigestNow}
                  disabled={runningDigest}
                  className="btn-ghost shrink-0"
                >
                  <Icon name="refresh" size={15} />
                  {runningDigest ? 'Sending…' : 'Run now'}
                </button>
              </div>
            )}
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

            {/* Deployment facts, admin only. These answer the questions that
                otherwise require SSH access: is mail actually going out, are
                transactions available, how hard is a passcode to guess. */}
            {system?.mail && (
              <>
                <Row label="Email delivery">
                  {system.mail.configured ? (
                    <span className="chip-open">
                      <Icon name="check" size={12} />
                      SMTP · {system.mail.host}
                    </span>
                  ) : (
                    <span
                      className="chip bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300"
                      title="With no SMTP host configured, every message — including password-reset links — is printed to the server console instead of being sent."
                    >
                      <Icon name="alert" size={12} />
                      Console only
                    </span>
                  )}
                </Row>
                <Row label="Transactions">
                  <span className={system.transactions ? 'text-ink' : 'text-amber-700 dark:text-amber-400'}>
                    {system.transactions ? 'Replica set — enabled' : 'Standalone — ordered-write fallback'}
                  </span>
                </Row>
                <Row label="Secure cookies">
                  <span className={system.cookieSecure ? 'text-ink' : 'text-amber-700 dark:text-amber-400'}>
                    {system.cookieSecure ? 'On' : 'Off (plain HTTP)'}
                  </span>
                </Row>
                <Row label="Passcode strength">
                  <span className="tnum text-ink">~{system.passcodeEntropyBits} bits</span>
                </Row>
                <Row label="Student rate limit">
                  <span className="tnum text-ink">
                    {system.rateLimits?.publicPerDevicePerMin}/min per device
                  </span>
                </Row>
                <Row label="Environment">
                  <span className="text-ink">{system.environment}</span>
                </Row>
                {/* Both halves, side by side. They are deployed separately and
                    can drift — a frontend expecting fields an older API does
                    not send yet is a real failure mode, and this makes it
                    visible in one glance instead of needing a probe. */}
                <Row label="App version">
                  <span className="font-mono text-xs text-ink">
                    web {typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev'}
                    <span className="text-subtle"> · </span>
                    api {system.version?.commit || 'unknown'}
                  </span>
                </Row>
              </>
            )}
          </dl>

          {/* Mail is the part of a deployment most likely to be quietly broken,
              and /forgot-password cannot report it (it must answer the same way
              for every address, or it becomes an enumeration oracle). So the
              state is stated plainly here, with a way to prove it. */}
          {system?.mail && (
            <div className="mt-4 border-t border-line pt-4">
              {!system.mail.configured && (
                <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs ring-1 ring-inset ring-amber-500/20">
                  <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <span className="text-ink">
                    <span className="font-semibold">Password reset emails are not being sent.</span>{' '}
                    With no SMTP configured, every message is printed to the server log instead.
                    Set <code className="font-mono">SMTP_HOST</code>,{' '}
                    <code className="font-mono">SMTP_USER</code> and{' '}
                    <code className="font-mono">SMTP_PASS</code> in the backend{' '}
                    <code className="font-mono">.env</code>. Until then, hand out a reset link
                    directly from the Mentors page.
                  </span>
                </p>
              )}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Send a test email</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Delivers a real message to {user?.email} and reports whether it was actually
                    sent or only logged.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={sendTestMail}
                  disabled={testingMail}
                  className="btn-ghost shrink-0"
                >
                  <Icon name="inbox" size={15} />
                  {testingMail ? 'Sending…' : 'Send test'}
                </button>
              </div>
            </div>
          )}
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
