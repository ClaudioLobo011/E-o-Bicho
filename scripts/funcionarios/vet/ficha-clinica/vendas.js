// Vendas tooltip for quick actions
import {
  els,
  api,
  debounce,
  formatMoney,
  normalizeId,
  notify,
  state,
  isFinalizadoSelection,
} from './core.js';
import { emitFichaClinicaUpdate } from './real-time.js';

const vendasTooltip = {
  container: null,
  arrow: null,
  form: null,
  produtoInput: null,
  precoInput: null,
  qtdInput: null,
  totalInput: null,
  addBtn: null,
  cancelBtn: null,
  selectedProduct: null,
  outsideHandler: null,
  keydownHandler: null,
  repositionHandler: null,
};

const productSearchModal = {
  overlay: null,
  dialog: null,
  input: null,
  results: null,
  info: null,
  closeBtn: null,
  includeInactiveInput: null,
  currentResults: [],
  searchAbortController: null,
  keydownHandler: null,
  isOpen: false,
};

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  const str = String(value).trim();
  if (!str) return 0;
  const normalized = str.replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function escapeRegexSegment(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateVendasTotal() {
  if (!vendasTooltip.precoInput || !vendasTooltip.qtdInput || !vendasTooltip.totalInput) return;
  const preco = parseNumber(vendasTooltip.precoInput.value);
  const qtdRaw = parseNumber(vendasTooltip.qtdInput.value);
  const qtd = Number.isFinite(qtdRaw) && qtdRaw > 0 ? qtdRaw : 0;
  const total = preco * qtd;
  vendasTooltip.totalInput.value = formatMoney(total || 0);
}

function getVendasLoadKey(clienteId, petId, appointmentId) {
  const tutor = normalizeId(clienteId);
  const pet = normalizeId(petId);
  if (!(tutor && pet)) return null;
  const appointment = normalizeId(appointmentId);
  return appointment ? `${tutor}|${pet}|${appointment}` : `${tutor}|${pet}`;
}

function notifyVendasUpdate() {
  document.dispatchEvent(new CustomEvent('vet-vendas-updated'));
}

function normalizeVendaRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeId(raw.id || raw._id);
  if (!id) return null;
  const clienteId = normalizeId(raw.clienteId || raw.cliente);
  const petId = normalizeId(raw.petId || raw.pet);
  const appointmentId = normalizeId(raw.appointmentId || raw.appointment);
  const produtoId = normalizeId(raw.produtoId || raw.produto);
  const nome = raw.produtoNome || raw.nome || raw.descricao || '';
  const valorUnitario = Number(raw.valorUnitario || raw.valor || raw.preco || 0);
  const quantidade = Number(raw.quantidade || raw.qtd || 0);
  const subtotalRaw = Number(raw.subtotal || raw.total);
  const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : (Number.isFinite(valorUnitario) ? valorUnitario : 0) * (Number.isFinite(quantidade) ? quantidade : 0);
  return {
    id,
    _id: id,
    clienteId,
    petId,
    appointmentId,
    produtoId,
    nome: String(nome || ''),
    valorUnitario: Number.isFinite(valorUnitario) ? valorUnitario : 0,
    quantidade: Number.isFinite(quantidade) ? quantidade : 0,
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    createdAt: raw.createdAt || raw.criadoEm || null,
    updatedAt: raw.updatedAt || raw.atualizadoEm || null,
  };
}

export function getVendasItemsForContext() {
  return Array.isArray(state.vendas) ? state.vendas : [];
}

function setVendasState(list, loadKey = null) {
  state.vendas = Array.isArray(list) ? list : [];
  if (loadKey !== null) {
    state.vendasLoadKey = loadKey;
  }
  notifyVendasUpdate();
}

function addVendaItem(item) {
  const current = Array.isArray(state.vendas) ? [...state.vendas] : [];
  current.unshift(item);
  setVendasState(current);
}

