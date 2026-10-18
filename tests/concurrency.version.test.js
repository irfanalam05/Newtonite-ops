import { beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, dbItem, insertItem } from './helpers.js';

let f, id;
beforeEach(async () => {
  f = await createFixtures();
  id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, title: 'Original title' });
});
const patch = (user, body) => as(user).patch(`/api/v1/items/${id}`, body);

describe('optimistic locking (stale-update protection)', () => {
  it('a current-version update succeeds, bumps the version and logs an event', async () => {
    const r = await patch(f.leadA, { expectedVersion: 1, title: 'Updated title' });
    expect(r.status).toBe(200);
    expect(r.body.data.version).toBe(2);
    expect(await dbEvents(id, 'item_edited')).toHaveLength(1);
  });

  it('rejects a stale version with 409, returns the latest item, and does NOT overwrite newer data', async () => {
    // Both users loaded version 1.
    const first = await patch(f.leadA, { expectedVersion: 1, title: 'Lead A wins', priority: 'high' });
    expect(first.status).toBe(200);
    const eventsBefore = (await dbEvents(id)).length;

    const stale = await patch(f.adminA, { expectedVersion: 1, title: 'Stale overwrite' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.current.title).toBe('Lead A wins');
    expect(stale.body.error.current.version).toBe(2);

    const row = await dbItem(id);
    expect(row.title).toBe('Lead A wins');
    expect(row.priority).toBe('high');
    expect(row.version).toBe(2);
    expect(await dbEvents(id)).toHaveLength(eventsBefore); // no success event for the rejected update
  });

  it('two simultaneous updates from the same version: exactly one wins', async () => {
    const [a, b] = await Promise.all([
      patch(f.leadA, { expectedVersion: 1, title: 'Title from A' }),
      patch(f.adminA, { expectedVersion: 1, title: 'Title from B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await dbItem(id);
    expect(row.version).toBe(2);
    expect(row.title).toBe(a.status === 200 ? 'Title from A' : 'Title from B');
    expect(await dbEvents(id, 'item_edited')).toHaveLength(1);
  });

  it('a no-op update does not bump the version', async () => {
    const r = await patch(f.leadA, { expectedVersion: 1, title: 'Original title' });
    expect(r.status).toBe(200);
    expect(r.body.data.version).toBe(1);
    expect(await dbEvents(id)).toHaveLength(0);
  });

  it('requires expectedVersion and rejects unknown fields', async () => {
    expect((await patch(f.leadA, { title: 'No version' })).status).toBe(400);
    expect((await patch(f.leadA, { expectedVersion: 1 })).status).toBe(400);
  });

  it('records priority and assignee changes as separate events with previous/new values', async () => {
    const r = await patch(f.leadA, { expectedVersion: 1, priority: 'urgent', assigneeId: f.memberA.id });
    expect(r.status).toBe(200);
    const [p] = await dbEvents(id, 'priority_changed');
    expect([p.previous_value, p.new_value]).toEqual(['medium', 'urgent']);
    const [a] = await dbEvents(id, 'assignee_changed');
    expect(a.previous_value).toBeNull();
    expect(a.new_value.id).toBe(f.memberA.id);
  });
});
