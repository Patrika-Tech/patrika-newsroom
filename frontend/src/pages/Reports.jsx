import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet, RefreshCw, ChevronDown, ChevronUp,
  FileText, Clock, AlertCircle, MapPin, Award, Users, Newspaper,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader } from '../components/UI.jsx';

// ── Report catalogue ─────────────────────────────────────────────────────────
const REPORTS = [
  {
    type: 'reporter',
    icon: FileText,
    color: '#d71920',
    label: 'Reporter Performance',
    desc: 'Story, photo & word count per reporter for a selected date range.',
    filterType: 'dateRange',
  },
  {
    type: 'edition',
    icon: Clock,
    color: '#C9A227',
    label: 'Edition Delays',
    desc: 'Schedule vs actual release time for all editions on a selected date.',
    filterType: 'date',
  },
  {
    type: 'qc',
    icon: AlertCircle,
    color: '#8c0a0e',
    label: 'QC Mistakes',
    desc: 'Quality control issues by date range, edition and severity level.',
    filterType: 'dateRange',
  },
  {
    type: 'visits',
    icon: MapPin,
    color: '#16a34a',
    label: 'Field Visits',
    desc: 'Reporter field visit logs with time, location and transport details.',
    filterType: 'dateRange',
  },
  {
    type: 'grading',
    icon: Award,
    color: '#7c3aed',
    label: 'PLI & Grading',
    desc: 'Employee grading scores (Work / Behaviour / Discipline / Interest) by month.',
    filterType: 'month',
  },
  {
    type: 'employees',
    icon: Users,
    color: '#3b82f6',
    label: 'Employee Directory',
    desc: 'Active employees with profile, state, branch and contact details.',
    filterType: 'none',
  },
  {
    type: 'press_release',
    icon: Newspaper,
    color: '#0891b2',
    label: 'Press Release Report',
    desc: 'Active employees working on press releases — entry count, editions and last activity date.',
    filterType: 'dateRange',
    defaultTo: 'today',
  },
];

// ── Date helpers ──────────────────────────────────────────────────────────────
const today   = () => new Date().toISOString().slice(0, 10);
const yday    = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

