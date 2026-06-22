const { query }      = require('../_lib/mysql');
const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError } = requireRole(req, ['Admin']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  try {
    const page     = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit    = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const offset   = (page - 1) * limit;
    const search   = (req.query.search || '').trim();
    const status   = (req.query.status || '').trim();
    const dateFrom = (req.query.from   || '').trim();
    const dateTo   = (req.query.to     || '').trim();

    const conditions = [];
    const params     = [];

    if (search) {
      conditions.push('(username LIKE ? OR name LIKE ? OR ip LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status && ['success', 'failed', 'blocked'].includes(status)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (dateFrom) {
      conditions.push('DATE(logged_at) >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('DATE(logged_at) <= ?');
      params.push(dateTo);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Use validated integer interpolation for LIMIT/OFFSET (avoids mysql2 param-type issues)
    const countRows = await query(`SELECT COUNT(*) AS total FROM login_logs ${where}`, params);
    const total = countRows[0]?.total || 0;

    const logs = await query(
      `SELECT id, username, name, role, ip, user_agent, status, reason, logged_at
       FROM login_logs ${where}
       ORDER BY logged_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    if (err.message && (err.message.includes("doesn't exist") || err.message.includes("Table"))) {
      return res.json({ logs: [], total: 0, page: 1, limit: 50, pages: 1 });
    }
    console.error('[login-logs]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
