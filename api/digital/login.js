/**
 * POST /api/digital/login
 * Separate login for digital team users (digital_user table).
 * Uses mail_id + bcrypt password.
 */
const bcrypt         = require('bcryptjs');
const { query }      = require('../_lib/mysql');
const { issueToken } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const rows = await query(
      'SELECT * FROM digital_user WHERE mail_id = ? AND is_emp_working = 1 LIMIT 1',
      [email]
    );
    const u = rows[0];

    if (!u || !u.password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, u.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = issueToken({
      sub:          String(u.id),
      source:       'digital',
      digital_role: u.role || 'individual',
      team:         u.team    || null,
      incharge:     u.incharge|| null,
      digital_id:   u.id,
      name:         u.name,
    }, 86400 * 7);  // 7-day token

    return res.json({
      token,
      user: {
        name:         u.name,
        role:         'Digital User',
        digital_role: u.role || 'individual',
        source:       'digital',
        team:         u.team    || null,
        incharge:     u.incharge|| null,
        avatar:       (u.name?.[0] || 'D').toUpperCase(),
        digital_id:   u.id,
      },
    });
  } catch (err) {
    console.error('[digital/login]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
