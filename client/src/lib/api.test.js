import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, describeError, setToken } from './api.js';

afterEach(() => { vi.restoreAllMocks(); setToken(null); });

const respond = (status, body) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) });

describe('api client', () => {
  it('maps a network failure to NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/items')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('exposes the latest item on a stale-version conflict', async () => {
    respond(409, { error: { code: 'VERSION_CONFLICT', message: 'changed', current: { id: 1, version: 3 } } });
    const err = await api('/items/1', { method: 'PATCH', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.body.current.version).toBe(3);
    expect(describeError(err).kind).toBe('conflict');
    expect(describeError(err).message).toMatch(/latest version has been loaded/i);
  });

  it('sends the bearer token and the idempotency header', async () => {
    const spy = respond(201, { data: {} });
    setToken('abc');
    await api('/items', { method: 'POST', body: { a: 1 }, headers: { 'Idempotency-Key': 'k1' } });
    expect(spy.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer abc', 'Idempotency-Key': 'k1' });
  });

  it('classifies forbidden, not-found, unavailable and validation errors', () => {
    expect(describeError(new ApiError(403, 'FORBIDDEN', 'no')).kind).toBe('forbidden');
    expect(describeError(new ApiError(404, 'NOT_FOUND', 'x')).kind).toBe('notfound');
    expect(describeError(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x')).kind).toBe('unavailable');
    expect(describeError(new ApiError(400, 'VALIDATION_ERROR', 'x')).kind).toBe('validation');
  });
});
