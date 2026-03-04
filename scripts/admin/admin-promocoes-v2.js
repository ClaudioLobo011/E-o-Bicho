(function () {
  const STORAGE_KEY = 'admin-promocoes-v2-draft';

  const state = {
    stores: [],
    items: [],
    importResults: [],
    importSelectedIds: new Set(),
    importSearchTimer: null,
    headerProductSearchTimer: null,
    importSearching: false,
    mode: 'produto',
    conditionalMode: 'acima_de',
    importContext: 'grid',
    globalLoading: false,
  };

  const elements = {
    companiesSelect: document.getElementById('promotion-v2-companies'),
    companiesToggle: document.getElementById('promotion-v2-companies-toggle'),
    companyHelper: document.getElementById('promotion-v2-company-helper'),
    headerCode: document.getElementById('promotion-v2-header-code'),
    headerDiscount: document.getElementById('promotion-v2-header-discount'),
    headerOriginalPrice: document.getElementById('promotion-v2-header-original-price'),
    headerPrice: document.getElementById('promotion-v2-header-price'),
    headerProduct: document.getElementById('promotion-v2-header-product'),
    conditionalAcimaDe: document.getElementById('promotion-v2-conditional-acima-de'),
    conditionalButtons: Array.from(document.querySelectorAll('[data-promotion-v2-conditional-mode]')),
    conditionalLevePague: document.getElementById('promotion-v2-conditional-leve-pague'),
    conditionalPanel: document.getElementById('promotion-v2-conditional-panel'),
    fieldCode: document.getElementById('promotion-v2-field-code'),
    fieldsPanel: document.getElementById('promotion-v2-fields-panel'),
    fieldOriginalPrice: document.getElementById('promotion-v2-field-original-price'),
    fieldPeriod: document.getElementById('promotion-v2-field-period'),
    fieldProduct: document.getElementById('promotion-v2-field-product'),
    fieldPromoPrice: document.getElementById('promotion-v2-field-promo-price'),
    headerPeriodStart: document.getElementById('promotion-v2-header-period-start'),
    headerPeriodEnd: document.getElementById('promotion-v2-header-period-end'),
    modeButtons: Array.from(document.querySelectorAll('[data-promotion-v2-mode]')),
    rowCodeProduct: document.getElementById('promotion-v2-row-code-product'),
    rowPriceDiscount: document.getElementById('promotion-v2-row-price-discount'),
    topGrid: document.getElementById('promotion-v2-top-grid'),
    weekdaysSelect: document.getElementById('promotion-v2-weekdays'),
    weekdaysToggle: document.getElementById('promotion-v2-weekdays-toggle'),
    addRowButton: document.getElementById('promotion-v2-add-row'),
    itemsBody: document.getElementById('promotion-v2-items-body'),
    summaryCount: document.getElementById('promotion-v2-summary-count'),
    saveButton: document.getElementById('promotion-v2-save'),
    importButton: document.getElementById('promotion-v2-import-products'),
    importModal: document.getElementById('promotion-v2-import-modal'),
    importClose: document.getElementById('promotion-v2-import-close'),
    importCancel: document.getElementById('promotion-v2-import-cancel'),
    importApply: document.getElementById('promotion-v2-import-apply'),
    importBackdrop: document.querySelector('[data-promotion-v2-import-dismiss="backdrop"]'),
    importSearch: document.getElementById('promotion-v2-import-search'),
    importResultsBody: document.getElementById('promotion-v2-import-results-body'),
    importResultsEmpty: document.getElementById('promotion-v2-import-results-empty'),
    importSearchButton: document.getElementById('promotion-v2-import-search-button'),
    importSelectedCount: document.getElementById('promotion-v2-import-selected-count'),
  };

  const SAVE_BUTTON_DEFAULT_TEXT = elements.saveButton?.textContent?.trim() || 'Gravar';

  function getToken() {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return loggedInUser?.token || '';
    } catch (error) {
      return '';
    }
  }

  function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function generateItemId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `promo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createEmptyItem(overrides = {}) {
    return {
      id: generateItemId(),
      productId: '',
      codigo: '',
      produto: '',
      desconto: '',
      precoPromocao: '',
      periodoInicio: '',
      periodoFim: '',
      ...overrides,
    };
  }

  function normalizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return [createEmptyItem()];
    }

    return items.map((item) => createEmptyItem({
      id: item?.id || generateItemId(),
      productId: item?.productId || '',
      codigo: item?.codigo || '',
      produto: item?.produto || '',
      desconto: item?.desconto ?? '',
      precoPromocao: item?.precoPromocao ?? '',
      periodoInicio: item?.periodoInicio || '',
      periodoFim: item?.periodoFim || '',
    }));
  }

  function getSelectedWeekdays() {
    return Array.from(elements.weekdaysSelect?.selectedOptions || []).map((option) => option.value);
  }

  function getSelectedCompanies() {
    return Array.from(elements.companiesSelect?.selectedOptions || []).map((option) => option.value);
  }

  function updateCompaniesToggleLabel() {
    if (!elements.companiesToggle) return;
    const options = Array.from(elements.companiesSelect?.options || []);
    const allChecked = options.length > 0 && options.every((option) => option.selected);
    elements.companiesToggle.textContent = allChecked ? 'Desmarcar todas' : 'Marcar todas';
  }

  function updateWeekdaysToggleLabel() {
    if (!elements.weekdaysToggle) return;
    const options = Array.from(elements.weekdaysSelect?.options || []);
    const allChecked = options.length > 0 && options.every((option) => option.selected);
    elements.weekdaysToggle.textContent = allChecked ? 'Desmarcar todos' : 'Marcar todos';
  }

  function getTodayIsoDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setDefaultHeaderDates() {
    const today = getTodayIsoDate();
    if (elements.headerPeriodStart && !elements.headerPeriodStart.value) {
      elements.headerPeriodStart.value = today;
    }
    if (elements.headerPeriodEnd && !elements.headerPeriodEnd.value) {
      elements.headerPeriodEnd.value = today;
    }
  }

  function parseDecimalInput(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatDecimalInput(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '';
    return String(Math.round(parsed * 100) / 100);
  }

  function syncPromotionFromDiscount() {
    const originalPrice = parseDecimalInput(elements.headerOriginalPrice?.value);
    const discount = parseDecimalInput(elements.headerDiscount?.value);
    if (!Number.isFinite(originalPrice) || originalPrice < 0 || !Number.isFinite(discount)) {
      return;
    }

    const clampedDiscount = Math.min(Math.max(discount, 0), 100);
    const promotionalPrice = originalPrice * (1 - clampedDiscount / 100);
    if (elements.headerDiscount) {
      elements.headerDiscount.value = formatDecimalInput(clampedDiscount);
    }
    if (elements.headerPrice) {
      elements.headerPrice.value = formatDecimalInput(promotionalPrice);
    }
  }

  function syncDiscountFromPromotion() {
    const originalPrice = parseDecimalInput(elements.headerOriginalPrice?.value);
    const promotionalPrice = parseDecimalInput(elements.headerPrice?.value);
    if (!Number.isFinite(originalPrice) || originalPrice <= 0 || !Number.isFinite(promotionalPrice)) {
      return;
    }

    const clampedPromotionalPrice = Math.min(Math.max(promotionalPrice, 0), originalPrice);
    const discount = ((originalPrice - clampedPromotionalPrice) / originalPrice) * 100;
    if (elements.headerPrice) {
      elements.headerPrice.value = formatDecimalInput(clampedPromotionalPrice);
    }
    if (elements.headerDiscount) {
      elements.headerDiscount.value = formatDecimalInput(discount);
    }
  }

  function fillHeaderProduct(product) {
    if (!product) return;
    if (elements.headerProduct) {
      elements.headerProduct.value = product.nome || '';
    }

    const salePrice = Number(product.venda);
    if (Number.isFinite(salePrice)) {
      if (elements.headerOriginalPrice) {
        elements.headerOriginalPrice.value = String(salePrice);
      }
    }
  }

  async function loadGlobalDiscount(options = {}) {
    const { silent = false } = options;
    if (state.globalLoading) {
      return false;
    }

    state.globalLoading = true;

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/clube/desconto-global`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Falha ao carregar o desconto global.');
      }

      if (elements.headerDiscount) {
        elements.headerDiscount.value = formatDecimalInput(data?.percentage ?? 0);
      }

      return true;
    } catch (error) {
      console.error('Erro ao carregar desconto global da promocao V2:', error);
      if (!silent && typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Erro',
          message: error?.message || 'Nao foi possivel carregar o desconto global.',
          confirmText: 'OK',
        });
      }
      return false;
    } finally {
      state.globalLoading = false;
    }
  }

  function updateModeButtons() {
    elements.modeButtons.forEach((button) => {
      const isActive = button.dataset.promotionV2Mode === state.mode;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('bg-white', isActive);
      button.classList.toggle('shadow-sm', isActive);
      button.classList.toggle('ring-1', isActive);
      button.classList.toggle('ring-primary', isActive);
      button.classList.toggle('hover:text-primary', !isActive);
    });
  }

  function updateConditionalButtons() {
    elements.conditionalButtons.forEach((button) => {
      const isActive = button.dataset.promotionV2ConditionalMode === state.conditionalMode;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('bg-white', isActive);
      button.classList.toggle('shadow-sm', isActive);
      button.classList.toggle('ring-1', isActive);
      button.classList.toggle('ring-primary', isActive);
      button.classList.toggle('hover:text-primary', !isActive);
    });
  }

  function updateModeLayout() {
    const isConditional = state.mode === 'condicional';
    const isGlobal = state.mode === 'global';

    if (elements.topGrid) {
      elements.topGrid.classList.toggle('lg:grid-cols-3', !isConditional);
      elements.topGrid.classList.toggle('lg:grid-cols-4', isConditional);
    }

    if (elements.fieldsPanel) {
      elements.fieldsPanel.classList.toggle('lg:col-span-2', isConditional);
    }

    if (elements.conditionalPanel) {
      elements.conditionalPanel.classList.toggle('hidden', !isConditional);
    }

    if (elements.fieldProduct) {
      elements.fieldProduct.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldCode) {
      elements.fieldCode.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldOriginalPrice) {
      elements.fieldOriginalPrice.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldPromoPrice) {
      elements.fieldPromoPrice.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldPeriod) {
      elements.fieldPeriod.classList.toggle('hidden', isGlobal);
    }

    if (elements.rowCodeProduct) {
      elements.rowCodeProduct.classList.toggle('sm:grid-cols-2', !isGlobal);
      elements.rowCodeProduct.classList.toggle('sm:grid-cols-1', isGlobal);
    }

    if (elements.rowPriceDiscount) {
      elements.rowPriceDiscount.classList.toggle('sm:grid-cols-3', !isGlobal);
      elements.rowPriceDiscount.classList.toggle('sm:grid-cols-1', isGlobal);
    }

    if (elements.conditionalAcimaDe) {
      elements.conditionalAcimaDe.classList.toggle('hidden', !isConditional || state.conditionalMode !== 'acima_de');
    }

    if (elements.conditionalLevePague) {
      elements.conditionalLevePague.classList.toggle('hidden', !isConditional || state.conditionalMode !== 'leve_pague');
    }

    updateConditionalButtons();
  }

  function getDraftPayload() {
    return {
      companyIds: getSelectedCompanies(),
      weekdays: getSelectedWeekdays(),
      items: state.items.map((item) => ({
        id: item.id,
        productId: item.productId || '',
        codigo: item.codigo || '',
        produto: item.produto || '',
        desconto: item.desconto,
        precoPromocao: item.precoPromocao,
        periodoInicio: item.periodoInicio || '',
        periodoFim: item.periodoFim || '',
      })),
      savedAt: new Date().toISOString(),
    };
  }

  function persistDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getDraftPayload()));
    } catch (error) {
      console.warn('Nao foi possivel salvar o rascunho de promocoes.', error);
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state.items = [createEmptyItem()];
        return { companyIds: [], weekdays: [] };
      }

      const payload = JSON.parse(raw);
      state.items = normalizeItems(payload?.items);
      return {
        companyIds: Array.isArray(payload?.companyIds)
          ? payload.companyIds
          : payload?.companyId
            ? [payload.companyId]
            : [],
        weekdays: Array.isArray(payload?.weekdays) ? payload.weekdays : [],
      };
    } catch (error) {
      state.items = [createEmptyItem()];
      return { companyIds: [], weekdays: [] };
    }
  }

  function populateStores(selectedCompanyIds = []) {
    if (!elements.companiesSelect) return;

    if (!state.stores.length) {
      elements.companiesSelect.innerHTML = '<option value="">Nenhuma empresa encontrada</option>';
      updateCompaniesToggleLabel();
      return;
    }

    const selectedSet = new Set((Array.isArray(selectedCompanyIds) ? selectedCompanyIds : []).map(String));
    const fallbackSingle = state.stores.length === 1 ? String(state.stores[0]._id) : '';

    elements.companiesSelect.innerHTML = state.stores.map((store) => {
      const id = String(store._id || '');
      const checked = selectedSet.has(id) || (!selectedSet.size && fallbackSingle === id);
      const label = store.nome || store.razaoSocial || 'Empresa sem nome';
      return `<option value="${escapeHtml(id)}" ${checked ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');

    updateCompaniesToggleLabel();
  }

  async function fetchStores(selectedCompanyIds = []) {
    if (!elements.companiesSelect) return;

    try {
      elements.companiesSelect.innerHTML = '<option value="">Carregando empresas...</option>';

      const response = await fetch(`${API_CONFIG.BASE_URL}/stores/allowed`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as empresas.');
      }

      const payload = await response.json();
      state.stores = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.stores)
          ? payload.stores
          : [];

      populateStores(selectedCompanyIds);
      if (elements.companyHelper) {
        elements.companyHelper.textContent = state.stores.length
          ? ''
          : 'Nenhuma empresa autorizada encontrada para o seu usuario.';
        elements.companyHelper.className = state.stores.length
          ? 'hidden mt-1 text-xs text-gray-500'
          : 'mt-1 text-xs text-red-600';
      }
    } catch (error) {
      console.error('Erro ao carregar empresas da promocao V2:', error);
      elements.companiesSelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      if (elements.companyHelper) {
        elements.companyHelper.textContent = 'Nao foi possivel carregar as empresas. Atualize a pagina e tente novamente.';
        elements.companyHelper.className = 'mt-1 text-xs text-red-600';
      }
    }
  }

  function updateSummary() {
    if (!elements.summaryCount) return;
    const filledItems = state.items.filter((item) => item.codigo || item.produto);
    elements.summaryCount.textContent = String(filledItems.length);
  }

  function renderItems() {
    if (!elements.itemsBody) return;

    if (!state.items.length) {
      state.items = [createEmptyItem()];
    }

    elements.itemsBody.innerHTML = state.items.map((item, index) => `
      <tr data-item-id="${escapeHtml(item.id)}" class="align-top">
        <td class="px-3 py-3">
          <input
            type="text"
            data-field="codigo"
            class="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
            value="${escapeHtml(item.codigo)}"
            placeholder="Codigo"
          >
        </td>
        <td class="px-3 py-3 min-w-[18rem]">
          <input
            type="text"
            data-field="produto"
            class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
            value="${escapeHtml(item.produto)}"
            placeholder="Nome do produto"
          >
        </td>
        <td class="px-3 py-3">
          <div class="relative w-28">
            <input
              type="number"
              data-field="desconto"
              min="0"
              step="0.01"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              value="${escapeHtml(item.desconto)}"
              placeholder="0,00"
            >
            <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">%</span>
          </div>
        </td>
        <td class="px-3 py-3">
          <div class="relative w-32">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-gray-400">R$</span>
            <input
              type="number"
              data-field="precoPromocao"
              min="0"
              step="0.01"
              class="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              value="${escapeHtml(item.precoPromocao)}"
              placeholder="0,00"
            >
          </div>
        </td>
        <td class="px-3 py-3">
          <div class="grid gap-2 md:grid-cols-2">
            <input
              type="date"
              data-field="periodoInicio"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              value="${escapeHtml(item.periodoInicio)}"
            >
            <input
              type="date"
              data-field="periodoFim"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              value="${escapeHtml(item.periodoFim)}"
            >
          </div>
        </td>
        <td class="px-3 py-3 text-right">
          <div class="flex justify-end gap-2">
            <button type="button" data-action="duplicate" class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50" aria-label="Duplicar linha ${index + 1}">
              <i class="fas fa-copy"></i>
            </button>
            <button type="button" data-action="remove" class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50" aria-label="Remover linha ${index + 1}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    updateSummary();
  }

  function updateItem(itemId, field, value) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    item[field] = value;
    persistDraft();
    updateSummary();
  }

  function addItem(item = createEmptyItem()) {
    state.items.push(item);
    renderItems();
    persistDraft();
  }

  function removeItem(itemId) {
    if (state.items.length === 1) {
      state.items = [createEmptyItem()];
    } else {
      state.items = state.items.filter((item) => item.id !== itemId);
    }
    renderItems();
    persistDraft();
  }

  function duplicateItem(itemId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    const clone = createEmptyItem({
      productId: item.productId,
      codigo: item.codigo,
      produto: item.produto,
      desconto: item.desconto,
      precoPromocao: item.precoPromocao,
      periodoInicio: item.periodoInicio,
      periodoFim: item.periodoFim,
    });
    const index = state.items.findIndex((entry) => entry.id === itemId);
    state.items.splice(index + 1, 0, clone);
    renderItems();
    persistDraft();
  }

  function openImportModal(options = {}) {
    if (!elements.importModal) return;
    const { context = 'grid', searchTerm = '' } = options;
    state.importContext = context;
    elements.importModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    document.body.classList.add('promotion-v2-modal-open');
    if (elements.importSearch) {
      elements.importSearch.value = searchTerm;
      elements.importSearch.focus();
    }
    if (searchTerm.trim().length >= 2) {
      searchProducts(searchTerm);
    } else {
      renderImportResults();
    }
  }

  function closeImportModal() {
    if (!elements.importModal) return;
    elements.importModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    document.body.classList.remove('promotion-v2-modal-open');
    state.importContext = 'grid';
  }

  function updateImportSelectedCount() {
    if (!elements.importSelectedCount) return;
    elements.importSelectedCount.textContent = String(state.importSelectedIds.size);
  }

  function renderImportResults() {
    if (!elements.importResultsBody || !elements.importResultsEmpty) return;

    updateImportSelectedCount();
    elements.importResultsBody.innerHTML = '';

    if (state.importSearching) {
      elements.importResultsEmpty.textContent = 'Buscando produtos...';
      elements.importResultsEmpty.classList.remove('hidden');
      return;
    }

    if (!state.importResults.length) {
      const hasSearch = Boolean(elements.importSearch?.value.trim());
      elements.importResultsEmpty.textContent = hasSearch
        ? 'Nenhum produto encontrado para a busca informada.'
        : 'Digite ao menos 2 caracteres para buscar produtos.';
      elements.importResultsEmpty.classList.remove('hidden');
      return;
    }
    elements.importResultsEmpty.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    state.importResults.forEach((product, index) => {
      const productId = String(product._id || '');
      const checked = state.importSelectedIds.has(productId);
      const row = document.createElement('tr');
      row.className = 'text-[12px] text-gray-700 transition hover:bg-primary/5';
      row.setAttribute('data-promotion-v2-import-result', String(index));
      row.innerHTML = `
        <td class="px-3 py-2">
          <input type="checkbox" data-import-select="${escapeHtml(productId)}" class="rounded border-gray-300 text-primary focus:ring-primary" ${checked ? 'checked' : ''}>
        </td>
        <td class="px-3 py-2 font-semibold text-gray-700">${escapeHtml(product.cod || '-')}</td>
        <td class="px-3 py-2 text-gray-700">${escapeHtml(product.codbarras || '-')}</td>
        <td class="px-3 py-2 text-gray-700">${escapeHtml(product.nome || 'Produto sem nome')}</td>
        <td class="px-3 py-2 text-right text-gray-700">${Number.isFinite(Number(product.venda)) ? escapeHtml(Number(product.venda).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) : 'R$ 0,00'}</td>
      `;
      fragment.appendChild(row);
    });
    elements.importResultsBody.appendChild(fragment);
  }

  async function searchProducts(term) {
    if (!elements.importResultsBody) return;

    const normalized = String(term || '').trim();
    if (normalized.length < 2) {
      state.importResults = [];
      state.importSearching = false;
      updateImportSelectedCount();
      renderImportResults();
      return;
    }

    try {
      state.importSearching = true;
      renderImportResults();

      const params = new URLSearchParams({
        search: normalized,
        limit: '18',
        includeHidden: 'true',
      });

      const response = await fetch(`${API_CONFIG.BASE_URL}/products?${params.toString()}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error('Falha ao buscar produtos.');
      }

      const payload = await response.json();
      state.importResults = Array.isArray(payload?.products) ? payload.products : [];
    } catch (error) {
      console.error('Erro ao buscar produtos da promocao V2:', error);
      state.importResults = [];
      if (elements.importResultsEmpty) {
        elements.importResultsEmpty.textContent = 'Nao foi possivel buscar produtos agora.';
        elements.importResultsEmpty.classList.remove('hidden');
      }
    } finally {
      state.importSearching = false;
      renderImportResults();
    }
  }

  function applyImportedProducts() {
    const selectedProducts = state.importResults.filter((product) => state.importSelectedIds.has(String(product._id || '')));
    if (!selectedProducts.length) {
      if (typeof window.showModal === 'function') {
        window.showModal({
          title: 'Importacao de produtos',
          message: 'Selecione ao menos um produto para importar.',
          confirmText: 'OK',
        });
      }
      return;
    }

    if (state.importContext === 'header') {
      fillHeaderProduct(selectedProducts[0]);
      state.importSelectedIds.clear();
      updateImportSelectedCount();
      closeImportModal();
      return;
    }

    selectedProducts.forEach((product) => {
      const productId = String(product._id || '');
      const existing = state.items.find((item) => String(item.productId || '') === productId);
      const nextData = {
        productId,
        codigo: product.cod || '',
        produto: product.nome || '',
        precoPromocao: Number.isFinite(Number(product.venda)) ? String(product.venda) : '',
      };

      if (existing) {
        Object.assign(existing, nextData);
      } else {
        state.items.push(createEmptyItem(nextData));
      }
    });

    if (state.items.length > 1) {
      state.items = state.items.filter((item, index) => {
        if (index !== 0) return true;
        return item.codigo || item.produto || item.desconto || item.precoPromocao || item.periodoInicio || item.periodoFim;
      });
      if (!state.items.length) {
        state.items = [createEmptyItem()];
      }
    }

    renderItems();
    persistDraft();
    state.importSelectedIds.clear();
    updateImportSelectedCount();
    closeImportModal();
    if (typeof window.showToast === 'function') {
      window.showToast('Produtos adicionados a grade da promocao.', 'success');
    }
  }

  async function searchExactHeaderProduct(term) {
    const normalized = String(term || '').trim();
    if (!normalized) return;

    try {
      const params = new URLSearchParams({
        search: normalized,
        limit: '10',
        includeHidden: 'true',
      });

      const response = await fetch(`${API_CONFIG.BASE_URL}/products?${params.toString()}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error('Falha ao buscar produto.');
      }

      const payload = await response.json();
      const products = Array.isArray(payload?.products) ? payload.products : [];
      const exactMatch = products.find((product) => {
        const code = String(product?.cod || '').trim();
        const barcode = String(product?.codbarras || '').trim();
        return code === normalized || barcode === normalized;
      });

      if (exactMatch) {
        fillHeaderProduct(exactMatch);
      }
    } catch (error) {
      console.error('Erro ao buscar produto exato para o cabecalho:', error);
    }
  }

  function validateBeforeSave() {
    if (!getSelectedCompanies().length) {
      return 'Selecione ao menos uma empresa para gravar a promocao.';
    }

    const validItems = state.items.filter((item) => item.codigo || item.produto);
    if (!validItems.length) {
      return 'Informe ao menos um item na grade da promocao.';
    }

    for (const item of validItems) {
      if (!item.codigo || !item.produto) {
        return 'Preencha Codigo e Produto em todas as linhas utilizadas.';
      }
      if (!item.periodoInicio || !item.periodoFim) {
        return 'Informe o Periodo inicial e final para todos os itens preenchidos.';
      }
      if (item.periodoFim < item.periodoInicio) {
        return 'O Periodo final nao pode ser menor que o inicial.';
      }
    }

    return '';
  }

  function validateGlobalBeforeSave() {
    const percentageValue = parseDecimalInput(elements.headerDiscount?.value);
    if (!Number.isFinite(percentageValue) || percentageValue < 0 || percentageValue > 100) {
      return 'Por favor, insira um numero entre 0 e 100.';
    }

    return '';
  }

  async function saveGlobalDiscount() {
    const percentageValue = parseDecimalInput(elements.headerDiscount?.value);

    if (elements.saveButton) {
      elements.saveButton.disabled = true;
      elements.saveButton.textContent = 'A aplicar...';
    }

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/clube/desconto-global`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ percentage: percentageValue }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.message || 'Falha ao aplicar o desconto global.');
      }

      if (elements.headerDiscount) {
        elements.headerDiscount.value = formatDecimalInput(percentageValue);
      }

      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Sucesso!',
          message: result.message,
          confirmText: 'OK',
        });
      }
    } catch (error) {
      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Erro',
          message: error?.message || 'Falha ao aplicar o desconto global.',
          confirmText: 'Tentar Novamente',
        });
      }
    } finally {
      if (elements.saveButton) {
        elements.saveButton.disabled = false;
        elements.saveButton.textContent = SAVE_BUTTON_DEFAULT_TEXT;
      }
    }
  }

  async function handleGlobalSave() {
    const validationError = validateGlobalBeforeSave();
    if (validationError) {
      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Valor Invalido',
          message: validationError,
          confirmText: 'OK',
        });
      }
      return;
    }

    const percentageValue = parseDecimalInput(elements.headerDiscount?.value);

    if (typeof window.showModal === 'function') {
      window.showModal({
        title: 'Confirmar Alteracao',
        message: `Tem a certeza de que deseja aplicar um desconto de ${formatDecimalInput(percentageValue)}% a TODOS os produtos?`,
        confirmText: 'Sim, aplicar',
        cancelText: 'Cancelar',
        onConfirm: async () => {
          await saveGlobalDiscount();
          return true;
        },
      });
      return;
    }

    await saveGlobalDiscount();
  }

  async function handleSave() {
    if (state.mode === 'global') {
      await handleGlobalSave();
      return;
    }

    const validationError = validateBeforeSave();
    if (validationError) {
      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Cadastro de Promocao V2',
          message: validationError,
          confirmText: 'OK',
        });
      }
      return;
    }

    persistDraft();
    if (typeof window.showModal === 'function') {
      await window.showModal({
        title: 'Rascunho gravado',
        message: 'Os dados da tela Cadastro de Promocao V2 foram gravados localmente neste navegador.',
        confirmText: 'OK',
      });
    }
  }

  function bindEvents() {
    elements.companiesToggle?.addEventListener('click', () => {
      const options = Array.from(elements.companiesSelect?.options || []);
      const allChecked = options.length > 0 && options.every((option) => option.selected);
      options.forEach((option) => {
        option.selected = !allChecked;
      });
      updateCompaniesToggleLabel();
      persistDraft();
    });

    elements.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.mode = button.dataset.promotionV2Mode || 'produto';
        updateModeButtons();
        updateModeLayout();
        if (state.mode === 'global') {
          void loadGlobalDiscount();
        }
      });
    });

    elements.conditionalButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.conditionalMode = button.dataset.promotionV2ConditionalMode || 'acima_de';
        updateModeLayout();
      });
    });

    elements.companiesSelect?.addEventListener('change', () => {
      updateCompaniesToggleLabel();
      persistDraft();
    });

    elements.weekdaysSelect?.addEventListener('change', () => {
      updateWeekdaysToggleLabel();
      persistDraft();
    });

    elements.weekdaysToggle?.addEventListener('click', () => {
      const options = Array.from(elements.weekdaysSelect?.options || []);
      const allChecked = options.length > 0 && options.every((option) => option.selected);
      options.forEach((option) => {
        option.selected = !allChecked;
      });
      updateWeekdaysToggleLabel();
      persistDraft();
    });

    elements.addRowButton?.addEventListener('click', () => addItem());
    elements.saveButton?.addEventListener('click', handleSave);
    elements.importButton?.addEventListener('click', () => openImportModal({ context: 'grid' }));
    elements.importClose?.addEventListener('click', closeImportModal);
    elements.importBackdrop?.addEventListener('click', closeImportModal);
    elements.importCancel?.addEventListener('click', closeImportModal);
    elements.importApply?.addEventListener('click', applyImportedProducts);
    elements.importSearchButton?.addEventListener('click', () => {
      searchProducts(elements.importSearch?.value || '');
    });

    elements.headerProduct?.addEventListener('input', (event) => {
      const value = String(event.target.value || '').trim();
      clearTimeout(state.headerProductSearchTimer);

      if (!value) {
        return;
      }

      if (/^\d+$/.test(value)) {
        state.headerProductSearchTimer = window.setTimeout(() => {
          searchExactHeaderProduct(value);
        }, 250);
        return;
      }

      if (/[A-Za-zÀ-ÿ]/.test(value) && value.length >= 2 && elements.importModal?.classList.contains('hidden')) {
        state.importSelectedIds.clear();
        updateImportSelectedCount();
        openImportModal({ context: 'header', searchTerm: value });
      }
    });

    elements.headerDiscount?.addEventListener('input', () => {
      syncPromotionFromDiscount();
    });

    elements.headerPrice?.addEventListener('input', () => {
      syncDiscountFromPromotion();
    });

    elements.headerOriginalPrice?.addEventListener('input', () => {
      if (elements.headerDiscount?.value) {
        syncPromotionFromDiscount();
      } else if (elements.headerPrice?.value) {
        syncDiscountFromPromotion();
      }
    });

    elements.itemsBody?.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const row = target.closest('tr[data-item-id]');
      const field = target.dataset.field;
      if (!row || !field) return;
      updateItem(row.dataset.itemId || '', field, target.value);
    });

    elements.itemsBody?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!(button instanceof HTMLButtonElement)) return;
      const row = button.closest('tr[data-item-id]');
      if (!row) return;
      const itemId = row.dataset.itemId || '';
      const action = button.dataset.action;
      if (action === 'remove') {
        removeItem(itemId);
      } else if (action === 'duplicate') {
        duplicateItem(itemId);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && elements.importModal && !elements.importModal.classList.contains('hidden')) {
        closeImportModal();
      }
    });

    elements.importSearch?.addEventListener('input', (event) => {
      const value = event.target.value;
      clearTimeout(state.importSearchTimer);
      state.importSearchTimer = window.setTimeout(() => {
        searchProducts(value);
      }, 300);
    });
    elements.importSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchProducts(event.target.value || '');
      }
    });

    elements.importResultsBody?.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const productId = target.dataset.importSelect;
      if (!productId) return;
      if (state.importContext === 'header' && target.checked) {
        state.importSelectedIds.clear();
        elements.importResults.querySelectorAll('input[data-import-select]').forEach((input) => {
          if (input instanceof HTMLInputElement) {
            input.checked = input === target;
          }
        });
      }
      if (target.checked) {
        state.importSelectedIds.add(productId);
      } else {
        state.importSelectedIds.delete(productId);
      }
      updateImportSelectedCount();
    });
  }

  async function init() {
    if (!elements.itemsBody || !elements.companiesSelect) {
      return;
    }

    const draft = loadDraft();
    renderItems();
    setDefaultHeaderDates();
    updateModeButtons();
    updateModeLayout();

    if (state.mode === 'global') {
      await loadGlobalDiscount({ silent: true });
    }

    Array.from(elements.weekdaysSelect?.options || []).forEach((option) => {
      option.selected = draft.weekdays.includes(option.value);
    });
    updateWeekdaysToggleLabel();

    bindEvents();
    await fetchStores(draft.companyIds);
    persistDraft();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
