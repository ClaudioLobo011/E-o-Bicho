import { els, state, isPrivilegedRole, buildLocalDateTime, todayStr, normalizeDate, pad, api } from './core.js';
import { loadAgendamentos } from './agendamentos.js';
import { renderKpis, renderFilters } from './filters.js';
import { renderGrid } from './grid.js';

export function enhanceAgendaUI() {
  try {
    applyZebraAndSublines();
    decorateCards();
    if (state.view === 'day' || state.view === 'week' || state.view === 'month') {
      enableDragDrop();
    }
    if (state.view === 'day' || state.view === 'week') {
      drawNowLine();
    }
    if (state.view === 'day') {
      const date = normalizeDate(els.dateInput?.value || todayStr());
      if (!state.__didInitialScroll && date === todayStr()) {
        scrollToNow();
        state.__didInitialScroll = true;
      }
    }
  } catch (e) { console.info('[enhanceAgendaUI] skip', e); }
}

export function scrollToNow() {
  const grids = els.agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
  const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
  if (!body || !state.profissionais?.length) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0') + ':00';
  const firstProfId = String(state.profissionais[0]._id);
  const target = body.querySelector(`div[data-profissional-id="${firstProfId}"][data-hh="${hh}"]`);
  if (target) {
    const top = target.getBoundingClientRect().top + window.pageYOffset;
    const offset = 80;
    window.scrollTo({ top: Math.max(0, top - offset), behavior: 'smooth' });
  }
}

export function applyZebraAndSublines() {
  const grids = els.agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
  const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
  if (!body) return;
  body.style.position = 'relative';
  const totalCols = 1 + (state.profissionais?.length || 0);
  if (totalCols <= 0) return;
  const cells = Array.from(body.children);
  const totalRows = Math.floor(cells.length / totalCols);
  for (let row = 0; row < totalRows; row++) {
    const start = row * totalCols;
    const zebraClass = (row % 2 === 0) ? 'is-row-even' : 'is-row-odd';
    const tCell = cells[start];
    if (tCell) {
      tCell.classList.remove('bg-white','bg-slate-50','is-row-even','is-row-odd');
      tCell.classList.add(zebraClass);
    }
    for (let col = 1; col < totalCols; col++) {
      const idx = start + col;
      const slot = cells[idx];
      if (!slot) continue;
      slot.classList.remove('bg-white','bg-slate-50','is-row-even','is-row-odd');
      slot.classList.add(zebraClass, 'agenda-slot');
    }
  }
}

export function decorateCards() {
  const cards = els.agendaList?.querySelectorAll('div[data-appointment-id]');
  if (!cards || !cards.length) return;
  cards.forEach((card) => {
    if (card.querySelector('.agenda-card__actions')) return;
    card.classList.add('agenda-card');
    card.style.position = 'relative';
    const id = card.getAttribute('data-appointment-id') || '';
    const item = (state.agendamentos || []).find(x => String(x._id) === String(id)) || {};
    const isPaid = !!item.pago || !!item.codigoVenda;
    const actions = document.createElement('div');
    actions.className = 'agenda-card__actions absolute top-1 right-1 hidden md:flex flex-col items-end gap-1';
    actions.innerHTML = `
      <div class="flex items-center gap-1">
        <button type="button" class="agenda-action edit" data-id="${id}" title="Editar">
          <i class="fa-solid fa-pen text-[16px] leading-none"></i>
        </button>
        <button type="button" class="agenda-action status" data-id="${id}" title="Mudar status">
          <i class="fa-regular fa-clock text-[16px] leading-none"></i>
        </button>
      </div>
      <button type="button" class="agenda-action cobrar ${isPaid ? 'text-green-600' : 'text-slate-500'}" data-id="${id}" title="${isPaid ? 'Pago' : 'Registrar pagamento'}">
        <i class="fa-solid fa-dollar-sign text-[16px] leading-none"></i>
      </button>
    `;
    card.appendChild(actions);
    if ((!!item.pago || !!item.codigoVenda) && !isPrivilegedRole()) {
      card.setAttribute('draggable', 'false');
      card.classList.remove('cursor-move');
      card.classList.add('cursor-default');
    }

    // Bind direto no botão de cobrança para garantir prioridade (fase de captura)
    const chargeBtn = actions.querySelector('.agenda-action.cobrar');
    if (chargeBtn) {
      const handler = (e) => {
        try {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          e.stopPropagation();
          const current = (state.agendamentos || []).find(x => String(x._id) === String(id));
          if (!current) return;
          if (current.pago || current.codigoVenda) {
            alert('Este agendamento já possui código de venda registrado.');
            return;
          }
          // chama via window para evitar ciclo de imports
          if (window.openVendaModal) {
            window.openVendaModal(current);
          }
        } catch (err) { console.error('cobrar-click', err); }
      };
      // captura e bolha, para máxima robustez
      chargeBtn.addEventListener('click', handler, true);
      chargeBtn.addEventListener('click', handler);
    }

    const editBtn = actions.querySelector('.agenda-action.edit');
    if (editBtn) {
      const handlerEdit = (e) => {
        try {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          e.stopPropagation();
          const vm = document.getElementById('venda-modal');
          const vendaOpen = vm && !vm.classList.contains('hidden');
          if (vendaOpen) {
            try { vm.classList.add('hidden'); vm.setAttribute('aria-hidden','true'); } catch {}
          }
          const current = (state.agendamentos || []).find(x => String(x._id) === String(id));
          if (!current) return;
          if ((current.pago || current.codigoVenda) && !isPrivilegedRole()) {
            alert('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.');
            return;
          }
          if (window.__openEditFromUI) {
            window.__openEditFromUI(current);
          }
        } catch (err) { console.error('edit-click', err); }
      };
      editBtn.addEventListener('click', handlerEdit, true);
      editBtn.addEventListener('click', handlerEdit);
    }

    const statusBtn = actions.querySelector('.agenda-action.status');
    if (statusBtn) {
      const handlerStatus = (e) => {
        try {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          e.stopPropagation();
          const vm = document.getElementById('venda-modal');
          if (vm && !vm.classList.contains('hidden')) { try { vm.classList.add('hidden'); vm.setAttribute('aria-hidden','true'); } catch {} }
          const current = (state.agendamentos || []).find(x => String(x._id) === String(id));
          if (!current) return;
          const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
          const cur = (current && current.status) || 'agendado';
          const next = chain[(chain.indexOf(cur) + 1) % chain.length];
          if (window.__updateStatusQuick) {
            window.__updateStatusQuick(id, next);
          }
        } catch (err) { console.error('status-click', err); }
      };
      statusBtn.addEventListener('click', handlerStatus, true);
      statusBtn.addEventListener('click', handlerStatus);
    }
  });
}

