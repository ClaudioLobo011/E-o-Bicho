const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');
const { SignedXml } = require('xml-crypto');
const NfeEmissionDraft = require('../models/NfeEmissionDraft');
const FiscalSerie = require('../models/FiscalSerie');
const Store = require('../models/Store');
const { sanitizeSegment } = require('../utils/fiscalDrivePath');
const { decryptBuffer, decryptText } = require('../utils/certificates');
const { extractCertificatePair } = require('../scripts/utils/certificates');
const { sanitizeXmlContent } = require('../utils/xmlSanitizer');
const { transmitNfeToSefaz } = require('../services/sefazTransmitter');
const {
  isR2Configured,
  uploadBufferToR2,
  getObjectFromR2,
  buildPublicUrl,
} = require('../utils/cloudflareR2');

const router = express.Router();

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const TPAG = Object.freeze({
  DINHEIRO: '01',
  CHEQUE: '02',
  CARTAO_CREDITO: '03',
  CARTAO_DEBITO: '04',
  CARTAO_LOJA: '05',
  VALE_ALIMENTACAO: '10',
  VALE_REFEICAO: '11',
  VALE_PRESENTE: '12',
  VALE_COMBUSTIVEL: '13',
  DUPLICATA_MERCANTIL: '14',
  BOLETO_BANCARIO: '15',
  DEPOSITO_BANCARIO: '16',
  PIX_DINAMICO: '17',
  TRANSFERENCIA_BANCARIA: '18',
  PROGRAMA_FIDELIDADE: '19',
  PIX_ESTATICO: '20',
  CREDITO_LOJA: '21',
  PAGAMENTO_ELETRONICO_NAO_INFORMADO: '22',
  SEM_PAGAMENTO: '90',
  PAGAMENTO_POSTERIOR: '91',
  OUTROS: '99',
});

const PRAZO_TPAG = new Set([
  TPAG.CARTAO_LOJA,
  TPAG.DUPLICATA_MERCANTIL,
  TPAG.BOLETO_BANCARIO,
  TPAG.DEPOSITO_BANCARIO,
  TPAG.TRANSFERENCIA_BANCARIA,
  TPAG.PROGRAMA_FIDELIDADE,
  TPAG.CREDITO_LOJA,
  TPAG.PAGAMENTO_POSTERIOR,
]);

const normalizeKeyword = (value) =>
  cleanString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const formatNDup = (index) => String(index).padStart(3, '0');

const toCents = (value) => Math.round((toNumber(value) || 0) * 100);

const sumParcelas = (duplicates = []) =>
  duplicates.reduce((sum, duplicate) => sum + toCents(duplicate?.value), 0);

const resolveOtherTpag = (label) => {
  const normalized = normalizeKeyword(label);
  if (!normalized) return TPAG.OUTROS;
  if (normalized.includes('duplicata')) return TPAG.DUPLICATA_MERCANTIL;
  if (normalized.includes('boleto')) return TPAG.BOLETO_BANCARIO;
  if (normalized.includes('deposito')) return TPAG.DEPOSITO_BANCARIO;
  if (normalized.includes('transferencia') || normalized.includes('carteira')) {
    return TPAG.TRANSFERENCIA_BANCARIA;
  }
  if (normalized.includes('pix') && normalized.includes('estatic')) return TPAG.PIX_ESTATICO;
  if (normalized.includes('pix')) return TPAG.PIX_DINAMICO;
  if (normalized.includes('vale') && normalized.includes('aliment')) return TPAG.VALE_ALIMENTACAO;
  if (normalized.includes('vale') && normalized.includes('refei')) return TPAG.VALE_REFEICAO;
  if (normalized.includes('vale') && normalized.includes('present')) return TPAG.VALE_PRESENTE;
  if (normalized.includes('vale') && normalized.includes('combust')) return TPAG.VALE_COMBUSTIVEL;
  if (normalized.includes('fidelidade') || normalized.includes('cashback')) return TPAG.PROGRAMA_FIDELIDADE;
  if (normalized.includes('credito') && normalized.includes('loja')) return TPAG.CREDITO_LOJA;
  if (normalized.includes('posterior')) return TPAG.PAGAMENTO_POSTERIOR;
  if (normalized.includes('sem pagamento')) return TPAG.SEM_PAGAMENTO;
  return TPAG.OUTROS;
};

const resolveCardTpag = (label) => {
  const normalized = normalizeKeyword(label);
  if (!normalized) return TPAG.CARTAO_CREDITO;
  if (normalized.includes('deb')) return TPAG.CARTAO_DEBITO;
  return TPAG.CARTAO_CREDITO;
};

const resolveIndPag = ({ tPag, label }) => {
  if (PRAZO_TPAG.has(tPag)) return '1';
  const normalized = normalizeKeyword(label);
  if (normalized.includes('parcel') || normalized.includes('prazo')) return '1';
  return '0';
};

const validatePagCobrConsistency = ({ hasCobr, paymentEntries }) => {
  if (!hasCobr) {
    const hasPrazoEntry = paymentEntries.some((entry) => entry.indPag === '1');
    const hasCobrType = paymentEntries.some((entry) => PRAZO_TPAG.has(entry.tPag));
    if (hasPrazoEntry && hasCobrType) {
      throw new Error('Pagamento a prazo exige cobrança com duplicatas.');
    }
    return;
  }

  const hasPrazoEntry = paymentEntries.some((entry) => entry.indPag === '1');
  if (!hasPrazoEntry) {
    throw new Error('Cobrança parcelada exige pelo menos um pagamento a prazo.');
  }
  const onlyCash = paymentEntries.length === 1 && paymentEntries[0].tPag === TPAG.DINHEIRO;
  if (onlyCash) {
    throw new Error('Pagamento em dinheiro à vista não pode ter duplicatas.');
  }
};

const buildPaymentEntries = ({ payments = {}, duplicatesTotal = 0 }) => {
  const aggregate = new Map();
  const addEntry = ({ tPag, vPag, indPag, label }) => {
    const value = toNumber(vPag) || 0;
    if (value <= 0) return;
    const key = `${tPag}|${indPag}`;
    const current = aggregate.get(key) || { tPag, indPag, vPag: 0, label };
    current.vPag += value;
    aggregate.set(key, current);
  };

  const sumValues = (rows = [], field = 'value') =>
    rows.reduce((sum, row) => sum + (toNumber(row?.[field]) || 0), 0);

  if (Array.isArray(payments.cash)) {
    addEntry({ tPag: TPAG.DINHEIRO, indPag: '0', vPag: sumValues(payments.cash) });
  }
  if (Array.isArray(payments.cheque)) {
    addEntry({ tPag: TPAG.CHEQUE, indPag: '0', vPag: sumValues(payments.cheque) });
  }
  if (Array.isArray(payments.pix)) {
    addEntry({ tPag: TPAG.PIX_DINAMICO, indPag: '0', vPag: sumValues(payments.pix) });
  }
  if (Array.isArray(payments.card)) {
    payments.card.forEach((entry) => {
      const tPag = resolveCardTpag(entry?.method || '');
      const indPag = resolveIndPag({ tPag, label: entry?.method });
      addEntry({ tPag, indPag, vPag: entry?.value, label: entry?.method });
    });
  }
  if (Array.isArray(payments.other)) {
    payments.other.forEach((entry) => {
      const tPag = resolveOtherTpag(entry?.method || '');
      const indPag = resolveIndPag({ tPag, label: entry?.method });
      addEntry({ tPag, indPag, vPag: entry?.value, label: entry?.method });
    });
  }
  if (duplicatesTotal > 0) {
    addEntry({ tPag: TPAG.CARTAO_LOJA, indPag: '1', vPag: duplicatesTotal, label: 'Crediario' });
  }

  const entries = Array.from(aggregate.values());
  if (!entries.length) {
    entries.push({ tPag: TPAG.SEM_PAGAMENTO, indPag: '0', vPag: 0, label: 'Sem pagamento' });
  }
  return entries;
};