export async function loadVendasFromServer(options = {}) {
  const { force = false } = options || {};
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  if (!(clienteId && petId)) {
    state.vendas = [];
    state.vendasLoadKey = null;
    state.vendasLoading = false;
    notifyVendasUpdate();
    return;
  }

  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  const loadKey = getVendasLoadKey(clienteId, petId, appointmentId);

  if (isFinalizadoSelection(clienteId, petId)) {
    state.vendas = [];
    state.vendasLoadKey = loadKey;
    state.vendasLoading = false;
    notifyVendasUpdate();
    return;
  }

  if (!force && loadKey && state.vendasLoadKey === loadKey) return;

  state.vendasLoading = true;
  notifyVendasUpdate();

  try {
    const params = new URLSearchParams({ clienteId, petId });
    if (appointmentId) params.set('appointmentId', appointmentId);
    const response = await api(`/func/vet/vendas?${params.toString()}`);
    const payload = await response.json().catch(() => (response.ok ? [] : {}));
    if (!response.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar vendas.';
      throw new Error(message);
    }
    const list = Array.isArray(payload) ? payload : [];
    const normalized = list.map(normalizeVendaRecord).filter(Boolean);
    setVendasState(normalized, loadKey);
  } catch (error) {
    console.error('loadVendasFromServer', error);
    state.vendas = [];
    state.vendasLoadKey = loadKey;
    notifyVendasUpdate();
    notify(error.message || 'Erro ao carregar vendas.', 'error');
  } finally {
    state.vendasLoading = false;
  }
}

export function handleVendasRealTimeEvent(event = {}) {
  if (!event || typeof event !== 'object') return false;
  if (event.scope && event.scope !== 'venda') return false;

  const targetClienteId = normalizeId(event.clienteId || event.tutorId || event.cliente);
  const targetPetId = normalizeId(event.petId || event.pet);
  const targetAppointmentId = normalizeId(event.appointmentId || event.agendamentoId || event.appointment);

  const currentClienteId = normalizeId(state.selectedCliente?._id);
  const currentPetId = normalizeId(state.selectedPetId);
  const currentAppointmentId = normalizeId(state.agendaContext?.appointmentId);

  if (targetClienteId && currentClienteId && targetClienteId !== currentClienteId) return false;
  if (targetPetId && currentPetId && targetPetId !== currentPetId) return false;
  if (targetAppointmentId && currentAppointmentId && targetAppointmentId !== currentAppointmentId) return false;

  const action = String(event.action || '').toLowerCase();
  if (action === 'delete') {
    const vendaId = normalizeId(event.vendaId || event.id || event.recordId);
    if (!vendaId) return false;
    const list = Array.isArray(state.vendas) ? state.vendas : [];
    const next = list.filter((item) => normalizeId(item?.id || item?._id) !== vendaId);
    if (next.length === list.length) return false;
    setVendasState(next);
    return true;
  }

  const payload = event.venda || event.record || event.data;
  if (!payload || typeof payload !== 'object') return false;
  const record = normalizeVendaRecord(payload);
  if (!record) return false;
  const recordId = normalizeId(record.id || record._id);
  const list = Array.isArray(state.vendas) ? [...state.vendas] : [];
  let replaced = false;
  for (let i = 0; i < list.length; i += 1) {
    const entryId = normalizeId(list[i]?.id || list[i]?._id);
    if (!entryId || entryId !== recordId) continue;
    list[i] = { ...list[i], ...record, id: recordId, _id: recordId };
    replaced = true;
    break;
  }
  if (!replaced) {
    list.unshift({ ...record, id: recordId, _id: recordId });
  }
  setVendasState(list);
  return true;
}

function formatQuantity(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0,000';
  return num.toFixed(3).replace('.', ',');
}

function buildSearchPattern(raw) {
  const term = String(raw || '').trim();
  if (!term) return '';
  if (!term.includes('*')) return term;
  const segments = term
    .split('*')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => escapeRegexSegment(segment));
  if (!segments.length) return '';
  return segments.join('.*');
}

