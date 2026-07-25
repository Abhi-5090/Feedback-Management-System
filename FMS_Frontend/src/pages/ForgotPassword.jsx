import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthAPI } from '../api/endpoints.js';
import { useTheme } from '../theme/ThemeContext.jsx';
import Icon from '../components/Icon.jsx';

/**
 * Request a password-reset link.
 *
 * The success state is shown for ANY submitted address, matching the server,
 * which deliberately answers identically whether or not the account exists.
 * Saying "no such user" here would hand anyone a way to enumerate staff emails.
 */
export default function ForgotPassword() {
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    try {
      await AuthAPI.forgotPassword(email.trim());
    } catch {
      /* Deliberately ignored: the UI must not reveal whether the address exists. */
    } finally {
      setBusy(false);
      setSent(true);
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
          <Icon name={sent ? 'checkCircle' : 'lock'} size={21} strokeWidth={2} />
        </span>

        {sent ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              If <span className="font-medium text-ink">{email}</span> is registered, a reset link
              is on its way. It's valid for 30 minutes and can be used once.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <Link to="/login" className="btn-primary">
                Back to sign in
              </Link>
              <button className="btn-ghost" onClick={() => setSent(false)}>
                Try another email
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Forgot your password?</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Enter the email you sign in with and we'll send you a link to choose a new password.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="fp-email">
                  Email
                </label>
                <input
                  id="fp-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <Link
              to="/login"
              className="focus-ring mt-5 inline-flex items-center gap-1.5 rounded-lg text-sm text-muted transition-colors duration-150 hover:text-ink"
            >
              <Icon name="chevronLeft" size={14} />
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
