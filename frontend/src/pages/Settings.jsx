import { useEffect, useState, useRef } from 'react';
import { Plus, Edit2, Trash2, X, Save, Loader2, Users, Lock, RefreshCw, UserCheck, UserX, ShieldCheck, Search, ChevronLeft, ChevronRight, Zap, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { useApp, ROLES } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

const ROLE_BADGE = {
  'Admin':           'high',
  'State Head':      'med',
  'Regional Editor': 'active',
  'Legal':           'low',
};

// Which roles need a state / branch assignment
const NEEDS_STATE  = ['State Head', 'Regional Editor'];
const NEEDS_BRANCH = ['Regional Editor'];

export default function Settings() {
  const { t, theme, setTheme, lang, setLang, user, isAdmin } = useApp();

  return (
    <div>
      <PageHeader title={t('nav.settings')} subtitle="Preferences · account · user management" />
      <div className="space-y-4">

        {/* ── Appearance + Account ─────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="Appearance">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Theme</span>
                <div className="flex gap-2">
                  {['light', 'dark'].map((m) => (
                    <button key={m} className={theme === m ? 'btn-primary px-3 py-1.5' : 'btn-ghost px-3 py-1.5'} onClick={() => setTheme(m)}>{m}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Language</span>
                <div className="flex gap-2">
                  {[['en', 'English'], ['hi', 'हिंदी']].map(([code, lbl]) => (
                    <button key={code} className={lang === code ? 'btn-primary px-3 py-1.5' : 'btn-ghost px-3 py-1.5'} onClick={() => setLang(code)}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="My Account">
            <div className="space-y-2 text-sm">
              <Row label="Name"   value={user?.name} />
              <Row label="Role"   value={<Badge tone={ROLE_BADGE[user?.role] || 'med'}>{user?.role}</Badge>} />
              {user?.state  && <Row label="State"  value={user.state} />}
              {user?.branch && <Row label="Branch" value={user.branch} />}
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
              To change your password or role, contact the Admin.
            </p>
          </SectionCard>
        </div>

        {/* ── User Management — Admin only ─────────────────────────────── */}
        {isAdmin() && <UserManagement />}

        {/* ── Digital Users — Admin only ───────────────────────────────── */}
        {isAdmin() && <DigitalUserSection />}

        {/* ── Logs (Login + Activity) — Admin only ─────────────────────── */}
        {isAdmin() && <AdminLogs />}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// User Management (Admin only)
// ─────────────────────────────────────────────────────────────────────────────
function UserManagement() {
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null); // null | 'add' | {user object}
  const [deleting,   setDeleting]   = useState(null);
  const [toggling,   setToggling]   = useState(null);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [locations,  setLocations]  = useState({ states: [], branchesByState: {} });
  const [filterStatus, setFilterStatus] = useState('all'); // all | active | inactive

  const load = () => {
    setLoading(true);
    api.listUsers().then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    api.listLocations().then(setLocations).catch(() => {});
  }, []);

  const handleSave = async (data, id) => {
    if (id) {
      const updated = await api.updateUser(id, data);
      setUsers(prev => prev.map(u => u.id === id ? updated : u));
    } else {
      const created = await api.createUser(data);
      setUsers(prev => [...prev, created]);
    }
    setModal(null);
  };

  const handleDelete = async (u) => {
    if (!confirm(`Delete user "${u.name}" (${u.username})? This cannot be undone.`)) return;
    setDeleting(u.id);
    try {
      await api.deleteUser(u.id);
      setUsers(prev => prev.filter(x => x.id !== u.id));
    } catch (e) { alert('Error: ' + e.message); }
    setDeleting(null);
  };

  const toggleActive = async (u) => {
    setToggling(u.id);
    try {
      const updated = await api.updateUser(u.id, { is_active: u.is_active ? 0 : 1 });
      setUsers(prev => prev.map(x => x.id === u.id ? updated : x));
    } catch (e) { alert('Error: ' + e.message); }
    setToggling(null);
  };

  const handleSync = async () => {
    if (!confirm('Sync will create/update login accounts for all State Head and RE employees from the HR table. Continue?')) return;
    setSyncing(true); setSyncResult(null);
    try {
      const result = await api.syncUsers();
      setSyncResult(result);
      load(); // refresh list
    } catch (e) {
      setSyncResult({ ok: false, error: e.message });
    }
    setSyncing(false);
  };

  const displayed = users.filter(u => {
    if (filterStatus === 'active')   return u.is_active !== 0;
    if (filterStatus === 'inactive') return u.is_active === 0;
    return true;
  });

  const activeCount   = users.filter(u => u.is_active !== 0).length;
  const inactiveCount = users.filter(u => u.is_active === 0).length;

  return (
    <SectionCard
      title={`User Management (${users.length})`}
      action={
        <div className="flex items-center gap-2">
          {/* Sync from HR button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition"
            style={{ background: '#6366f1', color: '#fff', opacity: syncing ? 0.7 : 1 }}
            title="Sync State Head & RE accounts from HR employee table"
          >
            {syncing
              ? <><Loader2 size={13} className="animate-spin" /> Syncing…</>
              : <><RefreshCw size={13} /> Sync from HR</>}
          </button>
          <button onClick={() => setModal('add')} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={14} /> Add User
          </button>
        </div>
      }
    >
      <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
        Manage who can access the system. State Head → locked to their state; Regional Editor → locked to state + branch.
        <br />Username = PAN No · Default password = PAN No (user should change after first login).
      </p>

      {/* Sync result banner */}
      {syncResult && (
        <div className="mb-3 rounded-xl p-3 text-sm"
          style={{
            background: syncResult.error ? '#d7192015' : '#10b98115',
            border:     `1px solid ${syncResult.error ? '#d7192030' : '#10b98130'}`,
          }}>
          {syncResult.error
            ? <p style={{ color: '#d71920' }}>❌ Sync error: {syncResult.error}</p>
            : <p style={{ color: '#10b981' }}>
                ✅ Sync complete — <strong>{syncResult.total}</strong> employees processed:&nbsp;
                <strong>{syncResult.created}</strong> created,&nbsp;
                <strong>{syncResult.updated}</strong> updated
              </p>
          }
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-3">
        {[
          ['all',      `All (${users.length})`],
          ['active',   `Active (${activeCount})`],
          ['inactive', `Inactive (${inactiveCount})`],
        ].map(([val, lbl]) => (
          <button key={val} onClick={() => setFilterStatus(val)}
            className="px-3 py-1 rounded-lg text-xs font-medium transition"
            style={{
              background: filterStatus === val ? 'var(--brand)' : 'var(--bg)',
              color:      filterStatus === val ? '#fff' : 'var(--muted)',
            }}>
            {lbl}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading users…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="p-2">Name</th>
                <th className="p-2">Username (PAN)</th>
                <th className="p-2">Role</th>
                <th className="p-2">State</th>
                <th className="p-2">Branch</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No users found.</td></tr>
              )}
              {displayed.map(u => {
                const isActive = u.is_active !== 0;
                return (
                  <tr key={u.id}
                    className="border-t hover:bg-black/5 transition"
                    style={{
                      borderColor: 'var(--border)',
                      opacity: isActive ? 1 : 0.55,
                    }}>
                    <td className="p-2 font-semibold">{u.name}</td>
                    <td className="p-2 font-mono text-xs">{u.username}</td>
                    <td className="p-2"><Badge tone={ROLE_BADGE[u.role] || 'med'}>{u.role}</Badge></td>
                    <td className="p-2">
                      {u.state
                        ? <span className="flex items-center gap-1 text-xs"><Lock size={10} style={{ color: 'var(--muted)' }} />{u.state}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td className="p-2">
                      {u.branch
                        ? <span className="flex items-center gap-1 text-xs"><Lock size={10} style={{ color: 'var(--muted)' }} />{u.branch}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={toggling === u.id}
                        title={isActive ? 'Click to deactivate' : 'Click to activate'}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition"
                        style={{
                          background: isActive ? '#10b98120' : '#d7192015',
                          color:      isActive ? '#10b981'   : '#d71920',
                          cursor: 'pointer',
                        }}>
                        {toggling === u.id
                          ? <Loader2 size={11} className="animate-spin" />
                          : isActive
                            ? <><UserCheck size={11} /> Active</>
                            : <><UserX    size={11} /> Inactive</>}
                      </button>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setModal(u)} className="hover:opacity-70" style={{ color: 'var(--brand)' }}>
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={deleting === u.id}
                          className="hover:opacity-70"
                          style={{ color: '#d71920' }}>
                          {deleting === u.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserModal
          user={modal === 'add' ? null : modal}
          locations={locations}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for log tables
// ─────────────────────────────────────────────────────────────────────────────
const fmtDate = (dt) => dt
  ? new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

function LogPager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-3 pt-3 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)' }}>Page {page} of {pages}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className="btn-ghost px-2 py-1 flex items-center gap-1 disabled:opacity-40">
          <ChevronLeft size={14} /> Prev
        </button>
        <button onClick={() => onPage(p => Math.min(pages, p + 1))} disabled={page === pages}
          className="btn-ghost px-2 py-1 flex items-center gap-1 disabled:opacity-40">
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined Admin Logs (Login + Activity) with tab switcher
// ─────────────────────────────────────────────────────────────────────────────
function AdminLogs() {
  const [tab, setTab] = useState('login'); // 'login' | 'activity'
  return (
    <SectionCard
      title="Admin Logs"
      action={
        <div className="flex gap-1">
          {[['login', 'Login Logs'], ['activity', 'Settings Activity']].map(([val, lbl]) => (
            <button key={val} onClick={() => setTab(val)}
              className="px-3 py-1 rounded-lg text-xs font-medium transition"
              style={{
                background: tab === val ? 'var(--brand)' : 'var(--bg)',
                color:      tab === val ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>
              {lbl}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'login'    && <LoginLogsPanel />}
      {tab === 'activity' && <ActivityLogsPanel />}
    </SectionCard>
  );
}

// ── Login Logs panel ──────────────────────────────────────────────────────────
const LOGIN_STATUS_COLORS = {
  success: { bg: '#10b98115', color: '#10b981', label: 'Success' },
  failed:  { bg: '#f5920015', color: '#f59200', label: 'Failed'  },
  blocked: { bg: '#d7192015', color: '#d71920', label: 'Blocked' },
};

function LoginLogsPanel() {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [page,    setPage]    = useState(1);

  const load = (p) => {
    setLoading(true);
    api.loginLogs({ page: p, limit: 50, search: search || '', status: status || '' })
      .then(d => { setLogs(d.logs || []); setTotal(d.total || 0); setPages(d.pages || 1); })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); load(1); }, [search, status]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input className="input w-full pl-7 text-sm" placeholder="Search username, name, IP…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {[['', 'All'], ['success', 'Success'], ['failed', 'Failed'], ['blocked', 'Blocked']].map(([val, lbl]) => (
            <button key={val} onClick={() => setStatus(val)}
              className="px-3 py-1 rounded-lg text-xs font-medium transition"
              style={{ background: status === val ? 'var(--brand)' : 'var(--bg)', color: status === val ? '#fff' : 'var(--muted)', border: '1px solid var(--border)' }}>
              {lbl}
            </button>
          ))}
        </div>
        <button onClick={() => load(page)} className="btn-ghost px-2 py-1 flex items-center gap-1 text-sm">
          <RefreshCw size={13} />
        </button>
      </div>

      <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Total: {total} records</p>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="p-2">Time</th>
                  <th className="p-2">Username</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Role</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No logs found.</td></tr>
                )}
                {logs.map(l => {
                  const sc = LOGIN_STATUS_COLORS[l.status] || LOGIN_STATUS_COLORS.failed;
                  return (
                    <tr key={l.id} className="border-t hover:bg-black/5 transition" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fmtDate(l.logged_at)}</td>
                      <td className="p-2 font-mono text-xs">{l.username}</td>
                      <td className="p-2 font-semibold">{l.name || '—'}</td>
                      <td className="p-2 text-xs">{l.role || '—'}</td>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ background: sc.bg, color: sc.color }}>
                          <ShieldCheck size={10} /> {sc.label}
                        </span>
                      </td>
                      <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>{l.reason || '—'}</td>
                      <td className="p-2 font-mono text-xs">{l.ip || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LogPager page={page} pages={pages} onPage={setPage} />
        </>
      )}
    </>
  );
}

// ── Activity / Settings Logs panel ────────────────────────────────────────────
const ACTION_META = {
  user_created:    { bg: '#10b98115', color: '#10b981', label: 'User Created'    },
  user_updated:    { bg: '#6366f115', color: '#6366f1', label: 'User Updated'    },
  user_activated:  { bg: '#10b98115', color: '#10b981', label: 'Activated'       },
  user_deactivated:{ bg: '#f5920015', color: '#f59200', label: 'Deactivated'     },
  user_deleted:    { bg: '#d7192015', color: '#d71920', label: 'User Deleted'    },
  users_synced:    { bg: '#0ea5e915', color: '#0ea5e9', label: 'HR Sync'         },
};

function ActivityLogsPanel() {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [action,  setAction]  = useState('');
  const [page,    setPage]    = useState(1);

  const load = (p) => {
    setLoading(true);
    api.activityLogs({ page: p, limit: 50, search: search || '', action: action || '' })
      .then(d => { setLogs(d.logs || []); setTotal(d.total || 0); setPages(d.pages || 1); })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); load(1); }, [search, action]); // eslint-disable-line
  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input className="input w-full pl-7 text-sm" placeholder="Search actor, target, details…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input text-sm" value={action} onChange={e => setAction(e.target.value)}>
          <option value="">All Actions</option>
          {Object.entries(ACTION_META).map(([key, m]) => (
            <option key={key} value={key}>{m.label}</option>
          ))}
        </select>
        <button onClick={() => load(page)} className="btn-ghost px-2 py-1 flex items-center gap-1 text-sm">
          <RefreshCw size={13} />
        </button>
      </div>

      <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Total: {total} records</p>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="p-2">Time</th>
                  <th className="p-2">Admin</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Target</th>
                  <th className="p-2">Details</th>
                  <th className="p-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No activity logs yet.</td></tr>
                )}
                {logs.map(l => {
                  const am = ACTION_META[l.action] || { bg: '#6366f115', color: '#6366f1', label: l.action };
                  return (
                    <tr key={l.id} className="border-t hover:bg-black/5 transition" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fmtDate(l.logged_at)}</td>
                      <td className="p-2">
                        <div className="font-semibold text-xs">{l.actor_name || l.actor}</div>
                        <div className="font-mono text-xs" style={{ color: 'var(--muted)' }}>{l.actor}</div>
                      </td>
                      <td className="p-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ background: am.bg, color: am.color }}>
                          {am.label}
                        </span>
                      </td>
                      <td className="p-2 font-mono text-xs">{l.target || '—'}</td>
                      <td className="p-2 text-xs max-w-xs" style={{ color: 'var(--muted)' }}>{l.details || '—'}</td>
                      <td className="p-2 font-mono text-xs">{l.ip || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LogPager page={page} pages={pages} onPage={setPage} />
        </>
      )}
    </>
  );
}

function UserModal({ user: editUser, locations, onClose, onSave }) {
  const isEdit = !!editUser;
  const [form,   setForm]   = useState({
    name:      editUser?.name      || '',
    username:  editUser?.username  || '',
    password:  '',
    role:      editUser?.role      || 'Regional Editor',
    state:     editUser?.state     || '',
    branch:    editUser?.branch    || '',
    is_active: editUser?.is_active !== 0,  // true = active
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const { states = [], branchesByState = {} } = locations || {};
  const availBranches = form.state ? (branchesByState[form.state] || []) : [];

  const needsState  = NEEDS_STATE.includes(form.role);
  const needsBranch = NEEDS_BRANCH.includes(form.role);

  const set = (k, v) => {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'role')  { next.state = ''; next.branch = ''; }
      if (k === 'state') { next.branch = ''; }
      return next;
    });
  };

  const handleSave = async () => {
    setError('');
    if (!form.name.trim())     return setError('Name is required');
    if (!form.username.trim()) return setError('Username is required');
    if (!isEdit && !form.password) return setError('Password is required for new users');
    if (needsState  && !form.state)  return setError('State is required for this role');
    if (needsBranch && !form.branch) return setError('Branch is required for this role');

    setSaving(true);
    try {
      const payload = {
        name:      form.name,
        username:  form.username,
        role:      form.role,
        state:     form.state  || null,
        branch:    form.branch || null,
        is_active: form.is_active ? 1 : 0,
      };
      if (form.password) payload.password = form.password;
      await onSave(payload, editUser?.id);
    } catch (e) {
      setError(e.message || 'Save failed');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Users size={18} /> {isEdit ? 'Edit User' : 'Add User'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10"><X size={20} /></button>
        </div>

        <div className="space-y-3">

          {/* Name + Username */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1">Full Name *</label>
              <input className="input w-full" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Raj Sharma" />
            </div>
            <div>
              <label className="label mb-1">Username *</label>
              <input className="input w-full" value={form.username} onChange={e => set('username', e.target.value)} placeholder="e.g. r.sharma" disabled={isEdit} />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="label mb-1">Password {isEdit ? '(leave blank to keep current)' : '*'}</label>
            <input className="input w-full" type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          </div>

          {/* Role */}
          <div>
            <label className="label mb-1">Role *</label>
            <select className="input w-full" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {form.role === 'Admin'           && 'Full access — can see and edit everything across all states.'}
              {form.role === 'State Head'      && 'Locked to their state — can see/edit all data within that state.'}
              {form.role === 'Regional Editor' && 'Locked to their state + branch — can see/edit only their edition.'}
              {form.role === 'Legal'           && 'Access to Legal menu only.'}
            </p>
          </div>

          {/* Assigned State — always visible, required for State Head / Regional Editor */}
          <div>
            <label className="label mb-1">
              Assigned State {needsState && <span style={{ color: '#d71920' }}>*</span>}
            </label>
            <select
              className="input w-full"
              value={form.state}
              onChange={e => set('state', e.target.value)}
            >
              <option value="">— Select State —</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Assigned Branch — always visible, required for Regional Editor */}
          <div>
            <label className="label mb-1">
              Assigned Branch {needsBranch && <span style={{ color: '#d71920' }}>*</span>}
            </label>
            <select
              className="input w-full"
              value={form.branch}
              onChange={e => set('branch', e.target.value)}
              disabled={!form.state}
            >
              <option value="">— Select Branch —</option>
              {availBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            {!form.state && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Select a state first</p>
            )}
          </div>

          {/* Account Status */}
          <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div>
              <div className="text-sm font-medium">Account Status</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {form.is_active ? 'Active — user can log in' : 'Inactive — login blocked'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => set('is_active', !form.is_active)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition"
              style={{
                background: form.is_active ? '#10b98120' : '#d7192015',
                color:      form.is_active ? '#10b981'   : '#d71920',
              }}>
              {form.is_active
                ? <><UserCheck size={13} /> Active</>
                : <><UserX    size={13} /> Inactive</>}
            </button>
          </div>

          {error && <p className="text-sm rounded-lg px-3 py-2" style={{ color: '#d71920', background: '#d7192015' }}>{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary flex items-center gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> {isEdit ? 'Update' : 'Create User'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Digital Users Section (Admin only — quick upload shortcut from Settings)
// ─────────────────────────────────────────────────────────────────────────────
function DigitalUserSection() {
  const ref1 = useRef(), ref2 = useRef();
  const [r1, setR1] = useState(null), [e1, setE1] = useState(''), [b1, setB1] = useState(false);
  const [r2, setR2] = useState(null), [e2, setE2] = useState(''), [b2, setB2] = useState(false);

  const doUpload = async (file, fn, setBusy, setResult, setErr) => {
    setBusy(true); setResult(null); setErr('');
    try { const r = await fn(file); setResult(r); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <SectionCard title="Digital Team Management">
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Upload Excel files to manage digital team users and their monthly UV/PV targets.
        Full management is available in the Digital Tracker tab.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={16} style={{ color: '#2563eb' }} />
            <span className="font-semibold text-sm">Digital Users</span>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Columns: Name, Email, Team, Team Lead, Role (digital_admin/team_lead/individual), CMS ID, Password
          </p>
          <input ref={ref1} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f, api.uploadDigitalUsers, setB1, setR1, setE1); if (ref1.current) ref1.current.value = ''; }} />
          <button className="btn-ghost text-sm flex items-center gap-1.5" style={{ color: '#2563eb' }}
            onClick={() => ref1.current?.click()} disabled={b1}>
            <Upload size={14} /> {b1 ? 'Uploading…' : 'Upload Users Excel'}
          </button>
          {e1 && <div className="mt-1.5 text-xs flex gap-1" style={{ color: '#dc2626' }}><AlertCircle size={12} />{e1}</div>}
          {r1 && <div className="mt-1.5 text-xs flex gap-1" style={{ color: '#16a34a' }}><CheckCircle size={12} />Created: {r1.created} · Updated: {r1.updated} · Skipped: {r1.skipped}</div>}
        </div>

        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} style={{ color: '#7c3aed' }} />
            <span className="font-semibold text-sm">Monthly Targets</span>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Columns: Email, Month (YYYY-MM), UV Target, PV Target, Story Target, Avg Time
          </p>
          <input ref={ref2} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f, api.uploadDigitalTargets, setB2, setR2, setE2); if (ref2.current) ref2.current.value = ''; }} />
          <button className="btn-ghost text-sm flex items-center gap-1.5" style={{ color: '#7c3aed' }}
            onClick={() => ref2.current?.click()} disabled={b2}>
            <Upload size={14} /> {b2 ? 'Uploading…' : 'Upload Targets Excel'}
          </button>
          {e2 && <div className="mt-1.5 text-xs flex gap-1" style={{ color: '#dc2626' }}><AlertCircle size={12} />{e2}</div>}
          {r2 && <div className="mt-1.5 text-xs flex gap-1" style={{ color: '#16a34a' }}><CheckCircle size={12} />Upserted: {r2.upserted} · Skipped: {r2.skipped}</div>}
        </div>
      </div>
    </SectionCard>
  );
}
