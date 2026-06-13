import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Plus, X, CheckCircle2, Clock, AlertCircle, Ban, ChevronDown, ChevronUp
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api }   from '../api/client.js';
import { PageHeader, SectionCard } from '../components/UI.jsx';

const CATEGORIES = [
  'Page Planning', 'Story Assignment', 'Photo Coverage', 'Breaking News Follow-up',
  'Exclusive Story', 'Investigation / Khulasa', 'Interview Scheduling', 'Event Coverage',
  'QC Review', 'Edition Deadline', 'Bureau Visit', 'Reporter Appraisal',
  'Content Audit', 'Legal Follow-up', 'Special Edition', 'Advertisement Content', 'Other',
];

const PRIORITY = {
  high:   { label: 'High',   dot: '#ef4444', bg: '#fef2f2', text: '#b91c1c' },
  medium: { label: 'Medium', dot: '#f59e0b', bg: '#fffbeb', text: '#92400e' },
  low:    { label: 'Low',    dot: '#10b981', bg: '#f0fdf4', text: '#065f46' },
};

const STATUS = {
  pending:     { label: 'Pending',     Icon: Clock,        color: '#6b7280', bg: '#f3f4f6' },
  in_progress: { label: 'In Progress', Icon: AlertCircle,  color: '#3b82f6', bg: '#eff6ff' },
  completed:   { label: 'Completed',   Icon: CheckCircle2, color: '#16a34a', bg: '#f0fdf4' },
  cancelled:   { label: 'Cancelled',   Icon: Ban,          color: '#ef4444', bg: '#fef2f2' },
};

function PriorityBadge({ p }) {
  const c = PRIORITY[p] || PRIORITY.medium;
  return (
    <span style={{
      background: c.bg, color: c.text, fontSize: 11, padding: '2px 8px',
      borderRadius: 9999, fontWeight: 600, whiteSpace: 'nowrap'
    }}>
      {c.label}
    </span>
  );
}

function StatusBadge({ s }) {
  const c = STATUS[s] || STATUS.pending;
  return (
    <span style={{
      background: c.bg, color: c.color, fontSize: 11, padding: '2px 8px 2px 6px',
      borderRadius: 9999, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap'
    }}>
      <c.Icon size={11} /> {c.label}
    </span>
  );
}

