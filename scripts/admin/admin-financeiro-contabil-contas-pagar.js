(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const PAYABLES_API = `${API_BASE}/accounts-payable`;
  const BANKS_DATA_URL = (typeof basePath === 'string' ? basePath : '../../') + 'data/bancos.json';

  const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });

  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

  const state = {
    token: null,
    companies: [],
    bankAccounts: [],
    ledgerAccounts: [],
    paymentMethods: [],
    banks: [],
    previewInstallments: [],
    partySuggestions: [],
    selectedParty: null,
    partySearchTimeout: null,
    history: [],
    isSaving: false,
    agenda: {
      rangeDays: 7,
      loading: false,
      periodStart: null,
      periodEnd: null,
      summary: {
        upcoming: { totalValue: 0, installments: 0 },
        pending: { totalValue: 0, installments: 0 },
        paidThisMonth: { totalValue: 0, installments: 0 },
      },
      items: [],
      emptyMessage: 'Nenhum pagamento previsto para o período selecionado.',
    },
  };

  const elements = {
    form: document.getElementById('payable-form'),
    code: document.getElementById('payable-code'),
    partyInput: document.getElementById('payable-party'),
    partyId: document.getElementById('payable-party-id'),
    partyType: document.getElementById('payable-party-type'),
    partySuggestions: document.getElementById('payable-party-suggestions'),
    issueDate: document.getElementById('payable-issue-date'),
    installments: document.getElementById('payable-installments'),
    dueDate: document.getElementById('payable-due-date'),
    totalAmount: document.getElementById('payable-amount'),
    bankAccount: document.getElementById('payable-bank-account'),
    ledgerAccount: document.getElementById('payable-ledger-account'),
    company: document.getElementById('payable-origin-company'),
    generateButton: document.getElementById('payable-generate'),
    documentNumber: document.getElementById('bank-document-number'),
    carrier: document.getElementById('document-carrier'),
    paymentMethod: document.getElementById('payment-method'),
    interestFee: document.getElementById('interest-fee'),
    monthlyInterest: document.getElementById('monthly-interest'),
    interestPercent: document.getElementById('interest-percent'),
    previewBody: document.getElementById('payable-preview-body'),
    previewEmpty: document.getElementById('payable-preview-empty'),
    historyBody: document.getElementById('payable-history-body'),
    historyEmpty: document.getElementById('payable-history-empty'),
    saveButton: document.getElementById('payable-save'),
    carrierList: document.getElementById('carrier-bank-list'),
    agendaRange: document.getElementById('agenda-range'),
    agendaPeriodLabel: document.getElementById('agenda-period-label'),
    agendaUpcomingValue: document.getElementById('agenda-upcoming-value'),
    agendaUpcomingCount: document.getElementById('agenda-upcoming-count'),
    agendaPendingValue: document.getElementById('agenda-pending-value'),
    agendaPendingCount: document.getElementById('agenda-pending-count'),
    agendaPaidValue: document.getElementById('agenda-paid-value'),
    agendaPaidCount: document.getElementById('agenda-paid-count'),
    agendaTableBody: document.getElementById('agenda-table-body'),
    agendaEmpty: document.getElementById('agenda-empty'),
  };

  const STATUS_BADGES = {
    pending: { icon: 'fa-circle-pause', classes: 'bg-amber-100 text-amber-700', label: 'Pendente' },
    paid: { icon: 'fa-circle-check', classes: 'bg-emerald-100 text-emerald-700', label: 'Pago' },
    cancelled: { icon: 'fa-circle-xmark', classes: 'bg-gray-200 text-gray-600', label: 'Cancelado' },
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
    } catch (err) {
      /* noop */
    }
  }

  function getAuthToken() {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return cached?.token || null;
    } catch (err) {
      console.error('payables:getAuthToken', err);
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

  function parseCurrency(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return 0;
    const normalized = value
      .trim()
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^0-9.+-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseDateInputValue(value) {
    if (!value) return null;
    const [year, month, day] = String(value).split('-').map((part) => Number.parseInt(part, 10));
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) return null;
    return date;
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

  function formatDateBR(value) {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return dateFormatter.format(date);
  }

  function createEmptyAgendaSummary() {
    return {
      upcoming: { totalValue: 0, installments: 0 },
      pending: { totalValue: 0, installments: 0 },
      paidThisMonth: { totalValue: 0, installments: 0 },
    };
  }

  function getStatusBadgeConfig(status) {
    if (!status || typeof status !== 'string') {
      return { icon: 'fa-circle-info', classes: 'bg-slate-100 text-slate-700', label: 'Indefinido' };
    }
    const normalized = status.toLowerCase();
    if (STATUS_BADGES[normalized]) {
      return STATUS_BADGES[normalized];
    }
    const label = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    return { icon: 'fa-circle-info', classes: 'bg-slate-100 text-slate-700', label };
  }

  function formatInstallmentsText(count, singular, plural) {
    const safeCount = Number.isFinite(count) ? count : 0;
    return `${safeCount} ${safeCount === 1 ? singular : plural}`;
  }

  function updateAgendaPeriodLabel() {
    if (!elements.agendaPeriodLabel) return;
    const { periodStart, periodEnd, rangeDays } = state.agenda;
    if (periodStart instanceof Date && periodEnd instanceof Date) {
      const startValid = !Number.isNaN(periodStart.getTime());
      const endValid = !Number.isNaN(periodEnd.getTime());
      if (startValid && endValid) {
        elements.agendaPeriodLabel.textContent = `Pagamentos de ${formatDateBR(periodStart)} a ${formatDateBR(periodEnd)}`;
        return;
      }
    }
    const range = Number.isFinite(rangeDays) && rangeDays > 0
      ? rangeDays
      : Number.parseInt(elements.agendaRange?.value || '7', 10) || 7;
    elements.agendaPeriodLabel.textContent = `Pagamentos nos próximos ${range} dias`;
  }

  function renderAgendaSummary() {
    if (elements.agendaUpcomingValue) {
      elements.agendaUpcomingValue.textContent = formatCurrencyBR(state.agenda.summary.upcoming.totalValue);
    }
    if (elements.agendaUpcomingCount) {
      elements.agendaUpcomingCount.textContent = formatInstallmentsText(
        state.agenda.summary.upcoming.installments,
        'parcela prevista',
        'parcelas previstas'
      );
    }
    if (elements.agendaPendingValue) {
      elements.agendaPendingValue.textContent = formatCurrencyBR(state.agenda.summary.pending.totalValue);
    }
    if (elements.agendaPendingCount) {
      elements.agendaPendingCount.textContent = formatInstallmentsText(
        state.agenda.summary.pending.installments,
        'parcela aguardando pagamento',
        'parcelas aguardando pagamento'
      );
    }
    if (elements.agendaPaidValue) {
      elements.agendaPaidValue.textContent = formatCurrencyBR(state.agenda.summary.paidThisMonth.totalValue);
    }
    if (elements.agendaPaidCount) {
      elements.agendaPaidCount.textContent = formatInstallmentsText(
        state.agenda.summary.paidThisMonth.installments,
        'parcela liquidada',
        'parcelas liquidadas'
      );
    }
  }

  function renderAgendaTable() {
    if (!elements.agendaTableBody) return;
    elements.agendaTableBody.innerHTML = '';

    if (state.agenda.loading) {
      const loadingRow = document.createElement('tr');
      loadingRow.innerHTML =
        '<td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">Carregando agenda de pagamentos...</td>';
      elements.agendaTableBody.appendChild(loadingRow);
      elements.agendaEmpty?.classList.add('hidden');
      return;
    }

    const items = Array.isArray(state.agenda.items) ? state.agenda.items : [];
    if (!items.length) {
      if (elements.agendaEmpty) {
        elements.agendaEmpty.textContent =
          state.agenda.emptyMessage || 'Nenhum pagamento previsto para o período selecionado.';
        elements.agendaEmpty.classList.remove('hidden');
      }
      return;
    }

    elements.agendaEmpty?.classList.add('hidden');

    items.forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'bg-white';

      const partyCell = document.createElement('td');
      partyCell.className = 'px-4 py-3 text-sm text-gray-700';
      partyCell.textContent = item.partyName || '---';
      row.appendChild(partyCell);

      const documentCell = document.createElement('td');
      documentCell.className = 'px-4 py-3 text-sm text-gray-600';
      documentCell.textContent = item.document || item.payableCode || '--';
      row.appendChild(documentCell);

      const dueCell = document.createElement('td');
      dueCell.className = 'px-4 py-3 text-sm text-gray-600';
      dueCell.textContent = formatDateBR(item.dueDate);
      row.appendChild(dueCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-4 py-3 text-sm text-right text-gray-800';
      valueCell.textContent = formatCurrencyBR(item.value);
      row.appendChild(valueCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-3 text-sm text-center';
      const badge = document.createElement('span');
      const badgeConfig = getStatusBadgeConfig(item.status);
      badge.className = `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badgeConfig.classes}`;
      badge.innerHTML = `<i class="fas ${badgeConfig.icon}"></i> ${badgeConfig.label}`;
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      elements.agendaTableBody.appendChild(row);
    });
  }

  function renderAgenda() {
    updateAgendaPeriodLabel();
    renderAgendaSummary();
    renderAgendaTable();
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
    select.disabled = options.length === 0;
  }

  function setLoadingSelect(select, loadingText) {
    if (!select) return;
    clearSelect(select, loadingText);
    select.disabled = true;
  }

  function setupTabs() {
    const triggers = Array.from(document.querySelectorAll('.tab-trigger'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));
    const activeClasses = ['border-transparent', 'bg-primary/10', 'text-primary', 'font-semibold'];
    const inactiveClasses = ['border-gray-200', 'bg-white', 'text-gray-600', 'font-medium'];

    triggers.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const target = trigger.dataset.tab;
        triggers.forEach((button) => {
          if (button === trigger) {
            button.classList.add(...activeClasses);
            button.classList.remove(...inactiveClasses);
          } else {
            button.classList.remove(...activeClasses);
            button.classList.add(...inactiveClasses);
          }
        });

        panels.forEach((panel) => {
          if (panel.id === `tab-${target}`) {
            panel.classList.remove('hidden');
          } else {
            panel.classList.add('hidden');
          }
        });
      });
    });
  }

  function populateBanksList(banks) {
    if (!elements.carrierList) return;
    elements.carrierList.innerHTML = '';
    banks.forEach((bank) => {
      const option = document.createElement('option');
      option.value = `${bank.code} - ${bank.name}`;
      elements.carrierList.appendChild(option);
    });
  }

  async function loadBanks() {
    try {
      const response = await fetch(BANKS_DATA_URL, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Falha ao carregar bancos (${response.status})`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Lista de bancos inválida');
      }
      state.banks = data
        .filter((item) => item && item.code && item.name)
        .map((item) => ({ code: item.code, name: item.name }));
      populateBanksList(state.banks);
    } catch (error) {
      console.error('accounts-payable:loadBanks', error);
      notify('Não foi possível carregar a lista de bancos para o campo portador.', 'warning');
    }
  }

  async function loadCompanies() {
    try {
      const response = await fetch(`${PAYABLES_API}/options`, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar empresas (${response.status})`);
      }
      const data = await response.json();
      state.companies = Array.isArray(data?.companies) ? data.companies : [];
      const options = state.companies.map((company) => ({
        value: company._id,
        label: company.document ? `${company.name} • ${company.document}` : company.name,
      }));
      setSelectOptions(elements.company, options, options.length ? 'Selecione a empresa responsável' : 'Nenhuma empresa encontrada');
    } catch (error) {
      console.error('accounts-payable:loadCompanies', error);
      notify(error.message || 'Erro ao carregar as empresas.', 'error');
      setSelectOptions(elements.company, [], 'Nenhuma empresa encontrada');
    }
  }

  async function loadCompanyResources(companyId) {
    if (!companyId) {
      setSelectOptions(elements.bankAccount, [], 'Selecione uma empresa para carregar as contas');
      setSelectOptions(elements.ledgerAccount, [], 'Selecione uma empresa para listar as contas a pagar');
      setSelectOptions(elements.paymentMethod, [], 'Selecione uma empresa para listar os meios de pagamento');
      return;
    }

    try {
      setLoadingSelect(elements.bankAccount, 'Carregando contas correntes...');
      setLoadingSelect(elements.ledgerAccount, 'Carregando contas contábeis...');
      setLoadingSelect(elements.paymentMethod, 'Carregando meios de pagamento...');

      const response = await fetch(`${PAYABLES_API}/options?company=${companyId}`, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Erro ao carregar dados da empresa (${response.status})`);
      }

      const data = await response.json();
      state.bankAccounts = Array.isArray(data?.bankAccounts)
        ? data.bankAccounts.map((item) => ({ value: item._id, label: item.label }))
        : [];
      state.ledgerAccounts = Array.isArray(data?.accountingAccounts)
        ? data.accountingAccounts.map((item) => ({ value: item._id, label: item.label }))
        : [];
      state.paymentMethods = Array.isArray(data?.paymentMethods)
        ? data.paymentMethods.map((item) => ({ value: item._id, label: item.name }))
        : [];

      setSelectOptions(
        elements.bankAccount,
        state.bankAccounts,
        state.bankAccounts.length ? 'Selecione a conta corrente' : 'Nenhuma conta corrente encontrada'
      );
      setSelectOptions(
        elements.ledgerAccount,
        state.ledgerAccounts,
        state.ledgerAccounts.length ? 'Selecione a conta contábil' : 'Nenhuma conta contábil disponível'
      );
      setSelectOptions(
        elements.paymentMethod,
        state.paymentMethods,
        state.paymentMethods.length ? 'Selecione o meio de pagamento' : 'Nenhum meio de pagamento cadastrado'
      );
    } catch (error) {
      console.error('accounts-payable:loadCompanyResources', error);
      notify(error.message || 'Não foi possível carregar os dados da empresa.', 'error');
      setSelectOptions(elements.bankAccount, [], 'Nenhuma conta corrente encontrada');
      setSelectOptions(elements.ledgerAccount, [], 'Nenhuma conta contábil disponível');
      setSelectOptions(elements.paymentMethod, [], 'Nenhum meio de pagamento cadastrado');
    }
  }

  function renderPartySuggestions(items) {
    if (!elements.partySuggestions) return;
    elements.partySuggestions.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'py-3 text-center text-xs text-gray-500';
      empty.textContent = 'Nenhum resultado encontrado.';
      elements.partySuggestions.appendChild(empty);
      elements.partySuggestions.classList.remove('hidden');
      return;
    }

    const list = document.createElement('div');
    list.className = 'py-1';

    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        'w-full px-4 py-2 text-left text-sm hover:bg-primary/10 focus:bg-primary/10 focus:outline-none flex flex-col gap-0.5';
      const title = document.createElement('span');
      title.className = 'font-medium text-gray-800';
      title.textContent = item.label;
      const meta = document.createElement('span');
      meta.className = 'text-xs text-gray-500';
      const parts = [];
      if (item.document) parts.push(item.document);
      if (item.email) parts.push(item.email);
      if (item.mobile) parts.push(item.mobile);
      meta.textContent = parts.join(' • ');
      button.appendChild(title);
      if (parts.length) button.appendChild(meta);
      button.addEventListener('click', () => {
        state.selectedParty = { id: item._id, type: item.type, label: item.label };
        elements.partyInput.value = item.label;
        elements.partyId.value = item._id;
        elements.partyType.value = item.type;
        elements.partySuggestions.classList.add('hidden');
        loadHistory();
      });
      list.appendChild(button);
    });

    elements.partySuggestions.appendChild(list);
    elements.partySuggestions.classList.remove('hidden');
  }

  async function fetchPartySuggestions(query) {
    if (!query || query.length < 3) {
      state.partySuggestions = [];
      elements.partySuggestions.classList.add('hidden');
      return;
    }

    try {
      const response = await fetch(`${PAYABLES_API}/parties?query=${encodeURIComponent(query)}`, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente para buscar clientes e fornecedores.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Erro ao buscar clientes e fornecedores (${response.status})`);
      }
      const data = await response.json();
      state.partySuggestions = Array.isArray(data?.parties) ? data.parties : [];
      renderPartySuggestions(state.partySuggestions);
    } catch (error) {
      console.error('accounts-payable:fetchPartySuggestions', error);
      notify(error.message || 'Não foi possível buscar clientes e fornecedores.', 'error');
    }
  }

  function schedulePartySearch(value) {
    if (state.partySearchTimeout) {
      clearTimeout(state.partySearchTimeout);
    }
    state.partySearchTimeout = setTimeout(() => {
      fetchPartySuggestions(value.trim());
    }, 400);
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
    const installmentsCount = Math.max(1, Number.parseInt(elements.installments?.value || '1', 10) || 1);
    const issue = parseDateInputValue(elements.issueDate?.value);
    const baseDue = parseDateInputValue(elements.dueDate?.value);
    const total = parseCurrency(elements.totalAmount?.value);
    const bankAccount = elements.bankAccount?.value || '';
    const ledgerAccount = elements.ledgerAccount?.value || '';

    if (!issue || !baseDue || !(total > 0)) {
      state.previewInstallments = [];
      return [];
    }

    const centsTotal = Math.round(total * 100);
    const baseCents = Math.floor(centsTotal / installmentsCount);
    const remainder = centsTotal - baseCents * installmentsCount;

    const installments = [];
    for (let index = 0; index < installmentsCount; index += 1) {
      const amountCents = baseCents + (index < remainder ? 1 : 0);
      const value = amountCents / 100;
      const dueDate = addMonths(baseDue, index);
      installments.push({
        number: index + 1,
        issueDate: issue,
        dueDate,
        dueDateInput: formatDateInputValue(dueDate),
        value,
        bankAccount,
        accountingAccount: ledgerAccount,
      });
    }

    state.previewInstallments = installments;
    return installments;
  }

  function updatePreviewEmptyState() {
    if (!elements.previewEmpty) return;
    if (state.previewInstallments.length) {
      elements.previewEmpty.classList.add('hidden');
    } else {
      elements.previewEmpty.classList.remove('hidden');
    }
  }

  function renderPreview() {
    if (!elements.previewBody) return;
    elements.previewBody.innerHTML = '';

    state.previewInstallments.forEach((installment, index) => {
      const row = document.createElement('tr');
      row.className = 'bg-white';

      const numberCell = document.createElement('td');
      numberCell.className = 'px-4 py-3 font-medium text-gray-800';
      numberCell.textContent = `${installment.number}/${state.previewInstallments.length}`;
      row.appendChild(numberCell);

      const dueCell = document.createElement('td');
      dueCell.className = 'px-4 py-3';
      const dueInput = document.createElement('input');
      dueInput.type = 'date';
      dueInput.className =
        'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';
      dueInput.value = installment.dueDateInput || formatDateInputValue(installment.dueDate);
      dueInput.addEventListener('change', () => {
        const parsed = parseDateInputValue(dueInput.value);
        state.previewInstallments[index].dueDate = parsed;
        state.previewInstallments[index].dueDateInput = dueInput.value;
      });
      dueCell.appendChild(dueInput);
      row.appendChild(dueCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-4 py-3';
      const wrapper = document.createElement('div');
      wrapper.className = 'relative';
      const prefix = document.createElement('span');
      prefix.className = 'absolute left-3 top-1/2 -translate-y-1/2 text-gray-400';
      prefix.textContent = 'R$';
      const valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.step = '0.01';
      valueInput.min = '0';
      valueInput.className =
        'w-full rounded-lg border border-gray-200 px-3 py-2 pl-9 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20';
      valueInput.value = installment.value.toFixed(2);
      valueInput.addEventListener('change', () => {
        const parsed = parseCurrency(valueInput.value);
        state.previewInstallments[index].value = parsed;
        valueInput.value = parsed.toFixed(2);
      });
      wrapper.appendChild(prefix);
      wrapper.appendChild(valueInput);
      valueCell.appendChild(wrapper);
      row.appendChild(valueCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-3 text-sm text-gray-500';
      statusCell.textContent = 'Prevista';
      row.appendChild(statusCell);

      elements.previewBody.appendChild(row);
    });

    updatePreviewEmptyState();
  }

  function renderHistory() {
    if (!elements.historyBody) return;
    elements.historyBody.innerHTML = '';

    if (!state.history.length) {
      if (elements.historyEmpty) {
        elements.historyEmpty.classList.remove('hidden');
      }
      return;
    }

    if (elements.historyEmpty) {
      elements.historyEmpty.classList.add('hidden');
    }

    state.history.forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'bg-white';

      const descriptionCell = document.createElement('td');
      descriptionCell.className = 'px-4 py-3 text-sm text-gray-700';
      descriptionCell.textContent = item.code || 'Título';
      row.appendChild(descriptionCell);

      const documentCell = document.createElement('td');
      documentCell.className = 'px-4 py-3 text-sm text-gray-600';
      documentCell.textContent = item.bankDocumentNumber || '--';
      row.appendChild(documentCell);

      const dueCell = document.createElement('td');
      dueCell.className = 'px-4 py-3 text-sm text-gray-600';
      dueCell.textContent = formatDateBR(item.dueDate);
      row.appendChild(dueCell);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-4 py-3 text-sm text-right text-gray-800';
      valueCell.textContent = formatCurrencyBR(item.totalValue);
      row.appendChild(valueCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-3 text-sm text-center';
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700';
      badge.innerHTML = '<i class="fas fa-circle"></i> Registrado';
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      elements.historyBody.appendChild(row);
    });
  }

  async function loadHistory() {
    if (!state.selectedParty?.id || !state.selectedParty?.type) {
      state.history = [];
      renderHistory();
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('party', state.selectedParty.id);
      params.set('partyType', state.selectedParty.type);
      const company = elements.company?.value;
      if (company) params.set('company', company);
      const response = await fetch(`${PAYABLES_API}?${params.toString()}`, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente para carregar o histórico.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Erro ao carregar histórico (${response.status})`);
      }
      const data = await response.json();
      state.history = Array.isArray(data?.payables) ? data.payables : [];
      renderHistory();
    } catch (error) {
      console.error('accounts-payable:loadHistory', error);
      notify(error.message || 'Erro ao carregar o histórico de contas a pagar.', 'error');
    }
  }

  async function loadAgenda() {
    const selectedRange = Number.parseInt(elements.agendaRange?.value || '', 10);
    const rangeDays = Number.isFinite(selectedRange) && selectedRange > 0 ? selectedRange : state.agenda.rangeDays || 7;
    state.agenda.rangeDays = rangeDays;

    const companyId = elements.company?.value;
    if (!companyId) {
      state.agenda.loading = false;
      state.agenda.summary = createEmptyAgendaSummary();
      state.agenda.items = [];
      state.agenda.periodStart = null;
      state.agenda.periodEnd = null;
      state.agenda.emptyMessage = 'Selecione uma empresa para visualizar a agenda de pagamentos.';
      renderAgenda();
      return;
    }

    state.agenda.loading = true;
    state.agenda.emptyMessage = 'Nenhum pagamento previsto para o período selecionado.';
    renderAgenda();

    try {
      const params = new URLSearchParams();
      params.set('range', String(rangeDays));
      params.set('company', companyId);
      const response = await fetch(`${PAYABLES_API}/agenda?${params.toString()}`, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente para visualizar a agenda de pagamentos.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Erro ao carregar a agenda de pagamentos (${response.status})`);
      }

      const data = await response.json();
      const summary = data?.summary || {};
      state.agenda.summary = {
        upcoming: summary.upcoming || { totalValue: 0, installments: 0 },
        pending: summary.pending || { totalValue: 0, installments: 0 },
        paidThisMonth: summary.paidThisMonth || { totalValue: 0, installments: 0 },
      };

      state.agenda.items = Array.isArray(data?.items)
        ? data.items
            .map((item) => ({
              ...item,
              dueDate: item?.dueDate ? new Date(item.dueDate) : null,
              value: typeof item?.value === 'number' ? item.value : parseCurrency(item?.value),
              status: item?.status || 'pending',
              partyName: item?.partyName || item?.party || '',
              document: item?.document || '',
              payableCode: item?.payableCode || item?.code || '',
              installmentNumber: item?.installmentNumber || item?.number || null,
            }))
            .sort((a, b) => {
              const aTime = a.dueDate instanceof Date && !Number.isNaN(a.dueDate.getTime()) ? a.dueDate.getTime() : 0;
              const bTime = b.dueDate instanceof Date && !Number.isNaN(b.dueDate.getTime()) ? b.dueDate.getTime() : 0;
              if (aTime !== bTime) {
                return aTime - bTime;
              }
              return (a.installmentNumber || 0) - (b.installmentNumber || 0);
            })
        : [];

      if (Number.isFinite(data?.rangeDays) && data.rangeDays > 0) {
        state.agenda.rangeDays = data.rangeDays;
        if (elements.agendaRange) {
          const matchingOption = Array.from(elements.agendaRange.options || []).find(
            (option) => Number.parseInt(option.value, 10) === data.rangeDays
          );
          if (matchingOption) {
            elements.agendaRange.value = matchingOption.value;
          }
        }
      }

      state.agenda.periodStart = data?.periodStart ? new Date(data.periodStart) : null;
      state.agenda.periodEnd = data?.periodEnd ? new Date(data.periodEnd) : null;
      renderAgenda();
    } catch (error) {
      console.error('accounts-payable:loadAgenda', error);
      notify(error.message || 'Não foi possível carregar a agenda de pagamentos.', 'error');
      state.agenda.summary = createEmptyAgendaSummary();
      state.agenda.items = [];
      state.agenda.periodStart = null;
      state.agenda.periodEnd = null;
      state.agenda.emptyMessage = 'Não foi possível carregar a agenda de pagamentos.';
      renderAgenda();
    } finally {
      state.agenda.loading = false;
      renderAgenda();
    }
  }

  function resetPreview() {
    state.previewInstallments = [];
    renderPreview();
  }

  async function handleGeneratePreview(event) {
    if (event) event.preventDefault();
    const preview = buildInstallmentsPreview();
    if (!preview.length) {
      notify('Informe valor, emissão, vencimento e quantidade de parcelas para gerar a pré-visualização.', 'warning');
      renderPreview();
      return;
    }
    renderPreview();
  }

  function collectInstallmentsPayload() {
    return state.previewInstallments.map((item, index) => ({
      number: index + 1,
      issueDate: formatDateInputValue(item.issueDate || parseDateInputValue(elements.issueDate?.value)),
      dueDate: item.dueDateInput || formatDateInputValue(item.dueDate),
      value: item.value,
      bankAccount: item.bankAccount || elements.bankAccount?.value || '',
      accountingAccount: item.accountingAccount || elements.ledgerAccount?.value || '',
    }));
  }

  async function handleSave(event) {
    if (event) event.preventDefault();
    if (state.isSaving) return;

    if (!state.selectedParty?.id || !state.selectedParty?.type) {
      notify('Selecione um cliente ou fornecedor antes de salvar.', 'warning');
      elements.partyInput?.focus();
      return;
    }

    const companyId = elements.company?.value;
    if (!companyId) {
      notify('Selecione a empresa de origem do lançamento.', 'warning');
      elements.company?.focus();
      return;
    }

    const bankAccountId = elements.bankAccount?.value;
    const ledgerAccountId = elements.ledgerAccount?.value;
    if (!bankAccountId || !ledgerAccountId) {
      notify('Selecione a conta corrente e a conta contábil antes de salvar.', 'warning');
      return;
    }

    if (!state.previewInstallments.length) {
      notify('Gere e ajuste as parcelas antes de salvar o lançamento.', 'warning');
      return;
    }

    const installments = collectInstallmentsPayload();
    const totalFromInstallments = installments.reduce((acc, item) => acc + parseCurrency(item.value), 0);
    const totalValue = parseCurrency(elements.totalAmount?.value);
    if (Math.abs(totalValue - totalFromInstallments) > 0.01) {
      notify('O valor total deve ser igual à soma das parcelas.', 'warning');
      return;
    }

    const payload = {
      code: elements.code?.value || undefined,
      company: companyId,
      party: state.selectedParty.id,
      partyType: state.selectedParty.type,
      issueDate: elements.issueDate?.value,
      dueDate: elements.dueDate?.value,
      totalValue,
      bankAccount: bankAccountId,
      accountingAccount: ledgerAccountId,
      paymentMethod: elements.paymentMethod?.value || undefined,
      bankDocumentNumber: elements.documentNumber?.value || undefined,
      carrier: elements.carrier?.value || undefined,
      interestFeeValue: parseCurrency(elements.interestFee?.value),
      monthlyInterestPercent: parseCurrency(elements.monthlyInterest?.value),
      interestPercent: parseCurrency(elements.interestPercent?.value),
      installments: installments.map((installment) => ({
        ...installment,
        value: parseCurrency(installment.value),
      })),
    };

    state.isSaving = true;
    elements.saveButton?.classList.add('opacity-70', 'pointer-events-none');

    try {
      const response = await fetch(PAYABLES_API, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente para salvar o lançamento.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Erro ao salvar a conta a pagar (${response.status})`);
      }
      const created = await response.json();
      notify('Conta a pagar salva com sucesso!', 'success');
      if (created?.code && elements.code && !elements.code.value) {
        elements.code.value = created.code;
      }
      loadHistory();
      loadAgenda();
    } catch (error) {
      console.error('accounts-payable:handleSave', error);
      notify(error.message || 'Não foi possível salvar a conta a pagar.', 'error');
    } finally {
      state.isSaving = false;
      elements.saveButton?.classList.remove('opacity-70', 'pointer-events-none');
    }
  }

  function setupPartyInput() {
    if (!elements.partyInput) return;

    elements.partyInput.addEventListener('input', (event) => {
      const { value } = event.target;
      if (!value || !state.selectedParty || value.trim() !== state.selectedParty.label) {
        state.selectedParty = null;
        elements.partyId.value = '';
        elements.partyType.value = '';
      }
      schedulePartySearch(value);
    });

    elements.partyInput.addEventListener('focus', () => {
      if (state.partySuggestions.length) {
        renderPartySuggestions(state.partySuggestions);
      }
    });

    document.addEventListener('click', (event) => {
      if (!elements.partySuggestions) return;
      if (
        event.target !== elements.partyInput &&
        !elements.partySuggestions.contains(event.target)
      ) {
        elements.partySuggestions.classList.add('hidden');
      }
    });
  }

  function setDefaultIssueDate() {
    if (!elements.issueDate || elements.issueDate.value) return;
    const today = new Date();
    elements.issueDate.value = today.toISOString().split('T')[0];
  }

  function setupEventListeners() {
    elements.generateButton?.addEventListener('click', handleGeneratePreview);
    elements.saveButton?.addEventListener('click', handleSave);
    elements.company?.addEventListener('change', () => {
      loadCompanyResources(elements.company.value);
      resetPreview();
      if (state.selectedParty) {
        loadHistory();
      }
      loadAgenda();
    });
    elements.bankAccount?.addEventListener('change', () => {
      const selected = elements.bankAccount.value;
      state.previewInstallments.forEach((installment) => {
        installment.bankAccount = selected;
      });
    });
    elements.ledgerAccount?.addEventListener('change', () => {
      const selected = elements.ledgerAccount.value;
      state.previewInstallments.forEach((installment) => {
        installment.accountingAccount = selected;
      });
    });
    elements.agendaRange?.addEventListener('change', () => {
      loadAgenda();
    });
  }

  async function initialize() {
    state.token = getAuthToken();
    setupTabs();
    setupPartyInput();
    setupEventListeners();
    setDefaultIssueDate();
    updatePreviewEmptyState();
    renderAgenda();
    await Promise.all([loadBanks(), loadCompanies()]);
    if (elements.company?.value) {
      await loadCompanyResources(elements.company.value);
    }
    await loadAgenda();
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
