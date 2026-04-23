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

// ЗАГРУЗКА ИГРОВЫХ ДАННЫХ (для восстановления прогресса)
router.get('/load', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        if (user.isBanned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
        
        // Собираем все игровые данные из полей пользователя
        const save_data = {
            balance: user.balance || 0,
            chips: user.chips || 0,
            energy: user.energy || 100,
            maxEnergy: user.maxEnergy || 100,
            basePower: user.basePower || 2,
            voltage: user.voltage || 11.8,
            mining: user.mining || false,
            oc: user.oc || false,
            shares: user.shares || 0,
            blocks: user.blocks || 0,
            totalShares: user.totalShares || 0,
            totalBlocks: user.totalBlocks || 0,
            totalEarned: user.totalEarned || 0,
            miningEarned: user.miningEarned || 0,
            equipmentDamage: user.equipmentDamage || 0,
            inv: user.inv || { "cpu_miner": 1 },
            research: user.research || { gpu: false, asic: false, highEnd: false, industrial: false },
            dust: user.dust || 0,
            solar: user.solar || 0,
            powerBank: user.powerBank || 0,
            defense: user.defense || 30,
            antivirus: user.antivirus || 1,
            firewall: user.firewall || false,
            stolen: user.stolen || 0,
            inPool: user.inPool || false,
            poolBonus: user.poolBonus || 0,
            pvpBonus: user.pvpBonus || 0,
            buffs: user.buffs || { hash: 1, luck: 1 },
            cooling: user.cooling || { fan: 65, pump: 50, water: 30 },
            wiringFaults: user.wiringFaults || [false, false, false, false, false, false],
            ach: user.ach || { firstShare: false, firstBlock: false, rich: false, overclocker: false, miner: false },
            researchTimers: user.researchTimers || {},
            researchCompleted: user.researchCompleted || {},
            totalGameTime: user.totalGameTime || 0,
            totalMiningTime: user.totalMiningTime || 0,
            isAdmin: user.isAdmin || false,
            adminSettings: user.adminSettings || {},
            gameSettings: user.gameSettings || {},
            statistics: user.statistics || {}
        };
        
        res.json({ 
            success: true, 
            save_data,
            username: user.username,
            isAdmin: user.isAdmin
        });
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
            'dust', 'solar', 'powerBank', 'antivirus', 'firewall', 'stolen',
            'inPool', 'poolBonus', 'pvpBonus', 'buffs', 'cooling', 'ach',
            'totalGameTime', 'totalMiningTime', 'lastActive',
            'isAdmin', 'adminSettings', 'gameSettings', 'statistics'
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