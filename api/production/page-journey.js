/**
 * GET /api/production/page-journey?date=YYYY-MM-DD
 *
 * Returns every page's full upload journey for a given date,
 * from both gmg_raj and gmg_mpcg tables.
 *
 * Groups rows by:
 *   edition_code (e.g. RPJprCity)
 *   → page_no    (e.g. 1, 2 … 18)
 *     → version  (Original / _Bold / _REV_1 / _north_REV_1 …)
 *
 * Per version: first upload time, last upload time, upload count.
 * Per page:    first/last across all versions, duration, revision count.
 * Per edition: summary stats + all pages sorted by page number.
 */

const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

// ── Filename parser ───────────────────────────────────────────────────────────
// Format: DDMMYYYY-EDITIONCODE-PAGEINFO.pdf
// PAGEINFO examples: 01, 06_Bold, 03_north, 03_north_REV_1, 18_001, 13-Patrika Bold
function parseFilename(filename) {
  const base = filename.replace(/\.pdf$/i, '');
  // date = first 8 digits, then first hyphen, then edition code (no hyphen), then hyphen, then pageinfo
  const m = base.match(/^(\d{8})-([^-]+)-(.+)$/);
  if (!m) return null;

  const [, dateStr, editionCode, pageInfo] = m;
  const day = dateStr.slice(0, 2), mo = dateStr.slice(2, 4), yr = dateStr.slice(4, 8);
  const pub_date = `${yr}-${mo}-${day}`;

  // Extract leading page number digits
  const pm = pageInfo.match(/^(\d+)(.*)/);
  if (!pm) return null;

  const page_no = parseInt(pm[1], 10);
  const rest    = pm[2]; // e.g. "_Bold", "_REV_1", "_north_REV_1", "-Patrika Bold", ""

  // Revision number
  const revMatch = rest.match(/_REV_(\d+)/i);
  const rev_no   = revMatch ? parseInt(revMatch[1], 10) : 0;

  // Variant: strip _REV_N then strip leading _ or -
  const variant = rest.replace(/_REV_\d+/i, '').replace(/^[_\-]/, '').trim() || null;

  // Human-readable version label
  let label = 'Original';
  if (rev_no > 0 && variant) label = `REV ${rev_no} · ${variant}`;
  else if (rev_no > 0)       label = `REV ${rev_no}`;
  else if (variant)          label = variant;

  return { pub_date, edition_code: editionCode, page_no, variant, rev_no, label };
}

// ── SQL for one GMG table ─────────────────────────────────────────────────────
const JOURNEY_SQL = `
  SELECT
    input_file,
    MIN(date_time_pdf)  AS first_time,
    MAX(date_time_pdf)  AS last_time,
    COUNT(*)            AS upload_count
  FROM \`{TABLE}\`
  WHERE input_file REGEXP '^[0-9]{8}-'
    AND STR_TO_DATE(LEFT(input_file, 8), '%d%m%Y') = ?
  GROUP BY input_file
  ORDER BY MIN(date_time_pdf) ASC
`;

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError } = requireRole(req,
    ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const [rajRows, mpcgRows] = await Promise.all([
      query(JOURNEY_SQL.replace('{TABLE}', 'gmg_raj'),  [date]).catch(() => []),
      query(JOURNEY_SQL.replace('{TABLE}', 'gmg_mpcg'), [date]).catch(() => []),
    ]);

    const rows = [
      ...rajRows .map(r => ({ ...r, region: 'RAJ'  })),
      ...mpcgRows.map(r => ({ ...r, region: 'MPCG' })),
    ];

    if (!rows.length) return res.json({ date, editions: [] });

    // ── Group by edition → page → version ────────────────────────────────
    const editionMap = {};

    rows.forEach(row => {
      const parsed = parseFilename(row.input_file);
      if (!parsed) return;

      const { edition_code, page_no, rev_no, variant, label } = parsed;
      const key = edition_code;

      if (!editionMap[key]) {
        editionMap[key] = { code: edition_code, region: row.region, pageMap: {} };
      }

      const ed = editionMap[key];
      if (!ed.pageMap[page_no]) {
        ed.pageMap[page_no] = { page_no, versions: [] };
      }

      ed.pageMap[page_no].versions.push({
        filename:     row.input_file,
        rev_no,
        variant,
        label,
        first_time:   row.first_time,
        last_time:    row.last_time,
        upload_count: Number(row.upload_count),
      });
    });

    // ── Build final editions array ────────────────────────────────────────
    const editions = Object.values(editionMap).map(ed => {
      const pages = Object.values(ed.pageMap)
        .sort((a, b) => a.page_no - b.page_no)
        .map(p => {
          // Sort versions by first upload time
          const versions = p.versions.sort(
            (a, b) => new Date(a.first_time) - new Date(b.first_time)
          );

          const first_upload    = versions[0]?.first_time   || null;
          const last_upload     = versions[versions.length - 1]?.last_time || null;
          const duration_min    = (first_upload && last_upload)
            ? Math.round((new Date(last_upload) - new Date(first_upload)) / 60000)
            : 0;
          const max_rev         = Math.max(0, ...versions.map(v => v.rev_no));
          const total_uploads   = versions.reduce((s, v) => s + v.upload_count, 0);
          const total_versions  = versions.length;

          return {
            page_no: p.page_no,
            versions,
            first_upload,
            last_upload,
            duration_min,
            max_rev,
            total_uploads,
            total_versions,
          };
        });

      // Edition-level summary
      const allFirst = pages.map(p => p.first_upload).filter(Boolean);
      const allLast  = pages.map(p => p.last_upload).filter(Boolean);
      const edition_first    = allFirst.length ? allFirst.reduce((a, b) => a < b ? a : b) : null;
      const edition_last     = allLast .length ? allLast .reduce((a, b) => a > b ? a : b) : null;
      const total_pages      = pages.length;
      const revised_pages    = pages.filter(p => p.max_rev > 0).length;
      const total_uploads    = pages.reduce((s, p) => s + p.total_uploads, 0);
      const edition_duration = (edition_first && edition_last)
        ? Math.round((new Date(edition_last) - new Date(edition_first)) / 60000)
        : 0;

      return {
        code: ed.code,
        region: ed.region,
        pages,
        edition_first,
        edition_last,
        edition_duration,
        total_pages,
        revised_pages,
        total_uploads,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));

    return res.json({ date, editions });

  } catch (err) {
    console.error('[page-journey]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
