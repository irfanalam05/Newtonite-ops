import { beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, dbItem, insertItem, makeUser } from './helpers.js';

let f, itemA, itemB;
beforeEach(async () => {
  f = await createFixtures();
  itemA = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, title: 'Team A item' });
  itemB = await insertItem({ teamId: f.teamB, createdBy: f.leadB.id, title: 'Team B item' });
});

describe('resource-level authorization — team isolation', () => {
  it('hides another team\'s item on READ (404, not 403) including activity', async () => {
    const r = await as(f.memberA).get(`/api/v1/items/${itemB}`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect((await as(f.memberA).get(`/api/v1/items/${itemB}/activity`)).status).toBe(404);
  });

  it('denies every WRITE on another team\'s item and leaves it untouched', async () => {
    const before = await dbItem(itemB);
    const u = as(f.leadA); // even a Lead — of the wrong team
    expect((await u.patch(`/api/v1/items/${itemB}`, { expectedVersion: 1, title: 'hijacked' })).status).toBe(404);
    expect((await u.post(`/api/v1/items/${itemB}/claim`)).status).toBe(404);
    expect((await u.post(`/api/v1/items/${itemB}/transition`, { to: 'in_progress' })).status).toBe(404);
    expect((await u.post(`/api/v1/items/${itemB}/comments`, { body: 'hi' })).status).toBe(404);
    const after = await dbItem(itemB);
    expect(after).toEqual(before);
    expect(await dbEvents(itemB)).toHaveLength(0);
  });

  it('never lists another team\'s items, even when filtering by that team', async () => {
    const all = await as(f.memberA).get('/api/v1/items');
    expect(all.body.data.map((i) => i.id)).toEqual([itemA]);
    const filtered = await as(f.memberA).get(`/api/v1/items?teamId=${f.teamB}`);
    expect(filtered.body.data).toHaveLength(0);
  });

  it('forbids creating an item in a team the user does not belong to', async () => {
    const r = await as(f.memberA).post('/api/v1/items', { title: 'Sneaky item', type: 'task', teamId: f.teamB });
    expect(r.status).toBe(403);
  });

  it('only reveals own teams and teammates', async () => {
    const teams = await as(f.memberA).get('/api/v1/teams');
    expect(teams.body.data.map((t) => t.id)).toEqual([f.teamA]);
    const users = await as(f.memberA).get('/api/v1/users');
    const ids = users.body.data.map((u) => u.id);
    expect(ids).toContain(f.leadA.id);
    expect(ids).not.toContain(f.leadB.id);
  });

  it('works for a user in two teams (different role in each)', async () => {
    const both = await makeUser('Both', [[f.teamA, 'viewer'], [f.teamB, 'lead']]);
    expect((await as(both).get(`/api/v1/items/${itemA}`)).status).toBe(200);
    expect((await as(both).post(`/api/v1/items/${itemA}/comments`, { body: 'x' })).status).toBe(403); // viewer in A
    expect((await as(both).post(`/api/v1/items/${itemB}/comments`, { body: 'x' })).status).toBe(201); // lead in B
  });
});

describe('role restrictions', () => {
  it('lets a Viewer read but not create, edit, claim, comment or transition', async () => {
    const v = as(f.viewerA);
    expect((await v.get(`/api/v1/items/${itemA}`)).status).toBe(200);
    expect((await v.post('/api/v1/items', { title: 'Nope nope', type: 'task', teamId: f.teamA })).status).toBe(403);
    expect((await v.patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, title: 'Edited' })).status).toBe(403);
    expect((await v.post(`/api/v1/items/${itemA}/claim`)).status).toBe(403);
    expect((await v.post(`/api/v1/items/${itemA}/comments`, { body: 'x' })).status).toBe(403);
    expect((await v.post(`/api/v1/items/${itemA}/transition`, { to: 'in_progress' })).status).toBe(403);
    expect((await dbItem(itemA)).version).toBe(1);
  });

  it('does not let an Admin approve (approval is Lead-only)', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'awaiting_approval', assigneeId: f.memberA.id });
    const r = await as(f.adminA).post(`/api/v1/items/${id}/transition`, { to: 'resolved' });
    expect(r.status).toBe(403);
    expect((await dbItem(id)).status).toBe('awaiting_approval');
  });

  it('only a Lead or Admin may change priority', async () => {
    expect((await as(f.memberA).patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, priority: 'urgent' })).status).toBe(403);
    expect((await dbItem(itemA)).priority).toBe('medium');
    const ok = await as(f.leadA).patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, priority: 'urgent' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.priority).toBe('urgent');
  });

  it('lets a Member edit only items they created or are assigned to', async () => {
    const mine = await as(f.memberA).post('/api/v1/items', { title: 'My own item', type: 'task', teamId: f.teamA });
    expect((await as(f.memberA).patch(`/api/v1/items/${mine.body.data.id}`, { expectedVersion: 1, title: 'My edited item' })).status).toBe(200);
    expect((await as(f.member2A).patch(`/api/v1/items/${mine.body.data.id}`, { expectedVersion: 2, title: 'Not yours at all' })).status).toBe(403);
  });
});

describe('assignment validation', () => {
  it('rejects assigning to a user outside the team, a viewer, or an unknown id', async () => {
    const lead = as(f.leadA);
    for (const bad of [f.memberB.id, f.viewerA.id, 999999]) {
      const r = await lead.patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, assigneeId: bad });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_ASSIGNEE');
    }
    expect((await dbItem(itemA)).assignee_id).toBeNull();
  });

  it('lets a Lead assign to a team Member but not a plain Member', async () => {
    expect((await as(f.memberA).patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, assigneeId: f.member2A.id })).status).toBe(403);
    const r = await as(f.leadA).patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, assigneeId: f.member2A.id });
    expect(r.status).toBe(200);
    expect(r.body.data.assigneeId).toBe(f.member2A.id);
  });

  it('rejects an invalid assignee at creation', async () => {
    const r = await as(f.leadA).post('/api/v1/items', { title: 'Bad assignee', type: 'task', teamId: f.teamA, assigneeId: f.memberB.id });
    expect(r.status).toBe(422);
  });
});

describe('mass assignment / privilege escalation', () => {
  it('rejects client-supplied status, createdBy, version, role fields on create and update', async () => {
    const c = await as(f.memberA).post('/api/v1/items', { title: 'Escalation', type: 'task', teamId: f.teamA, status: 'closed', createdBy: f.leadA.id });
    expect(c.status).toBe(400);
    const u = await as(f.leadA).patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, status: 'closed' });
    expect(u.status).toBe(400);
    const u2 = await as(f.leadA).patch(`/api/v1/items/${itemA}`, { expectedVersion: 1, version: 99, teamId: f.teamB });
    expect(u2.status).toBe(400);
  });

  it('records the authenticated user as creator regardless of the body', async () => {
    const r = await as(f.memberA).post('/api/v1/items', { title: 'Who made me', type: 'task', teamId: f.teamA });
    expect(r.body.data.createdBy).toBe(f.memberA.id);
  });
});

describe('validation and error format', () => {
  it('returns a consistent VALIDATION_ERROR body', async () => {
    const r = await as(f.memberA).post('/api/v1/items', { title: 'x', type: 'bogus', teamId: f.teamA });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.length).toBeGreaterThan(0);
  });
  it('returns 404 for malformed ids and unknown routes without leaking internals', async () => {
    expect((await as(f.memberA).get('/api/v1/items/abc')).status).toBe(404);
    expect((await as(f.memberA).get('/api/v1/nope')).body.error.code).toBe('NOT_FOUND');
  });
});
