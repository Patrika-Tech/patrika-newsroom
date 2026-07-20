/**
 * GET /api/hr/sanctioned-posts/template
 * Downloads an Excel template pre-filled with every State × Branch × Profile
 * combination found in the `user` table, with existing sanctioned_count filled in.
 */
const XLSX         = require('xlsx');
const { query }    = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const { authError } = requireRole(req, ['Admin', 'HR', 'Management']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  try {
    const [branches, profiles, existing] = await Promise.all([
      query(`SELECT DISTINCT State, Branch FROM \`user\`
             WHERE (is_emp_working = 1 OR Status IN ('Working','Active'))
               AND State IS NOT NULL AND State != ''
               AND Branch IS NOT NULL AND Branch != ''
             ORDER BY State, Branch`),
      query(`SELECT DISTINCT TRIM(Story_Type) AS profile FROM \`user\`
             WHERE Story_Type IS NOT NULL AND Story_Type != ''
             ORDER BY profile`),
      query('SELECT state, branch, profile, sanctioned_count, min_salary, max_salary FROM hr_sanctioned_posts').catch(() => []),
    ]);

    // Build a lookup: "STATE||BRANCH||PROFILE" → row
    const lookup = {};
    existing.forEach(r => {
      lookup[`${r.state}||${r.branch}||${r.profile}`] = r;
    });

    const rows = [];
    for (const b of branches) {
      for (const p of profiles) {
        const key = `${b.State}||${b.Branch}||${p.profile}`;
        const ex  = lookup[key] || {};
        rows.push({
          'State':           b.State,
          'Branch':          b.Branch,
          'Profile':         p.profile,
          'Department':      ex.department   || '',
          'Sanctioned Count': ex.sanctioned_count != null ? ex.sanctioned_count : '',
          'Min Salary':      ex.min_salary   || '',
          'Max Salary':      ex.max_salary   || '',
        });
      }
    }

    // Instructions sheet
    const instructions = [
      { Column: 'State',           Required: 'Yes', Notes: 'Must match exact state name (e.g. Rajasthan, MP, CG)' },
      { Column: 'Branch',          Required: 'Yes', Notes: 'Must match exact branch name as in system' },
      { Column: 'Profile',         Required: 'Yes', Notes: 'Story Type / designation (e.g. Reporter, Photographer)' },
      { Column: 'Department',      Required: 'No',  Notes: 'Optional department label' },
      { Column: 'Sanctioned Count',Required: 'Yes', Notes: 'Number of sanctioned posts for this State/Branch/Profile' },
      { Column: 'Min Salary',      Required: 'No',  Notes: 'Minimum salary (numeric, optional)' },
      { Column: 'Max Salary',      Required: 'No',  Notes: 'Maximum salary (numeric, optional)' },
    ];

    const wb = XLSX.utils.book_new();

    const wsData = XLSX.utils.json_to_sheet(rows);
    // Freeze header row
    wsData['!freeze'] = { xSplit: 0, ySplit: 1 };
    // Set column widths
    wsData['!cols'] = [
      { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, wsData, 'Sanctioned Posts');

    const wsInst = XLSX.utils.json_to_sheet(instructions);
    wsInst['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 55 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instructions');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sanctioned_posts_template.xlsx"');
    return res.send(buf);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
