/**
 * GET /api/alerts/live — real-time computed alert feed (no stored rows).
 *
 * Scans live operational data and emits alerts:
 *   · Edition delays today (≥30 min late)              → high
 *   · Branches with reporters but ZERO stories yday    → high
 *   · Overdue tasks                                    → high
 *   · QC mistake spike (yday vs 7-day daily average)   → med
 *   · Weekly action plans awaiting review/grade        → med
 *   · High-priority feedback still open                → med
 *   · Employees retiring within 60 days                → low
 *
 * Each alert: { id, type, sev, text, time, link, count }
 * `link` is a frontend route the alert deep-links to.
 */
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const HIDDEN_EDITIONS = ['nt jaipur city', 'nt jaipur dak'];
const isHidden = name => HIDDEN_EDITIONS.includes((name || '').toLowerCase().trim());

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

function calcRetireDate(dob) {
  if (!dob) return null;
  const parts = String(dob).split('-');
  let d;
  if (parts[0]?.length === 4) d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  else                        d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  if (isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 58);
  return d;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'Management', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // ── Role scope: role locks take priority; Admin/Mgmt can pass global filters ─
  let fState  = (user.role === 'State Head' || user.role === 'Regional Editor') ? (user.state  || '') : '';
  let fBranch = (user.role === 'Regional Editor')                               ? (user.branch || '') : '';
  if (user.role === 'Admin' || user.role === 'Management') {
    if (req.query.state  && req.query.state  !== 'All') fState  = req.query.state;
    if (req.query.branch && req.query.branch !== 'All') fBranch = req.query.branch;
  }
  const STATE_NORM = { rajasthan:'raj', raj:'raj', mp:'mp', 'madhya pradesh':'mp', cg:'cg', chhattisgarh:'cg', metro:'metro' };
  const normState = s => STATE_NORM[(s||'').toLowerCase().trim()] || (s||'').toLowerCase().trim();

  const toIST    = ms => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
  const todayStr = toIST(Date.now());
  const ydayStr  = toIST(Date.now() - 864e5);
  const d2Str    = toIST(Date.now() - 2 * 864e5);
  const d7Str    = toIST(Date.now() - 8 * 864e5);
  // last-week Monday (IST)
  const istDay   = new Date(Date.now() + 5.5 * 3600000).getDay();
  const lwMonStr = toIST(Date.now() - (istDay === 0 ? 13 : istDay + 6) * 864e5);
  const ddmmyyyy = s => { const [Y, M, D] = s.split('-'); return D + M + Y; };
  const nowLabel = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(11, 16);

  try {
    const LEAVE_EXCL = `'P','MP','WFH','OD','T','TL','SU','ES','SPL','WOP','PH','WOHP','H','WO','A','CF'`;

    const [
      schedRows, rajRows, mpcgRows,
      qcYday, qcAvg,
      overdueTasks,
      zeroBranches,
      pendingPlans,
      openFeedback,
      empRows,
      leaveTodayRows,
      eventPendingRows,
      birthdayRows,
      longAbsentRows,
      overdueByBranch,
    ] = await Promise.all([
      query('SELECT UPPER(file_name) AS code, unit, state, edition_name, schedule_time FROM page_schedule_time').catch(() => []),
      query(`SELECT UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file,'-',2),'-',-1)) AS code,
                    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|') AS all_times
             FROM gmg_raj WHERE input_file LIKE ? AND date_time_pdf IS NOT NULL GROUP BY code`,
             [ddmmyyyy(todayStr) + '-%']).catch(() => []),
      query(`SELECT UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file,'-',2),'-',-1)) AS code,
                    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|') AS all_times
             FROM gmg_mpcg WHERE input_file LIKE ? AND date_time_pdf IS NOT NULL GROUP BY code`,
             [ddmmyyyy(todayStr) + '-%']).catch(() => []),
      // QC: state column is empty in qc_review — scope via edition↔Branch mapping
      query(`SELECT COALESCE(SUM(no_of_mistake),0) AS m FROM qc_review WHERE entrydate = ?
             ${fBranch ? 'AND edition = ?' : fState ? 'AND edition IN (SELECT DISTINCT Branch FROM `user` WHERE State = ?)' : ''}`,
             [ydayStr, ...(fBranch ? [fBranch] : fState ? [fState] : [])]).catch(() => [{ m: 0 }]),
      query(`SELECT COALESCE(AVG(day_m),0) AS avg_m FROM (
               SELECT SUM(no_of_mistake) AS day_m FROM qc_review
               WHERE entrydate BETWEEN ? AND ?
               ${fBranch ? 'AND edition = ?' : fState ? 'AND edition IN (SELECT DISTINCT Branch FROM `user` WHERE State = ?)' : ''}
               GROUP BY entrydate
             ) t`, [d7Str, toIST(Date.now() - 2 * 864e5), ...(fBranch ? [fBranch] : fState ? [fState] : [])]).catch(() => [{ avg_m: 0 }]),
      query(`SELECT COUNT(*) AS cnt, COUNT(DISTINCT assigned_to_pan) AS people
             FROM tasks WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL AND due_date < CURDATE()
             ${fState ? 'AND assigned_to_state = ?' : ''} ${fBranch ? 'AND assigned_to_branch = ?' : ''}`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])])
             .catch(() => [{ cnt: 0, people: 0 }]),
      query(`SELECT u.Branch AS branch, COUNT(DISTINCT u.pan_no) AS reporters,
                    COALESCE(SUM(d.No_Story), 0) AS stories
             FROM \`user\` u
             LEFT JOIN daily_achievment_count_ecms d ON u.pan_no = d.Pan_no AND d.entrydate = ?
             WHERE (u.is_emp_working = 1 OR u.Status IN ('Working','Active'))
               AND u.Branch IS NOT NULL AND u.Branch != ''
               AND (LOWER(TRIM(u.Story_Type)) LIKE '%reporter%' OR LOWER(TRIM(u.Story_Type)) = 'stringer')
               ${fState ? 'AND u.State = ?' : ''} ${fBranch ? 'AND u.Branch = ?' : ''}
             GROUP BY u.Branch
             HAVING stories = 0 AND reporters >= 3
             ORDER BY reporters DESC LIMIT 10`,
             [ydayStr, ...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => []),
      query(`SELECT COUNT(*) AS cnt FROM weekly_action_plans
             WHERE grade IS NULL AND week_start >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
             ${fState ? 'AND state = ?' : ''} ${fBranch ? 'AND branch = ?' : ''}`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => [{ cnt: 0 }]),
      query(`SELECT COUNT(*) AS cnt FROM feedback
             WHERE priority = 'High' AND (status IS NULL OR status NOT IN ('resolved','closed','Resolved','Closed'))
             ${fState ? 'AND state = ?' : ''} ${fBranch ? 'AND branch = ?' : ''}`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])])
             .catch(() => [{ cnt: 0 }]),
      query(`SELECT EMPNAME, DOB, Branch FROM \`user\`
             WHERE is_emp_working = 1 AND DOB IS NOT NULL AND DOB != ''
             ${fState ? 'AND State = ?' : ''} ${fBranch ? 'AND Branch = ?' : ''}`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => []),

      // 8. Employees on leave — last week Mon to d-2 (unique per branch)
      query(`SELECT u.Branch AS branch, COUNT(DISTINCT u.pan_no) AS cnt
             FROM hrms_data h
             JOIN \`user\` u ON UPPER(TRIM(u.pan_no)) = UPPER(TRIM(h.pan_no))
             WHERE h.att_date BETWEEN ? AND ? AND UPPER(TRIM(h.att_type)) NOT IN (${LEAVE_EXCL})
               AND (u.is_emp_working = 1 OR u.Status IN ('Working','Active'))
               ${fState ? 'AND u.State = ?' : ''} ${fBranch ? 'AND u.Branch = ?' : ''}
             GROUP BY u.Branch ORDER BY cnt DESC LIMIT 5`,
             [lwMonStr, d2Str, ...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => []),

      // 9. Major event plans pending review
      query(`SELECT COUNT(*) AS cnt FROM major_event_plans WHERE status = 'submitted'
             ${fState ? 'AND state = ?' : ''} ${fBranch ? 'AND branch = ?' : ''}`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => [{ cnt: 0 }]),

      // 10. Birthdays today
      query(`SELECT EMPNAME AS name, Branch AS branch FROM \`user\`
             WHERE DATE_FORMAT(DOB, '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')
               AND (is_emp_working = 1 OR Status IN ('Working','Active'))
               ${fState ? 'AND State = ?' : ''} ${fBranch ? 'AND Branch = ?' : ''}
             ORDER BY Branch, EMPNAME`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => []),

      // 11. Consecutive absence: on leave BOTH yesterday and day-before
      query(`SELECT u.EMPNAME AS name, u.Branch AS branch, COUNT(DISTINCT h.att_date) AS days
             FROM hrms_data h
             JOIN \`user\` u ON UPPER(TRIM(u.pan_no)) = UPPER(TRIM(h.pan_no))
             WHERE h.att_date IN (?, ?) AND UPPER(TRIM(h.att_type)) NOT IN (${LEAVE_EXCL})
               AND (u.is_emp_working = 1 OR u.Status IN ('Working','Active'))
               ${fState ? 'AND u.State = ?' : ''} ${fBranch ? 'AND u.Branch = ?' : ''}
             GROUP BY u.pan_no, u.EMPNAME, u.Branch HAVING days >= 2
             ORDER BY u.Branch, u.EMPNAME LIMIT 10`,
             [ydayStr, toIST(Date.now() - 2 * 864e5), ...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => []),

      // 12. Overdue tasks per branch (for personalized Telegram messages)
      query(`SELECT assigned_to_branch AS branch, assigned_to_state AS state, COUNT(*) AS cnt
             FROM tasks WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL AND due_date < CURDATE()
               ${fState ? 'AND assigned_to_state = ?' : ''} ${fBranch ? 'AND assigned_to_branch = ?' : ''}
             GROUP BY assigned_to_branch, assigned_to_state ORDER BY cnt DESC`,
             [...(fState ? [fState] : []), ...(fBranch ? [fBranch] : [])]).catch(() => []),
    ]);

    const alerts = [];
    let idSeq = 1;
    // branches = affected branch names; meta = raw data for personalized Telegram messages
    const push = (type, sev, text, link, count = null, branches = [], meta = {}) =>
      alerts.push({ id: idSeq++, type, sev, text, time: `${todayStr} ${nowLabel}`, link, count, branches, meta });

    // ── 1. Edition delays today (≥30 min) ────────────────────────────────────
    const schedMap = {};
    schedRows.forEach(s => { schedMap[s.code] = s; });
    const pubDate = new Date(todayStr);
    const lateEditions = [...rajRows, ...mpcgRows].map(r => {
      const sched = schedMap[r.code];
      if (!sched || isHidden(sched.edition_name)) return null;
      if (fState  && normState(sched.state) !== normState(fState)) return null;
      if (fBranch && (sched.unit || '').toLowerCase() !== fBranch.toLowerCase()) return null;
      const [sh, sm] = (sched.schedule_time || '00:00:00').split(':').map(Number);
      const sd = new Date(pubDate);
      if (sh >= 12) sd.setDate(sd.getDate() - 1);
      sd.setHours(sh, sm, 0, 0);
      const releaseMs = pickLatestBefore230(r.all_times, todayStr);
      const delay = Math.min(Math.round((releaseMs - sd.getTime()) / 60000), 149);
      return delay >= 30 ? { name: sched.edition_name || sched.unit || r.code, delay, branch: sched.unit } : null;
    }).filter(Boolean).sort((a, b) => b.delay - a.delay);

    if (lateEditions.length) {
      const top = lateEditions.slice(0, 3).map(e => `${e.name} (+${Math.floor(e.delay / 60)}h${String(e.delay % 60).padStart(2, '0')}m)`).join(', ');
      const lateBranches = [...new Set(lateEditions.map(e => e.branch).filter(Boolean))];
      push('Edition Delay', 'high',
        `${lateEditions.length} edition${lateEditions.length > 1 ? 's' : ''} released 30+ min late today — worst: ${top}`,
        '/production', lateEditions.length, lateBranches,
        { editions: lateEditions.map(e => ({ name: e.name, delay: e.delay, branch: e.branch })) });
    }

    // ── 2. Zero-story branches yesterday ─────────────────────────────────────
    if (zeroBranches.length) {
      const names = zeroBranches.slice(0, 5).map(b => `${b.branch} (${b.reporters} reporters)`).join(', ');
      push('Silent Branch', 'high',
        `${zeroBranches.length} branch${zeroBranches.length > 1 ? 'es' : ''} filed ZERO stories yesterday: ${names}`,
        '/pages', zeroBranches.length, zeroBranches.map(b => b.branch),
        { data: zeroBranches.map(b => ({ branch: b.branch, reporters: Number(b.reporters) })) });
    }

    // ── 3. Overdue tasks ─────────────────────────────────────────────────────
    const od = overdueTasks[0] || {};
    if (Number(od.cnt) > 0) {
      const overdueBranches = overdueByBranch.map(b => b.branch).filter(Boolean);
      push('Overdue Tasks', 'high',
        `${od.cnt} task${od.cnt > 1 ? 's' : ''} past due date across ${od.people} member${od.people > 1 ? 's' : ''} — reassign or escalate`,
        '/tasks', Number(od.cnt), overdueBranches,
        { data: overdueByBranch.map(b => ({ branch: b.branch, state: b.state, cnt: Number(b.cnt) })) });
    }

    // ── 4. QC spike ──────────────────────────────────────────────────────────
    const yM   = Number(qcYday[0]?.m || 0);
    const avgM = Number(qcAvg[0]?.avg_m || 0);
    if (yM > 0 && avgM > 0 && yM > avgM * 1.3 && yM >= 10) {
      push('QC Spike', 'med',
        `QC mistakes jumped to ${yM} yesterday vs ${Math.round(avgM)}/day average — check desk briefing`,
        '/pages', yM, [], { yesterday: yM, avg: Math.round(avgM), states: fState ? [fState] : [] });
    }

    // ── 5. Plans awaiting review ─────────────────────────────────────────────
    const pp = Number(pendingPlans[0]?.cnt || 0);
    if (pp > 0) {
      push('Plan Review Pending', 'med',
        `${pp} weekly action plan${pp > 1 ? 's' : ''} awaiting State Head review & grade`,
        '/tasks?tab=review', pp, [], { count: pp, states: fState ? [fState] : [] });
    }

    // ── 6. Open high-priority feedback ───────────────────────────────────────
    const fb = Number(openFeedback[0]?.cnt || 0);
    if (fb > 0) {
      push('Feedback Pending', 'med',
        `${fb} high-priority feedback item${fb > 1 ? 's' : ''} still open`,
        '/feedback', fb, [], { count: fb, states: fState ? [fState] : [] });
    }

    // ── 7. Retirements within 60 days ────────────────────────────────────────
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 864e5);
    const retiring = empRows
      .map(e => ({ ...e, rd: calcRetireDate(e.DOB) }))
      .filter(e => e.rd && e.rd >= now && e.rd <= in60)
      .sort((a, b) => a.rd - b.rd);
    if (retiring.length) {
      const names = retiring.slice(0, 3).map(e => `${e.EMPNAME} (${e.Branch}, ${e.rd.toISOString().slice(0, 10)})`).join(', ');
      push('Retirement Due', 'low',
        `${retiring.length} employee${retiring.length > 1 ? 's' : ''} retiring within 60 days: ${names}`,
        '/hr', retiring.length, [],
        { data: retiring.map(e => ({ name: e.EMPNAME, branch: e.Branch, date: e.rd.toISOString().slice(0, 10) })) });
    }

    // ── 8. Staff on leave (last week Mon → d-2) ──────────────────────────────
    const totalOnLeave = leaveTodayRows.reduce((s, b) => s + Number(b.cnt), 0);
    if (totalOnLeave >= 3) {
      const top = leaveTodayRows.slice(0, 3).map(b => `${b.branch} (${b.cnt})`).join(', ');
      push('Staff On Leave', 'med',
        `${totalOnLeave} unique employees on leave (${lwMonStr} → ${d2Str}) — ${top}`,
        '/hr', totalOnLeave, leaveTodayRows.map(b => b.branch));
    }

    // ── 9. Event plans pending review ────────────────────────────────────────
    const ep = Number(eventPendingRows[0]?.cnt || 0);
    if (ep > 0) {
      push('Event Plan Pending', 'med',
        `${ep} major event plan${ep > 1 ? 's' : ''} submitted — awaiting State Head review`,
        '/tasks?tab=events', ep, [], { count: ep, states: fState ? [fState] : [] });
    }

    // ── 10. Birthdays today ───────────────────────────────────────────────────
    if (birthdayRows.length) {
      const names = birthdayRows.slice(0, 3).map(e => `${e.name} (${e.branch})`).join(', ');
      const birthdayBranches = [...new Set(birthdayRows.map(e => e.branch).filter(Boolean))];
      push('Birthday Today', 'low',
        `${birthdayRows.length} team member${birthdayRows.length > 1 ? 's have' : ' has'} a birthday today — ${names}`,
        '/hr', birthdayRows.length, birthdayBranches,
        { data: birthdayRows.map(e => ({ name: e.name, branch: e.branch })) });
    }

    // ── 11. Consecutive absence (2+ days) ────────────────────────────────────
    if (longAbsentRows.length) {
      const names = longAbsentRows.slice(0, 3).map(e => `${e.name} (${e.branch})`).join(', ');
      const absentBranches = [...new Set(longAbsentRows.map(e => e.branch).filter(Boolean))];
      push('Extended Absence', 'high',
        `${longAbsentRows.length} reporter${longAbsentRows.length > 1 ? 's' : ''} absent 2+ consecutive days: ${names}`,
        '/hr', longAbsentRows.length, absentBranches,
        { data: longAbsentRows.map(e => ({ name: e.name, branch: e.branch, days: Number(e.days) })) });
    }

    // All-clear entry so the feed is never empty
    if (!alerts.length) {
      push('All Clear', 'low', 'No active alerts — editions on time, no overdue tasks, QC normal. 🎉', '/', null);
    }

    const order = { high: 0, med: 1, low: 2 };
    alerts.sort((a, b) => order[a.sev] - order[b.sev]);

    return res.json({ alerts, generatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
