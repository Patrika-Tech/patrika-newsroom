import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import {
  MessageSquare, Send, Trash2, CheckCircle, Clock, AlertCircle,
  ChevronDown, RefreshCw, Filter, X
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────
const TYPES     = ['Addition', 'Modification', 'Bug Report', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const STATUSES  = ['New', 'Reviewed', 'Done'];

const PRIORITY_COLOR = {
  Low:    { bg: '#d1fae515', border: '#10b98130', text: '#10b981' },
  Medium: { bg: '#fef3c715', border: '#f59e0b30', text: '#f59e0b' },
  High:   { bg: '#fee2e215', border: '#ef444430', text: '#ef4444' },
};
const STATUS_COLOR = {
  New:      { bg: '#eff6ff', border: '#3b82f630', text: '#3b82f6' },
  Reviewed: { bg: '#fef3c7', border: '#f59e0b30', text: '#d97706' },
  Done:     { bg: '#d1fae5', border: '#10b98130', text: '#059669' },
};

function Badge({ label, colors }) {
  return (
    <span style={{
      background: colors.bg, border: `1px solid ${colors.border}`,
      color: colors.text, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
    }}>{label}</span>
  );
}

// ── Submit Form ───────────────────────────────────────────────────────────────
function FeedbackForm({ onSubmitted }) {
  const [form, setForm]     = useState({ type: 'Other', subject: '', description: '', priority: 'Medium' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.description.trim()) {
      setError('Subject and description are required.'); return;
    }
    setSaving(true); setError(null);
    try {
      const created = await api.createFeedback(form);
      setForm({ type: 'Other', subject: '', description: '', priority: 'Medium' });
      onSubmitted(created);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, display: 'block' };
  const selectStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 14,
    border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
    outline: 'none',
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: 24,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>
        Submit Feedback
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Type */}
        <div>
          <label style={labelStyle}>Type</label>
          <div style={{ position: 'relative' }}>
            <select value={form.type} onChange={e => set('type', e.target.value)} style={selectStyle}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: 11, color: 'var(--muted)', pointerEvents: 'none' }} />
          </div>
        </div>
        {/* Priority */}
        <div>
          <label style={labelStyle}>Priority</label>
          <div style={{ position: 'relative' }}>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} style={selectStyle}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: 11, color: 'var(--muted)', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>

      {/* Subject */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Subject</label>
        <input
          value={form.subject}
          onChange={e => set('subject', e.target.value)}
          placeholder="Brief description of your request…"
          style={{ ...selectStyle, padding: '9px 12px' }}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Details</label>
        <textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          rows={5}
          placeholder="Describe the addition or modification you need in detail…"
          style={{ ...selectStyle, resize: 'vertical', lineHeight: 1.6 }}
        />
      </div>

      {error && (
        <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>❌ {error}</p>
      )}

      <button
        type="submit" disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
          background: saving ? '#94a3b8' : 'var(--brand)', color: '#fff', fontWeight: 600, fontSize: 14,
        }}
      >
        <Send size={15} /> {saving ? 'Submitting…' : 'Submit Feedback'}
      </button>
    </form>
  );
}

