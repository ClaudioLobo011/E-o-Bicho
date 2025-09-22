import { state, isPrivilegedRole, notify } from './core.js';

const ACTION_CLICK_GUARD = Symbol('agendaActionClickHandled');
const ACTION_BOUND_FLAG = '__banhoAgendaActionsBound';

function swallowPointerDown(ev) {
  const btn = ev.target?.closest?.('.agenda-action');
  if (!btn) return;
  try {
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
  } catch {}
  ev.stopPropagation();
}

function onActionClick(ev) {
  const btn = ev.target?.closest?.('.agenda-action');
  if (!btn) return;
  try {
    if (ev[ACTION_CLICK_GUARD]) return;
    ev[ACTION_CLICK_GUARD] = true;

    ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    ev.stopPropagation();

    const id = btn.getAttribute('data-id');
    if (!id) return;
    const item = (state.agendamentos || []).find(x => String(x._id) === String(id));
    if (!item) return;

    if (btn.classList.contains('cobrar')) {
      if (item.pago || item.codigoVenda) { notify('Este agendamento já possui código de venda registrado.', 'warning'); return; }
      // fecha edição, se aberta
      try {
        const modalAdd = document.getElementById('modal-add-servico');
        if (modalAdd && !modalAdd.classList.contains('hidden')) {
          modalAdd.classList.add('hidden');
          modalAdd.classList.remove('flex');
          modalAdd.style.display = 'none';
          modalAdd.setAttribute('aria-hidden', 'true');
        }
      } catch {}
      if (window.openVendaModal) window.openVendaModal(item);
      return;
    }

    if (btn.classList.contains('edit')) {
      const vm = document.getElementById('venda-modal');
      const vendaOpen = vm && !vm.classList.contains('hidden');
      if (vendaOpen) { try { vm.classList.add('hidden'); vm.setAttribute('aria-hidden','true'); } catch {} }
      if ((item.pago || item.codigoVenda) && !isPrivilegedRole()) { notify('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.', 'warning'); return; }
      if (window.__openEditFromUI) window.__openEditFromUI(item);
      return;
    }

    if (btn.classList.contains('status')) {
      const vm = document.getElementById('venda-modal');
      if (vm && !vm.classList.contains('hidden')) { try { vm.classList.add('hidden'); vm.setAttribute('aria-hidden','true'); } catch {} }
      const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
      const cur = (item && item.status) || 'agendado';
      const next = chain[(chain.indexOf(cur) + 1) % chain.length];
      if (window.__updateStatusQuick) window.__updateStatusQuick(id, next);
      return;
    }
  } catch (err) {
    console.error('onActionClick', err);
  }
}

export function attachGlobalActionHandlers() {
  if (typeof document === 'undefined') return;
  if (document[ACTION_BOUND_FLAG]) return;
  document[ACTION_BOUND_FLAG] = true;

  document.addEventListener('pointerdown', swallowPointerDown, true);
  document.addEventListener('click', onActionClick, true);
}
