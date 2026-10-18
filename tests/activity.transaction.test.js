import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, dbItem, insertItem, pool } from './helpers.js';

let f, id;
beforeEach(async () => {
  f = await createFixtures();
  id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
});

describe('activity history', () => {
  it('records creation, priority change, comment — in chronological order, with names and comment text', async () => {
    const created = await as(f.memberA).post('/api/v1/items', { title: 'Timeline item', type: 'task', teamId: f.teamA });
    const iid = created.body.data.id;
    await as(f.leadA).patch(`/api/v1/items/${iid}`, { expectedVersion: 1, priority: 'high' });
    await as(f.memberA).post(`/api/v1/items/${iid}/comments`, { body: 'Working on it' });

    const r = await as(f.viewerA).get(`/api/v1/items/${iid}/activity`); // viewers may read history
    expect(r.status).toBe(200);
    expect(r.body.data.map((e) => e.eventType)).toEqual(['created', 'priority_changed', 'comment_added']);
    expect(r.body.data[0].actor.name).toBe('Member A');
    expect(r.body.data[1]).toMatchObject({ previousValue: 'medium', newValue: 'high' });
    expect(r.body.data[2].comment).toBe('Working on it');
    const times = r.body.data.map((e) => new Date(e.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('paginates the timeline with a cursor', async () => {
    for (let i = 0; i < 5; i++) await as(f.memberA).post(`/api/v1/items/${id}/comments`, { body: `c${i}` });
    const p1 = await as(f.memberA).get(`/api/v1/items/${id}/activity?limit=2`);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await as(f.memberA).get(`/api/v1/items/${id}/activity?limit=10&cursor=${p1.body.page.nextCursor}`);
    expect(p2.body.data).toHaveLength(3);
    expect(p2.body.data[0].comment).toBe('c2');
    expect((await as(f.memberA).get(`/api/v1/items/${id}/activity?cursor=abc`)).status).toBe(400);
  });

  it('the activity table is append-only at the database level', async () => {
    await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, priority: 'low' });
    await expect(pool.query('UPDATE activity_events SET event_type = $1', ['tampered'])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM activity_events')).rejects.toThrow(/append-only/);
  });

  it('does not write a success event for a rejected request', async () => {
    await as(f.leadA).post(`/api/v1/items/${id}/transition`, { to: 'closed' }); // invalid
    await as(f.viewerA).post(`/api/v1/items/${id}/comments`, { body: 'x' }); // forbidden
    expect(await dbEvents(id)).toHaveLength(0);
  });
});

describe('transactional consistency (item change + audit event commit together)', () => {
  const install = (eventType) =>
    pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated audit failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_audit_trg BEFORE INSERT ON activity_events
        FOR EACH ROW WHEN (NEW.event_type = '${eventType}') EXECUTE FUNCTION test_fail_audit();`);
  afterEach(() => pool.query('DROP TRIGGER IF EXISTS test_fail_audit_trg ON activity_events; DROP FUNCTION IF EXISTS test_fail_audit();'));

  it('if the audit insert fails, the PATCH is rolled back (no priority change, no version bump)', async () => {
    await install('priority_changed');
    const r = await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, priority: 'urgent' });
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(r.body)).not.toMatch(/simulated/); // internals not leaked
    const row = await dbItem(id);
    expect(row.priority).toBe('medium');
    expect(row.version).toBe(1);
    expect(await dbEvents(id)).toHaveLength(0);
  });

  it('if the audit insert fails, a claim is rolled back too (item stays unassigned)', async () => {
    await install('assignee_changed');
    const r = await as(f.memberA).post(`/api/v1/items/${id}/claim`);
    expect(r.status).toBe(500);
    expect((await dbItem(id)).assignee_id).toBeNull();
  });

  it('if the audit insert fails, a workflow transition is rolled back', async () => {
    await install('status_changed');
    const r = await as(f.leadA).post(`/api/v1/items/${id}/transition`, { to: 'in_progress' });
    expect(r.status).toBe(500);
    expect((await dbItem(id)).status).toBe('open');
  });

  it('if the audit insert fails on an assignment, the outbox job is NOT left behind (job and change commit together)', async () => {
    await install('assignee_changed');
    const r = await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, assigneeId: f.memberA.id });
    expect(r.status).toBe(500);
    expect((await dbItem(id)).assignee_id).toBeNull();
    expect((await dbItem(id)).version).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n).toBe(0);
  });

  it('if the audit insert fails during creation, no item, key or job is left behind', async () => {
    await install('created');
    const r = await as(f.leadA).post('/api/v1/items', { title: 'Ghost item', type: 'task', teamId: f.teamA, assigneeId: f.memberA.id }, { 'Idempotency-Key': 'key-ghost-0001' });
    expect(r.status).toBe(500);
    expect((await pool.query(`SELECT count(*)::int n FROM work_items WHERE title='Ghost item'`)).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int n FROM idempotency_keys')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n).toBe(0);
  });
});