const buildPaymentSummaryFromDraft = (draft) => {
  const payload = draft?.payload || {};
  const totals = payload?.totals || {};
  const payments = payload?.payments || {};
  const duplicatesSource = Array.isArray(draft?.duplicates)
    ? draft.duplicates
    : Array.isArray(payload?.duplicates)
      ? payload.duplicates
      : [];
  const validDuplicates = duplicatesSource
    .map((duplicate) => ({
      dueDate:
        duplicate?.manualDueDate || duplicate?.dueDate || duplicate?.originalDueDate || '',
      value: toNumber(duplicate?.manualValue ?? duplicate?.value ?? duplicate?.originalValue ?? 0),
    }))
    .filter((duplicate) => parseDateInput(duplicate.dueDate) && (duplicate.value || 0) > 0);
  const duplicatesTotal = validDuplicates.reduce((sum, duplicate) => sum + (duplicate.value || 0), 0);
  const paymentEntries = buildPaymentEntries({ payments, duplicatesTotal });
  return {
    totalNf: toNumber(totals.totalValue) ?? 0,
    totalParcelas: duplicatesTotal,
    quantidadeParcelas: validDuplicates.length,
    pagamentos: paymentEntries.map((entry) => ({
      tPag: entry.tPag,
      indPag: entry.indPag,
      vPag: toDecimal(entry.vPag, 2),
    })),
  };
};
const digitsOnly = (value) => cleanString(value).replace(/\D+/g, '');
const normalizeIe = (value) => cleanString(value).toUpperCase();
const isIsentoIeValue = (value) => normalizeIe(value) === 'ISENTO';
const coerceBoolean = (value) =>
  value === true || value === 'true' || value === 'on' || value === 1 || value === '1';

const resolveIndIeDest = ({ docDigits, ieValue, isentoIE }) => {
  if (docDigits.length === 11) return '9';
  if (docDigits.length === 14) {
    if (isentoIE || isIsentoIeValue(ieValue)) return '2';
    if (ieValue) return '1';
    return '9';
  }
  return '9';
};

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.');
    const numeric = Number.parseFloat(normalized);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const clonePlain = (value) => {
  if (value === null || typeof value === 'undefined') return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
};

const parseDateInput = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.length === 10 ? `${raw}T00:00:00` : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const appendDraftLog = (draft, message) => {
  if (!draft) return null;
  const text = cleanString(message);
  if (!text) return null;
  draft.metadata = draft.metadata || {};
  const logs = Array.isArray(draft.metadata.logs) ? draft.metadata.logs : [];
  const entry = { at: new Date().toISOString(), message: text };
  logs.push(entry);
  if (logs.length > 50) {
    logs.splice(0, logs.length - 50);
  }
  draft.metadata.logs = logs;
  draft.metadata.lastStatus = text;
  draft.metadata.lastStatusAt = entry.at;
  draft.markModified('metadata');
  return entry;
};

const UF_CODE_MAP = {
  RO: '11',
  AC: '12',
  AM: '13',
  RR: '14',
  PA: '15',
  AP: '16',
  TO: '17',
  MA: '21',
  PI: '22',
  CE: '23',
  RN: '24',
  PB: '25',
  PE: '26',
  AL: '27',
  SE: '28',
  BA: '29',
  MG: '31',
  ES: '32',
  RJ: '33',
  SP: '35',
  PR: '41',
  SC: '42',
  RS: '43',
  MS: '50',
  MT: '51',
  GO: '52',
  DF: '53',
};

const toDecimal = (value, digits = 2) => {
  const numeric = toNumber(value);
  const normalized = Number.isFinite(numeric) ? numeric : 0;
  return normalized.toFixed(digits);
};

const padNumber = (value, size) => {
  const digits = digitsOnly(value);
  return digits.padStart(size, '0');
};

const randomNumeric = (size) => {
  let result = '';
  for (let i = 0; i < size; i += 1) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
};

const computeCheckDigit = (accessKey) => {
  const digits = String(accessKey || '').replace(/\D+/g, '');
  const weights = [2, 3, 4, 5, 6, 7, 8, 9];
  let sum = 0;
  let weightIndex = 0;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weights[weightIndex];
    weightIndex = (weightIndex + 1) % weights.length;
  }
  const mod = sum % 11;
  const dv = mod === 0 || mod === 1 ? 0 : 11 - mod;
  return String(dv);
};

