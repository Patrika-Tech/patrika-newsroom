/**
 * POST /api/ai/assistant
 * Text-to-SQL newsroom assistant backed by GPT-4o-mini.
 * Generates a SELECT query, executes it safely, then narrates the result.
 */
const { getUser }    = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');
const { query }      = require('../_lib/mysql');

const toIST = ms => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

const SCHEMA = () => `
MySQL 8.0 database (editorial_reports). Tables:
- daily_achievment_count_ecms(Pan_no VARCHAR, entrydate DATE, No_Story INT, No_Photo INT, No_Words INT, Exclusive INT)
  → reporter daily production. Join on Pan_no = user.pan_no
- user(pan_no VARCHAR, EMPNAME VARCHAR, EMP_CODE VARCHAR, Branch VARCHAR, State VARCHAR, Story_Type VARCHAR, Status VARCHAR, is_emp_working TINYINT)
  → active reporters: is_emp_working=1 OR Status='Working' OR Status='Active'
- qc_review(id INT, entrydate DATE, no_of_mistake INT, state VARCHAR, branch VARCHAR)
  → quality check mistakes
- visit_report(id INT, pan_no VARCHAR, visit_date DATE, remark VARCHAR)
  → reporter field visits
- legal_cases(id INT, title VARCHAR, state VARCHAR, branch VARCHAR, status VARCHAR, created_at DATETIME)
  → active cases: status='Active'
- alerts(id INT, message TEXT, is_read TINYINT, created_at DATETIME)

Current IST dates — today: ${toIST(Date.now())} | yesterday: ${toIST(Date.now() - 864e5)} | 7 days ago: ${toIST(Date.now() - 7 * 864e5)}
Rules: Use range comparisons (col >= 'YYYY-MM-DD' AND col < 'YYYY-MM-DD') for indexed date columns. Always add LIMIT 20. SELECT only.
`;

const DANGEROUS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|CALL|GRANT|REVOKE)\b/i;

function isSafeSQL(sql) {
  const s = (sql || '').trim();
  return s.toUpperCase().startsWith('SELECT') && !DANGEROUS.test(s);
}

const DEFAULT_CHIPS = [
  'Kal sabse zyada stories kisne file ki?',
  'Is hafte kaunsi state mein QC mistakes zyada hue?',
  'Reporters with zero stories yesterday',
  'Top 5 reporters last 7 days',
  'Field visits count this week',
  'Most active branch this month',
];

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { q } = req.body || {};
  if (!q || !q.trim()) return res.status(400).json({ error: 'Missing query' });

  if (!process.env.OPENAI_API_KEY) {
    return res.json({
      answer:      'AI assistant is not configured. Please add OPENAI_API_KEY to .env to enable this feature.',
      suggestions: DEFAULT_CHIPS,
    });
  }

  try {
    const fetch = require('node-fetch');

    // ── Step 1: Generate SQL ──────────────────────────────────────────────────
    const sqlRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        temperature: 0,
        max_tokens:  300,
        messages: [
          {
            role:    'system',
            content: `You are a MySQL query generator. Schema:\n${SCHEMA()}\nReturn ONLY valid SQL — no markdown, no explanation. Must start with SELECT. Must include LIMIT 20.`,
          },
          { role: 'user', content: q },
        ],
      }),
    });

    let sql = '';
    if (sqlRes.ok) {
      const d = await sqlRes.json();
      sql = (d.choices?.[0]?.message?.content || '').trim()
        .replace(/^```sql\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    }

    // ── Step 2: Execute safely ────────────────────────────────────────────────
    let rows     = [];
    let sqlError = null;
    if (sql && isSafeSQL(sql)) {
      try {
        const withLimit = /LIMIT\s+\d+/i.test(sql) ? sql : sql + ' LIMIT 20';
        rows = await query(withLimit);
      } catch (e) {
        sqlError = e.message;
      }
    }

    // ── Step 3: Narrate ───────────────────────────────────────────────────────
    const dataCtx = sqlError
      ? `SQL execution error: ${sqlError}`
      : rows.length
        ? `Query returned ${rows.length} rows: ${JSON.stringify(rows.slice(0, 15))}`
        : 'Query returned no rows — no matching data found.';

    const ansRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'gpt-4o-mini',
        max_tokens: 220,
        messages: [
          {
            role:    'system',
            content: 'You are a bilingual (Hindi-English) newsroom analyst for Patrika newspaper. Answer in 2–4 concise sentences mixing Hindi and English naturally. Cite specific numbers from the data. If no data, say so clearly.',
          },
          {
            role:    'user',
            content: `Question: ${q}\n\nData: ${dataCtx}`,
          },
        ],
      }),
    });

    let answer = 'Kuch galat hua. Please dobara try karein.';
    if (ansRes.ok) {
      const d = await ansRes.json();
      answer  = d.choices?.[0]?.message?.content?.trim() || answer;
    }

    return res.json({
      answer,
      suggestions: DEFAULT_CHIPS.slice(0, 4),
    });

  } catch (err) {
    console.error('[ai/assistant]', err.message);
    return res.json({
      answer:      `Error: ${err.message}`,
      suggestions: DEFAULT_CHIPS,
    });
  }
};
