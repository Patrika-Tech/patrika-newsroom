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
 *
 * Ubuntu deps for canvas (OCR):
 *   sudo apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
 *   npm install
 */

// Load .env if present; fall back to .env.local for local dev (no .env at root)
const _p = require('path');
require('dotenv').config({ path: _p.join(__dirname, '.env') });
require('dotenv').config({ path: _p.join(__dirname, '.env.local') });

const express    = require('express');
const path       = require('path');
const app        = express();

// ── Telegram bot (long polling) ────────────────────────────────────────────────
const botPoller  = require('./api/telegram/poller');
botPoller.start();   // starts only if TELEGRAM_BOT_TOKEN is set

// ── Cron: 8 AM daily delay report ────────────────────────────────────────────
const delayReport = require('./api/cron/delay-report');
delayReport.register();

// ── Cron: Monday 9 AM weekly appreciation ────────────────────────────────────
const weeklyAppreciation = require('./api/cron/weekly-appreciation');
weeklyAppreciation.register();

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
app.all('/api/auth/login-logs',       h('./api/auth/login-logs'));
app.all('/api/auth/activity-logs',    h('./api/auth/activity-logs'));
app.all('/api/auth/whoami',           h('./api/auth/whoami'));
app.all('/api/auth/setup',            h('./api/auth/setup'));   // delete after first login

// ── Users (Admin only) ────────────────────────────────────────────────────────
app.all('/api/users/sync',            h('./api/users/sync'));   // must be before /:id
app.all('/api/users/:id',             h('./api/users/[id]'));
app.all('/api/users',                 h('./api/users'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.all('/api/dashboard',             h('./api/dashboard'));

// ── Editorial / Production / Pages / Reports ──────────────────────────────────
app.all('/api/editorial/feeds',       h('./api/editorial/feeds'));   // must be before /api/editorial
app.all('/api/editorial',             h('./api/editorial'));
app.all('/api/production/delay-report',        h('./api/production/delay-report'));
app.all('/api/production/weekly-appreciation', h('./api/production/weekly-appreciation'));
app.all('/api/production/delay-reasons', h('./api/production/delay-reasons'));
app.all('/api/production/page-journey',  h('./api/production/page-journey'));
app.all('/api/production/weekly-trend',  h('./api/production/weekly-trend'));
app.all('/api/production',               h('./api/production'));
app.all('/api/pages',                 h('./api/pages'));
app.all('/api/reports',               h('./api/reports'));

// ── Locations (states & branches from employee table) ─────────────────────────
app.all('/api/locations',             h('./api/locations'));

// ── Legal ─────────────────────────────────────────────────────────────────────
app.all('/api/legal/:id',             h('./api/legal/[id]'));
app.all('/api/legal',                 h('./api/legal'));

// ── Legal Notices ─────────────────────────────────────────────────────────────
app.post('/api/legal-notices/parse',  require('./api/legal-notices/parse'));  // multipart — no h()
app.all('/api/legal-notices/:id',     h('./api/legal-notices/[id]'));
app.all('/api/legal-notices',         h('./api/legal-notices'));
app.use('/uploads/legal-notices', require('express').static(require('path').join(__dirname, 'uploads', 'legal-notices')));

// ── Alerts ────────────────────────────────────────────────────────────────────
app.all('/api/alerts/send-telegram',  h('./api/alerts/send-telegram'));
app.all('/api/alerts/telegram-config',h('./api/alerts/telegram-config'));
app.all('/api/alerts/telegram-test',  h('./api/alerts/telegram-test'));
app.all('/api/alerts',                h('./api/alerts'));

// ── Telegram bot ──────────────────────────────────────────────────────────────
app.all('/api/telegram/bot-info',     h('./api/telegram/bot-info'));

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
app.all('/api/hr/appointments/:id',   h('./api/hr/appointments/[id]'));
app.all('/api/hr/appointments',       h('./api/hr/appointments'));
app.all('/api/hr/test-db',            h('./api/hr/test-db'));

// ── Feedback ──────────────────────────────────────────────────────────────────
app.all('/api/feedback/:id',          h('./api/feedback/[id]'));
app.all('/api/feedback',              h('./api/feedback'));

// ── Archive ───────────────────────────────────────────────────────────────────
app.all('/api/archive/:id/transcribe', h('./api/archive/transcribe'));
app.all('/api/archive/:id',            h('./api/archive/[id]'));
app.post('/api/archive',               require('./api/archive'));   // multipart upload
app.get('/api/archive',                h('./api/archive'));
// Serve uploaded archive files
app.use('/uploads/archive', require('express').static(require('path').join(__dirname, 'uploads', 'archive')));

// ── Field Reporting ───────────────────────────────────────────────────────────
app.all('/api/field/reporter-login',    h('./api/field/reporter-login')); // employee table auth
app.post('/api/field/upload',           require('./api/field/upload'));   // multipart
app.all('/api/field/stories/:id',       h('./api/field/stories'));        // PATCH by id
app.all('/api/field/stories',           h('./api/field/stories'));
app.all('/api/field/visits/:id',        h('./api/field/visits'));   // PATCH checkout
app.all('/api/field/visits',            h('./api/field/visits'));
app.use('/uploads/field', express.static(path.join(__dirname, 'uploads', 'field')));

// ── News Generator ────────────────────────────────────────────────────────────
app.post('/api/news-generator',       require('./api/news-generator'));

// ── Correspondent ─────────────────────────────────────────────────────────────
app.all('/api/correspondent',         h('./api/correspondent'));

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.all('/api/tasks/assignees',       h('./api/tasks/assignees'));   // before /:id
app.all('/api/tasks/:id',             h('./api/tasks/[id]'));
app.all('/api/tasks',                 h('./api/tasks'));

// ── AI ────────────────────────────────────────────────────────────────────────
app.get('/api/ai/insights',           h('./api/ai/insights'));
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

  // Warm the AI insights cache immediately on startup so the first user
  // never waits for a cold DB scan.
  try { require('./api/ai/insights').warmup(); } catch (e) { console.warn('[warmup]', e.message); }
});
