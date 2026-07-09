/**
 * GET /api/digital/chartbeat?period=today|week|month
 * Fetches ALL Chartbeat recurring queries, aggregates articles by author.
 * Returns: { articles: [{author, title, page_uniques}], fetched_at, period }
 */
const https = require('https');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const API_KEY = 'ab404291a5510d9fc3666b0871c8fc39';
const HOST    = 'patrika.com';
const CB_BASE = `https://api.chartbeat.com/query/v2/recurring`;

const CACHE_MS  = 5 * 60 * 1000;
const _cache    = {};
const _cacheAt  = {};

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      const chunks = [];
      r.on('data', d => chunks.push(d));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

function parseCsv(text) {
  const rows = [];
  const lines = text.trim().split('\n');
  if (lines.length < 2) return rows;
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = []; let field = '', inQ = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (inQ) {
        if (c === '"') { if (line[j+1]==='"') { field+='"'; j++; } else inQ=false; }
        else field += c;
      } else if (c === '"') { inQ = true; }
      else if (c === ',') { cells.push(field.trim()); field = ''; }
      else field += c;
    }
    cells.push(field.trim());
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function dateRange(period) {
  const now = new Date();
  const end = isoDate(now);
  if (period === 'week')  { const s = new Date(now); s.setDate(s.getDate()-6);  return { start: isoDate(s), end }; }
  if (period === 'month') { const s = new Date(now); s.setDate(s.getDate()-29); return { start: isoDate(s), end }; }
  return { start: end, end };
}

async function fetchAll(period) {
  const { start, end } = dateRange(period);

  // 1. Get all recurring query IDs for this account
  const listRes = await get(`${CB_BASE}/list/?apikey=${API_KEY}&host=${HOST}`);
  let queryIds = [];
  try {
    const listJson = JSON.parse(listRes.body);
    queryIds = (listJson.queries || []).map(q => q.query_id).filter(Boolean);
  } catch (e) {
    // Fallback to the known query_id
    queryIds = ['a0dc4f20-4467-4a5e-a29e-c3bd77beb360'];
  }

  // 2. Fetch each query and aggregate articles by author
  const authorMap = {};  // authorKey → { author, page_uniques, title (top) }

  await Promise.all(queryIds.map(async (qid) => {
    try {
      const url = `${CB_BASE}/fetch/?apikey=${API_KEY}&host=${HOST}&query_id=${qid}&start=${start}&end=${end}`;
      const { body } = await get(url);

      let rows = [];
      if (body.trim().startsWith('{')) {
        const j = JSON.parse(body);
        rows = j.articles || [];
      } else {
        rows = parseCsv(body);
      }

      rows.forEach(r => {
        const author = (r.author || '').trim();
        if (!author || author.toLowerCase() === 'undefined') return;
        const key   = author.toLowerCase();
        const uv    = parseInt(r.page_uniques || 0, 10) || 0;
        const title = (r.title || '').trim();
        if (!authorMap[key]) {
          authorMap[key] = { author, page_uniques: 0, title: '', stories: 0 };
        }
        authorMap[key].page_uniques += uv;
        authorMap[key].stories++;
        if (uv > (authorMap[key]._topUV || 0)) {
          authorMap[key]._topUV = uv;
          authorMap[key].title  = title;
        }
      });
    } catch (_) { /* skip failed queries */ }
  }));

  // Return as flat articles array (one entry per author with aggregated UV)
  return Object.values(authorMap).map(a => ({
    author:       a.author,
    title:        a.title,
    page_uniques: a.page_uniques,
    stories:      a.stories,
  }));
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const period = ['today', 'week', 'month'].includes(req.query.period)
    ? req.query.period : 'today';

  const now = Date.now();
  if (_cache[period] && (now - (_cacheAt[period] || 0)) < CACHE_MS) {
    return res.json({ ..._cache[period], period, cached: true, age_s: Math.round((now - _cacheAt[period]) / 1000) });
  }

  try {
    const articles = await fetchAll(period);
    _cache[period]   = { articles, fetched_at: new Date().toISOString() };
    _cacheAt[period] = now;
    return res.json({ ..._cache[period], period, cached: false, age_s: 0 });
  } catch (err) {
    if (_cache[period]) {
      return res.json({ ..._cache[period], period, cached: true, stale: true, age_s: Math.round((now - (_cacheAt[period]||0)) / 1000) });
    }
    return res.status(502).json({ error: 'Chartbeat unavailable: ' + err.message });
  }
};
