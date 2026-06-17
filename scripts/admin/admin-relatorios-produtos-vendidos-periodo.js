(() => {
  const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) || '/api';

  const elements = {
    table: document.getElementById('products-sold-table'),
    start: document.getElementById('products-sold-start'),
    end: document.getElementById('products-sold-end'),
    store: document.getElementById('products-sold-store'),
    apply: document.getElementById('products-sold-apply'),
    reset: document.getElementById('products-sold-reset'),
    export: document.getElementById('products-sold-export'),
    pageSize: document.getElementById('products-sold-page-size'),
    prev: document.getElementById('products-sold-prev'),
    next: document.getElementById('products-sold-next'),
    pageIndicator: document.getElementById('products-sold-page-indicator'),
    counter: document.getElementById('products-sold-counter'),
    tableBody: document.getElementById('products-sold-table-body'),
    totalItems: document.getElementById('products-sold-total-items'),
    totalQuantity: document.getElementById('products-sold-total-quantity'),
    totalValue: document.getElementById('products-sold-total-value'),
    salesCount: document.getElementById('products-sold-sales-count'),
  };

  const state = {
    filters: {
      start: '',
      end: '',
      storeId: '',
      columns: {},
    },
    pagination: {
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 1,
    },
    products: [],
    loading: false,
  };

  const columnFilterMap = {
    0: 'product',
    1: 'productCode',
    2: 'quantity',
    3: 'totalValue',
    4: 'customer',
    5: 'phone',
    6: 'saleCode',
    7: 'saleDate',
    8: 'store',
  };

  const getToken = () => {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch (_error) {
      return '';
    }
  };

  const formatCurrency = (value = 0) => {
    const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
    return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatNumber = (value = 0) => {
    const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
    return safe.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const formatInputDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const setDefaultDates = () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    if (elements.start) elements.start.value = formatInputDate(start);
    if (elements.end) elements.end.value = formatInputDate(today);
    state.filters.start = elements.start?.value || '';
    state.filters.end = elements.end?.value || '';
  };

  const setLoading = (loading) => {
    state.loading = loading;
    if (elements.apply) {
      elements.apply.disabled = loading;
      elements.apply.classList.toggle('opacity-75', loading);
    }
  };

  const updateMetrics = (metrics = {}) => {
    if (elements.totalItems) elements.totalItems.textContent = formatNumber(metrics.totalItems || 0);
    if (elements.totalQuantity) elements.totalQuantity.textContent = formatNumber(metrics.totalQuantity || 0);
    if (elements.totalValue) elements.totalValue.textContent = formatCurrency(metrics.totalValue || 0);
    if (elements.salesCount) elements.salesCount.textContent = formatNumber(metrics.salesCount || 0);
  };

  const updatePagination = () => {
    const { page, totalPages, total } = state.pagination;
    if (elements.pageIndicator) elements.pageIndicator.textContent = `Pagina ${page} de ${totalPages}`;
    if (elements.counter) elements.counter.textContent = `${total.toLocaleString('pt-BR')} produtos vendidos encontrados.`;
    if (elements.prev) elements.prev.disabled = state.loading || page <= 1;
    if (elements.next) elements.next.disabled = state.loading || page >= totalPages;
  };

  const renderEmpty = () => {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="px-4 py-6 text-center text-gray-500">Nenhum produto encontrado para o periodo selecionado.</td>
      </tr>
    `;
  };

  const renderTable = () => {
    if (!elements.tableBody) return;
    if (!state.products.length) {
      renderEmpty();
      return;
    }

    elements.tableBody.innerHTML = '';
    state.products.forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50';
      row.innerHTML = `
        <td class="px-4 py-3">
          <div class="font-semibold text-gray-800">${escapeHtml(item.productName || 'Produto')}</div>
          <div class="text-xs text-gray-500">${escapeHtml(item.category || 'Geral')}</div>
        </td>
        <td class="px-4 py-3 text-gray-600">${escapeHtml(item.productCode || '-')}</td>
        <td class="px-4 py-3 text-right font-semibold text-gray-800">${formatNumber(item.quantity || 0)}</td>
        <td class="px-4 py-3 text-right font-semibold text-gray-900">${formatCurrency(item.totalValue || 0)}</td>
        <td class="px-4 py-3 text-gray-700">${escapeHtml(item.customerName || 'Cliente nao informado')}</td>
        <td class="px-4 py-3 text-gray-600">${escapeHtml(item.customerPhone || '-')}</td>
        <td class="px-4 py-3 font-semibold text-gray-800">${escapeHtml(item.saleCode || '-')}</td>
        <td class="px-4 py-3 text-gray-600">${formatDateTime(item.saleDate)}</td>
        <td class="px-4 py-3 text-gray-600">${escapeHtml(item.store?.name || '-')}</td>
      `;
      elements.tableBody.appendChild(row);
    });
  };

  const escapeHtml = (value) => {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const buildParams = () => {
    const params = new URLSearchParams();
    params.set('page', state.pagination.page);
    params.set('pageSize', state.pagination.pageSize);
    if (state.filters.start) params.set('start', state.filters.start);
    if (state.filters.end) params.set('end', state.filters.end);
    if (state.filters.storeId) params.set('storeId', state.filters.storeId);
    Object.entries(state.filters.columns || {}).forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (normalized) params.set(key, normalized);
    });
    return params;
  };

  const fetchStores = async () => {
    const token = getToken();
    if (!token || !elements.store) return;

    try {
      const response = await fetch(`${API_BASE}/stores/allowed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Falha ao carregar lojas');
      const data = await response.json();
      const stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];

      const current = elements.store.value;
      elements.store.innerHTML = '<option value="">Todas as lojas</option>';
      stores.forEach((store) => {
        const option = document.createElement('option');
        option.value = store._id;
        option.textContent = store.fantasia || store.nome || store.apelido || 'Loja';
        elements.store.appendChild(option);
      });
      elements.store.value = current;
    } catch (error) {
      console.error('Erro ao carregar lojas:', error);
    }
  };

  const fetchProductsSold = async () => {
    const token = getToken();
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/reports/products-sold?${buildParams().toString()}`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || 'Nao foi possivel carregar os produtos vendidos.');

      state.products = Array.isArray(data.products) ? data.products : [];
      state.pagination.total = data?.pagination?.total || 0;
      state.pagination.totalPages = data?.pagination?.totalPages || 1;
      updateMetrics(data.metrics || {});
      renderTable();
      updatePagination();
    } catch (error) {
      console.error(error);
      state.products = [];
      state.pagination.total = 0;
      state.pagination.totalPages = 1;
      updateMetrics({});
      renderTable();
      updatePagination();
      alert(error.message || 'Erro ao carregar produtos vendidos.');
    } finally {
      setLoading(false);
      updatePagination();
    }
  };

  const applyFilters = () => {
    state.filters.start = elements.start?.value || '';
    state.filters.end = elements.end?.value || '';
    state.filters.storeId = elements.store?.value || '';
    const columnInputs = Array.from(elements.table?.querySelectorAll('[data-admin-table-filter]') || []);
    columnInputs.forEach((input) => {
      const key = columnFilterMap[input.dataset.adminTableFilter];
      if (!key) return;
      state.filters.columns[key] = input.value || '';
    });
    state.pagination.page = 1;
    state.pagination.pageSize = Number(elements.pageSize?.value || 50);
    fetchProductsSold();
  };

  const resetFilters = () => {
    if (elements.store) elements.store.value = '';
    if (elements.pageSize) elements.pageSize.value = '50';
    const columnInputs = Array.from(elements.table?.querySelectorAll('[data-admin-table-filter]') || []);
    columnInputs.forEach((input) => {
      input.value = '';
    });
    state.filters.columns = {};
    setDefaultDates();
    applyFilters();
  };

  const csvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const exportCurrentPage = () => {
    if (!state.products.length) return;

    const header = [
      'Produto',
      'Cod. produto',
      'Quantidade',
      'Valor',
      'Cliente',
      'Telefone',
      'Cod. venda',
      'Data da venda',
      'Loja',
    ];

    const rows = state.products.map((item) => [
      item.productName || '',
      item.productCode || '',
      item.quantity || 0,
      item.totalValue || 0,
      item.customerName || '',
      item.customerPhone || '',
      item.saleCode || '',
      formatDateTime(item.saleDate),
      item.store?.name || '',
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvValue).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `produtos-vendidos-${state.filters.start || 'inicio'}-${state.filters.end || 'fim'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const setupEvents = () => {
    let columnFilterTimer = null;
    elements.apply?.addEventListener('click', applyFilters);
    elements.reset?.addEventListener('click', resetFilters);
    elements.export?.addEventListener('click', exportCurrentPage);
    elements.table?.addEventListener('input', (event) => {
      if (!event.target?.matches?.('[data-admin-table-filter]')) return;
      window.clearTimeout(columnFilterTimer);
      columnFilterTimer = window.setTimeout(applyFilters, 350);
    }, true);
    elements.table?.addEventListener('keydown', (event) => {
      if (!event.target?.matches?.('[data-admin-table-filter]')) return;
      if (event.key === 'Enter') {
        window.clearTimeout(columnFilterTimer);
        applyFilters();
      }
    }, true);
    elements.pageSize?.addEventListener('change', () => {
      state.pagination.pageSize = Number(elements.pageSize.value || 50);
      state.pagination.page = 1;
      fetchProductsSold();
    });
    elements.prev?.addEventListener('click', () => {
      if (state.pagination.page <= 1) return;
      state.pagination.page -= 1;
      fetchProductsSold();
    });
    elements.next?.addEventListener('click', () => {
      if (state.pagination.page >= state.pagination.totalPages) return;
      state.pagination.page += 1;
      fetchProductsSold();
    });
  };

  const init = async () => {
    setDefaultDates();
    setupEvents();
    await fetchStores();
    applyFilters();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
