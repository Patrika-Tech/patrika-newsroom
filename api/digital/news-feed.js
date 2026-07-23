/**
 * /api/digital/news-feed
 * GET ?date=YYYY-MM-DD
 * Fetches today's articles from Patrika + major Hindi news sources in parallel.
 * Supports Google News sitemaps, sitemap indexes, and RSS feeds.
 * Results are cached for 5 minutes.
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
    'Accept':     'application/xml, text/xml, application/rss+xml, */*',
  },
};

// format: 'sitemap' = Google News sitemap XML
//         'rss'     = RSS 2.0 feed
const SOURCES = [
  {
    key:    'patrika',
    name:   'Patrika',
    color:  '#e53935',
    format: 'sitemap',
    url:    'https://www.patrika.com/google-news-sitemap-v1.xml',
  },
  {
    key:    'bhaskar',
    name:   'Dainik Bhaskar',
    color:  '#f57c00',
    format: 'sitemap',
    url:    'https://www.bhaskar.com/google-news-sitemap-v1.xml',
    rssUrl: 'https://www.bhaskar.com/rss-feed/1061/',
  },
  {
    key:    'jagran',
    name:   'Dainik Jagran',
    color:  '#1565c0',
    format: 'rss',
    url:    'https://www.jagran.com/rss/news-national.xml',
    rssUrl: 'https://www.jagran.com/rss/news-national.xml',
  },
  {
    key:    'amarujala',
    name:   'Amar Ujala',
    color:  '#6a1b9a',
    format: 'sitemap',
    url:    'https://www.amarujala.com/sitemap/googlenews.xml',
  },
  {
    key:    'nbt',
    name:   'Nav Bharat Times',
    color:  '#00838f',
    format: 'sitemap',
    url:    'https://navbharattimes.indiatimes.com/GoogleNewsSitemap.xml',
  },
  {
    key:    'ndtvindia',
    name:   'NDTV India',
    color:  '#c62828',
    format: 'sitemap',
    url:    'https://www.ndtv.com/google-news-sitemap.xml',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// Convert any date string to IST YYYY-MM-DD
function toISTDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr.slice(0, 10); // fallback: take first 10 chars
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  } catch { return dateStr.slice(0, 10); }
}

// Extract HH:MM in IST from any date string
function toISTTime(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) {
      const m = dateStr.match(/T(\d{2}:\d{2})/);
      return m ? m[1] : null;
    }
    return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return null; }
}

// ── Sitemap parser (supports sitemap index + regular sitemap) ──────────────────

async function parseSitemap(xml, source, targetDate) {
  const articles = [];

  // Detect sitemap index (contains <sitemapindex> or <sitemap> elements without <url>)
  const isSitemapIndex = xml.includes('<sitemapindex') ||
    (xml.includes('<sitemap>') && !xml.includes('<url>'));

  if (isSitemapIndex) {
    // Extract child sitemap URLs and find the one(s) matching today
    const childUrls = [];
    const sitemapBlocks = xml.split('</sitemap>');
    for (const block of sitemapBlocks) {
      const loc = block.match(/<loc>\s*(.*?)\s*<\/loc>/)?.[1];
      if (!loc) continue;
      const lastmod = block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/)?.[1] || '';
      // Include if lastmod matches today or if it looks like a news/today sitemap
      const locDate = lastmod ? toISTDate(lastmod) : '';
      const looksLikeToday = locDate === targetDate ||
        loc.includes(targetDate ? targetDate.replace(/-/g, '-') : '') ||
        loc.includes('today') || loc.includes('news');
      if (looksLikeToday || !lastmod) childUrls.push(loc);
    }
    // Limit to avoid hammering
    const toFetch = childUrls.slice(0, 3);
    const childResults = await Promise.all(toFetch.map(async url => {
      try {
        const r = await fetch(url, FETCH_OPTS);
        if (!r.ok) return [];
        const childXml = await r.text();
        return parseSitemap(childXml, source, targetDate);
      } catch { return []; }
    }));
    return childResults.flat();
  }

  // Regular sitemap — parse <url> blocks
  const blocks = xml.split('</url>');
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*(.*?)\s*<\/loc>/)?.[1];
    if (!loc) continue;

    const pubDateRaw = block.match(/<news:publication_date>\s*(.*?)\s*<\/news:publication_date>/)?.[1]
                    || block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/)?.[1]
                    || '';

    if (!pubDateRaw) continue;
    if (targetDate && toISTDate(pubDateRaw) !== targetDate) continue;

    const rawTitle = block.match(/<news:title>\s*([\s\S]*?)\s*<\/news:title>/)?.[1]
                  || block.match(/<image:title>\s*([\s\S]*?)\s*<\/image:title>/)?.[1]
                  || block.match(/<title>\s*([\s\S]*?)\s*<\/title>/)?.[1]
                  || '';

    const cleanUrl = decodeXmlEntities(loc.trim());

    articles.push({
      source:       source.key,
      source_name:  source.name,
      source_color: source.color,
      url:          cleanUrl,
      title:        decodeXmlEntities(rawTitle.trim()),
      publish_date: pubDateRaw,
      publish_time: toISTTime(pubDateRaw),
      category:     extractCategoryFromUrl(cleanUrl),
    });
  }
  return articles;
}

