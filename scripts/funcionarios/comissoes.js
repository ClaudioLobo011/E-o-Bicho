(function () {
  const API_BASE = API_CONFIG?.BASE_URL || 'http://localhost:3000/api';
  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const tabs = document.querySelectorAll('[data-comissoes-tab]');
  const views = document.querySelectorAll('[data-comissoes-view]');

  function parseMoney(value, fallback = 0) {
    if (Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value
        .replace(/[^0-9,.-]+/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.');
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatMoney(value = 0) {
    return currencyFormatter.format(parseMoney(value, 0));
  }

  function statusBadge(status = '') {
    const normalized = String(status || '').toLowerCase();
    const map = {
      ativa: 'bg-emerald-50 text-emerald-600',
      pago: 'bg-emerald-50 text-emerald-600',
      pendente: 'bg-amber-50 text-amber-600',
      aguardando: 'bg-gray-100 text-gray-700',
      cancelado: 'bg-red-50 text-red-600',
      estornada: 'bg-rose-50 text-rose-600',
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
    const total = parseMoney(
      resumo.totalPrevisto ?? resumo.totalGerado ?? 0,
      0,
    );
    document.getElementById(`${prefix}-total-gerado`).textContent = formatMoney(total);
    document.getElementById(`${prefix}-total-variacao`).textContent = '--';
    document.getElementById(`${prefix}-a-receber`).textContent = formatMoney(resumo.aReceber || 0);
    document.getElementById(`${prefix}-pagas`).textContent = formatMoney(resumo.pagas || 0);
    document.getElementById(`${prefix}-media`).textContent = formatMoney(resumo.media || 0);
  }

  function renderProximos(view, proximos = []) {
    const list = document.getElementById(`${view}-proximos-list`);
    list.innerHTML = '';

    if (!Array.isArray(proximos) || !proximos.length) {
      list.innerHTML = '<p class="text-sm text-gray-500">Nenhum pagamento previsto.</p>';
      return;
    }

    proximos.forEach((item) => {
      const status = String(item.status || '').toLowerCase();
      const dotClass =
        status === 'pago' || status === 'confirmado'
          ? 'bg-emerald-500'
          : status === 'agendado'
          ? 'bg-sky-500'
          : 'bg-amber-500';
      const valueClass =
        status === 'pago' || status === 'confirmado'
          ? 'text-emerald-600'
          : status === 'agendado'
          ? 'text-sky-600'
          : 'text-amber-600';

      const detailLines = [];
      if (item.periodoLabel) detailLines.push(item.periodoLabel);
      if (item.info) detailLines.push(item.info);
      if (!detailLines.length) detailLines.push('Sem detalhes adicionais');

      const wrapper = document.createElement('div');
      wrapper.className = 'flex items-start gap-3 rounded-lg border border-gray-100 p-3';
      wrapper.innerHTML = `
        <div class="mt-1 h-2 w-2 rounded-full ${dotClass}"></div>
        <div class="flex-1">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-gray-800">${item.titulo}</p>
            <span class="text-sm font-semibold ${valueClass}">${formatMoney(item.valor || 0)}</span>
          </div>
          ${detailLines
            .map((line) => `<p class="text-xs text-gray-500">${line}</p>`)
            .join('')}
        </div>
      `;
      list.appendChild(wrapper);
    });
  }

  function renderResumoPeriodo(view, resumo = {}) {
    const list = document.getElementById(`${view}-resumo-list`);
    list.innerHTML = '';
    const entries = [
      { label: view === 'produtos' ? 'Itens com comissão' : 'Vendas com comissão', value: resumo.vendasComComissao || 0, highlight: 'text-gray-900' },
      { label: 'Taxa de aprovação', value: `${resumo.taxaAprovacao || 0}%`, highlight: 'text-emerald-600' },
      { label: view === 'produtos' ? 'Tempo médio de repasse' : 'Tempo médio de liberação', value: resumo.tempoMedioLiberacao ? `${resumo.tempoMedioLiberacao} dias` : 'N/D', highlight: 'text-gray-900' },
      { label: view === 'produtos' ? 'Bônus por combo' : 'Bonificações', value: formatMoney(resumo.bonificacoes || 0), highlight: 'text-blue-600' },
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
    const isServicos = view === 'servicos';
    const colSpan = isServicos ? 8 : 9;
    body.innerHTML = '';

    if (!Array.isArray(historico) || !historico.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="px-4 py-4 text-center text-gray-500">Nenhum registro encontrado.</td></tr>`;
      if (info) info.textContent = '';
      return;
    }

    historico.forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50';
      const comissaoVenda = parseMoney(item.comissaoVenda ?? 0, 0);
      const comissaoServico = parseMoney(item.comissaoServico ?? 0, 0);
      const comissaoTotal = parseMoney(
        item.comissaoTotal ?? item.valor ?? comissaoVenda + comissaoServico,
        0,
      );
      const commissionStatusRaw = String(item.status_comissao || item.statusComissao || '').toLowerCase();
      const statusLabel = commissionStatusRaw.includes('estorn') ? 'estornada' : item.status;
      const referencia = item.referencia ? `<p class="text-xs text-gray-500">Ref: ${item.referencia}</p>` : '';
      const cells = [
        `<td class="px-4 py-3">${item.data || '--'}</td>`,
        `<td class="px-4 py-3">
          <p class="font-semibold text-gray-900">${item.codigo || '--'}</p>
          <p class="text-xs text-gray-500">${item.descricao || ''}</p>
          ${referencia}
        </td>`,
        `<td class="px-4 py-3">${item.cliente || '--'}</td>`,
        `<td class="px-4 py-3">${item.origem || '--'}</td>`,
        `<td class="px-4 py-3">${statusBadge(statusLabel)}</td>`,
      ];
      if (!isServicos) {
        cells.push(
          `<td class="px-4 py-3 font-semibold text-gray-900">${formatMoney(comissaoVenda)}</td>`,
        );
      }
      cells.push(
        `<td class="px-4 py-3 font-semibold text-gray-900">${formatMoney(comissaoServico)}</td>`,
        `<td class="px-4 py-3 font-semibold text-gray-900">
          <p>${formatMoney(comissaoTotal)}</p>
          ${
            item.valorVenda
              ? `<p class="text-xs font-normal text-gray-500">Venda: ${formatMoney(item.valorVenda)}</p>`
              : ''
          }
        </td>`,
        `<td class="px-4 py-3 text-gray-600">${item.pagamento || '--'}</td>`,
      );
      row.innerHTML = cells.join('');
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
    toggleView('produtos');

    const data = await fetchComissoes();
    if (!data) return;

    renderView('produtos', data.produtos);
    renderView('servicos', data.servicos);
  }

  init();
})();
