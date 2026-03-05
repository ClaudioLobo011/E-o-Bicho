(function () {
  const STORAGE_KEY = 'admin-promocoes-v2-draft';

  const state = {
    stores: [],
    items: [],
    registeredPromotions: [],
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
    headerDescription: document.getElementById('promotion-v2-header-description'),
    headerDiscount: document.getElementById('promotion-v2-header-discount'),
    headerOriginalPrice: document.getElementById('promotion-v2-header-original-price'),
    headerPrice: document.getElementById('promotion-v2-header-price'),
    headerProduct: document.getElementById('promotion-v2-header-product'),
    conditionalAcimaDe: document.getElementById('promotion-v2-conditional-acima-de'),
    conditionalButtons: Array.from(document.querySelectorAll('[data-promotion-v2-conditional-mode]')),
    conditionalLevePague: document.getElementById('promotion-v2-conditional-leve-pague'),
    conditionalPanel: document.getElementById('promotion-v2-conditional-panel'),
    fieldCode: document.getElementById('promotion-v2-field-code'),
    fieldDescription: document.getElementById('promotion-v2-field-description'),
    differentProductsWrap: document.getElementById('promotion-v2-different-products-wrap'),
    differentProductsCheckbox: document.getElementById('promotion-v2-different-products'),
    noExpiryWrap: document.getElementById('promotion-v2-no-expiry-wrap'),
    noExpiryCheckbox: document.getElementById('promotion-v2-no-expiry'),
    fieldGlobalDiscount: document.getElementById('promotion-v2-field-global-discount'),
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
    registeredBody: document.getElementById('promotion-v2-registered-body'),
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
      preco: '',
      desconto: '',
      precoPromocao: '',
      periodoInicio: '',
      periodoFim: '',
      ...overrides,
    };
  }

  function hasItemContent(item) {
    if (!item || typeof item !== 'object') return false;
    return Boolean(
      String(item.productId || '').trim()
      || String(item.codigo || '').trim()
      || String(item.produto || '').trim()
      || String(item.preco ?? '').trim()
      || String(item.desconto ?? '').trim()
      || String(item.precoPromocao ?? '').trim()
      || String(item.periodoInicio || '').trim()
      || String(item.periodoFim || '').trim()
    );
  }

  function normalizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    return items.map((item) => createEmptyItem({
      id: item?.id || generateItemId(),
      productId: item?.productId || '',
      codigo: item?.codigo || '',
      produto: item?.produto || '',
      preco: item?.preco ?? '',
      desconto: item?.desconto ?? '',
      precoPromocao: item?.precoPromocao ?? '',
      periodoInicio: item?.periodoInicio || '',
      periodoFim: item?.periodoFim || '',
    })).filter(hasItemContent);
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

  function syncNoExpiryPeriodState() {
    const noExpiry = Boolean(elements.noExpiryCheckbox?.checked);
    if (elements.headerPeriodStart) {
      elements.headerPeriodStart.disabled = noExpiry;
    }
    if (elements.headerPeriodEnd) {
      elements.headerPeriodEnd.disabled = noExpiry;
    }
    if (noExpiry) {
      if (elements.headerPeriodStart) {
        elements.headerPeriodStart.value = '';
      }
      if (elements.headerPeriodEnd) {
        elements.headerPeriodEnd.value = '';
      }
    } else {
      if (elements.headerPeriodStart && !elements.headerPeriodStart.value) {
        elements.headerPeriodStart.value = getTodayIsoDate();
      }
      if (elements.headerPeriodEnd && !elements.headerPeriodEnd.value) {
        elements.headerPeriodEnd.value = elements.headerPeriodStart?.value || getTodayIsoDate();
      }
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

  function formatTwoDecimals(value) {
    const parsed = parseDecimalInput(value);
    if (!Number.isFinite(parsed)) return '';
    return parsed.toFixed(2);
  }

  async function resolveNextPromotionGroupCode() {
    const endpoint = state.mode === 'condicional'
      ? `${API_CONFIG.BASE_URL}/promocoes/condicional?includeInactive=true`
      : `${API_CONFIG.BASE_URL}/promocoes/produtos?includeInactive=true`;
    const response = await fetch(endpoint, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || 'Nao foi possivel gerar o proximo codigo da promocao.');
    }

    const items = Array.isArray(payload) ? payload : [];
    let maxCode = 0;
    items.forEach((product) => {
      const rawCode = state.mode === 'condicional'
        ? product?.promocaoCondicional?.codigoGrupo
        : product?.promocao?.codigoGrupo;
      const parsed = Number.parseInt(String(rawCode || '').trim(), 10);
      if (Number.isFinite(parsed) && parsed > maxCode) {
        maxCode = parsed;
      }
    });
    return String(maxCode + 1);
  }

  async function ensurePromotionGroupCode() {
    const current = String(elements.headerCode?.value || '').trim();
    if (/^\d+$/.test(current)) {
      return current;
    }

    const generated = await resolveNextPromotionGroupCode();
    if (elements.headerCode) {
      elements.headerCode.value = generated;
    }
    return generated;
  }

  function getPromotionGroupDescription() {
    return String(elements.headerDescription?.value || '').trim();
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
    if (elements.headerDescription) {
      elements.headerDescription.value = product.descricao || product.nome || '';
    }
    if (elements.headerCode) {
      elements.headerCode.value = product.cod || '';
    }
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

    if (elements.differentProductsWrap) {
      elements.differentProductsWrap.classList.toggle('hidden', !isConditional);
      elements.differentProductsWrap.style.display = isConditional ? 'inline-flex' : 'none';
    }

    if (elements.noExpiryWrap) {
      elements.noExpiryWrap.classList.toggle('hidden', isGlobal);
      elements.noExpiryWrap.style.display = isGlobal ? 'none' : 'inline-flex';
    }

    if (elements.fieldProduct) {
      elements.fieldProduct.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldCode) {
      elements.fieldCode.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldDescription) {
      elements.fieldDescription.classList.toggle('hidden', isGlobal);
    }

    if (elements.fieldGlobalDiscount) {
      elements.fieldGlobalDiscount.classList.toggle('hidden', !isGlobal);
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

    const itemsSection = document.getElementById('promotion-v2-items-section');
    if (itemsSection) {
      itemsSection.classList.toggle('hidden', isGlobal);
    }

    const registeredSection = document.getElementById('promotion-v2-registered-section');
    if (registeredSection) {
      registeredSection.classList.toggle('hidden', isGlobal);
    }

    if (elements.rowCodeProduct) {
      elements.rowCodeProduct.classList.toggle('promotion-v2-single-column', isGlobal);
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
        preco: item.preco,
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
        state.items = [];
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
      state.items = [];
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

  function renderRegisteredPromotions() {
    if (!elements.registeredBody) return;

    if (!state.registeredPromotions.length) {
      elements.registeredBody.innerHTML = `
        <tr>
          <td colspan="4" class="px-4 py-6 text-center text-sm text-gray-500">Nenhuma promocao cadastrada.</td>
        </tr>
      `;
      return;
    }

    const shouldRenderConditional = state.mode === 'condicional';

    if (shouldRenderConditional) {
      const groupedConditional = new Map();
      state.registeredPromotions.forEach((product) => {
        const promo = product?.promocaoCondicional || {};
        const code = String(promo?.codigoGrupo || '').trim();
        const key = code || `product:${String(product?._id || '')}`;
        if (!groupedConditional.has(key)) {
          groupedConditional.set(key, {
            key,
            code,
            description: String(promo?.descricaoGrupo || '').trim() || String(product?.nome || '').trim(),
            promo,
            products: [],
          });
        }
        groupedConditional.get(key).products.push(product);
      });

      elements.registeredBody.innerHTML = Array.from(groupedConditional.values()).map((group) => {
        const promo = group.promo || {};
        const codigoGrupo = String(group.code || '').trim();
        const descricaoGrupo = String(group.description || '').trim();
        let conditionalLabel = 'Condicional';
        if (promo?.tipo === 'leve_pague') {
          conditionalLabel = `Leve ${promo?.leve || 0}, Pague ${promo?.pague || 0}`;
        } else if (promo?.tipo === 'acima_de') {
          conditionalLabel = `Acima de ${promo?.quantidadeMinima || 0}, ${formatTwoDecimals(promo?.descontoPorcentagem || 0)}% OFF`;
        }

        return `
          <tr data-registered-group-key="${escapeHtml(String(group.key || ''))}">
            <td class="px-3 py-3 text-sm font-semibold text-gray-700">${escapeHtml(codigoGrupo || '-')}</td>
            <td class="px-3 py-3 text-sm text-gray-700">
              <span class="block font-medium text-gray-800">${escapeHtml(descricaoGrupo || 'Promocao condicional')}</span>
              <span class="block text-xs text-blue-600">${escapeHtml(conditionalLabel)}</span>
              <span class="block text-xs font-semibold text-emerald-600">Ativa</span>
            </td>
            <td class="px-3 py-3 text-sm text-gray-700">${escapeHtml(String(group.products.length))}</td>
            <td class="px-3 py-3 text-right">
              <button
                type="button"
                data-registered-action="delete-conditional"
                data-group-code="${escapeHtml(codigoGrupo)}"
                data-group-key="${escapeHtml(String(group.key || ''))}"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"
                aria-label="Remover promocao condicional do grupo ${escapeHtml(descricaoGrupo || codigoGrupo)}"
                title="Remover promocao condicional do grupo"
              >
                <i class="fas fa-trash"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
      return;
    }

  elements.registeredBody.innerHTML = state.registeredPromotions.map((product) => {
      const percentual = parseDecimalInput(product?.promocao?.porcentagem);
      const percentualLabel = Number.isFinite(percentual)
        ? `${formatDecimalInput(percentual)}% OFF`
        : 'Desconto nao informado';
      const codigoGrupo = String(product?.promocao?.codigoGrupo || '').trim();
      const descricaoGrupo = String(product?.promocao?.descricaoGrupo || '').trim();
      const isActive = Boolean(product?.promocao?.ativa);
      const statusLabel = isActive ? 'Ativa' : 'Inativa';
      const statusClass = isActive ? 'text-emerald-600' : 'text-amber-600';
      return `
        <tr data-registered-product-id="${escapeHtml(String(product?._id || ''))}">
          <td class="px-3 py-3 text-sm font-semibold text-gray-700">${escapeHtml(codigoGrupo || product?.cod || '-')}</td>
          <td class="px-3 py-3 text-sm text-gray-700">
            <span class="block font-medium text-gray-800">${escapeHtml(descricaoGrupo || product?.nome || 'Produto sem nome')}</span>
            <span class="block text-xs text-gray-500">${escapeHtml(percentualLabel)}</span>
            <span class="block text-xs font-semibold ${statusClass}">${statusLabel}</span>
          </td>
          <td class="px-3 py-3 text-sm text-gray-700">1</td>
          <td class="px-3 py-3 text-right">
            <div class="inline-flex items-center gap-2">
              <button
                type="button"
                data-registered-action="edit"
                data-product-id="${escapeHtml(String(product?._id || ''))}"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 hover:text-primary"
                aria-label="Editar promocao do produto ${escapeHtml(product?.nome || '')}"
                title="Editar promocao"
              >
                <i class="fas fa-pen"></i>
              </button>
              <button
                type="button"
                data-registered-action="deactivate"
                data-product-id="${escapeHtml(String(product?._id || ''))}"
                data-product-active="${isActive ? 'true' : 'false'}"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border ${isActive ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'} transition"
                aria-label="${isActive ? 'Inativar' : 'Ativar'} promocao do produto ${escapeHtml(product?.nome || '')}"
                title="${isActive ? 'Inativar promocao' : 'Ativar promocao'}"
              >
                <i class="fas ${isActive ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
              </button>
              <button
                type="button"
                data-registered-action="delete"
                data-product-id="${escapeHtml(String(product?._id || ''))}"
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"
                aria-label="Remover promocao do produto ${escapeHtml(product?.nome || '')}"
                title="Remover promocao"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function loadRegisteredProductPromotions() {
    try {
      if (state.mode === 'condicional') {
        const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional?includeInactive=true`, {
          headers: getAuthHeaders(),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || 'Falha ao carregar promocoes condicionais.');
        }
        state.registeredPromotions = Array.isArray(payload) ? payload : [];
      } else {
        const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos?includeInactive=true`, {
          headers: getAuthHeaders(),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || 'Falha ao carregar promocoes cadastradas.');
        }
        state.registeredPromotions = Array.isArray(payload) ? payload : [];
      }
    } catch (error) {
      console.error('Erro ao carregar promocoes cadastradas da promocao V2:', error);
      state.registeredPromotions = [];
    } finally {
      renderRegisteredPromotions();
    }
  }

  async function fetchRegisteredPromotionsForCurrentMode() {
    const endpoint = state.mode === 'condicional'
      ? `${API_CONFIG.BASE_URL}/promocoes/condicional?includeInactive=true`
      : `${API_CONFIG.BASE_URL}/promocoes/produtos?includeInactive=true`;

    const response = await fetch(endpoint, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || 'Falha ao buscar promocoes cadastradas.');
    }
    return Array.isArray(payload) ? payload : [];
  }

  function buildItemsFromPromotionGroup(products) {
    return products.map((product) => {
      const salePrice = parseDecimalInput(product?.venda);
      if (state.mode === 'condicional') {
        const promo = product?.promocaoCondicional || {};
        const desconto = parseDecimalInput(promo?.descontoPorcentagem);
        const precoPromo = Number.isFinite(salePrice) && Number.isFinite(desconto)
          ? salePrice * (1 - Math.min(Math.max(desconto, 0), 100) / 100)
          : salePrice;
        return createEmptyItem({
          productId: String(product?._id || ''),
          codigo: product?.cod || '',
          produto: product?.nome || '',
          preco: Number.isFinite(salePrice) ? formatTwoDecimals(salePrice) : '',
          desconto: Number.isFinite(desconto) ? formatTwoDecimals(desconto) : '',
          precoPromocao: Number.isFinite(precoPromo) ? formatTwoDecimals(precoPromo) : '',
        });
      }

      const percentage = parseDecimalInput(product?.promocao?.porcentagem);
      const promoPrice = Number.isFinite(salePrice) && Number.isFinite(percentage)
        ? salePrice * (1 - Math.min(Math.max(percentage, 0), 100) / 100)
        : salePrice;

      return createEmptyItem({
        productId: String(product?._id || ''),
        codigo: product?.cod || '',
        produto: product?.nome || '',
        preco: Number.isFinite(salePrice) ? formatTwoDecimals(salePrice) : '',
        desconto: Number.isFinite(percentage) ? formatTwoDecimals(percentage) : '',
        precoPromocao: Number.isFinite(promoPrice) ? formatTwoDecimals(promoPrice) : '',
      });
    });
  }

  async function tryLoadPromotionGroupByCode() {
    if (state.mode === 'global') return;
    const code = String(elements.headerCode?.value || '').trim();
    if (!code) return;

    try {
      const allPromotions = await fetchRegisteredPromotionsForCurrentMode();
      const matches = allPromotions.filter((product) => {
        const groupCode = state.mode === 'condicional'
          ? String(product?.promocaoCondicional?.codigoGrupo || '').trim()
          : String(product?.promocao?.codigoGrupo || '').trim();
        return groupCode === code;
      });

      if (!matches.length) {
        window.showToast?.('Nao existe promocao cadastrada com esse codigo.', 'warning');
        if (elements.headerCode) {
          elements.headerCode.value = '';
          elements.headerCode.focus();
        }
        return;
      }

      const first = matches[0];
      const descricao = state.mode === 'condicional'
        ? String(first?.promocaoCondicional?.descricaoGrupo || '').trim()
        : String(first?.promocao?.descricaoGrupo || '').trim();
      const periodoInicio = state.mode === 'condicional'
        ? String(first?.promocaoCondicional?.periodoInicio || '').trim()
        : String(first?.promocao?.periodoInicio || '').trim();
      const periodoFim = state.mode === 'condicional'
        ? String(first?.promocaoCondicional?.periodoFim || '').trim()
        : String(first?.promocao?.periodoFim || '').trim();
      const semValidade = state.mode === 'condicional'
        ? Boolean(first?.promocaoCondicional?.semValidade)
        : Boolean(first?.promocao?.semValidade);
      if (elements.headerDescription) {
        elements.headerDescription.value = descricao;
      }
      if (elements.noExpiryCheckbox) {
        elements.noExpiryCheckbox.checked = semValidade || (!periodoInicio && !periodoFim);
      }
      if (elements.headerPeriodStart) {
        elements.headerPeriodStart.value = periodoInicio || getTodayIsoDate();
      }
      if (elements.headerPeriodEnd) {
        elements.headerPeriodEnd.value = periodoFim || elements.headerPeriodStart?.value || getTodayIsoDate();
      }
      syncNoExpiryPeriodState();

      if (state.mode === 'condicional') {
        const promo = first?.promocaoCondicional || {};
        state.conditionalMode = promo?.tipo === 'leve_pague' ? 'leve_pague' : 'acima_de';
        updateModeLayout();
        if (elements.differentProductsCheckbox) {
          elements.differentProductsCheckbox.checked = Boolean(promo?.produtosDiferentes);
        }
        const acimaDeInput = document.getElementById('promotion-v2-header-acima-de');
        const leveInput = document.getElementById('promotion-v2-header-leve');
        const pagueInput = document.getElementById('promotion-v2-header-pague');
        if (acimaDeInput) acimaDeInput.value = String(Math.max(0, Math.trunc(parseDecimalInput(promo?.quantidadeMinima) || 0)));
        if (leveInput) leveInput.value = String(Math.max(0, Math.trunc(parseDecimalInput(promo?.leve) || 0)));
        if (pagueInput) pagueInput.value = String(Math.max(0, Math.trunc(parseDecimalInput(promo?.pague) || 0)));
      } else if (elements.differentProductsCheckbox) {
        elements.differentProductsCheckbox.checked = false;
      }

      state.items = buildItemsFromPromotionGroup(matches);
      renderItems();
      persistDraft();
      document.getElementById('promotion-v2-items-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.showToast?.('Promocao carregada para edicao.', 'success');
    } catch (error) {
      window.showToast?.(error?.message || 'Nao foi possivel buscar a promocao por codigo.', 'error');
    }
  }

  function renderItems() {
    if (!elements.itemsBody) return;

    if (!state.items.length) {
      elements.itemsBody.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-6 text-center text-sm text-gray-500">Nenhum item adicionado.</td>
        </tr>
      `;
      updateSummary();
      return;
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
          <div class="relative w-32">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-gray-400">R$</span>
            <input
              type="number"
              data-field="preco"
              min="0"
              step="0.01"
              class="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              value="${escapeHtml(formatTwoDecimals(item.preco))}"
              placeholder="0,00"
            >
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
              value="${escapeHtml(formatTwoDecimals(item.precoPromocao))}"
              placeholder="0,00"
            >
          </div>
        </td>
        <td class="px-3 py-3">
          <div class="relative w-28">
            <input
              type="number"
              data-field="desconto"
              min="0"
              step="0.01"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
              value="${escapeHtml(formatTwoDecimals(item.desconto))}"
              placeholder="0,00"
            >
            <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">%</span>
          </div>
        </td>
        <td class="px-3 py-3 text-right">
          <div class="flex justify-end gap-2">
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
    state.items = state.items.filter((item) => item.id !== itemId);
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
      preco: item.preco,
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
      const results = [];
      const pageSize = 500;
      let page = 1;
      let totalPages = 1;
      let guard = 0;

      do {
        const params = new URLSearchParams({
          search: normalized,
          page: String(page),
          limit: String(pageSize),
          includeHidden: 'true',
        });

        const response = await fetch(`${API_CONFIG.BASE_URL}/products?${params.toString()}`, {
          headers: getAuthHeaders(),
        });

        if (!response.ok) {
          throw new Error('Falha ao buscar produtos.');
        }

        const payload = await response.json();
        const pageProducts = Array.isArray(payload?.products)
          ? payload.products
          : Array.isArray(payload)
            ? payload
            : [];
        results.push(...pageProducts);

        const parsedPages = Number(payload?.pages);
        if (Number.isFinite(parsedPages) && parsedPages > 0) {
          totalPages = parsedPages;
        } else if (pageProducts.length < pageSize) {
          totalPages = page;
        } else {
          totalPages = page + 1;
        }

        page += 1;
        guard += 1;
      } while (page <= totalPages && guard < 100);

      state.importResults = results;
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
        preco: Number.isFinite(Number(product.venda)) ? formatTwoDecimals(product.venda) : '',
        precoPromocao: Number.isFinite(Number(product.venda)) ? formatTwoDecimals(product.venda) : '',
      };

      if (existing) {
        Object.assign(existing, nextData);
      } else {
        state.items.push(createEmptyItem(nextData));
      }
    });

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

  async function resolveProductForItem(item) {
    if (item?.productId) {
      return { _id: String(item.productId) };
    }

    const exactCode = String(item?.codigo || '').trim();
    const exactName = String(item?.produto || '').trim();
    const searchTerm = exactCode || exactName;
    if (!searchTerm) return null;

    const params = new URLSearchParams({
      search: searchTerm,
      limit: '25',
      includeHidden: 'true',
    });

    const response = await fetch(`${API_CONFIG.BASE_URL}/products?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error('Falha ao localizar produto para gravar promocao.');
    }

    const payload = await response.json();
    const products = Array.isArray(payload?.products) ? payload.products : [];
    if (!products.length) return null;

    const lowerName = exactName.toLowerCase();
    const byCode = products.find((product) => String(product?.cod || '').trim() === exactCode
      || String(product?.codbarras || '').trim() === exactCode);
    if (byCode) return byCode;

    const byName = products.find((product) => String(product?.nome || '').trim().toLowerCase() === lowerName);
    return byName || null;
  }

  function validateBeforeSave() {
    if (!getSelectedCompanies().length) {
      return 'Selecione ao menos uma empresa para gravar a promocao.';
    }

    if (!getPromotionGroupDescription()) {
      return 'Informe a Descricao do grupo da promocao.';
    }

    const validItems = state.items.filter((item) => item.codigo || item.produto);
    if (!validItems.length) {
      return 'Informe ao menos um item na grade da promocao.';
    }

    for (const item of validItems) {
      if (!item.codigo || !item.produto) {
        return 'Preencha Codigo e Produto em todas as linhas utilizadas.';
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

  function validateConditionalConfig() {
    if (state.conditionalMode === 'leve_pague') {
      const leve = Math.max(0, Math.trunc(parseDecimalInput(document.getElementById('promotion-v2-header-leve')?.value) || 0));
      const pague = Math.max(0, Math.trunc(parseDecimalInput(document.getElementById('promotion-v2-header-pague')?.value) || 0));
      if (leve <= 0 || pague <= 0) {
        return 'Informe valores validos para Leve e Pague.';
      }
      if (pague > leve) {
        return 'No modo Leve Pague, o valor de Pague nao pode ser maior que Leve.';
      }
      return '';
    }

    const quantidadeMinima = Math.max(0, Math.trunc(parseDecimalInput(document.getElementById('promotion-v2-header-acima-de')?.value) || 0));
    if (quantidadeMinima <= 0) {
      return 'Informe uma quantidade valida no campo Acima de.';
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

  async function handleProductSave() {
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

    const validItems = state.items.filter((item) => item.codigo || item.produto);
    const codigoGrupo = await ensurePromotionGroupCode();
    const descricaoGrupo = getPromotionGroupDescription();
    const semValidade = Boolean(elements.noExpiryCheckbox?.checked);
    const periodoInicio = semValidade ? '' : (String(elements.headerPeriodStart?.value || '').trim() || getTodayIsoDate());
    const periodoFim = semValidade ? '' : (String(elements.headerPeriodEnd?.value || '').trim() || periodoInicio);
    if (elements.saveButton) {
      elements.saveButton.disabled = true;
      elements.saveButton.textContent = 'A gravar...';
    }

    try {
      for (let index = 0; index < validItems.length; index += 1) {
        const item = validItems[index];
        const product = await resolveProductForItem(item);
        if (!product?._id) {
          throw new Error(`Produto da linha ${index + 1} nao foi encontrado. Use a importacao de produtos para selecionar itens validos.`);
        }

        item.productId = String(product._id);
        const percentage = parseDecimalInput(item.desconto);
        const itemPrice = parseDecimalInput(item.preco);
        const promoPrice = parseDecimalInput(item.precoPromocao);
        const derivedPercentage = Number.isFinite(itemPrice) && itemPrice > 0 && Number.isFinite(promoPrice)
          ? ((itemPrice - promoPrice) / itemPrice) * 100
          : null;
        const porcentagem = Number.isFinite(percentage)
          ? percentage
          : Number.isFinite(derivedPercentage)
            ? Math.min(Math.max(derivedPercentage, 0), 100)
            : 0;

        const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${item.productId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ porcentagem, codigoGrupo, descricaoGrupo, periodoInicio, periodoFim, semValidade }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result?.message || `Falha ao gravar promocao da linha ${index + 1}.`);
        }
      }

      persistDraft();
      await loadRegisteredProductPromotions();

      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Sucesso',
          message: 'Promocoes de produto gravadas com sucesso.',
          confirmText: 'OK',
        });
      }
    } catch (error) {
      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Erro',
          message: error?.message || 'Nao foi possivel gravar as promocoes de produto.',
          confirmText: 'OK',
        });
      }
    } finally {
      if (elements.saveButton) {
        elements.saveButton.disabled = false;
        elements.saveButton.textContent = SAVE_BUTTON_DEFAULT_TEXT;
      }
    }
  }

  function editRegisteredPromotion(productId) {
    const selected = state.registeredPromotions.find((product) => String(product?._id || '') === String(productId || ''));
    if (!selected) return;

    state.mode = 'produto';
    updateModeButtons();
    updateModeLayout();

    const percentage = parseDecimalInput(selected?.promocao?.porcentagem);
    const salePrice = parseDecimalInput(selected?.venda);
    const promoPrice = Number.isFinite(salePrice) && Number.isFinite(percentage)
      ? salePrice * (1 - Math.min(Math.max(percentage, 0), 100) / 100)
      : null;
    const periodStart = String(selected?.promocao?.periodoInicio || '').trim() || elements.headerPeriodStart?.value || getTodayIsoDate();
    const periodEnd = String(selected?.promocao?.periodoFim || '').trim() || elements.headerPeriodEnd?.value || periodStart;
    const semValidade = Boolean(selected?.promocao?.semValidade);
    if (elements.noExpiryCheckbox) {
      elements.noExpiryCheckbox.checked = semValidade || (!String(selected?.promocao?.periodoInicio || '').trim() && !String(selected?.promocao?.periodoFim || '').trim());
    }
    if (elements.headerPeriodStart) {
      elements.headerPeriodStart.value = periodStart;
    }
    if (elements.headerPeriodEnd) {
      elements.headerPeriodEnd.value = periodEnd;
    }
    syncNoExpiryPeriodState();

    state.items = [createEmptyItem({
      productId: String(selected?._id || ''),
      codigo: selected?.cod || '',
      produto: selected?.nome || '',
      preco: Number.isFinite(salePrice) ? formatTwoDecimals(salePrice) : '',
      desconto: Number.isFinite(percentage) ? formatTwoDecimals(percentage) : '',
      precoPromocao: Number.isFinite(promoPrice) ? formatTwoDecimals(promoPrice) : '',
      periodoInicio: periodStart,
      periodoFim: periodEnd,
    })];

    renderItems();
    persistDraft();
    document.getElementById('promotion-v2-items-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deactivateRegisteredPromotion(productId) {
    const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${productId}/inativar`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.message || 'Nao foi possivel inativar a promocao.');
    }
    await loadRegisteredProductPromotions();
  }

  async function activateRegisteredPromotion(productId, porcentagem) {
    const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${productId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ porcentagem }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.message || 'Nao foi possivel ativar a promocao.');
    }
    await loadRegisteredProductPromotions();
  }

  async function deleteRegisteredPromotion(productId) {
    const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${productId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.message || 'Nao foi possivel remover a promocao.');
    }
    await loadRegisteredProductPromotions();
  }

  async function deleteRegisteredConditionalPromotion(productId) {
    const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional/${productId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.message || 'Nao foi possivel remover a promocao condicional.');
    }
    await loadRegisteredProductPromotions();
  }

  async function deleteRegisteredConditionalPromotionGroup(groupCode, groupKey = '') {
    const normalizedCode = String(groupCode || '').trim();
    let targets = [];
    if (normalizedCode) {
      targets = state.registeredPromotions.filter((product) => {
        const code = String(product?.promocaoCondicional?.codigoGrupo || '').trim();
        return code === normalizedCode;
      });
    } else {
      const fallbackProductId = String(groupKey || '').startsWith('product:')
        ? String(groupKey).slice('product:'.length)
        : '';
      if (fallbackProductId) {
        targets = state.registeredPromotions.filter((product) => String(product?._id || '') === fallbackProductId);
      }
    }

    const ids = Array.from(new Set(targets.map((product) => String(product?._id || '')).filter(Boolean)));
    if (!ids.length) {
      throw new Error('Nenhum produto encontrado para remover este grupo condicional.');
    }

    for (const id of ids) {
      const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.message || 'Nao foi possivel remover a promocao condicional.');
      }
    }

    await loadRegisteredProductPromotions();
  }

  async function handleSave() {
    if (state.mode === 'global') {
      await handleGlobalSave();
      return;
    }

    if (state.mode === 'produto') {
      await handleProductSave();
      return;
    }

    await handleConditionalSave();
  }

  function getConditionalPayloadForItem(item) {
    const tipo = state.conditionalMode === 'leve_pague' ? 'leve_pague' : 'acima_de';
    const descontoFromItem = parseDecimalInput(item?.desconto);
    const preco = parseDecimalInput(item?.preco);
    const precoPromo = parseDecimalInput(item?.precoPromocao);
    const descontoDerivado = Number.isFinite(preco) && preco > 0 && Number.isFinite(precoPromo)
      ? ((preco - precoPromo) / preco) * 100
      : null;
    const descontoPorcentagem = Number.isFinite(descontoFromItem)
      ? Math.min(Math.max(descontoFromItem, 0), 100)
      : Number.isFinite(descontoDerivado)
        ? Math.min(Math.max(descontoDerivado, 0), 100)
        : 0;

    if (tipo === 'leve_pague') {
      const leve = Math.max(0, Math.trunc(parseDecimalInput(document.getElementById('promotion-v2-header-leve')?.value) || 0));
      const pague = Math.max(0, Math.trunc(parseDecimalInput(document.getElementById('promotion-v2-header-pague')?.value) || 0));
      return { tipo, leve, pague, quantidadeMinima: 0, descontoPorcentagem };
    }

    const quantidadeMinima = Math.max(0, Math.trunc(parseDecimalInput(document.getElementById('promotion-v2-header-acima-de')?.value) || 0));
    return { tipo, leve: 0, pague: 0, quantidadeMinima, descontoPorcentagem };
  }

  async function handleConditionalSave() {
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

    const conditionalConfigError = validateConditionalConfig();
    if (conditionalConfigError) {
      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Cadastro de Promocao V2',
          message: conditionalConfigError,
          confirmText: 'OK',
        });
      }
      return;
    }

    const validItems = state.items.filter((item) => item.codigo || item.produto);
    const codigoGrupo = await ensurePromotionGroupCode();
    const descricaoGrupo = getPromotionGroupDescription();
    const semValidade = Boolean(elements.noExpiryCheckbox?.checked);
    const periodoInicio = semValidade ? '' : (String(elements.headerPeriodStart?.value || '').trim() || getTodayIsoDate());
    const periodoFim = semValidade ? '' : (String(elements.headerPeriodEnd?.value || '').trim() || periodoInicio);
    const produtosDiferentes = Boolean(elements.differentProductsCheckbox?.checked);

    if (elements.saveButton) {
      elements.saveButton.disabled = true;
      elements.saveButton.textContent = 'A gravar...';
    }

    try {
      for (let index = 0; index < validItems.length; index += 1) {
        const item = validItems[index];
        const product = await resolveProductForItem(item);
        if (!product?._id) {
          throw new Error(`Produto da linha ${index + 1} nao foi encontrado. Use a importacao de produtos para selecionar itens validos.`);
        }

        item.productId = String(product._id);
        const payload = getConditionalPayloadForItem(item);

        const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional/${item.productId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            ...payload,
            produtosDiferentes,
            codigoGrupo,
            descricaoGrupo,
            periodoInicio,
            periodoFim,
            semValidade,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result?.message || `Falha ao gravar promocao condicional da linha ${index + 1}.`);
        }
      }

      persistDraft();
      await loadRegisteredProductPromotions();

      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Sucesso',
          message: 'Promocoes condicionais gravadas com sucesso.',
          confirmText: 'OK',
        });
      }
    } catch (error) {
      if (typeof window.showModal === 'function') {
        await window.showModal({
          title: 'Erro',
          message: error?.message || 'Nao foi possivel gravar as promocoes condicionais.',
          confirmText: 'OK',
        });
      }
    } finally {
      if (elements.saveButton) {
        elements.saveButton.disabled = false;
        elements.saveButton.textContent = SAVE_BUTTON_DEFAULT_TEXT;
      }
    }
  }

  function clearPromotionForm() {
    if (elements.headerCode) {
      elements.headerCode.value = '';
    }
    if (elements.headerDescription) {
      elements.headerDescription.value = '';
    }
    if (elements.headerDiscount) {
      elements.headerDiscount.value = '';
    }
    if (elements.headerPeriodStart) {
      elements.headerPeriodStart.value = getTodayIsoDate();
    }
    if (elements.headerPeriodEnd) {
      elements.headerPeriodEnd.value = elements.headerPeriodStart?.value || getTodayIsoDate();
    }
    if (elements.noExpiryCheckbox) {
      elements.noExpiryCheckbox.checked = false;
    }

    const acimaDeInput = document.getElementById('promotion-v2-header-acima-de');
    const leveInput = document.getElementById('promotion-v2-header-leve');
    const pagueInput = document.getElementById('promotion-v2-header-pague');
    if (acimaDeInput) acimaDeInput.value = '';
    if (leveInput) leveInput.value = '';
    if (pagueInput) pagueInput.value = '';
    if (elements.differentProductsCheckbox) {
      elements.differentProductsCheckbox.checked = false;
    }
    syncNoExpiryPeriodState();

    state.items = [];
    renderItems();
    persistDraft();
    window.showToast?.('Campos limpos para nova promocao.', 'success');
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
        void loadRegisteredProductPromotions();
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

    elements.addRowButton?.addEventListener('click', () => openImportModal({ context: 'grid' }));
    elements.saveButton?.addEventListener('click', handleSave);
    elements.importButton?.addEventListener('click', clearPromotionForm);
    elements.importClose?.addEventListener('click', closeImportModal);
    elements.importBackdrop?.addEventListener('click', closeImportModal);
    elements.importCancel?.addEventListener('click', closeImportModal);
    elements.importApply?.addEventListener('click', applyImportedProducts);
    elements.importSearchButton?.addEventListener('click', () => {
      searchProducts(elements.importSearch?.value || '');
    });
    elements.noExpiryCheckbox?.addEventListener('change', () => {
      syncNoExpiryPeriodState();
    });

    elements.headerCode?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void tryLoadPromotionGroupByCode();
    });

    elements.headerCode?.addEventListener('blur', () => {
      void tryLoadPromotionGroupByCode();
    });

    elements.itemsBody?.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const row = target.closest('tr[data-item-id]');
      const field = target.dataset.field;
      if (!row || !field) return;
      updateItem(row.dataset.itemId || '', field, target.value);
    });

    elements.itemsBody?.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const row = target.closest('tr[data-item-id]');
      const field = target.dataset.field;
      if (!row || !field) return;
      if (field !== 'preco' && field !== 'precoPromocao' && field !== 'desconto') return;
      const itemId = row.dataset.itemId || '';
      const precoInput = row.querySelector('input[data-field="preco"]');
      const promoInput = row.querySelector('input[data-field="precoPromocao"]');
      const descontoInput = row.querySelector('input[data-field="desconto"]');

      if (
        !(precoInput instanceof HTMLInputElement)
        || !(promoInput instanceof HTMLInputElement)
        || !(descontoInput instanceof HTMLInputElement)
      ) {
        const formatted = formatTwoDecimals(target.value);
        target.value = formatted;
        updateItem(itemId, field, formatted);
        return;
      }

      const preco = parseDecimalInput(precoInput.value);
      if (!Number.isFinite(preco) || preco <= 0) {
        const formatted = formatTwoDecimals(target.value);
        target.value = formatted;
        updateItem(itemId, field, formatted);
        return;
      }

      if (field === 'desconto') {
        const descontoValue = parseDecimalInput(descontoInput.value);
        const clampedDesconto = Number.isFinite(descontoValue)
          ? Math.min(Math.max(descontoValue, 0), 100)
          : 0;
        const promoValue = preco * (1 - (clampedDesconto / 100));
        descontoInput.value = formatTwoDecimals(clampedDesconto);
        promoInput.value = formatTwoDecimals(promoValue);
        updateItem(itemId, 'desconto', descontoInput.value);
        updateItem(itemId, 'precoPromocao', promoInput.value);
        return;
      }

      if (field === 'precoPromocao') {
        const promoValue = parseDecimalInput(promoInput.value);
        const clampedPromo = Number.isFinite(promoValue)
          ? Math.min(Math.max(promoValue, 0), preco)
          : 0;
        const descontoValue = ((preco - clampedPromo) / preco) * 100;
        promoInput.value = formatTwoDecimals(clampedPromo);
        descontoInput.value = formatTwoDecimals(descontoValue);
        updateItem(itemId, 'precoPromocao', promoInput.value);
        updateItem(itemId, 'desconto', descontoInput.value);
        return;
      }

      const formatted = formatTwoDecimals(precoInput.value);
      precoInput.value = formatted;
      updateItem(itemId, 'preco', formatted);
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
      }
    });

    elements.registeredBody?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-registered-action]');
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.dataset.registeredAction || '';
      const productId = button.dataset.productId || '';
      const groupCode = button.dataset.groupCode || '';
      const groupKey = button.dataset.groupKey || '';

      if (action !== 'delete-conditional' && !productId) return;

      if (action === 'edit') {
        editRegisteredPromotion(productId);
        return;
      }

      if (action === 'deactivate') {
        const isActive = String(button.dataset.productActive || '') === 'true';
        const selected = state.registeredPromotions.find((product) => String(product?._id || '') === productId);
        const percentage = parseDecimalInput(selected?.promocao?.porcentagem);
        const porcentagem = Number.isFinite(percentage) ? percentage : 0;

        if (typeof window.showModal === 'function') {
          if (isActive) {
            window.showModal({
              title: 'Inativar promocao',
              message: 'Deseja inativar temporariamente esta promocao?',
              confirmText: 'Inativar',
              cancelText: 'Cancelar',
              onConfirm: async () => {
                try {
                  await deactivateRegisteredPromotion(productId);
                  window.showToast?.('Promocao inativada temporariamente.', 'success');
                } catch (error) {
                  await window.showModal({
                    title: 'Erro',
                    message: error?.message || 'Nao foi possivel inativar a promocao.',
                    confirmText: 'OK',
                  });
                }
                return true;
              },
            });
          } else {
            window.showModal({
              title: 'Ativar promocao',
              message: 'Esta promocao esta inativa. Deseja ativar novamente a promocao?',
              confirmText: 'Ativar',
              cancelText: 'Cancelar',
              onConfirm: async () => {
                try {
                  await activateRegisteredPromotion(productId, porcentagem);
                  window.showToast?.('Promocao ativada novamente com sucesso.', 'success');
                } catch (error) {
                  await window.showModal({
                    title: 'Erro',
                    message: error?.message || 'Nao foi possivel ativar a promocao.',
                    confirmText: 'OK',
                  });
                }
                return true;
              },
            });
          }
        }
        return;
      }

      if (action === 'delete') {
        if (typeof window.showModal === 'function') {
          window.showModal({
            title: 'Remover promocao',
            message: 'Deseja remover esta promocao definitivamente?',
            confirmText: 'Remover',
            cancelText: 'Cancelar',
            onConfirm: async () => {
              try {
                await deleteRegisteredPromotion(productId);
                window.showToast?.('Promocao removida com sucesso.', 'success');
              } catch (error) {
                await window.showModal({
                  title: 'Erro',
                  message: error?.message || 'Nao foi possivel remover a promocao.',
                  confirmText: 'OK',
                });
              }
              return true;
            },
          });
        } else if (window.confirm('Deseja remover esta promocao definitivamente?')) {
          (async () => {
            try {
              await deleteRegisteredPromotion(productId);
              window.showToast?.('Promocao removida com sucesso.', 'success');
            } catch (error) {
              window.alert(error?.message || 'Nao foi possivel remover a promocao.');
            }
          })();
        }
        return;
      }

      if (action === 'delete-conditional') {
        if (typeof window.showModal === 'function') {
          window.showModal({
            title: 'Remover promocao condicional',
            message: 'Deseja remover esta promocao condicional?',
            confirmText: 'Remover',
            cancelText: 'Cancelar',
            onConfirm: async () => {
              try {
                await deleteRegisteredConditionalPromotionGroup(groupCode, groupKey);
                window.showToast?.('Promocao condicional removida com sucesso.', 'success');
              } catch (error) {
                await window.showModal({
                  title: 'Erro',
                  message: error?.message || 'Nao foi possivel remover a promocao condicional.',
                  confirmText: 'OK',
                });
              }
              return true;
            },
          });
        } else if (window.confirm('Deseja remover esta promocao condicional?')) {
          (async () => {
            try {
              await deleteRegisteredConditionalPromotionGroup(groupCode, groupKey);
              window.showToast?.('Promocao condicional removida com sucesso.', 'success');
            } catch (error) {
              window.alert(error?.message || 'Nao foi possivel remover a promocao condicional.');
            }
          })();
        }
        return;
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
        elements.importResultsBody?.querySelectorAll('input[data-import-select]').forEach((input) => {
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

    if (elements.headerCode) {
      elements.headerCode.readOnly = false;
      elements.headerCode.classList.remove('bg-gray-100');
      elements.headerCode.placeholder = 'Codigo';
    }

    const draft = loadDraft();
    renderItems();
    setDefaultHeaderDates();
    syncNoExpiryPeriodState();
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
    await loadRegisteredProductPromotions();
    persistDraft();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

