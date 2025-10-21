const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Deposit = require('../models/Deposit');
const Product = require('../models/Product');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const normalizeString = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

const extractNumericValue = (code) => {
    const normalized = normalizeString(code);
    if (!normalized) return 0;
    const matches = normalized.match(/\d+/g);
    if (!matches) {
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return matches.reduce((max, part) => {
        const parsed = Number(part);
        return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);
};

const generateNextSequentialCode = async () => {
    const deposits = await Deposit.find({}, 'codigo').lean();
    const highest = deposits.reduce((max, deposit) => {
        const current = extractNumericValue(deposit?.codigo);
        return current > max ? current : max;
    }, 0);
    return String(highest + 1);
};

const sanitizePositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const floored = Math.floor(parsed);
    return floored > 0 ? floored : fallback;
};

const escapeRegExp = (value) => {
    if (typeof value !== 'string') return '';
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

router.get('/', async (req, res) => {
    try {
        const { empresa } = req.query;
        const query = {};
        if (empresa) {
            query.empresa = empresa;
        }
        const deposits = await Deposit.find(query)
            .sort({ nome: 1 })
            .populate('empresa')
            .lean();
        res.json({ deposits });
    } catch (error) {
        console.error('Erro ao listar depósitos:', error);
        res.status(500).json({ message: 'Erro ao listar depósitos.' });
    }
});

router.get('/:id/inventory', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Depósito inválido.' });
        }

        const deposit = await Deposit.findById(id).lean();
        if (!deposit) {
            return res.status(404).json({ message: 'Depósito não encontrado.' });
        }

        const page = sanitizePositiveInteger(req.query.page, 1);
        const requestedLimit = sanitizePositiveInteger(req.query.limit, 20);
        const limit = Math.min(requestedLimit, 200);
        const sortField = typeof req.query.sortField === 'string' ? req.query.sortField.trim() : 'nome';
        const sortOrder = typeof req.query.sortOrder === 'string' && req.query.sortOrder.toLowerCase() === 'desc' ? -1 : 1;
        const searchTerm = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        const allowedSortFields = new Map([
            ['codbarras', 'codbarras'],
            ['nome', 'nome'],
            ['quantidade', 'quantidade'],
        ]);

        const sortTarget = allowedSortFields.get(sortField) || 'nome';
        const sortSpec = { [sortTarget]: sortOrder, _id: 1 };

        const depositId = new mongoose.Types.ObjectId(id);

        const matchStage = {
            'estoques.deposito': depositId,
        };

        if (searchTerm) {
            const regex = new RegExp(escapeRegExp(searchTerm), 'i');
            matchStage.$or = [
                { nome: regex },
                { cod: regex },
                { codbarras: regex },
            ];
        }

        const basePipeline = [
            { $match: matchStage },
            {
                $addFields: {
                    estoqueSelecionado: {
                        $first: {
                            $filter: {
                                input: '$estoques',
                                as: 'item',
                                cond: { $eq: ['$$item.deposito', depositId] },
                            },
                        },
                    },
                },
            },
            {
                $addFields: {
                    quantidade: { $ifNull: ['$estoqueSelecionado.quantidade', 0] },
                },
            },
            {
                $project: {
                    estoqueSelecionado: 0,
                    estoques: 0,
                    fornecedores: 0,
                    imagens: 0,
                    descricao: 0,
                    searchableString: 0,
                    fiscal: 0,
                    fiscalPorEmpresa: 0,
                },
            },
        ];

        const paginatedPipeline = [
            ...basePipeline,
            {
                $facet: {
                    data: [
                        { $sort: sortSpec },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                    ],
                    totalCount: [
                        { $count: 'value' },
                    ],
                },
            },
        ];

        const aggregated = await Product.aggregate(paginatedPipeline)
            .allowDiskUse(true)
            .exec();
        const [result = {}] = aggregated;
        const totalCount = Array.isArray(result.totalCount) && result.totalCount.length > 0
            ? result.totalCount[0].value
            : 0;

        const totalPages = totalCount > 0 ? Math.ceil(totalCount / limit) : 1;
        let currentPage = page;
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        let items = Array.isArray(result.data) ? result.data : [];

        if (!items.length && totalCount > 0 && page > totalPages) {
            const skip = (currentPage - 1) * limit;
            items = await Product.aggregate([
                ...basePipeline,
                { $sort: sortSpec },
                { $skip: skip },
                { $limit: limit },
            ])
                .allowDiskUse(true)
                .exec();
        }

        res.json({
            deposit: {
                _id: deposit._id,
                nome: deposit.nome,
                codigo: deposit.codigo,
            },
            pagination: {
                page: currentPage,
                limit,
                total: totalCount,
                totalPages,
            },
            items,
        });
    } catch (error) {
        console.error('Erro ao listar estoque do depósito:', error);
        res.status(500).json({ message: 'Erro ao carregar itens do depósito.' });
    }
});

