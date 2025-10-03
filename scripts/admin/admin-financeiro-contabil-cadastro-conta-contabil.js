function initAdminFinanceiroContabilCadastroContaContabil() {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const ACCOUNTING_ENDPOINT = `${API_BASE}/accounting-accounts`;

  const selectors = {
    form: '#accounting-account-form',
    formTitle: '#accounting-account-form-title',
    formSubtitle: '#accounting-account-form-subtitle',
    formStatus: '#accounting-account-form-status',
    formIdField: '#accounting-account-id',
    companiesContainer: '#accounting-account-companies',
    companiesStatus: '#accounting-account-company-status',
    name: '#account-name',
    code: '#account-code',
    spedCode: '#sped-code',
    accountTypeRadios: 'input[name="account-type"]',
    accountingOrigin: '#account-origin',
    costClassification: '#account-cost',
    systemOrigin: '#account-source-system',
    paymentNature: '#payment-nature',
    status: '#account-status',
    notes: '#account-notes',
    submitButton: '#accounting-account-submit',
    submitLabel: '#accounting-account-submit-label',
    resetButton: '#accounting-account-reset',
    resetLabel: '#accounting-account-reset-label',
    listStatus: '#accounting-account-list-status',
    tableBody: '#accounting-account-table-body',
    importButton: '#accounting-account-import-button',
    importInput: '#accounting-account-import-input',
    importStatus: '#accounting-account-import-status',
    importLabel: '#accounting-account-import-label',
  };

  const state = {
    companies: [],
    loadingCompanies: false,
    loadingAccounts: false,
    saving: false,
    deletingIds: new Set(),
    accounts: [],
    editingId: null,
    pendingSelectedCompanies: new Set(),
    importing: false,
  };

  const elements = {};

  const initElements = () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      if (!selector) {
        elements[key] = null;
        return;
      }

      if (key === 'accountTypeRadios') {
        elements[key] = Array.from(document.querySelectorAll(selector));
      } else {
        elements[key] = document.querySelector(selector);
      }
    });
  };

  const getToken = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Não foi possível recuperar o token de autenticação.', error);
      return '';
    }
  };

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else if (type === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }
  };

  const setCompanyStatus = (message, isLoading = false) => {
    if (!elements.companiesStatus) return;
    elements.companiesStatus.textContent = message || '';
    const isError = !isLoading && message && message.toLowerCase().includes('erro');
    elements.companiesStatus.classList.remove('text-red-600', 'text-gray-500');
    elements.companiesStatus.classList.add(isError ? 'text-red-600' : 'text-gray-500');
  };

  const setListStatus = (message, isError = false) => {
    if (!elements.listStatus) return;
    elements.listStatus.textContent = message || '';
    elements.listStatus.classList.remove('text-red-600', 'text-gray-500');
    elements.listStatus.classList.add(isError ? 'text-red-600' : 'text-gray-500');
  };

  const setImportStatus = (message, type = 'info') => {
    if (!elements.importStatus) return;
    elements.importStatus.textContent = message || '';
    elements.importStatus.classList.remove('text-red-600', 'text-emerald-600', 'text-gray-500');
    if (type === 'error') {
      elements.importStatus.classList.add('text-red-600');
    } else if (type === 'success') {
      elements.importStatus.classList.add('text-emerald-600');
    } else {
      elements.importStatus.classList.add('text-gray-500');
    }
  };

  const setImporting = (importing) => {
    state.importing = importing;
    if (elements.importButton) {
      elements.importButton.disabled = importing;
      elements.importButton.classList.toggle('opacity-60', importing);
      elements.importButton.classList.toggle('cursor-not-allowed', importing);
    }
    if (elements.importLabel) {
      elements.importLabel.textContent = importing ? 'Importando...' : 'Importar planilha';
    }
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const normalizeId = (value) => {
    if (!value) return '';
    try {
      return String(value);
    } catch (_) {
      return '';
    }
  };

  const setFormStatus = (message) => {
    if (elements.formStatus) {
      elements.formStatus.textContent = message || '';
    }
  };

  const setFormMode = (mode) => {
    const isEdit = mode === 'edit';
    state.editingId = isEdit ? state.editingId : null;
    if (elements.formTitle) {
      elements.formTitle.textContent = isEdit
        ? 'Editar conta contábil'
        : 'Configuração da conta contábil';
    }
    if (elements.formSubtitle) {
      elements.formSubtitle.textContent = isEdit
        ? 'Atualize os dados da conta contábil selecionada e salve para aplicar as alterações.'
        : 'Vincule as empresas e preencha os dados que serão utilizados nos lançamentos e relatórios.';
    }
    if (elements.submitLabel) {
      elements.submitLabel.textContent = isEdit ? 'Atualizar conta' : 'Salvar conta';
    }
    if (elements.resetLabel) {
      elements.resetLabel.textContent = isEdit ? 'Cancelar edição' : 'Descartar alterações';
    }
    setFormStatus(
      isEdit
        ? 'Atualize os campos desejados e confirme para registrar as alterações.'
        : 'Preencha os dados e salve para registrar a conta contábil.'
    );
  };

  const setSelectedCompanies = (ids = []) => {
    const normalized = Array.isArray(ids) ? ids.map(normalizeId).filter(Boolean) : [];
    state.pendingSelectedCompanies = new Set(normalized);
    if (!elements.companiesContainer) return;

    const checkboxes = elements.companiesContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      const shouldCheck = state.pendingSelectedCompanies.has(checkbox.value);
      checkbox.checked = shouldCheck;
    });

    setCompanyStatus(
      state.pendingSelectedCompanies.size
        ? `Empresas selecionadas: ${state.pendingSelectedCompanies.size}`
        : 'Selecione uma ou mais empresas para vincular a conta.',
      false
    );
  };

  const readSelectedCompanies = () => {
    if (!elements.companiesContainer) return [];
    const checkboxes = elements.companiesContainer.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map((checkbox) => normalizeId(checkbox.value)).filter(Boolean);
  };

  const renderCompanies = () => {
    if (!elements.companiesContainer) return;

    if (!state.companies.length) {
      elements.companiesContainer.innerHTML = '';
      setCompanyStatus('Nenhuma empresa encontrada. Cadastre uma empresa antes de criar contas contábeis.', false);
      return;
    }

    const fragment = document.createDocumentFragment();
    state.companies.forEach((company) => {
      const id = normalizeId(company._id);
      const label = company.nome || company.nomeFantasia || company.razaoSocial || 'Empresa sem nome';
      const checkboxId = `account-company-${id}`;

      const wrapper = document.createElement('label');
      wrapper.className =
        'flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-primary transition';
      wrapper.setAttribute('for', checkboxId);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = checkboxId;
      input.value = id;
      input.name = 'companies';
      input.className = 'text-primary focus:ring-primary';
      input.checked = state.pendingSelectedCompanies.has(id);

      const span = document.createElement('span');
      span.textContent = label;

      wrapper.appendChild(input);
      wrapper.appendChild(span);
      fragment.appendChild(wrapper);
    });

    elements.companiesContainer.innerHTML = '';
    elements.companiesContainer.appendChild(fragment);

    if (state.pendingSelectedCompanies.size) {
      setCompanyStatus(
        `Empresas selecionadas: ${state.pendingSelectedCompanies.size}`,
        false
      );
    } else {
      setCompanyStatus('Selecione uma ou mais empresas para vincular a conta.', false);
    }
  };

  const describeCompany = (company) => {
    if (!company) return '';
    if (typeof company === 'string') return company;
    return company.nome || company.nomeFantasia || company.razaoSocial || company.cnpj || 'Empresa';
  };

  const typeDescriptions = {
    analitica: 'Analítica',
    sintetica: 'Sintética',
  };

  const accountingOriginDescriptions = {
    receita: 'Receita',
    despesa: 'Despesa',
    ativo: 'Ativo',
    passivo: 'Passivo',
    resultado: 'Resultado',
    encerramento: 'Encerramento',
    transferencia: 'Transferência',
  };

  const costClassificationDescriptions = {
    fixo: 'Fixo',
    variavel: 'Variável',
    cmv: 'CMV',
    impostos: 'Impostos',
    outros: 'Outros',
  };

  const systemOriginDescriptions = {
    '0': '0 - Vendas',
    '1': '1 - Entrada de Produtos',
    '2': '2 - Contas a Pagar',
    '3': '3 - Contas a Receber',
    '4': '4 - Devoluções',
  };

  const paymentNatureDescriptions = {
    contas_pagar: 'Contas a Pagar',
    contas_receber: 'Contas a Receber',
  };

  const statusDescriptions = {
    ativa: 'Ativa',
    inativa: 'Inativa',
  };

  const renderAccounts = () => {
    if (!elements.tableBody) return;

    if (!state.accounts.length) {
      elements.tableBody.innerHTML = `<tr><td colspan="8" class="px-4 py-6 text-center text-sm text-gray-500">Nenhuma conta contábil cadastrada até o momento.</td></tr>`;
      return;
    }

    const rows = state.accounts.map((account) => {
      const id = normalizeId(account._id);
      const companies = Array.isArray(account.companies) ? account.companies : [];
      const companiesLabel = companies.map(describeCompany).filter(Boolean).join(', ');
      const type = typeDescriptions[account.type] || '—';
      const origin = accountingOriginDescriptions[account.accountingOrigin] || '—';
      const cost = costClassificationDescriptions[account.costClassification] || '—';
      const systemOrigin = systemOriginDescriptions[account.systemOrigin] || '—';
      const spedInfo = account.spedCode ? `<div class="text-xs text-gray-500">SPED: ${escapeHtml(account.spedCode)}</div>` : '';
      const paymentNature = paymentNatureDescriptions[account.paymentNature] || '';
      const statusLabel = statusDescriptions[account.status] || '—';
      const statusBadgeClass = account.status === 'inativa' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700';

      return `
        <tr>
          <td class="px-4 py-3 align-top">
            <div class="font-medium text-gray-900">${escapeHtml(companiesLabel || '—')}</div>
          </td>
          <td class="px-4 py-3 align-top">
            <div class="font-medium text-gray-900">${escapeHtml(account.name || '—')}</div>
            ${paymentNature ? `<div class="text-xs text-gray-500">Natureza: ${escapeHtml(paymentNature)}</div>` : ''}
            ${account.notes ? `<div class="text-xs text-gray-400 mt-1 max-w-xs truncate">${escapeHtml(account.notes)}</div>` : ''}
          </td>
          <td class="px-4 py-3 align-top">
            <div class="font-medium text-gray-900">${escapeHtml(account.code || '—')}</div>
            ${spedInfo}
          </td>
          <td class="px-4 py-3 align-top">${escapeHtml(type)}</td>
          <td class="px-4 py-3 align-top">${escapeHtml(origin)}</td>
          <td class="px-4 py-3 align-top">${escapeHtml(cost)}</td>
          <td class="px-4 py-3 align-top">${escapeHtml(systemOrigin)}</td>
          <td class="px-4 py-3 align-top text-right">
            <div class="flex items-center justify-end gap-2">
              <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass}">${escapeHtml(statusLabel)}</span>
              <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="edit" data-id="${escapeHtml(id)}">
                <i class="fas fa-edit"></i>
                Editar
              </button>
              <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition" data-action="delete" data-id="${escapeHtml(id)}">
                <i class="fas fa-trash"></i>
                Excluir
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    elements.tableBody.innerHTML = rows.join('');
  };

  const handleAuthError = () => {
    if (typeof window.showModal === 'function') {
      window.showModal({
        title: 'Sessão expirada',
        message: 'Faça login novamente para continuar gerenciando as contas contábeis.',
        confirmText: 'OK',
      });
    } else {
      notify('Sessão expirada. Faça login novamente.', 'error');
    }
  };

  const authenticatedRequest = async (path = '', options = {}) => {
    const token = getToken();
    if (!token) {
      const error = new Error('Sessão expirada. Faça login novamente.');
      error.status = 401;
      throw error;
    }

    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${ACCOUNTING_ENDPOINT}${path}`, {
      ...options,
      headers,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }

    if (!response.ok) {
      const error = new Error(data?.message || `Erro ao comunicar com o servidor (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  };

  const loadCompanies = async () => {
    if (!elements.companiesContainer) return;

    state.loadingCompanies = true;
    setCompanyStatus('Carregando empresas...', true);

    try {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/stores`, { headers });
      if (!response.ok) {
        throw new Error(`Falha ao carregar empresas (${response.status})`);
      }
      const data = await response.json();
      state.companies = Array.isArray(data) ? data : [];
      renderCompanies();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      state.companies = [];
      setCompanyStatus(error?.message || 'Erro ao carregar as empresas cadastradas.', false);
    } finally {
      state.loadingCompanies = false;
    }
  };

  const loadAccounts = async () => {
    state.loadingAccounts = true;
    setListStatus('Carregando contas contábeis...', false);

    try {
      const data = await authenticatedRequest('', { method: 'GET' });
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      state.accounts = accounts;
      if (!accounts.length) {
        setListStatus('Nenhuma conta cadastrada ainda.', false);
      } else {
        setListStatus(`Listando ${accounts.length} conta${accounts.length > 1 ? 's' : ''} contábil${
          accounts.length > 1 ? 's' : ''
        }.`, false);
      }
      renderAccounts();
    } catch (error) {
      console.error('Erro ao carregar contas contábeis:', error);
      state.accounts = [];
      renderAccounts();
      if (error.status === 401) {
        handleAuthError();
      }
      setListStatus(error?.message || 'Não foi possível carregar as contas contábeis.', true);
    } finally {
      state.loadingAccounts = false;
    }
  };

  const buildImportSummaryMessage = (summary = {}) => {
    const total = Number.isFinite(summary.totalRows) ? summary.totalRows : Number(summary.totalRows) || 0;
    const imported = Number.isFinite(summary.imported) ? summary.imported : Number(summary.imported) || 0;
    const skippedExisting = Number.isFinite(summary.skippedExisting)
      ? summary.skippedExisting
      : Number(summary.skippedExisting) || 0;
    const skippedInvalid = Number.isFinite(summary.skippedInvalid)
      ? summary.skippedInvalid
      : Number(summary.skippedInvalid) || 0;
    const skippedDuplicates = Number.isFinite(summary.skippedDuplicates)
      ? summary.skippedDuplicates
      : Number(summary.skippedDuplicates) || 0;

    const parts = [];
    if (total) {
      const importLabel = imported === 1 ? 'conta importada' : 'contas importadas';
      parts.push(`${imported} de ${total} ${importLabel}`);
    } else {
      parts.push(`${imported} conta${imported === 1 ? '' : 's'} importada${imported === 1 ? '' : 's'}`);
    }

    if (skippedExisting) {
      parts.push(`${skippedExisting} já cadastrada${skippedExisting === 1 ? '' : 's'}`);
    }
    if (skippedDuplicates) {
      parts.push(`${skippedDuplicates} duplicada${skippedDuplicates === 1 ? '' : 's'} na planilha`);
    }
    if (skippedInvalid) {
      parts.push(`${skippedInvalid} linha${skippedInvalid === 1 ? '' : 's'} com dados inválidos`);
    }

    return parts.join(' · ');
  };

  const importAccounts = async (file) => {
    if (!file || state.importing) return;

    const companies = readSelectedCompanies();
    if (!companies.length) {
      notify('Selecione ao menos uma empresa antes de importar a planilha.', 'error');
      if (elements.importInput) {
        elements.importInput.value = '';
      }
      setImportStatus('Selecione as empresas que receberão as contas antes de importar.', 'error');
      return;
    }

    setImporting(true);
    setImportStatus('Importando contas contábeis da planilha selecionada...', 'info');

    try {
      const token = getToken();
      if (!token) {
        const error = new Error('Sessão expirada. Faça login novamente.');
        error.status = 401;
        throw error;
      }

      const formData = new FormData();
      formData.append('file', file);
      companies.forEach((id) => formData.append('companies', id));

      const response = await fetch(`${ACCOUNTING_ENDPOINT}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.error('Não foi possível interpretar a resposta de importação.', parseError);
        }
      }

      if (!response.ok) {
        const error = new Error(data?.message || `Falha ao importar planilha (${response.status})`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      if (Array.isArray(data?.errors) && data.errors.length) {
        console.warn('Linhas ignoradas durante a importação:', data.errors);
      }

      const summaryMessage = buildImportSummaryMessage(data?.summary);
      const toastMessage = summaryMessage
        ? `Importação concluída: ${summaryMessage}.`
        : 'Importação de contas contábeis concluída.';
      setImportStatus(summaryMessage || 'Importação concluída.', 'success');
      notify(toastMessage, 'success');

      await loadAccounts();
    } catch (error) {
      console.error('Erro ao importar contas contábeis:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      const message = error?.message || 'Não foi possível importar as contas contábeis.';
      setImportStatus(message, 'error');
      notify(message, 'error');
    } finally {
      setImporting(false);
      if (elements.importInput) {
        elements.importInput.value = '';
      }
    }
  };

  const handleImportChange = (event) => {
    const file = event?.target?.files?.[0];
    if (file) {
      importAccounts(file);
    }
  };

  const handleImportClick = () => {
    if (state.importing) return;
    if (elements.importInput) {
      elements.importInput.click();
    }
  };

  const setFormSaving = (saving) => {
    state.saving = saving;
    if (elements.submitButton) {
      elements.submitButton.disabled = saving;
      elements.submitButton.classList.toggle('opacity-60', saving);
      elements.submitButton.classList.toggle('cursor-not-allowed', saving);
    }
    if (elements.resetButton) {
      elements.resetButton.disabled = saving;
      elements.resetButton.classList.toggle('opacity-60', saving);
      elements.resetButton.classList.toggle('cursor-not-allowed', saving);
    }
    if (elements.submitLabel) {
      elements.submitLabel.textContent = saving
        ? state.editingId
          ? 'Atualizando...'
          : 'Salvando...'
        : state.editingId
        ? 'Atualizar conta'
        : 'Salvar conta';
    }
  };

  const extractFormData = () => {
    const companies = readSelectedCompanies();
    const name = elements.name ? elements.name.value.trim() : '';
    const code = elements.code ? elements.code.value.trim() : '';
    const spedCode = elements.spedCode ? elements.spedCode.value.trim() : '';
    const accountingOrigin = elements.accountingOrigin ? elements.accountingOrigin.value.trim() : '';
    const costClassification = elements.costClassification ? elements.costClassification.value.trim() : '';
    const systemOrigin = elements.systemOrigin ? elements.systemOrigin.value.trim() : '';
    const paymentNature = elements.paymentNature ? elements.paymentNature.value.trim() : '';
    const status = elements.status ? elements.status.value.trim() : 'ativa';
    const notes = elements.notes ? elements.notes.value.trim() : '';

    let type = '';
    if (Array.isArray(elements.accountTypeRadios)) {
      const checkedRadio = elements.accountTypeRadios.find((radio) => radio.checked);
      type = checkedRadio ? checkedRadio.value.trim() : '';
    }

    return {
      companies,
      name,
      code,
      spedCode,
      type,
      accountingOrigin,
      costClassification,
      systemOrigin,
      paymentNature,
      status,
      notes,
    };
  };

  const validatePayload = (payload) => {
    if (!payload.name) {
      throw new Error('Informe o nome da conta contábil.');
    }
    if (!payload.code) {
      throw new Error('Informe o código contábil.');
    }
    if (!payload.type) {
      throw new Error('Selecione o tipo da conta.');
    }
    if (!payload.companies.length) {
      throw new Error('Selecione ao menos uma empresa para vincular a conta.');
    }
  };

  const resetForm = () => {
    if (elements.form) {
      elements.form.reset();
    }
    setSelectedCompanies([]);
    if (elements.formIdField) {
      elements.formIdField.value = '';
    }
    state.editingId = null;
    setFormMode('create');
  };

  const fillForm = (account) => {
    if (!account) return;
    if (elements.formIdField) {
      elements.formIdField.value = normalizeId(account._id);
    }
    if (elements.name) {
      elements.name.value = account.name || '';
    }
    if (elements.code) {
      elements.code.value = account.code || '';
    }
    if (elements.spedCode) {
      elements.spedCode.value = account.spedCode || '';
    }
    if (elements.notes) {
      elements.notes.value = account.notes || '';
    }
    if (elements.accountingOrigin) {
      elements.accountingOrigin.value = account.accountingOrigin || '';
    }
    if (elements.costClassification) {
      elements.costClassification.value = account.costClassification || '';
    }
    if (elements.systemOrigin) {
      elements.systemOrigin.value = account.systemOrigin || '';
    }
    if (elements.paymentNature) {
      elements.paymentNature.value = account.paymentNature || '';
    }
    if (elements.status) {
      elements.status.value = account.status || 'ativa';
    }
    if (Array.isArray(elements.accountTypeRadios)) {
      elements.accountTypeRadios.forEach((radio) => {
        radio.checked = radio.value === account.type;
      });
    }
    const companyIds = Array.isArray(account.companies)
      ? account.companies.map((company) => normalizeId(company._id || company))
      : [];
    setSelectedCompanies(companyIds);
  };

  const submitForm = async (event) => {
    event.preventDefault();
    if (state.saving) return;

    try {
      const payload = extractFormData();
      validatePayload(payload);

      setFormSaving(true);

      if (state.editingId) {
        await authenticatedRequest(`/${state.editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('Conta contábil atualizada com sucesso.', 'success');
      } else {
        await authenticatedRequest('', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Conta contábil criada com sucesso.', 'success');
      }

      resetForm();
      await loadAccounts();
    } catch (error) {
      console.error('Erro ao salvar conta contábil:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      notify(error?.message || 'Não foi possível salvar a conta contábil.', 'error');
    } finally {
      setFormSaving(false);
    }
  };

  const startEditingAccount = (accountId) => {
    const id = normalizeId(accountId);
    if (!id) return;

    const account = state.accounts.find((item) => normalizeId(item._id) === id);
    if (!account) {
      notify('Conta contábil não encontrada para edição.', 'error');
      return;
    }

    state.editingId = id;
    setFormMode('edit');
    fillForm(account);
    notify('Conta contábil carregada para edição.', 'info');
  };

  const deleteAccount = async (accountId) => {
    const id = normalizeId(accountId);
    if (!id || state.deletingIds.has(id)) return;

    state.deletingIds.add(id);
    setListStatus('Removendo conta contábil selecionada...', false);

    try {
      await authenticatedRequest(`/${id}`, { method: 'DELETE' });
      notify('Conta contábil excluída com sucesso.', 'success');
      if (state.editingId === id) {
        resetForm();
      }
      await loadAccounts();
    } catch (error) {
      console.error('Erro ao excluir conta contábil:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      notify(error?.message || 'Não foi possível excluir a conta contábil.', 'error');
  } finally {
    state.deletingIds.delete(id);
  }
};

  const confirmDeleteAccount = (accountId) => {
    const id = normalizeId(accountId);
    if (!id) return;

    const account = state.accounts.find((item) => normalizeId(item._id) === id);
    const accountName = account?.name ? `"${account.name}"` : 'selecionada';
    const message = `Deseja realmente excluir a conta contábil ${accountName}?\n\nEssa ação não poderá ser desfeita.`;

    if (typeof window.showModal === 'function') {
      window.showModal({
        title: 'Excluir conta contábil',
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
    const button = event.target.closest('[data-action]');
    if (!button || !elements.tableBody?.contains(button)) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    if (!action || !id) return;

    event.preventDefault();

    if (action === 'edit') {
      startEditingAccount(id);
    } else if (action === 'delete') {
      confirmDeleteAccount(id);
    }
  };

  const handleResetClick = () => {
    resetForm();
    notify('Formulário limpo.', 'info');
  };

  const registerEventListeners = () => {
    if (elements.form) {
      elements.form.addEventListener('submit', submitForm);
    }
    if (elements.resetButton) {
      elements.resetButton.addEventListener('click', handleResetClick);
    }
    if (elements.tableBody) {
      elements.tableBody.addEventListener('click', handleTableClick);
    }
    if (elements.companiesContainer) {
      elements.companiesContainer.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement)) return;
        if (event.target.type !== 'checkbox') return;
        const selected = readSelectedCompanies();
        setCompanyStatus(
          selected.length
            ? `Empresas selecionadas: ${selected.length}`
            : 'Selecione uma ou mais empresas para vincular a conta.',
          false
        );
      });
    }
    if (elements.importButton) {
      elements.importButton.addEventListener('click', handleImportClick);
    }
    if (elements.importInput) {
      elements.importInput.addEventListener('change', handleImportChange);
    }
  };

  const init = async () => {
    initElements();
    setFormMode('create');
    setImportStatus('Selecione uma planilha Excel (.xlsx) com as contas contábeis a importar.', 'info');
    registerEventListeners();
    await loadCompanies();
    await loadAccounts();
  };

  if (document.readyState === 'loading') {
    init();
  } else {
    init();
  }
}


if (!window.__EOBICHO_ADMIN_VIEWS__) {
  window.__EOBICHO_ADMIN_VIEWS__ = {};
}
window.__EOBICHO_ADMIN_VIEWS__['admin-financeiro-contabil-cadastro-conta-contabil'] = initAdminFinanceiroContabilCadastroContaContabil;

if (!window.AdminSPA) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminFinanceiroContabilCadastroContaContabil, { once: true });
  } else {
    initAdminFinanceiroContabilCadastroContaContabil();
  }
}
