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
    table: document.getElementById('sales-table'),
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
      valueFilters: {},
      filterSearch: {},
      openPopover: null,
      columnWidths: {},
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

  const normalizeText = (value) => {
    if (value === null || value === undefined) return '';
    try {
      return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    } catch (_error) {
      return String(value).toLowerCase();
    }
  };

  const normalizeOptionValue = (value) => {
    const normalized = normalizeText(value ?? '');
    return normalized || '__vazio__';
  };

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildFilterRegex = (rawValue) => {
    const normalized = normalizeText(rawValue || '').trim();
    if (!normalized) return null;

    const pattern = normalized
      .split('*')
      .map((segment) => escapeRegex(segment))
      .join('.*');

    if (!pattern) return null;

    try {
      return new RegExp(pattern, 'i');
    } catch (_error) {
      return null;
    }
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

  const formatSellerName = (sale) => {
    const rawName = (sale?.sellerName || sale?.seller?.nome || sale?.seller?.name || '').trim();
    if (!rawName) return '—';

    const parts = rawName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
    return parts[0];
  };

  const tableColumns = [
    {
      key: 'saleCode',
      label: 'Pedido',
      minWidth: 36,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px] font-semibold text-gray-800',
    },
    {
      key: 'createdAt',
      label: 'Data',
      minWidth: 48,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      getComparable: (sale) => new Date(sale.createdAt || 0).getTime(),
      getDisplay: (sale) => formatDateTime(sale.createdAt),
    },
    {
      key: 'sellerName',
      label: 'Vendedor',
      minWidth: 64,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      getDisplay: formatSellerName,
    },
    {
      key: 'store',
      label: 'Loja',
      minWidth: 44,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      getDisplay: (sale) => sale.store?.name || '—',
    },
    {
      key: 'channelLabel',
      label: 'Canal',
      minWidth: 40,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      fallback: 'PDV',
    },
    {
      key: 'fiscalType',
      label: 'Tipo',
      minWidth: 40,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px]',
      getDisplay: (sale) => sale.fiscalTypeLabel || sale.fiscalType || 'Matricial',
    },
    {
      key: 'totalValue',
      label: 'Total',
      minWidth: 54,
      headerClass: 'px-3 py-2 text-right',
      cellClass: 'px-3 py-2.5 text-right text-[11px] font-semibold text-gray-900',
      isNumeric: true,
      getComparable: (sale) => sale.totalValue ?? 0,
      getDisplay: (sale) => formatCurrency(sale.totalValue),
    },
    {
      key: 'costValue',
      label: 'Custo',
      minWidth: 54,
      headerClass: 'px-3 py-2 text-right',
      cellClass: 'px-3 py-2.5 text-right text-[11px] text-gray-900',
      isNumeric: true,
      getComparable: (sale) => Number.isFinite(sale.costValue) ? sale.costValue : Number.NEGATIVE_INFINITY,
      getDisplay: (sale) => (Number.isFinite(sale.costValue) ? formatCurrency(sale.costValue) : ''),
    },
    {
      key: 'markup',
      label: 'Margem',
      minWidth: 44,
      headerClass: 'px-3 py-2 text-right',
      cellClass: 'px-3 py-2.5 text-right text-[11px] text-gray-600',
      isNumeric: true,
      getComparable: (sale) => Number.isFinite(sale.markup) ? sale.markup : Number.NEGATIVE_INFINITY,
      getDisplay: (sale) => (Number.isFinite(sale.markup) ? formatPercentage(sale.markup) : ''),
    },
    {
      key: 'status',
      label: 'Status',
      minWidth: 44,
      headerClass: 'px-3 py-2 text-right',
      cellClass: 'px-3 py-2.5 text-right text-[11px]',
      getDisplay: (sale) => sale.status,
    },
  ];

  const getColumnMinWidth = (key) => {
    const column = tableColumns.find((col) => col.key === key);
    return column?.minWidth || 28;
  };

  const ensureTableLayout = () => {
    if (!elements.table) return;
    elements.table.style.tableLayout = 'fixed';
    elements.table.style.width = 'max-content';
    elements.table.style.minWidth = '100%';
  };

  const ensureTableColGroup = () => {
    if (!elements.table) return null;
    let colgroup = elements.table.querySelector('colgroup[data-sales-columns]');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      colgroup.dataset.salesColumns = 'true';
      tableColumns.forEach((column) => {
        const col = document.createElement('col');
        col.dataset.columnKey = column.key;
        colgroup.appendChild(col);
      });
      elements.table.insertBefore(colgroup, elements.table.firstChild);
    } else {
      const columns = Array.from(colgroup.querySelectorAll('col'));
      const isOutdated =
        columns.length !== tableColumns.length ||
        columns.some((col, index) => col.dataset.columnKey !== tableColumns[index].key);

      if (isOutdated) {
        colgroup.innerHTML = '';
        tableColumns.forEach((column) => {
          const col = document.createElement('col');
          col.dataset.columnKey = column.key;
          colgroup.appendChild(col);
        });
      }
    }
    return colgroup;
  };

  tableColumns.forEach((column) => {
    state.table.filters[column.key] = '';
    state.table.valueFilters[column.key] = null;
    state.table.filterSearch[column.key] = '';
  });

  const getDisplayValue = (sale, column) => {
    if (typeof column.getDisplay === 'function') return column.getDisplay(sale);
    if (column.key === 'store') return sale.store?.name || '—';
    return sale[column.key] ?? column.fallback ?? '—';
  };

  const getOptionLabel = (value) => {
    if (value === undefined || value === null) return 'Vazio';
    const asText = String(value);
    return asText === '' ? 'Vazio' : asText;
  };

  const getColumnOptions = (column) => {
    const unique = new Map();
    state.sales.forEach((sale) => {
      const displayValue = getDisplayValue(sale, column);
      const normalized = normalizeOptionValue(displayValue);
      if (!unique.has(normalized)) {
        unique.set(normalized, {
          normalized,
          label: getOptionLabel(displayValue),
        });
      }
    });

    return Array.from(unique.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base', numeric: true })
    );
  };

  const syncValueFiltersWithData = () => {
    tableColumns.forEach((column) => {
      const selected = state.table.valueFilters[column.key];
      if (!(selected instanceof Set)) return;

      const options = getColumnOptions(column);
      const allowed = new Set(options.map((option) => option.normalized));
      const next = new Set([...selected].filter((value) => allowed.has(value)));

      if (next.size === allowed.size || allowed.size === 0) {
        state.table.valueFilters[column.key] = null;
      } else {
        state.table.valueFilters[column.key] = next;
      }
    });
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
        const term = state.table.filters[column.key] || '';
        const regex = buildFilterRegex(term);
        const hasValueFilter = state.table.valueFilters[column.key] instanceof Set;
        const display = getDisplayValue(sale, column);
        const normalizedDisplay = normalizeText(display ?? '');

        if (hasValueFilter) {
          const selectedValues = state.table.valueFilters[column.key];
          const optionKey = normalizeOptionValue(display);
          if (!selectedValues.has(optionKey)) return false;
        }

        if (!regex) return true;
        return regex.test(normalizedDisplay);
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

  let activePopover = null;
  let activePopoverCleanup = null;

  const closeFilterPopover = () => {
    if (typeof activePopoverCleanup === 'function') {
      activePopoverCleanup();
      activePopoverCleanup = null;
    }

    if (activePopover?.element?.parentNode) {
      activePopover.element.parentNode.removeChild(activePopover.element);
    }

    activePopover = null;
    state.table.openPopover = null;
  };

  const ensureValueFilterSet = (columnKey, options) => {
    if (!(state.table.valueFilters[columnKey] instanceof Set)) {
      const next = new Set(options.map((option) => option.normalized));
      state.table.valueFilters[columnKey] = next;
    }
    return state.table.valueFilters[columnKey];
  };

  const renderFilterPopover = (column, anchor) => {
    if (!anchor) return;

    const parentCell = anchor.closest('th');
    if (!parentCell) return;

    closeFilterPopover();

    const options = getColumnOptions(column);

    const popover = document.createElement('div');
    popover.className =
      'fixed z-40 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg';
    popover.dataset.popoverFor = column.key;

    const title = document.createElement('div');
    title.className = 'mb-2 text-xs font-semibold uppercase text-gray-600';
    title.textContent = `Filtrar ${column.label}`;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Procurar valores';
    searchInput.value = state.table.filterSearch[column.key] || '';
    searchInput.className =
      'mb-2 w-full rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

    const selectAllWrapper = document.createElement('label');
    selectAllWrapper.className = 'mb-2 flex cursor-pointer items-center gap-2 text-sm text-gray-700';

    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.className = 'h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/50';

    const selectAllLabel = document.createElement('span');
    selectAllLabel.textContent = 'Selecionar todos';
    selectAllWrapper.append(selectAllCheckbox, selectAllLabel);

    const list = document.createElement('div');
    list.className = 'max-h-48 space-y-1 overflow-y-auto rounded border border-gray-100 bg-gray-50 px-2 py-2';

    const actions = document.createElement('div');
    actions.className = 'mt-3 flex items-center justify-between gap-2';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className =
      'inline-flex items-center gap-1 rounded border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50';
    clearButton.innerHTML = '<i class="fas fa-eraser"></i>Limpar';

    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className =
      'inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-secondary';
    applyButton.innerHTML = '<i class="fas fa-check"></i>Aplicar';

    actions.append(clearButton, applyButton);

    const renderOptions = () => {
      list.innerHTML = '';

      const searchTerm = normalizeText(state.table.filterSearch[column.key] || '');
      const filteredOptions = options.filter((option) =>
        normalizeText(option.label).includes(searchTerm)
      );

      const selectedSet = state.table.valueFilters[column.key];
      const isAllSelected = !(selectedSet instanceof Set) || selectedSet.size === options.length;
      selectAllCheckbox.checked = isAllSelected;
      selectAllCheckbox.indeterminate = selectedSet instanceof Set && selectedSet.size > 0 && !isAllSelected;

      if (!filteredOptions.length) {
        const empty = document.createElement('p');
        empty.className = 'py-2 text-center text-xs text-gray-500';
        empty.textContent = 'Nenhum valor encontrado';
        list.appendChild(empty);
        return;
      }

      filteredOptions.forEach((option) => {
        const item = document.createElement('label');
        item.className = 'flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-white';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/50';

        const isSelected =
          !(selectedSet instanceof Set) || selectedSet.size === options.length
            ? true
            : selectedSet.has(option.normalized);
        checkbox.checked = isSelected;

        checkbox.addEventListener('change', () => {
          const targetSet = ensureValueFilterSet(column.key, options);
          if (checkbox.checked) {
            targetSet.add(option.normalized);
          } else {
            targetSet.delete(option.normalized);
          }

          if (targetSet.size === options.length) {
            state.table.valueFilters[column.key] = null;
          }

          renderTable();
          renderOptions();
        });

        const text = document.createElement('span');
        text.textContent = option.label;

        item.append(checkbox, text);
        list.appendChild(item);
      });
    };

    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        state.table.valueFilters[column.key] = null;
      } else {
        state.table.valueFilters[column.key] = new Set();
      }
      renderTable();
      renderOptions();
    });

    clearButton.addEventListener('click', () => {
      state.table.valueFilters[column.key] = null;
      state.table.filterSearch[column.key] = '';
      searchInput.value = '';
      renderTable();
      renderOptions();
    });

    applyButton.addEventListener('click', () => {
      closeFilterPopover();
    });

    searchInput.addEventListener('input', (event) => {
      state.table.filterSearch[column.key] = event.target.value || '';
      renderOptions();
    });

    popover.append(title, searchInput, selectAllWrapper, list, actions);

    parentCell.classList.add('relative');
    document.body.appendChild(popover);

    const updatePosition = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();

      const spacing = 6;
      let top = anchorRect.bottom + spacing;
      if (top + popoverRect.height > window.innerHeight) {
        top = anchorRect.top - popoverRect.height - spacing;
      }

      const maxLeft = window.innerWidth - popoverRect.width - spacing;
      const minLeft = spacing;
      let left = anchorRect.left;
      if (left > maxLeft) left = maxLeft;
      if (left < minLeft) left = minLeft;

      popover.style.top = `${Math.max(top, spacing)}px`;
      popover.style.left = `${left}px`;
    };

    updatePosition();

    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();

    const handleClickOutside = (event) => {
      if (!popover.contains(event.target) && !anchor.contains(event.target)) {
        closeFilterPopover();
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') closeFilterPopover();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    activePopover = { key: column.key, element: popover };
    state.table.openPopover = column.key;

    activePopoverCleanup = () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };

    renderOptions();
  };

  const toggleFilterPopover = (column, anchor) => {
    if (state.table.openPopover === column.key) {
      closeFilterPopover();
      return;
    }
    renderFilterPopover(column, anchor);
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

  const applyColumnWidths = (syncFromDom = false) => {
    if (!elements.tableHead) return;

    ensureTableLayout();
    const colgroup = ensureTableColGroup();
    const colMap = colgroup
      ? new Map(Array.from(colgroup.querySelectorAll('col')).map((col) => [col.dataset.columnKey, col]))
      : null;

    const headerCells = Array.from(elements.tableHead.querySelectorAll('th[data-column-key]'));

    headerCells.forEach((th) => {
      const columnKey = th.dataset.columnKey;
      const minWidth = getColumnMinWidth(columnKey);

      if (syncFromDom && !Number.isFinite(state.table.columnWidths[columnKey])) {
        state.table.columnWidths[columnKey] = Math.max(minWidth, th.getBoundingClientRect().width);
      }

      const storedWidth = state.table.columnWidths[columnKey];
      const width = Number.isFinite(storedWidth) ? Math.max(minWidth, storedWidth) : minWidth;

      th.style.width = `${width}px`;
      th.style.minWidth = `${minWidth}px`;

      const colEl = colMap?.get(columnKey);
      if (colEl) {
        colEl.style.width = `${width}px`;
        colEl.style.minWidth = `${minWidth}px`;
      }

      const cells = elements.tableBody?.querySelectorAll(`td[data-column-key="${columnKey}"]`);
      cells?.forEach((cell) => {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${minWidth}px`;
      });
    });
  };

  const startColumnResize = (column, th, startEvent) => {
    if (!th) return;
    startEvent.preventDefault();
    closeFilterPopover();

    const minWidth = getColumnMinWidth(column.key);
    const startX = startEvent.touches?.[0]?.clientX ?? startEvent.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const originalUserSelect = document.body.style.userSelect;
    const originalCursor = document.body.style.cursor;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMove = (moveEvent) => {
      const currentX = moveEvent.touches?.[0]?.clientX ?? moveEvent.clientX;
      if (!Number.isFinite(currentX)) return;
      const delta = currentX - startX;
      const nextWidth = Math.max(minWidth, startWidth + delta);
      state.table.columnWidths[column.key] = nextWidth;
      applyColumnWidths();
    };

    const handleEnd = () => {
      document.body.style.userSelect = originalUserSelect;
      document.body.style.cursor = originalCursor;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
  };

  const buildTableHead = () => {
    if (!elements.tableHead) return;
    elements.tableHead.innerHTML = '';

    const row = document.createElement('tr');

    tableColumns.forEach((column) => {
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

      const filterRow = document.createElement('div');
      filterRow.className = 'flex items-center gap-1';

      const filter = document.createElement('input');
      filter.type = 'text';
      filter.placeholder = 'Filtrar';
      filter.value = state.table.filters[column.key] || '';
      filter.className =
        'flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
      if (column.isNumeric) filter.classList.add('text-right');
      filter.addEventListener('input', (event) => {
        state.table.filters[column.key] = event.target.value || '';
        renderTable();
      });

      const popoverButton = document.createElement('button');
      popoverButton.type = 'button';
      popoverButton.className =
        'flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-primary/50 hover:text-primary';
      popoverButton.setAttribute('aria-label', `Filtrar valores da coluna ${column.label}`);
      popoverButton.innerHTML = '<i class="fas fa-magnifying-glass"></i>';
      popoverButton.addEventListener('click', (event) => {
        event.preventDefault();
        toggleFilterPopover(column, popoverButton);
      });

      filterRow.append(filter, popoverButton);

      wrapper.append(labelRow, filterRow);
      th.appendChild(wrapper);

      const resizeHandle = document.createElement('div');
      resizeHandle.className =
        'absolute inset-y-0 right-0 flex w-2 cursor-col-resize select-none items-center justify-center px-px';
      resizeHandle.setAttribute('aria-label', `Redimensionar coluna ${column.label}`);
      resizeHandle.innerHTML = '<span class="pointer-events-none block h-8 w-px rounded-full bg-gray-200"></span>';
      resizeHandle.addEventListener('mousedown', (event) => startColumnResize(column, th, event));
      resizeHandle.addEventListener('touchstart', (event) => startColumnResize(column, th, event));
      th.appendChild(resizeHandle);

      row.appendChild(th);
    });

    elements.tableHead.appendChild(row);
    updateTableHeadSortIndicators();
    applyColumnWidths(true);
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
        cell.dataset.columnKey = column.key;
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

    applyColumnWidths();
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
    const token = getToken();
    if (!token) {
      console.warn('Relatorio vendas: token indisponivel.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/stores/allowed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Falha ao carregar lojas');
      const data = await response.json();
      const stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
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
      syncValueFiltersWithData();
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
