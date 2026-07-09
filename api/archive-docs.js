/**
 * /api/archive-docs
 *
 * GET    ?type=circular|stylesheet  → list documents
 * POST   multipart — upload a document
 * DELETE ?id=N                      → delete document
 */
const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const { query }   = require('./_lib/mysql');
const { getUser } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'archive-docs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const stamp = Date.now();
    const safe  = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${stamp}_${safe}`);
  },
});

const MIME_ALLOW = {
  circular:   ['application/pdf'],
  stylesheet: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
};

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const docType = req.body?.doc_type || req.query?.doc_type || '';
    const allowed = MIME_ALLOW[docType] || [];
    if (!allowed.length || allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Only ${docType === 'circular' ? 'PDF' : 'DOC/DOCX'} files are allowed`));
  },
});

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  // ── GET: list ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { type } = req.query;
    const sql = type
      ? 'SELECT * FROM archive_documents WHERE type = ? ORDER BY circular_date DESC, id DESC'
      : 'SELECT * FROM archive_documents ORDER BY circular_date DESC, id DESC';
    const params = type ? [type] : [];
    return query(sql, params)
      .then(rows => res.json({ docs: rows }))
      .catch(err => res.status(500).json({ error: err.message }));
  }

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    return (async () => {
      const rows = await query('SELECT filename FROM archive_documents WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const filePath = path.join(UPLOAD_DIR, rows[0].filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await query('DELETE FROM archive_documents WHERE id = ?', [id]);
      res.json({ ok: true });
    })().catch(err => res.status(500).json({ error: err.message }));
  }

  // ── POST: upload ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    return upload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const { doc_type, label, circular_date } = req.body || {};
      if (!doc_type || !label || !circular_date) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'doc_type, label, and circular_date are required' });
      }

      try {
        const result = await query(
          `INSERT INTO archive_documents (type, label, circular_date, filename, original_name, file_size, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [doc_type, label, circular_date, req.file.filename, req.file.originalname,
           req.file.size, user.name || user.email || '']
        );
        const [doc] = await query('SELECT * FROM archive_documents WHERE id = ?', [result.insertId]);
        res.json({ ok: true, doc });
      } catch (e) {
        fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
      }
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
