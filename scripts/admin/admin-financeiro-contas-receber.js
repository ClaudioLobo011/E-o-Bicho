(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const RECEIVABLES_API = `${API_BASE}/accounts-receivable`;
  const BANK_ACCOUNTS_API = `${API_BASE}/bank-accounts`;
  const ACCOUNTING_ACCOUNTS_API = `${API_BASE}/accounting-accounts`;
  const PAYMENT_METHODS_API = `${API_BASE}/payment-methods`;

  const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
  });

  const state = {
    token: null,
    companies: [],
    customers: [],
    employees: [],
    activeCompany: '',
    previewInstallments: [],
    bankAccountOptions: [],
    paymentMethodOptions: [],
    lastCreatedCode: null,
    receivables: [],
    history: [],
    receivableCache: new Map(),
    currentEditing: null,
    isSaving: false,
    forecastTable: {
      search: '',
      sort: { key: 'dueDate', direction: 'asc' },
      manualOrder: [],
      draggingId: null,
      filters: {},
      filterSearch: {},
      range: { start: '', end: '' },
    },
  };

  const forecastColumns = [
    {
      key: 'customer',
      label: 'Cliente',
      minWidth: 64,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px] font-semibold text-gray-800',
      placeholder: 'Filtrar cliente',
    },
    {
      key: 'document',
      label: 'Documento',
      minWidth: 64,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      placeholder: 'Filtrar documento',
    },
    {
      key: 'dueDate',
      label: 'Vencimento',
      minWidth: 60,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      placeholder: 'Filtrar data',
      getComparable: (row) => new Date(row.dueDate || 0).getTime(),
      getDisplay: (row) => formatDateBR(row.dueDate),
    },
    {
      key: 'value',
      label: 'Valor',
      minWidth: 52,
      headerClass: 'px-3 py-2 text-right',
      cellClass: 'px-3 py-2.5 text-right text-[11px] font-semibold text-gray-900',
      placeholder: 'Filtrar valor',
      isNumeric: true,
      getComparable: (row) => (Number.isFinite(row.value) ? row.value : Number.NEGATIVE_INFINITY),
      getDisplay: (row) => (Number.isFinite(row.value) ? formatCurrencyBR(row.value) : ''),
    },
    {
      key: 'status',
      label: 'Status',
      minWidth: 52,
      headerClass: 'px-3 py-2 text-center',
      cellClass: 'px-3 py-2.5 text-center text-[11px]',
      placeholder: 'Filtrar status',
    },
  ];

  forecastColumns.forEach((column) => {
    state.forecastTable.filters[column.key] = '';
    state.forecastTable.filterSearch[column.key] = '';
  });

  const elements = {
    form: document.getElementById('receivable-form'),
    code: document.getElementById('receivable-code'),
    company: document.getElementById('receivable-company'),
    customer: document.getElementById('receivable-customer'),
    installments: document.getElementById('receivable-installments'),
    issue: document.getElementById('receivable-issue'),
    due: document.getElementById('receivable-duedate'),
    totalValue: document.getElementById('receivable-value'),
    bankAccount: document.getElementById('receivable-bank-account'),
    accountingAccount: document.getElementById('receivable-account'),
    document: document.getElementById('receivable-document'),
    paymentMethod: document.getElementById('receivable-payment-method'),
    documentNumber: document.getElementById('receivable-document-number'),
    responsible: document.getElementById('receivable-responsible'),
    forecast: document.getElementById('receivable-forecast'),
    uncollectible: document.getElementById('receivable-uncollectible'),
    protest: document.getElementById('receivable-protest'),
    notes: document.getElementById('receivable-notes'),
    generateButton: document.getElementById('receivable-generate'),
    installmentsBody: document.getElementById('receivable-installments-body'),
    forecastBody: document.getElementById('receivable-forecast-body'),
    summaryOpenTotal: document.getElementById('receivable-summary-open-total'),
    summaryOpenCount: document.getElementById('receivable-summary-open-count'),
    summaryFinalizedTotal: document.getElementById('receivable-summary-finalized-total'),
    summaryFinalizedCount: document.getElementById('receivable-summary-finalized-count'),
    summaryUncollectibleTotal: document.getElementById('receivable-summary-uncollectible-total'),
    summaryUncollectibleCount: document.getElementById('receivable-summary-uncollectible-count'),
    summaryProtestTotal: document.getElementById('receivable-summary-protest-total'),
    summaryProtestCount: document.getElementById('receivable-summary-protest-count'),
    historyBody: document.getElementById('receivable-history-body'),
    historyEmpty: document.getElementById('receivable-history-empty'),
    forecastSearch: document.getElementById('receivable-forecast-search'),
    forecastTable: document.getElementById('receivable-forecast-table'),
    forecastHead: document.getElementById('receivable-forecast-head'),
    forecastSortButtons: document.querySelectorAll('[data-forecast-sort]'),
    forecastRangeStart: document.getElementById('receivable-forecast-start'),
    forecastRangeEnd: document.getElementById('receivable-forecast-end'),
    saveButton: document.getElementById('receivable-save'),
    clearButton: document.getElementById('receivable-clear'),
  };

  const originalSaveButtonHTML = elements.saveButton ? elements.saveButton.innerHTML : '';

  function notify(message, type = 'info') {
    const text = String(message || '').trim();
    if (!text) return;
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      try {
        window.showToast(text, type);
        return;
      } catch (err) {
        console.error('notify/showToast', err);
      }
    }
    try {
      console.log(`[${type}]`, text); // eslint-disable-line no-console
    } catch (_) {
      /* no-op */
    }
  }

  function getAuthToken() {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return cached?.token || null;
    } catch (err) {
      console.error('accounts-receivable:getAuthToken', err);
      return null;
    }
  }

  function authHeaders(extra = {}) {
    const headers = { ...(extra || {}) };
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    return headers;
  }

  function formatCurrencyBR(value) {
    const numeric = typeof value === 'number' ? value : Number(value || 0);
    return currencyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
  }

  function toCurrencyNumber(value) {
    const numeric = typeof value === 'number' ? value : Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100) / 100;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(value) {
    if (value === null || value === undefined) return '';
    try {
      return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    } catch (err) {
      console.error('accounts-receivable:normalizeText', err);
      return String(value).toLowerCase();
    }
  }

  function buildSearchRegex(rawValue) {
    const normalized = normalizeText(rawValue || '').trim();
    if (!normalized) return null;

    const pattern = normalized
      .split('*')
      .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');

    if (!pattern) return null;

    try {
      return new RegExp(pattern, 'i');
    } catch (err) {
      console.error('accounts-receivable:buildSearchRegex', err);
      return null;
    }
  }

  function formatDateBR(value) {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return dateFormatter.format(date);
  }

  function getForecastDisplayValue(row, column) {
    if (typeof column.getDisplay === 'function') return column.getDisplay(row);
    if (column.key === 'status') {
      return row.statusLabel || row.status || '';
    }
    if (column.key === 'customer') return row.customer || '—';
    if (column.key === 'document') return row.document || '—';
    if (column.key === 'value') return Number.isFinite(row.value) ? formatCurrencyBR(row.value) : '';
    if (column.key === 'dueDate') return formatDateBR(row.dueDate);
    return row[column.key] ?? '';
  }

  function getForecastComparableValue(row, column) {
    if (typeof column.getComparable === 'function') return column.getComparable(row);
    const display = getForecastDisplayValue(row, column);
    if (typeof display === 'number') return display;
    return normalizeText(display);
  }

  function buildModalSelectOptions(baseOptions, selectedValue, selectedLabel, placeholder = 'Selecione...') {
    const result = [];
    const seen = new Set();
    if (placeholder) {
      result.push({ value: '', label: placeholder });
    }
    (Array.isArray(baseOptions) ? baseOptions : []).forEach((option) => {
      if (!option || !option.value) return;
      if (seen.has(option.value)) return;
      seen.add(option.value);
      result.push({ value: option.value, label: option.label || option.value });
    });
    if (selectedValue && !seen.has(selectedValue)) {
      result.push({ value: selectedValue, label: selectedLabel || selectedValue });
    }
    return { options: result, selected: selectedValue || '' };
  }

  function formatDateInputValue(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateInputValue(value) {
    if (!value) return null;
    const parts = String(value).split('-');
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map((part) => Number.parseInt(part, 10));
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function normalizeDateOnly(value) {
    const formatted = formatDateInputValue(value);
    if (!formatted) return null;
    return parseDateInputValue(formatted);
  }

  function getCurrentMonthRange() {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { start: formatDateInputValue(start) || '', end: formatDateInputValue(end) || '' };
  }

  function setForecastRange({ start = '', end = '', triggerRender = true } = {}) {
    state.forecastTable.range = { start, end };
    if (elements.forecastRangeStart) {
      elements.forecastRangeStart.value = start;
    }
    if (elements.forecastRangeEnd) {
      elements.forecastRangeEnd.value = end;
    }
    if (triggerRender) renderForecast();
  }

  function initializeForecastRange() {
    const defaults = getCurrentMonthRange();
    const start = elements.forecastRangeStart?.value || defaults.start;
    const end = elements.forecastRangeEnd?.value || defaults.end;
    setForecastRange({ start, end, triggerRender: false });
  }

  function clearSelect(select, placeholder) {
    if (!select) return;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    select.appendChild(option);
  }

  function setSelectOptions(select, options, placeholder) {
    if (!select) return;
    clearSelect(select, placeholder);
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.disabled = options.length === 0 && select.required;
  }

  function addMonths(date, months) {
    const base = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    if (Number.isNaN(base.getTime())) return null;
    const utcBase = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    const anchor = new Date(Date.UTC(utcBase.getUTCFullYear(), utcBase.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
    anchor.setUTCDate(Math.min(utcBase.getUTCDate(), lastDay));
    return anchor;
  }

  function buildInstallmentsPreview() {
    const totalValue = Number.parseFloat(elements.totalValue?.value || '0');
    const installmentsCount = Math.max(1, Number.parseInt(elements.installments?.value || '1', 10) || 1);
    const issueDate = parseDateInputValue(elements.issue?.value);
    const dueDate = parseDateInputValue(elements.due?.value);

    if (!issueDate || Number.isNaN(issueDate.getTime()) || !dueDate || Number.isNaN(dueDate.getTime())) {
      return [];
    }

    if (!(totalValue > 0)) {
      return [];
    }

    const centsTotal = Math.round(totalValue * 100);
    const baseCents = Math.floor(centsTotal / installmentsCount);
    const remainder = centsTotal - baseCents * installmentsCount;

    const bankAccountId = elements.bankAccount?.value || '';
    const accountingAccountId = elements.accountingAccount?.value || '';

    const result = [];
    for (let index = 0; index < installmentsCount; index += 1) {
      const amountCents = baseCents + (index < remainder ? 1 : 0);
      const value = amountCents / 100;
      const installmentDue = addMonths(dueDate, index);
      result.push({
        number: index + 1,
        value,
        issueDate,
        dueDate: installmentDue,
        bankAccountId,
        bankAccountLabel: null,
        accountingAccountId,
        accountingAccountLabel: null,
      });
    }

    state.previewInstallments = result;
    return result;
  }

  function getSelectedOptionLabel(select) {
    if (!select) return '';
    const option = select.options?.[select.selectedIndex];
    return option ? option.textContent.trim() : '';
  }

  function updateInstallmentsTable(installments, options = {}) {
    const {
      code = null,
      bankLabel = null,
      accountingLabel = null,
      editable = false,
    } = options;

    const tbody = elements.installmentsBody;
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!Array.isArray(installments) || installments.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.className = 'px-4 py-6 text-center text-sm text-gray-500';
      cell.textContent = 'Gere as parcelas para visualizar a distribuição.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    const total = installments.length;
    const displayCode = code || state.lastCreatedCode || 'Prévia';

    installments.forEach((installment, index) => {
      const row = document.createElement('tr');

      const codeCell = document.createElement('td');
      codeCell.className = 'px-4 py-3';
      codeCell.textContent = displayCode;
      row.appendChild(codeCell);

      const installmentCell = document.createElement('td');
      installmentCell.className = 'px-4 py-3';
      installmentCell.textContent = `${installment.number || index + 1}/${total}`;
      row.appendChild(installmentCell);

      const issueCell = document.createElement('td');
      issueCell.className = 'px-4 py-3';
      const issueValue = installment.issueDate || parseDateInputValue(elements.issue?.value);
      issueCell.textContent = formatDateBR(issueValue);
      row.appendChild(issueCell);

      const dueCell = document.createElement('td');
      dueCell.className = 'px-4 py-3';
      if (editable) {
        const dueInput = document.createElement('input');
        dueInput.type = 'date';
        dueInput.className = 'w-full rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';
        dueInput.value = formatDateInputValue(installment.dueDate);
        dueInput.addEventListener('change', (event) => {
          const newDate = parseDateInputValue(event.target.value);
          if (newDate) {
            installment.dueDate = newDate;
          }
        });
        dueCell.appendChild(dueInput);
      } else {
        dueCell.textContent = formatDateBR(installment.dueDate);
      }
      row.appendChild(dueCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-4 py-3 text-right';
      valueCell.textContent = formatCurrencyBR(installment.value);
      row.appendChild(valueCell);

      const bankCell = document.createElement('td');
      bankCell.className = 'px-4 py-3';
      if (editable) {
        const select = document.createElement('select');
        select.className = 'w-full rounded-lg border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';
        clearSelect(select, 'Selecione...');
        state.bankAccountOptions.forEach((option) => {
          const opt = document.createElement('option');
          opt.value = option.value;
          opt.textContent = option.label;
          select.appendChild(opt);
        });
        if (state.bankAccountOptions.length === 0) {
          select.disabled = true;
        }
        const currentValue =
          installment.bankAccountId
          || (typeof installment.bankAccount === 'string' ? installment.bankAccount : installment.bankAccount?._id)
          || elements.bankAccount?.value
          || '';
        if (currentValue) {
          select.value = currentValue;
        }
        const syncLabel = () => {
          const option = select.options[select.selectedIndex];
          // eslint-disable-next-line no-param-reassign
          installment.bankAccountId = select.value;
          // eslint-disable-next-line no-param-reassign
          installment.bankAccountLabel = option ? option.textContent : '';
        };
        syncLabel();
        select.addEventListener('change', syncLabel);
        bankCell.appendChild(select);
      } else {
        const label =
          installment.bankAccountLabel
          || installment.bankAccount?.label
          || bankLabel
          || '—';
        bankCell.textContent = label;
      }
      row.appendChild(bankCell);

      const accountingCell = document.createElement('td');
      accountingCell.className = 'px-4 py-3';
      const accountingLabelValue =
        installment.accountingAccountLabel
        || installment.accountingAccount?.label
        || accountingLabel
        || '—';
      accountingCell.textContent = accountingLabelValue;
      row.appendChild(accountingCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-3 text-center';
      if (editable) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50';
        removeButton.innerHTML = '<i class="fas fa-times"></i> Remover';
        removeButton.addEventListener('click', () => {
          removePreviewInstallment(index);
        });
        actionsCell.appendChild(removeButton);
      } else {
        actionsCell.textContent = '—';
      }
      row.appendChild(actionsCell);

      tbody.appendChild(row);
    });
  }

  function removePreviewInstallment(index) {
    if (!Array.isArray(state.previewInstallments)) return;
    if (index < 0 || index >= state.previewInstallments.length) return;
    state.previewInstallments.splice(index, 1);
    state.previewInstallments.forEach((installment, idx) => {
      if (installment && typeof installment === 'object') {
        // eslint-disable-next-line no-param-reassign
        installment.number = idx + 1;
      }
    });
    if (elements.installments) {
      const newLength = state.previewInstallments.length;
      elements.installments.value = String(newLength > 0 ? newLength : 1);
    }
    updateInstallmentsTable(state.previewInstallments, { editable: true });
  }

  function ensureSelectOption(select, value, label) {
    if (!select || !value) return;
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (!exists) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label || value;
      select.appendChild(option);
    }
  }

  function resetFormFields({ preserveCompany = true } = {}) {
    const companyValue = preserveCompany && elements.company ? elements.company.value : '';
    if (elements.form) {
      elements.form.reset();
    }
    if (elements.company) {
      elements.company.value = companyValue;
    }
    if (elements.code) {
      elements.code.value = 'Gerado automaticamente';
    }
    if (elements.issue) {
      elements.issue.value = formatDateInputValue(new Date());
    }
    if (elements.due) {
      elements.due.value = '';
    }
    if (elements.totalValue) {
      elements.totalValue.value = '';
    }
    if (elements.generateButton) {
      elements.generateButton.disabled = false;
    }
    state.previewInstallments = [];
    updateInstallmentsTable([], { editable: true });

    const companyId = elements.company?.value || '';
    state.activeCompany = companyId;
    loadBankAccounts(companyId);
    loadAccountingAccounts(companyId);
    loadPaymentMethods(companyId);

    if (elements.saveButton) {
      elements.saveButton.innerHTML = originalSaveButtonHTML;
      elements.saveButton.disabled = false;
    }
  }

  function normalizeReceivable(receivable) {
    if (!receivable) return null;
    const normalized = { ...receivable };
    normalized.id = receivable._id || receivable.id || '';
    normalized.code = receivable.code || '';
    normalized.company = receivable.company || null;
    normalized.customer = receivable.customer || null;
    normalized.totalValue = Number(receivable.totalValue || 0);
    normalized.installments = Array.isArray(receivable.installments)
      ? receivable.installments.map((installment, index) => {
          const computedStatus = computeStatus(receivable, installment);
          const normalizedStatus = canonicalStatus(installment?.status) || computedStatus;
          return {
            number: installment.number || index + 1,
            issueDate: installment.issueDate || receivable.issueDate || null,
            dueDate: installment.dueDate || receivable.dueDate || null,
            value: Number(installment.value || 0),
            originalValue: Number(
              installment.originalValue !== undefined && installment.originalValue !== null
                ? installment.originalValue
                : installment.value || 0
            ),
            paidValue: Number(installment.paidValue || 0),
            paidDate: installment.paidDate || null,
            bankAccountId:
              (installment.bankAccount && typeof installment.bankAccount === 'object'
                ? installment.bankAccount._id
                : installment.bankAccount) || '',
            bankAccountLabel:
              (installment.bankAccount && typeof installment.bankAccount === 'object'
                ? installment.bankAccount.label
                : '') || '',
            accountingAccountId:
              (installment.accountingAccount && typeof installment.accountingAccount === 'object'
                ? installment.accountingAccount._id
                : installment.accountingAccount) || '',
            accountingAccountLabel:
              (installment.accountingAccount && typeof installment.accountingAccount === 'object'
                ? installment.accountingAccount.label
                : '') || '',
            paymentMethodId:
              (installment.paymentMethod && typeof installment.paymentMethod === 'object'
                ? installment.paymentMethod._id
                : installment.paymentMethod) || '',
            paymentMethodLabel:
              (installment.paymentMethod && typeof installment.paymentMethod === 'object'
                ? installment.paymentMethod.name
                : installment.paymentMethodLabel) || '',
            paymentMethodType: (() => {
              const rawType =
                installment.paymentMethod && typeof installment.paymentMethod === 'object'
                  ? installment.paymentMethod.type
                  : installment.paymentMethodType || '';
              return typeof rawType === 'string' ? rawType.toLowerCase() : '';
            })(),
            paymentDocument: installment.paymentDocument || '',
            paymentNotes: installment.paymentNotes || '',
            residualValue: Number(installment.residualValue || 0),
            residualDueDate: installment.residualDueDate || null,
            originInstallmentNumber: installment.originInstallmentNumber || null,
            status: normalizedStatus,
          };
        })
      : [];
    normalized.installmentsCount =
      receivable.installmentsCount || (Array.isArray(normalized.installments) ? normalized.installments.length : 0) || 1;
    normalized.status = canonicalStatus(receivable.status) || computeStatus(normalized);
    normalized.forecast = !!receivable.forecast;
    normalized.uncollectible = !!receivable.uncollectible;
    normalized.protest = !!receivable.protest;
    normalized.document = receivable.document || '';
    normalized.documentNumber = receivable.documentNumber || '';
    normalized.issueDate = receivable.issueDate || null;
    normalized.dueDate = receivable.dueDate || null;
    normalized.bankAccount = receivable.bankAccount || null;
    normalized.accountingAccount = receivable.accountingAccount || null;
    normalized.paymentMethod = receivable.paymentMethod || null;
    normalized.notes = receivable.notes || '';
    return normalized;
  }

  function storeReceivableInCache(receivable) {
    if (!receivable || !receivable.id) return;
    state.receivableCache.set(receivable.id, receivable);
  }

  function getReceivableFromCache(id) {
    if (!id) return null;
    return state.receivableCache.get(id) || null;
  }

  function removeReceivableFromCache(id) {
    if (!id) return;
    state.receivableCache.delete(id);
  }

  function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar' }) {
    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && typeof window.showModal === 'function') {
        window.showModal({
          title,
          message,
          confirmText,
          cancelText,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      } else {
        // eslint-disable-next-line no-alert
        const result = window.confirm(message || 'Deseja prosseguir?');
        resolve(result);
      }
    });
  }

  function normalizeStatusToken(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    let normalized = trimmed;
    if (typeof normalized.normalize === 'function') {
      try {
        normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      } catch (error) {
        /* ignore */
      }
    }
    normalized = normalized.replace(/[^a-z0-9\s-]/gi, ' ');
    return normalized.replace(/[\s_-]+/g, ' ').trim().toLowerCase();
  }

  const FINALIZED_STATUS_KEYS = new Set([
    'received',
    'recebido',
    'recebida',
    'paid',
    'pago',
    'paga',
    'finalized',
    'finalizado',
    'finalizada',
    'quitado',
    'quitada',
    'liquidado',
    'liquidada',
    'baixado',
    'baixada',
    'compensado',
    'compensada',
    'settled',
    'concluido',
    'concluida',
  ]);

  const UNCOLLECTIBLE_STATUS_KEYS = new Set([
    'uncollectible',
    'incobravel',
    'impagavel',
    'perda',
    'perdido',
    'prejuizo',
    'writeoff',
  ]);

  const PROTEST_STATUS_KEYS = new Set([
    'protest',
    'protesto',
    'protestado',
    'protestada',
    'em protesto',
  ]);

  const OPEN_STATUS_KEYS = new Set([
    'open',
    'pending',
    'pendente',
    'aberto',
    'em aberto',
    'overdue',
    'vencido',
    'vencida',
    'atrasado',
    'atrasada',
    'late',
    'aguardando',
    'aguardando pagamento',
    'em atraso',
    'inadimplente',
    'inadimplencia',
    'partial',
    'parcial',
  ]);

  function canonicalStatus(value) {
    const token = normalizeStatusToken(value);
    if (!token) return '';
    if (FINALIZED_STATUS_KEYS.has(token)) return 'finalized';
    if (UNCOLLECTIBLE_STATUS_KEYS.has(token)) return 'uncollectible';
    if (PROTEST_STATUS_KEYS.has(token)) return 'protest';
    if (OPEN_STATUS_KEYS.has(token)) return 'open';
    return '';
  }

  function computeStatus(receivable, installment) {
    if (!receivable) return 'open';
    const receivableStatus = canonicalStatus(receivable.status);
    if (receivable.uncollectible || receivableStatus === 'uncollectible') {
      return 'uncollectible';
    }
    if (receivable.protest || receivableStatus === 'protest') {
      return 'protest';
    }

    const installmentStatus = canonicalStatus(installment?.status);
    if (installmentStatus === 'finalized') {
      return 'finalized';
    }
    if (installmentStatus === 'uncollectible') {
      return 'uncollectible';
    }
    if (installmentStatus === 'protest') {
      return 'protest';
    }

    if (receivableStatus === 'finalized') {
      return 'finalized';
    }

    const installments = Array.isArray(receivable.installments) ? receivable.installments : [];
    if (installments.length > 0) {
      const allFinalized = installments.every((item) => canonicalStatus(item?.status) === 'finalized');
      if (allFinalized) {
        return 'finalized';
      }
    }

    return 'open';
  }

  function buildStatusBadge(status) {
    const map = {
      open: {
        label: 'Em aberto',
        classes: 'bg-amber-100 text-amber-700',
        icon: 'fa-hourglass-half',
      },
      finalized: {
        label: 'Finalizado',
        classes: 'bg-emerald-100 text-emerald-700',
        icon: 'fa-circle-check',
      },
      uncollectible: {
        label: 'Impagável',
        classes: 'bg-slate-200 text-slate-700',
        icon: 'fa-ban',
      },
      protest: {
        label: 'Em protesto',
        classes: 'bg-purple-100 text-purple-700',
        icon: 'fa-gavel',
      },
    };

    const normalized = canonicalStatus(status) || 'open';
    return map[normalized] || map.open;
  }

  function updateSummary(summary = {}) {
    const open = summary.open || { count: 0, total: 0 };
    const finalized = summary.finalized || { count: 0, total: 0 };
    const uncollectible = summary.uncollectible || { count: 0, total: 0 };
    const protest = summary.protest || { count: 0, total: 0 };

    if (elements.summaryOpenTotal) {
      elements.summaryOpenTotal.textContent = formatCurrencyBR(open.total || 0);
    }
    if (elements.summaryOpenCount) {
      elements.summaryOpenCount.textContent = `${open.count || 0} lançamentos`;
    }
    if (elements.summaryFinalizedTotal) {
      elements.summaryFinalizedTotal.textContent = formatCurrencyBR(finalized.total || 0);
    }
    if (elements.summaryFinalizedCount) {
      elements.summaryFinalizedCount.textContent = `${finalized.count || 0} lançamentos`;
    }
    if (elements.summaryUncollectibleTotal) {
      elements.summaryUncollectibleTotal.textContent = formatCurrencyBR(uncollectible.total || 0);
    }
    if (elements.summaryUncollectibleCount) {
      elements.summaryUncollectibleCount.textContent = `${uncollectible.count || 0} lançamentos`;
    }
    if (elements.summaryProtestTotal) {
      elements.summaryProtestTotal.textContent = formatCurrencyBR(protest.total || 0);
    }
    if (elements.summaryProtestCount) {
      elements.summaryProtestCount.textContent = `${protest.count || 0} lançamentos`;
    }
  }

  function buildSummaryFromReceivables(receivables = []) {
    const summary = {
      open: { count: 0, total: 0 },
      finalized: { count: 0, total: 0 },
      uncollectible: { count: 0, total: 0 },
      protest: { count: 0, total: 0 },
    };

    const list = Array.isArray(receivables) ? receivables : [];
    list.forEach((receivable) => {
      const installments = Array.isArray(receivable?.installments) && receivable.installments.length
        ? receivable.installments
        : [
            {
              value: receivable?.totalValue,
              status: receivable?.status,
            },
          ];

      installments.forEach((installment) => {
        const normalizedStatus = canonicalStatus(installment?.status)
          || computeStatus(receivable, installment);
        const key = Object.prototype.hasOwnProperty.call(summary, normalizedStatus)
          ? normalizedStatus
          : 'open';
        const value = toCurrencyNumber(
          installment?.value !== undefined && installment?.value !== null
            ? installment.value
            : receivable?.totalValue
        );
        summary[key].count += 1;
        summary[key].total += value;
      });
    });

    summary.open.total = toCurrencyNumber(summary.open.total);
    summary.finalized.total = toCurrencyNumber(summary.finalized.total);
    summary.uncollectible.total = toCurrencyNumber(summary.uncollectible.total);
    summary.protest.total = toCurrencyNumber(summary.protest.total);

    return summary;
  }

  function mergeSummaries(primary, fallback) {
    const base = {
      open: { count: 0, total: 0 },
      finalized: { count: 0, total: 0 },
      uncollectible: { count: 0, total: 0 },
      protest: { count: 0, total: 0 },
    };

    const apply = (source) => {
      if (!source || typeof source !== 'object') return;
      Object.keys(base).forEach((key) => {
        const entry = source[key];
        if (!entry || typeof entry !== 'object') return;
        const count = Number(entry.count);
        if (Number.isFinite(count)) {
          base[key].count = count;
        }
        const total = Number(entry.total);
        if (Number.isFinite(total)) {
          base[key].total = total;
        }
      });
    };

    apply(primary);
    apply(fallback);

    return base;
  }

  async function handleUnauthorized(response) {
    if (response.status === 401 || response.status === 403) {
      notify('Sua sessão expirou. Faça login novamente.', 'error');
      setTimeout(() => {
        window.location.replace('/pages/login.html');
      }, 1500);
      return true;
    }
    return false;
  }

  async function loadOptions() {
    if (!elements.company) return;
    try {
      const response = await fetch(`${RECEIVABLES_API}/options`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar as opções do formulário.');
      }
      const data = await response.json();
      state.companies = Array.isArray(data.companies) ? data.companies : [];
      state.customers = Array.isArray(data.customers) ? data.customers : [];
      state.employees = Array.isArray(data.employees) ? data.employees : [];

      const companyOptions = state.companies.map((company) => ({
        value: company._id,
        label: company.name,
      }));
      const companyPlaceholder = companyOptions.length
        ? 'Selecione...'
        : 'Nenhuma empresa vinculada ao seu usuário';
      setSelectOptions(elements.company, companyOptions, companyPlaceholder);
      elements.company.disabled = companyOptions.length === 0;

      const customerOptions = state.customers.map((customer) => ({
        value: customer._id,
        label: customer.document ? `${customer.name} (${customer.document})` : customer.name,
      }));
      setSelectOptions(elements.customer, customerOptions, 'Selecione...');
      elements.customer.disabled = customerOptions.length === 0;

      const employeeOptions = state.employees.map((employee) => ({
        value: employee._id,
        label: employee.name,
      }));
      setSelectOptions(elements.responsible, employeeOptions, 'Selecione...');
      elements.responsible.disabled = false;
    } catch (error) {
      console.error('accounts-receivable:loadOptions', error);
      notify(error.message || 'Erro ao carregar as opções do formulário.', 'error');
    }
  }

  function setLoadingSelect(select, message) {
    if (!select) return;
    clearSelect(select, message);
    select.disabled = true;
  }

  async function loadBankAccounts(companyId) {
    if (!elements.bankAccount) return;
    if (!companyId) {
      setSelectOptions(elements.bankAccount, [], 'Selecione uma empresa');
      elements.bankAccount.disabled = true;
      state.bankAccountOptions = [];
      return;
    }
    const currentCompany = companyId;
    setLoadingSelect(elements.bankAccount, 'Carregando contas...');
    try {
      const response = await fetch(`${BANK_ACCOUNTS_API}?company=${encodeURIComponent(companyId)}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar as contas correntes.');
      }
      const data = await response.json();
      if (state.activeCompany !== currentCompany) return;
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const previousSelection = elements.bankAccount?.value || '';
      const options = accounts.map((account) => ({
        value: account._id,
        label: account.alias
          || [account.bankName, account.agency ? `Ag. ${account.agency}` : '', account.accountNumber && account.accountDigit
            ? `${account.accountNumber}-${account.accountDigit}`
            : account.accountNumber]
            .filter(Boolean)
            .join(' '),
      }));
      setSelectOptions(elements.bankAccount, options, options.length ? 'Selecione...' : 'Nenhuma conta cadastrada');
      elements.bankAccount.disabled = options.length === 0;
      if (previousSelection && options.some((option) => option.value === previousSelection)) {
        elements.bankAccount.value = previousSelection;
      }
      state.bankAccountOptions = options;
      const defaultBank = elements.bankAccount?.value || '';
      state.previewInstallments.forEach((installment) => {
        if (!options.some((option) => option.value === installment.bankAccount)) {
          installment.bankAccount = defaultBank;
        }
      });
      if (state.previewInstallments.length) {
        const bankLabel = getSelectedOptionLabel(elements.bankAccount);
        const accountingLabel = getSelectedOptionLabel(elements.accountingAccount);
        updateInstallmentsTable(state.previewInstallments, {
          bankLabel,
          accountingLabel,
          editable: true,
        });
      }
    } catch (error) {
      console.error('accounts-receivable:loadBankAccounts', error);
      notify(error.message || 'Erro ao carregar as contas correntes.', 'error');
      setSelectOptions(elements.bankAccount, [], 'Não foi possível carregar');
      elements.bankAccount.disabled = true;
      state.bankAccountOptions = [];
    }
  }

  async function loadAccountingAccounts(companyId) {
    if (!elements.accountingAccount) return;
    if (!companyId) {
      setSelectOptions(elements.accountingAccount, [], 'Selecione uma empresa');
      elements.accountingAccount.disabled = true;
      return;
    }
    const currentCompany = companyId;
    setLoadingSelect(elements.accountingAccount, 'Carregando contas...');
    try {
      const response = await fetch(`${ACCOUNTING_ACCOUNTS_API}?company=${encodeURIComponent(companyId)}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar as contas contábeis.');
      }
      const data = await response.json();
      if (state.activeCompany !== currentCompany) return;
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const options = accounts.map((account) => ({
        value: account._id,
        label: [account.code, account.name].filter(Boolean).join(' - '),
      }));
      setSelectOptions(elements.accountingAccount, options, options.length ? 'Selecione...' : 'Nenhuma conta cadastrada');
      elements.accountingAccount.disabled = options.length === 0;
    } catch (error) {
      console.error('accounts-receivable:loadAccountingAccounts', error);
      notify(error.message || 'Erro ao carregar as contas contábeis.', 'error');
      setSelectOptions(elements.accountingAccount, [], 'Não foi possível carregar');
      elements.accountingAccount.disabled = true;
    }
  }

  async function loadPaymentMethods(companyId) {
    if (!elements.paymentMethod) return;
    if (!companyId) {
      setSelectOptions(elements.paymentMethod, [], 'Selecione uma empresa');
      elements.paymentMethod.disabled = true;
      state.paymentMethodOptions = [];
      return;
    }
    const currentCompany = companyId;
    setLoadingSelect(elements.paymentMethod, 'Carregando meios...');
    try {
      const response = await fetch(`${PAYMENT_METHODS_API}?company=${encodeURIComponent(companyId)}`);
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar os meios de pagamento.');
      }
      const data = await response.json();
      if (state.activeCompany !== currentCompany) return;
      const methods = Array.isArray(data.paymentMethods) ? data.paymentMethods : [];
      const options = methods.map((method) => ({
        value: method._id,
        label: method.name,
        type: (method.type || '').toLowerCase(),
      }));
      setSelectOptions(elements.paymentMethod, options, options.length ? 'Selecione...' : 'Nenhum meio cadastrado');
      elements.paymentMethod.disabled = false;
      state.paymentMethodOptions = options;
    } catch (error) {
      console.error('accounts-receivable:loadPaymentMethods', error);
      notify(error.message || 'Erro ao carregar os meios de pagamento.', 'error');
      setSelectOptions(elements.paymentMethod, [], 'Não foi possível carregar');
      elements.paymentMethod.disabled = true;
      state.paymentMethodOptions = [];
    }
  }

  async function fetchReceivableById(id, { force = false } = {}) {
    if (!id) return null;
    if (!force) {
      const cached = getReceivableFromCache(id);
      if (cached) {
        return cached;
      }
    }
    const response = await fetch(`${RECEIVABLES_API}/${id}`, {
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
    if (!response.ok) {
      if (await handleUnauthorized(response)) return null;
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || `Erro ao carregar a conta a receber (${response.status}).`);
    }
    const data = await response.json();
    const normalized = normalizeReceivable(data.receivable || data);
    if (normalized) {
      storeReceivableInCache(normalized);
    }
    return normalized;
  }

  async function registerPayment(receivableId, payload = {}) {
    if (!receivableId) {
      throw new Error('Selecione um lançamento válido para registrar o pagamento.');
    }
    const response = await fetch(`${RECEIVABLES_API}/${receivableId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      if (await handleUnauthorized(response)) {
        return null;
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || 'Não foi possível registrar o pagamento.');
    }
    const data = await response.json();
    const normalized = normalizeReceivable(data.receivable || data);
    if (normalized) {
      storeReceivableInCache(normalized);
    }
    return normalized;
  }

  async function updateInstallmentStatus(receivableId, installmentNumber, status) {
    if (!receivableId) {
      throw new Error('Selecione um lançamento válido para atualizar o status.');
    }

    const normalizedNumber = Number.parseInt(installmentNumber, 10);
    if (!Number.isFinite(normalizedNumber) || normalizedNumber < 1) {
      throw new Error('Selecione a parcela que deseja atualizar.');
    }

    const response = await fetch(
      `${RECEIVABLES_API}/${receivableId}/installments/${normalizedNumber}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ status }),
      }
    );

    if (!response.ok) {
      if (await handleUnauthorized(response)) {
        return null;
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || 'Não foi possível atualizar o status da parcela.');
    }

    const data = await response.json();
    const normalized = normalizeReceivable(data.receivable || data);
    if (normalized) {
      storeReceivableInCache(normalized);
    }
    return normalized;
  }

  function ensureForecastTableLayout() {
    if (!elements.forecastTable) return;
    elements.forecastTable.style.tableLayout = 'fixed';
    elements.forecastTable.style.width = 'max-content';
    elements.forecastTable.style.minWidth = '100%';
  }

  function setForecastSort(key, desiredDirection = 'asc') {
    const current = state.forecastTable.sort || {};
    const nextDirection = current.key === key && current.direction === desiredDirection
      ? desiredDirection === 'asc'
        ? 'desc'
        : 'asc'
      : desiredDirection;
    state.forecastTable.sort = { key, direction: nextDirection };
    renderForecast();
    updateForecastSortIndicators();
  }

  function buildForecastTableHead() {
    if (!elements.forecastHead) return;
    elements.forecastHead.innerHTML = '';

    const row = document.createElement('tr');

    forecastColumns.forEach((column) => {
      const th = document.createElement('th');
      th.dataset.columnKey = column.key;
      th.className = `${column.headerClass || ''} relative align-top bg-gray-50 whitespace-nowrap`;

      const wrapper = document.createElement('div');
      wrapper.className = 'flex flex-col gap-1';

      const labelRow = document.createElement('div');
      labelRow.className = 'flex items-center justify-between gap-1';

      const label = document.createElement('span');
      label.textContent = column.label;
      label.className = 'flex-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-600';
      if (column.isNumeric) label.classList.add('text-right');
      labelRow.appendChild(label);

      const sortGroup = document.createElement('div');
      sortGroup.className = 'flex flex-col items-center justify-center gap-px text-gray-400';

      ['asc', 'desc'].forEach((direction) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.forecastSortButton = 'true';
        button.dataset.columnKey = column.key;
        button.dataset.sortDirection = direction;
        button.className = 'flex h-4 w-4 items-center justify-center rounded border border-transparent text-gray-400 transition';
        button.setAttribute(
          'aria-label',
          `Ordenar ${direction === 'asc' ? 'crescente' : 'decrescente'} por ${column.label}`
        );
        button.innerHTML = `<i class="fas fa-sort-${direction === 'asc' ? 'up' : 'down'} text-[10px]"></i>`;
        button.addEventListener('click', () => setForecastSort(column.key, direction));
        sortGroup.appendChild(button);
      });

      labelRow.appendChild(sortGroup);

      const filterRow = document.createElement('div');
      filterRow.className = 'flex items-center gap-1';

      const filter = document.createElement('input');
      filter.type = 'text';
      filter.placeholder = column.placeholder || 'Filtrar';
      filter.value = state.forecastTable.filters[column.key] || '';
      filter.className =
        'flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
      if (column.isNumeric) filter.classList.add('text-right');
      filter.addEventListener('input', (event) => {
        state.forecastTable.filters[column.key] = event.target.value || '';
        renderForecast();
      });

      const searchButton = document.createElement('button');
      searchButton.type = 'button';
      searchButton.className =
        'flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-primary/50 hover:text-primary';
      searchButton.setAttribute('aria-label', `Filtrar valores da coluna ${column.label}`);
      searchButton.innerHTML = '<i class="fas fa-magnifying-glass"></i>';
      searchButton.addEventListener('click', (event) => {
        event.preventDefault();
        filter.focus();
      });

      filterRow.append(filter, searchButton);

      wrapper.append(labelRow, filterRow);
      th.appendChild(wrapper);

      row.appendChild(th);
    });

    const actionsTh = document.createElement('th');
    actionsTh.className = 'px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-600';
    actionsTh.textContent = 'Ações';
    row.appendChild(actionsTh);

    elements.forecastHead.appendChild(row);
    updateForecastSortIndicators();
    ensureForecastTableLayout();
  }

  function renderForecast() {
    if (!elements.forecastBody) return;
    const tbody = elements.forecastBody;
    tbody.innerHTML = '';

    const receivables = Array.isArray(state.receivables) ? state.receivables : [];
    if (!receivables.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = forecastColumns.length + 1;
      cell.className = 'px-4 py-6 text-center text-sm text-gray-500';
      cell.textContent = 'Cadastre contas a receber para acompanhar a previsão.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    const rows = [];
    receivables.forEach((receivable) => {
      const installments = Array.isArray(receivable.installments) && receivable.installments.length
        ? receivable.installments
        : [
            {
              number: 1,
              dueDate: receivable.dueDate,
              value: receivable.totalValue,
              status: canonicalStatus(receivable.status) || computeStatus(receivable),
            },
          ];

      installments.forEach((installment) => {
        const bankAccountId =
          installment.bankAccountId
          || receivable.bankAccount?._id
          || (typeof receivable.bankAccount === 'string' ? receivable.bankAccount : '');
        const bankAccountLabel =
          installment.bankAccountLabel
          || receivable.bankAccount?.label
          || receivable.bankAccount?.alias
          || receivable.bankAccount?.name
          || '';
        const paymentMethodId =
          installment.paymentMethodId
          || receivable.paymentMethod?._id
          || (typeof receivable.paymentMethod === 'string' ? receivable.paymentMethod : '');
        const paymentMethodLabel =
          installment.paymentMethodLabel || receivable.paymentMethod?.name || '';
        const issueDate = installment.issueDate || receivable.issueDate || null;
        const notes = installment.paymentNotes || receivable.notes || '';
        const computedStatus = computeStatus(receivable, installment);
        const normalizedStatus = canonicalStatus(installment.status) || computedStatus;
        const badge = buildStatusBadge(normalizedStatus);
        const originRaw = installment.originInstallmentNumber;
        const originNumber = Number.parseInt(originRaw, 10);
        const isResidual = Number.isFinite(originNumber);
        const baseDocument =
          receivable.documentNumber || receivable.document || receivable.code || '—';
        const hasBaseDocument = baseDocument && baseDocument !== '—';
        const documentLabel = isResidual
          ? hasBaseDocument
            ? `${baseDocument} (Resíduo)`
            : 'Resíduo'
          : baseDocument;
        const paymentMethodType =
          (installment.paymentMethodType
            || (typeof receivable.paymentMethod?.type === 'string'
              ? receivable.paymentMethod.type
              : '')
            || ''
          ).toLowerCase();
        const rowId = `${receivable.id || receivable._id || 'sem-id'}-${installment.number || '1'}`;
        rows.push({
          receivableId: receivable.id || receivable._id,
          code: receivable.code || receivable.documentNumber || receivable.document || '—',
          customer: receivable.customer?.name || '—',
          document: documentLabel,
          dueDate: installment.dueDate || receivable.dueDate,
          value: installment.value || receivable.totalValue,
          status: normalizedStatus,
          statusLabel: badge.label || normalizedStatus,
          statusBadge: badge,
          installmentNumber: installment.number || null,
          originInstallmentNumber: isResidual ? originNumber : null,
          issueDate,
          bankAccountId,
          bankAccountLabel,
          paymentMethodId,
          paymentMethodLabel,
          paymentMethodType,
          notes,
          rowId,
        });
      });
    });

    const { start, end } = state.forecastTable.range || {};
    const startDate = parseDateInputValue(start);
    const endDate = parseDateInputValue(end);

    const filteredByRange = rows.filter((row) => {
      const dueDate = normalizeDateOnly(row.dueDate);
      if (!dueDate) return true;
      if (startDate && dueDate < startDate) return false;
      if (endDate && dueDate > endDate) return false;
      return true;
    });

    const filteredByColumns = filteredByRange.filter((row) =>
      forecastColumns.every((column) => {
        const term = state.forecastTable.filters[column.key] || '';
        const regex = buildSearchRegex(term);
        if (!regex) return true;
        const display = normalizeText(getForecastDisplayValue(row, column) || '');
        return regex.test(display);
      })
    );

    const searchRegex = buildSearchRegex(state.forecastTable.search);
    const filteredRows = searchRegex
      ? filteredByColumns.filter((row) => {
          const haystack = [
            row.customer,
            row.document,
            row.status,
            row.code,
            row.bankAccountLabel,
            row.paymentMethodLabel,
            row.notes,
          ]
            .map(normalizeText)
            .join(' ');
          return searchRegex.test(haystack);
        })
      : filteredByColumns;

    const sortKey = state.forecastTable.sort?.key || 'dueDate';
    const direction = state.forecastTable.sort?.direction === 'desc' ? -1 : 1;
    const manualOrder = Array.isArray(state.forecastTable.manualOrder)
      ? state.forecastTable.manualOrder
      : [];
    const targetColumn = forecastColumns.find((column) => column.key === sortKey);

    const sortedRows = [...filteredRows].sort((a, b) => {
      if (sortKey === 'manual' && manualOrder.length) {
        const indexA = manualOrder.indexOf(a.rowId);
        const indexB = manualOrder.indexOf(b.rowId);
        if (indexA !== -1 || indexB !== -1) {
          const safeA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
          const safeB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
          if (safeA !== safeB) return (safeA - safeB) * direction;
        }
      }

      if (!targetColumn) return 0;

      const valueA = getForecastComparableValue(a, targetColumn);
      const valueB = getForecastComparableValue(b, targetColumn);

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        if (!Number.isFinite(valueA) && !Number.isFinite(valueB)) return 0;
        if (!Number.isFinite(valueA)) return -1 * direction;
        if (!Number.isFinite(valueB)) return 1 * direction;
        if (valueA === valueB) return 0;
        return valueA > valueB ? direction : -direction;
      }

      return String(valueA || '').localeCompare(String(valueB || ''), 'pt-BR', {
        sensitivity: 'base',
        numeric: true,
      }) * direction;
    });

    const activeOrder = sortedRows.map((row) => row.rowId);
    if (sortKey !== 'manual' || !state.forecastTable.manualOrder.length) {
      state.forecastTable.manualOrder = activeOrder;
    }

    const fragment = document.createDocumentFragment();

    sortedRows.forEach((item) => {
      const row = document.createElement('tr');
      row.draggable = sortedRows.length > 1;
      row.dataset.forecastRowId = item.rowId;
      row.className = 'forecast-row';

      const applyDataset = (button) => {
        if (!button) return;
        button.dataset.id = item.receivableId || '';
        if (item.installmentNumber) {
          button.dataset.installment = String(item.installmentNumber);
        }
        if (Number.isFinite(item.originInstallmentNumber)) {
          button.dataset.origin = String(item.originInstallmentNumber);
        }
        if (item.customer) button.dataset.customer = item.customer;
        if (item.document) button.dataset.document = item.document;
        if (item.code) button.dataset.code = item.code;
        if (item.status) button.dataset.status = item.status;
        if (item.dueDate) {
          const parsedDue = new Date(item.dueDate);
          if (!Number.isNaN(parsedDue.getTime())) {
            button.dataset.due = parsedDue.toISOString();
          }
        }
        if (item.issueDate) {
          const parsedIssue = new Date(item.issueDate);
          if (!Number.isNaN(parsedIssue.getTime())) {
            button.dataset.issue = parsedIssue.toISOString();
          }
        }
        const valueRaw = Number(item.value || 0);
        const valueString = Number.isFinite(valueRaw) ? valueRaw.toFixed(2) : '0';
        button.dataset.value = valueString;
        if (item.bankAccountId) button.dataset.bankAccount = item.bankAccountId;
        if (item.bankAccountLabel) button.dataset.bankLabel = item.bankAccountLabel;
        if (item.paymentMethodId) button.dataset.paymentMethod = item.paymentMethodId;
        if (item.paymentMethodLabel) button.dataset.paymentLabel = item.paymentMethodLabel;
        if (item.paymentMethodType) button.dataset.paymentType = item.paymentMethodType;
        if (item.notes) button.dataset.notes = item.notes;
      };

      forecastColumns.forEach((column) => {
        const cell = document.createElement('td');
        cell.className = column.cellClass || '';

        if (column.key === 'status') {
          const badge = item.statusBadge || buildStatusBadge(item.status);
          const span = document.createElement('span');
          span.className = `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`;
          span.innerHTML = `<i class="fas ${badge.icon}"></i> ${badge.label}`;
          cell.appendChild(span);
        } else {
          cell.textContent = getForecastDisplayValue(item, column) || '—';
        }

        row.appendChild(cell);
      });

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-3 py-2.5';
      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'grid grid-cols-3 gap-1';
      actionsWrapper.style.maxWidth = '18rem';
      actionsWrapper.style.margin = '0 auto';
      actionsWrapper.style.justifyItems = 'stretch';
      actionsWrapper.style.alignItems = 'stretch';

      const baseActionClass =
        'inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold leading-tight transition-colors';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = `${baseActionClass} forecast-action-edit border-primary text-primary hover:bg-primary/10`;
      editButton.dataset.action = 'edit-forecast';
      applyDataset(editButton);
      editButton.innerHTML = '<i class="fas fa-pen"></i> Editar';
      actionsWrapper.appendChild(editButton);

      const payButton = document.createElement('button');
      payButton.type = 'button';
      payButton.className = `${baseActionClass} forecast-action-pay border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`;
      payButton.dataset.action = 'pay-forecast';
      applyDataset(payButton);
      payButton.innerHTML = '<i class="fas fa-hand-holding-dollar"></i> Pagar';
      actionsWrapper.appendChild(payButton);

      if (item.status !== 'finalized' && item.status !== 'uncollectible') {
        const uncollectibleButton = document.createElement('button');
        uncollectibleButton.type = 'button';
        uncollectibleButton.className = `${baseActionClass} forecast-action-uncollectible border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100`;
        uncollectibleButton.dataset.action = 'mark-uncollectible';
        applyDataset(uncollectibleButton);
        uncollectibleButton.innerHTML = '<i class="fas fa-ban"></i> Impagável';
        actionsWrapper.appendChild(uncollectibleButton);
      }

      if (item.status !== 'finalized' && item.status !== 'protest') {
        const protestButton = document.createElement('button');
        protestButton.type = 'button';
        protestButton.className = `${baseActionClass} forecast-action-protest border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`;
        protestButton.dataset.action = 'mark-protest';
        applyDataset(protestButton);
        protestButton.innerHTML = '<i class="fas fa-file-contract"></i> Protesto';
        actionsWrapper.appendChild(protestButton);
      }

      if (item.status === 'uncollectible' || item.status === 'protest') {
        const reopenButton = document.createElement('button');
        reopenButton.type = 'button';
        reopenButton.className = `${baseActionClass} forecast-action-reopen border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`;
        reopenButton.dataset.action = 'restore-installment';
        applyDataset(reopenButton);
        reopenButton.innerHTML = '<i class="fas fa-rotate-left"></i> Reabrir';
        actionsWrapper.appendChild(reopenButton);
      }

      const downloadButton = document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.className = `${baseActionClass} forecast-action-download border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100`;
      downloadButton.dataset.action = 'download-forecast';
      applyDataset(downloadButton);
      downloadButton.innerHTML = '<i class="fas fa-arrow-down"></i> Baixar';
      actionsWrapper.appendChild(downloadButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = `${baseActionClass} forecast-action-delete border-red-200 text-red-600 hover:bg-red-50`;
      deleteButton.dataset.action = 'delete-forecast';
      applyDataset(deleteButton);
      deleteButton.innerHTML = '<i class="fas fa-trash"></i> Excluir';
      actionsWrapper.appendChild(deleteButton);

      actionsCell.appendChild(actionsWrapper);

      row.appendChild(actionsCell);
      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
    updateForecastSortIndicators();
  }

  function updateForecastSortIndicators() {
    const activeKey = state.forecastTable.sort?.key || 'dueDate';
    const direction = state.forecastTable.sort?.direction || 'asc';
    const buttons = Array.from(
      elements.forecastHead?.querySelectorAll('[data-forecast-sort-button]') || []
    );
    buttons.forEach((button) => {
      const icon = button.querySelector('i');
      const key = button.dataset?.columnKey;
      const buttonDirection = button.dataset?.sortDirection;
      if (!icon || !key || !buttonDirection) return;
      icon.classList.remove('text-primary');
      button.classList.remove('text-primary', 'border-primary/40', 'bg-primary/5');
      if (key === activeKey && direction === buttonDirection) {
        icon.classList.add('text-primary');
        button.classList.add('text-primary', 'border-primary/40', 'bg-primary/5');
      }
    });
  }
  function renderHistory() {
    if (!elements.historyBody) return;
    const tbody = elements.historyBody;
    tbody.innerHTML = '';

    const historyItems = Array.isArray(state.history) ? state.history : [];
    const hasCustomerFilter = !!(elements.customer?.value);

    if (!historyItems.length) {
      if (elements.historyEmpty) {
        elements.historyEmpty.textContent = hasCustomerFilter
          ? 'Nenhum lançamento encontrado para o cliente selecionado.'
          : 'Nenhum lançamento encontrado no histórico.';
        elements.historyEmpty.classList.remove('hidden');
      }
      return;
    }

    if (elements.historyEmpty) {
      elements.historyEmpty.classList.add('hidden');
    }

    const rows = [];
    historyItems.forEach((receivable) => {
      const installments = Array.isArray(receivable.installments) && receivable.installments.length
        ? receivable.installments
        : [
            {
              number: 1,
              dueDate: receivable.dueDate,
              value: receivable.totalValue,
              status: canonicalStatus(receivable.status) || computeStatus(receivable),
            },
          ];

      installments.forEach((installment) => {
        const bankAccountId =
          installment.bankAccountId
          || receivable.bankAccount?._id
          || (typeof receivable.bankAccount === 'string' ? receivable.bankAccount : '');
        const bankAccountLabel =
          installment.bankAccountLabel
          || receivable.bankAccount?.label
          || receivable.bankAccount?.alias
          || receivable.bankAccount?.name
          || '';
        const paymentMethodId =
          installment.paymentMethodId
          || receivable.paymentMethod?._id
          || (typeof receivable.paymentMethod === 'string' ? receivable.paymentMethod : '');
        const paymentMethodLabel =
          installment.paymentMethodLabel || receivable.paymentMethod?.name || '';
        const issueDate = installment.issueDate || receivable.issueDate || null;
        const notes = installment.paymentNotes || receivable.notes || '';
        const computedStatus = computeStatus(receivable, installment);
        const normalizedStatus = canonicalStatus(installment.status) || computedStatus;
        const originRaw = installment.originInstallmentNumber;
        const originNumber = Number.parseInt(originRaw, 10);
        const isResidual = Number.isFinite(originNumber);
        const baseDocument =
          receivable.documentNumber || receivable.document || receivable.code || '—';
        const hasBaseDocument = baseDocument && baseDocument !== '—';
        const documentLabel = isResidual
          ? hasBaseDocument
            ? `${baseDocument} (Resíduo)`
            : 'Resíduo'
          : baseDocument;
        const paymentMethodType =
          (installment.paymentMethodType
            || (typeof receivable.paymentMethod?.type === 'string'
              ? receivable.paymentMethod.type
              : '')
            || ''
          ).toLowerCase();
        rows.push({
          receivableId: receivable.id || receivable._id,
          code: receivable.code || receivable.documentNumber || receivable.document || '—',
          customer: receivable.customer?.name || '—',
          document: documentLabel,
          dueDate: installment.dueDate || receivable.dueDate,
          value: installment.value || receivable.totalValue,
          status: normalizedStatus,
          installmentNumber: installment.number || null,
          originInstallmentNumber: isResidual ? originNumber : null,
          issueDate,
          bankAccountId,
          bankAccountLabel,
          paymentMethodId,
          paymentMethodLabel,
          paymentMethodType,
          notes,
        });
      });
    });

    rows.sort((a, b) => {
      const timeA = new Date(a.dueDate || 0).getTime();
      const timeB = new Date(b.dueDate || 0).getTime();
      return timeA - timeB;
    });

    rows.forEach((item) => {
      const row = document.createElement('tr');
      let dueISO = '';
      if (item.dueDate) {
        const parsedDue = new Date(item.dueDate);
        if (!Number.isNaN(parsedDue.getTime())) {
          dueISO = parsedDue.toISOString();
        }
      }
      let issueISO = '';
      if (item.issueDate) {
        const parsedIssue = new Date(item.issueDate);
        if (!Number.isNaN(parsedIssue.getTime())) {
          issueISO = parsedIssue.toISOString();
        }
      }
      const valueRaw = Number(item.value || 0);
      const valueString = Number.isFinite(valueRaw) ? valueRaw.toFixed(2) : '0';

      const applyDataset = (button) => {
        if (!button) return;
        button.dataset.id = item.receivableId || '';
        if (item.installmentNumber) {
          button.dataset.installment = String(item.installmentNumber);
        }
        if (Number.isFinite(item.originInstallmentNumber)) {
          button.dataset.origin = String(item.originInstallmentNumber);
        }
        if (item.customer) button.dataset.customer = item.customer;
        if (item.document) button.dataset.document = item.document;
        if (item.code) button.dataset.code = item.code;
        if (item.status) button.dataset.status = item.status;
        if (dueISO) button.dataset.due = dueISO;
        if (issueISO) button.dataset.issue = issueISO;
        button.dataset.value = valueString;
        if (item.bankAccountId) button.dataset.bankAccount = item.bankAccountId;
        if (item.bankAccountLabel) button.dataset.bankLabel = item.bankAccountLabel;
        if (item.paymentMethodId) button.dataset.paymentMethod = item.paymentMethodId;
        if (item.paymentMethodLabel) button.dataset.paymentLabel = item.paymentMethodLabel;
        if (item.paymentMethodType) button.dataset.paymentType = item.paymentMethodType;
        if (item.notes) button.dataset.notes = item.notes;
      };

      const customerCell = document.createElement('td');
      customerCell.className = 'px-4 py-3';
      customerCell.textContent = item.customer;
      row.appendChild(customerCell);

      const docCell = document.createElement('td');
      docCell.className = 'px-4 py-3';
      docCell.textContent = item.document;
      row.appendChild(docCell);

      const dueCell = document.createElement('td');
      dueCell.className = 'px-4 py-3';
      dueCell.textContent = formatDateBR(item.dueDate);
      row.appendChild(dueCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-4 py-3 text-right';
      valueCell.textContent = formatCurrencyBR(item.value);
      row.appendChild(valueCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-3 text-center';
      const badge = buildStatusBadge(item.status);
      const span = document.createElement('span');
      span.className = `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`;
      span.innerHTML = `<i class="fas ${badge.icon}"></i> ${badge.label}`;
      statusCell.appendChild(span);
      row.appendChild(statusCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-3';
      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'grid grid-cols-3 gap-1';
      actionsWrapper.style.maxWidth = '18rem';
      actionsWrapper.style.margin = '0 auto';
      actionsWrapper.style.justifyItems = 'stretch';
      actionsWrapper.style.alignItems = 'stretch';

      const baseActionClass =
        'inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold leading-tight transition-colors';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = `${baseActionClass} history-action-edit border-primary text-primary hover:bg-primary/10`;
      editButton.dataset.action = 'edit-history';
      applyDataset(editButton);
      editButton.innerHTML = '<i class="fas fa-pen"></i> Editar';
      actionsWrapper.appendChild(editButton);

      const payButton = document.createElement('button');
      payButton.type = 'button';
      payButton.className = `${baseActionClass} history-action-pay border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`;
      payButton.dataset.action = 'pay-history';
      applyDataset(payButton);
      payButton.innerHTML = '<i class="fas fa-hand-holding-dollar"></i> Pagar';
      actionsWrapper.appendChild(payButton);

      if (item.status !== 'finalized' && item.status !== 'uncollectible') {
        const uncollectibleButton = document.createElement('button');
        uncollectibleButton.type = 'button';
        uncollectibleButton.className = `${baseActionClass} history-action-uncollectible border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100`;
        uncollectibleButton.dataset.action = 'mark-uncollectible';
        applyDataset(uncollectibleButton);
        uncollectibleButton.innerHTML = '<i class="fas fa-ban"></i> Impagável';
        actionsWrapper.appendChild(uncollectibleButton);
      }

      if (item.status !== 'finalized' && item.status !== 'protest') {
        const protestButton = document.createElement('button');
        protestButton.type = 'button';
        protestButton.className = `${baseActionClass} history-action-protest border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`;
        protestButton.dataset.action = 'mark-protest';
        applyDataset(protestButton);
        protestButton.innerHTML = '<i class="fas fa-file-contract"></i> Protesto';
        actionsWrapper.appendChild(protestButton);
      }

      if (item.status === 'uncollectible' || item.status === 'protest') {
        const reopenButton = document.createElement('button');
        reopenButton.type = 'button';
        reopenButton.className = `${baseActionClass} history-action-reopen border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`;
        reopenButton.dataset.action = 'restore-installment';
        applyDataset(reopenButton);
        reopenButton.innerHTML = '<i class="fas fa-rotate-left"></i> Reabrir';
        actionsWrapper.appendChild(reopenButton);
      }

      const downloadButton = document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.className = `${baseActionClass} history-action-download border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100`;
      downloadButton.dataset.action = 'download-history';
      applyDataset(downloadButton);
      downloadButton.innerHTML = '<i class="fas fa-arrow-down"></i> Baixar';
      actionsWrapper.appendChild(downloadButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = `${baseActionClass} history-action-delete border-red-200 text-red-600 hover:bg-red-50`;
      deleteButton.dataset.action = 'delete-history';
      applyDataset(deleteButton);
      deleteButton.innerHTML = '<i class="fas fa-trash"></i> Excluir';
      actionsWrapper.appendChild(deleteButton);

      actionsCell.appendChild(actionsWrapper);

      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });
  }

  function extractActionContext(target) {
    const button = target.closest('button[data-action]');
    if (!button) return null;
    const installmentRaw = button.dataset.installment;
    const installmentNumber = installmentRaw ? Number.parseInt(installmentRaw, 10) : null;
    const valueRaw = button.dataset.value;
    const dueRaw = button.dataset.due;
    const issueRaw = button.dataset.issue;
    let parsedValue = Number.parseFloat(valueRaw || '0');
    if (!Number.isFinite(parsedValue)) {
      parsedValue = 0;
    }
    return {
      action: button.dataset.action,
      receivableId: button.dataset.id || '',
      installmentNumber: Number.isFinite(installmentNumber) ? installmentNumber : null,
      customer: button.dataset.customer || '',
      document: button.dataset.document || '',
      code: button.dataset.code || '',
      dueDate: dueRaw ? new Date(dueRaw) : null,
      issueDate: issueRaw ? new Date(issueRaw) : null,
      value: parsedValue,
      status: button.dataset.status || '',
      bankAccountId: button.dataset.bankAccount || '',
      bankAccountLabel: button.dataset.bankLabel || '',
      paymentMethodId: button.dataset.paymentMethod || '',
      paymentMethodLabel: button.dataset.paymentLabel || '',
      paymentMethodType: button.dataset.paymentType || '',
      notes: button.dataset.notes || '',
    };
  }

  async function handleInstallmentStatusAction(context, targetStatus) {
    if (!context?.receivableId || !context?.installmentNumber) {
      notify('Selecione uma parcela válida para atualizar o status.', 'warning');
      return;
    }

    const currentCanonical = canonicalStatus(context.status);
    if (currentCanonical === 'finalized') {
      notify('Parcela quitada não pode ter o status alterado.', 'warning');
      return;
    }

    const desiredCanonical = targetStatus === 'pending' ? 'open' : targetStatus;
    if (currentCanonical === desiredCanonical) {
      notify('Status da parcela já está atualizado.', 'info');
      return;
    }

    const labels = {
      pending: 'Em aberto',
      uncollectible: 'Impagável',
      protest: 'Em protesto',
    };

    const label = labels[targetStatus] || targetStatus;
    const installmentLabel = context.installmentNumber
      ? `parcela ${context.installmentNumber}${context.code ? ` do lançamento ${context.code}` : ''}`
      : 'parcela selecionada';

    const confirmed = await confirmDialog({
      title: 'Atualizar status da parcela',
      message:
        targetStatus === 'pending'
          ? `Deseja reabrir a ${installmentLabel}?`
          : `Deseja marcar a ${installmentLabel} como ${label}?`,
      confirmText: targetStatus === 'pending' ? 'Reabrir parcela' : 'Atualizar status',
      cancelText: 'Cancelar',
    });

    if (!confirmed) {
      return;
    }

    try {
      const updated = await updateInstallmentStatus(
        context.receivableId,
        context.installmentNumber,
        targetStatus
      );
      if (!updated) {
        return;
      }
      notify('Status da parcela atualizado com sucesso.', 'success');
      await loadReceivables();
      await loadHistory();
    } catch (error) {
      console.error('accounts-receivable:handleInstallmentStatusAction', error);
      notify(error.message || 'Erro ao atualizar o status da parcela.', 'error');
    }
  }

  async function handleForecastTableClick(event) {
    const context = extractActionContext(event.target);
    if (!context || !context.receivableId) return;
    if (context.action === 'edit-forecast') {
      handleEditReceivable(context.receivableId, context.installmentNumber);
    } else if (context.action === 'pay-forecast') {
      await handlePayReceivable(context);
    } else if (context.action === 'mark-uncollectible') {
      await handleInstallmentStatusAction(context, 'uncollectible');
    } else if (context.action === 'mark-protest') {
      await handleInstallmentStatusAction(context, 'protest');
    } else if (context.action === 'restore-installment') {
      await handleInstallmentStatusAction(context, 'pending');
    } else if (context.action === 'download-forecast') {
      await handleDownloadReceivable(context);
    } else if (context.action === 'delete-forecast') {
      handleDeleteReceivable(context.receivableId, context.installmentNumber);
    }
  }

  function handleForecastSortClick(event) {
    const button = event.target.closest('[data-forecast-sort]');
    if (!button) return;
    const key = button.dataset.forecastSort;
    if (!key) return;

    const current = state.forecastTable.sort;
    let direction = 'asc';
    if (current?.key === key) {
      direction = current.direction === 'asc' ? 'desc' : 'asc';
    }

    state.forecastTable.sort = { key, direction };
    renderForecast();
  }

  function handleForecastRangeChange() {
    const start = elements.forecastRangeStart?.value || '';
    const end = elements.forecastRangeEnd?.value || '';
    const startDate = parseDateInputValue(start);
    const endDate = parseDateInputValue(end);
    if (startDate && endDate && startDate > endDate) {
      notify('A data inicial não pode ser maior que a data final.', 'warning');
      setForecastRange({ ...state.forecastTable.range, triggerRender: false });
      return;
    }
    setForecastRange({ start, end });
  }

  function handleForecastSearchInput(event) {
    state.forecastTable.search = event.target?.value || '';
    renderForecast();
  }

  function handleForecastDragStart(event) {
    const row = event.target.closest('tr[data-forecast-row-id]');
    if (!row) return;
    state.forecastTable.draggingId = row.dataset.forecastRowId;
    row.classList.add('opacity-60');
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleForecastDragOver(event) {
    const row = event.target.closest('tr[data-forecast-row-id]');
    if (!row) return;
    event.preventDefault();
    row.classList.add('bg-primary/5');
  }

  function handleForecastDragLeave(event) {
    const row = event.target.closest('tr[data-forecast-row-id]');
    if (!row) return;
    row.classList.remove('bg-primary/5');
  }

  function handleForecastDrop(event) {
    const targetRow = event.target.closest('tr[data-forecast-row-id]');
    if (!targetRow || !elements.forecastBody) return;
    event.preventDefault();

    const draggingId = state.forecastTable.draggingId;
    const targetId = targetRow.dataset.forecastRowId;
    if (!draggingId || !targetId || draggingId === targetId) return;

    const currentOrder = Array.from(elements.forecastBody.querySelectorAll('tr[data-forecast-row-id]')).map(
      (row) => row.dataset.forecastRowId
    );

    const fromIndex = currentOrder.indexOf(draggingId);
    const toIndex = currentOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    currentOrder.splice(fromIndex, 1);
    currentOrder.splice(toIndex, 0, draggingId);

    state.forecastTable.manualOrder = currentOrder;
    state.forecastTable.sort = { key: 'manual', direction: 'asc' };
    state.forecastTable.draggingId = null;

    renderForecast();
  }

  function handleForecastDragEnd(event) {
    const row = event.target.closest('tr[data-forecast-row-id]');
    if (row) {
      row.classList.remove('opacity-60', 'bg-primary/5');
    }
    state.forecastTable.draggingId = null;
  }

  async function handleHistoryTableClick(event) {
    const context = extractActionContext(event.target);
    if (!context || !context.receivableId) return;
    if (context.action === 'edit-history') {
      handleEditReceivable(context.receivableId, context.installmentNumber);
    } else if (context.action === 'pay-history') {
      await handlePayReceivable(context);
    } else if (context.action === 'mark-uncollectible') {
      await handleInstallmentStatusAction(context, 'uncollectible');
    } else if (context.action === 'mark-protest') {
      await handleInstallmentStatusAction(context, 'protest');
    } else if (context.action === 'restore-installment') {
      await handleInstallmentStatusAction(context, 'pending');
    } else if (context.action === 'download-history') {
      await handleDownloadReceivable(context);
    } else if (context.action === 'delete-history') {
      handleDeleteReceivable(context.receivableId, context.installmentNumber);
    }
  }

  async function loadReceivables() {
    try {
      const params = new URLSearchParams();
      if (state.activeCompany) {
        params.set('company', state.activeCompany);
      }
      const url = params.toString() ? `${RECEIVABLES_API}?${params.toString()}` : RECEIVABLES_API;
      const response = await fetch(url, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar as contas a receber.');
      }
      const data = await response.json();
      const receivables = Array.isArray(data.receivables)
        ? data.receivables.map(normalizeReceivable)
        : [];
      state.receivables = receivables;
      receivables.forEach(storeReceivableInCache);
      const computedSummary = buildSummaryFromReceivables(receivables);
      const normalizedSummary = mergeSummaries(data.summary || {}, computedSummary);
      updateSummary(normalizedSummary);
      renderForecast();
    } catch (error) {
      console.error('accounts-receivable:loadReceivables', error);
      notify(error.message || 'Erro ao carregar a previsão de recebimentos.', 'error');
      if (elements.forecastBody) {
        elements.forecastBody.innerHTML = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'px-4 py-6 text-center text-sm text-gray-500';
        cell.textContent = 'Não foi possível carregar os dados.';
        row.appendChild(cell);
        elements.forecastBody.appendChild(row);
      }
    }
  }

  async function loadHistory() {
    try {
      const params = new URLSearchParams();
      const customerId = elements.customer?.value || '';
      if (customerId) {
        params.set('customer', customerId);
      }
      if (state.activeCompany) {
        params.set('company', state.activeCompany);
      }
      const url = params.toString() ? `${RECEIVABLES_API}?${params.toString()}` : RECEIVABLES_API;
      const response = await fetch(url, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar o histórico de contas a receber.');
      }
      const data = await response.json();
      const historyItems = Array.isArray(data.receivables)
        ? data.receivables.map(normalizeReceivable)
        : [];
      state.history = historyItems;
      historyItems.forEach(storeReceivableInCache);
      renderHistory();
    } catch (error) {
      console.error('accounts-receivable:loadHistory', error);
      notify(error.message || 'Erro ao carregar o histórico de contas a receber.', 'error');
      state.history = [];
      renderHistory();
    }
  }

  async function enterEditMode(receivable, { focusInstallmentNumber = null } = {}) {
    if (!receivable) return;
    const companyId = receivable.company?._id || receivable.company?.id || receivable.company || '';
    if (elements.company) {
      ensureSelectOption(
        elements.company,
        companyId,
        receivable.company?.name || receivable.company?.nomeFantasia || receivable.company?.razaoSocial || 'Empresa'
      );
      elements.company.value = companyId;
    }
    state.activeCompany = companyId;

    await Promise.all([
      loadBankAccounts(companyId),
      loadAccountingAccounts(companyId),
      loadPaymentMethods(companyId),
    ]);

    const customerId = receivable.customer?._id || receivable.customer?.id || receivable.customer || '';
    if (elements.customer) {
      ensureSelectOption(elements.customer, customerId, receivable.customer?.name || 'Cliente');
      elements.customer.value = customerId;
    }

    const bankAccountId = receivable.bankAccount?._id || receivable.bankAccount || '';
    const bankLabel = receivable.bankAccount?.label || receivable.bankAccount?.name || '';
    if (elements.bankAccount && bankAccountId) {
      ensureSelectOption(elements.bankAccount, bankAccountId, bankLabel || 'Conta corrente');
      elements.bankAccount.value = bankAccountId;
    }

    const accountingAccountId = receivable.accountingAccount?._id || receivable.accountingAccount || '';
    const accountingLabel = receivable.accountingAccount?.label || '';
    if (elements.accountingAccount && accountingAccountId) {
      ensureSelectOption(elements.accountingAccount, accountingAccountId, accountingLabel || 'Conta contábil');
      elements.accountingAccount.value = accountingAccountId;
    }

    if (elements.paymentMethod) {
      const paymentMethodId = receivable.paymentMethod?._id || receivable.paymentMethod || '';
      if (paymentMethodId) {
        ensureSelectOption(elements.paymentMethod, paymentMethodId, receivable.paymentMethod?.name || 'Meio de pagamento');
        elements.paymentMethod.value = paymentMethodId;
      } else {
        elements.paymentMethod.value = '';
      }
    }

    if (elements.responsible) {
      const responsibleId = receivable.responsible?._id || receivable.responsible || '';
      if (responsibleId) {
        ensureSelectOption(elements.responsible, responsibleId, receivable.responsible?.name || 'Responsável');
        elements.responsible.value = responsibleId;
      } else {
        elements.responsible.value = '';
      }
    }

    if (elements.code) {
      elements.code.value = receivable.code || 'Gerado automaticamente';
    }
    if (elements.installments) {
      elements.installments.value = String(receivable.installmentsCount || receivable.installments?.length || 1);
    }
    if (elements.issue) {
      elements.issue.value = formatDateInputValue(receivable.issueDate) || '';
    }
    if (elements.due) {
      elements.due.value = formatDateInputValue(receivable.dueDate) || '';
    }
    if (elements.totalValue) {
      elements.totalValue.value = Number(receivable.totalValue || 0).toFixed(2);
    }
    if (elements.document) {
      elements.document.value = receivable.document || '';
    }
    if (elements.documentNumber) {
      elements.documentNumber.value = receivable.documentNumber || '';
    }
    if (elements.notes) {
      elements.notes.value = receivable.notes || '';
    }
    if (elements.forecast) {
      elements.forecast.checked = !!receivable.forecast;
    }
    if (elements.uncollectible) {
      elements.uncollectible.checked = !!receivable.uncollectible;
    }
    if (elements.protest) {
      elements.protest.checked = !!receivable.protest;
    }

    const installments = Array.isArray(receivable.installments) && receivable.installments.length
      ? receivable.installments
      : [
          {
            number: 1,
            issueDate: receivable.issueDate,
            dueDate: receivable.dueDate,
            value: receivable.totalValue,
            bankAccountId,
            bankAccountLabel: bankLabel,
            accountingAccountId,
            accountingAccountLabel: accountingLabel,
            status: canonicalStatus(receivable.status) || computeStatus(receivable) || 'open',
          },
        ];

    state.previewInstallments = installments.map((installment) => ({
      number: installment.number || 1,
      issueDate: installment.issueDate || receivable.issueDate || null,
      dueDate: installment.dueDate || receivable.dueDate || null,
      value: Number(installment.value || 0),
      bankAccountId: installment.bankAccountId || installment.bankAccount?._id || bankAccountId || '',
      bankAccountLabel:
        installment.bankAccountLabel
        || installment.bankAccount?.label
        || bankLabel
        || '',
      accountingAccountId:
        installment.accountingAccountId
        || installment.accountingAccount?._id
        || accountingAccountId
        || '',
      accountingAccountLabel:
        installment.accountingAccountLabel
        || installment.accountingAccount?.label
        || accountingLabel
        || '',
      status:
        canonicalStatus(installment.status)
          || canonicalStatus(receivable.status)
          || computeStatus(receivable, installment)
          || 'open',
    }));

    updateInstallmentsTable(state.previewInstallments, {
      code: receivable.code,
      bankLabel,
      accountingLabel,
      editable: true,
    });

    state.currentEditing = {
      id: receivable.id,
      focusInstallmentNumber: Number.isFinite(focusInstallmentNumber) ? focusInstallmentNumber : null,
    };

    if (elements.saveButton) {
      elements.saveButton.innerHTML = '<i class="fas fa-save"></i> Atualizar lançamento';
    }
  }

  function exitEditMode({ preserveCompany = true } = {}) {
    state.currentEditing = null;
    state.lastCreatedCode = null;
    resetFormFields({ preserveCompany });
  }

  async function handleEditReceivable(receivableId, installmentNumber) {
    if (!receivableId) {
      notify('Não foi possível identificar o lançamento selecionado.', 'warning');
      return;
    }
    try {
      const receivable = await fetchReceivableById(receivableId, { force: false });
      if (!receivable) {
        notify('Conta a receber não encontrada.', 'error');
        return;
      }
      await enterEditMode(receivable, { focusInstallmentNumber: installmentNumber });
    } catch (error) {
      console.error('accounts-receivable:handleEditReceivable', error);
      notify(error.message || 'Erro ao carregar o lançamento para edição.', 'error');
    }
  }

  async function performDeleteReceivable(receivableId, { deleteAll = false, installmentNumber = null } = {}) {
    let url = `${RECEIVABLES_API}/${receivableId}`;
    if (!deleteAll && installmentNumber) {
      const params = new URLSearchParams();
      params.set('installmentNumber', String(installmentNumber));
      url += `?${params.toString()}`;
    }
    const response = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
    if (response.status === 204) {
      return null;
    }
    if (!response.ok) {
      if (await handleUnauthorized(response)) return null;
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || `Erro ao excluir o lançamento (${response.status}).`);
    }
    const data = await response.json();
    const normalized = normalizeReceivable(data.receivable || data);
    if (normalized) {
      storeReceivableInCache(normalized);
    }
    return normalized;
  }

  async function handleDeleteReceivable(receivableId, installmentNumber) {
    if (!receivableId) {
      notify('Não foi possível identificar o lançamento selecionado.', 'warning');
      return;
    }
    try {
      const receivable = await fetchReceivableById(receivableId, { force: false });
      if (!receivable) {
        notify('Conta a receber não encontrada.', 'error');
        return;
      }

      const confirmRemoval = await confirmDialog({
        title: 'Excluir lançamento',
        message: 'Deseja realmente excluir este lançamento de contas a receber?',
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
      });
      if (!confirmRemoval) return;

      const totalInstallments = Array.isArray(receivable.installments) ? receivable.installments.length : 0;
      if (totalInstallments > 1 && installmentNumber) {
        const deleteAll = await confirmDialog({
          title: 'Excluir parcelas',
          message:
            'Excluir todas as parcelas deste lançamento? Escolha "Excluir todas" para remover o título completo ou "Somente esta" para remover apenas a parcela selecionada.',
          confirmText: 'Excluir todas',
          cancelText: 'Somente esta',
        });
        if (deleteAll) {
          await performDeleteReceivable(receivableId, { deleteAll: true });
          removeReceivableFromCache(receivableId);
          if (state.currentEditing?.id === receivableId) {
            exitEditMode({ preserveCompany: true });
          }
          notify('Lançamento excluído com sucesso.', 'success');
        } else {
          const confirmSingle = await confirmDialog({
            title: 'Excluir parcela',
            message: `Deseja excluir a parcela ${installmentNumber}?`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
          });
          if (!confirmSingle) return;
          const updated = await performDeleteReceivable(receivableId, {
            deleteAll: false,
            installmentNumber,
          });
          if (updated) {
            storeReceivableInCache(updated);
            if (state.currentEditing?.id === receivableId) {
              await enterEditMode(updated, { focusInstallmentNumber: null });
            }
            notify('Parcela excluída com sucesso.', 'success');
          } else {
            removeReceivableFromCache(receivableId);
            if (state.currentEditing?.id === receivableId) {
              exitEditMode({ preserveCompany: true });
            }
            notify('Lançamento excluído.', 'success');
          }
        }
      } else {
        await performDeleteReceivable(receivableId, { deleteAll: true });
        removeReceivableFromCache(receivableId);
        if (state.currentEditing?.id === receivableId) {
          exitEditMode({ preserveCompany: true });
        }
        notify('Lançamento excluído com sucesso.', 'success');
      }

      await loadReceivables();
      await loadHistory();
    } catch (error) {
      console.error('accounts-receivable:handleDeleteReceivable', error);
      notify(error.message || 'Não foi possível excluir o lançamento selecionado.', 'error');
    }
  }

  async function handleDownloadReceivable(context) {
    const customerLabel = context.customer || '—';
    const documentLabel = context.document || context.code || '—';
    const valueLabel = formatCurrencyBR(context.value || 0);
    const installmentLabel = context.installmentNumber
      ? `parcela ${context.installmentNumber}`
      : 'lançamento completo';

    const confirmed = await confirmDialog({
      title: 'Baixar comprovante',
      message: `Deseja gerar o comprovante do ${installmentLabel} para ${customerLabel} (doc.: ${documentLabel})?`,
      confirmText: 'Baixar',
      cancelText: 'Cancelar',
    });

    if (confirmed) {
      notify('Download do comprovante em preparação. Aguarde a geração do arquivo.', 'info');
    }
  }

  async function handlePayReceivable(context) {
    const customerLabel = context.customer || '—';
    const documentLabel = context.document || context.code || '—';
    const dueLabel = formatDateBR(context.dueDate);
    const issueLabel = formatDateBR(context.issueDate);
    const numericValue = Number.isFinite(context.value) ? context.value : Number(context.value || 0);
    const valueLabel = formatCurrencyBR(Number.isFinite(numericValue) ? numericValue : 0);
    const installmentLabel = context.installmentNumber
      ? `Parcela ${context.installmentNumber}`
      : 'Lançamento completo';

    if (typeof window !== 'undefined' && typeof window.showModal === 'function') {
      const paymentDateDefault = formatDateInputValue(new Date()) || '';
      const paidValueInput = Number.isFinite(numericValue) ? numericValue.toFixed(2) : '0.00';
      const paymentDocumentValue = context.document || context.code || '';
      const notesValue = context.notes || '';
      const totalValue = Number.isFinite(numericValue) ? numericValue : 0;
      const defaultPaidValue = Number.parseFloat(paidValueInput || '0');
      const residualThreshold = 0.009;
      const residualDefaultValue = Number.isFinite(defaultPaidValue)
        ? Math.max(totalValue - defaultPaidValue, 0)
        : Math.max(totalValue, 0);
      const residualDefaultLabel = formatCurrencyBR(residualDefaultValue);
      const residualDueDefault = formatDateInputValue(context.dueDate) || '';
      const bankOptionsData = buildModalSelectOptions(
        state.bankAccountOptions,
        context.bankAccountId,
        context.bankAccountLabel
      );
      const filteredPaymentMethodOptions = state.paymentMethodOptions.filter(
        (option) => (option.type || '').toLowerCase() !== 'crediario'
      );
      const selectedPaymentOption = state.paymentMethodOptions.find(
        (option) => option.value === context.paymentMethodId
      );
      const contextPaymentMethodType = (context.paymentMethodType || '').toLowerCase();
      const selectedPaymentMethodType = (
        selectedPaymentOption?.type
        || contextPaymentMethodType
        || ''
      ).toLowerCase();
      const isSelectedCrediario = selectedPaymentMethodType === 'crediario';
      const paymentMethodOptionsData = buildModalSelectOptions(
        filteredPaymentMethodOptions,
        isSelectedCrediario ? '' : context.paymentMethodId,
        isSelectedCrediario ? '' : context.paymentMethodLabel
      );
      const renderOptions = (optionData) =>
        optionData.options
          .map(
            (option) =>
              `<option value="${escapeHtml(option.value)}"${option.value === optionData.selected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`
          )
          .join('');
      const bankOptionsHtml = renderOptions(bankOptionsData);
      const paymentMethodOptionsHtml = renderOptions(paymentMethodOptionsData);
      const hasBankOptions = bankOptionsData.options.some((option) => option.value);
      const hasPaymentMethodOptions = paymentMethodOptionsData.options.some((option) => option.value);
      const residualSectionClass =
        'space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3' +
        (residualDefaultValue > residualThreshold ? '' : ' hidden');
      const messageHtml =
        `<form id="payment-confirm-form" class="space-y-4 text-sm text-gray-700">`
        + `<div class="rounded-lg bg-slate-50 p-3">`
        + `<p class="font-semibold text-gray-800">${escapeHtml(installmentLabel)}</p>`
        + `<ul class="mt-2 space-y-1 text-xs text-slate-600">`
        + `<li><span class="font-medium text-gray-700">Cliente:</span> ${escapeHtml(customerLabel)}</li>`
        + `<li><span class="font-medium text-gray-700">Documento:</span> ${escapeHtml(documentLabel)}</li>`
        + `<li><span class="font-medium text-gray-700">Emissão:</span> ${escapeHtml(issueLabel)}</li>`
        + `<li><span class="font-medium text-gray-700">Vencimento:</span> ${escapeHtml(dueLabel)}</li>`
        + `<li><span class="font-medium text-gray-700">Valor:</span> ${escapeHtml(valueLabel)}</li>`
        + `</ul>`
        + `</div>`
        + `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-gray-600">Data de pagamento</span>`
        + `<input type="date" name="paymentDate" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="${escapeHtml(paymentDateDefault)}" required>`
        + `</label>`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-gray-600">Valor pago</span>`
        + `<input type="number" step="0.01" min="0" name="paidValue" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="${escapeHtml(paidValueInput)}" required>`
        + `</label>`
        + `</div>`
        + `<div class="${residualSectionClass}" data-residual-section>`
        + `<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">`
        + `<div>`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-amber-700">Resíduo pendente</span>`
        + `<p class="text-xs text-amber-700">O valor pago é menor que o total. Ajuste o restante e informe um novo vencimento.</p>`
        + `</div>`
        + `<span class="text-base font-semibold text-amber-800" data-residual-amount>${escapeHtml(residualDefaultLabel)}</span>`
        + `</div>`
        + `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-amber-700">Valor do resíduo</span>`
        + `<input type="number" step="0.01" min="0" name="residualValue" data-residual-input class="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-200" value="${escapeHtml(residualDefaultValue.toFixed(2))}">`
        + `</label>`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-amber-700">Novo vencimento do resíduo</span>`
        + `<input type="date" name="residualDueDate" data-residual-due class="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-200" value="${escapeHtml(residualDueDefault)}"${
            residualDefaultValue > residualThreshold ? ' required' : ''
          }>`
        + `</label>`
        + `</div>`
        + `</div>`
        + `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-gray-600">Conta corrente</span>`
        + `<select name="bankAccount" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"${hasBankOptions ? '' : ' disabled'}>${bankOptionsHtml}</select>`
        + `</label>`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-gray-600">Meio de pagamento</span>`
        + `<select name="paymentMethod" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"${hasPaymentMethodOptions ? '' : ' disabled'}>${paymentMethodOptionsHtml}</select>`
        + `</label>`
        + `</div>`
        + `<div class="grid grid-cols-1 gap-3">`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-gray-600">Documento do pagamento</span>`
        + `<input type="text" name="paymentDocument" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="${escapeHtml(paymentDocumentValue)}" placeholder="Ex.: recibo, comprovante, etc.">`
        + `</label>`
        + `</div>`
        + `<div>`
        + `<label class="block space-y-1">`
        + `<span class="text-xs font-semibold uppercase tracking-wide text-gray-600">Observação</span>`
        + `<textarea name="notes" rows="3" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="Anote descontos, juros ou observações do recebimento.">${escapeHtml(notesValue)}</textarea>`
        + `</label>`
        + `</div>`
        + `</form>`;

      const initializePaymentModalForm = () => {
        const form = document.getElementById('payment-confirm-form');
        if (!form) return;
        const paidInputField = form.querySelector('input[name="paidValue"]');
        const residualInputField = form.querySelector('input[name="residualValue"]');
        const residualDueInputField = form.querySelector('input[name="residualDueDate"]');
        const residualSectionEl = form.querySelector('[data-residual-section]');
        const residualAmountEl = form.querySelector('[data-residual-amount]');

        const updateResidualUI = (rawValue) => {
          const normalized = Number.isFinite(rawValue) ? Math.max(rawValue, 0) : 0;
          if (residualAmountEl) {
            residualAmountEl.textContent = formatCurrencyBR(normalized);
          }
          if (residualSectionEl) {
            if (normalized > residualThreshold) {
              residualSectionEl.classList.remove('hidden');
            } else {
              residualSectionEl.classList.add('hidden');
            }
          }
          if (residualDueInputField) {
            residualDueInputField.required = normalized > residualThreshold;
          }
        };

        let residualEditedManually = false;

        if (residualInputField) {
          residualInputField.addEventListener('input', () => {
            residualEditedManually = true;
            const raw = Number.parseFloat(residualInputField.value || '0');
            updateResidualUI(raw);
          });
          residualInputField.addEventListener('change', () => {
            const paidRaw = Number.parseFloat(paidInputField?.value || '0');
            const normalizedPaid = Number.isFinite(paidRaw) ? Math.max(paidRaw, 0) : 0;
            const autoResidual = Math.max(totalValue - normalizedPaid, 0);
            const raw = Number.parseFloat(residualInputField.value || '');
            const normalized = Number.isFinite(raw) ? Math.max(raw, 0) : autoResidual;
            residualInputField.value = normalized.toFixed(2);
            if (Math.abs(normalized - autoResidual) < 0.005) {
              residualEditedManually = false;
            }
            updateResidualUI(normalized);
          });
        }

        if (paidInputField) {
          paidInputField.addEventListener('input', () => {
            const rawPaid = Number.parseFloat(paidInputField.value || '0');
            const normalizedPaid = Number.isFinite(rawPaid) ? Math.max(rawPaid, 0) : 0;
            const autoResidual = Math.max(totalValue - normalizedPaid, 0);
            if (residualInputField) {
              const currentResidualRaw = Number.parseFloat(residualInputField.value || '0');
              const currentResidual = Number.isFinite(currentResidualRaw)
                ? Math.max(currentResidualRaw, 0)
                : 0;
              if (residualEditedManually && Math.abs(currentResidual - autoResidual) < 0.005) {
                residualEditedManually = false;
              }
              if (!residualEditedManually) {
                residualInputField.value = autoResidual.toFixed(2);
              }
              const displayValueRaw = Number.parseFloat(residualInputField.value || '0');
              const displayValue = Number.isFinite(displayValueRaw) ? displayValueRaw : autoResidual;
              updateResidualUI(displayValue);
            } else {
              updateResidualUI(autoResidual);
            }
          });
        }

        if (residualDueInputField) {
          residualDueInputField.addEventListener('change', () => {
            if (!residualDueInputField.value) {
              residualDueInputField.classList.remove('border-red-300');
              return;
            }
            const parsed = parseDateInputValue(residualDueInputField.value);
            if (!parsed) {
              residualDueInputField.classList.add('border-red-300');
            } else {
              residualDueInputField.classList.remove('border-red-300');
            }
          });
        }

        const initialResidualRaw = Number.parseFloat(residualInputField?.value || '0');
        updateResidualUI(Number.isFinite(initialResidualRaw) ? initialResidualRaw : 0);
      };

      await new Promise((resolve) => {
        const finalize = (result) => resolve(result);
        window.showModal({
          title: 'Confirmar pagamento',
          message: messageHtml,
          confirmText: 'Confirmar pagamento',
          cancelText: 'Cancelar',
          onConfirm: async () => {
            const form = document.getElementById('payment-confirm-form');
            if (!form) {
              notify('Pagamento confirmado com sucesso.', 'success');
              finalize(true);
              return true;
            }

            const formData = new FormData(form);
            const paymentDate = formData.get('paymentDate');
            const paidValueRaw = Number.parseFloat(formData.get('paidValue') || '0');
            const bankAccount = formData.get('bankAccount') || '';
            const paymentMethod = formData.get('paymentMethod') || '';
            const paymentDocument = formData.get('paymentDocument') || '';
            const notes = formData.get('notes') || '';
            const residualValueField = formData.get('residualValue');
            const residualDueField = formData.get('residualDueDate');
            const paymentDateParsed = parseDateInputValue(paymentDate);
            if (!paymentDateParsed) {
              notify('Informe uma data de pagamento válida.', 'warning');
              const paymentDateInput = form.querySelector('input[name="paymentDate"]');
              paymentDateInput?.focus();
              return false;
            }

            if (!Number.isFinite(paidValueRaw) || paidValueRaw <= 0) {
              notify('Informe um valor pago maior que zero.', 'warning');
              const paidInput = form.querySelector('input[name="paidValue"]');
              paidInput?.focus();
              return false;
            }

            const paidValue = paidValueRaw;
            const residualValueRaw = Number.parseFloat(residualValueField || '0');
            const residualValue = Number.isFinite(residualValueRaw) ? Math.max(residualValueRaw, 0) : 0;
            const residualDueRaw = typeof residualDueField === 'string' ? residualDueField : '';
            const residualDueParsed = residualDueRaw ? parseDateInputValue(residualDueRaw) : null;
            const hasResidual = residualValue > residualThreshold;

            if (hasResidual && !residualDueRaw) {
              notify('Informe uma nova data de vencimento para o resíduo.', 'warning');
              const residualDueInput = form.querySelector('input[name="residualDueDate"]');
              residualDueInput?.focus();
              return false;
            }

            if (hasResidual && residualDueRaw && !residualDueParsed) {
              notify('Informe uma data de vencimento válida para o resíduo.', 'warning');
              const residualDueInput = form.querySelector('input[name="residualDueDate"]');
              residualDueInput?.focus();
              return false;
            }

            const paymentDateLabel = formatDateBR(paymentDateParsed);
            const paidValueLabel = formatCurrencyBR(paidValue);
            const residualDueLabel = residualDueParsed ? formatDateBR(residualDueParsed) : residualDueRaw || '--';
            const residualValueLabel = formatCurrencyBR(residualValue);

            const normalizedBankAccount = bankAccount || context.bankAccountId || '';
            const normalizedPaymentMethod = paymentMethod || context.paymentMethodId || '';
            const paymentDocumentValue = typeof paymentDocument === 'string' ? paymentDocument.trim() : '';
            const paymentNotesValue = typeof notes === 'string' ? notes.trim() : '';
            const payload = {
              installmentNumber: context.installmentNumber || 1,
              paymentDate,
              paidValue,
              bankAccount: normalizedBankAccount,
              paymentMethod: normalizedPaymentMethod,
              paymentDocument: paymentDocumentValue,
              notes: paymentNotesValue,
              residualValue: hasResidual ? residualValue : 0,
              residualDueDate: hasResidual ? residualDueRaw : null,
            };

            const confirmButton = document.getElementById('confirm-modal-confirm-btn');
            const toggleConfirmState = (disabled) => {
              if (!confirmButton) return;
              confirmButton.disabled = !!disabled;
              confirmButton.classList.toggle('opacity-60', !!disabled);
              confirmButton.classList.toggle('cursor-wait', !!disabled);
            };

            try {
              toggleConfirmState(true);

              const registered = await registerPayment(context.receivableId, payload);
              if (!registered) {
                return false;
              }

              if (hasResidual) {
                notify(
                  `Pagamento parcial registrado: ${paidValueLabel} recebido em ${paymentDateLabel}. Resíduo de ${residualValueLabel} vence em ${residualDueLabel}.`,
                  'success'
                );
              } else {
                notify(
                  `Pagamento de ${paidValueLabel} em ${paymentDateLabel} confirmado para ${customerLabel}.`,
                  'success'
                );
              }

              await loadReceivables();
              await loadHistory();

              finalize(true);
              return true;
            } catch (error) {
              console.error('accounts-receivable:registerPayment', error);
              notify(error.message || 'Não foi possível registrar o pagamento.', 'error');
              return false;
            } finally {
              toggleConfirmState(false);
            }
          },
          onCancel: () => {
            finalize(false);
            return true;
          },
        });

        const scheduleInit = () => initializePaymentModalForm();
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => scheduleInit());
        } else {
          setTimeout(scheduleInit, 0);
        }
      });
      return;
    }

    const plainMessage =
      `${installmentLabel}\n\n`
      + `Cliente: ${customerLabel}\n`
      + `Documento: ${documentLabel}\n`
      + `Vencimento: ${dueLabel}\n`
      + `Valor: ${valueLabel}\n\n`
      + 'Confirmar pagamento?';

    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(plainMessage);
    if (confirmed) {
      notify('Pagamento confirmado com sucesso.', 'success');
    }
  }

  function handleCompanyChange(event) {
    const companyId = event.target?.value || '';
    state.activeCompany = companyId;
    if (state.currentEditing?.id) {
      exitEditMode({ preserveCompany: true });
    }
    loadBankAccounts(companyId);
    loadAccountingAccounts(companyId);
    loadPaymentMethods(companyId);
    loadReceivables();
    loadHistory();
  }

  function handleCustomerChange() {
    loadHistory();
  }

  function handleGeneratePreview() {
    const installments = buildInstallmentsPreview();
    if (!installments.length) {
      notify('Informe valor, datas e parcelas para gerar a pré-visualização.', 'warning');
      updateInstallmentsTable([], { editable: true });
      return;
    }
    const bankLabel = getSelectedOptionLabel(elements.bankAccount);
    const accountingLabel = getSelectedOptionLabel(elements.accountingAccount);
    updateInstallmentsTable(installments, {
      bankLabel,
      accountingLabel,
      editable: true,
    });
    const installmentsTab = document.querySelector('[data-tab-target="installments"]');
    if (installmentsTab) installmentsTab.click();
  }

  function readCheckbox(checkbox) {
    return checkbox?.checked ? '1' : '0';
  }

  function handleClear() {
    exitEditMode({ preserveCompany: true });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!elements.form || state.isSaving) return;

    state.isSaving = true;
    if (elements.saveButton) {
      elements.saveButton.disabled = true;
      elements.saveButton.classList.add('opacity-60', 'cursor-not-allowed');
    }

    const isEditing = !!state.currentEditing?.id;

    try {
      const payload = {
        company: elements.company?.value || '',
        customer: elements.customer?.value || '',
        installments: Number.parseInt(elements.installments?.value || '1', 10) || 1,
        issueDate: elements.issue?.value || '',
        dueDate: elements.due?.value || '',
        totalValue: elements.totalValue?.value || '',
        bankAccount: elements.bankAccount?.value || '',
        accountingAccount: elements.accountingAccount?.value || '',
        document: elements.document?.value || '',
        paymentMethod: elements.paymentMethod?.value || '',
        documentNumber: elements.documentNumber?.value || '',
        responsible: elements.responsible?.value || '',
        notes: elements.notes?.value || '',
        forecast: readCheckbox(elements.forecast),
        uncollectible: readCheckbox(elements.uncollectible),
        protest: readCheckbox(elements.protest),
      };

      if (state.previewInstallments.length) {
        payload.installmentsData = state.previewInstallments.map((installment, index) => ({
          number: installment.number || index + 1,
          dueDate: formatDateInputValue(installment.dueDate) || '',
          bankAccount: installment.bankAccountId || installment.bankAccount || '',
        }));
      }

      const url = isEditing ? `${RECEIVABLES_API}/${state.currentEditing.id}` : RECEIVABLES_API;
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Não foi possível salvar a conta a receber.');
      }

      const data = await response.json();
      const normalized = normalizeReceivable(data.receivable || data);
      if (normalized) {
        storeReceivableInCache(normalized);
      }

      if (isEditing) {
        notify('Conta a receber atualizada com sucesso.', 'success');
        exitEditMode({ preserveCompany: true });
      } else {
        state.lastCreatedCode = normalized?.code || null;
        if (elements.code && normalized?.code) {
          elements.code.value = normalized.code;
        }
        state.previewInstallments = [];
        updateInstallmentsTable(normalized?.installments || [], {
          code: normalized?.code || null,
          bankLabel: normalized?.bankAccount?.label || '',
          accountingLabel: normalized?.accountingAccount?.label || '',
          editable: false,
        });
        notify('Conta a receber salva com sucesso.', 'success');
      }

      await loadReceivables();
      await loadHistory();
    } catch (error) {
      console.error('accounts-receivable:handleSubmit', error);
      notify(error.message || 'Erro ao salvar a conta a receber.', 'error');
    } finally {
      state.isSaving = false;
      if (elements.saveButton) {
        elements.saveButton.disabled = false;
        elements.saveButton.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
  }

  function init() {
    if (!elements.form) return;
    state.token = getAuthToken();
    elements.company?.addEventListener('change', handleCompanyChange);
    elements.customer?.addEventListener('change', handleCustomerChange);
    elements.generateButton?.addEventListener('click', handleGeneratePreview);
    elements.clearButton?.addEventListener('click', handleClear);
    elements.form.addEventListener('submit', handleSubmit);
    initializeForecastRange();
    buildForecastTableHead();
    ensureForecastTableLayout();
    elements.forecastBody?.addEventListener('click', handleForecastTableClick);
    elements.forecastSearch?.addEventListener('input', handleForecastSearchInput);
    elements.forecastRangeStart?.addEventListener('change', handleForecastRangeChange);
    elements.forecastRangeEnd?.addEventListener('change', handleForecastRangeChange);
    elements.forecastBody?.addEventListener('dragstart', handleForecastDragStart);
    elements.forecastBody?.addEventListener('dragover', handleForecastDragOver);
    elements.forecastBody?.addEventListener('dragleave', handleForecastDragLeave);
    elements.forecastBody?.addEventListener('drop', handleForecastDrop);
    elements.forecastBody?.addEventListener('dragend', handleForecastDragEnd);
    elements.historyBody?.addEventListener('click', handleHistoryTableClick);

    loadOptions().then(() => {
      if (elements.company?.value) {
        state.activeCompany = elements.company.value;
      }
      resetFormFields({ preserveCompany: true });
      loadReceivables();
      loadHistory();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
