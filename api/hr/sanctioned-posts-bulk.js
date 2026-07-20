/**
 * POST /api/hr/sanctioned-posts/bulk   (multipart, field: file)
 * Accepts an Excel or CSV file and bulk-upserts sanctioned posts.
 * Returns { inserted, updated, skipped, errors[] }.
 */
const multer  = require('multer');
const XLSX    = require('xlsx');
const { query }      = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, ['Admin', 'HR']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'File upload error: ' + err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      let inserted = 0, updated = 0, skipped = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const r   = rows[i];
        const row = i + 2; // 1-indexed + header

        const state   = String(r['State']   || '').trim();
        const branch  = String(r['Branch']  || '').trim();
        const profile = String(r['Profile'] || '').trim();
        const count   = r['Sanctioned Count'];

        if (!profile) { skipped++; continue; }
        if (count === '' || count === null || count === undefined || isNaN(Number(count))) {
          errors.push(`Row ${row}: "Sanctioned Count" is missing or not a number`);
          skipped++;
          continue;
        }

        const department = String(r['Department'] || '').trim() || null;
        const minSalary  = Number(r['Min Salary']) || null;
        const maxSalary  = Number(r['Max Salary']) || null;
        const sCount     = Number(count);

        try {
          const result = await query(
            `INSERT INTO hr_sanctioned_posts
               (profile, department, state, branch, sanctioned_count, min_salary, max_salary)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               department       = VALUES(department),
               sanctioned_count = VALUES(sanctioned_count),
               min_salary       = VALUES(min_salary),
               max_salary       = VALUES(max_salary)`,
            [profile, department, state, branch, sCount, minSalary, maxSalary]
          );
          if (result.affectedRows === 1) inserted++;
          else updated++;
        } catch (dbErr) {
          errors.push(`Row ${row} (${profile}/${branch}): ${dbErr.message}`);
        }
      }

      return res.json({
        ok: true,
        total: rows.length,
        inserted,
        updated,
        skipped,
        errors,
      });

    } catch (parseErr) {
      return res.status(400).json({ error: 'Could not parse file: ' + parseErr.message });
    }
  });
};
