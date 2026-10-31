import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Choosing an organization must stick on the first click.
 *
 * Reported as: set a password, get the picker, click a college, land back on
 * the picker. The cause was an ordering race — React runs effects
 * children-first, so the page being navigated INTO fetched before the
 * provider above it had applied the header. The request said nothing about
 * which institution, the server asked for a choice, and the client sent the
 * person back to the question they had just answered.
 */
let reloads = [];

beforeEach(() => {
  vi.resetModules();
  reloads = [];
  localStorage.clear();
  vi.stubGlobal('location', {
    pathname: '/trainer',
    assign: (u) => reloads.push(u),
    reload: () => reloads.push('RELOAD'),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('the header is applied the instant the choice is made', () => {
  test('setOrganizationHeader takes effect without waiting for a render', async () => {
    /* The provider calls this synchronously from setOrg; the effect is only
       for an organization restored from storage on a cold load. */
    const { setOrganizationHeader, api } = await import('../api/client.js');
    setOrganizationHeader('org-123');

    /* Run EVERY request interceptor, in order, the way axios does. Taking
       just the first broke the moment a second one was added for failover —
       and a test that depends on how many interceptors exist is testing the
       wrong thing. */
    const cfg = api.interceptors.request.handlers
      .filter((h) => h?.fulfilled)
      .reduce((c, h) => h.fulfilled(c), { url: '/analytics/sessions', headers: {} });
    expect(cfg.headers['X-Organization']).toBe('org-123');
  });

  test('clearing it stops the header being sent', async () => {
    const { setOrganizationHeader, api } = await import('../api/client.js');
    setOrganizationHeader('org-123');
    setOrganizationHeader(undefined);
    const cfg = api.interceptors.request.handlers
      .filter((h) => h?.fulfilled)
      .reduce((c, h) => h.fulfilled(c), { url: '/analytics/sessions', headers: {} });
    expect(cfg.headers?.['X-Organization']).toBeUndefined();
  });
});

describe('a request that raced the header heals itself', () => {
  const refuse = () => ({
    config: { url: '/analytics/sessions', headers: {} },
    response: { status: 400, data: { code: 'ORGANIZATION_CHOICE_REQUIRED', error: 'choose' } },
  });

  test('retries once with the organization instead of bouncing to the picker', async () => {
    const mod = await import('../api/client.js');
    mod.setOrganizationHeader('org-123');

    const request = vi.spyOn(mod.api, 'request').mockResolvedValue({ data: 'ok' });
    const [handler] = mod.api.interceptors.response.handlers.filter((h) => h?.rejected);

    const res = await handler.rejected(refuse());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].headers['X-Organization']).toBe('org-123');
    expect(res).toEqual({ data: 'ok' });
    /* They already answered the question — do not ask it again. */
    expect(reloads).toEqual([]);
  });

  test('a retry never retries itself', async () => {
    const mod = await import('../api/client.js');
    mod.setOrganizationHeader('org-123');
    const request = vi.spyOn(mod.api, 'request').mockResolvedValue({ data: 'ok' });
    const [handler] = mod.api.interceptors.response.handlers.filter((h) => h?.rejected);

    const already = refuse();
    already.config.__orgRetry = true;
    already.config.headers['X-Organization'] = 'org-123';
    await handler.rejected(already).catch(() => {});

    expect(request).not.toHaveBeenCalled();
    expect(reloads).toEqual(['/choose-organization']);
  });

  test('with NO choice made, it asks the question rather than retrying blindly', async () => {
    const mod = await import('../api/client.js');
    const request = vi.spyOn(mod.api, 'request');
    const [handler] = mod.api.interceptors.response.handlers.filter((h) => h?.rejected);

    await handler.rejected(refuse()).catch(() => {});
    expect(request).not.toHaveBeenCalled();
    expect(reloads).toEqual(['/choose-organization']);
  });

  test('and never bounces while already on the picker', async () => {
    /* The picker is allowed to make exactly this request. */
    vi.stubGlobal('location', {
      pathname: '/choose-organization',
      assign: (u) => reloads.push(u),
      reload: () => reloads.push('RELOAD'),
    });
    const mod = await import('../api/client.js');
    const [handler] = mod.api.interceptors.response.handlers.filter((h) => h?.rejected);
    await handler.rejected(refuse()).catch(() => {});
    expect(reloads).toEqual([]);
  });
});
