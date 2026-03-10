const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
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
    
    console.log('✅ Створено токен:', token);
    console.log('💾 Токени в пам\'яті:', Array.from(activeTokens));
    
    res.json({ token });
});

// =====================================
// 6. Відмітка приходу (З ДЕТАЛЬНИМ ЛОГУВАННЯМ)
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('🔍 Отриманий token з QR:', token);
    console.log('🔍 Тип token:', typeof token);
    console.log('🔍 Довжина token:', token?.length);
    console.log('👤 Працівник:', employee);
    console.log('📍 Координати:', latitude, longitude);
    
    if (!token || !employee) {
        console.log('❌ Немає даних');
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // Перевіряємо кожен символ
    console.log('🔍 Коди символів:');
    for (let i = 0; i < token.length; i++) {
        console.log(`   символ[${i}] = '${token[i]}' (код: ${token.charCodeAt(i)})`);
    }
    
    // Показуємо всі токени в пам'яті для порівняння
    console.log('💾 Токени в пам\'яті:', Array.from(activeTokens));
    
    // Перевіряємо чи є токен в пам'яті (з детальним порівнянням)
    let foundInMemory = false;
    let matchingToken = null;
    
    for (const memToken of activeTokens) {
        console.log(`🔍 Порівнюю з токеном в пам'яті: "${memToken}" (довжина: ${memToken.length})`);
        
        // Порівнюємо кожен символ
        let match = true;
        for (let i = 0; i < Math.min(token.length, memToken.length); i++) {
            if (token[i] !== memToken[i]) {
                console.log(`   ❌ Різниця на позиції ${i}: '${token[i]}' (${token.charCodeAt(i)}) vs '${memToken[i]}' (${memToken.charCodeAt(i)})`);
                match = false;
                break;
            }
        }
        
        if (match && token.length === memToken.length) {
            foundInMemory = true;
            matchingToken = memToken;
            console.log(`✅ ЗБІГ! Знайдено в пам'яті: "${memToken}"`);
            break;
        } else if (match) {
            console.log(`❌ Різна довжина: token=${token.length}, memToken=${memToken.length}`);
        }
    }
    
    if (foundInMemory) {
        console.log('✅ Токен ЗНАЙДЕНО в пам\'яті!');
        
        // Видаляємо з пам'яті
        activeTokens.delete(matchingToken);
        
        // Видаляємо з бази даних
        db.run('DELETE FROM tokens WHERE token = ?', [matchingToken]);
        
        // Зберігаємо відмітку
        db.run('INSERT INTO attendance (employee, token) VALUES (?, ?)', 
            [employee, matchingToken], 
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
    
    console.log('❌ В пам\'яті не знайдено, перевіряю БД...');
    
    // Перевіряємо в БД
    db.get('SELECT token FROM tokens WHERE token = ?', [token], (err, row) => {
        if (err) {
            console.error('❌ Помилка БД:', err);
        }
        
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
            console.log('❌ Токен НЕ ЗНАЙДЕНО ніде!');
            
            // Показуємо всі токени для діагностики
            console.log('📋 Всі токени в пам\'яті:', Array.from(activeTokens));
            
            db.all('SELECT token FROM tokens', [], (err, dbTokens) => {
                console.log('📋 Всі токени в БД:', dbTokens.map(t => t.token));
                res.json({ success: false, message: '❌ Токен не знайдено' });
            });
        }
    });
});

// =====================================
// 7. Перегляд всіх токенів (з пам'яті та БД)
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
                attendance: attRow?.count || 0
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
// 11. Тестовий ендпоінт для перевірки
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
// 12. Головна сторінка
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
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Система обліку часу</h1>
                <p>Сервер працює з подвійним зберіганням токенів</p>
                <div class="info">
                    <p>🔹 Токени зберігаються в пам'яті (не зникають при перезапуску)</p>
                    <p>🔹 Тестові токени: test123, demo456, admin789, qr2024, work001</p>
                </div>
                <ul>
                    <li><a href="/qr.html">📱 QR код для сканування</a></li>
                    <li><a href="/api/tokens">🔑 Перегляд всіх токенів</a></li>
                    <li><a href="/api/attendance">📊 Всі відмітки</a></li>
                    <li><a href="/api/status">📈 Статус системи</a></li>
                    <li><a href="/api/clear">🧹 Очистити всі токени</a></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

// =====================================
// 13. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔑 Токени: https://work-ibj8.onrender.com/api/tokens`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance`);
    console.log(`🧪 Тест: https://work-ibj8.onrender.com/api/test/test123\n`);
});
