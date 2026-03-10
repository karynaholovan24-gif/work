const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// Функція для конвертації в київський час (+2 години)
// =====================================
function toKyivTime(utcTime) {
    const date = new Date(utcTime);
    
    // Отримуємо компоненти UTC
    let year = date.getUTCFullYear();
    let month = date.getUTCMonth() + 1;
    let day = date.getUTCDate();
    let hours = date.getUTCHours();
    let minutes = date.getUTCMinutes();
    let seconds = date.getUTCSeconds();
    
    // Додаємо 2 години (київський час взимку)
    hours += 2;
    
    // Якщо перейшли на наступний день
    if (hours >= 24) {
        hours -= 24;
        day += 1;
        
        // Перевіряємо чи не перейшли на наступний місяць
        if (month === 2) { // лютий
            const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
            const daysInMonth = isLeap ? 29 : 28;
            if (day > daysInMonth) {
                day = 1;
                month += 1;
            }
        } else if ([4, 6, 9, 11].includes(month)) { // місяці з 30 днями
            if (day > 30) {
                day = 1;
                month += 1;
            }
        } else if (day > 31) { // місяці з 31 днем
            day = 1;
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        }
    }
    
    // Форматуємо
    return `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year} ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

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

const db = new sqlite3.Database('./database.sqlite');

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
    db.get('SELECT COUNT(*) as count FROM tokens', [], (err, row) => {
        if (row && row.count === 0) {
            console.log('🔄 Додаю тестові токени...');
            const testTokens = ['test123', 'demo456', 'admin789', 'qr2024', 'work001'];
            
            testTokens.forEach(token => {
                db.run('INSERT INTO tokens (token) VALUES (?)', [token]);
                activeTokens.add(token);
            });
            
            console.log('✅ Тестові токени додано');
        }
    });
}, 1000);

// =====================================
// 5. Генерація токена
// =====================================
app.get('/api/generate-token', (req, res) => {
    const token = Math.random().toString(36).substring(2, 10);
    console.log('✅ Створено токен:', token);
    
    activeTokens.add(token);
    db.run('INSERT INTO tokens (token) VALUES (?)', [token]);
    
    res.json({ token });
});

// =====================================
// 6. Відмітка приходу
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee } = req.body;
    
    console.log('\n📝 Отримано token:', token);
    console.log('👤 Працівник:', employee);
    
    if (!token || !employee) {
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    if (activeTokens.has(token)) {
        console.log('✅ Токен знайдено!');
        
        activeTokens.delete(token);
        db.run('DELETE FROM tokens WHERE token = ?', [token]);
        db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', [employee, token]);
        
        res.json({ success: true, message: '✅ Прихід зафіксовано' });
    } else {
        console.log('❌ Токен не знайдено');
        res.json({ success: false, message: '❌ Токен не знайдено' });
    }
});

// =====================================
// 7. Перегляд токенів
// =====================================
app.get('/api/tokens', (req, res) => {
    db.all('SELECT * FROM tokens', [], (err, dbTokens) => {
        res.json({
            memory_tokens: Array.from(activeTokens),
            database_tokens: dbTokens || []
        });
    });
});

// =====================================
// 8. Перегляд відміток (З КИЇВСЬКИМ ЧАСОМ)
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        if (rows) {
            rows = rows.map(row => {
                return {
                    id: row.id,
                    employee: row.employee,
                    token: row.token,
                    time: toKyivTime(row.time)  // Конвертуємо час
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
    const now = new Date();
    res.json({
        memory_tokens: activeTokens.size,
        current_time: toKyivTime(now.toISOString())
    });
});

// =====================================
// 10. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    const now = new Date();
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Система обліку часу</title>
            <style>
                body { font-family: Arial; padding: 40px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
                .container { max-width: 800px; margin: 0 auto; background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; }
                h1 { margin-bottom: 20px; }
                ul { list-style: none; padding: 0; }
                li { margin: 15px 0; }
                a { color: white; text-decoration: none; padding: 10px 20px; background: rgba(255,255,255,0.2); border-radius: 8px; display: inline-block; }
                a:hover { background: rgba(255,255,255,0.3); }
                .info { margin-top: 20px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 8px; }
                .note { color: #ffaa00; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Система обліку часу</h1>
                <p>Сервер працює з <span class="note">київським часом (+2 години)</span></p>
                <div class="info">
                    <p>🕐 Поточний час: ${toKyivTime(now.toISOString())}</p>
                    <p class="note">⚠️ 30 березня 2026 потрібно змінити +2 на +3 (перехід на літній час)</p>
                    <p>🔹 Тестові токени: test123, demo456, admin789, qr2024, work001</p>
                </div>
                <ul>
                    <li><a href="/qr.html">📱 QR код для сканування</a></li>
                    <li><a href="/api/tokens">🔑 Перегляд всіх токенів</a></li>
                    <li><a href="/api/attendance">📊 Всі відмітки (київський час)</a></li>
                    <li><a href="/api/status">📈 Статус системи</a></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

// =====================================
// 11. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔑 Токени: https://work-ibj8.onrender.com/api/tokens`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance`);
    console.log(`🕐 Поточний час: ${toKyivTime(new Date().toISOString())}\n`);
});
