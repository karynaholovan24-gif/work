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
// 2. Підключення до MongoDB
// =====================================
const uri = "mongodb+srv://karynaholovan24:12345@cluster0.eocgh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

let db;
let tokensCollection;
let attendanceCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log('✅ Підключено до MongoDB');
        
        db = client.db('office_checkin');
        tokensCollection = db.collection('tokens');
        attendanceCollection = db.collection('attendance');
        
        // Створюємо індекси
        await tokensCollection.createIndex({ token: 1 }, { unique: true });
        await tokensCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 120 });
        
        console.log('✅ Індекси створено');
        console.log('📊 Стан: токени', await tokensCollection.countDocuments(), '| відмітки', await attendanceCollection.countDocuments());
    } catch (err) {
        console.error('❌ Помилка MongoDB:', err);
    }
}
connectDB();

// =====================================
// 3. Генерація токена
// =====================================
app.get('/api/generate-token', async (req, res) => {
    try {
        const token = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15);
        
        console.log('🔄 Створюю токен:', token);
        
        await tokensCollection.insertOne({
            token: token,
            createdAt: new Date(),
            used: false
        });
        
        const count = await tokensCollection.countDocuments();
        console.log('✅ Токен збережено. Всього токенів:', count);
        
        res.json({ token });
    } catch (err) {
        console.error('❌ Помилка:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// =====================================
// 4. Відмітка приходу
// =====================================
app.post('/api/check-in', async (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    
    console.log('\n📝 Нова відмітка:');
    console.log('Token:', token);
    console.log('Employee:', employee);
    
    if (!token || !employee) {
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    try {
        // Шукаємо токен
        const found = await tokensCollection.findOne({ token });
        
        console.log('🔍 Токен знайдено?', !!found);
        
        if (!found) {
            // Показуємо всі токени для діагностики
            const all = await tokensCollection.find().toArray();
            console.log('Всі токени в БД:', all.map(t => t.token));
            
            return res.json({ 
                success: false, 
                message: '❌ Токен не знайдено. Спробуйте оновити QR' 
            });
        }
        
        if (found.used) {
            return res.json({ success: false, message: '❌ Токен вже використано' });
        }
        
        // Перевіряємо час
        const age = (new Date() - new Date(found.createdAt)) / 1000;
        console.log('Вік токена:', age, 'сек');
        
        if (age > 30) {
            return res.json({ success: false, message: '❌ Токен прострочений' });
        }
        
        // Позначаємо як використаний
        await tokensCollection.updateOne(
            { token },
            { $set: { used: true } }
        );
        
        // Зберігаємо відмітку
        await attendanceCollection.insertOne({
            employee,
            token,
            latitude,
            longitude,
            time: new Date()
        });
        
        console.log('✅ Відмітку збережено!');
        
        res.json({ 
            success: true, 
            message: '✅ Прихід зафіксовано' 
        });
        
    } catch (err) {
        console.error('❌ Помилка:', err);
        res.json({ success: false, message: '❌ Помилка сервера' });
    }
});

// =====================================
// 5. Перегляд відміток
// =====================================
app.get('/api/attendance', async (req, res) => {
    const data = await attendanceCollection.find().sort({ time: -1 }).toArray();
    res.json(data);
});

// =====================================
// 6. Статус БД
// =====================================
app.get('/api/status', async (req, res) => {
    const tokens = await tokensCollection.countDocuments();
    const attendance = await attendanceCollection.countDocuments();
    res.json({ tokens, attendance, message: 'MongoDB працює' });
});

// =====================================
// 7. Головна сторінка
// =====================================
app.get('/', (req, res) => {
    res.send(`
        <h1>Система обліку часу</h1>
        <ul>
            <li><a href="/qr.html">QR код</a></li>
            <li><a href="/api/status">Статус БД</a></li>
            <li><a href="/api/attendance">Відмітки</a></li>
        </ul>
    `);
});

// =====================================
// 8. Запуск
// =====================================
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на порту ${PORT}`);
    console.log(`🌍 https://work-ibj8.onrender.com\n`);
});

