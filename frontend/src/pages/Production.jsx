import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts';
import {
  CheckCircle2, AlertTriangle, Clock, TrendingUp, Download,
  RefreshCw, Loader2, ChevronLeft, ChevronRight, AlarmClock,
  Send, Bell, BellOff, X, Save, FileStack, LayoutList,
  ChevronDown, ChevronUp, GitBranch, BarChart2, MessageSquare, Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────
// Use LOCAL date (important for IST — UTC date can be 1 day behind)
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

function fmtTime(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtSched(t) {
  if (!t) return '—';
  return t.slice(0, 5); // "22:30"
}

// Format integer minutes → "+hh:mm" / "-hh:mm"
function fmtDelay(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs  = Math.abs(Math.round(minutes));
  const h    = Math.floor(abs / 60);
  const m    = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Short day label from date string: { day: 'Mon', num: '09' }
function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],
    num: String(d.getDate()).padStart(2, '0'),
  };
}

function delayColor(status) {
  if (status === 'ontime') return '#10b981';
  if (status === 'warn')   return '#C9A227';
  return '#d71920';
}

function StatusBadge({ status }) {
  const tone  = status === 'ontime' ? 'active' : status === 'warn' ? 'med' : 'high';
  const label = status === 'ontime' ? 'On Time' : status === 'warn' ? 'Warn' : 'Late';
  return <Badge tone={tone}>{label}</Badge>;
}

