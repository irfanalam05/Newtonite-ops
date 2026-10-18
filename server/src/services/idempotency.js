import { AppError } from '../lib/errors.js';

/**
 * Called as the FIRST statement of the create transaction.
 *  - INSERT ... ON CONFLICT DO NOTHING: if a concurrent transaction holds the same key, this blocks
 *    on the unique index until it commits or rolls back (no in-memory state involved).
 *  - Inserted  -> we own the key; caller creates the item and calls complete() in the same txn.
 *  - Conflict  -> the key was committed together with its item; replay the stored response,
 *    or reject if the payload differs.
 * Because the key row commits atomically with the item, there is no persisted "in-progress"
 * state to get stuck on, and a failed attempt (rolled back) leaves no key behind: a retry just runs.
 */
export async function beginIdempotent(db, { actorId, operation, key, hash }) {
  const ins = await db.query(
    `INSERT INTO idempotency_keys (actor_id, operation, key, request_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (actor_id, operation, key) DO NOTHING RETURNING key`,
    [actorId, operation, key, hash],
  );
  if (ins.rowCount === 1) return { replay: false };

  const ex = await db.query(
    `SELECT request_hash, response_status, response_body FROM idempotency_keys
      WHERE actor_id=$1 AND operation=$2 AND key=$3`,
    [actorId, operation, key],
  );
  const row = ex.rows[0];
  if (!row || row.response_body === null) {
    throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
  }
  if (row.request_hash !== hash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
  }
  return { replay: true, status: row.response_status, body: row.response_body };
}

export async function completeIdempotent(db, { actorId, operation, key }, status, body) {
  await db.query(
    `UPDATE idempotency_keys SET response_status=$4, response_body=$5::jsonb
      WHERE actor_id=$1 AND operation=$2 AND key=$3`,
    [actorId, operation, key, status, JSON.stringify(body)],
  );
}
