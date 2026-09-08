/**
 * Guarantee every query-string value is a plain string.
 *
 * WHY. Several handlers legitimately put a query value straight into a Mongo
 * filter (`filter.action = req.query.action`). That is only safe while the
 * value is a STRING. If a query parser produces an object, the same line
 * becomes a NoSQL injection: `?action[$ne]=x` turns an equality match into
 * `{ $ne: 'x' }`, and `?actor[$gt]=` returns rows the caller should never see.
 *
 * Express 4's default parser (`qs`) does build nested objects, so this was one
 * configuration line away from being exploitable. app.js switches to the simple
 * parser, and this middleware makes the guarantee independent of that choice —
 * a future upgrade that changes the default cannot silently reintroduce the
 * hole, and neither can a handler that forgets to validate.
 *
 * Arrays (`?a=1&a=2`) are collapsed to their LAST value rather than rejected:
 * duplicate parameters are a normal accident of link-building, no endpoint here
 * wants a list, and "last one wins" is what every framework does with them.
 *
 * This is defence in depth, not the primary control — routes still validate
 * with zod. It exists because the primary control is applied per route and this
 * one cannot be forgotten.
 */
export function hardenQuery(req, _res, next) {
  const q = req.query;
  if (!q || typeof q !== 'object') return next();

  for (const key of Object.keys(q)) {
    const value = q[key];

    if (typeof value === 'string') continue;

    if (Array.isArray(value)) {
      // Take the last scalar; drop anything structured inside it.
      const last = value[value.length - 1];
      q[key] = typeof last === 'string' ? last : '';
      continue;
    }

    /* An object or anything else here can only have come from a nested query
       syntax, which no endpoint in this API accepts. Replace it with an empty
       string so the handler treats it as absent rather than as an operator. */
    q[key] = '';
  }

  return next();
}
