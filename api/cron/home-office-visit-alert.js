/**
 * CRON: Home/Office Visit Alert — runs daily at 11:00 AM IST.
 *
 * What it does:
 *   1. Finds all reporters who marked a visit from "Home" or "Patrika Office"
 *      for today's date, grouped by branch.
 *   2. For each such branch, finds the RE with a Telegram chat ID.
 *   3. Sends one Telegram message per RE listing the reporters.
 *   4. Logs every send attempt to home_office_visit_alert_logs.
 */

const cron            = require('node-cron');
const { query }       = require('../_lib/mysql');
const { sendMessage } = require('../_lib/telegram');

async function ensureLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS home_office_visit_alert_logs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      re_name      VARCHAR(200) DEFAULT NULL,
      branch       VARCHAR(200) DEFAULT NULL,
      state        VARCHAR(100) DEFAULT NULL,
      chat_id      VARCHAR(100) DEFAULT NULL,
      visit_date   DATE         DEFAULT NULL,
      reporter_list TEXT        DEFAULT NULL,
      home_cnt     INT          DEFAULT 0,
      office_cnt   INT          DEFAULT 0,
      status       ENUM('sent','failed') DEFAULT 'failed',
      error_msg    TEXT         DEFAULT NULL,
      triggered_by VARCHAR(20)  DEFAULT 'cron',
      sent_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function run(triggeredBy = 'cron', targetDate = null) {
  await ensureLogTable();

  // Default to today in IST
  const dateObj = targetDate ? new Date(targetDate) : new Date(
    new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10)
  );
  const date = targetDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  console.log(`[home-office-visit-alert] Running for ${date} (triggered by: ${triggeredBy})`);

  // 1. All visits with GPS for the date + all registered locations.
  //    Labels are GPS-verified against registration_location (within 100 m;
  //    'Home' spots only match the same employee's pan_no) — same logic as
  //    the Field Visits tab in api/pages.js. Self-entered labels are ignored.
  const [visits, regRows] = await Promise.all([
    query(`
      SELECT v.pan_no, u.EMPNAME AS name, u.Branch AS branch, u.State AS state,
             CAST(v.LONGITUDE AS DECIMAL(10,7)) AS lat,
             CAST(v.LATITUDE  AS DECIMAL(10,7)) AS lng
      FROM visit_report v
      JOIN \`user\` u ON v.pan_no = u.pan_no
      WHERE v.visit_date = ?
        AND (v.visit_remark IS NULL OR v.visit_remark != 'Week Off')
        AND v.LATITUDE IS NOT NULL AND v.LATITUDE != ''
        AND v.LONGITUDE IS NOT NULL AND v.LONGITUDE != ''
      ORDER BY u.Branch, u.EMPNAME
    `, [date]),
    query(`
      SELECT pan_no, location,
             CAST(latitude  AS DECIMAL(10,7)) AS lat,
             CAST(longitude AS DECIMAL(10,7)) AS lng
      FROM registration_location
      WHERE location IN ('Home', 'Patrika Office')
        AND latitude IS NOT NULL AND latitude != ''
        AND longitude IS NOT NULL AND longitude != ''
    `),
  ]).catch(err => {
    console.error('[home-office-visit-alert] DB error:', err.message);
    return [[], []];
  });

  const toRad = d => d * Math.PI / 180;
  const distM = (lat1, lng1, lat2, lng2) =>
    2 * 6371000 * Math.asin(Math.sqrt(
      Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2
    ));

  const regList = regRows
    .map(r => ({
      pan: String(r.pan_no || '').trim().toUpperCase(),
      loc: String(r.location || '').trim(),
      lat: Number(r.lat), lng: Number(r.lng),
    }))
    .filter(r => r.lat && r.lng);

  const reporters = [];
  for (const v of visits) {
    const lat = Number(v.lat), lng = Number(v.lng);
    if (!(lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98)) continue; // bad GPS
    const pan = String(v.pan_no || '').trim().toUpperCase();
    let best = null, bestDist = 100; // 100 m threshold
    for (const reg of regList) {
      if (reg.loc.toLowerCase() === 'home' && reg.pan !== pan) continue;
      const d = distM(lat, lng, reg.lat, reg.lng);
      if (d <= bestDist) { bestDist = d; best = reg; }
    }
    if (best) reporters.push({ name: v.name, branch: v.branch, state: v.state, label: best.loc });
  }

  if (!reporters.length) {
    console.log('[home-office-visit-alert] No home/office visits found — no alerts needed.');
    return { sent: 0, failed: 0, skipped: true };
  }

  // 2. Group by branch
  const byBranch = {};
  for (const r of reporters) {
    if (!byBranch[r.branch]) byBranch[r.branch] = { state: r.state, home: [], office: [] };
    if (r.label.trim() === 'Home') {
      if (!byBranch[r.branch].home.includes(r.name)) byBranch[r.branch].home.push(r.name);
    } else if (r.label.trim() === 'Patrika Office') {
      if (!byBranch[r.branch].office.includes(r.name)) byBranch[r.branch].office.push(r.name);
    }
  }

  const branches = Object.keys(byBranch);
  console.log(`[home-office-visit-alert] Branches with home/office visits: ${branches.join(', ')}`);

  // 3. Find RE for each branch (any state)
  const placeholders = branches.map(() => '?').join(', ');
  const res_list = await query(`
    SELECT EMPNAME, Branch, State, telegram_chat_id
    FROM \`user\`
    WHERE Story_Type REGEXP '\\\\bRE\\\\b'
      AND Branch IN (${placeholders})
      AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
      AND (is_emp_working = 1 OR Status IN ('Working', 'Active'))
  `, branches).catch(err => {
    console.error('[home-office-visit-alert] DB error (RE query):', err.message);
    return [];
  });

  if (!res_list.length) {
    console.log('[home-office-visit-alert] No REs with Telegram IDs found for flagged branches.');
    return { sent: 0, failed: 0, skipped: true };
  }

  // 4. Send one alert per RE
  let sent = 0, failed = 0;
  for (const re of res_list) {
    const info     = byBranch[re.Branch];
    if (!info) continue;

    const homePart   = info.home.length   ? `\n🏠 <b>Home (${info.home.length}):</b>\n${info.home.map(n => `  • ${n}`).join('\n')}`   : '';
    const officePart = info.office.length ? `\n🏢 <b>Patrika Office (${info.office.length}):</b>\n${info.office.map(n => `  • ${n}`).join('\n')}` : '';
    const reporterList = [...info.home, ...info.office].join(', ');

    const text =
      `⚠️ <b>Field Visit Alert — ${re.Branch}</b>\n` +
      `📅 Date: <b>${date}</b>\n\n` +
      `The following reporters in your branch have marked their visit from <b>Home</b> or <b>Patrika Office</b> instead of the field:` +
      homePart + officePart +
      `\n\nPlease take necessary action.\n— Patrika Newsroom`;

    let status = 'failed', errorMsg = null;
    try {
      await sendMessage(re.telegram_chat_id, text);
      status = 'sent';
      sent++;
      console.log(`[home-office-visit-alert] Sent to ${re.EMPNAME} (${re.Branch})`);
    } catch (err) {
      errorMsg = err.message;
      failed++;
      console.error(`[home-office-visit-alert] Failed for ${re.EMPNAME}: ${err.message}`);
    }

    query(
      `INSERT INTO home_office_visit_alert_logs
         (re_name, branch, state, chat_id, visit_date, reporter_list, home_cnt, office_cnt, status, error_msg, triggered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [re.EMPNAME, re.Branch, re.State || info.state, re.telegram_chat_id,
       date, reporterList, info.home.length, info.office.length,
       status, errorMsg, triggeredBy]
    ).catch(() => {});
  }

  console.log(`[home-office-visit-alert] Done — sent: ${sent}, failed: ${failed}`);
  return { sent, failed, skipped: false };
}

// ── Cron registration ─────────────────────────────────────────────────────────

function register() {
  // 12:00 noon IST, Monday–Saturday (0=Sun, 1=Mon … 6=Sat)
  cron.schedule('0 12 * * 1-6', () => {
    run('cron').catch(err => console.error('[home-office-visit-alert] Unhandled error:', err));
  }, { timezone: 'Asia/Kolkata' });

  console.log('[home-office-visit-alert] Cron registered — 12:00 noon IST, Mon–Sat');
}

module.exports = { register, run };
