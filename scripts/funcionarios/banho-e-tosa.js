(function () {
  const TOAST_DEDUP_KEY = '__agendaToastState';
  const TOAST_DEDUP_WINDOW = 1200;

  function getToastStore() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    if (typeof self !== 'undefined') return self;
    return null;
  }

  function getLastToast() {
    const store = getToastStore();
    return store && store[TOAST_DEDUP_KEY];
  }

  function rememberToast(text) {
    const store = getToastStore();
    if (!store) return;
    store[TOAST_DEDUP_KEY] = { text, time: Date.now() };
  }

  // Helper para requisições com token
  const token = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || null;
  function api(url, opts = {}) {
    return fetch(`${API_CONFIG.BASE_URL}${url}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  }

  // --- Permissões / Lock helpers ---
  function getCurrentRole() {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.role || 'cliente';
    } catch (_) { return 'cliente'; }
  }
  function isPrivilegedRole() {
    const r = getCurrentRole();
    return r === 'admin' || r === 'admin_master';
  }

  function notify(message, type = 'warning') {
    const text = String(message || '');
    if (!text) return;
    const hasWindow = typeof window !== 'undefined';

    const last = getLastToast();
    const now = Date.now();
    if (last && last.text === text && now - last.time < TOAST_DEDUP_WINDOW) {
      return;
    }

    if (hasWindow && typeof window.showToast === 'function') {
      try {
        window.showToast(text, type);
        rememberToast(text);
        return;
      } catch (err) {
        console.error('notify/showToast', err);
      }
    }

    if (hasWindow && typeof window.alert === 'function') {
      rememberToast(text);
      window.alert(text);
    } else if (typeof alert === 'function') {
      rememberToast(text);
      alert(text);
    } else {
      rememberToast(text);
    }
  }

  // --- Modal de Código de Venda ---
  let __vendaTargetId = null;

  function openVendaModal(item) {
      __vendaTargetId = item?._id || null;

      const m = document.getElementById('venda-modal');
      const input = document.getElementById('venda-codigo-input');
      const lab = document.getElementById('venda-modal-title');
      if (!m || !input) return;

      // fecha a modal de edição, se estiver aberta, para evitar “duas telas”
      try {
        const modalAdd = document.getElementById('modal-add-servico');
        if (modalAdd && !modalAdd.classList.contains('hidden')) {
          modalAdd.classList.add('hidden');
          modalAdd.classList.remove('flex');
        }
      } catch (_) {}

      if (lab) lab.textContent = `Registrar venda — ${item?.clienteNome || ''} | ${item?.pet || ''}`;
      input.value = item?.codigoVenda || '';

      // garante abertura VISÍVEL e no topo
      m.classList.remove('hidden');
      m.classList.add('flex');
      try {
        m.style.display = '';         // remove display inline residual
        m.style.zIndex = '9999';      // acima dos demais z-50
        m.style.pointerEvents = 'auto';
        m.setAttribute('aria-hidden', 'false');
      } catch (_) {}

      // foco no input
      requestAnimationFrame(() => { try { input.focus(); } catch(_){} });
    }

  function closeVendaModal() {
    __vendaTargetId = null;
    const m = document.getElementById('venda-modal');
    if (m) m.classList.add('hidden');
  }

  // Bind dos botões da modal (uma única vez)
  (function bindVendaModalOnce(){
    if (document.__bindVendaModalApplied) return;
    document.__bindVendaModalApplied = true;

    const cancel = document.getElementById('venda-cancel-btn');
    const closeX = document.getElementById('venda-close-btn');
    const save = document.getElementById('venda-save-btn');

    cancel?.addEventListener('click', closeVendaModal);
    closeX?.addEventListener('click', closeVendaModal);

    save?.addEventListener('click', async () => {
      const input = document.getElementById('venda-codigo-input');
      const code = String(input?.value || '').trim();
      if (!__vendaTargetId) { alert('Agendamento inválido.'); return; }
      if (!code) { alert('Informe o código da venda.'); return; }

      try {
        const resp = await api(`/func/agendamentos/${__vendaTargetId}`, {
          method: 'PUT',
          body: JSON.stringify({ codigoVenda: code, pago: true })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.message || 'Falha ao registrar o código de venda.');
        }
        closeVendaModal();

        // Atualiza grade/contadores (mantendo padrões do arquivo)
        await loadAgendamentos();
        renderKpis?.();
        renderFilters?.();
        renderGrid();
        enhanceAgendaUI?.();
      } catch (e) {
        console.error('venda-save', e);
        alert(e.message || 'Não foi possível registrar o código de venda.');
      }
    });
    
  })();

  window.openVendaModal = openVendaModal;
  window.closeVendaModal = closeVendaModal;

  // Elements
  const agendaList = document.getElementById('agenda-list');
  const actionsRoot = document.getElementById('agenda-wrapper') || document.body;
  const dateInput = document.getElementById('agenda-date');
  const dateLabelVisible = document.getElementById('agenda-date-label-visible');
  const viewSelect = document.getElementById('agenda-view');
  const addBtn = document.getElementById('add-service-btn');
  const storeSelect = document.getElementById('agenda-store');
  const storeLabelVisible = document.getElementById('agenda-store-label-visible');

  // Modal (reutilizado p/ adicionar e editar)
  const modal = document.getElementById('modal-add-servico');
  const modalClose = document.getElementById('modal-add-close');
  const modalCancel = document.getElementById('modal-add-cancel');
  const modalSave = document.getElementById('modal-add-save');
  const modalDelete = document.getElementById('modal-add-delete');

  const addStoreSelect = document.getElementById('add-store-select');
  const addDateInput   = document.getElementById('add-date');
  const statusSelect   = document.getElementById('add-status');

  const cliInput = document.getElementById('add-cli-input');
  const cliSug = document.getElementById('add-cli-sug');
  const petSelect = document.getElementById('add-pet-select');
  const servInput   = document.getElementById('add-serv-input');
  const servSug     = document.getElementById('add-serv-sug');
  const valorInput  = document.getElementById('add-valor');
  const addServAddBtn = document.getElementById('add-serv-add-btn');
  const servListUL  = document.getElementById('add-serv-list');
  const servTotalEl = document.getElementById('add-serv-total');
  const obsInput   = document.getElementById('add-observacoes');
  const horaInput   = document.getElementById('add-hora');
  const profSelect  = document.getElementById('add-prof-select');

  // State
  const FILTER_STORAGE_KEY = 'agenda_filters_v1';

  const state = {
    stores: [],
    profissionais: [],
    agendamentos: [],
    selectedStoreId: null,
    selectedCliente: null,
    selectedServico: null,
    tempServicos: [],
    editing: null,
    lastSnapshotHash: '',
    __didInitialScroll: false,
    view: 'day',
    filters: {                 // filtros persistentes
      statuses: new Set(),     // valores: agendado, em_espera, em_atendimento, finalizado
      profIds: new Set()       // _id dos profissionais
    }
  };

  let toolbarWidthRaf = 0;
  let toolbarResizeListenerBound = false;

  function syncAgendaToolbarWidth() {
    const toolbar = document.getElementById('agenda-toolbar');
    if (!toolbar) return;

    const wrapper = agendaList?.parentElement;
    if (!wrapper) return;

    const listWidth = agendaList ? agendaList.scrollWidth : 0;
    const fallbackWidth = Math.max(wrapper.clientWidth || 0, agendaList?.clientWidth || 0);
    const targetWidth = Math.max(listWidth, fallbackWidth, 0);

    if (targetWidth > 0) {
      const px = `${targetWidth}px`;
      if (toolbar.style.width !== px) toolbar.style.width = px;
      if (toolbar.style.minWidth !== px) toolbar.style.minWidth = px;
    } else {
      toolbar.style.removeProperty('width');
      toolbar.style.removeProperty('min-width');
    }
  }

  function queueAgendaToolbarWidthSync() {
    if (toolbarWidthRaf) cancelAnimationFrame(toolbarWidthRaf);
    toolbarWidthRaf = requestAnimationFrame(() => {
      toolbarWidthRaf = 0;
      syncAgendaToolbarWidth();
    });
  }

  function loadFiltersFromStorage() {
    try {
      const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        state.filters.statuses = new Set(Array.isArray(raw.statuses) ? raw.statuses : []);
        state.filters.profIds  = new Set(Array.isArray(raw.profIds)  ? raw.profIds  : []);
      }
    } catch(_) {}
  }
  function saveFiltersToStorage() {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        statuses: Array.from(state.filters.statuses),
        profIds : Array.from(state.filters.profIds)
      }));
    } catch(_) {}
  }

  function ensureToolbar() {
    if (!agendaList) return;
    if (document.getElementById('agenda-toolbar')) return;

    const bar = document.createElement('div');
    bar.id = 'agenda-toolbar';
    // sticky sob o cabeçalho; leve blur para legibilidade; borda inferior discreta
    bar.className = 'sticky top-0 z-30 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b border-slate-200 mb-2 flex flex-col gap-2 px-3 py-2 rounded-lg';

    // KPIs
    const kpis = document.createElement('div');
    kpis.id = 'agenda-kpis';
    kpis.className = 'flex flex-wrap items-center gap-2';
    bar.appendChild(kpis);

    // Filtros
    const filters = document.createElement('div');
    filters.id = 'agenda-filters';
    filters.className = 'flex flex-wrap items-center gap-2';
    bar.appendChild(filters);

    agendaList.parentElement.insertBefore(bar, agendaList); // antes da grade

    queueAgendaToolbarWidthSync();

    if (!toolbarResizeListenerBound) {
      window.addEventListener('resize', queueAgendaToolbarWidthSync);
      toolbarResizeListenerBound = true;
    }
  }

  function computeKPIs(items) {
    const total = items.length;
    const previsto = items.reduce((s, i) => s + Number(i.valor || 0), 0);
    const recebido = items.reduce((s, i) => s + (i.pago ? Number(i.valor || 0) : 0), 0);
    const pendente = previsto - recebido;
    return { total, previsto, recebido, pendente };
  }

  function renderKpis() {
    const wrap = document.getElementById('agenda-kpis');
    if (!wrap) return;

    const all = state.agendamentos || [];
    const f = getFilteredAgendamentos();   // filtrados atuais
    const kAll = computeKPIs(all);
    const kF   = computeKPIs(f);

    const totalLabel = state.view === 'week' ? 'Total semana' : (state.view === 'month' ? 'Total mês' : 'Total dia');
    wrap.innerHTML = `
      <div class="kpi-chip">${totalLabel}: <strong>${kAll.total}</strong></div>
      <div class="kpi-chip">Previsto: <strong>${money(kAll.previsto)}</strong></div>
      <div class="kpi-chip">Recebido: <strong>${money(kAll.recebido)}</strong></div>
      <div class="kpi-chip">Pendente: <strong>${money(kAll.pendente)}</strong></div>
      ${ (state.filters.statuses.size || state.filters.profIds.size)
          ? `<div class="kpi-chip kpi-muted">Filtrados: <strong>${kF.total}</strong></div>` : '' }
    `;

    queueAgendaToolbarWidthSync();
  }

  function renderFilters() {
    const el = document.getElementById('agenda-filters');
    if (!el) return;

    // contadores por status
    const counts = { agendado:0, em_espera:0, em_atendimento:0, finalizado:0 };
    for (const a of (state.agendamentos || [])) {
      const key = String(a.status || 'agendado')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().toLowerCase().replace(/[-\s]+/g,'_');
      if (counts[key] !== undefined) counts[key] += 1;
    }

    // contadores por profissional
    const byProf = new Map();
    for (const a of (state.agendamentos || [])) {
      const id = a.profissionalId || (a.profissional && a.profissional._id) || null;
      if (!id) continue;
      const key = String(id);
      byProf.set(key, (byProf.get(key) || 0) + 1);
    }

    const statuses = [
      {key:'agendado', label:'Agend.'},
      {key:'em_espera', label:'Espera'},
      {key:'em_atendimento', label:'Atend.'},
      {key:'finalizado', label:'Fim.'}
    ];

    // chips de status
    const chipsStatus = statuses.map(s => {
      const active = state.filters.statuses.has(s.key) ? 'chip-active' : '';
      return `<button class="chip ${active}" data-filter="status" data-value="${s.key}">
                ${s.label} <span class="chip-badge">${counts[s.key]}</span>
              </button>`;
    }).join('');

    // chips de profissional (apenas os que existem)
    const chipsProf = (state.profissionais || []).map(p => {
      const id = String(p._id);
      const active = state.filters.profIds.has(id) ? 'chip-active' : '';
      const n = byProf.get(id) || 0;
      return `<button class="chip ${active}" data-filter="prof" data-value="${id}" title="${p.nome}">
                ${p.nome} <span class="chip-badge">${n}</span>
              </button>`;
    }).join('');

    const clearBtn = (state.filters.statuses.size || state.filters.profIds.size)
      ? `<button id="chip-clear" class="chip chip-clear" title="Limpar filtros">Limpar</button>` : '';

    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        ${chipsStatus}
        <span class="chip-sep"></span>
        ${chipsProf}
        ${clearBtn}
      </div>
    `;

    // handlers
    el.querySelectorAll('.chip[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-filter');
        const val  = btn.getAttribute('data-value');
        if (type === 'status') {
          state.filters.statuses.has(val) ? state.filters.statuses.delete(val) : state.filters.statuses.add(val);
        } else if (type === 'prof') {
          state.filters.profIds.has(val) ? state.filters.profIds.delete(val) : state.filters.profIds.add(val);
        }
        saveFiltersToStorage();
        renderFilters();
        renderKpis();
        renderGrid();
        enhanceAgendaUI();
      });
    });

    const clear = document.getElementById('chip-clear');
    if (clear) clear.addEventListener('click', () => {
      state.filters.statuses.clear();
      state.filters.profIds.clear();
      saveFiltersToStorage();
      renderFilters();
      renderKpis();
      renderGrid();
      enhanceAgendaUI();
    });
  }

  function normalizeStatus(s) {
    return String(s || 'agendado')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase().replace(/[-\s]+/g,'_');
  }

  function getFilteredAgendamentos() {
    const hasStatus = state.filters.statuses.size > 0;
    const hasProf   = state.filters.profIds.size   > 0;

    if (!hasStatus && !hasProf) return state.agendamentos || [];

    const byNameAll = new Map(
      (state.profissionais || []).map(p => [String(p.nome || '').trim().toLowerCase(), String(p._id)])
    );

    return (state.agendamentos || []).filter(a => {
      let ok = true;
      if (hasStatus) ok = ok && state.filters.statuses.has(normalizeStatus(a.status));
      if (hasProf) {
        let pid = a.profissionalId ? String(a.profissionalId) : null;
        if (!pid) {
          let nc = '';
          if (typeof a.profissional === 'string') nc = a.profissional;
          else if (a.profissional && typeof a.profissional === 'object') {
            nc = a.profissional.nomeCompleto || a.profissional.nomeContato ||
                a.profissional.razaoSocial || a.profissional.nome || '';
          }
          pid = byNameAll.get(String(nc).trim().toLowerCase()) || null;
        }
        ok = ok && pid && state.filters.profIds.has(String(pid));
      }
      return ok;
    });
  }

  function getVisibleProfissionais() {
    const profs = state.profissionais || [];
    if (!state.filters.profIds.size) return profs;
    return profs.filter(p => state.filters.profIds.has(String(p._id)));
  }

  // Helpers de data e utilitários
  function todayStr() {
    // Gera YYYY-MM-DD respeitando o fuso local (corrige drift UTC)
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function buildLocalDateTime(dateStr, hhmm) {
    let y, m, d;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) { [d, m, y] = dateStr.split('/').map(Number); }
    else { [y, m, d] = dateStr.split('-').map(Number); }
    const [hh, mm] = (hhmm || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }
  function normalizeDate(v) {
    if (!v) return todayStr();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) { const [dd, mm, yyyy] = v.split('/'); return `${yyyy}-${mm}-${dd}`; }
    return v;
  }

  // ==== NOVO: utilitários de intervalo e label ====
  function startOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // 0 = seg
    d.setDate(d.getDate() - dow);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function startOfMonth(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(1);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function startOfNextMonth(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function updateHeaderLabel() {
    if (!dateLabelVisible) return;
    const base = normalizeDate(dateInput?.value || todayStr());
    if (state.view === 'week') {
      const ini = startOfWeek(base);
      const fim = addDays(ini, 6);
      const li = new Date(ini + 'T00:00:00').toLocaleDateString('pt-BR');
      const lf = new Date(fim + 'T00:00:00').toLocaleDateString('pt-BR');
      dateLabelVisible.textContent = `${li} a ${lf}`;
    } else if (state.view === 'month') {
      const m0 = startOfMonth(base);
      const dt = new Date(m0 + 'T00:00:00');
      const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      dateLabelVisible.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    } else {
      dateLabelVisible.textContent = new Date(base + 'T00:00:00').toLocaleDateString('pt-BR');
    }
  }
  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // === NOVO: abrevia tutor para "Primeiro Sob.." ===
  function shortTutorName(name) {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/);
    const cap = s => s ? (s[0].toUpperCase() + s.slice(1).toLowerCase()) : '';
    const preps = new Set(['da','de','do','das','dos','e']);
    const first = cap(parts[0] || '');
    let second = '';
    for (let i = 1; i < parts.length; i++) {
      const w = parts[i];
      if (!preps.has(w.toLowerCase())) { second = w; break; }
    }
    const secondAbbr = second ? cap(second).slice(0, 3) : '';
    return secondAbbr ? `${first} ${secondAbbr}..` : first;
  }

  function money(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function clearChildren(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function debounce(fn, delay = 250) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); }; }

  // Stores
  async function loadStores() {
    const resp = await fetch(`${API_CONFIG.BASE_URL}/stores`);
    const list = await resp.json().catch(() => []);
    state.stores = Array.isArray(list) ? list : [];
    if (storeSelect) {
      storeSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
    }
    if (!state.selectedStoreId && state.stores[0]) {
      state.selectedStoreId = state.stores[0]._id;
      if (storeSelect) storeSelect.value = state.selectedStoreId;
    }
    updateStoreLabel();
  }
  function updateStoreLabel() {
    const s = state.stores.find(x => x._id === state.selectedStoreId);
    if (storeLabelVisible) storeLabelVisible.textContent = s ? s.nome : '—';
    const vis = document.getElementById('agenda-store-label-visible');
    if (vis) vis.textContent = s ? s.nome : '—';
  }

  // Profissionais
  async function populateModalProfissionais(storeId, preselectId) {
    try {
      if (!storeId || !profSelect) return;
      const resp = await api(`/func/profissionais/esteticistas?storeId=${storeId}`);
      const list = await resp.json().catch(() => []);
      const arr = Array.isArray(list) ? list : [];
      profSelect.innerHTML = arr.map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
      const pid = preselectId ? String(preselectId) : '';
      if (pid && arr.some(p => String(p._id) === pid)) {
        profSelect.value = pid;
      } else if (arr[0]) {
        profSelect.value = String(arr[0]._id);
      }
    } catch (_) { /* silencioso no modal */ }
  }

  // Agendamentos
  async function loadAgendamentos() {
    const base = normalizeDate(dateInput?.value || todayStr());
    const date = base; // compat: alguns trechos antigos ainda usam "date"
    let url = '';

    if (state.view === 'week') {
      const ini = startOfWeek(base);
      const fim = addDays(ini, 7); // exclusivo
      url = `/func/agendamentos/range?start=${ini}&end=${fim}&storeId=${state.selectedStoreId}`;
    } else if (state.view === 'month') {
      const m0 = startOfMonth(base);
      const m1 = startOfNextMonth(base); // exclusivo
      url = `/func/agendamentos/range?start=${m0}&end=${m1}&storeId=${state.selectedStoreId}`;
    } else {
      url = `/func/agendamentos?date=${base}&storeId=${state.selectedStoreId}`;
    }

    try {
      const resp = await api(url);
      if (!resp.ok) {
        const txt = await resp.text();
        console.error('GET', url, '->', resp.status, txt);
        state.agendamentos = [];
        return;
      }

      const list = await resp.json();
      state.agendamentos = Array.isArray(list) ? list : [];

      // snapshot/label
      updateHeaderLabel();
      state.lastSnapshotHash = `${state.view}:${date}:${state.selectedStoreId || ''}:${state.agendamentos.length}`;

      console.info('[Agenda]', 'view=', state.view, 'dataBase=', date, 'loja=', state.selectedStoreId, 'itens=', state.agendamentos.length);
    } catch (e) {
      console.error('Erro ao carregar agendamentos', e);
      state.agendamentos = [];
    }
  }

  // Grade (sem coluna "Outros")
  function renderGrid() {
      if (!agendaList) return;
      if (state.view === 'week')  { renderWeekGrid();  return; }
      if (state.view === 'month') { renderMonthGrid(); return; }

      // ===== Visão DIÁRIA (original) =====
      const date = normalizeDate(dateInput?.value || todayStr());
      updateHeaderLabel();

      // janelas de trabalho (ajuste se quiser)
      const BUSINESS_START = 8;   // 08:00
      const BUSINESS_END   = 19;  // 19:00

      const hours = [];
      for (let h = 0; h < 24; h++) hours.push(`${pad(h)}:00`);

      clearChildren(agendaList);

      const profsAll  = state.profissionais || [];
      const profs     = getVisibleProfissionais();
      const byNameAll = new Map((profsAll || []).map(p => [String(p.nome || '').trim().toLowerCase(), p._id]));

      const colCount = 1 + (profs?.length || 0);

      // Cabeçalho
      const header = document.createElement('div');
      header.style.display = 'grid';
      // >>> COLUNAS ELÁSTICAS: ocupam o espaço restante sem “vão” à direita
      header.style.gridTemplateColumns = `120px repeat(${Math.max(colCount - 1, 0)}, minmax(var(--agenda-col-w, 360px), 1fr))`;
      header.className = 'bg-white border-b';

      const headLabels = ['Hora', ...profs.map(p => p.nome)];
      headLabels.forEach((label, idx) => {
        const cell = document.createElement('div');
        cell.className = 'px-3 py-2 text-xs font-medium text-slate-600';
        if (idx === 0) {
          cell.textContent = label;
        }
        else {
          // >>> centraliza o nome do profissional
          cell.style.textAlign = 'center';
          const wrapper = document.createElement('div');
          wrapper.className = 'flex items-center justify-center gap-2';

          const span = document.createElement('span');
          span.className = 'agenda-head-label inline-block';
          span.textContent = label || '';
          wrapper.appendChild(span);

          const prof = profs[idx - 1];
          if (prof && prof._id) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'agenda-head-add inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1';
            btn.textContent = '+';
            btn.setAttribute('aria-label', `Adicionar agendamento para ${label}`);
            btn.dataset.profId = String(prof._id);
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              openAddModal(String(prof._id));
            });
            wrapper.appendChild(btn);
          }

          cell.dataset.profId = prof && prof._id ? String(prof._id) : '';
          cell.appendChild(wrapper);
        }
        header.appendChild(cell);
      });

      const counter = document.createElement('div');
      counter.className = 'col-span-full text-right px-3 py-1 text-xs text-slate-500';
      const itemsAll = state.agendamentos || [];
      const items    = getFilteredAgendamentos(itemsAll);
      const filtered = (state.filters.statuses.size || state.filters.profIds.size) ? ` (filtrados: ${items.length})` : '';
      counter.textContent = `Agendamentos: ${itemsAll.length}${filtered}`;
      header.appendChild(counter);

      agendaList.appendChild(header);

      // Corpo
      const body = document.createElement('div');
      body.style.display = 'grid';
      // >>> COLUNAS ELÁSTICAS: cada profissional tem no mínimo 360px e expande até preencher
      body.style.gridTemplateColumns = `120px repeat(${Math.max(colCount - 1, 0)}, minmax(var(--agenda-col-w, 360px), 1fr))`;
      agendaList.appendChild(body);

      const isToday = normalizeDate(date) === todayStr();
      const now = new Date();
      const nowHH = `${pad(now.getHours())}:00`;

      hours.forEach(hh => {
        const hourNumber = parseInt(hh.split(':')[0], 10);
        const inBusiness = hourNumber >= BUSINESS_START && hourNumber < BUSINESS_END;
        const isNowRow   = isToday && hh === nowHH;

        // coluna de horário
        const timeCell = document.createElement('div');
        timeCell.className = 'px-3 py-3 border-b text-sm ' + (isNowRow ? 'bg-sky-50 text-slate-800 font-medium' : 'bg-gray-50 text-gray-600');
        timeCell.textContent = hh;

        body.appendChild(timeCell);

        // células por profissional
        (profs || []).forEach(p => {
          const cell = document.createElement('div');
          // agenda-slot mantém sublinha; realces por horário útil e hora atual
          cell.className = `px-2 py-2 border-b agenda-slot ${inBusiness ? '' : 'bg-slate-50'} ${isNowRow ? 'bg-sky-50' : ''}`;
          cell.dataset.profissionalId = String(p._id);
          cell.dataset.hh = hh;
          body.appendChild(cell);
        });
      });

      // posiciona cartões
      let placed = 0;
      for (const a of items) {
        const when = a.h || a.scheduledAt;
        if (!when) continue;

        const d  = new Date(when);
        const hh = `${pad(d.getHours())}:00`;

        let profId = a.profissionalId ? String(a.profissionalId) : null;
        if (!profId) {
          let nameCandidate = '';
          if (typeof a.profissional === 'string') nameCandidate = a.profissional;
          else if (a.profissional && typeof a.profissional === 'object') nameCandidate = a.profissional.nome || '';
          const normalized = String(nameCandidate || '').trim().toLowerCase();
          if (normalized && byNameAll.has(normalized)) profId = String(byNameAll.get(normalized));
        }
        if (!profId) continue;

        let col = body.querySelector(`div[data-profissional-id="${profId}"][data-hh="${hh}"]`);
        if (!col && profs[0]) {
          col = body.querySelector(`div[data-profissional-id="${profs[0]._id}"][data-hh="${hh}"]`);
        }
        if (!col) continue;

        const meta = statusMeta(a.status);
        const card = document.createElement('div');
        card.setAttribute('data-appointment-id', a._id || '');
        card.style.setProperty('--stripe', meta.stripe);
        card.style.setProperty('--card-max-w', '320px');
        card.className = `agenda-card border ${meta.borderClass} cursor-move select-none`;
        card.dataset.status = meta.key;
        card.setAttribute('draggable', 'true');

        const headerEl = document.createElement('div');
        headerEl.className = 'agenda-card__head flex justify-between';

        // usa o nome do cliente que já vem da API (clienteNome); fallback mantém o comportamento antigo
        const tutorShort = shortTutorName(a.clienteNome || '');
        const headLabel  = tutorShort ? `${tutorShort} | ${a.pet || ''}` : (a.pet || '');

        headerEl.innerHTML = `
          <div class="agenda-card__title font-semibold text-gray-900 truncate" title="${headLabel}">${headLabel}</div>
          ${renderStatusBadge(a.status)}
        `;

        const bodyEl = document.createElement('div');
        bodyEl.classList.add('agenda-card__body');
        if (a.observacoes && String(a.observacoes).trim()) {
          const svc = document.createElement('div');
          svc.className = 'agenda-card__service text-gray-600 clamp-2';
          svc.textContent = a.servico || '';
          const obs = document.createElement('div');
          obs.className = 'agenda-card__note mt-1 text-gray-700 italic clamp-2';
          obs.textContent = String(a.observacoes).trim();
          bodyEl.appendChild(svc);
          bodyEl.appendChild(obs);
        } else {
          bodyEl.classList.add('text-gray-600', 'clamp-2');
          bodyEl.textContent = a.servico || '';
        }

        const footerEl = document.createElement('div');
        footerEl.className = 'agenda-card__footer flex items-center justify-end';
        const price = document.createElement('div');
        price.className = 'agenda-card__price text-gray-800 font-medium';
        price.textContent = money(a.valor);

        footerEl.appendChild(price);

        card.appendChild(headerEl);
        card.appendChild(bodyEl);
        card.appendChild(footerEl);

        col.appendChild(card);
        placed++;
      }

      if (placed === 0) {
        const empty = document.createElement('div');
        empty.className = 'px-4 py-3 text-sm text-slate-600 bg-slate-50 border-b';
        empty.textContent = 'Sem agendamentos para este filtro/dia.';
        agendaList.insertBefore(empty, header.nextSibling);
      }

      queueAgendaToolbarWidthSync();
  }

  /** ===== NOVO: visão semanal ===== */
  function renderWeekGrid() {
    const base = normalizeDate(dateInput?.value || todayStr());
    const ini  = startOfWeek(base);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ini, i));
    updateHeaderLabel();

    clearChildren(agendaList);

    // Cabeçalho: horários + 7 dias
    const BUSINESS_START = 8, BUSINESS_END = 19;
    const hours = []; for (let h = 0; h < 24; h++) hours.push(`${pad(h)}:00`);

    const header = document.createElement('div');
    header.style.display = 'grid';
    header.style.gridTemplateColumns = `120px repeat(7, minmax(180px,1fr))`;
    header.className = 'sticky top-0 z-20 bg-white border-b';
    header.innerHTML = `
      <div class="px-2 py-2 text-xs text-slate-500">Horário</div>
      ${days.map(d=>{
        const lab = new Date(d+'T00:00:00').toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit' });
        return `<div class="px-3 py-2 text-xs font-medium text-slate-700">${lab}</div>`;
      }).join('')}
    `;
    agendaList.appendChild(header);

    const body = document.createElement('div');
    body.style.display = 'grid';
    body.style.gridTemplateColumns = `120px repeat(7, minmax(180px,1fr))`;
    agendaList.appendChild(body);

    // Linhas por hora
    hours.forEach(hh => {
      const hNum = parseInt(hh.slice(0,2),10);
      const inBusiness = (hNum>=BUSINESS_START && hNum< BUSINESS_END);

      const timeCell = document.createElement('div');
      timeCell.className = `px-2 py-2 border-b text-[12px] ${inBusiness?'text-slate-800':'text-slate-400'}`;
      timeCell.textContent = hh;
      body.appendChild(timeCell);

      days.forEach(d=>{
        const cell = document.createElement('div');
        cell.className = 'px-2 py-2 border-b agenda-slot';
        cell.dataset.day = d;
        cell.dataset.hh  = hh;
        body.appendChild(cell);
      });
    });

    // Posiciona cartões (compactos)
    const items = getFilteredAgendamentos(state.agendamentos || []);
    let placed = 0;

    for (const a of items) {
      const when = a.h || a.scheduledAt;
      if (!when) continue;

      const dt     = new Date(when);
      const dayStr = localDateStr(dt); // data local evita deslocamento de fuso
      if (dayStr < days[0] || dayStr > days[6]) continue;

      const hh = `${pad(dt.getHours())}:00`;
      const cell = agendaList.querySelector(`div[data-day="${dayStr}"][data-hh="${hh}"]`);
      if (!cell) continue;

      const meta = statusMeta(a.status);
      const hhmm = `${pad(dt.getHours())}:${String(dt.getMinutes()).padStart(2,'0')}`;

      const card = document.createElement('div');
      card.setAttribute('data-appointment-id', a._id || '');
      card.style.setProperty('--stripe', meta.stripe);
      card.style.setProperty('--card-max-w', '100%');                       // ocupa a coluna
      card.className = `agenda-card agenda-card--compact border ${meta.borderClass} cursor-pointer select-none px-2 py-1`; // padding menor
      card.dataset.status = meta.key;
      card.setAttribute('draggable', 'true');
      card.title = [
        a.pet || '',
        a.servico || '',
        (a.observacoes ? `Obs: ${String(a.observacoes).trim()}` : '')
      ].filter(Boolean).join(' • ');

      // Header: Tutor abreviado | Pet (sem hora)
      const headerEl = document.createElement('div');
      headerEl.className = 'agenda-card__head flex justify-between';
      const tutorShort = shortTutorName(a.clienteNome || a.tutor || '');
      const headLabel  = tutorShort ? `${tutorShort} | ${a.pet || ''}` : (a.pet || '');
      headerEl.innerHTML = `
        <div class="agenda-card__title font-medium text-gray-900 truncate" title="${headLabel}">${headLabel}</div>
        <!-- nada do lado direito no header -->
      `;

      // Corpo: serviço 1 linha + observação 1 linha (opcional)
      const bodyEl = document.createElement('div');
      bodyEl.classList.add('agenda-card__body');
      const svc = document.createElement('div');
      svc.className = 'agenda-card__service text-gray-600 truncate';
      svc.textContent = a.servico || '';
      bodyEl.appendChild(svc);
      if (a.observacoes && String(a.observacoes).trim()) {
        const obs = document.createElement('div');
        obs.className = 'agenda-card__note text-gray-700 italic truncate';
        obs.textContent = String(a.observacoes).trim();
        bodyEl.appendChild(obs);
      }

      // Rodapé: status + valor à direita
      const footerEl = document.createElement('div');
      footerEl.className = 'agenda-card__footer flex items-center justify-end';
      const statusEl = document.createElement('div');
      // badge menor para caber bem
      statusEl.innerHTML = renderStatusBadge(a.status).replace('text-xs','text-[10px]');
      const price = document.createElement('div');
      price.className = 'agenda-card__price text-gray-800 font-semibold';
      price.textContent = money(a.valor);
      footerEl.appendChild(statusEl);
      footerEl.appendChild(price);

      card.appendChild(headerEl);
      card.appendChild(bodyEl);
      card.appendChild(footerEl);

      cell.appendChild(card);
      placed++;
    }

    if (placed === 0) {
      const empty = document.createElement('div');
      empty.className = 'p-6 text-sm text-slate-500';
      empty.textContent = 'Nenhum agendamento no intervalo.';
      agendaList.appendChild(empty);
    }

    queueAgendaToolbarWidthSync();
  }

  /** ===== NOVO: visão mensal ===== */
  function renderMonthGrid() {
    const base = normalizeDate(dateInput?.value || todayStr());
    const m0   = startOfMonth(base);
    const m1   = startOfNextMonth(base); // exclusivo
    updateHeaderLabel();

    clearChildren(agendaList);

    // cabeçalho: seg a dom
    const weekDays = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    const header = document.createElement('div');
    header.style.display = 'grid';
    header.style.gridTemplateColumns = `repeat(7, minmax(180px,1fr))`;
    header.className = 'sticky top-0 z-20 bg-white border-b';
    header.innerHTML = weekDays.map(d=>`<div class="px-3 py-2 text-xs font-medium text-slate-700">${d}</div>`).join('');
    agendaList.appendChild(header);

    // calcular início da grade (segunda da semana que contém o dia 1)
    const startGrid = startOfWeek(m0);
    const days = Array.from({length:42},(_,i)=> addDays(startGrid,i)); // 6 semanas

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(7, minmax(180px,1fr))`;
    agendaList.appendChild(grid);

    // usar FILTRO + AGRUPAR por data local
    const items = getFilteredAgendamentos((state.agendamentos||[]).slice().sort((a,b)=>(new Date(a.h||a.scheduledAt))-(new Date(b.h||b.scheduledAt))));
    const byDay = new Map();
    for (const a of items) {
      const d = localDateStr(new Date(a.h || a.scheduledAt));
      if (d >= m0 && d < m1) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(a);
      }
    }

    days.forEach(d=>{
      const inMonth = (d>=m0 && d<m1);
      const cell = document.createElement('div');
      // Torna a célula inteira do dia um alvo de drop no mensal
      cell.className = `min-h-[140px] border p-2 ${inMonth? 'bg-white':'bg-slate-50'} agenda-slot`; // min-h menor
      cell.dataset.day = d;
      
      const title = document.createElement('div');
      title.className = `flex items-center justify-between text-[11px] ${inMonth?'text-slate-700':'text-slate-400'}`;
      const dayNum = new Date(d+'T00:00:00').getDate();
      title.innerHTML = `<span class="font-semibold">${String(dayNum).padStart(2,'0')}</span>`;

      const list = document.createElement('div');
      // droppable por dia no mensal
      list.className = 'mt-1 space-y-1 agenda-slot';
      list.dataset.day = d;

      const itemsDay = byDay.get(d) || [];
      itemsDay.forEach((a, idx)=>{
        const meta = statusMeta(a.status);
        const when = new Date(a.h || a.scheduledAt);
        const hhmm = `${pad(when.getHours())}:${String(when.getMinutes()).padStart(2,'0')}`;

      const card = document.createElement('div');
      card.setAttribute('data-appointment-id', a._id || '');
      card.style.setProperty('--stripe', meta.stripe);
      card.style.setProperty('--card-max-w', '100%');
      card.className = `agenda-card agenda-card--compact border ${meta.borderClass} cursor-pointer select-none px-2 py-1`; // padding menor
      card.dataset.status = meta.key;
      card.setAttribute('draggable', 'true');
      card.title = [
        a.pet || '',
        a.servico || '',
        (a.observacoes ? `Obs: ${String(a.observacoes).trim()}` : '')
      ].filter(Boolean).join(' • '); // tooltip exibe tudo sem poluir o card

      // Header: hora + STATUS centralizado (reserva espaço p/ botões à direita)
      const headerEl = document.createElement('div');
      headerEl.className = 'agenda-card__head flex items-center gap-2';
      headerEl.innerHTML = `
        <span class="inline-flex items-center px-1.5 py-[1px] rounded bg-slate-100 text-[10px] font-medium">${hhmm}</span>
        <div class="flex-1 flex items-center justify-center">
          ${renderStatusBadge(a.status).replace('text-xs','text-[10px]')}
        </div>
      `;

      // Linha abaixo: Tutor abreviado | Pet (com fallbacks)
      const rawTutorName =
        a.tutor ||
        a.tutorNome ||
        a.clienteNome ||
        (a.cliente && (a.cliente.nomeCompleto || a.cliente.nomeContato || a.cliente.razaoSocial || a.cliente.nome || a.cliente.name)) ||
        (a.tutor && (a.tutor.nomeCompleto || a.tutor.nomeContato || a.tutor.razaoSocial || a.tutor.nome)) ||
        a.responsavelNome ||
        (a.responsavel && (a.responsavel.nome || a.responsavel.name)) ||
        '';

      const tutorShort = shortTutorName(rawTutorName);
      const headLabel  = [tutorShort, (a.pet || '')].filter(Boolean).join(' | ');

      const nameEl = document.createElement('div');
      nameEl.className = 'agenda-card__title font-medium text-gray-900 text-center truncate';
      nameEl.title = headLabel;
      nameEl.textContent = headLabel;

      // Rodapé: manter apenas o valor (R$) à direita
      const footerEl = document.createElement('div');
      footerEl.className = 'agenda-card__footer flex items-center justify-end';
      const price = document.createElement('div');
      price.className = 'agenda-card__price text-gray-800 font-semibold';
      price.textContent = money(a.valor);
      footerEl.appendChild(price);

      // Montagem final (sem serviço/observação)
      card.appendChild(headerEl);
      card.appendChild(nameEl);
      card.appendChild(footerEl);

      list.appendChild(card);

        // Limitar o excesso visual
        if (idx>=6 && itemsDay.length>7) {
          const more = document.createElement('div');
          more.className = 'text-[11px] text-slate-500';
          more.textContent = `+${itemsDay.length-6} itens`;
          list.appendChild(more);
          return;
        }
      });

      cell.appendChild(title);
      cell.appendChild(list);
      grid.appendChild(cell);
    });

    queueAgendaToolbarWidthSync();
  }

  // Map de estilos por status (cores seguras com Tailwind já usadas no projeto)
  function statusMeta(s) {
    // Normalização: acentos/maiúsculas/espaços/hífens
    const keyRaw = String(s || 'agendado')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase().replace(/[-\s]+/g, '_');

    const allowed = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
    const k = allowed.includes(keyRaw) ? keyRaw : 'agendado';

    // Paleta acessível (contraste AA) + info para faixa lateral e badge compacta
    const map = {
      agendado: {
        label: 'Agendado',
        short: 'Agend.',
        stripe: '#64748B',     // slate-500
        text: '#0F172A',       // slate-900
        badgeClass: 'agenda-status-badge agenda-status-badge--agendado',
        borderClass: 'border-slate-300'
      },
      em_espera: {
        label: 'Em espera',
        short: 'Espera',
        stripe: '#B45309',     // amber-700
        text: '#1F2937',       // gray-800
        badgeClass: 'agenda-status-badge agenda-status-badge--espera',
        borderClass: 'border-amber-400'
      },
      em_atendimento: {
        label: 'Em atendimento',
        short: 'Atend.',
        stripe: '#1D4ED8',     // blue-700
        text: '#0B1235',
        badgeClass: 'agenda-status-badge agenda-status-badge--atendimento',
        borderClass: 'border-blue-500'
      },
      finalizado: {
        label: 'Finalizado',
        short: 'Fim.',
        stripe: '#16A34A',     // green-600
        text: '#052E16',
        badgeClass: 'agenda-status-badge agenda-status-badge--finalizado',
        borderClass: 'border-green-500'
      }
    };

    return { key: k, ...map[k] };
  }

  function renderStatusBadge(s) {
    const { label, badgeClass } = statusMeta(s);
    // `whitespace-nowrap` garante que o chip não quebre em duas linhas
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badgeClass}">${label}</span>`;
  }

  // Modal — modo adicionar
  function openAddModal(preselectProfId) {
    let preselectedId = '';
    if (preselectProfId && typeof preselectProfId === 'object' && typeof preselectProfId.preventDefault === 'function') {
      preselectProfId.preventDefault?.();
    } else if (preselectProfId != null) {
      preselectedId = String(preselectProfId);
    }

    state.editing = null;
    if (!modal) { console.warn('Modal #modal-add-servico não encontrado'); return; }

    // Reset serviços temporários
    state.tempServicos = [];
    renderServicosLista();
    if (addServAddBtn) addServAddBtn.classList.remove('hidden');

    // Campos editáveis habilitados
    [cliInput, servInput, valorInput, petSelect].forEach(el => { if (el) el.disabled = false; });

    // Limpa estado/inputs
    state.selectedCliente = null;
    state.selectedServico = null;
    if (cliInput) { cliInput.value = ''; }
    if (cliSug) { cliSug.innerHTML = ''; cliSug.classList.add('hidden'); }
    if (servInput) { servInput.value = ''; }
    if (servSug) { servSug.innerHTML = ''; servSug.classList.add('hidden'); }
    if (valorInput) { valorInput.value = ''; }
    if (petSelect) { petSelect.innerHTML = ''; }
    if (obsInput) { obsInput.value = ''; }

    // Empresa (usa as mesmas opções do seletor da página)
    if (addStoreSelect) {
      if (storeSelect && storeSelect.options.length) {
        addStoreSelect.innerHTML = storeSelect.innerHTML;
      } else if (state.stores?.length) {
        addStoreSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
      }
      const sid = state.selectedStoreId || storeSelect?.value || '';
      addStoreSelect.value = sid;

      // Carrega os profissionais correspondentes à empresa escolhida no modal (sem travar a abertura)
      try { if (sid) { populateModalProfissionais(sid, preselectedId); } } catch(_) {}
    }

    // Data (usa a data visível na página)
    if (addDateInput) {
      const date = normalizeDate(dateInput?.value || todayStr()); // YYYY-MM-DD
      addDateInput.value = date;
    }

    // Hora default (agora)
    const now = new Date();
    const hh = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (horaInput) horaInput.value = hh;
    
    // Observações
    if (obsInput) { obsInput.value = ''; }

    // Status default
    if (statusSelect) statusSelect.value = 'agendado';

    if (preselectedId && profSelect) {
      try { profSelect.value = preselectedId; } catch (_) {}
    }

    // Botão Excluir só em edição
    if (modalDelete) modalDelete.classList.add('hidden');

    modal.classList.remove('hidden'); 
    modal.classList.add('flex');
    cliInput?.focus();
  }

  // cache simples: clienteId -> nome
  const _clienteNomeCache = new Map();

  async function resolveClienteNome(a) {
    try {
      if (!a) return '';

      // 1) nome direto vindo da API
      const direct =
        a.clienteNome ||
        (a.cliente && typeof a.cliente === 'object' && (a.cliente.nome || a.cliente.nomeCompleto || a.cliente.razaoSocial)) ||
        null;
      if (typeof direct === 'string' && direct.trim()) return direct.trim();

      // 2) clienteId em qualquer formato
      let maybeId =
        a.clienteId ||
        a.clientId ||
        a.customerId ||
        (typeof a.cliente === 'string' ? a.cliente : null);

      if (typeof maybeId === 'object' && maybeId !== null && maybeId._id) {
        maybeId = String(maybeId._id);
      }
      const id = (typeof maybeId === 'string' && /^[0-9a-fA-F]{24}$/.test(maybeId)) ? maybeId : null;

      if (id) {
        if (_clienteNomeCache.has(id)) return _clienteNomeCache.get(id);
        const r = await api(`/func/clientes/${id}`);
        if (r.ok) {
          const c = await r.json();
          const nome = c?.nome || '';
          if (nome) { _clienteNomeCache.set(id, nome); return nome; }
        }
      }

      // 3) fallback por petId
      const petId =
        a.petId ||
        (a.pet && typeof a.pet === 'object' && a.pet._id ? a.pet._id : null) ||
        null;

      if (petId && /^[0-9a-fA-F]{24}$/.test(String(petId))) {
        const r2 = await api(`/func/pets/${petId}`);
        if (r2.ok) {
          const p = await r2.json();
          const nome =
            (p?.cliente && (p.cliente.nome || p.cliente.nomeCompleto || p.cliente.razaoSocial)) ||
            p?.clienteNome ||
            '';
          if (nome) return String(nome);
        }
      }
    } catch (e) {
      console.info('[resolveClienteNome] não foi possível resolver', e);
    }
    return '';
  }

  // --- DEPOIS: openEditModal (indica carregamento e garante preenchimento) ---
  function toDateInputValueFromISO(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return todayStr();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function openEditModal(a) {
    state.editing = a || null;
    if (!modal || !state.editing) return;

    // Preenche lista de serviços no modo edição (somente leitura)
    state.tempServicos = Array.isArray(a.servicos)
      ? a.servicos.map(x => ({ _id: x._id, nome: x.nome, valor: Number(x.valor || 0) }))
      : (a.servico ? [{ _id: null, nome: a.servico, valor: Number(a.valor || 0) }] : []);
    renderServicosLista();

    // habilita campo de busca/valor para adicionar novos serviços
    state.selectedServico = null;
    if (servInput) { servInput.value = ''; servInput.disabled = false; }
    if (servSug)   { servSug.innerHTML = ''; servSug.classList.add('hidden'); }
    if (valorInput){ valorInput.value = ''; valorInput.disabled = false; }

    if (addServAddBtn) addServAddBtn.classList.remove('hidden');

    // Empresa (mostra a loja do agendamento e permite trocar)
    if (addStoreSelect) {
      if (storeSelect && storeSelect.options.length) {
        addStoreSelect.innerHTML = storeSelect.innerHTML;
      } else if (state.stores?.length) {
        addStoreSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
      }
      addStoreSelect.value = a.storeId || state.selectedStoreId || storeSelect?.value || '';
      addStoreSelect.disabled = false;
    }

    // Data do agendamento
    if (addDateInput) {
      const iso = a.h || a.scheduledAt || new Date().toISOString();
      addDateInput.value = toDateInputValueFromISO(iso);
    }

    // Hora
    const d = new Date((a.h || a.scheduledAt) || new Date());
    const hh = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (horaInput) horaInput.value = hh;

    // Profissional (tenta resolver o id atual)
    let profId = a.profissionalId ? String(a.profissionalId) : null;
    if (!profId && typeof a.profissional === 'string') {
      const key = a.profissional.trim().toLowerCase();
      const match = state.profissionais.find(p => String(p.nome || '').trim().toLowerCase() === key);
      if (match) profId = String(match._id);
    }
    if (profSelect && profId) profSelect.value = profId;

    // Ao abrir o modal de edição, carregamos os profissionais da EMPRESA selecionada no modal
    try {
      const sid = addStoreSelect?.value || a.storeId || '';
      if (sid) { populateModalProfissionais(sid, profId); } // não bloqueia a abertura do modal
    } catch (_) {}

    // Status (normalizado p/ os values do <select>)
    if (statusSelect) {
      const keyRaw = String(a.status || 'agendado')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().toLowerCase().replace(/[-\s]+/g, '_');
      const allowed = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
      statusSelect.value = allowed.includes(keyRaw) ? keyRaw : 'agendado';
    }

    // Observações (preenche com a descrição do card)
    if (obsInput) { obsInput.value = (a.observacoes || '').trim(); }

    // Cliente e Pet (preenche e bloqueia busca no modo edição)
    if (cliInput) { cliInput.value = (a.clienteNome || ''); cliInput.disabled = true; }
   
    if (petSelect) {
      petSelect.innerHTML = '';
      try {
        const clienteId = a.clienteId || (a.cliente && a.cliente._id) || null;
        if (clienteId) {
          api(`/func/clientes/${clienteId}/pets`).then(r => r.json().catch(() => []))
            .then(pets => {
              petSelect.innerHTML = (Array.isArray(pets) ? pets : []).map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
              const currentPetId = a.petId || (a.pet && a.pet._id) || '';
              if (currentPetId) petSelect.value = String(currentPetId);
            });
        }
      } catch (_) {}
    }

    // Serviço/Valor: leitura
    if (servInput) { servInput.value = ''; servInput.disabled = false; }
    if (valorInput) { valorInput.value = ''; valorInput.disabled = false; }

    // Botão excluir visível
    if (modalDelete) modalDelete.classList.remove('hidden');

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    state.editing = null;
    [cliInput, servInput, valorInput, petSelect].forEach(el => { if (el) el.disabled = false; });
  }

  // Busca cliente
  async function searchClientes(term) {
    if (!term || term.length < 2) {
      if (cliSug) { cliSug.innerHTML = ''; cliSug.classList.add('hidden'); }
      return;
    }
    const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(term)}&limit=8`);
    const list = await resp.json().catch(() => []);
    if (!cliSug) return;
    cliSug.innerHTML = list.map(u => `
      <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${u._id}" data-nome="${u.nome}">
        <div class="font-medium text-gray-900">${u.nome}</div>
        <div class="text-xs text-gray-500">${u.email || ''}</div>
      </li>`).join('');
    cliSug.classList.remove('hidden');
    cliSug.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', async () => {
        state.selectedCliente = { _id: li.dataset.id, nome: li.dataset.nome };
        if (cliInput) cliInput.value = li.dataset.nome;
        cliSug.classList.add('hidden');
        const resp = await api(`/func/clientes/${state.selectedCliente._id}/pets`);
        const pets = await resp.json().catch(() => []);
        if (petSelect) {
          petSelect.innerHTML = pets.map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
        }
      });
    });
  }

  async function confirmAsync(title, message, opts = {}) {
    const confirmText = opts.confirmText || 'Excluir';
    const cancelText  = opts.cancelText  || 'Cancelar';
    const modalEl = modal || null;

    let prevVis;
    let prevPointerEvents;
    if (modalEl) {
      prevVis = modalEl.style.visibility;
      prevPointerEvents = modalEl.style.pointerEvents;
      modalEl.style.visibility = 'hidden';
      modalEl.style.pointerEvents = 'none';
    }

    const ensureOverlayOnTop = () => {
      try {
        const all = Array.from(document.querySelectorAll('body *'));
        const overlays = all.filter((element) => {
          const style = getComputedStyle(element);
          if (style.position !== 'fixed') return false;
          const rect = element.getBoundingClientRect();
          return rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
        });
        const overlay = overlays.at(-1);
        if (overlay) {
          overlay.style.zIndex = '9999';
          overlay.style.pointerEvents = 'auto';
        }
      } catch (_) {}
    };

    if (typeof window !== 'undefined') {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(ensureOverlayOnTop);
      }
      setTimeout(ensureOverlayOnTop, 0);
    }

    try {
      if (typeof window.confirmWithModal === 'function') {
        return await window.confirmWithModal({
          title: title || 'Confirmação',
          message: message || 'Deseja prosseguir?',
          confirmText,
          cancelText,
        });
      }

      if (typeof window.showModal === 'function') {
        return await new Promise((resolve) => {
          window.showModal({
            title: title || 'Confirmação',
            message: message || 'Deseja prosseguir?',
            confirmText,
            cancelText,
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
      }

      console.warn('confirmAsync: modal de confirmação indisponível; prosseguindo automaticamente.');
      return true;
    } finally {
      if (modalEl) {
        modalEl.style.visibility = prevVis || '';
        modalEl.style.pointerEvents = prevPointerEvents || '';
      }
    }
  }

  async function handleDelete() {
      const id = state.editing && state.editing._id ? String(state.editing._id) : null;
      if (!id) return;

      const ok = await confirmAsync('Excluir atendimento', 'Tem ce...a excluir este atendimento? Esta ação não pode ser desfeita.', {
        confirmText: 'Excluir',
        cancelText: 'Cancelar'
      });
      if (!ok) return;

      const resp = await api(`/func/agendamentos/${id}`, { method: 'DELETE' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(err.message || 'Erro ao excluir agendamento');
        return;
      }
      await loadAgendamentos();
      renderKpis();
      renderFilters();
      closeModal();
      renderGrid();
      enhanceAgendaUI();
  }

  // Busca serviços
  async function searchServicos(term) {
    if (!term || term.length < 2) {
      if (servSug) { servSug.innerHTML = ''; servSug.classList.add('hidden'); }
      return;
    }
    const resp = await api(`/func/servicos/buscar?q=${encodeURIComponent(term)}`);
    const list = await resp.json().catch(() => []);
    if (!servSug) return;
    servSug.innerHTML = list.map(s => `
      <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${s._id}" data-nome="${s.nome}" data-valor="${s.valor}">
        <div class="font-medium text-gray-900">${s.nome}</div>
        <div class="text-xs text-gray-500">${money(s.valor)}</div>
      </li>`).join('');
    servSug.classList.remove('hidden');
    servSug.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        state.selectedServico = { _id: li.dataset.id, nome: li.dataset.nome, valor: Number(li.dataset.valor || 0) };
        if (servInput) servInput.value = state.selectedServico.nome;
        if (valorInput) valorInput.value = state.selectedServico.valor.toFixed(2);
        servSug.classList.add('hidden');
      });
    });
  }

  // --- Lista de serviços no modal ---
  function renderServicosLista() {
    if (!servListUL || !servTotalEl) return;
    const items = state.tempServicos || [];
    servListUL.innerHTML = items.map((it, idx) => `
      <li class="flex items-center justify-between px-3 py-2 text-sm">
        <div class="flex items-center gap-3">
          <span class="w-20 text-right tabular-nums">${money(Number(it.valor || 0))}</span>
          <span class="text-gray-700">${it.nome || ''}</span>
        </div>
        <button data-idx="${idx}" class="remove-serv px-2 py-1 rounded-md border text-gray-600 hover:bg-gray-50">Remover</button>
      </li>
    `).join('');
    const total = items.reduce((s, x) => s + Number(x.valor || 0), 0);
    servTotalEl.textContent = money(total);

    servListUL.querySelectorAll('.remove-serv').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-idx'), 10);
        if (!isNaN(i)) {
          state.tempServicos.splice(i, 1);
          renderServicosLista();
        }
      });
    });
  }

  // Salvar (adicionar/editar)
  async function saveAgendamento() {
      try {
        const dateRaw = (addDateInput?.value) || (dateInput?.value) || todayStr();
        const storeIdSelected = (addStoreSelect?.value) || state.selectedStoreId || storeSelect?.value;
        const hora = horaInput?.value;
        const profissionalId = profSelect?.value;
        const status = (statusSelect?.value) || 'agendado';

        if (!hora || !profissionalId) { alert('Preencha hora e profissional.'); return; }
        if (!storeIdSelected) { alert('Selecione a empresa.'); return; }

        const scheduledAt = buildLocalDateTime(dateRaw, hora).toISOString();

        // Edição
        if (state.editing && state.editing._id) {
          const id = state.editing._id;

          // usa os itens montados na UI (edição agora permite adicionar/remover)
          const items = Array.isArray(state.tempServicos) ? state.tempServicos : [];
          if (!items.length) { alert('Adicione pelo menos 1 serviço ao agendamento.'); return; }

          const body = {
            storeId: storeIdSelected,
            profissionalId,
            scheduledAt,
            status,
            observacoes: (obsInput?.value || '').trim(),
            servicos: items.map(x => ({ servicoId: x._id, valor: Number(x.valor || 0) })),
            ...(state.editing.clienteId ? { clienteId: state.editing.clienteId } : {}),
            ...(petSelect?.value ? { petId: petSelect.value } : (state.editing.petId ? { petId: state.editing.petId } : {})),
            ...(typeof state.editing.pago !== 'undefined' ? { pago: state.editing.pago } : {})
          };

          const resp = await api(`/func/agendamentos/${id}`, { method: 'PUT', body: JSON.stringify(body) });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(err.message || 'Erro ao atualizar agendamento.');
            return;
          }

          await loadAgendamentos();
          renderKpis();
          renderFilters();
          closeModal();
          renderGrid();
          enhanceAgendaUI();
          return;
        }

        // Adição
        const clienteId = state.selectedCliente?._id;
        const petId = petSelect?.value;
        const items = state.tempServicos || [];

        if (!(clienteId && petId && items.length)) { alert('Preencha cliente, pet e adicione pelo menos 1 serviço.'); return; }

        const body = {
          storeId: storeIdSelected,
          clienteId, petId,
          servicos: items.map(x => ({ servicoId: x._id, valor: Number(x.valor || 0) })),
          profissionalId, scheduledAt,
          status,
          observacoes: (obsInput?.value || '').trim(),
          pago: false
        };
        const resp = await api('/func/agendamentos', { method: 'POST', body: JSON.stringify(body) });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.message || 'Erro ao salvar');
        }

        await loadAgendamentos();
        renderKpis();
        renderFilters();
        closeModal();
        renderGrid();
        enhanceAgendaUI();
      } catch (e) {
        console.error(e);
        alert(e.message || 'Erro ao salvar');
      }
    }

  function enhanceAgendaUI() {
    try {
      applyZebraAndSublines();
      decorateCards();

      // DnD ativo em dia, semana e mês
      if (state.view === 'day' || state.view === 'week' || state.view === 'month') {
        enableDragDrop();
      }
      // Linha do "agora" só onde faz sentido (dia/semana)
      if (state.view === 'day' || state.view === 'week') {
        drawNowLine();
      }

      if (state.view === 'day') {
        const date = normalizeDate(dateInput?.value || todayStr());
        if (!state.__didInitialScroll && date === todayStr()) {
          scrollToNow();
          state.__didInitialScroll = true;
        }
      }
    } catch (e) {
      console.info('[enhanceAgendaUI] skip', e);
    }
  }

  function scrollToNow() {
      const grids = agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
      const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
      if (!body || !state.profissionais?.length) return;

      // encontra a célula da primeira coluna de profissional no horário atual
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0') + ':00';
      const firstProfId = String(state.profissionais[0]._id);
      const target = body.querySelector(`div[data-profissional-id="${firstProfId}"][data-hh="${hh}"]`);

      if (target) {
        const top = target.getBoundingClientRect().top + window.pageYOffset;
        const offset = 80; // sobe um pouco para contexto
        window.scrollTo({ top: Math.max(0, top - offset), behavior: 'smooth' });
      }
  }

  // compacta a lista para um hash leve (ordem estável)
  function snapshotHash(items) {
    try {
      const compact = (items || []).map(x => [
        String(x._id || ''),
        String(x.status || ''),
        String(x.h || x.scheduledAt || ''),
        Number(x.valor || 0),
        !!x.pago
      ]).sort((a, b) => a[0].localeCompare(b[0]));
      return JSON.stringify(compact);
    } catch (_) {
      return String(Date.now());
    }
  }

  // reconsulta e só re-renderiza se houver mudança relevante
  async function refreshAgendaIfChanged() {
    const prev = state.lastSnapshotHash || '';
    await loadAgendamentos();
    const next = snapshotHash(state.agendamentos);
    if (next !== prev) {
      state.lastSnapshotHash = next;
      renderGrid();
      // ao re-render com mesma data de hoje, não repete o scroll
      enhanceAgendaUI();
    }
  }

  // inicia/renova o timer de auto-refresh (60s)
  function startAutoRefresh() {
    if (window.__agendaRefreshTimer) clearInterval(window.__agendaRefreshTimer);
    state.lastSnapshotHash = snapshotHash(state.agendamentos);
    window.__agendaRefreshTimer = setInterval(refreshAgendaIfChanged, 60000);
  }

  // cria o botão "Hoje" ao lado do input de data (uma vez)
  function ensureTodayButton() {
    if (!dateInput) return;
    if (document.getElementById('agenda-today-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'agenda-today-btn';
    btn.type = 'button';
    btn.className = 'ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50';
    btn.textContent = 'Hoje';

    dateInput.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', async () => {
      dateInput.value = todayStr();
      state.__didInitialScroll = false;   // permite novo auto-scroll
      await loadAgendamentos();
      renderGrid();
      enhanceAgendaUI();
    });
  }

  // Zebra de linhas + sublinha 30min com CSS (via classe)
  function applyZebraAndSublines() {
      const grids = agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
      const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
      if (!body) return;

      body.style.position = 'relative'; // para linha do "agora"
      const totalCols = 1 + (state.profissionais?.length || 0); // 1 (hora) + N profissionais
      if (totalCols <= 0) return;

      const cells = Array.from(body.children);
      const totalRows = Math.floor(cells.length / totalCols);

      for (let row = 0; row < totalRows; row++) {
        const start = row * totalCols;
        const zebraClass = (row % 2 === 0) ? 'bg-white' : 'bg-slate-50';

        // primeira coluna (hora)
        const tCell = cells[start];
        if (tCell) {
          tCell.classList.remove('bg-white','bg-slate-50');
          tCell.classList.add(zebraClass);
        }

        // colunas dos profissionais
        for (let col = 1; col < totalCols; col++) {
          const idx = start + col;
          const slot = cells[idx];
          if (!slot) continue;
          slot.classList.remove('bg-white','bg-slate-50');
          slot.classList.add(zebraClass, 'agenda-slot'); // garante classe
        }
      }
  }

  // Insere ícones de ação nos cartões (editar / mudar status)
  function decorateCards() {
      const cards = agendaList?.querySelectorAll('div[data-appointment-id]');
      if (!cards || !cards.length) return;

      cards.forEach((card) => {
        if (card.querySelector('.agenda-card__actions')) return; // já decorado
        card.classList.add('agenda-card'); // ativa hover via CSS
        card.style.position = 'relative';

        const id = card.getAttribute('data-appointment-id') || '';
        const item = (state.agendamentos || []).find(x => String(x._id) === String(id)) || {};
        const isPaid = !!item.pago || !!item.codigoVenda;

        const actions = document.createElement('div');
        actions.className = 'agenda-card__actions';

        actions.innerHTML = `
          <div class="agenda-card__actions-row">
            <button type="button" class="agenda-action edit" data-id="${id}" title="Editar" aria-label="Editar agendamento">
              <i class="fa-solid fa-pen text-[15px] leading-none"></i>
            </button>
            <button type="button" class="agenda-action status" data-id="${id}" title="Mudar status" aria-label="Mudar status do agendamento">
              <i class="fa-regular fa-clock text-[15px] leading-none"></i>
            </button>
          </div>
          <button type="button" class="agenda-action cobrar ${isPaid ? 'text-green-600' : 'text-slate-500'}" data-id="${id}" title="${isPaid ? 'Pago' : 'Registrar pagamento'}" aria-label="${isPaid ? 'Pagamento já registrado' : 'Registrar pagamento'}">
            ${
              isPaid
                ? `<i class="fa-solid fa-dollar-sign text-[15px] leading-none"></i>`
                : `<span class="fa-stack text-[11px] leading-none" style="width: 1.15em;">
                    <i class="fa-solid fa-dollar-sign fa-stack-1x"></i>
                    <i class="fa-solid fa-slash fa-stack-1x"></i>
                  </span>`
            }
          </button>
        `;
        card.appendChild(actions);
        card.classList.add('agenda-card--with-actions');

        // Se faturado e sem permissão -> não permitir arrastar/editar visualmente
        if ((!!item.pago || !!item.codigoVenda) && !isPrivilegedRole()) {
          card.setAttribute('draggable', 'false');
          card.classList.remove('cursor-move');
          card.classList.add('cursor-default');
        }
      });
    }

  /* === Drag & Drop na agenda: mover card entre horários/profissionais === */
  function injectDndStylesOnce() {
    if (document.getElementById('agenda-dnd-style')) return;
    const st = document.createElement('style');
    st.id = 'agenda-dnd-style';
    st.textContent = `
      .agenda-card.is-dragging { opacity: .6; }
      .agenda-drop-target { outline: 2px dashed #0ea5e9; outline-offset: -2px; background: rgba(14,165,233,0.06); }
    `;
    document.head.appendChild(st);
  }

  // PUT rápido para mover agendamento (profissional/horário)
  async function moveAppointmentQuick(id, payload) {
      try {
        const body = {
          ...payload,
          storeId: state.selectedStoreId || storeSelect?.value
        };
        const resp = await api(`/func/agendamentos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.message || 'Erro ao mover agendamento');
        }
        await loadAgendamentos();
        renderKpis();
        renderFilters();
        renderGrid();
        enhanceAgendaUI();
      } catch (e) {
        console.error('moveAppointmentQuick', e);
        alert(e.message || 'Não foi possível mover o agendamento.');
      }
    }

  function enableDragDrop() {
      injectDndStylesOnce();

      const grids = agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
      const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
      if (!body) return;

      // Garante que todos os cards estejam "arrastáveis"
      body.querySelectorAll('div[data-appointment-id]').forEach((card) => {
        if (!card.hasAttribute('draggable')) card.setAttribute('draggable', 'true');
      });

      // Evita múltiplos binds ao re-renderizar a agenda
      if (body.__dndDelegated) return;
      body.__dndDelegated = true;

      // DRAGSTART (captura): funciona mesmo se o usuário começar o arrasto em um filho do card
      body.addEventListener('dragstart', (ev) => {
        const card = ev.target?.closest?.('div[data-appointment-id]');
        if (!card || !ev.dataTransfer) return;

        const id = card.getAttribute('data-appointment-id') || '';
        if (!id) return;

        // Bloqueia início do arrasto se faturado e sem permissão
        try {
          const item = (state.agendamentos || []).find(x => String(x._id) === String(id));
          if (item && (item.pago || item.codigoVenda) && !isPrivilegedRole()) {
            ev.preventDefault();
            ev.stopPropagation();
            alert('Agendamento faturado: não é possível mover. (Somente Admin/Admin Master)');
            return;
          }
        } catch (_) {}

        try { ev.dataTransfer.setData('text/plain', id); } catch (_) {}
        try { ev.dataTransfer.setDragImage(card, 10, 10); } catch (_) {}
        ev.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      }, true);

      // DRAGEND: limpa estados visuais
      body.addEventListener('dragend', (ev) => {
        const card = ev.target?.closest?.('div[data-appointment-id]');
        if (card) card.classList.remove('is-dragging');
        body.querySelectorAll('.agenda-drop-target').forEach(s => s.classList.remove('agenda-drop-target'));
      }, true);

      // DRAGOVER: habilita drop quando o ponteiro está sobre QUALQUER filho dentro da célula
      body.addEventListener('dragover', (ev) => {
        const slot = ev.target?.closest?.('.agenda-slot');
        if (!slot) return;
        ev.preventDefault();                 // obrigatório para permitir drop
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        slot.classList.add('agenda-drop-target');
      });

      // DRAGLEAVE: remove realce
      body.addEventListener('dragleave', (ev) => {
        const slot = ev.target?.closest?.('.agenda-slot');
        if (!slot) return;
        slot.classList.remove('agenda-drop-target');
      });

      // DROP: adapta à visão atual
      body.addEventListener('drop', async (ev) => {
        const slot = ev.target?.closest?.('.agenda-slot');
        if (!slot) return;
        ev.preventDefault();

        const id = ev.dataTransfer?.getData('text/plain');
        if (!id) return;

        // Objeto original para preservar minutos no mensal
        const item = state.agendamentos.find(x => String(x._id) === String(id));
        if (!item) return;
        const orig = new Date(item.h || item.scheduledAt);

        // Semanal: tem day + hh. Mensal: só day; mantém HH:MM original
        const day = slot.dataset.day || normalizeDate(dateInput?.value || todayStr());
        const hh  = slot.dataset.hh || `${pad(orig.getHours())}:${String(orig.getMinutes()).padStart(2,'0')}`;

        const payload = {};
        if (slot.dataset.profissionalId) payload.profissionalId = slot.dataset.profissionalId;

        payload.scheduledAt = buildLocalDateTime(day, hh).toISOString();

        await moveAppointmentQuick(id, payload);
      });
  }

  async function loadProfissionais() {
    if (!state.selectedStoreId) {
      state.profissionais = [];
      if (profSelect) profSelect.innerHTML = '';
      return;
    }

    const resp = await api(`/func/profissionais/esteticistas?storeId=${state.selectedStoreId}`);
    const list = await resp.json().catch(() => []);
    state.profissionais = Array.isArray(list) ? list : [];

    if (profSelect) {
      profSelect.innerHTML = state.profissionais
        .map(p => `<option value="${p._id}">${p.nome}</option>`)
        .join('');
    }
  }

  // Linha do "agora" (atualiza a cada 1 minuto)
  function drawNowLine() {
      const grids = agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
      const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
      if (!body) return;

      body.querySelectorAll('.agenda-nowline').forEach(n => n.remove());

      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const percent = minutes / (24 * 60);
      const y = Math.max(0, Math.min(1, percent)) * body.scrollHeight;

      const line = document.createElement('div');
      line.className = 'agenda-nowline';
      line.style.top = `${y}px`;
      body.appendChild(line);

      if (window.__agendaNowTimer) clearInterval(window.__agendaNowTimer);
      window.__agendaNowTimer = setInterval(() => {
        const now2 = new Date();
        const minutes2 = now2.getHours() * 60 + now2.getMinutes();
        const percent2 = minutes2 / (24 * 60);
        const y2 = Math.max(0, Math.min(1, percent2)) * body.scrollHeight;
        const ln = body.querySelector('.agenda-nowline');
        if (ln) ln.style.top = `${y2}px`;
      }, 60_000);
  }

  // PUT rápido de status (ciclo: agendado → em_espera → em_atendimento → finalizado)
  async function updateStatusQuick(id, status) {
      try {
        const resp = await api(`/func/agendamentos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.message || 'Erro ao mudar status');
        }
        await loadAgendamentos();
        renderKpis();
        renderFilters();
        renderGrid();
        enhanceAgendaUI();
      } catch (e) {
        console.error('updateStatusQuick', e);
        alert(e.message || 'Erro ao mudar status');
      }
    }

    // === Impressão em cupom (80mm) ===
  function buildCupomHTML(items, meta = {}) {
    const storeName = (meta.storeName || '').trim();
    const dateStr   = (meta.dateStr || '').trim();

    const rows = (items || []).map(a => {
      const pet   = (a.pet || '').toString().trim();
      const serv  = (a.servico || '').toString().trim();
      const valor = money(Number(a.valor || 0));
      // "Pet Serviço - Valor" em linha única
      return `<div class="row"><span class="txt">${pet} ${serv}</span><span class="val">${valor}</span></div>`;
    }).join('');

    return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Impressão</title>
    <style>
      @page { size: 80mm auto; margin: 3mm; }
      * { box-sizing: border-box; }
      html, body { padding: 0; margin: 0; }
      /* Aumenta um pouco o tamanho e usa preto sólido para ganhar contraste na térmica */
      body {
        width: 74mm;
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
        color: #000;
        -webkit-font-smoothing: none; /* deixa o traço mais “cheio” na impressão */
        font-weight: 600; /* base mais pesada */
      }
      .wrap { padding: 2mm 0; }
      .h1 { text-align:center; font-weight:700; font-size: 15px; margin-bottom: 1mm; }
      .meta { text-align:center; font-size: 12px; color:#000; font-weight:700; margin-bottom: 2mm; }
      .hr { border-top: 1px dashed #000; margin: 2mm 0; }
      .row { display:flex; align-items:flex-start; justify-content:space-between; gap: 4mm; padding: 1mm 0; }
      /* Linhas do cupom bem escuras */
      .row .txt { flex: 1 1 auto; word-break: break-word; font-weight:700; }
      .row .val { flex: 0 0 auto; white-space: nowrap; font-weight:700; }
      .foot { text-align:center; margin-top: 2mm; font-size: 12px; color:#000; font-weight:700; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="h1">Agenda</div>
      <div class="meta">${storeName ? storeName + ' • ' : ''}${dateStr}</div>
      <div class="hr"></div>
      ${rows || '<div class="row"><span class="txt">Sem itens</span><span class="val"></span></div>'}
      <div class="hr"></div>
      <div class="foot">Obrigado!</div>
    </div>
    <script>
      window.onload = function(){ setTimeout(function(){ window.print(); }, 50); };
      window.onafterprint = function(){ setTimeout(function(){ window.close(); }, 50); };
    </script>
  </body>
  </html>`;
  }

  function handlePrintCupom() {
    try {
      const items = getFilteredAgendamentos();

      // Ordena por horário (se houver)
      items.sort((a, b) => {
        const da = new Date(a.h || a.scheduledAt || 0).getTime();
        const db = new Date(b.h || b.scheduledAt || 0).getTime();
        return da - db;
      });

      const dateStr =
        (document.getElementById('agenda-date-label-visible')?.textContent || '').trim() ||
        new Date((normalizeDate(dateInput?.value || todayStr())) + 'T00:00:00').toLocaleDateString('pt-BR');

      const storeName =
        (document.getElementById('agenda-store-label-visible')?.textContent || '').trim();

      const html = buildCupomHTML(items, { storeName, dateStr });

      const w = window.open('', 'print_cupom', 'width=420,height=600');
      if (!w) { alert('O navegador bloqueou a janela de impressão. Habilite pop-ups para continuar.'); return; }
      w.document.open('text/html');
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch (e) {
      console.error('handlePrintCupom', e);
      alert('Não foi possível preparar a impressão.');
    }
  }

  // Events
  addBtn?.addEventListener('click', openAddModal);
  modalClose?.addEventListener('click', closeModal);
  modalCancel?.addEventListener('click', closeModal);
  modalSave?.addEventListener('click', saveAgendamento);

  addStoreSelect?.addEventListener('change', () => {
    const sid = addStoreSelect.value;
    const current = profSelect?.value || '';
    populateModalProfissionais(sid, current);
  });

  // Botão "Imprimir" — cupom 80mm com "Pet Serviço - Valor"
    (function () {
      const btn0 = document.getElementById('print-agenda-btn');
      // (se algum listener antigo ainda existir em outro build, garantimos o nosso fluxo)
      if (btn0) {
        // remove listeners antigos (se houver) clonando o nó
        const clone = btn0.cloneNode(true);
        btn0.parentNode.replaceChild(clone, btn0);
        clone.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopImmediatePropagation?.();
          handlePrintCupom();
        });
      }
    })();

  cliInput?.addEventListener('input', debounce((e) => searchClientes(e.target.value), 300));
  servInput?.addEventListener('input', debounce((e) => searchServicos(e.target.value), 300));

  addServAddBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const s = state.selectedServico;
    const v = Number(valorInput?.value || 0);
    if (!s || !s._id) { alert('Escolha um serviço na busca.'); return; }
    if (!(v >= 0)) { alert('Valor inválido.'); return; }
    state.tempServicos.push({ _id: s._id, nome: s.nome, valor: v });
    // limpa seleção
    state.selectedServico = null;
    if (servInput)  servInput.value = '';
    if (valorInput) valorInput.value = '';
    renderServicosLista();
  });

  modalDelete?.addEventListener('click', handleDelete);

  // Ações rápidas nos cartões (delegação no container da agenda)
  actionsRoot?.addEventListener('click', (ev) => {
    // toggle do menu mobile
    const more = ev.target.closest('.agenda-card__more');
    if (more) {
      const holder = more.parentElement?.querySelector('.agenda-card__actions');
      if (holder) holder.classList.toggle('hidden');
      return;
    }

    const btn = ev.target.closest('.agenda-action');
    if (!btn) return;

    // Evita abrir o modal de edição do card quando o alvo é um botão de ação
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();

    const id = btn.getAttribute('data-id');
    if (!id) return;

    if (btn.classList.contains('edit')) {
      // Se a modal de venda estiver aberta, não abrir edição (para versões que ainda usam este arquivo)
      const vendaOpen = !document.getElementById('venda-modal')?.classList.contains('hidden');
      if (vendaOpen) return;
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;
      if ((item.pago || item.codigoVenda) && !isPrivilegedRole()) {
        notify('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.', 'warning');
        return;
      }
      openEditModal(item);
    } else if (btn.classList.contains('status')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
      const cur = (item && item.status) || 'agendado';
      const next = chain[(chain.indexOf(cur) + 1) % chain.length];
      updateStatusQuick(id, next);
    } else if (btn.classList.contains('cobrar')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;

      if (item.pago || item.codigoVenda) {
        notify('Este agendamento já possui código de venda registrado.', 'warning');
        return;
      }
        // Fecha a de edição, se por algum motivo estiver visível
        try {
          const modalAdd = document.getElementById('modal-add-servico');
          if (modalAdd && !modalAdd.classList.contains('hidden')) {
            modalAdd.classList.add('hidden');
            modalAdd.classList.remove('flex');
            modalAdd.style.display = 'none';
            modalAdd.setAttribute('aria-hidden', 'true');
          }
        } catch (_) {}
        requestAnimationFrame(() => (window.openVendaModal || openVendaModal)(item)); // agora abre somente a modal de venda
    }
  });

  storeSelect?.addEventListener('change', async () => {
    state.selectedStoreId = storeSelect.value;
    updateStoreLabel();
    state.__didInitialScroll = false;     // nova loja -> recalcula scroll
    await loadProfissionais();
    await loadAgendamentos();
    renderGrid();
    enhanceAgendaUI();
  });

  dateInput?.addEventListener('change', async () => {
    state.__didInitialScroll = false;     // nova data -> permite auto-scroll
    await loadAgendamentos();
    renderGrid();
    enhanceAgendaUI();
  });

  // Boot
  function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return; // não atrapalhar digitação
      if (e.key === 't' || e.key === 'T') {
        if (dateInput) {
          dateInput.value = todayStr();
          state.__didInitialScroll = false;
          loadAgendamentos().then(() => {
            renderKpis(); renderFilters(); renderGrid(); enhanceAgendaUI();
          });
        }
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openAddModal();
      }
    });
  }

  (async function init() {
    if (!dateInput?.value) dateInput.value = todayStr();
    if (viewSelect && !viewSelect.value) viewSelect.value = 'day';
    state.view = (viewSelect?.value) || 'day';

    loadFiltersFromStorage();
    await loadStores();
    if (!state.selectedStoreId && storeSelect?.value) {
      state.selectedStoreId = storeSelect.value;
    }
    await loadProfissionais();
    await loadAgendamentos();

    ensureToolbar();
    ensureTodayButton();
    setupShortcuts();

    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  })();

  dateInput?.addEventListener('change', async () => {
    state.__didInitialScroll = false;
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });

  viewSelect?.addEventListener('change', async () => {
    state.view = viewSelect.value || 'day';
    state.__didInitialScroll = false;
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });

  // Atualizações após troca de loja/data/status etc.
  storeSelect?.addEventListener('change', async () => {
    state.selectedStoreId = storeSelect.value;
    updateStoreLabel();
    state.__didInitialScroll = false;
    await loadProfissionais();
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });

  dateInput?.addEventListener('change', async () => {
    state.__didInitialScroll = false;
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  });
})();
