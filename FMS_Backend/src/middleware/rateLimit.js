import rateLimit from 'express-rate-limit';
import { isTest, env } from '../config/env.js';
import { DEVICE_COOKIE } from '../utils/token.js';
import { ClusterMemoryStore } from './clusterRateStore.js';

/**
 * Normalise a client address into a rate-limit key.
 *
 * IPv6 is bucketed to its /64 prefix. A single host is routinely handed a
 * whole /64 and can pick a fresh address inside it per request, so keying on
 * the full address makes an IPv6 limiter trivially bypassable while keying on
 * the /64 tracks the actual subscriber. IPv4 (including the ::ffff: mapped
 * form Node reports behind some proxies) is used as-is.
 *
 * Written here rather than imported: express-rate-limit only added an
 * `ipKeyGenerator` helper in some 7.x builds and this project's resolved
 * version does not export it, so importing it would break on install.
 */
export function ipKey(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return 'unknown';

  // IPv4-mapped IPv6 ("::ffff:203.0.113.5") → the embedded IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];

  if (!raw.includes(':')) return raw; // plain IPv4

  // IPv6 → first four hextets (the /64 prefix). Expand "::" first so a
  // compressed address buckets the same as its written-out equivalent.
  const [head, tail = ''] = raw.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const full = raw.includes('::')
    ? [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts]
    : raw.split(':');

  return full.slice(0, 4).map((h) => (h || '0').toLowerCase()).join(':') + '::/64';
}

/**
 * Rate limiting for the anonymous student endpoints.
 *
 * WHY NOT KEYED ON IP. A classroom is the unit of use here: 120 first-year
 * students on one campus Wi-Fi all present as a SINGLE public IP. A 30/min IP
 * budget therefore let roughly 15 students through per minute and showed the
 * rest "Too many requests" in the middle of a survey — the limiter was
 * throttling the legitimate use case it was supposed to protect.
 *
 * So there are two limiters, composed:
 *   1. perDeviceLimiter — keyed on the first-party httpOnly device cookie,
 *      which is exactly "one browser". A real student needs a handful of
 *      requests; 20/min is generous for them and still tight for a script
 *      reusing one cookie.
 *   2. publicIpLimiter — a much wider per-IP backstop that a whole campus never
 *      approaches, but a flood from one host does. This is sized for the real
 *      worst case: a 300-student cohort submitting together needs roughly two
 *      requests each (verify + submit), and several cohorts can run at once.
 *
 * `ipKey` (not `req.ip` directly) normalises IPv6 to its /64 subnet — raw IPv6
 * addresses are cheap to rotate within one prefix.
 */
const deviceKey = (req) => {
  const cookie = req.cookies?.[DEVICE_COOKIE];
  return cookie ? `dev:${cookie}` : `ip:${ipKey(req.ip)}`;
};

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  /* Counters live in the cluster primary, not in each worker — the default
     MemoryStore is per-process, so four workers would quietly multiply every
     limit by four. Each limiter below constructs its own NAMED store: several
     of them derive the same key from the same request (two key on the client
     IP), and an unnamespaced shared bucket would let student traffic exhaust
     the staff login budget.

     Deliberately NOT defaulted here: a shared default store is invisible at
     the call site, so a limiter added later would silently inherit someone
     else's bucket. ClusterMemoryStore requires a name, which turns that
     omission into a startup crash instead. */
  // The default handler emits a bare 429 body; ours matches the API's error
  // shape so the SPA's axios interceptor surfaces a real message, and carries
  // a machine code the student form uses to show a "wait a moment" hint
  // instead of a generic failure.
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many requests from this device. Please wait a moment and try again.',
      code: 'RATE_LIMITED',
    });
  },
};

/**
 * Per-browser budget. Generous for a real student (who needs about five
 * requests in total), tight for a script reusing one cookie.
 *
 * SKIPPED when the request carries no device cookie. This matters more than it
 * looks: the cookie is issued on the first call to verify-passcode, so an
 * entire class arriving together is briefly cookieless, and every one of those
 * first requests would otherwise collapse onto a SINGLE ip: bucket capped at
 * 20/min — throttling a 300-student cohort down to twenty. Cookieless traffic
 * is governed by the wide per-IP backstop below instead, which is the control
 * actually suited to it.
 */
export const perDeviceLimiter = rateLimit({
  ...shared,
  store: new ClusterMemoryStore('public-device'),
  windowMs: 60 * 1000,
  max: isTest ? 1_000_000 : env.publicMaxPerDevice,
  keyGenerator: deviceKey,
  skip: (req) => !req.cookies?.[DEVICE_COOKIE],
});

export const publicIpLimiter = rateLimit({
  ...shared,
  store: new ClusterMemoryStore('public-ip'),
  windowMs: 60 * 1000,
  max: isTest ? 1_000_000 : env.publicIpMax,
  keyGenerator: (req) => ipKey(req.ip),
  handler: (_req, res) => {
    res.status(429).json({
      error: 'This network is sending too many requests. Please try again shortly.',
      code: 'RATE_LIMITED',
    });
  },
});

/** Mount order matters: the wide IP backstop first, then the per-device budget. */
export const publicLimiter = [publicIpLimiter, perDeviceLimiter];

/**
 * Login limiter — keyed on (email + IP), not IP alone.
 *
 * Keyed on IP alone, one person mistyping their password twenty times locked
 * out every other trainer on the same campus network for 15 minutes. Keying on
 * the identity being attacked preserves the actual goal (slow credential
 * stuffing against one account) without the collateral lockout, and the
 * separate loginIpLimiter still caps total attempts from one source.
 */
export const loginLimiter = [
  rateLimit({
    ...shared,
    store: new ClusterMemoryStore('login-ip'),
    windowMs: 15 * 60 * 1000,
    max: isTest ? 1_000_000 : env.loginIpMax,
    keyGenerator: (req) => ipKey(req.ip),
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many sign-in attempts from this network. Please try again later.',
        code: 'RATE_LIMITED',
      });
    },
  }),
  rateLimit({
    ...shared,
    store: new ClusterMemoryStore('login-identity'),
    windowMs: 15 * 60 * 1000,
    max: isTest ? 1_000_000 : env.loginMaxPerIdentity,
    keyGenerator: (req) => {
      const email = String(req.body?.email || '').toLowerCase().trim();
      return email ? `id:${email}` : `ip:${ipKey(req.ip)}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many sign-in attempts for this account. Please try again later.',
        code: 'RATE_LIMITED',
      });
    },
  }),
];
