import { beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, makeUser, pool } from './helpers.js';

let f;
beforeEach(async () => { f = await createFixtures(); });

const body = (over = {}) => ({ title: 'Idempotent item', type: 'incident', priority: 'high', teamId: f.teamA, ...over });
const create = (user, b, key) => as(user).post('/api/v1/items', b, key ? { 'Idempotency-Key': key } : {});
const count = async (title = 'Idempotent item') => (await pool.query('SELECT count(*)::int n FROM work_items WHERE title = $1', [title])).rows[0].n;

describe('idempotent creation', () => {
  it('the same key twice creates ONE item and replays the original response', async () => {
    const first = await create(f.memberA, body(), 'key-aaaaaaaa-1');
    const second = await create(f.memberA, body(), 'key-aaaaaaaa-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(await count()).toBe(1);
    expect(await dbEvents(first.body.data.id, 'created')).toHaveLength(1);
  });

  it('simultaneous duplicates (double-click) still create exactly one item', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => create(f.memberA, body(), 'key-concurrent-1')));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await count()).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM idempotency_keys')).rows[0].n).toBe(1);
  });

  it('rejects reuse of a key with a different payload (422) and creates nothing new', async () => {
    await create(f.memberA, body(), 'key-reuse-0001');
    const r = await create(f.memberA, body({ title: 'A different item' }), 'key-reuse-0001');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count('A different item')).toBe(0);
    expect(await count()).toBe(1);
  });

  it('scopes keys per user: the same key from two users makes two items', async () => {
    const other = await makeUser('Other member', [[f.teamA, 'member']]);
    await create(f.memberA, body(), 'key-shared-0001');
    await create(other, body(), 'key-shared-0001');
    expect(await count()).toBe(2);
  });

  it('without a key, two identical requests create two items (opt-in protection)', async () => {
    await create(f.memberA, body());
    await create(f.memberA, body());
    expect(await count()).toBe(2);
  });

  it('a FAILED first attempt stores no key, so a corrected retry with the same key works', async () => {
    const bad = await create(f.leadA, body({ assigneeId: f.memberB.id }), 'key-retry-0001'); // invalid assignee
    expect(bad.status).toBe(422);
    expect((await pool.query('SELECT count(*)::int n FROM idempotency_keys')).rows[0].n).toBe(0);
    const ok = await create(f.leadA, body(), 'key-retry-0001');
    expect(ok.status).toBe(201);
    expect(await count()).toBe(1);
  });

  it('rejects a malformed Idempotency-Key header', async () => {
    const r = await create(f.memberA, body(), 'short');
    expect(r.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('assigns unique, sequential human-readable refs', async () => {
    const a = await create(f.memberA, body({ title: 'First ref item' }));
    const b = await create(f.memberA, body({ title: 'Second ref item' }));
    expect(a.body.data.ref).toMatch(/^OPS-\d+$/);
    expect(b.body.data.ref).not.toBe(a.body.data.ref);
  });
});
