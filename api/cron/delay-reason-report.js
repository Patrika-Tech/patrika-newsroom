/**
 * CRON: 9 AM Delay + Reason Report
 *
 * Runs daily at 9:00 AM IST.
 * Fetches today's top-10 most-delayed editions and any delay reasons
 * submitted by REs via Telegram bot, then sends a compiled report to
 * the user whose pan_no = CHFPK8050E.
 *
 * Manual trigger: POST /api/production/delay-reason-report
 * View logs    : GET  /api/production/delay-reason-report
 */

const cron            = require('node-cron');
const { query }       = require('../_lib/mysql');
const { sendMessage } = require('../_lib/telegram');

const RECIPIENT_PAN = 'CHFPK8050E';
const TOP_N         = 10;

// ── Helpers (mirror production.js logic) ─────────────────────────────────────

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
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function fmtTime(dt) {
  if (!dt) return '--';
  if (dt instanceof Date) {
    return `${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
  }
  const m = String(dt).match(/[T ](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '--';
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
}

// ── Fetch top-N delayed editions ──────────────────────────────────────────────

const RELEASES_SQL = (tbl, region) => `
  SELECT
    STR_TO_DATE(LEFT(input_file, 8), '%d%m%Y')                             AS pub_date,
    UPPER(SUBSTRING_INDEX(SUBSTRING_INDEX(input_file, '-', 2), '-', -1))   AS code,
    MAX(date_time_pdf)                                                      AS release_time,
    GROUP_CONCAT(DISTINCT date_time_pdf ORDER BY date_time_pdf DESC SEPARATOR '|')
                                                                            AS all_release_times,
    '${region}'                                                             AS region
  FROM \`${tbl}\`
  WHERE input_file LIKE ?
    AND date_time_pdf IS NOT NULL
    AND input_file NOT LIKE '%\\_REV\\_%'
  GROUP BY pub_date, code
`;

async function fetchTop10(date) {
  const [dY, dM, dD] = date.split('-');
  const datePrefix = `${dD}${dM}${dY}-%`;

  const [rajRows, mpcgRows, schedRows] = await Promise.all([
    query(RELEASES_SQL('gmg_raj',  'RAJ'),  [datePrefix]).catch(() => []),
    query(RELEASES_SQL('gmg_mpcg', 'MPCG'), [datePrefix]).catch(() => []),
    query(`SELECT UPPER(file_name) AS code, edition_name, unit, state, schedule_time
           FROM page_schedule_time`).catch(() => []),
  ]);

  const schedMap = {};
  schedRows.forEach(s => { schedMap[s.code] = s; });

  const pubDate  = new Date(date);
  const editions = [];

  [...rajRows, ...mpcgRows].forEach(r => {
    const sched = schedMap[r.code];
    if (!sched) return;

    const [sh, sm]  = (sched.schedule_time || '00:00:00').split(':').map(Number);
    const schedDate = new Date(pubDate);
    if (sh >= 12) schedDate.setDate(schedDate.getDate() - 1);
    schedDate.setHours(sh, sm, 0, 0);
    const schedMs = schedDate.getTime();

    const allTimes      = r.all_release_times || String(r.release_time || '').replace('T', ' ').slice(0, 19);
    const best          = pickLatestBefore230(allTimes, date);
    const releaseMs     = best ? best.ms : new Date(r.release_time).getTime();
    const release_time  = best ? best.time : r.release_time;
    const delay_minutes = Math.min(Math.round((releaseMs - schedMs) / 60000), 149);
    if (delay_minutes <= 0) return;

    editions.push({
      edition_name:  sched.edition_name || r.code,
      unit:          sched.unit  || '',
      state:         sched.state || '',
      schedule_time: sched.schedule_time || '',
      release_time,
      delay_minutes,
      delay_hhmm:    fmtDelay(delay_minutes),
    });
  });

  editions.sort((a, b) => b.delay_minutes - a.delay_minutes);
  return { top: editions.slice(0, TOP_N), total: editions.length };
}

// ── Fetch submitted delay reasons for today ───────────────────────────────────

async function fetchReasons(date) {
  return query(
    `SELECT branch, state, reason, submitted_by_name, submitted_at
     FROM delay_reasons
     WHERE pub_date = ?
     ORDER BY branch, submitted_at`,
    [date]
  ).catch(() => []);
}

// ── Build combined report message ─────────────────────────────────────────────

function buildReport(date, top, total, reasons) {
  const dateLabel = new Date(date).toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  // Index reasons by branch for quick lookup
  const reasonMap = {};
  for (const r of reasons) {
    const key = (r.branch || '').toLowerCase();
    if (!reasonMap[key]) reasonMap[key] = [];
    reasonMap[key].push(r);
  }

  const lines = [
    `📋 <b>Delay Report with Reasons — 9:00 AM</b>`,
    `📅 <b>${dateLabel}</b>  (${total} editions delayed in total)`,
    '',
  ];

  top.forEach((e, i) => {
    const sched    = (e.schedule_time || '').slice(0, 5);
    const released = fmtTime(e.release_time);
    const branchReasons = reasonMap[(e.unit || '').toLowerCase()] || [];

    lines.push(`${i + 1}. <b>${e.edition_name}</b>  [${e.unit || e.state}]`);
    lines.push(`   Sched: ${sched} → Released: ${released} | Delay: <b>${e.delay_hhmm}</b>`);

    if (branchReasons.length) {
      for (const r of branchReasons) {
        const time = String(r.submitted_at || '').slice(11, 16) || '';
        lines.push(`   📝 <i>${r.reason}</i>  — ${r.submitted_by_name}${time ? ' (' + time + ')' : ''}`);
      }
    } else {
      lines.push(`   📝 <i>No reason submitted</i>`);
    }
  });

  const reasonedCount = top.filter(e => reasonMap[(e.unit || '').toLowerCase()]?.length).length;
  lines.push('');
  lines.push(`<b>Reasons received:</b> ${reasonedCount} / ${top.length} branches`);
  lines.push('');
  lines.push(`<i>— Patrika Newsroom · Auto Report · 9:00 AM IST</i>`);

  return lines.join('\n');
}

// ── Ensure log table ──────────────────────────────────────────────────────────

async function ensureLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS delay_reason_report_logs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      report_date  DATE         DEFAULT NULL,
      chat_id      VARCHAR(100) DEFAULT NULL,
      recipient    VARCHAR(200) DEFAULT NULL,
      status       ENUM('sent','failed','skipped') DEFAULT 'skipped',
      error_msg    TEXT         DEFAULT NULL,
      triggered_by VARCHAR(20)  DEFAULT 'cron',
      sent_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
}

// ── Core run function ─────────────────────────────────────────────────────────

async function run(triggeredBy = 'cron', dateOverride = null) {
  await ensureLogTable();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[delay-reason-report] TELEGRAM_BOT_TOKEN not set -- skipping');
    return { skipped: true, reason: 'no token' };
  }

  const date = dateOverride || todayIST();
  console.log(`[delay-reason-report] Running for ${date} (by: ${triggeredBy})`);

  // Get recipient by PAN
  const [recipient] = await query(
    `SELECT EMPNAME, telegram_chat_id FROM \`user\`
     WHERE pan_no = ? AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
     LIMIT 1`,
    [RECIPIENT_PAN]
  ).catch(() => []);

  if (!recipient) {
    console.log(`[delay-reason-report] Recipient ${RECIPIENT_PAN} has no telegram_chat_id -- skipping`);
    await query(
      `INSERT INTO delay_reason_report_logs (report_date, status, triggered_by, error_msg)
       VALUES (?, 'skipped', ?, 'no recipient chat_id')`,
      [date, triggeredBy]
    ).catch(() => {});
    return { skipped: true, reason: 'no recipient chat_id' };
  }

  let top, total;
  try {
    ({ top, total } = await fetchTop10(date));
  } catch (err) {
    console.error('[delay-reason-report] DB error fetching editions:', err.message);
    return { error: err.message };
  }

  if (!top.length) {
    console.log(`[delay-reason-report] No delays on ${date} -- skipping`);
    await query(
      `INSERT INTO delay_reason_report_logs (report_date, chat_id, recipient, status, triggered_by, error_msg)
       VALUES (?, ?, ?, 'skipped', ?, 'No delayed editions')`,
      [date, recipient.telegram_chat_id, recipient.EMPNAME, triggeredBy]
    ).catch(() => {});
    return { skipped: true, reason: 'no delays' };
  }

  const reasons = await fetchReasons(date);
  const text    = buildReport(date, top, total, reasons);

  let status = 'failed', errorMsg = null;
  try {
    await sendMessage(recipient.telegram_chat_id, text);
    status = 'sent';
    console.log(`[delay-reason-report] Sent to ${recipient.EMPNAME} (${RECIPIENT_PAN}) -- ${top.length} editions, ${reasons.length} reasons`);
  } catch (err) {
    errorMsg = err.message;
    console.error(`[delay-reason-report] Failed: ${err.message}`);
  }

  await query(
    `INSERT INTO delay_reason_report_logs (report_date, chat_id, recipient, status, error_msg, triggered_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [date, recipient.telegram_chat_id, recipient.EMPNAME, status, errorMsg, triggeredBy]
  ).catch(() => {});

  return {
    sent: status === 'sent' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    skipped: false,
    recipient: recipient.EMPNAME,
    editionCount: top.length,
    reasonCount: reasons.length,
  };
}

// ── Register cron -- 9:00 AM IST every day ───────────────────────────────────

function register() {
  cron.schedule('0 9 * * *', () => {
    run('cron').catch(err => console.error('[delay-reason-report] Unhandled error:', err));
  }, { timezone: 'Asia/Kolkata' });

  console.log('[delay-reason-report] Cron registered -- 9:00 AM IST daily');
}

module.exports = { register, run };
