import { useState } from 'react';
import { Hand } from 'lucide-react';
import { Alert, Button, Card, ConfirmDialog } from '../../components/ui.jsx';
import { describeError } from '../../lib/api.js';
import { ACTION_LABEL } from '../../lib/format.js';
import { useClaim, useTransition } from './hooks.js';

const NEEDS_CONFIRM = new Set(['approve', 'reject', 'close']);

/** Only offers what the server says this user may do (permissions come from the API; the server re-checks). */
export function ItemActions({ item }) {
  const claim = useClaim(item.id);
  const transition = useTransition(item.id);
  const [pending, setPending] = useState(null); // transition awaiting confirmation
  const [feedback, setFeedback] = useState(null);
  const { claim: canClaim, transitions } = item.permissions;

  const fail = (err) => {
    const d = describeError(err);
    setFeedback({ tone: d.kind === 'conflict' ? 'warn' : 'danger', title: d.title, message: d.message });
  };
  const doClaim = () => { setFeedback(null); claim.mutate(undefined, { onError: fail, onSuccess: () => setFeedback({ tone: 'success', message: 'You claimed this item.' }) }); };
  const doTransition = (t) => {
    setFeedback(null);
    transition.mutate({ to: t.to, expectedVersion: item.version }, {
      onError: (err) => { setPending(null); fail(err); },
      onSuccess: () => { setPending(null); setFeedback({ tone: 'success', message: `${ACTION_LABEL[t.action]}: done.` }); },
    });
  };

  if (!canClaim && transitions.length === 0 && !feedback) return null;
  return (
    <Card title="Actions">
      <div className="space-y-3 p-4">
        {feedback && <Alert tone={feedback.tone} title={feedback.title} onClose={() => setFeedback(null)}>{feedback.message}</Alert>}
        <div className="flex flex-wrap gap-2">
          {canClaim && <Button variant="primary" icon={Hand} loading={claim.isPending} onClick={doClaim}>Claim</Button>}
          {transitions.map((t) => (
            <Button
              key={t.to}
              variant={t.action === 'approve' ? 'primary' : t.action === 'reject' ? 'danger' : 'secondary'}
              loading={transition.isPending && transition.variables?.to === t.to && !NEEDS_CONFIRM.has(t.action)}
              onClick={() => (NEEDS_CONFIRM.has(t.action) ? setPending(t) : doTransition(t))}
            >
              {ACTION_LABEL[t.action]}
            </Button>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={!!pending}
        title={pending ? ACTION_LABEL[pending.action] : ''}
        confirmLabel="Confirm"
        danger={pending?.action === 'reject'}
        loading={transition.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => doTransition(pending)}
      >
        {pending && <>This will move <strong>{item.ref}</strong> to <strong>{pending.to.replace('_', ' ')}</strong> and be recorded in the activity history.</>}
      </ConfirmDialog>
    </Card>
  );
}
