import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Field, inputCls, Spinner } from '../components/ui.jsx';
import { ItemList } from '../features/work-items/ItemList.jsx';
import { useItems, useTeams, useUsers } from '../features/work-items/hooks.js';
import { PRIORITY, STATUS, TYPES } from '../lib/format.js';

const VIEWS = { assigned_to_me: 'Assigned to me', unassigned_urgent: 'Unassigned urgent', awaiting_my_approval: 'Awaiting my approval' };
const LIMIT = 25;

export default function ItemsPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const get = (k) => params.get(k) ?? '';
  const [q, setQ] = useState(get('q'));
  const [cursors, setCursors] = useState([]); // stack of cursors; [] = first page
  const teams = useTeams();
  const users = useUsers();

  const filters = {
    view: get('view'), status: get('status'), priority: get('priority'), type: get('type'),
    assignee: get('assignee'), teamId: get('teamId'), q: get('q'),
    limit: LIMIT, cursor: cursors[cursors.length - 1],
  };
  const { data, isLoading, isFetching, error, refetch } = useItems(filters);

  // Debounce search typing -> URL param (server does the searching).
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== get('q')) setParam('q', q);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function setParam(key, value) {
    // functional form: always starts from the CURRENT url, so a delayed search update can't overwrite newer filters
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
    setCursors([]); // any filter change returns to page 1
  }
  const clear = () => { setParams({}); setQ(''); setCursors([]); };
  const hasFilters = [...params.keys()].length > 0;

  const select = (key, label, options) => (
    <Field label={label} htmlFor={`f-${key}`}>
      <select id={`f-${key}`} className={inputCls} value={get(key)} onChange={(e) => setParam(key, e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Work items</h1>
          {get('view') && <p className="text-sm text-muted">View: {VIEWS[get('view')]}</p>}
        </div>
        <Button variant="primary" icon={Plus} onClick={() => nav('/items/new')}>New item</Button>
      </div>

      <Card>
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} role="search">
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="Search title or ID" htmlFor="f-q">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted" aria-hidden />
                <input id="f-q" className={`${inputCls} pl-8`} placeholder="e.g. refund or OPS-1042" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </Field>
          </div>
          {select('status', 'Status', Object.entries(STATUS).map(([v, s]) => [v, s.label]))}
          {select('priority', 'Priority', Object.entries(PRIORITY).map(([v, s]) => [v, s.label]))}
          {select('type', 'Type', Object.entries(TYPES))}
          {select('teamId', 'Team', (teams.data ?? []).map((t) => [t.id, t.name]))}
          {select('assignee', 'Assignee', [['me', 'Me'], ['unassigned', 'Unassigned'], ...(users.data ?? []).map((u) => [u.id, u.name])])}
          {select('view', 'Dashboard view', Object.entries(VIEWS))}
          {hasFilters && <div className="flex items-end"><Button type="button" onClick={clear}>Clear filters</Button></div>}
        </form>
      </Card>

      <Card>
        {isLoading ? <Spinner /> : error ? <ErrorState error={error} onRetry={refetch} /> : data.data.length === 0 ? (
          <EmptyState title="No work items match">{hasFilters ? 'Try removing a filter or changing your search.' : 'Create the first item to get started.'}</EmptyState>
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : ''}><ItemList items={data.data} /></div>
        )}
        {data && data.data.length > 0 && (
          <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-sm">
            <span className="text-muted">Page {cursors.length + 1} · {data.data.length} shown</span>
            <div className="flex gap-2">
              <Button icon={ChevronLeft} disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>Previous</Button>
              <Button disabled={!data.page.hasMore} onClick={() => setCursors((c) => [...c, data.page.nextCursor])}>Next <ChevronRight className="h-4 w-4" aria-hidden /></Button>
            </div>
          </footer>
        )}
      </Card>
    </div>
  );
}
