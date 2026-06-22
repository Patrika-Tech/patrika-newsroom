/**
 * GET  /api/tasks          — list tasks (role-filtered)
 * POST /api/tasks          — create task(s): single or bulk, individual or group
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');
const { sendMessage } = require('./_lib/telegram');
const { ensureColumn } = require('./_lib/schema');

let tableReady = false;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                   INT          AUTO_INCREMENT PRIMARY KEY,
      title                VARCHAR(255) NOT NULL,
      description          TEXT,
      category             VARCHAR(100) DEFAULT 'Other',
      priority             ENUM('high','medium','low') DEFAULT 'medium',
      status               ENUM('pending','in_progress','completed','cancelled') DEFAULT 'pending',
      assigned_to_pan      VARCHAR(50)  NOT NULL,
      assigned_to_name     VARCHAR(255) NOT NULL,
      assigned_to_state    VARCHAR(100) NOT NULL DEFAULT '',
      assigned_to_branch   VARCHAR(100)          DEFAULT '',
      assigned_by          VARCHAR(100) NOT NULL,
      assigned_by_name     VARCHAR(255) NOT NULL DEFAULT '',
      due_date             DATE,
      created_at           DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      completed_at         DATETIME,
      assigned_by_telegram VARCHAR(100) DEFAULT NULL,
      group_id             INT          DEFAULT NULL,
      INDEX idx_state  (assigned_to_state),
      INDEX idx_branch (assigned_to_branch),
      INDEX idx_status (status),
      INDEX idx_created(created_at),
      INDEX idx_group  (group_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function sendTaskTelegram(assigneeChatId, { title, category, priority, due_date, creatorName, description }) {
  if (!assigneeChatId) return;
  const prioEmoji = priority === 'high' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
  const prioLabel = priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Medium';
  const dueLine   = due_date ? `\n📅 <b>Due:</b> ${due_date}` : '';
  const descLine  = description ? `\n\n${description}` : '';
  const msg = `📋 <b>New Task Assigned</b>\n\n<b>${title}</b>\n🏷 ${category || 'Other'}  ·  ${prioEmoji} ${prioLabel}${dueLine}\n👤 From: ${creatorName}${descLine}`;
  return sendMessage(assigneeChatId, msg).catch(e => console.error('[tasks] Telegram FAILED:', e.message));
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (!tableReady) {
    try {
      await ensureTable();
      await ensureColumn('tasks', 'assigned_by_telegram', "VARCHAR(100) DEFAULT NULL");
      await ensureColumn('tasks', 'group_id', "INT DEFAULT NULL");
      tableReady = true;
    } catch (e) { return res.status(500).json({ error: 'DB setup: ' + e.message }); }
  }

  // ── GET — list tasks ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { status: sf, group_id } = req.query;
    const conds = [];
    const params = [];

    if (user.role === 'State Head' && user.state) {
      conds.push('(assigned_to_state = ? OR assigned_by = ?)');
      params.push(user.state, user.sub);
    } else if (user.role === 'Regional Editor') {
      const sub = [];
      if (user.branch) { sub.push('assigned_to_branch = ?'); params.push(user.branch); }
      sub.push('assigned_by = ?'); params.push(user.sub);
      conds.push(`(${sub.join(' OR ')})`);
    }

    if (sf && sf !== 'all') { conds.push('status = ?'); params.push(sf); }
    if (group_id) { conds.push('group_id = ?'); params.push(group_id); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT 500`, params
    ).catch(() => []);

    return res.json({ tasks: rows });
  }

  // ── POST — create task(s) ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (user.role === 'Regional Editor')
      return res.status(403).json({ error: 'Regional Editors cannot create tasks' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      // shared fields
      category, priority, due_date,
      // single-task fields
      title, description,
      // bulk: array of {title, description}
      tasks: bulkTasks,
      // assignment: individual pan or group
      assigned_to_pan, assigned_to_group,
    } = body;

    // Build task list (single or bulk)
    const taskList = bulkTasks?.length
      ? bulkTasks.filter(t => t?.title?.trim())
      : title?.trim() ? [{ title: title.trim(), description: description || '' }] : [];

    if (!taskList.length) return res.status(400).json({ error: 'At least one task title is required' });
    if (!assigned_to_pan && !assigned_to_group)
      return res.status(400).json({ error: 'Select an assignee (individual or group)' });

    // Get creator info
    const [creator] = await query(
      'SELECT name FROM users WHERE username = ? LIMIT 1', [user.sub]
    ).catch(() => []);
    const creatorName = creator?.name || user.sub || 'Unknown';

    // Assigner's telegram
    const [assignerEmp] = await query(
      `SELECT telegram_chat_id FROM \`user\` WHERE TRIM(EMPNAME) = TRIM(?) AND telegram_chat_id IS NOT NULL AND telegram_chat_id != '' LIMIT 1`,
      [creatorName]
    ).catch(() => []);
    const assignerTelegram = assignerEmp?.telegram_chat_id || null;

    // Resolve assignee list
    let assignees = [];

    if (assigned_to_group) {
      // Load group members
      const members = await query(
        `SELECT m.pan_no, m.emp_name AS EMPNAME, m.state AS State, m.branch AS Branch, m.telegram_chat_id
         FROM task_group_members m WHERE m.group_id = ?`, [assigned_to_group]
      ).catch(() => []);
      if (!members.length)
        return res.status(400).json({ error: 'Group has no members' });

      // State Head: filter to their state
      assignees = members.filter(m => {
        if (user.role === 'State Head' && user.state && m.State !== user.state) return false;
        return true;
      }).map(m => ({
        pan_no: m.pan_no, EMPNAME: m.EMPNAME,
        State: m.State, Branch: m.Branch,
        telegram_chat_id: m.telegram_chat_id,
      }));

      if (!assignees.length)
        return res.status(400).json({ error: 'No group members in your state' });
    } else {
      const [assignee] = await query(
        `SELECT pan_no, EMPNAME, State, Branch, telegram_chat_id FROM \`user\` WHERE pan_no = ?`,
        [assigned_to_pan]
      ).catch(() => []);
      if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      if (user.role === 'State Head' && user.state && assignee.State !== user.state)
        return res.status(403).json({ error: 'Can only assign to employees in your state' });
      assignees = [assignee];
    }

    // Batch INSERT all tasks first, then send Telegram non-blocking
    const created = [];
    const telegramQueue = [];

    for (const assignee of assignees) {
      for (const task of taskList) {
        const result = await query(
          `INSERT INTO tasks
             (title, description, category, priority,
              assigned_to_pan, assigned_to_name, assigned_to_state, assigned_to_branch,
              assigned_by, assigned_by_name, due_date, assigned_by_telegram, group_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.title.trim(), task.description || '', category || 'Other', priority || 'medium',
            assignee.pan_no, assignee.EMPNAME || '', assignee.State || '', assignee.Branch || '',
            user.sub, creatorName, due_date || null, assignerTelegram,
            assigned_to_group || null,
          ]
        );
        created.push(result.insertId);

        if (assignee.telegram_chat_id) {
          telegramQueue.push({ chatId: assignee.telegram_chat_id, task, assignee });
        }
      }
    }

    // Respond immediately — send Telegram in background
    res.status(201).json({ ok: true, ids: created, count: created.length });

    // Fire-and-forget Telegram notifications
    for (const { chatId, task } of telegramQueue) {
      sendTaskTelegram(chatId, {
        title: task.title.trim(), category, priority, due_date, creatorName,
        description: task.description,
      }).catch(e => console.error('[tasks] Telegram failed:', e.message));
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
