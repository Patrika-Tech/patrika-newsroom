/**
 * Telegram Bot — Long Polling Service
 *
 * Runs as a background loop alongside the Express server.
 * No HTTPS / webhook needed — works on any server with a public IP.
 *
 * Employee flow:
 *   1. Employee finds the bot (admin shares t.me/BOTNAME)
 *   2. Sends /start
 *   3. Bot asks for PAN number
 *   4. Employee sends PAN  →  bot finds them in the DB  →  saves chat_id
 *   5. Employee is now registered — will receive 8 AM delay reports
 *
 * Commands:
 *   /start   — begin registration
 *   /status  — check current registration
 *   /stop    — unregister (removes chat_id)
 *   /help    — show help
 */

const https = require('https');
const { query } = require('../_lib/mysql');

// ── Telegram helpers ──────────────────────────────────────────────────────────
function tgRequest(token, method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path:     `/bot${token}/${method}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (r) => {
        let d = '';
        r.on('data', c => (d += c));
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON')); } });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function tgGet(token, method, params = {}) {
  return new Promise((resolve, reject) => {
    const qs   = new URLSearchParams(params).toString();
    const path = `/bot${token}/${method}${qs ? '?' + qs : ''}`;
    https.get(`https://api.telegram.org${path}`, (r) => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON')); } });
    }).on('error', reject);
  });
}

