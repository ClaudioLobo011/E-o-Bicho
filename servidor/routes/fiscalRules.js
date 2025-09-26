const express = require('express');
const router = express.Router();
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Product = require('../models/Product');
const Store = require('../models/Store');
const IcmsSimples = require('../models/IcmsSimples');
const {
  generateProductFiscalReport,
  mergeFiscalData,
  getFiscalDataForStore,
} = require('../services/fiscalRuleEngine');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const buildSearchQuery = (searchTerm = '') => {
  const trimmed = searchTerm.trim();
  if (!trimmed) return null;
  const regex = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return {
    $or: [
      { nome: regex },
      { cod: regex },
      { codbarras: regex },
    ],
  };
};

const normalizeStoreKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
};

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const {
      storeId,
      modalidade = 'nfe',
      status,
      search = '',
      limit = 20,
      page = 1,
    } = req.query;

    if (!storeId) {
      return res.status(400).json({ message: 'É necessário informar a empresa (storeId).' });
    }

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    const normalizedModalidade = (modalidade || '').toLowerCase();
    const normalizedStatus = (status || '').toLowerCase();
    const allowedStatus = new Set(['pendente', 'parcial', 'aprovado']);
    const modalKey = normalizedModalidade === 'nfce' ? 'nfce' : 'nfe';
    const storeKey = normalizeStoreKey(store?._id) || normalizeStoreKey(storeId);

    if (!storeKey) {
      return res.status(500).json({ message: 'Não foi possível determinar a empresa selecionada.' });
    }

    const filters = [];
    const searchQuery = buildSearchQuery(search);
    if (searchQuery) {
      filters.push(searchQuery);
    }

    if (allowedStatus.has(normalizedStatus) && storeKey) {
      filters.push({
        $or: [
          { [`fiscalPorEmpresa.${storeKey}.status.${modalKey}`]: normalizedStatus },
          {
            $and: [
              {
                $or: [
                  { [`fiscalPorEmpresa.${storeKey}`]: { $exists: false } },
                  { [`fiscalPorEmpresa.${storeKey}.status.${modalKey}`]: { $exists: false } },
                ],
              },
              { [`fiscal.status.${modalKey}`]: normalizedStatus },
            ],
          },
        ],
      });
    }

    const query = filters.length ? { $and: filters } : {};

    const total = await Product.countDocuments(query);
    const pageSize = parsePositiveInt(limit, 20);
    const currentPage = parsePositiveInt(page, 1);

    const products = await Product.find(query)
      .sort({ nome: 1 })
      .skip(pageSize * (currentPage - 1))
      .limit(pageSize)
      .lean();

    const icmsEntries = await IcmsSimples.find({ empresa: storeId }).populate('empresa').lean();
    const icmsSimplesMap = {};
    icmsEntries.forEach((entry) => {
      if (entry && entry.codigo !== undefined && entry.valor !== undefined) {
        icmsSimplesMap[entry.codigo] = entry.valor;
      }
    });

    const reports = products.map((product) => (
      generateProductFiscalReport(product, store, {
        modalidade: normalizedModalidade,
        icmsSimplesMap,
      })
    ));

    res.json({
      page: currentPage,
      limit: pageSize,
      total,
      pages: Math.ceil(total / pageSize) || 1,
      modalidade: normalizedModalidade,
      store: {
        _id: store._id,
        nome: store.nome,
        regimeTributario: store.regimeTributario,
        uf: store.uf,
      },
      icmsSimples: icmsEntries,
      produtos: reports,
    });
  } catch (error) {
    console.error('Erro ao gerar sugestões fiscais:', error);
    res.status(500).json({ message: 'Erro ao gerar sugestões fiscais.' });
  }
});

router.post('/apply', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'Nenhum item informado para atualização.' });
    }

    const updated = [];
    const failures = [];
    const storeCache = new Map();

    const resolveStore = async (id) => {
      const key = normalizeStoreKey(id);
      if (!key) return null;
      if (storeCache.has(key)) return storeCache.get(key);
      const storeDoc = await Store.findById(id).lean();
      storeCache.set(key, storeDoc || null);
      return storeDoc || null;
    };

    for (const item of items) {
      if (!item || !item.productId || !item.fiscal) {
        failures.push({ productId: item?.productId, reason: 'Dados incompletos.' });
        // eslint-disable-next-line no-continue
        continue;
      }

      try {
        const product = await Product.findById(item.productId);
        if (!product) {
          failures.push({ productId: item.productId, reason: 'Produto não encontrado.' });
          // eslint-disable-next-line no-continue
          continue;
        }

        const storeIdRaw = item.storeId;
        const storeId = normalizeStoreKey(storeIdRaw);
        const store = await resolveStore(storeIdRaw || storeId);
        if (storeId && !store) {
          failures.push({ productId: item.productId, reason: 'Empresa não encontrada.' });
          // eslint-disable-next-line no-continue
          continue;
        }

        const baseFiscal = storeId ? getFiscalDataForStore(product, storeId) : (product.fiscal || {});
        const mergedFiscal = mergeFiscalData(baseFiscal, item.fiscal || {});
        mergedFiscal.atualizadoEm = new Date();
        mergedFiscal.atualizadoPor = req.user?.id || '';
        if (storeId) {
          product.set(`fiscalPorEmpresa.${storeId}`, mergedFiscal);
        } else {
          product.fiscal = mergedFiscal;
        }
        await product.save();

        const contextStore = store || {};
        const report = generateProductFiscalReport(product.toObject(), contextStore, {});
        updated.push(report);
      } catch (error) {
        console.error('Erro ao aplicar regra fiscal para produto:', item?.productId, error);
        failures.push({ productId: item?.productId, reason: 'Erro ao atualizar.' });
      }
    }

    res.json({ updated, failures });
  } catch (error) {
    console.error('Erro ao aplicar regras fiscais:', error);
    res.status(500).json({ message: 'Erro ao aplicar regras fiscais.' });
  }
});

