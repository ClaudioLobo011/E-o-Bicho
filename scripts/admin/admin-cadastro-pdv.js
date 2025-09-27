(function () {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const ambientesPermitidos = ['homologacao', 'producao'];
  const ambientesLabels = {
    homologacao: 'Homologação',
    producao: 'Produção',
  };

  const state = {
    pdvs: [],
    stores: [],
    editingId: null,
    nextCode: '',
    saving: false,
  };

  const selectors = {
    form: '#pdv-form',
    idInput: '#pdv-id',
    code: '#pdv-code',
    name: '#pdv-name',
    alias: '#pdv-alias',
    active: '#pdv-active',
    activeLabel: '[data-active-label]',
    company: '#pdv-company',
    nfeSeries: '#pdv-nfe-series',
    nfceSeries: '#pdv-nfce-series',
    envHomologacao: '#pdv-env-homologacao',
    envProducao: '#pdv-env-producao',
    envDefaultHomologacao: '#pdv-env-default-homologacao',
    envDefaultProducao: '#pdv-env-default-producao',
    syncAuto: '#pdv-sync-auto',
    lastSync: '#pdv-last-sync',
    offline: '#pdv-offline',
    offlineLimit: '#pdv-offline-limit',
    notes: '#pdv-notes',
    cancelEdit: '#pdv-cancel-edit',
    resetForm: '#pdv-reset-form',
    submitLabel: '#pdv-submit-label',
    submitButton: '#pdv-form button[type="submit"]',
    companySummary: '#pdv-company-summary',
    pdvList: '#pdv-list',
    pdvCount: '#pdv-count',
    pdvEmptyState: '#pdv-empty-state',
    createdInfo: '#pdv-created-info',
    updatedInfo: '#pdv-updated-info',
    createdBy: '#pdv-created-by',
    updatedBy: '#pdv-updated-by',
  };

  const elements = {};
  const normalizeId = (value) => (value == null ? '' : String(value));
  const normalizeStoreRecord = (store) => {
    if (!store || typeof store !== 'object') return store;
    return { ...store, _id: normalizeId(store._id) };
  };
  const normalizePdvRecord = (pdv) => {
    if (!pdv || typeof pdv !== 'object') return pdv;
    const normalized = { ...pdv, _id: normalizeId(pdv._id) };
    if (pdv.empresa && typeof pdv.empresa === 'object') {
      normalized.empresa = { ...pdv.empresa, _id: normalizeId(pdv.empresa._id) };
    } else if (pdv.empresa != null) {
      normalized.empresa = normalizeId(pdv.empresa);
    }
    return normalized;
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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

  const extractNumericValue = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return 0;
    const matches = normalized.match(/\d+/g);
    if (!matches) {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return matches.reduce((max, part) => {
      const parsed = Number(part);
      return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);
  };

  const computeNextCodeFromState = () => {
    if (!state.pdvs.length) {
      return 'PDV-001';
    }
    const highest = state.pdvs.reduce((max, pdv) => {
      const current = extractNumericValue(pdv?.codigo);
      return current > max ? current : max;
    }, 0);
    return `PDV-${String(highest + 1).padStart(3, '0')}`;
  };

  const updateSubmitLabel = () => {
    if (!elements.submitLabel) return;
    if (state.saving) {
      elements.submitLabel.textContent = 'Salvando...';
      return;
    }
    elements.submitLabel.textContent = state.editingId ? 'Salvar alterações' : 'Salvar PDV';
  };

  const setSavingState = (saving) => {
    state.saving = saving;
    if (elements.submitButton) {
      elements.submitButton.disabled = saving;
      elements.submitButton.classList.toggle('opacity-60', saving);
      elements.submitButton.classList.toggle('pointer-events-none', saving);
    }
    updateSubmitLabel();
  };

  const updateActiveToggleLabel = () => {
    if (!elements.active || !elements.activeLabel) return;
    const label = elements.active.checked ? 'Ativo' : 'Inativo';
    elements.activeLabel.textContent = label;
    const toggle = elements.active.closest('label')?.querySelector('[data-toggle]');
    const dot = elements.active.closest('label')?.querySelector('[data-toggle-dot]');
    if (toggle && dot) {
      if (elements.active.checked) {
        toggle.classList.remove('bg-gray-200');
        toggle.classList.add('bg-emerald-500');
        dot.style.transform = 'translateX(20px)';
      } else {
        toggle.classList.add('bg-gray-200');
        toggle.classList.remove('bg-emerald-500');
        dot.style.transform = 'translateX(0)';
      }
    }
  };

  const storeSupportsEnvironment = (store, env) => {
    if (!store) return false;
    if (env === 'producao') {
      return Boolean(store.cscIdProducao && store.cscTokenProducaoArmazenado);
    }
    if (env === 'homologacao') {
      return Boolean(store.cscIdHomologacao && store.cscTokenHomologacaoArmazenado);
    }
    return false;
  };

  const getSelectedStore = () => {
    const companyId = normalizeId(elements.company?.value);
    if (!companyId) return null;
    return (
      state.stores.find((store) => normalizeId(store?._id) === companyId) || null
    );
  };

  const buildCscCard = (store, env) => {
    const label = ambientesLabels[env] || env;
    const idKey = env === 'producao' ? 'cscIdProducao' : 'cscIdHomologacao';
    const tokenKey = env === 'producao' ? 'cscTokenProducaoArmazenado' : 'cscTokenHomologacaoArmazenado';
    const idValue = store?.[idKey] || '—';
    const tokenStored = Boolean(store?.[tokenKey]);
    const badgeClass = tokenStored
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
      : 'bg-amber-50 text-amber-700 border border-amber-100';
    const badgeLabel = tokenStored ? 'Token armazenado' : 'Token pendente';
    const hint = tokenStored
      ? ''
      : '<p class="text-xs text-amber-700 mt-2">Cadastre o token correspondente na empresa para habilitar este ambiente.</p>';
    return `
      <div class="rounded-lg border border-gray-200 p-3 bg-gray-50">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs uppercase tracking-wide text-gray-500">${label}</p>
            <p class="text-sm font-medium text-gray-800">ID: ${idValue || '—'}</p>
          </div>
          <span class="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ${badgeClass}">${badgeLabel}</span>
        </div>
        ${hint}
      </div>
    `;
  };

  const updateCompanySummary = () => {
    if (!elements.companySummary) return;
    const store = getSelectedStore();
    if (!store) {
      elements.companySummary.innerHTML = '<p class="text-gray-500">Selecione uma empresa para visualizar seus dados.</p>';
      return;
    }

    const regime = store.regimeTributario
      ? store.regimeTributario.charAt(0).toUpperCase() + store.regimeTributario.slice(1)
      : '—';
    const availability = ambientesPermitidos.map((env) => ({
      env,
      available: storeSupportsEnvironment(store, env),
    }));
    const unavailable = availability.filter((item) => !item.available);
    let availabilityMessage = '';
    if (unavailable.length) {
      const names = unavailable.map((item) => ambientesLabels[item.env]).join(' e ');
      availabilityMessage = `
        <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          Configure o CSC de ${names} na empresa para liberar este ambiente para o PDV.
        </div>
      `;
    }

    const homologacaoCard = buildCscCard(store, 'homologacao');
    const producaoCard = buildCscCard(store, 'producao');

    elements.companySummary.innerHTML = `
      <div class="space-y-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Nome</p>
          <p class="text-sm font-semibold text-gray-800">${store.nome || store.nomeFantasia || '—'}</p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Razão social</p>
          <p class="text-sm text-gray-700">${store.razaoSocial || '—'}</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <p class="text-xs uppercase tracking-wide text-gray-500">CNPJ</p>
            <p class="text-sm text-gray-700">${store.cnpj || '—'}</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-gray-500">Regime</p>
            <p class="text-sm text-gray-700">${regime}</p>
          </div>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-gray-500">Contato fiscal</p>
          <p class="text-sm text-gray-700">${store.emailFiscal || '—'}</p>
        </div>
        <div class="space-y-3">
          ${homologacaoCard}
          ${producaoCard}
        </div>
        ${availabilityMessage}
      </div>
    `;
  };
  const getEnvironmentCheckboxes = () => ({
    homologacao: elements.envHomologacao,
    producao: elements.envProducao,
  });

  const getEnvironmentRadios = () => [elements.envDefaultHomologacao, elements.envDefaultProducao].filter(Boolean);

  const getEnabledEnvironments = () => {
    const checkboxes = getEnvironmentCheckboxes();
    return Object.entries(checkboxes)
      .filter(([, checkbox]) => checkbox && checkbox.checked && !checkbox.disabled)
      .map(([key]) => key);
  };

  const getSelectedDefaultEnvironment = () => {
    const radio = getEnvironmentRadios().find((item) => item && item.checked);
    return radio ? radio.value : '';
  };

  const syncDefaultEnvironment = (preferred) => {
    const checkboxes = getEnvironmentCheckboxes();
    const radios = getEnvironmentRadios();
    const enabled = Object.entries(checkboxes)
      .filter(([, checkbox]) => checkbox && checkbox.checked && !checkbox.disabled)
      .map(([key]) => key);

    radios.forEach((radio) => {
      if (!radio) return;
      const allow = enabled.includes(radio.value);
      radio.disabled = !allow;
      if (!allow) {
        radio.checked = false;
      }
    });

    const current = radios.find((radio) => radio.checked)?.value;
    if (current && enabled.includes(current)) {
      return;
    }

    if (preferred && enabled.includes(preferred)) {
      const target = radios.find((radio) => radio.value === preferred);
      if (target) target.checked = true;
      return;
    }

    if (enabled.length) {
      const target = radios.find((radio) => radio.value === enabled[0]);
      if (target) target.checked = true;
    }
  };

  const syncEnvironmentAvailability = ({ preserveSelection = false, preferredDefault = '' } = {}) => {
    const store = getSelectedStore();
    const availability = {
      homologacao: storeSupportsEnvironment(store, 'homologacao'),
      producao: storeSupportsEnvironment(store, 'producao'),
    };

    const checkboxes = getEnvironmentCheckboxes();
    Object.entries(checkboxes).forEach(([env, checkbox]) => {
      if (!checkbox) return;
      if (!store) {
        checkbox.checked = false;
        checkbox.disabled = true;
        return;
      }
      const available = availability[env];
      checkbox.disabled = !available;
      if (!available) {
        checkbox.checked = false;
      } else if (!preserveSelection) {
        if (env === 'homologacao') {
          checkbox.checked = true;
        }
        if (env === 'producao') {
          checkbox.checked = false;
        }
      }
    });

    const radios = getEnvironmentRadios();
    radios.forEach((radio) => {
      if (!radio) return;
      if (!store) {
        radio.disabled = true;
        radio.checked = false;
        return;
      }
      const available = availability[radio.value];
      radio.disabled = !available;
      if (!available) {
        radio.checked = false;
      }
    });

    if (store) {
      const enabled = getEnabledEnvironments();
      const anyAvailable = Object.values(availability).some(Boolean);
      if (!enabled.length && anyAvailable) {
        const fallback = availability.homologacao ? 'homologacao' : availability.producao ? 'producao' : '';
        if (fallback) {
          const checkbox = checkboxes[fallback];
          if (checkbox && !checkbox.disabled) {
            checkbox.checked = true;
          }
        }
      }
    }

    syncDefaultEnvironment(preferredDefault);
  };

  const updateOfflineLimitState = () => {
    if (!elements.offline || !elements.offlineLimit) return;
    if (elements.offline.checked) {
      elements.offlineLimit.disabled = false;
      if (!elements.offlineLimit.value) {
        elements.offlineLimit.value = '10';
      }
    } else {
      elements.offlineLimit.disabled = true;
      elements.offlineLimit.value = '';
    }
  };

  const resetAuditInfo = () => {
    if (elements.createdInfo) elements.createdInfo.textContent = 'Será preenchido após o cadastro';
    if (elements.updatedInfo) elements.updatedInfo.textContent = 'Será preenchido após alterações';
    if (elements.createdBy) elements.createdBy.textContent = '—';
    if (elements.updatedBy) elements.updatedBy.textContent = '—';
  };

  const updateAuditInfo = (pdv) => {
    if (!pdv) {
      resetAuditInfo();
      return;
    }
    if (elements.createdInfo) elements.createdInfo.textContent = formatDateTime(pdv.createdAt);
    if (elements.updatedInfo) elements.updatedInfo.textContent = formatDateTime(pdv.updatedAt);
    if (elements.createdBy) elements.createdBy.textContent = pdv.criadoPor || '—';
    if (elements.updatedBy) elements.updatedBy.textContent = pdv.atualizadoPor || '—';
  };

  const formatEnvironmentLabel = (value) => ambientesLabels[value] || '—';

  const getEnabledEnvironmentBadges = (pdv) => {
    if (!pdv || !Array.isArray(pdv.ambientesHabilitados)) return '';
    return pdv.ambientesHabilitados
      .map((env) => {
        const label = formatEnvironmentLabel(env);
        const isDefault = pdv.ambientePadrao === env;
        const classes = isDefault
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-gray-100 text-gray-600 border-gray-200';
        return `<span class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold ${classes}">
          <i class="fas fa-circle text-[7px]"></i>
          ${label}
        </span>`;
      })
      .join('');
  };

  const renderPdvs = () => {
    if (!elements.pdvList) return;
    if (!state.pdvs.length) {
      elements.pdvList.innerHTML = '';
      elements.pdvEmptyState?.classList.remove('hidden');
      if (elements.pdvCount) elements.pdvCount.textContent = '0';
      return;
    }

    elements.pdvEmptyState?.classList.add('hidden');
    if (elements.pdvCount) elements.pdvCount.textContent = String(state.pdvs.length);

    const rows = state.pdvs
      .slice()
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }))
      .map((pdv) => {
        const empresa = typeof pdv.empresa === 'object' && pdv.empresa ? pdv.empresa : null;
        const empresaNome = empresa?.nome || empresa?.nomeFantasia || '—';
        const ambientes = getEnabledEnvironmentBadges(pdv);
        const ambientePadrao = formatEnvironmentLabel(pdv.ambientePadrao);
        const ultimaSync = pdv.ultimaSincronizacao
          ? formatDateTime(pdv.ultimaSincronizacao)
          : 'Nunca sincronizado';
        const statusClass = pdv.ativo
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
          : 'bg-gray-100 text-gray-600 border border-gray-200';
        const statusLabel = pdv.ativo ? 'Ativo' : 'Inativo';

        const pdvId = normalizeId(pdv._id);
        return `
          <article class="rounded-xl border border-gray-200 p-4 shadow-sm hover:border-primary/40 transition" data-id="${pdvId}">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold text-gray-800">${pdv.nome || '—'}</h3>
                <p class="text-xs text-gray-500">${pdv.codigo || '—'} • ${empresaNome}</p>
              </div>
              <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusClass}">${statusLabel}</span>
            </div>
            <dl class="mt-3 space-y-2 text-xs text-gray-600">
              <div class="flex items-center justify-between">
                <dt class="uppercase tracking-wide text-gray-500">Ambiente padrão</dt>
                <dd class="font-medium text-gray-700">${ambientePadrao}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="uppercase tracking-wide text-gray-500">Sincronização</dt>
                <dd class="font-medium text-gray-700">${pdv.sincronizacaoAutomatica ? 'Automática' : 'Manual'}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="uppercase tracking-wide text-gray-500">Última sync.</dt>
                <dd class="font-medium text-gray-700">${ultimaSync}</dd>
              </div>
            </dl>
            <div class="mt-3 flex flex-wrap gap-2">${ambientes}</div>
            <div class="mt-4 flex items-center justify-end gap-2">
              <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-primary hover:text-primary transition" data-action="edit" data-id="${pdvId}">
                <i class="fas fa-pen"></i>
                Editar
              </button>
              <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:border-red-400 hover:text-red-700 transition" data-action="delete" data-id="${pdvId}">
                <i class="fas fa-trash"></i>
                Excluir
              </button>
            </div>
          </article>
        `;
      })
      .join('');

    elements.pdvList.innerHTML = rows;
  };
  const updateCodeField = () => {
    if (!elements.code || state.editingId) return;
    const next = state.nextCode || computeNextCodeFromState();
    elements.code.value = next || '';
  };

  const startCreateFlow = () => {
    state.editingId = null;
    if (elements.idInput) elements.idInput.value = '';
    if (elements.form) elements.form.reset();
    setSavingState(false);
    if (elements.cancelEdit) elements.cancelEdit.classList.add('hidden');
    if (elements.lastSync) elements.lastSync.textContent = 'Nunca sincronizado';
    if (elements.active) {
      elements.active.checked = true;
      updateActiveToggleLabel();
    }
    if (elements.syncAuto) elements.syncAuto.checked = true;
    if (elements.offline) elements.offline.checked = false;
    if (elements.offlineLimit) {
      elements.offlineLimit.value = '';
      elements.offlineLimit.disabled = true;
    }
    if (elements.notes) elements.notes.value = '';
    resetAuditInfo();
    updateCompanySummary();
    syncEnvironmentAvailability({ preserveSelection: false, preferredDefault: 'homologacao' });
    updateCodeField();
  };

  const startEditFlow = (pdv) => {
    if (!pdv) return;
    state.editingId = normalizeId(pdv._id);
    if (elements.idInput) elements.idInput.value = state.editingId;
    if (elements.code) elements.code.value = pdv.codigo || '';
    if (elements.name) elements.name.value = pdv.nome || '';
    if (elements.alias) elements.alias.value = pdv.apelido || '';
    if (elements.active) {
      elements.active.checked = Boolean(pdv.ativo);
      updateActiveToggleLabel();
    }
    const empresaId =
      typeof pdv.empresa === 'object' && pdv.empresa
        ? normalizeId(pdv.empresa._id)
        : normalizeId(pdv.empresa);
    if (elements.company) {
      elements.company.value = empresaId;
    }
    updateCompanySummary();
    if (elements.nfeSeries) elements.nfeSeries.value = pdv.serieNfe || '';
    if (elements.nfceSeries) elements.nfceSeries.value = pdv.serieNfce || '';
    if (elements.syncAuto) elements.syncAuto.checked = pdv.sincronizacaoAutomatica !== false;
    if (elements.offline) elements.offline.checked = Boolean(pdv.permitirModoOffline);
    if (elements.offlineLimit) {
      if (pdv.permitirModoOffline) {
        elements.offlineLimit.disabled = false;
        elements.offlineLimit.value =
          pdv.limiteOffline !== null && pdv.limiteOffline !== undefined
            ? String(pdv.limiteOffline)
            : '';
      } else {
        elements.offlineLimit.disabled = true;
        elements.offlineLimit.value = '';
      }
    }
    if (elements.notes) elements.notes.value = pdv.observacoes || '';
    if (elements.lastSync) {
      elements.lastSync.textContent = pdv.ultimaSincronizacao
        ? formatDateTime(pdv.ultimaSincronizacao)
        : 'Nunca sincronizado';
    }

    const checkboxes = getEnvironmentCheckboxes();
    Object.values(checkboxes).forEach((checkbox) => {
      if (checkbox) checkbox.checked = false;
    });
    (Array.isArray(pdv.ambientesHabilitados) ? pdv.ambientesHabilitados : []).forEach((env) => {
      const checkbox = checkboxes[env];
      if (checkbox) checkbox.checked = true;
    });
    syncEnvironmentAvailability({ preserveSelection: true, preferredDefault: pdv.ambientePadrao });

    if (elements.cancelEdit) elements.cancelEdit.classList.remove('hidden');
    setSavingState(false);
    updateAuditInfo(pdv);
  };

  const confirmDeletion = async (pdv) => {
    if (typeof window?.showModal === 'function') {
      return new Promise((resolve) => {
        window.showModal({
          title: 'Excluir PDV',
          message: `Deseja realmente remover o PDV <strong>${pdv.nome}</strong>? Essa ação não pode ser desfeita.`,
          confirmText: 'Excluir',
          cancelText: 'Cancelar',
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
    }
    return window.confirm(`Deseja realmente remover o PDV ${pdv.nome}?`);
  };

  const parseErrorResponse = async (response, fallback) => {
    try {
      const data = await response.json();
      if (data?.message) return data.message;
    } catch (error) {
      // ignore
    }
    return fallback;
  };

  const deletePdv = async (pdvId) => {
    const token = getToken();
    if (!token) throw new Error('Faça login novamente para continuar.');
    const response = await fetch(`${API_BASE}/pdvs/${pdvId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Não foi possível remover o PDV.');
      throw new Error(message);
    }
  };
  const handleDelete = async (pdvId) => {
    const targetId = normalizeId(pdvId);
    const pdv = state.pdvs.find((item) => normalizeId(item._id) === targetId);
    if (!pdv) return;
    const confirmed = await confirmDeletion(pdv);
    if (!confirmed) return;

    try {
      await deletePdv(targetId);
      await fetchPdvs();
      await fetchNextCode();
      if (state.editingId === targetId) {
        startCreateFlow();
      }
      notify('PDV removido com sucesso.', 'success');
    } catch (error) {
      console.error('Erro ao remover PDV:', error);
      notify(error.message || 'Erro ao remover PDV.', 'error');
    }
  };

  const buildPayloadFromForm = () => {
    const nome = elements.name?.value.trim();
    if (!nome) {
      notify('Informe o nome do PDV.', 'warning');
      elements.name?.focus();
      return null;
    }

    const empresaId = normalizeId(elements.company?.value);
    if (!empresaId) {
      notify('Selecione a empresa responsável pelo PDV.', 'warning');
      elements.company?.focus();
      return null;
    }

    const store = state.stores.find((item) => normalizeId(item._id) === empresaId);
    if (!store) {
      notify('Não foi possível localizar a empresa selecionada.', 'error');
      return null;
    }

    const ambientesHabilitados = getEnabledEnvironments();
    if (!ambientesHabilitados.length) {
      notify('Habilite ao menos um ambiente fiscal para o PDV.', 'warning');
      return null;
    }

    const ambientePadrao = getSelectedDefaultEnvironment();
    if (!ambientePadrao) {
      notify('Defina o ambiente padrão de emissão.', 'warning');
      return null;
    }

    for (const env of ambientesHabilitados) {
      if (!storeSupportsEnvironment(store, env)) {
        notify(`Configure o CSC de ${ambientesLabels[env]} na empresa para utilizar este ambiente.`, 'warning');
        return null;
      }
    }

    if (!storeSupportsEnvironment(store, ambientePadrao)) {
      notify('O ambiente padrão selecionado não está disponível para a empresa.', 'warning');
      return null;
    }

    const permitirModoOffline = Boolean(elements.offline?.checked);
    let limiteOffline = null;
    if (permitirModoOffline) {
      const rawLimit = elements.offlineLimit?.value.trim() ?? '';
      limiteOffline = rawLimit ? Number(rawLimit) : 0;
      if (!Number.isFinite(limiteOffline) || limiteOffline < 0) {
        notify('Informe um limite de emissões offline válido (maior ou igual a zero).', 'warning');
        elements.offlineLimit?.focus();
        return null;
      }
    }

    const codigo = elements.code?.value.trim();
    if (state.editingId && !codigo) {
      notify('O código do PDV não foi carregado. Recarregue a página e tente novamente.', 'error');
      return null;
    }

    return {
      codigo: codigo || undefined,
      nome,
      apelido: elements.alias?.value.trim() || '',
      ativo: Boolean(elements.active?.checked),
      empresa: empresaId,
      serieNfe: elements.nfeSeries?.value.trim() || '',
      serieNfce: elements.nfceSeries?.value.trim() || '',
      ambientesHabilitados,
      ambientePadrao,
      sincronizacaoAutomatica: Boolean(elements.syncAuto?.checked),
      permitirModoOffline,
      limiteOffline: permitirModoOffline ? limiteOffline : null,
      observacoes: elements.notes?.value.trim() || '',
    };
  };

  const populateCompanySelect = () => {
    if (!elements.company) return;
    const previous = normalizeId(elements.company.value);

    if (!state.stores.length) {
      elements.company.innerHTML = '<option value="">Nenhuma empresa cadastrada</option>';
    } else {
      const options = ['<option value="">Selecione uma empresa</option>'];
      state.stores.forEach((store) => {
        const storeId = normalizeId(store._id);
        options.push(
          `<option value="${storeId}">${
            store.nome || store.nomeFantasia || 'Empresa sem nome'
          }</option>`
        );
      });
      elements.company.innerHTML = options.join('');
    }

    if (previous && state.stores.some((store) => normalizeId(store._id) === previous)) {
      elements.company.value = previous;
    }

    updateCompanySummary();
  };

  const fetchStores = async () => {
    const response = await fetch(`${API_BASE}/stores`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar as empresas cadastradas.');
    }
    const payload = await response.json();
    state.stores = Array.isArray(payload) ? payload.map(normalizeStoreRecord) : [];
    populateCompanySelect();
    if (!state.editingId) {
      syncEnvironmentAvailability({ preserveSelection: false, preferredDefault: 'homologacao' });
    }
  };

  const fetchPdvs = async () => {
    const response = await fetch(`${API_BASE}/pdvs`);
    if (!response.ok) {
      throw new Error('Não foi possível carregar os PDVs cadastrados.');
    }
    const payload = await response.json();
    const pdvs = Array.isArray(payload?.pdvs)
      ? payload.pdvs
      : Array.isArray(payload)
      ? payload
      : [];
    state.pdvs = pdvs.map(normalizePdvRecord);
    renderPdvs();
    updateCodeField();
  };

  const fetchNextCode = async () => {
    try {
      const response = await fetch(`${API_BASE}/pdvs/next-code`);
      if (!response.ok) {
        throw new Error('Falha ao obter o próximo código de PDV.');
      }
      const payload = await response.json();
      state.nextCode = payload?.codigo || computeNextCodeFromState();
    } catch (error) {
      console.error('Erro ao calcular próximo código de PDV:', error);
      state.nextCode = computeNextCodeFromState();
    }
    updateCodeField();
  };

  const createPdv = async (payload) => {
    const token = getToken();
    if (!token) throw new Error('Faça login novamente para continuar.');
    const response = await fetch(`${API_BASE}/pdvs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Não foi possível criar o PDV.');
      throw new Error(message);
    }
    return response.json();
  };

  const updatePdv = async (pdvId, payload) => {
    const token = getToken();
    if (!token) throw new Error('Faça login novamente para continuar.');
    const response = await fetch(`${API_BASE}/pdvs/${pdvId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Não foi possível atualizar o PDV.');
      throw new Error(message);
    }
    return response.json();
  };
  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = buildPayloadFromForm();
    if (!payload) return;

    try {
      setSavingState(true);
      if (state.editingId) {
        await updatePdv(state.editingId, payload);
        await fetchPdvs();
        await fetchNextCode();
        const updatedRecord = state.pdvs.find(
          (item) => normalizeId(item._id) === state.editingId
        );
        if (updatedRecord) {
          startEditFlow(updatedRecord);
        } else {
          startCreateFlow();
        }
        notify('Alterações salvas com sucesso.', 'success');
      } else {
        await createPdv(payload);
        await fetchPdvs();
        await fetchNextCode();
        startCreateFlow();
        notify('PDV cadastrado com sucesso.', 'success');
      }
    } catch (error) {
      console.error('Erro ao salvar PDV:', error);
      notify(error.message || 'Não foi possível salvar o PDV.', 'error');
    } finally {
      setSavingState(false);
    }
  };

  const bindEvents = () => {
    if (elements.form) elements.form.addEventListener('submit', handleSubmit);

    if (elements.cancelEdit) {
      elements.cancelEdit.addEventListener('click', () => {
        startCreateFlow();
        notify('Edição cancelada.', 'info');
      });
    }

    if (elements.resetForm) {
      elements.resetForm.addEventListener('click', () => {
        startCreateFlow();
        notify('Formulário limpo para um novo cadastro.', 'info');
      });
    }

    if (elements.active) {
      elements.active.addEventListener('change', updateActiveToggleLabel);
      updateActiveToggleLabel();
    }

    [elements.envHomologacao, elements.envProducao].forEach((checkbox) => {
      checkbox?.addEventListener('change', () => {
        const env = checkbox === elements.envHomologacao ? 'homologacao' : 'producao';
        const store = getSelectedStore();
        if (!store) {
          checkbox.checked = false;
          notify('Selecione uma empresa antes de definir os ambientes fiscais.', 'warning');
          return;
        }
        if (checkbox.checked && !storeSupportsEnvironment(store, env)) {
          checkbox.checked = false;
          notify(`Configure o CSC de ${ambientesLabels[env]} na empresa antes de habilitar este ambiente.`, 'warning');
        }
        syncDefaultEnvironment();
      });
    });

    getEnvironmentRadios().forEach((radio) => {
      radio.addEventListener('change', () => {
        syncDefaultEnvironment(radio.value);
      });
    });

    if (elements.offline) {
      elements.offline.addEventListener('change', updateOfflineLimitState);
      updateOfflineLimitState();
    }

    if (elements.company) {
      elements.company.addEventListener('change', () => {
        updateCompanySummary();
        syncEnvironmentAvailability({ preserveSelection: false, preferredDefault: 'homologacao' });
      });
    }

    if (elements.pdvList) {
      elements.pdvList.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const { action, id } = button.dataset;
        if (action === 'edit') {
          const pdv = state.pdvs.find((item) => normalizeId(item._id) === normalizeId(id));
          if (pdv) {
            startEditFlow(pdv);
            window.scrollTo({ top: elements.form?.offsetTop || 0, behavior: 'smooth' });
          }
        } else if (action === 'delete') {
          handleDelete(id);
        }
      });
    }
  };

  const initialize = async () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      elements[key] = document.querySelector(selector);
    });

    bindEvents();
    renderPdvs();
    startCreateFlow();

    try {
      await fetchStores();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      notify(error.message || 'Não foi possível carregar as empresas cadastradas.', 'error');
    }

    try {
      await fetchPdvs();
    } catch (error) {
      console.error('Erro ao carregar PDVs:', error);
      notify(error.message || 'Não foi possível carregar os PDVs cadastrados.', 'error');
    }

    await fetchNextCode();
  };

  document.addEventListener('DOMContentLoaded', initialize);
})();
