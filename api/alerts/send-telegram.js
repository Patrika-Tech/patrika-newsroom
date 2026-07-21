const https      = require('https');
const { query }  = require('../_lib/mysql');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

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

function formatAlert(alert) {
  const sev = alert.severity === 'high' ? '🔴' : alert.severity === 'med' ? '🟡' : '🟢';
  return `${sev} <b>[${alert.type || 'Alert'}]</b>\n${alert.message || alert.text || ''}\n<i>Edition: ${alert.edition || 'All'} | Channel: ${alert.channel || '-'}</i>`;
}

// Look up branch-level REs + Desk Heads and their State Heads for a list of branches
async function getAlertRecipients(branches) {
  if (!branches || branches.length === 0) return [];

  const ph = branches.map(() => '?').join(',');

  const [branchREs, stateHeads] = await Promise.all([
    // Desk Heads and REs of the affected branches
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id
       FROM \`user\`
       WHERE Branch IN (${ph})
         AND Story_Type IN ('Desk Head', 'RE')
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      branches
    ).catch(() => []),

    // State Heads for the states those branches belong to
    query(
      `SELECT EMPNAME, Branch, State, telegram_chat_id
       FROM \`user\`
       WHERE State IN (
         SELECT DISTINCT State FROM \`user\` WHERE Branch IN (${ph}) AND State IS NOT NULL AND State != ''
       )
         AND Story_Type IN ('State Head', 'SH')
         AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))`,
      branches
    ).catch(() => []),
  ]);

  // Merge, dedup by chat_id
  const seen = new Map();
  [...branchREs, ...stateHeads].forEach(u => {
    if (!seen.has(u.telegram_chat_id)) {
      seen.set(u.telegram_chat_id, {
        name:   u.EMPNAME,
        branch: u.Branch,
        state:  u.State,
        chatId: u.telegram_chat_id,
      });
    }
  });
  return [...seen.values()];
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });

  const alert       = req.body?.alert;
  const alertId     = req.body?.alert_id || null;
  const overrideChatId = (req.body?.chat_id || '').toString().trim();

  // Build message text
  const text = req.body?.message || (alert ? formatAlert(alert) : null);
  if (!text) return res.status(400).json({ ok: false, error: 'message or alert required' });

  // ── Determine recipients ────────────────────────────────────────────────────
  let recipients = [];

  const alertBranches = alert?.branches || [];

  if (alertBranches.length > 0 && !overrideChatId) {
    // Smart mode: send to branch REs + State Heads
    recipients = await getAlertRecipients(alertBranches);
  }

  if (recipients.length === 0) {
    // Fallback: single chat_id (override or .env default)
    const fallbackChatId = overrideChatId || (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!fallbackChatId) return res.status(400).json({ ok: false, error: 'No recipients found and no chat_id configured' });
    recipients = [{ chatId: fallbackChatId, name: 'Default', branch: null, state: null }];
  }

  // ── Send to each recipient ──────────────────────────────────────────────────
  const sent   = [];
  const failed = [];

  for (const r of recipients) {
    try {
      const tgRes = await tgPost(token, 'sendMessage', { chat_id: r.chatId, text, parse_mode: 'HTML' });

      // Log to DB (non-fatal)
      query(
        'INSERT INTO telegram_logs (alert_id, message, chat_id, status, telegram_response) VALUES (NULL, ?, ?, ?, ?)',
        [text, r.chatId, tgRes.ok ? 'sent' : 'failed', JSON.stringify(tgRes)]
      ).catch(() => {});

      if (tgRes.ok) {
        sent.push({ name: r.name, branch: r.branch, state: r.state, chatId: r.chatId });
      } else {
        failed.push({ name: r.name, branch: r.branch, error: tgRes.description || 'Telegram error' });
      }
    } catch (err) {
      failed.push({ name: r.name, branch: r.branch, error: err.message });
    }
  }

  const ok = sent.length > 0;
  return res.status(ok ? 200 : 502).json({
    ok,
    sent:    sent.length,
    failed:  failed.length,
    recipients: sent,
    errors:  failed.length > 0 ? failed : undefined,
    // Backwards compat for callers that check message_id
    message_id: sent.length === 1 ? undefined : undefined,
  });
};
