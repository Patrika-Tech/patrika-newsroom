/**
 * /api/digital/users
 *
 * GET    → list digital users (Admin or digital_admin)
 * POST   → create user or bulk-upload from Excel (multipart action=excel)
 * PATCH  → update user (id in query)
 * DELETE → delete user (id in query)
 */
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX   = require('xlsx');
const { query }      = require('../_lib/mysql');
const { getUser }    = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function isAuthorized(user) {
  return user?.role === 'Admin' ||
    (user?.source === 'digital' && user?.digital_role === 'digital_admin');
}

function parseExcelUsers(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map(r => ({
    name:     String(r['Name'] || r['name'] || '').trim(),
    team:     String(r['Team'] || r['team'] || '').trim(),
    incharge: String(r['Team Lead'] || r['team_lead'] || r['incharge'] || '').trim(),
    mail_id:  String(r['Email'] || r['email'] || r['mail_id'] || '').trim().toLowerCase(),
    cms_id:   String(r['CMS ID'] || r['cms_id'] || r['zimbea_id'] || '').trim(),
    state:    String(r['State'] || r['state'] || '').trim(),
    location: String(r['Location'] || r['location'] || '').trim(),
    role:     String(r['Role'] || r['role'] || 'individual').trim().toLowerCase(),
    password: String(r['Password'] || r['password'] || '').trim(),
  })).filter(r => r.name && r.mail_id);
}

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = getUser(req);
  if (!isAuthorized(user)) return res.status(403).json({ error: 'Admin or digital_admin required' });

  // ── GET: list users ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    return query(`
      SELECT id, zimbea_id, cms_id, name, team, role, state, location, mail_id, incharge,
             is_emp_working,
             CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END AS has_password
      FROM digital_user
      ORDER BY team, name
    `).then(rows => res.json({ users: rows }))
      .catch(err => res.status(500).json({ error: err.message }));
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    return query('DELETE FROM digital_user WHERE id = ?', [id])
      .then(() => res.json({ ok: true }))
      .catch(err => res.status(500).json({ error: err.message }));
  }

  // ── PATCH: update single user ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    return (async () => {
      const body = req.body || {};
      const fields = [];
      const vals   = [];
      const allowed = ['name', 'team', 'role', 'state', 'location', 'mail_id', 'incharge', 'cms_id', 'is_emp_working'];
      for (const k of allowed) {
        if (body[k] !== undefined) { fields.push(`${k} = ?`); vals.push(body[k]); }
      }
      if (body.password) {
        const hash = await bcrypt.hash(String(body.password), 10);
        fields.push('password = ?'); vals.push(hash);
      }
      if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
      vals.push(id);
      await query(`UPDATE digital_user SET ${fields.join(', ')} WHERE id = ?`, vals);
      return res.json({ ok: true });
    })().catch(err => res.status(500).json({ error: err.message }));
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    // Detect multipart (Excel upload) vs JSON (single user create)
    const ct = req.headers['content-type'] || '';

    if (ct.includes('multipart/form-data')) {
      // Excel bulk upload
      return upload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        try {
          const rows = parseExcelUsers(req.file.buffer);
          if (!rows.length) return res.status(400).json({ error: 'No valid rows found in Excel. Need columns: Name, Email' });

          let created = 0, updated = 0, skipped = 0;
          for (const r of rows) {
            const [existing] = await query('SELECT id FROM digital_user WHERE mail_id = ?', [r.mail_id]);
            const hash = r.password ? await bcrypt.hash(r.password, 10) : null;

            const validRoles = ['digital_admin', 'team_lead', 'individual'];
            const role = validRoles.includes(r.role) ? r.role : 'individual';

            if (existing) {
              const upd = [r.name, r.team, role, r.state, r.location, r.incharge, r.cms_id, existing.id];
              if (hash) {
                await query(
                  'UPDATE digital_user SET name=?, team=?, role=?, state=?, location=?, incharge=?, cms_id=?, password=? WHERE id=?',
                  [...upd.slice(0, -1), hash, existing.id]
                );
              } else {
                await query(
                  'UPDATE digital_user SET name=?, team=?, role=?, state=?, location=?, incharge=?, cms_id=? WHERE id=?',
                  upd
                );
              }
              updated++;
            } else {
              if (!r.password) { skipped++; continue; }
              await query(
                'INSERT INTO digital_user (name, team, role, state, location, mail_id, incharge, cms_id, password, is_emp_working) VALUES (?,?,?,?,?,?,?,?,?,1)',
                [r.name, r.team, role, r.state, r.location, r.mail_id, r.incharge, r.cms_id, hash]
              );
              created++;
            }
          }
          return res.json({ ok: true, created, updated, skipped, total: rows.length });
        } catch (e) {
          console.error('[digital/users Excel]', e.message);
          return res.status(500).json({ error: e.message });
        }
      });
    }

    // JSON single-user create
    return (async () => {
      const { name, mail_id, password, team, role, state, location, incharge, cms_id } = req.body || {};
      if (!name || !mail_id || !password)
        return res.status(400).json({ error: 'name, mail_id, and password required' });

      const validRoles = ['digital_admin', 'team_lead', 'individual'];
      const finalRole = validRoles.includes(role) ? role : 'individual';
      const hash = await bcrypt.hash(String(password), 10);

      const [existing] = await query('SELECT id FROM digital_user WHERE mail_id = ?', [mail_id]);
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const result = await query(
        'INSERT INTO digital_user (name, team, role, state, location, mail_id, incharge, cms_id, password, is_emp_working) VALUES (?,?,?,?,?,?,?,?,?,1)',
        [name, team || null, finalRole, state || null, location || null, mail_id, incharge || null, cms_id || null, hash]
      );
      return res.json({ ok: true, id: result.insertId });
    })().catch(err => res.status(500).json({ error: err.message }));
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
