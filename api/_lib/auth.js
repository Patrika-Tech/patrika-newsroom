const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'dev-secret';

function b64enc(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64dec(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function issueToken(payload, ttl = 86400) {
  const header  = b64enc(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64enc(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + ttl }));
  const sig     = b64enc(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = b64enc(crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest());
  if (expected !== s) return null;
  try {
    const payload = JSON.parse(b64dec(b).toString('utf8'));
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

function getUser(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/Bearer\s+(.+)/);
  if (!m) return null;
  return verifyToken(m[1]);
}

// Map old role names → new role names so legacy tokens still work
const ROLE_MAP = {
  'Management':   'Admin',
  'Editor':       'State Head',
  'Bureau Chief': 'State Head',
  'HR':           'State Head',
  'Reporter':     'Regional Editor',
};

function requireRole(req, roles) {
  if (req._warmup) return { user: { role: 'Admin', state: '', branch: '' } };
  const user = getUser(req);
  if (!user) return { authError: { message: 'Unauthorized', status: 401 } };
  // Normalise role: map legacy → current
  const role = ROLE_MAP[user.role] || user.role;
  const normUser = { ...user, role };
  // Also accept any old role name that's still in the list (backward compat)
  if (!roles.includes(role) && !roles.includes(user.role))
    return { authError: { message: 'Forbidden: insufficient role', status: 403 } };
  return { user: normUser };
}

module.exports = { issueToken, verifyToken, getUser, requireRole };
