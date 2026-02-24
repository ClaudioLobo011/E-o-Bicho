(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const qs = (selector, root = document) => root.querySelector(selector);

  const state = {
    activeTab: 'conferencia',
    companies: [],
    pdvs: [],
    caixas: [],
    paymentMethods: [],
    loadingPaymentMethods: false,
  };

  function getToken() {
    try {
      if (typeof window.getToken === 'function') {
        const tokenFromGlobal = window.getToken();
        if (tokenFromGlobal) return tokenFromGlobal;
      }
      const rawLogged = localStorage.getItem('loggedInUser');
      if (rawLogged) {
        const parsed = JSON.parse(rawLogged);
        if (parsed?.token) return parsed.token;
      }
      return localStorage.getItem('auth_token') || '';
    } catch (_) {
      return '';
    }
  }

  function notify(message, type = 'info') {
    if (typeof window.notify === 'function') {
      window.notify(message, type);
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatCurrencyBRL(value) {
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(amount);
    } catch (_) {
      return `R$ ${amount.toFixed(2).replace('.', ',')}`;
    }
  }

  function parseCurrencyInput(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const onlyNumbersAndSeparators = raw.replace(/[^\d,.-]/g, '');
    const negative = onlyNumbersAndSeparators.includes('-');
    const lastComma = onlyNumbersAndSeparators.lastIndexOf(',');
    const lastDot = onlyNumbersAndSeparators.lastIndexOf('.');
    const decimalIndex = Math.max(lastComma, lastDot);
    let normalized;
    if (decimalIndex >= 0) {
      const intPart = onlyNumbersAndSeparators.slice(0, decimalIndex).replace(/[^\d]/g, '');
      const decPart = onlyNumbersAndSeparators.slice(decimalIndex + 1).replace(/[^\d]/g, '');
      normalized = `${intPart || '0'}.${decPart}`;
    } else {
      normalized = onlyNumbersAndSeparators.replace(/[^\d]/g, '');
    }
    if (negative && normalized) normalized = `-${normalized}`;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function setTodayDefaults() {
    const start = qs('#cashcheck-start');
    const end = qs('#cashcheck-end');
    if (!start || !end) return;
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    if (!start.value) start.value = iso;
    if (!end.value) end.value = iso;
  }

  function renderTabs() {
    const buttons = qsa('[data-cashcheck-tab]');
    const panels = qsa('[data-cashcheck-panel]');
    buttons.forEach((button) => {
      const isActive = button.getAttribute('data-cashcheck-tab') === state.activeTab;
      button.setAttribute('aria-selected', String(isActive));
      button.classList.toggle('border-primary', isActive);
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-transparent', !isActive);
      button.classList.toggle('text-gray-500', !isActive);
    });
    panels.forEach((panel) => {
      const isActive = panel.getAttribute('data-cashcheck-panel') === state.activeTab;
      panel.classList.toggle('hidden', !isActive);
    });
  }

  function handleTabClick(event) {
    const button = event.target.closest('[data-cashcheck-tab]');
    if (!button) return;
    const next = button.getAttribute('data-cashcheck-tab');
    if (!next || next === state.activeTab) return;
    state.activeTab = next;
    renderTabs();
  }

  function setFeedback(message) {
    const el = qs('#cashcheck-feedback');
    if (!el) return;
    el.innerHTML = '<i class="fas fa-circle-info text-primary"></i><span>' + String(message || '') + '</span>';
  }

  function renderConferencePaymentMethods() {
    const tbody = qs('#cashcheck-conference-payment-methods-body');
    if (!tbody) return;

    const companyId = qs('#cashcheck-company')?.value || '';
    if (!companyId) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">
            Selecione uma empresa para carregar os meios de pagamento.
          </td>
        </tr>`;
      updateConferenceTotals();
      return;
    }

    if (state.loadingPaymentMethods) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">
            Carregando meios de pagamento...
          </td>
        </tr>`;
      updateConferenceTotals();
      return;
    }

    if (!Array.isArray(state.paymentMethods) || !state.paymentMethods.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">
            Nenhum meio de pagamento cadastrado para a empresa selecionada.
          </td>
        </tr>`;
      updateConferenceTotals();
      return;
    }

    tbody.innerHTML = state.paymentMethods.map((method) => {
      const methodId = String(method?._id || method?.id || '');
      const label = escapeHtml(
        method?.nome || method?.name || method?.descricao || method?.descricaoExibicao || 'Meio de pagamento'
      );
      const previsto = Number(method?.valorPrevisto || 0);
      return `
        <tr data-payment-method-id="${escapeHtml(methodId)}">
          <td class="px-4 py-3 text-gray-700">${label}</td>
          <td class="px-4 py-3 text-right text-gray-600" data-cashcheck-previsto="${escapeHtml(previsto)}">${formatCurrencyBRL(previsto)}</td>
          <td class="px-4 py-3 text-right">
            <input
              type="text"
              placeholder="0,00"
              data-cashcheck-apurado-input="true"
              class="w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
          </td>
          <td class="px-4 py-3 text-right text-gray-600" data-cashcheck-diferenca="true">${formatCurrencyBRL(0)}</td>
          <td class="px-4 py-3">
            <input
              type="text"
              class="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-primary focus:ring-1 focus:ring-primary/20"
              placeholder="Observação"
            >
          </td>
        </tr>`;
    }).join('');
    updateConferenceTotals();
  }

  function updateConferenceTotals() {
    const tbody = qs('#cashcheck-conference-payment-methods-body');
    const totalPrevistoEl = qs('#cashcheck-total-previsto');
    const totalApuradoEl = qs('#cashcheck-total-apurado');
    const totalDiferencaEl = qs('#cashcheck-total-diferenca');
    const statusEl = qs('#cashcheck-status');

    if (!tbody) return;

    let totalPrevisto = 0;
    let totalApurado = 0;
    let totalDiferenca = 0;
    let hasRows = false;
    let hasUserInput = false;

    qsa('tr[data-payment-method-id]', tbody).forEach((row) => {
      hasRows = true;
      const previstoCell = qs('[data-cashcheck-previsto]', row);
      const apuradoInput = qs('[data-cashcheck-apurado-input]', row);
      const diferencaCell = qs('[data-cashcheck-diferenca]', row);

      const previsto = parseCurrencyInput(previstoCell?.getAttribute('data-cashcheck-previsto') || previstoCell?.textContent || 0);
      const apuradoRaw = apuradoInput?.value || '';
      const apurado = parseCurrencyInput(apuradoRaw);
      const diferenca = apurado - previsto;

      if (apuradoRaw.trim()) hasUserInput = true;

      totalPrevisto += previsto;
      totalApurado += apurado;
      totalDiferenca += diferenca;

      if (diferencaCell) {
        diferencaCell.textContent = formatCurrencyBRL(diferenca);
        diferencaCell.classList.toggle('text-gray-600', Math.abs(diferenca) < 0.005);
        diferencaCell.classList.toggle('text-emerald-600', diferenca > 0.004);
        diferencaCell.classList.toggle('text-rose-600', diferenca < -0.004);
      }
    });

    if (totalPrevistoEl) totalPrevistoEl.textContent = formatCurrencyBRL(totalPrevisto);
    if (totalApuradoEl) totalApuradoEl.textContent = formatCurrencyBRL(totalApurado);
    if (totalDiferencaEl) {
      totalDiferencaEl.textContent = formatCurrencyBRL(totalDiferenca);
      totalDiferencaEl.classList.toggle('text-amber-600', Math.abs(totalDiferenca) >= 0.005);
      totalDiferencaEl.classList.toggle('text-emerald-600', Math.abs(totalDiferenca) < 0.005);
    }
    if (statusEl) {
      let label = 'Aguardando conferência';
      statusEl.classList.remove('text-gray-700', 'text-amber-700', 'text-emerald-700');
      if (hasRows && hasUserInput) {
        if (Math.abs(totalDiferenca) < 0.005) {
          label = 'Conferido sem diferença';
          statusEl.classList.add('text-emerald-700');
        } else {
          label = 'Com divergência';
          statusEl.classList.add('text-amber-700');
        }
      } else {
        statusEl.classList.add('text-gray-700');
      }
      statusEl.textContent = label;
    }
  }

  function getCompanyLabelById(id) {
    const company = (state.companies || []).find((item) => String(item?._id || '') === String(id || ''));
    return company?.nomeFantasia || company?.nome || company?.razaoSocial || String(id || '');
  }

  function getPdvLabelById(id) {
    const pdv = (state.pdvs || []).find((item) => String(item?._id || '') === String(id || ''));
    return pdv?.apelido || pdv?.nome || pdv?.codigo || String(id || '');
  }

  function populateCompanySelect() {
    const select = qs('#cashcheck-company');
    if (!select) return;
    const options = ['<option value="">Selecione uma empresa</option>'];
    (state.companies || []).forEach((company) => {
      const id = String(company?._id || '');
      if (!id) return;
      const label = company?.nomeFantasia || company?.nome || company?.razaoSocial || 'Empresa sem nome';
      options.push(`<option value="${id}">${label}</option>`);
    });
    select.innerHTML = options.join('');
  }

  function populatePdvSelect() {
    const select = qs('#cashcheck-pdv');
    if (!select) return;
    const companyId = qs('#cashcheck-company')?.value || '';
    if (!companyId) {
      select.innerHTML = '<option value="">Selecione uma empresa</option>';
      return;
    }
    const options = ['<option value="">Selecione um PDV</option>'];
    (state.pdvs || []).forEach((pdv) => {
      const id = String(pdv?._id || '');
      if (!id) return;
      const label = pdv?.apelido || pdv?.nome || pdv?.codigo || 'PDV sem nome';
      options.push(`<option value="${id}">${label}</option>`);
    });
    if (!state.pdvs.length) {
      options.push('<option value="" disabled>Nenhum PDV encontrado</option>');
    }
    select.innerHTML = options.join('');
  }

  function formatDateTimeLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
    } catch (_) {
      return date.toISOString();
    }
  }

  function buildCaixaOptionLabel(caixa) {
    const status = caixa?.status === 'aberto' ? 'Aberto' : 'Fechado';
    const abertura = formatDateTimeLabel(caixa?.aberturaData);
    const fechamento = formatDateTimeLabel(caixa?.fechamentoData);
    const periodLabel = fechamento ? `${abertura} → ${fechamento}` : (abertura ? `Desde ${abertura}` : 'Sem período');
    return `${status} • ${periodLabel}`;
  }

  function populateCaixaSelect() {
    const select = qs('#cashcheck-caixa');
    if (!select) return;
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    if (!pdvId) {
      select.innerHTML = '<option value="">Selecione um PDV</option>';
      return;
    }
    const options = ['<option value="">Selecione um caixa</option>'];
    (state.caixas || []).forEach((caixa, index) => {
      const value = caixa?.id || `caixa-${index}`;
      options.push(`<option value="${value}">${buildCaixaOptionLabel(caixa)}</option>`);
    });
    if (!state.caixas.length) {
      options.push('<option value="" disabled>Nenhum caixa encontrado no período</option>');
    }
    select.innerHTML = options.join('');
  }

  function clearPdvAndCaixa() {
    state.pdvs = [];
    state.caixas = [];
    populatePdvSelect();
    populateCaixaSelect();
  }

  function getPeriodRange() {
    const startValue = qs('#cashcheck-start')?.value || '';
    const endValue = qs('#cashcheck-end')?.value || '';
    const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
    const end = endValue ? new Date(`${endValue}T23:59:59.999`) : null;
    return {
      start: start && !Number.isNaN(start.getTime()) ? start : null,
      end: end && !Number.isNaN(end.getTime()) ? end : null,
    };
  }

  function caixaMatchesSelectedPeriod(caixa) {
    if (!caixa) return false;
    const { start, end } = getPeriodRange();
    if (!start && !end) return true;
    const abertura = caixa?.aberturaData ? new Date(caixa.aberturaData) : null;
    const fechamento = caixa?.fechamentoData ? new Date(caixa.fechamentoData) : null;
    const openAt = abertura && !Number.isNaN(abertura.getTime()) ? abertura : null;
    const closeAt = fechamento && !Number.isNaN(fechamento.getTime()) ? fechamento : null;
    const intervalStart = openAt || closeAt;
    const intervalEnd = closeAt || openAt;
    if (!intervalStart && !intervalEnd) return true;
    const left = intervalStart || intervalEnd;
    const right = intervalEnd || intervalStart;
    if (start && right && right < start) return false;
    if (end && left && left > end) return false;
    return true;
  }

  async function fetchPdvsForSelectedCompany() {
    const companyId = qs('#cashcheck-company')?.value || '';
    const pdvSelect = qs('#cashcheck-pdv');
    state.pdvs = [];
    state.caixas = [];
    populatePdvSelect();
    populateCaixaSelect();
    if (!companyId) return;
    if (pdvSelect) {
      pdvSelect.disabled = true;
      pdvSelect.innerHTML = '<option value="">Carregando PDVs...</option>';
    }
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/pdvs?empresa=${encodeURIComponent(companyId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os PDVs da empresa selecionada.');
      }
      const payload = await response.json().catch(() => null);
      state.pdvs = Array.isArray(payload?.pdvs) ? payload.pdvs : [];
    } catch (error) {
      state.pdvs = [];
      notify(error?.message || 'Falha ao carregar PDVs.', 'error');
    } finally {
      populatePdvSelect();
      if (pdvSelect) pdvSelect.disabled = false;
    }
  }

  async function fetchPaymentMethodsForSelectedCompany() {
    const companyId = qs('#cashcheck-company')?.value || '';
    state.paymentMethods = [];
    state.loadingPaymentMethods = Boolean(companyId);
    renderConferencePaymentMethods();
    if (!companyId) return;

    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/payment-methods?company=${encodeURIComponent(companyId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os meios de pagamento da empresa selecionada.');
      }
      const payload = await response.json().catch(() => null);
      state.paymentMethods = Array.isArray(payload?.paymentMethods)
        ? payload.paymentMethods
        : (Array.isArray(payload?.methods) ? payload.methods : []);
    } catch (error) {
      state.paymentMethods = [];
      notify(error?.message || 'Falha ao carregar meios de pagamento.', 'error');
    } finally {
      state.loadingPaymentMethods = false;
      renderConferencePaymentMethods();
    }
  }

  async function fetchCaixasForSelectedPdv() {
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const caixaSelect = qs('#cashcheck-caixa');
    state.caixas = [];
    populateCaixaSelect();
    if (!pdvId) return;
    if (caixaSelect) {
      caixaSelect.disabled = true;
      caixaSelect.innerHTML = '<option value="">Carregando caixas...</option>';
    }
    try {
      const token = getToken();
      const start = qs('#cashcheck-start')?.value || '';
      const end = qs('#cashcheck-end')?.value || '';
      const params = new URLSearchParams();
      if (start) params.set('start', `${start}T00:00:00.000Z`);
      if (end) params.set('end', `${end}T23:59:59.999Z`);
      const historyResponse = await fetch(
        `${API_BASE}/pdvs/${encodeURIComponent(pdvId)}/caixas${params.toString() ? `?${params.toString()}` : ''}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (historyResponse.ok) {
        const payload = await historyResponse.json().catch(() => null);
        state.caixas = Array.isArray(payload?.caixas) ? payload.caixas : [];
        if (!state.caixas.length) {
          setFeedback('Nenhum caixa do PDV selecionado encontrado no período.');
        }
        return;
      }

      const response = await fetch(`${API_BASE}/pdvs/${encodeURIComponent(pdvId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os dados de caixa do PDV selecionado.');
      }
      const pdv = await response.json().catch(() => null);
      const caixaStatus = pdv?.caixa?.status || (pdv?.caixa?.aberto ? 'aberto' : 'fechado');
      const caixaInfo = pdv?.caixaInfo || pdv?.caixa || {};
      const snapshot = {
        id: `pdv-${pdvId}-atual`,
        status: caixaStatus,
        aberto: Boolean(pdv?.caixa?.aberto ?? pdv?.caixaAberto),
        aberturaData: caixaInfo?.aberturaData || pdv?.caixa?.aberturaData || null,
        fechamentoData: caixaInfo?.fechamentoData || pdv?.caixa?.fechamentoData || null,
        fechamentoPrevisto: caixaInfo?.fechamentoPrevisto || 0,
        fechamentoApurado: caixaInfo?.fechamentoApurado || 0,
      };
      state.caixas = caixaMatchesSelectedPeriod(snapshot) ? [snapshot] : [];
      if (!state.caixas.length) {
        setFeedback('Nenhum caixa do PDV selecionado encontrado no período (dados atuais/último caixa).');
      }
    } catch (error) {
      state.caixas = [];
      notify(error?.message || 'Falha ao carregar caixas do PDV.', 'error');
    } finally {
      populateCaixaSelect();
      if (caixaSelect) caixaSelect.disabled = false;
    }
  }

  async function fetchAllowedCompanies() {
    const select = qs('#cashcheck-company');
    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">Carregando empresas...</option>';
    }
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/stores/allowed`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar as empresas permitidas.');
      }
      const payload = await response.json().catch(() => null);
      const list = Array.isArray(payload?.stores) ? payload.stores : (Array.isArray(payload) ? payload : []);
      state.companies = Array.isArray(list) ? list : [];
      populateCompanySelect();
      if (!state.companies.length) {
        setFeedback('Nenhuma empresa permitida encontrada para este usuário.');
      }
    } catch (error) {
      state.companies = [];
      populateCompanySelect();
      setFeedback('Falha ao carregar empresas permitidas.');
      notify(error?.message || 'Falha ao carregar empresas permitidas.', 'error');
    } finally {
      if (select) {
        select.disabled = false;
      }
    }
  }

  function handleApplyFilters() {
    const companyId = qs('#cashcheck-company')?.value || '';
    const company = companyId ? getCompanyLabelById(companyId) : 'Selecione uma empresa';
    const pdvId = qs('#cashcheck-pdv')?.value || '';
    const pdv = pdvId ? getPdvLabelById(pdvId) : 'Selecione um PDV';
    const caixaValue = qs('#cashcheck-caixa')?.value || '';
    const caixa = caixaValue
      ? (qs('#cashcheck-caixa')?.selectedOptions?.[0]?.textContent?.trim() || caixaValue)
      : 'Selecione um caixa';
    const start = qs('#cashcheck-start')?.value || 'sem data inicial';
    const end = qs('#cashcheck-end')?.value || 'sem data final';
    setFeedback('Filtros aplicados: ' + company + ' / ' + pdv + ' / ' + caixa + ' / ' + start + ' até ' + end + '.');
    notify('Filtros aplicados na Conferência de Caixa.', 'success');
  }

  function handleClearFilters() {
    const company = qs('#cashcheck-company');
    const pdv = qs('#cashcheck-pdv');
    const caixa = qs('#cashcheck-caixa');
    const start = qs('#cashcheck-start');
    const end = qs('#cashcheck-end');
    if (company) company.value = '';
    if (pdv) pdv.value = '';
    if (caixa) caixa.value = '';
    clearPdvAndCaixa();
    state.paymentMethods = [];
    state.loadingPaymentMethods = false;
    renderConferencePaymentMethods();
    if (start) start.value = '';
    if (end) end.value = '';
    setTodayDefaults();
    setFeedback('Filtros redefinidos para o período atual.');
  }

  function bindEvents() {
    const tablist = qs('[role="tablist"]');
    tablist?.addEventListener('click', handleTabClick);
    qs('#cashcheck-apply')?.addEventListener('click', handleApplyFilters);
    qs('#cashcheck-clear')?.addEventListener('click', handleClearFilters);
    qs('#cashcheck-company')?.addEventListener('change', async () => {
      await Promise.all([
        fetchPdvsForSelectedCompany(),
        fetchPaymentMethodsForSelectedCompany(),
      ]);
    });
    qs('#cashcheck-pdv')?.addEventListener('change', async () => {
      await fetchCaixasForSelectedPdv();
    });
    qs('#cashcheck-start')?.addEventListener('change', async () => {
      if (qs('#cashcheck-pdv')?.value) {
        await fetchCaixasForSelectedPdv();
      }
    });
    qs('#cashcheck-end')?.addEventListener('change', async () => {
      if (qs('#cashcheck-pdv')?.value) {
        await fetchCaixasForSelectedPdv();
      }
    });
    qs('#cashcheck-conference-payment-methods-body')?.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches('[data-cashcheck-apurado-input]')) return;
      updateConferenceTotals();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTodayDefaults();
    renderTabs();
    renderConferencePaymentMethods();
    bindEvents();
    fetchAllowedCompanies();
    clearPdvAndCaixa();
  });
})();
