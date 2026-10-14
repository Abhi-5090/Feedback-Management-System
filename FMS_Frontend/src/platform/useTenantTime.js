import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

/**
 * Dates rendered in the institution's own timezone.
 *
 * Feedback is stamped in UTC, which is right for storage and wrong for every
 * sentence a person reads. A session collected at 9pm in Hyderabad is the
 * 30th there and the 29th in UTC — so a collection date, a phase boundary and
 * a daily trend can each be off by one, and the report is not wrong enough to
 * be disbelieved, which is the dangerous kind of wrong.
 *
 * Previously every call site passed `timeZone: 'UTC'` by hand. That was a
 * deliberate fix for dates drifting with the viewer's own clock, and it traded
 * one wrong answer for another: correct for nobody rather than correct for
 * whoever is reading. The tenant's zone is the one that matches the room the
 * feedback was given in.
 */
const FALLBACK = 'Asia/Kolkata';

export function useTenantTime() {
  /* Tolerates being called outside the auth provider — in a test, on the
     student flow, inside a component rendered in isolation. Formatting a date
     must never be the thing that takes a page down, and falling back to the
     default zone is strictly better than throwing. */
  const auth = useAuth() || {};
  const timeZone = auth.organization?.settings?.timezone || FALLBACK;

  return useMemo(() => {
    const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone });

    /* Formatters are built once per zone: Intl.DateTimeFormat is expensive to
       construct and these run inside list renders. */
    const day = fmt({ day: 'numeric', month: 'short' });
    const full = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
    const time = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    const safe = (formatter) => (value) => {
      if (!value) return '—';
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? '—' : formatter.format(d);
    };

    return {
      timeZone,
      formatDay: safe(day),
      formatFull: safe(full),
      formatTime: safe(time),
    };
  }, [timeZone]);
}
