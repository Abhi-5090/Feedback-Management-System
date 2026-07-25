import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AuthAPI } from '../api/endpoints.js';
import { useTheme } from '../theme/ThemeContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Icon from '../components/Icon.jsx';

const MIN = 6;

/** Choose a new password from an emailed link. */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const tooShort = pw.length > 0 && pw.length < MIN;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const canSubmit = token && pw.length >= MIN && pw === confirm && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await AuthAPI.resetPassword(token, pw);
      setDone(true);
      toast.success('Password changed — you can sign in now');
      setTimeout(() => navigate('/login', { replace: true }), 2200);
    } catch (err) {
      toast.error(err.message || 'That link is invalid or has expired.');
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center bg-surface p-4">
      <button
        onClick={toggle}
        className="btn-ghost absolute right-4 top-4 !px-2.5 !py-2"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
      </button>

      <div className="animate-fade-up w-full max-w-sm">
        <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand">
          <Icon name={done ? 'checkCircle' : 'lock'} size={21} strokeWidth={2} />
        </span>

        {!token ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Link not valid</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This page needs a reset link from your email. Request a new one to continue.
            </p>
            <Link to="/forgot-password" className="btn-primary mt-6">
              Request a new link
            </Link>
          </>
        ) : done ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Password changed</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Taking you to sign in…
            </p>
            <Link to="/login" className="btn-primary mt-6">
              Sign in now
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Choose a new password</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Pick something you haven't used here before.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="rp-pw">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="rp-pw"
                    type={show ? 'text' : 'password'}
                    className="input pr-11"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder={`At least ${MIN} characters`}
                    autoComplete="new-password"
                    autoFocus
                    aria-invalid={tooShort ? 'true' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
                {tooShort && (
                  <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                    Must be at least {MIN} characters.
                  </p>
                )}
              </div>

              <div>
                <label className="label" htmlFor="rp-confirm">
                  Confirm password
                </label>
                <input
                  id="rp-confirm"
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
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
