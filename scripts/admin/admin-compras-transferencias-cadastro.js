(function () {
  const state = {
    stores: [],
    deposits: [],
    responsaveis: [],
    items: [],
  };

  const selectors = {
    form: document.getElementById('transfer-form'),
    numberInput: document.getElementById('transfer-number'),
    dateInput: document.getElementById('transfer-date'),
    originCompany: document.getElementById('origin-company'),
    originDeposit: document.getElementById('transfer-origin'),
    destinationCompany: document.getElementById('destination-company'),
    destinationDeposit: document.getElementById('transfer-destination'),
    responsibleInput: document.getElementById('transfer-responsible-search'),
    responsibleId: document.getElementById('transfer-responsible'),
    responsibleDataList: document.getElementById('responsible-list'),
    referenceInput: document.getElementById('transfer-reference'),
    notesInput: document.getElementById('transfer-notes'),
    vehicleInput: document.getElementById('transfer-vehicle'),
    driverInput: document.getElementById('transfer-driver'),
    addItemButton: document.getElementById('transfer-add-item'),
    itemsTableBody: document.getElementById('transfer-items-body'),
    totalVolume: document.getElementById('transfer-total-volume'),
    totalWeight: document.getElementById('transfer-total-weight'),
    totalValue: document.getElementById('transfer-total-value'),
    saveButton: document.getElementById('transfer-save-button'),
  };

  const modalSelectors = {
    container: document.getElementById('transfer-item-modal'),
    searchInput: document.getElementById('transfer-item-search'),
    results: document.getElementById('transfer-item-results'),
  };

  const searchState = {
    timeout: null,
    controller: null,
    lastResults: [],
  };

  const allowedRolesLabels = {
    admin: 'Admin',
    admin_master: 'Admin Master',
    funcionario: 'Funcionário',
  };

  function getToken() {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
      return loggedInUser?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token de autenticação.', error);
      return '';
    }
  }

  function formatCnpj(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length !== 14) return '';
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
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

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 'R$ 0,00';
    }
    return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return '0 kg';
    }
    return `${number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
  }

  function setTodayDate() {
    const input = selectors.dateInput;
    if (!input || input.value) return;
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    input.value = `${today.getFullYear()}-${month}-${day}`;
  }

  function buildStoreLabel(store) {
    const name = store?.nomeFantasia || store?.nome || 'Empresa sem nome';
    const cnpj = formatCnpj(store?.cnpj);
    return cnpj ? `${name} • CNPJ ${cnpj}` : name;
  }

  function populateCompanySelect(select) {
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '<option value="">Selecione</option>';
    state.stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store._id;
      option.textContent = buildStoreLabel(store);
      select.appendChild(option);
    });
    if (previousValue) {
      select.value = previousValue;
    }
  }

  function updateDepositSelect(companySelect, depositSelect) {
    if (!depositSelect) return;
    const previousValue = depositSelect.value;
    const companyId = companySelect?.value || '';
    depositSelect.innerHTML = '<option value="">Selecione</option>';
    if (!companyId) {
      depositSelect.disabled = true;
      return;
    }

    const availableDeposits = state.deposits.filter((deposit) => String(deposit.empresa) === String(companyId));
    if (!availableDeposits.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum depósito cadastrado para esta empresa';
      option.disabled = true;
      depositSelect.appendChild(option);
      depositSelect.disabled = false;
      depositSelect.value = '';
      return;
    }

    availableDeposits.forEach((deposit) => {
      const option = document.createElement('option');
      option.value = deposit._id;
      option.textContent = deposit.nome || 'Depósito sem nome';
      depositSelect.appendChild(option);
    });

    depositSelect.disabled = false;
    if (previousValue && availableDeposits.some((deposit) => String(deposit._id) === String(previousValue))) {
      depositSelect.value = previousValue;
    }
  }

  function buildResponsibleDisplay(user) {
    const name = user?.nomeCompleto || user?.apelido || user?.email;
    const roleLabel = allowedRolesLabels[user?.role] || 'Colaborador';
    const email = user?.email || '';
    return [name, roleLabel, email].filter(Boolean).join(' • ');
  }

  function populateResponsibleList() {
    const list = selectors.responsibleDataList;
    if (!list) return;
    list.innerHTML = '';
    state.responsaveis.forEach((user) => {
      const option = document.createElement('option');
      option.value = buildResponsibleDisplay(user);
      option.dataset.id = user._id;
      list.appendChild(option);
    });
  }

  function findResponsibleId(displayValue) {
    const list = selectors.responsibleDataList;
    if (!list) return '';
    const value = displayValue?.trim();
    if (!value) return '';
    const options = Array.from(list.options);
    const matched = options.find((option) => option.value === value && option.dataset.id);
    return matched?.dataset.id || '';
  }

  function handleResponsibleInputEvents() {
    if (!selectors.responsibleInput) return;

    selectors.responsibleInput.addEventListener('input', () => {
      selectors.responsibleId.value = '';
    });

    selectors.responsibleInput.addEventListener('change', () => {
      const id = findResponsibleId(selectors.responsibleInput.value);
      selectors.responsibleId.value = id;
      if (!id && selectors.responsibleInput.value) {
        showToast('Selecione um responsável válido a partir da lista sugerida.', 'warning', 4000);
      }
    });
  }

  function updateSummary() {
    const volumeTotal = state.items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      return sum + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);

    const weightTotal = state.items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const unitWeight = Number(item.unitWeight);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitWeight)) {
        return sum;
      }
      return sum + quantity * unitWeight;
    }, 0);

    const valueTotal = state.items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unitCost);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) {
        return sum;
      }
      return sum + quantity * unitCost;
    }, 0);

    if (selectors.totalVolume) {
      selectors.totalVolume.textContent = `${volumeTotal.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} unidades`;
    }
    if (selectors.totalWeight) {
      selectors.totalWeight.textContent = formatWeight(weightTotal);
    }
    if (selectors.totalValue) {
      selectors.totalValue.textContent = formatCurrency(valueTotal);
    }
  }

  function renderItemsTable() {
    const tbody = selectors.itemsTableBody;
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-gray-500">Nenhum item adicionado até o momento.</td></tr>';
      updateSummary();
      return;
    }

    const rows = state.items.map((item, index) => {
      const quantityValue = Number(item.quantity);
      const quantity = Number.isFinite(quantityValue) ? quantityValue : 0;
      const lot = escapeHtml(item.lot || '');
      const unit = escapeHtml(item.unit || '');
      const description = escapeHtml(item.description || 'Produto sem descrição');
      const sku = escapeHtml(item.sku || '—');
      const barcode = escapeHtml(item.barcode || '—');
      const validity = item.validity ? escapeHtml(item.validity) : '';

      return `
        <tr class="bg-white">
          <td class="px-4 py-3 align-top font-medium text-gray-800">
            <div class="flex flex-col">
              <span>${sku}</span>
              <span class="text-xs font-normal text-gray-500">EAN: ${barcode || '—'}</span>
            </div>
          </td>
          <td class="px-4 py-3 align-top text-gray-700">
            <span class="font-medium text-gray-800">${description}</span>
          </td>
          <td class="px-4 py-3 align-top">
            <input type="number" min="0.01" step="0.01" class="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" data-field="quantity" data-index="${index}" value="${quantity}">
          </td>
          <td class="px-4 py-3 align-top">
            <input type="text" class="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm uppercase focus:border-primary focus:ring-2 focus:ring-primary/20" data-field="unit" data-index="${index}" value="${unit}">
          </td>
          <td class="px-4 py-3 align-top">
            <input type="text" class="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" data-field="lot" data-index="${index}" value="${lot}">
          </td>
          <td class="px-4 py-3 align-top">
            <input type="date" class="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" data-field="validity" data-index="${index}" value="${validity}">
          </td>
          <td class="px-4 py-3 align-top text-right">
            <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition" data-action="remove-item" data-index="${index}">
              <i class="fas fa-trash"></i>
              Remover
            </button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join('');
    updateSummary();
  }

  function attachTableListeners() {
    const tbody = selectors.itemsTableBody;
    if (!tbody) return;

    tbody.addEventListener('input', (event) => {
      const target = event.target;
      const field = target?.dataset?.field;
      if (!field) return;
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.items.length) return;
      const item = state.items[index];
      if (!item) return;

      if (field === 'quantity') {
        const value = Number(target.value);
        if (Number.isFinite(value) && value > 0) {
          item.quantity = value;
        }
        updateSummary();
      } else if (field === 'unit') {
        item.unit = target.value.toUpperCase();
      } else if (field === 'lot') {
        item.lot = target.value;
      } else if (field === 'validity') {
        item.validity = target.value;
      }
    });

    tbody.addEventListener('change', (event) => {
      const target = event.target;
      if (target?.dataset?.field === 'quantity') {
        const index = Number(target.dataset.index);
        const value = Number(target.value);
        if (!Number.isFinite(value) || value <= 0) {
          target.value = state.items[index]?.quantity || 0;
          showToast('Informe uma quantidade maior que zero.', 'warning', 4000);
        }
      }
    });

    tbody.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="remove-item"]');
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.items.length) return;
      state.items.splice(index, 1);
      renderItemsTable();
      showToast('Item removido da transferência.', 'info');
    });
  }

  function resetModalState() {
    searchState.lastResults = [];
    if (modalSelectors.searchInput) {
      modalSelectors.searchInput.value = '';
    }
    if (modalSelectors.results) {
      modalSelectors.results.innerHTML = 'Digite ao menos três caracteres para localizar produtos cadastrados.';
    }
  }

  function closeModal() {
    if (searchState.controller) {
      searchState.controller.abort();
      searchState.controller = null;
    }
    if (modalSelectors.container) {
      modalSelectors.container.classList.add('hidden');
    }
    resetModalState();
  }

  function openModal() {
    if (!modalSelectors.container) return;
    modalSelectors.container.classList.remove('hidden');
    if (modalSelectors.searchInput) {
      setTimeout(() => modalSelectors.searchInput?.focus(), 120);
    }
  }

  function renderSearchResults(products) {
    if (!modalSelectors.results) return;
    if (!products.length) {
      modalSelectors.results.innerHTML = '<div class="text-center text-sm text-gray-500">Nenhum produto encontrado com os critérios informados.</div>';
      return;
    }

    const rows = products.map((product, index) => {
      const nome = escapeHtml(product.nome || 'Produto sem nome');
      const sku = escapeHtml(product.cod || '—');
      const barcode = escapeHtml(product.codbarras || '—');
      const unidade = escapeHtml(product.unidade || '');
      const peso = Number.isFinite(Number(product.peso)) ? `${Number(product.peso).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` : '—';

      return `
        <div class="mb-3 last:mb-0 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div class="font-semibold text-gray-800">${nome}</div>
              <div class="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>SKU: ${sku}</span>
                <span>EAN: ${barcode}</span>
                <span>Unidade: ${unidade || '—'}</span>
                <span>Peso: ${peso}</span>
              </div>
            </div>
            <button type="button" class="inline-flex items-center gap-2 self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary/90" data-action="select-product" data-index="${index}">
              <i class="fas fa-plus"></i>
              Adicionar
            </button>
          </div>
        </div>
      `;
    });

    modalSelectors.results.innerHTML = rows.join('');
  }

  async function searchProducts(term) {
    if (!term || term.length < 3) {
      if (modalSelectors.results) {
        modalSelectors.results.innerHTML = 'Digite ao menos três caracteres para localizar produtos cadastrados.';
      }
      return;
    }

    if (searchState.controller) {
      searchState.controller.abort();
    }

    searchState.controller = new AbortController();
    const signal = searchState.controller.signal;

    if (modalSelectors.results) {
      modalSelectors.results.innerHTML = '<div class="flex items-center gap-2 text-sm text-gray-500"><i class="fas fa-spinner fa-spin"></i> Pesquisando produtos...</div>';
    }

    try {
      const token = getToken();
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/transfers/search-products?term=${encodeURIComponent(term)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Não foi possível buscar produtos.');
      }

      const data = await response.json();
      const products = Array.isArray(data?.products) ? data.products : [];
      searchState.lastResults = products;
      renderSearchResults(products);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Erro ao pesquisar produtos:', error);
      if (modalSelectors.results) {
        modalSelectors.results.innerHTML = `<div class="text-sm text-red-600">${escapeHtml(error.message || 'Erro ao buscar produtos.')}</div>`;
      }
    }
  }

  function scheduleSearch(term) {
    if (searchState.timeout) {
      clearTimeout(searchState.timeout);
    }
    searchState.timeout = setTimeout(() => {
      searchProducts(term);
    }, 450);
  }

  function attachModalEvents() {
    if (!modalSelectors.container) return;

    modalSelectors.container.addEventListener('click', (event) => {
      const closeTarget = event.target.closest('[data-action="close-modal"]');
      if (closeTarget) {
        closeModal();
      }
    });

    if (modalSelectors.searchInput) {
      modalSelectors.searchInput.addEventListener('input', (event) => {
        const term = event.target.value.trim();
        if (!term) {
          if (modalSelectors.results) {
            modalSelectors.results.innerHTML = 'Digite ao menos três caracteres para localizar produtos cadastrados.';
          }
          return;
        }
        scheduleSearch(term);
      });

      modalSelectors.searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const term = event.target.value.trim();
          searchProducts(term);
        }
      });
    }

    if (modalSelectors.results) {
      modalSelectors.results.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action="select-product"]');
        if (!button) return;
        const index = Number(button.dataset.index);
        if (!Number.isInteger(index) || index < 0 || index >= searchState.lastResults.length) return;
        const product = searchState.lastResults[index];
        addProductToTransfer(product);
        closeModal();
      });
    }
  }

  function addProductToTransfer(product) {
    if (!product || !product._id) {
      showToast('Produto inválido selecionado.', 'error');
      return;
    }

    const existing = state.items.find((item) => item.productId === String(product._id));
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + 1;
      renderItemsTable();
      showToast('Quantidade do item atualizada.', 'info');
      return;
    }

    state.items.push({
      productId: String(product._id),
      sku: product.cod || '',
      barcode: product.codbarras || '',
      description: product.nome || '',
      quantity: 1,
      unit: product.unidade || '',
      lot: '',
      validity: '',
      unitWeight: Number(product.peso),
      unitCost: Number(product.custo),
    });

    renderItemsTable();
    showToast('Item adicionado à transferência.', 'success');
  }

  async function loadFormData() {
    try {
      const token = getToken();
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/transfers/form-data`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Não foi possível carregar os dados da transferência.');
      }

      const data = await response.json();
      state.stores = Array.isArray(data?.stores) ? data.stores : [];
      state.deposits = Array.isArray(data?.deposits) ? data.deposits : [];
      state.responsaveis = Array.isArray(data?.responsaveis) ? data.responsaveis : [];

      populateCompanySelect(selectors.originCompany);
      populateCompanySelect(selectors.destinationCompany);
      updateDepositSelect(selectors.originCompany, selectors.originDeposit);
      updateDepositSelect(selectors.destinationCompany, selectors.destinationDeposit);
      populateResponsibleList();
    } catch (error) {
      console.error('Erro ao carregar dados iniciais:', error);
      showModal({
        title: 'Erro ao carregar dados',
        message: error.message || 'Não foi possível carregar as empresas e colaboradores. Atualize a página e tente novamente.',
        confirmText: 'Entendi',
      });
    }
  }

  function resetForm() {
    selectors.form?.reset();
    selectors.responsibleId.value = '';
    setTodayDate();
    updateDepositSelect(selectors.originCompany, selectors.originDeposit);
    updateDepositSelect(selectors.destinationCompany, selectors.destinationDeposit);
    state.items = [];
    renderItemsTable();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectors.form) return;

    if (!state.items.length) {
      showModal({
        title: 'Itens obrigatórios',
        message: 'Adicione ao menos um item antes de salvar a transferência.',
        confirmText: 'Entendi',
      });
      return;
    }

    const invalidItem = state.items.find((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0);
    if (invalidItem) {
      showModal({
        title: 'Quantidade inválida',
        message: 'Todas as quantidades devem ser maiores que zero.',
        confirmText: 'Ajustar',
      });
      return;
    }

    if (!selectors.responsibleId.value) {
      showModal({
        title: 'Responsável não definido',
        message: 'Selecione um responsável válido na lista de colaboradores autorizados.',
        confirmText: 'Entendi',
      });
      selectors.responsibleInput?.focus();
      return;
    }

    const payload = {
      requestDate: selectors.dateInput?.value || '',
      originCompany: selectors.originCompany?.value || '',
      originDeposit: selectors.originDeposit?.value || '',
      destinationCompany: selectors.destinationCompany?.value || '',
      destinationDeposit: selectors.destinationDeposit?.value || '',
      responsible: selectors.responsibleId.value,
      referenceDocument: selectors.referenceInput?.value || '',
      observations: selectors.notesInput?.value || '',
      transport: {
        vehicle: selectors.vehicleInput?.value || '',
        driver: selectors.driverInput?.value || '',
      },
      items: state.items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        unit: item.unit || '',
        lot: item.lot || '',
        validity: item.validity || '',
      })),
    };

    const requiredFields = [
      payload.requestDate,
      payload.originCompany,
      payload.originDeposit,
      payload.destinationCompany,
      payload.destinationDeposit,
      payload.responsible,
    ];

    if (requiredFields.some((value) => !value)) {
      showModal({
        title: 'Campos obrigatórios',
        message: 'Preencha todos os campos obrigatórios da transferência.',
        confirmText: 'Entendi',
      });
      return;
    }

    const token = getToken();
    if (!token) {
      showModal({
        title: 'Sessão expirada',
        message: 'Sua sessão expirou. Faça login novamente para continuar.',
        confirmText: 'Fazer login',
        onConfirm: () => window.location.replace('/pages/login.html'),
      });
      return;
    }

    selectors.saveButton?.setAttribute('disabled', 'true');
    selectors.saveButton?.classList.add('opacity-70', 'cursor-not-allowed');

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || 'Não foi possível salvar a transferência.');
      }

      showToast('Transferência salva com sucesso!', 'success', 4000);

      if (selectors.numberInput) {
        const number = data?.transfer?.number;
        selectors.numberInput.value = Number.isFinite(Number(number)) ? `Transferência nº ${String(number).padStart(4, '0')}` : 'Gerado automaticamente';
      }

      resetForm();
    } catch (error) {
      console.error('Erro ao salvar transferência:', error);
      showModal({
        title: 'Erro ao salvar',
        message: error.message || 'Não foi possível salvar a transferência. Tente novamente mais tarde.',
        confirmText: 'Entendi',
      });
    } finally {
      selectors.saveButton?.removeAttribute('disabled');
      selectors.saveButton?.classList.remove('opacity-70', 'cursor-not-allowed');
    }
  }

  function attachFormEvents() {
    selectors.originCompany?.addEventListener('change', () => {
      updateDepositSelect(selectors.originCompany, selectors.originDeposit);
    });

    selectors.destinationCompany?.addEventListener('change', () => {
      updateDepositSelect(selectors.destinationCompany, selectors.destinationDeposit);
    });

    selectors.addItemButton?.addEventListener('click', () => {
      openModal();
    });

    selectors.form?.addEventListener('submit', handleSubmit);
  }

  function init() {
    setTodayDate();
    attachTableListeners();
    attachModalEvents();
    attachFormEvents();
    handleResponsibleInputEvents();
    renderItemsTable();
    loadFormData();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
