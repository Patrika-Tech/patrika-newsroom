import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClipboardList, Plus, X, CheckCircle2, Clock, AlertCircle, Ban,
  ChevronDown, ChevronUp, Users, BarChart2, MessageSquare, Send,
  Trash2, Edit2, UserPlus, Star, Loader2, Calendar,
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

const GROUP_TYPES = ['RE', 'Chief Reporter', 'Desk Head', 'Mixed'];

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

const GRADE_COLOR = { A: '#16a34a', B: '#3b82f6', C: '#f59e0b', D: '#ef4444' };

function PriorityBadge({ p }) {
  const c = PRIORITY[p] || PRIORITY.medium;
  return (
    <span style={{ background: c.bg, color: c.text, fontSize: 11, padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

function StatusBadge({ s }) {
  const c = STATUS[s] || STATUS.pending;
  return (
    <span style={{ background: c.bg, color: c.color, fontSize: 11, padding: '2px 8px 2px 6px', borderRadius: 9999, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <c.Icon size={11} /> {c.label}
    </span>
  );
}

// ── Assign-to selector (shared between single & bulk modals) ─────────────────
function AssignSelector({ assignees, groups, value, groupValue, mode, onMode, onPan, onGroup }) {
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? assignees.filter(a =>
        a.name?.toLowerCase().includes(search.toLowerCase()) ||
        a.Branch?.toLowerCase().includes(search.toLowerCase()) ||
        a.State?.toLowerCase().includes(search.toLowerCase())
      )
    : null;
  const byState = assignees.reduce((acc, a) => {
    const s = a.State || 'Other'; if (!acc[s]) acc[s] = []; acc[s].push(a); return acc;
  }, {});

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
        Assign To *
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {['individual', 'group'].map(m => (
          <button key={m} type="button" onClick={() => onMode(m)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: '1.5px solid ' + (mode === m ? 'var(--brand)' : 'var(--border)'),
              background: mode === m ? 'var(--brand)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text)', cursor: 'pointer',
            }}>
            {m === 'individual' ? '👤 Individual' : '👥 Group'}
          </button>
        ))}
      </div>

      {mode === 'individual' ? (
        <>
          <input className="input" placeholder="Search name, branch, state…" value={search}
            onChange={e => { setSearch(e.target.value); onPan(''); }} style={{ marginBottom: 6 }} />
          <select className="input" value={value} onChange={e => onPan(e.target.value)}>
            <option value="">— Select Person —</option>
            {filtered
              ? filtered.map(a => (
                  <option key={a.pan_no} value={a.pan_no}>
                    {a.name} · {a.State}{a.Branch ? `/${a.Branch}` : ''}{a.designation ? ` (${a.designation})` : ''}{a.has_telegram ? ' 📱' : ''}
                  </option>
                ))
              : Object.keys(byState).sort().map(s => (
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
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>📱 = Telegram registered</p>
        </>
      ) : (
        <select className="input" value={groupValue} onChange={e => onGroup(e.target.value)}>
          <option value="">— Select Group —</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.name} ({g.member_count} members) · {g.type}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Create Task Modal (supports bulk + group) ─────────────────────────────────
function CreateModal({ user, onClose, onDone }) {
  const [assignees, setAssignees] = useState([]);
  const [groups,    setGroups]    = useState([]);
  const [mode,      setMode]      = useState('individual'); // individual | group
  const [pan,       setPan]       = useState('');
  const [group,     setGroup]     = useState('');
  const [shared,    setShared]    = useState({ category: 'Story Assignment', priority: 'medium', due_date: '' });
  const [tasks,     setTasks]     = useState([{ title: '', description: '' }]);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    api.taskAssignees().then(r => setAssignees(r.assignees || [])).catch(() => {});
    api.listTaskGroups().then(r => setGroups(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const setTask = (i, k, v) => setTasks(ts => ts.map((t, idx) => idx === i ? { ...t, [k]: v } : t));
  const addTask = () => setTasks(ts => [...ts, { title: '', description: '' }]);
  const removeTask = i => setTasks(ts => ts.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (tasks.every(t => !t.title.trim())) return setErr('At least one task title is required');
    if (mode === 'individual' && !pan) return setErr('Please select an assignee');
    if (mode === 'group' && !group) return setErr('Please select a group');
    setErr(''); setSaving(true);
    try {
      const payload = {
        ...shared,
        tasks: tasks.filter(t => t.title.trim()),
        assigned_to_pan:   mode === 'individual' ? pan   : undefined,
        assigned_to_group: mode === 'group'      ? group : undefined,
      };
      const r = await api.createTask(payload);
      onDone();
      onClose();
      if (r.count > 1) alert(`✅ ${r.count} tasks created successfully!`);
    } catch (e) {
      setErr(e.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 580, padding: 24, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Create Task(s)</h3>
          <button onClick={onClose} style={{ color: 'var(--muted)', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Task list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Tasks *</label>
              <button type="button" onClick={addTask}
                style={{ fontSize: 11, color: 'var(--brand)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Plus size={12} /> Add Another Task
              </button>
            </div>
            {tasks.map((t, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 16 }}>#{i + 1}</span>
                  <input className="input" style={{ flex: 1 }} placeholder="Task title *"
                    value={t.title} onChange={e => setTask(i, 'title', e.target.value)} />
                  {tasks.length > 1 && (
                    <button type="button" onClick={() => removeTask(i)} style={{ color: '#ef4444', cursor: 'pointer' }}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <textarea className="input" rows={2} placeholder="Description (optional)"
                  value={t.description} onChange={e => setTask(i, 'description', e.target.value)}
                  style={{ resize: 'vertical', width: '100%', fontSize: 12 }} />
              </div>
            ))}
          </div>

          {/* Category + Priority + Due Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Category</label>
              <select className="input" value={shared.category} onChange={e => setShared(s => ({ ...s, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Priority</label>
              <select className="input" value={shared.priority} onChange={e => setShared(s => ({ ...s, priority: e.target.value }))}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Due Date</label>
              <input className="input" type="date" value={shared.due_date}
                onChange={e => setShared(s => ({ ...s, due_date: e.target.value }))} />
            </div>
          </div>

          {/* Assign to */}
          <AssignSelector
            assignees={assignees} groups={groups}
            value={pan} groupValue={group} mode={mode}
            onMode={setMode} onPan={setPan} onGroup={setGroup}
          />

          {tasks.length > 1 || group ? (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#1d4ed8' }}>
              ℹ️ {tasks.length > 1 ? `${tasks.filter(t => t.title.trim()).length} tasks` : '1 task'} will be created
              {group ? ` for each member of the selected group` : ` for the selected person`}.
            </div>
          ) : null}

          {err && <p style={{ color: '#ef4444', fontSize: 12 }}>{err}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex items-center gap-2" onClick={submit} disabled={saving}>
              {saving ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : <><Plus size={13} /> Create Task(s)</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Comments Panel ────────────────────────────────────────────────────────────
function CommentsPanel({ task, user }) {
  const [comments,  setComments]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [comment,   setComment]   = useState('');
  const [statusUpd, setStatusUpd] = useState('');
  const [saving,    setSaving]    = useState(false);
  const bottomRef = useRef();

  const load = () => {
    setLoading(true);
    api.taskComments(task.id).then(r => { setComments(r.comments || []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, [task.id]); // eslint-disable-line

  const submit = async () => {
    if (!comment.trim()) return;
    setSaving(true);
    try {
      await api.addTaskComment({ task_id: task.id, comment: comment.trim(), status_update: statusUpd || undefined });
      setComment(''); setStatusUpd('');
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const isAssignee = user?.sub === task.assigned_to_pan || user?.name === task.assigned_to_name;

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
        <MessageSquare size={11} /> COMMENTS {comments.length > 0 && `(${comments.length})`}
      </p>

      {loading ? <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</p> : (
        <>
          {comments.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>No comments yet.</p>}
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
            {comments.map(c => (
              <div key={c.id} style={{ marginBottom: 8, padding: '6px 10px', background: 'var(--bg)', borderRadius: 7, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontWeight: 600 }}>{c.commenter_name || c.commenter_pan}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{String(c.created_at).slice(0, 16).replace('T', ' ')}</span>
                </div>
                {c.status_update && (
                  <StatusBadge s={c.status_update} />
                )}
                <p style={{ marginTop: 3, color: 'var(--text)', lineHeight: 1.5 }}>{c.comment}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Add comment — anyone with access */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              className="input" rows={2} placeholder="Add a comment…"
              value={comment} onChange={e => setComment(e.target.value)}
              style={{ resize: 'none', fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Assignee can update status */}
              {isAssignee && task.status !== 'completed' && task.status !== 'cancelled' && (
                <select className="input" style={{ flex: 1, fontSize: 12 }} value={statusUpd} onChange={e => setStatusUpd(e.target.value)}>
                  <option value="">No status change</option>
                  {task.status === 'pending'     && <option value="in_progress">Mark: In Progress</option>}
                  {task.status === 'in_progress' && <option value="completed">Mark: Completed</option>}
                  <option value="cancelled">Mark: Cancelled</option>
                </select>
              )}
              <button
                onClick={submit} disabled={saving || !comment.trim()}
                className="btn-primary flex items-center gap-1"
                style={{ fontSize: 12, padding: '5px 12px', flexShrink: 0 }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {saving ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, canEdit, onRefresh }) {
  const { user } = useApp();
  const [open,     setOpen]     = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showDel,  setShowDel]  = useState(false);

  const changeStatus = async (s) => {
    setUpdating(true);
    try { await api.updateTask(task.id, { status: s }); onRefresh(); }
    catch (e) { alert('Failed: ' + e.message); }
    finally { setUpdating(false); }
  };

  const deleteTask = async () => {
    if (!confirm('Delete this task?')) return;
    try { await api.deleteTask(task.id); onRefresh(); }
    catch (e) { alert(e.message); }
  };

  const due     = task.due_date ? String(task.due_date).slice(0, 10) : null;
  const overdue = due && ['pending','in_progress'].includes(task.status) && new Date(due) < new Date();
  const dueIn3  = due && ['pending','in_progress'].includes(task.status) &&
    (new Date(due) - new Date()) / 86400000 <= 3 && !overdue;

  const isCreator  = user?.sub === task.assigned_by;
  const isAssignee = user?.sub === task.assigned_to_pan;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', borderLeft: `4px solid ${STATUS[task.status]?.color || '#6b7280'}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {task.category} · <b>{task.assigned_to_name}</b>
            {task.assigned_to_branch ? ` (${task.assigned_to_branch})` : task.assigned_to_state ? ` (${task.assigned_to_state})` : ''}
            {due && <span style={{ marginLeft: 8, color: overdue ? '#ef4444' : dueIn3 ? '#f59e0b' : 'var(--muted)' }}>
              📅 {due}{overdue ? ' ⚠️ Overdue' : dueIn3 ? ' ⚡ Due Soon' : ''}
            </span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <PriorityBadge p={task.priority} />
          <StatusBadge   s={task.status}   />
          {open ? <ChevronUp size={15} style={{ color: 'var(--muted)' }} /> : <ChevronDown size={15} style={{ color: 'var(--muted)' }} />}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px 14px' }}>
          {task.description && (
            <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{task.description}</p>
          )}
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap', marginBottom: 10 }}>
            <span>From: {task.assigned_by_name || task.assigned_by}</span>
            {task.completed_at && <span>Completed: {String(task.completed_at).slice(0, 16).replace('T', ' ')}</span>}
            <span>Created: {String(task.created_at).slice(0, 10)}</span>
          </div>

          {/* Quick status actions for assignee */}
          {isAssignee && task.status === 'pending' && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '5px 14px', marginBottom: 8 }}
              disabled={updating} onClick={() => changeStatus('in_progress')}>
              {updating ? '…' : '▶ Start Task'}
            </button>
          )}
          {isAssignee && task.status === 'in_progress' && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '5px 14px', marginBottom: 8 }}
              disabled={updating} onClick={() => changeStatus('completed')}>
              {updating ? '…' : '✅ Mark Complete'}
            </button>
          )}
          {/* Creator cancel/delete */}
          {(canEdit || isCreator) && task.status === 'pending' && (
            <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 14px', color: '#ef4444', marginLeft: 6 }}
              disabled={updating} onClick={() => changeStatus('cancelled')}>
              Cancel
            </button>
          )}
          {(canEdit || isCreator) && (
            <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px', color: '#ef4444', marginLeft: 6 }}
              onClick={deleteTask}>
              <Trash2 size={12} />
            </button>
          )}

          <CommentsPanel task={task} user={user} />
        </div>
      )}
    </div>
  );
}

// ── Groups Tab ────────────────────────────────────────────────────────────────
function GroupsTab({ canEdit }) {
  const [groups,    setGroups]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null); // group object with members
  const [showForm,  setShowForm]  = useState(false);
  const [assignees, setAssignees] = useState([]);
  const [search,    setSearch]    = useState('');

  const loadGroups = () => {
    setLoading(true);
    api.listTaskGroups().then(r => { setGroups(Array.isArray(r) ? r : []); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => {
    loadGroups();
    if (canEdit) api.taskAssignees().then(r => setAssignees(r.assignees || [])).catch(() => {});
  }, []); // eslint-disable-line

  const openGroup = async (g) => {
    const detail = await api.getTaskGroup(g.id).catch(() => null);
    setSelected(detail?.group || g);
  };

  const deleteGroup = async (g) => {
    if (!confirm(`Delete group "${g.name}"? All member links will be removed.`)) return;
    await api.deleteTaskGroup(g.id).catch(e => alert(e.message));
    setSelected(null); loadGroups();
  };

  const removeMember = async (pan_no) => {
    await api.removeGroupMember(selected.id, pan_no).catch(e => alert(e.message));
    openGroup(selected);
  };

  const addMembersFromSearch = async (selectedPans) => {
    if (!selectedPans.length) return;
    await api.addGroupMembers(selected.id, selectedPans).catch(e => alert(e.message));
    openGroup(selected);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '260px 1fr' : '1fr', gap: 16 }}>
      {/* Group list */}
      <SectionCard
        title={`Groups (${groups.length})`}
        action={canEdit && (
          <button className="btn-primary flex items-center gap-1 text-sm px-3 py-1" onClick={() => setShowForm(true)}>
            <Plus size={13} /> New Group
          </button>
        )}
      >
        {loading ? <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Loading…</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {groups.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No groups yet. Create one to get started.</p>}
            {groups.map(g => (
              <button key={g.id} onClick={() => openGroup(g)}
                style={{
                  textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid',
                  borderColor: selected?.id === g.id ? 'var(--brand)' : 'var(--border)',
                  background: selected?.id === g.id ? '#eff6ff' : 'var(--bg)',
                  cursor: 'pointer',
                }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {g.type} · {g.member_count} members
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Group detail */}
      {selected && (
        <SectionCard
          title={selected.name}
          action={
            <div style={{ display: 'flex', gap: 6 }}>
              {canEdit && <AddMembersDropdown assignees={assignees} members={selected.members || []} onAdd={addMembersFromSearch} />}
              {canEdit && <button className="btn-ghost px-2" style={{ color: '#ef4444' }} onClick={() => deleteGroup(selected)}><Trash2 size={14} /></button>}
              <button className="btn-ghost px-2" onClick={() => setSelected(null)}><X size={14} /></button>
            </div>
          }
        >
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Type: <b>{selected.type || '—'}</b> · {selected.description || ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(!selected.members || selected.members.length === 0) && (
              <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No members yet. Click "+ Add Members" to add.</p>
            )}
            {(selected.members || []).map(m => (
              <div key={m.pan_no} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg)', borderRadius: 7 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m.emp_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{m.branch || m.state || ''}{m.telegram_chat_id ? ' 📱' : ''}</span>
                </div>
                {canEdit && (
                  <button onClick={() => removeMember(m.pan_no)} style={{ color: '#ef4444', cursor: 'pointer' }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {showForm && <GroupForm onClose={() => setShowForm(false)} onDone={(msg) => { setShowForm(false); loadGroups(); if (msg) alert('✅ Group created!' + msg); }} />}
    </div>
  );
}

function AddMembersDropdown({ assignees, members, onAdd }) {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState('');
  const [sel,     setSel]     = useState([]);
  const memberPans = new Set(members.map(m => m.pan_no));
  const available = assignees.filter(a => !memberPans.has(a.pan_no) &&
    (!search || a.name?.toLowerCase().includes(search.toLowerCase()) ||
     a.Branch?.toLowerCase().includes(search.toLowerCase())));

  const toggle = (pan) => setSel(s => s.includes(pan) ? s.filter(p => p !== pan) : [...s, pan]);

  const doAdd = () => { onAdd(sel); setSel([]); setOpen(false); };

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn-primary flex items-center gap-1 text-sm px-3 py-1" onClick={() => setOpen(o => !o)}>
        <UserPlus size={13} /> Add Members
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, width: 280, zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          <input className="input mb-2" style={{ fontSize: 12 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
            {available.slice(0, 50).map(a => (
              <label key={a.pan_no} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px', cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={sel.includes(a.pan_no)} onChange={() => toggle(a.pan_no)} />
                {a.name}{a.Branch ? ` · ${a.Branch}` : ''}{a.has_telegram ? ' 📱' : ''}
              </label>
            ))}
            {available.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 8 }}>No available members</p>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-ghost" style={{ flex: 1, fontSize: 12 }} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" style={{ flex: 1, fontSize: 12 }} disabled={!sel.length} onClick={doAdd}>
              Add {sel.length > 0 ? `(${sel.length})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const AUTO_MEMBER_TYPES = ['RE', 'Chief Reporter', 'Desk Head'];

function GroupForm({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', description: '', type: 'RE' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!form.name.trim()) return setErr('Group name is required');
    setSaving(true);
    try {
      const r = await api.createTaskGroup(form);
      const autoMsg = r.auto_members > 0 ? ` ${r.auto_members} members auto-added from employee records.` : '';
      onDone(autoMsg);
    }
    catch (e) { setErr(e.message); setSaving(false); }
  };

  const isAutoType = AUTO_MEMBER_TYPES.includes(form.type);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontWeight: 700, fontSize: 15 }}>Create Group</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Group Name *</label>
            <input className="input" placeholder="e.g. MP RE Group" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Type</label>
            <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {GROUP_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            {isAutoType && (
              <p style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>
                ✅ All active <b>{form.type}</b> employees will be auto-added as members.
              </p>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Description</label>
            <input className="input" placeholder="Optional description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          {err && <p style={{ color: '#ef4444', fontSize: 12 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Report & Grading Tab ──────────────────────────────────────────────────────
function ReportTab() {
  const { user } = useApp();
  const [period, setPeriod] = useState('weekly');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.taskReport({ period, state: user?.role === 'State Head' ? user.state : undefined })
      .then(setReport).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [period, user]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const gradeStyle = (g) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 26, height: 26, borderRadius: '50%', fontWeight: 800, fontSize: 13,
    background: (GRADE_COLOR[g] || '#6b7280') + '22',
    color: GRADE_COLOR[g] || '#6b7280',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {[['weekly', 'This Week'], ['monthly', 'This Month']].map(([val, lbl]) => (
          <button key={val} onClick={() => setPeriod(val)}
            style={{
              padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: period === val ? 'var(--brand)' : 'var(--bg)',
              color: period === val ? '#fff' : 'var(--text)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}>
            {lbl}
          </button>
        ))}
        <button onClick={load} className="btn-ghost px-3 py-1 text-sm ml-2">Refresh</button>
      </div>

      {/* Summary KPIs */}
      {report?.summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Total',       val: report.summary.total,       color: '#6b7280' },
            { label: 'Completed',   val: report.summary.completed,   color: '#16a34a' },
            { label: 'In Progress', val: report.summary.in_progress, color: '#3b82f6' },
            { label: 'Pending',     val: report.summary.pending,     color: '#f59e0b' },
          ].map(({ label, val, color }) => (
            <div key={label} className="card p-3" style={{ borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 24, fontWeight: 700, color }}>{val || 0}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <SectionCard title="Employee Grading">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading…</div>
        ) : !report?.report?.length ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>No task data for this period.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Employee</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Branch</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center' }}>Total</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center' }}>Done</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center' }}>On-time</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center' }}>Overdue</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center' }}>Rate</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center' }}>Grade</th>
                </tr>
              </thead>
              <tbody>
                {report.report.map((r, i) => (
                  <tr key={r.assigned_to_pan} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{r.assigned_to_name}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{r.assigned_to_branch || r.assigned_to_state || '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>{r.total}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>{r.completed}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', color: '#3b82f6' }}>{r.on_time}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', color: r.overdue > 0 ? '#ef4444' : 'var(--muted)' }}>{r.overdue}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>{r.completion_rate}%</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                      <span style={gradeStyle(r.grade)}>{r.grade}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, padding: '0 4px' }}>
              Grade: <b style={{ color: GRADE_COLOR.A }}>A</b> ≥85% · <b style={{ color: GRADE_COLOR.B }}>B</b> ≥70% · <b style={{ color: GRADE_COLOR.C }}>C</b> ≥50% · <b style={{ color: GRADE_COLOR.D }}>D</b> &lt;50%
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Tasks() {
  const { user } = useApp();
  const [activeTab,    setActiveTab]    = useState('tasks'); // tasks | groups | report
  const [tasks,        setTasks]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate,   setShowCreate]   = useState(false);

  const canCreate = ['Admin', 'State Head'].includes(user?.role);
  const canEdit   = ['Admin', 'State Head'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const r = await api.listTasks(params);
      setTasks(r.tasks || []);
    } catch { setTasks([]); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { if (activeTab === 'tasks') load(); }, [load, activeTab]);

  const counts = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

  const TABS = [
    { key: 'tasks',  label: 'Tasks',          Icon: ClipboardList },
    { key: 'groups', label: 'Groups',         Icon: Users },
    { key: 'report', label: 'Report & Grading', Icon: BarChart2 },
  ];

  return (
    <div>
      <PageHeader title="Task Management" subtitle="Assign, track and grade newsroom tasks">
        {canCreate && activeTab === 'tasks' && (
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Task
          </button>
        )}
      </PageHeader>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: 'none', background: 'transparent',
              color: activeTab === key ? 'var(--brand)' : 'var(--muted)',
              borderBottom: `2px solid ${activeTab === key ? 'var(--brand)' : 'transparent'}`,
              marginBottom: -1,
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <>
          {/* Status filter */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {[['all','All'], ['pending', 'Pending'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([key, label]) => {
              const count = key === 'all' ? tasks.length : (counts[key] || 0);
              return (
                <button key={key} onClick={() => setStatusFilter(key)}
                  style={{
                    padding: '5px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    background: statusFilter === key ? 'var(--brand)' : 'var(--bg)',
                    color:      statusFilter === key ? '#fff'          : 'var(--text)',
                  }}>
                  {label}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>

          {/* KPI cards */}
          {tasks.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
              {['pending','in_progress','completed'].map(key => (
                <div key={key} className="card p-4" style={{ borderTop: `3px solid ${STATUS[key].color}` }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: STATUS[key].color }}>{counts[key] || 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{STATUS[key].label}</div>
                </div>
              ))}
            </div>
          )}

          <SectionCard title={<span className="flex items-center gap-1.5"><ClipboardList size={14} /> Tasks</span>}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading…</div>
            ) : tasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <ClipboardList size={36} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
                <p style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {canCreate ? 'No tasks yet. Click "New Task" to create one.' : 'No tasks assigned to you.'}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {tasks.map(t => <TaskCard key={t.id} task={t} canEdit={canEdit} onRefresh={load} />)}
              </div>
            )}
          </SectionCard>

          {showCreate && <CreateModal user={user} onClose={() => setShowCreate(false)} onDone={load} />}
        </>
      )}

      {activeTab === 'groups' && <GroupsTab canEdit={canCreate} />}
      {activeTab === 'report' && <ReportTab />}
    </div>
  );
}
