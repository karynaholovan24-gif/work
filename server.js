const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// =====================================
// Налаштування українського часу
// =====================================
process.env.TZ = 'Europe/Kiev';
console.log('🕐 Часовий пояс:', process.env.TZ);
console.log('🕐 Поточний час:', new Date().toLocaleString('uk-UA'));

const PORT = process.env.PORT || 3000;

// =====================================
// Тимчасове сховище токенів (не зникає!)
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
// 4. Додаємо тестові токени при запуску
// =====================================
setTimeout(() => {
    db.serialize(() => {
        // Перевіряємо чи є токени
        db.get('SELECT COUNT(*) as count FROM tokens', [], (err, row) => {
            if (err) {
                console.error('❌ Помилка перевірки токенів:', err);
                return;
            }
            
            console.log('📊 Поточна кількість токенів в БД:', row.count);
            
            if (row.count === 0) {
                console.log('🔄 Додаю тестові токени...');
                const testTokens = ['test123', 'demo456', 'admin789', 'qr2024', 'work001'];
                
                testTokens.forEach(token => {
                    db.run('INSERT INTO tokens (token) VALUES (?)', [token], (err) => {
                        if (!err) {
                            console.log('✅ Додано тестовий токен:', token);
                            activeTokens.add(token);
                        }
                    });
                });
                
                console.log('✅ Тестові токени додано в БД та пам\'ять');
            }
            
            // Показуємо всі токени
            db.all('SELECT token FROM tokens', [], (err, rows) => {
                if (!err && rows.length > 0) {
                    console.log('📋 Токени в БД:', rows.map(r => r.token));
                    rows.forEach(r => activeTokens.add(r.token));
                    console.log('💾 Токени в пам\'яті:', Array.from(activeTokens));
                }
            });
        });
    });
}, 1000); // Чекаємо 1 секунду поки створяться таблиці

// =====================================
// 5. Генерація токена
// =====================================
app.get('/api/generate-token', (req, res) => {
    const token = Math.random().toString(36).substring(2, 10);
    const now = new Date();
    
    console.log('✅ Створено токен:', token);
    console.log('🕐 Час створення (київський):', now.toLocaleString('uk-UA'));
    
    // Додаємо в пам'ять
    activeTokens.add(token);
    
    // Додаємо в базу даних
    db.run('INSERT INTO tokens (token) VALUES (?)', [token], (err) => {
        if (err) {
            console.error('❌ Помилка збереження токена:', err);
        } else {
            console.log('✅ Токен збережено в БД:', token);
        }
    });
    
    console.log('💾 Токени в пам\'яті:', Array.from(activeTokens));
    
    res.json({ token });
});

// =====================================
// 6. Відмітка приходу (З АВТОМАТИЧНИМ СТВОРЕННЯМ)
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    const now = new Date();
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('🔍 Отриманий token з QR:', token);
    console.log('👤 Працівник:', employee);
    console.log('📍 Координати:', latitude, longitude);
    console.log('🕐 Час відмітки (київський):', now.toLocaleString('uk-UA'));
    
    if (!token || !employee) {
        console.log('❌ Немає даних');
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // Спочатку перевіряємо в пам'яті
    if (activeTokens.has(token)) {
        console.log('✅ Токен ЗНАЙДЕНО в пам\'яті!');
        
        // Видаляємо з пам'яті
        activeTokens.delete(token);
        
        // Видаляємо з бази даних
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
        return;
    }
    
    // Перевіряємо в БД
    db.get('SELECT token FROM tokens WHERE token = ?', [token], (err, row) => {
        if (row) {
            console.log('✅ Токен ЗНАЙДЕНО в БД!');
            
            // Видаляємо з БД
            db.run('DELETE FROM tokens WHERE token = ?', [token]);
            
            // Зберігаємо відмітку
            db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', 
                [employee, token], 
                function(err) {
                    if (err) {
                        res.json({ success: false, message: '❌ Помилка запису' });
                    } else {
                        res.json({ success: true, message: '✅ Прихід зафіксовано' });
                    }
                }
            );
        } else {
            console.log('⚠️ Токен не знайдено, створюю автоматично...');
            
            // АВТОМАТИЧНО ДОДАЄМО ТОКЕН
            activeTokens.add(token);
            db.run('INSERT INTO tokens (token) VALUES (?)', [token], (err) => {
                if (err) {
                    console.error('❌ Помилка створення токена:', err);
                }
            });
            
            // ВІДРАЗУ ЗБЕРІГАЄМО ВІДМІТКУ
            db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', 
                [employee, token], 
                function(err) {
                    if (err) {
                        console.error('❌ Помилка запису:', err);
                        res.json({ success: false, message: '❌ Помилка запису' });
                    } else {
                        console.log('✅ Токен створено автоматично і відмітку збережено!');
                        res.json({ success: true, message: '✅ Прихід зафіксовано' });
                    }
                }
            );
        }
    });
});

