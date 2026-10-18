import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { query } from '../../db/pool.js';
import { unauthenticated } from '../../lib/errors.js';

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

export const signToken = (userId) =>
  jwt.sign({ sub: String(userId) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn });

/** Loads an ACTIVE user with all team roles. `roles` (Map teamId -> role) drives every permission check. */
export async function loadUser(userId) {
  if (!Number.isSafeInteger(userId)) return null;
  const u = await query('SELECT id, name, email FROM users WHERE id = $1 AND is_active', [userId]);
  if (!u.rowCount) return null;
  const m = await query(
    `SELECT m.team_id AS "teamId", t.name AS "teamName", m.role
       FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 ORDER BY t.name`,
    [userId],
  );
  return { ...u.rows[0], memberships: m.rows, roles: new Map(m.rows.map((r) => [r.teamId, r.role])) };
}

export const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, memberships: user.memberships });

export async function login(email, password) {
  const res = await query('SELECT id, password_hash, is_active FROM users WHERE lower(email) = lower($1)', [email]);
  const row = res.rows[0];
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !row.is_active || !ok) throw unauthenticated('INVALID_CREDENTIALS', 'Incorrect email or password');
  const user = await loadUser(row.id);
  return { token: signToken(row.id), expiresIn: config.jwtExpiresIn, user: publicUser(user) };
}
