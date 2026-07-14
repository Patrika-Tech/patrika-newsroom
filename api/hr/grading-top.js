'use strict';
/**
 * GET /api/hr/grading-top?state=X&branch=Y
 *
 * Returns top-3 and worst-3 employees for the previous calendar month.
 * Score = (manual_sum/20 + auto_total/25) / 2 * 100  (combined, same as grading tab).
 * Falls back to manual-only if auto data isn't available for an employee.
 */
const { setCors, handleOptions } = require('../_lib/cors');
const { requireRole }            = require('../_lib/auth');
const { query }                  = require('../_lib/mysql');

const VIEW_ROLES = ['Admin', 'HR', 'Management', 'State Head', 'Regional Editor'];

// ── Scoring functions (mirror grading-auto.js) ────────────────────────────────
const scoreStories = n => n >= 60 ? 5 : n >= 45 ? 4 : n >= 30 ? 3 : n >= 15 ? 2 : n >= 1 ? 1 : 0;
const scoreVisits  = n => n >= 20 ? 5 : n >= 15 ? 4 : n >= 10 ? 3 : n >= 5  ? 2 : n >= 1 ? 1 : 0;
const scoreQC      = n => n === 0 ? 5 : n <= 2 ? 4 : n <= 5 ? 3 : n <= 9 ? 2 : n <= 14 ? 1 : 0;
const scoreAttend  = p => p === null ? 5 : p >= 95 ? 5 : p >= 90 ? 4 : p >= 85 ? 3 : p >= 75 ? 2 : p >= 60 ? 1 : 0;
const scoreDelay   = m => m === null ? 5 : m <= 5 ? 5 : m <= 15 ? 4 : m <= 30 ? 3 : m <= 60 ? 2 : m <= 90 ? 1 : 0;

const PRESENT_TYPES = ['P', 'MP', 'WFH', 'OD', 'T', 'TL', 'SU', 'ES', 'SPL', 'WOP', 'PH', 'WOHP'];
const ABSENT_TYPES  = ['A', 'LW'];

function prevMonth() {
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() - 1);
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

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
  if (valid) return new Date(valid.replace('T', ' ').slice(0, 19)).getTime();
  return new Date(`${pubDate} 02:30:00`).getTime();
}

const GMG_SQL = tbl => `
  SELECT
    LEFT(input_file, 8)                                                     AS ddmmyyyy,
    UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file, '-', 2), '-', -1))    AS code,
    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|')
                                                                            AS all_release_times
  FROM \`${tbl}\`
  WHERE input_file LIKE ?
    AND date_time_pdf IS NOT NULL
    AND input_file NOT LIKE '%\\_REV\\_%'
  GROUP BY ddmmyyyy, code
`;