function getProductSalePrice(product) {
  if (!product || typeof product !== 'object') return 0;
  const candidates = [
    product.venda,
    product.precoVenda,
    product.preco,
    product.valor,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function renderProductSearchResults(results, term) {
  if (!productSearchModal.results) return;
  const list = Array.isArray(results) ? results : [];
  if (!list.length) {
    const label = term ? `Nenhum produto encontrado para "${term}".` : 'Nenhum produto encontrado.';
    productSearchModal.results.innerHTML = `<div class="px-4 py-3 text-sm text-gray-500">${label}</div>`;
    return;
  }

  const items = list
    .map((product, index) => {
      const name = product?.nome || product?.descricao || 'Produto sem nome';
      const price = getProductSalePrice(product);
      const code = product?.codigoInterno || product?.codigo || product?.sku || '';
      const priceLabel = formatMoney(price || 0);
      const codeLabel = code ? `Código: ${code}` : '';
      return `
        <button type="button" class="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-sky-50" data-result-index="${index}">
          <div class="flex flex-col">
            <span class="text-sm font-semibold text-gray-800">${name}</span>
            <span class="text-xs text-gray-500">${codeLabel}</span>
          </div>
          <span class="text-sm font-semibold text-gray-700">${priceLabel}</span>
        </button>
      `;
    })
    .join('');

  productSearchModal.results.innerHTML = items;
}

function setProdutoFromSearch(product) {
  if (!product) return;
  const name = product?.nome || product?.descricao || '';
  const price = getProductSalePrice(product);
  vendasTooltip.selectedProduct = product;
  if (vendasTooltip.produtoInput) {
    vendasTooltip.produtoInput.value = name;
  }
  if (vendasTooltip.precoInput) {
    const normalized = Number(price);
    vendasTooltip.precoInput.value = Number.isFinite(normalized) ? normalized.toFixed(2) : '';
  }
  updateVendasTotal();
  if (vendasTooltip.qtdInput) {
    setTimeout(() => {
      try {
        vendasTooltip.qtdInput.focus();
        vendasTooltip.qtdInput.select();
      } catch {}
    }, 0);
  }
}

async function performProductSearch(term) {
  if (!productSearchModal.results) return;
  const raw = String(term || '').trim();
  const cleaned = raw.replace(/\*/g, '').trim();
  const isWildcardList = raw === '*' || cleaned === '';
  const normalized = raw;
  const includeInactive = !!productSearchModal.includeInactiveInput?.checked;

  if (!raw) {
    productSearchModal.results.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500">Digite para buscar produtos.</div>';
    return;
  }

  const minLength = /^\d+$/.test(cleaned) ? 1 : 2;
  if (!isWildcardList && cleaned.length < minLength) {
    productSearchModal.results.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500">Digite ao menos 2 letras para buscar.</div>';
    return;
  }

  if (productSearchModal.searchAbortController) {
    productSearchModal.searchAbortController.abort();
  }
  const controller = new AbortController();
  productSearchModal.searchAbortController = controller;

  productSearchModal.results.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500">Buscando produtos...</div>';

  try {
    const params = new URLSearchParams({ limit: '12' });
    if (!isWildcardList) {
      const pattern = buildSearchPattern(normalized);
      if (pattern) params.set('search', pattern);
    }
    if (includeInactive) {
      params.set('includeHidden', 'true');
      params.set('audience', 'pdv');
    } else {
      params.set('includeHidden', 'false');
    }
    const response = await api(`/products?${params.toString()}`, { signal: controller.signal });
    const payload = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = payload?.message || 'Erro ao buscar produtos.';
      throw new Error(message);
    }
    const products = Array.isArray(payload?.products)
      ? payload.products
      : Array.isArray(payload)
      ? payload
      : [];
    const filtered = includeInactive ? products : products.filter((item) => !item?.inativo);
    productSearchModal.currentResults = filtered;
    renderProductSearchResults(filtered, raw);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('performProductSearch', error);
    productSearchModal.results.innerHTML = '<div class="px-4 py-3 text-sm text-red-500">Falha ao buscar produtos.</div>';
  }
}

function ensureProductSearchModal() {
  if (productSearchModal.overlay) return productSearchModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-product-search-modal';
  overlay.className = 'hidden fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'mt-6 w-full max-w-2xl rounded-xl bg-white shadow-xl ring-1 ring-black/10';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  overlay.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4';
  dialog.appendChild(header);

  const title = document.createElement('h3');
  title.className = 'text-base font-semibold text-gray-800';
  title.textContent = 'Buscar produto';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeProductSearchModal();
  });
  header.appendChild(closeBtn);

  const content = document.createElement('div');
  content.className = 'px-5 py-4';
  dialog.appendChild(content);

  const toggleRow = document.createElement('label');
  toggleRow.className = 'mb-3 flex items-center gap-2 text-sm text-gray-700';
  content.appendChild(toggleRow);

  const includeInactiveInput = document.createElement('input');
  includeInactiveInput.type = 'checkbox';
  includeInactiveInput.className = 'h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500';
  includeInactiveInput.checked = false;
  toggleRow.appendChild(includeInactiveInput);

  const toggleText = document.createElement('span');
  toggleText.textContent = 'Considerar Inativos';
  toggleRow.appendChild(toggleText);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Digite o nome do produto (use * como coringa)';
  input.className =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  content.appendChild(input);

  const info = document.createElement('p');
  info.className = 'mt-2 text-xs text-gray-500';
  info.textContent = 'Use "*" como coringa. Ex: sim*10*20*kg. Apenas "*" lista todos.';
  content.appendChild(info);

  const results = document.createElement('div');
  results.className = 'mt-4 max-h-[360px] overflow-y-auto rounded-lg border border-gray-100';
  content.appendChild(results);

  const debouncedSearch = debounce((value) => performProductSearch(value), 300);
  input.addEventListener('input', (event) => {
    debouncedSearch(event.target.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  });

  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-result-index]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(button.getAttribute('data-result-index'));
    if (!Number.isInteger(index)) return;
    const product = productSearchModal.currentResults[index];
    if (!product) return;
    setProdutoFromSearch(product);
    closeProductSearchModal();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeProductSearchModal();
    }
  });
  includeInactiveInput.addEventListener('change', () => {
    performProductSearch(input.value || '');
  });

  document.body.appendChild(overlay);

  productSearchModal.overlay = overlay;
  productSearchModal.dialog = dialog;
  productSearchModal.input = input;
  productSearchModal.results = results;
  productSearchModal.info = info;
  productSearchModal.closeBtn = closeBtn;
  productSearchModal.includeInactiveInput = includeInactiveInput;

  return productSearchModal;
}

