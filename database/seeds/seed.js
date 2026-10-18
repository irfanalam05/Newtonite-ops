// Deterministic seed: same data every run (fixed PRNG seed, fixed base date).
// Usage: npm run db:seed            (wipes data tables, then seeds)
//        npm run db:seed -- --if-empty   (no-op when users already exist)
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'node:url';
import { pool } from '../../server/src/db/pool.js';

export const DEMO_PASSWORD = 'Passw0rd!demo'; // local demonstration credential only

const TEAMS = [
  ['Platform Operations', 'Infrastructure, deployments and incident response'],
  ['Customer Support', 'Customer-facing issues and escalations'],
  ['Payments', 'Payment processing, refunds and reconciliation'],
  ['Compliance', 'Regulatory, audit and policy work'],
];
// [name, email, [[teamIndex, role], ...]]
const USERS = [
  ['Alex Admin', 'alex.admin@newtonite.test', [[0, 'admin'], [1, 'admin'], [2, 'admin'], [3, 'admin']]],
  ['Priya Lead', 'priya.lead@newtonite.test', [[0, 'lead'], [2, 'member']]],
  ['Omar Lead', 'omar.lead@newtonite.test', [[1, 'lead']]],
  ['Chen Lead', 'chen.lead@newtonite.test', [[2, 'lead']]],
  ['Nina Lead', 'nina.lead@newtonite.test', [[3, 'lead']]],
  ['Sam Member', 'sam.member@newtonite.test', [[0, 'member'], [1, 'member']]],
  ['Jo Member', 'jo.member@newtonite.test', [[1, 'member']]],
  ['Rita Member', 'rita.member@newtonite.test', [[2, 'member'], [3, 'member']]],
  ['Tom Member', 'tom.member@newtonite.test', [[0, 'member']]],
  ['Vera Viewer', 'vera.viewer@newtonite.test', [[0, 'viewer'], [2, 'viewer']]],
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOUNS = {
  incident: ['API latency spike', 'Database failover', 'Queue backlog', 'Deployment rollback', 'Cache outage', 'Login errors'],
  customer_issue: ['Account locked', 'Missing invoice', 'Export failing', 'Slow dashboard', 'Wrong plan billed', 'Cannot reset password'],
  payment: ['Refund pending', 'Chargeback review', 'Settlement mismatch', 'Failed payout', 'Duplicate charge', 'Currency rounding'],
  compliance: ['Audit evidence request', 'Policy attestation', 'Data retention review', 'KYC document expired', 'Access review', 'Vendor assessment'],
  task: ['Update runbook', 'Rotate credentials', 'Review dashboards', 'Onboard new hire', 'Clean up alerts', 'Plan capacity'],
};
const TYPES = Object.keys(NOUNS);

export async function seed({ items = 3000, log = console.log } = {}) {
  const rand = mulberry32(20261019);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (pairs) => {
    let r = rand() * pairs.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs[0][0];
  };
  const BASE = Date.parse('2026-10-01T00:00:00Z');
  const DAY = 86_400_000;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE notifications, jobs, idempotency_keys, comments, activity_events, work_items,
                        memberships, teams, users RESTART IDENTITY CASCADE`);
    await client.query(`ALTER SEQUENCE work_item_ref_seq RESTART WITH 1`);

    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const teamIds = [];
    for (const [name, desc] of TEAMS) {
      teamIds.push((await client.query('INSERT INTO teams(name, description) VALUES ($1,$2) RETURNING id', [name, desc])).rows[0].id);
    }
    const users = [];
    for (const [name, email, memberships] of USERS) {
      const id = (await client.query('INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING id', [name, email, hash])).rows[0].id;
      users.push({ id, name, roles: new Map(memberships.map(([t, role]) => [teamIds[t], role])) });
      for (const [t, role] of memberships) {
        await client.query('INSERT INTO memberships(user_id, team_id, role) VALUES ($1,$2,$3)', [id, teamIds[t], role]);
      }
    }
    const inTeam = (teamId, roles) => users.filter((u) => roles.includes(u.roles.get(teamId)));

    const itemRows = [];
    const eventRows = [];
    const commentRows = [];
    for (let i = 1; i <= items; i++) {
      const teamId = weighted([[teamIds[0], 35], [teamIds[1], 30], [teamIds[2], 25], [teamIds[3], 10]]);
      const type = weighted([['incident', 20], ['customer_issue', 30], ['payment', 20], ['compliance', 10], ['task', 20]]);
      const priority = weighted([['low', 25], ['medium', 40], ['high', 25], ['urgent', 10]]);
      const status = weighted([['open', 30], ['in_progress', 25], ['awaiting_approval', 10], ['resolved', 15], ['closed', 20]]);
      const creators = inTeam(teamId, ['member', 'lead', 'admin']);
      const workers = inTeam(teamId, ['member', 'lead']);
      const creator = pick(creators);
      // Non-open items always have an owner; open items are mostly unassigned (so claiming/urgent views have data).
      const assignee = status === 'open' ? (rand() < 0.25 ? pick(workers) : null) : pick(workers);
      const createdAt = BASE - Math.floor(rand() * 90 * DAY);
      const updatedAt = Math.min(BASE, createdAt + Math.floor(rand() * 20 * DAY));
      const dueAt = rand() < 0.6 ? BASE + Math.floor((rand() * 30 - 10) * DAY) : null;
      const title = `${pick(NOUNS[type])} #${i}`;
      itemRows.push([i, `OPS-${i}`, title, `Seeded ${type.replace('_', ' ')} for demo and pagination testing.`, type, priority, status, teamId, assignee?.id ?? null, creator.id, dueAt ? new Date(dueAt) : null, 1, new Date(createdAt), new Date(updatedAt)]);
      eventRows.push([i, creator.id, 'created', null, JSON.stringify({ title, type, priority, status: 'open' }), '{}', new Date(createdAt)]);
      if (status !== 'open') {
        const lead = inTeam(teamId, ['lead'])[0] ?? creator;
        eventRows.push([i, (assignee ?? lead).id, 'status_changed', '"open"', JSON.stringify(status), JSON.stringify({ action: 'seed' }), new Date(updatedAt)]);
      }
      if (i % 10 === 0) commentRows.push([i, pick(creators).id, 'Looking into this — will update shortly.', new Date(updatedAt)]);
    }

    const bulk = async (table, cols, rows, size = 500) => {
      for (let off = 0; off < rows.length; off += size) {
        const chunk = rows.slice(off, off + size);
        const params = chunk.flat();
        const values = chunk.map((_, r) => `(${cols.map((_c, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',');
        await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values}`, params);
      }
    };
    await bulk('work_items', ['id','ref','title','description','type','priority','status','team_id','assignee_id','created_by','due_at','version','created_at','updated_at'], itemRows);
    await client.query(`SELECT setval(pg_get_serial_sequence('work_items','id'), $1), setval('work_item_ref_seq', $1)`, [items]);
    const casts = (rows) => rows; // jsonb columns accept JSON text parameters
    await bulk('activity_events', ['work_item_id','actor_id','event_type','previous_value','new_value','metadata','created_at'], casts(eventRows));
    await bulk('comments', ['work_item_id','author_id','body','created_at'], commentRows);
    await client.query('COMMIT');
    log(`[seed] ${TEAMS.length} teams, ${USERS.length} users, ${items} items, ${eventRows.length} events, ${commentRows.length} comments`);
    log(`[seed] demo password for all users: ${DEMO_PASSWORD}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    if (process.argv.includes('--if-empty')) {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
      if (rows[0].n > 0) {
        console.log('[seed] users exist, skipping (--if-empty)');
        return;
      }
    }
    await seed();
  })()
    .then(() => pool.end())
    .catch((err) => {
      console.error('[seed] failed:', err.message);
      process.exit(1);
    });
}
