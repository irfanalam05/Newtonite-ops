import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 7, name: 'Me' } }) }));
vi.mock('../../lib/api.js', async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));

import { ApiError, api } from '../../lib/api.js';
import { useClaim } from './hooks.js';

const before = { id: 1, version: 1, assigneeId: null, assigneeName: null, permissions: { claim: true, transitions: [] } };

let qc, reject, wrapper;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['item', 1], before);
  api.mockReset();
  api.mockImplementation(() => new Promise((_, rej) => { reject = rej; })); // we decide when the "server" answers
  wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
});

describe('optimistic claim reconciliation', () => {
  it('shows the claim immediately, then adopts the server\'s latest item on 409', async () => {
    const { result } = renderHook(() => useClaim(1), { wrapper });
    act(() => { result.current.mutate(undefined, { onError: () => {} }); });
    await waitFor(() => expect(qc.getQueryData(['item', 1]).assigneeId).toBe(7)); // optimistic
    await waitFor(() => expect(api).toHaveBeenCalled()); // request is in flight

    const latest = { ...before, version: 2, assigneeId: 9, assigneeName: 'Other', permissions: { claim: false, transitions: [] } };
    await act(async () => { reject(new ApiError(409, 'ALREADY_CLAIMED', 'taken', { current: latest })); });
    await waitFor(() => expect(qc.getQueryData(['item', 1]).assigneeId).toBe(9)); // reconciled, not left optimistic
  });

  it('rolls back to the previous state when the server rejects with 403', async () => {
    const { result } = renderHook(() => useClaim(1), { wrapper });
    act(() => { result.current.mutate(undefined, { onError: () => {} }); });
    await waitFor(() => expect(qc.getQueryData(['item', 1]).assigneeId).toBe(7));
    await waitFor(() => expect(api).toHaveBeenCalled());
    await act(async () => { reject(new ApiError(403, 'FORBIDDEN', 'no')); });
    await waitFor(() => expect(qc.getQueryData(['item', 1])).toEqual(before));
  });
});