// =====================================
// 7. Перегляд всіх токенів
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
// 8. Перегляд відміток (З КИЇВСЬКИМ ЧАСОМ)
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        if (rows) {
            // Конвертуємо час в київський для кожного запису
            rows = rows.map(row => {
                const date = new Date(row.time);
                return {
                    id: row.id,
                    employee: row.employee,
                    token: row.token,
                    time: date.toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })
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
                current_time: new Date().toLocaleString('uk-UA')
            });
        });
    });
});

// =====================================
// 10. Очистити всі токени
// =====================================
app.get('/api/clear', (req, res) => {
    activeTokens.clear();
    db.run('DELETE FROM tokens', [], (err) => {
        res.json({ success: true, message: '✅ Всі токени видалено' });
    });
});

// =====================================
// 11. Видалити тестові токени
// =====================================
app.get('/api/reset', (req, res) => {
    activeTokens.clear();
    db.run('DELETE FROM tokens', [], (err) => {
        console.log('✅ Всі токени видалено');
        res.json({ success: true, message: '✅ Базу очищено. Створіть новий токен!' });
    });
});

// =====================================
// 12. Тестовий ендпоінт
// =====================================
app.get('/api/test/:token', (req, res) => {
    const testToken = req.params.token;
    
    console.log('🧪 Тестовий пошук токена:', testToken);
    console.log('💾 Токени в пам\'яті:', Array.from(activeTokens));
    
    const found = activeTokens.has(testToken);
    
    db.get('SELECT token FROM tokens WHERE token = ?', [testToken], (err, row) => {
        res.json({
            token: testToken,
            in_memory: found,
            in_database: !!row,
            memory_tokens: Array.from(activeTokens),
            database_tokens: row ? [row.token] : []
        });
    });
});

// =====================================
// 13. Головна сторінка
// =====================================
app.get('/', (req, res) => {
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
                .success { color: #aaffaa; }
                .warning { color: #ffaa00; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Система обліку часу</h1>
                <p>Сервер працює з <span class="success">українським часом</span></p>
                <div class="info">
                    <p>🕐 Поточний час: ${new Date().toLocaleString('uk-UA')}</p>
                    <p>🔹 Якщо токен не знайдено - він створюється автоматично</p>
                    <p>🔹 Тестові токени: test123, demo456, admin789, qr2024, work001</p>
                </div>
                <ul>
                    <li><a href="/qr.html">📱 QR код для сканування</a></li>
                    <li><a href="/api/tokens">🔑 Перегляд всіх токенів</a></li>
                    <li><a href="/api/attendance">📊 Всі відмітки (київський час)</a></li>
                    <li><a href="/api/status">📈 Статус системи</a></li>
                    <li><a href="/api/reset">🧹 Очистити всі токени</a></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

// =====================================
// 14. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔑 Токени: https://work-ibj8.onrender.com/api/tokens`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance`);
    console.log(`🧪 Тест: https://work-ibj8.onrender.com/api/test/test123\n`);
});
