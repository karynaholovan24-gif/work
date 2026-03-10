const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Перевіряємо права на запис
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
    // Видаляємо старі таблиці
    db.run(`DROP TABLE IF EXISTS tokens`);
    db.run(`DROP TABLE IF EXISTS attendance`);

    // Створюємо таблицю tokens
    db.run(`CREATE TABLE tokens (
        token TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (err) {
            console.error('❌ Помилка створення tokens:', err);
        } else {
            console.log('✅ Таблиця tokens створена');
        }
    });

    // Створюємо таблицю attendance
    db.run(`CREATE TABLE attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee TEXT,
        token TEXT,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (err) {
            console.error('❌ Помилка створення attendance:', err);
        } else {
            console.log('✅ Таблиця attendance створена');
        }
    });
});

// =====================================
// 4. Генерація токена
// =====================================
app.get('/api/generate-token', (req, res) => {
    const token = Math.random().toString(36).substring(2, 10);
    console.log('✅ Створено токен:', token);

    db.run('INSERT INTO tokens (token) VALUES (?)', [token], (err) => {
        if (err) {
            console.error('❌ Помилка збереження токена:', err);
            return res.status(500).json({ error: 'Помилка сервера' });
        }
        res.json({ token });
    });
});

// =====================================
// 5. Відмітка приходу (З ДІАГНОСТИКОЮ)
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('🔍 Отриманий token з QR:', token);
    console.log('👤 Працівник:', employee);
    console.log('📍 Координати:', latitude, longitude);
    
    if (!token || !employee) {
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // Показуємо всі токени в базі
    db.all('SELECT token FROM tokens', [], (err, rows) => {
        console.log('📋 Всі токени в БД зараз:', rows.map(r => r.token));
        
        // Шукаємо чи є наш токен серед них
        const found = rows.find(r => r.token === token);
        
        if (found) {
            console.log('✅ Токен Є в базі!');
            
            // Видаляємо використаний токен
            db.run('DELETE FROM tokens WHERE token = ?', [token]);
            
            // Зберігаємо відмітку
            db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', 
                [employee, token], 
                function(err) {
                    if (err) {
                        console.error('❌ Помилка запису:', err);
                        res.json({ success: false, message: '❌ Помилка запису' });
                    } else {
                        console.log('✅ Відмітку збережено!');
                        res.json({ success: true, message: '✅ Прихід зафіксовано' });
                    }
                }
            );
        } else {
            console.log('❌ Токен НЕМАЄ в базі');
            console.log('🔍 Отриманий token:', token);
            console.log('🔍 Довжина token:', token.length);
            console.log('🔍 Token в лапках: "' + token + '"');
            
            res.json({ success: false, message: '❌ Токен не знайдено' });
        }
    });
});

// =====================================
// 6. Перегляд всіх токенів
// =====================================
app.get('/api/tokens', (req, res) => {
    db.all('SELECT * FROM tokens ORDER BY created_at DESC', [], (err, rows) => {
        res.json(rows || []);
    });
});

// =====================================
// 7. Перегляд відміток
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        res.json(rows || []);
    });
});

// =====================================
// 8. Статус БД
// =====================================
app.get('/api/status', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM tokens', [], (err, tokenRow) => {
        db.get('SELECT COUNT(*) as count FROM attendance', [], (err, attRow) => {
            res.json({ 
                tokens: tokenRow?.count || 0, 
                attendance: attRow?.count || 0
            });
        });
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
            <li><a href="/api/status">📈 Статус</a></li>
        </ul>
    `);
});

// =====================================
// 10. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
});
