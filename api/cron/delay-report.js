/**
 * CRON: Daily Page Delay Report — runs at 8:00 AM IST every day.
 *
 * What it does:
 *   1. Fetches today's production data (gmg_raj + gmg_mpcg editions)
 *   2. Groups delayed editions by branch/unit
 *   3. For each delayed branch, finds the Desk Head & RE from `user` table
 *      whose telegram_chat_id is configured
 *   4. Sends a formatted Telegram message to each recipient
 *
 * Telegram chat IDs must be stored in user.telegram_chat_id column.
 * Story_Type matching:
 *   - RE       : Story_Type REGEXP '\\bRE\\b'  (exact word)
 *   - Desk Head: Story_Type LIKE '%desk%'
 *
 * To configure: fill TELEGRAM_BOT_TOKEN in .env, then update
 *   telegram_chat_id for each Desk Head & RE in the user table.
 */

const cron         = require('node-cron');
const { query }    = require('../_lib/mysql');
const { sendMessage } = require('../_lib/telegram');

// ── Constants ─────────────────────────────────────────────────────────────────
const DELAY_WARN_MINUTES = 0;   // > 0 min = delayed

// ── Production query (reuses same logic as api/production.js) ─────────────────
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
  GROUP BY pub_date, code
`;

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
  const h    = Math.floor(abs / 60);
  const m    = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// mysql2 timezone:'Z' stores IST datetimes as UTC-labeled Date objects,
// so getUTCHours() returns the correct stored IST value.
// For strings from GROUP_CONCAT/pickReleaseTime, use regex to extract HH:MM directly.
function fmtTime(dt) {
  if (!dt) return '—';
  if (dt instanceof Date) {
    return `${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
  }
  const m = String(dt).match(/[T ](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '—';
}

function todayIST() {
  const d = new Date();
  // Use IST local date (UTC+5:30) to avoid UTC date being 1 day behind after midnight IST
  const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

// ── Fetch today's delayed editions grouped by unit/branch ────────────────────
async function fetchDelayedByBranch(date) {
  // GMG file names start with the publish date as ddmmyyyy → a LIKE prefix uses the
  // index on input_file instead of scanning (STR_TO_DATE/REGEXP defeated the index).
  const [dY, dM, dD] = date.split('-');
  const datePrefix = `${dD}${dM}${dY}-%`;
  const [rajRows, mpcgRows] = await Promise.all([
    query(RELEASES_SQL('gmg_raj',  'RAJ'),  [datePrefix]).catch(() => []),
    query(RELEASES_SQL('gmg_mpcg', 'MPCG'), [datePrefix]).catch(() => []),
  ]);
  const releases = [...rajRows, ...mpcgRows];
  if (!releases.length) return {};

  const schedRows = await query(
    `SELECT UPPER(file_name) AS code, file_name, state, unit, district,
            edition_name, edition_type, schedule_time
     FROM page_schedule_time`
  );
  const schedMap = {};
  schedRows.forEach(s => { schedMap[s.code] = s; });

  const pubDate = new Date(date);
  const byBranch = {};   // key: unit (branch name)

  releases.forEach(r => {
    const sched = schedMap[r.code];
    if (!sched) return;

    const [sh, sm]  = (sched.schedule_time || '00:00:00').split(':').map(Number);
    const schedDate = new Date(pubDate);
    if (sh >= 12) schedDate.setDate(schedDate.getDate() - 1);
    schedDate.setHours(sh, sm, 0, 0);
    const schedMs = schedDate.getTime();

    // Use the most recent upload at or before 2:30 AM IST.
    const allTimes   = r.all_release_times || String(r.release_time || '').replace('T', ' ').slice(0, 19);
    const best       = pickLatestBefore230(allTimes);
    const releaseMs    = best ? best.ms : new Date(r.release_time).getTime();
    const release_time = best ? best.time : r.release_time;
    const delay_minutes = Math.min(Math.round((releaseMs - schedMs) / 60000), 149);

    if (delay_minutes <= DELAY_WARN_MINUTES) return; // on time — skip

    const unit  = sched.unit  || r.code;
    const state = sched.state || '';

    if (!byBranch[unit]) byBranch[unit] = { unit, state, editions: [], total: 0 };
    byBranch[unit].editions.push({
      edition_name:  sched.edition_name || r.code,
      schedule_time: sched.schedule_time,
      release_time,
      delay_minutes,
      delay_hhmm:   fmtDelay(delay_minutes),
    });
    byBranch[unit].total++;
  });

  return byBranch;
}

// ── Fetch Telegram recipients (Desk Head + RE) for a given branch ─────────────
async function getRecipients(branch) {
  const rows = await query(
    `SELECT EMPNAME, Story_Type, emp_designation, Branch, State, telegram_chat_id
     FROM \`user\`
     WHERE Branch = ?
       AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
       AND (is_emp_working = 1 OR Status IN ('Working','Active'))
       AND Story_Type IN ('Desk Head', 'RE')`,
    [branch]
  ).catch(() => []);
  return rows;
}

// ── Build message for one branch ──────────────────────────────────────────────
function buildMessage(branch, state, editions, reportDate) {
  const dateStr = new Date(reportDate).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const lines = [];
  lines.push(`🔴 <b>Page Delay Report</b>`);
  lines.push(`📍 Branch: <b>${branch}</b> · ${state}`);
  lines.push(`📅 Date: ${dateStr}`);
  lines.push('');

  // Sort by worst delay first
  const sorted = [...editions].sort((a, b) => b.delay_minutes - a.delay_minutes);
  lines.push(`⚠️ <b>Delayed Editions (${sorted.length}):</b>`);
  sorted.forEach(e => {
    const sched   = (e.schedule_time || '').slice(0, 5);
    const released = fmtTime(e.release_time);
    lines.push(`📰 ${e.edition_name}`);
    lines.push(`   Sched: ${sched}  |  Released: ${released}  |  Delay: <b>${e.delay_hhmm}</b>`);
  });

  lines.push('');
  const maxDelay = Math.max(...editions.map(e => e.delay_minutes));
  lines.push(`⏱ Max Delay: <b>${fmtDelay(maxDelay)}</b>`);
  lines.push('');
  lines.push(`<i>Auto Report · Patrika Newsroom · 8:00 AM</i>`);
  lines.push('');
  lines.push(`📝 <b>Submit Delay Reason:</b>`);
  lines.push(`Reply to this bot with your reason:`);
  lines.push(`<code>REASON ${reportDate} your reason here</code>`);
  lines.push(`Example: <code>REASON ${reportDate} Power outage at press</code>`);

  return lines.join('\n');
}

// ── Main job function ─────────────────────────────────────────────────────────
async function runDelayReport(dateOverride) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[delay-report] TELEGRAM_BOT_TOKEN not set — skipping');
    return { skipped: true, reason: 'no token' };
  }

  const date    = dateOverride || todayIST();
  const results = { date, sent: [], failed: [], noRecipients: [], noDelays: false };

  let byBranch;
  try {
    byBranch = await fetchDelayedByBranch(date);
  } catch (err) {
    console.error('[delay-report] DB error fetching editions:', err.message);
    return { error: err.message };
  }

  const delayedBranches = Object.values(byBranch);
  if (!delayedBranches.length) {
    console.log(`[delay-report] No delays on ${date} — nothing to send`);
    results.noDelays = true;
    return results;
  }

  console.log(`[delay-report] ${date} — ${delayedBranches.length} branches delayed`);

  for (const b of delayedBranches) {
    let recipients;
    try {
      recipients = await getRecipients(b.unit);
    } catch (err) {
      console.error(`[delay-report] Cannot fetch recipients for ${b.unit}:`, err.message);
      continue;
    }

    if (!recipients.length) {
      results.noRecipients.push(b.unit);
      console.log(`[delay-report] ${b.unit} — no Telegram recipients configured`);
      continue;
    }

    const text = buildMessage(b.unit, b.state, b.editions, date);

    for (const person of recipients) {
      try {
        const tgRes = await sendMessage(person.telegram_chat_id, text);
        if (tgRes.ok) {
          console.log(`[delay-report] ✅ Sent to ${person.EMPNAME} (${b.unit})`);
          results.sent.push({ branch: b.unit, name: person.EMPNAME, chat_id: person.telegram_chat_id });
        } else {
          throw new Error(tgRes.description || 'Telegram error');
        }
        // Log to DB (non-fatal)
        query(
          `INSERT INTO telegram_logs (alert_id, message, chat_id, status, telegram_response)
           VALUES (NULL, ?, ?, ?, ?)`,
          [text, person.telegram_chat_id, 'sent', JSON.stringify(tgRes)]
        ).catch(() => {});
      } catch (err) {
        console.error(`[delay-report] ❌ Failed for ${person.EMPNAME} (${b.unit}):`, err.message);
        results.failed.push({ branch: b.unit, name: person.EMPNAME, error: err.message });
      }
    }
  }

  return results;
}

