import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  FileText, Clock, AlertCircle, MapPin, Scale, Users,
  Bell, Camera, Newspaper, TrendingUp, PenLine,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { KPICard, SectionCard, PageHeader } from '../components/UI.jsx';

const PIE_COLORS = ['#d71920', '#C9A227', '#8c0a0e', '#e8843a', '#3b82f6', '#16a34a', '#7c3aed', '#0891b2'];

const TICKER_STYLE = `
@keyframes wire-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.wire-track {
  display: flex;
  width: max-content;
  animation: wire-scroll linear infinite;
}
.wire-track:hover { animation-play-state: paused; }
`;

function WireTicker({ feeds }) {
  const allArticles = feeds.flatMap(f =>
    (f.articles || []).map(a => ({ ...a, color: f.color, label: f.label }))
  );
  if (!allArticles.length) return null;
  const items = [...allArticles, ...allArticles];
  const duration = Math.max(60, allArticles.length * 3);
  return (
    <div className="card overflow-hidden mb-4" style={{ borderLeft: '4px solid #d71920' }}>
      <style>{TICKER_STYLE}</style>
      <div className="flex items-center">
        <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-bold whitespace-nowrap"
          style={{ background: '#d71920', color: '#fff', minWidth: 90 }}>
          <Newspaper size={12} />
          LIVE NEWS
        </div>
        <div className="flex-1 overflow-hidden relative" style={{ height: 40 }}>
          <div
            className="wire-track absolute top-0 left-0 h-full items-center"
            style={{ animationDuration: `${duration}s` }}
          >
            {items.map((art, i) => (
              <a
                key={i}
                href={art.link || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 text-sm font-medium whitespace-nowrap hover:underline"
                style={{ color: 'var(--text)', height: 40 }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: art.color }} />
                <span className="text-xs font-bold mr-1" style={{ color: art.color, opacity: 0.8 }}>{art.label}</span>
                {art.title}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t, state, branch } = useApp();
  const [d, setD]           = useState(null);
  const [topDelay, setTopDelay] = useState([]);
  const [feeds, setFeeds]   = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [gradingTop, setGradingTop]       = useState(null);
  const [gradingTopLoading, setGTLoading] = useState(true);

  useEffect(() => {
    api.editorialFeeds().then(d => setFeeds(d.feeds || [])).catch(() => {});
  }, []);

  useEffect(() => {
    api.hrAdminStats(state, branch)
      .then(r => setProfiles(r?.profiles || []))
      .catch(() => setProfiles([]));
  }, [state, branch]);

  useEffect(() => {
    setGTLoading(true);
    api.hrGradingTop(state, branch)
      .then(r => { setGradingTop(r || { top3: [], worst3: [], month: '' }); setGTLoading(false); })
      .catch(() => { setGradingTop({ top3: [], worst3: [], month: '' }); setGTLoading(false); });
  }, [state, branch]);

  useEffect(() => {
    setD(null);
    api.dashboard(state, branch).then(setD).catch(() => setD({}));
    api.weeklyTrend(state, branch, 7).then(r => {
      // Aggregate last 7 days: sum delay_minutes per edition, compute avg
      const map = {};
      (r.editions || []).forEach(ed => {
        const vals = Object.values(ed.days || {}).map(day => day.delay_minutes).filter(m => m > 0);
        if (!vals.length) return;
        const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        const max = Math.max(...vals);
        map[ed.code] = {
          edition_name: ed.edition_name,
          unit:         ed.unit,
          state:        ed.state,
          delayed_days: ed.delayed_days,
          avg_delay:    avg,
          max_delay:    max,
        };
      });
      const sorted = Object.values(map)
        .filter(e => e.avg_delay > 0)
        .sort((a, b) => b.avg_delay - a.avg_delay)
        .slice(0, 10);
      setTopDelay(sorted);
    }).catch(() => {});
  }, [state, branch]);

  if (!d) return <Skel />;

  const k             = d.kpis         || {};
  const trend7days    = d.trend7days   || [];
  const profilePie    = d.profilePie   || [];
  const editionDelays = d.editionDelays|| [];

  const subtitle = [state !== 'All' ? state : null, branch !== 'All' ? branch : null]
    .filter(Boolean).join(' › ') || 'All States';

  return (
    <div>
      <WireTicker feeds={feeds} />
      <PageHeader title={t('nav.home')} subtitle={subtitle} />

      {/* ── KPI Grid ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <KPICard
          label="Target Hit (5 Stories)"
          value={k.totalReporters ? `${k.reporterHit}/${k.totalReporters}` : '—'}
          sub="reporters · yesterday"
          accent={k.reporterHit > 0 && k.reporterHit >= k.totalReporters * 0.5 ? '#16a34a' : '#d71920'}
          icon={PenLine}
        />
        <KPICard
          label="Field Visits"
          value={k.visits ?? '—'}
          sub="yesterday"
          accent="#16a34a"
          icon={MapPin}
        />
        <KPICard
          label="QC Mistakes"
          value={k.qcMistakes ?? '—'}
          sub="last 7 days"
          accent={k.qcMistakes > 0 ? '#d71920' : '#16a34a'}
          icon={AlertCircle}
        />
        <KPICard
          label="Editions Tracked"
          value={k.editions ?? '—'}
          sub={`${k.onTime ?? 0} on time`}
          accent="#C9A227"
          icon={Newspaper}
        />
        <KPICard
          label="Delayed Editions"
          value={k.delayed ?? '—'}
          sub="over schedule"
          accent={k.delayed > 0 ? '#d71920' : '#16a34a'}
          icon={Clock}
        />
        <KPICard
          label="Unread Alerts"
          value={k.alerts ?? '—'}
          sub="pending"
          accent={k.alerts > 0 ? '#e8843a' : '#16a34a'}
          icon={Bell}
        />
      </div>

      {/* ── Row 1: Trend + Profile Pie ────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">

        <SectionCard title="7-Day Story & QC Trend" className="lg:col-span-2">
          {trend7days.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={trend7days} margin={{ left: -10, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gStory" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d71920" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#d71920" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPhoto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tick={{ dy: 4 }} />
                <YAxis yAxisId="left" stroke="var(--muted)" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  yAxisId="left" type="monotone" dataKey="stories" name="Stories"
                  stroke="#d71920" strokeWidth={2} fill="url(#gStory)"
                />
                <Area
                  yAxisId="left" type="monotone" dataKey="photos" name="Photos"
                  stroke="#3b82f6" strokeWidth={1.5} fill="url(#gPhoto)"
                />
                <Bar
                  yAxisId="right" dataKey="mistakes" name="QC Mistakes"
                  fill="#C9A227" radius={[4, 4, 0, 0]} barSize={10}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState msg="No trend data for the past 7 days" />
          )}
        </SectionCard>

        <SectionCard title="Staff Profile (Story Type)">
          {profilePie.length ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={profilePie} dataKey="value" nameKey="name"
                    innerRadius={45} outerRadius={78} paddingAngle={2}
                  >
                    {profilePie.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                {profilePie.slice(0, 8).map((s, i) => (
                  <span key={s.name} className="flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    {s.name} ({s.value})
                  </span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState msg="No profile data available" />
          )}
        </SectionCard>
      </div>

      {/* ── Top 10 Delayed Editions (Last 7 Days) ───────────────────────────── */}
      <div className="mt-4">
        <SectionCard title="Top 10 Delayed Editions — Last 7 Days">
          {topDelay.length === 0 ? (
            <EmptyState msg="No delay data for the past 7 days" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    <th className="pb-2 pr-4 font-medium w-6">#</th>
                    <th className="pb-2 pr-4 font-medium">Edition</th>
                    <th className="pb-2 pr-4 font-medium">Unit</th>
                    <th className="pb-2 pr-4 font-medium">State</th>
                    <th className="pb-2 pr-4 font-medium text-center">Days Late</th>
                    <th className="pb-2 pr-4 font-medium text-center">Avg Delay</th>
                    <th className="pb-2 font-medium text-center">Max Delay</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {topDelay.map((e, i) => {
                    const avgH = Math.floor(e.avg_delay / 60);
                    const avgM = e.avg_delay % 60;
                    const maxH = Math.floor(e.max_delay / 60);
                    const maxM = e.max_delay % 60;
                    const fmtD = (h, m) => `+${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                    const rankColor = i === 0 ? '#dc2626' : i === 1 ? '#ea580c' : i === 2 ? '#ca8a04' : 'var(--muted)';
                    const barPct = topDelay[0]?.avg_delay ? Math.round((e.avg_delay / topDelay[0].avg_delay) * 100) : 0;
                    return (
                      <tr key={e.edition_name} className="group">
                        <td className="py-2.5 pr-4">
                          <span className="text-xs font-bold" style={{ color: rankColor }}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-medium">{e.edition_name}</td>
                        <td className="py-2.5 pr-4 text-xs" style={{ color: 'var(--muted)' }}>{e.unit || '—'}</td>
                        <td className="py-2.5 pr-4 text-xs" style={{ color: 'var(--muted)' }}>{e.state || '—'}</td>
                        <td className="py-2.5 pr-4 text-center">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: '#fee2e2', color: '#b91c1c' }}>
                            {e.delayed_days}/7
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)', minWidth: 60 }}>
                              <div className="h-1.5 rounded-full" style={{ width: `${barPct}%`, background: '#dc2626' }} />
                            </div>
                            <span className="text-xs font-semibold tabular-nums" style={{ color: '#dc2626', minWidth: 48 }}>
                              {fmtD(avgH, avgM)}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 text-center text-xs font-semibold tabular-nums" style={{ color: '#ea580c' }}>
                          {fmtD(maxH, maxM)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Top 3 / Worst 3 Employees — Previous Month ──────────────────────── */}
      <div className="mt-4">
          <SectionCard title={`Employee Performance — ${gradingTop?.month ? new Date(gradingTop.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : 'Previous Month'} (PLI & Grading)`}>
            {gradingTopLoading ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
            ) : (
            <div className="grid gap-4 sm:grid-cols-2">

              {/* Top 3 */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🏆</span>
                  <span className="font-semibold text-sm" style={{ color: '#16a34a' }}>Top Performers</span>
                </div>
                {!gradingTop?.top3?.length ? (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>No grading data for previous month</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {gradingTop.top3.map((emp, i) => {
                      const medals = ['🥇', '🥈', '🥉'];
                      const barColors = ['#16a34a', '#22c55e', '#4ade80'];
                      return (
                        <div key={emp.pan} className="flex items-center gap-3 p-2 rounded-lg"
                          style={{ background: `rgba(22,163,74,${0.08 - i * 0.02})`, border: '1px solid rgba(22,163,74,0.2)' }}>
                          <span className="text-xl flex-shrink-0">{medals[i]}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm truncate">{emp.name}</div>
                            <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                              {emp.story_type} · {emp.branch}
                              {''}
                            </div>
                            <div className="mt-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                              <div className="h-1.5 rounded-full transition-all"
                                style={{ width: `${emp.score_pct}%`, background: barColors[i] }} />
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className="text-lg font-bold tabular-nums" style={{ color: barColors[i] }}>
                              {emp.score_pct}%
                            </div>
                            <div className="text-xs" style={{ color: 'var(--muted)' }}>grade</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Worst 3 */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">⚠️</span>
                  <span className="font-semibold text-sm" style={{ color: '#dc2626' }}>Need Improvement</span>
                </div>
                {!gradingTop?.worst3?.length ? (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>No grading data for previous month</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {gradingTop.worst3.map((emp, i) => {
                      const barColors = ['#dc2626', '#ef4444', '#f87171'];
                      return (
                        <div key={emp.pan} className="flex items-center gap-3 p-2 rounded-lg"
                          style={{ background: `rgba(220,38,38,${0.08 - i * 0.02})`, border: '1px solid rgba(220,38,38,0.2)' }}>
                          <span className="text-xl flex-shrink-0">{['🔴','🟠','🟡'][i]}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm truncate">{emp.name}</div>
                            <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                              {emp.story_type} · {emp.branch}
                              {''}
                            </div>
                            <div className="mt-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                              <div className="h-1.5 rounded-full transition-all"
                                style={{ width: `${emp.score_pct}%`, background: barColors[i] }} />
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className="text-lg font-bold tabular-nums" style={{ color: barColors[i] }}>
                              {emp.score_pct}%
                            </div>
                            <div className="text-xs" style={{ color: 'var(--muted)' }}>grade</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            )}
          </SectionCard>
        </div>

      {/* ── Profile-wise: Sanctioned vs Available ───────────────────────────── */}
      <div className="mt-4">
        <SectionCard title="Profile-wise: Sanctioned vs Available (Active Members)">
          {profiles.length === 0 ? (
            <EmptyState msg="No profile data available" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    <th className="pb-2 pr-4 font-medium">Profile (Story Type)</th>
                    <th className="pb-2 pr-4 font-medium text-right">Available</th>
                    <th className="pb-2 pr-4 font-medium text-right">Sanctioned</th>
                    <th className="pb-2 font-medium text-right">Vacant</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {profiles.map(p => (
                    <tr key={p.profile}>
                      <td className="py-2 pr-4 font-semibold">{p.profile}</td>
                      <td className="py-2 pr-4 text-right">{p.available}</td>
                      <td className="py-2 pr-4 text-right">
                        {p.sanctionedCount != null ? p.sanctionedCount : <span style={{ color: 'var(--muted)' }}>Not set</span>}
                      </td>
                      <td className="py-2 text-right">
                        {p.vacant != null ? (
                          <span style={{ color: p.vacant > 0 ? '#d71920' : '#10b981', fontWeight: 600 }}>
                            {p.vacant > 0 ? p.vacant : 'Full'}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>{msg}</p>
  );
}

function Skel() {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="card h-24 animate-pulse" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 h-72 animate-pulse" />
        <div className="card h-72 animate-pulse" />
      </div>
      <div className="mt-4 card h-64 animate-pulse" />
    </div>
  );
}
