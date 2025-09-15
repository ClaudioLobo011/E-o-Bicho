import { api, els, state, money, debounce, todayStr, pad, buildLocalDateTime, isPrivilegedRole } from './core.js';
import { populateModalProfissionais } from './profissionais.js';
import { loadAgendamentos } from './agendamentos.js';
import { renderKpis, renderFilters } from './filters.js';
import { renderGrid } from './grid.js';
import { enhanceAgendaUI } from './ui.js';

let __vendaTargetId = null;
let __vendaLastFocus = null;

export function openVendaModal(item) {
  __vendaTargetId = item?._id || null;

  const m = document.getElementById('venda-modal');
  const input = document.getElementById('venda-codigo-input');
  const lab = document.getElementById('venda-modal-title');
  if (!m || !input) return;

  // salva o elemento atualmente focado para restaurar apÃ³s o fechamento
  __vendaLastFocus = document.activeElement;

  // se a modal de "Adicionar ServiÃ§o" estiver aberta, fecha para nÃ£o ter duas sobrepostas
  try {
    const modalAdd = document.getElementById('modal-add-servico');
    if (modalAdd && !modalAdd.classList.contains('hidden')) {
      modalAdd.classList.add('hidden');
      modalAdd.classList.remove('flex');
      modalAdd.style.display = 'none';
      modalAdd.setAttribute('aria-hidden', 'true');
    }
  } catch {}

  if (lab) lab.textContent = `Registrar venda â€” ${item?.clienteNome || ''} | ${item?.pet || ''}`;
  input.value = item?.codigoVenda || '';

  // mostra a modal
  m.classList.remove('hidden');
  m.classList.add('flex');

  try {
    if (m.parentElement !== document.body) document.body.appendChild(m);
    m.style.display = 'flex';
    m.style.visibility = 'visible';
    m.style.opacity = '1';
    m.style.position = 'fixed';
    m.style.zIndex = '2147483647';
    m.style.pointerEvents = 'auto';

    // acessibilidade
    m.removeAttribute('inert');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-hidden', 'false');
  } catch {}

  // foca o primeiro campo interativo
  requestAnimationFrame(() => { try { input.focus(); } catch {} });
}

export function closeVendaModal() {
  __vendaTargetId = null;
  const m = document.getElementById('venda-modal');
  if (!m) return;

  // 1) tirar o foco de dentro da modal ANTES de aplicar aria-hidden
  const active = document.activeElement;
  const restore =
    (__vendaLastFocus && document.contains(__vendaLastFocus))
      ? __vendaLastFocus
      : document.body; // fallback seguro

  if (m.contains(active)) {
    try { restore.focus?.(); } catch { try { active.blur?.(); } catch {} }
  }

  // 2) ocultar e bloquear interaÃ§Ã£o
  m.classList.add('hidden');
  m.classList.remove('flex');
  try {
    m.style.display = 'none';
    m.style.visibility = 'hidden';
    m.style.pointerEvents = 'none';
    m.setAttribute('aria-hidden', 'true');
    m.setAttribute('inert', ''); // impede foco/interaÃ§Ã£o no subtree
  } catch {}

  // 3) limpar referÃªncia de foco
  __vendaLastFocus = null;
}

function bindVendaModalOnce(){
  if (document.__bindVendaModalApplied) return;
  document.__bindVendaModalApplied = true;
  const cancel = document.getElementById('venda-cancel-btn');
  const closeX = document.getElementById('venda-close-btn');
  const save = document.getElementById('venda-save-btn');
  cancel?.addEventListener('click', closeVendaModal);
  closeX?.addEventListener('click', closeVendaModal);
  save?.addEventListener('click', async () => {
    const input = document.getElementById('venda-codigo-input');
    const code = String(input?.value || '').trim();
    if (!__vendaTargetId) { alert('Agendamento invÃ¡lido.'); return; }
    if (!code) { alert('Informe o cÃ³digo da venda.'); return; }
    try {
      const resp = await api(`/func/agendamentos/${__vendaTargetId}`, { method: 'PUT', body: JSON.stringify({ codigoVenda: code, pago: true }) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || 'Falha ao registrar o cÃ³digo de venda.');
      }
      closeVendaModal();
      await loadAgendamentos();
      renderKpis();
      renderFilters();
      renderGrid();
      enhanceAgendaUI();
    } catch (e) {
      console.error('venda-save', e);
      alert(e.message || 'NÃ£o foi possÃ­vel registrar o cÃ³digo de venda.');
    }
  });
}

