import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Spinner from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';

export default function Login() {
  const { user, login, loading } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);

  // If already authenticated, bounce to the right home.
  useEffect(() => {
    if (!loading && user) navigate(user.role === 'admin' ? '/admin' : '/trainer', { replace: true });
  }, [user, loading, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      toast.success(`Welcome back, ${u.name}`);
      navigate(u.role === 'admin' ? '/admin' : '/trainer', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login failed');
      setPassword('');
      pwRef.current?.focus();
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface">
        <Spinner label="Loading…" />
      </div>
    );
  }

  return (
    <div className="relative grid min-h-screen bg-surface p-3 lg:grid-cols-2 lg:gap-3">
      {/* ── Brand panel: the mesh does the selling, the form stays quiet ────── */}
      <aside className="hero hidden flex-col justify-between p-10 lg:flex">
        <div className="hero-body">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
              <Icon name="activity" size={20} strokeWidth={2} />
            </span>
            <p className="text-lg font-bold tracking-tight text-white">Feedback Management</p>
          </div>
        </div>

        <div className="hero-body max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">
            Honest feedback,
            <br />
            completely anonymous.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Passcode-gated sessions, one response per device, and not a single
            piece of student identity stored — so the ratings you get are the
            ratings people actually meant.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              ['ticket', 'Per-batch passcodes, rotated on every unlock'],
              ['shield', 'No name, no IP, no device trace in the feedback'],
              ['barChart', 'Live dashboards with Excel & PDF exports'],
            ].map(([ic, text]) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/80">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white/90">
                  <Icon name={ic} size={15} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="hero-body text-xs text-white/50">
          Students never sign in — they open a link and enter a passcode.
        </p>
      </aside>

      {/* ── Form panel ──────────────────────────────────────────────────────── */}
      <main className="relative grid place-items-center p-4 sm:p-8">
        <button
          onClick={toggle}
          className="btn-ghost absolute right-2 top-2 !px-2.5 !py-2"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>

        {/* Entrance is CSS, not JS: predetermined (nothing to interrupt), runs
            off the main thread, and the card can never be left invisible by a
            stalled animation loop — content must not depend on motion. */}
        <div className="animate-fade-up w-full max-w-sm">
        {/* Brand mark repeats here only on mobile, where the left panel is hidden */}
        <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand lg:hidden">
          <Icon name="activity" size={21} strokeWidth={2} />
        </span>

        <div className="mb-7">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">
            Admin &amp; trainer access to the feedback workspace.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
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

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label className="label !mb-0" htmlFor="password">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="focus-ring rounded text-xs font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700 dark:text-brand-400"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="password"
                ref={pwRef}
                type={showPw ? 'text' : 'password'}
                required
                autoComplete="current-password"
                className="input pr-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
                className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
              >
                <Icon name={showPw ? "eyeOff" : "eye"} size={16} />
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  style={{ animationDuration: '0.6s' }}
                  aria-hidden="true"
                />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* On desktop the left panel already makes this point, so it's mobile-only */}
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/60 p-3.5 text-xs leading-relaxed text-muted lg:hidden">
          <span className="mt-0.5 shrink-0 text-muted">
            <Icon name="graduation" size={15} />
          </span>
          <p>
            <span className="font-semibold text-ink">Students don’t sign in.</span> They open a
            per-batch link and enter the passcode — feedback is fully anonymous.
          </p>
        </div>
        </div>
      </main>
    </div>
  );
}
