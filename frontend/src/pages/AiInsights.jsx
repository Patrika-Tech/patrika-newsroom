import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, Send, Copy, Check, RefreshCw, TrendingUp, TrendingDown,
  Minus, ShieldCheck, Users, BookOpen, Camera,
  FileText, UserX, Loader2, Trophy, AlertCircle, BarChart2,
} from 'lucide-react';
import { useApp }                    from '../context/AppContext.jsx';
import { api }                       from '../api/client.js';
import { PageHeader, SectionCard }   from '../components/UI.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n)  { return Number(n || 0).toLocaleString('en-IN'); }
function fmtK(n) { const v = Number(n || 0); return v >= 1000 ? (v / 1000).toFixed(1) + 'K' : String(v); }
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

// ── Mini bar ──────────────────────────────────────────────────────────────────
function MiniBar({ value, max, color = 'var(--brand)' }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'var(--border)', minWidth: 48 }}>
      <div className="h-full rounded-full" style={{ width: p + '%', background: color }} />
    </div>
  );
}

// ── Trend icon ────────────────────────────────────────────────────────────────
function TrendIcon({ trend }) {
  if (trend === 'up')   return <TrendingUp   size={13} style={{ color: '#22c55e' }} />;
  if (trend === 'down') return <TrendingDown size={13} style={{ color: '#ef4444' }} />;
  return <Minus size={13} style={{ color: 'var(--muted)' }} />;
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className="flex items-center gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--muted)' }}>
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ h = 16, w = '100%', rounded = 'rounded' }) {
  return <div className={`${rounded} animate-pulse`} style={{ height: h, width: w, background: 'var(--border)' }} />;
}

// ── Branch row card ───────────────────────────────────────────────────────────
// All metrics are per-reporter averages for fair comparison across branch sizes
const RANK_META = {
  score:           { label: 'Overall',     key: 'score',           higher: true,  fmt: v => v + ' pts',    color: '#6366f1' },
  stories_per_rep: { label: 'Stories/Rep', key: 'stories_per_rep', higher: true,  fmt: v => v + '/rep',    color: '#0ea5e9' },
  active_rate:     { label: 'Active Rate', key: 'active_rate',     higher: true,  fmt: v => v + '%',        color: '#22c55e' },
  leave_rate:      { label: 'Leave Rate',  key: 'leave_rate',      higher: false, fmt: v => v + '% leave',  color: '#f59e0b' },
  qc_per_rep:      { label: 'QC/Rep',      key: 'qc_per_rep',      higher: false, fmt: v => v + '/rep',    color: '#ef4444' },
};

