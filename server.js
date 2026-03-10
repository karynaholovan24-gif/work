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
// 2. Підключення до SQLite з детальним логуванням
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

// Створюємо таблиці з перевіркою
db.serialize(() => {
    // Таблиця токенів
    db.run(`CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used INTEGER DEFAULT 0
    )`, function(err) {
        if (err) {
            console.error('❌ Помилка створення tokens:', err);
        } else {
            console.log('✅ Таблиця tokens готова');
            
            // Перевіряємо чи таблиця створилась
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'", [], (err, row) => {
                if (row) {
                    console.log('📋 Таблиця tokens підтверджена');
                }
            });
        }
    });

    // Таблиця відміток
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee TEXT,
        token TEXT,
        latitude REAL,
        longitude REAL,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, function(err) {
        if (err) {
            console.error('❌ Помилка створення attendance:', err);
        } else {
            console.log('✅ Таблиця attendance готова');
        }
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
            return res.status(500).json({ error: 'Помилка сервера: ' + err.message });
        }
        console.log('✅ Токен збережено, ID:', this.lastID);
        
        // Перевіримо чи токен дійсно зберігся
        db.get('SELECT * FROM tokens WHERE token = ?', [token], (err, row) => {
            if (row) {
                console.log('✅ Токен підтверджено в БД');
            } else {
                console.log('❌ Токен НЕ знайдено після збереження');
            }
        });
        
        res.json({ token });
    });
});

// =====================================
// 4. Відмітка приходу з детальним логуванням
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('Token:', token);
    console.log('Employee:', employee);
    console.log('Latitude:', latitude);
    console.log('Longitude:', longitude);
    console.log('Час:', new Date().toLocaleString());
    
    if (!token || !employee) {
        console.log('❌ Немає даних');
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // Спочатку перевіримо чи таблиця існує
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'", [], (err, tableRow) => {
        if (err) {
            console.error('❌ ПОМИЛКА перевірки таблиці:', err);
            return res.json({ success: false, message: '❌ Помилка перевірки БД: ' + err.message });
        }
        
        console.log('📋 Таблиця tokens існує?', tableRow ? 'Так' : 'Ні');
        
        if (!tableRow) {
            // Спробуємо створити таблицю ще раз
            console.log('🔄 Спроба створити таблицю tokens...');
            db.run(`CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                used INTEGER DEFAULT 0
            )`, (err) => {
                if (err) {
                    console.error('❌ ПОМИЛКА створення таблиці:', err);
                    return res.json({ success: false, message: '❌ Помилка створення БД: ' + err.message });
                }
                console.log('✅ Таблицю tokens створено');
            });
        }
        
        // Тепер шукаємо токен
        console.log('🔍 Виконую пошук токена:', token);
        
        db.get(`SELECT * FROM tokens WHERE token = ?`, [token], (err, row) => {
            if (err) {
                console.error('❌ ПОМИЛКА пошуку токена:', err);
                console.error('❌ Деталі:', {
                    message: err.message,
                    code: err.code,
                    errno: err.errno
                });
                return res.json({ success: false, message: '❌ Помилка бази даних: ' + err.message });
            }
            
            console.log('🔍 Результат пошуку:', row ? 'Токен знайдено' : 'Токен не знайдено');
            
            if (row) {
                console.log('📋 Дані токена:', {
                    id: row.id,
                    token: row.token,
                    created_at: row.created_at,
                    used: row.used
                });
            }
            
            if (!row) {
                // Покажемо всі токени для діагностики
                db.all('SELECT token, created_at, used FROM tokens ORDER BY created_at DESC LIMIT 10', [], (err, allTokens) => {
                    if (!err) {
                        console.log('📋 Останні токени в БД:', allTokens);
                    } else {
                        console.log('❌ Помилка отримання списку токенів:', err);
                    }
                });
                
                return res.json({ success: false, message: '❌ Токен не знайдено' });
            }
            
            if (row.used === 1) {
                console.log('❌ Токен вже використано');
                return res.json({ success: false, message: '❌ Токен вже використано' });
            }
            
            // Перевіряємо час
            const createdTime = new Date(row.created_at).getTime();
            const nowTime = new Date().getTime();
            const ageSeconds = (nowTime - createdTime) / 1000;
            
            console.log('⏱️ Час створення:', row.created_at);
            console.log('⏱️ Поточний час:', new Date().toISOString());
            console.log('⏱️ Вік токена:', ageSeconds.toFixed(1), 'сек');
            
            if (ageSeconds > 30) {
                console.log('❌ Токен прострочений');
                return res.json({ success: false, message: '❌ Токен прострочений' });
            }
            
            // Позначаємо як використаний
            console.log('🔄 Позначаю токен як використаний...');
            db.run('UPDATE tokens SET used = 1 WHERE token = ?', [token], function(err) {
                if (err) {
                    console.error('❌ ПОМИЛКА оновлення токена:', err);
                    return res.json({ success: false, message: '❌ Помилка оновлення: ' + err.message });
                }
                
                console.log('✅ Токен позначено як використаний, змінено рядків:', this.changes);
                
                // Зберігаємо відмітку
                console.log('💾 Зберігаю відмітку...');
                db.run(
                    'INSERT INTO attendance (employee, token, latitude, longitude) VALUES (?, ?, ?, ?)',
                    [employee, token, latitude || null, longitude || null],
                    function(err) {
                        if (err) {
                            console.error('❌ ПОМИЛКА збереження відмітки:', err);
                            return res.json({ success: false, message: '❌ Помилка запису: ' + err.message });
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
        });
    });
});

// =====================================
// 5. Перегляд відміток
// =====================================
app.get('/api/attendance', (req, res) => {
    console.log('📊 Запит списку відміток');
    db.all('SELECT * FROM attendance ORDER BY time DESC', [], (err, rows) => {
        if (err) {
            console.error('❌ Помилка отримання відміток:', err);
            res.json({ error: err.message });
        } else {
            console.log(`📊 Знайдено ${rows.length} відміток`);
            res.json(rows);
        }
    });
});

// =====================================
// 6. Статус БД
// =====================================
app.get('/api/status', (req, res) => {
    console.log('🔍 Запит статусу БД');
    
    db.get('SELECT COUNT(*) as count FROM tokens', [], (err, tokenRow) => {
        if (err) {
            console.error('❌ Помилка отримання кількості токенів:', err);
            return res.json({ connected: false, error: err.message });
        }
        
        db.get('SELECT COUNT(*) as count FROM attendance', [], (err, attRow) => {
            if (err) {
                console.error('❌ Помилка отримання кількості відміток:', err);
                return res.json({ connected: false, error: err.message });
            }
            
            // Отримуємо останній токен
            db.get('SELECT * FROM tokens ORDER BY created_at DESC LIMIT 1', [], (err, lastToken) => {
                // Отримуємо останню відмітку
                db.get('SELECT * FROM attendance ORDER BY time DESC LIMIT 1', [], (err, lastAttendance) => {
                    res.json({ 
                        connected: true,
                        database: 'SQLite',
                        tokens: tokenRow?.count || 0, 
                        attendance: attRow?.count || 0,
                        lastToken: lastToken || null,
                        lastAttendance: lastAttendance || null,
                        message: '✅ SQLite працює'
                    });
                });
            });
        });
    });
});

// =====================================
// 7. Діагностика БД
// =====================================
app.get('/api/test-db', (req, res) => {
    console.log('🧪 Запуск діагностики БД...');
    
    const results = {
        timestamp: new Date().toISOString(),
        checks: {}
    };
    
    // Перевіряємо чи можна писати в файл
    try {
        fs.accessSync(__dirname, fs.constants.W_OK);
        results.checks.write_access = true;
        console.log('✅ Права на запис є');
    } catch (err) {
        results.checks.write_access = false;
        results.checks.write_error = err.message;
        console.log('❌ Немає прав на запис:', err);
    }
    
    // Перевіряємо чи існує файл БД
    try {
        const stats = fs.statSync('./database.sqlite');
        results.checks.db_file_exists = true;
        results.checks.db_file_size = stats.size;
        console.log('✅ Файл БД існує, розмір:', stats.size);
    } catch (err) {
        results.checks.db_file_exists = false;
        console.log('❌ Файл БД не існує');
    }
    
    // Перевіряємо таблиці
    db.get("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) {
            results.checks.tables = '❌ ' + err.message;
        } else {
            results.checks.tables = 'Таблиці існують';
        }
        
        // Спробуємо вставити тестовий токен
        const testToken = 'test_' + Date.now();
        console.log('🔄 Тестова вставка токена:', testToken);
        
        db.run('INSERT INTO tokens (token) VALUES (?)', [testToken], function(err) {
            if (err) {
                results.checks.insert_test = '❌ ' + err.message;
                console.log('❌ Помилка вставки:', err);
            } else {
                results.checks.insert_test = '✅ Успішно, ID: ' + this.lastID;
                console.log('✅ Тестовий токен вставлено');
                
                // Спробуємо знайти тестовий токен
                db.get('SELECT * FROM tokens WHERE token = ?', [testToken], (err, row) => {
                    if (row) {
                        results.checks.select_test = '✅ Токен знайдено';
                        console.log('✅ Тестовий токен знайдено');
                    } else {
                        results.checks.select_test = '❌ Токен не знайдено';
                        console.log('❌ Тестовий токен не знайдено');
                    }
                    
                    // Видалимо тестовий токен
                    db.run('DELETE FROM tokens WHERE token = ?', [testToken], function(err) {
                        if (!err) {
                            console.log('✅ Тестовий токен видалено');
                        }
                        
                        // Фінальний звіт
                        results.success = true;
                        results.message = 'Діагностика завершена';
                        console.log('✅ Діагностика завершена');
                        res.json(results);
                    });
                });
            }
        });
    });
});

