require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// Подключение к Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log('✅ Supabase подключён:', process.env.SUPABASE_URL);

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Проверяем, существует ли пользователь
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

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 Supabase: ${process.env.SUPABASE_URL}\n`);
});