/**
 * Digital Tracker — UV / PV / Story count performance dashboard.
 *
 * Roles:
 *   digital_admin   → sees all users, all teams, settings tab (upload Excel)
 *   team_lead       → sees their team members + themselves
 *   individual      → sees only their own data
 *   Admin (newsroom)→ sees all users, all teams, settings tab
 */
import { useEffect, useState, useRef } from 'react';
import {
  Zap, Users, Target, TrendingUp, Upload, Plus, Edit2, Trash2, X, Save,
  ChevronDown, ChevronUp, Search, RefreshCw, FileSpreadsheet, Eye, EyeOff,
  Award, AlertCircle, CheckCircle, Newspaper, Clock, Globe, ExternalLink,
  CalendarDays, ArrowRight, Timer, LayoutList, Users2, Settings, BarChart3,
  Radio, Activity,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { SectionCard } from '../components/UI.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtNum = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-IN');
const pctColor = (p) => {
  if (p === null || p === undefined) return 'var(--muted)';
  if (p >= 90) return '#16a34a';
  if (p >= 60) return '#ca8a04';
  return '#dc2626';
};

function PctBar({ pct }) {
  const p = Math.min(pct || 0, 100);
  return (
    <div className="mt-1 h-1.5 w-full rounded-full" style={{ background: 'var(--border)' }}>
      <div className="h-1.5 rounded-full transition-all" style={{ width: `${p}%`, background: pctColor(pct) }} />
    </div>
  );
}

function MetricCell({ label, target, ach, pct }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: pctColor(pct) }}>{fmtNum(ach)}</div>
      <div className="text-[10px]" style={{ color: 'var(--muted)' }}>/ {fmtNum(target)}</div>
      {pct !== null && <div className="text-[10px] font-semibold" style={{ color: pctColor(pct) }}>{pct}%</div>}
      <PctBar pct={pct} />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="surface rounded-xl p-4 border flex items-center gap-4" style={{ borderColor: 'var(--border)' }}>
      <div className="rounded-lg p-2.5" style={{ background: `${color}18` }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Month picker ───────────────────────────────────────────────────────────────
function monthStr(d) { return d.toISOString().slice(0, 7); }
function prevMonth(m) { const d = new Date(m + '-01'); d.setMonth(d.getMonth() - 1); return monthStr(d); }
function nextMonth(m) { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + 1); return monthStr(d); }
const today = monthStr(new Date());

