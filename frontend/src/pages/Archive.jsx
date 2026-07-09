import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Upload, Search, FileVideo, FileAudio, Image, Folder,
  Tag, MapPin, Newspaper, Mic, Play, Eye, Trash2,
  CheckCircle, Clock, AlertCircle, X, ChevronDown,
  Download, Copy, RefreshCw, Filter, LayoutGrid, List,
  BookOpen, Camera, Radio, Tv, Users, Mic2,
  FileText, File, CalendarDays,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { PageHeader, SectionCard } from '../components/UI.jsx';

const TOKEN = () => localStorage.getItem('pk_token');
const authH = () => ({ Authorization: `Bearer ${TOKEN()}` });

// ── Category config (print-media specific) ─────────────────────────────────────
const CATEGORIES = [
  { value: 'press_conference', label: 'Press Conference',   icon: Mic,       color: '#d71920' },
  { value: 'interview',        label: 'Reporter Interview', icon: Mic2,      color: '#C9A227' },
  { value: 'field_recording',  label: 'Field Recording',   icon: Radio,     color: '#16a34a' },
  { value: 'editorial_meet',   label: 'Editorial Meeting',  icon: Users,     color: '#3b82f6' },
  { value: 'event_coverage',   label: 'Event Coverage',    icon: Camera,    color: '#7c3aed' },
  { value: 'training',         label: 'Training / Workshop',icon: BookOpen,  color: '#0891b2' },
  { value: 'photo_story',      label: 'Photo Story',       icon: Image,     color: '#f97316' },
  { value: 'broadcast',        label: 'TV / Broadcast Clip',icon: Tv,       color: '#8b5cf6' },
  { value: 'other',            label: 'Other',             icon: Folder,    color: '#6b7280' },
];
const catMap = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

// ── File type helpers ──────────────────────────────────────────────────────────
const TYPE_ICON = { video: FileVideo, audio: FileAudio, image: Image };
const TYPE_COLOR = { video: '#d71920', audio: '#C9A227', image: '#16a34a' };
const TYPE_ACCEPT = { video: 'video/*', audio: 'audio/*', image: 'image/*' };

function typeLabel(t) { return t === 'video' ? 'Video' : t === 'audio' ? 'Audio' : 'Image'; }

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Transcript status badge ────────────────────────────────────────────────────
function TxBadge({ status }) {
  if (status === 'done')    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#10b98120', color: '#10b981' }}><CheckCircle size={10} className="inline mr-0.5" />Transcript Ready</span>;
  if (status === 'pending') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#C9A22720', color: '#C9A227' }}><Clock size={10} className="inline mr-0.5 animate-spin" />Processing…</span>;
  if (status === 'failed')  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#d7192015', color: '#d71920' }}><AlertCircle size={10} className="inline mr-0.5" />Failed</span>;
  return null;
}

