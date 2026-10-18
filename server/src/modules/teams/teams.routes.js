import { Router } from 'express';
import { query } from '../../db/pool.js';

export const router = Router();

async function teamsFor(user) {
  const r = await query(
    `SELECT t.id, t.name, t.description,
            COALESCE(json_agg(json_build_object('userId', u.id, 'name', u.name, 'email', u.email, 'role', m2.role)
                     ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS members
       FROM teams t
       JOIN memberships m  ON m.team_id = t.id AND m.user_id = $1
       LEFT JOIN memberships m2 ON m2.team_id = t.id
       LEFT JOIN users u ON u.id = m2.user_id AND u.is_active
      GROUP BY t.id ORDER BY t.name`,
    [user.id],
  );
  return r.rows.map((t) => ({ ...t, myRole: user.roles.get(t.id) }));
}

// Only teams the caller belongs to (and their members) are ever visible.
router.get('/teams', async (req, res) => {
  res.json({ data: await teamsFor(req.user) });
});

router.get('/users', async (req, res) => {
  const byId = new Map();
  for (const t of await teamsFor(req.user)) {
    for (const m of t.members) {
      const u = byId.get(m.userId) ?? { id: m.userId, name: m.name, email: m.email, teams: [] };
      u.teams.push({ teamId: t.id, teamName: t.name, role: m.role });
      byId.set(m.userId, u);
    }
  }
  res.json({ data: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)) });
});

router.get('/notifications', async (req, res) => {
  const r = await query(
    `SELECT id, work_item_id AS "workItemId", message, created_at AS "createdAt"
       FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
    [req.user.id],
  );
  res.json({ data: r.rows });
});
