/**
 * Patrika Newsroom — Self-hosted Express server
 *
 * Serves:
 *   - All /api/* routes  (Node.js handlers)
 *   - React SPA          (frontend/dist — run `npm run build:frontend` first)
 *
 * Start:
 *   node server.js
 *   or with PM2:
 *   pm2 start server.js --name patrika-newsroom
 *
 * Env vars: copy .env.example → .env and fill in values.
 */

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const app        = express();
const delayReport = require('./api/cron/delay-report');
delayReport.register();   // schedule 8 AM IST daily Telegram delay report

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Wrap a Vercel-style handler so Express path params (:id, etc.)
 * appear in req.query — which is how the handlers read them.
 */
function h(handlerPath) {
  const handler = require(handlerPath);
  return (req, res) => {
    req.query = { ...req.query, ...req.params };
    return handler(req, res);
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.all('/api/auth/login',            h('./api/auth/login'));
app.all('/api/auth/whoami',           h('./api/auth/whoami'));
app.all('/api/auth/setup',            h('./api/auth/setup'));   // delete after first login

// ── Users (Admin only) ────────────────────────────────────────────────────────
app.all('/api/users/:id',             h('./api/users/[id]'));
app.all('/api/users',                 h('./api/users'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.all('/api/dashboard',             h('./api/dashboard'));

// ── Editorial / Production / Pages / Reports ──────────────────────────────────
app.all('/api/editorial/feeds',       h('./api/editorial/feeds'));   // must be before /api/editorial
app.all('/api/editorial',             h('./api/editorial'));
app.all('/api/production/delay-report', h('./api/production/delay-report'));
app.all('/api/production/page-journey', h('./api/production/page-journey'));
app.all('/api/production',              h('./api/production'));
app.all('/api/pages',                 h('./api/pages'));
app.all('/api/reports',               h('./api/reports'));

// ── Locations (states & branches from employee table) ─────────────────────────
app.all('/api/locations',             h('./api/locations'));

// ── Legal ─────────────────────────────────────────────────────────────────────
app.all('/api/legal/:id',             h('./api/legal/[id]'));
app.all('/api/legal',                 h('./api/legal'));

// ── Alerts ────────────────────────────────────────────────────────────────────
app.all('/api/alerts/send-telegram',  h('./api/alerts/send-telegram'));
app.all('/api/alerts/telegram-config',h('./api/alerts/telegram-config'));
app.all('/api/alerts/telegram-test',  h('./api/alerts/telegram-test'));
app.all('/api/alerts',                h('./api/alerts'));

// ── HR ────────────────────────────────────────────────────────────────────────
app.post('/api/hr/parse-cv',          require('./api/hr/parse-cv'));   // multipart — no h() wrapper
app.all('/api/hr/employees',          h('./api/hr/employees'));
app.all('/api/hr/retirements',        h('./api/hr/retirements'));
app.all('/api/hr/candidates/:id',     h('./api/hr/candidates/[id]'));
app.all('/api/hr/candidates',         h('./api/hr/candidates'));
app.all('/api/hr/training',           h('./api/hr/training'));
app.all('/api/hr/grading',            h('./api/hr/grading'));
app.all('/api/hr/sanctioned-posts',   h('./api/hr/sanctioned-posts'));
app.all('/api/hr/admin-stats',        h('./api/hr/admin-stats'));
app.all('/api/hr/test-db',            h('./api/hr/test-db'));

// ── AI ────────────────────────────────────────────────────────────────────────
app.all('/api/ai/assistant',          h('./api/ai/assistant'));

// ── Serve React SPA ───────────────────────────────────────────────────────────
const DIST = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Patrika Newsroom running at http://localhost:${PORT}`);
  console.log(`   MySQL: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306} / ${process.env.MYSQL_DATABASE}`);
});
