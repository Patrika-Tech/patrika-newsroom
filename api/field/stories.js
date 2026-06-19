const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const INIT = `CREATE TABLE IF NOT EXISTS field_stories (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  reporter_name VARCHAR(200),
  reporter_username VARCHAR(100),
  reporter_state VARCHAR(100),
  reporter_branch VARCHAR(100),
  story_type    VARCHAR(100),
  headline      VARCHAR(500) NOT NULL,
  content       LONGTEXT,
  word_count    INT DEFAULT 0,
  files         JSON,
  status        ENUM('submitted','under_review','approved','rejected','published') DEFAULT 'submitted',
  latitude      DECIMAL(10,8),
  longitude     DECIMAL(11,8),
  location_address TEXT,
  submitted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by   VARCHAR(100),
  reviewed_at   DATETIME,
  notes         TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  await query(INIT).catch(() => {});

  if (req.method === 'GET') {
    const { status, mine } = req.query;
    const conds = [], params = [];

    if (mine === '1' || user.role === 'Regional Editor') {
      conds.push('reporter_username = ?');
      params.push(user.sub);
    } else if (user.role === 'State Head' && user.state) {
      conds.push('reporter_state = ?');
      params.push(user.state);
    }
    if (status && status !== 'all') { conds.push('status = ?'); params.push(status); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM field_stories ${where} ORDER BY submitted_at DESC LIMIT 200`,
      params
    ).catch(e => { res.status(500).json({ error: e.message }); return null; });
    if (!rows) return;
    return res.json({ stories: rows });
  }

  if (req.method === 'POST') {
    const { reporter_name, story_type, headline, content, word_count, files, latitude, longitude, location_address } = req.body;
    if (!headline) return res.status(400).json({ error: 'Headline required' });

    const r = await query(
      `INSERT INTO field_stories
       (reporter_name, reporter_username, reporter_state, reporter_branch,
        story_type, headline, content, word_count, files, latitude, longitude, location_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reporter_name || user.sub, user.sub,
        user.state || '', user.branch || '',
        story_type || 'सामान्य', headline,
        content || '', word_count || 0,
        JSON.stringify(files || []),
        latitude || null, longitude || null,
        location_address || '',
      ]
    ).catch(e => { res.status(500).json({ error: e.message }); return null; });
    if (!r) return;
    return res.json({ ok: true, id: r.insertId });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const [story] = await query('SELECT * FROM field_stories WHERE id = ?', [id]).catch(() => []);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    // Admin / State Head — review action (status + notes)
    if (['Admin', 'State Head'].includes(user.role)) {
      const { status, notes } = req.body;
      const r = await query(
        `UPDATE field_stories SET status=?, notes=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?`,
        [status, notes || '', user.sub, id]
      ).catch(e => { res.status(500).json({ error: e.message }); return null; });
      if (r === null) return;
      return res.json({ ok: true });
    }

    // Reporter — can only edit their own submitted/rejected stories
    if (story.reporter_username !== user.sub)
      return res.status(403).json({ error: 'Forbidden' });
    if (!['submitted', 'rejected'].includes(story.status))
      return res.status(400).json({ error: 'Only submitted or rejected stories can be edited' });

    const { story_type, headline, content, word_count, files, latitude, longitude, location_address } = req.body;
    if (!headline) return res.status(400).json({ error: 'Headline required' });

    const r = await query(
      `UPDATE field_stories
       SET story_type=?, headline=?, content=?, word_count=?, files=?,
           latitude=?, longitude=?, location_address=?, status='submitted', submitted_at=NOW()
       WHERE id=?`,
      [
        story_type || 'सामान्य', headline,
        content || '', word_count || 0,
        JSON.stringify(files || []),
        latitude || null, longitude || null,
        location_address || '', id,
      ]
    ).catch(e => { res.status(500).json({ error: e.message }); return null; });
    if (r === null) return;
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
