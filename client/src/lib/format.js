export const STATUS = {
  open: { label: 'Open', cls: 'bg-slate-100 text-ink' },
  in_progress: { label: 'In progress', cls: 'bg-info/10 text-info' },
  awaiting_approval: { label: 'Awaiting approval', cls: 'bg-warn/10 text-warn' },
  resolved: { label: 'Resolved', cls: 'bg-success/10 text-success' },
  closed: { label: 'Closed', cls: 'bg-slate-200 text-muted' },
};
export const PRIORITY = {
  low: { label: 'Low', cls: 'bg-slate-100 text-muted' },
  medium: { label: 'Medium', cls: 'bg-info/10 text-info' },
  high: { label: 'High', cls: 'bg-warn/10 text-warn' },
  urgent: { label: 'Urgent', cls: 'bg-danger/10 text-danger' },
};
export const TYPES = { incident: 'Incident', customer_issue: 'Customer issue', payment: 'Payment', compliance: 'Compliance', task: 'Task' };
export const ROLES = { viewer: 'Viewer', member: 'Member', lead: 'Lead', admin: 'Admin' };
export const ACTION_LABEL = {
  start: 'Start work',
  submit: 'Submit for approval',
  approve: 'Approve & resolve',
  reject: 'Send back',
  close: 'Close item',
};

export const formatDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const formatDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export function relativeTime(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days}d ago` : formatDate(d);
}

export const isOverdue = (item) => !!item.dueAt && !['resolved', 'closed'].includes(item.status) && new Date(item.dueAt) < new Date();

/** Human-readable text for one activity event. */
export function describeEvent(e) {
  const val = (v) => (v && typeof v === 'object' ? v.name ?? JSON.stringify(v) : v);
  switch (e.eventType) {
    case 'created': return 'created this item';
    case 'status_changed': return `moved status from ${STATUS[e.previousValue]?.label ?? e.previousValue} to ${STATUS[e.newValue]?.label ?? e.newValue}${e.metadata?.action ? ` (${e.metadata.action})` : ''}`;
    case 'priority_changed': return `changed priority from ${PRIORITY[e.previousValue]?.label ?? e.previousValue} to ${PRIORITY[e.newValue]?.label ?? e.newValue}`;
    case 'assignee_changed':
      return e.metadata?.action === 'claim' ? 'claimed this item' : e.newValue ? `assigned this item to ${val(e.newValue)}${e.previousValue ? ` (was ${val(e.previousValue)})` : ''}` : 'unassigned this item';
    case 'item_edited': return `edited ${Object.keys(e.newValue ?? {}).join(', ')}`;
    case 'comment_added': return 'commented';
    default: return e.eventType;
  }
}
