(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const state = {
    stores: [],
    pdvs: [],
    deposits: [],
    bankAccounts: [],
    receivableAccounts: [],
    payableAccounts: [],
    selectedStore: '',
    selectedPdv: '',
    saving: false,
  };

  const elements = {};

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

  const notify = (message, type = 'info') => {
    if (typeof window?.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    if (typeof window?.showModal === 'function') {
      window.showModal({
        title: type === 'error' ? 'Erro' : 'Aviso',
        message,
        confirmText: 'OK',
      });
      return;
    }
    window.alert(message);
  };

  const queryElements = () => {
    elements.companySelect = document.getElementById('company-select');
    elements.pdvSelect = document.getElementById('pdv-select');
    elements.configContent = document.getElementById('config-content');
    elements.emptyState = document.getElementById('config-empty-state');
    elements.saveButton = document.getElementById('save-config-button');
    elements.statusLabel = document.getElementById('config-status');
    elements.selectionHint = document.getElementById('pdv-selection-hint');
    elements.depositoSelect = document.getElementById('deposito-padrao');
    elements.bankAccountSelect = document.getElementById('conta-corrente');
    elements.receivableAccountSelect = document.getElementById('conta-contabil-receber');
    elements.payableAccountSelect = document.getElementById('conta-contabil-pagar');

    elements.printerInputs = {
      venda: {
        nome: document.getElementById('impressora-venda-nome'),
        vias: document.getElementById('impressora-venda-vias'),
      },
      orcamento: {
        nome: document.getElementById('impressora-orcamento-nome'),
        vias: document.getElementById('impressora-orcamento-vias'),
      },
      contas: {
        nome: document.getElementById('impressora-contas-nome'),
        vias: document.getElementById('impressora-contas-vias'),
      },
      caixa: {
        nome: document.getElementById('impressora-caixa-nome'),
        vias: document.getElementById('impressora-caixa-vias'),
      },
    };
  };

  const setStatus = (message) => {
    if (elements.statusLabel) {
      elements.statusLabel.textContent = message;
    }
  };

  const toggleSaving = (saving) => {
    state.saving = saving;
    if (elements.saveButton) {
      elements.saveButton.disabled = saving;
      elements.saveButton.classList.toggle('opacity-60', saving);
      elements.saveButton.classList.toggle('pointer-events-none', saving);
      const label = elements.saveButton.querySelector('span');
      if (label) {
        label.textContent = saving ? 'Salvando...' : 'Salvar configurações';
      }
    }
  };

  const toggleConfigVisibility = (visible) => {
    if (elements.configContent) {
      elements.configContent.classList.toggle('hidden', !visible);
    }
    if (elements.emptyState) {
      elements.emptyState.classList.toggle('hidden', visible);
    }
  };

  const disableConfigFields = (disabled) => {
    document.querySelectorAll('[data-config-field]').forEach((input) => {
      input.disabled = disabled;
    });
    if (elements.saveButton) {
      elements.saveButton.disabled = disabled || state.saving;
    }
  };

  const resetRadios = (selector, defaultValue) => {
    const radios = document.querySelectorAll(selector);
    let checked = false;
    radios.forEach((radio) => {
      if (radio.value === defaultValue) {
        radio.checked = true;
        checked = true;
      } else {
        radio.checked = false;
      }
    });
    if (!checked && radios.length > 0) {
      radios[0].checked = true;
    }
  };

  const clearForm = () => {
    resetRadios('input[name="sempre-imprimir"]', 'perguntar');
    resetRadios('input[name="tipo-emissao"]', 'fiscal');

    Object.values(elements.printerInputs).forEach(({ nome, vias }) => {
      if (nome) nome.value = '';
      if (vias) vias.value = '';
    });

    document.querySelectorAll('.desconto-checkbox').forEach((checkbox) => {
      checkbox.checked = false;
    });

    if (elements.depositoSelect) {
      elements.depositoSelect.value = '';
    }

    if (elements.bankAccountSelect) {
      elements.bankAccountSelect.value = '';
    }

    if (elements.receivableAccountSelect) {
      elements.receivableAccountSelect.value = '';
    }

    if (elements.payableAccountSelect) {
      elements.payableAccountSelect.value = '';
    }

    setStatus('As alterações só serão aplicadas após salvar.');
  };

  const populateCompanySelect = () => {
    if (!elements.companySelect) return;
    const previous = elements.companySelect.value;
    const options = ['<option value="">Selecione uma empresa</option>'];
    state.stores.forEach((store) => {
      options.push(
        `<option value="${store._id}">${store.nome || store.nomeFantasia || 'Empresa sem nome'}</option>`
      );
    });
    elements.companySelect.innerHTML = options.join('');

    if (previous && state.stores.some((store) => store._id === previous)) {
      elements.companySelect.value = previous;
    }
  };

  const populatePdvSelect = () => {
    if (!elements.pdvSelect) return;
    const options = ['<option value="">Selecione um PDV</option>'];
    state.pdvs.forEach((pdv) => {
      options.push(`<option value="${pdv._id}">${pdv.nome || pdv.codigo}</option>`);
    });
    elements.pdvSelect.innerHTML = options.join('');
    elements.pdvSelect.disabled = state.pdvs.length === 0;

    if (!state.pdvs.length) {
      state.selectedPdv = '';
      if (elements.selectionHint) {
        elements.selectionHint.textContent = 'Nenhum PDV encontrado para a empresa selecionada.';
      }
      toggleConfigVisibility(false);
      clearForm();
    }
  };

  const populateDeposits = () => {
    if (!elements.depositoSelect) return;
    const options = ['<option value="">Selecione um depósito</option>'];
    state.deposits.forEach((deposit) => {
      options.push(`<option value="${deposit._id}">${deposit.nome}</option>`);
    });
    elements.depositoSelect.innerHTML = options.join('');
  };

  const formatBankAccountLabel = (account) => {
    if (!account) return 'Conta não listada';
    const alias = account.alias && String(account.alias).trim();
    const bankName = account.bankName && String(account.bankName).trim();
    const bankCode = account.bankCode && String(account.bankCode).trim();
    const agency = account.agency && String(account.agency).trim();
    const accountNumber = account.accountNumber && String(account.accountNumber).trim();
    const accountDigit = account.accountDigit && String(account.accountDigit).trim();

    const primary = alias || bankName || bankCode || 'Conta sem descrição';
    const secondaryParts = [];
    if (bankName && bankName !== primary) secondaryParts.push(bankName);
    else if (bankCode && bankCode !== primary) secondaryParts.push(`Banco ${bankCode}`);
    const accountParts = [];
    if (agency) accountParts.push(`Ag ${agency}`);
    if (accountNumber) {
      accountParts.push(`Conta ${accountNumber}${accountDigit ? `-${accountDigit}` : ''}`);
    }

    const composed = [primary];
    if (secondaryParts.length) composed.push(secondaryParts.join(' / '));
    if (accountParts.length) composed.push(accountParts.join(' · '));
    return composed.join(' • ');
  };

  const populateBankAccounts = () => {
    if (!elements.bankAccountSelect) return;
    const previous = elements.bankAccountSelect.value;
    const options = ['<option value="">Selecione uma conta corrente</option>'];
    state.bankAccounts.forEach((account) => {
      options.push(`<option value="${account._id}">${formatBankAccountLabel(account)}</option>`);
    });
    elements.bankAccountSelect.innerHTML = options.join('');
    if (previous && Array.from(elements.bankAccountSelect.options).some((option) => option.value === previous)) {
      elements.bankAccountSelect.value = previous;
    }
  };

  const formatAccountingAccountLabel = (account) => {
    if (!account) return 'Conta não listada';
    const code = account.code && String(account.code).trim();
    const name = account.name && String(account.name).trim();
    if (code && name) return `${code} - ${name}`;
    return code || name || 'Conta não listada';
  };

  const populateAccountingSelect = (select, accounts, placeholder) => {
    if (!select) return;
    const previous = select.value;
    const options = [`<option value="">${placeholder}</option>`];
    accounts.forEach((account) => {
      options.push(`<option value="${account._id}">${formatAccountingAccountLabel(account)}</option>`);
    });
    select.innerHTML = options.join('');
    if (previous && Array.from(select.options).some((option) => option.value === previous)) {
      select.value = previous;
    }
  };

  const populateReceivableAccounts = () => {
    populateAccountingSelect(
      elements.receivableAccountSelect,
      state.receivableAccounts,
      'Selecione uma conta contábil de receber'
    );
  };

  const populatePayableAccounts = () => {
    populateAccountingSelect(
      elements.payableAccountSelect,
      state.payableAccounts,
      'Selecione uma conta contábil de pagar'
    );
  };

  const ensureSelectValue = (select, value, fallbackLabel) => {
    if (!select) return;
    const normalizedValue = value ? String(value) : '';
    if (!normalizedValue) {
      select.value = '';
      return;
    }
    const hasOption = Array.from(select.options).some((option) => option.value === normalizedValue);
    if (!hasOption) {
      const fallbackOption = document.createElement('option');
      fallbackOption.value = normalizedValue;
      fallbackOption.textContent = fallbackLabel || 'Opção não listada';
      fallbackOption.dataset.fallback = 'true';
      select.appendChild(fallbackOption);
    }
    select.value = normalizedValue;
  };

  const extractReferenceId = (value) => {
    if (!value) return '';
    if (typeof value === 'object') {
      return value._id || value.id || '';
    }
    return String(value);
  };

  const formatDateTime = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const fetchStores = async () => {
    const response = await fetch(`${API_BASE}/stores`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar as empresas cadastradas.');
    }
    const payload = await response.json();
    state.stores = Array.isArray(payload) ? payload : Array.isArray(payload?.stores) ? payload.stores : [];
    populateCompanySelect();
  };

  const fetchPdvs = async (storeId) => {
    const query = storeId ? `?empresa=${encodeURIComponent(storeId)}` : '';
    const response = await fetch(`${API_BASE}/pdvs${query}`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar os PDVs da empresa.');
    }
    const payload = await response.json();
    state.pdvs = Array.isArray(payload?.pdvs)
      ? payload.pdvs
      : Array.isArray(payload)
      ? payload
      : [];
    populatePdvSelect();
  };

  const fetchDeposits = async (storeId) => {
    if (!storeId) {
      state.deposits = [];
      populateDeposits();
      return;
    }
    const response = await fetch(`${API_BASE}/deposits?empresa=${encodeURIComponent(storeId)}`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar os depósitos da empresa.');
    }
    const payload = await response.json();
    state.deposits = Array.isArray(payload?.deposits) ? payload.deposits : [];
    populateDeposits();
  };

  const fetchBankAccounts = async (storeId) => {
    if (!storeId) {
      state.bankAccounts = [];
      populateBankAccounts();
      return;
    }
    const token = getToken();
    if (!token) {
      throw new Error('Sessão expirada. Faça login novamente para continuar.');
    }
    const response = await fetch(
      `${API_BASE}/bank-accounts?company=${encodeURIComponent(storeId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Não foi possível carregar as contas correntes da empresa.');
    }
    state.bankAccounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
    populateBankAccounts();
  };

  const fetchAccountingAccounts = async (storeId, nature) => {
    if (!storeId) return [];
    const token = getToken();
    if (!token) {
      throw new Error('Sessão expirada. Faça login novamente para continuar.');
    }
    const params = new URLSearchParams();
    if (storeId) params.set('company', storeId);
    if (nature) params.set('nature', nature);
    const response = await fetch(`${API_BASE}/accounting-accounts?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'Não foi possível carregar as contas contábeis.');
    }
    return Array.isArray(payload?.accounts) ? payload.accounts : [];
  };

  const fetchReceivableAccounts = async (storeId) => {
    if (!storeId) {
      state.receivableAccounts = [];
      populateReceivableAccounts();
      return;
    }
    state.receivableAccounts = await fetchAccountingAccounts(storeId, 'contas_receber');
    populateReceivableAccounts();
  };

  const fetchPayableAccounts = async (storeId) => {
    if (!storeId) {
      state.payableAccounts = [];
      populatePayableAccounts();
      return;
    }
    state.payableAccounts = await fetchAccountingAccounts(storeId, 'contas_pagar');
    populatePayableAccounts();
  };

  const fetchPdvDetails = async (pdvId) => {
    const response = await fetch(`${API_BASE}/pdvs/${pdvId}`);
    if (!response.ok) {
      const message = await response.json().catch(() => null);
      throw new Error(message?.message || 'Não foi possível carregar as configurações do PDV.');
    }
    return response.json();
  };

  const fillPrinterInputs = (printer, inputs) => {
    if (!inputs) return;
    const { nome, vias } = inputs;
    if (nome) nome.value = printer?.nome || '';
    if (vias) vias.value = printer?.vias || '';
  };

  const populateForm = (pdv) => {
    const impressao = pdv?.configuracoesImpressao || {};
    const venda = pdv?.configuracoesVenda || {};
    const fiscal = pdv?.configuracoesFiscal || {};
    const estoque = pdv?.configuracoesEstoque || {};
    const financeiro = pdv?.configuracoesFinanceiro || {};

    const sempreImprimir = impressao.sempreImprimir || 'perguntar';
    resetRadios('input[name="sempre-imprimir"]', sempreImprimir);

    fillPrinterInputs(impressao.impressoraVenda, elements.printerInputs.venda);
    fillPrinterInputs(impressao.impressoraOrcamento, elements.printerInputs.orcamento);
    fillPrinterInputs(impressao.impressoraContasReceber, elements.printerInputs.contas);
    fillPrinterInputs(impressao.impressoraCaixa, elements.printerInputs.caixa);

    const perfis = Array.isArray(venda.permitirDesconto) ? new Set(venda.permitirDesconto) : new Set();
    document.querySelectorAll('.desconto-checkbox').forEach((checkbox) => {
      checkbox.checked = perfis.has(checkbox.value);
    });

    const tipoEmissao = fiscal.tipoEmissaoPadrao || 'fiscal';
    resetRadios('input[name="tipo-emissao"]', tipoEmissao);

    if (elements.depositoSelect) {
      const depositoValue = estoque.depositoPadrao?._id || estoque.depositoPadrao || '';
      const optionExists = Array.from(elements.depositoSelect.options).some(
        (option) => option.value === String(depositoValue)
      );
      if (
        depositoValue &&
        !state.deposits.some((deposit) => String(deposit._id) === String(depositoValue)) &&
        !optionExists
      ) {
        const fallbackOption = document.createElement('option');
        fallbackOption.value = depositoValue;
        fallbackOption.textContent = 'Depósito não listado';
        elements.depositoSelect.appendChild(fallbackOption);
      }
      elements.depositoSelect.value = depositoValue;
    }

    const contaCorrenteId = extractReferenceId(financeiro.contaCorrente);
    if (elements.bankAccountSelect) {
      const contaCorrenteLabel =
        typeof financeiro.contaCorrente === 'object'
          ? formatBankAccountLabel(financeiro.contaCorrente)
          : 'Conta não listada';
      ensureSelectValue(elements.bankAccountSelect, contaCorrenteId, contaCorrenteLabel);
    }

    const contaReceberId = extractReferenceId(financeiro.contaContabilReceber);
    if (elements.receivableAccountSelect) {
      const contaReceberLabel =
        typeof financeiro.contaContabilReceber === 'object'
          ? formatAccountingAccountLabel(financeiro.contaContabilReceber)
          : 'Conta contábil não listada';
      ensureSelectValue(elements.receivableAccountSelect, contaReceberId, contaReceberLabel);
    }

    const contaPagarId = extractReferenceId(financeiro.contaContabilPagar);
    if (elements.payableAccountSelect) {
      const contaPagarLabel =
        typeof financeiro.contaContabilPagar === 'object'
          ? formatAccountingAccountLabel(financeiro.contaContabilPagar)
          : 'Conta contábil não listada';
      ensureSelectValue(elements.payableAccountSelect, contaPagarId, contaPagarLabel);
    }

    const now = formatDateTime(new Date());
    setStatus(`Configurações carregadas. Última leitura: ${now}.`);
  };

  const handleTabNavigation = () => {
    const triggers = document.querySelectorAll('.tab-trigger');
    const panels = document.querySelectorAll('[data-tab-panel]');
    triggers.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        const target = trigger.getAttribute('data-tab-target');
        triggers.forEach((button) => {
          const isActive = button === trigger;
          button.classList.toggle('text-primary', isActive);
          button.classList.toggle('border-primary', isActive);
          button.classList.toggle('border-transparent', !isActive);
          button.classList.toggle('text-gray-500', !isActive);
        });
        panels.forEach((panel) => {
          panel.classList.toggle('hidden', panel.getAttribute('data-tab-panel') !== target);
        });
      });
    });
  };

  const readPrinterConfig = ({ nome, vias }, label) => {
    const nomeValue = nome?.value.trim() || '';
    const viasValue = vias?.value.trim() || '';

    if (!nomeValue && !viasValue) {
      return { ok: true, value: null };
    }

    if (!nomeValue) {
      notify(`Informe o nome da ${label}.`, 'warning');
      nome?.focus();
      return { ok: false };
    }

    let viasNumber = 1;
    if (viasValue) {
      const parsed = Number(viasValue);
      if (!Number.isFinite(parsed)) {
        notify(`Informe um número válido de vias para a ${label}.`, 'warning');
        vias?.focus();
        return { ok: false };
      }
      const inteiro = Math.trunc(parsed);
      if (inteiro < 1 || inteiro > 10) {
        notify('O número de vias deve estar entre 1 e 10.', 'warning');
        vias?.focus();
        return { ok: false };
      }
      viasNumber = inteiro;
    }

    return { ok: true, value: { nome: nomeValue, vias: viasNumber } };
  };

  const collectFormData = () => {
    const sempre = document.querySelector('input[name="sempre-imprimir"]:checked');
    const sempreImprimir = sempre?.value || 'perguntar';

    const printerVenda = readPrinterConfig(elements.printerInputs.venda, 'impressora de venda');
    if (!printerVenda.ok) return null;
    const printerOrcamento = readPrinterConfig(elements.printerInputs.orcamento, 'impressora de orçamento');
    if (!printerOrcamento.ok) return null;
    const printerContas = readPrinterConfig(elements.printerInputs.contas, 'impressora de contas a receber');
    if (!printerContas.ok) return null;
    const printerCaixa = readPrinterConfig(elements.printerInputs.caixa, 'impressora do caixa');
    if (!printerCaixa.ok) return null;

    const perfis = Array.from(document.querySelectorAll('.desconto-checkbox:checked')).map(
      (checkbox) => checkbox.value
    );

    const tipoEmissao = document.querySelector('input[name="tipo-emissao"]:checked')?.value || 'fiscal';

    const depositoPadrao = elements.depositoSelect?.value || null;

    const contaCorrente = elements.bankAccountSelect?.value || '';
    const contaContabilReceber = elements.receivableAccountSelect?.value || '';
    const contaContabilPagar = elements.payableAccountSelect?.value || '';

    return {
      impressao: {
        sempreImprimir,
        impressoraVenda: printerVenda.value,
        impressoraOrcamento: printerOrcamento.value,
        impressoraContasReceber: printerContas.value,
        impressoraCaixa: printerCaixa.value,
      },
      venda: {
        permitirDesconto: perfis,
      },
      fiscal: {
        tipoEmissaoPadrao: tipoEmissao,
      },
      estoque: {
        depositoPadrao,
      },
      financeiro: {
        contaCorrente: contaCorrente || null,
        contaContabilReceber: contaContabilReceber || null,
        contaContabilPagar: contaContabilPagar || null,
      },
    };
  };

  const updateStateWithPdv = (pdv) => {
    const index = state.pdvs.findIndex((item) => item._id === pdv._id);
    if (index >= 0) {
      state.pdvs[index] = { ...state.pdvs[index], ...pdv };
    }
  };

  const handleSave = async () => {
    if (!state.selectedPdv) {
      notify('Selecione um PDV antes de salvar as configurações.', 'warning');
      return;
    }
    const payload = collectFormData();
    if (!payload) return;

    try {
      toggleSaving(true);
      setStatus('Salvando configurações...');
      const token = getToken();
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente para continuar.');
      }
      const response = await fetch(`${API_BASE}/pdvs/${state.selectedPdv}/configuracoes`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message || 'Não foi possível salvar as configurações.');
      }
      updateStateWithPdv(data);
      populateForm(data);
      notify('Configurações atualizadas com sucesso.', 'success');
      setStatus(`Configurações atualizadas às ${formatDateTime(new Date())}.`);
    } catch (error) {
      console.error('Erro ao salvar configurações do PDV:', error);
      notify(error.message || 'Erro ao salvar configurações do PDV.', 'error');
      setStatus('Não foi possível salvar as configurações. Tente novamente.');
    } finally {
      toggleSaving(false);
    }
  };

  const handleCompanyChange = async () => {
    const value = elements.companySelect?.value || '';
    state.selectedStore = value;
    state.selectedPdv = '';
    clearForm();
    toggleConfigVisibility(false);
    elements.pdvSelect.value = '';
    elements.pdvSelect.disabled = true;
    if (elements.selectionHint) {
      elements.selectionHint.textContent = value
        ? 'Carregando PDVs disponíveis...'
        : 'Escolha a empresa para carregar os PDVs disponíveis.';
    }

    try {
      if (!value) {
        state.pdvs = [];
        state.deposits = [];
        state.bankAccounts = [];
        state.receivableAccounts = [];
        state.payableAccounts = [];
        populatePdvSelect();
        populateDeposits();
        populateBankAccounts();
        populateReceivableAccounts();
        populatePayableAccounts();
        disableConfigFields(true);
        return;
      }
      disableConfigFields(true);
      await Promise.all([
        fetchPdvs(value),
        fetchDeposits(value),
        fetchBankAccounts(value),
        fetchReceivableAccounts(value),
        fetchPayableAccounts(value),
      ]);
      if (elements.selectionHint) {
        elements.selectionHint.textContent =
          state.pdvs.length > 0
            ? 'Selecione o PDV desejado para visualizar as configurações.'
            : 'Nenhum PDV encontrado para a empresa selecionada.';
      }
      disableConfigFields(false);
    } catch (error) {
      console.error('Erro ao carregar dados da empresa:', error);
      notify(error.message || 'Erro ao carregar dados da empresa selecionada.', 'error');
      state.pdvs = [];
      state.deposits = [];
      state.bankAccounts = [];
      state.receivableAccounts = [];
      state.payableAccounts = [];
      populatePdvSelect();
      populateDeposits();
      populateBankAccounts();
      populateReceivableAccounts();
      populatePayableAccounts();
      disableConfigFields(true);
    }
  };

  const handlePdvChange = async () => {
    const value = elements.pdvSelect?.value || '';
    state.selectedPdv = value;
    if (!value) {
      clearForm();
      toggleConfigVisibility(false);
      return;
    }
    disableConfigFields(true);
    setStatus('Carregando configurações do PDV...');
    try {
      const pdv = await fetchPdvDetails(value);
      populateForm(pdv);
      toggleConfigVisibility(true);
      disableConfigFields(false);
    } catch (error) {
      console.error('Erro ao carregar o PDV selecionado:', error);
      notify(error.message || 'Erro ao carregar o PDV selecionado.', 'error');
      toggleConfigVisibility(false);
      setStatus('Não foi possível carregar as configurações do PDV.');
    }
  };

  const bindEvents = () => {
    elements.companySelect?.addEventListener('change', handleCompanyChange);
    elements.pdvSelect?.addEventListener('change', handlePdvChange);
    elements.saveButton?.addEventListener('click', (event) => {
      event.preventDefault();
      if (state.saving) return;
      handleSave();
    });
  };

  const init = async () => {
    queryElements();
    handleTabNavigation();
    disableConfigFields(true);
    try {
      await fetchStores();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      notify(error.message || 'Erro ao carregar a lista de empresas.', 'error');
    }
    bindEvents();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