// expose for external triggers, keeping backward-compat
window.openVendaModal = openVendaModal;
window.closeVendaModal = closeVendaModal;
// Bridges globais para facilitar chamadas diretas a partir do UI sem import circular
window.__openEditFromUI = (item) => openEditModal(item);
window.__updateStatusQuick = (id, status) => updateStatusQuick(id, status);

export function openAddModal(preselectProfId) {
  let preselectedId = '';
  if (preselectProfId && typeof preselectProfId === 'object') {
    if (typeof preselectProfId.preventDefault === 'function') {
      try { preselectProfId.preventDefault(); } catch {}
    }
  } else if (preselectProfId != null) {
    preselectedId = String(preselectProfId);
  }
  state.editing = null;
  if (!els.modal) { console.warn('Modal #modal-add-servico nÃ£o encontrado'); return; }
  state.tempServicos = [];
  renderServicosLista();
  if (els.addServAddBtn) els.addServAddBtn.classList.remove('hidden');
  [els.cliInput, els.servInput, els.valorInput, els.petSelect].forEach(el => { if (el) el.disabled = false; });
  state.selectedCliente = null;
  state.selectedServico = null;
  if (els.cliInput) { els.cliInput.value = ''; }
  if (els.cliSug) { els.cliSug.innerHTML = ''; els.cliSug.classList.add('hidden'); }
  if (els.servInput) { els.servInput.value = ''; }
  if (els.servSug) { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
  if (els.valorInput) { els.valorInput.value = ''; }
  if (els.petSelect) { els.petSelect.innerHTML = ''; }
  if (els.obsInput) { els.obsInput.value = ''; }
  if (els.addStoreSelect) {
    if (els.storeSelect && els.storeSelect.options.length) {
      els.addStoreSelect.innerHTML = els.storeSelect.innerHTML;
    } else if (state.stores?.length) {
      els.addStoreSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
    }
    const sid = state.selectedStoreId || els.storeSelect?.value || '';
    els.addStoreSelect.value = sid;
    try { if (sid) { populateModalProfissionais(sid, preselectedId); } } catch{}
  }
  if (els.addDateInput) {
    const date = (els.dateInput?.value) || todayStr();
    els.addDateInput.value = date;
  }
  const now = new Date();
  const hh = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (els.horaInput) els.horaInput.value = hh;
  if (els.obsInput) { els.obsInput.value = ''; }
  if (els.statusSelect) els.statusSelect.value = 'agendado';
  if (preselectedId && els.profSelect) {
    try { els.profSelect.value = preselectedId; } catch {}
  }
  if (els.modalDelete) els.modalDelete.classList.add('hidden');
  els.modal.classList.remove('hidden');
  els.modal.classList.add('flex');
  els.cliInput?.focus();
}

export function closeModal() {
  if (!els.modal) return;
  els.modal.classList.add('hidden');
  els.modal.classList.remove('flex');
  state.editing = null;
  [els.cliInput, els.servInput, els.valorInput, els.petSelect].forEach(el => { if (el) el.disabled = false; });
}

export function toDateInputValueFromISO(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return todayStr();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function openEditModal(a) {
  state.editing = a || null;
  if (!els.modal || !state.editing) return;
  state.tempServicos = Array.isArray(a.servicos)
    ? a.servicos.map(x => ({ _id: x._id, nome: x.nome, valor: Number(x.valor || 0) }))
    : (a.servico ? [{ _id: null, nome: a.servico, valor: Number(a.valor || 0) }] : []);
  renderServicosLista();
  state.selectedServico = null;
  if (els.servInput) { els.servInput.value = ''; els.servInput.disabled = false; }
  if (els.servSug)   { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
  if (els.valorInput){ els.valorInput.value = ''; els.valorInput.disabled = false; }
  if (els.addServAddBtn) els.addServAddBtn.classList.remove('hidden');
  if (els.addStoreSelect) {
    if (els.storeSelect && els.storeSelect.options.length) {
      els.addStoreSelect.innerHTML = els.storeSelect.innerHTML;
    } else if (state.stores?.length) {
      els.addStoreSelect.innerHTML = state.stores.map(s => `<option value="${s._id}">${s.nome}</option>`).join('');
    }
    els.addStoreSelect.value = a.storeId || state.selectedStoreId || els.storeSelect?.value || '';
    els.addStoreSelect.disabled = false;
  }
  if (els.addDateInput) {
    const iso = a.h || a.scheduledAt || new Date().toISOString();
    els.addDateInput.value = toDateInputValueFromISO(iso);
  }
  const d = new Date((a.h || a.scheduledAt) || new Date());
  const hh = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (els.horaInput) els.horaInput.value = hh;
  let profId = a.profissionalId ? String(a.profissionalId) : null;
  if (!profId && typeof a.profissional === 'string') {
    const key = a.profissional.trim().toLowerCase();
    const match = state.profissionais.find(p => String(p.nome || '').trim().toLowerCase() === key);
    if (match) profId = String(match._id);
  }
  if (els.profSelect && profId) els.profSelect.value = profId;
  try {
    const sid = els.addStoreSelect?.value || a.storeId || '';
    if (sid) { populateModalProfissionais(sid, profId); }
  } catch {}
  if (els.statusSelect) {
    const keyRaw = String(a.status || 'agendado')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase().replace(/[-\s]+/g, '_');
    const allowed = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
    els.statusSelect.value = allowed.includes(keyRaw) ? keyRaw : 'agendado';
  }
  if (els.obsInput) { els.obsInput.value = (a.observacoes || '').trim(); }
  if (els.cliInput) { els.cliInput.value = (a.clienteNome || ''); els.cliInput.disabled = true; }
  if (els.petSelect) {
    els.petSelect.innerHTML = '';
    try {
      const clienteId = a.clienteId || (a.cliente && a.cliente._id) || null;
      if (clienteId) {
        api(`/func/clientes/${clienteId}/pets`).then(r => r.json().catch(() => []))
          .then(pets => {
            els.petSelect.innerHTML = (Array.isArray(pets) ? pets : []).map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
            const currentPetId = a.petId || (a.pet && a.pet._id) || '';
            if (currentPetId) els.petSelect.value = String(currentPetId);
          });
      }
    } catch {}
  }
  if (els.servInput) { els.servInput.value = ''; els.servInput.disabled = false; }
  if (els.valorInput) { els.valorInput.value = ''; els.valorInput.disabled = false; }
  if (els.modalDelete) els.modalDelete.classList.remove('hidden');
  els.modal.classList.remove('hidden');
  els.modal.classList.add('flex');
}

export async function searchClientes(term) {
  if (!term || term.length < 2) {
    if (els.cliSug) { els.cliSug.innerHTML = ''; els.cliSug.classList.add('hidden'); }
    return;
  }
  const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(term)}&limit=8`);
  const list = await resp.json().catch(() => []);
  if (!els.cliSug) return;
  els.cliSug.innerHTML = list.map(u => `
    <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${u._id}" data-nome="${u.nome}">
      <div class="font-medium text-gray-900">${u.nome}</div>
      <div class="text-xs text-gray-500">${u.email || ''}</div>
    </li>`).join('');
  els.cliSug.classList.remove('hidden');
  els.cliSug.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async () => {
      state.selectedCliente = { _id: li.dataset.id, nome: li.dataset.nome };
      if (els.cliInput) els.cliInput.value = li.dataset.nome;
      els.cliSug.classList.add('hidden');
      const resp = await api(`/func/clientes/${state.selectedCliente._id}/pets`);
      const pets = await resp.json().catch(() => []);
      if (els.petSelect) {
        els.petSelect.innerHTML = pets.map(p => `<option value="${p._id}">${p.nome}</option>`).join('');
      }
    });
  });
}

export async function searchServicos(term) {
  if (!term || term.length < 2) {
    if (els.servSug) { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
    return;
  }
  const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
  const petId   = els.petSelect?.value || '';
  const resp = await api(`/func/servicos/buscar?q=${encodeURIComponent(term)}&storeId=${storeId || ''}&petId=${petId || ''}`);
  const list = await resp.json().catch(() => []);
  if (!els.servSug) return;
  els.servSug.innerHTML = list.map(s => `
    <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${s._id}" data-nome="${s.nome}" data-valor="${s.valor}">
      <div class="font-medium text-gray-900">${s.nome}</div>
      <div class="text-xs text-gray-500">${money(s.valor)}</div>
    </li>`).join('');
  els.servSug.classList.remove('hidden');

  // Atualiza os valores exibidos com preÃ§o por raÃ§a
  try {
    const storeId2 = els.addStoreSelect?.value || state.selectedStoreId || '';
    const petId2   = els.petSelect?.value || '';
    if (storeId2) {
      const lis = Array.from(els.servSug.querySelectorAll('li'));
      lis.forEach(async (li) => {
        const sid = li.dataset.id;
        try {
          const r = await api(`/func/servicos/preco?serviceId=${sid}&storeId=${storeId2}&petId=${petId2 || ''}`);
          if (r.ok) {
            const j = await r.json().catch(() => null);
            if (j && typeof j.valor === 'number') {
              li.dataset.valor = String(Number(j.valor || 0));
              const price = li.querySelector('.text-xs.text-gray-500');
              if (price) price.textContent = money(Number(j.valor || 0));
            }
          }
        } catch { /* ignore */ }
      });
    }
  } catch { /* ignore */ }

  els.servSug.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async () => {
      let valor = Number(li.dataset.valor || 0);
      try {
        const sid = li.dataset.id;
        const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
        const petId   = els.petSelect?.value || '';
        if (sid && storeId) {
          const r = await api(`/func/servicos/preco?serviceId=${sid}&storeId=${storeId}&petId=${petId || ''}`);
          if (r.ok) {
            const j = await r.json().catch(() => null);
            if (j && typeof j.valor === 'number') valor = Number(j.valor || 0);
          }
        }
      } catch { /* ignore */ }
      state.selectedServico = { _id: li.dataset.id, nome: li.dataset.nome, valor };
      if (els.servInput) els.servInput.value = state.selectedServico.nome;
      if (els.valorInput) els.valorInput.value = state.selectedServico.valor.toFixed(2);
      els.servSug.classList.add('hidden');
    });
  });
}

// Atualiza os preÃ§os exibidos na lista de sugestÃµes conforme empresa/pet
async function updateVisibleServicePrices() {
  try {
    if (!els.servSug || els.servSug.classList.contains('hidden')) return;
    const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
    const petId   = els.petSelect?.value || '';
    if (!storeId) return;
    const lis = Array.from(els.servSug.querySelectorAll('li'));
    await Promise.all(lis.map(async (li) => {
      const sid = li.dataset.id;
      if (!sid) return;
      try {
        const r = await api(`/func/servicos/preco?serviceId=${sid}&storeId=${storeId}&petId=${petId || ''}`);
        if (r.ok) {
          const j = await r.json().catch(() => null);
          if (j && typeof j.valor === 'number') {
            li.dataset.valor = String(Number(j.valor || 0));
            const price = li.querySelector('.text-xs.text-gray-500');
            if (price) price.textContent = money(Number(j.valor || 0));
          }
        }
      } catch {}
    }));
  } catch {}
}

// Atualiza o valor do serviÃ§o jÃ¡ selecionado (campo de valor)
async function updateSelectedServicePrice() {
  try {
    const s = state.selectedServico;
    if (!s || !s._id) return;
    const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
    const petId   = els.petSelect?.value || '';
    if (!storeId) return;
    const r = await api(`/func/servicos/preco?serviceId=${s._id}&storeId=${storeId}&petId=${petId || ''}`);
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j && typeof j.valor === 'number') {
        const valor = Number(j.valor || 0);
        state.selectedServico.valor = valor;
        if (els.valorInput) els.valorInput.value = valor.toFixed(2);
      }
    }
  } catch {}
}

export function renderServicosLista() {
  if (!els.servListUL || !els.servTotalEl) return;
  const items = state.tempServicos || [];
  els.servListUL.innerHTML = items.map((it, idx) => `
    <li class="flex items-center justify-between px-3 py-2 text-sm">
      <div class="flex items-center gap-3">
        <span class="w-20 text-right tabular-nums">${money(Number(it.valor || 0))}</span>
        <span class="text-gray-700">${it.nome || ''}</span>
      </div>
      <button data-idx="${idx}" class="remove-serv px-2 py-1 rounded-md border text-gray-600 hover:bg-gray-50">Remover</button>
    </li>
  `).join('');
  const total = items.reduce((s, x) => s + Number(x.valor || 0), 0);
  els.servTotalEl.textContent = money(total);
  els.servListUL.querySelectorAll('.remove-serv').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-idx'), 10);
      if (!isNaN(i)) {
        state.tempServicos.splice(i, 1);
        renderServicosLista();
      }
    });
  });
}

export async function saveAgendamento() {
  try {
    const dateRaw = (els.addDateInput?.value) || (els.dateInput?.value) || todayStr();
    const storeIdSelected = (els.addStoreSelect?.value) || state.selectedStoreId || els.storeSelect?.value;
    const hora = els.horaInput?.value;
    const profissionalId = els.profSelect?.value;
    const status = (els.statusSelect?.value) || 'agendado';
    if (!hora) { try { els.horaInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Informe a hora.'; els.horaInput.parentElement.appendChild(p);} catch{}; return; } if (!profissionalId) { try { els.profSelect.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Selecione o profissional.'; els.profSelect.parentElement.appendChild(p);} catch{}; return; }
    if (!storeIdSelected) { try { (els.addStoreSelect||els.storeSelect).classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Selecione a empresa.'; (els.addStoreSelect||els.storeSelect).parentElement.appendChild(p);} catch{}; return; }
    const scheduledAt = buildLocalDateTime(dateRaw, hora).toISOString();
    if (state.editing && state.editing._id) {
      const id = state.editing._id;
      const items = Array.isArray(state.tempServicos) ? state.tempServicos : [];
      if (!items.length) { try { els.servInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Adicione pelo menos 1 serviço.'; els.servInput.parentElement.appendChild(p);} catch{}; return; }
      const body = {
        storeId: storeIdSelected,
        profissionalId,
        scheduledAt,
        status,
        observacoes: (els.obsInput?.value || '').trim(),
        servicos: items.map(x => ({ servicoId: x._id, valor: Number(x.valor || 0) })),
        ...(state.editing.clienteId ? { clienteId: state.editing.clienteId } : {}),
        ...(els.petSelect?.value ? { petId: els.petSelect.value } : (state.editing.petId ? { petId: state.editing.petId } : {})),
        ...(typeof state.editing.pago !== 'undefined' ? { pago: state.editing.pago } : {})
      };
      const resp = await api(`/func/agendamentos/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (window.showToast) window.showToast(err.message || 'Erro ao atualizar agendamento.', 'error'); else alert(err.message || 'Erro ao atualizar agendamento.');
        return;
      }
      await loadAgendamentos();
      renderKpis();
      renderFilters();
      closeModal();
      renderGrid();
      enhanceAgendaUI();
      return;
    }
    const clienteId = state.selectedCliente?._id;
    const petId = els.petSelect?.value;
    const items = state.tempServicos || [];
    if (!(clienteId && petId && items.length)) { try { if(!clienteId){ els.cliInput.classList.add('border-red-500'); const p1=document.createElement('p'); p1.className='form-err text-xs text-red-600 mt-1'; p1.textContent='Selecione o cliente.'; els.cliInput.parentElement.appendChild(p1);} if(!petId){ els.petSelect.classList.add('border-red-500'); const p2=document.createElement('p'); p2.className='form-err text-xs text-red-600 mt-1'; p2.textContent='Selecione o pet.'; els.petSelect.parentElement.appendChild(p2);} if(!items.length){ els.servInput.classList.add('border-red-500'); const p3=document.createElement('p'); p3.className='form-err text-xs text-red-600 mt-1'; p3.textContent='Adicione pelo menos 1 serviço.'; els.servInput.parentElement.appendChild(p3);} } catch{}; return; }
    const body = {
      storeId: storeIdSelected,
      clienteId, petId,
      servicos: items.map(x => ({ servicoId: x._id, valor: Number(x.valor || 0) })),
      profissionalId, scheduledAt,
      status,
      observacoes: (els.obsInput?.value || '').trim(),
      pago: false
    };
    const resp = await api('/func/agendamentos', { method: 'POST', body: JSON.stringify(body) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Erro ao salvar');
    }
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    closeModal();
    renderGrid();
    enhanceAgendaUI();
  } catch (e) {
    console.error(e);
    if (window.showToast) {
      try { window.showToast(e.message || 'Erro ao salvar', 'error'); } catch (_) { alert(e.message || 'Erro ao salvar'); }
    } else {
      alert(e.message || 'Erro ao salvar');
    }
  }
}

