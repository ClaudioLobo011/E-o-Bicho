(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const SUPPLIERS_ENDPOINT = `${API_BASE}/suppliers`;
  const SUPPLIERS_NEXT_CODE_ENDPOINT = `${SUPPLIERS_ENDPOINT}/next-code`;
  const SUPPLIERS_LOOKUP_ENDPOINT = `${SUPPLIERS_ENDPOINT}/lookup-document`;
  const STORES_ENDPOINT = `${API_BASE}/stores`;
  const ACCOUNTING_ENDPOINT = `${API_BASE}/accounting-accounts`;
  const BANKS_DATA_URL = '../../data/bancos.json';
  const RETENTION_TYPES = ['IR', 'CSLL', 'COFINS', 'PIS', 'ISS', 'CPRB', 'INSS'];
  const TYPE_LABELS = {
    fisico: 'Físico',
    juridico: 'Jurídico',
    mei: 'MEI',
    'produtor-rural': 'Produtor Rural',
  };

  const selectors = {
    form: '#supplier-form',
    saveButton: '#supplier-save-button',
    codeInput: '#supplier-code',
    codeStatus: '#supplier-code-status',
    country: '#supplier-country',
    legalName: '#supplier-legal-name',
    fantasyName: '#supplier-fantasy-name',
    cnpj: '#supplier-cnpj',
    documentLabel: '#supplier-document-label',
    documentStatus: '#supplier-document-status',
    stateRegistration: '#supplier-ie',
    typeRadios: 'input[name="supplier-type"]',
    companiesSelect: '#supplier-companies',
    companiesStatus: '#supplier-companies-status',
    flagInactive: '#supplier-flag-inactive',
    flagOng: '#supplier-flag-ong',
    flagBank: '#supplier-flag-bank',
    cep: '#supplier-cep',
    cepStatus: '#supplier-cep-status',
    logradouro: '#supplier-logradouro',
    numero: '#supplier-numero',
    complemento: '#supplier-complemento',
    bairro: '#supplier-bairro',
    cidade: '#supplier-cidade',
    uf: '#supplier-uf',
    email: '#supplier-email',
    phone: '#supplier-phone',
    mobile: '#supplier-mobile',
    secondaryPhone: '#supplier-secondary-phone',
    responsible: '#supplier-responsible',
    supplierKind: '#supplier-kind',
    chartAccount: '#supplier-chart-account',
    chartAccountStatus: '#supplier-chart-account-status',
    icms: '#supplier-icms',
    observation: '#supplier-observation',
    bank: '#supplier-bank',
    agency: '#supplier-agency',
    account: '#supplier-account',
    representativesList: '#representatives-list',
    addRepresentative: '#add-representative',
    representativeName: '#representative-name',
    representativeMobile: '#representative-mobile',
    representativeEmail: '#representative-email',
    retencoesHidden: '#retencoes-selecionadas',
    retencaoButtons: '.retencao-button',
    tabButtons: '.tab-button',
    tabPanels: '[data-tab-panel]',
    filterInputs: '.filter-input',
    sortButtons: '.sort-button',
    suppliersTableBody: '#suppliers-table-body',
    suppliersTableStatus: '#suppliers-table-status',
  };

  const state = {
    retencoes: new Set(),
    representatives: [],
    suppliers: [],
    filters: {
      codigo: '',
      razaoSocial: '',
      nomeFantasia: '',
      cnpj: '',
      pais: '',
      tipo: '',
      empresas: '',
    },
    sort: {
      column: 'codigo',
      direction: 'asc',
    },
    loadingSuppliers: false,
    loadingCompanies: false,
    loadingAccounts: false,
    saving: false,
    currentCep: '',
    cepAbort: null,
    currentDocumentLookupKey: '',
    documentLookupAbort: null,
  };

  const elements = {};
  const masks = {};

  const initElements = () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      if (!selector) {
        elements[key] = null;
        return;
      }

      if (key === 'typeRadios') {
        elements[key] = Array.from(document.querySelectorAll(selector));
      } else if (key === 'retencaoButtons') {
        elements[key] = Array.from(document.querySelectorAll(selector));
      } else if (key === 'tabButtons' || key === 'tabPanels' || key === 'filterInputs' || key === 'sortButtons') {
        elements[key] = Array.from(document.querySelectorAll(selector));
      } else {
        elements[key] = document.querySelector(selector);
      }
    });
  };

  const destroyMask = (key) => {
    if (masks[key] && typeof masks[key].destroy === 'function') {
      masks[key].destroy();
    }
    masks[key] = null;
  };

  const applyMask = (key, element, options) => {
    if (typeof IMask === 'undefined' || !element) {
      return null;
    }
    destroyMask(key);
    masks[key] = IMask(element, { ...options });
    return masks[key];
  };

  const getMaskDigits = (key, fallback = '') => {
    if (masks[key]) {
      return masks[key].unmaskedValue || '';
    }
    return digitsOnly(fallback);
  };

  const setMaskedDigits = (key, element, value) => {
    if (!element) return;
    const digits = digitsOnly(value);
    if (masks[key]) {
      masks[key].unmaskedValue = digits;
    } else {
      element.value = digits;
    }
  };

  const getCurrentSupplierType = () => {
    const selected = elements.typeRadios?.find?.((radio) => radio.checked);
    return selected?.value || 'juridico';
  };

  const getDocumentLabel = (type) => (type === 'fisico' ? 'CPF' : 'CNPJ');

  const getDocumentLookupKey = (type, digits) => `${type}:${digits}`;

  const getDocumentInstruction = (type) =>
    type === 'fisico'
      ? 'Informe os 11 dígitos do CPF para preencher os dados automaticamente.'
      : 'Informe os 14 dígitos do CNPJ para preencher os dados automaticamente.';

  const updateDocumentFieldForType = () => {
    const type = getCurrentSupplierType();
    const label = getDocumentLabel(type);
    if (elements.documentLabel) {
      elements.documentLabel.textContent = label;
    }
    if (!elements.cnpj) return;
    const digits = digitsOnly(elements.cnpj.value);
    const requiredDigits = type === 'fisico' ? 11 : 14;
    const limitedDigits = type === 'fisico' ? digits.slice(0, 11) : digits.slice(0, 14);
    const maskPattern = type === 'fisico' ? '000.000.000-00' : '00.000.000/0000-00';
    elements.cnpj.setAttribute('placeholder', maskPattern);
    const mask = applyMask('document', elements.cnpj, {
      mask: maskPattern,
      lazy: true,
    });
    if (mask) {
      mask.unmaskedValue = limitedDigits;
    } else {
      elements.cnpj.value = limitedDigits;
    }
    if (!limitedDigits || limitedDigits.length < requiredDigits) {
      setDocumentStatus(getDocumentInstruction(type));
    }
  };

  const createPhoneMaskOptions = () => ({
    mask: [
      { mask: '(00) 0000-0000' },
      { mask: '(00) 00000-0000' },
    ],
    dispatch: function (appended, dynamicMasked) {
      const number = (dynamicMasked.unmaskedValue + appended).replace(/\D+/g, '');
      return dynamicMasked.compiledMasks[number.length > 10 ? 1 : 0];
    },
  });

  const initializeMasks = () => {
    if (typeof IMask === 'undefined') {
      console.warn('Biblioteca IMask não carregada; os campos permanecerão sem máscara.');
      return;
    }
    if (elements.cep) {
      const digits = digitsOnly(elements.cep.value).slice(0, 8);
      const mask = applyMask('cep', elements.cep, { mask: '00000-000', lazy: true });
      if (mask) {
        mask.unmaskedValue = digits;
      }
    }
    const phoneMaskFactory = () => createPhoneMaskOptions();
    ['phone', 'mobile', 'secondaryPhone', 'representativeMobile'].forEach((key) => {
      const element = elements[key];
      if (!element) return;
      const digits = digitsOnly(element.value).slice(0, 11);
      const mask = applyMask(key, element, phoneMaskFactory());
      if (mask) {
        mask.unmaskedValue = digits;
      }
    });
    updateDocumentFieldForType();
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

  const handleAuthError = () => {
    notify('Sessão expirada. Faça login novamente para continuar.', 'error');
  };

  const request = async (url, options = {}, { requiresAuth = false } = {}) => {
    const opts = { ...options };
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});

    if (requiresAuth) {
      const token = getToken();
      if (!token) {
        const error = new Error('Sessão expirada. Faça login novamente.');
        error.status = 401;
        throw error;
      }
      opts.headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, opts);
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

  const digitsOnly = (value) => String(value ?? '').replace(/\D+/g, '');

  const normalizeString = (value) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  const formatDocumentNumber = (value) => {
    const digits = digitsOnly(value).slice(0, 14);
    if (digits.length === 11) {
      return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
    }
    if (digits.length === 14) {
      return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
    }
    return digits;
  };

  const formatPhoneNumber = (value) => {
    const digits = digitsOnly(value);
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 9) {
      return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    }
    return digits;
  };

  const setCompanyStatus = (message, type = 'info') => {
    if (!elements.companiesStatus) return;
    elements.companiesStatus.textContent = message || '';
    elements.companiesStatus.classList.remove('text-red-600', 'text-gray-500');
    if (type === 'error') {
      elements.companiesStatus.classList.add('text-red-600');
    } else {
      elements.companiesStatus.classList.add('text-gray-500');
    }
  };

  const setChartAccountStatus = (message, type = 'info') => {
    if (!elements.chartAccountStatus) return;
    elements.chartAccountStatus.textContent = message || '';
    elements.chartAccountStatus.classList.remove('text-red-600', 'text-gray-500');
    if (type === 'error') {
      elements.chartAccountStatus.classList.add('text-red-600');
    } else {
      elements.chartAccountStatus.classList.add('text-gray-500');
    }
  };

  const setDocumentStatus = (message, type = 'info') => {
    if (!elements.documentStatus) return;
    elements.documentStatus.textContent = message || '';
    elements.documentStatus.classList.remove('text-red-600', 'text-gray-500', 'text-emerald-600', 'text-amber-600');
    if (type === 'error') {
      elements.documentStatus.classList.add('text-red-600');
    } else if (type === 'success') {
      elements.documentStatus.classList.add('text-emerald-600');
    } else if (type === 'warning') {
      elements.documentStatus.classList.add('text-amber-600');
    } else {
      elements.documentStatus.classList.add('text-gray-500');
    }
  };

  const setCepStatus = (message, type = 'info') => {
    if (!elements.cepStatus) return;
    elements.cepStatus.textContent = message || '';
    elements.cepStatus.classList.remove('text-red-600', 'text-gray-500', 'text-emerald-600');
    if (type === 'error') {
      elements.cepStatus.classList.add('text-red-600');
    } else if (type === 'success') {
      elements.cepStatus.classList.add('text-emerald-600');
    } else {
      elements.cepStatus.classList.add('text-gray-500');
    }
  };

  const setSuppliersTableStatus = (message, type = 'info') => {
    if (!elements.suppliersTableStatus) return;
    elements.suppliersTableStatus.textContent = message || '';
    elements.suppliersTableStatus.classList.remove('text-red-600', 'text-gray-500');
    if (type === 'error') {
      elements.suppliersTableStatus.classList.add('text-red-600');
    } else {
      elements.suppliersTableStatus.classList.add('text-gray-500');
    }
  };

  const setSupplierCode = (value, { pending = false } = {}) => {
    if (elements.codeInput) {
      elements.codeInput.value = value || 'Gerado automaticamente';
    }
    if (elements.codeStatus) {
      if (pending) {
        elements.codeStatus.textContent = value
          ? `Próximo código sugerido: ${value}. Será confirmado ao salvar o cadastro.`
          : 'Gerado automaticamente após salvar o cadastro.';
      } else {
        elements.codeStatus.textContent = value
          ? `Código confirmado: ${value}.`
          : 'Gerado automaticamente após salvar o cadastro.';
      }
    }
  };

  const mapCompanyName = (company = {}) =>
    company.nomeFantasia || company.nome || company.razaoSocial || company.cnpj || '';

  const mapSupplierToTable = (supplier = {}) => {
    const companies = Array.isArray(supplier.companies) ? supplier.companies : [];
    const companyNames = companies.map(mapCompanyName).filter(Boolean);
    return {
      id: supplier._id,
      code: supplier.code || '',
      legalName: supplier.legalName || '',
      fantasyName: supplier.fantasyName || '',
      cnpj: supplier.cnpj || '',
      cnpjFormatted: formatDocumentNumber(supplier.cnpj),
      country: supplier.country || '',
      type: supplier.type || '',
      typeLabel: TYPE_LABELS[supplier.type] || supplier.type || '',
      companyNames,
    };
  };

  const renderSuppliers = () => {
    if (!elements.suppliersTableBody) return;
    const columnMap = {
      codigo: (supplier) => supplier.code,
      razaoSocial: (supplier) => supplier.legalName,
      nomeFantasia: (supplier) => supplier.fantasyName,
      cnpj: (supplier) => {
        const formatted = supplier.cnpjFormatted || supplier.cnpj || '';
        const rawDigits = digitsOnly(formatted);
        return `${formatted} ${rawDigits}`.trim();
      },
      pais: (supplier) => supplier.country,
      tipo: (supplier) => supplier.typeLabel,
      empresas: (supplier) => supplier.companyNames.join(', '),
    };

    const filtered = state.suppliers.filter((supplier) =>
      Object.entries(state.filters).every(([column, query]) => {
        if (!query) return true;
        const getter = columnMap[column];
        const value = getter ? getter(supplier) : '';
        return normalizeString(value).includes(normalizeString(query));
      })
    );

    const sorted = [...filtered].sort((a, b) => {
      const column = state.sort.column;
      const direction = state.sort.direction === 'desc' ? -1 : 1;
      if (column === 'codigo') {
        const codeA = Number.parseInt(a.code, 10) || 0;
        const codeB = Number.parseInt(b.code, 10) || 0;
        if (codeA === codeB) return 0;
        return codeA > codeB ? direction : -direction;
      }
      const getter = columnMap[column];
      const valueA = getter ? normalizeString(getter(a)) : '';
      const valueB = getter ? normalizeString(getter(b)) : '';
      if (valueA === valueB) return 0;
      return valueA > valueB ? direction : -direction;
    });

    if (!sorted.length) {
      elements.suppliersTableBody.innerHTML =
        '<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-gray-500">Nenhum fornecedor encontrado com os filtros aplicados.</td></tr>';
      setSuppliersTableStatus('Nenhum fornecedor cadastrado até o momento.', 'info');
      return;
    }

    const rows = sorted
      .map((supplier) => {
        const companies = supplier.companyNames.join(', ');
        return `
          <tr class="hover:bg-gray-50 transition">
            <td class="px-4 py-3 whitespace-nowrap font-semibold text-gray-700">${supplier.code || '—'}</td>
            <td class="px-4 py-3 text-gray-700">${supplier.legalName || '—'}</td>
            <td class="px-4 py-3 text-gray-600">${supplier.fantasyName || '—'}</td>
            <td class="px-4 py-3 text-gray-700">${supplier.cnpjFormatted || supplier.cnpj || '—'}</td>
            <td class="px-4 py-3 text-gray-600">${supplier.country || '—'}</td>
            <td class="px-4 py-3 text-gray-600">${supplier.typeLabel || '—'}</td>
            <td class="px-4 py-3 text-gray-600">${companies || '—'}</td>
          </tr>
        `;
      })
      .join('');

    elements.suppliersTableBody.innerHTML = rows;
    setSuppliersTableStatus(
      `Listando ${sorted.length} fornecedor${sorted.length === 1 ? '' : 'es'} cadastrado${sorted.length === 1 ? '' : 's'}.`,
      'info'
    );
  };

  const updateSortIndicators = () => {
    if (!Array.isArray(elements.sortButtons)) return;
    elements.sortButtons.forEach((button) => {
      const icon = button.querySelector('i');
      if (!icon) return;
      icon.classList.remove('fa-sort-up', 'fa-sort-down', 'text-primary');
      icon.classList.add('fa-sort', 'text-gray-400');
      const column = button.dataset.sort;
      if (state.sort.column === column) {
        icon.classList.remove('fa-sort', 'text-gray-400');
        icon.classList.add(state.sort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down', 'text-primary');
      }
    });
  };

  const applyFiltersAndSort = () => {
    updateSortIndicators();
    renderSuppliers();
  };

  const loadSuppliers = async () => {
    if (state.loadingSuppliers) return;
    state.loadingSuppliers = true;
    setSuppliersTableStatus('Carregando fornecedores cadastrados...', 'info');
    try {
      const data = await request(SUPPLIERS_ENDPOINT, { method: 'GET' }, { requiresAuth: true });
      const suppliers = Array.isArray(data?.suppliers) ? data.suppliers : [];
      state.suppliers = suppliers.map(mapSupplierToTable);
      if (!suppliers.length) {
        elements.suppliersTableBody.innerHTML =
          '<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-gray-500">Nenhum fornecedor cadastrado até o momento.</td></tr>';
        setSuppliersTableStatus('Nenhum fornecedor cadastrado até o momento.', 'info');
      } else {
        applyFiltersAndSort();
      }
    } catch (error) {
      console.error('Erro ao carregar fornecedores:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      elements.suppliersTableBody.innerHTML =
        '<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-red-600">Erro ao carregar os fornecedores cadastrados.</td></tr>';
      setSuppliersTableStatus(error?.message || 'Não foi possível carregar os fornecedores cadastrados.', 'error');
    } finally {
      state.loadingSuppliers = false;
    }
  };

  const loadNextSupplierCode = async () => {
    try {
      const data = await request(SUPPLIERS_NEXT_CODE_ENDPOINT, { method: 'GET' }, { requiresAuth: true });
      if (data?.nextCode) {
        setSupplierCode(data.nextCode, { pending: true });
      }
    } catch (error) {
      console.error('Erro ao buscar próximo código de fornecedor:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      setSupplierCode('Gerado automaticamente', { pending: true });
    }
  };

  const loadCompanies = async () => {
    if (state.loadingCompanies) return;
    state.loadingCompanies = true;
    setCompanyStatus('Carregando empresas cadastradas...', 'info');
    if (elements.companiesSelect) {
      elements.companiesSelect.innerHTML = '<option value="" disabled>Carregando empresas...</option>';
    }
    try {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(STORES_ENDPOINT, { headers });
      if (!response.ok) {
        throw new Error(`Falha ao carregar empresas (${response.status})`);
      }
      const data = await response.json();
      const stores = Array.isArray(data) ? data : [];
      if (elements.companiesSelect) {
        if (!stores.length) {
          elements.companiesSelect.innerHTML = '<option value="" disabled>Nenhuma empresa cadastrada</option>';
          setCompanyStatus('Cadastre empresas para vinculá-las aos fornecedores.', 'info');
        } else {
          const options = stores
            .map((store) => {
              const name = mapCompanyName(store) || 'Empresa sem nome';
              return `<option value="${store._id}">${name}</option>`;
            })
            .join('');
          elements.companiesSelect.innerHTML = options;
          setCompanyStatus('Selecione todas as empresas nas quais o fornecedor atua.', 'info');
        }
      }
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      if (elements.companiesSelect) {
        elements.companiesSelect.innerHTML = '<option value="" disabled>Erro ao carregar empresas</option>';
      }
      setCompanyStatus(error?.message || 'Erro ao carregar as empresas cadastradas.', 'error');
    } finally {
      state.loadingCompanies = false;
    }
  };

  const loadAccountingAccounts = async () => {
    if (state.loadingAccounts) return;
    state.loadingAccounts = true;
    setChartAccountStatus('Carregando contas contábeis...', 'info');
    if (elements.chartAccount) {
      elements.chartAccount.innerHTML = '<option value="">Carregando contas contábeis...</option>';
    }
    try {
      const data = await request(ACCOUNTING_ENDPOINT, { method: 'GET' }, { requiresAuth: true });
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      if (!accounts.length) {
        if (elements.chartAccount) {
          elements.chartAccount.innerHTML = '<option value="">Nenhuma conta contábil cadastrada</option>';
        }
        setChartAccountStatus('Cadastre uma conta contábil para vinculá-la ao fornecedor.', 'info');
      } else if (elements.chartAccount) {
        const options = [
          '<option value="">Selecione uma conta contábil</option>',
          ...accounts.map((account) => {
            const label = `${account.code || ''} - ${account.name || ''}`.trim();
            return `<option value="${account._id}">${label}</option>`;
          }),
        ].join('');
        elements.chartAccount.innerHTML = options;
        setChartAccountStatus('Selecione a conta contábil vinculada ao fornecedor.', 'info');
      }
    } catch (error) {
      console.error('Erro ao carregar contas contábeis:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      if (elements.chartAccount) {
        elements.chartAccount.innerHTML = '<option value="">Erro ao carregar contas contábeis</option>';
      }
      setChartAccountStatus(error?.message || 'Erro ao carregar as contas contábeis.', 'error');
    } finally {
      state.loadingAccounts = false;
    }
  };

  const loadBanks = async () => {
    if (!elements.bank) return;
    try {
      const response = await fetch(BANKS_DATA_URL);
      if (!response.ok) {
        throw new Error(`Falha ao carregar bancos (${response.status})`);
      }
      const banks = await response.json();
      const sorted = Array.isArray(banks)
        ? banks.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
        : [];
      elements.bank.innerHTML = '<option value="">Selecione um banco</option>';
      sorted.forEach((bank) => {
        const option = document.createElement('option');
        const code = bank.code ? String(bank.code).padStart(3, '0') : '---';
        option.value = bank.ispb || bank.code || bank.name || '';
        option.textContent = `${code} - ${bank.name}`;
        elements.bank.appendChild(option);
      });
    } catch (error) {
      console.error('Erro ao carregar bancos:', error);
      elements.bank.innerHTML = '<option value="">Não foi possível carregar os bancos</option>';
    }
  };

  const updateRetencoesHiddenField = () => {
    if (elements.retencoesHidden) {
      elements.retencoesHidden.value = Array.from(state.retencoes).join(',');
    }
  };

  const setupRetentionButtons = () => {
    if (!Array.isArray(elements.retencaoButtons)) return;
    elements.retencaoButtons.forEach((button) => {
      button.classList.add(
        'rounded-lg',
        'border',
        'px-4',
        'py-2',
        'text-sm',
        'font-semibold',
        'transition-colors',
        'border-gray-200',
        'text-gray-700',
        'bg-gray-50'
      );
      button.addEventListener('click', () => {
        const value = button.dataset.retencao;
        if (!value || !RETENTION_TYPES.includes(value)) return;
        if (state.retencoes.has(value)) {
          state.retencoes.delete(value);
          button.classList.remove('bg-primary', 'text-white', 'border-primary');
          button.classList.add('border-gray-200');
        } else {
          state.retencoes.add(value);
          button.classList.add('bg-primary', 'text-white', 'border-primary');
          button.classList.remove('border-gray-200');
        }
        updateRetencoesHiddenField();
      });
    });
  };

  const renderRepresentatives = () => {
    if (!elements.representativesList) return;
    if (!state.representatives.length) {
      elements.representativesList.innerHTML =
        '<p class="text-sm text-gray-500">Nenhum representante cadastrado até o momento.</p>';
      return;
    }
    elements.representativesList.innerHTML = '';
    state.representatives.forEach((rep, index) => {
      const card = document.createElement('div');
      card.className =
        'rounded-lg border border-gray-200 bg-white p-4 shadow-sm flex flex-col gap-2 md:flex-row md:items-center md:justify-between';
      card.innerHTML = `
        <div>
          <p class="text-sm font-semibold text-gray-800">${rep.name || 'Nome não informado'}</p>
          <p class="text-xs text-gray-600">${formatPhoneNumber(rep.mobile) || 'Sem celular informado'} • ${rep.email || 'Sem e-mail informado'}</p>
        </div>
        <button type="button" class="text-xs text-red-600 font-semibold hover:underline" data-index="${index}">Remover</button>
      `;
      const removeButton = card.querySelector('button');
      if (removeButton) {
        removeButton.addEventListener('click', () => {
          const position = Number.parseInt(removeButton.dataset.index, 10);
          if (!Number.isNaN(position)) {
            state.representatives.splice(position, 1);
            renderRepresentatives();
          }
        });
      }
      elements.representativesList.appendChild(card);
    });
  };

  const setupRepresentatives = () => {
    renderRepresentatives();
    if (!elements.addRepresentative) return;
    elements.addRepresentative.addEventListener('click', () => {
      const name = elements.representativeName?.value.trim() || '';
      const mobile = getMaskDigits('representativeMobile', elements.representativeMobile?.value || '');
      const email = elements.representativeEmail?.value.trim() || '';
      if (!name && !mobile && !email) {
        notify('Informe ao menos um dado do representante para adicionar.', 'error');
        return;
      }
      state.representatives.push({ name, mobile, email });
      if (elements.representativeName) elements.representativeName.value = '';
      if (masks.representativeMobile) {
        masks.representativeMobile.value = '';
      } else if (elements.representativeMobile) {
        elements.representativeMobile.value = '';
      }
      if (elements.representativeEmail) elements.representativeEmail.value = '';
      renderRepresentatives();
    });
  };

  const setupTabs = () => {
    if (!Array.isArray(elements.tabButtons) || !Array.isArray(elements.tabPanels)) return;
    const activateTab = (targetId) => {
      elements.tabButtons.forEach((button) => {
        const isActive = button.dataset.tabTarget === targetId;
        button.classList.toggle('active', isActive);
        button.classList.toggle('bg-primary', isActive);
        button.classList.toggle('text-white', isActive);
        button.classList.toggle('border', true);
        button.classList.toggle('border-primary', isActive);
        button.classList.toggle('border-gray-200', !isActive);
        button.classList.toggle('bg-gray-50', !isActive);
        button.classList.toggle('text-gray-700', !isActive);
      });
      elements.tabPanels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== targetId);
      });
    };
    elements.tabButtons.forEach((button) => {
      if (!button.classList.contains('tab-button-styled')) {
        button.classList.add('tab-button-styled', 'rounded-lg', 'px-4', 'py-2', 'text-sm', 'font-semibold', 'transition-colors');
      }
      button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
    });
    activateTab('tab-endereco');
  };

  const updateTypeButtonsAppearance = () => {
    if (!Array.isArray(elements.typeRadios)) return;
    elements.typeRadios.forEach((input) => {
      const label = input.closest('[data-type-button]');
      if (!label) return;
      const isChecked = input.checked;
      label.classList.toggle('bg-primary', isChecked);
      label.classList.toggle('text-white', isChecked);
      label.classList.toggle('border-primary', isChecked);
      label.classList.toggle('border-gray-200', !isChecked);
    });
  };

  const applyTypeSelectionUpdates = () => {
    updateTypeButtonsAppearance();
    updateDocumentFieldForType();
    if (state.documentLookupAbort?.abort) {
      state.documentLookupAbort.abort();
      state.documentLookupAbort = null;
    }
    state.currentDocumentLookupKey = '';
    const type = getCurrentSupplierType();
    const digits = getMaskDigits('document', elements.cnpj?.value || '');
    const required = type === 'fisico' ? 11 : 14;
    if (!digits || digits.length < required) {
      setDocumentStatus(getDocumentInstruction(type), 'info');
    } else {
      setDocumentStatus('Documento completo. Saia do campo para consultar automaticamente.', 'info');
    }
  };

  const setupTypeButtons = () => {
    if (!Array.isArray(elements.typeRadios)) return;
    elements.typeRadios.forEach((input) => {
      const label = input.closest('[data-type-button]');
      if (!label) return;
      label.addEventListener('click', () => {
        input.checked = true;
        applyTypeSelectionUpdates();
      });
      input.addEventListener('change', () => {
        if (input.checked) {
          applyTypeSelectionUpdates();
        }
      });
    });
    applyTypeSelectionUpdates();
  };

  const resetForm = () => {
    if (elements.form) {
      elements.form.reset();
    }
    Object.keys(masks).forEach((key) => {
      if (masks[key] && typeof masks[key].value !== 'undefined') {
        masks[key].value = '';
      }
    });
    state.retencoes.clear();
    updateRetencoesHiddenField();
    state.representatives = [];
    renderRepresentatives();
    applyTypeSelectionUpdates();
    state.currentCep = '';
    if (elements.supplierKind) {
      elements.supplierKind.value = 'distribuidora';
    }
    if (elements.icms) {
      elements.icms.value = '2';
    }
    if (elements.chartAccount) {
      elements.chartAccount.value = '';
    }
    if (elements.bank) {
      elements.bank.value = '';
    }
  };

  const gatherFormData = () => {
    const typeInput = elements.typeRadios?.find?.((radio) => radio.checked);
    const selectedCompanies = elements.companiesSelect
      ? Array.from(elements.companiesSelect.selectedOptions)
          .map((option) => option.value)
          .filter(Boolean)
      : [];
    const type = typeInput?.value || 'juridico';
    const documentDigits = getMaskDigits('document', elements.cnpj?.value || '');
    const cepDigits = getMaskDigits('cep', elements.cep?.value || '');
    return {
      country: elements.country?.value?.trim() || '',
      legalName: elements.legalName?.value?.trim() || '',
      fantasyName: elements.fantasyName?.value?.trim() || '',
      cnpj: type === 'fisico' ? documentDigits.slice(0, 11) : documentDigits.slice(0, 14),
      stateRegistration: elements.stateRegistration?.value?.trim() || '',
      type,
      companies: selectedCompanies,
      flags: {
        inactive: Boolean(elements.flagInactive?.checked),
        ong: Boolean(elements.flagOng?.checked),
        bankSupplier: Boolean(elements.flagBank?.checked),
      },
      address: {
        cep: cepDigits,
        logradouro: elements.logradouro?.value?.trim() || '',
        numero: elements.numero?.value?.trim() || '',
        complemento: elements.complemento?.value?.trim() || '',
        bairro: elements.bairro?.value?.trim() || '',
        cidade: elements.cidade?.value?.trim() || '',
        uf: elements.uf?.value?.trim() || '',
      },
      contact: {
        email: elements.email?.value?.trim() || '',
        phone: getMaskDigits('phone', elements.phone?.value || ''),
        mobile: getMaskDigits('mobile', elements.mobile?.value || ''),
        secondaryPhone: getMaskDigits('secondaryPhone', elements.secondaryPhone?.value || ''),
        responsible: elements.responsible?.value?.trim() || '',
      },
      otherInfo: {
        supplierKind: elements.supplierKind?.value || 'distribuidora',
        accountingAccount: elements.chartAccount?.value || '',
        icmsContribution: elements.icms?.value || '2',
        observation: elements.observation?.value?.trim() || '',
        bank: elements.bank?.value || '',
        agency: digitsOnly(elements.agency?.value).slice(0, 10),
        accountNumber: digitsOnly(elements.account?.value).slice(0, 20),
      },
      representatives: state.representatives.map((rep) => ({ ...rep })),
      retencoes: Array.from(state.retencoes),
    };
  };

  const addSupplierToTable = (supplier) => {
    const mapped = mapSupplierToTable(supplier);
    const existsIndex = state.suppliers.findIndex((item) => item.id === mapped.id);
    if (existsIndex >= 0) {
      state.suppliers.splice(existsIndex, 1, mapped);
    } else {
      state.suppliers.unshift(mapped);
    }
    applyFiltersAndSort();
  };

  const submitForm = async (event) => {
    if (event) {
      event.preventDefault();
    }
    if (state.saving) return;
    const payload = gatherFormData();
    if (!payload.legalName) {
      notify('Informe a razão social do fornecedor.', 'error');
      return;
    }
    if (!payload.cnpj) {
      notify(`Informe o ${getDocumentLabel(payload.type)} do fornecedor.`, 'error');
      return;
    }
    state.saving = true;
    if (elements.saveButton) {
      elements.saveButton.disabled = true;
      elements.saveButton.classList.add('opacity-60', 'cursor-not-allowed');
    }
    try {
      const data = await request(
        SUPPLIERS_ENDPOINT,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        { requiresAuth: true }
      );
      if (data?.supplier) {
        notify('Fornecedor cadastrado com sucesso!', 'success');
        addSupplierToTable(data.supplier);
        setSupplierCode(data.supplier.code || '', { pending: false });
        resetForm();
        await loadNextSupplierCode();
      } else {
        notify('Fornecedor cadastrado, mas resposta inesperada do servidor.', 'warning');
      }
    } catch (error) {
      console.error('Erro ao salvar fornecedor:', error);
      if (error.status === 401) {
        handleAuthError();
      }
      notify(error?.message || 'Não foi possível salvar o fornecedor. Tente novamente.', 'error');
    } finally {
      state.saving = false;
      if (elements.saveButton) {
        elements.saveButton.disabled = false;
        elements.saveButton.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
  };

  const setupForm = () => {
    if (elements.form) {
      elements.form.addEventListener('submit', submitForm);
    }
    if (elements.saveButton) {
      elements.saveButton.addEventListener('click', () => {
        if (elements.form?.requestSubmit) {
          elements.form.requestSubmit();
        } else {
          submitForm();
        }
      });
    }
  };

  const setupFilters = () => {
    if (Array.isArray(elements.filterInputs)) {
      elements.filterInputs.forEach((input) => {
        input.addEventListener('input', (event) => {
          const column = event.target.dataset.filter;
          state.filters[column] = event.target.value || '';
          applyFiltersAndSort();
        });
      });
    }
    if (Array.isArray(elements.sortButtons)) {
      elements.sortButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const column = button.dataset.sort;
          if (state.sort.column === column) {
            state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
          } else {
            state.sort.column = column;
            state.sort.direction = 'asc';
          }
          applyFiltersAndSort();
        });
      });
    }
  };

  const fillAddressFields = (data = {}) => {
    if (elements.logradouro && data.logradouro) {
      elements.logradouro.value = data.logradouro;
    }
    if (elements.bairro && data.bairro) {
      elements.bairro.value = data.bairro;
    }
    if (elements.cidade && data.localidade) {
      elements.cidade.value = data.localidade;
    }
    if (elements.uf && data.uf) {
      elements.uf.value = data.uf;
    }
  };

  const applyLookupAddress = (address = {}) => {
    if (!address || typeof address !== 'object') return;
    if (address.cep && elements.cep) {
      setMaskedDigits('cep', elements.cep, address.cep);
      state.currentCep = digitsOnly(address.cep);
      setCepStatus('Endereço preenchido automaticamente a partir do documento consultado.', 'success');
    }
    if (address.logradouro && elements.logradouro) {
      elements.logradouro.value = address.logradouro;
    }
    if (address.numero && elements.numero) {
      elements.numero.value = address.numero;
    }
    if (address.complemento && elements.complemento) {
      elements.complemento.value = address.complemento;
    }
    if (address.bairro && elements.bairro) {
      elements.bairro.value = address.bairro;
    }
    if (address.cidade && elements.cidade) {
      elements.cidade.value = address.cidade;
    }
    if (address.uf && elements.uf) {
      elements.uf.value = address.uf;
    }
  };

  const applyLookupContact = (contact = {}) => {
    if (!contact || typeof contact !== 'object') return;
    if (contact.email && elements.email) {
      elements.email.value = contact.email;
    }
    if (contact.phone && elements.phone) {
      setMaskedDigits('phone', elements.phone, contact.phone);
    }
    if (contact.mobile && elements.mobile) {
      setMaskedDigits('mobile', elements.mobile, contact.mobile);
    }
    if (contact.secondaryPhone && elements.secondaryPhone) {
      setMaskedDigits('secondaryPhone', elements.secondaryPhone, contact.secondaryPhone);
    }
    if (contact.responsible && elements.responsible && !elements.responsible.value) {
      elements.responsible.value = contact.responsible;
    }
  };

  const applyLookupData = (lookup = {}) => {
    if (!lookup || typeof lookup !== 'object') return;

    if (lookup.document && elements.cnpj) {
      setMaskedDigits('document', elements.cnpj, lookup.document);
    }

    if (lookup.country && elements.country) {
      elements.country.value = lookup.country;
    }

    if (lookup.legalName && elements.legalName) {
      elements.legalName.value = lookup.legalName;
    }

    if (lookup.fantasyName && elements.fantasyName) {
      elements.fantasyName.value = lookup.fantasyName;
    }

    if (lookup.stateRegistration && elements.stateRegistration) {
      elements.stateRegistration.value = lookup.stateRegistration;
    }

    applyLookupAddress(lookup.address || {});
    applyLookupContact(lookup.contact || {});

    if (elements.observation) {
      const fragments = [];
      if (lookup.status) {
        fragments.push(`Situação cadastral: ${lookup.status}`);
      }
      if (lookup.cnae?.code || lookup.cnae?.description) {
        const cnaeParts = [lookup.cnae?.code, lookup.cnae?.description].filter(Boolean).join(' - ');
        if (cnaeParts) {
          fragments.push(`Atividade principal: ${cnaeParts}`);
        }
      }
      if (lookup.openingDate) {
        fragments.push(`Início de atividade: ${lookup.openingDate}`);
      }
      if (!elements.observation.value && fragments.length) {
        elements.observation.value = fragments.join('\n');
      }
    }

    if (lookup.sourceName) {
      setDocumentStatus(`Dados preenchidos automaticamente via ${lookup.sourceName}.`, 'success');
    } else {
      setDocumentStatus('Dados preenchidos automaticamente a partir do documento informado.', 'success');
    }
  };

  const lookupDocumentData = async () => {
    if (!elements.cnpj) return;
    const type = getCurrentSupplierType();
    const digits = getMaskDigits('document', elements.cnpj.value || '');
    const required = type === 'fisico' ? 11 : 14;

    if (!digits) {
      setDocumentStatus(getDocumentInstruction(type), 'info');
      return;
    }

    if (digits.length !== required) {
      const missing = required - digits.length;
      setDocumentStatus(
        `Documento incompleto. Informe mais ${missing} dígito${missing > 1 ? 's' : ''} para realizar a consulta automática.`,
        'info'
      );
      return;
    }

    const lookupKey = getDocumentLookupKey(type, digits);
    if (state.currentDocumentLookupKey === lookupKey) {
      return;
    }

    if (state.documentLookupAbort?.abort) {
      state.documentLookupAbort.abort();
      state.documentLookupAbort = null;
    }

    const controller = new AbortController();
    state.documentLookupAbort = controller;
    setDocumentStatus('Consultando dados oficiais do documento informado...', 'info');

    try {
      const data = await request(
        `${SUPPLIERS_LOOKUP_ENDPOINT}/${digits}`,
        { signal: controller.signal },
        { requiresAuth: true }
      );
      state.documentLookupAbort = null;
      state.currentDocumentLookupKey = lookupKey;
      const lookup = data?.lookup;
      if (!lookup) {
        setDocumentStatus('Consulta concluída, porém nenhum dado foi retornado.', 'warning');
        return;
      }
      applyLookupData(lookup);
    } catch (error) {
      if (error.name === 'AbortError') {
        state.documentLookupAbort = null;
        return;
      }
      state.documentLookupAbort = null;
      state.currentDocumentLookupKey = '';
      if (error.status === 401) {
        handleAuthError();
      }
      if (error.data?.code === 'CPF_LOOKUP_NOT_CONFIGURED') {
        setDocumentStatus('Consulta automática de CPF não está disponível. Preencha os dados manualmente.', 'error');
        return;
      }
      if (error.status === 404) {
        setDocumentStatus('Documento não encontrado na base consultada.', 'error');
        return;
      }
      if (error.status === 504 || error.data?.code === 'LOOKUP_TIMEOUT') {
        setDocumentStatus('Tempo limite excedido ao consultar o documento. Tente novamente em instantes.', 'error');
        return;
      }
      setDocumentStatus(error?.message || 'Não foi possível consultar o documento informado.', 'error');
    }
  };

  const setupDocumentLookup = () => {
    if (!elements.cnpj) return;

    const handleInput = () => {
      if (state.documentLookupAbort?.abort) {
        state.documentLookupAbort.abort();
        state.documentLookupAbort = null;
      }
      state.currentDocumentLookupKey = '';

      const type = getCurrentSupplierType();
      const digits = getMaskDigits('document', elements.cnpj.value || '');
      const required = type === 'fisico' ? 11 : 14;

      if (!digits) {
        setDocumentStatus(getDocumentInstruction(type), 'info');
        return;
      }

      if (digits.length < required) {
        const missing = required - digits.length;
        setDocumentStatus(
          `Documento incompleto. Informe mais ${missing} dígito${missing > 1 ? 's' : ''} para realizar a consulta automática.`,
          'info'
        );
        return;
      }

      setDocumentStatus('Documento completo. Saia do campo para consultar automaticamente.', 'info');
    };

    elements.cnpj.addEventListener('input', handleInput);
    elements.cnpj.addEventListener('blur', lookupDocumentData);
    elements.cnpj.addEventListener('change', lookupDocumentData);
  };

  const lookupCep = async (cepValue) => {
    const digits = String(cepValue || '').replace(/\D+/g, '');
    if (digits.length !== 8) {
      setCepStatus('Informe os 8 dígitos do CEP para buscar o endereço automaticamente.', 'info');
      return;
    }
    if (state.currentCep === digits) {
      return;
    }
    if (state.cepAbort) {
      state.cepAbort.abort();
    }
    state.currentCep = digits;
    state.cepAbort = new AbortController();
    setCepStatus('Consultando CEP na base oficial ViaCEP...', 'info');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: state.cepAbort.signal });
      if (!response.ok) {
        throw new Error(`Erro ao consultar CEP (${response.status})`);
      }
      const data = await response.json();
      if (data?.erro) {
        setCepStatus('CEP não encontrado. Preencha manualmente os dados de endereço.', 'error');
        return;
      }
      fillAddressFields(data);
      setCepStatus('Endereço preenchido automaticamente via ViaCEP.', 'success');
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Erro ao consultar CEP:', error);
      setCepStatus('Não foi possível consultar o CEP informado.', 'error');
    }
  };

  const setupCepLookup = () => {
    if (!elements.cep) return;
    elements.cep.addEventListener('blur', () => lookupCep(elements.cep.value));
  };

  const init = async () => {
    initElements();
    setupTabs();
    setupTypeButtons();
    initializeMasks();
    setupRetentionButtons();
    setupRepresentatives();
    setupForm();
    setupFilters();
    setupDocumentLookup();
    setupCepLookup();
    updateRetencoesHiddenField();
    renderSuppliers();
    await Promise.all([loadCompanies(), loadAccountingAccounts(), loadBanks(), loadSuppliers(), loadNextSupplierCode()]);
  };

  document.addEventListener('DOMContentLoaded', init);
})();
