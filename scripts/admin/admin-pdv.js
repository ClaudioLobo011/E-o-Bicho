(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const SERVER_URL =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.SERVER_URL) || '';

  const paymentTypeOrder = {
    avista: 0,
    debito: 1,
    credito: 2,
  };

  const caixaActions = [
    {
      id: 'abertura',
      label: 'Abertura de Caixa',
      icon: 'fa-door-open',
      requiresMotivo: false,
      requiresAmount: false,
      affectsPayments: false,
      hint:
        'Informe os valores iniciais nos meios de pagamento abaixo e abra o caixa.',
      isAvailable: (state) => !state.caixaAberto,
      successMessage: 'Caixa aberto com sucesso.',
    },
    {
      id: 'entrada',
      label: 'Entrada',
      icon: 'fa-arrow-down',
      requiresMotivo: true,
      requiresAmount: true,
      affectsPayments: true,
      hint: 'Use esta opção para registrar reforços de caixa e entradas extraordinárias.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Entrada registrada no caixa.',
    },
    {
      id: 'saida',
      label: 'Saída',
      icon: 'fa-arrow-up',
      requiresMotivo: true,
      requiresAmount: true,
      affectsPayments: true,
      hint: 'Registre retiradas ou sangrias informando o motivo.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Saída registrada no caixa.',
    },
    {
      id: 'envio',
      label: 'Envio à Tesouraria',
      icon: 'fa-building-columns',
      requiresMotivo: true,
      requiresAmount: true,
      affectsPayments: true,
      hint: 'Informe o valor enviado e descreva o motivo do envio.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Envio registrado no caixa.',
    },
    {
      id: 'fechamento',
      label: 'Fechamento de caixa',
      icon: 'fa-lock',
      requiresMotivo: false,
      requiresAmount: false,
      affectsPayments: false,
      hint: 'Finalize o caixa após conferir os valores registrados.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Caixa fechado.',
    },
  ];

  const state = {
    stores: [],
    pdvs: [],
    selectedStore: '',
    selectedPdv: '',
    caixaAberto: false,
    allowApuradoEdit: false,
    selectedAction: null,
    searchResults: [],
    selectedProduct: null,
    quantidade: 1,
    itens: [],
    vendaCliente: null,
    vendaPet: null,
    paymentMethods: [],
    paymentMethodsLoading: false,
    pendingPagamentosData: null,
    pagamentos: [],
    vendaPagamentos: [],
    vendaDesconto: 0,
    vendaAcrescimo: 0,
    customerSearchResults: [],
    customerSearchLoading: false,
    customerSearchQuery: '',
    customerPets: [],
    customerPetsLoading: false,
    modalSelectedCliente: null,
    modalSelectedPet: null,
    modalActiveTab: 'cliente',
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
    lastMovement: null,
    searchController: null,
  };

  const elements = {};
  const customerPetsCache = new Map();
  let searchTimeout = null;
  let customerSearchTimeout = null;
  let customerSearchController = null;
  let customerPetsController = null;
  let paymentModalState = null;

  const createUid = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const notify = (message, type = 'info') => {
    if (typeof window?.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    if (typeof window?.showModal === 'function') {
      window.showModal({
        title: type === 'error' ? 'Erro' : 'Aviso',
        message,
        confirmText: 'OK',
      });
      return;
    }
    window.alert(message);
  };

  const getToken = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token do usuário logado.', error);
      return '';
    }
  };

  const formatCurrency = (value) => {
    const number = Number(value || 0);
    return `R$ ${number.toFixed(2).replace('.', ',')}`;
  };

  const safeNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };

  const canApplyGeneralPromotion = () => Boolean(state.vendaCliente);

  const hasGeneralPromotion = (product) =>
    Boolean(product?.promocao?.ativa && safeNumber(product.promocao.porcentagem) > 0);

  const buildProductSnapshot = (product) => {
    if (!product || typeof product !== 'object') return {};
    return {
      _id: product._id || product.id || '',
      nome: product.nome || product.descricao || '',
      codigoInterno: product.codigoInterno || product.codInterno || '',
      codigo:
        product.codigo ||
        product.codigoReferencia ||
        product.sku ||
        product.codigoInterno ||
        product.codInterno ||
        '',
      codigoBarras:
        product.codigoBarras ||
        product.codigoDeBarras ||
        product.barras ||
        product.ean ||
        '',
      promocao: product.promocao ? { ...product.promocao } : null,
      precoClube: product.precoClube || null,
      venda: product.venda,
      precoVenda: product.precoVenda,
      preco: product.preco,
      valor: product.valor,
      price: product.price,
    };
  };

  const parseDateValue = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const getStoreLabel = () => {
    const store = state.stores.find((item) => item._id === state.selectedStore);
    return (
      store?.nome ||
      store?.nomeFantasia ||
      store?.razaoSocial ||
      store?.razao ||
      store?.fantasia ||
      '—'
    );
  };

  const getPdvLabel = () => {
    const pdv = state.pdvs.find((item) => item._id === state.selectedPdv);
    return pdv?.nome || pdv?.codigo || pdv?.identificador || pdv?._id || '—';
  };

  const formatPrintLine = (label, value, width = 58) => {
    const left = String(label ?? '').trim();
    const right = String(value ?? '').trim();
    const space = Math.max(width - left.length - right.length - 2, 2);
    const filler = '-'.repeat(space);
    return `${left} ${filler} ${right}`;
  };

  const clonePayments = (payments) =>
    Array.isArray(payments) ? payments.map((item) => ({ ...item })) : [];

  const sumPayments = (payments) =>
    Array.isArray(payments)
      ? payments.reduce((total, payment) => total + safeNumber(payment?.valor), 0)
      : 0;

  const describePaymentValues = (payments) =>
    (Array.isArray(payments) ? payments : [])
      .filter((payment) => safeNumber(payment?.valor) > 0)
      .map((payment) => `${payment.label || 'Pagamento'} ${formatCurrency(payment.valor)}`)
      .join(' | ');

  const toDateLabel = (isoString) => {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const normalizePaymentMethod = (method) => {
    if (!method) {
      return null;
    }
    const idSource =
      method._id || method.id || method.code || method.nome || method.name || method.label;
    const id = idSource ? String(idSource) : createUid();
    const label =
      method.name || method.nome || method.label || method.code || 'Meio de pagamento';
    const type = (method.type || 'avista').toLowerCase();
    const code = method.code ? String(method.code) : '';
    const rawInstallments = Array.isArray(method.installmentConfigurations)
      ? method.installmentConfigurations
      : [];
    const installmentConfigurations = rawInstallments
      .map((config) => ({
        number:
          Number(
            config?.number ?? config?.installment ?? config?.parcelas ?? config?.parcela ?? 0
          ) || 0,
        discount: safeNumber(config?.discount ?? config?.desconto ?? 0),
        days: safeNumber(config?.days ?? config?.prazo ?? config?.dias ?? method?.days ?? 0),
      }))
      .filter((config) => Number.isFinite(config.number) && config.number >= 1)
      .sort((a, b) => a.number - b.number);
    let installments = installmentConfigurations.map((config) => config.number);
    if (!installments.length) {
      const total = Number(method.installments) || 0;
      if (total > 0) {
        installments = Array.from({ length: total }, (_, index) => index + 1);
      } else {
        installments = [1];
      }
    }
    const uniqueInstallments = Array.from(
      new Set(
        installments
          .map((value) => Number(value) || 0)
          .filter((value) => Number.isFinite(value) && value >= 1)
      )
    ).sort((a, b) => a - b);
    const aliases = Array.from(
      new Set(
        [
          id,
          code,
          label,
          method.nome,
          method.name,
          method.label,
          method.codigo,
          method.slug,
          method.tipo,
          method.type,
        ]
          .filter(Boolean)
          .map((value) => String(value))
      )
    );
    return {
      id,
      label,
      type,
      code,
      installments: uniqueInstallments,
      installmentConfigurations,
      aliases,
      raw: method,
    };
  };

  const extractPaymentAmount = (value) => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' || typeof value === 'string') {
      return safeNumber(value);
    }
    if (typeof value === 'object') {
      if ('valor' in value) return extractPaymentAmount(value.valor);
      if ('value' in value) return extractPaymentAmount(value.value);
      if ('amount' in value) return extractPaymentAmount(value.amount);
      if ('total' in value) return extractPaymentAmount(value.total);
      if ('saldo' in value) return extractPaymentAmount(value.saldo);
    }
    return 0;
  };

  const buildPaymentValuesMap = (data) => {
    const map = new Map();
    const register = (key, amount) => {
      if (key === undefined || key === null) return;
      const normalizedKey = String(key).trim();
      if (!normalizedKey) return;
      const value = safeNumber(amount);
      map.set(normalizedKey, value);
      map.set(normalizedKey.toLowerCase(), value);
    };
    if (Array.isArray(data)) {
      data.forEach((item) => {
        const value = extractPaymentAmount(
          item?.valor ?? item?.value ?? item?.amount ?? item?.total ?? item?.saldo ?? item
        );
        [
          item?.id,
          item?._id,
          item?.code,
          item?.codigo,
          item?.label,
          item?.nome,
          item?.name,
          item?.tipo,
          item?.type,
          item?.payment,
          item?.forma,
        ].forEach((key) => register(key, value));
      });
    } else if (data && typeof data === 'object') {
      Object.entries(data).forEach(([key, rawValue]) => {
        const value = extractPaymentAmount(rawValue);
        register(key, value);
        if (rawValue && typeof rawValue === 'object') {
          [
            rawValue?.id,
            rawValue?._id,
            rawValue?.code,
            rawValue?.codigo,
            rawValue?.label,
            rawValue?.nome,
            rawValue?.name,
            rawValue?.tipo,
            rawValue?.type,
          ].forEach((nested) => register(nested, value));
        }
      });
    }
    return map;
  };

  const updatePaymentMethods = (methods) => {
    const normalized = Array.isArray(methods)
      ? methods
          .map((method) => normalizePaymentMethod(method))
          .filter(Boolean)
          .sort((a, b) => {
            const typeDiff =
              (paymentTypeOrder[a.type] ?? Number.MAX_SAFE_INTEGER) -
              (paymentTypeOrder[b.type] ?? Number.MAX_SAFE_INTEGER);
            if (typeDiff !== 0) return typeDiff;
            return a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' });
          })
      : [];
    const previousValues = new Map(
      state.pagamentos.map((item) => [item.id, safeNumber(item.valor)])
    );
    state.paymentMethods = normalized;
    state.pagamentos = normalized.map((method) => ({
      ...method,
      valor: previousValues.has(method.id) ? previousValues.get(method.id) : 0,
    }));
    renderSalePaymentMethods();
    if (state.pendingPagamentosData) {
      const pending = state.pendingPagamentosData;
      state.pendingPagamentosData = null;
      applyPagamentosData(pending);
      return;
    }
    renderPayments();
    updateSummary();
    populatePaymentSelect();
  };

  const applyPagamentosData = (data) => {
    if (!state.paymentMethods.length) {
      state.pendingPagamentosData = data;
      return;
    }
    const valuesMap = buildPaymentValuesMap(data);
    const updated = state.paymentMethods.map((method) => {
      const candidates = [method.id, method.code, method.label, ...(method.aliases || [])];
      let valor = 0;
      for (const candidate of candidates) {
        if (!candidate) continue;
        const key = String(candidate);
        if (valuesMap.has(key)) {
          valor = safeNumber(valuesMap.get(key));
          break;
        }
        const lower = key.toLowerCase();
        if (valuesMap.has(lower)) {
          valor = safeNumber(valuesMap.get(lower));
          break;
        }
      }
      return { ...method, valor };
    });
    state.pagamentos = updated;
    state.pendingPagamentosData = null;
    renderPayments();
    updateSummary();
    populatePaymentSelect();
  };

  const getProductCode = (product) => {
    return (
      product?.codigoInterno ||
      product?.codigo ||
      product?.codInterno ||
      product?.codigoReferencia ||
      product?.sku ||
      product?._id ||
      product?.id ||
      ''
    );
  };

  const getProductBarcode = (product) => {
    return (
      product?.codigoBarras ||
      product?.codigoDeBarras ||
      product?.barras ||
      product?.ean ||
      ''
    );
  };

  const getImageUrl = (product) => {
    const path =
      product?.imagemPrincipal ||
      product?.imagem ||
      product?.foto ||
      product?.capa ||
      '';
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const base = SERVER_URL.endsWith('/') ? SERVER_URL.slice(0, -1) : SERVER_URL;
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const getBasePrice = (product) => {
    return safeNumber(
      product?.venda ||
        product?.precoVenda ||
        product?.preco ||
        product?.price ||
        product?.valor ||
        0
    );
  };

  const getFinalPrice = (product) => {
    const base = getBasePrice(product);
    if (!product) return base;
    if (hasGeneralPromotion(product)) {
      if (!canApplyGeneralPromotion()) {
        return base;
      }
      const desconto = base * (safeNumber(product.promocao.porcentagem) / 100);
      return Math.max(base - desconto, 0);
    }
    if (product?.precoClube && safeNumber(product.precoClube) > 0 && product.precoClube < base) {
      return safeNumber(product.precoClube);
    }
    return base;
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

    elements.tabTriggers = document.querySelectorAll('.pdv-tab-trigger');
    elements.tabPanels = document.querySelectorAll('[data-tab-panel]');

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

    elements.customerOpenButton = document.getElementById('pdv-open-customer');
    elements.customerOpenButtonLabel = document.getElementById('pdv-open-customer-label');
    elements.customerSummaryEmpty = document.getElementById('pdv-customer-summary-empty');
    elements.customerSummaryInfo = document.getElementById('pdv-customer-summary-info');
    elements.customerName = document.getElementById('pdv-customer-name');
    elements.customerDoc = document.getElementById('pdv-customer-doc');
    elements.customerContact = document.getElementById('pdv-customer-contact');
    elements.customerPet = document.getElementById('pdv-customer-pet');
    elements.customerRemove = document.getElementById('pdv-customer-remove');

    elements.customerModal = document.getElementById('pdv-customer-modal');
    elements.customerModalClose = document.getElementById('pdv-customer-close');
    elements.customerModalBackdrop =
      elements.customerModal?.querySelector('[data-pdv-customer-dismiss]') || null;
    elements.customerTabButtons =
      elements.customerModal?.querySelectorAll('[data-pdv-customer-tab]') || [];
    elements.customerModalPanels =
      elements.customerModal?.querySelectorAll('[data-pdv-customer-panel]') || [];
    elements.customerSearchInput = document.getElementById('pdv-customer-search');
    elements.customerResultsList = document.getElementById('pdv-customer-results');
    elements.customerResultsEmpty = document.getElementById('pdv-customer-results-empty');
    elements.customerResultsLoading = document.getElementById('pdv-customer-results-loading');
    elements.customerPetsList = document.getElementById('pdv-customer-pets');
    elements.customerPetsEmpty = document.getElementById('pdv-customer-pets-empty');
    elements.customerPetsLoading = document.getElementById('pdv-customer-pets-loading');
    elements.customerConfirm = document.getElementById('pdv-customer-confirm');
    elements.customerClear = document.getElementById('pdv-customer-clear');
    elements.customerCancel = document.getElementById('pdv-customer-cancel');

    elements.caixaActions = document.getElementById('pdv-caixa-actions');
    elements.caixaStateLabel = document.getElementById('pdv-caixa-state-label');
    elements.actionDetails = document.getElementById('pdv-caixa-action-details');
    elements.actionValuesWrapper = document.getElementById('pdv-action-values-wrapper');
    elements.actionAmount = document.getElementById('pdv-action-amount');
    elements.paymentSelect = document.getElementById('pdv-opening-payment');
    elements.motivoWrapper = document.getElementById('pdv-caixa-motivo-wrapper');
    elements.motivoInput = document.getElementById('pdv-caixa-motivo');
    elements.actionHint = document.getElementById('pdv-caixa-action-hint');
    elements.actionConfirm = document.getElementById('pdv-caixa-action-confirm');

    elements.paymentList = document.getElementById('pdv-payment-list');
    elements.resetPayments = document.getElementById('pdv-reset-payments');

    elements.summaryPrint = document.getElementById('pdv-summary-print');
    elements.summaryLastMove = document.getElementById('pdv-summary-last-move');

    elements.historyList = document.getElementById('pdv-history-list');
    elements.historyEmpty = document.getElementById('pdv-history-empty');
    elements.clearHistory = document.getElementById('pdv-clear-history');

    elements.finalizeModal = document.getElementById('pdv-finalize-modal');
    elements.finalizeClose = document.getElementById('pdv-finalize-close');
    elements.finalizeBack = document.getElementById('pdv-sale-back');
    elements.finalizeConfirm = document.getElementById('pdv-sale-confirm');
    elements.finalizeDifference = document.getElementById('pdv-sale-difference');
    elements.finalizeBackdrop = elements.finalizeModal?.querySelector('[data-pdv-finalize-dismiss]') || null;
    elements.saleMethods = document.getElementById('pdv-sale-methods');
    elements.salePaymentsList = document.getElementById('pdv-sale-payments-preview');
    elements.salePaymentsEmpty = document.getElementById('pdv-sale-payments-empty');
    elements.saleTotal = document.getElementById('pdv-sale-total');
    elements.saleDiscount = document.getElementById('pdv-sale-discount');
    elements.salePaid = document.getElementById('pdv-sale-paid');
    elements.saleAdjust = document.getElementById('pdv-sale-adjust');
    elements.saleItemAdjust = document.getElementById('pdv-sale-item-adjust');

    elements.paymentValueModal = document.getElementById('pdv-payment-value-modal');
    elements.paymentValueTitle = document.getElementById('pdv-payment-value-title');
    elements.paymentValueSubtitle = document.getElementById('pdv-payment-value-subtitle');
    elements.paymentValueInput = document.getElementById('pdv-payment-value-input');
    elements.paymentValueHint = document.getElementById('pdv-payment-value-hint');
    elements.paymentValueConfirm = document.getElementById('pdv-payment-value-confirm');
    elements.paymentValueCancel = document.getElementById('pdv-payment-value-cancel');
    elements.paymentValueBackdrop = elements.paymentValueModal?.querySelector('[data-pdv-payment-dismiss]') || null;
  };
  const updateWorkspaceVisibility = (visible) => {
    if (elements.workspace) {
      elements.workspace.classList.toggle('hidden', !visible);
    }
    if (elements.emptyState) {
      elements.emptyState.classList.toggle('hidden', visible);
    }
  };

  const setActiveTab = (targetId) => {
    if (targetId === 'pdv-tab' && !state.caixaAberto) {
      targetId = 'caixa-tab';
    }
    if (!elements.tabTriggers || !elements.tabPanels) return;
    elements.tabTriggers.forEach((trigger) => {
      const target = trigger.getAttribute('data-tab-target');
      const isActive = target === targetId;
      trigger.classList.toggle('text-primary', isActive);
      trigger.classList.toggle('border-primary', isActive);
      trigger.classList.toggle('border-transparent', !isActive);
      trigger.classList.toggle('text-gray-500', !isActive);
    });
    elements.tabPanels.forEach((panel) => {
      const panelId = panel.getAttribute('data-tab-panel');
      panel.classList.toggle('hidden', panelId !== targetId);
    });
  };

  const updateTabAvailability = () => {
    if (!elements.tabTriggers) return;
    elements.tabTriggers.forEach((trigger) => {
      const target = trigger.getAttribute('data-tab-target');
      if (target !== 'pdv-tab') return;
      const disabled = !state.caixaAberto;
      trigger.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      trigger.tabIndex = disabled ? -1 : 0;
      trigger.classList.toggle('cursor-not-allowed', disabled);
      trigger.classList.toggle('opacity-60', disabled);
      trigger.classList.toggle('hover:text-primary', !disabled);
    });
  };

  const updateStatusBadge = () => {
    if (!elements.statusBadge) return;
    const badge = elements.statusBadge;
    badge.classList.remove(
      'border-gray-200',
      'bg-gray-100',
      'text-gray-600',
      'border-emerald-200',
      'bg-emerald-50',
      'text-emerald-700'
    );
    const icon = state.caixaAberto ? 'fa-unlock' : 'fa-lock';
    const text = state.caixaAberto ? 'Caixa aberto' : 'Caixa fechado';
    if (state.caixaAberto) {
      badge.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
    } else {
      badge.classList.add('border-gray-200', 'bg-gray-100', 'text-gray-600');
    }
    badge.innerHTML = `<i class="fas ${icon}"></i> ${text}`;
    if (elements.caixaStateLabel) {
      elements.caixaStateLabel.textContent = text;
    }
    if (elements.selectedInfo) {
      elements.selectedInfo.textContent = state.caixaAberto
        ? 'Caixa aberto e pronto para registrar vendas.'
        : 'Abra o caixa para iniciar as vendas.';
    }
    updateFinalizeButton();
  };

  const updateWorkspaceInfo = () => {
    if (elements.companyLabel) {
      const label = getStoreLabel();
      elements.companyLabel.textContent = label === '—' ? '—' : label;
    }
    if (elements.pdvLabel) {
      const label = getPdvLabel();
      elements.pdvLabel.textContent = label === '—' ? '—' : label;
    }
  };

  const clearSelectedProduct = () => {
    state.selectedProduct = null;
    state.quantidade = 1;
    if (elements.selectedImage) {
      elements.selectedImage.classList.add('hidden');
      elements.selectedImage.src = '';
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
    const imageUrl = getImageUrl(product);
    if (imageUrl && elements.selectedImage) {
      elements.selectedImage.src = imageUrl;
      elements.selectedImage.classList.remove('hidden');
      elements.selectedPlaceholder?.classList.add('hidden');
    } else if (elements.selectedPlaceholder) {
      elements.selectedPlaceholder.classList.remove('hidden');
      elements.selectedImage?.classList.add('hidden');
    }
    const name = product?.nome || product?.descricao || 'Produto sem nome';
    const code = getProductCode(product);
    const barcode = getProductBarcode(product);
    const basePrice = getBasePrice(product);
    const finalPrice = getFinalPrice(product);
    const generalPromo = hasGeneralPromotion(product);
    const showGeneralWarning = generalPromo && !canApplyGeneralPromotion();
    if (elements.selectedName) {
      elements.selectedName.textContent = name;
    }
    if (elements.selectedSku) {
      const info = [code ? `Cód.: ${code}` : null, barcode ? `Barras: ${barcode}` : null]
        .filter(Boolean)
        .join(' • ');
      elements.selectedSku.textContent = info || 'Detalhes indisponíveis para o item selecionado.';
    }
    if (elements.selectedPrice) {
      elements.selectedPrice.textContent = formatCurrency(finalPrice);
    }
    if (elements.selectedOriginalPrice) {
      if (finalPrice < basePrice) {
        elements.selectedOriginalPrice.textContent = formatCurrency(basePrice);
        elements.selectedOriginalPrice.classList.remove('hidden');
      } else {
        elements.selectedOriginalPrice.classList.add('hidden');
      }
    }
    if (elements.selectedPromoBadge) {
      if (generalPromo) {
        elements.selectedPromoBadge.textContent = 'Promoção geral';
      } else {
        elements.selectedPromoBadge.textContent = 'Promoção ativa';
      }
      elements.selectedPromoBadge.classList.toggle('hidden', !(finalPrice < basePrice));
    }
    if (elements.selectedGeneralWarning) {
      elements.selectedGeneralWarning.classList.toggle('hidden', !showGeneralWarning);
    }
    if (elements.itemQuantity) {
      elements.itemQuantity.value = state.quantidade;
    }
    updateItemTotals();
  };

  const updateItemTotals = () => {
    const product = state.selectedProduct;
    const quantidade = Math.max(1, Math.trunc(state.quantidade));
    const unitPrice = product ? getFinalPrice(product) : 0;
    const total = unitPrice * quantidade;
    if (elements.itemValue) {
      elements.itemValue.textContent = formatCurrency(unitPrice);
    }
    if (elements.itemTotal) {
      elements.itemTotal.textContent = formatCurrency(total);
    }
  };

  const updateSaleCustomerSummary = () => {
    if (elements.customerOpenButtonLabel) {
      elements.customerOpenButtonLabel.textContent = state.vendaCliente
        ? 'Trocar cliente'
        : 'Adicionar cliente';
    }
    const hasCustomer = Boolean(state.vendaCliente);
    if (elements.customerSummaryEmpty) {
      elements.customerSummaryEmpty.classList.toggle('hidden', hasCustomer);
    }
    if (elements.customerSummaryInfo) {
      elements.customerSummaryInfo.classList.toggle('hidden', !hasCustomer);
    }
    if (!hasCustomer) {
      if (elements.customerPet) {
        elements.customerPet.classList.add('hidden');
      }
      return;
    }
    const cliente = state.vendaCliente;
    if (elements.customerName) {
      elements.customerName.textContent = cliente.nome || 'Cliente sem nome';
    }
    if (elements.customerDoc) {
      const doc = cliente.doc || cliente.cpf || cliente.cnpj || cliente.inscricaoEstadual || '';
      elements.customerDoc.textContent = doc ? `Documento: ${doc}` : 'Documento não informado';
    }
    if (elements.customerContact) {
      const contacts = [cliente.email, cliente.celular].filter(Boolean);
      elements.customerContact.textContent = contacts.length
        ? `Contato: ${contacts.join(' • ')}`
        : 'Contato não informado';
    }
    if (elements.customerPet) {
      if (state.vendaPet) {
        const details = [state.vendaPet.tipo, state.vendaPet.raca].filter(Boolean).join(' • ');
        const detailText = details ? ` (${details})` : '';
        elements.customerPet.textContent = `Pet: ${state.vendaPet.nome || 'Pet sem nome'}${detailText}`;
        elements.customerPet.classList.remove('hidden');
      } else {
        elements.customerPet.classList.add('hidden');
      }
    }
  };

  const recalculateItemsForCustomerChange = () => {
    if (!state.itens.length) {
      updateFinalizeButton();
      updateSaleSummary();
      return;
    }
    state.itens = state.itens.map((item) => {
      if (!item.productSnapshot) {
        return {
          ...item,
          generalPromo: Boolean(item.generalPromo && state.vendaCliente),
        };
      }
      const snapshot = item.productSnapshot;
      const valor = getFinalPrice(snapshot);
      return {
        ...item,
        valor,
        subtotal: valor * item.quantidade,
        generalPromo: hasGeneralPromotion(snapshot),
        codigoInterno:
          item.codigoInterno ||
          snapshot.codigoInterno ||
          snapshot.codigo ||
          item.codigo ||
          '',
        codigoBarras: item.codigoBarras || snapshot.codigoBarras || '',
        productSnapshot: snapshot,
      };
    });
    renderItemsList();
  };

  const setSaleCustomer = (cliente, pet = null) => {
    state.vendaCliente = cliente ? { ...cliente } : null;
    state.vendaPet = cliente && pet ? { ...pet } : null;
    if (!cliente) {
      state.vendaPet = null;
    }
    updateSaleCustomerSummary();
    recalculateItemsForCustomerChange();
    if (state.selectedProduct) {
      updateSelectedProductView();
    }
    if (
      elements.searchResults &&
      !elements.searchResults.classList.contains('hidden') &&
      state.searchResults.length &&
      elements.searchInput &&
      elements.searchInput.value.trim()
    ) {
      renderSearchResults(state.searchResults, elements.searchInput.value.trim());
    }
  };

  const updateCustomerModalTabs = () => {
    const buttons = Array.from(elements.customerTabButtons || []);
    const panels = Array.from(elements.customerModalPanels || []);
    buttons.forEach((button) => {
      const tab = button.getAttribute('data-pdv-customer-tab');
      const isActive = tab === state.modalActiveTab;
      const isPetTab = tab === 'pet';
      const disabled = isPetTab && !state.modalSelectedCliente;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary', isActive);
      button.classList.toggle('text-gray-500', !isActive);
      button.classList.toggle('border-transparent', !isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.disabled = disabled;
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      button.classList.toggle('opacity-60', disabled);
      button.classList.toggle('cursor-not-allowed', disabled);
    });
    panels.forEach((panel) => {
      const tab = panel.getAttribute('data-pdv-customer-panel');
      panel.classList.toggle('hidden', tab !== state.modalActiveTab);
    });
  };

  const updateCustomerModalActions = () => {
    const hasSelection = Boolean(state.modalSelectedCliente);
    if (elements.customerConfirm) {
      elements.customerConfirm.disabled = !hasSelection;
      elements.customerConfirm.classList.toggle('opacity-60', !hasSelection);
      elements.customerConfirm.textContent = state.vendaCliente
        ? 'Atualizar vínculo'
        : 'Vincular cliente';
    }
    if (elements.customerClear) {
      elements.customerClear.disabled = !hasSelection;
      elements.customerClear.classList.toggle('opacity-60', !hasSelection);
    }
  };

  const renderCustomerSearchResults = () => {
    if (!elements.customerResultsList || !elements.customerResultsEmpty || !elements.customerResultsLoading) {
      return;
    }
    elements.customerResultsList.innerHTML = '';
    if (state.customerSearchLoading) {
      elements.customerResultsLoading.classList.remove('hidden');
      elements.customerResultsEmpty.classList.add('hidden');
      return;
    }
    elements.customerResultsLoading.classList.add('hidden');
    const query = state.customerSearchQuery.trim();
    if (!query) {
      elements.customerResultsEmpty.textContent = 'Digite para buscar clientes.';
      elements.customerResultsEmpty.classList.remove('hidden');
      return;
    }
    if (!state.customerSearchResults.length) {
      elements.customerResultsEmpty.textContent = 'Nenhum cliente encontrado para a busca informada.';
      elements.customerResultsEmpty.classList.remove('hidden');
      return;
    }
    elements.customerResultsEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.customerSearchResults.forEach((cliente) => {
      const isSelected = Boolean(state.modalSelectedCliente && state.modalSelectedCliente._id === cliente._id);
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-customer-id', cliente._id);
      button.className = [
        'w-full text-left rounded-lg border px-4 py-3 transition flex flex-col gap-1',
        isSelected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-gray-200 text-gray-700 hover:border-primary hover:bg-primary/5',
      ].join(' ');
      const documento = cliente.doc || cliente.cpf || cliente.cnpj || '';
      const contato = [cliente.email, cliente.celular].filter(Boolean).join(' • ');
      button.innerHTML = `
        <span class="text-sm font-semibold">${cliente.nome || 'Cliente sem nome'}</span>
        <span class="text-xs text-gray-500">${documento ? `Documento: ${documento}` : 'Documento não informado'}</span>
        <span class="text-xs text-gray-500">${contato || 'Contato não informado'}</span>
      `;
      fragment.appendChild(button);
    });
    elements.customerResultsList.appendChild(fragment);
  };

  const renderCustomerPets = () => {
    if (!elements.customerPetsList || !elements.customerPetsEmpty || !elements.customerPetsLoading) {
      return;
    }
    elements.customerPetsList.innerHTML = '';
    if (!state.modalSelectedCliente) {
      elements.customerPetsLoading.classList.add('hidden');
      elements.customerPetsEmpty.textContent = 'Selecione um cliente para visualizar os pets vinculados.';
      elements.customerPetsEmpty.classList.remove('hidden');
      return;
    }
    if (state.customerPetsLoading) {
      elements.customerPetsLoading.classList.remove('hidden');
      elements.customerPetsEmpty.classList.add('hidden');
      return;
    }
    elements.customerPetsLoading.classList.add('hidden');
    if (!state.customerPets.length) {
      elements.customerPetsEmpty.textContent = 'Nenhum pet cadastrado para este cliente.';
      elements.customerPetsEmpty.classList.remove('hidden');
      return;
    }
    elements.customerPetsEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.customerPets.forEach((pet) => {
      const isSelected = Boolean(state.modalSelectedPet && state.modalSelectedPet._id === pet._id);
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-pet-id', pet._id);
      button.className = [
        'w-full text-left rounded-lg border px-4 py-3 transition flex flex-col gap-1',
        isSelected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-gray-200 text-gray-700 hover:border-primary hover:bg-primary/5',
      ].join(' ');
      const details = [pet.tipo, pet.raca].filter(Boolean).join(' • ');
      button.innerHTML = `
        <span class="text-sm font-semibold">${pet.nome || 'Pet sem nome'}</span>
        <span class="text-xs text-gray-500">${details || 'Detalhes não informados'}</span>
      `;
      fragment.appendChild(button);
    });
    elements.customerPetsList.appendChild(fragment);
  };

  const performCustomerSearch = async (term) => {
    const query = term.trim();
    state.customerSearchQuery = term;
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    if (!query) {
      state.customerSearchResults = [];
      state.customerSearchLoading = false;
      renderCustomerSearchResults();
      return;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    state.customerSearchLoading = true;
    renderCustomerSearchResults();
    customerSearchController = new AbortController();
    try {
      const response = await fetch(
        `${API_BASE}/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=8`,
        { headers, signal: customerSearchController.signal }
      );
      if (!response.ok) {
        throw new Error('Não foi possível buscar clientes.');
      }
      const payload = await response.json();
      state.customerSearchResults = Array.isArray(payload) ? payload : [];
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao buscar clientes:', error);
      notify(error.message || 'Não foi possível buscar clientes.', 'error');
      state.customerSearchResults = [];
    } finally {
      state.customerSearchLoading = false;
      customerSearchController = null;
      renderCustomerSearchResults();
    }
  };

  const fetchCustomerPets = async (clienteId) => {
    if (!clienteId) return;
    const cached = customerPetsCache.get(clienteId);
    if (cached) {
      state.customerPets = cached;
      state.customerPetsLoading = false;
      renderCustomerPets();
      updateCustomerModalActions();
      return;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    state.customerPetsLoading = true;
    renderCustomerPets();
    if (customerPetsController) {
      customerPetsController.abort();
    }
    customerPetsController = new AbortController();
    try {
      const response = await fetch(`${API_BASE}/func/clientes/${clienteId}/pets`, {
        headers,
        signal: customerPetsController.signal,
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os pets do cliente.');
      }
      const payload = await response.json();
      const pets = Array.isArray(payload) ? payload : [];
      customerPetsCache.set(clienteId, pets);
      if (state.modalSelectedCliente && state.modalSelectedCliente._id === clienteId) {
        state.customerPets = pets;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao carregar pets do cliente:', error);
      notify(error.message || 'Não foi possível carregar os pets do cliente selecionado.', 'error');
      if (state.modalSelectedCliente && state.modalSelectedCliente._id === clienteId) {
        state.customerPets = [];
      }
    } finally {
      if (state.modalSelectedCliente && state.modalSelectedCliente._id === clienteId) {
        state.customerPetsLoading = false;
        renderCustomerPets();
        updateCustomerModalActions();
      }
      customerPetsController = null;
    }
  };

  const setModalSelectedCliente = (cliente) => {
    state.modalSelectedCliente = cliente ? { ...cliente } : null;
    state.modalSelectedPet = null;
    if (state.modalSelectedCliente && state.modalSelectedCliente._id) {
      const cached = customerPetsCache.get(state.modalSelectedCliente._id);
      if (cached) {
        state.customerPets = cached;
        state.customerPetsLoading = false;
      } else {
        state.customerPets = [];
        state.customerPetsLoading = true;
        fetchCustomerPets(state.modalSelectedCliente._id);
      }
    } else {
      state.customerPets = [];
      state.customerPetsLoading = false;
    }
    renderCustomerSearchResults();
    renderCustomerPets();
    updateCustomerModalTabs();
    updateCustomerModalActions();
  };

  const openCustomerModal = () => {
    if (!elements.customerModal) return;
    state.modalActiveTab = 'cliente';
    state.customerSearchQuery = '';
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    state.customerPetsLoading = false;
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    setModalSelectedCliente(state.vendaCliente ? { ...state.vendaCliente } : null);
    if (
      state.vendaPet &&
      state.modalSelectedCliente &&
      state.modalSelectedCliente._id &&
      state.vendaCliente &&
      state.vendaCliente._id === state.modalSelectedCliente._id
    ) {
      state.modalSelectedPet = { ...state.vendaPet };
      renderCustomerPets();
      updateCustomerModalActions();
    }
    elements.customerModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    updateCustomerModalTabs();
    renderCustomerSearchResults();
    renderCustomerPets();
    updateCustomerModalActions();
    setTimeout(() => {
      elements.customerSearchInput?.focus();
    }, 150);
  };

  const closeCustomerModal = () => {
    if (!elements.customerModal) return;
    elements.customerModal.classList.add('hidden');
    if (
      (!elements.finalizeModal || elements.finalizeModal.classList.contains('hidden')) &&
      (!elements.paymentValueModal || elements.paymentValueModal.classList.contains('hidden'))
    ) {
      document.body.classList.remove('overflow-hidden');
    }
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
      customerSearchTimeout = null;
    }
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    if (customerPetsController) {
      customerPetsController.abort();
      customerPetsController = null;
    }
    state.customerSearchLoading = false;
    state.customerPetsLoading = false;
  };

  const handleCustomerSearchInput = (event) => {
    const value = event.target.value || '';
    state.customerSearchQuery = value;
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
    }
    customerSearchTimeout = setTimeout(() => performCustomerSearch(value), 300);
    if (!value.trim()) {
      state.customerSearchResults = [];
      state.customerSearchLoading = false;
      renderCustomerSearchResults();
    }
  };

  const handleCustomerResultsClick = (event) => {
    const button = event.target.closest('[data-customer-id]');
    if (!button) return;
    const id = button.getAttribute('data-customer-id');
    const cliente = state.customerSearchResults.find((item) => item._id === id);
    if (!cliente) return;
    setModalSelectedCliente(cliente);
  };

  const handleCustomerPetsClick = (event) => {
    const button = event.target.closest('[data-pet-id]');
    if (!button) return;
    const id = button.getAttribute('data-pet-id');
    const pet = state.customerPets.find((item) => item._id === id);
    if (!pet) return;
    if (state.modalSelectedPet && state.modalSelectedPet._id === id) {
      state.modalSelectedPet = null;
    } else {
      state.modalSelectedPet = { ...pet };
    }
    renderCustomerPets();
    updateCustomerModalActions();
  };

  const handleCustomerTabClick = (event) => {
    const tab = event.currentTarget.getAttribute('data-pdv-customer-tab');
    if (!tab) return;
    if (tab === 'pet' && !state.modalSelectedCliente) {
      event.preventDefault();
      notify('Selecione um cliente para visualizar os pets.', 'info');
      return;
    }
    state.modalActiveTab = tab;
    updateCustomerModalTabs();
    if (tab === 'pet' && state.modalSelectedCliente && state.modalSelectedCliente._id) {
      if (!customerPetsCache.has(state.modalSelectedCliente._id) && !state.customerPetsLoading) {
        fetchCustomerPets(state.modalSelectedCliente._id);
      }
    }
  };

  const handleCustomerConfirm = () => {
    if (!state.modalSelectedCliente) {
      notify('Selecione um cliente para vincular à venda.', 'warning');
      return;
    }
    setSaleCustomer(state.modalSelectedCliente, state.modalSelectedPet);
    closeCustomerModal();
  };

  const handleCustomerClearSelection = () => {
    state.modalSelectedCliente = null;
    state.modalSelectedPet = null;
    state.customerPets = [];
    state.customerPetsLoading = false;
    state.customerSearchQuery = '';
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    state.modalActiveTab = 'cliente';
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    renderCustomerSearchResults();
    renderCustomerPets();
    updateCustomerModalTabs();
    updateCustomerModalActions();
  };

  const handleCustomerRemove = () => {
    if (!state.vendaCliente) return;
    setSaleCustomer(null, null);
  };

  const handleCustomerModalKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCustomerModal();
    }
  };

  const renderItemsList = () => {
    if (!elements.itemsList || !elements.itemsEmpty || !elements.itemsCount || !elements.itemsTotal)
      return;
    elements.itemsList.innerHTML = '';
    if (!state.itens.length) {
      elements.itemsList.classList.add('hidden');
      elements.itemsEmpty.classList.remove('hidden');
      elements.itemsCount.textContent = '0 itens';
      elements.itemsTotal.textContent = formatCurrency(0);
      updateFinalizeButton();
      updateSaleSummary();
      return;
    }
    const fragment = document.createDocumentFragment();
    state.itens.forEach((item, index) => {
      const li = document.createElement('li');
      li.dataset.index = String(index);
      li.className = 'flex items-start gap-3 py-3';
      const codigoInterno = item.codigoInterno || item.codigo || '—';
      const codigoBarras = item.codigoBarras || '—';
      const generalNotice = !state.vendaCliente && item.generalPromo
        ? '<p class="text-[11px] text-amber-600">Vincule um cliente para aplicar a promoção geral.</p>'
        : '';
      li.innerHTML = `
        <div class="flex-1 min-w-0 space-y-1">
          <p class="text-sm font-semibold text-gray-800 leading-snug">${item.nome}</p>
          <p class="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
            <span>Cód. Interno: ${codigoInterno}</span>
            <span>Barras: ${codigoBarras}</span>
          </p>
          <p class="text-xs text-gray-500">Qtde: ${item.quantidade} • Valor: ${formatCurrency(item.valor)}</p>
          ${generalNotice}
        </div>
        <div class="flex flex-col items-end gap-2 text-right">
          <span class="text-sm font-semibold text-gray-700">${formatCurrency(item.subtotal)}</span>
          <button type="button" class="text-xs text-red-500 transition hover:text-red-600" data-remove-index="${index}" aria-label="Remover item">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      fragment.appendChild(li);
    });
    elements.itemsList.appendChild(fragment);
    elements.itemsList.classList.remove('hidden');
    elements.itemsEmpty.classList.add('hidden');
    elements.itemsCount.textContent =
      state.itens.length === 1 ? '1 item' : `${state.itens.length} itens`;
    const total = state.itens.reduce((sum, item) => sum + item.subtotal, 0);
    elements.itemsTotal.textContent = formatCurrency(total);
    updateFinalizeButton();
    updateSaleSummary();
  };

  const getSaleTotalBruto = () => state.itens.reduce((sum, item) => sum + item.subtotal, 0);
  const getSaleTotalLiquido = () => {
    const bruto = getSaleTotalBruto();
    const liquido = bruto + state.vendaAcrescimo - state.vendaDesconto;
    return liquido < 0 ? 0 : liquido;
  };
  const getSalePagoTotal = () =>
    state.vendaPagamentos.reduce((sum, payment) => sum + safeNumber(payment.valor), 0);

  const updateFinalizeButton = () => {
    if (!elements.finalizeButton) return;
    const disabled = !state.caixaAberto || !state.itens.length;
    elements.finalizeButton.disabled = disabled;
    elements.finalizeButton.classList.toggle('opacity-60', disabled);
    elements.finalizeButton.classList.toggle('cursor-not-allowed', disabled);
  };

  const renderSalePaymentsPreview = () => {
    if (!elements.salePaymentsList || !elements.salePaymentsEmpty) return;
    elements.salePaymentsList.innerHTML = '';
    if (!state.vendaPagamentos.length) {
      elements.salePaymentsList.classList.add('hidden');
      elements.salePaymentsEmpty.classList.remove('hidden');
      updateSaleSummary();
      return;
    }
    const fragment = document.createDocumentFragment();
    state.vendaPagamentos.forEach((payment) => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2';
      const installmentsLabel = payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
      li.innerHTML = `
        <div class="flex-1">
          <p class="text-sm font-semibold text-gray-700">${payment.label}${installmentsLabel}</p>
          <p class="text-xs text-gray-500">${formatCurrency(payment.valor)}</p>
        </div>
        <button type="button" class="text-xs text-red-500 hover:text-red-600" data-sale-remove="${payment.uid}">
          <i class="fas fa-times"></i>
        </button>
      `;
      fragment.appendChild(li);
    });
    elements.salePaymentsList.appendChild(fragment);
    elements.salePaymentsList.classList.remove('hidden');
    elements.salePaymentsEmpty.classList.add('hidden');
    updateSaleSummary();
  };

  const renderSalePaymentMethods = () => {
    if (!elements.saleMethods) return;
    if (state.paymentMethodsLoading) {
      elements.saleMethods.innerHTML =
        '<li class="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">Carregando meios de pagamento...</li>';
      return;
    }
    if (!state.paymentMethods.length) {
      const message = state.selectedStore
        ? 'Cadastre meios de pagamento para finalizar vendas neste PDV.'
        : 'Selecione uma empresa para carregar os meios de pagamento disponíveis.';
      elements.saleMethods.innerHTML = `<li class="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">${message}</li>`;
      return;
    }
    const html = state.paymentMethods
      .map((method) => {
        const installments = Array.isArray(method.installments)
          ? method.installments.filter((value) => Number.isFinite(value) && value >= 1)
          : [1];
        const uniqueInstallments = Array.from(new Set(installments)).sort((a, b) => a - b);
        if (method.type === 'credito' && uniqueInstallments.length > 1) {
          const buttons = uniqueInstallments
            .map((installment) => {
              const label = installment === 1 ? 'À vista' : `${installment}x`;
              return `<button type="button" class="rounded border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary hover:text-primary" data-sale-installment="${method.id}:${installment}">${label}</button>`;
            })
            .join('');
          return `
            <li class="rounded-xl border border-gray-200 bg-white p-4">
              <button type="button" class="flex w-full items-center justify-between text-sm font-semibold text-gray-700" data-sale-method-toggle="${method.id}">
                <span>${method.label}</span>
                <i class="fas fa-chevron-down text-xs" aria-hidden="true"></i>
              </button>
              <div class="mt-3 hidden flex flex-wrap gap-2" data-sale-options="${method.id}">
                ${buttons}
              </div>
            </li>
          `;
        }
        const parcelas = method.type === 'credito' ? uniqueInstallments[0] || 1 : 1;
        const parcelasLabel = parcelas > 1 ? ` (${parcelas}x)` : '';
        return `
          <li>
            <button type="button" class="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-primary hover:text-primary" data-sale-method="${method.id}" data-sale-parcelas="${parcelas}">
              <span>${method.label}${parcelasLabel}</span>
              <i class="fas fa-arrow-right text-xs"></i>
            </button>
          </li>
        `;
      })
      .join('');
    elements.saleMethods.innerHTML = html;
  };

  const openFinalizeModal = () => {
    if (!state.caixaAberto) {
      notify('Abra o caixa antes de finalizar uma venda.', 'warning');
      return;
    }
    if (!state.itens.length) {
      notify('Adicione itens para finalizar a venda.', 'warning');
      return;
    }
    if (state.paymentMethodsLoading) {
      notify('Aguarde o carregamento dos meios de pagamento para finalizar a venda.', 'info');
      return;
    }
    if (!state.paymentMethods.length) {
      notify('Cadastre meios de pagamento para concluir a venda.', 'warning');
      return;
    }
    renderSalePaymentMethods();
    renderSalePaymentsPreview();
    updateSaleSummary();
    if (elements.finalizeModal) {
      elements.finalizeModal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    }
  };

  const toggleFinalizeOptions = (methodId) => {
    if (!elements.saleMethods || !methodId) return;
    const options = elements.saleMethods.querySelector(`[data-sale-options="${methodId}"]`);
    const toggle = elements.saleMethods.querySelector(`[data-sale-method-toggle="${methodId}"] i`);
    if (options) {
      options.classList.toggle('hidden');
      if (toggle) {
        toggle.classList.toggle('rotate-180', !options.classList.contains('hidden'));
      }
    }
  };

  const closePaymentValueModal = (preserveBodyScroll = false) => {
    if (elements.paymentValueModal) {
      elements.paymentValueModal.classList.add('hidden');
    }
    if (elements.paymentValueInput) {
      elements.paymentValueInput.value = '';
    }
    if (elements.paymentValueHint) {
      elements.paymentValueHint.textContent = '';
    }
    paymentModalState = null;
    if (!preserveBodyScroll) {
      document.body.classList.remove('overflow-hidden');
    }
  };

  const closeFinalizeModal = () => {
    if (!elements.finalizeModal) return;
    elements.finalizeModal.classList.add('hidden');
    closePaymentValueModal(true);
    document.body.classList.remove('overflow-hidden');
  };

  const openPaymentValueModal = (method, parcelas) => {
    return new Promise((resolve, reject) => {
      if (!elements.paymentValueModal || !elements.paymentValueInput) {
        reject(new Error('Modal de pagamento indisponível.'));
        return;
      }
      if (paymentModalState) {
        paymentModalState.reject?.(new Error('Substituído'));
      }
      const restante = Math.max(getSaleTotalLiquido() - getSalePagoTotal(), 0);
      const parcelasLabel = parcelas > 1 ? `${parcelas}x` : 'à vista';
      if (elements.paymentValueTitle) {
        elements.paymentValueTitle.textContent = `Receber em ${method.label}`;
      }
      if (elements.paymentValueSubtitle) {
        elements.paymentValueSubtitle.textContent = `Pagamento ${parcelasLabel}.`;
      }
      if (elements.paymentValueHint) {
        elements.paymentValueHint.textContent = restante > 0
          ? `Restante sugerido: ${formatCurrency(restante)}.`
          : 'Informe o valor recebido para este pagamento.';
      }
      elements.paymentValueInput.value = restante > 0 ? restante.toFixed(2) : '';
      paymentModalState = { resolve, reject, method, parcelas };
      elements.paymentValueModal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      setTimeout(() => elements.paymentValueInput?.focus(), 60);
    });
  };

  const handlePaymentValueConfirm = () => {
    if (!paymentModalState) return;
    const value = safeNumber(elements.paymentValueInput?.value || 0);
    if (value <= 0) {
      notify('Informe um valor válido para o pagamento.', 'warning');
      elements.paymentValueInput?.focus();
      return;
    }
    paymentModalState.resolve({
      valor: value,
      method: paymentModalState.method,
      parcelas: paymentModalState.parcelas,
    });
    const preserve =
      elements.finalizeModal && !elements.finalizeModal.classList.contains('hidden');
    closePaymentValueModal(preserve);
  };

  const handlePaymentValueCancel = () => {
    if (!paymentModalState) {
      const preserve =
        elements.finalizeModal && !elements.finalizeModal.classList.contains('hidden');
      closePaymentValueModal(preserve);
      return;
    }
    paymentModalState.reject?.(new Error('Cancelado'));
    const preserve =
      elements.finalizeModal && !elements.finalizeModal.classList.contains('hidden');
    closePaymentValueModal(preserve);
  };

  const handleSaleMethodsClick = async (event) => {
    const toggleButton = event.target.closest('[data-sale-method-toggle]');
    if (toggleButton) {
      const methodId = toggleButton.getAttribute('data-sale-method-toggle');
      toggleFinalizeOptions(methodId);
      return;
    }
    const installmentButton = event.target.closest('[data-sale-installment]');
    if (installmentButton) {
      const value = installmentButton.getAttribute('data-sale-installment');
      if (!value) return;
      const [methodId, parcelasStr] = value.split(':');
      const parcelas = Math.max(1, Number(parcelasStr) || 1);
      const method = state.paymentMethods.find((item) => item.id === methodId);
      if (!method) return;
      if (!state.itens.length) {
        notify('Adicione itens para lançar pagamentos.', 'warning');
        return;
      }
      try {
        const result = await openPaymentValueModal(method, parcelas);
        state.vendaPagamentos.push({
          uid: createUid(),
          id: method.id,
          label: method.label,
          parcelas,
          valor: safeNumber(result.valor),
        });
        renderSalePaymentsPreview();
      } catch (_) {
        /* cancelado */
      }
      return;
    }
    const methodButton = event.target.closest('[data-sale-method]');
    if (!methodButton) return;
    const methodId = methodButton.getAttribute('data-sale-method');
    const method = state.paymentMethods.find((item) => item.id === methodId);
    if (!method) return;
    const parcelasAttr = methodButton.getAttribute('data-sale-parcelas');
    const parcelas = Math.max(1, Number(parcelasAttr) || 1);
    if (!state.itens.length) {
      notify('Adicione itens para lançar pagamentos.', 'warning');
      return;
    }
    try {
      const result = await openPaymentValueModal(method, parcelas);
      state.vendaPagamentos.push({
        uid: createUid(),
        id: method.id,
        label: method.label,
        parcelas,
        valor: safeNumber(result.valor),
      });
      renderSalePaymentsPreview();
    } catch (_) {
      /* cancelado */
    }
  };

  const handleSalePaymentsListClick = (event) => {
    const button = event.target.closest('[data-sale-remove]');
    if (!button) return;
    const uid = button.getAttribute('data-sale-remove');
    state.vendaPagamentos = state.vendaPagamentos.filter((payment) => payment.uid !== uid);
    renderSalePaymentsPreview();
  };

  const handleFinalizeButtonClick = () => {
    if (elements.finalizeButton?.disabled) return;
    openFinalizeModal();
  };

  const describeSalePayments = (payments) => {
    if (!payments.length) return '';
    return payments
      .map((payment) => {
        const parcelas = payment.parcelas && payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
        return `${payment.label || 'Pagamento'}${parcelas}`;
      })
      .join(' + ');
  };

  const registerSaleOnCaixa = (payments, total) => {
    if (!state.caixaAberto || !payments.length) {
      return;
    }
    payments.forEach((payment) => {
      const method = state.pagamentos.find((item) => item.id === payment.id);
      if (method) {
        method.valor += safeNumber(payment.valor);
        return;
      }
      const fallback =
        state.paymentMethods.find((item) => item.id === payment.id) ||
        state.paymentMethods.find((item) => item.label === payment.label);
      const base = fallback
        ? { ...fallback }
        : {
            id: payment.id || createUid(),
            label: payment.label || 'Pagamento',
            type: 'avista',
            aliases: [],
          };
      state.pagamentos.push({ ...base, valor: safeNumber(payment.valor) });
    });
    renderPayments();
    const historyLabel = describeSalePayments(payments);
    addHistoryEntry({ id: 'venda', label: 'Venda finalizada' }, total, '', historyLabel);
    updateStatusBadge();
  };

  const handleFinalizeConfirm = () => {
    const total = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    if (!state.itens.length) {
      notify('Adicione itens para finalizar a venda.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para finalizar a venda.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (Math.abs(total - pago) >= 0.01) {
      notify('O valor pago deve ser igual ao total da venda.', 'warning');
      return;
    }
    const pagamentosVenda = state.vendaPagamentos.map((payment) => ({ ...payment }));
    registerSaleOnCaixa(pagamentosVenda, total);
    notify('Venda finalizada com sucesso.', 'success');
    state.itens = [];
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    clearSelectedProduct();
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    closeFinalizeModal();
  };

  const handleSaleAdjust = () => {
    notify('Funcionalidade de acréscimo/desconto em desenvolvimento.', 'info');
  };

  const handleSaleItemAdjust = () => {
    notify('Funcionalidade de ajuste por item em desenvolvimento.', 'info');
  };

  const updateSaleSummary = () => {
    const totalLiquido = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    const desconto = state.vendaDesconto > 0 ? state.vendaDesconto : 0;
    if (elements.saleTotal) {
      elements.saleTotal.textContent = formatCurrency(totalLiquido);
    }
    if (elements.saleDiscount) {
      elements.saleDiscount.textContent = formatCurrency(desconto);
    }
    if (elements.salePaid) {
      elements.salePaid.textContent = formatCurrency(pago);
    }
    if (elements.finalizeConfirm) {
      const difference = Math.abs(totalLiquido - pago);
      const canFinalize = totalLiquido > 0 && difference < 0.01;
      elements.finalizeConfirm.disabled = !canFinalize;
      elements.finalizeConfirm.classList.toggle('opacity-60', !canFinalize);
      if (elements.finalizeDifference) {
        if (totalLiquido === 0) {
          elements.finalizeDifference.textContent = 'Adicione itens para finalizar a venda.';
        } else if (difference >= 0.01) {
          const remaining = totalLiquido - pago;
          const label = remaining > 0 ? `Faltam ${formatCurrency(remaining)}` : `Pago a maior ${formatCurrency(Math.abs(remaining))}`;
          elements.finalizeDifference.textContent = label;
        } else {
          elements.finalizeDifference.textContent = '';
        }
      }
    }
  };

  const populatePaymentSelect = () => {
    if (!elements.paymentSelect) return;
    if (state.paymentMethodsLoading) {
      elements.paymentSelect.innerHTML =
        '<option value="">Carregando meios de pagamento...</option>';
      elements.paymentSelect.disabled = true;
      return;
    }
    if (!state.pagamentos.length) {
      const label = state.selectedStore
        ? 'Nenhum meio de pagamento disponível'
        : 'Selecione uma empresa para carregar os meios de pagamento';
      elements.paymentSelect.innerHTML = `<option value="">${label}</option>`;
      elements.paymentSelect.disabled = true;
      return;
    }
    const previous = elements.paymentSelect.value;
    const options = state.pagamentos.map(
      (payment) => `<option value="${payment.id}">${payment.label}</option>`
    );
    elements.paymentSelect.innerHTML = options.join('');
    if (previous && state.pagamentos.some((payment) => payment.id === previous)) {
      elements.paymentSelect.value = previous;
    } else {
      elements.paymentSelect.value = state.pagamentos[0].id;
    }
    elements.paymentSelect.disabled = false;
  };

  const buildSummaryPrint = () => {
    if (!state.selectedStore || !state.selectedPdv) {
      return 'Selecione uma empresa e um PDV para visualizar os dados do caixa.';
    }
    const aberturaLabel = toDateLabel(state.caixaInfo.aberturaData);
    const fechamentoLabel = toDateLabel(state.caixaInfo.fechamentoData);
    const lines = [];
    lines.push(`Empresa: ${getStoreLabel()} | PDV: ${getPdvLabel()}`);
    lines.push(`Abertura: ${aberturaLabel} | Fechamento: ${fechamentoLabel}`);
    lines.push('');
    lines.push(formatPrintLine('Abertura', formatCurrency(state.summary.abertura)));
    lines.push('---------------------Recebimentos---------------------');
    lines.push('Meios de pagamento');
    if (state.pagamentos.length) {
      state.pagamentos.forEach((payment) => {
        lines.push(formatPrintLine(payment.label, formatCurrency(payment.valor)));
      });
    } else {
      lines.push('Nenhum meio de pagamento configurado.');
    }
    lines.push('------------- Fechamento Previsto ---------------------');
    const previstoPagamentos =
      state.allowApuradoEdit && state.caixaInfo.previstoPagamentos?.length
        ? state.caixaInfo.previstoPagamentos
        : state.caixaInfo.previstoPagamentos?.length
        ? state.caixaInfo.previstoPagamentos
        : state.pagamentos;
    if (previstoPagamentos?.length) {
      previstoPagamentos.forEach((payment) => {
        lines.push(formatPrintLine(payment.label, formatCurrency(payment.valor)));
      });
      const previstoTotal = state.caixaInfo.fechamentoPrevisto || sumPayments(previstoPagamentos);
      lines.push(formatPrintLine('Total previsto', formatCurrency(previstoTotal)));
    } else {
      lines.push('Nenhum valor previsto.');
    }
    lines.push('------------- Fechamento Apurado -------------------');
    const apuradoPagamentos = state.allowApuradoEdit
      ? state.pagamentos
      : state.caixaInfo.apuradoPagamentos || [];
    if (apuradoPagamentos.length) {
      apuradoPagamentos.forEach((payment) => {
        lines.push(formatPrintLine(payment.label, formatCurrency(payment.valor)));
      });
      const apuradoTotal = state.caixaInfo.fechamentoApurado || sumPayments(apuradoPagamentos);
      lines.push(formatPrintLine('Total apurado', formatCurrency(apuradoTotal)));
    } else {
      lines.push('Aguardando fechamento.');
    }
    return lines.join('\n');
  };

  const openMatricialPreview = () => {
    if (typeof window === 'undefined') return;
    const content = buildSummaryPrint();
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=800,height=600');
    if (!printWindow) {
      console.warn('Não foi possível abrir a janela de impressão.');
      return;
    }
    const markup = `<!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <title>Fechamento do caixa</title>
          <style>
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; padding: 16px; }
            pre { white-space: pre-wrap; }
          </style>
        </head>
        <body>
          <pre>${content}</pre>
        </body>
      </html>`;
    printWindow.document.open();
    printWindow.document.write(markup);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      try {
        printWindow.print();
      } catch (error) {
        console.warn('Falha ao acionar impressão automática do fechamento.', error);
      }
    };
  };

  const promptPrintFechamento = () => {
    if (typeof window === 'undefined') return;
    const shouldPrint = window.confirm('Deseja imprimir o fechamento?');
    if (shouldPrint) {
      openMatricialPreview();
    }
  };

  const updateSummary = () => {
    const total = sumPayments(state.pagamentos);
    state.summary.saldo = total;
    state.summary.recebido = Math.max(total - state.summary.abertura, 0);
    if (state.caixaAberto && !state.allowApuradoEdit) {
      state.caixaInfo.previstoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.fechamentoPrevisto = total;
    }
    if (!state.caixaAberto && !state.allowApuradoEdit) {
      state.caixaInfo.apuradoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.fechamentoApurado = sumPayments(state.caixaInfo.apuradoPagamentos);
      if (!state.caixaInfo.fechamentoPrevisto) {
        state.caixaInfo.fechamentoPrevisto = sumPayments(state.caixaInfo.previstoPagamentos || []);
      }
    }
    if (elements.summaryPrint) {
      elements.summaryPrint.textContent = buildSummaryPrint();
    }
  };

  const setLastMovement = (entry) => {
    state.lastMovement = entry || null;
    if (!elements.summaryLastMove) return;
    if (!entry) {
      elements.summaryLastMove.textContent = 'Nenhuma movimentação registrada.';
      return;
    }
    const amount = Math.abs(entry.delta);
    const amountLabel =
      entry.delta < 0 ? `- ${formatCurrency(amount)}` : formatCurrency(amount);
    const details = [amountLabel, entry.paymentLabel].filter(Boolean).join(' • ');
    elements.summaryLastMove.textContent = `${entry.label}${details ? ` • ${details}` : ''} • ${toDateLabel(
      entry.timestamp
    )}`;
  };

  const renderHistory = () => {
    if (!elements.historyList || !elements.historyEmpty) return;
    elements.historyList.querySelectorAll('li[data-history-entry]').forEach((node) => node.remove());
    if (!state.history.length) {
      elements.historyEmpty.classList.remove('hidden');
      return;
    }
    elements.historyEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.history.forEach((entry) => {
      const li = document.createElement('li');
      li.dataset.historyEntry = 'true';
      li.className = 'rounded-lg border border-gray-200 bg-white px-4 py-3';
      const amountLabel =
        entry.delta < 0 ? `- ${formatCurrency(Math.abs(entry.delta))}` : formatCurrency(entry.delta);
      const motivoLine = entry.motivo ? `<p class="text-xs text-gray-500 mt-2">Motivo: ${entry.motivo}</p>` : '';
      const paymentLine = entry.paymentLabel
        ? `<p class="text-xs text-gray-500">Meio: ${entry.paymentLabel}</p>`
        : '';
      li.innerHTML = `
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm font-semibold text-gray-700">${entry.label}</p>
          <span class="text-sm font-semibold text-gray-800">${amountLabel}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1">${toDateLabel(entry.timestamp)}</p>
        ${paymentLine}
        ${motivoLine}
      `;
      fragment.appendChild(li);
    });
    elements.historyList.appendChild(fragment);
  };
  const renderCaixaActions = () => {
    if (!elements.caixaActions) return;
    const available = caixaActions.filter((action) => action.isAvailable(state));
    elements.caixaActions.innerHTML = '';
    if (!available.length) {
      elements.caixaActions.innerHTML =
        '<p class="text-xs text-gray-500">Nenhuma ação disponível para o caixa neste momento.</p>';
      return;
    }
    const fragment = document.createDocumentFragment();
    available.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action.id;
      const isActive = state.selectedAction === action.id;
      button.className = [
        'flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold transition',
        isActive ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-700 hover:border-primary/60',
      ].join(' ');
      button.innerHTML = `
        <span class="flex items-center gap-3">
          <span class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <i class="fas ${action.icon}"></i>
          </span>
          ${action.label}
        </span>
        <i class="fas fa-chevron-right text-xs text-gray-400"></i>
      `;
      fragment.appendChild(button);
    });
    elements.caixaActions.appendChild(fragment);
  };

  const updateActionDetails = () => {
    if (!elements.actionDetails) return;
    const action = caixaActions.find((item) => item.id === state.selectedAction);
    const visible = Boolean(action);
    elements.actionDetails.classList.toggle('hidden', !visible);
    if (!action) {
      return;
    }
    if (elements.actionHint) {
      elements.actionHint.textContent = action.hint;
    }
    if (elements.actionValuesWrapper) {
      elements.actionValuesWrapper.classList.toggle('hidden', !action.requiresAmount);
    }
    if (elements.actionAmount) {
      elements.actionAmount.value = '';
      elements.actionAmount.disabled = !action.requiresAmount;
    }
    if (elements.paymentSelect) {
      const shouldDisable =
        !action.affectsPayments || state.paymentMethodsLoading || !state.pagamentos.length;
      elements.paymentSelect.disabled = shouldDisable;
      if (!action.affectsPayments && state.pagamentos.length) {
        elements.paymentSelect.value = state.pagamentos[0].id;
      }
      if (shouldDisable && action.affectsPayments && elements.actionHint) {
        elements.actionHint.textContent = state.paymentMethodsLoading
          ? 'Aguarde o carregamento dos meios de pagamento.'
          : 'Cadastre ou habilite meios de pagamento para registrar esta operação.';
      }
    }
    if (elements.motivoWrapper && elements.motivoInput) {
      elements.motivoWrapper.classList.toggle('hidden', !action.requiresMotivo);
      elements.motivoInput.value = '';
    }
    if (elements.actionConfirm) {
      const labels = {
        abertura: 'Abrir caixa',
        entrada: 'Registrar entrada',
        saida: 'Registrar saída',
        envio: 'Registrar envio',
        fechamento: 'Fechar caixa',
      };
      const labelSpan = elements.actionConfirm.querySelector('span');
      if (labelSpan) {
        labelSpan.textContent = labels[action.id] || 'Registrar';
      }
    }
  };

  const addHistoryEntry = (action, amount, motivo, paymentLabel, deltaOverride) => {
    const delta = typeof deltaOverride === 'number'
      ? deltaOverride
      : action.id === 'saida' || action.id === 'envio' || action.id === 'fechamento'
      ? -Math.abs(amount)
      : Math.abs(amount);
    const entry = {
      id: action.id,
      label: action.label,
      amount: Math.abs(amount),
      delta,
      motivo: motivo || '',
      paymentLabel: paymentLabel || '',
      timestamp: new Date().toISOString(),
    };
    state.history.unshift(entry);
    renderHistory();
    setLastMovement(entry);
  };

  const resetPagamentos = () => {
    state.pagamentos = state.pagamentos.map((payment) => ({ ...payment, valor: 0 }));
    state.summary.abertura = 0;
    state.allowApuradoEdit = false;
    state.caixaInfo.previstoPagamentos = [];
    state.caixaInfo.apuradoPagamentos = [];
    state.caixaInfo.fechamentoPrevisto = 0;
    state.caixaInfo.fechamentoApurado = 0;
    updateSummary();
    renderPayments();
  };

  const resetWorkspace = () => {
    state.caixaAberto = false;
    state.allowApuradoEdit = false;
    state.selectedAction = null;
    state.searchResults = [];
    state.selectedProduct = null;
    state.quantidade = 1;
    state.itens = [];
    state.vendaCliente = null;
    state.vendaPet = null;
    state.summary = { abertura: 0, recebido: 0, saldo: 0 };
    state.caixaInfo = {
      aberturaData: null,
      fechamentoData: null,
      fechamentoPrevisto: 0,
      fechamentoApurado: 0,
      previstoPagamentos: [],
      apuradoPagamentos: [],
    };
    state.history = [];
    state.lastMovement = null;
    state.pendingPagamentosData = null;
    state.pagamentos = state.paymentMethods.map((method) => ({ ...method, valor: 0 }));
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    state.customerSearchQuery = '';
    state.customerPets = [];
    state.customerPetsLoading = false;
    state.modalSelectedCliente = null;
    state.modalSelectedPet = null;
    state.modalActiveTab = 'cliente';
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
      customerSearchTimeout = null;
    }
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    if (customerPetsController) {
      customerPetsController.abort();
      customerPetsController = null;
    }
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    if (elements.customerResultsList) {
      elements.customerResultsList.innerHTML = '';
    }
    if (elements.customerResultsLoading) {
      elements.customerResultsLoading.classList.add('hidden');
    }
    if (elements.customerResultsEmpty) {
      elements.customerResultsEmpty.textContent = 'Digite para buscar clientes.';
      elements.customerResultsEmpty.classList.remove('hidden');
    }
    if (elements.customerPetsList) {
      elements.customerPetsList.innerHTML = '';
    }
    if (elements.customerPetsLoading) {
      elements.customerPetsLoading.classList.add('hidden');
    }
    if (elements.customerPetsEmpty) {
      elements.customerPetsEmpty.textContent = 'Nenhum pet disponível.';
    }
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }
    if (elements.searchResults) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
    }
    clearSelectedProduct();
    updateSaleCustomerSummary();
    renderItemsList();
    renderPayments();
    renderSalePaymentMethods();
    renderSalePaymentsPreview();
    renderHistory();
    setLastMovement(null);
    populatePaymentSelect();
    renderCaixaActions();
    updateActionDetails();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    updateFinalizeButton();
    updateCustomerModalTabs();
    updateCustomerModalActions();
    renderCustomerSearchResults();
    renderCustomerPets();
    setActiveTab('caixa-tab');
  };

  const updateSelectionHint = (message) => {
    if (elements.selectionHint && message) {
      elements.selectionHint.textContent = message;
    }
  };

  const populateCompanySelect = () => {
    if (!elements.companySelect) return;
    const previous = elements.companySelect.value;
    const options = ['<option value="">Selecione uma empresa</option>'];
    state.stores.forEach((store) => {
      options.push(
        `<option value="${store._id}">${store.nome || store.nomeFantasia || 'Empresa sem nome'}</option>`
      );
    });
    elements.companySelect.innerHTML = options.join('');
    if (previous && state.stores.some((store) => store._id === previous)) {
      elements.companySelect.value = previous;
    }
  };

  const populatePdvSelect = () => {
    if (!elements.pdvSelect) return;
    const options = ['<option value="">Selecione um PDV</option>'];
    state.pdvs.forEach((pdv) => {
      options.push(`<option value="${pdv._id}">${pdv.nome || pdv.codigo || pdv._id}</option>`);
    });
    elements.pdvSelect.innerHTML = options.join('');
    elements.pdvSelect.disabled = state.pdvs.length === 0;
  };

  const fetchStores = async () => {
    const response = await fetch(`${API_BASE}/stores`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar as empresas cadastradas.');
    }
    const payload = await response.json();
    state.stores = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.stores)
      ? payload.stores
      : [];
    populateCompanySelect();
  };

  const fetchPaymentMethods = async (storeId) => {
    state.paymentMethods = [];
    state.pagamentos = [];
    state.paymentMethodsLoading = true;
    renderPayments();
    renderSalePaymentMethods();
    populatePaymentSelect();
    if (!storeId) {
      state.paymentMethodsLoading = false;
      updatePaymentMethods([]);
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE}/payment-methods?company=${encodeURIComponent(storeId)}`
      );
      if (!response.ok) {
        throw new Error('Não foi possível carregar os meios de pagamento cadastrados.');
      }
      const payload = await response.json();
      const methods = Array.isArray(payload?.paymentMethods)
        ? payload.paymentMethods
        : Array.isArray(payload)
        ? payload
        : [];
      state.paymentMethodsLoading = false;
      updatePaymentMethods(methods);
    } catch (error) {
      state.paymentMethodsLoading = false;
      updatePaymentMethods([]);
      console.error('Erro ao carregar meios de pagamento para o PDV:', error);
      notify(error.message || 'Não foi possível carregar os meios de pagamento.', 'error');
    }
  };

  const fetchPdvs = async (storeId) => {
    const query = storeId ? `?empresa=${encodeURIComponent(storeId)}` : '';
    const response = await fetch(`${API_BASE}/pdvs${query}`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar os PDVs da empresa.');
    }
    const payload = await response.json();
    state.pdvs = Array.isArray(payload?.pdvs)
      ? payload.pdvs
      : Array.isArray(payload)
      ? payload
      : [];
    populatePdvSelect();
  };

  const fetchPdvDetails = async (pdvId) => {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${API_BASE}/pdvs/${pdvId}`, { headers });
    if (!response.ok) {
      const message = await response.json().catch(() => null);
      throw new Error(message?.message || 'Não foi possível carregar os dados do PDV selecionado.');
    }
    return response.json();
  };
  const applyPdvData = (pdv) => {
    const caixaAberto = Boolean(
      pdv?.caixa?.aberto ||
        pdv?.caixaAberto ||
        pdv?.statusCaixa === 'aberto' ||
        pdv?.status === 'aberto'
    );
    state.caixaAberto = caixaAberto;
    state.summary.abertura = safeNumber(
      pdv?.caixa?.abertura || pdv?.caixa?.valorAbertura || pdv?.valorAbertura || 0
    );
    const aberturaData =
      pdv?.caixa?.dataAbertura ||
      pdv?.caixa?.aberturaData ||
      pdv?.caixa?.abertura ||
      pdv?.caixa?.abertoEm ||
      pdv?.caixa?.inicio ||
      pdv?.caixa?.openedAt ||
      pdv?.dataAbertura ||
      pdv?.abertura;
    const fechamentoData =
      pdv?.caixa?.dataFechamento ||
      pdv?.caixa?.fechamentoData ||
      pdv?.caixa?.fechamento ||
      pdv?.caixa?.fechadoEm ||
      pdv?.caixa?.fim ||
      pdv?.caixa?.closedAt ||
      pdv?.dataFechamento ||
      pdv?.fechamento;
    state.caixaInfo = {
      aberturaData: parseDateValue(aberturaData),
      fechamentoData: parseDateValue(fechamentoData),
      fechamentoPrevisto: safeNumber(
        pdv?.caixa?.fechamentoPrevisto ||
          pdv?.caixa?.valorPrevisto ||
          pdv?.caixa?.saldoPrevisto ||
          pdv?.fechamentoPrevisto ||
          0
      ),
      fechamentoApurado: safeNumber(
        pdv?.caixa?.fechamentoApurado ||
          pdv?.caixa?.valorApurado ||
          pdv?.fechamentoApurado ||
          0
      ),
      previstoPagamentos: [],
      apuradoPagamentos: [],
    };
    const pagamentosData = pdv?.caixa?.pagamentos || pdv?.pagamentos || {};
    applyPagamentosData(pagamentosData);
    if (state.summary.abertura > 0 && !state.pagamentos.some((payment) => payment.valor > 0)) {
      state.pagamentos = state.pagamentos.map((payment, index) =>
        index === 0 ? { ...payment, valor: state.summary.abertura } : payment
      );
    }
    const historico = Array.isArray(pdv?.caixa?.historico) ? pdv.caixa.historico : [];
    state.history = historico
      .map((entry) => ({
        id: entry?.id || entry?._id || 'movimentacao',
        label: entry?.descricao || entry?.tipo || 'Movimentação',
        amount: safeNumber(entry?.valor),
        delta: safeNumber(entry?.delta ?? entry?.valor ?? 0),
        motivo: entry?.motivo || entry?.observacao || '',
        paymentLabel: entry?.meioPagamento || entry?.formaPagamento || '',
        timestamp: entry?.data || entry?.createdAt || entry?.atualizadoEm || new Date().toISOString(),
      }))
      .reverse();
    renderPayments();
    renderHistory();
    setLastMovement(state.history[state.history.length - 1] || null);
    renderItemsList();
    clearSelectedProduct();
    updateWorkspaceInfo();
    renderCaixaActions();
    updateActionDetails();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    setActiveTab(state.caixaAberto ? 'pdv-tab' : 'caixa-tab');
  };

  const renderSearchResults = (results, term) => {
    if (!elements.searchResults) return;
    if (!results.length) {
      elements.searchResults.innerHTML = `<div class="p-4 text-sm text-gray-500">Nenhum produto encontrado para "${term}".</div>`;
      return;
    }
    const toReais = (value) => formatCurrency(value).replace('R$', '').trim();
    const html = results
      .map((product, index) => {
        const finalPrice = getFinalPrice(product);
        const basePrice = getBasePrice(product);
        const generalPromo = hasGeneralPromotion(product);
        const showGeneralWarning = generalPromo && !canApplyGeneralPromotion();
        const badge = finalPrice < basePrice
          ? '<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Promo</span>'
          : '';
        const generalBadge = showGeneralWarning
          ? '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Cliente necessário</span>'
          : '';
        const badges = [badge, generalBadge].filter(Boolean).join('');
        const priceLine = finalPrice < basePrice
          ? `<span class="text-sm font-semibold text-primary">R$ ${toReais(finalPrice)}</span><span class="text-xs text-gray-400 line-through">R$ ${toReais(basePrice)}</span>`
          : `<span class="text-sm font-semibold text-gray-800">R$ ${toReais(finalPrice)}</span>`;
        const image = getImageUrl(product);
        const extraNotice = showGeneralWarning
          ? '<span class="block text-[11px] text-amber-600 mt-1">Vincule um cliente para aplicar a promoção geral.</span>'
          : '';
        return `
          <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary/5" data-result-index="${index}">
            <span class="h-14 w-14 flex items-center justify-center rounded border border-gray-200 bg-white overflow-hidden">
              ${image ? `<img src="${image}" alt="${product.nome}" class="h-full w-full object-contain">` : '<i class="fas fa-image text-gray-300"></i>'}
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-semibold text-gray-800 truncate">${product.nome || 'Produto sem nome'}</span>
              <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                ${priceLine}
                ${badges}
              </span>
              ${extraNotice}
              <span class="block text-[11px] text-gray-400 mt-1">Cód: ${getProductCode(product) || '—'} • Barras: ${getProductBarcode(product) || '—'}</span>
            </span>
          </button>
        `;
      })
      .join('');
    elements.searchResults.innerHTML = html;
  };

  const performSearch = async (term) => {
    if (!elements.searchResults) return;
    const normalized = term.trim();
    if (!normalized) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
      return;
    }
    const minLength = /^\d+$/.test(normalized) ? 1 : 2;
    if (normalized.length < minLength) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
      return;
    }
    if (state.searchController) {
      state.searchController.abort();
    }
    state.searchController = new AbortController();
    elements.searchResults.classList.remove('hidden');
    elements.searchResults.innerHTML = '<div class="p-4 text-sm text-gray-500">Buscando produtos...</div>';
    try {
      const response = await fetch(
        `${API_BASE}/products?search=${encodeURIComponent(normalized)}&limit=8`,
        { signal: state.searchController.signal }
      );
      if (!response.ok) {
        throw new Error('Não foi possível buscar produtos.');
      }
      const payload = await response.json();
      const products = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload) ? payload : [];
      state.searchResults = products;
      renderSearchResults(products, normalized);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao pesquisar produtos no PDV:', error);
      elements.searchResults.innerHTML = '<div class="p-4 text-sm text-red-500">Falha ao carregar produtos. Tente novamente.</div>';
    }
  };

  const selectProduct = (index) => {
    const product = state.searchResults[index];
    if (!product) return;
    state.selectedProduct = product;
    state.quantidade = 1;
    updateSelectedProductView();
    if (elements.searchInput) {
      elements.searchInput.value = product?.nome || getProductCode(product) || '';
      elements.searchInput.focus();
    }
    if (elements.searchResults) {
      elements.searchResults.classList.add('hidden');
    }
  };

  const addItemToList = () => {
    if (!state.selectedProduct) {
      notify('Selecione um produto para adicionar à venda.', 'warning');
      return;
    }
    const quantidade = Math.max(1, Math.trunc(Number(elements.itemQuantity?.value || state.quantidade || 1)));
    state.quantidade = quantidade;
    const product = state.selectedProduct;
    const unitPrice = getFinalPrice(product);
    const subtotal = unitPrice * quantidade;
    const codigo = getProductCode(product);
    const codigoInterno = product?.codigoInterno || product?.codInterno || codigo;
    const codigoBarras = getProductBarcode(product);
    const nome = product?.nome || 'Produto sem nome';
    const generalPromo = hasGeneralPromotion(product);
    const snapshot = buildProductSnapshot(product);
    const existingIndex = state.itens.findIndex(
      (item) =>
        item.id === product._id ||
        item.codigo === codigo ||
        (!!codigoInterno && item.codigoInterno === codigoInterno)
    );
    if (existingIndex >= 0) {
      const current = state.itens[existingIndex];
      current.quantidade += quantidade;
      current.valor = unitPrice;
      current.subtotal = current.quantidade * current.valor;
      current.codigoInterno = codigoInterno || current.codigoInterno;
      current.codigoBarras = codigoBarras || current.codigoBarras;
      current.generalPromo = generalPromo;
      current.productSnapshot = snapshot;
    } else {
      state.itens.push({
        id: product._id || product.id || codigo || String(Date.now()),
        codigo,
        codigoInterno,
        codigoBarras,
        nome,
        quantidade,
        valor: unitPrice,
        subtotal,
        generalPromo,
        productSnapshot: snapshot,
      });
    }
    renderItemsList();
    notify('Item adicionado à pré-visualização.', 'success');
  };

  const updatePaymentRow = (paymentId) => {
    if (!elements.paymentList) return;
    const display = elements.paymentList.querySelector(`[data-payment-display="${paymentId}"]`);
    if (display) {
      const payment = state.pagamentos.find((item) => item.id === paymentId);
      display.textContent = formatCurrency(payment?.valor || 0);
    }
  };

  const renderPayments = () => {
    if (!elements.paymentList) return;
    elements.paymentList.innerHTML = '';
    const inputsLocked = state.caixaAberto && !state.allowApuradoEdit;
    const helperText = state.allowApuradoEdit
      ? 'Informe o valor apurado'
      : state.caixaAberto
      ? 'Saldo previsto'
      : 'Valor inicial / apurado';
    if (state.paymentMethodsLoading) {
      elements.paymentList.innerHTML =
        '<li class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">Carregando meios de pagamento...</li>';
    } else if (!state.pagamentos.length) {
      const message = state.selectedStore
        ? 'Nenhum meio de pagamento cadastrado para esta empresa.'
        : 'Selecione uma empresa para visualizar os meios de pagamento disponíveis.';
      elements.paymentList.innerHTML = `<li class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">${message}</li>`;
    } else {
      const fragment = document.createDocumentFragment();
      state.pagamentos.forEach((payment) => {
        const li = document.createElement('li');
        li.className =
          'flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3';
        const inputClasses = [
          'w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right focus:border-primary focus:ring-2 focus:ring-primary/20',
          inputsLocked ? 'cursor-not-allowed bg-gray-100 text-gray-500' : '',
          state.allowApuradoEdit ? 'bg-white text-gray-800' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const disabledAttr = inputsLocked ? 'disabled' : '';
        li.innerHTML = `
          <div>
            <p class="text-sm font-semibold text-gray-700">${payment.label}</p>
            <p class="text-xs text-gray-500">${helperText}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">R$</span>
            <input type="number" min="0" step="0.01" value="${payment.valor.toFixed(2)}" data-payment-input="${payment.id}" class="${inputClasses}" aria-label="Atualizar ${payment.label}" ${disabledAttr}>
            <span class="text-sm font-semibold text-gray-800" data-payment-display="${payment.id}">${formatCurrency(payment.valor)}</span>
          </div>
        `;
        fragment.appendChild(li);
      });
      elements.paymentList.appendChild(fragment);
    }
    if (elements.resetPayments) {
      const disableReset =
        inputsLocked || state.paymentMethodsLoading || !state.pagamentos.length;
      elements.resetPayments.disabled = disableReset;
      elements.resetPayments.classList.toggle('opacity-50', disableReset);
      elements.resetPayments.classList.toggle('cursor-not-allowed', disableReset);
    }
    populatePaymentSelect();
    updateSummary();
  };

  const handlePaymentInput = (event) => {
    const input = event.target.closest('input[data-payment-input]');
    if (!input) return;
    const id = input.getAttribute('data-payment-input');
    const value = safeNumber(input.value);
    const payment = state.pagamentos.find((item) => item.id === id);
    if (!payment) return;
    if (state.caixaAberto && !state.allowApuradoEdit) {
      input.value = payment.valor.toFixed(2);
      return;
    }
    payment.valor = value < 0 ? 0 : value;
    input.value = payment.valor.toFixed(2);
    updatePaymentRow(id);
    updateSummary();
  };

  const handleResetPayments = () => {
    if (state.caixaAberto) {
      notify('Não é possível zerar os valores com o caixa aberto.', 'warning');
      return;
    }
    resetPagamentos();
    notify('Valores dos meios de pagamento zerados.', 'info');
  };

  const handleClearHistory = () => {
    state.history = [];
    setLastMovement(null);
    renderHistory();
    notify('Histórico de movimentações limpo.', 'info');
  };

  const handleSearchInput = (event) => {
    const term = event.target.value || '';
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    searchTimeout = setTimeout(() => performSearch(term), 250);
  };

  const handleSearchResultsClick = (event) => {
    const button = event.target.closest('[data-result-index]');
    if (!button) return;
    const index = Number(button.getAttribute('data-result-index'));
    if (!Number.isInteger(index)) return;
    selectProduct(index);
  };

  const handleDocumentClick = (event) => {
    if (!elements.searchResults || !elements.searchInput) return;
    if (
      elements.searchResults.contains(event.target) ||
      event.target === elements.searchInput
    ) {
      return;
    }
    elements.searchResults.classList.add('hidden');
  };

  const handleItemsListClick = (event) => {
    const button = event.target.closest('[data-remove-index]');
    if (!button) return;
    const index = Number(button.getAttribute('data-remove-index'));
    if (!Number.isInteger(index) || index < 0 || index >= state.itens.length) return;
    state.itens.splice(index, 1);
    renderItemsList();
    if (!state.itens.length) {
      state.vendaPagamentos = [];
      renderSalePaymentsPreview();
    } else {
      const total = getSaleTotalLiquido();
      const pago = getSalePagoTotal();
      if (pago > total) {
        state.vendaPagamentos = [];
        renderSalePaymentsPreview();
      } else {
        updateSaleSummary();
      }
    }
  };

  const changeQuantity = (delta) => {
    const newValue = Math.max(1, Math.trunc(Number(elements.itemQuantity?.value || state.quantidade || 1)) + delta);
    state.quantidade = newValue;
    if (elements.itemQuantity) {
      elements.itemQuantity.value = newValue;
    }
    updateItemTotals();
  };

  const handleQuantityInput = () => {
    const value = Math.max(1, Math.trunc(Number(elements.itemQuantity?.value || 1)));
    state.quantidade = value;
    if (elements.itemQuantity) {
      elements.itemQuantity.value = value;
    }
    updateItemTotals();
  };

  const handleActionClick = (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const actionId = button.getAttribute('data-action');
    if (state.allowApuradoEdit && actionId !== 'fechamento' && state.caixaAberto) {
      state.pagamentos = clonePayments(state.caixaInfo.previstoPagamentos || state.pagamentos);
      state.allowApuradoEdit = false;
    }
    state.selectedAction = actionId;
    if (actionId === 'fechamento' && state.caixaAberto) {
      state.caixaInfo.previstoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.fechamentoPrevisto = sumPayments(state.caixaInfo.previstoPagamentos);
      state.allowApuradoEdit = true;
    } else if (actionId !== 'fechamento') {
      state.allowApuradoEdit = false;
    }
    renderCaixaActions();
    renderPayments();
    updateActionDetails();
  };

  const handleActionConfirm = () => {
    const action = caixaActions.find((item) => item.id === state.selectedAction);
    if (!action) {
      notify('Selecione uma operação para o caixa.', 'warning');
      return;
    }
    const amountValue = safeNumber(elements.actionAmount?.value || 0);
    const paymentId = elements.paymentSelect?.value || (state.pagamentos[0]?.id ?? '');
    const payment = state.pagamentos.find((item) => item.id === paymentId) || state.pagamentos[0];
    const motivo = elements.motivoInput?.value.trim();

    if (action.requiresAmount && amountValue <= 0) {
      notify('Informe um valor válido para a operação.', 'warning');
      elements.actionAmount?.focus();
      return;
    }
    if (action.requiresMotivo && !motivo) {
      notify('Descreva o motivo da movimentação.', 'warning');
      elements.motivoInput?.focus();
      return;
    }

    if (action.id === 'abertura') {
      if (state.caixaAberto) {
        notify('O caixa já está aberto.', 'warning');
        return;
      }
      const aberturaTotal = sumPayments(state.pagamentos);
      state.caixaAberto = true;
      state.allowApuradoEdit = false;
      state.summary.abertura = aberturaTotal;
      state.caixaInfo.aberturaData = new Date().toISOString();
      state.caixaInfo.fechamentoData = null;
      state.caixaInfo.fechamentoApurado = 0;
      state.caixaInfo.previstoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.apuradoPagamentos = [];
      state.caixaInfo.fechamentoPrevisto = aberturaTotal;
      addHistoryEntry(action, aberturaTotal, motivo, describePaymentValues(state.pagamentos));
      notify(action.successMessage, 'success');
      setActiveTab('pdv-tab');
    } else if (action.id === 'fechamento') {
      if (!state.caixaAberto) {
        notify('Abra o caixa antes de realizar o fechamento.', 'warning');
        return;
      }
      const previstoPagamentos =
        state.caixaInfo.previstoPagamentos?.length
          ? state.caixaInfo.previstoPagamentos
          : clonePayments(state.pagamentos);
      const apuradoPagamentos = clonePayments(state.pagamentos);
      const previstoTotal = sumPayments(previstoPagamentos);
      const apuradoTotal = sumPayments(apuradoPagamentos);
      addHistoryEntry(
        action,
        apuradoTotal,
        motivo,
        describePaymentValues(apuradoPagamentos),
        -Math.abs(apuradoTotal)
      );
      state.caixaInfo.fechamentoData = new Date().toISOString();
      state.caixaInfo.previstoPagamentos = clonePayments(previstoPagamentos);
      state.caixaInfo.apuradoPagamentos = clonePayments(apuradoPagamentos);
      state.caixaInfo.fechamentoPrevisto = previstoTotal;
      state.caixaInfo.fechamentoApurado = apuradoTotal;
      state.caixaAberto = false;
      state.allowApuradoEdit = false;
      notify(action.successMessage, 'success');
      updateTabAvailability();
      setActiveTab('caixa-tab');
      promptPrintFechamento();
    } else {
      if (!state.caixaAberto) {
        notify('Abra o caixa antes de registrar movimentações.', 'warning');
        return;
      }
      if (!payment) {
        notify(
          state.pagamentos.length
            ? 'Selecione um meio de pagamento válido.'
            : 'Cadastre meios de pagamento antes de registrar esta movimentação.',
          'warning'
        );
        return;
      }
      if (action.id === 'entrada') {
        payment.valor += amountValue;
        addHistoryEntry(action, amountValue, motivo, payment.label);
      } else {
        payment.valor = Math.max(0, payment.valor - amountValue);
        addHistoryEntry(action, amountValue, motivo, payment.label, -Math.abs(amountValue));
      }
      notify(action.successMessage, 'success');
    }

    renderPayments();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    state.selectedAction = null;
    state.allowApuradoEdit = false;
    renderCaixaActions();
    updateActionDetails();
    elements.actionAmount && (elements.actionAmount.value = '');
    elements.motivoInput && (elements.motivoInput.value = '');
  };

  const handleCompanyChange = async () => {
    const value = elements.companySelect?.value || '';
    state.selectedStore = value;
    state.selectedPdv = '';
    state.paymentMethods = [];
    state.paymentMethodsLoading = false;
    resetWorkspace();
    updateWorkspaceVisibility(false);
    populatePdvSelect();
    if (!value) {
      await fetchPaymentMethods('');
      updateSelectionHint('Escolha a empresa para carregar os PDVs disponíveis.');
      return;
    }
    updateSelectionHint('Carregando PDVs disponíveis...');
    elements.pdvSelect.disabled = true;
    try {
      await Promise.all([fetchPdvs(value), fetchPaymentMethods(value)]);
      if (!state.pdvs.length) {
        updateSelectionHint('Nenhum PDV encontrado para a empresa selecionada.');
      } else {
        updateSelectionHint('Selecione o PDV desejado para iniciar.');
      }
    } catch (error) {
      console.error('Erro ao carregar PDVs da empresa selecionada:', error);
      notify(error.message || 'Erro ao carregar os PDVs da empresa.', 'error');
      state.pdvs = [];
      populatePdvSelect();
      updateSelectionHint('Não foi possível carregar os PDVs. Tente novamente.');
    } finally {
      elements.pdvSelect.disabled = state.pdvs.length === 0;
    }
  };

  const handlePdvChange = async () => {
    const value = elements.pdvSelect?.value || '';
    state.selectedPdv = value;
    resetWorkspace();
    if (!value) {
      updateWorkspaceVisibility(false);
      return;
    }
    updateSelectionHint('Carregando dados do PDV selecionado...');
    try {
      const pdv = await fetchPdvDetails(value);
      updateWorkspaceVisibility(true);
      applyPdvData(pdv);
      updateSelectionHint('PDV carregado com sucesso.');
    } catch (error) {
      console.error('Erro ao carregar PDV selecionado:', error);
      notify(error.message || 'Não foi possível carregar o PDV selecionado.', 'error');
      updateWorkspaceVisibility(false);
      updateSelectionHint('Erro ao carregar o PDV. Selecione novamente.');
    }
  };

  const bindEvents = () => {
    elements.companySelect?.addEventListener('change', handleCompanyChange);
    elements.pdvSelect?.addEventListener('change', handlePdvChange);
    elements.searchInput?.addEventListener('input', handleSearchInput);
    elements.searchResults?.addEventListener('click', handleSearchResultsClick);
    document.addEventListener('click', handleDocumentClick);
    elements.addItem?.addEventListener('click', addItemToList);
    elements.itemQuantity?.addEventListener('input', handleQuantityInput);
    elements.quantityButtons?.forEach((button) => {
      const delta = Number(button.getAttribute('data-quantity-change')) || 0;
      button.addEventListener('click', () => changeQuantity(delta));
    });
    elements.itemsList?.addEventListener('click', handleItemsListClick);
    elements.paymentList?.addEventListener('input', handlePaymentInput);
    elements.resetPayments?.addEventListener('click', handleResetPayments);
    elements.clearHistory?.addEventListener('click', handleClearHistory);
    elements.caixaActions?.addEventListener('click', handleActionClick);
    elements.actionConfirm?.addEventListener('click', handleActionConfirm);
    elements.finalizeButton?.addEventListener('click', handleFinalizeButtonClick);
    elements.finalizeClose?.addEventListener('click', closeFinalizeModal);
    elements.finalizeBack?.addEventListener('click', closeFinalizeModal);
    elements.finalizeBackdrop?.addEventListener('click', closeFinalizeModal);
    elements.finalizeConfirm?.addEventListener('click', handleFinalizeConfirm);
    elements.saleMethods?.addEventListener('click', handleSaleMethodsClick);
    elements.salePaymentsList?.addEventListener('click', handleSalePaymentsListClick);
    elements.saleAdjust?.addEventListener('click', handleSaleAdjust);
    elements.saleItemAdjust?.addEventListener('click', handleSaleItemAdjust);
    elements.paymentValueConfirm?.addEventListener('click', handlePaymentValueConfirm);
    elements.paymentValueCancel?.addEventListener('click', handlePaymentValueCancel);
    elements.paymentValueBackdrop?.addEventListener('click', handlePaymentValueCancel);
    elements.tabTriggers?.forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        const target = trigger.getAttribute('data-tab-target');
        if (!target) return;
        if (target === 'pdv-tab' && !state.caixaAberto) {
          event.preventDefault();
          notify('Abra o caixa para acessar a aba de vendas.', 'warning');
          setActiveTab('caixa-tab');
          return;
        }
        setActiveTab(target);
      });
    });
    elements.customerOpenButton?.addEventListener('click', openCustomerModal);
    elements.customerRemove?.addEventListener('click', handleCustomerRemove);
    elements.customerModalClose?.addEventListener('click', closeCustomerModal);
    elements.customerModalBackdrop?.addEventListener('click', closeCustomerModal);
    elements.customerCancel?.addEventListener('click', closeCustomerModal);
    elements.customerConfirm?.addEventListener('click', handleCustomerConfirm);
    elements.customerClear?.addEventListener('click', handleCustomerClearSelection);
    elements.customerSearchInput?.addEventListener('input', handleCustomerSearchInput);
    elements.customerResultsList?.addEventListener('click', handleCustomerResultsClick);
    elements.customerPetsList?.addEventListener('click', handleCustomerPetsClick);
    Array.from(elements.customerTabButtons || []).forEach((button) => {
      button.addEventListener('click', handleCustomerTabClick);
    });
    elements.customerModal?.addEventListener('keydown', handleCustomerModalKeydown);
  };

  const init = async () => {
    queryElements();
    resetWorkspace();
    updateWorkspaceVisibility(false);
    bindEvents();
    renderSalePaymentMethods();
    updateTabAvailability();
    try {
      await fetchStores();
      updateSelectionHint('Escolha a empresa para carregar os PDVs disponíveis.');
    } catch (error) {
      console.error('Erro ao carregar empresas para o PDV:', error);
      notify(error.message || 'Erro ao carregar a lista de empresas.', 'error');
      updateSelectionHint('Não foi possível carregar as empresas.');
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
