import { beforeEach, describe, expect, it } from 'vitest';
import { as, createFixtures, dbEvents, dbItem, insertItem, makeUser } from './helpers.js';

let f;
beforeEach(async () => { f = await createFixtures(); });
const claim = (user, id) => as(user).post(`/api/v1/items/${id}/claim`);

describe('atomic claim', () => {
  it('two simultaneous claims: exactly one succeeds, the other gets 409', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    const results = await Promise.all([claim(f.memberA, id), claim(f.member2A, id)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.error.code).toBe('ALREADY_CLAIMED');
    expect(loser.body.error.current.assigneeId).toBe(winner.body.data.assigneeId); // latest state returned

    const row = await dbItem(id);
    expect(row.assignee_id).toBe(winner.body.data.assigneeId);
    expect(row.version).toBe(2);
    const events = await dbEvents(id, 'assignee_changed');
    expect(events).toHaveLength(1); // no event for the loser
    expect(events[0].actor_id).toBe(row.assignee_id);
  });

  it('with many contenders, still exactly one winner', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    const crowd = await Promise.all(Array.from({ length: 8 }, (_, i) => makeUser(`Contender ${i}`, [[f.teamA, 'member']])));
    const results = await Promise.all(crowd.map((u) => claim(u, id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    const row = await dbItem(id);
    expect((await dbEvents(id, 'assignee_changed'))).toHaveLength(1);
    expect(row.version).toBe(2);
    expect(crowd.map((u) => u.id)).toContain(row.assignee_id);
  });

  it('claiming an already-assigned item is a 409 and changes nothing', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, assigneeId: f.memberA.id });
    const r = await claim(f.member2A, id);
    expect(r.status).toBe(409);
    expect((await dbItem(id)).assignee_id).toBe(f.memberA.id);
    expect(await dbEvents(id)).toHaveLength(0);
  });

  it('refuses to claim resolved/closed items', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id, status: 'resolved' });
    const r = await claim(f.memberA, id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NOT_CLAIMABLE');
  });

  it('Viewer and Admin roles cannot claim; item stays unassigned', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    expect((await claim(f.viewerA, id)).status).toBe(403);
    expect((await claim(f.adminA, id)).status).toBe(403);
    expect((await dbItem(id)).assignee_id).toBeNull();
  });
});
