/**
 * GET  /api/tasks          — list tasks (role-filtered)
 * POST /api/tasks          — create task + Telegram alert to assignee
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
      id                 INT          AUTO_INCREMENT PRIMARY KEY,
      title              VARCHAR(255) NOT NULL,
      description        TEXT,
      category           VARCHAR(100) DEFAULT 'Other',
      priority           ENUM('high','medium','low') DEFAULT 'medium',
      status             ENUM('pending','in_progress','completed','cancelled') DEFAULT 'pending',
      assigned_to_pan    VARCHAR(50)  NOT NULL,
      assigned_to_name   VARCHAR(255) NOT NULL,
      assigned_to_state  VARCHAR(100) NOT NULL DEFAULT '',
      assigned_to_branch VARCHAR(100)          DEFAULT '',
      assigned_by        VARCHAR(100) NOT NULL,
      assigned_by_name   VARCHAR(255) NOT NULL DEFAULT '',
      due_date           DATE,
      created_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      completed_at       DATETIME,
      assigned_by_telegram VARCHAR(100) DEFAULT NULL,
      INDEX idx_state  (assigned_to_state),
      INDEX idx_branch (assigned_to_branch),
      INDEX idx_status (status),
      INDEX idx_created(created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
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
      tableReady = true;
    }
    catch (e) { return res.status(500).json({ error: 'DB setup: ' + e.message }); }
  }

  // ── GET — list tasks ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { status: sf } = req.query;
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
    // Admin: no filter

    if (sf && sf !== 'all') { conds.push('status = ?'); params.push(sf); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT 300`,
      params
    ).catch(() => []);

    return res.json({ tasks: rows });
  }

  // ── POST — create task ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (user.role === 'Regional Editor')
      return res.status(403).json({ error: 'Regional Editors cannot create tasks' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { title, description, category, priority, assigned_to_pan, due_date } = body;

    if (!title?.trim())   return res.status(400).json({ error: 'Title is required' });
    if (!assigned_to_pan) return res.status(400).json({ error: 'Assignee is required' });

    // Fetch assignee from employee master
    const [assignee] = await query(
      `SELECT pan_no, EMPNAME, State, Branch, Story_Type, telegram_chat_id
       FROM \`user\` WHERE pan_no = ?`, [assigned_to_pan]
    ).catch(() => []);

    if (!assignee) return res.status(400).json({ error: 'Assignee not found' });

    // State Head can only assign to employees in their state
    if (user.role === 'State Head' && user.state) {
      if (assignee.State !== user.state)
        return res.status(403).json({ error: 'Can only assign to employees in your state' });
    }

    // Creator name from login users table
    const [creator] = await query(
      'SELECT name FROM users WHERE username = ? LIMIT 1', [user.sub]
    ).catch(() => []);
    const creatorName = creator?.name || user.sub || 'Unknown';

    // Look up assigner's telegram from employee master by name match
    const [assignerEmp] = await query(
      `SELECT telegram_chat_id FROM \`user\` WHERE TRIM(EMPNAME) = TRIM(?) AND telegram_chat_id IS NOT NULL AND telegram_chat_id != '' LIMIT 1`,
      [creatorName]
    ).catch(() => []);
    const assignerTelegram = assignerEmp?.telegram_chat_id || null;

    const result = await query(
      `INSERT INTO tasks
         (title, description, category, priority,
          assigned_to_pan, assigned_to_name, assigned_to_state, assigned_to_branch,
          assigned_by, assigned_by_name, due_date, assigned_by_telegram)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(), description || '', category || 'Other', priority || 'medium',
        assignee.pan_no, assignee.EMPNAME || '', assignee.State || '', assignee.Branch || '',
        user.sub, creatorName, due_date || null, assignerTelegram,
      ]
    );

    // Telegram alert to assignee
    console.log(`[tasks] assignee telegram_chat_id: "${assignee.telegram_chat_id}", bot token set: ${!!process.env.TELEGRAM_BOT_TOKEN}`);
    if (assignee.telegram_chat_id) {
      const prioEmoji  = priority === 'high' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
      const prioLabel  = priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Medium';
      const dueLine    = due_date ? `\n📅 <b>Due:</b> ${due_date}` : '';
      const descLine   = description ? `\n\n${description}` : '';
      const msg = `📋 <b>New Task Assigned</b>\n\n` +
        `<b>${title.trim()}</b>\n` +
        `🏷 ${category || 'Other'}  ·  ${prioEmoji} ${prioLabel}` +
        dueLine +
        `\n👤 From: ${creatorName}` +
        descLine;
      sendMessage(assignee.telegram_chat_id, msg)
        .then(() => console.log('[tasks] Telegram sent to assignee OK'))
        .catch(e => console.error('[tasks] Telegram FAILED:', e.message));
    }

    return res.status(201).json({ ok: true, id: result.insertId });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
