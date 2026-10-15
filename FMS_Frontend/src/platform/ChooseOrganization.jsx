import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthAPI } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useOrgScope } from './OrgScope.jsx';
import Icon from '../components/Icon.jsx';
import Spinner from '../components/Spinner.jsx';

const initials = (name) =>
  (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/**
 * Where a person who works at more than one institution lands.
 *
 * There is deliberately no default. Opening straight into whichever
 * organization happened to sort first would put one college's figures on
 * screen under a heading that does not say which college — and the reader
 * would have no reason to doubt it. A choice costs one click and removes a
 * whole class of quietly wrong conclusions.
 *
 * Somebody who works at ONE institution never sees this screen: they are sent
 * straight in. Ceremony for the common case would be the wrong trade.
 */
export default function ChooseOrganization() {
  const { user } = useAuth();
  const { setOrg } = useOrgScope();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);

  const enter = useCallback(
    (org) => {
      setOrg(org.id);
      navigate(org.role === 'admin' ? '/admin' : '/trainer');
    },
    [setOrg, navigate]
  );

  useEffect(() => {
    let alive = true;
    AuthAPI.organizations()
      .then((d) => {
        if (!alive) return;
        const list = d.organizations || [];
        setOrgs(list);
        /* One membership is not a choice. Sending them straight in is why
           this screen never appears for most people. */
        if (list.length === 1 && list[0].status !== 'suspended') enter(list[0]);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [enter]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <p className="max-w-sm text-center text-sm text-muted">{error}</p>
      </div>
    );
  }

  if (!orgs) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface">
        <Spinner label="Loading your organizations…" />
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-ink">You are not in any organization yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your account exists, but nobody has added you to an institution. Whoever invited you can
            do that from their Mentors screen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface px-5 py-14">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {user?.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Choose an organization
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted">
            You work at {orgs.length} institutions. Each keeps its own mentors, cohorts and feedback —
            nothing is shared between them.
          </p>
        </header>

        <ul className="stagger grid gap-3 sm:grid-cols-2">
          {orgs.map((o) => {
            const suspended = o.status === 'suspended';
            return (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={suspended}
                  onClick={() => enter(o)}
                  /* scale(0.98) on press, and only on a real pointer for the
                     hover lift — a touch device fires hover on tap and leaves
                     the card stuck looking active. */
                  className="focus-ring group flex w-full items-center gap-4 rounded-2xl border border-line bg-card p-5 text-left transition-[transform,border-color,box-shadow] duration-200 ease-out-expo active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 [@media(hover:hover)and(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)and(pointer:fine)]:hover:border-brand-500/40 [@media(hover:hover)and(pointer:fine)]:hover:shadow-card-hover"
                >
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-500/20 dark:text-brand-300"
                    aria-hidden="true"
                  >
                    {initials(o.name)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{o.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {suspended ? 'Suspended — you cannot sign in here' : `You are ${o.role === 'admin' ? 'an admin' : 'a mentor'} here`}
                    </span>
                  </span>

                  {!suspended && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-600 transition-transform duration-200 ease-out-expo [@media(hover:hover)and(pointer:fine)]:group-hover:translate-x-0.5 dark:text-brand-400">
                      View feedback
                      <Icon name="chevronRight" size={14} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
