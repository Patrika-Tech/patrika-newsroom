/**
 * GET /api/dashboard?state=&branch=
 * Real data from MySQL — no mock values.
 *
 * Sources:
 *   user                        → active employee count + profile breakdown
 *   daily_achievment_count_ecms → 7-day story/photo trend
 *   qc_review                   → today's QC mistakes + 7-day trend
 *   visit_report                → today's field visits
 *   gmg_raj + gmg_mpcg          → yesterday's edition delays
 *   page_schedule_time          → scheduled times for delay calc
 *   legal_cases                 → active case count
 *   alerts                      → unread alert count
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

const TABLE = process.env.MYSQL_TABLE_EMPLOYEES || 'user';

// Normalise state names → page_schedule_time short codes
const STATE_NORM = { rajasthan:'raj','raj':'raj', mp:'mp','madhya pradesh':'mp', cg:'cg', chhattisgarh:'cg', metro:'metro' };
const normState = s => STATE_NORM[(s||'').toLowerCase().trim()] || (s||'').toLowerCase().trim();

// Hidden editions (same as production views)
const HIDDEN_EDITIONS = ['nt jaipur city', 'nt jaipur dak'];
const isHidden = name => HIDDEN_EDITIONS.includes((name || '').toLowerCase().trim());

// Walk release timestamps DESC; return first with delay < 240 min, else earliest
function pickReleaseTime(allTimesStr, schedMs) {
  if (!allTimesStr) return null;
  const parts = String(allTimesStr).split('|').map(s => s.trim()).filter(Boolean);
  for (const t of parts) {
    const ms = new Date(t).getTime();
    if (isNaN(ms)) continue;
    if (Math.round((ms - schedMs) / 60000) < 240) return { ms, time: t };
  }
  const last = parts[parts.length - 1];
  return last ? { ms: new Date(last).getTime(), time: last } : null;
}

function fmtDelay(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs  = Math.abs(Math.round(minutes));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  try {
    // ── Resolve effective state/branch ────────────────────────────────────────
    let state  = req.query.state  || '';
    let branch = req.query.branch || '';
    if (user.role === 'State Head'      && user.state)  { state = user.state; }  // branch stays as selected
    if (user.role === 'Regional Editor') {
      if (user.state)  state  = user.state;
      if (user.branch) branch = user.branch;
    }
    const filterState  = state  && state  !== 'All' ? state  : '';
    const filterBranch = branch && branch !== 'All' ? branch : '';

    // ── Date helpers ──────────────────────────────────────────────────────────
    const toIST    = ms => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
    const todayStr = toIST(Date.now());
    const ydayStr  = toIST(Date.now() - 864e5);
    const trend7Str= toIST(Date.now() - 7 * 864e5);
    // GMG file names begin with the publish date as ddmmyyyy (e.g. "20062026-…").
    // Match that prefix with LIKE so the existing index on input_file can range-seek,
    // instead of STR_TO_DATE/REGEXP on the column (which forced a full table scan).
    const ddmmyyyy       = s => { const [Y, M, D] = s.split('-'); return D + M + Y; };
    const todayGmgPrefix = ddmmyyyy(todayStr) + '-%';

    // ── WHERE helpers ─────────────────────────────────────────────────────────
    const empWhere    = ["(is_emp_working = 1 OR Status = 'Working' OR Status = 'Active')"];
    const empParams   = [];
    const legalWhere  = ["status = 'Active'"];
    const legalParams = [];
    const ecmsWhere   = [];  const ecmsParams  = [];
    const visitWhere  = [];  const visitParams = [];
    const qcWhere     = [];  const qcParams    = [];

    if (filterState) {
      empWhere.push('State = ?');     empParams.push(filterState);
      legalWhere.push('state = ?');   legalParams.push(filterState);
      // qc_review.state is always empty; filter via edition↔Branch subquery instead
      qcWhere.push('edition IN (SELECT DISTINCT Branch FROM `user` WHERE State = ?)'); qcParams.push(filterState);
      ecmsWhere.push('Pan_no IN (SELECT pan_no FROM `user` WHERE State = ?)');  ecmsParams.push(filterState);
      visitWhere.push('pan_no IN (SELECT pan_no FROM `user` WHERE State = ?)'); visitParams.push(filterState);
    }
    if (filterBranch) {
      empWhere.push('Branch = ?');    empParams.push(filterBranch);
      legalWhere.push('branch = ?');  legalParams.push(filterBranch);
      qcWhere.push('edition = ?');    qcParams.push(filterBranch);
      ecmsWhere.push('Pan_no IN (SELECT pan_no FROM `user` WHERE Branch = ?)');  ecmsParams.push(filterBranch);
      visitWhere.push('pan_no IN (SELECT pan_no FROM `user` WHERE Branch = ?)'); visitParams.push(filterBranch);
    }

    const ecmsExtra  = ecmsWhere.length  ? ' AND ' + ecmsWhere.join(' AND ')  : '';
    const visitExtra = visitWhere.length ? ' AND ' + visitWhere.join(' AND ') : '';
    const qcExtra    = qcWhere.length    ? ' AND ' + qcWhere.join(' AND ')    : '';

    // ── Run all queries in parallel ───────────────────────────────────────────
    // Reporter target query params (built separately to use qualified column names in the JOIN)
    const repWhere  = ['(u.is_emp_working = 1 OR u.Status = \'Working\' OR u.Status = \'Active\')',
      `(LOWER(TRIM(u.Story_Type)) LIKE '%reporter%'
         OR LOWER(TRIM(u.Story_Type)) = 'stringer'
         OR (LOWER(TRIM(u.Story_Type)) = 'ne'
             AND (LOWER(TRIM(u.profile)) LIKE '%reporter%' OR LOWER(TRIM(u.profile)) = 'stringer')))`];
    const repParams = [ydayStr];
    if (filterState)  { repWhere.push('u.State = ?');  repParams.push(filterState);  }
    if (filterBranch) { repWhere.push('u.Branch = ?'); repParams.push(filterBranch); }

    const [
      empRows, empProfiles,
      storiesYday, storyTrend,
      qcToday, qcTrend,
      visitsToday,
      legalRows, alertRows,
      schedRows, rajRows, mpcgRows,
      reporterTarget,
    ] = await Promise.all([

      // 1. Active employee count
      query(`SELECT COUNT(*) AS cnt FROM \`${TABLE}\` WHERE ${empWhere.join(' AND ')}`, empParams)
        .catch(() => [{ cnt: 0 }]),

      // 2. Profile breakdown (Story_Type) for active employees
      query(`SELECT TRIM(Story_Type) AS profile, COUNT(*) AS cnt
             FROM \`${TABLE}\` WHERE ${empWhere.join(' AND ')} AND Story_Type IS NOT NULL AND Story_Type != ''
             GROUP BY TRIM(Story_Type) ORDER BY cnt DESC`, empParams)
        .catch(() => []),

      // 3. Stories published yesterday
      query(`SELECT SUM(No_Story) AS stories, SUM(No_Photo) AS photos, SUM(No_Words) AS words,
                    COUNT(DISTINCT Pan_no) AS reporters
             FROM daily_achievment_count_ecms
             WHERE entrydate = ?${ecmsExtra}`,
             [ydayStr, ...ecmsParams]).catch(() => [{}]),

      // 4. 7-day story trend
      query(`SELECT DATE_FORMAT(entrydate, '%Y-%m-%d') AS d, SUM(No_Story) AS stories,
                    SUM(No_Photo) AS photos, SUM(Exclusive) AS exclusive
             FROM daily_achievment_count_ecms
             WHERE entrydate BETWEEN ? AND ?${ecmsExtra}
             GROUP BY DATE_FORMAT(entrydate, '%Y-%m-%d') ORDER BY d ASC`,
             [trend7Str, ydayStr, ...ecmsParams]).catch(() => []),

      // 5. QC mistakes last 7 days
      query(`SELECT COUNT(*) AS checks, SUM(no_of_mistake) AS mistakes
             FROM qc_review WHERE entrydate BETWEEN ? AND ?${qcExtra}`,
             [trend7Str, ydayStr, ...qcParams]).catch(() => [{}]),

      // 6. QC 7-day trend
      query(`SELECT DATE_FORMAT(entrydate, '%Y-%m-%d') AS d, SUM(no_of_mistake) AS mistakes
             FROM qc_review WHERE entrydate BETWEEN ? AND ?${qcExtra}
             GROUP BY DATE_FORMAT(entrydate, '%Y-%m-%d') ORDER BY d ASC`,
             [trend7Str, ydayStr, ...qcParams]).catch(() => []),

      // 7. Field visits yesterday
      query(`SELECT COUNT(*) AS cnt FROM visit_report WHERE visit_date = ?${visitExtra}`,
             [ydayStr, ...visitParams]).catch(() => [{ cnt: 0 }]),

      // 8. Active legal cases
      query(`SELECT COUNT(*) AS cnt FROM legal_cases WHERE ${legalWhere.join(' AND ')}`, legalParams)
        .catch(() => [{ cnt: 0 }]),

      // 9. Unread alerts
      query('SELECT COUNT(*) AS cnt FROM alerts WHERE is_read = 0')
        .catch(() => [{ cnt: 0 }]),

      // 10. Schedule times
      query('SELECT UPPER(file_name) AS code, unit, state, edition_name, schedule_time FROM page_schedule_time')
        .catch(() => []),

      // 11. Today's GMG releases — Rajasthan
      query(`SELECT UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file,'-',2),'-',-1)) AS code,
                    MAX(date_time_pdf) AS release_time,
                    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|') AS all_release_times
             FROM gmg_raj
             WHERE input_file LIKE ? AND date_time_pdf IS NOT NULL
             GROUP BY code`, [todayGmgPrefix]).catch(() => []),

      // 12. Today's GMG releases — MP/CG
      query(`SELECT UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file,'-',2),'-',-1)) AS code,
                    MAX(date_time_pdf) AS release_time,
                    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|') AS all_release_times
             FROM gmg_mpcg
             WHERE input_file LIKE ? AND date_time_pdf IS NOT NULL
             GROUP BY code`, [todayGmgPrefix]).catch(() => []),

      // 13. Reporter 5-story target — yesterday
      query(`SELECT
               COUNT(DISTINCT u.pan_no) AS total_reporters,
               COUNT(DISTINCT CASE WHEN COALESCE(d.No_Story, 0) >= 5 THEN u.pan_no END) AS hit_target
             FROM \`${TABLE}\` u
             LEFT JOIN daily_achievment_count_ecms d
               ON u.pan_no = d.Pan_no AND d.entrydate = ?
             WHERE ${repWhere.join(' AND ')}`,
             repParams).catch(() => [{}]),
    ]);

    // ── Compute edition delays ────────────────────────────────────────────────
    const schedMap = {};
    schedRows.forEach(s => { schedMap[s.code] = s; });

    const pubDate = new Date(todayStr);
    const allReleases = [...rajRows, ...mpcgRows];

    const editionDelays = allReleases
      .map(r => {
        const sched = schedMap[r.code];
        if (!sched) return null;
        // Skip hidden editions
        if (isHidden(sched.edition_name)) return null;
        // Filter by state/branch if applicable
        if (filterState && normState(sched.state) !== normState(filterState)) return null;
        if (filterBranch && (sched.unit || '').toLowerCase() !== filterBranch.toLowerCase()) return null;

        const [sh, sm] = (sched.schedule_time || '00:00:00').split(':').map(Number);
        const schedDate = new Date(pubDate);
        if (sh >= 12) schedDate.setDate(schedDate.getDate() - 1);
        schedDate.setHours(sh, sm, 0, 0);
        const schedMs = schedDate.getTime();

        // Use pickReleaseTime to avoid inflated delays from late re-uploads
        const maxMs = new Date(r.release_time).getTime();
        let releaseMs = maxMs;
        if (Math.round((maxMs - schedMs) / 60000) >= 240) {
          const best = pickReleaseTime(r.all_release_times, schedMs);
          if (best && best.ms !== maxMs) releaseMs = best.ms;
        }

        // Hard cap at 239 min (3h 59m)
        const delay_minutes = Math.min(Math.round((releaseMs - schedMs) / 60000), 239);
        return {
          edition:    sched.edition_name || sched.unit || r.code,
          unit:       sched.unit || '',
          delay:      delay_minutes,
          delay_hhmm: fmtDelay(delay_minutes),
          status:     delay_minutes <= 0 ? 'ontime' : delay_minutes <= 30 ? 'warn' : 'late',
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.delay - a.delay)
      .slice(0, 15); // top 15 for chart

    // ── Format 7-day trend (fill missing days) ────────────────────────────────
    const storyTrendMap = {};
    storyTrend.forEach(r => {
      const d = r.d ? String(r.d).slice(0, 10) : '';
      if (d) storyTrendMap[d] = r;
    });
    const qcTrendMap = {};
    qcTrend.forEach(r => {
      const d = r.d ? String(r.d).slice(0, 10) : '';
      if (d) qcTrendMap[d] = r;
    });

    const trend7days = [];
    for (let i = 6; i >= 0; i--) {
      const ds    = toIST(Date.now() - (i + 1) * 864e5);
      const label = new Date(ds + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      trend7days.push({
        date:    ds,
        label,
        stories:  Number(storyTrendMap[ds]?.stories  || 0),
        photos:   Number(storyTrendMap[ds]?.photos   || 0),
        exclusive:Number(storyTrendMap[ds]?.exclusive|| 0),
        mistakes: Number(qcTrendMap[ds]?.mistakes    || 0),
      });
    }

    // ── Profile pie ───────────────────────────────────────────────────────────
    const profilePie = empProfiles.map(r => ({
      name:  (r.profile || 'Unknown').trim(),
      value: Number(r.cnt),
    }));

    // ── Summarise delays ──────────────────────────────────────────────────────
    const delayedCount = editionDelays.filter(e => e.status !== 'ontime').length;
    const onTimeCount  = editionDelays.filter(e => e.status === 'ontime').length;

    return res.json({
      kpis: {
        employees:       Number(empRows[0]?.cnt    || 0),
        stories:         Number(storiesYday[0]?.stories || 0),
        reporters:       Number(storiesYday[0]?.reporters || 0),
        photos:          Number(storiesYday[0]?.photos  || 0),
        reporterHit:     Number(reporterTarget[0]?.hit_target    || 0),
        totalReporters:  Number(reporterTarget[0]?.total_reporters || 0),
        visits:          Number(visitsToday[0]?.cnt || 0),
        qcMistakes:   Number(qcToday[0]?.mistakes || 0),
        legal:        Number(legalRows[0]?.cnt || 0),
        alerts:       Number(alertRows[0]?.cnt || 0),
        editions:     editionDelays.length,
        delayed:      delayedCount,
        onTime:       onTimeCount,
      },
      trend7days,
      profilePie,
      editionDelays,
    });

  } catch (err) {
    console.error('[dashboard]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
