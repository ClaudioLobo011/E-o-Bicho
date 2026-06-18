require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Store = require('../models/Store');
const FiscalDefaultRule = require('../models/FiscalDefaultRule');
const { normalizeFiscalData } = require('../services/fiscalRuleEngine');

const TARGET_STORE_NAME_PATTERNS = [/Vila Isabel/i, /Tijuca/i];
const MIGRATION_USER = 'codex-migrate-fiscal-default-rules';

const onlyDigits = (value) => String(value || '').replace(/\D+/g, '');

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

const getNested = (source, pathParts = []) => {
  let current = source;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return '';
    current = current[part];
  }
  return current === undefined || current === null ? '' : current;
};

const getFiscalForStore = (product, storeId) => {
  const fiscalByStore = product?.fiscalPorEmpresa;
  if (fiscalByStore) {
    if (typeof fiscalByStore.get === 'function') {
      const value = fiscalByStore.get(storeId);
      if (value) return value;
    } else if (typeof fiscalByStore === 'object' && fiscalByStore[storeId]) {
      return fiscalByStore[storeId];
    }
  }
  return product?.fiscal || {};
};

const normalizeRuleCode = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const hasAnyCode = (fiscal, codes = []) => {
  const candidates = [
    getNested(fiscal, ['cfop', 'nfce', 'dentroEstado']),
    getNested(fiscal, ['cfop', 'nfce', 'entrada']),
    getNested(fiscal, ['cfop', 'nfce', 'foraEstado']),
    getNested(fiscal, ['cfop', 'nfce', 'devolucao']),
    getNested(fiscal, ['cfop', 'nfe', 'dentroEstado']),
    getNested(fiscal, ['cfop', 'nfe', 'entrada']),
    getNested(fiscal, ['cfop', 'nfe', 'foraEstado']),
    getNested(fiscal, ['cfop', 'nfe', 'devolucao']),
  ].map(onlyDigits);
  return candidates.some((candidate) => codes.includes(candidate));
};

const chooseRuleCode = ({ product, fiscal, availableCodes }) => {
  const storedCode = normalizeRuleCode(fiscal?.fiscalRuleCode || fiscal?.regraFiscalCodigo || fiscal?.ruleCode);
  if (storedCode && availableCodes.has(storedCode)) {
    return {
      code: storedCode,
      reason: `regra ja vinculada no produto (${storedCode})`,
      confidence: 'alta',
    };
  }

  const ncm = onlyDigits(product?.ncm);
  const cst = onlyDigits(fiscal?.cst).padStart(2, '0').slice(-2);
  const cest = onlyDigits(fiscal?.cest);
  const fcpAplica = fiscal?.fcp?.aplica === true;

  if (
    availableCodes.has(2) &&
    (
      ncm.startsWith('2309') ||
      cst === '60' ||
      fcpAplica ||
      hasAnyCode(fiscal, ['5405', '1403', '6404', '5411'])
    )
  ) {
    const motivos = [];
    if (ncm.startsWith('2309')) motivos.push(`NCM ${ncm}`);
    if (cst === '60') motivos.push('CST 60');
    if (cest === '2200100') motivos.push('CEST 22.001.00');
    if (fcpAplica) motivos.push('FCP aplicado');
    if (hasAnyCode(fiscal, ['5405', '1403', '6404', '5411'])) motivos.push('CFOP de substituicao/entrada ST');
    return {
      code: 2,
      reason: motivos.join(', '),
      confidence: 'alta',
    };
  }

  if (availableCodes.has(1)) {
    return {
      code: 1,
      reason: 'sem sinal fiscal objetivo para regra 2; aplicado padrao restante regra 1',
      confidence: 'media',
    };
  }

  return {
    code: null,
    reason: 'nenhuma regra fiscal compativel cadastrada para a empresa',
    confidence: 'baixa',
  };
};

const buildFiscalFromRule = (rule) => ({
  ...normalizeFiscalData(rule?.fiscal || {}),
  fiscalRuleCode: String(rule.code),
  fiscalRuleName: `${rule.code} - ${rule.name}`,
  atualizadoEm: new Date(),
  atualizadoPor: MIGRATION_USER,
});

