const fs = require('fs');
const path = require('path');

const mappingPath = path.join(__dirname, '..', 'data', 'fiscal-rules.json');
const rawMapping = fs.existsSync(mappingPath)
  ? JSON.parse(fs.readFileSync(mappingPath, 'utf-8'))
  : {};

const defaultMapping = rawMapping || {};
const defaults = defaultMapping.defaults || {};
const regimeRules = defaultMapping.regime || {};
const tipoProdutoRules = defaultMapping.tipoProduto || {};
const ncmOverrides = defaultMapping.ncmOverrides || {};

const toStringSafe = (value, fallback = '') => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
};

const toLower = (value) => toStringSafe(value).toLowerCase();

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (value._id) return toObjectIdString(value._id);
    if (value.id) return toObjectIdString(value.id);
    if (typeof value.toString === 'function') return value.toString();
  }
  return '';
};

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

const deepMerge = (target = {}, source = {}) => {
  if (!source || typeof source !== 'object') {
    return source;
  }
  const result = Array.isArray(target) ? [...target] : { ...target };
  Object.keys(source).forEach((key) => {
    const srcValue = source[key];
    const tgtValue = result[key];
    if (srcValue && typeof srcValue === 'object' && !Array.isArray(srcValue)) {
      result[key] = deepMerge(tgtValue || {}, srcValue);
    } else if (Array.isArray(srcValue)) {
      result[key] = [...srcValue];
    } else {
      result[key] = srcValue;
    }
  });
  return result;
};

const normalizeTax = (tax = {}) => ({
  codigo: toStringSafe(tax.codigo),
  cst: toStringSafe(tax.cst),
  aliquota: tax.aliquota === 0 ? 0 : Number.isFinite(Number(tax.aliquota)) ? Number(tax.aliquota) : null,
  tipoCalculo: toStringSafe(tax.tipoCalculo, 'percentual') || 'percentual',
  valorBase: Number.isFinite(Number(tax.valorBase)) ? Number(tax.valorBase) : null,
});

const normalizeCfop = (cfop = {}) => ({
  dentroEstado: toStringSafe(cfop.dentroEstado),
  foraEstado: toStringSafe(cfop.foraEstado),
  transferencia: toStringSafe(cfop.transferencia),
  devolucao: toStringSafe(cfop.devolucao),
  industrializacao: toStringSafe(cfop.industrializacao),
});

const normalizeFcp = (fcp = {}) => ({
  indicador: toStringSafe(fcp.indicador, '0') || '0',
  aliquota: fcp.aliquota === 0 ? 0 : Number.isFinite(Number(fcp.aliquota)) ? Number(fcp.aliquota) : null,
  aplica: Boolean(fcp.aplica),
});

const normalizeIpi = (ipi = {}) => ({
  cst: toStringSafe(ipi.cst),
  codigoEnquadramento: toStringSafe(ipi.codigoEnquadramento),
  aliquota: ipi.aliquota === 0 ? 0 : Number.isFinite(Number(ipi.aliquota)) ? Number(ipi.aliquota) : null,
  tipoCalculo: toStringSafe(ipi.tipoCalculo, 'percentual') || 'percentual',
  valorBase: Number.isFinite(Number(ipi.valorBase)) ? Number(ipi.valorBase) : null,
});

const normalizeStatus = (status = {}) => {
  const allowed = new Set(['pendente', 'parcial', 'aprovado']);
  const normalizeValue = (value) => {
    const normalized = toLower(value);
    return allowed.has(normalized) ? normalized : 'pendente';
  };
  return {
    nfe: normalizeValue(status.nfe),
    nfce: normalizeValue(status.nfce),
  };
};

const normalizeFiscalData = (fiscal = {}) => ({
  origem: toStringSafe(fiscal.origem, '0') || '0',
  cest: toStringSafe(fiscal.cest),
  csosn: toStringSafe(fiscal.csosn),
  cst: toStringSafe(fiscal.cst),
  cfop: {
    nfe: normalizeCfop(fiscal?.cfop?.nfe || {}),
    nfce: normalizeCfop(fiscal?.cfop?.nfce || {}),
  },
  pis: normalizeTax(fiscal.pis || {}),
  cofins: normalizeTax(fiscal.cofins || {}),
  ipi: normalizeIpi(fiscal.ipi || {}),
  fcp: normalizeFcp(fiscal.fcp || {}),
  status: normalizeStatus(fiscal.status || {}),
  atualizadoEm: fiscal.atualizadoEm ? new Date(fiscal.atualizadoEm) : null,
  atualizadoPor: toStringSafe(fiscal.atualizadoPor),
});

