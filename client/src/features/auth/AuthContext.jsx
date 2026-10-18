import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getToken, setToken, setUnauthorizedHandler } from '../../lib/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [notice, setNotice] = useState(null);

  const clear = useCallback((message) => {
    setToken(null);
    setUser(null);
    qc.clear();
    if (message) setNotice(message);
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => clear('Your session has expired. Please sign in again.'));
    if (!getToken()) return;
    api('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [clear]);

  const value = useMemo(() => ({
    user, booting, notice,
    dismissNotice: () => setNotice(null),
    async login(email, password) {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(r.data.token);
      setNotice(null);
      setUser(r.data.user);
    },
    logout: () => clear(),
    /** Highest-privilege helpers derived from memberships (UI hints only; the server enforces). */
    roleIn: (teamId) => user?.memberships.find((m) => m.teamId === teamId)?.role ?? null,
  }), [user, booting, notice, clear]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