export async function handleDelete() {
  const id = state.editing && state.editing._id ? String(state.editing._id) : null;
  if (!id) return;
  const ok = await confirmAsync('Excluir atendimento', 'Tem certeza que deseja excluir este atendimento? Esta aÃ§Ã£o nÃ£o pode ser desfeita.', { confirmText: 'Excluir', cancelText: 'Cancelar' });
  if (!ok) return;
  const resp = await api(`/func/agendamentos/${id}`, { method: 'DELETE' });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    alert(err.message || 'Erro ao excluir agendamento');
    return;
  }
  await loadAgendamentos();
  renderKpis();
  renderFilters();
  closeModal();
  renderGrid();
  enhanceAgendaUI();
}

export function confirmAsync(title, message, opts = {}) {
  const confirmText = opts.confirmText || 'Excluir';
  const cancelText  = opts.cancelText  || 'Cancelar';
  if (typeof window.showModal === 'function') {
    return new Promise((resolve) => {
      const prevVis = els.modal ? els.modal.style.visibility : '';
      const prevPe  = els.modal ? els.modal.style.pointerEvents : '';
      if (els.modal) { els.modal.style.visibility = 'hidden'; els.modal.style.pointerEvents = 'none'; }
      window.showModal({
        title: title || 'ConfirmaÃ§Ã£o', message: message || 'Deseja prosseguir?', confirmText, cancelText,
        onConfirm: () => { restore(); resolve(true); },
        onCancel : () => { restore(); resolve(false); }
      });
      const bump = () => {
        try {
          const all = Array.from(document.querySelectorAll('body *'));
          const overlays = all.filter(el => { const cs = getComputedStyle(el); if (cs.position !== 'fixed') return false; const r = el.getBoundingClientRect(); return r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.95; });
          const overlay = overlays.at(-1);
          if (overlay) { overlay.style.zIndex = '9999'; overlay.style.pointerEvents = 'auto'; }
        } catch {}
      };
      requestAnimationFrame(bump);
      setTimeout(bump, 0);
      function restore() { if (els.modal) { els.modal.style.visibility = prevVis || ''; els.modal.style.pointerEvents = prevPe || ''; } }
    });
  }
  const ok = window.confirm(message || title || 'Confirmar?');
  return Promise.resolve(!!ok);
}

