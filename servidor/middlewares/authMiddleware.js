const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1]; // formato: "Bearer xxx"
    if (!token) {
        return res.status(401).json({ message: 'Token inválido' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // agora o usuário está disponível no req.user
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Token inválido ou expirado' });
    }
}

module.exports = authMiddleware;