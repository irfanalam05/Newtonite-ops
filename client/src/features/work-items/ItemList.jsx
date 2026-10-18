import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { PriorityBadge, StatusBadge, TypeLabel } from '../../components/ui.jsx';
import { formatDate, isOverdue, relativeTime } from '../../lib/format.js';

export const Due = ({ item }) =>
  item.dueAt ? (
    <span className={`inline-flex items-center gap-1 ${isOverdue(item) ? 'font-medium text-danger' : ''}`}>
      <CalendarClock className="h-3 w-3" aria-hidden />{formatDate(item.dueAt)}{isOverdue(item) && ' (overdue)'}
    </span>
  ) : <span className="text-muted">—</span>;

/** Table on md+, stacked cards on small screens. */
export function ItemList({ items }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-muted">
            <tr>
              {['ID', 'Title', 'Type', 'Priority', 'Status', 'Team', 'Assignee', 'Creator', 'Due', 'Updated'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((i) => (
              <tr key={i.id} className="hover:bg-canvas">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{i.ref}</td>
                <td className="max-w-xs px-3 py-2"><Link className="font-medium text-navy hover:text-teal hover:underline" to={`/items/${i.id}`}>{i.title}</Link></td>
                <td className="px-3 py-2"><TypeLabel type={i.type} /></td>
                <td className="px-3 py-2"><PriorityBadge priority={i.priority} /></td>
                <td className="px-3 py-2"><StatusBadge status={i.status} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{i.teamName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{i.assigneeName ?? <span className="text-muted">Unassigned</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{i.creatorName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs"><Due item={i} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{relativeTime(i.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {items.map((i) => (
          <li key={i.id} className="space-y-1.5 p-3">
            <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted">{i.ref}</span><StatusBadge status={i.status} /></div>
            <Link className="block font-medium text-navy" to={`/items/${i.id}`}>{i.title}</Link>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <PriorityBadge priority={i.priority} /><TypeLabel type={i.type} /><span>{i.teamName}</span>
              <span>· {i.assigneeName ?? 'Unassigned'}</span><Due item={i} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
