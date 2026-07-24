document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.API_CONFIG?.BASE_URL || '';
  const elements = {
    companySelect: document.getElementById('whatsapp-company-select'),
    accessWarning: document.getElementById('whatsapp-access-warning'),
    storeName: document.getElementById('whatsapp-store-name'),
    storeCnpj: document.getElementById('whatsapp-store-cnpj'),
    integrationBadge: document.getElementById('whatsapp-integration-badge'),
    integrationDetail: document.getElementById('whatsapp-integration-detail'),
    coexistenceBadge: document.getElementById('whatsapp-coexistence-badge'),
    coexistenceDetail: document.getElementById('whatsapp-coexistence-detail'),
    numberCount: document.getElementById('whatsapp-number-count'),
    loading: document.getElementById('whatsapp-loading'),
    numbersEmpty: document.getElementById('whatsapp-numbers-empty'),
    numbersList: document.getElementById('whatsapp-numbers-list'),
    refreshButton: document.getElementById('whatsapp-refresh'),
    openCentral: document.getElementById('whatsapp-open-central'),
    technicalConfig: document.getElementById('whatsapp-technical-config'),
    setupForm: document.getElementById('whatsapp-setup-form'),
    appId: document.getElementById('whatsapp-app-id'),
    configId: document.getElementById('whatsapp-config-id'),
    appSecret: document.getElementById('whatsapp-app-secret'),
    verifyToken: document.getElementById('whatsapp-verify-token'),
    webhookUrl: document.getElementById('whatsapp-webhook-url'),
    webhookFields: document.getElementById('whatsapp-webhook-fields'),
    secretStatus: document.getElementById('whatsapp-secret-status'),
    saveSetup: document.getElementById('whatsapp-save-setup'),
    connectButton: document.getElementById('whatsapp-connect-coexistence'),
    healthButton: document.getElementById('whatsapp-health-check'),
    progress: document.getElementById('whatsapp-onboarding-progress'),
    progressText: document.getElementById('whatsapp-onboarding-progress-text'),
    pilotSummaryBadge: document.getElementById('whatsapp-pilot-summary-badge'),
    pilotLoading: document.getElementById('whatsapp-pilot-readiness-loading'),
    pilotEmpty: document.getElementById('whatsapp-pilot-readiness-empty'),
    pilotList: document.getElementById('whatsapp-pilot-readiness-list'),
  };

  if (!elements.companySelect) return;

  const state = {
    stores: [],
    selectedStoreId: '',
    environment: null,
    setup: null,
    pilotReadiness: [],
    loading: false,
    onboarding: false,
  };

  function getToken() {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch (_) {
      return '';
    }
  }

  function authHeaders(json = false) {
    const token = getToken();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  function notify(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type, 4200);
      return;
    }
    if (type === 'error') window.alert(message);
    else console.log(message);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    if (!value) return 'Sem atividade registrada';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sem atividade registrada';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatCnpj(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length !== 14) return value || 'CNPJ não informado';
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5'
    );
  }

  function statusClasses(status) {
    const normalized = String(status || '').toLowerCase();
    if (['conectado', 'connected', 'syncing'].includes(normalized)) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (['desconectado', 'disconnected', 'error'].includes(normalized)) {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }

  function resolveWebhookUrl() {
    try {
      const api = new URL(API_BASE || window.location.origin, window.location.origin);
      api.pathname = api.pathname.replace(/\/api\/?$/, '').replace(/\/$/, '');
      api.pathname = `${api.pathname}/webhooks/whatsapp`.replace(/\/{2,}/g, '/');
      api.search = '';
      api.hash = '';
      return api.toString();
    } catch (_) {
      return `${window.location.origin}/webhooks/whatsapp`;
    }
  }

  function setBusy(active, text = '') {
    state.onboarding = active;
    elements.progress.classList.toggle('hidden', !active);
    if (text) elements.progressText.textContent = text;
    updateActions();
  }

  function setLoading(loading) {
    state.loading = loading;
    elements.companySelect.disabled = loading || state.stores.length === 0;
    elements.refreshButton.disabled = loading || !state.selectedStoreId;
    elements.refreshButton.classList.toggle('opacity-60', loading);
    elements.loading.classList.toggle('hidden', !loading);
    if (loading) {
      elements.numbersEmpty.classList.add('hidden');
      elements.numbersList.classList.add('hidden');
    }
    updateActions();
  }

  function canConfigure() {
    return state.environment?.permissions?.canConfigure === true;
  }

  function updateActions() {
    const busy = state.loading || state.onboarding;
    elements.saveSetup.disabled = busy || !canConfigure() || !state.selectedStoreId;
    elements.connectButton.disabled = busy || !canConfigure() || !state.setup?.ready;
    elements.healthButton.disabled =
      busy || !canConfigure() || !state.setup?.phoneNumbers?.length;
    [
      elements.appId,
      elements.configId,
      elements.appSecret,
      elements.verifyToken,
    ].forEach((input) => {
      input.disabled = busy || !canConfigure();
    });
  }

  function resetEnvironment() {
    state.environment = null;
    state.setup = null;
    elements.storeName.textContent = '—';
    elements.storeCnpj.textContent = '—';
    elements.numberCount.textContent = '0';
    elements.integrationBadge.textContent = 'Não configurada';
    elements.integrationBadge.className =
      'mt-2 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600';
    elements.integrationDetail.textContent = 'Selecione uma loja autorizada.';
    elements.coexistenceBadge.textContent = 'Não iniciada';
    elements.coexistenceBadge.className =
      'mt-2 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600';
    elements.coexistenceDetail.textContent = 'O número continuará funcionando no celular.';
    elements.accessWarning.classList.add('hidden');
    elements.numbersList.innerHTML = '';
    elements.numbersList.classList.add('hidden');
    elements.numbersEmpty.classList.remove('hidden');
    elements.openCentral.href = 'admin-web-whatsapp.html';
    elements.appId.value = '';
    elements.configId.value = '';
    elements.appSecret.value = '';
    elements.verifyToken.value = '';
    elements.secretStatus.textContent = 'Nenhum segredo é exibido após ser salvo.';
    state.pilotReadiness = [];
    elements.pilotSummaryBadge.textContent = 'Aguardando loja';
    elements.pilotSummaryBadge.className =
      'inline-flex self-start rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600';
    elements.pilotLoading.classList.add('hidden');
    elements.pilotList.innerHTML = '';
    elements.pilotList.classList.add('hidden');
    elements.pilotEmpty.classList.remove('hidden');
    updateActions();
  }

  function readinessMeta(status) {
    return {
      blocked: {
        label: 'Bloqueado',
        badge: 'border-rose-200 bg-rose-50 text-rose-700',
        icon: 'fa-circle-xmark text-rose-600',
      },
      warning: {
        label: 'Com alertas',
        badge: 'border-amber-200 bg-amber-50 text-amber-700',
        icon: 'fa-triangle-exclamation text-amber-600',
      },
      ready: {
        label: 'Pronto',
        badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        icon: 'fa-circle-check text-emerald-600',
      },
    }[status] || {
      label: 'Não avaliado',
      badge: 'border-gray-200 bg-gray-100 text-gray-600',
      icon: 'fa-circle-question text-gray-400',
    };
  }

  function checkMeta(status) {
    return {
      blocker: {
        label: 'Obrigatório',
        row: 'border-rose-100 bg-rose-50/70',
        badge: 'bg-rose-100 text-rose-700',
        icon: 'fa-circle-xmark text-rose-500',
      },
      warning: {
        label: 'Atenção',
        row: 'border-amber-100 bg-amber-50/70',
        badge: 'bg-amber-100 text-amber-700',
        icon: 'fa-triangle-exclamation text-amber-500',
      },
      pass: {
        label: 'Concluído',
        row: 'border-emerald-100 bg-emerald-50/50',
        badge: 'bg-emerald-100 text-emerald-700',
        icon: 'fa-circle-check text-emerald-500',
      },
    }[status] || {
      label: 'Pendente',
      row: 'border-gray-100 bg-gray-50',
      badge: 'bg-gray-100 text-gray-600',
      icon: 'fa-circle text-gray-400',
    };
  }

  function renderPilotReadiness() {
    const entries = Array.isArray(state.pilotReadiness) ? state.pilotReadiness : [];
    elements.pilotList.innerHTML = '';
    elements.pilotEmpty.classList.toggle('hidden', entries.length > 0);
    elements.pilotList.classList.toggle('hidden', entries.length === 0);
    if (!entries.length) {
      elements.pilotSummaryBadge.textContent = 'Sem número para avaliar';
      elements.pilotSummaryBadge.className =
        'inline-flex self-start rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600';
      return;
    }

    const valid = entries.filter((entry) => entry?.summary);
    const blockers = valid.reduce((sum, entry) => sum + (Number(entry.summary.blockers) || 0), 0);
    const warnings = valid.reduce((sum, entry) => sum + (Number(entry.summary.warnings) || 0), 0);
    const status = entries.some((entry) => entry?.error) || blockers
      ? 'blocked'
      : warnings
        ? 'warning'
        : 'ready';
    const meta = readinessMeta(status);
    elements.pilotSummaryBadge.textContent =
      `${meta.label} · ${blockers} bloqueio(s) · ${warnings} alerta(s)`;
    elements.pilotSummaryBadge.className =
      `inline-flex self-start rounded-full border px-3 py-1 text-xs font-semibold ${meta.badge}`;

    entries.forEach((entry) => {
      const article = document.createElement('article');
      article.className = 'rounded-2xl border border-gray-200 p-4';
      if (entry?.error) {
        article.innerHTML = `
          <div class="flex items-start gap-3">
            <i class="fas fa-circle-xmark mt-0.5 text-rose-500"></i>
            <div>
              <p class="font-semibold text-gray-900">${escapeHtml(entry.displayName || entry.phoneNumberId || 'Número')}</p>
              <p class="mt-1 text-sm text-rose-700">${escapeHtml(entry.error)}</p>
            </div>
          </div>
        `;
        elements.pilotList.appendChild(article);
        return;
      }

      const entryMeta = readinessMeta(entry.summary?.status);
      const checks = Array.isArray(entry.checks) ? entry.checks : [];
      const pilotStatus = entry.pilotRun?.status || '';
      const pilotLabel = pilotStatus === 'passed'
        ? 'Piloto aprovado'
        : pilotStatus === 'in_progress'
          ? 'Homologação em andamento'
          : pilotStatus === 'cancelled'
            ? 'Última execução cancelada'
            : 'Homologação não iniciada';
      const pilotClasses = pilotStatus === 'passed'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : pilotStatus === 'in_progress'
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : pilotStatus === 'cancelled'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-gray-200 bg-gray-50 text-gray-600';
      const pilotProgress = entry.pilotRun?.progress || {};
      article.innerHTML = `
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="font-bold text-gray-900">${escapeHtml(entry.number?.displayName || 'Número WhatsApp')}</p>
            <p class="mt-1 text-xs text-gray-500">${escapeHtml(entry.number?.phoneNumber || entry.number?.phoneNumberId || '—')}</p>
          </div>
          <span class="inline-flex self-start rounded-full border px-2.5 py-1 text-xs font-semibold ${entryMeta.badge}">
            ${escapeHtml(entryMeta.label)} · ${Number(entry.summary?.blockers) || 0} bloqueio(s)
          </span>
        </div>
        <div class="mt-3 flex flex-col gap-2 rounded-xl border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${pilotClasses}">
          <div>
            <p class="text-xs font-bold">${escapeHtml(pilotLabel)}</p>
            <p class="mt-0.5 text-[11px]">
              ${pilotStatus === 'in_progress'
                ? `${Number(pilotProgress.passed) || 0}/${Number(pilotProgress.total) || 0} cenários aprovados`
                : entry.rollout?.baselineApproved
                  ? 'Expansão controlada liberada após aprovação do piloto-base.'
                  : 'Outros ambientes permanecem bloqueados durante o primeiro piloto.'}
            </p>
          </div>
          <a href="admin-web-whatsapp.html?storeId=${encodeURIComponent(entry.store?.id || state.selectedStoreId)}&phoneNumberId=${encodeURIComponent(entry.number?.phoneNumberId || '')}" class="text-[11px] font-semibold hover:underline">Abrir homologação <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="mt-4 space-y-2">
          ${checks.map((check) => {
            const item = checkMeta(check.status);
            const action = check.action?.href
              ? `<a href="${escapeHtml(check.action.href)}" class="mt-2 inline-flex text-xs font-semibold text-primary hover:underline">${escapeHtml(check.action.label || 'Corrigir item')} <i class="fas fa-arrow-right ml-1"></i></a>`
              : '';
            return `
              <div class="rounded-xl border p-3 ${item.row}">
                <div class="flex items-start gap-3">
                  <i class="fas ${item.icon} mt-0.5"></i>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold text-gray-800">${escapeHtml(check.label || '')}</p>
                      <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.badge}">${item.label}</span>
                    </div>
                    <p class="mt-1 text-xs text-gray-600">${escapeHtml(check.message || '')}</p>
                    ${action}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      elements.pilotList.appendChild(article);
    });
  }

  async function loadPilotReadiness(numbers) {
    const safeNumbers = (Array.isArray(numbers) ? numbers : []).filter(
      (number) => number?.phoneNumberId
    );
    if (!state.selectedStoreId || !safeNumbers.length) {
      state.pilotReadiness = [];
      renderPilotReadiness();
      return;
    }
    elements.pilotLoading.classList.remove('hidden');
    elements.pilotEmpty.classList.add('hidden');
    try {
      state.pilotReadiness = await Promise.all(safeNumbers.map(async (number) => {
        try {
          const base =
            `/integrations/whatsapp/${encodeURIComponent(state.selectedStoreId)}`
            + `/numbers/${encodeURIComponent(number.phoneNumberId)}`;
          const [payload, pilot] = await Promise.all([
            requestJson(`${base}/pilot-readiness`),
            requestJson(`${base}/pilot`),
          ]);
          return {
            ...payload.readiness,
            pilotRun: pilot.pilotRun || null,
            rollout: pilot.rollout || null,
          };
        } catch (error) {
          return {
            error: error.message,
            displayName: number.displayName,
            phoneNumberId: number.phoneNumberId,
          };
        }
      }));
      renderPilotReadiness();
    } finally {
      elements.pilotLoading.classList.add('hidden');
    }
  }

  function renderIntegration() {
    const setup = state.setup || {};
    elements.integrationBadge.textContent = setup.ready ? 'Pronta para conectar' : 'Configuração incompleta';
    elements.integrationBadge.className = setup.ready
      ? 'mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700'
      : 'mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700';
    elements.integrationDetail.textContent = setup.ready
      ? `Embedded Signup ${setup.graphApiVersion || 'v25.0'} pronto.`
      : 'Preencha App ID, Configuration ID, App Secret e Verify Token.';

    const labels = {
      not_configured: ['Não iniciada', 'A configuração técnica ainda está incompleta.'],
      ready: ['Pronta', 'Aguardando autorização do número na Meta.'],
      in_progress: ['Autorizando', 'O Embedded Signup está em andamento.'],
      syncing: ['Sincronizando', 'Contatos e histórico estão sendo recebidos.'],
      connected: ['Conectada', 'Celular e sistema estão operando em coexistência.'],
      error: ['Erro', setup.lastError?.message || 'Revise a configuração e tente novamente.'],
      disconnected: ['Desconectada', 'A conexão foi removida no WhatsApp Business.'],
    };
    const current = labels[setup.onboardingStatus] || labels.not_configured;
    elements.coexistenceBadge.textContent = current[0];
    elements.coexistenceBadge.className =
      `mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(setup.onboardingStatus)}`;
    elements.coexistenceDetail.textContent = current[1];
  }

  function renderNumbers(numbers) {
    const safeNumbers = Array.isArray(numbers) ? numbers : [];
    elements.numberCount.textContent = String(safeNumbers.length);
    elements.numbersList.innerHTML = '';
    elements.numbersEmpty.classList.toggle('hidden', safeNumbers.length > 0);
    elements.numbersList.classList.toggle('hidden', safeNumbers.length === 0);

    safeNumbers.forEach((number) => {
      const progress = Math.max(0, Math.min(100, Number(number.historySyncProgress) || 0));
      const article = document.createElement('article');
      article.className = 'rounded-xl border border-gray-200 p-4';
      article.innerHTML = `
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate font-semibold text-gray-900">${escapeHtml(number.displayName || 'Número WhatsApp')}</p>
              <span class="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(number.status)}">${escapeHtml(number.status || 'Pendente')}</span>
              ${number.isOnBizApp ? '<span class="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Celular + sistema</span>' : ''}
            </div>
            <p class="mt-1 text-sm text-gray-600">${escapeHtml(number.phoneNumber || 'Telefone não informado')}</p>
            <p class="mt-1 font-mono text-[11px] text-gray-400">Phone Number ID: ${escapeHtml(number.phoneNumberId || '—')}</p>
          </div>
          <div class="text-left sm:text-right">
            <p class="text-xs font-semibold text-gray-600">${escapeHtml(number.provider || 'Meta Cloud API')}</p>
            <p class="mt-1 text-[11px] text-gray-400">${escapeHtml(formatDate(number.lastSyncAt))}</p>
          </div>
        </div>
        <div class="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div class="rounded-lg bg-gray-50 p-3">
            <p class="font-semibold text-gray-700">Contatos/configuração</p>
            <p class="mt-1 text-gray-500">${escapeHtml(number.contactsSyncStatus || 'Aguardando')}</p>
          </div>
          <div class="rounded-lg bg-gray-50 p-3">
            <div class="flex justify-between gap-2"><p class="font-semibold text-gray-700">Histórico</p><span>${progress}%</span></div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200"><div class="h-full rounded-full bg-primary" style="width:${progress}%"></div></div>
          </div>
        </div>
      `;
      elements.numbersList.appendChild(article);
    });
  }

  function renderEnvironment() {
    if (!state.environment) {
      resetEnvironment();
      return;
    }
    elements.storeName.textContent = state.environment.store?.name || 'Loja';
    elements.storeCnpj.textContent = formatCnpj(state.environment.store?.cnpj);
    elements.accessWarning.classList.toggle('hidden', canConfigure());
    elements.technicalConfig.classList.toggle('opacity-70', !canConfigure());
    elements.openCentral.href = `admin-web-whatsapp.html?storeId=${encodeURIComponent(
      state.environment.store?.id || state.selectedStoreId
    )}`;
    elements.appId.value = state.setup?.appId || '';
    elements.configId.value = state.setup?.configId || '';
    elements.appSecret.value = '';
    elements.verifyToken.value = '';
    const credentials = state.setup?.credentials || {};
    elements.secretStatus.textContent = [
      credentials.appSecretAvailable ? 'App Secret disponível' : 'App Secret ausente',
      credentials.verifyTokenAvailable ? 'Verify Token disponível' : 'Verify Token ausente',
      credentials.accessTokenStored ? 'token de acesso conectado' : 'sem token de acesso',
    ].join(' • ');
    elements.webhookFields.textContent =
      (state.setup?.requiredWebhookFields || []).join(', ')
      || 'messages, history, smb_app_state_sync, smb_message_echoes, account_update';
    renderIntegration();
    renderNumbers(state.setup?.phoneNumbers || state.environment.phoneNumbers);
    updateActions();
  }

  async function requestJson(path, options = {}) {
    const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...authHeaders(hasBody),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || 'Não foi possível concluir a operação.');
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  }

  async function loadStoreData(storeId) {
    if (!storeId) {
      resetEnvironment();
      return;
    }
    setLoading(true);
    try {
      state.environment = await requestJson(
        `/integrations/whatsapp/${encodeURIComponent(storeId)}/environment`
      );
      state.setup = canConfigure()
        ? await requestJson(
          `/integrations/whatsapp/${encodeURIComponent(storeId)}/coexistence/setup`
        )
        : null;
      renderEnvironment();
      await loadPilotReadiness(
        state.setup?.phoneNumbers || state.environment?.phoneNumbers || []
      );
    } catch (error) {
      state.environment = null;
      state.setup = null;
      resetEnvironment();
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function renderStoreOptions() {
    elements.companySelect.innerHTML = '';
    if (!state.stores.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhuma loja autorizada';
      elements.companySelect.appendChild(option);
      elements.companySelect.disabled = true;
      return;
    }
    state.stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store.id;
      option.textContent = store.name;
      elements.companySelect.appendChild(option);
    });
    elements.companySelect.value = state.selectedStoreId;
  }

  async function loadStores() {
    setLoading(true);
    try {
      const payload = await requestJson('/stores/allowed');
      state.stores = (Array.isArray(payload.stores) ? payload.stores : [])
        .map((store) => ({
          id: String(store._id || ''),
          name: store.nomeFantasia || store.nome || store.razaoSocial || 'Loja',
        }))
        .filter((store) => store.id);
      const requested = new URLSearchParams(window.location.search).get('storeId') || '';
      state.selectedStoreId = state.stores.some((store) => store.id === requested)
        ? requested
        : state.stores[0]?.id || '';
      renderStoreOptions();
      await loadStoreData(state.selectedStoreId);
    } catch (error) {
      state.stores = [];
      state.selectedStoreId = '';
      renderStoreOptions();
      resetEnvironment();
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function loadFacebookSdk() {
    if (window.FB) return Promise.resolve(window.FB);
    return new Promise((resolve, reject) => {
      const current = document.getElementById('facebook-jssdk');
      if (current) {
        current.addEventListener('load', () => resolve(window.FB), { once: true });
        current.addEventListener('error', () => reject(new Error('Falha ao carregar o SDK da Meta.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => window.FB ? resolve(window.FB) : reject(new Error('SDK da Meta indisponível.'));
      script.onerror = () => reject(new Error('Falha ao carregar o SDK da Meta.'));
      document.head.appendChild(script);
    });
  }

  function waitForEmbeddedSignupEvent() {
    let handler;
    let timer;
    const promise = new Promise((resolve, reject) => {
      handler = (event) => {
        let data = event.data;
        try {
          const hostname = new URL(event.origin).hostname;
          if (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com')) return;
        } catch (_) {
          return;
        }
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (_) {
            return;
          }
        }
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (['CANCEL', 'ERROR'].includes(data.event)) {
          reject(new Error(data.data?.error_message || 'A conexão foi cancelada na Meta.'));
          return;
        }
        if (data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
          resolve({ event: data.event, sessionInfo: data.data || {} });
        }
      };
      window.addEventListener('message', handler);
      timer = window.setTimeout(
        () => reject(new Error('A Meta não retornou os dados de coexistência a tempo.')),
        120000
      );
    });
    // Evita rejeição não tratada enquanto a janela da Meta ainda está aberta.
    promise.catch(() => {});
    return {
      promise,
      cleanup() {
        window.clearTimeout(timer);
        window.removeEventListener('message', handler);
      },
    };
  }

  async function startEmbeddedSignup() {
    if (!state.selectedStoreId || !state.setup?.ready || state.onboarding) return;
    setBusy(true, 'Criando uma sessão exclusiva para esta loja...');
    const sessionEvent = waitForEmbeddedSignupEvent();
    try {
      const session = await requestJson(
        `/integrations/whatsapp/${encodeURIComponent(state.selectedStoreId)}/coexistence/session`,
        { method: 'POST', body: '{}' }
      );
      setBusy(true, 'Aguardando autorização na janela oficial da Meta...');
      const FB = await loadFacebookSdk();
      FB.init({
        appId: session.appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: session.graphApiVersion || 'v25.0',
      });
      const login = await new Promise((resolve) => {
        FB.login(resolve, {
          config_id: session.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: session.featureType,
            sessionInfoVersion: session.sessionInfoVersion,
          },
        });
      });
      const code = login?.authResponse?.code;
      if (!code) throw new Error('A autorização não foi concluída na Meta.');
      const embedded = await sessionEvent.promise;
      setBusy(true, 'Confirmando coexistência e iniciando a sincronização...');
      const result = await requestJson(
        `/integrations/whatsapp/${encodeURIComponent(state.selectedStoreId)}/coexistence/complete`,
        {
          method: 'POST',
          body: JSON.stringify({
            sessionId: session.sessionId,
            code,
            event: embedded.event,
            sessionInfo: embedded.sessionInfo,
          }),
        }
      );
      notify(result.message || 'Número conectado com coexistência.', 'success');
      await loadStoreData(state.selectedStoreId);
    } catch (error) {
      notify(error.message, 'error');
      await loadStoreData(state.selectedStoreId);
    } finally {
      sessionEvent.cleanup();
      setBusy(false);
    }
  }

  async function saveSetup(event) {
    event.preventDefault();
    if (!canConfigure() || !state.selectedStoreId) return;
    setBusy(true, 'Salvando configuração criptografada da loja...');
    try {
      const body = {
        appId: elements.appId.value.trim(),
        configId: elements.configId.value.trim(),
        graphApiVersion: 'v25.0',
        ...(elements.appSecret.value.trim()
          ? { appSecret: elements.appSecret.value.trim() }
          : {}),
        ...(elements.verifyToken.value.trim()
          ? { verifyToken: elements.verifyToken.value.trim() }
          : {}),
      };
      state.setup = await requestJson(
        `/integrations/whatsapp/${encodeURIComponent(state.selectedStoreId)}/coexistence/setup`,
        { method: 'PUT', body: JSON.stringify(body) }
      );
      renderEnvironment();
      await loadPilotReadiness(
        state.setup?.phoneNumbers || state.environment?.phoneNumbers || []
      );
      notify('Configuração da Meta salva para esta loja.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      elements.appSecret.value = '';
      elements.verifyToken.value = '';
      setBusy(false);
    }
  }

  async function runHealthCheck() {
    if (!state.selectedStoreId || state.onboarding) return;
    setBusy(true, 'Consultando o estado do número diretamente na Meta...');
    try {
      const result = await requestJson(
        `/integrations/whatsapp/${encodeURIComponent(state.selectedStoreId)}/coexistence/health`,
        { method: 'POST', body: '{}' }
      );
      state.setup = result.setup;
      renderEnvironment();
      await loadPilotReadiness(
        state.setup?.phoneNumbers || state.environment?.phoneNumbers || []
      );
      notify(
        result.healthy
          ? 'Coexistência confirmada pela Meta.'
          : 'A Meta não confirmou a coexistência deste número.',
        result.healthy ? 'success' : 'error'
      );
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  elements.webhookUrl.textContent = resolveWebhookUrl();
  elements.companySelect.addEventListener('change', async (event) => {
    state.selectedStoreId = event.target.value || '';
    await loadStoreData(state.selectedStoreId);
  });
  elements.refreshButton.addEventListener('click', () => {
    void loadStoreData(state.selectedStoreId);
  });
  elements.setupForm.addEventListener('submit', (event) => {
    void saveSetup(event);
  });
  elements.connectButton.addEventListener('click', () => {
    void startEmbeddedSignup();
  });
  elements.healthButton.addEventListener('click', () => {
    void runHealthCheck();
  });

  resetEnvironment();
  void loadStores();
});
