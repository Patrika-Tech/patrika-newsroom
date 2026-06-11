import { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, PieChart, Pie,
} from 'recharts';
import {
  X, CalendarClock, Users, UserCheck, UserX,
  Building2, Save, Loader2, Download, Plus, Upload, CheckCircle2,
  Clock, Star, BarChart2, ShieldCheck, FileText, Briefcase, Trash2,
  ChevronDown, RefreshCw, Camera, PenLine, Monitor,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { HR_FIELDS } from '../data/mock.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  { key: 'overview',    label: 'Overview',           icon: BarChart2 },
  { key: 'recruitment', label: 'Recruitment',        icon: Briefcase },
  { key: 'training',    label: 'Training & Induction', icon: Star },
  { key: 'grading',    label: 'PLI & Grading',       icon: ShieldCheck },
  { key: 'admin',      label: 'Admin',               icon: Building2 },
];

const currentMonth = () => new Date().toISOString().slice(0, 7);

// ─────────────────────────────────────────────────────────────────────────────
export default function Hr() {
  const { t, canEditHr, canViewHr, canEditGrading, canEditTraining, isBranchRestricted, state: globalState, branch: globalBranch } = useApp();
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

  // Charts — all use `filtered` so they respond to top-left state/branch selection
  const ageBuckets = useMemo(() => {
    const b = { '20–29': 0, '30–39': 0, '40–49': 0, '50–59': 0, '60+': 0 };
    filtered.forEach(e => {
      const a = calcAge(e.DOB);
      if (!a) return;
      if (a < 30) b['20–29']++;
      else if (a < 40) b['30–39']++;
      else if (a < 50) b['40–49']++;
      else if (a < 60) b['50–59']++;
      else b['60+']++;
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

      {/* ── Tab Navigation ──────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-5 border-b overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
        {TABS
          // Regional Editor: hide Recruitment & Admin (view-only on Overview/Training/Grading)
          .filter(({ key }) => isBranchRestricted() ? !['recruitment', 'admin'].includes(key) : true)
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

      {/* ── Tab Panels ──────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <OverviewTab
          emps={emps} filtered={filtered} rets={filteredRets} loading={loading}
          ageBuckets={ageBuckets} deptBuckets={deptBuckets}
          canViewHr={canViewHr} canEditHr={canEditHr}
          onEdit={setEditing}
          onDownload={() => downloadExcel(filtered, canViewHr())}
        />
      )}
      {tab === 'recruitment'  && <RecruitmentTab />}
      {tab === 'training'     && <TrainingTab emps={filtered} canEditHr={canEditTraining} />}
      {tab === 'grading'      && <GradingTab  emps={filtered} canEditHr={canEditGrading} canViewHr={canViewHr} />}
      {tab === 'admin'        && <AdminTab    emps={filtered} canEditHr={canEditHr} />}

      {editing && <EmployeeModal emp={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════════
function OverviewTab({ emps, filtered, rets, loading, ageBuckets, deptBuckets,
  canViewHr, canEditHr, onEdit, onDownload }) {

  // ── Profile-wise counts from Story_Type field ─────────────────────────────
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

  // Only working employees — global state/branch already applied via `filtered` prop
  const tableRows = useMemo(() => {
    return filtered.filter(e => {
      const working = e.Status === 'Working' || e.is_emp_working == 1 || e.Status === 'Active';
      if (!working) return false;
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
                  <Cell key={i} fill={b.range === '60+' || b.range === '50–59' ? '#d71920' : '#C9A227'} />
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
                  Retires: {r.retireOn} · {r.emp_deptt} · {r.Branch}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={`Employees — Working (${tableRows.length})`}
        action={
          <button onClick={onDownload} className="btn-ghost flex items-center gap-1.5 text-sm">
            <Download size={14} /> Excel
          </button>
        }
      >
        {/* ── Search filter ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="text"
            placeholder="Search name, PAN, dept…"
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
              <Loader2 size={16} className="animate-spin" /> Loading employees…
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
                {tableRows.map(e => {
                  const age = calcAge(e.DOB);
                  return (
                    <tr key={e.EMP_CODE} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 font-mono text-xs font-semibold">{e.pan_no || '—'}</td>
                      <td className="p-2 font-semibold whitespace-nowrap">{e.EMPNAME}</td>
                      <td className="p-2">{e.Story_Type || '—'}</td>
                      <td className="p-2">{e.emp_deptt}</td>
                      <td className="p-2">{e.Branch}</td>
                      <td className="p-2">{e.State}</td>
                      <td className="p-2">
                        <span style={{ color: age >= 58 ? '#d71920' : 'inherit', fontWeight: age >= 58 ? 700 : 400 }}>
                          {age ?? '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECRUITMENT TAB
// ═══════════════════════════════════════════════════════════════════════════════
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
  { key: 'pan',           label: 'PAN',             w: 110 },
];

function RecruitmentTab() {
  const { canEditHr } = useApp();
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
    api.hrCandidates(filter).then(d => setCandidates(d || [])).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // ── CV file upload & parse ──────────────────────────────────────────────
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

  // ── Existing candidates ────────────────────────────────────────────────
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

      {/* ── CV Upload Section ──────────────────────────────────────────────── */}
      {canEditHr() && (
        <SectionCard className="mb-4"
          title={extracted.length ? `CV Review — ${extracted.length} file${extracted.length > 1 ? 's' : ''} parsed` : 'Upload CVs'}
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
                  PDF, DOCX, DOC, TXT, RTF — single or multiple files
                </p>
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--brand)' }}>
                  <Loader2 size={16} className="animate-spin" /> Parsing files…
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
                                {f.options.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                              </select>
                            ) : (
                              <input
                                className="input py-0.5 text-xs"
                                style={{ width: f.w, minWidth: f.w }}
                                value={row[f.key] || ''}
                                onChange={e => setExtField(idx, f.key, e.target.value)}
                                disabled={row._saved}
                                placeholder="—"
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
                  {savedCount} saved · {unsavedCount} pending
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

      {/* ── Candidates Table ───────────────────────────────────────────────── */}
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
            <Loader2 size={16} className="animate-spin" /> Loading…
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
                  <th className="p-2">PAN</th>
                  <th className="p-2">Status</th>
                  {canEditHr() && <th className="p-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={12} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No candidates found.</td></tr>
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
                              {saving === c.id ? '…' : 'Eligible'}
                            </button>
                          )}
                          {c.status !== 'not_eligible' && (
                            <button onClick={() => setStatus(c.id, 'not_eligible')} disabled={saving === c.id}
                              className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: '#d7192020', color: '#d71920' }}>
                              {saving === c.id ? '…' : 'Reject'}
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
                  <option value="">Select…</option>
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
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING & INDUCTION TAB
// ═══════════════════════════════════════════════════════════════════════════════
const TRAINING_TYPES = ['AI', 'Excel', 'Other'];

function TrainingTab({ emps, canEditHr }) {
  const { availableStates, getBranchesForState } = useApp();

  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [localState, setLocalState] = useState('All');
  const [localBranch,setLocalBranch]= useState('All');
  const [markModal,  setMarkModal]  = useState(null);
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    api.hrTraining().then(d => setRecords(d || [])).finally(() => setLoading(false));
  }, []);

  // Sync localState when role/locations change
  useEffect(() => {
    if (!availableStates.includes(localState)) {
      const def = availableStates.includes('All') ? 'All' : (availableStates[0] || 'All');
      setLocalState(def);
      setLocalBranch('All');
    }
  }, [availableStates.join(',')]); // eslint-disable-line

  // Build lookup: emp_code|training_type → record
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

  const handleStateChange = (s) => { setLocalState(s); setLocalBranch('All'); };

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

  // Apply state + branch + training-type filter
  const displayEmps = useMemo(() => {
    return workingEmps.filter(e => {
      if (localState  !== 'All' && e.State  !== localState)  return false;
      if (localBranch !== 'All' && e.Branch !== localBranch) return false;
      if (filterType  !== 'all') {
        const r = getRecord(e.EMP_CODE, filterType);
        return !r || r.status !== 'completed';
      }
      return true;
    });
  }, [workingEmps, localState, localBranch, filterType, lookup]);

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

      <SectionCard title={`Training Status — Active (${displayEmps.length})`}>
        {/* ── One-line filters ─────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-3">
          <select value={localState} onChange={e => handleStateChange(e.target.value)} className="input py-1.5 text-sm">
            {availableStates.map(s => <option key={s} value={s}>{s === 'All' ? 'All States' : s}</option>)}
          </select>
          <select value={localBranch} onChange={e => setLocalBranch(e.target.value)} disabled={localState === 'All'} className="input py-1.5 text-sm disabled:opacity-40">
            {getBranchesForState(localState).map(b => <option key={b} value={b}>{b === 'All' ? 'All Branches' : b}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input py-1.5 text-sm">
            <option value="all">All Types</option>
            {TRAINING_TYPES.map(t => <option key={t} value={t}>{t} — Pending</option>)}
          </select>
          {(localState !== 'All' || localBranch !== 'All' || filterType !== 'all') && (
            <button onClick={() => { setLocalState('All'); setLocalBranch('All'); setFilterType('all'); }} className="btn-ghost py-1.5 text-sm">
              <X size={13} className="inline mr-1" />Clear
            </button>
          )}
          <button onClick={downloadTraining} className="btn-ghost flex items-center gap-1.5 text-sm ml-auto">
            <Download size={14} /> Excel
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading…
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
                    <td className="p-2 font-mono text-xs font-semibold">{e.pan_no || '—'}</td>
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
          <h3 className="text-lg font-bold">{type} Training — {emp.EMPNAME}</h3>
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
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLI & GRADING TAB
// ═══════════════════════════════════════════════════════════════════════════════
const GRADE_CRITERIA = [
  { key: 'work_grade',       label: 'Work' },
  { key: 'behaviour_grade',  label: 'Behaviour' },
  { key: 'discipline_grade', label: 'Discipline' },
  { key: 'interest_grade',   label: 'Interest' },
];

// Compute overall % from four 0-5 scores
function calcOverallPct(grades) {
  // Filter out null / undefined / '' BEFORE Number() — Number(null)=0 and Number('')=0 would corrupt the result
  const vals = GRADE_CRITERIA
    .map(c => grades[c.key])
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(v => Number(v))
    .filter(v => !isNaN(v) && v >= 0 && v <= 5);
  if (!vals.length) return null;
  const sum = vals.reduce((a, v) => a + v, 0);
  // Always out of 20 (4 criteria × 5 max) — unfilled = 0 contribution
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
  const { availableStates, getBranchesForState } = useApp();

  const [month,       setMonth]       = useState(currentMonth());
  const [gradings,    setGradings]    = useState([]);
  const [localGrades, setLocalGrades] = useState({});
  const [loading,     setLoading]     = useState(false);
  const [savingId,    setSavingId]    = useState(null);
  const [localState,  setLocalState]  = useState('All');
  const [localBranch, setLocalBranch] = useState('All');

  // Sync localState when role/locations change
  useEffect(() => {
    if (!availableStates.includes(localState)) {
      const def = availableStates.includes('All') ? 'All' : (availableStates[0] || 'All');
      setLocalState(def);
      setLocalBranch('All');
    }
  }, [availableStates.join(',')]); // eslint-disable-line

  // Active employees only
  const working = useMemo(() =>
    emps.filter(e => e.Status === 'Working' || e.is_emp_working == 1 || e.Status === 'Active'),
  [emps]);

  const handleStateChange = (s) => { setLocalState(s); setLocalBranch('All'); };

  // Filtered display list
  const displayEmps = useMemo(() => working.filter(e => {
    if (localState  !== 'All' && e.State  !== localState)  return false;
    if (localBranch !== 'All' && e.Branch !== localBranch) return false;
    return true;
  }), [working, localState, localBranch]);

  const load = useCallback(() => {
    setLoading(true);
    api.hrGrading(month).then(d => {
      setGradings(d || []);
      const init = {};
      (d || []).forEach(g => { init[g.pan] = g; });
      setLocalGrades(init);
    }).finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const setGrade = (pan, key, val) =>
    setLocalGrades(prev => ({ ...prev, [pan]: { ...(prev[pan] || {}), [key]: val } }));

  const saveRow = async (emp) => {
    const pan = emp.pan_no || emp.PAN;
    if (!pan) return alert('Employee has no PAN number — cannot save grading.');
    const grades = localGrades[pan] || {};
    // Validate: each score must be 0–5
    for (const c of GRADE_CRITERIA) {
      const v = grades[c.key];
      if (v !== '' && v !== undefined && v !== null) {
        const n = Number(v);
        if (isNaN(n) || n < 0 || n > 5) return alert(`${c.label} score must be between 0 and 5.`);
      }
    }
    setSavingId(pan);
    try {
      const overall_pct = calcOverallPct(grades);
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
      return {
        'PAN': pan, 'Name': e.EMPNAME,
        'Story Type': e.Story_Type || '',
        'State': e.State || '', 'Branch': e.Branch || '', 'Month': month,
        'Work (0-5)':       lg.work_grade       ?? g.work_grade       ?? '',
        'Behaviour (0-5)':  lg.behaviour_grade  ?? g.behaviour_grade  ?? '',
        'Discipline (0-5)': lg.discipline_grade ?? g.discipline_grade ?? '',
        'Interest (0-5)':   lg.interest_grade   ?? g.interest_grade   ?? '',
        'Overall %':        g.overall_grade ? `${g.overall_grade}%` : (calcOverallPct({ ...g, ...lg }) !== null ? `${calcOverallPct({ ...g, ...lg })}%` : ''),
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
        {/* ── One-line filters ─────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="month" className="input py-1.5 text-sm" value={month}
            onChange={e => { setMonth(e.target.value); }}
          />
          <select value={localState} onChange={e => handleStateChange(e.target.value)} className="input py-1.5 text-sm">
            {availableStates.map(s => <option key={s} value={s}>{s === 'All' ? 'All States' : s}</option>)}
          </select>
          <select value={localBranch} onChange={e => setLocalBranch(e.target.value)} disabled={localState === 'All'} className="input py-1.5 text-sm disabled:opacity-40">
            {getBranchesForState(localState).map(b => <option key={b} value={b}>{b === 'All' ? 'All Branches' : b}</option>)}
          </select>
          {(localState !== 'All' || localBranch !== 'All') && (
            <button onClick={() => { setLocalState('All'); setLocalBranch('All'); }} className="btn-ghost py-1.5 text-sm">
              <X size={13} className="inline mr-1" />Clear
            </button>
          )}
          <button onClick={load} className="btn-ghost p-1.5" title="Refresh"><RefreshCw size={14} /></button>
          <button onClick={downloadGrading} className="btn-ghost flex items-center gap-1.5 text-sm ml-auto">
            <Download size={14} /> Excel
          </button>
        </div>

        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
          Score each employee 0–5 per criterion (5 = Excellent, 0 = Poor). Overall % = total scored ÷ 20 × 100. PAN is the unique key.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading…
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
                  {GRADE_CRITERIA.map(c => <th key={c.key} className="p-2 text-center">{c.label}<span className="block text-[10px] font-normal opacity-60">0–5</span></th>)}
                  <th className="p-2 text-center">Overall<span className="block text-[10px] font-normal opacity-60">%</span></th>
                  {canEditHr() && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {displayEmps.length === 0 && (
                  <tr><td colSpan={13} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No employees match the current filters.</td></tr>
                )}
                {displayEmps.map(e => {
                  const pan     = e.pan_no || e.PAN || '';
                  const saved   = getSaved(pan);
                  const lg      = localGrades[pan] || {};
                  // overall: prefer live local calc, fallback to saved DB value
                  const mergedGrades = { ...saved, ...lg };
                  const localPct  = calcOverallPct(mergedGrades);
                  const overallPct = localPct !== null ? localPct : (saved?.overall_grade ? Number(saved.overall_grade) : null);
                  const isDirty = GRADE_CRITERIA.some(c => {
                    const cur = lg[c.key] !== undefined ? lg[c.key] : '';
                    const srv = saved?.[c.key] !== undefined ? String(saved[c.key]) : '';
                    return cur !== '' && String(cur) !== srv;
                  });

                  return (
                    <tr key={e.EMP_CODE} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 font-mono text-xs font-semibold">{pan || '—'}</td>
                      <td className="p-2 font-semibold whitespace-nowrap">{e.EMPNAME}</td>
                      <td className="p-2 text-xs">{e.Story_Type || '—'}</td>
                      <td className="p-2">{e.State || '—'}</td>
                      <td className="p-2">{e.Branch || '—'}</td>
                      {GRADE_CRITERIA.map(c => {
                        const curVal = lg[c.key] !== undefined ? lg[c.key] : (saved?.[c.key] ?? '');
                        return (
                          <td key={c.key} className="p-2 text-center">
                            {canEditHr() ? (
                              <input
                                type="number" min="0" max="5" step="1"
                                className="input py-0.5 text-sm text-center w-14"
                                value={curVal}
                                onChange={ev => setGrade(pan, c.key, ev.target.value)}
                                style={{ color: scoreColor(curVal), fontWeight: 700 }}
                                disabled={!pan}
                                placeholder="—"
                              />
                            ) : (
                              <span className="font-bold text-sm" style={{ color: scoreColor(curVal) }}>
                                {curVal !== '' && curVal !== null && curVal !== undefined ? curVal : '—'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-center">
                        {overallPct !== null
                          ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white"
                              style={{ background: overallPct >= 80 ? '#10b981' : overallPct >= 60 ? '#C9A227' : '#d71920' }}>
                              {overallPct}%
                            </span>
                          : <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
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
  if (!grade) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span className="inline-block w-7 h-7 rounded-full text-sm font-bold leading-7 text-center text-white" style={{ background: GRADE_COLOR[grade] || '#888' }}>
      {grade}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AdminTab({ emps, canEditHr }) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [sanctionEdit, setSanctionEdit] = useState(null); // {profile, count}
  const [saving,  setSaving]  = useState(false);

  const load = () => {
    setLoading(true);
    api.hrAdminStats().then(setStats).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const saveSanction = async () => {
    if (!sanctionEdit) return;
    setSaving(true);
    try {
      await api.saveSanctionedPost({ profile: sanctionEdit.profile, sanctioned_count: Number(sanctionEdit.count) });
      load();
      setSanctionEdit(null);
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  const inactive = useMemo(() => emps.filter(e => !(e.is_emp_working == 1 || e.Status === 'Active')), [emps]);

  const downloadProfiles = () => {
    if (!stats?.profiles) return;
    const data = stats.profiles.map(p => ({
      'Profile (Story Type)': p.profile,
      'Available (Working)':   p.available,
      'Sanctioned':            p.sanctionedCount ?? 'Not Set',
      'Vacant':                p.vacant ?? 'N/A',
      'Avg Salary':            p.avgSalary ? `₹${p.avgSalary.toLocaleString('en-IN')}` : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
    XLSX.writeFile(wb, `profile_sanction_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--muted)' }}>
        <Loader2 size={20} className="animate-spin" /> Loading admin stats…
      </div>
    );
  }

  const ret = stats?.retBuckets || {};

  return (
    <div className="space-y-4">
      {/* Retirement Overview */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <RetTile label="Retiring This Year"  count={(ret.overdue?.length || 0) + (ret.within1yr?.length || 0)} color="#d71920" />
        <RetTile label="Retiring in 1–3 yrs" count={ret.yr1to3?.length || 0}   color="#f97316" />
        <RetTile label="Retiring in 3–5 yrs" count={ret.yr3to5?.length || 0}   color="#C9A227" />
        <RetTile label="Left / Inactive"      count={stats?.totalInactive || inactive.length} color="#6b7280" />
      </div>

      {/* Retiring soon detail */}
      {(ret.overdue?.length || ret.within1yr?.length) > 0 && (
        <SectionCard title="Retiring Within 1 Year">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...(ret.overdue || []), ...(ret.within1yr || [])].map(e => (
              <div key={e.EMP_CODE} className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
                <div className="text-sm font-semibold">{e.EMPNAME}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  {e.Story_Type || e.emp_designation} · {e.Branch} · Age {e.age} · Retires {e.retireOn}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

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
        title="Story Type–wise: Sanctioned vs Available (Active Members)"
        action={
          <div className="flex items-center gap-2">
            <button onClick={downloadProfiles} className="btn-ghost flex items-center gap-1.5 text-sm">
              <Download size={14} /> Excel
            </button>
          </div>
        }
      >
        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
          Click the sanctioned count to update it. Vacant = Sanctioned − Available.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="p-2">Profile (Story Type)</th>
                <th className="p-2 text-right">Available</th>
                <th className="p-2 text-right">Sanctioned</th>
                <th className="p-2 text-right">Vacant</th>
                <th className="p-2 text-right">Avg Salary</th>
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
                        {p.sanctionedCount != null ? p.sanctionedCount : 'Set →'}
                      </button>
                    ) : (
                      p.sanctionedCount ?? '—'
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {p.vacant != null ? (
                      <span style={{ color: p.vacant > 0 ? '#d71920' : '#10b981', fontWeight: 600 }}>
                        {p.vacant > 0 ? p.vacant : '✓ Full'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="p-2 text-right">
                    {p.avgSalary ? `₹${p.avgSalary.toLocaleString('en-IN')}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Left / Inactive Employees */}
      <SectionCard title={`Left / Inactive Employees (${inactive.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="p-2">Emp Code</th>
                <th className="p-2">Name</th>
                <th className="p-2">Story Type</th>
                <th className="p-2">Department</th>
                <th className="p-2">Branch</th>
                <th className="p-2">DOJ</th>
              </tr>
            </thead>
            <tbody>
              {inactive.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center" style={{ color: 'var(--muted)' }}>No inactive employees found.</td></tr>
              )}
              {inactive.map(e => (
                <tr key={e.EMP_CODE} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 font-mono text-xs">{e.EMP_CODE}</td>
                  <td className="p-2 font-semibold">{e.EMPNAME}</td>
                  <td className="p-2">{e.Story_Type || e.emp_designation || '—'}</td>
                  <td className="p-2">{e.emp_deptt}</td>
                  <td className="p-2">{e.Branch}</td>
                  <td className="p-2">{e.DOJ}</td>
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
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>{sanctionEdit.profile}</p>
            <input
              className="input w-full" type="number" min={0}
              value={sanctionEdit.count}
              onChange={e => setSanctionEdit(s => ({ ...s, count: e.target.value }))}
              placeholder="Enter sanctioned headcount"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setSanctionEdit(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary flex items-center gap-1.5" onClick={saveSanction} disabled={saving}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RetTile({ label, count, color }) {
  return (
    <div className="card p-4">
      <div className="text-3xl font-bold" style={{ fontFamily: 'Roboto, sans-serif', color }}>{count}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════
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
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}