export function injectDndStylesOnce() {
  if (document.getElementById('agenda-dnd-style')) return;
  const st = document.createElement('style');
  st.id = 'agenda-dnd-style';
  st.textContent = `
    .agenda-card.is-dragging { opacity: .6; }
    .agenda-drop-target { outline: 2px dashed #0ea5e9; outline-offset: -2px; background: rgba(14,165,233,0.06); }
  `;
  document.head.appendChild(st);
}

export async function moveAppointmentQuick(id, payload) {
  try {
    const body = { ...payload, storeId: state.selectedStoreId || els.storeSelect?.value };
    const resp = await api(`/func/agendamentos/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Erro ao mover agendamento');
    }
    await loadAgendamentos();
    renderKpis();
    renderFilters();
    renderGrid();
    enhanceAgendaUI();
  } catch (e) {
    console.error('moveAppointmentQuick', e);
    alert(e.message || 'Não foi possível mover o agendamento.');
  }
}

export function enableDragDrop() {
  injectDndStylesOnce();
  const grids = els.agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
  const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
  if (!body) return;
  body.querySelectorAll('div[data-appointment-id]').forEach((card) => {
    if (!card.hasAttribute('draggable')) card.setAttribute('draggable', 'true');
  });
  if (body.__dndDelegated) return;
  body.__dndDelegated = true;

  body.addEventListener('dragstart', (ev) => {
    const card = ev.target?.closest?.('div[data-appointment-id]');
    if (!card || !ev.dataTransfer) return;
    const id = card.getAttribute('data-appointment-id') || '';
    if (!id) return;
    try {
      const item = (state.agendamentos || []).find(x => String(x._id) === String(id));
      if (item && (item.pago || item.codigoVenda) && !isPrivilegedRole()) {
        ev.preventDefault(); ev.stopPropagation();
        alert('Agendamento faturado: não é possível mover. (Somente Admin/Admin Master)');
        return;
      }
    } catch {}
    try { ev.dataTransfer.setData('text/plain', id); } catch {}
    try { ev.dataTransfer.setDragImage(card, 10, 10); } catch {}
    ev.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  }, true);

  body.addEventListener('dragend', (ev) => {
    const card = ev.target?.closest?.('div[data-appointment-id]');
    if (card) card.classList.remove('is-dragging');
    body.querySelectorAll('.agenda-drop-target').forEach(s => s.classList.remove('agenda-drop-target'));
  }, true);

  body.addEventListener('dragover', (ev) => {
    const slot = ev.target?.closest?.('.agenda-slot');
    if (!slot) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    slot.classList.add('agenda-drop-target');
  });

  body.addEventListener('dragleave', (ev) => {
    const slot = ev.target?.closest?.('.agenda-slot');
    if (!slot) return;
    slot.classList.remove('agenda-drop-target');
  });

  body.addEventListener('drop', async (ev) => {
    const slot = ev.target?.closest?.('.agenda-slot');
    if (!slot) return;
    ev.preventDefault();
    const id = ev.dataTransfer?.getData('text/plain');
    if (!id) return;
    const item = state.agendamentos.find(x => String(x._id) === String(id));
    if (!item) return;
    const orig = new Date(item.h || item.scheduledAt);
    const day = slot.dataset.day || normalizeDate(els.dateInput?.value || todayStr());
    const hh  = slot.dataset.hh || `${pad(orig.getHours())}:${String(orig.getMinutes()).padStart(2,'0')}`;
    const payload = {};
    if (slot.dataset.profissionalId) payload.profissionalId = slot.dataset.profissionalId;
    payload.scheduledAt = buildLocalDateTime(day, hh).toISOString();
    await moveAppointmentQuick(id, payload);
  });
}

export function drawNowLine() {
  const grids = els.agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
  const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
  if (!body) return;
  body.querySelectorAll('.agenda-nowline').forEach(n => n.remove());
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const percent = minutes / (24 * 60);
  const y = Math.max(0, Math.min(1, percent)) * body.scrollHeight;
  const line = document.createElement('div');
  line.className = 'agenda-nowline';
  line.style.top = `${y}px`;
  body.appendChild(line);
  if (window.__agendaNowTimer) clearInterval(window.__agendaNowTimer);
  window.__agendaNowTimer = setInterval(() => {
    const now2 = new Date();
    const minutes2 = now2.getHours() * 60 + now2.getMinutes();
    const percent2 = minutes2 / (24 * 60);
    const y2 = Math.max(0, Math.min(1, percent2)) * body.scrollHeight;
    const ln = body.querySelector('.agenda-nowline');
    if (ln) ln.style.top = `${y2}px`;
  }, 60_000);
}
