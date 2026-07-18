/**
 * Weekly Action Plan & Review — newsroom operations (not software)
 *
 * Flow:
 *   1. Regional Editor submits an action plan for the upcoming week
 *      (branch coverage, story targets, exclusives, field visits, events).
 *   2. State Head / Admin review the plan, add remarks and a grade (A–D).
 *   3. Through the week the RE ticks off completed items.
 *
 * GET  /api/tasks/weekly-review            — list plans (role-scoped)
 * POST /api/tasks/weekly-review            — RE/SH/Admin: create or update own plan
 *   Body: { id?, week_start, notes, action_items: [{title, priority, due_date, status}] }
 * POST /api/tasks/weekly-review  (review)  — SH/Admin: review + grade a plan
 *   Body: { id, review: true, review_comment, grade }   grade ∈ A|B|C|D
 */
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

let tableReady = false;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS weekly_action_plans (
      id                INT          AUTO_INCREMENT PRIMARY KEY,
      week_start        DATE         NOT NULL,
      state             VARCHAR(100) NOT NULL DEFAULT '',
      branch            VARCHAR(100) NOT NULL DEFAULT '',
      submitted_by      VARCHAR(100) NOT NULL DEFAULT '',
      submitted_by_name VARCHAR(255) NOT NULL DEFAULT '',
      submitted_role    VARCHAR(50)  NOT NULL DEFAULT '',
      notes             TEXT,
      action_items      MEDIUMTEXT,
      review_comment    TEXT,
      grade             CHAR(1)      DEFAULT NULL,
      reviewed_by       VARCHAR(100) DEFAULT NULL,
      reviewed_by_name  VARCHAR(255) DEFAULT NULL,
      reviewed_at       DATETIME     DEFAULT NULL,
      created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_week_user (week_start, submitted_by),
      INDEX idx_state  (state),
      INDEX idx_branch (branch)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function parseItems(raw) {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'Management']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (!tableReady) {
    try { await ensureTable(); tableReady = true; }
    catch (e) { return res.status(500).json({ error: 'DB setup: ' + e.message }); }
  }

  const canReview = ['Admin', 'State Head', 'Management'].includes(user.role);

  try {
    // ── GET — list plans (role-scoped) ────────────────────────────────────────
    if (req.method === 'GET') {
      const where  = [];
      const params = [];
      if (user.role === 'Regional Editor') {
        where.push('submitted_by = ?'); params.push(user.sub || '');
      } else if (user.role === 'State Head' && user.state) {
        where.push('(state = ? OR submitted_by = ?)'); params.push(user.state, user.sub || '');
      }
      const rows = await query(`
        SELECT id, DATE_FORMAT(week_start, '%Y-%m-%d') AS week_start,
               state, branch, submitted_by, submitted_by_name, submitted_role,
               notes, action_items, review_comment, grade,
               reviewed_by, reviewed_by_name,
               DATE_FORMAT(reviewed_at, '%Y-%m-%dT%H:%i:%s') AS reviewed_at,
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s')  AS created_at,
               DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s')  AS updated_at
        FROM weekly_action_plans
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY week_start DESC, state ASC, branch ASC LIMIT 100
      `, params);
      return res.json({
        plans: rows.map(r => ({ ...r, action_items: parseItems(r.action_items) })),
        canReview,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};

    // ── POST (review mode) — State Head / Admin grade a plan ─────────────────
    if (body.review) {
      if (!canReview) return res.status(403).json({ error: 'Only State Head / Admin can review plans' });
      const { id, review_comment = '', grade } = body;
      if (!id) return res.status(400).json({ error: 'id is required' });
      if (grade && !['A', 'B', 'C', 'D'].includes(grade)) {
        return res.status(400).json({ error: 'grade must be A, B, C or D' });
      }
      // State Head may only review plans in their state
      if (user.role === 'State Head' && user.state) {
        const chk = await query('SELECT state FROM weekly_action_plans WHERE id = ?', [id]);
        if (!chk.length) return res.status(404).json({ error: 'Plan not found' });
        if (chk[0].state && chk[0].state !== user.state) {
          return res.status(403).json({ error: 'You can only review plans from your state' });
        }
      }
      await query(
        `UPDATE weekly_action_plans
         SET review_comment = ?, grade = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [review_comment, grade || null, user.sub || '', user.name || '', id]
      );
      return res.json({ ok: true, id });
    }

    // ── POST (plan mode) — create or update own plan ─────────────────────────
    const { id, week_start, notes = '', action_items = [] } = body;
    if (!week_start) return res.status(400).json({ error: 'week_start is required' });

    const itemsJson = JSON.stringify(
      (Array.isArray(action_items) ? action_items : [])
        .filter(i => i && (i.title || '').trim())
        .map(i => ({
          title:    String(i.title).trim().slice(0, 300),
          priority: ['high', 'medium', 'low'].includes(i.priority) ? i.priority : 'medium',
          due_date: i.due_date || '',
          status:   i.status === 'done' ? 'done' : 'pending',
        }))
    );

    if (id) {
      // Owner can edit own plan; reviewers can tick items too
      const rows = await query('SELECT submitted_by FROM weekly_action_plans WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
      if (rows[0].submitted_by !== (user.sub || '') && !canReview) {
        return res.status(403).json({ error: 'You can only edit your own plan' });
      }
      await query(
        `UPDATE weekly_action_plans SET notes = ?, action_items = ? WHERE id = ?`,
        [notes, itemsJson, id]
      );
      return res.json({ ok: true, id });
    }

    const r = await query(
      `INSERT INTO weekly_action_plans
         (week_start, state, branch, submitted_by, submitted_by_name, submitted_role, notes, action_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notes = VALUES(notes), action_items = VALUES(action_items)`,
      [week_start, user.state || '', user.branch || '', user.sub || '', user.name || '', user.role || '', notes, itemsJson]
    );
    return res.json({ ok: true, id: r.insertId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
