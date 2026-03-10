const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// 1. Middleware
// =====================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// =====================================
// 2. Підключення до MongoDB з детальним логуванням
// =====================================
const uri = "mongodb+srv://karynaholovan24:12345@cluster0.eocgh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

let db;
let tokensCollection;
let attendanceCollection;
let isConnected = false;

async function connectDB() {
    try {
        console.log('🔄 Спроба підключення до MongoDB...');
        console.log('URI:', uri.replace(/12345/, '*****')); // Приховуємо пароль в логах
        
        await client.connect();
        console.log('✅ Підключено до MongoDB');
        
        db = client.db('office_checkin');
        console.log('📋 База даних:', db.databaseName);
        
        // Перевіряємо чи є колекції
        const collections = await db.listCollections().toArray();
        console.log('📚 Існуючі колекції:', collections.map(c => c.name));
        
        tokensCollection = db.collection('tokens');
        attendanceCollection = db.collection('attendance');
        
        // Створюємо індекси
        await tokensCollection.createIndex({ token: 1 }, { unique: true });
        await tokensCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 120 });
        
        console.log('✅ Індекси створено');
        
        const tokenCount = await tokensCollection.countDocuments();
        const attendanceCount = await attendanceCollection.countDocuments();
        console.log('📊 Стан: токени', tokenCount, '| відмітки', attendanceCount);
        
        isConnected = true;
        
    } catch (err) {
        console.error('❌ Помилка MongoDB:', err);
        console.error('❌ Деталі:', {
            name: err.name,
            message: err.message,
            code: err.code,
            stack: err.stack
        });
        isConnected = false;
    }
}
connectDB();

// =====================================
// 3. Генерація токена з перевіркою підключення
// =====================================
app.get('/api/generate-token', async (req, res) => {
    // Перевіряємо чи є підключення до БД
    if (!isConnected || !tokensCollection) {
        console.error('❌ Немає підключення до MongoDB');
        return res.status(500).json({ 
            error: 'Помилка сервера: немає підключення до бази даних',
            details: 'Перевірте логи на Render для деталей'
        });
    }
    
    try {
        const token = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15);
        
        console.log('🔄 Створюю токен:', token);
        
        const result = await tokensCollection.insertOne({
            token: token,
            createdAt: new Date(),
            used: false
        });
        
        console.log('✅ Токен збережено, ID:', result.insertedId);
        
        const count = await tokensCollection.countDocuments();
        console.log('📊 Всього токенів:', count);
        
        res.json({ token });
    } catch (err) {
        console.error('❌ Помилка при створенні токена:', err);
        res.status(500).json({ 
            error: 'Помилка сервера',
            details: err.message 
        });
    }
});

