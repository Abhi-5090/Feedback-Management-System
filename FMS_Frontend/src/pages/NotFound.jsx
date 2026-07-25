import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-surface p-4 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl"
      />
      <div className="animate-fade-up relative">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-subtle ring-1 ring-inset ring-line">
          <Icon name="compass" size={28} />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">Page not found</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn-outline" onClick={() => navigate(-1)}>
            Go back
          </button>
          <Link to="/login" className="btn-primary">
            Go to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