function openProductSearchModal(query) {
  const modal = ensureProductSearchModal();
  modal.isOpen = true;
  modal.overlay.classList.remove('hidden');
  modal.overlay.setAttribute('aria-hidden', 'false');
  if (modal.input) {
    modal.input.value = query || '';
    modal.input.focus();
  }
  if (modal.includeInactiveInput) {
    modal.includeInactiveInput.checked = false;
  }
  performProductSearch(query || '');

  if (modal.keydownHandler) {
    document.removeEventListener('keydown', modal.keydownHandler);
  }
  modal.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeProductSearchModal();
    }
  };
  document.addEventListener('keydown', modal.keydownHandler);
}

function closeProductSearchModal() {
  if (!productSearchModal.overlay) return;
  productSearchModal.isOpen = false;
  productSearchModal.overlay.classList.add('hidden');
  productSearchModal.overlay.setAttribute('aria-hidden', 'true');
  if (productSearchModal.searchAbortController) {
    productSearchModal.searchAbortController.abort();
    productSearchModal.searchAbortController = null;
  }
  if (productSearchModal.results) {
    productSearchModal.results.innerHTML = '';
  }
  if (productSearchModal.keydownHandler) {
    document.removeEventListener('keydown', productSearchModal.keydownHandler);
    productSearchModal.keydownHandler = null;
  }
}

