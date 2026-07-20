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

// ── Cron: Daily 9 AM IST due-date alerts (3 days before) ─────────────────────
const dueDateAlerts = require('./api/cron/due-date-alerts');
dueDateAlerts.register();

// ── Cron: 3rd of every month 10 AM IST — correspondent zero-payment alert ─────
const correspondentPaymentAlert = require('./api/cron/correspondent-payment-alert');
correspondentPaymentAlert.register();

// ── Cron: 11 AM IST daily — home/office visit alert to branch REs ─────────────
const homeOfficeVisitAlert = require('./api/cron/home-office-visit-alert');
homeOfficeVisitAlert.register();

// ── Cron: 8 AM IST Mon–Sat — top-10 delay edition report + RE branch alerts ───
const topDelayReport = require('./api/cron/top-delay-report');
topDelayReport.register();

// ── Cron: 9 AM IST daily — delay+reason compiled report to CHFPK8050E ─────────
const delayReasonReport = require('./api/cron/delay-reason-report');
delayReasonReport.register();

// ── Cron: Chartbeat daily snapshot — 11:55 PM IST (18:25 UTC) ────────────────
(function registerChartbeatCron() {
  const cron = require('node-cron');
  const https = require('https');
  const { query } = require('./api/_lib/mysql');
  const API_KEY = 'ab404291a5510d9fc3666b0871c8fc39';
  const HOST    = 'patrika.com';
  const CB_BASE = 'https://api.chartbeat.com/query/v2/recurring';

  function get(url) {
    return new Promise((resolve, reject) => {
      https.get(url, r => {
        const c = []; r.on('data', d => c.push(d));
        r.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
      }).on('error', reject);
    });
  }
  function parseCsv(text) {
    const rows = []; const lines = text.trim().split('\n');
    if (lines.length < 2) return rows;
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim(); if (!line) continue;
      const cells = []; let field = '', inQ = false;
      for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (inQ) { if (c==='"') { if (line[j+1]==='"') { field+='"'; j++; } else inQ=false; } else field+=c; }
        else if (c==='"') inQ=true; else if (c===',') { cells.push(field.trim()); field=''; } else field+=c;
      }
      cells.push(field.trim());
      const obj = {}; headers.forEach((h,idx) => { obj[h]=cells[idx]||''; }); rows.push(obj);
    }
    return rows;
  }
  function todayIST() {
    const ist = new Date(Date.now() + 5.5*60*60*1000);
    return ist.toISOString().slice(0, 10);
  }

  async function snapshotToday() {
    try {
      const listBody = await get(`${CB_BASE}/list/?apikey=${API_KEY}&host=${HOST}`);
      let queryIds = [];
      try { queryIds = JSON.parse(listBody).queries.map(q=>q.query_id).filter(Boolean); } catch(_) { queryIds=['a0dc4f20-4467-4a5e-a29e-c3bd77beb360']; }
      const authorMap = {};
      await Promise.all(queryIds.map(async qid => {
        try {
          const body = await get(`${CB_BASE}/fetch/?apikey=${API_KEY}&host=${HOST}&query_id=${qid}`);
          const rows = body.trim().startsWith('{') ? (JSON.parse(body).articles||[]) : parseCsv(body);
          rows.forEach(r => {
            const author = (r.author||'').trim();
            if (!author || author.toLowerCase()==='undefined') return;
            const key=author.toLowerCase(), uv=parseInt(r.page_uniques||0,10)||0, title=(r.title||'').trim();
            if (!authorMap[key]) authorMap[key]={author,page_uniques:0,title:'',stories:0,_topUV:0};
            authorMap[key].page_uniques+=uv; authorMap[key].stories++;
            if (uv>authorMap[key]._topUV) { authorMap[key]._topUV=uv; authorMap[key].title=title; }
          });
        } catch(_) {}
      }));
      const articles = Object.values(authorMap);
      if (!articles.length) return;
      const date = todayIST();
      await query('DELETE FROM chartbeat_author_daily WHERE stat_date=?', [date]);
      const ph = articles.map(()=>'(?,?,?,?,?)').join(',');
      const vals = articles.flatMap(a=>[date,a.author,a.stories,a.page_uniques,a.title||null]);
      await query(`INSERT INTO chartbeat_author_daily (stat_date,author,stories,page_uniques,top_title) VALUES ${ph}`, vals);
      console.log(`[chartbeat-cron] Saved ${articles.length} authors for ${date}`);
    } catch(e) { console.error('[chartbeat-cron] snapshot failed:', e.message); }
  }

  // Run at 23:55 IST = 18:25 UTC every day
  cron.schedule('25 18 * * *', snapshotToday, { timezone: 'UTC' });
  // Also snapshot at server startup to seed today's data immediately
  snapshotToday();
  console.log('[chartbeat-cron] Registered — daily 11:55 PM IST');
})();

// ── Weekly Review reminder — Saturday 10:00 AM IST (04:30 UTC) ────────────────
(() => {
  const cron            = require('node-cron');
  const { sendMessage } = require('./api/_lib/telegram');
  cron.schedule('30 4 * * 6', async () => {
    try {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!chatId) return;
      await sendMessage(chatId,
        '📋 <b>Weekly Plan & Review Due</b>\n\n' +
        'It\'s Saturday — weekly newsroom review time:\n' +
        '1️⃣ REs: submit your branch action plan for next week\n' +
        '2️⃣ State Heads: review &amp; grade submitted plans\n' +
        '3️⃣ Check employee performance — stories, visits, QC\n' +
        '4️⃣ Follow up on last week\'s pending action items\n\n' +
        '👉 Open <b>Task Management → Weekly Review</b> in the portal.');
      console.log('[weekly-review] Saturday reminder sent');
    } catch (e) { console.error('[weekly-review] reminder failed:', e.message); }
  }, { timezone: 'UTC' });
  console.log('[weekly-review] Cron registered — Saturday 10:00 AM IST');
})();

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

