(function () {
    const availableCodes = [1, 2, 3, 4];
    const companies = [
        { id: 'empresa-a', name: 'Empresa A' },
        { id: 'empresa-b', name: 'Empresa B' },
        { id: 'empresa-c', name: 'Empresa C' }
    ];
    const entries = [];

    const codeInput = document.getElementById('icms-code');
    const valueInput = document.getElementById('icms-value');
    const companySelect = document.getElementById('icms-company');
    const form = document.getElementById('icms-form');
    const addButton = document.getElementById('icms-add-btn');
    const tableBody = document.getElementById('icms-table-body');
    const emptyStateRow = document.getElementById('icms-empty-state');
    const countLabel = document.getElementById('icms-count');

    if (!codeInput || !valueInput || !companySelect || !form || !addButton || !tableBody || !emptyStateRow || !countLabel) {
        return;
    }

    function populateCompanies() {
        companies.forEach((company) => {
            const option = document.createElement('option');
            option.value = company.id;
            option.textContent = company.name;
            companySelect.appendChild(option);
        });
    }

    function getNextCode() {
        return availableCodes.length ? availableCodes[0] : null;
    }

    function removeUsedCode() {
        availableCodes.shift();
    }

    function updateCodeField() {
        const nextCode = getNextCode();
        codeInput.value = nextCode !== null ? String(nextCode) : '—';
        if (nextCode === null) {
            addButton.disabled = true;
            addButton.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    function formatCurrency(value) {
        return Number(value).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }

    function renderTable() {
        tableBody.innerHTML = '';

        if (!entries.length) {
            tableBody.appendChild(emptyStateRow);
            emptyStateRow.classList.remove('hidden');
            countLabel.textContent = 'Nenhum registro cadastrado';
            return;
        }

        emptyStateRow.classList.add('hidden');
        countLabel.textContent = `${entries.length} registro${entries.length > 1 ? 's' : ''} cadastrados`;

        entries.forEach((entry) => {
            const row = document.createElement('tr');
            row.className = 'bg-white';

            const codeCell = document.createElement('td');
            codeCell.className = 'px-6 py-4 font-semibold text-gray-700';
            codeCell.textContent = entry.code;

            const companyCell = document.createElement('td');
            companyCell.className = 'px-6 py-4';
            companyCell.textContent = entry.companyName;

            const valueCell = document.createElement('td');
            valueCell.className = 'px-6 py-4 text-right font-medium text-gray-900';
            valueCell.textContent = formatCurrency(entry.value);

            row.appendChild(codeCell);
            row.appendChild(companyCell);
            row.appendChild(valueCell);
            tableBody.appendChild(row);
        });
    }

    function resetForm() {
        valueInput.value = '';
        companySelect.value = '';
    }

    function showValidationMessage(message) {
        const existingMessage = document.getElementById('icms-validation-message');
        if (existingMessage) {
            existingMessage.textContent = message;
            return;
        }

        const messageElement = document.createElement('p');
        messageElement.id = 'icms-validation-message';
        messageElement.className = 'text-sm text-red-600 mt-2 md:col-span-12';
        messageElement.textContent = message;
        form.appendChild(messageElement);
    }

    function clearValidationMessage() {
        const messageElement = document.getElementById('icms-validation-message');
        if (messageElement) {
            messageElement.remove();
        }
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        clearValidationMessage();

        const code = getNextCode();
        const value = valueInput.value.trim();
        const companyId = companySelect.value;

        if (code === null) {
            showValidationMessage('Todos os códigos disponíveis já foram utilizados.');
            return;
        }

        if (!value) {
            showValidationMessage('Informe um valor para cadastrar o ICMS.');
            valueInput.focus();
            return;
        }

        if (!companyId) {
            showValidationMessage('Selecione uma empresa para concluir o cadastro.');
            companySelect.focus();
            return;
        }

        entries.push({
            code,
            companyId,
            companyName: companies.find((company) => company.id === companyId)?.name || companyId,
            value: parseFloat(value)
        });

        removeUsedCode();
        updateCodeField();
        renderTable();
        resetForm();
    });

    populateCompanies();
    updateCodeField();
    renderTable();
})();
