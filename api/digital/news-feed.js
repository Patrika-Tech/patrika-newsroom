/**
 * /api/digital/news-feed
 * GET ?date=YYYY-MM-DD
 * Fetches today's articles from Patrika + major Hindi news sitemaps in parallel.
 * Results are cached for 5 minutes to avoid hammering external sites.
 */
const https    = require('https');
const fetch    = require('node-fetch');
const { getUser }              = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const SSL_AGENT  = new https.Agent({ rejectUnauthorized: false });
const FETCH_OPTS = {
  agent: SSL_AGENT,
  timeout: 12000,
  redirect: 'follow',
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Accept':     'application/xml, text/xml, */*',
  },
};

const SOURCES = [
  {
    key:    'patrika',
    name:   'Patrika',
    color:  '#e53935',
    sitemap:'https://www.patrika.com/google-news-sitemap-v1.xml',
  },
  {
    key:    'bhaskar',
    name:   'Dainik Bhaskar',
    color:  '#f57c00',
    sitemap:'https://www.bhaskar.com/google-news-sitemap-v1.xml',
  },
  {
    key:    'jagran',
    name:   'Dainik Jagran',
    color:  '#1565c0',
    sitemap:'https://www.jagran.com/sitemap/sitemap-news.xml',
  },
  {
    key:    'amarujala',
    name:   'Amar Ujala',
    color:  '#6a1b9a',
    sitemap:'https://www.amarujala.com/sitemap/googlenews.xml',
  },
  {
    key:    'nbt',
    name:   'Nav Bharat Times',
    color:  '#00838f',
    sitemap:'https://navbharattimes.indiatimes.com/GoogleNewsSitemap.xml',
  },
  {
    key:    'ndtvindia',
    name:   'NDTV India',
    color:  '#c62828',
    sitemap:'https://www.ndtv.com/google-news-sitemap.xml',
  },
];

function decodeXmlEntities(str) {
  if (!str) return '';
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
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
    return seg.replace(/-news$/, '').replace(/-/g, ' ') || 'general';
  } catch { return 'general'; }
}

async function fetchSourceSitemap(source, targetDate) {
  try {
    const res = await fetch(source.sitemap, FETCH_OPTS);
    if (!res.ok) return [];
    const xml    = await res.text();
    const articles = [];
    const blocks = xml.split('</url>');

    for (const block of blocks) {
      const loc = block.match(/<loc>\s*(.*?)\s*<\/loc>/)?.[1];
      if (!loc) continue;

      const pubDate = block.match(/<news:publication_date>\s*(.*?)\s*<\/news:publication_date>/)?.[1]
                   || block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/)?.[1]
                   || '';

      if (targetDate && !pubDate.startsWith(targetDate)) continue;

      const rawTitle = block.match(/<news:title>\s*([\s\S]*?)\s*<\/news:title>/)?.[1]
                    || block.match(/<title>\s*([\s\S]*?)\s*<\/title>/)?.[1]
                    || '';

      const timeMatch = pubDate.match(/T(\d{2}:\d{2})/);
      const cleanUrl  = decodeXmlEntities(loc.trim());

      articles.push({
        source:       source.key,
        source_name:  source.name,
        source_color: source.color,
        url:          cleanUrl,
        title:        decodeXmlEntities(rawTitle.trim()),
        publish_date: pubDate,
        publish_time: timeMatch ? timeMatch[1] : null,
        category:     extractCategoryFromUrl(cleanUrl),
      });
    }
    return articles;
  } catch (e) {
    console.warn(`[news-feed] ${source.name} failed: ${e.message}`);
    return [];
  }
}

// ── 5-minute in-memory cache keyed by date ─────────────────────────────────
const cache   = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getNewsFeed(targetDate) {
  const now = Date.now();
  if (cache[targetDate] && (now - cache[targetDate].ts) < CACHE_TTL) {
    return cache[targetDate].data;
  }

  const results = await Promise.all(SOURCES.map(s => fetchSourceSitemap(s, targetDate)));

  const articles = results.flat().sort((a, b) =>
    (b.publish_date || '').localeCompare(a.publish_date || '')
  );

  const sourceSummary = SOURCES.map((s, i) => ({
    key:   s.key,
    name:  s.name,
    color: s.color,
    count: results[i].length,
  }));

  const data = { articles, sources: sourceSummary, date: targetDate, total: articles.length };
  cache[targetDate] = { data, ts: now };
  return data;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = getUser(req);
  if (!user) return res.status(403).json({ error: 'Auth required' });

  const isDigital  = user.source === 'digital';
  const isNewsroom = ['Admin', 'Management', 'State Head', 'Regional Editor'].includes(user.role);
  if (!isDigital && !isNewsroom) return res.status(403).json({ error: 'Access denied' });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const targetDate = req.query.date
    || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  try {
    const data = await getNewsFeed(targetDate);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
