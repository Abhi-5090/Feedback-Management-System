import { renderHook } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';

let auth = null;
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }));
const { useTenantTime } = await import('./useTenantTime.js');

/* 2026-09-30T20:30:00Z is the 30th in UTC and already the 1st of October in
   Kolkata (+05:30). Exactly the boundary a report gets wrong. */
const LATE_EVENING = '2026-09-30T20:30:00.000Z';

describe('tenant timezone', () => {
  test('renders an instant in the institution\'s own zone, not UTC', () => {
    auth = { organization: { settings: { timezone: 'Asia/Kolkata' } } };
    const { result } = renderHook(() => useTenantTime());
    expect(result.current.timeZone).toBe('Asia/Kolkata');
    /* A session collected at 9pm in Hyderabad is "1 Oct" there. Shown as
       "30 Sep" it is not wrong enough to be disbelieved, which is the
       dangerous kind of wrong. */
    expect(result.current.formatDay(LATE_EVENING)).toBe('1 Oct');
  });

  test('the same instant reads differently in a different zone', () => {
    auth = { organization: { settings: { timezone: 'UTC' } } };
    const { result } = renderHook(() => useTenantTime());
    /* "Sept", not "Sep": en-GB abbreviates September to four letters in
       current ICU. Worth pinning — a date format silently changing shape is
       the kind of thing that only shows up in a screenshot. */
    expect(result.current.formatDay(LATE_EVENING)).toBe('30 Sept');
  });

  test('falls back rather than throwing when there is no organization', () => {
    /* The student flow and isolated components have no auth at all, and
       formatting a date must never be what takes a page down. */
    auth = null;
    const { result } = renderHook(() => useTenantTime());
    expect(result.current.timeZone).toBe('Asia/Kolkata');
    expect(result.current.formatDay(LATE_EVENING)).toBe('1 Oct');
  });

  test('an absent or unparseable date renders as a dash, not "Invalid Date"', () => {
    auth = { organization: { settings: { timezone: 'Asia/Kolkata' } } };
    const { result } = renderHook(() => useTenantTime());
    expect(result.current.formatDay(null)).toBe('—');
    expect(result.current.formatFull('not-a-date')).toBe('—');
  });
});
