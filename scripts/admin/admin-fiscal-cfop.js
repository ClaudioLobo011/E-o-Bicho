(() => {
  'use strict';

  const API_BASE =
    typeof API_CONFIG !== 'undefined' && API_CONFIG?.BASE_URL
      ? API_CONFIG.BASE_URL
      : '/api';

  const elements = {
    typeSelect: document.getElementById('cfop-config-type'),
    tableBody: document.getElementById('cfop-config-table'),
    emptyRow: document.getElementById('cfop-config-empty'),
    countLabel: document.getElementById('cfop-config-count'),
    resultsCounter: document.getElementById('cfop-results-counter'),
    importInput: document.getElementById('cfop-import-input'),
    importButton: document.getElementById('cfop-import-button'),
    importLabel: document.getElementById('cfop-import-label'),
    importStatus: document.getElementById('cfop-import-status'),
    saveButton: document.getElementById('cfop-save-button'),
    pageSizeSelect: document.getElementById('cfop-page-size'),
    pagePrev: document.getElementById('cfop-page-prev'),
    pageNext: document.getElementById('cfop-page-next'),
    pageIndicator: document.getElementById('cfop-page-indicator'),
  };

  const state = {
    entries: [],
    loading: false,
    importing: false,
    saving: false,
    pagination: {
      page: 1,
      limit: 25,
      total: 0,
      pages: 1,
    },
    tableFilters: {
      ativo: '',
      cfop: '',
      grupoCfop: '',
      descricao: '',
      bonificacao: '',
      tipoMovimentacao: '',
      precoUtilizar: '',
    },
    tableSort: { key: '', direction: 'asc' },
    tableSelections: {
      ativo: new Set(),
      cfop: new Set(),
      grupoCfop: new Set(),
      descricao: new Set(),
      bonificacao: new Set(),
      tipoMovimentacao: new Set(),
      precoUtilizar: new Set(),
    },
    pendingChanges: new Map(),
  };

  const MOVEMENT_OPTIONS = [
    { value: 'normal', label: 'Normal' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'devolucao', label: 'Devolucao' },
    { value: 'compra', label: 'Compra' },
    { value: 'perda', label: 'Perda roubo ou deterioracao' },
    { value: 'transformacao-cupom', label: 'Transformacao de cupom' },
  ];

  const PRICE_OPTIONS = [
    { value: 'venda', label: 'Venda' },
    { value: 'custo', label: 'Custo' },
    { value: 'medio', label: 'Medio' },
  ];

  const normalizeString = (value) => String(value || '').trim();

  const normalizeText = (value) =>
    normalizeString(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildColumnFilterRegex = (rawValue) => {
    const normalizedFilter = normalizeText(rawValue || '');
    if (!normalizedFilter) return null;
    const pattern = normalizedFilter
      .split('*')
      .map((segment) => escapeRegex(segment))
      .join('.*');
    if (!pattern) return null;
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      console.warn('Filtro invalido ignorado na tabela de CFOP.', error);
      return null;
    }
  };

  const getFilterCandidates = (entry, key) => {
    switch (key) {
      case 'ativo':
        return [entry?.ativo ? 'Sim' : 'Nao'];
      case 'bonificacao':
        return [entry?.bonificacao ? 'Sim' : 'Nao'];
      case 'cfop':
        return [entry?.cfop || ''];
      case 'descricao':
        return [entry?.descricao || ''];
      case 'grupoCfop':
        return [entry?.grupoCfop || ''];
      case 'tipoMovimentacao': {
        const value = normalizeString(entry?.tipoMovimentacao) || '';
        const label = MOVEMENT_OPTIONS.find((item) => item.value === value)?.label || value;
        return [value, label];
      }
      case 'precoUtilizar': {
        const value = normalizeString(entry?.precoUtilizar) || '';
        const label = PRICE_OPTIONS.find((item) => item.value === value)?.label || value;
        return [value, label];
      }
      default:
        return [entry?.[key] || ''];
    }
  };

  const matchesColumnFilter = (entry, key, filterValue) => {
    const regex = buildColumnFilterRegex(filterValue);
    if (!regex) return true;
    const candidates = getFilterCandidates(entry, key);
    return candidates.some((candidate) => regex.test(normalizeText(candidate)));
  };

  const matchesSelectionFilter = (entry, key) => {
    const selection = state.tableSelections?.[key];
    if (!selection || selection.size === 0) return true;
    const normalizedSelection = new Set(
      Array.from(selection).map((value) => normalizeText(value)),
    );
    const candidates = getFilterCandidates(entry, key);
    return candidates.some((candidate) => normalizedSelection.has(normalizeText(candidate)));
  };

  const applyColumnFilters = (entries) => {
    const list = Array.isArray(entries) ? entries : [];
    const filters = state.tableFilters || {};
    const activeFilters = Object.entries(filters).filter(([, value]) => typeof value === 'string' && value.trim() !== '');
    const selectionKeys = Object.keys(state.tableSelections || {}).filter((key) => {
      const selection = state.tableSelections?.[key];
      return selection && selection.size > 0;
    });
    if (!activeFilters.length && !selectionKeys.length) return list.slice();
    return list.filter((entry) =>
      activeFilters.every(([key, value]) => matchesColumnFilter(entry, key, value)) &&
      selectionKeys.every((key) => matchesSelectionFilter(entry, key)),
    );
  };

  const getSortValue = (entry, key) => {
    switch (key) {
      case 'ativo':
        return entry?.ativo ? 1 : 0;
      case 'bonificacao':
        return entry?.bonificacao ? 1 : 0;
      case 'cfop':
        return normalizeString(entry?.cfop) || '';
      case 'descricao':
        return normalizeString(entry?.descricao) || '';
      case 'grupoCfop':
        return normalizeString(entry?.grupoCfop) || '';
      case 'tipoMovimentacao':
        return normalizeString(entry?.tipoMovimentacao) || '';
      case 'precoUtilizar':
        return normalizeString(entry?.precoUtilizar) || '';
      default:
        return entry?.[key];
    }
  };

  const applyColumnSort = (entries) => {
    const list = Array.isArray(entries) ? entries.slice() : [];
    const { key: sortKey, direction: sortDirectionRaw } = state.tableSort || {};
    if (!sortKey) return list;
    const direction = sortDirectionRaw === 'desc' ? 'desc' : 'asc';
    const multiplier = direction === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const valueA = getSortValue(a, sortKey);
      const valueB = getSortValue(b, sortKey);

      const numericA = typeof valueA === 'number' ? valueA : Number.NaN;
      const numericB = typeof valueB === 'number' ? valueB : Number.NaN;
      const isNumericA = Number.isFinite(numericA);
      const isNumericB = Number.isFinite(numericB);

      if (isNumericA || isNumericB) {
        const safeA = isNumericA ? numericA : Number.NEGATIVE_INFINITY;
        const safeB = isNumericB ? numericB : Number.NEGATIVE_INFINITY;
        if (safeA === safeB) return 0;
        return safeA > safeB ? multiplier : -multiplier;
      }

      const textA = normalizeText(valueA);
      const textB = normalizeText(valueB);
      const comparison = textA.localeCompare(textB, 'pt-BR', { sensitivity: 'base', numeric: true });
      return comparison * multiplier;
    });
  };

  const getVisibleEntries = () => {
    const filtered = applyColumnFilters(state.entries);
    return applyColumnSort(filtered);
  };

  const getFilteredEntries = () => applyColumnFilters(state.entries);

  const notify = (message, type = 'info') => {
    if (typeof showToast === 'function') {
      showToast(message, type);
      return;
    }
    if (typeof showModal === 'function') {
      showModal({
        title: type === 'error' ? 'Erro' : 'Aviso',
        message,
        confirmText: 'Ok',
      });
      return;
    }
    alert(message);
  };

  const getToken = () => {
    try {
      const logged = JSON.parse(localStorage.getItem('loggedInUser'));
      return logged?.token || '';
    } catch (error) {
      console.warn('Nao foi possivel obter o token do usuario logado.', error);
      return '';
    }
  };

  const setImporting = (importing) => {
    state.importing = !!importing;
    if (elements.importButton) {
      elements.importButton.disabled = state.importing;
      elements.importButton.classList.toggle('opacity-60', state.importing);
      elements.importButton.classList.toggle('cursor-not-allowed', state.importing);
    }
    if (elements.importLabel) {
      elements.importLabel.textContent = state.importing ? 'Importando...' : 'Importar Excel';
    }
  };

  const setImportStatus = (message, type = 'info') => {
    if (!elements.importStatus) return;
    elements.importStatus.textContent = message || '';
    elements.importStatus.classList.remove('text-gray-500', 'text-emerald-600', 'text-red-600');
    if (type === 'success') {
      elements.importStatus.classList.add('text-emerald-600');
      return;
    }
    if (type === 'error') {
      elements.importStatus.classList.add('text-red-600');
      return;
    }
    elements.importStatus.classList.add('text-gray-500');
  };

  const setSaving = (saving) => {
    state.saving = !!saving;
    if (!elements.saveButton) return;
    elements.saveButton.disabled = state.saving;
    elements.saveButton.classList.toggle('opacity-60', state.saving);
    elements.saveButton.classList.toggle('cursor-not-allowed', state.saving);
  };

  const updateCountLabel = () => {
    if (!elements.countLabel) return;
    const total = state.pagination.total;
    elements.countLabel.textContent = total
      ? `${total} CFOP${total === 1 ? '' : 's'} cadastrado${total === 1 ? '' : 's'}`
      : 'Nenhum CFOP cadastrado';
  };

  const updateResultsCounter = () => {
    if (!elements.resultsCounter) return;
    const total = state.pagination.total;
    elements.resultsCounter.innerHTML = `<i class="fas fa-magnifying-glass"></i>${
      total ? `${total} CFOP${total === 1 ? '' : 's'} encontrado${total === 1 ? '' : 's'}` : 'Nenhum CFOP encontrado'
    }`;
  };

  const updatePaginationControls = () => {
    if (elements.pageSizeSelect) {
      elements.pageSizeSelect.value = String(state.pagination.limit);
    }
    if (elements.pageIndicator) {
      elements.pageIndicator.textContent = `Pagina ${state.pagination.page} de ${state.pagination.pages}`;
    }
    if (elements.pagePrev) {
      elements.pagePrev.disabled = state.pagination.page <= 1;
      elements.pagePrev.classList.toggle('opacity-60', state.pagination.page <= 1);
      elements.pagePrev.classList.toggle('cursor-not-allowed', state.pagination.page <= 1);
    }
    if (elements.pageNext) {
      elements.pageNext.disabled = state.pagination.page >= state.pagination.pages;
      elements.pageNext.classList.toggle('opacity-60', state.pagination.page >= state.pagination.pages);
      elements.pageNext.classList.toggle('cursor-not-allowed', state.pagination.page >= state.pagination.pages);
    }
  };

  const applyPagination = (entries) => {
    const total = entries.length;
    const pages = Math.max(Math.ceil(total / state.pagination.limit) || 1, 1);
    const safePage = Math.min(Math.max(state.pagination.page, 1), pages);
    state.pagination.total = total;
    state.pagination.pages = pages;
    state.pagination.page = safePage;

    const startIndex = (safePage - 1) * state.pagination.limit;
    return entries.slice(startIndex, startIndex + state.pagination.limit);
  };

  const buildOptionHtml = (options, selectedValue) =>
    options
      .map((option) => {
        const selected = option.value === selectedValue ? 'selected' : '';
        return `<option value="${option.value}" ${selected}>${option.label}</option>`;
      })
      .join('');

  const renderEntries = () => {
    if (!elements.tableBody) return;

    const visible = getVisibleEntries();
    const paginated = applyPagination(visible);

    if (!paginated.length) {
      elements.tableBody.innerHTML = '';
      if (elements.emptyRow) {
        elements.emptyRow.classList.remove('hidden');
        elements.tableBody.appendChild(elements.emptyRow);
      }
      updateCountLabel();
      updateResultsCounter();
      updatePaginationControls();
      updateSelectAllState();
      return;
    }

    elements.tableBody.innerHTML = paginated
      .map((entry) => {
        const ativo = !!entry?.ativo;
        const bonificacao = !!entry?.bonificacao;
        const tipoMovimentacao = normalizeString(entry?.tipoMovimentacao) || 'normal';
        const precoUtilizar = normalizeString(entry?.precoUtilizar) || 'venda';
        const codigo = normalizeString(entry?.cfop) || '---';
        const grupo = normalizeString(entry?.grupoCfop) || '---';
        const descricao = normalizeString(entry?.descricao) || 'Sem descricao';

        return `
          <tr data-id="${entry?._id || ''}">
            <td class="px-4 py-3">
              <input type="checkbox" data-field="ativo" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" ${
                ativo ? 'checked' : ''
              }>
            </td>
            <td class="px-4 py-3 text-gray-700 font-semibold">${codigo}</td>
            <td class="px-4 py-3 text-gray-700">${grupo}</td>
            <td class="px-4 py-3 text-gray-700">${descricao}</td>
            <td class="px-4 py-3">
              <input type="checkbox" data-field="bonificacao" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" ${
                bonificacao ? 'checked' : ''
              }>
            </td>
            <td class="px-4 py-3">
              <select data-field="tipoMovimentacao" class="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-primary focus:ring-primary">
                ${buildOptionHtml(MOVEMENT_OPTIONS, tipoMovimentacao)}
              </select>
            </td>
            <td class="px-4 py-3">
              <select data-field="precoUtilizar" class="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-primary focus:ring-primary">
                ${buildOptionHtml(PRICE_OPTIONS, precoUtilizar)}
              </select>
            </td>
          </tr>
        `;
      })
      .join('');

    if (elements.emptyRow) {
      elements.emptyRow.classList.add('hidden');
    }
    updateCountLabel();
    updateResultsCounter();
    updatePaginationControls();
    updateSelectAllState();
  };

  const matchesCfopTipo = (entry, tipo) => {
    const code = normalizeString(entry?.cfop);
    if (!code) return false;
    const prefix = code.charAt(0);
    if (tipo === 'entrada') return ['1', '2', '3'].includes(prefix);
    if (tipo === 'saida') return ['5', '6', '7'].includes(prefix);
    return true;
  };

  const fetchEntries = async () => {
    if (state.loading) return;
    state.loading = true;

    const tipo = normalizeString(elements.typeSelect?.value || '');
    const query = '';

    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/fiscal/cfop${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar os CFOPs.');
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      state.entries = tipo ? items.filter((entry) => matchesCfopTipo(entry, tipo)) : items;
      state.pagination.page = 1;
      state.pagination.total = 0;
      updateTableSortButtons();
      renderEntries();
    } catch (error) {
      console.error('Erro ao carregar CFOPs:', error);
      state.entries = [];
      renderEntries();
      notify(error?.message || 'Nao foi possivel carregar os CFOPs.', 'error');
    } finally {
      state.loading = false;
    }
  };

  const setRowDisabled = (row, disabled) => {
    if (!row) return;
    row.querySelectorAll('input, select').forEach((input) => {
      input.disabled = !!disabled;
    });
    row.classList.toggle('opacity-60', !!disabled);
  };

  const queueChange = (entryId, field, value) => {
    if (!entryId || !field) return;
    const pending = state.pendingChanges.get(entryId) || {};
    pending[field] = value;
    state.pendingChanges.set(entryId, pending);
  };

  const markRowDirty = (row, dirty) => {
    if (!row) return;
    row.classList.toggle('bg-amber-50', !!dirty);
  };

  const handleTableChange = async (event) => {
    const target = event.target;
    const row = target?.closest('tr[data-id]');
    if (!row || !target?.dataset?.field) return;

    const entryId = row.dataset.id;
    const field = target.dataset.field;
    const entry = state.entries.find((item) => item?._id === entryId);
    if (!entry) return;

    let value;
    if (target.type === 'checkbox') {
      value = target.checked;
    } else {
      value = normalizeString(target.value);
    }

    const previousValue = entry?.[field];
    if (previousValue === value) return;

    entry[field] = value;
    queueChange(entryId, field, value);
    markRowDirty(row, true);
    updateSelectAllState();
  };

  const savePendingChanges = async () => {
    if (!state.pendingChanges.size) {
      notify('Nenhuma alteracao pendente para gravar.', 'info');
      return;
    }

    const token = getToken();
    if (!token) {
      notify('Sessao expirada. Faca login novamente.', 'error');
      return;
    }

    setSaving(true);
    try {
      const items = Array.from(state.pendingChanges.entries()).map(([id, changes]) => ({
        id,
        changes,
      }));

      const response = await fetch(`${API_BASE}/fiscal/cfop/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Nao foi possivel gravar as alteracoes.');
      }

      state.pendingChanges.clear();
      document.querySelectorAll('#cfop-config-table tr[data-id]').forEach((row) => {
        markRowDirty(row, false);
      });
      notify(payload?.message || 'Alteracoes gravadas com sucesso.', 'success');
    } catch (error) {
      console.error('Erro ao gravar alteracoes:', error);
      notify(error?.message || 'Nao foi possivel gravar as alteracoes.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const buildImportSummary = (summary = {}) => {
    const total = Number(summary.totalRows) || 0;
    const imported = Number(summary.imported) || 0;
    const updated = Number(summary.updated) || 0;
    const skipped = Number(summary.skippedInvalid) || 0;

    const parts = [];
    if (total) {
      parts.push(`${imported} de ${total} importado${imported === 1 ? '' : 's'}`);
    } else if (imported) {
      parts.push(`${imported} importado${imported === 1 ? '' : 's'}`);
    }
    if (updated) {
      parts.push(`${updated} atualizado${updated === 1 ? '' : 's'}`);
    }
    if (skipped) {
      parts.push(`${skipped} linha${skipped === 1 ? '' : 's'} ignorada${skipped === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
  };

  const importCfops = async (file) => {
    if (!file || state.importing) return;

    const token = getToken();
    if (!token) {
      notify('Sessao expirada. Faca login novamente.', 'error');
      return;
    }

    setImporting(true);
    setImportStatus('Importando planilha de CFOP...', 'info');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/fiscal/cfop/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const payloadText = await response.text();
      let payload = null;
      if (payloadText) {
        try {
          payload = JSON.parse(payloadText);
        } catch (parseError) {
          console.error('Nao foi possivel interpretar a resposta de importacao.', parseError);
        }
      }

      if (!response.ok) {
        throw new Error(payload?.message || `Falha ao importar planilha (${response.status}).`);
      }

      const summaryMessage = buildImportSummary(payload?.summary || {});
      setImportStatus(summaryMessage || 'Importacao concluida.', 'success');
      notify(summaryMessage ? `Importacao concluida: ${summaryMessage}.` : 'Importacao concluida.', 'success');
      await fetchEntries();
    } catch (error) {
      console.error('Erro ao importar CFOPs:', error);
      setImportStatus(error?.message || 'Nao foi possivel importar a planilha.', 'error');
      notify(error?.message || 'Nao foi possivel importar a planilha.', 'error');
    } finally {
      setImporting(false);
      if (elements.importInput) {
        elements.importInput.value = '';
      }
    }
  };

  const handleImportChange = (event) => {
    const file = event?.target?.files?.[0];
    if (file) {
      importCfops(file);
    }
  };

  const handleImportClick = () => {
    if (state.importing || !elements.importInput) return;
    elements.importInput.click();
  };

  const tableFilterInputs = new Map();
  const tableSortButtons = new Map();
  const tableSortHeaders = new Map();
  const tableFilterTriggers = new Map();
  const tableSelectAllControls = new Map();
  let activeFilterDropdown = null;
  let activeFilterKey = null;

  const setTableFilter = (key, value) => {
    if (!key) return;
    const current = state.tableFilters[key] || '';
    const nextValue = typeof value === 'string' ? value : '';
    if (current === nextValue) return;
    state.tableFilters[key] = nextValue;
    state.pagination.page = 1;
    renderEntries();
  };

  const setTableSort = (key, direction) => {
    if (!key) return;
    const nextDirection = direction === 'desc' ? 'desc' : 'asc';
    const { key: currentKey, direction: currentDirection } = state.tableSort || {};
    if (currentKey === key && currentDirection === nextDirection) {
      state.tableSort = { key: '', direction: 'asc' };
    } else {
      state.tableSort = { key, direction: nextDirection };
    }
    state.pagination.page = 1;
    updateTableSortButtons();
    renderEntries();
  };

  const updateTableSortButtons = () => {
    const { key: activeKey, direction: activeDirectionRaw } = state.tableSort || {};
    const activeDirection = activeDirectionRaw === 'desc' ? 'desc' : 'asc';

    tableSortHeaders.forEach((header, headerKey) => {
      if (!header) return;
      if (activeKey && headerKey === activeKey) {
        header.setAttribute('aria-sort', activeDirection === 'desc' ? 'descending' : 'ascending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });

    tableSortButtons.forEach((meta, button) => {
      if (!button) return;
      const isActive = Boolean(activeKey) && meta.key === activeKey && meta.direction === activeDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/60', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const updateSelectAllState = () => {
    const visibleEntries = getFilteredEntries();
    tableSelectAllControls.forEach((control, key) => {
      if (!control) return;
      if (!visibleEntries.length) {
        control.checked = false;
        control.indeterminate = false;
        control.disabled = true;
        return;
      }
      control.disabled = false;
      const allChecked = visibleEntries.every((entry) => !!entry?.[key]);
      const noneChecked = visibleEntries.every((entry) => !entry?.[key]);
      control.checked = allChecked;
      control.indeterminate = !allChecked && !noneChecked;
    });
  };

  const getUniqueFilterValues = (key) => {
    const values = new Set();
    state.entries.forEach((entry) => {
      const candidates = getFilterCandidates(entry, key);
      candidates.forEach((candidate) => {
        const value = normalizeString(candidate);
        if (value) values.add(value);
      });
    });
    return Array.from(values).sort((a, b) =>
      normalizeText(a).localeCompare(normalizeText(b), 'pt-BR', { sensitivity: 'base', numeric: true }),
    );
  };

  const closeFilterDropdown = () => {
    if (activeFilterDropdown) {
      activeFilterDropdown.remove();
      activeFilterDropdown = null;
      activeFilterKey = null;
    }
  };

  const updateFilterTriggerState = (key) => {
    const trigger = tableFilterTriggers.get(key);
    if (!trigger) return;
    const hasSelection = state.tableSelections?.[key]?.size;
    trigger.classList.toggle('text-primary', !!hasSelection);
  };

  const applySelectionFilter = (key, values, totalOptions = 0) => {
    const selection = state.tableSelections?.[key];
    if (!selection) return;
    selection.clear();
    if (values.length && totalOptions && values.length >= totalOptions) {
      updateFilterTriggerState(key);
      state.pagination.page = 1;
      renderEntries();
      return;
    }
    values.forEach((value) => selection.add(value));
    state.pagination.page = 1;
    updateFilterTriggerState(key);
    renderEntries();
  };

  const buildFilterDropdown = (key, anchor) => {
    const existingSelection = state.tableSelections?.[key] || new Set();
    const options = getUniqueFilterValues(key);
    const hasStoredSelection = existingSelection.size > 0;

    const dropdown = document.createElement('div');
    dropdown.className =
      'absolute z-50 mt-1 w-60 rounded-lg border border-gray-200 bg-white shadow-xl p-2 text-xs text-gray-600';
    dropdown.innerHTML = `
      <div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-gray-500 uppercase">
        <span>Opcoes</span>
        <button type="button" class="text-gray-400 hover:text-primary" data-action="close" aria-label="Fechar">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="max-h-40 overflow-y-auto px-2 py-1 space-y-1" data-options></div>
      <div class="flex items-center justify-between gap-2 px-2 pt-2">
        <button type="button" class="text-[11px] text-gray-500 hover:text-primary" data-action="select-all">Selecionar tudo</button>
        <button type="button" class="text-[11px] text-gray-500 hover:text-primary" data-action="clear">Limpar</button>
        <button type="button" class="ml-auto rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90" data-action="apply">Aplicar</button>
      </div>
    `;

    const optionsWrapper = dropdown.querySelector('[data-options]');
    options.forEach((value) => {
      const id = `cfop-filter-${key}-${normalizeText(value).replace(/[^a-z0-9]+/g, '-')}`;
      const checked = hasStoredSelection ? existingSelection.has(value) : true;
      const optionRow = document.createElement('label');
      optionRow.className = 'flex items-center gap-2 text-[11px] text-gray-600';
      optionRow.innerHTML = `
        <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary/20" value="${value.replace(/"/g, '&quot;')}" ${
          checked ? 'checked' : ''
        }>
        <span class="truncate">${value}</span>
      `;
      optionRow.htmlFor = id;
      optionsWrapper.appendChild(optionRow);
    });

    dropdown.addEventListener('click', (event) => {
      event.stopPropagation();
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'close') {
        closeFilterDropdown();
        return;
      }
      if (action === 'select-all') {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = true;
        });
        return;
      }
      if (action === 'clear') {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = false;
        });
        return;
      }
      if (action === 'apply') {
        const values = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked')).map((input) =>
          normalizeString(input.value),
        );
        applySelectionFilter(key, values, options.length);
        closeFilterDropdown();
      }
    });

    anchor.appendChild(dropdown);
    return dropdown;
  };

  const handleFilterTriggerClick = (event, key) => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget.closest('.relative');
    if (!anchor) return;
    if (activeFilterKey === key) {
      closeFilterDropdown();
      return;
    }
    closeFilterDropdown();
    activeFilterKey = key;
    activeFilterDropdown = buildFilterDropdown(key, anchor);
  };

  const setupTableControls = () => {
    document.querySelectorAll('[data-cfop-filter]').forEach((input) => {
      const key = input.dataset.cfopFilter;
      if (!key) return;
      tableFilterInputs.set(key, input);
      const currentValue = state.tableFilters[key] || '';
      if (input.value !== currentValue) {
        input.value = currentValue;
      }
      input.addEventListener('input', (event) => {
        setTableFilter(key, event.target.value || '');
      });
    });

    document.querySelectorAll('[data-cfop-sort]').forEach((button) => {
      const key = button.dataset.cfopSort;
      if (!key) return;
      const direction = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
      tableSortButtons.set(button, { key, direction });
      const header = button.closest('[data-cfop-sort-header]');
      if (header && !tableSortHeaders.has(key)) {
        tableSortHeaders.set(key, header);
      }
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setTableSort(key, direction);
      });
    });

    updateTableSortButtons();

    document.querySelectorAll('[data-cfop-filter-trigger]').forEach((button) => {
      const key = button.dataset.cfopFilterTrigger;
      if (!key) return;
      tableFilterTriggers.set(key, button);
      updateFilterTriggerState(key);
      button.addEventListener('click', (event) => handleFilterTriggerClick(event, key));
    });

    document.querySelectorAll('[data-cfop-select-all]').forEach((input) => {
      const key = input.dataset.cfopSelectAll;
      if (!key) return;
      tableSelectAllControls.set(key, input);
      input.addEventListener('change', (event) => {
        const target = event.target;
        const checked = !!target.checked;
        const visibleEntries = getFilteredEntries();
        if (!visibleEntries.length) {
          updateSelectAllState();
          return;
        }

        visibleEntries.forEach((entry) => {
          if (!entry || entry?.[key] === checked) return;
          entry[key] = checked;
          queueChange(entry._id, key, checked);
        });
        renderEntries();
      });
    });

    updateSelectAllState();
  };

  const init = () => {
    elements.typeSelect?.addEventListener('change', fetchEntries);
    elements.tableBody?.addEventListener('change', handleTableChange);
    elements.importButton?.addEventListener('click', handleImportClick);
    elements.importInput?.addEventListener('change', handleImportChange);
    elements.saveButton?.addEventListener('click', savePendingChanges);
    elements.pageSizeSelect?.addEventListener('change', (event) => {
      const value = parseInt(event.target.value, 10);
      if (!Number.isFinite(value) || value <= 0) {
        event.target.value = String(state.pagination.limit);
        return;
      }
      if (state.pagination.limit === value) return;
      state.pagination.limit = value;
      state.pagination.page = 1;
      renderEntries();
    });
    elements.pagePrev?.addEventListener('click', () => {
      if (state.pagination.page <= 1) return;
      state.pagination.page -= 1;
      renderEntries();
    });
    elements.pageNext?.addEventListener('click', () => {
      if (state.pagination.page >= state.pagination.pages) return;
      state.pagination.page += 1;
      renderEntries();
    });
    document.addEventListener('click', closeFilterDropdown);
    setupTableControls();
    fetchEntries();
  };

  init();
})();
