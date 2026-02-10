document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = API_CONFIG?.BASE_URL || '';

  const elements = {
    form: document.getElementById('web-orders-filters'),
    resetBtn: document.getElementById('web-orders-reset'),
    refreshBtn: document.getElementById('web-orders-refresh'),
    exportBtn: document.getElementById('web-orders-export'),
    feedback: document.getElementById('web-orders-feedback'),
    resultsCount: document.getElementById('web-orders-results-count'),
    cardsContainer: document.getElementById('web-orders-cards'),
    storeSelect: document.getElementById('web-orders-store'),
    countReceived: document.getElementById('web-orders-count-received'),
    countPending: document.getElementById('web-orders-count-pending'),
    countPaid: document.getElementById('web-orders-count-paid'),
    countTotal: document.getElementById('web-orders-count-total'),
  };

  if (!elements.cardsContainer) return;

  const state = {
    orders: [],
  };

  const ORDER_STATUS_FLOW = [
    'RECEBIDO',
    'AGUARDANDO_PAGAMENTO',
    'PAGO',
    'EM_SEPARACAO',
    'PRONTO_PARA_ENVIO',
    'ENVIADO',
    'CONCLUIDO',
    'CANCELADO',
    'DEVOLVIDO',
  ];

  const PAYMENT_CONFIRMED = ['approved', 'paid', 'pago', 'confirmed'];
  const FISCAL_APPROVED = ['autorizada', 'authorized', 'approved', 'emitida', 'validada'];
  let socket = null;
  let socketScriptPromise = null;

  init();

  function init() {
    bindEvents();
    loadStores();
    setDefaultDates();
    loadOrders();
    initSocket();
  }

  function bindEvents() {
    elements.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      loadOrders();
    });

    elements.resetBtn?.addEventListener('click', () => {
      elements.form?.reset();
      loadOrders();
    });

    elements.refreshBtn?.addEventListener('click', () => loadOrders());
    elements.exportBtn?.addEventListener('click', () => notify('Exportacao em configuracao.', 'info'));

    elements.cardsContainer.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      const card = actionEl.closest('[data-order-card]');
      const orderId = card?.getAttribute('data-order-id') || '';
      if (!orderId) return;

      const action = actionEl.getAttribute('data-action') || '';
      if (action === 'order-status-save') {
        const select = card.querySelector('[data-action="order-status"]');
        const nextStatus = select?.value || 'RECEBIDO';
        updateStatusForOrder(orderId, nextStatus);
        return;
      }
      if (action === 'order-payment-retry') {
        notify('Reprocessamento solicitado.', 'info');
        return;
      }
      if (action === 'order-payment-refund') {
        confirmAction('Registrar estorno?', 'Estorno solicitado.');
        return;
      }
      if (action === 'order-fiscal-generate') {
        notify('Geracao fiscal em configuracao.', 'info');
        return;
      }
      if (action === 'order-fiscal-nfe') {
        notify('NF-e em configuracao.', 'info');
        return;
      }
      if (action === 'order-fiscal-nfce') {
        notify('NFC-e em configuracao.', 'info');
        return;
      }
      if (action === 'order-fiscal-remessa') {
        notify('Nota de remessa em configuracao.', 'info');
        return;
      }
      if (action === 'order-fiscal-xml') {
        notify('Download de XML em configuracao.', 'info');
        return;
      }
      if (action === 'order-fiscal-danfe') {
        notify('Download de DANFE em configuracao.', 'info');
        return;
      }
      if (action === 'order-fiscal-devolucao') {
        notify('Nota de devolucao em configuracao.', 'info');
        return;
      }
      if (action === 'order-logistics-label') {
        notify('Etiqueta em configuracao.', 'info');
        return;
      }
      if (action === 'order-shipping-label') {
        notify('Etiqueta de transporte em configuracao.', 'info');
        return;
      }
      if (action === 'order-picking-label') {
        notify('Etiqueta interna em configuracao.', 'info');
        return;
      }
      if (action === 'order-shipping-register') {
        confirmAction('Registrar envio?', 'Envio registrado.');
      }
    });
  }

  function getToken() {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  }

  function authHeaders(json = false) {
    const token = getToken();
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  function notify(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type, 3200);
    }
  }

  function getServerBaseUrl() {
    let base = '';
    try {
      if (typeof API_CONFIG !== 'undefined' && API_CONFIG && typeof API_CONFIG.SERVER_URL === 'string') {
        base = API_CONFIG.SERVER_URL;
      }
    } catch (_) {
      // ignore
    }
    if (!base && typeof window !== 'undefined') {
      const cfg = window.API_CONFIG;
      if (cfg && typeof cfg.SERVER_URL === 'string') {
        base = cfg.SERVER_URL;
      }
    }
    if (!base && typeof window !== 'undefined' && window.location) {
      base = window.location.origin;
    }
    return String(base || '').replace(/\/+$/, '');
  }

  function ensureSocketIoScript() {
    if (typeof window === 'undefined') return Promise.resolve();
    if (typeof window.io === 'function') return Promise.resolve();
    if (socketScriptPromise) return socketScriptPromise;

    const baseUrl = getServerBaseUrl();
    const src = baseUrl ? `${baseUrl}/socket.io/socket.io.js` : '/socket.io/socket.io.js';
    socketScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = (event) => {
        console.warn('web-orders:socket:load', event);
        socketScriptPromise = null;
        reject(new Error('socket-io-load-failed'));
      };
      document.head.appendChild(script);
    });
    return socketScriptPromise;
  }

  function initSocket() {
    if (socket) return;
    ensureSocketIoScript()
      .then(() => {
        const baseUrl = getServerBaseUrl();
        if (typeof window.io !== 'function') return;
        socket = window.io(baseUrl || undefined, { transports: ['websocket', 'polling'] });
        socket.on('web-orders:new', (payload = {}) => {
          if (payload?.origin && payload.origin !== 'ECOMMERCE') return;
          loadOrders();
        });
      })
      .catch(() => {});
  }

  function setFeedback(message, tone = 'info') {
    if (!elements.feedback) return;
    const toneClass = tone === 'error' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-gray-500';
    elements.feedback.className = `text-xs ${toneClass}`;
    elements.feedback.textContent = message || '';
  }

  function formatCurrency(value) {
    const numberValue = Number(value || 0);
    if (!Number.isFinite(numberValue)) return 'R$ 0,00';
    return numberValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pt-BR');
  }

  function formatDateInput(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setDefaultDates() {
    const today = formatDateInput(new Date());
    const startInput = document.getElementById('web-orders-start');
    const endInput = document.getElementById('web-orders-end');
    if (startInput && !startInput.value) startInput.value = today;
    if (endInput && !endInput.value) endInput.value = today;
  }

  function formatText(value, fallback = '-') {
    const text = value === null || value === undefined ? '' : String(value).trim();
    return text || fallback;
  }

  function formatAddress(address) {
    if (!address) return '-';
    if (typeof address === 'string') return formatText(address);
    const line1 = [address.logradouro || address.street, address.numero || address.number].filter(Boolean).join(', ');
    const line2 = [address.bairro, address.cidade || address.city, address.uf || address.state].filter(Boolean).join(' - ');
    const cep = address.cep ? `CEP: ${address.cep}` : '';
    const parts = [line1, line2, cep].filter(Boolean);
    return parts.length ? parts.join(' | ') : '-';
  }

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function resolveOrderId(order) {
    return formatText(order?.numero || order?.number || order?.orderNumber || order?.id || order?._id);
  }

  function resolveOrderStatus(order) {
    return formatText(order?.status || order?.orderStatus || order?.situacao || 'RECEBIDO');
  }

  function resolvePaymentStatus(order) {
    return formatText(order?.payment?.status || order?.paymentStatus || order?.pagamentoStatus);
  }

  function resolveFiscalStatus(order) {
    return formatText(order?.fiscal?.status || order?.fiscalStatus || order?.notaStatus);
  }

  function resolvePaymentMethod(order) {
    const raw = normalize(order?.payment?.method || order?.paymentMethod || order?.formaPagamento);
    const map = { card: 'Cartao', credit_card: 'Cartao', debit_card: 'Cartao', pix: 'Pix', boleto: 'Boleto' };
    return map[raw] || formatText(order?.payment?.method || order?.paymentMethod || order?.formaPagamento);
  }

  function resolveDeliveryType(order) {
    const raw = normalize(order?.delivery?.type || order?.shipping?.type || order?.tipoEntrega);
    const map = { entrega: 'Entrega', delivery: 'Entrega', retirada: 'Retirada', pickup: 'Retirada' };
    return map[raw] || formatText(order?.delivery?.type || order?.shipping?.type || order?.tipoEntrega);
  }

  function resolveStoreName(order) {
    return formatText(order?.store?.nome || order?.store?.name || order?.loja || order?.filial);
  }

  function resolveCustomer(order) {
    const addressRaw = order?.customer?.address || order?.cliente?.endereco || order?.address || null;
    return {
      name: formatText(order?.customer?.name || order?.cliente?.nome || order?.customerName),
      document: formatText(order?.customer?.document || order?.cliente?.documento || order?.cpfCnpj),
      phone: formatText(order?.customer?.phone || order?.cliente?.telefone || order?.telefone),
      email: formatText(order?.customer?.email || order?.cliente?.email),
      address: formatAddress(addressRaw),
      type: formatText(order?.customer?.type || order?.cliente?.tipo || order?.tipoCliente),
      city: formatText(order?.customer?.city || order?.cliente?.cidade || addressRaw?.cidade || addressRaw?.city),
      state: formatText(order?.customer?.state || order?.cliente?.uf || addressRaw?.uf || addressRaw?.state),
    };
  }

  function resolveTotals(order) {
    return Number(order?.total || order?.totalAmount || order?.valorTotal || 0);
  }

  function paymentConfirmed(order) {
    const status = normalize(resolvePaymentStatus(order));
    return PAYMENT_CONFIRMED.includes(status);
  }

  function fiscalApproved(order) {
    const status = normalize(resolveFiscalStatus(order));
    return FISCAL_APPROVED.includes(status);
  }

  function updateCounters() {
    const orders = state.orders || [];
    const received = orders.filter((order) => resolveOrderStatus(order) === 'RECEBIDO').length;
    const pending = orders.filter((order) => normalize(resolvePaymentStatus(order)) === 'pending').length;
    const paid = orders.filter((order) => paymentConfirmed(order)).length;
    const total = orders.reduce((sum, order) => sum + resolveTotals(order), 0);

    if (elements.countReceived) elements.countReceived.textContent = String(received);
    if (elements.countPending) elements.countPending.textContent = String(pending);
    if (elements.countPaid) elements.countPaid.textContent = String(paid);
    if (elements.countTotal) elements.countTotal.textContent = formatCurrency(total);
    if (elements.resultsCount) elements.resultsCount.textContent = `${orders.length} pedidos`;
  }

  async function loadStores() {
    if (!elements.storeSelect || !API_BASE) return;
    elements.storeSelect.disabled = true;
    elements.storeSelect.innerHTML = '<option value=\"\">Carregando...</option>';
    try {
      const resp = await fetch(`${API_BASE}/stores/allowed`, { headers: authHeaders(false) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.message || 'Falha ao carregar lojas.');
      const stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
      if (!stores.length) {
        elements.storeSelect.innerHTML = '<option value=\"\">Nenhuma loja vinculada</option>';
        return;
      }
      const options = ['<option value=\"\">Todas as lojas</option>'];
      stores.forEach((store) => {
        const label = store?.nome || store?.razaoSocial || store?.nomeFantasia || 'Loja';
        options.push(`<option value=\"${store._id}\">${label}</option>`);
      });
      elements.storeSelect.innerHTML = options.join('');
    } catch (error) {
      console.warn('web-orders:stores', error);
      elements.storeSelect.innerHTML = '<option value=\"\">Erro ao carregar lojas</option>';
    } finally {
      elements.storeSelect.disabled = false;
    }
  }

  function buildFilters() {
    const params = new URLSearchParams();
    params.set('origin', 'ECOMMERCE');
    const form = elements.form;
    if (!form) return params;

    const map = [
      ['web-orders-start', 'startDate'],
      ['web-orders-end', 'endDate'],
      ['web-orders-status', 'orderStatus'],
      ['web-orders-payment-status', 'paymentStatus'],
      ['web-orders-payment-method', 'paymentMethod'],
      ['web-orders-delivery-type', 'deliveryType'],
      ['web-orders-customer', 'customer'],
      ['web-orders-number', 'orderNumber'],
      ['web-orders-invoice', 'invoiceNumber'],
      ['web-orders-store', 'storeId'],
    ];

    map.forEach(([id, key]) => {
      const value = form.querySelector(`#${id}`)?.value?.trim();
      if (value) params.set(key, value);
    });

    return params;
  }

  async function loadOrders() {
    setFeedback('Carregando pedidos...', 'info');
    elements.cardsContainer.innerHTML = '<div class=\"rounded-xl border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500\">Carregando pedidos...</div>';

    if (!API_BASE) {
      state.orders = [];
      renderOrders();
      setFeedback('API nao configurada.', 'warning');
      return;
    }

    try {
      const params = buildFilters();
      const resp = await fetch(`${API_BASE}/orders/web?${params.toString()}`, {
        headers: authHeaders(false),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Nao foi possivel carregar pedidos.');
      }
      const orders = Array.isArray(data?.orders) ? data.orders : Array.isArray(data) ? data : [];
      state.orders = orders || [];
      renderOrders();
      setFeedback('', 'info');
    } catch (error) {
      console.warn('web-orders:load', error);
      state.orders = [];
      renderOrders('Nenhum pedido ecommerce carregado.');
      setFeedback('Nao foi possivel consultar pedidos. Verifique a integracao.', 'warning');
    }
  }

  function renderOrders(emptyMessage) {
    const orders = state.orders || [];
    updateCounters();

    if (!orders.length) {
      elements.cardsContainer.innerHTML = `<div class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">${emptyMessage || 'Nenhum pedido ecommerce carregado.'}</div>`;
      return;
    }

    elements.cardsContainer.innerHTML = orders.map((order) => buildOrderCard(order)).join('');
  }

  function buildOrderCard(order) {
    const id = resolveOrderId(order);
    const status = resolveOrderStatus(order);
    const paymentStatus = resolvePaymentStatus(order);
    const fiscalStatus = resolveFiscalStatus(order);
    const paymentMethod = resolvePaymentMethod(order);
    const deliveryType = resolveDeliveryType(order);
    const storeName = resolveStoreName(order);
    const createdAt = formatDateTime(order?.createdAt || order?.dataCriacao);
    const customer = resolveCustomer(order);
    const cityUf = `${customer.city || '-'} / ${customer.state || '-'}`;
    const total = formatCurrency(resolveTotals(order));
    const items = Array.isArray(order?.items) ? order.items : Array.isArray(order?.itens) ? order.itens : [];
    const paymentId = formatText(order?.payment?.id || order?.paymentId || order?.transacaoId || '-');
    const paymentAmount = formatCurrency(order?.payment?.amount || order?.valorPago || 0);
    const paymentFees = formatCurrency(order?.payment?.fees || order?.taxas || 0);
    const paymentGateway = formatText(order?.payment?.gateway || order?.gateway || 'Mercado Pago');
    const fiscalNumber = formatText(order?.fiscal?.numero || order?.notaNumero || '-');
    const fiscalKey = formatText(order?.fiscal?.chave || order?.notaChave || '-');
    const shippingCarrier = formatText(order?.shipping?.carrier || order?.transportadora || '-');
    const shippingTracking = formatText(order?.shipping?.tracking || order?.codigoRastreio || '-');
    const deliveryCost = formatCurrency(order?.delivery?.cost || order?.valorFrete || 0);
    const blockedMessage = buildBlockedMessage(order);
    const statusOptions = buildStatusOptions(status);
    const orderUser = formatText(order?.user?.name || order?.usuario || 'Sistema');
    const orderNotes = formatText(order?.notes || order?.observacoes || 'Sem observacoes.');
    const stockReserved = formatText(order?.stock?.reserved || order?.estoque?.reservado || 'Nao aplicado');
    const stockReleased = formatText(order?.stock?.released || order?.estoque?.baixado || 'Nao aplicado');
    const stockRollback = formatText(order?.stock?.rollback || order?.estoque?.estornado || 'Nao aplicado');
    const historyHtml = buildHistoryHtml(order?.history || order?.historico || []);

    const itemsHtml = items.length
      ? items.map((item) => {
          const qty = Number(item?.quantidade ?? item?.qty ?? item?.quantity ?? 0);
          const unitPrice = Number(item?.valorUnitario ?? item?.price ?? item?.unitPrice ?? 0);
          const itemTotal = Number(item?.total ?? item?.valorTotal ?? item?.totalValue ?? qty * unitPrice ?? 0);
          return `
            <li class="flex items-start justify-between gap-3 py-1 text-xs text-gray-700">
              <div>
                <p class="font-semibold text-gray-800">${formatText(item?.produto || item?.name || item?.descricao)}</p>
                <p class="text-[11px] text-gray-500">Qtd: ${qty} | ${formatCurrency(unitPrice)} un.</p>
              </div>
              <div class="text-right font-semibold text-gray-800">${formatCurrency(itemTotal)}</div>
            </li>
          `;
        }).join('')
      : '<li class="py-1 text-xs text-gray-500">Nenhum item registrado.</li>';

    return `
      <details class="group rounded-xl border border-gray-100 bg-white shadow-sm" data-order-card data-order-id="${id}">
        <summary class="flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer list-none">
          <div class="min-w-[140px]">
            <p class="text-[10px] uppercase text-gray-500">Pedido</p>
            <p class="text-sm font-semibold text-gray-800">${id}</p>
          </div>
          <div class="min-w-[180px] flex-1">
            <p class="text-[10px] uppercase text-gray-500">Cliente</p>
            <p class="text-sm text-gray-800 truncate">${customer.name}</p>
          </div>
          <div class="min-w-[120px]">
            <p class="text-[10px] uppercase text-gray-500">Status</p>
            <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">${status}</span>
          </div>
          <div class="min-w-[120px] text-right">
            <p class="text-[10px] uppercase text-gray-500">Valor</p>
            <p class="text-sm font-semibold text-gray-800">${total}</p>
          </div>
          <div class="min-w-[140px]">
            <p class="text-[10px] uppercase text-gray-500">Pagamento</p>
            <p class="text-sm text-gray-800">${paymentMethod || '-'}</p>
          </div>
          <div class="ml-auto text-gray-400">
            <i class="fas fa-chevron-down transition group-open:rotate-180"></i>
          </div>
        </summary>

        <div class="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          ${blockedMessage ? `<div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">${blockedMessage}</div>` : ''}

          <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-gray-700">Atualizar status</label>
              <select data-action="order-status" class="rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-primary focus:ring-2 focus:ring-primary/20">
                ${statusOptions}
              </select>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" data-action="order-status-save" class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-secondary transition">
                <i class="fas fa-check"></i>
                Salvar status
              </button>
              <button type="button" data-action="order-logistics-label" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
                <i class="fas fa-barcode text-primary"></i>
                Gerar etiqueta
              </button>
              <button type="button" data-action="order-fiscal-generate" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
                <i class="fas fa-file-invoice text-primary"></i>
                Emitir nota fiscal
              </button>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span>Data: ${createdAt}</span>
            <span>Loja: ${storeName}</span>
            <span>Cidade/UF: ${cityUf}</span>
            <span>Entrega: ${deliveryType || '-'}</span>
            <span>Fiscal: ${fiscalStatus || '-'}</span>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 text-xs text-gray-700">
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-1">
              <p class="text-[11px] uppercase text-gray-500">Dados do cliente</p>
              <p>${customer.name}</p>
              <p>${customer.document}</p>
              <p>${customer.phone}</p>
              <p>${customer.email}</p>
              <p>${customer.address}</p>
            </div>
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-1">
              <p class="text-[11px] uppercase text-gray-500">Dados gerais</p>
              <p>Pedido: ${id}</p>
              <p>Origem: ECOMMERCE</p>
              <p>Loja: ${storeName}</p>
              <p>Usuario: ${orderUser}</p>
              <p>Observacoes: ${orderNotes}</p>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between">
              <p class="text-[11px] uppercase text-gray-500">Itens do pedido</p>
              <p class="text-[11px] text-gray-500">${items.length} item(s)</p>
            </div>
            <ul class="divide-y divide-gray-100 mt-2">${itemsHtml}</ul>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-700 rounded-lg bg-gray-50 p-3">
            <div>
              <p class="text-[11px] uppercase text-gray-500">Reserva</p>
              <p>${stockReserved}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase text-gray-500">Baixa definitiva</p>
              <p>${stockReleased}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase text-gray-500">Estorno</p>
              <p>${stockRollback}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs text-gray-700">
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[11px] uppercase text-gray-500">Financeiro</p>
                <div class="flex flex-wrap gap-2">
                  <button type="button" data-action="order-payment-retry" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                    <i class="fas fa-rotate text-primary"></i>
                    Reprocessar
                  </button>
                  <button type="button" data-action="order-payment-refund" class="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 transition">
                    <i class="fas fa-undo"></i>
                    Estornar
                  </button>
                </div>
              </div>
              <p>Gateway: ${paymentGateway}</p>
              <p>Status: ${paymentStatus || '-'}</p>
              <p>Transacao: ${paymentId}</p>
              <p>Valor pago: ${paymentAmount}</p>
              <p>Taxas: ${paymentFees}</p>
            </div>
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[11px] uppercase text-gray-500">Fiscal</p>
                <div class="flex flex-wrap gap-2">
                  <button type="button" data-action="order-fiscal-nfe" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                    NF-e
                  </button>
                  <button type="button" data-action="order-fiscal-nfce" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                    NFC-e
                  </button>
                  <button type="button" data-action="order-fiscal-xml" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                    XML
                  </button>
                </div>
              </div>
              <p>Status: ${fiscalStatus || '-'}</p>
              <p>Numero: ${fiscalNumber}</p>
              <p>Chave: ${fiscalKey}</p>
            </div>
          </div>

          <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2 text-xs text-gray-700">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11px] uppercase text-gray-500">Logistica</p>
              <div class="flex flex-wrap gap-2">
                <button type="button" data-action="order-shipping-label" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                  Etiqueta transporte
                </button>
                <button type="button" data-action="order-picking-label" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                  Etiqueta interna
                </button>
                <button type="button" data-action="order-shipping-register" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition">
                  Registrar envio
                </button>
              </div>
            </div>
            <p>Transportadora: ${shippingCarrier}</p>
            <p>Rastreio: ${shippingTracking}</p>
            <p>Frete: ${deliveryCost}</p>
          </div>

          <div class="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700 space-y-2">
            <p class="text-[11px] uppercase text-gray-500">Historico e auditoria</p>
            ${historyHtml}
          </div>
        </div>
      </details>
    `;
  }

  function buildStatusOptions(currentStatus) {
    const labels = {
      RECEBIDO: 'Recebido',
      AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
      PAGO: 'Pago',
      EM_SEPARACAO: 'Em separacao',
      PRONTO_PARA_ENVIO: 'Pronto para envio',
      ENVIADO: 'Enviado',
      CONCLUIDO: 'Concluido',
      CANCELADO: 'Cancelado',
      DEVOLVIDO: 'Devolvido',
    };
    return ORDER_STATUS_FLOW.map((status) => {
      const selected = status === currentStatus ? ' selected' : '';
      return `<option value="${status}"${selected}>${labels[status] || status}</option>`;
    }).join('');
  }

  function buildBlockedMessage(order) {
    const status = resolveOrderStatus(order);
    const requiresPayment = ['EM_SEPARACAO', 'PRONTO_PARA_ENVIO', 'ENVIADO', 'CONCLUIDO'];
    const requiresFiscal = ['ENVIADO', 'CONCLUIDO'];
    const blockedPayment = requiresPayment.includes(status) && !paymentConfirmed(order);
    const blockedFiscal = requiresFiscal.includes(status) && !fiscalApproved(order) && order?.fiscalRequired !== false;
    if (blockedPayment || blockedFiscal) {
      return 'Pedido bloqueado para envio: pagamento pendente ou documento fiscal ausente.';
    }
    return '';
  }

  function buildHistoryHtml(history) {
    const items = Array.isArray(history) ? history : [];
    if (!items.length) {
      return '<p class="text-gray-500">Nenhum historico registrado.</p>';
    }
    const rows = items.map((entry) => {
      const time = formatDateTime(entry?.date || entry?.createdAt);
      const actor = formatText(entry?.user || entry?.usuario || 'Sistema');
      const description = formatText(entry?.description || entry?.acao || entry?.message);
      return `
        <li class="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div class="text-[11px] text-gray-500">${time} - ${actor}</div>
          <div class="font-semibold text-gray-700">${description}</div>
        </li>
      `;
    }).join('');
    return `<ul class="space-y-2">${rows}</ul>`;
  }

  function updateStatusForOrder(orderId, nextStatus) {
    const order = state.orders.find((item) => resolveOrderId(item) === orderId);
    if (!order) {
      notify('Selecione um pedido para atualizar.', 'warning');
      return;
    }
    const blockMessage = validateStatusChange(order, nextStatus);
    if (blockMessage) {
      notify(blockMessage, 'warning');
      return;
    }

    const prevStatus = resolveOrderStatus(order);
    order.status = nextStatus;
    if (!order.history) order.history = [];
    order.history.unshift({
      date: new Date().toISOString(),
      user: getLoggedUserName(),
      description: `Status alterado de ${prevStatus} para ${nextStatus}.`,
    });

    if (nextStatus === 'EM_SEPARACAO') {
      order.stock = { ...(order.stock || {}), reserved: 'Reservado' };
    }
    if (nextStatus === 'ENVIADO' || nextStatus === 'CONCLUIDO') {
      order.stock = { ...(order.stock || {}), released: 'Baixa registrada' };
    }
    if (nextStatus === 'CANCELADO' || nextStatus === 'DEVOLVIDO') {
      order.stock = { ...(order.stock || {}), rollback: 'Estorno registrado' };
    }

    notify('Status atualizado.', 'success');
    renderOrders();
  }

  function validateStatusChange(order, nextStatus) {
    const requiresPayment = ['EM_SEPARACAO', 'PRONTO_PARA_ENVIO', 'ENVIADO', 'CONCLUIDO'];
    const requiresFiscal = ['ENVIADO', 'CONCLUIDO'];
    if (requiresPayment.includes(nextStatus) && !paymentConfirmed(order)) {
      return 'Pagamento nao confirmado. Nao e possivel avancar o status.';
    }
    if (requiresFiscal.includes(nextStatus) && !fiscalApproved(order) && order?.fiscalRequired !== false) {
      return 'Documento fiscal obrigatorio pendente.';
    }
    return '';
  }

  function getLoggedUserName() {
    try {
      const user = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
      return user?.nomeCompleto || user?.nome || user?.email || 'Sistema';
    } catch {
      return 'Sistema';
    }
  }

  function confirmAction(question, successMessage) {
    if (typeof window.showModal !== 'function') {
      if (window.confirm(question)) notify(successMessage, 'success');
      return;
    }
    window.showModal({
      title: 'Confirmacao',
      message: question,
      confirmText: 'Confirmar',
      cancelText: 'Cancelar',
      onConfirm: () => {
        notify(successMessage, 'success');
      },
    });
  }
});