// ── Digital Team ─────────────────────────────────────────────────────────────
app.all('/api/digital/login',         h('./api/digital/login'));
app.all('/api/digital/users',         require('./api/digital/users'));   // multer — no h()
app.all('/api/digital/dashboard',     h('./api/digital/dashboard'));
app.all('/api/digital/targets',       require('./api/digital/targets')); // multer — no h()
app.all('/api/digital/breaking-news', h('./api/digital/breaking-news'));
app.get('/api/digital/chartbeat',     h('./api/digital/chartbeat'));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.all('/api/auth/login',            h('./api/auth/login'));
app.all('/api/auth/login-logs',       h('./api/auth/login-logs'));
app.all('/api/auth/activity-logs',    h('./api/auth/activity-logs'));
app.all('/api/auth/whoami',           h('./api/auth/whoami'));
app.all('/api/auth/sso-verify',       h('./api/auth/sso-verify'));
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
app.all('/api/production/top-delay-alert',      h('./api/cron/top-delay-report-api'));
app.all('/api/production/delay-reason-report', h('./api/cron/delay-reason-report-api'));
app.all('/api/production/delay-report',        h('./api/production/delay-report'));
app.all('/api/production/weekly-appreciation', h('./api/production/weekly-appreciation'));
app.all('/api/production/delay-reasons', h('./api/production/delay-reasons'));
app.all('/api/production/page-journey',  h('./api/production/page-journey'));
app.all('/api/production/weekly-trend',  h('./api/production/weekly-trend'));
app.all('/api/production',               h('./api/production'));
app.all('/api/pages/home-office-alert', h('./api/cron/home-office-visit-alert-api'));
app.all('/api/pages',                   h('./api/pages'));
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
app.all('/api/alerts/live',           h('./api/alerts/live'));
app.all('/api/alerts/send-telegram',  h('./api/alerts/send-telegram'));
app.all('/api/alerts/telegram-config',h('./api/alerts/telegram-config'));
app.all('/api/alerts/telegram-test',  h('./api/alerts/telegram-test'));
app.all('/api/alerts/send-email',     h('./api/alerts/send-email'));
app.all('/api/alerts/email-config',   h('./api/alerts/email-config'));
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
app.all('/api/hr/grading-auto',       h('./api/hr/grading-auto'));
app.all('/api/hr/grading-top',        h('./api/hr/grading-top'));
app.all('/api/hr/grading',            h('./api/hr/grading'));
app.get('/api/hr/sanctioned-posts/template', h('./api/hr/sanctioned-posts-template'));  // xlsx download
app.post('/api/hr/sanctioned-posts/bulk',    require('./api/hr/sanctioned-posts-bulk')); // multer upload
app.all('/api/hr/sanctioned-posts',   h('./api/hr/sanctioned-posts'));
app.all('/api/hr/admin-stats',        h('./api/hr/admin-stats'));
app.all('/api/hr/leaves',             h('./api/hr/leaves'));
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

// ── Archive Docs (Circular / Stylesheet) ──────────────────────────────────────
app.get('/api/archive-docs/view/:filename', require('./api/archive-docs').viewFile);  // inline preview
app.all('/api/archive-docs',               require('./api/archive-docs'));              // multipart + GET + DELETE
app.use('/uploads/archive-docs', require('express').static(require('path').join(__dirname, 'uploads', 'archive-docs')));

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
app.all('/api/correspondent/payment-alert', h('./api/cron/correspondent-payment-alert-api'));
app.all('/api/correspondent',              h('./api/correspondent'));

// ── Task Bank ─────────────────────────────────────────────────────────────────
app.all('/api/task-bank/:id',         h('./api/task-bank/[id]'));
app.all('/api/task-bank',             h('./api/task-bank'));

// ── Task Groups ───────────────────────────────────────────────────────────────
app.all('/api/task-groups/:id',       h('./api/task-groups/[id]'));
app.all('/api/task-groups',           h('./api/task-groups'));

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.all('/api/tasks/assignees',       h('./api/tasks/assignees'));   // before /:id
app.all('/api/tasks/comments',        h('./api/tasks/comments'));
app.all('/api/tasks/report',          h('./api/tasks/report'));
app.all('/api/tasks/weekly-review',   h('./api/tasks/weekly-review'));
app.all('/api/tasks/events',          h('./api/tasks/events'));
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
// Add overall_pct column (SMALLINT) to store the true combined % from the frontend
const { ensureColumn } = require('./api/_lib/schema');
ensureColumn('hr_grading', 'overall_pct', 'SMALLINT DEFAULT NULL').catch(() => {});

app.listen(PORT, () => {
  console.log(`✅ Patrika Newsroom running at http://localhost:${PORT}`);
  console.log(`   MySQL: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306} / ${process.env.MYSQL_DATABASE}`);

  // Warm the AI insights cache immediately on startup so the first user
  // never waits for a cold DB scan.
  try { require('./api/ai/insights').warmup(); } catch (e) { console.warn('[warmup]', e.message); }
});
