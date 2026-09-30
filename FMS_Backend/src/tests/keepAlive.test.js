import { jest } from '@jest/globals';
import { startKeepAlive, stopKeepAlive, pingOnce } from '../services/keepAlive.js';

/**
 * The keep-alive pinger.
 *
 * Two properties matter more than the pinging itself: it must stay OFF unless a
 * deployment turns it on (otherwise every local run and every CI job reaches out
 * to the network), and only one worker may run it (four workers on a 3-minute
 * timer is four times the traffic to answer the same question).
 */
const realFetch = global.fetch;
afterEach(() => {
  stopKeepAlive();
  global.fetch = realFetch;
  delete process.env.WORKER_INDEX;
  jest.useRealTimers();
});

describe('startKeepAlive', () => {
  test('is a no-op when no URL is configured', () => {
    // The default for local development and for the test suite.
    expect(startKeepAlive({ url: '' })).toBe(false);
  });

  test('starts when a URL is configured', () => {
    expect(startKeepAlive({ url: 'https://example.invalid/api/health', minutes: 3 })).toBe(true);
  });

  test('only ONE worker pings', () => {
    process.env.WORKER_INDEX = '3';
    expect(startKeepAlive({ url: 'https://example.invalid/api/health' })).toBe(false);
    process.env.WORKER_INDEX = '1';
    expect(startKeepAlive({ url: 'https://example.invalid/api/health' })).toBe(true);
  });

  test('starting twice does not create a second timer', () => {
    const url = 'https://example.invalid/api/health';
    expect(startKeepAlive({ url })).toBe(true);
    expect(startKeepAlive({ url })).toBe(true); // idempotent, not a second interval
  });

  test('the timer never holds the process open', () => {
    /* Without unref, a 3-minute interval keeps Node alive for up to three
       minutes after SIGTERM — long enough for Render to hard-kill the process
       mid-request instead of letting it drain. */
    const spy = jest.spyOn(global, 'setInterval');
    startKeepAlive({ url: 'https://example.invalid/api/health' });
    const timer = spy.mock.results[0].value;
    expect(typeof timer.unref).toBe('function');
    expect(timer.hasRef()).toBe(false);
    spy.mockRestore();
  });
});

describe('pingOnce', () => {
  test('reports a successful ping', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
    const r = await pingOnce('https://example.invalid/api/health');
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(typeof r.ms).toBe('number');
  });

  test('a non-2xx answer is not a success', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    await expect(pingOnce('https://example.invalid/api/health')).resolves.toMatchObject({ ok: false, status: 503 });
  });

  test('a network failure resolves rather than throwing', async () => {
    /* A rejected ping inside a bare setInterval callback is an unhandled
       rejection, which crashes the process on Node 20 — the pinger would take
       down the very service it is keeping up. */
    global.fetch = jest.fn(async () => { throw new Error('ENOTFOUND'); });
    await expect(pingOnce('https://example.invalid/api/health')).resolves.toMatchObject({ ok: false, error: 'ENOTFOUND' });
  });

  test('a hung request is abandoned rather than waited on forever', async () => {
    global.fetch = jest.fn((url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    await expect(pingOnce('https://example.invalid/api/health', 20)).resolves.toMatchObject({ ok: false, error: 'timeout' });
  });
});
