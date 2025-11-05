import { api, els, state, money, debounce, todayStr, pad, buildLocalDateTime, isPrivilegedRole, confirmWithModal, notify } from './core.js';
import { populateModalProfissionais, updateModalProfissionalLabel, getModalProfissionalTipo, getModalProfissionaisList } from './profissionais.js';
import { loadAgendamentos } from './agendamentos.js';
import { renderKpis, renderFilters } from './filters.js';
import { renderGrid } from './grid.js';
import { enhanceAgendaUI } from './ui.js';
import { confirmCheckinPrompt, openCheckinModal, findAppointmentById, closeCheckinModal, isCheckinModalOpen } from './checkin.js';

let __pendingCheckin = null;
let __pendingCheckinTimer = null;
let __pendingCheckinPromise = null;

const SALE_VIA_PDV_MESSAGE = 'Finalize a venda pelo PDV para gerar o código automaticamente.';

function clearPendingCheckinQueue() {
  if (__pendingCheckinTimer) {
    clearTimeout(__pendingCheckinTimer);
    __pendingCheckinTimer = null;
  }
  __pendingCheckin = null;
}

function attemptOpenPendingCheckin(remainingAttempts) {
  __pendingCheckinTimer = null;
  if (!__pendingCheckin) return;

  if (__pendingCheckinPromise) {
    __pendingCheckinTimer = setTimeout(() => attemptOpenPendingCheckin(remainingAttempts), 50);
    return;
  }

  const { id, fallback } = __pendingCheckin;
  const latest = (id ? findAppointmentById(id) : null) || fallback;

  if (!latest) {
    if (remainingAttempts <= 0) {
      clearPendingCheckinQueue();
      return;
    }
    __pendingCheckinTimer = setTimeout(() => attemptOpenPendingCheckin(remainingAttempts - 1), 120);
    return;
  }

  __pendingCheckinPromise = Promise.resolve(openCheckinModal(latest))
    .catch((error) => {
      console.error('agenda check-in open', error);
    })
    .finally(() => {
      __pendingCheckinPromise = null;
    });

  __pendingCheckinPromise.then(() => {
    if (!__pendingCheckin) return;
    if (isCheckinModalOpen()) {
      clearPendingCheckinQueue();
    } else if (remainingAttempts > 0) {
      __pendingCheckinTimer = setTimeout(() => attemptOpenPendingCheckin(remainingAttempts - 1), 160);
    } else {
      clearPendingCheckinQueue();
    }
  });
}

function scheduleCheckinOpen(context, attempts = 5) {
  clearPendingCheckinQueue();

  if (!context) return;

  const fallback = context.appointment || context;
  const idCandidate = context.id ?? fallback?._id ?? fallback?.id ?? '';
  const id = idCandidate ? String(idCandidate) : '';

  if (!id && !fallback) {
    return;
  }

  const tries = Math.max(1, attempts | 0);

  __pendingCheckin = { id, fallback, attempts: tries };

  const initialAttempts = __pendingCheckin.attempts;

  __pendingCheckinTimer = setTimeout(() => {
    attemptOpenPendingCheckin(initialAttempts);
  }, 0);
}

function normalizeCheckinPayload(context) {
  if (!context) return null;

  const base = context.appointment ?? context;
  const rawId = context.id ?? base?._id ?? base?.id ?? '';
  const id = rawId ? String(rawId) : '';

  const appointment =
    base && typeof base === 'object'
      ? { ...base }
      : {};

  if (id) {
    if (!appointment._id) appointment._id = id;
    if (!appointment.id) appointment.id = id;
  }

  if (!id && !Object.keys(appointment).length) {
    return null;
  }

  return { id, appointment };
}

async function triggerCheckinOpen(context, attempts = 5) {
  const payload = normalizeCheckinPayload(context);
  if (!payload) {
    clearPendingCheckinQueue();
    return null;
  }

  let opened = false;

  try {
    await openCheckinModal(payload.appointment);
    opened = isCheckinModalOpen();
  } catch (error) {
    console.error('agenda check-in immediate open', error);
  }

  if (!opened) {
    scheduleCheckinOpen(payload, attempts);
  } else {
    clearPendingCheckinQueue();
  }

  return payload;
}

