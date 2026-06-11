import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  FileText, Clock, AlertCircle, MapPin, Scale, Users,
  Bell, Camera, Newspaper,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { KPICard, SectionCard, PageHeader } from '../components/UI.jsx';

const PIE_COLORS = ['#d71920', '#C9A227', '#8c0a0e', '#e8843a', '#3b82f6', '#16a34a', '#7c3aed', '#0891b2'];

export default function Dashboard() {
  const { t, state, branch } = useApp();
  const [d, setD] = useState(null);

  useEffect(() => {
    setD(null);
    api.dashboard(state, branch).then(setD).catch(() => setD({}));
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
      <PageHeader title={t('nav.home')} subtitle={subtitle} />

      {/* ── KPI Grid ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <KPICard
          label="Active Employees"
          value={k.employees ?? '—'}
          sub="in workforce"
          icon={Users}
        />
        <KPICard
          label="Stories Yesterday"
          value={k.stories ?? '—'}
          sub={`by ${k.reporters ?? 0} reporters`}
          icon={FileText}
        />
        <KPICard
          label="Photos Published"
          value={k.photos ?? '—'}
          sub="yesterday"
          accent="#3b82f6"
          icon={Camera}
        />
        <KPICard
          label="Field Visits"
          value={k.visits ?? '—'}
          sub="today"
          accent="#16a34a"
          icon={MapPin}
        />
        <KPICard
          label="QC Mistakes"
          value={k.qcMistakes ?? '—'}
          sub="yesterday"
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
          label="Legal Cases"
          value={k.legal ?? '—'}
          sub="active"
          accent="#7c3aed"
          icon={Scale}
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

      {/* ── Row 2: Edition Delays ────────────────────────────────────────────── */}
      <div className="mt-4">
        <SectionCard title={`Edition Delays — Yesterday${editionDelays.length ? ` (${editionDelays.length} editions)` : ''}`}>
          {editionDelays.length ? (
            <>
              <ResponsiveContainer width="100%" height={Math.max(180, editionDelays.length * 28)}>
                <BarChart
                  data={editionDelays}
                  layout="vertical"
                  margin={{ left: 90, right: 50, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number" stroke="var(--muted)" fontSize={11}
                    tickFormatter={v => { const a = Math.abs(v); return `${Math.floor(a/60)}:${String(a%60).padStart(2,'0')}`; }}
                    label={{ value: 'hh:mm', position: 'insideRight', offset: -2, fontSize: 10, fill: 'var(--muted)' }}
                  />
                  <YAxis type="category" dataKey="edition" stroke="var(--muted)" fontSize={11} width={86} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}
                    formatter={(v, _n, props) => [props.payload?.delay_hhmm || `${v > 0 ? '+' : ''}${v}`, 'Delay']}
                  />
                  <Bar dataKey="delay" radius={[0, 4, 4, 0]} barSize={14}>
                    {editionDelays.map((e, i) => (
                      <Cell
                        key={i}
                        fill={e.status === 'ontime' ? '#16a34a' : e.status === 'warn' ? '#C9A227' : '#d71920'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex gap-4 text-xs justify-end" style={{ color: 'var(--muted)' }}>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#16a34a' }} /> On Time (≤0 min)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#C9A227' }} /> Warn (00:01–00:30)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#d71920' }} /> Late (&gt;00:30)
                </span>
              </div>
            </>
          ) : (
            <EmptyState msg="No edition data available for yesterday" />
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
