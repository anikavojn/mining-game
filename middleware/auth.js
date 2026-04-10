const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        req.adminId = decoded.adminId;
        req.role = decoded.role || 'user';
        next();
    } catch (error) {
        res.status(401).json({ error: 'Неверный токен' });
    }
};