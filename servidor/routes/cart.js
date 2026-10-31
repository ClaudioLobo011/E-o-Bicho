const express = require('express');
const router = express.Router();
const User = require('../models/User');
const mongoose = require('mongoose');
const requireAuth = require('../middlewares/requireAuth');
const { applyProductImageUrls } = require('../utils/productImageUrl');
const { validateCartProduct } = require('../utils/cartAvailability');
const productPrices = require('../../scripts/product/product-utils');

// Função auxiliar para calcular o carrinho com a hierarquia de promoções
async function getCalculatedCart(userId) {
    const user = await User.findById(userId).populate('cart.product');
    if (!user) return [];

    const conditionalGroupQuantities = new Map();
    (user.cart || []).forEach((item) => {
        const product = item?.product;
        const promo = product?.promocaoCondicional;
        if (!product || !productPrices.active(promo) || !promo?.produtosDiferentes) return;
        const groupCode = String(promo?.codigoGrupo || '').trim();
        if (!groupCode) return;
        const qty = Math.max(0, Math.trunc(Number(item?.quantity) || 0));
        if (!qty) return;
        const key = `${String(promo?.tipo || '')}|${groupCode}`;
        conditionalGroupQuantities.set(key, (conditionalGroupQuantities.get(key) || 0) + qty);
    });

    const cartWithEffectivePrices = (user.cart || []).map((item) => {
        const product = item?.product;
        if (!product) return null;
        applyProductImageUrls(product);

        const conditional = product.promocaoCondicional;
        const groupQuantity = conditional?.produtosDiferentes && String(conditional?.codigoGrupo || '').trim()
            ? (conditionalGroupQuantities.get(`${conditional.tipo}|${String(conditional.codigoGrupo).trim()}`) || 0)
            : null;
        const calculated = productPrices.price(product, item.quantity, item.isSubscribed, groupQuantity);
        const bestPrice = calculated.unit;
        const appliedPromoText = calculated.label || null;
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
        if (!Number.isSafeInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'Informe uma quantidade inteira válida.' });
        if (req.body.isSubscribed !== undefined && typeof req.body.isSubscribed !== 'boolean') return res.status(400).json({ message: 'Opção de assinatura inválida.' });
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        const cartItemIndex = user.cart.findIndex(item => item.product.toString() === productId);
        const targetQuantity = (cartItemIndex > -1 ? user.cart[cartItemIndex].quantity : 0) + quantity;
        const unavailable = await validateCartProduct(productId, targetQuantity);
        if (unavailable) return res.status(unavailable.status).json(unavailable);

        if (cartItemIndex > -1) {
            user.cart[cartItemIndex].quantity += quantity;
        } else {
            user.cart.push({ product: productId, quantity: quantity });
        }

        if (req.body.isSubscribed !== undefined) {
            const item = user.cart.find(entry => entry.product.toString() === productId);
            item.isSubscribed = req.body.isSubscribed;
        }

        const saved = await User.updateOne({ _id: user._id, __v: user.__v }, { $set: { cart: user.cart.toObject() }, $inc: { __v: 1 } });
        if (saved.modifiedCount !== 1) return res.status(409).json({ message: 'A sacola foi atualizada em outra aba. Confira os itens e tente novamente.' });
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
        if (!Number.isSafeInteger(quantity) || quantity < 0) return res.status(400).json({ message: 'Informe uma quantidade inteira válida.' });
        if (quantity > 0) {
            const unavailable = await validateCartProduct(req.params.productId, quantity);
            if (unavailable) return res.status(unavailable.status).json(unavailable);
        }
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });

        const cartItem = user.cart.find(item => item.product.toString() === req.params.productId);
        if (cartItem) {
            cartItem.quantity = quantity;
        }

        user.cart = user.cart.filter(item => item.quantity > 0);

        const saved = await User.updateOne({ _id: user._id, __v: user.__v }, { $set: { cart: user.cart.toObject() }, $inc: { __v: 1 } });
        if (saved.modifiedCount !== 1) return res.status(409).json({ message: 'A sacola foi atualizada em outra aba. Confira os itens e tente novamente.' });
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
        if (typeof isSubscribed !== 'boolean') return res.status(400).json({ message: 'Opção de assinatura inválida.' });
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

