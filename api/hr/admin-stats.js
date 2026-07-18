/**
 * HR Admin Stats — MySQL only
 * GET /api/hr/admin-stats  — aggregated retirement, age, profile data
 */
const { setCors, handleOptions } = require('../_lib/cors');
const { requireRole }            = require('../_lib/auth');
const { query }                  = require('../_lib/mysql');

const TABLE = process.env.MYSQL_TABLE_EMPLOYEES || 'user';

function calcAge(dob) {
  if (!dob) return null;
  const parts = String(dob).split('-');
  let d;
  if (parts[0].length === 4) d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  else                        d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function retireDate(dob) {
  if (!dob) return null;
  const parts = String(dob).split('-');
  let d;
  if (parts[0].length === 4) d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  else                        d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  if (isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 58);
  return d;
}

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError } = requireRole(req, ['Admin', 'HR', 'Management', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // Optional global filters ('All' / empty = no filter)
  const fState  = (req.query.state  && req.query.state  !== 'All') ? req.query.state  : '';
  const fBranch = (req.query.branch && req.query.branch !== 'All') ? req.query.branch : '';

  try {
    const where  = [];
    const params = [];
    if (fState)  { where.push('State = ?');  params.push(fState);  }
    if (fBranch) { where.push('Branch = ?'); params.push(fBranch); }

    const emps = await query(
      `SELECT EMP_CODE, EMPNAME, emp_designation, Story_Type, profile, emp_deptt, Branch, State,
              DOB, DOJ, gross_salary, is_emp_working, Status, pan_no
       FROM \`${TABLE}\`
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY EMPNAME ASC`,
      params
    );

    const today   = new Date();
    // Active members only: is_emp_working=1 OR Status='Working'/'Active'
    const working = emps.filter(e => e.is_emp_working == 1 || e.Status === 'Working' || e.Status === 'Active');
    const inactive = emps.filter(e => !(e.is_emp_working == 1 || e.Status === 'Working' || e.Status === 'Active'));

    // Retirement buckets
    const retBuckets = { overdue: [], within1yr: [], yr1to3: [], yr3to5: [], beyond5: [] };
    working.forEach(e => {
      const rd = retireDate(e.DOB);
      if (!rd) return;
      const diffYrs = (rd - today) / (1000 * 60 * 60 * 24 * 365.25);
      const age     = calcAge(e.DOB);
      const item    = { ...e, age, retireOn: rd.toISOString().split('T')[0] };
      if      (diffYrs < 0)  retBuckets.overdue.push(item);
      else if (diffYrs <= 1) retBuckets.within1yr.push(item);
      else if (diffYrs <= 3) retBuckets.yr1to3.push(item);
      else if (diffYrs <= 5) retBuckets.yr3to5.push(item);
      else                   retBuckets.beyond5.push(item);
    });

    // Age distribution
    const ageDist = { '20-29': 0, '30-39': 0, '40-49': 0, '50-59': 0, '60+': 0 };
    working.forEach(e => {
      const a = calcAge(e.DOB);
      if (!a) return;
      if      (a < 30) ageDist['20-29']++;
      else if (a < 40) ageDist['30-39']++;
      else if (a < 50) ageDist['40-49']++;
      else if (a < 60) ageDist['50-59']++;
      else             ageDist['60+']++;
    });

    // Profile-wise count from Story_Type (active members only).
    // NE is a catch-all — those employees' real role lives in user.profile instead.
    const profileMap = {};
    working.forEach(e => {
      const st = (e.Story_Type || '').trim();
      const p  = (st === 'NE' ? (e.profile || '').trim() || 'NE' : st) || 'Unknown';
      if (!profileMap[p]) profileMap[p] = { profile: p, available: 0, totalSalary: 0 };
      profileMap[p].available++;
      profileMap[p].totalSalary += Number(e.gross_salary || 0);
    });

    // Fetch sanctioned posts scoped to the same filters.
    // Rows are stored per (profile, state, branch); '' = company-wide row.
    let sanctioned = [];
    try {
      const sWhere  = [];
      const sParams = [];
      if (fBranch)      { sWhere.push('branch = ?'); sParams.push(fBranch); }
      else if (fState)  { sWhere.push('state = ?');  sParams.push(fState);  }
      sanctioned = await query(
        `SELECT * FROM hr_sanctioned_posts ${sWhere.length ? 'WHERE ' + sWhere.join(' AND ') : ''}`,
        sParams
      );
    } catch (_) { /* table may not exist yet */ }

    // Sum sanctioned counts per profile across all rows in scope
    const sancByProfile = {};
    sanctioned.forEach(s => {
      const key = s.profile;
      if (!sancByProfile[key]) sancByProfile[key] = 0;
      sancByProfile[key] += Number(s.sanctioned_count) || 0;
    });

    const profiles = Object.values(profileMap).map(p => {
      const sc = sancByProfile[p.profile];
      return {
        ...p,
        avgSalary:      p.available ? Math.round(p.totalSalary / p.available) : 0,
        sanctionedCount: sc !== undefined ? sc : null,
        vacant:          sc !== undefined ? Math.max(0, sc - p.available) : null,
      };
    }).sort((a, b) => b.available - a.available);

    // Sanctioned-only profiles with 0 available in this scope
    Object.entries(sancByProfile).forEach(([profile, sc]) => {
      if (!profiles.find(p => p.profile === profile)) {
        profiles.push({ profile, available: 0, avgSalary: 0, totalSalary: 0, sanctionedCount: sc, vacant: sc });
      }
    });

    return res.json({
      totalWorking:  working.length,
      totalInactive: inactive.length,
      total:         emps.length,
      retBuckets,
      ageDist: Object.entries(ageDist).map(([range, count]) => ({ range, count })),
      profiles,
      inactive: inactive.map(e => ({ ...e, age: calcAge(e.DOB) })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
