/** Enqueue inside the caller's transaction: the job exists iff the business change committed. */
export async function enqueueJob(db, { type, payload, dedupeKey, maxAttempts = 5 }) {
  await db.query(
    `INSERT INTO jobs (type, payload, dedupe_key, max_attempts) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [type, JSON.stringify(payload), dedupeKey, maxAttempts],
  );
}
