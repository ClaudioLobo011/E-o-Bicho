(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const BASE_PATH = typeof window.basePath === 'string' ? window.basePath : '../../';

  const selectors = {
    form: '#bank-account-form',
    company: '#account-company',
    bank: '#bank-code',
    agency: '#agency',
    accountNumber: '#account-number',
    accountDigit: '#account-digit',
    accountType: '#account-type',
    pixKey: '#pix-key',
    documentNumber: '#company-cnpj',
    alias: '#account-alias',
    initialBalance: '#initial-balance',
    dailyCdi: '#daily-cdi',
    status: '#bank-account-status',
    submitButton: '#bank-account-submit',
    submitLabel: '#bank-account-submit-label',
    resetButton: '#bank-account-reset',
    resetLabel: '#bank-account-reset-label',
    listStatus: '#bank-account-list-status',
    table: '#bank-account-table',
    tableBody: '#bank-account-table-body',
  };

  const state = {
    companies: [],
    saving: false,
    accounts: [],
    loadingAccounts: false,
    editingAccountId: null,
    editingAccount: null,
    deletingIds: new Set(),
  };

  const elements = {};

  const initElements = () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      elements[key] = document.querySelector(selector);
    });
  };

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    if (type === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }
  };

  const getToken = () => {
    try {
      const stored = localStorage.getItem('loggedInUser');
      if (!stored) return '';
      const parsed = JSON.parse(stored);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token do usuário logado.', error);
      return '';
    }
  };

  const parseCurrency = (value) => {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = String(value)
      .trim()
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^0-9.+-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const parsePercentage = (value) => {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    return parseCurrency(value);
  };

  const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const normalizeId = (value) => (value ? String(value) : '');

  const formatCurrency = (value) => {
    if (value === undefined || value === null || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return number.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatPercentage = (value) => {
    if (value === undefined || value === null || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return number.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  };

  const describeAccount = (account) => {
    if (!account) return '';
    const companyLabel = account.company && typeof account.company === 'object'
      ? buildCompanyLabel(account.company)
      : buildCompanyLabel({ nome: account.company });
    const bankCode = account.bankCode ? `Banco ${account.bankCode}` : '';
    const agency = account.agency ? `Agência ${account.agency}` : '';
    const accountNumber = account.accountNumber ? `Conta ${account.accountNumber}` : '';
    return [companyLabel, bankCode, agency, accountNumber].filter(Boolean).join(' • ');
  };

  const ensureSelectOption = (select, value, label, dataset = {}) => {
    if (!select || !value) return null;
    const normalizedValue = String(value);
    const existing = Array.from(select.options || []).find((option) => option.value === normalizedValue);
    if (existing) {
      if (label) existing.textContent = label;
      Object.entries(dataset).forEach(([key, dataValue]) => {
        if (dataValue !== undefined && dataValue !== null) {
          existing.dataset[key] = dataValue;
        }
      });
      return existing;
    }
    const option = document.createElement('option');
    option.value = normalizedValue;
    option.textContent = label || normalizedValue;
    Object.entries(dataset).forEach(([key, dataValue]) => {
      if (dataValue !== undefined && dataValue !== null) {
        option.dataset[key] = dataValue;
      }
    });
    select.appendChild(option);
    return option;
  };

  const updateStatus = (message) => {
    if (elements.status) {
      elements.status.textContent = message || 'Nenhum envio realizado ainda.';
    }
  };

  const setListStatus = (message, busy = false) => {
    if (elements.listStatus) {
      elements.listStatus.textContent = message || '';
    }
    if (elements.table) {
      if (busy) {
        elements.table.setAttribute('aria-busy', 'true');
      } else {
        elements.table.removeAttribute('aria-busy');
      }
    }
  };

  const getSubmitLabel = (saving) => {
    if (saving) {
      return state.editingAccountId ? 'Atualizando...' : 'Salvando...';
    }
    return state.editingAccountId ? 'Atualizar conta' : 'Salvar conta';
  };

  const updateResetLabel = () => {
    if (!elements.resetLabel) return;
    elements.resetLabel.textContent = state.editingAccountId ? 'Cancelar edição' : 'Descartar alterações';
  };

  const setSavingState = (saving) => {
    state.saving = saving;
    if (elements.submitButton) {
      elements.submitButton.disabled = saving;
      elements.submitButton.classList.toggle('opacity-60', saving);
      elements.submitButton.classList.toggle('pointer-events-none', saving);
    }
    if (elements.submitLabel) {
      elements.submitLabel.textContent = getSubmitLabel(saving);
    }
    updateResetLabel();
  };

  const parseErrorResponse = async (response) => {
    try {
      const data = await response.json();
      if (data?.message) return data.message;
    } catch (error) {
      // ignore
    }
    return null;
  };

  const buildCompanyLabel = (company) => {
    if (!company || typeof company !== 'object') return 'Empresa sem identificação';
    const nome = company.nome || company.nomeFantasia || company.razaoSocial || company.apelido || '';
    const documento = company.cnpj || company.cpf || '';
    if (nome && documento) {
      return `${nome} (${documento})`;
    }
    return nome || documento || 'Empresa sem identificação';
  };

  const formatDocument = (documentNumber) => {
    if (!documentNumber) return '—';
    const digits = String(documentNumber).replace(/\D+/g, '');
    if (digits.length === 14) {
      return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    if (digits.length === 11) {
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    return documentNumber;
  };

  const renderAccounts = () => {
    if (!elements.tableBody) return;

    if (!Array.isArray(state.accounts) || !state.accounts.length) {
      elements.tableBody.innerHTML =
        '<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-gray-500">Nenhuma conta cadastrada no momento.</td></tr>';
      return;
    }

    const editingId = normalizeId(state.editingAccountId);

    const rows = state.accounts
      .map((account) => {
        const id = normalizeId(account._id);
        const company = account.company && typeof account.company === 'object'
          ? buildCompanyLabel(account.company)
          : buildCompanyLabel({ nome: account.company });
        const bankCode = account.bankCode || '—';
        const bankName = account.bankName || 'Banco não informado';
        const agency = account.agency || '—';
        const accountNumber = account.accountDigit
          ? `${account.accountNumber || '—'}-${account.accountDigit}`
          : account.accountNumber || '—';
        const pixKey = account.pixKey || '—';
        const documentNumber = formatDocument(account.documentNumber);
        const updatedAt = account.updatedAt ? new Date(account.updatedAt) : null;
        const updatedAtLabel = updatedAt
          ? updatedAt.toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : '—';
        const isEditing = editingId && editingId === id;
        const isDeleting = state.deletingIds.has(id);
        const actionBaseClass =
          'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1';
        const editClasses = `${actionBaseClass} ${isDeleting || state.saving
          ? 'cursor-not-allowed opacity-60'
          : 'text-primary-700 hover:bg-primary/10 focus:ring-primary/40'}`;
        const deleteClasses = `${actionBaseClass} ${isDeleting || state.saving
          ? 'cursor-not-allowed opacity-60'
          : 'text-red-600 hover:bg-red-50 focus:ring-red-300'}`;
        const editLabel = isEditing ? 'Em edição' : 'Editar';
        const deleteLabel = isDeleting ? 'Excluindo...' : 'Excluir';
        const rowClasses = ['transition'];
        if (isEditing) {
          rowClasses.push('bg-primary/5', 'ring-1', 'ring-primary/30');
        } else {
          rowClasses.push('hover:bg-gray-50');
        }

        return `
          <tr class="${rowClasses.join(' ')}" data-account-id="${escapeHtml(id)}">
            <td class="px-4 py-3 align-top">
              <div class="font-medium text-gray-800">${escapeHtml(company)}</div>
              ${account.alias ? `<div class="text-xs text-gray-500">${escapeHtml(account.alias)}</div>` : ''}
            </td>
            <td class="px-4 py-3 align-top">
              <div class="font-medium text-gray-800">${escapeHtml(bankCode)}</div>
              <div class="text-xs text-gray-500">${escapeHtml(bankName)}</div>
            </td>
            <td class="px-4 py-3 align-top">
              <div class="font-medium text-gray-800">Agência ${escapeHtml(agency)}</div>
              <div class="text-xs text-gray-500">Conta ${escapeHtml(accountNumber)}</div>
            </td>
            <td class="px-4 py-3 align-top text-gray-700">${escapeHtml(documentNumber)}</td>
            <td class="px-4 py-3 align-top text-gray-700">${escapeHtml(pixKey)}</td>
            <td class="px-4 py-3 align-top text-gray-700">${escapeHtml(updatedAtLabel)}</td>
            <td class="px-4 py-3 align-top">
              <div class="flex items-center justify-end gap-2">
                <button type="button" class="${editClasses}" data-action="edit" data-id="${escapeHtml(id)}" title="Editar conta bancária" ${
                  isDeleting || state.saving ? 'disabled' : ''
                }>
                  <i class="fas fa-pen-to-square"></i>
                  <span>${escapeHtml(editLabel)}</span>
                </button>
                <button type="button" class="${deleteClasses}" data-action="delete" data-id="${escapeHtml(id)}" title="Excluir conta bancária" ${
                  isDeleting || state.saving ? 'disabled' : ''
                }>
                  <i class="fas fa-trash"></i>
                  <span>${escapeHtml(deleteLabel)}</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    elements.tableBody.innerHTML = rows;
  };

  const resetFormFields = () => {
    const fieldKeys = [
      'company',
      'bank',
      'agency',
      'accountNumber',
      'accountDigit',
      'pixKey',
      'documentNumber',
      'alias',
      'initialBalance',
      'dailyCdi',
    ];

    fieldKeys.forEach((key) => {
      const element = elements[key];
      if (!element) return;
      if (element.tagName === 'SELECT') {
        element.value = '';
      } else {
        element.value = '';
      }
    });

    if (elements.accountType) {
      const defaultOption = Array.from(elements.accountType.options || []).find((option) => option.value === 'corrente');
      elements.accountType.value = defaultOption ? defaultOption.value : (elements.accountType.options?.[0]?.value || '');
    }
  };

  const populateFormWithAccount = (account) => {
    if (!account) return;

    const companyId = account.company && typeof account.company === 'object'
      ? normalizeId(account.company._id || account.company.id || account.company.value)
      : normalizeId(account.company);
    if (elements.company) {
      if (companyId) {
        const companyLabel = account.company && typeof account.company === 'object'
          ? buildCompanyLabel(account.company)
          : buildCompanyLabel({ nome: account.company });
        ensureSelectOption(elements.company, companyId, companyLabel);
        elements.company.value = companyId;
      } else {
        elements.company.value = '';
      }
    }

    if (elements.bank) {
      const bankCode = sanitizeString(account.bankCode);
      if (bankCode) {
        ensureSelectOption(elements.bank, bankCode, `${bankCode} - ${account.bankName || 'Banco não informado'}`, {
          bankName: account.bankName || '',
        });
        elements.bank.value = bankCode;
      } else {
        elements.bank.value = '';
      }
    }

    if (elements.agency) elements.agency.value = sanitizeString(account.agency);
    if (elements.accountNumber) elements.accountNumber.value = sanitizeString(account.accountNumber);
    if (elements.accountDigit) elements.accountDigit.value = sanitizeString(account.accountDigit);
    if (elements.accountType) {
      const type = sanitizeString(account.accountType) || 'corrente';
      const validOption = Array.from(elements.accountType.options || []).some((option) => option.value === type);
      elements.accountType.value = validOption ? type : 'corrente';
    }
    if (elements.pixKey) elements.pixKey.value = sanitizeString(account.pixKey);
    if (elements.documentNumber) elements.documentNumber.value = sanitizeString(account.documentNumber);
    if (elements.alias) elements.alias.value = sanitizeString(account.alias);
    if (elements.initialBalance) elements.initialBalance.value = formatCurrency(account.initialBalance);
    if (elements.dailyCdi) elements.dailyCdi.value = formatPercentage(account.dailyCdi);
  };

  const updateFormMode = () => {
    if (elements.form) {
      if (state.editingAccountId) {
        elements.form.setAttribute('data-mode', 'edit');
      } else {
        elements.form.removeAttribute('data-mode');
      }
    }

    if (elements.submitLabel) {
      elements.submitLabel.textContent = getSubmitLabel(state.saving);
    }

    if (elements.submitButton) {
      const label = state.editingAccountId ? 'Atualizar conta bancária' : 'Salvar conta bancária';
      elements.submitButton.setAttribute('aria-label', label);
      elements.submitButton.setAttribute('title', label);
    }

    if (elements.resetButton) {
      const resetLabel = state.editingAccountId
        ? 'Cancelar edição da conta bancária em andamento'
        : 'Descartar alterações do formulário de conta bancária';
      elements.resetButton.setAttribute('aria-label', resetLabel);
      elements.resetButton.setAttribute('title', resetLabel);
    }

    updateResetLabel();
  };

  const startEditingAccount = (accountId) => {
    if (!accountId) return;
    if (state.saving) {
      notify('Aguarde o término do salvamento atual para editar outra conta.', 'warning');
      return;
    }

    const id = normalizeId(accountId);
    const account = state.accounts.find((item) => normalizeId(item._id) === id);
    if (!account) {
      notify('Conta bancária não encontrada para edição.', 'error');
      return;
    }

    state.editingAccountId = id;
    state.editingAccount = account;
    populateFormWithAccount(account);
    updateStatus(`Editando conta cadastrada — ${describeAccount(account)}`);
    updateFormMode();
    renderAccounts();

    if (elements.form) {
      try {
        elements.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {
        // ignore scroll errors
      }
    }

    notify('Conta carregada para edição.', 'info');
  };

  const cancelEditing = ({ keepStatus = false } = {}) => {
    const wasEditing = !!state.editingAccountId;
    state.editingAccountId = null;
    state.editingAccount = null;
    updateFormMode();
    renderAccounts();
    if (!keepStatus) {
      updateStatus('Nenhum envio realizado ainda.');
    }
    if (wasEditing && !keepStatus) {
      notify('Edição da conta cancelada.', 'info');
    }
  };

  const loadAccounts = async () => {
    if (state.loadingAccounts) return;
    state.loadingAccounts = true;
    setListStatus('Carregando contas cadastradas...', true);

    try {
      const headers = {};
      const token = getToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE}/bank-accounts`, { headers });
      if (!response.ok) {
        throw new Error(`Falha ao carregar contas cadastradas (${response.status})`);
      }

      const data = await response.json();
      state.accounts = Array.isArray(data?.accounts) ? data.accounts : [];

      if (state.editingAccountId) {
        const refreshed = state.accounts.find((item) => normalizeId(item._id) === state.editingAccountId);
        if (refreshed) {
          state.editingAccount = refreshed;
        } else {
          const previousId = state.editingAccountId;
          state.editingAccountId = null;
          state.editingAccount = null;
          updateFormMode();
          if (previousId) {
            updateStatus('A conta em edição não está mais disponível na listagem.');
            notify('A conta em edição não está mais disponível na listagem.', 'warning');
          }
        }
      }

      if (!state.accounts.length) {
        setListStatus('Nenhuma conta cadastrada até o momento.');
      } else {
        setListStatus(`${state.accounts.length} conta(s) encontrada(s).`);
      }
      renderAccounts();
    } catch (error) {
      console.error('Erro ao carregar contas cadastradas:', error);
      state.accounts = [];
      renderAccounts();
      setListStatus('Não foi possível carregar as contas cadastradas.', false);
      notify('Não foi possível carregar as contas cadastradas. Tente novamente mais tarde.', 'error');
    } finally {
      state.loadingAccounts = false;
      setListStatus(elements.listStatus?.textContent || '', false);
    }
  };

  const deleteAccount = async (accountId) => {
    const id = normalizeId(accountId);
    if (!id || state.deletingIds.has(id)) return;

    state.deletingIds.add(id);
    renderAccounts();
    const previousStatus = elements.listStatus ? elements.listStatus.textContent : '';
    setListStatus('Removendo conta bancária...', true);

    try {
      const token = getToken();
      const headers = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE}/bank-accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const message = (await parseErrorResponse(response)) || 'Não foi possível excluir a conta bancária.';
        throw new Error(message);
      }

      if (state.editingAccountId === id) {
        cancelEditing({ keepStatus: true });
        updateStatus('Conta excluída com sucesso.');
      }

      notify('Conta bancária excluída com sucesso.', 'success');
      await loadAccounts();
    } catch (error) {
      console.error('Erro ao excluir conta bancária:', error);
      notify(error?.message || 'Não foi possível excluir a conta bancária.', 'error');
    } finally {
      state.deletingIds.delete(id);
      const currentStatus = elements.listStatus ? elements.listStatus.textContent : '';
      if (currentStatus === 'Removendo conta bancária...') {
        setListStatus(previousStatus, false);
      } else {
        setListStatus(currentStatus, false);
      }
      renderAccounts();
    }
  };

  const confirmDeleteAccount = (accountId) => {
    const id = normalizeId(accountId);
    if (!id) return;

    const account = state.accounts.find((item) => normalizeId(item._id) === id);
    if (!account) {
      notify('Conta bancária não encontrada para exclusão.', 'error');
      return;
    }

    const description = describeAccount(account) || 'Conta bancária selecionada';
    const message = `Deseja realmente excluir a conta bancária selecionada?\n\n${description}\n\nEsta ação não poderá ser desfeita.`;

    if (typeof window.showModal === 'function') {
      window.showModal({
        title: 'Excluir conta bancária',
        message,
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        onConfirm: () => deleteAccount(id),
      });
      return;
    }

    if (window.confirm(message)) {
      deleteAccount(id);
    }
  };

  const handleTableClick = (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton || !elements.tableBody?.contains(actionButton)) return;

    const action = actionButton.dataset.action;
    const id = actionButton.dataset.id;

    if (!action || !id) return;

    event.preventDefault();

    if (action === 'edit') {
      startEditingAccount(id);
    } else if (action === 'delete') {
      confirmDeleteAccount(id);
    }
  };

  const loadCompanies = async () => {
    const select = elements.company;
    if (!select) return;

    select.innerHTML = '<option value="">Carregando empresas...</option>';

    try {
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(`${API_BASE}/stores`, { headers });
      if (!response.ok) {
        throw new Error(`Falha ao carregar empresas (${response.status})`);
      }

      const data = await response.json();
      state.companies = Array.isArray(data) ? data : [];

      if (!state.companies.length) {
        select.innerHTML = '<option value="">Nenhuma empresa cadastrada</option>';
        notify('Cadastre empresas antes de vincular uma conta corrente.', 'warning');
        return;
      }

      select.innerHTML = '<option value="">Selecione a empresa</option>';
      state.companies.forEach((company) => {
        if (!company || !company._id) return;
        const option = document.createElement('option');
        option.value = company._id;
        option.textContent = buildCompanyLabel(company);
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      select.innerHTML = '<option value="">Não foi possível carregar as empresas</option>';
      notify('Não foi possível carregar as empresas. Tente novamente mais tarde.', 'error');
    }
  };

  const loadBanks = async () => {
    const select = elements.bank;
    if (!select) return;

    try {
      const response = await fetch(`${BASE_PATH}data/bancos.json`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Falha ao carregar bancos (${response.status})`);
      }

      const banks = await response.json();
      const normalized = Array.isArray(banks)
        ? banks
            .map((bank) => {
              const code = bank?.code;
              const ispb = bank?.ispb;
              if (code === null && !ispb) {
                return null;
              }

              const bankCode = code !== null && code !== undefined
                ? String(code).padStart(3, '0')
                : String(ispb || '').trim();
              const bankName = bank?.fullName || bank?.name;

              if (!bankCode || !bankName) {
                return null;
              }

              return {
                code: bankCode,
                name: bankName,
              };
            })
            .filter(Boolean)
        : [];

      const uniqueBanks = normalized.reduce((registry, bank) => {
        if (!registry.has(bank.code)) {
          registry.set(bank.code, bank);
        }
        return registry;
      }, new Map());

      const orderedBanks = Array.from(uniqueBanks.values()).sort((a, b) =>
        a.code.localeCompare(b.code)
      );

      select.innerHTML = '<option value="">Selecione um banco</option>';
      orderedBanks.forEach((bank) => {
        const option = document.createElement('option');
        option.value = bank.code;
        option.textContent = `${bank.code} - ${bank.name}`;
        option.dataset.bankName = bank.name;
        select.appendChild(option);
      });

      if (!orderedBanks.length) {
        throw new Error('Lista de bancos vazia');
      }
    } catch (error) {
      console.error('Erro ao carregar bancos:', error);
      select.innerHTML = '';
      const fallbackOption = document.createElement('option');
      fallbackOption.value = '341';
      fallbackOption.dataset.bankName = 'Itaú Unibanco S.A.';
      fallbackOption.textContent = '341 - Itaú Unibanco S.A.';
      select.appendChild(fallbackOption);

      const helper = document.createElement('p');
      helper.className = 'mt-1 text-xs text-red-500';
      helper.textContent = 'Não foi possível carregar a lista completa. Utilize o código Bacen ou ISPB manualmente.';
      select.insertAdjacentElement('afterend', helper);
    }
  };

  const buildPayload = () => {
    const company = sanitizeString(elements.company?.value);
    const bankCode = sanitizeString(elements.bank?.value);
    const agency = sanitizeString(elements.agency?.value);
    const accountNumber = sanitizeString(elements.accountNumber?.value);
    const accountDigit = sanitizeString(elements.accountDigit?.value);
    const accountType = sanitizeString(elements.accountType?.value || 'corrente');
    const pixKey = sanitizeString(elements.pixKey?.value);
    const documentNumber = sanitizeString(elements.documentNumber?.value);
    const alias = sanitizeString(elements.alias?.value);
    const initialBalance = parseCurrency(elements.initialBalance?.value);
    const dailyCdi = parsePercentage(elements.dailyCdi?.value);

    const selectedBankOption = elements.bank?.options?.[elements.bank.selectedIndex] || null;
    const bankName = selectedBankOption?.dataset?.bankName
      || sanitizeString(selectedBankOption?.textContent || '').split('-').slice(1).join('-').trim();

    return {
      company,
      bankCode,
      bankName,
      agency,
      accountNumber,
      accountDigit,
      accountType,
      pixKey,
      documentNumber,
      alias,
      initialBalance,
      dailyCdi,
    };
  };

  const validatePayload = (payload) => {
    if (!payload.company) {
      throw new Error('Selecione a empresa proprietária da conta.');
    }
    if (!payload.bankCode) {
      throw new Error('Selecione o banco da conta corrente.');
    }
    if (!payload.agency) {
      throw new Error('Informe a agência bancária.');
    }
    if (!payload.accountNumber) {
      throw new Error('Informe o número da conta bancária.');
    }
    if (!payload.documentNumber) {
      throw new Error('Informe o CNPJ ou documento vinculado à conta.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (state.saving) return;

    const isEditing = !!state.editingAccountId;

    try {
      const payload = buildPayload();
      validatePayload(payload);

      setSavingState(true);
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const endpoint = isEditing
        ? `${API_BASE}/bank-accounts/${encodeURIComponent(state.editingAccountId)}`
        : `${API_BASE}/bank-accounts`;

      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const fallbackMessage = isEditing
          ? 'Não foi possível atualizar a conta bancária.'
          : 'Não foi possível salvar a conta bancária.';
        const message = (await parseErrorResponse(response)) || fallbackMessage;
        throw new Error(message);
      }

      const now = new Date();
      if (isEditing) {
        notify('Conta bancária atualizada com sucesso!', 'success');
        updateStatus(`Conta atualizada em ${now.toLocaleString('pt-BR')}`);
      } else {
        notify('Conta bancária salva com sucesso!', 'success');
        updateStatus(`Conta salva em ${now.toLocaleString('pt-BR')}`);
      }

      resetFormFields();
      cancelEditing({ keepStatus: true });
      await loadAccounts();
    } catch (error) {
      const fallback = isEditing
        ? 'Não foi possível atualizar a conta bancária.'
        : 'Não foi possível salvar a conta bancária.';
      notify(error?.message || fallback, 'error');
    } finally {
      setSavingState(false);
    }
  };

  const handleReset = (event) => {
    if (event) {
      event.preventDefault();
    }
    resetFormFields();
    cancelEditing();
    setSavingState(false);
  };

  const init = () => {
    initElements();
    if (!elements.form) return;

    updateFormMode();
    loadBanks();
    loadCompanies();
    loadAccounts();

    elements.form.addEventListener('submit', handleSubmit);
    elements.form.addEventListener('reset', handleReset);
    if (elements.tableBody) {
      elements.tableBody.addEventListener('click', handleTableClick);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
