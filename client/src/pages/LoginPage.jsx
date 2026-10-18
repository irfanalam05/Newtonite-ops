import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { describeError } from '../lib/api.js';
import { Alert, Button, Field, inputCls } from '../components/ui.jsx';

export default function LoginPage() {
  const { user, login, notice, dismissNotice } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from ?? '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const d = error && describeError(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
        <h1 className="text-lg font-semibold">Newtonite</h1>
        <p className="mb-4 text-sm text-muted">Operations Under Pressure — sign in to continue</p>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {notice && <Alert tone="warn" onClose={dismissNotice}>{notice}</Alert>}
          {error && <Alert tone="danger" title={error.code === 'INVALID_CREDENTIALS' ? 'Sign-in failed' : d.title}>{error.code === 'INVALID_CREDENTIALS' ? 'Incorrect email or password.' : d.message}</Alert>}
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" autoComplete="username" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" type="password" autoComplete="current-password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="w-full">Sign in</Button>
        </form>
        <p className="mt-4 text-xs text-muted">Local demo accounts are listed in the README.</p>
      </div>
    </div>
  );
}
