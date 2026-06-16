import { useEffect, useRef, useState } from 'react';
import {
  Gavel, CalendarClock, FileWarning, Plus, X, Save, Trash2,
  Loader2, CheckCircle2, AlertCircle, Upload, FileText,
  Paperclip, Image as ImageIcon, Eye,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api, API_BASE } from '../api/client.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// ── Status and Risk options ───────────────────────────────────────────────────
const STATUS_OPTIONS = ['Active', 'Pending Docs', 'Adjourned', 'Disposed', 'Closed'];
const RISK_OPTIONS   = ['Low', 'Medium', 'High'];

const blankCase = () => ({
  case_no: '', state: '', branch: '', court: '', party: '',
  advocate: '', hearing: '', status: 'Active', risk: 'Low',
  documents: '', notes: '',
});

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'cases',   label: 'Legal Cases' },
  { key: 'notices', label: 'Legal Notices' },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Legal() {
  const { t, edition, canEditLegal } = useApp();
  const [tab,       setTab]       = useState('cases');
  const [cases,     setCases]     = useState([]);
  const [editing,   setEditing]   = useState(null);
  const [toast,     setToast]     = useState(null);
  const [deleting,  setDeleting]  = useState(null);
  const [locations, setLocations] = useState({ states: [], branchesByState: {} });

  useEffect(() => {
    api.legalCases(edition).then(setCases);
    api.listLocations().then(setLocations);
  }, [edition]);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSave = async (caseData) => {
    try {
      const res = await api.saveLegalCase(caseData);
      if (res.ok) {
        setCases((prev) => {
          const idx = prev.findIndex((c) => c.case_no === caseData.case_no);
          if (idx >= 0) { const next = [...prev]; next[idx] = { ...prev[idx], ...caseData }; return next; }
          return [{ ...caseData, id: Date.now() }, ...prev];
        });
        setEditing(null);
        showToast('ok', `Case ${caseData.case_no} ${res.action === 'created' ? 'added' : 'updated'} successfully.`);
      } else {
        showToast('err', res.error || 'Save failed.');
      }
    } catch (err) {
      showToast('err', err.message || 'Network error.');
    }
  };

  const handleDelete = async (id, caseNo) => {
    if (!window.confirm(`Delete case ${caseNo}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await api.deleteLegalCase(id);
      setCases((prev) => prev.filter((c) => c.id !== id));
      showToast('ok', `Case ${caseNo} deleted.`);
    } catch (err) {
      showToast('err', 'Delete failed: ' + err.message);
    } finally {
      setDeleting(null);
    }
  };

  const activeCases   = cases.filter((c) => c.status === 'Active').length;
  const upcomingCount = cases.filter((c) => {
    const diff = (new Date(c.hearing) - new Date()) / 864e5;
    return diff >= 0 && diff <= 7;
  }).length;
  const highRiskCount = cases.filter((c) => c.risk === 'High').length;

  return (
    <div>
      <PageHeader
        title={`${t('nav.legal')} · ${edition}`}
        subtitle="Case management · legal notices · hearing reminders"
      >
        {tab === 'cases' && canEditLegal() && (
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setEditing(blankCase())}>
            <Plus size={16} /> Add Case
          </button>
        )}
      </PageHeader>

      {/* ── Summary Tiles ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <Tile icon={Gavel}        label="Active Cases"     value={activeCases}   accent="#3b82f6" />
        <Tile icon={CalendarClock} label="Hearings ≤7 days" value={upcomingCount} accent="#C9A227" />
        <Tile icon={FileWarning}  label="High Risk"        value={highRiskCount} accent="#d71920" />
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className="mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
          style={{ background: toast.type === 'ok' ? '#d1fae5' : '#fee2e2', color: toast.type === 'ok' ? '#065f46' : '#991b1b' }}
        >
          {toast.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="mt-4 flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className="px-4 py-2 text-sm font-semibold transition"
            style={{
              color:       tab === tb.key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: tab === tb.key ? '2px solid var(--brand)' : '2px solid transparent',
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────── */}
      <div className="mt-4">
        {tab === 'cases' && (
          <LegalCasesTab
            cases={cases}
            canEditLegal={canEditLegal}
            deleting={deleting}
            onEdit={(c) => setEditing({ ...c })}
            onDelete={handleDelete}
          />
        )}
        {tab === 'notices' && (
          <LegalNoticesTab showToast={showToast} locations={locations} />
        )}
      </div>

      {/* ── Case Modal ────────────────────────────────────────────────────── */}
      {editing && (
        <CaseModal
          caseData={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ── Legal Cases tab ───────────────────────────────────────────────────────────
function LegalCasesTab({ cases, canEditLegal, deleting, onEdit, onDelete }) {
  return (
    <SectionCard title="Legal Cases">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: 'var(--muted)' }}>
              <th className="p-2">Case No.</th>
              <th className="p-2">State</th>
              <th className="p-2">Branch</th>
              <th className="p-2">Edition</th>
              <th className="p-2">Court</th>
              <th className="p-2">Party</th>
              <th className="p-2">Hearing</th>
              <th className="p-2">Advocate</th>
              <th className="p-2">Status</th>
              <th className="p-2">Risk</th>
              {canEditLegal() && <th className="p-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr>
                <td colSpan={canEditLegal() ? 11 : 10} className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
                  No cases found. {canEditLegal() ? 'Click "Add Case" to create one.' : ''}
                </td>
              </tr>
            )}
            {cases.map((c) => (
              <tr key={c.case_no} className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition" style={{ borderColor: 'var(--border)' }}>
                <td className="p-2 font-mono text-xs font-semibold">{c.case_no}</td>
                <td className="p-2">{c.state  || '—'}</td>
                <td className="p-2">{c.branch || '—'}</td>
                <td className="p-2">{c.edition}</td>
                <td className="p-2">{c.court}</td>
                <td className="p-2">{c.party}</td>
                <td className="p-2 whitespace-nowrap">
                  {c.hearing && (
                    <>
                      {c.hearing}
                      {(() => {
                        const d = Math.ceil((new Date(c.hearing) - new Date()) / 864e5);
                        if (d >= 0 && d <= 7) return <span className="ml-1 text-xs font-semibold" style={{ color: '#d71920' }}>({d}d)</span>;
                        return null;
                      })()}
                    </>
                  )}
                </td>
                <td className="p-2">{c.advocate}</td>
                <td className="p-2">
                  <Badge tone={c.status === 'Active' ? 'active' : c.status === 'Closed' || c.status === 'Disposed' ? 'low' : 'med'}>
                    {c.status}
                  </Badge>
                </td>
                <td className="p-2">
                  <Badge tone={c.risk === 'High' ? 'high' : c.risk === 'Medium' ? 'med' : 'low'}>
                    {c.risk}
                  </Badge>
                </td>
                {canEditLegal() && (
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <button className="text-xs font-semibold hover:opacity-70 transition" style={{ color: 'var(--brand)' }} onClick={() => onEdit(c)}>
                        Edit
                      </button>
                      <button
                        className="text-xs font-semibold hover:opacity-70 transition"
                        style={{ color: '#d71920' }}
                        onClick={() => onDelete(c.id, c.case_no)}
                        disabled={deleting === c.id}
                      >
                        {deleting === c.id ? <Loader2 size={13} className="animate-spin" /> : 'Delete'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        Red badge on hearing date = hearing within 7 days. Cases are filtered by selected edition.
      </p>
    </SectionCard>
  );
}

// ── Legal Notices tab ─────────────────────────────────────────────────────────
function LegalNoticesTab({ showToast, locations }) {
  const [notices,   setNotices]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [deleting,  setDeleting]  = useState(null);

  useEffect(() => {
    api.listLegalNotices()
      .then(r => setNotices(r.notices || []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (notice) => {
    setNotices(prev => [notice, ...prev]);
    setShowForm(false);
    showToast('ok', 'Legal notice saved successfully.');
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this legal notice and all its files? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.deleteLegalNotice(id);
      setNotices(prev => prev.filter(n => n.id !== id));
      showToast('ok', 'Notice deleted.');
    } catch (err) {
      showToast('err', 'Delete failed: ' + err.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Upload a legal notice PDF — fields are filled automatically from the document.
        </p>
        <button className="btn-primary flex items-center gap-1.5" onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add Notice
        </button>
      </div>

      {showForm && (
        <LegalNoticeForm
          locations={locations}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
          showToast={showToast}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" size={28} style={{ color: 'var(--muted)' }} /></div>
      ) : notices.length === 0 && !showForm ? (
        <div className="py-12 text-center text-sm" style={{ color: 'var(--muted)' }}>No legal notices yet. Click "Add Notice" to upload one.</div>
      ) : (
        <div className="space-y-3">
          {notices.map(n => (
            <NoticeCard key={n.id} notice={n} deleting={deleting} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Notice upload & auto-fill form ────────────────────────────────────────────
const BLANK_NOTICE = () => ({
  state: '', branch: '', advocate_name: '', notice_date: '',
  notice_in_favour_of: '', matter_summary: '',
});

function LegalNoticeForm({ locations, onSaved, onCancel, showToast }) {
  const [form,       setForm]      = useState(BLANK_NOTICE());
  const [pdfFile,    setPdfFile]   = useState(null);        // File object
  const [pdfName,    setPdfName]   = useState('');          // saved filename on server
  const [pdfOrig,    setPdfOrig]   = useState('');
  const [rawText,    setRawText]   = useState('');
  const [cuttings,   setCuttings]  = useState([]);          // [{file, docName, saved}]
  const [parsing,    setParsing]   = useState(false);
  const [saving,     setSaving]    = useState(false);
  const pdfInputRef   = useRef();
  const cutInputRef   = useRef();

  const { states = [], branchesByState = {} } = locations || {};
  const availBranches = form.state ? (branchesByState[form.state] || []) : [];

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Upload PDF → parse ────────────────────────────────────────────────────
  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('notice_pdf', file);
      const data = await api.parseLegalNoticePdf(fd);
      if (data.ok) {
        setPdfName(data.pdf_filename);
        setPdfOrig(data.pdf_original_name);
        setRawText(data.raw_text || '');
        // Merge parsed fields — only overwrite blank fields
        setForm(prev => ({
          state:               data.parsed.state               || prev.state,
          branch:              data.parsed.branch              || prev.branch,
          advocate_name:       data.parsed.advocate_name       || prev.advocate_name,
          notice_date:         data.parsed.notice_date         || prev.notice_date,
          notice_in_favour_of: data.parsed.notice_in_favour_of || prev.notice_in_favour_of,
          matter_summary:      data.parsed.matter_summary      || prev.matter_summary,
        }));
      }
    } catch (err) {
      showToast('err', 'PDF parse failed: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  // ── Add newspaper cuttings ────────────────────────────────────────────────
  const handleCuttingAdd = (e) => {
    const files = Array.from(e.target.files || []);
    const newItems = files.map(f => ({ file: f, docName: f.name.replace(/\.[^.]+$/, ''), saved: null }));
    setCuttings(prev => [...prev, ...newItems]);
    e.target.value = '';
  };

  const updateDocName = (idx, val) => {
    setCuttings(prev => prev.map((c, i) => i === idx ? { ...c, docName: val } : c));
  };

  const removeCutting = (idx) => {
    setCuttings(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Save notice ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.advocate_name.trim()) { showToast('err', 'Advocate name is required.'); return; }

    setSaving(true);
    try {
      // Upload any cuttings not yet uploaded
      let savedCuttings = cuttings.filter(c => c.saved).map(c => c.saved);
      const pendingCuts = cuttings.filter(c => !c.saved);

      if (pendingCuts.length > 0 || (!pdfName && pdfFile)) {
        const fd = new FormData();
        if (pdfFile && !pdfName) fd.append('notice_pdf', pdfFile);
        pendingCuts.forEach(c => fd.append('cuttings', c.file));
        fd.append('doc_names', JSON.stringify(pendingCuts.map(c => c.docName)));
        const data = await api.parseLegalNoticePdf(fd);
        if (data.ok) {
          if (data.pdf_filename && !pdfName) {
            setPdfName(data.pdf_filename);
            setPdfOrig(data.pdf_original_name);
          }
          savedCuttings = [...savedCuttings, ...data.cuttings];
          setCuttings(prev => {
            let ci = 0;
            return prev.map(c => c.saved ? c : { ...c, saved: data.cuttings[ci++] || null });
          });
        }
      }

      const payload = {
        ...form,
        pdf_filename:      pdfName,
        pdf_original_name: pdfOrig,
        cuttings:          savedCuttings,
        raw_text:          rawText,
      };

      const res = await api.saveLegalNotice(payload);
      if (res.ok) {
        onSaved({ ...payload, id: res.id, created_at: new Date().toISOString() });
      } else {
        showToast('err', res.error || 'Save failed.');
      }
    } catch (err) {
      showToast('err', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-4 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold" style={{ color: 'var(--brand)' }}>New Legal Notice</h3>
        <button onClick={onCancel} className="rounded-lg p-1 hover:bg-black/10 transition"><X size={18} /></button>
      </div>

      {/* ── PDF Upload ─────────────────────────────────────────────────── */}
      <div className="mb-5">
        <label className="label mb-1">Upload Legal Notice PDF</label>
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition hover:bg-black/5"
          style={{ borderColor: pdfFile ? 'var(--brand)' : 'var(--border)' }}
          onClick={() => pdfInputRef.current?.click()}
        >
          {parsing ? (
            <><Loader2 size={24} className="animate-spin" style={{ color: 'var(--brand)' }} /><span className="text-sm" style={{ color: 'var(--muted)' }}>Extracting fields from PDF…</span></>
          ) : pdfFile ? (
            <><FileText size={24} style={{ color: 'var(--brand)' }} /><span className="text-sm font-semibold">{pdfFile.name}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>Click to change PDF</span></>
          ) : (
            <><Upload size={24} style={{ color: 'var(--muted)' }} /><span className="text-sm" style={{ color: 'var(--muted)' }}>Click to upload legal notice PDF</span><span className="text-xs" style={{ color: 'var(--muted)' }}>Fields will be auto-filled from the document</span></>
          )}
          <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
        </div>
      </div>

      {/* ── Auto-filled fields ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="State">
            <select className="input w-full" value={form.state} onChange={e => { setField('state', e.target.value); setField('branch', ''); }}>
              <option value="">— Select State —</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Branch">
            <select className="input w-full" value={form.branch} onChange={e => setField('branch', e.target.value)} disabled={!form.state}>
              <option value="">— Select Branch —</option>
              {availBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Advocate Name" required>
            <input className="input w-full" value={form.advocate_name} onChange={e => setField('advocate_name', e.target.value)} placeholder="e.g. Rakesh Dwivedi" />
          </Field>
          <Field label="Notice Date">
            <input className="input w-full" type="date" value={form.notice_date} onChange={e => setField('notice_date', e.target.value)} />
          </Field>
        </div>

        <Field label="Notice In Favour Of">
          <textarea className="input w-full resize-none" rows={2} value={form.notice_in_favour_of} onChange={e => setField('notice_in_favour_of', e.target.value)} placeholder="Addressee / recipient of the notice" />
        </Field>

        <Field label="Matter Summary (50 words)">
          <textarea className="input w-full resize-none" rows={3} value={form.matter_summary} onChange={e => setField('matter_summary', e.target.value)} placeholder="Brief description of the matter — auto-extracted from PDF, edit as needed" />
        </Field>
      </div>

      {/* ── Newspaper Cuttings ─────────────────────────────────────────── */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <label className="label">Newspaper Cuttings</label>
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-semibold"
            style={{ color: 'var(--brand)' }}
            onClick={() => cutInputRef.current?.click()}
          >
            <Paperclip size={14} /> Add Cutting
          </button>
          <input ref={cutInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={handleCuttingAdd} />
        </div>

        {cuttings.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>No cuttings added. Click "Add Cutting" to attach newspaper images or PDFs.</p>
        )}

        <div className="space-y-2">
          {cuttings.map((c, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: 'var(--border)' }}>
              <span className="shrink-0" style={{ color: 'var(--muted)' }}>
                {c.file.type.startsWith('image') ? <ImageIcon size={16} /> : <FileText size={16} />}
              </span>
              <span className="truncate text-xs" style={{ color: 'var(--muted)', minWidth: 80, maxWidth: 140 }}>{c.file.name}</span>
              <input
                className="input flex-1 py-1 text-sm"
                placeholder="Document name (e.g. Hindustan Times 12 June)"
                value={c.docName}
                onChange={e => updateDocName(i, e.target.value)}
              />
              <button onClick={() => removeCutting(i)} className="shrink-0 hover:opacity-70"><X size={14} style={{ color: '#d71920' }} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="mt-5 flex items-center justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <button className="btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn-primary flex items-center gap-1.5" onClick={handleSave} disabled={saving || parsing}>
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save Notice</>}
        </button>
      </div>
    </div>
  );
}

// ── Notice card (list view) ───────────────────────────────────────────────────
function NoticeCard({ notice, deleting, onDelete }) {
  const [open, setOpen] = useState(false);
  const cuttings = Array.isArray(notice.cuttings) ? notice.cuttings
    : (() => { try { return JSON.parse(notice.cuttings || '[]'); } catch { return []; } })();

  return (
    <div className="card overflow-hidden">
      {/* ── Header row ── */}
      <button
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <span className="font-semibold">{notice.advocate_name || 'Unknown Advocate'}</span>
          {notice.notice_date && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {new Date(notice.notice_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
            </span>
          )}
          {notice.state  && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">{notice.state}</span>}
          {notice.branch && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{notice.branch}</span>}
          {cuttings.length > 0 && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
              <Paperclip size={12} /> {cuttings.length} cutting{cuttings.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* ── Expanded detail ── */}
      {open && (
        <div className="border-t px-4 pb-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DetailRow label="In favour of" value={notice.notice_in_favour_of} />
            <DetailRow label="Matter Summary" value={notice.matter_summary} />
          </div>

          {/* PDF download */}
          {notice.pdf_filename && (
            <a
              href={`${API_BASE.replace('/api', '')}/uploads/legal-notices/${notice.pdf_filename}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold"
              style={{ color: 'var(--brand)' }}
            >
              <FileText size={14} /> {notice.pdf_original_name || 'View PDF'}
            </a>
          )}

          {/* Cuttings */}
          {cuttings.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Newspaper Cuttings</p>
              <div className="flex flex-wrap gap-2">
                {cuttings.map((c, i) => (
                  <a
                    key={i}
                    href={`${API_BASE.replace('/api', '')}/uploads/legal-notices/${c.filename}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:opacity-80"
                    style={{ borderColor: 'var(--border)', color: 'var(--brand)' }}
                  >
                    <Eye size={12} /> {c.doc_name || c.original_name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Delete */}
          <div className="mt-4 flex justify-end">
            <button
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: '#d71920' }}
              onClick={() => onDelete(notice.id)}
              disabled={deleting === notice.id}
            >
              {deleting === notice.id ? <Loader2 size={13} className="animate-spin" /> : <><Trash2 size={13} /> Delete Notice</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</p>
      <p className="mt-0.5 text-sm">{value}</p>
    </div>
  );
}

// ── Tile ──────────────────────────────────────────────────────────────────────
function Tile({ icon: Icon, label, value, accent = '#3b82f6' }) {
  return (
    <div className="card p-4">
      <span className="rounded-lg p-1.5 inline-flex" style={{ background: accent + '1a', color: accent }}>
        <Icon size={16} />
      </span>
      <div className="mt-2 text-3xl font-bold" style={{ fontFamily: 'Roboto, sans-serif' }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

// ── Case Add / Edit Modal ─────────────────────────────────────────────────────
function CaseModal({ caseData, locations, onClose, onSave }) {
  const [form,    setForm]    = useState({ ...caseData });
  const [saving,  setSaving]  = useState(false);
  const [errors,  setErrors]  = useState({});

  const { states = [], branchesByState = {} } = locations || {};
  const availBranches = form.state ? (branchesByState[form.state] || []) : [];

  const set = (k, v) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'state') next.branch = '';
      return next;
    });
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.case_no.trim())   e.case_no  = 'Required';
    if (!form.court.trim())     e.court    = 'Required';
    if (!form.party.trim())     e.party    = 'Required';
    if (!form.advocate.trim())  e.advocate = 'Required';
    if (!form.hearing)          e.hearing  = 'Required';
    if (!form.status)           e.status   = 'Required';
    if (!form.risk)             e.risk     = 'Required';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const isEdit = !!caseData.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 max-h-[92vh] w-full max-w-2xl overflow-y-auto p-6">

        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gavel size={18} style={{ color: 'var(--brand)' }} />
            <h3 className="text-lg font-bold">{isEdit ? 'Edit Case' : 'Add New Case'}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/10 transition">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Case No." error={errors.case_no} required>
            <input className="input w-full" placeholder="e.g. CIV/2025/118" value={form.case_no} onChange={(e) => set('case_no', e.target.value)} disabled={isEdit} />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="State">
              <select className="input w-full" value={form.state} onChange={(e) => set('state', e.target.value)}>
                <option value="">— Select State —</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Branch">
              <select className="input w-full" value={form.branch} onChange={(e) => set('branch', e.target.value)} disabled={!form.state}>
                <option value="">— Select Branch —</option>
                {availBranches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Court" error={errors.court} required>
              <input className="input w-full" placeholder="e.g. Rajasthan High Court" value={form.court} onChange={(e) => set('court', e.target.value)} />
            </Field>
            <Field label="Party / Opponent" error={errors.party} required>
              <input className="input w-full" placeholder="e.g. State vs Patrika" value={form.party} onChange={(e) => set('party', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Advocate" error={errors.advocate} required>
              <input className="input w-full" placeholder="e.g. Adv. S. Mehta" value={form.advocate} onChange={(e) => set('advocate', e.target.value)} />
            </Field>
            <Field label="Next Hearing Date" error={errors.hearing} required>
              <input className="input w-full" type="date" value={form.hearing} onChange={(e) => set('hearing', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Status" error={errors.status} required>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Risk Level" error={errors.risk} required>
              <select className="input w-full" value={form.risk} onChange={(e) => set('risk', e.target.value)}>
                {RISK_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r === 'High' ? '🔴' : r === 'Medium' ? '🟡' : '🟢'} {r}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Documents / File Reference" hint="Optional — file path, URL, or reference number">
            <input className="input w-full" placeholder="e.g. /docs/CIV2025118.pdf" value={form.documents} onChange={(e) => set('documents', e.target.value)} />
          </Field>

          <Field label="Notes" hint="Optional — additional remarks">
            <textarea className="input w-full resize-none" rows={3} placeholder="Add any internal notes…" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Fields marked <span style={{ color: '#d71920' }}>*</span> are required</p>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn-primary flex items-center gap-1.5" onClick={handleSubmit} disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> {isEdit ? 'Update Case' : 'Save Case'}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({ label, children, error, hint, required }) {
  return (
    <div>
      <label className="label mb-1 flex items-center gap-1">
        {label}
        {required && <span style={{ color: '#d71920' }}>*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs" style={{ color: '#d71920' }}>{error}</p>}
      {hint && !error && <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{hint}</p>}
    </div>
  );
}
