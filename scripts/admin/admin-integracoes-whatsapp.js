document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = API_CONFIG.BASE_URL;
  const WEBHOOK_URL = 'https://callback.peteobicho.com.br/webhooks/whatsapp';
  const LOG_LIMIT = 50;

  const elements = {
    companySelect: document.getElementById('whatsapp-company-select'),
    companyName: document.querySelector('[data-company-name]'),
    companyStatus: document.querySelector('[data-company-status]'),
    companyCnpj: document.querySelector('[data-company-cnpj]'),
    companyNumbers: document.querySelector('[data-company-numbers]'),
    numbersTableBody: document.getElementById('whatsapp-numbers-table-body'),
    numbersEmpty: document.getElementById('whatsapp-numbers-empty'),
    addNumberButton: document.getElementById('add-whatsapp-number-btn'),
    modal: document.getElementById('whatsapp-number-modal'),
    modalTitle: document.getElementById('whatsapp-number-modal-title'),
    modalForm: document.getElementById('whatsapp-number-form'),
    modalName: document.getElementById('whatsapp-number-name'),
    modalPhone: document.getElementById('whatsapp-number-phone'),
    modalPhoneId: document.getElementById('whatsapp-number-phone-id'),
    modalPin: document.getElementById('whatsapp-number-pin'),
    modalProvider: document.getElementById('whatsapp-number-provider'),
    pinToggle: document.querySelector('[data-whatsapp-pin-toggle]'),
    statusBadge: document.getElementById('whatsapp-status-badge'),
    statusDescription: document.getElementById('whatsapp-status-description'),
    webhookUrl: document.getElementById('whatsapp-webhook-url'),
    appIdInput: document.getElementById('whatsapp-app-id'),
    appSecretInput: document.getElementById('whatsapp-app-secret'),
    wabaIdInput: document.getElementById('whatsapp-waba-id'),
    accessTokenInput: document.getElementById('whatsapp-access-token'),
    verifyTokenInput: document.getElementById('whatsapp-verify-token'),
    saveTokensButton: document.getElementById('whatsapp-save-tokens'),
    verifyWebhookButton: document.getElementById('whatsapp-verify-webhooks'),
    copyWebhook: document.querySelector('[data-copy-webhook]'),
    copyAccessToken: document.querySelector('[data-copy-access-token]'),
    copyVerifyToken: document.querySelector('[data-copy-verify-token]'),
    tabButtons: Array.from(document.querySelectorAll('.whatsapp-tab-button')),
    tabPanels: Array.from(document.querySelectorAll('[data-whatsapp-panel]')),
    sendOrigin: document.getElementById('whatsapp-send-origin'),
    sendDestination: document.getElementById('whatsapp-send-destination'),
    sendMessage: document.getElementById('whatsapp-send-message'),
    sendButton: document.getElementById('whatsapp-send-btn'),
    sendClear: document.getElementById('whatsapp-send-clear'),
    receiveDestination: document.getElementById('whatsapp-receive-destination'),
    receiveOrigin: document.getElementById('whatsapp-receive-origin'),
    receiveMessage: document.getElementById('whatsapp-receive-message'),
    receiveButton: document.getElementById('whatsapp-receive-btn'),
    outgoingFilter: document.getElementById('whatsapp-outgoing-filter'),
    incomingFilter: document.getElementById('whatsapp-incoming-filter'),
    outgoingBody: document.getElementById('whatsapp-outgoing-body'),
    incomingBody: document.getElementById('whatsapp-incoming-body'),
    outgoingEmpty: document.getElementById('whatsapp-outgoing-empty'),
    incomingEmpty: document.getElementById('whatsapp-incoming-empty'),
  };

  if (!elements.companySelect) return;

  const state = {
    companies: [],
    selectedCompanyId: '',
    numbersByCompany: {},
    appTokensByCompany: {},
    editingNumberId: '',
    logsByCompany: {
      outgoing: {},
      incoming: {},
    },
    filters: {
      outgoing: '',
      incoming: '',
    },
  };

  const badgeBase = 'inline-flex items-center gap-1 rounded-full border font-semibold';
  const badgeCompanySize = 'px-2 py-1 text-[11px]';
  const badgeStatusSize = 'px-3 py-1 text-xs';

  const styles = {
    connected: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    disconnected: 'bg-rose-50 text-rose-700 border-rose-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    attention: 'bg-amber-50 text-amber-700 border-amber-200',
    inactive: 'bg-gray-100 text-gray-700 border-gray-200',
    sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    error: 'bg-rose-50 text-rose-700 border-rose-200',
    received: 'bg-sky-50 text-sky-700 border-sky-200',
  };

  const notify = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type, 3200);
    } else if (type === 'error') {
      alert(message);
    } else {
      console.log(message);
    }
  };

  const formatDate = (value) => {
    if (!value) return 'Sem registro';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sem registro';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const normalize = (value) => String(value || '').toLowerCase();

  const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const isValidObjectId = (value) => typeof value === 'string' && value.length === 24;

  const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

  const setBadge = (element, label, styleClass, sizeClass) => {
    if (!element) return;
    element.textContent = label || '--';
    element.className = `${badgeBase} ${sizeClass} ${styleClass || styles.inactive}`;
  };

  const getToken = () => {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  };

  const authHeaders = (json = true) => {
    const token = getToken();
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const ensureCompanyState = (companyId) => {
    if (!companyId) return;
    if (!state.numbersByCompany[companyId]) state.numbersByCompany[companyId] = [];
    if (!state.logsByCompany.outgoing[companyId]) state.logsByCompany.outgoing[companyId] = [];
    if (!state.logsByCompany.incoming[companyId]) state.logsByCompany.incoming[companyId] = [];
    if (!state.appTokensByCompany[companyId]) {
      state.appTokensByCompany[companyId] = {
        appId: '',
        appSecret: '',
        wabaId: '',
        accessToken: '',
        verifyToken: '',
      };
    }
  };

  const getSelectedCompany = () =>
    state.companies.find((company) => company.id === state.selectedCompanyId) || null;

  const getNumbersForCompany = (companyId) =>
    state.numbersByCompany[companyId] ? [...state.numbersByCompany[companyId]] : [];

  const getNumberById = (numberId) =>
    getNumbersForCompany(state.selectedCompanyId).find((number) => number.id === numberId) || null;

  const getTokensForCompany = (companyId) => {
    ensureCompanyState(companyId);
    return state.appTokensByCompany[companyId] || {};
  };

  const hasRequiredTokens = (tokens) => {
    const required = ['appId', 'appSecret', 'wabaId', 'accessToken', 'verifyToken'];
    return required.every((key) => tokens && tokens[key]);
  };

  const renderAppTokens = () => {
    const tokens = getTokensForCompany(state.selectedCompanyId);
    if (elements.appIdInput) elements.appIdInput.value = tokens.appId || '';
    if (elements.appSecretInput) elements.appSecretInput.value = tokens.appSecret || '';
    if (elements.wabaIdInput) elements.wabaIdInput.value = tokens.wabaId || '';
    if (elements.accessTokenInput) elements.accessTokenInput.value = tokens.accessToken || '';
    if (elements.verifyTokenInput) elements.verifyTokenInput.value = tokens.verifyToken || '';
  };

  const renderCompanySummary = () => {
    const company = getSelectedCompany();
    if (!company) {
      if (elements.companyName) elements.companyName.textContent = '--';
      if (elements.companyCnpj) elements.companyCnpj.textContent = '--';
      if (elements.companyNumbers) elements.companyNumbers.textContent = '0';
      setBadge(elements.companyStatus, '--', styles.inactive, badgeCompanySize);
      return;
    }

    const numbers = getNumbersForCompany(company.id);
    if (elements.companyName) elements.companyName.textContent = company.name || '--';
    if (elements.companyCnpj) {
      elements.companyCnpj.textContent = company.cnpj ? `CNPJ: ${company.cnpj}` : 'CNPJ nao informado';
    }
    if (elements.companyNumbers) elements.companyNumbers.textContent = numbers.length;
    setBadge(elements.companyStatus, 'Ativa', styles.active, badgeCompanySize);
  };

  const resolveNumberStatusStyle = (status) => {
    if (status === 'Conectado') return styles.connected;
    if (status === 'Pendente') return styles.pending;
    return styles.disconnected;
  };

  const resolveLogStatusStyle = (status) => {
    if (status === 'Enviado') return styles.sent;
    if (status === 'Recebido') return styles.received;
    if (status === 'Erro') return styles.error;
    return styles.inactive;
  };

  const computeIntegrationStatus = (numbers, tokens) => {
    if (!hasRequiredTokens(tokens)) {
      return {
        label: 'Atencao',
        description: 'Informe App ID, App Secret, WABA ID, Token de acesso e Verify Token para habilitar envio e webhook.',
        style: styles.attention,
      };
    }

    const connected = numbers.filter((item) => item.status === 'Conectado').length;
    const pending = numbers.filter((item) => item.status === 'Pendente').length;
    const total = numbers.length;

    if (connected === 0 && pending === 0) {
      return {
        label: 'Inativo',
        description: total ? 'Numeros desconectados aguardando reativacao.' : 'Nenhum numero conectado.',
        style: styles.inactive,
      };
    }

    if (connected > 0 && pending === 0) {
      return {
        label: 'Ativo',
        description: `${connected} numero(s) conectado(s) e operando normalmente.`,
        style: styles.active,
      };
    }

    return {
      label: 'Atencao',
      description: `${connected} conectado(s), ${pending} pendente(s) de ativacao.`,
      style: styles.attention,
    };
  };

  const renderNumbersTable = () => {
    if (!elements.numbersTableBody) return;

    const numbers = getNumbersForCompany(state.selectedCompanyId);
    elements.numbersTableBody.innerHTML = '';

    if (!numbers.length) {
      elements.numbersEmpty?.classList.remove('hidden');
      return;
    }

    elements.numbersEmpty?.classList.add('hidden');

    numbers.forEach((number) => {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.className = 'px-4 py-3';
      const nameWrap = document.createElement('div');
      nameWrap.className = 'flex flex-col';
      const name = document.createElement('span');
      name.className = 'font-semibold text-gray-800';
      name.textContent = number.displayName || 'Numero';
      const phone = document.createElement('span');
      phone.className = 'text-xs text-gray-500';
      phone.textContent = number.phoneNumber || '--';
      const phoneId = document.createElement('span');
      phoneId.className = 'text-[11px] text-gray-400';
      phoneId.textContent = number.phoneNumberId ? `ID: ${number.phoneNumberId}` : 'ID nao informado';
      nameWrap.appendChild(name);
      nameWrap.appendChild(phone);
      nameWrap.appendChild(phoneId);
      nameTd.appendChild(nameWrap);

      const statusTd = document.createElement('td');
      statusTd.className = 'px-4 py-3';
      const statusBadge = document.createElement('span');
      setBadge(statusBadge, number.status, resolveNumberStatusStyle(number.status), badgeCompanySize);
      statusTd.appendChild(statusBadge);

      const providerTd = document.createElement('td');
      providerTd.className = 'px-4 py-3 text-gray-600';
      providerTd.textContent = number.provider || '--';

      const lastTd = document.createElement('td');
      lastTd.className = 'px-4 py-3 text-gray-600 text-xs';
      lastTd.textContent = formatDate(number.lastSyncAt);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'px-4 py-3 text-right';
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'flex flex-wrap items-center justify-end gap-2';

      const actions = [
        { label: 'Ver detalhes', action: 'details' },
        { label: 'Desconectar', action: 'disconnect' },
        { label: 'Reiniciar', action: 'restart' },
        { label: 'Registrar', action: 'register' },
      ];

      actions.forEach(({ label, action }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className =
          'rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-primary hover:text-primary';
        button.textContent = label;
        button.dataset.action = action;
        button.dataset.numberId = number.id;
        actionsWrap.appendChild(button);
      });

      actionsTd.appendChild(actionsWrap);

      tr.appendChild(nameTd);
      tr.appendChild(statusTd);
      tr.appendChild(providerTd);
      tr.appendChild(lastTd);
      tr.appendChild(actionsTd);
      elements.numbersTableBody.appendChild(tr);
    });
  };

  const renderIntegrationStatus = () => {
    const numbers = getNumbersForCompany(state.selectedCompanyId);
    const tokens = getTokensForCompany(state.selectedCompanyId);
    const status = computeIntegrationStatus(numbers, tokens);
    setBadge(elements.statusBadge, status.label, status.style, badgeStatusSize);
    if (elements.statusDescription) elements.statusDescription.textContent = status.description;
  };

  const populateCompanySelect = () => {
    if (!elements.companySelect) return;
    elements.companySelect.innerHTML = '';

    if (!state.companies.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhuma empresa encontrada';
      elements.companySelect.appendChild(option);
      elements.companySelect.disabled = true;
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione uma empresa';
    elements.companySelect.appendChild(placeholder);

    state.companies.forEach((company) => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = company.name;
      elements.companySelect.appendChild(option);
    });

    elements.companySelect.disabled = false;
  };

  const populateNumberSelect = (select, placeholder) => {
    if (!select) return;
    const numbers = getNumbersForCompany(state.selectedCompanyId).filter(
      (number) => number.status !== 'Desconectado'
    );
    select.innerHTML = '';

    const baseOption = document.createElement('option');
    baseOption.value = '';
    baseOption.textContent = placeholder;
    select.appendChild(baseOption);

    numbers.forEach((number) => {
      const option = document.createElement('option');
      option.value = number.id;
      const statusSuffix = number.status && number.status !== 'Conectado' ? ` - ${number.status}` : '';
      const idSuffix = number.phoneNumberId ? ` - ID ${number.phoneNumberId}` : '';
      option.textContent = `${number.displayName} (${number.phoneNumber})${idSuffix}${statusSuffix}`;
      select.appendChild(option);
    });

    select.disabled = numbers.length === 0;
  };

  const renderNumberSelects = () => {
    populateNumberSelect(elements.sendOrigin, 'Selecione um numero');
    populateNumberSelect(elements.receiveDestination, 'Selecione um numero');
  };

  const logMatchesFilter = (log, filterValue) => {
    const haystack = normalize(
      `${log.destination || ''} ${log.origin || ''} ${log.message || ''} ${log.numberLabel || ''}`
    );
    const needle = normalize(filterValue);
    return !needle || haystack.includes(needle);
  };

  const createLogMessageCell = (message) => {
    const wrap = document.createElement('div');
    wrap.className = 'max-w-[14rem] truncate';
    wrap.textContent = message || '--';
    wrap.title = message || '';
    return wrap;
  };

  const normalizeLogEntry = (log) => ({
    id: log?.id || log?._id || createId('log'),
    createdAt: log?.createdAt || null,
    numberLabel: log?.numberLabel || log?.phoneNumber || '',
    phoneNumberId: log?.phoneNumberId || '',
    phoneNumber: log?.phoneNumber || '',
    origin: log?.origin || '',
    destination: log?.destination || '',
    message: log?.message || '',
    status: log?.status || '',
    direction: log?.direction || '',
  });

  const renderLogs = (kind) => {
    const isOutgoing = kind === 'outgoing';
    const body = isOutgoing ? elements.outgoingBody : elements.incomingBody;
    const emptyState = isOutgoing ? elements.outgoingEmpty : elements.incomingEmpty;
    if (!body) return;

    const companyId = state.selectedCompanyId;
    const logs = state.logsByCompany[kind][companyId] ? [...state.logsByCompany[kind][companyId]] : [];
    const filtered = logs.filter((log) => logMatchesFilter(log, state.filters[kind]));

    body.innerHTML = '';

    if (!filtered.length) {
      emptyState?.classList.remove('hidden');
      return;
    }

    emptyState?.classList.add('hidden');

    filtered.forEach((log) => {
      const tr = document.createElement('tr');

      const dateTd = document.createElement('td');
      dateTd.className = 'px-3 py-2 text-xs text-gray-600';
      dateTd.textContent = formatDate(log.createdAt);

      const numberTd = document.createElement('td');
      numberTd.className = 'px-3 py-2 text-xs text-gray-700';
      const numberWrap = document.createElement('div');
      numberWrap.className = 'flex flex-col';
      const numberLabel = document.createElement('span');
      numberLabel.className = 'font-semibold text-gray-800';
      numberLabel.textContent =
        log.numberLabel || log.phoneNumber || log.phoneNumberId || 'Numero nao informado';
      numberWrap.appendChild(numberLabel);
      numberTd.appendChild(numberWrap);

      const targetTd = document.createElement('td');
      targetTd.className = 'px-3 py-2 text-xs text-gray-600';
      targetTd.textContent = isOutgoing ? log.destination || '--' : log.origin || '--';

      const messageTd = document.createElement('td');
      messageTd.className = 'px-3 py-2 text-xs text-gray-700';
      messageTd.appendChild(createLogMessageCell(log.message));

      const statusTd = document.createElement('td');
      statusTd.className = 'px-3 py-2';
      const statusBadge = document.createElement('span');
      setBadge(statusBadge, log.status, resolveLogStatusStyle(log.status), badgeCompanySize);
      statusTd.appendChild(statusBadge);

      tr.appendChild(dateTd);
      tr.appendChild(numberTd);
      tr.appendChild(targetTd);
      tr.appendChild(messageTd);
      tr.appendChild(statusTd);
      body.appendChild(tr);
    });
  };

  const renderAll = () => {
    renderCompanySummary();
    renderAppTokens();
    renderNumbersTable();
    renderIntegrationStatus();
    renderNumberSelects();
    renderLogs('outgoing');
    renderLogs('incoming');
  };

  const loadLogs = async (companyId) => {
    if (!companyId) return;
    ensureCompanyState(companyId);

    try {
      const resp = await fetch(
        `${API_BASE}/integrations/whatsapp/${companyId}/logs?limit=${LOG_LIMIT}`,
        { headers: authHeaders(false) }
      );
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(payload?.message || 'Erro ao carregar logs do WhatsApp.');
      }

      state.logsByCompany.outgoing[companyId] = Array.isArray(payload?.outgoing)
        ? payload.outgoing.map(normalizeLogEntry)
        : [];
      state.logsByCompany.incoming[companyId] = Array.isArray(payload?.incoming)
        ? payload.incoming.map(normalizeLogEntry)
        : [];
    } catch (error) {
      console.error('whatsapp:loadLogs', error);
      state.logsByCompany.outgoing[companyId] = [];
      state.logsByCompany.incoming[companyId] = [];
      notify('Nao foi possivel carregar os logs do WhatsApp.', 'error');
    }
  };

  const saveLogEntry = async (companyId, payload) => {
    if (!companyId) return null;
    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}/logs`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao salvar log.');
      }
      return data?.log ? normalizeLogEntry(data.log) : null;
    } catch (error) {
      console.error('whatsapp:saveLog', error);
      notify(error.message || 'Nao foi possivel salvar o log.', 'error');
      return null;
    }
  };

  const sendTestMessage = async (companyId, payload) => {
    if (!companyId) return { ok: false, log: null };
    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}/send-test`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = data?.message || 'Nao foi possivel enviar a mensagem.';
        notify(message, 'error');
        return { ok: false, log: data?.log ? normalizeLogEntry(data.log) : null };
      }
      return { ok: true, log: data?.log ? normalizeLogEntry(data.log) : null };
    } catch (error) {
      console.error('whatsapp:sendTest', error);
      notify(error.message || 'Nao foi possivel enviar a mensagem.', 'error');
      return { ok: false, log: null };
    }
  };

  const refreshLogs = async () => {
    if (!state.selectedCompanyId) return;
    await loadLogs(state.selectedCompanyId);
    renderLogs('outgoing');
    renderLogs('incoming');
  };

  const applyIntegrationResponse = (companyId, payload = {}) => {
    ensureCompanyState(companyId);

    const numbers = Array.isArray(payload.phoneNumbers) ? payload.phoneNumbers : [];
    state.numbersByCompany[companyId] = numbers.map((number) => ({
      id: number.id || number._id || createId('wa'),
      phoneNumberId: number.phoneNumberId || '',
      phoneNumber: number.phoneNumber || '',
      displayName: number.displayName || '',
      pin: number.pin || '',
      status: number.status || 'Pendente',
      provider: number.provider || 'Meta Cloud API',
      lastSyncAt: number.lastSyncAt || null,
    }));

    state.appTokensByCompany[companyId] = {
      appId: payload.appId || '',
      appSecret: payload.appSecret || '',
      wabaId: payload.wabaId || '',
      accessToken: payload.accessToken || '',
      verifyToken: payload.verifyToken || '',
    };
  };

  const loadIntegration = async (companyId) => {
    if (!companyId) {
      renderAll();
      return;
    }

    ensureCompanyState(companyId);

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}`, {
        headers: authHeaders(false),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(payload?.message || 'Erro ao carregar integracao do WhatsApp.');
      }
      applyIntegrationResponse(companyId, payload);
    } catch (error) {
      console.error('whatsapp:loadIntegration', error);
      notify(error.message || 'Nao foi possivel carregar a integracao.', 'error');
    }

    await loadLogs(companyId);
    renderAll();
  };

  const loadCompanies = async () => {
    if (!elements.companySelect) return;

    elements.companySelect.disabled = true;
    elements.companySelect.innerHTML = '<option value="">Carregando...</option>';

    try {
      const resp = await fetch(`${API_BASE}/stores/allowed`, { headers: authHeaders(false) });
      if (!resp.ok) {
        throw new Error('Falha ao carregar empresas.');
      }

      const data = await resp.json().catch(() => ({}));
      const stores = Array.isArray(data?.stores) ? data.stores : [];

      if (!stores.length) {
        elements.companySelect.innerHTML = '<option value="">Nenhuma empresa vinculada</option>';
        elements.companySelect.disabled = true;
        notify('Nenhuma empresa vinculada ao seu usuario.', 'warning');
        renderAll();
        return;
      }

      state.companies = stores.map((store) => ({
        id: store._id,
        name: store.nome || store.razaoSocial || 'Empresa sem nome',
        cnpj: store.cnpj || '',
      }));

      const canReuse = state.selectedCompanyId && state.companies.some((company) => company.id === state.selectedCompanyId);
      state.selectedCompanyId = canReuse ? state.selectedCompanyId : state.companies[0].id;

      populateCompanySelect();
      elements.companySelect.value = state.selectedCompanyId;
      elements.companySelect.disabled = false;
      await loadIntegration(state.selectedCompanyId);
    } catch (error) {
      console.error('whatsapp:loadCompanies', error);
      elements.companySelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      elements.companySelect.disabled = true;
      notify('Nao foi possivel carregar as empresas vinculadas.', 'error');
    }
  };

  const saveIntegration = async (companyId, payload, successMessage) => {
    if (!companyId) {
      notify('Selecione uma empresa antes de salvar.', 'error');
      return false;
    }

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao salvar integracao.');
      }
      applyIntegrationResponse(companyId, data);
      renderAll();
      if (successMessage) notify(successMessage, 'success');
      return true;
    } catch (error) {
      console.error('whatsapp:saveIntegration', error);
      notify(error.message || 'Nao foi possivel salvar a integracao.', 'error');
      return false;
    }
  };

  const setPinVisibility = (visible) => {
    if (!elements.modalPin) return;
    elements.modalPin.type = visible ? 'text' : 'password';
    if (elements.pinToggle) {
      elements.pinToggle.setAttribute('aria-pressed', String(visible));
      elements.pinToggle.setAttribute('aria-label', visible ? 'Ocultar PIN' : 'Mostrar PIN');
      const icon = elements.pinToggle.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-eye', !visible);
        icon.classList.toggle('fa-eye-slash', visible);
      }
    }
  };

  const openModal = () => {
    if (!elements.modal) return;
    elements.modalForm?.reset();
    if (elements.modalTitle) elements.modalTitle.textContent = 'Adicionar numero';
    if (elements.modalPin) elements.modalPin.value = '';
    setPinVisibility(false);
    state.editingNumberId = '';
    elements.modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  };

  const closeModal = () => {
    if (!elements.modal) return;
    elements.modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    setPinVisibility(false);
    state.editingNumberId = '';
  };

  const openEditModal = (number) => {
    if (!elements.modal || !number) return;
    elements.modalForm?.reset();
    if (elements.modalTitle) elements.modalTitle.textContent = 'Editar numero';
    state.editingNumberId = number.id;
    if (elements.modalName) elements.modalName.value = number.displayName || '';
    if (elements.modalPhone) elements.modalPhone.value = number.phoneNumber || '';
    if (elements.modalPhoneId) elements.modalPhoneId.value = number.phoneNumberId || '';
    if (elements.modalPin) elements.modalPin.value = number.pin || '';
    setPinVisibility(false);
    if (elements.modalProvider) {
      elements.modalProvider.value = number.provider || 'Meta Cloud API';
    }
    elements.modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  };

  const buildPhoneNumbersPayload = (numbers) =>
    numbers.map((number) => {
      const payload = {
        phoneNumber: number.phoneNumber,
        phoneNumberId: number.phoneNumberId,
        displayName: number.displayName,
        pin: number.pin || '',
        status: number.status || 'Pendente',
        provider: number.provider || 'Meta Cloud API',
        lastSyncAt: number.lastSyncAt,
      };
      if (isValidObjectId(number.id)) {
        payload.id = number.id;
      }
      return payload;
    });

  const handleSaveNumber = async (event) => {
    event.preventDefault();

    const name = elements.modalName?.value.trim() || '';
    const phone = elements.modalPhone?.value.trim() || '';
    const phoneId = elements.modalPhoneId?.value.trim() || '';
    const provider = elements.modalProvider?.value || '';
    const pinDigits = digitsOnly(elements.modalPin?.value || '').slice(0, 6);
    const pin = pinDigits;

    if (!name || !phone || !phoneId || !provider) {
      notify('Preencha nome, numero, ID do numero e API antes de salvar.', 'error');
      return;
    }

    if (pin && pin.length !== 6) {
      notify('PIN deve ter 6 digitos.', 'error');
      return;
    }

    if (!state.selectedCompanyId) {
      notify('Selecione uma empresa para salvar o numero.', 'error');
      return;
    }

    const currentNumbers = getNumbersForCompany(state.selectedCompanyId);
    const isEditing = Boolean(state.editingNumberId);
    let nextNumbers = [];
    let successMessage = 'Numero salvo no banco.';

    if (isEditing) {
      const current = currentNumbers.find((number) => number.id === state.editingNumberId);
      if (!current) {
        notify('Numero nao encontrado para edicao.', 'error');
        return;
      }
      successMessage = 'Numero atualizado no banco.';
      const updated = {
        ...current,
        displayName: name,
        phoneNumber: phone,
        phoneNumberId: phoneId,
        pin,
        provider,
      };
      nextNumbers = currentNumbers.map((number) =>
        number.id === state.editingNumberId ? updated : number
      );
    } else {
      const newNumber = {
        phoneNumber: phone,
        phoneNumberId: phoneId,
        displayName: name,
        pin,
        status: 'Pendente',
        provider,
        lastSyncAt: new Date().toISOString(),
      };
      nextNumbers = [newNumber, ...currentNumbers];
    }

    const saved = await saveIntegration(
      state.selectedCompanyId,
      { phoneNumbers: buildPhoneNumbersPayload(nextNumbers) },
      successMessage
    );
    if (saved) {
      closeModal();
    }
  };

  const updateNumberState = async (numberId, updater, successMessage) => {
    if (!state.selectedCompanyId) {
      notify('Selecione uma empresa antes de continuar.', 'error');
      return;
    }

    const numbers = getNumbersForCompany(state.selectedCompanyId);
    const current = numbers.find((number) => number.id === numberId);
    if (!current) {
      notify('Numero nao encontrado.', 'error');
      return;
    }

    const updated = updater(current);
    const nextNumbers = numbers.map((number) => (number.id === numberId ? updated : number));

    await saveIntegration(
      state.selectedCompanyId,
      { phoneNumbers: buildPhoneNumbersPayload(nextNumbers) },
      successMessage
    );
  };

  const handleDisconnectNumber = async (numberId) => {
    const current = getNumberById(numberId);
    if (!current) {
      notify('Numero nao encontrado.', 'error');
      return;
    }
    if (current.status === 'Desconectado') {
      notify('Numero ja esta desconectado.', 'info');
      return;
    }

    await updateNumberState(
      numberId,
      (entry) => ({
        ...entry,
        status: 'Desconectado',
        lastSyncAt: new Date().toISOString(),
      }),
      'Numero desconectado com sucesso.'
    );
  };

  const handleRestartNumber = async (numberId) => {
    const current = getNumberById(numberId);
    if (!current) {
      notify('Numero nao encontrado.', 'error');
      return;
    }

    const tokens = getTokensForCompany(state.selectedCompanyId);
    if (!hasRequiredTokens(tokens)) {
      notify('Informe todos os tokens do app antes de reiniciar o numero.', 'error');
      return;
    }

    if (!current.phoneNumberId || !current.phoneNumber) {
      notify('Numero sem Phone Number ID ou telefone informado.', 'error');
      return;
    }

    await updateNumberState(
      numberId,
      (entry) => ({
        ...entry,
        status: 'Conectado',
        lastSyncAt: new Date().toISOString(),
      }),
      'Numero reiniciado e conectado.'
    );
  };

  const registerNumber = async (companyId, payload) => {
    if (!companyId) {
      notify('Selecione uma empresa antes de registrar.', 'error');
      return false;
    }

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${companyId}/register-number`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Erro ao registrar numero.');
      }
      notify(data?.message || 'Numero registrado com sucesso.', 'success');
      return true;
    } catch (error) {
      console.error('whatsapp:registerNumber', error);
      notify(error.message || 'Nao foi possivel registrar o numero.', 'error');
      return false;
    }
  };

  const handleRegisterNumber = async (numberId) => {
    const current = getNumberById(numberId);
    if (!current) {
      notify('Numero nao encontrado.', 'error');
      return;
    }

    const tokens = getTokensForCompany(state.selectedCompanyId);
    if (!tokens?.accessToken) {
      notify('Informe o token de acesso antes de registrar.', 'error');
      return;
    }

    if (!current.phoneNumberId) {
      notify('Numero sem Phone Number ID informado.', 'error');
      return;
    }

    if (!current.pin || current.pin.length !== 6) {
      notify('Informe o PIN de 6 digitos no editar numero.', 'error');
      openEditModal(current);
      return;
    }

    const success = await registerNumber(state.selectedCompanyId, { numberId });
    if (success) {
      await loadIntegration(state.selectedCompanyId);
    }
  };

  const handleNumbersTableClick = (event) => {
    const target = event.target.closest('button[data-action]');
    if (!target || !elements.numbersTableBody?.contains(target)) return;
    const action = target.dataset.action;
    const numberId = target.dataset.numberId;
    if (!action || !numberId) return;

    if (action === 'details') {
      const number = getNumberById(numberId);
      if (!number) {
        notify('Numero nao encontrado.', 'error');
        return;
      }
      openEditModal(number);
      return;
    }

    if (action === 'disconnect') {
      handleDisconnectNumber(numberId);
      return;
    }

    if (action === 'restart') {
      handleRestartNumber(numberId);
      return;
    }

    if (action === 'register') {
      handleRegisterNumber(numberId);
    }
  };

  const handleSaveTokens = async () => {
    if (!state.selectedCompanyId) {
      notify('Selecione uma empresa para salvar os tokens.', 'error');
      return;
    }

    const payload = {
      appId: elements.appIdInput?.value.trim() || '',
      appSecret: elements.appSecretInput?.value.trim() || '',
      wabaId: elements.wabaIdInput?.value.trim() || '',
      accessToken: elements.accessTokenInput?.value.trim() || '',
      verifyToken: elements.verifyTokenInput?.value.trim() || '',
    };

    const saved = await saveIntegration(state.selectedCompanyId, payload, 'Tokens salvos no banco.');
    if (saved) {
      renderIntegrationStatus();
    }
  };

  const toggleButtonLoading = (button, loading, label) => {
    if (!button) return;
    if (loading) {
      button.dataset.label = button.textContent || '';
      button.disabled = true;
      button.classList.add('opacity-70', 'cursor-not-allowed');
      button.textContent = label || 'Processando...';
      return;
    }
    button.disabled = false;
    button.classList.remove('opacity-70', 'cursor-not-allowed');
    button.textContent = button.dataset.label || button.textContent;
  };

  const handleVerifyWebhooks = async () => {
    if (!state.selectedCompanyId) {
      notify('Selecione uma empresa para verificar o webhook.', 'error');
      return;
    }

    const tokens = getTokensForCompany(state.selectedCompanyId);
    if (!tokens?.wabaId || !tokens?.accessToken) {
      notify('Informe WABA ID e Token de acesso antes de verificar.', 'error');
      return;
    }

    const buildPayloadModal = (payload) => {
      if (typeof window.showModal !== 'function') {
        return;
      }
      let pretty = '';
      try {
        pretty = JSON.stringify(payload ?? {}, null, 2);
      } catch (_) {
        pretty = String(payload ?? '');
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'space-y-3 text-left';

      const title = document.createElement('p');
      title.className = 'text-sm font-semibold text-gray-800';
      title.textContent = 'Resultado da verificacao';

      const pre = document.createElement('pre');
      pre.className = 'max-h-80 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700';
      pre.textContent = pretty || '{}';

      const actions = document.createElement('div');
      actions.className = 'flex items-center justify-between text-xs text-gray-500';

      const hint = document.createElement('span');
      hint.textContent = 'Dados retornados pela Graph API.';

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'inline-flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:border-primary hover:text-primary transition';
      copy.textContent = 'Copiar JSON';
      copy.addEventListener('click', () => copyToClipboard(pre.textContent, 'JSON'));

      actions.appendChild(hint);
      actions.appendChild(copy);
      wrapper.appendChild(title);
      wrapper.appendChild(pre);
      wrapper.appendChild(actions);

      window.showModal({
        message: wrapper,
        confirmText: 'Fechar',
      });
    };

    toggleButtonLoading(elements.verifyWebhookButton, true, 'Verificando...');

    try {
      const resp = await fetch(`${API_BASE}/integrations/whatsapp/${state.selectedCompanyId}/webhook/verify`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await resp.json().catch(() => ({}));
      if (data && Object.keys(data).length > 0) {
        buildPayloadModal(data);
      }
      if (!resp.ok) {
        throw new Error(data?.message || 'Nao foi possivel verificar o webhook.');
      }

      const subscribeOk = data?.subscribe?.ok;
      const checkOk = data?.check?.ok;
      if (subscribeOk && checkOk) {
        notify('Webhook verificado e inscrito com sucesso.', 'success');
      } else if (checkOk) {
        notify('Webhook consultado. Veja os detalhes no modal.', 'info');
      } else {
        notify('Falha ao verificar webhook.', 'error');
      }

      console.log('whatsapp:webhook:verify', data);
    } catch (error) {
      console.error('whatsapp:webhook:verify', error);
      notify(error.message || 'Nao foi possivel verificar o webhook.', 'error');
    } finally {
      toggleButtonLoading(elements.verifyWebhookButton, false);
    }
  };

  const updateLastSync = (numberId) => {
    const numbers = state.numbersByCompany[state.selectedCompanyId] || [];
    const number = numbers.find((entry) => entry.id === numberId);
    if (number) {
      number.lastSyncAt = new Date().toISOString();
    }
  };

  const markNumberConnected = (numberId) => {
    const numbers = state.numbersByCompany[state.selectedCompanyId] || [];
    const number = numbers.find((entry) => entry.id === numberId);
    if (number) {
      number.status = 'Conectado';
    }
  };

  const handleSendTest = async () => {
    const originId = elements.sendOrigin?.value || '';
    const destination = elements.sendDestination?.value.trim() || '';
    const message = elements.sendMessage?.value.trim() || '';

    if (!state.selectedCompanyId) {
      notify('Selecione uma empresa para enviar o teste.', 'error');
      return;
    }

    if (!originId || !destination || !message) {
      notify('Preencha origem, destino e mensagem para enviar o teste.', 'error');
      return;
    }

    const result = await sendTestMessage(state.selectedCompanyId, {
      numberId: originId,
      destination,
      message,
    });

    if (!result?.log && !result?.ok) return;

    if (result?.ok) {
      updateLastSync(originId);
      markNumberConnected(originId);
      notify('Mensagem enviada. Aguarde o status no log.', 'success');
    }
    renderNumbersTable();
    renderIntegrationStatus();
    await refreshLogs();
  };

  const handleReceiveTest = async () => {
    const destinationId = elements.receiveDestination?.value || '';
    const origin = elements.receiveOrigin?.value.trim() || '';
    const message = elements.receiveMessage?.value.trim() || '';

    if (!destinationId || !origin || !message) {
      notify('Preencha destino, origem e mensagem para simular o recebimento.', 'error');
      return;
    }

    if (!state.selectedCompanyId) {
      notify('Selecione uma empresa para simular o recebimento.', 'error');
      return;
    }

    const logEntry = await saveLogEntry(state.selectedCompanyId, {
      direction: 'incoming',
      status: 'Recebido',
      numberId: destinationId,
      origin,
      message,
      source: 'manual',
    });

    if (!logEntry) return;

    updateLastSync(destinationId);
    renderNumbersTable();
    renderIntegrationStatus();
    await refreshLogs();
    notify('Recebimento simulado registrado no log.', 'success');
  };

  const clearSendForm = () => {
    if (elements.sendOrigin) elements.sendOrigin.value = '';
    if (elements.sendDestination) elements.sendDestination.value = '';
    if (elements.sendMessage) elements.sendMessage.value = '';
  };

  const setActiveTab = (target) => {
    elements.tabButtons.forEach((button) => {
      const isActive = button.dataset.whatsappTab === target;
      button.classList.toggle('border-primary', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-gray-200', !isActive);
      button.classList.toggle('text-gray-600', !isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    elements.tabPanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.whatsappPanel !== target);
    });
  };

  const copyToClipboard = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copiado para a area de transferencia.`, 'success');
      return;
    } catch (_) {
      // fallback abaixo
    }

    try {
      const temp = document.createElement('textarea');
      temp.value = value;
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      temp.remove();
      notify(`${label} copiado para a area de transferencia.`, 'success');
    } catch (error) {
      console.error('Nao foi possivel copiar.', error);
      notify('Nao foi possivel copiar. Copie manualmente.', 'error');
    }
  };

  const bindEvents = () => {
    elements.companySelect.addEventListener('change', async (event) => {
      state.selectedCompanyId = event.target.value;
      ensureCompanyState(state.selectedCompanyId);
      await loadIntegration(state.selectedCompanyId);
    });

    elements.addNumberButton?.addEventListener('click', openModal);
    elements.modalForm?.addEventListener('submit', handleSaveNumber);
    elements.numbersTableBody?.addEventListener('click', handleNumbersTableClick);
    elements.pinToggle?.addEventListener('click', () => {
      const isVisible = elements.modalPin?.type === 'text';
      setPinVisibility(!isVisible);
    });
    elements.modalPin?.addEventListener('input', () => {
      const digits = digitsOnly(elements.modalPin.value).slice(0, 6);
      elements.modalPin.value = digits;
    });

    document.querySelectorAll('[data-whatsapp-modal-close]').forEach((button) => {
      button.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && elements.modal && !elements.modal.classList.contains('hidden')) {
        closeModal();
      }
    });

    elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => setActiveTab(button.dataset.whatsappTab));
    });

    elements.sendButton?.addEventListener('click', handleSendTest);
    elements.sendClear?.addEventListener('click', clearSendForm);
    elements.receiveButton?.addEventListener('click', handleReceiveTest);

    elements.outgoingFilter?.addEventListener('input', (event) => {
      state.filters.outgoing = event.target.value || '';
      renderLogs('outgoing');
    });

    elements.incomingFilter?.addEventListener('input', (event) => {
      state.filters.incoming = event.target.value || '';
      renderLogs('incoming');
    });

    elements.saveTokensButton?.addEventListener('click', handleSaveTokens);
    elements.verifyWebhookButton?.addEventListener('click', handleVerifyWebhooks);
    elements.copyWebhook?.addEventListener('click', () => copyToClipboard(WEBHOOK_URL, 'Webhook'));
    elements.copyAccessToken?.addEventListener('click', () =>
      copyToClipboard(elements.accessTokenInput?.value || '', 'Token de acesso')
    );
    elements.copyVerifyToken?.addEventListener('click', () =>
      copyToClipboard(elements.verifyTokenInput?.value || '', 'Verify Token')
    );
  };

  const init = () => {
    if (elements.webhookUrl) elements.webhookUrl.textContent = WEBHOOK_URL;
    setActiveTab('send');
    bindEvents();
    loadCompanies();
  };

  init();
});
