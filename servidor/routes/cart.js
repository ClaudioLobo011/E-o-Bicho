const express = require('express');
const router = express.Router();
const User = require('../models/User');
const mongoose = require('mongoose');
const requireAuth = require('../middlewares/requireAuth');
const { applyProductImageUrls } = require('../utils/productImageUrl');

// Função auxiliar para calcular o carrinho com a hierarquia de promoções
async function getCalculatedCart(userId) {
    const user = await User.findById(userId).populate('cart.product');
    if (!user) return []; // Retorna um carrinho vazio se o utilizador não for encontrado

    const cartWithEffectivePrices = user.cart.map(item => {
        const product = item.product;
        if (!product) return null;
        applyProductImageUrls(product);

        let bestPrice = product.venda;
        let appliedPromoText = null;

        // 1. Promoção Individual
        if (product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0) {
            const promoPrice = product.venda * (1 - product.promocao.porcentagem / 100);
            if (promoPrice < bestPrice) {
                bestPrice = promoPrice;
                appliedPromoText = `${product.promocao.porcentagem}% OFF`;
            }
        }

        // 2. Promoção Condicional (Acima de X unidades)
        if (product.promocaoCondicional && product.promocaoCondicional.ativa && product.promocaoCondicional.tipo === 'acima_de') {
            if (item.quantity >= product.promocaoCondicional.quantidadeMinima) {
                const conditionalPrice = product.venda * (1 - product.promocaoCondicional.descontoPorcentagem / 100);
                if (conditionalPrice < bestPrice) {
                    bestPrice = conditionalPrice;
                    appliedPromoText = `Acima de ${product.promocaoCondicional.quantidadeMinima} un.`;
                }
            }
        }

        // 3. Promoção Condicional (Leve X, Pague Y)
        if (product.promocaoCondicional && product.promocaoCondicional.ativa && product.promocaoCondicional.tipo === 'leve_pague') {
            const { leve, pague } = product.promocaoCondicional;
            if (leve > 0 && item.quantity >= leve) {
                const promoPacks = Math.floor(item.quantity / leve);
                const paidItems = promoPacks * pague;
                const remainingItems = item.quantity % leve;

                const totalLevePaguePrice = (paidItems + remainingItems) * product.venda;
                const effectiveLevePaguePrice = totalLevePaguePrice / item.quantity;

                if (effectiveLevePaguePrice < bestPrice) {
                    bestPrice = effectiveLevePaguePrice;
                    appliedPromoText = `Leve ${leve} Pague ${pague}`;
                }
            }
        }

        // 4. Preço Club
        if (item.isSubscribed && product.precoClube && product.precoClube > 0) {
            if (product.precoClube < bestPrice) {
                bestPrice = product.precoClube;
                appliedPromoText = 'Preço Club';
            }
        }

        return {
            _id: item._id,
            quantity: item.quantity,
            product: item.product,
            isSubscribed: item.isSubscribed,
            effectivePrice: bestPrice,
            promoText: appliedPromoText
        };
    }).filter(item => item !== null);

    return cartWithEffectivePrices;
}

// Middleware para validar se é o dono do carrinho ou admin_master
function authorizeCartAccess(req, res, next) {
    if (req.user.id !== req.params.userId && req.user.role !== 'admin_master') {
        return res.status(403).json({ message: 'Acesso negado' });
    }
    next();
}

// GET /api/cart/:userId - Busca o carrinho de um utilizador
router.get('/:userId', requireAuth, authorizeCartAccess, async (req, res) => {
    try {
        const calculatedCart = await getCalculatedCart(req.params.userId);
        res.json(calculatedCart);
    } catch (error) {
        console.error("Erro ao buscar carrinho:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// POST /api/cart/:userId - Adiciona um item ao carrinho
router.post('/:userId', requireAuth, authorizeCartAccess, async (req, res) => {
    const { productId, quantity } = req.body;
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        const cartItemIndex = user.cart.findIndex(item => item.product.toString() === productId);

        if (cartItemIndex > -1) {
            user.cart[cartItemIndex].quantity += quantity;
        } else {
            user.cart.push({ product: productId, quantity: quantity });
        }

        await user.save();
        const populatedUser = await User.findById(req.params.userId).populate('cart.product');
        res.status(200).json(populatedUser.cart);
    } catch (error) {
        console.error("Erro ao adicionar item ao carrinho:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// PUT /api/cart/:userId/:productId - Atualiza a quantidade de um item
router.put('/:userId/:productId', requireAuth, authorizeCartAccess, async (req, res) => {
    const { quantity } = req.body;
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        const cartItem = user.cart.find(item => item.product.toString() === req.params.productId);
        if (cartItem) {
            cartItem.quantity = quantity;
        }

        user.cart = user.cart.filter(item => item.quantity > 0);

        await user.save();
        const populatedUser = await User.findById(req.params.userId).populate('cart.product');
        res.status(200).json(populatedUser.cart);
    } catch (error) {
        console.error("Erro ao atualizar carrinho:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// PUT /api/cart/:userId/:productId/subscribe - Liga/desliga a assinatura de um item
router.put('/:userId/:productId/subscribe', requireAuth, authorizeCartAccess, async (req, res) => {
    const { isSubscribed } = req.body;
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        const cartItem = user.cart.find(item => item.product.toString() === req.params.productId);
        if (cartItem) {
            cartItem.isSubscribed = isSubscribed;
            await user.save();
        }

        const calculatedCart = await getCalculatedCart(req.params.userId);
        res.status(200).json(calculatedCart);
    } catch (error) {
        console.error("Erro ao atualizar assinatura:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// DELETE /api/cart/:userId/:productId - Remove um item do carrinho
router.delete('/:userId/:productId', requireAuth, authorizeCartAccess, async (req, res) => {
    try {
        await User.updateOne(
            { _id: req.params.userId },
            { $pull: { cart: { product: req.params.productId } } }
        );
        const populatedUser = await User.findById(req.params.userId).populate('cart.product');
        res.status(200).json(populatedUser.cart);
    } catch (error) {
        console.error("Erro ao remover item do carrinho:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

module.exports = router;
