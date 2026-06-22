/**
 * POST /api/users/sync
 *
 * Syncs login accounts from the HR employee table (`user`) into `users`.
 * Only employees with Story_Type IN ('State Head', 'RE') are included.
 *
 * Field mapping:
 *   name      ← EMPNAME
 *   username  ← pan_no           (PAN number — unique key)
 *   password  ← pan_no (hashed)  (only set on first creation; never overwritten)
 *   role      ← Story_Type       ('State Head' → 'State Head', 'RE' → 'Regional Editor')
 *   state     ← State
 *   branch    ← Branch
 *   is_active ← is_emp_working   (1 = active, 0/NULL = inactive)
 *
 * Behaviour:
 *   - New employee  → INSERT with password = bcrypt(pan_no)
 *   - Existing user → UPDATE name / role / state / branch / is_active only
 *                     (password is NEVER changed by sync)
 *
 * Admin only.
 */

const bcrypt    = require('bcryptjs');
const { query } = require('../_lib/mysql');
const { ensureColumn }           = require('../_lib/schema');
const { requireRole }            = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { writeActivityLog }       = require('../_lib/activity-log');

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

// Story_Type → users.role
const ROLE_MAP = {
  'State Head': 'State Head',
  'RE':         'Regional Editor',
};

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError, user: caller } = requireRole(req, ['Admin']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Ensure is_active column exists; remember whether we can use it
    const hasIsActive = await ensureColumn('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');

    // ── Pull eligible employees from HR table ─────────────────────────────
    let employees;
    try {
      employees = await query(
        `SELECT pan_no, EMPNAME, Story_Type, State, Branch,
                COALESCE(is_emp_working, 0) AS is_emp_working
         FROM \`user\`
         WHERE Story_Type IN ('State Head', 'RE')
           AND pan_no IS NOT NULL
           AND pan_no != ''
         ORDER BY EMPNAME`
      );
    } catch (hrErr) {
      // Provide a helpful error if the HR table doesn't exist or the column is missing
      console.error('[users/sync] HR table query failed:', hrErr.message);
      return res.status(500).json({
        error: `Could not read HR employee table: ${hrErr.message}. ` +
               `Check that the \`user\` table exists in database "${process.env.MYSQL_DATABASE || 'editorial_reports'}".`,
      });
    }

    if (!employees.length) {
      return res.json({
        ok: true, total: 0, created: 0, updated: 0, details: [],
        note: 'No employees found with Story_Type IN (\'State Head\', \'RE\') and a non-empty pan_no.',
      });
    }

    // ── Load existing usernames for fast lookup ───────────────────────────
    const existingRows = await query('SELECT id, username FROM users');
    const existingSet  = new Set(existingRows.map(r => r.username));

    let created = 0;
    let updated = 0;
    const details = [];

    for (const emp of employees) {
      const username  = String(emp.pan_no).trim();
      const name      = (emp.EMPNAME || username).trim();
      const role      = ROLE_MAP[emp.Story_Type] || 'Regional Editor';
      const state     = emp.State  || null;
      const branch    = emp.Branch || null;
      const is_active = emp.is_emp_working === 1 ? 1 : 0;

      if (existingSet.has(username)) {
        // ── Update — never touch password_hash ───────────────────────────
        if (hasIsActive) {
          await query(
            `UPDATE users
                SET name      = ?,
                    role      = ?,
                    state     = ?,
                    branch    = ?,
                    is_active = ?
              WHERE username  = ?`,
            [name, role, state, branch, is_active, username]
          );
        } else {
          await query(
            `UPDATE users
                SET name   = ?,
                    role   = ?,
                    state  = ?,
                    branch = ?
              WHERE username = ?`,
            [name, role, state, branch, username]
          );
        }
        updated++;
        details.push({ action: 'updated', username, name, role, state, branch, is_active });
      } else {
        // ── Create — initial password = PAN number ────────────────────────
        const password_hash = await bcrypt.hash(username, 10);
        if (hasIsActive) {
          await query(
            `INSERT INTO users (username, name, password_hash, role, state, branch, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, name, password_hash, role, state, branch, is_active]
          );
        } else {
          await query(
            `INSERT INTO users (username, name, password_hash, role, state, branch)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, name, password_hash, role, state, branch]
          );
        }
        existingSet.add(username); // prevent duplicates if pan_no repeated in HR
        created++;
        details.push({ action: 'created', username, name, role, state, branch, is_active });
      }
    }

    writeActivityLog({
      actor: caller.sub, actorName: caller.name || caller.sub,
      action: 'users_synced',
      target: '',
      details: `HR sync: ${created} created, ${updated} updated (${employees.length} total)`,
      ip: getIP(req),
    });
    return res.json({ ok: true, total: employees.length, created, updated, details });

  } catch (err) {
    console.error('[users/sync]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
