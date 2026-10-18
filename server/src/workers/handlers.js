/**
 * Handlers must be idempotent: the same job may be delivered more than once (crash after the effect
 * but before the status update). Here the effect is guarded by a UNIQUE dedupe_key.
 */
export async function notifyAssignee(payload, { job, db }) {
  const { workItemId, assigneeId, ref, title } = payload ?? {};
  if (!workItemId || !assigneeId) throw new Error('notify_assignee: malformed payload');
  await db.query(
    `INSERT INTO notifications (user_id, work_item_id, message, dedupe_key) VALUES ($1,$2,$3,$4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [assigneeId, workItemId, `You were assigned ${ref}: ${title}`, job.dedupe_key],
  );
}

export const defaultHandlers = { notify_assignee: notifyAssignee };
