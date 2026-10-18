const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

/** Appends an audit event. Always called with the SAME client/transaction as the mutation it records. */
export async function recordEvent(db, { workItemId, actorId, type, previous = null, next = null, metadata = {} }) {
  const r = await db.query(
    `INSERT INTO activity_events (work_item_id, actor_id, event_type, previous_value, new_value, metadata)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
    [workItemId, actorId, type, j(previous), j(next), JSON.stringify(metadata)],
  );
  return r.rows[0].id;
}

/** Chronological (oldest first) timeline, keyset-paginated on id. Comment bodies are joined in. */
export async function listEvents(db, workItemId, { afterId = 0, limit = 50 }) {
  const r = await db.query(
    `SELECT e.id, e.event_type AS "eventType", e.previous_value AS "previousValue", e.new_value AS "newValue",
            e.metadata, e.created_at AS "createdAt",
            u.id AS "actorId", u.name AS "actorName", c.body AS "commentBody"
       FROM activity_events e
       JOIN users u ON u.id = e.actor_id
       LEFT JOIN comments c ON c.id = (e.metadata->>'commentId')::bigint
      WHERE e.work_item_id = $1 AND e.id > $2
      ORDER BY e.id ASC LIMIT $3`,
    [workItemId, afterId, limit + 1],
  );
  const hasMore = r.rows.length > limit;
  const rows = r.rows.slice(0, limit).map((e) => ({
    id: e.id,
    eventType: e.eventType,
    actor: { id: e.actorId, name: e.actorName },
    previousValue: e.previousValue,
    newValue: e.newValue,
    metadata: e.metadata,
    comment: e.commentBody ?? null,
    createdAt: e.createdAt,
  }));
  return { rows, hasMore, lastId: rows.length ? rows[rows.length - 1].id : null };
}
