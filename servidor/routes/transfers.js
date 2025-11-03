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
const allowedStatuses = new Set(['solicitada', 'em_separacao', 'aprovada']);
const statusLabels = {
    solicitada: 'Solicitada',
    em_separacao: 'Em separação',
    aprovada: 'Aprovada',
};

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

const normalizeStatus = (value) => {
    if (!value) return null;
    try {
        const normalized = String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_/, '')
            .replace(/_$/, '');
        return allowedStatuses.has(normalized) ? normalized : null;
    } catch (error) {
        return null;
    }
};

const getStartOfDay = (date) => {
    if (!date) return null;
    const copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const getEndOfDay = (date) => {
    if (!date) return null;
    const copy = new Date(date.getTime());
    copy.setHours(23, 59, 59, 999);
    return copy;
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

router.get('/filters', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const deposits = await Deposit.find({}, { nome: 1, codigo: 1, empresa: 1 })
            .sort({ nome: 1 })
            .populate('empresa', { nome: 1, nomeFantasia: 1 })
            .lean();

        const preparedDeposits = deposits.map((deposit) => ({
            id: String(deposit._id),
            name: deposit.nome || '',
            code: deposit.codigo || '',
            companyId: deposit.empresa ? String(deposit.empresa._id) : null,
            companyName: deposit.empresa?.nomeFantasia || deposit.empresa?.nome || '',
        }));

        res.json({
            deposits: preparedDeposits,
            statuses: Array.from(allowedStatuses).map((status) => ({
                value: status,
                label: statusLabels[status] || status,
            })),
        });
    } catch (error) {
        console.error('Erro ao carregar filtros de transferências:', error);
        res.status(500).json({ message: 'Não foi possível carregar os filtros de transferências.' });
    }
});

