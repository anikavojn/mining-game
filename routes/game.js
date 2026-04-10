const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

// ПОЛУЧИТЬ ДАННЫЕ ИГРОКА
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        if (user.isBanned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
        
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ОБНОВЛЕНИЕ ИГРОВЫХ ДАННЫХ (сохранение прогресса)
router.post('/save', auth, async (req, res) => {
    try {
        const updateData = req.body;
        const allowedUpdates = [
            'balance', 'chips', 'energy', 'maxEnergy', 'basePower', 'voltage',
            'mining', 'oc', 'shares', 'blocks', 'totalShares', 'totalBlocks',
            'totalEarned', 'miningEarned', 'defense', 'equipmentDamage', 'chipsMined',
            'inv', 'research', 'researchTimers', 'researchCompleted', 'wiringFaults',
            'dust', 'solar', 'powerBank', 'lastActive'
        ];
        
        const filteredUpdate = {};
        for (let key of allowedUpdates) {
            if (updateData[key] !== undefined) {
                filteredUpdate[key] = updateData[key];
            }
        }
        filteredUpdate.lastActive = new Date();
        
        const user = await User.findByIdAndUpdate(
            req.userId,
            filteredUpdate,
            { new: true }
        ).select('-password');
        
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ПОПОЛНЕНИЕ БАЛАНСА
router.post('/deposit', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Неверная сумма' });
        }
        
        const user = await User.findByIdAndUpdate(
            req.userId,
            { $inc: { balance: amount, totalEarned: amount } },
            { new: true }
        ).select('-password');
        
        res.json({ success: true, balance: user.balance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ВЫВОД СРЕДСТВ
router.post('/withdraw', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Неверная сумма' });
        }
        
        const user = await User.findById(req.userId);
        if (user.balance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }
        
        user.balance -= amount;
        await user.save();
        
        res.json({ success: true, balance: user.balance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ПОЛУЧИТЬ ТОП ИГРОКОВ
router.get('/leaderboard', async (req, res) => {
    try {
        const topHash = await User.find({ isBanned: false })
            .sort({ basePower: -1 })
            .limit(10)
            .select('username basePower');
        
        const topBalance = await User.find({ isBanned: false })
            .sort({ balance: -1 })
            .limit(10)
            .select('username balance');
        
        res.json({ success: true, topHash, topBalance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;