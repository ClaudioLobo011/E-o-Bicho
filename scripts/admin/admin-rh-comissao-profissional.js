(() => {
  const API = `${API_CONFIG.BASE_URL}/admin/comissoes-profissionais`;

  const elements = {
    search: document.getElementById('commission-professional-search'),
    list: document.getElementById('commission-professionals-list'),
    listCounter: document.getElementById('commission-professionals-counter'),
    listEmpty: document.getElementById('commission-professionals-empty'),
    selectedBadge: document.getElementById('commission-selected-badge'),
    roleBadge: document.getElementById('commission-role-badge'),
    saveButton: document.getElementById('commission-save-btn'),
    selectionPlaceholder: document.getElementById('commission-selection-placeholder'),
    editor: document.getElementById('commission-editor'),
    professionalName: document.getElementById('commission-professional-name'),
    professionalRole: document.getElementById('commission-professional-role'),
    servicesCount: document.getElementById('commission-services-count'),
    groupsBody: document.getElementById('commission-groups-body'),
    serviceSearch: document.getElementById('commission-service-search'),
    servicesBody: document.getElementById('commission-services-body'),
  };

  const state = {
    professionals: [],
    groups: [],
    services: [],
    configsByUser: new Map(),
    selectedProfessionalId: '',
    selectedProfessionalType: '',
    professionalSearch: '',
    serviceSearch: '',
    dirty: false,
  };

  const getToken = () => {
    try {
      const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return cached?.token || '';
    } catch {
      return '';
    }
  };

  const notifyUser = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    alert(message);
  };

  const fetchJSON = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message =
        (payload && typeof payload.message === 'string' && payload.message) ||
        `Erro HTTP ${response.status}`;
      throw new Error(message);
    }

    return response.json();
  };

  const normalizeText = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();

  const formatPercent = (value) =>
    `${Number(value || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;

  const formatProfessionalType = (value) => {
    switch (String(value || '').toLowerCase()) {
      case 'esteticista':
        return 'Esteticista';
      case 'veterinario':
        return 'Veterinário';
      default:
        return 'Não definido';
    }
  };

  const getSelectedProfessional = () =>
    state.professionals.find((item) => item._id === state.selectedProfessionalId) || null;

  const getSelectedConfig = () => state.configsByUser.get(state.selectedProfessionalId) || null;

  const getSelectedType = () => {
    const selected = getSelectedProfessional();
    if (!selected) return '';
    if (
      state.selectedProfessionalType &&
      Array.isArray(selected.professionalTypes) &&
      selected.professionalTypes.includes(state.selectedProfessionalType)
    ) {
      return state.selectedProfessionalType;
    }
    return selected.professionalType || (selected.professionalTypes || [])[0] || '';
  };

  const getEligibleGroups = () => {
    const professionalType = getSelectedType();
    return state.groups.filter((group) =>
      Array.isArray(group.tiposPermitidos) && group.tiposPermitidos.includes(professionalType)
    );
  };

  const getEligibleServices = () => {
    const professionalType = getSelectedType();
    const term = normalizeText(state.serviceSearch);
    return state.services.filter((service) => {
      const allowed = Array.isArray(service?.grupo?.tiposPermitidos)
        ? service.grupo.tiposPermitidos.includes(professionalType)
        : false;
      if (!allowed) return false;
      if (!term) return true;
      return normalizeText(`${service.nome} ${service?.grupo?.nome || ''}`).includes(term);
    });
  };

  const getGroupRuleMap = () => {
    const config = getSelectedConfig();
    const map = new Map();
    (config?.groupRules || []).forEach((rule) => {
      if (rule?.group) map.set(rule.group, Number(rule.percent || 0));
    });
    return map;
  };

  const getServiceRuleMap = () => {
    const config = getSelectedConfig();
    const map = new Map();
    (config?.serviceRules || []).forEach((rule) => {
      if (rule?.service) map.set(rule.service, Number(rule.percent || 0));
    });
    return map;
  };

  const collectDraftRules = (selector, keyName) =>
    Array.from(document.querySelectorAll(selector))
      .map((input) => {
        const ref = String(input.dataset[keyName] || '').trim();
        const rawValue = String(input.value || '').trim().replace(',', '.');
        if (!ref || rawValue === '') return null;
        const percent = Number(rawValue);
        if (!Number.isFinite(percent)) return null;
        return {
          [keyName === 'groupId' ? 'group' : 'service']: ref,
          percent: Number(percent.toFixed(2)),
        };
      })
      .filter(Boolean);

  const updateHeaderState = () => {
    const selected = getSelectedProfessional();
    const professionalType = getSelectedType();
    const selectedLabel = selected ? selected.nome : 'Nenhum profissional selecionado';

    elements.selectedBadge.innerHTML = `
      <i class="fas fa-user-check"></i>
      ${selectedLabel}
    `;

    elements.roleBadge.innerHTML = `
      <i class="fas fa-briefcase"></i>
      ${formatProfessionalType(professionalType)}
    `;

    const canEdit = Boolean(selected);
    elements.saveButton.disabled = !canEdit;
    elements.selectionPlaceholder.classList.toggle('hidden', canEdit);
    elements.editor.classList.toggle('hidden', !canEdit);

    if (canEdit) {
      elements.professionalName.textContent = selected.nome || '-';
      elements.professionalRole.textContent = formatProfessionalType(professionalType);
      elements.servicesCount.textContent = String(getEligibleServices().length);
    }
  };

  const renderProfessionals = () => {
    const term = normalizeText(state.professionalSearch);
    const filtered = state.professionals.filter((professional) => {
      if (!term) return true;
      const content = [
        professional.nome,
        professional.email,
        professional.cargoCarteira,
        ...(professional.professionalTypes || []),
      ].join(' ');
      return normalizeText(content).includes(term);
    });

    elements.list.innerHTML = '';
    elements.listCounter.textContent = `${filtered.length} profissional(is) elegível(is)`;
    elements.listEmpty.classList.toggle('hidden', filtered.length > 0);

    filtered.forEach((professional) => {
      const isActive = professional._id === state.selectedProfessionalId;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = [
        'w-full rounded-xl border px-4 py-3 text-left transition',
        isActive
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-gray-200 bg-white hover:border-primary/50 hover:bg-gray-50',
      ].join(' ');
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-gray-800">${professional.nome || 'Profissional sem nome'}</p>
            <p class="mt-1 text-xs text-gray-500">${professional.email || professional.cargoCarteira || 'Sem contato'}</p>
          </div>
          <div class="flex flex-wrap justify-end gap-1">
            ${(professional.professionalTypes || [])
              .map(
                (type) =>
                  `<span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">${formatProfessionalType(
                    type
                  )}</span>`
              )
              .join('')}
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        state.selectedProfessionalId = professional._id;
        state.selectedProfessionalType =
          state.configsByUser.get(professional._id)?.professionalType ||
          professional.professionalType ||
          professional.professionalTypes?.[0] ||
          '';
        state.dirty = false;
        renderProfessionals();
        renderEditor();
      });
      elements.list.appendChild(card);
    });
  };

  const renderGroups = () => {
    const groups = getEligibleGroups();
    const ruleMap = getGroupRuleMap();
    elements.groupsBody.innerHTML = '';

    if (!groups.length) {
      elements.groupsBody.innerHTML =
        '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-gray-500">Nenhum grupo de serviço compatível com este profissional.</td></tr>';
      return;
    }

    groups.forEach((group) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="px-4 py-3 font-medium text-gray-800">${group.nome}</td>
        <td class="px-4 py-3 text-gray-600">${(group.tiposPermitidos || []).map(formatProfessionalType).join(', ')}</td>
        <td class="px-4 py-3 text-right font-semibold text-gray-700">${formatPercent(group.comissaoPercent)}</td>
        <td class="px-4 py-3">
          <div class="flex justify-end">
            <div class="relative w-28">
              <input type="number" min="0" max="100" step="0.01" value="${ruleMap.has(group._id) ? ruleMap.get(group._id) : group.comissaoPercent}" data-group-id="${group._id}" class="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-right text-sm focus:border-primary focus:ring-2 focus:ring-primary/20">
              <span class="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">%</span>
            </div>
          </div>
        </td>
      `;
      row.querySelector('input[data-group-id]')?.addEventListener('input', () => {
        state.dirty = true;
      });
      elements.groupsBody.appendChild(row);
    });
  };

  const renderServices = () => {
    const services = getEligibleServices();
    const ruleMap = getServiceRuleMap();
    elements.servicesBody.innerHTML = '';

    if (!services.length) {
      elements.servicesBody.innerHTML =
        '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-gray-500">Nenhum serviço compatível com este profissional.</td></tr>';
      return;
    }

    services.forEach((service) => {
      const row = document.createElement('tr');
      const currentValue = ruleMap.has(service._id) ? ruleMap.get(service._id) : '';
      row.innerHTML = `
        <td class="px-4 py-3 font-medium text-gray-800">${service.nome}</td>
        <td class="px-4 py-3 text-gray-600">${service?.grupo?.nome || '-'}</td>
        <td class="px-4 py-3 text-right font-semibold text-gray-700">${formatPercent(service?.grupo?.comissaoPercent || 0)}</td>
        <td class="px-4 py-3">
          <div class="flex justify-end">
            <div class="relative w-28">
              <input type="number" min="0" max="100" step="0.01" value="${currentValue}" placeholder="${Number(service?.grupo?.comissaoPercent || 0).toFixed(2)}" data-service-id="${service._id}" class="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-right text-sm focus:border-primary focus:ring-2 focus:ring-primary/20">
              <span class="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">%</span>
            </div>
          </div>
        </td>
      `;
      row.querySelector('input[data-service-id]')?.addEventListener('input', () => {
        state.dirty = true;
      });
      elements.servicesBody.appendChild(row);
    });
  };

  const renderEditor = () => {
    updateHeaderState();
    if (!getSelectedProfessional()) return;
    renderGroups();
    renderServices();
  };

  const validateDraft = ({ groupRules, serviceRules }) => {
    const errors = [];
    [...groupRules, ...serviceRules].forEach((rule) => {
      const value = Number(rule.percent);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        errors.push('Todas as comissões devem estar entre 0 e 100%.');
      }
    });
    return errors;
  };

  const handleSave = async () => {
    const selected = getSelectedProfessional();
    if (!selected) {
      notifyUser('Selecione um profissional.', 'warning');
      return;
    }

    const payload = {
      professionalType: getSelectedType(),
      groupRules: collectDraftRules('input[data-group-id]', 'groupId'),
      serviceRules: collectDraftRules('input[data-service-id]', 'serviceId'),
    };

    const errors = validateDraft(payload);
    if (errors.length) {
      notifyUser(errors[0], 'warning');
      return;
    }

    try {
      elements.saveButton.disabled = true;
      const saved = await fetchJSON(`${API}/${selected._id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.configsByUser.set(selected._id, saved);
      state.dirty = false;
      renderEditor();
      notifyUser('Configuração de comissão salva com sucesso.', 'success');
    } catch (error) {
      console.error(error);
      notifyUser(error.message || 'Não foi possível salvar a configuração.', 'error');
    } finally {
      elements.saveButton.disabled = !getSelectedProfessional();
    }
  };

  const loadBootstrap = async () => {
    const payload = await fetchJSON(`${API}/bootstrap`);
    state.professionals = Array.isArray(payload.professionals) ? payload.professionals : [];
    state.groups = Array.isArray(payload.groups) ? payload.groups : [];
    state.services = Array.isArray(payload.services) ? payload.services : [];
    state.configsByUser = new Map(
      (Array.isArray(payload.configs) ? payload.configs : [])
        .filter((config) => config?.user)
        .map((config) => [config.user, config])
    );

    const firstProfessional = state.professionals[0] || null;
    if (firstProfessional) {
      state.selectedProfessionalId = firstProfessional._id;
      state.selectedProfessionalType =
        state.configsByUser.get(firstProfessional._id)?.professionalType ||
        firstProfessional.professionalType ||
        firstProfessional.professionalTypes?.[0] ||
        '';
    }

    renderProfessionals();
    renderEditor();
  };

  const initEvents = () => {
    elements.search?.addEventListener('input', (event) => {
      state.professionalSearch = event.target.value || '';
      renderProfessionals();
    });

    elements.serviceSearch?.addEventListener('input', (event) => {
      state.serviceSearch = event.target.value || '';
      renderServices();
      updateHeaderState();
    });

    elements.saveButton?.addEventListener('click', handleSave);
  };

  const init = async () => {
    if (!elements.list) return;
    initEvents();
    try {
      await loadBootstrap();
    } catch (error) {
      console.error(error);
      notifyUser(error.message || 'Não foi possível carregar a tela de comissão por profissional.', 'error');
      elements.listCounter.textContent = 'Erro ao carregar profissionais';
      elements.listEmpty.classList.remove('hidden');
    }
  };

  init();
})();
