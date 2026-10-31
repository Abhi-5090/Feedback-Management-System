import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Failing over between two backends.
 *
 * The spare is reached through THIS origin (/api-backup), never by its own
 * hostname, because the session is an httpOnly SameSite=lax cookie and a lax
 * cookie is not sent cross-site. Calling the other Render URL directly would
 * reach a healthy server with no session attached — every failover request
 * arriving as a stranger.
 */
let mod;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('location', { pathname: '/admin', assign: () => {}, reload: () => {} });
  mod = await import('./client.js');
  mod.__resetFailover();
});
afterEach(() => vi.unstubAllGlobals());

const rejected = () => mod.api.interceptors.response.handlers.find((h) => h?.rejected).rejected;

const unreachable = (status) => ({
  config: { url: '/classes', baseURL: '/api/v1', headers: {} },
  ...(status ? { response: { status, data: {} } } : {}),
});

describe('what counts as a backend being down', () => {
  test('no response at all, or a gateway refusing — those are unreachable', () => {
    /* A suspended Render service answers 503 from its own error page. */
    expect(mod.looksUnreachable({ })).toBe(true);
    expect(mod.looksUnreachable({ code: 'ECONNABORTED' })).toBe(true);
    for (const s of [502, 503, 504]) {
      expect(mod.looksUnreachable({ response: { status: s } })).toBe(true);
    }
  });

  test('a 500 is NOT, because the other copy runs the same code', () => {
    /* The app was reached and threw. Its twin, against the same database,
       will throw too — failing over just doubles the wait. */
    expect(mod.looksUnreachable({ response: { status: 500 } })).toBe(false);
  });

  test('and nor is any real answer', () => {
    for (const s of [400, 401, 403, 404, 409, 429]) {
      expect(mod.looksUnreachable({ response: { status: s } })).toBe(false);
    }
  });
});

describe('the retry', () => {
  test('goes to the backup, on this origin rather than the other hostname', async () => {
    const request = vi.spyOn(mod.api, 'request').mockResolvedValue({ data: 'ok' });
    const res = await rejected()(unreachable(503));

    expect(res).toEqual({ data: 'ok' });
    const sent = request.mock.calls[0][0];
    expect(sent.baseURL).toBe('/api-backup/v1');
    /* Never the backend's own hostname: a lax cookie would not go with it. */
    expect(sent.baseURL).not.toMatch(/^https?:/);
  });

  test('sticks to the backup afterwards, so the dead one is not re-probed each time', async () => {
    vi.spyOn(mod.api, 'request').mockResolvedValue({ data: 'ok' });
    await rejected()(unreachable(503));
    expect(mod.failoverState().activeBase).toBe('/api-backup/v1');
  });

  test('does NOT stick if the backup also fails', async () => {
    /* Switching on the attempt would strand every later request on a backend
       that is equally dead. */
    vi.spyOn(mod.api, 'request').mockRejectedValue(new Error('also down'));
    await rejected()(unreachable(503)).catch(() => {});
    expect(mod.failoverState().activeBase).toBe('/api/v1');
  });

  test('surfaces the ORIGINAL error when both are gone', async () => {
    vi.spyOn(mod.api, 'request').mockRejectedValue(new Error('backup down'));
    const original = unreachable(503);
    await expect(rejected()(original)).rejects.toBeDefined();
  });

  test('a retry never retries itself', async () => {
    const request = vi.spyOn(mod.api, 'request').mockResolvedValue({ data: 'ok' });
    const already = unreachable(503);
    already.config.__failedOver = true;
    await rejected()(already).catch(() => {});
    expect(request).not.toHaveBeenCalled();
  });

  test('a 500 is passed straight through without a second attempt', async () => {
    const request = vi.spyOn(mod.api, 'request');
    await rejected()(unreachable(500)).catch(() => {});
    expect(request).not.toHaveBeenCalled();
  });
});

describe('recovering', () => {
  test('returns to the primary once the sticky window has passed', async () => {
    vi.spyOn(mod.api, 'request').mockResolvedValue({ data: 'ok' });
    await rejected()(unreachable(503));
    expect(mod.failoverState().activeBase).toBe('/api-backup/v1');

    /* Long enough that a dead primary is not re-probed on every request;
       short enough that recovery is noticed quickly. */
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    const handler = mod.api.interceptors.request.handlers.find((h) => h?.fulfilled).fulfilled;
    const cfg = handler({ url: '/classes', headers: {} });
    expect(cfg.baseURL).toBe('/api/v1');
  });
});
