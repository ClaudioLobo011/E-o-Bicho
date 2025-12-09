(function () {
  const API_BASE = API_CONFIG?.BASE_URL || 'http://localhost:3000/api';
  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const tabs = document.querySelectorAll('[data-comissoes-tab]');
  const views = document.querySelectorAll('[data-comissoes-view]');

  function formatCurrency(value = 0) {
    const numeric = Number.isFinite(value) ? value : 0;
    return currencyFormatter.format(numeric);
  }

  function statusBadge(status = '') {
    const normalized = String(status || '').toLowerCase();
    const map = {
      pago: 'bg-emerald-50 text-emerald-600',
      pendente: 'bg-amber-50 text-amber-600',
      aguardando: 'bg-gray-100 text-gray-700',
      cancelado: 'bg-red-50 text-red-600',
    };
    const classes = map[normalized] || 'bg-gray-100 text-gray-700';
    const label = normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Status';
    return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${classes}"><i class="fas fa-circle text-[8px]"></i>${label}</span>`;
  }

  function toggleView(view) {
    views.forEach((section) => {
      section.classList.toggle('hidden', section.dataset.comissoesView !== view);
    });

    tabs.forEach((tab) => {
      const isActive = tab.dataset.comissoesTab === view;
      tab.classList.toggle('text-primary', isActive);
      tab.classList.toggle('bg-white', isActive);
      tab.classList.toggle('shadow-sm', isActive);
      tab.classList.toggle('ring-1', isActive);
      tab.classList.toggle('ring-primary', isActive);
      tab.classList.toggle('hover:text-primary', !isActive);
    });
  }

  async function fetchComissoes() {
    const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    const token = cached?.token;

    if (!token) {
      alert('Você precisa estar logado para visualizar suas comissões.');
      window.location.replace('/pages/login.html');
      return null;
    }

    const resp = await fetch(`${API_BASE}/func/comissoes`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      console.error('[Comissões] Falha ao carregar dados', resp.status);
      alert('Não foi possível carregar as comissões.');
      return null;
    }

    return resp.json();
  }

  function renderResumo(view, resumo = {}) {
    const prefix = view === 'produtos' ? 'produtos' : 'servicos';
    document.getElementById(`${prefix}-total-gerado`).textContent = formatCurrency(resumo.totalGerado || 0);
    document.getElementById(`${prefix}-total-variacao`).textContent = resumo.totalGerado ? '+0%' : '--';
    document.getElementById(`${prefix}-a-receber`).textContent = formatCurrency(resumo.aReceber || 0);
    document.getElementById(`${prefix}-pagas`).textContent = formatCurrency(resumo.pagas || 0);
    document.getElementById(`${prefix}-media`).textContent = formatCurrency(resumo.media || 0);
  }

  function renderProximos(view, proximos = []) {
    const list = document.getElementById(`${view}-proximos-list`);
    list.innerHTML = '';

    if (!Array.isArray(proximos) || !proximos.length) {
      list.innerHTML = '<p class="text-sm text-gray-500">Nenhum pagamento previsto.</p>';
      return;
    }

    proximos.forEach((item) => {
      const dotClass = item.status === 'confirmado' ? 'bg-emerald-500' : 'bg-amber-500';
      const valueClass = item.status === 'confirmado' ? 'text-emerald-600' : 'text-amber-600';
      const wrapper = document.createElement('div');
      wrapper.className = 'flex items-start gap-3 rounded-lg border border-gray-100 p-3';
      wrapper.innerHTML = `
        <div class="mt-1 h-2 w-2 rounded-full ${dotClass}"></div>
        <div class="flex-1">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-gray-800">${item.titulo}</p>
            <span class="text-sm font-semibold ${valueClass}">${formatCurrency(item.valor || 0)}</span>
          </div>
          <p class="text-xs text-gray-500">${item.info || 'Sem detalhes adicionais'}</p>
        </div>
      `;
      list.appendChild(wrapper);
    });
  }

  function renderResumoPeriodo(view, resumo = {}) {
    const list = document.getElementById(`${view}-resumo-list`);
    list.innerHTML = '';
    const entries = [
      { label: view === 'produtos' ? 'Pedidos com comissão' : 'Vendas com comissão', value: resumo.vendasComComissao || 0, highlight: 'text-gray-900' },
      { label: 'Taxa de aprovação', value: `${resumo.taxaAprovacao || 0}%`, highlight: 'text-emerald-600' },
      { label: view === 'produtos' ? 'Tempo médio de repasse' : 'Tempo médio de liberação', value: resumo.tempoMedioLiberacao ? `${resumo.tempoMedioLiberacao} dias` : 'N/D', highlight: 'text-gray-900' },
      { label: view === 'produtos' ? 'Bônus por combo' : 'Bonificações', value: formatCurrency(resumo.bonificacoes || 0), highlight: 'text-blue-600' },
      { label: view === 'produtos' ? 'Pedidos devolvidos' : 'Cancelamentos', value: resumo.cancelamentos ? `${resumo.cancelamentos} registro(s)` : 'Nenhum', highlight: 'text-amber-600' },
    ];

    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between';
      row.innerHTML = `
        <dt class="text-gray-600">${entry.label}</dt>
        <dd class="font-semibold ${entry.highlight}">${entry.value}</dd>
      `;
      list.appendChild(row);
    });
  }

  function renderHistorico(view, historico = []) {
    const body = document.getElementById(`${view}-historico-body`);
    const info = document.getElementById(`${view}-historico-info`);
    body.innerHTML = '';

    if (!Array.isArray(historico) || !historico.length) {
      body.innerHTML = '<tr><td colspan="7" class="px-4 py-4 text-center text-gray-500">Nenhum registro encontrado.</td></tr>';
      if (info) info.textContent = '';
      return;
    }

    historico.forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50';
      row.innerHTML = `
        <td class="px-4 py-3">${item.data || '--'}</td>
        <td class="px-4 py-3">
          <p class="font-semibold text-gray-900">${item.codigo || '--'}</p>
          <p class="text-xs text-gray-500">${item.descricao || ''}</p>
        </td>
        <td class="px-4 py-3">${item.cliente || '--'}</td>
        <td class="px-4 py-3">${item.origem || '--'}</td>
        <td class="px-4 py-3">${statusBadge(item.status)}</td>
        <td class="px-4 py-3 font-semibold text-gray-900">${formatCurrency(item.valor || 0)}</td>
        <td class="px-4 py-3 text-gray-600">${item.pagamento || '--'}</td>
      `;
      body.appendChild(row);
    });

    if (info) {
      info.textContent = `Mostrando ${historico.length} registro(s)`;
    }
  }

  function renderView(view, data) {
    if (!data) return;
    renderResumo(view, data.resumo || {});
    renderProximos(view, data.proximosPagamentos || []);
    renderResumoPeriodo(view, data.resumo?.resumoPeriodo || {});
    renderHistorico(view, data.historico || []);
  }

  async function init() {
    tabs.forEach((tab) => tab.addEventListener('click', () => toggleView(tab.dataset.comissoesTab)));
    toggleView('servicos');

    const data = await fetchComissoes();
    if (!data) return;

    renderView('servicos', data.servicos);
    renderView('produtos', data.produtos);
  }

  init();
})();
