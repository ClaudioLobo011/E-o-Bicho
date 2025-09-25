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
  const icmsSection = document.getElementById('fiscal-regras-icms');
  const icmsBody = document.getElementById('fiscal-regras-icms-body');

  let stores = [];
  let currentModalidade = 'nfe';
  let searchTimer = null;
  let currentStoreId = '';
  let currentReports = [];

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
    stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store._id;
      option.textContent = store.nome || store.nomeFantasia || store.razaoSocial || 'Empresa sem nome';
      storeSelect.appendChild(option);
    });
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

  const buildList = (items = []) => {
    if (!alertBox || !counterLabel || !listContainer || !emptyState) return;

    currentReports = items;
    listContainer.innerHTML = '';

    if (!Array.isArray(items) || !items.length) {
      emptyState.classList.remove('hidden');
      alertBox.classList.add('hidden');
      counterLabel.textContent = 'Nenhum produto encontrado.';
      return;
    }

    emptyState.classList.add('hidden');
    const total = items.length;
    counterLabel.textContent = `${total} produto${total > 1 ? 's' : ''} encontrado${total > 1 ? 's' : ''}`;

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
    card.className = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm';
    card.dataset.productId = report.productId;

    const fiscalAtual = report.fiscalAtual || {};
    const sugestao = report.sugestao || {};
    const statusAtualNfe = fiscalAtual?.status?.nfe || 'pendente';
    const statusAtualNfce = fiscalAtual?.status?.nfce || 'pendente';

    card.innerHTML = `
      <header class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 class="text-lg font-semibold text-gray-800">${escapeValue(report.nome)}</h3>
          <p class="text-sm text-gray-500">SKU ${escapeValue(report.productId)} • NCM ${escapeValue(report.ncm) || '—'}</p>
          <p class="mt-1 text-sm text-gray-500">Tipo de produto: ${escapeValue(report.tipoProduto) || '—'}</p>
        </div>
        <div class="flex flex-col items-start gap-2 text-sm md:items-end">
          <div class="flex items-center gap-2">
            <span class="text-xs uppercase tracking-wide text-gray-500">NF-e</span>
            ${buildStatusBadge(statusAtualNfe)}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs uppercase tracking-wide text-gray-500">NFC-e</span>
            ${buildStatusBadge(statusAtualNfce)}
          </div>
        </div>
      </header>

      <section class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <h4 class="text-sm font-semibold text-gray-700">Pendências atuais</h4>
          <div class="mt-3">${buildPendenciasList(report.pendenciasAtuais)}</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <h4 class="text-sm font-semibold text-gray-700">Diferenças detectadas</h4>
          <div class="mt-3">${buildDifferencesList(report.divergencias)}</div>
        </div>
      </section>

      <section class="mt-6 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="block text-sm font-medium text-gray-700">
            Origem da mercadoria
            <select data-field="origem" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">
              ${buildOptions(origemOptions, sugestao.origem || '0')}
            </select>
          </label>
          <label class="block text-sm font-medium text-gray-700">
            CSOSN
            <input type="text" data-field="csosn" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="Ex.: 102">
          </label>
          <label class="block text-sm font-medium text-gray-700">
            CST
            <input type="text" data-field="cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="Ex.: 060">
          </label>
          <label class="block text-sm font-medium text-gray-700">
            CEST
            <input type="text" data-field="cest" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">
          </label>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="block text-sm font-medium text-gray-700">
            Status NF-e
            <select data-field="status.nfe" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">
              ${buildOptions(statusOptions, sugestao?.status?.nfe || 'pendente')}
            </select>
          </label>
          <label class="block text-sm font-medium text-gray-700">
            Status NFC-e
            <select data-field="status.nfce" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">
              ${buildOptions(statusOptions, sugestao?.status?.nfce || 'pendente')}
            </select>
          </label>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-gray-100 p-4">
            <h4 class="text-sm font-semibold text-gray-700">CFOP NF-e</h4>
            <div class="mt-3 space-y-3">
              <label class="block text-xs font-semibold text-gray-500 uppercase">Dentro do estado<input type="text" data-field="cfop.nfe.dentro" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5102"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Fora do estado<input type="text" data-field="cfop.nfe.fora" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="6102"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Transferência<input type="text" data-field="cfop.nfe.transferencia" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5152"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Devolução<input type="text" data-field="cfop.nfe.devolucao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5202"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Industrialização<input type="text" data-field="cfop.nfe.industrializacao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5101"></label>
            </div>
          </div>
          <div class="rounded-lg border border-gray-100 p-4">
            <h4 class="text-sm font-semibold text-gray-700">CFOP NFC-e</h4>
            <div class="mt-3 space-y-3">
              <label class="block text-xs font-semibold text-gray-500 uppercase">Dentro do estado<input type="text" data-field="cfop.nfce.dentro" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5102"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Fora do estado<input type="text" data-field="cfop.nfce.fora" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="6108"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Transferência<input type="text" data-field="cfop.nfce.transferencia" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5656"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Devolução<input type="text" data-field="cfop.nfce.devolucao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5202"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Industrialização<input type="text" data-field="cfop.nfce.industrializacao" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary" placeholder="5101"></label>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-gray-100 p-4">
            <h4 class="text-sm font-semibold text-gray-700">PIS</h4>
            <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label class="block text-xs font-semibold text-gray-500 uppercase">Código<input type="text" data-field="pis.codigo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">CST<input type="text" data-field="pis.cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Alíquota (%)<input type="number" step="0.01" data-field="pis.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Tipo de cálculo<select data-field="pis.tipo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(tipoCalculoOptions, sugestao?.pis?.tipoCalculo || 'percentual')}</select></label>
            </div>
          </div>
          <div class="rounded-lg border border-gray-100 p-4">
            <h4 class="text-sm font-semibold text-gray-700">COFINS</h4>
            <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label class="block text-xs font-semibold text-gray-500 uppercase">Código<input type="text" data-field="cofins.codigo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">CST<input type="text" data-field="cofins.cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Alíquota (%)<input type="number" step="0.01" data-field="cofins.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Tipo de cálculo<select data-field="cofins.tipo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(tipoCalculoOptions, sugestao?.cofins?.tipoCalculo || 'percentual')}</select></label>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-gray-100 p-4">
            <h4 class="text-sm font-semibold text-gray-700">IPI</h4>
            <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label class="block text-xs font-semibold text-gray-500 uppercase">CST<input type="text" data-field="ipi.cst" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Enquadramento<input type="text" data-field="ipi.enquadramento" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Alíquota (%)<input type="number" step="0.01" data-field="ipi.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Tipo de cálculo<select data-field="ipi.tipo" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(tipoCalculoOptions, sugestao?.ipi?.tipoCalculo || 'percentual')}</select></label>
            </div>
          </div>
          <div class="rounded-lg border border-gray-100 p-4">
            <h4 class="text-sm font-semibold text-gray-700">FCP</h4>
            <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label class="block text-xs font-semibold text-gray-500 uppercase">Indicador<select data-field="fcp.indicador" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary">${buildOptions(fcpIndicadores, sugestao?.fcp?.indicador || '0')}</select></label>
              <label class="block text-xs font-semibold text-gray-500 uppercase">Alíquota (%)<input type="number" step="0.01" data-field="fcp.aliquota" class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary focus:ring-primary"></label>
              <label class="flex items-center gap-2 text-xs font-semibold uppercase text-gray-500 md:col-span-2">
                <input type="checkbox" data-field="fcp.aplica" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
                Aplicar FCP
              </label>
            </div>
          </div>
        </div>
      </section>

      <footer class="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <button type="button" data-action="reset" class="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
          <i class="fas fa-undo mr-2"></i>Recarregar sugestão
        </button>
        <button type="button" data-action="apply" class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
          <i class="fas fa-save mr-2"></i>Salvar regras fiscais
        </button>
      </footer>
    `;

    fillCardInputs(card, sugestao);

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
        applyButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Salvando...';

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
          applyButton.innerHTML = '<i class="fas fa-save mr-2"></i>Salvar regras fiscais';
        }
      });
    }

    return card;
  };

  const fetchStores = async () => {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
      if (!response.ok) throw new Error('Não foi possível carregar as empresas.');
      const payload = await response.json();
      stores = Array.isArray(payload) ? payload : [];
      populateStores();
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      showModal({
        title: 'Erro',
        message: error.message || 'Não foi possível carregar as empresas cadastradas.',
        confirmText: 'Entendi',
      });
    }
  };

  const loadSuggestions = async () => {
    if (!currentStoreId) {
      buildList([]);
      renderIcmsEntries([]);
      return;
    }

    try {
      const token = getToken();
      const params = new URLSearchParams({
        storeId: currentStoreId,
        modalidade: currentModalidade,
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
      buildList(Array.isArray(payload?.produtos) ? payload.produtos : []);
    } catch (error) {
      console.error('Erro ao carregar sugestões fiscais:', error);
      showModal({
        title: 'Erro ao carregar',
        message: error.message || 'Não foi possível gerar as sugestões fiscais.',
        confirmText: 'Tentar novamente',
      });
    }
  };

  const handleStoreChange = () => {
    currentStoreId = storeSelect?.value || '';
    loadSuggestions();
  };

  const handleModalidadeChange = (event) => {
    const { modalidade } = event.currentTarget.dataset;
    if (!modalidade || modalidade === currentModalidade) return;
    currentModalidade = modalidade;
    setModalidadeButtonState();
    loadSuggestions();
  };

  const initEvents = () => {
    storeSelect?.addEventListener('change', handleStoreChange);
    statusSelect?.addEventListener('change', loadSuggestions);
    refreshButton?.addEventListener('click', loadSuggestions);

    modalidadeButtons.forEach((button) => {
      button.addEventListener('click', handleModalidadeChange);
    });

    if (searchInput) {
      searchInput.addEventListener('input', () => {
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
