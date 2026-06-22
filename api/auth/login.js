const bcrypt         = require('bcryptjs');
const { query }      = require('../_lib/mysql');
const { issueToken } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

let logTableReady = false;
async function ensureLogTable() {
  if (logTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      username   VARCHAR(100) NOT NULL,
      name       VARCHAR(255) DEFAULT '',
      role       VARCHAR(50)  DEFAULT '',
      ip         VARCHAR(64)  DEFAULT '',
      user_agent VARCHAR(512) DEFAULT '',
      status     ENUM('success','failed','blocked') NOT NULL,
      reason     VARCHAR(255) DEFAULT '',
      logged_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_username  (username),
      INDEX idx_logged_at (logged_at),
      INDEX idx_status    (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  logTableReady = true;
}

function writeLog(data) {
  ensureLogTable()
    .then(() => query(
      `INSERT INTO login_logs (username, name, role, ip, user_agent, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.username, data.name || '', data.role || '', data.ip || '', data.ua || '', data.status, data.reason || '']
    ))
    .catch(e => console.error('[login-log]', e.message));
}

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    ''
  );
}

// Map old roles → new roles automatically
const ROLE_MAP = {
  'Admin':        'Admin',
  'Management':   'Admin',
  'Editor':       'State Head',
  'Bureau Chief': 'State Head',
  'HR':           'State Head',
  'Reporter':     'Regional Editor',
  'Legal':        'Legal',
};

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const rows = await query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    const ip = getIP(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 512);

    const u = rows[0];
    if (!u) {
      writeLog({ username, ip, ua, status: 'failed', reason: 'User not found' });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordOk = await bcrypt.compare(password, u.password_hash);
    if (!passwordOk) {
      writeLog({ username, name: u.name, role: u.role, ip, ua, status: 'failed', reason: 'Wrong password' });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Block inactive accounts (is_active = 0); treat missing column (undefined) as active
    if (u.is_active === 0) {
      writeLog({ username, name: u.name, role: u.role, ip, ua, status: 'blocked', reason: 'Account inactive' });
      return res.status(403).json({ error: 'Your account is inactive. Contact the Admin.' });
    }

    const role = ROLE_MAP[u.role] || u.role;
    writeLog({ username, name: u.name, role, ip, ua, status: 'success' });

    const payload = {
      sub:    username,
      role,
      state:  u.state  || null,
      branch: u.branch || null,
    };
    const token = issueToken(payload);
    const user  = {
      name:   u.name,
      role,
      state:  u.state  || null,
      branch: u.branch || null,
      avatar: (u.name?.[0] || 'U').toUpperCase(),
    };
    return res.status(200).json({ token, user });
  } catch (err) {
    console.error('[login] Error:', err.message);
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
};
