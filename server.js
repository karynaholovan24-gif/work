const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');

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
// 2. Підключення до MongoDB Atlas
// =====================================
const uri = "mongodb+srv://karynaholovan24:12345@cluster0.eocgh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db;

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db("office_checkin");
        console.log("✅ Підключено до MongoDB Atlas!");
        
        // Створюємо індекси
        await db.collection("tokens").createIndex({ token: 1 }, { unique: true });
        await db.collection("tokens").createIndex({ created_at: 1 }, { expireAfterSeconds: 120 });
        await db.collection("attendance").createIndex({ check_in_time: -1 });
        
        console.log("✅ Індекси створено");
    } catch (error) {
        console.error("❌ Помилка підключення до MongoDB:", error);
    }
}

connectToMongo();

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
app.get('/api/generate-token', async (req, res) => {
    try {
        const token = generateToken();
        console.log(`\n🔄 Генерую новий токен: ${token}`);
        
        await db.collection("tokens").insertOne({
            token: token,
            created_at: new Date(),
            is_used: false
        });
        
        console.log(`✅ Токен збережено в MongoDB`);
        
        // Перевірка скільки токенів в базі
        const count = await db.collection("tokens").countDocuments();
        console.log(`📊 Всього токенів в базі: ${count}`);
        
        res.json({ token: token });
    } catch (error) {
        console.error("❌ Помилка збереження токена:", error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// =====================================
// 5. API відмітки приходу
// =====================================
app.post('/api/check-in', async (req, res) => {
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

    try {
        // Шукаємо токен в MongoDB
        const tokenDoc = await db.collection("tokens").findOne({ token: token });
        
        console.log("\n🔍 РЕЗУЛЬТАТ ПОШУКУ ТОКЕНА:");
        
        if (!tokenDoc) {
            console.log("❌ Токен НЕ ЗНАЙДЕНО в MongoDB!");
            
            // Покажемо всі токени для діагностики
            const allTokens = await db.collection("tokens").find({}).toArray();
            console.log("📋 Всі токени в базі:", allTokens.map(t => t.token));
            
            return res.json({ 
                success: false, 
                message: '❌ Токен не знайдено в базі' 
            });
        }

        console.log("✅ Токен ЗНАЙДЕНО!");
        console.log("   Токен:", tokenDoc.token);
        console.log("   Створено:", tokenDoc.created_at);
        console.log("   Використаний:", tokenDoc.is_used ? "ТАК" : "НІ");

        // Перевірка чи токен не використаний
        if (tokenDoc.is_used) {
            console.log("❌ Токен ВЖЕ ВИКОРИСТАНИЙ!");
            return res.json({ 
                success: false, 
                message: '❌ Цей QR-код вже було використано' 
            });
        }

        // Перевірка часу створення
        const createdTime = new Date(tokenDoc.created_at).getTime();
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

        // Спрощена перевірка відстані
        const latDiff = Math.abs(latitude - OFFICE_LAT) * 111;
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

        // Позначаємо токен як використаний
        await db.collection("tokens").updateOne(
            { token: token },
            { $set: { is_used: true } }
        );

        console.log("✅ Токен позначено як використаний");

        // Записуємо прихід
        const result = await db.collection("attendance").insertOne({
            employee_name: employee,
            token: token,
            latitude: latitude,
            longitude: longitude,
            check_in_time: new Date()
        });

        console.log("✅ ВІДМІТКУ УСПІШНО ЗБЕРЕЖЕНО!");
        console.log("   ID запису:", result.insertedId);
        console.log("   Працівник:", employee);
        console.log("   Час:", new Date().toLocaleString());
        console.log("=====================================\n");

        res.json({ 
            success: true, 
            message: '✅ Прихід зафіксовано' 
        });

    } catch (error) {
        console.error("❌ ПОМИЛКА:", error);
        res.json({ 
            success: false, 
            message: '❌ Помилка сервера: ' + error.message 
        });
    }
});

// =====================================
// 6. Перегляд відміток
// =====================================
app.get('/api/attendance', async (req, res) => {
    try {
        const attendance = await db.collection("attendance")
            .find({})
            .sort({ check_in_time: -1 })
            .toArray();
        
        console.log(`📊 Запит списку відміток: ${attendance.length} записів`);
        res.json(attendance);
    } catch (error) {
        res.json({ error: error.message });
    }
});

// =====================================
// 7. Тестовий ендпоінт для перевірки БД
// =====================================
app.get('/api/test-db', async (req, res) => {
    try {
        const tokensCount = await db.collection("tokens").countDocuments();
        const attendanceCount = await db.collection("attendance").countDocuments();
        
        // Покажемо останні 5 токенів
        const recentTokens = await db.collection("tokens")
            .find({})
            .sort({ created_at: -1 })
            .limit(5)
            .toArray();
        
        res.json({
            status: 'connected',
            database: 'MongoDB Atlas',
            tokens: {
                total: tokensCount,
                recent: recentTokens
            },
            attendance: {
                total: attendanceCount
            },
            note: 'Дані тепер зберігаються постійно! 🎉'
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

// =====================================
// 8. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    res.send(`
        <h1>Система обліку робочого часу</h1>
        <ul>
            <li><a href="/qr.html">📱 Сторінка з QR-кодом</a></li>
            <li><a href="/check.html?token=test">👤 Сторінка відмітки (тест)</a></li>
            <li><a href="/api/attendance">📊 Переглянути всі відмітки (JSON)</a></li>
            <li><a href="/api/test-db">🔍 Перевірити стан бази даних</a></li>
        </ul>
    `);
});

// =====================================
// 9. Запуск сервера
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 Доступний за адресою: https://work-ibj8.onrender.com`);
    console.log(`📱 QR сторінка: https://work-ibj8.onrender.com/qr.html`);
    console.log(`👤 Check-in: https://work-ibj8.onrender.com/check.html?token=test`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance`);
    console.log(`🔍 Тест БД: https://work-ibj8.onrender.com/api/test-db\n`);
});
