const express = require('express');
const mongoose = require('mongoose');
const Transfer = require('../models/Transfer');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Product = require('../models/Product');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const {
    recalculateFractionalStockForProduct,
    refreshParentFractionalStocks,
} = require('../utils/fractionalInventory');

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

const toObjectIdOrNull = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }
    if (typeof value === 'object' && value._id) {
        return toObjectIdOrNull(value._id);
    }
    const normalized = String(value).trim();
    if (!mongoose.Types.ObjectId.isValid(normalized)) {
        return null;
    }
    return new mongoose.Types.ObjectId(normalized);
};

const resolveProductObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }
    if (typeof value === 'object' && value._id) {
        return resolveProductObjectId(value._id);
    }
    if (mongoose.Types.ObjectId.isValid(String(value))) {
        return new mongoose.Types.ObjectId(String(value));
    }
    return null;
};

const resolveFractionalChildRatio = (baseQuantity, fractionQuantity) => {
    const normalizedBase = Number(baseQuantity);
    const normalizedFraction = Number(fractionQuantity);

    if (!Number.isFinite(normalizedBase) || normalizedBase <= 0) return 0;
    if (!Number.isFinite(normalizedFraction) || normalizedFraction <= 0) return 0;

    const directRatio = normalizedFraction / normalizedBase;
    if (Number.isFinite(directRatio) && directRatio >= 1) {
        return directRatio;
    }

    const invertedRatio = normalizedBase / normalizedFraction;
    if (Number.isFinite(invertedRatio) && invertedRatio >= 1) {
        return invertedRatio;
    }

    return 0;
};

