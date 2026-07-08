/**
 * GET /api/digital/dashboard?month=YYYY-MM
 *
 * Returns performance data for digital team users.
 * Role-based scope:
 *   digital_admin → all users
 *   team_lead     → team members where incharge = their name
 *   individual    → only themselves
 *   Admin (newsroom) → all users
 *
 * Optional WordPress integration: set WP_API_BASE in .env
 * e.g. WP_API_BASE=https://rajasthan.patrika.com/wp-json/wp/v2
 */
const { query }    = require('../_lib/mysql');
const { getUser }  = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const nodeFetch    = require('node-fetch');

const WP_BASE = process.env.WP_API_BASE || '';

async function fetchWpStories(cmsId, afterDate, beforeDate) {
  if (!WP_BASE || !cmsId) return null;
  try {
    const url = `${WP_BASE}/posts?author=${cmsId}&after=${afterDate}T00:00:00&before=${beforeDate}T23:59:59&per_page=100&status=publish&_fields=id,date,author`;
    const res  = await nodeFetch(url, { timeout: 5000 });
    if (!res.ok) return null;
    const posts = await res.json();
    return Array.isArray(posts) ? posts.length : null;
  } catch { return null; }
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function pct(ach, tgt) {
  if (!tgt) return null;
  return Math.round((ach / tgt) * 100);
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const isNewsroomAdmin = user.role === 'Admin';
  const isDigital = user.source === 'digital';
  if (!isNewsroomAdmin && !isDigital)
    return res.status(403).json({ error: 'Digital team access only' });

  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const { from, to } = monthRange(month);

  try {
    // ── 1. Fetch digital users (scope by role) ────────────────────────────
    let usersQ  = 'SELECT * FROM digital_user WHERE is_emp_working = 1';
    let usersP  = [];

    if (isDigital) {
      const dr = user.digital_role;
      if (dr === 'individual') {
        usersQ += ' AND id = ?';
        usersP = [user.digital_id];
      } else if (dr === 'team_lead') {
        usersQ += ' AND (incharge = ? OR id = ?)';
        usersP = [user.name, user.digital_id];
      }
      // digital_admin: all users (no extra filter)
    }
    usersQ += ' ORDER BY team, name';

    const users = await query(usersQ, usersP);
    const ids   = users.map(u => u.id);
    if (!ids.length) return res.json({ month, from, to, users: [], teams: [] });

    // ── 2. Fetch targets for this month ────────────────────────────────────
    const targets = await query(
      `SELECT * FROM digital_target WHERE user_id IN (${ids.map(() => '?').join(',')}) AND target_month = ?`,
      [...ids, month]
    ).catch(() => []);

    // ── 3. Fetch achievements for date range ───────────────────────────────
    const achievements = await query(
      `SELECT * FROM digital_achievment
       WHERE user_id IN (${ids.map(() => '?').join(',')})
         AND from_date <= ? AND to_date >= ?`,
      [...ids, to, from]
    ).catch(() => []);

    // ── 4. Build per-user lookup maps ──────────────────────────────────────
    const tgtMap = {};
    targets.forEach(t => { tgtMap[t.user_id] = t; });

    // Aggregate achievements across overlapping date ranges for the month
    const achMap = {};
    achievements.forEach(a => {
      const uid = a.user_id;
      if (!achMap[uid]) {
        achMap[uid] = { uv: 0, pv: 0, stories: 0, avg_time: 0, count: 0 };
      }
      achMap[uid].uv      += Number(a.ach_month_UV             || 0);
      achMap[uid].pv      += Number(a.ach_month_PV             || 0);
      achMap[uid].stories += Number(a.ach_month_no_of_story    || 0);
      achMap[uid].avg_time+= Number(a.Avg_time_on_page         || 0);
      achMap[uid].count++;
    });

    // ── 5. Optional WordPress story count ─────────────────────────────────
    const wpCounts = {};
    if (WP_BASE) {
      await Promise.all(
        users.map(async u => {
          const cmsId = u.cms_id || u.zimbea_id;
          if (cmsId) {
            const c = await fetchWpStories(cmsId, from, to);
            if (c !== null) wpCounts[u.id] = c;
          }
        })
      );
    }

    // ── 6. Assemble result per user ────────────────────────────────────────
    const result = users.map(u => {
      const t = tgtMap[u.id] || {};
      const a = achMap[u.id] || {};

      const uv_target    = Number(t.tgt_month_UV          || 0);
      const pv_target    = Number(t.tgt_month_PV          || 0);
      const story_target = Number(t.tgt_month_no_of_story || 0);
      const avg_tgt      = Number(t.Avg_time_on_page      || 0);

      const uv_ach       = a.uv      || 0;
      const pv_ach       = a.pv      || 0;
      const story_ach    = (wpCounts[u.id] !== undefined) ? wpCounts[u.id] : (a.stories || 0);
      const avg_ach      = a.count   ? Math.round(a.avg_time / a.count) : 0;

      return {
        id:         u.id,
        name:       u.name,
        mail_id:    u.mail_id,
        team:       u.team       || '',
        incharge:   u.incharge   || '',
        role:       u.role       || 'individual',
        cms_id:     u.cms_id     || u.zimbea_id || '',
        state:      u.state      || '',
        location:   u.location   || '',
        uv_target, uv_ach,    uv_pct:    pct(uv_ach, uv_target),
        pv_target, pv_ach,    pv_pct:    pct(pv_ach, pv_target),
        story_target, story_ach, story_pct: pct(story_ach, story_target),
        avg_tgt,   avg_ach,
        wp_stories: wpCounts[u.id] ?? null,
      };
    });

    // ── 7. Team summaries ──────────────────────────────────────────────────
    const teamMap = {};
    result.forEach(u => {
      const k = u.team || 'Ungrouped';
      if (!teamMap[k]) teamMap[k] = { team: k, members: [], uv_target: 0, uv_ach: 0, pv_target: 0, pv_ach: 0, story_target: 0, story_ach: 0 };
      teamMap[k].members.push(u.name);
      teamMap[k].uv_target    += u.uv_target;
      teamMap[k].uv_ach       += u.uv_ach;
      teamMap[k].pv_target    += u.pv_target;
      teamMap[k].pv_ach       += u.pv_ach;
      teamMap[k].story_target += u.story_target;
      teamMap[k].story_ach    += u.story_ach;
    });

    const teams = Object.values(teamMap).map(t => ({
      ...t,
      uv_pct:    pct(t.uv_ach, t.uv_target),
      pv_pct:    pct(t.pv_ach, t.pv_target),
      story_pct: pct(t.story_ach, t.story_target),
    }));

    return res.json({ month, from, to, users: result, teams, wp_enabled: !!WP_BASE });

  } catch (err) {
    console.error('[digital/dashboard]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
