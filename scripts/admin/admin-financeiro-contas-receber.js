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
    summaryConfirmedTotal: document.getElementById('receivable-summary-confirmed-total'),
    summaryConfirmedCount: document.getElementById('receivable-summary-confirmed-count'),
    summaryOpenTotal: document.getElementById('receivable-summary-open-total'),
    summaryOpenCount: document.getElementById('receivable-summary-open-count'),
    summaryOverdueTotal: document.getElementById('receivable-summary-overdue-total'),
    summaryOverdueCount: document.getElementById('receivable-summary-overdue-count'),
  };

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
        bankAccount: bankAccountId,
        accountingAccount: accountingAccountId,
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

  function updateInstallmentsTable(installments, code, bankLabel, accountingLabel) {
    const tbody = elements.installmentsBody;
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!Array.isArray(installments) || installments.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'px-4 py-6 text-center text-sm text-gray-500';
      cell.textContent = 'Gere as parcelas para visualizar a distribuição.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    const total = installments.length;
    const displayCode = code || state.lastCreatedCode || 'Prévia';
    const isPreview = !code;

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
      if (isPreview) {
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
      if (isPreview) {
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
        if (installment.bankAccount) {
          select.value = installment.bankAccount;
        } else if (elements.bankAccount?.value) {
          select.value = elements.bankAccount.value;
        }
        select.addEventListener('change', () => {
          installment.bankAccount = select.value;
        });
        bankCell.appendChild(select);
      } else {
        bankCell.textContent = installment.bankAccount?.label || bankLabel || '—';
      }
      row.appendChild(bankCell);

      const accountingCell = document.createElement('td');
      accountingCell.className = 'px-4 py-3';
      accountingCell.textContent = installment.accountingAccount?.label || accountingLabel || '—';
      row.appendChild(accountingCell);

      tbody.appendChild(row);
    });
  }

  function computeStatus(receivable, installment) {
    if (!receivable) return 'open';
    if (receivable.uncollectible) return 'uncollectible';
    if (receivable.protest) return 'protest';
    if (receivable.forecast) return 'forecast';

    const dueDateValue = installment?.dueDate || receivable.dueDate;
    if (!dueDateValue) return 'open';

    const dueDate = new Date(dueDateValue);
    if (Number.isNaN(dueDate.getTime())) return 'open';

    const today = new Date();
    const due = new Date(Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()));
    const ref = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    if (due.getTime() < ref.getTime()) return 'overdue';
    if (due.getTime() === ref.getTime()) return 'confirmed';
    return 'open';
  }

  function buildStatusBadge(status) {
    const map = {
      forecast: {
        label: 'Previsão',
        classes: 'bg-sky-100 text-sky-700',
        icon: 'fa-chart-line',
      },
      uncollectible: {
        label: 'Impagável',
        classes: 'bg-slate-200 text-slate-700',
        icon: 'fa-ban',
      },
      protest: {
        label: 'Protesto',
        classes: 'bg-purple-100 text-purple-700',
        icon: 'fa-gavel',
      },
      confirmed: {
        label: 'Confirmado',
        classes: 'bg-emerald-100 text-emerald-700',
        icon: 'fa-check-circle',
      },
      overdue: {
        label: 'Em atraso',
        classes: 'bg-rose-100 text-rose-700',
        icon: 'fa-circle-exclamation',
      },
      open: {
        label: 'Aguardando',
        classes: 'bg-amber-100 text-amber-700',
        icon: 'fa-hourglass-half',
      },
    };

    return map[status] || map.open;
  }

  function updateForecastTable(receivables) {
    const tbody = elements.forecastBody;
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = [];
    receivables.forEach((receivable) => {
      const installments = Array.isArray(receivable.installments) && receivable.installments.length
        ? receivable.installments
        : [{
            number: 1,
            dueDate: receivable.dueDate,
            value: receivable.totalValue,
          }];

      installments.forEach((installment) => {
        const status = computeStatus(receivable, installment);
        rows.push({
          customer: receivable.customer?.name || '—',
          document: receivable.documentNumber || receivable.document || receivable.code || '—',
          dueDate: installment.dueDate || receivable.dueDate,
          value: installment.value || receivable.totalValue,
          status,
        });
      });
    });

    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'px-4 py-6 text-center text-sm text-gray-500';
      cell.textContent = 'Cadastre contas a receber para acompanhar a previsão.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    rows.sort((a, b) => {
      const dateA = new Date(a.dueDate).getTime();
      const dateB = new Date(b.dueDate).getTime();
      return dateA - dateB;
    });

    rows.forEach((rowData) => {
      const row = document.createElement('tr');

      const customerCell = document.createElement('td');
      customerCell.className = 'px-4 py-3';
      customerCell.textContent = rowData.customer;
      row.appendChild(customerCell);

      const docCell = document.createElement('td');
      docCell.className = 'px-4 py-3';
      docCell.textContent = rowData.document;
      row.appendChild(docCell);

      const dueCell = document.createElement('td');
      dueCell.className = 'px-4 py-3';
      dueCell.textContent = formatDateBR(rowData.dueDate);
      row.appendChild(dueCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-4 py-3 text-right';
      valueCell.textContent = formatCurrencyBR(rowData.value);
      row.appendChild(valueCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-3 text-center';
      const badge = buildStatusBadge(rowData.status);
      const span = document.createElement('span');
      span.className = `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`;
      const icon = document.createElement('i');
      icon.className = `fas ${badge.icon}`;
      span.appendChild(icon);
      const text = document.createElement('span');
      text.textContent = badge.label;
      span.appendChild(text);
      statusCell.appendChild(span);
      row.appendChild(statusCell);

      tbody.appendChild(row);
    });
  }

  function updateSummary(summary = {}) {
    const confirmed = summary.confirmed || { count: 0, total: 0 };
    const open = summary.open || { count: 0, total: 0 };
    const overdue = summary.overdue || { count: 0, total: 0 };

    if (elements.summaryConfirmedTotal) {
      elements.summaryConfirmedTotal.textContent = formatCurrencyBR(confirmed.total || 0);
    }
    if (elements.summaryConfirmedCount) {
      elements.summaryConfirmedCount.textContent = `${confirmed.count || 0} lançamentos`;
    }
    if (elements.summaryOpenTotal) {
      elements.summaryOpenTotal.textContent = formatCurrencyBR(open.total || 0);
    }
    if (elements.summaryOpenCount) {
      elements.summaryOpenCount.textContent = `${open.count || 0} lançamentos`;
    }
    if (elements.summaryOverdueTotal) {
      elements.summaryOverdueTotal.textContent = formatCurrencyBR(overdue.total || 0);
    }
    if (elements.summaryOverdueCount) {
      elements.summaryOverdueCount.textContent = `${overdue.count || 0} lançamentos`;
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
        updateInstallmentsTable(state.previewInstallments, null, bankLabel, accountingLabel);
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

  async function loadReceivables() {
    try {
      const response = await fetch(RECEIVABLES_API, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (await handleUnauthorized(response)) return;
        throw new Error('Não foi possível carregar as contas a receber.');
      }
      const data = await response.json();
      state.receivables = Array.isArray(data.receivables) ? data.receivables : [];
      updateSummary(data.summary || {});
      updateForecastTable(state.receivables);
    } catch (error) {
      console.error('accounts-receivable:loadReceivables', error);
      notify(error.message || 'Erro ao carregar a previsão de recebimentos.', 'error');
    }
  }

  function handleCompanyChange(event) {
    const companyId = event.target?.value || '';
    state.activeCompany = companyId;
    loadBankAccounts(companyId);
    loadAccountingAccounts(companyId);
    loadPaymentMethods(companyId);
  }

  function handleGeneratePreview() {
    const installments = buildInstallmentsPreview();
    if (!installments.length) {
      notify('Informe valor, datas e parcelas para gerar a pré-visualização.', 'warning');
      updateInstallmentsTable([], null, null, null);
      return;
    }
    const bankLabel = getSelectedOptionLabel(elements.bankAccount);
    const accountingLabel = getSelectedOptionLabel(elements.accountingAccount);
    updateInstallmentsTable(installments, null, bankLabel, accountingLabel);
    const installmentsTab = document.querySelector('[data-tab-target="installments"]');
    if (installmentsTab) installmentsTab.click();
  }

  function readCheckbox(checkbox) {
    return checkbox?.checked ? '1' : '0';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!elements.form) return;

    const submitButton = elements.form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.classList.add('opacity-60', 'cursor-not-allowed');
    }

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
          bankAccount: installment.bankAccount || '',
        }));
      }

      const response = await fetch(RECEIVABLES_API, {
        method: 'POST',
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

      const created = await response.json();
      state.lastCreatedCode = created.code;
      notify('Conta a receber salva com sucesso.', 'success');

      if (elements.code && created.code) {
        elements.code.value = created.code;
      }

      const bankLabel = created.bankAccount?.label || getSelectedOptionLabel(elements.bankAccount);
      const accountingLabel = created.accountingAccount?.label || getSelectedOptionLabel(elements.accountingAccount);
      state.previewInstallments = [];
      updateInstallmentsTable(created.installments || [], created.code, bankLabel, accountingLabel);

      await loadReceivables();
    } catch (error) {
      console.error('accounts-receivable:handleSubmit', error);
      notify(error.message || 'Erro ao salvar a conta a receber.', 'error');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
  }

  function init() {
    if (!elements.form) return;
    state.token = getAuthToken();
    elements.company?.addEventListener('change', handleCompanyChange);
    elements.generateButton?.addEventListener('click', handleGeneratePreview);
    elements.form.addEventListener('submit', handleSubmit);
    elements.form.addEventListener('reset', () => {
      setTimeout(() => {
        state.previewInstallments = [];
        state.lastCreatedCode = null;
        if (elements.code) {
          elements.code.value = 'Gerado automaticamente';
        }
        updateInstallmentsTable([], null, null, null);
        const companyId = elements.company?.value || '';
        state.activeCompany = companyId;
        loadBankAccounts(companyId);
        loadAccountingAccounts(companyId);
        loadPaymentMethods(companyId);
      }, 0);
    });

    loadOptions().then(() => {
      if (elements.company?.value) {
        state.activeCompany = elements.company.value;
        loadBankAccounts(elements.company.value);
        loadAccountingAccounts(elements.company.value);
        loadPaymentMethods(elements.company.value);
      }
    });
    loadReceivables();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
