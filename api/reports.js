/**
 * GET /api/reports               → list of available report types
 * GET /api/reports?type=reporter&from=&to=&state=&branch=
 * GET /api/reports?type=edition&date=&state=
 * GET /api/reports?type=qc&from=&to=&state=
 * GET /api/reports?type=visits&from=&to=&state=&branch=
 * GET /api/reports?type=grading&month=&state=&branch=
 * GET /api/reports?type=employees&state=&branch=
 *
 * Response: { type, columns[], rows[][], total, ...filterParams }
 */
const { query }       = require('./_lib/mysql');
const { requireRole } = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

const STATE_NORM = {
  rajasthan:'raj', raj:'raj',
  mp:'mp', 'madhya pradesh':'mp',
  cg:'cg', chhattisgarh:'cg',
  metro:'metro',
};
const normState = s => STATE_NORM[(s||'').toLowerCase().trim()] || (s||'').toLowerCase().trim();

const yday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const REPORT_TYPES = [
  { type:'reporter',  label:'Reporter Performance', desc:'Story, photo & word count per reporter for a date range' },
  { type:'edition',   label:'Edition Delays',        desc:'Schedule vs actual release time for all editions on a date' },
  { type:'qc',        label:'QC Mistakes',           desc:'Quality control issues by date range, edition and severity' },
  { type:'visits',    label:'Field Visits',          desc:'Reporter field visit logs with time, location and transport' },
  { type:'grading',   label:'PLI & Grading',         desc:'Employee grading scores (Work / Behaviour / Discipline / Interest) by month' },
  { type:'employees',     label:'Employee Directory',    desc:'Active employees with profile, state, branch and contact details' },
  { type:'press_release', label:'Press Release Report', desc:'Active employees working on press releases — count, editions and last activity date' },
];

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  // Resolve effective state/branch (role locks override query params)
  let filterState  = req.query.state  || '';
  let filterBranch = req.query.branch || '';
  if (user.role === 'State Head' && user.state)  { filterState = user.state; filterBranch = ''; }
  if (user.role === 'Regional Editor') {
    if (user.state)  filterState  = user.state;
    if (user.branch) filterBranch = user.branch;
  }
  if (filterState  === 'All') filterState  = '';
  if (filterBranch === 'All') filterBranch = '';

  const { type } = req.query;
  if (!type) return res.json({ reports: REPORT_TYPES });

  try {
    switch (type) {
      case 'reporter':  return await reportReporter (req, res, filterState, filterBranch);
      case 'edition':   return await reportEdition  (req, res, filterState, filterBranch);
      case 'qc':        return await reportQC       (req, res, filterState);
      case 'visits':    return await reportVisits   (req, res, filterState, filterBranch);
      case 'grading':   return await reportGrading  (req, res, filterState, filterBranch);
      case 'employees':     return await reportEmployees   (req, res, filterState, filterBranch);
      case 'press_release': return await reportPressRelease(req, res, filterState, filterBranch);
      default: return res.status(400).json({ error: `Unknown report type: ${type}` });
    }
  } catch (err) {
    console.error('[reports]', type, err.message);
    return res.status(500).json({ error: err.message });
  }
};

/* ── 1. Reporter Performance ─────────────────────────────────────────────── */
async function reportReporter(req, res, filterState, filterBranch) {
  const from = req.query.from || daysAgo(7);
  const to   = req.query.to   || yday();

  const where = []; const params = [from, to];
  if (filterState)  { where.push('u.State = ?');  params.push(filterState); }
  if (filterBranch) { where.push('u.Branch = ?'); params.push(filterBranch); }
  const wSql = where.length ? ' AND ' + where.join(' AND ') : '';

  const rows = await query(`
    SELECT u.pan_no, u.EMPNAME AS name, u.State AS state, u.Branch AS branch,
           TRIM(u.Story_Type) AS profile,
           SUM(e.No_Story)        AS stories,
           SUM(e.No_Photo)        AS photos,
           SUM(e.No_Words)        AS words,
           SUM(e.Exclusive)       AS exclusive,
           SUM(e.Human_angle)     AS human_angle,
           SUM(e.Datastory)       AS datastory,
           SUM(e.Expose_khulasa)  AS expose,
           SUM(e.Impact_Story)    AS impact,
           COUNT(DISTINCT e.entrydate) AS active_days
    FROM daily_achievment_count_ecms e
    JOIN \`user\` u ON e.Pan_no = u.pan_no
    WHERE e.entrydate BETWEEN ? AND ?${wSql}
    GROUP BY u.pan_no, u.EMPNAME, u.State, u.Branch, u.Story_Type
    ORDER BY stories DESC
    LIMIT 5000
  `, params);

  return res.json({
    type: 'reporter', from, to, total: rows.length,
    columns: ['Pan No','Name','State','Branch','Profile','Active Days','Stories','Photos','Words','Exclusive','Human Angle','Datastory','Exposé','Impact'],
    rows: rows.map(r => [
      r.pan_no, r.name||'', r.state||'', r.branch||'', r.profile||'',
      Number(r.active_days||0),
      Number(r.stories||0), Number(r.photos||0), Number(r.words||0),
      Number(r.exclusive||0), Number(r.human_angle||0), Number(r.datastory||0),
      Number(r.expose||0), Number(r.impact||0),
    ]),
  });
}

