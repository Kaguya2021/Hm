import { pool, getSites, updateSiteStatus } from './database.js';
import { checkSite } from './monitor.js';

const activeTimers = new Map();

export function initScheduler(bot) {
  restoreAllSchedulers(bot).catch(err => console.error('Ошибка восстановления расписания:', err));
}

async function restoreAllSchedulers(bot) {
  const res = await pool.query(`SELECT telegram_id, check_interval FROM user_settings WHERE is_running = TRUE`);
  for (const row of res.rows) {
    startUserScheduler(row.telegram_id, row.check_interval, bot);
  }
  console.log(`Восстановлено активных задач мониторинга: ${res.rows.length} :)`);
}

export function startUserScheduler(telegramId, intervalMinutes, bot) {
  stopUserScheduler(telegramId);

  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

  const timer = setInterval(async () => {
    try {
      const sites = await getSites(telegramId);
      for (const site of sites) {
        if (!site.is_active) continue;

        const oldStatus = site.status;
        const result = await checkSite(site.url);

        await updateSiteStatus(
          site.id,
          result.status,
          result.httpStatus,
          result.responseTime,
          result.error
        );

        if (oldStatus !== result.status && oldStatus !== 'ожидает') {
          const emoji = result.success ? '🟢' : '🔴';
          const message = `${emoji} **Изменение статуса сайта!**\n\n📍 Сайт: \`${site.name}\` (\`${site.url}\`)\n📊 Статус: **${result.status}**\n📡 HTTP: ${result.httpStatus || 'Н/Д'}\n⚡ Ответ: ${result.responseTime} мс\n${result.error ? `⚠️ Ошибка: ${result.error}` : ''}`;
          
          try {
            await bot.api.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
          } catch (e) {
            console.error(`Не удалось отправить уведомление пользователю ${telegramId}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error(`Ошибка в планировщике для пользователя ${telegramId}:`, e);
    }
  }, intervalMs);

  activeTimers.set(telegramId, timer);
}

export function stopUserScheduler(telegramId) {
  if (activeTimers.has(telegramId)) {
    clearInterval(activeTimers.get(telegramId));
    activeTimers.delete(telegramId);
  }
}
