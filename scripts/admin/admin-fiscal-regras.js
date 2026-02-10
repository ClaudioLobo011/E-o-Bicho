(function () {
  'use strict';

  const storeSelect = document.getElementById('fiscal-rule-store');
  const refreshButton = document.getElementById('fiscal-rule-refresh');
  const newButton = document.getElementById('fiscal-rule-new');
  const storeHint = document.getElementById('fiscal-rule-store-hint');

  const form = document.getElementById('fiscal-rule-form');
  const codeInput = document.getElementById('fiscal-rule-code');
  const nameInput = document.getElementById('fiscal-rule-name');
  const saveButton = document.getElementById('fiscal-rule-save');
  const cancelButton = document.getElementById('fiscal-rule-cancel');

  const listContainer = document.getElementById('fiscal-rule-list');
  const emptyState = document.getElementById('fiscal-rule-empty');
  const countLabel = document.getElementById('fiscal-rule-count');

  const origemSelect = document.getElementById('fiscal-rule-origem');
  const statusNfeSelect = document.getElementById('fiscal-rule-status-nfe');
  const statusNfceSelect = document.getElementById('fiscal-rule-status-nfce');
  const pisTipoSelect = document.getElementById('fiscal-rule-pis-tipo');
  const cofinsTipoSelect = document.getElementById('fiscal-rule-cofins-tipo');
  const ipiTipoSelect = document.getElementById('fiscal-rule-ipi-tipo');
  const fcpIndicadorSelect = document.getElementById('fiscal-rule-fcp-indicador');

  let stores = [];
  let rules = [];
  let currentStoreId = '';
  let editingCode = null;
  let nextCode = 1;
  let isLoading = false;

  const origemOptions = [
    { value: '0', label: '0 - Nacional' },
    { value: '1', label: '1 - Estrangeira - Importacao direta' },
    { value: '2', label: '2 - Estrangeira - Adquirida no mercado interno' },
    { value: '3', label: '3 - Nacional com +40% de importado' },
    { value: '4', label: '4 - Nacional conforme processo basico' },
    { value: '5', label: '5 - Nacional com ate 40% importado' },
    { value: '6', label: '6 - Estrangeira sem similar - Importacao' },
    { value: '7', label: '7 - Estrangeira sem similar - Mercado interno' },
    { value: '8', label: '8 - Nacional com conteudo importado > 70%' },
  ];

  const tipoCalculoOptions = [
    { value: 'percentual', label: 'Percentual' },
    { value: 'valor', label: 'Valor' },
    { value: 'isento', label: 'Isento' },
  ];

  const statusOptions = [
    { value: 'pendente', label: 'Pendente' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'aprovado', label: 'Aprovado' },
  ];

  const fcpIndicadores = [
    { value: '0', label: '0 - Nao aplicavel' },
    { value: '1', label: '1 - FCP interno' },
    { value: '2', label: '2 - FCP interestadual' },
  ];

  const getToken = () => {
    try {
      const logged = JSON.parse(localStorage.getItem('loggedInUser'));
      return logged?.token || '';
    } catch (error) {
      console.warn('Nao foi possivel obter o token do usuario logado.', error);
      return '';
    }
  };

  const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const populateSelect = (select, options) => {
    if (!select) return;
    select.innerHTML = options
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join('');
  };

  const setStoreHintState = () => {
    if (!storeHint) return;
    storeHint.classList.toggle('hidden', Boolean(currentStoreId));
  };

  const setSaveState = () => {
    if (saveButton) {
      saveButton.innerHTML = editingCode
        ? '<i class="fas fa-save"></i> Atualizar regra'
        : '<i class="fas fa-save"></i> Salvar regra';
    }
    if (cancelButton) {
      cancelButton.classList.toggle('hidden', !editingCode);
    }
  };

  const setLoadingState = (loading) => {
    isLoading = loading;
    if (refreshButton) refreshButton.disabled = loading;
    if (newButton) newButton.disabled = loading;
    if (saveButton) saveButton.disabled = loading;
  };

  const updateCountLabel = () => {
    if (!countLabel) return;
    if (!currentStoreId) {
      countLabel.textContent = 'Selecione uma empresa';
      return;
    }
    if (!rules.length) {
      countLabel.textContent = 'Nenhuma regra cadastrada';
      return;
    }
    countLabel.textContent = `${rules.length} regra${rules.length > 1 ? 's' : ''}`;
  };

  const updateEmptyState = () => {
    if (!emptyState) return;
    if (!currentStoreId) {
      emptyState.textContent = 'Selecione uma empresa para carregar as regras.';
      emptyState.classList.remove('hidden');
      return;
    }
    if (!rules.length) {
      emptyState.textContent = 'Nenhuma regra cadastrada para esta empresa.';
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');
  };

  const fillFormFields = (fiscal = {}) => {
    if (!form) return;

    const setValue = (selector, value) => {
      const input = form.querySelector(`[data-field="${selector}"]`);
      if (!input) return;
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = value === undefined || value === null ? '' : value;
      }
    };

    setValue('origem', fiscal.origem || '0');
    setValue('csosn', fiscal.csosn || '');
    setValue('cst', fiscal.cst || '');
    setValue('cest', fiscal.cest || '');
    setValue('status.nfe', fiscal?.status?.nfe || 'pendente');
    setValue('status.nfce', fiscal?.status?.nfce || 'pendente');

    setValue('cfop.nfe.dentro', fiscal?.cfop?.nfe?.dentroEstado || '');
    setValue('cfop.nfe.fora', fiscal?.cfop?.nfe?.foraEstado || '');
    setValue('cfop.nfe.transferencia', fiscal?.cfop?.nfe?.transferencia || '');
    setValue('cfop.nfe.devolucao', fiscal?.cfop?.nfe?.devolucao || '');
    setValue('cfop.nfe.industrializacao', fiscal?.cfop?.nfe?.industrializacao || '');

    setValue('cfop.nfce.dentro', fiscal?.cfop?.nfce?.dentroEstado || '');
    setValue('cfop.nfce.fora', fiscal?.cfop?.nfce?.foraEstado || '');
    setValue('cfop.nfce.transferencia', fiscal?.cfop?.nfce?.transferencia || '');
    setValue('cfop.nfce.devolucao', fiscal?.cfop?.nfce?.devolucao || '');
    setValue('cfop.nfce.industrializacao', fiscal?.cfop?.nfce?.industrializacao || '');

    setValue('pis.codigo', fiscal?.pis?.codigo || '');
    setValue('pis.cst', fiscal?.pis?.cst || '');
    setValue('pis.aliquota', fiscal?.pis?.aliquota ?? '');
    setValue('pis.tipo', fiscal?.pis?.tipoCalculo || 'percentual');

    setValue('cofins.codigo', fiscal?.cofins?.codigo || '');
    setValue('cofins.cst', fiscal?.cofins?.cst || '');
    setValue('cofins.aliquota', fiscal?.cofins?.aliquota ?? '');
    setValue('cofins.tipo', fiscal?.cofins?.tipoCalculo || 'percentual');

    setValue('ipi.cst', fiscal?.ipi?.cst || '');
    setValue('ipi.enquadramento', fiscal?.ipi?.codigoEnquadramento || '');
    setValue('ipi.aliquota', fiscal?.ipi?.aliquota ?? '');
    setValue('ipi.tipo', fiscal?.ipi?.tipoCalculo || 'percentual');

    setValue('fcp.indicador', fiscal?.fcp?.indicador || '0');
    setValue('fcp.aliquota', fiscal?.fcp?.aliquota ?? '');
    setValue('fcp.aplica', fiscal?.fcp?.aplica || false);
  };

  const collectFiscalFromForm = () => {
    const getValue = (selector) => {
      const input = form?.querySelector(`[data-field="${selector}"]`);
      if (!input) return '';
      if (input.type === 'checkbox') return input.checked;
      return input.value?.trim() || '';
    };

    const getNumber = (selector) => {
      const input = form?.querySelector(`[data-field="${selector}"]`);
      if (!input) return null;
      const value = input.value;
      if (value === '' || value === undefined || value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      origem: getValue('origem') || '0',
      csosn: getValue('csosn'),
      cst: getValue('cst'),
      cest: getValue('cest'),
      status: {
        nfe: getValue('status.nfe') || 'pendente',
        nfce: getValue('status.nfce') || 'pendente',
      },
      cfop: {
        nfe: {
          dentroEstado: getValue('cfop.nfe.dentro'),
          foraEstado: getValue('cfop.nfe.fora'),
          transferencia: getValue('cfop.nfe.transferencia'),
          devolucao: getValue('cfop.nfe.devolucao'),
          industrializacao: getValue('cfop.nfe.industrializacao'),
        },
        nfce: {
          dentroEstado: getValue('cfop.nfce.dentro'),
          foraEstado: getValue('cfop.nfce.fora'),
          transferencia: getValue('cfop.nfce.transferencia'),
          devolucao: getValue('cfop.nfce.devolucao'),
          industrializacao: getValue('cfop.nfce.industrializacao'),
        },
      },
      pis: {
        codigo: getValue('pis.codigo'),
        cst: getValue('pis.cst'),
        aliquota: getNumber('pis.aliquota'),
        tipoCalculo: getValue('pis.tipo') || 'percentual',
      },
      cofins: {
        codigo: getValue('cofins.codigo'),
        cst: getValue('cofins.cst'),
        aliquota: getNumber('cofins.aliquota'),
        tipoCalculo: getValue('cofins.tipo') || 'percentual',
      },
      ipi: {
        cst: getValue('ipi.cst'),
        codigoEnquadramento: getValue('ipi.enquadramento'),
        aliquota: getNumber('ipi.aliquota'),
        tipoCalculo: getValue('ipi.tipo') || 'percentual',
      },
      fcp: {
        indicador: getValue('fcp.indicador') || '0',
        aliquota: getNumber('fcp.aliquota'),
        aplica: Boolean(form?.querySelector('[data-field="fcp.aplica"]')?.checked),
      },
    };
  };

  const resetForm = () => {
    editingCode = null;
    if (nameInput) nameInput.value = '';
    if (codeInput) codeInput.value = currentStoreId ? String(nextCode) : '';
    fillFormFields({});
    setSaveState();
  };

  const setFormForEdit = (rule) => {
    if (!rule) return;
    editingCode = Number(rule.code) || null;
    if (codeInput) codeInput.value = rule.code ? String(rule.code) : '';
    if (nameInput) nameInput.value = rule.name || '';
    fillFormFields(rule.fiscal || {});
    setSaveState();
  };

  const renderRules = () => {
    if (!listContainer) return;
    listContainer.innerHTML = '';

    updateCountLabel();
    updateEmptyState();

    if (!rules.length) return;

    rules.forEach((rule) => {
      const card = document.createElement('article');
      card.className = 'rounded-lg border border-gray-200 bg-white p-4 shadow-sm';

      const ruleName = escapeHtml(rule?.name || '');
      const codeLabel = rule?.code ? String(rule.code) : '-';
      const fiscal = rule?.fiscal || {};
      const cfopNfe = fiscal?.cfop?.nfe || {};
      const cfopNfce = fiscal?.cfop?.nfce || {};

      const chips = [
        `Origem: ${fiscal?.origem || '-'}`,
        `CSOSN: ${fiscal?.csosn || '-'}`,
        `CST: ${fiscal?.cst || '-'}`,
        `CFOP NF-e: ${cfopNfe.dentroEstado || '-'} / ${cfopNfe.foraEstado || '-'}`,
        `CFOP NFC-e: ${cfopNfce.dentroEstado || '-'} / ${cfopNfce.foraEstado || '-'}`,
      ];

      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-gray-800">Codigo ${codeLabel}</p>
            <p class="text-sm text-gray-600">${ruleName}</p>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" data-action="edit" data-code="${codeLabel}" class="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50">
              <i class="fas fa-pen"></i>
              Editar
            </button>
            <button type="button" data-action="delete" data-code="${codeLabel}" class="inline-flex items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50">
              <i class="fas fa-trash"></i>
              Excluir
            </button>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
          ${chips.map((chip) => `<span class="rounded-full bg-gray-100 px-2 py-1">${escapeHtml(chip)}</span>`).join('')}
        </div>
      `;

      listContainer.appendChild(card);
    });
  };

  const populateStores = () => {
    if (!storeSelect) return;
    const selected = storeSelect.value;
    storeSelect.innerHTML = '<option value="">Selecione uma empresa</option>';

    if (!Array.isArray(stores) || !stores.length) {
      storeSelect.disabled = true;
      currentStoreId = '';
      return;
    }

    stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store._id;
      option.textContent = store.nome || store.nomeFantasia || store.razaoSocial || 'Empresa sem nome';
      storeSelect.appendChild(option);
    });

    storeSelect.disabled = false;
    if (selected) {
      storeSelect.value = selected;
    }
    currentStoreId = storeSelect.value || '';
  };

  const fetchStores = async () => {
    try {
      const token = getToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/stores/allowed`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Nao foi possivel carregar as empresas.');
      const payload = await response.json();
      const list = Array.isArray(payload?.stores) ? payload.stores : (Array.isArray(payload) ? payload : []);
      stores = Array.isArray(list) ? list : [];
      populateStores();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      showModal({
        title: 'Erro',
        message: error.message || 'Nao foi possivel carregar as empresas cadastradas.',
        confirmText: 'Entendi',
      });
    }
  };

  const loadRules = async () => {
    if (!currentStoreId) {
      rules = [];
      nextCode = 1;
      renderRules();
      resetForm();
      setStoreHintState();
      return;
    }

    setLoadingState(true);
    try {
      const token = getToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/default-rules?storeId=${encodeURIComponent(currentStoreId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Nao foi possivel carregar as regras fiscais padrao.');
      const payload = await response.json();
      rules = Array.isArray(payload?.rules) ? payload.rules : [];
      nextCode = Number(payload?.nextCode) || (rules.length ? Math.max(...rules.map((rule) => Number(rule?.code) || 0)) + 1 : 1);
    } catch (error) {
      console.error('Erro ao carregar regras fiscais padrao:', error);
      showModal({
        title: 'Erro ao carregar',
        message: error.message || 'Nao foi possivel carregar as regras fiscais padrao.',
        confirmText: 'Tentar novamente',
      });
      rules = [];
      nextCode = 1;
    } finally {
      setLoadingState(false);
      renderRules();
      resetForm();
      setStoreHintState();
    }
  };

  const saveRule = async () => {
    if (!currentStoreId) {
      showModal({
        title: 'Selecione uma empresa',
        message: 'Escolha uma empresa para cadastrar regras fiscais padrao.',
        confirmText: 'Entendi',
      });
      return;
    }

    const selectedStoreId = currentStoreId;
    const trimmedName = nameInput?.value?.trim() || '';
    if (!trimmedName) {
      showModal({
        title: 'Nome obrigatorio',
        message: 'Informe o nome da regra antes de salvar.',
        confirmText: 'Entendi',
      });
      return;
    }

    const fiscalPayload = collectFiscalFromForm();
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    setLoadingState(true);

    try {
      const url = editingCode
        ? `${API_CONFIG.BASE_URL}/fiscal/default-rules/${editingCode}`
        : `${API_CONFIG.BASE_URL}/fiscal/default-rules`;
      const method = editingCode ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({
          storeId: currentStoreId,
          name: trimmedName,
          fiscal: fiscalPayload,
        }),
      });

      if (!response.ok) throw new Error('Nao foi possivel salvar a regra fiscal padrao.');
      await response.json();

      showModal({
        title: 'Regra salva',
        message: editingCode ? 'Regra atualizada com sucesso.' : 'Regra cadastrada com sucesso.',
        confirmText: 'Continuar',
      });

      editingCode = null;
      await loadRules();
      if (selectedStoreId) {
        currentStoreId = selectedStoreId;
        if (storeSelect) {
          storeSelect.value = selectedStoreId;
        }
        setStoreHintState();
      }
    } catch (error) {
      console.error('Erro ao salvar regra fiscal padrao:', error);
      showModal({
        title: 'Erro ao salvar',
        message: error.message || 'Nao foi possivel salvar a regra fiscal padrao.',
        confirmText: 'Tentar novamente',
      });
    } finally {
      setLoadingState(false);
    }
  };

  const deleteRule = async (code) => {
    if (!currentStoreId) return;
    const token = getToken();

    const proceed = async () => {
      setLoadingState(true);
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/default-rules/${code}?storeId=${encodeURIComponent(currentStoreId)}`, {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('Nao foi possivel remover a regra fiscal padrao.');
        await response.json();
        await loadRules();
      } catch (error) {
        console.error('Erro ao remover regra fiscal padrao:', error);
        showModal({
          title: 'Erro ao remover',
          message: error.message || 'Nao foi possivel remover a regra fiscal padrao.',
          confirmText: 'Entendi',
        });
      } finally {
        setLoadingState(false);
      }
    };

    showModal({
      title: 'Remover regra',
      message: `Confirma remover a regra ${code}?`,
      confirmText: 'Remover',
      cancelText: 'Cancelar',
      onConfirm: proceed,
    });
  };

  const initEvents = () => {
    storeSelect?.addEventListener('change', () => {
      currentStoreId = storeSelect.value || '';
      loadRules();
    });

    refreshButton?.addEventListener('click', () => loadRules());
    newButton?.addEventListener('click', () => resetForm());

    cancelButton?.addEventListener('click', () => resetForm());

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isLoading) return;
      saveRule();
    });

    listContainer?.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.action;
      const code = Number.parseInt(actionButton.dataset.code, 10);
      if (!Number.isFinite(code)) return;

      if (action === 'edit') {
        const rule = rules.find((item) => Number(item?.code) === code);
        setFormForEdit(rule);
      }

      if (action === 'delete') {
        deleteRule(code);
      }
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    populateSelect(origemSelect, origemOptions);
    populateSelect(statusNfeSelect, statusOptions);
    populateSelect(statusNfceSelect, statusOptions);
    populateSelect(pisTipoSelect, tipoCalculoOptions);
    populateSelect(cofinsTipoSelect, tipoCalculoOptions);
    populateSelect(ipiTipoSelect, tipoCalculoOptions);
    populateSelect(fcpIndicadorSelect, fcpIndicadores);

    setStoreHintState();
    setSaveState();
    initEvents();
    fetchStores();
  });
})();
