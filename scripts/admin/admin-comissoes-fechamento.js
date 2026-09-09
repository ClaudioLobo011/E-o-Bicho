(function () {
  'use strict';

  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const state = {
    currentMonth: new Date(),
    stores: [],
    professionals: [],
    report: { items: [], history: [], summary: {}, anomalies: {} },
    filteredItems: [],
    reportRequest: 0,
    professionalsRequest: 0,
    previewRequest: 0,
    configRequest: 0,
    currentPreview: null,
    currentDetail: null,
    currentPayment: null,
    currentCancellation: null,
    sort: { key: 'profissionalNome', direction: 'asc' },
    modalStack: [],
    lastFocus: null,
    previewTimer: null,
  };

  const el = (id) => document.getElementById(id);
  const numberValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatMoney = (value) => currency.format(numberValue(value));

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function authHeaders() {
    try {
      const token = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || `Falha na requisição (${response.status}).`);
      error.status = response.status;
      error.code = payload?.code || '';
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showFeedback(message, type = 'info') {
    const node = el('screen-feedback');
    if (!node) return;
    const styles = {
      info: 'border-blue-200 bg-blue-50 text-blue-800',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      error: 'border-red-200 bg-red-50 text-red-800',
    };
    node.className = `rounded-xl border px-4 py-3 text-sm ${styles[type] || styles.info}`;
    node.textContent = message;
    node.classList.remove('hidden');
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function clearFeedback() {
    const node = el('screen-feedback');
    if (!node) return;
    node.textContent = '';
    node.classList.add('hidden');
  }

  function setButtonBusy(button, busy, busyLabel = 'Processando...') {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(busyLabel)}</span>`;
    } else {
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
      button.disabled = false;
    }
  }

  function formatInputDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatInputTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function toYmd(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }

  function formatDate(value) {
    const key = toYmd(value);
    if (!key) return '--';
    const [year, month, day] = key.split('-');
    return `${day}/${month}/${year}`;
  }

  function formatPeriod(start, end) {
    const from = formatDate(start);
    const to = formatDate(end);
    return from === to ? from : `${from} a ${to}`;
  }

  function formatMonthLabel(date) {
    return date
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      .replace(/^./, (character) => character.toUpperCase());
  }

  function setPeriodDefaults(reference = new Date()) {
    const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
    const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
    state.currentMonth = start;
    if (el('filtro-inicio')) el('filtro-inicio').value = formatInputDate(start);
    if (el('filtro-fim')) el('filtro-fim').value = formatInputDate(end);
    updateMonthLabel();
  }

  function updateMonthLabel() {
    if (el('mes-label')) el('mes-label').textContent = formatMonthLabel(state.currentMonth);
  }

  function getPeriod({ showError = false } = {}) {
    const start = toYmd(el('filtro-inicio')?.value);
    const end = toYmd(el('filtro-fim')?.value);
    const startInput = el('filtro-inicio');
    const endInput = el('filtro-fim');
    const valid = Boolean(start && end && start <= end);
    [startInput, endInput].forEach((input) => input?.setAttribute('aria-invalid', valid ? 'false' : 'true'));
    if (!valid && showError) showFeedback('Informe um período válido: a data inicial não pode ser posterior à final.', 'error');
    return valid ? { start, end } : null;
  }

  function setSelectOptions(select, options, { placeholder = 'Selecione', valueKey = 'id', labelKey = 'nome' } = {}) {
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    if (placeholder !== null) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.appendChild(option);
    }
    options.forEach((item) => {
      const value = String(item?.[valueKey] ?? '');
      if (!value) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = String(item?.[labelKey] ?? 'Sem nome');
      select.appendChild(option);
    });
    if (previous && options.some((item) => String(item?.[valueKey]) === previous)) select.value = previous;
  }

  function statusBadge(status, overdue = false) {
    const normalized = String(status || '').toLowerCase();
    const map = {
      pago: ['Pago', 'bg-emerald-50 text-emerald-700'],
      agendado: [overdue ? 'Agendado vencido' : 'Agendado', overdue ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'],
      pendente: ['Pendente', 'bg-amber-50 text-amber-700'],
      em_aberto: ['Em aberto', 'bg-gray-100 text-gray-700'],
      reconciliacao: ['Requer revisão', 'bg-red-50 text-red-700'],
      cancelado: ['Cancelado', 'bg-gray-100 text-gray-500'],
    };
    const [label, classes] = map[normalized] || [normalized || 'Status', 'bg-gray-100 text-gray-600'];
    return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${classes}"><i class="fas fa-circle text-[7px]" aria-hidden="true"></i>${escapeHtml(label)}</span>`;
  }

  function paymentLabel(item) {
    if (item.status === 'pago' && item.paidDate) {
      return `<p class="font-medium text-emerald-700">${escapeHtml(item.meioPagamento || 'Pago')}</p><p class="text-xs text-gray-500">${escapeHtml(formatDate(item.paidDate))}${item.paidTime ? ` ${escapeHtml(item.paidTime)}` : ''}</p>`;
    }
    if (item.previsaoPagamentoData) {
      return `<p class="font-medium ${item.overdue ? 'text-red-700' : 'text-gray-700'}">${escapeHtml(item.meioPagamento || 'Agendado')}</p><p class="text-xs ${item.overdue ? 'text-red-600' : 'text-gray-500'}">Prev.: ${escapeHtml(formatDate(item.previsaoPagamentoData))}${item.previsaoPagamentoHora ? ` ${escapeHtml(item.previsaoPagamentoHora)}` : ''}</p>`;
    }
    return '<span class="text-gray-400">--</span>';
  }

  function actionButtons(item, { history = false } = {}) {
    const id = String(item.closingId || item.id || '');
    const buttons = [
      `<button type="button" class="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50" data-action="details" data-id="${escapeHtml(id)}" data-profissional="${escapeHtml(item.profissional || '')}" data-history="${history ? '1' : '0'}"><i class="fas fa-list-check mr-1" aria-hidden="true"></i>Detalhes</button>`,
    ];
    if (!history && item.canClose) {
      buttons.push(`<button type="button" class="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90" data-action="close" data-profissional="${escapeHtml(item.profissional || '')}"><i class="fas fa-lock mr-1" aria-hidden="true"></i>${item.adjustment ? 'Fechar ajuste' : 'Fechar'}</button>`);
    }
    if ((history && ['pendente', 'agendado'].includes(item.status)) || (!history && item.canPay)) {
      buttons.push(`<button type="button" class="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50" data-action="pay" data-id="${escapeHtml(id)}"><i class="fas fa-money-check-alt mr-1" aria-hidden="true"></i>Pagar</button>`);
    }
    if ((history && item.status !== 'cancelado') || (!history && item.canCancel)) {
      buttons.push(`<button type="button" class="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50" data-action="cancel" data-id="${escapeHtml(id)}"><i class="fas fa-ban mr-1" aria-hidden="true"></i>Cancelar</button>`);
    }
    return `<div class="flex flex-wrap gap-2">${buttons.join('')}</div>`;
  }

  function sortItems(items) {
    const { key, direction } = state.sort;
    return items.slice().sort((left, right) => {
      const a = left?.[key];
      const b = right?.[key];
      let comparison = 0;
      if (['totalPeriodo', 'totalPago', 'totalPendente'].includes(key)) {
        comparison = numberValue(a) - numberValue(b);
      } else {
        comparison = String(a || '').localeCompare(String(b || ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
      }
      return direction === 'desc' ? -comparison : comparison;
    });
  }

  function renderReportRows(items) {
    const sorted = sortItems(items);
    const tbody = el('fechamento-tbody');
    const mobile = el('report-mobile-list');
    if (!tbody || !mobile) return;
    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-500">Nenhuma comissão encontrada com os filtros atuais.</td></tr>';
      mobile.innerHTML = '<p class="px-4 py-8 text-center text-sm text-gray-500">Nenhuma comissão encontrada.</p>';
      if (el('fechamento-contagem')) el('fechamento-contagem').textContent = '0 registros';
      return;
    }

    tbody.innerHTML = sorted
      .map((item) => {
        const warning = item.needsReconciliation
          ? `<p class="mt-1 max-w-xs text-xs text-red-600">${escapeHtml(item.reconciliationReason)}</p>`
          : item.alreadyClosedItems
            ? `<p class="mt-1 text-xs text-gray-500">${numberValue(item.alreadyClosedItems)} item(ns) já congelado(s)</p>`
            : '';
        return `<tr class="align-top hover:bg-gray-50">
          <td class="px-4 py-3"><p class="font-semibold text-gray-900">${escapeHtml(item.profissionalNome || '--')}</p><p class="text-xs text-gray-500">Cód. ${escapeHtml(item.codigoProfissional || '--')}</p>${warning}</td>
          <td class="px-4 py-3">${escapeHtml(item.tipo || '--')}</td>
          <td class="whitespace-nowrap px-4 py-3">${escapeHtml(item.periodo || formatPeriod(item.periodoInicio, item.periodoFim))}</td>
          <td class="whitespace-nowrap px-4 py-3 text-right font-semibold" data-sort-value="${numberValue(item.totalPeriodo)}">${formatMoney(item.totalPeriodo)}</td>
          <td class="whitespace-nowrap px-4 py-3 text-right font-semibold" data-sort-value="${numberValue(item.totalPago)}">${formatMoney(item.totalPago)}</td>
          <td class="px-4 py-3">${statusBadge(item.status, item.overdue)}</td>
          <td class="px-4 py-3">${paymentLabel(item)}</td>
          <td class="px-4 py-3">${actionButtons(item)}</td>
        </tr>`;
      })
      .join('');

    mobile.innerHTML = sorted
      .map((item) => `<article class="space-y-3 px-4 py-4">
        <div class="flex items-start justify-between gap-3"><div><h3 class="font-semibold text-gray-900">${escapeHtml(item.profissionalNome || '--')}</h3><p class="text-xs text-gray-500">${escapeHtml(item.tipo || '--')} · ${escapeHtml(item.periodo || formatPeriod(item.periodoInicio, item.periodoFim))}</p></div>${statusBadge(item.status, item.overdue)}</div>
        ${item.needsReconciliation ? `<p class="rounded-lg bg-red-50 p-2 text-xs text-red-700">${escapeHtml(item.reconciliationReason)}</p>` : ''}
        <dl class="grid grid-cols-2 gap-2 text-sm"><div class="rounded-lg bg-gray-50 p-2"><dt class="text-xs text-gray-500">Comissão</dt><dd class="font-semibold">${formatMoney(item.totalPeriodo)}</dd></div><div class="rounded-lg bg-gray-50 p-2"><dt class="text-xs text-gray-500">Já fechada/paga</dt><dd class="font-semibold">${formatMoney(item.totalPago)}</dd></div></dl>
        <div class="text-sm">${paymentLabel(item)}</div>${actionButtons(item)}
      </article>`)
      .join('');
    if (el('fechamento-contagem')) el('fechamento-contagem').textContent = `${sorted.length} registro(s)`;
  }

  function renderKpis() {
    const summary = state.report.summary || {};
    if (el('kpi-total-previsto')) el('kpi-total-previsto').textContent = formatMoney(summary.totalExpected);
    if (el('kpi-pagos')) el('kpi-pagos').textContent = formatMoney(summary.paymentsMade);
    if (el('kpi-receber')) el('kpi-receber').textContent = formatMoney(summary.outstanding);
    const last = summary.lastPaymentDate
      ? `${formatDate(summary.lastPaymentDate)}${summary.lastPaymentTime ? ` ${summary.lastPaymentTime}` : ''}`
      : '--';
    if (el('kpi-ultimo')) el('kpi-ultimo').textContent = last;
  }

  function renderAudit() {
    const panel = el('auditoria-panel');
    const list = el('auditoria-list');
    if (!panel || !list) return;
    const anomaly = state.report.anomalies || {};
    const lines = [];
    if (anomaly.missingConfiguration) lines.push('A empresa não possui conta contábil e/ou conta corrente configurada; novos fechamentos serão bloqueados com segurança.');
    if (numberValue(anomaly.reconciliationRows)) lines.push(`${numberValue(anomaly.reconciliationRows)} profissional(is) precisam de reconciliação por fechamento legado sobreposto.`);
    if (numberValue(anomaly.crossBoundary)) lines.push(`${numberValue(anomaly.crossBoundary)} fechamento(s) cruzam os limites escolhidos e foram excluídos dos totais estritos.`);
    if (numberValue(anomaly.legacyPeriods)) lines.push(`${numberValue(anomaly.legacyPeriods)} fechamento(s) ainda não possuem as datas literais migradas.`);
    if (numberValue(anomaly.missingPaidDate)) lines.push(`${numberValue(anomaly.missingPaidDate)} pagamento(s) legado(s) não têm data/hora real registrada e não entram em “Pagamentos realizados”.`);
    if (numberValue(anomaly.payableMismatch)) lines.push(`${numberValue(anomaly.payableMismatch)} fechamento(s) divergem de Contas a Pagar e requerem auditoria antes de qualquer correção histórica.`);
    if (numberValue(anomaly.overdue)) lines.push(`${numberValue(anomaly.overdue)} repasse(s) agendado(s) estão vencidos.`);
    list.replaceChildren();
    lines.forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    panel.classList.toggle('hidden', !lines.length);
  }

  function renderHistory() {
    const container = el('history-list');
    const count = el('history-count');
    if (!container) return;
    const history = Array.isArray(state.report.history) ? state.report.history : [];
    if (count) count.textContent = `(${history.length})`;
    if (!history.length) {
      container.innerHTML = '<p class="py-5 text-sm text-gray-500">Nenhum fechamento registrado que toque o período.</p>';
      return;
    }
    container.innerHTML = history
      .map((item) => `<article class="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
        <div><div class="flex flex-wrap items-center gap-2"><p class="font-semibold text-gray-900">${escapeHtml(item.profissionalNome || '--')}</p>${statusBadge(item.status, item.overdue)}${item.crossesSelection ? '<span class="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Cruza o período</span>' : ''}${item.legacyPeriod ? '<span class="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Legado</span>' : ''}</div><p class="mt-1 text-sm text-gray-500">${escapeHtml(item.periodo || formatPeriod(item.periodoInicio, item.periodoFim))} · ${escapeHtml(item.tipo || '--')} · ${escapeHtml(item.storeNome || '')}</p></div>
        <div class="text-sm lg:text-right"><p class="font-semibold">${formatMoney(item.totalPeriodo)}</p><p class="text-xs text-gray-500">Pago: ${formatMoney(item.totalPago)}</p></div>
        ${actionButtons(item, { history: true })}
      </article>`)
      .join('');
  }

  function applyLocalFilters() {
    const status = el('filtro-status')?.value || '';
    const search = normalizeSearch(el('filtro-busca')?.value);
    let items = Array.isArray(state.report.items) ? state.report.items.slice() : [];
    if (status === 'pendente') {
      items = items.filter((item) => ['pendente', 'em_aberto'].includes(String(item.status || '').toLowerCase()));
    } else if (status) {
      items = items.filter((item) => String(item.status || '').toLowerCase() === status);
    }
    if (search) {
      items = items.filter((item) =>
        [item.profissionalNome, item.codigoProfissional]
          .some((value) => normalizeSearch(value).includes(search)),
      );
    }
    state.filteredItems = items;
    renderReportRows(items);
  }

  function setReportLoading(loading) {
    el('report-loading')?.classList.toggle('hidden', !loading);
    el('report-table-wrap')?.classList.toggle('opacity-50', loading);
    if (el('btn-exportar')) el('btn-exportar').disabled = loading || !state.filteredItems.length;
  }

  async function loadReport() {
    const request = ++state.reportRequest;
    const period = getPeriod({ showError: true });
    const store = el('empresa-select')?.value || '';
    if (!period || !store) {
      if (!store) showFeedback('Selecione uma empresa para gerar o relatório.', 'warning');
      return;
    }
    clearFeedback();
    setReportLoading(true);
    try {
      const query = new URLSearchParams({ store, start: period.start, end: period.end });
      const report = await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/report?${query}`, {
        headers: authHeaders(),
      });
      if (request !== state.reportRequest) return;
      state.report = {
        items: Array.isArray(report.items) ? report.items : [],
        history: Array.isArray(report.history) ? report.history : [],
        summary: report.summary || {},
        anomalies: report.anomalies || {},
      };
      state.currentMonth = new Date(`${period.start}T12:00:00`);
      updateMonthLabel();
      renderKpis();
      renderAudit();
      renderHistory();
      applyLocalFilters();
    } catch (error) {
      if (request !== state.reportRequest) return;
      state.report = { items: [], history: [], summary: {}, anomalies: {} };
      applyLocalFilters();
      renderKpis();
      renderAudit();
      renderHistory();
      showFeedback(error.message || 'Não foi possível carregar o relatório.', 'error');
    } finally {
      if (request === state.reportRequest) setReportLoading(false);
    }
  }

  async function loadStores() {
    const select = el('empresa-select');
    try {
      const stores = await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/stores`, {
        headers: authHeaders(),
      });
      state.stores = Array.isArray(stores) ? stores : [];
      setSelectOptions(
        select,
        state.stores.map((store) => ({ id: store._id, nome: store.nome || 'Empresa' })),
        { placeholder: state.stores.length ? null : 'Nenhuma empresa disponível' },
      );
      if (select && state.stores.length && !select.value) select.value = String(state.stores[0]._id);
    } catch (error) {
      setSelectOptions(select, [], { placeholder: 'Erro ao carregar empresas' });
      showFeedback(error.message || 'Não foi possível carregar empresas.', 'error');
    }
  }

  async function loadProfessionals() {
    const request = ++state.professionalsRequest;
    const store = el('empresa-select')?.value || '';
    const select = el('fechamento-funcionario');
    if (!store) {
      state.professionals = [];
      setSelectOptions(select, [], { placeholder: 'Selecione uma empresa primeiro' });
      return;
    }
    try {
      const data = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/professionals?store=${encodeURIComponent(store)}`,
        { headers: authHeaders() },
      );
      if (request !== state.professionalsRequest) return;
      state.professionals = Array.isArray(data) ? data : [];
      setSelectOptions(select, state.professionals, { placeholder: 'Selecione' });
    } catch (error) {
      if (request !== state.professionalsRequest) return;
      state.professionals = [];
      setSelectOptions(select, [], { placeholder: 'Erro ao carregar profissionais' });
      showFeedback(error.message || 'Não foi possível carregar profissionais.', 'error');
    }
  }

  function modalFocusable(modal) {
    return Array.from(
      modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((node) => !node.classList.contains('hidden') && node.offsetParent !== null);
  }

  function openModal(id) {
    const modal = el(id);
    if (!modal) return;
    state.lastFocus = document.activeElement;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    state.modalStack = state.modalStack.filter((value) => value !== id);
    state.modalStack.push(id);
    window.setTimeout(() => {
      const focusable = modalFocusable(modal);
      (focusable[0] || modal.querySelector('[data-modal-panel]'))?.focus();
    }, 0);
  }

  function closeModal(id) {
    const modal = el(id);
    if (!modal) return;
    modal.classList.add('hidden');
    state.modalStack = state.modalStack.filter((value) => value !== id);
    if (!state.modalStack.length) document.body.classList.remove('overflow-hidden');
    if (state.lastFocus instanceof HTMLElement) state.lastFocus.focus();
  }

  function resetClosingForm() {
    state.currentPreview = null;
    ++state.previewRequest;
    if (el('fechamento-funcionario')) el('fechamento-funcionario').value = '';
    const period = getPeriod() || { start: '', end: '' };
    if (el('fechamento-inicio')) el('fechamento-inicio').value = period.start;
    if (el('fechamento-fim')) el('fechamento-fim').value = period.end;
    if (el('fechamento-prev')) el('fechamento-prev').value = '';
    if (el('fechamento-prev-hora')) el('fechamento-prev-hora').value = '';
    if (el('fechamento-meio')) el('fechamento-meio').value = '';
    if (el('fechamento-kpi-pendente')) el('fechamento-kpi-pendente').textContent = '--';
    if (el('fechamento-kpi-itens')) el('fechamento-kpi-itens').textContent = '--';
    if (el('fechamento-kpi-excluidos')) el('fechamento-kpi-excluidos').textContent = '--';
    if (el('fechamento-preview-status')) el('fechamento-preview-status').textContent = 'Selecione funcionário e período para conferir.';
    if (el('fechamento-salvar')) el('fechamento-salvar').disabled = true;
    if (el('fechamento-ver-detalhes')) el('fechamento-ver-detalhes').disabled = true;
  }

  function schedulePreview() {
    window.clearTimeout(state.previewTimer);
    ++state.previewRequest;
    state.previewTimer = window.setTimeout(updateClosingPreview, 250);
  }

  async function updateClosingPreview() {
    const request = ++state.previewRequest;
    const professional = el('fechamento-funcionario')?.value || '';
    const store = el('empresa-select')?.value || '';
    const start = toYmd(el('fechamento-inicio')?.value);
    const end = toYmd(el('fechamento-fim')?.value);
    const save = el('fechamento-salvar');
    const details = el('fechamento-ver-detalhes');
    state.currentPreview = null;
    if (save) save.disabled = true;
    if (details) details.disabled = true;
    if (!professional || !store || !start || !end || start > end) {
      if (el('fechamento-preview-status')) el('fechamento-preview-status').textContent = start && end && start > end ? 'Período inválido.' : 'Selecione funcionário e período para conferir.';
      return;
    }
    if (el('fechamento-preview-status')) el('fechamento-preview-status').innerHTML = '<i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>Conferindo itens...';
    try {
      const query = new URLSearchParams({ profissionalId: professional, store, start, end, details: '1' });
      const preview = await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/preview?${query}`, {
        headers: authHeaders(),
      });
      if (request !== state.previewRequest) return;
      state.currentPreview = preview;
      const itemCount = Array.isArray(preview.items) ? preview.items.length : 0;
      const excludedCount = Array.isArray(preview.eligibility?.exclusions) ? preview.eligibility.exclusions.length : 0;
      const total = numberValue(preview.totals?.totalPeriodo);
      if (el('fechamento-kpi-pendente')) el('fechamento-kpi-pendente').textContent = formatMoney(total);
      if (el('fechamento-kpi-itens')) el('fechamento-kpi-itens').textContent = String(itemCount);
      if (el('fechamento-kpi-excluidos')) el('fechamento-kpi-excluidos').textContent = String(excludedCount);
      if (el('fechamento-preview-status')) {
        el('fechamento-preview-status').textContent = total > 0
          ? `${itemCount} item(ns) novo(s) pronto(s) para congelar.${numberValue(preview.alreadyClosedItems) ? ` ${numberValue(preview.alreadyClosedItems)} já pertencem a outro fechamento.` : ''}`
          : 'Nenhum item novo finalizado, pago e com comissão positiva neste período.';
      }
      if (save) save.disabled = total <= 0 || itemCount <= 0;
      if (details) details.disabled = itemCount + excludedCount <= 0;
    } catch (error) {
      if (request !== state.previewRequest) return;
      if (el('fechamento-preview-status')) el('fechamento-preview-status').textContent = error.message || 'Falha ao conferir itens.';
    }
  }

  function openClosing(row = null) {
    resetClosingForm();
    if (row) {
      if (el('fechamento-funcionario')) el('fechamento-funcionario').value = String(row.profissional || '');
      if (el('fechamento-inicio')) el('fechamento-inicio').value = toYmd(row.periodoInicio);
      if (el('fechamento-fim')) el('fechamento-fim').value = toYmd(row.periodoFim);
    }
    openModal('modal-fechamento');
    updateClosingPreview();
  }

  async function saveClosing() {
    const button = el('fechamento-salvar');
    const professional = el('fechamento-funcionario')?.value || '';
    const store = el('empresa-select')?.value || '';
    const start = toYmd(el('fechamento-inicio')?.value);
    const end = toYmd(el('fechamento-fim')?.value);
    const paymentDate = toYmd(el('fechamento-prev')?.value);
    const paymentTime = el('fechamento-prev-hora')?.value || '';
    const paymentMethod = el('fechamento-meio')?.value || '';
    if (!professional || !store || !start || !end || start > end) {
      showFeedback('Confira empresa, funcionário e período antes de fechar.', 'error');
      return;
    }
    if ((paymentDate && !paymentTime) || (!paymentDate && paymentTime)) {
      showFeedback('Para agendar o pagamento, informe data e hora juntas.', 'error');
      return;
    }
    if (!state.currentPreview || numberValue(state.currentPreview.totals?.totalPeriodo) <= 0) {
      showFeedback('Atualize a conferência: não há saldo válido para fechar.', 'error');
      return;
    }
    setButtonBusy(button, true, 'Fechando...');
    try {
      await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profissionalId: professional,
          storeId: store,
          inicio: start,
          fim: end,
          previsaoPagamento: paymentDate || null,
          previsaoPagamentoData: paymentDate,
          previsaoPagamentoHora: paymentTime,
          meioPagamento: paymentMethod,
        }),
      });
      closeModal('modal-fechamento');
      showFeedback('Fechamento criado com os itens congelados e a conta a pagar sincronizada.', 'success');
      await loadReport();
    } catch (error) {
      showFeedback(error.message || 'Não foi possível criar o fechamento.', 'error');
    } finally {
      setButtonBusy(button, false);
      if (state.currentPreview) button.disabled = numberValue(state.currentPreview.totals?.totalPeriodo) <= 0;
    }
  }

  function findClosing(id) {
    const key = String(id || '');
    return (
      state.report.history.find((item) => String(item.id) === key) ||
      state.report.items.find((item) => String(item.closingId || item.id) === key) ||
      null
    );
  }

  function findReportRowByProfessional(id) {
    return state.report.items.find((item) => String(item.profissional) === String(id)) || null;
  }

  function openPayment(item) {
    if (!item?.id && !item?.closingId) return;
    state.currentPayment = item;
    const now = new Date();
    if (el('pagamento-profissional')) el('pagamento-profissional').textContent = item.profissionalNome || '--';
    if (el('pagamento-periodo')) el('pagamento-periodo').textContent = item.periodo || formatPeriod(item.periodoInicio, item.periodoFim);
    if (el('pagamento-valor')) el('pagamento-valor').textContent = formatMoney(item.totalPendente || item.totalPeriodo);
    if (el('pagamento-data')) el('pagamento-data').value = formatInputDate(now);
    if (el('pagamento-hora')) el('pagamento-hora').value = formatInputTime(now);
    if (el('pagamento-meio')) el('pagamento-meio').value = item.meioPagamento || '';
    if (el('pagamento-confirmar')) el('pagamento-confirmar').checked = false;
    if (el('pagamento-salvar')) el('pagamento-salvar').disabled = true;
    openModal('modal-pagamento');
  }

  function updatePaymentButton() {
    const valid = Boolean(
      el('pagamento-confirmar')?.checked &&
      toYmd(el('pagamento-data')?.value) &&
      el('pagamento-hora')?.value &&
      el('pagamento-meio')?.value,
    );
    if (el('pagamento-salvar')) el('pagamento-salvar').disabled = !valid;
  }

  async function savePayment() {
    const item = state.currentPayment;
    const id = String(item?.closingId || item?.id || '');
    if (!id) return;
    const button = el('pagamento-salvar');
    const paymentDate = toYmd(el('pagamento-data')?.value);
    const paymentTime = el('pagamento-hora')?.value || '';
    const paymentMethod = el('pagamento-meio')?.value || '';
    if (!el('pagamento-confirmar')?.checked || !paymentDate || !paymentTime || !paymentMethod) return;
    setButtonBusy(button, true, 'Registrando...');
    try {
      await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(id)}/pay`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          amount: numberValue(item.totalPeriodo),
          paymentDate,
          paymentTime,
          paymentMethod,
        }),
      });
      closeModal('modal-pagamento');
      state.currentPayment = null;
      showFeedback('Pagamento registrado com data/hora real e Contas a Pagar atualizado.', 'success');
      await loadReport();
    } catch (error) {
      showFeedback(error.message || 'Não foi possível registrar o pagamento.', 'error');
    } finally {
      setButtonBusy(button, false);
      updatePaymentButton();
    }
  }

  function openCancellation(item) {
    if (!item?.id && !item?.closingId) return;
    state.currentCancellation = item;
    if (el('cancelamento-contexto')) el('cancelamento-contexto').textContent = `${item.profissionalNome || '--'} · ${item.periodo || formatPeriod(item.periodoInicio, item.periodoFim)}`;
    if (el('cancelamento-motivo')) el('cancelamento-motivo').value = '';
    if (el('cancelamento-reverter-pago')) el('cancelamento-reverter-pago').checked = false;
    const paid = String(item.status) === 'pago';
    const paidWrap = el('cancelamento-pago-wrap');
    paidWrap?.classList.toggle('hidden', !paid);
    paidWrap?.classList.toggle('flex', paid);
    if (el('cancelamento-salvar')) el('cancelamento-salvar').disabled = true;
    openModal('modal-cancelamento');
  }

  function updateCancellationButton() {
    const reasonValid = String(el('cancelamento-motivo')?.value || '').trim().length >= 5;
    const paid = String(state.currentCancellation?.status || '') === 'pago';
    const reversalValid = !paid || el('cancelamento-reverter-pago')?.checked;
    if (el('cancelamento-salvar')) el('cancelamento-salvar').disabled = !(reasonValid && reversalValid);
  }

  async function saveCancellation() {
    const item = state.currentCancellation;
    const id = String(item?.closingId || item?.id || '');
    if (!id) return;
    const reason = String(el('cancelamento-motivo')?.value || '').trim();
    const paid = String(item.status || '') === 'pago';
    if (reason.length < 5 || (paid && !el('cancelamento-reverter-pago')?.checked)) return;
    const button = el('cancelamento-salvar');
    setButtonBusy(button, true, 'Cancelando...');
    try {
      await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, confirmPaidReversal: paid, reason }),
      });
      closeModal('modal-cancelamento');
      state.currentCancellation = null;
      showFeedback('Fechamento cancelado sem apagar o histórico; os itens foram liberados para nova conferência.', 'success');
      await loadReport();
    } catch (error) {
      showFeedback(error.message || 'Não foi possível cancelar o fechamento.', 'error');
    } finally {
      setButtonBusy(button, false);
      updateCancellationButton();
    }
  }

  function detailTable(items, excluded = false) {
    if (!items.length) return `<p class="p-4 text-center text-sm text-gray-500">Nenhum item ${excluded ? 'excluído' : 'incluído'}.</p>`;
    return `<table class="min-w-full divide-y divide-gray-100 text-sm" data-admin-table-skip="true"><thead class="bg-gray-50 text-xs uppercase text-gray-500"><tr><th class="px-3 py-2 text-left">Data/hora</th><th class="px-3 py-2 text-left">Pet / origem</th><th class="px-3 py-2 text-left">Item</th><th class="px-3 py-2 text-left">Venda</th><th class="px-3 py-2 text-right">Valor</th>${excluded ? '<th class="px-3 py-2 text-left">Motivo</th>' : '<th class="px-3 py-2 text-right">%</th><th class="px-3 py-2 text-right">Comissão</th>'}</tr></thead><tbody class="divide-y divide-gray-100">${items
      .map((item) => `<tr><td class="whitespace-nowrap px-3 py-2">${escapeHtml(formatDate(item.date))}${item.time ? ` ${escapeHtml(item.time)}` : ''}</td><td class="px-3 py-2">${escapeHtml(item.petName || (item.source === 'pdv_product' ? 'PDV' : '--'))}</td><td class="px-3 py-2">${escapeHtml(item.description || '--')}</td><td class="px-3 py-2">${escapeHtml(item.saleCode || '--')}</td><td class="whitespace-nowrap px-3 py-2 text-right">${formatMoney(item.value)}</td>${excluded ? `<td class="px-3 py-2 text-red-700">${escapeHtml(item.reason || '--')}</td>` : `<td class="px-3 py-2 text-right">${numberValue(item.percent).toFixed(2)}%</td><td class="whitespace-nowrap px-3 py-2 text-right font-semibold">${formatMoney(item.commission)}</td>`}</tr>`)
      .join('')}</tbody></table>`;
  }

  function renderDetails(payload, context = {}) {
    state.currentDetail = { payload, context };
    const items = Array.isArray(payload.items) ? payload.items : [];
    const exclusions = Array.isArray(payload.exclusions)
      ? payload.exclusions
      : Array.isArray(payload.eligibility?.exclusions)
        ? payload.eligibility.exclusions
        : [];
    const totals = payload.totals || {};
    const commission = numberValue(totals.commission ?? totals.totalPeriodo);
    const value = numberValue(totals.value ?? items.reduce((sum, item) => sum + numberValue(item.value), 0));
    const services = numberValue(totals.services ?? totals.totalServicos);
    const sales = numberValue(totals.sales ?? totals.totalVendas);
    const subtitle = context.subtitle || payload.closing?.periodo || formatPeriod(context.start, context.end);
    if (el('detalhes-subtitulo')) el('detalhes-subtitulo').textContent = `${context.professionalName || payload.closing?.profissionalNome || 'Profissional'} · ${subtitle}`;
    const warning = payload.warning || '';
    const alertNode = el('detalhes-alerta');
    if (alertNode) {
      alertNode.textContent = warning;
      alertNode.className = warning
        ? 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'
        : 'hidden';
    }
    if (el('detalhes-kpis')) {
      el('detalhes-kpis').innerHTML = [
        ['Itens incluídos', items.length],
        ['Valor base', formatMoney(value)],
        ['Comissão', formatMoney(commission || services + sales)],
        ['Excluídos', exclusions.length],
      ].map(([label, valueLabel]) => `<article class="rounded-lg bg-gray-50 p-3"><p class="text-xs font-semibold uppercase text-gray-500">${escapeHtml(label)}</p><p class="mt-1 text-lg font-bold">${escapeHtml(valueLabel)}</p></article>`).join('');
    }
    if (el('detalhes-incluidos')) el('detalhes-incluidos').innerHTML = detailTable(items, false);
    if (el('detalhes-excluidos')) el('detalhes-excluidos').innerHTML = detailTable(exclusions, true);
    openModal('modal-detalhes');
  }

  async function openDetails({ closingId = '', professionalId = '', row = null } = {}) {
    try {
      if (closingId && !String(closingId).startsWith('report-')) {
        const payload = await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(closingId)}/details`, { headers: authHeaders() });
        renderDetails(payload, { professionalName: payload.closing?.profissionalNome, subtitle: payload.closing?.periodo });
        return;
      }
      const target = row || findReportRowByProfessional(professionalId);
      const period = target
        ? { start: toYmd(target.periodoInicio), end: toYmd(target.periodoFim) }
        : { start: toYmd(el('fechamento-inicio')?.value), end: toYmd(el('fechamento-fim')?.value) };
      const professional = professionalId || target?.profissional || el('fechamento-funcionario')?.value || '';
      const store = el('empresa-select')?.value || '';
      if (!professional || !store || !period.start || !period.end) throw new Error('Selecione funcionário e período para ver os detalhes.');
      const query = new URLSearchParams({ profissionalId: professional, store, start: period.start, end: period.end, details: '1' });
      const preview = await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/preview?${query}`, { headers: authHeaders() });
      renderDetails(
        {
          items: preview.items || [],
          exclusions: preview.eligibility?.exclusions || [],
          totals: {
            totalPeriodo: preview.totals?.totalPeriodo,
            totalServicos: preview.totals?.totalServicos,
            totalVendas: preview.totals?.totalVendas,
          },
          warning: numberValue(preview.alreadyClosedItems)
            ? `${numberValue(preview.alreadyClosedItems)} item(ns) já pertencem a fechamentos anteriores e não aparecem no saldo novo.`
            : '',
        },
        {
          professionalName: target?.profissionalNome || state.professionals.find((item) => String(item.id) === String(professional))?.nome,
          start: period.start,
          end: period.end,
        },
      );
    } catch (error) {
      showFeedback(error.message || 'Não foi possível carregar os detalhes.', 'error');
    }
  }

  function printCurrentDetails() {
    const detail = state.currentDetail;
    if (!detail) return;
    const payload = detail.payload || {};
    const context = detail.context || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const title = `Comissões - ${context.professionalName || payload.closing?.profissionalNome || 'Profissional'}`;
    const subtitle = context.subtitle || payload.closing?.periodo || formatPeriod(context.start, context.end);
    const rows = items.length
      ? items.map((item) => `<tr><td>${escapeHtml(formatDate(item.date))}${item.time ? ` ${escapeHtml(item.time)}` : ''}</td><td>${escapeHtml(item.petName || (item.source === 'pdv_product' ? 'PDV' : '--'))}</td><td>${escapeHtml(item.description || '--')}</td><td>${escapeHtml(item.saleCode || '--')}</td><td class="num">${formatMoney(item.value)}</td><td class="num">${numberValue(item.percent).toFixed(2)}%</td><td class="num">${formatMoney(item.commission)}</td></tr>`).join('')
      : '<tr><td colspan="7">Nenhum item incluído.</td></tr>';
    const popup = window.open('', '_blank', 'width=1050,height=760');
    if (!popup) {
      showFeedback('Permita pop-ups para gerar o PDF.', 'warning');
      return;
    }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;color:#111827;font-size:11px}h1{font-size:17px;margin:0 0 4px}.meta{color:#4b5563;margin-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:5px;text-align:left}th{background:#f3f4f6;text-transform:uppercase;font-size:9px}.num{text-align:right;white-space:nowrap}</style></head><body><h1>${escapeHtml(title)}</h1><div class="meta">Período: ${escapeHtml(subtitle)} · Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</div><table><thead><tr><th>Data/hora</th><th>Pet/origem</th><th>Item</th><th>Venda</th><th>Valor</th><th>%</th><th>Comissão</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){window.print();};<\/script></body></html>`);
    popup.document.close();
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const period = getPeriod({ showError: true });
    if (!period || !state.filteredItems.length) {
      showFeedback('Não há registros filtrados para exportar.', 'warning');
      return;
    }
    const header = ['Código', 'Profissional', 'Tipo', 'Data inicial', 'Data final', 'Comissão do período', 'Já fechada/paga', 'A fechar/pagar', 'Status', 'Previsão', 'Pagamento real', 'Meio'];
    const rows = state.filteredItems.map((item) => [
      item.codigoProfissional || '',
      item.profissionalNome || '',
      item.tipo || '',
      toYmd(item.periodoInicio),
      toYmd(item.periodoFim),
      numberValue(item.totalPeriodo).toFixed(2).replace('.', ','),
      numberValue(item.totalPago).toFixed(2).replace('.', ','),
      numberValue(item.totalPendente).toFixed(2).replace('.', ','),
      item.status || '',
      `${toYmd(item.previsaoPagamentoData)} ${item.previsaoPagamentoHora || ''}`.trim(),
      `${toYmd(item.paidDate)} ${item.paidTime || ''}`.trim(),
      item.meioPagamento || '',
    ]);
    const content = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `comissoes-${period.start}-a-${period.end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    showFeedback(`${state.filteredItems.length} registro(s) exportado(s) em CSV.`, 'success');
  }

  async function loadConfig() {
    const request = ++state.configRequest;
    const store = el('empresa-select')?.value || '';
    if (!store) return;
    try {
      const data = await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/config/data?store=${encodeURIComponent(store)}`, { headers: authHeaders() });
      if (request !== state.configRequest) return;
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const bankAccounts = Array.isArray(data.bankAccounts) ? data.bankAccounts : [];
      setSelectOptions(
        el('config-accounting'),
        accounts.map((account) => ({ id: account._id, nome: `${account.code || ''} - ${account.name || ''}` })),
        { placeholder: 'Selecione' },
      );
      setSelectOptions(
        el('config-bankaccount'),
        bankAccounts.map((account) => ({
          id: account._id,
          nome: `${account.alias || account.bankName || 'Conta'} · Ag. ${account.agency || '--'} · Cc. ${account.accountNumber || '--'}${account.accountDigit ? `-${account.accountDigit}` : ''}`,
        })),
        { placeholder: 'Selecione' },
      );
      if (el('config-accounting')) el('config-accounting').value = data.config?.accountingAccount || '';
      if (el('config-bankaccount')) el('config-bankaccount').value = data.config?.bankAccount || '';
      if (el('config-include-services')) el('config-include-services').checked = data.config?.includeServices !== false;
      if (el('config-include-pdv-sales')) el('config-include-pdv-sales').checked = data.config?.includePdvSales !== false;
      const selectedStore = state.stores.find((item) => String(item._id) === store);
      if (el('config-empresa-nome')) el('config-empresa-nome').textContent = selectedStore?.nome || 'Empresa selecionada';
    } catch (error) {
      showFeedback(error.message || 'Não foi possível carregar a configuração.', 'error');
    }
  }

  async function openConfig() {
    if (!el('empresa-select')?.value) {
      showFeedback('Selecione uma empresa antes de abrir as configurações.', 'warning');
      return;
    }
    await loadConfig();
    openModal('modal-configuracoes');
  }

  async function saveConfig() {
    const store = el('empresa-select')?.value || '';
    if (!store) return;
    const button = el('config-salvar');
    setButtonBusy(button, true, 'Salvando...');
    try {
      await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/config`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: store,
          accountingAccount: el('config-accounting')?.value || null,
          bankAccount: el('config-bankaccount')?.value || null,
          includeServices: Boolean(el('config-include-services')?.checked),
          includePdvSales: Boolean(el('config-include-pdv-sales')?.checked),
        }),
      });
      closeModal('modal-configuracoes');
      showFeedback('Configuração salva. O relatório foi recalculado.', 'success');
      await loadReport();
    } catch (error) {
      showFeedback(error.message || 'Não foi possível salvar a configuração.', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  function handleAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id || '';
    const professionalId = button.dataset.profissional || '';
    const item = id ? findClosing(id) : findReportRowByProfessional(professionalId);
    if (action === 'close') openClosing(item);
    else if (action === 'pay' && item) openPayment(item);
    else if (action === 'cancel' && item) openCancellation(item);
    else if (action === 'details') openDetails({
      closingId: id,
      professionalId: professionalId || item?.profissional,
      row: item,
    });
  }

  function bindActions() {
    el('btn-aplicar')?.addEventListener('click', loadReport);
    el('btn-limpar')?.addEventListener('click', () => {
      if (el('filtro-status')) el('filtro-status').value = '';
      if (el('filtro-busca')) el('filtro-busca').value = '';
      setPeriodDefaults(new Date());
      loadReport();
    });
    el('filtro-status')?.addEventListener('change', applyLocalFilters);
    el('filtro-busca')?.addEventListener('input', applyLocalFilters);
    el('mes-anterior')?.addEventListener('click', () => {
      setPeriodDefaults(new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1));
      loadReport();
    });
    el('mes-proximo')?.addEventListener('click', () => {
      setPeriodDefaults(new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1));
      loadReport();
    });
    el('empresa-select')?.addEventListener('change', async () => {
      resetClosingForm();
      await loadProfessionals();
      await Promise.all([loadConfig(), loadReport()]);
    });
    el('btn-novo-fechamento')?.addEventListener('click', () => openClosing());
    el('btn-configuracoes')?.addEventListener('click', openConfig);
    el('btn-exportar')?.addEventListener('click', exportCsv);
    el('fechamento-salvar')?.addEventListener('click', saveClosing);
    el('fechamento-ver-detalhes')?.addEventListener('click', () => openDetails());
    ['fechamento-funcionario', 'fechamento-inicio', 'fechamento-fim'].forEach((id) => {
      el(id)?.addEventListener('change', schedulePreview);
      el(id)?.addEventListener('input', schedulePreview);
    });
    el('pagamento-confirmar')?.addEventListener('change', updatePaymentButton);
    ['pagamento-data', 'pagamento-hora', 'pagamento-meio'].forEach((id) => {
      el(id)?.addEventListener('input', updatePaymentButton);
      el(id)?.addEventListener('change', updatePaymentButton);
    });
    el('pagamento-salvar')?.addEventListener('click', savePayment);
    el('cancelamento-motivo')?.addEventListener('input', updateCancellationButton);
    el('cancelamento-reverter-pago')?.addEventListener('change', updateCancellationButton);
    el('cancelamento-salvar')?.addEventListener('click', saveCancellation);
    el('detalhes-imprimir')?.addEventListener('click', printCurrentDetails);
    el('config-salvar')?.addEventListener('click', saveConfig);
    [el('fechamento-tbody'), el('report-mobile-list'), el('history-list')].forEach((container) =>
      container?.addEventListener('click', handleAction),
    );
    document.querySelectorAll('[data-sort-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.sortKey;
        if (state.sort.key === key) state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        else state.sort = { key, direction: 'asc' };
        renderReportRows(state.filteredItems);
      });
    });
    document.querySelectorAll('[data-modal-close]').forEach((button) => {
      button.addEventListener('click', () => closeModal(button.dataset.modalClose));
    });
    document.addEventListener('keydown', (event) => {
      const topId = state.modalStack[state.modalStack.length - 1];
      if (!topId) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(topId);
        return;
      }
      if (event.key !== 'Tab') return;
      const modal = el(topId);
      const focusable = modal ? modalFocusable(modal) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  async function init() {
    setPeriodDefaults(new Date());
    bindActions();
    setReportLoading(true);
    await loadStores();
    if (el('empresa-select')?.value) {
      await loadProfessionals();
      await Promise.all([loadConfig(), loadReport()]);
    } else {
      setReportLoading(false);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
