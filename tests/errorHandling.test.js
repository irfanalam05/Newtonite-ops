import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from './helpers.js';
import { errorHandler } from '../server/src/middleware/error.js';

const appThatThrows = (err) => {
  const a = express();
  a.get('/x', () => { throw err; });
  a.use(errorHandler);
  return a;
};

describe('error handling', () => {
  it('maps database-unavailable errors to 503 SERVICE_UNAVAILABLE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['ECONNREFUSED', '57P01', 'ETIMEDOUT']) {
      const r = await request(appThatThrows(Object.assign(new Error('connect failed 10.0.0.5:5432'), { code }))).get('/x');
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.5|5432/); // no internals
    }
  });

  it('returns a generic 500 without leaking the underlying message or stack', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await request(appThatThrows(new Error('relation "secret_table" does not exist'))).get('/x');
    expect(r.status).toBe(500);
    expect(r.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  it('rejects malformed JSON bodies with 400 INVALID_JSON through the real app', async () => {
    const r = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });
});
