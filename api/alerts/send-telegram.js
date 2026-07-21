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

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const token  = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = (req.body?.chat_id || process.env.TELEGRAM_CHAT_ID || '').toString().trim();

  if (!token)  return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });
  if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });

  const text = req.body?.message || (req.body?.alert ? formatAlert(req.body.alert) : null);
  if (!text) return res.status(400).json({ ok: false, error: 'message or alert required' });

  try {
    const tgRes = await tgPost(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });

    // Log to DB (best-effort, non-fatal)
    try {
      await query(
        'INSERT INTO telegram_logs (alert_id, message, chat_id, status, telegram_response) VALUES (?, ?, ?, ?, ?)',
        [req.body?.alert_id || null, text, chatId, tgRes.ok ? 'sent' : 'failed', JSON.stringify(tgRes)]
      );
    } catch { /* log failure is non-fatal */ }

    if (!tgRes.ok) return res.status(502).json({ ok: false, error: tgRes.description || 'Telegram error' });
    return res.status(200).json({ ok: true, message_id: tgRes.result?.message_id || null });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
};
