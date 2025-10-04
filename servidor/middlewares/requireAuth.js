const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getRequestToken } = require('./getRequestToken');

module.exports = async function requireAuth(req, res, next) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Usuário não encontrado' });
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role
    };

    next();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: 'Não autorizado' });
  }
};
