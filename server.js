const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 


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


function generateToken() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}


app.get('/api/generate-token', (req, res) => {
    const token = generateToken();
    
    db.run('INSERT INTO tokens (token) VALUES (?)', [token], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Помилка сервера' });
        }
        res.json({ token: token });
    });
});


app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;

  
    if (!token || !employee || !latitude || !longitude) {
        return res.json({ 
            success: false, 
            message: '❌ Не всі дані передано' 
        });
    }

   
    const OFFICE_LAT = 48.92968597521573;  
    const OFFICE_LON = 24.707211205709715;  
    const MAX_DISTANCE = 0.05;   

    
    db.get(
        'SELECT * FROM tokens WHERE token = ? AND is_used = 0 AND datetime(created_at) > datetime("now", "-30 seconds")',
        [token],
        (err, row) => {
            if (err || !row) {
                return res.json({ 
                    success: false, 
                    message: '❌ Недійсний або прострочений токен' 
                });
            }

            
            db.run('UPDATE tokens SET is_used = 1 WHERE token = ?', [token]);

            
            db.run(
                'INSERT INTO attendance (employee_name, token, latitude, longitude) VALUES (?, ?, ?, ?)',
                [employee, token, latitude, longitude],
                function(err) {
                    if (err) {
                        return res.json({ success: false, message: '❌ Помилка запису' });
                    }
                    
                    res.json({ 
                        success: true, 
                        message: '✅ Прихід зафіксовано' 
                    });
                }
            );
        }
    );
});


app.get('/api/attendance', (req, res) => {
    db.all('SELECT * FROM attendance ORDER BY check_in_time DESC', [], (err, rows) => {
        if (err) {
            res.json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});


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


app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущено на http://localhost:${PORT}`);
    console.log(`📱 QR сторінка: http://localhost:${PORT}/qr.html`);
    console.log(`👤 Check-in: http://localhost:${PORT}/check.html?token=test`);
    console.log(`📊 Відмітки: http://localhost:${PORT}/api/attendance\n`);
});