// ── RSS parser (RSS 2.0) ───────────────────────────────────────────────────────

async function parseRSS(xml, source, targetDate) {
  const articles = [];
  const blocks = xml.split('</item>');

  for (const block of blocks) {
    const title   = block.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/)?.[1];
    const link    = block.match(/<link>\s*(.*?)\s*<\/link>/)?.[1]
                 || block.match(/<guid[^>]*>\s*(https?:\/\/.*?)\s*<\/guid>/)?.[1];
    const pubDate = block.match(/<pubDate>\s*(.*?)\s*<\/pubDate>/)?.[1]
                 || block.match(/<dc:date>\s*(.*?)\s*<\/dc:date>/)?.[1]
                 || block.match(/<published>\s*(.*?)\s*<\/published>/)?.[1]
                 || '';
    const cat     = block.match(/<category[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/category>/)?.[1]
                 || '';

    if (!title || !link) continue;
    if (!link.startsWith('http')) continue;

    if (pubDate && targetDate && toISTDate(pubDate) !== targetDate) continue;

    const cleanUrl = decodeXmlEntities(link.trim());

    articles.push({
      source:       source.key,
      source_name:  source.name,
      source_color: source.color,
      url:          cleanUrl,
      title:        decodeXmlEntities(title.trim()),
      publish_date: pubDate,
      publish_time: pubDate ? toISTTime(pubDate) : null,
      category:     cat ? cat.trim().toLowerCase() : extractCategoryFromUrl(cleanUrl),
    });
  }
  return articles;
}

// ── Fetch one source (primary URL, then fallback) ─────────────────────────────

async function fetchSource(source, targetDate) {
  const urls = [];
  if (source.format === 'rss' && source.rssUrl) urls.push({ url: source.rssUrl, format: 'rss' });
  if (source.url) urls.push({ url: source.url, format: source.format || 'sitemap' });
  if (source.rssUrl && source.format !== 'rss') urls.push({ url: source.rssUrl, format: 'rss' });

  for (const { url, format } of urls) {
    try {
      const res = await fetch(url, FETCH_OPTS);
      if (!res.ok) continue;
      const xml = await res.text();
      const articles = format === 'rss'
        ? await parseRSS(xml, source, targetDate)
        : await parseSitemap(xml, source, targetDate);
      if (articles.length > 0) return articles;
    } catch (e) {
      console.warn(`[news-feed] ${source.name} (${url}) failed: ${e.message}`);
    }
  }
  console.warn(`[news-feed] ${source.name} — all URLs returned 0 articles for ${targetDate}`);
  return [];
}

// ── 5-minute in-memory cache keyed by date ────────────────────────────────────

const cache     = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getNewsFeed(targetDate) {
  const now = Date.now();
  if (cache[targetDate] && (now - cache[targetDate].ts) < CACHE_TTL) {
    return cache[targetDate].data;
  }

  const results = await Promise.all(SOURCES.map(s => fetchSource(s, targetDate)));

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

// Returns true if an article qualifies as breaking/recent news
function isBreaking(article, cutoffMs) {
  const url = (article.url      || '').toLowerCase();
  const cat = (article.category || '').toLowerCase();
  const isBreakingUrl = /(breaking|taza-khabar|live-update|latest-news)/.test(url);
  const isBreakingCat = /breaking/.test(cat);
  const isRecent      = article.publish_date
    ? new Date(article.publish_date).getTime() >= cutoffMs
    : false;
  return isBreakingUrl || isBreakingCat || isRecent;
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

  const targetDate    = req.query.date
    || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const breakingMode  = req.query.breaking === '1';
  const hoursWindow   = Math.min(parseInt(req.query.hours || '4', 10), 24);

  try {
    const base = await getNewsFeed(targetDate);

    if (!breakingMode) return res.json(base);

    // Breaking mode: articles tagged breaking OR published within hoursWindow hours
    const cutoffMs  = Date.now() - hoursWindow * 60 * 60 * 1000;
    const articles  = base.articles.filter(a => isBreaking(a, cutoffMs));

    // Recalculate per-source counts for the breaking subset
    const sources   = base.sources.map(s => ({
      ...s,
      count: articles.filter(a => a.source === s.key).length,
    }));

    return res.json({ ...base, articles, sources, total: articles.length, breaking: true, hoursWindow });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
