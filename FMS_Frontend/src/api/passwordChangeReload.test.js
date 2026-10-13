import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * The reload that recovers a locked account must not become a reload LOOP.
 *
 * An account still on an admin-issued password is refused every data route.
 * The client reloads on that refusal so the change-password screen can take
 * over instead of leaving a half-dead page behind failing requests. The guard
 * against repeating was a property on `window` — which the reload itself
 * destroys. The next load made the same request, got the same 403, found no
 * flag, and reloaded again: an endless cycle that looks, to the person in
 * front of it, like the password screen flickering and never settling.
 */
let reloadCount = 0;

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  reloadCount = 0;
  vi.stubGlobal('location', { reload: () => { reloadCount += 1; } });
});
afterEach(() => vi.unstubAllGlobals());

/** The interceptor's rejection path, exercised through the real module. */
async function reject(code) {
  const mod = await import('./client.js');
  const handler = mod.api.interceptors.response.handlers.find((h) => h?.rejected);
  const err = { response: { status: 403, data: { code, error: 'nope' } } };
  await handler.rejected(err).catch(() => {});
  return mod;
}

describe('PASSWORD_CHANGE_REQUIRED reload', () => {
  test('reloads once for a locked account', async () => {
    await reject('PASSWORD_CHANGE_REQUIRED');
    expect(reloadCount).toBe(1);
  });

  test('does NOT reload again after the page has reloaded', async () => {
    await reject('PASSWORD_CHANGE_REQUIRED');
    expect(reloadCount).toBe(1);

    /* Simulate the reload: every module is re-evaluated and `window` is new,
       which is exactly what defeated the old guard. sessionStorage survives,
       so the second load must stay put. */
    vi.resetModules();
    await reject('PASSWORD_CHANGE_REQUIRED');
    expect(reloadCount).toBe(1);

    vi.resetModules();
    await reject('PASSWORD_CHANGE_REQUIRED');
    expect(reloadCount).toBe(1);
  });

  test('other failures never reload', async () => {
    await reject('BAD_PHASE');
    await reject(undefined);
    expect(reloadCount).toBe(0);
  });

  test('clearing the flag allows a later lock to recover', async () => {
    const mod = await reject('PASSWORD_CHANGE_REQUIRED');
    expect(reloadCount).toBe(1);
    mod.clearPasswordChangeReload();

    vi.resetModules();
    await reject('PASSWORD_CHANGE_REQUIRED');
    expect(reloadCount).toBe(2);
  });

  test('unavailable storage means no reload rather than an unbounded one', async () => {
    /* Private browsing can throw on access. One stale page is a far smaller
       failure than a tab that reloads for ever. */
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    try {
      await reject('PASSWORD_CHANGE_REQUIRED');
      expect(reloadCount).toBe(0);
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
