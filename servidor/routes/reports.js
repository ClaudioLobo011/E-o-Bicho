const express = require('express');
const mongoose = require('mongoose');
const PdvState = require('../models/PdvState');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;

  let date;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const isBrDateOnly = /^\d{2}\/\d{2}\/\d{4}$/.test(trimmed);

    if (isIsoDateOnly) {
      const [year, month, day] = trimmed.split('-').map(Number);
      date = new Date(year, month - 1, day);
    } else if (isBrDateOnly) {
      const [day, month, year] = trimmed.split('/').map(Number);
      date = new Date(year, month - 1, day);
    } else {
      date = new Date(trimmed);
    }
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const toObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const parseNumber = (value) => {
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    const cleaned = value
      .replace(/\s+/g, '')
      .replace(/[^0-9,.-]/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');

    const asNumber = Number(cleaned);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  return null;
};

const collectSaleItems = (sale = {}) => {
  const candidates = [
    sale.items,
    sale.receiptSnapshot?.items,
    sale.receiptSnapshot?.itens,
    sale.receiptSnapshot?.products,
    sale.receiptSnapshot?.produtos,
    sale.receiptSnapshot?.cart?.items,
    sale.receiptSnapshot?.cart?.itens,
    sale.receiptSnapshot?.cart?.products,
    sale.receiptSnapshot?.cart?.produtos,
    sale.itemsSnapshot,
    sale.itemsSnapshot?.items,
    sale.itemsSnapshot?.itens,
    sale.fiscalItemsSnapshot,
    sale.fiscalItemsSnapshot?.items,
    sale.fiscalItemsSnapshot?.itens,
  ];

  for (const entry of candidates) {
    if (!Array.isArray(entry) || !entry.length) continue;
    const filtered = entry.filter((item) => item && typeof item === 'object');
    if (filtered.length) return filtered;
  }

  return [];
};

const deriveItemQuantity = (item = {}) => {
  const candidates = [item.quantity, item.quantidade, item.qty, item.qtd, item.amount];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return 1;
};

const deriveItemUnitCost = (item = {}) => {
  const candidates = [
    item.precoCusto,
    item.preco_custo,
    item.precoCustoUnitario,
    item.preco_custo_unitario,
    item.precoCustoValue,
    item.cost,
    item.costPrice,
    item.unitCost,
    item.custo,
    item.custoCalculado,
    item.custoUnitario,
    item.custo_unitario,
    item.custoMedio,
    item.custoReferencia,
    item.custo_referencia,
    item.costValue,
    item.productSnapshot?.precoCusto,
    item.productSnapshot?.precoCustoUnitario,
    item.produtoSnapshot?.precoCusto,
    item.produtoSnapshot?.precoCustoUnitario,
    item.product?.precoCusto,
    item.produto?.precoCusto,
    item.product?.precoCustoUnitario,
    item.produto?.precoCustoUnitario,
    item.productSnapshot?.custo,
    item.productSnapshot?.custoCalculado,
    item.productSnapshot?.custoMedio,
    item.productSnapshot?.custoReferencia,
    item.productSnapshot?.preco_custo,
    item.productSnapshot?.preco_custo_unitario,
    item.produtoSnapshot?.custo,
    item.produtoSnapshot?.custoCalculado,
    item.produtoSnapshot?.custoMedio,
    item.produtoSnapshot?.custoReferencia,
    item.produtoSnapshot?.preco_custo,
    item.produtoSnapshot?.preco_custo_unitario,
    item.product?.custo,
    item.produto?.custo,
    item.product?.custoCalculado,
    item.produto?.custoCalculado,
    item.product?.custoMedio,
    item.produto?.custoMedio,
    item.product?.custoReferencia,
    item.produto?.custoReferencia,
    item.product?.preco_custo,
    item.produto?.preco_custo,
    item.product?.preco_custo_unitario,
    item.produto?.preco_custo_unitario,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const deriveItemTotalCost = (item = {}) => {
  const candidates = [
    item.precoCustoTotal,
    item.totalPrecoCusto,
    item.precoCustoValorTotal,
    item.totalCost,
    item.custoTotal,
    item.totalCusto,
    item.custoTotalCalculado,
    item.totalCostValue,
    item.productSnapshot?.precoCustoTotal,
    item.produtoSnapshot?.precoCustoTotal,
    item.productSnapshot?.custoTotal,
    item.productSnapshot?.totalCusto,
    item.productSnapshot?.custoTotalCalculado,
    item.produtoSnapshot?.custoTotal,
    item.produtoSnapshot?.totalCusto,
    item.produtoSnapshot?.custoTotalCalculado,
    item.product?.custoTotal,
    item.produto?.custoTotal,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const deriveSaleCost = (sale = {}) => {
  const items = collectSaleItems(sale);
  if (!items.length) return null;

  let foundItemCost = false;

  const totalFromItems = items.reduce((acc, item) => {
    const itemTotalCost = deriveItemTotalCost(item);
    if (itemTotalCost !== null) {
      foundItemCost = true;
      return acc + itemTotalCost;
    }

    const quantity = deriveItemQuantity(item) || 0;
    const unitCost = deriveItemUnitCost(item);
    if (unitCost !== null) {
      foundItemCost = true;
      return acc + quantity * unitCost;
    }

    return acc;
  }, 0);

  if (foundItemCost) return totalFromItems;

  const totals = sale?.receiptSnapshot?.totais || sale?.totais || {};
  const candidates = [
    sale.cost,
    sale.totalCost,
    sale.custo,
    sale.custoTotal,
    sale.precoCustoTotal,
    sale.totalPrecoCusto,
    totals.custo,
    totals.custoTotal,
    totals.totalCusto,
    totals.precoCusto,
    totals.precoCustoTotal,
    totals.totalPrecoCusto,
  ];

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
};

const deriveSaleTotal = (sale = {}) => {
  const totals = sale?.receiptSnapshot?.totais || {};
  const candidates = [
    sale.total,
    sale.totalAmount,
    sale.valorTotal,
    sale.totalVenda,
    sale.totalGeral,
    totals?.liquido,
    totals?.total,
    totals?.totalGeral,
    totals?.pago,
    totals?.valorTotal,
    totals?.totalVenda,
    totals?.bruto,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) return parsed;
  }

  if (Array.isArray(sale.items) && sale.items.length > 0) {
    const sum = sale.items.reduce((acc, item) => {
      const qty = parseNumber(item?.quantity) ?? parseNumber(item?.quantidade) ?? 0;
      const price = parseNumber(item?.unitPrice) ?? parseNumber(item?.valor) ?? 0;
      return acc + qty * price;
    }, 0);
    if (sum > 0) return sum;
  }

  return 0;
};

router.get(
  '/pdv-sales',
  requireAuth,
  authorizeRoles('admin', 'admin_master', 'funcionario'),
  async (req, res) => {
    try {
      const { start, end, storeId, pdvId, status, channel } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

      const baseMatch = {};
      const saleMatch = {};

      const startDate = parseDate(start);
      const endDate = parseDate(end, true);

      if (startDate || endDate) {
        saleMatch['completedSales.createdAt'] = {};
        if (startDate) saleMatch['completedSales.createdAt'].$gte = startDate;
        if (endDate) saleMatch['completedSales.createdAt'].$lte = endDate;
      }

      const storeObjectId = toObjectId(storeId);
      if (storeObjectId) {
        baseMatch.empresa = storeObjectId;
      }

      const pdvObjectId = toObjectId(pdvId);
      if (pdvObjectId) {
        baseMatch.pdv = pdvObjectId;
      }

      if (status) {
        saleMatch['completedSales.status'] = status;
      }

      if (channel) {
        saleMatch['completedSales.type'] = channel;
      }

      const skip = (page - 1) * pageSize;

      const pipeline = [
        { $match: baseMatch },
        {
          $lookup: {
            from: 'pdvs',
            localField: 'pdv',
            foreignField: '_id',
            as: 'pdvInfo',
          },
        },
        { $unwind: '$pdvInfo' },
        {
          $lookup: {
            from: 'stores',
            localField: 'empresa',
            foreignField: '_id',
            as: 'storeInfo',
          },
        },
        { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            completedSales: 1,
            pdv: {
              _id: '$pdvInfo._id',
              nome: '$pdvInfo.nome',
              codigo: '$pdvInfo.codigo',
            },
            store: {
              _id: '$storeInfo._id',
              nome: '$storeInfo.nome',
              fantasia: '$storeInfo.fantasia',
              apelido: '$storeInfo.apelido',
            },
          },
        },
        { $unwind: '$completedSales' },
        { $match: saleMatch },
        { $sort: { 'completedSales.createdAt': -1 } },
        {
          $facet: {
            totalCount: [{ $count: 'count' }],
            data: [{ $skip: skip }, { $limit: pageSize }],
          },
        },
      ];

      const result = await PdvState.aggregate(pipeline);
      const totalCount = result?.[0]?.totalCount?.[0]?.count || 0;
      const records = result?.[0]?.data || [];

      const sales = records.map((record) => {
        const sale = record.completedSales || {};
        const storeName = record.store?.fantasia || record.store?.apelido || record.store?.nome;
        return {
          id: sale.id,
          saleCode: sale.saleCode || sale.saleCodeLabel || 'Sem código',
          createdAt: sale.createdAt,
          createdAtLabel: sale.createdAtLabel || '',
          store: {
            id: record.store?._id,
            name: storeName || 'Loja não informada',
          },
          pdv: {
            id: record.pdv?._id,
            name: record.pdv?.nome || record.pdv?.codigo || 'PDV',
          },
          channel: sale.type || 'venda',
          channelLabel: sale.typeLabel || 'Venda',
          totalValue: deriveSaleTotal(sale),
          costValue: deriveSaleCost(sale),
          status: sale.status || 'completed',
        };
      });

      const completedSalesTotal = sales.reduce((acc, sale) => acc + (sale.totalValue || 0), 0);
      const averageTicket = sales.length ? completedSalesTotal / sales.length : 0;
      const completedCount = sales.filter((sale) => sale.status === 'completed').length;

      res.json({
        sales,
        pagination: {
          total: totalCount,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        },
        metrics: {
          totalValue: completedSalesTotal,
          averageTicket,
          completedCount,
        },
      });
    } catch (error) {
      console.error('Erro ao listar vendas de PDVs:', error);
      res.status(500).json({ message: 'Erro ao listar vendas de PDVs.' });
    }
  }
);

module.exports = router;
