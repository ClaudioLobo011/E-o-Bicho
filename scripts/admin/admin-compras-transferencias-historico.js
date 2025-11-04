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
      startDate: '',
      endDate: '',
      status: '',
      search: '',
    },
    lastValidDates: {
      startDate: '',
      endDate: '',
    },
    transfers: [],
    summary: {
      totalTransfers: 0,
      pendingTransfers: 0,
      totalCost: 0,
      totalSale: 0,
      withInvoice: 0,
      period: { start: null, end: null },
    },
    loading: false,
    detailsCache: new Map(),
  };

  const elements = {
    dateStartInput: document.getElementById('filter-date-start'),
    dateEndInput: document.getElementById('filter-date-end'),
    statusSelect: document.getElementById('filter-status'),
    searchInput: document.getElementById('filter-search'),
    tableBody: document.getElementById('history-table-body'),
    summaryPeriodLabel: document.getElementById('summary-period-label'),
    summaryTotalTransfers: document.getElementById('summary-total-transfers'),
    summaryPendingTransfers: document.getElementById('summary-pending-transfers'),
    summaryTotalCost: document.getElementById('summary-total-cost'),
    summaryTotalSale: document.getElementById('summary-total-sale'),
    summaryWithInvoice: document.getElementById('summary-with-invoice'),
    saveFilterButton: document.querySelector('button i.fa-filter')?.parentElement || null,
    exportButton: document.querySelector('button i.fa-file-download')?.parentElement || null,
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
      day: '2-digit',
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

  function normalizeDecimal(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const direct = Number(trimmed);
      if (Number.isFinite(direct)) {
        return direct;
      }
      const sanitized = trimmed.replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '.');
      const fallback = Number(sanitized);
      return Number.isFinite(fallback) ? fallback : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function renderStatusBadge(status) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.solicitada;
    const iconHtml = config.icon ? `<i class="fas ${config.icon}"></i>` : '';
    return `<span class="${config.classes}">${iconHtml}${escapeHtml(config.label)}</span>`;
  }

  function formatDepositDisplay(deposit, company) {
    const depositName = deposit?.name || '—';
    const companyName = company?.name ? ` • ${company.name}` : '';
    return `${escapeHtml(depositName)}${escapeHtml(companyName)}`;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    if (!elements.tableBody) return;
    if (isLoading) {
      elements.tableBody.innerHTML = `
        <tr>
          <td colspan="9" class="px-4 py-6 text-center text-sm text-gray-500">
            Carregando histórico de transferências...
          </td>
        </tr>
      `;
    }
  }

  function buildQueryParams() {
    const params = new URLSearchParams();
    const { startDate, endDate, status } = state.filters;
    if (startDate) {
      params.append('startDate', startDate);
    }
    if (endDate) {
      params.append('endDate', endDate);
    }
    if (status) {
      params.append('status', status);
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
        throw new Error(payload?.message || 'Não foi possível carregar o histórico de transferências.');
      }
      const data = await response.json();
    state.transfers = Array.isArray(data?.transfers) ? data.transfers : [];
    state.summary = {
        totalTransfers: Number(data?.summary?.totalTransfers) || state.transfers.length,
        pendingTransfers: Number(data?.summary?.pendingTransfers ?? data?.summary?.pendingNfe) || 0,
        totalCost: Number(data?.summary?.totalCost) || 0,
        totalSale: Number(data?.summary?.totalSale) || 0,
        withInvoice: Number(data?.summary?.withInvoice) || 0,
        period: data?.summary?.period || { start: null, end: null },
      };
      state.loading = false;
      renderTransfers();
      renderSummary();
    } catch (error) {
      console.error('Erro ao buscar histórico de transferências:', error);
      renderErrorState(error.message || 'Não foi possível carregar o histórico de transferências.');
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Não foi possível carregar o histórico de transferências.', 'error', 4000);
      }
    } finally {
      setLoading(false);
    }
  }

  function applySearchFilter(transfers) {
    const term = state.filters.search.trim().toLowerCase();
    if (!term) return transfers;
    return transfers.filter((transfer) => {
      const haystack = [
        formatTransferNumber(transfer.number),
        transfer.referenceDocument || '',
        transfer.originDeposit?.name || '',
        transfer.originCompany?.name || '',
        transfer.destinationDeposit?.name || '',
        transfer.destinationCompany?.name || '',
        transfer.statusLabel || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }

  function renderTransfers() {
    if (!elements.tableBody) return;
    const filtered = applySearchFilter(state.transfers);
    if (!filtered.length) {
      elements.tableBody.innerHTML = `
        <tr>
          <td colspan="9" class="px-4 py-6 text-center text-sm text-gray-500">
            Nenhuma transferência encontrada para os filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((transfer) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50 transition';
      row.innerHTML = `
        <td class="px-4 py-3 font-medium text-gray-800">${escapeHtml(formatTransferNumber(transfer.number))}</td>
        <td class="px-4 py-3 text-gray-600">${escapeHtml(formatDateDisplay(transfer.requestDate))}</td>
        <td class="px-4 py-3 text-gray-600">${formatDepositDisplay(transfer.originDeposit, transfer.originCompany)}</td>
        <td class="px-4 py-3 text-gray-600">${formatDepositDisplay(transfer.destinationDeposit, transfer.destinationCompany)}</td>
        <td class="px-4 py-3">${renderStatusBadge(transfer.status)}</td>
        <td class="px-4 py-3 text-gray-600">${escapeHtml(transfer.referenceDocument || '—')}</td>
        <td class="px-4 py-3 text-right text-gray-800">${escapeHtml(formatCurrency(transfer.totals?.totalCost || 0))}</td>
        <td class="px-4 py-3 text-right text-gray-800">${escapeHtml(formatCurrency(transfer.totals?.totalSale || 0))}</td>
        <td class="px-4 py-3">
          <div class="flex justify-end gap-2">
            <button type="button" class="js-transfer-action rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="xml" data-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-file-code"></i>
              XML
            </button>
            <button type="button" class="js-transfer-action rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition" data-action="danfe" data-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-file-invoice"></i>
              DANFE
            </button>
            <button type="button" class="js-transfer-action rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary/90 transition" data-action="pdf" data-id="${escapeHtml(transfer.id)}">
              <i class="fas fa-file-pdf"></i>
              PDF
            </button>
          </div>
        </td>
      `;
      fragment.appendChild(row);
    });

    elements.tableBody.innerHTML = '';
    elements.tableBody.appendChild(fragment);

    elements.tableBody.querySelectorAll('.js-transfer-action').forEach((button) => {
      const action = button.getAttribute('data-action');
      const id = button.getAttribute('data-id');
      if (!action || !id) return;
      if (action === 'pdf') {
        button.addEventListener('click', () => handleGeneratePdf(id));
      } else if (action === 'xml') {
        button.addEventListener('click', () => {
          if (typeof window.showToast === 'function') {
            window.showToast('Geração de XML ainda está em desenvolvimento.', 'info', 3500);
          }
        });
      } else if (action === 'danfe') {
        button.addEventListener('click', () => {
          if (typeof window.showToast === 'function') {
            window.showToast('Geração de DANFE ainda está em desenvolvimento.', 'info', 3500);
          }
        });
      }
    });
  }

  function renderSummary() {
    const { summary } = state;
    if (elements.summaryTotalTransfers) {
      elements.summaryTotalTransfers.textContent = formatNumber(summary.totalTransfers, { maximumFractionDigits: 0 });
    }
    if (elements.summaryPendingTransfers) {
      elements.summaryPendingTransfers.textContent = formatNumber(summary.pendingTransfers, { maximumFractionDigits: 0 });
    }
    if (elements.summaryTotalCost) {
      elements.summaryTotalCost.textContent = formatCurrency(summary.totalCost);
    }
    if (elements.summaryTotalSale) {
      elements.summaryTotalSale.textContent = formatCurrency(summary.totalSale);
    }
    if (elements.summaryWithInvoice) {
      elements.summaryWithInvoice.textContent = formatNumber(summary.withInvoice, { maximumFractionDigits: 0 });
    }
    if (elements.summaryPeriodLabel) {
      const { start, end } = summary.period || {};
      const hasStart = start ? new Date(start) : null;
      const hasEnd = end ? new Date(end) : null;
      if (hasStart && hasEnd) {
        elements.summaryPeriodLabel.innerHTML = `<i class="fas fa-calendar-alt"></i> ${escapeHtml(`De ${formatLongDate(hasStart)} até ${formatLongDate(hasEnd)}`)}`;
      } else if (hasStart) {
        elements.summaryPeriodLabel.innerHTML = `<i class="fas fa-calendar-alt"></i> ${escapeHtml(`A partir de ${formatLongDate(hasStart)}`)}`;
      } else if (hasEnd) {
        elements.summaryPeriodLabel.innerHTML = `<i class="fas fa-calendar-alt"></i> ${escapeHtml(`Até ${formatLongDate(hasEnd)}`)}`;
      } else {
        elements.summaryPeriodLabel.innerHTML = '<i class="fas fa-calendar-alt"></i> Todos os períodos';
      }
    }
  }

  function renderErrorState(message) {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="px-4 py-6 text-center text-sm text-red-600">
          ${escapeHtml(message || 'Não foi possível carregar os dados.')}
        </td>
      </tr>
    `;
  }

  function updateFilter(key, value) {
    state.filters[key] = value;
    if (key === 'search') {
      renderTransfers();
    } else {
      fetchTransfers();
    }
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

  function buildPdfHtml(transfer) {
    const number = formatTransferNumber(transfer.number);
    const requestDate = formatLongDate(transfer.requestDate) || '—';
    const statusConfig = STATUS_CONFIG[transfer.status] || STATUS_CONFIG.solicitada;
    const statusLabel = escapeHtml(statusConfig.label);
    const statusSymbol = transfer.status === 'aprovada' ? '✔' : transfer.status === 'em_separacao' ? '⏳' : '⬆';
    const statusIconHtml = `<span class="status-symbol">${statusSymbol}</span>`;
    const documentRef = escapeHtml(transfer.referenceDocument || '—');
    const origin = formatDepositDisplay(transfer.originDeposit, transfer.originCompany);
    const destination = formatDepositDisplay(transfer.destinationDeposit, transfer.destinationCompany);
    const responsible = escapeHtml(transfer.responsible?.name || transfer.responsible?.email || '—');
    const observationsHtml = escapeHtml(transfer.observations || '—').replace(/\n/g, '<br>');
    const emissionDate = formatLongDate(new Date()) || formatDateDisplay(new Date());

    const normalizedItems = Array.isArray(transfer.items)
      ? transfer.items.map((item) => {
          const quantityValue = normalizeDecimal(item.quantity);
          const quantity = Number.isFinite(quantityValue) ? quantityValue : 0;

          const unitCostValue = normalizeDecimal(item.unitCost);
          let totalCostValue = normalizeDecimal(item.totalCost);

          let unitSaleValue = normalizeDecimal(item.unitSale);
          let totalSaleValue = normalizeDecimal(item.totalSale);

          if ((unitSaleValue === null || unitSaleValue === 0) && totalSaleValue !== null && quantity) {
            const computedUnit = totalSaleValue / quantity;
            if (Number.isFinite(computedUnit)) {
              unitSaleValue = computedUnit;
            }
          }

          if ((totalSaleValue === null || totalSaleValue === 0) && unitSaleValue !== null) {
            const computedTotal = unitSaleValue * quantity;
            if (Number.isFinite(computedTotal)) {
              totalSaleValue = computedTotal;
            }
          }

          if (totalCostValue === null && unitCostValue !== null) {
            const computedCost = unitCostValue * quantity;
            if (Number.isFinite(computedCost)) {
              totalCostValue = computedCost;
            }
          }

          const unitCost = unitCostValue !== null ? Math.round(unitCostValue * 100) / 100 : null;
          const totalCost = totalCostValue !== null ? Math.round(totalCostValue * 100) / 100 : null;
          const unitSale = unitSaleValue !== null ? Math.round(unitSaleValue * 100) / 100 : null;
          const totalSale = totalSaleValue !== null ? Math.round(totalSaleValue * 100) / 100 : null;

          return {
            sku: item.sku || item.barcode || '—',
            description: item.description || item.productName || '—',
            quantity,
            unit: item.unit || '—',
            unitCost,
            totalCost,
            unitSale,
            totalSale,
          };
        })
      : [];

    const computedTotals = normalizedItems.reduce(
      (acc, item) => {
        if (Number.isFinite(item.quantity)) {
          acc.totalVolume += item.quantity;
        }
        if (Number.isFinite(item.totalCost)) {
          acc.totalCost += item.totalCost;
        }
        if (Number.isFinite(item.totalSale)) {
          acc.totalSale += item.totalSale;
        }
        return acc;
      },
      { totalVolume: 0, totalCost: 0, totalSale: 0 }
    );

    computedTotals.totalVolume = Math.round(computedTotals.totalVolume * 1000) / 1000;
    computedTotals.totalCost = Math.round(computedTotals.totalCost * 100) / 100;
    computedTotals.totalSale = Math.round(computedTotals.totalSale * 100) / 100;

    const fallbackTotals = transfer.totals || {};
    const fallbackVolume = normalizeDecimal(fallbackTotals.totalVolume);
    const fallbackCost = normalizeDecimal(fallbackTotals.totalCost);
    const fallbackSale = normalizeDecimal(fallbackTotals.totalSale);

    const totals = {
      totalVolume: computedTotals.totalVolume || fallbackVolume || 0,
      totalCost: computedTotals.totalCost || fallbackCost || 0,
      totalSale: computedTotals.totalSale || fallbackSale || 0,
    };

    const totalItems = normalizedItems.length;

    const formatCurrencyCell = (value) => {
      if (value === null) {
        return '—';
      }
      return escapeHtml(formatCurrency(value));
    };

    const formatQuantityCell = (value) => {
      const numeric = Number.isFinite(value) ? value : 0;
      const options = Number.isInteger(numeric)
        ? { maximumFractionDigits: 0 }
        : { minimumFractionDigits: 0, maximumFractionDigits: 3 };
      return escapeHtml(formatNumber(numeric, options));
    };

    const itemsRows = normalizedItems.length
      ? normalizedItems
          .map(
            (item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(item.sku)}</td>
            <td>${escapeHtml(item.description)}</td>
            <td class="numeric">${formatQuantityCell(item.quantity)}</td>
            <td>${escapeHtml(item.unit)}</td>
            <td class="numeric">${formatCurrencyCell(item.unitCost)}</td>
            <td class="numeric">${formatCurrencyCell(item.totalCost)}</td>
            <td class="numeric">${formatCurrencyCell(item.unitSale)}</td>
            <td class="numeric">${formatCurrencyCell(item.totalSale)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td class="empty" colspan="9">Nenhum item registrado.</td></tr>';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Transferência ${escapeHtml(number)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: 'Inter', Arial, sans-serif; margin: 0; color: #111827; background: #ffffff; }
    .document { padding: 16px 24px 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
    .title { margin: 0; font-size: 22px; font-weight: 700; color: #111827; }
    .subtitle { margin: 4px 0 0; font-size: 12px; color: #6b7280; }
    .status-badge { margin-top: 12px; }
    .status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 12px; }
    .status-symbol { font-size: 11px; }
    .status-solicitada { background: #e0f2fe; color: #0369a1; }
    .status-em_separacao { background: #fef3c7; color: #b45309; }
    .status-aprovada { background: #d1fae5; color: #047857; }
    .header-card { min-width: 220px; border: 1px solid #d1d5db; border-radius: 12px; padding: 12px 16px; background: #f9fafb; display: flex; flex-direction: column; gap: 6px; }
    .header-card span { font-size: 10px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; }
    .header-card strong { font-size: 14px; color: #111827; }
    .meta { margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .meta-item { padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb; display: flex; flex-direction: column; gap: 6px; min-height: 72px; }
    .meta-item span { font-size: 10px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.06em; }
    .meta-item strong { font-size: 13px; color: #111827; font-weight: 600; }
    .meta-item p { margin: 0; font-size: 12px; color: #374151; line-height: 1.45; }
    .meta-item--wide { grid-column: span 2; }
    h2 { font-size: 16px; margin: 28px 0 8px; color: #111827; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th { background: #f3f4f6; border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; color: #374151; }
    tbody td { border: 1px solid #e5e7eb; padding: 6px 10px; color: #111827; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    td.numeric { text-align: right; font-variant-numeric: tabular-nums; }
    td.empty { text-align: center; padding: 14px; font-size: 12px; color: #6b7280; }
    .totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 20px; }
    .totals div { border: 1px solid #d1d5db; border-radius: 12px; padding: 14px 16px; background: linear-gradient(180deg, #f9fafb 0%, #f3f4f6 100%); }
    .totals span { display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.06em; margin-bottom: 6px; }
    .totals strong { font-size: 15px; color: #111827; }
    .signature-area { margin-top: 36px; display: flex; justify-content: center; }
    .signature { width: 260px; text-align: center; }
    .signature-line { border-top: 1px dashed #9ca3af; margin: 48px 0 8px; }
    .signature-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
    @media print {
      body { background: #ffffff; }
      .document { padding: 0; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="document">
    <div class="header">
      <div>
        <h1 class="title">Transferência ${escapeHtml(number)}</h1>
        <p class="subtitle">Emitido em ${escapeHtml(emissionDate)}</p>
        <div class="status-badge">
          <span class="status-pill status-${escapeHtml(transfer.status || 'solicitada')}">
            ${statusIconHtml}
            ${statusLabel}
          </span>
        </div>
      </div>
      <div class="header-card">
        <span>Documento fiscal</span>
        <strong>${documentRef}</strong>
      </div>
    </div>

    <div class="meta">
      <div class="meta-item">
        <span>Data da solicitação</span>
        <strong>${escapeHtml(requestDate)}</strong>
      </div>
      <div class="meta-item">
        <span>Origem</span>
        <strong>${origin}</strong>
      </div>
      <div class="meta-item">
        <span>Destino</span>
        <strong>${destination}</strong>
      </div>
      <div class="meta-item">
        <span>Responsável</span>
        <strong>${responsible}</strong>
      </div>
      <div class="meta-item meta-item--wide">
        <span>Observações</span>
        <p>${observationsHtml}</p>
      </div>
    </div>

    <h2>Itens transferidos</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Código</th>
          <th>Descrição</th>
          <th class="numeric">Quantidade</th>
          <th>Unidade</th>
          <th class="numeric">Custo unit.</th>
          <th class="numeric">Custo total</th>
          <th class="numeric">Venda unit.</th>
          <th class="numeric">Venda total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div class="totals">
      <div>
        <span>Total de itens</span>
        <strong>${escapeHtml(formatNumber(totalItems, { maximumFractionDigits: 0 }))}</strong>
      </div>
      <div>
        <span>Volume total</span>
        <strong>${escapeHtml(formatNumber(totals.totalVolume, { maximumFractionDigits: 3 }))}</strong>
      </div>
      <div>
        <span>Valor de custo total</span>
        <strong>${escapeHtml(formatCurrency(totals.totalCost))}</strong>
      </div>
      <div>
        <span>Valor de venda total</span>
        <strong>${escapeHtml(formatCurrency(totals.totalSale))}</strong>
      </div>
    </div>

    <div class="signature-area">
      <div class="signature">
        <div class="signature-line"></div>
        <span class="signature-label">Assinatura do responsável</span>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.print();
      }, 300);
    });
    window.addEventListener('afterprint', function () {
      window.close();
    });
  </script>
</body>
</html>`;

  }

  async function handleGeneratePdf(id) {
    const transfer = await getTransferDetails(id);
    if (!transfer) {
      return;
    }
    const pdfContent = buildPdfHtml(transfer);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      if (typeof window.showToast === 'function') {
        window.showToast('Não foi possível abrir a visualização do PDF. Verifique o bloqueio de pop-ups.', 'warning', 4000);
      }
      return;
    }
    printWindow.document.write(pdfContent);
    printWindow.document.close();
  }

  if (elements.dateStartInput) {
    elements.dateStartInput.addEventListener('change', () => handleDateChange('startDate', elements.dateStartInput));
  }
  if (elements.dateEndInput) {
    elements.dateEndInput.addEventListener('change', () => handleDateChange('endDate', elements.dateEndInput));
  }
  if (elements.statusSelect) {
    elements.statusSelect.addEventListener('change', (event) => updateFilter('status', event.target.value));
  }
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', (event) => updateFilter('search', event.target.value));
  }
  if (elements.saveFilterButton) {
    elements.saveFilterButton.addEventListener('click', () => {
      if (typeof window.showToast === 'function') {
        window.showToast('Salvar filtro ainda está em desenvolvimento.', 'info', 3000);
      }
    });
  }
  if (elements.exportButton) {
    elements.exportButton.addEventListener('click', () => {
      if (typeof window.showToast === 'function') {
        window.showToast('Exportação em CSV ainda está em desenvolvimento.', 'info', 3000);
      }
    });
  }

  fetchTransfers();
})();
