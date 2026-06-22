import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, PenLine, Factory, Newspaper, Users, Scale, Archive,
  Sparkles, Bell, BarChart3, Settings, MessageSquare, ClipboardList, Menu, X, Moon, Sun, Globe, LogOut, ChevronDown, Lock, Radio, Mic2, Wand2
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { Logo } from './UI.jsx';

const NAV = [
  { key: 'home',       to: '/',           icon: LayoutDashboard },
  { key: 'editorial',  to: '/editorial',  icon: PenLine },
  { key: 'production', to: '/production', icon: Factory },
  { key: 'pages',      to: '/pages',      icon: Newspaper },
  { key: 'field',      to: '/field',      icon: Radio },
  { key: 'hr',         to: '/hr',         icon: Users },
  { key: 'legal',      to: '/legal',      icon: Scale },
  { key: 'archive',    to: '/archive',    icon: Archive },
  { key: 'ai',         to: '/ai',         icon: Sparkles },
  { key: 'alerts',     to: '/alerts',     icon: Bell },
  { key: 'reports',    to: '/reports',    icon: BarChart3 },
  { key: 'tasks',          to: '/tasks',          icon: ClipboardList },
  { key: 'correspondent',  to: '/correspondent',  icon: Mic2  },
  { key: 'news-generator', to: '/news-generator', icon: Wand2 },
  { key: 'feedback',       to: '/feedback',       icon: MessageSquare },
  { key: 'settings',   to: '/settings',   icon: Settings },
];

export default function Layout({ children }) {
  const {
    t, user, logout, theme, setTheme, lang, setLang,
    state, setState, branch, setBranch,
    branches, availableStates, canAccess,
    isStateRestricted, isBranchRestricted,
  } = useApp();

  const [open, setOpen] = useState(false);
  const nav  = useNavigate();
  const items = NAV.filter((n) => canAccess(n.key));

  const stateLocked  = isStateRestricted();
  const branchLocked = isBranchRestricted();

  const Side = (
    <aside className="flex h-full w-64 shrink-0 flex-col surface border-r" style={{ borderColor: 'var(--border)' }}>
      <div className="brand-bar h-1.5 w-full" />
      <div className="flex items-center justify-between px-4 py-4">
        <Logo />
        <button className="md:hidden" onClick={() => setOpen(false)}><X size={20} /></button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {items.map(({ key, to, icon: Icon }) => (
          <NavLink key={key} to={to} end={to === '/'} onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            style={({ isActive }) => isActive ? { background: 'var(--brand)' } : { color: 'var(--text)' }}>
            <Icon size={18} /> {t('nav.' + key)}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        v0.1 · {user?.role}
        {user?.state  && <span> · {user.state}</span>}
        {user?.branch && <span> · {user.branch}</span>}
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:block">{Side}</div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{Side}</div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b px-4 py-3 surface" style={{ borderColor: 'var(--border)' }}>
          <button className="md:hidden" onClick={() => setOpen(true)}><Menu size={22} /></button>

          {/* ── State + Branch filter ──────────────────────────────────── */}
          <div className="flex items-center gap-2">
            {/* State dropdown */}
            <div className="relative">
              {stateLocked ? (
                <div className="flex items-center gap-1.5 input py-1.5 text-sm font-semibold pr-7 opacity-80 cursor-not-allowed">
                  <Lock size={11} style={{ color: 'var(--muted)' }} />
                  {state}
                </div>
              ) : (
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="input appearance-none pr-7 py-1.5 text-sm font-semibold cursor-pointer"
                >
                  {availableStates.map((s) => <option key={s} value={s}>{s === 'All' ? 'All States' : s}</option>)}
                </select>
              )}
              {!stateLocked && <ChevronDown size={13} className="pointer-events-none absolute right-2 top-2.5" style={{ color: 'var(--muted)' }} />}
            </div>

            {/* Branch dropdown */}
            <div className="relative">
              {branchLocked ? (
                <div className="flex items-center gap-1.5 input py-1.5 text-sm font-semibold pr-7 opacity-80 cursor-not-allowed">
                  <Lock size={11} style={{ color: 'var(--muted)' }} />
                  {branch}
                </div>
              ) : (
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={state === 'All'}
                  className="input appearance-none pr-7 py-1.5 text-sm font-semibold cursor-pointer disabled:opacity-40"
                >
                  {branches.map((b) => <option key={b} value={b}>{b === 'All' ? 'All Branches' : b}</option>)}
                </select>
              )}
              {!branchLocked && <ChevronDown size={13} className="pointer-events-none absolute right-2 top-2.5" style={{ color: 'var(--muted)' }} />}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost px-2.5 py-1.5" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')} title="Language">
              <Globe size={16} /> {lang === 'en' ? 'EN' : 'हिं'}
            </button>
            <button className="btn-ghost px-2.5 py-1.5" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Theme">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1" style={{ background: 'var(--bg)' }}>
              <span className="grid h-7 w-7 place-items-center rounded-full text-white text-sm font-bold" style={{ background: 'var(--brand)' }}>
                {user?.avatar || user?.name?.[0] || 'U'}
              </span>
              <div className="hidden sm:block leading-tight">
                <div className="text-xs font-semibold">{user?.name}</div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{user?.role}</div>
              </div>
              <button onClick={() => { logout(); nav('/login'); }} title={t('logout')} className="ml-1">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
