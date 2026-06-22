/**
 * Shared helper — write admin activity logs (Settings tab actions).
 * Table is created on first write.
 */
const { query } = require('./mysql');

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      actor       VARCHAR(100) NOT NULL,
      actor_name  VARCHAR(255) DEFAULT '',
      action      VARCHAR(50)  NOT NULL,
      target      VARCHAR(255) DEFAULT '',
      details     TEXT         DEFAULT '',
      ip          VARCHAR(64)  DEFAULT '',
      logged_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_actor     (actor),
      INDEX idx_action    (action),
      INDEX idx_logged_at (logged_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableReady = true;
}

/**
 * @param {object} opts
 * @param {string} opts.actor      - username of the admin performing the action
 * @param {string} opts.actorName  - display name of the admin
 * @param {string} opts.action     - e.g. 'user_created', 'user_deleted', 'user_activated'
 * @param {string} [opts.target]   - affected resource (e.g. username of user changed)
 * @param {string} [opts.details]  - human-readable summary
 * @param {string} [opts.ip]       - request IP
 */
function writeActivityLog(opts) {
  ensureTable()
    .then(() => query(
      `INSERT INTO activity_logs (actor, actor_name, action, target, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        opts.actor     || '',
        opts.actorName || '',
        opts.action    || 'unknown',
        opts.target    || '',
        opts.details   || '',
        opts.ip        || '',
      ]
    ))
    .catch(e => console.error('[activity-log]', e.message));
}

module.exports = { writeActivityLog };
