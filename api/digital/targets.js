/**
 * /api/digital/targets
 *
 * GET  ?month=YYYY-MM  → list targets for month
 * POST (multipart action=excel) → bulk upload from Excel
 * POST (JSON) → set single target
 */
const multer = require('multer');
const XLSX   = require('xlsx');
const { query }   = require('../_lib/mysql');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function isAuthorized(user) {
  return user?.role === 'Admin' ||
    (user?.source === 'digital' && user?.digital_role === 'digital_admin');
}

function parseExcelTargets(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map(r => ({
    mail_id:     String(r['Email'] || r['mail_id'] || '').trim().toLowerCase(),
    target_month:String(r['Month'] || r['target_month'] || '').trim(),  // YYYY-MM
    uv:          Number(r['UV Target'] || r['uv'] || r['tgt_month_UV'] || 0),
    pv:          Number(r['PV Target'] || r['pv'] || r['tgt_month_PV'] || 0),
    stories:     Number(r['Story Target'] || r['stories'] || r['tgt_month_no_of_story'] || 0),
    avg_time:    Number(r['Avg Time'] || r['avg_time'] || r['Avg_time_on_page'] || 0),
  })).filter(r => r.mail_id && r.target_month);
}

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const isAdmin = isAuthorized(user);

  // ── GET: fetch targets for a month ───────────────────────────────────────
  if (req.method === 'GET') {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    return query(`
      SELECT t.id, t.user_id, t.target_month,
             t.tgt_month_UV AS uv_target,
             t.tgt_month_PV AS pv_target,
             t.tgt_month_no_of_story AS story_target,
             t.Avg_time_on_page AS avg_time_target,
             u.name, u.team, u.incharge, u.mail_id
      FROM digital_target t
      JOIN digital_user u ON u.id = t.user_id
      WHERE t.target_month = ?
      ORDER BY u.team, u.name
    `, [month])
      .then(rows => res.json({ month, targets: rows }))
      .catch(err => res.status(500).json({ error: err.message }));
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!isAdmin) return res.status(403).json({ error: 'Admin or digital_admin required' });

    const ct = req.headers['content-type'] || '';

    if (ct.includes('multipart/form-data')) {
      return upload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        try {
          const rows = parseExcelTargets(req.file.buffer);
          if (!rows.length) return res.status(400).json({ error: 'No valid rows. Need: Email, Month (YYYY-MM), UV Target, PV Target, Story Target' });

          let upserted = 0, skipped = 0;
          for (const r of rows) {
            const [du] = await query('SELECT id FROM digital_user WHERE mail_id = ?', [r.mail_id]);
            if (!du) { skipped++; continue; }

            await query(`
              INSERT INTO digital_target (user_id, target_month, tgt_month_UV, tgt_month_PV, tgt_month_no_of_story, Avg_time_on_page)
              VALUES (?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                tgt_month_UV = VALUES(tgt_month_UV),
                tgt_month_PV = VALUES(tgt_month_PV),
                tgt_month_no_of_story = VALUES(tgt_month_no_of_story),
                Avg_time_on_page = VALUES(Avg_time_on_page)
            `, [du.id, r.target_month, r.uv, r.pv, r.stories, r.avg_time]);
            upserted++;
          }
          return res.json({ ok: true, upserted, skipped, total: rows.length });
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      });
    }

    // JSON single upsert
    return (async () => {
      const { user_id, target_month, uv, pv, stories, avg_time } = req.body || {};
      if (!user_id || !target_month) return res.status(400).json({ error: 'user_id and target_month required' });

      await query(`
        INSERT INTO digital_target (user_id, target_month, tgt_month_UV, tgt_month_PV, tgt_month_no_of_story, Avg_time_on_page)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          tgt_month_UV = VALUES(tgt_month_UV),
          tgt_month_PV = VALUES(tgt_month_PV),
          tgt_month_no_of_story = VALUES(tgt_month_no_of_story),
          Avg_time_on_page = VALUES(Avg_time_on_page)
      `, [user_id, target_month, uv || 0, pv || 0, stories || 0, avg_time || 0]);

      return res.json({ ok: true });
    })().catch(err => res.status(500).json({ error: err.message }));
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
