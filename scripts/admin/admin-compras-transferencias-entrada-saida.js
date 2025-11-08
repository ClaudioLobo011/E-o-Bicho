(function () {
  const form = document.getElementById('inventory-movement-form');
  if (!form) {
    return;
  }

  function getToken() {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
      return loggedInUser?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token de autenticação.', error);
      return '';
    }
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeSearchText(value = '') {
    if (value === null || value === undefined) return '';
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  const state = {
    operation: 'saida',
    items: [],
    companies: [],
    deposits: [],
    responsibles: [],
    selectedResponsibleId: '',
    productSearchCache: new Map(),
    productDetailsCache: new Map(),
    isSubmitting: false,
    pendingProduct: null,
    productSearchModal: {
      isOpen: false,
      controller: null,
      timeout: null,
      lastTerm: '',
      includeInactive: false,
    },
  };

  const PRODUCT_SEARCH_FILTER_KEYS = ['cod', 'descricao', 'codbarras', 'custo', 'venda'];
  const PRODUCT_SEARCH_SALE_KEYS = ['venda', 'precoVenda', 'preco', 'valorVenda', 'valor'];
  const DEFAULT_PRODUCT_SEARCH_FILTERS = PRODUCT_SEARCH_FILTER_KEYS.reduce((accumulator, key) => {
    // eslint-disable-next-line no-param-reassign
    accumulator[key] = '';
    return accumulator;
  }, {});

  const productSearchTableState = {
    results: [],
    filters: { ...DEFAULT_PRODUCT_SEARCH_FILTERS },
    sort: { key: '', direction: 'asc' },
  };

  let productSearchOriginalOrder = new WeakMap();
  const productSearchFilterInputs = new Map();
  const productSearchSortButtonsMeta = new Map();
  const productSearchSortHeaders = new Map();
  let productSearchTableControlsInitialized = false;

  const productSearchCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const MOVEMENT_REASONS = {
    saida: [
      { value: 'ajuste_perda', label: 'Ajuste por perda ou avaria' },
      { value: 'consumo_interno', label: 'Consumo interno' },
      { value: 'doacao', label: 'Doação' },
      { value: 'transferencia_emergencial', label: 'Transferência emergencial' },
      { value: 'devolucao_fornecedor', label: 'Devolução a fornecedor' },
    ],
    entrada: [
      { value: 'ajuste_inventario', label: 'Ajuste pós inventário' },
      { value: 'devolucao_cliente', label: 'Devolução de cliente' },
      { value: 'bonificacao', label: 'Bonificação de fornecedor' },
      { value: 'regularizacao', label: 'Regularização contábil' },
      { value: 'transferencia_recebida', label: 'Transferência recebida sem NF-e' },
    ],
  };

  const OPERATION_CONFIG = {
    saida: {
      badgeClass:
        'inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700',
      icon: 'fa-arrow-trend-down',
      label: 'Saída de estoque',
      reasonHelp:
        'Registre saídas motivadas por ajustes, perdas, consumo interno ou transferências emergenciais.',
      submitText: 'Salvar saída',
    },
    entrada: {
      badgeClass:
        'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700',
      icon: 'fa-arrow-trend-up',
      label: 'Entrada de estoque',
      reasonHelp:
        'Informe entradas originadas de devoluções, bonificações, regularizações ou inventários.',
      submitText: 'Salvar entrada',
    },
  };

  const LETTER_INPUT_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
  const LETTER_GLOBAL_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
  const DEFAULT_PRODUCT_SEARCH_STATUS =
    'Digite o código e pressione Enter para buscar rapidamente ou comece com letras para abrir a busca avançada.';

  const elements = {
    operationRadios: form.querySelectorAll('input[name="movement-type"]'),
    reasonSelect: document.getElementById('movement-reason'),
    reasonHelp: document.getElementById('movement-reason-help'),
    operationBadge: document.getElementById('operation-badge'),
    submitButton: document.getElementById('movement-submit-button'),
    clearButton: document.getElementById('movement-clear-button'),
    companySelect: document.getElementById('movement-company'),
    depositSelect: document.getElementById('movement-deposit'),
    responsibleInput: document.getElementById('movement-responsible'),
    responsibleHidden: document.getElementById('movement-responsible-id'),
    responsibleOptions: document.getElementById('movement-responsible-options'),
    itemsBody: document.getElementById('movement-items-body'),
    emptyStateRow: document.getElementById('movement-empty-state'),
    addItemButton: document.getElementById('movement-add-item'),
    productSearchInput: document.getElementById('movement-product-search'),
    productSearchButton: document.getElementById('movement-open-product-search'),
    productQuantityInput: document.getElementById('movement-product-quantity'),
    productCostInput: document.getElementById('movement-product-cost'),
    productNotesInput: document.getElementById('movement-product-notes'),
    productSearchStatus: document.getElementById('movement-product-search-status'),
    productSearchModal: document.getElementById('movement-product-search-modal'),
    productSearchModalInput: document.getElementById('movement-product-search-input'),
    productSearchModalClose: document.getElementById('movement-product-search-close'),
    productSearchModalCancel: document.getElementById('movement-product-search-cancel'),
    productSearchModalFeedback: document.getElementById('movement-product-search-feedback'),
    productSearchModalResults: document.getElementById('movement-product-search-results'),
    productSearchModalShowInactive: document.getElementById('movement-product-search-show-inactive'),
    totalItems: document.getElementById('movement-total-items'),
    totalQuantity: document.getElementById('movement-total-quantity'),
    totalValue: document.getElementById('movement-total-value'),
    feedback: document.getElementById('movement-feedback'),
    dateInput: document.getElementById('movement-date'),
    referenceInput: document.getElementById('movement-reference'),
    notesInput: document.getElementById('movement-notes'),
  };

  function parseDecimal(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const trimmed = String(value).trim();
    if (!trimmed) return null;

    const direct = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(direct)) {
      return direct;
    }

    const sanitized = trimmed
      .replace(/[^0-9.,-]/g, '')
      .replace(/\.(?=.*\.)/g, '')
      .replace(',', '.');

    const fallback = Number(sanitized);
    return Number.isFinite(fallback) ? fallback : null;
  }

  function formatQuantity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return '0';
    }
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    }).format(Math.abs(number));
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 'R$\u00a00,00';
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getProductSearchId(product = {}) {
    const { _id: id } = product || {};
    if (!id) return '';
    return String(id);
  }

  function getProductSearchCode(product = {}) {
    return normalizeString(product?.cod);
  }

  function getProductSearchDescription(product = {}) {
    return normalizeString(product?.nome) || 'Produto sem descrição';
  }

  function getProductSearchBarcode(product = {}) {
    return normalizeString(product?.codbarras);
  }

  function getProductSearchCostNumber(product = {}) {
    const value = parseDecimal(product?.custo);
    return Number.isFinite(value) ? value : null;
  }

  function getProductSearchSaleNumber(product = {}) {
    if (!product || typeof product !== 'object') {
      return null;
    }

    for (const key of PRODUCT_SEARCH_SALE_KEYS) {
      if (!key) continue;
      const parsed = parseDecimal(product?.[key]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  function getProductSearchFilterCandidates(product = {}, key) {
    switch (key) {
      case 'cod':
        return [getProductSearchCode(product) || ''];
      case 'descricao':
        return [getProductSearchDescription(product) || ''];
      case 'codbarras':
        return [getProductSearchBarcode(product) || ''];
      case 'custo': {
        const candidates = [];
        const costNumber = getProductSearchCostNumber(product);
        if (Number.isFinite(costNumber)) {
          candidates.push(String(costNumber));
          candidates.push(productSearchCurrencyFormatter.format(costNumber));
        }
        if (product?.custo !== null && product?.custo !== undefined && product?.custo !== '') {
          candidates.push(String(product.custo));
        }
        return candidates.length ? candidates : [''];
      }
      case 'venda': {
        const candidates = [];
        const saleNumber = getProductSearchSaleNumber(product);
        if (Number.isFinite(saleNumber)) {
          candidates.push(String(saleNumber));
          candidates.push(productSearchCurrencyFormatter.format(saleNumber));
        }
        PRODUCT_SEARCH_SALE_KEYS.forEach((saleKey) => {
          if (!saleKey) return;
          const rawValue = product?.[saleKey];
          if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
            candidates.push(String(rawValue));
          }
        });
        return candidates.length ? candidates : [''];
      }
      default:
        return [''];
    }
  }

  function hasActiveProductSearchFilters() {
    return Object.values(productSearchTableState.filters || {}).some(
      (value) => typeof value === 'string' && value.trim() !== '',
    );
  }

  function escapeProductSearchRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildProductSearchFilterRegex(rawValue) {
    const normalizedFilter = normalizeSearchText(rawValue || '');
    if (!normalizedFilter) {
      return null;
    }
    const pattern = normalizedFilter
      .split('*')
      .map((segment) => escapeProductSearchRegex(segment))
      .join('.*');
    if (!pattern) {
      return null;
    }
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      console.warn('Filtro inválido ignorado na busca de produtos.', error);
      return null;
    }
  }

  function matchesProductSearchFilter(product, key, filterValue) {
    if (!key) return true;
    const regex = buildProductSearchFilterRegex(filterValue);
    if (!regex) return true;
    const candidates = getProductSearchFilterCandidates(product, key);
    return candidates.some((candidate) => regex.test(normalizeSearchText(candidate)));
  }

  function applyProductSearchFilters(products) {
    const list = Array.isArray(products) ? products : [];
    const filters = productSearchTableState.filters || {};
    const activeFilters = Object.entries(filters).filter(
      ([, value]) => typeof value === 'string' && value.trim() !== '',
    );
    if (!activeFilters.length) {
      return list.slice();
    }
    return list.filter((product) =>
      activeFilters.every(([key, value]) => matchesProductSearchFilter(product, key, value)),
    );
  }

  function getProductSearchOriginalPosition(product) {
    if (!product || typeof product !== 'object') {
      return 0;
    }
    return productSearchOriginalOrder.get(product) ?? 0;
  }

  function getProductSearchSortValue(product = {}, key) {
    switch (key) {
      case 'cod':
        return getProductSearchCode(product) || '';
      case 'descricao':
        return getProductSearchDescription(product) || '';
      case 'codbarras':
        return getProductSearchBarcode(product) || '';
      case 'custo':
        return getProductSearchCostNumber(product);
      case 'venda':
        return getProductSearchSaleNumber(product);
      default:
        return '';
    }
  }

  function applyProductSearchSort(products) {
    const list = Array.isArray(products) ? products : [];
    const { key, direction } = productSearchTableState.sort || {};
    const sortKey = key || '';
    if (!sortKey) {
      return list.slice();
    }
    const multiplier = direction === 'desc' ? -1 : 1;
    return list.slice().sort((a, b) => {
      const valueA = getProductSearchSortValue(a, sortKey);
      const valueB = getProductSearchSortValue(b, sortKey);
      const missingA = valueA === null || valueA === undefined || valueA === '';
      const missingB = valueB === null || valueB === undefined || valueB === '';
      if (missingA && missingB) {
        return getProductSearchOriginalPosition(a) - getProductSearchOriginalPosition(b);
      }
      if (missingA) return 1;
      if (missingB) return -1;
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        if (valueA === valueB) {
          return getProductSearchOriginalPosition(a) - getProductSearchOriginalPosition(b);
        }
        return valueA > valueB ? multiplier : -multiplier;
      }
      const textA = normalizeSearchText(valueA);
      const textB = normalizeSearchText(valueB);
      const comparison = textA.localeCompare(textB, 'pt-BR', {
        sensitivity: 'base',
        numeric: true,
      });
      if (comparison === 0) {
        return getProductSearchOriginalPosition(a) - getProductSearchOriginalPosition(b);
      }
      return comparison * multiplier;
    });
  }

  function updateProductSearchSortButtons() {
    const { key: activeKey, direction: activeDirectionRaw } = productSearchTableState.sort || {};
    const activeDirection = activeDirectionRaw === 'desc' ? 'desc' : 'asc';
    productSearchSortHeaders.forEach((header, headerKey) => {
      if (!header) return;
      if (activeKey && headerKey === activeKey) {
        header.setAttribute('aria-sort', activeDirection === 'desc' ? 'descending' : 'ascending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });
    productSearchSortButtonsMeta.forEach((meta, button) => {
      if (!button) return;
      const isActive = Boolean(activeKey) && meta.key === activeKey && meta.direction === activeDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/60', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function renderProductSearchPlaceholderRow(message) {
    if (!elements.productSearchModalResults) return;
    elements.productSearchModalResults.innerHTML = `
      <tr>
        <td colspan="5" class="px-4 py-6 text-center text-[11px] text-gray-500">${escapeHtml(
          message,
        )}</td>
      </tr>
    `;
  }

  function resetProductSearchFilters() {
    productSearchTableState.filters = { ...DEFAULT_PRODUCT_SEARCH_FILTERS };
    productSearchFilterInputs.forEach((input, key) => {
      if (!input) return;
      const nextValue = productSearchTableState.filters[key] || '';
      if (input.value !== nextValue) {
        input.value = nextValue;
      }
    });
  }

  function setProductSearchFilter(key, value) {
    if (!key) return;
    const nextValue = typeof value === 'string' ? value : '';
    const currentValue = productSearchTableState.filters[key] || '';
    if (currentValue === nextValue) {
      return;
    }
    productSearchTableState.filters[key] = nextValue;
    renderProductSearchTable();
  }

  function setProductSearchSort(key, direction) {
    if (!key) return;
    const nextDirection = direction === 'desc' ? 'desc' : 'asc';
    const { key: currentKey, direction: currentDirection } = productSearchTableState.sort || {};
    if (currentKey === key && currentDirection === nextDirection) {
      productSearchTableState.sort = { key: '', direction: 'asc' };
    } else {
      productSearchTableState.sort = { key, direction: nextDirection };
    }
    updateProductSearchSortButtons();
    renderProductSearchTable();
  }

  function setupProductSearchTableControls() {
    if (productSearchTableControlsInitialized) return;
    if (!elements.productSearchModal) return;
    productSearchTableControlsInitialized = true;

    const filterInputs = elements.productSearchModal.querySelectorAll(
      '[data-movement-product-search-filter]',
    );
    filterInputs.forEach((input) => {
      const key = input.dataset.movementProductSearchFilter;
      if (!key) return;
      productSearchFilterInputs.set(key, input);
      const currentValue = productSearchTableState.filters[key] || '';
      if (input.value !== currentValue) {
        input.value = currentValue;
      }
      input.addEventListener('input', (event) => {
        setProductSearchFilter(key, event.target.value || '');
      });
    });

    const sortButtons = elements.productSearchModal.querySelectorAll(
      '[data-movement-product-search-sort]',
    );
    sortButtons.forEach((button) => {
      const key = button.dataset.movementProductSearchSort;
      if (!key) return;
      const direction = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
      productSearchSortButtonsMeta.set(button, { key, direction });
      const header = button.closest('[data-movement-product-search-sort-header]');
      if (header && !productSearchSortHeaders.has(key)) {
        productSearchSortHeaders.set(key, header);
      }
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setProductSearchSort(key, direction);
      });
    });

    updateProductSearchSortButtons();
  }

  function renderProductSearchTable() {
    if (!elements.productSearchModalResults) return;

    if (!Array.isArray(productSearchTableState.results) || !productSearchTableState.results.length) {
      const lastTerm = state.productSearchModal.lastTerm || '';
      const isIncompleteTerm = lastTerm.length > 0 && lastTerm.length < 3;
      const placeholderMessage = isIncompleteTerm
        ? 'Digite ao menos três caracteres para listar os produtos disponíveis.'
        : lastTerm
          ? 'Nenhum produto encontrado para a pesquisa informada.'
          : 'Digite para buscar produtos pelo código ou descrição.';
      renderProductSearchPlaceholderRow(placeholderMessage);
      const feedbackTone = isIncompleteTerm ? 'warning' : lastTerm ? 'info' : 'muted';
      showProductSearchModalFeedback(
        placeholderMessage,
        feedbackTone,
      );
      updateProductSearchSortButtons();
      return;
    }

    const filtered = applyProductSearchFilters(productSearchTableState.results);
    if (!filtered.length) {
      renderProductSearchPlaceholderRow('Nenhum produto encontrado com os filtros aplicados.');
      showProductSearchModalFeedback('Nenhum produto encontrado com os filtros aplicados.', 'info');
      updateProductSearchSortButtons();
      return;
    }

    const sorted = applyProductSearchSort(filtered);
    updateProductSearchSortButtons();
    hideProductSearchModalFeedback();

    const fragment = document.createDocumentFragment();
    sorted.forEach((product) => {
      const row = document.createElement('tr');
      row.className = 'border-b border-gray-100 last:border-0 hover:bg-primary/10 transition-colors';
      const productIdValue = getProductSearchId(product);
      if (productIdValue) {
        row.dataset.productId = productIdValue;
        row.dataset.productSelectable = 'true';
        row.dataset.sku = getProductSearchCode(product) || '';
        row.dataset.barcode = getProductSearchBarcode(product) || '';
        row.dataset.name = getProductSearchDescription(product) || '';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.classList.add(
          'cursor-pointer',
          'focus-visible:outline-none',
          'focus-visible:ring-2',
          'focus-visible:ring-primary/40',
          'focus-visible:ring-offset-1',
        );
      }

      const codeCell = document.createElement('td');
      codeCell.className = 'px-4 py-3 text-xs font-semibold text-gray-700 whitespace-nowrap';
      codeCell.textContent = getProductSearchCode(product) || '—';

      const descriptionCell = document.createElement('td');
      descriptionCell.className = 'px-4 py-3 text-xs text-gray-700';
      descriptionCell.textContent = getProductSearchDescription(product) || '—';

      const barcodeCell = document.createElement('td');
      barcodeCell.className = 'px-4 py-3 text-xs text-gray-600 whitespace-nowrap';
      barcodeCell.textContent = getProductSearchBarcode(product) || '—';

      const costCell = document.createElement('td');
      costCell.className = 'px-4 py-3 text-xs text-right text-gray-700 whitespace-nowrap';
      const costNumber = getProductSearchCostNumber(product);
      costCell.textContent = Number.isFinite(costNumber)
        ? productSearchCurrencyFormatter.format(costNumber)
        : '—';

      const saleCell = document.createElement('td');
      saleCell.className = 'px-4 py-3 text-xs text-right font-semibold text-gray-800 whitespace-nowrap';
      const saleNumber = getProductSearchSaleNumber(product);
      saleCell.textContent = Number.isFinite(saleNumber)
        ? productSearchCurrencyFormatter.format(saleNumber)
        : '—';

      row.append(codeCell, descriptionCell, barcodeCell, costCell, saleCell);
      fragment.appendChild(row);
    });

    elements.productSearchModalResults.innerHTML = '';
    elements.productSearchModalResults.appendChild(fragment);
  }

  function renderProductSearchModalResults(products = []) {
    if (!elements.productSearchModalResults) return;
    const list = Array.isArray(products)
      ? products.filter((item) => item && typeof item === 'object')
      : [];

    if (!list.length) {
      productSearchTableState.results = [];
      productSearchOriginalOrder = new WeakMap();
      const hasFilters = hasActiveProductSearchFilters();
      const message = hasFilters
        ? 'Nenhum produto encontrado com os filtros aplicados.'
        : 'Nenhum produto encontrado para a pesquisa informada.';
      renderProductSearchPlaceholderRow(message);
      showProductSearchModalFeedback(message, 'info');
      updateProductSearchSortButtons();
      return;
    }

    productSearchOriginalOrder = new WeakMap();
    list.forEach((product, index) => {
      if (product && typeof product === 'object') {
        productSearchOriginalOrder.set(product, index);
      }
    });
    productSearchTableState.results = list.slice();
    renderProductSearchTable();
  }

  function hideFeedback() {
    if (!elements.feedback) return;
    elements.feedback.textContent = '';
    elements.feedback.className = 'hidden';
  }

  function showFeedback(message, type = 'success') {
    if (!elements.feedback) return;
    const baseClasses = 'rounded-lg px-4 py-3 text-sm font-medium border';
    if (type === 'error') {
      elements.feedback.className = `${baseClasses} border-red-200 bg-red-50 text-red-700`;
    } else {
      elements.feedback.className = `${baseClasses} border-emerald-200 bg-emerald-50 text-emerald-700`;
    }
    elements.feedback.textContent = message;
  }

  function populateCompanySelect() {
    if (!elements.companySelect) return;
    const previousValue = elements.companySelect.value;
    elements.companySelect.innerHTML = '<option value="">Selecione a empresa</option>';

    state.companies.forEach((company) => {
      const option = document.createElement('option');
      option.value = company?._id ? String(company._id) : '';
      option.textContent =
        company?.nomeFantasia || company?.nome || company?.apelido || 'Empresa sem nome';
      elements.companySelect.appendChild(option);
    });

    const exists = state.companies.some(
      (company) => String(company?._id) === String(previousValue),
    );
    elements.companySelect.value = exists ? previousValue : '';
  }

  function populateDepositSelect(companyId) {
    if (!elements.depositSelect) return;
    const previousValue = elements.depositSelect.value;
    elements.depositSelect.innerHTML = '<option value="">Selecione o depósito</option>';

    const filteredDeposits = state.deposits.filter((deposit) => {
      if (!deposit) return false;
      const depositCompanyId = deposit?.empresa ? String(deposit.empresa) : '';
      return companyId && depositCompanyId === String(companyId);
    });

    filteredDeposits.forEach((deposit) => {
      const option = document.createElement('option');
      option.value = deposit?._id ? String(deposit._id) : '';
      option.textContent = deposit?.nome || 'Depósito sem nome';
      elements.depositSelect.appendChild(option);
    });

    const depositExists = filteredDeposits.some(
      (deposit) => String(deposit?._id) === String(previousValue),
    );
    elements.depositSelect.value = depositExists ? previousValue : '';
  }

  function populateResponsibleOptions() {
    if (!elements.responsibleOptions) return;
    elements.responsibleOptions.innerHTML = '';

    state.responsibles.forEach((responsible) => {
      const id = responsible?._id ? String(responsible._id) : '';
      const fullName = normalizeString(responsible?.nomeCompleto);
      const nickname = normalizeString(responsible?.apelido);
      const email = normalizeString(responsible?.email);

      const option = document.createElement('option');
      option.value = fullName || nickname || email || id;
      option.dataset.id = id;

      const labelParts = [];
      if (fullName) labelParts.push(fullName);
      if (nickname && nickname !== fullName) labelParts.push(nickname);
      if (email) labelParts.push(email);
      if (labelParts.length > 1) {
        option.label = labelParts.join(' • ');
      }

      elements.responsibleOptions.appendChild(option);
    });
  }

  function setSelectedResponsible(id, label, options = {}) {
    const { preserveInput = false } = options;
    state.selectedResponsibleId = id ? String(id) : '';
    if (elements.responsibleHidden) {
      elements.responsibleHidden.value = state.selectedResponsibleId;
    }

    if (!preserveInput && label && elements.responsibleInput) {
      elements.responsibleInput.value = label;
    }
  }

  function resolveResponsibleByInput(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
      return null;
    }

    const responsible = state.responsibles.find((item) => {
      const candidates = [item?.nomeCompleto, item?.apelido, item?.email]
        .map((entry) => normalizeString(entry).toLowerCase())
        .filter(Boolean);
      return candidates.includes(normalized);
    });

    if (responsible) {
      return {
        id: responsible?._id ? String(responsible._id) : '',
        label: responsible?.nomeCompleto || responsible?.apelido || responsible?.email || '',
      };
    }

    const options = elements.responsibleOptions
      ? Array.from(elements.responsibleOptions.querySelectorAll('option'))
      : [];
    for (const option of options) {
      if (normalizeString(option.value).toLowerCase() === normalized) {
        return { id: option.dataset.id || '', label: option.value };
      }
    }

    return null;
  }

  function handleResponsibleInputChange() {
    const value = elements.responsibleInput?.value || '';
    const resolved = resolveResponsibleByInput(value);
    if (resolved && resolved.id) {
      setSelectedResponsible(resolved.id, resolved.label || value, { preserveInput: false });
    } else {
      setSelectedResponsible('', '', { preserveInput: true });
    }
  }

  function handleResponsibleBlur() {
    const value = elements.responsibleInput?.value || '';
    if (!value) {
      setSelectedResponsible('', '', { preserveInput: true });
      return;
    }
    const resolved = resolveResponsibleByInput(value);
    if (resolved && resolved.id) {
      setSelectedResponsible(resolved.id, resolved.label || value);
    }
  }

  function populateReasons(operation) {
    if (!elements.reasonSelect) return;
    const previousValue = elements.reasonSelect.value;
    elements.reasonSelect.innerHTML = '<option value="">Selecione o motivo</option>';
    const reasons = MOVEMENT_REASONS[operation] || [];
    reasons.forEach((reason) => {
      const option = document.createElement('option');
      option.value = reason.value;
      option.textContent = reason.label;
      elements.reasonSelect.appendChild(option);
    });
    if (reasons.some((reason) => reason.value === previousValue)) {
      elements.reasonSelect.value = previousValue;
    } else {
      elements.reasonSelect.value = '';
    }
  }

  function updateOperationUI() {
    const config = OPERATION_CONFIG[state.operation];
    if (!config) return;

    if (elements.operationBadge) {
      elements.operationBadge.className = config.badgeClass;
      elements.operationBadge.innerHTML = `<i class="fas ${config.icon}"></i><span>${config.label}</span>`;
    }

    if (elements.reasonHelp) {
      elements.reasonHelp.textContent = config.reasonHelp;
    }

    if (elements.submitButton) {
      elements.submitButton.innerHTML = `<i class="fas fa-save"></i> ${config.submitText}`;
    }

    populateReasons(state.operation);
    renderItems();
  }

  async function loadFormData() {
    try {
      const token = getToken();
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/inventory-adjustments/form-data`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Não foi possível carregar os dados iniciais.');
      }

      const data = await response.json();
      state.companies = Array.isArray(data?.stores) ? data.stores : [];
      state.deposits = Array.isArray(data?.deposits) ? data.deposits : [];
      state.responsibles = Array.isArray(data?.responsaveis) ? data.responsaveis : [];

      populateCompanySelect();
      populateDepositSelect(elements.companySelect?.value || '');
      populateResponsibleOptions();
    } catch (error) {
      console.error('Erro ao carregar dados da movimentação de estoque:', error);
      showFeedback(error.message || 'Não foi possível carregar os dados da movimentação.', 'error');
    }
  }

  async function searchProducts(term, options = {}) {
    const normalizedTerm = normalizeString(term);
    if (!normalizedTerm) {
      return [];
    }

    const includeInactive = options.includeInactive === true;
    const cacheKey = `${normalizedTerm.toLowerCase()}::${includeInactive ? 'with-inactive' : 'only-active'}`;
    if (!options.skipCache && state.productSearchCache.has(cacheKey)) {
      return state.productSearchCache.get(cacheKey);
    }

    const token = getToken();
    if (!token) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const url = new URL(`${API_CONFIG.BASE_URL}/inventory-adjustments/search-products`);
    url.searchParams.set('term', normalizedTerm);
    if (includeInactive) {
      url.searchParams.set('includeInactive', 'true');
    }
    const fetchOptions = {
      headers: { Authorization: `Bearer ${token}` },
    };

    if (options.signal) {
      fetchOptions.signal = options.signal;
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.message || 'Não foi possível buscar produtos no momento.');
    }

    const data = await response.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    if (!options.skipCache) {
      state.productSearchCache.set(cacheKey, products);
    }
    return products;
  }

  async function fetchProductDetails(productId) {
    const key = String(productId);
    if (state.productDetailsCache.has(key)) {
      return state.productDetailsCache.get(key);
    }

    const token = getToken();
    if (!token) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const response = await fetch(`${API_CONFIG.BASE_URL}/inventory-adjustments/products/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.message || 'Não foi possível carregar os detalhes do produto.');
    }

    const data = await response.json();
    state.productDetailsCache.set(key, data);
    return data;
  }

  async function resolveProductByTerm(term, options = {}) {
    const { codeTerm } = options;
    const products = await searchProducts(term);

    if (!products.length) {
      throw new Error('Nenhum produto foi encontrado com os dados informados.');
    }

    let selected = null;
    if (codeTerm) {
      const normalizedCode = normalizeString(codeTerm).toLowerCase();
      const numericCode = normalizedCode.replace(/\D/g, '');
      selected = products.find((product) => {
        const sku = normalizeString(product?.cod).toLowerCase();
        const barcode = normalizeString(product?.codbarras).toLowerCase();
        const numericBarcode = barcode.replace(/\D/g, '');
        return (
          (sku && sku === normalizedCode) ||
          (barcode && barcode === normalizedCode) ||
          (numericCode && numericBarcode && numericCode === numericBarcode)
        );
      });
    }

    if (!selected && products.length === 1) {
      [selected] = products;
    }

    if (!selected) {
      throw new Error(
        'Refine a busca do produto informando o código exato ou escolha um resultado específico.',
      );
    }

    return selected;
  }

  function updateProductSearchStatus(message, tone = 'muted') {
    if (!elements.productSearchStatus) return;

    const classList = ['text-xs'];
    switch (tone) {
      case 'success':
        classList.push('text-emerald-600', 'font-medium');
        break;
      case 'warning':
        classList.push('text-amber-600', 'font-medium');
        break;
      case 'error':
        classList.push('text-red-600', 'font-medium');
        break;
      default:
        classList.push('text-gray-500');
        break;
    }

    elements.productSearchStatus.className = classList.join(' ');
    elements.productSearchStatus.textContent = message;
  }

  function clearPendingProduct(options = {}) {
    state.pendingProduct = null;
    if (elements.productSearchInput) {
      delete elements.productSearchInput.dataset.productId;
    }
    if (options.resetStatus) {
      updateProductSearchStatus(DEFAULT_PRODUCT_SEARCH_STATUS, 'muted');
    }
  }

  function setPendingProduct(product, options = {}) {
    if (!product || !product._id) {
      clearPendingProduct({ resetStatus: true });
      return;
    }

    state.pendingProduct = {
      _id: String(product._id),
      cod: normalizeString(product?.cod),
      codbarras: normalizeString(product?.codbarras),
      nome: normalizeString(product?.nome),
    };

    if (elements.productSearchInput) {
      elements.productSearchInput.dataset.productId = state.pendingProduct._id;
      if (!options.preserveInput) {
        const preferredCode = state.pendingProduct.cod || state.pendingProduct.codbarras;
        if (preferredCode) {
          elements.productSearchInput.value = preferredCode;
        }
      }
    }

    const description = state.pendingProduct.nome;
    if (description) {
      updateProductSearchStatus(`Produto selecionado: ${description}`, 'success');
    } else {
      updateProductSearchStatus('Produto selecionado com sucesso.', 'success');
    }
  }

  function cancelPendingModalSearch() {
    if (state.productSearchModal.timeout) {
      clearTimeout(state.productSearchModal.timeout);
      state.productSearchModal.timeout = null;
    }
    if (state.productSearchModal.controller) {
      state.productSearchModal.controller.abort();
      state.productSearchModal.controller = null;
    }
  }

  function showProductSearchModalFeedback(message, tone = 'muted', options = {}) {
    const element = elements.productSearchModalFeedback;
    if (!element) return;

    const { allowHtml = false } = options;

    element.classList.remove('hidden', 'text-gray-500', 'text-emerald-600', 'text-red-600', 'text-amber-600');
    element.classList.remove('border-gray-200', 'border-emerald-200', 'border-red-200', 'border-amber-200');

    let textClass = 'text-gray-500';
    let borderClass = 'border-gray-200';
    if (tone === 'success') {
      textClass = 'text-emerald-600';
      borderClass = 'border-emerald-200';
    } else if (tone === 'error') {
      textClass = 'text-red-600';
      borderClass = 'border-red-200';
    } else if (tone === 'warning' || tone === 'info') {
      textClass = 'text-amber-600';
      borderClass = 'border-amber-200';
    }

    element.classList.add(textClass, borderClass);
    if (allowHtml) {
      element.innerHTML = message;
    } else {
      element.textContent = message;
    }
  }

  function hideProductSearchModalFeedback() {
    if (!elements.productSearchModalFeedback) return;
    elements.productSearchModalFeedback.classList.add('hidden');
  }

  function resetProductSearchModal() {
    state.productSearchModal.lastTerm = '';
    productSearchTableState.results = [];
    productSearchTableState.sort = { key: '', direction: 'asc' };
    productSearchOriginalOrder = new WeakMap();
    resetProductSearchFilters();
    updateProductSearchSortButtons();
    renderProductSearchPlaceholderRow('Digite para buscar produtos pelo código ou descrição.');
    showProductSearchModalFeedback('Digite ao menos três caracteres para listar os produtos disponíveis.');
  }

  async function executeProductSearchModal(term) {
    const normalizedTerm = normalizeString(term);
    state.productSearchModal.lastTerm = normalizedTerm;

    if (!normalizedTerm || normalizedTerm.length < 3) {
      if (!normalizedTerm) {
        resetProductSearchModal();
      } else {
        productSearchTableState.results = [];
        productSearchOriginalOrder = new WeakMap();
        renderProductSearchTable();
        showProductSearchModalFeedback(
          'Digite ao menos três caracteres para listar os produtos disponíveis.',
          'warning',
        );
      }
      return;
    }

    cancelPendingModalSearch();

    const controller = new AbortController();
    state.productSearchModal.controller = controller;

    showProductSearchModalFeedback(
      '<div class="flex items-center gap-2"><i class="fas fa-spinner fa-spin"></i> Pesquisando produtos...</div>',
      'info',
      { allowHtml: true },
    );

    try {
      const products = await searchProducts(normalizedTerm, {
        signal: controller.signal,
        includeInactive: state.productSearchModal.includeInactive,
      });
      renderProductSearchModalResults(products);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Erro ao buscar produtos no modal de movimentação de estoque:', error);
      showProductSearchModalFeedback(
        error.message || 'Não foi possível buscar os produtos informados.',
        'error',
      );
    } finally {
      if (state.productSearchModal.controller === controller) {
        state.productSearchModal.controller = null;
      }
    }
  }

  function scheduleProductSearchModal(term) {
    cancelPendingModalSearch();
    const normalizedTerm = normalizeString(term);
    state.productSearchModal.timeout = setTimeout(() => {
      state.productSearchModal.timeout = null;
      executeProductSearchModal(normalizedTerm);
    }, 300);
  }

  function openProductSearchModal(initialTerm = '') {
    const modal = elements.productSearchModal;
    if (!modal) return;

    cancelPendingModalSearch();
    state.productSearchModal.includeInactive = false;
    if (elements.productSearchModalShowInactive) {
      elements.productSearchModalShowInactive.checked = false;
    }
    resetProductSearchModal();
    setupProductSearchTableControls();

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    state.productSearchModal.isOpen = true;

    const normalizedInitial = normalizeString(initialTerm);
    if (elements.productSearchModalInput) {
      elements.productSearchModalInput.value = normalizedInitial;
      window.setTimeout(() => {
        elements.productSearchModalInput?.focus();
        if (elements.productSearchModalInput) {
          const cursor = elements.productSearchModalInput.value.length;
          elements.productSearchModalInput.setSelectionRange(cursor, cursor);
        }
      }, 50);
    }

    if (normalizedInitial && normalizedInitial.length >= 3) {
      executeProductSearchModal(normalizedInitial);
    } else if (normalizedInitial) {
      showProductSearchModalFeedback(
        'Digite ao menos três caracteres para listar os produtos disponíveis.',
        'warning',
      );
    }
  }

  function closeProductSearchModal(options = {}) {
    const { restoreFocus = true } = options;
    const modal = elements.productSearchModal;
    if (!modal) return;

    cancelPendingModalSearch();
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    state.productSearchModal.isOpen = false;
    state.productSearchModal.lastTerm = '';
    state.productSearchModal.includeInactive = false;

    if (elements.productSearchModalInput) {
      elements.productSearchModalInput.value = '';
    }
    if (elements.productSearchModalShowInactive) {
      elements.productSearchModalShowInactive.checked = false;
    }
    resetProductSearchModal();

    if (restoreFocus && elements.productSearchInput) {
      elements.productSearchInput.focus();
    }
  }

  async function handleDirectCodeLookup(term) {
    const normalizedTerm = normalizeString(term);
    if (!normalizedTerm) {
      updateProductSearchStatus('Informe um código válido para buscar o produto.', 'warning');
      return;
    }

    try {
      const product = await resolveProductByTerm(normalizedTerm, { codeTerm: normalizedTerm });
      setPendingProduct(product, { preserveInput: true });
      elements.productQuantityInput?.focus();
    } catch (error) {
      console.error('Erro ao localizar produto pelo código informado:', error);
      clearPendingProduct();
      updateProductSearchStatus(error.message || 'Produto não encontrado com o código informado.', 'error');
    }
  }

  function handleProductResultSelection(target) {
    if (!target) return;

    const row = target.closest('[data-product-selectable="true"]');
    if (!row) {
      showProductSearchModalFeedback('Não foi possível identificar o produto selecionado.', 'error');
      return;
    }

    const productId = normalizeString(row.dataset.productId);
    if (!productId) {
      showProductSearchModalFeedback('Não foi possível identificar o produto selecionado.', 'error');
      return;
    }

    const product = {
      _id: productId,
      cod: normalizeString(row.dataset.sku),
      codbarras: normalizeString(row.dataset.barcode),
      nome: normalizeString(row.dataset.name),
    };

    setPendingProduct(product);
    closeProductSearchModal();

    if (elements.productSearchInput) {
      const preferredCode = product.cod || product.codbarras;
      if (preferredCode) {
        elements.productSearchInput.value = preferredCode;
      } else if (!elements.productSearchInput.value) {
        elements.productSearchInput.value = productId;
      }
      elements.productSearchInput.focus();
    }
  }

  function handleProductSearchFieldKeydown(event) {
    if (!event || !elements.productSearchInput) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      const term = normalizeString(event.target.value);
      if (!term) {
        updateProductSearchStatus('Informe um código válido para buscar o produto.', 'warning');
        return;
      }
      if (LETTER_INPUT_PATTERN.test(term)) {
        openProductSearchModal(term);
        return;
      }
      handleDirectCodeLookup(term);
      return;
    }

    if (event.key.length === 1 && LETTER_INPUT_PATTERN.test(event.key)) {
      event.preventDefault();
      const currentValue = typeof event.target.value === 'string' ? event.target.value : '';
      const initialTerm = `${currentValue}${event.key}`.trim();
      openProductSearchModal(initialTerm);
    }
  }

  function handleProductSearchFieldInput(event) {
    if (!event || !elements.productSearchInput) return;

    const currentValue = typeof event.target.value === 'string' ? event.target.value : '';
    if (!currentValue) {
      clearPendingProduct({ resetStatus: true });
      return;
    }

    if (state.pendingProduct && state.pendingProduct._id) {
      clearPendingProduct();
    }

    if (LETTER_INPUT_PATTERN.test(currentValue)) {
      if (state.productSearchModal.isOpen) {
        return;
      }

      const originalValue = currentValue;
      const sanitizedValue = originalValue.replace(LETTER_GLOBAL_PATTERN, '').trim();
      if (sanitizedValue !== originalValue) {
        event.target.value = sanitizedValue;
      }

      window.setTimeout(() => {
        openProductSearchModal(originalValue);
      }, 0);
      return;
    }

    updateProductSearchStatus('Pressione Enter para buscar pelo código informado.', 'muted');
  }

  function renderItems() {
    if (!elements.itemsBody) return;

    elements.itemsBody.querySelectorAll('tr[data-item-id]').forEach((row) => row.remove());

    if (state.items.length === 0) {
      if (elements.emptyStateRow) {
        elements.emptyStateRow.classList.remove('hidden');
      }
    } else if (elements.emptyStateRow) {
      elements.emptyStateRow.classList.add('hidden');
    }

    const factor = state.operation === 'saida' ? -1 : 1;

    state.items.forEach((item) => {
      const row = document.createElement('tr');
      row.dataset.itemId = String(item.id);
      row.className = 'text-sm text-gray-700';
      const signedQuantity = item.quantity * factor;
      const formattedQuantity = `${signedQuantity < 0 ? '-' : ''}${formatQuantity(signedQuantity)}`;
      const formattedUnitValue = item.hasUnitValue ? formatCurrency(item.unitValue) : '—';
      const formattedTotalValue = item.hasUnitValue
        ? formatCurrency(item.quantity * item.unitValue * factor)
        : '—';

      row.innerHTML = `
        <td class="px-4 py-3 font-medium text-gray-800">${escapeHtml(item.name)}</td>
        <td class="px-4 py-3 text-gray-600">${item.displayCode ? escapeHtml(item.displayCode) : '—'}</td>
        <td class="px-4 py-3 text-right font-semibold text-gray-900">${formattedQuantity}</td>
        <td class="px-4 py-3 text-right text-gray-700">${formattedUnitValue}</td>
        <td class="px-4 py-3 text-right text-gray-700">${formattedTotalValue}</td>
        <td class="px-4 py-3 text-gray-600">${item.notes ? escapeHtml(item.notes) : '—'}</td>
        <td class="px-4 py-3 text-right">
          <button type="button" class="inline-flex items-center gap-1 rounded-md border border-transparent bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100" data-action="remove-item" data-item-id="${item.id}">
            <i class="fas fa-trash"></i>
            Remover
          </button>
        </td>
      `;

      elements.itemsBody.appendChild(row);
    });

    updateSummary();
  }

  function updateSummary() {
    const totalItems = state.items.length;
    const factor = state.operation === 'saida' ? -1 : 1;
    const quantity = state.items.reduce((sum, item) => sum + item.quantity, 0) * factor;
    const rawValue = state.items.reduce((sum, item) => {
      if (!item.hasUnitValue) return sum;
      return sum + item.quantity * item.unitValue;
    }, 0);
    const value = rawValue * factor;

    if (elements.totalItems) {
      elements.totalItems.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'itens'}`;
    }

    if (elements.totalQuantity) {
      const formattedQuantity = `${quantity < 0 ? '-' : ''}${formatQuantity(quantity)}`;
      elements.totalQuantity.textContent = formattedQuantity;
    }

    if (elements.totalValue) {
      elements.totalValue.textContent = formatCurrency(value);
    }
  }

  function resetItemInputs() {
    if (elements.productSearchInput) elements.productSearchInput.value = '';
    clearPendingProduct({ resetStatus: true });
    if (elements.productQuantityInput) elements.productQuantityInput.value = '';
    if (elements.productCostInput) elements.productCostInput.value = '';
    if (elements.productNotesInput) elements.productNotesInput.value = '';
  }

  function setDefaultDate() {
    if (!elements.dateInput) return;
    if (elements.dateInput.value) return;
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    elements.dateInput.value = `${year}-${month}-${day}`;
  }

  async function handleAddItem() {
    hideFeedback();

    if (state.isSubmitting) {
      return;
    }

    const companyId = elements.companySelect?.value;
    if (!companyId) {
      showFeedback('Selecione a empresa antes de adicionar itens.', 'error');
      elements.companySelect?.focus();
      return;
    }

    const depositId = elements.depositSelect?.value;
    if (!depositId) {
      showFeedback('Selecione o depósito antes de adicionar itens.', 'error');
      elements.depositSelect?.focus();
      return;
    }

    const searchTerm = normalizeString(elements.productSearchInput?.value);
    const pendingProduct = state.pendingProduct && state.pendingProduct._id ? state.pendingProduct : null;

    if (!searchTerm && !pendingProduct) {
      showFeedback('Informe o produto para adicionar um item.', 'error');
      elements.productSearchInput?.focus();
      return;
    }

    const quantityRaw = elements.productQuantityInput?.value;
    const quantity = parseDecimal(quantityRaw);
    if (!quantity || quantity <= 0) {
      showFeedback('A quantidade deve ser maior que zero.', 'error');
      elements.productQuantityInput?.focus();
      return;
    }

    try {
      let product = pendingProduct;
      if (!product) {
        const codeTerm = searchTerm && !LETTER_INPUT_PATTERN.test(searchTerm) ? searchTerm : undefined;
        product = await resolveProductByTerm(searchTerm, { codeTerm });
      }

      const productId = product?._id ? String(product._id) : '';
      if (!productId) {
        throw new Error('Não foi possível identificar o produto selecionado.');
      }

      const details = await fetchProductDetails(productId);
      const detailProduct = details?.product || {};
      const stocks = Array.isArray(details?.stocks) ? details.stocks : [];

      const sku = normalizeString(product?.cod || detailProduct?.cod);
      const barcode = normalizeString(product?.codbarras || detailProduct?.codbarras);
      const name = normalizeString(product?.nome || detailProduct?.nome);

      if (!name) {
        throw new Error('Produto selecionado está sem nome cadastrado.');
      }

      if (state.operation === 'saida') {
        const depositStock = stocks.find((entry) => entry?.depositId === String(depositId));
        const available = Number(depositStock?.quantity) || 0;
        const tolerance = 0.000001;
        if (quantity - available > tolerance) {
          showFeedback(
            `Estoque insuficiente no depósito selecionado. Disponível: ${formatQuantity(available)}.`,
            'error',
          );
          return;
        }
      }

      const unitValueParsed = parseDecimal(elements.productCostInput?.value);
      const hasUnitValueInput = unitValueParsed !== null && Number.isFinite(unitValueParsed);
      const fallbackUnitValue = Number.isFinite(detailProduct?.custo)
        ? Math.round(Number(detailProduct.custo) * 100) / 100
        : null;
      const resolvedUnitValue = hasUnitValueInput
        ? Math.round(unitValueParsed * 100) / 100
        : fallbackUnitValue;
      const hasUnitValue = Number.isFinite(resolvedUnitValue);
      const unitValue = hasUnitValue ? resolvedUnitValue : 0;

      const displayCodeParts = [];
      if (sku) displayCodeParts.push(sku);
      if (barcode) displayCodeParts.push(barcode);

      const item = {
        id: Date.now() + Math.random(),
        productId,
        sku,
        barcode,
        displayCode: displayCodeParts.join(' • ') || '—',
        name,
        quantity,
        unitValue,
        hasUnitValue,
        notes: normalizeString(elements.productNotesInput?.value),
      };

      state.items.push(item);
      resetItemInputs();
      renderItems();
      showFeedback('Item adicionado à movimentação.', 'success');
    } catch (error) {
      console.error('Erro ao adicionar item à movimentação de estoque:', error);
      showFeedback(error.message || 'Não foi possível adicionar o item informado.', 'error');
    }
  }

  function handleRemoveItem(id) {
    const index = state.items.findIndex((item) => String(item.id) === String(id));
    if (index === -1) return;
    state.items.splice(index, 1);
    renderItems();
  }

  function clearForm() {
    form.reset();
    state.items = [];
    state.operation = 'saida';
    state.productSearchCache.clear();
    state.productDetailsCache.clear();
    state.productSearchModal.includeInactive = false;
    state.selectedResponsibleId = '';
    if (elements.responsibleHidden) {
      elements.responsibleHidden.value = '';
    }
    if (elements.responsibleInput) {
      elements.responsibleInput.value = '';
    }
    if (elements.companySelect) {
      elements.companySelect.value = '';
    }
    populateDepositSelect(elements.companySelect?.value || '');
    elements.operationRadios.forEach((radio) => {
      radio.checked = radio.value === 'saida';
    });
    clearPendingProduct({ resetStatus: true });
    if (elements.productSearchInput) {
      elements.productSearchInput.value = '';
    }
    if (elements.productSearchModalShowInactive) {
      elements.productSearchModalShowInactive.checked = false;
    }
    setDefaultDate();
    hideFeedback();
    updateOperationUI();
    renderItems();
  }

  function validateBeforeSubmit() {
    if (!state.items.length) {
      showFeedback('Adicione ao menos um item para registrar a movimentação de estoque.', 'error');
      return false;
    }

    if (!elements.companySelect?.value || !elements.depositSelect?.value) {
      showFeedback('Selecione a empresa e o depósito para registrar a movimentação.', 'error');
      return false;
    }

    if (!elements.dateInput?.value) {
      showFeedback('Informe a data da movimentação de estoque.', 'error');
      elements.dateInput?.focus();
      return false;
    }

    if (!elements.reasonSelect?.value) {
      showFeedback('Informe o motivo da movimentação de estoque.', 'error');
      elements.reasonSelect?.focus();
      return false;
    }

    if (!state.selectedResponsibleId) {
      showFeedback('Selecione um responsável válido para a movimentação.', 'error');
      elements.responsibleInput?.focus();
      return false;
    }

    hideFeedback();
    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    hideFeedback();

    if (state.isSubmitting) {
      return;
    }

    if (!validateBeforeSubmit()) {
      return;
    }

    const token = getToken();
    if (!token) {
      showFeedback('Sessão expirada. Faça login novamente.', 'error');
      return;
    }

    const payload = {
      operation: state.operation,
      reason: elements.reasonSelect?.value,
      company: elements.companySelect?.value,
      deposit: elements.depositSelect?.value,
      movementDate: elements.dateInput?.value,
      referenceDocument: normalizeString(elements.referenceInput?.value),
      notes: normalizeString(elements.notesInput?.value),
      responsible: state.selectedResponsibleId,
      items: state.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitValue: item.hasUnitValue ? Math.round(Number(item.unitValue) * 100) / 100 : null,
        notes: normalizeString(item.notes),
      })),
    };

    state.isSubmitting = true;
    if (elements.submitButton) {
      elements.submitButton.disabled = true;
      elements.submitButton.classList.add('opacity-60', 'pointer-events-none');
      elements.submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    }

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/inventory-adjustments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.message || 'Não foi possível registrar a movimentação de estoque.';
        throw new Error(message);
      }

      showFeedback(data?.message || 'Movimentação de estoque registrada com sucesso.', 'success');
      clearForm();
    } catch (error) {
      console.error('Erro ao salvar movimentação de estoque manual:', error);
      showFeedback(error.message || 'Não foi possível registrar a movimentação de estoque.', 'error');
    } finally {
      state.isSubmitting = false;
      if (elements.submitButton) {
        elements.submitButton.disabled = false;
        elements.submitButton.classList.remove('opacity-60', 'pointer-events-none');
        const config = OPERATION_CONFIG[state.operation];
        const submitText = config ? config.submitText : 'Salvar movimentação';
        elements.submitButton.innerHTML = `<i class="fas fa-save"></i> ${submitText}`;
      }
    }
  }

  elements.operationRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      state.operation = event.target.value === 'entrada' ? 'entrada' : 'saida';
      hideFeedback();
      updateOperationUI();
    });
  });

  if (elements.companySelect) {
    elements.companySelect.addEventListener('change', (event) => {
      populateDepositSelect(event.target.value);
    });
  }

  if (elements.responsibleInput) {
    elements.responsibleInput.addEventListener('input', handleResponsibleInputChange);
    elements.responsibleInput.addEventListener('change', handleResponsibleInputChange);
    elements.responsibleInput.addEventListener('blur', handleResponsibleBlur);
  }

  if (elements.productSearchInput) {
    elements.productSearchInput.addEventListener('keydown', handleProductSearchFieldKeydown);
    elements.productSearchInput.addEventListener('input', handleProductSearchFieldInput);
    elements.productSearchInput.addEventListener('focus', () => {
      if (!elements.productSearchInput.value) {
        updateProductSearchStatus(DEFAULT_PRODUCT_SEARCH_STATUS, 'muted');
      }
    });
  }

  if (elements.productSearchButton) {
    elements.productSearchButton.addEventListener('click', () => {
      const currentTerm = normalizeString(elements.productSearchInput?.value);
      openProductSearchModal(currentTerm);
    });
  }

  if (elements.productSearchModalInput) {
    elements.productSearchModalInput.addEventListener('input', (event) => {
      scheduleProductSearchModal(event.target.value);
    });
    elements.productSearchModalInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        executeProductSearchModal(event.target.value);
      }
    });
  }

  if (elements.productSearchModalShowInactive) {
    elements.productSearchModalShowInactive.addEventListener('change', (event) => {
      const includeInactive = Boolean(event.target.checked);
      state.productSearchModal.includeInactive = includeInactive;
      cancelPendingModalSearch();
      if (state.productSearchModal.lastTerm && state.productSearchModal.lastTerm.length >= 3) {
        executeProductSearchModal(state.productSearchModal.lastTerm);
      } else {
        renderProductSearchTable();
      }
    });
  }

  elements.productSearchModalClose?.addEventListener('click', () => closeProductSearchModal());
  elements.productSearchModalCancel?.addEventListener('click', () => closeProductSearchModal());

  if (elements.productSearchModal) {
    elements.productSearchModal.addEventListener('click', (event) => {
      if (event.target === elements.productSearchModal) {
        closeProductSearchModal();
      }
    });
  }

  if (elements.productSearchModalResults) {
    elements.productSearchModalResults.addEventListener('click', (event) => {
      const row = event.target.closest('[data-product-selectable="true"]');
      if (!row) return;
      event.preventDefault();
      handleProductResultSelection(row);
    });

    elements.productSearchModalResults.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const row = event.target.closest('[data-product-selectable="true"]');
      if (!row) {
        return;
      }
      event.preventDefault();
      handleProductResultSelection(row);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.productSearchModal.isOpen) {
      event.preventDefault();
      closeProductSearchModal();
    }
  });

  if (elements.addItemButton) {
    elements.addItemButton.addEventListener('click', () => {
      handleAddItem();
    });
  }

  if (elements.itemsBody) {
    elements.itemsBody.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="remove-item"]');
      if (!button) return;
      const { itemId } = button.dataset;
      handleRemoveItem(itemId);
    });
  }

  if (elements.clearButton) {
    elements.clearButton.addEventListener('click', () => {
      clearForm();
    });
  }

  form.addEventListener('submit', handleSubmit);

  loadFormData();
  setDefaultDate();
  updateOperationUI();
  renderItems();
  updateProductSearchStatus(DEFAULT_PRODUCT_SEARCH_STATUS, 'muted');
})();
