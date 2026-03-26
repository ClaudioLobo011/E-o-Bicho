// scripts/admin/admin-compras-relacao-alterar-produtos.js
(function () {
  const state = {
    filters: {},
    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
    products: [],
    selected: new Set(),
    selectingAllMatches: false,
    categories: [],
    suppliers: [],
    stores: [],
    fiscalRulesByStore: new Map(),
    fiscalRuleLabelsByStore: new Map(),
    loading: false,
    exporting: false,
    tableFilters: {
      sku: '',
      barcode: '',
      nome: '',
      marca: '',
      apresentacao: '',
      peso: '',
      iat: '',
      tipoProduto: '',
      categorias: '',
      idade: '',
      especie: '',
      porte: '',
      castrado: '',
      unidade: '',
      imagem: '',
      custo: '',
      markup: '',
      venda: '',
      stock: '',
      fornecedor: '',
      situacao: '',
    },
    tableSort: { key: '', direction: 'asc' },
    visibleColumns: new Set(),
  };

  const elements = {};
  const tableFilterInputs = new Map();
  const tableSortButtons = new Map();
  const tableSortHeaders = new Map();
  let tableFilterFetchTimeout = null;

  const TABLE_FILTER_QUERY_KEYS = {
    sku: 'col_sku',
    barcode: 'col_barcode',
    nome: 'col_nome',
    marca: 'col_marca',
    apresentacao: 'col_apresentacao',
    peso: 'col_peso',
    iat: 'col_iat',
    tipoProduto: 'col_tipo_produto',
    categorias: 'col_categorias',
    idade: 'col_idade',
    especie: 'col_especie',
    porte: 'col_porte',
    castrado: 'col_castrado',
    unidade: 'col_unidade',
    imagem: 'col_imagem',
    custo: 'col_custo',
    markup: 'col_markup',
    venda: 'col_venda',
    stock: 'col_stock',
    fornecedor: 'col_fornecedor',
    situacao: 'col_situacao',
  };

  const BASE_TABLE_COLUMNS = ['sku', 'barcode', 'nome', 'fornecedor', 'situacao'];
  const PRICE_TABLE_COLUMNS = ['custo', 'markup', 'venda', 'promocao'];
  const SETTINGS_TABLE_COLUMNS = ['marca', 'apresentacao'];
  const GENERAL_INFO_TABLE_COLUMNS = ['peso', 'iat', 'tipoProduto', 'stock'];
  const CLASSIFICATION_TABLE_COLUMNS = ['categorias', 'idade', 'especie', 'porte', 'castrado'];

  function initElements() {
    elements.filtersForm = document.getElementById('filters-form');
    elements.clearFiltersButton = document.getElementById('clear-filters');
    elements.appliedFilters = document.getElementById('applied-filters');
    elements.productsTableBody = document.getElementById('products-table-body');
    elements.resultsSummary = document.getElementById('results-summary');
    elements.resultsSelectedCounter = document.getElementById('results-selected-counter');
    elements.paginationControls = document.getElementById('pagination-controls');
    elements.pageSizeSelect = document.getElementById('page-size-select');
    elements.selectAllCheckbox = document.getElementById('select-all-checkbox');
    elements.selectAllCurrentButton = document.getElementById('select-all-current');
    elements.selectedSummary = document.getElementById('selected-summary');
    elements.confirmBulkUpdateButton = document.getElementById('confirm-bulk-update');
    elements.applyMassFromHeaderButton = document.getElementById('apply-mass-from-header');
    elements.exportExcelButton = document.getElementById('export-excel');
    elements.bulkForm = document.getElementById('bulk-form');
    elements.bulkFields = Array.from(elements.bulkForm?.querySelectorAll('[data-bulk-field]') || []);
    elements.filterCategoriaSelect = document.getElementById('filter-categoria');
    elements.filterFornecedorSelect = document.getElementById('filter-fornecedor');
    elements.bulkCategoriasSelect = elements.bulkForm?.querySelector('[data-bulk-field="categorias"] select[multiple]');
    elements.bulkFiscalStoreSelect = document.getElementById('bulk-fiscal-store');
    elements.bulkFiscalRuleSelect = document.getElementById('bulk-fiscal-rule');
    elements.bulkPricesDetails = document.getElementById('bulk-section-prices');
    elements.bulkSettingsDetails = document.getElementById('bulk-section-settings');
    elements.bulkGeneralInfoDetails = document.getElementById('bulk-section-general-info');
    elements.bulkClassificationDetails = document.getElementById('bulk-section-classification');
    elements.bulkFiscalDetails = document.getElementById('bulk-section-fiscal');
    elements.productsTableHeadRow = document.querySelector('thead tr.align-top');
  }

  function getToken() {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return loggedInUser?.token || null;
    } catch (error) {
      console.warn('Não foi possível ler o token salvo.', error);
      return null;
    }
  }

  function buildAuthHeaders() {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function fetchWithAuth(url, options = {}) {
    const config = {
      ...options,
      headers: {
        ...buildAuthHeaders(),
        ...(options.headers || {}),
      },
    };

    const response = await fetch(url, config);
    if (response.status === 401) {
      alert('Sua sessão expirou. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return null;
    }
    return response;
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(number);
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return new Intl.NumberFormat('pt-BR').format(number);
  }

  function formatPercentage(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0%';
    return `${new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number)}%`;
  }

  function normalizeText(value) {
    if (value === null || value === undefined) return '';
    try {
      return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[ç]/gi, 'c')
        .toLowerCase();
    } catch (error) {
      return String(value)
        .toLowerCase()
        .replace(/[ç]/g, 'c');
    }
  }

  function getFilterCandidates(product = {}, key) {
    if (isFiscalStoreColumnKey(key)) {
      return [getFiscalRuleLabelForProductStore(product, getStoreIdFromFiscalColumnKey(key)) || ''];
    }
    switch (key) {
      case 'sku':
        return [product.cod || ''];
      case 'barcode':
        return [product.codbarras || product.barcode || ''];
      case 'nome':
        return [product.nome || ''];
      case 'marca':
        return [product.marca || ''];
      case 'apresentacao':
        return [product.apresentacao || ''];
      case 'peso':
        return [product.peso === null || product.peso === undefined ? '' : String(product.peso)];
      case 'iat':
        return [product.iat || ''];
      case 'tipoProduto':
        return [product.tipoProduto || ''];
      case 'categorias':
        return [product.categorias || ''];
      case 'idade':
        return [product.idade || ''];
      case 'especie':
        return [product.especie || ''];
      case 'porte':
        return [product.porte || ''];
      case 'castrado':
        return [product.castrado || ''];
      case 'unidade':
        return [product.unidade || ''];
      case 'imagem':
        return [product.temImagem ? 'Sim' : 'Não'];
      case 'custo': {
        const value = Number(product.custo);
        if (Number.isFinite(value)) {
          return [String(value), formatCurrency(value)];
        }
        if (product.custo !== undefined && product.custo !== null && product.custo !== '') {
          return [String(product.custo)];
        }
        return [''];
      }
      case 'markup': {
        const original = product.markup;
        if (original === null || original === undefined || original === '') {
          return [''];
        }
        const value = Number(original);
        if (!Number.isFinite(value)) {
          return [String(original)];
        }
        return [String(value), formatPercentage(value)];
      }
      case 'venda': {
        const value = Number(product.venda);
        if (Number.isFinite(value)) {
          return [String(value), formatCurrency(value)];
        }
        if (product.venda !== undefined && product.venda !== null && product.venda !== '') {
          return [String(product.venda)];
        }
        return [''];
      }
      case 'stock': {
        const value = Number(product.stock);
        if (Number.isFinite(value)) {
          return [String(value), formatNumber(value)];
        }
        if (product.stock !== undefined && product.stock !== null && product.stock !== '') {
          return [String(product.stock)];
        }
        return [''];
      }
      case 'fornecedor':
        return [product.fornecedor || ''];
      case 'situacao':
        return [product.inativo ? 'Inativo' : 'Ativo'];
      default:
        return [product[key] || ''];
    }
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildColumnFilterRegex(rawValue) {
    const normalizedFilter = normalizeText(rawValue || '');
    if (!normalizedFilter) {
      return null;
    }

    const pattern = normalizedFilter
      .split('*')
      .map((segment) => escapeRegex(segment))
      .join('.*');

    if (!pattern) {
      return null;
    }

    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      console.warn('Filtro inválido ignorado na tabela de produtos.', error);
      return null;
    }
  }

  function matchesColumnFilter(product, key, filterValue) {
    if (!key) return true;

    const regex = buildColumnFilterRegex(filterValue);
    if (!regex) return true;

    const candidates = getFilterCandidates(product, key);
    return candidates.some((candidate) => regex.test(normalizeText(candidate)));
  }

  function applyColumnFilters(products) {
    const list = Array.isArray(products) ? products : [];
    const filters = state.tableFilters || {};
    const activeFilters = Object.entries(filters).filter(([, value]) => typeof value === 'string' && value.trim() !== '');
    if (!activeFilters.length) {
      return list.slice();
    }
    return list.filter((product) =>
      activeFilters.every(([key, value]) => matchesColumnFilter(product, key, value)),
    );
  }

  function getSortValue(product, key) {
    if (isFiscalStoreColumnKey(key)) {
      return getFiscalRuleLabelForProductStore(product, getStoreIdFromFiscalColumnKey(key)) || '';
    }
    switch (key) {
      case 'sku':
        return product.cod || '';
      case 'barcode':
        return product.codbarras || product.barcode || '';
      case 'nome':
        return product.nome || '';
      case 'marca':
        return product.marca || '';
      case 'apresentacao':
        return product.apresentacao || '';
      case 'peso':
        return Number(product.peso);
      case 'iat':
        return product.iat || '';
      case 'tipoProduto':
        return product.tipoProduto || '';
      case 'categorias':
        return product.categorias || '';
      case 'idade':
        return product.idade || '';
      case 'especie':
        return product.especie || '';
      case 'porte':
        return product.porte || '';
      case 'castrado':
        return product.castrado || '';
      case 'unidade':
        return product.unidade || '';
      case 'imagem':
        return product.temImagem ? 'Sim' : 'Não';
      case 'custo':
        return Number(product.custo);
      case 'markup':
        return product.markup === null || product.markup === undefined ? null : Number(product.markup);
      case 'venda':
        return Number(product.venda);
      case 'stock':
        return Number(product.stock);
      case 'fornecedor':
        return product.fornecedor || '';
      case 'situacao':
        return product.inativo ? 'Inativo' : 'Ativo';
      default:
        return product[key];
    }
  }

  function applyColumnSort(products) {
    const list = Array.isArray(products) ? products.slice() : [];
    const sort = state.tableSort || {};
    const sortKey = sort.key || '';
    if (!sortKey) {
      return list;
    }
    const direction = sort.direction === 'desc' ? 'desc' : 'asc';
    const multiplier = direction === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const valueA = getSortValue(a, sortKey);
      const valueB = getSortValue(b, sortKey);

      const numericA = typeof valueA === 'number' ? valueA : Number.NaN;
      const numericB = typeof valueB === 'number' ? valueB : Number.NaN;
      const isNumericA = Number.isFinite(numericA);
      const isNumericB = Number.isFinite(numericB);

      if (isNumericA || isNumericB) {
        const safeA = isNumericA ? numericA : Number.NEGATIVE_INFINITY;
        const safeB = isNumericB ? numericB : Number.NEGATIVE_INFINITY;
        if (safeA === safeB) {
          const indexA = Number.isFinite(a?.__position) ? a.__position : 0;
          const indexB = Number.isFinite(b?.__position) ? b.__position : 0;
          return indexA - indexB;
        }
        return safeA > safeB ? multiplier : -multiplier;
      }

      const textA = normalizeText(valueA);
      const textB = normalizeText(valueB);
      const comparison = textA.localeCompare(textB, 'pt-BR', {
        sensitivity: 'base',
        numeric: true,
      });
      if (comparison === 0) {
        const indexA = Number.isFinite(a?.__position) ? a.__position : 0;
        const indexB = Number.isFinite(b?.__position) ? b.__position : 0;
        return indexA - indexB;
      }
      return comparison * multiplier;
    });
  }

  function getVisibleProducts() {
    const filtered = applyColumnFilters(state.products);
    return applyColumnSort(filtered);
  }

  function setTableFilter(key, value) {
    if (!key) return;
    const current = state.tableFilters[key] || '';
    const nextValue = typeof value === 'string' ? value : '';
    if (current === nextValue) {
      return;
    }
    state.tableFilters[key] = nextValue;
    state.pagination.page = 1;
    if (tableFilterFetchTimeout) {
      clearTimeout(tableFilterFetchTimeout);
    }
    tableFilterFetchTimeout = setTimeout(() => {
      fetchProducts(1);
    }, 300);
  }

  function setTableSort(key, direction) {
    if (!key) return;
    const nextDirection = direction === 'desc' ? 'desc' : 'asc';
    const { key: currentKey, direction: currentDirection } = state.tableSort || {};
    if (currentKey === key && currentDirection === nextDirection) {
      state.tableSort = { key: '', direction: 'asc' };
    } else {
      state.tableSort = { key, direction: nextDirection };
    }
    state.pagination.page = 1;
    renderProductsTable();
    fetchProducts(1);
  }

  function updateTableSortButtons() {
    const { key: activeKey, direction: activeDirectionRaw } = state.tableSort || {};
    const activeDirection = activeDirectionRaw === 'desc' ? 'desc' : 'asc';

    tableSortHeaders.forEach((header, headerKey) => {
      if (!header) return;
      if (activeKey && headerKey === activeKey) {
        header.setAttribute('aria-sort', activeDirection === 'desc' ? 'descending' : 'ascending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });

    tableSortButtons.forEach((meta, button) => {
      if (!button) return;
      const isActive = Boolean(activeKey) && meta.key === activeKey && meta.direction === activeDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/60', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function getFiscalStoreColumnKey(storeId) {
    const normalized = String(storeId || '').trim();
    return normalized ? ('fiscal_store_' + normalized) : '';
  }

  function getFiscalStoreColumnKeys() {
    return (Array.isArray(state.stores) ? state.stores : [])
      .map((store) => getFiscalStoreColumnKey(store.id))
      .filter(Boolean);
  }

  function isFiscalStoreColumnKey(key) {
    return typeof key === 'string' && key.startsWith('fiscal_store_');
  }

  function getStoreIdFromFiscalColumnKey(key) {
    if (!isFiscalStoreColumnKey(key)) return '';
    return String(key).replace(/^fiscal_store_/, '').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toFiscalString(value, fallback = '') {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return fallback;
  }

  function toFiscalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeFiscalTaxForMatch(tax = {}) {
    return {
      codigo: toFiscalString(tax?.codigo),
      cst: toFiscalString(tax?.cst),
      aliquota: toFiscalNumber(tax?.aliquota),
      tipoCalculo: toFiscalString(tax?.tipoCalculo, 'percentual') || 'percentual',
      valorBase: toFiscalNumber(tax?.valorBase),
    };
  }

  function normalizeFiscalCfopForMatch(cfop = {}) {
    return {
      entrada: toFiscalString(cfop?.entrada || cfop?.entradaEstado || cfop?.cfopEntrada),
      dentroEstado: toFiscalString(cfop?.dentroEstado || cfop?.dentro),
      foraEstado: toFiscalString(cfop?.foraEstado || cfop?.fora),
      transferencia: toFiscalString(cfop?.transferencia),
      devolucao: toFiscalString(cfop?.devolucao),
      industrializacao: toFiscalString(cfop?.industrializacao),
    };
  }

  function normalizeFiscalIpiForMatch(ipi = {}) {
    return {
      cst: toFiscalString(ipi?.cst),
      codigoEnquadramento: toFiscalString(ipi?.codigoEnquadramento),
      aliquota: toFiscalNumber(ipi?.aliquota),
      tipoCalculo: toFiscalString(ipi?.tipoCalculo, 'percentual') || 'percentual',
      valorBase: toFiscalNumber(ipi?.valorBase),
    };
  }

  function normalizeFiscalFcpForMatch(fcp = {}) {
    return {
      indicador: toFiscalString(fcp?.indicador, '0') || '0',
      aliquota: toFiscalNumber(fcp?.aliquota),
      aplica: Boolean(fcp?.aplica),
    };
  }

  function normalizeFiscalStatusForMatch(status = {}) {
    const allowed = new Set(['pendente', 'parcial', 'aprovado']);
    const nfe = toFiscalString(status?.nfe).toLowerCase();
    const nfce = toFiscalString(status?.nfce).toLowerCase();
    return {
      nfe: allowed.has(nfe) ? nfe : 'pendente',
      nfce: allowed.has(nfce) ? nfce : 'pendente',
    };
  }

  function sanitizeFiscalForMatch(fiscalValue) {
    const fiscal = fiscalValue && typeof fiscalValue === 'object' ? fiscalValue : {};
    return {
      origem: toFiscalString(fiscal?.origem, '0') || '0',
      cest: toFiscalString(fiscal?.cest),
      csosn: toFiscalString(fiscal?.csosn),
      cst: toFiscalString(fiscal?.cst),
      cfop: {
        nfe: normalizeFiscalCfopForMatch(fiscal?.cfop?.nfe || {}),
        nfce: normalizeFiscalCfopForMatch(fiscal?.cfop?.nfce || {}),
      },
      pis: normalizeFiscalTaxForMatch(fiscal?.pis || {}),
      cofins: normalizeFiscalTaxForMatch(fiscal?.cofins || {}),
      ipi: normalizeFiscalIpiForMatch(fiscal?.ipi || {}),
      fcp: normalizeFiscalFcpForMatch(fiscal?.fcp || {}),
      status: normalizeFiscalStatusForMatch(fiscal?.status || {}),
    };
  }

  function stableStringify(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
      return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function rebuildFiscalRuleLabelsForStore(storeId) {
    const normalizedStoreId = String(storeId || '').trim();
    if (!normalizedStoreId) return;
    const rules = state.fiscalRulesByStore.get(normalizedStoreId) || [];
    const lookup = new Map();
    rules.forEach((rule) => {
      const code = Number(rule?.code);
      const name = String(rule?.name || '').trim();
      const label = Number.isFinite(code) && code > 0
        ? (String(code) + ' - ' + (name || 'Regra sem nome'))
        : (name || 'Regra sem nome');
      const signature = stableStringify(sanitizeFiscalForMatch(rule?.fiscal || {}));
      lookup.set(signature, label);
    });
    state.fiscalRuleLabelsByStore.set(normalizedStoreId, lookup);
  }

  function getFiscalRuleLabelForProductStore(product, storeId) {
    const normalizedStoreId = String(storeId || '').trim();
    if (!normalizedStoreId) return '-';

    const labelsByStore = product?.fiscalRegraPorEmpresa && typeof product.fiscalRegraPorEmpresa === 'object'
      ? product.fiscalRegraPorEmpresa
      : {};
    const resolvedLabel = String(labelsByStore[normalizedStoreId] || '').trim();
    if (resolvedLabel) return resolvedLabel;

    const fiscalByStore = product?.fiscalPorEmpresa && typeof product.fiscalPorEmpresa === 'object'
      ? product.fiscalPorEmpresa
      : {};
    const fiscalValue = fiscalByStore[normalizedStoreId];
    if (!fiscalValue || typeof fiscalValue !== 'object') return '-';

    const signature = stableStringify(sanitizeFiscalForMatch(fiscalValue));
    const storeLookup = state.fiscalRuleLabelsByStore.get(normalizedStoreId);
    if (!storeLookup || !(storeLookup instanceof Map)) return 'Regra configurada';
    return storeLookup.get(signature) || 'Regra customizada';
  }

  async function ensureFiscalRulesLoadedForTableColumns() {
    const stores = Array.isArray(state.stores) ? state.stores : [];
    if (!stores.length) return;
    await Promise.all(stores.map(async (store) => {
      try {
        await loadFiscalRulesForStore(store.id);
      } catch (_) {
        state.fiscalRuleLabelsByStore.set(String(store.id), new Map());
      }
    }));
  }

  function syncFiscalStoreHeaders() {
    if (!elements.productsTableHeadRow) return;
    elements.productsTableHeadRow
      .querySelectorAll('th[data-dynamic-fiscal-column="true"]')
      .forEach((th) => th.remove());

    const stores = Array.isArray(state.stores) ? state.stores : [];
    if (!stores.length) return;

    const unitHeader = elements.productsTableHeadRow.querySelector('th[data-column-key="unidade"]');
    if (!unitHeader) return;

    stores.forEach((store) => {
      const columnKey = getFiscalStoreColumnKey(store.id);
      if (!columnKey) return;
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'px-4 py-2 text-left';
      th.dataset.columnKey = columnKey;
      th.dataset.dynamicFiscalColumn = 'true';
      th.dataset.productsSortHeader = columnKey;
      th.innerHTML =
        '<div class="flex flex-col gap-1">' +
          '<div class="flex items-center justify-between gap-1">' +
            '<span class="whitespace-nowrap">' + escapeHtml(store.name) + '</span>' +
            '<div class="flex flex-col items-center justify-center gap-px text-gray-400">' +
              '<button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-products-sort="' + columnKey + '" data-sort-direction="asc" aria-label="Ordenar crescente por regra fiscal da empresa">' +
                '<i class="fas fa-sort-up text-[9px]"></i>' +
              '</button>' +
              '<button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-products-sort="' + columnKey + '" data-sort-direction="desc" aria-label="Ordenar decrescente por regra fiscal da empresa">' +
                '<i class="fas fa-sort-down text-[9px]"></i>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<input type="text" placeholder="Filtrar" class="w-full rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium normal-case text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-products-filter="' + columnKey + '">' +
        '</div>';
      elements.productsTableHeadRow.insertBefore(th, unitHeader);
      bindTableControls(th);
    });
  }
  function getVisibleTableColumnKeys() {
    const keys = new Set(BASE_TABLE_COLUMNS);
    const pricesOpen = Boolean(elements.bulkPricesDetails?.open);
    if (pricesOpen) {
      PRICE_TABLE_COLUMNS.forEach((key) => keys.add(key));
    }
    const settingsOpen = Boolean(elements.bulkSettingsDetails?.open);
    if (settingsOpen) {
      SETTINGS_TABLE_COLUMNS.forEach((key) => keys.add(key));
    }
    const generalInfoOpen = Boolean(elements.bulkGeneralInfoDetails?.open);
    if (generalInfoOpen) {
      GENERAL_INFO_TABLE_COLUMNS.forEach((key) => keys.add(key));
    }
    const classificationOpen = Boolean(elements.bulkClassificationDetails?.open);
    if (classificationOpen) {
      CLASSIFICATION_TABLE_COLUMNS.forEach((key) => keys.add(key));
    }
    const fiscalOpen = Boolean(elements.bulkFiscalDetails?.open);
    if (fiscalOpen) {
      getFiscalStoreColumnKeys().forEach((key) => keys.add(key));
    }
    return keys;
  }
  function getVisibleTableColumnCount() {
    const visible = state.visibleColumns instanceof Set ? state.visibleColumns : getVisibleTableColumnKeys();
    return 1 + visible.size;
  }
  function updateTableColumnVisibility(options = {}) {
    const { clearHiddenFilters = true, fetchAfterChange = true } = options;
    const nextVisible = getVisibleTableColumnKeys();
    state.visibleColumns = nextVisible;
    document.querySelectorAll('[data-column-key]').forEach((cell) => {
      const key = cell.dataset.columnKey;
      if (!key) return;
      if (key === 'select') {
        cell.classList.remove('hidden');
        return;
      }
      cell.classList.toggle('hidden', !nextVisible.has(key));
    });
    let shouldFetch = false;
    if (clearHiddenFilters) {
      Object.keys(state.tableFilters || {}).forEach((key) => {
        if (nextVisible.has(key)) return;
        if (!state.tableFilters[key]) return;
        state.tableFilters[key] = '';
        const input = tableFilterInputs.get(key);
        if (input) input.value = '';
        shouldFetch = true;
      });
      const { key: sortKey } = state.tableSort || {};
      if (sortKey && !nextVisible.has(sortKey)) {
        state.tableSort = { key: '', direction: 'asc' };
        shouldFetch = true;
      }
    }
    updateTableSortButtons();
    if (shouldFetch && fetchAfterChange) {
      state.pagination.page = 1;
      fetchProducts(1);
    }
  }
  function setupTableVisibilityBindings() {
    const bindToggle = (detailsElement) => {
      if (!detailsElement) return;
      detailsElement.addEventListener('toggle', () => {
        updateTableColumnVisibility();
        renderProductsTable();
      });
    };

    bindToggle(elements.bulkPricesDetails);
    bindToggle(elements.bulkSettingsDetails);
    bindToggle(elements.bulkGeneralInfoDetails);
    bindToggle(elements.bulkClassificationDetails);
    bindToggle(elements.bulkFiscalDetails);

    elements.bulkFiscalDetails?.addEventListener('toggle', async () => {
      if (!elements.bulkFiscalDetails.open) return;
      await ensureFiscalRulesLoadedForTableColumns();
      renderProductsTable();
    });
  }

  function registerTableFilterInput(input) {
    if (!input || input.dataset.productsBoundFilter === 'true') return;
    const key = input.dataset.productsFilter;
    if (!key) return;
    tableFilterInputs.set(key, input);
    const currentValue = state.tableFilters[key] || '';
    if (input.value !== currentValue) {
      input.value = currentValue;
    }
    input.addEventListener('input', (event) => {
      setTableFilter(key, event.target.value || '');
    });
    input.dataset.productsBoundFilter = 'true';
  }

  function registerTableSortButton(button) {
    if (!button || button.dataset.productsBoundSort === 'true') return;
    const key = button.dataset.productsSort;
    if (!key) return;
    const direction = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
    tableSortButtons.set(button, { key, direction });
    const header = button.closest('[data-products-sort-header]');
    if (header) {
      tableSortHeaders.set(key, header);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      setTableSort(key, direction);
    });
    button.dataset.productsBoundSort = 'true';
  }

  function bindTableControls(scopeElement = document) {
    if (!scopeElement) return;
    scopeElement.querySelectorAll('[data-products-filter]').forEach(registerTableFilterInput);
    scopeElement.querySelectorAll('[data-products-sort]').forEach(registerTableSortButton);
  }

  function setupTableControls() {
    bindTableControls(document);
    updateTableSortButtons();
  }

  function renderAppliedFilters(filters) {
    if (!elements.appliedFilters) return;
    elements.appliedFilters.innerHTML = '';
    const entries = Object.entries(filters).filter(([_, value]) => value !== undefined && value !== null && value !== '');
    if (!entries.length) {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-gray-500 border border-gray-200';
      chip.textContent = 'Nenhum filtro aplicado';
      elements.appliedFilters.appendChild(chip);
      return;
    }

    entries.forEach(([key, value]) => {
      if (value === '' || value === null || value === undefined) return;
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-gray-600 border border-gray-200';
      const icon = document.createElement('i');
      icon.className = 'fas fa-filter text-primary';
      chip.appendChild(icon);
      chip.appendChild(document.createTextNode(`${mapFilterLabel(key)}: ${formatFilterValue(key, value)}`));
      elements.appliedFilters.appendChild(chip);
    });
  }

  function mapFilterLabel(key) {
    const labels = {
      sku: 'SKU',
      nome: 'Descrição',
      barcode: 'Código de barras',
      unidade: 'Unidade',
      referencia: 'Referência',
      tipoProduto: 'Tipo',
      marca: 'Marca',
      categoria: 'Categoria',
      fornecedor: 'Fornecedor',
      situacao: 'Situação',
      ifood: 'Ifood',
      estoqueMin: 'Estoque mín.',
      estoqueMax: 'Estoque máx.',
    };
    return labels[key] || key;
  }

  function formatFilterValue(key, value) {
    if (key === 'situacao') {
      return value === 'inativo' ? 'Inativo' : 'Ativo';
    }
    if (key === 'ifood') {
      return value === 'inativo' ? 'Inativo' : 'Ativo';
    }
    if ((key === 'estoqueMin' || key === 'estoqueMax') && value !== '') {
      return formatNumber(value);
    }
    if (key === 'categoria') {
      const category = state.categories.find((cat) => cat._id === value);
      return category ? category.fullName : value;
    }
    if (key === 'fornecedor') {
      const supplier = state.suppliers.find((sup) => sup.value === value);
      return supplier ? supplier.name : value;
    }
    return value;
  }

  function collectFilters() {
    if (!elements.filtersForm) return {};
    const formData = new FormData(elements.filtersForm);
    const filters = {
      sku: formData.get('sku')?.trim() || '',
      nome: formData.get('nome')?.trim() || '',
      barcode: formData.get('barcode')?.trim() || '',
      unidade: formData.get('unidade') || '',
      referencia: formData.get('referencia')?.trim() || '',
      tipoProduto: formData.get('tipoProduto') || '',
      marca: formData.get('marca')?.trim() || '',
      categoria: formData.get('categoria') || '',
      fornecedor: formData.get('fornecedor') || '',
      situacao: formData.get('situacao') || '',
      ifood: formData.get('ifood') || '',
      estoqueMin: formData.get('estoqueMin')?.trim() || '',
      estoqueMax: formData.get('estoqueMax')?.trim() || '',
    };
    return filters;
  }

  function buildFiltersParams(filters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const normalized = typeof value === 'string' ? value.trim() : value;
      if (normalized === '') return;
      params.set(key, normalized);
    });
    return params;
  }

  function applyTableFiltersToParams(params) {
    const tableFilters = state.tableFilters || {};
    Object.entries(tableFilters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const normalized = typeof value === 'string' ? value.trim() : value;
      if (normalized === '') return;
      const paramKey = TABLE_FILTER_QUERY_KEYS[key];
      if (!paramKey) return;
      params.set(paramKey, normalized);
    });
    return params;
  }

  function buildQueryParams(filters, { page, includePagination = true } = {}) {
    const params = buildFiltersParams(filters);
    applyTableFiltersToParams(params);
    if (page && Number.isFinite(page)) {
      params.set('page', page);
    }
    if (includePagination) {
      params.set('limit', state.pagination.limit);
    }
    const { key: sortKey, direction: sortDirectionRaw } = state.tableSort || {};
    if (sortKey) {
      params.set('sortKey', sortKey);
      params.set('sortDirection', sortDirectionRaw === 'desc' ? 'desc' : 'asc');
    }
    return params;
  }

  function buildQueryString(filters, page) {
    return buildQueryParams(filters, { page }).toString();
  }

  function enableBulkField(fieldWrapper, enabled) {
    if (!fieldWrapper) return;
    const inputs = fieldWrapper.querySelectorAll('[data-bulk-input], [data-bulk-option]');
    inputs.forEach((input) => {
      if ('disabled' in input) {
        input.disabled = !enabled;
      }
      if (input.hasAttribute('data-bulk-option')) {
        input.closest('label')?.classList.toggle('opacity-60', !enabled);
      }
    });
  }

  function setupBulkFieldToggles() {
    elements.bulkFields.forEach((fieldWrapper) => {
      const toggle = fieldWrapper.querySelector('[data-bulk-toggle]');
      if (!toggle) return;
      toggle.addEventListener('change', () => {
        enableBulkField(fieldWrapper, toggle.checked);
        updateBulkButtonsState();
      });
      enableBulkField(fieldWrapper, toggle.checked);
    });
  }

  function updateBulkButtonsState() {
    const hasSelection = state.selected.size > 0;
    const hasEnabledField = elements.bulkFields.some((wrapper) => wrapper.querySelector('[data-bulk-toggle]')?.checked);
    const shouldEnable = hasSelection && hasEnabledField;
    [elements.confirmBulkUpdateButton, elements.applyMassFromHeaderButton].forEach((button) => {
      if (!button) return;
      button.disabled = !shouldEnable || state.loading;
    });
  }

  function updateExportButtonState() {
    const button = elements.exportExcelButton;
    if (!button) return;
    const total = Number(state.pagination?.total || 0);
    const hasResults = Number.isFinite(total) && total > 0;
    button.disabled = state.loading || state.exporting || !hasResults;
  }

  function clearFilters() {
    if (!elements.filtersForm) return;
    elements.filtersForm.reset();
    state.filters = collectFilters();
    renderAppliedFilters(state.filters);
    Object.keys(state.tableFilters || {}).forEach((key) => {
      state.tableFilters[key] = '';
      const input = tableFilterInputs.get(key);
      if (input && input.value !== '') {
        input.value = '';
      }
    });
    if (tableFilterFetchTimeout) {
      clearTimeout(tableFilterFetchTimeout);
      tableFilterFetchTimeout = null;
    }
    fetchProducts(1);
  }

  function updateSelectionSummary() {
    const count = state.selected.size;
    if (count === 0) {
      elements.selectedSummary.innerHTML = '<i class="fas fa-boxes-stacked"></i> Nenhum produto selecionado';
    } else if (count === 1) {
      elements.selectedSummary.innerHTML = '<i class="fas fa-boxes-stacked"></i> 1 produto selecionado';
    } else {
      elements.selectedSummary.innerHTML = `<i class="fas fa-boxes-stacked"></i> ${formatNumber(count)} produtos selecionados`;
    }


    if (elements.resultsSelectedCounter) {
      elements.resultsSelectedCounter.textContent = count === 1
        ? '1 selecionado'
        : formatNumber(count) + ' selecionados';
    }

    updateBulkButtonsState();
  }

  function toggleSelection(productId, selected) {
    if (!productId) return;
    if (selected) {
      state.selected.add(productId);
    } else {
      state.selected.delete(productId);
    }
    updateSelectionSummary();
  }

  function renderProductsTable() {
    if (!elements.productsTableBody) return;
    elements.productsTableBody.innerHTML = '';

    updateTableSortButtons();
    updateTableColumnVisibility({ clearHiddenFilters: false, fetchAfterChange: false });

    const rawProducts = Array.isArray(state.products) ? state.products : [];
    const visibleProducts = getVisibleProducts();
    const hasActiveColumnFilters = Object.values(state.tableFilters || {}).some(
      (value) => typeof value === 'string' && value.trim() !== '',
    );
    const visibleColumnCount = getVisibleTableColumnCount();

    if (!rawProducts.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td colspan="' + visibleColumnCount + '" class="px-4 py-6 text-center text-xs text-gray-500">Nenhum produto encontrado para os filtros informados.</td>';
      elements.productsTableBody.appendChild(emptyRow);
      if (elements.selectAllCheckbox) {
        elements.selectAllCheckbox.checked = false;
        elements.selectAllCheckbox.indeterminate = false;
      }
      return;
    }

    if (!visibleProducts.length && hasActiveColumnFilters) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td colspan="' + visibleColumnCount + '" class="px-4 py-6 text-center text-xs text-gray-500">Nenhum produto corresponde aos filtros digitados na tabela.</td>';
      elements.productsTableBody.appendChild(emptyRow);
      if (elements.selectAllCheckbox) {
        elements.selectAllCheckbox.checked = false;
        elements.selectAllCheckbox.indeterminate = false;
      }
      return;
    }

    visibleProducts.forEach((product) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50';
      const isSelected = state.selected.has(product.id);
      const fiscalCells = (Array.isArray(state.stores) ? state.stores : []).map((store) => {
        const key = getFiscalStoreColumnKey(store.id);
        const label = getFiscalRuleLabelForProductStore(product, store.id);
        return '<td class="px-4 py-3 text-gray-600" data-column-key="' + key + '">' + escapeHtml(label || '-') + '</td>';
      }).join('');

      row.innerHTML =
        '<td class="px-4 py-3" data-column-key="select">' +
          '<input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary/20" data-product-checkbox data-product-id="' + product.id + '" ' + (isSelected ? 'checked' : '') + '>' +
        '</td>' +
        '<td class="px-4 py-3 font-semibold text-gray-700" data-column-key="sku">' + (product.cod || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="barcode">' + (product.codbarras || product.barcode || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="nome">' + (product.nome || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="marca">' + (product.marca || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="apresentacao">' + (product.apresentacao || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-700" data-column-key="peso">' + (product.peso === null || product.peso === undefined ? '-' : formatNumber(product.peso)) + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="iat">' + (product.iat || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="tipoProduto">' + (product.tipoProduto || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="categorias">' + (product.categorias || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="idade">' + (product.idade || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="especie">' + (product.especie || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="porte">' + (product.porte || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="castrado">' + (product.castrado || '-') + '</td>' +
        fiscalCells +
        '<td class="px-4 py-3 text-gray-600" data-column-key="unidade">' + (product.unidade || '-') + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="imagem">' + (product.temImagem ? 'Sim' : 'Nao') + '</td>' +
        '<td class="px-4 py-3 text-gray-700" data-column-key="custo">' + formatCurrency(product.custo) + '</td>' +
        '<td class="px-4 py-3 text-gray-700" data-column-key="markup">' + (product.markup === null || product.markup === undefined ? '-' : formatPercentage(product.markup)) + '</td>' +
        '<td class="px-4 py-3 text-gray-700" data-column-key="venda">' + formatCurrency(product.venda) + '</td>' +
        '<td class="px-4 py-3 text-gray-700" data-column-key="promocao">' + (product.promocao === null || product.promocao === undefined ? '-' : formatCurrency(product.promocao)) + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="stock">' + formatNumber(product.stock) + '</td>' +
        '<td class="px-4 py-3 text-gray-600" data-column-key="fornecedor">' + (product.fornecedor || '-') + '</td>' +
        '<td class="px-4 py-3" data-column-key="situacao">' +
          (product.inativo
            ? '<span class="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-700">Inativo</span>'
            : '<span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Ativo</span>') +
        '</td>';
      elements.productsTableBody.appendChild(row);
    });

    updateTableColumnVisibility({ clearHiddenFilters: false, fetchAfterChange: false });

    if (elements.selectAllCheckbox) {
      const pageSelection = visibleProducts.filter((product) => state.selected.has(product.id)).length;
      elements.selectAllCheckbox.checked =
        visibleProducts.length > 0 && pageSelection === visibleProducts.length;
      elements.selectAllCheckbox.indeterminate =
        pageSelection > 0 && pageSelection < visibleProducts.length;
    }
  }

  function renderPagination() {
    if (!elements.paginationControls) return;
    elements.paginationControls.innerHTML = '';

    const { page, pages } = state.pagination;
    if (pages <= 1) {
      const info = document.createElement('span');
      info.textContent = 'Página única';
      elements.paginationControls.appendChild(info);
      return;
    }

    const createButton = (label, targetPage, disabled) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = 'rounded-lg border border-gray-200 px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed';
      button.disabled = disabled;
      button.addEventListener('click', () => fetchProducts(targetPage));
      return button;
    };

    elements.paginationControls.appendChild(createButton('Anterior', page - 1, page <= 1 || state.loading));

    const pageInfo = document.createElement('span');
    pageInfo.className = 'px-2 text-gray-600';
    pageInfo.textContent = `Página ${page} de ${pages}`;
    elements.paginationControls.appendChild(pageInfo);

    elements.paginationControls.appendChild(createButton('Próxima', page + 1, page >= pages || state.loading));
  }

  function updateResultsSummary() {
    if (!elements.resultsSummary) return;
    const { total, page } = state.pagination;
    if (elements.pageSizeSelect && elements.pageSizeSelect.value !== String(state.pagination.limit)) {
      elements.pageSizeSelect.value = String(state.pagination.limit);
    }
    if (!total) {
      elements.resultsSummary.textContent = 'Nenhum produto carregado.';
      return;
    }
    const start = (page - 1) * state.pagination.limit + 1;
    const end = Math.min(page * state.pagination.limit, total);
    elements.resultsSummary.textContent = `${formatNumber(start)}-${formatNumber(end)} de ${formatNumber(total)} produtos.`;
    updateExportButtonState();
  }

  function handlePageSizeChange(event) {
    const value = parseInt(event.target.value, 10);
    if (!Number.isFinite(value) || value <= 0) {
      event.target.value = String(state.pagination.limit);
      return;
    }
    if (state.pagination.limit === value) {
      return;
    }
    state.pagination.limit = value;
    state.pagination.page = 1;
    fetchProducts(1);
  }

  async function fetchProducts(page = 1) {
    state.loading = true;
    updateBulkButtonsState();
    updateExportButtonState();
    if (elements.pageSizeSelect) {
      elements.pageSizeSelect.disabled = true;
    }
    renderPagination();
    const filters = collectFilters();
    state.filters = filters;
    renderAppliedFilters(filters);

    const query = buildQueryString(filters, page);
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/admin/products/bulk?${query}`);
      if (!response) return;
      if (!response.ok) {
        throw new Error('Falha ao buscar produtos.');
      }
      const data = await response.json();
      const baseProducts = Array.isArray(data?.products) ? data.products : [];
      const nextPage = Number(data?.pagination?.page) || page;
      const nextLimit = (() => {
        const parsed = Number(data?.pagination?.limit);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : state.pagination.limit;
      })();
      const nextTotal = Number(data?.pagination?.total) || 0;
      const nextPages = Math.max(Number(data?.pagination?.pages) || 1, 1);

      state.pagination = {
        page: nextPage,
        limit: nextLimit,
        total: nextTotal,
        pages: nextPages,
      };

      state.products = baseProducts.map((product, index) => ({
        ...product,
        temImagem: Boolean(product.temImagem),
        __position: (nextPage - 1) * nextLimit + index,
      }));
      state.loading = false;
      renderProductsTable();
      renderPagination();
      updateResultsSummary();
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      alert('Não foi possível carregar os produtos. Tente novamente mais tarde.');
    } finally {
      state.loading = false;
      if (elements.pageSizeSelect) {
        elements.pageSizeSelect.disabled = state.loading;
      }
      renderPagination();
      updateResultsSummary();
      updateBulkButtonsState();
      updateExportButtonState();
      tableFilterFetchTimeout = null;
    }
  }

  async function exportProductsToExcel() {
    if (!elements.exportExcelButton) return;
    if (state.exporting) return;
    const total = Number(state.pagination?.total || 0);
    if (!Number.isFinite(total) || total <= 0) {
      alert('Nenhum produto encontrado para exportar.');
      return;
    }

    const button = elements.exportExcelButton;
    const originalContent = button.innerHTML;

    state.exporting = true;
    updateExportButtonState();
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exportando...';

    try {
      const params = buildQueryParams(state.filters || {}, { includePagination: false });
      const queryString = params.toString();
      const endpoint = `${API_CONFIG.BASE_URL}/admin/products/bulk/export/excel${
        queryString ? `?${queryString}` : ''
      }`;

      const response = await fetchWithAuth(endpoint);
      if (!response) {
        throw new Error('Não foi possível autenticar a exportação.');
      }
      if (!response.ok) {
        let message = 'Não foi possível exportar a planilha de produtos.';
        try {
          const payload = await response.json();
          if (payload?.message) {
            message = payload.message;
          }
        } catch (parseError) {
          console.warn('Falha ao interpretar o erro da exportação.', parseError);
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        alert('A exportação não retornou dados.');
        return;
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = downloadUrl;
      link.download = `relacao-produtos-${timestamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Erro ao exportar planilha de produtos:', error);
      alert(error.message || 'Não foi possível exportar a planilha de produtos.');
    } finally {
      if (elements.exportExcelButton) {
        elements.exportExcelButton.innerHTML = originalContent;
      }
      state.exporting = false;
      updateExportButtonState();
    }
  }

  function collectBulkUpdates() {
    const updates = {};

    elements.bulkFields.forEach((wrapper) => {
      const toggle = wrapper.querySelector('[data-bulk-toggle]');
      if (!toggle || !toggle.checked) return;
      const fieldKey = wrapper.getAttribute('data-bulk-field');
      if (!fieldKey) return;

      if (fieldKey === 'fornecedor') {
        const inputs = wrapper.querySelectorAll('[data-bulk-input]');
        const payload = {};
        inputs.forEach((input) => {
          const name = input.getAttribute('name');
          if (!name) return;
          const rawValue = input.value?.trim() || '';
          if (!rawValue) return;
          if (input.type === 'number') {
            const parsed = Number(rawValue);
            if (Number.isFinite(parsed)) {
              payload[name] = parsed;
            }
          } else {
            payload[name] = rawValue;
          }
        });
        if (!payload['supplier-name']) {
          throw new Error('Informe o nome do fornecedor ao substituir o fornecedor principal.');
        }
        updates[fieldKey] = { enabled: true, value: payload };
        return;
      }

      const input = wrapper.querySelector('[data-bulk-input]');
      const optionInputs = wrapper.querySelectorAll('[data-bulk-option]');

      if (optionInputs.length) {
        const values = Array.from(optionInputs)
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value)
          .filter((value) => value !== undefined && value !== null);
        updates[fieldKey] = { enabled: true, value: values };
        return;
      }

      if (!input) return;
      const dataType = input.getAttribute('data-type') || 'text';
      let value = input.value;

      if (dataType === 'multi-select') {
        value = Array.from(input.selectedOptions).map((option) => option.value);
      } else if (dataType === 'number') {
        if (value === '' || value === null) {
          value = null;
        } else {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) {
            throw new Error(`Valor inválido informado em "${fieldKey}".`);
          }
          value = parsed;
        }
      } else if (dataType === 'boolean') {
        value = value === 'true';
      } else {
        value = value !== undefined && value !== null ? String(value) : '';
      }

      updates[fieldKey] = { enabled: true, value };
    });

    const storeUpdate = updates['fiscal.storeId'];
    const ruleUpdate = updates['fiscal.ruleCode'];
    const fiscalStoreEnabled = Boolean(storeUpdate?.enabled);
    const fiscalRuleEnabled = Boolean(ruleUpdate?.enabled);

    if (fiscalStoreEnabled || fiscalRuleEnabled) {
      const storeId = String(storeUpdate?.value || '').trim();
      const ruleCode = Number(ruleUpdate?.value);

      if (!storeId) {
        throw new Error('Selecione a empresa para aplicar a regra fiscal.');
      }
      if (!Number.isFinite(ruleCode) || ruleCode <= 0) {
        throw new Error('Selecione o tipo de regra fiscal.');
      }

      updates['fiscal.storeId'] = { enabled: true, value: storeId };
      updates['fiscal.ruleCode'] = { enabled: true, value: ruleCode };
    }

    const hasAny = Object.values(updates).some((entry) => entry && entry.enabled);
    if (!hasAny) {
      throw new Error('Selecione ao menos um campo para alterar.');
    }

    return updates;
  }

  async function applyBulkUpdates() {
    if (state.selected.size === 0) {
      alert('Selecione ao menos um produto antes de aplicar as alterações.');
      return;
    }

    let updates;
    try {
      updates = collectBulkUpdates();
    } catch (error) {
      alert(error.message || 'Não foi possível preparar os dados para atualização.');
      return;
    }

    if (!confirm(`Confirmar alterações em ${state.selected.size} produto(s)?`)) {
      return;
    }

    state.loading = true;
    updateBulkButtonsState();
    updateExportButtonState();

    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/admin/products/bulk`, {
        method: 'PUT',
        body: JSON.stringify({
          productIds: Array.from(state.selected),
          updates,
        }),
      });
      if (!response) return;
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload?.message || 'Falha ao aplicar as alterações.');
      }

      const result = await response.json();
      const updated = result?.updated || 0;
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      if (errors.length) {
        console.warn('Falhas ao atualizar alguns produtos:', errors);
      }
      alert(`Alterações aplicadas em ${updated} produto(s).` + (errors.length ? `\n${errors.length} item(ns) não puderam ser atualizado(s).` : ''));

      state.selected.clear();
      updateSelectionSummary();
      await fetchProducts(state.pagination.page);
    } catch (error) {
      console.error('Erro ao aplicar alterações em massa:', error);
      alert(error.message || 'Não foi possível aplicar as alterações.');
    } finally {
      state.loading = false;
      updateBulkButtonsState();
      updateExportButtonState();
    }
  }

  function handleTableEvents() {
    elements.productsTableBody.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches('[data-product-checkbox]')) return;
      const productId = target.getAttribute('data-product-id');
      toggleSelection(productId, target.checked);
    });

    elements.selectAllCheckbox.addEventListener('change', async () => {
      const shouldSelectAll = elements.selectAllCheckbox.checked;
      if (shouldSelectAll) {
        await selectAllMatches();
        return;
      }

      state.selected.clear();
      elements.selectAllCheckbox.indeterminate = false;
      renderProductsTable();
      updateSelectionSummary();
    });

    elements.selectAllCurrentButton.addEventListener('click', () => {
      const visibleProducts = getVisibleProducts();
      if (!visibleProducts.length) {
        return;
      }
      const allSelected = visibleProducts.every((product) => state.selected.has(product.id));
      visibleProducts.forEach((product) => {
        if (allSelected) {
          state.selected.delete(product.id);
        } else {
          state.selected.add(product.id);
        }
      });
      renderProductsTable();
      updateSelectionSummary();
    });
  }

  async function selectAllMatches() {
    if (state.selectingAllMatches) return;

    if (!state.pagination.total) {
      elements.selectAllCheckbox.checked = false;
      elements.selectAllCheckbox.indeterminate = false;
      alert('Nenhum produto encontrado para selecionar.');
      return;
    }

    state.selectingAllMatches = true;
    elements.selectAllCheckbox.disabled = true;
    elements.selectAllCheckbox.indeterminate = true;

    try {
      const params = buildQueryParams(state.filters || {}, { includePagination: false });
      params.set('idsOnly', 'true');
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/admin/products/bulk?${params.toString()}`);
      if (!response) {
        throw new Error('Falha ao carregar todos os produtos selecionados.');
      }
      if (!response.ok) {
        throw new Error('Não foi possível selecionar todos os produtos.');
      }

      const payload = await response.json();
      const ids = Array.isArray(payload?.ids) ? payload.ids : [];

      ids.forEach((id) => state.selected.add(id));

      if (typeof payload?.total === 'number') {
        state.pagination.total = payload.total;
      }

      renderProductsTable();
      elements.selectAllCheckbox.checked = ids.length > 0;
      elements.selectAllCheckbox.indeterminate = false;
      updateSelectionSummary();
      updateExportButtonState();
    } catch (error) {
      console.error('Erro ao selecionar todos os produtos:', error);
      alert(error.message || 'Não foi possível selecionar todos os produtos.');
      elements.selectAllCheckbox.checked = false;
      elements.selectAllCheckbox.indeterminate = false;
    } finally {
      state.selectingAllMatches = false;
      elements.selectAllCheckbox.disabled = false;
    }
  }

  function resetBulkSelections() {
    elements.bulkFields.forEach((wrapper) => {
      const toggle = wrapper.querySelector('[data-bulk-toggle]');
      if (toggle) {
        toggle.checked = false;
      }
      enableBulkField(wrapper, false);
    });


    updateBulkButtonsState();
  }

  async function loadCategories() {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/categories`);
      if (!response.ok) throw new Error('Falha ao carregar categorias');
      const categories = await response.json();
      state.categories = categories.map((category) => ({
        _id: category._id,
        nome: category.nome,
        parent: category.parent || null,
      }));
      const categoryMap = new Map(state.categories.map((cat) => [cat._id, cat]));
      state.categories = state.categories.map((category) => {
        const names = [category.nome];
        let current = categoryMap.get(category.parent);
        while (current) {
          names.unshift(current.nome);
          current = categoryMap.get(current.parent);
        }
        return { ...category, fullName: names.join(' > ') };
      }).sort((a, b) => a.fullName.localeCompare(b.fullName));
      populateCategorySelects();
    } catch (error) {
      console.error('Erro ao carregar categorias:', error);
    }
  }

  function populateCategorySelects() {
    if (elements.filterCategoriaSelect) {
      const currentValue = elements.filterCategoriaSelect.value;
      elements.filterCategoriaSelect.innerHTML = '<option value="">Todas</option>';
      state.categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category._id;
        option.textContent = category.fullName;
        elements.filterCategoriaSelect.appendChild(option);
      });
      elements.filterCategoriaSelect.value = currentValue;
    }

    if (elements.bulkCategoriasSelect) {
      const selectedValues = Array.from(elements.bulkCategoriasSelect.selectedOptions).map((option) => option.value);
      elements.bulkCategoriasSelect.innerHTML = '';
      state.categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category._id;
        option.textContent = category.fullName;
        if (selectedValues.includes(category._id)) {
          option.selected = true;
        }
        elements.bulkCategoriasSelect.appendChild(option);
      });
    }
  }

  async function loadSuppliers() {
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/suppliers`);
      if (!response) return;
      if (!response.ok) throw new Error('Falha ao carregar fornecedores');
      const payload = await response.json();
      const suppliers = Array.isArray(payload?.suppliers) ? payload.suppliers : [];
      state.suppliers = suppliers.map((supplier) => {
        const name = supplier.tradeName || supplier.legalName || supplier.fantasyName || supplier.nome || 'Fornecedor';
        return {
          value: name,
          name,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      populateSupplierSelect();
    } catch (error) {
      console.error('Erro ao carregar fornecedores:', error);
    }
  }

  function populateSupplierSelect() {
    if (!elements.filterFornecedorSelect) return;
    const currentValue = elements.filterFornecedorSelect.value;
    elements.filterFornecedorSelect.innerHTML = '<option value="">Todos</option>';
    state.suppliers.forEach((supplier) => {
      const option = document.createElement('option');
      option.value = supplier.value;
      option.textContent = supplier.name;
      elements.filterFornecedorSelect.appendChild(option);
    });
    elements.filterFornecedorSelect.value = currentValue;
  }

  async function loadAllowedStores() {
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/stores/allowed`);
      if (!response) return;
      if (!response.ok) throw new Error('Falha ao carregar empresas permitidas.');
      const payload = await response.json();
      const stores = Array.isArray(payload?.stores) ? payload.stores : [];
      state.stores = stores
        .map((store) => ({
          id: String(store?._id || store?.id || '').trim(),
          name: store?.nome || store?.nomeFantasia || 'Empresa sem nome',
        }))
        .filter((store) => Boolean(store.id));
      populateFiscalStoreSelect();
      syncFiscalStoreHeaders();
      updateTableColumnVisibility({ clearHiddenFilters: false, fetchAfterChange: false });
      renderProductsTable();
    } catch (error) {
      console.error('Erro ao carregar empresas permitidas:', error);
      state.stores = [];
      populateFiscalStoreSelect();
      syncFiscalStoreHeaders();
    }
  }

  function populateFiscalStoreSelect() {
    if (!elements.bulkFiscalStoreSelect) return;
    const currentValue = elements.bulkFiscalStoreSelect.value;
    elements.bulkFiscalStoreSelect.innerHTML = '<option value="">Selecione uma empresa</option>';

    state.stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store.id;
      option.textContent = store.name;
      elements.bulkFiscalStoreSelect.appendChild(option);
    });

    if (currentValue && state.stores.some((store) => store.id === currentValue)) {
      elements.bulkFiscalStoreSelect.value = currentValue;
    }

    const selectedStoreId = elements.bulkFiscalStoreSelect.value || '';
    updateFiscalRuleSelect(selectedStoreId);
  }

  async function loadFiscalRulesForStore(storeId) {
    const normalizedStoreId = String(storeId || '').trim();
    if (!normalizedStoreId) {
      return [];
    }

    if (state.fiscalRulesByStore.has(normalizedStoreId)) {
      return state.fiscalRulesByStore.get(normalizedStoreId) || [];
    }

    const response = await fetchWithAuth(
      `${API_CONFIG.BASE_URL}/fiscal/default-rules?storeId=${encodeURIComponent(normalizedStoreId)}`,
    );
    if (!response) return [];
    if (!response.ok) {
      throw new Error('Falha ao carregar regras fiscais da empresa selecionada.');
    }

    const payload = await response.json();
    const rules = Array.isArray(payload?.rules) ? payload.rules : [];
    state.fiscalRulesByStore.set(normalizedStoreId, rules);
    rebuildFiscalRuleLabelsForStore(normalizedStoreId);
    return rules;
  }

  async function updateFiscalRuleSelect(storeId) {
    if (!elements.bulkFiscalRuleSelect) return;

    const normalizedStoreId = String(storeId || '').trim();
    const previousValue = elements.bulkFiscalRuleSelect.value;

    if (!normalizedStoreId) {
      elements.bulkFiscalRuleSelect.innerHTML = '<option value="">Selecione uma empresa primeiro</option>';
      elements.bulkFiscalRuleSelect.value = '';
      return;
    }

    elements.bulkFiscalRuleSelect.innerHTML = '<option value="">Carregando regras...</option>';
    elements.bulkFiscalRuleSelect.value = '';

    try {
      const rules = await loadFiscalRulesForStore(normalizedStoreId);
      elements.bulkFiscalRuleSelect.innerHTML = '<option value="">Selecione uma regra fiscal</option>';

      rules.forEach((rule) => {
        const code = Number(rule?.code);
        if (!Number.isFinite(code) || code <= 0) return;
        const option = document.createElement('option');
        option.value = String(code);
        option.textContent = `${code} - ${rule?.name || 'Regra sem nome'}`;
        elements.bulkFiscalRuleSelect.appendChild(option);
      });

      if (previousValue && rules.some((rule) => String(rule?.code || '') === previousValue)) {
        elements.bulkFiscalRuleSelect.value = previousValue;
      }
    } catch (error) {
      console.error('Erro ao carregar regras fiscais da empresa:', error);
      elements.bulkFiscalRuleSelect.innerHTML = '<option value="">Erro ao carregar regras</option>';
      elements.bulkFiscalRuleSelect.value = '';
    }
  }

  function setupFiscalRuleBindings() {
    if (!elements.bulkFiscalStoreSelect || !elements.bulkFiscalRuleSelect) return;

    elements.bulkFiscalStoreSelect.addEventListener('change', async () => {
      const storeId = elements.bulkFiscalStoreSelect.value || '';
      await updateFiscalRuleSelect(storeId);
      if (Boolean(elements.bulkFiscalDetails?.open)) {
        await ensureFiscalRulesLoadedForTableColumns();
        renderProductsTable();
      }
    });
  }

  function setupEventListeners() {
    elements.filtersForm.addEventListener('submit', (event) => {
      event.preventDefault();
      fetchProducts(1);
    });

    elements.clearFiltersButton.addEventListener('click', clearFilters);
    elements.confirmBulkUpdateButton.addEventListener('click', applyBulkUpdates);
    elements.applyMassFromHeaderButton.addEventListener('click', applyBulkUpdates);
    elements.pageSizeSelect?.addEventListener('change', handlePageSizeChange);
    elements.exportExcelButton?.addEventListener('click', exportProductsToExcel);

    handleTableEvents();
  }

  function collectSelectedCategories(selectElement) {
    if (!selectElement) return [];
    return Array.from(selectElement.selectedOptions).map((option) => option.value);
  }

  function injectBulkCategoryCollector() {
    if (!elements.bulkCategoriasSelect) return;
    const wrapper = elements.bulkCategoriasSelect.closest('[data-bulk-field="categorias"]');
    if (!wrapper) return;
    const toggle = wrapper.querySelector('[data-bulk-toggle]');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        enableBulkField(wrapper, true);
      }
    });
  }

  function attachBulkCategoryExtractor() {
    const wrapper = elements.bulkForm?.querySelector('[data-bulk-field="categorias"]');
    if (!wrapper) return;
    const toggle = wrapper.querySelector('[data-bulk-toggle]');
    if (!toggle) return;
    wrapper.addEventListener('change', (event) => {
      if (!toggle.checked) return;
      const target = event.target;
      if (target === toggle) return;
      if (target === elements.bulkCategoriasSelect) {
        // just keep state; nothing to do here
      }
    });
  }

  async function initialize() {
    initElements();
    if (!elements.filtersForm || !elements.bulkForm) {
      console.error('Elementos essenciais não encontrados na página.');
      return;
    }

    setupBulkFieldToggles();
    resetBulkSelections();
    setupEventListeners();
    setupTableControls();
    setupTableVisibilityBindings();
    setupFiscalRuleBindings();
    injectBulkCategoryCollector();
    attachBulkCategoryExtractor();

    await Promise.all([loadCategories(), loadSuppliers(), loadAllowedStores()]);
    syncFiscalStoreHeaders();
    if (Boolean(elements.bulkFiscalDetails?.open)) {
      await ensureFiscalRulesLoadedForTableColumns();
    }
    state.filters = collectFilters();
    renderAppliedFilters(state.filters);
    updateSelectionSummary();
    updateExportButtonState();
    updateTableColumnVisibility({ clearHiddenFilters: true, fetchAfterChange: false });
    fetchProducts(1);
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();



















