import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const qs = (params) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && u.set(k, v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard').then((r) => r.data), refetchInterval: 30_000 });

export const useItems = (filters) =>
  useQuery({ queryKey: ['items', filters], queryFn: () => api(`/items${qs(filters)}`), placeholderData: keepPreviousData });

export const useItem = (id) =>
  useQuery({ queryKey: ['item', id], queryFn: () => api(`/items/${id}`).then((r) => r.data), refetchInterval: 15_000, retry: (n, e) => e.status >= 500 && n < 2 });

export const useActivity = (id) =>
  useQuery({ queryKey: ['activity', id], queryFn: () => api(`/items/${id}/activity?limit=200`), refetchInterval: 15_000 });

export const useTeams = () => useQuery({ queryKey: ['teams'], queryFn: () => api('/teams').then((r) => r.data), staleTime: 60_000 });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api('/users').then((r) => r.data), staleTime: 60_000 });

/** After any mutation (success OR failure) re-sync everything that could have changed. */
function useRefresh(id) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['item', id] });
    qc.invalidateQueries({ queryKey: ['activity', id] });
    qc.invalidateQueries({ queryKey: ['items'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

/** On 409 the server returns the latest authorised item; adopt it so the UI is never stale. */
function adoptCurrent(qc, id, err) {
  if (err?.body?.current) qc.setQueryData(['item', id], err.body.current);
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }) => api('/items', { method: 'POST', body: input, headers: { 'Idempotency-Key': key } }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useUpdateItem(id) {
  const qc = useQueryClient();
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (input) => api(`/items/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
    onSuccess: (item) => qc.setQueryData(['item', id], item),
    onError: (err) => adoptCurrent(qc, id, err),
    onSettled: refresh,
  });
}

/** Optimistic: show the claim immediately, roll back and show the server's reason if rejected. */
export function useClaim(id) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: () => api(`/items/${id}/claim`, { method: 'POST', body: {} }).then((r) => r.data),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['item', id] });
      const previous = qc.getQueryData(['item', id]);
      if (previous) {
        qc.setQueryData(['item', id], {
          ...previous, assigneeId: user.id, assigneeName: user.name,
          permissions: { ...previous.permissions, claim: false },
        });
      }
      return { previous };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['item', id], ctx.previous); // roll back
      adoptCurrent(qc, id, err); // then reconcile with the server's latest state if provided
    },
    onSuccess: (item) => qc.setQueryData(['item', id], item),
    onSettled: refresh,
  });
}

export function useTransition(id) {
  const qc = useQueryClient();
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: ({ to, expectedVersion }) => api(`/items/${id}/transition`, { method: 'POST', body: { to, expectedVersion } }).then((r) => r.data),
    onSuccess: (item) => qc.setQueryData(['item', id], item),
    onError: (err) => adoptCurrent(qc, id, err),
    onSettled: refresh,
  });
}

export function useComment(id) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body) => api(`/items/${id}/comments`, { method: 'POST', body: { body } }).then((r) => r.data),
    onSettled: refresh,
  });
}
