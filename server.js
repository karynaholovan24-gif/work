const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
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
// 6. Відмітка приходу (Токени знаходяться!)
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee } = req.body;
    
    console.log('\n📝 Отримано token:', token);
    console.log('👤 Працівник:', employee);
    
    if (!token || !employee) {
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // Спочатку перевіряємо в пам'яті
    if (activeTokens.has(token)) {
        console.log('✅ Токен знайдено в пам\'яті!');
        
        activeTokens.delete(token);
        db.run('DELETE FROM tokens WHERE token = ?', [token]);
        db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', [employee, token]);
        
        return res.json({ success: true, message: '✅ Прихід зафіксовано' });
    }
    
    // Якщо нема в пам'яті, перевіряємо в базі
    db.get('SELECT token FROM tokens WHERE token = ?', [token], (err, row) => {
        if (row) {
            console.log('✅ Токен знайдено в базі даних!');
            
            db.run('DELETE FROM tokens WHERE token = ?', [token]);
            db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', [employee, token]);
            
            res.json({ success: true, message: '✅ Прихід зафіксовано' });
        } else {
            console.log('❌ Токен не знайдено ніде');
            res.json({ success: false, message: '❌ Токен не знайдено' });
        }
    });
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
// 8. Перегляд відміток (оригінальний час)
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        res.json(rows || []);
    });
});

// =====================================
// 9. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    res.send(`
        <h1>Система обліку часу</h1>
        <ul>
            <li><a href="/qr.html">📱 QR код</a></li>
            <li><a href="/api/tokens">🔑 Токени</a></li>
            <li><a href="/api/attendance">📊 Відмітки</a></li>
        </ul>
    `);
});

// =====================================
// 10. Запуск
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔑 Токени: https://work-ibj8.onrender.com/api/tokens`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance\n`);
});
