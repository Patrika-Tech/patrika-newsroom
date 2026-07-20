import { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, PieChart, Pie, LineChart, Line, Legend,
} from 'recharts';
import {
  X, CalendarClock, Users, UserCheck, UserX,
  Building2, Save, Loader2, Download, Plus, Upload, CheckCircle2,
  Clock, Star, BarChart2, ShieldCheck, FileText, Briefcase, Trash2,
  ChevronDown, RefreshCw, Camera, PenLine, Monitor, Newspaper,
  CalendarDays, ChevronRight, AlertCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { HR_FIELDS } from '../data/mock.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcAge(dob) {
  if (!dob) return null;
  const parts = String(dob).split('-');
  let d;
  if (parts[0].length === 4) d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  else                        d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  if (isNaN(d)) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function downloadExcel(rows, includesSalary, filename = 'employees') {
  const data = rows.map(e => {
    const age = calcAge(e.DOB);
    const row = {
      'Emp Code':    e.EMP_CODE        || '',
      'Name':        e.EMPNAME         || '',
      'Father Name': e.FATHER_NAME     || '',
      'Designation': e.emp_designation || '',
      'Department':  e.emp_deptt       || '',
      'Branch':      e.Branch          || '',
      'State':       e.State           || '',
      'Location':    e.Location        || '',
      'DOB':         e.DOB             || '',
      'Age':         age ?? '',
      'DOJ':         e.DOJ             || '',
      'Status':      (e.is_emp_working == 1 || e.Status === 'Active') ? 'Working' : 'Inactive',
      'Email':       e.Email_ID        || '',
      'Mobile':      e.Mob_No          || '',
    };
    if (includesSalary) {
      row['PAN No']       = e.pan_no        || '';
      row['Gross Salary'] = e.gross_salary  || '';
      row['PLI']          = e.emp_pli       || '';
      row['Grand Total']  = e.g_total       || '';
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const cols = Object.keys(data[0] || {}).map(k => ({
    wch: Math.max(k.length, ...data.map(r => String(r[k] || '').length), 10),
  }));
  ws['!cols'] = cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

const COLORS = ['#C9A227', '#d71920', '#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#06b6d4'];
const GRADE_COLOR = { A: '#10b981', B: '#3b82f6', C: '#C9A227', D: '#d71920' };
const TABS = [
  { key: 'overview',      label: 'Overview',            icon: BarChart2  },
  { key: 'recruitment',   label: 'Recruitment',         icon: Briefcase  },
  { key: 'training',      label: 'Training & Induction',icon: Star       },
  { key: 'grading',       label: 'PLI & Grading',       icon: ShieldCheck},
  { key: 'correspondent', label: 'Correspondent',       icon: Newspaper  },
  { key: 'admin',         label: 'Admin',               icon: Building2  },
];

const currentMonth = () => new Date().toISOString().slice(0, 7);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function Hr() {
  const { t, canEditHr, canViewHr, canEditGrading, canEditTraining, isAdmin, isBranchRestricted, user, state: globalState, branch: globalBranch } = useApp();
  const [tab,     setTab]     = useState('overview');
  const [emps,    setEmps]    = useState([]);
  const [rets,    setRets]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  // Load employees once
  useEffect(() => {
    Promise.all([api.hrEmployees(), api.hrRetirements()])
      .then(([e, r]) => { setEmps(e || []); setRets(r || []); })
      .finally(() => setLoading(false));
  }, []);

  // Filter by global State + Branch
  const filtered = useMemo(() => emps.filter(e => {
    const matchState  = globalState  === 'All' || e.State  === globalState;
    const matchBranch = globalBranch === 'All' || e.Branch === globalBranch;
    return matchState && matchBranch;
  }), [emps, globalState, globalBranch]);

  const filteredRets = useMemo(() => rets.filter(r => {
    const matchState  = globalState  === 'All' || r.State  === globalState;
    const matchBranch = globalBranch === 'All' || r.Branch === globalBranch;
    return matchState && matchBranch;
  }), [rets, globalState, globalBranch]);

  // Charts - all use `filtered` so they respond to top-left state/branch selection
  const ageBuckets = useMemo(() => {
    const b = { '20-29': 0, '30-39': 0, '40-49': 0, '50-57': 0, '58+ (Ret.)': 0 };
    filtered.forEach(e => {
      const a = calcAge(e.DOB);
      if (!a) return;
      if (a < 30) b['20-29']++;
      else if (a < 40) b['30-39']++;
      else if (a < 50) b['40-49']++;
      else if (a < 58) b['50-57']++;
      else b['58+ (Ret.)']++;
    });
    return Object.entries(b).map(([range, count]) => ({ range, count }));
  }, [filtered]);

  const deptBuckets = useMemo(() => {
    const m = {};
    filtered.forEach(e => { const d = e.emp_deptt || 'Unknown'; m[d] = (m[d] || 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const save = async (emp) => {
    await api.saveEmployee(emp);
    setEmps(prev => {
      const i = prev.findIndex(p => p.EMP_CODE === emp.EMP_CODE);
      if (i >= 0) { const c = [...prev]; c[i] = emp; return c; }
      return [...prev, emp];
    });
    setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('nav.hr')} subtitle="Employee management · recruitment · training · PLI & grading · admin" />

      {/* â”€â”€ Tab Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex gap-1 mb-5 border-b overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
        {TABS
          .filter(({ key }) => {
            if (key === 'admin') return isAdmin();
            if (key === 'correspondent') return ['State Head', 'Regional Editor'].includes(user?.role) && (user?.state || '').toLowerCase() === 'rajasthan';
            if (isBranchRestricted()) return key !== 'recruitment';
            return true;
          })
          .map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition -mb-px ${
              tab === key
                ? 'border-[var(--brand)] text-[var(--brand)]'
                : 'border-transparent hover:border-gray-300'
            }`}
            style={tab !== key ? { color: 'var(--muted)' } : {}}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* â”€â”€ Tab Panels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {tab === 'overview' && (
        <OverviewTab
          emps={emps} filtered={filtered} rets={filteredRets} loading={loading}
          ageBuckets={ageBuckets} deptBuckets={deptBuckets}
          canViewHr={canViewHr} canEditHr={canEditHr}
          onEdit={setEditing}
          onDownload={() => downloadExcel(filtered, canViewHr())}
        />
      )}
      {tab === 'recruitment'   && <RecruitmentTab />}
      {tab === 'training'      && <TrainingTab emps={filtered} canEditHr={canEditTraining} />}
      {tab === 'grading'       && <GradingTab  emps={filtered} canEditHr={canEditGrading} canViewHr={canViewHr} />}
      {tab === 'correspondent' && <CorrespondentTab />}
      {tab === 'admin'         && <AdminTab    emps={filtered} canEditHr={canEditHr} />}

      {editing && <EmployeeModal emp={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// OVERVIEW TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function OverviewTab({ emps, filtered, rets, loading, ageBuckets, deptBuckets,
  canViewHr, canEditHr, onEdit, onDownload }) {

  // â”€â”€ Profile-wise counts from Story_Type field â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // RE: Story_Type is exactly "RE" (word boundary match, not "Reporter")
  // Reporter: contains word "reporter"
  // Desk: contains word "desk"
  // Photographer: contains "photo"
  const profileCounts = useMemo(() => {
    const counts = { RE: 0, Reporter: 0, Desk: 0, Photographer: 0 };
    filtered.forEach(e => {
      const st = (e.Story_Type || '').toLowerCase().trim();
      if (/\bre\b/.test(st))            counts.RE++;
      else if (st.includes('reporter')) counts.Reporter++;
      else if (st.includes('desk'))     counts.Desk++;
      else if (st.includes('photo'))    counts.Photographer++;
    });
    return counts;
  }, [filtered]);

  const [search, setSearch] = useState('');
  const [page,   setPage]   = useState(1);
  const PAGE_SIZE = 50;

  // Only working employees under retirement age (58) — 58+ appear in Retirement Alerts
  const tableRows = useMemo(() => {
    return filtered.filter(e => {
      const working = e.Status === 'Working' || e.is_emp_working == 1 || e.Status === 'Active';
      if (!working) return false;
      const age = calcAge(e.DOB);
      if (age !== null && age >= 58) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (e.EMPNAME    || '').toLowerCase().includes(q) ||
          (e.pan_no     || '').toLowerCase().includes(q) ||
          (e.emp_deptt  || '').toLowerCase().includes(q) ||
          (e.Story_Type || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [filtered, search]);

  // Reset to page 1 whenever the result set changes
  useEffect(() => { setPage(1); }, [search, filtered.length]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = tableRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
        <Tile icon={ShieldCheck} label="RE"           value={profileCounts.RE}           color="#3b82f6" />
        <Tile icon={PenLine}     label="Reporter"     value={profileCounts.Reporter}     color="#10b981" />
        <Tile icon={Monitor}     label="Desk"         value={profileCounts.Desk}         color="#C9A227" />
        <Tile icon={Camera}      label="Photographer" value={profileCounts.Photographer} color="#8b5cf6" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <SectionCard title="Age-wise Distribution" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ageBuckets} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" stroke="var(--muted)" fontSize={12} />
              <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={12} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {ageBuckets.map((b, i) => (
                  <Cell key={i} fill={b.range === '58+ (Ret.)' ? '#d71920' : '#C9A227'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Department-wise">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={deptBuckets} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={75}
                label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={10}>
                {deptBuckets.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {rets.length > 0 && (
        <SectionCard title="Retirement Alerts (Age 58+)" className="mb-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rets.map(r => (
              <div key={r.EMP_CODE} className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{r.EMPNAME}</span>
                  <Badge tone={r.window === 'This month' || r.window === 'Overdue' ? 'high' : 'med'}>{r.window}</Badge>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  <CalendarClock size={11} className="inline mr-1" />
                  Retires: {r.retireOn} &middot; {r.emp_deptt} &middot; {r.Branch}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={`Employees - Working (${tableRows.length})`}
        action={
          <button onClick={onDownload} className="btn-ghost flex items-center gap-1.5 text-sm">
            <Download size={14} /> Excel
          </button>
        }
      >
        {/* â”€â”€ Search filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="text"
            placeholder="Search name, PAN, dept..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input py-1.5 text-sm flex-1 min-w-[160px]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="btn-ghost py-1.5 text-sm"
            >
              <X size={13} className="inline mr-1" />Clear
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
              <Loader2 size={16} className="animate-spin" /> Loading employees...
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="p-2">PAN No</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Story Type</th>
                  <th className="p-2">Department</th>
                  <th className="p-2">Branch</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Age</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 && (
                  <tr><td colSpan={20} className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>No working employees match the current filters.</td></tr>
                )}
                {pageRows.map(e => {
                  const age = calcAge(e.DOB);
                  return (
                    <tr key={e.EMP_CODE} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 font-mono text-xs font-semibold">{e.pan_no || '-'}</td>
                      <td className="p-2 font-semibold whitespace-nowrap">{e.EMPNAME}</td>
                      <td className="p-2">{e.Story_Type === 'NE' ? (e.profile || 'NE') : (e.Story_Type || '-')}</td>
                      <td className="p-2">{e.emp_deptt}</td>
                      <td className="p-2">{e.Branch}</td>
                      <td className="p-2">{e.State}</td>
                      <td className="p-2">{age ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ─────────────────────────────────────────────────── */}
        {tableRows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between flex-wrap gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, tableRows.length)} of {tableRows.length}
            </span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost px-2 py-1 text-sm" disabled={safePage <= 1}
                onClick={() => setPage(1)} style={{ opacity: safePage <= 1 ? 0.4 : 1 }}>«</button>
              <button className="btn-ghost px-2 py-1 text-sm" disabled={safePage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))} style={{ opacity: safePage <= 1 ? 0.4 : 1 }}>‹ Prev</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 2)
                .reduce((acc, n, i, arr) => {
                  if (i > 0 && n - arr[i - 1] > 1) acc.push('…');
                  acc.push(n);
                  return acc;
                }, [])
                .map((n, i) => n === '…' ? (
                  <span key={`gap-${i}`} className="px-1 text-xs" style={{ color: 'var(--muted)' }}>…</span>
                ) : (
                  <button key={n} onClick={() => setPage(n)}
                    className="px-2.5 py-1 rounded-lg text-sm font-semibold"
                    style={{
                      background: n === safePage ? 'var(--brand)' : 'transparent',
                      color:      n === safePage ? '#fff' : 'var(--text)',
                      border: `1px solid ${n === safePage ? 'var(--brand)' : 'var(--border)'}`,
                      cursor: 'pointer',
                    }}>
                    {n}
                  </button>
                ))}
              <button className="btn-ghost px-2 py-1 text-sm" disabled={safePage >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{ opacity: safePage >= totalPages ? 0.4 : 1 }}>Next ›</button>
              <button className="btn-ghost px-2 py-1 text-sm" disabled={safePage >= totalPages}
                onClick={() => setPage(totalPages)} style={{ opacity: safePage >= totalPages ? 0.4 : 1 }}>»</button>
            </div>
          </div>
        )}
      </SectionCard>

    </div>
  );
}



// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RECRUITMENT TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CANDIDATE_FIELDS = [
  { key: 'name',          label: 'Full Name',        required: true },
  { key: 'father_name',   label: "Father's Name" },
  { key: 'gender',        label: 'Gender',           type: 'select', options: ['Male','Female','Other'] },
  { key: 'dob',           label: 'Date of Birth',    type: 'date' },
  { key: 'email',         label: 'Email' },
  { key: 'mobile',        label: 'Mobile' },
  { key: 'address',       label: 'Address' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'experience',    label: 'Experience' },
  { key: 'aadhar',        label: 'Aadhar No.' },
  { key: 'pan',           label: 'PAN No.' },
  { key: 'applied_for',   label: 'Applied For (Post)' },
  { key: 'state',         label: 'State' },
  { key: 'branch',        label: 'Branch' },
  { key: 'notes',         label: 'Notes / Remarks' },
];

const CV_FIELDS = [
  { key: 'name',          label: 'Name',          w: 140 },
  { key: 'father_name',   label: "Father's Name",  w: 140 },
  { key: 'gender',        label: 'Gender',          w: 80, type: 'select', options: ['','Male','Female','Other'] },
  { key: 'email',         label: 'Email',           w: 170 },
  { key: 'mobile',        label: 'Mobile',          w: 110 },
  { key: 'qualification', label: 'Qualification',   w: 140 },
  { key: 'experience',    label: 'Experience',      w: 120 },
  { key: 'applied_for',   label: 'Applied For',     w: 140 },
  { key: 'state',         label: 'State',           w: 100 },
  { key: 'branch',        label: 'Branch',          w: 120 },
  { key: 'pan',           label: 'PAN',             w: 110 },
];

function RecruitmentTab() {
  const { canEditHr, globalState, globalBranch } = useApp();
  const [candidates,    setCandidates]    = useState([]);
  const [filter,        setFilter]        = useState('all');
  const [loading,       setLoading]       = useState(true);
  const [showForm,      setShowForm]      = useState(false);
  const [saving,        setSaving]        = useState(null);

  // CV upload / parse state
  const [uploading,     setUploading]     = useState(false);
  const [extracted,     setExtracted]     = useState([]);   // parsed rows (editable)
  const [savingAll,     setSavingAll]     = useState(false);
  const [savedCount,    setSavedCount]    = useState(0);
  const cvInputRef = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.hrCandidates(filter, globalState, globalBranch).then(d => setCandidates(d || [])).finally(() => setLoading(false));
  }, [filter, globalState, globalBranch]);

  useEffect(() => { load(); }, [load]);

  // â”€â”€ CV file upload & parse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCVUpload = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploading(true);
    setExtracted([]);
    setSavedCount(0);
    try {
      const res = await api.parseCVs(files);
      setExtracted((res.results || []).map((r, i) => ({ ...r, _id: i, _saved: false, _saving: false })));
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Inline edit an extracted row
  const setExtField = (idx, key, val) =>
    setExtracted(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));

  // Remove one extracted row without saving
  const removeExtracted = (idx) =>
    setExtracted(prev => prev.filter((_, i) => i !== idx));

  // Save one extracted row to DB
  const saveOne = async (idx) => {
    const row = extracted[idx];
    setExtracted(prev => prev.map((r, i) => i === idx ? { ...r, _saving: true } : r));
    try {
      await api.addCandidate({ ...row, status: 'pending' });
      setExtracted(prev => prev.map((r, i) => i === idx ? { ...r, _saving: false, _saved: true } : r));
      setSavedCount(c => c + 1);
    } catch (err) {
      alert('Error saving ' + row.filename + ': ' + err.message);
      setExtracted(prev => prev.map((r, i) => i === idx ? { ...r, _saving: false } : r));
    }
  };

  // Save all unsaved rows then reload list
  const saveAll = async () => {
    setSavingAll(true);
    const pending = extracted.map((r, i) => ({ ...r, _idx: i })).filter(r => !r._saved);
    for (const row of pending) {
      await saveOne(row._idx).catch(() => {});
    }
    setSavingAll(false);
    load();
  };

  // â”€â”€ Existing candidates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAdd = async (data) => {
    try {
      const created = await api.addCandidate(data);
      setCandidates(prev => [created, ...prev]);
      setShowForm(false);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const setStatus = async (id, status) => {
    setSaving(id);
    try {
      const updated = await api.updateCandidate(id, { status });
      setCandidates(prev => prev.map(c => c.id === id ? updated : c));
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(null);
  };

  const deleteRow = async (id) => {
    if (!confirm('Delete this candidate record?')) return;
    await api.deleteCandidate(id);
    setCandidates(prev => prev.filter(c => c.id !== id));
  };

  const visible = filter === 'all' ? candidates : candidates.filter(c => c.status === filter);

  const downloadCandidates = () => {
    const data = visible.map(c => ({
      'Name': c.name || '', "Father's Name": c.father_name || '',
      'Gender': c.gender || '', 'Email': c.email || '', 'Mobile': c.mobile || '',
      'Qualification': c.qualification || '', 'Experience': c.experience || '',
      'Applied For': c.applied_for || '', 'PAN': c.pan || '',
      'Status': c.status || '', 'Notes': c.notes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    XLSX.writeFile(wb, `candidates_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const BADGE = { pending: 'med', eligible: 'active', not_eligible: 'high' };
  const LABEL = { pending: 'Pending', eligible: 'Eligible', not_eligible: 'Not Eligible' };
  const unsavedCount = extracted.filter(r => !r._saved).length;

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile icon={FileText}     label="Total Candidates" value={candidates.length}                                      color="#3b82f6" />
        <Tile icon={CheckCircle2} label="Eligible"         value={candidates.filter(c=>c.status==='eligible').length}     color="#10b981" />
        <Tile icon={UserX}        label="Not Eligible"     value={candidates.filter(c=>c.status==='not_eligible').length} color="#d71920" />
      </div>

      {/* â”€â”€ CV Upload Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {canEditHr() && (
        <SectionCard className="mb-4"
          title={extracted.length ? `CV Review - ${extracted.length} file${extracted.length > 1 ? 's' : ''} parsed` : 'Upload CVs'}
        >
          {/* Drop zone / upload trigger */}
          {!extracted.length && (
            <label
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer py-10 transition hover:opacity-80"
              style={{ borderColor: 'var(--brand)', background: 'var(--bg)' }}
            >
              <Upload size={32} style={{ color: 'var(--brand)' }} />
              <div className="text-center">
                <p className="font-semibold text-sm">Click to upload CVs</p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  PDF, DOCX, DOC, TXT, RTF - single or multiple files
                </p>
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--brand)' }}>
                  <Loader2 size={16} className="animate-spin" /> Parsing files...
                </div>
              )}
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="hidden"
                onChange={handleCVUpload}
                disabled={uploading}
              />
            </label>
          )}

          {/* Review table */}
          {extracted.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }}>
                      <th className="p-1.5 text-left whitespace-nowrap font-medium">File</th>
                      {CV_FIELDS.map(f => (
                        <th key={f.key} className="p-1.5 text-left whitespace-nowrap font-medium">{f.label}</th>
                      ))}
                      <th className="p-1.5 text-center font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extracted.map((row, idx) => (
                      <tr key={row._id}
                        className="border-t"
                        style={{
                          borderColor: 'var(--border)',
                          background: row._saved ? '#10b98110' : row.ok === false ? '#d7192010' : 'transparent',
                        }}
                      >
                        {/* Filename */}
                        <td className="p-1.5 max-w-[110px]">
                          <span className="block truncate text-xs font-medium" title={row.filename} style={{ color: 'var(--muted)' }}>
                            {row.filename}
                          </span>
                          {row.ok === false && (
                            <span className="text-[10px]" style={{ color: '#d71920' }}>Parse error</span>
                          )}
                        </td>

                        {/* Editable fields */}
                        {CV_FIELDS.map(f => (
                          <td key={f.key} className="p-1">
                            {f.type === 'select' ? (
                              <select
                                className="input py-0.5 text-xs"
                                style={{ width: f.w, minWidth: f.w }}
                                value={row[f.key] || ''}
                                onChange={e => setExtField(idx, f.key, e.target.value)}
                                disabled={row._saved}
                              >
                                {f.options.map(o => <option key={o} value={o}>{o || '-'}</option>)}
                              </select>
                            ) : (
                              <input
                                className="input py-0.5 text-xs"
                                style={{ width: f.w, minWidth: f.w }}
                                value={row[f.key] || ''}
                                onChange={e => setExtField(idx, f.key, e.target.value)}
                                disabled={row._saved}
                                placeholder="-"
                              />
                            )}
                          </td>
                        ))}

                        {/* Action */}
                        <td className="p-1.5 text-center whitespace-nowrap">
                          {row._saved ? (
                            <span className="text-xs font-semibold" style={{ color: '#10b981' }}>
                              <CheckCircle2 size={13} className="inline mr-0.5" />Saved
                            </span>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => saveOne(idx)}
                                disabled={row._saving}
                                className="text-xs px-2 py-0.5 rounded font-medium"
                                style={{ background: 'var(--brand)', color: '#fff' }}
                              >
                                {row._saving ? <Loader2 size={11} className="inline animate-spin" /> : <Save size={11} className="inline" />}
                                {' '}Save
                              </button>
                              <button
                                onClick={() => removeExtracted(idx)}
                                className="text-xs p-0.5 rounded hover:opacity-70"
                                style={{ color: 'var(--muted)' }}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom action bar */}
              <div className="flex items-center gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {savedCount} saved &middot; {unsavedCount} pending
                </span>
                {unsavedCount > 0 && (
                  <button
                    onClick={saveAll}
                    disabled={savingAll}
                    className="btn-primary flex items-center gap-1.5 text-sm"
                  >
                    {savingAll ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save All ({unsavedCount})
                  </button>
                )}
                <label className="btn-ghost flex items-center gap-1.5 text-sm cursor-pointer ml-auto">
                  <Upload size={13} /> Upload More
                  <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf" className="hidden" onChange={handleCVUpload} disabled={uploading} />
                </label>
                <button onClick={() => { setExtracted([]); setSavedCount(0); load(); }} className="btn-ghost text-sm">
                  <X size={13} className="inline mr-1" />Close
                </button>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {/* â”€â”€ Candidates Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <SectionCard
        title={`Candidates (${visible.length})`}
        action={
          <div className="flex items-center gap-2">
            <select value={filter} onChange={e => setFilter(e.target.value)} className="input py-1 text-sm">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="eligible">Eligible</option>
              <option value="not_eligible">Not Eligible</option>
            </select>
            <button onClick={downloadCandidates} className="btn-ghost flex items-center gap-1.5 text-sm">
              <Download size={14} /> Excel
            </button>
            {canEditHr() && (
              <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-1.5 text-sm">
                <Plus size={14} /> Add Manually
              </button>
            )}
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="p-2">#</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Father's Name</th>
                  <th className="p-2">Gender</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">Mobile</th>
                  <th className="p-2">Qualification</th>
                  <th className="p-2">Experience</th>
                  <th className="p-2">Applied For</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Branch</th>
                  <th className="p-2">PAN</th>
                  <th className="p-2">Status</th>
                  {canEditHr() && <th className="p-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={14} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No candidates found.</td></tr>
                )}
                {visible.map((c, idx) => (
                  <tr key={c.id} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-2 text-xs" style={{ color: 'var(--muted)' }}>{idx + 1}</td>
                    <td className="p-2 font-semibold whitespace-nowrap">{c.name}</td>
                    <td className="p-2">{c.father_name}</td>
                    <td className="p-2">{c.gender}</td>
                    <td className="p-2">{c.email}</td>
                    <td className="p-2">{c.mobile}</td>
                    <td className="p-2">{c.qualification}</td>
                    <td className="p-2">{c.experience}</td>
                    <td className="p-2">{c.applied_for}</td>
                    <td className="p-2">{c.state}</td>
                    <td className="p-2">{c.branch}</td>
                    <td className="p-2 font-mono text-xs">{c.pan}</td>
                    <td className="p-2">
                      <Badge tone={BADGE[c.status] || 'med'}>{LABEL[c.status] || c.status}</Badge>
                    </td>
                    {canEditHr() && (
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {c.status !== 'eligible' && (
                            <button onClick={() => setStatus(c.id, 'eligible')} disabled={saving === c.id}
                              className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: '#10b98120', color: '#10b981' }}>
                              {saving === c.id ? '...' : 'Eligible'}
                            </button>
                          )}
                          {c.status !== 'not_eligible' && (
                            <button onClick={() => setStatus(c.id, 'not_eligible')} disabled={saving === c.id}
                              className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: '#d7192020', color: '#d71920' }}>
                              {saving === c.id ? '...' : 'Reject'}
                            </button>
                          )}
                          <button onClick={() => deleteRow(c.id)} className="text-xs hover:opacity-70" style={{ color: 'var(--muted)' }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {showForm && <CandidateModal onClose={() => setShowForm(false)} onSave={handleAdd} />}
    </div>
  );
}

function CandidateModal({ onClose, onSave }) {
  const [form, setForm] = useState({ status: 'pending' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name) return alert('Name is required.');
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">Add Candidate</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CANDIDATE_FIELDS.map(f => (
            <div key={f.key}>
              <label className="label mb-1">{f.label}{f.required && ' *'}</label>
              {f.type === 'select' ? (
                <select className="input w-full" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
                  <option value="">Select...</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="input w-full" type={f.type || 'text'} value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary flex items-center gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRAINING & INDUCTION TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const TRAINING_TYPES = ['AI', 'Excel', 'Other'];

function TrainingTab({ emps, canEditHr }) {
  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [markModal,  setMarkModal]  = useState(null);
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    api.hrTraining().then(d => setRecords(d || [])).finally(() => setLoading(false));
  }, []);

  // Build lookup: emp_code|training_type â†’ record
  const lookup = useMemo(() => {
    const m = {};
    records.forEach(r => { m[`${r.emp_code}|${r.training_type}`] = r; });
    return m;
  }, [records]);

  const getRecord = (empCode, type) => lookup[`${empCode}|${type}`] || null;

  // Active / working employees only
  const workingEmps = useMemo(() =>
    emps.filter(e => e.Status === 'Working' || e.is_emp_working == 1 || e.Status === 'Active'),
  [emps]);

  const handleMark = async (empCode, empName, type, trainingName, status, date) => {
    setSaving(true);
    try {
      const payload = {
        emp_code: empCode, emp_name: empName,
        training_type: type, training_name: trainingName,
        status, completed_date: status === 'completed' ? date : null,
      };
      const saved = await api.saveTraining(payload);
      setRecords(prev => {
        const exists = prev.findIndex(r => r.emp_code === empCode && r.training_type === type);
        if (exists >= 0) { const c = [...prev]; c[exists] = saved; return c; }
        return [...prev, saved];
      });
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
    setMarkModal(null);
  };

  const downloadTraining = () => {
    const data = displayEmps.map(e => {
      const row = { 'PAN No': e.pan_no || '', 'Name': e.EMPNAME, 'Branch': e.Branch, 'State': e.State };
      TRAINING_TYPES.forEach(type => {
        const r = getRecord(e.EMP_CODE, type);
        row[`${type} Training`]       = r ? (r.status === 'completed' ? 'Completed' : 'Required') : 'Not Started';
        row[`${type} Completed Date`] = r?.completed_date || '';
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Training');
    XLSX.writeFile(wb, `training_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Apply training-type filter only (state/branch already filtered by global top-left selector)
  const displayEmps = useMemo(() => {
    return workingEmps.filter(e => {
      if (filterType !== 'all') {
        const r = getRecord(e.EMP_CODE, filterType);
        return !r || r.status !== 'completed';
      }
      return true;
    });
  }, [workingEmps, filterType, lookup]);

  const summary = useMemo(() => {
    let completed = 0, required = 0;
    workingEmps.forEach(e => {
      TRAINING_TYPES.forEach(t => {
        const r = getRecord(e.EMP_CODE, t);
        if (r?.status === 'completed') completed++; else required++;
      });
    });
    return { completed, required, total: workingEmps.length };
  }, [workingEmps, lookup]);

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile icon={Users}        label="Active Staff"         value={summary.total}     color="#3b82f6" />
        <Tile icon={CheckCircle2} label="Trainings Completed"  value={summary.completed} color="#10b981" />
        <Tile icon={Clock}        label="Trainings Pending"    value={summary.required}  color="#C9A227" />
      </div>

      <SectionCard title={`Training Status - Active (${displayEmps.length})`}>
        {/* â”€â”€ One-line filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex flex-wrap gap-2 mb-3">
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input py-1.5 text-sm">
            <option value="all">All Types</option>
            {TRAINING_TYPES.map(t => <option key={t} value={t}>{t} - Pending</option>)}
          </select>
          {filterType !== 'all' && (
            <button onClick={() => setFilterType('all')} className="btn-ghost py-1.5 text-sm">
              <X size={13} className="inline mr-1" />Clear
            </button>
          )}
          <button onClick={downloadTraining} className="btn-ghost flex items-center gap-1.5 text-sm ml-auto">
            <Download size={14} /> Excel
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="p-2">PAN No</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Branch</th>
                  {TRAINING_TYPES.map(t => <th key={t} className="p-2 text-center">{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {displayEmps.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No records match the current filters.</td></tr>
                )}
                {displayEmps.map(e => (
                  <tr key={e.EMP_CODE} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-2 font-mono text-xs font-semibold">{e.pan_no || '-'}</td>
                    <td className="p-2 font-semibold whitespace-nowrap">{e.EMPNAME}</td>
                    <td className="p-2">{e.State}</td>
                    <td className="p-2">{e.Branch}</td>
                    {TRAINING_TYPES.map(type => {
                      const r = getRecord(e.EMP_CODE, type);
                      const done = r?.status === 'completed';
                      return (
                        <td key={type} className="p-2 text-center">
                          {done ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#10b98120', color: '#10b981' }}>
                                <CheckCircle2 size={11} /> Done
                              </span>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{r.completed_date}</div>
                            </div>
                          ) : canEditHr() ? (
                            <button
                              onClick={() => setMarkModal({ emp: e, type })}
                              className="text-xs px-2 py-0.5 rounded font-medium transition"
                              style={{ background: 'var(--bg)', color: 'var(--muted)' }}
                            >
                              Mark Done
                            </button>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--muted)' }}>Pending</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {markModal && (
        <MarkTrainingModal
          emp={markModal.emp}
          type={markModal.type}
          saving={saving}
          onClose={() => setMarkModal(null)}
          onSave={handleMark}
        />
      )}
    </div>
  );
}

function MarkTrainingModal({ emp, type, saving, onClose, onSave }) {
  const [date, setDate]   = useState(new Date().toISOString().split('T')[0]);
  const [name, setName]   = useState('');
  const [status, setStatus] = useState('completed');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{type} Training - {emp.EMPNAME}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label mb-1">Status</label>
            <select className="input w-full" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="completed">Completed</option>
              <option value="required">Required / Pending</option>
            </select>
          </div>
          {type === 'Other' && (
            <div>
              <label className="label mb-1">Training Name</label>
              <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Leadership Workshop" />
            </div>
          )}
          {status === 'completed' && (
            <div>
              <label className="label mb-1">Completion Date</label>
              <input className="input w-full" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary flex items-center gap-1.5" onClick={() => onSave(emp.EMP_CODE, emp.EMPNAME, type, name, status, date)} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PLI & GRADING TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const GRADE_CRITERIA = [
  { key: 'work_grade',       label: 'Work' },
  { key: 'behaviour_grade',  label: 'Behaviour' },
  { key: 'discipline_grade', label: 'Discipline' },
  { key: 'interest_grade',   label: 'Interest' },
];

// Compute overall % from four 0-5 scores
function calcOverallPct(grades) {
  // Filter out null / undefined / '' BEFORE Number() - Number(null)=0 and Number('')=0 would corrupt the result
  const vals = GRADE_CRITERIA
    .map(c => grades[c.key])
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(v => Number(v))
    .filter(v => !isNaN(v) && v >= 0 && v <= 5);
  if (!vals.length) return null;
  const sum = vals.reduce((a, v) => a + v, 0);
  // Always out of 20 (4 criteria x 5 max) - unfilled = 0 contribution
  return Math.round((sum / 20) * 100);
}

// Score cell color: 0-1 red, 2-3 amber, 4-5 green
function scoreColor(v) {
  const n = Number(v);
  if (isNaN(n) || v === '' || v === null) return 'var(--muted)';
  if (n <= 1) return '#d71920';
  if (n <= 3) return '#C9A227';
  return '#10b981';
}

function GradingTab({ emps, canEditHr, canViewHr }) {
  const [month,       setMonth]       = useState(currentMonth());
  const [gradings,    setGradings]    = useState([]);
  const [localGrades, setLocalGrades] = useState({});
  const [autoScores,  setAutoScores]  = useState({});
  const [loading,     setLoading]     = useState(false);
  const [savingId,    setSavingId]    = useState(null);

  // Active employees only
  const working = useMemo(() =>
    emps.filter(e => e.Status === 'Working' || e.is_emp_working == 1 || e.Status === 'Active'),
  [emps]);

  // State/branch already filtered by global top-left selector via `emps` prop
  const displayEmps = working;

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.hrGrading(month).then(d => {
        setGradings(d || []);
        const init = {};
        (d || []).forEach(g => { init[g.pan] = g; });
        setLocalGrades(init);
      }),
      api.hrGradingAuto(month).then(d => setAutoScores(d?.scores || {})).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const setGrade = (pan, key, val) =>
    setLocalGrades(prev => ({ ...prev, [pan]: { ...(prev[pan] || {}), [key]: val } }));

  const saveRow = async (emp) => {
    const pan = emp.pan_no || emp.PAN;
    if (!pan) return alert('Employee has no PAN number - cannot save grading.');
    const grades = localGrades[pan] || {};
    // Validate: each score must be 0-5
    for (const c of GRADE_CRITERIA) {
      const v = grades[c.key];
      if (v !== '' && v !== undefined && v !== null) {
        const n = Number(v);
        if (isNaN(n) || n < 0 || n > 5) return alert(`${c.label} score must be between 0 and 5.`);
      }
    }
    setSavingId(pan);
    try {
      // Combined overall: manual /20 + auto /25 = /45
      const merged = { ...getSaved(pan), ...grades };
      const mVals = GRADE_CRITERIA
        .map(c => merged[c.key])
        .filter(v => v !== '' && v !== null && v !== undefined)
        .map(Number).filter(v => !isNaN(v) && v >= 0 && v <= 5);
      const mSum = mVals.length ? mVals.reduce((a, v) => a + v, 0) : null;
      const auto = autoScores[(pan || '').toUpperCase()];
      const overall_pct =
        mSum !== null && auto ? Math.round(((mSum + auto.total) / 45) * 100)
        : auto                ? auto.overall_pct
        : mSum !== null       ? Math.round((mSum / 20) * 100)
        : null;
      const saved = await api.saveGrading({
        pan, emp_code: emp.EMP_CODE, emp_name: emp.EMPNAME, month,
        pli_percent: emp.emp_pli,
        state:  emp.State  || '',
        branch: emp.Branch || '',
        overall_grade: overall_pct !== null ? String(overall_pct) : null,
        ...grades,
      });
      setGradings(prev => {
        const i = prev.findIndex(g => g.pan === pan && g.month === month);
        if (i >= 0) { const c = [...prev]; c[i] = saved; return c; }
        return [...prev, saved];
      });
    } catch (e) { alert('Error: ' + e.message); }
    setSavingId(null);
  };

  const getSaved = (pan) => gradings.find(g => g.pan === pan && g.month === month);

  const downloadGrading = () => {
    const data = displayEmps.map(e => {
      const pan = e.pan_no || e.PAN || '';
      const g   = getSaved(pan) || {};
      const lg  = localGrades[pan] || {};
      const a   = autoScores[(pan || '').toUpperCase()] || {};
      return {
        'PAN': pan, 'Name': e.EMPNAME,
        'Story Type': e.Story_Type === 'NE' ? (e.profile || 'NE') : (e.Story_Type || ''),
        'State': e.State || '', 'Branch': e.Branch || '', 'Month': month,
        'Work (0-5)':       lg.work_grade       ?? g.work_grade       ?? '',
        'Behaviour (0-5)':  lg.behaviour_grade  ?? g.behaviour_grade  ?? '',
        'Discipline (0-5)': lg.discipline_grade ?? g.discipline_grade ?? '',
        'Interest (0-5)':   lg.interest_grade   ?? g.interest_grade   ?? '',
        'Auto Marks (/25)': a.total ?? '',
        'Overall %':        (() => {
          const merged = { ...g, ...lg };
          const mVals = ['work_grade', 'behaviour_grade', 'discipline_grade', 'interest_grade']
            .map(k => merged[k])
            .filter(v => v !== '' && v !== null && v !== undefined)
            .map(Number).filter(v => !isNaN(v) && v >= 0 && v <= 5);
          const mSum = mVals.length ? mVals.reduce((x, v) => x + v, 0) : null;
          if (mSum !== null && a.total !== undefined) return `${Math.round(((mSum + a.total) / 45) * 100)}%`;
          if (a.total !== undefined)                  return `${a.overall_pct}%`;
          if (mSum !== null)                          return `${Math.round((mSum / 20) * 100)}%`;
          return '';
        })(),
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Grading');
    XLSX.writeFile(wb, `grading_${month}.xlsx`);
  };

  return (
    <div>
      <SectionCard title={`PLI & Monthly Grading (${displayEmps.length})`}>
        {/* â”€â”€ One-line filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="month" className="input py-1.5 text-sm" value={month}
            onChange={e => { setMonth(e.target.value); }}
          />
          <button onClick={load} className="btn-ghost p-1.5" title="Refresh"><RefreshCw size={14} /></button>
          <button onClick={downloadGrading} className="btn-ghost flex items-center gap-1.5 text-sm ml-auto">
            <Download size={14} /> Excel
          </button>
        </div>

        <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>
          Score each employee 0-5 per criterion (5 = Excellent, 0 = Poor). Overall % = (manual /20 + auto /25) / 45 x 100. PAN is the unique key.
        </p>
        <details className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
          <summary className="cursor-pointer font-semibold">Auto Marks (/25) — how it is calculated</summary>
          <p className="mt-1 ml-4">System combines 5 factors (5 marks each) from live data for the selected month; Auto % = total / 25 x 100. Hover the Auto column for each employee's breakdown.</p>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            <li><b>Stories filed</b> (ECMS): 60+ = 5 &middot; 45+ = 4 &middot; 30+ = 3 &middot; 15+ = 2 &middot; 1+ = 1 &middot; 0 = 0</li>
            <li><b>Field visits</b>: 20+ = 5 &middot; 15+ = 4 &middot; 10+ = 3 &middot; 5+ = 2 &middot; 1+ = 1 &middot; 0 = 0</li>
            <li><b>QC mistakes</b> (responsible): 0 = 5 &middot; up to 2 = 4 &middot; up to 5 = 3 &middot; up to 9 = 2 &middot; up to 14 = 1 &middot; 15+ = 0</li>
            <li><b>Attendance</b> (HRMS present %): 95%+ = 5 &middot; 90%+ = 4 &middot; 85%+ = 3 &middot; 75%+ = 2 &middot; 60%+ = 1 &middot; below = 0 &middot; no data = 5</li>
            <li><b>Page delay</b> (branch avg): up to 5 min = 5 &middot; 15 = 4 &middot; 30 = 3 &middot; 60 = 2 &middot; 90 = 1 &middot; above = 0 &middot; no editions = 5</li>
          </ul>
        </details>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="p-2">PAN</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Story Type</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Branch</th>
                  {GRADE_CRITERIA.map(c => <th key={c.key} className="p-2 text-center">{c.label}<span className="block text-[10px] font-normal opacity-60">0-5</span></th>)}
                  <th className="p-2 text-center">Auto Marks<span className="block text-[10px] font-normal opacity-60">/25</span></th>
                  <th className="p-2 text-center">Overall<span className="block text-[10px] font-normal opacity-60">% (manual+auto)</span></th>
                  {canEditHr() && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {displayEmps.length === 0 && (
                  <tr><td colSpan={14} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No employees match the current filters.</td></tr>
                )}
                {displayEmps.map(e => {
                  const pan     = e.pan_no || e.PAN || '';
                  const saved   = getSaved(pan);
                  const lg      = localGrades[pan] || {};
                  // overall: prefer live local calc, fallback to saved DB value
                  const mergedGrades = { ...saved, ...lg };
                  // manual sum out of 20 (only counts filled criteria)
                  const manualVals = GRADE_CRITERIA
                    .map(c => mergedGrades[c.key])
                    .filter(v => v !== '' && v !== null && v !== undefined)
                    .map(Number).filter(v => !isNaN(v) && v >= 0 && v <= 5);
                  const manualSum = manualVals.length ? manualVals.reduce((a, v) => a + v, 0) : null;
                  const isDirty = GRADE_CRITERIA.some(c => {
                    const cur = lg[c.key] !== undefined ? lg[c.key] : '';
                    const srv = saved?.[c.key] !== undefined ? String(saved[c.key]) : '';
                    return cur !== '' && String(cur) !== srv;
                  });
                  const auto = autoScores[(pan || '').toUpperCase()];
                  // Combined overall: manual /20 + auto /25 = /45. Falls back to whichever exists.
                  const overallPct =
                    manualSum !== null && auto ? Math.round(((manualSum + auto.total) / 45) * 100)
                    : auto                     ? auto.overall_pct
                    : manualSum !== null       ? Math.round((manualSum / 20) * 100)
                    : null;
                  const autoTip = auto
                    ? `Stories: ${auto.stories} filed = ${auto.s_stories}/5\nVisits: ${auto.visits} = ${auto.s_visits}/5\nQC mistakes: ${auto.mistakes} = ${auto.s_qc}/5\nAttendance: ${auto.attend_pct ?? 'no data'}${auto.attend_pct !== null ? '%' : ''} = ${auto.s_attend}/5\nBranch delay: ${auto.delay_avg ?? 'no editions'}${auto.delay_avg !== null ? ' min avg' : ''} = ${auto.s_delay}/5`
                    : '';

                  return (
                    <tr key={e.EMP_CODE} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 font-mono text-xs font-semibold">{pan || '-'}</td>
                      <td className="p-2 font-semibold whitespace-nowrap">{e.EMPNAME}</td>
                      <td className="p-2 text-xs">{e.Story_Type === 'NE' ? (e.profile || 'NE') : (e.Story_Type || '-')}</td>
                      <td className="p-2">{e.State || '-'}</td>
                      <td className="p-2">{e.Branch || '-'}</td>
                      {GRADE_CRITERIA.map(c => {
                        const curVal = lg[c.key] !== undefined ? lg[c.key] : (saved?.[c.key] ?? '');
                        return (
                          <td key={c.key} className="p-2 text-center">
                            {canEditHr() ? (
                              <input
                                type="number" min="0" max="5" step="1"
                                className="input py-0.5 text-sm text-center w-14"
                                value={curVal}
                                onChange={ev => {
                                  const v = ev.target.value;
                                  if (v === '') { setGrade(pan, c.key, ''); return; }
                                  const n = Math.round(Number(v));
                                  if (!isNaN(n)) setGrade(pan, c.key, String(Math.min(5, Math.max(0, n))));
                                }}
                                style={{ color: scoreColor(curVal), fontWeight: 700 }}
                                disabled={!pan}
                                placeholder="-"
                              />
                            ) : (
                              <span className="font-bold text-sm" style={{ color: scoreColor(curVal) }}>
                                {curVal !== '' && curVal !== null && curVal !== undefined ? curVal : '-'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-center" title={autoTip}>
                        {auto
                          ? <span className="font-bold text-sm tabular-nums">{auto.total}/25</span>
                          : <span className="text-xs" style={{ color: 'var(--muted)' }}>-</span>
                        }
                      </td>
                      <td className="p-2 text-center">
                        {overallPct !== null
                          ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white"
                              style={{ background: overallPct >= 80 ? '#10b981' : overallPct >= 60 ? '#C9A227' : '#d71920' }}>
                              {overallPct}%
                            </span>
                          : <span className="text-xs" style={{ color: 'var(--muted)' }}>-</span>
                        }
                      </td>
                      {canEditHr() && (
                        <td className="p-2">
                          <button
                            onClick={() => saveRow(e)}
                            disabled={savingId === pan || !pan}
                            className="text-xs px-2.5 py-1 rounded font-medium transition flex items-center gap-1"
                            style={{
                              background: isDirty || !saved ? 'var(--brand)' : 'var(--bg)',
                              color: isDirty || !saved ? '#fff' : 'var(--muted)',
                            }}
                          >
                            {savingId === pan ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            {saved ? 'Update' : 'Save'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function GradeBadge({ grade }) {
  if (!grade) return <span style={{ color: 'var(--muted)' }}>-</span>;
  return (
    <span className="inline-block w-7 h-7 rounded-full text-sm font-bold leading-7 text-center text-white" style={{ background: GRADE_COLOR[grade] || '#888' }}>
      {grade}
    </span>
  );
}

function CorrespondentTab() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center" style={{ color: 'var(--text-secondary)' }}>
      <Newspaper size={48} className="mb-4 opacity-40" />
      <p className="text-lg font-medium">Correspondent</p>
      <p className="text-sm mt-1 opacity-60">Content coming soon</p>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// LEAVE REGISTER — used inside AdminTab
const LEAVE_TYPE_COLORS = {
  CL: '#3b82f6', EL: '#10b981', SL: '#8b5cf6', ML: '#ec4899',
  PL: '#06b6d4', LWP: '#d71920', LW: '#d71920', CO: '#f97316',
  CH: '#C9A227', RH: '#84cc16', WOP: '#64748b', A: '#ef4444',
};
const leaveColor = type => LEAVE_TYPE_COLORS[type] || '#94a3b8';
const LEAVE_LABELS = {
  CL: 'Casual Leave', EL: 'Earned Leave', SL: 'Sick Leave', ML: 'Medical Leave',
  PL: 'Privilege Leave', LWP: 'Leave Without Pay', LW: 'Leave W/Pay',
  CO: 'Comp Off', CH: 'Compensatory Holiday', RH: 'Restricted Holiday',
  WOP: 'Without Pay', A: 'Absent',
};

function toISTDate(ms) { return new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10); }
function startOfWeekMon(d) { const dt = new Date(d + 'T12:00:00'), day = dt.getDay(); dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1)); return dt.toISOString().slice(0, 10); }
function addDaysStr(d, n) { const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); }

const QUICK_RANGES = [
  { label: 'Last Week',  key: 'lastweek',  range: () => { const mon = startOfWeekMon(toISTDate(Date.now())); const prev = addDaysStr(mon, -7); return { start: prev, end: toISTDate(Date.now() - 2 * 864e5) }; } },
  { label: 'This Month', key: 'thismonth', range: () => { const t = toISTDate(Date.now()); return { start: t.slice(0, 7) + '-01', end: toISTDate(Date.now() - 2 * 864e5) }; } },
  { label: 'Last Month', key: 'lastmonth', range: () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), last = new Date(y, d.getMonth() + 1, 0).getDate(); return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2,'0')}` }; } },
];

function LeavesSection({ state, branch }) {
  const [activeQuick, setActiveQuick] = useState('lastweek');
  const [dateRange,   setDateRange]   = useState(() => QUICK_RANGES.find(r => r.key === 'lastweek').range());
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [expandedPan, setExpandedPan] = useState(null);
  const [search,      setSearch]      = useState('');

  const load = useCallback((start, end) => {
    setLoading(true); setError('');
    api.hrLeaves(start, end, state, branch)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [state, branch]);

  useEffect(() => { load(dateRange.start, dateRange.end); }, [load]);

  function applyQuick(key) {
    const r = QUICK_RANGES.find(q => q.key === key).range();
    setActiveQuick(key); setDateRange(r); load(r.start, r.end);
  }
  function applyCustom() { setActiveQuick(null); load(dateRange.start, dateRange.end); }

  function downloadExcelLeaves() {
    if (!data?.employees?.length) return;
    const rows = [];
    data.employees.forEach(emp => {
      emp.leaves.forEach(lv => {
        rows.push({ Name: emp.name, Branch: emp.branch, State: emp.state,
          Designation: emp.designation || emp.story_type,
          Date: lv.date, 'Leave Type': lv.type, Description: LEAVE_LABELS[lv.type] || lv.type });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leave Register');
    XLSX.writeFile(wb, `leave_register_${data.start}_to_${data.end}.xlsx`);
  }

  const visibleEmps = useMemo(() => {
    if (!data?.employees) return [];
    const q = search.toLowerCase();
    return q ? data.employees.filter(e => e.name.toLowerCase().includes(q) || e.branch.toLowerCase().includes(q)) : data.employees;
  }, [data, search]);

  const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fmtDay = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) : '';

  return (
    <SectionCard
      title="Leave Register — Person Wise"
      action={
        <button onClick={downloadExcelLeaves} className="btn-ghost flex items-center gap-1.5 text-sm" disabled={!data?.employees?.length}>
          <Download size={14} /> Excel
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {QUICK_RANGES.map(q => (
          <button key={q.key} onClick={() => applyQuick(q.key)}
            className="px-3 py-1 rounded-full text-xs font-medium transition"
            style={{ background: activeQuick === q.key ? 'var(--brand)' : 'var(--bg)', color: activeQuick === q.key ? '#fff' : 'var(--fg)', border: '1px solid var(--border)' }}>
            {q.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <CalendarDays size={14} style={{ color: 'var(--muted)' }} />
          <input type="date" className="input text-xs py-1 px-2" style={{ width: 130 }}
            value={dateRange.start}
            onChange={e => { setDateRange(r => ({ ...r, start: e.target.value })); setActiveQuick(null); }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <input type="date" className="input text-xs py-1 px-2" style={{ width: 130 }}
            value={dateRange.end}
            onChange={e => { setDateRange(r => ({ ...r, end: e.target.value })); setActiveQuick(null); }} />
          <button onClick={applyCustom} className="btn-primary text-xs py-1 px-3">Go</button>
        </div>
      </div>

      {data?.summary && (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: 'var(--bg)', border: '1px solid var(--border)', minWidth: 90 }}>
            <div className="text-2xl font-bold" style={{ color: 'var(--brand)' }}>{data.summary.totalDays}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Total Leave Days</div>
          </div>
          <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: 'var(--bg)', border: '1px solid var(--border)', minWidth: 90 }}>
            <div className="text-2xl font-bold">{data.summary.uniqueEmps}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Employees on Leave</div>
          </div>
          {Object.entries(data.summary.byType || {}).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
            <div key={type} className="rounded-xl px-3 py-2.5 text-center" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${leaveColor(type)}` }}>
              <div className="text-xl font-bold">{cnt}</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: leaveColor(type) }}>{LEAVE_LABELS[type] || type}</div>
            </div>
          ))}
        </div>
      )}

      {data && <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>Period: {fmt(data.start)} to {fmt(data.end)}</p>}

      <input className="input w-full mb-3 text-sm" placeholder="Search by name or branch…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {loading && <div className="flex justify-center py-10 gap-2" style={{ color: 'var(--muted)' }}><Loader2 size={18} className="animate-spin" /> Loading leave data…</div>}
      {error && <div className="flex items-center gap-2 py-4 text-sm" style={{ color: '#d71920' }}><AlertCircle size={16} /> {error}</div>}
      {!loading && !error && data && visibleEmps.length === 0 && (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
          {search ? 'No employees match your search.' : 'No leave records found for this period.'}
        </div>
      )}

      {!loading && !error && visibleEmps.length > 0 && (
        <div className="space-y-2">
          {visibleEmps.map(emp => {
            const isOpen = expandedPan === emp.pan;
            return (
              <div key={emp.pan} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => setExpandedPan(isOpen ? null : emp.pan)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{emp.name}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {emp.designation || emp.story_type}{emp.branch ? ` · ${emp.branch}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end" style={{ maxWidth: 260 }}>
                    {Object.entries(emp.byType).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                      <span key={type} className="px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                        style={{ background: leaveColor(type) }}>
                        {type} x{cnt}
                      </span>
                    ))}
                  </div>
                  <div className="text-sm font-bold ml-2 shrink-0" style={{ color: 'var(--brand)' }}>{emp.leaves.length}d</div>
                  <ChevronRight size={16} style={{ color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                    <div className="flex flex-wrap gap-2">
                      {emp.leaves.map((lv, i) => (
                        <div key={i} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                          style={{ background: leaveColor(lv.type) + '18', border: `1px solid ${leaveColor(lv.type)}40` }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: leaveColor(lv.type) }} />
                          <span className="font-medium">{fmtDay(lv.date)}</span>
                          <span className="font-bold ml-0.5" style={{ color: leaveColor(lv.type) }}>{lv.type}</span>
                          <span style={{ color: 'var(--muted)' }}>– {LEAVE_LABELS[lv.type] || lv.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}


// ADMIN TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function AdminTab({ emps, canEditHr }) {
  const { state, branch } = useApp();
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [sanctionEdit, setSanctionEdit] = useState(null); // {profile, count}
  const [saving,  setSaving]  = useState(false);
  const [retView, setRetView] = useState('within1yr'); // which retirement bucket list is shown
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult,    setBulkResult]    = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.hrAdminStats(state, branch).then(setStats).finally(() => setLoading(false));
  }, [state, branch]);
  useEffect(() => { load(); }, [load]);

  const saveSanction = async () => {
    if (!sanctionEdit) return;
    setSaving(true);
    try {
      await api.saveSanctionedPost({
        profile: sanctionEdit.profile,
        sanctioned_count: Number(sanctionEdit.count),
        state, branch,
      });
      load();
      setSanctionEdit(null);
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  const downloadProfiles = () => {
    if (!stats?.profiles) return;
    const data = stats.profiles.map(p => ({
      'Profile (Story Type)': p.profile,
      'Available (Working)':   p.available,
      'Sanctioned':            p.sanctionedCount ?? 'Not Set',
      'Vacant':                p.vacant ?? 'N/A',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
    XLSX.writeFile(wb, `profile_sanction_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBulkUploading(true);
    setBulkResult(null);
    try {
      const r = await api.uploadSanctionedBulk(file);
      setBulkResult(r);
      load();
    } catch (err) {
      setBulkResult({ ok: false, error: err.message });
    }
    setBulkUploading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--muted)' }}>
        <Loader2 size={20} className="animate-spin" /> Loading admin stats...
      </div>
    );
  }

  const ret = stats?.retBuckets || {};
  const RET_VIEWS = {
    within1yr: { label: 'Retiring Within 1 Year', color: '#d71920', list: ret.within1yr || [] },
    yr1to3:    { label: 'Retiring in 1-3 yrs',    color: '#f97316', list: ret.yr1to3    || [] },
    yr3to5:    { label: 'Retiring in 3-5 yrs',    color: '#C9A227', list: ret.yr3to5    || [] },
  };
  const activeRet = RET_VIEWS[retView];

  return (
    <div className="space-y-4">
      {/* Leave Register */}
      <LeavesSection state={state} branch={branch} />

      {/* Retirement Overview */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Object.entries(RET_VIEWS).map(([key, v]) => (
          <RetTile key={key} label={v.label} count={v.list.length} color={v.color}
            active={retView === key} onClick={() => setRetView(key)} />
        ))}
      </div>

      {/* Retiring detail — bucket selected by tile click */}
      <SectionCard title={activeRet.label}>
        {activeRet.list.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>No employees in this window</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...activeRet.list].sort((a, b) => (a.retireOn || '').localeCompare(b.retireOn || '')).map(e => (
              <div key={e.EMP_CODE} className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
                <div className="text-sm font-semibold">{e.EMPNAME}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  {e.Story_Type || e.emp_designation} | {e.Branch} | Age {e.age} | Retires {e.retireOn}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Age Distribution */}
      {stats?.ageDist && (
        <SectionCard title="Age-wise Staff Distribution">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.ageDist} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" stroke="var(--muted)" fontSize={12} />
              <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={12} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {stats.ageDist.map((b, i) => (
                  <Cell key={i} fill={b.range === '50-59' || b.range === '60+' ? '#d71920' : '#3b82f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* Profile-wise Sanction vs Available */}
      <SectionCard
        title="Story Type-wise: Sanctioned vs Available (Active Members)"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={downloadProfiles} className="btn-ghost flex items-center gap-1.5 text-sm">
              <Download size={14} /> Export
            </button>
            {canEditHr() && (
              <>
                <button onClick={() => api.downloadSanctionedTemplate().catch(e => alert('Download failed: ' + e.message))} className="btn-ghost flex items-center gap-1.5 text-sm">
                  <Download size={14} /> Template
                </button>
                <label className={`btn-ghost flex items-center gap-1.5 text-sm cursor-pointer ${bulkUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {bulkUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {bulkUploading ? 'Uploading…' : 'Bulk Upload'}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleBulkUpload} disabled={bulkUploading} />
                </label>
              </>
            )}
          </div>
        }
      >
        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
          Click the sanctioned count to update it. Vacant = Sanctioned - Available.
          Figures follow the global State/Branch filter — set sanction posts branch-wise by selecting a branch first; the All view shows branch totals summed.
        </p>
        {bulkResult && (
          <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${bulkResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
            {bulkResult.ok
              ? `Upload complete — ${bulkResult.inserted} new, ${bulkResult.updated} updated, ${bulkResult.skipped} skipped.${bulkResult.errors?.length ? ` Warnings: ${bulkResult.errors.slice(0,3).join('; ')}` : ''}`
              : `Upload failed: ${bulkResult.error}`}
            <button className="ml-3 underline text-xs" onClick={() => setBulkResult(null)}>Dismiss</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="p-2">Profile (Story Type)</th>
                <th className="p-2 text-right">Available</th>
                <th className="p-2 text-right">Sanctioned</th>
                <th className="p-2 text-right">Vacant</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.profiles || []).map(p => (
                <tr key={p.profile} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 font-semibold">{p.profile}</td>
                  <td className="p-2 text-right">{p.available}</td>
                  <td className="p-2 text-right">
                    {canEditHr() ? (
                      <button
                        onClick={() => setSanctionEdit({ profile: p.profile, count: p.sanctionedCount || '' })}
                        className="font-medium hover:opacity-70"
                        style={{ color: p.sanctionedCount != null ? 'inherit' : 'var(--muted)' }}
                      >
                        {p.sanctionedCount != null ? p.sanctionedCount : 'Set'}
                      </button>
                    ) : (
                      p.sanctionedCount ?? '-'
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {p.vacant != null ? (
                      <span style={{ color: p.vacant > 0 ? '#d71920' : '#10b981', fontWeight: 600 }}>
                        {p.vacant > 0 ? p.vacant : 'Full'}
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Sanction Edit Modal */}
      {sanctionEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSanctionEdit(null)} />
          <div className="card relative z-10 w-full max-w-sm p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold">Sanctioned Count</h3>
              <button onClick={() => setSanctionEdit(null)} className="rounded-lg p-1 hover:bg-black/10"><X size={18} /></button>
            </div>
            <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>{sanctionEdit.profile}</p>
            <p className="text-xs mb-3 font-medium" style={{ color: 'var(--brand)' }}>
              Scope: {state !== 'All' ? state : 'All States'}{branch !== 'All' ? ` / ${branch}` : ' / All Branches'}
              {(state === 'All' && branch === 'All') && ' (company-wide entry)'}
            </p>
            <input
              className="input w-full" type="number" min={0}
              value={sanctionEdit.count}
              onChange={e => setSanctionEdit(s => ({ ...s, count: e.target.value }))}
              placeholder="Enter sanctioned headcount"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setSanctionEdit(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary flex items-center gap-1.5" onClick={saveSanction} disabled={saving}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RetTile({ label, count, color, active, onClick }) {
  return (
    <button onClick={onClick} className="card p-4 text-left transition"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        border: active ? `2px solid ${color}` : '2px solid transparent',
      }}>
      <div className="text-3xl font-bold" style={{ fontFamily: 'Roboto, sans-serif', color }}>{count}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
    </button>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SHARED COMPONENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function Tile({ icon: Icon, label, value, color }) {
  return (
    <div className="card p-4">
      <span className="inline-flex rounded-lg p-1.5" style={{ background: color + '1a', color }}>
        <Icon size={16} />
      </span>
      <div className="mt-2 text-3xl font-bold" style={{ fontFamily: 'Roboto, sans-serif' }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

function EmployeeModal({ emp, onClose, onSave }) {
  const [form,   setForm]   = useState({ ...emp });
  const [saving, setSaving] = useState(false);
  const set    = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!emp.EMP_CODE && !!emp.EMPNAME;

  const handleSave = async () => {
    if (!form.EMP_CODE || !form.EMPNAME) return alert('Employee Code and Name are required.');
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{isEdit ? 'Edit' : 'Add'} Employee</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HR_FIELDS.map(f => (
            <div key={f.key}>
              <label className="label mb-1">{f.label}</label>
              <input
                className="input w-full" type={f.type === 'number' ? 'number' : 'text'}
                value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}
                disabled={isEdit && f.key === 'EMP_CODE'}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary flex items-center gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}
