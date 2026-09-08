import { Parameter } from '../models/Parameter.js';

/**
 * A tiny in-memory cache of the active rating parameters.
 *
 * Every student's very first request reads this list, and every submission
 * validates against it — but it is the SAME eight documents for everyone and it
 * changes only when an admin edits the form, which is roughly never during a
 * collection window. Fetching it per request spends a database round trip
 * (~27ms to a remote cluster) on an answer that was already known, and during a
 * cohort-sized burst that is hundreds of pointless round trips competing with
 * the writes that actually matter.
 *
 * Deliberately process-local and TTL'd rather than a shared cache: there is
 * nothing to coordinate, a stale read is harmless for a few seconds, and every
 * mutation path busts it explicitly so an admin's edit shows up at once. With
 * several app instances, the TTL is the bound on how long another instance can
 * serve the old list.
 */
const TTL_MS = 15_000;

let cache = null;
let cachedAt = 0;
let inFlight = null;

/** Active parameters, sorted for display. Never mutate the returned array. */
export async function getActiveParameters() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;

  /* Collapse a stampede. Without this, 300 simultaneous cache misses become
     300 identical queries — the exact thundering herd the cache exists to
     prevent. Concurrent callers await the same promise. */
  if (inFlight) return inFlight;

  inFlight = Parameter.find({ isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .select('label description order')
    .lean()
    .then((rows) => {
      cache = rows;
      cachedAt = Date.now();
      inFlight = null;
      return rows;
    })
    .catch((err) => {
      inFlight = null;
      throw err;
    });

  return inFlight;
}

/** Called by every parameter mutation so an admin edit is visible immediately. */
export function bustParameterCache() {
  cache = null;
  cachedAt = 0;
}