function sendMsg(token, chatId, text) {
  return tgRequest(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

// ── Per-chat state (in-memory) ────────────────────────────────────────────────
// Tracks which users are mid-registration and waiting to send their PAN
const awaitingPan = new Set();

// ── Message processor ─────────────────────────────────────────────────────────
async function processMessage(token, msg) {
  const chatId   = msg.chat.id;
  const text     = (msg.text || '').trim();
  const fullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ');

  // ── /start ──────────────────────────────────────────────────────────────────
  if (text === '/start' || text.startsWith('/start ')) {
    awaitingPan.add(chatId);
    await sendMsg(token, chatId,
      `👋 <b>Welcome to Patrika Newsroom Bot!</b>\n\n` +
      `This bot sends you daily <b>page delay reports at 8:00 AM</b>.\n\n` +
      `📋 To register, send your <b>PAN Number</b> (Employee Code).\n\n` +
      `Example:\n<code>RPJXX12345</code>`
    );
    return;
  }

  // ── /help ───────────────────────────────────────────────────────────────────
  if (text === '/help') {
    await sendMsg(token, chatId,
      `📋 <b>Patrika Newsroom Bot — Help</b>\n\n` +
      `/start — Register for delay reports\n` +
      `/status — Check your registration\n` +
      `/stop — Unregister from reports\n\n` +
      `For help contact your admin.`
    );
    return;
  }

  // ── /status ─────────────────────────────────────────────────────────────────
  if (text === '/status') {
    const rows = await query(
      `SELECT EMPNAME, Branch, State, Story_Type
       FROM \`user\` WHERE telegram_chat_id = ? LIMIT 1`,
      [String(chatId)]
    ).catch(() => []);

    if (rows.length) {
      const u = rows[0];
      await sendMsg(token, chatId,
        `✅ <b>You are registered!</b>\n\n` +
        `👤 <b>${u.EMPNAME}</b>\n` +
        `📍 ${u.Branch} · ${u.State}\n` +
        `🏷️ ${u.Story_Type}\n\n` +
        `You receive delay reports at <b>8:00 AM</b> daily.\n` +
        `Send /stop to unregister.`
      );
    } else {
      awaitingPan.add(chatId);
      await sendMsg(token, chatId,
        `❌ <b>Not registered yet.</b>\n\nSend your <b>PAN Number</b> to register.`
      );
    }
    return;
  }

  // ── /stop ───────────────────────────────────────────────────────────────────
  if (text === '/stop') {
    const result = await query(
      `UPDATE \`user\` SET telegram_chat_id = NULL WHERE telegram_chat_id = ?`,
      [String(chatId)]
    ).catch(() => ({ affectedRows: 0 }));

    awaitingPan.delete(chatId);

    if (result.affectedRows > 0) {
      await sendMsg(token, chatId,
        `✅ <b>Unregistered.</b> You will no longer receive delay reports.\n\nSend /start to register again.`
      );
    } else {
      await sendMsg(token, chatId,
        `You were not registered.\nSend /start to register.`
      );
    }
    return;
  }

  // ── PAN number input ─────────────────────────────────────────────────────────
  // Accept if: user is awaiting PAN, OR text looks like a PAN (alphanumeric, 5–25 chars)
  const looksPan = /^[A-Z0-9]{5,25}$/i.test(text);
  if (awaitingPan.has(chatId) || looksPan) {
    const pan = text.toUpperCase().trim();

    const rows = await query(
      `SELECT pan_no, EMPNAME, Branch, State, Story_Type
       FROM \`user\`
       WHERE UPPER(pan_no) = ?
         AND (is_emp_working = 1 OR Status IN ('Working','Active'))
       LIMIT 1`,
      [pan]
    ).catch(() => []);

    if (!rows.length) {
      // Try matching by EMP_CODE too
      const rows2 = await query(
        `SELECT pan_no, EMPNAME, Branch, State, Story_Type
         FROM \`user\`
         WHERE UPPER(EMP_CODE) = ?
           AND (is_emp_working = 1 OR Status IN ('Working','Active'))
         LIMIT 1`,
        [pan]
      ).catch(() => []);

      if (!rows2.length) {
        await sendMsg(token, chatId,
          `❌ <b>PAN / Employee Code not found:</b> <code>${pan}</code>\n\n` +
          `Please check and try again, or contact your admin.`
        );
        awaitingPan.add(chatId); // keep waiting
        return;
      }
      rows.push(rows2[0]);
    }

    const emp = rows[0];

    // Save chat_id to DB
    await query(
      `UPDATE \`user\` SET telegram_chat_id = ? WHERE pan_no = ?`,
      [String(chatId), emp.pan_no]
    );

    awaitingPan.delete(chatId);
    await sendMsg(token, chatId,
      `✅ <b>Registration Successful!</b>\n\n` +
      `👤 <b>${emp.EMPNAME}</b>\n` +
      `📍 ${emp.Branch} · ${emp.State}\n` +
      `🏷️ ${emp.Story_Type}\n\n` +
      `⏰ You will receive <b>page delay reports at 8:00 AM</b> every day.\n\n` +
      `Send /stop to unregister anytime.`
    );
    console.log(`[bot] ✅ Registered: ${emp.EMPNAME} (${emp.Branch}) → chat_id ${chatId}`);
    return;
  }

  // ── Default ──────────────────────────────────────────────────────────────────
  awaitingPan.add(chatId);
  await sendMsg(token, chatId,
    `Send your <b>PAN Number</b> to register.\nExample: <code>RPJXX12345</code>\n\nOr send /help for more options.`
  );
}

// ── Long polling loop ─────────────────────────────────────────────────────────
let lastUpdateId = 0;
let running      = false;

async function pollLoop(token) {
  running = true;
  console.log('[bot] ✅ Long polling started — waiting for messages…');

  while (running) {
    try {
      const res = await tgGet(token, 'getUpdates', {
        offset:           lastUpdateId + 1,
        timeout:          25,                          // long-poll timeout (seconds)
        allowed_updates:  JSON.stringify(['message']),
      });

      if (!res.ok) {
        console.warn('[bot] getUpdates not OK:', res.description);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      for (const update of (res.result || [])) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        if (update.message) {
          processMessage(token, update.message).catch(err =>
            console.error('[bot] processMessage error:', err.message)
          );
        }
      }
    } catch (err) {
      console.error('[bot] Poll error:', err.message);
      await new Promise(r => setTimeout(r, 5000));  // wait before retry
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
let botInfo = null;

async function getBotInfo(token) {
  try {
    const res = await tgGet(token, 'getMe');
    return res.ok ? res.result : null;
  } catch {
    return null;
  }
}

function start() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[bot] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }

  // First call getMe to confirm bot is valid and get username
  getBotInfo(token)
    .then(info => {
      if (!info) {
        console.error('[bot] ❌ Failed to connect — check TELEGRAM_BOT_TOKEN');
        return;
      }
      botInfo = info;
      process.env.TELEGRAM_BOT_USERNAME = info.username;
      console.log(`[bot] ✅ Connected: @${info.username} — "${info.first_name}"`);
      pollLoop(token);
    })
    .catch(err => console.error('[bot] Startup error:', err.message));
}

function stop() {
  running = false;
}

function getInfo() {
  return botInfo;
}

module.exports = { start, stop, getInfo };
