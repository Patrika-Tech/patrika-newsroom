const https      = require('https');
const { query }  = require('../_lib/mysql');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const LEAVE_EXCL = `'P','MP','WFH','OD','T','TL','SU','ES','SPL','WOP','PH','WOHP','H','WO','A','CF'`;

function tgPost(token, method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', d => data += d);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendOne(token, chatId, text) {
  const tgRes = await tgPost(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  query(
    'INSERT INTO telegram_logs (alert_id, message, chat_id, status, telegram_response) VALUES (NULL, ?, ?, ?, ?)',
    [text, chatId, tgRes.ok ? 'sent' : 'failed', JSON.stringify(tgRes)]
  ).catch(() => {});
  return tgRes;
}

function fmtDate(d) {
  return new Date(String(d).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// ── IST date helpers (mirror of live.js) ──────────────────────────────────────
function toIST(ms) { return new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10); }
function leaveWindow() {
  const istDay = new Date(Date.now() + 5.5 * 3600000).getDay();
  const from   = toIST(Date.now() - (istDay === 0 ? 13 : istDay + 6) * 864e5);
  const to     = toIST(Date.now() - 2 * 864e5);
  return { from, to };
}

// ── Per-branch personalized: Staff On Leave ───────────────────────────────────
async function sendStaffLeave(token, branches) {
  const { from, to } = leaveWindow();
  const ph = branches.map(() => '?').join(',');

  const [employees, reList, stateHeads] = await Promise.all([
    // Each employee's min/max leave date in the window, per branch
    query(
      `SELECT u.EMPNAME, u.Branch,
              MIN(h.att_date) AS from_date,
              MAX(h.att_date) AS to_date
       FROM hrms_data h
       JOIN \`user\` u ON UPPER(TRIM(u.pan_no)) = UPPER(TRIM(h.pan_no))
       WHERE h.att_date BETWEEN ? AND ?
         AND UPPER(TRIM(h.att_type)) NOT IN (${LEAVE_EXCL})
         AND u.Branch IN (${ph})
         AND (u.is_emp_working = 1 OR u.Status IN ('Working','Active'))
       GROUP BY u.pan_no, u.EMPNAME, u.Branch
       ORDER BY u.Branch, u.EMPNAME`,
      [from, to, ...branches]
    ).catch(() => []),

    // REs of affected branches
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
       WHERE Branch IN (${ph})
         AND Story_Type = 'RE'
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      branches
    ).catch(() => []),

    // State Heads for parent states
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
       WHERE State IN (
         SELECT DISTINCT State FROM \`user\` WHERE Branch IN (${ph}) AND State IS NOT NULL AND State != ''
       )
         AND Story_Type IN ('State Head', 'SH')
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      branches
    ).catch(() => []),
  ]);

  // Group employees by branch
  const byBranch = {};
  employees.forEach(e => {
    (byBranch[e.Branch] = byBranch[e.Branch] || []).push(e);
  });

  const fromLabel = fmtDate(from);
  const toLabel   = fmtDate(to);
  const sent = [], failed = [];

  // Send branch-specific message to each RE
  for (const re of reList) {
    const emps = byBranch[re.Branch] || [];
    if (!emps.length) continue;

    const empList = emps.map(e => {
      const fd = fmtDate(e.from_date);
      const td = fmtDate(e.to_date);
      return `• ${e.EMPNAME} (${fd}${fd !== td ? ` – ${td}` : ''})`;
    }).join('\n');

    const text =
      `📅 <b>Staff on Leave — ${re.Branch}</b>\n\n` +
      `${emps.length} employee${emps.length > 1 ? 's' : ''} on leave (${fromLabel} → ${toLabel}):\n` +
      `${empList}\n\n` +
      `<i>Patrika Newsroom</i>`;

    try {
      const tgRes = await sendOne(token, re.telegram_chat_id, text);
      if (tgRes.ok) sent.push({ name: re.EMPNAME, branch: re.Branch });
      else failed.push({ name: re.EMPNAME, branch: re.Branch, error: tgRes.description });
    } catch (err) {
      failed.push({ name: re.EMPNAME, branch: re.Branch, error: err.message });
    }
  }

  // Send consolidated summary to State Heads
  for (const sh of stateHeads) {
    // Only branches in this state
    const stateBranches = reList
      .filter(r => r.State === sh.State)
      .map(r => r.Branch);

    const stateEmps = employees.filter(e => stateBranches.includes(e.Branch));
    if (!stateEmps.length) continue;

    const empList = stateEmps.map(e => {
      const fd = fmtDate(e.from_date);
      const td = fmtDate(e.to_date);
      return `• ${e.EMPNAME} (${e.Branch}) — ${fd}${fd !== td ? ` – ${td}` : ''}`;
    }).join('\n');

    const text =
      `📅 <b>Staff on Leave — ${sh.State} Summary</b>\n\n` +
      `${stateEmps.length} employee${stateEmps.length > 1 ? 's' : ''} on leave (${fromLabel} → ${toLabel}):\n` +
      `${empList}\n\n` +
      `<i>Patrika Newsroom</i>`;

    try {
      const tgRes = await sendOne(token, sh.telegram_chat_id, text);
      if (tgRes.ok) sent.push({ name: sh.EMPNAME, branch: sh.State + ' (SH)', state: sh.State });
      else failed.push({ name: sh.EMPNAME, error: tgRes.description });
    } catch (err) {
      failed.push({ name: sh.EMPNAME, error: err.message });
    }
  }

  return { sent, failed };
}

// ── Generic: same message to all branch REs + State Heads ────────────────────
async function sendGeneric(token, text, branches) {
  const ph = branches.map(() => '?').join(',');
  const [reList, stateHeads] = await Promise.all([
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
       WHERE Branch IN (${ph})
         AND Story_Type = 'RE'
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      branches
    ).catch(() => []),
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
       WHERE State IN (
         SELECT DISTINCT State FROM \`user\` WHERE Branch IN (${ph}) AND State IS NOT NULL AND State != ''
       )
         AND Story_Type IN ('State Head', 'SH')
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      branches
    ).catch(() => []),
  ]);

  const seen = new Map();
  [...reList, ...stateHeads].forEach(u => {
    if (!seen.has(u.telegram_chat_id))
      seen.set(u.telegram_chat_id, { name: u.EMPNAME, branch: u.Branch, state: u.State, chatId: u.telegram_chat_id });
  });

  const sent = [], failed = [];
  for (const r of seen.values()) {
    try {
      const tgRes = await sendOne(token, r.chatId, text);
      if (tgRes.ok) sent.push({ name: r.name, branch: r.branch, state: r.state });
      else failed.push({ name: r.name, branch: r.branch, error: tgRes.description });
    } catch (err) {
      failed.push({ name: r.name, branch: r.branch, error: err.message });
    }
  }
  return { sent, failed };
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });

  const alert          = req.body?.alert;
  const overrideChatId = (req.body?.chat_id || '').toString().trim();

  const alertBranches = alert?.branches || [];
  const alertType     = alert?.type || '';

  let sent = [], failed = [];

  if (alertBranches.length > 0) {
    // Per-type personalized dispatch
    const result = alertType === 'Staff On Leave'
      ? await sendStaffLeave(token, alertBranches)
      : await sendGeneric(token, buildGenericText(alert), alertBranches);

    sent   = result.sent;
    failed = result.failed;
  }

  if (sent.length === 0 && failed.length === 0) {
    // Fallback: plain message to single chat_id
    const text = req.body?.message || (alert ? buildGenericText(alert) : null);
    if (!text) return res.status(400).json({ ok: false, error: 'message or alert required' });

    const fallbackChatId = overrideChatId || (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!fallbackChatId) return res.status(400).json({ ok: false, error: 'No recipients found and no chat_id configured' });

    try {
      const tgRes = await sendOne(token, fallbackChatId, text);
      if (tgRes.ok) sent.push({ name: 'Default', branch: null });
      else failed.push({ name: 'Default', error: tgRes.description });
    } catch (err) {
      failed.push({ name: 'Default', error: err.message });
    }
  }

  const ok = sent.length > 0;
  return res.status(ok ? 200 : 502).json({ ok, sent: sent.length, failed: failed.length, recipients: sent, errors: failed.length ? failed : undefined });
};

function buildGenericText(alert) {
  if (!alert) return '';
  const sev = alert.sev === 'high' ? '🔴' : alert.sev === 'med' ? '🟡' : '🟢';
  return `${sev} <b>[${alert.type || 'Alert'}]</b>\n${alert.text || ''}\n\n<i>Patrika Newsroom</i>`;
}
