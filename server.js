const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

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

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Помилка відкриття БД:', err);
    } else {
        console.log('✅ База даних SQLite відкрита/створена');
    }
});

// Створюємо таблиці (виправлено синтаксис)
db.serialize(() => {
    // Таблиця токенів
    db.run(`CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used INTEGER DEFAULT 0
    )`, (err) => {
        if (err) console.error('❌ Помилка створення tokens:', err);
        else console.log('✅ Таблиця tokens готова');
    });

    // Таблиця відміток
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee TEXT,
        token TEXT,
        latitude REAL,
        longitude REAL,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('❌ Помилка створення attendance:', err);
        else console.log('✅ Таблиця attendance готова');
    });
});

// =====================================
// 3. Генерація токена
// =====================================
app.get('/api/generate-token', (req, res) => {
    const token = Math.random().toString(36).substring(2, 10);
    console.log('🔄 Створюю токен:', token);
    
    db.run('INSERT INTO tokens (token) VALUES (?)', [token], function(err) {
        if (err) {
            console.error('❌ Помилка збереження токена:', err);
            return res.status(500).json({ error: 'Помилка сервера' });
        }
        console.log('✅ Токен збережено, ID:', this.lastID);
        res.json({ token });
    });
});

// =====================================
// 4. Відмітка приходу (виправлено SQL запит)
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('Token:', token);
    console.log('Employee:', employee);
    console.log('Latitude:', latitude);
    console.log('Longitude:', longitude);
    
    if (!token || !employee) {
        console.log('❌ Немає даних');
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // Шукаємо токен (виправлено синтаксис)
    db.get(
        `SELECT * FROM tokens 
         WHERE token = ? 
         AND used = 0 
         AND datetime(created_at) > datetime('now', '-30 seconds')`,
        [token],
        (err, row) => {
            if (err) {
                console.error('❌ Помилка пошуку токена:', err);
                return res.json({ success: false, message: '❌ Помилка бази даних' });
            }
            
            console.log('🔍 Токен знайдено?', row ? 'Так' : 'Ні');
            
            if (!row) {
                // Перевіримо чи взагалі є такий токен
                db.get('SELECT * FROM tokens WHERE token = ?', [token], (err, existingToken) => {
                    if (existingToken) {
                        if (existingToken.used === 1) {
                            return res.json({ success: false, message: '❌ Токен вже використано' });
                        } else {
                            return res.json({ success: false, message: '❌ Токен прострочений (більше 30 секунд)' });
                        }
                    } else {
                        return res.json({ success: false, message: '❌ Токен не знайдено' });
                    }
                });
                return;
            }
            
            // Позначаємо токен як використаний
            db.run('UPDATE tokens SET used = 1 WHERE token = ?', [token], function(err) {
                if (err) {
                    console.error('❌ Помилка оновлення токена:', err);
                    return res.json({ success: false, message: '❌ Помилка запису' });
                }
                
                // Зберігаємо відмітку
                db.run(
                    'INSERT INTO attendance (employee, token, latitude, longitude) VALUES (?, ?, ?, ?)',
                    [employee, token, latitude || null, longitude || null],
                    function(err) {
                        if (err) {
                            console.error('❌ Помилка збереження відмітки:', err);
                            return res.json({ success: false, message: '❌ Помилка запису' });
                        }
                        
                        console.log('✅ Відмітку збережено! ID:', this.lastID);
                        console.log('=====================================\n');
                        
                        res.json({ 
                            success: true, 
                            message: '✅ Прихід зафіксовано' 
                        });
                    }
                );
            });
        }
    );
});

// =====================================
// 5. Перегляд відміток
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        if (err) {
            console.error('❌ Помилка отримання відміток:', err);
            res.json({ error: err.message });
        } else {
            console.log(`📊 Запит відміток: ${rows.length} записів`);
            res.json(rows);
        }
    });
});

// =====================================
// 6. Статус БД
// =====================================
app.get('/api/status', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM tokens', [], (err, tokenRow) => {
        if (err) {
            return res.json({ connected: false, error: err.message });
        }
        
        db.get('SELECT COUNT(*) as count FROM attendance', [], (err, attRow) => {
            if (err) {
                return res.json({ connected: false, error: err.message });
            }
            
            // Отримуємо останній токен
            db.get('SELECT * FROM tokens ORDER BY created_at DESC LIMIT 1', [], (err, lastToken) => {
                res.json({ 
                    connected: true,
                    database: 'SQLite',
                    tokens: tokenRow?.count || 0, 
                    attendance: attRow?.count || 0,
                    lastToken: lastToken || null,
                    message: '✅ SQLite працює'
                });
            });
        });
    });
});

// =====================================
// 7. Очищення старих токенів
// =====================================
app.get('/api/cleanup', (req, res) => {
    db.run(`DELETE FROM tokens WHERE used = 1 OR datetime(created_at) < datetime('now', '-1 hour')`, function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, deleted: this.changes });
        }
    });
});

// =====================================
// 8. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Система обліку часу</title>
            <style>
                body { font-family: Arial; padding: 40px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
                .container { max-width: 600px; margin: 0 auto; background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; }
                h1 { margin-bottom: 20px; }
                ul { list-style: none; padding: 0; }
                li { margin: 15px 0; }
                a { color: white; text-decoration: none; padding: 10px 20px; background: rgba(255,255,255,0.2); border-radius: 8px; display: inline-block; }
                a:hover { background: rgba(255,255,255,0.3); }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Система обліку часу</h1>
                <p>Сервер успішно запущено на SQLite!</p>
                <ul>
                    <li><a href="/qr.html">📱 QR код для сканування</a></li>
                    <li><a href="/api/status">🔍 Статус бази даних</a></li>
                    <li><a href="/api/attendance">📊 Всі відмітки (JSON)</a></li>
                    <li><a href="/api/cleanup">🧹 Очистити старі токени</a></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

// =====================================
// 9. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔍 Статус БД: https://work-ibj8.onrender.com/api/status`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance\n`);
});
