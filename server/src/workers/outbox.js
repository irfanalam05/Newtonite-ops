import { pool } from '../db/pool.js';
import { config } from '../config/index.js';

/**
 * Claims due jobs atomically and processes them OUTSIDE any long transaction.
 *  - Claim = one UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED): two workers can never take the same row.
 *  - Crash recovery: a job stuck in 'processing' longer than lockTimeoutSeconds is re-claimable.
 *    attempts is incremented at claim time, so a job that keeps crashing its worker still hits max_attempts.
 *  - Retry: failure -> 'pending' with exponential backoff; attempts >= max_attempts -> 'failed' (terminal).
 */
export async function processBatch(
  handlers,
  {
    batchSize = config.worker.batchSize,
    lockTimeoutSeconds = config.worker.lockTimeoutSeconds,
    backoffBaseSeconds = config.worker.backoffBaseSeconds,
  } = {},
) {
  // Jobs whose worker died on the final attempt can never run again: mark them failed.
  await pool.query(
    `UPDATE jobs SET status = 'failed', locked_at = NULL,
            last_error = COALESCE(last_error, 'worker stopped before completing the final attempt')
      WHERE status = 'processing' AND attempts >= max_attempts
        AND locked_at < now() - make_interval(secs => $1::double precision)`,
    [lockTimeoutSeconds],
  );

  const claimed = await pool.query(
    `WITH picked AS (
       SELECT id FROM jobs
        WHERE (status = 'pending' AND next_attempt_at <= now())
           OR (status = 'processing' AND attempts < max_attempts
               AND locked_at < now() - make_interval(secs => $1::double precision))
        ORDER BY next_attempt_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED)
     UPDATE jobs j SET status = 'processing', locked_at = now(), attempts = j.attempts + 1
       FROM picked WHERE j.id = picked.id
     RETURNING j.*`,
    [lockTimeoutSeconds, batchSize],
  );

  const stats = { claimed: claimed.rowCount, done: 0, retried: 0, failed: 0 };
  for (const job of claimed.rows) {
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
      await handler(job.payload, { job, db: pool });
      await pool.query(
        `UPDATE jobs SET status = 'done', processed_at = now(), locked_at = NULL, last_error = NULL
          WHERE id = $1 AND status = 'processing' AND attempts = $2`,
        [job.id, job.attempts],
      );
      stats.done++;
    } catch (err) {
      const message = String(err?.message ?? err).slice(0, 1000);
      if (job.attempts >= job.max_attempts) {
        await pool.query(
          `UPDATE jobs SET status = 'failed', locked_at = NULL, last_error = $3
            WHERE id = $1 AND status = 'processing' AND attempts = $2`,
          [job.id, job.attempts, message],
        );
        stats.failed++;
        console.error(`[worker] job ${job.id} (${job.type}) FAILED permanently after ${job.attempts} attempts: ${message}`);
      } else {
        const delay = backoffBaseSeconds * 2 ** (job.attempts - 1);
        await pool.query(
          `UPDATE jobs SET status = 'pending', locked_at = NULL, last_error = $3,
                  next_attempt_at = now() + make_interval(secs => $4::double precision)
            WHERE id = $1 AND status = 'processing' AND attempts = $2`,
          [job.id, job.attempts, message, delay],
        );
        stats.retried++;
        console.warn(`[worker] job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${job.max_attempts}), retry in ${delay}s: ${message}`);
      }
    }
  }
  return stats;
}
