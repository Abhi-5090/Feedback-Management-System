/**
 * Wrap an async Express handler so any thrown error / rejected promise is
 * forwarded to the central error middleware instead of crashing the process.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
