const SELECT_ITEM = `
SELECT w.id, w.ref, w.title, w.description, w.type, w.priority, w.status,
       w.team_id AS "teamId", t.name AS "teamName",
       w.assignee_id AS "assigneeId", a.name AS "assigneeName",
       w.created_by AS "createdBy", c.name AS "creatorName",
       w.due_at AS "dueAt", w.version,
       w.created_at AS "createdAt", w.updated_at AS "updatedAt",
       w.updated_at::text AS "cursorTs"
  FROM work_items w
  JOIN teams t ON t.id = w.team_id
  LEFT JOIN users a ON a.id = w.assignee_id
  JOIN users c ON c.id = w.created_by`;

const strip = ({ cursorTs, ...rest }) => rest;

export async function findById(db, id, { lock = false } = {}) {
  const r = await db.query(`${SELECT_ITEM} WHERE w.id = $1 ${lock ? 'FOR UPDATE OF w' : ''}`, [id]);
  return r.rows[0] ? strip(r.rows[0]) : null;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Builds the authorised WHERE clause. Team scoping is part of the SQL itself: rows from teams the
 * user is not a member of can never be selected, whatever the filters say.
 */
export function buildWhere(user, f = {}) {
  const params = [];
  const p = (v) => (params.push(v), `$${params.length}`);
  const where = [];

  where.push(`w.team_id = ANY(${p([...user.roles.keys()])}::int[])`);
  if (f.teamId) where.push(`w.team_id = ${p(f.teamId)}`);

  if (f.view === 'assigned_to_me') {
    where.push(`w.assignee_id = ${p(user.id)}`, `w.status NOT IN ('resolved','closed')`);
  } else if (f.view === 'unassigned_urgent') {
    where.push(`w.priority = 'urgent'`, 'w.assignee_id IS NULL', `w.status NOT IN ('resolved','closed')`);
  } else if (f.view === 'awaiting_my_approval') {
    const leadTeams = [...user.roles].filter(([, r]) => r === 'lead').map(([id]) => id);
    where.push(`w.status = 'awaiting_approval'`, `w.team_id = ANY(${p(leadTeams)}::int[])`);
  }

  if (f.status) where.push(`w.status = ANY(${p(f.status)}::text[])`);
  if (f.priority) where.push(`w.priority = ANY(${p(f.priority)}::text[])`);
  if (f.type) where.push(`w.type = ANY(${p(f.type)}::text[])`);
  if (f.assignee === 'me') where.push(`w.assignee_id = ${p(user.id)}`);
  else if (f.assignee === 'unassigned') where.push('w.assignee_id IS NULL');
  else if (f.assignee) where.push(`w.assignee_id = ${p(Number(f.assignee))}`);
  if (f.q) {
    const like = p(`%${escapeLike(f.q)}%`);
    where.push(`(w.title ILIKE ${like} OR w.ref ILIKE ${like})`);
  }
  return { where, params, p };
}

export async function listItems(db, user, filters, { limit, cursor }) {
  const { where, params, p } = buildWhere(user, filters);
  if (cursor) where.push(`(w.updated_at, w.id) < (${p(cursor.ts)}::timestamptz, ${p(cursor.id)}::bigint)`);
  const sql = `${SELECT_ITEM} WHERE ${where.join(' AND ')}
               ORDER BY w.updated_at DESC, w.id DESC LIMIT ${p(limit + 1)}`;
  const r = await db.query(sql, params);
  const hasMore = r.rows.length > limit;
  const page = r.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(strip),
    hasMore,
    next: hasMore && last ? { ts: last.cursorTs, id: last.id } : null,
  };
}

export async function countItems(db, user, filters) {
  const { where, params } = buildWhere(user, filters);
  const r = await db.query(`SELECT count(*) AS n FROM work_items w WHERE ${where.join(' AND ')}`, params);
  return r.rows[0].n;
}

export async function findAssignee(db, teamId, userId) {
  const r = await db.query(
    `SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.id = $1 AND m.team_id = $2 AND u.is_active AND m.role IN ('member','lead')`,
    [userId, teamId],
  );
  return r.rows[0] ?? null;
}
