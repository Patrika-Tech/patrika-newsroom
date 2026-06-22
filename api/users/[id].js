/**
 * Single user — Admin only
 * PATCH  /api/users/:id  — update name, role, state, branch, password, is_active
 * DELETE /api/users/:id  — delete user
 */
const bcrypt    = require('bcryptjs');
const { query } = require('../_lib/mysql');
const { ensureColumn }           = require('../_lib/schema');
const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { writeActivityLog }       = require('../_lib/activity-log');

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user: caller } = requireRole(req, ['Admin']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const id = parseInt(req.query?.id, 10);
  if (!id) return res.status(422).json({ error: 'Invalid user ID' });

  // ── PATCH — update user ───────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { name, role, state, branch, password, is_active } = body;

    const fields = [];
    const vals   = [];

    if (name)     { fields.push('name = ?');          vals.push(name); }
    if (role)     { fields.push('role = ?');          vals.push(role); }
    if ('state'  in body) { fields.push('state = ?');  vals.push(state  || null); }
    if ('branch' in body) { fields.push('branch = ?'); vals.push(branch || null); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push('password_hash = ?');
      vals.push(hash);
    }

    // is_active — only add to SET clause if the column exists
    let hasCol = false;
    if ('is_active' in body) {
      hasCol = await ensureColumn('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
      if (hasCol) {
        fields.push('is_active = ?');
        vals.push(is_active ? 1 : 0);
      }
    }

    if (!fields.length) return res.status(422).json({ error: 'Nothing to update' });

    try {
      vals.push(id);
      await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);

      // Re-fetch the updated row
      hasCol = hasCol || await ensureColumn('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
      const selectSql = hasCol
        ? 'SELECT id, username, name, role, state, branch, COALESCE(is_active,1) AS is_active, created_at FROM users WHERE id = ?'
        : 'SELECT id, username, name, role, state, branch, 1 AS is_active, created_at FROM users WHERE id = ?';
      const [updated] = await query(selectSql, [id]);
      if (!updated) return res.status(404).json({ error: 'User not found' });

      // Determine what changed for the log message
      const changeParts = [];
      if (name)              changeParts.push(`name→"${name}"`);
      if (role)              changeParts.push(`role→${role}`);
      if ('state'  in body)  changeParts.push(`state→${state || 'none'}`);
      if ('branch' in body)  changeParts.push(`branch→${branch || 'none'}`);
      if (password)          changeParts.push('password changed');
      if ('is_active' in body) {
        changeParts.push(is_active ? 'activated' : 'deactivated');
      }
      const action = 'is_active' in body && changeParts.length === 1
        ? (is_active ? 'user_activated' : 'user_deactivated')
        : 'user_updated';

      writeActivityLog({
        actor: caller.sub, actorName: caller.name || caller.sub,
        action,
        target: updated.username,
        details: `User "${updated.name}": ${changeParts.join(', ')}`,
        ip: getIP(req),
      });

      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      // Prevent Admin from deleting themselves
      if (caller?.sub) {
        const rows = await query('SELECT id FROM users WHERE username = ? LIMIT 1', [caller.sub]);
        if (rows[0] && String(rows[0].id) === String(id))
          return res.status(400).json({ error: 'You cannot delete your own account' });
      }

      const [target] = await query('SELECT username, name FROM users WHERE id = ?', [id]);
      await query('DELETE FROM users WHERE id = ?', [id]);
      writeActivityLog({
        actor: caller.sub, actorName: caller.name || caller.sub,
        action: 'user_deleted',
        target: target?.username || String(id),
        details: `Deleted user "${target?.name || id}"`,
        ip: getIP(req),
      });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
