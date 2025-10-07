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
    lastCreatedCode: null,
    receivables: [],
    history: [],
    receivableCache: new Map(),
    currentEditing: null,
    isSaving: false,
  };

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

  function formatDateBR(value) {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return dateFormatter.format(date);
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
      ? receivable.installments.map((installment, index) => ({
          number: installment.number || index + 1,
          issueDate: installment.issueDate || receivable.issueDate || null,
          dueDate: installment.dueDate || receivable.dueDate || null,
          value: Number(installment.value || 0),
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
          status: installment.status || computeStatus(receivable, installment),
        }))
      : [];
    normalized.installmentsCount =
      receivable.installmentsCount || (Array.isArray(normalized.installments) ? normalized.installments.length : 0) || 1;
    normalized.status = receivable.status || computeStatus(receivable);
    normalized.forecast = !!receivable.forecast;
    normalized.uncollectible = !!receivable.uncollectible;
    normalized.protest = !!receivable.protest;
    normalized.document = receivable.document || '';
    normalized.documentNumber = receivable.documentNumber || '';
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

  function computeStatus(receivable, installment) {
    if (!receivable) return 'open';
    if (receivable.uncollectible) return 'uncollectible';
    if (receivable.protest) return 'protest';

    const normalize = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
    const installmentStatus = normalize(installment?.status || receivable.status);
    const finalizedStatuses = new Set(['received', 'paid', 'finalized', 'quitado']);

    if (finalizedStatuses.has(installmentStatus)) {
      return 'finalized';
    }

    const installments = Array.isArray(receivable.installments) ? receivable.installments : [];
    if (installments.length > 0) {
      const allFinalized = installments.every((item) => finalizedStatuses.has(normalize(item?.status)));
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

    return map[status] || map.open;
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
      setSelectOptions(elements.company, companyOptions, 'Selecione...');
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
      }));
      setSelectOptions(elements.paymentMethod, options, options.length ? 'Selecione...' : 'Nenhum meio cadastrado');
      elements.paymentMethod.disabled = false;
    } catch (error) {
      console.error('accounts-receivable:loadPaymentMethods', error);
      notify(error.message || 'Erro ao carregar os meios de pagamento.', 'error');
      setSelectOptions(elements.paymentMethod, [], 'Não foi possível carregar');
      elements.paymentMethod.disabled = true;
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

  function renderForecast() {
    if (!elements.forecastBody) return;
    const tbody = elements.forecastBody;
    tbody.innerHTML = '';

    const receivables = Array.isArray(state.receivables) ? state.receivables : [];
    if (!receivables.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
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
              status: receivable.status || computeStatus(receivable),
            },
          ];

      installments.forEach((installment) => {
        rows.push({
          receivableId: receivable.id || receivable._id,
          code: receivable.code || receivable.documentNumber || receivable.document || '—',
          customer: receivable.customer?.name || '—',
          document: receivable.documentNumber || receivable.document || receivable.code || '—',
          dueDate: installment.dueDate || receivable.dueDate,
          value: installment.value || receivable.totalValue,
          status: installment.status || computeStatus(receivable, installment),
          installmentNumber: installment.number || null,
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
      const valueRaw = Number(item.value || 0);
      const valueString = Number.isFinite(valueRaw) ? valueRaw.toFixed(2) : '0';

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
      actionsCell.className = 'px-4 py-3 text-center';
      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'inline-flex items-center justify-center gap-2';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'forecast-action-edit inline-flex items-center gap-1 rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/10';
      editButton.dataset.action = 'edit-forecast';
      editButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        editButton.dataset.installment = String(item.installmentNumber);
      }
      if (item.customer) editButton.dataset.customer = item.customer;
      if (item.document) editButton.dataset.document = item.document;
      if (item.code) editButton.dataset.code = item.code;
      if (dueISO) editButton.dataset.due = dueISO;
      editButton.dataset.value = valueString;
      editButton.innerHTML = '<i class="fas fa-pen"></i> Editar';
      actionsWrapper.appendChild(editButton);

      const payButton = document.createElement('button');
      payButton.type = 'button';
      payButton.className = 'forecast-action-pay inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100';
      payButton.dataset.action = 'pay-forecast';
      payButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        payButton.dataset.installment = String(item.installmentNumber);
      }
      if (item.customer) payButton.dataset.customer = item.customer;
      if (item.document) payButton.dataset.document = item.document;
      if (item.code) payButton.dataset.code = item.code;
      if (dueISO) payButton.dataset.due = dueISO;
      payButton.dataset.value = valueString;
      payButton.innerHTML = '<i class="fas fa-hand-holding-dollar"></i> Pagar';
      actionsWrapper.appendChild(payButton);

      const downloadButton = document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.className = 'forecast-action-download inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100';
      downloadButton.dataset.action = 'download-forecast';
      downloadButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        downloadButton.dataset.installment = String(item.installmentNumber);
      }
      if (item.customer) downloadButton.dataset.customer = item.customer;
      if (item.document) downloadButton.dataset.document = item.document;
      if (item.code) downloadButton.dataset.code = item.code;
      if (dueISO) downloadButton.dataset.due = dueISO;
      downloadButton.dataset.value = valueString;
      downloadButton.innerHTML = '<i class="fas fa-arrow-down"></i> Baixar';
      actionsWrapper.appendChild(downloadButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'forecast-action-delete inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50';
      deleteButton.dataset.action = 'delete-forecast';
      deleteButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        deleteButton.dataset.installment = String(item.installmentNumber);
      }
      deleteButton.innerHTML = '<i class="fas fa-trash"></i> Excluir';
      actionsWrapper.appendChild(deleteButton);

      actionsCell.appendChild(actionsWrapper);

      row.appendChild(actionsCell);
      tbody.appendChild(row);
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
              status: receivable.status || computeStatus(receivable),
            },
          ];

      installments.forEach((installment) => {
        rows.push({
          receivableId: receivable.id || receivable._id,
          code: receivable.code || receivable.documentNumber || receivable.document || '—',
          customer: receivable.customer?.name || '—',
          document: receivable.documentNumber || receivable.document || receivable.code || '—',
          dueDate: installment.dueDate || receivable.dueDate,
          value: installment.value || receivable.totalValue,
          status: installment.status || computeStatus(receivable, installment),
          installmentNumber: installment.number || null,
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
      const valueRaw = Number(item.value || 0);
      const valueString = Number.isFinite(valueRaw) ? valueRaw.toFixed(2) : '0';

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
      actionsCell.className = 'px-4 py-3 text-center';
      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'inline-flex items-center justify-center gap-2';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'history-action-edit inline-flex items-center gap-1 rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/10';
      editButton.dataset.action = 'edit-history';
      editButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        editButton.dataset.installment = String(item.installmentNumber);
      }
      if (item.customer) editButton.dataset.customer = item.customer;
      if (item.document) editButton.dataset.document = item.document;
      if (item.code) editButton.dataset.code = item.code;
      if (dueISO) editButton.dataset.due = dueISO;
      editButton.dataset.value = valueString;
      editButton.innerHTML = '<i class="fas fa-pen"></i> Editar';
      actionsWrapper.appendChild(editButton);

      const payButton = document.createElement('button');
      payButton.type = 'button';
      payButton.className = 'history-action-pay inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100';
      payButton.dataset.action = 'pay-history';
      payButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        payButton.dataset.installment = String(item.installmentNumber);
      }
      if (item.customer) payButton.dataset.customer = item.customer;
      if (item.document) payButton.dataset.document = item.document;
      if (item.code) payButton.dataset.code = item.code;
      if (dueISO) payButton.dataset.due = dueISO;
      payButton.dataset.value = valueString;
      payButton.innerHTML = '<i class="fas fa-hand-holding-dollar"></i> Pagar';
      actionsWrapper.appendChild(payButton);

      const downloadButton = document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.className = 'history-action-download inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100';
      downloadButton.dataset.action = 'download-history';
      downloadButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        downloadButton.dataset.installment = String(item.installmentNumber);
      }
      if (item.customer) downloadButton.dataset.customer = item.customer;
      if (item.document) downloadButton.dataset.document = item.document;
      if (item.code) downloadButton.dataset.code = item.code;
      if (dueISO) downloadButton.dataset.due = dueISO;
      downloadButton.dataset.value = valueString;
      downloadButton.innerHTML = '<i class="fas fa-arrow-down"></i> Baixar';
      actionsWrapper.appendChild(downloadButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'history-action-delete inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50';
      deleteButton.dataset.action = 'delete-history';
      deleteButton.dataset.id = item.receivableId || '';
      if (item.installmentNumber) {
        deleteButton.dataset.installment = String(item.installmentNumber);
      }
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
      value: parsedValue,
    };
  }

  async function handleForecastTableClick(event) {
    const context = extractActionContext(event.target);
    if (!context || !context.receivableId) return;
    if (context.action === 'edit-forecast') {
      handleEditReceivable(context.receivableId, context.installmentNumber);
    } else if (context.action === 'pay-forecast') {
      await handlePayReceivable(context);
    } else if (context.action === 'download-forecast') {
      await handleDownloadReceivable(context);
    } else if (context.action === 'delete-forecast') {
      handleDeleteReceivable(context.receivableId, context.installmentNumber);
    }
  }

  async function handleHistoryTableClick(event) {
    const context = extractActionContext(event.target);
    if (!context || !context.receivableId) return;
    if (context.action === 'edit-history') {
      handleEditReceivable(context.receivableId, context.installmentNumber);
    } else if (context.action === 'pay-history') {
      await handlePayReceivable(context);
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
      updateSummary(data.summary || {});
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
            status: receivable.status || 'pending',
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
      status: installment.status || receivable.status || 'pending',
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
    const valueLabel = formatCurrencyBR(context.value || 0);
    const installmentLabel = context.installmentNumber
      ? `Parcela ${context.installmentNumber}`
      : 'Lançamento completo';

    if (typeof window !== 'undefined' && typeof window.showModal === 'function') {
      await new Promise((resolve) => {
        window.showModal({
          title: 'Confirmar pagamento',
          message:
            `<div class="space-y-2 text-sm text-gray-700">`
            + `<p>Confirme os dados antes de registrar o pagamento.</p>`
            + `<ul class="space-y-1 text-left">`
            + `<li><strong>${installmentLabel}</strong></li>`
            + `<li><strong>Cliente:</strong> ${customerLabel}</li>`
            + `<li><strong>Documento:</strong> ${documentLabel}</li>`
            + `<li><strong>Vencimento:</strong> ${dueLabel}</li>`
            + `<li><strong>Valor:</strong> ${valueLabel}</li>`
            + `</ul>`
            + `</div>`,
          confirmText: 'Confirmar pagamento',
          cancelText: 'Cancelar',
          onConfirm: () => {
            notify('Pagamento confirmado com sucesso.', 'success');
            resolve(true);
          },
          onCancel: () => resolve(false),
        });
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
    elements.forecastBody?.addEventListener('click', handleForecastTableClick);
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
