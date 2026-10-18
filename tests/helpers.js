import bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp } from '../server/src/app.js';
import { pool } from '../server/src/db/pool.js';
import { signToken } from '../server/src/modules/auth/auth.service.js';

export { pool };
export const app = createApp();
export const PASSWORD = 'Test1234!';
const HASH = bcrypt.hashSync(PASSWORD, 4);

export async function resetDb() {
  await pool.query(`TRUNCATE notifications, jobs, idempotency_keys, comments, activity_events, work_items,
                    memberships, teams, users RESTART IDENTITY CASCADE`);
  await pool.query('ALTER SEQUENCE work_item_ref_seq RESTART WITH 1');
}

export async function makeTeam(name) {
  return (await pool.query('INSERT INTO teams(name) VALUES ($1) RETURNING id', [name])).rows[0].id;
}

let n = 0;
export async function makeUser(name, memberships = []) {
  const email = `user${++n}.${Date.now()}@test.local`;
  const { rows } = await pool.query('INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING id', [name, email, HASH]);
  for (const [teamId, role] of memberships) {
    await pool.query('INSERT INTO memberships(user_id,team_id,role) VALUES ($1,$2,$3)', [rows[0].id, teamId, role]);
  }
  return { id: rows[0].id, name, email, token: signToken(rows[0].id) };
}

/** Two isolated teams with one user per role in team A and a lead + member in team B. */
export async function createFixtures() {
  await resetDb();
  const teamA = await makeTeam('Team A');
  const teamB = await makeTeam('Team B');
  return {
    teamA,
    teamB,
    leadA: await makeUser('Lead A', [[teamA, 'lead']]),
    memberA: await makeUser('Member A', [[teamA, 'member']]),
    member2A: await makeUser('Member A2', [[teamA, 'member']]),
    viewerA: await makeUser('Viewer A', [[teamA, 'viewer']]),
    adminA: await makeUser('Admin A', [[teamA, 'admin']]),
    leadB: await makeUser('Lead B', [[teamB, 'lead']]),
    memberB: await makeUser('Member B', [[teamB, 'member']]),
  };
}

export async function insertItem({ teamId, createdBy, title = 'Seed item', status = 'open', priority = 'medium', type = 'task', assigneeId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO work_items(title,type,priority,status,team_id,assignee_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [title, type, priority, status, teamId, assigneeId, createdBy],
  );
  return rows[0].id;
}

export const dbItem = async (id) => (await pool.query('SELECT * FROM work_items WHERE id = $1', [id])).rows[0];
export const dbEvents = async (id, type) =>
  (await pool.query(`SELECT * FROM activity_events WHERE work_item_id = $1 ${type ? 'AND event_type = $2' : ''} ORDER BY id`, type ? [id, type] : [id])).rows;

export const as = (user) => {
  const auth = (r) => (user ? r.set('Authorization', `Bearer ${user.token}`) : r);
  return {
    get: (url) => auth(request(app).get(url)),
    post: (url, body = {}, headers = {}) => {
      let r = auth(request(app).post(url));
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      return r.send(body);
    },
    patch: (url, body = {}) => auth(request(app).patch(url)).send(body),
  };
};
export const anon = as(null);
