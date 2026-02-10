const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ message: 'Token nao fornecido' });
    }

    const token = authHeader.split(' ')[1]; // formato: "Bearer xxx"
    if (!token) {
        return res.status(401).json({ message: 'Token invalido' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('email role').lean();
        if (!user) {
            return res.status(401).json({ message: 'Usuario nao encontrado' });
        }
        req.user = {
            id: user._id.toString(),
            email: user.email,
            role: user.role
        };
        next();
    } catch (error) {
        console.error('authMiddleware:', error);
        if (error && error.name === 'TokenExpiredError') {
            res.set('X-Auth-Reason', 'token-expired');
            return res.status(401).json({ message: 'Token expirado', code: 'TOKEN_EXPIRED', logout: true });
        }
        return res.status(403).json({ message: 'Token invalido ou expirado' });
    }
}

module.exports = authMiddleware;
