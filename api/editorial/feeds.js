/**
 * GET /api/editorial/feeds
 * Fetches RSS from 6 free Indian news sources, parses XML server-side
 * (no CORS issues), caches each feed for 15 minutes.
 *
 * Sources:
 *   PIB          — Official government press releases
 *   NDTV India   — Breaking national news
 *   The Wire     — Investigative / political
 *   Google News  — India aggregator
 *   Google · Raj — Rajasthan specific
 *   Google · MP  — MP + CG specific
 */
const https  = require('https');
const http   = require('http');
const { requireRole }    = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

// ── Feed catalogue ────────────────────────────────────────────────────────────
const FEEDS = [
  {
    id: 'ndtv',
    label: 'NDTV India',
    url: 'https://feeds.feedburner.com/ndtvnews-india-news',
    type: 'news',
    color: '#d71920',
  },
  {
    id: 'economictimes',
    label: 'Economic Times',
    url: 'https://economictimes.indiatimes.com/rssfeedsdefault.cms',
    type: 'news',
    color: '#C9A227',
  },
  {
    id: 'indiatoday',
    label: 'India Today',
    url: 'https://www.indiatoday.in/rss/home',
    type: 'news',
    color: '#7c3aed',
  },
  {
    id: 'gnews',
    label: 'Google News',
    url: 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en',
    type: 'aggregator',
    color: '#3b82f6',
  },
  {
    id: 'gnews-raj',
    label: 'Google · Rajasthan',
    url: 'https://news.google.com/rss/search?q=Rajasthan&hl=en-IN&gl=IN&ceid=IN:en',
    type: 'regional',
    color: '#e8843a',
  },
  {
    id: 'gnews-mp',
    label: 'Google · MP/CG',
    url: 'https://news.google.com/rss/search?q=Madhya+Pradesh+OR+Chhattisgarh&hl=en-IN&gl=IN&ceid=IN:en',
    type: 'regional',
    color: '#16a34a',
  },
];

// ── In-memory cache (15-min TTL per feed) ─────────────────────────────────────
const CACHE = {};
const CACHE_TTL = 15 * 60 * 1000;

// ── HTTP/HTTPS fetcher (follows up to 3 redirects) ────────────────────────────
function fetchURL(url, hops = 0, baseUrl = '') {
  return new Promise((resolve, reject) => {
    if (hops > 3) return reject(new Error('Too many redirects'));
    // Resolve relative redirects
    if (!url.startsWith('http')) {
      const base = baseUrl || 'https://example.com';
      try { url = new URL(url, base).href; } catch { return reject(new Error('Invalid URL: ' + url)); }
    }
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PatrikaNewsroom/2.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(fetchURL(res.headers.location, hops + 1, url));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── Minimal XML helpers ───────────────────────────────────────────────────────
function getTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function stripHtml(s) {
  return (s || '')
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseRSS(xml, sourceLabel) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = stripHtml(getTag(block, 'title'));
    if (!title) continue;

    // <link> may be an empty tag followed by the URL as text in some RSS 2.0 feeds
    let link = getTag(block, 'link').trim();
    if (!link) {
      const la = block.match(/<link[^>]+href="([^"]+)"/i);
      if (la) link = la[1];
    }
    // Google strips CDATA — link sometimes sits between tags with no wrapper
    if (!link) {
      const ll = block.match(/<link[^/]>([^<]+)<\/link>/i);
      if (ll) link = ll[1].trim();
    }

    const pubDate  = stripHtml(getTag(block, 'pubDate') || getTag(block, 'published') || getTag(block, 'dc:date'));
    const desc     = stripHtml(getTag(block, 'description') || getTag(block, 'summary')).slice(0, 260);
    const category = stripHtml(getTag(block, 'category'));

    // Parse pubDate to ISO (so frontend can sort / format easily)
    let isoDate = '';
    if (pubDate) {
      try { isoDate = new Date(pubDate).toISOString(); } catch {}
    }

    items.push({ title, link: link || '', pubDate: isoDate || pubDate, desc, category, source: sourceLabel });
    if (items.length >= 15) break;
  }
  return items;
}

// ── Route handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { authError } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'HR', 'Management', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const now = Date.now();

  const settled = await Promise.allSettled(
    FEEDS.map(async feed => {
      // Serve from cache if fresh
      if (CACHE[feed.id] && now - CACHE[feed.id].at < CACHE_TTL) {
        return { id: feed.id, label: feed.label, type: feed.type, color: feed.color,
                 articles: CACHE[feed.id].data, cached: true };
      }
      try {
        const xml      = await fetchURL(feed.url);
        const articles = parseRSS(xml, feed.label);
        CACHE[feed.id] = { data: articles, at: now };
        return { id: feed.id, label: feed.label, type: feed.type, color: feed.color,
                 articles, cached: false };
      } catch (err) {
        return { id: feed.id, label: feed.label, type: feed.type, color: feed.color,
                 articles: [], error: err.message };
      }
    })
  );

  const feeds = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  return res.json({ feeds, fetchedAt: new Date().toISOString() });
};
