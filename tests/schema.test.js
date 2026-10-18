import { beforeEach, describe, expect, it } from 'vitest';
import { createFixtures, insertItem, pool } from './helpers.js';
import { migrate } from '../server/src/db/migrate.js';

let f;
beforeEach(async () => { f = await createFixtures(); });

describe('database schema', () => {
  it('migrations are idempotent and create the indexes the list/dashboard queries rely on', async () => {
    await migrate({ log: () => {} }); // second run must be a no-op, not an error
    const files = (await pool.query('SELECT filename FROM schema_migrations')).rows;
    expect(files.map((r) => r.filename)).toEqual(['001_init.sql']);
    const idx = (await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'work_items'`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining([
      'work_items_team_updated_idx', 'work_items_assignee_idx', 'work_items_unassigned_urgent_idx',
      'work_items_awaiting_idx', 'work_items_title_trgm_idx',
    ]));
    const unique = (await pool.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('users_email_lower_uq','idempotency_keys_pkey','jobs_dedupe_key_key')`)).rows;
    expect(unique).toHaveLength(3);
  });

  it('CHECK constraints reject invalid status, priority and type', async () => {
    for (const bad of [{ status: 'bogus' }, { priority: 'bogus' }, { type: 'bogus' }]) {
      await expect(insertItem({ teamId: f.teamA, createdBy: f.leadA.id, ...bad })).rejects.toThrow(/check constraint/i);
    }
  });

  it('prevents duplicate memberships, invalid roles and case-variant duplicate emails', async () => {
    await expect(pool.query('INSERT INTO memberships(user_id, team_id, role) VALUES ($1,$2,$3)', [f.leadA.id, f.teamA, 'member'])).rejects.toThrow(/duplicate key/i);
    await expect(pool.query('INSERT INTO memberships(user_id, team_id, role) VALUES ($1,$2,$3)', [f.leadA.id, f.teamB, 'superuser'])).rejects.toThrow(/check constraint/i);
    await expect(pool.query('INSERT INTO users(name, email, password_hash) VALUES ($1,$2,$3)', ['Dup', f.leadA.email.toUpperCase(), 'x'])).rejects.toThrow(/duplicate key/i);
  });
});
