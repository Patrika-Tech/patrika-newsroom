import { useState, useRef } from 'react';
import { API_BASE } from '../api/client.js';
import {
  Upload, FileText, Image, File, Sparkles, Copy, Check,
  Loader2, RotateCcw, ChevronDown, AlertCircle, Newspaper,
} from 'lucide-react';

const LENGTH_OPTIONS = [
  { value: 'short',    label: 'Short',    desc: '100–150 words' },
  { value: 'medium',   label: 'Medium',   desc: '150–200 words' },
  { value: 'detailed', label: 'Detailed', desc: '200–250 words' },
];

const ACCEPT = '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.bmp';

function fileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','webp','bmp'].includes(ext)) return <Image size={18} />;
  if (ext === 'pdf') return <FileText size={18} />;
  return <File size={18} />;
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} title="Copy" className="btn-ghost p-1.5 rounded-lg">
      {copied ? <Check size={14} style={{ color: '#059669' }} /> : <Copy size={14} />}
    </button>
  );
}

function Field({ label, value, multiline }) {
  if (!value) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</label>
        <CopyBtn text={value} />
      </div>
      {multiline
        ? <div className="rounded-xl border p-3 text-sm leading-relaxed whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>{value}</div>
        : <div className="rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>{value}</div>
      }
    </div>
  );
}

export default function NewsGenerator() {
  const [file,          setFile]          = useState(null);
  const [length,        setLength]        = useState('short');
  const [city,          setCity]          = useState('');
  const [valueEdition,  setValueEdition]  = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [result,        setResult]        = useState(null);
  const [dragging,      setDragging]      = useState(false);
  const inputRef = useRef();

  const handleFile = (f) => { if (f) { setFile(f); setResult(null); setError(''); } };

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const generate = async () => {
    if (!file) { setError('Please select a file first.'); return; }
    setLoading(true); setError(''); setResult(null);

    const fd = new FormData();
    fd.append('file',          file);
    fd.append('length',        length);
    fd.append('city',          city.trim());
    fd.append('value_edition', valueEdition ? '1' : '0');

    try {
      const token = localStorage.getItem('pk_token');
      const res   = await fetch(`${API_BASE}/news-generator`, {
        method:  'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(''); };

  const copyAll = () => {
    if (!result) return;
    const parts = [
      `शीर्षक: ${result.headline}`,
      `उप-शीर्षक: ${result.sub_headline}`,
      `\n${result.text}`,
    ];
    if (result.ve_headline) parts.push(`\nValue Edition शीर्षक: ${result.ve_headline}`);
    if (result.ve_text)     parts.push(result.ve_text);
    navigator.clipboard.writeText(parts.join('\n'));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl p-2.5" style={{ background: '#7c3aed20' }}>
          <Newspaper size={22} style={{ color: '#7c3aed' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold">News Generator</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Upload a file — get Hindi news instantly</p>
        </div>
      </div>

      {/* ── Input card ── */}
      <div className="card p-5 space-y-5">

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !file && inputRef.current?.click()}
          className="rounded-2xl border-2 border-dashed transition cursor-pointer"
          style={{
            borderColor: dragging ? 'var(--brand)' : 'var(--border)',
            background:  dragging ? 'var(--brand)10' : 'var(--bg)',
            padding: file ? '16px' : '40px',
          }}
        >
          {file ? (
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ background: 'var(--brand)', color: '#fff' }}>
                {fileIcon(file.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{file.name}</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button onClick={e => { e.stopPropagation(); reset(); }}
                className="btn-ghost px-2 py-1 text-xs rounded-lg">
                Remove
              </button>
            </div>
          ) : (
            <div className="text-center space-y-2">
              <Upload size={28} className="mx-auto" style={{ color: 'var(--muted)' }} />
              <p className="text-sm font-medium">Drop file here or click to browse</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>PDF, DOCX, DOC, TXT, JPG, PNG, WEBP — max 20 MB</p>
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
          onChange={e => handleFile(e.target.files[0])} />

        {/* Options row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Length */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>News Length</label>
            <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {LENGTH_OPTIONS.map(opt => (
                <button key={opt.value}
                  onClick={() => setLength(opt.value)}
                  className="flex-1 py-2 text-xs font-semibold transition"
                  style={{
                    background: length === opt.value ? 'var(--brand)' : 'transparent',
                    color:      length === opt.value ? '#fff' : 'var(--text)',
                  }}>
                  {opt.label}
                  <span className="block text-[10px] opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* City */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>City (for byline)</label>
            <input
              className="input w-full py-2 text-sm"
              placeholder="e.g. जयपुर"
              value={city}
              onChange={e => setCity(e.target.value)}
            />
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
              Byline: <span className="font-mono">{city.trim() ? `${city.trim()}@पत्रिका` : '@पत्रिका'}</span>
            </p>
          </div>

          {/* Value Edition toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Value Edition</label>
            <button
              onClick={() => setValueEdition(v => !v)}
              className="w-full rounded-xl border flex items-center gap-3 px-3 py-2.5 transition"
              style={{
                borderColor: valueEdition ? 'var(--brand)' : 'var(--border)',
                background:  valueEdition ? 'var(--brand)15' : 'transparent',
              }}>
              <div className="w-9 h-5 rounded-full flex items-center transition-all"
                style={{ background: valueEdition ? 'var(--brand)' : 'var(--muted)', padding: '2px' }}>
                <div className="w-4 h-4 bg-white rounded-full transition-all"
                  style={{ transform: valueEdition ? 'translateX(16px)' : 'translateX(0)' }} />
              </div>
              <span className="text-sm font-medium">{valueEdition ? 'Enabled' : 'Disabled'}</span>
            </button>
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>55–65 words summary version</p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: '#dc262615', color: '#dc2626' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={generate}
          disabled={!file || loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition disabled:opacity-40"
          style={{ background: 'var(--brand)' }}>
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
            : <><Sparkles size={16} /> Generate Hindi News</>}
        </button>
      </div>

      {/* ── Result card ── */}
      {result && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base">Generated News</h2>
            <div className="flex items-center gap-2">
              <button onClick={copyAll} className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium">
                <Copy size={13} /> Copy All
              </button>
              <button onClick={reset} className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium">
                <RotateCcw size={13} /> New
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <Field label="शीर्षक (Headline)"          value={result.headline} />
            <Field label="उप-शीर्षक (Sub-Headline)"   value={result.sub_headline} />
            <Field label="समाचार पाठ (News Text)"      value={result.text} multiline />

            {(result.ve_headline || result.ve_text) && (
              <>
                <hr style={{ borderColor: 'var(--border)' }} />
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--brand)' }}>Value Edition</p>
                <Field label="Value Edition शीर्षक"   value={result.ve_headline} />
                <Field label="Value Edition पाठ"      value={result.ve_text} multiline />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
