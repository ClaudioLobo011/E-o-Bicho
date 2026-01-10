document.addEventListener('DOMContentLoaded', () => {
    const companySelect = document.getElementById('company-select');
    const depositSelect = document.getElementById('deposit-select');
    const pageSizeSelect = document.getElementById('page-size');
    const searchInput = document.getElementById('product-search');
    const resetFiltersButton = document.getElementById('reset-filters');
    const tableBody = document.getElementById('products-table');
    const paginationContainer = document.getElementById('pagination');
    const selectAllCheckbox = document.getElementById('select-all');
    const zeroButton = document.getElementById('zero-stock');
    const emptyState = document.getElementById('empty-state');
    const sortButtons = document.querySelectorAll('button[data-sort-field][data-sort-order]');
    const filterInputs = document.querySelectorAll('[data-filter-field]');

    const filterParamMap = {
        codbarras: 'filterBarcode',
        nome: 'filterName',
        quantidade: 'filterQuantity',
    };

    const filterInputMap = new Map();
    const filterDebounceTimers = new Map();

    const state = {
        stores: [],
        deposits: [],
        items: [],
        pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 1,
        },
        sortField: 'nome',
        sortOrder: 'asc',
        search: '',
        filters: {
            codbarras: '',
            nome: '',
            quantidade: '',
        },
        selectedIds: new Set(),
        activeCompanyId: '',
        activeDepositId: '',
        loading: false,
    };

    let searchDebounceTimeout = null;

    const getToken = () => {
        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            return loggedInUser?.token || '';
        } catch (error) {
            console.warn('Não foi possível obter o token do usuário logado.', error);
            return '';
        }
    };

    const setLoading = (value) => {
        state.loading = Boolean(value);
        if (value) {
            emptyState?.classList.add('hidden');
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.setAttribute('disabled', 'disabled');
            }
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-4 py-6 text-center text-sm text-gray-500">
                        Carregando produtos...
                    </td>
                </tr>
            `;
        }
    };

    const resetSelections = () => {
        state.selectedIds.clear();
        updateSelectAllState();
        updateZeroButtonState();
    };

    const populateCompanySelect = () => {
        if (!companySelect) return;
        companySelect.innerHTML = '<option value="">Selecione a empresa</option>';
        if (!state.stores.length) {
            companySelect.setAttribute('disabled', 'disabled');
            return;
        }
        companySelect.removeAttribute('disabled');
        state.stores.forEach((store) => {
            const option = document.createElement('option');
            option.value = store._id;
            option.textContent = store.nome || store.nomeFantasia || 'Empresa sem nome';
            companySelect.appendChild(option);
        });
    };

    const populateDepositSelect = () => {
        if (!depositSelect) return;
        depositSelect.innerHTML = '<option value="">Selecione o depósito</option>';
        if (!state.deposits.length) {
            depositSelect.setAttribute('disabled', 'disabled');
            return;
        }
        state.deposits.forEach((deposit) => {
            const option = document.createElement('option');
            option.value = deposit._id;
            option.textContent = deposit.nome || deposit.codigo || 'Depósito sem nome';
            depositSelect.appendChild(option);
        });
        depositSelect.removeAttribute('disabled');
    };

    const updateSortIndicators = () => {
        sortButtons.forEach((button) => {
            const field = button.dataset.sortField;
            const order = button.dataset.sortOrder;
            const icon = button.querySelector('i');
            const isActive = field === state.sortField && order === state.sortOrder;
            button.classList.toggle('text-primary', isActive);
            button.classList.toggle('border-primary', isActive);
            button.classList.toggle('text-gray-400', !isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            if (icon) {
                icon.classList.toggle('text-primary', isActive);
            }
        });
    };

    const applyFilterValue = (field, value) => {
        if (!(field in state.filters)) {
            return;
        }
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (state.filters[field] === normalized) {
            return;
        }
        state.filters[field] = normalized;
        state.pagination.page = 1;
        fetchInventory();
    };

    const handleFilterInput = (event) => {
        const input = event.target;
        const field = input?.dataset?.filterField;
        if (!field) return;
        if (filterDebounceTimers.has(field)) {
            clearTimeout(filterDebounceTimers.get(field));
        }
        const timeoutId = setTimeout(() => {
            applyFilterValue(field, input.value || '');
            filterDebounceTimers.delete(field);
        }, 300);
        filterDebounceTimers.set(field, timeoutId);
    };

    const updateSelectAllState = () => {
        if (!selectAllCheckbox) return;
        if (!state.items.length) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.setAttribute('disabled', 'disabled');
            return;
        }
        const selectedInPage = state.items.filter((item) => state.selectedIds.has(item._id));
        selectAllCheckbox.indeterminate = selectedInPage.length > 0 && selectedInPage.length < state.items.length;
        selectAllCheckbox.checked = selectedInPage.length === state.items.length && state.items.length > 0;
        selectAllCheckbox.removeAttribute('disabled');
    };

    const updateZeroButtonState = () => {
        if (!zeroButton) return;
        zeroButton.disabled = state.selectedIds.size === 0 || !state.activeDepositId;
    };

    const renderTable = () => {
        if (!tableBody) return;
        if (!state.items.length) {
            tableBody.innerHTML = '';
            if (state.activeDepositId) {
                emptyState?.classList.remove('hidden');
            } else {
                emptyState?.classList.add('hidden');
            }
            updateSelectAllState();
            updateZeroButtonState();
            return;
        }
        emptyState?.classList.add('hidden');
        tableBody.innerHTML = state.items.map((item) => {
            const checked = state.selectedIds.has(item._id) ? 'checked' : '';
            const quantity = Number(item?.quantidade) || 0;
            const safeBarcode = item?.codbarras || '—';
            const safeName = item?.nome || 'Produto sem nome';
            return `
                <tr>
                    <td class="px-4 py-3">
                        <input type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" data-product-id="${item._id}" ${checked}>
                    </td>
                    <td class="px-4 py-3 text-gray-700">${safeBarcode}</td>
                    <td class="px-4 py-3 text-gray-700">${safeName}</td>
                    <td class="px-4 py-3 text-right text-gray-700">${quantity.toLocaleString('pt-BR')}</td>
                </tr>
            `;
        }).join('');
        updateSelectAllState();
        updateZeroButtonState();
    };

    const renderPagination = () => {
        if (!paginationContainer) return;
        paginationContainer.innerHTML = '';

        if (!state.activeDepositId) {
            return;
        }

        const { page, limit, total, totalPages } = state.pagination;
        const start = total === 0 ? 0 : (page - 1) * limit + 1;
        const end = Math.min(page * limit, total);

        const info = document.createElement('div');
        info.className = 'text-sm text-gray-600';
        info.textContent = total > 0
            ? `Exibindo ${start} - ${end} de ${total} produtos`
            : 'Nenhum produto para exibir';
        paginationContainer.appendChild(info);

        if (totalPages <= 1) {
            return;
        }

        const controls = document.createElement('div');
        controls.className = 'flex items-center gap-2';

        const createPageButton = (label, targetPage, disabled = false, isActive = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.className = 'min-w-[2.25rem] rounded-md border px-3 py-1 text-sm font-semibold transition';
            if (disabled) {
                button.classList.add('cursor-not-allowed', 'border-gray-200', 'text-gray-400');
                button.disabled = true;
            } else if (isActive) {
                button.classList.add('border-primary', 'bg-primary/10', 'text-primary');
            } else {
                button.classList.add('border-gray-200', 'text-gray-600', 'hover:border-primary', 'hover:text-primary');
                button.addEventListener('click', () => {
                    if (state.pagination.page === targetPage) return;
                    state.pagination.page = targetPage;
                    fetchInventory();
                });
            }
            return button;
        };

        controls.appendChild(createPageButton('Anterior', Math.max(1, page - 1), page === 1));

        const visiblePages = 5;
        let startPage = Math.max(1, page - Math.floor(visiblePages / 2));
        let endPage = startPage + visiblePages - 1;
        if (endPage > totalPages) {
            endPage = totalPages;
            startPage = Math.max(1, endPage - visiblePages + 1);
        }

        for (let current = startPage; current <= endPage; current += 1) {
            controls.appendChild(createPageButton(String(current), current, false, current === page));
        }

        controls.appendChild(createPageButton('Próxima', Math.min(totalPages, page + 1), page === totalPages));

        paginationContainer.appendChild(controls);
    };

    const fetchStores = async () => {
        try {
            const token = getToken();
            if (!token) {
                showModal({ title: 'Sessao expirada', message: 'Faca login novamente para continuar.', confirmText: 'OK' });
                return;
            }
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores/allowed`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) throw new Error('Falha ao carregar empresas.');
            const data = await response.json().catch(() => ({}));
            state.stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
            populateCompanySelect();
        } catch (error) {
            console.error('Erro ao carregar empresas:', error);
            showModal({ title: 'Erro', message: error.message || 'Não foi possível carregar as empresas.', confirmText: 'Entendi' });
        }
    };

    const fetchDeposits = async () => {
        if (!state.activeCompanyId) {
            state.deposits = [];
            populateDepositSelect();
            return;
        }
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/deposits?empresa=${state.activeCompanyId}`);
            if (!response.ok) throw new Error('Falha ao carregar depósitos.');
            const payload = await response.json();
            state.deposits = Array.isArray(payload?.deposits) ? payload.deposits : [];
            populateDepositSelect();
        } catch (error) {
            console.error('Erro ao carregar depósitos:', error);
            showModal({ title: 'Erro', message: error.message || 'Não foi possível carregar os depósitos.', confirmText: 'Entendi' });
        }
    };

    const fetchInventory = async () => {
        if (!state.activeDepositId) {
            state.items = [];
            state.pagination = { page: 1, limit: state.pagination.limit, total: 0, totalPages: 1 };
            renderTable();
            renderPagination();
            return;
        }

        const token = getToken();
        if (!token) {
            showModal({ title: 'Sessão expirada', message: 'Faça login novamente para continuar.', confirmText: 'OK' });
            return;
        }

        const params = new URLSearchParams({
            page: String(state.pagination.page || 1),
            limit: String(state.pagination.limit || 20),
            sortField: state.sortField,
            sortOrder: state.sortOrder,
        });

        if (state.search) {
            params.set('search', state.search);
        }

        Object.entries(state.filters).forEach(([field, value]) => {
            const paramKey = filterParamMap[field];
            if (!paramKey) return;
            if (value) {
                params.set(paramKey, value);
            }
        });

        setLoading(true);
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/deposits/${state.activeDepositId}/inventory?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || 'Erro ao carregar itens do depósito.');
            }
            const payload = await response.json();
            state.items = Array.isArray(payload?.items) ? payload.items : [];
            const pagination = payload?.pagination || {};
            state.pagination = {
                page: Number(pagination.page) || 1,
                limit: Number(pagination.limit) || state.pagination.limit,
                total: Number(pagination.total) || 0,
                totalPages: Number(pagination.totalPages) || 1,
            };

            renderTable();
            renderPagination();
        } catch (error) {
            console.error('Erro ao carregar estoque do depósito:', error);
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-4 py-6 text-center text-sm text-red-600">
                        ${error.message || 'Erro ao carregar itens do depósito.'}
                    </td>
                </tr>
            `;
            emptyState?.classList.add('hidden');
            paginationContainer.innerHTML = '';
        } finally {
            state.loading = false;
        }
    };

    const handleCompanyChange = async () => {
        state.activeCompanyId = companySelect?.value || '';
        state.activeDepositId = '';
        state.deposits = [];
        state.items = [];
        state.pagination.page = 1;
        resetSelections();
        populateDepositSelect();
        await fetchDeposits();
        renderTable();
        renderPagination();
    };

    const handleDepositChange = () => {
        state.activeDepositId = depositSelect?.value || '';
        state.pagination.page = 1;
        resetSelections();
        updateZeroButtonState();
        fetchInventory();
    };

    const handlePageSizeChange = () => {
        const newLimit = Number(pageSizeSelect?.value) || 20;
        state.pagination.limit = newLimit;
        state.pagination.page = 1;
        fetchInventory();
    };

    const handleSearchChange = () => {
        const value = searchInput?.value?.trim() || '';
        state.search = value;
        state.pagination.page = 1;
        if (searchDebounceTimeout) {
            clearTimeout(searchDebounceTimeout);
        }
        searchDebounceTimeout = setTimeout(() => {
            fetchInventory();
        }, 300);
    };

    const handleResetFilters = () => {
        if (searchInput) searchInput.value = '';
        state.search = '';
        state.sortField = 'nome';
        state.sortOrder = 'asc';
        state.pagination.page = 1;
        filterDebounceTimers.forEach((timeoutId) => clearTimeout(timeoutId));
        filterDebounceTimers.clear();
        Object.keys(state.filters).forEach((key) => {
            state.filters[key] = '';
        });
        filterInputMap.forEach((input) => {
            if (input) {
                input.value = '';
            }
        });
        updateSortIndicators();
        fetchInventory();
    };

    const handleSortClick = (event) => {
        const button = event.currentTarget;
        const field = button?.dataset?.sortField;
        const order = button?.dataset?.sortOrder;
        if (!field || !order) return;
        if (state.sortField === field && state.sortOrder === order) {
            return;
        }
        state.sortField = field;
        state.sortOrder = order;
        state.pagination.page = 1;
        updateSortIndicators();
        fetchInventory();
    };

    const handleSelectAll = (event) => {
        if (!state.items.length) return;
        const checked = event.target.checked;
        state.items.forEach((item) => {
            if (!item?._id) return;
            if (checked) {
                state.selectedIds.add(item._id);
            } else {
                state.selectedIds.delete(item._id);
            }
        });
        updateSelectAllState();
        updateZeroButtonState();
        renderTable();
    };

    const handleRowSelection = (event) => {
        const checkbox = event.target.closest('input[type="checkbox"][data-product-id]');
        if (!checkbox) return;
        const productId = checkbox.dataset.productId;
        if (!productId) return;
        if (checkbox.checked) {
            state.selectedIds.add(productId);
        } else {
            state.selectedIds.delete(productId);
        }
        updateSelectAllState();
        updateZeroButtonState();
    };

    const handleZeroStock = () => {
        if (!state.selectedIds.size || !state.activeDepositId) return;
        const productIds = Array.from(state.selectedIds);

        showModal({
            title: 'Zerar estoque',
            message: `Tem certeza de que deseja zerar o estoque de ${productIds.length} produto(s) neste depósito?`,
            confirmText: 'Zerar',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                const token = getToken();
                if (!token) {
                    showModal({ title: 'Sessão expirada', message: 'Faça login novamente para continuar.', confirmText: 'OK' });
                    return;
                }
                zeroButton.disabled = true;
                zeroButton.classList.add('opacity-60', 'cursor-wait');
                try {
                    const response = await fetch(`${API_CONFIG.BASE_URL}/deposits/${state.activeDepositId}/zero-stock`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ productIds }),
                    });
                    if (!response.ok) {
                        const errorPayload = await response.json().catch(() => ({}));
                        throw new Error(errorPayload.message || 'Não foi possível zerar o estoque selecionado.');
                    }
                    const payload = await response.json();
                    const updatedCount = Number(payload?.updated) || 0;

                    productIds.forEach((id) => state.selectedIds.delete(id));
                    updateSelectAllState();
                    updateZeroButtonState();
                    await fetchInventory();

                    showModal({
                        title: 'Processo concluído',
                        message: updatedCount > 0
                            ? `Estoque zerado para ${updatedCount} produto(s).`
                            : 'Nenhum produto foi atualizado. Verifique se as quantidades já estavam zeradas.',
                        confirmText: 'OK',
                    });
                } catch (error) {
                    console.error('Erro ao zerar estoque:', error);
                    showModal({ title: 'Erro', message: error.message || 'Erro ao zerar estoque.', confirmText: 'Entendi' });
                } finally {
                    zeroButton.disabled = state.selectedIds.size === 0;
                    zeroButton.classList.remove('opacity-60', 'cursor-wait');
                }
            },
        });
    };

    companySelect?.addEventListener('change', handleCompanyChange);
    depositSelect?.addEventListener('change', handleDepositChange);
    pageSizeSelect?.addEventListener('change', handlePageSizeChange);
    searchInput?.addEventListener('input', handleSearchChange);
    resetFiltersButton?.addEventListener('click', handleResetFilters);
    selectAllCheckbox?.addEventListener('change', handleSelectAll);
    tableBody?.addEventListener('change', handleRowSelection);
    zeroButton?.addEventListener('click', handleZeroStock);
    sortButtons.forEach((button) => {
        button.addEventListener('click', handleSortClick);
    });

    filterInputs.forEach((input) => {
        const field = input?.dataset?.filterField;
        if (!field) return;
        filterInputMap.set(field, input);
        const initialValue = typeof input.value === 'string' ? input.value.trim() : '';
        state.filters[field] = initialValue;
        input.addEventListener('input', handleFilterInput);
    });

    updateSortIndicators();
    updateZeroButtonState();
    renderTable();
    renderPagination();
    fetchStores();
});
