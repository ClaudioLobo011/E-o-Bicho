(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const SERVER_URL =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.SERVER_URL) || '';

  const pagamentosCatalog = [
    { id: 'dinheiro', label: 'Dinheiro' },
    { id: 'credito', label: 'Cartão de crédito' },
    { id: 'debito', label: 'Cartão de débito' },
    { id: 'pix', label: 'Pix' },
  ];

  const caixaActions = [
    {
      id: 'abertura',
      label: 'Abertura de Caixa',
      icon: 'fa-door-open',
      requiresMotivo: false,
      requiresAmount: true,
      affectsPayments: true,
      hint:
        'Informe o valor inicial e selecione o meio de pagamento que receberá o valor de abertura.',
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
    selectedAction: null,
    searchResults: [],
    selectedProduct: null,
    quantidade: 1,
    itens: [],
    pagamentos: pagamentosCatalog.map((payment) => ({ ...payment, valor: 0 })),
    summary: { abertura: 0, recebido: 0, saldo: 0 },
    history: [],
    lastMovement: null,
    searchController: null,
  };

  const elements = {};
  let searchTimeout = null;

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
    if (product?.promocao?.ativa && safeNumber(product.promocao.porcentagem) > 0) {
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

    elements.itemValue = document.getElementById('pdv-item-value');
    elements.itemQuantity = document.getElementById('pdv-item-quantity');
    elements.itemTotal = document.getElementById('pdv-item-total');
    elements.addItem = document.getElementById('pdv-add-item');
    elements.quantityButtons = document.querySelectorAll('.quantity-button');

    elements.itemsList = document.getElementById('pdv-items-list');
    elements.itemsEmpty = document.getElementById('pdv-items-empty');
    elements.itemsCount = document.getElementById('pdv-items-count');
    elements.itemsTotal = document.getElementById('pdv-items-total');

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

    elements.summaryOpening = document.getElementById('pdv-summary-opening');
    elements.summaryReceived = document.getElementById('pdv-summary-received');
    elements.summaryBalance = document.getElementById('pdv-summary-balance');
    elements.summaryLastMove = document.getElementById('pdv-summary-last-move');

    elements.historyList = document.getElementById('pdv-history-list');
    elements.historyEmpty = document.getElementById('pdv-history-empty');
    elements.clearHistory = document.getElementById('pdv-clear-history');
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
  };

  const updateWorkspaceInfo = () => {
    const store = state.stores.find((item) => item._id === state.selectedStore);
    const pdv = state.pdvs.find((item) => item._id === state.selectedPdv);
    if (elements.companyLabel) {
      elements.companyLabel.textContent =
        store?.nome || store?.nomeFantasia || store?.razaoSocial || 'Empresa não identificada';
    }
    if (elements.pdvLabel) {
      elements.pdvLabel.textContent = pdv?.nome || pdv?.codigo || pdv?._id || 'PDV não identificado';
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
      elements.selectedPromoBadge.classList.toggle('hidden', !(finalPrice < basePrice));
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

  const renderItemsList = () => {
    if (!elements.itemsList || !elements.itemsEmpty || !elements.itemsCount || !elements.itemsTotal)
      return;
    elements.itemsList.innerHTML = '';
    if (!state.itens.length) {
      elements.itemsList.classList.add('hidden');
      elements.itemsEmpty.classList.remove('hidden');
      elements.itemsCount.textContent = '0 itens';
      elements.itemsTotal.textContent = formatCurrency(0);
      return;
    }
    const fragment = document.createDocumentFragment();
    state.itens.forEach((item, index) => {
      const li = document.createElement('li');
      li.dataset.index = String(index);
      li.className = 'flex items-center gap-3 py-3';
      li.innerHTML = `
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-800 truncate">${item.nome}</p>
          <p class="text-xs text-gray-500">Cód: ${item.codigo || '—'} • Qtde: ${item.quantidade}</p>
        </div>
        <div class="text-sm font-semibold text-gray-700">${formatCurrency(item.subtotal)}</div>
        <button type="button" class="text-xs text-red-500 hover:text-red-600" data-remove-index="${index}" aria-label="Remover item">
          <i class="fas fa-times"></i>
        </button>
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
  };

  const populatePaymentSelect = () => {
    if (!elements.paymentSelect) return;
    const previous = elements.paymentSelect.value;
    const options = state.pagamentos.map(
      (payment) => `<option value="${payment.id}">${payment.label}</option>`
    );
    elements.paymentSelect.innerHTML = options.join('');
    if (previous && state.pagamentos.some((payment) => payment.id === previous)) {
      elements.paymentSelect.value = previous;
    } else if (state.pagamentos.length) {
      elements.paymentSelect.value = state.pagamentos[0].id;
    }
    elements.paymentSelect.disabled = state.pagamentos.length === 0;
  };

  const updateSummary = () => {
    const total = state.pagamentos.reduce((sum, payment) => sum + payment.valor, 0);
    state.summary.saldo = total;
    state.summary.recebido = Math.max(total - state.summary.abertura, 0);
    if (elements.summaryOpening) {
      elements.summaryOpening.textContent = formatCurrency(state.summary.abertura);
    }
    if (elements.summaryReceived) {
      elements.summaryReceived.textContent = formatCurrency(state.summary.recebido);
    }
    if (elements.summaryBalance) {
      elements.summaryBalance.textContent = formatCurrency(state.summary.saldo);
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
      elements.paymentSelect.disabled = !action.affectsPayments;
      if (!action.affectsPayments && state.pagamentos.length) {
        elements.paymentSelect.value = state.pagamentos[0].id;
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

  const setPagamentosFromData = (data) => {
    const normalized = Array.isArray(data)
      ? data
      : pagamentosCatalog.map((payment) => ({
          ...payment,
          valor: safeNumber(data?.[payment.id]) || 0,
        }));
    state.pagamentos = pagamentosCatalog.map((payment) => {
      const match = normalized.find((item) => item.id === payment.id) || {};
      return { ...payment, valor: safeNumber(match.valor) };
    });
  };

  const resetPagamentos = () => {
    state.pagamentos = state.pagamentos.map((payment) => ({ ...payment, valor: 0 }));
    state.summary.abertura = 0;
    updateSummary();
    renderPayments();
  };

  const resetWorkspace = () => {
    state.caixaAberto = false;
    state.selectedAction = null;
    state.searchResults = [];
    state.selectedProduct = null;
    state.quantidade = 1;
    state.itens = [];
    state.summary = { abertura: 0, recebido: 0, saldo: 0 };
    state.history = [];
    state.lastMovement = null;
    state.pagamentos = pagamentosCatalog.map((payment) => ({ ...payment, valor: 0 }));
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }
    if (elements.searchResults) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
    }
    clearSelectedProduct();
    renderItemsList();
    renderPayments();
    renderHistory();
    setLastMovement(null);
    populatePaymentSelect();
    renderCaixaActions();
    updateActionDetails();
    updateSummary();
    updateStatusBadge();
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
    const pagamentosData = pdv?.caixa?.pagamentos || pdv?.pagamentos || {};
    setPagamentosFromData(pagamentosData);
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
        const badge = finalPrice < basePrice ? '<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Promo</span>' : '';
        const priceLine = finalPrice < basePrice
          ? `<span class="text-sm font-semibold text-primary">R$ ${toReais(finalPrice)}</span><span class="text-xs text-gray-400 line-through">R$ ${toReais(basePrice)}</span>`
          : `<span class="text-sm font-semibold text-gray-800">R$ ${toReais(finalPrice)}</span>`;
        const image = getImageUrl(product);
        return `
          <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary/5" data-result-index="${index}">
            <span class="h-14 w-14 flex items-center justify-center rounded border border-gray-200 bg-white overflow-hidden">
              ${image ? `<img src="${image}" alt="${product.nome}" class="h-full w-full object-contain">` : '<i class="fas fa-image text-gray-300"></i>'}
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-semibold text-gray-800 truncate">${product.nome || 'Produto sem nome'}</span>
              <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                ${priceLine}
                ${badge}
              </span>
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
    const nome = product?.nome || 'Produto sem nome';
    const existingIndex = state.itens.findIndex((item) => item.id === product._id || item.codigo === codigo);
    if (existingIndex >= 0) {
      const current = state.itens[existingIndex];
      current.quantidade += quantidade;
      current.subtotal = current.quantidade * current.valor;
    } else {
      state.itens.push({
        id: product._id || product.id || codigo || String(Date.now()),
        codigo,
        nome,
        quantidade,
        valor: unitPrice,
        subtotal,
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
    const fragment = document.createDocumentFragment();
    state.pagamentos.forEach((payment) => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3';
      li.innerHTML = `
        <div>
          <p class="text-sm font-semibold text-gray-700">${payment.label}</p>
          <p class="text-xs text-gray-500">Saldo registrado</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">R$</span>
          <input type="number" min="0" step="0.01" value="${payment.valor.toFixed(2)}" data-payment-input="${payment.id}" class="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right focus:border-primary focus:ring-2 focus:ring-primary/20" aria-label="Atualizar ${payment.label}">
          <span class="text-sm font-semibold text-gray-800" data-payment-display="${payment.id}">${formatCurrency(payment.valor)}</span>
        </div>
      `;
      fragment.appendChild(li);
    });
    elements.paymentList.innerHTML = '';
    elements.paymentList.appendChild(fragment);
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
    payment.valor = value < 0 ? 0 : value;
    input.value = payment.valor.toFixed(2);
    updatePaymentRow(id);
    updateSummary();
  };

  const handleResetPayments = () => {
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
    state.selectedAction = button.getAttribute('data-action');
    renderCaixaActions();
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
      state.caixaAberto = true;
      state.summary.abertura = amountValue;
      state.pagamentos = state.pagamentos.map((item) =>
        item.id === (payment?.id || '') ? { ...item, valor: amountValue } : item
      );
      addHistoryEntry(action, amountValue, motivo, payment?.label);
      notify(action.successMessage, 'success');
      setActiveTab('pdv-tab');
    } else if (action.id === 'fechamento') {
      if (!state.caixaAberto) {
        notify('Abra o caixa antes de realizar o fechamento.', 'warning');
        return;
      }
      const saldo = state.summary.saldo;
      addHistoryEntry(action, saldo, motivo, '', -Math.abs(saldo));
      state.caixaAberto = false;
      state.summary.abertura = 0;
      state.pagamentos = state.pagamentos.map((item) => ({ ...item, valor: 0 }));
      notify(action.successMessage, 'success');
    } else {
      if (!state.caixaAberto) {
        notify('Abra o caixa antes de registrar movimentações.', 'warning');
        return;
      }
      if (!payment) {
        notify('Selecione um meio de pagamento válido.', 'warning');
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
    state.selectedAction = null;
    renderCaixaActions();
    updateActionDetails();
    elements.actionAmount && (elements.actionAmount.value = '');
    elements.motivoInput && (elements.motivoInput.value = '');
  };

  const handleCompanyChange = async () => {
    const value = elements.companySelect?.value || '';
    state.selectedStore = value;
    state.selectedPdv = '';
    resetWorkspace();
    updateWorkspaceVisibility(false);
    populatePdvSelect();
    if (!value) {
      updateSelectionHint('Escolha a empresa para carregar os PDVs disponíveis.');
      return;
    }
    updateSelectionHint('Carregando PDVs disponíveis...');
    elements.pdvSelect.disabled = true;
    try {
      await fetchPdvs(value);
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
    elements.tabTriggers?.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const target = trigger.getAttribute('data-tab-target');
        if (target) setActiveTab(target);
      });
    });
  };

  const init = async () => {
    queryElements();
    resetWorkspace();
    updateWorkspaceVisibility(false);
    bindEvents();
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
