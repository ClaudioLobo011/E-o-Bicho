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
  };

  const state = {
    companies: [],
    saving: false,
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

  const updateStatus = (message) => {
    if (elements.status) {
      elements.status.textContent = message || 'Nenhum envio realizado ainda.';
    }
  };

  const setSavingState = (saving) => {
    state.saving = saving;
    if (elements.submitButton) {
      elements.submitButton.disabled = saving;
      elements.submitButton.classList.toggle('opacity-60', saving);
      elements.submitButton.classList.toggle('pointer-events-none', saving);
    }
    if (elements.submitLabel) {
      elements.submitLabel.textContent = saving ? 'Salvando...' : 'Salvar conta';
    }
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

    try {
      const payload = buildPayload();
      validatePayload(payload);

      setSavingState(true);
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE}/bank-accounts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = (await parseErrorResponse(response)) || 'Não foi possível salvar a conta bancária.';
        throw new Error(message);
      }

      notify('Conta bancária salva com sucesso!', 'success');
      const now = new Date();
      updateStatus(`Conta salva em ${now.toLocaleString('pt-BR')}`);
      if (elements.form) {
        elements.form.reset();
      }
      if (elements.company) {
        elements.company.value = '';
      }
      if (elements.bank) {
        elements.bank.value = '';
      }
    } catch (error) {
      notify(error?.message || 'Não foi possível salvar a conta bancária.', 'error');
    } finally {
      setSavingState(false);
    }
  };

  const handleReset = () => {
    updateStatus('Nenhum envio realizado ainda.');
    setSavingState(false);
  };

  const init = () => {
    initElements();
    if (!elements.form) return;

    loadBanks();
    loadCompanies();

    elements.form.addEventListener('submit', handleSubmit);
    elements.form.addEventListener('reset', handleReset);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
