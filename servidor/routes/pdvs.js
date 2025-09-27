const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const PdvState = require('../models/PdvState');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { isDriveConfigured, uploadBufferToDrive } = require('../utils/googleDrive');

const ambientesPermitidos = ['homologacao', 'producao'];
const ambientesSet = new Set(ambientesPermitidos);
const opcoesImpressao = ['sim', 'nao', 'perguntar'];
const opcoesImpressaoSet = new Set(opcoesImpressao);
const perfisDesconto = ['funcionario', 'gerente', 'admin'];
const perfisDescontoSet = new Set(perfisDesconto);
const tiposEmissao = ['matricial', 'fiscal', 'ambos'];
const tiposEmissaoSet = new Set(tiposEmissao);

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'sim'].includes(normalized);
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

const generateNextCode = async () => {
  const pdvs = await Pdv.find({}, 'codigo').lean();
  const highest = pdvs.reduce((max, pdv) => {
    const current = extractNumericValue(pdv?.codigo);
    return current > max ? current : max;
  }, 0);
  return `PDV-${String(highest + 1).padStart(3, '0')}`;
};

const normalizeAmbientes = (value) => {
  let items = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    items = value.split(',');
  }

  const filtered = items
    .map((item) => normalizeString(item).toLowerCase())
    .filter((item) => ambientesSet.has(item));

  return Array.from(new Set(filtered));
};

const storeSupportsEnvironment = (store, env) => {
  if (!store) return false;
  if (env === 'producao') {
    return Boolean(store.cscIdProducao && store.cscTokenProducaoArmazenado);
  }
  if (env === 'homologacao') {
    return Boolean(store.cscIdHomologacao && store.cscTokenHomologacaoArmazenado);
  }
  return false;
};

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const parseSempreImprimir = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'perguntar';
  if (!opcoesImpressaoSet.has(normalized)) {
    throw createValidationError('Selecione uma opção válida para "Sempre imprimir".');
  }
  return normalized;
};

const parseCopias = (value, { allowNull = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    return allowNull ? null : 1;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createValidationError('Informe um número válido de vias para a impressora selecionada.');
  }
  const inteiro = Math.trunc(parsed);
  if (inteiro < 1 || inteiro > 10) {
    throw createValidationError('O número de vias deve estar entre 1 e 10.');
  }
  return inteiro;
};

const buildPrinterPayload = (payload) => {
  if (!payload) return null;

  const nome = normalizeString(payload.nome || payload.printer || payload.nomeImpressora);
  const vias = parseCopias(payload.vias ?? payload.copias ?? payload.copiasImpressao ?? '', {
    allowNull: !nome,
  });

  if (!nome) {
    return null;
  }

  return {
    nome,
    vias: vias ?? 1,
  };
};

const normalizePerfisDesconto = (value) => {
  let itens = [];
  if (Array.isArray(value)) {
    itens = value;
  } else if (typeof value === 'string') {
    itens = value.split(',');
  }

  const filtrados = itens
    .map((item) => normalizeString(item).toLowerCase())
    .filter((item) => perfisDescontoSet.has(item));

  return Array.from(new Set(filtrados));
};

const parseTipoEmissao = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'fiscal';
  if (!tiposEmissaoSet.has(normalized)) {
    throw createValidationError('Selecione um tipo de emissão padrão válido.');
  }
  return normalized;
};

const safeNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const escapeXml = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const sanitizeFileName = (value, fallback = 'documento.xml') => {
  const base = value === undefined || value === null ? '' : String(value);
  const normalized = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
  const trimmed = normalized || fallback;
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
};

const buildDrivePathSegments = (date) => {
  const reference = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = String(reference.getFullYear());
  const month = String(reference.getMonth() + 1).padStart(2, '0');
  const day = String(reference.getDate()).padStart(2, '0');
  return ['Fiscal', 'XMLs', year, month, day];
};

