'use strict';
/**
 * GET /api/hr/grading-top?state=X&branch=Y
 *
 * Returns top-3 and worst-3 employees for the previous calendar month.
 * Score = (work + behaviour + discipline + interest) / 20 × 100  (manual grades only, 0-5 each).
 * overall_grade column is CHAR(1) in MySQL and gets truncated, so we recompute from raw columns.
 */
const { setCors, handleOptions } = require('../_lib/cors');
const { requireRole }            = require('../_lib/auth');
const { query }                  = require('../_lib/mysql');

const VIEW_ROLES = ['Admin', 'HR', 'Management', 'State Head', 'Regional Editor'];

function prevMonth() {
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() - 1);
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, VIEW_ROLES);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const month  = prevMonth();
  const state  = (req.query.state  || '').trim();
  const branch = (req.query.branch || '').trim();

  try {
    const where  = ['g.month = ?'];
    const params = [month];
    if (state  && state  !== 'All') { where.push('g.state = ?');  params.push(state);  }
    if (branch && branch !== 'All') { where.push('g.branch = ?'); params.push(branch); }

    const rows = await query(
      `SELECT
         g.pan,
         COALESCE(g.emp_name, u.EMPNAME)                                       AS name,
         COALESCE(g.branch,   u.Branch)                                        AS branch,
         CASE WHEN u.Story_Type = 'NE' THEN COALESCE(u.profile, 'NE')
              ELSE COALESCE(u.Story_Type, '—') END                             AS story_type,
         g.pli_percent,
         CAST(COALESCE(g.work_grade,       '0') AS UNSIGNED) AS w,
         CAST(COALESCE(g.behaviour_grade,  '0') AS UNSIGNED) AS b,
         CAST(COALESCE(g.discipline_grade, '0') AS UNSIGNED) AS d,
         CAST(COALESCE(g.interest_grade,   '0') AS UNSIGNED) AS i
       FROM hr_grading g
       LEFT JOIN \`user\` u ON UPPER(u.pan_no) = UPPER(g.pan)
       WHERE ${where.join(' AND ')}
         AND COALESCE(g.work_grade, g.behaviour_grade, g.discipline_grade, g.interest_grade) IS NOT NULL`,
      params
    );

    if (!rows.length) return res.json({ month, top3: [], worst3: [], total: 0 });

    const scored = rows.map(r => {
      const sum = (Number(r.w)||0) + (Number(r.b)||0) + (Number(r.d)||0) + (Number(r.i)||0);
      const pct = Math.round((sum / 20) * 100);
      return {
        pan:         r.pan,
        name:        r.name || r.pan,
        branch:      r.branch || '—',
        story_type:  r.story_type || '—',
        pli_amount:  r.pli_percent != null ? Number(r.pli_percent) : null,
        manual_sum:  sum,
        score_pct:   pct,
      };
    }).filter(e => e.manual_sum > 0);

    scored.sort((a, b) => b.score_pct - a.score_pct);

    return res.json({
      month,
      top3:   scored.slice(0, 3),
      worst3: scored.slice(-3).reverse(),
      total:  scored.length,
    });
  } catch (err) {
    console.error('[grading-top]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
