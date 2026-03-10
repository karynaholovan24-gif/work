const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// SQLite база даних
const db = new sqlite3.Database('./database.sqlite');

// Створюємо таблиці
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

// Генерація токена
app.get('/api/generate-token', (req, res) => {
    const token = Math.random().toString(36).substring(2, 10);
    console.log('✅ Створено токен:', token);
    
    db.run('INSERT INTO tokens (token) VALUES (?)', [token], (err) => {
        res.json({ token });
    });
});

// Відмітка приходу (МАКСИМАЛЬНО ПРОСТО)
app.post('/api/check-in', (req, res) => {
    const { token, employee } = req.body;
    
    console.log('\n🔍 Отримано token з QR:', token);
    console.log('👤 Працівник:', employee);
    
    // Просто перевіряємо чи є токен в базі
    db.get('SELECT token FROM tokens WHERE token = ?', [token], (err, row) => {
        if (row) {
            console.log('✅ Токен ЗНАЙДЕНО в базі!');
            db.run('DELETE FROM tokens WHERE token = ?', [token]);
            db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', [employee, token]);
            res.json({ success: true, message: '✅ Прихід зафіксовано' });
        } else {
            console.log('❌ Токен НЕ знайдено в базі');
            
            // Показуємо всі токени з бази
            db.all('SELECT token FROM tokens', [], (err, rows) => {
                console.log('📋 Токени в базі:', rows.map(r => r.token));
                res.json({ success: false, message: '❌ Токен не знайдено' });
            });
        }
    });
});

// Показати всі токени
app.get('/api/tokens', (req, res) => {
    db.all('SELECT * FROM tokens', [], (err, rows) => {
        res.json(rows);
    });
});

// Показати всі відмітки
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        res.json(rows);
    });
});

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

app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
});
