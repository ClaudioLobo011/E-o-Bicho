document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('my-orders-list');
  const empty = document.getElementById('my-orders-empty');
  if (!list) return;

  const auth = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
  if (!auth?.token) {
    if (empty) empty.classList.remove('hidden');
    return;
  }

  loadOrders(auth.token);

  async function loadOrders(token) {
    try {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/orders/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.message || 'Falha ao carregar pedidos.');
      const orders = Array.isArray(data?.orders) ? data.orders : Array.isArray(data) ? data : [];
      if (!orders.length) {
        if (empty) empty.classList.remove('hidden');
        list.innerHTML = '';
        return;
      }
      renderOrders(orders);
    } catch (error) {
      console.error('[meus-pedidos] load', error);
      if (empty) {
        empty.textContent = 'Nao foi possivel carregar seus pedidos.';
        empty.classList.remove('hidden');
      }
    }
  }

  function renderOrders(orders) {
    list.innerHTML = orders.map((order) => buildOrderCard(order)).join('');
    if (empty) empty.classList.add('hidden');
  }

  function buildOrderCard(order) {
    const code = escapeHtml(order?.number || order?.code || order?._id || '-');
    const createdAt = formatDateTime(order?.createdAt);
    const status = escapeHtml(order?.status || 'RECEBIDO');
    const paymentStatus = escapeHtml(order?.payment?.status || '');
    const paymentMethod = escapeHtml(order?.payment?.method || '');
    const customer = order?.customer || {};
    const address = customer?.address || {};
    const items = Array.isArray(order?.items) ? order.items : [];
    const totals = order?.totals || {};
    const totalValue = formatCurrency(totals.total || order?.total || 0);

    const customerName = escapeHtml(customer?.name || '-');
    const customerEmail = escapeHtml(customer?.email || '');
    const customerPhone = escapeHtml(customer?.phone || '');

    const addressLine1 = escapeHtml([address?.logradouro, address?.numero].filter(Boolean).join(', '));
    const addressLine2 = escapeHtml([address?.bairro, address?.cidade, address?.uf].filter(Boolean).join(' - '));
    const addressLine3 = address?.cep ? `CEP: ${escapeHtml(address.cep)}` : '';

    const maxItems = 2;
    const visibleItems = items.slice(0, maxItems);
    const remainingItems = Math.max(items.length - visibleItems.length, 0);

    const itemsHtml = visibleItems.length
      ? visibleItems.map((item) => {
          const name = escapeHtml(item?.name || item?.produto || '-');
          const qty = Number(item?.quantity || item?.quantidade || 0);
          const unitPrice = formatCurrency(item?.unitPrice || item?.valorUnitario || 0);
          const total = formatCurrency(item?.total || item?.valorTotal || 0);
          return `
            <li class="flex items-start justify-between gap-3 py-1 text-xs">
              <div>
                <p class="font-semibold text-gray-800 truncate">${name}</p>
                <p class="text-[11px] text-gray-500">Qtd: ${qty} | ${unitPrice} un.</p>
              </div>
              <div class="text-right font-semibold text-gray-800">${total}</div>
            </li>
          `;
        }).join('')
      : '<li class="py-1 text-xs text-gray-500">Nenhum item registrado.</li>';

    const moreItemsHtml = remainingItems
      ? `<li class="py-1 text-[11px] text-gray-500">+ ${remainingItems} item(s)</li>`
      : '';

    return `
      <article class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-[180px]">
            <p class="text-[11px] uppercase text-gray-500">Pedido</p>
            <p class="text-base font-semibold text-gray-800">${code}</p>
            <p class="text-[11px] text-gray-500">${createdAt}</p>
          </div>
          <div class="text-right space-y-1">
            <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">${status}</span>
            <p class="text-sm font-semibold text-gray-800">${totalValue}</p>
            <p class="text-[11px] text-gray-500">Pagamento: ${paymentStatus || '-'}</p>
            <p class="text-[11px] text-gray-500">Metodo: ${paymentMethod || '-'}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-700">
          <div class="space-y-0.5">
            <p class="text-[11px] uppercase text-gray-500">Cliente</p>
            <p class="truncate">${customerName}</p>
            ${customerEmail ? `<p class="truncate">${customerEmail}</p>` : ''}
            ${customerPhone ? `<p>${customerPhone}</p>` : ''}
          </div>
          <div class="space-y-0.5">
            <p class="text-[11px] uppercase text-gray-500">Endereco</p>
            ${addressLine1 ? `<p class="truncate">${addressLine1}</p>` : '<p>-</p>'}
            ${addressLine2 ? `<p class="truncate">${addressLine2}</p>` : ''}
            ${addressLine3 ? `<p class="text-[11px] text-gray-500">${addressLine3}</p>` : ''}
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between">
            <p class="text-[11px] uppercase text-gray-500">Produtos</p>
            <p class="text-[11px] text-gray-500">${items.length} item(s)</p>
          </div>
          <ul class="divide-y divide-gray-100 mt-1">${itemsHtml}${moreItemsHtml}</ul>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-700 rounded-md bg-gray-50 p-2">
          <div>
            <p class="text-[11px] uppercase text-gray-500">Subtotal</p>
            <p class="font-semibold">${formatCurrency(totals.subtotal || 0)}</p>
          </div>
          <div>
            <p class="text-[11px] uppercase text-gray-500">Descontos</p>
            <p class="font-semibold">${formatCurrency(totals.discounts || 0)}</p>
          </div>
          <div>
            <p class="text-[11px] uppercase text-gray-500">Entrega</p>
            <p class="font-semibold">${formatCurrency(totals.deliveryCost || 0)}</p>
          </div>
          <div>
            <p class="text-[11px] uppercase text-gray-500">Total</p>
            <p class="font-semibold">${totalValue}</p>
          </div>
        </div>
      </article>
    `;
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

  function escapeHtml(value) {
    const text = String(value || '');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
});
