import { withTransaction, pool } from '../../db/pool.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { decodeCursor, encodeCursor, decodeIdCursor, encodeIdCursor } from '../../lib/cursor.js';
import { fingerprint } from '../../lib/stableJson.js';
import { can, permissionsFor, requirePermission, CLAIMABLE_STATUSES } from '../authz/permissions.js';
import { getTransition, mayPerform } from '../authz/workflow.js';
import { recordEvent, listEvents } from '../activity/activity.repo.js';
import { enqueueJob } from '../../services/outbox.js';
import { beginIdempotent, completeIdempotent } from '../../services/idempotency.js';
import * as repo from './workItems.repo.js';

const present = (user, item) => ({ ...item, permissions: permissionsFor(user, item) });

/**
 * Loads an item the user is allowed to see. Items of teams the user does not belong to are
 * reported as 404 (not 403) so their existence is not disclosed — for reads AND writes.
 */
async function loadVisible(db, user, id, opts) {
  const item = await repo.findById(db, id, opts);
  if (!item || !user.roles.has(item.teamId)) throw notFound('Work item');
  return item;
}

async function conflict(db, user, id, code, message) {
  const current = await loadVisible(db, user, id);
  return new AppError(409, code, message, { current: present(user, current) });
}

async function resolveAssignee(db, teamId, assigneeId) {
  const a = await repo.findAssignee(db, teamId, assigneeId);
  if (!a) throw new AppError(422, 'INVALID_ASSIGNEE', 'Assignee must be an active Member or Lead of the item\'s team');
  return a;
}

async function notifyAssignment(db, { actor, item, assignee, eventId }) {
  if (assignee.id === actor.id) return; // no point notifying someone of their own action
  await enqueueJob(db, {
    type: 'notify_assignee',
    dedupeKey: `notify_assignee:event:${eventId}`,
    payload: { workItemId: item.id, ref: item.ref, title: item.title, assigneeId: assignee.id, assignedBy: actor.id },
  });
}

// ---------------------------------------------------------------- reads

export async function listItems(user, filters) {
  const { limit, cursor, ...rest } = filters;
  const decoded = cursor ? decodeCursor(cursor) : null;
  const page = await repo.listItems(pool, user, rest, { limit, cursor: decoded });
  return {
    data: page.rows.map((i) => present(user, i)),
    page: { limit, hasMore: page.hasMore, nextCursor: page.next ? encodeCursor(page.next) : null },
  };
}

export async function getItem(user, id) {
  return present(user, await loadVisible(pool, user, id));
}

export async function getActivity(user, id, { limit, cursor }) {
  await loadVisible(pool, user, id);
  const afterId = cursor ? decodeIdCursor(cursor) : 0;
  const r = await listEvents(pool, id, { afterId, limit });
  return { data: r.rows, page: { limit, hasMore: r.hasMore, nextCursor: r.hasMore ? encodeIdCursor(r.lastId) : null } };
}

// ---------------------------------------------------------------- create (idempotent)

export async function createItem(user, input, idempotencyKey) {
  const operation = 'items.create';
  return withTransaction(async (db) => {
    if (idempotencyKey) {
      const r = await beginIdempotent(db, { actorId: user.id, operation, key: idempotencyKey, hash: fingerprint(input) });
      if (r.replay) return { status: r.status, body: r.body, replayed: true };
    }

    // Client-supplied teamId is never trusted: membership + role are checked against the DB-loaded roles.
    if (!can(user, 'item:create', { teamId: input.teamId })) throw forbidden('You cannot create work items in that team');
    let assignee = null;
    if (input.assigneeId) {
      requirePermission(user, 'item:assign', { teamId: input.teamId }, 'You cannot assign work items in that team');
      assignee = await resolveAssignee(db, input.teamId, input.assigneeId);
    }

    const ins = await db.query(
      `INSERT INTO work_items (title, description, type, priority, status, team_id, assignee_id, created_by, due_at)
       VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8) RETURNING id`,
      [input.title, input.description, input.type, input.priority, input.teamId, assignee?.id ?? null, user.id, input.dueAt ?? null],
    );
    const item = await repo.findById(db, ins.rows[0].id);
    const eventId = await recordEvent(db, {
      workItemId: item.id,
      actorId: user.id,
      type: 'created',
      next: { title: item.title, type: item.type, priority: item.priority, status: item.status, assignee: assignee },
    });
    if (assignee) await notifyAssignment(db, { actor: user, item, assignee, eventId });

    const body = { data: present(user, item) };
    if (idempotencyKey) await completeIdempotent(db, { actorId: user.id, operation, key: idempotencyKey }, 201, body);
    return { status: 201, body, replayed: false };
  });
}