const main = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI/MONGO_URI nao configurado.');
  }

  await mongoose.connect(mongoUri);

  const stores = [];
  for (const pattern of TARGET_STORE_NAME_PATTERNS) {
    const store = await Store.findOne({ nome: pattern }).lean();
    if (!store) {
      throw new Error(`Empresa nao encontrada para o padrao ${pattern}.`);
    }
    stores.push(store);
  }

  const rules = await FiscalDefaultRule.find({ empresa: { $in: stores.map((store) => store._id) } })
    .sort({ empresa: 1, code: 1 })
    .lean();

  const rulesByStore = new Map();
  for (const store of stores) {
    const storeId = String(store._id);
    const storeRules = rules.filter((rule) => String(rule.empresa) === storeId);
    const byCode = new Map(storeRules.map((rule) => [Number(rule.code), rule]));
    if (!byCode.has(1) || !byCode.has(2)) {
      throw new Error(`Empresa ${store.nome} precisa ter as regras 1 e 2 cadastradas antes da migracao.`);
    }
    rulesByStore.set(storeId, byCode);
  }

  const products = await Product.find({}).sort({ cod: 1 }).lean();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const backupPath = path.join(reportDir, `backup-products-fiscal-before-rule-migration-${timestamp}.json`);
  const reportPath = path.join(reportDir, `products-fiscal-rule-migration-report-${timestamp}.json`);

  const backup = products.map((product) => {
    return {
      _id: String(product._id),
      cod: product.cod,
      nome: product.nome,
      ncm: product.ncm,
      fiscal: product.fiscal || {},
      fiscalPorEmpresa: product.fiscalPorEmpresa || {},
    };
  });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  const originalBackupPath = process.env.ORIGINAL_FISCAL_BACKUP_PATH || '';
  const originalProductsById = new Map();
  if (originalBackupPath) {
    const originalProducts = JSON.parse(fs.readFileSync(originalBackupPath, 'utf8'));
    if (!Array.isArray(originalProducts)) {
      throw new Error('ORIGINAL_FISCAL_BACKUP_PATH deve apontar para um backup JSON de produtos.');
    }
    originalProducts.forEach((entry) => {
      if (entry?._id) {
        originalProductsById.set(String(entry._id), entry);
      }
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    migrationUser: MIGRATION_USER,
    backupPath,
    originalBackupPath: originalBackupPath || null,
    stores: stores.map((store) => ({ id: String(store._id), nome: store.nome })),
    totals: {
      productsRead: products.length,
      productsChanged: 0,
      assignmentsChanged: 0,
      byRule: {},
      byConfidence: {},
      unresolved: 0,
    },
    assignments: [],
  };

  const bulkOperations = [];
  const flushBulkOperations = async () => {
    if (!bulkOperations.length) return;
    await Product.bulkWrite(bulkOperations.splice(0, bulkOperations.length), { ordered: false });
  };

  for (const product of products) {
    const setPayload = {};
    for (const store of stores) {
      const storeId = String(store._id);
      const rulesForStore = rulesByStore.get(storeId);
      const availableCodes = new Set(rulesForStore.keys());
      const decisionSourceProduct = originalProductsById.get(String(product._id)) || product;
      const previousFiscal = clone(getFiscalForStore(decisionSourceProduct, storeId));
      const decision = chooseRuleCode({ product, fiscal: previousFiscal, availableCodes });

      if (!decision.code) {
        report.totals.unresolved += 1;
        report.assignments.push({
          productId: String(product._id),
          cod: product.cod,
          nome: product.nome,
          ncm: product.ncm || '',
          storeId,
          storeName: store.nome,
          changed: false,
          ruleCode: null,
          ruleName: '',
          reason: decision.reason,
          confidence: decision.confidence,
        });
        continue;
      }

      const selectedRule = rulesForStore.get(decision.code);
      const nextFiscal = buildFiscalFromRule(selectedRule);
      setPayload[`fiscalPorEmpresa.${storeId}`] = nextFiscal;
      report.totals.assignmentsChanged += 1;
      report.totals.byRule[String(decision.code)] = (report.totals.byRule[String(decision.code)] || 0) + 1;
      report.totals.byConfidence[decision.confidence] =
        (report.totals.byConfidence[decision.confidence] || 0) + 1;
      report.assignments.push({
        productId: String(product._id),
        cod: product.cod,
        nome: product.nome,
        ncm: product.ncm || '',
        storeId,
        storeName: store.nome,
        changed: true,
        ruleCode: decision.code,
        ruleName: `${selectedRule.code} - ${selectedRule.name}`,
        reason: decision.reason,
        confidence: decision.confidence,
        previous: {
          fiscalRuleCode: previousFiscal?.fiscalRuleCode || '',
          fiscalRuleName: previousFiscal?.fiscalRuleName || '',
          cst: previousFiscal?.cst || '',
          csosn: previousFiscal?.csosn || '',
          cest: previousFiscal?.cest || '',
          ncm: product.ncm || '',
          cfopNfceDentro: previousFiscal?.cfop?.nfce?.dentroEstado || '',
          cfopNfeDentro: previousFiscal?.cfop?.nfe?.dentroEstado || '',
        },
      });
    }

    if (Object.keys(setPayload).length) {
      bulkOperations.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: setPayload },
        },
      });
      report.totals.productsChanged += 1;
      if (bulkOperations.length >= 500) {
        await flushBulkOperations();
      }
    }
  }

  await flushBulkOperations();

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    ok: true,
    backupPath,
    reportPath,
    totals: report.totals,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      // ignore disconnect errors
    }
  });
