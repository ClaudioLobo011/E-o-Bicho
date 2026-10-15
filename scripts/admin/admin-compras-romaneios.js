/* Receiving workspace. Document parsing is exported for focused tests without a browser. */
(function (root) {
  'use strict';
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value == null ? '' : value);
  const normalize = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const escape = (value) => text(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const idOf = (value) => text(value && typeof value === 'object' ? value._id || value.id : value);
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16; return (c === 'x' ? r : ((r & 3) | 8)).toString(16); });
  const number = (value) => {
    if (value === '' || value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    let cleaned = text(value).trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
    if (cleaned.includes(',')) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    return /^[-+]?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
  };
  function parseCsv(source) {
    const input = text(source).replace(/^\uFEFF/, '');
    const firstLine = input.split(/\r?\n/, 1)[0];
    let quoted = false;
    const counts = { ';': 0, ',': 0, '\t': 0 };
    for (let i = 0; i < firstLine.length; i++) {
      const char = firstLine[i];
      if (char === '"') { if (quoted && firstLine[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && char in counts) counts[char]++;
    }
    const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = []; let row = []; let cell = ''; quoted = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char === '"') {
        if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || !cell) quoted = !quoted;
        else cell += char;
      } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && input[i + 1] === '\n') i++;
        row.push(cell); if (row.some((entry) => entry.trim())) rows.push(row); row = []; cell = '';
      } else cell += char;
    }
    if (quoted) throw new Error('O CSV tem aspas abertas. Confira o arquivo antes de importar.');
    row.push(cell); if (row.some((entry) => entry.trim())) rows.push(row);
    if (rows.length < 2) throw new Error('O CSV precisa de cabeçalho e pelo menos uma linha de produto.');
    const headers = rows.shift().map((header) => normalize(header).replace(/[^a-z0-9]/g, ''));
    if (new Set(headers).size !== headers.length) throw new Error('O CSV contém cabeçalhos repetidos.');
    return rows.map((values, index) => {
      if (values.length !== headers.length) throw new Error(`A linha ${index + 2} tem ${values.length} colunas; eram esperadas ${headers.length}.`);
      return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    });
  }
  const isKit = (line) => !!line?.kit && Array.isArray(line.kit.components);
  function catalogIssues(line, index) {
    const targets = (isKit(line) ? line.kit.components : [line]).filter((target) => target.productId);
    if (!targets.length) return [];
    if (!index) return ['Verificando cadastro'];
    const issues = new Set();
    for (const target of targets) {
      const product = index.get(idOf(target.productId));
      if (!product) issues.add('Cadastro não encontrado');
      else if (product.inativo) issues.add('Cadastro inativo');
    }
    return [...issues];
  }
  function prepareKit(components) {
    if (!Array.isArray(components) || !components.length || components.length > 50) throw new Error('O kit precisa de 1 a 50 componentes.');
    const ids = new Set(), barcodes = new Set();
    return { components: components.map((source, index) => {
      const id = text(source.id || uuid()), label = text(source.label).trim(), quantityPerKit = number(source.quantityPerKit);
      if (ids.has(id)) throw new Error('Há componentes repetidos no kit.');
      ids.add(id);
      if (!label || label.length > 80) throw new Error(`Informe um nome de até 80 caracteres para a peça ${index + 1}.`);
      if (!Number.isSafeInteger(quantityPerKit) || quantityPerKit <= 0) throw new Error(`Informe uma quantidade inteira maior que zero para ${label}.`);
      if (typeof source.barcode === 'number') throw new Error(`O código de barras de ${label} precisa ser texto para preservar zeros à esquerda.`);
      const barcode = text(source.barcode).trim();
      if (barcode && (barcodes.has(barcode) || /[\u0000-\u001f\u007f]/.test(barcode))) throw new Error('Cada tipo de peça precisa de um código diferente. Para 3 P iguais, use uma peça P com quantidade 3.');
      if (barcode) barcodes.add(barcode);
      return { id, label, quantityPerKit, productId: source.productId || null, productName: text(source.productName), barcode: text(source.barcode).trim() };
    }) };
  }
  const kitPieces = (line) => (line.kit?.components || []).reduce((sum, component) => sum + Number(component.quantityPerKit || 0), 0);
  const kitFormula = (line) => (line.kit?.components || []).map((component) => `${component.quantityPerKit} ${component.label}`).join(' + ');
  function kitIssues(line) {
    if (!isKit(line)) return [];
    const issues = [];
    try { prepareKit(line.kit.components); } catch (error) { issues.push(error.message); }
    if (line.kit.components.some((component) => !component.productId)) issues.push('Peças sem cadastro vinculado');
    if (line.kit.components.some((component) => !component.barcode)) issues.push('Peças sem código de barras');
    if (!Number.isSafeInteger(Number(line.receivedQuantity)) || Number(line.receivedQuantity) < 0) issues.push('Quantidade de kits deve ser inteira');
    return issues;
  }
  function stockProjection(line) {
    if (!isKit(line)) return [{ productId: line.productId, productName: line.productName, quantity: Number(line.receivedQuantity || 0) * Number(line.stockFactor || 0) }];
    const products = new Map();
    for (const component of line.kit.components) {
      const key = component.productId || component.id, quantity = Number(line.receivedQuantity || 0) * Number(component.quantityPerKit || 0);
      const existing = products.get(key);
      if (existing) existing.quantity += quantity;
      else products.set(key, { productId: component.productId, productName: component.productName || component.label, quantity });
    }
    return [...products.values()];
  }
  function prepareScan({ barcode, quantity, mode, lineId, componentId }, line) {
    barcode = text(barcode).trim(); quantity = number(quantity);
    if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Informe uma quantidade maior que zero.');
    if (mode === 'kit_count') {
      if (!lineId || !isKit(line)) throw new Error('Selecione um kit configurado para contar kits completos.');
      if (!Number.isSafeInteger(quantity)) throw new Error('A quantidade de kits completos deve ser inteira.');
      return { quantity, mode, lineId };
    }
    if (!barcode) throw new Error('Informe o código de barras.');
    if (mode === 'identify' && !lineId) throw new Error('Selecione a linha do documento para identificar pelo código.');
    if (isKit(line)) {
      if (mode !== 'identify') throw new Error('Para este kit, identifique cada peça ou use “Contar kits completos”.');
      if (!line.kit.components.some((component) => component.id === componentId)) throw new Error('Selecione a peça do kit que será identificada.');
      return { barcode, quantity, mode, lineId, componentId };
    }
    return { barcode, quantity, mode, ...(lineId ? { lineId } : {}) };
  }
  const aliases = {
    description: ['description', 'descricao', 'produto', 'nome', 'descricaooriginal'],
    supplierCode: ['suppliercode', 'codigofornecedor', 'codfornecedor', 'referenciafornecedor'],
    expectedQuantity: ['expectedquantity', 'quantidadeesperada', 'quantidade', 'qtde', 'qtd'],
    unit: ['unit', 'unidade', 'un'],
    unitCost: ['unitcost', 'custounitario', 'valorunitario', 'preco', 'custo'],
    barcode: ['barcode', 'codigodebarras', 'codbarras', 'ean'],
    sourcePage: ['sourcepage', 'pagina', 'page'],
    sourceItem: ['sourceitem', 'item', 'itemnumber', 'itemoriginal'],
    sourcePhotoId: ['sourcephotoid', 'photoid'],
    sourceText: ['sourcetext', 'rawtext'],
  };
  function prepareImport(source, extension) {
    let rows;
    if (typeof source === 'string') {
      if (extension === 'json') {
        const parsed = JSON.parse(source.replace(/^\uFEFF/, ''));
        rows = Array.isArray(parsed) ? parsed : parsed.lines || parsed.receipt?.lines || parsed.extraction?.lines;
      } else rows = parseCsv(source);
    } else rows = source;
    if (!Array.isArray(rows) || !rows.length) throw new Error('Não há linhas de produtos para importar.');
    if (rows.length > 2000) throw new Error('Importe no máximo 2.000 linhas por vez.');
    const warnings = [];
    const lines = rows.map((sourceRow, index) => {
      if (!sourceRow || typeof sourceRow !== 'object' || Array.isArray(sourceRow)) throw new Error(`Linha ${index + 1} inválida.`);
      const row = Object.fromEntries(Object.entries(sourceRow).map(([key, value]) => [normalize(key).replace(/[^a-z0-9]/g, ''), value]));
      const line = {};
      for (const [field, keys] of Object.entries(aliases)) {
        const key = keys.find((candidate) => row[candidate] !== undefined);
        line[field] = key ? row[key] : '';
      }
      line.description = text(line.description).trim();
      if (!line.description) throw new Error(`Linha ${index + 1}: falta a descrição do produto.`);
      for (const key of ['expectedQuantity', 'unitCost']) {
        line[key] = number(line[key]);
        if (Number.isNaN(line[key]) || (line[key] != null && line[key] < 0)) throw new Error(`Linha ${index + 1}: ${key === 'unitCost' ? 'custo' : 'quantidade'} inválido. Deixe em branco se não estiver legível.`);
      }
      if (typeof line.barcode === 'number' || typeof line.supplierCode === 'number') warnings.push(`Linha ${index + 1}: o arquivo trouxe um código como número; confirme se há zeros à esquerda.`);
      line.supplierCode = text(line.supplierCode).trim(); line.barcode = text(line.barcode).trim();
      line.unit = text(line.unit).trim().toUpperCase() || 'UN';
      line.sourcePage = text(line.sourcePage); line.sourceItem = text(line.sourceItem);
      line.sourcePhotoId = text(line.sourcePhotoId); line.sourceText = text(line.sourceText);
      line.warnings = Array.isArray(sourceRow.warnings) ? sourceRow.warnings.map(text) : [];
      line.requiresManualReview = row.requiresmanualreview === true || row.requiresmanualreview === 'true';
      line.receivedQuantity = 0; line.stockFactor = 1; line.conversionConfirmed = false; line.reviewed = false;
      if (sourceRow.kit) { const kit = typeof sourceRow.kit === 'string' ? JSON.parse(sourceRow.kit) : sourceRow.kit; line.kit = prepareKit(kit.components); }
      return line;
    });
    return { lines, warnings };
  }
  function fingerprint(line) {
    return [normalize(line.description), text(line.supplierCode).trim(), text(line.expectedQuantity), normalize(line.unit), text(line.unitCost)].join('|');
  }
  function prepareImportProposal(lines, existingLines = [], qualitySource = null) {
    const prepared = Array.isArray(lines) && lines.length ? prepareImport(lines) : { lines: [], warnings: [] };
    const needsReview = (quality) => ['unusable', 'review_required'].includes(quality?.status);
    const pages = Array.isArray(qualitySource?.pages) ? qualitySource.pages : [];
    const uncertainPages = pages.filter((page) => needsReview(page.quality));
    const existing = new Set(existingLines.map(fingerprint)), seen = new Set();
    const proposal = prepared.lines.map((line) => {
      const sourcePage = line.sourcePhotoId ? pages.find((page) => text(page.photoId) === line.sourcePhotoId) :
        line.sourcePage ? pages.find((page, index) => text(page.sourcePage || page.pageNumber || page.page || index + 1) === line.sourcePage) : null;
      const requiresManualReview = line.requiresManualReview || needsReview(qualitySource?.quality) ||
        (sourcePage ? needsReview(sourcePage.quality) : uncertainPages.length > 0);
      const key = fingerprint(line), duplicate = existing.has(key) || seen.has(key); seen.add(key);
      return { line: { ...line, requiresManualReview }, duplicate, requiresManualReview, selected: !duplicate && !requiresManualReview };
    });
    return {
      proposal, warnings: prepared.warnings,
      hasUnusablePages: qualitySource?.quality?.status === 'unusable' || pages.some((page) => page.quality?.status === 'unusable'),
      needsManualReview: needsReview(qualitySource?.quality) || uncertainPages.length > 0 || proposal.some((row) => row.requiresManualReview),
    };
  }
  function importSelectionState(proposal, reviewConfirmed) {
    const selected = (proposal || []).filter((row) => row.selected);
    const needsReview = selected.some((row) => row.requiresManualReview);
    return { count: selected.length, needsReview, canApply: selected.length > 0 && (!needsReview || reviewConfirmed === true) };
  }
  const chatGptReceivingPrompt = `Transcreva os produtos das fotos deste romaneio para eu importar no meu sistema de recebimento. Responda somente com JSON válido, sem Markdown e sem texto antes ou depois.

Regras:
- Leia as fotos originais. Se houver duas fotos da mesma página, use apenas uma ocorrência dessa página; não duplique os produtos. Fotos de páginas diferentes são complementares.
- Copie os nomes como aparecem. Não invente produtos, não complete nomes por semelhança e não tente identificar o cadastro da loja.
- Preserve os códigos do fornecedor como texto, incluindo zeros à esquerda. Eles não são códigos de barras nem EAN.
- Não deduza preços, quantidades ou códigos. Campo ausente ou ilegível deve ser null. Se nem a descrição puder ser lida, omita a linha e indique isso em warnings na raiz, citando a página/item quando possível.
- Use números JSON para quantidade e valor unitário, com ponto decimal e sem separador de milhar. Preserve a unidade do documento. Uma embalagem C/30 não transforma automaticamente a quantidade em 30 unidades.
- Não transforme totais, parcelas, boletos, peso ou volumes em produtos.
- sourcePage e sourceItem são textos com a página e o item originais, ou null quando não estiverem legíveis.
- Em warnings de cada linha, descreva dúvidas ou campos ilegíveis. Use requiresManualReview: true em todas as linhas. Não atribua produtos do catálogo nem quantidades recebidas.

Formato obrigatório (o objeto abaixo descreve os campos, não é um produto para copiar):
{
  "lines": [
    {
      "description": "descrição lida na foto",
      "supplierCode": null,
      "expectedQuantity": null,
      "unit": null,
      "unitCost": null,
      "sourcePage": null,
      "sourceItem": null,
      "warnings": [],
      "requiresManualReview": true
    }
  ],
  "warnings": []
}

Preencha lines somente com produtos efetivamente legíveis nas fotos. Não use os valores explicativos do modelo como dados.`;
  function parseChatGptResponse(source) {
    let input = text(source);
    if (new TextEncoder().encode(input).length > 5 * 1024 * 1024) throw new Error('A resposta excede 5 MB. Divida o documento em partes menores.');
    input = input.trim().replace(/^\uFEFF/, '');
    if (!input) throw new Error('Cole o JSON que recebeu na conversa antes de conferir as linhas.');
    const fenced = input.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    if (fenced) input = fenced[1].trim();
    let parsed;
    try { parsed = JSON.parse(input); }
    catch (_) { throw new Error('Não foi possível ler o JSON. Cole a resposta completa, sem comentários antes ou depois.'); }
    const prepared = prepareImport(JSON.stringify(parsed), 'json');
    return { ...prepared, lines: prepared.lines.map((line) => ({ ...line, requiresManualReview: true })),
      warnings: [...(Array.isArray(parsed.warnings) ? parsed.warnings.map(text) : []), ...prepared.warnings] };
  }
  function assertImportReceipt(receiptId, receipt) {
    if (!receiptId || text(receipt?._id) !== text(receiptId)) throw new Error('O recebimento aberto mudou. Volte ao recebimento original e prepare a importação novamente.');
    if (receipt.status !== 'draft') throw new Error('Este recebimento já foi encerrado. Abra um recebimento em conferência para importar linhas.');
  }
  function csvCell(value) {
    let cell = text(value);
    if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  function isPermanentReceivingFailure(error) {
    // Authentication, throttling, concurrency and transport failures must remain pending.
    return [400, 403, 404, 409, 410, 413, 422].includes(Number(error?.status)) && error?.code !== 'VERSION_CONFLICT';
  }
  async function transmitReceivingEvents(events, send) {
    const result = { acknowledged: [], rejected: [], responses: [], error: null };
    const acknowledged = new Set();
    const recordResponse = (response, attempted) => {
      const allowed = new Set(attempted.map((event) => event.eventId));
      for (const id of response.acknowledged || []) if (allowed.has(id)) acknowledged.add(id);
      result.responses.push(response);
    };
    const recordRejection = (event, error) => result.rejected.push({ eventId: event.eventId, status: error.status, code: error.code || '', message: error.message || 'Leitura recusada pelo servidor.' });
    try { recordResponse(await send(events), events); }
    catch (error) {
      if (!isPermanentReceivingFailure(error)) result.error = error;
      else if (events.length === 1) recordRejection(events[0], error);
      else {
        // The endpoint rejects a whole batch if one event is invalid. Reuse every UUID
        // while isolating the failure; a previously accepted event remains idempotent.
        for (const event of events) {
          try { recordResponse(await send([event]), [event]); }
          catch (singleError) {
            if (isPermanentReceivingFailure(singleError)) recordRejection(event, singleError);
            else { result.error = singleError; break; }
          }
        }
      }
    }
    result.acknowledged = [...acknowledged];
    return result;
  }
  const helpers = { parseCsv, prepareImport, prepareImportProposal, importSelectionState, parseChatGptResponse, assertImportReceipt, chatGptReceivingPrompt, fingerprint, csvCell, number, isPermanentReceivingFailure, transmitReceivingEvents, isKit, prepareKit, kitPieces, kitFormula, kitIssues, stockProjection, prepareScan, catalogIssues };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;
  root.ReceivingImport = helpers;
  const $ = (id) => document.getElementById(id);
  if (!$('receiving-app')) return;
  const base = `${typeof API_CONFIG !== 'undefined' ? API_CONFIG.BASE_URL : '/api'}`.replace(/\/$/, '') + '/receiving';
  const numericFields = new Set(['expectedQuantity', 'receivedQuantity', 'stockFactor', 'unitCost']);
  const labels = { description: 'descrição', supplierCode: 'código do fornecedor', expectedQuantity: 'quantidade esperada', receivedQuantity: 'quantidade recebida', unit: 'unidade', unitCost: 'custo', productId: 'produto', barcode: 'código de barras', stockFactor: 'conversão', conversionConfirmed: 'conversão conferida', reviewed: 'revisão', reference: 'referência', companyId: 'loja', depositId: 'depósito', supplierId: 'fornecedor', testMode: 'modo de teste', notes: 'observações' };
  const state = {
    meta: { companies: [], deposits: [], suppliers: [] }, receipts: [], receipt: null, baseline: null,
    products: null, productIndex: null, productPromise: null, productLineId: null, dirty: new Map(), headerDirty: new Set(),
    deleted: new Set(), conflicts: new Map(), photos: [], photoId: null, photoUrl: null, photoRotation: 0,
    capabilities: null, proposal: null, refreshing: false, saving: false, sending: false, extracting: false,
    online: navigator.onLine, lastSync: null, noticeTimer: null, recovering: false, queue: [],
    extraction: null, extractionJobs: new Map(), reviewVersion: null, lastPhotoSync: 0,
    importReceiptId: null, chatGptReceiptId: null, kitEditor: null, productComponentId: null,
  };
  function user() { try { return JSON.parse(localStorage.getItem('loggedInUser') || '{}'); } catch (_) { return {}; } }
  const token = () => user().token || '';
  function accountKey() {
    const current = user();
    let subject = current._id || current.id || current.user?._id || current.email;
    if (!subject && current.token) { try { const payload = JSON.parse(atob(current.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); subject = payload.id || payload.userId || payload.sub; } catch (_) { /* no stable account identity */ } }
    return subject ? text(subject) : null;
  }
  const storagePrefix = accountKey() ? `receiving:${accountKey()}:` : null;
  const fmt = (value) => value == null || value === '' ? '—' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const date = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const nameOf = (entity) => entity?.nomeFantasia || entity?.nome || entity?.fantasyName || entity?.legalName || entity?.razaoSocial || entity?.name || 'Sem nome';
  const isClosed = () => !!state.receipt && ['approved', 'test_approved', 'cancelled'].includes(state.receipt.status);
  const hasDirty = () => !!(state.dirty.size || state.headerDirty.size || state.deleted.size);
  const lineById = (id) => state.receipt?.lines?.find((line) => text(line.id) === text(id));
  const queuedEntries = () => state.queue.filter((item) => !item.status || item.status === 'pending');
  const pendingQueue = () => queuedEntries().filter((item) => item.receiptId === state.receipt?._id);
  const rejectedQueue = () => state.queue.filter((item) => item.receiptId === state.receipt?._id && item.status === 'rejected');
  function notify(message, kind = 'success', persistent = false) {
    clearTimeout(state.noticeTimer); const node = $('receiving-notice');
    node.textContent = message; node.className = kind === 'success' ? '' : `is-${kind}`; node.hidden = false;
    if (!persistent) state.noticeTimer = setTimeout(() => { node.hidden = true; }, 9000);
  }
  function connection(ok) {
    state.online = ok;
    $('connection-state').classList.toggle('is-offline', !ok);
    $('connection-state').innerHTML = `<span></span>${ok ? 'Conectado' : 'Sem conexão'}`;
  }
  async function api(path, options = {}) {
    if (!token()) throw new Error('Sua sessão não está autenticada. Entre novamente no sistema.');
    const headers = { Authorization: `Bearer ${token()}`, ...(options.headers || {}) };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 35000);
    const config = { ...options, headers, signal: controller.signal };
    delete config.timeout;
    if (config.body && !(config.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(config.body); }
    try {
      const response = await fetch(base + path, config);
      connection(true);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.message || data.error || `Não foi possível concluir a solicitação (${response.status}).`);
        error.status = response.status; error.code = data.code; error.data = data; throw error;
      }
      return data;
    } catch (error) {
      if (!error.status) connection(false);
      if (error.name === 'AbortError') throw new Error('A solicitação demorou mais que o esperado. Confira a conexão e tente novamente.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function action(button, callback) {
    const previous = button?.disabled;
    if (button) button.disabled = true;
    try { return await callback(); } catch (error) { notify(error.message || 'Não foi possível concluir esta ação.', 'error', true); return null; }
    finally { if (button) button.disabled = previous || false; updateSaveState(); }
  }
  function showDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
  function statusBadge(receipt) {
    const item = ({ draft: ['Em conferência', 'amber'], approved: ['Entrada concluída', 'green'], test_approved: ['Teste concluído', 'blue'], cancelled: ['Cancelado', 'red'] })[receipt.status] || [receipt.status || 'Rascunho', 'amber'];
    return `<span class="rr-badge is-${item[1]}">${escape(item[0])}</span>`;
  }
  function setOptions(element, rows, empty, selected) {
    element.innerHTML = `<option value="">${escape(empty)}</option>` + rows.map((row) => `<option value="${escape(idOf(row))}">${escape(nameOf(row))}</option>`).join('');
    element.value = idOf(selected);
    if (selected && !element.value) { const option = new Option('Cadastro vinculado (não disponível na lista)', idOf(selected)); element.add(option); element.value = idOf(selected); }
  }
  function depositOptions(prefix, selected) {
    const companyId = $(`${prefix}-company`).value;
    const deposits = state.meta.deposits.filter((deposit) => !companyId || idOf(deposit.empresa || deposit.companyId) === companyId);
    setOptions($(`${prefix}-deposit`), deposits, 'Selecione o depósito', selected);
  }
  function metadataOptions(prefix, receipt = {}) {
    setOptions($(`${prefix}-company`), state.meta.companies, 'Selecione a loja', receipt.companyId);
    depositOptions(prefix, receipt.depositId);
    setOptions($(`${prefix}-supplier`), state.meta.suppliers, 'Selecionar fornecedor', receipt.supplierId);
  }
  async function loadList() {
    const result = await api('/receipts'); state.receipts = result.receipts || [];
    renderList();
  }
  function renderList() {
    const query = normalize($('receipt-search').value), status = $('receipt-status-filter').value;
    const rows = state.receipts.filter((receipt) => (!status || receipt.status === status) && normalize([receipt.code, receipt.reference, receipt.supplierName, receipt.companyName].join(' ')).includes(query));
    $('receipt-list-count').textContent = `${rows.length} recebimento${rows.length === 1 ? '' : 's'}${status || query ? ' neste filtro' : ''}`;
    $('receipts-list').innerHTML = rows.length ? rows.map((receipt) => {
      const supplier = state.meta.suppliers.find((row) => idOf(row) === idOf(receipt.supplierId));
      const company = state.meta.companies.find((row) => idOf(row) === idOf(receipt.companyId));
      return `<button class="rr-receipt-row" data-open-receipt="${escape(receipt._id)}"><div><h3>${escape(receipt.code || 'Recebimento')}</h3><p>${escape(receipt.reference || 'Sem referência')}</p></div><div><h3>${escape(receipt.supplierName || (supplier && nameOf(supplier)) || 'Fornecedor não informado')}</h3><p>${escape(receipt.companyName || (company && nameOf(company)) || 'Loja vinculada')}</p></div><div>${statusBadge(receipt)} ${receipt.testMode ? '<span class="rr-badge is-blue">Teste</span>' : ''}<p>${date(receipt.updatedAt || receipt.createdAt)}</p></div><i class="fas fa-arrow-right" aria-hidden="true"></i></button>`;
    }).join('') : '<div class="rr-empty"><i class="fas fa-box-open" aria-hidden="true"></i><h3>Nenhum recebimento por aqui</h3><p>Crie um recebimento para preparar o documento e conferir a mercadoria.</p></div>';
  }
  function persistDraft() {
    if (!storagePrefix || !state.receipt) return;
    const key = storagePrefix + 'draft:' + state.receipt._id;
    try {
      if (!hasDirty()) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify({ receipt: state.receipt, baseline: state.baseline, dirty: [...state.dirty].map(([id, fields]) => [id, [...fields]]), headers: [...state.headerDirty], deleted: [...state.deleted] }));
    } catch (_) { notify('O navegador não conseguiu guardar a cópia temporária. Salve as alterações antes de fechar a página.', 'warning', true); }
  }
  function markLine(id, field, value) {
    const line = lineById(id); if (!line || isClosed()) return;
    line[field] = value;
    if (!state.dirty.has(id)) state.dirty.set(id, new Set());
    state.dirty.get(id).add(field);
    if (!['reviewed', 'conversionConfirmed'].includes(field)) { line.reviewed = false; state.dirty.get(id).add('reviewed'); }
    if (['unit', 'stockFactor', 'productId', 'kit'].includes(field)) { line.conversionConfirmed = false; state.dirty.get(id).add('conversionConfirmed'); }
    state.conflicts.delete(`${id}:${field}`); persistDraft(); renderStats(); updateSaveState();
  }
  function markHeader(field, value) {
    if (!state.receipt || isClosed()) return;
    state.receipt[field] = value; state.headerDirty.add(field); state.conflicts.delete(`header:${field}`); persistDraft(); updateSaveState();
  }
  function mergeRemote(remote) {
    if (!state.receipt || state.receipt._id !== remote._id) return;
    // A slow poll must not replace a newer response from a scan or save.
    if (Number(remote.version) < Number(state.baseline?.version || 0)) return;
    const baseReceipt = state.baseline || state.receipt;
    const local = state.receipt;
    const merged = clone(remote); merged.lines = merged.lines || [];
    for (const field of state.headerDirty) {
      if (!same(baseReceipt[field], remote[field]) && !same(local[field], remote[field])) state.conflicts.set(`header:${field}`, { scope: 'header', field, local: local[field], remote: remote[field] });
      merged[field] = local[field];
    }
    for (const [id, fields] of state.dirty) {
      const localLine = local.lines.find((line) => text(line.id) === id);
      if (!localLine) continue;
      const baseLine = baseReceipt.lines?.find((line) => text(line.id) === id);
      const remoteLine = remote.lines?.find((line) => text(line.id) === id);
      if (!remoteLine) {
        if (baseLine) state.conflicts.set(`${id}:deleted`, { scope: id, field: 'deleted', local: localLine.description, remote: 'Linha removida no servidor' });
        merged.lines.push(clone(localLine)); continue;
      }
      const target = merged.lines.find((line) => text(line.id) === id);
      for (const field of fields) {
        if (baseLine && !same(baseLine[field], remoteLine[field]) && !same(localLine[field], remoteLine[field])) state.conflicts.set(`${id}:${field}`, { scope: id, field, local: localLine[field], remote: remoteLine[field] });
        target[field] = localLine[field];
      }
      if (baseLine && !same(baseLine.receivedQuantity, remoteLine.receivedQuantity)) {
        target.reviewed = false; fields.add('reviewed');
      }
    }
    for (const id of state.deleted) {
      const baseLine = baseReceipt.lines?.find((line) => text(line.id) === id), remoteLine = remote.lines?.find((line) => text(line.id) === id);
      if (remoteLine && baseLine && !same(baseLine, remoteLine)) state.conflicts.set(`${id}:remove`, { scope: id, field: 'remove', local: 'Remover linha', remote: 'Linha atualizada no servidor' });
    }
    merged.lines = merged.lines.filter((line) => !state.deleted.has(text(line.id)));
    state.baseline = clone(remote); state.receipt = merged; state.lastSync = new Date();
    persistDraft();
  }
  async function openReceipt(id) {
    if (hasDirty()) persistDraft();
    const result = await api(`/receipts/${encodeURIComponent(id)}`);
    state.receipt = result.receipt; state.receipt.lines = state.receipt.lines || []; state.baseline = clone(state.receipt);
    state.dirty.clear(); state.headerDirty.clear(); state.deleted.clear(); state.conflicts.clear(); state.photos = []; state.photoId = null;
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl); state.photoUrl = null;
    $('photo-viewport').innerHTML = '<div class="rr-empty"><i class="fas fa-camera" aria-hidden="true"></i><h3>O papel fica aqui</h3><p>Anexe fotos nítidas de todas as páginas para comparar com a conferência.</p></div>';
    $('photo-tools').hidden = true; $('photo-thumbnails').innerHTML = '';
    $('scan-feedback').textContent = 'Cada leitura é guardada com um identificador único.';
    if (storagePrefix) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storagePrefix + 'draft:' + id) || 'null');
        if (saved && !isClosed()) {
          state.receipt = saved.receipt; state.baseline = saved.baseline;
          state.dirty = new Map(saved.dirty.map(([lineId, fields]) => [lineId, new Set(fields)]));
          state.headerDirty = new Set(saved.headers); state.deleted = new Set(saved.deleted);
          mergeRemote(result.receipt); notify('Suas alterações locais foram recuperadas. Confira e salve para enviá-las ao servidor.', 'warning', true);
        }
      } catch (_) { /* Invalid old drafts never replace server data. */ state.receipt = result.receipt; state.baseline = clone(result.receipt); state.dirty.clear(); state.headerDirty.clear(); state.deleted.clear(); }
    }
    $('receipt-list-view').hidden = true; $('receipt-detail-view').hidden = false;
    const url = new URL(location.href); url.searchParams.set('id', id); history.replaceState({}, '', url);
    renderDetail(); await Promise.all([
      loadPhotos().catch((error) => notify(error.message, 'warning')),
      loadProducts().then(() => renderDetail()).catch((error) => notify(error.message, 'warning')),
    ]);
    if (storagePrefix) {
      const jobId = sessionStorage.getItem(storagePrefix + 'ocr:' + id);
      if (jobId && !state.extractionJobs.has(id)) pollExtraction(id, jobId).catch((error) => notify(error.message, 'warning', true));
    }
    flushQueue();
  }
  async function refreshReceipt() {
    if (!state.receipt || state.refreshing || state.saving) return;
    const id = state.receipt._id; state.refreshing = true;
    try {
      const result = await api(`/receipts/${encodeURIComponent(id)}`);
      if (state.receipt?._id !== id) return;
      mergeRemote(result.receipt); renderDetail();
    } finally { state.refreshing = false; }
  }
  function lineIssues(line) {
    const issues = catalogIssues(line, state.productIndex);
    if (isKit(line)) issues.push(...kitIssues(line));
    else if (!line.productId) issues.push('Sem produto');
    if (!line.conversionConfirmed) issues.push(isKit(line) ? 'Composição' : 'Conversão');
    if (!line.reviewed) issues.push('Revisão');
    if (line.stockFactor == null || !Number.isFinite(Number(line.stockFactor)) || Number(line.stockFactor) <= 0) issues.push('Fator inválido');
    if (line.receivedQuantity == null || !Number.isFinite(Number(line.receivedQuantity)) || Number(line.receivedQuantity) < 0) issues.push('Quantidade inválida');
    if (line.expectedQuantity != null && (!Number.isFinite(Number(line.expectedQuantity)) || Number(line.expectedQuantity) < 0)) issues.push('Quantidade prevista inválida');
    return issues;
  }
  const hasDifference = (line) => line.expectedQuantity != null && Math.abs(Number(line.expectedQuantity) - Number(line.receivedQuantity || 0)) > 0.00001;
  function renderStats() {
    if (!state.receipt) return;
    const lines = state.receipt.lines || [];
    const stats = [
      ['fa-list-check', lines.length, 'Linhas no recebimento'],
      ['fa-box-open', lines.filter((line) => isKit(line) ? line.kit.components.every((part) => part.productId) : !!line.productId).length, 'Linhas identificadas'],
      ['fa-triangle-exclamation', lines.filter((line) => lineIssues(line).length).length, 'Linhas com pendências'],
      ['fa-arrows-left-right', lines.filter(hasDifference).length, 'Faltas ou sobras'],
    ];
    $('receipt-stats').innerHTML = stats.map(([icon, value, label]) => `<div class="rr-stat"><i class="fas ${icon}" aria-hidden="true"></i><div><strong>${fmt(value)}</strong><span>${label}</span></div></div>`).join('');
  }
  function renderConflicts() {
    const container = $('receipt-conflicts'); container.hidden = !state.conflicts.size;
    container.innerHTML = '<strong>Há alterações simultâneas para conferir.</strong> Suas edições foram preservadas. Escolha o valor correto antes de salvar.' + [...state.conflicts].map(([key, conflict]) => `<div class="rr-conflict-row"><span><strong>${escape(conflict.scope === 'header' ? 'Dados' : lineById(conflict.scope)?.description || 'Linha')}</strong> · ${escape(labels[conflict.field] || conflict.field)}<br>Seu valor: ${escape(conflict.local)} · Servidor: ${escape(conflict.remote)}</span><button class="rr-button rr-small" data-conflict="${escape(key)}" data-choice="local">Manter meu valor</button><button class="rr-button rr-small" data-conflict="${escape(key)}" data-choice="remote">Usar servidor</button></div>`).join('');
  }
  function renderDetail() {
    const receipt = state.receipt; if (!receipt) return;
    $('receipt-code').textContent = receipt.code || 'RECEBIMENTO';
    const supplier = state.meta.suppliers.find((row) => idOf(row) === idOf(receipt.supplierId));
    const company = state.meta.companies.find((row) => idOf(row) === idOf(receipt.companyId));
    const deposit = state.meta.deposits.find((row) => idOf(row) === idOf(receipt.depositId));
    $('receipt-title').textContent = receipt.supplierName || (supplier && nameOf(supplier)) || receipt.reference || 'Conferência de mercadoria';
    $('receipt-status').outerHTML = statusBadge(receipt).replace('<span ', '<span id="receipt-status" ');
    $('receipt-mode').textContent = receipt.testMode ? 'Teste · sem movimentação' : 'Entrada real';
    $('receipt-mode').className = `rr-badge ${receipt.testMode ? 'is-blue' : 'is-amber'}`;
    $('receipt-metadata-summary').textContent = [company && nameOf(company), deposit && nameOf(deposit), receipt.reference].filter(Boolean).join(' · ');
    if (!document.activeElement?.matches('[data-header-field]')) {
      metadataOptions('detail', receipt); $('detail-reference').value = receipt.reference || ''; $('detail-notes').value = receipt.notes || ''; $('detail-test-mode').checked = receipt.testMode !== false;
    }
    document.querySelectorAll('[data-header-field]').forEach((node) => { node.disabled = isClosed(); });
    const selected = $('scan-line').value;
    $('scan-line').innerHTML = '<option value="">Identificar automaticamente</option>' + receipt.lines.map((line, index) => `<option value="${escape(line.id)}">${index + 1}. ${escape(line.description || line.productName || line.barcode || 'Sem descrição')}</option>`).join('');
    $('scan-line').value = selected;
    renderScanOptions();
    renderStats(); renderLines(); renderEvents(); renderConflicts(); updateSaveState();
    ['add-line', 'scan-barcode', 'scan-quantity', 'scan-mode', 'scan-line', 'photo-upload', 'lines-import', 'prepare-chatgpt'].forEach((id) => { $(id).disabled = isClosed(); });
    $('scan-form').querySelector('button').disabled = isClosed();
    renderScanOptions();
    renderOcrStatus();
  }
  function renderLines() {
    if (!state.receipt) return;
    const active = document.activeElement;
    const focus = active?.dataset.lineField ? { id: active.closest('[data-line-id]')?.dataset.lineId, field: active.dataset.lineField, start: active.selectionStart, end: active.selectionEnd } : null;
    const query = normalize($('line-search').value), filter = $('line-filter').value;
    const rows = state.receipt.lines.map((line, index) => ({ line, index })).filter(({ line }) => {
      if (!normalize([line.description, line.productName, line.supplierCode, line.barcode, ...(line.kit?.components || []).flatMap((part) => [part.label, part.productName, part.barcode])].join(' ')).includes(query)) return false;
      return filter === 'all' || (filter === 'pending' && lineIssues(line).length) || (filter === 'unknown' && (isKit(line) ? line.kit.components.some((part) => !part.productId) : !line.productId)) || (filter === 'difference' && hasDifference(line)) || (filter === 'conversion' && !line.conversionConfirmed) || (filter === 'ready' && !lineIssues(line).length);
    });
    const disabled = isClosed() ? ' disabled' : '';
    const input = (line, field, label, type = 'text') => `<label>${label}<input data-line-field="${field}" type="${type}" value="${escape(line[field] ?? '')}"${type === 'number' ? ` min="${field === 'stockFactor' ? '0.000001' : '0'}" step="${isKit(line) && field === 'receivedQuantity' ? '1' : 'any'}"` : ''}${disabled}></label>`;
    $('receipt-lines').innerHTML = rows.length ? rows.map(({ line, index }) => {
      const diff = Number(line.receivedQuantity || 0) - Number(line.expectedQuantity || 0);
      const difference = hasDifference(line) ? `<span class="rr-badge is-amber">${diff > 0 ? 'Sobra' : 'Falta'}: ${fmt(Math.abs(diff))}</span>` : '';
      if (isKit(line)) {
        const linked = line.kit.components.every((part) => part.productId && part.barcode);
        const catalogPending = catalogIssues(line, state.productIndex).join(', ');
        return `<article class="rr-line rr-kit-line${state.dirty.has(text(line.id)) ? ' is-dirty' : ''}" data-line-id="${escape(line.id)}"><div class="rr-line-header"><span class="rr-line-number">${String(index + 1).padStart(2, '0')}</span><div class="rr-line-description"><input aria-label="Descrição original da linha ${index + 1}" data-line-field="description" value="${escape(line.description)}"${disabled}><div class="rr-line-tags"><span class="rr-badge is-blue">Kit · ${fmt(kitPieces(line))} peças</span><span class="rr-badge ${linked && !catalogPending ? 'is-green' : 'is-amber'}">${linked ? (catalogPending || 'Peças identificadas') : 'Identificar peças'}</span>${difference}</div></div><button class="rr-icon-button" data-delete-line="${escape(line.id)}" aria-label="Remover linha ${index + 1}"${disabled}><i class="fas fa-trash-can" aria-hidden="true"></i></button></div><div class="rr-kit-summary"><div><strong>1 kit = ${escape(kitFormula(line))}</strong><p>Confira a composição deste recebimento.</p></div><button class="rr-button rr-small" data-kit-line="${escape(line.id)}"${disabled}>Editar composição</button></div><div class="rr-line-fields rr-kit-fields">${input(line, 'supplierCode', 'Código fornecedor')}${input(line, 'expectedQuantity', 'Kits esperados', 'number')}${input(line, 'receivedQuantity', 'Kits recebidos', 'number')}${input(line, 'unitCost', 'Custo de 1 kit (R$)', 'number')}</div><div class="rr-kit-parts">${line.kit.components.map((part) => `<div class="rr-kit-part"><b>${escape(part.label)} <span>× ${fmt(part.quantityPerKit)}</span></b><div><strong>${escape(part.productName || 'Sem cadastro vinculado')}</strong><span>${escape(part.barcode || 'Sem código de barras')} · ${fmt(Number(line.receivedQuantity || 0) * part.quantityPerKit)} un. para estoque</span></div><button class="rr-button rr-small" data-identify-kit="${escape(line.id)}" data-component-id="${escape(part.id)}"${disabled}>Bipar ${escape(part.label)}</button></div>`).join('')}</div><div class="rr-line-review"><label class="rr-check"><input type="checkbox" data-line-field="conversionConfirmed"${line.conversionConfirmed ? ' checked' : ''}${disabled}> Conferi a composição</label><label class="rr-check"><input type="checkbox" data-line-field="reviewed"${line.reviewed ? ' checked' : ''}${disabled}> Linha revisada</label><button class="rr-button rr-small" data-count-kit="${escape(line.id)}"${disabled}>Contar kits completos</button></div><p class="rr-kit-cost-note">O custo é do kit inteiro. A entrada distribui as peças; não rateia custo nem muda preços dos cadastros.</p></article>`;
      }
      return `<article class="rr-line${state.dirty.has(text(line.id)) ? ' is-dirty' : ''}" data-line-id="${escape(line.id)}"><div class="rr-line-header"><span class="rr-line-number">${String(index + 1).padStart(2, '0')}</span><div class="rr-line-description"><input aria-label="Descrição original da linha ${index + 1}" data-line-field="description" value="${escape(line.description || '')}" placeholder="Descrição original do documento"${disabled}><div class="rr-line-tags">${line.productId ? (catalogIssues(line, state.productIndex).length ? `<span class="rr-badge is-amber">Vinculado · ${escape(catalogIssues(line, state.productIndex).join(', '))}</span>` : '<span class="rr-badge is-green">Identificado</span>') : '<span class="rr-badge is-amber">Sem produto vinculado</span>'}${difference}${!lineIssues(line).length ? '<span class="rr-badge is-green">Revisado</span>' : ''}${line.sourcePage ? `<span class="rr-badge">Pág. ${escape(line.sourcePage)}</span>` : ''}</div></div><button class="rr-icon-button" data-delete-line="${escape(line.id)}" aria-label="Remover linha ${index + 1}"${disabled}><i class="fas fa-trash-can" aria-hidden="true"></i></button></div><div class="rr-line-fields">${input(line, 'supplierCode', 'Código fornecedor')}${input(line, 'barcode', 'Código de barras')}${input(line, 'unit', 'Unidade recebida')}${input(line, 'expectedQuantity', 'Esperado', 'number')}${input(line, 'receivedQuantity', 'Recebido', 'number')}</div><div class="rr-line-product"><i class="fas ${line.productId ? 'fa-box' : 'fa-link'}" aria-hidden="true"></i><div><strong>${escape(line.productName || 'Selecione o produto do catálogo')}</strong><p>${line.productId ? (catalogIssues(line, state.productIndex).includes('Cadastro inativo') ? 'Vínculo salvo. Conclua e ative o cadastro antes de confirmar a entrada.' : 'Vínculo com o cadastro existente') : 'O código desconhecido fica guardado até você identificar o produto.'}</p></div><button class="rr-button rr-small" data-match-line="${escape(line.id)}"${disabled}>${line.productId ? 'Trocar produto' : 'Vincular produto'}</button>${line.productId ? `<button class="rr-button rr-small" data-unlink-line="${escape(line.id)}" aria-label="Desvincular produto"${disabled}><i class="fas fa-link-slash" aria-hidden="true"></i></button>` : ''}</div><div class="rr-line-fields rr-line-secondary">${input(line, 'stockFactor', 'Unidades de estoque por unidade recebida', 'number')}${input(line, 'unitCost', 'Custo por unidade recebida (R$)', 'number')}</div><div class="rr-line-review"><label class="rr-check"><input type="checkbox" data-line-field="conversionConfirmed"${line.conversionConfirmed ? ' checked' : ''}${disabled}> Conferi a conversão</label><label class="rr-check"><input type="checkbox" data-line-field="reviewed"${line.reviewed ? ' checked' : ''}${disabled}> Linha revisada</label><span>${fmt(Number(line.receivedQuantity || 0) * Number(line.stockFactor || 0))} un. para o estoque</span></div></article>`;
    }).join('') : `<div class="rr-line-placeholder">${state.receipt.lines.length ? 'Nenhum item corresponde a este filtro.' : '<i class="fas fa-barcode" aria-hidden="true"></i><br>As linhas aparecerão aqui.<br>Prepare uma foto, importe uma planilha ou comece a bipar.'}</div>`;
    if (focus) {
      const node = [...document.querySelectorAll('[data-line-id]')].find((el) => el.dataset.lineId === focus.id)?.querySelector(`[data-line-field="${focus.field}"]`);
      if (node) { node.focus({ preventScroll: true }); if (focus.start != null && ['text', 'search'].includes(node.type)) node.setSelectionRange(focus.start, focus.end); }
    }
    for (const { line } of rows) {
      if (!line.warnings?.length) continue;
      const article = [...$('receipt-lines').querySelectorAll('[data-line-id]')].find((node) => node.dataset.lineId === text(line.id));
      if (!article) continue;
      const warning = document.createElement('p'); warning.className = 'rr-line-warnings'; warning.textContent = line.warnings.join(' · ');
      article.querySelector('.rr-line-header').insertAdjacentElement('afterend', warning);
    }
    if (state.meta.capabilities?.kit === true) for (const { line } of rows) {
      if (isKit(line)) continue;
      const article = [...$('receipt-lines').querySelectorAll('[data-line-id]')].find((node) => node.dataset.lineId === text(line.id));
      const button = document.createElement('button'); button.className = 'rr-button rr-small rr-kit-configure'; button.dataset.kitLine = line.id; button.disabled = isClosed();
      button.textContent = /^(KT|KIT)$/i.test(line.unit || '') || /\bKIT\b/i.test(line.description || '') ? 'Configurar peças deste kit' : 'Separar em peças (kit)';
      article?.querySelector('.rr-line-product').insertAdjacentElement('beforebegin', button);
    }
  }
  function renderEvents() {
    const events = state.receipt?.events || [];
    $('events-count').textContent = `${events.length} registro${events.length === 1 ? '' : 's'}`;
    const undone = new Set(events.map((event) => event.undoOf).filter(Boolean));
    $('receipt-events').innerHTML = events.length ? events.slice().reverse().slice(0, 100).map((event) => {
      const id = event.eventId || event.id;
      const status = event.undoOf ? 'Leitura desfeita' : undone.has(id) || event.undoneBy ? 'Desfeito' : event.status === 'conflict' ? 'Conflito · conferir código' : event.status === 'unknown' ? 'Produto não identificado' : event.mode === 'identify' ? 'Identificação' : event.mode === 'adjust' ? 'Ajuste manual' : event.mode === 'kit_count' ? 'Kits completos registrados' : 'Leitura registrada';
      const canUndo = !isClosed() && id && !event.undoOf && !event.undoneBy && !undone.has(id) && ['count', 'kit_count'].includes(event.mode);
      const component = lineById(event.lineId)?.kit?.components.find((part) => part.id === event.componentId);
      return `<div class="rr-event-row"><span>${date(event.createdAt || event.receivedAt)}</span><div><strong>${escape(event.barcode || event.productName || (event.mode === 'kit_count' ? lineById(event.lineId)?.description || 'Kit' : 'Ajuste'))}</strong> · ${fmt(event.quantity)}${event.mode === 'kit_count' ? ' kit(s)' : ''}<br><span class="rr-muted">${escape(status)}${component ? ' · ' + escape(component.label) : ''}</span></div>${canUndo ? `<button class="rr-button rr-small" data-undo-event="${escape(id)}">Desfazer</button>` : '<span></span>'}</div>`;
    }).join('') : '<p class="rr-line-placeholder">Nenhuma leitura registrada ainda.</p>';
  }
  function updateSaveState() {
    if (!state.receipt) return;
    const queue = pendingQueue(), rejected = rejectedQueue();
    $('save-status').textContent = isClosed() ? 'Recebimento concluído' : state.saving ? 'Salvando…' : state.conflicts.size ? 'Conflitos para conferir' : hasDirty() ? 'Alterações ainda não salvas' : 'Tudo salvo no servidor';
    $('save-hint').textContent = rejected.length ? `${rejected.length} leitura(s) rejeitada(s). Resolva ou descarte a tentativa antes de concluir.` : queue.length ? `${queue.length} leitura(s) aguardando envio.` : state.receipt.testMode ? 'Modo de teste: a conclusão não movimenta estoque.' : 'Entrada real: o estoque será movimentado somente na conclusão.';
    $('save-receipt').disabled = isClosed() || state.saving || !hasDirty() || !!state.conflicts.size;
    $('review-receipt').disabled = isClosed() || state.saving || !!state.conflicts.size || !!queue.length;
    $('scan-queue-status').textContent = `${queue.length ? `${queue.length} leitura(s) salvas neste navegador, aguardando envio` : 'Sem leituras aguardando envio'}${rejected.length ? ` · ${rejected.length} rejeitada(s) para revisão` : ''}`;
    renderLocalReadHistory();
    $('receipt-sync-status').textContent = state.lastSync ? `Atualizado às ${state.lastSync.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${hasDirty() ? ' · edições preservadas' : ''}` : 'Atualização automática durante a conferência';
    if ($('review-dialog').open && state.reviewVersion !== state.receipt.version) {
      $('approve-receipt').disabled = true;
      $('review-issues').innerHTML = '<div class="rr-review-issues">Chegaram alterações depois que esta revisão foi aberta. Volte à conferência e abra a revisão novamente para confirmar os valores atualizados.</div>';
    }
  }
  function validateLines() {
    for (const line of state.receipt.lines) {
      if (isKit(line)) { prepareKit(line.kit.components); if (!Number.isSafeInteger(Number(line.receivedQuantity || 0))) throw new Error(`Informe kits inteiros em “${line.description}”.`); }
      for (const field of numericFields) {
        const value = line[field];
        if (value != null && (!Number.isFinite(value) || value < 0 || (field === 'stockFactor' && value <= 0))) throw new Error(`Confira ${labels[field]} em “${line.description || line.barcode || 'linha sem descrição'}”.`);
      }
    }
  }
  async function saveReceipt() {
    if (!hasDirty()) return true;
    if (state.saving) throw new Error('Aguarde o salvamento em andamento.');
    if (state.conflicts.size) throw new Error('Resolva os conflitos antes de salvar.');
    const id = state.receipt._id;
    state.saving = true; updateSaveState();
    try {
      const latest = await api(`/receipts/${encodeURIComponent(id)}`);
      if (state.receipt?._id !== id) throw new Error('O recebimento aberto mudou. As edições anteriores continuam guardadas.');
      mergeRemote(latest.receipt); renderConflicts();
      if (state.conflicts.size) throw new Error('Chegaram alterações simultâneas. Confira os valores destacados antes de salvar.');
      if (isClosed()) throw new Error('Este recebimento já foi encerrado em outra sessão. Suas edições locais podem ser exportadas para conferência.');
      validateLines();
      const snapshot = clone(state.receipt), dirty = new Map([...state.dirty].map(([lineId, fields]) => [lineId, new Set(fields)])), headers = new Set(state.headerDirty), deleted = [...state.deleted];
      const body = { version: state.receipt.version, lines: [...dirty.keys()].map((lineId) => clone(lineById(lineId))).filter(Boolean), deleteLineIds: deleted };
      for (const field of headers) body[field] = state.receipt[field];
      const result = await api(`/receipts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      if (state.receipt?._id !== id) return true;
      for (const field of headers) if (same(state.receipt[field], snapshot[field])) state.headerDirty.delete(field);
      for (const [lineId, fields] of dirty) {
        const line = lineById(lineId), sent = snapshot.lines.find((row) => text(row.id) === lineId);
        for (const field of fields) if (same(line?.[field], sent?.[field])) state.dirty.get(lineId)?.delete(field);
        if (!state.dirty.get(lineId)?.size) state.dirty.delete(lineId);
      }
      deleted.forEach((lineId) => state.deleted.delete(lineId));
      mergeRemote(result.receipt); renderDetail(); notify('Alterações salvas.'); return true;
    } catch (error) {
      if (error.status === 409 && error.code === 'VERSION_CONFLICT') { state.saving = false; await refreshReceipt(); error.message = 'O recebimento mudou durante o salvamento. Suas edições foram preservadas; confira os conflitos e salve novamente.'; }
      throw error;
    } finally { state.saving = false; renderDetail(); updateSaveState(); }
  }
  async function loadProducts() {
    if (state.products) return state.products;
    if (state.productPromise) return state.productPromise;
    state.productPromise = api('/catalog').then((result) => {
      state.products = result.products || [];
      state.productIndex = new Map(state.products.map((product) => [idOf(product), product]));
      return state.products;
    }).finally(() => { state.productPromise = null; });
    return state.productPromise;
  }
  function renderProductResults() {
    if (!state.products) { $('product-results').innerHTML = '<p class="rr-line-placeholder">Carregando catálogo…</p>'; return; }
    const query = normalize($('product-search').value);
    if (query.length < 2) { $('product-results').innerHTML = '<p class="rr-line-placeholder">Digite pelo menos dois caracteres para buscar no catálogo.</p>'; return; }
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = state.products.filter((product) => {
      const haystack = normalize([product.nome, product.cod, product.codbarras, ...(product.codigosComplementares || []).map((value) => typeof value === 'object' ? value.codigo || value.codbarras || value.barcode : value)].join(' '));
      return terms.every((term) => haystack.includes(term));
    }).slice(0, 60);
    $('product-results').innerHTML = matches.length ? matches.map((product) => `<button class="rr-product-option" data-select-product="${escape(product._id)}"><i class="fas fa-box" aria-hidden="true"></i><div><strong>${escape(product.nome)}</strong><p>Cód. ${escape(product.cod || '—')} · Barras ${escape(product.codbarras || '—')} · ${escape(product.unidade || 'UN')}</p>${product.inativo ? '<span class="rr-badge is-amber">Inativo · pode vincular à conferência</span>' : ''}</div><i class="fas fa-plus" aria-hidden="true"></i></button>`).join('') : '<p class="rr-line-placeholder">Nenhum cadastro corresponde à busca. Tente outro nome ou código; a linha pode continuar pendente.</p>';
  }
  async function matchLine(id) {
    const line = lineById(id); if (!line) return;
    state.productLineId = id; state.productComponentId = null; $('product-line-label').textContent = `Documento: ${line.description || line.barcode || 'Produto sem descrição'}`;
    $('product-search').value = line.barcode || ''; showDialog('product-dialog'); renderProductResults();
    await loadProducts(); renderProductResults(); $('product-search').focus();
  }
  function assertKitEditor() {
    const editor = state.kitEditor, line = lineById(editor?.lineId);
    if (!editor || state.receipt?._id !== editor.receiptId || !line || isClosed()) throw new Error('O recebimento mudou. Abra a composição novamente.');
    if (!same(line.kit || null, editor.sourceKit)) throw new Error('A composição foi alterada em outra sessão. Feche e abra novamente para conferir.');
    return line;
  }
  const newKitComponent = (label = '') => ({ id: uuid(), label, quantityPerKit: 1, productId: null, productName: '', barcode: '' });
  function openKitEditor(id) {
    const line = lineById(id); if (!line || isClosed()) return;
    state.kitEditor = { receiptId: state.receipt._id, lineId: id, sourceKit: clone(line.kit || null), components: clone(line.kit?.components || [newKitComponent()]) };
    $('kit-line-label').textContent = line.description || 'Kit do recebimento'; $('kit-editor-error').textContent = '';
    $('remove-kit').hidden = !isKit(line); renderKitEditor(); showDialog('kit-dialog');
  }
  function renderKitEditor() {
    const editor = state.kitEditor; if (!editor) return;
    $('kit-components').innerHTML = editor.components.map((part, index) => `<div class="rr-kit-editor-part" data-kit-component="${escape(part.id)}"><div class="rr-kit-editor-fields"><label>Tamanho / peça<input data-kit-field="label" maxlength="80" placeholder="P, G, Tam 1…" value="${escape(part.label)}" aria-label="Tamanho da peça ${index + 1}"></label><label>Peças por kit<input data-kit-field="quantityPerKit" type="number" min="1" step="1" value="${escape(part.quantityPerKit)}" aria-label="Quantidade da peça ${index + 1}"></label><button class="rr-icon-button" data-remove-component="${escape(part.id)}" aria-label="Remover peça ${index + 1}"${editor.components.length === 1 ? ' disabled' : ''}>×</button></div><label class="rr-kit-barcode">Código de barras da peça<input data-kit-field="barcode" maxlength="128" inputmode="numeric" autocomplete="off" value="${escape(part.barcode)}" placeholder="Bipe ou digite o código" aria-label="Código de barras da peça ${index + 1}"></label><div class="rr-kit-editor-link"><span>${escape(part.productName || (part.barcode ? 'O código será consultado ao salvar.' : 'Vincule o cadastro ou identifique pelo código.'))}</span><button class="rr-button rr-small" data-match-component="${escape(part.id)}">${part.productId ? 'Trocar cadastro' : 'Buscar cadastro'}</button>${part.productId ? `<button class="rr-button rr-small" data-unlink-component="${escape(part.id)}" aria-label="Desvincular cadastro de ${escape(part.label)}">×</button>` : ''}</div></div>`).join('');
    $('add-kit-component').disabled = editor.components.length >= 50; renderKitFormula();
  }
  function renderKitFormula() {
    const components = state.kitEditor?.components || [], total = components.reduce((sum, part) => sum + (Number(part.quantityPerKit) || 0), 0);
    $('kit-formula').textContent = `1 kit = ${components.map((part) => `${part.quantityPerKit || '?'} ${part.label || '(tamanho)'}`).join(' + ')} · ${fmt(total)} peças`;
  }
  async function kitAction(button, callback) {
    $('kit-editor-error').textContent = ''; button.disabled = true;
    try { await callback(); } catch (error) { $('kit-editor-error').textContent = error.message; }
    finally { button.disabled = false; }
  }
  async function applyKit(remove = false) {
    const line = assertKitEditor(), receiptId = state.receipt._id;
    const kit = remove ? null : prepareKit(state.kitEditor.components);
    const baselineLine = state.baseline.lines.find((row) => row.id === line.id);
    if (Boolean(kit) !== isKit(baselineLine) && (Number(baselineLine?.receivedQuantity || 0) !== 0 || state.receipt.events?.some((event) => event.lineId === line.id && ['count', 'kit_count'].includes(event.mode) && !event.undoneBy))) throw new Error('Desfaça as contagens desta linha antes de mudar entre produto único e kit. Depois, abra a composição novamente.');
    if (!Number.isSafeInteger(Number(line.receivedQuantity || 0)) && kit) throw new Error('Corrija a quantidade recebida: kits completos devem ser inteiros.');
    if (kit && line.expectedQuantity != null && !Number.isSafeInteger(Number(line.expectedQuantity))) throw new Error('Corrija a quantidade esperada: kits completos devem ser inteiros.');
    markLine(line.id, 'kit', kit); markLine(line.id, 'productId', null); markLine(line.id, 'productName', ''); markLine(line.id, 'stockFactor', 1);
    // Keep the editor usable if saving fails; the source snapshot now matches its local draft.
    state.kitEditor.sourceKit = clone(kit); renderDetail(); await saveReceipt();
    if (state.receipt?._id !== receiptId) throw new Error('Composição salva no recebimento anterior. Abra-o novamente para conferir.');
    $('kit-dialog').close(); state.kitEditor = null;
    notify(remove ? 'Kit desfeito. Vincule o produto e confira a conversão desta linha.' : 'Composição salva. Identifique as peças, confira a composição e conte os kits completos.');
  }
  async function matchComponent(id) {
    assertKitEditor(); const part = state.kitEditor.components.find((row) => row.id === id); if (!part) return;
    state.productLineId = state.kitEditor.lineId; state.productComponentId = id;
    $('product-line-label').textContent = `Peça ${part.label || 'sem tamanho'} · ${lineById(state.productLineId).description}`;
    $('product-search').value = part.barcode || ''; showDialog('product-dialog'); renderProductResults();
    await loadProducts(); renderProductResults(); $('product-search').focus();
  }
  function renderScanOptions() {
    const line = lineById($('scan-line').value), kit = isKit(line), mode = $('scan-mode');
    mode.querySelector('[value="count"]').disabled = kit;
    if (kit && mode.value === 'count') mode.value = 'identify';
    const previous = $('scan-component').value;
    $('scan-component').innerHTML = '<option value="">Selecione a peça</option>' + (line?.kit?.components || []).map((part) => `<option value="${escape(part.id)}">${escape(part.label)} · ${fmt(part.quantityPerKit)} por kit</option>`).join('');
    $('scan-component').value = previous;
    $('scan-component-label').hidden = !kit || mode.value !== 'identify'; $('scan-component').disabled = isClosed();
    const countKits = mode.value === 'kit_count';
    $('scan-barcode').required = !countKits; $('scan-barcode').disabled = isClosed() || countKits;
    $('scan-barcode').placeholder = countKits ? 'Informe a quantidade de kits completos' : kit ? 'Bipe o código da peça selecionada' : 'Bipe ou digite o código de barras';
    $('scan-quantity').step = countKits ? '1' : 'any'; $('scan-quantity').min = countKits ? '1' : '0.001';
    $('scan-submit-label').textContent = countKits ? 'Registrar kits' : 'Registrar';
    $('scan-kit-hint').hidden = !kit && !countKits;
    $('scan-kit-hint').textContent = kit ? `1 kit = ${kitFormula(line)}. Identificar peças não soma quantidades; conte apenas kits completos.` : 'Selecione a linha de um kit configurado.';
  }
  async function selectKitScan(lineId, componentId) {
    if (hasDirty()) await saveReceipt();
    $('scan-line').value = lineId; $('scan-mode').value = componentId ? 'identify' : 'kit_count'; renderScanOptions();
    $('scan-component').value = componentId || ''; $('scan-quantity').value = '1';
    $('scan-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $(componentId ? 'scan-barcode' : 'scan-quantity').focus({ preventScroll: true });
  }
  function persistQueue() {
    if (!storagePrefix) throw new Error('Não foi possível identificar sua conta para guardar leituras com segurança. Entre novamente no sistema.');
    try { localStorage.setItem(storagePrefix + 'queue', JSON.stringify(state.queue)); }
    catch (_) { throw new Error('O navegador não conseguiu guardar esta leitura. Libere espaço antes de continuar.'); }
  }
  function enqueue(event) {
    const entry = { receiptId: state.receipt._id, event, status: 'pending' };
    state.queue.push(entry);
    try { persistQueue(); } catch (error) { state.queue.pop(); throw error; }
    updateSaveState(); flushQueue();
  }
  async function flushQueue() {
    const waiting = queuedEntries();
    if (state.sending || !waiting.length || !navigator.onLine) return;
    state.sending = true;
    try {
      const receiptId = waiting[0].receiptId;
      const batch = waiting.filter((entry) => entry.receiptId === receiptId).slice(0, 100);
      const result = await transmitReceivingEvents(batch.map((entry) => entry.event), (events) => api(`/receipts/${encodeURIComponent(receiptId)}/events`, { method: 'POST', body: { events } }));
      const acknowledged = new Set(result.acknowledged), rejected = new Map(result.rejected.map((entry) => [entry.eventId, entry]));
      const now = new Date().toISOString();
      state.queue = state.queue.filter((entry) => {
        if (entry.receiptId !== receiptId) return true;
        if (acknowledged.has(entry.event.eventId)) {
          if (!entry.rejections?.length) return false;
          entry.status = 'sent'; entry.acknowledgedAt = now; return true;
        }
        const rejection = rejected.get(entry.event.eventId);
        if (rejection) {
          entry.status = 'rejected'; entry.rejections = [...(entry.rejections || []), { ...rejection, rejectedAt: now }];
        }
        return true;
      });
      persistQueue();
      if (state.receipt?._id === receiptId) {
        for (const response of result.responses) if (response.receipt) mergeRemote(response.receipt);
        renderDetail();
        const last = batch.slice().reverse().find((entry) => acknowledged.has(entry.event.eventId))?.event;
        const line = last && state.receipt.lines.find((row) => row.barcode === last.barcode || row.id === last.lineId);
        const component = line?.kit?.components.find((part) => part.id === last?.componentId);
        $('scan-feedback').textContent = rejected.size ? `${rejected.size} leitura(s) precisam de revisão abaixo. As demais continuam sendo enviadas.` : last?.undoOf ? 'Contagem desfeita. O histórico foi preservado.' : last?.mode === 'kit_count' ? `${fmt(last.quantity)} kit(s) completos registrados. Confira a distribuição das peças abaixo.` : last ? (component ? `${component.label}: ${component.productName || 'código guardado; cadastro pendente'}. A quantidade de kits não mudou.` : line?.productName ? `Registrado: ${line.productName}` : 'Leitura registrada. Os códigos sem cadastro identificado ficam nas pendências.') : 'As leituras continuam guardadas, aguardando confirmação do servidor.';
      }
      if (result.error) throw result.error;
      if (!acknowledged.size && !rejected.size && batch.length) notify('O servidor não confirmou as leituras. Elas continuam guardadas neste navegador.', 'warning', true);
    } catch (error) {
      $('scan-feedback').textContent = `Leituras preservadas para reenvio: ${error.message}`;
      if (error.status && error.status !== 429 && error.status < 500) notify(error.message + ' As leituras continuam guardadas.', 'error', true);
    } finally { state.sending = false; updateSaveState(); }
  }
  function renderLocalReadHistory() {
    const container = $('scan-local-history'); if (!container || !state.receipt) return;
    const entries = state.queue.filter((entry) => entry.receiptId === state.receipt._id && entry.rejections?.length);
    container.hidden = !entries.length;
    $('scan-rejected-count').textContent = `${entries.filter((entry) => entry.status === 'rejected').length} leitura(s) para resolver`;
    $('scan-local-history-list').innerHTML = entries.slice().reverse().map((entry) => {
      const rejection = entry.rejections[entry.rejections.length - 1];
      const status = ({ rejected: 'Rejeitada', pending: 'Aguardando nova tentativa', discarded: 'Tentativa descartada', sent: 'Enviada após revisão' })[entry.status] || 'Aguardando envio';
      const line = state.receipt.lines.find((row) => row.id === entry.event.lineId);
      return `<div class="rr-local-read" data-local-event="${escape(entry.event.eventId)}"><div><strong>${escape(entry.event.barcode || 'Desfazer leitura')} · ${escape(status)}</strong><p>${entry.event.mode === 'identify' ? 'Identificação' : 'Conferência'}${line ? ` · ${escape(line.description || line.productName)}` : ''} · ${date(entry.event.createdAt)}</p><p>${escape(rejection.message)}</p><p class="rr-muted">Registro preservado neste navegador. ${entry.status === 'sent' ? 'Envio confirmado pelo servidor.' : 'Essa tentativa não foi confirmada no recebimento.'}</p></div>${entry.status === 'rejected' ? `<div class="receiving-actions"><button class="rr-button rr-small" data-retry-local-event="${escape(entry.event.eventId)}"${isClosed() ? ' disabled' : ''}>Tentar novamente</button><button class="rr-button rr-small" data-discard-local-event="${escape(entry.event.eventId)}">Descartar tentativa</button></div>` : ''}</div>`;
    }).join('');
  }
  function changeRejectedEntry(eventId, discard) {
    const entry = state.queue.find((item) => item.receiptId === state.receipt?._id && item.event.eventId === eventId && item.status === 'rejected');
    if (!entry) return;
    if (discard && !confirm('Descartar esta tentativa rejeitada? Ela não será reenviada. O registro da leitura e o motivo da rejeição continuarão no histórico deste navegador.')) return;
    const before = clone(entry);
    entry.status = discard ? 'discarded' : 'pending';
    if (discard) entry.discardedAt = new Date().toISOString(); else entry.retriedAt = new Date().toISOString();
    try { persistQueue(); } catch (error) { Object.keys(entry).forEach((key) => delete entry[key]); Object.assign(entry, before); throw error; }
    updateSaveState();
    if (!discard) { $('scan-feedback').textContent = 'Tentando enviar a leitura novamente, com o mesmo identificador.'; flushQueue(); }
  }
  async function submitScan(event) {
    event.preventDefault(); if (!state.receipt || isClosed()) return;
    const lineId = $('scan-line').value, receiptId = state.receipt._id;
    const scan = prepareScan({ barcode: $('scan-barcode').value, quantity: $('scan-quantity').value, lineId, mode: $('scan-mode').value, componentId: $('scan-component').value }, lineById(lineId));
    if (hasDirty()) await saveReceipt();
    if (state.receipt?._id !== receiptId || isClosed()) throw new Error('O recebimento mudou. Confira a linha antes de registrar.');
    if (lineId && !state.baseline.lines.some((line) => line.id === lineId)) throw new Error('Salve a nova linha antes de associar uma leitura a ela.');
    enqueue({ eventId: uuid(), ...scan, createdAt: new Date().toISOString() });
    $('scan-barcode').value = ''; $('scan-barcode').focus(); $('scan-feedback').textContent = 'Leitura guardada. Enviando para o recebimento…';
  }
  function renderOcrStatus() {
    const config = state.capabilities?.photoImport;
    $('extract-photos').disabled = isClosed() || state.extracting || !config?.available || !state.photos.length;
    $('ocr-status').textContent = state.extracting ? 'Lendo as fotos. Você poderá conferir a proposta antes de aplicar.' : !config ? 'Leitura de fotos indisponível no momento. Use CSV/JSON ou adicione linhas.' : !config.available ? (config.reason || 'Leitura automática não configurada. As fotos podem ser consultadas; importe CSV/JSON ou preencha as linhas.') : 'A leitura prepara uma proposta. Nenhuma linha é adicionada sem sua conferência.';
  }
  async function loadPhotos() {
    if (!state.receipt) return;
    const id = state.receipt._id; const result = await api(`/receipts/${encodeURIComponent(id)}/photos`);
    if (state.receipt?._id !== id) return;
    state.photos = result.photos || []; state.lastPhotoSync = Date.now(); renderPhotos(); renderOcrStatus();
    if (state.photos.length && !state.photos.some((photo) => photo.id === state.photoId)) await selectPhoto(state.photos[0].id);
  }
  function renderPhotos() {
    const selected = new Set([...document.querySelectorAll('[data-photo-check]:checked')].map((node) => node.dataset.photoCheck));
    const hadSelection = !!document.querySelector('[data-photo-check]');
    $('photo-thumbnails').innerHTML = state.photos.map((photo, index) => `<div class="rr-photo-tab${state.photoId === photo.id ? ' is-active' : ''}"><input type="checkbox" data-photo-check="${escape(photo.id)}" aria-label="Incluir foto ${index + 1} na leitura"${(!hadSelection || selected.has(photo.id)) && photo.status !== 'duplicate' ? ' checked' : ''}><button data-view-photo="${escape(photo.id)}" title="${escape(photo.name)}">Foto ${index + 1}${photo.status === 'duplicate' ? ' · repetida' : ''}</button></div>`).join('');
  }
  async function selectPhoto(id) {
    const photo = state.photos.find((item) => item.id === id); if (!photo) return;
    state.photoId = id; state.photoRotation = 0; renderPhotos();
    $('photo-viewport').innerHTML = '<p class="rr-muted">Carregando foto…</p>';
    const apiUrl = new URL(base, location.origin), url = new URL(photo.url, apiUrl.origin);
    if (url.origin !== apiUrl.origin) throw new Error('A foto não está no servidor autorizado.');
    const response = await fetch(url.href, { headers: { Authorization: `Bearer ${token()}` } });
    if (!response.ok) throw new Error('Não foi possível abrir esta foto.');
    const blob = await response.blob(); if (state.photoId !== id) return;
    if (!blob.type.startsWith('image/')) throw new Error('O anexo não é uma imagem válida.');
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl); state.photoUrl = URL.createObjectURL(blob);
    $('photo-viewport').innerHTML = '<img id="current-photo" alt="Foto original do romaneio">'; $('current-photo').src = state.photoUrl; $('photo-tools').hidden = false;
  }
  async function uploadPhotos(files) {
    if (!files.length || !state.receipt || isClosed()) return;
    const body = new FormData();
    if (files.length > 8) throw new Error('Envie até 8 fotos por vez.');
    for (const file of files) { if (file.size > 8 * 1024 * 1024) throw new Error(`A foto ${file.name} excede 8 MB.`); body.append('photos', file); }
    $('ocr-status').textContent = 'Enviando fotos…';
    await api(`/receipts/${encodeURIComponent(state.receipt._id)}/photos`, { method: 'POST', body, timeout: 90000 });
    await loadPhotos(); await refreshReceipt(); notify('Fotos anexadas ao recebimento.');
  }
  function showImport(lines, warnings, title, extraction = null, qualitySource = extraction) {
    assertImportReceipt(state.receipt?._id, state.receipt);
    state.importReceiptId = text(state.receipt._id);
    let prepared;
    try { prepared = prepareImportProposal(lines, state.receipt.lines, qualitySource); }
    catch (error) {
      if (!extraction?.pages?.length) throw error;
      prepared = { proposal: [], warnings: [error.message], hasUnusablePages: true, needsManualReview: true };
    }
    state.proposal = prepared.proposal;
    const notes = [...(warnings || []), ...prepared.warnings];
    if (!state.proposal.length) notes.push('Nenhuma linha utilizável foi separada automaticamente. Confira a foto e corrija o texto abaixo, ou importe um arquivo CSV/JSON com os dados conferidos.');
    if (state.proposal.some((row) => row.duplicate)) notes.push('Há linhas idênticas às existentes ou repetidas nesta proposta. Elas começaram desmarcadas; confira as páginas antes de selecionar.');
    $('import-title').textContent = prepared.hasUnusablePages ? 'Leitura da foto insuficiente' : title || 'Conferir linhas';
    $('import-quality-warning').hidden = !prepared.needsManualReview;
    $('import-quality-warning').textContent = prepared.hasUnusablePages ?
      'A leitura automática não conseguiu reconhecer esta foto com qualidade suficiente. O texto pode conter nomes, códigos e quantidades errados. As linhas incertas estão desmarcadas: corrija o texto ou confira cada dado com a foto antes de selecionar.' :
      'A leitura contém dados incertos. As linhas que precisam de revisão estão desmarcadas. Confira os nomes, códigos, quantidades e valores com a foto antes de selecionar.';
    $('confirm-import-review').checked = false;
    const rawIndex = state.extraction?.pages === extraction?.pages ? Number($('ocr-raw-page').value) || 0 : 0;
    state.extraction = extraction;
    $('ocr-raw-section').hidden = !extraction?.pages?.length;
    $('ocr-raw-section').open = prepared.needsManualReview || !state.proposal.length;
    if (extraction?.pages?.length) {
      $('ocr-raw-page').innerHTML = extraction.pages.map((page, index) => `<option value="${index}">Foto ${index + 1}${page.duplicateOf ? ' · possível repetição' : ''}</option>`).join('');
      $('ocr-raw-page').value = String(Math.min(rawIndex, extraction.pages.length - 1));
      $('ocr-raw-text').value = extraction.pages[Number($('ocr-raw-page').value)].rawText || '';
      updateOcrPhotoButton();
    }
    $('import-warnings').innerHTML = notes.map((warning) => `<p>${escape(typeof warning === 'object' ? warning.message || JSON.stringify(warning) : warning)}</p>`).join('');
    $('import-preview').innerHTML = state.proposal.map(({ line, duplicate, requiresManualReview, selected }, index) => `<label class="rr-import-row${requiresManualReview ? ' needs-review' : ''}"><input type="checkbox" data-import-index="${index}"${selected ? ' checked' : ''}><div><strong>${escape(line.description)}</strong><p>Cód. fornecedor: ${escape(line.supplierCode || '—')}${line.sourcePage ? ` · Pág. ${escape(line.sourcePage)}` : ''}${duplicate ? ' · POSSÍVEL REPETIÇÃO' : ''}${requiresManualReview ? ' · LEITURA INCERTA: CONFERIR COM A FOTO' : ''}</p></div><span>${fmt(line.expectedQuantity)} ${escape(line.unit)}</span><span>${line.unitCost == null ? '—' : money(line.unitCost)}</span></label>`).join('');
    updateImportCount(); showDialog('import-dialog');
  }
  function updateImportCount() {
    const selection = importSelectionState(state.proposal, $('confirm-import-review').checked);
    $('import-selection-controls').hidden = !state.proposal?.length;
    $('import-count').textContent = `${selection.count} linha(s) selecionada(s)${selection.needsReview && !selection.canApply ? ' · confirme a conferência abaixo' : ''}`;
    $('import-review-confirmation').hidden = !selection.needsReview;
    $('apply-import').disabled = !selection.canApply;
  }
  function selectAllImportRows(selected) {
    for (const row of state.proposal || []) row.selected = selected;
    for (const checkbox of document.querySelectorAll('[data-import-index]')) checkbox.checked = selected;
    $('confirm-import-review').checked = false;
    updateImportCount();
  }
  function updateOcrPhotoButton() {
    const photoId = state.extraction?.pages?.[Number($('ocr-raw-page').value)]?.photoId;
    $('ocr-view-photo').disabled = !photoId || !state.photos.some((photo) => photo.id === photoId);
  }
  async function extractPhotos() {
    const photoIds = [...document.querySelectorAll('[data-photo-check]:checked')].map((node) => node.dataset.photoCheck);
    if (!photoIds.length) throw new Error('Selecione pelo menos uma foto para preparar as linhas.');
    if (photoIds.length > 8) throw new Error('Selecione até 8 fotos por leitura.');
    state.extracting = true; renderOcrStatus();
    const receiptId = state.receipt._id;
    try {
      const result = await api(`/receipts/${encodeURIComponent(receiptId)}/extract`, { method: 'POST', body: { photoIds } });
      if (result.jobId) {
        if (storagePrefix) sessionStorage.setItem(storagePrefix + 'ocr:' + receiptId, result.jobId);
        await pollExtraction(receiptId, result.jobId);
      } else presentExtraction(receiptId, result.extraction || {});
    } finally { state.extracting = false; renderOcrStatus(); }
  }
  function presentExtraction(receiptId, extraction) {
    if (state.receipt?._id !== receiptId) { notify('A leitura de fotos terminou. Abra o recebimento correspondente para conferir a proposta.', 'success', true); return; }
    const warnings = [...(extraction.warnings || [])];
    for (const page of extraction.pages || []) {
      if (page.duplicateOf || page.status === 'duplicate') warnings.push('Uma foto parece repetir outra página. As linhas dessa página foram separadas da proposta para conferência.');
      if (page.occluded || page.incomplete) warnings.push('Uma página parece cortada ou encoberta. Confira antes de aplicar.');
    }
    showImport(extraction.lines || [], warnings, 'Linhas sugeridas pelas fotos', extraction);
    if (storagePrefix) sessionStorage.removeItem(storagePrefix + 'ocr:' + receiptId);
  }
  async function pollExtraction(receiptId, jobId) {
    if (state.extractionJobs.has(receiptId)) return;
    state.extractionJobs.set(receiptId, jobId); state.extracting = true; renderOcrStatus();
    try {
      for (let attempt = 0; attempt < 900; attempt++) {
        const result = await api(`/receipts/${encodeURIComponent(receiptId)}/extractions/${encodeURIComponent(jobId)}`);
        if (result.status === 'failed') { if (storagePrefix) sessionStorage.removeItem(storagePrefix + 'ocr:' + receiptId); throw new Error(result.message || 'Não foi possível ler as fotos.'); }
        if (result.status === 'completed') { presentExtraction(receiptId, result.extraction || {}); return; }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('As fotos continuam em processamento. Reabra o recebimento para retomar o acompanhamento.');
    } finally { state.extractionJobs.delete(receiptId); state.extracting = false; renderOcrStatus(); }
  }
  async function reparseOcrText() {
    const receiptId = state.importReceiptId;
    assertImportReceipt(receiptId, state.receipt);
    const index = Number($('ocr-raw-page').value), page = state.extraction?.pages?.[index];
    if (!page) return;
    page.rawText = $('ocr-raw-text').value;
    const result = await api(`/receipts/${encodeURIComponent(receiptId)}/parse-text`, { method: 'POST', body: { text: page.rawText, photoId: page.photoId || undefined } });
    assertImportReceipt(receiptId, state.receipt);
    const extraction = { ...state.extraction, lines: result.extraction?.lines || [] };
    // The corrected text is a new proposal. Do not inherit the original photo's failed OCR quality.
    showImport(extraction.lines, result.extraction?.warnings || [], 'Linhas do texto corrigido · foto selecionada', extraction, result.extraction || {});
  }
  function addLine(source = {}) {
    const line = { id: uuid(), description: '', supplierCode: '', expectedQuantity: null, receivedQuantity: 0, unit: 'UN', unitCost: null, productName: '', barcode: '', stockFactor: 1, conversionConfirmed: false, reviewed: false, ...source };
    state.receipt.lines.push(line); state.dirty.set(line.id, new Set(Object.keys(line))); return line;
  }
  async function applyImport() {
    assertImportReceipt(state.importReceiptId, state.receipt);
    const selected = state.proposal?.filter((row) => row.selected) || []; if (!selected.length) return;
    if (!importSelectionState(state.proposal, $('confirm-import-review').checked).canApply) throw new Error('Confira os dados das linhas selecionadas com a foto e marque a confirmação antes de adicionar.');
    if (selected.some((row) => row.duplicate) && !confirm('Você selecionou linhas possivelmente repetidas. Confirma que representam mercadorias adicionais, e não outra foto da mesma página?')) return;
    selected.forEach(({ line }) => addLine(clone(line))); persistDraft(); renderDetail(); $('import-dialog').close();
    await saveReceipt(); notify(`${selected.length} linha(s) adicionada(s). Confira os vínculos e as embalagens antes de concluir.`);
  }
  function openChatGptImport() {
    assertImportReceipt(state.receipt?._id, state.receipt);
    if (state.chatGptReceiptId !== text(state.receipt._id)) $('chatgpt-response').value = '';
    state.chatGptReceiptId = text(state.receipt._id);
    $('chatgpt-receipt-reference').textContent = `Recebimento: ${state.receipt.reference || 'Sem referência'}`;
    $('chatgpt-prompt').value = chatGptReceivingPrompt;
    $('chatgpt-copy-status').textContent = '';
    $('chatgpt-import-error').textContent = '';
    showDialog('chatgpt-dialog');
  }
  async function copyChatGptPrompt() {
    try {
      await navigator.clipboard.writeText(chatGptReceivingPrompt);
      $('chatgpt-copy-status').textContent = 'Pedido copiado. Cole na conversa junto das fotos.';
    } catch (_) {
      $('chatgpt-prompt-details').open = true;
      $('chatgpt-prompt').focus(); $('chatgpt-prompt').select();
      $('chatgpt-copy-status').textContent = 'O navegador não permitiu copiar automaticamente. Copie o texto selecionado e cole na conversa.';
    }
  }
  function importChatGptResponse() {
    $('chatgpt-import-error').textContent = '';
    try {
      assertImportReceipt(state.chatGptReceiptId, state.receipt);
      const prepared = parseChatGptResponse($('chatgpt-response').value);
      showImport(prepared.lines, prepared.warnings, 'Linhas da conversa · confira com o documento');
      $('chatgpt-dialog').close();
    } catch (error) { $('chatgpt-import-error').textContent = error.message; }
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportReceipt(kind) {
    const receipt = state.receipt; if (!receipt) return;
    const file = (receipt.code || receipt._id).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (kind === 'json') return download(`${file}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), hasUnsavedChanges: hasDirty(), receipt, localReadHistory: state.queue.filter((entry) => entry.receiptId === receipt._id) }, null, 2), 'application/json;charset=utf-8');
    const keys = ['description', 'supplierCode', 'barcode', 'productName', 'expectedQuantity', 'receivedQuantity', 'unit', 'stockFactor', 'unitCost', 'conversionConfirmed', 'reviewed', 'kit'];
    const csv = [keys.map(csvCell).join(';'), ...receipt.lines.map((line) => keys.map((key) => csvCell(key === 'kit' && line.kit ? JSON.stringify(line.kit) : line[key])).join(';'))].join('\r\n');
    download(`${file}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
  }
  function reviewIssues() {
    const lines = state.receipt.lines, issues = [];
    if (!state.receipt.testMode && state.meta.canApproveStock !== true) issues.push('Sua conta pode conferir o recebimento; a entrada real precisa ser concluída por um administrador.');
    if (!lines.length) issues.push('Adicione pelo menos uma linha.');
    if (!lines.some((line) => Number(line.receivedQuantity) > 0)) issues.push('Informe pelo menos uma quantidade recebida maior que zero.');
    lines.forEach((line, index) => { const pending = lineIssues(line); if (pending.length) issues.push(`Linha ${index + 1}: ${pending.join(', ')}.`); });
    if (pendingQueue().length) issues.push('Aguarde o envio das leituras pendentes.');
    if (rejectedQueue().length) issues.push('Resolva ou descarte as tentativas rejeitadas na área de leituras antes de concluir.');
    if (state.conflicts.size) issues.push('Resolva os conflitos de edição.');
    const undone = new Set((state.receipt.events || []).map((event) => event.undoOf).filter(Boolean));
    if ((state.receipt.events || []).some((event) => event.status === 'conflict' && !undone.has(event.eventId || event.id))) issues.push('Há leituras com conflito. Desfaça a leitura no histórico e registre-a na linha correta.');
    return issues;
  }
  async function openReview() {
    await saveReceipt(); await refreshReceipt();
    state.products = null; state.productIndex = null;
    await loadProducts(); renderDetail();
    const receipt = state.receipt, lines = receipt.lines, differences = lines.filter(hasDifference), issues = reviewIssues();
    state.reviewVersion = receipt.version;
    $('review-title').textContent = receipt.testMode ? 'Concluir teste do recebimento' : 'Confirmar entrada no estoque';
    const deposit = state.meta.deposits.find((row) => idOf(row) === idOf(receipt.depositId));
    const total = lines.reduce((sum, line) => sum + Number(line.receivedQuantity || 0) * Number(line.unitCost || 0), 0);
    $('review-summary').innerHTML = `<div class="rr-review-card"><strong>${escape(receipt.code || 'Recebimento')} · ${receipt.testMode ? 'MODO DE TESTE' : 'ENTRADA REAL'}</strong><p>Depósito: ${escape((deposit && nameOf(deposit)) || receipt.depositId)}</p><p>${lines.length} linha(s) · ${differences.length} diferença(s) de quantidade · Custo informado: ${money(total)}</p><p>${receipt.testMode ? 'A conclusão registra o teste e não movimenta o estoque.' : 'As quantidades recebidas, multiplicadas pelas conversões conferidas, serão adicionadas ao estoque do depósito selecionado.'}</p><p>O recebimento não altera o preço de venda nem cria contas a pagar.</p></div>`;
    const kits = lines.filter(isKit);
    if (kits.length) $('review-summary').insertAdjacentHTML('beforeend', `<div class="rr-review-card"><strong>Peças dos kits para o estoque</strong>${kits.map((line) => `<p><b>${escape(line.description)}</b> · ${fmt(line.receivedQuantity)} kit(s)<br>${stockProjection(line).map((part) => `${fmt(part.quantity)} × ${escape(part.productName)}`).join(' · ')}</p>`).join('')}<p>O kit não entra como produto separado. O custo permanece no documento, sem rateio nos cadastros.</p></div>`);
    $('review-issues').innerHTML = issues.length ? `<div class="rr-review-issues"><strong>Resolva estas pendências antes de concluir:</strong>${issues.slice(0, 30).map((issue) => `<p>${escape(issue)}</p>`).join('')}${issues.length > 30 ? `<p>E mais ${issues.length - 30} pendência(s).</p>` : ''}</div>` : differences.length ? `<div class="rr-review-issues">${differences.map((line) => `<p>${escape(line.description)}: esperado ${fmt(line.expectedQuantity)}, recebido ${fmt(line.receivedQuantity)}.</p>`).join('')}</div>` : '';
    $('accept-differences').checked = false; $('accept-differences').closest('label').hidden = differences.length === 0;
    $('learn-supplier-links').checked = false; $('learn-supplier-links').disabled = receipt.testMode || !receipt.supplierId;
    $('learn-barcodes').checked = false; $('learn-barcodes').disabled = receipt.testMode;
    $('confirm-approval').checked = false; $('confirm-approval-label').textContent = receipt.testMode ? 'Conferi as linhas e quero concluir este teste sem alterar o estoque.' : 'Conferi produtos, quantidades e conversões, e autorizo esta entrada no depósito indicado.';
    $('approve-receipt').textContent = receipt.testMode ? 'Concluir teste' : 'Confirmar entrada no estoque';
    updateApproval(); showDialog('review-dialog');
  }
  function updateApproval() { if (!state.receipt) return; $('approve-receipt').disabled = !($('confirm-approval').checked && state.reviewVersion === state.receipt.version && !reviewIssues().length && (!state.receipt.lines.some(hasDifference) || $('accept-differences').checked)); }
  async function approveReceipt() {
    if (!$('confirm-approval').checked || state.reviewVersion !== state.receipt.version || reviewIssues().length) throw new Error('A revisão precisa ser conferida novamente antes de concluir.');
    const result = await api(`/receipts/${encodeURIComponent(state.receipt._id)}/approve`, { method: 'POST', body: { version: state.reviewVersion, acceptDifferences: $('accept-differences').checked, learnSupplierLinks: $('learn-supplier-links').checked && !state.receipt.testMode, learnBarcodes: $('learn-barcodes').checked && !state.receipt.testMode } });
    state.receipt = result.receipt; state.baseline = clone(result.receipt); state.dirty.clear(); state.headerDirty.clear(); state.deleted.clear(); persistDraft();
    $('review-dialog').close(); renderDetail(); notify(state.receipt.testMode ? 'Teste concluído. O estoque não foi movimentado.' : 'Recebimento concluído e entrada registrada no estoque.', 'success', true);
  }
  function bind() {
    document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
    $('new-receipt').addEventListener('click', () => { metadataOptions('new'); $('new-reference').value = ''; $('new-test-mode').checked = true; showDialog('new-receipt-dialog'); });
    $('new-company').addEventListener('change', () => depositOptions('new'));
    $('new-receipt-form').addEventListener('submit', (event) => { event.preventDefault(); action(event.submitter, async () => {
      const supplier = state.meta.suppliers.find((row) => idOf(row) === $('new-supplier').value);
      const result = await api('/receipts', { method: 'POST', body: { companyId: $('new-company').value, depositId: $('new-deposit').value, supplierId: $('new-supplier').value || null, supplierName: supplier ? nameOf(supplier) : '', reference: $('new-reference').value.trim(), testMode: $('new-test-mode').checked } });
      $('new-receipt-dialog').close(); await openReceipt(result.receipt._id); notify('Recebimento criado. Anexe o documento ou comece a bipar.');
    }); });
    $('refresh-list').addEventListener('click', (event) => action(event.currentTarget, loadList));
    $('receipt-search').addEventListener('input', renderList); $('receipt-status-filter').addEventListener('change', renderList);
    $('receipts-list').addEventListener('click', (event) => { const button = event.target.closest('[data-open-receipt]'); if (button) action(button, () => openReceipt(button.dataset.openReceipt)); });
    $('back-to-list').addEventListener('click', () => { persistDraft(); state.receipt = null; state.baseline = null; state.dirty.clear(); state.headerDirty.clear(); state.deleted.clear(); state.conflicts.clear(); $('receipt-list-view').hidden = false; $('receipt-detail-view').hidden = true; const url = new URL(location.href); url.searchParams.delete('id'); history.replaceState({}, '', url); action(null, loadList); });
    document.querySelectorAll('[data-header-field]').forEach((node) => node.addEventListener('change', () => {
      const field = node.dataset.headerField; markHeader(field, node.type === 'checkbox' ? node.checked : node.value || null);
      if (field === 'companyId') { depositOptions('detail'); markHeader('depositId', null); }
      if (field === 'testMode' && !node.checked) notify('Este recebimento passará a ser uma entrada real. O estoque só será alterado após a confirmação final.', 'warning', true);
      renderDetail();
    }));
    $('line-search').addEventListener('input', renderLines); $('line-filter').addEventListener('change', renderLines);
    $('receipt-lines').addEventListener('input', (event) => {
      const node = event.target.closest('[data-line-field]'); if (!node) return;
      const id = node.closest('[data-line-id]').dataset.lineId, field = node.dataset.lineField;
      markLine(id, field, node.type === 'checkbox' ? node.checked : numericFields.has(field) ? number(node.value) : node.value);
    });
    // Let focus move to the next input before replacing row elements. Rebuilding during
    // blur/change can detach that next input while its first edit is being dispatched.
    $('receipt-lines').addEventListener('change', (event) => { if (event.target.matches('[data-line-field]')) requestAnimationFrame(() => { renderLines(); renderConflicts(); }); });
    $('receipt-lines').addEventListener('click', (event) => {
      const match = event.target.closest('[data-match-line]'), remove = event.target.closest('[data-delete-line]'), unlink = event.target.closest('[data-unlink-line]');
      const kit = event.target.closest('[data-kit-line]'), identify = event.target.closest('[data-identify-kit]'), count = event.target.closest('[data-count-kit]');
      if (kit) openKitEditor(kit.dataset.kitLine);
      if (identify) action(identify, () => selectKitScan(identify.dataset.identifyKit, identify.dataset.componentId));
      if (count) action(count, () => selectKitScan(count.dataset.countKit));
      if (match) action(match, () => matchLine(match.dataset.matchLine));
      if (unlink) { const id = unlink.dataset.unlinkLine; markLine(id, 'productId', null); markLine(id, 'productName', ''); renderLines(); }
      if (remove && confirm('Remover esta linha do recebimento? Linhas com leituras podem precisar ser desfeitas no histórico primeiro.')) { const id = remove.dataset.deleteLine; state.receipt.lines = state.receipt.lines.filter((line) => text(line.id) !== id); if (state.baseline.lines.some((line) => text(line.id) === id)) state.deleted.add(id); state.dirty.delete(id); persistDraft(); renderDetail(); }
    });
    $('add-line').addEventListener('click', () => { addLine(); persistDraft(); renderDetail(); const rows = document.querySelectorAll('[data-line-id]'); rows[rows.length - 1]?.querySelector('input')?.focus(); });
    $('product-search').addEventListener('input', renderProductResults);
    $('reload-catalog').addEventListener('click', (event) => action(event.currentTarget, async () => { state.products = null; state.productIndex = null; await loadProducts(); renderProductResults(); renderDetail(); }));
    $('product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-select-product]'); if (!button) return; const product = state.products.find((row) => text(row._id) === button.dataset.selectProduct); if (!product) return;
      if (state.productComponentId) { try { assertKitEditor(); const part = state.kitEditor.components.find((row) => row.id === state.productComponentId); if (!part) throw new Error('Esta peça foi removida.'); part.productId = product._id; part.productName = product.nome; renderKitEditor(); } catch (error) { $('kit-editor-error').textContent = error.message; } }
      else { const id = state.productLineId; markLine(id, 'productId', product._id); markLine(id, 'productName', product.nome); }
      $('product-dialog').close(); renderDetail();
    });
    $('kit-components').addEventListener('input', (event) => {
      const input = event.target.closest('[data-kit-field]'); if (!input || !state.kitEditor) return;
      const part = state.kitEditor.components.find((row) => row.id === input.closest('[data-kit-component]').dataset.kitComponent); if (!part) return;
      part[input.dataset.kitField] = input.dataset.kitField === 'quantityPerKit' ? number(input.value) : input.value;
      if (input.dataset.kitField === 'barcode') { part.productId = null; part.productName = ''; input.closest('[data-kit-component]').querySelector('.rr-kit-editor-link span').textContent = 'O código será consultado ao salvar.'; }
      $('kit-editor-error').textContent = ''; renderKitFormula();
    });
    $('kit-components').addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target.matches('[data-kit-field="barcode"]')) { event.preventDefault(); const fields = [...$('kit-components').querySelectorAll('[data-kit-field="barcode"]')]; fields[fields.indexOf(event.target) + 1]?.focus(); } });
    $('kit-components').addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-component]'), match = event.target.closest('[data-match-component]'), unlink = event.target.closest('[data-unlink-component]');
      if (remove && state.kitEditor.components.length > 1) { state.kitEditor.components = state.kitEditor.components.filter((part) => part.id !== remove.dataset.removeComponent); renderKitEditor(); }
      if (match) kitAction(match, () => matchComponent(match.dataset.matchComponent));
      if (unlink) { const part = state.kitEditor.components.find((row) => row.id === unlink.dataset.unlinkComponent); part.productId = null; part.productName = ''; renderKitEditor(); }
    });
    document.querySelectorAll('[data-kit-preset]').forEach((button) => button.addEventListener('click', () => {
      if (!state.kitEditor) return;
      const meaningful = state.kitEditor.components.some((part) => part.barcode || part.productId || part.label);
      if (meaningful && !confirm('Substituir a composição em edição por este modelo? Os códigos e vínculos anteriores serão removidos.')) return;
      state.kitEditor.components = (button.dataset.kitPreset === 'pmg' ? ['P', 'M', 'G'] : button.dataset.kitPreset === 'numbered' ? ['Tam 1', 'Tam 2', 'Tam 3'] : ['']).map((label) => newKitComponent(label)); renderKitEditor();
    }));
    $('add-kit-component').addEventListener('click', () => { if (!state.kitEditor || state.kitEditor.components.length >= 50) return; state.kitEditor.components.push(newKitComponent()); renderKitEditor(); $('kit-components').lastElementChild.querySelector('input').focus(); });
    $('save-kit').addEventListener('click', (event) => kitAction(event.currentTarget, () => applyKit()));
    $('remove-kit').addEventListener('click', (event) => { if (confirm('Voltar esta linha para um produto único? Os componentes e seus códigos serão removidos deste recebimento.')) kitAction(event.currentTarget, () => applyKit(true)); });
    $('save-receipt').addEventListener('click', (event) => action(event.currentTarget, saveReceipt));
    $('refresh-receipt').addEventListener('click', (event) => action(event.currentTarget, refreshReceipt));
    $('receipt-conflicts').addEventListener('click', (event) => {
      const button = event.target.closest('[data-conflict]'); if (!button) return;
      const key = button.dataset.conflict, conflict = state.conflicts.get(key); if (!conflict) return;
      if (button.dataset.choice === 'remote') {
        if (conflict.scope === 'header') { state.receipt[conflict.field] = clone(conflict.remote); state.headerDirty.delete(conflict.field); }
        else if (['deleted', 'remove'].includes(conflict.field)) { state.receipt.lines = state.receipt.lines.filter((line) => line.id !== conflict.scope); const remote = state.baseline.lines.find((line) => line.id === conflict.scope); if (remote) state.receipt.lines.push(clone(remote)); state.dirty.delete(conflict.scope); state.deleted.delete(conflict.scope); }
        else { const line = lineById(conflict.scope); if (line) line[conflict.field] = clone(conflict.remote); state.dirty.get(conflict.scope)?.delete(conflict.field); if (!state.dirty.get(conflict.scope)?.size) state.dirty.delete(conflict.scope); }
      }
      state.conflicts.delete(key); persistDraft(); renderDetail();
    });
    $('scan-form').addEventListener('submit', (event) => { event.preventDefault(); action(null, () => submitScan(event)); });
    $('scan-mode').addEventListener('change', renderScanOptions); $('scan-line').addEventListener('change', renderScanOptions);
    $('scan-local-history-list').addEventListener('click', (event) => {
      const retry = event.target.closest('[data-retry-local-event]'), discard = event.target.closest('[data-discard-local-event]');
      const button = retry || discard; if (button) action(button, async () => changeRejectedEntry(retry?.dataset.retryLocalEvent || discard.dataset.discardLocalEvent, !!discard));
    });
    $('receipt-events').addEventListener('click', (event) => { const button = event.target.closest('[data-undo-event]'); if (!button || !confirm('Desfazer esta leitura? O histórico será preservado.')) return; action(button, async () => { enqueue({ eventId: uuid(), barcode: '', quantity: 1, mode: 'count', undoOf: button.dataset.undoEvent, createdAt: new Date().toISOString() }); }); });
    $('photo-upload').addEventListener('change', (event) => { const files = [...event.target.files]; action(null, () => uploadPhotos(files)).finally(() => { event.target.value = ''; }); });
    $('photo-thumbnails').addEventListener('click', (event) => { const button = event.target.closest('[data-view-photo]'); if (button) action(null, () => selectPhoto(button.dataset.viewPhoto)); });
    $('photo-rotate').addEventListener('click', () => { state.photoRotation = (state.photoRotation + 90) % 360; if ($('current-photo')) $('current-photo').style.transform = `rotate(${state.photoRotation}deg)`; });
    $('photo-open').addEventListener('click', () => { if (state.photoUrl) { $('photo-large').src = state.photoUrl; showDialog('photo-dialog'); } });
    $('extract-photos').addEventListener('click', (event) => action(event.currentTarget, extractPhotos));
    $('prepare-chatgpt').addEventListener('click', () => action(null, openChatGptImport));
    $('chatgpt-copy-prompt').addEventListener('click', (event) => action(event.currentTarget, copyChatGptPrompt));
    $('chatgpt-preview-response').addEventListener('click', importChatGptResponse);
    $('chatgpt-response').addEventListener('input', () => { $('chatgpt-import-error').textContent = ''; });
    $('lines-import').addEventListener('change', (event) => { const file = event.target.files[0]; action(null, async () => { if (!file) return; if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo de linhas excede 5 MB.'); const prepared = prepareImport(await file.text(), file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'); showImport(prepared.lines, prepared.warnings, 'Linhas do arquivo ' + file.name); }).finally(() => { event.target.value = ''; }); });
    $('import-preview').addEventListener('change', (event) => { if (event.target.dataset.importIndex !== undefined) { state.proposal[Number(event.target.dataset.importIndex)].selected = event.target.checked; $('confirm-import-review').checked = false; updateImportCount(); } });
    $('confirm-import-review').addEventListener('change', updateImportCount);
    $('select-all-import').addEventListener('click', () => selectAllImportRows(true));
    $('clear-import-selection').addEventListener('click', () => selectAllImportRows(false));
    $('apply-import').addEventListener('click', (event) => action(event.currentTarget, applyImport));
    $('ocr-raw-page').addEventListener('change', () => { $('ocr-raw-text').value = state.extraction?.pages?.[Number($('ocr-raw-page').value)]?.rawText || ''; updateOcrPhotoButton(); });
    $('ocr-raw-text').addEventListener('input', () => { const page = state.extraction?.pages?.[Number($('ocr-raw-page').value)]; if (page) page.rawText = $('ocr-raw-text').value; $('confirm-import-review').checked = false; updateImportCount(); });
    $('ocr-view-photo').addEventListener('click', () => action($('ocr-view-photo'), async () => {
      const photoId = state.extraction?.pages?.[Number($('ocr-raw-page').value)]?.photoId;
      if (!photoId) return;
      await selectPhoto(photoId);
      if (state.photoUrl) { $('photo-large').src = state.photoUrl; showDialog('photo-dialog'); }
    }));
    $('reparse-ocr-text').addEventListener('click', (event) => action(event.currentTarget, reparseOcrText));
    $('download-ocr-text').addEventListener('click', () => download('texto-romaneio.txt', $('ocr-raw-text').value, 'text/plain;charset=utf-8'));
    $('download-template').addEventListener('click', () => download('modelo-romaneio.csv', '\uFEFFdescricao;codigoFornecedor;quantidadeEsperada;unidade;custoUnitario;codigoDeBarras;pagina;item\r\n', 'text/csv;charset=utf-8'));
    $('export-json').addEventListener('click', () => exportReceipt('json')); $('export-csv').addEventListener('click', () => exportReceipt('csv'));
    $('review-receipt').addEventListener('click', (event) => action(event.currentTarget, openReview));
    $('accept-differences').addEventListener('change', updateApproval); $('confirm-approval').addEventListener('change', updateApproval);
    $('approve-receipt').addEventListener('click', (event) => action(event.currentTarget, approveReceipt));
    window.addEventListener('online', () => { connection(true); flushQueue(); }); window.addEventListener('offline', () => connection(false));
    window.addEventListener('beforeunload', (event) => { if (hasDirty() || queuedEntries().length) { persistDraft(); event.preventDefault(); event.returnValue = ''; } });
  }
  async function init() {
    bind();
    if (storagePrefix) { try { const queue = JSON.parse(localStorage.getItem(storagePrefix + 'queue') || '[]'); if (Array.isArray(queue)) state.queue = queue.filter((entry) => entry?.receiptId && entry?.event?.eventId); } catch (_) { /* Never manufacture missing reads. */ } }
    connection(navigator.onLine);
    const results = await Promise.allSettled([api('/meta'), api('/capabilities')]);
    if (results[0].status === 'fulfilled') state.meta = { ...state.meta, ...results[0].value };
    else notify(results[0].reason.message, 'error', true);
    if (results[1].status === 'fulfilled') state.capabilities = results[1].value;
    renderOcrStatus();
    const id = new URL(location.href).searchParams.get('id');
    if (id) await action(null, () => openReceipt(id)); else await action(null, loadList);
    flushQueue();
    setInterval(() => {
      if (document.hidden) return;
      if (state.receipt && !isClosed() && !state.saving) refreshReceipt().catch(() => { /* Connection indicator provides background state. */ });
      if (state.receipt && !isClosed() && Date.now() - state.lastPhotoSync > 30000) loadPhotos().catch(() => { /* Existing photos remain visible during connection errors. */ });
      if (queuedEntries().length) flushQueue();
    }, 8000);
  }
  init().catch((error) => notify(error.message, 'error', true));
})(typeof window !== 'undefined' ? window : globalThis);
