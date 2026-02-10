(function () {
  'use strict';

  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';

  const elements = {
    codigo: document.getElementById('fiscal-serie-codigo'),
    descricao: document.getElementById('fiscal-serie-descricao'),
    modelo: document.getElementById('fiscal-serie-modelo'),
    serie: document.getElementById('fiscal-serie-numero'),
    ambiente: document.getElementById('fiscal-serie-ambiente'),
    empresa: document.getElementById('fiscal-serie-empresa'),
    ultimaNota: document.getElementById('fiscal-serie-ultima-nota'),
    paramAdd: document.getElementById('fiscal-serie-param-add'),
    formNew: document.getElementById('fiscal-serie-new'),
    save: document.getElementById('fiscal-serie-save'),
    paramDelete: document.getElementById('fiscal-serie-param-delete'),
    paramTable: document.getElementById('fiscal-serie-param-table'),
    paramEmpty: document.getElementById('fiscal-serie-param-empty'),
    seriesTable: document.getElementById('fiscal-serie-table'),
    seriesEmpty: document.getElementById('fiscal-serie-empty'),
  };

  const state = {
    stores: [],
    series: [],
    currentParams: [],
    selectedParamIndex: null,
    editingSeriesId: '',
  };

  const getToken = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Nao foi possivel obter o token do usuario logado.', error);
      return '';
    }
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const showMessage = (title, message, type = 'info') => {
    const content = [title, message].filter(Boolean).join(' - ');
    if (typeof window.showToast === 'function') {
      window.showToast(content, type);
      return;
    }
    if (type === 'error') {
      console.error(content);
    } else {
      console.log(content);
    }
  };

  const getStoreLabel = (store) =>
    store?.nome || store?.nomeFantasia || store?.razaoSocial || 'Empresa sem nome';

  const populateCompanies = () => {
    if (!elements.empresa) return;
    const current = elements.empresa.value;
    elements.empresa.innerHTML = '<option value="">Selecione uma empresa</option>';
    state.stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store._id;
      option.textContent = getStoreLabel(store);
      elements.empresa.appendChild(option);
    });
    if (current && state.stores.some((store) => String(store._id) === String(current))) {
      elements.empresa.value = current;
    }
  };

  const renderParamsTable = () => {
    if (!elements.paramTable) return;

    if (!state.currentParams.length) {
      elements.paramTable.innerHTML = '';
      if (elements.paramEmpty) {
        elements.paramEmpty.classList.remove('hidden');
        elements.paramTable.appendChild(elements.paramEmpty);
      }
      return;
    }

    const rows = state.currentParams.map((param, index) => {
      const isSelected = index === state.selectedParamIndex;
      const rowClasses = [
        'cursor-pointer',
        'transition',
        'hover:bg-gray-50',
        isSelected ? 'bg-blue-50' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `
        <tr class="${rowClasses}" data-index="${index}">
          <td class="px-4 py-3 text-gray-700">${escapeHtml(String(index + 1))}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(param.empresaCodigo || '-')}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(param.empresaNome || '-')}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(param.ultimaNotaEmitida || '-')}</td>
        </tr>
      `;
    });

    elements.paramTable.innerHTML = rows.join('');
    if (elements.paramEmpty) {
      elements.paramEmpty.classList.add('hidden');
    }
  };

  const renderSeriesTable = () => {
    if (!elements.seriesTable) return;

    if (!state.series.length) {
      elements.seriesTable.innerHTML = '';
      if (elements.seriesEmpty) {
        elements.seriesEmpty.classList.remove('hidden');
        elements.seriesTable.appendChild(elements.seriesEmpty);
      }
      return;
    }

    const rows = state.series.map((serie) => {
      const isSelected = state.editingSeriesId && String(serie._id) === String(state.editingSeriesId);
      const rowClasses = [
        'cursor-pointer',
        'transition',
        'hover:bg-gray-50',
        isSelected ? 'bg-blue-50' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `
        <tr class="${rowClasses}" data-id="${escapeHtml(serie._id || '')}">
          <td class="px-4 py-3 text-gray-700">${escapeHtml(serie.codigo || '-')}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(serie.descricao || '-')}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(serie.serie || '-')}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(serie.modelo || '-')}</td>
          <td class="px-4 py-3 text-gray-700">${escapeHtml(serie.ambiente || '-')}</td>
        </tr>
      `;
    });

    elements.seriesTable.innerHTML = rows.join('');
    if (elements.seriesEmpty) {
      elements.seriesEmpty.classList.add('hidden');
    }
  };

  const resetParamFields = () => {
    if (elements.empresa) elements.empresa.value = '';
    if (elements.ultimaNota) elements.ultimaNota.value = '';
    state.selectedParamIndex = null;
    renderParamsTable();
  };

  const resetSeriesForm = () => {
    state.editingSeriesId = '';
    state.currentParams = [];
    state.selectedParamIndex = null;
    if (elements.codigo) elements.codigo.value = '';
    if (elements.descricao) elements.descricao.value = '';
    if (elements.modelo) elements.modelo.value = '';
    if (elements.serie) elements.serie.value = '';
    if (elements.ambiente) elements.ambiente.value = '';
    resetParamFields();
    renderSeriesTable();
  };

  const handleParamAdd = () => {
    if (!elements.empresa) return;
    const empresaId = elements.empresa.value;
    if (!empresaId) {
      showMessage('Empresa obrigatoria', 'Selecione uma empresa para adicionar o parametro.');
      return;
    }
    const store = state.stores.find((item) => String(item._id) === String(empresaId));
    if (!store) {
      showMessage('Empresa nao autorizada', 'Voce nao tem permissao para usar esta empresa.');
      return;
    }

    const ultimaNota = String(elements.ultimaNota?.value || '').trim();
    const existingIndex = state.currentParams.findIndex(
      (item) => String(item.empresaId) === String(empresaId)
    );

    const payload = {
      empresaId,
      empresaCodigo: store.codigo || '',
      empresaNome: getStoreLabel(store),
      ultimaNotaEmitida: ultimaNota,
    };

    if (existingIndex >= 0) {
      state.currentParams[existingIndex] = payload;
      state.selectedParamIndex = existingIndex;
    } else {
      state.currentParams.push(payload);
      state.selectedParamIndex = state.currentParams.length - 1;
    }

    renderParamsTable();
  };

  const handleParamDelete = () => {
    if (state.selectedParamIndex === null || state.selectedParamIndex === undefined) {
      showMessage('Selecione um parametro', 'Escolha um parametro da tabela para excluir.');
      return;
    }
    state.currentParams.splice(state.selectedParamIndex, 1);
    state.selectedParamIndex = null;
    resetParamFields();
  };

  const buildSeriesPayload = () => {
    return {
      codigo: String(elements.codigo?.value || '').trim(),
      descricao: String(elements.descricao?.value || '').trim(),
      modelo: String(elements.modelo?.value || '').trim(),
      serie: String(elements.serie?.value || '').trim(),
      ambiente: String(elements.ambiente?.value || '').trim(),
      parametros: state.currentParams.map((param) => ({
        empresa: param.empresaId,
        ultimaNotaEmitida: String(param.ultimaNotaEmitida || '').trim(),
      })),
    };
  };

  const validateSeriesPayload = (payload) => {
    if (!payload.descricao) {
      showMessage('Descricao obrigatoria', 'Informe a descricao da serie fiscal.');
      return false;
    }
    if (!payload.modelo) {
      showMessage('Modelo obrigatorio', 'Selecione o modelo da NF.');
      return false;
    }
    if (!payload.serie) {
      showMessage('Serie obrigatoria', 'Informe a serie da NF.');
      return false;
    }
    if (!payload.ambiente) {
      showMessage('Ambiente obrigatorio', 'Selecione o ambiente fiscal.');
      return false;
    }
    return true;
  };

  const handleSeriesSave = async () => {
    const token = getToken();
    if (!token) {
      showMessage('Sessao expirada', 'Faca login novamente para salvar as series fiscais.');
      return;
    }

    const payload = buildSeriesPayload();
    if (!validateSeriesPayload(payload)) return;

    if (!payload.codigo) {
      delete payload.codigo;
    }

    try {
      const endpoint = state.editingSeriesId
        ? `${API_BASE}/fiscal/series/${state.editingSeriesId}`
        : `${API_BASE}/fiscal/series`;
      const response = await fetch(endpoint, {
        method: state.editingSeriesId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Nao foi possivel salvar a serie fiscal.');
      }

      const saved = await response.json();
      await fetchSeries();
      applySerieToForm(saved);
      showMessage('Sucesso', 'Serie fiscal gravada com sucesso.', 'success');
    } catch (error) {
      console.error('Erro ao salvar serie fiscal:', error);
      showMessage('Erro ao salvar', error.message || 'Nao foi possivel salvar a serie fiscal.');
    }
  };

  const handleSeriesRowClick = (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    const { id } = row.dataset;
    const serie = state.series.find((item) => String(item._id) === String(id));
    if (!serie) return;
    applySerieToForm(serie);
  };

  const handleParamRowClick = (event) => {
    const row = event.target.closest('tr[data-index]');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;
    const param = state.currentParams[index];
    if (!param) return;

    state.selectedParamIndex = index;
    if (elements.empresa) elements.empresa.value = param.empresaId || '';
    if (elements.ultimaNota) elements.ultimaNota.value = param.ultimaNotaEmitida || '';
    renderParamsTable();
  };

  const fetchStores = async () => {
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/stores/allowed`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as empresas.');
      }
      const payload = await response.json();
      const list = Array.isArray(payload?.stores) ? payload.stores : [];
      state.stores = Array.isArray(list) ? list : [];
      populateCompanies();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      showMessage('Erro ao carregar empresas', error.message || 'Nao foi possivel carregar as empresas.');
    }
  };

  const applySerieToForm = (serie) => {
    state.editingSeriesId = String(serie?._id || '');
    if (elements.codigo) elements.codigo.value = serie.codigo || '';
    if (elements.descricao) elements.descricao.value = serie.descricao || '';
    if (elements.modelo) elements.modelo.value = serie.modelo || '';
    if (elements.serie) elements.serie.value = serie.serie || '';
    if (elements.ambiente) elements.ambiente.value = serie.ambiente || '';

    const parametros = Array.isArray(serie.parametros) ? serie.parametros : [];
    state.currentParams = parametros.map((param) => {
      const empresa = param?.empresa || {};
      const empresaId =
        typeof empresa === 'object' && empresa
          ? empresa._id || empresa.id || empresa
          : param.empresa;
      return {
        empresaId: String(empresaId || ''),
        empresaCodigo: empresa?.codigo || '',
        empresaNome: getStoreLabel(empresa),
        ultimaNotaEmitida: String(param?.ultimaNotaEmitida || '').trim(),
      };
    });
    state.selectedParamIndex = null;
    resetParamFields();
    renderParamsTable();
    renderSeriesTable();
  };

  const handleCodigoBlur = async () => {
    if (!elements.codigo) return;
    const codigo = String(elements.codigo.value || '').trim();
    if (!codigo) {
      return;
    }

    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/fiscal/series/by-code/${encodeURIComponent(codigo)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        if (response.status === 404) {
          resetSeriesForm();
          showMessage('Codigo nao encontrado', 'Nao existe nenhuma regra cadastrada com esse codigo.');
          return;
        }
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Nao foi possivel verificar o codigo informado.');
      }

      const serie = await response.json();
      applySerieToForm(serie);
    } catch (error) {
      console.error('Erro ao validar codigo:', error);
      showMessage('Erro ao validar codigo', error.message || 'Nao foi possivel validar o codigo informado.');
    }
  };

  const fetchSeries = async () => {
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/fiscal/series`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as series fiscais.');
      }
      const payload = await response.json();
      const list = Array.isArray(payload?.series) ? payload.series : (Array.isArray(payload) ? payload : []);
      state.series = Array.isArray(list) ? list : [];
      renderSeriesTable();
    } catch (error) {
      console.error('Erro ao carregar series fiscais:', error);
      showMessage('Erro ao carregar series', error.message || 'Nao foi possivel carregar as series fiscais.');
    }
  };

  const bindEvents = () => {
    elements.paramAdd?.addEventListener('click', handleParamAdd);
    elements.paramDelete?.addEventListener('click', handleParamDelete);
    elements.save?.addEventListener('click', handleSeriesSave);
    elements.formNew?.addEventListener('click', resetSeriesForm);
    elements.paramTable?.addEventListener('click', handleParamRowClick);
    elements.seriesTable?.addEventListener('click', handleSeriesRowClick);
    elements.codigo?.addEventListener('blur', handleCodigoBlur);
  };

  const initialize = async () => {
    bindEvents();
    await Promise.all([fetchStores(), fetchSeries()]);
    renderParamsTable();
  };

  document.addEventListener('DOMContentLoaded', initialize);
})();