router.post('/:id/zero-stock', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { id } = req.params;
        const { productIds } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Depósito inválido.' });
        }

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ message: 'Selecione ao menos um produto para zerar o estoque.' });
        }

        const deposit = await Deposit.findById(id).lean();
        if (!deposit) {
            return res.status(404).json({ message: 'Depósito não encontrado.' });
        }

        const uniqueProductIds = [...new Set(productIds)]
            .filter((value) => mongoose.Types.ObjectId.isValid(value))
            .map((value) => new mongoose.Types.ObjectId(value));

        if (!uniqueProductIds.length) {
            return res.status(400).json({ message: 'Nenhum produto válido foi informado.' });
        }

        const depositId = new mongoose.Types.ObjectId(id);

        const products = await Product.find({
            _id: { $in: uniqueProductIds },
            'estoques.deposito': depositId,
        }).lean();

        if (!products.length) {
            return res.json({ updated: 0, affectedProducts: [] });
        }

        const bulkOperations = [];
        const affectedProducts = [];

        products.forEach((product) => {
            if (!Array.isArray(product?.estoques)) {
                return;
            }

            let targetEntryFound = false;
            let quantityChanged = false;

            const updatedStocks = product.estoques.map((entry) => {
                const current = entry && typeof entry === 'object' ? { ...entry } : {};
                const isTarget = current?.deposito && current.deposito.toString() === id;
                const currentQuantity = Number(current?.quantidade) || 0;
                const baseEntry = {
                    deposito: current?.deposito,
                    quantidade: currentQuantity,
                    unidade: current?.unidade || '',
                };
                if (current?._id) {
                    baseEntry._id = current._id;
                }
                if (isTarget) {
                    targetEntryFound = true;
                    if (currentQuantity !== 0) {
                        quantityChanged = true;
                    }
                    return { ...baseEntry, quantidade: 0 };
                }
                return baseEntry;
            });

            if (!targetEntryFound) {
                return;
            }

            const totalStock = updatedStocks.reduce((sum, entry) => {
                const quantity = Number(entry?.quantidade) || 0;
                return sum + quantity;
            }, 0);

            const shouldUpdate = quantityChanged || Number(product?.stock) !== totalStock;

            if (!shouldUpdate) {
                return;
            }

            bulkOperations.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: {
                        $set: {
                            estoques: updatedStocks,
                            stock: totalStock,
                        },
                    },
                },
            });

            affectedProducts.push({
                _id: product._id,
                nome: product.nome,
                codbarras: product.codbarras,
            });
        });

        if (!bulkOperations.length) {
            return res.json({ updated: 0, affectedProducts: [] });
        }

        await Product.bulkWrite(bulkOperations, { ordered: false });

        res.json({
            updated: bulkOperations.length,
            affectedProducts,
        });
    } catch (error) {
        console.error('Erro ao zerar estoque do depósito:', error);
        res.status(500).json({ message: 'Erro ao zerar o estoque selecionado.' });
    }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const nome = normalizeString(req.body.nome);
        const empresa = normalizeString(req.body.empresa);

        if (!nome || !empresa) {
            return res.status(400).json({ message: 'Nome e empresa são obrigatórios.' });
        }

        const storeExists = await Store.exists({ _id: empresa });
        if (!storeExists) {
            return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
        }

        let codigo = await generateNextSequentialCode();
        let attempts = 0;
        while (await Deposit.exists({ codigo }) && attempts < 5) {
            const numeric = extractNumericValue(codigo) + 1;
            codigo = String(numeric);
            attempts += 1;
        }

        if (await Deposit.exists({ codigo })) {
            return res.status(409).json({ message: 'Não foi possível gerar um novo código de depósito. Tente novamente.' });
        }

        const deposit = await Deposit.create({ codigo, nome, empresa });
        const populated = await deposit.populate('empresa');
        res.status(201).json(populated);
    } catch (error) {
        console.error('Erro ao criar depósito:', error);
        res.status(500).json({ message: 'Erro ao criar depósito.' });
    }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const codigo = normalizeString(req.body.codigo);
        const nome = normalizeString(req.body.nome);
        const empresa = normalizeString(req.body.empresa);

        if (!codigo || !nome || !empresa) {
            return res.status(400).json({ message: 'Código, nome e empresa são obrigatórios.' });
        }

        const storeExists = await Store.exists({ _id: empresa });
        if (!storeExists) {
            return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
        }

        const duplicated = await Deposit.findOne({ codigo, _id: { $ne: req.params.id } });
        if (duplicated) {
            return res.status(409).json({ message: 'Já existe um depósito com este código.' });
        }

        const updated = await Deposit.findByIdAndUpdate(
            req.params.id,
            { codigo, nome, empresa },
            { new: true }
        ).populate('empresa');

        if (!updated) {
            return res.status(404).json({ message: 'Depósito não encontrado.' });
        }

        res.json(updated);
    } catch (error) {
        console.error('Erro ao atualizar depósito:', error);
        res.status(500).json({ message: 'Erro ao atualizar depósito.' });
    }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const deleted = await Deposit.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ message: 'Depósito não encontrado.' });
        }
        res.json({ message: 'Depósito removido com sucesso.' });
    } catch (error) {
        console.error('Erro ao apagar depósito:', error);
        res.status(500).json({ message: 'Erro ao remover depósito.' });
    }
});

module.exports = router;
