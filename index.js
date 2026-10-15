const https = require('https');

// Берет URL автоматически из Render, либо использует ваш указанный
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

startSelfPing();