// ---------------------------------------------------------------- update (optimistic locking)

const same = (a, b) => (a instanceof Date ? a.getTime() : a) === (b instanceof Date ? b.getTime() : b);

export async function updateItem(user, id, input) {
  return withTransaction(async (db) => {
    const item = await loadVisible(db, user, id);
    if (item.status === 'closed') throw new AppError(422, 'ITEM_CLOSED', 'Closed items cannot be edited');
    requirePermission(user, 'item:edit', item);

    // Fast path: the client's copy is already known to be stale.
    if (item.version !== input.expectedVersion) {
      throw await conflict(db, user, id, 'VERSION_CONFLICT', 'This item was changed by someone else. Reload it and try again.');
    }

    const changes = {}; // column -> new value
    const edited = { previous: {}, next: {} };
    for (const f of ['title', 'description', 'type']) {
      if (input[f] !== undefined && input[f] !== item[f]) {
        changes[f] = input[f];
        edited.previous[f] = item[f];
        edited.next[f] = input[f];
      }
    }
    if (input.dueAt !== undefined) {
      const next = input.dueAt === null ? null : new Date(input.dueAt);
      if (!same(item.dueAt, next)) {
        changes.due_at = next;
        edited.previous.dueAt = item.dueAt;
        edited.next.dueAt = next;
      }
    }
    let priorityChange = null;
    if (input.priority !== undefined && input.priority !== item.priority) {
      requirePermission(user, 'item:set_priority', item, 'Only a Lead or Admin can change priority');
      changes.priority = input.priority;
      priorityChange = { previous: item.priority, next: input.priority };
    }
    let assigneeChange = null;
    if (input.assigneeId !== undefined && input.assigneeId !== item.assigneeId) {
      requirePermission(user, 'item:assign', item, 'Only a Lead or Admin can assign work items');
      const next = input.assigneeId === null ? null : await resolveAssignee(db, item.teamId, input.assigneeId);
      changes.assignee_id = next?.id ?? null;
      assigneeChange = {
        previous: item.assigneeId ? { id: item.assigneeId, name: item.assigneeName } : null,
        next,
      };
    }

    if (Object.keys(changes).length === 0) return present(user, item); // nothing to change: no version bump

    // Column names come from the fixed allow-list above, never from client input.
    const vals = [id, input.expectedVersion];
    const sets = Object.entries(changes).map(([col, v]) => (vals.push(v), `${col} = $${vals.length}`));
    const upd = await db.query(
      `UPDATE work_items SET ${sets.join(', ')}, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2 RETURNING id`,
      vals,
    );
    if (upd.rowCount === 0) {
      throw await conflict(db, user, id, 'VERSION_CONFLICT', 'This item was changed by someone else. Reload it and try again.');
    }

    if (priorityChange) {
      await recordEvent(db, { workItemId: id, actorId: user.id, type: 'priority_changed', previous: priorityChange.previous, next: priorityChange.next });
    }
    if (assigneeChange) {
      const eventId = await recordEvent(db, { workItemId: id, actorId: user.id, type: 'assignee_changed', previous: assigneeChange.previous, next: assigneeChange.next });
      if (assigneeChange.next) await notifyAssignment(db, { actor: user, item, assignee: assigneeChange.next, eventId });
    }
    if (Object.keys(edited.next).length) {
      await recordEvent(db, { workItemId: id, actorId: user.id, type: 'item_edited', previous: edited.previous, next: edited.next });
    }
    return present(user, await repo.findById(db, id));
  });
}

