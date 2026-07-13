/**
 * GET /api/ai/insights?state=&branch=&refresh=1&part=fast|trends
 *
 * Two-layer cache:
 *   1. In-memory Map  — instant (sub-ms)
 *   2. Disk JSON file — instant after any server restart (no cold DB wait)
 *
 * Stale-while-revalidate: always return from cache, refresh DB in background.
 * Only blocks synchronously on the absolute first-ever request (no cache file).
 */
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const fs   = require('fs');
const path = require('path');

const MEM_CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000;   // 30 min — manual Refresh button always busts this
const CACHE_DIR = path.join(__dirname, '../../cache');

const toIST = ms => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

// ── Disk helpers ─────────────────────────────────────────────────────────────

function diskPath(cacheKey) {
  return path.join(CACHE_DIR, `insights_${cacheKey.replace(/[|]/g, '_')}.json`);
}

function readDisk(cacheKey) {
  try { return JSON.parse(fs.readFileSync(diskPath(cacheKey), 'utf8')); }
  catch { return null; }
}

function writeDisk(cacheKey, entry) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskPath(cacheKey), JSON.stringify(entry), 'utf8');
  } catch (e) { console.error('[ai/insights] disk write:', e.message); }
}

function getCache(cacheKey) {
  // 1. Memory hit
  const mem = MEM_CACHE.get(cacheKey);
  if (mem) return mem;
  // 2. Disk hit — promote to memory
  const disk = readDisk(cacheKey);
  if (disk) { MEM_CACHE.set(cacheKey, disk); return disk; }
  return null;
}

function setCache(cacheKey, data) {
  const entry = { ts: Date.now(), data };
  MEM_CACHE.set(cacheKey, entry);
  writeDisk(cacheKey, entry);
}

// ── DB computation ───────────────────────────────────────────────────────────

