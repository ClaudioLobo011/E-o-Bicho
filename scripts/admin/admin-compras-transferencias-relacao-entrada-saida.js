(function () {
  const DEFAULT_LIMIT = 200;

  const state = {
    filters: {
      startDate: '',
      endDate: '',
      operation: '',
      company: '',
      deposit: '',
      responsible: '',
      search: '',
    },
    companies: [],
    allowedCompanies: [],
    deposits: [],
    responsibles: [],
    adjustments: [],
    summary: {
      totalAdjustments: 0,
      totalEntradas: 0,
      totalSaidas: 0,
      netQuantity: 0,
      netValue: 0,
      quantityEntradas: 0,
      quantitySaidas: 0,
      valueEntradas: 0,
      valueSaidas: 0,
    },
    pagination: {
      page: 1,
      limit: DEFAULT_LIMIT,
      total: 0,
      totalPages: 1,
    },
    loading: false,
  };

  const elements = {
    form: document.getElementById('report-filters-form'),
    resetButton: document.getElementById('filters-reset'),
    startDateInput: document.getElementById('filter-date-start'),
    endDateInput: document.getElementById('filter-date-end'),
    operationSelect: document.getElementById('filter-operation'),
    companySelect: document.getElementById('filter-company'),
    depositSelect: document.getElementById('filter-deposit'),
    responsibleSelect: document.getElementById('filter-responsible'),
    searchInput: document.getElementById('filter-search'),
    summaryPeriodLabel: document.getElementById('summary-period-label'),
    summaryFilterDescription: document.getElementById('summary-filter-description'),
    summaryTotalAdjustments: document.getElementById('summary-total-adjustments'),
    summaryTotalEntradas: document.getElementById('summary-total-entradas'),
    summaryTotalSaidas: document.getElementById('summary-total-saidas'),
    summaryNetQuantity: document.getElementById('summary-net-quantity'),
    summaryNetValue: document.getElementById('summary-net-value'),
    summaryQuantityEntradas: document.getElementById('summary-quantity-entradas'),
    summaryQuantitySaidas: document.getElementById('summary-quantity-saidas'),
    summaryValueEntradas: document.getElementById('summary-value-entradas'),
    summaryValueSaidas: document.getElementById('summary-value-saidas'),
    tableBody: document.getElementById('report-table-body'),
    tableContainer: document.getElementById('report-table-container'),
    emptyState: document.getElementById('report-empty-state'),
    paginationLabel: document.getElementById('report-pagination'),
  };

  if (!elements.form || !elements.tableBody) {
    return;
  }

  function sanitizeInput(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  function getToken() {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.token || null;
    } catch (error) {
      console.warn('Não foi possível ler o token salvo.', error);
      return null;
    }
  }

  function buildAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function fetchWithAuth(url, options = {}) {
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(options.headers),
      },
    };

    const response = await fetch(url, config);
    if (response.status === 401) {
      alert('Sua sessão expirou. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return null;
    }
    return response;
  }

  function isCompanyAllowed(companyId) {
    if (!companyId) return false;
    return state.allowedCompanies.some((company) => company.id === companyId);
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

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatQuantity(value) {
    const number = normalizeNumber(value);
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(number);
  }

  function formatCurrency(value) {
    const number = normalizeNumber(value);
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR').format(date);
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  function renderOperationBadge(operation) {
    const normalized = sanitizeInput(operation).toLowerCase();
    const isEntrada = normalized === 'entrada';
    const classes = isEntrada
      ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700'
      : 'inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700';
    const icon = isEntrada ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
    const label = isEntrada ? 'Entrada' : 'Saída';
    return `<span class="${classes}"><i class="fas ${icon}"></i>${label}</span>`;
  }

  function summarizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }

    const parts = items.slice(0, 3).map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const name = escapeHtml(item.name || 'Produto sem nome');
      const quantity = formatQuantity(item.quantity);
      const unitValue = item.unitValue !== null && item.unitValue !== undefined
        ? formatCurrency(item.unitValue)
        : '';
      const details = [quantity ? `Qtde: ${quantity}` : '', unitValue ? `Vlr: ${unitValue}` : '']
        .filter(Boolean)
        .join(' • ');
      const suffix = details ? ` — ${details}` : '';
      return `<li>${name}${suffix}</li>`;
    }).filter(Boolean);

    if (items.length > 3) {
      const remaining = items.length - 3;
      parts.push(`<li>+${remaining} item(ns)</li>`);
    }

    return `<ul class="mt-2 space-y-1 text-xs text-gray-500">${parts.join('')}</ul>`;
  }

  function describeFilters() {
    const descriptions = [];
    const { operation, company, deposit, responsible, search } = state.filters;

    if (operation) {
      descriptions.push(operation === 'entrada' ? 'Somente entradas' : 'Somente saídas');
    }

    if (company) {
      const found = state.companies.find((item) => item.id === company);
      if (found) {
        descriptions.push(`Empresa: ${found.name}`);
      }
    }

    if (deposit) {
      const found = state.deposits.find((item) => item.id === deposit);
      if (found) {
        descriptions.push(`Depósito: ${found.name}`);
      }
    }

    if (responsible) {
      const found = state.responsibles.find((item) => item.id === responsible);
      if (found) {
        descriptions.push(`Responsável: ${found.name}`);
      }
    }

    if (search) {
      descriptions.push(`Busca: “${escapeHtml(search)}”`);
    }

    if (descriptions.length === 0) {
      return 'Todos os registros disponíveis';
    }

    return descriptions.join(' • ');
  }

  function updatePeriodLabel() {
    const { startDate, endDate } = state.filters;
    if (!startDate && !endDate) {
      if (elements.summaryPeriodLabel) {
        elements.summaryPeriodLabel.innerHTML = '<i class="fas fa-calendar-alt"></i> Todos os períodos';
      }
      return;
    }

    const start = startDate ? formatDateTime(startDate) : null;
    const end = endDate ? formatDateTime(endDate) : null;
    const parts = [];

    if (start) {
      parts.push(`De ${start}`);
    }
    if (end) {
      parts.push(start ? `até ${end}` : `Até ${end}`);
    }

    if (elements.summaryPeriodLabel) {
      elements.summaryPeriodLabel.innerHTML = `<i class="fas fa-calendar-alt"></i> ${parts.join(' ')}`;
    }
  }

  function updateSummary() {
    const summary = state.summary || {};

    if (elements.summaryTotalAdjustments) {
      elements.summaryTotalAdjustments.textContent = formatQuantity(summary.totalAdjustments || 0);
    }
    if (elements.summaryTotalEntradas) {
      elements.summaryTotalEntradas.textContent = formatQuantity(summary.totalEntradas || 0);
    }
    if (elements.summaryTotalSaidas) {
      elements.summaryTotalSaidas.textContent = formatQuantity(summary.totalSaidas || 0);
    }
    if (elements.summaryNetQuantity) {
      elements.summaryNetQuantity.textContent = formatQuantity(summary.netQuantity || 0);
    }
    if (elements.summaryNetValue) {
      elements.summaryNetValue.textContent = formatCurrency(summary.netValue || 0);
    }
    if (elements.summaryQuantityEntradas) {
      elements.summaryQuantityEntradas.textContent = formatQuantity(summary.quantityEntradas || 0);
    }
    if (elements.summaryQuantitySaidas) {
      elements.summaryQuantitySaidas.textContent = formatQuantity(summary.quantitySaidas || 0);
    }
    if (elements.summaryValueEntradas) {
      elements.summaryValueEntradas.textContent = formatCurrency(summary.valueEntradas || 0);
    }
    if (elements.summaryValueSaidas) {
      elements.summaryValueSaidas.textContent = formatCurrency(summary.valueSaidas || 0);
    }
    if (elements.summaryFilterDescription) {
      elements.summaryFilterDescription.textContent = describeFilters();
    }
  }

  function updatePaginationLabel() {
    if (!elements.paginationLabel) return;
    const shown = state.adjustments.length;
    const total = state.pagination?.total || shown;
    elements.paginationLabel.textContent = `Mostrando ${shown} de ${total} movimentações`;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    if (elements.tableContainer) {
      elements.tableContainer.classList.toggle('opacity-60', isLoading);
    }
    if (isLoading) {
      elements.tableBody.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-sm text-gray-500">Carregando movimentações...</td></tr>';
      if (elements.emptyState) {
        elements.emptyState.classList.add('hidden');
      }
    }
  }

  function renderAdjustments() {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = '';

    if (!Array.isArray(state.adjustments) || state.adjustments.length === 0) {
      if (elements.emptyState) {
        elements.emptyState.classList.remove('hidden');
      }
      return;
    }

    if (elements.emptyState) {
      elements.emptyState.classList.add('hidden');
    }

    const rows = state.adjustments.map((adjustment) => {
      if (!adjustment || typeof adjustment !== 'object') {
        return '';
      }

      const movementDate = adjustment.movementDateTime || adjustment.movementDate || '';
      const reason = escapeHtml(adjustment.reason || 'Motivo não informado');
      const reference = sanitizeInput(adjustment.referenceDocument || '');
      const notes = sanitizeInput(adjustment.notes || '');
      const companyName = escapeHtml(adjustment.company?.name || '—');
      const depositName = escapeHtml(adjustment.deposit?.name || '—');
      const responsibleName = escapeHtml(adjustment.responsible?.name || '—');
      const responsibleEmail = escapeHtml(adjustment.responsible?.email || '');
      const createdByName = escapeHtml(adjustment.createdBy?.name || '—');
      const createdByEmail = escapeHtml(adjustment.createdBy?.email || '');
      const itemsSummary = summarizeItems(adjustment.items);
      const totalQuantity = formatQuantity(adjustment.totalQuantity || 0);
      const totalValue = formatCurrency(adjustment.totalValue || 0);
      const referenceHtml = reference
        ? `<div class="text-xs text-gray-500">Documento: ${escapeHtml(reference)}</div>`
        : '';
      const notesHtml = notes
        ? `<div class="text-xs text-gray-500">Obs.: ${escapeHtml(notes)}</div>`
        : '';

      return `
        <tr class="align-top">
          <td class="px-4 py-3 text-sm text-gray-700">${formatDate(movementDate)}</td>
          <td class="px-4 py-3 text-sm">${renderOperationBadge(adjustment.operation)}</td>
          <td class="px-4 py-3 text-sm">
            <div class="font-semibold text-gray-800">${reason}</div>
            ${referenceHtml}
            ${notesHtml}
            ${itemsSummary}
          </td>
          <td class="px-4 py-3 text-sm text-gray-700">
            <div class="font-medium text-gray-800">${depositName}</div>
            <div class="text-xs text-gray-500">${companyName}</div>
          </td>
          <td class="px-4 py-3 text-sm text-gray-700">
            <div class="font-medium text-gray-800">${responsibleName}</div>
            ${responsibleEmail ? `<div class="text-xs text-gray-500">${responsibleEmail}</div>` : ''}
          </td>
          <td class="px-4 py-3 text-sm text-gray-700">
            <div class="font-medium text-gray-800">${createdByName}</div>
            ${createdByEmail ? `<div class="text-xs text-gray-500">${createdByEmail}</div>` : ''}
          </td>
          <td class="px-4 py-3 text-right text-sm font-semibold ${adjustment.operation === 'saida' ? 'text-rose-600' : 'text-emerald-600'}">${totalQuantity}</td>
          <td class="px-4 py-3 text-right text-sm font-semibold ${adjustment.operation === 'saida' ? 'text-rose-600' : 'text-emerald-600'}">${totalValue}</td>
        </tr>
      `;
    }).filter(Boolean);

    elements.tableBody.innerHTML = rows.join('');
    updatePaginationLabel();
  }

  function validateDates(filters) {
    const startRaw = sanitizeInput(filters.startDate || '');
    const endRaw = sanitizeInput(filters.endDate || '');
    if (startRaw && endRaw && startRaw > endRaw) {
      alert('A data inicial não pode ser posterior à data final.');
      return false;
    }
    return true;
  }

  function readFiltersFromForm() {
    return {
      startDate: sanitizeInput(elements.startDateInput?.value || ''),
      endDate: sanitizeInput(elements.endDateInput?.value || ''),
      operation: sanitizeInput(elements.operationSelect?.value || ''),
      company: sanitizeInput(elements.companySelect?.value || ''),
      deposit: sanitizeInput(elements.depositSelect?.value || ''),
      responsible: sanitizeInput(elements.responsibleSelect?.value || ''),
      search: sanitizeInput(elements.searchInput?.value || ''),
    };
  }

  function setFormFromFilters() {
    if (elements.startDateInput) elements.startDateInput.value = state.filters.startDate || '';
    if (elements.endDateInput) elements.endDateInput.value = state.filters.endDate || '';
    if (elements.operationSelect) elements.operationSelect.value = state.filters.operation || '';
    if (elements.companySelect) elements.companySelect.value = state.filters.company || '';
    updateDepositOptions();
    if (elements.depositSelect) elements.depositSelect.value = state.filters.deposit || '';
    if (elements.responsibleSelect) elements.responsibleSelect.value = state.filters.responsible || '';
    if (elements.searchInput) elements.searchInput.value = state.filters.search || '';
  }

  function updateDepositOptions() {
    if (!elements.depositSelect) return;
    const selectedCompany = sanitizeInput(elements.companySelect?.value || '');
    const deposits = state.deposits.filter((deposit) => !selectedCompany || deposit.companyId === selectedCompany);

    const currentValue = elements.depositSelect.value;
    elements.depositSelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Todos';
    elements.depositSelect.appendChild(defaultOption);

    deposits.forEach((deposit) => {
      const option = document.createElement('option');
      option.value = deposit.id;
      option.textContent = deposit.name;
      elements.depositSelect.appendChild(option);
    });

    if (selectedCompany && currentValue && !deposits.some((deposit) => deposit.id === currentValue)) {
      elements.depositSelect.value = '';
    }
  }

  function populateCompanies(companies) {
    if (!elements.companySelect) return;
    elements.companySelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Todas';
    elements.companySelect.appendChild(defaultOption);

    companies.forEach((company) => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = company.name;
      elements.companySelect.appendChild(option);
    });
  }

  function populateResponsibles(responsibles) {
    if (!elements.responsibleSelect) return;
    elements.responsibleSelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Todos';
    elements.responsibleSelect.appendChild(defaultOption);

    responsibles.forEach((responsible) => {
      const option = document.createElement('option');
      option.value = responsible.id;
      option.textContent = responsible.name;
      elements.responsibleSelect.appendChild(option);
    });
  }

  async function loadFormData() {
    try {
      const [response, allowedResponse] = await Promise.all([
        fetchWithAuth(`${API_CONFIG.BASE_URL}/inventory-adjustments/form-data`),
        fetchWithAuth(`${API_CONFIG.BASE_URL}/stores/allowed`),
      ]);
      if (!response || !allowedResponse) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Nao foi possivel carregar os dados iniciais.');
      }
      if (!allowedResponse.ok) {
        const payload = await allowedResponse.json().catch(() => null);
        throw new Error(payload?.message || 'Nao foi possivel carregar as empresas permitidas.');
      }
      const data = await response.json();
      const allowedPayload = await allowedResponse.json().catch(() => null);
      const allowedCompanies = Array.isArray(allowedPayload?.stores)
        ? allowedPayload.stores.map((store) => ({
            id: store?._id ? String(store._id) : '',
            name: sanitizeInput(store?.nomeFantasia) || sanitizeInput(store?.nome) || 'Empresa sem nome',
          }))
        : Array.isArray(allowedPayload)
        ? allowedPayload.map((store) => ({
            id: store?._id ? String(store._id) : '',
            name: sanitizeInput(store?.nomeFantasia) || sanitizeInput(store?.nome) || 'Empresa sem nome',
          }))
        : [];
      const allowedCompanyIds = new Set(allowedCompanies.map((company) => company.id).filter(Boolean));
      const deposits = Array.isArray(data?.deposits)
        ? data.deposits.map((deposit) => ({
            id: deposit?._id ? String(deposit._id) : '',
            name: sanitizeInput(deposit?.nome) || 'Deposito sem nome',
            companyId: deposit?.empresa ? String(deposit.empresa) : '',
          }))
        : [];
      const responsibles = Array.isArray(data?.responsaveis)
        ? data.responsaveis.map((person) => ({
            id: person?._id ? String(person._id) : '',
            name: sanitizeInput(person?.nomeCompleto) || sanitizeInput(person?.apelido) || sanitizeInput(person?.email) || 'Responsavel',
            email: sanitizeInput(person?.email || ''),
          }))
        : [];

      state.allowedCompanies = allowedCompanies;
      state.companies = allowedCompanies;
      state.deposits = allowedCompanyIds.size
        ? deposits.filter((deposit) => allowedCompanyIds.has(deposit.companyId))
        : [];
      state.responsibles = responsibles;

      populateCompanies(state.companies);
      populateResponsibles(responsibles);
      updateDepositOptions();
      setFormFromFilters();
    } catch (error) {
      console.error('Erro ao carregar dados iniciais da relacao de estoque:', error);
      alert(error.message || 'Nao foi possivel carregar os dados iniciais da relacao.');
    }
  }

  function normalizeSummary(summary) {
    if (!summary || typeof summary !== 'object') {
      return {
        totalAdjustments: 0,
        totalEntradas: 0,
        totalSaidas: 0,
        netQuantity: 0,
        netValue: 0,
        quantityEntradas: 0,
        quantitySaidas: 0,
        valueEntradas: 0,
        valueSaidas: 0,
      };
    }

    return {
      totalAdjustments: normalizeNumber(summary.totalAdjustments),
      totalEntradas: normalizeNumber(summary.totalEntradas),
      totalSaidas: normalizeNumber(summary.totalSaidas),
      netQuantity: normalizeNumber(summary.netQuantity),
      netValue: normalizeNumber(summary.netValue),
      quantityEntradas: normalizeNumber(summary.quantityEntradas),
      quantitySaidas: normalizeNumber(summary.quantitySaidas),
      valueEntradas: normalizeNumber(summary.valueEntradas),
      valueSaidas: normalizeNumber(summary.valueSaidas),
    };
  }

  async function fetchAdjustments() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const {
        startDate,
        endDate,
        operation,
        company,
        deposit,
        responsible,
        search,
      } = state.filters;

      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (operation) params.append('operation', operation);
      if (company) params.append('company', company);
      if (deposit) params.append('deposit', deposit);
      if (responsible) params.append('responsible', responsible);
      if (search) params.append('search', search);

      params.append('limit', state.pagination.limit);

      const url = `${API_CONFIG.BASE_URL}/inventory-adjustments${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetchWithAuth(url);
      if (!response) return;

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Não foi possível carregar as movimentações de estoque.');
      }

      const data = await response.json();
      const adjustments = Array.isArray(data?.adjustments) ? data.adjustments : [];
      state.adjustments = adjustments.map((adjustment) => {
        if (!adjustment || typeof adjustment !== 'object') {
          return adjustment;
        }
        const mapped = { ...adjustment };
        mapped.totalQuantity = normalizeNumber(adjustment.totalQuantity);
        mapped.totalValue = normalizeNumber(adjustment.totalValue);
        mapped.items = Array.isArray(adjustment.items) ? adjustment.items.map((item) => ({
          ...item,
          quantity: normalizeNumber(item.quantity),
          unitValue: item.unitValue !== null && item.unitValue !== undefined ? normalizeNumber(item.unitValue) : null,
        })) : [];
        return mapped;
      });

      state.summary = normalizeSummary(data?.summary);
      state.pagination = {
        page: normalizeNumber(data?.pagination?.page) || 1,
        limit: normalizeNumber(data?.pagination?.limit) || state.pagination.limit,
        total: normalizeNumber(data?.pagination?.total) || state.adjustments.length,
        totalPages: normalizeNumber(data?.pagination?.totalPages) || 1,
      };

      updatePeriodLabel();
      updateSummary();
      renderAdjustments();
    } catch (error) {
      console.error('Erro ao carregar relação de movimentações de estoque:', error);
      alert(error.message || 'Não foi possível carregar as movimentações de estoque.');
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters() {
    const filters = readFiltersFromForm();
    if (!validateDates(filters)) {
      setFormFromFilters();
      return;
    }

    state.filters = { ...filters };
    updatePeriodLabel();
    updateSummary();
    await fetchAdjustments();
  }

  function clearFilters() {
    state.filters = {
      startDate: '',
      endDate: '',
      operation: '',
      company: '',
      deposit: '',
      responsible: '',
      search: '',
    };
    setFormFromFilters();
    updatePeriodLabel();
    updateSummary();
    fetchAdjustments();
  }

  function attachEventListeners() {
    if (elements.form) {
      elements.form.addEventListener('submit', (event) => {
        event.preventDefault();
        applyFilters();
      });
    }

    if (elements.resetButton) {
      elements.resetButton.addEventListener('click', (event) => {
        event.preventDefault();
        clearFilters();
      });
    }

    if (elements.companySelect) {
      elements.companySelect.addEventListener('change', () => {
        const selectedCompany = sanitizeInput(elements.companySelect?.value || '');
        if (selectedCompany && !isCompanyAllowed(selectedCompany)) {
          elements.companySelect.value = '';
          updateDepositOptions();
          alert('Empresa nao autorizada para esta consulta.');
          return;
        }
        updateDepositOptions();
      });
    }
  }

  async function init() {
    attachEventListeners();
    await loadFormData();
    setFormFromFilters();
    updatePeriodLabel();
    updateSummary();
    await fetchAdjustments();
  }

  init();
})();
