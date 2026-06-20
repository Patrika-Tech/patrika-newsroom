/**
 * PATCH  /api/hr/appointments/:id  — update an appointment record
 * DELETE /api/hr/appointments/:id  — delete an appointment record
 */
const { query }       = require('../../_lib/mysql');
const { requireRole } = require('../../_lib/auth');
const { setCors, handleOptions } = require('../../_lib/cors');

const UPDATABLE = [
  'emp_code','emp_name','father_name','designation','department',
  'branch','state','appointment_type','appointment_date','effective_date',
  'order_number','basic_salary','notes','status',
];

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, ['Admin', 'HR']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // ── PATCH ──────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const fields = [];
    const params = [];
    UPDATABLE.forEach(k => {
      if (body[k] !== undefined) { fields.push(`${k} = ?`); params.push(body[k]); }
    });
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    await query(`UPDATE appointment SET ${fields.join(', ')} WHERE id = ?`, params);
    const [updated] = await query('SELECT * FROM appointment WHERE id = ?', [id]);
    return res.json({ ok: true, appointment: updated });
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    await query('DELETE FROM appointment WHERE id = ?', [id]);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
