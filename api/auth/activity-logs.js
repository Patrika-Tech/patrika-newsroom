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
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const action = (req.query.action || '').trim();

    const conditions = [];
    const params     = [];

    if (search) {
      conditions.push('(actor LIKE ? OR actor_name LIKE ? OR target LIKE ? OR details LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRows = await query(`SELECT COUNT(*) AS total FROM activity_logs ${where}`, params);
    const total = countRows[0]?.total || 0;

    const logs = await query(
      `SELECT id, actor, actor_name, action, target, details, ip, logged_at
       FROM activity_logs ${where}
       ORDER BY logged_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    if (err.message && (err.message.includes("doesn't exist") || err.message.includes("Table"))) {
      return res.json({ logs: [], total: 0, page: 1, limit: 50, pages: 1 });
    }
    console.error('[activity-logs]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
