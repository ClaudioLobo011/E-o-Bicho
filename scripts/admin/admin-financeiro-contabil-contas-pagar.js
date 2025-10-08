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
    payablesCache: new Map(),
    currentEditing: null,
    isSaving: false,
    agenda: {
      rangeDays: 7,
      loading: false,
      periodStart: null,
      periodEnd: null,
      summary: {
        upcoming: { totalValue: 0, installments: 0 },
        pending: { totalValue: 0, installments: 0 },
        protest: { totalValue: 0, installments: 0 },
        cancelled: { totalValue: 0, installments: 0 },
        paidThisMonth: { totalValue: 0, installments: 0 },
      },
      items: [],
      emptyMessage: 'Nenhum pagamento previsto para o período selecionado.',
      filterStatus: 'all',
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
    clearButton: document.getElementById('payable-clear'),
    carrierList: document.getElementById('carrier-bank-list'),
    agendaRange: document.getElementById('agenda-range'),
    agendaPeriodLabel: document.getElementById('agenda-period-label'),
    agendaUpcomingValue: document.getElementById('agenda-upcoming-value'),
    agendaUpcomingCount: document.getElementById('agenda-upcoming-count'),
    agendaPendingValue: document.getElementById('agenda-pending-value'),
    agendaPendingCount: document.getElementById('agenda-pending-count'),
    agendaPaidValue: document.getElementById('agenda-paid-value'),
    agendaPaidCount: document.getElementById('agenda-paid-count'),
    agendaProtestValue: document.getElementById('agenda-protest-value'),
    agendaProtestCount: document.getElementById('agenda-protest-count'),
    agendaCancelledValue: document.getElementById('agenda-cancelled-value'),
    agendaCancelledCount: document.getElementById('agenda-cancelled-count'),
    agendaTableBody: document.getElementById('agenda-table-body'),
    agendaEmpty: document.getElementById('agenda-empty'),
    agendaFilters: document.getElementById('agenda-status-filters'),
  };

  const STATUS_BADGES = {
    pending: {
      icon: 'fa-circle-exclamation',
      classes: 'bg-amber-100 text-amber-700',
      label: 'Pendente',
    },
    paid: {
      icon: 'fa-circle-check',
      classes: 'bg-emerald-100 text-emerald-700',
      label: 'Pago',
    },
    cancelled: {
      icon: 'fa-circle-xmark',
      classes: 'bg-slate-200 text-slate-600',
      label: 'Cancelado',
    },
    protest: {
      icon: 'fa-file-contract',
      classes: 'bg-purple-100 text-purple-700',
      label: 'Protestado',
    },
  };

  const STATUS_LABELS = {
    pending: 'Pendente',
    paid: 'Pago',
    cancelled: 'Cancelado',
    protest: 'Protestado',
  };

  const AGENDA_FILTERS = [
    { key: 'all', label: 'Todos' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'overdue', label: 'Vencidos' },
    { key: 'paid', label: 'Quitados' },
    { key: 'cancelled', label: 'Cancelados' },
    { key: 'protest', label: 'Protestados' },
  ];

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

  function roundCurrency(value) {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : parseCurrency(value);
    return Math.round(numeric * 100) / 100;
  }

  function toCurrencyNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return roundCurrency(value);
    }
    if (typeof value === 'string') {
      return roundCurrency(parseCurrency(value));
    }
    return 0;
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

  function normalizeStatusToken(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    let normalized = trimmed;
    if (typeof normalized.normalize === 'function') {
      try {
        normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      } catch (error) {
        /* noop */
      }
    }
    normalized = normalized.replace(/[^a-z0-9\s-]/gi, ' ');
    return normalized.replace(/[\s_-]+/g, ' ').trim().toLowerCase();
  }

  const PENDING_STATUS_TOKENS = new Set([
    'pending',
    'pendente',
    'pendentes',
    'open',
    'em aberto',
    'aberto',
    'aguardando pagamento',
    'aguardando',
    'overdue',
    'vencido',
    'vencida',
    'em atraso',
    'atrasado',
    'atrasada',
  ]);

  const PAID_STATUS_TOKENS = new Set([
    'paid',
    'pago',
    'paga',
    'quitado',
    'quitada',
    'liquidado',
    'liquidada',
    'finalizado',
    'finalizada',
    'concluido',
    'concluida',
  ]);

  const PROTEST_STATUS_TOKENS = new Set([
    'protest',
    'protesto',
    'protestado',
    'protestada',
    'em protesto',
  ]);

  const CANCELLED_STATUS_TOKENS = new Set([
    'cancelled',
    'cancel',
    'cancelar',
    'cancelado',
    'cancelada',
    'cancelamento',
    'anulado',
    'anulada',
  ]);

  function canonicalStatus(value) {
    const token = normalizeStatusToken(value);
    if (!token) return 'pending';
    if (PAID_STATUS_TOKENS.has(token)) return 'paid';
    if (PROTEST_STATUS_TOKENS.has(token)) return 'protest';
    if (CANCELLED_STATUS_TOKENS.has(token)) return 'cancelled';
    return 'pending';
  }

  function createEmptyAgendaSummary() {
    return {
      upcoming: { totalValue: 0, installments: 0 },
      pending: { totalValue: 0, installments: 0 },
      protest: { totalValue: 0, installments: 0 },
      cancelled: { totalValue: 0, installments: 0 },
      paidThisMonth: { totalValue: 0, installments: 0 },
    };
  }

  function normalizeAgendaSummaryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return { totalValue: 0, installments: 0 };
    }
    const total = Number(entry.totalValue ?? entry.total ?? 0);
    const installments = Number(entry.installments ?? entry.count ?? 0);
    return {
      totalValue: Number.isFinite(total) ? total : 0,
      installments: Number.isFinite(installments) ? installments : 0,
    };
  }

  function mergeAgendaSummaries(primary = {}, secondary = {}, { overrideKeys = [] } = {}) {
    const result = createEmptyAgendaSummary();
    const overrides = new Set(Array.isArray(overrideKeys) ? overrideKeys : []);

    Object.keys(result).forEach((key) => {
      const normalized = normalizeAgendaSummaryEntry(primary[key]);
      result[key] = { ...result[key], ...normalized };
    });

    Object.keys(result).forEach((key) => {
      const normalized = normalizeAgendaSummaryEntry(secondary[key]);
      if (overrides.has(key)) {
        result[key] = { ...result[key], ...normalized };
        return;
      }
      if (!Number.isFinite(result[key].totalValue) || result[key].totalValue === 0) {
        result[key].totalValue = normalized.totalValue;
      }
      if (!Number.isFinite(result[key].installments) || result[key].installments === 0) {
        result[key].installments = normalized.installments;
      }
    });

    Object.keys(result).forEach((key) => {
      result[key].totalValue = roundCurrency(result[key].totalValue);
      const count = Number(result[key].installments);
      result[key].installments = Number.isFinite(count) && count >= 0 ? count : 0;
    });

    return result;
  }

  function buildAgendaSummaryFromItems(items, { periodStart = null, periodEnd = null } = {}) {
    const summary = createEmptyAgendaSummary();
    const list = Array.isArray(items) ? items : [];
    const startTime = isValidDate(periodStart) ? periodStart.getTime() : null;
    const endTime = isValidDate(periodEnd)
      ? new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999).getTime()
      : null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    list.forEach((item) => {
      const status = canonicalStatus(item?.status);
      const value = toCurrencyNumber(item?.value);
      const dueDate = toDate(item?.dueDate);
      const dueTime = isValidDate(dueDate) ? dueDate.getTime() : null;
      const withinPeriod =
        startTime !== null && endTime !== null && dueTime !== null ? dueTime >= startTime && dueTime <= endTime : true;

      if (withinPeriod && (status === 'pending' || status === 'protest')) {
        summary.upcoming.totalValue += value;
        summary.upcoming.installments += 1;
      }

      if (status === 'pending') {
        summary.pending.totalValue += value;
        summary.pending.installments += 1;
      }

      if (status === 'protest') {
        summary.protest.totalValue += value;
        summary.protest.installments += 1;
      }

      if (status === 'cancelled') {
        summary.cancelled.totalValue += value;
        summary.cancelled.installments += 1;
      }

      if (status === 'paid' && dueTime !== null && dueDate >= monthStart && dueDate < monthEnd) {
        summary.paidThisMonth.totalValue += value;
        summary.paidThisMonth.installments += 1;
      }
    });

    summary.upcoming.totalValue = roundCurrency(summary.upcoming.totalValue);
    summary.pending.totalValue = roundCurrency(summary.pending.totalValue);
    summary.protest.totalValue = roundCurrency(summary.protest.totalValue);
    summary.cancelled.totalValue = roundCurrency(summary.cancelled.totalValue);
    summary.paidThisMonth.totalValue = roundCurrency(summary.paidThisMonth.totalValue);

    return summary;
  }

  function getStatusBadgeConfig(status) {
    const canonical = canonicalStatus(status);
    if (STATUS_BADGES[canonical]) {
      return STATUS_BADGES[canonical];
    }
    const label = STATUS_LABELS[canonical] || 'Indefinido';
    return { icon: 'fa-circle-info', classes: 'bg-slate-100 text-slate-700', label };
  }

  function buildActionButton({ action, icon, label, className = '', dataset = {} }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    const baseClass =
      'inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1';
    button.className = `${baseClass} ${className}`.trim();
    Object.entries(dataset).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      button.dataset[key] = String(value);
    });
    button.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
    return button;
  }

  function formatInstallmentsText(count, singular, plural) {
    const safeCount = Number.isFinite(count) ? count : 0;
    return `${safeCount} ${safeCount === 1 ? singular : plural}`;
  }

  function updateSaveButtonMode(isEditing) {
    if (!elements.saveButton) return;
    if (isEditing) {
      elements.saveButton.innerHTML =
        '<i class="fas fa-pen-to-square"></i> Atualizar lançamento';
    } else if (originalSaveButtonHTML) {
      elements.saveButton.innerHTML = originalSaveButtonHTML;
    }
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function isValidDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  function isAgendaItemOverdue(item) {
    if (!item) return false;
    const due = toDate(item.dueDate);
    if (!due) return false;
    const status = (item.status || '').toLowerCase();
    if (status !== 'pending') return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return due < today;
  }

  function computeAgendaFilterCounts(items) {
    const counts = {
      all: 0,
      pending: 0,
      overdue: 0,
      paid: 0,
      cancelled: 0,
      protest: 0,
    };
    items.forEach((item) => {
      counts.all += 1;
      const status = (item.status || '').toLowerCase();
      if (status === 'pending') counts.pending += 1;
      if (status === 'paid') counts.paid += 1;
      if (status === 'cancelled') counts.cancelled += 1;
      if (status === 'protest') counts.protest += 1;
      if (isAgendaItemOverdue(item)) counts.overdue += 1;
    });
    return counts;
  }

  function getAgendaFilterPredicate(filterKey) {
    switch (filterKey) {
      case 'pending':
        return (item) => (item.status || '').toLowerCase() === 'pending';
      case 'paid':
        return (item) => (item.status || '').toLowerCase() === 'paid';
      case 'cancelled':
        return (item) => (item.status || '').toLowerCase() === 'cancelled';
      case 'protest':
        return (item) => (item.status || '').toLowerCase() === 'protest';
      case 'overdue':
        return (item) => isAgendaItemOverdue(item);
      default:
        return () => true;
    }
  }

  function getFilteredAgendaItems() {
    const items = Array.isArray(state.agenda.items) ? state.agenda.items : [];
    const predicate = getAgendaFilterPredicate(state.agenda.filterStatus || 'all');
    return items.filter(predicate);
  }

  function renderAgendaFilters() {
    if (!elements.agendaFilters) return;
    elements.agendaFilters.innerHTML = '';
    const items = Array.isArray(state.agenda.items) ? state.agenda.items : [];
    const counts = computeAgendaFilterCounts(items);
    AGENDA_FILTERS.forEach((filter) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.filter = filter.key;
      button.className =
        'inline-flex items-center gap-2 rounded-full border px-4 py-1 text-xs font-semibold transition';
      const isActive = state.agenda.filterStatus === filter.key;
      if (isActive) {
        button.classList.add('border-primary', 'bg-primary', 'text-white', 'shadow-sm');
      } else {
        button.classList.add('border-gray-200', 'bg-white', 'text-gray-600', 'hover:bg-gray-50');
      }
      const label = document.createElement('span');
      label.textContent = filter.label;
      const badge = document.createElement('span');
      badge.className = isActive
        ? 'inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full bg-white/20 px-2 text-[0.7rem]'
        : 'inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full bg-gray-100 px-2 text-[0.7rem] text-gray-600';
      badge.textContent = counts[filter.key] ?? 0;
      button.appendChild(label);
      button.appendChild(badge);
      elements.agendaFilters.appendChild(button);
    });
  }

  function normalizePayable(raw) {
    if (!raw) return null;
    const normalized = {
      ...raw,
      issueDate: toDate(raw.issueDate),
      dueDate: toDate(raw.dueDate),
      totalValue: parseCurrency(raw.totalValue),
      status: canonicalStatus(raw.status),
    };
    if (raw.bankAccount && raw.bankAccount._id) {
      normalized.bankAccount = { ...raw.bankAccount };
    }
    if (raw.accountingAccount && raw.accountingAccount._id) {
      normalized.accountingAccount = { ...raw.accountingAccount };
    }
    if (raw.paymentMethod && raw.paymentMethod._id) {
      normalized.paymentMethod = { ...raw.paymentMethod };
    }
    normalized.installments = Array.isArray(raw.installments)
      ? raw.installments.map((installment, index) => ({
          ...installment,
          number: installment?.number || index + 1,
          issueDate: toDate(installment?.issueDate) || toDate(raw.issueDate),
          dueDate: toDate(installment?.dueDate) || toDate(raw.dueDate),
          value: parseCurrency(installment?.value),
          bankAccount: installment?.bankAccount && installment.bankAccount._id
            ? { ...installment.bankAccount }
            : installment?.bankAccount || null,
          accountingAccount: installment?.accountingAccount && installment.accountingAccount._id
            ? { ...installment.accountingAccount }
            : installment?.accountingAccount || null,
          status: canonicalStatus(installment?.status),
        }))
      : [];
    normalized.installmentsCount = normalized.installments.length || normalized.installmentsCount || 0;
    return normalized;
  }

  function ensurePayablesCache() {
    if (!(state.payablesCache instanceof Map)) {
      state.payablesCache = new Map();
    }
    return state.payablesCache;
  }

  function storePayableInCache(payable) {
    const cache = ensurePayablesCache();
    if (payable?._id) {
      cache.set(payable._id, payable);
    }
  }

  function removePayableFromCache(id) {
    const cache = ensurePayablesCache();
    if (id && cache.has(id)) {
      cache.delete(id);
    }
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

  async function fetchPayableById(id, { force = false } = {}) {
    if (!id) return null;
    const cache = ensurePayablesCache();
    if (!force && cache.has(id)) {
      return cache.get(id);
    }
    try {
      const response = await fetch(`${PAYABLES_API}/${id}`, {
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Conta a pagar não encontrada.');
        }
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente para continuar.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Erro ao carregar o lançamento (${response.status}).`);
      }
      const data = await response.json();
      const normalized = normalizePayable(data);
      if (normalized) {
        storePayableInCache(normalized);
      }
      return normalized;
    } catch (error) {
      console.error('accounts-payable:fetchPayableById', error);
      throw error;
    }
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
    if (elements.agendaProtestValue) {
      elements.agendaProtestValue.textContent = formatCurrencyBR(state.agenda.summary.protest.totalValue);
    }
    if (elements.agendaProtestCount) {
      elements.agendaProtestCount.textContent = formatInstallmentsText(
        state.agenda.summary.protest.installments,
        'parcela protestada',
        'parcelas protestadas'
      );
    }
    if (elements.agendaCancelledValue) {
      elements.agendaCancelledValue.textContent = formatCurrencyBR(state.agenda.summary.cancelled.totalValue);
    }
    if (elements.agendaCancelledCount) {
      elements.agendaCancelledCount.textContent = formatInstallmentsText(
        state.agenda.summary.cancelled.installments,
        'parcela cancelada',
        'parcelas canceladas'
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
        '<td colspan="6" class="px-4 py-6 text-center text-sm text-gray-500">Carregando agenda de pagamentos...</td>';
      elements.agendaTableBody.appendChild(loadingRow);
      elements.agendaEmpty?.classList.add('hidden');
      return;
    }

    const filteredItems = getFilteredAgendaItems();
    const hasAnyItems = Array.isArray(state.agenda.items) && state.agenda.items.length > 0;

    if (!filteredItems.length) {
      if (elements.agendaEmpty) {
        if (hasAnyItems && (state.agenda.filterStatus || 'all') !== 'all') {
          elements.agendaEmpty.textContent =
            'Nenhum pagamento encontrado para o filtro selecionado.';
        } else {
          elements.agendaEmpty.textContent =
            state.agenda.emptyMessage || 'Nenhum pagamento previsto para o período selecionado.';
        }
        elements.agendaEmpty.classList.remove('hidden');
      }
      return;
    }

    elements.agendaEmpty?.classList.add('hidden');

    filteredItems.forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'bg-white';
      if (item.payableId) {
        row.dataset.payableId = item.payableId;
      }
      if (item.installmentNumber) {
        row.dataset.installmentNumber = item.installmentNumber;
      }

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

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-3 text-sm text-center';
      const payableIdAttr = item.payableId || '';
      const installmentAttr = item.installmentNumber != null ? item.installmentNumber : '';
      const canonical = canonicalStatus(item.status);
      const dataset = { id: payableIdAttr, installment: installmentAttr };
      const hasInstallment = installmentAttr !== '';

      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'grid grid-cols-3 gap-1';
      actionsWrapper.style.maxWidth = '18rem';
      actionsWrapper.style.margin = '0 auto';
      actionsWrapper.style.justifyItems = 'stretch';

      actionsWrapper.appendChild(
        buildActionButton({
          action: 'edit-agenda',
          icon: 'fa-pen',
          label: 'Editar',
          className: 'border-primary text-primary hover:bg-primary/10',
          dataset,
        })
      );

      if (hasInstallment && canonical !== 'paid') {
        actionsWrapper.appendChild(
          buildActionButton({
            action: 'mark-paid',
            icon: 'fa-money-check-dollar',
            label: 'Registrar',
            className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
            dataset,
          })
        );
      }

      if (hasInstallment && canonical !== 'cancelled') {
        actionsWrapper.appendChild(
          buildActionButton({
            action: 'cancel-installment',
            icon: 'fa-ban',
            label: 'Cancelar',
            className: 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
            dataset,
          })
        );
      }

      if (hasInstallment && canonical !== 'protest') {
        actionsWrapper.appendChild(
          buildActionButton({
            action: 'mark-protest',
            icon: 'fa-file-contract',
            label: 'Protesto',
            className: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100',
            dataset,
          })
        );
      }

      if (hasInstallment && canonical !== 'pending') {
        actionsWrapper.appendChild(
          buildActionButton({
            action: 'restore-installment',
            icon: 'fa-rotate-left',
            label: 'Reabrir',
            className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
            dataset,
          })
        );
      }

      actionsWrapper.appendChild(
        buildActionButton({
          action: 'delete-agenda',
          icon: 'fa-trash',
          label: 'Excluir',
          className: 'border-red-200 text-red-600 hover:bg-red-50',
          dataset,
        })
      );

      actionsCell.appendChild(actionsWrapper);
      row.appendChild(actionsCell);

      elements.agendaTableBody.appendChild(row);
    });
  }

  function renderAgenda() {
    updateAgendaPeriodLabel();
    renderAgendaSummary();
    renderAgendaFilters();
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
        status: 'pending',
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

    const totalInstallments = state.previewInstallments.length;

    state.previewInstallments.forEach((installment, index) => {
      const row = document.createElement('tr');
      row.className = 'bg-white';

      const numberCell = document.createElement('td');
      numberCell.className = 'px-4 py-3 font-medium text-gray-800';
      const displayNumber = installment.number || index + 1;
      numberCell.textContent = `${displayNumber}/${totalInstallments || 1}`;
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
      statusCell.className = 'px-4 py-3 text-sm text-center';
      const badge = document.createElement('span');
      const badgeConfig = getStatusBadgeConfig(installment.status || 'pending');
      badge.className = `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badgeConfig.classes}`;
      badge.innerHTML = `<i class="fas ${badgeConfig.icon}"></i> ${badgeConfig.label}`;
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-3 text-sm text-center';
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className =
        'inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50';
      removeButton.innerHTML = '<i class="fas fa-times"></i> Remover';
      removeButton.addEventListener('click', () => {
        removePreviewInstallment(index);
      });
      actionsCell.appendChild(removeButton);
      row.appendChild(actionsCell);

      elements.previewBody.appendChild(row);
    });

    updatePreviewEmptyState();
  }

  function removePreviewInstallment(index) {
    if (!Array.isArray(state.previewInstallments)) return;
    if (index < 0 || index >= state.previewInstallments.length) return;
    state.previewInstallments.splice(index, 1);
    state.previewInstallments.forEach((installment, idx) => {
      if (installment && typeof installment === 'object') {
        // Garante numeração sequencial após remoções
        // eslint-disable-next-line no-param-reassign
        installment.number = idx + 1;
      }
    });
    if (elements.installments) {
      const newLength = state.previewInstallments.length;
      elements.installments.value = String(newLength > 0 ? newLength : 1);
    }
    renderPreview();
    updatePreviewEmptyState();
  }

  function resetFormFields({ preserveCompany = true } = {}) {
    const companyValue = preserveCompany && elements.company ? elements.company.value : '';
    if (elements.code) elements.code.value = '';
    if (elements.partyInput) elements.partyInput.value = '';
    if (elements.partyId) elements.partyId.value = '';
    if (elements.partyType) elements.partyType.value = '';
    state.selectedParty = null;

    if (elements.issueDate) elements.issueDate.value = '';
    if (elements.dueDate) elements.dueDate.value = '';
    if (elements.totalAmount) elements.totalAmount.value = '';
    if (elements.installments) elements.installments.value = '1';
    if (elements.bankAccount) elements.bankAccount.value = '';
    if (elements.ledgerAccount) elements.ledgerAccount.value = '';
    if (elements.paymentMethod) elements.paymentMethod.value = '';
    if (elements.documentNumber) elements.documentNumber.value = '';
    if (elements.carrier) elements.carrier.value = '';
    if (elements.interestFee) elements.interestFee.value = '';
    if (elements.monthlyInterest) elements.monthlyInterest.value = '';
    if (elements.interestPercent) elements.interestPercent.value = '';

    state.previewInstallments = [];
    renderPreview();
    updatePreviewEmptyState();

    if (elements.company) {
      elements.company.value = companyValue || '';
    }

    setDefaultIssueDate();
  }

  function exitEditMode(clearFields = false) {
    state.currentEditing = null;
    updateSaveButtonMode(false);
    if (clearFields) {
      resetFormFields({ preserveCompany: true });
    }
  }

  async function handleClearForm(event) {
    if (event) {
      event.preventDefault();
    }
    if (state.isSaving) {
      notify('Aguarde o término do salvamento antes de limpar o formulário.', 'warning');
      return;
    }

    exitEditMode(false);
    state.selectedParty = null;
    state.partySuggestions = [];
    if (elements.partySuggestions) {
      elements.partySuggestions.innerHTML =
        '<div class="py-3 text-center text-xs text-gray-500">Digite ao menos 3 caracteres para buscar.</div>';
      elements.partySuggestions.classList.add('hidden');
    }

    resetFormFields({ preserveCompany: false });
    state.history = [];
    renderHistory();

    try {
      await loadCompanyResources('');
      state.agenda.filterStatus = 'all';
      await loadAgenda();
      notify('Formulário limpo para um novo lançamento.', 'info');
    } catch (error) {
      console.error('accounts-payable:handleClearForm', error);
      notify('Formulário limpo, mas não foi possível recarregar todos os dados auxiliares.', 'warning');
    }
  }

  async function enterEditMode(payable, { focusInstallmentNumber = null } = {}) {
    if (!payable) return;
    const previousPartyId = state.selectedParty?.id;
    const previousPartyType = state.selectedParty?.type;

    state.currentEditing = { id: payable._id, installmentNumber: focusInstallmentNumber };
    updateSaveButtonMode(true);

    const companyId = payable.company?._id || '';
    if (elements.company && companyId) {
      if (elements.company.value !== companyId) {
        elements.company.value = companyId;
        await loadCompanyResources(companyId);
        await loadAgenda();
      } else {
        await loadCompanyResources(companyId);
      }
    }

    if (payable.party?._id) {
      const partyLabel = payable.party.name || payable.party.document || '';
      state.selectedParty = {
        id: payable.party._id,
        type: payable.partyType || payable.party.type || '',
        label: partyLabel,
      };
      if (elements.partyInput) elements.partyInput.value = partyLabel;
      if (elements.partyId) elements.partyId.value = payable.party._id;
      if (elements.partyType) elements.partyType.value = state.selectedParty.type;
    }

    if (elements.code) elements.code.value = payable.code || '';
    if (elements.issueDate) elements.issueDate.value = formatDateInputValue(payable.issueDate) || '';
    if (elements.dueDate) elements.dueDate.value = formatDateInputValue(payable.dueDate) || '';
    if (elements.totalAmount) {
      const total = parseCurrency(payable.totalValue);
      elements.totalAmount.value = Number.isFinite(total) ? total.toFixed(2) : '';
    }
    if (elements.bankAccount) elements.bankAccount.value = payable.bankAccount?._id || '';
    if (elements.ledgerAccount) elements.ledgerAccount.value = payable.accountingAccount?._id || '';
    if (elements.paymentMethod) elements.paymentMethod.value = payable.paymentMethod?._id || '';
    if (elements.documentNumber) elements.documentNumber.value = payable.bankDocumentNumber || '';
    if (elements.carrier) elements.carrier.value = payable.carrier || '';
    if (elements.interestFee) {
      const value = parseCurrency(payable.interestFeeValue);
      elements.interestFee.value = Number.isFinite(value) && value !== 0 ? value.toFixed(2) : '';
    }
    if (elements.monthlyInterest) {
      const value = parseCurrency(payable.monthlyInterestPercent);
      elements.monthlyInterest.value = Number.isFinite(value) && value !== 0 ? value.toFixed(2) : '';
    }
    if (elements.interestPercent) {
      const value = parseCurrency(payable.interestPercent);
      elements.interestPercent.value = Number.isFinite(value) && value !== 0 ? value.toFixed(2) : '';
    }

    state.previewInstallments = Array.isArray(payable.installments)
      ? payable.installments.map((installment) => ({
          number: installment.number,
          issueDate: installment.issueDate || payable.issueDate,
          dueDate: installment.dueDate || payable.dueDate,
          dueDateInput: formatDateInputValue(installment.dueDate || payable.dueDate),
          value: parseCurrency(installment.value),
          bankAccount:
            installment.bankAccount?._id || installment.bankAccount || payable.bankAccount?._id || '',
          accountingAccount:
            installment.accountingAccount?._id || installment.accountingAccount || payable.accountingAccount?._id || '',
          status: installment.status || 'pending',
        }))
      : [];

    if (elements.installments) {
      const count = state.previewInstallments.length || payable.installmentsCount || 1;
      elements.installments.value = String(count);
    }

    renderPreview();
    updatePreviewEmptyState();

    if (
      state.selectedParty?.id &&
      (state.selectedParty.id !== previousPartyId || state.selectedParty.type !== previousPartyType)
    ) {
      await loadHistory();
    }
  }

  function renderHistory() {
    if (!elements.historyBody) return;
    elements.historyBody.innerHTML = '';

    const payables = Array.isArray(state.history) ? state.history : [];
    let hasRows = false;

    payables.forEach((payable) => {
      const installments = Array.isArray(payable.installments) && payable.installments.length
        ? payable.installments
        : [
            {
              number: null,
              dueDate: payable.dueDate,
              value: payable.totalValue,
              status: payable.status || 'pending',
            },
          ];

      installments.forEach((installment) => {
        hasRows = true;
        const row = document.createElement('tr');
        row.className = 'bg-white';
        if (payable._id) {
          row.dataset.payableId = payable._id;
        }
        if (installment.number != null) {
          row.dataset.installmentNumber = installment.number;
        }

        const descriptionCell = document.createElement('td');
        descriptionCell.className = 'px-4 py-3 text-sm text-gray-700';
        const installmentLabel = installment.number ? ` • Parcela ${installment.number}` : '';
        descriptionCell.textContent = `${payable.code || 'Título'}${installmentLabel}`;
        row.appendChild(descriptionCell);

        const documentCell = document.createElement('td');
        documentCell.className = 'px-4 py-3 text-sm text-gray-600';
        documentCell.textContent = payable.bankDocumentNumber || '--';
        row.appendChild(documentCell);

        const dueCell = document.createElement('td');
        dueCell.className = 'px-4 py-3 text-sm text-gray-600';
        dueCell.textContent = formatDateBR(installment.dueDate || payable.dueDate);
        row.appendChild(dueCell);

        const valueCell = document.createElement('td');
        valueCell.className = 'px-4 py-3 text-sm text-right text-gray-800';
        valueCell.textContent = formatCurrencyBR(installment.value || payable.totalValue);
        row.appendChild(valueCell);

        const statusCell = document.createElement('td');
        statusCell.className = 'px-4 py-3 text-sm text-center';
        const badge = document.createElement('span');
        const badgeConfig = getStatusBadgeConfig(installment.status || payable.status || 'pending');
        badge.className = `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badgeConfig.classes}`;
        badge.innerHTML = `<i class="fas ${badgeConfig.icon}"></i> ${badgeConfig.label}`;
        statusCell.appendChild(badge);
        row.appendChild(statusCell);

        const actionsCell = document.createElement('td');
        actionsCell.className = 'px-4 py-3 text-sm text-center';
        const payableIdAttr = payable._id || '';
        const installmentAttr = installment.number != null ? installment.number : '';
        const canonical = canonicalStatus(installment.status || payable.status);
        const dataset = { id: payableIdAttr, installment: installmentAttr };
        const hasInstallment = installmentAttr !== '';

        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'grid grid-cols-3 gap-1';
        actionsWrapper.style.maxWidth = '18rem';
        actionsWrapper.style.margin = '0 auto';
        actionsWrapper.style.justifyItems = 'stretch';

        actionsWrapper.appendChild(
          buildActionButton({
            action: 'edit-history',
            icon: 'fa-pen',
            label: 'Editar',
            className: 'border-primary text-primary hover:bg-primary/10',
            dataset,
          })
        );

        if (hasInstallment && canonical !== 'paid') {
          actionsWrapper.appendChild(
            buildActionButton({
              action: 'mark-paid',
              icon: 'fa-money-check-dollar',
              label: 'Registrar',
              className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
              dataset,
            })
          );
        }

        if (hasInstallment && canonical !== 'cancelled') {
          actionsWrapper.appendChild(
            buildActionButton({
              action: 'cancel-installment',
              icon: 'fa-ban',
              label: 'Cancelar',
              className: 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
              dataset,
            })
          );
        }

        if (hasInstallment && canonical !== 'protest') {
          actionsWrapper.appendChild(
            buildActionButton({
              action: 'mark-protest',
              icon: 'fa-file-contract',
              label: 'Protesto',
              className: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100',
              dataset,
            })
          );
        }

        if (hasInstallment && canonical !== 'pending') {
          actionsWrapper.appendChild(
            buildActionButton({
              action: 'restore-installment',
              icon: 'fa-rotate-left',
              label: 'Reabrir',
              className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
              dataset,
            })
          );
        }

        actionsWrapper.appendChild(
          buildActionButton({
            action: 'delete-history',
            icon: 'fa-trash',
            label: 'Excluir',
            className: 'border-red-200 text-red-600 hover:bg-red-50',
            dataset,
          })
        );

        actionsCell.appendChild(actionsWrapper);
        row.appendChild(actionsCell);

        elements.historyBody.appendChild(row);
      });
    });

    if (!hasRows) {
      if (elements.historyEmpty) {
        elements.historyEmpty.classList.remove('hidden');
      }
      return;
    }

    if (elements.historyEmpty) {
      elements.historyEmpty.classList.add('hidden');
    }
  }

  async function handleEditPayable(payableId, installmentNumber) {
    if (!payableId) {
      notify('Não foi possível identificar o lançamento selecionado.', 'warning');
      return;
    }
    try {
      const payable = await fetchPayableById(payableId, { force: true });
      if (!payable) {
        notify('Conta a pagar não encontrada.', 'error');
        return;
      }
      await enterEditMode(payable, { focusInstallmentNumber: installmentNumber || null });
      notify('Lançamento carregado para edição.', 'info');
    } catch (error) {
      notify(error.message || 'Não foi possível carregar o lançamento selecionado.', 'error');
    }
  }

  async function performDeletePayable(payableId, { deleteAll = false, installmentNumber = null } = {}) {
    if (!payableId) return null;
    let url = `${PAYABLES_API}/${payableId}`;
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
      if (response.status === 401) {
        notify('Sua sessão expirou. Faça login novamente para excluir o lançamento.', 'error');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || `Erro ao excluir o lançamento (${response.status}).`);
    }
    const data = await response.json();
    return data;
  }

  async function handleDeletePayable(payableId, installmentNumber) {
    if (!payableId) {
      notify('Não foi possível identificar o lançamento selecionado.', 'warning');
      return;
    }
    try {
      const payable = await fetchPayableById(payableId, { force: false });
      if (!payable) {
        notify('Conta a pagar não encontrada.', 'error');
        return;
      }

      const confirmRemoval = await confirmDialog({
        title: 'Excluir lançamento',
        message: 'Deseja realmente excluir este lançamento de contas a pagar?',
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
      });
      if (!confirmRemoval) return;

      const totalInstallments = Array.isArray(payable.installments) ? payable.installments.length : 0;

      if (totalInstallments > 1 && installmentNumber) {
        const deleteAll = await confirmDialog({
          title: 'Excluir parcelas',
          message:
            'Excluir todas as parcelas deste lançamento? Escolha "Excluir todas" para remover o título completo ou "Somente esta" para remover apenas a parcela atual.',
          confirmText: 'Excluir todas',
          cancelText: 'Somente esta',
        });

        if (deleteAll) {
          await performDeletePayable(payableId, { deleteAll: true });
          removePayableFromCache(payableId);
          exitEditMode(state.currentEditing?.id === payableId);
          notify('Lançamento excluído com sucesso.', 'success');
        } else {
          const confirmSingle = await confirmDialog({
            title: 'Excluir parcela',
            message: `Deseja excluir a parcela ${installmentNumber}?`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
          });
          if (!confirmSingle) return;

          const updated = await performDeletePayable(payableId, {
            deleteAll: false,
            installmentNumber,
          });

          if (updated && updated._id) {
            const normalized = normalizePayable(updated);
            storePayableInCache(normalized);
            if (state.currentEditing?.id === payableId) {
              await enterEditMode(normalized, { focusInstallmentNumber: null });
            }
            notify('Parcela excluída com sucesso.', 'success');
          } else {
            removePayableFromCache(payableId);
            exitEditMode(state.currentEditing?.id === payableId);
            notify('Lançamento excluído.', 'success');
          }
        }
      } else {
        await performDeletePayable(payableId, { deleteAll: true });
        removePayableFromCache(payableId);
        exitEditMode(state.currentEditing?.id === payableId);
        notify('Lançamento excluído com sucesso.', 'success');
      }

      await loadAgenda();
      await loadHistory();
    } catch (error) {
      console.error('accounts-payable:handleDeletePayable', error);
      notify(error.message || 'Não foi possível excluir o lançamento selecionado.', 'error');
    }
  }

  async function updateInstallmentStatus(payableId, installmentNumber, targetStatus) {
    if (!payableId || !Number.isFinite(installmentNumber)) {
      throw new Error('Parcela inválida para atualização.');
    }

    const url = `${PAYABLES_API}/${payableId}/installments/${installmentNumber}/status`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: targetStatus }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        notify('Sua sessão expirou. Faça login novamente para atualizar o status.', 'error');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || `Erro ao atualizar o status (${response.status}).`);
    }

    const data = await response.json();
    const normalized = normalizePayable(data);
    if (normalized) {
      storePayableInCache(normalized);
    }
    return normalized;
  }

  async function handleInstallmentStatusAction(context, targetStatus) {
    if (!context?.payableId || !Number.isFinite(context.installmentNumber)) {
      notify('Não foi possível identificar a parcela selecionada.', 'warning');
      return;
    }

    const installmentLabel = `parcela ${context.installmentNumber}`;
    const statusLabel = STATUS_LABELS[targetStatus] || targetStatus;
    const confirmMessage =
      targetStatus === 'pending'
        ? `Deseja reabrir a ${installmentLabel}?`
        : `Deseja marcar a ${installmentLabel} como ${statusLabel.toLowerCase()}?`;

    const confirmed = await confirmDialog({
      title: 'Atualizar status',
      message: confirmMessage,
      confirmText: targetStatus === 'pending' ? 'Reabrir parcela' : 'Atualizar status',
      cancelText: 'Cancelar',
    });

    if (!confirmed) {
      return;
    }

    try {
      await updateInstallmentStatus(context.payableId, context.installmentNumber, targetStatus);
      notify('Status da parcela atualizado com sucesso.', 'success');
      await loadAgenda();
      await loadHistory();
    } catch (error) {
      console.error('accounts-payable:updateInstallmentStatus', error);
      notify(error.message || 'Erro ao atualizar o status da parcela.', 'error');
    }
  }

  function handleAgendaFilterClick(event) {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    const filterKey = button.dataset.filter || 'all';
    if (state.agenda.filterStatus === filterKey) return;
    state.agenda.filterStatus = filterKey;
    renderAgenda();
  }

  function extractActionContext(target) {
    const button = target.closest('button[data-action]');
    if (!button) return null;
    const installmentRaw = button.dataset.installment;
    const installmentNumber = installmentRaw ? Number.parseInt(installmentRaw, 10) : null;
    return {
      action: button.dataset.action,
      payableId: button.dataset.id || button.getAttribute('data-payable-id') || '',
      installmentNumber: Number.isFinite(installmentNumber) ? installmentNumber : null,
    };
  }

  function handleAgendaTableClick(event) {
    const context = extractActionContext(event.target);
    if (!context || !context.payableId) return;
    if (context.action === 'edit-agenda') {
      handleEditPayable(context.payableId, context.installmentNumber);
    } else if (context.action === 'mark-paid') {
      handleInstallmentStatusAction(context, 'paid');
    } else if (context.action === 'mark-protest') {
      handleInstallmentStatusAction(context, 'protest');
    } else if (context.action === 'cancel-installment') {
      handleInstallmentStatusAction(context, 'cancelled');
    } else if (context.action === 'restore-installment') {
      handleInstallmentStatusAction(context, 'pending');
    } else if (context.action === 'delete-agenda') {
      handleDeletePayable(context.payableId, context.installmentNumber);
    }
  }

  function handleHistoryTableClick(event) {
    const context = extractActionContext(event.target);
    if (!context || !context.payableId) return;
    if (context.action === 'edit-history') {
      handleEditPayable(context.payableId, context.installmentNumber);
    } else if (context.action === 'mark-paid') {
      handleInstallmentStatusAction(context, 'paid');
    } else if (context.action === 'mark-protest') {
      handleInstallmentStatusAction(context, 'protest');
    } else if (context.action === 'cancel-installment') {
      handleInstallmentStatusAction(context, 'cancelled');
    } else if (context.action === 'restore-installment') {
      handleInstallmentStatusAction(context, 'pending');
    } else if (context.action === 'delete-history') {
      handleDeletePayable(context.payableId, context.installmentNumber);
    }
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
      const payables = Array.isArray(data?.payables) ? data.payables.map(normalizePayable) : [];
      state.history = payables;
      payables.forEach((payable) => storePayableInCache(payable));
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

    state.agenda.loading = true;
    state.agenda.emptyMessage = 'Nenhum pagamento previsto para o período selecionado.';
    renderAgenda();

    try {
      const params = new URLSearchParams();
      params.set('range', String(rangeDays));
      const companyId = elements.company?.value;
      if (companyId) {
        params.set('company', companyId);
      }
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
      const apiSummary = data?.summary || {};

      const mappedItems = Array.isArray(data?.items)
        ? data.items
            .map((item) => ({
              ...item,
              dueDate: item?.dueDate ? new Date(item.dueDate) : null,
              value: typeof item?.value === 'number' ? item.value : parseCurrency(item?.value),
              status: canonicalStatus(item?.status),
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

      const computedSummary = buildAgendaSummaryFromItems(mappedItems, {
        periodStart: state.agenda.periodStart,
        periodEnd: state.agenda.periodEnd,
      });

      const overrideKeys = mappedItems.length ? ['upcoming', 'pending', 'protest', 'cancelled'] : [];
      state.agenda.summary = mergeAgendaSummaries(apiSummary, computedSummary, { overrideKeys });

      state.agenda.items = mappedItems;
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
      number: item.number || index + 1,
      issueDate: formatDateInputValue(item.issueDate || parseDateInputValue(elements.issueDate?.value)),
      dueDate: item.dueDateInput || formatDateInputValue(item.dueDate),
      value: item.value,
      bankAccount: item.bankAccount || elements.bankAccount?.value || '',
      accountingAccount: item.accountingAccount || elements.ledgerAccount?.value || '',
      status: item.status || 'pending',
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
      const isEditing = Boolean(state.currentEditing?.id);
      const endpoint = isEditing ? `${PAYABLES_API}/${state.currentEditing.id}` : PAYABLES_API;
      const method = isEditing ? 'PUT' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 401) {
          notify('Sua sessão expirou. Faça login novamente para salvar o lançamento.', 'error');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData?.message ||
            (isEditing
              ? `Erro ao atualizar a conta a pagar (${response.status})`
              : `Erro ao salvar a conta a pagar (${response.status})`)
        );
      }
      const saved = await response.json();
      const normalized = normalizePayable(saved);
      if (normalized) {
        storePayableInCache(normalized);
      }
      notify(isEditing ? 'Conta a pagar atualizada com sucesso!' : 'Conta a pagar salva com sucesso!', 'success');
      if (normalized?.code && elements.code) {
        elements.code.value = normalized.code;
      }
      if (isEditing && normalized) {
        await enterEditMode(normalized, {
          focusInstallmentNumber: state.currentEditing?.installmentNumber || null,
        });
      } else if (!isEditing && normalized?._id) {
        await enterEditMode(normalized, { focusInstallmentNumber: null });
      }
      await loadHistory();
      await loadAgenda();
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
    elements.clearButton?.addEventListener('click', handleClearForm);
    elements.company?.addEventListener('change', () => {
      loadCompanyResources(elements.company.value);
      resetPreview();
      if (state.selectedParty) {
        loadHistory();
      }
      state.agenda.filterStatus = 'all';
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
    elements.agendaFilters?.addEventListener('click', handleAgendaFilterClick);
    elements.agendaTableBody?.addEventListener('click', handleAgendaTableClick);
    elements.historyBody?.addEventListener('click', handleHistoryTableClick);
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
