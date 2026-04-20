require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

// ========== 1. ОБЪЯВЛЯЕМ ПЕРЕМЕННЫЕ ==========
let chatHistory = [];
const MAX_HISTORY = 10000;
const HISTORY_FILE = './chat-history.json';

// ========== 2. ЗАГРУЖАЕМ ИСТОРИЮ ==========
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        if (Array.isArray(loaded)) {
            chatHistory = loaded;
            console.log(`📜 Загружено ${chatHistory.length} сообщений из файла`);
        }
    } catch (err) {
        console.log('⚠️ Ошибка загрузки истории:', err.message);
    }
}

// ========== 3. ФУНКЦИЯ СОХРАНЕНИЯ ==========
function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory.slice(-MAX_HISTORY), null, 2));
        console.log(`💾 Сохранено ${chatHistory.length} сообщений`);
    } catch (err) {
        console.log('⚠️ Ошибка сохранения:', err.message);
    }
}

// ========== 4. ИНИЦИАЛИЗАЦИЯ ==========
const app = express();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

global.economySettings = {
    shareReward: 0.00002,
    blockReward: 0.05,
    chipsReward: 2,
    sellTax: 30,
    updatedAt: new Date()
};

global.balanceSettings = {
    poolBonus: 15,
    energyCost: 1,
    overheatDmg: 3,
    voltagePen: 15,
    pvpChance: 35,
    pvpFailPen: 15,
    stickFailPen: 15,
    stickWinBonus: 0.000001,
    updatedAt: new Date()
};

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/public'));
app.use(express.static(__dirname + '/src/public'));

console.log('✅ Supabase подключён:', process.env.SUPABASE_URL);

// Добавляем колонку save_data в таблицу users
async function addSaveDataColumn() {
    try {
        const { error } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS save_data JSONB'
        });
        if (error) {
            const { error: alterError } = await supabase
                .from('users')
                .select('save_data')
                .limit(1);
            
            if (alterError && alterError.message.includes('column "save_data" does not exist')) {
                console.log('⚠️ Нужно добавить колонку save_data вручную в Supabase SQL Editor');
                console.log('SQL: ALTER TABLE users ADD COLUMN IF NOT EXISTS save_data JSONB;');
            } else {
                console.log('✅ Колонка save_data уже существует');
            }
        } else {
            console.log('✅ Колонка save_data добавлена');
        }
    } catch (err) {
        console.log('⚠️ Не удалось добавить колонку:', err.message);
    }
}
addSaveDataColumn();

// ========== AUTH MIDDLEWARE (ОПРЕДЕЛЯЕМ РАНЬШЕ ВСЕХ МАРШРУТОВ) ==========
const auth = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Неверный токен' });
    }
};

