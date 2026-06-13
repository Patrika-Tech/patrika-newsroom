/**
 * GET  /api/production/delay-reasons?date=YYYY-MM-DD
 *   Returns all delay reasons submitted via Telegram for a given date.
 *
 * DELETE /api/production/delay-reasons?id=<id>
 *   Admin-only: delete a specific reason record.
 */

const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { query }                  = require('../_lib/mysql');

// ── Ensure table exists on first load ─────────────────────────────────────────
async function ensureTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS delay_reasons (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        branch              VARCHAR(200) NOT NULL,
        state               VARCHAR(100) DEFAULT '',
        pub_date            DATE         NOT NULL,
        reason              TEXT         NOT NULL,
        submitted_by_name   VARCHAR(200) DEFAULT '',
        submitted_by_chat_id VARCHAR(50) DEFAULT '',
        submitted_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pub_date   (pub_date),
        INDEX idx_branch_date (branch, pub_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (err) {
    // Table may already exist — safe to ignore
    if (!err.message.includes('already exists')) {
      console.warn('[delay-reasons] Table create warning:', err.message);
    }
  }
}

ensureTable();

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management', 'Viewer']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // ── GET — fetch reasons for a date ────────────────────────────────────────
  if (req.method === 'GET') {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
      // Role-based scope lock: RE sees only their branch, State Head only their state
      const conds  = ['pub_date = ?'];
      const params = [date];

      if (user.role === 'Regional Editor') {
        if (user.state)  { conds.push('state = ?');  params.push(user.state);  }
        if (user.branch) { conds.push('branch = ?'); params.push(user.branch); }
      } else if (user.role === 'State Head') {
        if (user.state)  { conds.push('state = ?');  params.push(user.state);  }
      }
      // Admin / HR / Management → no extra filter

      const rows = await query(
        `SELECT id, branch, state, pub_date, reason,
                submitted_by_name, submitted_at
         FROM delay_reasons
         WHERE ${conds.join(' AND ')}
         ORDER BY submitted_at ASC`,
        params
      );
      return res.json({ date, reasons: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE — remove a reason (Admin only) ─────────────────────────────────
  if (req.method === 'DELETE') {
    const { authError: adminErr, user } = requireRole(req, ['Admin']);
    if (adminErr) return res.status(403).json({ error: 'Admin only' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await query('DELETE FROM delay_reasons WHERE id = ?', [id]);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
