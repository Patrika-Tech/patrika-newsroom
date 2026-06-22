/**
 * Users management — Admin only
 * GET  /api/users  — list all users (no password_hash)
 * POST /api/users  — create a new user
 */
const bcrypt    = require('bcryptjs');
const { query } = require('./_lib/mysql');
const { ensureColumn }           = require('./_lib/schema');
const { requireRole }            = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');
const { writeActivityLog }       = require('./_lib/activity-log');

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

const VALID_ROLES = ['Admin', 'State Head', 'Regional Editor', 'Legal'];

/** Guarantee is_active exists; returns true/false so callers can branch. */
async function ensureIsActive() {
  return ensureColumn('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
}

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user: caller } = requireRole(req, ['Admin']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // ── GET — list users ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const hasCol = await ensureIsActive();
      const sql = hasCol
        ? 'SELECT id, username, name, role, state, branch, COALESCE(is_active, 1) AS is_active, created_at FROM users ORDER BY name ASC'
        : 'SELECT id, username, name, role, state, branch, 1 AS is_active, created_at FROM users ORDER BY name ASC';
      const rows = await query(sql);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — create user ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { username, name, password, role, state, branch, is_active } = body;

    if (!username || !name || !password || !role)
      return res.status(422).json({ error: 'username, name, password and role are required' });

    if (!VALID_ROLES.includes(role))
      return res.status(422).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

    try {
      const hasCol       = await ensureIsActive();
      const password_hash = await bcrypt.hash(password, 10);
      const activeVal    = (is_active === false || is_active === 0) ? 0 : 1;

      let insertId;
      if (hasCol) {
        const result = await query(
          'INSERT INTO users (username, name, password_hash, role, state, branch, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [username, name, password_hash, role, state || null, branch || null, activeVal]
        );
        insertId = result.insertId;
      } else {
        const result = await query(
          'INSERT INTO users (username, name, password_hash, role, state, branch) VALUES (?, ?, ?, ?, ?, ?)',
          [username, name, password_hash, role, state || null, branch || null]
        );
        insertId = result.insertId;
      }

      const selectSql = hasCol
        ? 'SELECT id, username, name, role, state, branch, COALESCE(is_active,1) AS is_active, created_at FROM users WHERE id = ?'
        : 'SELECT id, username, name, role, state, branch, 1 AS is_active, created_at FROM users WHERE id = ?';
      const [created] = await query(selectSql, [insertId]);
      writeActivityLog({
        actor: caller.sub, actorName: caller.name || caller.sub,
        action: 'user_created',
        target: username,
        details: `Created user "${name}" with role ${role}${state ? `, state ${state}` : ''}${branch ? `, branch ${branch}` : ''}`,
        ip: getIP(req),
      });
      return res.status(201).json(created);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ error: 'Username already exists' });
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
