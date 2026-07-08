/**
 * /api/digital/breaking-news
 *
 * GET ?date=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD
 *     ?action=fetch-patrika&category=breaking-news        → live scrape
 *     ?action=article-meta&url=...                        → single article meta
 * POST  → create entry
 * PATCH ?id=N → update entry
 * DELETE ?id=N → delete entry
 *
 * Scrapes patrika.com JSON-LD (no API key needed):
 *   - Category listing: up to 10 latest articles
 *   - Single article:   headline, datePublished, author
 */
const https       = require('https');
const fetch       = require('node-fetch');
const { query }   = require('../_lib/mysql');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const PATRIKA_BASE  = 'https://www.patrika.com';
const SITEMAP_URL   = 'https://www.patrika.com/google-news-sitemap-v1.xml';
const SSL_AGENT     = new https.Agent({ rejectUnauthorized: false });
const FETCH_OPTS    = { agent: SSL_AGENT, timeout: 15000, redirect: 'follow' };

// ── Sitemap helpers ────────────────────────────────────────────────────────────

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractCategoryFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const seg  = path.split('/').filter(Boolean)[0] || '';
    return seg.replace(/-news$/, '').replace(/-/g, ' ');
  } catch { return ''; }
}

async function fetchBySitemap(targetDate) {
  const res = await fetch(SITEMAP_URL, FETCH_OPTS);
  if (!res.ok) throw new Error(`Sitemap returned HTTP ${res.status}`);
  const xml = await res.text();

  const articles = [];
  // Split on closing tag to get individual URL blocks
  const blocks = xml.split('</url>');
  for (const block of blocks) {
    const loc     = block.match(/<loc>\s*(.*?)\s*<\/loc>/)?.[1];
    if (!loc || !loc.includes('patrika.com')) continue;

    const pubDate = block.match(/<news:publication_date>\s*(.*?)\s*<\/news:publication_date>/)?.[1]
                 || block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/)?.[1]
                 || '';

    // Filter by target date (IST date prefix)
    if (targetDate && !pubDate.startsWith(targetDate)) continue;

    const rawTitle = block.match(/<news:title>\s*([\s\S]*?)\s*<\/news:title>/)?.[1] || '';
    const timeMatch = pubDate.match(/T(\d{2}:\d{2})/);

    articles.push({
      url:          decodeXmlEntities(loc.trim()),
      title:        decodeXmlEntities(rawTitle.trim()),
      publish_date: pubDate,
      publish_time: timeMatch ? timeMatch[1] : null,
      category:     extractCategoryFromUrl(loc),
      author:       null,  // sitemap does not include author
    });
  }

  // Sort by publish time ascending
  articles.sort((a, b) => (a.publish_date || '').localeCompare(b.publish_date || ''));
  return articles;
}

// ── Fast author-only scrape (used for batch fetching) ────────────────────────

async function getAuthorOnly(articleUrl) {
  try {
    const res = await fetch(articleUrl, { ...FETCH_OPTS, timeout: 8000 });
    if (!res.ok) return null;
    const html = await res.text();
    // dataLayer is fastest (plain regex)
    const dl = html.match(/editorName:\s*'([^']+)'/);
    if (dl?.[1]) return dl[1];
    // Fall back to JSON-LD
    const re2 = /type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let m2;
    while ((m2 = re2.exec(html)) !== null) {
      try {
        const d = JSON.parse(m2[1]);
        if ((d['@type'] === 'Article' || d['@type'] === 'NewsArticle') && d.author?.name)
          return d.author.name;
      } catch {}
    }
    return null;
  } catch { return null; }
}

// ── Scraping helpers ──────────────────────────────────────────────────────────

function extractLdJson(html) {
  const blocks = [];
  const re = /type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { blocks.push(JSON.parse(m[1])); } catch {}
  }
  return blocks;
}

async function scrapePatrikaCategory(category = 'breaking-news') {
  const url = `${PATRIKA_BASE}/${category}/`;
  const res  = await fetch(url, FETCH_OPTS);
  if (!res.ok) throw new Error(`patrika.com returned HTTP ${res.status}`);
  const html  = await res.text();
  const ld    = extractLdJson(html);
  const list  = ld.find(d => d['@type'] === 'ItemList');
  if (!list) return [];

  return (list.itemListElement || []).map(item => ({
    url:   item.url   || '',
    title: item.name  || '',
  }));
}

async function scrapeArticleMeta(articleUrl) {
  const res = await fetch(articleUrl, FETCH_OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const ld   = extractLdJson(html);
  const art  = ld.find(d => d['@type'] === 'Article' || d['@type'] === 'NewsArticle');
  if (!art) return null;

  // Parse IST date → HH:MM
  const published = art.datePublished || null;
  let publishTime = null;
  if (published) {
    const d = new Date(published);
    // datePublished is already IST (+05:30), new Date keeps UTC internally
    // IST HH:MM = UTC+5:30
    const istMs = d.getTime() + (5.5 * 3600000 - d.getTimezoneOffset() * 60000);
    // Actually parse the offset directly from the string
    // e.g. "2026-07-06T23:21:32+05:30"
    const m = published.match(/T(\d{2}:\d{2})/);
    publishTime = m ? m[1] : null;
  }

  // Extract dataLayer editorName if present
  const dlMatch = html.match(/editorName:\s*'([^']+)'/);
  const dlAuthorId = html.match(/authorID:\s*'(\d+)'/);

  return {
    title:        art.headline || '',
    url:          art.url      || articleUrl,
    author:       art.author?.name || (dlMatch ? dlMatch[1] : null),
    author_url:   art.author?.url  || null,
    author_id:    dlAuthorId ? dlAuthorId[1] : null,
    publish_date: published,
    publish_time: publishTime,
  };
}

