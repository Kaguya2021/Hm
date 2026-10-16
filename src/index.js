import 'dotenv/config';
import express from 'express';
import { initDatabase } from './database.js';
import { createBot } from './bot.js';
import { initScheduler } from './scheduler.js';

async function main() {
  console.log('Инициализация базы данных...');
  await initDatabase();

  // 1. Поднимаем HTTP-сервер для Render Web Service (обязательно для порта)
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.get('/', (req, res) => {
    res.status(200).send('Render Ping Bot is active and running! :)');
  });

  app.listen(PORT, () => {
    console.log(`HTTP сервер успешно запущен на порту ${PORT}`);
  });

  // 2. Запускаем Telegram-бота и фоновый планировщик проверок
  const bot = createBot();
  initScheduler(bot);

  bot.catch((err) => {
    console.error('Ошибка в боте grammY:', err);
  });

  await bot.start();
  console.log('Telegram бот успешно запущен и принимает сообщения :)');
}

main().catch((err) => {
  console.error('Критическая ошибка при запуске:', err);
  process.exit(1);
});
