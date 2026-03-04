(() => {
  const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) || '/api';

  const elements = {
    monthView: document.getElementById('billing-month-view'),
    monthCompare: document.getElementById('billing-month-compare'),
    companyCode: document.getElementById('billing-company-code'),
    pdvSelect: document.getElementById('billing-pdv-select'),
    companyModal: document.getElementById('billing-company-modal'),
    companyModalClose: document.getElementById('billing-company-modal-close'),
    companyModalSearch: document.getElementById('billing-company-modal-search'),
    companyModalResults: document.getElementById('billing-company-modal-results'),
    periodLabel: document.getElementById('billing-period-label'),
    compare: document.getElementById('billing-compare'),
    updated: document.getElementById('billing-updated'),
    metricGross: document.getElementById('metric-gross'),
    metricNet: document.getElementById('metric-net'),
    metricTicket: document.getElementById('metric-ticket'),
    metricOrders: document.getElementById('metric-orders'),
    metricDiscounts: document.getElementById('metric-discounts'),
    metricFees: document.getElementById('metric-fees'),
    metricRefunds: document.getElementById('metric-refunds'),
    metricProfit: document.getElementById('metric-profit'),
    trendGross: document.getElementById('metric-gross-trend'),
    trendNet: document.getElementById('metric-net-trend'),
    trendTicket: document.getElementById('metric-ticket-trend'),
    trendOrders: document.getElementById('metric-orders-trend'),
    trendDiscounts: document.getElementById('metric-discounts-trend'),
    trendFees: document.getElementById('metric-fees-trend'),
    trendRefunds: document.getElementById('metric-refunds-trend'),
    trendProfit: document.getElementById('metric-profit-trend'),
    dailyChart: document.getElementById('billing-chart-daily'),
    dailyTotal: document.getElementById('billing-daily-total'),
    dailyPeak: document.getElementById('billing-daily-peak'),
    dailyPeakLabel: document.getElementById('billing-daily-peak-label'),
    dailyAvg: document.getElementById('billing-daily-avg'),
    channelDonut: document.getElementById('billing-channel-donut'),
    channelDonutLabel: document.getElementById('billing-channel-donut-label'),
    channelLegend: document.getElementById('billing-channel-legend'),
    ordersSparkline: document.getElementById('billing-orders-sparkline'),
    ordersAvg: document.getElementById('billing-orders-avg'),
    ordersPeak: document.getElementById('billing-orders-peak'),
    ticketSparkline: document.getElementById('billing-ticket-sparkline'),
    ticketAvg: document.getElementById('billing-ticket-avg'),
    ticketPeak: document.getElementById('billing-ticket-peak'),
    goalTarget: document.getElementById('billing-goal-target'),
    goalProgress: document.getElementById('billing-goal-progress'),
    goalAchieved: document.getElementById('billing-goal-achieved'),
    goalPercent: document.getElementById('billing-goal-percent'),
    goalBadge: document.getElementById('billing-goal-badge'),
    projection: document.getElementById('billing-projection'),
    activeCustomers: document.getElementById('billing-active-customers'),
    itemsSold: document.getElementById('billing-items-sold'),
    channelList: document.getElementById('billing-channel-list'),
    healthList: document.getElementById('billing-health-list'),
    customersBody: document.getElementById('billing-customers-body'),
    petsBody: document.getElementById('billing-pets-body'),
    productsBody: document.getElementById('billing-products-body'),
    paymentsBody: document.getElementById('billing-payments-body'),
    taxesList: document.getElementById('billing-taxes-list'),
    notesList: document.getElementById('billing-notes-list'),
    salesBody: document.getElementById('billing-sales-body'),
    salesCount: document.getElementById('billing-sales-count'),
    salesTotal: document.getElementById('billing-sales-total'),
    salesDiscount: document.getElementById('billing-sales-discount'),
    salesFee: document.getElementById('billing-sales-fee'),
    salesNet: document.getElementById('billing-sales-net'),
    alertsList: document.getElementById('billing-alerts-list'),
    nextSteps: document.getElementById('billing-next-steps'),
  };

  const state = {
    companies: [],
    companiesLoaded: false,
    selectedCompany: null,
    pdvs: [],
  };

  const getToken = () => {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return loggedInUser?.token || '';
    } catch (_err) {
      return '';
    }
  };

  const formatCurrency = (value = 0) => {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatNumber = (value = 0) => {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString('pt-BR');
  };

  const formatPercent = (value, digits = 1) => {
    if (!Number.isFinite(value)) return '0%';
    return `${(value * 100).toFixed(digits)}%`;
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const normalizeText = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

  const getCompanyLabel = (company) =>
    company?.nomeFantasia || company?.nome || company?.razaoSocial || 'Empresa sem nome';

  const getPdvLabel = (pdv) => pdv?.apelido || pdv?.nome || pdv?.codigo || 'PDV sem nome';

  const getDefaultPdv = () => {
    if (!Array.isArray(state.pdvs) || !state.pdvs.length) return null;
    return (
      state.pdvs.find((pdv) => String(pdv?.ambientePadrao || '').toLowerCase() === 'producao') ||
      state.pdvs[0] ||
      null
    );
  };

  const buildCompanySearchText = (company) =>
    normalizeText(
      [
        company?.codigo,
        company?.nomeFantasia,
        company?.nome,
        company?.razaoSocial,
        company?.cnpj,
      ]
        .filter(Boolean)
        .join(' ')
    );

  const setSelectedCompany = (company, { syncInput = true } = {}) => {
    state.selectedCompany = company || null;
    if (syncInput && elements.companyCode) {
      if (company) {
        const code = company?.codigo ? String(company.codigo) : '';
        const label = getCompanyLabel(company);
        elements.companyCode.value = code ? `${code} - ${label}` : label;
      } else {
        elements.companyCode.value = '';
      }
    }
  };

  const renderPdvOptions = () => {
    if (!elements.pdvSelect) return;
    const options = ['<option value="">Todos os PDVs</option>'];
    state.pdvs.forEach((pdv) => {
      const id = String(pdv?._id || '');
      const label = getPdvLabel(pdv);
      options.push(`<option value="${id}">${label}</option>`);
    });
    elements.pdvSelect.innerHTML = options.join('');
    elements.pdvSelect.disabled = !state.selectedCompany;
  };

  const clearPdvs = () => {
    state.pdvs = [];
    if (elements.pdvSelect) {
      elements.pdvSelect.value = '';
    }
    renderPdvOptions();
  };

  const findCompanyByCode = (rawValue) => {
    const digits = digitsOnly(rawValue);
    if (!digits) return null;
    return (
      state.companies.find((company) => digitsOnly(company?.codigo) === digits) ||
      state.companies.find((company) => digitsOnly(company?.cnpj) === digits) ||
      null
    );
  };

  const getDefaultCompany = () => {
    if (!Array.isArray(state.companies) || !state.companies.length) return null;
    return [...state.companies].sort((left, right) => {
      const leftCode = Number(digitsOnly(left?.codigo));
      const rightCode = Number(digitsOnly(right?.codigo));
      const leftHasCode = Number.isFinite(leftCode) && leftCode > 0;
      const rightHasCode = Number.isFinite(rightCode) && rightCode > 0;

      if (leftHasCode && rightHasCode && leftCode !== rightCode) {
        return leftCode - rightCode;
      }
      if (leftHasCode !== rightHasCode) {
        return leftHasCode ? -1 : 1;
      }

      return getCompanyLabel(left).localeCompare(getCompanyLabel(right), 'pt-BR');
    })[0];
  };

  const filterCompanies = (query) => {
    const normalized = normalizeText(query);
    const digits = digitsOnly(query);
    return state.companies.filter((company) => {
      if (!normalized) return true;
      if (digits) {
        const codeDigits = digitsOnly(company?.codigo);
        const cnpjDigits = digitsOnly(company?.cnpj);
        if (codeDigits.includes(digits) || cnpjDigits.includes(digits)) return true;
      }
      return buildCompanySearchText(company).includes(normalized);
    });
  };

  const renderCompanyResults = (query = '') => {
    if (!elements.companyModalResults) return;
    const list = filterCompanies(query);
    if (!list.length) {
      elements.companyModalResults.innerHTML =
        '<div class="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">Nenhuma empresa encontrada.</div>';
      return;
    }
    elements.companyModalResults.innerHTML = list
      .map((company) => {
        const label = getCompanyLabel(company);
        const secondary = [company?.nome, company?.razaoSocial].filter(Boolean).join(' • ');
        return `
          <button
            type="button"
            class="flex w-full items-start justify-between rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:border-primary/30 hover:bg-primary/5"
            data-billing-company-id="${company._id || ''}"
          >
            <div>
              <p class="text-sm font-semibold text-gray-800">${label}</p>
              <p class="mt-1 text-xs text-gray-500">${secondary || 'Sem descricao adicional'}</p>
            </div>
            <div class="text-right">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Codigo ${company?.codigo || '-'}</p>
              <p class="mt-1 text-xs text-gray-500">${company?.cnpj || '-'}</p>
            </div>
          </button>
        `;
      })
      .join('');
  };

  const openCompanyModal = (query = '') => {
    if (!elements.companyModal) return;
    renderCompanyResults(query);
    elements.companyModal.classList.remove('hidden');
    elements.companyModal.classList.add('flex');
    if (elements.companyModalSearch) {
      elements.companyModalSearch.value = query;
      requestAnimationFrame(() => elements.companyModalSearch.focus());
    }
  };

  const closeCompanyModal = () => {
    if (!elements.companyModal) return;
    elements.companyModal.classList.add('hidden');
    elements.companyModal.classList.remove('flex');
  };

  const loadAllowedCompanies = async () => {
    if (state.companiesLoaded) return state.companies;
    const token = getToken();
    const response = await fetch(`${API_BASE}/stores/allowed`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || 'Erro ao carregar empresas permitidas.');
    }
    state.companies = Array.isArray(payload?.stores) ? payload.stores : [];
    state.companiesLoaded = true;
    return state.companies;
  };

  const loadPdvsForSelectedCompany = async () => {
    const companyId = String(state.selectedCompany?._id || '').trim();
    if (!companyId) {
      clearPdvs();
      return [];
    }

    if (elements.pdvSelect) {
      elements.pdvSelect.disabled = true;
      elements.pdvSelect.innerHTML = '<option value="">Carregando PDVs...</option>';
    }

    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/pdvs?empresa=${encodeURIComponent(companyId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Erro ao carregar PDVs.');
      }
      state.pdvs = Array.isArray(payload?.pdvs) ? payload.pdvs : [];
      renderPdvOptions();
      const defaultPdv = getDefaultPdv();
      if (elements.pdvSelect) {
        elements.pdvSelect.value = defaultPdv?._id ? String(defaultPdv._id) : '';
      }
      return state.pdvs;
    } catch (error) {
      state.pdvs = [];
      renderPdvOptions();
      throw error;
    }
  };

  const setTrend = (el, value) => {
    if (!el) return;
    const safe = Number.isFinite(value) ? value : 0;
    const isIncrease = safe > 0.001;
    const isDecrease = safe < -0.001;

    el.className = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

    if (isIncrease) {
      el.classList.add('bg-emerald-50', 'text-emerald-700');
      el.innerHTML = `<i class="fas fa-arrow-up"></i>${formatPercent(Math.abs(safe))}`;
      return;
    }

    if (isDecrease) {
      el.classList.add('bg-rose-50', 'text-rose-700');
      el.innerHTML = `<i class="fas fa-arrow-down"></i>${formatPercent(Math.abs(safe))}`;
      return;
    }

    el.classList.add('bg-gray-100', 'text-gray-700');
    el.innerHTML = `<i class="fas fa-minus"></i>${formatPercent(Math.abs(safe))}`;
  };

  const setCurrencyReference = (el, currentValue, referenceValue, options = {}) => {
    if (!el) return;
    const current = Number.isFinite(currentValue) ? currentValue : 0;
    const reference = Number.isFinite(referenceValue) ? referenceValue : 0;
    const invert = Boolean(options.invert);
    const isIncrease = current > reference + 0.001;
    const isDecrease = current < reference - 0.001;
    const positive = invert ? isDecrease : isIncrease;
    const negative = invert ? isIncrease : isDecrease;

    el.className = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

    if (positive) {
      el.classList.add('bg-emerald-50', 'text-emerald-700');
      el.innerHTML = `<i class="fas fa-arrow-up"></i>${formatCurrency(reference)}`;
      return;
    }

    if (negative) {
      el.classList.add('bg-rose-50', 'text-rose-700');
      el.innerHTML = `<i class="fas fa-arrow-down"></i>${formatCurrency(reference)}`;
      return;
    }

    el.classList.add('bg-gray-100', 'text-gray-700');
    el.innerHTML = `<i class="fas fa-minus"></i>${formatCurrency(reference)}`;
  };

  const setCountReference = (el, currentValue, referenceValue) => {
    if (!el) return;
    const current = Number.isFinite(currentValue) ? currentValue : 0;
    const reference = Number.isFinite(referenceValue) ? referenceValue : 0;
    const isIncrease = current > reference;
    const isDecrease = current < reference;

    el.className = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

    if (isIncrease) {
      el.classList.add('bg-emerald-50', 'text-emerald-700');
      el.innerHTML = `<i class="fas fa-arrow-up"></i>${formatNumber(reference)}`;
      return;
    }

    if (isDecrease) {
      el.classList.add('bg-rose-50', 'text-rose-700');
      el.innerHTML = `<i class="fas fa-arrow-down"></i>${formatNumber(reference)}`;
      return;
    }

    el.classList.add('bg-gray-100', 'text-gray-700');
    el.innerHTML = `<i class="fas fa-minus"></i>${formatNumber(reference)}`;
  };

  const toDateValue = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const toStartOfDay = (date) => {
    const source = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(source.getTime())) return null;
    return new Date(source.getFullYear(), source.getMonth(), source.getDate());
  };

  const buildDailySeries = (sales = [], period = {}) => {
    const list = Array.isArray(sales) ? sales : [];
    let start = toStartOfDay(toDateValue(period?.view?.start));
    let end = toStartOfDay(toDateValue(period?.view?.end));

    if (!start || !end) {
      const dates = list
        .map((sale) => toStartOfDay(toDateValue(sale?.date)))
        .filter(Boolean);
      if (dates.length) {
        dates.sort((a, b) => a.getTime() - b.getTime());
        start = dates[0];
        end = dates[dates.length - 1];
      }
    }

    if (!start || !end) {
      const today = new Date();
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }

    if (end < start) {
      const temp = start;
      start = end;
      end = temp;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.round((end - start) / dayMs) + 1);
    const gross = Array(totalDays).fill(0);
    const net = Array(totalDays).fill(0);
    const orders = Array(totalDays).fill(0);
    const dates = Array.from({ length: totalDays }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });

    list.forEach((sale) => {
      const date = toStartOfDay(toDateValue(sale?.date));
      if (!date) return;
      const index = Math.round((date - start) / dayMs);
      if (index < 0 || index >= totalDays) return;
      gross[index] += Number.isFinite(sale.gross) ? sale.gross : 0;
      net[index] += Number.isFinite(sale.net) ? sale.net : 0;
      orders[index] += 1;
    });

    const ticket = orders.map((count, index) => (count ? gross[index] / count : 0));
    const labels = dates.map((date) =>
      date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    );

    return { gross, net, orders, ticket, dates, labels, start, end };
  };

  const buildLinePoints = (values, { width, height, padding = 10, min = 0, max = 1 }) => {
    const safeValues = values.map((value) => (Number.isFinite(value) ? value : 0));
    const safeMax = Number.isFinite(max) && max > min ? max : min + 1;
    const range = safeMax - min || 1;
    const step = safeValues.length > 1 ? (width - padding * 2) / (safeValues.length - 1) : 0;
    return safeValues.map((value, index) => {
      const x = padding + step * index;
      const ratio = (value - min) / range;
      const y = height - padding - ratio * (height - padding * 2);
      return { x, y, value };
    });
  };

  const buildLinePath = (points) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
      .join(' ');

  const buildAreaPath = (points, { height, padding = 10 }) => {
    if (!points.length) return '';
    const first = points[0];
    const last = points[points.length - 1];
    return `${buildLinePath(points)} L ${last.x},${height - padding} L ${first.x},${
      height - padding
    } Z`;
  };

  const renderSparkline = (container, values, options = {}) => {
    if (!container) return;
    const safeValues = Array.isArray(values) ? values : [];
    const hasData = safeValues.some((value) => value > 0);
    if (!safeValues.length || !hasData) {
      container.innerHTML =
        '<div class="h-full w-full rounded-lg border border-dashed border-gray-200 bg-white/60 flex items-center justify-center text-[11px] text-gray-400">Sem dados</div>';
      return;
    }
    const width = 140;
    const height = 48;
    const padding = 6;
    const maxValue = Math.max(...safeValues, 1);
    const points = buildLinePoints(safeValues, { width, height, padding, min: 0, max: maxValue });
    const linePath = buildLinePath(points);
    const areaPath = buildAreaPath(points, { height, padding });
    const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;
    const stroke = options.stroke || '#0f766e';
    const fill = options.fill || 'rgba(20, 184, 166, 0.15)';
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${stroke}" stop-opacity="0.35"></stop>
            <stop offset="100%" stop-color="${fill}" stop-opacity="0.05"></stop>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#${gradientId})"></path>
        <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    `;
  };

  const renderDailyChart = (series) => {
    if (!elements.dailyChart) return;
    const gross = Array.isArray(series?.gross) ? series.gross : [];
    const net = Array.isArray(series?.net) ? series.net : [];
    const labels = Array.isArray(series?.labels) ? series.labels : [];
    const hasData = gross.some((value) => value > 0) || net.some((value) => value > 0);
    if (!gross.length || !hasData) {
      elements.dailyChart.innerHTML =
        '<div class="h-full w-full rounded-lg border border-dashed border-gray-200 bg-white/60 flex items-center justify-center text-xs text-gray-400">Sem dados no periodo.</div>';
      return;
    }
    const width = 720;
    const height = 220;
    const paddingTop = 28;
    const paddingRight = 18;
    const paddingBottom = 34;
    const paddingLeft = 18;
    const maxValue = Math.max(...gross, ...net, 1);
    const pointsGross = buildLinePoints(gross, {
      width,
      height,
      padding: 0,
      min: 0,
      max: maxValue,
    }).map((point) => ({
      ...point,
      x:
        paddingLeft +
        ((width - paddingLeft - paddingRight) * (point.x / Math.max(width, 1))),
      y:
        paddingTop +
        ((height - paddingTop - paddingBottom) * ((point.y - 0) / Math.max(height, 1))),
    }));
    const pointsNet = buildLinePoints(net, {
      width,
      height,
      padding: 0,
      min: 0,
      max: maxValue,
    }).map((point) => ({
      ...point,
      x:
        paddingLeft +
        ((width - paddingLeft - paddingRight) * (point.x / Math.max(width, 1))),
      y:
        paddingTop +
        ((height - paddingTop - paddingBottom) * ((point.y - 0) / Math.max(height, 1))),
    }));
    const pathGross = buildLinePath(pointsGross);
    const pathNet = buildLinePath(pointsNet);
    const areaGross = buildAreaPath(pointsGross, {
      height: height - paddingBottom,
      padding: 0,
    });
    const gradientId = `daily-${Math.random().toString(36).slice(2, 8)}`;
    const lastPoint = pointsGross[pointsGross.length - 1];
    const topLabels = pointsGross
      .map((point, index) => {
        const label = labels[index] || '';
        if (!label) return '';
        const y = Math.max(16, Math.min(point.y - 8, paddingTop + 8));
        return `
          <g transform="translate(${point.x},${y}) rotate(-32)">
            <text
              text-anchor="middle"
              fill="#475569"
              font-size="9"
              font-weight="600"
              font-family="sans-serif"
            >${label}</text>
          </g>
        `;
      })
      .join('');
    const pointMarkers = pointsGross
      .map((point, index) => {
        if (!(gross[index] > 0)) return '';
        return `<circle cx="${point.x}" cy="${point.y}" r="3" fill="#0f766e"></circle>`;
      })
      .join('');
    const horizontalGuides = [0.25, 0.5, 0.75]
      .map((ratio) => {
        const y = paddingTop + (height - paddingTop - paddingBottom) * (1 - ratio);
        return `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4 4" opacity="0.6"></line>`;
      })
      .join('');

    elements.dailyChart.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"></stop>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.02"></stop>
          </linearGradient>
        </defs>
        ${horizontalGuides}
        <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#cbd5e1" stroke-width="1"></line>
        <path d="${areaGross}" fill="url(#${gradientId})"></path>
        <path d="${pathGross}" fill="none" stroke="#0f766e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="${pathNet}" fill="none" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 4" opacity="0.9"></path>
        ${pointMarkers}
        ${topLabels}
        ${lastPoint ? `<circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="3.2" fill="#0f766e"></circle>` : ''}
      </svg>
    `;
  };

  const renderChannelDonut = (channels) => {
    if (!elements.channelDonut || !elements.channelLegend) return;
    const list = Array.isArray(channels) ? channels : [];
    if (!list.length) {
      elements.channelDonut.style.background = '#f3f4f6';
      elements.channelDonut.innerHTML =
        '<div class="flex h-full w-full items-center justify-center text-[11px] text-gray-400">Sem dados</div>';
      if (elements.channelDonutLabel) {
        elements.channelDonutLabel.textContent = 'Sem dados';
      }
      elements.channelLegend.innerHTML =
        '<p class="text-xs text-gray-500">Sem canais no periodo.</p>';
      return;
    }

    const palette = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#14b8a6', '#f97316'];
    const totalGross = list.reduce(
      (sum, channel) => sum + (Number.isFinite(channel.gross) ? channel.gross : 0),
      0
    );
    if (!(totalGross > 0)) {
      elements.channelDonut.style.background = '#f3f4f6';
      elements.channelDonut.innerHTML =
        '<div class="flex h-full w-full items-center justify-center text-[11px] text-gray-400">Sem dados</div>';
      if (elements.channelDonutLabel) {
        elements.channelDonutLabel.textContent = 'Sem dados';
      }
      elements.channelLegend.innerHTML =
        '<p class="text-xs text-gray-500">Sem canais no periodo.</p>';
      return;
    }

    let cumulative = 0;
    const slices = list.map((channel, index) => {
      const share = channel.share || (totalGross > 0 ? channel.gross / totalGross : 0);
      const start = cumulative;
      const end = cumulative + share;
      cumulative = end;
      const color = palette[index % palette.length];
      return { label: channel.label, share, start, end, color, gross: channel.gross || 0 };
    });

    if (cumulative < 1) {
      slices.push({
        label: 'Outros',
        share: 1 - cumulative,
        start: cumulative,
        end: 1,
        color: '#e5e7eb',
        gross: 0,
      });
    }

    const center = 60;
    const radius = 52;
    let svgPaths = '';
    slices
      .filter((slice) => slice.share > 0)
      .forEach((slice) => {
        const startAngle = slice.start * Math.PI * 2 - Math.PI / 2;
        const endAngle = slice.end * Math.PI * 2 - Math.PI / 2;
        const x1 = center + radius * Math.cos(startAngle);
        const y1 = center + radius * Math.sin(startAngle);
        const x2 = center + radius * Math.cos(endAngle);
        const y2 = center + radius * Math.sin(endAngle);
        const largeArc = slice.end - slice.start > 0.5 ? 1 : 0;
        svgPaths += `
          <path d="M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${slice.color}"></path>
        `;
      });

    elements.channelDonut.style.background = 'transparent';
    elements.channelDonut.innerHTML = `
      <svg viewBox="0 0 120 120" class="h-full w-full" role="img" aria-label="Mix de canais">
        ${svgPaths}
      </svg>
    `;

    const topChannel = slices.reduce((max, slice) => (slice.share > max.share ? slice : max), slices[0]);
    if (elements.channelDonutLabel) {
      elements.channelDonutLabel.innerHTML = `<span class="block">${topChannel.label}</span><span class="block">${formatPercent(topChannel.share, 0)}</span>`;
    }

    elements.channelLegend.innerHTML = slices
      .filter((slice) => slice.label !== 'Outros')
      .map(
        (slice) => `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-full" style="background:${slice.color}"></span>
            <span class="text-xs font-semibold text-gray-700">${slice.label}</span>
          </div>
          <span class="text-[11px] text-gray-500">${formatCurrency(slice.gross)}</span>
        </div>
      `
      )
      .join('');
  };

  const renderBillingCharts = (payload) => {
    const sales = Array.isArray(payload?.sales) ? payload.sales : [];
    const series = buildDailySeries(sales, payload?.period || {});
    renderDailyChart(series);
    renderChannelDonut(payload?.channels);

    const totalGross = series.gross.reduce((sum, value) => sum + value, 0);
    const daysCount = series.gross.length || 1;
    const avgGross = totalGross / daysCount;
    const peakGross = Math.max(...series.gross, 0);
    const peakIndex = series.gross.indexOf(peakGross);
    const peakLabel = peakIndex >= 0 && series.labels?.length ? series.labels[peakIndex] : '-';

    if (elements.dailyTotal) elements.dailyTotal.textContent = formatCurrency(totalGross);
    if (elements.dailyAvg) elements.dailyAvg.textContent = formatCurrency(avgGross);
    if (elements.dailyPeak) elements.dailyPeak.textContent = formatCurrency(peakGross);
    if (elements.dailyPeakLabel) elements.dailyPeakLabel.textContent = peakLabel;

    const avgOrders = series.orders.reduce((sum, value) => sum + value, 0) / daysCount;
    const peakOrders = Math.max(...series.orders, 0);
    if (elements.ordersAvg) elements.ordersAvg.textContent = formatNumber(avgOrders);
    if (elements.ordersPeak) elements.ordersPeak.textContent = `Pico: ${formatNumber(peakOrders)}`;
    renderSparkline(elements.ordersSparkline, series.orders, {
      stroke: '#6366f1',
      fill: 'rgba(99, 102, 241, 0.15)',
    });

    const avgTicket = series.ticket.reduce((sum, value) => sum + value, 0) / daysCount;
    const peakTicket = Math.max(...series.ticket, 0);
    if (elements.ticketAvg) elements.ticketAvg.textContent = formatCurrency(avgTicket);
    if (elements.ticketPeak) elements.ticketPeak.textContent = `Pico: ${formatCurrency(peakTicket)}`;
    renderSparkline(elements.ticketSparkline, series.ticket, {
      stroke: '#0ea5e9',
      fill: 'rgba(14, 165, 233, 0.18)',
    });
  };

  const buildStatusBadge = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (['pending', 'pendente'].includes(normalized)) {
      return '<span class="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"><i class="fas fa-circle text-[8px]"></i>Pendente</span>';
    }
    if (['cancelled', 'canceled', 'cancelado'].includes(normalized)) {
      return '<span class="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"><i class="fas fa-circle text-[8px]"></i>Cancelado</span>';
    }
    if (['refunded', 'estornado'].includes(normalized)) {
      return '<span class="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700"><i class="fas fa-circle text-[8px]"></i>Estornado</span>';
    }
    return '<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><i class="fas fa-circle text-[8px]"></i>Pago</span>';
  };

  const renderChannels = (channels) => {
    if (!elements.channelList) return;
    const list = Array.isArray(channels) ? channels : [];
    if (!list.length) {
      elements.channelList.innerHTML = '<p class="text-xs text-gray-500">Sem dados para este periodo.</p>';
      return;
    }
    elements.channelList.innerHTML = list
      .map((channel) => {
        const percent = Math.round((channel.share || 0) * 100);
        return `
          <div class="space-y-1">
            <div class="flex items-center justify-between text-sm text-gray-700">
              <span class="font-semibold">${channel.label}</span>
              <span class="text-xs text-gray-500">${formatNumber(channel.orders)} pedidos</span>
            </div>
            <div class="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div class="h-full rounded-full bg-primary" style="width: ${percent}%"></div>
            </div>
            <div class="flex items-center justify-between text-xs text-gray-500">
              <span>${formatCurrency(channel.gross)}</span>
              <span>${percent}% do faturamento</span>
            </div>
          </div>
        `;
      })
      .join('');
  };

  const renderHealth = (health) => {
    if (!elements.healthList) return;
    const list = Array.isArray(health) ? health : [];
    if (!list.length) {
      elements.healthList.innerHTML = '<p class="text-xs text-gray-500">Sem indicadores disponiveis.</p>';
      return;
    }
    elements.healthList.innerHTML = list
      .map((item) => {
        const value = Number.isFinite(item.value) ? item.value : 0;
        const display =
          item.display ||
          (item.suffix === '%'
            ? `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
            : `${value}${item.suffix || ''}`);
        return `
          <div class="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div>
              <p class="text-xs text-gray-500">${item.label}</p>
              <p class="text-sm font-semibold text-gray-800">${display}</p>
            </div>
            <span class="text-xs font-semibold text-gray-500">${item.note || ''}</span>
          </div>
        `;
      })
      .join('');
  };

  const renderCustomers = (customers) => {
    if (!elements.customersBody) return;
    const list = Array.isArray(customers) ? customers : [];
    if (!list.length) {
      elements.customersBody.innerHTML =
        '<tr><td colspan="5" class="px-3 py-4 text-center text-xs text-gray-500">Sem clientes no periodo.</td></tr>';
      return;
    }
    elements.customersBody.innerHTML = list
      .map(
        (customer) => `
        <tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-semibold text-gray-800">${customer.name}</td>
          <td class="px-3 py-2 text-right">${formatNumber(customer.orders)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(customer.total)}</td>
          <td class="px-3 py-2">${formatDateTime(customer.last)}</td>
          <td class="px-3 py-2">${customer.channel || '-'}</td>
        </tr>
      `
      )
      .join('');
  };

  const renderProducts = (products) => {
    if (!elements.productsBody) return;
    const list = Array.isArray(products) ? products : [];
    if (!list.length) {
      elements.productsBody.innerHTML =
        '<tr><td colspan="6" class="px-3 py-4 text-center text-xs text-gray-500">Sem produtos no periodo.</td></tr>';
      return;
    }
    elements.productsBody.innerHTML = list
      .map(
        (product) => `
        <tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-semibold text-gray-800">${product.name}</td>
          <td class="px-3 py-2">${product.category || '-'}</td>
          <td class="px-3 py-2 text-right">${formatNumber(product.qty)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(product.gross)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(product.discount)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(product.net)}</td>
        </tr>
      `
      )
      .join('');
  };

  const renderPets = (pets) => {
    if (!elements.petsBody) return;
    const list = Array.isArray(pets) ? pets : [];
    if (!list.length) {
      elements.petsBody.innerHTML =
        '<tr><td colspan="5" class="px-3 py-4 text-center text-xs text-gray-500">Sem pets recorrentes no periodo.</td></tr>';
      return;
    }
    elements.petsBody.innerHTML = list
      .map(
        (pet) => `
        <tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-semibold text-gray-800">${pet.name}</td>
          <td class="px-3 py-2">${pet.customer || '-'}</td>
          <td class="px-3 py-2 text-right">${formatNumber(pet.orders)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(pet.total)}</td>
          <td class="px-3 py-2">${formatDateTime(pet.last)}</td>
        </tr>
      `
      )
      .join('');
  };

  const renderPayments = (payments) => {
    if (!elements.paymentsBody) return;
    const list = Array.isArray(payments) ? payments : [];
    if (!list.length) {
      elements.paymentsBody.innerHTML =
        '<tr><td colspan="6" class="px-3 py-4 text-center text-xs text-gray-500">Sem dados de pagamento.</td></tr>';
      return;
    }
    elements.paymentsBody.innerHTML = list
      .map(
        (payment) => `
        <tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-semibold text-gray-800">${payment.label}</td>
          <td class="px-3 py-2 text-right">${formatNumber(payment.orders)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(payment.gross)}</td>
          <td class="px-3 py-2 text-right">${formatPercent(payment.feeRate, 2)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(payment.fee)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(payment.net)}</td>
        </tr>
      `
      )
      .join('');
  };

  const renderTaxes = (taxes) => {
    if (!elements.taxesList) return;
    const list = Array.isArray(taxes) ? taxes : [];
    if (!list.length) {
      elements.taxesList.innerHTML = '<p class="text-xs text-gray-500">Sem deducoes cadastradas.</p>';
      return;
    }
    const total = list.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0);
    const content = list
      .map(
        (item) => `
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-gray-800">${item.label}</p>
            <p class="text-xs text-gray-500">${item.note || ''}</p>
          </div>
          <span class="text-sm font-semibold text-gray-700">${formatCurrency(item.value)}</span>
        </div>
      `
      )
      .join('');
    elements.taxesList.innerHTML = `
      <div class="space-y-3">${content}</div>
      <div class="flex items-center justify-between border-t border-gray-100 pt-3 mt-3 text-sm font-semibold text-gray-800">
        <span>Total de deducoes</span>
        <span>${formatCurrency(total)}</span>
      </div>
    `;
  };

  const renderNotes = (notes) => {
    if (!elements.notesList) return;
    const list = Array.isArray(notes) ? notes : [];
    if (!list.length) {
      elements.notesList.innerHTML = '<li class="text-xs text-gray-500">Sem observacoes.</li>';
      return;
    }
    elements.notesList.innerHTML = list
      .map((note) => `<li class="flex items-start gap-2"><i class="fas fa-circle text-[6px] text-primary mt-1.5"></i>${note}</li>`)
      .join('');
  };

  const renderAlerts = (alerts) => {
    if (!elements.alertsList) return;
    const list = Array.isArray(alerts) ? alerts : [];
    if (!list.length) {
      elements.alertsList.innerHTML = '<p class="text-xs text-gray-500">Nenhum alerta para este periodo.</p>';
      return;
    }
    elements.alertsList.innerHTML = list
      .map(
        (alert) => `
        <div class="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div>
            <p class="text-xs text-gray-500">${alert.label}</p>
            <p class="text-lg font-semibold text-gray-800">${formatNumber(alert.value)}</p>
            <p class="text-xs text-gray-500">${alert.hint || ''}</p>
          </div>
          <span class="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <i class="fas fa-bell"></i>Atencao
          </span>
        </div>
      `
      )
      .join('');
  };

  const renderNextSteps = (steps) => {
    if (!elements.nextSteps) return;
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) {
      elements.nextSteps.innerHTML = '<li class="text-xs text-gray-500">Sem sugestoes no momento.</li>';
      return;
    }
    elements.nextSteps.innerHTML = list
      .map((step) => `<li class="flex items-start gap-2"><i class="fas fa-check-circle text-primary mt-1"></i>${step}</li>`)
      .join('');
  };

  const renderSales = (sales) => {
    if (!elements.salesBody) return;
    const list = Array.isArray(sales) ? sales : [];
    let total = 0;
    let totalDiscount = 0;
    let totalFee = 0;
    let totalNet = 0;

    if (!list.length) {
      elements.salesBody.innerHTML =
        '<tr><td colspan="10" class="px-3 py-4 text-center text-xs text-gray-500">Nenhuma venda encontrada.</td></tr>';
    } else {
      elements.salesBody.innerHTML = list
        .map((sale) => {
          total += sale.gross || 0;
          totalDiscount += sale.discount || 0;
          totalFee += sale.fee || 0;
          totalNet += sale.net || 0;
          return `
          <tr class="hover:bg-gray-50">
            <td class="px-3 py-2">${formatDateTime(sale.date)}</td>
            <td class="px-3 py-2 font-semibold text-gray-800">${sale.order}</td>
            <td class="px-3 py-2">${sale.customer}</td>
            <td class="px-3 py-2">${sale.channel}</td>
            <td class="px-3 py-2">${sale.payment}</td>
            <td class="px-3 py-2 text-right">${formatCurrency(sale.gross)}</td>
            <td class="px-3 py-2 text-right">${formatCurrency(sale.discount)}</td>
            <td class="px-3 py-2 text-right">${formatCurrency(sale.fee)}</td>
            <td class="px-3 py-2 text-right">${formatCurrency(sale.net)}</td>
            <td class="px-3 py-2 text-right">${buildStatusBadge(sale.status)}</td>
          </tr>
        `;
        })
        .join('');
    }

    if (elements.salesTotal) elements.salesTotal.textContent = formatCurrency(total);
    if (elements.salesDiscount) elements.salesDiscount.textContent = formatCurrency(totalDiscount);
    if (elements.salesFee) elements.salesFee.textContent = formatCurrency(totalFee);
    if (elements.salesNet) elements.salesNet.textContent = formatCurrency(totalNet);
    if (elements.salesCount) {
      elements.salesCount.innerHTML = `<i class="fas fa-list"></i>${formatNumber(list.length)} vendas no periodo`;
    }
  };

  const renderData = (payload) => {
    const summary = payload?.summary || {};
    const trends = payload?.trends || {};
    const period = payload?.period || {};
    const goal = payload?.goal || {};
    const customers = payload?.customers || {};
    const comparison = payload?.comparison || {};

    if (elements.periodLabel) {
      elements.periodLabel.innerHTML = `<i class="fas fa-calendar"></i>Periodo de Visualizacao: ${period?.view?.label || '-'}`;
    }
    if (elements.compare) {
      elements.compare.innerHTML = `<i class="fas fa-chart-line"></i>Periodo de Comparacao: ${period?.compare?.label || '-'}`;
    }
    if (elements.updated) {
      elements.updated.innerHTML = `<i class="fas fa-circle text-[8px]"></i>Atualizado: ${formatDateTime(new Date())}`;
    }

    if (elements.metricGross) elements.metricGross.textContent = formatCurrency(summary.gross);
    if (elements.metricNet) {
      elements.metricNet.textContent = formatCurrency(
        Number.isFinite(summary.billingNet) ? summary.billingNet : summary.net
      );
    }
    if (elements.metricTicket) elements.metricTicket.textContent = formatCurrency(summary.avgTicket);
    if (elements.metricOrders) elements.metricOrders.textContent = formatNumber(summary.orders);
    if (elements.metricDiscounts) elements.metricDiscounts.textContent = formatCurrency(summary.discounts);
    if (elements.metricFees) elements.metricFees.textContent = formatCurrency(summary.fees);
    if (elements.metricRefunds) elements.metricRefunds.textContent = formatCurrency(summary.refunds);
    if (elements.metricProfit) {
      const profit = Number.isFinite(summary.profit) ? summary.profit : (summary.net || 0) - (summary.costs || 0);
      elements.metricProfit.textContent = formatCurrency(profit);
    }

    setCurrencyReference(elements.trendGross, summary.gross, comparison.gross);
    setCurrencyReference(
      elements.trendNet,
      Number.isFinite(summary.billingNet) ? summary.billingNet : summary.net,
      comparison.billingNet
    );
    setCurrencyReference(elements.trendTicket, summary.avgTicket, comparison.avgTicket);
    setCountReference(elements.trendOrders, summary.orders, comparison.orders);
    setCurrencyReference(elements.trendDiscounts, summary.discounts, comparison.discounts, { invert: true });
    setCurrencyReference(elements.trendFees, summary.fees, comparison.fees, { invert: true });
    setCurrencyReference(elements.trendRefunds, summary.refunds, comparison.refunds, { invert: true });
    setCurrencyReference(
      elements.trendProfit,
      Number.isFinite(summary.profit) ? summary.profit : (summary.net || 0) - (summary.costs || 0),
      comparison.profit
    );

    const target = Number.isFinite(goal.target) ? goal.target : 0;
    const achieved = Number.isFinite(summary.gross) ? summary.gross : 0;
    const projection = Number.isFinite(goal.projection) ? goal.projection : achieved;
    const progress = target > 0 ? Math.min(achieved / target, 1) : 0;

    if (elements.goalTarget) elements.goalTarget.textContent = formatCurrency(target);
    if (elements.goalAchieved) elements.goalAchieved.textContent = `${formatCurrency(achieved)} realizado`;
    if (elements.goalPercent) elements.goalPercent.textContent = `${Math.round(progress * 100)}% atingido`;
    if (elements.goalProgress) elements.goalProgress.style.width = `${Math.round(progress * 100)}%`;
    if (elements.goalBadge) {
      elements.goalBadge.innerHTML = `<i class="fas fa-bullseye"></i>Meta ${Math.round(progress * 100)}%`;
    }
    if (elements.projection) elements.projection.textContent = formatCurrency(projection);
    if (elements.activeCustomers) elements.activeCustomers.textContent = formatNumber(customers.active);
    if (elements.itemsSold) elements.itemsSold.textContent = formatNumber(payload?.itemsSold || 0);

    renderChannels(payload?.channels);
    renderHealth(payload?.health);
    renderCustomers(payload?.topCustomers);
    renderPets(payload?.topPets);
    renderProducts(payload?.topProducts);
    renderPayments(payload?.paymentMethods);
    renderTaxes(payload?.taxes);
    renderNotes(payload?.notes);
    renderAlerts(payload?.alerts);
    renderNextSteps(payload?.nextSteps);
    renderSales(payload?.sales);
    renderBillingCharts(payload);
  };

  const fetchBilling = async () => {
    const params = new URLSearchParams();
    const viewValue = elements.monthView?.value || '';
    const compareValue = elements.monthCompare?.value || '';
    const companyCode = (elements.companyCode?.value || '').trim();
    const selectedCompanyId = state.selectedCompany?._id ? String(state.selectedCompany._id) : '';
    const selectedPdvId = (elements.pdvSelect?.value || '').trim();

    if (viewValue) params.set('viewMonth', viewValue);
    if (compareValue) params.set('compareMonth', compareValue);
    if (selectedCompanyId) params.set('storeId', selectedCompanyId);
    else if (companyCode) params.set('companyCode', companyCode);
    if (selectedPdvId) params.set('pdvId', selectedPdvId);

    const token = getToken();

    const response = await fetch(`${API_BASE}/reports/billing?${params.toString()}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || 'Erro ao carregar faturamento.');
    }

    renderData(payload);
  };

  const setDefaultMonths = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const current = `${year}-${month}`;
    const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prev = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    if (elements.monthView) elements.monthView.value = current;
    if (elements.monthCompare) elements.monthCompare.value = prev;
  };

  const bindEvents = () => {
    const safeFetch = () => {
      fetchBilling().catch((error) => {
        console.error('billing:fetch', error);
      });
    };

    const handleCompanyInput = async () => {
      const rawValue = (elements.companyCode?.value || '').trim();
      if (!rawValue) {
        setSelectedCompany(null, { syncInput: false });
        clearPdvs();
        safeFetch();
        return;
      }

      await loadAllowedCompanies();

      if (/[A-Za-z]/.test(rawValue)) {
        openCompanyModal(rawValue);
        return;
      }

      const match = findCompanyByCode(rawValue);
      if (match) {
        setSelectedCompany(match);
        await loadPdvsForSelectedCompany();
        safeFetch();
        return;
      }

      setSelectedCompany(null, { syncInput: false });
      clearPdvs();
    };

    elements.monthView?.addEventListener('change', safeFetch);
    elements.monthCompare?.addEventListener('change', safeFetch);
    elements.pdvSelect?.addEventListener('change', safeFetch);
    elements.companyCode?.addEventListener('change', () => {
      handleCompanyInput().catch((error) => {
        console.error('billing:company-change', error);
      });
    });
    elements.companyCode?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      handleCompanyInput().catch((error) => {
        console.error('billing:company-enter', error);
      });
    });
    elements.companyCode?.addEventListener('input', () => {
      const rawValue = (elements.companyCode?.value || '').trim();
      if (!rawValue) {
        setSelectedCompany(null, { syncInput: false });
        clearPdvs();
        return;
      }
      if (/[A-Za-z]/.test(rawValue)) {
        loadAllowedCompanies()
          .then(() => openCompanyModal(rawValue))
          .catch((error) => console.error('billing:company-search', error));
      }
    });

    elements.companyModalClose?.addEventListener('click', closeCompanyModal);
    elements.companyModal?.addEventListener('click', (event) => {
      if (event.target === elements.companyModal) {
        closeCompanyModal();
      }
    });
    elements.companyModalSearch?.addEventListener('input', (event) => {
      renderCompanyResults(event.currentTarget?.value || '');
    });
    elements.companyModalSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeCompanyModal();
      }
    });
    elements.companyModalResults?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-billing-company-id]');
      if (!button) return;
      const companyId = button.getAttribute('data-billing-company-id');
      const company = state.companies.find((entry) => String(entry?._id || '') === String(companyId || ''));
      if (!company) return;
      setSelectedCompany(company);
      closeCompanyModal();
      loadPdvsForSelectedCompany()
        .then(() => safeFetch())
        .catch((error) => {
          console.error('billing:pdvs', error);
          safeFetch();
        });
    });
  };

  const init = () => {
    setDefaultMonths();
    bindEvents();
    loadAllowedCompanies()
      .then(() => {
        const rawValue = (elements.companyCode?.value || '').trim();
        if (rawValue) {
          const match = findCompanyByCode(rawValue);
          if (match) {
            setSelectedCompany(match);
            return loadPdvsForSelectedCompany();
          }
        }

        const defaultCompany = getDefaultCompany();
        if (defaultCompany) {
          setSelectedCompany(defaultCompany);
          return loadPdvsForSelectedCompany();
        }
      })
      .catch((error) => {
        console.error('billing:companies', error);
      })
      .finally(() => {
        fetchBilling().catch((error) => {
          console.error('billing:fetch', error);
        });
      });
  };

  document.addEventListener('DOMContentLoaded', init);
})();
