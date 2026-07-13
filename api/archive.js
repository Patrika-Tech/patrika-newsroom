/**
 * Archive API
 * GET    /api/archive          — list files (with filters)
 * POST   /api/archive          — upload file (multipart)
 */
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'archive');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ts   = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    const allowed = /^(video|audio|image)\//;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only video, audio, and image files are allowed'));
  },
});

// ── Ensure DB table ────────────────────────────────────────────────────────────
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS archive_files (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      filename        VARCHAR(255) NOT NULL,
      original_name   VARCHAR(255) NOT NULL,
      file_type       ENUM('video','audio','image') NOT NULL,
      mime_type       VARCHAR(100),
      file_size       BIGINT DEFAULT 0,
      title           VARCHAR(255),
      category        VARCHAR(80) DEFAULT 'other',
      state           VARCHAR(80),
      branch          VARCHAR(80),
      edition         VARCHAR(120),
      tags            TEXT,
      description     TEXT,
      uploaded_by     VARCHAR(80),
      upload_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
      transcript_status ENUM('none','pending','done','failed') DEFAULT 'none',
      transcript_text  LONGTEXT,
      transcript_summary TEXT,
      INDEX idx_file_type  (file_type),
      INDEX idx_category   (category),
      INDEX idx_state      (state),
      INDEX idx_upload     (upload_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableReady = true;
}

// Derive media type from mime
function mediaType(mime) {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'image';
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req,
    ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  await ensureTable().catch(() => {});

  // ── GET: list ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { type, category, state, branch, q, limit = 100, offset = 0 } = req.query;

    // Role lock
    let fState  = state  || '';
    let fBranch = branch || '';
    if (user.role === 'State Head'      && user.state)  { fState = user.state; }  // fBranch stays as selected
    if (user.role === 'Regional Editor' && user.state)  fState  = user.state;
    if (user.role === 'Regional Editor' && user.branch) fBranch = user.branch;
    if (fState  === 'All') fState  = '';
    if (fBranch === 'All') fBranch = '';

    const where = []; const params = [];
    if (type)     { where.push('file_type = ?');  params.push(type); }
    if (category) { where.push('category = ?');   params.push(category); }
    if (fState)   { where.push('state = ?');       params.push(fState); }
    if (fBranch)  { where.push('branch = ?');      params.push(fBranch); }
    if (q)        {
      where.push('(title LIKE ? OR tags LIKE ? OR description LIKE ? OR transcript_text LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const wSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows, countRow] = await Promise.all([
      query(`SELECT id, filename, original_name, file_type, mime_type, file_size,
                    title, category, state, branch, edition, tags, description,
                    uploaded_by, upload_date, transcript_status, transcript_summary
             FROM archive_files ${wSql}
             ORDER BY upload_date DESC LIMIT ? OFFSET ?`,
             [...params, Number(limit), Number(offset)]).catch(() => []),
      query(`SELECT COUNT(*) AS cnt FROM archive_files ${wSql}`, params).catch(() => [{ cnt: 0 }]),
    ]);

    return res.json({ files: rows, total: Number(countRow[0]?.cnt || 0) });
  }

  // ── POST: upload ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    return new Promise(resolve => {
      upload.single('file')(req, res, async err => {
        if (err) { res.status(400).json({ error: err.message }); return resolve(); }
        if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return resolve(); }

        const { title, category = 'other', state = '', branch = '', edition = '', tags = '', description = '' } = req.body;
        const ft = mediaType(req.file.mimetype);

        try {
          const result = await query(
            `INSERT INTO archive_files
               (filename, original_name, file_type, mime_type, file_size,
                title, category, state, branch, edition, tags, description, uploaded_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              req.file.filename, req.file.originalname, ft,
              req.file.mimetype, req.file.size,
              title || req.file.originalname, category, state, branch, edition,
              tags, description, user.sub || user.username || '',
            ]
          );
          const inserted = await query('SELECT * FROM archive_files WHERE id = ?', [result.insertId]);
          res.json({ file: inserted[0] });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
        resolve();
      });
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
