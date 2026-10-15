const crypto = require('crypto');
const mongoose = require('mongoose');
const Receipt = require('../models/ReceivingReceipt');
const Product = require('../models/Product');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const Supplier = require('../models/Supplier');
const InventoryMovementLog = require('../models/InventoryMovementLog');
const BarcodeLink = require('../models/ReceivingBarcodeLink');
const { adjustProductStockForDeposit, flushDeferredFractionalStockRefreshes } = require('../utils/inventoryStock');

const MAX_LINES = 1000;
const MAX_EVENTS = 10000;
const MAX_KIT_COMPONENTS = 50;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const elevatedRoles = new Set(['admin', 'admin_master', 'franqueador']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const round = value => Math.round(value * 1e6) / 1e6;
function fail(status, message, code = 'INVALID_RECEIVING', details) {
  const error = new Error(message); Object.assign(error, { status, code, details }); throw error;
}
function clean(value, max = 500) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) fail(400, 'Texto inválido ou muito longo.');
  return value.trim();
}
function number(value, { nullable = false, min = 0, max = 1e9 } = {}) {
  if (nullable && (value == null || value === '')) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, 'Quantidade, custo ou conversão inválida.');
  return round(value);
}
function objectId(value, nullable = false) {
  if (nullable && !value) return null;
  const id = typeof value === 'string' ? value : String(value || '');
  if (!OBJECT_ID.test(id)) fail(400, 'Identificador inválido.');
  return id;
}
function isElevated(req) { return elevatedRoles.has(req.user?.originalRole || req.user?.role); }
function canApproveStock(req) { return !req.collector && ['admin', 'admin_master'].includes(req.user?.originalRole || req.user?.role); }
function companyFilter(req) {
  return isElevated(req) ? {} : { companyId: { $in: req.user?.storeIds || [] } };
}
function assertCompanyAccess(req, companyId) {
  objectId(companyId);
  if (!isElevated(req) && !(req.user?.storeIds || []).map(String).includes(String(companyId))) {
    fail(403, 'Seu usuário não tem acesso a esta empresa.', 'COMPANY_FORBIDDEN');
  }
}
async function findReceipt(req, id, { session } = {}) {
  objectId(id);
  const receipt = await Receipt.findOne({ _id: id, ...companyFilter(req) }).session(session || null).lean();
  if (!receipt) fail(404, 'Recebimento não encontrado.');
  return receipt;
}
function requireDraft(receipt) {
  if (receipt.status !== 'draft') fail(409, 'Este recebimento foi finalizado e não pode ser alterado.', 'RECEIPT_CLOSED');
}
function requireVersion(receipt, version) {
  if (!Number.isInteger(version) || version !== receipt.version) fail(409, 'O recebimento mudou. Atualize a tela antes de salvar.', 'VERSION_CONFLICT', { version: receipt.version });
}
async function validateDestination(req, value, session) {
  assertCompanyAccess(req, value.companyId);
  objectId(value.depositId);
  const company = await Store.findById(value.companyId).session(session || null).lean();
  const deposit = await Deposit.findById(value.depositId).session(session || null).lean();
  if (!company || !deposit || String(deposit.empresa) !== String(value.companyId)) fail(400, 'Selecione uma empresa e um depósito pertencente a ela.');
  let supplier = null;
  if (value.supplierId) {
    objectId(value.supplierId);
    supplier = await Supplier.findById(value.supplierId).session(session || null).lean();
    if (!supplier || supplier.flags?.inactive) fail(400, 'Fornecedor não encontrado ou inativo.');
    if (supplier.companies?.length && !supplier.companies.map(String).includes(String(value.companyId))) fail(400, 'O fornecedor não está vinculado à empresa selecionada.');
  }
  return { company, deposit, supplier };
}
const productFields = '_id cod codbarras codigosComplementares nome unidade imagemPrincipal fornecedores inativo fracionado.ativo';
async function lookupBarcode(barcode, session) {
  const links = await BarcodeLink.find({ barcode }).select('productId').session(session || null).lean();
  return Product.find({ $or: [{ codbarras: barcode }, { codigosComplementares: barcode }, { _id: { $in: links.map(link => link.productId) } }] })
    .select(productFields).limit(3).session(session || null).lean();
}
async function appendReceivingBarcodes(products) {
  const links = await BarcodeLink.find({}).select('barcode productId').lean();
  const indexed = new Map(products.map(product => [String(product._id), product]));
  for (const link of links) {
    const product = indexed.get(String(link.productId));
    if (!product) continue;
    product.receivingBarcodes = [...(product.receivingBarcodes || []), link.barcode];
    product.codigosComplementares = [...new Set([...(product.codigosComplementares || []), link.barcode])];
  }
  return products;
}
function emptyLine(fields = {}) {
  return { id: crypto.randomUUID(), description: '', supplierCode: '', expectedQuantity: null,
    receivedQuantity: 0, unit: 'UN', unitCost: null, productId: null, productName: '', barcode: '',
    stockFactor: 1, conversionConfirmed: false, reviewed: false, warnings: [], kit: null, ...fields };
}
function integerQuantity(value, { min = 0 } = {}) {
  if (!Number.isInteger(value)) fail(400, 'A quantidade de kits e de peças por kit deve ser inteira.', 'INVALID_KIT_QUANTITY');
  return number(value, { min, max: 1000000 });
}
function isKit(line) { return Boolean(line?.kit); }
function pendingLine(line) {
  return !line.reviewed || !line.conversionConfirmed || (isKit(line)
    ? !line.kit.components?.length || line.kit.components.some(component => !component.productId || !component.barcode || !component.label)
    : !line.productId);
}
function kitFingerprint(kit) {
  return JSON.stringify(kit ? kit.components.map(({ id, label, quantityPerKit, productId, barcode }) => ({ id, label, quantityPerKit, productId: String(productId || ''), barcode })) : null);
}
async function normalizeKit(input, lineId) {
  if (input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.components)
    || !input.components.length || input.components.length > MAX_KIT_COMPONENTS) fail(400, 'Configure entre 1 e 50 componentes no kit.', 'INVALID_KIT');
  const ids = new Set(); const barcodes = new Set(); const components = [];
  for (const item of input.components) {
    if (!item || typeof item !== 'object' || !UUID.test(item.id || '') || ids.has(item.id)) fail(400, 'Identificador de componente inválido ou repetido.', 'INVALID_KIT');
    ids.add(item.id);
    const component = { id: item.id, label: clean(item.label || '', 80), quantityPerKit: integerQuantity(item.quantityPerKit, { min: 1 }),
      productId: objectId(item.productId, true), productName: '', barcode: clean(item.barcode || '', 128) };
    if (component.barcode && (/\p{Cc}/u.test(component.barcode) || barcodes.has(component.barcode))) fail(400, 'Cada componente deve ter um código de barras diferente. Para peças iguais, aumente a quantidade por kit.', 'KIT_BARCODE_DUPLICATE');
    if (component.barcode) barcodes.add(component.barcode);
    const matches = component.barcode ? await lookupBarcode(component.barcode) : [];
    if (matches.length > 1 || (component.productId && matches.some(product => String(product._id) !== component.productId))) {
      fail(409, 'O código do componente está associado a outro produto ou a mais de um cadastro.', 'BARCODE_CONFLICT', { lineId, componentId: component.id });
    }
    if (!component.productId && matches.length === 1) component.productId = String(matches[0]._id);
    if (component.productId) {
      const product = await Product.findById(component.productId).select(productFields).lean();
      if (!product) fail(400, 'O produto do componente não existe.', 'PRODUCT_UNAVAILABLE', { lineId, componentId: component.id });
      if (product.fracionado?.ativo) fail(400, 'Escolha o produto individual para o componente, e não outro cadastro fracionado.', 'KIT_NESTED_FRACTIONAL', { lineId, componentId: component.id });
      component.productName = product.nome;
    }
    components.push(component);
  }
  return { components };
}
function eventFor(req, value) {
  return { ...value, userId: req.user.id, deviceId: req.collector?._id || null, receivedAt: new Date() };
}
function receiptResponse(receipt, { summary = false } = {}) {
  const result = JSON.parse(JSON.stringify(receipt));
  const lines = result.lines || [];
  result.lineCount = lines.length;
  result.receivedQuantity = round(lines.reduce((sum, line) => sum + line.receivedQuantity, 0));
  result.pendingCount = lines.filter(pendingLine).length;
  result.differenceCount = lines.filter(line => line.expectedQuantity !== null && round(line.expectedQuantity - line.receivedQuantity) !== 0).length;
  if (summary) { delete result.events; delete result.lines; }
  else for (const event of result.events || []) delete event.payloadHash;
  return result;
}
async function createReceipt(req, payload = {}) {
  const data = {
    companyId: objectId(payload.companyId), depositId: objectId(payload.depositId), supplierId: objectId(payload.supplierId, true),
    supplierName: clean(payload.supplierName, 200), reference: clean(payload.reference, 200), notes: clean(payload.notes, 4000),
    sourceDocumentType: clean(payload.sourceDocumentType, 80), testMode: payload.testMode !== false,
  };
  if (req.collector && !data.testMode) fail(403, 'Crie a entrada real pelo painel administrativo.');
  const { supplier } = await validateDestination(req, data);
  if (supplier) data.supplierName = supplier.fantasyName || supplier.legalName;
  const id = new mongoose.Types.ObjectId();
  return Receipt.create({ ...data, _id: id, code: `ROM-${String(id).toUpperCase()}`, createdBy: req.user.id, updatedBy: req.user.id });
}
function checkSize(receipt) {
  if (receipt.lines.length > MAX_LINES || receipt.events.length > MAX_EVENTS) fail(413, 'Limite do recebimento atingido. Abra outro recebimento para continuar.');
}
async function saveDraft(receipt, req) {
  checkSize(receipt);
  return Receipt.findOneAndUpdate({ _id: receipt._id, version: receipt.version, status: 'draft' }, {
    $set: { companyId: receipt.companyId, depositId: receipt.depositId, supplierId: receipt.supplierId,
      supplierName: receipt.supplierName, reference: receipt.reference, sourceDocumentType: receipt.sourceDocumentType,
      notes: receipt.notes, testMode: receipt.testMode, lines: receipt.lines, events: receipt.events, updatedBy: req.user.id },
    $inc: { version: 1 },
  }, { new: true, runValidators: true }).lean();
}
async function patchReceipt(req, id, payload = {}) {
  const receipt = await findReceipt(req, id); requireDraft(receipt); requireVersion(receipt, payload.version);
  const priorCompany = String(receipt.companyId);
  for (const key of ['companyId', 'depositId']) if (key in payload) receipt[key] = objectId(payload[key]);
  if ('supplierId' in payload) receipt.supplierId = objectId(payload.supplierId, true);
  for (const [key, max] of [['supplierName', 200], ['reference', 200], ['sourceDocumentType', 80], ['notes', 4000]]) {
    if (key in payload) receipt[key] = clean(payload[key], max);
  }
  if ('testMode' in payload) {
    if (typeof payload.testMode !== 'boolean') fail(400, 'Modo de teste inválido.');
    if (req.collector && payload.testMode !== receipt.testMode) fail(403, 'Altere o modo de teste pelo painel administrativo.');
    receipt.testMode = payload.testMode;
  }
  if (receipt.events.length && priorCompany !== String(receipt.companyId)) fail(409, 'Não é possível mudar a empresa após registrar leituras.');
  const { supplier } = await validateDestination(req, receipt);
  if (supplier) receipt.supplierName = supplier.fantasyName || supplier.legalName;
  if (payload.deleteLineIds !== undefined) {
    if (!Array.isArray(payload.deleteLineIds) || payload.deleteLineIds.length > MAX_LINES) fail(400, 'Linhas para exclusão inválidas.');
    for (const lineId of payload.deleteLineIds) {
      const line = receipt.lines.find(item => item.id === lineId);
      if (line && (line.receivedQuantity !== 0 || receipt.events.some(event => event.lineId === lineId && ['count', 'kit_count'].includes(event.mode) && !event.undoneBy))) {
        fail(409, 'Desfaça as leituras da linha antes de removê-la.');
      }
      receipt.lines = receipt.lines.filter(item => item.id !== lineId);
    }
  }
  if (payload.lines !== undefined) {
    if (!Array.isArray(payload.lines) || payload.lines.length > MAX_LINES) fail(400, 'Lista de produtos inválida.');
    const submitted = new Set();
    for (const input of payload.lines) {
      if (!input || typeof input !== 'object') fail(400, 'Linha inválida.');
      const lineId = input.id || crypto.randomUUID();
      if (!UUID.test(lineId) || submitted.has(lineId)) fail(400, 'Identificador de linha inválido ou repetido.');
      submitted.add(lineId);
      let line = receipt.lines.find(item => item.id === lineId);
      if (!line) { line = emptyLine({ id: lineId }); receipt.lines.push(line); }
      const before = { ...line };
      for (const [key, max] of [['description', 600], ['supplierCode', 100], ['unit', 20], ['barcode', 128], ['sourcePhotoId', 100], ['sourceText', 2000], ['sourcePage', 80]]) {
        if (key in input) line[key] = clean(input[key] == null ? '' : String(input[key]), max);
      }
      if ('expectedQuantity' in input) line.expectedQuantity = number(input.expectedQuantity, { nullable: true });
      if ('unitCost' in input) line.unitCost = number(input.unitCost, { nullable: true });
      if ('stockFactor' in input) line.stockFactor = number(input.stockFactor, { min: 0.000001, max: 1000000 });
      if ('productId' in input) line.productId = objectId(input.productId, true);
      if ('kit' in input && Boolean(input.kit) !== isKit(before) && (before.receivedQuantity !== 0
        || receipt.events.some(event => event.lineId === lineId && ['count', 'kit_count'].includes(event.mode) && !event.undoneBy))) {
        fail(409, 'Desfaça as contagens desta linha antes de mudar entre produto individual e kit.', 'KIT_TYPE_COUNT_CONFLICT', { lineId });
      }
      if ('kit' in input) line.kit = await normalizeKit(input.kit, lineId);
      else if (isKit(line)) line.kit = await normalizeKit(line.kit, lineId);
      if (isKit(line)) {
        line.productId = null; line.productName = ''; line.stockFactor = 1;
        integerQuantity('receivedQuantity' in input ? input.receivedQuantity : line.receivedQuantity);
        if (line.expectedQuantity !== null) integerQuantity(line.expectedQuantity);
      }
      let autoMatched = false;
      if (!isKit(line) && !line.productId && !('productId' in input) && supplier && line.supplierCode) {
        // Drafts may identify inactive products. Include them when detecting ambiguous supplier references too.
        const candidates = await Product.find({ 'fornecedores.codigoProduto': line.supplierCode }).select(productFields).lean();
        const matches = candidates.flatMap(product => product.fornecedores.filter(link => link.codigoProduto === line.supplierCode && sameSupplier(link, supplier)).map(link => ({ product, link })));
        if (matches.length === 1) {
          line.productId = matches[0].product._id; autoMatched = true;
          const factor = supplierFactor(matches[0].link);
          if (factor && (!matches[0].link.unidadeEntrada || normalizeName(matches[0].link.unidadeEntrada) === normalizeName(line.unit))) line.stockFactor = factor;
        }
      }
      if (line.productId) {
        const product = await Product.findById(line.productId).select(productFields).lean();
        if (!product) fail(400, 'O produto vinculado não existe.', 'PRODUCT_UNAVAILABLE', { lineId });
        line.productName = product.nome;
        if (line.barcode) {
          const matches = await lookupBarcode(line.barcode);
          if (matches.some(match => String(match._id) !== String(product._id))) fail(409, 'Este código pertence a outro produto. Confira a embalagem antes de vincular.', 'BARCODE_CONFLICT', { lineId });
        }
      } else line.productName = '';
      const kitChanged = kitFingerprint(before.kit) !== kitFingerprint(line.kit);
      const identityChanged = kitChanged || String(before.productId || '') !== String(line.productId || '') || before.barcode !== line.barcode || before.unit !== line.unit || before.stockFactor !== line.stockFactor;
      const contentChanged = identityChanged || before.expectedQuantity !== line.expectedQuantity || before.description !== line.description || before.unitCost !== line.unitCost;
      if (identityChanged) line.conversionConfirmed = false;
      if (contentChanged) line.reviewed = false;
      for (const key of ['conversionConfirmed', 'reviewed']) if (key in input) {
        if (typeof input[key] !== 'boolean') fail(400, 'Confirmação de revisão inválida.');
        line[key] = input[key];
      }
      if (autoMatched) { line.reviewed = false; line.conversionConfirmed = false; }
      // A changed composition always needs a fresh explicit review after it is saved.
      if (kitChanged) { line.reviewed = false; line.conversionConfirmed = false; }
      if (input.warnings !== undefined) {
        if (!Array.isArray(input.warnings) || input.warnings.length > 20) fail(400, 'Avisos inválidos.');
        line.warnings = input.warnings.map(value => clean(value, 500));
      }
      if ('receivedQuantity' in input) {
        const nextQuantity = number(input.receivedQuantity);
        const delta = round(nextQuantity - before.receivedQuantity);
        if (delta !== 0) {
          const eventId = crypto.randomUUID();
          receipt.events.push(eventFor(req, { eventId, payloadHash: hash(eventId), mode: 'adjust', lineId, quantity: delta,
            createdAt: new Date(), status: 'adjusted', message: `Quantidade corrigida de ${before.receivedQuantity} para ${nextQuantity}.` }));
          line.receivedQuantity = nextQuantity;
          if (input.reviewed !== true) line.reviewed = false;
        }
      }
      if (!pendingLine(line)) for (const event of receipt.events) {
        if (event.lineId === line.id && ['unknown', 'conflict'].includes(event.status)) event.status = 'resolved';
      }
    }
  }
  const saved = await saveDraft(receipt, req);
  if (!saved) fail(409, 'O recebimento mudou. Atualize a tela antes de salvar.', 'VERSION_CONFLICT');
  return saved;
}
function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || !UUID.test(input.eventId || '')) fail(400, 'Cada leitura precisa de um eventId UUID válido.');
  const mode = input.undoOf ? 'undo' : input.mode || 'count';
  if (!['count', 'identify', 'kit_count', 'undo'].includes(mode)) fail(400, 'Modo de leitura inválido.');
  const barcode = ['undo', 'kit_count'].includes(mode) ? '' : clean(input.barcode, 128);
  if (mode === 'kit_count' && input.barcode) fail(400, 'Conte kits completos pelo botão de quantidade, sem bipar uma peça.', 'KIT_COUNT_WITH_BARCODE');
  if (!['undo', 'kit_count'].includes(mode) && (!barcode || /\p{Cc}/u.test(barcode))) fail(400, 'Código de barras inválido.');
  const lineId = input.lineId || '';
  if (lineId && !UUID.test(lineId)) fail(400, 'Linha inválida.');
  if (['identify', 'kit_count'].includes(mode) && !lineId) fail(400, 'Escolha uma linha para identificar ou contar o kit.');
  const componentId = input.componentId || '';
  if (componentId && (!UUID.test(componentId) || mode !== 'identify')) fail(400, 'Escolha um componente apenas para identificar seu código.', 'INVALID_COMPONENT');
  const undoOf = input.undoOf || '';
  if (mode === 'undo' && !UUID.test(undoOf)) fail(400, 'Leitura para desfazer inválida.');
  const quantity = mode === 'kit_count' ? integerQuantity(input.quantity ?? 1, { min: 1 })
    : mode === 'count' ? number(input.quantity ?? 1, { min: 0.000001, max: 1000000 }) : 0;
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
  if (!Number.isFinite(createdAt.getTime())) fail(400, 'Data da leitura inválida.');
  // createdAt is excluded so a legacy client may retry an event without a supplied timestamp.
  // Omit an empty componentId to retain the hash of pre-kit offline events.
  const payloadHash = hash(JSON.stringify({ barcode, mode, lineId, undoOf, quantity, ...(componentId ? { componentId } : {}) }));
  return { eventId: input.eventId, barcode, mode, componentId, requestedLineId: lineId, lineId, undoOf, quantity, createdAt, payloadHash };
}
async function applyEvent(receipt, input, req, barcodeCache) {
  const existing = receipt.events.find(event => event.eventId === input.eventId);
  if (existing) {
    if (existing.payloadHash !== input.payloadHash) fail(409, 'O identificador da leitura foi reutilizado com dados diferentes.', 'EVENT_ID_CONFLICT');
    return false;
  }
  requireDraft(receipt);
  if (input.mode === 'undo') {
    const original = receipt.events.find(event => event.eventId === input.undoOf);
    if (!original || !['count', 'kit_count'].includes(original.mode)) fail(400, 'A leitura original não foi encontrada. Sincronize antes de desfazer.');
    const event = eventFor(req, { ...input, lineId: original.lineId, status: original.undoneBy ? 'already_undone' : 'undone' });
    if (!original.undoneBy) {
      const line = receipt.lines.find(item => item.id === original.lineId);
      if (!line || round(line.receivedQuantity - original.quantity) < 0) fail(409, 'A quantidade foi corrigida. Revise a linha antes de desfazer esta leitura.', 'UNDO_QUANTITY_CONFLICT');
      const nextQuantity = round(line.receivedQuantity - original.quantity);
      if (isKit(line)) integerQuantity(nextQuantity);
      line.receivedQuantity = nextQuantity; line.reviewed = false;
      original.undoneBy = event.eventId; original.status = 'undone'; event.quantity = -original.quantity;
    }
    receipt.events.push(event); return true;
  }
  let line = input.lineId ? receipt.lines.find(item => item.id === input.lineId) : null;
  if (input.lineId && !line) fail(404, 'A linha escolhida não existe mais.', 'LINE_NOT_FOUND');
  if (input.mode === 'kit_count') {
    if (!isKit(line)) fail(409, 'A linha escolhida não está configurada como kit.', 'LINE_NOT_KIT');
    line.receivedQuantity = integerQuantity(round(line.receivedQuantity + input.quantity));
    line.reviewed = false;
    receipt.events.push(eventFor(req, { ...input, lineId: line.id, status: 'kit_counted' }));
    return true;
  }
  if (input.componentId && !isKit(line)) fail(409, 'O componente não pertence a esta linha.', 'COMPONENT_NOT_FOUND');
  if (isKit(line) && (input.mode !== 'identify' || !input.componentId)) {
    fail(409, 'Selecione o tamanho para identificar a peça. Para contar kits completos, use a quantidade de kits.', 'KIT_COMPONENT_REQUIRED');
  }
  if (!barcodeCache.has(input.barcode)) barcodeCache.set(input.barcode, await lookupBarcode(input.barcode));
  const matches = barcodeCache.get(input.barcode);
  // Identification does not publish a product or move stock; approval still requires an active catalog record.
  const product = matches.length === 1 ? matches[0] : null;
  let conflict = matches.length > 1 ? 'Código associado a mais de um produto no catálogo.' : '';
  if (isKit(line)) {
    const component = line.kit.components.find(item => item.id === input.componentId);
    if (!component) fail(409, 'O componente escolhido não existe mais. Atualize o kit.', 'COMPONENT_NOT_FOUND');
    if (conflict || (component.productId && product && String(component.productId) !== String(product._id))) {
      fail(409, conflict || 'O código bipado identifica outro produto. Revise o componente antes de trocar.', 'BARCODE_CONFLICT', { lineId: line.id, componentId: component.id });
    }
    if (product?.fracionado?.ativo) fail(400, 'Escolha o produto individual para o componente, e não outro cadastro fracionado.', 'KIT_NESTED_FRACTIONAL');
    if (line.kit.components.some(item => item.id !== component.id && item.barcode === input.barcode)) {
      fail(409, 'Esse código já identifica outra peça do kit. Para peças iguais, aumente a quantidade por kit.', 'KIT_BARCODE_DUPLICATE');
    }
    // A different unknown code may be another size. Keep a manual link only on
    // the first barcode (or a repeat of it), never transfer it to a new code.
    if (!product && component.barcode && component.barcode !== input.barcode) {
      component.productId = null; component.productName = '';
    }
    component.barcode = input.barcode;
    if (product) { component.productId = product._id; component.productName = product.nome; }
    line.reviewed = false; line.conversionConfirmed = false;
    receipt.events.push(eventFor(req, { ...input, lineId: line.id, status: component.productId ? 'identified' : 'unknown', message: '' }));
    return true;
  }
  if (line?.productId && product && String(line.productId) !== String(product._id)) conflict = 'O produto bipado é diferente do produto da linha selecionada.';
  if (input.mode === 'identify') {
    if (conflict) fail(409, conflict, 'BARCODE_CONFLICT');
    line.barcode = input.barcode;
    if (product) { line.productId = product._id; line.productName = product.nome; }
    line.reviewed = false; line.conversionConfirmed = false;
  } else {
    if (conflict) line = null;
    if (!line) {
      const candidates = receipt.lines.filter(item => !isKit(item) && (item.barcode === input.barcode || (!conflict && product && String(item.productId) === String(product._id))));
      if (candidates.length === 1 && !conflict) line = candidates[0];
      else if (candidates.length > 1) conflict = 'Mais de uma linha corresponde ao código. Confira a linha da leitura.';
    }
    if (line?.productId && product && String(line.productId) !== String(product._id)) {
      conflict = 'O cadastro do código mudou e não corresponde ao produto vinculado nesta linha.'; line = null;
    }
    if (!line) {
      line = emptyLine({ barcode: input.barcode, description: product?.nome || `Código ${input.barcode}`, productId: conflict ? null : product?._id || null,
        productName: conflict ? '' : product?.nome || '', unit: product?.unidade || 'UN', warnings: conflict ? [conflict] : [] });
      receipt.lines.push(line);
    }
    if (!line.productId && product && !conflict) { line.productId = product._id; line.productName = product.nome; }
    if (!line.barcode) line.barcode = input.barcode;
    line.receivedQuantity = number(round(line.receivedQuantity + input.quantity)); line.reviewed = false;
  }
  receipt.events.push(eventFor(req, { ...input, lineId: line.id, status: conflict ? 'conflict' : line.productId ? (input.mode === 'identify' ? 'identified' : 'matched') : 'unknown', message: conflict }));
  return true;
}
async function addEvents(req, id, payload = {}) {
  if (!Array.isArray(payload.events) || !payload.events.length || payload.events.length > 200) fail(400, 'Envie entre 1 e 200 leituras por sincronização.');
  const events = payload.events.map(normalizeEvent);
  for (let attempt = 0; attempt < 12; attempt++) {
    const receipt = await findReceipt(req, id); let changed = false;
    const cache = new Map();
    for (const event of events) changed = await applyEvent(receipt, event, req, cache) || changed;
    if (!changed) return { receipt, acknowledged: events.map(event => event.eventId) };
    const saved = await saveDraft(receipt, req);
    if (saved) return { receipt: saved, acknowledged: events.map(event => event.eventId) };
  }
  fail(409, 'Outras leituras estão sendo salvas. Tente sincronizar novamente.', 'VERSION_CONFLICT');
}
async function validateApproval(req, receipt, body, session) {
  const destination = await validateDestination(req, receipt, session);
  if (!receipt.lines.length) fail(400, 'Inclua e confira pelo menos um produto.');
  let total = 0; const quantities = new Map(); const kitQuantities = new Map(); const products = new Map(); const barcodeProducts = new Map();
  for (const line of receipt.lines) {
    if (pendingLine(line)) fail(400, 'Vincule os produtos e confirme a revisão e a conversão de todas as linhas e peças do kit.', 'PENDING_LINES', { lineId: line.id });
    number(line.receivedQuantity); number(line.stockFactor, { min: 0.000001, max: 1000000 });
    if (isKit(line)) {
      integerQuantity(line.receivedQuantity);
      if (line.expectedQuantity !== null) integerQuantity(line.expectedQuantity);
      if (line.productId || line.stockFactor !== 1 || line.kit.components.length > MAX_KIT_COMPONENTS) fail(400, 'Revise a composição do kit antes de aprovar.', 'INVALID_KIT', { lineId: line.id });
    }
    if (line.expectedQuantity !== null && round(line.expectedQuantity - line.receivedQuantity) !== 0 && body.acceptDifferences !== true) {
      fail(400, 'Confirme as diferenças entre as quantidades previstas e recebidas.', 'QUANTITY_DIFFERENCES');
    }
    const targets = isKit(line) ? line.kit.components : [line];
    const seenCodes = new Set(); const seenIds = new Set();
    for (const target of targets) {
      const details = { lineId: line.id, ...(isKit(line) ? { componentId: target.id } : {}) };
      if (isKit(line)) {
        integerQuantity(target.quantityPerKit, { min: 1 });
        if (!UUID.test(target.id) || seenIds.has(target.id) || !clean(target.label, 80) || !clean(target.barcode, 128)
          || /\p{Cc}/u.test(target.barcode) || seenCodes.has(target.barcode)) fail(400, 'Revise os tamanhos e códigos de cada componente.', 'INVALID_KIT', details);
        seenIds.add(target.id); seenCodes.add(target.barcode);
      }
      const product = await Product.findById(target.productId).select(productFields).session(session || null).lean();
      if (!product || product.inativo) fail(400, 'Um dos produtos não existe ou está inativo.', 'PRODUCT_UNAVAILABLE', details);
      if (isKit(line) && product.fracionado?.ativo) fail(400, 'Um componente virou cadastro fracionado. Escolha o produto individual antes de aprovar.', 'KIT_NESTED_FRACTIONAL', details);
      if (target.barcode) {
        const matches = await lookupBarcode(target.barcode, session);
        const priorProduct = barcodeProducts.get(target.barcode);
        if ((priorProduct && priorProduct !== String(product._id)) || matches.some(match => String(match._id) !== String(product._id))) {
          fail(409, 'Um código identifica outro produto. Revise antes de aprovar.', 'BARCODE_CONFLICT', details);
        }
        barcodeProducts.set(target.barcode, String(product._id));
      }
      const quantity = number(round(line.receivedQuantity * (isKit(line) ? target.quantityPerKit : line.stockFactor)));
      const destinationQuantities = isKit(line) ? kitQuantities : quantities;
      total += quantity;
      destinationQuantities.set(String(product._id), number(round((destinationQuantities.get(String(product._id)) || 0) + quantity)));
      products.set(String(product._id), product);
    }
  }
  if (total <= 0) fail(400, 'Nenhuma quantidade recebida para concluir.');
  return { ...destination, quantities, kitQuantities, products, total };
}
function normalizeName(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(); }
function sameSupplier(link, supplier) {
  const doc = String(link.documentoFornecedor || '').replace(/\D/g, '');
  const supplierDoc = String(supplier.cnpj || '').replace(/\D/g, '');
  if (doc && supplierDoc) return doc === supplierDoc;
  return [supplier._id, supplier.legalName, supplier.fantasyName].filter(Boolean).some(value => normalizeName(value) === normalizeName(link.fornecedor));
}
function supplierFactor(link) {
  const value = Number(link.valorCalculo);
  if (!Number.isFinite(value) || value <= 0) return null;
  const type = normalizeName(link.tipoCalculo);
  if (type.startsWith('DIV')) return round(1 / value);
  if (!type || type.startsWith('MULT') || type === 'X') return round(value);
  return null;
}
async function learnSupplierLinks(receipt, supplier, session) {
  // The supplier reference describes the whole kit, never an individual component.
  if (receipt.lines.every(isKit)) return;
  if (!supplier) fail(400, 'Selecione um fornecedor cadastrado para memorizar as associações.');
  for (const line of receipt.lines) {
    if (isKit(line) || !line.supplierCode) continue;
    const others = await Product.find({ 'fornecedores.codigoProduto': line.supplierCode }).select('_id fornecedores').session(session).lean();
    if (others.some(product => String(product._id) !== String(line.productId) && product.fornecedores.some(link => link.codigoProduto === line.supplierCode && sameSupplier(link, supplier)))) {
      fail(409, 'Esta referência de fornecedor já está associada a outro produto. Nenhuma entrada foi feita.', 'SUPPLIER_LINK_CONFLICT', { lineId: line.id });
    }
    const product = await Product.findById(line.productId).session(session);
    const existing = product.fornecedores.find(link => sameSupplier(link, supplier) && link.codigoProduto === line.supplierCode);
    if (existing) {
      const multiplier = supplierFactor(existing) || 1;
      if (existing.unidadeEntrada && normalizeName(existing.unidadeEntrada) !== normalizeName(line.unit) || !Number.isFinite(multiplier) || round(multiplier) !== line.stockFactor) {
        fail(409, 'A conversão do fornecedor já cadastrada é diferente. Revise o cadastro antes de memorizar.', 'SUPPLIER_CONVERSION_CONFLICT', { lineId: line.id });
      }
      continue;
    }
    product.fornecedores.push({ fornecedor: supplier.fantasyName || supplier.legalName, documentoFornecedor: supplier.cnpj,
      nomeProdutoFornecedor: line.description, codigoProduto: line.supplierCode, unidadeEntrada: line.unit,
      tipoCalculo: 'multiplicar', valorCalculo: line.stockFactor });
    await product.save({ session });
  }
}
async function learnBarcodeLinks(req, receipt, session) {
  for (const line of receipt.lines) for (const target of isKit(line) ? line.kit.components : [line]) {
    if (!target.barcode) continue;
    const matches = await lookupBarcode(target.barcode, session);
    if (matches.some(product => String(product._id) !== String(target.productId))) fail(409, 'O código bipado já identifica outro produto.', 'BARCODE_CONFLICT', { lineId: line.id });
    if (matches.length) continue;
    let link;
    try {
      link = await BarcodeLink.findOneAndUpdate({ barcode: target.barcode }, {
        $setOnInsert: { productId: target.productId, receiptId: receipt._id, confirmedBy: req.user.id },
      }, { upsert: true, new: true, session });
    } catch (error) {
      if (error.code === 11000) fail(409, 'Este código foi associado em outro recebimento. Atualize e confira o produto.', 'BARCODE_CONFLICT');
      throw error;
    }
    if (String(link.productId) !== String(target.productId)) fail(409, 'Este código já foi confirmado para outro produto.', 'BARCODE_CONFLICT');
  }
}
async function approveReceipt(req, id, body = {}) {
  const initial = await findReceipt(req, id);
  if (['approved', 'test_approved'].includes(initial.status)) return initial;
  requireDraft(initial); requireVersion(initial, body.version);
  if (!initial.testMode && !canApproveStock(req)) fail(403, 'A entrada de estoque precisa ser confirmada por um gestor no painel administrativo.', 'APPROVAL_REQUIRES_MANAGER');
  if (initial.testMode) {
    await validateApproval(req, initial, body);
    const result = await Receipt.findOneAndUpdate({ _id: id, status: 'draft', version: body.version, testMode: true }, {
      $set: { status: 'test_approved', approvedAt: new Date(), approvedBy: req.user.id, updatedBy: req.user.id,
        approval: { stockApplied: false, acceptDifferences: body.acceptDifferences === true, learnedSupplierLinks: false, learnedBarcodes: false } }, $inc: { version: 1 },
    }, { new: true }).lean();
    if (!result) fail(409, 'O recebimento mudou. Atualize antes de concluir.', 'VERSION_CONFLICT');
    return result;
  }
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const receipt = await findReceipt(req, id, { session });
      if (receipt.status === 'approved') { result = receipt; return; }
      requireDraft(receipt); requireVersion(receipt, body.version);
      if (receipt.testMode) fail(409, 'O modo de teste mudou. Atualize antes de aprovar.', 'VERSION_CONFLICT');
      const { supplier, quantities, kitQuantities } = await validateApproval(req, receipt, body, session);
      if (body.learnBarcodes === true) await learnBarcodeLinks(req, receipt, session);
      if (body.learnSupplierLinks === true) await learnSupplierLinks(receipt, supplier, session);
      const deferredFractionalRefresh = { productIds: new Set(), childProductIds: new Set() };
      const appliedProducts = new Set();
      const stockEntries = [...Array.from(quantities, ([productId, quantity]) => ({ productId, quantity, fromKit: false })),
        ...Array.from(kitQuantities, ([productId, quantity]) => ({ productId, quantity, fromKit: true }))];
      for (const { productId, quantity, fromKit } of stockEntries) {
        if (quantity <= 0) continue;
        const movement = await adjustProductStockForDeposit({ productId, depositId: receipt.depositId, quantity, session,
          cascadeFractional: !fromKit, deferredFractionalRefresh, movementContext: {
            companyId: receipt.companyId, operation: 'entrada', sourceModule: 'compras.fornecedor', sourceScreen: 'Recebimento de romaneio',
            sourceAction: 'aprovar_romaneio', sourceType: 'receiving_romaneio_approved', referenceDocument: String(receipt._id),
            userId: req.user.id, userEmail: req.user.email || '', metadata: { receiptId: String(receipt._id), code: receipt.code, documentType: 'romaneio', ...(fromKit ? { fromKit: true } : {}) },
          } });
        if (!movement?.updated) fail(500, 'Não foi possível concluir todas as movimentações. Nenhuma entrada foi confirmada.');
        const audit = await InventoryMovementLog.exists({ product: productId, sourceType: 'receiving_romaneio_approved', referenceDocument: String(receipt._id) }).session(session);
        if (!audit) fail(500, 'Não foi possível registrar o histórico. Nenhuma entrada foi confirmada.');
        appliedProducts.add(productId);
      }
      await flushDeferredFractionalStockRefreshes(deferredFractionalRefresh, { session });
      result = await Receipt.findOneAndUpdate({ _id: id, version: body.version, status: 'draft' }, {
        $set: { status: 'approved', approvedAt: new Date(), approvedBy: req.user.id, updatedBy: req.user.id,
          approval: { stockApplied: true, appliedProducts: appliedProducts.size, acceptDifferences: body.acceptDifferences === true, learnedSupplierLinks: body.learnSupplierLinks === true, learnedBarcodes: body.learnBarcodes === true } },
        $inc: { version: 1 },
      }, { session, new: true }).lean();
      if (!result) fail(409, 'O recebimento mudou. Atualize antes de aprovar.', 'VERSION_CONFLICT');
    });
    return result;
  } finally { await session.endSession(); }
}

module.exports = { fail, clean, objectId, isElevated, companyFilter, assertCompanyAccess, findReceipt,
  receiptResponse, createReceipt, patchReceipt, addEvents, approveReceipt, lookupBarcode, sameSupplier, productFields,
  normalizeEvent, emptyLine, requireDraft, requireVersion, MAX_LINES, MAX_EVENTS, MAX_KIT_COMPONENTS, UUID, hash, appendReceivingBarcodes, canApproveStock };
