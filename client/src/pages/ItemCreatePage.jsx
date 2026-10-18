import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Field, inputCls } from '../components/ui.jsx';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { useCreateItem, useUsers } from '../features/work-items/hooks.js';
import { describeError, newIdempotencyKey } from '../lib/api.js';
import { PRIORITY, TYPES } from '../lib/format.js';

export default function ItemCreatePage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const create = useCreateItem();
  const users = useUsers();
  const writable = user.memberships.filter((m) => ['member', 'lead', 'admin'].includes(m.role));
  const [form, setForm] = useState({ title: '', description: '', type: 'task', priority: 'medium', teamId: writable[0]?.teamId ?? '', assigneeId: '', dueAt: '' });
  // One key per form instance: a double-click or a retry after a network error re-sends the SAME key,
  // so the server creates the item once. The key is only replaced after a successful create.
  const keyRef = useRef(newIdempotencyKey());
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const role = user.memberships.find((m) => m.teamId === Number(form.teamId))?.role;
  const canAssign = role === 'lead' || role === 'admin';
  const assignable = (users.data ?? []).filter((u) => u.teams.some((t) => t.teamId === Number(form.teamId) && ['member', 'lead'].includes(t.role)));
  const details = Object.fromEntries((create.error?.body?.details ?? []).map((d) => [d.path, d.message]));

  async function submit(e) {
    e.preventDefault();
    if (create.isPending) return;
    const input = {
      title: form.title.trim(), description: form.description, type: form.type, priority: form.priority, teamId: Number(form.teamId),
      ...(canAssign && form.assigneeId ? { assigneeId: Number(form.assigneeId) } : {}),
      ...(form.dueAt ? { dueAt: new Date(`${form.dueAt}T12:00:00`).toISOString() } : {}),
    };
    try {
      const item = await create.mutateAsync({ input, key: keyRef.current });
      keyRef.current = newIdempotencyKey();
      nav(`/items/${item.id}`);
    } catch { /* shown below */ }
  }

  if (writable.length === 0) return <Alert tone="warn" title="Read-only access">Your role in every team is Viewer, so you cannot create work items.</Alert>;
  const d = create.error && describeError(create.error);
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New work item</h1>
      <Card>
        <form onSubmit={submit} className="space-y-3 p-4" noValidate>
          {create.error && <Alert tone="danger" title={d.title}>{d.message}{d.kind === 'network' && ' You can safely press Create again: duplicate submissions are ignored.'}</Alert>}
          <Field label="Title" htmlFor="c-title" error={details.title}><input id="c-title" className={inputCls} value={form.title} onChange={set('title')} maxLength={200} required /></Field>
          <Field label="Description" htmlFor="c-desc" error={details.description}><textarea id="c-desc" rows={4} className={inputCls} value={form.description} onChange={set('description')} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Team" htmlFor="c-team"><select id="c-team" className={inputCls} value={form.teamId} onChange={set('teamId')}>{writable.map((m) => <option key={m.teamId} value={m.teamId}>{m.teamName}</option>)}</select></Field>
            <Field label="Type" htmlFor="c-type"><select id="c-type" className={inputCls} value={form.type} onChange={set('type')}>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Priority" htmlFor="c-prio"><select id="c-prio" className={inputCls} value={form.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}</select></Field>
            <Field label="Due date" htmlFor="c-due"><input id="c-due" type="date" className={inputCls} value={form.dueAt} onChange={set('dueAt')} /></Field>
            {canAssign && (
              <Field label="Assignee" htmlFor="c-assignee">
                <select id="c-assignee" className={inputCls} value={form.assigneeId} onChange={set('assigneeId')}>
                  <option value="">Unassigned</option>{assignable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" variant="primary" loading={create.isPending}>Create item</Button></div>
        </form>
      </Card>
    </div>
  );
}
