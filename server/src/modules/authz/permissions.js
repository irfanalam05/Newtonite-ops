import { forbidden } from '../../lib/errors.js';
import { allowedTransitions } from './workflow.js';

// Role x action matrix (per team). Roles are looked up from the DB on every request,
// never from the token or the request body.
const MATRIX = {
  'item:read': ['viewer', 'member', 'lead', 'admin'],
  'item:create': ['member', 'lead', 'admin'],
  'item:claim': ['member', 'lead'],
  'item:assign': ['lead', 'admin'],
  'item:set_priority': ['lead', 'admin'],
  'item:comment': ['member', 'lead', 'admin'],
  'team:manage_members': ['admin'], // defined for completeness; no endpoint is exposed (see decisions)
};

export const CLAIMABLE_STATUSES = ['open', 'in_progress', 'awaiting_approval'];

/**
 * THE single permission function. `target` needs { teamId } and, for 'item:edit',
 * { createdBy, assigneeId }.
 */
export function can(user, action, target) {
  const role = user.roles.get(target.teamId);
  if (!role) return false;
  if (action === 'item:edit') {
    if (role === 'lead' || role === 'admin') return true;
    return role === 'member' && (target.createdBy === user.id || target.assigneeId === user.id);
  }
  return MATRIX[action]?.includes(role) ?? false;
}

export function requirePermission(user, action, target, message) {
  if (!can(user, action, target)) throw forbidden(message);
}

/** Capabilities shown to the UI. Purely informative: every mutation is re-checked server-side. */
export function permissionsFor(user, item) {
  const open = item.status !== 'closed';
  return {
    edit: open && can(user, 'item:edit', item),
    claim: can(user, 'item:claim', item) && !item.assigneeId && CLAIMABLE_STATUSES.includes(item.status),
    assign: open && can(user, 'item:assign', item),
    setPriority: open && can(user, 'item:set_priority', item),
    comment: can(user, 'item:comment', item),
    transitions: allowedTransitions(user, item),
  };
}
