import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * The password a new admin starts with.
 *
 * Typing one makes handing the account over a single conversation. Leaving it
 * blank generates one, shown once — which is safer but means a second step to
 * pass it on. Both are legitimate, so neither is hidden behind a setting.
 *
 * "Require a change at first sign-in" defaults ON for a typed password,
 * because the person who typed it knows it: until it is replaced, that account
 * is shared between two people. It is a checkbox and not a rule because an
 * operator setting up an account they will hand over in person may reasonably
 * decide otherwise.
 */
export default function AdminCredentialFields({ value, onChange, idPrefix = 'admin' }) {
  const [reveal, setReveal] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor={`${idPrefix}-password`}>
          Password <span className="font-normal text-subtle">— leave blank to generate one</span>
        </label>
        <div className="relative">
          <input
            id={`${idPrefix}-password`}
            type={reveal ? 'text' : 'password'}
            className="input !pr-11"
            autoComplete="new-password"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            placeholder="Generate one for me"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:text-ink"
          >
            <Icon name={reveal ? 'eyeOff' : 'eye'} size={15} />
          </button>
        </div>
        <p className="hint">At least 8 characters, and not the person&rsquo;s own name or email.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-600 focus-ring"
          checked={value.requirePasswordChange}
          onChange={(e) => onChange({ ...value, requirePasswordChange: e.target.checked })}
        />
        <span className="text-xs leading-relaxed text-muted">
          <span className="font-semibold text-ink">Make them choose a new password at first sign-in.</span>{' '}
          Until they do, you both know it.
        </span>
      </label>
    </div>
  );
}
