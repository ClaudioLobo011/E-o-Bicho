document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const fileNameLabel = document.getElementById('file-name');
    const previewTable = document.getElementById('preview-table');
    const previewCount = document.getElementById('preview-count');
    const previewWarning = document.getElementById('preview-warning');
    const paginationControls = document.getElementById('pagination-controls');
    const startBtn = document.getElementById('start-import-btn');
    const logContainer = document.getElementById('log-container');
    const companySelect = document.getElementById('company-select');
    const depositSelect = document.getElementById('deposit-select');
    const depositHelper = document.getElementById('deposit-helper');

    if (!startBtn || !logContainer || !fileInput || !previewTable || !companySelect || !depositSelect) {
        return;
    }

    const PAGE_SIZE = 50;
    let selectedFile = null;
    let previewData = [];
    let currentPage = 1;
    let isPreviewLoading = false;
    let currentWarnings = [];
    let companies = [];
    let availableDeposits = [];
    let selectedCompany = '';
    let selectedDeposit = '';

    // Conecta ao servidor WebSocket (Socket.IO)
    const socket = io(API_CONFIG.SERVER_URL);

    const updateStartButtonState = () => {
        const hasData = previewData.length > 0;
        const hasDeposit = Boolean(selectedDeposit);
        const canStart = Boolean(selectedFile) && hasData && hasDeposit && !isPreviewLoading;
        startBtn.disabled = !canStart;
    };

    const addLog = (message) => {
        logContainer.innerHTML += `> ${message}\n`;
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    const formatCurrency = (value) => {
        return Number(value || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    };

    const formatNumber = (value) => {
        return Number(value || 0).toLocaleString('pt-BR');
    };

    const resetDepositSelect = (message, disabled = true) => {
        if (!depositSelect) {
            return;
        }
        depositSelect.innerHTML = `<option value="">${message}</option>`;
        depositSelect.disabled = disabled;
        selectedDeposit = '';
        availableDeposits = [];
        updateStartButtonState();
    };

    const populateCompanySelect = () => {
        if (!companySelect) {
            return;
        }

        companySelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = companies.length ? 'Selecione uma empresa' : 'Nenhuma empresa encontrada';
        companySelect.appendChild(placeholder);

        companies.forEach((company) => {
            const option = document.createElement('option');
            option.value = company._id;
            option.textContent = company.nome || company.razaoSocial || 'Empresa sem nome';
            companySelect.appendChild(option);
        });

        companySelect.disabled = companies.length === 0;
        if (!companies.length) {
            resetDepositSelect('Cadastre um depósito para continuar', true);
        }
    };

    const populateDepositSelect = () => {
        if (!depositSelect) {
            return;
        }

        depositSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = availableDeposits.length ? 'Selecione um depósito' : 'Nenhum depósito disponível';
        depositSelect.appendChild(placeholder);

        availableDeposits.forEach((deposit) => {
            const option = document.createElement('option');
            option.value = deposit._id;
            const companyName = deposit?.empresa?.nome || deposit?.empresa?.razaoSocial;
            option.textContent = companyName
                ? `${deposit.nome} • ${companyName}`
                : deposit.nome;
            depositSelect.appendChild(option);
        });

        depositSelect.disabled = availableDeposits.length === 0;
    };

    const fetchCompanies = async () => {
        try {
            companySelect.disabled = true;
            companySelect.innerHTML = '<option value="">Carregando empresas...</option>';

            const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
            if (!response.ok) {
                throw new Error('Falha ao carregar empresas');
            }

            const data = await response.json();
            companies = Array.isArray(data) ? data : [];

            if (!companies.length) {
                depositHelper?.classList.remove('text-gray-500');
                depositHelper?.classList.add('text-red-600');
                if (depositHelper) {
                    depositHelper.textContent = 'Nenhuma empresa encontrada. Cadastre uma empresa antes de importar produtos.';
                }
                fileInput.disabled = true;
                resetDepositSelect('Nenhum depósito disponível', true);
                selectedCompany = '';
                selectedDeposit = '';
                availableDeposits = [];
                updateStartButtonState();
                companySelect.innerHTML = '<option value="">Nenhuma empresa encontrada</option>';
                return;
            }

            fileInput.disabled = false;
            depositHelper?.classList.remove('text-red-600');
            depositHelper?.classList.add('text-gray-500');
            if (depositHelper) {
                depositHelper.textContent = 'Selecione a empresa e o depósito que receberão o estoque importado.';
            }

            populateCompanySelect();
            resetDepositSelect('Selecione uma empresa primeiro', true);
            selectedCompany = '';
            selectedDeposit = '';
            availableDeposits = [];
            updateStartButtonState();

            if (companies.length === 1) {
                selectedCompany = companies[0]._id;
                companySelect.value = selectedCompany;
                fetchDepositsByCompany(selectedCompany);
            }
        } catch (error) {
            console.error('Erro ao carregar empresas:', error);
            companySelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
            companySelect.disabled = true;
            resetDepositSelect('Erro ao carregar depósitos', true);
            if (depositHelper) {
                depositHelper.textContent = 'Não foi possível carregar as empresas. Atualize a página e tente novamente.';
                depositHelper.classList.remove('text-gray-500');
                depositHelper.classList.add('text-red-600');
            }
            fileInput.disabled = true;
            selectedCompany = '';
            selectedDeposit = '';
            availableDeposits = [];
            updateStartButtonState();
        }
    };

    const fetchDepositsByCompany = async (companyId) => {
        if (!companyId) {
            availableDeposits = [];
            resetDepositSelect('Selecione uma empresa primeiro', true);
            if (depositHelper) {
                depositHelper.textContent = 'Escolha uma empresa para listar os depósitos disponíveis.';
                depositHelper.classList.remove('text-red-600');
                depositHelper.classList.add('text-gray-500');
            }
            return;
        }

        resetDepositSelect('Carregando depósitos...', true);

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/deposits?empresa=${companyId}`);
            if (!response.ok) {
                throw new Error('Falha ao carregar depósitos');
            }

            const payload = await response.json();
            availableDeposits = Array.isArray(payload?.deposits)
                ? payload.deposits
                : Array.isArray(payload)
                    ? payload
                    : [];

            if (!availableDeposits.length) {
                if (depositHelper) {
                    depositHelper.textContent = 'Nenhum depósito cadastrado para esta empresa. Cadastre um depósito antes de importar.';
                    depositHelper.classList.remove('text-gray-500');
                    depositHelper.classList.add('text-red-600');
                }
                depositSelect.disabled = true;
                updateStartButtonState();
                return;
            }

            depositHelper?.classList.remove('text-red-600');
            depositHelper?.classList.add('text-gray-500');
            if (depositHelper) {
                depositHelper.textContent = 'Selecione o depósito que receberá o estoque da planilha.';
            }

            populateDepositSelect();

            const matching = availableDeposits.find((deposit) => String(deposit._id) === String(selectedDeposit));
            if (matching) {
                depositSelect.value = matching._id;
            } else if (availableDeposits.length === 1) {
                selectedDeposit = availableDeposits[0]._id;
                depositSelect.value = selectedDeposit;
            }

            depositSelect.disabled = false;
            updateStartButtonState();
        } catch (error) {
            console.error('Erro ao carregar depósitos:', error);
            resetDepositSelect('Erro ao carregar depósitos', true);
            if (depositHelper) {
                depositHelper.textContent = 'Não foi possível carregar os depósitos. Tente novamente em instantes.';
                depositHelper.classList.remove('text-gray-500');
                depositHelper.classList.add('text-red-600');
            }
        }
    };

    const renderPagination = () => {
        paginationControls.innerHTML = '';

        const totalPages = Math.max(1, Math.ceil(previewData.length / PAGE_SIZE));
        if (previewData.length === 0) {
            return;
        }

        const createButton = (label, disabled, onClick, active = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.className = `px-2 py-1 rounded border text-xs ${active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
            button.disabled = disabled;
            if (!disabled) {
                button.addEventListener('click', onClick);
            }
            paginationControls.appendChild(button);
        };

        createButton('Anterior', currentPage === 1, () => {
            currentPage = Math.max(1, currentPage - 1);
            renderPreview();
        });

        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let page = startPage; page <= endPage; page++) {
            createButton(page.toString(), false, () => {
                currentPage = page;
                renderPreview();
            }, page === currentPage);
        }

        createButton('Próxima', currentPage === totalPages, () => {
            currentPage = Math.min(totalPages, currentPage + 1);
            renderPreview();
        });

        const info = document.createElement('span');
        info.className = 'ml-auto text-gray-500';
        info.textContent = `Página ${currentPage} de ${totalPages}`;
        paginationControls.appendChild(info);
    };

    const renderPreview = () => {
        previewTable.innerHTML = '';

        if (previewData.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="8" class="px-2 py-4 text-center text-xs text-gray-500">Selecione um arquivo para visualizar os produtos.</td>';
            previewTable.appendChild(emptyRow);
            previewCount.textContent = '0 produtos carregados';
            paginationControls.innerHTML = '';
            updateStartButtonState();
            return;
        }

        previewCount.textContent = `${previewData.length} produtos carregados`;

        const start = (currentPage - 1) * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, previewData.length);
        const currentSlice = previewData.slice(start, end);

        currentSlice.forEach((item) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50';
            row.innerHTML = `
                <td class="px-2 py-2 font-medium text-gray-700">${item.cod}</td>
                <td class="px-2 py-2 text-gray-600">${item.codbarras}</td>
                <td class="px-2 py-2 text-gray-600">${item.nome}</td>
                <td class="px-2 py-2 text-gray-600">${item.ncm || '-'}</td>
                <td class="px-2 py-2 text-right text-gray-700">${formatCurrency(item.custo)}</td>
                <td class="px-2 py-2 text-right text-gray-700">${formatCurrency(item.venda)}</td>
                <td class="px-2 py-2 text-right text-gray-700">${formatNumber(item.stock)}</td>
                <td class="px-2 py-2 text-center">
                    <span class="inline-flex items-center justify-center px-2 py-1 rounded text-[11px] font-medium ${item.inativo ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}">
                        ${item.inativo ? 'Sim' : 'Não'}
                    </span>
                </td>
            `;
            previewTable.appendChild(row);
        });

        renderPagination();
        updateStartButtonState();
    };

    const openWarningsModal = () => {
        if (!currentWarnings.length) {
            return;
        }
        const message = currentWarnings
            .map((warning, index) => `${index + 1}. ${warning}`)
            .join('\n\n');

        if (typeof window.showModal === 'function') {
            window.showModal({
                title: 'Avisos encontrados',
                message,
                confirmText: 'Fechar'
            });
        } else {
            alert(message);
        }
    };

    const updateWarnings = (warnings = []) => {
        currentWarnings = Array.isArray(warnings) ? warnings : [];

        if (!currentWarnings.length) {
            previewWarning.classList.add('hidden');
            previewWarning.innerHTML = '';
            return;
        }

        const previewItems = currentWarnings
            .slice(0, 2)
            .map((warning) => `<div>• ${warning}</div>`)
            .join('');
        const remaining = Math.max(0, currentWarnings.length - 2);

        previewWarning.classList.remove('hidden');
        previewWarning.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="space-y-1 text-left">
                    ${previewItems || '<div>• Avisos disponíveis</div>'}
                    ${remaining > 0 ? `<div class="text-[10px] text-amber-500">+ ${remaining} aviso(s) adicional(is)</div>` : ''}
                </div>
                <button type="button" class="inline-flex items-center gap-1 rounded border border-amber-200 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50" id="open-warnings-modal-btn">
                    <i class="fas fa-list"></i>
                    <span>Ver todos</span>
                </button>
            </div>
        `;

        const openBtn = document.getElementById('open-warnings-modal-btn');
        if (openBtn) {
            openBtn.addEventListener('click', openWarningsModal);
        }
    };

    const loadPreview = async (file) => {
        if (!file) {
            return;
        }

        isPreviewLoading = true;
        updateStartButtonState();

        previewTable.innerHTML = '<tr><td colspan="8" class="px-2 py-4 text-center text-xs text-gray-500">Carregando pré-visualização...</td></tr>';
        paginationControls.innerHTML = '';
        previewCount.textContent = 'Carregando...';
        updateWarnings([]);

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const formData = new FormData();
            formData.append('file', file);

            if (selectedCompany) {
                formData.append('storeId', selectedCompany);
            }
            if (selectedDeposit) {
                formData.append('depositId', selectedDeposit);
            }

            const response = await fetch(`${API_CONFIG.BASE_URL}/jobs/import-products/preview`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Não foi possível carregar a pré-visualização.');
            }

            previewData = Array.isArray(data.products) ? data.products : [];
            currentPage = 1;
            updateWarnings(Array.isArray(data.warnings) ? data.warnings : []);

            if (previewData.length === 0) {
                previewTable.innerHTML = '<tr><td colspan="8" class="px-2 py-4 text-center text-xs text-gray-500">Nenhum produto válido encontrado na planilha.</td></tr>';
                previewCount.textContent = '0 produtos carregados';
                paginationControls.innerHTML = '';
                return;
            }

            renderPreview();
        } catch (error) {
            previewData = [];
            currentPage = 1;
            previewTable.innerHTML = `<tr><td colspan="8" class="px-2 py-4 text-center text-xs text-red-500">${error.message}</td></tr>`;
            previewCount.textContent = '0 produtos carregados';
            paginationControls.innerHTML = '';
            updateWarnings([]);
        } finally {
            isPreviewLoading = false;
            updateStartButtonState();
        }
    };

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        selectedFile = file || null;

        if (!selectedFile) {
            fileNameLabel.textContent = 'Nenhum arquivo selecionado.';
            previewData = [];
            currentPage = 1;
            renderPreview();
            updateWarnings([]);
            updateStartButtonState();
            return;
        }

        fileNameLabel.textContent = selectedFile.name;
        loadPreview(selectedFile);
    });

    companySelect.addEventListener('change', (event) => {
        selectedCompany = event.target.value;
        selectedDeposit = '';
        availableDeposits = [];
        fetchDepositsByCompany(selectedCompany);
        updateStartButtonState();
    });

    depositSelect.addEventListener('change', (event) => {
        selectedDeposit = event.target.value;
        updateStartButtonState();
    });

    // --- Eventos do Socket.IO ---
    socket.on('connect', () => {
        addLog('Conectado ao servidor em tempo real...');
    });

    socket.on('import-log', (message) => {
        addLog(message);
    });

    socket.on('import-finished', () => {
        addLog('✅ Importação finalizada com sucesso!');
        updateStartButtonState();
    });

    socket.on('import-error', () => {
        addLog('❌ ERRO: A importação falhou. Verifique a consola do servidor para mais detalhes.');
        updateStartButtonState();
    });

    // --- Evento do Botão ---
    startBtn.addEventListener('click', async () => {
        if (!selectedFile) {
            return;
        }

        if (!selectedCompany || !selectedDeposit) {
            const message = 'Selecione a empresa e o depósito que receberão o estoque antes de iniciar a importação.';
            if (typeof window.showToast === 'function') {
                window.showToast(message, 'warning', 4000);
            } else {
                alert(message);
            }
            updateStartButtonState();
            return;
        }

        startBtn.disabled = true;
        logContainer.innerHTML = '';

        const selectedDepositInfo = availableDeposits.find((deposit) => String(deposit._id) === String(selectedDeposit));
        if (selectedDepositInfo) {
            const storeName = selectedDepositInfo?.empresa?.nome || selectedDepositInfo?.empresa?.razaoSocial || '';
            addLog(`Depósito selecionado: ${selectedDepositInfo.nome}${storeName ? ` (${storeName})` : ''}.`);
        }
        addLog('A enviar pedido de importação para o servidor...');

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('depositId', selectedDeposit);
            formData.append('storeId', selectedCompany);

            const response = await fetch(`${API_CONFIG.BASE_URL}/jobs/import-products`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Erro desconhecido ao iniciar o processo.');
            }

            addLog(`Servidor respondeu: ${data.message}`);
        } catch (error) {
            addLog(`❌ ERRO: Não foi possível iniciar o processo. ${error.message}`);
            updateStartButtonState();
        }
    });

    fetchCompanies();

    // Render inicial vazio
    renderPreview();
});