function ensureVendasTooltip() {
  if (vendasTooltip.container) return vendasTooltip;

  const container = document.createElement('div');
  container.id = 'vet-vendas-tooltip';
  container.className =
    'hidden fixed z-50 w-[420px] max-w-[95vw] rounded-xl bg-white shadow-xl ring-1 ring-black/10 p-4';
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'false');

  const arrow = document.createElement('div');
  arrow.className = 'absolute -top-2 left-8 h-4 w-4 rotate-45 bg-white ring-1 ring-black/10';
  container.appendChild(arrow);

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between gap-3';
  container.appendChild(header);

  const title = document.createElement('h3');
  title.className = 'text-base font-semibold text-gray-800';
  title.textContent = 'Vendas';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeVendasTooltip();
  });
  header.appendChild(closeBtn);

  const form = document.createElement('form');
  form.className = 'mt-4 grid gap-4';
  container.appendChild(form);

  const produtoField = document.createElement('label');
  produtoField.className = 'grid gap-1';
  form.appendChild(produtoField);

  const produtoLabel = document.createElement('span');
  produtoLabel.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
  produtoLabel.textContent = 'Produto';
  produtoField.appendChild(produtoLabel);

  const produtoInput = document.createElement('input');
  produtoInput.type = 'text';
  produtoInput.placeholder = 'Nome do produto';
  produtoInput.className =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  produtoField.appendChild(produtoInput);
  produtoInput.addEventListener('input', (event) => {
    const value = String(event.target.value || '');
    const trimmed = value.trim();
    vendasTooltip.selectedProduct = null;
    if (!trimmed) return;
    if (trimmed.includes('*') || /[a-zA-ZÀ-ÿ]/.test(trimmed)) {
      openProductSearchModal(trimmed);
    }
  });

  const valuesGrid = document.createElement('div');
  valuesGrid.className = 'grid grid-cols-1 gap-3 sm:grid-cols-3';
  form.appendChild(valuesGrid);

  const precoField = document.createElement('label');
  precoField.className = 'grid gap-1';
  valuesGrid.appendChild(precoField);

  const precoLabel = document.createElement('span');
  precoLabel.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
  precoLabel.textContent = 'Preço venda';
  precoField.appendChild(precoLabel);

  const precoInput = document.createElement('input');
  precoInput.type = 'number';
  precoInput.inputMode = 'decimal';
  precoInput.min = '0';
  precoInput.step = '0.01';
  precoInput.className =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  precoField.appendChild(precoInput);

  const qtdField = document.createElement('label');
  qtdField.className = 'grid gap-1';
  valuesGrid.appendChild(qtdField);

  const qtdLabel = document.createElement('span');
  qtdLabel.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
  qtdLabel.textContent = 'Qtd';
  qtdField.appendChild(qtdLabel);

  const qtdInput = document.createElement('input');
  qtdInput.type = 'text';
  qtdInput.inputMode = 'decimal';
  qtdInput.value = '1,000';
  qtdInput.className =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  qtdField.appendChild(qtdInput);

  const totalField = document.createElement('label');
  totalField.className = 'grid gap-1';
  valuesGrid.appendChild(totalField);

  const totalLabel = document.createElement('span');
  totalLabel.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
  totalLabel.textContent = 'Valor total';
  totalField.appendChild(totalLabel);

  const totalInput = document.createElement('input');
  totalInput.type = 'text';
  totalInput.readOnly = true;
  totalInput.className =
    'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 shadow-sm';
  totalField.appendChild(totalInput);

  const footer = document.createElement('div');
  footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className =
    'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeVendasTooltip();
  });
  footer.appendChild(cancelBtn);

  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className =
    'w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:w-auto';
  addBtn.textContent = 'Adicionar';
  footer.appendChild(addBtn);

  precoInput.addEventListener('input', updateVendasTotal);
  qtdInput.addEventListener('input', updateVendasTotal);
  qtdInput.addEventListener('blur', () => {
    const parsed = parseNumber(qtdInput.value);
    qtdInput.value = formatQuantity(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    updateVendasTotal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const clienteId = normalizeId(state.selectedCliente?._id);
    const petId = normalizeId(state.selectedPetId);
    const appointmentId = normalizeId(state.agendaContext?.appointmentId);
    if (!(clienteId && petId && appointmentId)) {
      notify('Abra a ficha pela agenda para registrar vendas.', 'warning');
      return;
    }

    const nomeProduto = (produtoInput.value || '').trim();
    const quantidade = parseNumber(qtdInput.value);
    if (!nomeProduto) {
      notify('Informe o produto para adicionar.', 'warning');
      return;
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      notify('Informe uma quantidade válida.', 'warning');
      return;
    }

    const valorUnitario = parseNumber(precoInput.value);
    const produtoId = normalizeId(vendasTooltip.selectedProduct?._id || vendasTooltip.selectedProduct?.id);

    const payload = {
      clienteId,
      petId,
      appointmentId,
      produtoId: produtoId || undefined,
      produtoNome: nomeProduto,
      valorUnitario,
      quantidade,
    };

    try {
      const response = await api('/func/vet/vendas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => (response.ok ? {} : {}));
      if (!response.ok) {
        const message = typeof data?.message === 'string' ? data.message : 'Erro ao adicionar venda.';
        throw new Error(message);
      }

      const record = normalizeVendaRecord(data) || {
        id: `venda-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        nome: nomeProduto,
        valorUnitario,
        quantidade,
        subtotal: valorUnitario * quantidade,
      };
      addVendaItem(record);
      emitFichaClinicaUpdate({
        scope: 'venda',
        action: 'create',
        vendaId: record.id || record._id || null,
        venda: record,
      }).catch(() => {});

      notify('Produto adicionado nas vendas.', 'success');
      produtoInput.value = '';
      precoInput.value = '';
      qtdInput.value = '1,000';
      vendasTooltip.selectedProduct = null;
      updateVendasTotal();
      produtoInput.focus();
    } catch (error) {
      console.error('addVendaItem', error);
      notify(error.message || 'Erro ao adicionar venda.', 'error');
    }
  });

  document.body.appendChild(container);

  vendasTooltip.container = container;
  vendasTooltip.arrow = arrow;
  vendasTooltip.form = form;
  vendasTooltip.produtoInput = produtoInput;
  vendasTooltip.precoInput = precoInput;
  vendasTooltip.qtdInput = qtdInput;
  vendasTooltip.totalInput = totalInput;
  vendasTooltip.addBtn = addBtn;
  vendasTooltip.cancelBtn = cancelBtn;

  updateVendasTotal();

  return vendasTooltip;
}

function positionVendasTooltip() {
  const btn = els.openVendasBtn;
  if (!btn || !vendasTooltip.container) return;

  const rect = btn.getBoundingClientRect();
  const container = vendasTooltip.container;
  const padding = 16;
  const top = rect.bottom + 12;

  container.style.top = `${top}px`;
  container.style.left = `${Math.max(rect.right - padding, padding)}px`;

  const tooltipRect = container.getBoundingClientRect();
  let left = rect.right - tooltipRect.width;
  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = window.innerWidth - tooltipRect.width - padding;
  }
  if (left < padding) left = padding;
  container.style.left = `${left}px`;

  const arrowLeft = Math.min(Math.max(rect.right - left - 16, 16), tooltipRect.width - 32);
  if (vendasTooltip.arrow) {
    vendasTooltip.arrow.style.left = `${arrowLeft}px`;
  }
}

export function closeVendasTooltip() {
  if (!vendasTooltip.container) return;
  vendasTooltip.container.classList.add('hidden');
  closeProductSearchModal();
  if (vendasTooltip.form) vendasTooltip.form.reset();
  vendasTooltip.selectedProduct = null;
  if (vendasTooltip.qtdInput) vendasTooltip.qtdInput.value = '1,000';
  updateVendasTotal();

  if (vendasTooltip.outsideHandler) {
    document.removeEventListener('click', vendasTooltip.outsideHandler);
    vendasTooltip.outsideHandler = null;
  }
  if (vendasTooltip.keydownHandler) {
    document.removeEventListener('keydown', vendasTooltip.keydownHandler);
    vendasTooltip.keydownHandler = null;
  }
  if (vendasTooltip.repositionHandler) {
    window.removeEventListener('resize', vendasTooltip.repositionHandler);
    window.removeEventListener('scroll', vendasTooltip.repositionHandler, true);
    vendasTooltip.repositionHandler = null;
  }
}

export function openVendasTooltip() {
  const btn = els.openVendasBtn;
  if (!btn) return;
  if (btn.getAttribute('aria-disabled') === 'true') return;

  const tooltip = ensureVendasTooltip();
  tooltip.container.classList.remove('hidden');
  tooltip.selectedProduct = null;

  positionVendasTooltip();
  if (tooltip.produtoInput) {
    tooltip.produtoInput.focus();
  }

  if (tooltip.outsideHandler) {
    document.removeEventListener('click', tooltip.outsideHandler);
  }
  tooltip.outsideHandler = (event) => {
    if (!tooltip.container) return;
    if (event.target === btn || btn.contains(event.target)) return;
    if (tooltip.container.contains(event.target)) return;
    if (productSearchModal.overlay && productSearchModal.overlay.contains(event.target)) return;
    closeVendasTooltip();
  };
  document.addEventListener('click', tooltip.outsideHandler);

  if (tooltip.keydownHandler) {
    document.removeEventListener('keydown', tooltip.keydownHandler);
  }
  tooltip.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeVendasTooltip();
    }
  };
  document.addEventListener('keydown', tooltip.keydownHandler);

  if (tooltip.repositionHandler) {
    window.removeEventListener('resize', tooltip.repositionHandler);
    window.removeEventListener('scroll', tooltip.repositionHandler, true);
  }
  tooltip.repositionHandler = () => positionVendasTooltip();
  window.addEventListener('resize', tooltip.repositionHandler);
  window.addEventListener('scroll', tooltip.repositionHandler, true);
}

export function initVendasTooltip() {
  const btn = els.openVendasBtn;
  if (!btn) return;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    openVendasTooltip();
  });
}
