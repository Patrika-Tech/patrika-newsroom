/**
 * Editorial Command Centre
 * 4 tabs:
 *   📰 News Feed     — RSS from PIB / NDTV / The Wire / Google News + story anniversaries
 *   📅 Calendar      — Monthly prominent-days grid + editorial planning overlay
 *   📊 Story Intel   — Story-type mix, target vs actual, coverage gaps
 *   🗺️  Newsroom     — Top News by state, planning board, desk review, R&D ideas
 */
import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell,
} from 'recharts';
import {
  Newspaper, CalendarDays, LayoutGrid,
  ExternalLink, RefreshCw, ChevronLeft, ChevronRight,
  Clock, Lightbulb, Users, FileText, Target, TrendingUp, AlertTriangle,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'feed',     icon: Newspaper,    label: 'News Feed' },
  { id: 'calendar', icon: CalendarDays, label: 'Calendar'  },
];

// ── Type colours for calendar dots ───────────────────────────────────────────
const TYPE_COLOR = {
  national:'#d71920', festival:'#C9A227', state:'#e8843a',
  media:'#7c3aed', health:'#16a34a', environment:'#0891b2',
  sports:'#3b82f6', social:'#6b7280',
  // Hyperlocal state types
  local_raj:'#f97316', local_mp:'#8b5cf6', local_cg:'#0891b2', local_mpcg:'#C9A227',
};
const DOT_LABEL = {
  national:'National', festival:'Festival', state:'State Event',
  media:'Media', health:'Health', environment:'Environment',
  sports:'Sports', social:'Social',
  local_raj:'🟠 Rajasthan', local_mp:'🟣 MP', local_cg:'🔵 CG', local_mpcg:'🟡 MP+CG',
};

// Region filter config
const REGION_FILTERS = [
  { id: '',     label: 'All States' },
  { id: 'RAJ',  label: '🟠 Rajasthan', color: '#f97316' },
  { id: 'MP',   label: '🟣 Madhya Pradesh', color: '#8b5cf6' },
  { id: 'CG',   label: '🔵 Chhattisgarh', color: '#0891b2' },
];

// Region badge config
const REGION_BADGE = {
  RAJ:  { label: 'RAJ',  color: '#f97316' },
  MP:   { label: 'MP',   color: '#8b5cf6' },
  CG:   { label: 'CG',   color: '#0891b2' },
  MPCG: { label: 'MP+CG',color: '#C9A227' },
};