// ── Excel export ──────────────────────────────────────────────────────────────
function downloadExcel(report, label) {
  const ws = XLSX.utils.aoa_to_sheet([report.columns, ...report.rows]);
  // Auto column widths
  const colWidths = report.columns.map((h, ci) => {
    const maxLen = Math.max(h.length, ...report.rows.map(r => String(r[ci] ?? '').length));
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 31));
  const filename = `${label.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_COLOR = { 'On Time': '#16a34a', 'Warning': '#C9A227', 'Late': '#d71920' };
function statusBadge(val) {
  const c = STATUS_COLOR[val];
  if (!c) return val;
  return <span style={{ background: c + '22', color: c, padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{val}</span>;
}

// ── Preview table ─────────────────────────────────────────────────────────────
function PreviewTable({ columns, rows, label, total }) {
  const preview = rows.slice(0, 25);
  return (
    <div style={{ marginTop: 16 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Showing {preview.length} of {total} rows
          {total > 25 && ' — download Excel for full report'}
        </span>
        <button
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
          onClick={() => downloadExcel({ columns, rows }, label)}
        >
          <FileSpreadsheet size={15} />
          Download Excel ({total} rows)
        </button>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-alt, #f8f9fa)' }}>
              {columns.map((col, i) => (
                <th key={i} style={{
                  padding: '8px 10px', textAlign: 'left', fontWeight: 700,
                  borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap',
                  color: 'var(--text)', fontSize: 11,
                }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: '1px solid var(--border)', background: ri % 2 === 0 ? 'transparent' : 'var(--surface-alt, #fafafa)' }}>
                {row.map((cell, ci) => {
                  const col = columns[ci];
                  const isStatus = col === 'Status';
                  const isNum = typeof cell === 'number';
                  return (
                    <td key={ci} style={{
                      padding: '6px 10px', whiteSpace: 'nowrap',
                      textAlign: isNum ? 'right' : 'left',
                      color: isNum && cell < 0 ? '#16a34a' : isNum && cell > 30 && col.includes('min') ? '#d71920' : 'inherit',
                    }}>
                      {isStatus ? statusBadge(cell) : cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Filter panel ──────────────────────────────────────────────────────────────
function FilterPanel({ filterType, value, onChange, maxToday = false }) {
  if (filterType === 'none') return null;

  const inputStyle = {
    border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px',
    background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
  };
  const maxDate = maxToday ? today() : yday();

  if (filterType === 'dateRange') {
    return (
      <div className="flex flex-wrap gap-3 items-center mt-3">
        <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>From</label>
        <input type="date" style={inputStyle} value={value.from}
          onChange={e => onChange({ ...value, from: e.target.value })} max={maxDate} />
        <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>To</label>
        <input type="date" style={inputStyle} value={value.to}
          onChange={e => onChange({ ...value, to: e.target.value })} max={maxDate} />
      </div>
    );
  }

  if (filterType === 'date') {
    return (
      <div className="flex flex-wrap gap-3 items-center mt-3">
        <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Date</label>
        <input type="date" style={inputStyle} value={value.date}
          onChange={e => onChange({ ...value, date: e.target.value })} max={yday()} />
      </div>
    );
  }

  if (filterType === 'month') {
    return (
      <div className="flex flex-wrap gap-3 items-center mt-3">
        <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Month</label>
        <input type="month" style={inputStyle} value={value.month}
          onChange={e => onChange({ ...value, month: e.target.value })} max={thisMonth()} />
      </div>
    );
  }
  return null;
}

// ── Default filter values ─────────────────────────────────────────────────────
function defaultFilters(report) {
  const { filterType, defaultTo } = report;
  if (filterType === 'dateRange') return { from: daysAgo(7), to: defaultTo === 'today' ? today() : yday() };
  if (filterType === 'date')      return { date: yday() };
  if (filterType === 'month')     return { month: thisMonth() };
  return {};
}

// ── Single Report Card ────────────────────────────────────────────────────────
function ReportCard({ report, globalState, globalBranch }) {
  const { type, icon: Icon, color, label, desc, filterType, defaultTo } = report;
  const [open,    setOpen]    = useState(false);
  const [filters, setFilters] = useState(() => defaultFilters(report));
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');

  function generate() {
    setLoading(true);
    setError('');
    const params = { ...filters };
    if (globalState  && globalState  !== 'All') params.state  = globalState;
    if (globalBranch && globalBranch !== 'All') params.branch = globalBranch;
    api.generateReport(type, params)
      .then(d => {
        if (d.error) { setError(d.error); setData(null); }
        else setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  // Auto-generate when opened for the first time if no data
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) generate();
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* ── Card header ─ */}
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 p-4 text-left"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <span className="rounded-xl p-2.5 flex-shrink-0" style={{ background: color + '18', color }}>
          <Icon size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">{label}</div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{desc}</div>
        </div>
        {data && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full mr-2 flex-shrink-0"
            style={{ background: color + '18', color }}>
            {data.total.toLocaleString()} rows
          </span>
        )}
        <span style={{ color: 'var(--muted)', flexShrink: 0 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* ── Expanded panel ─ */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '16px' }}>
          <div className="flex flex-wrap items-end gap-3">
            <FilterPanel filterType={filterType} value={filters} onChange={setFilters} maxToday={defaultTo === 'today'} />
            <button
              className="btn-ghost flex items-center gap-2 text-sm px-4 py-2 mt-3"
              onClick={generate}
              disabled={loading}
              style={{ marginTop: filterType === 'none' ? 0 : undefined }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Generating…' : data ? 'Refresh' : 'Generate'}
            </button>
          </div>

          {error && (
            <div className="mt-3 text-sm text-red-600 rounded-lg p-3"
              style={{ background: '#d7192015', color: '#d71920' }}>
              Error: {error}
            </div>
          )}

          {loading && (
            <div className="mt-4 space-y-2">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="animate-pulse rounded h-8 w-full" style={{ background: 'var(--border)' }} />
              ))}
            </div>
          )}

          {!loading && data && data.rows.length === 0 && (
            <p className="mt-4 text-sm text-center py-6" style={{ color: 'var(--muted)' }}>
              No data found for the selected filters.
            </p>
          )}

          {!loading && data && data.rows.length > 0 && (
            <PreviewTable
              columns={data.columns}
              rows={data.rows}
              label={label}
              total={data.total}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary stat cards ────────────────────────────────────────────────────────
function StatChip({ label, value, color }) {
  return (
    <div className="card p-3 flex items-center gap-3" style={{ minWidth: 140 }}>
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
        <div className="font-bold text-lg">{value}</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Reports() {
  const { t, state: globalState, branch: globalBranch } = useApp();
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summary, setSummary] = useState(null);

  // Load a quick dashboard summary to show at the top
  useEffect(() => {
    setSummaryLoading(true);
    api.dashboard(globalState, globalBranch)
      .then(d => setSummary(d?.kpis || null))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [globalState, globalBranch]);

  const subtitle = [
    globalState  !== 'All' && globalState  ? globalState  : null,
    globalBranch !== 'All' && globalBranch ? globalBranch : null,
  ].filter(Boolean).join(' › ') || 'All States · All Branches';

  return (
    <div>
      <PageHeader
        title={t('nav.reports')}
        subtitle={`${subtitle} — click a report card to expand, set filters and download Excel`}
      />

      {/* Report cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map(report => (
          <ReportCard
            key={report.type}
            report={report}
            globalState={globalState}
            globalBranch={globalBranch}
          />
        ))}
      </div>

      <p className="mt-6 text-xs text-center" style={{ color: 'var(--muted)' }}>
        All reports pull live data from MySQL. Excel files are generated in your browser — no server upload.
        Preview shows first 25 rows; downloaded Excel contains all rows (up to 5,000).
      </p>
    </div>
  );
}
