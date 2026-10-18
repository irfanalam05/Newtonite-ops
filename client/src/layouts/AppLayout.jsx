import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ClipboardList, LayoutDashboard, LogOut, Menu, PlusCircle, Users, X } from 'lucide-react';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { Button } from '../components/ui.jsx';
import { ROLES } from '../lib/format.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/items', label: 'Work items', icon: ClipboardList, end: true },
  { to: '/items/new', label: 'New item', icon: PlusCircle },
  { to: '/teams', label: 'Teams', icon: Users },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const highest = ['admin', 'lead', 'member', 'viewer'].find((r) => user.memberships.some((m) => m.role === r));

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to} to={to} end={end} onClick={() => setOpen(false)}
          className={({ isActive }) => `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-teal text-white' : 'text-slate-300 hover:bg-white/10'}`}
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-56 shrink-0 flex-col bg-navy py-4 md:flex">
        <div className="mb-6 px-6 text-sm font-semibold tracking-wide text-white">NEWTONITE<span className="block text-xs font-normal text-slate-400">Operations Under Pressure</span></div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-navy/50" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-60 flex-col bg-navy py-4">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-3 text-slate-300"><X className="h-5 w-5" /></button>
            <div className="mb-6 px-6 text-sm font-semibold text-white">NEWTONITE</div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between gap-3 border-b border-line bg-white px-4">
          <button className="rounded p-1 hover:bg-slate-100 md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right sm:block"><span className="font-medium text-navy">{user.name}</span> <span className="text-muted">· {ROLES[highest] ?? 'No team'}</span></span>
            <Button variant="ghost" icon={LogOut} onClick={logout}>Sign out</Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
