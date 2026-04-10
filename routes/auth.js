const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');
const router = express.Router();

// РЕГИСТРАЦИЯ ИГРОКА
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = new User({
            username,
            email,
            password: hashedPassword,
            inv: { cpu_miner: 1 }
        });
        
        await user.save();
        
        const token = jwt.sign({ userId: user._id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                username: user.username,
                balance: user.balance
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ЛОГИН ИГРОКА
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }
        
        if (user.isBanned) {
            return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
        }
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }
        
        user.lastActive = new Date();
        await user.save();
        
        const token = jwt.sign({ userId: user._id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                username: user.username,
                balance: user.balance,
                chips: user.chips,
                basePower: user.basePower
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// АДМИН ЛОГИН
router.post('/admin/login', async (req, res) => {
    try {
        const { username, password, secretKey } = req.body;
        
        if (secretKey !== process.env.ADMIN_SECRET_KEY) {
            return res.status(401).json({ error: 'Неверный ключ доступа' });
        }
        
        const admin = await Admin.findOne({ username });
        if (!admin) {
            return res.status(400).json({ error: 'Администратор не найден' });
        }
        
        const isValid = await admin.comparePassword(password);
        if (!isValid) {
            return res.status(400).json({ error: 'Неверный пароль' });
        }
        
        const token = jwt.sign({ adminId: admin._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
        
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// СОЗДАНИЕ ПЕРВОГО АДМИНА (запустить один раз)
router.post('/admin/setup', async (req, res) => {
    try {
        const { secretKey, username, password } = req.body;
        
        if (secretKey !== process.env.ADMIN_SECRET_KEY) {
            return res.status(401).json({ error: 'Неверный ключ' });
        }
        
        const existing = await Admin.findOne({ username });
        if (existing) {
            return res.status(400).json({ error: 'Админ уже существует' });
        }
        
        const admin = new Admin({ username, password });
        await admin.save();
        
        res.json({ success: true, message: 'Админ создан' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;