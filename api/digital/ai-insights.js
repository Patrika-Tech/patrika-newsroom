/**
 * GET /api/digital/ai-insights?month=YYYY-MM
 *
 * Computes rule-based editorial insights from the existing digital team DB.
 * Draws from digital_user, digital_target, digital_achievment,
 * chartbeat_author_daily, digital_breaking_news.
 *
 * Returns:
 *   { month, day_progress, computed_at, insights: Insight[] }
 *
 * Insight shape:
 *   { id, type, title, body, severity, data?, action? }
 *   severity: 'success' | 'warning' | 'alert' | 'info'
 */
const { query }    = require('../_lib/mysql');
const { getUser }  = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

// ── Helpers ──────────────────────────────────────────────────────────────────
function pct(ach, tgt) {
  if (!tgt) return null;
  return Math.round((ach / tgt) * 100);
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to   = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { from, to, daysInMonth: lastDay };
}

function dayProgress(month) {
  const now    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const [y, m] = month.split('-').map(Number);
  const curM   = now.getFullYear() * 12 + now.getMonth();
  const tarM   = y * 12 + (m - 1);
  if (curM < tarM) return 0;          // future month
  if (curM > tarM) return 100;        // past month — fully elapsed
  const lastDay = new Date(y, m, 0).getDate();
  return Math.min(100, Math.round((now.getDate() / lastDay) * 100));
}

