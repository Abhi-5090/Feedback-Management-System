/**
 * ApiError — a typed error carrying an HTTP status code and optional machine
 * `code`, so controllers can `throw new ApiError(400, '...')` and the central
 * error handler renders a consistent JSON body.
 */
export class ApiError extends Error {
  constructor(statusCode, message, code = undefined, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isApiError = true;
  }
}

// Every helper takes an optional machine `code`. They previously didn't, which
// silently dropped the code on 401/403/404 — the client then couldn't tell
// "you must change your password" apart from an ordinary permission denial,
// because both arrived as a bare 403.
export const badRequest = (msg, code, details) => new ApiError(400, msg, code, details);
export const unauthorized = (msg = 'Unauthorized', code) => new ApiError(401, msg, code);
export const forbidden = (msg = 'Forbidden', code) => new ApiError(403, msg, code);
export const notFound = (msg = 'Not found', code) => new ApiError(404, msg, code);
export const conflict = (msg, code) => new ApiError(409, msg, code);