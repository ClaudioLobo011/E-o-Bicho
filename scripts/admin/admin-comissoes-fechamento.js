(function () {
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  let currentMonth = new Date();
  let filteredList = [];
  let closingsData = [];
  let pendentesList = [];
  let stores = [];

  const el = (id) => document.getElementById(id);
  const formatMoney = (v) => currency.format(Number(v || 0));
  const formatMonthLabel = (date) =>
    date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());

  function parsePeriodoMonth(item) {
    if (item.periodoInicio) {
      const d = new Date(item.periodoInicio);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(item.periodo || ''));
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function renderKpis(list) {
    const totalPrevisto = list.reduce((sum, item) => sum + (item.previsto || item.totalPeriodo || 0), 0);
    const pagos = list.reduce((sum, item) => sum + (item.pago || item.totalPago || 0), 0);
    const receber = list
      .filter((item) => item.status !== 'pago')
      .reduce(
        (sum, item) =>
          sum + (item.pendente || item.totalPendente || Math.max((item.previsto || 0) - (item.pago || 0), 0)),
        0,
      );
    const ultimo = list
      .filter((item) => item.status === 'pago' && item.ultimoPagamento && item.ultimoPagamento !== '—')
      .map((item) => item.ultimoPagamento)[0] || '—';

    const setText = (id, value) => {
      const node = el(id);
      if (node) node.textContent = value;
    };

    setText('kpi-total-previsto', formatMoney(totalPrevisto));
    setText('kpi-pagos', formatMoney(pagos));
    setText('kpi-receber', formatMoney(receber));
    setText('kpi-ultimo', ultimo);
  }

  function statusBadge(status) {
    const normalized = String(status || '').toLowerCase();
    const map = {
      pago: 'bg-emerald-50 text-emerald-600',
      agendado: 'bg-blue-50 text-blue-600',
      pendente: 'bg-amber-50 text-amber-600',
    };
    const label = normalized
      ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
      : 'Status';
    return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${map[normalized] || 'bg-gray-100 text-gray-600'}"><i class="fas fa-circle text-[8px]"></i>${label}</span>`;
  }

  function renderTabela(list) {
    const tbody = el('fechamento-tbody');
    const info = el('fechamento-contagem');
    const card = el('agenda-repasses-card');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!list.length) {
      if (card) card.classList.add('hidden');
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-4 text-center text-gray-500">Nenhum fechamento encontrado.</td></tr>';
      if (info) info.textContent = '0 registros';
      return;
    }
    if (card) card.classList.remove('hidden');

    list.forEach((item) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="px-4 py-3">
          <p class="font-semibold text-gray-900">${item.profissionalNome || item.profissional || '—'}</p>
          <p class="text-xs text-gray-500">${item.storeNome || '—'}</p>
        </td>
        <td class="px-4 py-3">${item.tipo || 'Vendas/Serviços'}</td>
        <td class="px-4 py-3 text-gray-700">${item.periodo || formatPeriodo(item)}</td>
        <td class="px-4 py-3 font-semibold text-gray-900">${formatMoney(item.previsto || item.totalPeriodo || 0)}</td>
        <td class="px-4 py-3 font-semibold text-gray-900">${formatMoney(item.pago || item.totalPago || 0)}</td>
        <td class="px-4 py-3">${statusBadge(item.status)}</td>
        <td class="px-4 py-3 text-gray-700">
          <p>${item.proximo || item.meioPagamento || '—'}</p>
          <p class="text-xs text-gray-500">Prev: ${item.previsaoPagamento ? new Date(item.previsaoPagamento).toLocaleDateString('pt-BR') : '—'}</p>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (info) info.textContent = `Mostrando ${list.length} registro(s)`;
  }

  function renderCardsPendentes(list) {
    const wrap = el('cards-pendentes');
    if (!wrap) return;
    wrap.innerHTML = '';

    const pendentes = new Map();
    list.forEach((item) => {
      const vendas = item.pendenteVendas ?? item.totalVendas ?? 0;
      const servicos = item.pendenteServicos ?? item.totalServicos ?? 0;
      const falta = (item.pendente ?? item.totalPendente ?? (vendas + servicos)) || 0;
      if (falta <= 0) return;
      const key = item.profissionalNome || item.profissional || 'Sem nome';
      pendentes.set(key, {
        vendas,
        servicos,
      });
    });

    if (!pendentes.size) {
      wrap.innerHTML = '<div class="col-span-full text-center text-gray-500 text-sm">Nenhuma comissão pendente.</div>';
      return;
    }

    Array.from(pendentes.entries()).forEach(([nome, valores]) => {
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-gray-100 bg-white p-4 shadow-sm flex flex-col gap-2';
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <p class="font-semibold text-gray-800">${nome}</p>
          <span class="text-xs font-semibold uppercase tracking-wide text-amber-600">Pendente</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="rounded-lg bg-amber-50 px-3 py-2">
            <p class="text-xs uppercase tracking-wide text-amber-700 font-semibold">Comissão Vendas</p>
            <p class="text-base font-bold text-amber-900">${formatMoney(valores.vendas)}</p>
          </div>
          <div class="rounded-lg bg-blue-50 px-3 py-2">
            <p class="text-xs uppercase tracking-wide text-blue-700 font-semibold">Comissão Serviços</p>
            <p class="text-base font-bold text-blue-900">${formatMoney(valores.servicos)}</p>
          </div>
        </div>
      `;
      wrap.appendChild(card);
    });
  }

  function getPeriodoRange() {
    const val = el('filtro-periodo')?.value || 'mes';
    const now = new Date();
    let days = 30;
    if (val === 'trim') days = 90;
    if (val === 'ano') days = 365;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  function formatPeriodo(item) {
    if (item.periodoInicio) {
      const ini = new Date(item.periodoInicio);
      const fim = item.periodoFim ? new Date(item.periodoFim) : ini;
      const iniStr = !Number.isNaN(ini.getTime()) ? ini.toLocaleDateString('pt-BR') : '—';
      const fimStr = !Number.isNaN(fim.getTime()) ? fim.toLocaleDateString('pt-BR') : '—';
      return `${iniStr} a ${fimStr}`;
    }
    return item.periodo || '—';
  }

  function filtraPorMes(list) {
    return list.filter((item) => {
      const d = parsePeriodoMonth(item);
      if (!d) return true;
      return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
    });
  }

  function aplicaFiltros() {
    const status = el('filtro-status')?.value || '';
    const busca = (el('filtro-busca')?.value || '').trim().toLowerCase();
    const store = el('empresa-select')?.value || '';

    let base = closingsData.length ? closingsData : [];
    let filtrados = filtraPorMes(base.slice());
    if (status) {
      filtrados = filtrados.filter((item) => String(item.status).toLowerCase() === status);
    }
    if (store) {
      filtrados = filtrados.filter((item) => String(item.store || item.storeId || '') === store);
    }
    if (busca) {
      filtrados = filtrados.filter((item) => {
        return (
          String(item.profissionalNome || item.profissional || '').toLowerCase().includes(busca) ||
          String(item.id || '').toLowerCase().includes(busca)
        );
      });
    }
    renderKpis(filtrados);
    renderTabela(filtrados);
    renderCardsPendentes(pendentesList);
    filteredList = filtrados;
  }

  function bindActions() {
    el('btn-aplicar')?.addEventListener('click', aplicaFiltros);
    el('btn-limpar')?.addEventListener('click', () => {
      if (el('filtro-status')) el('filtro-status').value = '';
      if (el('filtro-busca')) el('filtro-busca').value = '';
      aplicaFiltros();
    });
    el('mes-anterior')?.addEventListener('click', () => {
      currentMonth.setMonth(currentMonth.getMonth() - 1);
      atualizaMesLabel();
      aplicaFiltros();
    });
    el('mes-proximo')?.addEventListener('click', () => {
      currentMonth.setMonth(currentMonth.getMonth() + 1);
      atualizaMesLabel();
      aplicaFiltros();
    });
    el('btn-novo-fechamento')?.addEventListener('click', openModal);
    document.querySelectorAll('[data-fechamento-close]')?.forEach((btn) =>
      btn.addEventListener('click', closeModal)
    );
    el('fechamento-salvar')?.addEventListener('click', salvarFechamento);
    el('filtro-periodo')?.addEventListener('change', () => {
      fetchPendentes();
      aplicaFiltros();
    });
    el('empresa-select')?.addEventListener('change', () => {
      fetchFechamentos();
      fetchPendentes();
    });
  }

  function atualizaMesLabel() {
    const label = el('mes-label');
    if (label) label.textContent = formatMonthLabel(currentMonth);
  }

  function openModal() {
    const modal = el('modal-fechamento');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    atualizaModalKpis();
  }

  function closeModal() {
    const modal = el('modal-fechamento');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  function atualizaModalKpis() {
    const base = filteredList.length ? filteredList : [];
    const totalPendente = base.reduce(
      (sum, item) => sum + (item.pendente ?? item.totalPendente ?? Math.max((item.previsto || 0) - (item.pago || 0), 0)),
      0,
    );
    const totalPeriodo = base.reduce((sum, item) => sum + (item.previsto || item.totalPeriodo || 0), 0);
    const set = (id, value) => {
      const node = el(id);
      if (node) node.textContent = value;
    };
    set('fechamento-kpi-pendente', formatMoney(totalPendente));
    set('fechamento-kpi-periodo', formatMoney(totalPeriodo));
  }

  async function fetchStores() {
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/stores`, {
        headers: authHeaders(),
      });
      const data = await resp.json();
      stores = Array.isArray(data) ? data : [];
      const select = el('empresa-select');
      if (select) {
        select.innerHTML = '<option value="">Todas</option>' + stores.map((s) => `<option value="${s._id}">${s.nome}</option>`).join('');
      }
    } catch (e) {
      console.error('fetchStores', e);
    }
  }

  async function fetchFuncionarios() {
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/funcionarios`, { headers: authHeaders() });
      const data = await resp.json();
      const select = el('fechamento-funcionario');
      if (select) {
        const opts = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : [];
        select.innerHTML =
          '<option value="">Selecione</option>' +
          opts
            .map((f) => {
              const nome = f.nomeCompleto || f.nomeContato || f.razaoSocial || f.nome || 'Sem nome';
              const id = f._id || f.id || '';
              return id ? `<option value="${id}">${nome}</option>` : '';
            })
            .join('');
      }
    } catch (e) {
      console.error('fetchFuncionarios', e);
    }
  }

  async function fetchFechamentos() {
    try {
      const store = el('empresa-select')?.value || '';
      const params = new URLSearchParams();
      if (store) params.set('store', store);
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await resp.json();
      closingsData = Array.isArray(data) ? data : [];
      filteredList = closingsData.slice();
      aplicaFiltros();
    } catch (e) {
      console.error('fetchFechamentos', e);
      closingsData = [];
      filteredList = [];
      aplicaFiltros();
    }
  }

  async function fetchPendentes() {
    try {
      const store = el('empresa-select')?.value || '';
      const { start, end } = getPeriodoRange();
      const params = new URLSearchParams();
      if (store) params.set('store', store);
      params.set('start', start.toISOString());
      params.set('end', end.toISOString());
      const resp = await fetch(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/pendentes?${params.toString()}`,
        { headers: authHeaders() },
      );
      const data = await resp.json();
      pendentesList = Array.isArray(data) ? data : [];
      renderCardsPendentes(pendentesList);
    } catch (e) {
      console.error('fetchPendentes', e);
      pendentesList = [];
      renderCardsPendentes([]);
    }
  }

  async function salvarFechamento() {
    const funcionario = el('fechamento-funcionario')?.value || '';
    const inicio = el('fechamento-inicio')?.value || '';
    const fim = el('fechamento-fim')?.value || '';
    const previsao = el('fechamento-prev')?.value || '';
    const meio = el('fechamento-meio')?.value || '';
    const store = el('empresa-select')?.value || '';
    if (!funcionario || !inicio || !fim) {
      alert('Preencha funcionário e período.');
      return;
    }
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profissionalId: funcionario,
          inicio,
          fim,
          previsaoPagamento: previsao || null,
          meioPagamento: meio || '',
          storeId: store || null,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || 'Erro ao salvar fechamento');
      }
      await fetchFechamentos();
      await fetchPendentes();
      closeModal();
    } catch (e) {
      console.error('salvarFechamento', e);
      alert(e.message || 'Erro ao salvar fechamento');
    }
  }

  function authHeaders() {
    try {
      const token = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  function init() {
    atualizaMesLabel();
    bindActions();
    fetchStores().then(() => fetchFechamentos());
    fetchFuncionarios();
    fetchPendentes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