/* ── 2. Edition Delays ───────────────────────────────────────────────────── */
const HIDDEN_EDITIONS = ['nt jaipur city', 'nt jaipur dak'];
const isHidden = name => HIDDEN_EDITIONS.includes((name || '').toLowerCase().trim());

function pickReleaseTime(allTimesStr, schedMs) {
  if (!allTimesStr) return null;
  const parts = String(allTimesStr).split('|').map(s => s.trim()).filter(Boolean);
  for (const t of parts) {
    const ms = new Date(t).getTime();
    if (isNaN(ms)) continue;
    if (Math.round((ms - schedMs) / 60000) < 240) return ms;
  }
  const last = parts[parts.length - 1];
  return last ? new Date(last).getTime() : null;
}

async function reportEdition(req, res, filterState, filterBranch) {
  const date = req.query.date || yday();
  // GMG file names start with the publish date as ddmmyyyy → a LIKE prefix uses the
  // index on input_file instead of scanning (STR_TO_DATE/REGEXP defeated the index).
  const [pY, pM, pD] = date.split('-');
  const datePrefix   = `${pD}${pM}${pY}-%`;

  const [rajRows, mpcgRows, schedRows] = await Promise.all([
    query(`SELECT UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file,'-',2),'-',-1)) AS code,
                  MAX(date_time_pdf) AS release_time, 'Rajasthan' AS region,
                  GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|') AS all_release_times
           FROM gmg_raj
           WHERE input_file LIKE ? AND date_time_pdf IS NOT NULL
           GROUP BY code`, [datePrefix]).catch(() => []),
    query(`SELECT UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file,'-',2),'-',-1)) AS code,
                  MAX(date_time_pdf) AS release_time, 'MP/CG' AS region,
                  GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|') AS all_release_times
           FROM gmg_mpcg
           WHERE input_file LIKE ? AND date_time_pdf IS NOT NULL
           GROUP BY code`, [datePrefix]).catch(() => []),
    query('SELECT UPPER(file_name) AS code, file_name, state, unit, district, edition_name, edition_type, schedule_time FROM page_schedule_time')
      .catch(() => []),
  ]);

  const schedMap = {};
  schedRows.forEach(s => { schedMap[s.code] = s; });
  const pubDate = new Date(date);

  const rows = [...rajRows, ...mpcgRows]
    .map(r => {
      const s = schedMap[r.code];
      if (!s) return null;
      if (isHidden(s.edition_name)) return null;
      if (filterState  && normState(s.state) !== normState(filterState))          return null;
      if (filterBranch && (s.unit || '').toLowerCase() !== filterBranch.toLowerCase()) return null;

      const [sh, sm] = (s.schedule_time||'00:00:00').split(':').map(Number);
      const sd = new Date(pubDate);
      if (sh >= 12) sd.setDate(sd.getDate() - 1);
      sd.setHours(sh, sm, 0, 0);
      const schedMs = sd.getTime();

      const maxMs = new Date(r.release_time).getTime();
      let releaseMs = maxMs;
      if (Math.round((maxMs - schedMs) / 60000) >= 240) {
        const best = pickReleaseTime(r.all_release_times, schedMs);
        if (best && best !== maxMs) releaseMs = best;
      }

      const delay = Math.min(Math.round((releaseMs - schedMs) / 60000), 239);
      const abs   = Math.abs(delay);
      const hh    = Math.floor(abs / 60), mm = abs % 60;
      const fmt   = `${delay > 0 ? '+' : delay < 0 ? '-' : ''}${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;

      return {
        code: r.code,
        edition: s.edition_name || r.code,
        state: s.state || '',
        unit: s.unit || '',
        district: s.district || '',
        edition_type: s.edition_type || '',
        region: r.region,
        schedule: s.schedule_time,
        release: r.release_time ? String(r.release_time).slice(0, 19).replace('T',' ') : '',
        delay,
        delay_fmt: fmt,
        status: delay <= 0 ? 'On Time' : delay <= 30 ? 'Warning' : 'Late',
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.delay - a.delay);

  return res.json({
    type: 'edition', date, total: rows.length,
    columns: ['Code','Edition','Edition Type','State','Unit','District','Region','Scheduled','Released','Delay (min)','Delay (hh:mm)','Status'],
    rows: rows.map(r => [
      r.code, r.edition, r.edition_type, r.state, r.unit, r.district, r.region,
      r.schedule, r.release, r.delay, r.delay_fmt, r.status,
    ]),
  });
}

/* ── 3. QC Mistakes ──────────────────────────────────────────────────────── */
async function reportQC(req, res, filterState) {
  const from = req.query.from || daysAgo(7);
  const to   = req.query.to   || yday();

  const where = ['entrydate BETWEEN ? AND ?']; const params = [from, to];
  if (filterState) { where.push('state = ?'); params.push(filterState); }

  const rows = await query(`
    SELECT entrydate AS date, state, edition, pullout, category, severity,
           mistake, no_of_mistake AS mistakes, responsible_1, responsible_2, re_remark
    FROM qc_review WHERE ${where.join(' AND ')}
    ORDER BY entrydate DESC, id DESC LIMIT 5000
  `, params);

  return res.json({
    type: 'qc', from, to, total: rows.length,
    columns: ['Date','State','Edition','Pullout','Category','Severity','Mistake Description','No. of Mistakes','Responsible 1','Responsible 2','Remark'],
    rows: rows.map(r => [
      r.date ? String(r.date).slice(0,10) : '',
      r.state||'', r.edition||'', r.pullout||'', r.category||'', r.severity||'',
      r.mistake||'', Number(r.mistakes||0),
      r.responsible_1||'', r.responsible_2||'', r.re_remark||'',
    ]),
  });
}

/* ── 4. Field Visits ─────────────────────────────────────────────────────── */
async function reportVisits(req, res, filterState, filterBranch) {
  const from = req.query.from || daysAgo(7);
  const to   = req.query.to   || yday();

  const where = ['v.visit_date BETWEEN ? AND ?']; const params = [from, to];
  if (filterState)  { where.push('u.State = ?');  params.push(filterState); }
  if (filterBranch) { where.push('u.Branch = ?'); params.push(filterBranch); }

  const rows = await query(`
    SELECT v.visit_date AS date, v.pan_no,
           u.EMPNAME AS name, u.State AS state, u.Branch AS branch,
           TRIM(u.Story_Type) AS profile,
           TIME(v.visit_in_time) AS time_in, TIME(v.visit_out_time) AS time_out,
           v.visit_in_location AS location, v.visit_purpose AS purpose,
           v.transport, v.visit_remark AS remark
    FROM visit_report v
    JOIN \`user\` u ON v.pan_no = u.pan_no
    WHERE ${where.join(' AND ')} AND (v.visit_remark IS NULL OR v.visit_remark != 'Week Off')
    ORDER BY v.visit_date DESC, u.EMPNAME LIMIT 5000
  `, params);

  return res.json({
    type: 'visits', from, to, total: rows.length,
    columns: ['Date','Pan No','Name','State','Branch','Profile','Time In','Time Out','Location','Purpose','Transport','Remark'],
    rows: rows.map(r => [
      r.date ? String(r.date).slice(0,10) : '',
      r.pan_no||'', r.name||'', r.state||'', r.branch||'', r.profile||'',
      r.time_in||'', r.time_out||'',
      r.location||'', r.purpose||'', r.transport||'', r.remark||'',
    ]),
  });
}

/* ── 5. PLI & Grading ────────────────────────────────────────────────────── */
async function reportGrading(req, res, filterState, filterBranch) {
  const thisMonth = new Date().toISOString().slice(0,7);
  const month = req.query.month || thisMonth;

  const where = ['month = ?']; const params = [month];
  if (filterState)  { where.push('state = ?');  params.push(filterState); }
  if (filterBranch) { where.push('branch = ?'); params.push(filterBranch); }

  const rows = await query(`
    SELECT pan, emp_code, emp_name, state, branch, month,
           work_grade, behaviour_grade, discipline_grade, interest_grade,
           overall_grade, pli_percent, remarks
    FROM hr_grading WHERE ${where.join(' AND ')}
    ORDER BY state, branch, emp_name LIMIT 2000
  `, params);

  return res.json({
    type: 'grading', month, total: rows.length,
    columns: ['Pan No','Emp Code','Name','State','Branch','Month','Work (0-5)','Behaviour (0-5)','Discipline (0-5)','Interest (0-5)','Overall %','PLI %','Remarks'],
    rows: rows.map(r => [
      r.pan||'', r.emp_code||'', r.emp_name||'', r.state||'', r.branch||'', r.month||'',
      r.work_grade ?? '', r.behaviour_grade ?? '', r.discipline_grade ?? '', r.interest_grade ?? '',
      r.overall_grade ?? '', r.pli_percent ?? '', r.remarks||'',
    ]),
  });
}

/* ── 7. Press Release Report ─────────────────────────────────────────────── */
async function reportPressRelease(req, res, filterState, filterBranch) {
  const from = req.query.from || daysAgo(30);
  const to   = req.query.to   || new Date().toISOString().slice(0, 10);

  const where = [
    "DATE(p.inserted_on) BETWEEN ? AND ?",
    "(u.is_emp_working = 1 OR u.Status IN ('Working','Active'))",
  ];
  const params = [from, to];
  if (filterState)  { where.push('u.State = ?');  params.push(filterState); }
  if (filterBranch) { where.push('u.Branch = ?'); params.push(filterBranch); }

  const rows = await query(`
    SELECT u.pan_no, u.EMPNAME AS name,
           u.State AS state, u.Branch AS branch,
           TRIM(u.Story_Type) AS profile,
           u.emp_designation AS designation,
           COUNT(p.id)            AS total_entries,
           SUM(p.value_edition)   AS total_editions,
           MIN(DATE(p.inserted_on)) AS first_date,
           MAX(DATE(p.inserted_on)) AS last_date
    FROM press_release_log p
    JOIN \`user\` u ON p.user_id = u.id
    WHERE ${where.join(' AND ')}
    GROUP BY u.id, u.pan_no, u.EMPNAME, u.State, u.Branch, u.Story_Type, u.emp_designation
    ORDER BY total_editions DESC, total_entries DESC
    LIMIT 2000
  `, params);

  return res.json({
    type: 'press_release', from, to, total: rows.length,
    columns: ['Pan No','Name','State','Branch','Profile','Designation','Total Entries','Total Editions','First Date','Last Date'],
    rows: rows.map(r => [
      r.pan_no   || '',
      r.name     || '',
      r.state    || '',
      r.branch   || '',
      r.profile  || '',
      r.designation || '',
      Number(r.total_entries  || 0),
      Number(r.total_editions || 0),
      r.first_date ? String(r.first_date).slice(0, 10) : '',
      r.last_date  ? String(r.last_date).slice(0, 10)  : '',
    ]),
  });
}

/* ── 6. Employee Directory ───────────────────────────────────────────────── */
async function reportEmployees(req, res, filterState, filterBranch) {
  const where = ["(is_emp_working = 1 OR Status = 'Working' OR Status = 'Active')"]; const params = [];
  if (filterState)  { where.push('State = ?');  params.push(filterState); }
  if (filterBranch) { where.push('Branch = ?'); params.push(filterBranch); }

  const rows = await query(`
    SELECT pan_no, EMP_CODE AS emp_code, EMPNAME AS name, Status AS status,
           State AS state, Branch AS branch, district, bureau,
           TRIM(Story_Type) AS profile, emp_designation AS designation,
           emp_deptt AS department, emp_qualification AS qualification,
           DATE(DOJ) AS date_of_joining, DATE(DOB) AS date_of_birth,
           Mob_No AS mobile, Email_ID AS email
    FROM \`user\` WHERE ${where.join(' AND ')}
    ORDER BY State, Branch, EMPNAME LIMIT 5000
  `, params);

  return res.json({
    type: 'employees', total: rows.length,
    columns: ['Pan No','Emp Code','Name','Status','State','Branch','District','Bureau','Profile (Story Type)','Designation','Department','Qualification','Date of Joining','Date of Birth','Mobile','Email'],
    rows: rows.map(r => [
      r.pan_no||'', r.emp_code||'', r.name||'', r.status||'',
      r.state||'', r.branch||'', r.district||'', r.bureau||'',
      r.profile||'', r.designation||'', r.department||'', r.qualification||'',
      r.date_of_joining ? String(r.date_of_joining).slice(0,10) : '',
      r.date_of_birth   ? String(r.date_of_birth).slice(0,10)   : '',
      r.mobile||'', r.email||'',
    ]),
  });
}
