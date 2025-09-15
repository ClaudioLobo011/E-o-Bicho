const express = require('express');
const router = express.Router();
const User = require('../models/User');
const requireAuth = require('../middlewares/requireAuth');

// Middleware para garantir que o usuário só acesse os próprios favoritos (ou admin_master)
function authorizeFavoritesAccess(req, res, next) {
    if (req.user.id !== req.params.userId && req.user.role !== 'admin_master') {
        return res.status(403).json({ message: 'Acesso negado' });
    }
    next();
}

// GET /api/favorites/:userId - Busca a lista de IDs de favoritos de um utilizador
router.get('/:userId', requireAuth, authorizeFavoritesAccess, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('favorites');
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });
        res.json(user.favorites);
    } catch (error) {
        console.error('Erro ao buscar favoritos:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// POST /api/favorites/:userId - Adiciona um produto aos favoritos
router.post('/:userId', requireAuth, authorizeFavoritesAccess, async (req, res) => {
    const { productId } = req.body;
    try {
        const user = await User.findByIdAndUpdate(
            req.params.userId,
            { $addToSet: { favorites: productId } },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });
        res.status(200).json(user.favorites);
    } catch (error) {
        console.error('Erro ao adicionar favorito:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// DELETE /api/favorites/:userId/:productId - Remove um produto dos favoritos
router.delete('/:userId/:productId', requireAuth, authorizeFavoritesAccess, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.userId,
            { $pull: { favorites: req.params.productId } },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });
        res.status(200).json(user.favorites);
    } catch (error) {
        console.error('Erro ao remover favorito:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

module.exports = router;
