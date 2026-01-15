(() => {
  const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) || '/api';

  const elements = {
    monthView: document.getElementById('billing-month-view'),
    monthCompare: document.getElementById('billing-month-compare'),
    companyCode: document.getElementById('billing-company-code'),
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
        const display = item.display || `${value}${item.suffix || ''}`;
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
        '<tr><td colspan="6" class="px-3 py-4 text-center text-xs text-gray-500">Sem clientes no periodo.</td></tr>';
      return;
    }
    elements.customersBody.innerHTML = list
      .map(
        (customer) => `
        <tr class="hover:bg-gray-50">
          <td class="px-3 py-2 font-semibold text-gray-800">${customer.name}</td>
          <td class="px-3 py-2 text-right">${formatNumber(customer.orders)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(customer.total)}</td>
          <td class="px-3 py-2 text-right">${formatCurrency(customer.ticket)}</td>
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
    if (elements.metricNet) elements.metricNet.textContent = formatCurrency(summary.net);
    if (elements.metricTicket) elements.metricTicket.textContent = formatCurrency(summary.avgTicket);
    if (elements.metricOrders) elements.metricOrders.textContent = formatNumber(summary.orders);
    if (elements.metricDiscounts) elements.metricDiscounts.textContent = formatCurrency(summary.discounts);
    if (elements.metricFees) elements.metricFees.textContent = formatCurrency(summary.fees);
    if (elements.metricRefunds) elements.metricRefunds.textContent = formatCurrency(summary.refunds);
    if (elements.metricProfit) {
      const profit = (summary.net || 0) - (summary.costs || 0);
      elements.metricProfit.textContent = formatCurrency(profit);
    }

    setTrend(elements.trendGross, trends.gross);
    setTrend(elements.trendNet, trends.net);
    setTrend(elements.trendTicket, trends.ticket);
    setTrend(elements.trendOrders, trends.orders);
    setTrend(elements.trendDiscounts, trends.discounts);
    setTrend(elements.trendFees, trends.fees);
    setTrend(elements.trendRefunds, trends.refunds);
    setTrend(elements.trendProfit, trends.profit);

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
    renderProducts(payload?.topProducts);
    renderPayments(payload?.paymentMethods);
    renderTaxes(payload?.taxes);
    renderNotes(payload?.notes);
    renderAlerts(payload?.alerts);
    renderNextSteps(payload?.nextSteps);
    renderSales(payload?.sales);
  };

  const fetchBilling = async () => {
    const params = new URLSearchParams();
    const viewValue = elements.monthView?.value || '';
    const compareValue = elements.monthCompare?.value || '';
    const companyCode = (elements.companyCode?.value || '').trim();

    if (viewValue) params.set('viewMonth', viewValue);
    if (compareValue) params.set('compareMonth', compareValue);
    if (companyCode) params.set('companyCode', companyCode);

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
    elements.monthView?.addEventListener('change', safeFetch);
    elements.monthCompare?.addEventListener('change', safeFetch);
    elements.companyCode?.addEventListener('change', safeFetch);
  };

  const init = () => {
    setDefaultMonths();
    bindEvents();
    fetchBilling().catch((error) => {
      console.error('billing:fetch', error);
    });
  };

  document.addEventListener('DOMContentLoaded', init);
})();
