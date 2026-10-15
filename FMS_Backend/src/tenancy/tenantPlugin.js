import mongoose from 'mongoose';
import { requireTenant } from './tenantContext.js';

/**
 * Make tenant isolation a property of the data layer rather than of 190
 * remembered filters.
 *
 * Applied to every collection that belongs to an organization, this adds an
 * `organization` field and then forces it onto every read, write and delete
 * from the ambient tenant context. The guarantee it buys is the one the
 * product is sold on: a controller that forgets to filter still cannot return
 * another institution's rows, because the filter is not the controller's job.
 *
 * It fails CLOSED. A query with no tenant context throws instead of running,
 * which turns the dangerous bug (a silent cross-tenant read that looks
 * correct) into the harmless one (a loud error in a test). Work that is
 * genuinely global says so with runUnscoped().
 *
 * ── WHAT THIS DOES NOT COVER ────────────────────────────────────────────────
 * Mongoose middleware hangs off the Query and Aggregate objects, so anything
 * that bypasses them bypasses this: `Model.collection.*` (the raw driver),
 * `$lookup` inside an aggregation, and `populate` of a cross-tenant ref. Those
 * are handled deliberately —
 *   - raw driver calls: there are two (a back-dating helper and a counter
 *     reconcile), both in scripts, both unscoped by design;
 *   - $lookup: every pipeline that uses one is on a collection already scoped
 *     by the outer $match, and the joined collection carries the same
 *     organization — see the lookup audit in tenancy.test.js;
 *   - populate: refs can only point within an organization, which the write
 *     path enforces, so a populated doc cannot cross the line.
 */

/* Every Query method whose filter we must constrain. `estimatedDocumentCount`
   is absent on purpose: it reads collection metadata and takes no filter at
   all, so it cannot be scoped — it is blocked outright below. */
const READ_OPS = [
  'count',
  'countDocuments',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
];

const WRITE_OPS = [
  'deleteMany',
  'deleteOne',
  'replaceOne',
  'updateMany',
  'updateOne',
];

export function tenantPlugin(schema, options = {}) {
  const field = options.field || 'organization';

  /**
   * `multi` makes the tenant field an ARRAY — one document belonging to
   * several organizations.
   *
   * Only User needs it, and it is what lets one person work at two
   * institutions. It is safe for every existing query because MongoDB matches
   * a scalar filter against the ELEMENTS of an array: `{organization: X}`
   * finds a user whose array contains X, exactly as it found one whose field
   * equalled X. Thirty-one query sites therefore keep scoping correctly
   * without being touched — and not touching them is the point, because each
   * one edited by hand is a chance to produce a silent cross-tenant read.
   *
   * `required: false` is for the super admin, who belongs to no organization
   * at all — that absence is what makes them a platform account rather than a
   * very powerful member of one tenant.
   */
  const multi = options.multi === true;

  schema.add({
    [field]: multi
      ? {
          type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Organization' }],
          default: () => [],
          index: true,
        }
      : {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Organization',
          required: options.required !== false,
          default: null,
          index: true,
        },
  });

  /* Scope every query. `getFilter()` is mutated in place rather than chaining
     `.where()`, because a chained condition can be overwritten by a later
     `$or` on the same query — the same merge hazard that buildFeedbackMatch
     documents. */
  function scopeQuery(next) {
    let org;
    try {
      org = requireTenant(`${this.model?.modelName || 'model'}.${this.op}`);
    } catch (err) {
      return next(err);
    }
    if (org) this.setQuery({ ...this.getFilter(), [field]: org });
    return next();
  }

  for (const op of [...READ_OPS, ...WRITE_OPS]) {
    schema.pre(op, scopeQuery);
  }

  /* An aggregation's $match is just the first stage, so scoping means
     PREPENDING one. It must go first: a later stage can $group away the
     organization field, after which no filter can recover it. */
  schema.pre('aggregate', function aggregateScope(next) {
    let org;
    try {
      org = requireTenant(`${this.model?.()?.modelName || 'model'}.aggregate`);
    } catch (err) {
      return next(err);
    }
    if (org) this.pipeline().unshift({ $match: { [field]: org } });
    return next();
  });

  /* Writes. A document created inside a tenant context belongs to that tenant
     — the caller never sets this, so it cannot set it wrongly. A document
     that arrives already carrying a DIFFERENT organization is refused rather
     than silently rewritten: that is either a bug or an attempt, and both
     deserve to be loud. */
  /* On 'validate', NOT 'save'. Mongoose validates before pre('save') runs, so
     assigning the organization in the save hook meant `required: true` had
     already failed — the field was set a moment after the document was
     rejected for not having it. */
  schema.pre('validate', function validateScope(next) {
    let org;
    try {
      org = requireTenant(`${this.constructor.modelName}.validate`);
    } catch (err) {
      return next(err);
    }
    if (!org) return next();

    if (multi) {
      /* ADDED, never replaced. A document that already belongs to two
         organizations must not be reduced to whichever one happened to be
         current when it was last saved — that is how a mentor silently loses
         an institution by having their name edited. */
      const current = (this[field] || []).map(String);
      if (!current.includes(String(org))) this[field] = [...(this[field] || []), org];
      return next();
    }

    if (!this[field]) {
      this[field] = org;
    } else if (String(this[field]) !== String(org)) {
      return next(
        new Error(
          `Refusing to save a ${this.constructor.modelName} into organization ${org} ` +
            `while it carries ${this[field]}.`
        )
      );
    }
    return next();
  });

  schema.pre('insertMany', function insertManyScope(next, docs) {
    let org;
    try {
      org = requireTenant(`${this.modelName}.insertMany`);
    } catch (err) {
      return next(err);
    }
    if (!org) return next();
    for (const doc of docs || []) {
      if (!doc[field]) doc[field] = org;
      else if (String(doc[field]) !== String(org)) {
        return next(new Error(`Refusing to insert a ${this.modelName} into another organization.`));
      }
    }
    return next();
  });

  /* Takes no filter, so it can never be tenant-scoped and would silently
     report every organization's rows. Blocked rather than left as a trap. */
  schema.pre('estimatedDocumentCount', function blockEstimated(next) {
    next(
      new Error(
        `${this.model?.modelName || 'This model'} is tenant-scoped: ` +
          'estimatedDocumentCount() cannot be filtered. Use countDocuments().'
      )
    );
  });
}
