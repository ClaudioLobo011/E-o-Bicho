
(function () {
  'use strict';

  const STORAGE_KEYS = {
    DATASET: 'adminPdv:dataset',
    SESSION: 'adminPdv:session',
    PDV_PREFIX: 'adminPdv:pdv:'
  };

  const DEFAULT_DATASET = Object.freeze({
    companies: [
      {
        id: 'comp-001',
        name: 'E o Bicho Matriz',
        fantasyName: 'E o Bicho Centro',
        document: '12.345.678/0001-90'
      },
      {
        id: 'comp-002',
        name: 'E o Bicho Filial',
        fantasyName: 'E o Bicho Norte',
        document: '98.765.432/0001-12'
      }
    ],
    pdvs: [
      {
        id: 'pdv-001',
        companyId: 'comp-001',
        name: 'Caixa Principal',
        location: 'Loja Centro'
      },
      {
        id: 'pdv-002',
        companyId: 'comp-001',
        name: 'Caixa Serviços',
        location: 'Clínica Veterinária'
      },
      {
        id: 'pdv-003',
        companyId: 'comp-002',
        name: 'Caixa Loja Norte',
        location: 'Shopping Norte'
      }
    ],
    paymentMethods: [
      { id: 'dinheiro', label: 'Dinheiro', type: 'avista' },
      { id: 'debito', label: 'Cartão de Débito', type: 'debito' },
      { id: 'credito', label: 'Cartão de Crédito', type: 'credito' },
      { id: 'pix', label: 'PIX', type: 'avista' }
    ],
    products: [
      {
        id: 'prod-001',
        name: 'Ração Premium 10kg',
        sku: 'RAC-10',
        barcode: '7891234567890',
        price: 259.9,
        photo: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=200&q=80'
      },
      {
        id: 'prod-002',
        name: 'Coleira Ajustável',
        sku: 'COL-AJU',
        barcode: '7891234567001',
        price: 49.9,
        photo: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=200&q=80'
      },
      {
        id: 'prod-003',
        name: 'Brinquedo Mordedor',
        sku: 'BRI-MOR',
        barcode: '7891234567555',
        price: 34.5,
        photo: 'https://images.unsplash.com/photo-1619983081593-bac844b1a8f5?auto=format&fit=crop&w=200&q=80'
      },
      {
        id: 'prod-004',
        name: 'Banho e Tosa Completo',
        sku: 'SERV-BT',
        barcode: 'SERVICO001',
        price: 89.9,
        photo: 'https://images.unsplash.com/photo-1617813489125-74c03b54883b?auto=format&fit=crop&w=200&q=80'
      }
    ]
  });

  const paymentTypeOrder = { avista: 0, debito: 1, credito: 2 };

  const state = {
    dataset: null,
    session: { companyId: '', pdvId: '' },
    pdvSession: null,
    selectedProduct: null,
    quantity: 1,
    searchQuery: '',
    searchResults: [],
    selectedAction: null
  };

  const elements = {};

  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

  const hasLocalStorage = (() => {
    if (!isBrowser || typeof window.localStorage === 'undefined') return false;
    try {
      const key = '__pdv_test__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('LocalStorage não disponível:', error);
      return false;
    }
  })();

  const LocalStore = {
    read(key, fallback = null) {
      if (!hasLocalStorage) return fallback;
      try {
        const value = window.localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
      } catch (error) {
        console.warn('Erro ao ler armazenamento local:', key, error);
        return fallback;
      }
    },
    write(key, value) {
      if (!hasLocalStorage) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn('Erro ao gravar armazenamento local:', key, error);
      }
    },
    remove(key) {
      if (!hasLocalStorage) return;
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        console.warn('Erro ao remover armazenamento local:', key, error);
      }
    }
  };

  const notify = (message, type = 'info') => {
    if (typeof window?.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    if (typeof window?.showModal === 'function') {
      window.showModal({ title: type === 'error' ? 'Erro' : 'Aviso', message, confirmText: 'OK' });
      return;
    }
    window.alert(message);
  };

  const uuid = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

  const safeNumber = (value, fallback = 0) => {
    if (value === null || value === undefined) return fallback;
    const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : fallback;
  };

  const formatCurrency = (value) => {
    return Number(safeNumber(value)).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2
    });
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatLine = (label, value, width = 42) => {
    const left = String(label ?? '').trim();
    const right = String(value ?? '').trim();
    const space = Math.max(width - left.length - right.length, 2);
    return `${left}${' '.repeat(space)}${right}`;
  };

  const toDataset = (value) => {
    if (!value || typeof value !== 'object') return null;
    return {
      companies: Array.isArray(value.companies) ? value.companies : [],
      pdvs: Array.isArray(value.pdvs) ? value.pdvs : [],
      paymentMethods: Array.isArray(value.paymentMethods) ? value.paymentMethods : [],
      products: Array.isArray(value.products) ? value.products : []
    };
  };

  const createDefaultPdvSession = () => ({
    caixa: {
      aberto: false,
      aberturaValor: 0,
      aberturaData: null,
      fechamentoData: null,
      saldo: 0,
      paymentTotals: {},
      history: []
    },
    sale: {
      items: [],
      discount: 0,
      increase: 0,
      lastSaleAt: null
    }
  });

  const findCompany = (companyId) => {
    return state.dataset?.companies?.find((company) => company.id === companyId) || null;
  };

  const findPdv = (pdvId) => {
    return state.dataset?.pdvs?.find((pdv) => pdv.id === pdvId) || null;
  };

  const findPaymentMethod = (methodId) => {
    return state.dataset?.paymentMethods?.find((method) => method.id === methodId) || null;
  };

  const loadDataset = () => {
    const stored = LocalStore.read(STORAGE_KEYS.DATASET, null);
    const dataset = toDataset(stored) || DEFAULT_DATASET;
    if (!stored) {
      LocalStore.write(STORAGE_KEYS.DATASET, dataset);
    }
    return dataset;
  };

  const loadSession = () => {
    const stored = LocalStore.read(STORAGE_KEYS.SESSION, null);
    if (stored && typeof stored === 'object') {
      return {
        companyId: stored.companyId || '',
        pdvId: stored.pdvId || ''
      };
    }
    return { companyId: '', pdvId: '' };
  };

  const saveSession = () => {
    LocalStore.write(STORAGE_KEYS.SESSION, state.session);
  };

  const loadPdvSession = (pdvId) => {
    const stored = LocalStore.read(`${STORAGE_KEYS.PDV_PREFIX}${pdvId}`, null);
    if (!stored || typeof stored !== 'object') {
      return createDefaultPdvSession();
    }
    const defaults = createDefaultPdvSession();
    return {
      caixa: {
        ...defaults.caixa,
        ...stored.caixa,
        paymentTotals: { ...defaults.caixa.paymentTotals, ...(stored.caixa?.paymentTotals || {}) },
        history: Array.isArray(stored.caixa?.history) ? stored.caixa.history : []
      },
      sale: {
        ...defaults.sale,
        ...stored.sale,
        items: Array.isArray(stored.sale?.items) ? stored.sale.items : []
      }
    };
  };

  const savePdvSession = () => {
    if (!state.session.pdvId || !state.pdvSession) return;
    LocalStore.write(`${STORAGE_KEYS.PDV_PREFIX}${state.session.pdvId}`, state.pdvSession);
  };

  const queryElements = () => {
    elements.companySelect = document.getElementById('company-select');
    elements.pdvSelect = document.getElementById('pdv-select');
    elements.selectionHint = document.getElementById('pdv-selection-hint');
    elements.emptyState = document.getElementById('pdv-empty-state');
    elements.workspace = document.getElementById('pdv-workspace');
    elements.statusBadge = document.getElementById('pdv-status-badge');
    elements.companyLabel = document.getElementById('pdv-company-label');
    elements.pdvLabel = document.getElementById('pdv-name-label');
    elements.selectedInfo = document.getElementById('pdv-selected-info');
    elements.searchInput = document.getElementById('pdv-product-search');
    elements.searchResults = document.getElementById('pdv-product-results');
    elements.selectedImage = document.getElementById('pdv-selected-image');
    elements.selectedPlaceholder = document.getElementById('pdv-selected-placeholder');
    elements.selectedName = document.getElementById('pdv-selected-name');
    elements.selectedSku = document.getElementById('pdv-selected-sku');
    elements.selectedPrice = document.getElementById('pdv-selected-price');
    elements.selectedOriginalPrice = document.getElementById('pdv-selected-original-price');
    elements.selectedPromoBadge = document.getElementById('pdv-selected-promo');
    elements.selectedGeneralWarning = document.getElementById('pdv-selected-general-warning');
    elements.itemValue = document.getElementById('pdv-item-value');
    elements.itemQuantity = document.getElementById('pdv-item-quantity');
    elements.itemTotal = document.getElementById('pdv-item-total');
    elements.addItem = document.getElementById('pdv-add-item');
    elements.quantityButtons = document.querySelectorAll('.quantity-button');
    elements.itemsList = document.getElementById('pdv-items-list');
    elements.itemsEmpty = document.getElementById('pdv-items-empty');
    elements.itemsCount = document.getElementById('pdv-items-count');
    elements.itemsTotal = document.getElementById('pdv-items-total');
    elements.finalizeButton = document.getElementById('pdv-finalize-sale');
    elements.caixaActions = document.getElementById('pdv-caixa-actions');
    elements.caixaDetails = document.getElementById('pdv-caixa-action-details');
    elements.caixaAmount = document.getElementById('pdv-action-amount');
    elements.caixaPayment = document.getElementById('pdv-opening-payment');
    elements.caixaMotivoWrapper = document.getElementById('pdv-caixa-motivo-wrapper');
    elements.caixaMotivo = document.getElementById('pdv-caixa-motivo');
    elements.caixaHint = document.getElementById('pdv-caixa-action-hint');
    elements.caixaConfirm = document.getElementById('pdv-caixa-action-confirm');
    elements.paymentList = document.getElementById('pdv-payment-list');
    elements.resetPayments = document.getElementById('pdv-reset-payments');
    elements.caixaStateLabel = document.getElementById('pdv-caixa-state-label');
    elements.summaryPrint = document.getElementById('pdv-summary-print');
    elements.summaryLastMove = document.getElementById('pdv-summary-last-move');
    elements.historyList = document.getElementById('pdv-history-list');
    elements.historyEmpty = document.getElementById('pdv-history-empty');
    elements.clearHistory = document.getElementById('pdv-clear-history');
  };

  const renderCompanyOptions = () => {
    if (!elements.companySelect) return;
    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione uma empresa';
    fragment.appendChild(placeholder);
    (state.dataset?.companies || []).forEach((company) => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = company.fantasyName || company.name;
      if (company.id === state.session.companyId) {
        option.selected = true;
      }
      fragment.appendChild(option);
    });
    elements.companySelect.innerHTML = '';
    elements.companySelect.appendChild(fragment);
  };

  const renderPdvOptions = () => {
    if (!elements.pdvSelect) return;
    const companyId = state.session.companyId;
    const pdvs = (state.dataset?.pdvs || []).filter((pdv) => pdv.companyId === companyId);
    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = pdvs.length ? 'Selecione um PDV' : 'Nenhum PDV disponível';
    fragment.appendChild(placeholder);
    pdvs.forEach((pdv) => {
      const option = document.createElement('option');
      option.value = pdv.id;
      option.textContent = pdv.name;
      if (pdv.id === state.session.pdvId) {
        option.selected = true;
      }
      fragment.appendChild(option);
    });
    elements.pdvSelect.innerHTML = '';
    elements.pdvSelect.appendChild(fragment);
    elements.pdvSelect.disabled = pdvs.length === 0;
  };

  const updateSelectionHint = () => {
    if (!elements.selectionHint) return;
    if (!state.session.companyId) {
      elements.selectionHint.textContent = 'Escolha a empresa para carregar os PDVs disponíveis.';
    } else if (!state.session.pdvId) {
      elements.selectionHint.textContent = 'Selecione um PDV para iniciar o caixa.';
    } else {
      elements.selectionHint.textContent = 'As operações serão salvas localmente para testes.';
    }
  };

  const updateWorkspaceVisibility = () => {
    const hasSelection = Boolean(state.session.companyId && state.session.pdvId);
    if (elements.emptyState) {
      elements.emptyState.classList.toggle('hidden', hasSelection);
    }
    if (elements.workspace) {
      elements.workspace.classList.toggle('hidden', !hasSelection);
    }
  };

  const updateSelectionLabels = () => {
    const company = findCompany(state.session.companyId);
    const pdv = findPdv(state.session.pdvId);
    if (elements.companyLabel) {
      elements.companyLabel.textContent = company?.fantasyName || company?.name || '—';
    }
    if (elements.pdvLabel) {
      elements.pdvLabel.textContent = pdv?.name || '—';
    }
    if (elements.selectedInfo) {
      if (!company || !pdv) {
        elements.selectedInfo.textContent = 'Configure o caixa para iniciar as vendas.';
      } else {
        const location = pdv.location ? ` • ${pdv.location}` : '';
        const doc = company.document ? ` (CNPJ: ${company.document})` : '';
        elements.selectedInfo.textContent = `${company.fantasyName || company.name}${location}${doc}`;
      }
    }
  };

  const clearSelectedProduct = () => {
    state.selectedProduct = null;
    state.quantity = 1;
    if (elements.selectedImage) {
      elements.selectedImage.src = '';
      elements.selectedImage.classList.add('hidden');
    }
    if (elements.selectedPlaceholder) {
      elements.selectedPlaceholder.classList.remove('hidden');
    }
    if (elements.selectedName) {
      elements.selectedName.textContent = 'Nenhum produto selecionado.';
    }
    if (elements.selectedSku) {
      elements.selectedSku.textContent = 'Escolha um item para visualizar os detalhes.';
    }
    if (elements.selectedPrice) {
      elements.selectedPrice.textContent = formatCurrency(0);
    }
    if (elements.selectedOriginalPrice) {
      elements.selectedOriginalPrice.classList.add('hidden');
    }
    if (elements.selectedPromoBadge) {
      elements.selectedPromoBadge.classList.add('hidden');
    }
    if (elements.selectedGeneralWarning) {
      elements.selectedGeneralWarning.classList.add('hidden');
    }
    if (elements.itemQuantity) {
      elements.itemQuantity.value = 1;
    }
    updateItemTotals();
  };

  const updateSelectedProductView = () => {
    const product = state.selectedProduct;
    if (!product) {
      clearSelectedProduct();
      return;
    }
    if (elements.selectedPlaceholder) {
      elements.selectedPlaceholder.classList.add('hidden');
    }
    if (elements.selectedImage) {
      if (product.photo) {
        elements.selectedImage.src = product.photo;
        elements.selectedImage.classList.remove('hidden');
      } else {
        elements.selectedImage.src = '';
        elements.selectedImage.classList.add('hidden');
      }
    }
    if (elements.selectedName) {
      elements.selectedName.textContent = product.name;
    }
    if (elements.selectedSku) {
      const meta = [product.sku ? `Cód.: ${product.sku}` : null, product.barcode ? `Barras: ${product.barcode}` : null]
        .filter(Boolean)
        .join(' • ');
      elements.selectedSku.textContent = meta || 'Detalhes indisponíveis para o item selecionado.';
    }
    if (elements.selectedPrice) {
      elements.selectedPrice.textContent = formatCurrency(product.price);
    }
    if (elements.itemQuantity) {
      elements.itemQuantity.value = state.quantity;
    }
    updateItemTotals();
  };

  const updateItemTotals = () => {
    const product = state.selectedProduct;
    const unitPrice = product ? safeNumber(product.price) : 0;
    const quantity = Math.max(1, Math.trunc(state.quantity));
    const total = unitPrice * quantity;
    if (elements.itemValue) {
      elements.itemValue.textContent = formatCurrency(unitPrice);
    }
    if (elements.itemTotal) {
      elements.itemTotal.textContent = formatCurrency(total);
    }
  };

  const renderSearchResults = () => {
    if (!elements.searchResults) return;
    elements.searchResults.innerHTML = '';
    if (!state.searchQuery) {
      elements.searchResults.classList.add('hidden');
      return;
    }
    if (!state.searchResults.length) {
      const empty = document.createElement('div');
      empty.className = 'px-4 py-3 text-sm text-gray-500';
      empty.textContent = 'Nenhum produto encontrado para a busca.';
      elements.searchResults.appendChild(empty);
      elements.searchResults.classList.remove('hidden');
      return;
    }
    const list = document.createElement('ul');
    list.className = 'divide-y divide-gray-100';
    state.searchResults.forEach((product) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.productId = product.id;
      button.className = 'flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-primary/5';
      const info = document.createElement('div');
      info.className = 'flex flex-col';
      const name = document.createElement('span');
      name.className = 'text-sm font-semibold text-gray-700';
      name.textContent = product.name;
      const meta = document.createElement('span');
      meta.className = 'text-xs text-gray-500';
      meta.textContent = [product.sku, product.barcode].filter(Boolean).join(' • ') || 'Detalhes indisponíveis';
      info.appendChild(name);
      info.appendChild(meta);
      const price = document.createElement('span');
      price.className = 'text-sm font-semibold text-gray-700';
      price.textContent = formatCurrency(product.price);
      button.appendChild(info);
      button.appendChild(price);
      item.appendChild(button);
      list.appendChild(item);
    });
    elements.searchResults.appendChild(list);
    elements.searchResults.classList.remove('hidden');
  };

  const handleSearch = (value) => {
    state.searchQuery = value.trim();
    if (!state.searchQuery) {
      state.searchResults = [];
      renderSearchResults();
      return;
    }
    const query = state.searchQuery.toLowerCase();
    state.searchResults = (state.dataset?.products || []).filter((product) => {
      const haystack = [product.name, product.sku, product.barcode]
        .filter(Boolean)
        .map((item) => item.toLowerCase());
      return haystack.some((item) => item.includes(query));
    });
    renderSearchResults();
  };

  const addItemToSale = () => {
    const product = state.selectedProduct;
    if (!product) {
      notify('Selecione um produto antes de adicionar à venda.', 'warning');
      return;
    }
    const quantity = Math.max(1, Math.trunc(state.quantity));
    const items = state.pdvSession.sale.items;
    const existing = items.find((item) => item.productId === product.id);
    if (existing) {
      existing.quantity += quantity;
      existing.total = existing.quantity * existing.unitPrice;
    } else {
      items.push({
        id: uuid(),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unitPrice: safeNumber(product.price),
        quantity,
        total: quantity * safeNumber(product.price)
      });
    }
    state.pdvSession.sale.lastSaleAt = new Date().toISOString();
    savePdvSession();
    renderSaleItems();
    clearSelectedProduct();
    notify('Item adicionado. Os dados ficam salvos localmente.', 'success');
  };

  const renderSaleItems = () => {
    const items = state.pdvSession?.sale?.items || [];
    const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);
    const totalValue = items.reduce((total, item) => total + item.total, 0);
    if (elements.itemsList) {
      elements.itemsList.innerHTML = '';
      if (!items.length) {
        elements.itemsList.classList.add('hidden');
      } else {
        items.forEach((item) => {
          const li = document.createElement('li');
          li.className = 'flex items-start justify-between gap-3 px-2 py-3';
          const info = document.createElement('div');
          info.className = 'flex-1';
          const title = document.createElement('p');
          title.className = 'text-sm font-semibold text-gray-700';
          title.textContent = item.name;
          const meta = document.createElement('p');
          meta.className = 'text-xs text-gray-500';
          meta.textContent = [`Qtd.: ${item.quantity}`, item.sku ? `Cód.: ${item.sku}` : null]
            .filter(Boolean)
            .join(' • ');
          info.appendChild(title);
          info.appendChild(meta);
          const actions = document.createElement('div');
          actions.className = 'flex flex-col items-end gap-2';
          const total = document.createElement('span');
          total.className = 'text-sm font-semibold text-gray-700';
          total.textContent = formatCurrency(item.total);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'text-xs font-semibold text-red-500 hover:text-red-600';
          remove.textContent = 'Remover';
          remove.dataset.removeItemId = item.id;
          actions.appendChild(total);
          actions.appendChild(remove);
          li.appendChild(info);
          li.appendChild(actions);
          elements.itemsList.appendChild(li);
        });
        elements.itemsList.classList.remove('hidden');
      }
    }
    if (elements.itemsEmpty) {
      elements.itemsEmpty.classList.toggle('hidden', items.length > 0);
    }
    if (elements.itemsCount) {
      elements.itemsCount.textContent = `${totalQuantity} item${totalQuantity === 1 ? '' : 's'}`;
    }
    if (elements.itemsTotal) {
      elements.itemsTotal.textContent = formatCurrency(totalValue);
    }
    if (elements.finalizeButton) {
      elements.finalizeButton.disabled = !items.length;
    }
  };

  const removeItemFromSale = (itemId) => {
    const items = state.pdvSession?.sale?.items || [];
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1) return;
    items.splice(index, 1);
    savePdvSession();
    renderSaleItems();
  };

  const caixaActions = [
    {
      id: 'abertura',
      label: 'Abertura de Caixa',
      icon: 'fa-door-open',
      requiresAmount: true,
      requiresMotivo: false,
      requiresPayment: true,
      hint: 'Informe o valor inicial do caixa para abrir o PDV.',
      isAvailable: (session) => !session.caixa.aberto
    },
    {
      id: 'entrada',
      label: 'Entrada',
      icon: 'fa-arrow-down',
      requiresAmount: true,
      requiresMotivo: true,
      requiresPayment: true,
      hint: 'Registre reforços de caixa e entradas extraordinárias.',
      isAvailable: (session) => session.caixa.aberto
    },
    {
      id: 'saida',
      label: 'Saída',
      icon: 'fa-arrow-up',
      requiresAmount: true,
      requiresMotivo: true,
      requiresPayment: true,
      hint: 'Use para registrar retiradas e sangrias.',
      isAvailable: (session) => session.caixa.aberto
    },
    {
      id: 'envio',
      label: 'Envio à Tesouraria',
      icon: 'fa-building-columns',
      requiresAmount: true,
      requiresMotivo: true,
      requiresPayment: true,
      hint: 'Registre os valores enviados para a tesouraria.',
      isAvailable: (session) => session.caixa.aberto
    },
    {
      id: 'fechamento',
      label: 'Fechamento de caixa',
      icon: 'fa-lock',
      requiresAmount: false,
      requiresMotivo: false,
      requiresPayment: false,
      hint: 'Finalize o caixa para encerrar o expediente.',
      isAvailable: (session) => session.caixa.aberto
    }
  ];

  const updateCaixaStatus = () => {
    const caixa = state.pdvSession.caixa;
    if (elements.statusBadge) {
      const open = caixa.aberto;
      elements.statusBadge.classList.toggle('border-green-200', open);
      elements.statusBadge.classList.toggle('bg-green-50', open);
      elements.statusBadge.classList.toggle('text-green-700', open);
      elements.statusBadge.classList.toggle('border-gray-200', !open);
      elements.statusBadge.classList.toggle('bg-gray-100', !open);
      elements.statusBadge.classList.toggle('text-gray-600', !open);
      elements.statusBadge.innerHTML = open
        ? '<i class="fas fa-lock-open"></i> Caixa aberto'
        : '<i class="fas fa-lock"></i> Caixa fechado';
    }
    if (elements.caixaStateLabel) {
      elements.caixaStateLabel.textContent = caixa.aberto ? 'Caixa aberto' : 'Caixa fechado';
    }
  };

  const renderCaixaActions = () => {
    if (!elements.caixaActions) return;
    elements.caixaActions.innerHTML = '';
    caixaActions
      .filter((action) => action.isAvailable(state.pdvSession))
      .forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.caixaAction = action.id;
        button.className = 'flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm hover:border-primary hover:bg-primary/5';
        const left = document.createElement('div');
        left.className = 'flex items-center gap-3';
        const icon = document.createElement('span');
        icon.className = 'flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary';
        icon.innerHTML = `<i class="fas ${action.icon}"></i>`;
        const info = document.createElement('div');
        info.className = 'flex flex-col';
        const title = document.createElement('span');
        title.className = 'text-sm font-semibold text-gray-700';
        title.textContent = action.label;
        const subtitle = document.createElement('span');
        subtitle.className = 'text-xs text-gray-500';
        subtitle.textContent = action.hint;
        info.appendChild(title);
        info.appendChild(subtitle);
        left.appendChild(icon);
        left.appendChild(info);
        const chevron = document.createElement('i');
        chevron.className = 'fas fa-chevron-right text-gray-400';
        button.appendChild(left);
        button.appendChild(chevron);
        elements.caixaActions.appendChild(button);
      });
    if (state.selectedAction) {
      const visible = caixaActions.some(
        (action) => action.id === state.selectedAction && action.isAvailable(state.pdvSession)
      );
      if (!visible) {
        hideCaixaDetails();
      }
    }
  };

  const showCaixaDetails = (actionId) => {
    const action = caixaActions.find((item) => item.id === actionId);
    if (!action) return;
    state.selectedAction = actionId;
    if (elements.caixaDetails) {
      elements.caixaDetails.classList.remove('hidden');
    }
    if (elements.caixaAmount) {
      elements.caixaAmount.value = '';
      elements.caixaAmount.disabled = !action.requiresAmount;
      elements.caixaAmount.placeholder = action.requiresAmount ? '0,00' : '—';
    }
    if (elements.caixaPayment) {
      updatePaymentSelect();
      elements.caixaPayment.disabled = !action.requiresPayment;
    }
    if (elements.caixaMotivoWrapper) {
      elements.caixaMotivoWrapper.classList.toggle('hidden', !action.requiresMotivo);
    }
    if (elements.caixaMotivo) {
      elements.caixaMotivo.value = '';
    }
    if (elements.caixaHint) {
      elements.caixaHint.textContent = action.hint;
    }
  };

  const hideCaixaDetails = () => {
    state.selectedAction = null;
    if (elements.caixaDetails) {
      elements.caixaDetails.classList.add('hidden');
    }
  };

  const updatePaymentSelect = () => {
    if (!elements.caixaPayment) return;
    elements.caixaPayment.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione um meio de pagamento';
    elements.caixaPayment.appendChild(placeholder);
    (state.dataset?.paymentMethods || [])
      .slice()
      .sort((a, b) => {
        const typeDiff =
          (paymentTypeOrder[a.type] ?? Number.MAX_SAFE_INTEGER) -
          (paymentTypeOrder[b.type] ?? Number.MAX_SAFE_INTEGER);
        if (typeDiff !== 0) return typeDiff;
        return a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' });
      })
      .forEach((method) => {
        const option = document.createElement('option');
        option.value = method.id;
        option.textContent = method.label;
        elements.caixaPayment.appendChild(option);
      });
  };

  const renderPayments = () => {
    if (!elements.paymentList) return;
    elements.paymentList.innerHTML = '';
    const totals = state.pdvSession.caixa.paymentTotals || {};
    (state.dataset?.paymentMethods || []).forEach((method) => {
      const value = safeNumber(totals[method.id]);
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm';
      const info = document.createElement('div');
      info.className = 'flex flex-col';
      const title = document.createElement('span');
      title.className = 'font-semibold text-gray-700';
      title.textContent = method.label;
      const meta = document.createElement('span');
      meta.className = 'text-xs text-gray-500';
      meta.textContent = `Tipo: ${method.type || '—'}`;
      info.appendChild(title);
      info.appendChild(meta);
      const valueLabel = document.createElement('span');
      valueLabel.className = 'text-sm font-semibold text-gray-700';
      valueLabel.textContent = formatCurrency(value);
      li.appendChild(info);
      li.appendChild(valueLabel);
      elements.paymentList.appendChild(li);
    });
  };

  const updateSummaryPrint = () => {
    if (!elements.summaryPrint) return;
    const caixa = state.pdvSession.caixa;
    const abertura = safeNumber(caixa.aberturaValor);
    const saldo = safeNumber(caixa.saldo);
    const recebidos = Object.values(caixa.paymentTotals || {}).reduce((total, value) => total + safeNumber(value), 0);
    const lines = [
      'RESUMO FINANCEIRO DO PDV',
      formatDate(new Date()),
      '',
      formatLine('Abertura', formatCurrency(abertura)),
      formatLine('Recebido', formatCurrency(recebidos)),
      formatLine('Saldo', formatCurrency(saldo)),
      '',
      'Pagamentos: '
    ];
    (state.dataset?.paymentMethods || []).forEach((method) => {
      const value = safeNumber(caixa.paymentTotals?.[method.id]);
      lines.push(formatLine(`• ${method.label}`, formatCurrency(value)));
    });
    elements.summaryPrint.textContent = lines.join(String.fromCharCode(10));
  };

  const updateSummaryLastMove = () => {
    if (!elements.summaryLastMove) return;
    const last = (state.pdvSession.caixa.history || []).slice(-1)[0];
    if (!last) {
      elements.summaryLastMove.textContent = 'Nenhuma movimentação registrada.';
      return;
    }
    const action = caixaActions.find((item) => item.id === last.actionId);
    const method = last.paymentMethodId ? findPaymentMethod(last.paymentMethodId) : null;
    const parts = [
      `${action?.label || 'Movimentação'} em ${formatDateTime(last.createdAt)}`,
      `Valor: ${formatCurrency(last.amount)}`
    ];
    if (method) {
      parts.push(`Meio: ${method.label}`);
    }
    if (last.motivo) {
      parts.push(`Motivo: ${last.motivo}`);
    }
    elements.summaryLastMove.textContent = parts.join(' • ');
  };

  const renderHistory = () => {
    if (!elements.historyList) return;
    const history = state.pdvSession.caixa.history || [];
    elements.historyList.innerHTML = '';
    if (!history.length) {
      if (elements.historyEmpty) {
        elements.historyEmpty.classList.remove('hidden');
        elements.historyList.appendChild(elements.historyEmpty);
      }
      return;
    }
    if (elements.historyEmpty) {
      elements.historyEmpty.classList.add('hidden');
    }
    history
      .slice()
      .reverse()
      .forEach((entry) => {
        const item = document.createElement('li');
        item.className = 'rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-700';
        const action = caixaActions.find((act) => act.id === entry.actionId);
        const method = entry.paymentMethodId ? findPaymentMethod(entry.paymentMethodId) : null;
        const lines = [
          `${action?.label || 'Movimentação'} • ${formatDateTime(entry.createdAt)} • ${formatCurrency(entry.amount)}`
        ];
        if (method) {
          lines.push(`Meio de pagamento: ${method.label}`);
        }
        if (entry.motivo) {
          lines.push(`Motivo: ${entry.motivo}`);
        }
        item.innerHTML = lines.map((line) => `<p>${line}</p>`).join('');
        elements.historyList.appendChild(item);
      });
  };

  const resetPayments = () => {
    state.pdvSession.caixa.paymentTotals = {};
    savePdvSession();
    renderPayments();
    updateSummaryPrint();
    notify('Valores zerados. Ajuste disponível apenas no ambiente local.', 'info');
  };

  const clearHistory = () => {
    state.pdvSession.caixa.history = [];
    state.pdvSession.caixa.saldo = state.pdvSession.caixa.aberturaValor || 0;
    savePdvSession();
    renderHistory();
    updateSummaryLastMove();
    updateSummaryPrint();
    notify('Histórico limpo localmente.', 'info');
  };

  const applyCaixaAction = () => {
    if (!state.selectedAction) {
      notify('Selecione uma ação para continuar.', 'warning');
      return;
    }
    const action = caixaActions.find((item) => item.id === state.selectedAction);
    if (!action) return;
    const amount = action.requiresAmount ? safeNumber(elements.caixaAmount?.value) : 0;
    if (action.requiresAmount && amount <= 0) {
      notify('Informe um valor válido para a operação.', 'warning');
      return;
    }
    const paymentMethodId = action.requiresPayment ? elements.caixaPayment?.value : '';
    if (action.requiresPayment && !paymentMethodId) {
      notify('Selecione um meio de pagamento.', 'warning');
      return;
    }
    const motivo = action.requiresMotivo ? elements.caixaMotivo?.value.trim() : '';
    if (action.requiresMotivo && !motivo) {
      notify('Informe o motivo da movimentação.', 'warning');
      return;
    }
    const caixa = state.pdvSession.caixa;
    const now = new Date().toISOString();
    const entry = {
      id: uuid(),
      actionId: action.id,
      createdAt: now,
      amount: action.id === 'saida' || action.id === 'envio' ? -amount : amount,
      paymentMethodId,
      motivo
    };
    switch (action.id) {
      case 'abertura':
        caixa.aberto = true;
        caixa.aberturaValor = amount;
        caixa.aberturaData = now;
        caixa.saldo = amount;
        caixa.paymentTotals = { ...caixa.paymentTotals, [paymentMethodId]: amount };
        break;
      case 'entrada':
        caixa.saldo += amount;
        caixa.paymentTotals[paymentMethodId] = safeNumber(caixa.paymentTotals[paymentMethodId]) + amount;
        break;
      case 'saida':
      case 'envio':
        caixa.saldo -= amount;
        caixa.paymentTotals[paymentMethodId] = safeNumber(caixa.paymentTotals[paymentMethodId]) - amount;
        break;
      case 'fechamento':
        caixa.aberto = false;
        caixa.fechamentoData = now;
        break;
      default:
        break;
    }
    caixa.history.push(entry);
    savePdvSession();
    hideCaixaDetails();
    renderCaixaActions();
    renderPayments();
    renderHistory();
    updateSummaryLastMove();
    updateSummaryPrint();
    updateCaixaStatus();
    notify(`${action.label} registrada localmente.`, 'success');
  };

  const finalizeSale = () => {
    const items = state.pdvSession.sale.items || [];
    if (!items.length) {
      notify('Adicione itens antes de finalizar a venda.', 'warning');
      return;
    }
    if (!state.pdvSession.caixa.aberto) {
      notify('Abra o caixa antes de registrar uma venda.', 'warning');
      return;
    }
    const total = items.reduce((sum, item) => sum + item.total, 0);
    const methods = state.dataset?.paymentMethods || [];
    const defaultMethod = methods[0];
    if (!defaultMethod) {
      notify('Cadastre um meio de pagamento para registrar a venda.', 'error');
      return;
    }
    let chosen = defaultMethod.id;
    if (methods.length > 1) {
      const hint = methods
        .map((method) => `${method.id} - ${method.label}`)
        .join(String.fromCharCode(10));
      const input = window.prompt(
        `Informe o identificador do meio de pagamento utilizado:\n${hint}`,
        defaultMethod.id
      );
      if (input && findPaymentMethod(input.trim())) {
        chosen = input.trim();
      }
    }
    state.pdvSession.caixa.paymentTotals[chosen] =
      safeNumber(state.pdvSession.caixa.paymentTotals[chosen]) + total;
    state.pdvSession.caixa.saldo += total;
    state.pdvSession.caixa.history.push({
      id: uuid(),
      actionId: 'venda',
      createdAt: new Date().toISOString(),
      amount: total,
      paymentMethodId: chosen,
      motivo: 'Venda registrada pela tela do PDV (teste local)'
    });
    state.pdvSession.sale.items = [];
    state.pdvSession.sale.lastSaleAt = new Date().toISOString();
    savePdvSession();
    renderSaleItems();
    renderPayments();
    renderHistory();
    updateSummaryPrint();
    updateSummaryLastMove();
    notify('Venda registrada localmente.', 'success');
  };

  const bindEvents = () => {
    elements.companySelect?.addEventListener('change', (event) => {
      state.session.companyId = event.target.value;
      state.session.pdvId = '';
      state.pdvSession = null;
      saveSession();
      renderCompanyOptions();
      renderPdvOptions();
      updateSelectionHint();
      updateWorkspaceVisibility();
      updateSelectionLabels();
      clearSelectedProduct();
      renderSaleItems();
    });

    elements.pdvSelect?.addEventListener('change', (event) => {
      state.session.pdvId = event.target.value;
      saveSession();
      state.pdvSession = state.session.pdvId ? loadPdvSession(state.session.pdvId) : null;
      updateWorkspaceVisibility();
      updateSelectionLabels();
      updateSelectionHint();
      if (state.pdvSession) {
        renderSaleItems();
        renderCaixaActions();
        updateCaixaStatus();
        renderPayments();
        renderHistory();
        updateSummaryLastMove();
        updateSummaryPrint();
      }
    });

    elements.searchInput?.addEventListener('input', (event) => {
      handleSearch(event.target.value);
    });

    elements.searchResults?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-product-id]');
      if (!button) return;
      const product = (state.dataset?.products || []).find((item) => item.id === button.dataset.productId);
      if (!product) return;
      state.selectedProduct = product;
      state.quantity = 1;
      updateSelectedProductView();
      elements.searchResults.classList.add('hidden');
    });

    elements.quantityButtons?.forEach((button) => {
      button.addEventListener('click', () => {
        const change = safeNumber(button.dataset.quantityChange, 0);
        state.quantity = Math.max(1, Math.trunc(state.quantity + change));
        if (elements.itemQuantity) {
          elements.itemQuantity.value = state.quantity;
        }
        updateItemTotals();
      });
    });

    elements.itemQuantity?.addEventListener('input', (event) => {
      const value = Math.max(1, Math.trunc(safeNumber(event.target.value, 1)));
      state.quantity = value;
      event.target.value = value;
      updateItemTotals();
    });

    elements.addItem?.addEventListener('click', addItemToSale);

    elements.itemsList?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-remove-item-id]');
      if (!button) return;
      removeItemFromSale(button.dataset.removeItemId);
    });

    elements.finalizeButton?.addEventListener('click', finalizeSale);

    elements.caixaActions?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-caixa-action]');
      if (!button) return;
      showCaixaDetails(button.dataset.caixaAction);
    });

    elements.caixaConfirm?.addEventListener('click', applyCaixaAction);

    elements.resetPayments?.addEventListener('click', resetPayments);

    elements.clearHistory?.addEventListener('click', clearHistory);

    document.addEventListener('click', (event) => {
      if (!elements.searchResults) return;
      if (elements.searchResults.contains(event.target) || elements.searchInput?.contains(event.target)) {
        return;
      }
      elements.searchResults.classList.add('hidden');
    });
  };

  const hydrate = () => {
    state.dataset = loadDataset();
    state.session = loadSession();
    if (state.session.companyId && !findCompany(state.session.companyId)) {
      state.session.companyId = '';
    }
    if (state.session.pdvId && !findPdv(state.session.pdvId)) {
      state.session.pdvId = '';
    }
    if (state.session.pdvId) {
      state.pdvSession = loadPdvSession(state.session.pdvId);
    }
    renderCompanyOptions();
    renderPdvOptions();
    updateSelectionHint();
    updateWorkspaceVisibility();
    updateSelectionLabels();
    clearSelectedProduct();
    if (state.pdvSession) {
      renderSaleItems();
      renderCaixaActions();
      updateCaixaStatus();
      renderPayments();
      renderHistory();
      updateSummaryLastMove();
      updateSummaryPrint();
    }
  };

  const init = () => {
    if (!isBrowser) return;
    document.addEventListener('DOMContentLoaded', () => {
      queryElements();
      bindEvents();
      hydrate();
    });
  };

  init();
})();
