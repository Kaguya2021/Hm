import { Bot, InlineKeyboard } from 'grammY';
import { 
  getUserSettings, 
  updateUserSettings, 
  addSite, 
  getSites, 
  deleteSite, 
  getSiteStats 
} from './database.js';
import { validateAndSanitizeUrl } from './security.js';
import { startUserScheduler, stopUserScheduler } from './scheduler.js';
import { formatDate, extractDomain } from './utils.js';

const userStates = new Map();

export function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error('BOT_TOKEN не задан в переменных окружения!');
  }

  const bot = new Bot(token);

  const mainMenuKeyboard = new InlineKeyboard()
    .text('🌐 Мои сайты', 'menu_sites').text('➕ Добавить сайт', 'menu_add_site').row()
    .text('⏱ Настроить интервал', 'menu_interval').text('▶️ Запустить', 'menu_start').row()
    .text('⏸ Остановить', 'menu_stop').text('📊 Статистика', 'menu_stats').row()
    .text('⚙️ Настройки', 'menu_settings').text('❓ Помощь', 'menu_help');

  bot.command('start', async (ctx) => {
    userStates.delete(ctx.from.id);
    const text = '🚀 **Render Ping Bot**\n\nДобро пожаловать! Здесь ты можешь добавлять свои сайты, настраивать интервалы проверки и следить за их доступностью прямо в Telegram.\n\nВыбери нужное действие ниже 👇';
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '❓ **Помощь по использованию бота**\n\n' +
      '1. **Добавить сайт**: отправь валидный URL (начинающийся с https:// или http://).\n' +
      '2. **Интервал**: выбери период автоматической проверки (рекомендуется 10-15 минут для Render).\n' +
      '3. **Запустить проверки**: бот начнет периодически пинговать твои сайты и уведомит при смене статуса.\n\n' +
      'Используй кнопки ниже для навигации :)',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard }
    );
  });

  bot.command('cancel', async (ctx) => {
    userStates.delete(ctx.from.id);
    await ctx.reply('Действие отменено.', { reply_markup: mainMenuKeyboard });
  });

  bot.callbackQuery('menu_main', async (ctx) => {
    userStates.delete(ctx.from.id);
    await ctx.editMessageText('🚀 **Главное меню**\n\nВыбери нужное действие ниже 👇', {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_sites', async (ctx) => {
    const sites = await getSites(ctx.from.id);
    if (sites.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('➕ Добавить сайт', 'menu_add_site').row()
        .text('« Назад', 'menu_main');
      await ctx.editMessageText('🌐 **Мои сайты**\n\nУ тебя пока нет добавленных сайтов.', {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      return;
    }

    let text = '🌐 **Твои сайты:**\n\n';
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const emoji = s.status === 'доступен' ? '🟢' : s.status === 'ошибка' ? '🔴' : '🟡';
      text += `${i + 1}. ${emoji} **${s.name}**\n   🔗 \`${s.url}\`\n   📡 HTTP: ${s.http_status || 'Н/Д'} | ⚡ ${s.response_time || 0} мс\n\n`;
      keyboard.text(`🗑 Удалить #${i + 1}`, `del_site_${s.id}`).row();
    }
    keyboard.text('➕ Добавить ещё', 'menu_add_site').row().text('« Назад', 'menu_main');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^del_site_(\d+)$/, async (ctx) => {
    const siteId = parseInt(ctx.match[1], 10);
    await deleteSite(ctx.from.id, siteId);
    await ctx.answerCallbackQuery('Сайт успешно удален!');
    
    // Перенаправляем обратно в список сайтов
    const sites = await getSites(ctx.from.id);
    if (sites.length === 0) {
      const kb = new InlineKeyboard().text('➕ Добавить сайт', 'menu_add_site').row().text('« Назад', 'menu_main');
      await ctx.editMessageText('🌐 **Мои сайты**\n\nСписок сайтов пуст.', { parse_mode: 'Markdown', reply_markup: kb });
      return;
    }

    let text = '🌐 **Твои сайты:**\n\n';
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const emoji = s.status === 'доступен' ? '🟢' : s.status === 'ошибка' ? '🔴' : '🟡';
      text += `${i + 1}. ${emoji} **${s.name}**\n   🔗 \`${s.url}\`\n\n`;
      keyboard.text(`🗑 Удалить #${i + 1}`, `del_site_${s.id}`).row();
    }
    keyboard.text('➕ Добавить ещё', 'menu_add_site').row().text('« Назад', 'menu_main');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery('menu_add_site', async (ctx) => {
    userStates.set(ctx.from.id, 'waiting_for_url');
    const keyboard = new InlineKeyboard().text('« Отмена', 'menu_main');
    await ctx.editMessageText(
      '➕ **Добавление сайта**\n\nОтправь мне URL сайта в чат (например: `https://my-project.onrender.com`):\n\n*Требования*: только HTTP/HTTPS, без локальных адресов.',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_interval', async (ctx) => {
    const settings = await getUserSettings(ctx.from.id);
    const keyboard = new InlineKeyboard()
      .text('⚡ 1 мин', 'set_int_1').text('5 мин', 'set_int_5').text('10 мин (рек.)', 'set_int_10').row()
      .text('15 мин', 'set_int_15').text('20 мин', 'set_int_20').text('30 мин', 'set_int_30').row()
      .text('45 мин', 'set_int_45').text('60 мин', 'set_int_60').row()
      .text('« Назад', 'menu_main');

    await ctx.editMessageText(
      `⏱ **Настройка интервала**\n\nТекущий интервал: **${settings.check_interval} минут**.\n\n*Примечание*: Для бесплатных сервисов Render рекомендуется интервал 10–15 минут для предотвращения засыпания сервера без избыточной нагрузки.\n\nВыбери новый интервал:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^set_int_(\d+)$/, async (ctx) => {
    const minutes = parseInt(ctx.match[1], 10);
    const settings = await getUserSettings(ctx.from.id);
    await updateUserSettings(ctx.from.id, minutes, undefined);

    if (settings.is_running) {
      startUserScheduler(ctx.from.id, minutes, bot);
    }

    const sites = await getSites(ctx.from.id);
    const keyboard = new InlineKeyboard().text('« В главное меню', 'menu_main');
    await ctx.editMessageText(
      `✅ **Интервал изменён!**\n\n⏱ Интервал: **${minutes} минут**\n🌐 Сайтов: **${sites.length}**\n📊 Проверки выполняются автоматически: **${settings.is_running ? 'ВКЛ' : 'ВЫКЛ'}**`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_start', async (ctx) => {
    const settings = await getUserSettings(ctx.from.id);
    const sites = await getSites(ctx.from.id);

    if (sites.length === 0) {
      await ctx.answerCallbackQuery('Сначала добавь хотя бы один сайт!');
      return;
    }

    await updateUserSettings(ctx.from.id, undefined, true);
    startUserScheduler(ctx.from.id, settings.check_interval, bot);

    const keyboard = new InlineKeyboard().text('« В главное меню', 'menu_main');
    await ctx.editMessageText(
      `▶️ **Проверки запущены!**\n\n⏱ Интервал: **${settings.check_interval} мин**\n🌐 Активных сайтов: **${sites.length}**\n\nБот начал автоматический мониторинг :)`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_stop', async (ctx) => {
    await updateUserSettings(ctx.from.id, undefined, false);
    stopUserScheduler(ctx.from.id);

    const keyboard = new InlineKeyboard().text('« В главное меню', 'menu_main');
    await ctx.editMessageText(
      '⏸ **Проверки остановлены.**\n\nАвтоматический мониторинг выключен. Сайты и настройки сохранены.',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_stats', async (ctx) => {
    const stats = await getSiteStats(ctx.from.id);
    const settings = await getUserSettings(ctx.from.id);

    const keyboard = new InlineKeyboard()
      .text('🔄 Обновить', 'menu_stats').row()
      .text('« Назад', 'menu_main');

    await ctx.editMessageText(
      `📊 **Статистика мониторинга**\n\n` +
      `🌐 Всего сайтов: **${stats.totalSites}** (активных: ${stats.activeSites})\n` +
      `▶️ Статус мониторинга: **${settings.is_running ? 'Работает 🟢' : 'Остановлен ⏸'}**\n` +
      `⏱ Интервал проверок: **${settings.check_interval} мин**\n\n` +
      `📈 Всего проверок: **${stats.totalChecks}**\n` +
      `✅ Успешных: **${stats.successfulChecks}**\n` +
      `❌ Ошибок: **${stats.failedChecks}**\n` +
      `⚡ Среднее время ответа: **${stats.avgResponseTime} мс**\n` +
      `🏆 Общий Uptime: **${stats.uptimePercent}%**`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_settings', async (ctx) => {
    const settings = await getUserSettings(ctx.from.id);
    const keyboard = new InlineKeyboard().text('« Назад', 'menu_main');
    await ctx.editMessageText(
      `⚙️ **Настройки аккаунта**\n\n🆔 Telegram ID: \`${ctx.from.id}\`\n⏱ Интервал: **${settings.check_interval} мин**\n▶️ Автопроверки: **${settings.is_running ? 'Включены' : 'Выключены'}**`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('menu_help', async (ctx) => {
    const keyboard = new InlineKeyboard().text('« Назад', 'menu_main');
    await ctx.editMessageText(
      '❓ **Помощь**\n\nRender Ping Bot создан для мониторинга доступности веб-приложений и предотвращения их засыпания на бесплатных тарифах.\n\nИспользуй кнопки меню для управления.',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);

    if (state === 'waiting_for_url') {
      const rawUrl = ctx.message.text.trim();
      try {
        const sanitizedUrl = await validateAndSanitizeUrl(rawUrl);
        const name = extractDomain(sanitizedUrl);

        const newSite = await addSite(userId, name, sanitizedUrl);
        userStates.delete(userId);

        const keyboard = new InlineKeyboard()
          .text('🌐 Мои сайты', 'menu_sites')
          .text('« В главное меню', 'menu_main');

        await ctx.reply(
          `✅ **Сайт успешно добавлен!**\n\n🌐 Адрес: \`${newSite.url}\`\n📌 Название: \`${newSite.name}\`\n📍 Статус: ожидает запуска проверки`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
      } catch (err) {
        await ctx.reply(`❌ Ошибка: ${err.message}\n\nПопробуй отправить другой URL или нажми /cancel.`);
      }
    }
  });

  return bot;
}
