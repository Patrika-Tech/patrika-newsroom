import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts';
import {
  CheckCircle2, AlertTriangle, Clock, TrendingUp, Download,
  RefreshCw, Loader2, ChevronLeft, ChevronRight, AlarmClock,
  Send, Bell, BellOff, X, Save, FileStack, LayoutList,
  ChevronDown, ChevronUp, GitBranch,
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

  const configured = recipients.filter(r => r.telegram_chat_id).length;
  const filtered   = recipients.filter(r => {
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
      <div className="card relative z-10 flex flex-col max-h-[90vh] w-full max-w-2xl">

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

          {/* ── Search + stats ── */}
          {!loading && recipients.length > 0 && (
            <div className="flex items-center gap-3 mb-3">
              <input className="input py-1.5 text-sm flex-1"
                placeholder="Search name, branch, state…"
                value={search} onChange={e => setSearch(e.target.value)} />
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                <Bell size={12} className="inline mr-1" style={{ color: '#10b981' }} />
                {configured} / {recipients.length} registered
              </span>
              <button onClick={() => loadRecipients(true)}
                className="btn-ghost p-1.5 rounded-lg" title="Refresh">
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
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
                <tr className="text-left text-xs border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
                  <th className="p-2 pb-3">Name</th>
                  <th className="p-2 pb-3">Role</th>
                  <th className="p-2 pb-3">Branch · State</th>
                  <th className="p-2 pb-3">Status / Chat ID</th>
                  <th className="p-2 pb-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const hasTg  = !!(r.telegram_chat_id);
                  const edited = (edits[r.pan_no] ?? '') !== (r.telegram_chat_id || '');
                  return (
                    <tr key={r.pan_no} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 font-semibold whitespace-nowrap text-xs">{r.EMPNAME}</td>
                      <td className="p-2 text-xs">
                        <span className="rounded px-1.5 py-0.5"
                          style={{ background: r.Story_Type === 'RE' ? '#3b82f618' : '#C9A22718',
                                   color:      r.Story_Type === 'RE' ? '#3b82f6'   : '#C9A227' }}>
                          {r.Story_Type || r.emp_designation || '—'}
                        </span>
                      </td>
                      <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.Branch}<br />{r.State}
                      </td>
                      <td className="p-2">
                        {hasTg ? (
                          <div className="flex items-center gap-1.5">
                            <Bell size={12} style={{ color: '#10b981', flexShrink: 0 }} />
                            <input className="input py-0.5 text-xs w-28"
                              value={edits[r.pan_no] ?? ''}
                              onChange={e => setEdits(p => ({ ...p, [r.pan_no]: e.target.value }))} />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <BellOff size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <span className="text-xs" style={{ color: 'var(--muted)' }}>
                              Not registered
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        {hasTg && (
                          <button onClick={() => save(r.pan_no)}
                            disabled={saving === r.pan_no || !edited}
                            className="text-xs px-2 py-1 rounded font-medium flex items-center gap-1"
                            style={{ background: edited ? 'var(--brand)' : 'var(--bg)', color: edited ? '#fff' : 'var(--muted)' }}>
                            {saving === r.pan_no ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                            Save
                          </button>
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
  const { t } = useApp();
  const [activeTab,  setActiveTab]  = useState('monitor'); // 'monitor' | 'journey'
  const [date,       setDate]       = useState(today());
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [region,     setRegion]     = useState('ALL'); // ALL | RAJ | MPCG
  const [search,     setSearch]     = useState('');
  const [sending,    setSending]    = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  const load = (d) => {
    setLoading(true);
    api.production(d)
      .then(setData)
      .finally(() => setLoading(false));
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

  useEffect(() => { load(date); }, [date]);

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
        ].map(({ id, label, icon: Icon }) => (
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

      {/* ── Production Monitor tab ───────────────────────────────────────── */}
      {activeTab !== 'journey' && <>

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

      {showConfig && <TelegramConfigModal onClose={() => setShowConfig(false)} />}

      </> /* end Production Monitor tab */}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE JOURNEY TAB
// ═══════════════════════════════════════════════════════════════════════════════

// Time display helper
function fmtT(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
  const [journeyData, setJourneyData] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [activeEd,    setActiveEd]    = useState(null);
  const [sortBy,      setSortBy]      = useState('page');

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
      .then(data => {
        setJourneyData(data);
        if (data.editions?.length) setActiveEd(data.editions[0].code);
        else setActiveEd(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(date); }, [date]);

  const editions  = journeyData?.editions || [];
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
          {/* Edition tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {editions.map(ed => (
              <button key={ed.code} onClick={() => setActiveEd(ed.code)}
                className="rounded-lg px-3 py-2 text-sm transition text-left"
                style={{
                  background: activeEd === ed.code ? 'var(--brand)' : 'var(--bg)',
                  color:      activeEd === ed.code ? '#fff' : 'inherit',
                  border:     `1px solid ${activeEd === ed.code ? 'var(--brand)' : 'var(--border)'}`,
                }}>
                <span className="font-semibold block leading-tight">
                  {ed.edition_name || ed.code}
                </span>
                <span className="text-xs opacity-70 block">
                  {ed.unit && ed.unit !== ed.edition_name ? `${ed.unit} · ` : ''}
                  {ed.total_pages}{ed.scheduled_pages > 0 ? `/${ed.scheduled_pages}` : ''} pages
                  {' · '}{ed.revised_pages > 0 ? `${ed.revised_pages} rev` : '✓'}
                </span>
              </button>
            ))}
          </div>

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