function BranchCard({ rank, b, rankKey, isTop, maxSPR, maxQPR }) {
  const meta    = RANK_META[rankKey] || RANK_META.score;
  const primary = b[meta.key];

  // Bar shows the ranked metric; for "lower is better" metrics, invert bar so top = long bar
  let barVal, barMax;
  if (rankKey === 'active_rate')     { barVal = b.active_rate;     barMax = 100; }
  else if (rankKey === 'leave_rate') { barVal = 100 - b.leave_rate; barMax = 100; }
  else if (rankKey === 'qc_per_rep') { barVal = maxQPR - b.qc_per_rep; barMax = maxQPR; }
  else if (rankKey === 'stories_per_rep') { barVal = b.stories_per_rep; barMax = maxSPR; }
  else                               { barVal = b.score;           barMax = 100; }

  const barColor = isTop ? meta.color : (meta.higher ? '#ef4444' : '#22c55e');

  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-2">
        {/* Rank badge */}
        <div className="rounded-lg w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5"
          style={{ background: isTop ? '#22c55e18' : '#ef444418', color: isTop ? '#22c55e' : '#ef4444' }}>
          {rank}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + state + reporter count */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{b.branch}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--border)', color: 'var(--muted)' }}>{b.state}</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{b.total_reporters} reps</span>
          </div>

          {/* Mini bar */}
          <div className="my-1.5">
            <MiniBar value={barVal} max={barMax} color={barColor} />
          </div>

          {/* Per-reporter average metrics */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: 'var(--muted)' }}>
            <span title="Stories per reporter (7d)">📰 {b.stories_per_rep}/rep</span>
            <span title="Active reporters %" style={{ color: b.active_rate < 50 ? '#f59e0b' : 'inherit' }}>
              👥 {b.active_rate}% active
            </span>
            <span title="Reporters on leave %" style={{ color: b.leave_rate > 30 ? '#ef4444' : b.leave_rate > 15 ? '#f59e0b' : 'inherit' }}>
              🏖 {b.leave_rate}% leave
            </span>
            <span title="QC mistakes per reporter" style={{ color: b.qc_per_rep > 3 ? '#ef4444' : b.qc_per_rep > 1 ? '#f59e0b' : '#22c55e' }}>
              🔍 {b.qc_per_rep}/rep QC
            </span>
          </div>
        </div>

        {/* Primary metric value */}
        <div className="text-right flex-shrink-0 ml-1">
          <div className="text-sm font-bold" style={{ color: isTop ? '#22c55e' : '#ef4444' }}>
            {meta.fmt(primary)}
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{meta.label}</div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function AiInsights() {
  const { t, state: globalState, branch: globalBranch } = useApp();

  const [fastData,   setFastData]   = useState(null);
  const [trendsData, setTrendsData] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [rankBy,   setRankBy]   = useState('score');
  const [trendTab, setTrendTab] = useState('up');

  // Chat
  const [msgs,  setMsgs]  = useState([{
    role: 'ai',
    text: 'Namaste! Main Patrika ka AI assistant hoon. Branch performance, reporters, editions, QC ke baare mein kuch bhi poochh sakte hain.',
  }]);
  const [input, setInput] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [chips, setChips] = useState([
    'Top 3 branches by stories this week',
    'Which branch has worst active rate?',
    'QC mistakes by branch last 7 days',
    'Zero story reporters yesterday',
  ]);
  const chatEnd = useRef(null);

  const subtitle = [globalState !== 'All' ? globalState : null, globalBranch !== 'All' ? globalBranch : null]
    .filter(Boolean).join(' › ') || 'All States';

  // ── Load ────────────────────────────────────────────────────────────────────
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

      // Context-aware chips from data
      const bp = fast?.branchPerformance || [];
      const qcHot = fast?.qcHotspots?.[0];
      const newChips = [];
      if (bp.length) {
        const worst = [...bp].sort((a, b) => a.active_rate - b.active_rate)[0];
        if (worst) newChips.push(`${worst.branch} branch ki performance kyun weak hai?`);
      }
      if (qcHot) newChips.push(`${qcHot.state} mein QC issues ka breakdown do`);
      newChips.push('Top 5 reporters this week', 'Zero story reporters yesterday');
      setChips(newChips.slice(0, 4));
    } catch (e) {
      console.error('[AiInsights]', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [globalState, globalBranch]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Chat ────────────────────────────────────────────────────────────────────
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
      if (r.suggestions?.length) setChips(r.suggestions.slice(0, 4));
    } catch {
      setMsgs(m => [...m, { role: 'ai', text: 'Sorry, kuch error hua. Please try again.' }]);
    } finally {
      setBusy(false);
      setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const stats   = fastData?.briefingStats;
  const qcRows  = fastData?.qcHotspots       || [];
  const trends  = trendsData?.reporterTrends  || [];
  const branches = fastData?.branchPerformance || [];
  const maxQc    = Math.max(...qcRows.map(r => r.mistakes7d), 1);

  const trendFiltered = trends.filter(r => r.trend === trendTab);
  const tabCounts = {
    up:   trends.filter(r => r.trend === 'up').length,
    flat: trends.filter(r => r.trend === 'flat').length,
    down: trends.filter(r => r.trend === 'down').length,
  };

  // Branch ranking — all metrics are per-reporter averages
  const meta = RANK_META[rankBy] || RANK_META.score;
  const sorted = [...branches].sort((a, b) =>
    meta.higher ? b[meta.key] - a[meta.key] : a[meta.key] - b[meta.key]
  );
  const topBranches    = sorted.slice(0, 6);
  const bottomBranches = [...branches].sort((a, b) =>
    meta.higher ? a[meta.key] - b[meta.key] : b[meta.key] - a[meta.key]
  ).slice(0, 6);
  const maxSPR    = Math.max(...branches.map(b => b.stories_per_rep), 0.1);
  const maxQPR    = Math.max(...branches.map(b => b.qc_per_rep),      0.1);
  const perfWindow = fastData?.branchPerfWindow;
  const perfLabel  = perfWindow
    ? `${perfWindow.from.slice(5)} to ${perfWindow.to.slice(5)} (${perfWindow.days}d, d‑2)`
    : '7 days (d‑2)';

  return (
    <div>
      <PageHeader title={t('nav.ai') || 'AI Insights'} subtitle={subtitle}>
        <button className="btn-secondary flex items-center gap-2 text-sm"
          onClick={() => loadData(true)} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeader>

      {/* ── KPI tiles ───────────────────────────────────────────────────────── */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={76} rounded="rounded-xl" />)
        : stats ? (<>
          <StatTile icon={FileText} label="Stories (yesterday)" value={fmt(stats.stories)}       color="#6366f1" />
          <StatTile icon={Camera}   label="Photos filed"         value={fmt(stats.photos)}        color="#0ea5e9" />
          <StatTile icon={BookOpen} label="Words filed"          value={fmtK(stats.words) + 'W'} color="#10b981" />
          <StatTile icon={Users}    label="Active reporters"     value={fmt(stats.reporters)}     color="#f59e0b" />
          <StatTile icon={UserX}    label="Zero-story reporters" value={fmt(stats.zeroReporters)}
            color="#ef4444" warn={stats.zeroReporters > 5}
            sub={stats.zeroReporters > 0 ? 'filed nothing yesterday' : 'all active'} />
        </>) : <div className="col-span-5 text-sm" style={{ color: 'var(--muted)' }}>No data</div>}
      </div>

      {/* ── AI Morning Briefing ─────────────────────────────────────────────── */}
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

      {/* ── Branch Performance ───────────────────────────────────────────────── */}
      <SectionCard
        title={<span className="flex items-center gap-1.5"><BarChart2 size={13} style={{ color: '#6366f1' }} />Branch Performance — avg/reporter · {perfLabel}</span>}
        className="mb-4"
        action={
          <div className="flex gap-1 flex-wrap">
            {Object.entries(RANK_META).map(([key, m]) => (
              <button key={key} onClick={() => setRankBy(key)}
                className="rounded-full px-2.5 py-1 text-xs transition"
                style={rankBy === key
                  ? { background: m.color + '20', color: m.color, border: `1px solid ${m.color}40`, fontWeight: 600 }
                  : { background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={80} rounded="rounded-xl" />)}</div>
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={80} rounded="rounded-xl" />)}</div>
          </div>
        ) : branches.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>No branch data available</p>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {/* Top performers */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold" style={{ color: '#22c55e' }}>
                <Trophy size={13} /> Top Performers
              </div>
              <div className="space-y-2">
                {topBranches.map((b, i) => (
                  <BranchCard key={b.branch} rank={i + 1} b={b} rankKey={rankBy} isTop={true}
                    maxSPR={maxSPR} maxQPR={maxQPR} />
                ))}
              </div>
            </div>

            {/* Need improvement */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold" style={{ color: '#ef4444' }}>
                <AlertCircle size={13} /> Need Improvement
              </div>
              <div className="space-y-2">
                {bottomBranches.map((b, i) => (
                  <BranchCard key={b.branch} rank={i + 1} b={b} rankKey={rankBy} isTop={false}
                    maxSPR={maxSPR} maxQPR={maxQPR} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Summary stats bar — averages across all branches */}
        {!loading && branches.length > 0 && (() => {
          const n    = branches.length;
          const avgSPR = (branches.reduce((s, b) => s + b.stories_per_rep, 0) / n).toFixed(1);
          const avgAR  = Math.round(branches.reduce((s, b) => s + b.active_rate, 0)  / n);
          const avgLR  = Math.round(branches.reduce((s, b) => s + b.leave_rate,  0)  / n);
          const avgQPR = (branches.reduce((s, b) => s + b.qc_per_rep, 0) / n).toFixed(1);
          return (
            <div className="mt-4 pt-3 flex flex-wrap gap-4 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
              <span>{n} branches · avg across all</span>
              <span>📰 <strong style={{ color: 'var(--text)' }}>{avgSPR}</strong> stories/rep</span>
              <span>👥 <strong style={{ color: 'var(--text)' }}>{avgAR}%</strong> active rate</span>
              <span>🏖 <strong style={{ color: 'var(--text)' }}>{avgLR}%</strong> leave rate</span>
              <span>🔍 <strong style={{ color: 'var(--text)' }}>{avgQPR}</strong> QC/rep</span>
            </div>
          );
        })()}
      </SectionCard>

      {/* ── QC Hotspots ─────────────────────────────────────────────────────── */}
      <SectionCard title={<span className="flex items-center gap-1.5"><ShieldCheck size={13} style={{ color: '#ef4444' }} />QC Hotspots by State (7 days)</span>} className="mb-4">
        {loading ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={64} rounded="rounded-lg" />)}
          </div>
        ) : qcRows.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>No QC data</p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
            {qcRows.map(r => (
              <div key={r.state} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{r.state}</span>
                  <span className="text-xs font-bold" style={{ color: r.mistakes7d > 30 ? '#ef4444' : r.mistakes7d > 15 ? '#f59e0b' : '#22c55e' }}>
                    {fmt(r.mistakes7d)}
                  </span>
                </div>
                <MiniBar value={r.mistakes7d} max={maxQc} color={r.mistakes7d > 30 ? '#ef4444' : r.mistakes7d > 15 ? '#f59e0b' : '#22c55e'} />
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{r.checks} checks · avg {r.avgPerCheck}/check</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Reporter Trends ──────────────────────────────────────────────────── */}
      <SectionCard
        title={<span className="flex items-center gap-1.5"><TrendingUp size={13} style={{ color: '#22c55e' }} />Reporter Trends (7 days vs prev week)</span>}
        className="mb-4"
      >
        <div className="flex gap-2 mb-3">
          {[
            { id: 'up',   label: '↑ Improving', color: '#22c55e' },
            { id: 'flat', label: '→ Stable',    color: '#6366f1' },
            { id: 'down', label: '↓ Declining', color: '#ef4444' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setTrendTab(tab.id)}
              className="rounded-full px-3 py-1 text-xs font-medium transition"
              style={trendTab === tab.id
                ? { background: tab.color + '20', color: tab.color, border: `1px solid ${tab.color}40` }
                : { background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              {tab.label} ({tabCounts[tab.id] || 0})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={40} rounded="rounded-lg" />)}</div>
        ) : trendFiltered.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>No reporters in this category</p>
        ) : (
          <div className="space-y-1.5">
            {trendFiltered.slice(0, 10).map((r, i) => (
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
                    {pct(r.stories7d, r.prev7d)} vs prev
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── AI Chat ─────────────────────────────────────────────────────────── */}
      <SectionCard title={<span className="flex items-center gap-1.5"><Sparkles size={14} style={{ color: '#8b5cf6' }} />AI Newsroom Assistant</span>}>
        <div className="flex flex-col" style={{ height: 360 }}>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1 pb-2">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[82%] group relative">
                  <div className="rounded-2xl px-3.5 py-2 text-sm"
                    style={m.role === 'user'
                      ? { background: 'var(--brand)', color: '#fff' }
                      : { background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                    {(m.text || '').split('\n').map((line, j) => <span key={j}>{j > 0 && <br />}{line}</span>)}
                  </div>
                  {m.role === 'ai' && (
                    <div className="mt-1 flex justify-end"><CopyBtn text={m.text} /></div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2 text-xs flex items-center gap-2"
                  style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  <Loader2 size={12} className="animate-spin" /> Soch raha hoon…
                </div>
              </div>
            )}
            <div ref={chatEnd} />
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {chips.map(c => (
                <button key={c} onClick={() => ask(c)} disabled={busy}
                  className="rounded-full px-3 py-1.5 text-xs transition hover:opacity-80"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input className="input text-sm"
              placeholder="Branch, reporter, QC, editions — kuch bhi poochh…"
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && ask()}
              disabled={busy} />
            <button className="btn-primary px-3" onClick={() => ask()} disabled={busy || !input.trim()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
