/**
 * GET /api/production/weekly-trend
 *
 * Returns edition-wise delay data for a date range (default last 7 days).
 *
 * Query params:
 *   endDate   YYYY-MM-DD   (default: today)
 *   days      1–30         (default: 7)
 */
const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { query }                  = require('../_lib/mysql');

// ── Editions permanently excluded from all production views ───────────────────
const HIDDEN_EDITIONS = ['nt jaipur city', 'nt jaipur dak'];
const isHidden = name => HIDDEN_EDITIONS.includes((name || '').toLowerCase().trim());

// Normalise state name for comparison (mirrors api/production.js)
const normState = s => (s || '').trim().toLowerCase()
  .replace('rajasthan', 'raj').replace('madhya pradesh', 'mp').replace('chhattisgarh', 'cg');

// ── Same release-time query used in production.js & delay-report.js ───────────
// GMG file names start with the publish date as ddmmyyyy. One LIKE-prefix per day in
// [startISO, endISO] lets the index on input_file range-seek instead of scanning.
function gmgDateFilter(startISO, endISO) {
  const params = [];
  const d = new Date(startISO + 'T12:00:00'), end = new Date(endISO + 'T12:00:00');
  while (d <= end) {
    const [Y, M, D] = d.toISOString().slice(0, 10).split('-');
    params.push(`${D}${M}${Y}-%`);
    d.setDate(d.getDate() + 1);
  }
  return { clause: '(' + params.map(() => 'input_file LIKE ?').join(' OR ') + ')', params };
}

const RELEASES_SQL = (tbl, region, dateClause) => `
  SELECT
    DATE_FORMAT(STR_TO_DATE(LEFT(input_file, 8), '%d%m%Y'), '%Y-%m-%d')  AS pub_date,
    UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file, '-', 2), '-', -1)) AS code,
    MAX(date_time_pdf)                                                    AS release_time,
    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|')
                                                                          AS all_release_times,
    '${region}'                                                           AS region
  FROM \`${tbl}\`
  WHERE ${dateClause}
    AND date_time_pdf IS NOT NULL
    AND input_file NOT LIKE '%\\_REV\\_%'
  GROUP BY pub_date, code
`;

// Hard cutoff: exclude uploads after 2:30 AM on pub_date.
// Evening uploads (e.g. 22:58 PM the night before) are valid — they precede pub_date 02:30 AM.
function isBeforePubDate230(t, pubDate) {
  if (!t || !pubDate) return false;
  const tMs   = new Date(String(t).replace('T', ' ').slice(0, 19)).getTime();
  const capMs = new Date(`${pubDate} 02:30:00`).getTime();
  return tMs < capMs;
}

function pickLatestBefore230(allTimesStr, pubDate) {
  if (!allTimesStr) return null;
  const parts = String(allTimesStr).split('|').map(s => s.trim()).filter(Boolean);
  const valid = parts.find(t => !isNaN(new Date(t).getTime()) && isBeforePubDate230(t, pubDate));
  if (valid) return { ms: new Date(valid.replace('T', ' ').slice(0, 19)).getTime(), time: valid };
  const capped = `${pubDate} 02:30:00`;
  return { ms: new Date(capped).getTime(), time: capped };
}

