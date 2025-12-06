(() => {
  const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) || '/api';

  const elements = {
    start: document.getElementById('sales-period-start'),
    end: document.getElementById('sales-period-end'),
    store: document.getElementById('sales-store'),
    channel: document.getElementById('sales-channel'),
    status: document.getElementById('sales-status'),
    apply: document.getElementById('apply-filters'),
    reset: document.getElementById('reset-filters'),
    pageSize: document.getElementById('page-size'),
    pagePrev: document.getElementById('page-prev'),
    pageNext: document.getElementById('page-next'),
    pageIndicator: document.getElementById('page-indicator'),
    tableBody: document.getElementById('sales-table-body'),
    tableHead: document.getElementById('sales-table-head'),
    emptyState: document.getElementById('sales-empty-state'),
    resultsCounter: document.getElementById('results-counter'),
    metricTotal: document.getElementById('metric-total'),
    metricTotalTrend: document.getElementById('metric-total-trend'),
    metricTicket: document.getElementById('metric-ticket'),
    metricCompleted: document.getElementById('metric-completed'),
    metricCompletedTrend: document.getElementById('metric-completed-trend'),
    metricTicketTrend: document.getElementById('metric-ticket-trend'),
    metricMargin: document.getElementById('metric-margin'),
    metricMarginTrend: document.getElementById('metric-margin-trend'),
  };

  const state = {
    filters: {
      start: '',
      end: '',
      storeId: '',
      channel: '',
      status: '',
    },
    pagination: {
      page: 1,
      pageSize: 25,
      totalPages: 1,
      total: 0,
    },
    loading: false,
    sales: [],
    table: {
      filters: {},
      sort: { key: null, direction: null },
    },
    stores: [],
  };

  const formatCurrency = (value = 0) => {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatPercentage = (value) => {
    if (!Number.isFinite(value)) return '';
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  const tableColumns = [
    { key: 'saleCode', label: 'Pedido', headerClass: 'px-4 py-3', cellClass: 'px-4 py-3 font-semibold text-gray-800' },
    {
      key: 'createdAt',
      label: 'Data',
      headerClass: 'px-4 py-3',
      cellClass: 'px-4 py-3',
      getComparable: (sale) => new Date(sale.createdAt || 0).getTime(),
      getDisplay: (sale) => formatDateTime(sale.createdAt),
    },
    { key: 'store', label: 'Loja', headerClass: 'px-4 py-3', cellClass: 'px-4 py-3', getDisplay: (sale) => sale.store?.name || '—' },
    { key: 'channelLabel', label: 'Canal', headerClass: 'px-4 py-3', cellClass: 'px-4 py-3', fallback: 'PDV' },
    {
      key: 'fiscalType',
      label: 'Tipo',
      headerClass: 'px-4 py-3',
      cellClass: 'px-4 py-3',
      getDisplay: (sale) => sale.fiscalTypeLabel || sale.fiscalType || 'Matricial',
    },
    {
      key: 'totalValue',
      label: 'Total',
      headerClass: 'px-4 py-3 text-right',
      cellClass: 'px-4 py-3 text-right font-semibold text-gray-900',
      isNumeric: true,
      getComparable: (sale) => sale.totalValue ?? 0,
      getDisplay: (sale) => formatCurrency(sale.totalValue),
    },
    {
      key: 'costValue',
      label: 'Custo',
      headerClass: 'px-4 py-3 text-right',
      cellClass: 'px-4 py-3 text-right text-gray-900',
      isNumeric: true,
      getComparable: (sale) => Number.isFinite(sale.costValue) ? sale.costValue : Number.NEGATIVE_INFINITY,
      getDisplay: (sale) => (Number.isFinite(sale.costValue) ? formatCurrency(sale.costValue) : ''),
    },
    {
      key: 'markup',
      label: 'Margem',
      headerClass: 'px-4 py-3 text-right',
      cellClass: 'px-4 py-3 text-right text-gray-600',
      isNumeric: true,
      getComparable: (sale) => Number.isFinite(sale.markup) ? sale.markup : Number.NEGATIVE_INFINITY,
      getDisplay: (sale) => (Number.isFinite(sale.markup) ? formatPercentage(sale.markup) : ''),
    },
    {
      key: 'status',
      label: 'Status',
      headerClass: 'px-4 py-3 text-right',
      cellClass: 'px-4 py-3 text-right',
      getDisplay: (sale) => sale.status,
    },
  ];

  tableColumns.forEach((column) => {
    state.table.filters[column.key] = '';
  });

  const getDisplayValue = (sale, column) => {
    if (typeof column.getDisplay === 'function') return column.getDisplay(sale);
    if (column.key === 'store') return sale.store?.name || '—';
    return sale[column.key] ?? column.fallback ?? '—';
  };

  const getComparableValue = (sale, column) => {
    if (typeof column.getComparable === 'function') return column.getComparable(sale);
    const value = getDisplayValue(sale, column);
    return typeof value === 'string' ? value.toLowerCase() : value;
  };

  const buildStatusBadge = (status) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'cancelled') {
      return '<span class="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"><i class="fas fa-circle text-[8px]"></i>Cancelado</span>';
    }
    if (normalized === 'pending') {
      return '<span class="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"><i class="fas fa-circle text-[8px]"></i>Pendente</span>';
    }
    return '<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><i class="fas fa-circle text-[8px]"></i>Concluído</span>';
  };

  const getToken = () => {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return loggedInUser?.token || '';
    } catch (_err) {
      return '';
    }
  };

  const setDefaultDates = () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const formatInputDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    elements.start.value = formatInputDate(start);
    elements.end.value = formatInputDate(end);
    state.filters.start = elements.start.value;
    state.filters.end = elements.end.value;
  };

  const updateMetrics = (metrics = {}) => {
    const totalValue = metrics.totalValue || 0;
    const averageTicket = metrics.averageTicket || 0;
    const completedCount = metrics.completedCount || 0;
    const totalChange = metrics.totalChange;
    const averageTicketChange = metrics.averageTicketChange;
    const marginAverage = metrics.marginAverage;
    const marginChange = metrics.marginChange;
    const completedChange = metrics.completedChange;
    if (elements.metricTotal) elements.metricTotal.textContent = formatCurrency(totalValue);
    if (elements.metricTicket) elements.metricTicket.textContent = formatCurrency(averageTicket);
    if (elements.metricCompleted) elements.metricCompleted.textContent = completedCount.toLocaleString('pt-BR');
    if (elements.metricTotalTrend) {
      const trendValue = Number.isFinite(totalChange) ? Math.abs(totalChange) : null;
      const isIncrease = Number.isFinite(totalChange) && totalChange > 0.01;
      const isDecrease = Number.isFinite(totalChange) && totalChange < -0.01;

      elements.metricTotalTrend.className =
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

      if (isIncrease) {
        elements.metricTotalTrend.classList.add('bg-emerald-50', 'text-emerald-700');
        elements.metricTotalTrend.innerHTML = `<i class="fas fa-arrow-up"></i>${formatCurrency(trendValue)}`;
      } else if (isDecrease) {
        elements.metricTotalTrend.classList.add('bg-rose-50', 'text-rose-700');
        elements.metricTotalTrend.innerHTML = `<i class="fas fa-arrow-down"></i>${formatCurrency(trendValue)}`;
      } else if (Number.isFinite(trendValue)) {
        elements.metricTotalTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricTotalTrend.innerHTML = `<i class="fas fa-minus"></i>${formatCurrency(trendValue)}`;
      } else {
        elements.metricTotalTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricTotalTrend.innerHTML = '<i class="fas fa-minus"></i>—';
      }
    }

    if (elements.metricTicketTrend) {
      const trendValue = Number.isFinite(averageTicketChange) ? Math.abs(averageTicketChange) : null;
      const isIncrease = Number.isFinite(averageTicketChange) && averageTicketChange > 0.01;
      const isDecrease = Number.isFinite(averageTicketChange) && averageTicketChange < -0.01;

      elements.metricTicketTrend.className =
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

      if (isIncrease) {
        elements.metricTicketTrend.classList.add('bg-emerald-50', 'text-emerald-700');
        elements.metricTicketTrend.innerHTML = `<i class="fas fa-arrow-up"></i>${formatCurrency(trendValue)}`;
      } else if (isDecrease) {
        elements.metricTicketTrend.classList.add('bg-rose-50', 'text-rose-700');
        elements.metricTicketTrend.innerHTML = `<i class="fas fa-arrow-down"></i>${formatCurrency(trendValue)}`;
      } else if (Number.isFinite(trendValue)) {
        elements.metricTicketTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricTicketTrend.innerHTML = `<i class="fas fa-minus"></i>${formatCurrency(trendValue)}`;
      } else {
        elements.metricTicketTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricTicketTrend.innerHTML = '<i class="fas fa-minus"></i>—';
      }
    }
    if (elements.metricCompletedTrend) {
      const trendValue = Number.isFinite(completedChange) ? Math.abs(completedChange) : null;
      const isIncrease = Number.isFinite(completedChange) && completedChange > 0.01;
      const isDecrease = Number.isFinite(completedChange) && completedChange < -0.01;

      elements.metricCompletedTrend.className =
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

      const formattedTrend = Number.isFinite(trendValue) ? trendValue.toLocaleString('pt-BR') : '—';

      if (isIncrease) {
        elements.metricCompletedTrend.classList.add('bg-emerald-50', 'text-emerald-700');
        elements.metricCompletedTrend.innerHTML = `<i class="fas fa-arrow-up"></i>${formattedTrend}`;
      } else if (isDecrease) {
        elements.metricCompletedTrend.classList.add('bg-rose-50', 'text-rose-700');
        elements.metricCompletedTrend.innerHTML = `<i class="fas fa-arrow-down"></i>${formattedTrend}`;
      } else if (Number.isFinite(trendValue)) {
        elements.metricCompletedTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricCompletedTrend.innerHTML = `<i class="fas fa-minus"></i>${formattedTrend}`;
      } else {
        elements.metricCompletedTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricCompletedTrend.innerHTML = '<i class="fas fa-minus"></i>—';
      }
    }
    if (elements.metricMargin) {
      elements.metricMargin.textContent = Number.isFinite(marginAverage) ? formatPercentage(marginAverage) : '—';
    }
    if (elements.metricMarginTrend) {
      const trendValue = Number.isFinite(marginChange) ? Math.abs(marginChange) : null;
      const isIncrease = Number.isFinite(marginChange) && marginChange > 0.0001;
      const isDecrease = Number.isFinite(marginChange) && marginChange < -0.0001;

      elements.metricMarginTrend.className =
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

      if (isIncrease) {
        elements.metricMarginTrend.classList.add('bg-emerald-50', 'text-emerald-700');
        elements.metricMarginTrend.innerHTML = `<i class="fas fa-arrow-up"></i>${formatPercentage(trendValue)}`;
      } else if (isDecrease) {
        elements.metricMarginTrend.classList.add('bg-rose-50', 'text-rose-700');
        elements.metricMarginTrend.innerHTML = `<i class="fas fa-arrow-down"></i>${formatPercentage(trendValue)}`;
      } else if (Number.isFinite(trendValue)) {
        elements.metricMarginTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricMarginTrend.innerHTML = `<i class="fas fa-minus"></i>${formatPercentage(trendValue)}`;
      } else {
        elements.metricMarginTrend.classList.add('bg-gray-100', 'text-gray-700');
        elements.metricMarginTrend.innerHTML = '<i class="fas fa-minus"></i>—';
      }
    }
  };

  const applyTableState = (items) => {
    const baseItems = Array.isArray(items) ? items : [];
    const filtered = baseItems.filter((sale) => {
      return tableColumns.every((column) => {
        const term = (state.table.filters[column.key] || '').trim().toLowerCase();
        if (!term) return true;
        const display = String(getDisplayValue(sale, column) ?? '').toLowerCase();
        return display.includes(term);
      });
    });

    const { key, direction } = state.table.sort;
    if (!key || !direction) return filtered;

    const targetColumn = tableColumns.find((column) => column.key === key);
    if (!targetColumn) return filtered;

    const directionMultiplier = direction === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      const valueA = getComparableValue(a, targetColumn);
      const valueB = getComparableValue(b, targetColumn);

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        if (!Number.isFinite(valueA) && !Number.isFinite(valueB)) return 0;
        if (!Number.isFinite(valueA)) return -1 * directionMultiplier;
        if (!Number.isFinite(valueB)) return 1 * directionMultiplier;
        if (valueA === valueB) return 0;
        return valueA > valueB ? directionMultiplier : -directionMultiplier;
      }

      const textA = String(valueA ?? '');
      const textB = String(valueB ?? '');
      return textA.localeCompare(textB, 'pt-BR', { sensitivity: 'base', numeric: true }) * directionMultiplier;
    });
  };

  const updateTableHeadSortIndicators = () => {
    if (!elements.tableHead) return;
    const buttons = elements.tableHead.querySelectorAll('[data-sort-button]');
    buttons.forEach((button) => {
      const { columnKey, sortDirection } = button.dataset;
      const isActive = state.table.sort.key === columnKey && state.table.sort.direction === sortDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/40', isActive);
      button.classList.toggle('bg-primary/5', isActive);
      button.classList.toggle('text-gray-400', !isActive);
      button.classList.toggle('border-transparent', !isActive);
    });
  };

  const setTableSort = (key, direction) => {
    const isSame = state.table.sort.key === key && state.table.sort.direction === direction;
    state.table.sort = isSame ? { key: null, direction: null } : { key, direction };
    updateTableHeadSortIndicators();
    renderTable();
  };

  const buildTableHead = () => {
    if (!elements.tableHead) return;
    elements.tableHead.innerHTML = '';

    const row = document.createElement('tr');

    tableColumns.forEach((column) => {
      const th = document.createElement('th');
      th.dataset.columnKey = column.key;
      th.className = `${column.headerClass || ''} align-top bg-gray-50 whitespace-nowrap`;

      const wrapper = document.createElement('div');
      wrapper.className = 'flex flex-col gap-1';

      const labelRow = document.createElement('div');
      labelRow.className = 'flex items-center justify-between gap-1';

      const label = document.createElement('span');
      label.textContent = column.label;
      label.className = 'flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide text-gray-600';
      if (column.isNumeric) label.classList.add('text-right');
      labelRow.appendChild(label);

      const sortGroup = document.createElement('div');
      sortGroup.className = 'flex flex-col items-center justify-center gap-px text-gray-400';

      ['asc', 'desc'].forEach((direction) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.sortButton = 'true';
        button.dataset.columnKey = column.key;
        button.dataset.sortDirection = direction;
        button.className = 'flex h-4 w-4 items-center justify-center rounded border border-transparent text-gray-400 transition';
        button.setAttribute('aria-label', `Ordenar ${direction === 'asc' ? 'crescente' : 'decrescente'} por ${column.label}`);
        button.innerHTML = `<i class="fas fa-sort-${direction === 'asc' ? 'up' : 'down'} text-[10px]"></i>`;
        button.addEventListener('click', () => setTableSort(column.key, direction));
        sortGroup.appendChild(button);
      });

      labelRow.appendChild(sortGroup);

      const filter = document.createElement('input');
      filter.type = 'text';
      filter.placeholder = 'Filtrar';
      filter.value = state.table.filters[column.key] || '';
      filter.className =
        'rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
      if (column.isNumeric) filter.classList.add('text-right');
      filter.addEventListener('input', (event) => {
        state.table.filters[column.key] = event.target.value || '';
        renderTable();
      });

      wrapper.append(labelRow, filter);
      th.appendChild(wrapper);
      row.appendChild(th);
    });

    elements.tableHead.appendChild(row);
    updateTableHeadSortIndicators();
  };

  const updatePagination = (visibleCount = Array.isArray(state.sales) ? state.sales.length : state.pagination.total) => {
    if (elements.pageIndicator) {
      elements.pageIndicator.textContent = `Página ${state.pagination.page} de ${state.pagination.totalPages}`;
    }
    if (elements.resultsCounter) {
      elements.resultsCounter.innerHTML = `<i class="fas fa-magnifying-glass"></i>${visibleCount} vendas encontradas`;
    }
  };

  const renderTable = () => {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = '';
    const visibleSales = applyTableState(state.sales);

    if (!visibleSales.length) {
      if (elements.emptyState) {
        elements.tableBody.appendChild(elements.emptyState);
      }
      updatePagination(0);
      return 0;
    }

    visibleSales.forEach((sale) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50';

      tableColumns.forEach((column) => {
        const cell = document.createElement('td');
        cell.className = column.cellClass || 'px-4 py-3';
        const value = column.key === 'status' ? buildStatusBadge(sale.status) : getDisplayValue(sale, column);
        if (column.key === 'status') {
          cell.innerHTML = value;
        } else {
          cell.textContent = value;
        }
        row.appendChild(cell);
      });

      elements.tableBody.appendChild(row);
    });

    updatePagination(visibleSales.length);
    return visibleSales.length;
  };


  const setLoading = (loading) => {
    state.loading = loading;
    if (elements.apply) {
      elements.apply.disabled = loading;
      elements.apply.classList.toggle('opacity-75', loading);
    }
  };

  const fetchStores = async () => {
    try {
      const response = await fetch(`${API_BASE}/stores`);
      if (!response.ok) throw new Error('Falha ao carregar lojas');
      const data = await response.json();
      const stores = Array.isArray(data) ? data : Array.isArray(data?.stores) ? data.stores : [];
      state.stores = stores;
      if (elements.store) {
        const current = elements.store.value;
        elements.store.innerHTML = '<option value="">Todas as lojas</option>';
        state.stores.forEach((store) => {
          const option = document.createElement('option');
          option.value = store._id;
          option.textContent = store.fantasia || store.nome || 'Loja';
          elements.store.appendChild(option);
        });
        elements.store.value = current;
      }
    } catch (error) {
      console.error('Erro ao carregar lojas:', error);
    }
  };

  const fetchSales = async () => {
    const token = getToken();
    const params = new URLSearchParams();
    params.set('page', state.pagination.page);
    params.set('pageSize', state.pagination.pageSize);
    if (state.filters.start) params.set('start', state.filters.start);
    if (state.filters.end) params.set('end', state.filters.end);
    if (state.filters.storeId) params.set('storeId', state.filters.storeId);
    if (state.filters.channel) params.set('channel', state.filters.channel);
    if (state.filters.status) params.set('status', state.filters.status);

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/reports/pdv-sales?${params.toString()}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });
      if (!response.ok) throw new Error('Não foi possível carregar as vendas.');
      const data = await response.json();
      state.sales = Array.isArray(data.sales) ? data.sales : [];
      state.pagination.totalPages = data?.pagination?.totalPages || 1;
      state.pagination.total = data?.pagination?.total || 0;
      updateMetrics(data.metrics);
      renderTable();
    } catch (error) {
      console.error(error);
      state.sales = [];
      renderTable();
      alert('Erro ao carregar as vendas. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    state.filters.start = elements.start?.value || '';
    state.filters.end = elements.end?.value || '';
    state.filters.storeId = elements.store?.value || '';
    state.filters.channel = elements.channel?.value || '';
    state.filters.status = elements.status?.value || '';
    state.pagination.page = 1;
    state.pagination.pageSize = Number(elements.pageSize?.value || 25);
    fetchSales();
  };

  const resetFilters = () => {
    if (elements.store) elements.store.value = '';
    if (elements.channel) elements.channel.value = '';
    if (elements.status) elements.status.value = '';
    if (elements.pageSize) elements.pageSize.value = '25';
    setDefaultDates();
    applyFilters();
  };

  const setupEvents = () => {
    elements.apply?.addEventListener('click', applyFilters);
    elements.reset?.addEventListener('click', resetFilters);
    elements.pagePrev?.addEventListener('click', () => {
      if (state.pagination.page <= 1) return;
      state.pagination.page -= 1;
      fetchSales();
    });
    elements.pageNext?.addEventListener('click', () => {
      if (state.pagination.page >= state.pagination.totalPages) return;
      state.pagination.page += 1;
      fetchSales();
    });
    elements.pageSize?.addEventListener('change', () => {
      state.pagination.pageSize = Number(elements.pageSize.value || 25);
      state.pagination.page = 1;
      fetchSales();
    });
  };

  const init = async () => {
    setDefaultDates();
    buildTableHead();
    setupEvents();
    await fetchStores();
    applyFilters();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
