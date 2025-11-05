import { state, isPrivilegedRole, notify, statusMeta } from './core.js';

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
      notify('Finalize a venda pelo PDV para gerar o código automaticamente.', 'info');
      return;
    }

    if (btn.classList.contains('edit')) {
      if ((item.pago || item.codigoVenda) && !isPrivilegedRole()) { notify('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.', 'warning'); return; }
      if (window.__openEditFromUI) window.__openEditFromUI(item);
      return;
    }

    if (btn.classList.contains('status')) {
      const cardEl = btn.closest('div[data-appointment-id]');
      const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
      const serviceItemIds = cardEl?.dataset?.serviceItemIds
        ? cardEl.dataset.serviceItemIds.split(',').map(v => v.trim()).filter(Boolean)
        : [];
      let baseStatus = cardEl?.dataset?.statusActionKey || '';
      if (baseStatus) {
        baseStatus = statusMeta(baseStatus).key;
      }
      if (serviceItemIds.length && Array.isArray(item?.servicos)) {
        const counts = new Map();
        item.servicos.forEach((svc) => {
          const itemId = svc?.itemId != null ? String(svc.itemId) : null;
          if (!itemId || !serviceItemIds.includes(itemId)) return;
          const key = statusMeta(svc?.status || svc?.situacao || item.status || 'agendado').key;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
        if (counts.size) {
          let candidate = baseStatus || statusMeta(item.status || 'agendado').key;
          let candidateCount = counts.get(candidate) || 0;
          counts.forEach((count, key) => {
            if (count > candidateCount) {
              candidate = key;
              candidateCount = count;
            }
          });
          baseStatus = candidate;
        }
      }
      if (!baseStatus) {
        baseStatus = statusMeta(item?.status || 'agendado').key;
      }
      let idx = chain.indexOf(baseStatus);
      if (idx < 0) idx = 0;
      const next = chain[(idx + 1) % chain.length];
      if (window.__updateStatusQuick) window.__updateStatusQuick(id, next, { serviceItemIds });
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