async function computeFast(sF, bF) {
  const todayStr = toIST(Date.now());
  const ydayStr  = toIST(Date.now() - 864e5);
  const day3Str  = toIST(Date.now() - 3  * 864e5);
  const day7Str  = toIST(Date.now() - 7  * 864e5);

  const ecmsExtra = [
    sF ? 'AND Pan_no IN (SELECT pan_no FROM `user` WHERE State = ?)'  : '',
    bF ? 'AND Pan_no IN (SELECT pan_no FROM `user` WHERE Branch = ?)' : '',
  ].filter(Boolean).join(' ');
  const ecmsParams = [...(sF ? [sF] : []), ...(bF ? [bF] : [])];
  const qcExtra    = sF ? ' AND state = ?' : '';
  const uF         = [...(sF ? [sF] : []), ...(bF ? [bF] : [])];

  const [ydayStats, gapRows, qcHotRows, topYday, zeroRow] = await Promise.all([

    query(`SELECT SUM(No_Story) AS stories, SUM(No_Photo) AS photos,
                  COUNT(DISTINCT Pan_no) AS reporters, SUM(No_Words) AS words
           FROM daily_achievment_count_ecms
           WHERE entrydate >= ? AND entrydate < ? ${ecmsExtra}`,
          [ydayStr, todayStr, ...ecmsParams]).catch(() => [{}]),

    // Aggregate ecms first (index range), then join small result to user
    query(`SELECT u.Story_Type AS beat,
                  COUNT(DISTINCT u.pan_no) AS reporters,
                  COALESCE(agg.stories3d, 0) AS stories3d,
                  agg.lastStory
           FROM \`user\` u
           LEFT JOIN (
             SELECT Pan_no, SUM(No_Story) AS stories3d, MAX(DATE(entrydate)) AS lastStory
             FROM daily_achievment_count_ecms
             WHERE entrydate >= ? AND entrydate < ?
             GROUP BY Pan_no
           ) agg ON agg.Pan_no = u.pan_no
           WHERE (u.is_emp_working = 1 OR u.Status = 'Working' OR u.Status = 'Active')
             AND u.Story_Type IS NOT NULL AND u.Story_Type != ''
             ${sF ? 'AND u.State = ?'  : ''}
             ${bF ? 'AND u.Branch = ?' : ''}
           GROUP BY u.Story_Type
           ORDER BY stories3d ASC, reporters DESC
           LIMIT 20`,
          [day3Str, todayStr, ...uF]).catch(() => []),

    query(`SELECT state, SUM(no_of_mistake) AS mistakes7d, COUNT(*) AS checks,
                  ROUND(AVG(no_of_mistake), 1) AS avgPerCheck
           FROM qc_review
           WHERE entrydate >= ? AND entrydate < ?${qcExtra}
           GROUP BY state ORDER BY mistakes7d DESC LIMIT 8`,
          [day7Str, todayStr, ...(sF ? [sF] : [])]).catch(() => []),

    query(`SELECT u.EMPNAME, u.Branch, SUM(e.No_Story) AS stories
           FROM daily_achievment_count_ecms e
           JOIN \`user\` u ON e.Pan_no = u.pan_no
           WHERE e.entrydate >= ? AND e.entrydate < ?
             ${sF ? 'AND u.State = ?'  : ''}
             ${bF ? 'AND u.Branch = ?' : ''}
           GROUP BY e.Pan_no, u.EMPNAME, u.Branch
           ORDER BY stories DESC LIMIT 3`,
          [ydayStr, todayStr, ...uF]).catch(() => []),

    // LEFT JOIN is faster than NOT EXISTS for counting non-matches
    query(`SELECT COUNT(DISTINCT u.pan_no) AS cnt
           FROM \`user\` u
           LEFT JOIN (
             SELECT DISTINCT Pan_no FROM daily_achievment_count_ecms
             WHERE entrydate >= ? AND entrydate < ? AND No_Story > 0
           ) act ON act.Pan_no = u.pan_no
           WHERE (u.is_emp_working = 1 OR u.Status = 'Working' OR u.Status = 'Active')
             AND u.Story_Type IS NOT NULL AND u.Story_Type != ''
             ${sF ? 'AND u.State = ?'  : ''}
             ${bF ? 'AND u.Branch = ?' : ''}
             AND act.Pan_no IS NULL`,
          [ydayStr, todayStr, ...uF]).catch(() => [{ cnt: 0 }]),
  ]);

  const contentGaps = gapRows
    .filter(r => r.beat && r.beat.trim())
    .map(r => {
      const n = Number(r.stories3d || 0);
      return {
        beat:      r.beat.trim(),
        reporters: Number(r.reporters || 0),
        stories3d: n,
        lastStory: r.lastStory ? String(r.lastStory).slice(0, 10) : null,
        severity:  n === 0 ? 'critical' : n < 3 ? 'warn' : 'ok',
      };
    });

  const briefingStats = {
    date:          ydayStr,
    stories:       Number(ydayStats[0]?.stories    || 0),
    photos:        Number(ydayStats[0]?.photos     || 0),
    reporters:     Number(ydayStats[0]?.reporters  || 0),
    words:         Number(ydayStats[0]?.words      || 0),
    zeroReporters: Number(zeroRow[0]?.cnt          || 0),
    topReporters:  topYday.map(r => `${r.EMPNAME} (${r.Branch || r.State}, ${r.stories} stories)`),
    criticalGaps:  contentGaps.filter(g => g.severity === 'critical').map(g => g.beat).slice(0, 4),
    qcHotspot:     qcHotRows[0] ? `${qcHotRows[0].state} (${qcHotRows[0].mistakes7d} mistakes)` : null,
  };

  let briefing = null;
  if (process.env.GROQ_API_KEY && briefingStats.stories > 0) {
    try {
      const fetch  = require('node-fetch');
      const prompt = [
        'You are an editorial assistant for Patrika, a Hindi newspaper.',
        'Write a concise morning briefing in 4–5 sentences mixing Hindi and English.',
        `Data from ${briefingStats.date}:`,
        `- Stories filed: ${briefingStats.stories} by ${briefingStats.reporters} reporters`,
        `- Photos: ${briefingStats.photos}, Words: ${Math.round(briefingStats.words / 1000)}K`,
        `- Reporters with 0 stories: ${briefingStats.zeroReporters}`,
        briefingStats.topReporters.length ? `- Top reporters: ${briefingStats.topReporters.join('; ')}` : '',
        briefingStats.criticalGaps.length ? `- Beats with no coverage in 3 days: ${briefingStats.criticalGaps.join(', ')}` : '',
        briefingStats.qcHotspot ? `- QC concern: ${briefingStats.qcHotspot}` : '',
        'Keep it professional, factual, and actionable for editors. Avoid bullet points.',
      ].filter(Boolean).join('\n');

      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], max_tokens: 280, temperature: 0.7 }),
      });
      if (r.ok) {
        const d = await r.json();
        briefing = d.choices?.[0]?.message?.content?.trim() || null;
      } else {
        const err = await r.json().catch(() => ({}));
        console.error('[ai/insights] Groq briefing error:', err.error?.message || r.status);
      }
    } catch (e) { console.error('[ai/insights] briefing:', e.message); }
  }

  return {
    briefing,
    briefingStats,
    contentGaps,
    qcHotspots: qcHotRows.map(r => ({
      state:       r.state || '—',
      mistakes7d:  Number(r.mistakes7d  || 0),
      checks:      Number(r.checks      || 0),
      avgPerCheck: Number(r.avgPerCheck || 0),
    })),
    generatedAt: new Date().toISOString(),
  };
}

