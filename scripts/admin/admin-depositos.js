function initAdminDepositos() {
    const form = document.getElementById('deposit-form');
    const idInput = document.getElementById('deposit-id');
    const codeInput = document.getElementById('deposit-code');
    const nameInput = document.getElementById('deposit-name');
    const companySelect = document.getElementById('deposit-company');
    const cancelEditButton = document.getElementById('deposit-cancel-edit');
    const submitLabel = document.getElementById('deposit-form-submit-label');
    const tableBody = document.getElementById('deposits-table-body');
    const emptyState = document.getElementById('deposits-empty-state');

    let deposits = [];
    let stores = [];
    let editingDepositId = null;

    const getToken = () => {
        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            return loggedInUser?.token || '';
        } catch (error) {
            console.warn('Não foi possível obter o token do usuário logado.', error);
            return '';
        }
    };

    const extractNumericValue = (value) => {
        const normalized = String(value ?? '').trim();
        if (!normalized) return 0;
        const matches = normalized.match(/\d+/g);
        if (!matches) {
            const parsed = Number(normalized);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        return matches.reduce((max, part) => {
            const parsed = Number(part);
            return Number.isFinite(parsed) && parsed > max ? parsed : max;
        }, 0);
    };

    const computeNextCodeValue = () => {
        if (!Array.isArray(deposits) || !deposits.length) {
            return '1';
        }
        const highest = deposits.reduce((max, deposit) => {
            const current = extractNumericValue(deposit?.codigo);
            return current > max ? current : max;
        }, 0);
        return String(highest + 1);
    };

    const fillNextCode = () => {
        if (!codeInput || editingDepositId) return;
        codeInput.value = computeNextCodeValue();
    };

    const resetForm = () => {
        editingDepositId = null;
        idInput.value = '';
        form.reset();
        submitLabel.textContent = 'Cadastrar depósito';
        cancelEditButton.classList.add('hidden');
        fillNextCode();
    };

    const populateCompanySelect = () => {
        if (!companySelect) return;
        companySelect.innerHTML = '<option value="">Selecione a empresa</option>';
        stores.forEach((store) => {
            const option = document.createElement('option');
            option.value = store._id;
            option.textContent = store.nome || store.nomeFantasia || 'Empresa sem nome';
            companySelect.appendChild(option);
        });
    };

    const renderDepositsTable = () => {
        if (!tableBody) return;
        if (!deposits.length) {
            tableBody.innerHTML = '';
            emptyState?.classList.remove('hidden');
            fillNextCode();
            return;
        }
        emptyState?.classList.add('hidden');
        tableBody.innerHTML = deposits.map((deposit) => {
            const empresaNome = deposit?.empresa?.nome || deposit?.empresa?.nomeFantasia || '—';
            return `
                <tr>
                    <td class="px-4 py-3 text-gray-700">${deposit.codigo}</td>
                    <td class="px-4 py-3 text-gray-700">${deposit.nome}</td>
                    <td class="px-4 py-3 text-gray-600">${empresaNome}</td>
                    <td class="px-4 py-3 text-right">
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:border-primary hover:text-primary transition" data-action="edit" data-id="${deposit._id}">
                            <i class="fas fa-pen"></i>
                            Editar
                        </button>
                        <button type="button" class="ml-2 inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-red-600 hover:border-red-500 hover:text-red-700 transition" data-action="delete" data-id="${deposit._id}">
                            <i class="fas fa-trash"></i>
                            Excluir
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        fillNextCode();
    };

    const fetchStores = async () => {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
            if (!response.ok) throw new Error('Falha ao carregar empresas.');
            stores = await response.json();
            populateCompanySelect();
        } catch (error) {
            console.error('Erro ao carregar empresas:', error);
            showModal({ title: 'Erro', message: error.message || 'Não foi possível carregar as empresas.', confirmText: 'Entendi' });
        }
    };

    const fetchDeposits = async () => {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/deposits`);
            if (!response.ok) throw new Error('Falha ao carregar depósitos.');
            const payload = await response.json();
            deposits = Array.isArray(payload?.deposits) ? payload.deposits : Array.isArray(payload) ? payload : [];
            renderDepositsTable();
        } catch (error) {
            console.error('Erro ao carregar depósitos:', error);
            showModal({ title: 'Erro', message: error.message || 'Não foi possível carregar os depósitos.', confirmText: 'Entendi' });
        }
    };

    const startEditDeposit = (deposit) => {
        editingDepositId = deposit._id;
        idInput.value = deposit._id;
        codeInput.value = deposit.codigo || '';
        nameInput.value = deposit.nome || '';
        companySelect.value = deposit?.empresa?._id || deposit?.empresa || '';
        submitLabel.textContent = 'Salvar alterações';
        cancelEditButton.classList.remove('hidden');
        window.scrollTo({ top: form.offsetTop - 120, behavior: 'smooth' });
    };

    const handleDeleteDeposit = (depositId) => {
        showModal({
            title: 'Remover depósito',
            message: 'Deseja realmente remover este depósito? Esta ação não pode ser desfeita.',
            confirmText: 'Remover',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    const token = getToken();
                    const response = await fetch(`${API_CONFIG.BASE_URL}/deposits/${depositId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                        },
                    });
                    if (!response.ok) {
                        const errorPayload = await response.json().catch(() => ({}));
                        throw new Error(errorPayload.message || 'Não foi possível remover o depósito.');
                    }
                    await fetchDeposits();
                    showModal({ title: 'Sucesso', message: 'Depósito removido com sucesso.', confirmText: 'OK' });
                } catch (error) {
                    console.error('Erro ao remover depósito:', error);
                    showModal({ title: 'Erro', message: error.message || 'Erro ao remover depósito.', confirmText: 'Entendi' });
                }
            }
        });
    };

    tableBody?.addEventListener('click', (event) => {
        const target = event.target.closest('button[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        const depositId = target.dataset.id;
        const deposit = deposits.find((item) => item._id === depositId);
        if (!deposit) return;
        if (action === 'edit') {
            startEditDeposit(deposit);
        } else if (action === 'delete') {
            handleDeleteDeposit(depositId);
        }
    });

    cancelEditButton?.addEventListener('click', () => {
        resetForm();
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const token = getToken();
        if (!token) {
            showModal({ title: 'Sessão expirada', message: 'Faça login novamente para salvar alterações.', confirmText: 'OK' });
            return;
        }

        const payload = {
            codigo: codeInput.value.trim(),
            nome: nameInput.value.trim(),
            empresa: companySelect.value,
        };

        if (!payload.codigo || !payload.nome || !payload.empresa) {
            showModal({ title: 'Atenção', message: 'Preencha todos os campos obrigatórios.', confirmText: 'Entendi' });
            return;
        }

        try {
            const method = editingDepositId ? 'PUT' : 'POST';
            const endpoint = editingDepositId
                ? `${API_CONFIG.BASE_URL}/deposits/${editingDepositId}`
                : `${API_CONFIG.BASE_URL}/deposits`;

            const response = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || 'Não foi possível salvar o depósito.');
            }

            await fetchDeposits();
            resetForm();
            showModal({ title: 'Sucesso', message: 'Depósito salvo com sucesso.', confirmText: 'OK' });
        } catch (error) {
            console.error('Erro ao salvar depósito:', error);
            showModal({ title: 'Erro', message: error.message || 'Não foi possível salvar o depósito.', confirmText: 'Entendi' });
        }
    });

    (async () => {
        codeInput?.setAttribute('readonly', 'readonly');
        codeInput?.classList.add('bg-gray-100', 'cursor-not-allowed');
        await Promise.all([fetchStores(), fetchDeposits()]);
        fillNextCode();
    })();
}

if (!window.__EOBICHO_ADMIN_VIEWS__) {
  window.__EOBICHO_ADMIN_VIEWS__ = {};
}
window.__EOBICHO_ADMIN_VIEWS__['admin-depositos'] = initAdminDepositos;

if (!window.AdminSPA) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminDepositos, { once: true });
  } else {
    initAdminDepositos();
  }
}