// ── Create Task Modal ─────────────────────────────────────────────────────────
function CreateModal({ user, onClose, onDone }) {
  const [assignees, setAssignees] = useState([]);
  const [form, setForm] = useState({
    title: '', description: '', category: 'Story Assignment',
    priority: 'medium', assigned_to_pan: '', due_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    api.taskAssignees()
      .then(r => setAssignees(r.assignees || []))
      .catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title.trim())   return setErr('Title is required');
    if (!form.assigned_to_pan) return setErr('Please select an assignee');
    setErr('');
    setSaving(true);
    try {
      await api.createTask(form);
      onDone();
      onClose();
    } catch (e) {
      setErr(e.message || 'Failed to create task');
      setSaving(false);
    }
  };

  // Group assignees by state for optgroup display
  const byState = assignees.reduce((acc, a) => {
    const s = a.State || 'Other';
    if (!acc[s]) acc[s] = [];
    acc[s].push(a);
    return acc;
  }, {});
  const stateKeys = Object.keys(byState).sort();

  // Search filter
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? assignees.filter(a =>
        a.name?.toLowerCase().includes(search.toLowerCase()) ||
        a.Branch?.toLowerCase().includes(search.toLowerCase()) ||
        a.State?.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 540,
        padding: 24, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Create New Task</h3>
          <button onClick={onClose} style={{ color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              Title *
            </label>
            <input
              className="input" placeholder="Task title…"
              value={form.title} onChange={e => set('title', e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              Description
            </label>
            <textarea
              className="input" rows={3} placeholder="Optional details…"
              value={form.description} onChange={e => set('description', e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Category + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                Category
              </label>
              <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                Priority
              </label>
              <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          {/* Assign To */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              Assign To * {assignees.length > 0 && <span style={{ fontWeight: 400 }}>({assignees.length} active employees)</span>}
            </label>
            {/* Search box */}
            <input
              className="input"
              placeholder="Search name, branch, state…"
              value={search}
              onChange={e => { setSearch(e.target.value); set('assigned_to_pan', ''); }}
              style={{ marginBottom: 6 }}
            />
            <select
              className="input"
              value={form.assigned_to_pan}
              onChange={e => set('assigned_to_pan', e.target.value)}
            >
              <option value="">— Select Person —</option>
              {filtered
                ? filtered.map(a => (
                    <option key={a.pan_no} value={a.pan_no}>
                      {a.name} · {a.State}{a.Branch ? ` / ${a.Branch}` : ''}{a.designation ? ` (${a.designation})` : ''}{a.has_telegram ? ' 📱' : ''}
                    </option>
                  ))
                : stateKeys.map(s => (
                    <optgroup key={s} label={s}>
                      {byState[s].map(a => (
                        <option key={a.pan_no} value={a.pan_no}>
                          {a.name}{a.Branch ? ` · ${a.Branch}` : ''}{a.designation ? ` (${a.designation})` : ''}{a.has_telegram ? ' 📱' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))
              }
            </select>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>📱 = Telegram registered (will receive alert)</p>
          </div>

          {/* Due Date */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              Due Date
            </label>
            <input
              className="input" type="date"
              value={form.due_date} onChange={e => set('due_date', e.target.value)}
            />
          </div>

          {err && <p style={{ color: '#ef4444', fontSize: 12 }}>{err}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, canEdit, onRefresh }) {
  const [open,     setOpen]     = useState(false);
  const [updating, setUpdating] = useState(false);

  const nextStatus = { pending: 'in_progress', in_progress: 'completed' };
  const nextLabel  = { pending: 'Start Task',  in_progress: 'Mark Complete' };

  const changeStatus = async (s) => {
    setUpdating(true);
    try {
      await api.updateTask(task.id, { status: s });
      onRefresh();
    } catch (e) {
      alert('Failed: ' + e.message);
    } finally {
      setUpdating(false);
    }
  };

  const due     = task.due_date ? String(task.due_date).slice(0, 10) : null;
  const overdue = due && task.status === 'pending' && new Date(due) < new Date();
  const leftColor = STATUS[task.status]?.color || '#6b7280';

  return (
    <div
      style={{
        border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)',
        borderLeft: `4px solid ${leftColor}`, overflow: 'hidden',
      }}
    >
      {/* Summary row — always visible */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {task.category} · <b>{task.assigned_to_name}</b>
            {task.assigned_to_branch ? ` (${task.assigned_to_branch})` : task.assigned_to_state ? ` (${task.assigned_to_state})` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <PriorityBadge p={task.priority} />
          <StatusBadge   s={task.status}   />
          {open ? <ChevronUp size={15} style={{ color: 'var(--muted)' }} /> : <ChevronDown size={15} style={{ color: 'var(--muted)' }} />}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px 14px' }}>
          {task.description && (
            <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
              {task.description}
            </p>
          )}
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap', marginBottom: 10 }}>
            <span>From: {task.assigned_by_name || task.assigned_by}</span>
            {due && (
              <span style={{ color: overdue ? '#ef4444' : undefined }}>
                Due: {due}{overdue ? ' — Overdue' : ''}
              </span>
            )}
            {task.completed_at && <span>Completed: {String(task.completed_at).slice(0, 16).replace('T', ' ')}</span>}
            <span>Created: {String(task.created_at).slice(0, 10)}</span>
          </div>
          {canEdit && nextStatus[task.status] && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn-primary"
                style={{ fontSize: 12, padding: '5px 14px' }}
                disabled={updating}
                onClick={() => changeStatus(nextStatus[task.status])}
              >
                {updating ? '…' : nextLabel[task.status]}
              </button>
              {task.status === 'pending' && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '5px 14px', color: '#ef4444' }}
                  disabled={updating}
                  onClick={() => changeStatus('cancelled')}
                >
                  Cancel Task
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Tasks() {
  const { user } = useApp();

  const [tasks,       setTasks]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate,  setShowCreate]  = useState(false);

  const canCreate = ['Admin', 'State Head'].includes(user?.role);
  const canEdit   = ['Admin', 'State Head'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listTasks(statusFilter === 'all' ? null : statusFilter);
      setTasks(r.tasks || []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const counts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  const statusTabs = [
    ['all', 'All'],
    ['pending',     STATUS.pending.label],
    ['in_progress', STATUS.in_progress.label],
    ['completed',   STATUS.completed.label],
    ['cancelled',   STATUS.cancelled.label],
  ];

  return (
    <div>
      <PageHeader title="Task Management" subtitle="Assign and track newsroom tasks">
        {canCreate && (
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Task
          </button>
        )}
      </PageHeader>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {statusTabs.map(([key, label]) => {
          const count = key === 'all' ? tasks.length : (counts[key] || 0);
          const active = statusFilter === key;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              style={{
                padding: '5px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', border: '1px solid var(--border)',
                background: active ? 'var(--brand)' : 'var(--bg)',
                color:      active ? '#fff'          : 'var(--text)',
                transition: 'background 0.15s',
              }}
            >
              {label}{count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Summary KPIs */}
      {tasks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { key: 'pending',     label: 'Pending',     color: STATUS.pending.color },
            { key: 'in_progress', label: 'In Progress', color: STATUS.in_progress.color },
            { key: 'completed',   label: 'Completed',   color: STATUS.completed.color },
          ].map(({ key, label, color }) => (
            <div key={key} className="card p-4" style={{ borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 28, fontWeight: 700, color }}>{counts[key] || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Task list */}
      <SectionCard
        title={<span className="flex items-center gap-1.5"><ClipboardList size={14} /> Tasks</span>}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <ClipboardList size={36} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>
              {statusFilter === 'all'
                ? canCreate ? 'No tasks yet. Click "New Task" to create one.' : 'No tasks assigned to you.'
                : `No ${STATUS[statusFilter]?.label?.toLowerCase() || statusFilter} tasks.`}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tasks.map(t => (
              <TaskCard key={t.id} task={t} canEdit={canEdit} onRefresh={load} />
            ))}
          </div>
        )}
      </SectionCard>

      {showCreate && (
        <CreateModal
          user={user}
          onClose={() => setShowCreate(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
