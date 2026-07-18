import { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Newspaper, CheckSquare, MapPin, TrendingUp, Camera, AlertTriangle,
  Loader2, RefreshCw, ChevronLeft, ChevronRight, Download, Search, Clock, Navigation,
  Send, ClipboardList,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────
const today     = () => new Date().toISOString().slice(0, 10);
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

const CHART_COLORS = ['#d71920','#C9A227','#3b82f6','#10b981','#8b5cf6','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa'];

const SEV_COLORS = { high: '#d71920', medium: '#C9A227', low: '#10b981' };

const MARKER_COLORS = {
  'Reporting':          '#3b82f6',
  'Coverage':           '#10b981',
  'Meeting':            '#C9A227',
  'Event':              '#f97316',
  'Special Reporting':  '#8b5cf6',
};
function markerColor(remark) {
  for (const [key, col] of Object.entries(MARKER_COLORS)) {
    if ((remark || '').toLowerCase().includes(key.toLowerCase())) return col;
  }
  return '#6b7280';
}

// ── Tile ──────────────────────────────────────────────────────────────────────
function Tile({ icon: Icon, label, value, sub, color = '#3b82f6', onClick, active }) {
  return (
    <div
      className="card p-4 flex items-start gap-3"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : undefined,
        outline: active ? `2px solid ${color}` : undefined,
        outlineOffset: active ? '-2px' : undefined,
        background: active ? color + '12' : undefined,
      }}
    >
      <span className="inline-flex rounded-lg p-2 mt-0.5" style={{ background: color + '20', color }}>
        <Icon size={18} />
      </span>
      <div>
        <div className="text-2xl font-bold" style={{ fontFamily: 'Roboto, sans-serif' }}>{value ?? '—'}</div>
        <div className="text-xs font-medium">{label}</div>
        {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'news',      label: 'News Categories', icon: Newspaper   },
  { id: 'qc',        label: 'QC Review',       icon: CheckSquare },
  { id: 'visits',    label: 'Field Visits',    icon: MapPin      },
];

