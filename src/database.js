import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        telegram_id BIGINT PRIMARY KEY,
        check_interval INT DEFAULT 10,
        is_running BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT DEFAULT 'ожидает',
        http_status INT,
        response_time INT,
        last_checked TIMESTAMP WITH TIME ZONE,
        last_error TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        CONSTRAINT unique_user_url UNIQUE (telegram_id, url)
      );

      CREATE TABLE IF NOT EXISTS check_history (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id) ON DELETE CASCADE,
        telegram_id BIGINT NOT NULL,
        status TEXT NOT NULL,
        http_status INT,
        response_time INT,
        checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('База данных успешно инициализирована :)');
  } finally {
    client.release();
  }
}

export async function ensureUser(telegramId) {
  await pool.query(
    `INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING`,
    [telegramId]
  );
  await pool.query(
    `INSERT INTO user_settings (telegram_id, check_interval, is_running) VALUES ($1, 10, FALSE) ON CONFLICT (telegram_id) DO NOTHING`,
    [telegramId]
  );
}

export async function getUserSettings(telegramId) {
  await ensureUser(telegramId);
  const res = await pool.query(`SELECT * FROM user_settings WHERE telegram_id = $1`, [telegramId]);
  return res.rows[0];
}

export async function updateUserSettings(telegramId, interval, isRunning) {
  await ensureUser(telegramId);
  const fields = [];
  const values = [telegramId];
  let idx = 2;

  if (interval !== undefined) {
    fields.push(`check_interval = $${idx++}`);
    values.push(interval);
  }
  if (isRunning !== undefined) {
    fields.push(`is_running = $${idx++}`);
    values.push(isRunning);
  }

  if (fields.length > 0) {
    await pool.query(
      `UPDATE user_settings SET ${fields.join(', ')} WHERE telegram_id = $1`,
      values
    );
  }
}

export async function addSite(telegramId, name, url) {
  await ensureUser(telegramId);
  const countRes = await pool.query(`SELECT COUNT(*) FROM sites WHERE telegram_id = $1`, [telegramId]);
  if (parseInt(countRes.rows[0].count, 10) >= 20) {
    throw new Error('Достигнут лимит в 20 сайтов для одного пользователя.');
  }

  const res = await pool.query(
    `INSERT INTO sites (telegram_id, name, url) VALUES ($1, $2, $3) RETURNING *`,
    [telegramId, name, url]
  );
  return res.rows[0];
}

export async function getSites(telegramId) {
  const res = await pool.query(`SELECT * FROM sites WHERE telegram_id = $1 ORDER BY id ASC`, [telegramId]);
  return res.rows;
}

export async function deleteSite(telegramId, siteId) {
  await pool.query(`DELETE FROM sites WHERE id = $1 AND telegram_id = $2`, [siteId, telegramId]);
}

export async function updateSiteStatus(siteId, status, httpStatus, responseTime, error = null) {
  const now = new Date();
  await pool.query(
    `UPDATE sites SET status = $1, http_status = $2, response_time = $3, last_checked = $4, last_error = $5 WHERE id = $6`,
    [status, httpStatus, responseTime, now, error, siteId]
  );

  const siteRes = await pool.query(`SELECT telegram_id FROM sites WHERE id = $1`, [siteId]);
  if (siteRes.rows.length > 0) {
    const telegramId = siteRes.rows[0].telegram_id;
    await pool.query(
      `INSERT INTO check_history (site_id, telegram_id, status, http_status, response_time, checked_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [siteId, telegramId, status, httpStatus, responseTime, now]
    );
  }
}

export async function getSiteStats(telegramId) {
  const sitesRes = await pool.query(`SELECT COUNT(*) as total FROM sites WHERE telegram_id = $1`, [telegramId]);
  const activeRes = await pool.query(`SELECT COUNT(*) as active FROM sites WHERE telegram_id = $1 AND is_active = TRUE`, [telegramId]);
  
  const historyRes = await pool.query(
    `SELECT 
       COUNT(*) as total_checks,
       SUM(CASE WHEN status = 'доступен' THEN 1 ELSE 0 END) as successful,
       AVG(response_time) as avg_time
     FROM check_history WHERE telegram_id = $1`,
    [telegramId]
  );

  const row = historyRes.rows[0];
  const totalChecks = parseInt(row.total_checks || 0, 10);
  const successful = parseInt(row.successful || 0, 10);
  const uptimePercent = totalChecks > 0 ? ((successful / totalChecks) * 100).toFixed(1) : 100;

  return {
    totalSites: parseInt(sitesRes.rows[0].total, 10),
    activeSites: parseInt(activeRes.rows[0].active, 10),
    totalChecks,
    successfulChecks: successful,
    failedChecks: totalChecks - successful,
    avgResponseTime: Math.round(row.avg_time || 0),
    uptimePercent
  };
}
