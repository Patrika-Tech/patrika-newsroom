import { createContext, useContext, useEffect, useState } from 'react';
import { tr } from '../i18n.js';
import { api } from '../api/client.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ── Roles ─────────────────────────────────────────────────────────────────────
export const ROLES = ['Admin', 'State Head', 'Regional Editor', 'Legal'];

// Legacy hardcoded exports — kept so any stray imports don't crash.
// The app now uses live data from the API instead of these.
export const EDITIONS      = ['All', 'Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bhopal', 'Indore', 'Raipur'];
export const STATE_BRANCHES = {};
export const STATES         = ['All'];

// ── Nav access per role ────────────────────────────────────────────────────────
const ACCESS = {
  'Admin':           'all',
  'State Head':      ['home', 'editorial', 'production', 'pages', 'field', 'hr', 'alerts', 'reports', 'tasks', 'correspondent', 'settings', 'feedback'],
  'Regional Editor': ['home', 'editorial', 'production', 'pages', 'field', 'hr', 'alerts', 'reports', 'tasks', 'correspondent', 'settings', 'feedback'],
  'Legal':           ['legal', 'settings'],
  // Digital team: access only their own tracker tab
  'Digital User':    ['digital_tracker'],
};

export function AppProvider({ children }) {
  const [theme,     setTheme]     = useState(() => localStorage.getItem('pk_theme')  || 'light');
  const [lang,      setLang]      = useState(() => localStorage.getItem('pk_lang')   || 'en');
  const [state,     _setState]    = useState(() => localStorage.getItem('pk_state')  || 'All');
  const [branch,    _setBranch]   = useState(() => localStorage.getItem('pk_branch') || 'All');
  const [locations, setLocations] = useState({ states: [], branchesByState: {} });

  const edition    = branch;
  const setEdition = (v) => _setBranch(v); // legacy alias for branch

  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pk_user')); } catch { return null; }
  });

  // ── Load locations from API whenever a user is logged in ─────────────────
  useEffect(() => {
    if (!user) return;
    api.listLocations()
      .then(setLocations)
      .catch(() => setLocations({ states: [], branchesByState: {} }));
  }, [user?.role]); // reload when role changes (e.g. after edit)

  // ── Lock state/branch based on role when user changes ────────────────────
  useEffect(() => {
    if (!user) return;
    if (user.role === 'State Head' && user.state) {
      _setState(user.state);
      _setBranch('All');
    } else if (user.role === 'Regional Editor') {
      if (user.state)  _setState(user.state);
      if (user.branch) _setBranch(user.branch);
    }
  }, [user?.role, user?.state, user?.branch]); // eslint-disable-line

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pk_theme', theme);
  }, [theme]);
  useEffect(() => localStorage.setItem('pk_lang',   lang),   [lang]);
  useEffect(() => localStorage.setItem('pk_state',  state),  [state]);
  useEffect(() => localStorage.setItem('pk_branch', branch), [branch]);

  const login = (u) => {
    setUser(u);
    localStorage.setItem('pk_user', JSON.stringify(u));
  };
  const logout = () => {
    setUser(null);
    localStorage.removeItem('pk_user');
    localStorage.removeItem('pk_token');
    _setState('All');
    _setBranch('All');
    setLocations({ states: [], branchesByState: {} });
  };

  const t = (path) => tr(lang, path);

  // ── Role helpers ──────────────────────────────────────────────────────────
  const isAdmin            = () => user?.role === 'Admin';
  const isStateRestricted  = () => ['State Head', 'Regional Editor'].includes(user?.role);
  const isBranchRestricted = () => user?.role === 'Regional Editor';

  // ── Role-filtered available states ────────────────────────────────────────
  // Admin → All + every state from DB
  // State Head → only their assigned state (no 'All' option, it's locked)
  // Regional Editor → only their assigned state (locked)
  // Others (Legal) → All + every state
  const availableStates = (() => {
    const allStates = locations.states;
    if (!user) return ['All', ...allStates];
    if (user.role === 'State Head')      return user.state ? [user.state] : allStates;
    if (user.role === 'Regional Editor') return user.state ? [user.state] : allStates;
    return ['All', ...allStates]; // Admin, Legal
  })();

  // ── Role-filtered branches for the currently selected state ───────────────
  // Admin / State Head → All + every branch for that state
  // Regional Editor → only their assigned branch (locked)
  const branches = (() => {
    if (!user) return ['All'];
    if (user.role === 'Regional Editor') {
      return user.branch ? [user.branch] : ['All'];
    }
    if (state === 'All') return ['All'];
    const stateBranches = locations.branchesByState[state] || [];
    return ['All', ...stateBranches];
  })();

  // ── Get branches for any given state (used by filter dropdowns in pages) ──
  const getBranchesForState = (s) => {
    if (!s || s === 'All') return ['All'];
    if (user?.role === 'Regional Editor') return user.branch ? [user.branch] : ['All'];
    const stateBranches = locations.branchesByState[s] || [];
    return ['All', ...stateBranches];
  };

  // ── State/branch setters — respect role locks ─────────────────────────────
  const setState = (val) => {
    if (isStateRestricted()) return;
    _setState(val);
    _setBranch('All');
  };
  const setBranch = (val) => {
    if (isBranchRestricted()) return;
    _setBranch(val);
  };

  const isDigitalUser  = () => user?.source === 'digital';
  const isDigitalAdmin = () => isDigitalUser() && user?.digital_role === 'digital_admin';
  const isTeamLead     = () => isDigitalUser() && user?.digital_role === 'team_lead';

  const canAccess    = (key) => {
    if (!user) return false;
    // Admin newsroom users can also see digital_tracker
    if (user.role === 'Admin') return true;
    const a = ACCESS[user.role] || [];
    return a === 'all' || a.includes(key);
  };
  const canViewHr      = () => ['Admin', 'State Head', 'Regional Editor'].includes(user?.role);
  const canEditHr      = () => ['Admin', 'State Head'].includes(user?.role);
  const canEditGrading = () => ['Admin', 'State Head', 'Regional Editor'].includes(user?.role);
  const canEditTraining= () => ['Admin', 'State Head', 'Regional Editor'].includes(user?.role);
  const canEditLegal   = () => ['Admin', 'Legal'].includes(user?.role);

  return (
    <AppCtx.Provider value={{
      theme, setTheme, lang, setLang,
      state, setState,
      branch, setBranch,
      edition, setEdition,
      branches,
      availableStates,
      getBranchesForState,
      locations,
      user, login, logout, t,
      canAccess, isAdmin,
      isStateRestricted, isBranchRestricted,
      canViewHr, canEditHr, canEditGrading, canEditTraining, canEditLegal,
      isDigitalUser, isDigitalAdmin, isTeamLead,
    }}>
      {children}
    </AppCtx.Provider>
  );
}
