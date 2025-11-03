(function () {
  const STATUS_CONFIG = {
    solicitada: {
      label: 'Solicitada',
      classes: 'inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700',
      icon: 'fa-truck-loading',
    },
    em_separacao: {
      label: 'Em separação',
      classes: 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700',
      icon: 'fa-hourglass-half',
    },
    aprovada: {
      label: 'Aprovada',
      classes: 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700',
      icon: 'fa-circle-check',
    },
  };

  const state = {
    filters: {
      originDeposit: '',
      destinationDeposit: '',
      status: '',
      startDate: '',
      endDate: '',
    },
    deposits: [],
    transfers: [],
    summary: {
      totalTransfers: 0,
      totalVolume: 0,
      pendingNfe: 0,
      period: { start: null, end: null },
    },
    loading: false,
    lastValidDates: { startDate: '', endDate: '' },
    detailsCache: new Map(),
  };

  const elements = {
    originSelect: document.getElementById('filter-origin'),
    destinationSelect: document.getElementById('filter-destination'),
    statusSelect: document.getElementById('filter-status'),
    dateStartInput: document.getElementById('filter-date-start'),
    dateEndInput: document.getElementById('filter-date-end'),
    tableBody: document.getElementById('transfers-table-body'),
    summaryPeriodLabel: document.getElementById('summary-period-label'),
    summaryTotalTransfers: document.getElementById('summary-total-transfers'),
    summaryTotalVolume: document.getElementById('summary-total-volume'),
    summaryPendingNfe: document.getElementById('summary-pending-nfe'),
    exportButton: document.querySelector('button i.fa-file-export')?.parentElement,
    approveSelectedButton: document.querySelector('button i.fa-check-circle')?.parentElement,
  };

  if (!elements.tableBody) {
    return;
  }

  function getToken() {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.token || null;
    } catch (error) {
      console.warn('Não foi possível ler o token salvo.', error);
      return null;
    }
  }

  function buildAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function fetchWithAuth(url, options = {}) {
    const config = {
      ...options,
      headers: {
        ...buildAuthHeaders(options.headers),
      },
    };

    const response = await fetch(url, config);
    if (response.status === 401) {
      alert('Sua sessão expirou. Faça login novamente.');
      window.location.replace('/pages/login.html');
      return null;
    }
    return response;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTransferNumber(number) {
    const numeric = Number(number);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return '—';
    }
    return `TRF-${String(numeric).padStart(6, '0')}`;
  }

  function formatDateForInput(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateDisplay(value) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR').format(date);
  }

  function formatLongDate(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  function formatNumber(value, options = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
      ...options,
    }).format(number);
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number);
  }

  function renderStatusBadge(status) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.solicitada;
    const iconHtml = config.icon ? `<i class="fas ${config.icon}"></i>` : '';
    return `<span class="${config.classes}">${iconHtml}${escapeHtml(config.label)}</span>`;
  }

  function clearSelectOptions(select) {
    if (!select) return;
    Array.from(select.querySelectorAll('option'))
      .filter((option) => option.value && option.value !== '')
      .forEach((option) => option.remove());
  }

  function populateDepositOptions(select) {
    if (!select) return;
    const currentValue = select.value;
    clearSelectOptions(select);
    const fragment = document.createDocumentFragment();
    state.deposits.forEach((deposit) => {
      const option = document.createElement('option');
      option.value = deposit.id;
      option.textContent = deposit.companyName
        ? `${deposit.name} • ${deposit.companyName}`
        : deposit.name;
      fragment.appendChild(option);
    });
    select.appendChild(fragment);
    if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
      select.value = currentValue;
    } else {
      select.value = '';
    }
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    if (!elements.tableBody) return;
    if (isLoading) {
      elements.tableBody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-gray-500">Carregando transferências...</td></tr>';
    }
  }

  function renderEmptyState(message = 'Nenhuma transferência encontrada para os filtros selecionados.') {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-sm text-gray-500">${escapeHtml(message)}</td></tr>`;
  }

  function renderTransfers() {
    if (!elements.tableBody) return;
    if (!Array.isArray(state.transfers) || state.transfers.length === 0) {
      renderEmptyState();
      return;
    }

    const rows = state.transfers.map((transfer) => {
      const numberLabel = formatTransferNumber(transfer.number);
      const originName = transfer.originDeposit?.name || '—';
      const originCompany = transfer.originCompany?.name || '';
      const destinationName = transfer.destinationDeposit?.name || '—';
      const destinationCompany = transfer.destinationCompany?.name || '';
      const requestDate = formatDateDisplay(transfer.requestDate);
      const volume = formatNumber(transfer.totalVolume);
      const cfop = transfer.cfop ? escapeHtml(transfer.cfop) : '—';
      const canApprove = transfer.status !== 'aprovada';

      return `<tr>
        <td class="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">${escapeHtml(numberLabel)}</td>
        <td class="px-4 py-3 text-gray-600">
          <div class="flex flex-col">
            <span class="font-medium">${escapeHtml(originName)}</span>
            <span class="text-xs text-gray-500">${escapeHtml(originCompany)}</span>
          </div>
        </td>
        <td class="px-4 py-3 text-gray-600">
          <div class="flex flex-col">
            <span class="font-medium">${escapeHtml(destinationName)}</span>
            <span class="text-xs text-gray-500">${escapeHtml(destinationCompany)}</span>
          </div>
        </td>
        <td class="px-4 py-3 text-gray-600 whitespace-nowrap">${escapeHtml(requestDate)}</td>
        <td class="px-4 py-3 text-gray-600 whitespace-nowrap">${cfop}</td>
        <td class="px-4 py-3 text-gray-600 text-right">${escapeHtml(volume)}</td>
        <td class="px-4 py-3">${renderStatusBadge(transfer.status)}</td>
        <td class="px-4 py-3 text-right">
          <div class="flex flex-wrap justify-end gap-2">
            <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="details" data-transfer-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-eye"></i>
              Detalhes
            </button>
            <button type="button" class="inline-flex items-center gap-1 rounded-lg border ${canApprove ? 'border-primary text-primary hover:bg-primary/10' : 'border-gray-200 text-gray-400 cursor-not-allowed'} px-3 py-1.5 text-xs font-semibold transition" data-action="approve" data-transfer-id="${escapeHtml(transfer.id)}" ${canApprove ? '' : 'disabled'}>
              <i class="fas fa-check"></i>
              Aprovar
            </button>
            <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="generate-nfe" data-transfer-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-file-invoice"></i>
              Gerar NF-e
            </button>
            <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="generate-xml" data-transfer-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-file-code"></i>
              Gerar XML
            </button>
            <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="generate-pdf" data-transfer-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-file-pdf"></i>
              Gerar PDF
            </button>
          </div>
        </td>
      </tr>`;
    });

    elements.tableBody.innerHTML = rows.join('');
  }

  function renderSummary() {
    const { summary } = state;
    if (elements.summaryTotalTransfers) {
      elements.summaryTotalTransfers.textContent = formatNumber(summary.totalTransfers, {
        maximumFractionDigits: 0,
      });
    }
    if (elements.summaryTotalVolume) {
      elements.summaryTotalVolume.textContent = formatNumber(summary.totalVolume);
    }
    if (elements.summaryPendingNfe) {
      elements.summaryPendingNfe.textContent = formatNumber(summary.pendingNfe, {
        maximumFractionDigits: 0,
      });
    }

    if (elements.summaryPeriodLabel) {
      const { start, end } = summary.period || {};
      if (start && end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
          if (startDate.toDateString() === endDate.toDateString()) {
            elements.summaryPeriodLabel.textContent = formatLongDate(startDate);
          } else {
            elements.summaryPeriodLabel.textContent = `De ${formatLongDate(startDate)} até ${formatLongDate(endDate)}`;
          }
          return;
        }
      }
      if (start) {
        elements.summaryPeriodLabel.textContent = `A partir de ${formatLongDate(start)}`;
        return;
      }
      if (end) {
        elements.summaryPeriodLabel.textContent = `Até ${formatLongDate(end)}`;
        return;
      }
      elements.summaryPeriodLabel.textContent = 'Todos os períodos';
    }
  }

  async function loadFilters() {
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/transfers/filters`);
      if (!response) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Não foi possível carregar os filtros.');
      }
      const data = await response.json();
      state.deposits = Array.isArray(data?.deposits) ? data.deposits : [];
      populateDepositOptions(elements.originSelect);
      populateDepositOptions(elements.destinationSelect);
    } catch (error) {
      console.error('Erro ao carregar filtros de transferências:', error);
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Não foi possível carregar os filtros de transferências.', 'error', 4000);
      }
    }
  }

  function buildQueryParams() {
    const params = new URLSearchParams();
    const { filters } = state;
    if (filters.originDeposit) {
      params.append('originDeposit', filters.originDeposit);
    }
    if (filters.destinationDeposit) {
      params.append('destinationDeposit', filters.destinationDeposit);
    }
    if (filters.status) {
      params.append('status', filters.status);
    }
    if (filters.startDate) {
      params.append('startDate', filters.startDate);
    }
    if (filters.endDate) {
      params.append('endDate', filters.endDate);
    }
    return params.toString();
  }

  async function fetchTransfers() {
    setLoading(true);
    try {
      const query = buildQueryParams();
      const url = query
        ? `${API_CONFIG.BASE_URL}/transfers?${query}`
        : `${API_CONFIG.BASE_URL}/transfers`;
      const response = await fetchWithAuth(url);
      if (!response) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Não foi possível carregar as transferências.');
      }
      const data = await response.json();
      state.transfers = Array.isArray(data?.transfers) ? data.transfers : [];
      state.summary = {
        totalTransfers: Number(data?.summary?.totalTransfers) || state.transfers.length,
        totalVolume: Number(data?.summary?.totalVolume) || 0,
        pendingNfe: Number(data?.summary?.pendingNfe) || 0,
        period: data?.summary?.period || { start: null, end: null },
      };
      renderTransfers();
      renderSummary();
    } catch (error) {
      console.error('Erro ao buscar transferências:', error);
      renderEmptyState(error.message || 'Não foi possível carregar as transferências.');
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Não foi possível carregar as transferências.', 'error', 4000);
      }
    } finally {
      state.loading = false;
    }
  }

  function updateFilter(key, value) {
    state.filters[key] = value;
    fetchTransfers();
  }

  function handleDateChange(key, input) {
    const value = input?.value || '';
    const otherKey = key === 'startDate' ? 'endDate' : 'startDate';
    const otherValue = state.filters[otherKey];

    if (value && otherValue) {
      const start = key === 'startDate' ? value : otherValue;
      const end = key === 'startDate' ? otherValue : value;
      if (start > end) {
        if (typeof window.showToast === 'function') {
          window.showToast('A data inicial não pode ser maior que a data final.', 'warning', 3500);
        }
        input.value = state.lastValidDates[key] || '';
        return;
      }
    }

    state.filters[key] = value;
    state.lastValidDates[key] = value;
    fetchTransfers();
  }

  async function getTransferDetails(id) {
    if (!id) return null;
    if (state.detailsCache.has(id)) {
      return state.detailsCache.get(id);
    }
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/transfers/${id}`);
      if (!response) return null;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Não foi possível carregar os detalhes da transferência.');
      }
      const data = await response.json();
      if (data?.transfer) {
        state.detailsCache.set(id, data.transfer);
        return data.transfer;
      }
      throw new Error('Transferência não encontrada.');
    } catch (error) {
      console.error('Erro ao carregar detalhes da transferência:', error);
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Não foi possível carregar os detalhes da transferência.', 'error', 4000);
      }
      return null;
    }
  }

  function buildDetailsContent(transfer) {
    const container = document.createElement('div');
    container.className = 'space-y-4 text-left';

    const infoGrid = document.createElement('div');
    infoGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';

    const infoEntries = [
      { label: 'Número', value: formatTransferNumber(transfer.number) },
      { label: 'Status', value: STATUS_CONFIG[transfer.status]?.label || transfer.statusLabel || '—' },
      { label: 'Data da solicitação', value: formatLongDate(transfer.requestDate) || '—' },
      {
        label: 'Origem',
        value: `${transfer.originDeposit?.name || '—'}${transfer.originCompany?.name ? ` • ${transfer.originCompany.name}` : ''}`,
      },
      {
        label: 'Destino',
        value: `${transfer.destinationDeposit?.name || '—'}${transfer.destinationCompany?.name ? ` • ${transfer.destinationCompany.name}` : ''}`,
      },
      {
        label: 'Responsável',
        value: transfer.responsible?.name || transfer.responsible?.email || '—',
      },
      { label: 'Documento de referência', value: transfer.referenceDocument || '—' },
      { label: 'Observações', value: transfer.observations || '—' },
      {
        label: 'Transporte',
        value: [transfer.transport?.mode, transfer.transport?.vehicle, transfer.transport?.driver]
          .filter((item) => item)
          .join(' • ') || '—',
      },
    ];

    infoEntries.forEach((entry) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${escapeHtml(entry.label)}</p>
        <p class="text-sm text-gray-700">${escapeHtml(entry.value)}</p>`;
      infoGrid.appendChild(wrapper);
    });

    container.appendChild(infoGrid);

    const totalsRow = document.createElement('div');
    totalsRow.className = 'grid grid-cols-1 md:grid-cols-3 gap-4';
    const totalEntries = [
      { label: 'Total de itens', value: formatNumber(transfer.items?.length || 0, { maximumFractionDigits: 0 }) },
      { label: 'Volume total', value: formatNumber(transfer.totals?.totalVolume || 0) },
      { label: 'Custo total (estimado)', value: formatCurrency(transfer.totals?.totalCost || 0) },
    ];
    totalEntries.forEach((entry) => {
      const box = document.createElement('div');
      box.className = 'rounded-lg border border-gray-200 bg-gray-50 p-3';
      box.innerHTML = `<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${escapeHtml(entry.label)}</p>
        <p class="text-base font-semibold text-gray-800">${escapeHtml(entry.value)}</p>`;
      totalsRow.appendChild(box);
    });
    container.appendChild(totalsRow);

    const itemsWrapper = document.createElement('div');
    itemsWrapper.innerHTML = '<h3 class="text-sm font-semibold text-gray-700 mb-2">Itens da transferência</h3>';

    if (Array.isArray(transfer.items) && transfer.items.length > 0) {
      const table = document.createElement('table');
      table.className = 'min-w-full divide-y divide-gray-200 text-xs';
      table.innerHTML = `
        <thead class="bg-gray-50">
          <tr>
            <th class="px-3 py-2 text-left font-semibold text-gray-600">Produto</th>
            <th class="px-3 py-2 text-left font-semibold text-gray-600">SKU</th>
            <th class="px-3 py-2 text-left font-semibold text-gray-600">Quantidade</th>
            <th class="px-3 py-2 text-left font-semibold text-gray-600">Lote</th>
            <th class="px-3 py-2 text-left font-semibold text-gray-600">Validade</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100"></tbody>
      `;

      const tbody = table.querySelector('tbody');
      transfer.items.forEach((item) => {
        const row = document.createElement('tr');
        const validity = item.validity ? formatDateDisplay(item.validity) : '—';
        row.innerHTML = `
          <td class="px-3 py-2 text-gray-700">${escapeHtml(item.productName || item.description || '—')}</td>
          <td class="px-3 py-2 text-gray-500 whitespace-nowrap">${escapeHtml(item.sku || '—')}</td>
          <td class="px-3 py-2 text-gray-700 whitespace-nowrap">${escapeHtml(formatNumber(item.quantity || 0))} ${escapeHtml(item.unit || '')}</td>
          <td class="px-3 py-2 text-gray-500">${escapeHtml(item.lot || '—')}</td>
          <td class="px-3 py-2 text-gray-500">${escapeHtml(validity)}</td>
        `;
        tbody.appendChild(row);
      });

      const scrollWrapper = document.createElement('div');
      scrollWrapper.className = 'max-h-72 overflow-y-auto border border-gray-200 rounded-lg';
      scrollWrapper.appendChild(table);
      itemsWrapper.appendChild(scrollWrapper);
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-gray-500';
      empty.textContent = 'Nenhum item registrado para esta transferência.';
      itemsWrapper.appendChild(empty);
    }

    container.appendChild(itemsWrapper);

    return container;
  }

  async function openTransferDetails(id) {
    const transfer = await getTransferDetails(id);
    if (!transfer) return;
    const content = buildDetailsContent(transfer);
    if (typeof window.showModal === 'function') {
      window.showModal({
        title: `Detalhes da ${formatTransferNumber(transfer.number)}`,
        message: content,
        confirmText: 'Fechar',
      });
    } else {
      alert(`Transferência ${formatTransferNumber(transfer.number)}\nStatus: ${transfer.statusLabel}`);
    }
  }

  async function updateTransferStatus(id, status) {
    try {
      const response = await fetchWithAuth(`${API_CONFIG.BASE_URL}/transfers/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      if (!response) return false;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Não foi possível atualizar o status da transferência.');
      }
      state.detailsCache.delete(id);
      if (typeof window.showToast === 'function') {
        window.showToast('Transferência aprovada com sucesso.', 'success', 3500);
      }
      await fetchTransfers();
      return true;
    } catch (error) {
      console.error('Erro ao atualizar status da transferência:', error);
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Não foi possível atualizar o status.', 'error', 4000);
      }
      return false;
    }
  }

  function confirmApproveTransfer(id) {
    const transfer = state.transfers.find((item) => item.id === id);
    const transferLabel = transfer ? formatTransferNumber(transfer.number) : 'a transferência selecionada';
    if (typeof window.showModal === 'function') {
      window.showModal({
        title: 'Aprovar transferência',
        message: `Confirma a aprovação da ${escapeHtml(transferLabel)}?`,
        confirmText: 'Aprovar',
        cancelText: 'Cancelar',
        onConfirm: () => updateTransferStatus(id, 'aprovada'),
      });
    } else if (window.confirm(`Confirma a aprovação da ${transferLabel}?`)) {
      updateTransferStatus(id, 'aprovada');
    }
  }

  async function generateTransferPdf(id) {
    const transfer = await getTransferDetails(id);
    if (!transfer) return;

    const popup = window.open('', '_blank');
    if (!popup) {
      if (typeof window.showToast === 'function') {
        window.showToast('Permita pop-ups para gerar o PDF.', 'warning', 4000);
      }
      return;
    }

    const dateLabel = formatDateDisplay(transfer.requestDate);
    const rows = Array.isArray(transfer.items)
      ? transfer.items
          .map((item, index) => `
            <tr>
              <td style="padding: 6px; border: 1px solid #e5e7eb;">${index + 1}</td>
              <td style="padding: 6px; border: 1px solid #e5e7eb;">${escapeHtml(item.productName || item.description || '—')}</td>
              <td style="padding: 6px; border: 1px solid #e5e7eb;">${escapeHtml(item.sku || '—')}</td>
              <td style="padding: 6px; border: 1px solid #e5e7eb;">${escapeHtml(formatNumber(item.quantity || 0))} ${escapeHtml(item.unit || '')}</td>
              <td style="padding: 6px; border: 1px solid #e5e7eb;">${escapeHtml(item.lot || '—')}</td>
              <td style="padding: 6px; border: 1px solid #e5e7eb;">${escapeHtml(item.validity ? formatDateDisplay(item.validity) : '—')}</td>
            </tr>`)
          .join('')
      : '';

    popup.document.write(`<!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(formatTransferNumber(transfer.number))}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; }
          table { border-collapse: collapse; width: 100%; font-size: 12px; }
          th { background: #f3f4f6; text-align: left; padding: 6px; border: 1px solid #e5e7eb; }
          td { padding: 6px; border: 1px solid #e5e7eb; }
          .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
          .summary div { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f9fafb; }
          .summary span { display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; }
          .summary strong { font-size: 14px; color: #111827; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(formatTransferNumber(transfer.number))}</h1>
        <p><strong>Status:</strong> ${escapeHtml(transfer.statusLabel || transfer.status || '')}</p>
        <p><strong>Data da solicitação:</strong> ${escapeHtml(dateLabel)}</p>
        <div class="summary">
          <div>
            <span>Origem</span>
            <strong>${escapeHtml(transfer.originDeposit?.name || '—')}</strong><br>
            <small>${escapeHtml(transfer.originCompany?.name || '')}</small>
          </div>
          <div>
            <span>Destino</span>
            <strong>${escapeHtml(transfer.destinationDeposit?.name || '—')}</strong><br>
            <small>${escapeHtml(transfer.destinationCompany?.name || '')}</small>
          </div>
          <div>
            <span>Responsável</span>
            <strong>${escapeHtml(transfer.responsible?.name || transfer.responsible?.email || '—')}</strong>
          </div>
          <div>
            <span>Total de itens</span>
            <strong>${escapeHtml(formatNumber(transfer.items?.length || 0, { maximumFractionDigits: 0 }))}</strong>
          </div>
        </div>
        <h2>Itens</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Produto</th>
              <th>SKU</th>
              <th>Quantidade</th>
              <th>Lote</th>
              <th>Validade</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="6" style="padding: 12px; text-align: center;">Nenhum item registrado.</td></tr>'}
          </tbody>
        </table>
      </body>
      </html>`);
    popup.document.close();
    popup.focus();
    setTimeout(() => {
      popup.print();
      popup.close();
    }, 400);
  }

  function handleTableClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, transferId } = button.dataset;
    if (!transferId) return;

    switch (action) {
      case 'details':
        openTransferDetails(transferId);
        break;
      case 'approve':
        confirmApproveTransfer(transferId);
        break;
      case 'generate-nfe':
      case 'generate-xml':
        if (typeof window.showToast === 'function') {
          window.showToast('Em desenvolvimento.', 'info', 3000);
        }
        break;
      case 'generate-pdf':
        generateTransferPdf(transferId);
        break;
      default:
        break;
    }
  }

  function initDefaultDates() {
    const today = new Date();
    const formatted = formatDateForInput(today);
    if (elements.dateStartInput) {
      elements.dateStartInput.value = formatted;
      state.filters.startDate = formatted;
      state.lastValidDates.startDate = formatted;
    }
    if (elements.dateEndInput) {
      elements.dateEndInput.value = formatted;
      state.filters.endDate = formatted;
      state.lastValidDates.endDate = formatted;
    }
  }

  function attachEvents() {
    elements.originSelect?.addEventListener('change', (event) => {
      updateFilter('originDeposit', event.target.value);
    });
    elements.destinationSelect?.addEventListener('change', (event) => {
      updateFilter('destinationDeposit', event.target.value);
    });
    elements.statusSelect?.addEventListener('change', (event) => {
      updateFilter('status', event.target.value);
    });
    elements.dateStartInput?.addEventListener('change', (event) => {
      handleDateChange('startDate', event.target);
    });
    elements.dateEndInput?.addEventListener('change', (event) => {
      handleDateChange('endDate', event.target);
    });
    elements.tableBody?.addEventListener('click', handleTableClick);

    if (elements.exportButton) {
      elements.exportButton.addEventListener('click', () => {
        if (typeof window.showToast === 'function') {
          window.showToast('Exportação de transferências ainda não está disponível.', 'info', 3000);
        }
      });
    }

    if (elements.approveSelectedButton) {
      elements.approveSelectedButton.addEventListener('click', () => {
        if (typeof window.showToast === 'function') {
          window.showToast('Seleção múltipla ainda não está disponível.', 'info', 3000);
        }
      });
    }
  }

  async function init() {
    initDefaultDates();
    attachEvents();
    await loadFilters();
    await fetchTransfers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
