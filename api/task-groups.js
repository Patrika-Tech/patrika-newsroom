/**
 * GET  /api/task-groups — list all groups with member_count
 * POST /api/task-groups — create group (Admin or State Head only)
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

let tableReady = false;

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS task_groups (
      id              INT          AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(100) NOT NULL UNIQUE,
      description     VARCHAR(255) DEFAULT '',
      type            VARCHAR(50)  DEFAULT '',
      created_by      VARCHAR(100),
      created_by_name VARCHAR(255),
      created_at      DATETIME     DEFAULT NOW()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_group_members (
      id              INT          AUTO_INCREMENT PRIMARY KEY,
      group_id        INT          NOT NULL,
      pan_no          VARCHAR(50)  NOT NULL,
      emp_name        VARCHAR(255),
      telegram_chat_id VARCHAR(100),
      state           VARCHAR(100),
      branch          VARCHAR(100),
      UNIQUE KEY uq_group_pan (group_id, pan_no),
      INDEX idx_group_id (group_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id              INT          AUTO_INCREMENT PRIMARY KEY,
      task_id         INT          NOT NULL,
      commenter_pan   VARCHAR(50),
      commenter_name  VARCHAR(255),
      comment         TEXT         NOT NULL,
      status_update   VARCHAR(50)  DEFAULT '',
      created_at      DATETIME     DEFAULT NOW(),
      INDEX idx_task_id (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (!tableReady) {
    try {
      await ensureTables();
      tableReady = true;
    } catch (e) {
      return res.status(500).json({ error: 'DB setup: ' + e.message });
    }
  }

  // ── GET — list groups with member count ────────────────────────────────────
  if (req.method === 'GET') {
    const rows = await query(
      `SELECT g.*, COUNT(m.id) AS member_count
       FROM task_groups g
       LEFT JOIN task_group_members m ON m.group_id = g.id
       GROUP BY g.id
       ORDER BY g.name`
    ).catch(() => []);

    return res.json({ groups: rows });
  }

  // ── POST — create group ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { name, description, type } = body;

    if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });

    // Fetch creator display name
    const [creator] = await query(
      'SELECT name FROM users WHERE username = ? LIMIT 1', [user.sub]
    ).catch(() => []);
    const creatorName = creator?.name || user.sub || 'Unknown';

    let result;
    try {
      result = await query(
        `INSERT INTO task_groups (name, description, type, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?)`,
        [name.trim(), description || '', type || '', user.sub, creatorName]
      );
    } catch (e) {
      if (e.message.includes('1062') || e.message.includes('Duplicate entry')) {
        return res.status(409).json({ error: 'A group with this name already exists' });
      }
      return res.status(500).json({ error: 'Failed to create group: ' + e.message });
    }

    const groupId = result.insertId;

    // Auto-add members when type matches Story_Type in user table
    const AUTO_TYPES = ['RE', 'Chief Reporter', 'Desk Head'];
    if (type && AUTO_TYPES.includes(type)) {
      try {
        const empConds  = ["Story_Type = ?", "(is_emp_working = 1 OR Status IN ('Working','Active'))"];
        const empParams = [type];

        // State Head: restrict to their state
        if (user.role === 'State Head' && user.state) {
          empConds.push('State = ?');
          empParams.push(user.state);
        }

        const members = await query(
          `SELECT pan_no, EMPNAME, State, Branch, telegram_chat_id
           FROM \`user\`
           WHERE ${empConds.join(' AND ')}
           ORDER BY State, Branch, EMPNAME`,
          empParams
        );

        for (const m of members) {
          await query(
            `INSERT IGNORE INTO task_group_members (group_id, pan_no, emp_name, telegram_chat_id, state, branch)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [groupId, m.pan_no, m.EMPNAME || '', m.telegram_chat_id || null, m.State || '', m.Branch || '']
          );
        }
      } catch (e) {
        console.error('[task-groups] Auto-member insert failed:', e.message);
      }
    }

    const [created] = await query(
      'SELECT * FROM task_groups WHERE id = ?', [groupId]
    ).catch(() => []);

    const [memberCount] = await query(
      'SELECT COUNT(*) AS cnt FROM task_group_members WHERE group_id = ?', [groupId]
    ).catch(() => [{ cnt: 0 }]);

    return res.status(201).json({ ok: true, group: created, auto_members: memberCount?.cnt || 0 });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
