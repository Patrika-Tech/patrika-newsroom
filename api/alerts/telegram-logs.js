const { query }   = require('../_lib/mysql');
const { getUser } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit = Math.min(100, Math.max(10, parseInt(req.query.limit || '50', 10)));
  const offset = (page - 1) * limit;

  try {
    const [[{ total }], logs] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM telegram_logs'),
      query(
        `SELECT
           tl.id,
           tl.alert_id,
           tl.message,
           tl.chat_id,
           tl.status,
           DATE_FORMAT(CONVERT_TZ(tl.created_at, '+00:00', '+05:30'), '%d %b %Y %H:%i') AS sent_at,
           u.EMPNAME            AS recipient_name,
           u.Branch             AS recipient_branch,
           u.State              AS recipient_state,
           u.emp_designation    AS recipient_role
         FROM telegram_logs tl
         LEFT JOIN \`user\` u ON u.telegram_chat_id = tl.chat_id
         ORDER BY tl.id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
    ]);

    const rows = logs.map(r => {
      // Strip HTML tags for preview
      const plain = (r.message || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      // Detect message type from content
      let type = 'Auto';
      if (r.alert_id)                                   type = 'Manual Alert';
      else if (/Custom Alert/i.test(r.message))         type = 'Custom';
      else if (/Page Delay Report/i.test(r.message))    type = 'Delay Report';
      else if (/Weekly Top|Top Delay/i.test(r.message)) type = 'Top Delay';
      else if (/Appreciation|सराहना/i.test(r.message))  type = 'Appreciation';
      else if (/Due.?date|deadline/i.test(r.message))   type = 'Due Date';
      else if (/Payment.*pending/i.test(r.message))     type = 'Payment Alert';
      else if (/Home.*Office|Visit/i.test(r.message))   type = 'Visit Alert';
      else if (/Weekly.*Plan|Plan.*Review/i.test(r.message)) type = 'Weekly Plan';

      return {
        id:               r.id,
        alert_id:         r.alert_id,
        type,
        preview:          plain.slice(0, 140),
        full_message:     r.message,
        chat_id:          r.chat_id,
        status:           r.status,
        sent_at:          r.sent_at,
        recipient_name:   r.recipient_name   || null,
        recipient_branch: r.recipient_branch || null,
        recipient_state:  r.recipient_state  || null,
        recipient_role:   r.recipient_role   || null,
      };
    });

    return res.status(200).json({ logs: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[telegram-logs]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
