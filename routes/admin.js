const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

// Проверка админа
const isAdmin = (req, res, next) => {
    if (req.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    next();
};

// ПОЛУЧИТЬ ВСЕХ ИГРОКОВ
router.get('/players', auth, isAdmin, async (req, res) => {
    try {
        const players = await User.find({})
            .select('-password')
            .sort({ createdAt: -1 });
        res.json({ success: true, players });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// РЕДАКТИРОВАТЬ ИГРОКА
router.put('/players/:id', auth, isAdmin, async (req, res) => {
    try {
        const { balance, chips, basePower, defense, isBanned } = req.body;
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { balance, chips, basePower, defense, isBanned },
            { new: true }
        ).select('-password');
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// БАН ИГРОКА
router.post('/players/:id/ban', auth, isAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isBanned: true },
            { new: true }
        );
        res.json({ success: true, message: `Игрок ${user.username} забанен` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// РАЗБАН
router.post('/players/:id/unban', auth, isAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isBanned: false },
            { new: true }
        );
        res.json({ success: true, message: `Игрок ${user.username} разбанен` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ОТПРАВИТЬ СООБЩЕНИЕ ВСЕМ (через WebSocket)
router.post('/broadcast', auth, isAdmin, async (req, res) => {
    const { message } = req.body;
    // Здесь будет логика отправки через Socket.IO
    req.app.get('io').emit('admin_message', { message, admin: true });
    res.json({ success: true });
});

// ГЛОБАЛЬНАЯ СТАТИСТИКА
router.get('/stats', auth, isAdmin, async (req, res) => {
    try {
        const totalPlayers = await User.countDocuments({ isBanned: false });
        const totalBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]);
        const totalHash = await User.aggregate([{ $group: { _id: null, total: { $sum: '$basePower' } } }]);
        
        res.json({
            success: true,
            stats: {
                totalPlayers,
                totalBalance: totalBalance[0]?.total || 0,
                totalHash: totalHash[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;