const getValueByPath = (obj, path) => {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, obj);
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const REQUIRED_COMMON_FIELDS = ['origem', 'pis.codigo', 'pis.cst', 'cofins.codigo', 'cofins.cst', 'ipi.cst', 'ipi.codigoEnquadramento'];
const REQUIRED_NUMERIC_FIELDS = ['pis.aliquota', 'cofins.aliquota', 'ipi.aliquota'];

const REQUIRED_CFOP_FIELDS = {
  nfe: ['cfop.nfe.dentroEstado', 'cfop.nfe.foraEstado'],
  nfce: ['cfop.nfce.dentroEstado'],
};

const DIFFERENCE_FIELDS = [
  'origem',
  'cest',
  'csosn',
  'cst',
  'cfop.nfe.dentroEstado',
  'cfop.nfe.foraEstado',
  'cfop.nfe.transferencia',
  'cfop.nfe.devolucao',
  'cfop.nfe.industrializacao',
  'cfop.nfce.dentroEstado',
  'cfop.nfce.foraEstado',
  'cfop.nfce.transferencia',
  'cfop.nfce.devolucao',
  'cfop.nfce.industrializacao',
  'pis.codigo',
  'pis.cst',
  'pis.aliquota',
  'pis.tipoCalculo',
  'cofins.codigo',
  'cofins.cst',
  'cofins.aliquota',
  'cofins.tipoCalculo',
  'ipi.cst',
  'ipi.codigoEnquadramento',
  'ipi.aliquota',
  'ipi.tipoCalculo',
  'fcp.indicador',
  'fcp.aliquota',
  'fcp.aplica',
];

const FIELD_LABELS = {
  origem: 'Origem da mercadoria',
  cest: 'CEST',
  csosn: 'CSOSN',
  cst: 'CST',
  'cfop.nfe.dentroEstado': 'CFOP NF-e dentro do estado',
  'cfop.nfe.foraEstado': 'CFOP NF-e fora do estado',
  'cfop.nfe.transferencia': 'CFOP NF-e transferência',
  'cfop.nfe.devolucao': 'CFOP NF-e devolução',
  'cfop.nfe.industrializacao': 'CFOP NF-e industrialização',
  'cfop.nfce.dentroEstado': 'CFOP NFC-e dentro do estado',
  'cfop.nfce.foraEstado': 'CFOP NFC-e fora do estado',
  'cfop.nfce.transferencia': 'CFOP NFC-e transferência',
  'cfop.nfce.devolucao': 'CFOP NFC-e devolução',
  'cfop.nfce.industrializacao': 'CFOP NFC-e industrialização',
  'pis.codigo': 'PIS código',
  'pis.cst': 'PIS CST',
  'pis.aliquota': 'PIS alíquota',
  'pis.tipoCalculo': 'PIS tipo de cálculo',
  'cofins.codigo': 'COFINS código',
  'cofins.cst': 'COFINS CST',
  'cofins.aliquota': 'COFINS alíquota',
  'cofins.tipoCalculo': 'COFINS tipo de cálculo',
  'ipi.cst': 'IPI CST',
  'ipi.codigoEnquadramento': 'IPI enquadramento',
  'ipi.aliquota': 'IPI alíquota',
  'ipi.tipoCalculo': 'IPI tipo de cálculo',
  'fcp.indicador': 'FCP indicador',
  'fcp.aliquota': 'FCP alíquota',
  'fcp.aplica': 'FCP aplicado',
};

const computeMissingFields = (fiscal, { regime } = {}) => {
  const normalized = normalizeFiscalData(fiscal || {});
  const missingCommon = [];

  REQUIRED_COMMON_FIELDS.forEach((path) => {
    if (!hasValue(getValueByPath(normalized, path))) {
      missingCommon.push(path);
    }
  });

  REQUIRED_NUMERIC_FIELDS.forEach((path) => {
    const value = getValueByPath(normalized, path);
    if (value === null || value === undefined) {
      missingCommon.push(path);
    }
  });

  const missingByModal = { nfe: [], nfce: [] };
  Object.keys(REQUIRED_CFOP_FIELDS).forEach((modalidade) => {
    REQUIRED_CFOP_FIELDS[modalidade].forEach((path) => {
      if (!hasValue(getValueByPath(normalized, path))) {
        missingByModal[modalidade].push(path);
      }
    });
  });

  const normalizedRegime = toLower(regime);
  if (normalizedRegime === 'normal') {
    if (!hasValue(normalized.cst)) missingCommon.push('cst');
  } else {
    if (!hasValue(normalized.csosn)) missingCommon.push('csosn');
  }

  return {
    comum: Array.from(new Set(missingCommon)),
    ...missingByModal,
  };
};