const buildSaleFiscalXml = ({ sale, pdv, store, emissionDate }) => {
  const snapshot = sale?.receiptSnapshot || {};
  const meta = snapshot.meta || {};
  const cliente = snapshot.cliente || {};
  const delivery = snapshot.delivery || null;
  const itens = Array.isArray(snapshot.itens) ? snapshot.itens : [];
  const totais = snapshot.totais || {};
  const pagamentos = Array.isArray(snapshot.pagamentos?.items) ? snapshot.pagamentos.items : [];
  const pagamentosTotal = snapshot.pagamentos?.formattedTotal || snapshot.pagamentos?.total || '';
  const ambiente = pdv?.ambientePadrao || '';
  const emissionIso = emissionDate instanceof Date && !Number.isNaN(emissionDate.getTime())
    ? emissionDate.toISOString()
    : new Date().toISOString();

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<NFCe xmlns="https://schemas.eobicho.app/pdv/fiscal">');
  lines.push('  <Identificacao>');
  lines.push(`    <Ambiente>${escapeXml(ambiente)}</Ambiente>`);
  lines.push(`    <PdvCodigo>${escapeXml(pdv?.codigo || '')}</PdvCodigo>`);
  lines.push(`    <PdvNome>${escapeXml(pdv?.nome || '')}</PdvNome>`);
  lines.push(`    <VendaId>${escapeXml(sale?.id || '')}</VendaId>`);
  lines.push(`    <VendaCodigo>${escapeXml(sale?.saleCode || meta.saleCode || '')}</VendaCodigo>`);
  lines.push(`    <DataRegistro>${escapeXml(meta.data || '')}</DataRegistro>`);
  lines.push(`    <DataEmissao>${escapeXml(emissionIso)}</DataEmissao>`);
  lines.push(`    <Operador>${escapeXml(meta.operador || '')}</Operador>`);
  lines.push('  </Identificacao>');
  lines.push('  <Emitente>');
  lines.push(`    <RazaoSocial>${escapeXml(store?.razaoSocial || store?.nomeFantasia || store?.nome || '')}</RazaoSocial>`);
  lines.push(`    <NomeFantasia>${escapeXml(store?.nomeFantasia || '')}</NomeFantasia>`);
  lines.push(`    <CNPJ>${escapeXml(store?.cnpj || '')}</CNPJ>`);
  lines.push(`    <InscricaoEstadual>${escapeXml(store?.inscricaoEstadual || '')}</InscricaoEstadual>`);
  lines.push('  </Emitente>');
  if (cliente && (cliente.nome || cliente.documento || cliente.contato || cliente.pet)) {
    lines.push('  <Destinatario>');
    lines.push(`    <Nome>${escapeXml(cliente.nome || '')}</Nome>`);
    lines.push(`    <Documento>${escapeXml(cliente.documento || '')}</Documento>`);
    lines.push(`    <Contato>${escapeXml(cliente.contato || '')}</Contato>`);
    lines.push(`    <Pet>${escapeXml(cliente.pet || '')}</Pet>`);
    lines.push('  </Destinatario>');
  }
  if (delivery) {
    lines.push('  <Entrega>');
    lines.push(`    <Apelido>${escapeXml(delivery.apelido || '')}</Apelido>`);
    lines.push(`    <Endereco>${escapeXml(delivery.formatted || '')}</Endereco>`);
    lines.push(`    <CEP>${escapeXml(delivery.cep || '')}</CEP>`);
    lines.push(`    <Logradouro>${escapeXml(delivery.logradouro || '')}</Logradouro>`);
    lines.push(`    <Numero>${escapeXml(delivery.numero || '')}</Numero>`);
    lines.push(`    <Complemento>${escapeXml(delivery.complemento || '')}</Complemento>`);
    lines.push(`    <Bairro>${escapeXml(delivery.bairro || '')}</Bairro>`);
    lines.push(`    <Municipio>${escapeXml(delivery.cidade || '')}</Municipio>`);
    lines.push(`    <UF>${escapeXml(delivery.uf || '')}</UF>`);
    lines.push('  </Entrega>');
  }
  lines.push('  <Itens>');
  itens.forEach((item, index) => {
    lines.push('    <Item>');
    lines.push(`      <Numero>${escapeXml(item?.index || String(index + 1))}</Numero>`);
    lines.push(`      <Descricao>${escapeXml(item?.nome || '')}</Descricao>`);
    lines.push(`      <Codigos>${escapeXml(item?.codigo || '')}</Codigos>`);
    lines.push(`      <Quantidade>${escapeXml(item?.quantidade || '')}</Quantidade>`);
    lines.push(`      <ValorUnitario>${escapeXml(item?.unitario || '')}</ValorUnitario>`);
    lines.push(`      <ValorTotal>${escapeXml(item?.subtotal || '')}</ValorTotal>`);
    lines.push('    </Item>');
  });
  lines.push('  </Itens>');
  lines.push('  <Totais>');
  lines.push(`    <Bruto>${escapeXml(totais.bruto || '')}</Bruto>`);
  lines.push(`    <Desconto valor="${escapeXml(totais.descontoValor ?? '')}">${escapeXml(totais.desconto || '')}</Desconto>`);
  lines.push(`    <Acrescimo valor="${escapeXml(totais.acrescimoValor ?? '')}">${escapeXml(totais.acrescimo || '')}</Acrescimo>`);
  lines.push(`    <Liquido>${escapeXml(totais.liquido || '')}</Liquido>`);
  lines.push(`    <Pago>${escapeXml(totais.pago || '')}</Pago>`);
  lines.push(`    <Troco valor="${escapeXml(totais.trocoValor ?? '')}">${escapeXml(totais.troco || '')}</Troco>`);
  lines.push('  </Totais>');
  if (pagamentos.length) {
    lines.push('  <Pagamentos>');
    pagamentos.forEach((payment) => {
      lines.push('    <Pagamento>');
      lines.push(`      <Descricao>${escapeXml(payment?.label || '')}</Descricao>`);
      lines.push(`      <Valor>${escapeXml(payment?.formatted || payment?.valor || '')}</Valor>`);
      lines.push('    </Pagamento>');
    });
    lines.push(`    <Total>${escapeXml(pagamentosTotal || '')}</Total>`);
    lines.push('  </Pagamentos>');
  }
  lines.push('</NFCe>');
  return lines.join('\n');
};

const formatDateTimeLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizePaymentSnapshotPayload = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const idSource =
    snapshot.id ||
    snapshot._id ||
    snapshot.code ||
    snapshot.codigo ||
    snapshot.label ||
    snapshot.nome ||
    snapshot.name;
  const id = normalizeString(idSource);
  const labelSource =
    snapshot.label ||
    snapshot.nome ||
    snapshot.name ||
    snapshot.descricao ||
    snapshot.description ||
    id ||
    'Meio de pagamento';
  const label = normalizeString(labelSource) || 'Meio de pagamento';
  const type = normalizeString(snapshot.type || snapshot.tipo).toLowerCase();
  const aliases = Array.isArray(snapshot.aliases)
    ? snapshot.aliases.map((alias) => normalizeString(alias)).filter(Boolean)
    : [];
  const valor = safeNumber(snapshot.valor ?? snapshot.value ?? snapshot.total ?? 0, 0);
  const parcelasRaw = snapshot.parcelas ?? snapshot.installments ?? 1;
  const parcelas = Math.max(1, Number.parseInt(parcelasRaw, 10) || 1);
  return {
    id: id || label,
    label,
    type: type || 'avista',
    aliases,
    valor,
    parcelas,
  };
};

const normalizeHistoryEntryPayload = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = normalizeString(entry.id || entry._id);
  const label = normalizeString(entry.label || entry.descricao || entry.tipo) || 'Movimentação';
  const amount = safeNumber(entry.amount ?? entry.valor ?? entry.delta ?? 0, 0);
  const delta = safeNumber(entry.delta ?? entry.valor ?? amount, 0);
  const motivo = normalizeString(entry.motivo || entry.observacao);
  const paymentLabel = normalizeString(entry.paymentLabel || entry.meioPagamento || entry.formaPagamento);
  const paymentId = normalizeString(entry.paymentId || entry.formaPagamentoId || entry.payment || entry.paymentMethodId);
  const timestamp = safeDate(entry.timestamp || entry.data || entry.createdAt || entry.atualizadoEm) || new Date();
  return {
    id: id || undefined,
    label,
    amount,
    delta,
    motivo,
    paymentLabel,
    paymentId,
    timestamp,
  };
};

