const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { getUser }    = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'field');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ts   = Date.now();
      const ext  = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      cb(null, `${ts}_${base}${ext}`);
    },
  }),
  limits:     { fileSize: 100 * 1024 * 1024 },   // 100 MB
  fileFilter: (req, file, cb) => cb(null, /^(image|video|audio)\//.test(file.mimetype)),
}).array('files', 10);

module.exports = (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  upload(req, res, err => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    if (err) return res.status(400).json({ error: 'Only image, video, and audio files are allowed' });
    const files = (req.files || []).map(f => ({
      name:     f.originalname,
      filename: f.filename,
      mimetype: f.mimetype,
      size:     f.size,
      url:      `/uploads/field/${f.filename}`,
    }));
    res.json({ ok: true, files });
  });
};
