(function () {
  "use strict";

  const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const state = {
    currentMonth: new Date(),
    stores: [],
    professionals: [],
    config: {},
    report: {
      items: [],
      history: [],
      summary: {},
      anomalies: {},
      issues: [],
      permissions: {},
    },
    filteredItems: [],
    reportPage: 1,
    reportPageSize: 20,
    historyPage: 1,
    historyPageSize: 10,
    sort: { key: "profissionalNome", direction: "asc" },
    currentPreview: null,
    currentPayment: null,
    currentApproval: null,
    currentCancellation: null,
    currentReconciliation: null,
    currentDetail: null,
    reportRequest: 0,
    professionalsRequest: 0,
    previewRequest: 0,
    configRequest: 0,
    detailRequest: 0,
    modalStack: [],
    lastFocus: null,
    previewTimer: null,
    detailTimer: null,
  };

  const el = (id) => document.getElementById(id);
  const numberValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatMoney = (value) => currency.format(numberValue(value));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function loggedUser() {
    try {
      return JSON.parse(localStorage.getItem("loggedInUser") || "null") || {};
    } catch {
      return {};
    }
  }

  function loggedUserId() {
    const user = loggedUser();
    return String(user.id || user._id || "");
  }

  function authHeaders() {
    const token = loggedUser().token || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        payload?.message || `Falha na requisição (${response.status}).`,
      );
      error.status = response.status;
      error.code = payload?.code || "";
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showFeedback(message, type = "info") {
    const node = el("screen-feedback");
    if (!node) return;
    const styles = {
      info: "border-blue-200 bg-blue-50 text-blue-800",
      success: "border-emerald-200 bg-emerald-50 text-emerald-800",
      warning: "border-amber-200 bg-amber-50 text-amber-900",
      error: "border-red-200 bg-red-50 text-red-800",
    };
    node.className = `rounded-xl border px-3 py-2 text-sm ${styles[type] || styles.info}`;
    node.textContent = message;
    node.classList.remove("hidden");
  }

  function clearFeedback() {
    const node = el("screen-feedback");
    if (!node) return;
    node.textContent = "";
    node.classList.add("hidden");
  }

  function setButtonBusy(button, busy, label = "Processando...") {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span class="ml-1">${escapeHtml(label)}</span>`;
    } else {
      if (button.dataset.originalHtml)
        button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
      button.disabled = false;
    }
  }

  function formatInputDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatInputTime(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function toYmd(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  }

  function formatDate(value) {
    const key = toYmd(value);
    if (!key) return "--";
    const [year, month, day] = key.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatPeriod(start, end) {
    const from = formatDate(start);
    const to = formatDate(end);
    return from === to ? from : `${from} a ${to}`;
  }

  function formatMonthLabel(date) {
    return date
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      .replace(/^./, (c) => c.toUpperCase());
  }

  function setPeriod(start, end) {
    if (el("filtro-inicio")) el("filtro-inicio").value = formatInputDate(start);
    if (el("filtro-fim")) el("filtro-fim").value = formatInputDate(end);
    state.currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    if (el("mes-label"))
      el("mes-label").textContent = formatMonthLabel(state.currentMonth);
  }

  function setPeriodDefaults(reference = new Date()) {
    setPeriod(
      new Date(reference.getFullYear(), reference.getMonth(), 1),
      new Date(reference.getFullYear(), reference.getMonth() + 1, 0),
    );
  }

  function applyPeriodPreset(name) {
    const now = new Date();
    if (name === "today") setPeriod(now, now);
    else if (name === "7days")
      setPeriod(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6),
        now,
      );
    else if (name === "previous")
      setPeriod(
        new Date(now.getFullYear(), now.getMonth() - 1, 1),
        new Date(now.getFullYear(), now.getMonth(), 0),
      );
    else if (name === "quarter")
      setPeriod(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89),
        now,
      );
    else setPeriodDefaults(now);
    loadReport();
  }

  function getPeriod({ showError = false } = {}) {
    const start = toYmd(el("filtro-inicio")?.value);
    const end = toYmd(el("filtro-fim")?.value);
    const valid = Boolean(start && end && start <= end);
    [el("filtro-inicio"), el("filtro-fim")].forEach((input) =>
      input?.setAttribute("aria-invalid", valid ? "false" : "true"),
    );
    if (!valid && showError)
      showFeedback("Informe um período válido.", "error");
    return valid ? { start, end } : null;
  }

  function setSelectOptions(
    select,
    options,
    { placeholder = "Selecione", valueKey = "id", labelKey = "nome" } = {},
  ) {
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    if (placeholder !== null) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = placeholder;
      select.appendChild(option);
    }
    options.forEach((item) => {
      const value = String(item?.[valueKey] ?? "");
      if (!value) return;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = String(item?.[labelKey] ?? "Sem nome");
      select.appendChild(option);
    });
    if (
      previous &&
      options.some((item) => String(item?.[valueKey]) === previous)
    )
      select.value = previous;
  }

  function statusBadge(status, overdue = false) {
    const map = {
      pago: ["Pago", "bg-emerald-50 text-emerald-700"],
      agendado: [
        overdue ? "Vencido" : "Agendado",
        overdue ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700",
      ],
      aguardando_aprovacao: [
        "Aguardando aprovação",
        "bg-indigo-50 text-indigo-700",
      ],
      pendente: ["Pendente", "bg-amber-50 text-amber-700"],
      em_aberto: ["Em aberto", "bg-gray-100 text-gray-700"],
      reconciliacao: ["Requer revisão", "bg-red-50 text-red-700"],
      cancelado: ["Cancelado", "bg-gray-100 text-gray-500"],
    };
    const normalized = String(status || "").toLowerCase();
    const [label, classes] = map[normalized] || [
      normalized || "Status",
      "bg-gray-100 text-gray-600",
    ];
    return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${classes}"><i class="fas fa-circle text-[6px]" aria-hidden="true"></i>${escapeHtml(label)}</span>`;
  }

  function paymentLabel(item) {
    if (item.status === "pago") {
      return `<p class="text-xs font-semibold text-emerald-700">${escapeHtml(item.meioPagamento || "Pago")}</p><p class="text-[11px] text-gray-500">${escapeHtml(formatDate(item.paidDate))}${item.paidTime ? ` ${escapeHtml(item.paidTime)}` : ""}${item.paymentReference ? ` · ${escapeHtml(item.paymentReference)}` : ""}</p>`;
    }
    if (item.status === "aguardando_aprovacao")
      return '<p class="text-xs font-semibold text-indigo-700">Pagamento enviado para revisão</p>';
    if (item.previsaoPagamentoData)
      return `<p class="text-xs font-semibold ${item.overdue ? "text-red-700" : "text-gray-700"}">${escapeHtml(item.meioPagamento || "Agendado")}</p><p class="text-[11px] ${item.overdue ? "text-red-600" : "text-gray-500"}">Prev. ${escapeHtml(formatDate(item.previsaoPagamentoData))}${item.previsaoPagamentoHora ? ` ${escapeHtml(item.previsaoPagamentoHora)}` : ""}</p>`;
    return '<span class="text-xs text-gray-400">Sem previsão</span>';
  }

  function actionButtons(item, { history = false } = {}) {
    const id = String(item.closingId || item.id || "");
    const permissions = state.report.permissions || {};
    const buttons = [
      `<button type="button" class="rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-gray-50" data-action="details" data-id="${escapeHtml(id)}" data-profissional="${escapeHtml(item.profissional || "")}"><i class="fas fa-list-check mr-1"></i><span class="commission-action-label">Ver </span>Itens</button>`,
    ];
    if (!history && item.canClose)
      buttons.push(
        `<button type="button" class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white" data-action="close" data-profissional="${escapeHtml(item.profissional || "")}"><i class="fas fa-lock mr-1"></i>${item.adjustment ? "Ajuste" : "Fechar"}</button>`,
      );
    const canPay = history
      ? permissions.canPay && ["pendente", "agendado"].includes(item.status)
      : item.canPay;
    const canApprove = history
      ? permissions.canPay &&
        item.status === "aguardando_aprovacao" &&
        String(item.paymentApproval?.requestedBy || "") !== loggedUserId()
      : item.canApprove;
    const canCancel = history
      ? permissions.canCancel && item.status !== "cancelado"
      : item.canCancel;
    if (canPay)
      buttons.push(
        `<button type="button" class="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700" data-action="pay" data-id="${escapeHtml(id)}"><i class="fas fa-money-check-dollar mr-1"></i>Pagar</button>`,
      );
    if (canApprove)
      buttons.push(
        `<button type="button" class="rounded-lg border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700" data-action="approve" data-id="${escapeHtml(id)}"><i class="fas fa-user-check mr-1"></i>Revisar</button>`,
      );
    if (item.hasPaymentReceipt)
      buttons.push(
        `<button type="button" class="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700" data-action="receipt" data-id="${escapeHtml(id)}" title="Baixar comprovante" aria-label="Baixar comprovante"><i class="fas fa-paperclip" aria-hidden="true"></i></button>`,
      );
    if (canCancel)
      buttons.push(
        `<button type="button" class="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700" data-action="cancel" data-id="${escapeHtml(id)}" title="Cancelar" aria-label="Cancelar fechamento"><i class="fas fa-ban" aria-hidden="true"></i></button>`,
      );
    return `<div class="flex flex-wrap gap-1.5">${buttons.join("")}</div>`;
  }

  function sortedItems(items) {
    const { key, direction } = state.sort;
    return items.slice().sort((left, right) => {
      const a = left?.[key];
      const b = right?.[key];
      const comparison = [
        "totalPeriodo",
        "totalPago",
        "totalPendente",
      ].includes(key)
        ? numberValue(a) - numberValue(b)
        : String(a || "").localeCompare(String(b || ""), "pt-BR", {
            numeric: true,
            sensitivity: "base",
          });
      return direction === "desc" ? -comparison : comparison;
    });
  }

  function pageButton(action, disabled, icon, label) {
    return `<button type="button" data-page-action="${action}" class="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40" ${disabled ? "disabled" : ""}><i class="fas ${icon} mr-1"></i>${label}</button>`;
  }

  function renderReportRows() {
    const container = el("report-list");
    const footer = el("report-pagination");
    if (!container || !footer) return;
    const sorted = sortedItems(state.filteredItems);
    const pageCount = Math.max(
      1,
      Math.ceil(sorted.length / state.reportPageSize),
    );
    state.reportPage = Math.min(pageCount, Math.max(1, state.reportPage));
    const offset = (state.reportPage - 1) * state.reportPageSize;
    const visible = sorted.slice(offset, offset + state.reportPageSize);
    if (!visible.length) {
      container.innerHTML =
        '<p class="px-4 py-8 text-center text-sm text-gray-500">Nenhuma comissão encontrada com os filtros atuais.</p>';
    } else {
      container.innerHTML = visible
        .map(
          (item) => `<article class="commission-row px-3 py-3 hover:bg-gray-50">
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-1.5"><h3 class="truncate text-sm font-bold text-gray-950">${escapeHtml(item.profissionalNome || "--")}</h3><span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">${escapeHtml(item.tipo || "--")}</span></div><p class="text-[11px] text-gray-500">Cód. ${escapeHtml(item.codigoProfissional || "--")}${item.alreadyClosedItems ? ` · ${numberValue(item.alreadyClosedItems)} congelado(s)` : ""}</p>${item.needsReconciliation ? `<p class="mt-1 text-[11px] text-red-700">${escapeHtml(item.reconciliationReason)}</p>` : ""}</div>
        <div data-col="period" class="text-xs text-gray-600"><span class="commission-action-label font-semibold">Período: </span>${escapeHtml(item.periodo || formatPeriod(item.periodoInicio, item.periodoFim))}</div>
        <div class="sm:text-right"><p class="text-sm font-bold text-gray-950">${formatMoney(item.totalPeriodo)}</p><p class="text-[10px] text-gray-500">Pago ${formatMoney(item.totalPago)}</p></div>
        <div>${statusBadge(item.status, item.overdue)}</div>
        <div data-col="payment">${paymentLabel(item)}</div>
        <div>${actionButtons(item)}</div>
      </article>`,
        )
        .join("");
    }
    const from = sorted.length ? offset + 1 : 0;
    const to = Math.min(offset + state.reportPageSize, sorted.length);
    footer.innerHTML = `<span class="text-xs text-gray-500">${from}–${to} de ${sorted.length}</span><div class="flex gap-1.5">${pageButton("previous", state.reportPage <= 1, "fa-chevron-left", "Anterior")}${pageButton("next", state.reportPage >= pageCount, "fa-chevron-right", "Próxima")}</div>`;
    if (el("fechamento-contagem"))
      el("fechamento-contagem").textContent = `${sorted.length} registro(s)`;
  }

  function renderKpis() {
    const summary = state.report.summary || {};
    if (el("kpi-total-previsto"))
      el("kpi-total-previsto").textContent = formatMoney(summary.totalExpected);
    if (el("kpi-pagos"))
      el("kpi-pagos").textContent = formatMoney(summary.paymentsMade);
    if (el("kpi-receber"))
      el("kpi-receber").textContent = formatMoney(summary.outstanding);
    if (el("kpi-ultimo"))
      el("kpi-ultimo").textContent = summary.lastPaymentDate
        ? `${formatDate(summary.lastPaymentDate)}${summary.lastPaymentTime ? ` ${summary.lastPaymentTime}` : ""}`
        : "--";
  }

  function fallbackIssues() {
    const anomaly = state.report.anomalies || {};
    const issues = [];
    if (anomaly.missingConfiguration)
      issues.push({
        id: "config",
        severity: "critical",
        title: "Configuração financeira incompleta",
        description: "Conta contábil ou bancária ausente.",
        actions: ["configure"],
      });
    if (numberValue(anomaly.reconciliationRows))
      issues.push({
        id: "legacy",
        severity: "warning",
        title: "Fechamentos legados",
        description: `${numberValue(anomaly.reconciliationRows)} linha(s) exigem revisão.`,
        actions: [],
      });
    return issues;
  }

  function renderAudit() {
    const panel = el("auditoria-panel");
    const list = el("auditoria-list");
    if (!panel || !list) return;
    const issues =
      Array.isArray(state.report.issues) && state.report.issues.length
        ? state.report.issues
        : fallbackIssues();
    panel.classList.toggle("hidden", !issues.length);
    if (el("auditoria-count"))
      el("auditoria-count").textContent = String(issues.length);
    const styles = {
      critical: "text-red-700",
      warning: "text-amber-800",
      info: "text-blue-700",
    };
    const labels = {
      configure: "Configurar",
      details: "Detalhes",
      repair_payable: "Reparar conta",
      reconcile_snapshot: "Congelar itens",
      complete_payment_metadata: "Completar pagamento",
      pay: "Pagar",
      review_payment: "Revisar",
    };
    list.innerHTML = issues
      .map(
        (issue) =>
          `<article class="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div class="min-w-0"><p class="text-sm font-bold ${styles[issue.severity] || styles.warning}">${escapeHtml(issue.title || "Pendência")}</p><p class="text-xs text-amber-900">${escapeHtml(issue.description || "")}</p></div><div class="flex flex-wrap gap-1.5">${(issue.actions || []).map((action) => `<button type="button" data-issue-action="${escapeHtml(action)}" data-id="${escapeHtml(issue.closingId || "")}" class="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900">${escapeHtml(labels[action] || action)}</button>`).join("")}</div></article>`,
      )
      .join("");
  }

  function renderHistory() {
    const container = el("history-list");
    if (!container) return;
    const search = normalizeSearch(el("history-search")?.value);
    const status = el("history-status")?.value || "";
    let history = Array.isArray(state.report.history)
      ? state.report.history.slice()
      : [];
    if (search)
      history = history.filter((item) =>
        normalizeSearch(
          `${item.profissionalNome} ${item.periodo} ${item.codigoProfissional}`,
        ).includes(search),
      );
    if (status) history = history.filter((item) => item.status === status);
    const pageCount = Math.max(
      1,
      Math.ceil(history.length / state.historyPageSize),
    );
    state.historyPage = Math.min(pageCount, Math.max(1, state.historyPage));
    const offset = (state.historyPage - 1) * state.historyPageSize;
    const visible = history.slice(offset, offset + state.historyPageSize);
    if (el("history-count"))
      el("history-count").textContent = `(${history.length})`;
    if (!visible.length) {
      container.innerHTML =
        '<p class="py-5 text-sm text-gray-500">Nenhum fechamento encontrado.</p>';
      return;
    }
    container.innerHTML =
      visible
        .map(
          (item) =>
            `<article class="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center"><div class="min-w-0"><div class="flex flex-wrap items-center gap-1.5"><p class="truncate text-sm font-bold">${escapeHtml(item.profissionalNome || "--")}</p>${statusBadge(item.status, item.overdue)}${item.crossesSelection ? '<span class="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800">Cruza o período</span>' : ""}${item.legacyPeriod ? '<span class="rounded-full bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-800">Legado</span>' : ""}</div><p class="text-xs text-gray-500">${escapeHtml(item.periodo)} · ${escapeHtml(item.tipo || "--")}</p></div><div class="text-sm lg:text-right"><p class="font-bold">${formatMoney(item.totalPeriodo)}</p><p class="text-[11px] text-gray-500">Pago ${formatMoney(item.totalPago)}</p></div>${actionButtons(item, { history: true })}</article>`,
        )
        .join("") +
      `<footer class="flex items-center justify-between border-t py-2"><span class="text-xs text-gray-500">Página ${state.historyPage} de ${pageCount}</span><div class="flex gap-1">${pageButton("history-previous", state.historyPage <= 1, "fa-chevron-left", "Anterior")}${pageButton("history-next", state.historyPage >= pageCount, "fa-chevron-right", "Próxima")}</div></footer>`;
  }

  function applyLocalFilters({ resetPage = true } = {}) {
    const status = el("filtro-status")?.value || "";
    const search = normalizeSearch(el("filtro-busca")?.value);
    let items = Array.isArray(state.report.items)
      ? state.report.items.slice()
      : [];
    if (status === "pendente")
      items = items.filter((item) =>
        ["pendente", "em_aberto"].includes(item.status),
      );
    else if (status) items = items.filter((item) => item.status === status);
    if (search)
      items = items.filter((item) =>
        normalizeSearch(
          `${item.profissionalNome} ${item.codigoProfissional}`,
        ).includes(search),
      );
    state.filteredItems = items;
    if (resetPage) state.reportPage = 1;
    renderReportRows();
    [el("btn-exportar-csv"), el("btn-exportar-excel")].forEach((button) => {
      if (button) button.disabled = !items.length;
    });
  }

  function applyPermissions() {
    const permissions =
      state.report.permissions || state.config.permissions || {};
    if (el("btn-novo-fechamento"))
      el("btn-novo-fechamento").disabled = permissions.canClose === false;
    if (el("btn-configuracoes"))
      el("btn-configuracoes").disabled = permissions.canConfigure === false;
  }

  function setReportLoading(loading) {
    el("report-loading")?.classList.toggle("hidden", !loading);
    el("report-list")?.classList.toggle("opacity-50", loading);
    el("btn-atualizar")?.classList.toggle("animate-pulse", loading);
  }

  async function loadReport() {
    const request = ++state.reportRequest;
    const period = getPeriod({ showError: true });
    const store = el("empresa-select")?.value || "";
    if (!period || !store) {
      if (!store)
        showFeedback(
          "Selecione uma empresa para gerar o relatório.",
          "warning",
        );
      return;
    }
    clearFeedback();
    setReportLoading(true);
    try {
      const query = new URLSearchParams({
        store,
        start: period.start,
        end: period.end,
      });
      const report = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/report?${query}`,
        { headers: authHeaders(), cache: "no-store" },
      );
      if (request !== state.reportRequest) return;
      state.report = {
        ...report,
        items: Array.isArray(report.items) ? report.items : [],
        history: Array.isArray(report.history) ? report.history : [],
        issues: Array.isArray(report.issues) ? report.issues : [],
        summary: report.summary || {},
        anomalies: report.anomalies || {},
        permissions: report.permissions || {},
      };
      state.currentMonth = new Date(`${period.start}T12:00:00`);
      if (el("mes-label"))
        el("mes-label").textContent = formatMonthLabel(state.currentMonth);
      if (el("report-updated-at"))
        el("report-updated-at").textContent =
          `Atualizado ${new Date(report.generatedAt || Date.now()).toLocaleString("pt-BR")}`;
      renderKpis();
      renderAudit();
      renderHistory();
      applyLocalFilters();
      applyPermissions();
    } catch (error) {
      if (request !== state.reportRequest) return;
      state.report = {
        items: [],
        history: [],
        issues: [],
        summary: {},
        anomalies: {},
        permissions: {},
      };
      renderKpis();
      renderAudit();
      renderHistory();
      applyLocalFilters();
      showFeedback(
        error.message || "Não foi possível carregar o relatório.",
        "error",
      );
    } finally {
      if (request === state.reportRequest) setReportLoading(false);
    }
  }

  async function loadStores() {
    try {
      const stores = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/stores`,
        { headers: authHeaders() },
      );
      state.stores = Array.isArray(stores) ? stores : [];
      setSelectOptions(
        el("empresa-select"),
        state.stores.map((store) => ({
          id: store._id,
          nome: store.nome || "Empresa",
        })),
        { placeholder: state.stores.length ? null : "Nenhuma empresa" },
      );
      if (
        el("empresa-select") &&
        state.stores.length &&
        !el("empresa-select").value
      )
        el("empresa-select").value = String(state.stores[0]._id);
    } catch (error) {
      setSelectOptions(el("empresa-select"), [], {
        placeholder: "Erro ao carregar",
      });
      showFeedback(
        error.message || "Não foi possível carregar empresas.",
        "error",
      );
    }
  }

  async function loadProfessionals() {
    const request = ++state.professionalsRequest;
    const store = el("empresa-select")?.value || "";
    if (!store) return;
    try {
      const data = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/professionals?store=${encodeURIComponent(store)}`,
        { headers: authHeaders() },
      );
      if (request !== state.professionalsRequest) return;
      state.professionals = Array.isArray(data) ? data : [];
      setSelectOptions(el("fechamento-funcionario"), state.professionals, {
        placeholder: "Selecione",
      });
    } catch (error) {
      if (request !== state.professionalsRequest) return;
      state.professionals = [];
      setSelectOptions(el("fechamento-funcionario"), [], {
        placeholder: "Erro ao carregar",
      });
    }
  }

  function modalFocusable(modal) {
    return Array.from(
      modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => node.offsetParent !== null);
  }

  function openModal(id) {
    const modal = el(id);
    if (!modal) return;
    state.lastFocus = document.activeElement;
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    state.modalStack = state.modalStack.filter((value) => value !== id);
    state.modalStack.push(id);
    window.setTimeout(
      () =>
        (
          modalFocusable(modal)[0] || modal.querySelector("[data-modal-panel]")
        )?.focus(),
      0,
    );
  }

  function closeModal(id) {
    const modal = el(id);
    if (!modal) return;
    modal.classList.add("hidden");
    state.modalStack = state.modalStack.filter((value) => value !== id);
    if (!state.modalStack.length)
      document.body.classList.remove("overflow-hidden");
    if (state.lastFocus instanceof HTMLElement) state.lastFocus.focus();
  }

  function resetClosingForm() {
    state.currentPreview = null;
    ++state.previewRequest;
    if (el("fechamento-funcionario")) el("fechamento-funcionario").value = "";
    const period = getPeriod() || { start: "", end: "" };
    ["fechamento-inicio", "fechamento-fim"].forEach((id, index) => {
      if (el(id)) el(id).value = index ? period.end : period.start;
    });
    ["fechamento-prev", "fechamento-prev-hora", "fechamento-meio"].forEach(
      (id) => {
        if (el(id)) el(id).value = "";
      },
    );
    [
      "fechamento-kpi-pendente",
      "fechamento-kpi-itens",
      "fechamento-kpi-excluidos",
    ].forEach((id) => {
      if (el(id)) el(id).textContent = "--";
    });
    if (el("fechamento-preview-status"))
      el("fechamento-preview-status").textContent =
        "Selecione funcionário e período para conferir.";
    if (el("fechamento-salvar")) el("fechamento-salvar").disabled = true;
    if (el("fechamento-ver-detalhes"))
      el("fechamento-ver-detalhes").disabled = true;
  }

  function schedulePreview() {
    window.clearTimeout(state.previewTimer);
    ++state.previewRequest;
    state.previewTimer = window.setTimeout(updateClosingPreview, 250);
  }

  async function updateClosingPreview() {
    const request = ++state.previewRequest;
    const professional = el("fechamento-funcionario")?.value || "";
    const store = el("empresa-select")?.value || "";
    const start = toYmd(el("fechamento-inicio")?.value);
    const end = toYmd(el("fechamento-fim")?.value);
    state.currentPreview = null;
    if (el("fechamento-salvar")) el("fechamento-salvar").disabled = true;
    if (!professional || !store || !start || !end || start > end) return;
    if (el("fechamento-preview-status"))
      el("fechamento-preview-status").innerHTML =
        '<i class="fas fa-spinner fa-spin mr-2"></i>Conferindo itens...';
    try {
      const query = new URLSearchParams({
        profissionalId: professional,
        store,
        start,
        end,
        details: "1",
      });
      const preview = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/preview?${query}`,
        { headers: authHeaders() },
      );
      if (request !== state.previewRequest) return;
      state.currentPreview = preview;
      const itemCount = (preview.items || []).length;
      const excludedCount = (preview.eligibility?.exclusions || []).length;
      const total = numberValue(preview.totals?.totalPeriodo);
      if (el("fechamento-kpi-pendente"))
        el("fechamento-kpi-pendente").textContent = formatMoney(total);
      if (el("fechamento-kpi-itens"))
        el("fechamento-kpi-itens").textContent = String(itemCount);
      if (el("fechamento-kpi-excluidos"))
        el("fechamento-kpi-excluidos").textContent = String(excludedCount);
      if (el("fechamento-preview-status"))
        el("fechamento-preview-status").textContent =
          total > 0
            ? `${itemCount} item(ns) novo(s) pronto(s) para congelar.`
            : "Nenhum item novo finalizado, pago e com comissão positiva.";
      if (el("fechamento-salvar"))
        el("fechamento-salvar").disabled = total <= 0 || !itemCount;
      if (el("fechamento-ver-detalhes"))
        el("fechamento-ver-detalhes").disabled = itemCount + excludedCount <= 0;
    } catch (error) {
      if (request === state.previewRequest && el("fechamento-preview-status"))
        el("fechamento-preview-status").textContent = error.message;
    }
  }

  function openClosing(row = null) {
    resetClosingForm();
    if (row) {
      el("fechamento-funcionario").value = String(row.profissional || "");
      el("fechamento-inicio").value = toYmd(row.periodoInicio);
      el("fechamento-fim").value = toYmd(row.periodoFim);
    }
    openModal("modal-fechamento");
    updateClosingPreview();
  }

  async function saveClosing() {
    const button = el("fechamento-salvar");
    const professional = el("fechamento-funcionario")?.value || "";
    const store = el("empresa-select")?.value || "";
    const start = toYmd(el("fechamento-inicio")?.value);
    const end = toYmd(el("fechamento-fim")?.value);
    const paymentDate = toYmd(el("fechamento-prev")?.value);
    const paymentTime = el("fechamento-prev-hora")?.value || "";
    if (
      !professional ||
      !store ||
      !start ||
      !end ||
      start > end ||
      ((paymentDate || paymentTime) && !(paymentDate && paymentTime))
    ) {
      showFeedback(
        "Confira funcionário, período e eventual previsão de pagamento.",
        "error",
      );
      return;
    }
    setButtonBusy(button, true, "Fechando...");
    try {
      await fetchJson(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          profissionalId: professional,
          storeId: store,
          inicio: start,
          fim: end,
          previsaoPagamentoData: paymentDate,
          previsaoPagamentoHora: paymentTime,
          meioPagamento: el("fechamento-meio")?.value || "",
        }),
      });
      closeModal("modal-fechamento");
      showFeedback(
        "Fechamento criado, itens congelados e conta a pagar sincronizada.",
        "success",
      );
      await loadReport();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setButtonBusy(button, false);
      button.disabled =
        !state.currentPreview ||
        numberValue(state.currentPreview.totals?.totalPeriodo) <= 0;
    }
  }

  function findClosing(id) {
    const key = String(id || "");
    return (
      state.report.history.find((item) => String(item.id) === key) ||
      state.report.items.find(
        (item) => String(item.closingId || item.id) === key,
      ) ||
      null
    );
  }

  function findReportRowByProfessional(id) {
    return (
      state.report.items.find(
        (item) => String(item.profissional) === String(id),
      ) || null
    );
  }

  function openPayment(item) {
    state.currentPayment = item;
    const now = new Date();
    el("pagamento-profissional").textContent = item.profissionalNome || "--";
    el("pagamento-periodo").textContent =
      item.periodo || formatPeriod(item.periodoInicio, item.periodoFim);
    el("pagamento-valor").textContent = formatMoney(
      item.totalPendente || item.totalPeriodo,
    );
    el("pagamento-data").value = formatInputDate(now);
    el("pagamento-hora").value = formatInputTime(now);
    el("pagamento-meio").value = item.meioPagamento || "";
    el("pagamento-referencia").value = "";
    el("pagamento-comprovante").value = "";
    el("pagamento-confirmar").checked = false;
    el("pagamento-salvar").disabled = true;
    const required =
      state.config.requireSecondApproval === true &&
      numberValue(item.totalPeriodo) >=
        numberValue(state.config.secondApprovalThreshold);
    const hint = el("pagamento-approval-hint");
    hint.classList.toggle("hidden", !required);
    hint.textContent = required
      ? "Após registrar, outro administrador deverá aprovar antes de o pagamento ser concluído."
      : "";
    el("pagamento-salvar").textContent = required
      ? "Enviar para aprovação"
      : "Registrar pagamento";
    openModal("modal-pagamento");
  }

  function updatePaymentButton() {
    const file = el("pagamento-comprovante")?.files?.[0];
    const fileValid =
      !file ||
      (file.size <= 5 * 1024 * 1024 &&
        ["application/pdf", "image/jpeg", "image/png"].includes(file.type));
    const valid = Boolean(
      el("pagamento-confirmar")?.checked &&
      toYmd(el("pagamento-data")?.value) &&
      el("pagamento-hora")?.value &&
      el("pagamento-meio")?.value &&
      fileValid,
    );
    if (el("pagamento-salvar")) el("pagamento-salvar").disabled = !valid;
    if (file && !fileValid)
      showFeedback(
        "O comprovante deve ser PDF, JPG ou PNG e ter no máximo 5 MB.",
        "warning",
      );
  }

  async function savePayment() {
    const item = state.currentPayment;
    const id = String(item?.closingId || item?.id || "");
    if (!id) return;
    const button = el("pagamento-salvar");
    const form = new FormData();
    form.append("confirm", "true");
    form.append("amount", String(numberValue(item.totalPeriodo)));
    form.append("paymentDate", toYmd(el("pagamento-data").value));
    form.append("paymentTime", el("pagamento-hora").value);
    form.append("paymentMethod", el("pagamento-meio").value);
    form.append("paymentReference", el("pagamento-referencia").value.trim());
    const file = el("pagamento-comprovante").files?.[0];
    if (file) form.append("receipt", file);
    setButtonBusy(button, true, "Registrando...");
    try {
      const result = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(id)}/pay`,
        { method: "POST", headers: authHeaders(), body: form },
      );
      closeModal("modal-pagamento");
      state.currentPayment = null;
      showFeedback(
        result.approvalRequired
          ? "Pagamento enviado para segunda aprovação."
          : "Pagamento registrado com os dados reais e a conta a pagar atualizada.",
        "success",
      );
      await loadReport();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setButtonBusy(button, false);
      updatePaymentButton();
    }
  }

  function openApproval(item) {
    state.currentApproval = item;
    el("aprovacao-contexto").textContent =
      `${item.profissionalNome || "--"} · ${item.periodo || formatPeriod(item.periodoInicio, item.periodoFim)} · ${formatMoney(item.totalPeriodo)}`;
    el("aprovacao-motivo").value = "";
    openModal("modal-aprovacao");
  }

  async function reviewPayment(decision) {
    const item = state.currentApproval;
    const id = String(item?.closingId || item?.id || "");
    const reason = el("aprovacao-motivo").value.trim();
    if (!id || (decision === "reject" && reason.length < 5)) {
      showFeedback(
        "Informe um motivo com pelo menos 5 caracteres para rejeitar.",
        "warning",
      );
      return;
    }
    const button =
      decision === "approve"
        ? el("aprovacao-aprovar")
        : el("aprovacao-rejeitar");
    setButtonBusy(
      button,
      true,
      decision === "approve" ? "Aprovando..." : "Rejeitando...",
    );
    try {
      const result = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(id)}/payment-approval`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, decision, reason }),
        },
      );
      closeModal("modal-aprovacao");
      showFeedback(result.message || "Revisão concluída.", "success");
      await loadReport();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  }

  function openCancellation(item) {
    state.currentCancellation = item;
    el("cancelamento-contexto").textContent =
      `${item.profissionalNome || "--"} · ${item.periodo || formatPeriod(item.periodoInicio, item.periodoFim)}`;
    el("cancelamento-motivo").value = "";
    el("cancelamento-reverter-pago").checked = false;
    const paid = item.status === "pago";
    el("cancelamento-pago-wrap").classList.toggle("hidden", !paid);
    el("cancelamento-pago-wrap").classList.toggle("flex", paid);
    el("cancelamento-salvar").disabled = true;
    openModal("modal-cancelamento");
  }

  function updateCancellationButton() {
    const paid = state.currentCancellation?.status === "pago";
    el("cancelamento-salvar").disabled =
      el("cancelamento-motivo").value.trim().length < 5 ||
      (paid && !el("cancelamento-reverter-pago").checked);
  }

  async function saveCancellation() {
    const item = state.currentCancellation;
    const id = String(item?.closingId || item?.id || "");
    const reason = el("cancelamento-motivo").value.trim();
    if (!id || reason.length < 5) return;
    const button = el("cancelamento-salvar");
    setButtonBusy(button, true, "Cancelando...");
    try {
      await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(id)}/cancel`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            confirmPaidReversal:
              item.status === "pago" &&
              el("cancelamento-reverter-pago").checked,
            reason,
          }),
        },
      );
      closeModal("modal-cancelamento");
      showFeedback(
        "Fechamento cancelado; histórico preservado e itens liberados.",
        "success",
      );
      await loadReport();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setButtonBusy(button, false);
      updateCancellationButton();
    }
  }

  function detailCards(items, excluded = false) {
    if (!items.length)
      return `<p class="p-4 text-center text-sm text-gray-500">Nenhum item ${excluded ? "excluído" : "incluído"}.</p>`;
    return items
      .map(
        (item) =>
          `<article class="commission-detail-row p-3 text-sm"><div><p class="font-semibold">${escapeHtml(formatDate(item.date))}${item.time ? ` ${escapeHtml(item.time)}` : ""}</p><p class="text-[11px] text-gray-500">${item.source === "appointment_service" ? "Agenda" : "PDV"}</p></div><div><p class="font-semibold">${escapeHtml(item.petName || (item.source === "pdv_product" ? "Venda PDV" : "--"))}</p><p class="text-[11px] text-gray-500">Venda ${escapeHtml(item.saleCode || "--")}</p></div><div data-detail-wide class="min-w-0"><p class="break-words">${escapeHtml(item.description || "--")}</p>${excluded ? `<p class="text-xs text-red-700">${escapeHtml(item.reason || "--")}</p>` : `<p class="text-[11px] text-gray-500">${numberValue(item.percent).toFixed(2)}%</p>`}</div><div class="text-right"><p class="text-[10px] uppercase text-gray-500">Valor</p><p>${formatMoney(item.value)}</p></div><div class="text-right"><p class="text-[10px] uppercase text-gray-500">${excluded ? "Situação" : "Comissão"}</p><p class="font-bold ${excluded ? "text-red-700" : ""}">${excluded ? "Excluído" : formatMoney(item.commission)}</p></div></article>`,
      )
      .join("");
  }

  function renderDetails(payload, context = {}) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const exclusions = Array.isArray(payload.exclusions)
      ? payload.exclusions
      : Array.isArray(payload.eligibility?.exclusions)
        ? payload.eligibility.exclusions
        : [];
    const totals = payload.totals || {};
    const pagination = payload.pagination || {
      page: 1,
      pageCount: 1,
      totalItems: items.length,
      unfilteredItems: items.length,
    };
    el("detalhes-subtitulo").textContent =
      `${context.professionalName || payload.closing?.profissionalNome || "Profissional"} · ${context.subtitle || payload.closing?.periodo || formatPeriod(context.start, context.end)}`;
    const warning = payload.warning || "";
    el("detalhes-alerta").textContent = warning;
    el("detalhes-alerta").className = warning
      ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      : "hidden";
    el("detalhes-kpis").innerHTML = [
      ["Itens", totals.itemCount ?? pagination.unfilteredItems ?? items.length],
      [
        "Valor base",
        formatMoney(
          totals.value ??
            items.reduce((sum, item) => sum + numberValue(item.value), 0),
        ),
      ],
      ["Comissão", formatMoney(totals.commission ?? totals.totalPeriodo)],
      ["Excluídos", totals.excludedCount ?? exclusions.length],
    ]
      .map(
        ([label, value]) =>
          `<article class="rounded-lg bg-gray-50 p-2.5"><p class="text-[10px] font-bold uppercase text-gray-500">${label}</p><p class="font-bold">${escapeHtml(value)}</p></article>`,
      )
      .join("");
    el("detalhes-incluidos").innerHTML = detailCards(items);
    el("detalhes-excluidos").innerHTML = detailCards(exclusions, true);
    el("detalhes-count").textContent =
      `${pagination.totalItems ?? items.length} resultado(s)`;
    el("detalhes-excluded-count").textContent = `(${exclusions.length})`;
    el("detalhes-pagination").innerHTML =
      `<span class="text-xs text-gray-500">Página ${pagination.page || 1} de ${pagination.pageCount || 1}</span><div class="flex gap-1.5"><button type="button" data-detail-page="previous" class="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40" ${(pagination.page || 1) <= 1 ? "disabled" : ""}>Anterior</button><button type="button" data-detail-page="next" class="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40" ${(pagination.page || 1) >= (pagination.pageCount || 1) ? "disabled" : ""}>Próxima</button></div>`;
    const receiptButton = el("detalhes-comprovante");
    const receiptId =
      payload.closing?.hasPaymentReceipt && payload.closing?.id
        ? String(payload.closing.id)
        : "";
    receiptButton.classList.toggle("hidden", !receiptId);
    receiptButton.dataset.id = receiptId;
    state.currentDetail = { ...(state.currentDetail || {}), payload, context };
  }

  async function loadClosingDetails(page = 1) {
    const detail = state.currentDetail;
    if (!detail?.closingId) return;
    const request = ++state.detailRequest;
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    const search = el("detalhes-busca")?.value.trim();
    const source = el("detalhes-origem")?.value;
    if (search) query.set("search", search);
    if (source) query.set("source", source);
    const payload = await fetchJson(
      `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(detail.closingId)}/details?${query}`,
      { headers: authHeaders() },
    );
    if (request !== state.detailRequest) return;
    renderDetails(payload, detail.context);
  }

  async function openDetails({
    closingId = "",
    professionalId = "",
    row = null,
  } = {}) {
    try {
      if (el("detalhes-busca")) el("detalhes-busca").value = "";
      if (el("detalhes-origem")) el("detalhes-origem").value = "";
      if (closingId && !String(closingId).startsWith("report-")) {
        state.currentDetail = { closingId, context: {} };
        await loadClosingDetails(1);
      } else {
        const target = row || findReportRowByProfessional(professionalId);
        const period = target
          ? {
              start: toYmd(target.periodoInicio),
              end: toYmd(target.periodoFim),
            }
          : {
              start: toYmd(el("fechamento-inicio").value),
              end: toYmd(el("fechamento-fim").value),
            };
        const professional =
          professionalId ||
          target?.profissional ||
          el("fechamento-funcionario").value;
        const query = new URLSearchParams({
          profissionalId: professional,
          store: el("empresa-select").value,
          start: period.start,
          end: period.end,
          details: "1",
        });
        const preview = await fetchJson(
          `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/preview?${query}`,
          { headers: authHeaders() },
        );
        const context = {
          professionalName:
            target?.profissionalNome ||
            state.professionals.find(
              (item) => String(item.id) === String(professional),
            )?.nome,
          start: period.start,
          end: period.end,
        };
        const payload = {
          items: preview.items || [],
          exclusions: preview.eligibility?.exclusions || [],
          totals: {
            itemCount: (preview.items || []).length,
            totalPeriodo: preview.totals?.totalPeriodo,
            value: (preview.items || []).reduce(
              (sum, item) => sum + numberValue(item.value),
              0,
            ),
            excludedCount: (preview.eligibility?.exclusions || []).length,
          },
          warning: numberValue(preview.alreadyClosedItems)
            ? `${numberValue(preview.alreadyClosedItems)} item(ns) já pertencem a fechamentos anteriores.`
            : "",
        };
        state.currentDetail = { previewPayload: payload, context };
        renderDetails(payload, context);
      }
      openModal("modal-detalhes");
    } catch (error) {
      showFeedback(
        error.message || "Não foi possível carregar detalhes.",
        "error",
      );
    }
  }

  function scheduleDetailFilter() {
    window.clearTimeout(state.detailTimer);
    state.detailTimer = window.setTimeout(() => {
      if (state.currentDetail?.closingId)
        loadClosingDetails(1).catch((error) =>
          showFeedback(error.message, "error"),
        );
      else if (state.currentDetail?.previewPayload) {
        const base = state.currentDetail.previewPayload;
        const search = normalizeSearch(el("detalhes-busca").value);
        const source = el("detalhes-origem").value;
        const items = base.items.filter(
          (item) =>
            (!source || item.source === source) &&
            (!search ||
              normalizeSearch(
                `${item.petName} ${item.description} ${item.saleCode} ${item.date} ${item.time}`,
              ).includes(search)),
        );
        renderDetails(
          {
            ...base,
            items,
            totals: { ...base.totals, filteredItemCount: items.length },
            pagination: {
              page: 1,
              pageCount: 1,
              totalItems: items.length,
              unfilteredItems: base.items.length,
            },
          },
          state.currentDetail.context,
        );
      }
    }, 250);
  }

  async function allCurrentDetailItems() {
    const detail = state.currentDetail;
    if (!detail) return [];
    if (!detail.closingId) return detail.payload?.items || [];
    const first = detail.payload;
    const total = numberValue(first?.pagination?.totalItems);
    if (total <= (first?.items || []).length) return first?.items || [];
    const items = [];
    const pageCount = Math.ceil(total / 200);
    for (let page = 1; page <= pageCount; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "200",
      });
      const search = el("detalhes-busca").value.trim();
      const source = el("detalhes-origem").value;
      if (search) query.set("search", search);
      if (source) query.set("source", source);
      // A exportação reúne todas as páginas do mesmo filtro.
      // eslint-disable-next-line no-await-in-loop
      const payload = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(detail.closingId)}/details?${query}`,
        { headers: authHeaders() },
      );
      items.push(...(payload.items || []));
    }
    return items;
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }
  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reportRowsForExport() {
    return sortedItems(state.filteredItems).map((item) => [
      item.codigoProfissional || "",
      item.profissionalNome || "",
      item.tipo || "",
      toYmd(item.periodoInicio),
      toYmd(item.periodoFim),
      numberValue(item.totalPeriodo).toFixed(2).replace(".", ","),
      numberValue(item.totalPago).toFixed(2).replace(".", ","),
      numberValue(item.totalPendente).toFixed(2).replace(".", ","),
      item.status || "",
      `${toYmd(item.previsaoPagamentoData)} ${item.previsaoPagamentoHora || ""}`.trim(),
      `${toYmd(item.paidDate)} ${item.paidTime || ""}`.trim(),
      item.meioPagamento || "",
      item.paymentReference || "",
    ]);
  }

  function exportReport(format) {
    const period = getPeriod({ showError: true });
    if (!period || !state.filteredItems.length)
      return showFeedback("Não há registros para exportar.", "warning");
    const header = [
      "Código",
      "Profissional",
      "Tipo",
      "Data inicial",
      "Data final",
      "Comissão",
      "Pago",
      "Pendente",
      "Status",
      "Previsão",
      "Pagamento real",
      "Meio",
      "Referência",
    ];
    const rows = reportRowsForExport();
    if (format === "csv") {
      downloadBlob(
        new Blob(
          [
            `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`,
          ],
          { type: "text/csv;charset=utf-8" },
        ),
        `comissoes-${period.start}-a-${period.end}.csv`,
      );
    } else {
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
      downloadBlob(
        new Blob([`\uFEFF${html}`], {
          type: "application/vnd.ms-excel;charset=utf-8",
        }),
        `comissoes-${period.start}-a-${period.end}.xls`,
      );
    }
    showFeedback(`${rows.length} registro(s) exportado(s).`, "success");
  }

  async function exportDetails(format) {
    const items = await allCurrentDetailItems();
    if (!items.length)
      return showFeedback("Não há itens para exportar.", "warning");
    const header = [
      "Data",
      "Hora",
      "Origem",
      "Pet",
      "Item",
      "Venda",
      "Valor",
      "Percentual",
      "Comissão",
    ];
    const rows = items.map((item) => [
      toYmd(item.date),
      item.time || "",
      item.source === "appointment_service" ? "Agenda" : "PDV",
      item.petName || "",
      item.description || "",
      item.saleCode || "",
      numberValue(item.value).toFixed(2).replace(".", ","),
      numberValue(item.percent).toFixed(2).replace(".", ","),
      numberValue(item.commission).toFixed(2).replace(".", ","),
    ]);
    const slug = `itens-comissao-${toYmd(items[0]?.date) || "periodo"}`;
    if (format === "csv")
      downloadBlob(
        new Blob(
          [
            `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`,
          ],
          { type: "text/csv;charset=utf-8" },
        ),
        `${slug}.csv`,
      );
    else {
      const html = `<html><head><meta charset="utf-8"></head><body><table><thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
      downloadBlob(
        new Blob([`\uFEFF${html}`], {
          type: "application/vnd.ms-excel;charset=utf-8",
        }),
        `${slug}.xls`,
      );
    }
  }

  async function printCurrentDetails() {
    const items = await allCurrentDetailItems();
    const detail = state.currentDetail || {};
    const title = `Comissões - ${detail.context?.professionalName || detail.payload?.closing?.profissionalNome || "Profissional"}`;
    const subtitle =
      detail.context?.subtitle ||
      detail.payload?.closing?.periodo ||
      formatPeriod(detail.context?.start, detail.context?.end);
    const popup = window.open("", "_blank", "width=1050,height=760");
    if (!popup)
      return showFeedback("Permita pop-ups para gerar o PDF.", "warning");
    const rows = items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(formatDate(item.date))} ${escapeHtml(item.time || "")}</td><td>${escapeHtml(item.petName || "PDV")}</td><td>${escapeHtml(item.description || "--")}</td><td>${escapeHtml(item.saleCode || "--")}</td><td class="num">${formatMoney(item.value)}</td><td class="num">${numberValue(item.percent).toFixed(2)}%</td><td class="num">${formatMoney(item.commission)}</td></tr>`,
      )
      .join("");
    popup.document.open();
    popup.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:10mm}body{font:11px Arial;color:#111827}h1{font-size:17px;margin:0 0 4px}.meta{color:#4b5563;margin-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:5px;text-align:left}th{background:#f3f4f6;font-size:9px;text-transform:uppercase}.num{text-align:right;white-space:nowrap}</style></head><body><h1>${escapeHtml(title)}</h1><div class="meta">Período: ${escapeHtml(subtitle)} · Gerado em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</div><table><thead><tr><th>Data/hora</th><th>Pet/origem</th><th>Item</th><th>Venda</th><th>Valor</th><th>%</th><th>Comissão</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){window.print();};<\/script></body></html>`,
    );
    popup.document.close();
  }

  async function downloadReceipt(id) {
    try {
      const response = await fetch(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(id)}/receipt`,
        { headers: authHeaders(), cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.message || "Não foi possível baixar o comprovante.",
        );
      }
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = match
        ? decodeURIComponent(match[1])
        : `comprovante-${id}`;
      downloadBlob(await response.blob(), filename);
    } catch (error) {
      showFeedback(error.message, "error");
    }
  }

  async function loadConfig() {
    const request = ++state.configRequest;
    const store = el("empresa-select")?.value || "";
    if (!store) return;
    try {
      const data = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/config/data?store=${encodeURIComponent(store)}`,
        { headers: authHeaders() },
      );
      if (request !== state.configRequest) return;
      state.config = data.config || {};
      setSelectOptions(
        el("config-accounting"),
        (data.accounts || []).map((item) => ({
          id: item._id,
          nome: `${item.code || ""} - ${item.name || ""}`,
        })),
        { placeholder: "Selecione" },
      );
      setSelectOptions(
        el("config-bankaccount"),
        (data.bankAccounts || []).map((item) => ({
          id: item._id,
          nome: `${item.alias || item.bankName || "Conta"} · Ag. ${item.agency || "--"} · Cc. ${item.accountNumber || "--"}${item.accountDigit ? `-${item.accountDigit}` : ""}`,
        })),
        { placeholder: "Selecione" },
      );
      el("config-accounting").value = state.config.accountingAccount || "";
      el("config-bankaccount").value = state.config.bankAccount || "";
      el("config-include-services").checked =
        state.config.includeServices !== false;
      el("config-include-pdv-sales").checked =
        state.config.includePdvSales !== false;
      el("config-second-approval").checked =
        state.config.requireSecondApproval === true;
      el("config-approval-threshold").value = String(
        numberValue(state.config.secondApprovalThreshold),
      );
      el("config-approval-threshold").disabled = !el("config-second-approval")
        .checked;
      el("config-notify-overdue").checked =
        state.config.notifyOverdue !== false;
      [
        ["close", "closeRoles"],
        ["pay", "payRoles"],
        ["cancel", "cancelRoles"],
        ["configure", "configureRoles"],
      ].forEach(([id, field]) => {
        el(`config-role-${id}-admin`).checked = (
          state.config[field] || ["admin", "admin_master"]
        ).includes("admin");
      });
      const selected = state.stores.find((item) => String(item._id) === store);
      el("config-empresa-nome").textContent =
        selected?.nome || "Empresa selecionada";
      applyPermissions();
    } catch (error) {
      showFeedback(error.message, "error");
    }
  }

  async function openConfig() {
    if (!el("empresa-select")?.value)
      return showFeedback("Selecione uma empresa.", "warning");
    await loadConfig();
    openModal("modal-configuracoes");
  }

  function rolesFor(id) {
    return el(`config-role-${id}-admin`).checked
      ? ["admin", "admin_master"]
      : ["admin_master"];
  }

  async function saveConfig() {
    const button = el("config-salvar");
    setButtonBusy(button, true, "Salvando...");
    try {
      state.config = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/config`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: el("empresa-select").value,
            accountingAccount: el("config-accounting").value || null,
            bankAccount: el("config-bankaccount").value || null,
            includeServices: el("config-include-services").checked,
            includePdvSales: el("config-include-pdv-sales").checked,
            requireSecondApproval: el("config-second-approval").checked,
            secondApprovalThreshold: numberValue(
              el("config-approval-threshold").value,
            ),
            notifyOverdue: el("config-notify-overdue").checked,
            closeRoles: rolesFor("close"),
            payRoles: rolesFor("pay"),
            cancelRoles: rolesFor("cancel"),
            configureRoles: rolesFor("configure"),
          }),
        },
      );
      closeModal("modal-configuracoes");
      showFeedback("Configuração salva e relatório recalculado.", "success");
      await loadReport();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setButtonBusy(button, false);
      applyPermissions();
    }
  }

  function openReconciliation(action, id) {
    const item = findClosing(id);
    state.currentReconciliation = { action, id, item };
    const titles = {
      repair_payable: "Reparar vínculo e status da conta a pagar",
      reconcile_snapshot: "Congelar itens do fechamento legado",
      complete_payment_metadata: "Completar dados reais do pagamento",
    };
    el("reconcile-title").textContent = titles[action] || "Corrigir pendência";
    el("reconcile-context").textContent =
      `${item?.profissionalNome || "Fechamento"} · ${item?.periodo || ""}`;
    el("reconcile-reason").value = "";
    el("reconcile-confirm").checked = false;
    el("reconcile-save").disabled = true;
    el("reconcile-fields").innerHTML =
      action === "complete_payment_metadata"
        ? `<div class="grid grid-cols-2 gap-2"><label class="text-xs font-bold uppercase text-gray-500">Data real<input id="reconcile-payment-date" type="date" value="${escapeHtml(item?.paidDate || "")}" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label><label class="text-xs font-bold uppercase text-gray-500">Hora real<input id="reconcile-payment-time" type="time" value="${escapeHtml(item?.paidTime || "")}" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label></div><label class="mt-2 block text-xs font-bold uppercase text-gray-500">Meio<input id="reconcile-payment-method" value="${escapeHtml(item?.meioPagamento || "")}" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal normal-case" /></label><label class="mt-2 block text-xs font-bold uppercase text-gray-500">Referência<input id="reconcile-payment-reference" maxlength="180" value="${escapeHtml(item?.paymentReference || "")}" class="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal normal-case" /></label><label class="mt-2 block text-xs font-bold uppercase text-gray-500">Comprovante opcional<input id="reconcile-receipt" type="file" accept="application/pdf,image/jpeg,image/png" class="mt-1 w-full rounded-lg border p-2 text-xs font-normal normal-case" /></label>`
        : `<p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">${action === "repair_payable" ? "A conta será recriada ou alinhada ao estado atual do fechamento, usando apenas a configuração desta empresa." : "Os itens serão recalculados pelas datas literais e só serão congelados se o total coincidir exatamente com o fechamento histórico."}</p>`;
    openModal("modal-reconciliacao");
  }

  function updateReconcileButton() {
    el("reconcile-save").disabled = !(
      el("reconcile-confirm").checked &&
      el("reconcile-reason").value.trim().length >= 5
    );
  }

  async function saveReconciliation() {
    const current = state.currentReconciliation;
    if (!current?.id) return;
    const form = new FormData();
    form.append("confirm", "true");
    form.append("action", current.action);
    form.append("reason", el("reconcile-reason").value.trim());
    if (current.action === "complete_payment_metadata") {
      form.append("paymentDate", el("reconcile-payment-date")?.value || "");
      form.append("paymentTime", el("reconcile-payment-time")?.value || "");
      form.append("paymentMethod", el("reconcile-payment-method")?.value || "");
      form.append(
        "paymentReference",
        el("reconcile-payment-reference")?.value || "",
      );
      const file = el("reconcile-receipt")?.files?.[0];
      if (file) form.append("receipt", file);
    }
    const button = el("reconcile-save");
    setButtonBusy(button, true, "Corrigindo...");
    try {
      const result = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${encodeURIComponent(current.id)}/reconcile`,
        { method: "POST", headers: authHeaders(), body: form },
      );
      closeModal("modal-reconciliacao");
      showFeedback(result.message || "Reconciliação concluída.", "success");
      await loadReport();
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setButtonBusy(button, false);
      updateReconcileButton();
    }
  }

  function savedViewsKey() {
    const user = loggedUser();
    return `commissionClosingViews:${user.id || user._id || user.email || "local"}`;
  }
  function readSavedViews() {
    try {
      return JSON.parse(localStorage.getItem(savedViewsKey()) || "[]");
    } catch {
      return [];
    }
  }
  function writeSavedViews(views) {
    localStorage.setItem(savedViewsKey(), JSON.stringify(views.slice(0, 12)));
    renderSavedViews();
  }
  function renderSavedViews() {
    const views = readSavedViews();
    setSelectOptions(
      el("saved-view-select"),
      views.map((view) => ({ id: view.id, nome: view.name })),
      { placeholder: "Nenhuma" },
    );
    el("btn-excluir-visao").disabled = !el("saved-view-select").value;
  }
  function saveCurrentView() {
    const name = window.prompt("Nome desta visão:")?.trim();
    if (!name) return;
    const views = readSavedViews();
    const view = {
      id: `${Date.now()}`,
      name: name.slice(0, 50),
      store: el("empresa-select").value,
      start: el("filtro-inicio").value,
      end: el("filtro-fim").value,
      status: el("filtro-status").value,
      search: el("filtro-busca").value,
      sort: `${state.sort.key}:${state.sort.direction}`,
      pageSize: state.reportPageSize,
    };
    writeSavedViews([
      view,
      ...views.filter(
        (item) => normalizeSearch(item.name) !== normalizeSearch(view.name),
      ),
    ]);
    el("saved-view-select").value = view.id;
    el("btn-excluir-visao").disabled = false;
  }
  async function applySavedView() {
    const view = readSavedViews().find(
      (item) => item.id === el("saved-view-select").value,
    );
    el("btn-excluir-visao").disabled = !view;
    if (!view) return;
    const storeChanged =
      view.store &&
      state.stores.some((item) => String(item._id) === String(view.store)) &&
      el("empresa-select").value !== view.store;
    if (view.store) el("empresa-select").value = view.store;
    el("filtro-inicio").value = view.start || el("filtro-inicio").value;
    el("filtro-fim").value = view.end || el("filtro-fim").value;
    el("filtro-status").value = view.status || "";
    el("filtro-busca").value = view.search || "";
    const [key, direction] = String(view.sort || "profissionalNome:asc").split(
      ":",
    );
    state.sort = { key, direction };
    el("report-sort").value = `${key}:${direction}`;
    state.reportPageSize = numberValue(view.pageSize) || 20;
    el("report-page-size").value = String(state.reportPageSize);
    if (storeChanged) await Promise.all([loadProfessionals(), loadConfig()]);
    await loadReport();
  }
  function deleteSavedView() {
    const id = el("saved-view-select").value;
    if (!id || !window.confirm("Excluir esta visão salva?")) return;
    writeSavedViews(readSavedViews().filter((item) => item.id !== id));
  }

  function analyticsList(title, rows, labelKey) {
    const max = Math.max(
      1,
      ...(rows || []).map((row) => numberValue(row.commission)),
    );
    return `<section class="rounded-xl border p-3"><h3 class="mb-3 font-bold">${escapeHtml(title)}</h3><div class="space-y-2">${
      (rows || [])
        .slice(0, 12)
        .map(
          (row) =>
            `<div><div class="flex justify-between gap-2 text-xs"><span class="truncate">${escapeHtml(row[labelKey] || "--")}</span><strong>${formatMoney(row.commission)}</strong></div><div class="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100"><div class="h-full rounded-full bg-indigo-500" style="width:${Math.max(2, (numberValue(row.commission) / max) * 100).toFixed(1)}%"></div></div></div>`,
        )
        .join("") || '<p class="text-sm text-gray-500">Sem dados.</p>'
    }</div></section>`;
  }
  async function openAnalytics() {
    const period = getPeriod({ showError: true });
    if (!period) return;
    openModal("modal-analytics");
    el("analytics-content").innerHTML =
      '<p class="py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando...</p>';
    try {
      const query = new URLSearchParams({
        store: el("empresa-select").value,
        start: period.start,
        end: period.end,
      });
      const data = await fetchJson(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/analytics?${query}`,
        { headers: authHeaders() },
      );
      el("analytics-content").innerHTML =
        `<div class="grid grid-cols-3 gap-2"><article class="rounded-xl bg-indigo-50 p-3"><p class="text-[10px] font-bold uppercase text-indigo-700">Itens</p><p class="text-xl font-bold">${numberValue(data.totals?.itemCount)}</p></article><article class="rounded-xl bg-gray-50 p-3"><p class="text-[10px] font-bold uppercase text-gray-500">Valor base</p><p class="text-lg font-bold">${formatMoney(data.totals?.sourceValue)}</p></article><article class="rounded-xl bg-emerald-50 p-3"><p class="text-[10px] font-bold uppercase text-emerald-700">Comissão</p><p class="text-lg font-bold">${formatMoney(data.totals?.commission)}</p></article></div><div class="grid gap-3 lg:grid-cols-3">${analyticsList("Por profissional", data.byProfessional, "name")}${analyticsList("Por serviço/produto", data.byService, "name")}${analyticsList(
          "Por dia",
          (data.byDay || []).map((row) => ({
            ...row,
            label: formatDate(row.date),
          })),
          "label",
        )}</div><p class="text-xs text-gray-500">Base: itens atualmente elegíveis. Serviços usam itens.data/itens.hora e entram somente finalizados e pagos.</p>`;
    } catch (error) {
      el("analytics-content").innerHTML =
        `<p class="rounded-lg bg-red-50 p-3 text-sm text-red-700">${escapeHtml(error.message)}</p>`;
    }
  }

  async function handleAction(action, id, professionalId) {
    const item = id
      ? findClosing(id)
      : findReportRowByProfessional(professionalId);
    if (action === "close") openClosing(item);
    else if (action === "pay" && item) openPayment(item);
    else if (action === "approve" && item) openApproval(item);
    else if (action === "cancel" && item) openCancellation(item);
    else if (action === "receipt" && id) downloadReceipt(id);
    else if (action === "details")
      openDetails({
        closingId: id,
        professionalId: professionalId || item?.profissional,
        row: item,
      });
  }

  function bindActions() {
    el("btn-aplicar").addEventListener("click", loadReport);
    el("btn-atualizar").addEventListener("click", async () => {
      await Promise.all([loadConfig(), loadReport()]);
    });
    el("btn-limpar").addEventListener("click", () => {
      el("filtro-status").value = "";
      el("filtro-busca").value = "";
      setPeriodDefaults();
      loadReport();
    });
    el("filtro-status").addEventListener("change", () => applyLocalFilters());
    el("filtro-busca").addEventListener("input", () => applyLocalFilters());
    document
      .querySelectorAll("[data-period-preset]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          applyPeriodPreset(button.dataset.periodPreset),
        ),
      );
    el("mes-anterior").addEventListener("click", () => {
      setPeriodDefaults(
        new Date(
          state.currentMonth.getFullYear(),
          state.currentMonth.getMonth() - 1,
          1,
        ),
      );
      loadReport();
    });
    el("mes-proximo").addEventListener("click", () => {
      setPeriodDefaults(
        new Date(
          state.currentMonth.getFullYear(),
          state.currentMonth.getMonth() + 1,
          1,
        ),
      );
      loadReport();
    });
    el("empresa-select").addEventListener("change", async () => {
      resetClosingForm();
      await Promise.all([loadProfessionals(), loadConfig(), loadReport()]);
    });
    el("report-sort").addEventListener("change", () => {
      const [key, direction] = el("report-sort").value.split(":");
      state.sort = { key, direction };
      state.reportPage = 1;
      renderReportRows();
    });
    el("report-page-size").addEventListener("change", () => {
      state.reportPageSize = numberValue(el("report-page-size").value) || 20;
      state.reportPage = 1;
      renderReportRows();
    });
    el("history-search").addEventListener("input", () => {
      state.historyPage = 1;
      renderHistory();
    });
    el("history-status").addEventListener("change", () => {
      state.historyPage = 1;
      renderHistory();
    });
    el("btn-novo-fechamento").addEventListener("click", () => openClosing());
    el("btn-configuracoes").addEventListener("click", openConfig);
    el("btn-analytics").addEventListener("click", openAnalytics);
    el("btn-exportar-csv").addEventListener("click", () => exportReport("csv"));
    el("btn-exportar-excel").addEventListener("click", () =>
      exportReport("excel"),
    );
    el("btn-salvar-visao").addEventListener("click", saveCurrentView);
    el("saved-view-select").addEventListener("change", applySavedView);
    el("btn-excluir-visao").addEventListener("click", deleteSavedView);
    el("fechamento-salvar").addEventListener("click", saveClosing);
    el("fechamento-ver-detalhes").addEventListener("click", () =>
      openDetails(),
    );
    ["fechamento-funcionario", "fechamento-inicio", "fechamento-fim"].forEach(
      (id) => {
        el(id).addEventListener("change", schedulePreview);
        el(id).addEventListener("input", schedulePreview);
      },
    );
    [
      "pagamento-confirmar",
      "pagamento-data",
      "pagamento-hora",
      "pagamento-meio",
      "pagamento-comprovante",
    ].forEach((id) => {
      el(id).addEventListener("change", updatePaymentButton);
      el(id).addEventListener("input", updatePaymentButton);
    });
    el("pagamento-salvar").addEventListener("click", savePayment);
    el("aprovacao-aprovar").addEventListener("click", () =>
      reviewPayment("approve"),
    );
    el("aprovacao-rejeitar").addEventListener("click", () =>
      reviewPayment("reject"),
    );
    el("cancelamento-motivo").addEventListener(
      "input",
      updateCancellationButton,
    );
    el("cancelamento-reverter-pago").addEventListener(
      "change",
      updateCancellationButton,
    );
    el("cancelamento-salvar").addEventListener("click", saveCancellation);
    el("detalhes-busca").addEventListener("input", scheduleDetailFilter);
    el("detalhes-origem").addEventListener("change", scheduleDetailFilter);
    el("detalhes-imprimir").addEventListener("click", () =>
      printCurrentDetails().catch((error) =>
        showFeedback(error.message, "error"),
      ),
    );
    el("detalhes-csv").addEventListener("click", () =>
      exportDetails("csv").catch((error) =>
        showFeedback(error.message, "error"),
      ),
    );
    el("detalhes-excel").addEventListener("click", () =>
      exportDetails("excel").catch((error) =>
        showFeedback(error.message, "error"),
      ),
    );
    el("detalhes-comprovante").addEventListener("click", () =>
      downloadReceipt(el("detalhes-comprovante").dataset.id),
    );
    el("config-second-approval").addEventListener("change", () => {
      el("config-approval-threshold").disabled = !el("config-second-approval")
        .checked;
    });
    el("config-salvar").addEventListener("click", saveConfig);
    el("reconcile-reason").addEventListener("input", updateReconcileButton);
    el("reconcile-confirm").addEventListener("change", updateReconcileButton);
    el("reconcile-save").addEventListener("click", saveReconciliation);
    el("auditoria-toggle").addEventListener("click", () =>
      el("auditoria-list").classList.toggle("hidden"),
    );
    document.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (actionButton)
        handleAction(
          actionButton.dataset.action,
          actionButton.dataset.id || "",
          actionButton.dataset.profissional || "",
        );
      const issueButton = event.target.closest("[data-issue-action]");
      if (issueButton) {
        const action = issueButton.dataset.issueAction;
        const id = issueButton.dataset.id || "";
        if (action === "configure") openConfig();
        else if (action === "details") handleAction("details", id, "");
        else if (action === "pay") handleAction("pay", id, "");
        else if (action === "review_payment") handleAction("approve", id, "");
        else openReconciliation(action, id);
      }
      const page =
        event.target.closest("[data-page-action]")?.dataset.pageAction;
      if (page === "previous") {
        state.reportPage -= 1;
        renderReportRows();
      } else if (page === "next") {
        state.reportPage += 1;
        renderReportRows();
      } else if (page === "history-previous") {
        state.historyPage -= 1;
        renderHistory();
      } else if (page === "history-next") {
        state.historyPage += 1;
        renderHistory();
      }
      const detailPage =
        event.target.closest("[data-detail-page]")?.dataset.detailPage;
      if (detailPage && state.currentDetail?.payload?.pagination) {
        const current = state.currentDetail.payload.pagination.page || 1;
        loadClosingDetails(
          detailPage === "next" ? current + 1 : current - 1,
        ).catch((error) => showFeedback(error.message, "error"));
      }
    });
    document
      .querySelectorAll("[data-modal-close]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          closeModal(button.dataset.modalClose),
        ),
      );
    document.addEventListener("keydown", (event) => {
      const topId = state.modalStack[state.modalStack.length - 1];
      if (!topId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal(topId);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = modalFocusable(el(topId));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === focusable.at(-1)
      ) {
        event.preventDefault();
        focusable[0].focus();
      }
    });
  }

  async function init() {
    setPeriodDefaults();
    renderSavedViews();
    bindActions();
    setReportLoading(true);
    await loadStores();
    if (el("empresa-select").value)
      await Promise.all([loadProfessionals(), loadConfig(), loadReport()]);
    else setReportLoading(false);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