// ========== СОЗДАЁМ HTTP СЕРВЕР И SOCKET.IO ==========
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ========== ОБРАБОТЧИКИ SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('🔌 Пользователь подключился:', socket.id);

    socket.emit('economy_update', global.balanceSettings);
    
    let lastAdminMessages = new Map();

    socket.on('clear_chat_for_all', (data) => {
        console.log('📡 ПОЛУЧЕНО clear_chat_for_all от:', socket.id);
        
        const token = socket.handshake.auth.token;
        if (!token) {
            console.log('❌ Нет токена');
            return;
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.role !== 'admin') {
                console.log('❌ Не админ, роль:', decoded.role);
                return;
            }
            
            chatHistory = [];
            fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
            
            io.emit('chat_cleared_by_admin');
            io.emit('force_reload');
            
            console.log('🧹 Чат очищен, игроки будут перезагружены');
            
        } catch (err) {
            console.log('❌ Ошибка токена:', err.message);
        }
    });
    
    socket.on('admin_message', (data) => {
        if (!socket.lastAdminMessageTime) socket.lastAdminMessageTime = 0;
        const now = Date.now();
        if (now - socket.lastAdminMessageTime < 500) return;
        socket.lastAdminMessageTime = now;
        
        const historyEntry = {
            username: data.username || '👑 АДМИН',
            message: data.text,
            timestamp: new Date().toISOString(),
            isAdmin: true
        };
        chatHistory.push(historyEntry);
        if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
        saveHistory();
        
        io.emit('admin_message', {
            username: data.username || '👑 АДМИН',
            text: data.text,
            timestamp: new Date().toISOString()
        });
        
        console.log('📢 Админ:', data.text);
    });
    
    socket.on('request_history', () => {
        socket.emit('chat_history', chatHistory);
    });
    
    socket.on('user_online', (username) => {
        socket.username = username;
        console.log('👤 Пользователь в сети:', username);
        const onlineUsers = [];
        for (let [id, s] of io.sockets.sockets) {
            if (s.username) onlineUsers.push(s.username);
        }
        io.emit('online_users', onlineUsers);
    });
    
    socket.on('chat_message', (data) => {
        if (!data.timestamp) data.timestamp = new Date().toISOString();
        chatHistory.push(data);
        if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
        saveHistory();
        
        console.log('💬', data.username + ':', data.message);
        io.emit('chat_message', data);
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Пользователь отключился:', socket.id);
        const onlineUsers = [];
        for (let [id, s] of io.sockets.sockets) {
            if (s.username) onlineUsers.push(s.username);
        }
        io.emit('online_users', onlineUsers);
    });
});
// ========== API МАРШРУТЫ ==========

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        const { data: existing } = await supabase
            .from('users')
            .select('username')
            .eq('username', username);
        
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const { data: user, error } = await supabase
            .from('users')
            .insert({
                username,
                email,
                password: hashedPassword,
                inv: { cpu_miner: 1 }
            })
            .select()
            .single();
        
        if (error) throw error;
        
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, balance: user.balance }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Логин
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();
        
        if (!user) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }
        
        if (user.is_banned) {
            return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
        }
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }
        
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                balance: user.balance,
                chips: user.chips,
                base_power: user.base_power
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Админ middleware
const isAdmin = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === 'admin') {
            req.isAdmin = true;
            return next();
        }
    } catch (err) {
        console.log('❌ Ошибка верификации токена:', err.message);
    }
    
    res.status(403).json({ error: 'Доступ запрещён' });
};

// Админ логин
app.post('/api/auth/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin123') {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '365d' });
        return res.json({ success: true, token });
    }
    
    res.status(401).json({ error: 'Неверные данные' });
});

