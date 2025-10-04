const jwt = require('jsonwebtoken');
const { getRequestToken } = require('./getRequestToken');

function authMiddleware(req, res, next) {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Token não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(403).json({ message: 'Token inválido ou expirado' });
  }
}

module.exports = authMiddleware;