// ── Upload Modal ───────────────────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded, locations }) {
  const fileRef   = useRef();
  const [file,    setFile]    = useState(null);
  const [drag,    setDrag]    = useState(false);
  const [form,    setForm]    = useState({
    title: '', category: 'press_conference', state: '', branch: '', edition: '', tags: '', description: '',
  });
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error,    setError]   = useState('');

  const branches = form.state
    ? (locations?.branches?.[form.state] || [])
    : [];

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    if (!form.title) setForm(p => ({ ...p, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ') }));
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    pickFile(e.dataTransfer.files[0]);
  }

  async function submit() {
    if (!file) return setError('Please select a file');
    setUploading(true); setError('');
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));

    // XHR for progress
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/archive');
      xhr.setRequestHeader('Authorization', `Bearer ${TOKEN()}`);
      xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { resolve(JSON.parse(xhr.responseText)); }
        else { try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error(`HTTP ${xhr.status}`)); } }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    }).then(data => { onUploaded(data.file); onClose(); })
      .catch(e => { setError(e.message); setUploading(false); setProgress(0); });
  }

  const cat = catMap[form.category];
  const CatIcon = cat?.icon || Folder;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><Upload size={18} />Upload to Archive</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:opacity-70"><X size={18} /></button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors mb-4"
          style={{ borderColor: drag ? 'var(--brand)' : 'var(--border)', background: drag ? 'var(--brand)10' : 'var(--bg)' }}
        >
          {file ? (
            <>
              <div className="text-2xl mb-1">
                {file.type.startsWith('video/') ? '🎬' : file.type.startsWith('audio/') ? '🎙️' : '🖼️'}
              </div>
              <div className="font-semibold text-sm">{file.name}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{fmtSize(file.size)}</div>
            </>
          ) : (
            <>
              <Upload size={28} style={{ color: 'var(--muted)' }} />
              <div className="mt-2 text-sm font-semibold">Drag & drop or click to browse</div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Video · Audio · Photos — up to 500 MB</div>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept="video/*,audio/*,image/*" className="hidden"
          onChange={e => pickFile(e.target.files[0])} />

        {/* Form fields */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Title *</label>
            <input className="input w-full" placeholder="e.g. CM Press Conference — Jaipur 11 Jun"
              value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Category</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.map(c => {
                const CI = c.icon;
                return (
                  <button key={c.value} type="button"
                    onClick={() => setForm(p => ({ ...p, category: c.value }))}
                    className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border transition-all text-left"
                    style={{
                      borderColor:   form.category === c.value ? c.color : 'var(--border)',
                      background:    form.category === c.value ? c.color + '18' : 'var(--bg)',
                      color:         form.category === c.value ? c.color : 'var(--text)',
                      fontWeight:    form.category === c.value ? 700 : 400,
                    }}>
                    <CI size={12} /> {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>State</label>
              <select className="input w-full" value={form.state}
                onChange={e => setForm(p => ({ ...p, state: e.target.value, branch: '' }))}>
                <option value="">All States</option>
                {(locations?.states || []).filter(s => s !== 'All').map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Branch / Bureau</label>
              <select className="input w-full" value={form.branch}
                onChange={e => setForm(p => ({ ...p, branch: e.target.value }))}
                disabled={!form.state}>
                <option value="">All Branches</option>
                {branches.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Edition (optional)</label>
            <input className="input w-full" placeholder="e.g. Jaipur Main, Rajasthan"
              value={form.edition} onChange={e => setForm(p => ({ ...p, edition: e.target.value }))} />
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Tags (comma separated)</label>
            <input className="input w-full" placeholder="e.g. election, CM, Rajasthan, 2026"
              value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} />
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Notes</label>
            <textarea className="input w-full" rows={2} placeholder="Brief description or context…"
              value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </div>
        </div>

        {error && <div className="mt-3 text-sm p-2 rounded-lg" style={{ background: '#d7192015', color: '#d71920' }}>{error}</div>}

        {uploading && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
              <span>Uploading…</span><span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full" style={{ background: 'var(--border)' }}>
              <div className="h-2 rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--brand)' }} />
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={submit} disabled={uploading || !file} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {uploading ? <><RefreshCw size={14} className="animate-spin" />Uploading…</> : <><Upload size={14} />Upload</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── File Detail Modal ──────────────────────────────────────────────────────────
function DetailModal({ file: initFile, onClose, onDeleted, isAdmin }) {
  const [file,        setFile]        = useState(initFile);
  const [editing,     setEditing]     = useState(false);
  const [form,        setForm]        = useState({});
  const [transcribing,setTranscribing]= useState(false);
  const [txMsg,       setTxMsg]       = useState('');
  const [copied,      setCopied]      = useState(false);
  const pollRef = useRef(null);

  // Poll for transcript completion
  useEffect(() => {
    if (file.transcript_status === 'pending') {
      pollRef.current = setInterval(async () => {
        const r = await fetch(`/api/archive/${file.id}`, { headers: authH() }).catch(() => null);
        if (!r?.ok) return;
        const d = await r.json();
        setFile(d.file);
        if (d.file.transcript_status !== 'pending') clearInterval(pollRef.current);
      }, 4000);
    }
    return () => clearInterval(pollRef.current);
  }, [file.id, file.transcript_status]);

  async function triggerTranscribe() {
    setTranscribing(true); setTxMsg('');
    const r = await fetch(`/api/archive/${file.id}/transcribe`, {
      method: 'POST', headers: authH(),
    });
    const d = await r.json();
    if (!r.ok) { setTxMsg(d.error); setTranscribing(false); return; }
    setFile(f => ({ ...f, transcript_status: 'pending' }));
    setTranscribing(false);
    // Start polling
    pollRef.current = setInterval(async () => {
      const r2 = await fetch(`/api/archive/${file.id}`, { headers: authH() }).catch(() => null);
      if (!r2?.ok) return;
      const d2 = await r2.json();
      setFile(d2.file);
      if (d2.file.transcript_status !== 'pending') clearInterval(pollRef.current);
    }, 4000);
  }

  async function saveEdit() {
    const r = await fetch(`/api/archive/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authH() },
      body: JSON.stringify(form),
    });
    const d = await r.json();
    setFile(d.file);
    setEditing(false);
  }

  async function deleteFile() {
    if (!window.confirm('Delete this file permanently?')) return;
    await fetch(`/api/archive/${file.id}`, { method: 'DELETE', headers: authH() });
    onDeleted(file.id);
    onClose();
  }

  function copyTranscript() {
    navigator.clipboard.writeText(file.transcript_text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const TypeIcon = TYPE_ICON[file.file_type] || FileVideo;
  const cat      = catMap[file.category] || catMap.other;
  const CatIcon  = cat.icon;
  const isMedia  = file.file_type === 'video' || file.file_type === 'audio';
  const fileUrl  = `/uploads/archive/${file.filename}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <TypeIcon size={22} style={{ color: TYPE_COLOR[file.file_type], flexShrink: 0 }} />
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight truncate">{file.title || file.original_name}</div>
              <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--muted)' }}>
                <span style={{ color: cat.color, fontWeight: 600 }}><CatIcon size={10} className="inline mr-0.5" />{cat.label}</span>
                <span>·</span><span>{fmtDate(file.upload_date)}</span>
                <span>·</span><span>{fmtSize(file.file_size)}</span>
                {file.state  && <><span>·</span><span><MapPin size={10} className="inline" /> {file.state}</span></>}
                {file.branch && <span>/ {file.branch}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:opacity-70 flex-shrink-0"><X size={18} /></button>
        </div>

        {/* Media player */}
        {file.file_type === 'video' && (
          <video controls className="w-full rounded-xl mb-4" style={{ maxHeight: 280, background: '#000' }}>
            <source src={fileUrl} type={file.mime_type} />
          </video>
        )}
        {file.file_type === 'audio' && (
          <div className="mb-4 p-4 rounded-xl flex items-center gap-3" style={{ background: 'var(--bg)' }}>
            <FileAudio size={28} style={{ color: '#C9A227', flexShrink: 0 }} />
            <audio controls className="w-full">
              <source src={fileUrl} type={file.mime_type} />
            </audio>
          </div>
        )}
        {file.file_type === 'image' && (
          <img src={fileUrl} alt={file.title} className="w-full rounded-xl mb-4 object-contain"
            style={{ maxHeight: 320, background: 'var(--bg)' }} />
        )}

        {/* Tags + Edition */}
        {(file.tags || file.edition) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {file.edition && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--brand)15', color: 'var(--brand)' }}>
                <Newspaper size={10} /> {file.edition}
              </span>
            )}
            {(file.tags || '').split(',').filter(Boolean).map(tag => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--border)', color: 'var(--muted)' }}>
                #{tag.trim()}
              </span>
            ))}
          </div>
        )}

        {file.description && (
          <p className="text-sm mb-3 p-3 rounded-lg" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
            {file.description}
          </p>
        )}

        {/* Transcription section */}
        {isMedia && (
          <div className="rounded-xl border p-4 mb-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm flex items-center gap-2">
                <Mic size={15} style={{ color: '#C9A227' }} /> Hindi Transcription
                <TxBadge status={file.transcript_status} />
              </div>
              {file.transcript_status === 'none' || file.transcript_status === 'failed' ? (
                <button
                  onClick={triggerTranscribe}
                  disabled={transcribing}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5"
                  style={{ background: 'var(--brand)', color: '#fff', opacity: transcribing ? 0.6 : 1 }}
                >
                  {transcribing ? <><RefreshCw size={12} className="animate-spin" />Starting…</> : <><Mic size={12} />Transcribe to Hindi</>}
                </button>
              ) : file.transcript_status === 'done' ? (
                <button onClick={copyTranscript}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5"
                  style={{ background: copied ? '#10b981' : 'var(--bg)', color: copied ? '#fff' : 'var(--text)' }}>
                  <Copy size={12} />{copied ? 'Copied!' : 'Copy Text'}
                </button>
              ) : null}
            </div>

            {txMsg && <p className="text-xs mb-2 p-2 rounded" style={{ background: '#d7192015', color: '#d71920' }}>{txMsg}</p>}

            {file.transcript_status === 'pending' && (
              <div className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>
                <RefreshCw size={20} className="inline animate-spin mb-2 block mx-auto" />
                Transcribing… This may take a few minutes for long recordings.
              </div>
            )}

            {file.transcript_status === 'done' && (
              <>
                {file.transcript_summary && (
                  <div className="mb-3 p-3 rounded-lg text-sm" style={{ background: 'var(--brand)10', borderLeft: '3px solid var(--brand)' }}>
                    <div className="text-xs font-bold mb-1" style={{ color: 'var(--brand)' }}>सारांश (Summary)</div>
                    <p style={{ lineHeight: 1.7 }}>{file.transcript_summary}</p>
                  </div>
                )}
                <div className="p-3 rounded-lg text-sm max-h-52 overflow-y-auto"
                  style={{ background: 'var(--bg)', lineHeight: 1.8, fontFamily: 'serif', direction: 'ltr' }}>
                  {file.transcript_text}
                </div>
              </>
            )}

            {file.transcript_status === 'none' && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Click "Transcribe to Hindi" to convert this {file.file_type} to searchable Hindi text using OpenAI Whisper.
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <a href={fileUrl} download={file.original_name}
            className="btn-ghost flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Download size={14} /> Download
          </a>
          <button onClick={() => { setEditing(!editing); setForm({ title: file.title, category: file.category, edition: file.edition, tags: file.tags, description: file.description }); }}
            className="btn-ghost flex items-center gap-1.5 text-sm px-3 py-1.5">
            <Tag size={14} /> Edit Info
          </button>
          {isAdmin && (
            <button onClick={deleteFile}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
              style={{ background: '#d7192015', color: '#d71920' }}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>

        {/* Edit form */}
        {editing && (
          <div className="mt-4 border-t pt-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
            <input className="input w-full" placeholder="Title"
              value={form.title || ''} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            <select className="input w-full" value={form.category || 'other'}
              onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input className="input w-full" placeholder="Edition"
              value={form.edition || ''} onChange={e => setForm(p => ({ ...p, edition: e.target.value }))} />
            <input className="input w-full" placeholder="Tags (comma separated)"
              value={form.tags || ''} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} />
            <textarea className="input w-full" rows={2} placeholder="Notes"
              value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="btn-ghost flex-1 text-sm">Cancel</button>
              <button onClick={saveEdit} className="btn-primary flex-1 text-sm">Save Changes</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── File Card (grid) ───────────────────────────────────────────────────────────
function FileCard({ file, onClick }) {
  const TypeIcon = TYPE_ICON[file.file_type] || FileVideo;
  const cat      = catMap[file.category] || catMap.other;
  const CatIcon  = cat.icon;
  const isImg    = file.file_type === 'image';
  const fileUrl  = `/uploads/archive/${file.filename}`;

  return (
    <div className="card overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => onClick(file)}>
      {/* Thumbnail / placeholder */}
      <div className="relative" style={{ height: 130, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isImg
          ? <img src={fileUrl} alt={file.title} className="w-full h-full object-cover" />
          : <TypeIcon size={40} style={{ color: TYPE_COLOR[file.file_type], opacity: 0.5 }} />
        }
        {file.file_type === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full p-2" style={{ background: 'rgba(0,0,0,0.45)' }}>
              <Play size={22} style={{ color: '#fff' }} />
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
            style={{ background: TYPE_COLOR[file.file_type] + 'dd', color: '#fff' }}>
            {typeLabel(file.file_type)}
          </span>
        </div>
        {file.transcript_status === 'done' && (
          <div className="absolute top-2 right-2">
            <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
              style={{ background: '#10b981dd', color: '#fff' }}>
              <CheckCircle size={9} className="inline mr-0.5" />TX
            </span>
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="font-semibold text-sm leading-tight line-clamp-2 mb-1">{file.title || file.original_name}</div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <CatIcon size={11} style={{ color: cat.color }} />
          <span style={{ color: cat.color }}>{cat.label}</span>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span>{fmtDate(file.upload_date)}</span>
          <span>{fmtSize(file.file_size)}</span>
        </div>
        {(file.state || file.branch) && (
          <div className="mt-1 text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
            <MapPin size={10} />{[file.state, file.branch].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── File Row (list view) ───────────────────────────────────────────────────────
function FileRow({ file, onClick }) {
  const TypeIcon = TYPE_ICON[file.file_type] || FileVideo;
  const cat      = catMap[file.category] || catMap.other;
  const CatIcon  = cat.icon;
  return (
    <tr className="cursor-pointer hover:bg-opacity-50 transition-colors border-b"
      style={{ borderColor: 'var(--border)' }} onClick={() => onClick(file)}>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <TypeIcon size={16} style={{ color: TYPE_COLOR[file.file_type], flexShrink: 0 }} />
          <div>
            <div className="text-sm font-semibold leading-tight">{file.title || file.original_name}</div>
            {file.tags && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>#{(file.tags).split(',').slice(0,3).join(' #')}</div>}
          </div>
        </div>
      </td>
      <td className="p-3 text-sm" style={{ color: cat.color, whiteSpace: 'nowrap' }}>
        <CatIcon size={12} className="inline mr-1" />{cat.label}
      </td>
      <td className="p-3 text-sm" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {[file.state, file.branch].filter(Boolean).join(' · ') || '—'}
      </td>
      <td className="p-3 text-sm" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(file.upload_date)}</td>
      <td className="p-3 text-sm" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtSize(file.file_size)}</td>
      <td className="p-3"><TxBadge status={file.transcript_status} /></td>
    </tr>
  );
}

// ── Doc type helpers ───────────────────────────────────────────────────────────
function fmtDocDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Circular / Stylesheet tab ──────────────────────────────────────────────────
function DocTab({ docType }) {
  const { user } = useApp();
  const isAdmin   = user?.role === 'Admin';
  const fileRef   = useRef();
  const isPdf     = docType === 'circular';
  const accept    = isPdf ? '.pdf,application/pdf' : '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const typeLabel = isPdf ? 'PDF' : 'DOC/DOCX';

  const [docs,    setDocs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [form,    setForm]    = useState({ label: '', circular_date: '' });
  const [file,    setFile]    = useState(null);
  const [progress, setProgress] = useState(0);
  const [viewing,  setViewing]  = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/archive-docs?type=${docType}`, { headers: authH() })
      .then(r => r.json())
      .then(d => setDocs(d.docs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [docType]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (!file) return setErr('Please select a file');
    if (!form.label.trim()) return setErr('Label is required');
    if (!form.circular_date) return setErr('Date is required');
    setBusy(true); setErr('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', docType);
    fd.append('label', form.label.trim());
    fd.append('circular_date', form.circular_date);

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/archive-docs');
      xhr.setRequestHeader('Authorization', `Bearer ${TOKEN()}`);
      xhr.upload.onprogress = ev => { if (ev.lengthComputable) setProgress(Math.round(ev.loaded / ev.total * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else { try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error(`HTTP ${xhr.status}`)); } }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    }).then(data => {
      setDocs(prev => [data.doc, ...prev]);
      setForm({ label: '', circular_date: '' });
      setFile(null);
      setProgress(0);
      if (fileRef.current) fileRef.current.value = '';
    }).catch(e => setErr(e.message));

    setBusy(false);
  }

  async function deleteDoc(id) {
    if (!window.confirm('Delete this document permanently?')) return;
    await fetch(`/api/archive-docs?id=${id}`, { method: 'DELETE', headers: authH() });
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  const Icon = isPdf ? File : FileText;
  const color = isPdf ? '#d71920' : '#3b82f6';

  return (
    <>
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      {/* Upload form */}
      <div className="card p-4">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Upload size={15} style={{ color }} />
          Upload {isPdf ? 'Circular' : 'Stylesheet'}
        </h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>Label *</label>
            <input className="input w-full" placeholder={isPdf ? 'e.g. Press Circular — June 2026' : 'e.g. News Stylesheet v3'}
              value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>
              <CalendarDays size={11} className="inline mr-1" />Date *
            </label>
            <input type="date" className="input w-full"
              value={form.circular_date} onChange={e => setForm(p => ({ ...p, circular_date: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--muted)' }}>
              File ({typeLabel}) *
            </label>
            <div
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 cursor-pointer transition-colors"
              style={{ borderColor: file ? color : 'var(--border)', background: file ? color + '10' : 'var(--bg)' }}
              onClick={() => fileRef.current?.click()}>
              {file ? (
                <>
                  <Icon size={22} style={{ color }} />
                  <div className="text-xs font-semibold mt-1 text-center">{file.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{fmtSize(file.size)}</div>
                </>
              ) : (
                <>
                  <Upload size={22} style={{ color: 'var(--muted)' }} />
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Click to select {typeLabel}</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept={accept} className="hidden"
              onChange={e => setFile(e.target.files[0] || null)} />
          </div>

          {err && <div className="text-xs p-2 rounded" style={{ background: '#d7192015', color: '#d71920' }}>{err}</div>}

          {busy && progress > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
                <span>Uploading…</span><span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, background: color }} />
              </div>
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
            {busy ? <><RefreshCw size={13} className="animate-spin" />Uploading…</> : <><Upload size={13} />Upload</>}
          </button>
        </form>
      </div>

      {/* Document list */}
      <div className="lg:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>{docs.length} document{docs.length !== 1 ? 's' : ''}</span>
          <button onClick={load} className="btn-ghost p-1.5" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-16 animate-pulse" />)}</div>
        ) : docs.length === 0 ? (
          <div className="card py-16 text-center">
            <Icon size={36} className="mx-auto mb-2 opacity-25" />
            <div className="font-semibold text-sm">No {isPdf ? 'circulars' : 'stylesheets'} uploaded yet</div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-alt, #f8f9fa)', borderBottom: '2px solid var(--border)' }}>
                  <th className="p-3 text-left font-semibold">Label</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Size</th>
                  <th className="p-3 text-left font-semibold">Uploaded</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {docs.map(doc => (
                  <tr key={doc.id} className="hover:bg-opacity-50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Icon size={15} style={{ color, flexShrink: 0 }} />
                        <span className="font-medium">{doc.label}</span>
                      </div>
                      <div className="text-xs mt-0.5 truncate max-w-[220px]" style={{ color: 'var(--muted)' }}>{doc.original_name}</div>
                    </td>
                    <td className="p-3 text-sm whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fmtDocDate(doc.circular_date)}</td>
                    <td className="p-3 text-sm whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fmtSize(doc.file_size)}</td>
                    <td className="p-3 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fmtDocDate(doc.uploaded_at)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setViewing(doc)}
                          className="btn-ghost p-1.5 text-xs flex items-center gap-1"
                          title="View">
                          <Eye size={13} />
                        </button>
                        <a
                          href={`/uploads/archive-docs/${doc.filename}`}
                          download={doc.original_name}
                          className="btn-ghost p-1.5 text-xs flex items-center gap-1"
                          title="Download">
                          <Download size={13} />
                        </a>
                        {isAdmin && (
                          <button
                            onClick={() => deleteDoc(doc.id)}
                            className="p-1.5 rounded-lg text-xs"
                            style={{ background: '#d7192015', color: '#d71920' }}
                            title="Delete">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

    {/* Document viewer modal */}
    {viewing && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <div className="absolute inset-0 bg-black/60" onClick={() => setViewing(null)} />
        <div className="relative z-10 flex flex-col w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl"
          style={{ height: '92vh', background: 'var(--surface)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
            style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <File size={16} style={{ color: isPdf ? '#d71920' : '#3b82f6', flexShrink: 0 }} />
              <span className="font-semibold text-sm truncate">{viewing.label}</span>
              <span className="text-xs ml-1 shrink-0 px-2 py-0.5 rounded-full"
                style={{ background: 'var(--border)', color: 'var(--muted)' }}>
                {fmtDocDate(viewing.circular_date)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a href={`/api/archive-docs/view/${viewing.filename}`} download={viewing.original_name}
                className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5">
                <Download size={13} /> Download
              </a>
              <button onClick={() => setViewing(null)} className="btn-ghost p-1.5 rounded-lg">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* PDF viewer */}
          {isPdf ? (
            <object
              key={viewing.id}
              data={`/api/archive-docs/view/${viewing.filename}`}
              type="application/pdf"
              className="flex-1 w-full"
              style={{ border: 'none', background: '#525659' }}>
              <div className="flex flex-col items-center justify-center h-full gap-3"
                style={{ color: 'var(--muted)' }}>
                <File size={48} className="opacity-30" />
                <p className="text-sm">Browser cannot display this PDF inline.</p>
                <a href={`/api/archive-docs/view/${viewing.filename}`} download={viewing.original_name}
                  className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
                  <Download size={14} /> Download PDF
                </a>
              </div>
            </object>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-4"
              style={{ color: 'var(--muted)' }}>
              <FileText size={52} className="opacity-25" />
              <p className="text-sm font-medium">DOC/DOCX files cannot be previewed in browser.</p>
              <a href={`/api/archive-docs/view/${viewing.filename}`} download={viewing.original_name}
                className="btn-primary flex items-center gap-2 text-sm px-5 py-2">
                <Download size={14} /> Download to Open
              </a>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Archive() {
  const { t, state: globalState, branch: globalBranch, user } = useApp();
  const isAdmin = user?.role === 'Admin';
  const [mainTab, setMainTab] = useState('media');

  const [files,      setFiles]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [viewMode,   setViewMode]   = useState('grid');
  const [typeTab,    setTypeTab]    = useState('all');
  const [catFilter,  setCatFilter]  = useState('');
  const [search,     setSearch]     = useState('');
  const [searchQ,    setSearchQ]    = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [locations,  setLocations]  = useState({ states: [], branches: {} });

  // Load locations for upload form
  useEffect(() => {
    fetch('/api/locations', { headers: authH() })
      .then(r => r.json())
      .then(d => setLocations(d))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeTab    !== 'all') params.set('type', typeTab);
    if (catFilter)            params.set('category', catFilter);
    if (searchQ)              params.set('q', searchQ);
    if (globalState  && globalState  !== 'All') params.set('state', globalState);
    if (globalBranch && globalBranch !== 'All') params.set('branch', globalBranch);
    params.set('limit', '200');

    fetch(`/api/archive?${params}`, { headers: authH() })
      .then(r => r.json())
      .then(d => { setFiles(d.files || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [typeTab, catFilter, searchQ, globalState, globalBranch]);

  useEffect(() => { load(); }, [load]);

  const typeTabs = [
    { key: 'all',   label: 'All',    count: total },
    { key: 'video', label: 'Video',  icon: FileVideo },
    { key: 'audio', label: 'Audio',  icon: FileAudio },
    { key: 'image', label: 'Photos', icon: Image },
  ];

  // Stats
  const stats = {
    video:      files.filter(f => f.file_type === 'video').length,
    audio:      files.filter(f => f.file_type === 'audio').length,
    image:      files.filter(f => f.file_type === 'image').length,
    transcribed:files.filter(f => f.transcript_status === 'done').length,
  };

  const MAIN_TABS = [
    { key: 'media',      label: 'Media Library',  icon: FileVideo },
    { key: 'circular',   label: 'Circular',        icon: File      },
    { key: 'stylesheet', label: 'Stylesheet',      icon: FileText  },
  ];

  return (
    <div>
      <PageHeader
        title={t('nav.archive')}
        subtitle="Media library · Circulars · Stylesheets"
      />

      {/* ── Top-level tab bar ─────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border mb-4" style={{ borderColor: 'var(--border)', width: 'fit-content' }}>
        {MAIN_TABS.map(tab => {
          const TI = tab.icon;
          return (
            <button key={tab.key}
              onClick={() => setMainTab(tab.key)}
              className="px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-colors"
              style={{
                background: mainTab === tab.key ? 'var(--brand)' : 'transparent',
                color:      mainTab === tab.key ? '#fff' : 'var(--muted)',
              }}>
              <TI size={14} />{tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Circular / Stylesheet tabs ────────────────────────────────────────── */}
      {mainTab === 'circular'   && <DocTab docType="circular" />}
      {mainTab === 'stylesheet' && <DocTab docType="stylesheet" />}

      {/* ── Media Library ─────────────────────────────────────────────────────── */}
      {mainTab === 'media' && (<>
        {/* Stats strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          {[
            { label: 'Videos',      value: stats.video,       color: '#d71920', icon: FileVideo },
            { label: 'Audio',       value: stats.audio,       color: '#C9A227', icon: FileAudio },
            { label: 'Photos',      value: stats.image,       color: '#16a34a', icon: Image },
            { label: 'Transcribed', value: stats.transcribed, color: '#3b82f6', icon: CheckCircle },
          ].map(s => {
            const SI = s.icon;
            return (
              <div key={s.label} className="card p-3 flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ background: s.color + '18' }}>
                  <SI size={18} style={{ color: s.color }} />
                </div>
                <div>
                  <div className="font-bold text-xl">{s.value}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {typeTabs.map(tab => {
              const TI = tab.icon;
              return (
                <button key={tab.key}
                  onClick={() => setTypeTab(tab.key)}
                  className="px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 transition-colors"
                  style={{
                    background: typeTab === tab.key ? 'var(--brand)' : 'transparent',
                    color:      typeTab === tab.key ? '#fff' : 'var(--muted)',
                  }}>
                  {TI && <TI size={13} />}{tab.label}
                </button>
              );
            })}
          </div>

          <select className="input py-1.5 text-sm" value={catFilter}
            onChange={e => setCatFilter(e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-2.5" style={{ color: 'var(--muted)' }} />
            <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Search title, tags, transcript…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setSearchQ(search)} />
            {search && (
              <button onClick={() => { setSearch(''); setSearchQ(''); }}
                className="absolute right-2 top-2" style={{ color: 'var(--muted)' }}>
                <X size={14} />
              </button>
            )}
          </div>
          {search && (
            <button onClick={() => setSearchQ(search)}
              className="btn-primary text-sm px-3 py-1.5 flex items-center gap-1.5">
              <Search size={13} />Search
            </button>
          )}

          <div className="flex rounded-lg overflow-hidden border ml-auto" style={{ borderColor: 'var(--border)' }}>
            <button onClick={() => setViewMode('grid')} className="px-2.5 py-1.5 transition-colors"
              style={{ background: viewMode === 'grid' ? 'var(--brand)' : 'transparent', color: viewMode === 'grid' ? '#fff' : 'var(--muted)' }}>
              <LayoutGrid size={15} />
            </button>
            <button onClick={() => setViewMode('list')} className="px-2.5 py-1.5 transition-colors"
              style={{ background: viewMode === 'list' ? 'var(--brand)' : 'transparent', color: viewMode === 'list' ? '#fff' : 'var(--muted)' }}>
              <List size={15} />
            </button>
          </div>

          <button onClick={() => setShowUpload(true)}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-1.5">
            <Upload size={14} /> Upload
          </button>
          <button onClick={load} className="btn-ghost p-1.5" title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* File list / grid */}
        {loading ? (
          <div className={`grid gap-3 ${viewMode === 'grid' ? 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4' : ''}`}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card animate-pulse" style={{ height: viewMode === 'grid' ? 200 : 52 }} />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="card py-16 text-center">
            <Upload size={40} className="mx-auto mb-3 opacity-30" />
            <div className="font-semibold mb-1">No files yet</div>
            <div className="text-sm mb-4" style={{ color: 'var(--muted)' }}>Upload videos, audio recordings, or photos to get started</div>
            <button onClick={() => setShowUpload(true)} className="btn-primary mx-auto flex items-center gap-2 text-sm px-5 py-2">
              <Upload size={14} /> Upload First File
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {files.map(f => <FileCard key={f.id} file={f} onClick={setSelected} />)}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-alt, #f8f9fa)', borderBottom: '2px solid var(--border)' }}>
                  <th className="p-3 text-left font-semibold">Title</th>
                  <th className="p-3 text-left font-semibold">Category</th>
                  <th className="p-3 text-left font-semibold">State / Branch</th>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Size</th>
                  <th className="p-3 text-left font-semibold">Transcript</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => <FileRow key={f.id} file={f} onClick={setSelected} />)}
              </tbody>
            </table>
          </div>
        )}

        {/* Modals */}
        {showUpload && (
          <UploadModal
            onClose={() => setShowUpload(false)}
            onUploaded={f => { setFiles(prev => [f, ...prev]); setTotal(t => t + 1); }}
            locations={locations}
          />
        )}
        {selected && (
          <DetailModal
            file={selected}
            onClose={() => setSelected(null)}
            onDeleted={id => { setFiles(prev => prev.filter(f => f.id !== id)); setTotal(t => t - 1); }}
            isAdmin={isAdmin}
          />
        )}
      </>)}
    </div>
  );
}