router.post('/apply-suggestions', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const {
      storeId,
      modalidade = 'nfe',
      status,
      search = '',
    } = req.body || {};

    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    const normalizedModalidade = (modalidade || '').toLowerCase();
    const normalizedStatus = (status || '').toLowerCase();
    const allowedStatus = new Set(['pendente', 'parcial', 'aprovado']);
    const modalKey = normalizedModalidade === 'nfce' ? 'nfce' : 'nfe';
    const storeKey = normalizeStoreKey(store?._id) || normalizeStoreKey(storeId);

    if (!storeKey) {
      return res.status(500).json({ message: 'Não foi possível determinar a empresa para aplicar as regras fiscais sugeridas.' });
    }

    const filters = [];
    const searchQuery = buildSearchQuery(search);
    if (searchQuery) filters.push(searchQuery);
    if (allowedStatus.has(normalizedStatus) && storeKey) {
      filters.push({
        $or: [
          { [`fiscalPorEmpresa.${storeKey}.status.${modalKey}`]: normalizedStatus },
          {
            $and: [
              {
                $or: [
                  { [`fiscalPorEmpresa.${storeKey}`]: { $exists: false } },
                  { [`fiscalPorEmpresa.${storeKey}.status.${modalKey}`]: { $exists: false } },
                ],
              },
              { [`fiscal.status.${modalKey}`]: normalizedStatus },
            ],
          },
        ],
      });
    }

    const query = filters.length ? { $and: filters } : {};

    const icmsEntries = await IcmsSimples.find({ empresa: storeId }).lean();
    const icmsSimplesMap = {};
    icmsEntries.forEach((entry) => {
      if (entry && entry.codigo !== undefined && entry.valor !== undefined) {
        icmsSimplesMap[entry.codigo] = entry.valor;
      }
    });

    const cursor = Product.find(query).cursor();
    let processed = 0;
    let updatedCount = 0;
    const failures = [];

    // eslint-disable-next-line no-restricted-syntax
    for await (const product of cursor) {
      processed += 1;
      try {
        const report = generateProductFiscalReport(product.toObject(), store, {
          modalidade: normalizedModalidade,
          icmsSimplesMap,
        });
        const suggestion = report?.sugestao;
        if (!suggestion) {
          failures.push({ productId: product?._id, reason: 'Sugestão indisponível.' });
          // eslint-disable-next-line no-continue
          continue;
        }

        const mergedFiscal = mergeFiscalData(getFiscalDataForStore(product, storeKey), suggestion || {});
        mergedFiscal.atualizadoEm = new Date();
        mergedFiscal.atualizadoPor = req.user?.id || '';
        product.set(`fiscalPorEmpresa.${storeKey}`, mergedFiscal);
        await product.save();
        updatedCount += 1;
      } catch (error) {
        console.error('Erro ao aplicar sugestão fiscal em massa:', error);
        failures.push({ productId: product?._id, reason: 'Erro ao atualizar.' });
      }
    }

    res.json({
      processed,
      updatedCount,
      failuresCount: failures.length,
      failures,
    });
  } catch (error) {
    console.error('Erro ao aplicar regras fiscais sugeridas em massa:', error);
    res.status(500).json({ message: 'Erro ao aplicar regras fiscais sugeridas.' });
  }
});

router.get('/:productId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { storeId } = req.query;
    const { productId } = req.params;
    if (!storeId) {
      return res.status(400).json({ message: 'Informe a empresa (storeId).' });
    }
    const [store, product, icmsEntries] = await Promise.all([
      Store.findById(storeId).lean(),
      Product.findById(productId).lean(),
      IcmsSimples.find({ empresa: storeId }).lean(),
    ]);

    if (!store) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }
    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado.' });
    }

    const icmsSimplesMap = {};
    icmsEntries.forEach((entry) => {
      if (entry && entry.codigo !== undefined && entry.valor !== undefined) {
        icmsSimplesMap[entry.codigo] = entry.valor;
      }
    });

    const report = generateProductFiscalReport(product, store, { icmsSimplesMap });
    res.json({
      store: {
        _id: store._id,
        nome: store.nome,
        regimeTributario: store.regimeTributario,
        uf: store.uf,
      },
      produto: report,
      icmsSimples: icmsEntries,
    });
  } catch (error) {
    console.error('Erro ao consultar regras fiscais do produto:', error);
    res.status(500).json({ message: 'Erro ao consultar regras fiscais do produto.' });
  }
});

module.exports = router;