async function computeTrends(sF, bF) {
  const todayStr = toIST(Date.now());
  const day7Str  = toIST(Date.now() - 7  * 864e5);
  const day14Str = toIST(Date.now() - 14 * 864e5);
  const uF       = [...(sF ? [sF] : []), ...(bF ? [bF] : [])];

  const trendRows = await query(
    `SELECT e.Pan_no, u.EMPNAME, u.Branch, u.State,
            SUM(CASE WHEN e.entrydate >= ? THEN e.No_Story ELSE 0 END) AS s7d,
            SUM(CASE WHEN e.entrydate  < ? THEN e.No_Story ELSE 0 END) AS s_prev7d,
            COUNT(DISTINCT CASE WHEN e.entrydate >= ? AND e.No_Story > 0
                  THEN DATE(e.entrydate) END) AS active7d
     FROM daily_achievment_count_ecms e
     JOIN \`user\` u ON e.Pan_no = u.pan_no
     WHERE e.entrydate >= ? AND e.entrydate < ?
       ${sF ? 'AND u.State = ?'  : ''}
       ${bF ? 'AND u.Branch = ?' : ''}
     GROUP BY e.Pan_no, u.EMPNAME, u.Branch, u.State
     ORDER BY s7d DESC LIMIT 100`,
    [day7Str, day7Str, day7Str, day14Str, todayStr, ...uF]
  ).catch(() => []);

  return {
    reporterTrends: trendRows.map(r => {
      const s7d   = Number(r.s7d      || 0);
      const sPrev = Number(r.s_prev7d || 0);
      let trend = 'flat';
      if (sPrev > 0) {
        if      (s7d >= sPrev * 1.2) trend = 'up';
        else if (s7d <= sPrev * 0.8) trend = 'down';
      } else if (s7d > 0) trend = 'up';
      return { name: r.EMPNAME || '—', branch: r.Branch || '—', state: r.State || '—',
               stories7d: s7d, prev7d: sPrev, active7d: Number(r.active7d || 0), trend };
    }),
    generatedAt: new Date().toISOString(),
  };
}

// ── Background refresh ───────────────────────────────────────────────────────

function bgRefresh(part, sF, bF, cacheKey) {
  const compute = part === 'trends' ? computeTrends : computeFast;
  compute(sF, bF)
    .then(data => setCache(cacheKey, data))
    .catch(e => console.error('[ai/insights] bgRefresh:', e.message));
}

// ── Warmup export (called from server.js at startup) ─────────────────────────

function warmup() {
  for (const part of ['fast', 'trends']) {
    const key = `${part}||`;
    const hit = getCache(key);
    if (hit) {
      // Disk cache exists — already fast; refresh in background if stale
      if (Date.now() - hit.ts >= CACHE_TTL) bgRefresh(part, '', '', key);
      console.log(`[ai/insights] cache loaded from disk (${part})`);
    } else {
      // No disk cache — compute now so first real user is instant
      bgRefresh(part, '', '', key);
      console.log(`[ai/insights] cache warming from DB (${part})…`);
    }
  }
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  let state  = req.query.state  || '';
  let branch = req.query.branch || '';
  if (user.role === 'State Head'       && user.state)  { state = user.state; }  // branch stays as selected
  if (user.role === 'Regional Editor') {
    if (user.state)  state  = user.state;
    if (user.branch) branch = user.branch;
  }
  const sF       = state  && state  !== 'All' ? state  : '';
  const bF       = branch && branch !== 'All' ? branch : '';
  const refresh  = req.query.refresh === '1';
  const part     = req.query.part === 'trends' ? 'trends' : 'fast';
  const cacheKey = `${part}|${sF}|${bF}`;

  if (!refresh) {
    const hit = getCache(cacheKey);
    if (hit) {
      // Stale? Refresh in background — this request still returns instantly
      if (Date.now() - hit.ts >= CACHE_TTL) {
        setImmediate(() => bgRefresh(part, sF, bF, cacheKey));
      }
      return res.json(hit.data);
    }
  }

  // Nothing cached at all — compute synchronously (first ever request only)
  try {
    const data = await (part === 'trends' ? computeTrends : computeFast)(sF, bF);
    setCache(cacheKey, data);
    return res.json(data);
  } catch (err) {
    console.error('[ai/insights]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

handler.warmup = warmup;
module.exports = handler;