export function bindModalAndActionsEvents() {
  bindVendaModalOnce();
  // Atualiza preÃ§os da lista e do item selecionado ao mudar empresa/pet
  els.addStoreSelect?.addEventListener('change', () => { updateVisibleServicePrices(); updateSelectedServicePrice(); });
  els.petSelect?.addEventListener('change', () => { updateVisibleServicePrices(); updateSelectedServicePrice(); });
  // Limpa erros ao interagir com campos
  els.cliInput?.addEventListener('input', () => { try { els.cliInput.classList.remove('border-red-500'); const e=els.cliInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.petSelect?.addEventListener('change', () => { try { els.petSelect.classList.remove('border-red-500'); const e=els.petSelect.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.servInput?.addEventListener('input', () => { try { els.servInput.classList.remove('border-red-500'); const e=els.servInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.valorInput?.addEventListener('input', () => { try { els.valorInput.classList.remove('border-red-500'); const e=els.valorInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.addStoreSelect?.addEventListener('change', () => { try { els.addStoreSelect.classList.remove('border-red-500'); const e=els.addStoreSelect.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.horaInput?.addEventListener('input', () => { try { els.horaInput.classList.remove('border-red-500'); const e=els.horaInput.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.profSelect?.addEventListener('change', () => { try { els.profSelect.classList.remove('border-red-500'); const e=els.profSelect.parentElement.querySelector('.form-err'); if(e) e.remove(); } catch{} });
  els.addServAddBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const s = state.selectedServico;
    const v = Number(els.valorInput?.value || 0);
    if (!s || !s._id) { try { els.servInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Escolha um serviço na busca.'; els.servInput.parentElement.appendChild(p);} catch{}; return; }
    if (!(v >= 0)) { try { els.valorInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Valor inválido.'; els.valorInput.parentElement.appendChild(p);} catch{}; return; }
    state.tempServicos.push({ _id: s._id, nome: s.nome, valor: v });
    state.selectedServico = null;
    if (els.servInput)  els.servInput.value = '';
    if (els.valorInput) els.valorInput.value = '';
    renderServicosLista();
  });
  els.modalDelete?.addEventListener('click', handleDelete);
  // Use capture phase to avoid being blocked by other handlers
  if (false) els.actionsRoot?.addEventListener('click', (ev) => {
    const more = ev.target.closest?.('.agenda-card__more');
    if (more) { const holder = more.parentElement?.querySelector('.agenda-card__actions'); if (holder) holder.classList.toggle('hidden'); return; }
    const btn = ev.target.closest?.('.agenda-action');
    if (!btn) return;
    ev.preventDefault(); ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    const id = btn.getAttribute('data-id'); if (!id) return;
    if (btn.classList.contains('edit')) {
      // Se a modal de venda estiver aberta, nÃ£o abrir ediÃ§Ã£o
      const vendaOpen = !document.getElementById('venda-modal')?.classList.contains('hidden');
      if (vendaOpen) return;
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;
      if ((item.pago || item.codigoVenda) && !isPrivilegedRole()) { alert('Este agendamento jÃ¡ foi faturado. Apenas Admin/Admin Master podem editar.'); return; }
      openEditModal(item);
    } else if (btn.classList.contains('status')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
      const cur = (item && item.status) || 'agendado';
      const next = chain[(chain.indexOf(cur) + 1) % chain.length];
      updateStatusQuick(id, next);
    } else if (btn.classList.contains('cobrar')) {
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;
      if (item.pago || item.codigoVenda) { alert('Este agendamento jÃ¡ possui cÃ³digo de venda registrado.'); return; }
      requestAnimationFrame(() => (window.openVendaModal || openVendaModal)(item));
    }
  }, true);
  // disabled: usando handlers diretos nos botÃµes em ui.js

  // Captura adicional a nÃ­vel de documento para garantir o clique no botÃ£o $
  const docChargeHandler = (ev) => { if (window.__forceDirectHandlers) return;
    const btn = ev.target?.closest?.('.agenda-action.cobrar');
    if (!btn) return;
    ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    ev.stopPropagation();
    const id = btn.getAttribute('data-id');
    if (!id) return;
    const item = state.agendamentos.find(x => String(x._id) === String(id));
    if (!item) return;
    if (item.pago || item.codigoVenda) { alert('Este agendamento jÃ¡ possui cÃ³digo de venda registrado.'); return; }
    // Fecha a de ediÃ§Ã£o, se aberta
    try {
      const modalAdd = document.getElementById('modal-add-servico');
      if (modalAdd && !modalAdd.classList.contains('hidden')) {
        modalAdd.classList.add('hidden');
        modalAdd.classList.remove('flex');
        modalAdd.style.display = 'none';
        modalAdd.setAttribute('aria-hidden', 'true');
      }
    } catch {}
    requestAnimationFrame(() => (window.openVendaModal || openVendaModal)(item));
  };
  document.addEventListener('click', docChargeHandler, true);
  els.cliInput?.addEventListener('input', debounce((e) => searchClientes(e.target.value), 300));
  els.servInput?.addEventListener('input', debounce((e) => searchServicos(e.target.value), 300));
}

export async function updateStatusQuick(id, status) {
  try {
    const resp = await api(`/func/agendamentos/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Erro ao mudar status');
    }
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  } catch (e) {
    console.error('updateStatusQuick', e);
    alert(e.message || 'Erro ao mudar status');
  }
}
