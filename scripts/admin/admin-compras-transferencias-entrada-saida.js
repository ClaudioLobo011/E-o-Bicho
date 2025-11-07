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
  };

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
    productCodeInput: document.getElementById('movement-product-code'),
    productNameInput: document.getElementById('movement-product-name'),
    productQuantityInput: document.getElementById('movement-product-quantity'),
    productCostInput: document.getElementById('movement-product-cost'),
    productNotesInput: document.getElementById('movement-product-notes'),
    productSuggestions: document.getElementById('movement-product-suggestions'),
    totalItems: document.getElementById('movement-total-items'),
    totalQuantity: document.getElementById('movement-total-quantity'),
    totalValue: document.getElementById('movement-total-value'),
    feedback: document.getElementById('movement-feedback'),
    dateInput: document.getElementById('movement-date'),
    referenceInput: document.getElementById('movement-reference'),
    notesInput: document.getElementById('movement-notes'),
  };

  const searchState = {
    timeout: null,
    lastTerm: '',
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

  function updateProductSuggestions(products) {
    if (!elements.productSuggestions) return;
    elements.productSuggestions.innerHTML = '';

    products.forEach((product) => {
      const option = document.createElement('option');
      const name = normalizeString(product?.nome);
      const sku = normalizeString(product?.cod);
      const barcode = normalizeString(product?.codbarras);
      const labelParts = [name];
      if (sku) labelParts.push(`SKU: ${sku}`);
      if (barcode) labelParts.push(`EAN: ${barcode}`);
      const label = labelParts.filter(Boolean).join(' • ');
      option.value = name || label || '';
      if (label && label !== option.value) {
        option.label = label;
      }
      option.dataset.id = product?._id ? String(product._id) : '';
      elements.productSuggestions.appendChild(option);
    });
  }

  async function searchProducts(term) {
    const normalizedTerm = normalizeString(term);
    if (!normalizedTerm) {
      return [];
    }

    const cacheKey = normalizedTerm.toLowerCase();
    if (state.productSearchCache.has(cacheKey)) {
      return state.productSearchCache.get(cacheKey);
    }

    const token = getToken();
    if (!token) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const url = `${API_CONFIG.BASE_URL}/inventory-adjustments/search-products?term=${encodeURIComponent(normalizedTerm)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.message || 'Não foi possível buscar produtos no momento.');
    }

    const data = await response.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    state.productSearchCache.set(cacheKey, products);
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

  function handleProductSearchInput() {
    if (searchState.timeout) {
      clearTimeout(searchState.timeout);
    }

    const term = normalizeString(elements.productNameInput?.value) || normalizeString(elements.productCodeInput?.value);
    if (!term || term.length < 2) {
      updateProductSuggestions([]);
      return;
    }

    searchState.timeout = setTimeout(async () => {
      try {
        const products = await searchProducts(term);
        updateProductSuggestions(products);
      } catch (error) {
        console.error('Erro ao carregar sugestões de produtos:', error);
      }
    }, 400);
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
    if (elements.productCodeInput) elements.productCodeInput.value = '';
    if (elements.productNameInput) elements.productNameInput.value = '';
    if (elements.productQuantityInput) elements.productQuantityInput.value = '';
    if (elements.productCostInput) elements.productCostInput.value = '';
    if (elements.productNotesInput) elements.productNotesInput.value = '';
    updateProductSuggestions([]);
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

    const codeTerm = normalizeString(elements.productCodeInput?.value);
    const nameTerm = normalizeString(elements.productNameInput?.value);
    const searchTerm = codeTerm || nameTerm;

    if (!searchTerm) {
      showFeedback('Informe o código ou nome do produto para adicionar um item.', 'error');
      (elements.productCodeInput || elements.productNameInput)?.focus();
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
      const product = await resolveProductByTerm(searchTerm, { codeTerm });
      const details = await fetchProductDetails(product._id);
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
        productId: String(product._id),
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
    updateProductSuggestions([]);
    setDefaultDate();
    hideFeedback();
    updateOperationUI();
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

  if (elements.productNameInput) {
    elements.productNameInput.addEventListener('input', handleProductSearchInput);
  }

  if (elements.productCodeInput) {
    elements.productCodeInput.addEventListener('input', handleProductSearchInput);
  }

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
})();
