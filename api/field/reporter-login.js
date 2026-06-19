const mysql2  = require('mysql2/promise');
const { issueToken }             = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

// ── Reporter DB pool (separate from main editorial_reports DB) ────────────────
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const sslOpt = (process.env.REPORTER_DB_SSL || process.env.MYSQL_SSL) === 'true'
    ? { rejectUnauthorized: false }
    : false;
  _pool = mysql2.createPool({
    host:     process.env.REPORTER_DB_HOST     || process.env.MYSQL_HOST     || 'localhost',
    port: Number(process.env.REPORTER_DB_PORT  || process.env.MYSQL_PORT     || 3306),
    user:     process.env.REPORTER_DB_USER     || process.env.MYSQL_USER     || 'root',
    password: process.env.REPORTER_DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.REPORTER_DB_NAME     || process.env.MYSQL_DATABASE || 'editorial_reports',
    ssl:      sslOpt,
    waitForConnections: true,
    connectionLimit: 3,
    timezone: 'Z',
  });
  return _pool;
}

const TABLE   = () => process.env.REPORTER_TABLE       || 'employee';
const USR_COL = () => process.env.REPORTER_USER_COL    || 'USERCODE';
const PWD_COL = () => process.env.REPORTER_PASS_COL    || 'PASSWORD';
const SUFFIX  = () => process.env.REPORTER_USER_SUFFIX || '@jp.com';

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const usercode = username.trim() + SUFFIX();
  const tbl      = TABLE();

  try {
    const db = getPool();
    const [rows] = await db.execute(
      `SELECT * FROM \`${tbl}\` WHERE LOWER(\`${USR_COL()}\`) = LOWER(?) LIMIT 1`,
      [usercode]
    );
    const emp = rows[0];
    if (!emp) return res.status(401).json({ error: 'Invalid username or password' });

    // Block only if explicitly deactivated (UACTIVE = 0); null/1 = allowed
    const uactiveCol = Object.keys(emp).find(k => k.toUpperCase() === 'UACTIVE');
    if (uactiveCol && emp[uactiveCol] === 0)
      return res.status(403).json({ error: 'Account is inactive. Contact admin.' });

    // Plain-text password comparison (employee table uses plain text, max 20 chars)
    const storedCol  = Object.keys(emp).find(k => k.toUpperCase() === PWD_COL().toUpperCase());
    const storedPass = storedCol ? (emp[storedCol] || '') : '';
    if (storedPass !== password)
      return res.status(401).json({ error: 'Invalid username or password' });

    // Build display name — prefer DISPLAYNAME, fall back to FIRSTNAME + LASTNAME
    const nameCol = Object.keys(emp).find(k => k.toUpperCase() === 'DISPLAYNAME');
    const fname   = Object.keys(emp).find(k => k.toUpperCase() === 'FIRSTNAME');
    const lname   = Object.keys(emp).find(k => k.toUpperCase() === 'LASTNAME');
    const name    = (nameCol && emp[nameCol])
      ? emp[nameCol]
      : [fname && emp[fname], lname && emp[lname]].filter(Boolean).join(' ') || username.trim();

    const payload = { sub: username.trim(), role: 'Regional Editor', state: null, branch: null };
    const token   = issueToken(payload, 86400 * 7); // 7-day token

    return res.json({
      token,
      user: { name, role: 'Regional Editor', state: null, branch: null, avatar: (name[0] || 'R').toUpperCase() },
    });
  } catch (err) {
    console.error('[reporter-login]', err.message);
    if (err.code === 'ER_NO_SUCH_TABLE')
      return res.status(500).json({ error: `Table '${tbl}' not found. Check REPORTER_DB_NAME in .env` });
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
};
