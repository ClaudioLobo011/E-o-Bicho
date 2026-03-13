(function () {
  const state = {
    filters: {
      startDate: '',
      endDate: '',
      company: '',
      deposit: '',
      user: '',
      operation: '',
      sourceScreen: '',
      sourceType: '',
      search: '',
    },
    deposits: [],
    loading: false,
    pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
    movements: [],
    summary: {
      totalMovements: 0,
      quantityAdded: 0,
      quantityRemoved: 0,
      netQuantity: 0,
      valueAdded: 0,
      valueRemoved: 0,
      netValue: 0,
    },
  };

  const elements = {
    form: document.getElementById('history-filters-form'),
    resetButton: document.getElementById('filters-reset'),
    startDate: document.getElementById('filter-start-date'),
    endDate: document.getElementById('filter-end-date'),
    company: document.getElementById('filter-company'),
    deposit: document.getElementById('filter-deposit'),
    user: document.getElementById('filter-user'),
    operation: document.getElementById('filter-operation'),
    sourceScreen: document.getElementById('filter-screen'),
    sourceType: document.getElementById('filter-source-type'),
    search: document.getElementById('filter-search'),
    summaryTotalMovements: document.getElementById('summary-total-movements'),
    summaryQuantityAdded: document.getElementById('summary-quantity-added'),
    summaryQuantityRemoved: document.getElementById('summary-quantity-removed'),
    summaryNetQuantity: document.getElementById('summary-net-quantity'),
    summaryValueAdded: document.getElementById('summary-value-added'),
    summaryValueRemoved: document.getElementById('summary-value-removed'),
    summaryNetValue: document.getElementById('summary-net-value'),
    tableBody: document.getElementById('history-table-body'),
    emptyState: document.getElementById('history-empty-state'),
    pagination: document.getElementById('history-pagination'),
  };

  if (!elements.form || !elements.tableBody) return;

  const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
  const normalizeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatQuantity = (value) => new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(normalizeNumber(value));

  const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizeNumber(value));

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getToken = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.token || '';
    } catch (_) {
      return '';
    }
  };

  const getHeaders = (extra = {}) => {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const fetchWithAuth = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: getHeaders(options.headers || {}) });
    if (response.status === 401) {
      alert('Sua sessão expirou. Faça login novamente.');
      window.location.href = '/pages/login.html';
      return null;
    }
    return response;
  };

  const buildQuery = () => {
    const params = new URLSearchParams();
    Object.entries(state.filters).forEach(([key, value]) => {
      const normalized = sanitizeString(value);
      if (normalized) params.set(key, normalized);
    });
    params.set('page', String(state.pagination.page || 1));
    params.set('limit', String(state.pagination.limit || 100));
    return params.toString();
  };

  const renderSummary = () => {
    const summary = state.summary || {};
    elements.summaryTotalMovements.textContent = formatQuantity(summary.totalMovements || 0);
    elements.summaryQuantityAdded.textContent = formatQuantity(summary.quantityAdded || 0);
    elements.summaryQuantityRemoved.textContent = formatQuantity(summary.quantityRemoved || 0);
    elements.summaryNetQuantity.textContent = formatQuantity(summary.netQuantity || 0);
    elements.summaryValueAdded.textContent = formatCurrency(summary.valueAdded || 0);
    elements.summaryValueRemoved.textContent = formatCurrency(summary.valueRemoved || 0);
    elements.summaryNetValue.textContent = formatCurrency(summary.netValue || 0);
  };

  const renderTable = () => {
    const rows = Array.isArray(state.movements) ? state.movements : [];
    if (!rows.length) {
      elements.tableBody.innerHTML = '';
      elements.emptyState.classList.remove('hidden');
      return;
    }
    elements.emptyState.classList.add('hidden');
    elements.tableBody.innerHTML = rows.map((movement) => {
      const quantityDelta = normalizeNumber(movement.quantityDelta);
      const deltaClass = quantityDelta > 0 ? 'text-emerald-700' : quantityDelta < 0 ? 'text-rose-700' : 'text-gray-700';
      const opClass =
        movement.operation === 'entrada'
          ? 'bg-emerald-100 text-emerald-700'
          : movement.operation === 'saida'
          ? 'bg-rose-100 text-rose-700'
          : 'bg-gray-100 text-gray-700';
      const fromName = movement?.fromDeposit?.name || movement?.deposit?.name || '—';
      const toName = movement?.toDeposit?.name || movement?.deposit?.name || '—';
      const userLabel = movement?.user?.name || movement?.userName || 'Sistema';
      const userEmail = movement?.user?.email || movement?.userEmail || '';
      const source = movement?.sourceScreen || movement?.sourceType || '—';
      const sourceType = movement?.sourceType || '—';
      const productCode = movement?.product?.code || movement?.productCode || '';
      const productName = movement?.product?.name || movement?.productName || 'Produto';
      const ref = sanitizeString(movement.referenceDocument);

      return `
        <tr class="hover:bg-gray-50 transition">
          <td class="px-4 py-3 align-top">
            <p class="font-semibold text-gray-700">${escapeHtml(formatDateTime(movement.movementDate || movement.createdAt))}</p>
            <p class="text-xs text-gray-500">ID ${escapeHtml(movement.id || '')}</p>
          </td>
          <td class="px-4 py-3 align-top">
            <p class="font-semibold text-gray-700">${escapeHtml(productName)}</p>
            <p class="text-xs text-gray-500">${escapeHtml(productCode || 'Sem código')}</p>
          </td>
          <td class="px-4 py-3 align-top">
            <p class="text-xs text-gray-600"><strong>De:</strong> ${escapeHtml(fromName)}</p>
            <p class="text-xs text-gray-600"><strong>Para:</strong> ${escapeHtml(toName)}</p>
            <p class="text-xs text-gray-500 mt-1">${escapeHtml(movement?.company?.name || '')}</p>
          </td>
          <td class="px-4 py-3 align-top">
            <p class="font-semibold text-gray-700">${escapeHtml(userLabel)}</p>
            <p class="text-xs text-gray-500">${escapeHtml(userEmail)}</p>
          </td>
          <td class="px-4 py-3 align-top">
            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${opClass}">${escapeHtml(movement.operation || 'ajuste')}</span>
            <p class="mt-1 text-xs font-semibold text-gray-700">${escapeHtml(source)}</p>
            <p class="text-xs text-gray-500">${escapeHtml(sourceType)}</p>
            <p class="text-xs text-gray-500">${escapeHtml(ref)}</p>
          </td>
          <td class="px-4 py-3 text-right align-top font-semibold text-gray-700">${escapeHtml(formatQuantity(movement.previousStock || 0))}</td>
          <td class="px-4 py-3 text-right align-top font-semibold ${deltaClass}">${quantityDelta > 0 ? '+' : ''}${escapeHtml(formatQuantity(quantityDelta))}</td>
          <td class="px-4 py-3 text-right align-top font-semibold text-gray-700">${escapeHtml(formatQuantity(movement.currentStock || 0))}</td>
          <td class="px-4 py-3 text-right align-top font-semibold ${deltaClass}">${escapeHtml(formatCurrency(movement.totalValueDelta || 0))}</td>
        </tr>
      `;
    }).join('');
  };

  const renderPagination = () => {
    const total = Number(state.pagination?.total || 0);
    const shown = Array.isArray(state.movements) ? state.movements.length : 0;
    elements.pagination.textContent = `Mostrando ${shown} de ${total}`;
  };

  const fillSelect = (select, items, format) => {
    if (!select) return;
    const current = sanitizeString(select.value);
    const options = ['<option value="">Todos</option>'];
    (Array.isArray(items) ? items : []).forEach((item) => {
      const formatted = format(item);
      if (!formatted?.id) return;
      options.push(`<option value="${escapeHtml(formatted.id)}">${escapeHtml(formatted.label || formatted.id)}</option>`);
    });
    select.innerHTML = options.join('');
    if (current) select.value = current;
  };

  const syncDepositsByCompany = () => {
    const companyId = sanitizeString(state.filters.company);
    const source = companyId
      ? state.deposits.filter((item) => sanitizeString(item.companyId) === companyId)
      : state.deposits;
    const current = sanitizeString(state.filters.deposit);
    fillSelect(elements.deposit, source, (item) => ({ id: item.id, label: item.name }));
    if (current && !source.some((item) => item.id === current)) {
      state.filters.deposit = '';
      elements.deposit.value = '';
    }
  };

  const loadSupport = async () => {
    const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/inventory-movement-logs/support`);
    if (!response || !response.ok) return;
    const payload = await response.json();
    const companies = Array.isArray(payload?.companies) ? payload.companies : [];
    state.deposits = Array.isArray(payload?.deposits) ? payload.deposits : [];
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const screens = Array.isArray(payload?.screens) ? payload.screens : [];

    fillSelect(elements.company, companies, (item) => ({ id: item.id, label: item.name }));
    fillSelect(elements.user, users, (item) => ({ id: item.id, label: `${item.name}${item.email ? ` (${item.email})` : ''}` }));
    fillSelect(elements.sourceScreen, screens.map((screen) => ({ id: screen, label: screen })), (item) => item);
    syncDepositsByCompany();
  };

  const loadMovements = async () => {
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/inventory-movement-logs?${buildQuery()}`);
      if (!response || !response.ok) {
        const payload = response ? await response.json().catch(() => null) : null;
        throw new Error(payload?.message || 'Falha ao carregar histórico.');
      }
      const payload = await response.json();
      state.movements = Array.isArray(payload?.movements) ? payload.movements : [];
      state.summary = payload?.summary || state.summary;
      state.pagination = payload?.pagination || state.pagination;
      renderSummary();
      renderTable();
      renderPagination();
    } catch (error) {
      console.error('Erro ao carregar histórico de movimentação de estoque:', error);
      alert(error.message || 'Não foi possível carregar o histórico de estoque.');
    } finally {
      state.loading = false;
    }
  };

  const updateFiltersFromUI = () => {
    state.filters.startDate = sanitizeString(elements.startDate.value);
    state.filters.endDate = sanitizeString(elements.endDate.value);
    state.filters.company = sanitizeString(elements.company.value);
    state.filters.deposit = sanitizeString(elements.deposit.value);
    state.filters.user = sanitizeString(elements.user.value);
    state.filters.operation = sanitizeString(elements.operation.value);
    state.filters.sourceScreen = sanitizeString(elements.sourceScreen.value);
    state.filters.sourceType = sanitizeString(elements.sourceType.value);
    state.filters.search = sanitizeString(elements.search.value);
  };

  const resetFilters = async () => {
    state.filters = {
      startDate: '',
      endDate: '',
      company: '',
      deposit: '',
      user: '',
      operation: '',
      sourceScreen: '',
      sourceType: '',
      search: '',
    };
    state.pagination.page = 1;
    elements.form.reset();
    syncDepositsByCompany();
    await loadMovements();
  };

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    updateFiltersFromUI();
    state.pagination.page = 1;
    await loadMovements();
  });

  elements.company.addEventListener('change', () => {
    updateFiltersFromUI();
    syncDepositsByCompany();
  });

  elements.resetButton.addEventListener('click', () => {
    resetFilters();
  });

  (async () => {
    await loadSupport();
    await loadMovements();
  })();
})();
