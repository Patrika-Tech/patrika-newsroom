/**
 * Single feedback item — Admin only
 * PATCH  /api/feedback/:id  — update status / admin_note
 * DELETE /api/feedback/:id  — delete
 */
const { query }      = require('../_lib/mysql');
const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, ['Admin']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const id = parseInt(req.query?.id, 10);
  if (!id) return res.status(422).json({ error: 'Invalid feedback ID' });

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { status, admin_note } = body;

    const fields = [];
    const vals   = [];

    if (status)             { fields.push('status = ?');     vals.push(status); }
    if ('admin_note' in body) { fields.push('admin_note = ?'); vals.push(admin_note || null); }

    if (!fields.length) return res.status(422).json({ error: 'Nothing to update' });

    try {
      vals.push(id);
      await query(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, vals);
      const [updated] = await query('SELECT * FROM feedback WHERE id = ?', [id]);
      if (!updated) return res.status(404).json({ error: 'Feedback not found' });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      await query('DELETE FROM feedback WHERE id = ?', [id]);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
