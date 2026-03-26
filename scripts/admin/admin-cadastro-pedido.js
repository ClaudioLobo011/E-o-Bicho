(function () {
  var STORAGE_KEY = 'admin-cadastro-pedido-rascunho-v1';
  var state = defaultState();
  var importState = {
    products: [],
    selectedIds: new Set(),
    isOpen: false,
    observer: null,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function money(value) {
    var n = parseNumber(value);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return 0;
    var normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    var n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function defaultState() {
    return {
      numero: '',
      cliente: '',
      whatsapp: '',
      data: new Date().toISOString().slice(0, 10),
      status: 'rascunho',
      desconto: 0,
      observacoes: '',
      itens: [],
    };
  }

  function getAuthHeaders() {
    var token = '';
    try {
      var logged = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      token = logged && logged.token ? String(logged.token) : '';
    } catch (_) {
      token = '';
    }
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function extractProducts(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload && payload.products)) return payload.products;
    if (Array.isArray(payload && payload.items)) return payload.items;
    if (Array.isArray(payload && payload.data)) return payload.data;
    if (Array.isArray(payload && payload.data && payload.data.products)) return payload.data.products;
    return [];
  }

  function normalizeProduct(raw) {
    var id = String(raw && (raw._id || raw.id || raw.cod || raw.codigo || raw.codbarras || '')).trim();
    var cod = String(raw && (raw.cod || raw.codigo || '') || '').trim();
    var codbarras = String(raw && (raw.codbarras || raw.codigoBarras || raw.barcode || '') || '').trim();
    var nome = String(raw && (raw.nome || raw.name || raw.descricao || raw.description || '') || '').trim();
    var custo = parseNumber(raw && (raw.custo || raw.precoCusto || raw.cost || 0));
    return {
      id: id || [cod, codbarras, nome].join('|'),
      cod: cod,
      codbarras: codbarras,
      nome: nome,
      custo: custo,
    };
  }
  function normalizeSearchText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function escapeSearchRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildSearchWildcardRegex(rawValue) {
    var normalized = normalizeSearchText(rawValue);
    if (!normalized) return null;
    var pattern = normalized
      .split('*')
      .map(function (segment) { return escapeSearchRegex(segment); })
      .join('.*');
    if (!pattern) return null;
    try {
      return new RegExp(pattern, 'i');
    } catch (_) {
      return null;
    }
  }

  function filterImportProductsBySearch(products, rawTerm) {
    var list = Array.isArray(products) ? products : [];
    var regex = buildSearchWildcardRegex(rawTerm);
    if (!regex) return list.slice();
    return list.filter(function (product) {
      var cod = normalizeSearchText(product && product.cod);
      var codbarras = normalizeSearchText(product && product.codbarras);
      var nome = normalizeSearchText(product && product.nome);
      return regex.test(cod) || regex.test(codbarras) || regex.test(nome);
    });
  }

  function buildItemRow(item, index) {
    var tr = document.createElement('tr');
    tr.innerHTML = '' +
      '<td class="px-3 py-2"><input type="text" data-item-field="codbarras" data-item-index="' + index + '" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="' + escapeHtml(item.codbarras || '') + '" placeholder="Codigo de barras"></td>' +
      '<td class="px-3 py-2"><input type="text" data-item-field="produto" data-item-index="' + index + '" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="' + escapeHtml(item.produto || '') + '" placeholder="Nome do produto"></td>' +
      '<td class="px-3 py-2"><input type="number" min="1" step="1" data-item-field="quantidade" data-item-index="' + index + '" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="' + (item.quantidade || 1) + '"></td>' +
      '<td class="px-3 py-2"><input type="number" min="0" step="0.01" data-item-field="valorUnitario" data-item-index="' + index + '" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" value="' + (item.valorUnitario || 0) + '"></td>' +
      '<td class="px-3 py-2 text-gray-700 font-semibold" data-item-total="' + index + '">' + money((item.quantidade || 0) * (item.valorUnitario || 0)) + '</td>' +
      '<td class="px-3 py-2"><button type="button" data-remover-item="' + index + '" class="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50" aria-label="Remover item"><i class="fas fa-trash"></i></button></td>';
    return tr;
  }

  function subtotal() {
    return state.itens.reduce(function (acc, item) {
      return acc + ((item.quantidade || 0) * (item.valorUnitario || 0));
    }, 0);
  }

  function updateSummary() {
    var sub = subtotal();
    var desconto = parseNumber(state.desconto);
    var total = Math.max(sub - desconto, 0);
    byId('pedido-resumo-subtotal').textContent = money(sub);
    byId('pedido-resumo-desconto').textContent = money(desconto);
    byId('pedido-resumo-total').textContent = money(total);
  }

  function renderItems() {
    var tbody = byId('pedido-itens-body');
    var empty = byId('pedido-itens-vazio');
    tbody.innerHTML = '';
    if (!state.itens.length) {
      empty.classList.remove('hidden');
      updateSummary();
      return;
    }
    empty.classList.add('hidden');
    state.itens.forEach(function (item, index) { tbody.appendChild(buildItemRow(item, index)); });
    updateSummary();
  }

  function syncHeaderToState() {
    var numero = byId('pedido-numero');
    var cliente = byId('pedido-cliente');
    var whatsapp = byId('pedido-whatsapp');
    var data = byId('pedido-data');
    var status = byId('pedido-status');
    var desconto = byId('pedido-desconto');
    var observacoes = byId('pedido-observacoes');
    state.numero = numero ? numero.value.trim() : '';
    state.cliente = cliente ? cliente.value.trim() : '';
    state.whatsapp = whatsapp ? whatsapp.value.trim() : '';
    state.data = data ? data.value : state.data;
    state.status = status ? status.value : state.status;
    state.desconto = desconto ? parseNumber(desconto.value) : 0;
    state.observacoes = observacoes ? observacoes.value.trim() : '';
  }

  function syncStateToHeader() {
    var numero = byId('pedido-numero');
    var cliente = byId('pedido-cliente');
    var whatsapp = byId('pedido-whatsapp');
    var data = byId('pedido-data');
    var status = byId('pedido-status');
    var desconto = byId('pedido-desconto');
    var observacoes = byId('pedido-observacoes');
    if (numero) numero.value = state.numero || '';
    if (cliente) cliente.value = state.cliente || '';
    if (whatsapp) whatsapp.value = state.whatsapp || '';
    if (data) data.value = state.data || '';
    if (status) status.value = state.status || 'rascunho';
    if (desconto) desconto.value = parseNumber(state.desconto);
    if (observacoes) observacoes.value = state.observacoes || '';
  }

  function saveDraft(showFeedback) {
    syncHeaderToState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (showFeedback && typeof window.showToast === 'function') {
      window.showToast('Rascunho salvo com sucesso.', 'success', 2500);
    }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      state = Object.assign(defaultState(), parsed);
      if (!Array.isArray(state.itens)) state.itens = [];
      state.itens = state.itens.map(function (item) {
        return {
          codbarras: String(item && item.codbarras || ''),
          produto: String(item && item.produto || ''),
          quantidade: Math.max(1, parseNumber(item && item.quantidade) || 1),
          valorUnitario: Math.max(0, parseNumber(item && item.valorUnitario) || 0),
        };
      });
    } catch (err) {
      console.error('Falha ao carregar rascunho de pedido:', err);
      state = defaultState();
    }
  }

  function clearDraft() {
    state = defaultState();
    localStorage.removeItem(STORAGE_KEY);
    syncStateToHeader();
    renderItems();
    if (typeof window.showToast === 'function') window.showToast('Rascunho limpo.', 'info', 2200);
  }

  function addItem() {
    state.itens.push({ codbarras: '', produto: '', quantidade: 1, valorUnitario: 0 });
    renderItems();
    saveDraft(false);
  }

  function exportItemsToExcel() {
    if (!Array.isArray(state.itens) || !state.itens.length) {
      if (typeof window.showToast === 'function') {
        window.showToast('Nao ha itens para exportar.', 'warning', 2200);
      }
      return;
    }

    var rows = state.itens.map(function (item) {
      var quantidade = Math.max(1, parseNumber(item && item.quantidade) || 1);
      var valorUnitario = Math.max(0, parseNumber(item && item.valorUnitario) || 0);
      var total = quantidade * valorUnitario;
      return {
        codbarras: String(item && item.codbarras || ''),
        produto: String(item && item.produto || ''),
        quantidade: quantidade,
        valorUnitario: valorUnitario,
        total: total,
      };
    });

    var tableHtml = '' +
      '<table border="1">' +
      '<thead><tr>' +
      '<th>Codbarras</th>' +
      '<th>Produto</th>' +
      '<th>Qtd</th>' +
      '<th>Valor unitario</th>' +
      '<th>Total</th>' +
      '</tr></thead>' +
      '<tbody>' +
      rows.map(function (row) {
        return '<tr>' +
          '<td style="mso-number-format:\'\\@\';">' + escapeHtml(String(row.codbarras || '')) + '</td>' +
          '<td>' + escapeHtml(row.produto) + '</td>' +
          '<td>' + row.quantidade + '</td>' +
          '<td>' + row.valorUnitario.toFixed(2).replace('.', ',') + '</td>' +
          '<td>' + row.total.toFixed(2).replace('.', ',') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody>' +
      '</table>';

    var fullHtml = '<html><head><meta charset="UTF-8"></head><body>' + tableHtml + '</body></html>';
    var blob = new Blob(['\ufeff', fullHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    link.href = url;
    link.download = 'pedido-itens-' + stamp + '.xls';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getVisibleImportRows() {
    var tbody = byId('pedido-importar-resultados');
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll('tr')).filter(function (row) {
      return !row.classList.contains('hidden');
    });
  }

  function updateImportSummary() {
    var label = byId('pedido-importar-selecionados');
    if (!label) return;
    label.textContent = importState.selectedIds.size + ' selecionado(s)';
  }

  function updateSelectAllStateFromVisible() {
    var head = byId('pedido-importar-selecionar-todos');
    if (!head) return;
    var visibleRows = getVisibleImportRows();
    var checkboxes = visibleRows.map(function (r) { return r.querySelector('[data-importar-produto-id]'); }).filter(Boolean);
    if (!checkboxes.length) {
      head.checked = false;
      head.indeterminate = false;
      return;
    }
    var checkedCount = checkboxes.filter(function (cb) { return cb.checked; }).length;
    head.checked = checkedCount > 0 && checkedCount === checkboxes.length;
    head.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }

  function ensureImportHeaderSelectCheckbox() {
    var table = byId('pedido-importar-tabela');
    if (!table) return;
    var firstTh = table.querySelector('thead th');
    if (!firstTh) return;
    if (firstTh.querySelector('#pedido-importar-selecionar-todos')) return;

    firstTh.innerHTML = '' +
      '<label class="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600">' +
      '  <input id="pedido-importar-selecionar-todos" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30">' +
      '  <span>Selecione (filtro)</span>' +
      '</label>';

    var selectAll = byId('pedido-importar-selecionar-todos');
    if (selectAll && !selectAll.dataset.bound) {
      selectAll.dataset.bound = '1';
      selectAll.addEventListener('change', function () {
        var check = Boolean(selectAll.checked);
        getVisibleImportRows().forEach(function (row) {
          var checkbox = row.querySelector('[data-importar-produto-id]');
          if (!checkbox) return;
          checkbox.checked = check;
          var id = checkbox.getAttribute('data-importar-produto-id');
          if (!id) return;
          if (check) importState.selectedIds.add(id);
          else importState.selectedIds.delete(id);
        });
        updateImportSummary();
        updateSelectAllStateFromVisible();
      });
    }
  }

  function observeImportTableVisibilityChanges() {
    if (importState.observer) {
      importState.observer.disconnect();
      importState.observer = null;
    }
    var tbody = byId('pedido-importar-resultados');
    if (!tbody) return;

    importState.observer = new MutationObserver(function () {
      updateSelectAllStateFromVisible();
    });
    importState.observer.observe(tbody, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function renderImportRows(products) {
    var tbody = byId('pedido-importar-resultados');
    var empty = byId('pedido-importar-vazio');
    if (!tbody || !empty) return;

    tbody.innerHTML = '';

    if (!products.length) {
      empty.classList.remove('hidden');
      empty.textContent = 'Nenhum produto encontrado para o filtro atual.';
      updateSelectAllStateFromVisible();
      updateImportSummary();
      return;
    }

    empty.classList.add('hidden');

    products.forEach(function (product) {
      var checked = importState.selectedIds.has(product.id) ? 'checked' : '';
      var tr = document.createElement('tr');
      tr.innerHTML = '' +
        '<td class="px-3 py-2"><input type="checkbox" data-importar-produto-id="' + escapeHtml(product.id) + '" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30" ' + checked + '></td>' +
        '<td class="px-3 py-2 text-gray-700">' + escapeHtml(product.cod || '-') + '</td>' +
        '<td class="px-3 py-2 text-gray-700">' + escapeHtml(product.codbarras || '-') + '</td>' +
        '<td class="px-3 py-2 text-gray-800">' + escapeHtml(product.nome || '-') + '</td>' +
        '<td class="px-3 py-2 text-gray-700">' + money(product.custo) + '</td>';
      tbody.appendChild(tr);
    });

    ensureImportHeaderSelectCheckbox();
    observeImportTableVisibilityChanges();
    updateSelectAllStateFromVisible();
    updateImportSummary();
  }

  async function fetchProductsForImport(term) {
    var safeTerm = String(term || '').trim();
    var hasWildcard = safeTerm.indexOf('*') !== -1;
    var page = 1;
    var pageSize = 1000;
    var all = [];

    while (true) {
      var endpoint = API_CONFIG.BASE_URL + '/products?includeHidden=true&fastMode=true&page=' + page + '&limit=' + pageSize;
      if (safeTerm && !hasWildcard) endpoint += '&search=' + encodeURIComponent(safeTerm);

      var response = await fetch(endpoint, { method: 'GET', headers: getAuthHeaders() });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(payload && payload.message ? payload.message : 'Falha ao buscar produtos.');
      }

      var chunk = extractProducts(payload);
      if (!Array.isArray(chunk) || !chunk.length) break;

      all = all.concat(chunk);

      if (chunk.length < pageSize) break;
      page += 1;

      if (page > 100) break;
    }

    var list = all.map(normalizeProduct).filter(function (p) {
      return p.id && (p.nome || p.cod || p.codbarras);
    });

    var unique = [];
    var seen = new Set();
    list.forEach(function (p) {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      unique.push(p);
    });

    importState.products = filterImportProductsBySearch(unique, safeTerm);
    renderImportRows(importState.products);
  }

  function openImportModal() {
    var modal = byId('pedido-importar-modal');
    if (!modal) return;
    importState.isOpen = true;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
    setTimeout(function () {
      ensureImportHeaderSelectCheckbox();
      updateSelectAllStateFromVisible();
    }, 120);
    var input = byId('pedido-importar-busca');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function closeImportModal() {
    var modal = byId('pedido-importar-modal');
    if (!modal) return;
    importState.isOpen = false;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('overflow-hidden');
  }

  function importSelectedProducts() {
    if (!importState.selectedIds.size) {
      if (typeof window.showToast === 'function') window.showToast('Selecione ao menos um produto para importar.', 'warning', 2200);
      return;
    }

    var map = new Map(importState.products.map(function (p) { return [p.id, p]; }));
    var added = 0;

    importState.selectedIds.forEach(function (id) {
      var product = map.get(id);
      if (!product) return;
      state.itens.push({
        codbarras: product.codbarras || '',
        produto: product.nome || '',
        quantidade: 1,
        valorUnitario: Math.max(0, parseNumber(product.custo)),
      });
      added += 1;
    });

    renderItems();
    saveDraft(false);
    closeImportModal();
    if (typeof window.showToast === 'function') window.showToast(added + ' produto(s) importado(s).', 'success', 2600);
  }

  function setImportErrorMessage(message) {
    importState.products = [];
    renderImportRows([]);
    var empty = byId('pedido-importar-vazio');
    if (empty) {
      empty.classList.remove('hidden');
      empty.textContent = message || 'Erro ao buscar produtos.';
    }
  }

  function bindImportEvents() {
    var openBtn = byId('cadastro-pedido-importar');
    var closeBtn = byId('pedido-importar-fechar');
    var cancelBtn = byId('pedido-importar-cancelar');
    var confirmBtn = byId('pedido-importar-confirmar');
    var searchBtn = byId('pedido-importar-buscar');
    var searchInput = byId('pedido-importar-busca');
    var tbody = byId('pedido-importar-resultados');
    var modal = byId('pedido-importar-modal');

    if (!openBtn || !modal) return;

    openBtn.addEventListener('click', async function () {
      openImportModal();
      try {
        await fetchProductsForImport(searchInput ? searchInput.value : '');
      } catch (error) {
        setImportErrorMessage(error && error.message ? error.message : 'Erro ao buscar produtos.');
      }
    });

    if (closeBtn) closeBtn.addEventListener('click', closeImportModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeImportModal);
    if (confirmBtn) confirmBtn.addEventListener('click', importSelectedProducts);

    modal.addEventListener('click', function (event) {
      if (!event.target.closest('[data-pedido-importar-dismiss="backdrop"]')) return;
      closeImportModal();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && importState.isOpen) closeImportModal();
    });

    if (searchBtn) {
      searchBtn.addEventListener('click', async function () {
        try {
          await fetchProductsForImport(searchInput ? searchInput.value : '');
        } catch (error) {
          setImportErrorMessage(error && error.message ? error.message : 'Erro ao buscar produtos.');
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('keydown', async function (event) {
        if (event.isComposing) return;
        var isRealEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter';
        if (!isRealEnter) return;
        event.preventDefault();
        try {
          await fetchProductsForImport(searchInput.value);
        } catch (error) {
          setImportErrorMessage(error && error.message ? error.message : 'Erro ao buscar produtos.');
        }
      });
    }

    if (tbody) {
      tbody.addEventListener('change', function (event) {
        var checkbox = event.target.closest('[data-importar-produto-id]');
        if (!checkbox) return;
        var id = checkbox.getAttribute('data-importar-produto-id');
        if (!id) return;
        if (checkbox.checked) importState.selectedIds.add(id);
        else importState.selectedIds.delete(id);
        updateImportSummary();
        updateSelectAllStateFromVisible();
      });
    }

    var table = byId('pedido-importar-tabela');
    if (table) {
      table.addEventListener('input', function () {
        setTimeout(updateSelectAllStateFromVisible, 0);
      });
      table.addEventListener('click', function () {
        setTimeout(updateSelectAllStateFromVisible, 0);
      });
    }
  }

  function bindEvents() {
    byId('pedido-item-adicionar').addEventListener('click', addItem);

    var exportBtn = byId('pedido-exportar-excel');
    if (exportBtn) exportBtn.addEventListener('click', exportItemsToExcel);

    byId('cadastro-pedido-salvar').addEventListener('click', function () {
      saveDraft(true);
    });

    byId('cadastro-pedido-limpar').addEventListener('click', clearDraft);

    var headerFields = ['pedido-numero', 'pedido-cliente', 'pedido-whatsapp', 'pedido-data', 'pedido-status', 'pedido-desconto', 'pedido-observacoes'];
    headerFields.forEach(function (id) {
      var el = byId(id);
      if (!el) return;
      el.addEventListener('change', function () {
        syncHeaderToState();
        updateSummary();
        saveDraft(false);
      });
      el.addEventListener('input', function () {
        if (id === 'pedido-desconto') {
          syncHeaderToState();
          updateSummary();
        }
      });
    });

    byId('pedido-itens-body').addEventListener('input', function (event) {
      var target = event.target;
      var index = parseInt(target.getAttribute('data-item-index'), 10);
      var field = target.getAttribute('data-item-field');
      if (!Number.isInteger(index) || !field || !state.itens[index]) return;

      if (field === 'codbarras') state.itens[index].codbarras = target.value;
      if (field === 'produto') state.itens[index].produto = target.value;
      if (field === 'quantidade') state.itens[index].quantidade = Math.max(1, parseInt(target.value, 10) || 1);
      if (field === 'valorUnitario') state.itens[index].valorUnitario = Math.max(0, parseNumber(target.value));

      var totalEl = byId('pedido-itens-body').querySelector('[data-item-total="' + index + '"]');
      if (totalEl) totalEl.textContent = money(state.itens[index].quantidade * state.itens[index].valorUnitario);
      updateSummary();
    });

    byId('pedido-itens-body').addEventListener('change', function () {
      saveDraft(false);
    });

    byId('pedido-itens-body').addEventListener('click', function (event) {
      var button = event.target.closest('[data-remover-item]');
      if (!button) return;
      var index = parseInt(button.getAttribute('data-remover-item'), 10);
      if (!Number.isInteger(index)) return;
      state.itens.splice(index, 1);
      renderItems();
      saveDraft(false);
    });

    bindImportEvents();
  }

  function init() {
    loadDraft();
    syncStateToHeader();
    renderItems();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

