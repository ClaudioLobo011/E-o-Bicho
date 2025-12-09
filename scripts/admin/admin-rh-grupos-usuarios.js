(() => {
  const API = `${API_CONFIG.BASE_URL}/admin/grupos-usuarios`;

  const elements = {
    form: document.getElementById('user-group-form'),
    code: document.getElementById('group-code'),
    name: document.getElementById('group-name'),
    commission: document.getElementById('group-commission'),
    reset: document.getElementById('group-reset'),
    tableBody: document.getElementById('groups-table-body'),
    emptyState: document.getElementById('groups-empty-state'),
    counter: document.getElementById('groups-counter'),
    pageSize: document.getElementById('groups-page-size'),
    pagePrev: document.getElementById('groups-page-prev'),
    pageNext: document.getElementById('groups-page-next'),
    pageIndicator: document.getElementById('groups-page-indicator'),
    headers: Array.from(document.querySelectorAll('[data-sort-key]')),
  };

  const state = {
    groups: [],
    sort: { key: 'codigo', direction: 'asc' },
    pagination: { page: 1, pageSize: 25 },
  };

  const getToken = () => {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return cached?.token || '';
    } catch {
      return '';
    }
  };

  const fetchJSON = async (url, opts = {}) => {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
        ...(opts.headers || {}),
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Erro HTTP ${res.status}`);
    }
    return res.json();
  };

  const formatCommission = (value) => {
    const numeric = Number.isFinite(value) ? value : 0;
    return `${numeric.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const updateCounter = (total) => {
    const label = total === 1 ? 'grupo' : 'grupos';
    elements.counter.innerHTML = `<i class="fas fa-magnifying-glass"></i>${total} ${label} encontrado${total === 1 ? '' : 's'}`;
  };

  const setNextCode = () => {
    const next = state.groups.reduce((max, g) => {
      const c = Number.parseInt(g.codigo, 10);
      return Number.isFinite(c) && c > max ? c : max;
    }, 0) + 1;

    if (elements.code) {
      elements.code.value = Number.isFinite(next) ? next.toString() : '';
    }
  };

  const getSortedGroups = (list) => {
    const { key, direction } = state.sort;
    const sorted = [...list];
    const factor = direction === 'desc' ? -1 : 1;

    sorted.sort((a, b) => {
      const first = a?.[key];
      const second = b?.[key];

      if (typeof first === 'number' && typeof second === 'number') {
        return (first - second) * factor;
      }

      const textA = (first ?? '').toString().toLowerCase();
      const textB = (second ?? '').toString().toLowerCase();
      if (textA < textB) return -1 * factor;
      if (textA > textB) return 1 * factor;
      return 0;
    });

    return sorted;
  };

  const applyPagination = (list) => {
    const { page, pageSize } = state.pagination;
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    state.pagination.page = currentPage;

    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    elements.pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
    elements.pagePrev.disabled = currentPage === 1;
    elements.pageNext.disabled = currentPage === totalPages;

    return list.slice(start, end);
  };

  const renderTable = () => {
    const sorted = getSortedGroups(state.groups);
    const paged = applyPagination(sorted);

    elements.tableBody.innerHTML = '';

    if (!paged.length) {
      elements.emptyState.classList.remove('hidden');
      elements.tableBody.appendChild(elements.emptyState);
    } else {
      elements.emptyState.classList.add('hidden');
      paged.forEach((group) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="px-3 py-2.5 text-[11px] font-semibold text-gray-800">${group.codigo}</td>
          <td class="px-3 py-2.5 text-[11px] text-gray-700">${group.nome}</td>
          <td class="px-3 py-2.5 text-[11px] text-right font-semibold text-gray-900">${formatCommission(group.comissaoPercent)}</td>
        `;
        elements.tableBody.appendChild(row);
      });
    }

    updateCounter(state.groups.length);
  };

  const handleSortClick = (event) => {
    const th = event.currentTarget;
    const key = th?.dataset?.sortKey;
    if (!key) return;

    if (state.sort.key === key) {
      state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.key = key;
      state.sort.direction = 'asc';
    }
    renderTable();
  };

  const resetForm = () => {
    elements.form?.reset();
    setNextCode();
  };

  const validateForm = () => {
    const name = elements.name.value.trim();
    const commission = Number.parseFloat(elements.commission.value);
    const errors = [];

    if (!name) errors.push('Informe o nome do grupo.');
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
      errors.push('A comissão deve estar entre 0 e 100%.');
    }

    return { ok: errors.length === 0, errors, name, commission: Number.isFinite(commission) ? commission : 0 };
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    const validation = validateForm();
    if (!validation.ok) {
      alert(validation.errors.join('\n'));
      return;
    }

    try {
      const created = await fetchJSON(API, {
        method: 'POST',
        body: JSON.stringify({
          nome: validation.name,
          comissaoPercent: validation.commission,
        }),
      });

      state.groups.push(created);
      state.pagination.page = 1;
      renderTable();
      setNextCode();
      elements.form.reset();
      elements.name.focus();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar grupo.\n' + err.message);
    }
  };

  const loadGroups = async () => {
    if (elements.code) elements.code.value = 'Carregando...';
    const data = await fetchJSON(API);
    state.groups = Array.isArray(data) ? data : data?.items || [];
    renderTable();
    setNextCode();
  };

  const init = () => {
    if (!elements.form) return;

    renderTable();

    elements.form.addEventListener('submit', handleFormSubmit);
    elements.reset?.addEventListener('click', resetForm);

    elements.pageSize?.addEventListener('change', (event) => {
      const nextSize = Number.parseInt(event.target.value, 10);
      state.pagination.pageSize = Number.isFinite(nextSize) ? nextSize : 25;
      state.pagination.page = 1;
      renderTable();
    });

    elements.pagePrev?.addEventListener('click', () => {
      if (state.pagination.page > 1) {
        state.pagination.page -= 1;
        renderTable();
      }
    });

    elements.pageNext?.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(state.groups.length / state.pagination.pageSize));
      if (state.pagination.page < totalPages) {
        state.pagination.page += 1;
        renderTable();
      }
    });

    elements.headers.forEach((th) => th.addEventListener('click', handleSortClick));

    loadGroups().catch((err) => {
      console.error(err);
      alert('Erro ao carregar grupos.\n' + err.message);
      if (elements.code) elements.code.value = '';
    });
  };

  document.addEventListener('DOMContentLoaded', init);
})();
