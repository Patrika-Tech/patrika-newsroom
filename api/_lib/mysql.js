/**
 * MySQL connection pool for Vercel serverless functions.
 *
 * Required environment variables (set in Vercel dashboard):
 *   MYSQL_HOST      — e.g. 192.168.1.10 or db.yourdomain.com
 *   MYSQL_PORT      — default 3306
 *   MYSQL_USER      — database username
 *   MYSQL_PASSWORD  — database password
 *   MYSQL_DATABASE  — database name (e.g. editorial_reports)
 *
 * Optional:
 *   MYSQL_TABLE_EMPLOYEES — table name, default "user"
 *   MYSQL_SSL           — set to "true" if your host requires SSL
 */

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (pool) return pool;

  const sslOpt = process.env.MYSQL_SSL === 'true'
    ? { rejectUnauthorized: false }   // most shared hosts use self-signed certs
    : false;

  pool = mysql.createPool({
    host:               process.env.MYSQL_HOST     || 'localhost',
    port:        Number(process.env.MYSQL_PORT     || 3306),
    user:               process.env.MYSQL_USER     || 'root',
    password:           process.env.MYSQL_PASSWORD || '',
    database:           process.env.MYSQL_DATABASE || 'editorial_reports',
    ssl:                sslOpt,
    waitForConnections: true,
    connectionLimit:    5,       // keep low for serverless
    queueLimit:         0,
    timezone:           'Z',      // RDS stores UTC via NOW(); frontend formats to IST
  });

  return pool;
}

/**
 * Run a parameterised query and return all rows.
 * @param {string} sql
 * @param {any[]}  params
 * @returns {Promise<any[]>}
 */
async function query(sql, params = []) {
  const db = getPool();
  const [rows] = await db.execute(sql, params);
  return rows;
}

module.exports = { query, getPool };
