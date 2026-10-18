/** Operational error with a stable machine-readable code and a safe message. */
export class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra; // merged into the error body (e.g. { current: item })
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const unauthenticated = (code = 'UNAUTHENTICATED', message = 'Authentication required') =>
  new AppError(401, code, message);
export const validation = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, { details });
