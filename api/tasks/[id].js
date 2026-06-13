/**
 * PATCH  /api/tasks/:id  — update task (status, title, etc.)
 * DELETE /api/tasks/:id  — delete task (admin or creator only)
 */
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { sendMessage } = require('../_lib/telegram');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Task ID required' });

  const [task] = await query('SELECT * FROM tasks WHERE id = ?', [id]).catch(() => []);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // ── PATCH — update task ─────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { status, title, description, category, priority, due_date } = body;

    const sets   = [];
    const params = [];

    const VALID_STATUS = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (status) {
      if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      sets.push('status = ?'); params.push(status);
      if (status === 'completed') { sets.push('completed_at = NOW()'); }
      else                        { sets.push('completed_at = NULL'); }
    }
    if (title !== undefined)       { sets.push('title = ?');       params.push(title); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (category !== undefined)    { sets.push('category = ?');    params.push(category); }
    if (priority !== undefined)    { sets.push('priority = ?');    params.push(priority); }
    if (due_date  !== undefined)   { sets.push('due_date = ?');    params.push(due_date || null); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(id);
    await query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);

    // Telegram: notify assignee when task is marked completed
    if (status === 'completed') {
      const [emp] = await query(
        `SELECT telegram_chat_id FROM \`user\` WHERE pan_no = ?`, [task.assigned_to_pan]
      ).catch(() => []);
      if (emp?.telegram_chat_id) {
        sendMessage(emp.telegram_chat_id,
          `✅ <b>Task Completed</b>\n\n<b>${task.title}</b>\nMarked complete by ${user.sub}`
        ).catch(() => {});
      }
    }

    return res.json({ ok: true });
  }

  // ── DELETE — remove task ─────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (user.role !== 'Admin' && task.assigned_by !== user.sub)
      return res.status(403).json({ error: 'Only Admin or the task creator can delete' });
    await query('DELETE FROM tasks WHERE id = ?', [id]);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