const adjustProductStockForDeposit = async ({
    productId,
    depositId,
    quantity,
    session,
    cascadeFractional = true,
    visited,
}) => {
    const delta = Number(quantity);
    if (!Number.isFinite(delta) || delta === 0) {
        return { updated: false };
    }

    const productObjectId = resolveProductObjectId(productId);
    const depositObjectId = toObjectIdOrNull(depositId);
    if (!productObjectId || !depositObjectId) {
        return { updated: false };
    }

    const tolerance = 0.000001;

    const loadProduct = async () => Product.findById(productObjectId).session(session);

    let product = await loadProduct();
    if (!product) {
        const error = new Error('Produto vinculado à transferência não foi encontrado.');
        error.statusCode = 400;
        error.details = { productId: String(productId) };
        throw error;
    }

    if (!Array.isArray(product.estoques)) {
        product.estoques = [];
    }

    const visitSet = visited instanceof Set ? visited : new Set();
    const visitKey = product._id.toString();
    const alreadyVisited = visitSet.has(visitKey);
    if (!alreadyVisited) {
        visitSet.add(visitKey);
    }

    const depositKey = depositObjectId.toString();

    const findEntry = () =>
        product.estoques.find(
            (stockEntry) => stockEntry?.deposito && stockEntry.deposito.toString() === depositKey
        );

    const refreshFractionalSnapshot = async (context) => {
        const fractionalConfig = product?.fracionado;
        if (!fractionalConfig || !fractionalConfig.ativo) {
            return false;
        }

        try {
            await recalculateFractionalStockForProduct(product._id, { session });
            const reloaded = await loadProduct();
            if (!reloaded) {
                return false;
            }

            product.estoques = Array.isArray(reloaded.estoques) ? reloaded.estoques : [];
            product.fracionado = reloaded.fracionado;
            product.stock = reloaded.stock;
            return Boolean(findEntry());
        } catch (error) {
            console.error(
                'Erro ao sincronizar estoque fracionado antes da movimentação de transferência.',
                {
                    productId: product._id.toString(),
                    depositId: depositKey,
                    context,
                },
                error
            );
            return false;
        }
    };

    let entry = findEntry();

    if (!entry && delta < 0) {
        const refreshed = await refreshFractionalSnapshot('missing_entry');
        if (refreshed) {
            entry = findEntry();
        }
    }

    if (!entry) {
        entry = {
            deposito: depositObjectId,
            quantidade: 0,
            unidade: product.unidade || 'UN',
        };
        product.estoques.push(entry);
    }

    const computeNextQuantity = () => {
        const currentQuantity = Number(entry?.quantidade) || 0;
        const nextQuantityRaw = currentQuantity + delta;
        const nextQuantity = Math.round(nextQuantityRaw * 1_000_000) / 1_000_000;
        return { currentQuantity, nextQuantity };
    };

    let { currentQuantity, nextQuantity } = computeNextQuantity();

    if (delta < 0 && nextQuantity < -tolerance) {
        const refreshed = await refreshFractionalSnapshot('insufficient_stock');
        if (refreshed) {
            entry = findEntry() || entry;
            ({ currentQuantity, nextQuantity } = computeNextQuantity());
        }
    }

    if (delta < 0 && nextQuantity < -tolerance) {
        const error = new Error('Estoque insuficiente para concluir a transferência.');
        error.statusCode = 400;
        error.details = {
            productId: product._id.toString(),
            depositId: depositKey,
            available: currentQuantity,
            requested: delta,
        };
        throw error;
    }

    entry.quantidade = nextQuantity > 0 ? nextQuantity : 0;
    if (!entry.unidade) {
        entry.unidade = product.unidade || 'UN';
    }

    const totalStock = product.estoques.reduce((sum, stockEntry) => {
        const qty = Number(stockEntry?.quantidade);
        return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    product.stock = Math.max(0, Math.round(totalStock * 1_000_000) / 1_000_000);
    product.markModified('estoques');

    await product.save({ session });

    if (cascadeFractional && !alreadyVisited) {
        const fractionalConfig = product.fracionado || {};
        const fractionalItems = Array.isArray(fractionalConfig.itens) ? fractionalConfig.itens : [];

        for (const item of fractionalItems) {
            const baseQuantity = Number(item?.quantidadeOrigem);
            const fractionQuantity = Number(item?.quantidadeFracionada);
            if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) continue;
            if (!Number.isFinite(fractionQuantity) || fractionQuantity <= 0) continue;

            const childObjectId = resolveProductObjectId(item?.produto);
            if (!childObjectId) continue;

            const ratio = resolveFractionalChildRatio(baseQuantity, fractionQuantity);
            const childDelta = delta * ratio;
            if (!Number.isFinite(childDelta) || childDelta === 0) continue;

            try {
                await adjustProductStockForDeposit({
                    productId: childObjectId,
                    depositId: depositObjectId,
                    quantity: childDelta,
                    session,
                    cascadeFractional: true,
                    visited: visitSet,
                });
            } catch (error) {
                console.error('Erro ao ajustar estoque de produto fracionado vinculado durante transferência.', {
                    parentProductId: product._id.toString(),
                    childProductId: String(childObjectId),
                    depositId: depositKey,
                }, error);
                throw error;
            }
        }

        try {
            await recalculateFractionalStockForProduct(product._id, { session });
        } catch (error) {
            console.error('Erro ao recalcular estoque fracionado do produto durante transferência.', {
                productId: product._id.toString(),
            }, error);
        }
    }

    try {
        await refreshParentFractionalStocks(product._id, { session });
    } catch (error) {
        console.error('Erro ao atualizar produtos pais fracionados durante transferência.', {
            productId: product._id.toString(),
        }, error);
    }

    return { updated: true };
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
            .select({
                number: 1,
                requestDate: 1,
                status: 1,
                originDeposit: 1,
                destinationDeposit: 1,
                originCompany: 1,
                destinationCompany: 1,
                responsible: 1,
                referenceDocument: 1,
                items: 1,
            })
            .populate('originDeposit', { nome: 1, codigo: 1 })
            .populate('destinationDeposit', { nome: 1, codigo: 1 })
            .populate('originCompany', { nome: 1, nomeFantasia: 1 })
            .populate('destinationCompany', { nome: 1, nomeFantasia: 1 })
            .populate('responsible', { nomeCompleto: 1, apelido: 1, email: 1 })
            .populate('items.product', { venda: 1 })
            .sort({ requestDate: -1, number: -1 })
            .lean();

        let totalVolume = 0;
        let totalCost = 0;
        let totalSale = 0;
        let withInvoice = 0;
        const statusCount = {};

        const formattedTransfers = transfers.map((transfer) => {
            const safeStatus = normalizeStatus(transfer.status) || 'solicitada';
            statusCount[safeStatus] = (statusCount[safeStatus] || 0) + 1;

            const items = Array.isArray(transfer.items) ? transfer.items : [];
            const totals = items.reduce(
                (acc, item) => {
                    const quantity = Number(item?.quantity) || 0;
                    const unitCost = Number(item?.unitCost) || 0;
                    const unitSale = Number(item?.unitSale ?? item?.product?.venda) || 0;
                    const storedTotalSaleRaw = item?.totalSale;
                    const storedTotalSale = Number(storedTotalSaleRaw);
                    const hasStoredTotalSale =
                        storedTotalSaleRaw !== null &&
                        storedTotalSaleRaw !== undefined &&
                        Number.isFinite(storedTotalSale);
                    acc.totalVolume += quantity;
                    acc.totalCost += quantity * unitCost;
                    acc.totalSale += hasStoredTotalSale ? storedTotalSale : quantity * unitSale;
                    return acc;
                },
                { totalVolume: 0, totalCost: 0, totalSale: 0 }
            );

            totals.totalVolume = Math.round(totals.totalVolume * 1_000_000) / 1_000_000;
            totals.totalCost = Math.round(totals.totalCost * 100) / 100;
            totals.totalSale = Math.round(totals.totalSale * 100) / 100;

            totalVolume += totals.totalVolume;
            totalCost += totals.totalCost;
            totalSale += totals.totalSale;

            const hasInvoice = Boolean(sanitizeString(transfer.referenceDocument));
            if (hasInvoice) {
                withInvoice += 1;
            }

            return {
                id: String(transfer._id),
                number: Number(transfer.number) || 0,
                requestDate: transfer.requestDate || null,
                status: safeStatus,
                statusLabel: statusLabels[safeStatus] || safeStatus,
                referenceDocument: transfer.referenceDocument || '',
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
                totalVolume: totals.totalVolume,
                itemsCount: items.length,
                totals: {
                    totalVolume: totals.totalVolume,
                    totalCost: totals.totalCost,
                    totalSale: totals.totalSale,
                },
                hasInvoice,
            };
        });

        const pendingTransfers = formattedTransfers.filter((transfer) => transfer.status !== 'aprovada').length;
        totalVolume = Math.round(totalVolume * 1_000_000) / 1_000_000;
        totalCost = Math.round(totalCost * 100) / 100;
        totalSale = Math.round(totalSale * 100) / 100;

        res.json({
            transfers: formattedTransfers,
            summary: {
                totalTransfers: formattedTransfers.length,
                totalVolume,
                totalCost,
                totalSale,
                withInvoice,
                pendingTransfers,
                pendingNfe: pendingTransfers,
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
            .populate('items.product', { nome: 1, cod: 1, codbarras: 1, unidade: 1, venda: 1 })
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
                  const unitSale = Number(item?.unitSale ?? item?.product?.venda) || 0;
                  const storedTotalSaleRaw = item?.totalSale;
                  const storedTotalSale = Number(storedTotalSaleRaw);
                  const totalSale =
                      storedTotalSaleRaw !== null &&
                      storedTotalSaleRaw !== undefined &&
                      Number.isFinite(storedTotalSale)
                          ? storedTotalSale
                          : unitSale * quantity;
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
                      unitSale,
                      totalWeight: unitWeight * quantity,
                      totalCost: unitCost * quantity,
                      totalSale,
                  };
              })
            : [];

        const totals = items.reduce(
            (acc, item) => {
                acc.totalVolume += item.quantity;
                acc.totalWeight += Number.isFinite(item.totalWeight) ? item.totalWeight : 0;
                acc.totalCost += Number.isFinite(item.totalCost) ? item.totalCost : 0;
                acc.totalSale += Number.isFinite(item.totalSale) ? item.totalSale : 0;
                return acc;
            },
            { totalVolume: 0, totalWeight: 0, totalCost: 0, totalSale: 0 }
        );

        totals.totalVolume = Math.round(totals.totalVolume * 1_000_000) / 1_000_000;
        totals.totalWeight = Math.round(totals.totalWeight * 1_000_000) / 1_000_000;
        totals.totalCost = Math.round(totals.totalCost * 100) / 100;
        totals.totalSale = Math.round(totals.totalSale * 100) / 100;

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
            venda: 1,
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

            const rawUnitCost = Number(rawItem.unitCost);
            const productUnitCost = Number(product?.custo);
            const normalizedUnitCost = Number.isFinite(rawUnitCost)
                ? Math.round(rawUnitCost * 100) / 100
                : Number.isFinite(productUnitCost)
                ? Math.round(productUnitCost * 100) / 100
                : null;

            const rawUnitSale = Number(rawItem.unitSale);
            const productUnitSale = Number(product?.venda);
            const normalizedUnitSale = Number.isFinite(rawUnitSale)
                ? Math.round(rawUnitSale * 100) / 100
                : Number.isFinite(productUnitSale)
                ? Math.round(productUnitSale * 100) / 100
                : null;

            const rawTotalSale = Number(rawItem.totalSale);
            let normalizedTotalSale = Number.isFinite(rawTotalSale)
                ? Math.round(rawTotalSale * 100) / 100
                : null;

            if (normalizedTotalSale === null && normalizedUnitSale !== null) {
                normalizedTotalSale = Math.round(normalizedUnitSale * quantity * 100) / 100;
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
                unitCost: normalizedUnitCost,
                unitSale: normalizedUnitSale,
                totalSale: normalizedTotalSale,
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
    let session = null;

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

        session = await mongoose.startSession();

        let responseTransfer = null;
        await session.withTransaction(async () => {
            const transfer = await Transfer.findById(id).session(session);
            if (!transfer) {
                const error = new Error('Transferência não encontrada.');
                error.statusCode = 404;
                throw error;
            }

            const currentStatus = normalizeStatus(transfer.status) || 'solicitada';

            if (normalizedStatus === 'aprovada' && currentStatus !== 'aprovada') {
                if (!Array.isArray(transfer.items) || transfer.items.length === 0) {
                    const error = new Error('A transferência não possui itens para movimentação.');
                    error.statusCode = 400;
                    throw error;
                }

                const originDepositId = toObjectIdOrNull(transfer.originDeposit);
                const destinationDepositId = toObjectIdOrNull(transfer.destinationDeposit);
                if (!originDepositId || !destinationDepositId) {
                    const error = new Error('Depósitos de origem ou destino inválidos para movimentação.');
                    error.statusCode = 400;
                    throw error;
                }

                for (const item of transfer.items) {
                    const productId = resolveProductObjectId(item?.product);
                    const quantity = Number(item?.quantity);
                    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
                        const error = new Error('Itens da transferência possuem dados inválidos.');
                        error.statusCode = 400;
                        throw error;
                    }

                    await adjustProductStockForDeposit({
                        productId,
                        depositId: originDepositId,
                        quantity: -quantity,
                        session,
                        cascadeFractional: true,
                    });
                }

                for (const item of transfer.items) {
                    const productId = resolveProductObjectId(item?.product);
                    const quantity = Number(item?.quantity);
                    await adjustProductStockForDeposit({
                        productId,
                        depositId: destinationDepositId,
                        quantity,
                        session,
                        cascadeFractional: true,
                    });
                }
            }

            transfer.status = normalizedStatus;
            await transfer.save({ session });

            responseTransfer = {
                id: String(transfer._id),
                number: Number(transfer.number) || 0,
                status: transfer.status,
            };
        });

        const transferStatus = responseTransfer?.status || normalizedStatus;
        res.json({
            message: 'Status da transferência atualizado com sucesso.',
            transfer: {
                id: responseTransfer?.id || id,
                number: responseTransfer?.number || 0,
                status: transferStatus,
                statusLabel: statusLabels[transferStatus] || transferStatus,
            },
        });
    } catch (error) {
        if (error?.statusCode === 404) {
            return res.status(404).json({ message: error.message });
        }
        if (error?.statusCode === 400) {
            return res.status(400).json({ message: error.message, details: error.details });
        }
        console.error('Erro ao atualizar status da transferência:', error);
        res.status(500).json({ message: 'Não foi possível atualizar o status da transferência.' });
    } finally {
        if (session) {
            await session.endSession();
        }
    }
});

module.exports = router;
