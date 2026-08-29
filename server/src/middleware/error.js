'use strict';

class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const notFound = (req, res) => res.status(404).json({ error: `No route matches ${req.method} ${req.path}` });

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.name === 'ZodError') {
    return res.status(422).json({
      error: 'Some fields need attention.',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err && typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
    const field = err.message.split(':').pop().trim();
    return res.status(409).json({ error: `That record already exists (${field}).` });
  }
  if (err && typeof err.message === 'string' && err.message.includes('FOREIGN KEY constraint failed')) {
    return res.status(409).json({ error: 'That change would break a link to another record.' });
  }
  if (err && typeof err.message === 'string' && err.message.includes('CHECK constraint failed')) {
    return res.status(422).json({ error: `A value is outside the allowed set (${err.message.split(':').pop().trim()}).` });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Something went wrong on the server.' });
}

/** Wrap an async route so rejected promises reach the error handler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, errorHandler, notFound, asyncHandler };
