import pg from 'pg';
import { config } from '../config/index.js';

// bigint (int8) columns -> JS numbers. Safe here: ids and counts stay far below 2^53.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
pool.on('error', (err) => console.error('[pg] idle client error:', err.message));

export const query = (text, params) => pool.query(text, params);

/** Runs fn inside BEGIN/COMMIT on one client. Any throw rolls everything back. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection may already be gone */
    }
    throw err;
  } finally {
    client.release();
  }
}