// ── OverviewTab ───────────────────────────────────────────────────────────────
function OverviewTab({ data }) {
  const { news, qc, visits } = data;
  const ns = news.summary;
  const qs = qc.summary;
  const vs = visits.summary;

  // Top 5 categories for mini-pie
  const topCats = [...news.categories].slice(0, 6);

  return (
    <div className="space-y-5">
      {/* News KPIs */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>News Published</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile icon={Newspaper}     label="Reporters"  value={ns.reporters} color="#3b82f6" />
          <Tile icon={TrendingUp}    label="Stories"    value={ns.stories}   color="#10b981" />
          <Tile icon={TrendingUp}    label="Words"      value={ns.words?.toLocaleString()} color="#8b5cf6" />
          <Tile icon={Camera}        label="Photos"     value={ns.photos}    color="#C9A227" />
          <Tile icon={Newspaper}     label="Exclusive"  value={ns.exclusive} color="#d71920" />
        </div>
      </div>

      {/* QC KPIs */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>QC Mistakes</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={CheckSquare}   label="Checks Done"   value={qs.total}    color="#3b82f6" />
          <Tile icon={AlertTriangle} label="Total Mistakes" value={qs.mistakes} color="#d71920" />
          <Tile icon={AlertTriangle} label="High Severity"  value={qs.high}    color="#d71920" sub="High" />
          <Tile icon={AlertTriangle} label="Medium"         value={qs.medium}  color="#C9A227" sub="Medium" />
        </div>
      </div>

      {/* Visit KPIs */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Field Visits</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Tile icon={MapPin} label="Total Visits"    value={vs.total}    color="#10b981" />
          <Tile icon={MapPin} label="With GPS Location" value={vs.with_loc} color="#3b82f6" />
          <Tile icon={MapPin} label="Location Coverage" value={vs.total ? `${Math.round(vs.with_loc/vs.total*100)}%` : '—'} color="#8b5cf6" />
        </div>
      </div>

      {/* 7-day trend + category mini */}
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="7-Day Story Trend">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={news.trend} margin={{ left: -10, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickFormatter={d => d.slice(5)} />
              <YAxis stroke="var(--muted)" fontSize={11} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="stories"   stroke="#3b82f6" strokeWidth={2} dot={false} name="Stories" />
              <Line type="monotone" dataKey="exclusive" stroke="#d71920" strokeWidth={2} dot={false} name="Exclusive" />
              <Line type="monotone" dataKey="photos"    stroke="#C9A227" strokeWidth={1.5} dot={false} name="Photos" />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Top News Categories (Today)">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={topCats} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {topCats.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </div>
  );
}

// ── NewsTab ───────────────────────────────────────────────────────────────────
function NewsTab({ data }) {
  const { news } = data;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Category-wise Count (Today)">
          {news.categories.length === 0
            ? <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>No data for selected date.</p>
            : <ResponsiveContainer width="100%" height={Math.max(260, news.categories.length * 28)}>
                <BarChart data={news.categories} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--muted)" fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} stroke="var(--muted)" fontSize={10} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
                  <Bar dataKey="value" radius={[0,4,4,0]} barSize={14} label={{ position: 'right', fontSize: 10 }}>
                    {news.categories.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
          }
        </SectionCard>

        <SectionCard title="Category Distribution">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={news.categories.slice(0,8)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => percent > 0.04 ? `${(percent*100).toFixed(0)}%` : ''} labelLine={false} fontSize={10}>
                {news.categories.slice(0,8).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <SectionCard title="7-Day Stacked Story Trend">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={news.trend} margin={{ left: -10, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickFormatter={d => d.slice(5)} />
            <YAxis stroke="var(--muted)" fontSize={11} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="routine"     stackId="a" fill="#3b82f6" name="Routine" />
            <Bar dataKey="exclusive"   stackId="a" fill="#d71920" name="Exclusive" />
            <Bar dataKey="human_angle" stackId="a" fill="#10b981" name="Human Angle" />
            <Bar dataKey="datastory"   stackId="a" fill="#C9A227" name="Data Story" />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* 7-day raw table */}
      <SectionCard title="7-Day Summary Table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                <th className="p-2">Date</th>
                <th className="p-2 text-right">Stories</th>
                <th className="p-2 text-right">Words</th>
                <th className="p-2 text-right">Photos</th>
                <th className="p-2 text-right">Exclusive</th>
                <th className="p-2 text-right">Human Angle</th>
                <th className="p-2 text-right">Data Story</th>
              </tr>
            </thead>
            <tbody>
              {[...news.trend].reverse().map((r, i) => (
                <tr key={i} className="border-t hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 font-mono text-xs">{r.date}</td>
                  <td className="p-2 text-right font-semibold">{r.stories}</td>
                  <td className="p-2 text-right">{r.words?.toLocaleString()}</td>
                  <td className="p-2 text-right">{r.photos}</td>
                  <td className="p-2 text-right">{r.exclusive}</td>
                  <td className="p-2 text-right">{r.human_angle}</td>
                  <td className="p-2 text-right">{r.datastory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// ── QCTab ─────────────────────────────────────────────────────────────────────
function QCTab({ data }) {
  const { qc } = data;
  const [expanded, setExpanded] = useState(null);

  const sevData = ['high','medium','low']
    .filter(s => qc.summary[s] > 0)
    .map(s => ({ name: s.charAt(0).toUpperCase()+s.slice(1), value: qc.summary[s], color: SEV_COLORS[s] }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Severity breakdown */}
        <SectionCard title="Mistake Severity Distribution">
          {sevData.length === 0
            ? <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>No QC data for selected date.</p>
            : <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={sevData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                    label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={11}>
                    {sevData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
          }
        </SectionCard>

        {/* By category */}
        <SectionCard title="QC Mistakes by Category">
          {qc.by_category.length === 0
            ? <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>No category data.</p>
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={qc.by_category.slice(0,8)} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--muted)" fontSize={11} />
                  <YAxis type="category" dataKey="category" width={90} stroke="var(--muted)" fontSize={9} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
                  <Bar dataKey="mistakes" fill="#d71920" radius={[0,4,4,0]} barSize={12}
                    label={{ position: 'right', fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
          }
        </SectionCard>
      </div>

      {/* Recent mistakes (7-day) */}
      <SectionCard title={`Recent QC Records (last 7 days · ${qc.recent.length} records)`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="p-2">Date</th>
                <th className="p-2">Category</th>
                <th className="p-2">Severity</th>
                <th className="p-2">State</th>
                <th className="p-2">Edition</th>
                <th className="p-2">Pullout</th>
                <th className="p-2 text-right">Mistakes</th>
                <th className="p-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {qc.recent.map((r, i) => (
                <>
                  <tr key={r.id}
                    className="border-t hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <td className="p-2 font-mono">{r.date}</td>
                    <td className="p-2">{r.category}</td>
                    <td className="p-2">
                      {r.severity && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                          style={{ background: (SEV_COLORS[r.severity] || '#6b7280') + '20',
                                   color: SEV_COLORS[r.severity] || '#6b7280' }}>
                          {r.severity}
                        </span>
                      )}
                    </td>
                    <td className="p-2">{r.state}</td>
                    <td className="p-2">{r.edition}</td>
                    <td className="p-2">{r.pullout}</td>
                    <td className="p-2 text-right font-bold" style={{ color: '#d71920' }}>{r.mistakes}</td>
                    <td className="p-2">
                      <span style={{ color: 'var(--brand)', cursor: 'pointer', fontSize: 11 }}>
                        {expanded === i ? '▲ less' : '▼ more'}
                      </span>
                    </td>
                  </tr>
                  {expanded === i && (
                    <tr key={`${r.id}-exp`} className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                      <td colSpan={8} className="p-3">
                        <div className="flex gap-4 flex-wrap">
                          <div className="flex-1 min-w-[200px]">
                            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Mistake Description</div>
                            <p className="text-sm">{r.mistake || '—'}</p>
                          </div>
                          {r.photo_url && (
                            <div>
                              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Photo Evidence</div>
                              <img src={r.photo_url} alt="QC evidence" className="rounded-lg max-h-40 object-contain border"
                                style={{ borderColor: 'var(--border)' }} onError={e => e.target.style.display='none'} />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {qc.recent.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-sm" style={{ color: 'var(--muted)' }}>No QC records in last 7 days.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// ── FlyTo: re-centers the parent MapContainer when lat/lng change ─────────────
function FlyTo({ lat, lng }) {
  const map = useMap();
  useEffect(() => { if (lat && lng) map.flyTo([lat, lng], 14, { duration: 0.8 }); }, [lat, lng]);
  return null;
}

function fmtDuration(mins) {
  if (mins == null || mins < 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Nearby-location lookup via Overpass (100 m POIs) + Nominatim fallback ────
// Module-level cache: survives tab navigation, keyed by rounded lat/lng
const GEO_CACHE = new Map();

function geoKey(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

async function fetchGeoName(lat, lng) {
  const key = geoKey(lat, lng);
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);

  // 1. Overpass — named nodes/ways within 100 m (most specific)
  try {
    const ov = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `[out:json][timeout:6];(node(around:100,${lat},${lng})[name];way(around:100,${lat},${lng})[name];);out center 5;`,
    });
    if (ov.ok) {
      const d = await ov.json();
      const poi = (d.elements || []).map(e => e.tags?.name).filter(Boolean)[0];
      if (poi) { GEO_CACHE.set(key, poi); return poi; }
    }
  } catch {}

  // 2. Nominatim fallback — amenity / suburb level
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=hi,en`,
      { headers: { 'User-Agent': 'PatrikaNewsroom/1.0' } }
    );
    if (r.ok) {
      const d = await r.json();
      const a = d.address || {};
      const area = a.amenity || a.leisure || a.tourism || a.building ||
                   a.suburb  || a.neighbourhood || a.city_district ||
                   a.quarter || a.hamlet || '';
      const city = a.city || a.town || a.village || '';
      const name = area ? `${area}${city ? ', ' + city : ''}` : city ||
                   d.display_name?.split(',').slice(0, 2).join(',').trim() || '';
      GEO_CACHE.set(key, name);
      return name;
    }
  } catch {}

  GEO_CACHE.set(key, '');
  return '';
}

// Home/Office check-ins are flagged in red — reporter was not in the field.
// Predefined values in visit_report are 'Home' and 'Patrika Office'; custom
// entries start with 'Other ' (e.g. 'Other Sdm office') and must NOT match.
const isHomeOffice = label => {
  const l = (label || '').trim().toLowerCase();
  return l === 'home' || l === 'office' || l === 'patrika office';
};

// ── VisitsTab ─────────────────────────────────────────────────────────────────
function VisitsTab({ data, date }) {
  const { visits } = data;
  const { isAdmin, user } = useApp();
  const canManageAlerts = isAdmin() || ['State Head', 'Management'].includes(user?.role);
  const [selected,     setSelected]     = useState(null);
  const [search,       setSearch]       = useState('');
  const [showAll,      setShowAll]      = useState(false);
  const [geoNames,     setGeoNames]     = useState({});
  const [labelFilter,  setLabelFilter]  = useState(null); // null | 'home' | 'office'
  const [alertSending, setAlertSending] = useState(false);
  const [alertResult,  setAlertResult]  = useState(null);
  const [showLogs,     setShowLogs]     = useState(false);
  const [alertLogs,    setAlertLogs]    = useState([]);
  const [logsLoading,  setLogsLoading]  = useState(false);

  const alertFetch = (url, opts = {}) => {
    const token = localStorage.getItem('pk_token');
    return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  };

  const sendAlert = async () => {
    if (!window.confirm(`Send Home/Office visit alert to all REs for ${date}?`)) return;
    setAlertSending(true); setAlertResult(null);
    try {
      const r = await alertFetch('/api/pages/home-office-alert', { method: 'POST', body: JSON.stringify({ date }) });
      const j = await r.json();
      setAlertResult(j);
      if (showLogs) fetchLogs();
    } catch (e) { setAlertResult({ ok: false, error: e.message }); }
    finally { setAlertSending(false); }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const r = await alertFetch('/api/pages/home-office-alert');
      const j = await r.json();
      setAlertLogs(j.logs || []);
    } catch { setAlertLogs([]); }
    finally { setLogsLoading(false); }
  };

  const toggleLogs = () => {
    if (!showLogs) fetchLogs();
    setShowLogs(s => !s);
  };

  const remarkData = visits.by_remark;
  const persons    = visits.persons ?? [];

  // Reverse-geocode all GPS-tagged persons, 1 req/sec (Nominatim rate limit)
  useEffect(() => {
    const toFetch = persons.filter(p => p.lat && p.lng);
    if (!toFetch.length) return;

    // Pre-fill from cache immediately (no flicker for already-seen coordinates)
    const cached = {};
    toFetch.forEach(p => {
      const k = geoKey(p.lat, p.lng);
      if (GEO_CACHE.has(k)) cached[k] = GEO_CACHE.get(k);
    });
    if (Object.keys(cached).length) setGeoNames(prev => ({ ...prev, ...cached }));

    // Queue the ones not yet cached
    const queue = toFetch.filter(p => !GEO_CACHE.has(geoKey(p.lat, p.lng)));
    if (!queue.length) return;

    let cancelled = false;
    (async () => {
      for (const p of queue) {
        if (cancelled) break;
        const k    = geoKey(p.lat, p.lng);
        const name = await fetchGeoName(p.lat, p.lng);
        if (!cancelled) setGeoNames(prev => ({ ...prev, [k]: name }));
        // Overpass has no strict rate limit; 300ms keeps requests polite
        await new Promise(res => setTimeout(res, 300));
      }
    })();
    return () => { cancelled = true; };
  }, [persons]);

  const filtered = useMemo(() => {
    let list = persons;
    if (labelFilter === 'home')   list = list.filter(p => (p.label || '').trim().toLowerCase() === 'home');
    if (labelFilter === 'office') list = list.filter(p => (p.label || '').trim().toLowerCase() === 'patrika office');
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.branch.toLowerCase().includes(q) ||
      (p.purpose || '').toLowerCase().includes(q) ||
      (p.label || p.location || '').toLowerCase().includes(q)
    );
  }, [persons, search, labelFilter]);

  const visible = showAll ? filtered : filtered.slice(0, 25);

  const vs = visits.summary;

  return (
    <div className="space-y-5">

      {/* ── Admin: Send Alert + Report ───────────────────────────────────────── */}
      {canManageAlerts && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              className="btn flex items-center gap-2 text-sm"
              style={{ background: '#dc2626', color: '#fff' }}
              onClick={sendAlert}
              disabled={alertSending}
            >
              {alertSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {alertSending ? 'Sending…' : 'Send Home/Office Alert'}
            </button>
            <button
              className="btn-ghost flex items-center gap-2 text-sm"
              onClick={toggleLogs}
            >
              <ClipboardList size={14} />
              {showLogs ? 'Hide Report' : 'View Report'}
            </button>
            {alertResult && (
              <span className="text-xs font-medium" style={{ color: alertResult.ok ? '#16a34a' : '#dc2626' }}>
                {alertResult.ok
                  ? alertResult.skipped ? 'No home/office visits found for this date.' : `✓ Sent: ${alertResult.sent}, Failed: ${alertResult.failed}`
                  : `✗ ${alertResult.error}`}
              </span>
            )}
          </div>

          {showLogs && (
            <SectionCard title="Home/Office Visit Alert Report">
              {logsLoading
                ? <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--muted)' }} /></div>
                : alertLogs.length === 0
                  ? <p className="text-sm py-6 text-center" style={{ color: 'var(--muted)' }}>No alerts sent yet.</p>
                  : <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                            <th className="pb-2 pr-3 text-left">#</th>
                            <th className="pb-2 pr-3 text-left">RE Name</th>
                            <th className="pb-2 pr-3 text-left">Branch</th>
                            <th className="pb-2 pr-3 text-left">Date</th>
                            <th className="pb-2 pr-3 text-left">🏠 Home</th>
                            <th className="pb-2 pr-3 text-left">🏢 Office</th>
                            <th className="pb-2 pr-3 text-left">Reporters</th>
                            <th className="pb-2 pr-3 text-left">Status</th>
                            <th className="pb-2 pr-3 text-left">By</th>
                            <th className="pb-2 text-left">Sent At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {alertLogs.map((l, i) => (
                            <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td className="py-2 pr-3" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                              <td className="py-2 pr-3 font-semibold">{l.re_name}</td>
                              <td className="py-2 pr-3">{l.branch}</td>
                              <td className="py-2 pr-3 font-mono">{l.visit_date ? String(l.visit_date).slice(0,10) : '—'}</td>
                              <td className="py-2 pr-3 font-bold" style={{ color: '#dc2626' }}>{l.home_cnt ?? 0}</td>
                              <td className="py-2 pr-3 font-bold" style={{ color: '#ea580c' }}>{l.office_cnt ?? 0}</td>
                              <td className="py-2 pr-3" style={{ color: 'var(--muted)', maxWidth: 200 }}>{l.reporter_list || '—'}</td>
                              <td className="py-2 pr-3">
                                <span className="font-semibold" style={{ color: l.status === 'sent' ? '#16a34a' : '#dc2626' }}>
                                  {l.status === 'sent' ? '✓ Sent' : '✗ Failed'}
                                </span>
                                {l.error_msg && <div className="text-xs" style={{ color: '#dc2626' }}>{l.error_msg}</div>}
                              </td>
                              <td className="py-2 pr-3" style={{ color: 'var(--muted)' }}>{l.triggered_by}</td>
                              <td className="py-2 text-xs font-mono" style={{ color: 'var(--muted)' }}>{l.sent_at}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
              }
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Home / Office summary cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <Tile icon={MapPin} label="Total Visits"  value={vs.total}              color="#10b981"
          onClick={() => { setLabelFilter(null); setSelected(null); setShowAll(false); }}
          active={labelFilter === null}
        />
        <Tile icon={MapPin} label="Home Visits"   value={vs.home_visits ?? 0}   color="#dc2626"
          onClick={() => { setLabelFilter(f => f === 'home'   ? null : 'home');   setSelected(null); setShowAll(false); }}
          active={labelFilter === 'home'}
        />
        <Tile icon={MapPin} label="Office Visits" value={vs.office_visits ?? 0} color="#ea580c"
          onClick={() => { setLabelFilter(f => f === 'office' ? null : 'office'); setSelected(null); setShowAll(false); }}
          active={labelFilter === 'office'}
        />
      </div>

      {/* ── Visits by Type ──────────────────────────────────────────────────── */}
      <SectionCard title="Visits by Type / Remark">
        {remarkData.length === 0
          ? <p className="text-sm py-8 text-center" style={{ color: 'var(--muted)' }}>No visit data for selected date.</p>
          : <ResponsiveContainer width="100%" height={Math.max(180, remarkData.length * 30)}>
              <BarChart data={remarkData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted)" fontSize={11} />
                <YAxis type="category" dataKey="name" width={110} stroke="var(--muted)" fontSize={9} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0,4,4,0]} barSize={14}
                  label={{ position: 'right', fontSize: 10 }} />
              </BarChart>
            </ResponsiveContainer>
        }
      </SectionCard>

      {/* ── Person-wise visits ───────────────────────────────────────────────── */}
      <SectionCard
        title={`Person-wise Visits${labelFilter === 'home' ? ' · Home' : labelFilter === 'office' ? ' · Patrika Office' : ''} · ${filtered.length} reporter${filtered.length !== 1 ? 's' : ''}`}
        action={
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--muted)' }} />
            <input
              className="input py-1 pl-6 text-xs w-48"
              placeholder="Search name / branch / purpose…"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowAll(false); }}
            />
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-5">

          {/* Table — 3/5 width */}
          <div className="lg:col-span-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  <th className="pb-2 pr-3 text-left font-semibold">Name</th>
                  <th className="pb-2 pr-3 text-left font-semibold">Branch</th>
                  <th className="pb-2 pr-3 text-left font-semibold">In</th>
                  <th className="pb-2 pr-3 text-left font-semibold">Out</th>
                  <th className="pb-2 pr-3 text-left font-semibold">Duration</th>
                  <th className="pb-2 pr-3 text-left font-semibold">Purpose</th>
                  <th className="pb-2 pr-3 text-left font-semibold">Label</th>
                  <th className="pb-2 pr-3 text-left font-semibold">Nearby Location</th>
                  <th className="pb-2 text-left font-semibold">GPS Address</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center" style={{ color: 'var(--muted)' }}>
                    {search ? 'No reporters match your search.' : 'No visit data for this date.'}
                  </td></tr>
                )}
                {visible.map((p, i) => {
                  const isSel = selected?.pan_no === p.pan_no && selected?.in_time === p.in_time;
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelected(isSel ? null : p)}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isSel ? 'var(--brand)10' : undefined,
                      }}
                    >
                      <td className="py-2 pr-3 font-semibold" style={{ color: isSel ? 'var(--brand)' : undefined }}>
                        {p.name}
                        {p.lat && <Navigation size={9} className="inline ml-1 opacity-50" />}
                      </td>
                      <td className="py-2 pr-3" style={{ color: 'var(--muted)' }}>{p.branch}</td>
                      <td className="py-2 pr-3 font-mono">{p.in_time  || '—'}</td>
                      <td className="py-2 pr-3 font-mono">{p.out_time || '—'}</td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1" style={{ color: p.dur_min >= 60 ? '#16a34a' : 'var(--text)' }}>
                          <Clock size={10} />
                          {fmtDuration(p.dur_min)}
                        </span>
                      </td>
                      <td className="py-2 pr-3" style={{ color: 'var(--muted)', maxWidth: 110 }}>{p.purpose}</td>
                      <td className="py-2 pr-3 text-xs" style={{ maxWidth: 120 }}>
                        {p.label ? (
                          <span
                            className="font-semibold"
                            style={isHomeOffice(p.label)
                              ? { color: '#dc2626', background: '#dc262615', padding: '2px 6px', borderRadius: 6 }
                              : { color: 'var(--text)' }}
                          >
                            {p.label}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td className="py-2 pr-3 font-medium text-xs" style={{ maxWidth: 160 }}>
                        {p.lat ? (
                          geoNames[geoKey(p.lat, p.lng)]
                            ? <span className="flex items-center gap-1">
                                <MapPin size={10} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                                {geoNames[geoKey(p.lat, p.lng)]}
                              </span>
                            : <span style={{ color: 'var(--muted)' }}>…</span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td className="py-2 text-xs" style={{ color: 'var(--muted)', maxWidth: 140 }}>
                        {p.location || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 25 && (
              <button className="btn-ghost mt-2 w-full text-xs" onClick={() => setShowAll(s => !s)}>
                {showAll ? 'Show less' : `Show all ${filtered.length} reporters ↓`}
              </button>
            )}
          </div>

          {/* Detail panel — 2/5 width */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {/* Info header */}
                <div className="p-3" style={{ background: 'var(--bg)' }}>
                  <div className="font-bold text-sm mb-0.5">{selected.name}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{selected.branch} · {selected.state}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div style={{ color: 'var(--muted)' }}>In</div>
                      <div className="font-mono font-semibold">{selected.in_time  || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--muted)' }}>Out</div>
                      <div className="font-mono font-semibold">{selected.out_time || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--muted)' }}>Duration</div>
                      <div className="font-semibold" style={{ color: '#16a34a' }}>{fmtDuration(selected.dur_min)}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs">
                    <span style={{ color: 'var(--muted)' }}>Purpose: </span>{selected.purpose}
                  </div>
                  {selected.transport && (
                    <div className="text-xs"><span style={{ color: 'var(--muted)' }}>Transport: </span>{selected.transport}</div>
                  )}
                  {selected.label && (
                    <div className="text-xs">
                      <span style={{ color: 'var(--muted)' }}>Label: </span>
                      <span className="font-semibold" style={{ color: isHomeOffice(selected.label) ? '#dc2626' : 'var(--text)' }}>
                        {selected.label}
                      </span>
                    </div>
                  )}
                  {selected.lat && geoNames[geoKey(selected.lat, selected.lng)] && (
                    <div className="mt-1 text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                      <MapPin size={11} className="inline mr-1" />
                      {geoNames[geoKey(selected.lat, selected.lng)]}
                    </div>
                  )}
                  {selected.location && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)', marginLeft: 15 }}>
                      {selected.location}
                    </div>
                  )}
                  {selected.lat && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)', marginLeft: 15 }}>
                      {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                    </div>
                  )}
                </div>

                {/* Mini-map */}
                {selected.lat ? (
                  <div style={{ height: 220 }}>
                    <MapContainer
                      center={[selected.lat, selected.lng]}
                      zoom={14}
                      style={{ height: '100%', width: '100%' }}
                      zoomControl={false}
                      scrollWheelZoom={false}
                    >
                      <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <FlyTo lat={selected.lat} lng={selected.lng} />
                      <CircleMarker
                        center={[selected.lat, selected.lng]}
                        radius={10}
                        pathOptions={{ fillColor: '#d71920', fillOpacity: 0.9, color: '#fff', weight: 2 }}
                      >
                        <Popup>
                          <b>{selected.name}</b><br />
                          {selected.label || selected.location || ''}
                        </Popup>
                      </CircleMarker>
                    </MapContainer>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                    <MapPin size={16} />
                    No GPS data for this visit
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 gap-2 rounded-xl border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)', borderStyle: 'dashed' }}>
                <MapPin size={24} />
                <p className="text-xs">Click a reporter to see<br />visit details and location</p>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PageMonitoring() {
  const { t, state: globalState, branch: globalBranch } = useApp();
  const [date,    setDate]    = useState(yesterday());
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('news');

  const load = (d, st, br) => {
    setLoading(true);
    api.pages(d, st, br)
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(date, globalState, globalBranch); }, [date, globalState, globalBranch]);

  const shiftDate = (n) => {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    setDate(d.toISOString().slice(0, 10));
  };

  const downloadExcel = () => {
    if (!data) return;
    const cats = data.news.categories.map(c => ({ Category: c.name, Count: c.value }));
    const qcRows = data.qc.recent.map(r => ({
      Date: r.date, Category: r.category, Severity: r.severity,
      State: r.state, Edition: r.edition, Pullout: r.pullout,
      Mistakes: r.mistakes, Description: r.mistake,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cats),   'News Categories');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qcRows), 'QC Review');
    XLSX.writeFile(wb, `page_monitoring_${date}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title={t('nav.pages')}
        subtitle={`News categories · QC review · Field visits with GPS map${globalState !== 'All' ? ` · ${globalState}` : ''}${globalBranch !== 'All' ? ` › ${globalBranch}` : ''}`}
      />

      {/* ── Controls ─────────────────────────────────────────────────────── */}
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

        <button onClick={() => load(date, globalState, globalBranch)} className="btn-ghost p-1.5" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={downloadExcel} className="btn-ghost flex items-center gap-1.5 text-sm" disabled={!data}>
          <Download size={14} /> Excel
        </button>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition"
            style={{
              background: tab === id ? 'var(--brand)' : 'var(--surface)',
              color:      tab === id ? '#fff'         : 'var(--text)',
              border:     `1px solid ${tab === id ? 'var(--brand)' : 'var(--border)'}`,
            }}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 size={20} className="animate-spin" /> Loading page data…
        </div>
      ) : !data || (!data.news?.summary?.stories && !data.qc?.summary?.total && !data.visits?.summary?.total) ? (
        <div className="flex flex-col items-center justify-center py-24 gap-2" style={{ color: 'var(--muted)' }}>
          <Newspaper size={32} />
          <p className="text-sm">No data found for <strong>{date}</strong></p>
          <p className="text-xs">Try selecting a different date.</p>
        </div>
      ) : (
        <>
          {tab === 'news'     && <NewsTab     data={data} />}
          {tab === 'qc'       && <QCTab       data={data} />}
          {tab === 'visits'   && <VisitsTab   data={data} date={date} />}
        </>
      )}
    </div>
  );
}
