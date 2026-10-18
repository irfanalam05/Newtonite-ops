import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, Lock, RefreshCw, SearchX, WifiOff, X } from 'lucide-react';
import { describeError } from '../lib/api.js';
import { PRIORITY, STATUS, TYPES } from '../lib/format.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'secondary', loading = false, icon: Icon, children, className, disabled, ...rest }) {
  const styles = {
    primary: 'bg-teal text-white hover:bg-teal-dark border-transparent',
    secondary: 'bg-white text-ink border-line hover:bg-canvas',
    danger: 'bg-danger text-white hover:bg-danger/90 border-transparent',
    ghost: 'bg-transparent text-ink border-transparent hover:bg-slate-100',
  };
  return (
    <button
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60', styles[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export const Card = ({ title, actions, children, className }) => (
  <section className={cx('rounded-lg border border-line bg-white', className)}>
    {(title || actions) && (
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        {title && <h2 className="text-sm font-semibold">{title}</h2>}
        {actions}
      </header>
    )}
    {children}
  </section>
);

export const StatusBadge = ({ status }) => (
  <span className={cx('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', STATUS[status]?.cls)}>{STATUS[status]?.label ?? status}</span>
);
export const PriorityBadge = ({ priority }) => (
  <span className={cx('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', PRIORITY[priority]?.cls)}>{PRIORITY[priority]?.label ?? priority}</span>
);
export const TypeLabel = ({ type }) => <span className="text-xs text-muted">{TYPES[type] ?? type}</span>;

export const inputCls = 'w-full rounded-md border border-line bg-white px-3 py-1.5 text-sm text-ink placeholder:text-muted disabled:bg-canvas';

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted" role="status">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
  </div>
);

export function Alert({ tone = 'info', title, children, onClose, actions }) {
  const tones = {
    info: 'border-info/30 bg-info/5 text-info',
    warn: 'border-warn/30 bg-warn/5 text-warn',
    danger: 'border-danger/30 bg-danger/5 text-danger',
    success: 'border-success/30 bg-success/5 text-success',
  };
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div role="alert" className={cx('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', tones[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink">{children}</div>
        {actions && <div className="mt-2 flex gap-2">{actions}</div>}
      </div>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5"><X className="h-4 w-4" /></button>}
    </div>
  );
}

/** Error panel for failed loads: distinguishes network, unavailable, forbidden and not-found states. */
export function ErrorState({ error, onRetry }) {
  const d = describeError(error);
  const Icon = { network: WifiOff, unavailable: WifiOff, forbidden: Lock, notfound: SearchX }[d.kind] ?? AlertTriangle;
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center" role="alert">
      <Icon className="h-8 w-8 text-muted" aria-hidden />
      <h2 className="text-base font-semibold">{d.title}</h2>
      <p className="max-w-md text-sm text-muted">{d.message}</p>
      {onRetry && d.kind !== 'notfound' && d.kind !== 'forbidden' && <Button icon={RefreshCw} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export const EmptyState = ({ title, children }) => (
  <div className="flex flex-col items-center gap-1 p-10 text-center">
    <Inbox className="h-8 w-8 text-muted" aria-hidden />
    <h3 className="text-sm font-semibold">{title}</h3>
    {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
  </div>
);

export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, loading, danger }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <h2 id="dlg-title" className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-ink">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button autoFocus onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

// ---- toasts
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => <Alert key={t.id} tone={t.tone} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>{t.message}</Alert>)}
      </div>
    </ToastCtx.Provider>
  );
}
