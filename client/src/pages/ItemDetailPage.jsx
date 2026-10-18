import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Button, Card, ErrorState, PriorityBadge, Spinner, StatusBadge, TypeLabel } from '../components/ui.jsx';
import { Timeline } from '../features/activity/Timeline.jsx';
import { EditForm } from '../features/work-items/EditForm.jsx';
import { ItemActions } from '../features/work-items/ItemActions.jsx';
import { useItem } from '../features/work-items/hooks.js';
import { formatDate, formatDateTime, isOverdue } from '../lib/format.js';

const Meta = ({ label, children }) => (
  <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>
);

export default function ItemDetailPage() {
  const id = Number(useParams().id);
  const { data: item, isLoading, error, refetch } = useItem(id);
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Spinner />;
  if (error) return (<Card><ErrorState error={error} onRetry={refetch} /><div className="pb-6 text-center"><Link to="/items" className="text-sm text-teal hover:underline">Back to work items</Link></div></Card>);

  return (
    <div className="space-y-4">
      <Link to="/items" className="inline-flex items-center gap-1 text-sm text-muted hover:text-navy"><ArrowLeft className="h-4 w-4" aria-hidden />Work items</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">{item.ref}</p>
          <h1 className="break-words text-xl font-semibold">{item.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={item.status} /><PriorityBadge priority={item.priority} /><TypeLabel type={item.type} /></div>
        </div>
        {item.permissions.edit && !editing && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {editing ? <EditForm item={item} onClose={() => setEditing(false)} /> : (
            <Card title="Details">
              <div className="space-y-4 p-4">
                <p className="whitespace-pre-wrap break-words text-sm">{item.description || <span className="text-muted">No description.</span>}</p>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Meta label="Team">{item.teamName}</Meta>
                  <Meta label="Assignee">{item.assigneeName ?? <span className="text-muted">Unassigned</span>}</Meta>
                  <Meta label="Created by">{item.creatorName}</Meta>
                  <Meta label="Due"><span className={isOverdue(item) ? 'font-medium text-danger' : ''}>{formatDate(item.dueAt)}{isOverdue(item) && ' (overdue)'}</span></Meta>
                  <Meta label="Created">{formatDateTime(item.createdAt)}</Meta>
                  <Meta label="Last updated">{formatDateTime(item.updatedAt)}</Meta>
                </dl>
              </div>
            </Card>
          )}
          <Timeline item={item} />
        </div>
        <div className="space-y-4"><ItemActions item={item} /></div>
      </div>
    </div>
  );
}
