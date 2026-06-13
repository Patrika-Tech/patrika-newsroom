/**
 * GET /api/tasks/assignees
 * Returns all active employees from the user table eligible for task assignment.
 * Admin      → all active employees across all states
 * State Head → all active employees in their state only
 */
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const conds  = ["(is_emp_working = 1 OR Status IN ('Working','Active'))"];
  const params = [];

  // State Head can only assign within their state
  if (user.role === 'State Head' && user.state) {
    conds.push('State = ?');
    params.push(user.state);
  }

  const where = 'WHERE ' + conds.join(' AND ');

  const rows = await query(
    `SELECT pan_no,
            EMPNAME       AS name,
            Branch,
            State,
            Story_Type    AS designation,
            CASE WHEN telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
                 THEN 1 ELSE 0 END AS has_telegram
     FROM \`user\`
     ${where}
     ORDER BY State ASC, Branch ASC, EMPNAME ASC
     LIMIT 1000`,
    params
  ).catch(() => []);

  return res.json({ assignees: rows });
};
