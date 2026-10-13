import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which organization the current unit of work belongs to.
 *
 * WHY THIS IS AMBIENT RATHER THAN A PARAMETER. There are ~190 model query
 * sites across the controllers and services. Threading an organization id
 * through all of them means ~190 chances to forget one, and a forgotten filter
 * does not fail — it quietly returns another institution's data, in a response
 * that looks perfectly well-formed. Tenancy is a property of the REQUEST, so
 * it is carried with the request and applied by the data layer (see
 * tenantPlugin), where it cannot be skipped by forgetting.
 *
 * The store holds one of:
 *   { organization: ObjectId }  — scoped to that tenant
 *   UNSCOPED                    — deliberately global (migrations, the super
 *                                 admin's cross-organization views, login)
 *
 * and NOTHING is the third state: no context at all, which is an error. A
 * query with no tenant decision attached is a bug, and it throws rather than
 * guessing, because both available guesses are wrong — scoping to nothing
 * breaks the feature, and scoping to everything is the data breach.
 */
const store = new AsyncLocalStorage();

/** Sentinel for work that is deliberately not tenant-scoped. */
export const UNSCOPED = Object.freeze({ unscoped: true });

/**
 * A fallback for code that does not run inside a request: migrations, seed
 * scripts, scheduled jobs and the test suite. Requests never rely on it —
 * the middleware always enters a real context — so it cannot be used to
 * widen a request's scope by accident.
 */
let ambient = null;

export function setAmbientTenant(ctx) {
  ambient = ctx;
}

export function clearAmbientTenant() {
  ambient = null;
}

/* NOTE THE `await` INSIDE. A Mongoose Query is lazy: `Model.find()` builds it,
   and the middleware that applies the tenant filter does not run until it is
   EXECUTED. Written as `store.run(ctx, () => Model.find())` the query is built
   inside the context and executed outside it by whoever awaits the result, so
   the scope is silently lost — the most dangerous shape this file can take,
   because it reads as correct and fails only at runtime. Awaiting inside keeps
   execution within the context. */
export const runWithTenant = (organization, fn) =>
  store.run({ organization }, async () => await fn());

/** Run `fn` with tenant scoping deliberately switched off. */
export const runUnscoped = (fn) => store.run(UNSCOPED, async () => await fn());

/**
 * Enter a tenant for the remainder of the current async context, without
 * wrapping a callback. Used by Express middleware, where the continuation is
 * `next()` and wrapping it would swallow downstream errors.
 */
export function enterTenant(organization) {
  store.enterWith({ organization });
}

export function enterUnscoped() {
  store.enterWith(UNSCOPED);
}

export const currentTenant = () => store.getStore() ?? ambient;

/** True when the caller has explicitly opted out of scoping. */
export const isUnscoped = (ctx = currentTenant()) => ctx === UNSCOPED || ctx?.unscoped === true;

/**
 * The organization id to filter by, or null when deliberately unscoped.
 * Throws when no decision has been made at all — see the note above on why
 * neither default is acceptable.
 */
export function requireTenant(operation = 'query') {
  const ctx = currentTenant();
  if (!ctx) {
    throw new Error(
      `Tenant context missing for ${operation}. Every query must run inside ` +
        'runWithTenant() / enterTenant(), or explicitly inside runUnscoped().'
    );
  }
  if (isUnscoped(ctx)) return null;
  if (!ctx.organization) {
    throw new Error(`Tenant context for ${operation} has no organization.`);
  }
  return ctx.organization;
}
