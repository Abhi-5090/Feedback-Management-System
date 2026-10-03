import { isProd } from '../config/env.js';
import { log } from '../config/logger.js';
import { captureException } from '../config/sentry.js';

/** 404 for any unmatched route. */
export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
};

/**
 * Central error handler. Normalises ApiError, Mongoose validation/cast errors,
 * and duplicate-key (E11000) errors into a consistent JSON shape.
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  let status = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code;
  let details = err.details;

  // Mongo duplicate key (e.g. the DeviceLock unique index firing).
  if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'Duplicate entry';
  } else if (err.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    message = 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  }

  /* A 500 is a defect; a 4xx is a user or client mistake. Logging them at the
     same level means the signal that something is broken is buried under
     hundreds of expected validation rejections. */
  if (status >= 500) {
    log().error(
      { err: { message: err.message, name: err.name, stack: err.stack }, status, code, path: req.originalUrl?.split('?')[0], method: req.method },
      'unhandled error'
    );
    captureException(err, { requestId: req.id, path: req.originalUrl?.split('?')[0], method: req.method });
  } else if (status >= 400) {
    log().debug({ status, code, path: req.originalUrl?.split('?')[0] }, 'request rejected');
  }

  /* The id goes in the BODY as well as the header for 5xx: a user reporting a
     failure can read it off the screen, and that one string finds every log
     line for exactly their request. */
  const body = { error: message };
  if (status >= 500 && req.id) body.requestId = req.id;
  if (code) body.code = code;
  if (details) body.details = details;
  if (!isProd && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
};
