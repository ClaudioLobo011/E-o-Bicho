document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const fileNameLabel = document.getElementById('file-name');
    const previewTable = document.getElementById('preview-table');
    const previewCount = document.getElementById('preview-count');
    const previewWarning = document.getElementById('preview-warning');
    const paginationControls = document.getElementById('pagination-controls');
    const startBtn = document.getElementById('start-import-btn');
    const logContainer = document.getElementById('log-container');

    if (!startBtn || !logContainer || !fileInput || !previewTable) {
        return;
    }

    const PAGE_SIZE = 50;
    let selectedFile = null;
    let previewData = [];
    let currentPage = 1;

    // Conecta ao servidor WebSocket (Socket.IO)
    const socket = io(API_CONFIG.SERVER_URL);

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
            emptyRow.innerHTML = '<td colspan="7" class="px-2 py-4 text-center text-xs text-gray-500">Selecione um arquivo para visualizar os produtos.</td>';
            previewTable.appendChild(emptyRow);
            previewCount.textContent = '0 produtos carregados';
            paginationControls.innerHTML = '';
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
    };

    const updateWarnings = (warnings = []) => {
        if (!warnings.length) {
            previewWarning.classList.add('hidden');
            previewWarning.textContent = '';
            return;
        }

        previewWarning.classList.remove('hidden');
        previewWarning.innerHTML = warnings
            .slice(0, 3)
            .map((warning) => `<div>• ${warning}</div>`)
            .join('');

        if (warnings.length > 3) {
            const remaining = warnings.length - 3;
            previewWarning.innerHTML += `<div class="mt-1 text-[10px] text-amber-500">+ ${remaining} aviso(s) adicional(is)</div>`;
        }
    };

    const loadPreview = async (file) => {
        if (!file) {
            return;
        }

        startBtn.disabled = true;
        previewTable.innerHTML = '<tr><td colspan="7" class="px-2 py-4 text-center text-xs text-gray-500">Carregando pré-visualização...</td></tr>';
        paginationControls.innerHTML = '';
        previewCount.textContent = 'Carregando...';
        updateWarnings([]);

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const formData = new FormData();
            formData.append('file', file);

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
                previewTable.innerHTML = '<tr><td colspan="7" class="px-2 py-4 text-center text-xs text-gray-500">Nenhum produto válido encontrado na planilha.</td></tr>';
                previewCount.textContent = '0 produtos carregados';
                paginationControls.innerHTML = '';
                startBtn.disabled = true;
                return;
            }

            renderPreview();
            startBtn.disabled = false;
        } catch (error) {
            previewTable.innerHTML = '<tr><td colspan="7" class="px-2 py-4 text-center text-xs text-red-500">' + error.message + '</td></tr>';
            previewCount.textContent = '0 produtos carregados';
            paginationControls.innerHTML = '';
            startBtn.disabled = true;
            updateWarnings([]);
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
            startBtn.disabled = true;
            updateWarnings([]);
            return;
        }

        fileNameLabel.textContent = selectedFile.name;
        loadPreview(selectedFile);
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
        startBtn.disabled = false;
    });

    socket.on('import-error', () => {
        addLog('❌ ERRO: A importação falhou. Verifique a consola do servidor para mais detalhes.');
        startBtn.disabled = false;
    });

    // --- Evento do Botão ---
    startBtn.addEventListener('click', async () => {
        if (!selectedFile) {
            return;
        }

        startBtn.disabled = true;
        logContainer.innerHTML = '';
        addLog('A enviar pedido de importação para o servidor...');

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const formData = new FormData();
            formData.append('file', selectedFile);

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
            startBtn.disabled = false;
        }
    });

    // Render inicial vazio
    renderPreview();
});