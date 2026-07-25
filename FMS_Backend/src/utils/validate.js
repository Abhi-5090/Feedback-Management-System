import { ApiError } from './ApiError.js';

/**
 * Build an Express middleware that validates a request section against a zod
 * schema and replaces it with the parsed (typed, defaulted) result.
 *
 *   router.post('/', validate(schema, 'body'), handler)
 */
export const validate = (schema, where = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[where]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return next(new ApiError(400, 'Validation failed', 'VALIDATION_ERROR', details));
  }
  req[where] = result.data;
  return next();
};
