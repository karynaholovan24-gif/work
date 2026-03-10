const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// Київський час
// ================================
const TIMEZONE = "Europe/Kyiv";

function kyivTime(date = new Date()) {
    return date.toLocaleString("uk-UA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}

console.log("🕐 Поточний київський час:", kyivTime());

// ================================
// Тимчасове сховище токенів
// ================================
const activeTokens = new Set();

// ================================
// Middleware
// ================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "..")));

// ================================
// Підключення SQLite
// ================================
console.log("🔄 Створюємо SQLite базу...");

const db = new sqlite3.Database("./database.sqlite", (err) => {
    if (err) {
        console.error("❌ Помилка відкриття БД:", err);
    } else {
        console.log("✅ SQLite база готова");
    }
});

// ================================
// Створення таблиць
// ================================
db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS tokens (
            token TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee TEXT,
            token TEXT,
            latitude TEXT,
            longitude TEXT,
            time DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

// ================================
// Завантаження токенів у пам'ять
// ================================
function loadTokens() {

    db.all("SELECT token FROM tokens", [], (err, rows) => {

        if (!err && rows) {
            rows.forEach(r => activeTokens.add(r.token));
            console.log("🔑 Завантажено токенів:", activeTokens.size);
        }

    });

}

loadTokens();

// ================================
// Генерація токена
// ================================
app.get("/api/generate-token", (req, res) => {

    const token = Math.random().toString(36).substring(2, 10);

    activeTokens.add(token);

    db.run(
        "INSERT INTO tokens (token) VALUES (?)",
        [token],
        (err) => {
            if (err) {
                console.error("❌ Помилка запису токена:", err);
            }
        }
    );

    console.log("🔑 Новий токен:", token);

    res.json({ token });

});

// ================================
// Check-in працівника
// ================================
app.post("/api/check-in", (req, res) => {

    const { token, employee, latitude, longitude } = req.body;

    console.log("\n📝 Нова відмітка");
    console.log("👤 Працівник:", employee);
    console.log("🔑 Token:", token);
    console.log("📍 GPS:", latitude, longitude);
    console.log("🕐 Час:", kyivTime());

    if (!token || !employee) {
        return res.json({
            success: false,
            message: "❌ Немає даних"
        });
    }

    if (activeTokens.has(token)) {

        activeTokens.delete(token);

        db.run("DELETE FROM tokens WHERE token = ?", [token]);

        db.run(
            `INSERT INTO attendance 
            (employee, token, latitude, longitude) 
            VALUES (?, ?, ?, ?)`,
            [employee, token, latitude, longitude],
            (err) => {

                if (err) {
                    console.error(err);

                    return res.json({
                        success: false,
                        message: "❌ Помилка запису"
                    });
                }

                res.json({
                    success: true,
                    message: "✅ Прихід зафіксовано"
                });

            }
        );

        return;
    }

    res.json({
        success: false,
        message: "❌ Токен недійсний"
    });

});

// ================================
// Перегляд токенів
// ================================
app.get("/api/tokens", (req, res) => {

    db.all(
        "SELECT * FROM tokens ORDER BY created_at DESC",
        [],
        (err, rows) => {
            res.json({
                memory_tokens: Array.from(activeTokens),
                database_tokens: rows || []
            });
        }
    );

});

// ================================
// Перегляд відміток
// ================================
app.get("/api/attendance", (req, res) => {

    db.all(
        "SELECT * FROM attendance ORDER BY time DESC",
        [],
        (err, rows) => {

            if (err) {
                console.error(err);
                return res.json([]);
            }

            const data = rows.map(r => {

                const formatted = new Date(r.time).toLocaleString("uk-UA", {
                    timeZone: TIMEZONE,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false
                });

                return {
                    id: r.id,
                    employee: r.employee,
                    token: r.token,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    time: formatted
                };

            });

            res.json(data);

        }
    );

});

// ================================
// Статус системи
// ================================
app.get("/api/status", (req, res) => {

    db.get("SELECT COUNT(*) as count FROM tokens", [], (err, t) => {

        db.get("SELECT COUNT(*) as count FROM attendance", [], (err, a) => {

            res.json({
                memory_tokens: activeTokens.size,
                database_tokens: t?.count || 0,
                attendance: a?.count || 0,
                current_time: kyivTime()
            });

        });

    });

});

// ================================
// Очистити токени
// ================================
app.get("/api/reset", (req, res) => {

    activeTokens.clear();

    db.run("DELETE FROM tokens", [], () => {

        res.json({
            success: true,
            message: "✅ Токени очищено"
        });

    });

});

// ================================
// Головна сторінка
// ================================
app.get("/", (req, res) => {

    res.send(`
    <html>
    <head>
    <title>Система обліку часу</title>

    <style>
    body{
        font-family:Arial;
        background:linear-gradient(135deg,#667eea,#764ba2);
        color:white;
        padding:40px;
    }

    .box{
        max-width:700px;
        margin:auto;
        background:rgba(255,255,255,0.1);
        padding:30px;
        border-radius:12px;
    }

    a{
        display:block;
        margin:10px 0;
        color:white;
        text-decoration:none;
        background:rgba(255,255,255,0.2);
        padding:10px;
        border-radius:8px;
    }

    </style>

    </head>

    <body>

    <div class="box">

    <h1>✅ Система обліку часу</h1>

    <p>🕐 Поточний час: ${kyivTime()}</p>

    <a href="/qr.html">📱 QR сторінка</a>
    <a href="/api/tokens">🔑 Токени</a>
    <a href="/api/attendance">📊 Відмітки</a>
    <a href="/api/status">📈 Статус</a>

    </div>

    </body>
    </html>
    `);

});

// ================================
// Запуск сервера
// ================================
app.listen(PORT, () => {

    console.log("\n🚀 Сервер запущено");

    console.log("🌍 https://work-ibj8.onrender.com");

    console.log("📱 QR:", "https://work-ibj8.onrender.com/qr.html");

    console.log("📊 Attendance:", "https://work-ibj8.onrender.com/api/attendance");

});
