import { useState } from 'react';
import { AuthAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';

const MIN = 6;

/**
 * First-login password change.
 *
 * Shown INSTEAD of the app whenever `mustChangePassword` is set — accounts
 * created by an admin or a bulk import start on a password someone else chose,
 * and in the bulk case a single secret opens every imported account. The server
 * refuses every data route until it's replaced (403 PASSWORD_CHANGE_REQUIRED),
 * so this screen is the only way forward rather than a dismissible prompt.
 *
 * There is deliberately no "skip" and no logout-to-avoid: signing out and back
 * in returns here, because the flag lives on the account, not the session.
 */
export default function ForcePasswordChange() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const tooShort = pw.length > 0 && pw.length < MIN;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const sameAsOld = pw.length > 0 && pw === current;
  const canSubmit =
    current.length > 0 && pw.length >= MIN && pw === confirm && !sameAsOld && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await AuthAPI.updateMe({ currentPassword: current, newPassword: pw });
      toast.success('Password set — welcome aboard');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Could not set your password');
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-surface p-4">
      <div className="animate-fade-up w-full max-w-md">
        <div className="card p-7">
          <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand">
            <Icon name="lock" size={21} strokeWidth={2} />
          </span>

          <h1 className="text-2xl font-bold tracking-tight text-ink">Choose your password</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Your account was created with a password someone else set. Pick your own to continue —
            it takes a moment and it's the last time you'll see this.
          </p>

          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/60 p-3 text-xs leading-relaxed text-muted">
            <span className="mt-0.5 shrink-0">
              <Icon name="user" size={14} />
            </span>
            <p>
              Signed in as <span className="font-semibold text-ink">{user?.email}</span>
            </p>
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="fc-cur">
                Current password
              </label>
              <div className="relative">
                <input
                  id="fc-cur"
                  type={show ? 'text' : 'password'}
                  className="input pr-11"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="The one you were given"
                  autoComplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide passwords' : 'Show passwords'}
                  className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
                </button>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="fc-new">
                New password
              </label>
              <input
                id="fc-new"
                type={show ? 'text' : 'password'}
                className="input"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={`At least ${MIN} characters`}
                autoComplete="new-password"
                aria-invalid={tooShort || sameAsOld ? 'true' : undefined}
              />
              {tooShort && (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Must be at least {MIN} characters.
                </p>
              )}
              {sameAsOld && (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Choose something different from the password you were given.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="fc-conf">
                Confirm new password
              </label>
              <input
                id="fc-conf"
                type={show ? 'text' : 'password'}
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                aria-invalid={mismatch ? 'true' : undefined}
              />
              {mismatch && (
                <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Passwords don’t match.
                </p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full !py-3" disabled={!canSubmit}>
              {busy ? 'Saving…' : 'Set password and continue'}
            </button>
          </form>

          <button
            onClick={logout}
            className="focus-ring mt-4 w-full rounded-lg text-center text-xs text-muted transition-colors duration-150 hover:text-ink"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
