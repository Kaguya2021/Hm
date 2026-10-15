const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Главная страница сайта (чтобы Render понимал, что сервис живой)
app.get('/', (req, res) => {
    res.send('Бот и пинговалка работают :)');
});

// Запускаем веб-сервер
app.listen(PORT, () => {
    console.log(`Сервер успешно запущен на порту ${PORT} :)`);
    startSelfPing();
});

// Логика самопинга
const APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://project-whabot-jnvo.onrender.com';
const INTERVAL_MS = 10 * 60 * 1000; // 10 минут

function startSelfPing() {
    setInterval(() => {
        https.get(APP_URL, (res) => {
            console.log(`Самопинг отправлен на ${APP_URL}. Статус: ${res.statusCode} :)`);
        }).on('error', (err) => {
            console.error(`Ошибка самопинга: ${err.message}`);
        });
    }, INTERVAL_MS);
}