// ── Auto-add telegram_chat_id column if missing ───────────────────────────────
async function ensureColumn() {
  try {
    await query(
      `ALTER TABLE \`user\` ADD COLUMN \`telegram_chat_id\` VARCHAR(100) NULL DEFAULT NULL`
    );
    console.log('[delay-report] ✅ Added telegram_chat_id column to user table');
  } catch (err) {
    // Ignore "Duplicate column" — column already exists
    if (!err.message.includes('Duplicate column') && !err.message.includes('1060')) {
      console.warn('[delay-report] Could not add telegram_chat_id column:', err.message);
    }
  }
}

// ── Auto-create delay_reasons table if missing ────────────────────────────────
async function ensureDelayReasonsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS delay_reasons (
        id                   INT AUTO_INCREMENT PRIMARY KEY,
        branch               VARCHAR(200) NOT NULL,
        state                VARCHAR(100) DEFAULT '',
        pub_date             DATE         NOT NULL,
        reason               TEXT         NOT NULL,
        submitted_by_name    VARCHAR(200) DEFAULT '',
        submitted_by_chat_id VARCHAR(50)  DEFAULT '',
        submitted_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pub_date    (pub_date),
        INDEX idx_branch_date (branch, pub_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[delay-report] ✅ delay_reasons table ready');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.warn('[delay-report] delay_reasons table warning:', err.message);
    }
  }
}

// ── Register cron — 8:00 AM IST every day ────────────────────────────────────
function register() {
  ensureColumn();             // run once on startup
  ensureDelayReasonsTable();  // create delay_reasons table if not exists

  // node-cron format: second(opt) minute hour day month weekday
  // 8:00 AM IST = 8:00 AM Asia/Kolkata
  cron.schedule('0 8 * * *', async () => {
    console.log('[delay-report] ⏰ 8:00 AM — running daily page delay report…');
    try {
      const res = await runDelayReport();
      console.log('[delay-report] Done:', JSON.stringify(res));
    } catch (err) {
      console.error('[delay-report] Cron error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[delay-report] ✅ Scheduled: daily 8:00 AM IST page delay report');
}

module.exports = { register, runDelayReport };
