import { Router } from 'express';
import { query } from '../db/pool.js';

export const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' })); // liveness: process is up

// Readiness: database reachable. Also surfaces outbox backlog/failures so operators can see them.
router.get('/ready', async (req, res) => {
  try {
    await query('SELECT 1');
    const jobs = await query('SELECT status, count(*) AS n FROM jobs GROUP BY status');
    res.json({ status: 'ready', database: 'up', jobs: Object.fromEntries(jobs.rows.map((r) => [r.status, r.n])) });
  } catch (err) {
    console.error('[ready] database check failed:', err.message);
    res.status(503).json({ status: 'unavailable', database: 'down' });
  }
});
