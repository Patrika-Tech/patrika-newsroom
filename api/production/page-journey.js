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

// ── Editions permanently excluded from all production views ───────────────────
const HIDDEN_EDITIONS = ['nt jaipur city', 'nt jaipur dak'];
const isHidden = name => HIDDEN_EDITIONS.includes((name || '').toLowerCase().trim());

// ── State normaliser — mirrors api/production.js ──────────────────────────────
const STATE_NORM = {
  'rajasthan': 'raj', 'raj': 'raj',
  'mp': 'mp', 'madhya pradesh': 'mp',
  'cg': 'cg', 'chhattisgarh': 'cg',
  'metro': 'metro',
};
const normState = s => STATE_NORM[(s || '').toLowerCase().trim()] || (s || '').toLowerCase().trim();

// Hard cutoff: 2:30 AM IST — no upload after this time counts as release time.
function isBefore230(t) {
  const m = String(t || '').match(/[T ](\d{2}):(\d{2})/);
  if (!m) return false;
  const h = +m[1], min = +m[2];
  return h < 2 || (h === 2 && min <= 30);
}

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
// DATE_FORMAT returns a plain string (not a Date object), so mysql2 timezone:'Z'
// cannot mis-shift it — the browser receives the raw IST value and parses it
// correctly as local time via new Date('YYYY-MM-DDTHH:MM:SS') (no Z suffix).
const JOURNEY_SQL = `
  SELECT
    input_file,
    DATE_FORMAT(MIN(date_time_pdf), '%Y-%m-%dT%H:%i:%s') AS first_time,
    DATE_FORMAT(MAX(date_time_pdf), '%Y-%m-%dT%H:%i:%s') AS last_time,
    COUNT(*)            AS upload_count
  FROM \`{TABLE}\`
  WHERE input_file LIKE ?
  GROUP BY input_file
  ORDER BY MIN(date_time_pdf) ASC
`;

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req,
    ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const date = req.query.date || new Date().toISOString().slice(0, 10);
  // GMG file names start with the publish date as ddmmyyyy → a LIKE prefix uses the
  // index on input_file instead of scanning (STR_TO_DATE/REGEXP defeated the index).
  const [pY, pM, pD] = date.split('-');
  const datePrefix   = `${pD}${pM}${pY}-%`;

  try {
    const [rajRows, mpcgRows, schedRows] = await Promise.all([
      query(JOURNEY_SQL.replace('{TABLE}', 'gmg_raj'),  [datePrefix]).catch(() => []),
      query(JOURNEY_SQL.replace('{TABLE}', 'gmg_mpcg'), [datePrefix]).catch(() => []),
      // Fetch edition name + scheduled page count from schedule table
      query(`SELECT UPPER(file_name) AS code, edition_name, unit, district, state, edition_type,
                    COUNT(*) AS scheduled_pages
             FROM page_schedule_time
             GROUP BY UPPER(file_name), edition_name, unit, district, state, edition_type`).catch(() => []),
    ]);

    // Build lookup: UPPER(code) → schedule info
    const schedMap = {};
    schedRows.forEach(s => { schedMap[s.code] = s; });

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

      // Look up proper name from page_schedule_time
      const sched = schedMap[edition_code.toUpperCase()] || {};

      if (isHidden(sched.edition_name)) return;

      if (!editionMap[key]) {
        editionMap[key] = {
          code:            edition_code,
          edition_name:    sched.edition_name  || edition_code,
          unit:            sched.unit          || '',
          district:        sched.district      || '',
          state:           sched.state         || '',
          edition_type:    sched.edition_type  || '',
          scheduled_pages: Number(sched.scheduled_pages || 0),
          region:          row.region,
          pageMap:         {},
        };
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
          // Release time: non-REV versions only, uploaded at or before 2:30 AM IST.
          // If all non-REV uploads are after 2:30 AM, caps at 02:30:00 of that date.
          const nonRev          = versions.filter(v => v.rev_no === 0);
          const basePool        = nonRev.length ? nonRev : versions;
          const pool230         = basePool.filter(v => isBefore230(v.last_time));
          let last_upload;
          if (pool230.length) {
            last_upload = pool230.reduce((max, v) =>
              (!max || (v.last_time && v.last_time > max)) ? v.last_time : max, null);
          } else {
            // All uploads after 2:30 AM — cap at 02:30:00 of that date
            const anyTime = (basePool[0]?.last_time || basePool[0]?.first_time || '').slice(0, 11);
            last_upload = anyTime ? `${anyTime}02:30:00` : null;
          }
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
        code:            ed.code,
        edition_name:    ed.edition_name,
        unit:            ed.unit,
        district:        ed.district,
        state:           ed.state,
        edition_type:    ed.edition_type,
        region:          ed.region,
        scheduled_pages: ed.scheduled_pages,
        pages,
        edition_first,
        edition_last,
        edition_duration,
        total_pages,
        revised_pages,
        total_uploads,
      };
    // Sort by edition_name for friendly display order
    }).sort((a, b) => (a.edition_name || a.code).localeCompare(b.edition_name || b.code))
    // ── Role-based scope (mirrors api/production.js) ──────────────────────
    .filter(e => {
      if (user.role === 'State Head' && user.state) {
        return normState(e.state) === normState(user.state);
      }
      if (user.role === 'Regional Editor') {
        if (user.state  && normState(e.state)  !== normState(user.state))              return false;
        if (user.branch && (e.unit || '').toLowerCase() !== user.branch.toLowerCase()) return false;
      }
      return true;
    });

    return res.json({ date, editions });

  } catch (err) {
    console.error('[page-journey]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