const formatDateTimeWithOffset = (date = new Date()) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  const iso = adjusted.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const offsetHours = Math.abs(Math.round(date.getTimezoneOffset() / 60));
  const offsetSign = date.getTimezoneOffset() <= 0 ? '+' : '-';
  const offset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:00`;
  return iso.replace('Z', offset);
};

const sanitize = (value) => cleanString(value).replace(/[<>&]/g, '');

const isValidGtin = (value) => {
  const digits = digitsOnly(value);
  if (!digits) return false;
  return ['8', '12', '13', '14'].includes(String(digits.length));
};

const buildNfeXml = ({ draft, store, serie, environment }) => {
  const payload = draft?.payload || {};
  const header = payload.header || {};
  const supplier = payload.supplier || {};
  const totals = payload.totals || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const payments = payload.payments || {};
  const duplicatesSource = Array.isArray(draft?.duplicates)
    ? draft.duplicates
    : Array.isArray(payload.duplicates)
      ? payload.duplicates
      : [];
  const duplicates = duplicatesSource
    .map((duplicate, index) => {
      if (!duplicate || typeof duplicate !== 'object') return null;
      const number = String(index + 1);
      const dueCandidate =
        duplicate.manualDueDate || duplicate.dueDate || duplicate.originalDueDate || '';
      const dueDate = cleanString(dueCandidate);
      const valueRaw =
        duplicate.manualValue ?? duplicate.value ?? duplicate.originalValue ?? 0;
      const value = toNumber(valueRaw) ?? 0;
      return { number, dueDate, value };
    })
    .filter(Boolean);
  const operation = cleanString(header.type).toLowerCase() === 'entrada' ? '0' : '1';
  const tpAmb = environment === 'producao' ? '1' : '2';
  const ufCode = digitsOnly(store?.codigoUf) || UF_CODE_MAP[String(store?.uf || '').toUpperCase()] || '35';
  const serieNumber = digitsOnly(serie?.serie || header.serie || '1');
  const numeroFiscal = digitsOnly(header.number || '1');
  const cnf = randomNumeric(8);
  const cnpjDigits = padNumber(store?.cnpj, 14);
  const issueDateValue = cleanString(header.issueDate);
  const now = new Date();
  const nowTime = now.toTimeString().slice(0, 8);
  const issueDate = issueDateValue
    ? `${issueDateValue}T${issueDateValue.length === 10 ? nowTime : issueDateValue.split('T')[1] || nowTime}`
    : now;
  const emissionIso = formatDateTimeWithOffset(issueDate instanceof Date ? issueDate : new Date(issueDate)).replace(
    /\.\d{3}(?=[+-]\d{2}:\d{2}$)/,
    ''
  );
  const yearMonth = emissionIso.slice(2, 7).replace('-', '');
  const tpEmis = '1';
  const model = '55';
  const baseAccessKey = `${ufCode}${yearMonth}${cnpjDigits}${model}${padNumber(serieNumber, 3)}${padNumber(
    numeroFiscal,
    9
  )}${tpEmis}${cnf}`;
  const cDV = computeCheckDigit(baseAccessKey);
  const accessKey = `${baseAccessKey}${cDV}`;
  const natOp =
    sanitize(payload?.metadata?.naturezaOperacao) ||
    sanitize(payload?.metadata?.natureza) ||
    'VENDA DE MERCADORIA';

  const emitName = sanitize(store?.razaoSocial || store?.nome || '');
  const emitFantasia = sanitize(store?.nomeFantasia || store?.nome || '');
  const emitIe = sanitize(store?.inscricaoEstadual || '');
  const emitCrt = store?.regimeTributario === 'simples' ? '1' : store?.regimeTributario === 'mei' ? '1' : '3';
  const emitAddress = {
    xLgr: sanitize(store?.logradouro || store?.endereco || ''),
    nro: digitsOnly(store?.numero || '') || 'S/N',
    xBairro: sanitize(store?.bairro || ''),
    cMun: digitsOnly(store?.codigoIbgeMunicipio || ''),
    xMun: sanitize(store?.municipio || ''),
    UF: sanitize(store?.uf || '').toUpperCase(),
    CEP: digitsOnly(store?.cep || ''),
    xPais: 'Brasil',
    cPais: '1058',
    fone: digitsOnly(store?.telefone || ''),
    xCpl: sanitize(store?.complemento || ''),
  };

  const destDoc = digitsOnly(supplier?.document || '');
  const destIsCpf = destDoc.length === 11;
  const destUf = sanitize(supplier?.state || store?.uf || '').toUpperCase();
  const idDest = destUf && emitAddress.UF && destUf !== emitAddress.UF ? '2' : '1';
  let destIe = cleanString(supplier?.stateRegistration || '');
  const destIsentoIe = coerceBoolean(supplier?.isentoIE) || isIsentoIeValue(destIe);
  const indIeDest = resolveIndIeDest({ docDigits: destDoc, ieValue: destIe, isentoIE: destIsentoIe });

  if (destDoc.length === 14 && indIeDest === '1' && !destIe) {
    throw new Error('Inscrição estadual obrigatória para contribuinte ICMS.');
  }
  if (indIeDest !== '1') {
    destIe = '';
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<NFe xmlns="http://www.portalfiscal.inf.br/nfe">');
  lines.push(`  <infNFe Id="NFe${accessKey}" versao="4.00">`);
  lines.push('    <ide>');
  lines.push(`      <cUF>${ufCode}</cUF>`);
  lines.push(`      <cNF>${cnf}</cNF>`);
  lines.push(`      <natOp>${natOp}</natOp>`);
  lines.push(`      <mod>${model}</mod>`);
  lines.push(`      <serie>${Number(serieNumber)}</serie>`);
  lines.push(`      <nNF>${Number(numeroFiscal)}</nNF>`);
  lines.push(`      <dhEmi>${emissionIso}</dhEmi>`);
  lines.push(`      <tpNF>${operation}</tpNF>`);
  lines.push(`      <idDest>${idDest}</idDest>`);
  lines.push(`      <cMunFG>${emitAddress.cMun}</cMunFG>`);
  lines.push('      <tpImp>1</tpImp>');
  lines.push(`      <tpEmis>${tpEmis}</tpEmis>`);
  lines.push(`      <cDV>${cDV}</cDV>`);
  lines.push(`      <tpAmb>${tpAmb}</tpAmb>`);
  lines.push('      <finNFe>1</finNFe>');
  lines.push('      <indFinal>1</indFinal>');
  lines.push('      <indPres>1</indPres>');
  lines.push('      <procEmi>0</procEmi>');
  lines.push('      <verProc>1.0</verProc>');
  lines.push('    </ide>');
  lines.push('    <emit>');
  lines.push(`      <CNPJ>${cnpjDigits}</CNPJ>`);
  lines.push(`      <xNome>${emitName}</xNome>`);
  lines.push(`      <xFant>${emitFantasia}</xFant>`);
  lines.push('      <enderEmit>');
  lines.push(`        <xLgr>${emitAddress.xLgr}</xLgr>`);
  lines.push(`        <nro>${emitAddress.nro}</nro>`);
  if (emitAddress.xCpl) lines.push(`        <xCpl>${emitAddress.xCpl}</xCpl>`);
  lines.push(`        <xBairro>${emitAddress.xBairro}</xBairro>`);
  lines.push(`        <cMun>${emitAddress.cMun}</cMun>`);
  lines.push(`        <xMun>${emitAddress.xMun}</xMun>`);
  lines.push(`        <UF>${emitAddress.UF}</UF>`);
  lines.push(`        <CEP>${emitAddress.CEP}</CEP>`);
  lines.push(`        <cPais>${emitAddress.cPais}</cPais>`);
  lines.push(`        <xPais>${emitAddress.xPais}</xPais>`);
  if (emitAddress.fone) lines.push(`        <fone>${emitAddress.fone}</fone>`);
  lines.push('      </enderEmit>');
  if (emitIe) lines.push(`      <IE>${emitIe}</IE>`);
  lines.push(`      <CRT>${emitCrt}</CRT>`);
  lines.push('    </emit>');
  lines.push('    <dest>');
  if (destIsCpf) {
    lines.push(`      <CPF>${destDoc}</CPF>`);
  } else if (destDoc) {
    lines.push(`      <CNPJ>${destDoc}</CNPJ>`);
  }
  const homologDestinationName =
    'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  const destinationName =
    tpAmb === '2' ? homologDestinationName : sanitize(supplier?.name || '') || 'CONSUMIDOR';
  lines.push(`      <xNome>${destinationName}</xNome>`);

  const destAddress = {
    xLgr: sanitize(supplier?.address || '') || 'NAO INFORMADO',
    nro: digitsOnly(supplier?.number || '') || 'S/N',
    xCpl: sanitize(supplier?.complement || ''),
    xBairro: sanitize(supplier?.neighborhood || '') || 'CENTRO',
    cMun: digitsOnly(supplier?.cityCode || store?.codigoIbgeMunicipio || '') || '0000000',
    xMun: sanitize(supplier?.city || store?.municipio || '') || 'NAO INFORMADO',
    UF: destUf || sanitize(store?.uf || '').toUpperCase() || 'RJ',
    CEP: digitsOnly(supplier?.zip || store?.cep || '') || '00000000',
  };

  const hasDestAddress = Boolean(
    destAddress.xLgr &&
      destAddress.nro &&
      destAddress.xBairro &&
      destAddress.cMun &&
      destAddress.xMun &&
      destAddress.UF &&
      destAddress.CEP
  );

  if (hasDestAddress) {
    lines.push('      <enderDest>');
    lines.push(`        <xLgr>${destAddress.xLgr}</xLgr>`);
    lines.push(`        <nro>${destAddress.nro}</nro>`);
    if (destAddress.xCpl) lines.push(`        <xCpl>${destAddress.xCpl}</xCpl>`);
    lines.push(`        <xBairro>${destAddress.xBairro}</xBairro>`);
    lines.push(`        <cMun>${destAddress.cMun}</cMun>`);
    lines.push(`        <xMun>${destAddress.xMun}</xMun>`);
    lines.push(`        <UF>${destAddress.UF}</UF>`);
    lines.push(`        <CEP>${destAddress.CEP}</CEP>`);
    lines.push('        <cPais>1058</cPais>');
    lines.push('        <xPais>Brasil</xPais>');
    if (supplier?.phone) lines.push(`        <fone>${digitsOnly(supplier?.phone || '')}</fone>`);
    lines.push('      </enderDest>');
  }
  lines.push(`      <indIEDest>${indIeDest}</indIEDest>`);
  if (destIe) lines.push(`      <IE>${sanitize(destIe)}</IE>`);
  if (supplier?.email) lines.push(`      <email>${sanitize(supplier?.email)}</email>`);
  lines.push('    </dest>');

  items.forEach((item, index) => {
    const nItem = index + 1;
    const qComRaw = toNumber(item.qty ?? item.qtyTrib ?? 0) ?? 0;
    const vUnComRaw = toNumber(item.unit ?? item.unitTrib ?? 0) ?? 0;
    const qCom = toDecimal(qComRaw, 4);
    const vUnCom = toDecimal(vUnComRaw, 3);
    const qTribRaw = toNumber(item.qtyTrib ?? item.qty ?? 0) ?? 0;
    const vUnTribRaw = toNumber(item.unitTrib ?? item.unit ?? 0) ?? 0;
    const qTrib = toDecimal(qTribRaw, 4);
    const vUnTrib = toDecimal(vUnTribRaw, 3);
    const vProdComCalc = Math.round(qComRaw * vUnComRaw * 100) / 100;
    const vProdTribCalc = Math.round(qTribRaw * vUnTribRaw * 100) / 100;
    let vProdResolved = toNumber(item.total) ?? 0;
    if (Number.isFinite(vProdComCalc)) {
      vProdResolved = vProdComCalc;
    }
    if (Number.isFinite(vProdTribCalc) && vProdResolved !== vProdTribCalc) {
      vProdResolved = vProdTribCalc;
    }
    const vProd = toDecimal(vProdResolved, 2);
    const uCom = sanitize(item.unidadeComercial || 'UN');
    const uTrib = sanitize(item.unidadeTributavel || uCom);
    const cst = digitsOnly(item.cst || '') || '00';
    const isSimples = emitCrt === '1' || emitCrt === '4';
    const csosn = isSimples ? (String(cst).length === 3 ? String(cst) : '102') : null;
    lines.push(`    <det nItem="${nItem}">`);
    lines.push('      <prod>');
    lines.push(`        <cProd>${sanitize(item.code || '')}</cProd>`);
    const semGtin = Boolean(item.semGtin);
    const rawBarcode = item.codigoBarras || '';
    const gtinValue = !semGtin && isValidGtin(rawBarcode) ? digitsOnly(rawBarcode) : 'SEM GTIN';
    lines.push(`        <cEAN>${gtinValue}</cEAN>`);
    lines.push(`        <xProd>${sanitize(item.name || '')}</xProd>`);
    lines.push(`        <NCM>${digitsOnly(item.ncm || '')}</NCM>`);
    if (item.cest) lines.push(`        <CEST>${digitsOnly(item.cest || '')}</CEST>`);
    lines.push(`        <CFOP>${digitsOnly(item.cfop || '')}</CFOP>`);
    lines.push(`        <uCom>${uCom}</uCom>`);
    lines.push(`        <qCom>${qCom}</qCom>`);
    lines.push(`        <vUnCom>${vUnCom}</vUnCom>`);
    lines.push(`        <vProd>${vProd}</vProd>`);
    lines.push(`        <cEANTrib>${gtinValue}</cEANTrib>`);
    lines.push(`        <uTrib>${uTrib}</uTrib>`);
    lines.push(`        <qTrib>${qTrib}</qTrib>`);
    lines.push(`        <vUnTrib>${vUnTrib}</vUnTrib>`);
    lines.push('        <indTot>1</indTot>');
    lines.push('      </prod>');
    lines.push('      <imposto>');
    lines.push('        <ICMS>');
    if (isSimples) {
      lines.push(`          <ICMSSN${csosn}>`);
      lines.push('            <orig>0</orig>');
      lines.push(`            <CSOSN>${csosn}</CSOSN>`);
      lines.push(`          </ICMSSN${csosn}>`);
    } else if (String(cst).length === 3) {
      lines.push(`          <ICMSSN${cst}>`);
      lines.push('            <orig>0</orig>');
      lines.push(`            <CSOSN>${cst}</CSOSN>`);
      lines.push(`          </ICMSSN${cst}>`);
    } else {
      lines.push('          <ICMS00>');
      lines.push('            <orig>0</orig>');
      lines.push(`            <CST>${cst.padStart(2, '0')}</CST>`);
      lines.push('            <modBC>3</modBC>');
      lines.push(`            <vBC>${toDecimal(item.baseIcms || 0, 2)}</vBC>`);
      lines.push(`            <pICMS>${toDecimal(item.icms || 0, 2)}</pICMS>`);
      lines.push(`            <vICMS>${toDecimal(item.valorIcms || 0, 2)}</vICMS>`);
      lines.push('          </ICMS00>');
    }
    lines.push('        </ICMS>');
    lines.push('        <PIS>');
    const pisCst = digitsOnly(item.stPis || '') || '07';
    if (pisCst === '01') {
      lines.push('          <PISAliq>');
      lines.push(`            <CST>${pisCst}</CST>`);
      lines.push(`            <vBC>${toDecimal(item.basePis || 0, 2)}</vBC>`);
      lines.push(`            <pPIS>${toDecimal(item.pis || 0, 2)}</pPIS>`);
      lines.push(`            <vPIS>${toDecimal(item.valorPis || 0, 2)}</vPIS>`);
      lines.push('          </PISAliq>');
    } else {
      lines.push('          <PISNT>');
      lines.push(`            <CST>${pisCst}</CST>`);
      lines.push('          </PISNT>');
    }
    lines.push('        </PIS>');
    lines.push('        <COFINS>');
    const cofinsCst = digitsOnly(item.stCofins || '') || '07';
    if (cofinsCst === '01') {
      lines.push('          <COFINSAliq>');
      lines.push(`            <CST>${cofinsCst}</CST>`);
      lines.push(`            <vBC>${toDecimal(item.baseCofins || 0, 2)}</vBC>`);
      lines.push(`            <pCOFINS>${toDecimal(item.cofins || 0, 2)}</pCOFINS>`);
      lines.push(`            <vCOFINS>${toDecimal(item.valorCofins || 0, 2)}</vCOFINS>`);
      lines.push('          </COFINSAliq>');
    } else {
      lines.push('          <COFINSNT>');
      lines.push(`            <CST>${cofinsCst}</CST>`);
      lines.push('          </COFINSNT>');
    }
    lines.push('        </COFINS>');
    lines.push('      </imposto>');
    lines.push('    </det>');
  });

  const isSimplesEmitter = emitCrt === '1' || emitCrt === '4';
  const itemsIcmsBase = items.reduce((sum, item) => {
    const value = toNumber(item.baseIcms);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const itemsIcmsValue = items.reduce((sum, item) => {
    const value = toNumber(item.valorIcms);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const itemsTotalProducts = items.reduce((sum, item) => {
    const qComValue = toNumber(item.qty) ?? 0;
    const vUnComValue = toNumber(item.unit) ?? 0;
    const qTribValue = toNumber(item.qtyTrib) ?? qComValue;
    const vUnTribValue = toNumber(item.unitTrib) ?? vUnComValue;
    const calcCom = Math.round(qComValue * vUnComValue * 100) / 100;
    const calcTrib = Math.round(qTribValue * vUnTribValue * 100) / 100;
    let resolved = toNumber(item.total) ?? 0;
    if (Number.isFinite(calcCom)) {
      resolved = calcCom;
    }
    if (Number.isFinite(calcTrib) && resolved !== calcTrib) {
      resolved = calcTrib;
    }
    const rounded = Math.round(resolved * 100) / 100;
    return Number.isFinite(rounded) ? sum + rounded : sum;
  }, 0);

  lines.push('    <total>');
  lines.push('      <ICMSTot>');
  lines.push(`        <vBC>${toDecimal(isSimplesEmitter ? 0 : itemsIcmsBase, 2)}</vBC>`);
  lines.push(`        <vICMS>${toDecimal(isSimplesEmitter ? 0 : itemsIcmsValue, 2)}</vICMS>`);
  lines.push('        <vICMSDeson>0.00</vICMSDeson>');
  lines.push(`        <vFCP>${toDecimal(totals.fcpSt || 0, 2)}</vFCP>`);
  lines.push('        <vBCST>0.00</vBCST>');
  lines.push('        <vST>0.00</vST>');
  lines.push('        <vFCPST>0.00</vFCPST>');
  lines.push('        <vFCPSTRet>0.00</vFCPSTRet>');
  lines.push(`        <vProd>${toDecimal(itemsTotalProducts, 2)}</vProd>`);
  lines.push(`        <vFrete>${toDecimal(totals.freight || 0, 2)}</vFrete>`);
  lines.push('        <vSeg>0.00</vSeg>');
  lines.push(`        <vDesc>${toDecimal(totals.discount || 0, 2)}</vDesc>`);
  lines.push('        <vII>0.00</vII>');
  lines.push(`        <vIPI>${toDecimal(totals.ipi || 0, 2)}</vIPI>`);
  lines.push('        <vIPIDevol>0.00</vIPIDevol>');
  lines.push(`        <vPIS>${toDecimal(totals.pis || 0, 2)}</vPIS>`);
  lines.push(`        <vCOFINS>${toDecimal(totals.cofins || 0, 2)}</vCOFINS>`);
  lines.push(`        <vOutro>${toDecimal(totals.other || 0, 2)}</vOutro>`);
  const freightTotal = toNumber(totals.freight) || 0;
  const otherTotal = toNumber(totals.other) || 0;
  const discountTotal = toNumber(totals.discount) || 0;
  const insuranceTotal = toNumber(totals.insurance) || 0;
  const ipiTotal = toNumber(totals.ipi) || 0;
  const vNfTotal = itemsTotalProducts + freightTotal + otherTotal + insuranceTotal + ipiTotal - discountTotal;
  lines.push(`        <vNF>${toDecimal(vNfTotal, 2)}</vNF>`);
  lines.push('      </ICMSTot>');
  lines.push('    </total>');
  lines.push('    <transp>');
  lines.push(`      <modFrete>${sanitize(payload?.transport?.mode || '9') || '9'}</modFrete>`);
  lines.push('    </transp>');
  const validDuplicates = duplicates.filter((duplicate) => {
    const dueDate = parseDateInput(duplicate.dueDate);
    const hasDate = Boolean(dueDate);
    const value = toNumber(duplicate.value) ?? 0;
    return hasDate && Number.isFinite(value) && value > 0;
  });
  const duplicatesTotal = validDuplicates.reduce((sum, duplicate) => {
    const value = toNumber(duplicate.value) ?? 0;
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  const paymentEntries = buildPaymentEntries({
    payments,
    duplicatesTotal,
  });
  const hasCobr = validDuplicates.length > 0;
  validatePagCobrConsistency({ hasCobr, paymentEntries });

  if (validDuplicates.length) {
    const faturaNumber = sanitize(header.number || '');
    const parcelasTotalCents = sumParcelas(validDuplicates);
    const vLiqCents = toCents(duplicatesTotal || vNfTotal);
    if (Math.abs(parcelasTotalCents - vLiqCents) > 1) {
      throw new Error('Soma das parcelas (vDup) divergente do valor líquido (vLiq).');
    }
    lines.push('    <cobr>');
    lines.push('      <fat>');
    if (faturaNumber) lines.push(`        <nFat>${faturaNumber}</nFat>`);
    lines.push(`        <vOrig>${toDecimal(vNfTotal, 2)}</vOrig>`);
    lines.push(`        <vDesc>${toDecimal(totals.discount || 0, 2)}</vDesc>`);
    lines.push(`        <vLiq>${toDecimal(duplicatesTotal || vNfTotal, 2)}</vLiq>`);
    lines.push('      </fat>');
    validDuplicates.forEach((duplicate, index) => {
      const dueDate = parseDateInput(duplicate.dueDate);
      const dueDateLabel = dueDate
        ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 10)
        : cleanString(duplicate.dueDate);
      const dupValue = toNumber(duplicate.value) ?? 0;
      const dupNumber = formatNDup(index + 1);
      if (!dueDateLabel || !Number.isFinite(dupValue) || dupValue <= 0) return;
      if (!/^\d{3}$/.test(dupNumber)) {
        throw new Error(`Numero da parcela invalido: ${dupNumber}`);
      }
      lines.push('      <dup>');
      lines.push(`        <nDup>${sanitize(dupNumber)}</nDup>`);
      lines.push(`        <dVenc>${dueDateLabel}</dVenc>`);
      lines.push(`        <vDup>${toDecimal(dupValue, 2)}</vDup>`);
      lines.push('      </dup>');
    });
    lines.push('    </cobr>');
  }
  lines.push('    <pag>');
  paymentEntries.forEach((entry) => {
    lines.push('      <detPag>');
    lines.push(`        <indPag>${entry.indPag}</indPag>`);
    lines.push(`        <tPag>${entry.tPag}</tPag>`);
    lines.push(`        <vPag>${toDecimal(entry.vPag, 2)}</vPag>`);
    lines.push('      </detPag>');
  });
  const totalPayment = paymentEntries.reduce((sum, entry) => sum + (toNumber(entry.vPag) || 0), 0);
  const changeValue = Math.max(0, totalPayment - vNfTotal);
  if (changeValue > 0) {
    lines.push(`      <vTroco>${toDecimal(changeValue, 2)}</vTroco>`);
  }
  lines.push('    </pag>');
  if (payload?.additionalInfo?.observation) {
    lines.push('    <infAdic>');
    lines.push(`      <infCpl>${sanitize(payload.additionalInfo.observation)}</infCpl>`);
    lines.push('    </infAdic>');
  }
  lines.push('  </infNFe>');
  lines.push('</NFe>');

  return {
    xml: lines.join('\n'),
    accessKey,
    tpAmb,
    paymentSummary: {
      totalNf: toNumber(vNfTotal) ?? 0,
      totalParcelas: toNumber(duplicatesTotal) ?? 0,
      quantidadeParcelas: validDuplicates.length,
      pagamentos: paymentEntries.map((entry) => ({
        tPag: entry.tPag,
        indPag: entry.indPag,
        vPag: toDecimal(entry.vPag, 2),
      })),
    },
  };
};

const getCertificatePair = (store) => {
  if (!store?.certificadoArquivoCriptografado || !store?.certificadoSenhaCriptografada) {
    throw new Error('A empresa não possui certificado digital configurado.');
  }

  const validityDate = parseDateInput(store.certificadoValidade);
  if (validityDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (validityDate < today) {
      throw new Error('O certificado digital da empresa está vencido.');
    }
  }

  let certificateBuffer;
  try {
    certificateBuffer = decryptBuffer(store.certificadoArquivoCriptografado);
  } catch (error) {
    throw new Error('Não foi possível descriptografar o certificado digital configurado.');
  }

  let certificatePassword;
  try {
    certificatePassword = decryptText(store.certificadoSenhaCriptografada);
  } catch (error) {
    throw new Error('Não foi possível recuperar a senha do certificado digital.');
  }

  if (!certificatePassword) {
    throw new Error('Senha do certificado digital está vazia após descriptografia.');
  }

  try {
    return extractCertificatePair(certificateBuffer, certificatePassword);
  } catch (error) {
    throw new Error(
      `Não foi possível extrair chave privada e certificado do arquivo PFX: ${error.message}`
    );
  }
};

const signNfeXml = ({ xml, certificatePem, privateKeyPem }) => {
  if (!xml) {
    throw new Error('XML vazio para assinatura.');
  }
  const cleanedXml = sanitizeXmlContent(xml).replace(
    /<(?:ds:)?Signature[\s\S]*?<\/(?:ds:)?Signature>/g,
    ''
  );
  const xmlForSignature = sanitizeXmlContent(cleanedXml);
  const xmlDocument = new DOMParser().parseFromString(xmlForSignature, 'text/xml');
  const [infNfeNode] = xpath.select("/*[local-name()='NFe']/*[local-name()='infNFe']", xmlDocument);
  if (!infNfeNode) {
    throw new Error('Estrutura NF-e inválida: nó <infNFe> ausente.');
  }
  const infId = infNfeNode.getAttribute('Id');
  if (!infId) {
    throw new Error('Estrutura NF-e inválida: atributo Id ausente em <infNFe>.');
  }

  const keyPemString = Buffer.isBuffer(privateKeyPem)
    ? privateKeyPem.toString('utf8')
    : String(privateKeyPem || '');

  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(keyPemString)) {
    throw new Error('Chave privada inválida/ausente.');
  }

  const certB64 = String(certificatePem || '')
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');

  const signer = new SignedXml({
    privateKey: Buffer.from(keyPemString),
    idAttribute: 'Id',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  signer.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`,
  };
  const refXPath = "/*[local-name()='NFe']/*[local-name()='infNFe']";
  signer.addReference({
    xpath: refXPath,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  signer.computeSignature(xmlForSignature, {
    prefix: '',
    location: {
      reference: refXPath,
      action: 'after',
    },
  });

  let signedXmlContent = signer.getSignedXml();
  const digestValue = signer.references?.[0]?.digestValue || '';
  const signatureValue = signer.signatureValue || '';

  const hasKeyInfo = /<KeyInfo\b/.test(signedXmlContent);
  if (!hasKeyInfo) {
    const signatureValueClose = '</SignatureValue>';
    const signatureValueIndex = signedXmlContent.indexOf(signatureValueClose);
    if (signatureValueIndex === -1) {
      throw new Error('Assinatura NF-e inválida: bloco <SignatureValue> ausente.');
    }
    const insertPosition = signatureValueIndex + signatureValueClose.length;
    const keyInfoXml =
      '<KeyInfo><X509Data><X509Certificate>' +
      certB64 +
      '</X509Certificate></X509Data></KeyInfo>';
    signedXmlContent =
      signedXmlContent.slice(0, insertPosition) +
      keyInfoXml +
      signedXmlContent.slice(insertPosition);
  }

  const signedXml = signedXmlContent.startsWith('<?xml')
    ? signedXmlContent
    : `<?xml version="1.0" encoding="UTF-8"?>\n${signedXmlContent}`;

  return {
    xml: sanitizeXmlContent(signedXml),
    digestValue,
    signatureValue,
  };
};

const resolveDateSegments = (referenceDate) => {
  const date =
    referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : new Date();
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  };
};

