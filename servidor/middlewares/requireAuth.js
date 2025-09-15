const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ message: 'Token não fornecido' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token inválido' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Buscar usuário no banco (garante que não foi deletado ou alterado)
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Usuário não encontrado' });

    // Anexa os dados do usuário no request
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
