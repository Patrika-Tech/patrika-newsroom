/**
 * GET /api/telegram/bot-info
 * Returns bot username + registration stats for the config modal.
 */
const { getUser }  = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { query }    = require('../_lib/mysql');
const { getInfo }  = require('./poller');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const info = getInfo();

  // Count configured recipients
  const [configuredRows] = await query(
    `SELECT COUNT(*) AS cnt FROM \`user\`
     WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
       AND (is_emp_working = 1 OR Status IN ('Working','Active'))`
  ).catch(() => [{ cnt: 0 }]);

  return res.json({
    configured:  true,
    username:    info?.username    || process.env.TELEGRAM_BOT_USERNAME || null,
    first_name:  info?.first_name  || 'Patrika Bot',
    bot_link:    info?.username    ? `https://t.me/${info.username}` : null,
    configured_count: Number(configuredRows?.cnt || 0),
  });
};
