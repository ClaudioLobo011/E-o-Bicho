(() => {
  const elements = {
    form: document.getElementById('user-group-form'),
    company: document.getElementById('group-company'),
    companyHelper: document.getElementById('group-company-helper'),
    code: document.getElementById('group-code'),
    name: document.getElementById('group-name'),
    commission: document.getElementById('group-commission'),
    reset: document.getElementById('group-reset'),
    tableBody: document.getElementById('groups-table-body'),
    emptyState: document.getElementById('groups-empty-state'),
    counter: document.getElementById('groups-counter'),
    companyLabel: document.getElementById('groups-company-label'),
    pageSize: document.getElementById('groups-page-size'),
    pagePrev: document.getElementById('groups-page-prev'),
    pageNext: document.getElementById('groups-page-next'),
    pageIndicator: document.getElementById('groups-page-indicator'),
    headers: Array.from(document.querySelectorAll('[data-sort-key]')),
  };

  const state = {
    companies: [],
    groups: [],
    sort: { key: 'code', direction: 'asc' },
    pagination: { page: 1, pageSize: 25 },
    selectedCompany: '',
  };

  const normalizeCompany = (company) => {
    if (!company) return { id: '', name: '' };
    if (typeof company === 'string') return { id: company, name: company };
    const id = company._id || company.id || '';
    const name = company.nome || company.razaoSocial || company.fantasia || company.name || '';
    return { id: String(id), name: name || String(id) };
  };

  const formatCommission = (value) => {
    const numeric = Number.isFinite(value) ? value : 0;
    return `${numeric.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const updateCompanyLabel = () => {
    const { selectedCompany, companies } = state;
    if (!selectedCompany) {
      elements.companyLabel.textContent = 'Todas as empresas';
      return;
    }
    const found = companies.find((item) => item.id === selectedCompany);
    elements.companyLabel.textContent = found?.name || '—';
  };

  const updateCounter = (total) => {
    const label = total === 1 ? 'grupo' : 'grupos';
    elements.counter.innerHTML = `<i class="fas fa-magnifying-glass"></i>${total} ${label} encontrado${total === 1 ? '' : 's'}`;
  };

  const getFilteredGroups = () => {
    const { groups, selectedCompany } = state;
    if (!selectedCompany) return [...groups];
    return groups.filter((group) => group.company === selectedCompany);
  };

  const getSortedGroups = (list) => {
    const { key, direction } = state.sort;
    const sorted = [...list];
    const factor = direction === 'desc' ? -1 : 1;

    sorted.sort((a, b) => {
      const first = a[key];
      const second = b[key];

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
    const filtered = getFilteredGroups();
    const sorted = getSortedGroups(filtered);
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
          <td class="px-3 py-2.5 text-[11px] font-semibold text-gray-800">${group.code}</td>
          <td class="px-3 py-2.5 text-[11px] text-gray-700">${group.name}</td>
          <td class="px-3 py-2.5 text-[11px] text-right font-semibold text-gray-900">${formatCommission(group.commission)}</td>
          <td class="px-3 py-2.5 text-[11px] text-gray-700">${group.companyName}</td>
        `;
        elements.tableBody.appendChild(row);
      });
    }

    updateCounter(filtered.length);
    updateCompanyLabel();
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
    const defaultCompany = state.companies[0]?.id || '';
    elements.company.value = defaultCompany;
    state.selectedCompany = defaultCompany;
  };

  const handleFormSubmit = (event) => {
    event.preventDefault();
    const company = elements.company.value.trim();
    const code = Number.parseInt(elements.code.value, 10);
    const name = elements.name.value.trim();
    const commission = Number.parseFloat(elements.commission.value);

    if (!company) {
      alert('Selecione uma empresa para cadastrar o grupo.');
      return;
    }
    if (!Number.isFinite(code) || code < 1) {
      alert('Informe um código válido (número inteiro).');
      return;
    }
    if (!name) {
      alert('Informe o nome do grupo.');
      return;
    }

    const companyData = state.companies.find((item) => item.id === company);

    state.groups.push({
      id: crypto.randomUUID(),
      code,
      name,
      commission: Number.isFinite(commission) ? commission : 0,
      company,
      companyName: companyData?.name || '—',
    });

    state.pagination.page = 1;
    renderTable();
    elements.form.reset();
    elements.company.value = company;
    state.selectedCompany = company;
  };

  const loadCompanies = () => {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      const rawCompanies = Array.isArray(cached?.empresas) ? cached.empresas : [];
      state.companies = rawCompanies.map(normalizeCompany).filter((item) => item.id);

      if (!state.companies.length) {
        elements.company.innerHTML = '<option value="">Nenhuma empresa disponível</option>';
        elements.company.disabled = true;
        elements.companyHelper.textContent = 'Nenhuma empresa vinculada ao usuário logado.';
        return;
      }

      const options = state.companies.map((company) => `<option value="${company.id}">${company.name}</option>`);
      elements.company.innerHTML = options.join('');
      state.selectedCompany = state.companies[0].id;
      elements.company.value = state.selectedCompany;
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      elements.company.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      elements.company.disabled = true;
      elements.companyHelper.textContent = 'Não foi possível carregar as empresas do usuário. Confira seu acesso.';
    }
  };

  const init = () => {
    loadCompanies();
    renderTable();

    elements.form?.addEventListener('submit', handleFormSubmit);
    elements.reset?.addEventListener('click', resetForm);
    elements.company?.addEventListener('change', (event) => {
      state.selectedCompany = event.target.value;
      state.pagination.page = 1;
      renderTable();
    });

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
      const filtered = getFilteredGroups();
      const totalPages = Math.max(1, Math.ceil(filtered.length / state.pagination.pageSize));
      if (state.pagination.page < totalPages) {
        state.pagination.page += 1;
        renderTable();
      }
    });

    elements.headers.forEach((th) => th.addEventListener('click', handleSortClick));
  };

  document.addEventListener('DOMContentLoaded', init);
})();
