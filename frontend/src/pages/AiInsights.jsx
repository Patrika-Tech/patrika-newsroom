import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, Send, Copy, Check, RefreshCw, TrendingUp, TrendingDown,
  Minus, ShieldCheck, Users, BookOpen, Camera,
  FileText, UserX, Loader2,
} from 'lucide-react';
import { useApp }                    from '../context/AppContext.jsx';
import { api }                       from '../api/client.js';
import { PageHeader, SectionCard }   from '../components/UI.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }
function fmtK(n) {
  const v = Number(n || 0);
  return v >= 1000 ? (v / 1000).toFixed(1) + 'K' : String(v);
}
function pct(a, b) {
  if (!b) return a > 0 ? '+100%' : '—';
  const d = ((a - b) / b) * 100;
  return (d >= 0 ? '+' : '') + d.toFixed(0) + '%';
}

// ── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ icon: Icon, label, value, sub, color = 'var(--brand)', warn }) {
  return (
    <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="rounded-lg p-2 flex-shrink-0" style={{ background: color + '18' }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
        <div className="font-bold text-lg leading-none" style={{ color: warn ? '#ef4444' : 'var(--text)' }}>{value}</div>
        {sub && <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Trend arrow ───────────────────────────────────────────────────────────────
function TrendIcon({ trend }) {
  if (trend === 'up')   return <TrendingUp  size={14} style={{ color: '#22c55e' }} />;
  if (trend === 'down') return <TrendingDown size={14} style={{ color: '#ef4444' }} />;
  return <Minus size={14} style={{ color: 'var(--muted)' }} />;
}

// ── Mini bar ──────────────────────────────────────────────────────────────────
function MiniBar({ value, max, color = 'var(--brand)' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--border)', minWidth: 60 }}>
      <div className="h-full rounded-full transition-all" style={{ width: pct + '%', background: color }} />
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      title="Copy"
      className="flex items-center gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ color: 'var(--muted)' }}
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────
function ChatMsg({ m }) {
  const isUser = m.role === 'user';
  // Render newlines + bold numbers
  const rendered = (m.text || '').split('\n').map((line, i) => (
    <span key={i}>{i > 0 && <br />}{line}</span>
  ));
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[82%] group relative">
        <div
          className="rounded-2xl px-3.5 py-2 text-sm"
          style={isUser
            ? { background: 'var(--brand)', color: '#fff' }
            : { background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
        >
          {rendered}
        </div>
        {!isUser && (
          <div className="mt-1 flex justify-end">
            <CopyBtn text={m.text} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function Skeleton({ h = 16, w = '100%', rounded = 'rounded' }) {
  return <div className={`${rounded} animate-pulse`} style={{ height: h, width: w, background: 'var(--border)' }} />;
}

// ═════════════════════════════════════════════════════════════════════════════
export default function AiInsights() {
  const { t, state: globalState, branch: globalBranch } = useApp();

  const [fastData,   setFastData]   = useState(null);
  const [trendsData, setTrendsData] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [trendTab, setTrendTab] = useState('up');

  // Chat state
  const [msgs,  setMsgs]  = useState([{
    role: 'ai',
    text: 'Namaste! Main Patrika ka AI assistant hoon. Upar dikhe data ke baare mein ya reporters, editions, QC ke baare mein kuch bhi poochh sakte hain.',
  }]);
  const [input, setInput] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [chips, setChips] = useState([
    'Top 5 reporters last 7 days',
    'Zero story reporters yesterday',
    'QC mistakes by state this week',
    'Most active branch this month',
  ]);
  const chatEnd = useRef(null);

  const subtitle = [globalState !== 'All' ? globalState : null, globalBranch !== 'All' ? globalBranch : null]
    .filter(Boolean).join(' › ') || 'All States';

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [fast, trends] = await Promise.all([
        api.aiInsights(globalState, globalBranch, forceRefresh, 'fast'),
        api.aiInsights(globalState, globalBranch, forceRefresh, 'trends'),
      ]);
      setFastData(fast);
      setTrendsData(trends);

      // Context-aware chips based on loaded data
      const newChips = [];
      const critBeat = fast?.contentGaps?.find(g => g.severity === 'critical');
      const qcHot    = fast?.qcHotspots?.[0];
      const topRep   = fast?.briefingStats?.topReporters?.[0];
      if (critBeat) newChips.push(`${critBeat.beat} beat mein 3 din se 0 stories kyun?`);
      if (qcHot)    newChips.push(`${qcHot.state} mein QC mistakes zyada kyun hain?`);
      if (topRep)   newChips.push(`Who are the top reporters today?`);
      newChips.push('Zero story reporters yesterday');
      if (fast?.briefingStats?.zeroReporters > 0) newChips.push(`${fast.briefingStats.zeroReporters} reporters ne kal kuch file nahi kiya — list do`);
      setChips(newChips.slice(0, 5));
    } catch (e) {
      console.error('[AiInsights] load:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [globalState, globalBranch]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Chat ───────────────────────────────────────────────────────────────────
  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setMsgs(m => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
    try {
      const r = await api.aiAssistant(q);
      setMsgs(m => [...m, { role: 'ai', text: r.answer }]);
      if (r.suggestions?.length) setChips(r.suggestions.slice(0, 5));
    } catch {
      setMsgs(m => [...m, { role: 'ai', text: 'Sorry, kuch error hua. Please try again.' }]);
    } finally {
      setBusy(false);
      setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const stats  = fastData?.briefingStats;
  const qcRows = fastData?.qcHotspots   || [];
  const trends = trendsData?.reporterTrends || [];
  const maxQc  = Math.max(...qcRows.map(r => r.mistakes7d), 1);

  const trendFiltered = trends.filter(r => r.trend === trendTab);
  const tabCounts = { up: trends.filter(r => r.trend === 'up').length, flat: trends.filter(r => r.trend === 'flat').length, down: trends.filter(r => r.trend === 'down').length };

  return (
    <div>
      <PageHeader title={t('nav.ai') || 'AI Insights'} subtitle={subtitle}>
        <button
          className="btn-secondary flex items-center gap-2 text-sm"
          onClick={() => loadData(true)}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeader>

      {/* ── KPI tiles ────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={76} rounded="rounded-xl" />)
        ) : stats ? (<>
          <StatTile icon={FileText} label="Stories (yesterday)" value={fmt(stats.stories)} color="#6366f1" />
          <StatTile icon={Camera}   label="Photos filed"         value={fmt(stats.photos)}  color="#0ea5e9" />
          <StatTile icon={BookOpen} label="Words filed"          value={fmtK(stats.words) + 'W'} color="#10b981" />
          <StatTile icon={Users}    label="Active reporters"     value={fmt(stats.reporters)} color="#f59e0b" />
          <StatTile icon={UserX}    label="Zero-story reporters" value={fmt(stats.zeroReporters)}
            color="#ef4444" warn={stats.zeroReporters > 5}
            sub={stats.zeroReporters > 0 ? 'filed nothing yesterday' : 'all reporters active'} />
        </>) : (
          <div className="col-span-5 text-sm" style={{ color: 'var(--muted)' }}>No stats available</div>
        )}
      </div>

      {/* ── AI Morning Briefing ──────────────────────────────────────────────── */}
      {(loading || fastData?.briefing) && (
        <div className="rounded-xl p-4 mb-4" style={{ background: 'linear-gradient(135deg,#6366f108,#8b5cf608)', border: '1px solid #6366f130' }}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={15} style={{ color: '#8b5cf6' }} />
            <span className="font-semibold text-sm" style={{ color: '#8b5cf6' }}>AI Morning Briefing</span>
            {stats?.date && <span className="text-xs" style={{ color: 'var(--muted)' }}>— {stats.date}</span>}
          </div>
          {loading
            ? <><Skeleton h={12} /><div className="mt-2"><Skeleton h={12} w="75%" /></div></>
            : <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>{fastData.briefing}</p>
          }
        </div>
      )}

      {/* ── QC Hotspots ───────────────────────────────────────────────────────── */}
      <SectionCard title={<span className="flex items-center gap-1.5"><ShieldCheck size={13} style={{ color: '#ef4444' }} />QC Hotspots (7 days)</span>} className="mb-4">
        {loading ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))' }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={64} rounded="rounded-lg" />)}
          </div>
        ) : qcRows.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>No QC data</p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))' }}>
            {qcRows.map(r => (
              <div key={r.state} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{r.state}</span>
                  <span className="text-xs font-bold" style={{ color: r.mistakes7d > 30 ? '#ef4444' : r.mistakes7d > 15 ? '#f59e0b' : '#22c55e' }}>
                    {fmt(r.mistakes7d)} mistakes
                  </span>
                </div>
                <MiniBar value={r.mistakes7d} max={maxQc} color={r.mistakes7d > 30 ? '#ef4444' : r.mistakes7d > 15 ? '#f59e0b' : '#22c55e'} />
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  {r.checks} checks · avg {r.avgPerCheck}/check
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Reporter Trends ───────────────────────────────────────────────────── */}
      <SectionCard
        title={<span className="flex items-center gap-1.5"><TrendingUp size={13} style={{ color: '#22c55e' }} />Reporter Performance Trends (7 days)</span>}
        className="mb-4"
      >
        {/* Tab bar */}
        <div className="flex gap-2 mb-3">
          {[
            { id: 'up',   label: '↑ Improving', color: '#22c55e' },
            { id: 'flat', label: '→ Stable',    color: '#6366f1' },
            { id: 'down', label: '↓ Declining', color: '#ef4444' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setTrendTab(tab.id)}
              className="rounded-full px-3 py-1 text-xs font-medium transition"
              style={trendTab === tab.id
                ? { background: tab.color + '20', color: tab.color, border: `1px solid ${tab.color}40` }
                : { background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }
              }
            >
              {tab.label}
              <span className="ml-1 opacity-70">({tabCounts[tab.id] || 0})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={40} rounded="rounded-lg" />)}</div>
        ) : trendFiltered.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>
            No reporters in this category
          </p>
        ) : (
          <div className="space-y-1.5">
            {trendFiltered.slice(0, 10).map((r, i) => {
              const change = pct(r.stories7d, r.prev7d);
              return (
                <div key={r.name + i} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg)' }}>
                  <span className="text-xs w-5 text-right flex-shrink-0" style={{ color: 'var(--muted)' }}>{i + 1}</span>
                  <TrendIcon trend={r.trend} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{r.name}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>{r.branch} · {r.active7d} active days</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{fmt(r.stories7d)}</div>
                    <div className="text-xs" style={{ color: r.trend === 'up' ? '#22c55e' : r.trend === 'down' ? '#ef4444' : 'var(--muted)' }}>
                      {change} vs prev wk
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── AI Chat ──────────────────────────────────────────────────────────── */}
      <SectionCard title={<span className="flex items-center gap-1.5"><Sparkles size={14} style={{ color: '#8b5cf6' }} />AI Newsroom Assistant</span>}>
        <div className="flex flex-col" style={{ height: 380 }}>
          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto pr-1 pb-2">
            {msgs.map((m, i) => <ChatMsg key={i} m={m} />)}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2 text-xs flex items-center gap-2" style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  <Loader2 size={12} className="animate-spin" /> Soch raha hoon…
                </div>
              </div>
            )}
            <div ref={chatEnd} />
          </div>

          {/* Suggestion chips */}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {chips.slice(0, 4).map(c => (
                <button
                  key={c}
                  className="rounded-full px-3 py-1.5 text-xs transition hover:opacity-80"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  onClick={() => ask(c)}
                  disabled={busy}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="input text-sm"
              placeholder="Reporters, editions, QC, field visits — kuch bhi poochh…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && ask()}
              disabled={busy}
            />
            <button className="btn-primary px-3" onClick={() => ask()} disabled={busy || !input.trim()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