const normalizeSaleRecordPayload = (record) => {
  if (!record || typeof record !== 'object') return null;
  const id = normalizeString(record.id || record._id) || `sale-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const type = normalizeString(record.type) || 'venda';
  const typeLabel = normalizeString(record.typeLabel) || (type === 'delivery' ? 'Delivery' : 'Venda');
  const saleCode = normalizeString(record.saleCode);
  const saleCodeLabel = normalizeString(record.saleCodeLabel) || saleCode || 'Sem código';
  const customerName =
    normalizeString(record.customerName) || normalizeString(record.cliente) || 'Cliente não informado';
  const customerDocument = normalizeString(record.customerDocument);
  const paymentTags = Array.isArray(record.paymentTags)
    ? record.paymentTags.map((tag) => normalizeString(tag)).filter(Boolean)
    : [];
  const items = Array.isArray(record.items)
    ? record.items.map((item) => (item && typeof item === 'object' ? { ...item } : item))
    : [];
  const discountValue = safeNumber(record.discountValue ?? record.desconto ?? 0, 0);
  const discountLabel = normalizeString(record.discountLabel);
  const additionValue = safeNumber(record.additionValue ?? record.acrescimo ?? 0, 0);
  const createdAt = safeDate(record.createdAt) || new Date();
  const createdAtLabel = normalizeString(record.createdAtLabel);
  const fiscalStatus = normalizeString(record.fiscalStatus);
  const fiscalEmittedAt = safeDate(record.fiscalEmittedAt);
  const fiscalEmittedAtLabel = normalizeString(record.fiscalEmittedAtLabel);
  const fiscalDriveFileId = normalizeString(record.fiscalDriveFileId);
  const fiscalXmlUrl = normalizeString(record.fiscalXmlUrl);
  const fiscalXmlName = normalizeString(record.fiscalXmlName);
  const fiscalEnvironment = normalizeString(record.fiscalEnvironment);
  const status = normalizeString(record.status) || 'completed';
  const cancellationReason = normalizeString(record.cancellationReason);
  const cancellationAt = safeDate(record.cancellationAt);
  const cancellationAtLabel = normalizeString(record.cancellationAtLabel);
  return {
    id,
    type,
    typeLabel,
    saleCode,
    saleCodeLabel,
    customerName,
    customerDocument,
    paymentTags,
    items,
    discountValue,
    discountLabel,
    additionValue,
    createdAt,
    createdAtLabel,
    receiptSnapshot: record.receiptSnapshot || null,
    fiscalStatus,
    fiscalEmittedAt,
    fiscalEmittedAtLabel,
    fiscalDriveFileId,
    fiscalXmlUrl,
    fiscalXmlName,
    fiscalEnvironment,
    expanded: Boolean(record.expanded),
    status,
    cancellationReason,
    cancellationAt,
    cancellationAtLabel,
  };
};

const normalizePrintPreference = (value, fallback = 'PM') => {
  const normalized = normalizeString(value).toUpperCase();
  if (!normalized) return fallback;
  const allowed = new Set(['M', 'F', 'PM', 'PF', 'FM', 'FF', 'NONE']);
  return allowed.has(normalized) ? normalized : fallback;
};

const buildStateUpdatePayload = ({ body = {}, existingState = {}, empresaId }) => {
  const caixaAberto = Boolean(
    body.caixaAberto ?? body.caixa?.aberto ?? body.statusCaixa === 'aberto' ?? existingState.caixaAberto
  );
  const summarySource = body.summary || body.caixa?.resumo || {};
  const caixaSource = body.caixaInfo || body.caixa || {};
  const pagamentosSource = Array.isArray(body.pagamentos) ? body.pagamentos : body.caixa?.pagamentos;
  const historicoSource = Array.isArray(body.history) ? body.history : body.caixa?.historico;
  const vendasSource = Array.isArray(body.completedSales) ? body.completedSales : body.caixa?.vendas;
  const previstoSource = caixaSource.previstoPagamentos || caixaSource.pagamentosPrevistos;
  const apuradoSource = caixaSource.apuradoPagamentos || caixaSource.pagamentosApurados;
  const lastMovementSource = body.lastMovement || body.caixa?.ultimoLancamento;
  const saleCodeIdentifier =
    normalizeString(body.saleCodeIdentifier || body.saleCode?.identifier || caixaSource.saleCodeIdentifier) ||
    existingState.saleCodeIdentifier ||
    '';
  const saleCodeSequenceRaw =
    body.saleCodeSequence ?? body.saleCode?.sequence ?? caixaSource.saleCodeSequence ?? existingState.saleCodeSequence;
  const saleCodeSequence = Number.parseInt(saleCodeSequenceRaw, 10);
  const printPreferencesSource =
    (body.printPreferences && typeof body.printPreferences === 'object' && body.printPreferences) ||
    existingState.printPreferences ||
    {};

  return {
    empresa: empresaId,
    caixaAberto,
    summary: {
      abertura: safeNumber(
        summarySource.abertura ?? summarySource.valorAbertura ?? body.abertura ?? existingState.summary?.abertura ?? 0,
        0
      ),
      recebido: safeNumber(summarySource.recebido ?? existingState.summary?.recebido ?? 0, 0),
      saldo: safeNumber(summarySource.saldo ?? existingState.summary?.saldo ?? 0, 0),
    },
    caixaInfo: {
      aberturaData:
        safeDate(caixaSource.aberturaData || caixaSource.dataAbertura || caixaSource.abertura || existingState.caixaInfo?.aberturaData) ||
        null,
      fechamentoData:
        safeDate(caixaSource.fechamentoData || caixaSource.dataFechamento || caixaSource.fechamento || existingState.caixaInfo?.fechamentoData) ||
        null,
      fechamentoPrevisto: safeNumber(caixaSource.fechamentoPrevisto ?? caixaSource.valorPrevisto ?? existingState.caixaInfo?.fechamentoPrevisto ?? 0, 0),
      fechamentoApurado: safeNumber(caixaSource.fechamentoApurado ?? caixaSource.valorApurado ?? existingState.caixaInfo?.fechamentoApurado ?? 0, 0),
      previstoPagamentos: (Array.isArray(previstoSource) ? previstoSource : [])
        .map(normalizePaymentSnapshotPayload)
        .filter(Boolean),
      apuradoPagamentos: (Array.isArray(apuradoSource) ? apuradoSource : [])
        .map(normalizePaymentSnapshotPayload)
        .filter(Boolean),
    },
    pagamentos: (Array.isArray(pagamentosSource) ? pagamentosSource : [])
      .map(normalizePaymentSnapshotPayload)
      .filter(Boolean),
    history: (Array.isArray(historicoSource) ? historicoSource : [])
      .map(normalizeHistoryEntryPayload)
      .filter(Boolean),
    completedSales: (Array.isArray(vendasSource) ? vendasSource : [])
      .map(normalizeSaleRecordPayload)
      .filter(Boolean),
    lastMovement: normalizeHistoryEntryPayload(lastMovementSource) || null,
    saleCodeIdentifier,
    saleCodeSequence: Number.isFinite(saleCodeSequence) && saleCodeSequence > 0
      ? saleCodeSequence
      : existingState.saleCodeSequence || 1,
    printPreferences: {
      fechamento: normalizePrintPreference(printPreferencesSource.fechamento || 'PM'),
      venda: normalizePrintPreference(printPreferencesSource.venda || 'PM'),
    },
  };
};

const serializeStateForResponse = (stateDoc) => {
  if (!stateDoc) {
    return {
      caixa: {
        aberto: false,
        status: 'fechado',
        valorAbertura: 0,
        valorPrevisto: 0,
        valorApurado: 0,
        resumo: { abertura: 0, recebido: 0, saldo: 0 },
        pagamentos: [],
        historico: [],
        previstoPagamentos: [],
        apuradoPagamentos: [],
        aberturaData: null,
        fechamentoData: null,
        fechamentoPrevisto: 0,
        fechamentoApurado: 0,
        ultimoLancamento: null,
        saleCodeIdentifier: '',
        saleCodeSequence: 1,
      },
      pagamentos: [],
      summary: { abertura: 0, recebido: 0, saldo: 0 },
      caixaInfo: {
        aberturaData: null,
        fechamentoData: null,
        fechamentoPrevisto: 0,
        fechamentoApurado: 0,
        previstoPagamentos: [],
        apuradoPagamentos: [],
      },
      history: [],
      completedSales: [],
      lastMovement: null,
      saleCodeIdentifier: '',
      saleCodeSequence: 1,
      printPreferences: { fechamento: 'PM', venda: 'PM' },
      updatedAt: null,
    };
  }

  const plain = stateDoc.toObject ? stateDoc.toObject() : stateDoc;
  const summary = plain.summary || {};
  const caixaInfo = plain.caixaInfo || {};
  const pagamentos = Array.isArray(plain.pagamentos) ? plain.pagamentos : [];
  const history = Array.isArray(plain.history) ? plain.history : [];
  const completedSales = Array.isArray(plain.completedSales) ? plain.completedSales : [];

  return {
    caixa: {
      aberto: Boolean(plain.caixaAberto),
      status: plain.caixaAberto ? 'aberto' : 'fechado',
      valorAbertura: summary.abertura || 0,
      valorPrevisto: caixaInfo.fechamentoPrevisto || 0,
      valorApurado: caixaInfo.fechamentoApurado || 0,
      resumo: {
        abertura: summary.abertura || 0,
        recebido: summary.recebido || 0,
        saldo: summary.saldo || 0,
      },
      pagamentos,
      historico: history,
      previstoPagamentos: caixaInfo.previstoPagamentos || [],
      apuradoPagamentos: caixaInfo.apuradoPagamentos || [],
      aberturaData: caixaInfo.aberturaData || null,
      fechamentoData: caixaInfo.fechamentoData || null,
      fechamentoPrevisto: caixaInfo.fechamentoPrevisto || 0,
      fechamentoApurado: caixaInfo.fechamentoApurado || 0,
      ultimoLancamento: plain.lastMovement || null,
      saleCodeIdentifier: plain.saleCodeIdentifier || '',
      saleCodeSequence: plain.saleCodeSequence || 1,
    },
    pagamentos,
    summary: {
      abertura: summary.abertura || 0,
      recebido: summary.recebido || 0,
      saldo: summary.saldo || 0,
    },
    caixaInfo: {
      aberturaData: caixaInfo.aberturaData || null,
      fechamentoData: caixaInfo.fechamentoData || null,
      fechamentoPrevisto: caixaInfo.fechamentoPrevisto || 0,
      fechamentoApurado: caixaInfo.fechamentoApurado || 0,
      previstoPagamentos: caixaInfo.previstoPagamentos || [],
      apuradoPagamentos: caixaInfo.apuradoPagamentos || [],
    },
    history,
    completedSales,
    lastMovement: plain.lastMovement || null,
    saleCodeIdentifier: plain.saleCodeIdentifier || '',
    saleCodeSequence: plain.saleCodeSequence || 1,
    printPreferences: plain.printPreferences || { fechamento: 'PM', venda: 'PM' },
    updatedAt: plain.updatedAt || null,
  };
};

const buildPdvPayload = ({ body, store }) => {
  const nome = normalizeString(body.nome);
  const apelido = normalizeString(body.apelido);
  const serieNfe = normalizeString(body.serieNfe || body.serieNFE);
  const serieNfce = normalizeString(body.serieNfce || body.serieNFCE);
  const observacoes = normalizeString(body.observacoes);
  const ambientesHabilitados = normalizeAmbientes(body.ambientesHabilitados);
  const ambientePadrao = normalizeString(body.ambientePadrao).toLowerCase();
  const ativo = parseBoolean(body.ativo !== undefined ? body.ativo : true);
  const sincronizacaoAutomatica = parseBoolean(body.sincronizacaoAutomatica !== undefined ? body.sincronizacaoAutomatica : true);
  const permitirModoOffline = parseBoolean(body.permitirModoOffline);
  let limiteOffline = permitirModoOffline ? parseNumber(body.limiteOffline) : null;
  if (limiteOffline === null && permitirModoOffline) {
    limiteOffline = 0;
  }

  if (limiteOffline !== null && limiteOffline < 0) {
    throw new Error('O limite de emissões offline deve ser maior ou igual a zero.');
  }

  if (!ambientesHabilitados.length) {
    throw new Error('Informe ao menos um ambiente fiscal habilitado.');
  }

  if (!ambientePadrao) {
    throw new Error('Informe o ambiente padrão de emissão.');
  }

  if (!ambientesHabilitados.includes(ambientePadrao)) {
    throw new Error('O ambiente padrão precisa estar entre os ambientes habilitados.');
  }

  for (const env of ambientesHabilitados) {
    if (!storeSupportsEnvironment(store, env)) {
      if (env === 'producao') {
        throw new Error('A empresa selecionada não possui CSC configurado para Produção.');
      }
      if (env === 'homologacao') {
        throw new Error('A empresa selecionada não possui CSC configurado para Homologação.');
      }
      throw new Error('Ambiente fiscal indisponível para a empresa selecionada.');
    }
  }

  return {
    nome,
    apelido,
    ativo,
    serieNfe,
    serieNfce,
    ambientesHabilitados,
    ambientePadrao,
    sincronizacaoAutomatica,
    permitirModoOffline,
    limiteOffline,
    observacoes,
  };
};

router.get('/', async (req, res) => {
  try {
    const { empresa } = req.query;
    const query = {};
    if (empresa) {
      query.empresa = empresa;
    }
    const pdvs = await Pdv.find(query)
      .sort({ nome: 1 })
      .populate('empresa')
      .lean();
    res.json({ pdvs });
  } catch (error) {
    console.error('Erro ao listar PDVs:', error);
    res.status(500).json({ message: 'Erro ao listar PDVs.' });
  }
});

router.get('/next-code', async (req, res) => {
  try {
    const codigo = await generateNextCode();
    res.json({ codigo });
  } catch (error) {
    console.error('Erro ao gerar próximo código de PDV:', error);
    res.status(500).json({ message: 'Erro ao gerar próximo código.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pdv = await Pdv.findById(req.params.id)
      .populate('empresa')
      .populate('configuracoesEstoque.depositoPadrao')
      .lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const state = await PdvState.findOne({ pdv: pdv._id });
    const serializedState = serializeStateForResponse(state);

    const response = {
      ...pdv,
      caixa: {
        ...(pdv.caixa || {}),
        ...serializedState.caixa,
      },
      pagamentos: serializedState.pagamentos,
      summary: serializedState.summary,
      caixaInfo: serializedState.caixaInfo,
      history: serializedState.history,
      completedSales: serializedState.completedSales,
      lastMovement: serializedState.lastMovement,
      saleCodeIdentifier: serializedState.saleCodeIdentifier,
      saleCodeSequence: serializedState.saleCodeSequence,
      printPreferences: serializedState.printPreferences,
      caixaAtualizadoEm: serializedState.updatedAt,
    };

    res.json(response);
  } catch (error) {
    console.error('Erro ao obter PDV:', error);
    res.status(500).json({ message: 'Erro ao obter PDV.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const empresaId = normalizeString(req.body.empresa || req.body.empresaId);
    const nome = normalizeString(req.body.nome);

    if (!nome) {
      return res.status(400).json({ message: 'O nome do PDV é obrigatório.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsável pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      codigo = await generateNextCode();
    }

    const codigoDuplicado = await Pdv.exists({ codigo });
    if (codigoDuplicado) {
      return res.status(409).json({ message: 'Já existe um PDV com este código.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const criadoPor = req.user?.email || req.user?.id || 'Sistema';

    const pdv = await Pdv.create({
      ...payload,
      codigo,
      empresa: empresaId,
      criadoPor,
      atualizadoPor: criadoPor,
    });

    const populated = await pdv.populate('empresa');
    res.status(201).json(populated);
  } catch (error) {
    console.error('Erro ao criar PDV:', error);
    res.status(500).json({ message: 'Erro ao criar PDV.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const pdvId = req.params.id;
    const empresaId = normalizeString(req.body.empresa || req.body.empresaId);
    const nome = normalizeString(req.body.nome);

    if (!nome) {
      return res.status(400).json({ message: 'O nome do PDV é obrigatório.' });
    }
    if (!empresaId) {
      return res.status(400).json({ message: 'Selecione a empresa responsável pelo PDV.' });
    }

    const store = await Store.findById(empresaId).lean();
    if (!store) {
      return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
    }

    let payload;
    try {
      payload = buildPdvPayload({ body: req.body, store });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const codigo = normalizeString(req.body.codigo);
    if (!codigo) {
      return res.status(400).json({ message: 'O código do PDV é obrigatório.' });
    }

    const duplicado = await Pdv.findOne({ codigo, _id: { $ne: pdvId } });
    if (duplicado) {
      return res.status(409).json({ message: 'Já existe outro PDV com este código.' });
    }

    const atualizadoPor = req.user?.email || req.user?.id || 'Sistema';

    const updated = await Pdv.findByIdAndUpdate(
      pdvId,
      {
        ...payload,
        codigo,
        empresa: empresaId,
        atualizadoPor,
      },
      { new: true, runValidators: true }
    ).populate('empresa');

    if (!updated) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar PDV:', error);
    res.status(500).json({ message: 'Erro ao atualizar PDV.' });
  }
});

router.post('/:id/sales/:saleId/fiscal', requireAuth, async (req, res) => {
  try {
    const pdvId = req.params.id;
    const saleId = normalizeString(req.params.saleId);

    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'Identificador de PDV inválido.' });
    }

    if (!saleId) {
      return res.status(400).json({ message: 'Identificador da venda é obrigatório.' });
    }

    if (!isDriveConfigured()) {
      return res.status(500).json({ message: 'Integração com o Google Drive não está configurada.' });
    }

    const pdv = await Pdv.findById(pdvId).populate('empresa');

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const state = await PdvState.findOne({ pdv: pdvId });

    if (!state) {
      return res
        .status(404)
        .json({ message: 'Nenhuma venda registrada foi encontrada para este PDV.' });
    }

    const sale = Array.isArray(state.completedSales)
      ? state.completedSales.find((entry) => entry && entry.id === saleId)
      : null;

    if (!sale) {
      return res.status(404).json({ message: 'Venda informada não foi encontrada.' });
    }

    if (sale.status === 'cancelled') {
      return res
        .status(400)
        .json({ message: 'Não é possível emitir nota fiscal para uma venda cancelada.' });
    }

    if (sale.fiscalStatus === 'emitted' && sale.fiscalDriveFileId) {
      return res.status(409).json({ message: 'Esta venda já possui XML emitido.' });
    }

    const snapshotFromRequest = req.body?.snapshot;
    if (!sale.receiptSnapshot && snapshotFromRequest) {
      sale.receiptSnapshot = snapshotFromRequest;
    }

    if (!sale.saleCode && req.body?.saleCode) {
      sale.saleCode = normalizeString(req.body.saleCode);
      sale.saleCodeLabel = sale.saleCode || 'Sem código';
    }

    if (!sale.receiptSnapshot) {
      return res
        .status(400)
        .json({ message: 'Snapshot da venda indisponível para emissão fiscal.' });
    }

    const emissionDate = new Date();
    const xmlContent = buildSaleFiscalXml({
      sale,
      pdv,
      store: pdv.empresa || {},
      emissionDate,
    });

    const saleCodeForName = sale.saleCode || saleId;
    const baseName = sanitizeFileName(`NFCe-${saleCodeForName || emissionDate.getTime()}`);
    const fileName = baseName.toLowerCase().endsWith('.xml') ? baseName : `${baseName}.xml`;

    const uploadResult = await uploadBufferToDrive(Buffer.from(xmlContent, 'utf8'), {
      name: fileName,
      mimeType: 'application/xml',
      folderPath: buildDrivePathSegments(emissionDate),
    });

    sale.fiscalStatus = 'emitted';
    sale.fiscalEmittedAt = emissionDate;
    sale.fiscalEmittedAtLabel = formatDateTimeLabel(emissionDate);
    sale.fiscalDriveFileId = uploadResult?.id || '';
    sale.fiscalXmlUrl = uploadResult?.webViewLink || uploadResult?.webContentLink || '';
    sale.fiscalXmlName = uploadResult?.name || fileName;
    sale.fiscalEnvironment = pdv.ambientePadrao || '';

    state.markModified('completedSales');
    await state.save();

    res.json({
      id: sale.id,
      fiscalStatus: sale.fiscalStatus,
      fiscalEmittedAt: sale.fiscalEmittedAt,
      fiscalEmittedAtLabel: sale.fiscalEmittedAtLabel,
      fiscalDriveFileId: sale.fiscalDriveFileId,
      fiscalXmlUrl: sale.fiscalXmlUrl,
      fiscalXmlName: sale.fiscalXmlName,
      fiscalEnvironment: sale.fiscalEnvironment,
    });
  } catch (error) {
    console.error('Erro ao emitir nota fiscal do PDV:', error);
    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'Erro ao emitir nota fiscal.';
    res.status(500).json({ message });
  }
});

router.put('/:id/configuracoes', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const pdvId = req.params.id;
    const pdv = await Pdv.findById(pdvId);

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const impressaoPayload = req.body?.impressao || {};
    const vendaPayload = req.body?.venda || {};
    const fiscalPayload = req.body?.fiscal || {};
    const estoquePayload = req.body?.estoque || {};

    const sempreImprimir = parseSempreImprimir(impressaoPayload.sempreImprimir);
    const impressoraVenda = buildPrinterPayload(impressaoPayload.impressoraVenda);
    const impressoraOrcamento = buildPrinterPayload(impressaoPayload.impressoraOrcamento);
    const impressoraContas = buildPrinterPayload(impressaoPayload.impressoraContasReceber);
    const impressoraCaixa = buildPrinterPayload(impressaoPayload.impressoraCaixa);

    const perfis = normalizePerfisDesconto(vendaPayload.permitirDesconto);
    const tipoEmissaoPadrao = parseTipoEmissao(fiscalPayload.tipoEmissaoPadrao);

    let depositoPadraoId = null;
    if (estoquePayload.depositoPadrao) {
      depositoPadraoId = normalizeString(estoquePayload.depositoPadrao);
      if (depositoPadraoId) {
        if (!mongoose.Types.ObjectId.isValid(depositoPadraoId)) {
          throw createValidationError('Depósito selecionado é inválido.');
        }
        const deposito = await Deposit.findOne({ _id: depositoPadraoId, empresa: pdv.empresa });
        if (!deposito) {
          throw createValidationError('Depósito selecionado não pertence à mesma empresa do PDV.');
        }
      }
    }

    pdv.configuracoesImpressao = {
      sempreImprimir,
      impressoraVenda: impressoraVenda || undefined,
      impressoraOrcamento: impressoraOrcamento || undefined,
      impressoraContasReceber: impressoraContas || undefined,
      impressoraCaixa: impressoraCaixa || undefined,
    };

    pdv.configuracoesVenda = {
      permitirDesconto: perfis,
    };

    pdv.configuracoesFiscal = {
      tipoEmissaoPadrao,
    };

    pdv.configuracoesEstoque = {
      depositoPadrao: depositoPadraoId || null,
    };

    pdv.atualizadoPor = req.user?.email || req.user?.id || 'Sistema';

    await pdv.save();

    await pdv.populate([
      { path: 'empresa' },
      { path: 'configuracoesEstoque.depositoPadrao' },
    ]);

    res.json(pdv);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const message =
      error?.message && typeof error.message === 'string'
        ? error.message
        : 'Erro ao salvar configurações do PDV.';
    console.error('Erro ao salvar configurações do PDV:', error);
    res.status(statusCode).json({ message });
  }
});

router.put('/:id/state', requireAuth, async (req, res) => {
  try {
    const pdvId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(pdvId)) {
      return res.status(400).json({ message: 'Identificador de PDV inválido.' });
    }

    const pdv = await Pdv.findById(pdvId).lean();

    if (!pdv) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }

    const existingState = await PdvState.findOne({ pdv: pdvId });

    const updatePayload = buildStateUpdatePayload({
      body: req.body || {},
      existingState: existingState || {},
      empresaId: pdv.empresa,
    });

    const updatedState = await PdvState.findOneAndUpdate(
      { pdv: pdvId },
      {
        ...updatePayload,
        pdv: pdvId,
        empresa: updatePayload.empresa || pdv.empresa,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const serialized = serializeStateForResponse(updatedState);

    res.json(serialized);
  } catch (error) {
    console.error('Erro ao salvar estado do PDV:', error);
    res.status(500).json({ message: 'Erro ao salvar estado do PDV.' });
  }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const deleted = await Pdv.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'PDV não encontrado.' });
    }
    res.json({ message: 'PDV removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover PDV:', error);
    res.status(500).json({ message: 'Erro ao remover PDV.' });
  }
});

module.exports = router;