// Summary tile
function Tile({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <span className="inline-flex rounded-lg p-2 mt-0.5" style={{ background: color + '20', color }}>
        <Icon size={18} />
      </span>
      <div>
        <div className="text-2xl font-bold" style={{ fontFamily: 'Roboto, sans-serif' }}>{value}</div>
        <div className="text-xs font-medium">{label}</div>
        {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

// Custom bar tooltip
function DelayTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border p-3 text-xs shadow-lg" style={{ background: 'var(--surface)', borderColor: 'var(--border)', minWidth: 200 }}>
      <div className="font-bold mb-1">{d.edition_name}</div>
      <div style={{ color: 'var(--muted)' }}>{d.unit} {d.district ? `· ${d.district}` : ''}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span style={{ color: 'var(--muted)' }}>Scheduled</span><span className="font-mono">{fmtSched(d.schedule_time)}</span>
        <span style={{ color: 'var(--muted)' }}>Released</span><span className="font-mono">{fmtTime(d.release_time)}</span>
        <span style={{ color: 'var(--muted)' }}>Delay</span>
        <span className="font-bold" style={{ color: delayColor(d.status) }}>{d.delay_hhmm}</span>
      </div>
    </div>
  );
}

// ── Delay Reasons Card ────────────────────────────────────────────────────────
function DelayReasonsCard({ date, reasons, loading, onRefresh, onDelete }) {
  const { user } = useApp();
  const isAdmin  = user?.role === 'Admin';

  function fmtSubmittedAt(dt) {
    if (!dt) return '—';
    const d = new Date(dt);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // Always show section (even empty — to signal that reasons CAN be submitted)
  return (
    <SectionCard
      className="mt-5"
      title={
        <span className="flex items-center gap-2">
          <MessageSquare size={15} />
          Delay Reasons
          <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>
            — submitted via Telegram
          </span>
          {reasons.length > 0 && (
            <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: '#0088cc18', color: '#0088cc' }}>
              {reasons.length}
            </span>
          )}
          <button onClick={onRefresh} className="ml-auto btn-ghost p-1 rounded-lg" title="Refresh reasons">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </span>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--muted)' }}>
          <Loader2 size={15} className="animate-spin" /> Loading reasons…
        </div>
      ) : reasons.length === 0 ? (
        <div className="py-5 text-center text-sm" style={{ color: 'var(--muted)' }}>
          <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
          <p>No delay reasons submitted for <strong>{date}</strong></p>
          <p className="text-xs mt-1">
            Desk Heads &amp; REs can reply to the Telegram report with{' '}
            <code className="rounded px-1 py-0.5 text-xs" style={{ background: 'var(--bg)' }}>
              REASON &lt;text&gt;
            </code>
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                <th className="p-2">#</th>
                <th className="p-2">Branch</th>
                <th className="p-2">State</th>
                <th className="p-2">Submitted By</th>
                <th className="p-2">Time</th>
                <th className="p-2">Reason</th>
                {isAdmin && <th className="p-2 w-8" />}
              </tr>
            </thead>
            <tbody>
              {reasons.map((r, i) => (
                <tr key={r.id}
                  className="border-t"
                  style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                  <td className="p-2">
                    <span className="font-semibold text-xs">{r.branch || '—'}</span>
                  </td>
                  <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>{r.state || '—'}</td>
                  <td className="p-2 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: '#0088cc20', color: '#0088cc' }}>
                        {(r.submitted_by_name || '?')[0].toUpperCase()}
                      </span>
                      {r.submitted_by_name || '—'}
                    </span>
                  </td>
                  <td className="p-2 text-xs font-mono" style={{ color: 'var(--muted)' }}>
                    {fmtSubmittedAt(r.submitted_at)}
                  </td>
                  <td className="p-2 text-xs max-w-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium"
                      style={{ background: '#0088cc10', color: 'var(--text)', border: '1px solid #0088cc20' }}>
                      💬 {r.reason}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="p-2">
                      <button onClick={() => onDelete(r.id)}
                        className="btn-ghost p-1 rounded" title="Delete reason">
                        <Trash2 size={13} style={{ color: 'var(--muted)' }} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── Telegram config modal ──────────────────────────────────────────────────────
function TelegramConfigModal({ onClose }) {
  const [recipients,  setRecipients]  = useState([]);
  const [botInfo,     setBotInfo]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [fetchError,  setFetchError]  = useState('');
  const [saving,      setSaving]      = useState(null);
  const [edits,       setEdits]       = useState({});
  const [search,      setSearch]      = useState('');
  const [copied,      setCopied]      = useState(false);
  const [filterTab,   setFilterTab]   = useState('all'); // 'all' | 'joined' | 'pending'

  const token = localStorage.getItem('pk_token');
  const authH = { Authorization: `Bearer ${token}` };

  const loadRecipients = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setFetchError('');
    fetch('/api/production/delay-report', { headers: authH })
      .then(r => {
        if (!r.ok) return r.json().then(e => { throw new Error(e.error || `HTTP ${r.status}`); });
        return r.json();
      })
      .then(d => {
        const list = d.recipients || [];
        setRecipients(list);
        // Only reset edits on first load; on refresh keep unsaved edits
        if (!isRefresh) {
          const init = {};
          list.forEach(r => { init[r.pan_no] = r.telegram_chat_id || ''; });
          setEdits(init);
        } else {
          // Merge: update saved values from server but keep unsaved edits
          setEdits(prev => {
            const next = { ...prev };
            list.forEach(r => {
              // If user hasn't typed anything different, sync from server
              if ((prev[r.pan_no] || '') === (r.telegram_chat_id || '') ||
                  prev[r.pan_no] === undefined) {
                next[r.pan_no] = r.telegram_chat_id || '';
              }
            });
            return next;
          });
        }
      })
      .catch(e => setFetchError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  // Fetch bot info (username / link)
  useEffect(() => {
    fetch('/api/telegram/bot-info', { headers: authH })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBotInfo(d); })
      .catch(() => {});
    loadRecipients();
  }, []);

  const save = async (pan_no) => {
    setSaving(pan_no);
    try {
      await fetch('/api/production/delay-report', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...authH },
        body:    JSON.stringify({ pan_no, telegram_chat_id: edits[pan_no] || null }),
      });
      setRecipients(prev => prev.map(r =>
        r.pan_no === pan_no ? { ...r, telegram_chat_id: edits[pan_no] || null } : r
      ));
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(null);
  };

  const copyLink = () => {
    if (!botInfo?.bot_link) return;
    navigator.clipboard.writeText(botInfo.bot_link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const joined    = recipients.filter(r => r.telegram_chat_id);
  const pending   = recipients.filter(r => !r.telegram_chat_id);
  const configured = joined.length;

  const filtered = recipients
    .filter(r => filterTab === 'joined' ? r.telegram_chat_id : filterTab === 'pending' ? !r.telegram_chat_id : true)
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (r.EMPNAME   || '').toLowerCase().includes(q) ||
             (r.Branch    || '').toLowerCase().includes(q) ||
             (r.State     || '').toLowerCase().includes(q) ||
             (r.Story_Type|| '').toLowerCase().includes(q);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 flex flex-col max-h-[90vh] w-full max-w-3xl">

        {/* ── Header ── */}
        <div className="p-5 pb-0">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-base font-bold">📬 Telegram Delay Report Setup</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Desk Heads & REs register themselves — you just share the bot link.
              </p>
            </div>
            <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg flex-shrink-0"><X size={18} /></button>
          </div>

          {/* ── Bot link card ── */}
          <div className="rounded-xl p-4 mb-4" style={{ background: '#0088cc15', border: '1px solid #0088cc30' }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🤖</span>
              <div>
                <div className="font-semibold text-sm">
                  {botInfo?.username ? `@${botInfo.username}` : 'Bot not configured'}
                </div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {botInfo?.bot_link || 'Set TELEGRAM_BOT_TOKEN in .env'}
                </div>
              </div>
              {botInfo?.bot_link && (
                <div className="ml-auto flex gap-2">
                  <button onClick={copyLink}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium"
                    style={{ background: copied ? '#10b981' : '#0088cc', color: '#fff' }}>
                    {copied ? '✓ Copied' : '📋 Copy Link'}
                  </button>
                  <a href={botInfo.bot_link} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1 rounded-lg font-medium"
                    style={{ background: '#0088cc', color: '#fff' }}>
                    Open Bot ↗
                  </a>
                </div>
              )}
            </div>

            {/* Employee instructions */}
            <div className="text-xs rounded-lg p-3" style={{ background: 'var(--bg)' }}>
              <div className="font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>
                📋 SEND THIS TO YOUR DESK HEADS & REs:
              </div>
              <div className="leading-relaxed" style={{ color: 'var(--text)' }}>
                {botInfo?.bot_link
                  ? <>
                      1. Open Telegram → click this link: <span style={{ color: '#0088cc' }}>{botInfo.bot_link}</span><br />
                      2. Press <strong>Start</strong><br />
                      3. Send your <strong>PAN Number / Employee Code</strong><br />
                      4. Done ✅ — you will receive delay reports at 8 AM
                    </>
                  : 'Configure TELEGRAM_BOT_TOKEN in .env to get started.'
                }
              </div>
            </div>
          </div>

          {/* ── Summary counts + Refresh ── */}
          {!loading && recipients.length > 0 && (
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {/* Stat chips */}
              <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: '#10b98118', color: '#10b981' }}>
                <Bell size={12} /> {joined.length} Joined
              </span>
              <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: '#C9A22718', color: '#C9A227' }}>
                <BellOff size={12} /> {pending.length} Pending
              </span>

              {/* Filter tabs */}
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {[
                  { id: 'all',     label: `All (${recipients.length})` },
                  { id: 'joined',  label: `Joined` },
                  { id: 'pending', label: `Pending` },
                ].map(tab => (
                  <button key={tab.id} onClick={() => setFilterTab(tab.id)}
                    className="text-xs px-3 py-1.5 font-medium transition"
                    style={{
                      background: filterTab === tab.id ? 'var(--brand)' : 'var(--surface)',
                      color:      filterTab === tab.id ? '#fff' : 'var(--muted)',
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <input className="input py-1.5 text-xs flex-1 min-w-[130px]"
                placeholder="Search name, branch, state…"
                value={search} onChange={e => setSearch(e.target.value)} />

              <button onClick={() => loadRecipients(true)}
                className="btn-ghost p-1.5 rounded-lg flex-shrink-0" title="Refresh list">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          )}
        </div>

        {/* ── Scrollable table ── */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--muted)' }} />
            </div>
          ) : fetchError ? (
            <div className="rounded-lg p-4 text-sm" style={{ background: '#d7192015', color: '#d71920' }}>
              ⚠️ Error: <strong>{fetchError}</strong>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                Only Admin and State Head roles can configure this.
              </p>
            </div>
          ) : recipients.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--muted)' }}>
              No Desk Heads or REs found in the employee table.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--muted)' }}>No results match your search.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
                <tr className="text-left text-xs border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
                  <th className="p-2 pb-2.5">#</th>
                  <th className="p-2 pb-2.5">Name</th>
                  <th className="p-2 pb-2.5">Role</th>
                  <th className="p-2 pb-2.5">Branch</th>
                  <th className="p-2 pb-2.5">State</th>
                  <th className="p-2 pb-2.5 text-center">Bot Status</th>
                </tr>
              </thead>
              <tbody>
                {/* Sort: joined first, then pending */}
                {[...filtered].sort((a, b) => {
                  if (a.telegram_chat_id && !b.telegram_chat_id) return -1;
                  if (!a.telegram_chat_id && b.telegram_chat_id) return 1;
                  return (a.EMPNAME || '').localeCompare(b.EMPNAME || '');
                }).map((r, idx) => {
                  const hasTg = !!(r.telegram_chat_id);
                  return (
                    <tr key={r.pan_no}
                      className="border-t transition-colors"
                      style={{
                        borderColor: 'var(--border)',
                        background: hasTg ? '#10b9810a' : 'transparent',
                      }}>
                      {/* Serial */}
                      <td className="p-2 text-xs" style={{ color: 'var(--muted)', width: 32 }}>{idx + 1}</td>

                      {/* Name */}
                      <td className="p-2">
                        <div className="font-semibold text-xs whitespace-nowrap">{r.EMPNAME}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                          {r.pan_no || ''}
                        </div>
                      </td>

                      {/* Role badge */}
                      <td className="p-2">
                        <span className="rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap"
                          style={{
                            background: r.Story_Type === 'RE' ? '#3b82f618' : '#C9A22718',
                            color:      r.Story_Type === 'RE' ? '#3b82f6'   : '#C9A227',
                          }}>
                          {r.Story_Type}
                        </span>
                      </td>

                      {/* Branch */}
                      <td className="p-2 text-xs font-medium whitespace-nowrap">{r.Branch || '—'}</td>

                      {/* State */}
                      <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>{r.State || '—'}</td>

                      {/* Status */}
                      <td className="p-2 text-center">
                        {hasTg ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
                            style={{ background: '#10b98120', color: '#10b981' }}>
                            <Bell size={10} /> Joined
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                            style={{ background: '#6b728018', color: 'var(--muted)' }}>
                            <BellOff size={10} /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Production() {
  const { t, user } = useApp();
  const isAdmin = user?.role === 'Admin';
  const [activeTab,  setActiveTab]  = useState('monitor'); // 'monitor' | 'journey'
  const [date,       setDate]       = useState(today());
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [region,     setRegion]     = useState('ALL'); // ALL | RAJ | MPCG
  const [search,     setSearch]     = useState('');
  const [sending,    setSending]    = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [reasons,    setReasons]    = useState([]);
  const [reasonsLoading, setReasonsLoading] = useState(false);

  const load = (d) => {
    setLoading(true);
    api.production(d)
      .then(setData)
      .finally(() => setLoading(false));
  };

  const loadReasons = (d) => {
    setReasonsLoading(true);
    const token = localStorage.getItem('pk_token');
    fetch(`/api/production/delay-reasons?date=${d}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error); }))
      .then(d => setReasons(d.reasons || []))
      .catch(() => setReasons([]))
      .finally(() => setReasonsLoading(false));
  };

  const deleteReason = async (id) => {
    if (!window.confirm('Delete this reason?')) return;
    const token = localStorage.getItem('pk_token');
    await fetch(`/api/production/delay-reasons?id=${id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    setReasons(prev => prev.filter(r => r.id !== id));
  };

  const sendDelayReport = async () => {
    setSending(true); setSendResult(null);
    try {
      const res = await fetch('/api/production/delay-report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pk_token')}` },
        body:    JSON.stringify({ date }),
      });
      const d = await res.json();
      setSendResult(d);
    } catch (e) {
      setSendResult({ ok: false, error: e.message });
    }
    setSending(false);
  };

  useEffect(() => { load(date); loadReasons(date); }, [date]);

  const shiftDate = (n) => {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    setDate(d.toISOString().slice(0, 10));
  };

  // Filter by region + search
  const editions = useMemo(() => {
    if (!data?.editions) return [];
    return data.editions.filter(e => {
      if (region !== 'ALL' && e.region !== region) return false;
      if (search) {
        const q = search.toLowerCase();
        return (e.edition_name || '').toLowerCase().includes(q) ||
               (e.unit         || '').toLowerCase().includes(q) ||
               (e.district     || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [data, region, search]);

  // For chart — top 30 by delay (most delayed first), sort ascending for display
  const chartData = useMemo(() =>
    [...editions]
      .sort((a, b) => b.delay_minutes - a.delay_minutes)
      .slice(0, 40)
      .reverse(),
  [editions]);

  // Region-filtered summary
  const summary = useMemo(() => {
    const total    = editions.length;
    const onTime   = editions.filter(e => e.status === 'ontime').length;
    const delayed  = editions.filter(e => e.status !== 'ontime').length;
    const delays   = editions.map(e => e.delay_minutes).filter(d => d > 0);
    const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
    const maxDelay = delays.length ? Math.max(...delays) : 0;
    const fmt = (m) => {
      const h = Math.floor(m / 60), mn = m % 60;
      return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
    };
    return { total, onTime, delayed, avgDelay: fmt(avgDelay), maxDelay: fmt(maxDelay) };
  }, [editions]);

  const downloadExcel = () => {
    const rows = editions.map(e => ({
      'Edition':      e.edition_name,
      'Type':         e.edition_type,
      'Unit':         e.unit,
      'District':     e.district,
      'State/Region': e.region,
      'Scheduled':    fmtSched(e.schedule_time),
      'Released':     fmtTime(e.release_time),
      'Delay (hh:mm)': e.delay_hhmm,
      'Status':       e.status === 'ontime' ? 'On Time' : e.status === 'warn' ? 'Warning' : 'Late',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Production');
    XLSX.writeFile(wb, `production_${date}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title={t('nav.production')}
        subtitle="Branch-wise edition release · schedule vs actual · delay monitoring"
      />

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        {[
          { id: 'monitor', label: 'Production Monitor', icon: LayoutList },
          { id: 'journey', label: 'Page Journey',       icon: GitBranch  },
          { id: 'weekly',  label: 'Weekly Trend',       icon: BarChart2, adminOnly: true },
        ].filter(tab => !tab.adminOnly || isAdmin).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              activeTab === id
                ? 'border-[var(--brand)] text-[var(--brand)]'
                : 'border-transparent hover:border-gray-300'
            }`}
            style={activeTab !== id ? { color: 'var(--muted)' } : {}}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── Page Journey tab ─────────────────────────────────────────────── */}
      {activeTab === 'journey' && <PageJourneyTab date={date} setDate={setDate} shiftDate={shiftDate} />}

      {/* ── Weekly Trend tab ─────────────────────────────────────────────── */}
      {activeTab === 'weekly' && <WeeklyTrendTab date={date} setDate={setDate} shiftDate={shiftDate} />}

      {/* ── Production Monitor tab ───────────────────────────────────────── */}
      {activeTab !== 'journey' && activeTab !== 'weekly' && <>

      {/* ── Date nav + region filter ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Date stepper */}
        <div className="flex items-center gap-1">
          <button onClick={() => shiftDate(-1)} className="btn-ghost p-1.5"><ChevronLeft size={16} /></button>
          <input
            type="date" value={date} max={today()}
            onChange={e => setDate(e.target.value)}
            className="input py-1.5 text-sm font-semibold"
          />
          <button onClick={() => shiftDate(1)} className="btn-ghost p-1.5" disabled={date >= today()}><ChevronRight size={16} /></button>
        </div>

        {/* Region tabs */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {[['ALL','All'], ['RAJ','Rajasthan'], ['MPCG','MP / CG']].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setRegion(val)}
              className="px-3 py-1.5 text-sm font-medium transition"
              style={{
                background: region === val ? 'var(--brand)' : 'var(--surface)',
                color:      region === val ? '#fff' : 'var(--text)',
              }}
            >{lbl}</button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text" placeholder="Search edition / unit…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="input py-1.5 text-sm flex-1 min-w-[160px]"
        />

        <button onClick={() => load(date)} className="btn-ghost p-1.5" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={downloadExcel} className="btn-ghost flex items-center gap-1.5 text-sm" disabled={!editions.length}>
          <Download size={14} /> Excel
        </button>

        {/* Telegram send controls */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={sendDelayReport}
            disabled={sending || !editions.length}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition"
            style={{ background: '#0088cc', color: '#fff', opacity: sending || !editions.length ? 0.6 : 1 }}
            title="Send delay report to Desk Heads & REs via Telegram"
          >
            {sending
              ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
              : <><Send size={14} /> Send Report</>}
          </button>
          <button
            onClick={() => setShowConfig(true)}
            className="btn-ghost p-1.5 rounded-lg"
            title="Configure Telegram recipients"
          >
            <Bell size={15} />
          </button>
        </div>
      </div>

      {/* Send result banner */}
      {sendResult && (
        <div className="mb-4 rounded-xl p-3 text-sm flex items-start gap-3"
          style={{
            background: sendResult.error ? '#d7192015' : (sendResult.sent?.length > 0 ? '#10b98115' : '#C9A22715'),
            border: `1px solid ${sendResult.error ? '#d7192030' : (sendResult.sent?.length > 0 ? '#10b98130' : '#C9A22730')}`,
          }}>
          <div className="flex-1 space-y-1.5">
            {sendResult.noDelays && (
              <p>✅ No delays found for <strong>{date}</strong> — nothing to send.</p>
            )}
            {sendResult.skipped && (
              <p>⚠️ Telegram bot token not set. Add <code className="text-xs bg-black/10 px-1 rounded">TELEGRAM_BOT_TOKEN</code> in <code className="text-xs bg-black/10 px-1 rounded">.env</code> and restart server.</p>
            )}
            {sendResult.error && (
              <p style={{ color: '#d71920' }}>❌ Error: {sendResult.error}</p>
            )}
            {sendResult.sent?.length > 0 && (
              <p style={{ color: '#10b981' }}>
                ✅ Sent to <strong>{sendResult.sent.length}</strong> recipient{sendResult.sent.length > 1 ? 's' : ''}:{' '}
                {sendResult.sent.map(s => `${s.name} (${s.branch})`).join(', ')}
              </p>
            )}
            {sendResult.failed?.length > 0 && (
              <p style={{ color: '#d71920' }}>
                ❌ Failed ({sendResult.failed.length}): {sendResult.failed.map(f => `${f.name} — ${f.error}`).join('; ')}
              </p>
            )}
            {sendResult.noRecipients?.length > 0 && (() => {
              const list  = sendResult.noRecipients;
              const show  = list.slice(0, 5);
              const extra = list.length - show.length;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ color: '#C9A227' }}>
                    ⚠️ <strong>{list.length} branch{list.length > 1 ? 'es' : ''}</strong> need Telegram setup:{' '}
                    {show.join(', ')}{extra > 0 ? ` and ${extra} more` : ''}
                  </span>
                  <button
                    onClick={() => { setSendResult(null); setShowConfig(true); }}
                    className="text-xs px-2.5 py-0.5 rounded-lg font-semibold flex items-center gap-1 flex-shrink-0"
                    style={{ background: '#C9A227', color: '#fff' }}
                  >
                    <Bell size={11} /> Configure Now
                  </button>
                </div>
              );
            })()}
          </div>
          <button onClick={() => setSendResult(null)} className="flex-shrink-0 mt-0.5">
            <X size={14} style={{ color: 'var(--muted)' }} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={20} className="animate-spin" /> Loading production data…
        </div>
      ) : !editions.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <AlarmClock size={32} />
          <p className="text-sm">No edition data found for <strong>{date}</strong></p>
          <p className="text-xs">Try selecting a different date or check that GMG files were uploaded.</p>
        </div>
      ) : (
        <>
          {/* ── Summary tiles ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5 mb-5">
            <Tile icon={TrendingUp}   label="Total Editions" value={summary.total}    color="#3b82f6" />
            <Tile icon={CheckCircle2} label="On Time"        value={summary.onTime}   color="#10b981" sub={`${Math.round(summary.onTime/summary.total*100)}%`} />
            <Tile icon={AlertTriangle}label="Delayed"        value={summary.delayed}  color="#d71920" sub={`${Math.round(summary.delayed/summary.total*100)}%`} />
            <Tile icon={Clock}        label="Avg Delay"      value={summary.avgDelay} color="#C9A227" sub="hh:mm" />
            <Tile icon={AlarmClock}   label="Max Delay"      value={summary.maxDelay} color="#8b5cf6" sub="hh:mm" />
          </div>

          {/* ── Delay bar chart ───────────────────────────────────────────── */}
          <SectionCard title={`Edition Delay (hh:mm) — ${chartData.length} editions`} className="mb-5">
            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 22)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 60, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number" stroke="var(--muted)" fontSize={11}
                  tickFormatter={v => {
                    const abs = Math.abs(v), h = Math.floor(abs/60), m = abs%60;
                    return `${v<0?'-':''}${h}:${String(m).padStart(2,'0')}`;
                  }}
                />
                <YAxis
                  type="category" dataKey="unit" width={90}
                  stroke="var(--muted)" fontSize={10} tick={{ fontSize: 10 }}
                />
                <Tooltip content={<DelayTooltip />} />
                <ReferenceLine x={0} stroke="var(--border)" strokeWidth={2} />
                <Bar dataKey="delay_minutes" radius={[0, 4, 4, 0]} barSize={16}
                  label={{ position: 'right', fontSize: 10, formatter: (v) => {
                    const abs = Math.abs(v), h = Math.floor(abs/60), m = abs%60;
                    return v === 0 ? '' : `${v<0?'-':''}${h}:${String(m).padStart(2,'0')}`;
                  }}}
                >
                  {chartData.map((e, i) => (
                    <Cell key={i} fill={delayColor(e.status)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#10b981' }} />On Time (≤ 0 min)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#C9A227' }} />Warning (1–30 min)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#d71920' }} />Late (&gt; 30 min)</span>
            </div>
          </SectionCard>

          {/* ── Detail table ──────────────────────────────────────────────── */}
          <SectionCard title={`Edition Details (${editions.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                    <th className="p-2">Edition</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Unit</th>
                    <th className="p-2">District</th>
                    <th className="p-2">Region</th>
                    <th className="p-2 text-center">Scheduled</th>
                    <th className="p-2 text-center">Released</th>
                    <th className="p-2 text-center">Delay</th>
                    <th className="p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {editions.map((e, i) => (
                    <tr key={i}
                      className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="p-2 font-semibold whitespace-nowrap text-xs">{e.edition_name}</td>
                      <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>{e.edition_type}</td>
                      <td className="p-2 text-xs">{e.unit}</td>
                      <td className="p-2 text-xs">{e.district}</td>
                      <td className="p-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                          style={{ background: e.region === 'RAJ' ? '#3b82f620' : '#8b5cf620',
                                   color:      e.region === 'RAJ' ? '#3b82f6'   : '#8b5cf6' }}>
                          {e.region}
                        </span>
                      </td>
                      <td className="p-2 text-center font-mono text-xs">{fmtSched(e.schedule_time)}</td>
                      <td className="p-2 text-center font-mono text-xs">{fmtTime(e.release_time)}</td>
                      <td className="p-2 text-center">
                        <span className="font-bold font-mono text-xs"
                          style={{ color: delayColor(e.status) }}>
                          {e.delay_hhmm}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <StatusBadge status={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      {/* ── Delay Reasons section ────────────────────────────────────────────── */}
      <DelayReasonsCard
        date={date}
        reasons={reasons}
        loading={reasonsLoading}
        onRefresh={() => loadReasons(date)}
        onDelete={deleteReason}
      />

      {showConfig && <TelegramConfigModal onClose={() => setShowConfig(false)} />}

      </> /* end Production Monitor tab */ }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE JOURNEY TAB
// ═══════════════════════════════════════════════════════════════════════════════

// Time display helper
function fmtT(dt) {
  if (!dt) return '—';
  // Backend sends DATE_FORMAT strings like '2026-07-02T01:57:00' (no Z/timezone).
  // Browsers parse ISO-without-timezone as LOCAL time, so getHours() = correct IST.
  const s = String(dt);
  const m = s.match(/[T ](\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  const d = new Date(dt);
  if (isNaN(d)) return '—';
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

// Duration helper
function fmtDur(min) {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// Revision status config
function revConfig(maxRev) {
  if (maxRev === 0) return { color: '#10b981', bg: '#10b98115', label: 'No Rev' };
  if (maxRev === 1) return { color: '#C9A227', bg: '#C9A22715', label: `${maxRev} Rev` };
  return { color: '#d71920', bg: '#d7192015', label: `${maxRev} Rev` };
}

// Inline timeline bar showing page relative to edition's full time range
function TimelineBar({ firstMs, lastMs, edStart, edEnd, maxRev }) {
  if (!edStart || !edEnd || edStart === edEnd) return null;
  const total  = edEnd - edStart;
  const left   = ((firstMs - edStart) / total) * 100;
  const width  = Math.max(((lastMs - firstMs) / total) * 100, 0.5);
  const { color } = revConfig(maxRev);
  return (
    <div className="relative h-4 rounded" style={{ background: 'var(--bg)', minWidth: 120 }}>
      <div className="absolute top-0 h-4 rounded"
        style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: 0.8, minWidth: 4 }} />
    </div>
  );
}

// Expandable row showing all versions of a page
function PageRow({ page, edStart, edEnd }) {
  const [open, setOpen] = useState(false);
  const cfg = revConfig(page.max_rev);
  const firstMs = new Date(page.first_upload).getTime();
  const lastMs  = new Date(page.last_upload).getTime();

  return (
    <>
      <tr
        className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
        style={{ borderColor: 'var(--border)' }}
        onClick={() => setOpen(o => !o)}
      >
        {/* Page no */}
        <td className="p-2 text-center">
          <span className="inline-block w-8 h-8 rounded-lg text-sm font-bold leading-8 text-center"
            style={{ background: cfg.bg, color: cfg.color }}>
            {page.page_no}
          </span>
        </td>
        {/* First upload */}
        <td className="p-2 text-center font-mono text-sm font-semibold">{fmtT(page.first_upload)}</td>
        {/* Last upload */}
        <td className="p-2 text-center font-mono text-sm" style={{ color: page.max_rev > 0 ? cfg.color : 'inherit', fontWeight: page.max_rev > 0 ? 700 : 400 }}>
          {fmtT(page.last_upload)}
        </td>
        {/* Duration */}
        <td className="p-2 text-center text-xs" style={{ color: 'var(--muted)' }}>{fmtDur(page.duration_min)}</td>
        {/* Revisions */}
        <td className="p-2 text-center">
          <span className="inline-block rounded px-2 py-0.5 text-xs font-bold"
            style={{ background: cfg.bg, color: cfg.color }}>
            {cfg.label}
          </span>
        </td>
        {/* Uploads */}
        <td className="p-2 text-center text-xs" style={{ color: 'var(--muted)' }}>{page.total_uploads}</td>
        {/* Timeline */}
        <td className="p-2 min-w-[140px]">
          <TimelineBar firstMs={firstMs} lastMs={lastMs} edStart={edStart} edEnd={edEnd} maxRev={page.max_rev} />
        </td>
        {/* Expand */}
        <td className="p-2 text-center">
          {open ? <ChevronUp size={14} style={{ color: 'var(--muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--muted)' }} />}
        </td>
      </tr>

      {/* Expanded version detail */}
      {open && page.versions.map((v, vi) => (
        <tr key={vi} style={{ background: 'var(--bg)' }}>
          <td className="pl-6 pr-2 py-1.5 text-center" style={{ color: 'var(--muted)', fontSize: 11 }}>↳</td>
          <td className="p-1.5 text-center font-mono text-xs font-semibold">{fmtT(v.first_time)}</td>
          <td className="p-1.5 text-center font-mono text-xs"
            style={{ color: v.rev_no > 0 ? '#d71920' : 'var(--muted)' }}>
            {fmtT(v.last_time)}
          </td>
          <td className="p-1.5 text-center" colSpan={2}>
            <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
              style={{
                background: v.rev_no === 0 ? '#10b98115' : '#d7192015',
                color:      v.rev_no === 0 ? '#10b981'   : '#d71920',
              }}>
              {v.label}
            </span>
          </td>
          <td className="p-1.5 text-center text-xs" style={{ color: 'var(--muted)' }}>{v.upload_count}×</td>
          <td className="p-1.5" colSpan={2}>
            <span className="text-xs truncate block max-w-[200px]" style={{ color: 'var(--muted)' }}
              title={v.filename}>{v.filename}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

function PageJourneyTab({ date, setDate, shiftDate }) {
  const { state: globalState, branch: globalBranch } = useApp();
  const [journeyData, setJourneyData] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [activeEd,    setActiveEd]    = useState(null);
  const [sortBy,      setSortBy]      = useState('page');
  const [edSearch,    setEdSearch]    = useState('');

  const load = useCallback((d) => {
    setLoading(true); setError('');
    const token = localStorage.getItem('pk_token');
    fetch(`/api/production/page-journey?date=${d}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then(r => {
        if (!r.ok) return r.json().then(e => { throw new Error(e.error || `HTTP ${r.status}`); });
        return r.json();
      })
      .then(data => { setJourneyData(data); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(date); }, [date]);

  const allEditions = journeyData?.editions || [];

  // Normalise state name for comparison (mirrors backend STATE_NORM)
  const normSt = s => (s || '').trim().toLowerCase()
    .replace('madhya pradesh', 'mp').replace('chhattisgarh', 'cg').replace('rajasthan', 'raj');

  // Apply global state / branch filter + edition search
  const editions = useMemo(() => {
    let list = allEditions;
    if (globalState && globalState !== 'All') {
      list = list.filter(e => normSt(e.state) === normSt(globalState) || !e.state);
    }
    if (globalBranch && globalBranch !== 'All') {
      list = list.filter(e =>
        (e.unit || '').toLowerCase() === globalBranch.toLowerCase() || !e.unit
      );
    }
    if (edSearch) {
      const q = edSearch.toLowerCase();
      list = list.filter(e =>
        (e.edition_name || '').toLowerCase().includes(q) ||
        (e.unit         || '').toLowerCase().includes(q) ||
        (e.district     || '').toLowerCase().includes(q) ||
        (e.code         || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [allEditions, globalState, globalBranch, edSearch]);

  // Reset active edition when filter changes
  useEffect(() => {
    if (!editions.find(e => e.code === activeEd)) {
      setActiveEd(editions[0]?.code || null);
    }
  }, [editions]);

  const activeEdn = editions.find(e => e.code === activeEd) || editions[0];


  // Sort pages
  const sortedPages = useMemo(() => {
    if (!activeEdn?.pages) return [];
    const pages = [...activeEdn.pages];
    if (sortBy === 'first') return pages.sort((a, b) => new Date(a.first_upload) - new Date(b.first_upload));
    if (sortBy === 'last')  return pages.sort((a, b) => new Date(b.last_upload)  - new Date(a.last_upload));
    if (sortBy === 'rev')   return pages.sort((a, b) => b.max_rev - a.max_rev || b.duration_min - a.duration_min);
    return pages.sort((a, b) => a.page_no - b.page_no); // default: page number
  }, [activeEdn, sortBy]);

  const edStart = activeEdn ? new Date(activeEdn.edition_first).getTime() : 0;
  const edEnd   = activeEdn ? new Date(activeEdn.edition_last).getTime()  : 0;

  // Excel download for page journey
  const downloadJourney = () => {
    if (!activeEdn) return;
    const rows = [];
    activeEdn.pages.forEach(p => {
      p.versions.forEach(v => {
        rows.push({
          'Page No':     p.page_no,
          'Version':     v.label,
          'First Upload': fmtT(v.first_time),
          'Last Upload':  fmtT(v.last_time),
          'Uploads':     v.upload_count,
          'Filename':    v.filename,
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]||{}).map(k => ({ wch: Math.max(k.length, 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PageJourney');
    const safeName = (activeEdn.edition_name || activeEdn.code).replace(/[^a-z0-9]/gi, '_');
    XLSX.writeFile(wb, `page_journey_${safeName}_${date}.xlsx`);
  };

  return (
    <div>
      {/* Date nav */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <button onClick={() => shiftDate(-1)} className="btn-ghost p-1.5"><ChevronLeft size={16} /></button>
          <input type="date" value={date} max={today()}
            onChange={e => setDate(e.target.value)}
            className="input py-1.5 text-sm font-semibold" />
          <button onClick={() => shiftDate(1)} className="btn-ghost p-1.5" disabled={date >= today()}><ChevronRight size={16} /></button>
        </div>
        <button onClick={() => load(date)} className="btn-ghost p-1.5" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        {/* Edition search */}
        <input
          type="text"
          placeholder="Edition खोजें…"
          value={edSearch}
          onChange={e => setEdSearch(e.target.value)}
          className="input py-1.5 text-sm w-40"
        />
        {/* Edition dropdown */}
        {editions.length > 0 && (
          <select
            value={activeEd || ''}
            onChange={e => setActiveEd(e.target.value)}
            className="input py-1.5 text-sm flex-1 min-w-[200px] max-w-sm"
          >
            {editions.map(ed => (
              <option key={ed.code} value={ed.code}>
                {ed.edition_name || ed.code}
                {ed.unit && ed.unit !== ed.edition_name ? ` — ${ed.unit}` : ''}
                {ed.district ? ` (${ed.district})` : ''}
              </option>
            ))}
          </select>
        )}
        {editions.length > 0 && (
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
            {editions.length} edition{editions.length !== 1 ? 's' : ''}
          </span>
        )}
        {activeEdn && (
          <button onClick={downloadJourney} className="btn-ghost flex items-center gap-1.5 text-sm ml-auto">
            <Download size={14} /> Excel
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={20} className="animate-spin" /> Loading page journey…
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: '#d7192015', color: '#d71920' }}>
          ⚠️ Error: {error}
        </div>
      ) : !editions.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <FileStack size={32} />
          <p className="text-sm">No page data found for <strong>{date}</strong></p>
          <p className="text-xs">Check that GMG files were uploaded for this date.</p>
        </div>
      ) : (
        <>

          {activeEdn && (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-4">

                {/* Pages uploaded vs scheduled — special tile */}
                <div className="card p-4">
                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-bold" style={{ color: '#3b82f6' }}>{activeEdn.total_pages}</span>
                    {activeEdn.scheduled_pages > 0 && (
                      <span className="text-sm font-semibold mb-0.5" style={{ color: 'var(--muted)' }}>
                        / {activeEdn.scheduled_pages}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    Pages{activeEdn.scheduled_pages > 0 ? ' Uploaded / Total' : ' Uploaded'}
                  </div>
                  {activeEdn.scheduled_pages > 0 && (
                    <div className="mt-2 w-full rounded-full h-1.5" style={{ background: 'var(--border)' }}>
                      <div className="h-1.5 rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, Math.round((activeEdn.total_pages / activeEdn.scheduled_pages) * 100))}%`,
                          background: activeEdn.total_pages >= activeEdn.scheduled_pages ? '#10b981' : '#C9A227',
                        }} />
                    </div>
                  )}
                </div>

                {[
                  { label: 'Pages Revised',  value: activeEdn.revised_pages,              color: activeEdn.revised_pages > 0 ? '#d71920' : '#10b981' },
                  { label: 'First Upload',   value: fmtT(activeEdn.edition_first),        color: '#10b981' },
                  { label: 'Last Upload',    value: fmtT(activeEdn.edition_last),         color: '#C9A227' },
                  { label: 'Total Duration', value: fmtDur(activeEdn.edition_duration),   color: '#8b5cf6' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="card p-4">
                    <div className="text-2xl font-bold" style={{ color }}>{value || '—'}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Timeline legend + sort */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#10b981' }} />No Revision</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#C9A227' }} />1 Revision</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#d71920' }} />2+ Revisions</span>
                  <span className="ml-2">Timeline: {fmtT(activeEdn.edition_first)} → {fmtT(activeEdn.edition_last)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span style={{ color: 'var(--muted)' }}>Sort:</span>
                  {[['page','Page No'],['first','First Upload'],['last','Last Upload'],['rev','Most Revised']].map(([v,l]) => (
                    <button key={v} onClick={() => setSortBy(v)}
                      className="px-2 py-1 rounded font-medium"
                      style={{
                        background: sortBy === v ? 'var(--brand)' : 'var(--bg)',
                        color:      sortBy === v ? '#fff' : 'var(--muted)',
                      }}>{l}</button>
                  ))}
                </div>
              </div>

              {/* Pages table */}
              <SectionCard title={
                <span>
                  Page Journey — <strong>{activeEdn.edition_name || activeEdn.code}</strong>
                  {activeEdn.unit ? <span className="ml-2 text-sm font-normal" style={{color:'var(--muted)'}}>{activeEdn.unit}{activeEdn.district ? ` · ${activeEdn.district}` : ''}</span> : null}
                  <span className="ml-2 text-sm font-normal" style={{color:'var(--muted)'}}>({sortedPages.length} pages)</span>
                </span>
              }>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                        <th className="p-2 text-center w-12">Page</th>
                        <th className="p-2 text-center">First Upload</th>
                        <th className="p-2 text-center">Last Upload</th>
                        <th className="p-2 text-center">Duration</th>
                        <th className="p-2 text-center">Revision</th>
                        <th className="p-2 text-center">Uploads</th>
                        <th className="p-2">Timeline →</th>
                        <th className="p-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPages.map(p => (
                        <PageRow key={p.page_no} page={p} edStart={edStart} edEnd={edEnd} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEKLY TREND TAB
// ═══════════════════════════════════════════════════════════════════════════════

const HEAT = {
  ontime: { bg: '#10b98118', text: '#10b981' },
  warn:   { bg: '#C9A22720', text: '#C9A227' },
  late:   { bg: '#d7192018', text: '#d71920' },
};

function HeatCell({ d }) {
  if (!d) return (
    <td className="px-1 py-2 text-center text-xs border-l"
      style={{ color: 'var(--muted)', borderColor: 'var(--border)', background: 'transparent' }}>—</td>
  );
  const c = HEAT[d.status] || HEAT.late;
  return (
    <td className="px-1 py-2 text-center border-l"
      title={`Sched: ${(d.schedule_time||'').slice(0,5)}  Released: ${
        d.release_time ? new Date(d.release_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}) : '—'
      }  Delay: ${d.delay_hhmm}`}
      style={{ background: c.bg, borderColor: 'var(--border)' }}>
      <span className="text-xs font-bold font-mono" style={{ color: c.text }}>{d.delay_hhmm}</span>
    </td>
  );
}

function WeeklyTrendTab({ date, setDate, shiftDate }) {
  const [days,       setDays]       = useState(7);
  const [region,     setRegion]     = useState('ALL');
  const [search,     setSearch]     = useState('');
  const [sortBy,     setSortBy]     = useState('avg');  // avg | max | late | name
  const [trendData,  setTrendData]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [selectedEd, setSelectedEd] = useState(null);  // code of clicked row
  const [sending,    setSending]    = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const sendAppreciation = async () => {
    setSending(true); setSendResult(null);
    try {
      const res = await fetch('/api/production/weekly-appreciation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pk_token')}` },
        body:    JSON.stringify({ endDate: date }),
      });
      const d = await res.json();
      setSendResult(d);
    } catch (e) {
      setSendResult({ ok: false, error: e.message });
    }
    setSending(false);
  };

  const load = useCallback((endDate, numDays) => {
    setLoading(true); setError('');
    const token = localStorage.getItem('pk_token');
    fetch(`/api/production/weekly-trend?endDate=${endDate}&days=${numDays}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || `HTTP ${r.status}`); }))
      .then(data => { setTrendData(data); setSelectedEd(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(date, days); }, [date, days]);

  const allEditions = trendData?.editions || [];
  const dates       = trendData?.dates    || [];

  // Filter + sort
  const editions = useMemo(() => {
    let list = allEditions;
    if (region !== 'ALL') list = list.filter(e => e.region === region);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.edition_name || '').toLowerCase().includes(q) ||
        (e.unit         || '').toLowerCase().includes(q) ||
        (e.district     || '').toLowerCase().includes(q) ||
        (e.state        || '').toLowerCase().includes(q)
      );
    }
    const s = [...list];
    if (sortBy === 'avg')  s.sort((a, b) => b.avg_delay    - a.avg_delay);
    if (sortBy === 'max')  s.sort((a, b) => b.max_delay    - a.max_delay);
    if (sortBy === 'late') s.sort((a, b) => b.delayed_days - a.delayed_days);
    if (sortBy === 'name') s.sort((a, b) => (a.edition_name||'').localeCompare(b.edition_name||''));
    return s;
  }, [allEditions, region, search, sortBy]);

  // Overall summary
  const stats = useMemo(() => {
    if (!editions.length) return null;
    const cells   = editions.flatMap(e => Object.values(e.days));
    const delayed = cells.filter(c => c.status !== 'ontime').length;
    const total   = cells.length;
    const worst   = [...editions].sort((a, b) => b.avg_delay - a.avg_delay)[0];
    return { edCount: editions.length, delayed, total, pct: total ? Math.round(delayed/total*100) : 0, worst };
  }, [editions]);

  // Chart data for selected edition
  const chartData = useMemo(() => {
    if (!selectedEd) return [];
    const ed = allEditions.find(e => e.code === selectedEd);
    if (!ed) return [];
    return dates.map(dt => {
      const lbl = dayLabel(dt);
      const d   = ed.days[dt];
      return {
        label:  `${lbl.day}\n${lbl.num}`,
        date:   `${lbl.day} ${lbl.num}`,
        delay:  d ? d.delay_minutes : null,
        hhmm:   d ? d.delay_hhmm   : '—',
        status: d ? d.status        : 'none',
      };
    });
  }, [selectedEd, allEditions, dates]);

  const selEd = selectedEd ? allEditions.find(e => e.code === selectedEd) : null;

  return (
    <div>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-5">

        {/* Date = end date */}
        <div className="flex items-center gap-1">
          <button onClick={() => shiftDate(-1)} className="btn-ghost p-1.5"><ChevronLeft size={16} /></button>
          <div className="flex flex-col items-center">
            <input type="date" value={date} max={today()}
              onChange={e => setDate(e.target.value)}
              className="input py-1.5 text-sm font-semibold" />
            <span className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>End Date</span>
          </div>
          <button onClick={() => shiftDate(1)} className="btn-ghost p-1.5" disabled={date >= today()}><ChevronRight size={16} /></button>
        </div>

        {/* Days range */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {[7, 14, 30].map(n => (
            <button key={n} onClick={() => setDays(n)}
              className="px-3 py-1.5 text-xs font-semibold transition"
              style={{ background: days===n ? 'var(--brand)' : 'var(--surface)', color: days===n ? '#fff' : 'var(--muted)' }}>
              {n}D
            </button>
          ))}
        </div>

        {/* Region */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {[['ALL','All'],['RAJ','RAJ'],['MPCG','MPCG']].map(([v, l]) => (
            <button key={v} onClick={() => setRegion(v)}
              className="px-3 py-1.5 text-xs font-semibold transition"
              style={{ background: region===v ? 'var(--brand)' : 'var(--surface)', color: region===v ? '#fff' : 'var(--muted)' }}>
              {l}
            </button>
          ))}
        </div>

        {/* Search */}
        <input type="text" placeholder="Search edition / unit…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="input py-1.5 text-xs flex-1 min-w-[150px]" />

        {/* Sort */}
        <div className="flex items-center gap-1">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Sort:</span>
          {[['avg','Avg Delay'],['max','Max Delay'],['late','Days Late'],['name','Name']].map(([v, l]) => (
            <button key={v} onClick={() => setSortBy(v)}
              className="px-2 py-1 rounded text-xs font-medium transition"
              style={{ background: sortBy===v ? 'var(--brand)' : 'var(--bg)', color: sortBy===v ? '#fff' : 'var(--muted)' }}>
              {l}
            </button>
          ))}
        </div>

        <button onClick={() => load(date, days)} className="btn-ghost p-1.5" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* ── Telegram appreciation button ── */}
        <button
          onClick={sendAppreciation}
          disabled={sending || !editions.length}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition ml-auto"
          style={{ background: '#10b981', color: '#fff', opacity: sending || !editions.length ? 0.6 : 1 }}
          title="Send weekly appreciation to on-time branches via Telegram"
        >
          {sending
            ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
            : <><Send size={14} /> Send Appreciation</>}
        </button>
      </div>

      {/* ── Appreciation send result banner ──────────────────────────────── */}
      {sendResult && (
        <div className="mb-4 rounded-xl p-3 text-sm"
          style={{
            background: sendResult.error ? '#d7192015' : sendResult.sent?.length > 0 ? '#10b98115' : '#C9A22715',
            border: `1px solid ${sendResult.error ? '#d7192030' : sendResult.sent?.length > 0 ? '#10b98130' : '#C9A22730'}`,
          }}>
          <div className="space-y-1">
            {sendResult.noOnTime && (
              <p style={{ color: '#C9A227' }}>ℹ️ No on-time editions found for the week ending <strong>{sendResult.endDate}</strong>. Nothing sent.</p>
            )}
            {sendResult.skipped && (
              <p style={{ color: '#C9A227' }}>⚠️ Telegram bot token not set — add <code className="text-xs bg-black/10 px-1 rounded">TELEGRAM_BOT_TOKEN</code> in <code className="text-xs bg-black/10 px-1 rounded">.env</code> and restart.</p>
            )}
            {sendResult.error && (
              <p style={{ color: '#d71920' }}>❌ Error: {sendResult.error}</p>
            )}
            {sendResult.sent?.length > 0 && (
              <p style={{ color: '#10b981' }}>
                ✅ Appreciation sent to <strong>{sendResult.sent.length}</strong> recipient{sendResult.sent.length !== 1 ? 's' : ''}:{' '}
                {sendResult.sent.map(s => `${s.name} (${s.branch})`).join(', ')}
              </p>
            )}
            {sendResult.failed?.length > 0 && (
              <p style={{ color: '#d71920' }}>
                ❌ Failed ({sendResult.failed.length}): {sendResult.failed.map(f => `${f.name} — ${f.error}`).join('; ')}
              </p>
            )}
            {sendResult.noRecipients?.length > 0 && (
              <p style={{ color: '#C9A227' }}>
                ⚠️ No Telegram recipients configured for: {sendResult.noRecipients.join(', ')}
              </p>
            )}
            {sendResult.startDate && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Week: {sendResult.startDate} → {sendResult.endDate}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── States ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={20} className="animate-spin" /> Loading weekly trend…
        </div>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: '#d7192015', color: '#d71920' }}>
          ⚠️ {error}
        </div>
      ) : !editions.length ? (
        <div className="flex flex-col items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <BarChart2 size={32} />
          <p className="text-sm">No edition data found for this period.</p>
          <p className="text-xs">Try a different date range or region.</p>
        </div>
      ) : (
        <>
          {/* ── Summary strip ──────────────────────────────────────────── */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="card p-4">
                <div className="text-2xl font-bold" style={{ color: '#3b82f6' }}>{stats.edCount}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Editions Tracked</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>{days}-day window</div>
              </div>
              <div className="card p-4">
                <div className="text-2xl font-bold" style={{ color: '#d71920' }}>{stats.pct}%</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Release Delays</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>{stats.delayed} of {stats.total} edition-days</div>
              </div>
              <div className="card p-4">
                <div className="text-2xl font-bold" style={{ color: '#C9A227' }}>{fmtDelay(stats.worst?.avg_delay || 0)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Worst Avg Delay</div>
                <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>{stats.worst?.edition_name}</div>
              </div>
              {/* Legend */}
              <div className="card p-4 flex flex-col justify-center gap-1.5">
                {[['#10b981','On Time (≤ 0 min)'],['#C9A227','Warning (1–30 min)'],['#d71920','Late (> 30 min)']].map(([clr, lbl]) => (
                  <span key={clr} className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                    <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: clr }} />{lbl}
                  </span>
                ))}
                <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: 'var(--border)' }} />No Data
                </span>
              </div>
            </div>
          )}

          {/* ── Heatmap table ───────────────────────────────────────────── */}
          <SectionCard
            className="mb-4"
            title={
              <span>
                Edition Delay Heatmap
                <span className="ml-2 text-sm font-normal" style={{ color: 'var(--muted)' }}>
                  {editions.length} editions · {dates.length} days
                  {search && ` · filtered`}
                </span>
                <span className="ml-3 text-xs font-normal" style={{ color: 'var(--muted)' }}>
                  Click a row for detail chart ↓
                </span>
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" style={{ width: '100%' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    {/* Sticky edition name */}
                    <th className="p-2 text-left font-semibold sticky left-0 z-10 border-b"
                      style={{ background: 'var(--surface)', borderColor: 'var(--border)', minWidth: 170 }}>
                      Edition
                    </th>
                    <th className="p-2 text-left font-normal border-b border-l"
                      style={{ color: 'var(--muted)', borderColor: 'var(--border)', minWidth: 90 }}>
                      Unit
                    </th>
                    {/* Date columns */}
                    {dates.map(dt => {
                      const { day, num } = dayLabel(dt);
                      return (
                        <th key={dt} className="p-2 text-center font-medium border-b border-l"
                          style={{ color: 'var(--muted)', borderColor: 'var(--border)', minWidth: 68 }}>
                          <div className="font-semibold">{day}</div>
                          <div className="opacity-70">{num}</div>
                        </th>
                      );
                    })}
                    {/* Summary columns */}
                    <th className="p-2 text-center font-semibold border-b border-l"
                      style={{ color: '#C9A227', borderColor: 'var(--border)', minWidth: 68 }}>Avg</th>
                    <th className="p-2 text-center font-semibold border-b border-l"
                      style={{ color: '#d71920', borderColor: 'var(--border)', minWidth: 68 }}>Max</th>
                    <th className="p-2 text-center font-semibold border-b border-l"
                      style={{ color: 'var(--muted)', borderColor: 'var(--border)', minWidth: 72 }}>Days Late</th>
                  </tr>
                </thead>
                <tbody>
                  {editions.map(ed => {
                    const isSel = selectedEd === ed.code;
                    const avgC  = ed.avg_delay > 30 ? '#d71920' : ed.avg_delay > 0 ? '#C9A227' : '#10b981';
                    const maxC  = ed.max_delay > 30 ? '#d71920' : ed.max_delay > 0 ? '#C9A227' : '#10b981';
                    return (
                      <tr key={ed.code}
                        className="border-t transition-colors cursor-pointer"
                        style={{
                          borderColor: 'var(--border)',
                          background: isSel ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : 'transparent',
                          outline:    isSel ? '2px solid var(--brand)' : 'none',
                          outlineOffset: '-2px',
                        }}
                        onClick={() => setSelectedEd(isSel ? null : ed.code)}
                      >
                        {/* Edition name — sticky */}
                        <td className="p-2 font-semibold sticky left-0 z-10 whitespace-nowrap"
                          style={{ background: isSel ? 'color-mix(in srgb, var(--brand) 10%, var(--surface))' : 'var(--surface)' }}>
                          <div>{ed.edition_name || ed.code}</div>
                          {ed.district && <div className="text-xs font-normal" style={{ color: 'var(--muted)' }}>{ed.district}</div>}
                        </td>
                        {/* Unit */}
                        <td className="p-2 border-l whitespace-nowrap" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
                          {ed.unit || '—'}
                        </td>
                        {/* Heat cells per day */}
                        {dates.map(dt => <HeatCell key={dt} d={ed.days[dt]} />)}
                        {/* Avg delay */}
                        <td className="p-2 text-center font-bold font-mono border-l" style={{ color: avgC, borderColor: 'var(--border)' }}>
                          {fmtDelay(ed.avg_delay)}
                        </td>
                        {/* Max delay */}
                        <td className="p-2 text-center font-bold font-mono border-l" style={{ color: maxC, borderColor: 'var(--border)' }}>
                          {fmtDelay(ed.max_delay)}
                        </td>
                        {/* Days late */}
                        <td className="p-2 text-center border-l" style={{ borderColor: 'var(--border)' }}>
                          <span className="rounded px-1.5 py-0.5 font-semibold"
                            style={{
                              background: ed.delayed_days > 0 ? '#d7192015' : '#10b98115',
                              color:      ed.delayed_days > 0 ? '#d71920'   : '#10b981',
                            }}>
                            {ed.delayed_days}/{ed.data_days}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* ── Detail bar chart for selected edition ───────────────────── */}
          {selEd && chartData.length > 0 && (
            <SectionCard title={
              <span className="flex items-center gap-2">
                <BarChart2 size={15} />
                Delay Trend —{' '}
                <strong>{selEd.edition_name}</strong>
                {selEd.unit && (
                  <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>
                    {selEd.unit}{selEd.district ? ` · ${selEd.district}` : ''}
                  </span>
                )}
                <button onClick={() => setSelectedEd(null)} className="ml-auto p-0.5">
                  <X size={14} style={{ color: 'var(--muted)' }} />
                </button>
              </span>
            }>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} tick={{ fontSize: 11 }} />
                  <YAxis
                    stroke="var(--muted)" fontSize={11}
                    tickFormatter={v => {
                      const abs = Math.abs(v), h = Math.floor(abs/60), m = abs%60;
                      return `${v<0?'-':''}${h}:${String(m).padStart(2,'0')}`;
                    }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      if (d.delay === null) return null;
                      const c = d.status==='late'?'#d71920':d.status==='warn'?'#C9A227':'#10b981';
                      return (
                        <div className="rounded-xl border p-3 text-xs shadow-lg"
                          style={{ background: 'var(--surface)', borderColor: 'var(--border)', minWidth: 130 }}>
                          <div className="font-bold mb-1">{d.date}</div>
                          <div style={{ color: c }}>Delay: <strong>{d.hhmm}</strong></div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" strokeWidth={2} />
                  <Bar dataKey="delay" radius={[4, 4, 0, 0]} barSize={28}
                    label={{
                      position: 'top', fontSize: 10,
                      formatter: v => v === null ? '' : fmtDelay(v),
                    }}>
                    {chartData.map((d, i) => (
                      <Cell key={i}
                        fill={
                          d.delay === null  ? 'var(--border)' :
                          d.status==='ontime' ? '#10b981' :
                          d.status==='warn'   ? '#C9A227' :
                                               '#d71920'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