if (typeof document !== 'undefined') {
  document.addEventListener('agenda:checkin:opened', () => {
    clearPendingCheckinQueue();
  });
  document.addEventListener('agenda:checkin:closed', () => {
    clearPendingCheckinQueue();
  });
}

export function openVendaModal() {
  notify(SALE_VIA_PDV_MESSAGE, 'info');
}

export function closeVendaModal() {}

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
    updateModalProfissionalLabel(preselectedId);
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
    ? a.servicos.map(x => ({
        _id: x._id,
        nome: x.nome,
        valor: Number(x.valor || 0),
        profissionalId: x.profissionalId ? String(x.profissionalId) : '',
        profissionalNome: x.profissionalNome || '',
        itemId: x.itemId || null,
      }))
    : (a.servico ? [{
        _id: null,
        nome: a.servico,
        valor: Number(a.valor || 0),
        profissionalId: a.profissionalId ? String(a.profissionalId) : '',
        profissionalNome: typeof a.profissional === 'string' ? a.profissional : (a.profissional?.nomeCompleto || a.profissional?.nomeContato || a.profissional?.razaoSocial || ''),
        itemId: null,
      }] : []);
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
  if (els.profSelect && profId) {
    els.profSelect.value = profId;
    updateModalProfissionalLabel(profId);
  }
  try {
    const sid = els.addStoreSelect?.value || a.storeId || '';
    if (sid) {
      const maybe = populateModalProfissionais(sid, profId);
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => renderServicosLista()).catch(() => renderServicosLista());
      } else {
        renderServicosLista();
      }
    } else {
      renderServicosLista();
    }
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

function normalizeProfTipo(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

function filterServicesByProfTipo(list, tipo) {
  const normTipo = normalizeProfTipo(tipo);
  const arr = Array.isArray(list) ? list : [];
  if (!normTipo) return arr;
  return arr.filter((s) => {
    const tipos = Array.isArray(s?.grupo?.tiposPermitidos) ? s.grupo.tiposPermitidos : [];
    if (!tipos.length) return true;
    return tipos.some((t) => normalizeProfTipo(t) === normTipo);
  });
}

export async function searchServicos(term) {
  if (!term || term.length < 2) {
    if (els.servSug) { els.servSug.innerHTML = ''; els.servSug.classList.add('hidden'); }
    return;
  }
  const storeId = els.addStoreSelect?.value || state.selectedStoreId || '';
  const petId   = els.petSelect?.value || '';
  const profTipo = normalizeProfTipo(getModalProfissionalTipo());
  const query = new URLSearchParams({
    q: term,
    storeId: storeId || '',
    petId: petId || '',
  });
  if (profTipo) query.set('profTipo', profTipo);
  const resp = await api(`/func/servicos/buscar?${query.toString()}`);
  const listRaw = await resp.json().catch(() => []);
  const list = filterServicesByProfTipo(listRaw, profTipo);
  if (!els.servSug) return;
  els.servSug.innerHTML = list.map(s => {
    const tiposPermitidos = Array.isArray(s?.grupo?.tiposPermitidos) ? s.grupo.tiposPermitidos : [];
    const tiposAttr = tiposPermitidos
      .map(t => normalizeProfTipo(t))
      .filter(Boolean)
      .join(',');
    return `
    <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${s._id}" data-nome="${s.nome}" data-valor="${s.valor}" data-tipos="${tiposAttr}">
      <div class="font-medium text-gray-900">${s.nome}</div>
      <div class="text-xs text-gray-500">${money(s.valor)}</div>
    </li>`;
  }).join('');
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
      const allowedTipos = (li.dataset.tipos || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      state.selectedServico = { _id: li.dataset.id, nome: li.dataset.nome, valor, tiposPermitidos: allowedTipos };
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
  const profs = getModalProfissionaisList();
  const buildOptions = (selectedId, fallbackName = '') => {
    const opts = ['<option value="">Selecione</option>'];
    let hasSelected = false;
    profs.forEach((prof) => {
      const value = String(prof._id || '');
      const isSelected = selectedId && value === String(selectedId);
      if (isSelected) hasSelected = true;
      const label = String(prof.nome || '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));
      opts.push(`<option value="${value}"${isSelected ? ' selected' : ''}>${label}</option>`);
    });
    if (selectedId && !hasSelected) {
      const safeName = String(fallbackName || 'Profissional').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));
      const value = String(selectedId);
      opts.push(`<option value="${value}" selected>${safeName}</option>`);
    }
    return opts.join('');
  };
  els.servListUL.innerHTML = items.map((it, idx) => {
    const valorFmt = money(Number(it.valor || 0));
    const nomeSafe = String(it.nome || '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));
    const profId = it.profissionalId ? String(it.profissionalId) : '';
    const options = buildOptions(profId, it.profissionalNome || '');
    const selectId = `serv-prof-${idx}`;
    return `
      <li class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_auto] items-start md:items-center px-3 py-2 text-sm">
        <div class="flex items-start md:items-center gap-3 overflow-hidden">
          <span class="w-20 text-right tabular-nums shrink-0">${valorFmt}</span>
          <span class="text-gray-700 break-words flex-1">${nomeSafe}</span>
        </div>
        <div class="flex flex-col gap-1">
          <label for="${selectId}" class="text-xs font-medium text-gray-600 uppercase tracking-wide">Profissional</label>
          <select id="${selectId}" data-idx="${idx}" class="select-serv-prof rounded-md border-gray-300 focus:ring-primary focus:border-primary text-sm">
            ${options}
          </select>
        </div>
        <div class="flex md:justify-end">
          <button data-idx="${idx}" class="remove-serv px-2 py-1 rounded-md border text-gray-600 hover:bg-gray-50">Remover</button>
        </div>
      </li>
    `;
  }).join('');
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
  els.servListUL.querySelectorAll('.select-serv-prof').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = parseInt(sel.getAttribute('data-idx'), 10);
      if (Number.isNaN(i) || !state.tempServicos[i]) return;
      const selected = sel.value || '';
      state.tempServicos[i].profissionalId = selected;
      const option = sel.options[sel.selectedIndex];
      state.tempServicos[i].profissionalNome = option ? option.textContent.trim() : '';
    });
  });
}