// =====================================
// 4. Відмітка приходу з детальним логуванням
// =====================================
app.post('/api/check-in', async (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('Час:', new Date().toLocaleString());
    console.log('Token:', token);
    console.log('Employee:', employee);
    console.log('Latitude:', latitude);
    console.log('Longitude:', longitude);
    
    // Перевіряємо чи є підключення до БД
    if (!isConnected || !tokensCollection || !attendanceCollection) {
        console.error('❌ Немає підключення до MongoDB');
        return res.json({ 
            success: false, 
            message: '❌ Помилка сервера: база даних не підключена' 
        });
    }
    
    // Перевірка обов'язкових полів
    if (!token) {
        console.log('❌ Немає токена');
        return res.json({ success: false, message: '❌ Немає токена' });
    }
    
    if (!employee) {
        console.log('❌ Немає працівника');
        return res.json({ success: false, message: '❌ Виберіть працівника' });
    }
    
    try {
        // Шукаємо токен
        console.log('🔍 Пошук токена в базі...');
        const found = await tokensCollection.findOne({ token });
        
        if (!found) {
            console.log('❌ Токен НЕ знайдено в базі');
            
            // Для діагностики покажемо всі токени
            const allTokens = await tokensCollection.find().toArray();
            console.log('📋 Всі токени в БД:', allTokens.map(t => ({
                token: t.token,
                createdAt: t.createdAt,
                used: t.used
            })));
            
            return res.json({ 
                success: false, 
                message: '❌ Токен не знайдено. Спробуйте оновити QR-код' 
            });
        }
        
        console.log('✅ Токен знайдено:', {
            createdAt: found.createdAt,
            used: found.used
        });
        
        if (found.used) {
            console.log('❌ Токен вже використано');
            return res.json({ 
                success: false, 
                message: '❌ Цей QR-код вже було використано' 
            });
        }
        
        // Перевіряємо час (30 секунд)
        const now = new Date();
        const created = new Date(found.createdAt);
        const ageSeconds = (now - created) / 1000;
        
        console.log('⏱️ Вік токена:', ageSeconds.toFixed(1), 'сек');
        
        if (ageSeconds > 30) {
            console.log('❌ Токен прострочений');
            return res.json({ 
                success: false, 
                message: '❌ QR-код прострочений. Оновіть сторінку з QR' 
            });
        }
        
        // Позначаємо токен як використаний
        console.log('🔄 Позначаю токен як використаний...');
        await tokensCollection.updateOne(
            { token },
            { $set: { used: true } }
        );
        
        // Зберігаємо відмітку
        console.log('💾 Зберігаю відмітку...');
        const attendanceData = {
            employee,
            token,
            latitude: latitude || null,
            longitude: longitude || null,
            time: new Date()
        };
        
        const result = await attendanceCollection.insertOne(attendanceData);
        
        console.log('✅ Відмітку збережено! ID:', result.insertedId);
        console.log('📊 Статистика:');
        console.log('   - Всього токенів:', await tokensCollection.countDocuments());
        console.log('   - Всього відміток:', await attendanceCollection.countDocuments());
        console.log('=====================================\n');
        
        res.json({ 
            success: true, 
            message: '✅ Прихід зафіксовано' 
        });
        
    } catch (err) {
        console.error('❌ ПОМИЛКА при обробці відмітки:', err);
        console.error('❌ Деталі помилки:', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        
        res.json({ 
            success: false, 
            message: '❌ Помилка сервера: ' + err.message 
        });
    }
});

// =====================================
// 5. Перегляд відміток
// =====================================
app.get('/api/attendance', async (req, res) => {
    try {
        const data = await attendanceCollection.find().sort({ time: -1 }).toArray();
        console.log(`📊 Запит відміток: ${data.length} записів`);
        res.json(data);
    } catch (err) {
        console.error('❌ Помилка отримання відміток:', err);
        res.json({ error: err.message });
    }
});

// =====================================
// 6. Детальний статус БД
// =====================================
app.get('/api/status', async (req, res) => {
    try {
        const tokens = await tokensCollection.countDocuments();
        const attendance = await attendanceCollection.countDocuments();
        const isConn = isConnected;
        
        // Отримаємо останній токен для перевірки
        const lastToken = await tokensCollection.find().sort({ createdAt: -1 }).limit(1).toArray();
        
        res.json({ 
            connected: isConn,
            tokens, 
            attendance,
            lastToken: lastToken[0] || null,
            message: isConn ? '✅ MongoDB працює' : '❌ MongoDB не підключено'
        });
    } catch (err) {
        res.json({ 
            connected: false,
            error: err.message,
            message: '❌ Помилка отримання статусу'
        });
    }
});

// =====================================
// 7. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    res.send(`
        <h1>Система обліку часу</h1>
        <ul>
            <li><a href="/qr.html">📱 QR код</a></li>
            <li><a href="/check.html?token=test">👤 Тест відмітки</a></li>
            <li><a href="/api/status">🔍 Статус БД</a></li>
            <li><a href="/api/attendance">📊 Відмітки JSON</a></li>
        </ul>
        <p>Сервер працює! 🚀</p>
    `);
});

// =====================================
// 8. Запуск
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com`);
    console.log(`🔍 Статус БД: https://work-ibj8.onrender.com/api/status`);
    console.log(`📊 Відмітки: https://work-ibj8.onrender.com/api/attendance\n`);
});
