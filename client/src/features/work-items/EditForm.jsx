import { useState } from 'react';
import { Alert, Button, Card, Field, inputCls } from '../../components/ui.jsx';
import { describeError } from '../../lib/api.js';
import { PRIORITY, TYPES } from '../../lib/format.js';
import { useUpdateItem, useUsers } from './hooks.js';

const pad = (n) => String(n).padStart(2, '0');
export const toDateInput = (d) => (d ? `${new Date(d).getFullYear()}-${pad(new Date(d).getMonth() + 1)}-${pad(new Date(d).getDate())}` : '');
const toIso = (v) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

const snapshot = (item) => ({
  title: item.title, description: item.description, type: item.type, priority: item.priority,
  assigneeId: item.assigneeId ?? '', dueAt: toDateInput(item.dueAt),
});

export function EditForm({ item, onClose }) {
  const update = useUpdateItem(item.id);
  const users = useUsers();
  const [base, setBase] = useState({ version: item.version, ...snapshot(item) }); // what the user started from
  const [draft, setDraft] = useState(snapshot(item));
  const [stale, setStale] = useState(false);
  const p = item.permissions;
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const details = Object.fromEntries((update.error?.body?.details ?? []).map((d) => [d.path, d.message]));
  const assignable = (users.data ?? []).filter((u) => u.teams.some((t) => t.teamId === item.teamId && ['member', 'lead'].includes(t.role)));

  async function submit(e) {
    e.preventDefault();
    const changes = {};
    for (const k of ['title', 'description', 'type']) if (draft[k] !== base[k]) changes[k] = draft[k];
    if (p.setPriority && draft.priority !== base.priority) changes.priority = draft.priority;
    if (p.assign && String(draft.assigneeId) !== String(base.assigneeId)) changes.assigneeId = draft.assigneeId === '' ? null : Number(draft.assigneeId);
    if (draft.dueAt !== base.dueAt) changes.dueAt = toIso(draft.dueAt);
    if (Object.keys(changes).length === 0) return onClose();
    try {
      await update.mutateAsync({ expectedVersion: base.version, ...changes });
      onClose();
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') setStale(true);
    }
  }

  function loadLatest() {
    const cur = update.error?.body?.current ?? item; // server already returned the latest item
    setBase({ version: cur.version, ...snapshot(cur) });
    setDraft(snapshot(cur));
    setStale(false);
    update.reset();
  }

  const d = update.error && describeError(update.error);
  return (
    <Card title="Edit item">
      <form onSubmit={submit} className="space-y-3 p-4" noValidate>
        {stale && (
          <Alert tone="warn" title="This item changed" actions={<Button onClick={loadLatest}>Reload latest &amp; discard my edits</Button>}>
            Someone else updated this item while you were editing. Your changes were NOT saved. Reload the latest version before trying again.
          </Alert>
        )}
        {update.error && !stale && <Alert tone="danger" title={d.title}>{d.message}</Alert>}
        <Field label="Title" htmlFor="e-title" error={details.title}><input id="e-title" className={inputCls} value={draft.title} onChange={set('title')} maxLength={200} /></Field>
        <Field label="Description" htmlFor="e-desc" error={details.description}><textarea id="e-desc" rows={4} className={inputCls} value={draft.description} onChange={set('description')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="e-type"><select id="e-type" className={inputCls} value={draft.type} onChange={set('type')}>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Priority" htmlFor="e-prio" hint={p.setPriority ? undefined : 'Only a Lead or Admin can change priority'}>
            <select id="e-prio" className={inputCls} value={draft.priority} onChange={set('priority')} disabled={!p.setPriority}>{Object.entries(PRIORITY).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}</select>
          </Field>
          <Field label="Assignee" htmlFor="e-assignee" hint={p.assign ? undefined : 'Only a Lead or Admin can assign'}>
            <select id="e-assignee" className={inputCls} value={draft.assigneeId} onChange={set('assigneeId')} disabled={!p.assign}>
              <option value="">Unassigned</option>
              {assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Due date" htmlFor="e-due"><input id="e-due" type="date" className={inputCls} value={draft.dueAt} onChange={set('dueAt')} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={update.isPending} disabled={stale}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}
