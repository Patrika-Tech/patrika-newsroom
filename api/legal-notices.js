/**
 * GET  /api/legal-notices        — list all legal notices
 * POST /api/legal-notices        — save a legal notice record
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

let tableReady = false;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS legal_notices (
      id                  INT          AUTO_INCREMENT PRIMARY KEY,
      state               VARCHAR(100) DEFAULT '',
      branch              VARCHAR(100) DEFAULT '',
      advocate_name       VARCHAR(255) DEFAULT '',
      notice_date         DATE,
      notice_in_favour_of TEXT,
      matter_summary      TEXT,
      pdf_filename        VARCHAR(500) DEFAULT '',
      pdf_original_name   VARCHAR(500) DEFAULT '',
      cuttings            JSON,
      raw_text            LONGTEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_state  (state),
      INDEX idx_branch (branch),
      INDEX idx_date   (notice_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (!tableReady) {
    try { await ensureTable(); tableReady = true; }
    catch (e) { return res.status(500).json({ error: 'DB setup: ' + e.message }); }
  }

  // ── GET — list notices ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const conds  = [];
    const params = [];

    if (user.role === 'State Head' && user.state) {
      conds.push('state = ?'); params.push(user.state);
    } else if (user.role === 'Regional Editor') {
      if (user.state)  { conds.push('state = ?');  params.push(user.state);  }
      if (user.branch) { conds.push('branch = ?'); params.push(user.branch); }
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query(
      `SELECT id, state, branch, advocate_name, notice_date, notice_in_favour_of,
              matter_summary, pdf_filename, pdf_original_name, cuttings, created_at
       FROM legal_notices ${where}
       ORDER BY created_at DESC LIMIT 200`,
      params
    ).catch(() => []);

    // Parse cuttings JSON
    const notices = rows.map(r => ({
      ...r,
      cuttings: (() => { try { return JSON.parse(r.cuttings || '[]'); } catch { return []; } })(),
    }));

    return res.json({ notices });
  }

  // ── POST — save notice ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      state, branch, advocate_name, notice_date, notice_in_favour_of,
      matter_summary, pdf_filename, pdf_original_name, cuttings = [], raw_text = '',
    } = body;

    const result = await query(
      `INSERT INTO legal_notices
         (state, branch, advocate_name, notice_date, notice_in_favour_of,
          matter_summary, pdf_filename, pdf_original_name, cuttings, raw_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state || '', branch || '', advocate_name || '',
        notice_date || null, notice_in_favour_of || '',
        matter_summary || '', pdf_filename || '', pdf_original_name || '',
        JSON.stringify(cuttings), raw_text || '',
      ]
    );
    return res.status(201).json({ ok: true, id: result.insertId });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
