(function () {
  'use strict';

  const storeSelect = document.getElementById('fiscal-regras-store');
  const statusSelect = document.getElementById('fiscal-regras-status');
  const searchInput = document.getElementById('fiscal-regras-search');
  const refreshButton = document.getElementById('fiscal-regras-refresh');
  const modalidadeButtons = document.querySelectorAll('.fiscal-regras-modalidade-btn');
  const counterLabel = document.getElementById('fiscal-regras-counter');
  const alertBox = document.getElementById('fiscal-regras-alert');
  const listContainer = document.getElementById('fiscal-regras-list');
  const emptyState = document.getElementById('fiscal-regras-empty');
  const pageSizeSelect = document.getElementById('fiscal-regras-page-size');
  const paginationContainer = document.getElementById('fiscal-regras-pagination');
  const applyAllButton = document.getElementById('fiscal-regras-apply-all');
  const icmsSection = document.getElementById('fiscal-regras-icms');
  const icmsBody = document.getElementById('fiscal-regras-icms-body');

  let stores = [];
  let currentModalidade = 'nfe';
  let searchTimer = null;
  let currentStoreId = '';
  let currentReports = [];
  let currentPage = 1;
  let pageSize = 20;
  let totalItems = 0;
  let totalPages = 1;
  let isLoading = false;

  const origemOptions = [
    { value: '0', label: '0 - Nacional' },
    { value: '1', label: '1 - Estrangeira - Importação direta' },
    { value: '2', label: '2 - Estrangeira - Adquirida no mercado interno' },
    { value: '3', label: '3 - Nacional com +40% de importado' },
    { value: '4', label: '4 - Nacional conforme processo básico' },
    { value: '5', label: '5 - Nacional com até 40% importado' },
    { value: '6', label: '6 - Estrangeira sem similar - importação' },
    { value: '7', label: '7 - Estrangeira sem similar - mercado interno' },
    { value: '8', label: '8 - Nacional com conteúdo importado > 70%' },
  ];

  const tipoCalculoOptions = [
    { value: 'percentual', label: 'Percentual' },
    { value: 'valor', label: 'Valor' },
    { value: 'isento', label: 'Isento' },
  ];

  const statusOptions = [
    { value: 'pendente', label: 'Pendente' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'aprovado', label: 'Aprovado' },
  ];

  const fcpIndicadores = [
    { value: '0', label: '0 - Não aplicável' },
    { value: '1', label: '1 - FCP interno' },
    { value: '2', label: '2 - FCP interestadual' },
  ];

  const getToken = () => {
    try {
      const logged = JSON.parse(localStorage.getItem('loggedInUser'));
      return logged?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token do usuário logado.', error);
      return '';
    }
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return '—';
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return '—';
    return `${numberValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const setModalidadeButtonState = () => {
    modalidadeButtons.forEach((button) => {
      const isActive = button.dataset.modalidade === currentModalidade;
      button.classList.toggle('bg-primary', isActive);
      button.classList.toggle('text-white', isActive);
      button.classList.toggle('shadow', isActive);
      button.classList.toggle('bg-gray-100', !isActive);
      button.classList.toggle('text-gray-600', !isActive);
    });
  };

  const populateStores = () => {
    if (!storeSelect) return;
    const selected = storeSelect.value;
    storeSelect.innerHTML = '<option value="">Selecione uma empresa</option>';
    if (!Array.isArray(stores) || stores.length === 0) {
      storeSelect.disabled = true;
      currentStoreId = '';
      return;
    }
    stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store._id;
      option.textContent = store.nome || store.nomeFantasia || store.razaoSocial || 'Empresa sem nome';
      storeSelect.appendChild(option);
    });
    storeSelect.disabled = false;
    if (selected) {
      storeSelect.value = selected;
    }
    currentStoreId = storeSelect.value || '';
  };

  const renderIcmsEntries = (entries = []) => {
    if (!icmsBody || !icmsSection) return;
    if (!Array.isArray(entries) || !entries.length) {
      icmsBody.innerHTML = '<tr><td colspan="2" class="px-4 py-3 text-center text-sm text-gray-500">Nenhum percentual cadastrado.</td></tr>';
      icmsSection.classList.add('hidden');
      return;
    }
    icmsSection.classList.remove('hidden');
    icmsBody.innerHTML = entries.map((entry) => {
      const codigo = entry.codigo ?? '—';
      const valor = formatPercent(entry.valor);
      return `<tr><td class="px-4 py-2 text-gray-700">${codigo}</td><td class="px-4 py-2 text-right text-gray-700">${valor}</td></tr>`;
    }).join('');
  };

  const countPendencias = (pendencias = {}) => {
    if (!pendencias || typeof pendencias !== 'object') return 0;
    const grupos = ['comum', 'nfe', 'nfce'];
    return grupos.reduce((total, grupo) => {
      const lista = pendencias[grupo];
      if (Array.isArray(lista)) {
        return total + lista.length;
      }
      return total;
    }, 0);
  };

  const buildSummaryChip = (text) => `
    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600">${text}</span>
  `;

  const updateCounterLabel = () => {
    if (!counterLabel) return;
    if (!currentStoreId) {
      counterLabel.textContent = 'Selecione uma empresa para carregar os produtos.';
      return;
    }
    if (isLoading) {
      counterLabel.textContent = 'Carregando sugestões fiscais...';
      return;
    }
    if (!totalItems) {
      counterLabel.textContent = 'Nenhum produto encontrado.';
      return;
    }
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(totalItems, currentPage * pageSize);
    counterLabel.textContent = `Exibindo ${start}–${end} de ${totalItems} produto${totalItems > 1 ? 's' : ''}`;
  };

  const updateApplyAllButtonState = () => {
    if (!applyAllButton) return;
    const disabled = !currentStoreId || !totalItems || isLoading;
    applyAllButton.disabled = disabled;
  };

  const renderPagination = () => {
    if (!paginationContainer) return;
    if (!currentStoreId || !totalItems) {
      paginationContainer.innerHTML = '';
      paginationContainer.classList.add('hidden');
      return;
    }

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(totalItems, currentPage * pageSize);
    const prevDisabled = currentPage <= 1 || isLoading;
    const nextDisabled = currentPage >= totalPages || isLoading;

    paginationContainer.innerHTML = `
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="text-sm text-gray-600">
          Exibindo ${start}–${end} de ${totalItems} produto${totalItems > 1 ? 's' : ''}
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="fiscal-page-btn inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60" data-page="${currentPage - 1}" ${prevDisabled ? 'disabled' : ''}>
            <i class="fas fa-chevron-left text-xs"></i>
            Anterior
          </button>
          <span class="text-sm text-gray-500">Página ${currentPage} de ${totalPages}</span>
          <button type="button" class="fiscal-page-btn inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60" data-page="${currentPage + 1}" ${nextDisabled ? 'disabled' : ''}>
            Próxima
            <i class="fas fa-chevron-right text-xs"></i>
          </button>
        </div>
      </div>
    `;
    paginationContainer.classList.remove('hidden');

    paginationContainer.querySelectorAll('.fiscal-page-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (isLoading) return;
        const targetPage = Number.parseInt(event.currentTarget.dataset.page, 10);
        if (!Number.isFinite(targetPage)) return;
        if (targetPage < 1 || targetPage > totalPages || targetPage === currentPage) return;
        currentPage = targetPage;
        loadSuggestions();
      });
    });
  };

  const setLoadingState = (loading) => {
    isLoading = loading;
    if (loading && listContainer && emptyState) {
      emptyState.classList.add('hidden');
      listContainer.innerHTML = '<div class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">Carregando sugestões fiscais...</div>';
    }
    updateCounterLabel();
    updateApplyAllButtonState();
    renderPagination();
  };

  const buildList = (items = []) => {
    if (!alertBox || !listContainer || !emptyState) return;

    currentReports = items;
    listContainer.innerHTML = '';

    if (!Array.isArray(items) || !items.length) {
      emptyState.classList.remove('hidden');
      alertBox.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    const modalKey = currentModalidade === 'nfce' ? 'nfce' : 'nfe';
    const pendentes = items.filter((item) => (item?.fiscalAtual?.status?.[modalKey] || 'pendente') !== 'aprovado').length;

    if (pendentes > 0) {
      alertBox.textContent = `${pendentes} produto${pendentes > 1 ? 's' : ''} ainda possui${pendentes > 1 ? 'm' : ''} pendências fiscais para ${currentModalidade.toUpperCase()}.`;
      alertBox.classList.remove('hidden');
    } else {
      alertBox.classList.add('hidden');
    }

    items.forEach((report) => {
      const card = createProductCard(report);
      listContainer.appendChild(card);
    });
  };

  const escapeValue = (value) => {
    if (value === null || value === undefined) return '';
    return String(value);
  };

  const buildOptions = (options, selectedValue) => options.map((option) => {
    const selected = option.value === selectedValue ? 'selected' : '';
    return `<option value="${option.value}" ${selected}>${option.label}</option>`;
  }).join('');

  const buildStatusBadge = (status) => {
    const normalized = (status || '').toLowerCase();
    const colorMap = {
      aprovado: 'bg-emerald-100 text-emerald-800',
      parcial: 'bg-amber-100 text-amber-800',
      pendente: 'bg-rose-100 text-rose-800',
    };
    const labelMap = {
      aprovado: 'Aprovado',
      parcial: 'Parcial',
      pendente: 'Pendente',
    };
    const color = colorMap[normalized] || colorMap.pendente;
    const label = labelMap[normalized] || labelMap.pendente;
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${color}">${label}</span>`;
  };

  const buildPendenciasList = (pendencias = {}) => {
    const itens = [];
    const appendPendencias = (lista = [], prefixo = '') => {
      lista.forEach((item) => {
        itens.push(`${prefixo}${item}`);
      });
    };
    appendPendencias(pendencias.comum, '');
    appendPendencias(pendencias.nfe, 'NF-e: ');
    appendPendencias(pendencias.nfce, 'NFC-e: ');
    if (!itens.length) return '<p class="text-sm text-emerald-600">Nenhuma pendência identificada.</p>';
    return `<ul class="list-disc pl-5 space-y-1 text-sm text-amber-700">${itens.map((item) => `<li>${item}</li>`).join('')}</ul>`;
  };

  const buildDifferencesList = (differences = []) => {
    if (!Array.isArray(differences) || !differences.length) {
      return '<p class="text-sm text-emerald-600">Sem diferenças entre o cadastro atual e a sugestão.</p>';
    }
    return `<ul class="list-disc pl-5 space-y-1 text-sm text-gray-700">${differences.map((diff) => {
      const atual = diff.atual === undefined || diff.atual === null || diff.atual === '' ? '—' : diff.atual;
      const sugerido = diff.sugerido === undefined || diff.sugerido === null || diff.sugerido === '' ? '—' : diff.sugerido;
      return `<li><span class="font-medium">${diff.label}:</span> atual ${atual} → sugerido ${sugerido}</li>`;
    }).join('')}</ul>`;
  };

  const fillCardInputs = (card, fiscal = {}) => {
    const setValue = (selector, value) => {
      const input = card.querySelector(`[data-field="${selector}"]`);
      if (!input) return;
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = value === undefined || value === null ? '' : value;
      }
    };

    setValue('origem', fiscal.origem || '0');
    setValue('csosn', fiscal.csosn || '');
    setValue('cst', fiscal.cst || '');
    setValue('cest', fiscal.cest || '');
    setValue('status.nfe', fiscal?.status?.nfe || 'pendente');
    setValue('status.nfce', fiscal?.status?.nfce || 'pendente');

    setValue('cfop.nfe.dentro', fiscal?.cfop?.nfe?.dentroEstado || '');
    setValue('cfop.nfe.fora', fiscal?.cfop?.nfe?.foraEstado || '');
    setValue('cfop.nfe.transferencia', fiscal?.cfop?.nfe?.transferencia || '');
    setValue('cfop.nfe.devolucao', fiscal?.cfop?.nfe?.devolucao || '');
    setValue('cfop.nfe.industrializacao', fiscal?.cfop?.nfe?.industrializacao || '');

    setValue('cfop.nfce.dentro', fiscal?.cfop?.nfce?.dentroEstado || '');
    setValue('cfop.nfce.fora', fiscal?.cfop?.nfce?.foraEstado || '');
    setValue('cfop.nfce.transferencia', fiscal?.cfop?.nfce?.transferencia || '');
    setValue('cfop.nfce.devolucao', fiscal?.cfop?.nfce?.devolucao || '');
    setValue('cfop.nfce.industrializacao', fiscal?.cfop?.nfce?.industrializacao || '');

    setValue('pis.codigo', fiscal?.pis?.codigo || '');
    setValue('pis.cst', fiscal?.pis?.cst || '');
    setValue('pis.aliquota', fiscal?.pis?.aliquota ?? '');
    setValue('pis.tipo', fiscal?.pis?.tipoCalculo || 'percentual');

    setValue('cofins.codigo', fiscal?.cofins?.codigo || '');
    setValue('cofins.cst', fiscal?.cofins?.cst || '');
    setValue('cofins.aliquota', fiscal?.cofins?.aliquota ?? '');
    setValue('cofins.tipo', fiscal?.cofins?.tipoCalculo || 'percentual');

    setValue('ipi.cst', fiscal?.ipi?.cst || '');
    setValue('ipi.enquadramento', fiscal?.ipi?.codigoEnquadramento || '');
    setValue('ipi.aliquota', fiscal?.ipi?.aliquota ?? '');
    setValue('ipi.tipo', fiscal?.ipi?.tipoCalculo || 'percentual');

    setValue('fcp.indicador', fiscal?.fcp?.indicador || '0');
    setValue('fcp.aliquota', fiscal?.fcp?.aliquota ?? '');
    setValue('fcp.aplica', fiscal?.fcp?.aplica || false);
  };

  const collectFiscalFromCard = (card) => {
    const getValue = (selector) => {
      const input = card.querySelector(`[data-field="${selector}"]`);
      if (!input) return '';
      if (input.type === 'checkbox') return input.checked;
      return input.value?.trim() || '';
    };
    const getNumber = (selector) => {
      const raw = card.querySelector(`[data-field="${selector}"]`);
      if (!raw) return null;
      const value = raw.value;
      if (value === '' || value === undefined || value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      origem: getValue('origem') || '0',
      csosn: getValue('csosn'),
      cst: getValue('cst'),
      cest: getValue('cest'),
      status: {
        nfe: getValue('status.nfe') || 'pendente',
        nfce: getValue('status.nfce') || 'pendente',
      },
      cfop: {
        nfe: {
          dentroEstado: getValue('cfop.nfe.dentro'),
          foraEstado: getValue('cfop.nfe.fora'),
          transferencia: getValue('cfop.nfe.transferencia'),
          devolucao: getValue('cfop.nfe.devolucao'),
          industrializacao: getValue('cfop.nfe.industrializacao'),
        },
        nfce: {
          dentroEstado: getValue('cfop.nfce.dentro'),
          foraEstado: getValue('cfop.nfce.fora'),
          transferencia: getValue('cfop.nfce.transferencia'),
          devolucao: getValue('cfop.nfce.devolucao'),
          industrializacao: getValue('cfop.nfce.industrializacao'),
        },
      },
      pis: {
        codigo: getValue('pis.codigo'),
        cst: getValue('pis.cst'),
        aliquota: getNumber('pis.aliquota'),
        tipoCalculo: getValue('pis.tipo') || 'percentual',
      },
      cofins: {
        codigo: getValue('cofins.codigo'),
        cst: getValue('cofins.cst'),
        aliquota: getNumber('cofins.aliquota'),
        tipoCalculo: getValue('cofins.tipo') || 'percentual',
      },
      ipi: {
        cst: getValue('ipi.cst'),
        codigoEnquadramento: getValue('ipi.enquadramento'),
        aliquota: getNumber('ipi.aliquota'),
        tipoCalculo: getValue('ipi.tipo') || 'percentual',
      },
      fcp: {
        indicador: getValue('fcp.indicador') || '0',
        aliquota: getNumber('fcp.aliquota'),
        aplica: Boolean(card.querySelector('[data-field="fcp.aplica"]')?.checked),
      },
    };
  };

  const createProductCard = (report) => {
    const card = document.createElement('article');
    card.className = 'overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition';
    card.dataset.productId = report.productId;

    const fiscalAtual = report.fiscalAtual || {};
    const sugestao = report.sugestao || {};
    const statusAtualNfe = fiscalAtual?.status?.nfe || 'pendente';
    const statusAtualNfce = fiscalAtual?.status?.nfce || 'pendente';

    const pendenciasAtuaisTotal = countPendencias(report.pendenciasAtuais);
    const pendenciasSugestaoTotal = countPendencias(report.pendenciasSugestao);
    const divergenciasTotal = Array.isArray(report.divergencias) ? report.divergencias.length : 0;

    const resumoPendenciasAtuais = pendenciasAtuaisTotal > 0
      ? `${pendenciasAtuaisTotal} pendência${pendenciasAtuaisTotal > 1 ? 's' : ''} atual${pendenciasAtuaisTotal > 1 ? 's' : ''}`
      : 'Sem pendências atuais';
    const resumoPendenciasSugestao = pendenciasSugestaoTotal > 0
      ? `${pendenciasSugestaoTotal} pendência${pendenciasSugestaoTotal > 1 ? 's' : ''} na sugestão`
      : 'Sugestão completa';
    const resumoDivergencias = divergenciasTotal > 0
      ? `${divergenciasTotal} diferença${divergenciasTotal > 1 ? 's' : ''} detectada${divergenciasTotal > 1 ? 's' : ''}`
      : 'Sem diferenças detectadas';

    card.innerHTML = `
      <button type="button" class="fiscal-card-toggle flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-gray-800">${escapeValue(report.nome)}</p>
              <p class="truncate text-xs text-gray-500">Codigo de barras ${escapeValue(report.codbarras || "-")} - NCM ${escapeValue(report.ncm) || "-"}</p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-2 text-xs text-gray-500">
                <span class="text-[10px] uppercase tracking-wide text-gray-500">NF-e</span>
                ${buildStatusBadge(statusAtualNfe)}
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-500">
                <span class="text-[10px] uppercase tracking-wide text-gray-500">NFC-e</span>
                ${buildStatusBadge(statusAtualNfce)}
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[11px] font-medium text-gray-600">
            ${buildSummaryChip(resumoPendenciasAtuais)}
            ${buildSummaryChip(resumoDivergencias)}
            ${buildSummaryChip(resumoPendenciasSugestao)}
          </div>
        </div>
        <span class="chevron shrink-0 text-gray-400 transition-transform duration-200" aria-hidden="true"><i class="fas fa-chevron-down"></i></span>
      </button>
      <div class="fiscal-card-details hidden border-t border-gray-100 bg-gray-50/60">
        <div class="space-y-6 px-4 py-4 text-sm text-gray-700">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">Pendências atuais</h4>
              <div class="mt-3">${buildPendenciasList(report.pendenciasAtuais)}</div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">Diferenças detectadas</h4>
              <div class="mt-3">${buildDifferencesList(report.divergencias)}</div>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">Origem e status</h4>
              <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">Origem da mercadoria<select data-field="origem" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(origemOptions, sugestao.origem || '0')}</select></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">CEST<input type="text" data-field="cest" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="00.000.00"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">CSOSN<input type="text" data-field="csosn" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="102"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">CST<input type="text" data-field="cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="060"></label>
              </div>
              <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">Status NF-e<select data-field="status.nfe" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(statusOptions, sugestao?.status?.nfe || 'pendente')}</select></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Status NFC-e<select data-field="status.nfce" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(statusOptions, sugestao?.status?.nfce || 'pendente')}</select></label>
              </div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">CFOP NF-e</h4>
              <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">Dentro do estado<input type="text" data-field="cfop.nfe.dentro" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5101"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Fora do estado<input type="text" data-field="cfop.nfe.fora" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="6108"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Transferência<input type="text" data-field="cfop.nfe.transferencia" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5152"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Devolução<input type="text" data-field="cfop.nfe.devolucao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5202"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Industrialização<input type="text" data-field="cfop.nfe.industrializacao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5101"></label>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">CFOP NFC-e</h4>
              <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">Dentro do estado<input type="text" data-field="cfop.nfce.dentro" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5102"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Fora do estado<input type="text" data-field="cfop.nfce.fora" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="6108"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Transferência<input type="text" data-field="cfop.nfce.transferencia" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5656"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Devolução<input type="text" data-field="cfop.nfce.devolucao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5202"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Industrialização<input type="text" data-field="cfop.nfce.industrializacao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5101"></label>
              </div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">PIS</h4>
              <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">Código<input type="text" data-field="pis.codigo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">CST<input type="text" data-field="pis.cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Alíquota (%)<input type="number" step="0.01" data-field="pis.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Tipo de cálculo<select data-field="pis.tipo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(tipoCalculoOptions, sugestao?.pis?.tipoCalculo || 'percentual')}</select></label>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">COFINS</h4>
              <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">Código<input type="text" data-field="cofins.codigo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">CST<input type="text" data-field="cofins.cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Alíquota (%)<input type="number" step="0.01" data-field="cofins.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Tipo de cálculo<select data-field="cofins.tipo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(tipoCalculoOptions, sugestao?.cofins?.tipoCalculo || 'percentual')}</select></label>
              </div>
            </div>
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <h4 class="text-sm font-semibold text-gray-700">IPI</h4>
              <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="block text-xs font-semibold uppercase text-gray-500">CST<input type="text" data-field="ipi.cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Enquadramento<input type="text" data-field="ipi.enquadramento" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Alíquota (%)<input type="number" step="0.01" data-field="ipi.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
                <label class="block text-xs font-semibold uppercase text-gray-500">Tipo de cálculo<select data-field="ipi.tipo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(tipoCalculoOptions, sugestao?.ipi?.tipoCalculo || 'percentual')}</select></label>
              </div>
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 bg-white p-4">
            <h4 class="text-sm font-semibold text-gray-700">FCP</h4>
            <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="block text-xs font-semibold uppercase text-gray-500">Indicador<select data-field="fcp.indicador" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(fcpIndicadores, sugestao?.fcp?.indicador || '0')}</select></label>
              <label class="block text-xs font-semibold uppercase text-gray-500">Alíquota (%)<input type="number" step="0.01" data-field="fcp.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="flex items-center gap-2 text-xs font-semibold uppercase text-gray-500 sm:col-span-2">
                <input type="checkbox" data-field="fcp.aplica" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
                Aplicar FCP
              </label>
            </div>
          </div>
          <footer class="flex flex-col gap-3 border-t border-gray-200 pt-4 text-sm md:flex-row md:items-center md:justify-end">
            <button type="button" data-action="reset" class="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-600 transition hover:bg-gray-50">
              <i class="fas fa-undo"></i>
              Recarregar sugestão
            </button>
            <button type="button" data-action="apply" class="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-semibold text-white shadow transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
              <i class="fas fa-save"></i>
              Salvar regras fiscais
            </button>
          </footer>
        </div>
      </div>
    `;

    fillCardInputs(card, sugestao);

    const toggleButton = card.querySelector('.fiscal-card-toggle');
    const details = card.querySelector('.fiscal-card-details');
    const chevron = toggleButton?.querySelector('.chevron');
    if (toggleButton && details) {
      toggleButton.addEventListener('click', () => {
        const willOpen = details.classList.contains('hidden');
        details.classList.toggle('hidden');
        toggleButton.classList.toggle('bg-gray-50', willOpen);
        if (chevron) {
          chevron.classList.toggle('rotate-180', willOpen);
        }
      });
    }

    const resetButton = card.querySelector('[data-action="reset"]');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        fillCardInputs(card, report.sugestao || {});
      });
    }

    const applyButton = card.querySelector('[data-action="apply"]');
    if (applyButton) {
      applyButton.addEventListener('click', async () => {
        if (!currentStoreId) {
          showModal({
            title: 'Selecione uma empresa',
            message: 'Escolha uma empresa para aplicar as regras fiscais.',
            confirmText: 'Entendi',
          });
          return;
        }

        const fiscalPayload = collectFiscalFromCard(card);
        applyButton.disabled = true;
        applyButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span> Salvando...</span>';

        try {
          const token = getToken();
          const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/rules/apply`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              items: [
                {
                  productId: report.productId,
                  fiscal: fiscalPayload,
                  storeId: currentStoreId,
                },
              ],
            }),
          });

          if (!response.ok) throw new Error('Não foi possível salvar as regras fiscais.');
          const payload = await response.json();
          const updatedReport = Array.isArray(payload?.updated) ? payload.updated.find((item) => item.productId === report.productId) : null;
          if (updatedReport) {
            showModal({
              title: 'Regras atualizadas',
              message: 'As regras fiscais foram salvas com sucesso.',
              confirmText: 'Continuar',
            });
            await loadSuggestions();
          } else {
            showModal({
              title: 'Aviso',
              message: 'A resposta do servidor não retornou o produto atualizado, mas a operação pode ter sido concluída.',
              confirmText: 'Atualizar lista',
              onConfirm: () => loadSuggestions(),
            });
          }
        } catch (error) {
          console.error('Erro ao aplicar regras fiscais:', error);
          showModal({
            title: 'Erro ao salvar',
            message: error.message || 'Não foi possível aplicar as regras fiscais.',
            confirmText: 'Tentar novamente',
          });
        } finally {
          applyButton.disabled = false;
          applyButton.innerHTML = '<i class="fas fa-save"></i><span> Salvar regras fiscais</span>';
        }
      });
    }

    return card;
  };


  const fetchStores = async () => {
    try {
      const token = getToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/stores/allowed`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Nao foi possivel carregar as empresas.');
      const payload = await response.json();
      const list = Array.isArray(payload?.stores) ? payload.stores : (Array.isArray(payload) ? payload : []);
      stores = Array.isArray(list) ? list : [];
      populateStores();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      showModal({
        title: 'Erro',
        message: error.message || 'Nao foi possivel carregar as empresas cadastradas.',
        confirmText: 'Entendi',
      });
    }
  };

  const loadSuggestions = async () => {
    if (!currentStoreId) {
      currentPage = 1;
      totalItems = 0;
      totalPages = 1;
      renderIcmsEntries([]);
      setLoadingState(false);
      buildList([]);
      updateCounterLabel();
      renderPagination();
      updateApplyAllButtonState();
      return;
    }

    setLoadingState(true);
    let items = [];
    let shouldReload = false;

    try {
      const token = getToken();
      const params = new URLSearchParams({
        storeId: currentStoreId,
        modalidade: currentModalidade,
        limit: String(pageSize),
        page: String(currentPage),
      });
      const statusValue = statusSelect?.value;
      const searchValue = searchInput?.value?.trim();
      if (statusValue) params.set('status', statusValue);
      if (searchValue) params.set('search', searchValue);

      const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/rules?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Não foi possível carregar as sugestões fiscais.');
      const payload = await response.json();
      renderIcmsEntries(payload?.icmsSimples);

      items = Array.isArray(payload?.produtos) ? payload.produtos : [];
      totalItems = Number(payload?.total) || 0;

      const responseLimit = Number(payload?.limit);
      if (Number.isFinite(responseLimit) && responseLimit > 0) {
        pageSize = responseLimit;
        if (pageSizeSelect) {
          pageSizeSelect.value = String(pageSize);
        }
      }

      const responsePage = Number(payload?.page);
      if (Number.isFinite(responsePage) && responsePage > 0) {
        currentPage = responsePage;
      }

      totalPages = Number(payload?.pages) || Math.ceil(totalItems / (pageSize || 1)) || 1;
      if (totalPages < 1) totalPages = 1;

      if (totalItems > 0 && currentPage > totalPages) {
        currentPage = totalPages;
        shouldReload = true;
      }
    } catch (error) {
      console.error('Erro ao carregar sugestões fiscais:', error);
      renderIcmsEntries([]);
      showModal({
        title: 'Erro ao carregar',
        message: error.message || 'Não foi possível gerar as sugestões fiscais.',
        confirmText: 'Tentar novamente',
      });
      items = [];
      totalItems = 0;
      totalPages = 1;
    }

    if (shouldReload) {
      setLoadingState(false);
      renderPagination();
      updateCounterLabel();
      updateApplyAllButtonState();
      loadSuggestions();
      return;
    }

    setLoadingState(false);
    buildList(items);
    updateCounterLabel();
    renderPagination();
    updateApplyAllButtonState();
  };

  const executeApplyAll = async () => {
    if (!applyAllButton || !currentStoreId) return;
    const originalLabel = applyAllButton.innerHTML;
    applyAllButton.disabled = true;
    applyAllButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span> Aplicando...</span>';

    try {
      const token = getToken();
      const body = {
        storeId: currentStoreId,
        modalidade: currentModalidade,
      };
      const statusValue = statusSelect?.value;
      const searchValue = searchInput?.value?.trim();
      if (statusValue) body.status = statusValue;
      if (searchValue) body.search = searchValue;

      const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/rules/apply-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error('Não foi possível aplicar as regras sugeridas.');

      const payload = await response.json();
      const rawUpdated = payload?.updatedCount ?? payload?.updated;
      const updatedCount = Array.isArray(rawUpdated) ? rawUpdated.length : Number(rawUpdated ?? 0);
      const failuresCount = Array.isArray(payload?.failures) ? payload.failures.length : Number(payload?.failuresCount ?? 0);

      let message = `Regras sugeridas aplicadas em ${updatedCount} produto${updatedCount === 1 ? '' : 's'}.`;
      if (failuresCount > 0) {
        message += ` ${failuresCount} produto${failuresCount === 1 ? '' : 's'} não pôde ser atualizado.`;
      }

      showModal({
        title: 'Operação concluída',
        message,
        confirmText: 'Continuar',
      });

      await loadSuggestions();
    } catch (error) {
      console.error('Erro ao aplicar regras sugeridas em massa:', error);
      showModal({
        title: 'Erro ao aplicar regras',
        message: error.message || 'Não foi possível aplicar as regras sugeridas para todos os produtos.',
        confirmText: 'Tentar novamente',
      });
    } finally {
      applyAllButton.innerHTML = originalLabel;
      applyAllButton.disabled = false;
      updateApplyAllButtonState();
    }
  };

  const handleApplyAll = () => {
    if (!currentStoreId || !totalItems) {
      showModal({
        title: 'Selecione uma empresa',
        message: 'Carregue os produtos de uma empresa para aplicar as regras em massa.',
        confirmText: 'Entendi',
      });
      return;
    }

    const message = `Aplicar as regras sugeridas para ${totalItems} produto${totalItems === 1 ? '' : 's'} considerando os filtros atuais? Esta ação substituirá as regras fiscais existentes.`;
    showModal({
      title: 'Aplicar regras sugeridas',
      message,
      confirmText: 'Aplicar tudo',
      cancelText: 'Cancelar',
      onConfirm: executeApplyAll,
    });
  };

  const handleStoreChange = () => {
    currentStoreId = storeSelect?.value || '';
    currentPage = 1;
    totalItems = 0;
    totalPages = 1;
    if (pageSizeSelect) {
      const parsed = Number.parseInt(pageSizeSelect.value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        pageSize = parsed;
      } else {
        pageSize = 20;
        pageSizeSelect.value = '20';
      }
    }
    loadSuggestions();
  };

  const handleModalidadeChange = (event) => {
    const { modalidade } = event.currentTarget.dataset;
    if (!modalidade || modalidade === currentModalidade) return;
    currentModalidade = modalidade;
    currentPage = 1;
    setModalidadeButtonState();
    loadSuggestions();
  };

  const initEvents = () => {
    storeSelect?.addEventListener('change', handleStoreChange);
    statusSelect?.addEventListener('change', () => {
      currentPage = 1;
      loadSuggestions();
    });
    refreshButton?.addEventListener('click', loadSuggestions);

    modalidadeButtons.forEach((button) => {
      button.addEventListener('click', handleModalidadeChange);
    });

    pageSizeSelect?.addEventListener('change', () => {
      const parsed = Number.parseInt(pageSizeSelect.value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        pageSize = parsed;
      } else {
        pageSize = 20;
        pageSizeSelect.value = '20';
      }
      currentPage = 1;
      loadSuggestions();
    });

    applyAllButton?.addEventListener('click', handleApplyAll);

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        currentPage = 1;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(loadSuggestions, 400);
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setModalidadeButtonState();
    initEvents();
    fetchStores();
  });
})();