// =====================================
// 8. Очищення старих токенів
// =====================================
app.get('/api/cleanup', (req, res) => {
    console.log('🧹 Очищення старих токенів');
    db.run(`DELETE FROM tokens WHERE used = 1 OR datetime(created_at) < datetime('now', '-1 hour')`, function(err) {
        if (err) {
            console.error('❌ Помилка очищення:', err);
            res.json({ success: false, error: err.message });
        } else {
            console.log(`✅ Видалено ${this.changes} старих токенів`);
            res.json({ success: true, deleted: this.changes });
        }
    });
});

// =====================================
// 9. Головна сторінка
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
                .status { margin-top: 20px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Система обліку часу</h1>
                <p>Сервер успішно запущено на SQLite!</p>
                <div class="status">
                    <p>🕐 Час: ${new Date().toLocaleString()}</p>
                </div>
                <ul>
                    <li><a href="/qr.html">📱 QR код для сканування</a></li>
                    <li><a href="/api/status">🔍 Статус бази даних</a></li>
                    <li><a href="/api/test-db">🧪 Діагностика БД</a></li>
                    <li><a href="/api/attendance">📊 Всі відмітки (JSON)</a></li>
                    <li><a href="/api/cleanup">🧹 Очистити старі токени</a></li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

// =====================================
// 10. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`🔍 Статус БД: https://work-ibj8.onrender.com/api/status`);
    console.log(`🧪 Діагностика: https://work-ibj8.onrender.com/api/test-db`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance\n`);
});
