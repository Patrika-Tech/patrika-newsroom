/**
 * GET /api/production?date=YYYY-MM-DD
 * Returns branch-wise schedule vs actual release time with delay for
 * Rajasthan (gmg_raj) and MP/CG (gmg_mpcg) editions.
 *
 * input_file format: DDMMYYYY-CODE-PageNum[_REV_N].pdf
 * Joins with page_schedule_time on UPPER(file_name) = UPPER(code)
 * Takes MAX(date_time_pdf) per pub_date + code combination.
 * Delay accounts for midnight crossover (evening schedules use pub_date-1).
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

// ── Editions permanently excluded from all production views ───────────────────
const HIDDEN_EDITIONS = ['nt jaipur city', 'nt jaipur dak'];
const isHidden = name => HIDDEN_EDITIONS.includes((name || '').toLowerCase().trim());

// ── State normalizer — maps full names ↔ short codes used in page_schedule_time ──
// page_schedule_time.state values: 'Raj', 'MP', 'CG', 'Metro'
// users.state values:              'Rajasthan', 'MP', 'CG', 'Metro'
const STATE_NORM = {
  'rajasthan': 'raj', 'raj': 'raj',
  'mp': 'mp', 'madhya pradesh': 'mp',
  'cg': 'cg', 'chhattisgarh': 'cg',
  'metro': 'metro',
};
function normState(s) {
  return STATE_NORM[(s || '').toLowerCase().trim()] || (s || '').toLowerCase().trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Hard cutoff: no upload after 2:30 AM IST is used for release time.
// Times stored as IST in DB — extract HH:MM directly from the string.
function isBefore230(t) {
  const m = String(t || '').match(/[T ](\d{2}):(\d{2})/);
  if (!m) return false;
  const h = +m[1], min = +m[2];
  return h < 2 || (h === 2 && min <= 30);
}

// From pipe-separated DESC timestamps, return the most recent upload at or before 2:30 AM IST.
// If ALL uploads are after 2:30 AM, caps at 02:30:00 of that date.
function pickLatestBefore230(allTimesStr) {
  if (!allTimesStr) return null;
  const parts = String(allTimesStr).split('|').map(s => s.trim()).filter(Boolean);
  const valid = parts.find(t => !isNaN(new Date(t).getTime()) && isBefore230(t));
  if (valid) return { ms: new Date(valid).getTime(), time: valid };
  // All after 2:30 AM — cap at 02:30:00 of that date
  const dateStr = (parts[0] || '').slice(0, 10);
  if (!dateStr) return null;
  const capped = `${dateStr} 02:30:00`;
  return { ms: new Date(capped).getTime(), time: capped };
}

function fmtDelay(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const sign = minutes < 0 ? '-' : '+';
  const abs  = Math.abs(Math.round(minutes));
  const h    = Math.floor(abs / 60);
  const m    = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Core query — works for either gmg table ────────────────────────────────────
const RELEASES_SQL = (tbl, region) => `
  SELECT
    STR_TO_DATE(LEFT(input_file, 8), '%d%m%Y')                              AS pub_date,
    UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file, '-', 2), '-', -1))   AS code,
    MAX(date_time_pdf)                                                       AS release_time,
    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|')
                                                                             AS all_release_times,
    '${region}'                                                              AS region
  FROM \`${tbl}\`
  WHERE input_file LIKE ?
    AND date_time_pdf IS NOT NULL
    AND input_file NOT LIKE '%\\_REV\\_%'
  GROUP BY pub_date, code
`;

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // Optional state/branch filter from global selector
  const qState  = req.query.state  && req.query.state  !== 'All' ? req.query.state  : null;
  const qBranch = req.query.branch && req.query.branch !== 'All' ? req.query.branch : null;

  // Default to today's date (YYYY-MM-DD)
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  // GMG file names start with the publish date as ddmmyyyy → a LIKE prefix uses the
  // index on input_file instead of scanning (STR_TO_DATE/REGEXP defeated the index).
  const [pY, pM, pD] = date.split('-');
  const datePrefix   = `${pD}${pM}${pY}-%`;

  try {
    // ── 1. Fetch releases from both GMG tables ─────────────────────────────
    const [rajRows, mpcgRows] = await Promise.all([
      query(RELEASES_SQL('gmg_raj',  'RAJ'),  [datePrefix]).catch(() => []),
      query(RELEASES_SQL('gmg_mpcg', 'MPCG'), [datePrefix]).catch(() => []),
    ]);

    const releases = [...rajRows, ...mpcgRows];
    if (!releases.length) {
      return res.json({ date, summary: { total: 0, onTime: 0, delayed: 0, avgDelay: 0, maxDelay: 0 }, editions: [] });
    }

    // ── 2. Get all schedule_time entries ──────────────────────────────────
    const schedRows = await query(
      `SELECT UPPER(file_name) AS code, file_name, state, unit, district,
              edition_name, edition_type, schedule_time
       FROM page_schedule_time`
    );
    const schedMap = {};
    schedRows.forEach(s => { schedMap[s.code] = s; });

    // ── 3. Join & compute delay ───────────────────────────────────────────
    const pubDate = new Date(date); // YYYY-MM-DD

    const editions = releases
      .map(r => {
        const sched = schedMap[r.code];
        if (!sched) return null;
        if (isHidden(sched.edition_name)) return null;

        // Build scheduled datetime accounting for midnight crossover
        // Schedule times ≥ 12:00 happen the previous calendar day
        const [sh, sm] = (sched.schedule_time || '00:00:00').split(':').map(Number);
        const schedDate = new Date(pubDate);
        if (sh >= 12) schedDate.setDate(schedDate.getDate() - 1); // previous night
        schedDate.setHours(sh, sm, 0, 0);
        const schedMs = schedDate.getTime();

        // Use the most recent upload at or before 2:30 AM IST.
        // Uploads after 2:30 AM (revisions, late corrections) are ignored.
        // If all uploads are after 2:30 AM, release_time is capped at 02:30:00.
        const allTimes   = r.all_release_times || String(r.release_time || '').replace('T', ' ').slice(0, 19);
        const best       = pickLatestBefore230(allTimes);
        const releaseMs    = best ? best.ms : new Date(r.release_time).getTime();
        const release_time = best ? best.time : r.release_time;
        const delay_minutes = Math.min(Math.round((releaseMs - schedMs) / 60000), 149);

        return {
          code:         r.code,
          file_name:    sched.file_name,
          edition_name: sched.edition_name  || r.code,
          edition_type: sched.edition_type  || '',
          unit:         sched.unit          || '',
          district:     sched.district      || '',
          state:        sched.state         || '',
          region:       r.region,
          schedule_time: sched.schedule_time,
          release_time,
          delay_minutes,
          delay_hhmm:   fmtDelay(delay_minutes),
          status:       delay_minutes <= 0 ? 'ontime' : delay_minutes <= 30 ? 'warn' : 'late',
        };
      })
      .filter(Boolean)
      // ── Role-based scope: normalise 'Rajasthan'→'raj' etc. before comparing ──
      .filter(e => {
        if (user.role === 'State Head' && user.state) {
          return normState(e.state) === normState(user.state);
        }
        if (user.role === 'Regional Editor') {
          if (user.state  && normState(e.state) !== normState(user.state))             return false;
          if (user.branch && (e.unit || '').toLowerCase() !== user.branch.toLowerCase()) return false;
        }
        // Apply global selector filters (Admin / State Head choosing a scope)
        if (qState  && normState(e.state) !== normState(qState))               return false;
        if (qBranch && (e.unit || '').toLowerCase() !== qBranch.toLowerCase()) return false;
        return true;
      })
      .sort((a, b) => b.delay_minutes - a.delay_minutes);

    // ── 4. Summary stats ──────────────────────────────────────────────────
    const total    = editions.length;
    const onTime   = editions.filter(e => e.status === 'ontime').length;
    const delayed  = editions.filter(e => e.status !== 'ontime').length;
    const delays   = editions.map(e => e.delay_minutes).filter(d => d > 0);
    const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
    const maxDelay = delays.length ? Math.max(...delays) : 0;

    return res.json({
      date,
      summary: { total, onTime, delayed, avgDelay, maxDelay },
      editions,
    });

  } catch (err) {
    console.error('[production]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
