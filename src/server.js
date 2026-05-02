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
            console.log(`📜 Загружено ${chatHistory.length} сообщений`);
        }
    } catch (err) {}
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory.slice(-MAX_HISTORY), null, 2));
    } catch (err) {}
}

// ========== 3. ИНИЦИАЛИЗАЦИЯ ==========
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

console.log('✅ Сервер запускается...');

// ========== ПРИНУДИТЕЛЬНОЕ СОЗДАНИЕ КОЛОНКИ save_data ==========
async function ensureSaveDataColumn() {
    try {
        // Пробуем добавить колонку через прямой SQL (если есть права)
        const { error } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS save_data JSONB;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS total_blocks INTEGER DEFAULT 0;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS mining_earned DECIMAL(20,8) DEFAULT 0;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS equipment_damage INTEGER DEFAULT 0;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS solar INTEGER DEFAULT 0;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS power_bank INTEGER DEFAULT 0;' +
                 'ALTER TABLE users ADD COLUMN IF NOT EXISTS pvp_bonus INTEGER DEFAULT 0;'
        });
        if (error) {
            console.log('⚠️ Не удалось добавить колонки автоматически. Выполните SQL вручную (см. инструкцию).');
        } else {
            console.log('✅ Колонки добавлены');
        }
    } catch (e) {
        console.log('⚠️ exec_sql недоступен, колонки нужно добавить вручную');
    }
}
ensureSaveDataColumn();

// ========== AUTH MIDDLEWARE ==========
const auth = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded.userId) {
            return res.status(401).json({ error: 'Неверный токен (нет userId)' });
        }
        req.userId = decoded.userId;
        console.log(`🔐 Auth: userId=${req.userId}`);
        next();
    } catch (err) {
        console.log('❌ Ошибка токена:', err.message);
        res.status(401).json({ error: 'Неверный токен' });
    }
};

// ========== HTTP & SOCKET ==========
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
    socket.emit('economy_update', global.balanceSettings);
    socket.on('clear_chat_for_all', (data) => { /* ... */ });
    socket.on('admin_message', (data) => { /* ... */ });
    socket.on('request_history', () => socket.emit('chat_history', chatHistory));
    socket.on('user_online', (username) => { socket.username = username; });
    socket.on('chat_message', (data) => {
        chatHistory.push(data);
        if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
        saveHistory();
        io.emit('chat_message', data);
    });
});

// ========== РЕГИСТРАЦИЯ (ИСПРАВЛЕНА) ==========
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        console.log(`📝 Регистрация: ${username}`);

        // Проверка существования
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .maybeSingle();
        if (existing) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // СТАРТОВЫЙ ПРОГРЕСС (полный)
        const defaultSaveData = {
            balance: 0.00000000,
            chips: 0,
            energy: 100,
            maxEnergy: 100,
            basePower: 2,
            voltage: 11.8,
            oc: false,
            shares: 0,
            blocks: 0,
            totalShares: 0,
            totalBlocks: 0,
            totalEarned: 0,
            miningEarned: 0,
            equipmentDamage: 0,
            inv: { cpu_miner: 1 },
            research: { gpu: false, asic: false, highEnd: false, industrial: false },
            dust: 0,
            solar: 0,
            powerBank: 0,
            pvpBonus: 0,
            researchTimers: {},
            researchCompleted: {}
        };

        // Вставка нового пользователя
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert({
                username,
                email,
                password: hashedPassword,
                balance: 0.00000000,
                chips: 0,
                base_power: 2,
                inv: { cpu_miner: 1 },
                save_data: defaultSaveData,
                total_shares: 0,
                total_blocks: 0,
                mining_earned: 0,
                equipment_damage: 0,
                solar: 0,
                power_bank: 0,
                pvp_bonus: 0,
                last_active: new Date(),
                is_banned: false,
                defense: 30,
                antivirus: 1,
                firewall: false
            })
            .select('id, username, balance, chips, base_power')
            .single();

        if (insertError) throw insertError;

        // Генерируем ТОЛЬКО ДЛЯ ЭТОГО ПОЛЬЗОВАТЕЛЯ
        const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        console.log(`✅ Новый пользователь ID=${newUser.id}, токен выдан`);

        res.json({ success: true, token, user: newUser });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========== ЛОГИН (ИСПРАВЛЕН) ==========
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`🔑 Логин: ${username}`);

        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (!user) return res.status(400).json({ error: 'Неверные данные' });
        if (user.is_banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(400).json({ error: 'Неверные данные' });

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        console.log(`✅ Логин пользователя ID=${user.id}`);

        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, balance: user.balance, chips: user.chips, base_power: user.base_power }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== ОСТАЛЬНЫЕ МАРШРУТЫ (без изменений) ==========
const isAdmin = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === 'admin') { req.isAdmin = true; return next(); }
    } catch (err) {}
    res.status(403).json({ error: 'Доступ запрещён' });
};

app.post('/api/auth/admin/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '365d' });
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: 'Неверные данные' });
});

app.get('/api/admin/players', isAdmin, async (req, res) => {
    const { data: players, error } = await supabase.from('users').select('id, username, balance, chips, base_power, defense, is_banned, created_at').order('created_at', { ascending: false });
    error ? res.status(500).json({ error }) : res.json({ success: true, players });
});
app.put('/api/admin/players/:id', isAdmin, async (req, res) => { /* аналогично */ });
app.post('/api/admin/players/:id/ban', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/players/:id/unban', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/broadcast', isAdmin, async (req, res) => { /* ... */ });
app.post('/api/admin/economy', isAdmin, async (req, res) => { /* ... */ });
app.get('/api/admin/economy', async (req, res) => { /* ... */ });
app.get('/api/admin/balance', auth, async (req, res) => { res.json({ success: true, settings: global.balanceSettings }); });
app.post('/api/admin/balance', isAdmin, async (req, res) => { /* ... */ });

// ========== ИГРОВЫЕ МАРШРУТЫ ==========
app.get('/api/game/profile', auth, async (req, res) => {
    try {
        console.log(`📥 Профиль для user ${req.userId}`);
        const { data: user, error } = await supabase.from('users').select('*').eq('id', req.userId).single();
        if (error) throw error;
        delete user.password;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/game/save', auth, async (req, res) => {
    try {
        const data = req.body;
        const updateData = {
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
        };
        const { data: user, error } = await supabase.from('users').update(updateData).eq('id', req.userId).select().single();
        if (error) throw error;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/game/deposit', auth, async (req, res) => { /* без изменений */ });
app.post('/api/game/withdraw', auth, async (req, res) => { /* без изменений */ });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log('⚠️ ВАЖНО: Выполните в Supabase SQL Editor:');
    console.log('ALTER TABLE users ADD COLUMN IF NOT EXISTS save_data JSONB;');
});