// ── Tab definitions ────────────────────────────────────────────────────────────
const TABS = [
  {
    key:   'dashboard',
    label: 'Dashboard',
    desc:  'Hourly publishing & editor activity',
    icon:  Activity,
    color: '#2563eb',
    grad:  'linear-gradient(135deg,#2563eb,#1d4ed8)',
    lightBg: '#dbeafe',
    lightFg: '#1d4ed8',
  },
  {
    key:   'breaking',
    label: 'Breaking News',
    desc:  'Manual speed tracker & log',
    icon:  Radio,
    color: '#dc2626',
    grad:  'linear-gradient(135deg,#dc2626,#b91c1c)',
    lightBg: '#fee2e2',
    lightFg: '#b91c1c',
  },
  {
    key:   'settings',
    label: 'Settings',
    desc:  'Users, targets & upload',
    icon:  Settings,
    color: '#7c3aed',
    grad:  'linear-gradient(135deg,#7c3aed,#6d28d9)',
    lightBg: '#ede9fe',
    lightFg: '#6d28d9',
    adminOnly: true,
  },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function DigitalTracker() {
  const { user, isAdmin, isDigitalAdmin } = useApp();
  const canAdmin = isAdmin() || isDigitalAdmin();
  const [tab, setTab] = useState('dashboard');

  const visibleTabs = TABS.filter(t => !t.adminOnly || canAdmin);
  const activeTab   = visibleTabs.find(t => t.key === tab) || visibleTabs[0];

  // Role badge
  const roleLabel = user?.digital_role === 'digital_admin' ? 'Digital Admin'
    : user?.digital_role === 'team_lead' ? 'Team Lead'
    : user?.digital_role === 'individual' ? 'Editor'
    : user?.role || '';

  return (
    <div className="space-y-5">

      {/* ── Hero header ────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%)' }}>
        <div className="px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Logo mark */}
            <div className="rounded-xl p-3 flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}>
              <Activity size={26} style={{ color: '#60a5fa' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white leading-tight">Digital Tracker</h1>
              <p className="text-sm mt-0.5" style={{ color: '#93c5fd' }}>
                patrika.com · real-time publishing monitor
              </p>
            </div>
          </div>
          {/* User badge */}
          <div className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}>
              {(user?.name || 'U')[0].toUpperCase()}
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white truncate" style={{ maxWidth: 130 }}>
                {user?.name || 'User'}
              </div>
              <div className="text-xs" style={{ color: '#93c5fd' }}>{roleLabel}</div>
            </div>
          </div>
        </div>

        {/* ── Tab strip ──────────────────────────────────────────────── */}
        <div className="flex gap-1 px-4 pb-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {visibleTabs.map(t => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="relative flex items-center gap-2.5 px-4 py-3 text-sm font-medium transition-all"
                style={{
                  color:          active ? '#fff' : 'rgba(255,255,255,0.55)',
                  borderBottom:   active ? `2.5px solid ${t.color === '#dc2626' ? '#f87171' : t.color === '#7c3aed' ? '#a78bfa' : '#60a5fa'}` : '2.5px solid transparent',
                  marginBottom:   '-1px',
                }}>
                <span className="rounded-md p-1 transition-all"
                  style={{
                    background: active ? (t.color === '#dc2626' ? 'rgba(239,68,68,0.25)' : t.color === '#7c3aed' ? 'rgba(124,58,237,0.25)' : 'rgba(37,99,235,0.25)') : 'transparent',
                  }}>
                  <t.icon size={14} style={{ color: active ? (t.color === '#dc2626' ? '#f87171' : t.color === '#7c3aed' ? '#a78bfa' : '#60a5fa') : 'rgba(255,255,255,0.5)' }} />
                </span>
                {t.label}
                {active && t.key === 'breaking' && (
                  <span className="rounded-full text-[10px] font-bold px-1.5 py-0.5"
                    style={{ background: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                    LIVE
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Active tab description pill ─────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="rounded-lg p-1.5" style={{ background: activeTab.lightBg }}>
          <activeTab.icon size={14} style={{ color: activeTab.lightFg }} />
        </div>
        <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
          {activeTab.desc}
        </span>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && (
        <PatrikaStoriesTab user={user} canAdmin={canAdmin} />
      )}
      {tab === 'breaking' && (
        <BreakingNewsTab user={user} canAdmin={canAdmin} />
      )}
      {tab === 'settings' && canAdmin && (
        <SettingsTab month={today} onRefresh={() => {}} />
      )}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ loading, data, users, search, setSearch,
  totalUVAch, totalUVTgt, totalPVAch, totalPVTgt, totalStAch, totalStTgt, overallPct }) {

  if (loading) return <div className="text-center py-12" style={{ color: 'var(--muted)' }}>Loading…</div>;
  if (!data)   return null;

  const uvPct = totalUVTgt ? Math.round((totalUVAch / totalUVTgt) * 100) : null;
  const pvPct = totalPVTgt ? Math.round((totalPVAch / totalPVTgt) * 100) : null;
  const stPct = totalStTgt ? Math.round((totalStAch / totalStTgt) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Users}    label="Active Members" value={data.users.length} color="#2563eb" />
        <SummaryCard icon={TrendingUp} label="UV Achievement" value={`${uvPct ?? '—'}%`}
          sub={`${fmtNum(totalUVAch)} / ${fmtNum(totalUVTgt)}`} color={pctColor(uvPct)} />
        <SummaryCard icon={Target} label="PV Achievement" value={`${pvPct ?? '—'}%`}
          sub={`${fmtNum(totalPVAch)} / ${fmtNum(totalPVTgt)}`} color={pctColor(pvPct)} />
        <SummaryCard icon={Award} label="Story Achievement" value={`${stPct ?? '—'}%`}
          sub={`${fmtNum(totalStAch)} / ${fmtNum(totalStTgt)}`} color={pctColor(stPct)} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5" style={{ color: 'var(--muted)' }} />
          <input className="input pl-8 py-2 text-sm" placeholder="Search name / team…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {data.wp_enabled && (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#dbeafe', color: '#1e40af' }}>
            WordPress connected
          </span>
        )}
      </div>

      {/* User table */}
      <SectionCard title={`Individual Performance (${users.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 800 }}>
            <thead>
              <tr className="border-b text-left" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Team</th>
                <th className="pb-2 pr-3 font-medium text-center">UV</th>
                <th className="pb-2 pr-3 font-medium text-center">PV</th>
                <th className="pb-2 pr-3 font-medium text-center">Stories</th>
                <th className="pb-2 font-medium text-center">Avg Time</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ '--tw-divide-opacity': 1 }}>
              {users.map(u => (
                <tr key={u.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>{u.mail_id}</div>
                  </td>
                  <td className="py-2.5 pr-4 text-xs">
                    <div>{u.team || '—'}</div>
                    {u.incharge && <div style={{ color: 'var(--muted)' }}>{u.incharge}</div>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <MetricCell label="UV" target={u.uv_target} ach={u.uv_ach} pct={u.uv_pct} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <MetricCell label="PV" target={u.pv_target} ach={u.pv_ach} pct={u.pv_pct} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <MetricCell label="Stories" target={u.story_target} ach={u.story_ach} pct={u.story_pct} />
                  </td>
                  <td className="py-2.5 text-center">
                    <div className="text-sm font-bold">{u.avg_ach ? `${u.avg_ach}s` : '—'}</div>
                    <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      {u.avg_tgt ? `/ ${u.avg_tgt}s` : ''}
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr><td colSpan={6} className="py-8 text-center" style={{ color: 'var(--muted)' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Team Tab ──────────────────────────────────────────────────────────────────
function TeamTab({ loading, data }) {
  if (loading) return <div className="text-center py-12" style={{ color: 'var(--muted)' }}>Loading…</div>;
  if (!data)   return null;

  const teams = data.teams || [];

  return (
    <div className="space-y-4">
      {teams.map(team => (
        <SectionCard key={team.team} title={team.team || 'Ungrouped'}>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <div className="text-center">
              <div className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)' }}>UV</div>
              <div className="text-2xl font-bold" style={{ color: pctColor(team.uv_pct) }}>{team.uv_pct ?? '—'}%</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>{fmtNum(team.uv_ach)} / {fmtNum(team.uv_target)}</div>
              <PctBar pct={team.uv_pct} />
            </div>
            <div className="text-center">
              <div className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)' }}>PV</div>
              <div className="text-2xl font-bold" style={{ color: pctColor(team.pv_pct) }}>{team.pv_pct ?? '—'}%</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>{fmtNum(team.pv_ach)} / {fmtNum(team.pv_target)}</div>
              <PctBar pct={team.pv_pct} />
            </div>
            <div className="text-center">
              <div className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)' }}>Stories</div>
              <div className="text-2xl font-bold" style={{ color: pctColor(team.story_pct) }}>{team.story_pct ?? '—'}%</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>{fmtNum(team.story_ach)} / {fmtNum(team.story_target)}</div>
              <PctBar pct={team.story_pct} />
            </div>
          </div>

          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            Members: {team.members.join(', ')}
          </div>
        </SectionCard>
      ))}
      {!teams.length && <div className="text-center py-8" style={{ color: 'var(--muted)' }}>No team data for this month</div>}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function SettingsTab({ month, onRefresh }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <ExcelUploadCard
          title="Upload Digital Users"
          icon={Users}
          description="Excel columns: Name, Email, Team, Team Lead, Role (digital_admin/team_lead/individual), CMS ID, Password"
          onUpload={api.uploadDigitalUsers}
          onDone={onRefresh}
          color="#2563eb"
        />
        <ExcelUploadCard
          title="Upload UV Targets"
          icon={Target}
          description={`Excel columns: Email, Month (${month}), UV Target, PV Target, Story Target, Avg Time`}
          onUpload={(f) => api.uploadDigitalTargets(f)}
          onDone={onRefresh}
          color="#7c3aed"
        />
      </div>
      <UserManagementCard />
    </div>
  );
}

function ExcelUploadCard({ title, icon: Icon, description, onUpload, onDone, color }) {
  const ref  = useRef();
  const [busy, setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr]     = useState('');

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setResult(null); setErr('');
    try {
      const r = await onUpload(file);
      setResult(r);
      onDone?.();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };

  return (
    <SectionCard title={title}>
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-lg p-2" style={{ background: `${color}18` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{description}</p>
      </div>

      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={upload} />
      <button
        className="btn-ghost flex items-center gap-2 text-sm"
        style={{ color }}
        onClick={() => ref.current?.click()}
        disabled={busy}>
        <Upload size={16} /> {busy ? 'Uploading…' : 'Choose Excel File'}
      </button>

      {err && (
        <div className="mt-2 flex items-center gap-1.5 text-sm" style={{ color: '#dc2626' }}>
          <AlertCircle size={14} /> {err}
        </div>
      )}
      {result && (
        <div className="mt-2 flex items-center gap-1.5 text-sm" style={{ color: '#16a34a' }}>
          <CheckCircle size={14} />
          {result.created !== undefined
            ? `Created: ${result.created} · Updated: ${result.updated} · Skipped: ${result.skipped}`
            : `Upserted: ${result.upserted} · Skipped: ${result.skipped}`}
        </div>
      )}
    </SectionCard>
  );
}

function UserManagementCard() {
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState('');
  const [editing, setEditing] = useState(null);
  const [showPwd, setShowPwd] = useState({});
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try { const d = await api.digitalUsers(); setUsers(d.users || []); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const del = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    try { await api.deleteDigitalUser(id); load(); }
    catch (e) { alert(e.message); }
  };

  const save = async (id, data) => {
    try { await api.updateDigitalUser(id, data); setEditing(null); load(); }
    catch (e) { alert(e.message); }
  };

  const filtered = users.filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.mail_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SectionCard title={`Digital Users (${users.length})`}>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5" style={{ color: 'var(--muted)' }} />
          <input className="input pl-8 py-2 text-sm" placeholder="Search…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-ghost px-2.5 py-2" onClick={load}><RefreshCw size={14} /></button>
      </div>

      {err && <div className="text-sm mb-2" style={{ color: '#dc2626' }}>{err}</div>}

      {loading ? (
        <div className="text-center py-8" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 700 }}>
            <thead>
              <tr className="border-b text-left" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Email</th>
                <th className="pb-2 pr-3 font-medium">Team</th>
                <th className="pb-2 pr-3 font-medium">Role</th>
                <th className="pb-2 pr-3 font-medium">CMS ID</th>
                <th className="pb-2 pr-3 font-medium">Pwd</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {filtered.map(u => (
                editing?.id === u.id
                  ? <EditRow key={u.id} user={u} onSave={save} onCancel={() => setEditing(null)} />
                  : (
                    <tr key={u.id}>
                      <td className="py-2 pr-3 font-medium">{u.name}</td>
                      <td className="py-2 pr-3 text-xs" style={{ color: 'var(--muted)' }}>{u.mail_id}</td>
                      <td className="py-2 pr-3 text-xs">{u.team || '—'}</td>
                      <td className="py-2 pr-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: u.role === 'digital_admin' ? '#dbeafe' : u.role === 'team_lead' ? '#fef9c3' : '#f3f4f6', color: '#374151' }}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{u.cms_id || '—'}</td>
                      <td className="py-2 pr-3 text-xs">{u.has_password ? '✓' : '✗'}</td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          <button className="btn-ghost px-1.5 py-1" onClick={() => setEditing(u)} title="Edit"><Edit2 size={13} /></button>
                          <button className="btn-ghost px-1.5 py-1" onClick={() => del(u.id)} title="Delete" style={{ color: '#dc2626' }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="py-6 text-center" style={{ color: 'var(--muted)' }}>No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function EditRow({ user, onSave, onCancel }) {
  const [form, setForm] = useState({
    name:     user.name || '',
    team:     user.team || '',
    role:     user.role || 'individual',
    incharge: user.incharge || '',
    cms_id:   user.cms_id || '',
    password: '',
    is_emp_working: user.is_emp_working ?? 1,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <tr style={{ background: 'var(--bg-alt, var(--bg))' }}>
      <td className="py-2 pr-2"><input className="input py-1 text-xs w-full" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Name" /></td>
      <td className="py-2 pr-2 text-xs" style={{ color: 'var(--muted)' }}>{user.mail_id}</td>
      <td className="py-2 pr-2"><input className="input py-1 text-xs w-full" value={form.team} onChange={e => set('team', e.target.value)} placeholder="Team" /></td>
      <td className="py-2 pr-2">
        <select className="input py-1 text-xs" value={form.role} onChange={e => set('role', e.target.value)}>
          <option value="individual">individual</option>
          <option value="team_lead">team_lead</option>
          <option value="digital_admin">digital_admin</option>
        </select>
      </td>
      <td className="py-2 pr-2"><input className="input py-1 text-xs w-full" value={form.cms_id} onChange={e => set('cms_id', e.target.value)} placeholder="CMS ID" /></td>
      <td className="py-2 pr-2"><input className="input py-1 text-xs w-full" value={form.password} onChange={e => set('password', e.target.value)} placeholder="New pwd (optional)" type="password" /></td>
      <td className="py-2">
        <div className="flex gap-1">
          <button className="btn-ghost px-1.5 py-1" style={{ color: '#16a34a' }} onClick={() => onSave(user.id, form)}><Save size={13} /></button>
          <button className="btn-ghost px-1.5 py-1" onClick={onCancel}><X size={13} /></button>
        </div>
      </td>
    </tr>
  );
}

// ── Patrika Stories Tab ───────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);

const PATRIKA_CATEGORIES = [
  { value: 'all',             label: 'All Categories' },
  { value: 'breaking-news',   label: 'Breaking News' },
  { value: 'national',        label: 'National' },
  { value: 'crime-news',      label: 'Crime' },
  { value: 'sports-news',     label: 'Sports' },
  { value: 'entertainment',   label: 'Entertainment' },
  { value: 'business',        label: 'Business' },
  { value: 'education-news',  label: 'Education' },
  { value: 'health',          label: 'Health' },
  { value: 'exclusive',       label: 'Exclusive' },
];

// Categories fetched when "All" is selected
const ALL_FETCH_CATS = ['breaking-news', 'national', 'crime-news', 'sports-news', 'entertainment'];

function PatrikaStoriesTab({ user, canAdmin }) {
  const [date, setDate]         = useState(TODAY);
  const [category, setCategory] = useState('all');
  const [liveArts, setLiveArts] = useState([]);
  const [saved, setSaved]       = useState([]);
  const [fetching, setFetching] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [err, setErr]           = useState('');
  const [savedIds, setSavedIds] = useState(new Set());
  const [drafts, setDrafts]     = useState({});
  // Author map: url → author name (fetched in background)
  const [authorMap, setAuthorMap]         = useState({});
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const setDraft = (i, k, v) =>
    setDrafts(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [k]: v } }));

  const loadSaved = async (d) => {
    setLoadingSaved(true);
    try {
      const res = await api.breakingNews({ date: d || date });
      setSaved(res.entries || []);
    } catch (_) {}
    finally { setLoadingSaved(false); }
  };

  // Fetch author names in chunks of 100 so progress updates live
  const fetchAuthors = async (arts) => {
    const urls = arts.map(a => a.url).filter(Boolean);
    if (!urls.length) return;
    setAuthorsLoading(true);
    setAuthorMap({});
    const CHUNK = 100;
    try {
      for (let i = 0; i < urls.length; i += CHUNK) {
        const chunk = urls.slice(i, i + CHUNK);
        const res = await api.batchAuthors(chunk);
        setAuthorMap(prev => ({ ...prev, ...(res.authors || {}) }));
      }
    } catch (_) {}
    finally { setAuthorsLoading(false); }
  };

  const fetchLive = async (d, cat) => {
    setFetching(true); setErr(''); setLiveArts([]); setDrafts({}); setSavedIds(new Set());
    setAuthorMap({}); setAuthorsLoading(false);
    const target = d   || date;
    const useCat = cat || category;
    try {
      if (useCat === 'all') {
        // Use Google News sitemap — returns ALL articles for the date
        const res  = await api.fetchPatrikaByDate(target);
        const arts = res.articles || [];
        setLiveArts(arts);
        if (!arts.length) setErr(`No articles found in sitemap for ${target}.`);
        else fetchAuthors(arts); // background — no await
      } else {
        // Specific category page (up to 10 recent articles)
        const res  = await api.fetchPatrikaArticles(useCat);
        const arts = (res.articles || []).filter(
          a => !a.publish_date || a.publish_date.startsWith(target)
        );
        setLiveArts(arts);
        if (!arts.length) setErr(`No articles found for ${target} in this category.`);
        else fetchAuthors(arts); // background — no await
      }
    } catch (e) { setErr('Fetch: ' + e.message); }
    finally { setFetching(false); }
  };

  // Auto-load both when date or category changes
  useEffect(() => {
    loadSaved(date);
    fetchLive(date, category);
  }, [date, category]); // eslint-disable-line

  const saveRow = async (art, i) => {
    const d = drafts[i] || {};
    try {
      await api.addBreakingNews({
        entry_date:      art.publish_date?.slice(0, 10) || date,
        editor_name:     d.editor_name    !== undefined ? d.editor_name    : (art.author       || ''),
        article_title:   art.title  || '',
        article_url:     art.url    || '',
        time_filed:      d.time_filed     !== undefined ? d.time_filed     : (art.publish_time || ''),
        source_name:     d.source_name    || '',
        source_time:     d.source_time    || null,
        competitor_time: d.competitor_time || null,
        value_addition:  d.value_addition  || '',
        wp_publish_date: art.publish_date  || null,
      });
      setSavedIds(prev => new Set([...prev, i]));
      loadSaved(date);
    } catch (e) { alert(e.message); }
  };

  const catLabel = PATRIKA_CATEGORIES.find(c => c.value === category)?.label || category;
  const isLoading = fetching || loadingSaved;

  // Merged dataset for dashboard (deduplicate by URL)
  const seenUrls = new Set(saved.map(e => e.article_url).filter(Boolean));
  const uniqueLive = liveArts.filter(a => !a.url || !seenUrls.has(a.url));
  const allStories = [
    ...saved.map(e => ({
      name:     e.editor_name  || null,
      time:     e.time_filed?.slice(0, 5) || null,
      title:    e.article_title,
      url:      e.article_url,
      category: null,
      src:      'tracked',
    })),
    ...uniqueLive.map(a => ({
      name:     authorMap[a.url] || a.author || null,  // enriched from batch fetch
      time:     a.publish_time || null,
      title:    a.title,
      url:      a.url,
      category: a.category,
      src:      'live',
    })),
  ];

  const authorsDone  = Object.keys(authorMap).length;
  const authorsTotal = liveArts.length;

  return (
    <div className="space-y-4">

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={14} style={{ color: 'var(--muted)' }} />
          <input type="date" className="input py-1.5 text-sm" value={date} max={TODAY}
            onChange={e => setDate(e.target.value)} />
        </div>
        <select className="input py-1.5 text-sm" style={{ maxWidth: 170 }}
          value={category} onChange={e => setCategory(e.target.value)}>
          {PATRIKA_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        {isLoading && (
          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
            <RefreshCw size={12} className="animate-spin" /> Loading stories…
          </span>
        )}
        {!isLoading && authorsLoading && (
          <span className="text-xs flex items-center gap-1" style={{ color: '#2563eb' }}>
            <RefreshCw size={12} className="animate-spin" />
            Loading editor names… {authorsDone}/{authorsTotal}
          </span>
        )}
        {!isLoading && !authorsLoading && authorsDone > 0 && (
          <span className="text-xs flex items-center gap-1" style={{ color: '#16a34a' }}>
            <Users2 size={12} />
            {authorsDone} editor names loaded
          </span>
        )}
        <button className="btn-ghost px-2.5 py-1.5 ml-auto"
          onClick={() => { loadSaved(date); fetchLive(date, category); }}
          title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {err && (
        <div className="text-sm px-3 py-2 rounded-lg" style={{ color: '#92400e', background: '#fef3c7' }}>
          {err}
        </div>
      )}

      <StoriesDashboard
        allStories={allStories}
        liveArts={liveArts}
        date={date}
        loading={isLoading}
        authorsLoading={authorsLoading}
        authorsDone={authorsDone}
        authorsTotal={authorsTotal}
        authorMap={authorMap}
      />
    </div>
  );
}

// ── Stories Dashboard ─────────────────────────────────────────────────────────
function HeatCell({ count, max }) {
  if (!count) return (
    <div className="rounded flex items-center justify-center mx-auto"
      style={{ width: 34, height: 24, background: 'transparent' }} />
  );
  const r = count / Math.max(max, 1);
  const bg   = r >= 0.7 ? '#15803d' : r >= 0.35 ? '#4ade80' : '#bbf7d0';
  const fg   = r >= 0.7 ? '#fff'    : '#14532d';
  return (
    <div className="rounded flex items-center justify-center mx-auto font-bold text-xs"
      style={{ width: 34, height: 24, background: bg, color: fg }}>
      {count}
    </div>
  );
}

// ── Heatmap legend ────────────────────────────────────────────────────────────
function HeatLegend({ extra }) {
  return (
    <div className="flex items-center gap-3 mt-3 text-xs flex-wrap" style={{ color: 'var(--muted)' }}>
      <span>Stories / hour:</span>
      {[{ bg: '#bbf7d0', label: 'Low' }, { bg: '#4ade80', label: 'Mid' }, { bg: '#15803d', label: 'High' }]
        .map(item => (
          <div key={item.label} className="flex items-center gap-1">
            <div className="rounded" style={{ width: 14, height: 14, background: item.bg }} />
            <span>{item.label}</span>
          </div>
        ))}
      {extra && <span className="ml-auto">{extra}</span>}
    </div>
  );
}

// ── Category accent palette (rotates) ────────────────────────────────────────
const CAT_PALETTE = [
  '#2563eb','#7c3aed','#dc2626','#ea580c','#ca8a04',
  '#16a34a','#0891b2','#db2777','#6366f1','#14b8a6','#f59e0b','#65a30d',
];

// ── Category card ─────────────────────────────────────────────────────────────
function CatCard({ cat, total, maxTotal, color, isSelected, onClick }) {
  const pct = Math.round(total / Math.max(maxTotal, 1) * 100);
  return (
    <button onClick={onClick}
      className="rounded-xl p-3 border flex flex-col gap-2 text-left w-full transition-all"
      style={{
        background:  isSelected ? `${color}10` : 'var(--surface)',
        borderColor: isSelected ? color : 'var(--border)',
        borderWidth: isSelected ? '2px' : '1px',
        borderStyle: 'solid',
      }}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-medium capitalize leading-tight" style={{ color: isSelected ? color : 'var(--muted)' }}>{cat}</p>
        <span className="text-lg font-bold leading-none flex-shrink-0" style={{ color }}>{total}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {pct}% of peak
        <span className="ml-1.5 font-medium" style={{ color }}>
          {pct >= 80 ? '🔥 Top' : pct >= 50 ? '↑ Active' : ''}
        </span>
      </p>
    </button>
  );
}

// ── Editor card ───────────────────────────────────────────────────────────────
function EditorCard({ person, isSelected, onClick }) {
  const initials = person.name.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
  const activeHours = Object.keys(person.hourCounts).length;
  const peakHr = Object.entries(person.hourCounts).sort((a,b) => b[1]-a[1])[0];
  return (
    <button onClick={onClick}
      className="rounded-xl p-3 border text-left w-full transition-all"
      style={{
        background:   isSelected ? '#f0fdf4' : 'var(--surface)',
        borderColor:  isSelected ? '#16a34a'  : 'var(--border)',
        borderWidth:  isSelected ? '2px'      : '1px',
        borderStyle:  'solid',
      }}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="rounded-full w-9 h-9 flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{ background: isSelected ? '#dcfce7' : '#f0fdf4', color: '#15803d' }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate leading-tight">{person.name}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {activeHours} hr{activeHours !== 1 ? 's' : ''} active
            {peakHr ? ` · peak ${peakHr[0].padStart(2,'0')}:00` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-xl font-bold leading-none" style={{ color: '#16a34a' }}>
          {person.stories.length}
        </span>
        <span className="text-xs pb-0.5" style={{ color: 'var(--muted)' }}>stories</span>
      </div>
    </button>
  );
}

// ── Section divider header ────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, color, title, meta, right }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-2">
        <div className="rounded-lg p-1.5" style={{ background: `${color}18` }}>
          <Icon size={15} style={{ color }} />
        </div>
        <span className="font-bold text-sm">{title}</span>
        {meta && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--border)', color: 'var(--muted)' }}>{meta}</span>}
      </div>
      {right && <div className="text-xs" style={{ color: 'var(--muted)' }}>{right}</div>}
    </div>
  );
}

function StoriesDashboard({ allStories, liveArts, date, loading,
  authorsLoading, authorsDone, authorsTotal, authorMap = {} }) {

  const [selectedEditor,   setSelectedEditor]   = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [showCatHeat,      setShowCatHeat]      = useState(false);
  const [showEdHeat,       setShowEdHeat]       = useState(false);

  if (loading && !allStories.length)
    return <div className="text-center py-12" style={{ color: 'var(--muted)' }}>Loading stories from Patrika.com…</div>;

  if (!allStories.length && !loading)
    return (
      <div className="text-center py-12" style={{ color: 'var(--muted)' }}>
        <LayoutList size={32} className="mx-auto mb-2 opacity-25" />
        <p className="text-sm">No stories found for {date}.</p>
        <p className="text-xs mt-1">Change the date or category and wait for auto-load.</p>
      </div>
    );

  // ── Hourly totals ────────────────────────────────────────────────────────
  const hourTotals = {};
  liveArts.forEach(a => {
    if (!a.publish_time) return;
    const hr = parseInt(a.publish_time.split(':')[0], 10);
    if (!isNaN(hr)) hourTotals[hr] = (hourTotals[hr] || 0) + 1;
  });
  const activeHours  = Object.keys(hourTotals).map(Number).sort((a, b) => a - b);
  const maxHourTotal = Math.max(1, ...Object.values(hourTotals));
  const peakHr       = activeHours.reduce((best, h) =>
    (hourTotals[h] || 0) > (hourTotals[best] || 0) ? h : best, activeHours[0]);

  // ── Category breakdown ────────────────────────────────────────────────────
  const byCat = {};
  liveArts.forEach(a => {
    const cat = a.category || 'other';
    if (!byCat[cat]) byCat[cat] = { cat, total: 0, hourCounts: {} };
    byCat[cat].total++;
    if (a.publish_time) {
      const hr = parseInt(a.publish_time.split(':')[0], 10);
      if (!isNaN(hr)) byCat[cat].hourCounts[hr] = (byCat[cat].hourCounts[hr] || 0) + 1;
    }
  });
  const catRows    = Object.values(byCat).sort((a, b) => b.total - a.total);
  const maxCatHour = Math.max(1, ...catRows.flatMap(c => Object.values(c.hourCounts)));
  const maxCatTotal = catRows[0]?.total || 1;

  // ── Editor-wise breakdown ─────────────────────────────────────────────────
  const byPerson = {};
  allStories.filter(s => s.name).forEach(s => {
    if (!byPerson[s.name]) byPerson[s.name] = { name: s.name, stories: [], hourCounts: {} };
    byPerson[s.name].stories.push(s);
    if (s.time) {
      const hr = parseInt(s.time.split(':')[0], 10);
      if (!isNaN(hr)) byPerson[s.name].hourCounts[hr] = (byPerson[s.name].hourCounts[hr] || 0) + 1;
    }
  });
  const persons       = Object.values(byPerson).sort((a, b) => b.stories.length - a.stories.length);
  const maxPersonHour = Math.max(1, ...persons.flatMap(p => Object.values(p.hourCounts)));
  const topEditor     = persons[0];
  const namedCount    = allStories.filter(s => s.name).length;

  const editorStories = selectedEditor
    ? allStories.filter(s => s.name === selectedEditor).sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    : [];

  return (
    <div className="space-y-5">

      {/* ── 4 KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Newspaper} label="Total Stories"
          value={liveArts.length} sub={`Published ${date}`} color="#2563eb" />
        <SummaryCard icon={Globe} label="Categories Active"
          value={catRows.length} sub={`Peak: ${peakHr !== undefined ? String(peakHr).padStart(2,'0')+':00' : '—'}`} color="#7c3aed" />
        <SummaryCard icon={Clock}
          label="Peak Hour"
          value={peakHr !== undefined ? `${String(peakHr).padStart(2, '0')}:00` : '—'}
          sub={peakHr !== undefined ? `${hourTotals[peakHr]} stories` : ''}
          color="#ca8a04" />
        <SummaryCard icon={Users2}
          label="Top Editor"
          value={authorsLoading && !topEditor ? '…' : (topEditor?.name || '—')}
          sub={topEditor ? `${topEditor.stories.length} stories`
            : authorsLoading ? `Loading ${authorsDone}/${authorsTotal}` : '—'}
          color="#16a34a" />
      </div>

      {/* ══ CATEGORY SECTION ══════════════════════════════════════════════ */}
      <div className="space-y-3">
        <SectionHeader
          icon={Globe} color="#7c3aed"
          title="Category Activity"
          meta={`${catRows.length} categories · ${liveArts.length} stories`}
          right={`${date}`}
        />

        {/* Category cards grid */}
        {catRows.length > 0 && (
          <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {catRows.map((c, i) => (
              <CatCard key={c.cat}
                cat={c.cat}
                total={c.total}
                maxTotal={maxCatTotal}
                color={CAT_PALETTE[i % CAT_PALETTE.length]}
                isSelected={selectedCategory === c.cat}
                onClick={() => setSelectedCategory(selectedCategory === c.cat ? null : c.cat)}
              />
            ))}
          </div>
        )}

        {/* Category stories panel */}
        {selectedCategory && (() => {
          const catColor = CAT_PALETTE[catRows.findIndex(c => c.cat === selectedCategory) % CAT_PALETTE.length];
          const catStories = liveArts
            .filter(a => (a.category || 'other') === selectedCategory)
            .sort((a, b) => (a.publish_time || '').localeCompare(b.publish_time || ''));
          return (
            <div className="rounded-xl border overflow-hidden"
              style={{ borderColor: `${catColor}40`, background: 'var(--surface)' }}>
              <div className="flex items-center justify-between px-4 py-3"
                style={{ background: `linear-gradient(90deg,${catColor}0d,${catColor}1a)`, borderBottom: `1px solid ${catColor}30` }}>
                <div className="flex items-center gap-2">
                  <div className="rounded-lg p-1.5" style={{ background: `${catColor}22` }}>
                    <Globe size={14} style={{ color: catColor }} />
                  </div>
                  <div>
                    <p className="font-bold text-sm capitalize" style={{ color: catColor }}>{selectedCategory}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {catStories.length} {catStories.length === 1 ? 'story' : 'stories'} on {date}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedCategory(null)}
                  className="rounded-full p-1 hover:bg-black/5 transition-colors" style={{ color: catColor }}>
                  <X size={16} />
                </button>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {catStories.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-black/[0.02] transition-colors">
                    <span className="text-xs font-mono mt-0.5 flex-shrink-0 tabular-nums"
                      style={{ color: 'var(--muted)', minWidth: 40 }}>
                      {s.publish_time || '—'}
                    </span>
                    <div className="flex-1 min-w-0">
                      {s.url
                        ? <a href={s.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium leading-snug hover:underline line-clamp-2"
                            style={{ color: 'var(--text)' }}>{s.title}</a>
                        : <p className="text-sm font-medium leading-snug line-clamp-2">{s.title}</p>
                      }
                      {(authorMap[s.url] || s.author) && (
                        <span className="text-xs mt-0.5 inline-flex items-center gap-1" style={{ color: '#16a34a' }}>
                          <Users2 size={10} />
                          {authorMap[s.url] || s.author}
                        </span>
                      )}
                    </div>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="flex-shrink-0 mt-0.5 opacity-40 hover:opacity-100 transition-opacity">
                        <ExternalLink size={13} style={{ color: 'var(--muted)' }} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Toggle: hourly heatmap */}
        {activeHours.length > 0 && (
          <>
            <button
              onClick={() => setShowCatHeat(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: '#7c3aed', background: '#7c3aed12', border: '1px solid #7c3aed30' }}>
              <BarChart3 size={12} />
              {showCatHeat ? 'Hide' : 'Show'} Hourly Heatmap
              {showCatHeat ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {showCatHeat && (
              <SectionCard title={
                <span className="flex items-center gap-2">
                  <Globe size={14} style={{ color: '#7c3aed' }} />
                  Category-wise Hourly Publishing — {date}
                </span>
              }>
                <div className="overflow-x-auto">
                  <table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: '2px 3px' }}>
                    <thead>
                      <tr>
                        <th className="text-left pr-4 pb-2 font-semibold whitespace-nowrap"
                          style={{ color: 'var(--muted)', minWidth: 160 }}>Category</th>
                        {activeHours.map(h => (
                          <th key={h} className="pb-2 text-center font-medium"
                            style={{ color: 'var(--muted)', minWidth: 38 }}>
                            {String(h).padStart(2, '0')}
                          </th>
                        ))}
                        <th className="pb-2 pl-4 font-bold text-right" style={{ minWidth: 52 }}>Total</th>
                      </tr>
                      <tr>
                        <td className="pr-4 pb-2 font-semibold" style={{ color: '#7c3aed' }}>All categories</td>
                        {activeHours.map(h => (
                          <td key={h} className="pb-2 text-center">
                            <HeatCell count={hourTotals[h] || 0} max={maxHourTotal} />
                          </td>
                        ))}
                        <td className="pb-2 pl-4 text-right font-bold" style={{ color: '#7c3aed' }}>{liveArts.length}</td>
                      </tr>
                    </thead>
                    <tbody>
                      {catRows.map((c, i) => (
                        <tr key={c.cat}>
                          <td className="pr-4 py-0.5 capitalize whitespace-nowrap flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: CAT_PALETTE[i % CAT_PALETTE.length] }} />
                            {c.cat}
                          </td>
                          {activeHours.map(h => (
                            <td key={h} className="py-0.5 text-center">
                              <HeatCell count={c.hourCounts[h] || 0} max={maxCatHour} />
                            </td>
                          ))}
                          <td className="py-0.5 pl-4 text-right font-semibold" style={{ color: '#7c3aed' }}>
                            {c.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <HeatLegend />
              </SectionCard>
            )}
          </>
        )}
      </div>

      {/* ══ EDITOR SECTION ════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <SectionHeader
          icon={Users2} color="#16a34a"
          title="Editor Activity"
          meta={authorsLoading
            ? `Loading… ${authorsDone}/${authorsTotal}`
            : `${persons.length} editors · ${namedCount} attributed`}
          right={authorsLoading ? (
            <span className="flex items-center gap-1">
              <RefreshCw size={11} className="animate-spin" style={{ color: '#16a34a' }} />
              {Math.round(authorsDone / Math.max(authorsTotal, 1) * 100)}%
            </span>
          ) : null}
        />

        {/* Loading progress bar */}
        {authorsLoading && (
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-1 rounded-full transition-all" style={{
              width: `${authorsTotal ? Math.round(authorsDone / authorsTotal * 100) : 0}%`,
              background: '#16a34a',
            }} />
          </div>
        )}

        {/* Editor cards grid */}
        {persons.length > 0 && (
          <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {persons.map(p => (
              <EditorCard key={p.name}
                person={p}
                isSelected={selectedEditor === p.name}
                onClick={() => setSelectedEditor(selectedEditor === p.name ? null : p.name)}
              />
            ))}
          </div>
        )}

        {!authorsLoading && persons.length === 0 && (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: 'var(--border)' }}>
            <Users2 size={26} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">No editor data yet — try refreshing.</p>
          </div>
        )}

        {/* Editor stories panel */}
        {selectedEditor && (
          <div className="rounded-xl border overflow-hidden"
            style={{ borderColor: '#16a34a40', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ background: 'linear-gradient(90deg,#f0fdf4,#dcfce7)', borderBottom: '1px solid #bbf7d0' }}>
              <div className="flex items-center gap-2">
                <div className="rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold"
                  style={{ background: '#16a34a22', color: '#15803d' }}>
                  {selectedEditor.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase()||'').join('')}
                </div>
                <div>
                  <p className="font-bold text-sm" style={{ color: '#15803d' }}>{selectedEditor}</p>
                  <p className="text-xs" style={{ color: '#16a34a' }}>
                    {editorStories.length} {editorStories.length === 1 ? 'story' : 'stories'} on {date}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedEditor(null)}
                className="rounded-full p-1 hover:bg-white transition-colors" style={{ color: '#16a34a' }}>
                <X size={16} />
              </button>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {editorStories.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
                  No stories found for this editor
                </div>
              ) : editorStories.map((s, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-green-50 transition-colors">
                  <span className="text-xs font-mono mt-0.5 flex-shrink-0 tabular-nums"
                    style={{ color: 'var(--muted)', minWidth: 40 }}>
                    {s.time || '—'}
                  </span>
                  <div className="flex-1 min-w-0">
                    {s.url
                      ? <a href={s.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium leading-snug hover:underline line-clamp-2"
                          style={{ color: 'var(--text)' }}>{s.title}</a>
                      : <p className="text-sm font-medium leading-snug line-clamp-2">{s.title}</p>
                    }
                    {s.category && (
                      <span className="text-xs capitalize mt-0.5 inline-block" style={{ color: '#7c3aed' }}>
                        {s.category}
                      </span>
                    )}
                  </div>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                      className="flex-shrink-0 mt-0.5 opacity-40 hover:opacity-100 transition-opacity">
                      <ExternalLink size={13} style={{ color: 'var(--muted)' }} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Toggle: hourly heatmap */}
        {persons.length > 0 && activeHours.length > 0 && (
          <>
            <button
              onClick={() => setShowEdHeat(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: '#16a34a', background: '#16a34a12', border: '1px solid #16a34a30' }}>
              <BarChart3 size={12} />
              {showEdHeat ? 'Hide' : 'Show'} Hourly Heatmap
              {showEdHeat ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {showEdHeat && (
              <SectionCard title={
                <span className="flex items-center gap-2">
                  <Users2 size={14} style={{ color: '#16a34a' }} />
                  Editor-wise Hourly Publishing — {date}
                  {authorsLoading && (
                    <span className="text-xs font-normal flex items-center gap-1" style={{ color: '#16a34a' }}>
                      <RefreshCw size={10} className="animate-spin" /> {authorsDone}/{authorsTotal}
                    </span>
                  )}
                </span>
              }>
                <div className="overflow-x-auto">
                  <table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: '2px 3px' }}>
                    <thead>
                      <tr>
                        <th className="text-left pr-4 pb-2 font-semibold"
                          style={{ color: 'var(--muted)', minWidth: 160 }}>Editor</th>
                        {activeHours.map(h => (
                          <th key={h} className="pb-2 text-center font-medium"
                            style={{ color: 'var(--muted)', minWidth: 38 }}>
                            {String(h).padStart(2, '0')}
                          </th>
                        ))}
                        <th className="pb-2 pl-4 font-bold text-right" style={{ minWidth: 52 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {persons.map(p => {
                        const isSel = selectedEditor === p.name;
                        return (
                          <tr key={p.name} style={{ background: isSel ? '#f0fdf4' : 'transparent' }}>
                            <td className="pr-4 py-0.5 whitespace-nowrap">
                              <button onClick={() => setSelectedEditor(isSel ? null : p.name)}
                                className="font-medium text-left hover:underline flex items-center gap-1"
                                style={{ color: isSel ? '#16a34a' : 'inherit' }}>
                                {p.name}
                                {isSel ? <ChevronUp size={11} /> : <ChevronDown size={11} style={{ color: 'var(--muted)' }} />}
                              </button>
                            </td>
                            {activeHours.map(h => (
                              <td key={h} className="py-0.5 text-center">
                                <HeatCell count={p.hourCounts[h] || 0} max={maxPersonHour} />
                              </td>
                            ))}
                            <td className="py-0.5 pl-4 text-right font-bold" style={{ color: '#16a34a' }}>
                              {p.stories.length}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <HeatLegend extra={`${namedCount} / ${allStories.length} stories attributed`} />
              </SectionCard>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Breaking News Tab (original manual tracker) ───────────────────────────────

function timeDiff(a, b) {
  // Returns "±HH:MM" from two "HH:MM" or "HH:MM:SS" strings
  if (!a || !b) return '—';
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const diff = toMin(a) - toMin(b);
  const sign = diff < 0 ? '-' : '+';
  const abs  = Math.abs(diff);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function speedBadge(diff) {
  if (!diff || diff === '—') return null;
  const neg = diff.startsWith('-');
  return (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded"
      style={{ background: neg ? '#dcfce7' : '#fee2e2', color: neg ? '#166534' : '#991b1b' }}>
      {diff}
    </span>
  );
}

function BreakingNewsTab({ user, canAdmin }) {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [dateFrom, setDateFrom] = useState(TODAY);
  const [dateTo,   setDateTo]   = useState(TODAY);
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [fetching, setFetching] = useState(false);
  const [patrikaArticles, setPatrikaArticles] = useState([]);
  const [showPatrika, setShowPatrika]  = useState(false);
  const [err, setErr] = useState('');

  const canWrite = canAdmin || (user?.source === 'digital' && user?.digital_role === 'team_lead');
  const myName   = user?.name || '';

  const EMPTY = {
    entry_date: TODAY, editor_name: myName, article_title: '', article_url: '',
    time_filed: '', source_name: '', source_time: '', competitor_time: '', value_addition: '', wp_publish_date: '',
  };
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const d = await api.breakingNews({ from: dateFrom, to: dateTo });
      setEntries(d.entries || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [dateFrom, dateTo]); // eslint-disable-line

  const fetchFromPatrika = async () => {
    setFetching(true); setErr('');
    try {
      const d = await api.fetchPatrikaArticles('breaking-news');
      setPatrikaArticles(d.articles || []);
      setShowPatrika(true);
    } catch (e) { setErr('Patrika fetch: ' + e.message); }
    finally { setFetching(false); }
  };

  const fillFromArticle = async (art) => {
    setForm(f => ({
      ...f,
      article_title:  art.title   || f.article_title,
      article_url:    art.url     || f.article_url,
      editor_name:    art.author  || f.editor_name,
      time_filed:     art.publish_time || f.time_filed,
      wp_publish_date:art.publish_date || f.wp_publish_date,
    }));
    setShowPatrika(false);
    setShowForm(true);
    setEditId(null);
  };

  const lookupUrl = async () => {
    if (!form.article_url) return;
    setErr('');
    try {
      const meta = await api.articleMeta(form.article_url);
      setForm(f => ({
        ...f,
        article_title:  meta.title        || f.article_title,
        editor_name:    meta.author       || f.editor_name,
        time_filed:     meta.publish_time || f.time_filed,
        wp_publish_date:meta.publish_date || f.wp_publish_date,
      }));
    } catch (e) { setErr('URL lookup: ' + e.message); }
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editId) { await api.updateBreakingNews(editId, form); }
      else        { await api.addBreakingNews(form); }
      setShowForm(false); setEditId(null); setForm(EMPTY);
      load();
    } catch (e) { setErr(e.message); }
  };

  const startEdit = (entry) => {
    setForm({
      entry_date:     entry.entry_date?.slice(0,10) || TODAY,
      editor_name:    entry.editor_name    || '',
      article_title:  entry.article_title  || '',
      article_url:    entry.article_url    || '',
      time_filed:     entry.time_filed     || '',
      source_name:    entry.source_name    || '',
      source_time:    entry.source_time    || '',
      competitor_time:entry.competitor_time|| '',
      value_addition: entry.value_addition || '',
      wp_publish_date:entry.wp_publish_date|| '',
    });
    setEditId(entry.id);
    setShowForm(true);
  };

  const del = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    try { await api.deleteBreakingNews(id); load(); }
    catch (e) { alert(e.message); }
  };

  // Stats
  const fasterThanSource = entries.filter(e => {
    if (!e.time_filed || !e.source_time) return false;
    const toMin = t => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
    return toMin(e.time_filed) <= toMin(e.source_time);
  }).length;

  const fasterThanComp = entries.filter(e => {
    if (!e.time_filed || !e.competitor_time) return false;
    const toMin = t => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
    return toMin(e.time_filed) < toMin(e.competitor_time);
  }).length;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      {entries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="surface rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
            <Newspaper size={20} style={{ color: '#2563eb' }} />
            <div><div className="text-2xl font-bold">{entries.length}</div><div className="text-sm">Stories Filed</div></div>
          </div>
          <div className="surface rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
            <Timer size={20} style={{ color: '#16a34a' }} />
            <div>
              <div className="text-2xl font-bold" style={{ color: '#16a34a' }}>{fasterThanSource}</div>
              <div className="text-sm">Faster Than Source</div>
            </div>
          </div>
          <div className="surface rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
            <Globe size={20} style={{ color: '#7c3aed' }} />
            <div>
              <div className="text-2xl font-bold" style={{ color: '#7c3aed' }}>{fasterThanComp}</div>
              <div className="text-sm">Faster Than Competitors</div>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm">
          <CalendarDays size={14} style={{ color: 'var(--muted)' }} />
          <input type="date" className="input py-1.5 text-sm" value={dateFrom} max={TODAY}
            onChange={e => setDateFrom(e.target.value)} />
          <span style={{ color: 'var(--muted)' }}>to</span>
          <input type="date" className="input py-1.5 text-sm" value={dateTo} max={TODAY}
            onChange={e => setDateTo(e.target.value)} />
        </div>
        <button className="btn-ghost px-2.5 py-1.5" onClick={load} title="Refresh"><RefreshCw size={14} /></button>

        <div className="ml-auto flex gap-2">
          <button
            className="btn-ghost text-sm flex items-center gap-1.5 px-3 py-2"
            style={{ color: '#dc2626', borderColor: '#fca5a5', border: '1px solid' }}
            onClick={fetchFromPatrika}
            disabled={fetching}>
            <Globe size={14} /> {fetching ? 'Fetching…' : 'Fetch from Patrika'}
          </button>
          <button
            className="text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg text-white"
            style={{ background: '#2563eb' }}
            onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(true); setShowPatrika(false); }}>
            <Plus size={14} /> Add Entry
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg px-3 py-2 text-sm" style={{ color: '#dc2626', background: '#fef2f2' }}>{err}</div>}

      {/* Patrika article picker */}
      {showPatrika && patrikaArticles.length > 0 && (
        <SectionCard title="Latest Articles from Patrika.com">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Click an article to pre-fill the entry form</p>
            <button className="btn-ghost px-2 py-1" onClick={() => setShowPatrika(false)}><X size={14} /></button>
          </div>
          <div className="space-y-2">
            {patrikaArticles.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg p-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 border"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => fillFromArticle(a)}>
                <Newspaper size={16} className="mt-0.5 shrink-0" style={{ color: '#dc2626' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-snug">{a.title || a.url}</div>
                  <div className="text-xs mt-0.5 flex flex-wrap gap-2" style={{ color: 'var(--muted)' }}>
                    {a.author && <span>By {a.author}</span>}
                    {a.publish_time && <span>• Published {a.publish_time}</span>}
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-0.5 hover:underline">
                        <ExternalLink size={10} /> View
                      </a>
                    )}
                  </div>
                </div>
                <ArrowRight size={16} className="shrink-0 mt-1" style={{ color: 'var(--muted)' }} />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Entry form */}
      {showForm && (
        <SectionCard title={editId ? 'Edit Entry' : 'Add Breaking News Entry'}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">Date</label>
                <input type="date" className="input" required max={TODAY} value={form.entry_date} onChange={e => set('entry_date', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Editor Name</label>
                <input className="input" placeholder="Editor who filed the story" value={form.editor_name} onChange={e => set('editor_name', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label text-xs">Article URL</label>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="https://www.patrika.com/…" value={form.article_url}
                  onChange={e => set('article_url', e.target.value)} />
                <button type="button" className="btn-ghost px-3 py-2 text-xs whitespace-nowrap"
                  onClick={lookupUrl} disabled={!form.article_url}>
                  Auto-fill from URL
                </button>
              </div>
            </div>

            <div>
              <label className="label text-xs">Article Title</label>
              <input className="input" placeholder="Headline" value={form.article_title} onChange={e => set('article_title', e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label text-xs">Time Filed (HH:MM)</label>
                <input type="time" className="input" value={form.time_filed} onChange={e => set('time_filed', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Source Time (HH:MM)</label>
                <input type="time" className="input" value={form.source_time} onChange={e => set('source_time', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Competitor Publish Time</label>
                <input type="time" className="input" value={form.competitor_time} onChange={e => set('competitor_time', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label text-xs">Source / Agency</label>
              <input className="input" placeholder="ANI, PTI, Social Media, etc." value={form.source_name} onChange={e => set('source_name', e.target.value)} />
            </div>

            <div>
              <label className="label text-xs">Value Addition / Suggestion by Incharge</label>
              <textarea className="input" rows={2} placeholder="Feedback, angle suggestion, improvement…"
                value={form.value_addition} onChange={e => set('value_addition', e.target.value)} />
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm px-4 py-2 flex items-center gap-1.5">
                <Save size={14} /> {editId ? 'Update' : 'Save Entry'}
              </button>
              <button type="button" className="btn-ghost text-sm px-4 py-2"
                onClick={() => { setShowForm(false); setEditId(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </SectionCard>
      )}

      {/* Entries table */}
      {loading ? (
        <div className="text-center py-10" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <SectionCard title={`Breaking News Log (${entries.length})`}>
          {!entries.length ? (
            <div className="text-center py-8" style={{ color: 'var(--muted)' }}>
              No entries for this date range. Click "Fetch from Patrika" to load live articles.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    <th className="pb-2 pr-3">Date</th>
                    <th className="pb-2 pr-3">Editor</th>
                    <th className="pb-2 pr-3">Article</th>
                    <th className="pb-2 pr-3">Time Filed</th>
                    <th className="pb-2 pr-3">Source</th>
                    <th className="pb-2 pr-3">vs Source</th>
                    <th className="pb-2 pr-3">vs Competitor</th>
                    <th className="pb-2 pr-3">Value Addition</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {entries.map(e => {
                    const vsSource = timeDiff(e.time_filed, e.source_time);
                    const vsComp   = timeDiff(e.time_filed, e.competitor_time);
                    return (
                      <tr key={e.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                        <td className="py-2 pr-3 text-xs whitespace-nowrap">
                          {e.entry_date?.slice(0,10) || '—'}
                        </td>
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{e.editor_name || '—'}</td>
                        <td className="py-2 pr-3 max-w-xs">
                          {e.article_url ? (
                            <a href={e.article_url} target="_blank" rel="noopener noreferrer"
                              className="hover:underline flex items-start gap-1 text-xs leading-snug"
                              style={{ color: '#2563eb' }}>
                              <ExternalLink size={11} className="mt-0.5 shrink-0" />
                              <span className="line-clamp-2">{e.article_title || e.article_url}</span>
                            </a>
                          ) : (
                            <span className="text-xs">{e.article_title || '—'}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Clock size={11} style={{ color: 'var(--muted)' }} />
                            {e.time_filed?.slice(0,5) || '—'}
                          </div>
                          {e.wp_publish_date && (
                            <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                              Published: {new Date(e.wp_publish_date).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          <div>{e.source_name || '—'}</div>
                          {e.source_time && <div style={{ color: 'var(--muted)' }}>{e.source_time?.slice(0,5)}</div>}
                        </td>
                        <td className="py-2 pr-3">{speedBadge(vsSource)}</td>
                        <td className="py-2 pr-3">
                          {e.competitor_time
                            ? <div>{speedBadge(vsComp)}<div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{e.competitor_time?.slice(0,5)}</div></div>
                            : '—'}
                        </td>
                        <td className="py-2 pr-3 max-w-xs">
                          <div className="text-xs line-clamp-2" style={{ color: 'var(--muted)' }}>
                            {e.value_addition || '—'}
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <button className="btn-ghost px-1.5 py-1" onClick={() => startEdit(e)}><Edit2 size={12} /></button>
                            <button className="btn-ghost px-1.5 py-1" onClick={() => del(e.id)} style={{ color: '#dc2626' }}><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
