const https      = require('https');
const { query }  = require('../_lib/mysql');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const LEAVE_EXCL = `'P','MP','WFH','OD','T','TL','SU','ES','SPL','WOP','PH','WOHP','H','WO','A','CF'`;

// ── Telegram raw POST ─────────────────────────────────────────────────────────
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

// ── Send one message + log to DB ─────────────────────────────────────────────
async function sendOne(token, chatId, text) {
  const tgRes = await tgPost(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  query(
    'INSERT INTO telegram_logs (alert_id, message, chat_id, status, telegram_response) VALUES (NULL, ?, ?, ?, ?)',
    [text, chatId, tgRes.ok ? 'sent' : 'failed', JSON.stringify(tgRes)]
  ).catch(() => {});
  return tgRes;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '?';
  if (d instanceof Date) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
  }
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function toIST(ms) { return new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10); }
function leaveWindow() {
  const istDay = new Date(Date.now() + 5.5 * 3600000).getDay();
  const from   = toIST(Date.now() - (istDay === 0 ? 13 : istDay + 6) * 864e5);
  const to     = toIST(Date.now() - 2 * 864e5);
  return { from, to };
}

// ── Shared DB helpers ─────────────────────────────────────────────────────────

// Returns { reList, stateHeads } scoped to given branch names
async function fetchREsAndStateHeads(branches) {
  if (!branches || !branches.length) return { reList: [], stateHeads: [] };
  const ph = branches.map(() => '?').join(',');
  const [reList, stateHeads] = await Promise.all([
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
       WHERE Branch IN (${ph}) AND Story_Type = 'RE'
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
  return { reList, stateHeads };
}

// Returns State Heads, optionally filtered by state names
async function fetchStateHeads(states) {
  if (states && states.length) {
    const ph = states.map(() => '?').join(',');
    return query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
       WHERE State IN (${ph}) AND Story_Type IN ('State Head', 'SH')
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      states
    ).catch(() => []);
  }
  return query(
    `SELECT EMPNAME, Branch, State, telegram_chat_id FROM \`user\`
     WHERE Story_Type IN ('State Head', 'SH')
       AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
       AND (is_emp_working = 1 OR Status IN ('Working','Active'))`
  ).catch(() => []);
}

// ── Dispatch a list of { chatId, text, name, branch, state } messages ─────────
async function dispatch(token, messages) {
  const sent = [], failed = [];
  for (const m of messages) {
    try {
      const tgRes = await sendOne(token, m.chatId, m.text);
      if (tgRes.ok) sent.push({ name: m.name, branch: m.branch, state: m.state });
      else failed.push({ name: m.name, branch: m.branch, error: tgRes.description });
    } catch (err) {
      failed.push({ name: m.name, branch: m.branch, error: err.message });
    }
  }
  return { sent, failed };
}

// ── Helper for formatting delay minutes ──────────────────────────────────────
function fmtDelay(minutes) {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ── Type-specific handlers ────────────────────────────────────────────────────

async function sendEditionDelay(token, alert) {
  const editions = (alert.meta && alert.meta.editions) || [];
  const { reList, stateHeads } = await fetchREsAndStateHeads(alert.branches);
  const byBranch = {};
  editions.forEach(e => { (byBranch[e.branch] = byBranch[e.branch] || []).push(e); });

  const messages = [];

  for (const re of reList) {
    const eds = byBranch[re.Branch] || [];
    if (!eds.length) continue;
    const list = eds.map(e => `• ${e.name}: +${fmtDelay(e.delay)} late`).join('\n');
    messages.push({
      chatId: re.telegram_chat_id, name: re.EMPNAME, branch: re.Branch, state: re.State,
      text: `🔴 <b>Edition Delay — ${re.Branch}</b>\n\n${list}\n\nPlease escalate to desk immediately.\n\n<i>Patrika Newsroom</i>`,
    });
  }

  for (const sh of stateHeads) {
    const stateBranches = new Set(reList.filter(r => r.State === sh.State).map(r => r.Branch));
    const stateEds = editions.filter(e => stateBranches.has(e.branch));
    if (!stateEds.length) continue;
    const list = stateEds.map(e => `• ${e.name} (${e.branch}): +${fmtDelay(e.delay)}`).join('\n');
    messages.push({
      chatId: sh.telegram_chat_id, name: sh.EMPNAME, branch: sh.Branch, state: sh.State,
      text: `🔴 <b>Edition Delay — ${sh.State} Summary</b>\n\n${stateEds.length} edition${stateEds.length > 1 ? 's' : ''} delayed:\n${list}\n\n<i>Patrika Newsroom</i>`,
    });
  }

  return dispatch(token, messages);
}

async function sendSilentBranch(token, alert) {
  const data = (alert.meta && alert.meta.data) || [];
  const { reList, stateHeads } = await fetchREsAndStateHeads(alert.branches);
  const byBranch = {};
  data.forEach(b => { byBranch[b.branch] = b; });

  const messages = [];

  for (const re of reList) {
    const b = byBranch[re.Branch];
    if (!b) continue;
    messages.push({
      chatId: re.telegram_chat_id, name: re.EMPNAME, branch: re.Branch, state: re.State,
      text: `🔴 <b>Silent Branch — ${re.Branch}</b>\n\nYour branch filed <b>0 stories</b> yesterday.\n${b.reporters} reporters registered.\n\nPlease ensure coverage is submitted today.\n\n<i>Patrika Newsroom</i>`,
    });
  }

  for (const sh of stateHeads) {
    const stateBranches = new Set(reList.filter(r => r.State === sh.State).map(r => r.Branch));
    const stateData = data.filter(b => stateBranches.has(b.branch));
    if (!stateData.length) continue;
    const list = stateData.map(b => `• ${b.branch} (${b.reporters} reporters)`).join('\n');
    messages.push({
      chatId: sh.telegram_chat_id, name: sh.EMPNAME, branch: sh.Branch, state: sh.State,
      text: `🔴 <b>Silent Branch — ${sh.State}</b>\n\n${stateData.length} branch${stateData.length > 1 ? 'es' : ''} filed 0 stories yesterday:\n${list}\n\n<i>Patrika Newsroom</i>`,
    });
  }

  return dispatch(token, messages);
}

async function sendOverdueTasks(token, alert) {
  const data = (alert.meta && alert.meta.data) || [];
  const { reList, stateHeads } = await fetchREsAndStateHeads(alert.branches);
  const byBranch = {};
  data.forEach(b => { byBranch[b.branch] = b; });

  const messages = [];

  for (const re of reList) {
    const b = byBranch[re.Branch];
    if (!b) continue;
    messages.push({
      chatId: re.telegram_chat_id, name: re.EMPNAME, branch: re.Branch, state: re.State,
      text: `🔴 <b>Overdue Tasks — ${re.Branch}</b>\n\n<b>${b.cnt}</b> task${b.cnt > 1 ? 's are' : ' is'} past due date in your branch.\n\nPlease review, reassign or escalate.\n\n<i>Patrika Newsroom</i>`,
    });
  }

  for (const sh of stateHeads) {
    const stateBranches = new Set(reList.filter(r => r.State === sh.State).map(r => r.Branch));
    const stateData = data.filter(b => stateBranches.has(b.branch));
    const total = stateData.reduce((s, b) => s + Number(b.cnt), 0);
    if (!total) continue;
    const list = stateData.map(b => `• ${b.branch}: ${b.cnt} task${b.cnt > 1 ? 's' : ''}`).join('\n');
    messages.push({
      chatId: sh.telegram_chat_id, name: sh.EMPNAME, branch: sh.Branch, state: sh.State,
      text: `🔴 <b>Overdue Tasks — ${sh.State}</b>\n\n${total} overdue tasks across your state:\n${list}\n\n<i>Patrika Newsroom</i>`,
    });
  }

  return dispatch(token, messages);
}

async function sendExtendedAbsence(token, alert) {
  const data = (alert.meta && alert.meta.data) || [];
  const { reList, stateHeads } = await fetchREsAndStateHeads(alert.branches);
  const byBranch = {};
  data.forEach(e => { (byBranch[e.branch] = byBranch[e.branch] || []).push(e); });

  const messages = [];

  for (const re of reList) {
    const absent = byBranch[re.Branch] || [];
    if (!absent.length) continue;
    const list = absent.map(e => `• ${e.name} (${e.days}+ days)`).join('\n');
    messages.push({
      chatId: re.telegram_chat_id, name: re.EMPNAME, branch: re.Branch, state: re.State,
      text: `🔴 <b>Extended Absence — ${re.Branch}</b>\n\nReporters absent 2+ consecutive days:\n${list}\n\nPlease follow up or arrange cover.\n\n<i>Patrika Newsroom</i>`,
    });
  }

  for (const sh of stateHeads) {
    const stateBranches = new Set(reList.filter(r => r.State === sh.State).map(r => r.Branch));
    const stateData = data.filter(e => stateBranches.has(e.branch));
    if (!stateData.length) continue;
    const list = stateData.map(e => `• ${e.name} (${e.branch}) — ${e.days}+ days`).join('\n');
    messages.push({
      chatId: sh.telegram_chat_id, name: sh.EMPNAME, branch: sh.Branch, state: sh.State,
      text: `🔴 <b>Extended Absence — ${sh.State}</b>\n\n${stateData.length} reporter${stateData.length > 1 ? 's' : ''} absent 2+ days:\n${list}\n\n<i>Patrika Newsroom</i>`,
    });
  }

  return dispatch(token, messages);
}

async function sendBirthday(token, alert) {
  const data = (alert.meta && alert.meta.data) || [];
  const { reList } = await fetchREsAndStateHeads(alert.branches);
  const byBranch = {};
  data.forEach(e => { (byBranch[e.branch] = byBranch[e.branch] || []).push(e); });

  const messages = [];
  for (const re of reList) {
    const bdays = byBranch[re.Branch] || [];
    if (!bdays.length) continue;
    const names = bdays.map(e => `• ${e.name}`).join('\n');
    messages.push({
      chatId: re.telegram_chat_id, name: re.EMPNAME, branch: re.Branch, state: re.State,
      text: `🎂 <b>Birthday Today — ${re.Branch}</b>\n\n${names}\n\nWish them on behalf of the team! 🎉\n\n<i>Patrika Newsroom</i>`,
    });
  }

  return dispatch(token, messages);
}

// Retirement: send to global admin chat
async function sendRetirement(token, alert) {
  const data = (alert.meta && alert.meta.data) || [];
  if (!data.length) return { sent: [], failed: [] };

  const list = data.map(e => `• ${e.name} (${e.branch}) — retiring ${e.date}`).join('\n');
  const text = `🟢 <b>Retirement Due</b>\n\n${data.length} employee${data.length > 1 ? 's' : ''} retiring within 60 days:\n${list}\n\nPlease initiate handover process.\n\n<i>Patrika Newsroom</i>`;

  const fallback = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!fallback) return { sent: [], failed: [] };
  try {
    const tgRes = await sendOne(token, fallback, text);
    return { sent: tgRes.ok ? [{ name: 'Admin', branch: null, state: null }] : [], failed: [] };
  } catch (err) {
    return { sent: [], failed: [{ name: 'Admin', error: err.message }] };
  }
}

// State-head-only alerts: QC Spike, Plan Review, Feedback, Event Plan
async function sendStateHeadAlert(token, alert, text) {
  const states = (alert.meta && alert.meta.states) || [];
  const heads = await fetchStateHeads(states.length ? states : null);
  if (!heads.length) return { sent: [], failed: [] };
  const messages = heads.map(sh => ({
    chatId: sh.telegram_chat_id, name: sh.EMPNAME, branch: sh.Branch, state: sh.State, text,
  }));
  return dispatch(token, messages);
}

// ── Staff On Leave (full re-query for personalized branch data) ───────────────
async function sendStaffLeave(token, branches) {
  const { from, to } = leaveWindow();
  const ph = branches.map(() => '?').join(',');

  const [employees, reList, stateHeads] = await Promise.all([
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

  const byBranch = {};
  employees.forEach(e => { (byBranch[e.Branch] = byBranch[e.Branch] || []).push(e); });

  const fromLabel = fmtDate(from);
  const toLabel   = fmtDate(to);
  const sent = [], failed = [];

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
      `${empList}\n\n<i>Patrika Newsroom</i>`;
    try {
      const tgRes = await sendOne(token, re.telegram_chat_id, text);
      if (tgRes.ok) sent.push({ name: re.EMPNAME, branch: re.Branch, state: re.State });
      else failed.push({ name: re.EMPNAME, branch: re.Branch, error: tgRes.description });
    } catch (err) {
      failed.push({ name: re.EMPNAME, branch: re.Branch, error: err.message });
    }
  }

  for (const sh of stateHeads) {
    const stateBranches = reList.filter(r => r.State === sh.State).map(r => r.Branch);
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
      `${empList}\n\n<i>Patrika Newsroom</i>`;
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

// ── Generic fallback: same message to all branch REs + State Heads ────────────
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

function buildGenericText(alert) {
  if (!alert) return '';
  const sev = alert.sev === 'high' ? '🔴' : alert.sev === 'med' ? '🟡' : '🟢';
  return `${sev} <b>[${alert.type || 'Alert'}]</b>\n${alert.text || ''}\n\n<i>Patrika Newsroom</i>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });

  const alert          = req.body && req.body.alert;
  const overrideChatId = ((req.body && req.body.chat_id) || '').toString().trim();

  const alertBranches = (alert && alert.branches) || [];
  const alertType     = (alert && alert.type) || '';
  const meta          = (alert && alert.meta) || {};

  let result = { sent: [], failed: [] };

  if (alertType === 'Staff On Leave' && alertBranches.length) {
    result = await sendStaffLeave(token, alertBranches);
  } else if (alertType === 'Edition Delay' && alertBranches.length) {
    result = await sendEditionDelay(token, alert);
  } else if (alertType === 'Silent Branch' && alertBranches.length) {
    result = await sendSilentBranch(token, alert);
  } else if (alertType === 'Overdue Tasks' && alertBranches.length) {
    result = await sendOverdueTasks(token, alert);
  } else if (alertType === 'Extended Absence' && alertBranches.length) {
    result = await sendExtendedAbsence(token, alert);
  } else if (alertType === 'Birthday Today' && alertBranches.length) {
    result = await sendBirthday(token, alert);
  } else if (alertType === 'Retirement Due') {
    result = await sendRetirement(token, alert);
  } else if (alertType === 'QC Spike') {
    const yM = meta.yesterday || '';
    const avg = meta.avg || '';
    result = await sendStateHeadAlert(token, alert,
      `🟠 <b>QC Spike Alert</b>\n\nQC mistakes jumped to <b>${yM}</b> yesterday vs ${avg}/day average.\n\nPlease check desk briefing and take corrective action.\n\n<i>Patrika Newsroom</i>`
    );
  } else if (alertType === 'Plan Review Pending') {
    const cnt = (meta.count !== undefined ? meta.count : alert && alert.count) || '?';
    result = await sendStateHeadAlert(token, alert,
      `🟡 <b>Plan Review Pending</b>\n\n<b>${cnt}</b> weekly action plan${cnt > 1 ? 's' : ''} awaiting your review &amp; grade.\n\nPatrika Newsroom → Tasks → Weekly Review\n\n<i>Patrika Newsroom</i>`
    );
  } else if (alertType === 'Feedback Pending') {
    const cnt = (meta.count !== undefined ? meta.count : alert && alert.count) || '?';
    result = await sendStateHeadAlert(token, alert,
      `🟡 <b>Feedback Pending</b>\n\n<b>${cnt}</b> high-priority feedback item${cnt > 1 ? 's' : ''} are still open.\n\nPlease review and close in the portal.\n\n<i>Patrika Newsroom</i>`
    );
  } else if (alertType === 'Event Plan Pending') {
    const cnt = (meta.count !== undefined ? meta.count : alert && alert.count) || '?';
    result = await sendStateHeadAlert(token, alert,
      `🟡 <b>Event Plan Pending</b>\n\n<b>${cnt}</b> major event plan${cnt > 1 ? 's' : ''} submitted — awaiting your review.\n\nPatrika Newsroom → Tasks → Events\n\n<i>Patrika Newsroom</i>`
    );
  } else if (alertBranches.length) {
    // Branch-scoped alert with no specific handler: generic message to REs + SHs
    result = await sendGeneric(token, buildGenericText(alert), alertBranches);
  }

  let { sent, failed } = result;

  // Fallback: no recipients found → send plain text to overrideChatId or global default
  if (sent.length === 0 && failed.length === 0) {
    const text = (req.body && req.body.message) || (alert ? buildGenericText(alert) : null);
    if (!text) return res.status(400).json({ ok: false, error: 'message or alert required' });

    const fallbackChatId = overrideChatId || (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!fallbackChatId) return res.status(400).json({ ok: false, error: 'No recipients found and no chat_id configured' });

    try {
      const tgRes = await sendOne(token, fallbackChatId, text);
      if (tgRes.ok) sent.push({ name: 'Default', branch: null, state: null });
      else failed.push({ name: 'Default', error: tgRes.description });
    } catch (err) {
      failed.push({ name: 'Default', error: err.message });
    }
  }

  const ok = sent.length > 0;
  return res.status(ok ? 200 : 502).json({
    ok, sent: sent.length, failed: failed.length,
    recipients: sent,
    errors: failed.length ? failed : undefined,
  });
};