function fmtDelay(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs  = Math.abs(Math.round(minutes));
  const h    = Math.floor(abs / 60);
  const m    = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management', 'Viewer']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // Optional state/branch filter from global selector
  const qState  = req.query.state  && req.query.state  !== 'All' ? req.query.state  : null;
  const qBranch = req.query.branch && req.query.branch !== 'All' ? req.query.branch : null;

  // ── Parse params ──────────────────────────────────────────────────────────
  const endDate = req.query.endDate || new Date().toISOString().slice(0, 10);
  const days    = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 30);

  // Build dates array [startDate … endDate], oldest first
  const end   = new Date(endDate);
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const startDate = dates[0];

  try {
    // ── Fetch releases from both tables ────────────────────────────────────
    const { clause: dateClause, params: dateParams } = gmgDateFilter(startDate, endDate);
    const [rajRows, mpcgRows] = await Promise.all([
      query(RELEASES_SQL('gmg_raj',  'RAJ',  dateClause), dateParams).catch(() => []),
      query(RELEASES_SQL('gmg_mpcg', 'MPCG', dateClause), dateParams).catch(() => []),
    ]);
    const releases = [...rajRows, ...mpcgRows];

    // ── Fetch schedule info ────────────────────────────────────────────────
    const schedRows = await query(
      `SELECT UPPER(file_name) AS code, state, unit, district,
              edition_name, edition_type, schedule_time
       FROM page_schedule_time`
    );
    const schedMap = {};
    schedRows.forEach(s => { schedMap[s.code] = s; });

    // ── Build edition × day matrix ─────────────────────────────────────────
    const editionMap = {};

    releases.forEach(r => {
      const sched = schedMap[r.code];
      if (!sched) return;

      // pub_date may come back as Date object or string depending on MySQL driver
      const pubDateStr = r.pub_date instanceof Date
        ? r.pub_date.toISOString().slice(0, 10)
        : String(r.pub_date).slice(0, 10);

      const [sh, sm]  = (sched.schedule_time || '00:00:00').split(':').map(Number);

      // Night editions (schedule_time >= 12:00) are actually for the previous calendar date
      const schedDate = new Date(pubDateStr);
      if (sh >= 12) schedDate.setDate(schedDate.getDate() - 1);
      schedDate.setHours(sh, sm, 0, 0);
      const schedMs = schedDate.getTime();

      // Use the most recent upload at or before 2:30 AM IST on pub_date.
      const allTimes   = r.all_release_times || String(r.release_time || '').replace('T', ' ').slice(0, 19);
      const best       = pickLatestBefore230(allTimes, pubDateStr);
      const releaseMs    = best ? best.ms : new Date(r.release_time).getTime();
      const release_time = best ? best.time : r.release_time;
      const delay_minutes = Math.min(Math.round((releaseMs - schedMs) / 60000), 149);
      const status = delay_minutes <= 0 ? 'ontime' : delay_minutes <= 30 ? 'warn' : 'late';

      if (isHidden(sched.edition_name)) return;

      if (!editionMap[r.code]) {
        editionMap[r.code] = {
          code:         r.code,
          edition_name: sched.edition_name || r.code,
          unit:         sched.unit         || '',
          district:     sched.district     || '',
          state:        sched.state        || '',
          region:       r.region,
          edition_type: sched.edition_type || '',
          days: {},
        };
      }

      editionMap[r.code].days[pubDateStr] = {
        delay_minutes,
        delay_hhmm:    fmtDelay(delay_minutes),
        status,
        release_time,
        schedule_time: sched.schedule_time,
      };
    });

    // ── Compute per-edition stats ──────────────────────────────────────────
    const editions = Object.values(editionMap).map(ed => {
      const dayVals     = Object.values(ed.days).map(d => d.delay_minutes);
      const delayed     = dayVals.filter(d => d > 0).length;
      const avgDelay    = dayVals.length
        ? Math.round(dayVals.reduce((a, b) => a + b, 0) / dayVals.length)
        : 0;
      const maxDelay    = dayVals.length ? Math.max(...dayVals) : 0;
      return {
        ...ed,
        delayed_days: delayed,
        avg_delay:    avgDelay,
        max_delay:    maxDelay,
        data_days:    dayVals.length,
      };
    }).filter(ed => {
      // Role-based scope
      if (user.role === 'State Head' && user.state) {
        if (normState(ed.state) !== normState(user.state)) return false;
      }
      if (user.role === 'Regional Editor') {
        if (user.state  && normState(ed.state) !== normState(user.state))             return false;
        if (user.branch && (ed.unit || '').toLowerCase() !== user.branch.toLowerCase()) return false;
      }
      // Global selector filters
      if (qState  && normState(ed.state) !== normState(qState))               return false;
      if (qBranch && (ed.unit || '').toLowerCase() !== qBranch.toLowerCase()) return false;
      return true;
    }).sort((a, b) => b.avg_delay - a.avg_delay); // worst-first default

    return res.json({ dates, startDate, endDate, days, editions });

  } catch (err) {
    console.error('[weekly-trend]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
