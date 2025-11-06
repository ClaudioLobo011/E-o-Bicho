(function () {
  const form = document.getElementById('inventory-movement-form');
  if (!form) {
    return;
  }

  const state = {
    operation: 'saida',
    items: [],
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
    itemsBody: document.getElementById('movement-items-body'),
    emptyStateRow: document.getElementById('movement-empty-state'),
    addItemButton: document.getElementById('movement-add-item'),
    productCodeInput: document.getElementById('movement-product-code'),
    productNameInput: document.getElementById('movement-product-name'),
    productQuantityInput: document.getElementById('movement-product-quantity'),
    productCostInput: document.getElementById('movement-product-cost'),
    productNotesInput: document.getElementById('movement-product-notes'),
    totalItems: document.getElementById('movement-total-items'),
    totalQuantity: document.getElementById('movement-total-quantity'),
    totalValue: document.getElementById('movement-total-value'),
    feedback: document.getElementById('movement-feedback'),
    dateInput: document.getElementById('movement-date'),
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
        <td class="px-4 py-3 text-gray-600">${item.code ? escapeHtml(item.code) : '—'}</td>
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

  function handleAddItem() {
    hideFeedback();
    const name = elements.productNameInput?.value.trim();
    const quantityRaw = elements.productQuantityInput?.value;
    const unitValueRaw = elements.productCostInput?.value;

    if (!name) {
      showFeedback('Informe a descrição do produto para adicionar um item.', 'error');
      elements.productNameInput?.focus();
      return;
    }

    const quantity = parseDecimal(quantityRaw);
    if (!quantity || quantity <= 0) {
      showFeedback('A quantidade deve ser maior que zero.', 'error');
      elements.productQuantityInput?.focus();
      return;
    }

    const unitValueParsed = parseDecimal(unitValueRaw);
    const hasUnitValue = unitValueParsed !== null && Number.isFinite(unitValueParsed);
    const unitValue = hasUnitValue ? unitValueParsed : 0;
    const item = {
      id: Date.now() + Math.random(),
      code: elements.productCodeInput?.value.trim() || '',
      name,
      quantity,
      unitValue,
      hasUnitValue,
      notes: elements.productNotesInput?.value.trim() || '',
    };

    state.items.push(item);
    resetItemInputs();
    renderItems();
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
    elements.operationRadios.forEach((radio) => {
      radio.checked = radio.value === 'saida';
    });
    setDefaultDate();
    hideFeedback();
    updateOperationUI();
  }

  function validateBeforeSubmit() {
    if (!state.items.length) {
      showFeedback('Adicione ao menos um item para registrar a movimentação de estoque.', 'error');
      return false;
    }

    const requiredFields = [
      document.getElementById('movement-company'),
      document.getElementById('movement-deposit'),
      document.getElementById('movement-date'),
      document.getElementById('movement-responsible'),
      elements.reasonSelect,
    ];

    const invalid = requiredFields.some((field) => field && !field.value);
    if (invalid) {
      showFeedback('Preencha todos os campos obrigatórios destacados no formulário.', 'error');
      return false;
    }

    hideFeedback();
    return true;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!validateBeforeSubmit()) {
      return;
    }

    const config = OPERATION_CONFIG[state.operation];
    const action = config ? config.label.toLowerCase() : 'movimentação';
    showFeedback(`A ${action} foi registrada localmente. Sincronize com o sistema para concluir.`, 'success');
  }

  elements.operationRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      state.operation = event.target.value === 'entrada' ? 'entrada' : 'saida';
      hideFeedback();
      updateOperationUI();
    });
  });

  if (elements.addItemButton) {
    elements.addItemButton.addEventListener('click', handleAddItem);
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

  setDefaultDate();
  updateOperationUI();
  renderItems();
})();
