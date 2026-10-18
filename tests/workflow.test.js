import { beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, dbItem, insertItem } from './helpers.js';

let f;
beforeEach(async () => { f = await createFixtures(); });
const go = (user, id, to, extra = {}) => as(user).post(`/api/v1/items/${id}/transition`, { to, ...extra });

describe('workflow engine', () => {
  it('walks the full happy path and records one event per step with actor/prev/new', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, assigneeId: f.memberA.id });
    expect((await go(f.memberA, id, 'in_progress')).body.data.status).toBe('in_progress'); // assignee starts
    expect((await go(f.memberA, id, 'awaiting_approval')).status).toBe(200); // assignee submits
    expect((await go(f.leadA, id, 'resolved')).status).toBe(200); // Lead approves
    const closed = await go(f.leadA, id, 'closed');
    expect(closed.status).toBe(200);
    expect(closed.body.data.version).toBe(5);

    const events = await dbEvents(id, 'status_changed');
    expect(events.map((e) => [e.previous_value, e.new_value, e.actor_id])).toEqual([
      ['open', 'in_progress', f.memberA.id],
      ['in_progress', 'awaiting_approval', f.memberA.id],
      ['awaiting_approval', 'resolved', f.leadA.id],
      ['resolved', 'closed', f.leadA.id],
    ]);
    expect(events[2].metadata.action).toBe('approve');
  });

  it('rejects invalid jumps (Open -> Closed / Resolved / Awaiting) with 422 and changes nothing', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    for (const to of ['closed', 'resolved', 'awaiting_approval', 'open']) {
      const r = await go(f.leadA, id, to);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_TRANSITION');
    }
    const row = await dbItem(id);
    expect(row.status).toBe('open');
    expect(row.version).toBe(1);
    expect(await dbEvents(id)).toHaveLength(0);
  });

  it('forbids a non-Lead (Member) from approving, allows the team Lead', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'awaiting_approval', assigneeId: f.memberA.id });
    const denied = await go(f.memberA, id, 'resolved'); // even the assignee
    expect(denied.status).toBe(403);
    expect((await dbItem(id)).status).toBe('awaiting_approval');
    expect(await dbEvents(id, 'status_changed')).toHaveLength(0);
    expect((await go(f.leadA, id, 'resolved')).status).toBe(200);
  });

  it('forbids a Lead of ANOTHER team from approving (404, team isolation)', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'awaiting_approval' });
    expect((await go(f.leadB, id, 'resolved')).status).toBe(404);
  });

  it('lets a Lead reject back to In Progress', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'awaiting_approval' });
    const r = await go(f.leadA, id, 'in_progress');
    expect(r.status).toBe(200);
    expect((await dbEvents(id, 'status_changed'))[0].metadata.action).toBe('reject');
  });

  it('only the assignee or a Lead may start work; other Members may not', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, assigneeId: f.memberA.id });
    expect((await go(f.member2A, id, 'in_progress')).status).toBe(403);
    expect((await go(f.adminA, id, 'in_progress')).status).toBe(403);
    expect((await go(f.leadA, id, 'in_progress')).status).toBe(200);
  });

  it('Closed is terminal and immutable', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'closed' });
    expect((await go(f.leadA, id, 'open')).status).toBe(422);
    const r = await as(f.leadA).patch(`/api/v1/items/${id}`, { expectedVersion: 1, title: 'Edit closed' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('ITEM_CLOSED');
  });

  it('rejects a transition carrying a stale expectedVersion', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    await go(f.leadA, id, 'in_progress'); // version -> 2
    const r = await go(f.leadA, id, 'awaiting_approval', { expectedVersion: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('serialises two simultaneous transitions: exactly one wins', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'awaiting_approval' });
    const [a, b] = await Promise.all([go(f.leadA, id, 'resolved'), go(f.leadA, id, 'in_progress')]);
    expect([a.status, b.status].sort()).toEqual([200, 422]); // the loser now sees an invalid transition
    expect(await dbEvents(id, 'status_changed')).toHaveLength(1);
    expect((await dbItem(id)).version).toBe(2);
  });
});