const buildNfeR2Key = ({ store, environment, serie, emissionDate, accessKey }) => {
  const companySegment = sanitizeSegment(store?.nomeFantasia || store?.nome || store?.razaoSocial || 'Empresa', 'Empresa');
  const envSegment = sanitizeSegment(environment === 'producao' ? 'Producao' : 'Homologacao', 'Ambiente');
  const serieSegment = sanitizeSegment(serie?.serie || serie?.codigo || 'Serie', 'Serie');
  const { year, month, day } = resolveDateSegments(emissionDate);
  const fileName = `${accessKey}.xml`;
  return ['NFe', companySegment, envSegment, serieSegment, year, month, day, fileName].join('/');
};

const sanitizeDuplicate = (duplicate = {}) => ({
  number: cleanString(duplicate.number),
  dueDate: cleanString(duplicate.dueDate),
  manualDueDate: cleanString(duplicate.manualDueDate),
  originalDueDate: cleanString(duplicate.originalDueDate),
  value: toNumber(duplicate.value),
  manualValue: toNumber(duplicate.manualValue),
  originalValue: toNumber(duplicate.originalValue),
  paymentMethod: cleanString(duplicate.paymentMethod),
  paymentDescription: cleanString(duplicate.paymentDescription),
  paymentType: cleanString(duplicate.paymentType),
  termDays: toNumber(duplicate.termDays),
  bankAccount: cleanString(duplicate.bankAccount),
  bankAccountIsManual: Boolean(duplicate.bankAccountIsManual),
  accountingAccountId: cleanString(duplicate.accountingAccountId),
  accountingAccountCode: cleanString(duplicate.accountingAccountCode),
  accountingAccountName: cleanString(duplicate.accountingAccountName),
});