function fmtLakh(n) {
  if (n >= 1e5) return (n / 1e5).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function timeSecToStr(sec) {
  if (sec === null || sec === undefined) return null;
  const sign = sec < 0 ? '-' : '+';
  const abs  = Math.abs(Math.round(sec));
  const h    = Math.floor(abs / 3600);
  const min  = Math.floor((abs % 3600) / 60);
  return h > 0 ? `${sign}${h}h ${min}m` : `${sign}${min}m`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const isDigital  = user.source === 'digital';
  const isNewsroom = ['Admin', 'Management', 'State Head', 'Regional Editor'].includes(user.role);
  if (!isDigital && !isNewsroom) return res.status(403).json({ error: 'Access denied' });

  const month = req.query.month || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const { from, to, daysInMonth } = monthRange(month);
  const dp = dayProgress(month);

  // ── Role-based user scope ──────────────────────────────────────────────────
  const dr         = user.digital_role;
  let   userFilter = ' AND u.is_emp_working = 1';
  const userParams = [];
  if (isDigital) {
    if (dr === 'individual') {
      userFilter += ' AND u.id = ?';
      userParams.push(user.digital_id);
    } else if (dr === 'team_lead') {
      userFilter += ' AND (u.incharge = ? OR u.id = ?)';
      userParams.push(user.name, user.digital_id);
    }
  }

  try {
    // ── 1. Fetch users + targets + achievements in one pass ──────────────────
    const users = await query(
      `SELECT u.id, u.name, u.team, u.incharge, u.role,
              t.tgt_month_UV as uv_target, t.tgt_month_PV as pv_target,
              t.tgt_month_no_of_story as story_target,
              COALESCE(SUM(a.ach_month_UV), 0)          as uv_ach,
              COALESCE(SUM(a.ach_month_PV), 0)          as pv_ach,
              COALESCE(SUM(a.ach_month_no_of_story), 0) as story_ach
       FROM digital_user u
       LEFT JOIN digital_target t
              ON t.user_id = u.id AND t.target_month = ?
       LEFT JOIN digital_achievment a
              ON a.user_id = u.id AND a.from_date <= ? AND a.to_date >= ?
       WHERE 1=1 ${userFilter}
       GROUP BY u.id, u.name, u.team, u.incharge, u.role,
                t.tgt_month_UV, t.tgt_month_PV, t.tgt_month_no_of_story
       ORDER BY u.team, u.name`,
      [month, to, from, ...userParams]
    ).catch(() => []);

    // ── 2. Chartbeat — last 7 days ───────────────────────────────────────────
    const cbRows = await query(
      `SELECT stat_date, author, stories, page_uniques, top_title
       FROM chartbeat_author_daily
       WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       ORDER BY stat_date DESC, page_uniques DESC`,
      []
    ).catch(() => []);

    // ── 3. Breaking news — last 30 days ─────────────────────────────────────
    const bnStats = await query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN speed_vs_source IS NOT NULL AND speed_vs_source < '00:00:00' THEN 1 ELSE 0 END) as faster_source,
         SUM(CASE WHEN speed_vs_competitor IS NOT NULL AND speed_vs_competitor > '00:00:00' THEN 1 ELSE 0 END) as faster_comp,
         AVG(TIME_TO_SEC(speed_vs_source))      as avg_vs_source_sec,
         AVG(TIME_TO_SEC(speed_vs_competitor))  as avg_vs_comp_sec,
         COUNT(DISTINCT editor_name) as editors_active
       FROM digital_breaking_news
       WHERE entry_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      []
    ).catch(() => [{}]);

    const bn = bnStats[0] || {};

    // ── 4. Chartbeat top story today ─────────────────────────────────────────
    const cbToday = cbRows.filter(r => r.stat_date &&
      r.stat_date.toISOString?.()?.slice(0, 10) === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      || String(r.stat_date).slice(0, 10) === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    );

    // ── Compute insights ──────────────────────────────────────────────────────
    const insights = [];

    // ── I. Overall target progress ───────────────────────────────────────────
    const withStoryTgt  = users.filter(u => Number(u.story_target) > 0);
    const withUvTgt     = users.filter(u => Number(u.uv_target) > 0);
    const totalStoryTgt = withStoryTgt.reduce((s, u) => s + Number(u.story_target), 0);
    const totalStoryAch = withStoryTgt.reduce((s, u) => s + Number(u.story_ach),   0);
    const totalUvTgt    = withUvTgt.reduce((s, u) => s + Number(u.uv_target), 0);
    const totalUvAch    = withUvTgt.reduce((s, u) => s + Number(u.uv_ach),    0);

    const overallStoryPct = pct(totalStoryAch, totalStoryTgt);
    const overallUvPct    = pct(totalUvAch, totalUvTgt);
    const expectedPct     = dp;   // how much of the month has passed

    if (totalStoryTgt > 0) {
      const storyGap = expectedPct - (overallStoryPct || 0);
      insights.push({
        id:       'team_story_pace',
        type:     'pace',
        title:    storyGap > 15
          ? `Team is behind story target by ${storyGap}%`
          : storyGap < -10
          ? `Team is ahead of story target — great pace!`
          : 'Story publishing pace is on track',
        body:     `${totalStoryAch.toLocaleString()} stories published out of ${totalStoryTgt.toLocaleString()} target (${overallStoryPct ?? 0}%). At ${dp}% of the month, expected achievement is ${dp}%.`,
        severity: storyGap > 20 ? 'alert' : storyGap > 10 ? 'warning' : 'success',
        data: { ach: totalStoryAch, target: totalStoryTgt, pct: overallStoryPct, expected: dp },
        action:   storyGap > 15 ? `Team needs to publish ~${Math.ceil((totalStoryTgt * dp / 100) - totalStoryAch)} more stories to catch up to today's expected pace.` : null,
      });
    }

    if (totalUvTgt > 0) {
      const uvGap = expectedPct - (overallUvPct || 0);
      insights.push({
        id:       'team_uv_pace',
        type:     'uv',
        title:    uvGap > 15
          ? `UV traffic is lagging behind target`
          : uvGap < -10
          ? `UV traffic is exceeding expectations`
          : 'UV traffic pace is healthy',
        body:     `${fmtLakh(totalUvAch)} UVs earned vs ${fmtLakh(totalUvTgt)} target (${overallUvPct ?? 0}%). With ${dp}% of the month elapsed, the team is ${Math.abs(uvGap)}% ${uvGap > 0 ? 'behind' : 'ahead of'} expected pace.`,
        severity: uvGap > 20 ? 'alert' : uvGap > 10 ? 'warning' : 'success',
        data: { ach: totalUvAch, target: totalUvTgt, pct: overallUvPct, expected: dp },
        action:   uvGap > 20 ? 'Focus on high-UV categories like national, crime, and sports to recover traffic quickly.' : null,
      });
    }

    // ── II. Individual pace alerts ────────────────────────────────────────────
    const behind = withStoryTgt
      .map(u => ({
        name:     u.name,
        team:     u.team,
        story_ach:    Number(u.story_ach),
        story_target: Number(u.story_target),
        expected: Math.round(Number(u.story_target) * dp / 100),
        gap:      Math.round(Number(u.story_target) * dp / 100) - Number(u.story_ach),
      }))
      .filter(u => u.gap > 2 && dp >= 25)   // only flag if we're past 25% of month
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 5);

    if (behind.length > 0) {
      insights.push({
        id:       'editor_pace_alerts',
        type:     'editor',
        title:    `${behind.length} editor${behind.length > 1 ? 's' : ''} behind expected story count`,
        body:     `These editors need to increase publishing rate to meet monthly targets at the current ${dp}% point of the month.`,
        severity: behind.some(u => u.gap >= 10) ? 'alert' : 'warning',
        data:     behind.map(u => ({
          name:     u.name,
          team:     u.team,
          filed:    u.story_ach,
          expected: u.expected,
          gap:      u.gap,
        })),
        action:   `Incharges should review assignments and redistributetopics for editors with large gaps.`,
      });
    }

    // ── III. Top performer — UV ───────────────────────────────────────────────
    const topUv = [...withUvTgt]
      .filter(u => Number(u.uv_ach) > 0)
      .sort((a, b) => pct(Number(b.uv_ach), Number(b.uv_target)) - pct(Number(a.uv_ach), Number(a.uv_target)))[0];

    if (topUv) {
      const p = pct(Number(topUv.uv_ach), Number(topUv.uv_target));
      insights.push({
        id:       'top_uv_performer',
        type:     'star',
        title:    `${topUv.name} leads in UV achievement (${p}%)`,
        body:     `${topUv.name} (${topUv.team || 'Team N/A'}) has earned ${fmtLakh(Number(topUv.uv_ach))} UVs against a target of ${fmtLakh(Number(topUv.uv_target))} — highest achievement % this month.`,
        severity: p >= 100 ? 'success' : p >= 75 ? 'success' : 'info',
        data:     { name: topUv.name, uv_ach: Number(topUv.uv_ach), uv_target: Number(topUv.uv_target), pct: p },
        action:   p >= 100 ? `${topUv.name} has hit their UV target. Consider featuring their content prominently.` : null,
      });
    }

    // ── IV. UV efficiency (UV per story) ─────────────────────────────────────
    const withBoth = users.filter(u => Number(u.story_ach) >= 3 && Number(u.uv_ach) > 0);
    if (withBoth.length >= 2) {
      const ranked = withBoth
        .map(u => ({
          name:       u.name,
          team:       u.team,
          uvPerStory: Math.round(Number(u.uv_ach) / Number(u.story_ach)),
          stories:    Number(u.story_ach),
          uv:         Number(u.uv_ach),
        }))
        .sort((a, b) => b.uvPerStory - a.uvPerStory);

      const best  = ranked[0];
      const worst = ranked[ranked.length - 1];
      const ratio = best.uvPerStory / Math.max(worst.uvPerStory, 1);

      insights.push({
        id:       'uv_efficiency',
        type:     'quality',
        title:    `Content quality gap: ${best.name} gets ${ratio.toFixed(1)}× more UVs per story`,
        body:     `${best.name} averages ${fmtLakh(best.uvPerStory)} UVs/story while ${worst.name} averages ${fmtLakh(worst.uvPerStory)} UVs/story. Prioritising high-engagement topics can lift overall traffic without more stories.`,
        severity: ratio >= 3 ? 'warning' : 'info',
        data:     ranked.slice(0, 5).map(u => ({ name: u.name, uvPerStory: u.uvPerStory, stories: u.stories })),
        action:   ratio >= 3 ? `Share ${best.name}'s content angles and topics with the wider team for alignment.` : null,
      });
    }

    // ── V. Team leaderboard ───────────────────────────────────────────────────
    const teamMap = {};
    users.forEach(u => {
      const k = u.team || 'Ungrouped';
      if (!teamMap[k]) teamMap[k] = { team: k, story_target: 0, story_ach: 0, uv_target: 0, uv_ach: 0, members: 0 };
      teamMap[k].story_target += Number(u.story_target || 0);
      teamMap[k].story_ach   += Number(u.story_ach    || 0);
      teamMap[k].uv_target   += Number(u.uv_target    || 0);
      teamMap[k].uv_ach      += Number(u.uv_ach       || 0);
      teamMap[k].members++;
    });

    const teams = Object.values(teamMap)
      .filter(t => t.story_target > 0 || t.uv_target > 0)
      .map(t => ({
        ...t,
        story_pct: pct(t.story_ach, t.story_target),
        uv_pct:    pct(t.uv_ach, t.uv_target),
        combined:  Math.round(((pct(t.story_ach, t.story_target) || 0) + (pct(t.uv_ach, t.uv_target) || 0)) / 2),
      }))
      .sort((a, b) => b.combined - a.combined);

    if (teams.length >= 2) {
      const leader  = teams[0];
      const laggard = teams[teams.length - 1];
      insights.push({
        id:       'team_leaderboard',
        type:     'teams',
        title:    `${leader.team} leads — ${laggard.team} needs attention`,
        body:     `${leader.team} has the highest combined achievement (${leader.combined}%). ${laggard.team} is at ${laggard.combined}% — a ${leader.combined - laggard.combined}-point gap.`,
        severity: (leader.combined - laggard.combined) >= 30 ? 'warning' : 'info',
        data:     teams.map(t => ({ team: t.team, story_pct: t.story_pct, uv_pct: t.uv_pct, members: t.members })),
        action:   laggard.combined < 40 && dp > 50 ? `${laggard.team}'s incharge should review targets and escalate bottlenecks immediately.` : null,
      });
    }

    // ── VI. Editors without targets ───────────────────────────────────────────
    const noTarget = users.filter(u =>
      !Number(u.story_target) && !Number(u.uv_target)
    );
    if (noTarget.length > 0 && (isNewsroom || dr === 'digital_admin')) {
      insights.push({
        id:       'no_targets',
        type:     'admin',
        title:    `${noTarget.length} active editor${noTarget.length > 1 ? 's' : ''} have no targets set for ${month}`,
        body:     `${noTarget.map(u => u.name).join(', ')} — their performance cannot be tracked this month without target data.`,
        severity: 'warning',
        data:     noTarget.map(u => ({ name: u.name, team: u.team })),
        action:   `Upload targets via Settings → Upload Excel or set them manually.`,
      });
    }

    // ── VII. Breaking news speed ──────────────────────────────────────────────
    if (Number(bn.total) > 0) {
      const total        = Number(bn.total);
      const fasterSrc    = Number(bn.faster_source || 0);
      const fasterComp   = Number(bn.faster_comp   || 0);
      const avgVsSrcSec  = Number(bn.avg_vs_source_sec  || 0);
      const fasterSrcPct = Math.round(fasterSrc / total * 100);
      const fasterCompPct= Math.round(fasterComp / total * 100);
      const avgStr       = timeSecToStr(avgVsSrcSec);

      insights.push({
        id:       'breaking_speed',
        type:     'speed',
        title:    fasterSrcPct >= 60
          ? `Patrika breaks news ${fasterSrcPct}% of the time before sources`
          : `Speed gap: Patrika beats source only ${fasterSrcPct}% of the time`,
        body:     `Over the last 30 days, ${total} breaking news entries were tracked. Average publish time vs source: ${avgStr || '—'}. Patrika was faster than competitors in ${fasterCompPct}% of tracked stories.`,
        severity: fasterSrcPct >= 60 ? 'success' : fasterSrcPct >= 40 ? 'info' : 'warning',
        data: {
          total,
          faster_source: fasterSrc,
          faster_source_pct: fasterSrcPct,
          faster_comp: fasterComp,
          faster_comp_pct: fasterCompPct,
          avg_vs_source: avgStr,
          editors_active: Number(bn.editors_active || 0),
        },
        action:   fasterSrcPct < 40 ? 'Assign a dedicated breaking news editor per shift to improve real-time response.' : null,
      });
    }

    // ── VIII. Chartbeat — today's pulse ──────────────────────────────────────
    if (cbToday.length > 0) {
      const totalStoriesT = cbToday.reduce((s, r) => s + Number(r.stories || 0), 0);
      const totalUvsT     = cbToday.reduce((s, r) => s + Number(r.page_uniques || 0), 0);
      const topRow        = cbToday[0];

      insights.push({
        id:       'today_pulse',
        type:     'today',
        title:    `Today: ${totalStoriesT} stories · ${fmtLakh(totalUvsT)} UVs (live)`,
        body:     topRow?.top_title
          ? `Top story: "${topRow.top_title}" — ${fmtLakh(Number(topRow.page_uniques || 0))} UVs by ${topRow.author}.`
          : `${cbToday.length} editors active today in Chartbeat.`,
        severity: 'info',
        data:     cbToday.slice(0, 8).map(r => ({
          author:      r.author,
          stories:     Number(r.stories),
          page_uniques:Number(r.page_uniques),
          top_title:   r.top_title || '',
        })),
        action:   null,
      });
    }

    // ── IX. 7-day Chartbeat trend by author ──────────────────────────────────
    if (cbRows.length >= 2) {
      const authorMap = {};
      cbRows.forEach(r => {
        if (!r.author) return;
        if (!authorMap[r.author]) authorMap[r.author] = { author: r.author, totalUv: 0, totalStories: 0, days: 0 };
        authorMap[r.author].totalUv      += Number(r.page_uniques || 0);
        authorMap[r.author].totalStories += Number(r.stories      || 0);
        authorMap[r.author].days++;
      });

      const weekTop = Object.values(authorMap)
        .filter(a => a.totalUv > 0)
        .sort((a, b) => b.totalUv - a.totalUv)
        .slice(0, 5);

      if (weekTop.length > 0) {
        insights.push({
          id:       'week_top_authors',
          type:     'weekly',
          title:    `This week's traffic leaders from Chartbeat`,
          body:     `${weekTop[0].author} drove the most UVs this week (${fmtLakh(weekTop[0].totalUv)}) with ${weekTop[0].totalStories} stories. Publishing more from top authors can amplify weekly traffic.`,
          severity: 'info',
          data:     weekTop.map(a => ({
            author:        a.author,
            totalUv:       a.totalUv,
            totalStories:  a.totalStories,
            uvPerStory:    a.totalStories > 0 ? Math.round(a.totalUv / a.totalStories) : 0,
          })),
          action:   null,
        });
      }

      // Best day-of-week pattern
      const dowMap = { 0: { day: 'Sun', uv: 0, n: 0 }, 1: { day: 'Mon', uv: 0, n: 0 }, 2: { day: 'Tue', uv: 0, n: 0 }, 3: { day: 'Wed', uv: 0, n: 0 }, 4: { day: 'Thu', uv: 0, n: 0 }, 5: { day: 'Fri', uv: 0, n: 0 }, 6: { day: 'Sat', uv: 0, n: 0 } };
      cbRows.forEach(r => {
        const d = new Date(r.stat_date);
        if (isNaN(d.getTime())) return;
        const dow = d.getDay();
        dowMap[dow].uv += Number(r.page_uniques || 0);
        dowMap[dow].n++;
      });
      const dowArr   = Object.values(dowMap).filter(d => d.n > 0).map(d => ({ ...d, avg: Math.round(d.uv / d.n) })).sort((a, b) => b.avg - a.avg);
      const bestDay  = dowArr[0];
      const worstDay = dowArr[dowArr.length - 1];
      if (bestDay && bestDay.day !== worstDay.day) {
        insights.push({
          id:       'best_day_traffic',
          type:     'pattern',
          title:    `${bestDay.day} is your highest-traffic day (avg ${fmtLakh(bestDay.avg)} UVs)`,
          body:     `${worstDay.day} has the lowest average traffic (${fmtLakh(worstDay.avg)} UVs). Schedule your most important / exclusive content for ${bestDay.day} to maximise reach.`,
          severity: 'info',
          data:     dowArr.map(d => ({ day: d.day, avg: d.avg, n: d.n })),
          action:   `Plan high-impact stories (exclusives, investigations, trending topics) for ${bestDay.day} mornings.`,
        });
      }
    }

    return res.json({
      month,
      day_progress: dp,
      computed_at:  new Date().toISOString(),
      total_editors: users.length,
      insights,
    });
  } catch (err) {
    console.error('[ai-insights]', err);
    return res.status(500).json({ error: err.message });
  }
};