// ── Date helpers ──────────────────────────────────────────────────────────────
const fmtDate = iso => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
  catch { return iso; }
};
const fmtTime = iso => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }); }
  catch { return iso; }
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const yyyyMM = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — NEWS FEED
// ─────────────────────────────────────────────────────────────────────────────
function NewsFeedTab({ anniversaries, summary }) {
  const [feeds,     setFeeds]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [activeId,  setActiveId]  = useState('pib');
  const [fetchedAt, setFetchedAt] = useState('');

  const loadFeeds = useCallback(() => {
    setLoading(true); setError('');
    api.editorialFeeds()
      .then(d => {
        setFeeds(d.feeds || []);
        setFetchedAt(d.fetchedAt || '');
        // pick first feed that has articles
        const first = (d.feeds||[]).find(f => f.articles?.length);
        if (first) setActiveId(first.id);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadFeeds(); }, [loadFeeds]);

  const active = feeds.find(f => f.id === activeId);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left: RSS feed */}
      <div className="lg:col-span-2 space-y-3">
        {/* Source tabs */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold" style={{ color:'var(--muted)' }}>
              LIVE SOURCES {fetchedAt && `· fetched ${fmtTime(fetchedAt)}`}
            </span>
            <button onClick={loadFeeds} className="btn-ghost px-2 py-1 text-xs flex items-center gap-1">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {feeds.map(f => (
              <button key={f.id}
                onClick={() => setActiveId(f.id)}
                className="pill"
                style={{
                  background: activeId === f.id ? f.color : f.color+'18',
                  color: activeId === f.id ? '#fff' : f.color,
                  fontWeight: activeId === f.id ? 700 : 400,
                  border: `1px solid ${f.color}33`,
                  cursor: 'pointer',
                }}>
                {f.label}
                <span className="ml-1 opacity-60">({f.articles?.length || 0})</span>
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs" style={{ color:'#d71920' }}>⚠ {error}</p>}
        </div>

        {loading && (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="card h-20 animate-pulse" />)}
          </div>
        )}

        {!loading && active && active.articles.length === 0 && (
          <div className="card p-6 text-center text-sm" style={{ color:'var(--muted)' }}>
            {active.error ? `Feed error: ${active.error}` : 'No articles available right now.'}
          </div>
        )}

        {!loading && active && active.articles.map((art, i) => (
          <div key={i} className="card p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-xs font-bold rounded px-1.5 py-0.5 flex-shrink-0"
                style={{ background: active.color+'18', color: active.color }}>
                {String(i+1).padStart(2,'0')}
              </span>
              <div className="flex-1 min-w-0">
                <a href={art.link || '#'} target="_blank" rel="noopener noreferrer"
                   className="font-semibold text-sm leading-snug hover:underline flex items-start gap-1">
                  {art.title}
                  {art.link && <ExternalLink size={11} className="flex-shrink-0 mt-0.5 opacity-50" />}
                </a>
                {art.desc && (
                  <p className="mt-1 text-xs leading-relaxed line-clamp-2" style={{ color:'var(--muted)' }}>
                    {art.desc}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color:'var(--muted)' }}>
                  {art.pubDate && <span><Clock size={10} className="inline mr-0.5" />{fmtDate(art.pubDate)}</span>}
                  {art.category && <span className="pill" style={{ background:'var(--bg)', padding:'1px 6px' }}>{art.category}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — CALENDAR
// ─────────────────────────────────────────────────────────────────────────────
function CalendarTab({ prominentDays, planning, onMonthChange }) {
  const today = new Date();
  const [viewDate,     setViewDate]     = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected,     setSelected]     = useState(null);
  const [regionFilter, setRegionFilter] = useState('');

  const navigate = (delta) => {
    const nd = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
    setViewDate(nd);
    setSelected(null);
    onMonthChange && onMonthChange(yyyyMM(nd));
  };

  const filteredDays = prominentDays.filter(e => {
    if (!regionFilter) return true;
    if (!e.region || e.region === 'ALL') return true;
    if (e.region === regionFilter) return true;
    if (e.region === 'MPCG' && (regionFilter === 'MP' || regionFilter === 'CG')) return true;
    return false;
  });

  const dayMap = {};
  filteredDays.forEach(e => {
    if (!dayMap[e.date]) dayMap[e.date] = [];
    dayMap[e.date].push({ ...e, source: 'prominent' });
  });
  planning.forEach(p => {
    const from = p.dateFrom;
    if (!from) return;
    if (!dayMap[from]) dayMap[from] = [];
    dayMap[from].push({
      date: from,
      label: `Planning: ${p.editorsStory || p.campaign || p.event || p.branch}`,
      type: 'media', color: '#7c3aed',
      angle: `Editor's story: ${p.editorsStory || ''} | Event: ${p.event || ''} | Campaign: ${p.campaign || ''}`,
      source: 'planning',
    });
  });

  const yr = viewDate.getFullYear();
  const mo = viewDate.getMonth();
  const firstDay    = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const todayStr    = todayISO();
  const monthLabel  = viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const moPrefix    = `${yr}-${String(mo + 1).padStart(2, '0')}`;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedEvents = selected ? (dayMap[selected] || []) : [];
  const monthEvents    = Object.entries(dayMap)
    .filter(([d]) => d.startsWith(moPrefix))
    .sort(([a], [b]) => a.localeCompare(b));

  const totalEvents = monthEvents.reduce((s, [, evs]) => s + evs.length, 0);

  return (
    <div className="space-y-4">

      {/* ── Header strip: month nav + stats + region filter ─────────────────── */}
      <div className="card overflow-hidden" style={{ padding: 0 }}>
        {/* Gradient header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ background: 'linear-gradient(135deg, #d71920 0%, #8c0a0e 100%)' }}>
          <button onClick={() => navigate(-1)}
            className="rounded-xl p-2 transition-all hover:scale-110"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            <ChevronLeft size={20} />
          </button>

          <div className="text-center">
            <div className="text-2xl font-black tracking-wide" style={{ color: '#fff' }}>
              {viewDate.toLocaleDateString('en-IN', { month: 'long' }).toUpperCase()}
            </div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {yr} &nbsp;·&nbsp; {totalEvents} event{totalEvents !== 1 ? 's' : ''}
            </div>
          </div>

          <button onClick={() => navigate(+1)}
            className="rounded-xl p-2 transition-all hover:scale-110"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Region filter row */}
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>STATE:</span>
          {REGION_FILTERS.map(rf => {
            const count = rf.id === ''
              ? filteredDays.length
              : filteredDays.filter(d => !d.region || d.region === rf.id || (d.region === 'MPCG' && (rf.id === 'MP' || rf.id === 'CG'))).length;
            const active = regionFilter === rf.id;
            const col = rf.color || '#d71920';
            return (
              <button key={rf.id} onClick={() => setRegionFilter(rf.id)}
                className="pill transition-all"
                style={{
                  background: active ? col : col + '15',
                  color:      active ? '#fff' : col,
                  border:     `1.5px solid ${active ? col : col + '40'}`,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}>
                {rf.label}
                <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-xs"
                  style={{ background: active ? 'rgba(255,255,255,0.25)' : col + '25', fontWeight: 700 }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main grid + side panel ───────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* Calendar grid */}
        <div className="lg:col-span-2 card p-4">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-2">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
              <div key={d} className="text-center text-xs font-bold py-1.5 rounded"
                style={{
                  color: i === 0 || i === 6 ? '#d71920' : 'var(--muted)',
                }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const iso    = `${moPrefix}-${String(day).padStart(2, '0')}`;
              const events = dayMap[iso] || [];
              const isToday = iso === todayStr;
              const isSel   = iso === selected;
              const isSun   = new Date(iso).getDay() === 0;
              const isSat   = new Date(iso).getDay() === 6;

              return (
                <button key={i}
                  onClick={() => setSelected(iso === selected ? null : iso)}
                  className="relative flex flex-col items-center rounded-xl transition-all duration-150"
                  style={{
                    minHeight: 64,
                    padding: '6px 4px 4px',
                    background: isSel
                      ? 'linear-gradient(135deg,#d71920,#8c0a0e)'
                      : isToday
                        ? '#d7192012'
                        : events.length
                          ? 'var(--bg)'
                          : 'transparent',
                    color: isSel ? '#fff' : isToday ? '#d71920' : isSun ? '#d71920' : 'inherit',
                    border: isToday && !isSel
                      ? '2px solid #d71920'
                      : isSel
                        ? '2px solid #d71920'
                        : events.length
                          ? '1.5px solid var(--border)'
                          : '1.5px solid transparent',
                    boxShadow: isSel ? '0 4px 14px rgba(215,25,32,0.35)' : 'none',
                    cursor: 'pointer',
                    transform: isSel ? 'scale(1.05)' : 'scale(1)',
                  }}>

                  {/* Today badge */}
                  {isToday && !isSel && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                      style={{ background: '#d71920' }} />
                  )}

                  {/* Day number */}
                  <span className="text-sm font-bold leading-none mb-1">{day}</span>

                  {/* Event name(s) — show first label truncated */}
                  {events.length > 0 && (
                    <div className="w-full space-y-0.5 px-0.5">
                      {events.slice(0, 2).map((e, ei) => (
                        <div key={ei}
                          className="rounded text-center leading-tight"
                          style={{
                            background: isSel ? 'rgba(255,255,255,0.2)' : (e.color || '#888') + '22',
                            color:      isSel ? '#fff' : e.color || '#888',
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 3px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                          }}>
                          {e.label.split(' ').slice(0, 3).join(' ')}
                        </div>
                      ))}
                      {events.length > 2 && (
                        <div className="text-center" style={{ fontSize: 9, color: isSel ? 'rgba(255,255,255,0.7)' : 'var(--muted)' }}>
                          +{events.length - 2}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              {Object.entries(DOT_LABEL).map(([k, label]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: TYPE_COLOR[k] || '#888' }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Side panel ────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {selected ? (
            <>
              {/* Selected day header */}
              <div className="rounded-2xl p-4"
                style={{ background: 'linear-gradient(135deg,#d71920,#8c0a0e)', color: '#fff' }}>
                <div className="text-xs font-semibold opacity-75 mb-1">SELECTED DATE</div>
                <div className="text-xl font-black">
                  {new Date(selected + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' })}
                </div>
                <div className="text-sm opacity-80">
                  {new Date(selected + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <button onClick={() => setSelected(null)}
                  className="mt-2 text-xs underline opacity-70 hover:opacity-100">
                  ← Back to month view
                </button>
              </div>

              {selectedEvents.length === 0 ? (
                <div className="card p-6 text-center">
                  <div className="text-3xl mb-2">📭</div>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>No events on this day.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((e, i) => (
                    <div key={i} className="card p-4 transition-all hover:shadow-md"
                      style={{ borderLeft: `4px solid ${e.color || '#888'}` }}>
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        <span className="text-xs font-bold rounded-full px-2.5 py-1"
                          style={{ background: (e.color || '#888') + '20', color: e.color || '#888' }}>
                          {DOT_LABEL[e.type] || e.type}
                        </span>
                        {e.region && REGION_BADGE[e.region] && (
                          <span className="text-xs font-bold rounded-full px-2 py-1"
                            style={{ background: REGION_BADGE[e.region].color + '20', color: REGION_BADGE[e.region].color }}>
                            📍 {REGION_BADGE[e.region].label}
                          </span>
                        )}
                        {e.source === 'planning' && (
                          <span className="text-xs font-bold rounded-full px-2 py-1"
                            style={{ background: '#7c3aed18', color: '#7c3aed' }}>
                            📋 Planning
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-sm leading-snug">{e.label}</div>
                      {e.angle && (
                        <div className="mt-2 rounded-lg p-2 text-xs leading-relaxed"
                          style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
                          <span className="font-bold" style={{ color: 'var(--text)' }}>Story angles: </span>
                          {e.angle}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Month summary card */}
              <div className="card p-4">
                <div className="text-xs font-bold mb-3" style={{ color: 'var(--muted)' }}>
                  {monthLabel.toUpperCase()} — ALL EVENTS
                </div>
                {monthEvents.length === 0 ? (
                  <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>
                    No events this month.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {monthEvents.map(([date, events]) => {
                      const d    = new Date(date + 'T00:00:00');
                      const isT  = date === todayStr;
                      return (
                        <button key={date} onClick={() => setSelected(date)}
                          className="w-full text-left rounded-xl px-3 py-2.5 transition-all hover:scale-[1.01]"
                          style={{
                            background: isT ? '#d7192010' : 'var(--bg)',
                            border: isT ? '1.5px solid #d7192040' : '1.5px solid transparent',
                            cursor: 'pointer',
                          }}>
                          <div className="flex items-center gap-2.5">
                            {/* Date block */}
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex flex-col items-center justify-center"
                              style={{ background: isT ? '#d71920' : (events[0].color || '#888') + '18' }}>
                              <span className="text-xs font-black leading-none"
                                style={{ color: isT ? '#fff' : events[0].color || '#888' }}>
                                {d.getDate()}
                              </span>
                              <span className="text-xs leading-none mt-0.5"
                                style={{ color: isT ? 'rgba(255,255,255,0.8)' : 'var(--muted)', fontSize: 9 }}>
                                {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                              </span>
                            </div>

                            {/* Event info */}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold truncate"
                                style={{ color: isT ? '#d71920' : 'inherit' }}>
                                {events[0].label}
                              </div>
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                {events[0].region && REGION_BADGE[events[0].region] && (
                                  <span className="rounded px-1 py-0.5 font-bold"
                                    style={{ fontSize: 9, background: REGION_BADGE[events[0].region].color + '20', color: REGION_BADGE[events[0].region].color }}>
                                    📍{REGION_BADGE[events[0].region].label}
                                  </span>
                                )}
                                {events.length > 1 && (
                                  <span className="text-xs" style={{ color: 'var(--muted)', fontSize: 10 }}>
                                    +{events.length - 1} more
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Color dots */}
                            <div className="flex flex-col gap-1 flex-shrink-0">
                              {events.slice(0, 3).map((e, i) => (
                                <span key={i} className="w-2 h-2 rounded-full"
                                  style={{ background: e.color || '#888' }} />
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
                Click any day on the calendar to see story angles
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — STORY INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────────────
function StoryIntelTab({ storyMix, targetVsActual, coverageGaps, summary }) {
  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label:'Reporters Active', val:(summary?.reporters||0).toLocaleString(), c:'#d71920', icon:Users },
          { label:'Stories Filed',    val:(summary?.stories||0).toLocaleString(),   c:'#C9A227', icon:FileText },
          { label:'Photos',           val:(summary?.photos||0).toLocaleString(),    c:'#3b82f6', icon:TrendingUp },
          { label:'Date',             val:fmtDate(summary?.date),                   c:'#16a34a', icon:Clock },
        ].map(({label,val,c,icon:Icon}) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} style={{color:c}} />
              <span className="text-xs" style={{color:'var(--muted)'}}>{label}</span>
            </div>
            <div className="text-2xl font-bold">{val || '—'}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Story type mix */}
        <SectionCard title="Story Type Mix (Yesterday)">
          {storyMix.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{color:'var(--muted)'}}>No data available</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={storyMix} layout="vertical" margin={{left:72, right:40, top:4, bottom:4}}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted)" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="var(--muted)" fontSize={11} width={68} />
                <Tooltip contentStyle={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12}} />
                <Bar dataKey="value" radius={[0,4,4,0]} barSize={16}>
                  {storyMix.map((e,i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Target vs Actual */}
        <SectionCard title={<span className="flex items-center gap-1.5"><Target size={14}/> Target vs Actual (Yesterday)</span>}>
          {targetVsActual.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{color:'var(--muted)'}}>No target data available</p>
          ) : (
            <div className="space-y-4 mt-2">
              {targetVsActual.map(item => {
                const pct = item.target > 0 ? Math.min(100, Math.round((item.actual / item.target) * 100)) : 0;
                const barColor = pct >= 100 ? '#16a34a' : pct >= 60 ? '#C9A227' : '#d71920';
                return (
                  <div key={item.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold">{item.name}</span>
                      <span style={{color:'var(--muted)'}}>{item.actual} / {item.target} ({pct}%)</span>
                    </div>
                    <div className="w-full rounded-full h-2.5" style={{background:'var(--border)'}}>
                      <div className="h-2.5 rounded-full transition-all"
                        style={{width:`${pct}%`, background:barColor}} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Coverage Gaps */}
      <SectionCard title={<span className="flex items-center gap-1.5"><AlertTriangle size={14} style={{color:'#C9A227'}}/> Coverage Gaps — Branches with No Reporter Visits (Last 7 Days)</span>}>
        {coverageGaps.length === 0 ? (
          <p className="text-sm py-4" style={{color:'#16a34a'}}>✓ All branches had reporter visits in the last 7 days.</p>
        ) : (
          <>
            <p className="text-xs mb-3" style={{color:'var(--muted)'}}>
              {coverageGaps.length} branch{coverageGaps.length > 1 ? 'es' : ''} with zero field visits recorded. Editors should prompt reporters in these areas.
            </p>
            <div className="flex flex-wrap gap-2">
              {coverageGaps.map((b, i) => (
                <span key={i} className="pill"
                  style={{background:'#C9A22718', color:'#C9A227', border:'1px solid #C9A22733'}}>
                  {b}
                </span>
              ))}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — NEWSROOM
// ─────────────────────────────────────────────────────────────────────────────
function NewsroomTab({ topNews, planning, deskReview, rndIdeas }) {
  const [activeState, setActiveState] = useState(null);
  const states = [...new Set(topNews.map(t => t.state))].filter(Boolean);
  const filtered = activeState ? topNews.filter(t => t.state === activeState) : topNews;

  return (
    <div className="space-y-4">
      {/* Top News */}
      <SectionCard title="Today's Top News (Editor Submissions)">
        {topNews.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{color:'var(--muted)'}}>No top news submitted today.</p>
        ) : (
          <>
            {/* State filter chips */}
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={() => setActiveState(null)}
                className="pill" style={{
                  background: !activeState ? '#d71920' : '#d7192018',
                  color: !activeState ? '#fff' : '#d71920', cursor:'pointer',
                }}>All</button>
              {states.map(s => (
                <button key={s} onClick={() => setActiveState(s === activeState ? null : s)}
                  className="pill" style={{
                    background: activeState===s ? '#d71920' : '#d7192018',
                    color: activeState===s ? '#fff' : '#d71920', cursor:'pointer',
                  }}>{s}</button>
              ))}
            </div>

            <div className="space-y-3">
              {filtered.map(entry => (
                <div key={entry.id} className="rounded-lg p-4" style={{background:'var(--bg)'}}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-bold text-sm">{entry.state}</span>
                    <span className="pill" style={{background:'#d7192018',color:'#d71920',fontSize:11}}>{entry.timeSlot}</span>
                    <span className="text-xs" style={{color:'var(--muted)'}}>{entry.date}</span>
                  </div>
                  <div className="space-y-2">
                    {entry.items.map((item, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        {item.bureau && (
                          <span className="flex-shrink-0 text-xs font-semibold rounded px-1.5 py-0.5 self-start"
                            style={{background:'#3b82f618',color:'#3b82f6',marginTop:1}}>
                            {item.bureau}
                          </span>
                        )}
                        <span className="leading-snug">{item.story}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Planning board */}
        <SectionCard title="Editorial Planning Board">
          {planning.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{color:'var(--muted)'}}>No planning entries available.</p>
          ) : (
            <div className="space-y-3">
              {planning.map((p, i) => (
                <div key={i} className="rounded-lg p-3" style={{background:'var(--bg)', borderLeft:'3px solid #7c3aed'}}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-xs">{p.branch || p.state}</span>
                    <span className="text-xs" style={{color:'var(--muted)'}}>{p.dateFrom} → {p.dateTo}</span>
                  </div>
                  {p.editorsStory && <div className="text-sm mb-1"><span className="font-semibold text-xs" style={{color:'#d71920'}}>Story: </span>{p.editorsStory}</div>}
                  {p.event       && <div className="text-xs" style={{color:'var(--muted)'}}><span className="font-semibold">Event: </span>{p.event}</div>}
                  {p.campaign    && <div className="text-xs" style={{color:'var(--muted)'}}><span className="font-semibold">Campaign: </span>{p.campaign}</div>}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* R&D Ideas */}
        <SectionCard title={<span className="flex items-center gap-1.5"><Lightbulb size={14} style={{color:'#C9A227'}}/> R&D Story Ideas</span>}>
          {rndIdeas.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{color:'var(--muted)'}}>No recent R&D ideas found.</p>
          ) : (
            <div className="space-y-3">
              {rndIdeas.map((r, i) => (
                <div key={i} className="rounded-lg p-3" style={{background:'var(--bg)', borderLeft:'3px solid #C9A227'}}>
                  <div className="flex items-center gap-2 flex-wrap mb-1 text-xs" style={{color:'var(--muted)'}}>
                    <span>{r.date}</span>
                    {r.submittedBy && <span>· by {r.submittedBy}</span>}
                    {r.branches?.length > 0 && (
                      <span>· {r.branches.slice(0,3).join(', ')}{r.branches.length>3?` +${r.branches.length-3}`:''}</span>
                    )}
                  </div>
                  <p className="text-sm leading-snug">{r.idea}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Desk Person Review */}
      <SectionCard title="Desk Person Performance (Weekly)">
        {deskReview.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{color:'var(--muted)'}}>No desk review data available.</p>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
              <thead>
                <tr style={{borderBottom:'2px solid var(--border)'}}>
                  {['Desk Editor','Branch','Period','Total Edited','AI Assisted','AI Headings','AI %'].map(h => (
                    <th key={h} style={{padding:'8px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--muted)', whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deskReview.map((d, i) => (
                  <tr key={i} style={{borderBottom:'1px solid var(--border)', background: i%2===0?'transparent':'var(--bg)'}}>
                    <td style={{padding:'7px 10px', fontWeight:600}}>{d.name}</td>
                    <td style={{padding:'7px 10px', color:'var(--muted)'}}>{d.branch}</td>
                    <td style={{padding:'7px 10px', color:'var(--muted)', whiteSpace:'nowrap'}}>{d.from} → {d.to}</td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>{d.totalEdited.toLocaleString()}</td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>{d.aiEdited}</td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>{d.aiHeadings}</td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>
                      <span style={{
                        background: d.aiPct>=50?'#16a34a18':d.aiPct>=20?'#C9A22718':'#d7192018',
                        color:      d.aiPct>=50?'#16a34a':d.aiPct>=20?'#C9A227':'#d71920',
                        padding:'2px 8px', borderRadius:99, fontWeight:700,
                      }}>{d.aiPct}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Editorial() {
  const { t, state: globalState } = useApp();
  const [activeTab, setActiveTab] = useState('feed');
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);

  // Calendar month for prominent days request
  const [calMonth,  setCalMonth]  = useState(yyyyMM(new Date()));

  const load = useCallback(() => {
    setLoading(true);
    api.editorial(globalState, calMonth)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [globalState, calMonth]);

  useEffect(() => { load(); }, [load]);

  const subtitle = globalState && globalState !== 'All' ? globalState : 'All States';

  return (
    <div>
      <PageHeader
        title={t('nav.editorial')}
        subtitle={`${subtitle} · Daily editorial command centre`}
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{background:'var(--bg)', width:'fit-content'}}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: active ? 'var(--surface)' : 'transparent',
                color: active ? '#d71920' : 'var(--muted)',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
              }}>
              <Icon size={15} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="card h-32 animate-pulse" />)}
        </div>
      )}

      {!loading && data && (
        <>
          {activeTab === 'feed'     && <NewsFeedTab     anniversaries={data.anniversaries} summary={data.summary} />}
          {activeTab === 'calendar' && <CalendarTab     prominentDays={data.prominentDays} planning={data.planning} onMonthChange={setCalMonth} />}
          {activeTab === 'newsroom' && <NewsroomTab     topNews={data.topNews} planning={data.planning} deskReview={data.deskReview} rndIdeas={data.rndIdeas} />}
        </>
      )}

      {!loading && !data && (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{color:'var(--muted)'}}>Could not load editorial data.</p>
          <button onClick={load} className="btn-primary mt-3">Retry</button>
        </div>
      )}
    </div>
  );
}
