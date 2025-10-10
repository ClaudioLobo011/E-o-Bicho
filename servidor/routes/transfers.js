const express = require('express');
const mongoose = require('mongoose');
const Transfer = require('../models/Transfer');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Product = require('../models/Product');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const allowedRoles = ['admin', 'admin_master', 'funcionario'];

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseDateInput = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
};

const escapeRegExp = (value) => {
    if (typeof value !== 'string') return '';
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const getNextTransferNumber = async () => {
    const lastTransfer = await Transfer.findOne({}, { number: 1 })
        .sort({ number: -1 })
        .lean();
    const lastNumber = Number(lastTransfer?.number) || 0;
    return lastNumber + 1;
};

router.get('/form-data', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const [stores, deposits, responsaveis] = await Promise.all([
            Store.find({}, { nome: 1, nomeFantasia: 1, cnpj: 1 })
                .sort({ nome: 1, nomeFantasia: 1 })
                .lean(),
            Deposit.find({}, { nome: 1, empresa: 1 })
                .sort({ nome: 1 })
                .lean(),
            User.find({ role: { $in: allowedRoles } }, { nomeCompleto: 1, apelido: 1, email: 1, role: 1 })
                .sort({ nomeCompleto: 1, apelido: 1, email: 1 })
                .lean(),
        ]);

        res.json({ stores, deposits, responsaveis });
    } catch (error) {
        console.error('Erro ao carregar dados do formulário de transferência:', error);
        res.status(500).json({ message: 'Não foi possível carregar os dados necessários para a transferência.' });
    }
});

router.get('/search-products', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const term = sanitizeString(req.query.term);
        if (!term) {
            return res.json({ products: [] });
        }

        const regex = new RegExp(escapeRegExp(term), 'i');
        const numericTerm = term.replace(/\D/g, '');
        const query = {
            $or: [
                { cod: regex },
                { codbarras: regex },
                { nome: regex },
            ],
        };

        if (numericTerm) {
            query.$or.push({ codbarras: new RegExp(escapeRegExp(numericTerm), 'i') });
        }

        const products = await Product.find(query, {
            cod: 1,
            codbarras: 1,
            nome: 1,
            unidade: 1,
            peso: 1,
            custo: 1,
            venda: 1,
        })
            .limit(20)
            .sort({ nome: 1 })
            .lean();

        res.json({ products });
    } catch (error) {
        console.error('Erro ao buscar produtos para transferência:', error);
        res.status(500).json({ message: 'Não foi possível buscar produtos no momento.' });
    }
});

router.get('/products/:id', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Produto inválido informado.' });
        }

        const product = await Product.findById(id, {
            cod: 1,
            codbarras: 1,
            nome: 1,
            unidade: 1,
            peso: 1,
            custo: 1,
            venda: 1,
            estoques: 1,
        }).lean();

        if (!product) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }

        const stocks = Array.isArray(product.estoques)
            ? product.estoques.map((stock) => ({
                  depositId: stock?.deposito ? String(stock.deposito) : '',
                  quantity: Number(stock?.quantidade) || 0,
                  unit: stock?.unidade || '',
              }))
            : [];

        res.json({
            product: {
                _id: product._id,
                cod: product.cod,
                codbarras: product.codbarras,
                nome: product.nome,
                unidade: product.unidade,
                peso: product.peso,
                custo: product.custo,
                venda: product.venda,
            },
            stocks,
        });
    } catch (error) {
        console.error('Erro ao carregar detalhes do produto para transferência:', error);
        res.status(500).json({ message: 'Não foi possível carregar os detalhes do produto.' });
    }
});