const computeDuplicatesSummary = (duplicates) => {
  if (!Array.isArray(duplicates) || !duplicates.length) {
    return { totalAmount: 0, count: 0 };
  }

  const totalAmount = duplicates.reduce((sum, duplicate) => {
    const numeric = toNumber(duplicate.value);
    return Number.isFinite(numeric) ? sum + numeric : sum;
  }, 0);

  return { totalAmount, count: duplicates.length };
};

const buildDraftDocumentFromPayload = (payload = {}) => {
  const header = payload.header || {};
  const totals = payload.totals || {};
  const supplier = payload.supplier || {};
  const selection = payload.selection || {};
  const additional = payload.additionalInfo || {};
  const xml = payload.xml || {};

  const duplicates = Array.isArray(payload.duplicates)
    ? payload.duplicates.map((entry) => sanitizeDuplicate(entry))
    : [];
  const duplicatesSummary = computeDuplicatesSummary(duplicates);

  const totalsRecord = {
    products: toNumber(totals.products) ?? 0,
    icmsBase: toNumber(totals.icmsBase) ?? 0,
    icmsValue: toNumber(totals.icmsValue) ?? 0,
    icmsSt: toNumber(totals.icmsSt) ?? 0,
    fcpSt: toNumber(totals.fcpSt) ?? 0,
    discount: toNumber(totals.discount) ?? 0,
    other: toNumber(totals.other) ?? 0,
    freight: toNumber(totals.freight) ?? 0,
    ipi: toNumber(totals.ipi) ?? 0,
    insurance: toNumber(totals.insurance) ?? 0,
    dollar: toNumber(totals.dollar) ?? 0,
    totalValue:
      toNumber(totals.totalValue) ??
      (duplicatesSummary.totalAmount > 0
        ? duplicatesSummary.totalAmount
        : toNumber(totals.products) ?? 0),
  };

  const headerRecord = {
    code: cleanString(header.code),
    number: cleanString(header.number),
    serie: cleanString(header.serie),
    type: cleanString(header.type),
    model: cleanString(header.model),
    issueDate: cleanString(header.issueDate),
    entryDate: cleanString(header.entryDate),
  };

  const selectionRecord = {
    companyId: cleanString(selection.companyId || payload.company?.id || ''),
    supplierId: cleanString(selection.supplierId || supplier.id || ''),
    depositId: cleanString(selection.depositId || ''),
    bankAccountId: cleanString(selection.bankAccountId || ''),
    accountingAccount: cleanString(selection.accountingAccount || ''),
    duplicataEmissionDate: cleanString(selection.duplicataEmissionDate || ''),
  };

  const transport = payload.transport || {};
  const transportRecord = {
    mode: cleanString(transport.mode),
    transporter: clonePlain(transport.transporter) || {},
    vehicle: clonePlain(transport.vehicle) || {},
    volume: clonePlain(transport.volume) || {},
  };

  const xmlRecord = {
    accessKey: cleanString(xml.accessKey || payload.accessKey),
    importAccessKey: cleanString(xml.importAccessKey),
    ambient: cleanString(xml.ambient),
  };

  const additionalInfo = {
    observation: cleanString(additional.observation),
    complementaryFiscal: cleanString(additional.complementaryFiscal),
    paymentCondition: cleanString(additional.paymentCondition),
    paymentForm: cleanString(additional.paymentForm),
  };

  const payloadClone = clonePlain(payload) || {};

  return {
    header: headerRecord,
    companyId: selectionRecord.companyId,
    supplierId: selectionRecord.supplierId,
    supplierName: cleanString(supplier.name),
    supplierDocument: digitsOnly(supplier.document),
    supplierStateRegistration: cleanString(supplier.stateRegistration),
    supplierEmail: cleanString(supplier.email),
    supplierAddressText: cleanString(supplier.addressText),
    totals: totalsRecord,
    duplicates,
    duplicatesSummary,
    items: clonePlain(payload.items) || [],
    references: clonePlain(payload.references) || [],
    payments: clonePlain(payload.payments) || [],
    additionalInfo,
    selection: selectionRecord,
    transport: transportRecord,
    xml: xmlRecord,
    metadata: clonePlain(payload.metadata) || {},
    importedData: clonePlain(payload.importedData) || {},
    payload: payloadClone,
  };
};

