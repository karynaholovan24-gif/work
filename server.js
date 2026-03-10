const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// =====================================
// Налаштування українського часу
// =====================================
process.env.TZ = 'Europe/Kyiv';
console.log('🕐 Часовий пояс:', process.env.TZ);
console.log('🕐 Поточний час:', new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }));

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
    db.run(`DROP TABLE IF EXISTS tokens`);
    db.run(`DROP TABLE IF EXISTS attendance`);

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
            
            db.all('SELECT token FROM tokens', [], (err, rows) => {
                if (!err && rows.length > 0) {
                    console.log('📋 Токени в БД:', rows.map(r => r.token));
                    rows.forEach(r => activeTokens.add(r.token));
                    console.log('💾 Токени в пам\'яті:', Array.from(activeTokens));
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
    const now = new Date();
    
    console.log('✅ Створено токен:', token);
    console.log('🕐 Час створення (київський):', now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }));
    
    activeTokens.add(token);
    
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
// 6. Відмітка приходу
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    const now = new Date();
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('🔍 Отриманий token з QR:', token);
    console.log('👤 Працівник:', employee);
    console.log('📍 Координати:', latitude, longitude);
    console.log('🕐 Час відмітки (київський):', now.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }));
    
    if (!token || !employee) {
        console.log('❌ Немає даних');
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    if (activeTokens.has(token)) {
        console.log('✅ Токен ЗНАЙДЕНО в пам\'яті!');
        
        activeTokens.delete(token);
        db.run('DELETE FROM tokens WHERE token = ?', [token]);
        
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
    
    db.get('SELECT token FROM tokens WHERE token = ?', [token], (err, row) => {
        if (row) {
            console.log('✅ Токен ЗНАЙДЕНО в БД!');
            
            db.run('DELETE FROM tokens WHERE token = ?', [token]);
            
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
            
            activeTokens.add(token);
            db.run('INSERT INTO tokens (token) VALUES (?)', [token]);
            
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
// 8. Перегляд відміток
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        if (err) {
            console.error('❌ Помилка отримання відміток:', err);
            return res.json([]);
        }
        
        if (rows) {
            rows = rows.map(row => {
                try {
                    const utcDate = new Date(row.time);
                    
                    const kyivDate = new Date(utcDate.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
                    
                    const formattedTime = kyivDate.toLocaleString('uk-UA', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    
                    return {
                        id: row.id,
                        employee: row.employee,
                        token: row.token,
                        time: formattedTime
                    };
                } catch (e) {
                    console.error('❌ Помилка конвертації часу:', e);
                    return {
                        id: row.id,
                        employee: row.employee,
                        token: row.token,
                        time: row.time
                    };
                }
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
            const now = new Date();
            
            res.json({ 
                memory_tokens: activeTokens.size,
                database_tokens: tokenRow?.count || 0,
                attendance: attRow?.count || 0,
                current_time: now.toLocaleString('uk-UA', { 
                    timeZone: 'Europe/Kyiv',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false 
                })
            });
        });
    });
});

// =====================================
// Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔑 Токени: https://work-ibj8.onrender.com/api/tokens`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance`);
    console.log(`🧪 Тест: https://work-ibj8.onrender.com/api/test/test123\n`);
});