const isDifferentValue = (current, suggested) => {
  if (typeof current === 'number' || typeof suggested === 'number') {
    const currentNumber = Number(current);
    const suggestedNumber = Number(suggested);
    if (!Number.isFinite(currentNumber) && !Number.isFinite(suggestedNumber)) return false;
    if (!Number.isFinite(currentNumber) || !Number.isFinite(suggestedNumber)) return true;
    return Math.abs(currentNumber - suggestedNumber) > 0.0001;
  }
  if (typeof current === 'boolean' || typeof suggested === 'boolean') {
    return Boolean(current) !== Boolean(suggested);
  }
  return toStringSafe(current) !== toStringSafe(suggested);
};

const computeDifferences = (current, suggestion) => {
  const diffs = [];
  DIFFERENCE_FIELDS.forEach((path) => {
    const currentValue = getValueByPath(current, path);
    const suggestedValue = getValueByPath(suggestion, path);
    if (isDifferentValue(currentValue, suggestedValue)) {
      diffs.push({
        path,
        label: FIELD_LABELS[path] || path,
        atual: currentValue,
        sugerido: suggestedValue,
      });
    }
  });
  return diffs;
};

const determineStatusFromMissing = (missing, modalidade) => {
  const totalModalMissing = missing[modalidade]?.length || 0;
  const totalCommon = missing.comum?.length || 0;
  if (totalModalMissing === 0 && totalCommon === 0) return 'aprovado';
  if (totalModalMissing === 0 && totalCommon > 0) return 'parcial';
  return 'pendente';
};

const buildSuggestion = (product, store = {}, context = {}) => {
  const base = clone(defaults);
  const storeRegime = toLower(store.regimeTributario);
  if (regimeRules[storeRegime]) {
    deepMerge(base, regimeRules[storeRegime]);
  }

  const productType = product?.tipoProduto;
  if (productType) {
    const matchedType = Object.keys(tipoProdutoRules).find((key) => toLower(key) === toLower(productType));
    if (matchedType) {
      deepMerge(base, tipoProdutoRules[matchedType]);
    }
  }

  const normalizedNcm = toStringSafe(product?.ncm).replace(/[^0-9]/g, '');
  if (normalizedNcm && ncmOverrides[normalizedNcm]) {
    deepMerge(base, ncmOverrides[normalizedNcm]);
  }

  const suggestion = normalizeFiscalData(base);
  const missing = computeMissingFields(suggestion, { regime: storeRegime });
  suggestion.status = {
    nfe: determineStatusFromMissing(missing, 'nfe'),
    nfce: determineStatusFromMissing(missing, 'nfce'),
  };

  if (context.icmsSimplesMap) {
    suggestion.icmsSimples = context.icmsSimplesMap;
  }

  return { suggestion, missing };
};

const getFiscalDataForStore = (product, store) => {
  if (!product) return {};
  const storeId = toObjectIdString(store?._id || store);
  if (storeId) {
    const fiscalPerStore = product.fiscalPorEmpresa;
    if (fiscalPerStore) {
      if (typeof fiscalPerStore.get === 'function') {
        const value = fiscalPerStore.get(storeId);
        if (value) return value;
      } else if (typeof fiscalPerStore === 'object') {
        const value = fiscalPerStore[storeId];
        if (value) return value;
      }
    }
  }
  return product.fiscal || {};
};

const generateProductFiscalReport = (product, store, context = {}) => {
  const currentFiscal = normalizeFiscalData(getFiscalDataForStore(product, store));
  const { suggestion, missing } = buildSuggestion(product, store, context);
  const suggestionFiscal = normalizeFiscalData(suggestion);
  const missingCurrent = computeMissingFields(currentFiscal, { regime: toLower(store?.regimeTributario) });
  const differences = computeDifferences(currentFiscal, suggestionFiscal);

  return {
    productId: product?._id,
    cod: product?.cod,
    codbarras: product?.codbarras,
    nome: product?.nome,
    ncm: product?.ncm,
    tipoProduto: product?.tipoProduto,
    fiscalAtual: currentFiscal,
    sugestao: suggestionFiscal,
    pendenciasAtuais: missingCurrent,
    pendenciasSugestao: missing,
    divergencias: differences,
  };
};

const getFieldLabel = (path) => FIELD_LABELS[path] || path;

const describeMissingFields = (paths = []) => {
  if (!Array.isArray(paths)) {
    return [];
  }
  return paths.map((path) => getFieldLabel(path));
};

const mergeFiscalData = (base, overrides) => {
  const merged = deepMerge(normalizeFiscalData(base || {}), overrides || {});
  return normalizeFiscalData(merged);
};

module.exports = {
  normalizeFiscalData,
  computeMissingFields,
  buildSuggestion,
  generateProductFiscalReport,
  mergeFiscalData,
  getFiscalDataForStore,
  describeMissingFields,
  getFieldLabel,
};
