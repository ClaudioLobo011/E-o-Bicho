(function () {
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  let currentMonth = new Date();
  let filteredList = [];
  let closingsData = [];
  let pendentesList = [];
  let pendentesAllList = [];
  let configAccounts = [];
  let configSelected = null;
  let configBankAccounts = [];
  let configBankSelected = null;
  let stores = [];

  const el = (id) => document.getElementById(id);
  const formatMoney = (v) => currency.format(Number(v || 0));
  const formatMonthLabel = (date) =>
    date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());

  function formatInputDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function formatInputTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function formatDateNoTZ(value) {
    if (!value) return '--';

    // Para strings (com ou sem horário), pegamos apenas a parte YYYY-MM-DD e formatamos manualmente.
    if (typeof value === 'string') {
      const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, y, m, d] = match;
        return `${d}/${m}/${y}`;
      }
    }

    // Para Date (ou timestamp), usamos componentes locais para manter o dia visivel igual ao escolhido.
    const d = value instanceof Date ? value : new Date(value);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '--';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  }

  function setPeriodoDefaults(refDate = new Date()) {
    const start = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    const end = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
    currentMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    const ini = el('filtro-inicio');
    const fim = el('filtro-fim');
    if (ini) ini.value = formatInputDate(start);
    if (fim) fim.value = formatInputDate(end);
    atualizaMesLabel();
  }

  function toYmd(value) {
    if (!value) return '';
    // Quando vier com horário (ISO completo), usamos a data local (getFullYear/getMonth/getDate)
    // para evitar avanços/retrocessos de dia por causa de fuso.
    if (typeof value === 'string') {
      if (value.includes('T')) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }
      }
      const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    const d = value instanceof Date ? value : new Date(value);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function toDateParamMidday(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    // Coloca meio-dia para evitar mudança de dia por fuso quando o backend normaliza para 00:00
    return `${y}-${m}-${d}T12:00:00`;
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
      if (card) card.classList.remove('hidden');
      tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-4 text-center text-gray-500">Nenhum fechamento encontrado.</td></tr>';
      if (info) info.textContent = '0 registros';
      return;
    }
    if (card) card.classList.remove('hidden');

    list.forEach((item) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      const isSynthetic = !item.id || String(item.id).startsWith('dyn-');
      const previsto = Number(item.previsto || item.totalPeriodo || 0);
      const actionButtons = isSynthetic
        ? `
          <button
            class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 fechar-repasse"
            data-profissional="${item.profissional || ''}"
            data-inicio="${toYmd(item.periodoInicio) || ''}"
            data-fim="${toYmd(item.periodoFim) || ''}"
          >
            <i class="fas fa-lock"></i>
            Fechar
          </button>
        `
        : `
          <div class="flex flex-wrap gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 btn-pagar"
              data-id="${item.id}"
              data-total="${previsto}"
            >
              <i class="fas fa-money-check-alt"></i>
              Pagar
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 btn-reabrir"
              data-id="${item.id}"
            >
              <i class="fas fa-rotate-left"></i>
              Reabrir
            </button>
          </div>
        `;
      tr.innerHTML = `
        <td class="px-4 py-3">
          <p class="font-semibold text-gray-900">${item.profissionalNome || item.profissional || '--'}</p>
          <p class="text-xs text-gray-500">${item.storeNome || '--'}</p>
        </td>
        <td class="px-4 py-3">${item.tipo || 'Vendas/Servicos'}</td>
        <td class="px-4 py-3 text-gray-700">${item.periodo || formatPeriodo(item)}</td>
        <td class="px-4 py-3 font-semibold text-gray-900">${formatMoney(item.previsto || item.totalPeriodo || 0)}</td>
        <td class="px-4 py-3 font-semibold text-gray-900">${formatMoney(item.pago || item.totalPago || 0)}</td>
        <td class="px-4 py-3">${statusBadge(item.status)}</td>
        <td class="px-4 py-3 text-gray-700">
          <p>${item.proximo || item.meioPagamento || '--'}</p>
          <p class="text-xs text-gray-500">Prev: ${item.previsaoPagamento ? new Date(item.previsaoPagamento).toLocaleDateString('pt-BR') : '--'}</p>
        </td>
        <td class="px-4 py-3">
          ${actionButtons}
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (info) info.textContent = `Mostrando ${list.length} registro(s)`;

    tbody.querySelectorAll('.fechar-repasse').forEach((btn) => {
      btn.addEventListener('click', () => {
        const profissionalId = btn.getAttribute('data-profissional') || '';
        const inicio = btn.getAttribute('data-inicio') || '';
        const fim = btn.getAttribute('data-fim') || '';
        preencherModalFechamento(profissionalId, inicio, fim);
        openModal();
      });
    });

    tbody.querySelectorAll('.btn-pagar').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || '';
        const total = Number(btn.getAttribute('data-total') || '0');
        if (!id) return;
        marcarFechamentoPago(id, total);
      });
    });

    tbody.querySelectorAll('.btn-reabrir').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || '';
        if (!id) return;
        reabrirFechamento(id);
      });
    });
  }

function preencherModalFechamento(profissionalId, inicio, fim) {
    const funcionarioSelect = el('fechamento-funcionario');
    if (funcionarioSelect && profissionalId) {
      funcionarioSelect.value = profissionalId;
    }
    const inicioInput = el('fechamento-inicio');
    const fimInput = el('fechamento-fim');
    const toInputValue = (val) => {
      if (!val) return '';
      if (typeof val === 'string') {
        const m = val.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      }
      const d = val instanceof Date ? val : new Date(val);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    };
    if (inicioInput && inicio) inicioInput.value = toInputValue(inicio);
    if (fimInput && fim) fimInput.value = toInputValue(fim);
    atualizaModalKpis();
  }

function renderCardsPendentes(list) {
  const wrap = el('cards-pendentes');
  if (!wrap) return;
  wrap.innerHTML = '';

  const parseVal = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const pickValor = (item, keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        const val = parseVal(item[key]);
        if (val) return val;
      }
    }
    return 0;
  };

  const source = pendentesAllList.length ? pendentesAllList : Array.isArray(list) ? list : [];

  const pendentes = new Map();
  source.forEach((item) => {
    let servicos = pickValor(item, [
      'pendenteServicos',
      'aReceberServicos',
      'totalServicos',
      'comissaoServicos',
      'comissaoServico',
      'valorServicos',
    ]);
    let vendas = pickValor(item, [
      'pendenteVendas',
      'aReceberVendas',
      'totalVendas',
      'comissaoVendas',
      'comissaoVenda',
      'totalProdutos',
      'pendenteProdutos',
      'valorProdutos',
    ]);

    const totalPend = parseVal(item.pendente ?? item.totalPendente ?? 0);
    const totalPeriodo = parseVal(item.totalPeriodo ?? 0);
    const totalPago = parseVal(item.totalPago ?? 0);
    const fallbackPend = Math.max(totalPeriodo - totalPago, 0);
    const pendTotal = totalPend || fallbackPend || vendas + servicos;

    if (!vendas && pendTotal && servicos && pendTotal > servicos) {
      vendas = pendTotal - servicos;
    }
    if (!servicos && vendas && pendTotal > vendas) {
      const residual = pendTotal - vendas;
      servicos = residual > 0 ? residual : 0;
    }
    if (!vendas && !servicos && pendTotal) {
      vendas = pendTotal;
    }

    const total = parseVal((vendas || 0) + (servicos || 0));
    if (total <= 0 && vendas <= 0 && servicos <= 0) return;

    const key = item.profissionalNome || item.profissional || 'Sem nome';
    const atual = pendentes.get(key) || { vendas: 0, servicos: 0 };
    pendentes.set(key, {
      vendas: atual.vendas + (vendas || 0),
      servicos: atual.servicos + (servicos || 0),
    });
  });

  if (!pendentes.size) {
    wrap.innerHTML = '<div class="col-span-full text-center text-gray-500 text-sm">Nenhuma comissao pendente.</div>';
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
          <p class="text-xs uppercase tracking-wide text-amber-700 font-semibold">Comissao Vendas</p>
          <p class="text-base font-bold text-amber-900">${formatMoney(valores.vendas)}</p>
        </div>
        <div class="rounded-lg bg-blue-50 px-3 py-2">
          <p class="text-xs uppercase tracking-wide text-blue-700 font-semibold">Comissao Servicos</p>
          <p class="text-base font-bold text-blue-900">${formatMoney(valores.servicos)}</p>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });
}

function getPeriodoRange() {
    const parseDate = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map((v) => Number(v));
        const dt = new Date(y, m - 1, d, 0, 0, 0, 0); // interpreta como data local sem deslocar fuso
        return Number.isNaN(dt.getTime()) ? null : dt;
      }
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const inicio = parseDate(el('filtro-inicio')?.value);
    const fim = parseDate(el('filtro-fim')?.value);
    const now = new Date();
    const start = inicio || new Date(now.getFullYear(), now.getMonth(), 1);
    const end = fim || new Date(now.getFullYear(), now.getMonth() + 1, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  function formatPeriodo(item) {
    if (item.periodoInicio) {
      const iniStr = formatDateNoTZ(item.periodoInicio);
      const fimStr = item.periodoFim ? formatDateNoTZ(item.periodoFim) : iniStr;
      return `${iniStr} a ${fimStr}`;
    }
    return item.periodo || '--';
  }

  function filtraPorMes(list) {
    const { start, end } = getPeriodoRange();
    return list.filter((item) => {
      const ini = item.periodoInicio ? new Date(item.periodoInicio) : null;
      const fim = item.periodoFim ? new Date(item.periodoFim) : ini;
      if (!ini && !fim) return true;
      const iniTime = ini ? ini.getTime() : 0;
      const fimTime = fim ? fim.getTime() : iniTime;
      return !(fimTime < start.getTime() || iniTime > end.getTime());
    });
  }

  function aplicaFiltros() {
    const status = el('filtro-status')?.value || '';
    const busca = (el('filtro-busca')?.value || '').trim().toLowerCase();
    const store = el('empresa-select')?.value || '';

    let base = closingsData.length ? closingsData : [];
    let filtrados = base.slice();
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
      setPeriodoDefaults(new Date());
      fetchFechamentos();
      fetchPendentes();
      aplicaFiltros();
    });
    el('filtro-inicio')?.addEventListener('change', () => {
      const { start } = getPeriodoRange();
      currentMonth = start || new Date();
      atualizaMesLabel();
      fetchFechamentos();
      fetchPendentes();
      fetchPendentes({ all: true });
    });
    el('filtro-fim')?.addEventListener('change', () => {
      fetchFechamentos();
      fetchPendentes();
      fetchPendentes({ all: true });
    });
    el('mes-anterior')?.addEventListener('click', () => {
      const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      setPeriodoDefaults(newDate);
      fetchFechamentos();
      fetchPendentes();
      fetchPendentes({ all: true });
    });
    el('mes-proximo')?.addEventListener('click', () => {
      const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      setPeriodoDefaults(newDate);
      fetchFechamentos();
      fetchPendentes();
      fetchPendentes({ all: true });
    });
    el('btn-novo-fechamento')?.addEventListener('click', openModal);
    el('btn-configuracoes')?.addEventListener('click', openConfigModal);
    document.querySelectorAll('[data-fechamento-close]')?.forEach((btn) =>
      btn.addEventListener('click', closeModal)
    );
    document.querySelectorAll('[data-config-close]')?.forEach((btn) =>
      btn.addEventListener('click', closeConfigModal)
    );
    el('fechamento-salvar')?.addEventListener('click', salvarFechamento);
    el('config-salvar')?.addEventListener('click', salvarConfig);
    el('empresa-select')?.addEventListener('change', () => {
      fetchFechamentos();
      fetchPendentes();
      fetchPendentes({ all: true });
      const store = el('empresa-select')?.value || '';
      if (store) loadConfigForStore(store);
    });
  }

  function atualizaMesLabel() {
    const label = el('mes-label');
    if (label) label.textContent = formatMonthLabel(currentMonth);
  }

  async function loadConfigForStore(storeId) {
    if (!storeId) return;
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/config/data?store=${storeId}`, {
        headers: authHeaders(),
      });
      const data = await resp.json();
      configAccounts = Array.isArray(data?.accounts) ? data.accounts : [];
      configSelected = data?.config?.accountingAccount || '';
      configBankAccounts = Array.isArray(data?.bankAccounts) ? data.bankAccounts : [];
      configBankSelected = data?.config?.bankAccount || '';

      const select = el('config-accounting');
      if (select) {
        select.innerHTML =
          '<option value="">Selecione</option>' +
          configAccounts.map((acc) => `<option value="${acc._id}">${acc.code || ''} - ${acc.name || ''}</option>`).join('');
        select.value = configSelected || '';
      }
      const selectBank = el('config-bankaccount');
      if (selectBank) {
        selectBank.innerHTML =
          '<option value="">Selecione</option>' +
          configBankAccounts
            .map(
              (b) =>
                `<option value="${b._id}">${b.alias || b.bankName || 'Conta'} (${b.bankCode || ''} Ag.${b.agency || ''} Cc.${b.accountNumber || ''}${b.accountDigit ? '-' + b.accountDigit : ''})</option>`,
            )
            .join('');
        selectBank.value = configBankSelected || '';
      }
      const empresaNome = el('config-empresa-nome');
      if (empresaNome) {
        const storeOption = el('empresa-select')?.selectedOptions?.[0];
        empresaNome.textContent = storeOption ? storeOption.textContent : 'Empresa selecionada';
      }
    } catch (e) {
      console.error('loadConfigForStore', e);
    }
  }

  function openConfigModal() {
    const store = el('empresa-select')?.value || '';
    loadConfigForStore(store);
    const modal = el('modal-configuracoes');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  function closeConfigModal() {
    const modal = el('modal-configuracoes');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  async function salvarConfig() {
    const store = el('empresa-select')?.value || '';
    const accounting = el('config-accounting')?.value || '';
    const bankAcc = el('config-bankaccount')?.value || '';
    if (!store) {
      alert('Selecione uma empresa para configurar.');
      return;
    }
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/config`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeId: store,
          accountingAccount: accounting || null,
          bankAccount: bankAcc || null,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || 'Erro ao salvar configuração');
      }
      const data = await resp.json();
      configSelected = data?.accountingAccount || '';
      const select = el('config-accounting');
      if (select) select.value = configSelected;
      closeConfigModal();
    } catch (e) {
      console.error('salvarConfig', e);
      alert(e.message || 'Erro ao salvar configuração');
    }
  }

  function openModal() {
    const modal = el('modal-fechamento');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    // Preenche previsão de pagamento com data/hora atual ao abrir
    const now = new Date();
    const prevData = el('fechamento-prev');
    const prevHora = el('fechamento-prev-hora');
    if (prevData) prevData.value = formatInputDate(now);
    if (prevHora) prevHora.value = formatInputTime(now);

    atualizaModalKpis();
  }

  function closeModal() {
    const modal = el('modal-fechamento');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  function atualizaModalKpis() {
    const funcionarioId = el('fechamento-funcionario')?.value || '';

    const parseDateInput = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map((v) => Number(v));
        const dt = new Date(y, m - 1, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
      }
      const dt = new Date(value);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const inicio = parseDateInput(el('fechamento-inicio')?.value);
    const fim = parseDateInput(el('fechamento-fim')?.value);

    // KPI Total (não pagos): soma do pendente do profissional selecionado
    const pendenteBase =
      (pendentesAllList.length ? pendentesAllList : pendentesList).filter(
        (p) => !funcionarioId || String(p.profissional) === String(funcionarioId),
      );

    const pendenteFuncionario = pendenteBase.reduce((sum, p) => {
      const base =
        p.totalPendente ??
        (p.pendenteServicos || 0) + (p.pendenteVendas || 0) ??
        Math.max((p.totalPeriodo || 0) - (p.totalPago || 0), 0);
      return sum + (Number(base) || 0);
    }, 0);

    // KPI Total período: soma dos fechamentos do período para o profissional selecionado
    const totalPeriodo = closingsData
      .filter((item) => {
        if (funcionarioId && String(item.profissional) !== String(funcionarioId)) return false;
        if (!inicio || !fim) return true;
        const iniItem = item.periodoInicio ? new Date(item.periodoInicio) : null;
        const fimItem = item.periodoFim ? new Date(item.periodoFim) : iniItem;
        if (!iniItem || !fimItem || Number.isNaN(iniItem) || Number.isNaN(fimItem)) return true;
        return !(fimItem < inicio || iniItem > fim);
      })
      .reduce((sum, item) => sum + (item.previsto || item.totalPeriodo || 0), 0);

    const set = (id, value) => {
      const node = el(id);
      if (node) node.textContent = value;
    };
    set('fechamento-kpi-pendente', formatMoney(pendenteFuncionario));
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
        if (!stores.length) {
          select.innerHTML = '<option value="">Nenhuma empresa disponível</option>';
          select.value = '';
        } else {
          select.innerHTML = stores.map((s) => `<option value="${s._id}">${s.nome}</option>`).join('');
          select.value = stores[0]?._id || '';
        }
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
      const { start, end } = getPeriodoRange();
      const params = new URLSearchParams();
      if (store) params.set('store', store);
      if (start) params.set('start', toDateParamMidday(start));
      if (end) params.set('end', toDateParamMidday(end));
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

  async function fetchPendentes({ all = false } = {}) {
    try {
      const store = el('empresa-select')?.value || '';
      const { start, end } = getPeriodoRange();
      const params = new URLSearchParams();
      if (store) params.set('store', store);
      if (!all) {
        params.set('start', toDateParamMidday(start));
        params.set('end', toDateParamMidday(end));
      } else {
        // busca histórica ampla
        params.set('start', '2000-01-01T12:00:00');
        params.set('end', toDateParamMidday(new Date()));
      }
      const resp = await fetch(
        `${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/pendentes?${params.toString()}`,
        { headers: authHeaders() },
      );
      const data = await resp.json();
      const parsed = Array.isArray(data) ? data : [];
      if (all) {
        pendentesAllList = parsed;
      } else {
        pendentesList = parsed;
        renderCardsPendentes(pendentesList);
      }
    } catch (e) {
      console.error('fetchPendentes', e);
      if (all) {
        pendentesAllList = [];
      } else {
        pendentesList = [];
        renderCardsPendentes([]);
      }
    }
  }

  async function marcarFechamentoPago(id, totalPrevisto = 0) {
    try {
      const payload = {
        status: 'pago',
        totalPago: Number.isFinite(totalPrevisto) ? totalPrevisto : 0,
      };
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${id}`, {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || 'Erro ao marcar pagamento');
      }
      await fetchFechamentos();
      await fetchPendentes();
      await fetchPendentes({ all: true });
    } catch (e) {
      console.error('marcarFechamentoPago', e);
      alert(e.message || 'Erro ao marcar pagamento');
    }
  }

  async function reabrirFechamento(id) {
    if (!id) return;
    const confirmar = window.confirm('Reabrir vai excluir o fechamento e a conta a pagar gerada. Continuar?');
    if (!confirmar) return;
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/admin/comissoes/fechamentos/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || 'Erro ao reabrir fechamento');
      }
      await fetchFechamentos();
      await fetchPendentes();
      await fetchPendentes({ all: true });
    } catch (e) {
      console.error('reabrirFechamento', e);
      alert(e.message || 'Erro ao reabrir fechamento');
    }
  }

  async function salvarFechamento() {
    const funcionario = el('fechamento-funcionario')?.value || '';
    const inicio = el('fechamento-inicio')?.value || '';
    const fim = el('fechamento-fim')?.value || '';
    const previsao = el('fechamento-prev')?.value || '';
    const previsaoHora = el('fechamento-prev-hora')?.value || '';
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
          previsaoPagamento: previsao ? `${previsao}${previsaoHora ? `T${previsaoHora}` : ''}` : null,
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
    setPeriodoDefaults(new Date());
    atualizaMesLabel();
    bindActions();
    fetchStores().then(() => {
      fetchFechamentos();
      fetchPendentes();
      fetchPendentes({ all: true });
      const store = el('empresa-select')?.value || '';
      if (store) loadConfigForStore(store);
    });
    fetchFuncionarios();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
