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
// 2. Підключення до бази даних
// =====================================
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Помилка БД:', err.message);
    } else {
        console.log('✅ База даних створена');
        
        db.run(`CREATE TABLE IF NOT EXISTS tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_used BOOLEAN DEFAULT 0
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT,
            token TEXT,
            latitude REAL,
            longitude REAL,
            check_in_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (!err) console.log('✅ Таблиці готові');
        });
    }
});

// =====================================
// 3. Генерація токена
// =====================================
function generateToken() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// =====================================
// 4. API отримання токена (для QR)
// =====================================
app.get('/api/generate-token', (req, res) => {
    const token = generateToken();
    console.log(`\n🔄 Генерую новий токен: ${token}`);
    
    db.run('INSERT INTO tokens (token) VALUES (?)', [token], function(err) {
        if (err) {
            console.error('❌ Помилка збереження токена:', err.message);
            return res.status(500).json({ error: 'Помилка сервера' });
        }
        console.log(`✅ Токен збережено в БД: ${token}`);
        res.json({ token: token });
    });
});

// =====================================
// 5. API відмітки приходу
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;

    // Детальне логування
    console.log("\n📝 ========== НОВА ВІДМІТКА ==========");
    console.log("🕐 Час:", new Date().toLocaleString());
    console.log("🎫 Отриманий токен:", token);
    console.log("👤 Працівник:", employee);
    console.log("📍 Координати:", latitude, longitude);

    // Перевірка даних
    if (!token || !employee || !latitude || !longitude) {
        console.log("❌ ПОМИЛКА: Не всі дані передано");
        return res.json({ 
            success: false, 
            message: '❌ Не всі дані передано' 
        });
    }

    // Спочатку перевіримо, чи взагалі є такий токен в базі
    db.get('SELECT * FROM tokens WHERE token = ?', [token], (err, row) => {
        if (err) {
            console.log("❌ ПОМИЛКА БД:", err.message);
            return res.json({ success: false, message: '❌ Помилка бази даних' });
        }
        
        console.log("\n🔍 РЕЗУЛЬТАТ ПОШУКУ ТОКЕНА:");
        
        if (!row) {
            console.log("❌ Токен НЕ ЗНАЙДЕНО в базі даних!");
            console.log("   Можливі причини:");
            console.log("   - Токен не був збережений при генерації");
            console.log("   - База даних очистилась (на Render це буває)");
            return res.json({ 
                success: false, 
                message: '❌ Токен не знайдено в базі' 
            });
        }

        console.log("✅ Токен ЗНАЙДЕНО!");
        console.log("   ID:", row.id);
        console.log("   Токен:", row.token);
        console.log("   Створено:", row.created_at);
        console.log("   Використаний:", row.is_used ? "ТАК" : "НІ");

        // Перевірка чи токен не використаний
        if (row.is_used === 1) {
            console.log("❌ Токен ВЖЕ ВИКОРИСТАНИЙ!");
            return res.json({ 
                success: false, 
                message: '❌ Цей QR-код вже було використано' 
            });
        }

        // Перевірка часу створення
        const createdTime = new Date(row.created_at).getTime();
        const nowTime = new Date().getTime();
        const ageSeconds = (nowTime - createdTime) / 1000;
        
        console.log(`⏱️ Вік токена: ${Math.round(ageSeconds)} секунд`);

        if (ageSeconds > 30) {
            console.log(`❌ Токен прострочений (старше 30 секунд)!`);
            return res.json({ 
                success: false, 
                message: `❌ QR-код прострочений (${Math.round(ageSeconds)} сек). Оновіть сторінку з QR` 
            });
        }

        // Координати офісу (твої)
        const OFFICE_LAT = 48.92968597521573;
        const OFFICE_LON = 24.707211205709715;
        const MAX_DISTANCE = 0.05;   // 50 метрів

        console.log("\n📍 ПЕРЕВІРКА ГЕОЛОКАЦІЇ:");
        console.log("   Координати офісу:", OFFICE_LAT, OFFICE_LON);
        console.log("   Координати працівника:", latitude, longitude);

        // Спрощена перевірка (для тесту пропустимо детальний розрахунок)
        const latDiff = Math.abs(latitude - OFFICE_LAT) * 111; // приблизно км в градусі
        const lonDiff = Math.abs(longitude - OFFICE_LON) * 111 * Math.cos(OFFICE_LAT * Math.PI / 180);
        const distance = Math.sqrt(latDiff*latDiff + lonDiff*lonDiff);
        
        console.log(`   Відстань до офісу: ${Math.round(distance * 1000)} метрів`);

        if (distance > MAX_DISTANCE) {
            console.log(`❌ Працівник ЗА МЕЖАМИ офісу!`);
            return res.json({ 
                success: false, 
                message: `❌ Ви за межами офісу (${Math.round(distance * 1000)} м)` 
            });
        }

        console.log("✅ Геолокація в межах офісу");

        // Токен валідний — позначаємо як використаний
        db.run('UPDATE tokens SET is_used = 1 WHERE token = ?', [token], function(err) {
            if (err) {
                console.log("❌ ПОМИЛКА при оновленні токена:", err.message);
                return res.json({ success: false, message: '❌ Помилка запису' });
            }

            console.log("✅ Токен позначено як використаний");

            // Записуємо прихід
            db.run(
                'INSERT INTO attendance (employee_name, token, latitude, longitude) VALUES (?, ?, ?, ?)',
                [employee, token, latitude, longitude],
                function(err) {
                    if (err) {
                        console.log("❌ ПОМИЛКА при записі відмітки:", err.message);
                        return res.json({ success: false, message: '❌ Помилка запису' });
                    }
                    
                    console.log("✅ ВІДМІТКУ УСПІШНО ЗБЕРЕЖЕНО!");
                    console.log("   ID запису:", this.lastID);
                    console.log("   Працівник:", employee);
                    console.log("   Час:", new Date().toLocaleString());
                    console.log("=====================================\n");
                    
                    res.json({ 
                        success: true, 
                        message: '✅ Прихід зафіксовано' 
                    });
                }
            );
        });
    });
});

// =====================================
// 6. Перегляд відміток
// =====================================
app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY check_in_time DESC', [], (err, rows) => {
        if (err) {
            res.json({ error: err.message });
        } else {
            console.log(`📊 Запит списку відміток: ${rows.length} записів`);
            res.json(rows);
        }
    });
});

// =====================================
// 7. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    res.send(`
        <h1>Система обліку робочого часу</h1>
        <ul>
            <li><a href="/qr.html">📱 Сторінка з QR-кодом</a></li>
            <li><a href="/check.html?token=test">👤 Сторінка відмітки (тест)</a></li>
            <li><a href="/api/attendance">📊 Переглянути всі відмітки (JSON)</a></li>
        </ul>
    `);
});

// =====================================
// 8. Перевірка статусу
// =====================================
app.get('/api/status', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM tokens', [], (err, row) => {
        res.json({
            status: 'online',
            time: new Date().toISOString(),
            tokens_count: row ? row.count : 0
        });
    });
});

// =====================================
// 9. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 Доступний за адресою: https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`👤 Check-in: https://work-ibj8.onrender.com/check.html?token=test`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance\n`);
});