router.get('/', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const {
            originDeposit,
            destinationDeposit,
            status: statusQuery,
            startDate: startDateQuery,
            endDate: endDateQuery,
        } = req.query || {};

        const filters = {};

        if (originDeposit && mongoose.Types.ObjectId.isValid(originDeposit)) {
            filters.originDeposit = originDeposit;
        }

        if (destinationDeposit && mongoose.Types.ObjectId.isValid(destinationDeposit)) {
            filters.destinationDeposit = destinationDeposit;
        }

        const normalizedStatus = normalizeStatus(statusQuery);
        if (normalizedStatus) {
            filters.status = normalizedStatus;
        }

        const startDate = parseDateInput(startDateQuery);
        const endDate = parseDateInput(endDateQuery);

        if (startDate || endDate) {
            const dateFilter = {};
            if (startDate) {
                dateFilter.$gte = getStartOfDay(startDate);
            }
            if (endDate) {
                dateFilter.$lte = getEndOfDay(endDate);
            }
            if (Object.keys(dateFilter).length > 0) {
                filters.requestDate = dateFilter;
            }
        }

        const transfers = await Transfer.find(filters)
            .populate('originDeposit', { nome: 1, codigo: 1 })
            .populate('destinationDeposit', { nome: 1, codigo: 1 })
            .populate('originCompany', { nome: 1, nomeFantasia: 1 })
            .populate('destinationCompany', { nome: 1, nomeFantasia: 1 })
            .populate('responsible', { nomeCompleto: 1, apelido: 1, email: 1 })
            .sort({ requestDate: -1, number: -1 })
            .lean();

        let totalVolume = 0;
        const statusCount = {};

        const formattedTransfers = transfers.map((transfer) => {
            const safeStatus = normalizeStatus(transfer.status) || 'solicitada';
            statusCount[safeStatus] = (statusCount[safeStatus] || 0) + 1;

            const volumes = Array.isArray(transfer.items)
                ? transfer.items.reduce((acc, item) => acc + (Number(item?.quantity) || 0), 0)
                : 0;
            totalVolume += volumes;

            return {
                id: String(transfer._id),
                number: Number(transfer.number) || 0,
                requestDate: transfer.requestDate || null,
                status: safeStatus,
                statusLabel: statusLabels[safeStatus] || safeStatus,
                originDeposit: transfer.originDeposit
                    ? {
                          id: String(transfer.originDeposit._id),
                          name: transfer.originDeposit.nome || '',
                          code: transfer.originDeposit.codigo || '',
                      }
                    : null,
                destinationDeposit: transfer.destinationDeposit
                    ? {
                          id: String(transfer.destinationDeposit._id),
                          name: transfer.destinationDeposit.nome || '',
                          code: transfer.destinationDeposit.codigo || '',
                      }
                    : null,
                originCompany: transfer.originCompany
                    ? {
                          id: String(transfer.originCompany._id),
                          name: transfer.originCompany.nomeFantasia || transfer.originCompany.nome || '',
                      }
                    : null,
                destinationCompany: transfer.destinationCompany
                    ? {
                          id: String(transfer.destinationCompany._id),
                          name: transfer.destinationCompany.nomeFantasia || transfer.destinationCompany.nome || '',
                      }
                    : null,
                responsible: transfer.responsible
                    ? {
                          id: String(transfer.responsible._id),
                          name: transfer.responsible.nomeCompleto || transfer.responsible.apelido || '',
                          email: transfer.responsible.email || '',
                      }
                    : null,
                totalVolume: volumes,
                itemsCount: Array.isArray(transfer.items) ? transfer.items.length : 0,
            };
        });

        const pendingNfe = formattedTransfers.filter((transfer) => transfer.status !== 'aprovada').length;

        res.json({
            transfers: formattedTransfers,
            summary: {
                totalTransfers: formattedTransfers.length,
                totalVolume,
                pendingNfe,
                statusCount,
                period: {
                    start: startDate ? getStartOfDay(startDate) : null,
                    end: endDate ? getEndOfDay(endDate) : null,
                },
            },
        });
    } catch (error) {
        console.error('Erro ao listar transferências:', error);
        res.status(500).json({ message: 'Não foi possível carregar as transferências solicitadas.' });
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

router.get('/:id', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Transferência inválida informada.' });
        }

        const transfer = await Transfer.findById(id)
            .populate('originDeposit', { nome: 1, codigo: 1 })
            .populate('destinationDeposit', { nome: 1, codigo: 1 })
            .populate('originCompany', { nome: 1, nomeFantasia: 1, cnpj: 1 })
            .populate('destinationCompany', { nome: 1, nomeFantasia: 1, cnpj: 1 })
            .populate('responsible', { nomeCompleto: 1, apelido: 1, email: 1, role: 1 })
            .populate('items.product', { nome: 1, cod: 1, codbarras: 1, unidade: 1 })
            .lean();

        if (!transfer) {
            return res.status(404).json({ message: 'Transferência não encontrada.' });
        }

        const safeStatus = normalizeStatus(transfer.status) || 'solicitada';

        const items = Array.isArray(transfer.items)
            ? transfer.items.map((item) => {
                  const quantity = Number(item?.quantity) || 0;
                  const unitCost = Number(item?.unitCost) || 0;
                  const unitWeight = Number(item?.unitWeight) || 0;
                  return {
                      productId: item.product ? String(item.product._id) : null,
                      productName: item.product?.nome || item.description || '',
                      sku: item.sku || item.product?.cod || '',
                      barcode: item.barcode || item.product?.codbarras || '',
                      description: item.description || item.product?.nome || '',
                      quantity,
                      unit: item.unit || item.product?.unidade || '',
                      lot: item.lot || '',
                      validity: item.validity || null,
                      unitWeight,
                      unitCost,
                      totalWeight: unitWeight * quantity,
                      totalCost: unitCost * quantity,
                  };
              })
            : [];

        const totals = items.reduce(
            (acc, item) => {
                acc.totalVolume += item.quantity;
                acc.totalWeight += Number.isFinite(item.totalWeight) ? item.totalWeight : 0;
                acc.totalCost += Number.isFinite(item.totalCost) ? item.totalCost : 0;
                return acc;
            },
            { totalVolume: 0, totalWeight: 0, totalCost: 0 }
        );

        res.json({
            transfer: {
                id: String(transfer._id),
                number: Number(transfer.number) || 0,
                requestDate: transfer.requestDate || null,
                status: safeStatus,
                statusLabel: statusLabels[safeStatus] || safeStatus,
                originDeposit: transfer.originDeposit
                    ? {
                          id: String(transfer.originDeposit._id),
                          name: transfer.originDeposit.nome || '',
                          code: transfer.originDeposit.codigo || '',
                      }
                    : null,
                destinationDeposit: transfer.destinationDeposit
                    ? {
                          id: String(transfer.destinationDeposit._id),
                          name: transfer.destinationDeposit.nome || '',
                          code: transfer.destinationDeposit.codigo || '',
                      }
                    : null,
                originCompany: transfer.originCompany
                    ? {
                          id: String(transfer.originCompany._id),
                          name: transfer.originCompany.nomeFantasia || transfer.originCompany.nome || '',
                          cnpj: transfer.originCompany.cnpj || '',
                      }
                    : null,
                destinationCompany: transfer.destinationCompany
                    ? {
                          id: String(transfer.destinationCompany._id),
                          name:
                              transfer.destinationCompany.nomeFantasia || transfer.destinationCompany.nome || '',
                          cnpj: transfer.destinationCompany.cnpj || '',
                      }
                    : null,
                responsible: transfer.responsible
                    ? {
                          id: String(transfer.responsible._id),
                          name:
                              transfer.responsible.nomeCompleto ||
                              transfer.responsible.apelido ||
                              transfer.responsible.email ||
                              '',
                          email: transfer.responsible.email || '',
                          role: transfer.responsible.role || '',
                      }
                    : null,
                referenceDocument: transfer.referenceDocument || '',
                observations: transfer.observations || '',
                transport: {
                    mode: transfer.transport?.mode || '',
                    vehicle: transfer.transport?.vehicle || '',
                    driver: transfer.transport?.driver || '',
                },
                items,
                totals,
            },
        });
    } catch (error) {
        console.error('Erro ao carregar detalhes da transferência:', error);
        res.status(500).json({ message: 'Não foi possível carregar os detalhes da transferência.' });
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

router.patch('/:id/status', requireAuth, authorizeRoles(...allowedRoles), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body || {};

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Transferência inválida informada.' });
        }

        const normalizedStatus = normalizeStatus(status);
        if (!normalizedStatus) {
            return res.status(400).json({ message: 'Status informado é inválido.' });
        }

        const updated = await Transfer.findByIdAndUpdate(
            id,
            { status: normalizedStatus },
            { new: true, runValidators: true }
        )
            .populate('originDeposit', { nome: 1, codigo: 1 })
            .populate('destinationDeposit', { nome: 1, codigo: 1 })
            .populate('originCompany', { nome: 1, nomeFantasia: 1 })
            .populate('destinationCompany', { nome: 1, nomeFantasia: 1 })
            .populate('responsible', { nomeCompleto: 1, apelido: 1, email: 1 })
            .lean();

        if (!updated) {
            return res.status(404).json({ message: 'Transferência não encontrada.' });
        }

        res.json({
            message: 'Status da transferência atualizado com sucesso.',
            transfer: {
                id: String(updated._id),
                number: Number(updated.number) || 0,
                status: updated.status,
                statusLabel: statusLabels[updated.status] || updated.status,
            },
        });
    } catch (error) {
        console.error('Erro ao atualizar status da transferência:', error);
        res.status(500).json({ message: 'Não foi possível atualizar o status da transferência.' });
    }
});

module.exports = router;
