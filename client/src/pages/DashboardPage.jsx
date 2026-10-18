import { Link } from 'react-router-dom';
import { CheckSquare, ShieldAlert, UserCheck } from 'lucide-react';
import { Card, EmptyState, ErrorState, PriorityBadge, Spinner, StatusBadge } from '../components/ui.jsx';
import { useDashboard } from '../features/work-items/hooks.js';
import { Due } from '../features/work-items/ItemList.jsx';
import { relativeTime } from '../lib/format.js';

const PANELS = [
  { key: 'assigned_to_me', title: 'Assigned to me', icon: UserCheck, empty: 'Nothing is assigned to you right now.' },
  { key: 'unassigned_urgent', title: 'Unassigned urgent', icon: ShieldAlert, empty: 'No urgent items are waiting for an owner.' },
  { key: 'awaiting_my_approval', title: 'Awaiting my approval', icon: CheckSquare, empty: 'No items are waiting for your approval.' },
];

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Operations dashboard</h1>
      {isLoading ? <Spinner /> : error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {PANELS.map(({ key, title, icon: Icon, empty }) => {
            const panel = data[key];
            return (
              <Card key={key} title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-teal" aria-hidden />{title}<span className="rounded-full bg-slate-100 px-2 text-xs text-muted" aria-label={`${panel.count} items`}>{panel.count}</span></span>}
                actions={panel.count > 0 && <Link className="text-xs font-medium text-teal hover:underline" to={`/items?view=${key}`}>View all</Link>}>
                {panel.items.length === 0 ? <EmptyState title={empty} /> : (
                  <ul className="divide-y divide-line">
                    {panel.items.map((i) => (
                      <li key={i.id} className="p-3">
                        <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted">{i.ref}</span><PriorityBadge priority={i.priority} /></div>
                        <Link to={`/items/${i.id}`} className="mt-0.5 block text-sm font-medium text-navy hover:text-teal">{i.title}</Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><StatusBadge status={i.status} /><span>{i.teamName}</span><span>· {i.assigneeName ?? 'Unassigned'}</span><span>· by {i.creatorName}</span><Due item={i} /><span>· {relativeTime(i.updatedAt)}</span></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
