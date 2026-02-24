(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const qs = (selector, root = document) => root.querySelector(selector);

  const state = {
    activeTab: 'conferencia',
    companies: [],
    pdvs: [],
    caixas: [],
    paymentMethods: [],
    loadingPaymentMethods: false,
    currentPdvSnapshot: null,
    filtersCollapsed: false,
  };

  function getToken() {
    try {
      if (typeof window.getToken === 'function') {
        const tokenFromGlobal = window.getToken();
        if (tokenFromGlobal) return tokenFromGlobal;
      }
      const rawLogged = localStorage.getItem('loggedInUser');
      if (rawLogged) {
        const parsed = JSON.parse(rawLogged);
        if (parsed?.token) return parsed.token;
      }
      return localStorage.getItem('auth_token') || '';
    } catch (_) {
      return '';
    }
  }

  function notify(message, type = 'info') {
    if (typeof window.notify === 'function') {
      window.notify(message, type);
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeLookupKey(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function formatCurrencyBRL(value) {
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(amount);
    } catch (_) {
      return `R$ ${amount.toFixed(2).replace('.', ',')}`;
    }
  }

  function formatDecimalInputBR(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    return amount.toFixed(2).replace('.', ',');
  }

  function parseCurrencyInput(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const onlyNumbersAndSeparators = raw.replace(/[^\d,.-]/g, '');
    const negative = onlyNumbersAndSeparators.includes('-');
    const lastComma = onlyNumbersAndSeparators.lastIndexOf(',');
    const lastDot = onlyNumbersAndSeparators.lastIndexOf('.');
    const decimalIndex = Math.max(lastComma, lastDot);
    let normalized;
    if (decimalIndex >= 0) {
      const intPart = onlyNumbersAndSeparators.slice(0, decimalIndex).replace(/[^\d]/g, '');
      const decPart = onlyNumbersAndSeparators.slice(decimalIndex + 1).replace(/[^\d]/g, '');
      normalized = `${intPart || '0'}.${decPart}`;
    } else {
      normalized = onlyNumbersAndSeparators.replace(/[^\d]/g, '');
    }
    if (negative && normalized) normalized = `-${normalized}`;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getSelectedCaixa() {
    const caixaId = qs('#cashcheck-caixa')?.value || '';
    if (!caixaId) return null;
    return (state.caixas || []).find((item, index) => String(item?.id || `caixa-${index}`) === String(caixaId)) || null;
  }

  function getSelectedCaixaPrevistoMap() {
    const caixa = getSelectedCaixa();
    if (!caixa) return new Map();
    const snapshots = Array.isArray(caixa?.caixaInfo?.previstoPagamentos)
      ? caixa.caixaInfo.previstoPagamentos
      : (Array.isArray(caixa?.caixaInfoSnapshot?.previstoPagamentos) ? caixa.caixaInfoSnapshot.previstoPagamentos : []);
    return buildPaymentSnapshotValueMap(snapshots);
  }

  function getSelectedCaixaPagamentosMap() {
    const caixa = getSelectedCaixa();
    if (!caixa) return new Map();
    const snapshots = Array.isArray(caixa?.pagamentos)
      ? caixa.pagamentos
      : (Array.isArray(caixa?.caixaInfo?.pagamentos) ? caixa.caixaInfo.pagamentos : []);
    return buildPaymentSnapshotValueMap(snapshots);
  }

  function getSelectedCaixaApuradoMap() {
    const caixa = getSelectedCaixa();
    if (!caixa) return new Map();
    const caixaAberto = caixa?.status === 'aberto' || caixa?.aberto === true;
    if (caixaAberto) {
      // Caixa aberto ainda não tem apuração de fechamento.
      return new Map();
    }
    const snapshots = Array.isArray(caixa?.caixaInfo?.apuradoPagamentos)
      ? caixa.caixaInfo.apuradoPagamentos
      : (Array.isArray(caixa?.caixaInfoSnapshot?.apuradoPagamentos) ? caixa.caixaInfoSnapshot.apuradoPagamentos : []);
    const apuradoMap = buildPaymentSnapshotValueMap(snapshots);
    if (apuradoMap.size > 0) return apuradoMap;

    // Fallback para históricos fechados sem snapshot de apurado.
    const pagamentosMap = getSelectedCaixaPagamentosMap();
    if (pagamentosMap.size > 0) return pagamentosMap;
    return pagamentosMap;
  }

  function buildPaymentSnapshotValueMap(snapshots) {
    const map = new Map();
    (Array.isArray(snapshots) ? snapshots : []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const value = Number(entry.valor || 0);
      const keys = new Set([
        normalizeLookupKey(entry.id),
        normalizeLookupKey(entry.label),
        normalizeLookupKey(entry.type),
      ]);
      if (Array.isArray(entry.aliases)) {
        entry.aliases.forEach((alias) => keys.add(normalizeLookupKey(alias)));
      }
      keys.forEach((key) => {
        if (!key) return;
        if (!map.has(key)) {
          map.set(key, Number.isFinite(value) ? value : 0);
        }
      });
    });
    return map;
  }

  function getExpectedValueForPaymentMethod(method, previstoMap) {
    const keys = [
      method?._id,
      method?.id,
      method?.code,
      method?.name,
      method?.nome,
      method?.type,
      method?.descricao,
    ].map(normalizeLookupKey).filter(Boolean);

    for (const key of keys) {
      if (previstoMap.has(key)) {
        return Number(previstoMap.get(key) || 0);
      }
    }
    return 0;
  }

  function getMappedValueForPaymentMethod(method, valuesMap) {
    return getExpectedValueForPaymentMethod(method, valuesMap);
  }

  function isCashLikePaymentMethod(method) {
    const candidates = [
      method?._id,
      method?.id,
      method?.code,
      method?.name,
      method?.nome,
      method?.type,
      method?.descricao,
      ...(Array.isArray(method?.aliases) ? method.aliases : []),
    ].map(normalizeLookupKey).filter(Boolean);
    return candidates.some((value) =>
      ['dinheiro', 'cash', 'especie', 'espécie', 'moeda'].some((term) => value.includes(normalizeLookupKey(term)))
    );
  }

  function setTodayDefaults() {
    const start = qs('#cashcheck-start');
    const end = qs('#cashcheck-end');
    if (!start || !end) return;
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    if (!start.value) start.value = iso;
    if (!end.value) end.value = iso;
  }

  function renderTabs() {
    const buttons = qsa('[data-cashcheck-tab]');
    const panels = qsa('[data-cashcheck-panel]');
    buttons.forEach((button) => {
      const isActive = button.getAttribute('data-cashcheck-tab') === state.activeTab;
      button.setAttribute('aria-selected', String(isActive));
      button.classList.toggle('border-primary', isActive);
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-transparent', !isActive);
      button.classList.toggle('text-gray-500', !isActive);
    });
    panels.forEach((panel) => {
      const isActive = panel.getAttribute('data-cashcheck-panel') === state.activeTab;
      panel.classList.toggle('hidden', !isActive);
    });
  }

  function handleTabClick(event) {
    const button = event.target.closest('[data-cashcheck-tab]');
    if (!button) return;
    const next = button.getAttribute('data-cashcheck-tab');
    if (!next || next === state.activeTab) return;
    state.activeTab = next;
    renderTabs();
  }

  function setFeedback(message) {
    const el = qs('#cashcheck-feedback');
    if (!el) return;
    el.innerHTML = '<i class="fas fa-circle-info text-primary"></i><span>' + String(message || '') + '</span>';
  }

  function getFiltersCompactSummaryText() {
    const companyId = qs('#cashcheck-company')?.value || '';
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const caixaLabel = qs('#cashcheck-caixa')?.selectedOptions?.[0]?.textContent?.trim() || 'Selecione um caixa';
    const start = qs('#cashcheck-start')?.value || '—';
    const end = qs('#cashcheck-end')?.value || '—';
    const company = companyId ? getCompanyLabelById(companyId) : 'Sem empresa';
    const pdv = pdvId ? getPdvLabelById(pdvId) : 'Sem PDV';
    return `${company} • ${pdv} • ${caixaLabel} • ${start} até ${end}`;
  }

  function renderFiltersCollapse() {
    const body = qs('#cashcheck-filters-body');
    const summary = qs('#cashcheck-filters-compact-summary');
    const toggle = qs('#cashcheck-filters-toggle');
    if (!body || !summary || !toggle) return;

    body.classList.toggle('hidden', state.filtersCollapsed);
    summary.classList.toggle('hidden', !state.filtersCollapsed);
    summary.textContent = getFiltersCompactSummaryText();

    const icon = toggle.querySelector('i');
    const labelNode = Array.from(toggle.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (icon) {
      icon.classList.toggle('fa-chevron-up', !state.filtersCollapsed);
      icon.classList.toggle('fa-chevron-down', state.filtersCollapsed);
    }
    const label = state.filtersCollapsed ? 'Mostrar filtros' : 'Ocultar filtros';
    if (labelNode) {
      labelNode.textContent = ` ${label}`;
    } else {
      toggle.append(` ${label}`);
    }
  }

  function setFiltersCollapsed(next) {
    state.filtersCollapsed = Boolean(next);
    renderFiltersCollapse();
  }

  function getSelectedCaixaHistory() {
    const caixa = getSelectedCaixa();
    if (!caixa) return [];
    if (Array.isArray(caixa.history) && caixa.history.length) return caixa.history;
    const isOpenSession = caixa?.status === 'aberto' || caixa?.aberto === true;
    if (isOpenSession && Array.isArray(state.currentPdvSnapshot?.history)) {
      return state.currentPdvSnapshot.history;
    }
    if (Array.isArray(caixa.caixaInfo?.historico)) return caixa.caixaInfo.historico;
    if (Array.isArray(caixa.caixaInfoSnapshot?.historico)) return caixa.caixaInfoSnapshot.historico;
    return [];
  }

  function getSelectedCaixaCompletedSales() {
    const caixa = getSelectedCaixa();
    if (!caixa) return [];
    if (Array.isArray(caixa.completedSales) && caixa.completedSales.length) return caixa.completedSales;
    const isOpenSession = caixa?.status === 'aberto' || caixa?.aberto === true;
    if (isOpenSession && Array.isArray(state.currentPdvSnapshot?.completedSales)) {
      return state.currentPdvSnapshot.completedSales;
    }
    return [];
  }

  function extractSaleCodeFromHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const actionId = normalizeLookupKey(entry?.id);
    const label = String(entry?.label || '').trim();
    const paymentLabel = String(entry?.paymentLabel || '').trim();
    if (actionId && actionId !== 'venda') return '';

    const directFromPayment = paymentLabel.split('•')[0]?.trim() || '';
    if (/^PDV[\w-]+$/i.test(directFromPayment) || /^PDV\d+/i.test(directFromPayment)) {
      return directFromPayment;
    }
    const sourceText = `${label} ${paymentLabel}`;
    const match = sourceText.match(/\bPDV[\w-]*\d+\b/i);
    return match ? String(match[0]).trim() : '';
  }

  function getSelectedCaixaSaleCodeSet() {
    const history = getSelectedCaixaHistory();
    const set = new Set();
    history.forEach((entry) => {
      const code = extractSaleCodeFromHistoryEntry(entry);
      if (code) set.add(code);
    });
    return set;
  }

  function filterSalesForSelectedCaixa(sales, caixa) {
    const list = Array.isArray(sales) ? sales : [];
    const saleCodeSet = getSelectedCaixaSaleCodeSet();
    if (saleCodeSet.size > 0) {
      return list.filter((sale) => {
        const code = String(sale?.saleCode || sale?.saleCodeLabel || '').trim();
        return code && saleCodeSet.has(code);
      });
    }
    return list.filter((sale) => isSaleWithinCaixaPeriod(sale, caixa));
  }

  function isCashMovementEntryAllowed(entry) {
    const actionId = normalizeLookupKey(entry?.id);
    const label = normalizeLookupKey(entry?.label);
    const motivo = normalizeLookupKey(entry?.motivo);

    const allowedIds = new Set([
      'abertura',
      'entrada',
      'saida',
      'envio',
      'fechamento',
      'recebimento-cliente',
    ]);
    if (actionId && allowedIds.has(actionId)) {
      return true;
    }

    // Fallback para registros antigos sem `id` consistente.
    if (actionId === 'venda' || actionId === 'cancelamento-venda') {
      return false;
    }
    const merged = `${label} ${motivo}`.trim();
    if (/(^|\s)venda(\s|$)/.test(merged) || merged.includes('cancelamento da venda')) {
      return false;
    }
    if (merged.includes('recebimentos de cliente') || merged.includes('recebimento de cliente')) {
      return true;
    }
    return ['abertura de caixa', 'entrada', 'saida', 'saída', 'envio', 'tesouraria', 'fechamento']
      .some((term) => merged.includes(normalizeLookupKey(term)));
  }

  function inferMovementTypeLabel(entry) {
    const actionId = normalizeLookupKey(entry?.id);
    const label = normalizeLookupKey(entry?.label);
    const motivo = normalizeLookupKey(entry?.motivo);
    const merged = `${label} ${motivo}`.trim();
    if (actionId === 'saida') return 'Saída';
    if (actionId === 'envio') return 'Envio à tesouraria';
    if (actionId === 'abertura') return 'Abertura de caixa';
    if (actionId === 'fechamento') return 'Fechamento de caixa';
    if (merged.includes('troco')) return 'Entrada de troco';
    if (merged.includes('tesouraria') && (merged.includes('envio') || merged.includes('sangria'))) return 'Envio à tesouraria';
    if (merged.includes('tesouraria') && (merged.includes('retorno') || merged.includes('receb'))) return 'Retorno da tesouraria';
    const amount = Number(entry?.delta ?? entry?.amount ?? 0);
    if (amount < 0) return 'Saída';
    return 'Entrada';
  }

  function inferMovementAmount(entry) {
    const delta = Number(entry?.delta ?? 0);
    if (Number.isFinite(delta) && delta !== 0) return delta;
    const amount = Number(entry?.amount ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  function renderMovementsPanel() {
    const tbody = qs('#cashcheck-movements-body');
    const totalEntradaEl = qs('#cashcheck-movements-total-entrada');
    const totalSaidaEl = qs('#cashcheck-movements-total-saida');
    const totalTrocoEl = qs('#cashcheck-movements-total-troco');
    const totalTesourariaEl = qs('#cashcheck-movements-total-tesouraria');
    if (!tbody) return;

    const companyId = qs('#cashcheck-company')?.value || '';
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const caixa = getSelectedCaixa();
    const resetTotals = () => {
      if (totalEntradaEl) totalEntradaEl.textContent = formatCurrencyBRL(0);
      if (totalSaidaEl) totalSaidaEl.textContent = formatCurrencyBRL(0);
      if (totalTrocoEl) totalTrocoEl.textContent = formatCurrencyBRL(0);
      if (totalTesourariaEl) totalTesourariaEl.textContent = formatCurrencyBRL(0);
    };

    if (!companyId || !pdvId || !caixa) {
      resetTotals();
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-8 text-center text-gray-500">
            Selecione empresa, PDV, caixa e período para carregar as movimentações.
          </td>
        </tr>`;
      return;
    }

    const history = getSelectedCaixaHistory().filter(isCashMovementEntryAllowed);
    if (!history.length) {
      resetTotals();
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-8 text-center text-gray-500">
            Nenhuma movimentação de Caixa/Recebimentos de Cliente encontrada para o caixa selecionado.
          </td>
        </tr>`;
      return;
    }

    let totalEntrada = 0;
    let totalSaida = 0;
    let totalTroco = 0;
    let totalTesouraria = 0;

    const rows = history
      .slice()
      .sort((a, b) => new Date(b?.timestamp || 0).getTime() - new Date(a?.timestamp || 0).getTime())
      .map((entry) => {
        const amount = inferMovementAmount(entry);
        const absAmount = Math.abs(amount);
        const typeLabel = inferMovementTypeLabel(entry);
        const timestamp = formatDateTimeLabel(entry?.timestamp) || '-';
        const motivo = entry?.motivo || entry?.label || '-';
        const meio = entry?.paymentLabel || entry?.paymentId || '-';
        const responsavel = entry?.userName || entry?.responsavel || entry?.userLogin || entry?.usuario || '-';

        if (typeLabel === 'Entrada de troco') totalTroco += absAmount;
        if (typeLabel === 'Envio à tesouraria') totalTesouraria += absAmount;
        if (amount < 0) totalSaida += absAmount;
        else totalEntrada += absAmount;

        const amountClass = amount < 0 ? 'text-rose-600' : 'text-emerald-600';
        const amountPrefix = amount < 0 ? '-' : '+';

        return `
          <tr>
            <td class="px-4 py-3 text-gray-700 whitespace-nowrap">${escapeHtml(timestamp)}</td>
            <td class="px-4 py-3 text-gray-700">${escapeHtml(typeLabel)}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(motivo)}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(meio)}</td>
            <td class="px-4 py-3 text-right font-medium ${amountClass}">${amountPrefix} ${escapeHtml(formatCurrencyBRL(absAmount))}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(responsavel)}</td>
          </tr>`;
      });

    if (totalEntradaEl) totalEntradaEl.textContent = formatCurrencyBRL(totalEntrada);
    if (totalSaidaEl) totalSaidaEl.textContent = formatCurrencyBRL(totalSaida);
    if (totalTrocoEl) totalTrocoEl.textContent = formatCurrencyBRL(totalTroco);
    if (totalTesourariaEl) totalTesourariaEl.textContent = formatCurrencyBRL(totalTesouraria);
    tbody.innerHTML = rows.join('');
  }

  function formatNumberPtBr(value, { min = 0, max = 3 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    try {
      return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: min,
        maximumFractionDigits: max,
      }).format(numeric);
    } catch (_) {
      return String(numeric);
    }
  }

  function looksLikeObjectId(value) {
    return /^[a-f0-9]{24}$/i.test(String(value || '').trim());
  }

  function detectServiceCategoryFromText(value) {
    const text = normalizeLookupKey(value);
    if (!text) return '';
    if ([
      'internacao', 'internação', 'diaria', 'diária', 'leito', 'enfermaria', 'internamento',
    ].some((term) => text.includes(normalizeLookupKey(term)))) {
      return 'internacao';
    }
    if ([
      'banho', 'tosa', 'hidrat', 'escov', 'desembolo', 'higienica', 'higiênica', 'perfume',
    ].some((term) => text.includes(normalizeLookupKey(term)))) {
      return 'banho-tosa';
    }
    if ([
      'consulta', 'vacina', 'retorno', 'exame', 'ultrassom', 'raio x', 'raiox', 'procedimento',
      'cirurgia', 'veterin', 'clinica', 'clínica', 'atendimento',
    ].some((term) => text.includes(normalizeLookupKey(term)))) {
      return 'veterinario';
    }
    return '';
  }

  function normalizeSaleLineRowsFromSales(sales) {
    const rows = [];
    (Array.isArray(sales) ? sales : []).forEach((sale) => {
      if (!sale || typeof sale !== 'object') return;
      if (String(sale.status || '').toLowerCase() === 'cancelled') return;

      const items = Array.isArray(sale.items) ? sale.items : [];
      const fiscalItems = Array.isArray(sale.fiscalItemsSnapshot) ? sale.fiscalItemsSnapshot : [];

      items.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const quantity = Number(item.quantity ?? item.quantidade ?? 0);
        if (!(Number.isFinite(quantity) && quantity > 0)) return;

        const saleUnit = Number(item.unitValue ?? item.valorUnitario ?? item.valor ?? item.preco ?? 0);
        const lineTotal = Number(item.totalValue ?? item.subtotal ?? item.total ?? saleUnit * quantity);
        const fiscal = fiscalItems[index] && typeof fiscalItems[index] === 'object' ? fiscalItems[index] : null;
        const productSnapshot = fiscal?.productSnapshot && typeof fiscal.productSnapshot === 'object'
          ? fiscal.productSnapshot
          : null;

        const code = item.codigoInterno || item.codigo || fiscal?.internalCode || productSnapshot?.cod || productSnapshot?.codigo || '';
        const barcode = item.barcode || item.codigoBarras || fiscal?.barcode || productSnapshot?.codbarras || productSnapshot?.codigoBarras || '';
        const name = item.product || item.nome || fiscal?.name || productSnapshot?.nome || 'Produto';
        const categoryFromName = detectServiceCategoryFromText(name);
        const categoryFromCode = detectServiceCategoryFromText(code);
        const inferredServiceCategory = categoryFromName || categoryFromCode;
        const hasProductSnapshot = Boolean(productSnapshot);
        const hasProductReference = Boolean(
          fiscal?.productId ||
          item?.productId ||
          item?.produtoId
        );
        const hasBarcode = Boolean(String(barcode || '').trim());
        const rawId = item?.id || '';
        const looksServiceByStructure =
          !hasProductReference &&
          !hasProductSnapshot &&
          !hasBarcode &&
          /serv/i.test(String(name || ''));
        const isService = Boolean(inferredServiceCategory) || looksServiceByStructure;
        const serviceCategory = inferredServiceCategory || (isService ? 'veterinario' : '');

        const rawCostCandidates = [
          item.unitCost,
          fiscal?.unitCost,
          productSnapshot?.custo,
          productSnapshot?.custoAtual,
          productSnapshot?.precoCusto,
        ];
        const cost = rawCostCandidates.map((v) => Number(v)).find((v) => Number.isFinite(v) && v >= 0);
        const normalizedSaleUnit = Number.isFinite(saleUnit) ? saleUnit : Number(fiscal?.unitPrice ?? 0);
        const normalizedTotal = Number.isFinite(lineTotal)
          ? lineTotal
          : (Number.isFinite(normalizedSaleUnit) ? normalizedSaleUnit * quantity : 0);
        const markupPct =
          Number.isFinite(cost) && cost > 0 && Number.isFinite(normalizedSaleUnit)
            ? ((normalizedSaleUnit - cost) / cost) * 100
            : null;

        rows.push({
          id: `${sale.id || 'sale'}-${index}`,
          code: String(code || ''),
          barcode: String(barcode || ''),
          name: String(name || 'Produto'),
          isService,
          serviceCategory,
          cost: Number.isFinite(cost) ? cost : null,
          markupPct: Number.isFinite(markupPct) ? markupPct : null,
          saleUnit: Number.isFinite(normalizedSaleUnit) ? normalizedSaleUnit : 0,
          quantity,
          total: Number.isFinite(normalizedTotal) ? normalizedTotal : 0,
          saleCode: sale.saleCode || sale.saleCodeLabel || '',
        });
      });
    });
    return rows;
  }

  function normalizeSoldProductRowsFromSales(sales) {
    return normalizeSaleLineRowsFromSales(sales).filter((row) => !row.isService);
  }

  function isSaleWithinCaixaPeriod(sale, caixa) {
    if (!sale || !caixa) return false;
    const createdAt = sale?.createdAt ? new Date(sale.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return false;

    const abertura = caixa?.aberturaData ? new Date(caixa.aberturaData) : null;
    const fechamento = caixa?.fechamentoData ? new Date(caixa.fechamentoData) : null;
    const start = abertura && !Number.isNaN(abertura.getTime()) ? abertura : null;
    const end = fechamento && !Number.isNaN(fechamento.getTime()) ? fechamento : null;

    if (start && createdAt < start) return false;
    if (end && createdAt > end) return false;
    return true;
  }

  function renderProductsSoldPanel() {
    const tbody = qs('#cashcheck-products-body');
    const countEl = qs('#cashcheck-products-count');
    const qtyTotalEl = qs('#cashcheck-products-qty-total');
    const totalEl = qs('#cashcheck-products-total');
    if (!tbody) return;

    const companyId = qs('#cashcheck-company')?.value || '';
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const caixa = getSelectedCaixa();
    const resetSummary = () => {
      if (countEl) countEl.textContent = '0';
      if (qtyTotalEl) qtyTotalEl.textContent = '0';
      if (totalEl) totalEl.textContent = formatCurrencyBRL(0);
    };

    if (!companyId || !pdvId || !caixa) {
      resetSummary();
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="px-4 py-8 text-center text-gray-500">
            Selecione empresa, PDV, caixa e período para carregar os produtos vendidos.
          </td>
        </tr>`;
      return;
    }

    const salesWithinCaixa = filterSalesForSelectedCaixa(getSelectedCaixaCompletedSales(), caixa);
    const allRows = normalizeSoldProductRowsFromSales(salesWithinCaixa);
    const searchTerm = normalizeLookupKey(qs('#cashcheck-products-search')?.value || '');
    const rows = searchTerm
      ? allRows.filter((row) =>
          [row.code, row.barcode, row.name, row.saleCode].some((value) => normalizeLookupKey(value).includes(searchTerm))
        )
      : allRows;

    if (!rows.length) {
      resetSummary();
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="px-4 py-8 text-center text-gray-500">
            Nenhum produto vendido encontrado para o caixa selecionado.
          </td>
        </tr>`;
      return;
    }

    const qtyTotal = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    const grandTotal = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    if (countEl) countEl.textContent = formatNumberPtBr(rows.length, { min: 0, max: 0 });
    if (qtyTotalEl) qtyTotalEl.textContent = formatNumberPtBr(qtyTotal, { min: 0, max: 3 });
    if (totalEl) totalEl.textContent = formatCurrencyBRL(grandTotal);

    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td class="px-4 py-3 text-gray-600 whitespace-nowrap">${escapeHtml(row.code || '—')}</td>
        <td class="px-4 py-3 text-gray-600 whitespace-nowrap">${escapeHtml(row.barcode || '—')}</td>
        <td class="px-4 py-3 text-gray-700">${escapeHtml(row.name || 'Produto')}</td>
        <td class="px-4 py-3 text-right text-gray-600 whitespace-nowrap">${row.cost == null ? '—' : escapeHtml(formatCurrencyBRL(row.cost))}</td>
        <td class="px-4 py-3 text-right text-gray-600 whitespace-nowrap">${row.markupPct == null ? '—' : `${escapeHtml(formatNumberPtBr(row.markupPct, { min: 2, max: 2 }))}%`}</td>
        <td class="px-4 py-3 text-right text-gray-600 whitespace-nowrap">${escapeHtml(formatCurrencyBRL(row.saleUnit))}</td>
        <td class="px-4 py-3 text-right text-gray-600 whitespace-nowrap">${escapeHtml(formatNumberPtBr(row.quantity, { min: 0, max: 3 }))}</td>
        <td class="px-4 py-3 text-right font-medium text-gray-800 whitespace-nowrap">${escapeHtml(formatCurrencyBRL(row.total))}</td>
      </tr>
    `).join('');
  }

  function renderServiceCategoryPanel(category, config) {
    const tbody = qs(config.bodySelector);
    const countEl = qs(config.countSelector);
    const qtyEl = qs(config.qtySelector);
    const totalEl = qs(config.totalSelector);
    if (!tbody) return;

    const companyId = qs('#cashcheck-company')?.value || '';
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const caixa = getSelectedCaixa();
    const resetSummary = () => {
      if (countEl) countEl.textContent = '0';
      if (qtyEl) qtyEl.textContent = '0';
      if (totalEl) totalEl.textContent = formatCurrencyBRL(0);
    };

    if (!companyId || !pdvId || !caixa) {
      resetSummary();
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Selecione empresa, PDV e caixa.</td></tr>';
      return;
    }

    const salesWithinCaixa = filterSalesForSelectedCaixa(getSelectedCaixaCompletedSales(), caixa);
    const rows = normalizeSaleLineRowsFromSales(salesWithinCaixa).filter(
      (row) => row.isService && row.serviceCategory === category
    );

    if (!rows.length) {
      resetSummary();
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Nenhum serviço encontrado para este caixa.</td></tr>';
      return;
    }

    const qtyTotal = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    const total = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    if (countEl) countEl.textContent = formatNumberPtBr(rows.length, { min: 0, max: 0 });
    if (qtyEl) qtyEl.textContent = formatNumberPtBr(qtyTotal, { min: 0, max: 3 });
    if (totalEl) totalEl.textContent = formatCurrencyBRL(total);

    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td class="px-4 py-3 text-gray-600 whitespace-nowrap">${escapeHtml(row.code || '—')}</td>
        <td class="px-4 py-3 text-gray-700">${escapeHtml(row.name || 'Serviço')}</td>
        <td class="px-4 py-3 text-right text-gray-600 whitespace-nowrap">${escapeHtml(formatCurrencyBRL(row.saleUnit))}</td>
        <td class="px-4 py-3 text-right text-gray-600 whitespace-nowrap">${escapeHtml(formatNumberPtBr(row.quantity, { min: 0, max: 3 }))}</td>
        <td class="px-4 py-3 text-right font-medium text-gray-800 whitespace-nowrap">${escapeHtml(formatCurrencyBRL(row.total))}</td>
      </tr>
    `).join('');
  }

  function renderServicePanels() {
    renderServiceCategoryPanel('banho-tosa', {
      bodySelector: '#cashcheck-services-banho-body',
      countSelector: '#cashcheck-services-banho-count',
      qtySelector: '#cashcheck-services-banho-qty',
      totalSelector: '#cashcheck-services-banho-total',
    });
    renderServiceCategoryPanel('veterinario', {
      bodySelector: '#cashcheck-services-vet-body',
      countSelector: '#cashcheck-services-vet-count',
      qtySelector: '#cashcheck-services-vet-qty',
      totalSelector: '#cashcheck-services-vet-total',
    });
    renderServiceCategoryPanel('internacao', {
      bodySelector: '#cashcheck-services-internacao-body',
      countSelector: '#cashcheck-services-internacao-count',
      qtySelector: '#cashcheck-services-internacao-qty',
      totalSelector: '#cashcheck-services-internacao-total',
    });
  }

  function renderConferencePaymentMethods() {
    const tbody = qs('#cashcheck-conference-payment-methods-body');
    if (!tbody) return;

    const companyId = qs('#cashcheck-company')?.value || '';
    if (!companyId) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">
            Selecione uma empresa para carregar os meios de pagamento.
          </td>
        </tr>`;
      updateConferenceTotals();
      return;
    }

    if (state.loadingPaymentMethods) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">
            Carregando meios de pagamento...
          </td>
        </tr>`;
      updateConferenceTotals();
      return;
    }

    if (!Array.isArray(state.paymentMethods) || !state.paymentMethods.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">
            Nenhum meio de pagamento cadastrado para a empresa selecionada.
          </td>
        </tr>`;
      updateConferenceTotals();
      return;
    }

    const previstoMap = getSelectedCaixaPrevistoMap();
    const apuradoMap = getSelectedCaixaApuradoMap();
    tbody.innerHTML = state.paymentMethods.map((method) => {
      const methodId = String(method?._id || method?.id || '');
      const label = escapeHtml(
        method?.nome || method?.name || method?.descricao || method?.descricaoExibicao || 'Meio de pagamento'
      );
      let previsto = getExpectedValueForPaymentMethod(method, previstoMap);
      const aberturaCaixa = Number(getSelectedCaixa()?.summary?.abertura || 0);
      if (Number.isFinite(aberturaCaixa) && aberturaCaixa > 0 && isCashLikePaymentMethod(method)) {
        previsto += aberturaCaixa;
      }
      const apurado = getMappedValueForPaymentMethod(method, apuradoMap);
      const hasApuradoMapValue = apuradoMap.size > 0 && (
        getMappedValueForPaymentMethod(method, apuradoMap) !== 0 ||
        [
          method?._id,
          method?.id,
          method?.code,
          method?.name,
          method?.nome,
          method?.type,
          method?.descricao,
        ].map(normalizeLookupKey).filter(Boolean).some((key) => apuradoMap.has(key))
      );
      return `
        <tr data-payment-method-id="${escapeHtml(methodId)}">
          <td class="px-4 py-3 text-gray-700">${label}</td>
          <td class="px-4 py-3 text-right text-gray-600" data-cashcheck-previsto="${escapeHtml(previsto)}">${formatCurrencyBRL(previsto)}</td>
          <td class="px-4 py-3 text-right">
            <input
              type="text"
              placeholder="0,00"
              data-cashcheck-apurado-input="true"
              value="${hasApuradoMapValue ? escapeHtml(formatDecimalInputBR(apurado)) : ''}"
              class="w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
          </td>
          <td class="px-4 py-3 text-right text-gray-600" data-cashcheck-diferenca="true">${formatCurrencyBRL(0)}</td>
          <td class="px-4 py-3">
            <input
              type="text"
              class="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:ring-1 focus:ring-primary/20"
              placeholder="Observação"
            >
          </td>
        </tr>`;
    }).join('');
    updateConferenceTotals();
  }

  function updateConferenceTotals() {
    const tbody = qs('#cashcheck-conference-payment-methods-body');
    const totalPrevistoEl = qs('#cashcheck-total-previsto');
    const totalApuradoEl = qs('#cashcheck-total-apurado');
    const totalDiferencaEl = qs('#cashcheck-total-diferenca');
    const statusEl = qs('#cashcheck-status');

    if (!tbody) return;

    let totalPrevisto = 0;
    let totalApurado = 0;
    let totalDiferenca = 0;
    let hasRows = false;
    let hasUserInput = false;

    qsa('tr[data-payment-method-id]', tbody).forEach((row) => {
      hasRows = true;
      const previstoCell = qs('[data-cashcheck-previsto]', row);
      const apuradoInput = qs('[data-cashcheck-apurado-input]', row);
      const diferencaCell = qs('[data-cashcheck-diferenca]', row);

      const previsto = parseCurrencyInput(previstoCell?.getAttribute('data-cashcheck-previsto') || previstoCell?.textContent || 0);
      const apuradoRaw = apuradoInput?.value || '';
      const apurado = parseCurrencyInput(apuradoRaw);
      const diferenca = apurado - previsto;

      if (apuradoRaw.trim()) hasUserInput = true;

      totalPrevisto += previsto;
      totalApurado += apurado;
      totalDiferenca += diferenca;

      if (diferencaCell) {
        diferencaCell.textContent = formatCurrencyBRL(diferenca);
        diferencaCell.classList.toggle('text-gray-600', Math.abs(diferenca) < 0.005);
        diferencaCell.classList.toggle('text-emerald-600', diferenca > 0.004);
        diferencaCell.classList.toggle('text-rose-600', diferenca < -0.004);
      }
    });

    if (totalPrevistoEl) totalPrevistoEl.textContent = formatCurrencyBRL(totalPrevisto);
    if (totalApuradoEl) totalApuradoEl.textContent = formatCurrencyBRL(totalApurado);
    if (totalDiferencaEl) {
      totalDiferencaEl.textContent = formatCurrencyBRL(totalDiferenca);
      totalDiferencaEl.classList.toggle('text-amber-600', Math.abs(totalDiferenca) >= 0.005);
      totalDiferencaEl.classList.toggle('text-emerald-600', Math.abs(totalDiferenca) < 0.005);
    }
    if (statusEl) {
      let label = 'Aguardando conferência';
      statusEl.classList.remove('text-gray-700', 'text-amber-700', 'text-emerald-700');
      if (hasRows && hasUserInput) {
        if (Math.abs(totalDiferenca) < 0.005) {
          label = 'Conferido sem diferença';
          statusEl.classList.add('text-emerald-700');
        } else {
          label = 'Com divergência';
          statusEl.classList.add('text-amber-700');
        }
      } else {
        statusEl.classList.add('text-gray-700');
      }
      statusEl.textContent = label;
    }
  }

  function getCompanyLabelById(id) {
    const company = (state.companies || []).find((item) => String(item?._id || '') === String(id || ''));
    return company?.nomeFantasia || company?.nome || company?.razaoSocial || String(id || '');
  }

  function getPdvLabelById(id) {
    const pdv = (state.pdvs || []).find((item) => String(item?._id || '') === String(id || ''));
    return pdv?.apelido || pdv?.nome || pdv?.codigo || String(id || '');
  }

  function populateCompanySelect() {
    const select = qs('#cashcheck-company');
    if (!select) return;
    const options = ['<option value="">Selecione uma empresa</option>'];
    (state.companies || []).forEach((company) => {
      const id = String(company?._id || '');
      if (!id) return;
      const label = company?.nomeFantasia || company?.nome || company?.razaoSocial || 'Empresa sem nome';
      options.push(`<option value="${id}">${label}</option>`);
    });
    select.innerHTML = options.join('');
  }

  function populatePdvSelect() {
    const select = qs('#cashcheck-pdv');
    if (!select) return;
    const companyId = qs('#cashcheck-company')?.value || '';
    if (!companyId) {
      select.innerHTML = '<option value="">Selecione uma empresa</option>';
      return;
    }
    const options = ['<option value="">Selecione um PDV</option>'];
    (state.pdvs || []).forEach((pdv) => {
      const id = String(pdv?._id || '');
      if (!id) return;
      const label = pdv?.apelido || pdv?.nome || pdv?.codigo || 'PDV sem nome';
      options.push(`<option value="${id}">${label}</option>`);
    });
    if (!state.pdvs.length) {
      options.push('<option value="" disabled>Nenhum PDV encontrado</option>');
    }
    select.innerHTML = options.join('');
  }

  function formatDateTimeLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
    } catch (_) {
      return date.toISOString();
    }
  }

  function buildCaixaOptionLabel(caixa) {
    const status = caixa?.status === 'aberto' ? 'Aberto' : 'Fechado';
    const abertura = formatDateTimeLabel(caixa?.aberturaData);
    const fechamento = formatDateTimeLabel(caixa?.fechamentoData);
    const periodLabel = fechamento ? `${abertura} → ${fechamento}` : (abertura ? `Desde ${abertura}` : 'Sem período');
    return `${status} • ${periodLabel}`;
  }

  function populateCaixaSelect() {
    const select = qs('#cashcheck-caixa');
    if (!select) return;
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    if (!pdvId) {
      select.innerHTML = '<option value="">Selecione um PDV</option>';
      return;
    }
    const options = ['<option value="">Selecione um caixa</option>'];
    (state.caixas || []).forEach((caixa, index) => {
      const value = caixa?.id || `caixa-${index}`;
      options.push(`<option value="${value}">${buildCaixaOptionLabel(caixa)}</option>`);
    });
    if (!state.caixas.length) {
      options.push('<option value="" disabled>Nenhum caixa encontrado no período</option>');
    }
    select.innerHTML = options.join('');
  }

  function clearPdvAndCaixa() {
    state.pdvs = [];
    state.caixas = [];
    populatePdvSelect();
    populateCaixaSelect();
    renderMovementsPanel();
    renderProductsSoldPanel();
    renderServicePanels();
  }

  function getPeriodRange() {
    const startValue = qs('#cashcheck-start')?.value || '';
    const endValue = qs('#cashcheck-end')?.value || '';
    const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
    const end = endValue ? new Date(`${endValue}T23:59:59.999`) : null;
    return {
      start: start && !Number.isNaN(start.getTime()) ? start : null,
      end: end && !Number.isNaN(end.getTime()) ? end : null,
    };
  }

  function caixaMatchesSelectedPeriod(caixa) {
    if (!caixa) return false;
    const { start, end } = getPeriodRange();
    if (!start && !end) return true;
    const abertura = caixa?.aberturaData ? new Date(caixa.aberturaData) : null;
    const fechamento = caixa?.fechamentoData ? new Date(caixa.fechamentoData) : null;
    const openAt = abertura && !Number.isNaN(abertura.getTime()) ? abertura : null;
    const closeAt = fechamento && !Number.isNaN(fechamento.getTime()) ? fechamento : null;
    const intervalStart = openAt || closeAt;
    const intervalEnd = closeAt || openAt;
    if (!intervalStart && !intervalEnd) return true;
    const left = intervalStart || intervalEnd;
    const right = intervalEnd || intervalStart;
    if (start && right && right < start) return false;
    if (end && left && left > end) return false;
    return true;
  }

  async function fetchPdvsForSelectedCompany() {
    const companyId = qs('#cashcheck-company')?.value || '';
    const pdvSelect = qs('#cashcheck-pdv');
    state.pdvs = [];
    state.caixas = [];
    populatePdvSelect();
    populateCaixaSelect();
    if (!companyId) return;
    if (pdvSelect) {
      pdvSelect.disabled = true;
      pdvSelect.innerHTML = '<option value="">Carregando PDVs...</option>';
    }
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/pdvs?empresa=${encodeURIComponent(companyId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os PDVs da empresa selecionada.');
      }
      const payload = await response.json().catch(() => null);
      state.pdvs = Array.isArray(payload?.pdvs) ? payload.pdvs : [];
    } catch (error) {
      state.pdvs = [];
      notify(error?.message || 'Falha ao carregar PDVs.', 'error');
    } finally {
      populatePdvSelect();
      if (pdvSelect) pdvSelect.disabled = false;
    }
  }

  async function fetchPaymentMethodsForSelectedCompany() {
    const companyId = qs('#cashcheck-company')?.value || '';
    state.paymentMethods = [];
    state.loadingPaymentMethods = Boolean(companyId);
    renderConferencePaymentMethods();
    if (!companyId) return;

    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/payment-methods?company=${encodeURIComponent(companyId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os meios de pagamento da empresa selecionada.');
      }
      const payload = await response.json().catch(() => null);
      state.paymentMethods = Array.isArray(payload?.paymentMethods)
        ? payload.paymentMethods
        : (Array.isArray(payload?.methods) ? payload.methods : []);
    } catch (error) {
      state.paymentMethods = [];
      notify(error?.message || 'Falha ao carregar meios de pagamento.', 'error');
    } finally {
      state.loadingPaymentMethods = false;
      renderConferencePaymentMethods();
    }
  }

  async function fetchCaixasForSelectedPdv() {
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const caixaSelect = qs('#cashcheck-caixa');
    state.caixas = [];
    state.currentPdvSnapshot = null;
    populateCaixaSelect();
    if (!pdvId) return;
    if (caixaSelect) {
      caixaSelect.disabled = true;
      caixaSelect.innerHTML = '<option value="">Carregando caixas...</option>';
    }
    try {
      const token = getToken();
      const start = qs('#cashcheck-start')?.value || '';
      const end = qs('#cashcheck-end')?.value || '';
      const params = new URLSearchParams();
      if (start) params.set('start', `${start}T00:00:00.000Z`);
      if (end) params.set('end', `${end}T23:59:59.999Z`);
      const historyResponse = await fetch(
        `${API_BASE}/pdvs/${encodeURIComponent(pdvId)}/caixas${params.toString() ? `?${params.toString()}` : ''}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (historyResponse.ok) {
        const payload = await historyResponse.json().catch(() => null);
        state.caixas = Array.isArray(payload?.caixas) ? payload.caixas : [];
        // Fallback para sessões abertas antigas sem snapshots completos no histórico.
        try {
          const currentResponse = await fetch(`${API_BASE}/pdvs/${encodeURIComponent(pdvId)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (currentResponse.ok) {
            const pdv = await currentResponse.json().catch(() => null);
            state.currentPdvSnapshot = {
              completedSales: Array.isArray(pdv?.completedSales)
                ? pdv.completedSales
                : (Array.isArray(pdv?.caixa?.vendas) ? pdv.caixa.vendas : []),
              history: Array.isArray(pdv?.history)
                ? pdv.history
                : (Array.isArray(pdv?.caixa?.historico) ? pdv.caixa.historico : []),
              pagamentos: Array.isArray(pdv?.pagamentos)
                ? pdv.pagamentos
                : (Array.isArray(pdv?.caixa?.pagamentos) ? pdv.caixa.pagamentos : []),
            };
          }
        } catch (_) {
          // fallback silencioso
        }
        if (!state.caixas.length) {
          setFeedback('Nenhum caixa do PDV selecionado encontrado no período.');
        }
        return;
      }

      const response = await fetch(`${API_BASE}/pdvs/${encodeURIComponent(pdvId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os dados de caixa do PDV selecionado.');
      }
      const pdv = await response.json().catch(() => null);
      const caixaStatus = pdv?.caixa?.status || (pdv?.caixa?.aberto ? 'aberto' : 'fechado');
      const caixaInfo = pdv?.caixaInfo || pdv?.caixa || {};
      const snapshot = {
        id: `pdv-${pdvId}-atual`,
        status: caixaStatus,
        aberto: Boolean(pdv?.caixa?.aberto ?? pdv?.caixaAberto),
        aberturaData: caixaInfo?.aberturaData || pdv?.caixa?.aberturaData || null,
        fechamentoData: caixaInfo?.fechamentoData || pdv?.caixa?.fechamentoData || null,
        fechamentoPrevisto: caixaInfo?.fechamentoPrevisto || 0,
        fechamentoApurado: caixaInfo?.fechamentoApurado || 0,
        caixaInfo: caixaInfo || {},
        pagamentos: Array.isArray(pdv?.pagamentos)
          ? pdv.pagamentos
          : (Array.isArray(pdv?.caixa?.pagamentos) ? pdv.caixa.pagamentos : []),
        summary: pdv?.summary || pdv?.caixa?.resumo || {},
        history: Array.isArray(pdv?.history) ? pdv.history : (Array.isArray(pdv?.caixa?.historico) ? pdv.caixa.historico : []),
        completedSales: Array.isArray(pdv?.completedSales) ? pdv.completedSales : (Array.isArray(pdv?.caixa?.vendas) ? pdv.caixa.vendas : []),
      };
      state.currentPdvSnapshot = {
        completedSales: snapshot.completedSales,
        history: snapshot.history,
        pagamentos: snapshot.pagamentos,
      };
      state.caixas = caixaMatchesSelectedPeriod(snapshot) ? [snapshot] : [];
      if (!state.caixas.length) {
        setFeedback('Nenhum caixa do PDV selecionado encontrado no período (dados atuais/último caixa).');
      }
    } catch (error) {
      state.caixas = [];
      notify(error?.message || 'Falha ao carregar caixas do PDV.', 'error');
    } finally {
      populateCaixaSelect();
      if (caixaSelect) caixaSelect.disabled = false;
    }
  }

  async function fetchAllowedCompanies() {
    const select = qs('#cashcheck-company');
    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">Carregando empresas...</option>';
    }
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/stores/allowed`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar as empresas permitidas.');
      }
      const payload = await response.json().catch(() => null);
      const list = Array.isArray(payload?.stores) ? payload.stores : (Array.isArray(payload) ? payload : []);
      state.companies = Array.isArray(list) ? list : [];
      populateCompanySelect();
      if (!state.companies.length) {
        setFeedback('Nenhuma empresa permitida encontrada para este usuário.');
      }
    } catch (error) {
      state.companies = [];
      populateCompanySelect();
      setFeedback('Falha ao carregar empresas permitidas.');
      notify(error?.message || 'Falha ao carregar empresas permitidas.', 'error');
    } finally {
      if (select) {
        select.disabled = false;
      }
    }
  }

  function handleApplyFilters() {
    const companyId = qs('#cashcheck-company')?.value || '';
    const company = companyId ? getCompanyLabelById(companyId) : 'Selecione uma empresa';
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const pdv = pdvId ? getPdvLabelById(pdvId) : 'Selecione um PDV';
    const caixaValue = qs('#cashcheck-caixa')?.value || '';
    const caixa = caixaValue
      ? (qs('#cashcheck-caixa')?.selectedOptions?.[0]?.textContent?.trim() || caixaValue)
      : 'Selecione um caixa';
    const start = qs('#cashcheck-start')?.value || 'sem data inicial';
    const end = qs('#cashcheck-end')?.value || 'sem data final';
    setFeedback('Filtros aplicados: ' + company + ' / ' + pdv + ' / ' + caixa + ' / ' + start + ' até ' + end + '.');
    notify('Filtros aplicados na Conferência de Caixa.', 'success');
    setFiltersCollapsed(true);
  }

  function handleClearFilters() {
    const company = qs('#cashcheck-company');
    const pdv = qs('#cashcheck-pdv');
    const caixa = qs('#cashcheck-caixa');
    const start = qs('#cashcheck-start');
    const end = qs('#cashcheck-end');
    if (company) company.value = '';
    if (pdv) pdv.value = '';
    if (caixa) caixa.value = '';
    clearPdvAndCaixa();
    state.paymentMethods = [];
    state.loadingPaymentMethods = false;
    renderConferencePaymentMethods();
    renderMovementsPanel();
    renderProductsSoldPanel();
    renderServicePanels();
    if (start) start.value = '';
    if (end) end.value = '';
    setTodayDefaults();
    setFeedback('Filtros redefinidos para o período atual.');
    setFiltersCollapsed(false);
  }

  function bindEvents() {
    const tablist = qs('[role="tablist"]');
    tablist?.addEventListener('click', handleTabClick);
    qs('#cashcheck-apply')?.addEventListener('click', handleApplyFilters);
    qs('#cashcheck-clear')?.addEventListener('click', handleClearFilters);
    qs('#cashcheck-filters-toggle')?.addEventListener('click', () => {
      setFiltersCollapsed(!state.filtersCollapsed);
    });
    qs('#cashcheck-company')?.addEventListener('change', async () => {
      await Promise.all([
        fetchPdvsForSelectedCompany(),
        fetchPaymentMethodsForSelectedCompany(),
      ]);
      renderMovementsPanel();
      renderProductsSoldPanel();
      renderServicePanels();
      renderFiltersCollapse();
    });
    qs('#cashcheck-pdv')?.addEventListener('change', async () => {
      await fetchCaixasForSelectedPdv();
      renderConferencePaymentMethods();
      renderMovementsPanel();
      renderProductsSoldPanel();
      renderServicePanels();
      renderFiltersCollapse();
    });
    qs('#cashcheck-caixa')?.addEventListener('change', () => {
      renderConferencePaymentMethods();
      renderMovementsPanel();
      renderProductsSoldPanel();
      renderServicePanels();
      renderFiltersCollapse();
    });
    qs('#cashcheck-start')?.addEventListener('change', async () => {
      if (qs('#cashcheck-pdv')?.value) {
        await fetchCaixasForSelectedPdv();
        renderConferencePaymentMethods();
        renderMovementsPanel();
        renderProductsSoldPanel();
        renderServicePanels();
      }
      renderFiltersCollapse();
    });
    qs('#cashcheck-end')?.addEventListener('change', async () => {
      if (qs('#cashcheck-pdv')?.value) {
        await fetchCaixasForSelectedPdv();
        renderConferencePaymentMethods();
        renderMovementsPanel();
        renderProductsSoldPanel();
        renderServicePanels();
      }
      renderFiltersCollapse();
    });
    qs('#cashcheck-products-search')?.addEventListener('input', () => {
      renderProductsSoldPanel();
    });
    qs('#cashcheck-conference-payment-methods-body')?.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches('[data-cashcheck-apurado-input]')) return;
      updateConferenceTotals();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTodayDefaults();
    renderTabs();
    renderFiltersCollapse();
    renderConferencePaymentMethods();
    renderMovementsPanel();
    renderProductsSoldPanel();
    renderServicePanels();
    bindEvents();
    fetchAllowedCompanies();
    clearPdvAndCaixa();
  });
})();
