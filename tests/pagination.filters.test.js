import { beforeAll, describe, expect, it } from 'vitest';
import { as, createFixtures, insertItem, pool } from './helpers.js';

let f;
beforeAll(async () => {
  f = await createFixtures();
  // 60 team-A items; g/3 gives many identical updated_at values to exercise the id tie-breaker.
  await pool.query(
    `INSERT INTO work_items (title, type, priority, status, team_id, assignee_id, created_by, updated_at)
     SELECT 'Bulk item ' || g,
            (ARRAY['incident','customer_issue','payment','compliance','task'])[1 + g % 5],
            (ARRAY['low','medium','high','urgent'])[1 + g % 4],
            (ARRAY['open','in_progress','awaiting_approval','resolved','closed'])[1 + g % 5],
            $1, CASE WHEN g % 3 = 0 THEN $2::int ELSE NULL END, $3, now() - ((g / 3)::text || ' minutes')::interval
       FROM generate_series(1, 60) g`,
    [f.teamA, f.memberA.id, f.leadA.id],
  );
  await insertItem({ teamId: f.teamB, createdBy: f.leadB.id, title: 'Other team item', priority: 'urgent' });
});

const list = (user, qs = '') => as(user).get(`/api/v1/items${qs}`);

describe('server-side pagination', () => {
  it('walks all pages with no duplicates, no gaps and a stable descending order', async () => {
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const r = await list(f.memberA, `?limit=25${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      expect(r.body.data.length).toBeLessThanOrEqual(25);
      seen.push(...r.body.data);
      cursor = r.body.page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(60); // team B's item never appears
    expect(new Set(seen.map((i) => i.id)).size).toBe(60);
    for (let i = 1; i < seen.length; i++) {
      const [a, b] = [seen[i - 1], seen[i]];
      const ta = new Date(a.updatedAt).getTime(), tb = new Date(b.updatedAt).getTime();
      expect(ta > tb || (ta === tb && a.id > b.id)).toBe(true);
    }
  });

  it('returns only one page at a time (not the whole dataset)', async () => {
    const r = await list(f.memberA, '?limit=5');
    expect(r.body.data).toHaveLength(5);
    expect(r.body.page).toMatchObject({ limit: 5, hasMore: true });
    expect(r.body.page.nextCursor).toBeTruthy();
  });

  it('the last page has hasMore=false and no cursor', async () => {
    const r = await list(f.memberA, '?limit=100');
    expect(r.body.data).toHaveLength(60);
    expect(r.body.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('validates limits and cursors', async () => {
    for (const qs of ['?limit=0', '?limit=101', '?limit=abc', '?limit=-5']) {
      expect((await list(f.memberA, qs)).status).toBe(400);
    }
    for (const bad of ['garbage', Buffer.from('{"t":"x","i":1}').toString('base64url'), Buffer.from('{"t":"2026-01-01 00:00:00+00","i":"1; DROP TABLE users"}').toString('base64url')]) {
      const r = await list(f.memberA, `?cursor=${bad}`);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_CURSOR');
    }
  });
});

describe('server-side filtering and search', () => {
  const dbCount = async (where, params = []) =>
    (await pool.query(`SELECT count(*)::int n FROM work_items WHERE team_id = ${f.teamA} AND ${where}`, params)).rows[0].n;

  it('filters by status and priority (comma lists) in SQL', async () => {
    const r = await list(f.memberA, '?status=open,in_progress&priority=urgent,high&limit=100');
    expect(r.body.data.every((i) => ['open', 'in_progress'].includes(i.status) && ['urgent', 'high'].includes(i.priority))).toBe(true);
    expect(r.body.data).toHaveLength(await dbCount(`status IN ('open','in_progress') AND priority IN ('urgent','high')`));
  });

  it('filters by type and by assignee (me / unassigned / id)', async () => {
    const t = await list(f.memberA, '?type=payment&limit=100');
    expect(t.body.data.length).toBe(await dbCount(`type = 'payment'`));
    const me = await list(f.memberA, '?assignee=me&limit=100');
    expect(me.body.data.every((i) => i.assigneeId === f.memberA.id)).toBe(true);
    expect(me.body.data).toHaveLength(20);
    const un = await list(f.memberA, '?assignee=unassigned&limit=100');
    expect(un.body.data).toHaveLength(40);
    const byId = await list(f.memberA, `?assignee=${f.memberA.id}&limit=100`);
    expect(byId.body.data).toHaveLength(20);
  });

  it('searches titles and refs; wildcard characters in the query are literal', async () => {
    const r = await list(f.memberA, '?q=Bulk%20item%207&limit=100');
    expect(r.body.data.length).toBe(await dbCount(`title ILIKE '%Bulk item 7%'`)); // 7, 70.. -> only "Bulk item 7"
    expect(r.body.data.every((i) => /Bulk item 7/i.test(i.title))).toBe(true);
    expect((await list(f.memberA, '?q=%25')).body.data).toHaveLength(0); // "%" must not match everything
    expect((await list(f.memberA, '?q=_')).body.data).toHaveLength(0);
    const ref = (await list(f.memberA, '?limit=1')).body.data[0].ref;
    expect((await list(f.memberA, `?q=${ref}`)).body.data.map((i) => i.ref)).toContain(ref);
  });

  it('is safe against SQL injection in filters', async () => {
    const r = await list(f.memberA, `?q=${encodeURIComponent("'; DROP TABLE work_items; --")}`);
    expect(r.status).toBe(200);
    expect((await pool.query('SELECT count(*)::int n FROM work_items')).rows[0].n).toBe(61);
    expect((await list(f.memberA, '?status=open;DROP')).status).toBe(400);
  });

  it('rejects invalid enum values', async () => {
    expect((await list(f.memberA, '?status=bogus')).status).toBe(400);
    expect((await list(f.memberA, '?assignee=abc')).status).toBe(400);
  });

  it('Unassigned-urgent view contains only urgent, unassigned, still-active items in my teams', async () => {
    const r = await list(f.memberA, '?view=unassigned_urgent&limit=100');
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((i) => i.priority === 'urgent' && i.assigneeId === null && !['resolved', 'closed'].includes(i.status) && i.teamId === f.teamA)).toBe(true);
  });

  it('Awaiting-my-approval view shows items only to Leads of that team', async () => {
    const lead = await list(f.leadA, '?view=awaiting_my_approval&limit=100');
    expect(lead.body.data.length).toBe(await dbCount(`status = 'awaiting_approval'`));
    expect(lead.body.data.every((i) => i.status === 'awaiting_approval')).toBe(true);
    expect((await list(f.memberA, '?view=awaiting_my_approval')).body.data).toHaveLength(0);
    expect((await list(f.adminA, '?view=awaiting_my_approval')).body.data).toHaveLength(0);
    expect((await list(f.leadB, '?view=awaiting_my_approval')).body.data).toHaveLength(0);
  });

  it('Assigned-to-me view excludes resolved and closed items', async () => {
    const r = await list(f.memberA, '?view=assigned_to_me&limit=100');
    expect(r.body.data.every((i) => i.assigneeId === f.memberA.id && !['resolved', 'closed'].includes(i.status))).toBe(true);
  });
});

describe('dashboard endpoint', () => {
  it('returns real counts that match the database and respect team scope', async () => {
    const r = await as(f.leadA).get('/api/v1/dashboard');
    expect(r.status).toBe(200);
    const q = async (sql) => (await pool.query(sql, [f.teamA])).rows[0].n; // both queries below use only $1
    expect(r.body.data.awaiting_my_approval.count).toBe(await q(`SELECT count(*)::int n FROM work_items WHERE team_id=$1 AND status='awaiting_approval'`));
    expect(r.body.data.unassigned_urgent.count).toBe(await q(`SELECT count(*)::int n FROM work_items WHERE team_id=$1 AND priority='urgent' AND assignee_id IS NULL AND status NOT IN ('resolved','closed')`));
    expect(r.body.data.assigned_to_me.count).toBe(0);
    expect(r.body.data.unassigned_urgent.items.length).toBeLessThanOrEqual(5);
    const b = await as(f.leadB).get('/api/v1/dashboard');
    expect(b.body.data.unassigned_urgent.count).toBe(1); // only Team B's own urgent item
  });
});
