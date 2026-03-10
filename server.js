const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();

// =====================================
// Функція київського часу
// =====================================
function kyivTime(date = new Date()) {
    return dayjs(date)
        .tz("Europe/Kyiv")
        .format("DD.MM.YYYY HH:mm:ss");
}

console.log('🕐 Поточний час:', kyivTime());

const PORT = process.env.PORT || 3000;

// =====================================
// Тимчасове сховище токенів
// =====================================
const activeTokens = new Set();

// =====================================
// 1. Middleware
// =====================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, '..')));

// =====================================
// 2. Підключення до SQLite
// =====================================
console.log('🔄 Створюємо базу даних SQLite...');
console.log('📁 Поточна папка:', __dirname);

try {
    fs.accessSync(__dirname, fs.constants.W_OK);
    console.log('✅ Права на запис є');
} catch (err) {
    console.error('❌ Немає прав на запис:', err);
}

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Помилка відкриття БД:', err);
    } else {
        console.log('✅ База даних SQLite відкрита/створена');
    }
});

// =====================================
// 3. Створюємо таблиці
// =====================================
db.serialize(() => {

    db.run(`DROP TABLE IF EXISTS tokens`);
    db.run(`DROP TABLE IF EXISTS attendance`);

    db.run(`CREATE TABLE tokens (
        token TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee TEXT,
        token TEXT,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

});

// =====================================
// 4. Додаємо тестові токени
// =====================================
setTimeout(() => {

    db.serialize(() => {

        db.get('SELECT COUNT(*) as count FROM tokens', [], (err, row) => {

            if (row.count === 0) {

                const testTokens = ['test123', 'demo456', 'admin789', 'qr2024', 'work001'];

                testTokens.forEach(token => {

                    db.run('INSERT INTO tokens (token) VALUES (?)', [token]);

                    activeTokens.add(token);

                });

            }

            db.all('SELECT token FROM tokens', [], (err, rows) => {

                if (rows) {

                    rows.forEach(r => activeTokens.add(r.token));

                }

            });

        });

    });

}, 1000);

// =====================================
// 5. Генерація токена
// =====================================
app.get('/api/generate-token', (req, res) => {

    const token = Math.random().toString(36).substring(2, 10);

    console.log('✅ Створено токен:', token);
    console.log('🕐 Час створення:', kyivTime());

    activeTokens.add(token);

    db.run('INSERT INTO tokens (token) VALUES (?)', [token]);

    res.json({ token });

});

// =====================================
// 6. Відмітка приходу
// =====================================
app.post('/api/check-in', (req, res) => {

    const { token, employee, latitude, longitude } = req.body;

    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('🔍 Token:', token);
    console.log('👤 Працівник:', employee);
    console.log('📍 Координати:', latitude, longitude);
    console.log('🕐 Час:', kyivTime());

    if (!token || !employee) {
        return res.json({ success: false, message: '❌ Немає даних' });
    }

    if (activeTokens.has(token)) {

        activeTokens.delete(token);

        db.run('DELETE FROM tokens WHERE token = ?', [token]);

        db.run(
            'INSERT INTO attendance (employee, token) VALUES (?, ?)',
            [employee, token],
            function(err) {

                if (err) {
                    res.json({ success: false, message: '❌ Помилка запису' });
                } else {
                    res.json({ success: true, message: '✅ Прихід зафіксовано' });
                }

            }
        );

        return;

    }

    res.json({ success: false, message: '❌ Токен недійсний' });

});

// =====================================
// 7. Перегляд токенів
// =====================================
app.get('/api/tokens', (req, res) => {

    db.all('SELECT * FROM tokens ORDER BY created_at DESC', [], (err, dbTokens) => {

        res.json({
            memory_tokens: Array.from(activeTokens),
            database_tokens: dbTokens || []
        });

    });

});

// =====================================
// 8. Перегляд відміток
// =====================================
app.get('/api/attendance', (req, res) => {

    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {

        if (rows) {

            rows = rows.map(row => {

                return {
                    id: row.id,
                    employee: row.employee,
                    token: row.token,
                    time: kyivTime(row.time)
                };

            });

        }

        res.json(rows || []);

    });

});

// =====================================
// 9. Статус
// =====================================
app.get('/api/status', (req, res) => {

    db.get('SELECT COUNT(*) as count FROM tokens', [], (err, tokenRow) => {

        db.get('SELECT COUNT(*) as count FROM attendance', [], (err, attRow) => {

            res.json({

                memory_tokens: activeTokens.size,
                database_tokens: tokenRow?.count || 0,
                attendance: attRow?.count || 0,
                current_time: kyivTime()

            });

        });

    });

});

// =====================================
// 10. Очистити токени
// =====================================
app.get('/api/clear', (req, res) => {

    activeTokens.clear();

    db.run('DELETE FROM tokens', [], () => {

        res.json({ success: true, message: '✅ Всі токени видалено' });

    });

});

// =====================================
// 11. Reset
// =====================================
app.get('/api/reset', (req, res) => {

    activeTokens.clear();

    db.run('DELETE FROM tokens', [], () => {

        res.json({ success: true, message: '✅ Базу очищено' });

    });

});

// =====================================
// 12. Головна сторінка
// =====================================
app.get('/', (req, res) => {

    res.send(`

        <html>

        <head>

        <title>Система обліку часу</title>

        </head>

        <body>

        <h1>Система обліку часу</h1>

        <p>🕐 Поточний час: ${kyivTime()}</p>

        <a href="/qr.html">QR</a><br>
        <a href="/api/tokens">Tokens</a><br>
        <a href="/api/attendance">Attendance</a><br>
        <a href="/api/status">Status</a>

        </body>

        </html>

    `);

});

// =====================================
// 13. Запуск сервера
// =====================================
app.listen(PORT, () => {

    console.log(`🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);

});