// Админ маршруты
app.get('/api/admin/players', isAdmin, async (req, res) => {
    try {
        const { data: players, error } = await supabase
            .from('users')
            .select('id, username, balance, chips, base_power, defense, is_banned, created_at')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json({ success: true, players });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/players/:id', isAdmin, async (req, res) => {
    try {
        const { balance, chips, base_power, defense, is_banned } = req.body;
        
        const { data: user, error } = await supabase
            .from('users')
            .update({ balance, chips, base_power, defense, is_banned })
            .eq('id', req.params.id)
            .select()
            .single();
        
        if (error) throw error;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/players/:id/ban', isAdmin, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ is_banned: true })
            .eq('id', req.params.id)
            .select()
            .single();
        
        if (error) throw error;
        res.json({ success: true, message: `Игрок ${user.username} забанен` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/players/:id/unban', isAdmin, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ is_banned: false })
            .eq('id', req.params.id)
            .select()
            .single();
        
        if (error) throw error;
        res.json({ success: true, message: `Игрок ${user.username} разбанен` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/broadcast', isAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        if (message && io) {
            io.emit('admin_message', {
                text: message,
                timestamp: new Date().toISOString()
            });
            res.json({ success: true, message: 'Сообщение отправлено' });
        } else {
            res.status(400).json({ error: 'Нет текста сообщения' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/economy', isAdmin, async (req, res) => {
    try {
        const { shareReward, blockReward, chipsReward, sellTax } = req.body;
        
        global.economySettings = {
            shareReward: shareReward || 0.00002,
            blockReward: blockReward || 0.05,
            chipsReward: chipsReward || 2,
            sellTax: sellTax || 30,
            updatedAt: new Date()
        };
        
        io.emit('economy_update', global.economySettings);
        
        console.log('💰 Экономика обновлена:', global.economySettings);
        res.json({ success: true, settings: global.economySettings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/economy', async (req, res) => {
    res.json({ success: true, settings: global.economySettings || {
        shareReward: 0.00002,
        blockReward: 0.05,
        chipsReward: 2,
        sellTax: 30
    }});
});

// ========== МАРШРУТЫ БАЛАНСИРОВКИ ==========

app.get('/api/admin/balance', isAdmin, async (req, res) => {
    try {
        res.json({ success: true, settings: global.balanceSettings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/balance', isAdmin, async (req, res) => {
    try {
        const {
            poolBonus,
            energyCost,
            overheatDmg,
            voltagePen,
            pvpChance,
            pvpFailPen,
            stickFailPen,
            stickWinBonus
        } = req.body;
        
        global.balanceSettings = {
            poolBonus: poolBonus !== undefined ? poolBonus : global.balanceSettings.poolBonus,
            energyCost: energyCost !== undefined ? energyCost : global.balanceSettings.energyCost,
            overheatDmg: overheatDmg !== undefined ? overheatDmg : global.balanceSettings.overheatDmg,
            voltagePen: voltagePen !== undefined ? voltagePen : global.balanceSettings.voltagePen,
            pvpChance: pvpChance !== undefined ? pvpChance : global.balanceSettings.pvpChance,
            pvpFailPen: pvpFailPen !== undefined ? pvpFailPen : global.balanceSettings.pvpFailPen,
            stickFailPen: stickFailPen !== undefined ? stickFailPen : global.balanceSettings.stickFailPen,
            stickWinBonus: stickWinBonus !== undefined ? stickWinBonus : global.balanceSettings.stickWinBonus,
            updatedAt: new Date()
        };
        
        io.emit('economy_update', global.balanceSettings);
        
        console.log('⚖️ Балансировка обновлена:', global.balanceSettings);
        res.json({ success: true, settings: global.balanceSettings });
        
    } catch (err) {
        console.error('❌ Ошибка сохранения балансировки:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========== ИГРОВЫЕ МАРШРУТЫ ==========

// Получить профиль
app.get('/api/game/profile', auth, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.userId)
            .single();
        
        if (error) throw error;
        delete user.password;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Сохранить прогресс
app.post('/api/game/save', auth, async (req, res) => {
    try {
        const data = req.body;
        
        const { data: user, error } = await supabase
            .from('users')
            .update({
                balance: data.balance,
                chips: data.chips,
                energy: data.energy,
                base_power: data.basePower,
                shares: data.shares,
                blocks: data.blocks,
                total_shares: data.totalShares,
                total_blocks: data.totalBlocks,
                total_earned: data.totalEarned,
                mining_earned: data.miningEarned,
                equipment_damage: data.equipmentDamage,
                inv: data.inv,
                research: data.research,
                dust: data.dust,
                solar: data.solar,
                power_bank: data.powerBank,
                save_data: data.save_data,
                last_active: new Date()
            })
            .eq('id', req.userId)
            .select()
            .single();
        
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Пополнение
app.post('/api/game/deposit', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Неверная сумма' });
        }
        
        const { data: user, error } = await supabase
            .from('users')
            .select('balance, total_earned')
            .eq('id', req.userId)
            .single();
        
        const newBalance = user.balance + amount;
        
        const { data: updated, error: updateError } = await supabase
            .from('users')
            .update({ balance: newBalance, total_earned: user.total_earned + amount })
            .eq('id', req.userId)
            .select()
            .single();
        
        res.json({ success: true, balance: updated.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Вывод
app.post('/api/game/withdraw', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Неверная сумма' });
        }
        
        const { data: user, error } = await supabase
            .from('users')
            .select('balance')
            .eq('id', req.userId)
            .single();
        
        if (user.balance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }
        
        const newBalance = user.balance - amount;
        
        const { data: updated, error: updateError } = await supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('id', req.userId)
            .select()
            .single();
        
        res.json({ success: true, balance: updated.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log('🔌 Socket.IO чат активен');
    console.log('⚖️ Балансировка загружена:', global.balanceSettings);
});