// ── Feedback Card ─────────────────────────────────────────────────────────────
function FeedbackCard({ item, isAdmin, onUpdate, onDelete }) {
  const [editing, setEditing]   = useState(false);
  const [note, setNote]         = useState(item.admin_note || '');
  const [status, setStatus]     = useState(item.status);
  const [saving, setSaving]     = useState(false);

  const saveAdmin = async () => {
    setSaving(true);
    try {
      const updated = await api.updateFeedback(item.id, { status, admin_note: note });
      onUpdate(updated);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const formatDate = (dt) => {
    if (!dt) return '';
    return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const priColors = PRIORITY_COLOR[item.priority] || PRIORITY_COLOR.Medium;
  const stColors  = STATUS_COLOR[item.status]     || STATUS_COLOR.New;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 20, marginBottom: 12,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{item.subject}</span>
            <Badge label={item.type}     colors={{ bg: '#f1f5f915', border: 'var(--border)', text: 'var(--muted)' }} />
            <Badge label={item.priority} colors={priColors} />
            <Badge label={item.status}   colors={stColors} />
          </div>
          {isAdmin && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {item.name} · {item.role}{item.branch ? ` · ${item.branch}` : ''}{item.state ? ` · ${item.state}` : ''}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{formatDate(item.created_at)}</div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setEditing(e => !e); setNote(item.admin_note || ''); setStatus(item.status); }}
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}
            >{editing ? 'Cancel' : 'Review'}</button>
            <button
              onClick={() => onDelete(item.id)}
              style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #fca5a530', background: '#fee2e215', color: '#ef4444', cursor: 'pointer' }}
            ><Trash2 size={13} /></button>
          </div>
        )}
      </div>

      {/* Description */}
      <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, marginBottom: item.admin_note || editing ? 12 : 0 }}>
        {item.description}
      </p>

      {/* Admin note (read) */}
      {item.admin_note && !editing && (
        <div style={{ background: '#f0fdf415', border: '1px solid #bbf7d030', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: '#059669' }}>Admin Note: </span>
          <span style={{ color: 'var(--text)' }}>{item.admin_note}</span>
        </div>
      )}

      {/* Admin edit panel */}
      {editing && (
        <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Status</label>
              <div style={{ position: 'relative' }}>
                <select
                  value={status} onChange={e => setStatus(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                >
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Admin Note</label>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            rows={3} placeholder="Add a note or response for the submitter…"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <button
            onClick={saveAdmin} disabled={saving}
            style={{ marginTop: 10, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff', fontWeight: 600, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer' }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FeedbackPage() {
  const { user }                    = useApp();
  const isAdmin                     = user?.role === 'Admin';

  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [submitted, setSubmitted]   = useState(false);
  const [filterStatus, setFilter]   = useState('All');

  const load = async () => {
    setLoading(true);
    try { setItems(await api.listFeedback()); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSubmitted = (created) => {
    setItems(prev => [created, ...prev]);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 4000);
  };

  const handleUpdate = (updated) => {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this feedback?')) return;
    try {
      await api.deleteFeedback(id);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch { /* ignore */ }
  };

  const filtered = filterStatus === 'All' ? items : items.filter(i => i.status === filterStatus);

  // Status counts for admin filter tabs
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: items.filter(i => i.status === s).length }), {});

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MessageSquare size={22} style={{ color: 'var(--brand)' }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Feedback</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {isAdmin ? 'All submitted feedback and requests' : 'Submit requests for additions or modifications'}
            </p>
          </div>
        </div>
        <button onClick={load} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Success banner */}
      {submitted && (
        <div style={{ background: '#d1fae5', border: '1px solid #10b98130', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={16} style={{ color: '#10b981' }} />
          <span style={{ fontSize: 14, color: '#065f46', fontWeight: 500 }}>Feedback submitted successfully!</span>
        </div>
      )}

      {/* Submit form — visible to non-admin users and also admins */}
      {!isAdmin && (
        <div style={{ marginBottom: 28 }}>
          <FeedbackForm onSubmitted={handleSubmitted} />
        </div>
      )}

      {/* Admin: filter tabs */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {['All', ...STATUSES].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: filterStatus === s ? 700 : 400,
                background: filterStatus === s ? 'var(--brand)' : 'transparent',
                color: filterStatus === s ? '#fff' : 'var(--text)',
              }}
            >
              {s} {s !== 'All' && counts[s] > 0 && <span style={{ opacity: 0.8 }}>({counts[s]})</span>}
              {s === 'All' && <span style={{ opacity: 0.8 }}> ({items.length})</span>}
            </button>
          ))}
        </div>
      )}

      {/* Feedback list */}
      <div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px' }} />
            <p>Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 64, color: 'var(--muted)' }}>
            <MessageSquare size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ fontSize: 15, fontWeight: 500 }}>
              {isAdmin ? 'No feedback found' : 'No feedback submitted yet'}
            </p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              {isAdmin ? 'Use the filter above to check other statuses.' : 'Use the form above to submit your first request.'}
            </p>
          </div>
        ) : (
          <>
            {isAdmin && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>
                  {filtered.length} FEEDBACK{filtered.length !== 1 ? 'S' : ''}
                </h3>
              </div>
            )}
            {!isAdmin && filtered.length > 0 && (
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>YOUR SUBMISSIONS</h3>
            )}
            {filtered.map(item => (
              <FeedbackCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
