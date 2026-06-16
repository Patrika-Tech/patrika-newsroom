/**
 * PATCH  /api/legal-notices/:id  — update a notice
 * DELETE /api/legal-notices/:id  — delete a notice
 */
const path = require('path');
const fs   = require('fs');
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'legal-notices');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, ['Admin', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'ID required' });

  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { state, branch, advocate_name, notice_date, notice_in_favour_of, matter_summary } = body;
    await query(
      `UPDATE legal_notices SET state=?, branch=?, advocate_name=?, notice_date=?,
       notice_in_favour_of=?, matter_summary=? WHERE id=?`,
      [state||'', branch||'', advocate_name||'', notice_date||null,
       notice_in_favour_of||'', matter_summary||'', id]
    );
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    // Also remove uploaded files
    const [row] = await query(
      'SELECT pdf_filename, cuttings FROM legal_notices WHERE id = ?', [id]
    ).catch(() => []);
    if (row) {
      if (row.pdf_filename) {
        const p = path.join(UPLOAD_DIR, row.pdf_filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      try {
        const cuts = JSON.parse(row.cuttings || '[]');
        cuts.forEach(c => {
          const p = path.join(UPLOAD_DIR, c.filename);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });
      } catch {}
    }
    await query('DELETE FROM legal_notices WHERE id = ?', [id]);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
