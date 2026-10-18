import { beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, insertItem, pool } from './helpers.js';
import { enqueueJob } from '../server/src/services/outbox.js';
import { processBatch } from '../server/src/workers/outbox.js';
import { defaultHandlers } from '../server/src/workers/handlers.js';

let f, itemId;
beforeEach(async () => {
  f = await createFixtures();
  itemId = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, title: 'Outbox target' }); // notifications.work_item_id is a FK
});

const addJob = (n, extra = {}) =>
  enqueueJob(pool, { type: 'notify_assignee', dedupeKey: `test-job-${n}`, payload: { workItemId: itemId, ref: 'OPS-1', title: 'T', assigneeId: f.memberA.id }, ...extra });
const job = async (n) => (await pool.query('SELECT * FROM jobs WHERE dedupe_key = $1', [`test-job-${n}`])).rows[0];
const fast = { backoffBaseSeconds: 0 };

describe('transactional outbox — enqueue', () => {
  it('assigning an item writes the job in the same transaction as the change', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    const r = await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, assigneeId: f.memberA.id });
    expect(r.status).toBe(200);
    const jobs = (await pool.query('SELECT * FROM jobs')).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'notify_assignee', status: 'pending', attempts: 0 });
    expect(jobs[0].payload.assigneeId).toBe(f.memberA.id);
    expect(jobs[0].dedupe_key).toBe(`notify_assignee:event:${(await dbEvents(id, 'assignee_changed'))[0].id}`);
  });

  it('no job when the change is rejected or rolled back', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 7, assigneeId: f.memberA.id }); // stale -> 409
    await as(f.memberA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, assigneeId: f.memberA.id }); // forbidden
    expect((await pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n).toBe(0);
  });

  it('self-claims do not notify; duplicate dedupe keys are ignored', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    await as(f.memberA).post(`/api/v1/items/${id}/claim`);
    expect((await pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n).toBe(0);
    await addJob(1);
    await addJob(1);
    expect((await pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n).toBe(1);
  });
});

describe('worker', () => {
  it('processes a persisted job end-to-end and the assignee can see the notification', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, assigneeId: f.memberA.id });
    const stats = await processBatch(defaultHandlers);
    expect(stats).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    const j = (await pool.query('SELECT * FROM jobs')).rows[0];
    expect(j).toMatchObject({ status: 'done', attempts: 1 });
    expect(j.processed_at).not.toBeNull();
    const n = await as(f.memberA).get('/api/v1/notifications');
    expect(n.body.data).toHaveLength(1);
    expect(n.body.data[0].message).toMatch(/You were assigned/);
  });

  it('retries a transient failure with exponential backoff, then succeeds', async () => {
    await addJob(1);
    let calls = 0;
    const flaky = { notify_assignee: async (p, ctx) => { if (++calls === 1) throw new Error('smtp down'); return defaultHandlers.notify_assignee(p, ctx); } };

    const s1 = await processBatch(flaky, { backoffBaseSeconds: 60 });
    expect(s1).toMatchObject({ claimed: 1, retried: 1, done: 0 });
    let j = await job(1);
    expect(j).toMatchObject({ status: 'pending', attempts: 1, last_error: 'smtp down' });
    expect(new Date(j.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000); // backoff applied

    expect((await processBatch(flaky, { backoffBaseSeconds: 60 })).claimed).toBe(0); // not due yet

    await pool.query(`UPDATE jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [j.id]);
    const s2 = await processBatch(flaky, { backoffBaseSeconds: 60 });
    expect(s2).toMatchObject({ claimed: 1, done: 1 });
    j = await job(1);
    expect(j).toMatchObject({ status: 'done', attempts: 2, last_error: null });
  });

  it('bounds attempts: a permanently failing job ends as failed after max_attempts, never more', async () => {
    await addJob(1, { maxAttempts: 3 });
    let calls = 0;
    const broken = { notify_assignee: async () => { calls++; throw new Error('permanent failure'); } };
    for (let i = 0; i < 6; i++) await processBatch(broken, fast);
    expect(calls).toBe(3);
    const j = await job(1);
    expect(j).toMatchObject({ status: 'failed', attempts: 3, last_error: 'permanent failure' });
    expect((await processBatch(broken, fast)).claimed).toBe(0);
  });

  it('an unknown job type fails (and is eventually marked failed) instead of being silently dropped', async () => {
    await enqueueJob(pool, { type: 'mystery', dedupeKey: 'test-job-9', payload: {}, maxAttempts: 2 });
    await processBatch(defaultHandlers, fast);
    await processBatch(defaultHandlers, fast);
    expect(await job(9)).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('is idempotent: delivering the same job twice produces ONE notification', async () => {
    await addJob(1);
    await processBatch(defaultHandlers);
    await pool.query(`UPDATE jobs SET status = 'pending', next_attempt_at = now() WHERE dedupe_key = 'test-job-1'`); // simulate redelivery
    await processBatch(defaultHandlers);
    expect((await job(1)).attempts).toBe(2);
    expect((await pool.query('SELECT count(*)::int n FROM notifications')).rows[0].n).toBe(1);
  });

  it('two workers polling concurrently never process the same job twice', async () => {
    for (let i = 0; i < 20; i++) await addJob(i);
    const handled = new Map();
    const handlers = { notify_assignee: async (p, { job: j }) => { handled.set(j.id, (handled.get(j.id) ?? 0) + 1); await new Promise((r) => setTimeout(r, 5)); } };
    const [a, b] = await Promise.all([processBatch(handlers, { batchSize: 12 }), processBatch(handlers, { batchSize: 12 })]);
    expect(a.claimed + b.claimed).toBe(20);
    expect(handled.size).toBe(20);
    expect([...handled.values()].every((n) => n === 1)).toBe(true);
    expect((await pool.query(`SELECT count(*)::int n FROM jobs WHERE status = 'done'`)).rows[0].n).toBe(20);
  });

  it('recovers jobs abandoned by a crashed worker (stale lock) and respects the attempt cap', async () => {
    await addJob(1);
    await addJob(2);
    await pool.query(`UPDATE jobs SET status = 'processing', attempts = 1, locked_at = now() - interval '10 minutes' WHERE dedupe_key = 'test-job-1'`);
    await pool.query(`UPDATE jobs SET status = 'processing', attempts = max_attempts, locked_at = now() - interval '10 minutes' WHERE dedupe_key = 'test-job-2'`);
    await processBatch(defaultHandlers, { lockTimeoutSeconds: 60 });
    expect(await job(1)).toMatchObject({ status: 'done', attempts: 2 });
    expect(await job(2)).toMatchObject({ status: 'failed' });
  });

  it('does not steal a job another worker is actively processing (fresh lock)', async () => {
    await addJob(1);
    await pool.query(`UPDATE jobs SET status = 'processing', attempts = 1, locked_at = now() WHERE dedupe_key = 'test-job-1'`);
    expect((await processBatch(defaultHandlers, { lockTimeoutSeconds: 60 })).claimed).toBe(0);
  });

  it('readiness exposes outbox state for operators', async () => {
    await addJob(1);
    const r = await as(null).get('/api/v1/ready');
    expect(r.body.jobs.pending).toBe(1);
  });
});

