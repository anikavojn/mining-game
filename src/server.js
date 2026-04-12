require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

// Хранилище истории чата (последние 50 сообщений)
let chatHistory = [];
const MAX_HISTORY = 10000;

const app = express();

// Подключение к Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/public'));
app.use(express.static(__dirname + '/src/public'));

console.log('✅ Supabase подключён:', process.env.SUPABASE_URL);

// ========== СОЗДАЁМ HTTP СЕРВЕР И SOCKET.IO ==========
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ========== ОБРАБОТЧИКИ SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('🔌 Пользователь подключился:', socket.id);
        // Сообщения от админа
    socket.on('admin_message', (data) => {
        console.log('👑 АДМИН:', data.text);
        io.emit('admin_message', {
            username: data.username || '👑 АДМИН',
            text: data.text,
            timestamp: new Date().toISOString()
        });
    });
    
    // Запрос истории чата
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

// ========== ВСЕ ТВОИ СУЩЕСТВУЮЩИЕ МАРШРУТЫ (REST API) ==========
// (они остаются без изменений)

// ========== РЕГИСТРАЦИЯ ==========
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

// ========== ЛОГИН ==========
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

// ========== ПРОВЕРКА ТОКЕНА ==========
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

// ========== ПОЛУЧИТЬ ПРОФИЛЬ ==========
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

// ========== СОХРАНИТЬ ПРОГРЕСС ==========
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

// ========== ПОПОЛНЕНИЕ ==========
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

// ========== ВЫВОД ==========
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

// ========== АДМИН МАРШРУТЫ ==========

// Получить всех игроков
app.get('/api/admin/players', async (req, res) => {
    try {
        const { data: players, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json({ success: true, players });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Редактировать игрока
app.put('/api/admin/players/:id', async (req, res) => {
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

// Бан игрока
app.post('/api/admin/players/:id/ban', async (req, res) => {
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

// Разбан игрока
app.post('/api/admin/players/:id/unban', async (req, res) => {
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

// ========== АДМИН МАРШРУТЫ ==========

// Проверка админ-прав (простая версия)
const isAdmin = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === 'admin') {
            req.isAdmin = true;
            return next();
        }
    } catch (err) {}
    
    res.status(403).json({ error: 'Доступ запрещён' });
};

// Админ-логин
app.post('/api/auth/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    // ВРЕМЕННО: простой логин (потом можно перенести в Supabase)
    if (username === 'admin' && password === 'admin123') {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
        return res.json({ success: true, token });
    }
    
    res.status(401).json({ error: 'Неверные данные' });
});

// Получить всех игроков (с защитой)
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

// Редактировать игрока
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

// Бан игрока
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

// Разбан игрока
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

// Отправить сообщение всем (через Socket.IO)
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

// ========== ЗАПУСК (используем server.listen вместо app.listen) ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 Supabase: ${process.env.SUPABASE_URL}`);
    console.log(`🔌 Socket.IO чат активен\n`);
});