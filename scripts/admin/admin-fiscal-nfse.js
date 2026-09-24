(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labels = { authorized: 'Autorizada', pending: 'Pendente', processing: 'Processando', rejected: 'Rejeitada', unknown: 'Aguardando consulta', cancelled: 'Cancelada' };
  const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  let selected = null;
  let generation = 0;
  async function api(path, options = {}) {
    const user = JSON.parse(localStorage.getItem('loggedInUser') || '{}');
    const token = user.token || localStorage.getItem('token');
    const response = await fetch(`${API_CONFIG.BASE_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Não foi possível consultar as notas.');
    return data;
  }
  async function refresh() {
    const run = ++generation;
    const storeId = $('nfse-store').value;
    $('nfse-detail').classList.add('hidden');
    $('nfse-list').innerHTML = '';
    if (!storeId) { $('nfse-message').textContent = 'Selecione uma empresa para consultar.'; return; }
    $('nfse-message').textContent = 'Consultando documentos...';
    try {
      const query = new URLSearchParams({ storeId, status: $('nfse-status').value, environment: $('nfse-environment').value });
      const data = await api(`/nfse?${query}`);
      if (run !== generation) return;
      const docs = data.documents || [];
      $('nfse-message').textContent = `${docs.length} documento(s) nesta consulta. Valores de homologação não representam faturamento.`;
      $('nfse-list').innerHTML = docs.map((doc) => `<tr><td class="p-3"><strong>${escape(doc.number || 'Aguardando número')}</strong><div class="text-xs text-gray-500">${escape(doc.saleCode || doc.saleId)}</div></td><td class="p-3">${doc.issuedAt ? escape(new Date(doc.issuedAt).toLocaleString('pt-BR')) : '—'}<div class="text-xs text-gray-500">${doc.environment === 'producao' ? 'Produção' : 'Homologação'}</div></td><td class="p-3">${money(doc.total)}</td><td class="p-3">${escape(labels[doc.status] || doc.status)}</td><td class="p-3"><button class="font-semibold text-primary" data-nfse-open="${escape(doc.id || doc._id)}">Ver detalhes</button></td></tr>`).join('');
    } catch (error) { if (run === generation) $('nfse-message').textContent = error.message; }
  }
  function showDetail(doc) {
    selected = doc;
    const panel = $('nfse-detail');
    const reason = typeof doc.error === 'string' ? doc.error : doc.error?.message || '';
    panel.innerHTML = `<h2 class="text-lg font-bold text-gray-800">NFS-e ${escape(doc.number || 'em processamento')}</h2><p class="mt-2 text-sm text-gray-600">${escape(labels[doc.status] || doc.status)} · ${money(doc.total)}</p><dl class="mt-4 space-y-2 text-sm text-gray-700"><div><dt class="font-semibold">Identificador da DPS</dt><dd style="overflow-wrap:anywhere">${escape(doc.dpsId)}</dd></div><div><dt class="font-semibold">Chave de acesso</dt><dd style="overflow-wrap:anywhere">${escape(doc.accessKey || 'Ainda não disponível')}</dd></div></dl>${reason ? `<p class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">${escape(reason)}</p>` : ''}<div class="mt-4 flex flex-wrap gap-3">${/^https:\/\//.test(doc.consultationUrl || '') ? `<a target="_blank" rel="noopener" href="${escape(doc.consultationUrl)}" class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-primary">Visualizar documento</a>` : ''}${doc.xmlContent ? '<button data-nfse-download class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-primary">Baixar XML</button>' : ''}<button data-nfse-reconcile class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-primary">Consultar no emissor</button>${doc.status === 'authorized' ? '<button data-nfse-cancel class="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600">Cancelar NFS-e</button>' : ''}</div>`;
    panel.classList.remove('hidden');
  }
  document.addEventListener('click', async (event) => {
    const open = event.target.closest('[data-nfse-open]');
    try {
      if (open) { const result = await api(`/nfse/${encodeURIComponent(open.dataset.nfseOpen)}`); showDetail(result.document); }
      if (event.target.closest('[data-nfse-reconcile]') && selected) { const result = await api(`/nfse/${selected.id || selected._id}/refresh`, { method: 'POST', body: '{}' }); showDetail(result.document); }
      if (event.target.closest('[data-nfse-cancel]')) { $('nfse-cancel-code').value = ''; $('nfse-cancel-reason').value = ''; $('nfse-cancel-error').textContent = ''; $('nfse-cancel-dialog').showModal(); }
      if (event.target.closest('[data-nfse-download]') && selected?.xmlContent) {
        const anchor = document.createElement('a'); const url = URL.createObjectURL(new Blob([selected.xmlContent], { type: 'application/xml' }));
        anchor.href = url; anchor.download = `NFS-e-${String(selected.number || selected.id).replace(/[^a-z0-9-]/gi, '')}.xml`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { $('nfse-message').textContent = error.message; }
  });
  $('nfse-cancel-close').onclick = () => $('nfse-cancel-dialog').close();
  $('nfse-cancel-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter; button.disabled = true;
    try { const result = await api(`/nfse/${selected.id || selected._id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: $('nfse-cancel-reason').value, reasonCode: $('nfse-cancel-code').value }) }); $('nfse-cancel-dialog').close(); await refresh(); showDetail(result.document); }
    catch (error) { $('nfse-cancel-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('nfse-filters').onsubmit = (event) => { event.preventDefault(); refresh(); };
  $('nfse-filters').onchange = refresh; $('nfse-refresh').onclick = refresh;
  api('/stores/allowed').then((data) => {
    const stores = Array.isArray(data) ? data : data.stores || [];
    $('nfse-store').innerHTML += stores.map((store) => `<option value="${escape(store._id)}">${escape(store.nomeFantasia || store.nome)}</option>`).join('');
  }).catch((error) => { $('nfse-message').textContent = error.message; });
})();