// ── Auth helper ───────────────────────────────────────────────────────────────
function canRead(user) {
  if (!user) return false;
  if (['Admin','State Head','Management'].includes(user.role)) return true;
  return user.source === 'digital' &&
    ['digital_admin','team_lead','individual'].includes(user.digital_role);
}
function canWrite(user) {
  if (!user) return false;
  if (['Admin','State Head','Management'].includes(user.role)) return true;
  return user.source === 'digital' &&
    ['digital_admin','team_lead','individual'].includes(user.digital_role);
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = getUser(req);
  if (!user || !canRead(user)) return res.status(403).json({ error: 'Digital team access required' });

  // ── Date-based sitemap fetch (all stories for a date) ───────────────────
  if (req.method === 'GET' && req.query.action === 'fetch-by-date') {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date required' });
    try {
      const articles = await fetchBySitemap(date);
      return res.json({ articles, total: articles.length, source: 'sitemap' });
    } catch (err) {
      return res.status(500).json({ error: 'Sitemap fetch failed: ' + err.message });
    }
  }

  // ── Live scrape from patrika.com ─────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'fetch-patrika') {
    const category = req.query.category || 'breaking-news';
    try {
      const articles = await scrapePatrikaCategory(category);
      // For each article fetch meta (title + author + time)
      const detailed = await Promise.all(
        articles.slice(0, 10).map(a =>
          scrapeArticleMeta(a.url)
            .then(meta => ({ ...a, ...(meta || {}) }))
            .catch(() => a)
        )
      );
      return res.json({ articles: detailed });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch from patrika.com: ' + err.message });
    }
  }

  // ── Single article meta ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'article-meta') {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
      const meta = await scrapeArticleMeta(url);
      if (!meta) return res.status(404).json({ error: 'No article metadata found' });
      return res.json(meta);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Batch author fetch ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'batch-authors') {
    const { urls = [] } = req.body || {};
    const targets = [...new Set(
      urls.filter(u => u && typeof u === 'string' && u.includes('patrika.com'))
    )].slice(0, 500);

    const WORKERS = 20;
    const results = {};
    const queue   = [...targets];

    await Promise.allSettled(Array.from({ length: Math.min(WORKERS, targets.length) }, async () => {
      while (queue.length) {
        const url = queue.shift();
        results[url] = await getAuthorOnly(url);
      }
    }));

    return res.json({ authors: results });
  }

  // ── GET list ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const where  = [];
    const params = [];

    // Individual digital user sees only their own entries
    if (user.source === 'digital' && user.digital_role === 'individual') {
      // Join to digital_user to match by name
      where.push('(bn.digital_user_id = ? OR bn.editor_name = ?)');
      params.push(user.digital_id, user.name);
    } else if (user.source === 'digital' && user.digital_role === 'team_lead') {
      // Team lead sees their team
      const teamMembers = await query(
        'SELECT id, name FROM digital_user WHERE incharge = ? OR id = ?',
        [user.name, user.digital_id]
      ).catch(() => []);
      const names = teamMembers.map(m => m.name);
      const ids   = teamMembers.map(m => m.id);
      if (names.length) {
        where.push(`(bn.digital_user_id IN (${ids.map(() => '?').join(',')}) OR bn.editor_name IN (${names.map(() => '?').join(',')}))`);
        params.push(...ids, ...names);
      }
    }

    if (req.query.date) {
      where.push('bn.entry_date = ?');
      params.push(req.query.date);
    } else if (req.query.from && req.query.to) {
      where.push('bn.entry_date BETWEEN ? AND ?');
      params.push(req.query.from, req.query.to);
    } else {
      // Default: today + past 7 days
      where.push("bn.entry_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    try {
      const rows = await query(`
        SELECT bn.*,
               TIMEDIFF(bn.time_filed, bn.source_time) AS speed_vs_source,
               TIMEDIFF(bn.competitor_time, bn.time_filed) AS speed_vs_competitor
        FROM digital_breaking_news bn
        ${whereClause}
        ORDER BY bn.entry_date DESC, bn.time_filed ASC
      `, params);

      return res.json({ entries: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: create ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    // Individual can only add their own entries
    const body = req.body || {};
    const {
      entry_date, editor_name, digital_user_id, article_title, article_url,
      time_filed, source_name, source_time, competitor_time, value_addition, wp_publish_date,
    } = body;

    if (!entry_date) return res.status(400).json({ error: 'entry_date required' });

    try {
      const result = await query(`
        INSERT INTO digital_breaking_news
          (entry_date, editor_name, digital_user_id, article_title, article_url,
           time_filed, source_name, source_time, competitor_time, value_addition, wp_publish_date)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `, [entry_date, editor_name || null, digital_user_id || null,
          article_title || null, article_url || null,
          time_filed || null, source_name || null, source_time || null,
          competitor_time || null, value_addition || null, wp_publish_date || null]);

      return res.json({ ok: true, id: result.insertId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH: update ─────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!canWrite(user)) return res.status(403).json({ error: 'Insufficient permissions' });

    const body = req.body || {};
    const allowed = ['entry_date','editor_name','digital_user_id','article_title','article_url',
                     'time_filed','source_name','source_time','competitor_time','value_addition','wp_publish_date'];
    const fields = [], vals = [];
    for (const k of allowed) {
      if (body[k] !== undefined) { fields.push(`${k} = ?`); vals.push(body[k] || null); }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(id);
    try {
      await query(`UPDATE digital_breaking_news SET ${fields.join(', ')} WHERE id = ?`, vals);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!canWrite(user)) return res.status(403).json({ error: 'Insufficient permissions' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await query('DELETE FROM digital_breaking_news WHERE id = ?', [id]);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