export async function saveAgendamento() {
  try {
    const dateRaw = (els.addDateInput?.value) || (els.dateInput?.value) || todayStr();
    const storeIdSelected = (els.addStoreSelect?.value) || state.selectedStoreId || els.storeSelect?.value;
    const hora = els.horaInput?.value;
    const defaultProfissionalId = (els.profSelect?.value || '').trim();
    const status = (els.statusSelect?.value) || 'agendado';
    if (!hora) { try { els.horaInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Informe a hora.'; els.horaInput.parentElement.appendChild(p);} catch{}; return; }
    if (!storeIdSelected) { try { (els.addStoreSelect||els.storeSelect).classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Selecione a empresa.'; (els.addStoreSelect||els.storeSelect).parentElement.appendChild(p);} catch{}; return; }

    const scheduledAt = buildLocalDateTime(dateRaw, hora).toISOString();
    const itemsRaw = Array.isArray(state.tempServicos) ? state.tempServicos : [];
    const normalizedServices = itemsRaw.map((svc) => {
      const profId = svc && svc.profissionalId ? String(svc.profissionalId).trim() : '';
      const resolvedProf = profId || defaultProfissionalId;
      return {
        ...svc,
        profissionalId: resolvedProf ? String(resolvedProf) : '',
      };
    });
    const missingProfessional = normalizedServices.some((svc) => !svc.profissionalId);
    if (missingProfessional) {
      if (window.showToast) window.showToast('Defina um profissional para cada serviço adicionado.', 'warning'); else alert('Defina um profissional para cada serviço adicionado.');
      return;
    }
    const primaryProfissionalId = normalizedServices.find(svc => svc.profissionalId)?.profissionalId || defaultProfissionalId;

    if (state.editing && state.editing._id) {
      const id = state.editing._id;
      if (!normalizedServices.length) { try { els.servInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Adicione pelo menos 1 serviço.'; els.servInput.parentElement.appendChild(p);} catch{}; return; }
      const body = {
        storeId: storeIdSelected,
        profissionalId: primaryProfissionalId,
        scheduledAt,
        status,
        observacoes: (els.obsInput?.value || '').trim(),
        servicos: normalizedServices.map(x => ({
          servicoId: x._id,
          valor: Number(x.valor || 0),
          ...(x.profissionalId ? { profissionalId: x.profissionalId } : {}),
          ...(x.itemId ? { itemId: x.itemId } : {}),
        })),
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
    if (!(clienteId && petId && normalizedServices.length)) { try { if(!clienteId){ els.cliInput.classList.add('border-red-500'); const p1=document.createElement('p'); p1.className='form-err text-xs text-red-600 mt-1'; p1.textContent='Selecione o cliente.'; els.cliInput.parentElement.appendChild(p1);} if(!petId){ els.petSelect.classList.add('border-red-500'); const p2=document.createElement('p'); p2.className='form-err text-xs text-red-600 mt-1'; p2.textContent='Selecione o pet.'; els.petSelect.parentElement.appendChild(p2);} if(!normalizedServices.length){ els.servInput.classList.add('border-red-500'); const p3=document.createElement('p'); p3.className='form-err text-xs text-red-600 mt-1'; p3.textContent='Adicione pelo menos 1 serviço.'; els.servInput.parentElement.appendChild(p3);} } catch{}; return; }

    const body = {
      storeId: storeIdSelected,
      clienteId,
      petId,
      servicos: normalizedServices.map(x => ({
        servicoId: x._id,
        valor: Number(x.valor || 0),
        ...(x.profissionalId ? { profissionalId: x.profissionalId } : {}),
      })),
      profissionalId: primaryProfissionalId,
      scheduledAt,
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

export async function confirmAsync(title, message, opts = {}) {
  const confirmText = opts.confirmText || 'Excluir';
  const cancelText  = opts.cancelText  || 'Cancelar';
  const modalEl = els.modal || null;

  let prevVis;
  let prevPointerEvents;
  if (modalEl) {
    prevVis = modalEl.style.visibility;
    prevPointerEvents = modalEl.style.pointerEvents;
    modalEl.style.visibility = 'hidden';
    modalEl.style.pointerEvents = 'none';
  }

  const ensureOverlayOnTop = () => {
    try {
      const all = Array.from(document.querySelectorAll('body *'));
      const overlays = all.filter((element) => {
        const style = getComputedStyle(element);
        if (style.position !== 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
      });
      const overlay = overlays.at(-1);
      if (overlay) {
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'auto';
      }
    } catch (_) {}
  };

  if (typeof window !== 'undefined') {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(ensureOverlayOnTop);
    }
    setTimeout(ensureOverlayOnTop, 0);
  }

  try {
    return await confirmWithModal({
      title: title || 'Confirmação',
      message: message || 'Deseja prosseguir?',
      confirmText,
      cancelText,
    });
  } finally {
    if (modalEl) {
      modalEl.style.visibility = prevVis || '';
      modalEl.style.pointerEvents = prevPointerEvents || '';
    }
  }
}

export function bindModalAndActionsEvents() {
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
  els.profSelect?.addEventListener('change', () => {
    try {
      els.profSelect.classList.remove('border-red-500');
      const e = els.profSelect.parentElement.querySelector('.form-err');
      if (e) e.remove();
    } catch {}
    updateModalProfissionalLabel();
    const currentTipo = normalizeProfTipo(getModalProfissionalTipo());
    if (state.selectedServico && Array.isArray(state.selectedServico.tiposPermitidos)) {
      const allowed = state.selectedServico.tiposPermitidos.map(t => normalizeProfTipo(t)).filter(Boolean);
      if (currentTipo && allowed.length && !allowed.includes(currentTipo)) {
        state.selectedServico = null;
        if (els.servInput) els.servInput.value = '';
        if (els.valorInput) els.valorInput.value = '';
      }
    }
    const term = els.servInput?.value || '';
    if (term.length >= 2) {
      searchServicos(term);
    } else if (els.servSug) {
      els.servSug.innerHTML = '';
      els.servSug.classList.add('hidden');
    }
  });
  els.addServAddBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const s = state.selectedServico;
    const v = Number(els.valorInput?.value || 0);
    if (!s || !s._id) { try { els.servInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Escolha um serviço na busca.'; els.servInput.parentElement.appendChild(p);} catch{}; return; }
    if (!(v >= 0)) { try { els.valorInput.classList.add('border-red-500'); const p=document.createElement('p'); p.className='form-err text-xs text-red-600 mt-1'; p.textContent='Valor inválido.'; els.valorInput.parentElement.appendChild(p);} catch{}; return; }
    const currentProfId = s && s.profissionalId ? String(s.profissionalId) : (els.profSelect?.value || '').trim();
    const profList = getModalProfissionaisList();
    const profEntry = profList.find(p => String(p._id || '') === currentProfId);
    const profNome = profEntry ? profEntry.nome : (s?.profissionalNome || '');
    state.tempServicos.push({
      _id: s._id,
      nome: s.nome,
      valor: v,
      profissionalId: currentProfId,
      profissionalNome: profNome || '',
      itemId: s.itemId || null,
    });
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
      const item = state.agendamentos.find(x => String(x._id) === String(id));
      if (!item) return;
      if ((item.pago || item.codigoVenda) && !isPrivilegedRole()) { notify('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.', 'warning'); return; }
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
      if (item.pago || item.codigoVenda) { notify('Este agendamento já possui código de venda registrado.', 'warning'); return; }
      notify(SALE_VIA_PDV_MESSAGE, 'info');
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
    if (item.pago || item.codigoVenda) { notify('Este agendamento já possui código de venda registrado.', 'warning'); return; }
    notify(SALE_VIA_PDV_MESSAGE, 'info');
  };
  document.addEventListener('click', docChargeHandler, true);
  els.cliInput?.addEventListener('input', debounce((e) => searchClientes(e.target.value), 300));
  els.servInput?.addEventListener('input', debounce((e) => searchServicos(e.target.value), 300));
}

export async function updateStatusQuick(id, status) {
  const idStr = id != null ? String(id) : '';
  let shouldOpenCheckin = false;
  let checkinSource = null;
  if (status === 'em_atendimento') {
    try {
      const appointment = findAppointmentById(idStr);
      const checkinContext = appointment || { _id: idStr };
      let checkinTriggerScheduled = false;

      const ensureCheckinOpening = () => {
        if (checkinTriggerScheduled) return;
        checkinTriggerScheduled = true;
        clearPendingCheckinQueue();
        checkinSource = checkinContext;

        const payload = { id: idStr, appointment: checkinContext };
        const run = () => {
          try {
            const job = triggerCheckinOpen(payload, 8);
            if (job && typeof job.catch === 'function') {
              job.catch((error) => {
                console.error('updateStatusQuick.triggerCheckinOpen', error);
              });
            }
          } catch (error) {
            console.error('updateStatusQuick.triggerCheckinOpen', error);
          }
        };

        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(run);
        } else {
          setTimeout(run, 0);
        }
      };

      shouldOpenCheckin = await confirmCheckinPrompt(appointment, {
        onConfirm: () => {
          ensureCheckinOpening();
        },
        onCancel: () => {
          clearPendingCheckinQueue();
        },
      });
      if (shouldOpenCheckin) {
        ensureCheckinOpening();
      } else {
        clearPendingCheckinQueue();
      }
    } catch (error) {
      console.error('updateStatusQuick.checkinPrompt', error);
      clearPendingCheckinQueue();
    }
  } else {
    clearPendingCheckinQueue();
  }
  try {
    const resp = await api(`/func/agendamentos/${idStr}`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Erro ao mudar status');
    }
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
    if (shouldOpenCheckin && !isCheckinModalOpen()) {
      const latest = findAppointmentById(idStr) || checkinSource || { _id: idStr };
      await triggerCheckinOpen({ id: idStr, appointment: latest }, 5);
    }
  } catch (e) {
    console.error('updateStatusQuick', e);
    if (shouldOpenCheckin) {
      try {
        closeCheckinModal();
      } catch (_) {}
      clearPendingCheckinQueue();
    }
    alert(e.message || 'Erro ao mudar status');
  }
}