router.post('/', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const {
            requestDate,
            originCompany,
            originDeposit,
            destinationCompany,
            destinationDeposit,
            responsible,
            referenceDocument,
            observations,
            transport = {},
            items,
        } = req.body || {};

        const parsedDate = parseDateInput(requestDate);
        if (!parsedDate) {
            return res.status(400).json({ message: 'Informe uma data de solicitação válida.' });
        }

        const requiredIds = [originCompany, originDeposit, destinationCompany, destinationDeposit, responsible];
        if (requiredIds.some((id) => !id || !mongoose.Types.ObjectId.isValid(id))) {
            return res.status(400).json({ message: 'Dados de empresas, depósitos ou responsável inválidos.' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Inclua ao menos um item na transferência.' });
        }

        const originCompanyDoc = await Store.findById(originCompany).lean();
        const destinationCompanyDoc = await Store.findById(destinationCompany).lean();
        if (!originCompanyDoc || !destinationCompanyDoc) {
            return res.status(400).json({ message: 'Empresa de origem ou destino não encontrada.' });
        }

        const [originDepositDoc, destinationDepositDoc] = await Promise.all([
            Deposit.findById(originDeposit).lean(),
            Deposit.findById(destinationDeposit).lean(),
        ]);

        if (!originDepositDoc || !destinationDepositDoc) {
            return res.status(400).json({ message: 'Depósito de origem ou destino não encontrado.' });
        }

        if (String(originDepositDoc.empresa) !== String(originCompanyDoc._id)) {
            return res.status(400).json({ message: 'O depósito de origem selecionado não pertence à empresa informada.' });
        }

        if (String(destinationDepositDoc.empresa) !== String(destinationCompanyDoc._id)) {
            return res.status(400).json({ message: 'O depósito de destino selecionado não pertence à empresa informada.' });
        }

        const responsibleDoc = await User.findById(responsible).lean();
        if (!responsibleDoc || !allowedRoles.includes(responsibleDoc.role)) {
            return res.status(400).json({ message: 'Responsável inválido para a transferência.' });
        }

        const productIds = items
            .map((item) => item?.productId)
            .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

        if (productIds.length !== items.length) {
            return res.status(400).json({ message: 'Itens informados possuem produtos inválidos.' });
        }

        const products = await Product.find({ _id: { $in: productIds } }, {
            cod: 1,
            codbarras: 1,
            nome: 1,
            unidade: 1,
            peso: 1,
            custo: 1,
        }).lean();

        const productMap = new Map(products.map((product) => [String(product._id), product]));

        const preparedItems = [];
        for (const rawItem of items) {
            const productId = String(rawItem.productId);
            const product = productMap.get(productId);
            if (!product) {
                return res.status(400).json({ message: 'Alguns produtos informados não foram encontrados.' });
            }

            const quantity = Number(rawItem.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                return res.status(400).json({ message: 'Informe quantidades válidas para todos os itens.' });
            }

            let validityDate = null;
            if (rawItem.validity) {
                const parsedValidity = parseDateInput(rawItem.validity);
                if (!parsedValidity) {
                    return res.status(400).json({ message: 'A validade informada para um dos itens é inválida.' });
                }
                validityDate = parsedValidity;
            }

            preparedItems.push({
                product: product._id,
                sku: sanitizeString(product.cod),
                barcode: sanitizeString(product.codbarras),
                description: sanitizeString(product.nome),
                quantity,
                unit: sanitizeString(rawItem.unit) || sanitizeString(product.unidade),
                lot: sanitizeString(rawItem.lot),
                validity: validityDate,
                unitWeight: Number.isFinite(product?.peso) ? product.peso : null,
                unitCost: Number.isFinite(product?.custo) ? product.custo : null,
            });
        }

        const number = await getNextTransferNumber();

        const transfer = new Transfer({
            number,
            requestDate: parsedDate,
            originCompany,
            originDeposit,
            destinationCompany,
            destinationDeposit,
            responsible,
            referenceDocument: sanitizeString(referenceDocument),
            observations: sanitizeString(observations),
            transport: {
                mode: 'Teste',
                vehicle: sanitizeString(transport.vehicle),
                driver: sanitizeString(transport.driver),
            },
            items: preparedItems,
        });

        const saved = await transfer.save();

        res.status(201).json({
            message: 'Transferência registrada com sucesso.',
            transfer: saved,
        });
    } catch (error) {
        console.error('Erro ao salvar transferência:', error);
        res.status(500).json({ message: 'Não foi possível salvar a transferência no momento.' });
    }
});

module.exports = router;
