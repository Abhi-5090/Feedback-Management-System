import cluster from 'node:cluster';

/**
 * A rate-limit store that is correct across clustered workers.
 *
 * THE PROBLEM. `express-rate-limit`'s default MemoryStore lives inside one
 * process. Run four workers and each keeps its own counters, so a limit of
 * 20/min becomes an effective 80/min — the control silently weakens by exactly
 * the factor you scaled by, which is the worst kind of security regression
 * because throughput looks better and nothing appears broken.
 *
 * THE FIX. Counters live in the PRIMARY process; workers ask it to increment
 * over the channel Node already gives them. One authoritative counter, no new
 * dependency, no Redis to run and secure. (Redis is the right answer once you
 * scale past one machine — see the note at the bottom.)
 *
 * Failure behaviour is deliberate: if the primary does not answer within
 * `TIMEOUT_MS`, the request is ALLOWED. A rate limiter is a protective control,
 * not a correctness one, and failing closed would turn a hiccup in an internal
 * IPC channel into a total outage for students mid-survey. The failure is
 * logged so it cannot pass unnoticed.
 */

const CHANNEL = 'fms:ratelimit';
const TIMEOUT_MS = 1000;

/* ── Primary side ─────────────────────────────────────────────────────────── */

/** key -> { hits, resetAt }. Swept lazily; see sweep(). */
const counters = new Map();
let sweepTimer = null;

function bump(key, windowMs) {
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || entry.resetAt <= now) {
    const fresh = { hits: 1, resetAt: now + windowMs };
    counters.set(key, fresh);
    return fresh;
  }
  entry.hits += 1;
  return entry;
}

/**
 * Drop expired counters.
 *
 * Without this the map grows one entry per device forever — a slow leak that
 * only shows up weeks into a deployment, which is precisely when nobody is
 * looking for it. Runs on a timer rather than on every increment so a burst
 * does not pay for the cleanup.
 */
function sweep() {
  const now = Date.now();
  for (const [key, entry] of counters) {
    if (entry.resetAt <= now) counters.delete(key);
  }
}

/** Call once in the primary, before forking. */
export function installPrimaryRateLimitHub() {
  if (!cluster.isPrimary) return;

  const handle = (worker, msg) => {
    if (!msg || msg.channel !== CHANNEL) return;

    let payload;
    if (msg.op === 'increment') {
      const { hits, resetAt } = bump(msg.key, msg.windowMs);
      payload = { hits, resetAt };
    } else if (msg.op === 'decrement') {
      const entry = counters.get(msg.key);
      if (entry && entry.hits > 0) entry.hits -= 1;
      payload = {};
    } else if (msg.op === 'reset') {
      counters.delete(msg.key);
      payload = {};
    } else {
      return;
    }

    // The worker may have died between asking and now; send() would throw.
    try {
      worker.send({ channel: CHANNEL, id: msg.id, payload });
    } catch {
      /* worker is gone; nothing to answer */
    }
  };

  cluster.on('message', handle);
  // A worker that forks before this listener attaches would get no reply, so
  // attach to already-known workers too.
  for (const w of Object.values(cluster.workers || {})) {
    w.on('message', (msg) => handle(w, msg));
  }

  if (!sweepTimer) {
    sweepTimer = setInterval(sweep, 60_000);
    sweepTimer.unref?.();
  }
}

/* ── Worker side ──────────────────────────────────────────────────────────── */

let seq = 0;
const pending = new Map();
let listenerAttached = false;

function attachWorkerListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  process.on('message', (msg) => {
    if (!msg || msg.channel !== CHANNEL || msg.id == null) return;
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg.payload);
    }
  });
}

function ask(op, key, windowMs) {
  return new Promise((resolve) => {
    const id = ++seq;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    };

    const timer = setTimeout(() => {
      console.error(`[ratelimit] primary did not answer for "${op}" — allowing the request`);
      done(null); // fail OPEN, deliberately
    }, TIMEOUT_MS);
    timer.unref?.();

    pending.set(id, done);
    try {
      process.send({ channel: CHANNEL, id, op, key, windowMs });
    } catch {
      done(null);
    }
  });
}

/**
 * Store implementing express-rate-limit's interface. Falls back to per-process
 * counting when not running under cluster, so a single-process `npm start` and
 * the test suite behave identically without a branch at every call site.
 */
export class ClusterMemoryStore {
  /**
   * @param {string} name  Namespace for this limiter's keys.
   *
   * NAMESPACING IS NOT COSMETIC. The primary holds one counter map, and several
   * limiters legitimately derive the SAME key from the same request — the
   * public per-IP backstop and the login per-IP limiter both key on the client
   * address. Sharing a bucket means student traffic and staff sign-ins consume
   * each other's budget: a 400-student burst drove the shared `127.0.0.1`
   * counter past the login limit and locked the admin out of the product,
   * which is a self-inflicted denial of service triggered by ordinary use.
   * Every store therefore prefixes its keys.
   */
  constructor(name) {
    if (!name || typeof name !== 'string') {
      /* Fail at construction — which happens at import time, so a missing
         namespace stops the process from starting rather than quietly letting
         two limiters share a counter in production. */
      throw new Error(
        'ClusterMemoryStore requires a unique namespace, e.g. new ClusterMemoryStore("login-ip"). ' +
          'Two limiters sharing a bucket lets one kind of traffic exhaust another\'s budget.'
      );
    }
    this.windowMs = 60_000;
    this.ns = name;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  /** Fully-qualified key: this limiter's namespace plus the caller's key. */
  k(key) {
    return `${this.ns}|${key}`;
  }

  async increment(key) {
    if (!cluster.isWorker) {
      const { hits, resetAt } = bump(this.k(key), this.windowMs);
      return { totalHits: hits, resetTime: new Date(resetAt) };
    }
    attachWorkerListener();
    const res = await ask('increment', this.k(key), this.windowMs);
    if (!res) {
      // Fail open: report a single hit so the limiter lets this one through.
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
    return { totalHits: res.hits, resetTime: new Date(res.resetAt) };
  }

  async decrement(key) {
    if (!cluster.isWorker) {
      const entry = counters.get(this.k(key));
      if (entry && entry.hits > 0) entry.hits -= 1;
      return;
    }
    attachWorkerListener();
    await ask('decrement', this.k(key), this.windowMs);
  }

  async resetKey(key) {
    if (!cluster.isWorker) {
      counters.delete(this.k(key));
      return;
    }
    attachWorkerListener();
    await ask('reset', this.k(key), this.windowMs);
  }
}

/*
 * ── Beyond one machine ────────────────────────────────────────────────────
 * This keeps counters correct across workers on ONE host. Behind a load
 * balancer spreading traffic over several hosts, each host would again keep its
 * own counters and the limits would loosen by the number of hosts. At that
 * point swap this class for `rate-limit-redis` pointed at a shared instance —
 * the Store interface is identical, so only the construction in
 * middleware/rateLimit.js changes.
 */
