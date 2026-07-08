/**
 * CRON: Top-10 Edition Delay Report
 *
 * Runs daily at 8:00 AM IST, Mon–Sat.
 * Sends the 10 most-delayed editions (all states) via Telegram
 * to the user whose pan_no = AFZPJ6299J.
 *
 * Manual trigger: POST /api/production/top-delay-alert
 * View logs    : GET  /api/production/top-delay-alert
 */

const cron            = require('node-cron');
const { query }       = require('../_lib/mysql');
const { sendMessage } = require('../_lib/telegram');

const RECIPIENT_PAN = 'AFZPJ6299J';
const TOP_N         = 10;

// ── Helpers (mirror api/production.js logic) ──────────────────────────────────

// Hard cutoff: no upload after 2:30 AM IST is used for release time.
function isBefore230(t) {
  const m = String(t || '').match(/[T ](\d{2}):(\d{2})/);
  if (!m) return false;
  const h = +m[1], min = +m[2];
  return h < 2 || (h === 2 && min <= 30);
}

function pickLatestBefore230(allTimesStr) {
  if (!allTimesStr) return null;
  const parts = String(allTimesStr).split('|').map(s => s.trim()).filter(Boolean);
  const valid = parts.find(t => !isNaN(new Date(t).getTime()) && isBefore230(t));
  if (valid) return { ms: new Date(valid).getTime(), time: valid };
  const dateStr = (parts[0] || '').slice(0, 10);
  if (!dateStr) return null;
  const capped = `${dateStr} 02:30:00`;
  return { ms: new Date(capped).getTime(), time: capped };
}

function fmtDelay(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs  = Math.abs(Math.round(minutes));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function fmtTime(dt) {
  if (!dt) return '—';
  if (dt instanceof Date) {
    return `${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
  }
  const m = String(dt).match(/[T ](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '—';
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
}

// ── Ensure log table ──────────────────────────────────────────────────────────

async function ensureLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS top_delay_alert_logs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      visit_date   DATE        DEFAULT NULL,
      chat_id      VARCHAR(100) DEFAULT NULL,
      recipient    VARCHAR(200) DEFAULT NULL,
      status       ENUM('sent','failed','skipped') DEFAULT 'skipped',
      error_msg    TEXT        DEFAULT NULL,
      triggered_by VARCHAR(20) DEFAULT 'cron',
      message_text TEXT        DEFAULT NULL,
      sent_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
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

    const allTimes   = r.all_release_times || String(r.release_time || '').replace('T', ' ').slice(0, 19);
    const best       = pickLatestBefore230(allTimes);
    const releaseMs    = best ? best.ms : new Date(r.release_time).getTime();
    const release_time = best ? best.time : r.release_time;
    const delay_minutes = Math.min(Math.round((releaseMs - schedMs) / 60000), 149);
    if (delay_minutes <= 0) return; // on time — skip

    editions.push({
      edition_name:  sched.edition_name || r.code,
      unit:          sched.unit || '',
      state:         sched.state || '',
      schedule_time: sched.schedule_time || '',
      release_time,
      delay_minutes,
      delay_hhmm:    fmtDelay(delay_minutes),
    });
  });

  // Sort worst-first, take top N
  editions.sort((a, b) => b.delay_minutes - a.delay_minutes);
  return { top: editions.slice(0, TOP_N), total: editions.length };
}

// ── Build Telegram message ────────────────────────────────────────────────────

function buildMessage(date, top, total) {
  const dateLabel = new Date(date).toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  const lines = [
    `🔴 <b>Top ${top.length} Delayed Editions</b>`,
    `📅 <b>${dateLabel}</b>  (${total} editions delayed in total)`,
    '',
  ];

  top.forEach((e, i) => {
    const sched   = (e.schedule_time || '').slice(0, 5);
    const released = fmtTime(e.release_time);
    lines.push(
      `${i + 1}. <b>${e.edition_name}</b>  [${e.unit || e.state}]`,
      `   Sched: ${sched} → Released: ${released} · Delay: <b>${e.delay_hhmm}</b>`,
    );
  });

  lines.push('', `<i>— Patrika Newsroom · Auto Report · 8:00 AM IST</i>`);
  return lines.join('\n');
}

// ── Core run function ─────────────────────────────────────────────────────────

async function run(triggeredBy = 'cron', dateOverride = null) {
  await ensureLogTable();

  const date = dateOverride || todayIST();
  console.log(`[top-delay-report] Running for ${date} (by: ${triggeredBy})`);

  // Get recipient
  const [recipient] = await query(
    `SELECT EMPNAME, telegram_chat_id FROM \`user\`
     WHERE pan_no = ? AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
     LIMIT 1`,
    [RECIPIENT_PAN]
  ).catch(() => []);

  if (!recipient) {
    console.log(`[top-delay-report] Recipient ${RECIPIENT_PAN} has no telegram_chat_id — skipping`);
    return { sent: 0, failed: 0, skipped: true, reason: 'no recipient chat_id' };
  }

  let top, total;
  try {
    ({ top, total } = await fetchTop10(date));
  } catch (err) {
    console.error('[top-delay-report] DB error:', err.message);
    return { error: err.message };
  }

  if (!top.length) {
    console.log(`[top-delay-report] No delays on ${date} — skipping`);
    await query(
      `INSERT INTO top_delay_alert_logs (visit_date, chat_id, recipient, status, triggered_by, message_text)
       VALUES (?, ?, ?, 'skipped', ?, 'No delayed editions found')`,
      [date, recipient.telegram_chat_id, recipient.EMPNAME, triggeredBy]
    ).catch(() => {});
    return { sent: 0, failed: 0, skipped: true, reason: 'no delays' };
  }

  const text = buildMessage(date, top, total);
  let status = 'failed', errorMsg = null;

  try {
    await sendMessage(recipient.telegram_chat_id, text);
    status = 'sent';
    console.log(`[top-delay-report] Sent to ${recipient.EMPNAME} — top ${top.length} of ${total} delayed`);
  } catch (err) {
    errorMsg = err.message;
    console.error(`[top-delay-report] Failed: ${err.message}`);
  }

  await query(
    `INSERT INTO top_delay_alert_logs (visit_date, chat_id, recipient, status, error_msg, triggered_by, message_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [date, recipient.telegram_chat_id, recipient.EMPNAME, status, errorMsg, triggeredBy, text]
  ).catch(() => {});

  return { sent: status === 'sent' ? 1 : 0, failed: status === 'failed' ? 1 : 0, skipped: false, top, total };
}

// ── Register cron ─────────────────────────────────────────────────────────────

function register() {
  cron.schedule('0 8 * * 1-6', () => {
    run('cron').catch(err => console.error('[top-delay-report] Unhandled error:', err));
  }, { timezone: 'Asia/Kolkata' });

  console.log('[top-delay-report] Cron registered — 8:00 AM IST, Mon–Sat');
}

module.exports = { register, run };
