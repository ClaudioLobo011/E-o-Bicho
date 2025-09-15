const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Setting = require('../models/Setting');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// GET /api/promocoes/clube/desconto-global (público)
router.get('/clube/desconto-global', async (req, res) => {
    try {
        const discountSetting = await Setting.findOne({ key: 'descontoGlobalClube' });
        res.json({ percentage: discountSetting ? discountSetting.value : 0 });
    } catch (error) {
        console.error("Erro ao buscar configuração de desconto:", error);
        res.status(500).json({ message: 'Erro ao buscar configuração de desconto.' });
    }
});

// POST /api/promocoes/clube/desconto-global (restrito)
router.post(
    '/clube/desconto-global',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        const { percentage } = req.body;

        if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
            return res.status(400).json({ message: 'A percentagem deve ser um número entre 0 e 100.' });
        }

        try {
            await Setting.findOneAndUpdate(
                { key: 'descontoGlobalClube' },
                { value: percentage },
                { upsert: true }
            );

            if (percentage === 0) {
                await Product.updateMany({}, { $set: { precoClube: null } });
                return res.json({ message: 'Desconto do Clube removido de todos os produtos.' });
            }

            const discountMultiplier = 1 - (percentage / 100);
            const products = await Product.find({});
            const bulkOps = products.map(product => ({
                updateOne: {
                    filter: { _id: product._id },
                    update: { $set: { precoClube: product.venda * discountMultiplier } }
                }
            }));

            if (bulkOps.length > 0) {
                await Product.bulkWrite(bulkOps);
            }

            res.json({ message: `Desconto de ${percentage}% aplicado a ${products.length} produtos.` });
        } catch (error) {
            console.error('Erro ao aplicar desconto global:', error);
            res.status(500).json({ message: 'Erro no servidor ao aplicar desconto.' });
        }
    }
);

// GET /api/promocoes/produtos (público)
router.get('/produtos', async (req, res) => {
    try {
        const promoProducts = await Product.find({ 'promocao.ativa': true });
        res.json(promoProducts);
    } catch (error) {
        console.error("Erro ao buscar produtos em promoção:", error);
        res.status(500).json({ message: 'Erro ao buscar produtos em promoção.' });
    }
});

// POST /api/promocoes/produtos/:id (restrito)
router.post(
    '/produtos/:id',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        const { id } = req.params;
        const { porcentagem } = req.body;

        try {
            const updatedProduct = await Product.findByIdAndUpdate(
                id,
                { $set: { 'promocao.ativa': true, 'promocao.porcentagem': porcentagem } },
                { new: true }
            );
            if (!updatedProduct) return res.status(404).json({ message: 'Produto não encontrado.' });
            res.json(updatedProduct);
        } catch (error) {
            console.error("Erro ao atualizar promoção:", error);
            res.status(500).json({ message: 'Erro ao atualizar a promoção do produto.' });
        }
    }
);

// DELETE /api/promocoes/produtos/:id (restrito)
router.delete(
    '/produtos/:id',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        const { id } = req.params;
        try {
            const updatedProduct = await Product.findByIdAndUpdate(
                id,
                { $set: { 'promocao.ativa': false, 'promocao.porcentagem': 0 } },
                { new: true }
            );
            if (!updatedProduct) return res.status(404).json({ message: 'Produto não encontrado.' });
            res.json({ message: 'Promoção removida com sucesso.' });
        } catch (error) {
            console.error("Erro ao remover promoção:", error);
            res.status(500).json({ message: 'Erro ao remover a promoção do produto.' });
        }
    }
);

// GET /api/promocoes/condicional (público)
router.get('/condicional', async (req, res) => {
    try {
        const products = await Product.find({ 'promocaoCondicional.ativa': true });
        res.json(products);
    } catch (error) {
        console.error("Erro ao buscar promoções condicionais:", error);
        res.status(500).json({ message: 'Erro ao buscar promoções condicionais.' });
    }
});

// POST /api/promocoes/condicional/:id (restrito)
router.post(
    '/condicional/:id',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        const { id } = req.params;
        const { tipo, leve, pague, quantidadeMinima, descontoPorcentagem } = req.body;

        const updateData = {
            'promocaoCondicional.ativa': true,
            'promocaoCondicional.tipo': tipo,
            'promocaoCondicional.leve': leve,
            'promocaoCondicional.pague': pague,
            'promocaoCondicional.quantidadeMinima': quantidadeMinima,
            'promocaoCondicional.descontoPorcentagem': descontoPorcentagem,
        };

        try {
            const updatedProduct = await Product.findByIdAndUpdate(id, { $set: updateData }, { new: true });
            if (!updatedProduct) return res.status(404).json({ message: 'Produto não encontrado.' });
            res.json(updatedProduct);
        } catch (error) {
            console.error("Erro ao salvar promoção condicional:", error);
            res.status(500).json({ message: 'Erro ao salvar promoção condicional.' });
        }
    }
);

// DELETE /api/promocoes/condicional/:id (restrito)
router.delete(
    '/condicional/:id',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        const { id } = req.params;
        try {
            await Product.findByIdAndUpdate(id, { $set: { 'promocaoCondicional.ativa': false } });
            res.json({ message: 'Promoção condicional removida.' });
        } catch (error) {
            console.error("Erro ao remover promoção condicional:", error);
            res.status(500).json({ message: 'Erro ao remover promoção condicional.' });
        }
    }
);

module.exports = router;
