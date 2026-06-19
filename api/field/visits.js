const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const INIT = `CREATE TABLE IF NOT EXISTS field_visits (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  reporter_name    VARCHAR(200),
  reporter_username VARCHAR(100),
  reporter_state   VARCHAR(100),
  reporter_branch  VARCHAR(100),
  transport        VARCHAR(50),
  purpose          VARCHAR(100),
  custom_purpose   TEXT,
  checkin_lat      DECIMAL(10,8),
  checkin_lon      DECIMAL(11,8),
  checkin_address  TEXT,
  nearby_places    TEXT,
  checkout_lat     DECIMAL(10,8),
  checkout_lon     DECIMAL(11,8),
  checkout_address TEXT,
  checked_in_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  checked_out_at   DATETIME DEFAULT NULL,
  duration_minutes INT DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* Migrate legacy table — plain ADD COLUMN; errors silently ignored when column already exists */
const MIGRATE = [
  `ALTER TABLE field_visits ADD COLUMN checkin_lat DECIMAL(10,8)`,
  `ALTER TABLE field_visits ADD COLUMN checkin_lon DECIMAL(11,8)`,
  `ALTER TABLE field_visits ADD COLUMN checkin_address TEXT`,
  `ALTER TABLE field_visits ADD COLUMN checkout_lat DECIMAL(10,8)`,
  `ALTER TABLE field_visits ADD COLUMN checkout_lon DECIMAL(11,8)`,
  `ALTER TABLE field_visits ADD COLUMN checkout_address TEXT`,
  `ALTER TABLE field_visits ADD COLUMN checked_in_at DATETIME`,
  `ALTER TABLE field_visits ADD COLUMN checked_out_at DATETIME DEFAULT NULL`,
  `ALTER TABLE field_visits ADD COLUMN duration_minutes INT DEFAULT NULL`,
];

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  await query(INIT).catch(() => {});
  for (const sql of MIGRATE) await query(sql).catch(() => {});

  // ── GET — list visits ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { mine, state } = req.query;
    const conds = [], params = [];

    if (mine === '1' || user.role === 'Regional Editor') {
      conds.push('reporter_username = ?');
      params.push(user.sub);
    } else if (user.role === 'State Head' && user.state) {
      conds.push('reporter_state = ?');
      params.push(user.state);
    }
    if (state && state !== 'All') { conds.push('reporter_state = ?'); params.push(state); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM field_visits ${where} ORDER BY checked_in_at DESC LIMIT 500`,
      params
    ).catch(e => { res.status(500).json({ error: e.message }); return null; });
    if (!rows) return;
    return res.json({ visits: rows });
  }

  // ── POST — check in ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { reporter_name, transport, purpose, custom_purpose,
            latitude, longitude, location_address, nearby_places } = req.body;
    if (!transport || !purpose) return res.status(400).json({ error: 'Transport and purpose required' });

    const r = await query(
      `INSERT INTO field_visits
       (reporter_name, reporter_username, reporter_state, reporter_branch,
        transport, purpose, custom_purpose,
        checkin_lat, checkin_lon, checkin_address, nearby_places,
        checked_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        reporter_name || user.sub, user.sub,
        user.state || '', user.branch || '',
        transport, purpose, custom_purpose || '',
        latitude || null, longitude || null,
        location_address || '', nearby_places || '',
      ]
    ).catch(e => { res.status(500).json({ error: e.message }); return null; });
    if (!r) return;
    return res.json({ ok: true, id: r.insertId });
  }

  // ── PATCH — check out ───────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { latitude, longitude, location_address } = req.body || {};

    /* Verify this visit belongs to the requesting user (unless Admin) */
    const [visit] = await query('SELECT * FROM field_visits WHERE id = ?', [id]).catch(() => []);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (user.role !== 'Admin' && visit.reporter_username !== user.sub)
      return res.status(403).json({ error: 'Forbidden' });
    if (visit.checked_out_at)
      return res.status(400).json({ error: 'Already checked out' });

    const r = await query(
      `UPDATE field_visits
       SET checked_out_at = NOW(),
           checkout_lat = ?,
           checkout_lon = ?,
           checkout_address = ?,
           duration_minutes = TIMESTAMPDIFF(MINUTE, checked_in_at, NOW())
       WHERE id = ?`,
      [latitude || null, longitude || null, location_address || '', id]
    ).catch(e => { res.status(500).json({ error: e.message }); return null; });
    if (r === null) return;

    /* Return updated row */
    const [updated] = await query('SELECT * FROM field_visits WHERE id = ?', [id]).catch(() => []);
    return res.json({ ok: true, visit: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
