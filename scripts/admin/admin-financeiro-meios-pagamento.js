(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const selectors = {
    form: '#payment-method-form',
    resetButton: '#payment-method-reset',
    cancelButton: '#payment-method-cancel',
    submitLabel: '#payment-submit-label',
    companySelect: '#payment-company',
    companySummary: '#payment-company-summary',
    codeInput: '#payment-code',
    nameInput: '#payment-name',
    typeRadios: 'input[name="payment-type"]',
    avistaSection: '#avista-section',
    avistaDays: '#avista-days',
    avistaDiscount: '#avista-discount',
    avistaPreview: '#avista-preview',
    debitoSection: '#debito-section',
    debitoDays: '#debito-days',
    debitoDiscount: '#debito-discount',
    debitoPreview: '#debito-preview',
    creditoSection: '#credito-section',
    creditoInstallments: '#credito-installments',
    creditoDays: '#credito-days',
    creditoDiscount: '#credito-discount',
    creditoPreviewList: '#credito-preview-list',
    overview: '#payment-overview',
    methodsList: '#payment-methods-list',
    methodsEmptyState: '#payment-methods-empty',
    methodsCount: '#payment-method-count',
  };

  const state = {
    companies: [],
    selectedCompanyId: '',
    currentType: 'avista',
    methods: [],
  };

  const elements = {};

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast({ message, type });
    } else {
      console[type === 'error' ? 'error' : 'log'](message);
    }
  };

  const parseNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const formatDays = (value) => {
    const days = Math.max(0, parseNumber(value, 0));
    if (days === 0) return 'Recebimento no mesmo dia (D+0)';
    if (days === 1) return 'Recebimento em 1 dia (D+1)';
    return `Recebimento em ${days} dias (D+${days})`;
  };

  const formatDiscount = (value) => {
    const discount = Math.max(0, parseNumber(value, 0));
    if (discount === 0) return 'Sem desconto aplicado';
    return `Desconto de ${discount.toFixed(2).replace('.', ',')}%`;
  };

  const getSelectedCompany = () =>
    state.companies.find((company) => company && company._id === state.selectedCompanyId) || null;

  const updateCodeField = () => {
    if (!elements.codeInput) return;
    elements.codeInput.value = 'Gerado automaticamente';
  };

  const updateCompanySummary = () => {
    if (!elements.companySummary) return;
    const company = getSelectedCompany();
    if (!company) {
      elements.companySummary.innerHTML =
        '<p class="text-gray-500">Selecione uma empresa para visualizar detalhes.</p>';
      return;
    }

    const nome = company.nome || company.nomeFantasia || company.razaoSocial || '—';
    const razao = company.razaoSocial || company.nome || '—';
    const documento = company.cnpj || company.cpf || '—';
    const email = company.emailFiscal || company.email || '—';
    const telefone = company.telefone || company.celular || company.whatsapp || '—';

    elements.companySummary.innerHTML = `
      <div class="space-y-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Nome fantasia</p>
          <p class="text-sm font-semibold text-gray-800">${nome}</p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Razão social</p>
          <p class="text-sm text-gray-700">${razao}</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <p class="text-xs uppercase tracking-wide text-gray-500">Documento</p>
            <p class="text-sm text-gray-700">${documento}</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-gray-500">Telefone</p>
            <p class="text-sm text-gray-700">${telefone}</p>
          </div>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Contato fiscal</p>
          <p class="text-sm text-gray-700">${email}</p>
        </div>
      </div>
    `;
  };

  const updateOverview = () => {
    if (!elements.overview) return;

    const company = getSelectedCompany();
    const companyName = company ? company.nome || company.nomeFantasia || 'Empresa selecionada' : '—';

    const buildRow = (label, value) => `
      <div class="flex items-start justify-between gap-4">
        <span class="text-xs uppercase tracking-wide text-gray-500">${label}</span>
        <span class="text-sm font-medium text-gray-800 text-right">${value}</span>
      </div>
    `;

    if (state.currentType === 'avista') {
      const days = formatDays(elements.avistaDays?.value);
      const discount = formatDiscount(elements.avistaDiscount?.value);
      elements.overview.innerHTML = `
        <div class="space-y-3">
          ${buildRow('Empresa', companyName)}
          ${buildRow('Modalidade', 'À vista')}
          ${buildRow('Prazo', days)}
          ${buildRow('Desconto', discount)}
        </div>
      `;
      return;
    }

    if (state.currentType === 'debito') {
      const days = formatDays(elements.debitoDays?.value);
      const discount = formatDiscount(elements.debitoDiscount?.value);
      elements.overview.innerHTML = `
        <div class="space-y-3">
          ${buildRow('Empresa', companyName)}
          ${buildRow('Modalidade', 'Débito')}
          ${buildRow('Prazo', days)}
          ${buildRow('Desconto', discount)}
        </div>
      `;
      return;
    }

    const installments = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
    const days = formatDays(elements.creditoDays?.value);
    const discount = formatDiscount(elements.creditoDiscount?.value);
    elements.overview.innerHTML = `
      <div class="space-y-3">
        ${buildRow('Empresa', companyName)}
        ${buildRow('Modalidade', 'Crédito')}
        ${buildRow('Parcelas', `${installments}x`)}
        ${buildRow('Prazo', days)}
        ${buildRow('Desconto', discount)}
      </div>
    `;
  };

  const updateAvistaPreview = () => {
    if (!elements.avistaPreview) return;
    const days = formatDays(elements.avistaDays?.value);
    const discount = formatDiscount(elements.avistaDiscount?.value);
    elements.avistaPreview.textContent = `${days} • ${discount}`;
  };

  const updateDebitoPreview = () => {
    if (!elements.debitoPreview) return;
    const days = formatDays(elements.debitoDays?.value);
    const discount = formatDiscount(elements.debitoDiscount?.value);
    elements.debitoPreview.textContent = `${days} • ${discount}`;
  };

  const updateCreditoPreview = () => {
    if (!elements.creditoPreviewList) return;
    const installments = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
    const days = formatDays(elements.creditoDays?.value);
    const discount = formatDiscount(elements.creditoDiscount?.value);

    const items = [];
    for (let i = 1; i <= installments; i += 1) {
      items.push(`
        <div class="flex items-center justify-between rounded-lg border border-indigo-100 bg-white/70 px-3 py-2">
          <span class="text-sm font-semibold text-indigo-700">Crédito ${i}x</span>
          <span class="text-xs text-indigo-600">${days} • ${discount}</span>
        </div>
      `);
    }

    elements.creditoPreviewList.innerHTML = items.join('');
  };

  const toggleSections = () => {
    const mapping = {
      avista: elements.avistaSection,
      debito: elements.debitoSection,
      credito: elements.creditoSection,
    };

    Object.entries(mapping).forEach(([type, section]) => {
      if (!section) return;
      if (type === state.currentType) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    });
  };

  const populateCompanySelect = () => {
    if (!elements.companySelect) return;
    const options = [];
    if (!state.companies.length) {
      options.push('<option value="">Nenhuma empresa cadastrada</option>');
    } else {
      options.push('<option value="">Selecione uma empresa</option>');
      state.companies.forEach((company) => {
        const label = company.nome || company.nomeFantasia || 'Empresa sem nome';
        options.push(`<option value="${company._id}">${label}</option>`);
      });
    }
    elements.companySelect.innerHTML = options.join('');
    if (state.selectedCompanyId) {
      elements.companySelect.value = state.selectedCompanyId;
    }
  };

  const fetchCompanies = async () => {
    try {
      const response = await fetch(`${API_BASE}/stores`);
      if (!response.ok) {
        throw new Error('Não foi possível carregar as empresas cadastradas.');
      }
      const payload = await response.json();
      state.companies = Array.isArray(payload) ? payload : [];
      populateCompanySelect();
      updateCompanySummary();
      updateOverview();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      notify(error.message || 'Falha ao carregar empresas cadastradas.', 'error');
      state.companies = [];
      populateCompanySelect();
    }
  };

  const handleCompanyChange = (event) => {
    state.selectedCompanyId = event.target.value || '';
    updateCompanySummary();
    updateOverview();
  };

  const handleTypeChange = (event) => {
    state.currentType = event.target.value;
    toggleSections();
    updateAvistaPreview();
    updateDebitoPreview();
    updateCreditoPreview();
    updateOverview();
  };

  const resetForm = () => {
    state.selectedCompanyId = '';
    state.currentType = 'avista';

    if (elements.form) {
      elements.form.reset();
    }

    if (elements.companySelect) {
      elements.companySelect.value = '';
    }

    if (elements.avistaDays) elements.avistaDays.value = 0;
    if (elements.avistaDiscount) elements.avistaDiscount.value = 0;
    if (elements.debitoDays) elements.debitoDays.value = 1;
    if (elements.debitoDiscount) elements.debitoDiscount.value = 0;
    if (elements.creditoInstallments) elements.creditoInstallments.value = 3;
    if (elements.creditoDays) elements.creditoDays.value = 30;
    if (elements.creditoDiscount) elements.creditoDiscount.value = 2.49;

    const radios = Array.from(document.querySelectorAll(selectors.typeRadios));
    radios.forEach((radio) => {
      radio.checked = radio.value === 'avista';
    });

    updateCodeField();
    toggleSections();
    updateAvistaPreview();
    updateDebitoPreview();
    updateCreditoPreview();
    updateCompanySummary();
    updateOverview();
  };

  const renderMethods = () => {
    if (!elements.methodsList || !elements.methodsEmptyState || !elements.methodsCount) return;

    if (!state.methods.length) {
      elements.methodsList.innerHTML = '';
      elements.methodsEmptyState.classList.remove('hidden');
      elements.methodsCount.textContent = '0';
      return;
    }

    elements.methodsEmptyState.classList.add('hidden');
    elements.methodsCount.textContent = String(state.methods.length);

    const cards = state.methods.map((method) => {
      const typeLabel =
        method.type === 'credito'
          ? `Crédito • ${method.installments || 1}x`
          : method.type === 'debito'
          ? 'Débito'
          : 'À vista';
      return `
        <article class="rounded-lg border border-gray-200 px-4 py-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h3 class="text-sm font-semibold text-gray-800">${method.name}</h3>
              <p class="text-xs text-gray-500">${typeLabel}</p>
            </div>
            <span class="text-xs font-semibold text-gray-400">${method.code || '—'}</span>
          </div>
        </article>
      `;
    });

    elements.methodsList.innerHTML = cards.join('');
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const company = getSelectedCompany();
    if (!company) {
      notify('Selecione uma empresa antes de salvar o meio de pagamento.', 'error');
      elements.companySelect?.focus();
      return;
    }

    const name = (elements.nameInput?.value || '').trim();
    if (!name) {
      notify('Informe um nome para o meio de pagamento.', 'error');
      elements.nameInput?.focus();
      return;
    }

    const generatedId =
      (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : `temp-${Date.now()}`;

    const baseCode = (elements.codeInput?.value || '').trim();

    const basePayload = {
      id: generatedId,
      companyId: company._id,
      companyName: company.nome || company.nomeFantasia || 'Empresa selecionada',
      name,
      code:
        baseCode && baseCode !== 'Gerado automaticamente'
          ? baseCode
          : `MP-${String(state.methods.length + 1).padStart(3, '0')}`,
      type: state.currentType,
    };

    if (state.currentType === 'avista') {
      basePayload.days = Math.max(0, parseNumber(elements.avistaDays?.value, 0));
      basePayload.discount = Math.max(0, parseNumber(elements.avistaDiscount?.value, 0));
    } else if (state.currentType === 'debito') {
      basePayload.days = Math.max(0, parseNumber(elements.debitoDays?.value, 1));
      basePayload.discount = Math.max(0, parseNumber(elements.debitoDiscount?.value, 0));
    } else {
      basePayload.days = Math.max(0, parseNumber(elements.creditoDays?.value, 30));
      basePayload.discount = Math.max(0, parseNumber(elements.creditoDiscount?.value, 0));
      basePayload.installments = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
    }

    state.methods.unshift(basePayload);
    renderMethods();
    notify('Pré-visualização salva localmente. Integração com o backend ainda pendente.', 'success');
    resetForm();
  };

  const bindEvents = () => {
    if (elements.companySelect) {
      elements.companySelect.addEventListener('change', handleCompanyChange);
    }

    const radios = Array.from(document.querySelectorAll(selectors.typeRadios));
    radios.forEach((radio) => radio.addEventListener('change', handleTypeChange));

    elements.avistaDays?.addEventListener('input', () => {
      updateAvistaPreview();
      updateOverview();
    });
    elements.avistaDiscount?.addEventListener('input', () => {
      updateAvistaPreview();
      updateOverview();
    });

    elements.debitoDays?.addEventListener('input', () => {
      updateDebitoPreview();
      updateOverview();
    });
    elements.debitoDiscount?.addEventListener('input', () => {
      updateDebitoPreview();
      updateOverview();
    });

    elements.creditoInstallments?.addEventListener('input', () => {
      updateCreditoPreview();
      updateOverview();
    });
    elements.creditoDays?.addEventListener('input', () => {
      updateCreditoPreview();
      updateOverview();
    });
    elements.creditoDiscount?.addEventListener('input', () => {
      updateCreditoPreview();
      updateOverview();
    });

    elements.resetButton?.addEventListener('click', (event) => {
      event.preventDefault();
      resetForm();
    });

    elements.form?.addEventListener('submit', handleSubmit);
  };

  const initialize = () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      if (key === 'typeRadios') return;
      elements[key] = document.querySelector(selector);
    });

    updateCodeField();
    toggleSections();
    updateAvistaPreview();
    updateDebitoPreview();
    updateCreditoPreview();
    updateOverview();
    renderMethods();
    bindEvents();
    fetchCompanies();
  };

  document.addEventListener('DOMContentLoaded', initialize);
})();
