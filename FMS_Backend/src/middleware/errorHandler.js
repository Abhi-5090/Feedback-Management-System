import { isProd } from '../config/env.js';

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

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  const body = { error: message };
  if (code) body.code = code;
  if (details) body.details = details;
  if (!isProd && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
};
