(function () {
  const STORAGE_KEY = 'adminPdvs';

  const state = {
    pdvs: [],
    stores: [],
    editingId: null,
  };

  const elements = {};

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
    csc: '#pdv-csc',
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
    companySummary: '#pdv-company-summary',
    pdvList: '#pdv-list',
    pdvCount: '#pdv-count',
    pdvEmptyState: '#pdv-empty-state',
    createdInfo: '#pdv-created-info',
    updatedInfo: '#pdv-updated-info',
    createdBy: '#pdv-created-by',
    updatedBy: '#pdv-updated-by',
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

  const getLoggedUser = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.warn('Não foi possível ler o usuário logado.', error);
      return null;
    }
  };

  const notify = (message, type = 'info') => {
    if (typeof window?.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    if (typeof window?.showModal === 'function') {
      window.showModal({ title: type === 'error' ? 'Erro' : 'Aviso', message, confirmText: 'OK' });
      return;
    }
    window.alert(message);
  };

  const loadPdvs = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      state.pdvs = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Erro ao carregar PDVs do armazenamento local.', error);
      state.pdvs = [];
    }
  };

  const persistPdvs = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pdvs));
    } catch (error) {
      console.error('Erro ao salvar PDVs no armazenamento local.', error);
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

  const computeNextCodeValue = () => {
    if (!state.pdvs.length) {
      return 'PDV-001';
    }
    const highest = state.pdvs.reduce((max, pdv) => {
      const current = extractNumericValue(pdv?.codigo);
      return current > max ? current : max;
    }, 0);
    return `PDV-${String(highest + 1).padStart(3, '0')}`;
  };

  const fillNextCode = () => {
    if (!elements.code || state.editingId) return;
    elements.code.value = computeNextCodeValue();
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

  const getEnvironmentCheckboxes = () => ({
    homologacao: elements.envHomologacao,
    producao: elements.envProducao,
  });

  const getEnvironmentRadios = () => [elements.envDefaultHomologacao, elements.envDefaultProducao].filter(Boolean);

  const syncDefaultEnvironment = (preferred) => {
    const checkboxes = getEnvironmentCheckboxes();
    const radios = getEnvironmentRadios();
    const enabled = Object.entries(checkboxes)
      .filter(([, checkbox]) => checkbox?.checked)
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

  const getSelectedDefaultEnvironment = () => {
    const radio = getEnvironmentRadios().find((item) => item?.checked);
    return radio ? radio.value : '';
  };

  const getEnabledEnvironments = () => {
    const checkboxes = getEnvironmentCheckboxes();
    return Object.entries(checkboxes)
      .filter(([, checkbox]) => checkbox?.checked)
      .map(([key]) => key);
  };

  const populateCompanySelect = () => {
    if (!elements.company) return;
    if (!state.stores.length) {
      elements.company.innerHTML = '<option value="">Nenhuma empresa cadastrada</option>';
      updateCompanySummary();
      return;
    }

    const options = ['<option value="">Selecione uma empresa</option>'];
    state.stores.forEach((store) => {
      options.push(`<option value="${store._id}">${store.nome || store.nomeFantasia || 'Empresa sem nome'}</option>`);
    });
    elements.company.innerHTML = options.join('');
    updateCompanySummary();
  };

  const updateCompanySummary = () => {
    if (!elements.companySummary) return;
    const companyId = elements.company?.value || '';
    if (!companyId) {
      elements.companySummary.innerHTML = '<p class="text-gray-500">Selecione uma empresa para visualizar seus dados.</p>';
      return;
    }

    const store = state.stores.find((item) => item._id === companyId);
    if (!store) {
      elements.companySummary.innerHTML = '<p class="text-gray-500">Não foi possível localizar os dados da empresa selecionada.</p>';
      return;
    }

    const cnpj = store.cnpj || '—';
    const regime = store.regimeTributario
      ? store.regimeTributario.charAt(0).toUpperCase() + store.regimeTributario.slice(1)
      : '—';

    elements.companySummary.innerHTML = `
      <div class="space-y-3">
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
            <p class="text-sm text-gray-700">${cnpj}</p>
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
      </div>
    `;
  };

  const formatEnvironmentLabel = (value) => {
    if (value === 'producao') return 'Produção';
    if (value === 'homologacao') return 'Homologação';
    return '—';
  };

  const renderPdvs = () => {
    if (!elements.pdvList) return;
    if (!state.pdvs.length) {
      elements.pdvList.innerHTML = '';
      if (elements.pdvEmptyState) elements.pdvEmptyState.classList.remove('hidden');
      if (elements.pdvCount) elements.pdvCount.textContent = '0';
      return;
    }

    if (elements.pdvEmptyState) elements.pdvEmptyState.classList.add('hidden');
    if (elements.pdvCount) elements.pdvCount.textContent = String(state.pdvs.length);

    const rows = state.pdvs
      .slice()
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
      .map((pdv) => {
        const ambientes = getEnabledEnvironmentBadges(pdv);
        const ambientePadrao = formatEnvironmentLabel(pdv.ambientePadrao);
        const ultimaSync = pdv.ultimaSincronizacao ? formatDateTime(pdv.ultimaSincronizacao) : 'Nunca sincronizado';
        const empresaNome = pdv.empresaNome || '—';
        const statusClass = pdv.ativo
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
          : 'bg-gray-100 text-gray-600 border border-gray-200';
        const statusLabel = pdv.ativo ? 'Ativo' : 'Inativo';

        return `
          <article class="rounded-xl border border-gray-200 p-4 shadow-sm hover:border-primary/40 transition" data-id="${pdv.id}">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold text-gray-800">${pdv.nome}</h3>
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
              <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-primary hover:text-primary transition" data-action="edit" data-id="${pdv.id}">
                <i class="fas fa-pen"></i>
                Editar
              </button>
              <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:border-red-400 hover:text-red-700 transition" data-action="delete" data-id="${pdv.id}">
                <i class="fas fa-trash"></i>
                Excluir
              </button>
            </div>
          </article>
        `;
      });

    elements.pdvList.innerHTML = rows.join('');
  };

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
    if (elements.createdInfo) elements.createdInfo.textContent = pdv.createdAt ? formatDateTime(pdv.createdAt) : '—';
    if (elements.updatedInfo) elements.updatedInfo.textContent = pdv.updatedAt ? formatDateTime(pdv.updatedAt) : '—';
    if (elements.createdBy) elements.createdBy.textContent = pdv.createdBy || '—';
    if (elements.updatedBy) elements.updatedBy.textContent = pdv.updatedBy || '—';
  };

  const startCreateFlow = () => {
    state.editingId = null;
    if (elements.idInput) elements.idInput.value = '';
    if (elements.form) elements.form.reset();
    if (elements.submitLabel) elements.submitLabel.textContent = 'Salvar PDV';
    if (elements.cancelEdit) elements.cancelEdit.classList.add('hidden');
    if (elements.lastSync) elements.lastSync.textContent = 'Nunca sincronizado';
    resetAuditInfo();

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

    if (elements.envHomologacao) elements.envHomologacao.checked = true;
    if (elements.envProducao) elements.envProducao.checked = false;
    syncDefaultEnvironment('homologacao');
    fillNextCode();
    updateCompanySummary();
  };

  const startEditFlow = (pdv) => {
    state.editingId = pdv.id;
    if (elements.idInput) elements.idInput.value = pdv.id;
    if (elements.code) elements.code.value = pdv.codigo || '';
    if (elements.name) elements.name.value = pdv.nome || '';
    if (elements.alias) elements.alias.value = pdv.apelido || '';
    if (elements.active) {
      elements.active.checked = Boolean(pdv.ativo);
      updateActiveToggleLabel();
    }
    if (elements.company) {
      elements.company.value = pdv.empresaId || '';
    }
    if (elements.nfeSeries) elements.nfeSeries.value = pdv.serieNfe || '';
    if (elements.nfceSeries) elements.nfceSeries.value = pdv.serieNfce || '';
    if (elements.csc) elements.csc.value = pdv.csc || '';
    if (elements.syncAuto) elements.syncAuto.checked = Boolean(pdv.sincronizacaoAutomatica);
    if (elements.offline) elements.offline.checked = Boolean(pdv.permitirModoOffline);
    if (elements.offlineLimit) {
      elements.offlineLimit.disabled = !pdv.permitirModoOffline;
      elements.offlineLimit.value = pdv.permitirModoOffline ? pdv.limiteOffline ?? '' : '';
    }
    if (elements.notes) elements.notes.value = pdv.observacoes || '';
    if (elements.lastSync) {
      elements.lastSync.textContent = pdv.ultimaSincronizacao ? formatDateTime(pdv.ultimaSincronizacao) : 'Nunca sincronizado';
    }

    if (elements.envHomologacao) elements.envHomologacao.checked = pdv.ambientesHabilitados?.includes('homologacao');
    if (elements.envProducao) elements.envProducao.checked = pdv.ambientesHabilitados?.includes('producao');
    syncDefaultEnvironment(pdv.ambientePadrao);

    if (elements.envDefaultHomologacao) {
      elements.envDefaultHomologacao.checked = pdv.ambientePadrao === 'homologacao';
    }
    if (elements.envDefaultProducao) {
      elements.envDefaultProducao.checked = pdv.ambientePadrao === 'producao';
    }

    if (elements.submitLabel) elements.submitLabel.textContent = 'Salvar alterações';
    if (elements.cancelEdit) elements.cancelEdit.classList.remove('hidden');
    updateCompanySummary();
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

  const handleDelete = async (pdvId) => {
    const pdv = state.pdvs.find((item) => item.id === pdvId);
    if (!pdv) return;
    const confirmed = await confirmDeletion(pdv);
    if (!confirmed) return;

    state.pdvs = state.pdvs.filter((item) => item.id !== pdvId);
    persistPdvs();
    renderPdvs();
    if (state.editingId === pdvId) {
      startCreateFlow();
    }
    notify('PDV removido com sucesso.', 'success');
  };

  const buildPayloadFromForm = () => {
    const empresaId = elements.company?.value || '';
    const nome = elements.name?.value.trim();
    if (!nome) {
      notify('Informe o nome do PDV.', 'warning');
      elements.name?.focus();
      return null;
    }
    if (!empresaId) {
      notify('Selecione a empresa responsável pelo PDV.', 'warning');
      elements.company?.focus();
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

    const empresa = state.stores.find((item) => item._id === empresaId);

    const payload = {
      id: state.editingId || `pdv-${Date.now()}`,
      codigo: elements.code?.value.trim() || computeNextCodeValue(),
      nome,
      apelido: elements.alias?.value.trim() || '',
      ativo: Boolean(elements.active?.checked),
      empresaId,
      empresaNome: empresa?.nome || empresa?.nomeFantasia || '',
      serieNfe: elements.nfeSeries?.value.trim() || '',
      serieNfce: elements.nfceSeries?.value.trim() || '',
      csc: elements.csc?.value.trim() || '',
      ambientesHabilitados,
      ambientePadrao,
      sincronizacaoAutomatica: Boolean(elements.syncAuto?.checked),
      permitirModoOffline: Boolean(elements.offline?.checked),
      limiteOffline: elements.offline?.checked ? Number(elements.offlineLimit?.value || 0) : null,
      observacoes: elements.notes?.value.trim() || '',
    };

    if (Number.isNaN(payload.limiteOffline)) {
      payload.limiteOffline = null;
    }

    return payload;
  };

  const upsertPdv = (payload) => {
    const now = new Date().toISOString();
    const user = getLoggedUser();
    const userName = user?.nome || user?.name || user?.email || 'Usuário';

    const existingIndex = state.pdvs.findIndex((item) => item.id === payload.id);
    if (existingIndex >= 0) {
      const current = state.pdvs[existingIndex];
      state.pdvs[existingIndex] = {
        ...current,
        ...payload,
        codigo: payload.codigo || current.codigo,
        limiteOffline: payload.permitirModoOffline ? payload.limiteOffline : null,
        updatedAt: now,
        updatedBy: userName,
        createdAt: current.createdAt || now,
        createdBy: current.createdBy || userName,
        ultimaSincronizacao: current.ultimaSincronizacao || null,
      };
      return state.pdvs[existingIndex];
    }

    const created = {
      ...payload,
      limiteOffline: payload.permitirModoOffline ? payload.limiteOffline : null,
      createdAt: now,
      updatedAt: now,
      createdBy: userName,
      updatedBy: userName,
      ultimaSincronizacao: null,
    };
    state.pdvs.push(created);
    return created;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const payload = buildPayloadFromForm();
    if (!payload) return;

    const record = upsertPdv(payload);
    persistPdvs();
    renderPdvs();
    updateAuditInfo(record);
    if (!state.editingId) {
      notify('PDV cadastrado com sucesso.', 'success');
      startCreateFlow();
    } else {
      notify('Alterações salvas com sucesso.', 'success');
      state.editingId = record.id;
      if (elements.idInput) elements.idInput.value = record.id;
      if (elements.submitLabel) elements.submitLabel.textContent = 'Salvar alterações';
      if (elements.cancelEdit) elements.cancelEdit.classList.remove('hidden');
      if (elements.lastSync) {
        elements.lastSync.textContent = record.ultimaSincronizacao
          ? formatDateTime(record.ultimaSincronizacao)
          : 'Nunca sincronizado';
      }
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
        syncDefaultEnvironment();
      });
    });

    getEnvironmentRadios().forEach((radio) => {
      radio.addEventListener('change', () => {
        syncDefaultEnvironment(radio.value);
      });
    });

    if (elements.offline && elements.offlineLimit) {
      elements.offline.addEventListener('change', () => {
        if (elements.offline.checked) {
          elements.offlineLimit.disabled = false;
          if (!elements.offlineLimit.value) {
            elements.offlineLimit.value = '10';
          }
        } else {
          elements.offlineLimit.disabled = true;
          elements.offlineLimit.value = '';
        }
      });
    }

    if (elements.company) {
      elements.company.addEventListener('change', updateCompanySummary);
    }

    if (elements.pdvList) {
      elements.pdvList.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const { action, id } = button.dataset;
        if (action === 'edit') {
          const pdv = state.pdvs.find((item) => item.id === id);
          if (pdv) startEditFlow(pdv);
        } else if (action === 'delete') {
          handleDelete(id);
        }
      });
    }
  };

  const fetchStores = async () => {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
      if (!response.ok) throw new Error('Não foi possível carregar as empresas cadastradas.');
      const payload = await response.json();
      state.stores = Array.isArray(payload) ? payload : [];
      populateCompanySelect();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      state.stores = [];
      populateCompanySelect();
      notify(error.message || 'Não foi possível carregar as empresas cadastradas.', 'error');
    }
  };

  const initialize = () => {
    Object.entries(selectors).forEach(([key, selector]) => {
      elements[key] = document.querySelector(selector);
    });

    loadPdvs();
    renderPdvs();
    bindEvents();
    fetchStores();
    startCreateFlow();
  };

  document.addEventListener('DOMContentLoaded', initialize);
})();
