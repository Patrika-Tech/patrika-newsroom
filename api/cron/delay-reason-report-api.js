/**
 * GET  /api/production/delay-reason-report  -> recent send logs
 * POST /api/production/delay-reason-report  -> manual trigger (Admin / State Head)
 */
const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { query }                  = require('../_lib/mysql');
const { run }                    = require('./delay-reason-report');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Management']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (req.method === 'GET') {
    const logs = await query(`
      SELECT id, report_date, recipient, status, error_msg, triggered_by,
             DATE_FORMAT(CONVERT_TZ(sent_at, '+00:00', '+05:30'), '%d %b %Y %H:%i') AS sent_at_ist
      FROM delay_reason_report_logs
      ORDER BY id DESC LIMIT 30
    `).catch(() => []);
    return res.json({ logs });
  }

  if (req.method === 'POST') {
    if (!['Admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Only Admin can manually trigger this report' });
    }
    const date = req.body?.date || null;
    try {
      const result = await run('manual', date);
      return res.json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
