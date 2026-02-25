import { els, state, isPrivilegedRole, notify, buildLocalDateTime, todayStr, normalizeDate, pad, api, statusMeta, isNoPreferenceProfessionalId, getVisibleProfissionais } from './core.js';
import { loadAgendamentos } from './agendamentos.js';
import { renderKpis, renderFilters } from './filters.js';
import { renderGrid } from './grid.js';

const CARD_ACTION_EVENT_FLAG = Symbol('agendaCardActionHandled');
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

function normalizeServiceItemId(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeServiceItemId(entry);
      if (normalized) return normalized;
    }
    return '';
  }
  if (typeof value === 'object') {
    if (value._id || value.id) {
      return normalizeServiceItemId(value._id || value.id);
    }
    return '';
  }
  const str = String(value).trim();
  if (!str) return '';
  const cleaned = str
    .replace(/^ObjectId\(["']?/, '')
    .replace(/["']?\)$/, '');
  return OBJECT_ID_REGEX.test(cleaned) ? cleaned : '';
}

function collectServiceItemIdsFromAppointment(appointment) {
  if (!appointment || typeof appointment !== 'object') return [];
  const ids = new Set();
  const services = Array.isArray(appointment.servicos) ? appointment.servicos : [];
  services.forEach((svc) => {
    const normalized = normalizeServiceItemId([
      svc?.itemId,
      svc?._id,
      svc?.id,
    ]);
    if (normalized) ids.add(normalized);
  });
  return Array.from(ids.values());
}

function getAppointmentDayISO(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const copy = new Date(date.getTime());
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

export function enhanceAgendaUI() {
  try {
    applyZebraAndSublines();
    decorateCards();
    enableSlotQuickAdd();
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

export function enableSlotQuickAdd() {
  if (!(state.view === 'day' || state.view === 'week' || state.view === 'month')) return;
  const grids = els.agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
  const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
  if (!body) return;
  if (body.__quickAddDelegated) return;
  body.__quickAddDelegated = true;

  body.addEventListener('click', (ev) => {
    if (ev.defaultPrevented) return;
    if (ev.button !== 0) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;

    // Ignore clicks on cards/actions/inputs and interactive controls.
    if (target.closest('button, a, input, select, textarea, label')) return;
    if (target.closest('[data-appointment-id]')) return;
    if (target.closest('.agenda-card__actions')) return;

    const slot = target.closest('.agenda-slot');
    if (!slot || !(slot instanceof HTMLElement)) return;
    const hasDay = Boolean(String(slot.dataset.day || '').trim());
    const hasHour = Boolean(String(slot.dataset.hh || '').trim());
    if (state.view === 'month') {
      if (!hasDay) return;
    } else {
      if (!hasHour) return; // hourly squares only (day/week)
      if (slot.classList.contains('is-off')) return;
    }

    const open = window.__openAddFromUI;
    if (typeof open !== 'function') return;

    const date = (slot.dataset.day || normalizeDate(els.dateInput?.value || todayStr())).trim();
    const hour = String(slot.dataset.hh || '').trim();
    const profissionalId = String(slot.dataset.profissionalId || '').trim();

    open({
      day: date,
      hh: hour,
      profissionalId,
    });
  });
}

export function scrollToNow() {
  const grids = els.agendaList?.querySelectorAll(':scope > div[style*="grid"]') || [];
  const body  = Array.from(grids).find(el => el.querySelector('.agenda-slot')) || grids[1] || grids[0];
  if (!body) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0') + ':00';
  const visibleProfs = getVisibleProfissionais() || [];
  const firstProf = visibleProfs.find((p) => !isNoPreferenceProfessionalId(p?._id)) || visibleProfs[0];
  const firstProfId = String(firstProf?._id || '');
  if (!firstProfId) return;
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
  const totalCols = state.view === 'day'
    ? 1 + (getVisibleProfissionais()?.length || 0)
    : 1 + (state.profissionais?.length || 0);
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
    actions.className = 'agenda-card__actions';
    actions.innerHTML = `
      <div class="agenda-card__actions-row">
        <button type="button" class="agenda-action edit" data-id="${id}" title="Editar" aria-label="Editar agendamento">
          <i class="fa-solid fa-pen text-[15px] leading-none"></i>
        </button>
        <button type="button" class="agenda-action status" data-id="${id}" title="Mudar status" aria-label="Mudar status do agendamento">
          <i class="fa-regular fa-clock text-[15px] leading-none"></i>
        </button>
      </div>
      <button type="button" class="agenda-action cobrar ${isPaid ? 'text-green-600' : 'text-slate-500'}" data-id="${id}" title="${isPaid ? 'Pago' : 'Registrar pagamento'}" aria-label="${isPaid ? 'Pagamento já registrado' : 'Registrar pagamento'}">
        <i class="fa-solid fa-dollar-sign text-[15px] leading-none"></i>
      </button>
    `;
    card.appendChild(actions);
    card.classList.add('agenda-card--with-actions');
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
          if (e[CARD_ACTION_EVENT_FLAG]) return;
          e[CARD_ACTION_EVENT_FLAG] = true;
          if (current.pago || current.codigoVenda) {
            notify('Este agendamento já possui código de venda registrado.', 'warning');
            return;
          }
          notify('Finalize a venda pelo PDV para gerar o código automaticamente.', 'info');
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
          const current = (state.agendamentos || []).find(x => String(x._id) === String(id));
          if (!current) return;
          if (e[CARD_ACTION_EVENT_FLAG]) return;
          e[CARD_ACTION_EVENT_FLAG] = true;
          const cardEl = editBtn.closest?.('div[data-appointment-id]') || null;
          const releaseFocus = () => {
            try {
              const active = document.activeElement;
              if (active && cardEl?.contains?.(active) && typeof active.blur === 'function') {
                active.blur();
              } else if (typeof editBtn.blur === 'function') {
                editBtn.blur();
              }
            } catch (err) { console.error('edit-release-focus', err); }
          };
          if ((current.pago || current.codigoVenda) && !isPrivilegedRole()) {
            notify('Este agendamento já foi faturado. Apenas Admin/Admin Master podem editar.', 'warning');
            return;
          }
          releaseFocus();
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(releaseFocus);
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
      let tooltipDetails = [];
      if (card.dataset.statusDetails) {
        try {
          const parsed = JSON.parse(card.dataset.statusDetails);
          if (Array.isArray(parsed)) {
            tooltipDetails = parsed.filter(Boolean);
          }
        } catch (err) {
          console.error('status-tooltip-parse', err);
        }
      }
      if (tooltipDetails.length > 1) {
        const entries = tooltipDetails.map((detail) => {
          const meta = statusMeta(detail?.status || detail?.situacao || 'agendado');
          const itemId = normalizeServiceItemId([
            detail?.itemId,
            detail?.serviceItemId,
            detail?.serviceId,
          ]);
          const name = typeof detail?.name === 'string' && detail.name.trim()
            ? detail.name.trim()
            : (typeof detail?.nome === 'string' ? detail.nome.trim() : 'Serviço');
          return {
            name: name || 'Serviço',
            meta,
            itemId: itemId || null,
          };
        }).filter(item => item && item.name && item.meta);
        if (entries.length) {
          statusBtn.classList.add('agenda-action--has-status-tooltip');
          const tooltip = document.createElement('div');
          tooltip.className = 'agenda-status-tooltip';
          const list = document.createElement('ul');
          list.className = 'agenda-status-tooltip__list';
          entries.forEach((entry) => {
            const item = document.createElement('li');
            item.className = 'agenda-status-tooltip__item';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'agenda-status-tooltip__service';
            nameSpan.textContent = entry.name;
            const statusSpan = document.createElement('span');
            const applyMetaToItem = (meta) => {
              try {
                const metaObj = meta && meta.key ? meta : statusMeta(entry.meta?.key || 'agendado');
                statusSpan.className = `agenda-status-tooltip__state agenda-status-tooltip__state--${metaObj.key}`;
                statusSpan.textContent = metaObj.label;
                item.dataset.statusKey = metaObj.key;
              } catch (err) {
                console.error('status-tooltip-apply-meta', err);
              }
            };
            applyMetaToItem(entry.meta);
            item.appendChild(nameSpan);
            item.appendChild(statusSpan);
            if (entry.itemId) {
              item.classList.add('agenda-status-tooltip__item--actionable');
              item.dataset.serviceItemId = entry.itemId;
              item.setAttribute('role', 'button');
              item.tabIndex = 0;
              item.setAttribute('aria-label', `Mudar status do serviço ${entry.name}`);
              const handleItemActivation = (ev) => {
                try {
                  if (ev.type === 'keydown') {
                    const key = ev.key || ev.code || '';
                    if (!(key === 'Enter' || key === ' ' || key === 'Spacebar')) return;
                    ev.preventDefault();
                  }
                  ev.preventDefault();
                  if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                  ev.stopPropagation();
                  if (ev[CARD_ACTION_EVENT_FLAG]) return;
                  ev[CARD_ACTION_EVENT_FLAG] = true;
                  try {
                    if (typeof item.focus === 'function') {
                      item.focus({ preventScroll: true });
                    }
                  } catch {}
                  const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
                  const currentKey = entry.meta?.key || item.dataset.statusKey || 'agendado';
                  let idx = chain.indexOf(currentKey);
                  if (idx < 0) idx = 0;
                  const nextKey = chain[(idx + 1) % chain.length];
                  const nextMeta = statusMeta(nextKey);
                  const prevMeta = entry.meta;
                  applyMetaToItem(nextMeta);
                  entry.meta = nextMeta;
                  const updateFn = typeof window.__updateStatusQuick === 'function'
                    ? window.__updateStatusQuick
                    : null;
                  if (!updateFn) {
                    entry.meta = prevMeta;
                    applyMetaToItem(prevMeta);
                    return;
                  }
                  const normalizedId = normalizeServiceItemId(entry.itemId);
                  if (!normalizedId) {
                    entry.meta = prevMeta;
                    applyMetaToItem(prevMeta);
                    return;
                  }
                  const request = updateFn(id, nextKey, { serviceItemIds: [normalizedId] });
                  if (request && typeof request.catch === 'function') {
                    request.catch((error) => {
                      console.error('status-tooltip-item-update', error);
                      entry.meta = prevMeta;
                      applyMetaToItem(prevMeta);
                    });
                  }
                } catch (error) {
                  console.error('status-tooltip-item-activate', error);
                }
              };
              item.addEventListener('click', handleItemActivation, true);
              item.addEventListener('keydown', handleItemActivation, true);
            }
            list.appendChild(item);
          });
          tooltip.appendChild(list);
          statusBtn.appendChild(tooltip);
        }
      }
      const handlerStatus = (e) => {
        try {
          const targetEl = e?.target instanceof Element
            ? e.target
            : (e?.target && 'parentElement' in e.target ? e.target.parentElement : null);
          const actionableItem = targetEl?.closest?.('.agenda-status-tooltip__item--actionable');
          if (actionableItem && statusBtn.contains(actionableItem)) {
            return;
          }
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          e.stopPropagation();
          const current = (state.agendamentos || []).find(x => String(x._id) === String(id));
          if (!current) return;
          if (e[CARD_ACTION_EVENT_FLAG]) return;
          e[CARD_ACTION_EVENT_FLAG] = true;
          const cardEl = statusBtn.closest('div[data-appointment-id]');
          const chain = ['agendado', 'em_espera', 'em_atendimento', 'finalizado'];
          const serviceItemIds = cardEl?.dataset?.serviceItemIds
            ? cardEl.dataset.serviceItemIds
                .split(',')
                .map((v) => normalizeServiceItemId(v))
                .filter(Boolean)
            : [];
          let baseStatus = cardEl?.dataset?.statusActionKey || '';
          if (baseStatus) {
            baseStatus = statusMeta(baseStatus).key;
          }
          if (serviceItemIds.length && Array.isArray(current.servicos)) {
            const counts = new Map();
            current.servicos.forEach((svc) => {
              const itemId = svc?.itemId != null ? String(svc.itemId) : null;
              if (!itemId || !serviceItemIds.includes(itemId)) return;
              const key = statusMeta(svc?.status || svc?.situacao || current.status || 'agendado').key;
              counts.set(key, (counts.get(key) || 0) + 1);
            });
            if (counts.size) {
              let candidate = baseStatus || statusMeta(current.status || 'agendado').key;
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
            baseStatus = statusMeta(current.status || 'agendado').key;
          }
          let idx = chain.indexOf(baseStatus);
          if (idx < 0) idx = 0;
          const next = chain[(idx + 1) % chain.length];
          if (window.__updateStatusQuick) {
            window.__updateStatusQuick(id, next, { serviceItemIds });
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
    const serviceIds = card.dataset.serviceItemIds || '';
    try { ev.dataTransfer.setData('text/x-service-ids', serviceIds); } catch {}
    card.dataset.draggingServiceIds = serviceIds;
    try { ev.dataTransfer.setDragImage(card, 10, 10); } catch {}
    ev.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  }, true);

  body.addEventListener('dragend', (ev) => {
    const card = ev.target?.closest?.('div[data-appointment-id]');
    if (card) {
      card.classList.remove('is-dragging');
      delete card.dataset.draggingServiceIds;
    }
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
    const draggingCard = body.querySelector('.agenda-card.is-dragging');
    const serviceIdsRaw = (ev.dataTransfer?.getData('text/x-service-ids') || draggingCard?.dataset.draggingServiceIds || '').trim();
    const item = state.agendamentos.find(x => String(x._id) === String(id));
    if (!item) return;

    const orig = new Date(item.h || item.scheduledAt);
    const day = slot.dataset.day || normalizeDate(els.dateInput?.value || todayStr());
    const hh = slot.dataset.hh || `${pad(orig.getHours())}:${String(orig.getMinutes()).padStart(2, '0')}`;
    const targetDateIso = buildLocalDateTime(day, hh).toISOString();

    const allServiceItemIds = collectServiceItemIdsFromAppointment(item);
    const normalizedServiceIds = serviceIdsRaw
      ? Array.from(new Set(serviceIdsRaw.split(',').map(s => normalizeServiceItemId(s)).filter(Boolean)))
      : [];

    let shouldMoveAll = false;
    if (!allServiceItemIds.length) {
      shouldMoveAll = true;
    } else if (!normalizedServiceIds.length) {
      shouldMoveAll = true;
    } else {
      const normalizedSet = new Set(normalizedServiceIds);
      shouldMoveAll = allServiceItemIds.every(idCandidate => normalizedSet.has(idCandidate));
    }

    const finalServiceItemIds = shouldMoveAll
      ? (allServiceItemIds.length ? allServiceItemIds.slice() : normalizedServiceIds.slice())
      : normalizedServiceIds.slice();

    const payload = {};
    const slotProfId = String(slot.dataset.profissionalId || '').trim();
    if (slotProfId && !isNoPreferenceProfessionalId(slotProfId)) {
      payload.profissionalId = slotProfId;
    } else if (slotProfId && isNoPreferenceProfessionalId(slotProfId)) {
      payload.profissionalId = null;
    }

    const originalDay = getAppointmentDayISO(item.h || item.scheduledAt);
    const sameDay = originalDay && day ? originalDay === day : false;

    if (finalServiceItemIds.length) {
      payload.serviceItemIds = finalServiceItemIds;
      payload.serviceHour = hh;
      payload.serviceScheduledAt = targetDateIso;
    }

    if (shouldMoveAll) {
      payload.scheduledAt = targetDateIso;
    } else if (!sameDay) {
      payload.scheduledAt = targetDateIso;
    }

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
