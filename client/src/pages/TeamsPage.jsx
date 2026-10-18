import { Alert, Card, ErrorState, Spinner } from '../components/ui.jsx';
import { useTeams } from '../features/work-items/hooks.js';
import { ROLES } from '../lib/format.js';

export default function TeamsPage() {
  const { data, isLoading, error, refetch } = useTeams();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Teams</h1>
      <Alert tone="info">Membership is read-only in this build (managed through seeded data). See Known limitations.</Alert>
      {isLoading ? <Spinner /> : error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((t) => (
            <Card key={t.id} title={t.name} actions={<span className="text-xs text-muted">Your role: <strong className="text-navy">{ROLES[t.myRole]}</strong></span>}>
              <p className="px-4 pt-3 text-sm text-muted">{t.description}</p>
              <ul className="divide-y divide-line p-2">
                {t.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between px-2 py-1.5 text-sm"><span>{m.name}<span className="ml-2 text-xs text-muted">{m.email}</span></span><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{ROLES[m.role]}</span></li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