router.get('/', async (req, res) => {
  try {
    const { companyId, status, accessKey } = req.query || {};
    const filter = {};
    if (companyId) {
      filter.companyId = cleanString(companyId);
    }
    if (status) {
      filter.status = cleanString(status);
    }
    if (accessKey) {
      const normalizedAccessKey = digitsOnly(accessKey);
      if (normalizedAccessKey) {
        filter['xml.accessKey'] = normalizedAccessKey;
      }
    }

    const drafts = await NfeEmissionDraft.find(filter)
      .sort({ updatedAt: -1 })
      .select({
        code: 1,
        status: 1,
        companyId: 1,
        supplierName: 1,
        supplierDocument: 1,
        totals: 1,
        header: 1,
        xml: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean();

    const payload = Array.isArray(drafts)
      ? drafts.map((draft) => ({
          id: String(draft._id || ''),
          code: draft.code ?? null,
          status: draft.status || 'draft',
          companyId: draft.companyId || '',
          supplierName: draft.supplierName || '',
          supplierDocument: draft.supplierDocument || '',
          totalValue: draft.totals?.totalValue ?? null,
          headerCode: draft.header?.code || '',
          number: draft.header?.number || '',
          serie: draft.header?.serie || '',
          type: draft.header?.type || '',
          model: draft.header?.model || '',
          issueDate: draft.header?.issueDate || '',
          entryDate: draft.header?.entryDate || '',
          accessKey: draft.xml?.accessKey || '',
          updatedAt: draft.updatedAt || null,
          createdAt: draft.createdAt || null,
        }))
      : [];

    return res.json({ drafts: payload });
  } catch (error) {
    console.error('Erro ao listar rascunhos de NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao consultar os rascunhos de NF-e cadastrados.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const draftData = buildDraftDocumentFromPayload(payload);

    const lastDraft = await NfeEmissionDraft.findOne().sort({ code: -1 }).select('code').lean();
    const lastCode = lastDraft && Number.isFinite(lastDraft.code) ? lastDraft.code : 0;
    const nextCode = lastCode + 1;

    draftData.code = nextCode;
    if (!draftData.header.code) {
      draftData.header.code = String(nextCode).padStart(4, '0');
    }

    const draft = await NfeEmissionDraft.create(draftData);
    const serieId = draftData?.header?.serie || '';
    const companyId = draftData?.companyId || '';
    const emittedNumber = cleanString(draftData?.header?.number || '');
    if (serieId && companyId && emittedNumber) {
      const updateResult = await FiscalSerie.updateOne(
        { _id: serieId, 'parametros.empresa': companyId },
        { $set: { 'parametros.$.ultimaNotaEmitida': emittedNumber } }
      );
      if (!updateResult?.matchedCount) {
        await FiscalSerie.updateOne(
          { _id: serieId },
          { $push: { parametros: { empresa: companyId, ultimaNotaEmitida: emittedNumber } } }
        );
      }
    }
    return res.status(201).json({ draft });
  } catch (error) {
    console.error('Erro ao salvar rascunho de NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao salvar o rascunho da NF-e.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Identificador do rascunho nÃ£o informado.' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: 'Rascunho de NF-e nÃ£o encontrado.' });
    }

    const draft = await NfeEmissionDraft.findById(id).lean();
    if (!draft) {
      return res.status(404).json({ message: 'Rascunho de NF-e nÃ£o encontrado.' });
    }

    draft.id = String(draft._id || id);
    return res.json({ draft });
  } catch (error) {
    console.error('Erro ao consultar rascunho de NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao recuperar os dados do rascunho da NF-e.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Identificador do rascunho nÃ£o informado.' });
    }

    const existingDraft = await NfeEmissionDraft.findById(id);
    if (!existingDraft) {
      return res.status(404).json({ message: 'Rascunho de NF-e nÃ£o encontrado.' });
    }

    const payload = req.body || {};
    const draftData = buildDraftDocumentFromPayload(payload);
    draftData.code = existingDraft.code;
    if (!draftData.header.code) {
      draftData.header.code = existingDraft.header?.code || String(existingDraft.code).padStart(4, '0');
    }
    const existingMetadata = existingDraft.metadata || {};
    const existingLogs = Array.isArray(existingMetadata.logs) ? existingMetadata.logs : [];
    draftData.metadata = { ...existingMetadata, ...(draftData.metadata || {}) };
    draftData.metadata.logs = existingLogs;
    if (existingMetadata.lastStatus && !draftData.metadata.lastStatus) {
      draftData.metadata.lastStatus = existingMetadata.lastStatus;
    }
    if (existingMetadata.lastStatusAt && !draftData.metadata.lastStatusAt) {
      draftData.metadata.lastStatusAt = existingMetadata.lastStatusAt;
    }

    existingDraft.set(draftData);
    const updatedDraft = await existingDraft.save();
    return res.json({ draft: updatedDraft });
  } catch (error) {
    console.error('Erro ao atualizar rascunho de NF-e:', error);
    return res
      .status(500)
      .json({ message: error.message || 'Falha ao atualizar o rascunho da NF-e.' });
  }
});

