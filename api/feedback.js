/**
 * Feedback
 * GET  /api/feedback  — Admin: all rows; RE/State Head: own submissions
 * POST /api/feedback  — RE, State Head, Admin: submit new feedback
 */
const { query }      = require('./_lib/mysql');
const { requireRole }            = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

const ALLOWED = ['Admin', 'State Head', 'Regional Editor'];

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ALLOWED);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  await ensureTable();

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const rows = user.role === 'Admin'
        ? await query('SELECT * FROM feedback ORDER BY created_at DESC')
        : await query('SELECT * FROM feedback WHERE submitted_by = ? ORDER BY created_at DESC', [user.sub]);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { type, subject, description, priority } = body;

    if (!subject?.trim() || !description?.trim())
      return res.status(422).json({ error: 'subject and description are required' });

    try {
      // Look up display name from users table
      const [u] = await query('SELECT name FROM users WHERE username = ? LIMIT 1', [user.sub]).catch(() => []);
      const name = u?.name || user.sub;

      const result = await query(
        `INSERT INTO feedback
           (submitted_by, name, role, state, branch, type, subject, description, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.sub,
          name,
          user.role,
          user.state  || null,
          user.branch || null,
          type        || 'Other',
          subject.trim(),
          description.trim(),
          priority    || 'Medium',
        ]
      );
      const [created] = await query('SELECT * FROM feedback WHERE id = ?', [result.insertId]);
      return res.status(201).json(created);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      submitted_by VARCHAR(100) NOT NULL,
      name         VARCHAR(200),
      role         VARCHAR(50),
      state        VARCHAR(100),
      branch       VARCHAR(100),
      type         VARCHAR(50)  NOT NULL DEFAULT 'Other',
      subject      VARCHAR(300) NOT NULL,
      description  TEXT         NOT NULL,
      priority     VARCHAR(20)  NOT NULL DEFAULT 'Medium',
      status       VARCHAR(20)  NOT NULL DEFAULT 'New',
      admin_note   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}
