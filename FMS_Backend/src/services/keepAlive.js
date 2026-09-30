import { env } from '../config/env.js';

/**
 * Keep-alive pinger for a free Render instance.
 *
 * WHAT THIS ACTUALLY FIXES. A free Render web service spins down after ~15
 * minutes with no inbound traffic, and the next request pays the cold start —
 * measured at 35 seconds on this deployment. That is long enough that a person
 * assumes the click did not register and presses the button again, and every
 * one of those presses is a real request the server counts. The sign-in limiter
 * allows 20 attempts per account per 15 minutes, so a few slow starts and a few
 * impatient retries is all it takes to reach "Too many sign-in attempts".
 *
 * So the 429 is not the sleep itself — a cold start returns a slow 200, never a
 * 429 — but the sleep is what produces the retries that exhaust the limiter.
 * Keeping the instance warm removes the delay, and the retries stop with it.
 *
 * WHY THE PING GOES OUT TO THE PUBLIC URL. Render counts INBOUND traffic. A
 * request to 127.0.0.1 never leaves the container and does not reset the idle
 * timer, so the ping has to travel out and back through Render's edge to count
 * as a visit. That also means this can only PREVENT a sleep, never end one: an
 * instance that is already down cannot ping itself awake. The scheduled
 * workflow in .github/workflows/keepalive.yml is the external half that can.
 *
 * It targets /api/health deliberately. /api/ready opens a database round trip,
 * which is wasted work 480 times a day, and neither path is rate-limited.
 */

let timer = null;
let lastOk = null; // null until the first result — so the first ping always logs

function log(message) {
  // eslint-disable-next-line no-console
  console.log(`[keepalive] ${message}`);
}

/** One ping. Never throws: a failed ping must not take the process down. */
export async function pingOnce(url = env.keepAliveUrl, timeoutMs = 30_000) {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'fms-keepalive' },
      redirect: 'follow',
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'failed', ms: Date.now() - startedAt };
  } finally {
    clearTimeout(abort);
  }
}

/**
 * Start the pinger. A no-op unless KEEP_ALIVE_URL is set, so local runs and the
 * test suite never reach out to the network.
 *
 * @returns {boolean} whether the timer was started
 */
export function startKeepAlive({ url = env.keepAliveUrl, minutes = env.keepAliveMinutes } = {}) {
  if (timer) return true;
  if (!url) return false;

  /* Only one worker pings. Four workers on a 3-minute timer is four times the
     traffic to answer the same question, and the same reasoning as the digest
     scheduler directly above this in server.js. */
  const workerIndex = process.env.WORKER_INDEX;
  if (workerIndex && workerIndex !== '1') return false;

  const everyMs = Math.max(1, minutes) * 60_000;

  const tick = async () => {
    const result = await pingOnce(url);
    /* Log the first result, then only when the state CHANGES. A line every
       three minutes is 480 lines a day that nobody reads and that bury the
       entries that matter; a line when it starts failing is the one worth
       having. */
    if (lastOk === null || result.ok !== lastOk) {
      log(result.ok
        ? `ok — ${url} answered ${result.status} in ${result.ms}ms (pinging every ${minutes}m)`
        : `FAILING — ${url}: ${result.error || `status ${result.status}`} after ${result.ms}ms`);
      lastOk = result.ok;
    }
  };

  // `unref` so a pending timer never keeps the process alive during shutdown.
  timer = setInterval(tick, everyMs);
  timer.unref?.();
  // Not immediately: at boot the server is warm by definition, and pinging
  // itself before `listen` has settled just logs a confusing failure.
  setTimeout(tick, 30_000).unref?.();

  log(`enabled — ${url} every ${minutes} minute(s)`);
  return true;
}

export function stopKeepAlive() {
  if (timer) clearInterval(timer);
  timer = null;
  lastOk = null;
}