async function fetchAutoScores(month) {
  const [yyyy, mm] = month.split('-');
  const start   = `${month}-01`;
  const endD    = new Date(start); endD.setMonth(endD.getMonth() + 1);
  const end     = endD.toISOString().slice(0, 10);
  const pattern = `__${mm}${yyyy}-%`;

  const [emps, ecms, visits, qc1, qc2, attend, rajRows, mpcgRows, schedRows] =
    await Promise.all([
      query(`SELECT id, pan_no, Branch FROM \`user\`
             WHERE pan_no IS NOT NULL AND pan_no != ''
               AND (is_emp_working = 1 OR Status IN ('Working','Active'))`),
      query(`SELECT Pan_no AS pan, SUM(No_Story) AS stories
             FROM daily_achievment_count_ecms
             WHERE entrydate >= ? AND entrydate < ? GROUP BY Pan_no`, [start, end]).catch(() => []),
      query(`SELECT pan_no AS pan, COUNT(*) AS visits
             FROM visit_report
             WHERE visit_date >= ? AND visit_date < ? GROUP BY pan_no`, [start, end]).catch(() => []),
      query(`SELECT responsible_1 AS uid, SUM(no_of_mistake) AS mistakes
             FROM qc_review
             WHERE entrydate >= ? AND entrydate < ? AND responsible_1 > 0
             GROUP BY responsible_1`, [start, end]).catch(() => []),
      query(`SELECT responsible_2 AS uid, SUM(no_of_mistake) AS mistakes
             FROM qc_review
             WHERE entrydate >= ? AND entrydate < ? AND responsible_2 > 0
             GROUP BY responsible_2`, [start, end]).catch(() => []),
      query(`SELECT pan_no AS pan,
                    SUM(att_type IN (${PRESENT_TYPES.map(() => '?').join(',')})) AS present,
                    SUM(att_type IN (${ABSENT_TYPES.map(() => '?').join(',')}))  AS absent
             FROM hrms_data
             WHERE att_date >= ? AND att_date < ?
             GROUP BY pan_no`, [...PRESENT_TYPES, ...ABSENT_TYPES, start, end]).catch(() => []),
      query(GMG_SQL('gmg_raj'),  [pattern]).catch(() => []),
      query(GMG_SQL('gmg_mpcg'), [pattern]).catch(() => []),
      query(`SELECT UPPER(file_name) AS code, unit, schedule_time FROM page_schedule_time`).catch(() => []),
    ]);

  // Build branch delay map
  const schedMap = {};
  schedRows.forEach(s => { schedMap[s.code] = s; });
  const sums = {};
  [...rajRows, ...mpcgRows].forEach(r => {
    const sched = schedMap[r.code];
    if (!sched || !sched.unit) return;
    const dd = r.ddmmyyyy.slice(0, 2), mo = r.ddmmyyyy.slice(2, 4), yr = r.ddmmyyyy.slice(4, 8);
    const pubDate = `${yr}-${mo}-${dd}`;
    if (isNaN(new Date(pubDate).getTime())) return;
    const [sh, sm] = (sched.schedule_time || '00:00:00').split(':').map(Number);
    const schedDate = new Date(pubDate);
    if (sh >= 12) schedDate.setDate(schedDate.getDate() - 1);
    schedDate.setHours(sh, sm, 0, 0);
    const releaseMs = pickLatestBefore230(r.all_release_times, pubDate);
    const delay     = Math.max(0, Math.min(Math.round((releaseMs - schedDate.getTime()) / 60000), 149));
    const key = sched.unit.toLowerCase();
    if (!sums[key]) sums[key] = { total: 0, count: 0 };
    sums[key].total += delay;
    sums[key].count++;
  });
  const branchDelay = {};
  Object.entries(sums).forEach(([k, v]) => { branchDelay[k] = Math.round(v.total / v.count); });

  const ecmsMap  = {}; ecms.forEach(r  => { ecmsMap[(r.pan || '').toUpperCase()]  = Number(r.stories) || 0; });
  const visitMap = {}; visits.forEach(r => { visitMap[(r.pan || '').toUpperCase()] = Number(r.visits)  || 0; });
  const attendMap = {}; attend.forEach(r => { attendMap[(r.pan || '').toUpperCase()] = r; });
  const qcByUid = {};
  [...qc1, ...qc2].forEach(r => { qcByUid[r.uid] = (qcByUid[r.uid] || 0) + (Number(r.mistakes) || 0); });

  const autoMap = {};
  emps.forEach(e => {
    const pan      = (e.pan_no || '').toUpperCase();
    const stories  = ecmsMap[pan]  || 0;
    const visitCnt = visitMap[pan] || 0;
    const mistakes = qcByUid[e.id] || 0;
    const att      = attendMap[pan];
    let attendPct  = null;
    if (att && (Number(att.present) + Number(att.absent)) > 0) {
      attendPct = Math.round((Number(att.present) / (Number(att.present) + Number(att.absent))) * 100);
    }
    const delayAvg = e.Branch ? (branchDelay[(e.Branch || '').toLowerCase()] ?? null) : null;
    const total = scoreStories(stories) + scoreVisits(visitCnt) + scoreQC(mistakes) +
                  scoreAttend(attendPct) + scoreDelay(delayAvg);
    autoMap[pan] = total;  // 0–25
  });

  return autoMap;  // pan_upper → auto total out of 25
}

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, VIEW_ROLES);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const month  = prevMonth();
  const state  = (req.query.state  || '').trim();
  const branch = (req.query.branch || '').trim();

  try {
    const where  = ['g.month = ?'];
    const params = [month];
    if (state  && state  !== 'All') { where.push('g.state = ?');  params.push(state);  }
    if (branch && branch !== 'All') { where.push('g.branch = ?'); params.push(branch); }

    const [rows, autoMap] = await Promise.all([
      query(
        `SELECT
           g.pan,
           COALESCE(g.emp_name, u.EMPNAME)                                       AS name,
           COALESCE(g.branch,   u.Branch)                                        AS branch,
           CASE WHEN u.Story_Type = 'NE' THEN COALESCE(u.profile, 'NE')
                ELSE COALESCE(u.Story_Type, '—') END                             AS story_type,
           CAST(COALESCE(g.work_grade,       '0') AS UNSIGNED) AS w,
           CAST(COALESCE(g.behaviour_grade,  '0') AS UNSIGNED) AS b,
           CAST(COALESCE(g.discipline_grade, '0') AS UNSIGNED) AS d,
           CAST(COALESCE(g.interest_grade,   '0') AS UNSIGNED) AS i
         FROM hr_grading g
         LEFT JOIN \`user\` u ON UPPER(u.pan_no) = UPPER(g.pan)
         WHERE ${where.join(' AND ')}
           AND COALESCE(g.work_grade, g.behaviour_grade, g.discipline_grade, g.interest_grade) IS NOT NULL`,
        params
      ),
      fetchAutoScores(month).catch(() => ({})),
    ]);

    if (!rows.length) return res.json({ month, top3: [], worst3: [], total: 0 });

    const scored = rows.map(r => {
      const manSum  = (Number(r.w)||0) + (Number(r.b)||0) + (Number(r.d)||0) + (Number(r.i)||0);
      const panUp   = (r.pan || '').toUpperCase();
      const autoTotal = autoMap[panUp];

      let scorePct;
      if (manSum > 0 && autoTotal != null) {
        // Combined: exact same formula as grading tab — (manualSum + autoTotal) / 45 × 100
        scorePct = Math.round(((manSum + autoTotal) / 45) * 100);
      } else if (autoTotal != null) {
        scorePct = Math.round((autoTotal / 25) * 100);
      } else {
        scorePct = Math.round((manSum / 20) * 100);
      }

      return {
        pan:        r.pan,
        name:       r.name || r.pan,
        branch:     r.branch || '—',
        story_type: r.story_type || '—',
        score_pct:  Math.min(100, Math.max(0, scorePct)),
      };
    }).filter(e => e.score_pct > 0);

    scored.sort((a, b) => b.score_pct - a.score_pct);

    return res.json({
      month,
      top3:   scored.slice(0, 3),
      worst3: scored.slice(-3).reverse(),
      total:  scored.length,
    });
  } catch (err) {
    console.error('[grading-top]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