router.post('/:id/xml', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const draft = await NfeEmissionDraft.findById(id);
    if (!draft) {
      return res.status(404).json({ message: 'Rascunho de NF-e não encontrado.' });
    }

    const companyId = draft.companyId || draft.payload?.company?.id || '';
    if (!companyId) {
      return res.status(400).json({ message: 'Empresa da NF-e não encontrada.' });
    }

    const store = await Store.findById(companyId).lean();
    if (!store) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    const serieId = draft.payload?.header?.serie || '';
    const serie = serieId ? await FiscalSerie.findById(serieId).lean() : null;
    if (!serie) {
      return res.status(400).json({ message: 'Série fiscal não encontrada.' });
    }

    const ambiente = cleanString(serie?.ambiente).toLowerCase() === 'producao' ? 'producao' : 'homologacao';
    const { xml, accessKey, tpAmb } = buildNfeXml({ draft, store, serie, environment: ambiente });

    if (!isR2Configured()) {
      return res.status(500).json({ message: 'Cloudflare R2 nao configurado.' });
    }

    const header = draft?.payload?.header || {};
    const emissionDate = header?.issueDate ? new Date(`${header.issueDate}T00:00:00`) : new Date();
    const r2Key = buildNfeR2Key({
      store,
      environment: ambiente,
      serie,
      emissionDate,
      accessKey,
    });
    const uploadResult = await uploadBufferToR2(Buffer.from(xml, 'utf8'), {
      key: r2Key,
      contentType: 'application/xml',
    });

    draft.xml.accessKey = accessKey;
    draft.xml.ambient = tpAmb;
    draft.metadata = draft.metadata || {};
    draft.metadata.xmlContent = xml;
    draft.metadata.xmlR2Key = uploadResult?.key || r2Key;
    draft.metadata.xmlUrl = uploadResult?.url || buildPublicUrl(r2Key);
    draft.metadata.xmlGeneratedAt = new Date().toISOString();
    appendDraftLog(draft, 'XML Gerado');
    draft.markModified('metadata');
    draft.markModified('xml');
    await draft.save();

    return res.json({ xml, accessKey, environment: ambiente, xmlUrl: draft.metadata.xmlUrl });
  } catch (error) {
    console.error('Erro ao gerar XML da NF-e:', error);
    return res.status(500).json({ message: error.message || 'Falha ao gerar XML da NF-e.' });
  }
});

router.post('/:id/xml/sign', async (req, res) => {
  let draft = null;
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    draft = await NfeEmissionDraft.findById(id);
    if (!draft) {
      return res.status(404).json({ message: 'NF-e não encontrada.' });
    }

    const companyId = draft.companyId || draft.payload?.company?.id || '';
    const store = companyId
      ? await Store.findById(companyId)
          .select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada')
          .lean()
      : null;
    if (!store) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    const serieId = draft?.payload?.header?.serie || '';
    const serie = serieId ? await FiscalSerie.findById(serieId).lean() : null;
    if (!serie) {
      return res.status(404).json({ message: 'Série fiscal não encontrada.' });
    }

    const ambiente = cleanString(serie?.ambiente).toLowerCase() === 'producao' ? 'producao' : 'homologacao';
    const { certificatePem, privateKeyPem } = getCertificatePair(store);

    if (!draft.metadata?.xmlContent) {
      const { xml, accessKey, tpAmb } = buildNfeXml({ draft, store, serie, environment: ambiente });
      draft.xml.accessKey = accessKey;
      draft.xml.ambient = tpAmb;
      draft.metadata.xmlContent = xml;
      draft.metadata.xmlGeneratedAt = new Date().toISOString();
      appendDraftLog(draft, 'XML Gerado');
    }

    const signed = signNfeXml({
      xml: draft.metadata.xmlContent,
      certificatePem,
      privateKeyPem,
    });

    const header = draft?.payload?.header || {};
    const emissionDate = header?.issueDate ? new Date(`${header.issueDate}T00:00:00`) : new Date();
    const accessKey = draft?.xml?.accessKey || '';
    const r2Key = buildNfeR2Key({
      store,
      environment: ambiente,
      serie,
      emissionDate,
      accessKey: accessKey || `NFe-${draft._id}`,
    });

    if (!isR2Configured()) {
      return res.status(500).json({ message: 'Cloudflare R2 nao configurado.' });
    }

    const uploadResult = await uploadBufferToR2(Buffer.from(signed.xml, 'utf8'), {
      key: r2Key,
      contentType: 'application/xml',
    });

    draft.metadata.xmlContent = signed.xml;
    draft.metadata.xmlSignedAt = new Date().toISOString();
    draft.metadata.xmlDigestValue = signed.digestValue;
    draft.metadata.xmlSignatureValue = signed.signatureValue;
    draft.metadata.xmlR2Key = uploadResult?.key || r2Key;
    draft.metadata.xmlUrl = uploadResult?.url || buildPublicUrl(r2Key);
    appendDraftLog(draft, 'XML Assinado');
    draft.markModified('metadata');
    draft.markModified('xml');
    await draft.save();

    return res.json({
      xml: signed.xml,
      accessKey: draft?.xml?.accessKey || '',
      environment: ambiente,
      xmlUrl: draft.metadata.xmlUrl,
    });
  } catch (error) {
    console.error('Erro ao assinar XML da NF-e:', error);
    if (draft) {
      appendDraftLog(draft, `Erro ao assinar XML: ${error.message || 'Falha ao assinar o XML da NF-e.'}`);
      await draft.save().catch(() => null);
    }
    return res.status(500).json({ message: error.message || 'Falha ao assinar o XML da NF-e.' });
  }
});

