/**
 * GET  /api/hr/appointments  — list from existing `appointment` table + dashboard stats
 * POST /api/hr/appointments  — not used (data inserted by existing forms)
 */
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

// mysql2 converts MySQL's 0000-00-00 to a JavaScript Invalid Date object (truthy but invalid)
function isRealDate(v) {
  if (!v) return false;
  if (v instanceof Date) return !isNaN(v.getTime());
  // string fallback
  const d = new Date(v);
  return !isNaN(d.getTime()) && String(v) !== '0000-00-00';
}

// Derive pipeline stage from a row
function pipelineStage(r) {
  if (isRealDate(r.date_of_joining)) return 'Joined';
  const ds = (r.director_status || '').toLowerCase();
  if (ds === 'approved') return 'Director Approved';
  if (isRealDate(r.proposal_sent_to_directors_date)) return 'With Directors';
  const hs = (r.ho_interview_status || '').toLowerCase();
  if (hs && hs !== 'pending' && hs !== '') return 'HO Interviewed';
  if (isRealDate(r.proposal_sent_to_ho_date)) return 'Sent to HO';
  const ss = (r.se_level_status || '').toLowerCase();
  if (ss === 'approved') return 'SE Approved';
  return 'SE Pending';
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { state, branch, profile, type, stage, search, month } = req.query;
  const conds  = [];
  const params = [];

  // Role-based scoping
  if (user.role === 'State Head' && user.state) {
    conds.push('State = ?'); params.push(user.state);
  } else if (user.role === 'Regional Editor') {
    if (user.state)  { conds.push('State = ?');  params.push(user.state);  }
    if (user.branch) { conds.push('Branch = ?'); params.push(user.branch); }
  }

  // Query filters
  if (state   && state   !== 'All') { conds.push('State = ?');            params.push(state);   }
  if (branch  && branch  !== 'All') { conds.push('Branch = ?');           params.push(branch);  }
  if (profile && profile !== 'all') { conds.push('profile = ?');          params.push(profile); }
  if (type    && type    !== 'all') { conds.push('appoinment_type = ?');   params.push(type);    }
  if (month)  { conds.push('DATE_FORMAT(inserted_on,"%Y-%m") = ?');        params.push(month);   }
  if (search) {
    conds.push('(name LIKE ? OR Branch LIKE ? OR profile LIKE ? OR present_company LIKE ? OR mobile LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const rows = await query(
    `SELECT * FROM appointment ${where} ORDER BY inserted_on DESC LIMIT 1000`,
    params
  ).catch(e => { return res.status(500).json({ error: e.message }); });

  if (!rows) return; // already sent error response

  // Attach pipeline stage to each row
  const appointments = rows.map(r => ({ ...r, _stage: pipelineStage(r) }));

  // Filter by pipeline stage (client can't do this easily as it's derived)
  const filtered = stage && stage !== 'all'
    ? appointments.filter(a => a._stage === stage)
    : appointments;

  // ── Stats for dashboard ───────────────────────────────────────────────────
  // Always compute stats on ALL data (no WHERE except role scoping)
  const allRows = await query(
    `SELECT State, Branch, profile, appoinment_type, se_level_status,
            ho_interview_status, director_status, date_of_joining,
            proposal_sent_to_ho_date, proposal_sent_to_directors_date,
            director_approval_date, is_fresher, growth,
            decided_salary, final_ctc_salary, inserted_on
     FROM appointment ${user.role !== 'Admin' ? where : ''}
     ORDER BY inserted_on DESC`,
    user.role !== 'Admin' ? params : []
  ).catch(() => []);

  const pipelineCount = { 'SE Pending': 0, 'SE Approved': 0, 'Sent to HO': 0, 'HO Interviewed': 0, 'With Directors': 0, 'Director Approved': 0, 'Joined': 0 };
  const byProfile     = {};
  const byState       = {};
  const byType        = {};
  const byMonth       = {};
  const growthBuckets = { 'Negative (cut)': 0, '0–10%': 0, '11–25%': 0, '26–50%': 0, '50%+': 0 };
  let   totalSalary   = 0, salaryCount = 0;

  allRows.forEach(r => {
    const st = pipelineStage(r);
    pipelineCount[st] = (pipelineCount[st] || 0) + 1;

    const p = r.profile || 'Other';
    byProfile[p] = (byProfile[p] || 0) + 1;

    const s = r.State || 'Unknown';
    byState[s] = (byState[s] || 0) + 1;

    const t = r.appoinment_type || 'Other';
    byType[t] = (byType[t] || 0) + 1;

    if (r.inserted_on) {
      const key = new Date(r.inserted_on).toISOString().slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + 1;
    }

    const g = Number(r.growth);
    if (!isNaN(g)) {
      if (g < 0)      growthBuckets['Negative (cut)']++;
      else if (g <= 10) growthBuckets['0–10%']++;
      else if (g <= 25) growthBuckets['11–25%']++;
      else if (g <= 50) growthBuckets['26–50%']++;
      else              growthBuckets['50%+']++;
    }

    const sal = r.decided_salary || r.final_ctc_salary;
    if (sal && sal > 0) { totalSalary += sal; salaryCount++; }
  });

  const stats = {
    total:         allRows.length,
    pipeline:      pipelineCount,
    byProfile,
    byState,
    byType,
    byMonth,
    growthBuckets,
    avgDecidedSalary: salaryCount ? Math.round(totalSalary / salaryCount) : 0,
    freshers:      allRows.filter(r => r.is_fresher == 1).length,
    experienced:   allRows.filter(r => r.is_fresher == 0).length,
  };

  return res.json({ appointments: filtered, stats });
};
