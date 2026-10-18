// Central workflow definition. Anything not listed here is an invalid transition.
export const STATUSES = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TYPES = ['incident', 'customer_issue', 'payment', 'compliance', 'task'];

// who: 'assignee_or_lead' = the item's assignee (role member+) or a team Lead
//      'lead'             = team Lead only (the approval gate)
export const TRANSITIONS = {
  open: { in_progress: { action: 'start', who: 'assignee_or_lead' } },
  in_progress: { awaiting_approval: { action: 'submit', who: 'assignee_or_lead' } },
  awaiting_approval: {
    resolved: { action: 'approve', who: 'lead' },
    in_progress: { action: 'reject', who: 'lead' },
  },
  resolved: { closed: { action: 'close', who: 'lead' } },
  closed: {},
};

export const getTransition = (from, to) => TRANSITIONS[from]?.[to] ?? null;

export function mayPerform(role, rule, { isAssignee }) {
  if (rule.who === 'lead') return role === 'lead';
  if (rule.who === 'assignee_or_lead') {
    return role === 'lead' || (role === 'member' && isAssignee);
  }
  return false;
}

/** Transitions the given user may perform right now (used by the UI; the server re-checks). */
export function allowedTransitions(user, item) {
  const role = user.roles.get(item.teamId);
  if (!role) return [];
  return Object.entries(TRANSITIONS[item.status] ?? {})
    .filter(([, rule]) => mayPerform(role, rule, { isAssignee: item.assigneeId === user.id }))
    .map(([to, rule]) => ({ to, action: rule.action }));
}