router.post('/:id/xml/transmit', async (req, res) => {
  let draft = null;
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    draft = await NfeEmissionDraft.findById(id);
    if (!draft) {
      return res.status(404).json({ message: 'NF-e não encontrada.' });
    }

    const companyId = draft.companyId || draft.payload?.company?.id || '';
    const store = companyId
      ? await Store.findById(companyId)
          .select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada')
          .lean()
      : null;
    if (!store) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    const serieId = draft?.payload?.header?.serie || '';
    const serie = serieId ? await FiscalSerie.findById(serieId).lean() : null;
    if (!serie) {
      return res.status(404).json({ message: 'Série fiscal não encontrada.' });
    }

    const ambiente = cleanString(serie?.ambiente).toLowerCase() === 'producao' ? 'producao' : 'homologacao';
    const { certificatePem, certificateChain, privateKeyPem } = getCertificatePair(store);

    const xmlContent = draft?.metadata?.xmlContent || '';
    if (!xmlContent) {
      appendDraftLog(draft, 'Erro ao transmitir: XML não encontrado.');
      await draft.save();
      return res.status(400).json({ message: 'XML não encontrado. Gere e assine antes de transmitir.' });
    }
    if (!/<(?:ds:)?Signature\b/.test(xmlContent)) {
      appendDraftLog(draft, 'Erro ao transmitir: XML não está assinado.');
      await draft.save();
      return res.status(400).json({ message: 'XML não está assinado. Assine antes de transmitir.' });
    }

    const uf = cleanString(store?.uf || '').toUpperCase();
    if (!uf) {
      return res.status(400).json({ message: 'UF da empresa não informada.' });
    }

    const lotId = digitsOnly(`${Date.now()}${Math.floor(Math.random() * 9)}`)
      .slice(-15)
      .padStart(15, '0');

    const paymentSummary = buildPaymentSummaryFromDraft(draft);
    console.info(
      '[NFE] Resumo pagamento/cobranca',
      JSON.stringify({
        totalNf: paymentSummary.totalNf,
        totalParcelas: paymentSummary.totalParcelas,
        quantidadeParcelas: paymentSummary.quantidadeParcelas,
        pagamentos: paymentSummary.pagamentos,
      })
    );

    const transmission = await transmitNfeToSefaz({
      xml: xmlContent,
      uf,
      environment: ambiente,
      certificate: certificatePem,
      certificateChain,
      privateKey: privateKeyPem,
      lotId,
    });

    draft.metadata.sefazStatus = transmission.status || '';
    draft.metadata.sefazMessage = transmission.message || '';
    draft.metadata.sefazProtocol = transmission.protocol || '';
    draft.metadata.sefazReceipt = transmission.receipt || '';
    draft.metadata.sefazProcessedAt = transmission.processedAt || '';
    draft.metadata.sefazResponseXml = transmission.responseXml || '';
    draft.metadata.sefazEndpoint = transmission.endpoint || '';
    appendDraftLog(draft, 'XML Transmitido');
    if (['100', '150'].includes(transmission.status)) {
      draft.status = 'authorized';
    }
    draft.markModified('metadata');
    await draft.save();

    if (['100', '150'].includes(transmission.status)) {
      const emittedNumber = cleanString(draft?.payload?.header?.number || draft?.header?.number || '');
      const storeId = store?._id || store?.id || '';
      if (emittedNumber && storeId) {
        const updateResult = await FiscalSerie.updateOne(
          { _id: serieId, 'parametros.empresa': storeId },
          { $set: { 'parametros.$.ultimaNotaEmitida': emittedNumber } }
        );
        if (!updateResult?.matchedCount) {
          await FiscalSerie.updateOne(
            { _id: serieId },
            { $push: { parametros: { empresa: storeId, ultimaNotaEmitida: emittedNumber } } }
          );
        }
      }
    }

    return res.json({
      status: transmission.status,
      message: transmission.message,
      protocol: transmission.protocol,
      processedAt: transmission.processedAt,
      receipt: transmission.receipt,
      environment: ambiente,
    });
  } catch (error) {
    console.error('Erro ao transmitir NF-e:', error);
    if (draft) {
      appendDraftLog(draft, `Erro ao transmitir: ${error.message || 'Falha ao transmitir a NF-e.'}`);
      await draft.save().catch(() => null);
    }
    return res.status(500).json({ message: error.message || 'Falha ao transmitir a NF-e.' });
  }
});

router.get('/:id/xml', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const draft = await NfeEmissionDraft.findById(id);
    let r2Key = draft?.metadata?.xmlR2Key || '';
    if (!r2Key && draft?.metadata?.xmlContent) {
      if (!isR2Configured()) {
        return res.status(500).json({ message: 'Cloudflare R2 nao configurado.' });
      }
      const companyId = draft.companyId || draft.payload?.company?.id || '';
      const store = companyId ? await Store.findById(companyId).lean() : null;
      const serieId = draft?.payload?.header?.serie || '';
      const serie = serieId ? await FiscalSerie.findById(serieId).lean() : null;
      if (!store || !serie) {
        return res.status(404).json({ message: 'XML não encontrado para esta NF-e.' });
      }
      const ambiente = cleanString(serie?.ambiente).toLowerCase() === 'producao' ? 'producao' : 'homologacao';
      const header = draft?.payload?.header || {};
      const emissionDate = header?.issueDate ? new Date(`${header.issueDate}T00:00:00`) : new Date();
      const accessKey = draft?.xml?.accessKey || '';
      const keyToUpload = buildNfeR2Key({
        store,
        environment: ambiente,
        serie,
        emissionDate,
        accessKey: accessKey || `NFe-${draft._id}`,
      });
      const upload = await uploadBufferToR2(Buffer.from(draft.metadata.xmlContent, 'utf8'), {
        key: keyToUpload,
        contentType: 'application/xml',
      });
      draft.metadata.xmlR2Key = upload?.key || keyToUpload;
      draft.metadata.xmlUrl = upload?.url || buildPublicUrl(keyToUpload);
      draft.markModified('metadata');
      await draft.save();
    }

    if (!r2Key) {
      const companyId = draft.companyId || draft.payload?.company?.id || '';
      const store = companyId ? await Store.findById(companyId).lean() : null;
      const serieId = draft?.payload?.header?.serie || '';
      const serie = serieId ? await FiscalSerie.findById(serieId).lean() : null;
      const ambiente = cleanString(serie?.ambiente).toLowerCase() === 'producao' ? 'producao' : 'homologacao';
      const header = draft?.payload?.header || {};
      const emissionDate = header?.issueDate ? new Date(`${header.issueDate}T00:00:00`) : new Date();
      const accessKey = draft?.xml?.accessKey || '';
      if (store && serie && accessKey) {
        r2Key = buildNfeR2Key({
          store,
          environment: ambiente,
          serie,
          emissionDate,
          accessKey,
        });
      }
    }

    if (!r2Key) {
      return res.status(404).json({ message: 'XML não encontrado para esta NF-e.' });
    }

    const r2Object = await getObjectFromR2(r2Key);
    if (!r2Object?.buffer) {
      return res.status(404).json({ message: 'XML não encontrado no armazenamento.' });
    }
    const filename = r2Key ? path.basename(r2Key) : `${draft?.xml?.accessKey || 'nfe'}.xml`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(r2Object.buffer);
  } catch (error) {
    console.error('Erro ao baixar XML da NF-e:', error);
    return res.status(500).json({ message: error.message || 'Falha ao recuperar XML da NF-e.' });
  }
});

router._test = {
  formatNDup,
  sumParcelas,
  validatePagCobrConsistency,
  buildPaymentEntries,
};

module.exports = router;
