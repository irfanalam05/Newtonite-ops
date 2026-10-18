import { useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { Alert, Button, Card, EmptyState, ErrorState, inputCls, Spinner } from '../../components/ui.jsx';
import { useActivity, useComment } from '../work-items/hooks.js';
import { describeError } from '../../lib/api.js';
import { describeEvent, formatDateTime } from '../../lib/format.js';

export function Timeline({ item }) {
  const { data, isLoading, error, refetch } = useActivity(item.id);
  const comment = useComment(item.id);
  const [text, setText] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await comment.mutateAsync(text.trim());
      setText('');
    } catch { /* surfaced via comment.error */ }
  }

  return (
    <Card title="Activity & comments">
      {isLoading ? <Spinner /> : error ? <ErrorState error={error} onRetry={refetch} /> : data.data.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ol className="space-y-3 p-4" aria-label="Activity timeline">
          {data.data.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-navy" aria-hidden>{e.actor.name.charAt(0)}</span>
              <div className="min-w-0 flex-1">
                <p><span className="font-medium text-navy">{e.actor.name}</span> {describeEvent(e)}</p>
                {e.comment && <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-2">{e.comment}</p>}
                <time className="text-xs text-muted" dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {item.permissions.comment ? (
        <form onSubmit={submit} className="space-y-2 border-t border-line p-4">
          {comment.error && <Alert tone="danger" title={describeError(comment.error).title}>{describeError(comment.error).message}</Alert>}
          <label htmlFor="comment" className="sr-only">Add a comment</label>
          <textarea id="comment" rows={2} maxLength={2000} className={inputCls} placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end"><Button type="submit" variant="primary" icon={comment.isPending ? undefined : Send} loading={comment.isPending} disabled={!text.trim()}>Comment</Button></div>
        </form>
      ) : (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-3 text-xs text-muted"><MessageSquare className="h-3.5 w-3.5" aria-hidden />Your role cannot comment on this item.</p>
      )}
    </Card>
  );
}