// ---------------------------------------------------------------- claim (atomic)

export async function claimItem(user, id) {
  return withTransaction(async (db) => {
    const item = await loadVisible(db, user, id);
    requirePermission(user, 'item:claim', item, 'Your role in this team cannot claim work items');

    // The race is decided by this single conditional UPDATE. Postgres row-locks the matching row;
    // a concurrent claimer re-evaluates the WHERE after the first commits, sees assignee_id set, and gets 0 rows.
    const upd = await db.query(
      `UPDATE work_items SET assignee_id = $2, version = version + 1, updated_at = now()
        WHERE id = $1 AND assignee_id IS NULL AND status = ANY($3::text[]) RETURNING id`,
      [id, user.id, CLAIMABLE_STATUSES],
    );
    if (upd.rowCount === 0) {
      const current = await repo.findById(db, id);
      if (current.assigneeId) {
        throw await conflict(db, user, id, 'ALREADY_CLAIMED', `Already claimed by ${current.assigneeName}. The latest state has been loaded.`);
      }
      throw new AppError(422, 'NOT_CLAIMABLE', `A ${current.status.replace('_', ' ')} item cannot be claimed`);
    }
    await recordEvent(db, {
      workItemId: id,
      actorId: user.id,
      type: 'assignee_changed',
      previous: null,
      next: { id: user.id, name: user.name },
      metadata: { action: 'claim' },
    });
    return present(user, await repo.findById(db, id));
  });
}

// ---------------------------------------------------------------- workflow transition

export async function transitionItem(user, id, { to, expectedVersion }) {
  return withTransaction(async (db) => {
    const item = await loadVisible(db, user, id, { lock: true }); // serialise competing transitions
    const rule = getTransition(item.status, to);
    if (!rule) {
      throw new AppError(422, 'INVALID_TRANSITION', `Cannot move a work item from "${item.status}" to "${to}"`);
    }
    const role = user.roles.get(item.teamId);
    if (!mayPerform(role, rule, { isAssignee: item.assigneeId === user.id })) {
      throw forbidden(
        rule.who === 'lead'
          ? `Only a Lead of ${item.teamName} can ${rule.action} this item`
          : 'Only the assignee or a Lead can perform this transition',
      );
    }
    if (expectedVersion !== undefined && expectedVersion !== item.version) {
      throw await conflict(db, user, id, 'VERSION_CONFLICT', 'This item was changed by someone else. Reload it and try again.');
    }
    await db.query(
      `UPDATE work_items SET status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
      [id, to],
    );
    await recordEvent(db, {
      workItemId: id,
      actorId: user.id,
      type: 'status_changed',
      previous: item.status,
      next: to,
      metadata: { action: rule.action },
    });
    return present(user, await repo.findById(db, id));
  });
}

// ---------------------------------------------------------------- comments

export async function addComment(user, id, { body }) {
  return withTransaction(async (db) => {
    const item = await loadVisible(db, user, id);
    requirePermission(user, 'item:comment', item, 'Your role in this team cannot comment');
    const c = await db.query(
      `INSERT INTO comments (work_item_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, created_at AS "createdAt"`,
      [id, user.id, body],
    );
    await recordEvent(db, { workItemId: id, actorId: user.id, type: 'comment_added', metadata: { commentId: c.rows[0].id } });
    return { id: c.rows[0].id, body, author: { id: user.id, name: user.name }, createdAt: c.rows[0].createdAt };
  });
}

// ---------------------------------------------------------------- dashboard

export async function dashboard(user) {
  const views = ['assigned_to_me', 'unassigned_urgent', 'awaiting_my_approval'];
  const out = {};
  await Promise.all(
    views.map(async (view) => {
      const [count, page] = await Promise.all([
        repo.countItems(pool, user, { view }),
        repo.listItems(pool, user, { view }, { limit: 5, cursor: null }),
      ]);
      out[view] = { count, items: page.rows.map((i) => present(user, i)) };
    }),
  );
  return out;
}
