(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const selectors = {
    form: '#payment-method-form',
    resetButton: '#payment-method-reset',
    cancelButton: '#payment-method-cancel',
    submitLabel: '#payment-submit-label',
    submitButton: '#payment-method-form button[type="submit"]',
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
    creditoDiscountsContainer: '#credito-discounts-per-installment',
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
    creditDiscounts: {},
    saving: false,
    loadingMethods: false,
    defaultEmptyStateHtml: '',
  };

  const elements = {};

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast({ message, type });
      return;
    }
    if (type === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }
  };

  const parseNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const formatPercentage = (value) => {
    const normalized = Math.max(0, parseNumber(value, 0));
    return `${normalized.toFixed(2).replace('.', ',')}%`;
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
    return `Desconto de ${formatPercentage(discount)}`;
  };

  const getSelectedCompany = () =>
    state.companies.find((company) => company && company._id === state.selectedCompanyId) || null;

  const getToken = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token do usuário logado.', error);
      return '';
    }
  };

  const parseErrorResponse = async (response, fallback) => {
    try {
      const data = await response.json();
      if (data?.message) return data.message;
    } catch (error) {
      // ignore parsing errors
    }
    return fallback;
  };

  const setSavingState = (saving) => {
    state.saving = saving;
    if (elements.submitButton) {
      elements.submitButton.disabled = saving;
      elements.submitButton.classList.toggle('opacity-60', saving);
      elements.submitButton.classList.toggle('pointer-events-none', saving);
    }
    if (elements.submitLabel) {
      elements.submitLabel.textContent = saving ? 'Salvando...' : 'Salvar meio';
    }
  };

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

  const getCreditDiscountValue = (installment) => {
    const stored = state.creditDiscounts[installment];
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      return stored;
    }
    return Math.max(0, parseNumber(elements.creditoDiscount?.value, 0));
  };

  const updateCreditDiscountsStructure = () => {
    const total = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
    const base = Math.max(0, parseNumber(elements.creditoDiscount?.value, 0));

    Object.keys(state.creditDiscounts).forEach((key) => {
      const installment = Number(key);
      if (!Number.isFinite(installment) || installment > total) {
        delete state.creditDiscounts[key];
      }
    });

    for (let installment = 1; installment <= total; installment += 1) {
      if (typeof state.creditDiscounts[installment] !== 'number') {
        state.creditDiscounts[installment] = base;
      }
    }
  };

  const renderCreditDiscountInputs = () => {
    if (!elements.creditoDiscountsContainer) return;
    updateCreditDiscountsStructure();

    const total = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
    const rows = [];

    for (let installment = 1; installment <= total; installment += 1) {
      const value = getCreditDiscountValue(installment);
      rows.push(`
        <label class="flex items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-indigo-700">
          <span class="font-semibold">Crédito ${installment}x</span>
          <input
            type="number"
            min="0"
            step="0.01"
            data-installment="${installment}"
            value="${value}"
            class="w-24 rounded-md border border-indigo-200 px-2 py-1 text-right text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      `);
    }

    elements.creditoDiscountsContainer.innerHTML = rows.join('');

    const inputs = elements.creditoDiscountsContainer.querySelectorAll('input[data-installment]');
    inputs.forEach((input) => {
      input.addEventListener('input', (event) => {
        const installment = Number(event.target.dataset.installment);
        const value = Math.max(0, parseNumber(event.target.value, 0));
        if (Number.isFinite(installment) && installment >= 1) {
          state.creditDiscounts[installment] = value;
        }
        updateCreditoPreview();
        updateOverview();
      });
    });
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

    const badges = [];
    for (let installment = 1; installment <= installments; installment += 1) {
      const percent = formatPercentage(getCreditDiscountValue(installment));
      badges.push(
        `<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">${installment}x • ${percent}</span>`
      );
    }

    const discounts = badges.length
      ? `<span class="flex flex-wrap justify-end gap-1">${badges.join('')}</span>`
      : 'Sem desconto aplicado';

    elements.overview.innerHTML = `
      <div class="space-y-3">
        ${buildRow('Empresa', companyName)}
        ${buildRow('Modalidade', 'Crédito')}
        ${buildRow('Parcelas', `${installments}x`)}
        ${buildRow('Prazo', days)}
        ${buildRow('Descontos', discounts)}
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

    const items = [];
    for (let installment = 1; installment <= installments; installment += 1) {
      const discount = formatDiscount(getCreditDiscountValue(installment));
      items.push(`
        <div class="flex items-center justify-between rounded-lg border border-indigo-100 bg-white/70 px-3 py-2">
          <span class="text-sm font-semibold text-indigo-700">Crédito ${installment}x</span>
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

  const fetchPaymentMethods = async (companyId) => {
    if (!elements.methodsList || !elements.methodsEmptyState || !elements.methodsCount) return;

    if (!companyId) {
      state.methods = [];
      state.loadingMethods = false;
      renderMethods();
      return;
    }

    state.loadingMethods = true;
    renderMethods();

    try {
      const response = await fetch(`${API_BASE}/payment-methods?company=${encodeURIComponent(companyId)}`);
      if (!response.ok) {
        throw new Error('Não foi possível carregar os meios de pagamento cadastrados.');
      }
      const data = await response.json();
      state.methods = Array.isArray(data?.paymentMethods) ? data.paymentMethods : [];
    } catch (error) {
      console.error('Erro ao carregar meios de pagamento:', error);
      notify(error.message || 'Falha ao carregar meios de pagamento.', 'error');
      state.methods = [];
    } finally {
      state.loadingMethods = false;
      renderMethods();
    }
  };

  const handleCompanyChange = async (event) => {
    state.selectedCompanyId = event.target.value || '';
    updateCompanySummary();
    updateOverview();
    await fetchPaymentMethods(state.selectedCompanyId);
  };

  const handleTypeChange = (event) => {
    state.currentType = event.target.value;
    toggleSections();
    if (state.currentType === 'credito') {
      renderCreditDiscountInputs();
    }
    updateAvistaPreview();
    updateDebitoPreview();
    updateCreditoPreview();
    updateOverview();
  };

  const resetForm = ({ preserveCompany = true } = {}) => {
    const selectedCompanyId = preserveCompany ? state.selectedCompanyId : '';
    state.currentType = 'avista';
    state.creditDiscounts = {};

    if (elements.form) {
      elements.form.reset();
    }

    state.selectedCompanyId = selectedCompanyId;
    if (elements.companySelect) {
      elements.companySelect.value = selectedCompanyId || '';
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
    renderCreditDiscountInputs();
    updateAvistaPreview();
    updateDebitoPreview();
    updateCreditoPreview();
    updateCompanySummary();
    updateOverview();
  };

  const renderMethods = () => {
    if (!elements.methodsList || !elements.methodsEmptyState || !elements.methodsCount) return;

    if (state.loadingMethods) {
      elements.methodsList.innerHTML = '';
      elements.methodsEmptyState.classList.remove('hidden');
      elements.methodsEmptyState.innerHTML =
        '<span class="text-sm text-gray-500">Carregando meios de pagamento...</span>';
      elements.methodsCount.textContent = '—';
      return;
    }

    if (!state.methods.length) {
      elements.methodsList.innerHTML = '';
      elements.methodsEmptyState.classList.remove('hidden');
      elements.methodsEmptyState.innerHTML =
        state.defaultEmptyStateHtml || 'Nenhum meio de pagamento cadastrado até o momento.';
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

      const details = [];
      if (method.type === 'credito') {
        const days = formatDays(method.days);
        const configs = Array.isArray(method.installmentConfigurations)
          ? method.installmentConfigurations
          : [];
        const badges = configs.map((config) => {
          const percent = formatPercentage(config?.discount ?? 0);
          return `<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">${config.number}x • ${percent}</span>`;
        });
        details.push(`<p class="text-xs text-gray-500">${days}</p>`);
        if (badges.length) {
          details.push(`<div class="flex flex-wrap gap-2">${badges.join('')}</div>`);
        } else {
          details.push('<p class="text-xs text-gray-500">Sem desconto aplicado.</p>');
        }
      } else {
        const days = formatDays(method.days);
        const discount = formatDiscount(method.discount);
        details.push(`<p class="text-xs text-gray-500">${days} • ${discount}</p>`);
      }

      return `
        <article class="rounded-lg border border-gray-200 px-4 py-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h3 class="text-sm font-semibold text-gray-800">${method.name}</h3>
              <p class="text-xs text-gray-500">${typeLabel}</p>
            </div>
            <span class="text-xs font-semibold text-gray-400">${method.code || '—'}</span>
          </div>
          <div class="mt-3 space-y-1">
            ${details.join('')}
          </div>
        </article>
      `;
    });

    elements.methodsList.innerHTML = cards.join('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (state.saving) return;

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

    const token = getToken();
    if (!token) {
      notify('Sua sessão expirou. Faça login novamente para continuar.', 'error');
      return;
    }

    const baseCode = (elements.codeInput?.value || '').trim();
    const payload = {
      company: company._id,
      name,
      type: state.currentType,
    };

    if (baseCode) {
      payload.code = baseCode;
    }

    if (state.currentType === 'avista') {
      payload.days = Math.max(0, parseNumber(elements.avistaDays?.value, 0));
      payload.discount = Math.max(0, parseNumber(elements.avistaDiscount?.value, 0));
    } else if (state.currentType === 'debito') {
      payload.days = Math.max(0, parseNumber(elements.debitoDays?.value, 1));
      payload.discount = Math.max(0, parseNumber(elements.debitoDiscount?.value, 0));
    } else {
      const installments = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
      const days = Math.max(0, parseNumber(elements.creditoDays?.value, 30));
      payload.days = days;
      payload.installments = installments;
      payload.installmentConfigurations = [];

      for (let installment = 1; installment <= installments; installment += 1) {
        payload.installmentConfigurations.push({
          number: installment,
          discount: Math.max(0, getCreditDiscountValue(installment)),
          days,
        });
      }

      payload.discount = payload.installmentConfigurations[0]?.discount || 0;
    }

    setSavingState(true);

    try {
      const response = await fetch(`${API_BASE}/payment-methods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await parseErrorResponse(response, 'Não foi possível salvar o meio de pagamento.');
        throw new Error(message);
      }

      await response.json();
      notify('Meio de pagamento salvo com sucesso.', 'success');
      await fetchPaymentMethods(state.selectedCompanyId);
      resetForm({ preserveCompany: true });
    } catch (error) {
      console.error('Erro ao salvar meio de pagamento:', error);
      notify(error.message || 'Erro ao salvar meio de pagamento.', 'error');
    } finally {
      setSavingState(false);
    }
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
      renderCreditDiscountInputs();
      updateCreditoPreview();
      updateOverview();
    });
    elements.creditoDays?.addEventListener('input', () => {
      updateCreditoPreview();
      updateOverview();
    });
    elements.creditoDiscount?.addEventListener('input', () => {
      const base = Math.max(0, parseNumber(elements.creditoDiscount.value, 0));
      const total = Math.max(1, parseNumber(elements.creditoInstallments?.value, 1));
      for (let installment = 1; installment <= total; installment += 1) {
        state.creditDiscounts[installment] = base;
      }
      renderCreditDiscountInputs();
      updateCreditoPreview();
      updateOverview();
    });

    elements.resetButton?.addEventListener('click', (event) => {
      event.preventDefault();
      resetForm({ preserveCompany: true });
    });

    elements.form?.addEventListener('submit', handleSubmit);
  };

  const initialize = () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      if (key === 'typeRadios') return;
      elements[key] = document.querySelector(selector);
    });

    if (elements.methodsEmptyState) {
      state.defaultEmptyStateHtml = elements.methodsEmptyState.innerHTML;
    }

    updateCodeField();
    renderCreditDiscountInputs();
    toggleSections();
    updateAvistaPreview();
    updateDebitoPreview();
    updateCreditoPreview();
    updateCompanySummary();
    updateOverview();
    renderMethods();
    bindEvents();
    fetchCompanies();
  };

  document.addEventListener('DOMContentLoaded', initialize);
})();
