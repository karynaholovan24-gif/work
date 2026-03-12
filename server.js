// =====================================
// 6. Відмітка приходу (з геолокацією)
// =====================================
app.post('/api/check-in', (req, res) => {
    const { token, employee, latitude, longitude } = req.body;
    const kyivTime = dayjs().tz('Europe/Kiev').format('YYYY-MM-DD HH:mm:ss');
    
    console.log('\n📝 ===== НОВА ВІДМІТКА =====');
    console.log('🔍 Отриманий token з QR:', token);
    console.log('👤 Працівник:', employee);
    console.log('📍 Координати:', latitude, longitude);
    console.log('🕐 Час відмітки (київський):', dayjs().tz('Europe/Kiev').format('DD.MM.YYYY HH:mm:ss'));
    
    if (!token || !employee) {
        console.log('❌ Немає даних');
        return res.json({ success: false, message: '❌ Немає даних' });
    }
    
    // ========== ПЕРЕВІРКА ГЕОЛОКАЦІЇ ==========
    // Координати офісу (встав свої!)
    const OFFICE_LAT = 48.92968597521573;  // Широта
    const OFFICE_LON = 24.707211205709715; // Довгота
    const MAX_DISTANCE = 0.05; // 50 метрів (0.05 км)
    
    // Функція розрахунку відстані між двома точками
    function getDistanceFromOffice(lat, lon) {
        const R = 6371; // Радіус Землі в кілометрах
        const dLat = (lat - OFFICE_LAT) * Math.PI / 180;
        const dLon = (lon - OFFICE_LON) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(OFFICE_LAT * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // відстань в кілометрах
    }
    
    // Перевіряємо, чи передані координати
    if (!latitude || !longitude) {
        console.log('❌ Немає координат');
        return res.json({ 
            success: false, 
            message: '❌ Не вдалося отримати геолокацію. Дозвольте доступ до місця розташування' 
        });
    }
    
    // Розраховуємо відстань
    const distance = getDistanceFromOffice(parseFloat(latitude), parseFloat(longitude));
    console.log('📏 Відстань до офісу:', (distance * 1000).toFixed(0), 'метрів');
    
    // Перевіряємо, чи в межах дозволеної зони
    if (distance > MAX_DISTANCE) {
        console.log('❌ За межами офісу');
        return res.json({ 
            success: false, 
            message: '❌ Ви за межами дозволеної зони. Відмітитись можна тільки в офісі' 
        });
    }
    console.log('✅ Геолокація в межах офісу');
    // ========== КІНЕЦЬ ПЕРЕВІРКИ ==========
    
    // Далі йде перевірка токена (як і було)
    if (activeTokens.has(token)) {
        console.log('✅ Токен ЗНАЙДЕНО в пам\'яті!');
        
        activeTokens.delete(token);
        db.run('DELETE FROM tokens WHERE token = ?', [token]);
        
        db.run('INSERT INTO attendance (employee, token, time) VALUES (?, ?, ?)', 
            [employee, token, kyivTime], 
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
            
            db.run('INSERT INTO attendance (employee, token, time) VALUES (?, ?, ?)', 
                [employee, token, kyivTime], 
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
            db.run('INSERT INTO tokens (token, created_at) VALUES (?, ?)', [token, kyivTime]);
            
            db.run('INSERT INTO attendance (employee, token, time) VALUES (?, ?, ?)', 
                [employee, token, kyivTime], 
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
