import { internacaoDataset } from './data.js';

function normalizeActionKey(value) {
  if (!value) return '';
  const normalized = typeof value.normalize === 'function' ? value.normalize('NFD') : value;
  return normalized.replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

function getLocalISODate(dateInput = new Date()) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatMapaDateLabel(isoDate) {
  if (!isoDate) return 'Data não informada';
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const riscoColors = {
  'nao-urgente': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  'pouco-urgente': 'bg-lime-50 text-lime-700 ring-1 ring-lime-100',
  urgente: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  'muito-urgente': 'bg-orange-50 text-orange-700 ring-1 ring-orange-100',
  emergencia: 'bg-red-50 text-red-700 ring-1 ring-red-100',
};

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function filterPacientes(dataset, petId) {
  if (!petId) return dataset.pacientes;
  return dataset.pacientes.filter((pet) => pet.id === petId);
}

function matchesEmpresaFilter(registro, empresaId) {
  const target = String(empresaId || '').trim();
  if (!target) return true;
  const current = String(registro?.empresaId || '').trim();
  return current && current === target;
}

function buildPendencias(list = []) {
  if (!list.length) return '<p class="text-sm text-gray-500">Sem pendências registradas.</p>';
  return `
    <ul class="space-y-1 text-sm text-gray-600">
      ${list.map((item) => `<li class="flex items-start gap-2"><i class="mt-1 text-xs text-amber-500 fas fa-exclamation-triangle"></i><span>${item}</span></li>`).join('')}
    </ul>
  `;
}

function buildEmptyState(message) {
  return `
    <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-sm text-gray-500">
      ${message}
    </div>
  `;
}

function resolveExecucaoDayKey(item, fallbackDate) {
  if (!item || typeof item !== 'object') return fallbackDate || getLocalISODate();
  const normalizeDateKey = (value) => {
    if (!value) return '';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return getLocalISODate(date);
  };
  return (
    normalizeDateKey(item.programadoData) ||
    normalizeDateKey(item.programadoEm) ||
    normalizeDateKey(item.realizadoData) ||
    normalizeDateKey(item.realizadoEm) ||
    fallbackDate ||
    getLocalISODate()
  );
}

function normalizeExecucaoItems(list, fallbackDate) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const horario = typeof item.horario === 'string' ? item.horario.trim() : '';
      const hourKey = horario ? horario.slice(0, 2).padStart(2, '0') : '';
      const dayKey = resolveExecucaoDayKey(item, fallbackDate);
      if (!hourKey) return null;
      return {
        ...item,
        horario,
        hourKey,
        dayKey,
      };
    })
    .filter(Boolean);
}

function isExecucaoConcluida(item) {
  const status = String(item?.status || '').toLowerCase();
  return status.includes('conclu') || status.includes('finaliz') || status.includes('realiz');
}

function isExecucaoInterrompida(item) {
  const status = String(item?.status || '').toLowerCase();
  return status.includes('interromp');
}

function hasNecessarioFlag(value) {
  if (!value) return false;
  return String(value)
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .includes('necess');
}

function isExecucaoSobDemanda(item) {
  if (!item || typeof item !== 'object') return false;

  if (item.sobDemanda === true || item.sobDemanda === 'true') return true;

  const status = String(item?.status || '').toLowerCase();
  if (status.includes('sob demanda') || status.includes('necess')) return true;

  return [
    item.frequencia,
    item.freq,
    item.tipoFrequencia,
    item.prescricaoFrequencia,
    item.prescricaoTipo,
    item.programadoLabel,
    item.resumo,
    item.tipo,
  ].some((value) => hasNecessarioFlag(value));
}

function formatExecucaoProgramadaLabel(item) {
  if (!item || typeof item !== 'object') return '—';
  if (item.programadoLabel) return String(item.programadoLabel).trim() || '—';
  if (item.programadoISO) return formatDateTime(item.programadoISO);
  if (item.programadoData && item.programadoHora) {
    const parts = String(item.programadoData).split('-');
    if (parts.length === 3) {
      const [ano, mes, dia] = parts;
      return `${dia}/${mes}/${ano} às ${item.programadoHora}`;
    }
    return `${item.programadoData} às ${item.programadoHora}`;
  }
  if (item.programadoData) {
    const parts = String(item.programadoData).split('-');
    if (parts.length === 3) {
      const [ano, mes, dia] = parts;
      return `${dia}/${mes}/${ano}`;
    }
    return String(item.programadoData);
  }
  if (item.horario) return String(item.horario);
  return '—';
}

function getRiscoBadgeClass(code) {
  const key = String(code || '').toLowerCase();
  return riscoColors[key] || 'bg-gray-100 text-gray-700 ring-1 ring-gray-100';
}

function ensureOverlayOnTop(modal) {
  if (!modal || typeof document === 'undefined') return;

  const adjust = () => {
    try {
      const all = Array.from(document.querySelectorAll('body *'));
      const overlays = all.filter((element) => {
        const style = getComputedStyle(element);
        if (style.position !== 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
      });
      const overlay = modal || overlays.at(-1);
      if (overlay) {
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'auto';
      }
    } catch (_) {}
  };

  if (typeof window !== 'undefined') {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(adjust);
    }
    setTimeout(adjust, 0);
  }
}

function openExecucaoModal(paciente, hourLabel, items = [], options = {}) {
  if (!paciente) return;

  const existing = document.getElementById('internacao-exec-modal');
  if (existing) existing.remove();

  const quandoNecessarios = Array.isArray(options.quandoNecessarios) ? options.quandoNecessarios : [];
  const selectedDate = options.selectedDate || '';
  const selectedHour = options.selectedHour || hourLabel;

  const nome = paciente.nome || paciente.pet?.nome || 'Paciente';
  const boxLabel =
    paciente.boxLabel ||
    paciente.box ||
    paciente.internacao?.box ||
    paciente.registro?.box ||
    'Sem box definido';
  const servicoLabel =
    paciente.servicoLabel ||
    paciente.servico ||
    paciente.registro?.queixa ||
    paciente.registro?.diagnostico ||
    paciente.agenda?.servico ||
    'Internação em andamento';

  const actionButtons = [
    {
      label: 'Prescrição Médica',
      icon: 'fa-file-medical',
      key: 'prescricao-medica',
    },
    {
      label: 'Ocorrência',
      icon: 'fa-comment-medical',
      key: 'ocorrencia',
    },
    {
      label: 'Peso',
      icon: 'fa-weight',
      key: 'peso',
    },
    {
      label: 'Parâmetros Clínicos',
      icon: 'fa-heartbeat',
      key: 'parametros-clinicos',
    },
  ]
    .map(
      (action) => `
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          title="${action.label}"
          data-quick-action="${escapeHtml(action.key)}"
          data-record-id="${escapeHtml(paciente.recordId || '')}"
          data-pet-key="${escapeHtml(paciente.key || '')}"
          data-selected-date="${escapeHtml(selectedDate || '')}"
          data-selected-hour="${escapeHtml(selectedHour || '')}"
        >
          <i class="text-base fas ${action.icon}"></i>
          <span>${action.label}</span>
        </button>
      `,
    )
    .join('');

  const overlay = document.createElement('div');
  overlay.id = 'internacao-exec-modal';
  overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 py-6';
  overlay.dataset.recordId = paciente.recordId || '';
  overlay.dataset.petKey = paciente.key || '';
  overlay.dataset.selectedDate = selectedDate || '';
  overlay.dataset.selectedHour = selectedHour || '';
  const procedimentosMarkup = items.length
    ? items
        .map((item, index) => {
          const responsavel = item.responsavel || 'Equipe a definir';
          const status = item.status || 'Agendado';
          const programado = formatExecucaoProgramadaLabel(item);
          return `
            <button
              type="button"
              class="group w-full rounded-xl border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-primary/50 hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-execucao-item
              data-execucao-index="${index}"
            >
              <p class="text-sm font-semibold text-gray-900">${escapeHtml(item.descricao || 'Procedimento')}</p>
              <p class="text-xs text-gray-500">Responsável: ${escapeHtml(responsavel)}</p>
              <p class="text-xs text-gray-400">Status: ${escapeHtml(status)} · Programado: ${escapeHtml(programado)}</p>
              <p class="mt-1 text-[11px] font-semibold uppercase tracking-wide text-primary opacity-0 transition group-hover:opacity-100">Detalhes</p>
            </button>
          `;
        })
        .join('')
    : '<p class="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">Nenhum procedimento registrado para este horário.</p>';

  const quandoNecessarioMarkup = quandoNecessarios.length
    ? quandoNecessarios
        .map((item, index) => {
          const responsavel = item.responsavel || 'Equipe a definir';
          const status = 'Sob demanda';
          const programado = formatExecucaoProgramadaLabel(item);
          return `
            <button
              type="button"
              class="group w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-left transition hover:border-primary/60 hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-quando-necessario-item
              data-quando-necessario-index="${index}"
            >
              <div class="flex flex-col gap-1">
                <div>
                  <p class="text-sm font-semibold text-gray-900">${escapeHtml(item.descricao || 'Procedimento')}</p>
                  <p class="text-xs text-gray-500">Responsável: ${escapeHtml(responsavel)}</p>
                  <p class="text-xs text-gray-400">Status: ${escapeHtml(status)} · Referência: ${escapeHtml(programado)}</p>
                </div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-primary">Registrar horário e observação</p>
              </div>
            </button>
          `;
        })
        .join('')
    : '';

  overlay.innerHTML = `
    <div class="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
      <div class="border-b border-gray-100 pb-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-primary">Mapa de execução</p>
            <h2 class="text-lg font-bold text-gray-900">${escapeHtml(nome)}</h2>
            <p class="text-sm text-gray-500">${escapeHtml(boxLabel)} · ${escapeHtml(servicoLabel)}</p>
            <p class="text-xs text-gray-400">Horário: ${hourLabel}</p>
          </div>
          <button type="button" class="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" data-close-modal>
            <i class="fas fa-xmark text-lg"></i>
          </button>
        </div>
      </div>
      <div class="mt-4 space-y-3">${procedimentosMarkup}</div>
      ${
        quandoNecessarioMarkup
          ? `<div class="mt-5 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-primary">Quando necessário</p>
                  <p class="text-xs text-gray-600">Selecione para concluir em qualquer horário.</p>
                </div>
              </div>
              <div class="mt-3 space-y-2">${quandoNecessarioMarkup}</div>
            </div>`
          : ''
      }
      <div class="mt-6 flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
        ${actionButtons}
        <button type="button" class="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50" data-close-modal>
          Fechar
        </button>
      </div>
    </div>
  `;

  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });

  overlay.querySelectorAll('[data-quick-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const actionKey = btn.dataset.quickAction || '';
      if (actionKey === 'parametros-clinicos') {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        overlay.setAttribute('aria-hidden', 'true');
        window.dispatchEvent(
          new CustomEvent('internacao:execucao:parametros', {
            detail: {
              recordId: btn.dataset.recordId || overlay.dataset.recordId || '',
              petKey: btn.dataset.petKey || overlay.dataset.petKey || '',
              selectedDate: btn.dataset.selectedDate || overlay.dataset.selectedDate || '',
              selectedHour: btn.dataset.selectedHour || overlay.dataset.selectedHour || '',
              overlay,
            },
          }),
        );
        return;
      }
      if (actionKey === 'prescricao-medica') {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        overlay.setAttribute('aria-hidden', 'true');
        window.dispatchEvent(
          new CustomEvent('internacao:execucao:prescricao', {
            detail: {
              recordId: btn.dataset.recordId || overlay.dataset.recordId || '',
              petKey: btn.dataset.petKey || overlay.dataset.petKey || '',
              overlay,
            },
          }),
        );
        return;
      }
      if (actionKey === 'ocorrencia') {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        overlay.setAttribute('aria-hidden', 'true');
        window.dispatchEvent(
          new CustomEvent('internacao:execucao:ocorrencia', {
            detail: {
              recordId: btn.dataset.recordId || overlay.dataset.recordId || '',
              petKey: btn.dataset.petKey || overlay.dataset.petKey || '',
              overlay,
            },
          }),
        );
        return;
      }
      if (actionKey === 'peso') {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        overlay.setAttribute('aria-hidden', 'true');
        window.dispatchEvent(
          new CustomEvent('internacao:execucao:peso', {
            detail: {
              recordId: btn.dataset.recordId || overlay.dataset.recordId || '',
              petKey: btn.dataset.petKey || overlay.dataset.petKey || '',
              overlay,
            },
          }),
        );
        return;
      }
      closeModal();
    });
  });

  overlay.querySelectorAll('[data-execucao-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.execucaoIndex);
      if (!Number.isFinite(index)) return;
      const current = items[index];
      if (!current) return;
      openExecucaoDetalheModal(paciente, current);
    });
  });

  overlay.querySelectorAll('[data-quando-necessario-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.quandoNecessarioIndex);
      if (!Number.isFinite(index)) return;
      const current = quandoNecessarios[index];
      if (!current) return;
      openExecucaoDetalheModal(paciente, current, {
        forceStatus: 'Concluída',
        clearRealizado: true,
        defaultDate: selectedDate,
        defaultHour: selectedHour,
      });
    });
  });

  document.body.appendChild(overlay);
}

function openExecucaoDetalheModal(paciente, item, options = {}) {
  if (!paciente || !item) return;

  const existing = document.getElementById('internacao-exec-detalhe-modal');
  if (existing) existing.remove();

  const parentOverlay = document.getElementById('internacao-exec-modal');
  let prevVisibility;
  let prevPointerEvents;
  if (parentOverlay) {
    prevVisibility = parentOverlay.style.visibility;
    prevPointerEvents = parentOverlay.style.pointerEvents;
    parentOverlay.style.visibility = 'hidden';
    parentOverlay.style.pointerEvents = 'none';
  }

  const nome = paciente.nome || paciente.pet?.nome || 'Paciente';
  const boxLabel =
    paciente.boxLabel ||
    paciente.box ||
    paciente.internacao?.box ||
    paciente.registro?.box ||
    'Sem box definido';
  const servicoLabel =
    paciente.servicoLabel ||
    paciente.servico ||
    paciente.registro?.queixa ||
    paciente.registro?.diagnostico ||
    paciente.agenda?.servico ||
    'Internação em andamento';
  const programadoLabel = formatExecucaoProgramadaLabel(item);

  const overlay = document.createElement('div');
  overlay.id = 'internacao-exec-detalhe-modal';
  overlay.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6';
  overlay.innerHTML = `
    <div class="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
      <div class="border-b border-gray-100 pb-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-primary">Atualizar procedimento</p>
            <h2 class="text-lg font-bold text-gray-900">${escapeHtml(nome)}</h2>
            <p class="text-sm text-gray-500">${escapeHtml(boxLabel)} · ${escapeHtml(servicoLabel)}</p>
            <p class="text-xs text-gray-400">Programado para ${escapeHtml(programadoLabel)}</p>
          </div>
          <button type="button" class="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" data-close-modal>
            <i class="fas fa-xmark text-lg"></i>
          </button>
        </div>
      </div>
      <form class="mt-5 flex flex-col gap-5" data-execucao-form>
        <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Procedimento*
          <textarea rows="2" class="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600" data-execucao-descricao readonly></textarea>
        </label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Situação
            <select class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-execucao-status>
              <option value="Agendada">Agendada</option>
              <option value="Concluída">Concluída</option>
            </select>
          </label>
          <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Programado para
            <input type="text" class="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600" data-execucao-programado readonly />
          </label>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Realizado em*
            <input type="date" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-execucao-data required />
          </label>
          <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hora*
            <div class="mt-1 flex items-center gap-2">
              <input type="time" class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-execucao-hora required />
              <button type="button" class="rounded-lg border border-primary/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/5" data-execucao-now>Agora</button>
            </div>
          </label>
        </div>
        <label class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Observações
          <textarea rows="3" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-execucao-observacoes placeholder="Registrar observações sobre a aplicação"></textarea>
        </label>
        <p class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700" data-execucao-error></p>
        <div class="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition hover:bg-gray-50" data-close-modal>Cancelar</button>
          <button type="submit" class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary/90" data-execucao-submit>Salvar</button>
        </div>
      </form>
    </div>
  `;

  const closeModal = () => {
    overlay.remove();
    if (parentOverlay) {
      parentOverlay.style.visibility = prevVisibility || '';
      parentOverlay.style.pointerEvents = prevPointerEvents || '';
      ensureOverlayOnTop(parentOverlay);
    }
  };
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });

  const form = overlay.querySelector('[data-execucao-form]');
  const { defaultDate, defaultHour, forceStatus } = options || {};

  if (form) {
    const descricaoField = form.querySelector('[data-execucao-descricao]');
    const statusField = form.querySelector('[data-execucao-status]');
    const programadoField = form.querySelector('[data-execucao-programado]');
    const dataField = form.querySelector('[data-execucao-data]');
    const horaField = form.querySelector('[data-execucao-hora]');
    const obsField = form.querySelector('[data-execucao-observacoes]');
    const errorBox = form.querySelector('[data-execucao-error]');
    const submitBtn = form.querySelector('[data-execucao-submit]');
    const lockConcluida = isExecucaoConcluida(item) && !options.allowConcluidaEdicao;

    if (descricaoField) {
      descricaoField.value = item.descricao || item.resumo || 'Procedimento registrado.';
    }
    if (statusField) {
      statusField.value = item.status && /conclu/i.test(item.status) ? 'Concluída' : 'Agendada';
    }
    if (programadoField) {
      programadoField.value = programadoLabel;
    }
    if (dataField) {
      dataField.value = item.realizadoData || item.programadoData || (item.realizadoISO ? item.realizadoISO.slice(0, 10) : '');
    }
    if (horaField) {
      horaField.value = item.realizadoHora || item.programadoHora || (item.realizadoISO ? item.realizadoISO.slice(11, 16) : '');
    }
    if (obsField) {
      obsField.value = item.observacoes || '';
    }

    if (statusField && forceStatus) {
      statusField.value = forceStatus;
    }
    if (dataField && defaultDate) {
      dataField.value = defaultDate;
    }
    if (horaField && defaultHour) {
      horaField.value = defaultHour;
    }
    if (options.clearRealizado) {
      if (dataField) dataField.value = '';
      if (horaField) horaField.value = '';
      if (obsField) obsField.value = '';
    }

    const setError = (message) => {
      if (!errorBox) return;
      const text = String(message || '').trim();
      errorBox.textContent = text;
      errorBox.classList.toggle('hidden', !text);
    };

    const setLoading = (isLoading) => {
      if (!submitBtn) return;
      if (!submitBtn.dataset.defaultLabel) {
        submitBtn.dataset.defaultLabel = submitBtn.textContent.trim();
      }
      submitBtn.disabled = !!isLoading;
      submitBtn.classList.toggle('opacity-60', !!isLoading);
      submitBtn.textContent = isLoading ? 'Salvando...' : submitBtn.dataset.defaultLabel;
    };

    if (lockConcluida) {
      if (statusField) {
        statusField.disabled = true;
        statusField.classList.add('cursor-not-allowed', 'bg-gray-100', 'text-gray-500');
      }
      if (dataField) {
        dataField.readOnly = true;
        dataField.classList.add('cursor-not-allowed', 'bg-gray-50', 'text-gray-500');
      }
      if (horaField) {
        horaField.readOnly = true;
        horaField.classList.add('cursor-not-allowed', 'bg-gray-50', 'text-gray-500');
      }
      if (obsField) {
        obsField.readOnly = true;
        obsField.classList.add('cursor-not-allowed', 'bg-gray-50', 'text-gray-500');
      }
      form.querySelectorAll('[data-execucao-now]').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
      });
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Concluída';
        submitBtn.classList.add('cursor-not-allowed', 'opacity-60');
      }
    }

    const fillNow = () => {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      if (dataField) {
        dataField.value = local.toISOString().slice(0, 10);
      }
      if (horaField) {
        horaField.value = local.toISOString().slice(11, 16);
      }
      if (statusField) {
        statusField.value = 'Concluída';
      }
    };

    const nowBtn = form.querySelector('[data-execucao-now]');
    if (nowBtn) {
      nowBtn.addEventListener('click', (event) => {
        event.preventDefault();
        fillNow();
      });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (lockConcluida) {
        setError('Procedimentos concluídos não podem ser editados.');
        return;
      }
      setError('');
      const recordId = paciente.recordId || paciente.id || '';
      if (!recordId) {
        setError('Não foi possível identificar a internação deste procedimento.');
        return;
      }
      if (!item.id) {
        setError('Não foi possível identificar o procedimento selecionado.');
        return;
      }
      const realizadoData = (dataField?.value || '').trim();
      const realizadoHora = (horaField?.value || '').trim();
      if (!realizadoData || !realizadoHora) {
        setError('Preencha a data e a hora de realização antes de salvar.');
        return;
      }
      if (statusField) {
        statusField.value = 'Concluída';
      }
      const detail = {
        recordId,
        execucaoId: item.id,
        payload: {
          status: 'Concluída',
          realizadoData,
          realizadoHora,
          observacoes: (obsField?.value || '').trim(),
        },
        handled: false,
        close: closeModal,
        onError: (message) => {
          setError(message);
        },
        onComplete: () => {
          setLoading(false);
        },
      };
      setLoading(true);
      window.dispatchEvent(new CustomEvent('internacao:execucao:submit', { detail }));
      if (!detail.handled) {
        setLoading(false);
        setError('Não foi possível enviar a atualização. Tente novamente.');
      }
    });
  }

  document.body.appendChild(overlay);
  ensureOverlayOnTop(overlay);
}


function attachExecucaoModalHandlers(root, pacientes = [], selectedDate = '') {
  const map = new Map();
  pacientes.forEach((paciente) => {
    if (paciente && paciente.key) {
      map.set(paciente.key, paciente);
    }
  });
  root.querySelectorAll('[data-exec-trigger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const petKey = btn.dataset.petKey || btn.dataset.petId;
      const { hour } = btn.dataset;
      if (!petKey || !hour) return;
      const paciente = map.get(petKey);
      if (!paciente) return;
      const items = (paciente.execucoes || []).filter(
        (acao) => acao.hourKey === hour && (!selectedDate || acao.dayKey === selectedDate),
      );
      openExecucaoModal(paciente, `${hour}:00`, items, {
        quandoNecessarios: paciente.quandoNecessarios || [],
        selectedDate,
        selectedHour: `${hour}:00`,
      });
    });
  });
}

export function renderAnimaisInternados(root, dataset, state = {}) {
  const petId = state?.petId || '';
  const empresaId = state?.empresaId || '';
  const internacoes = Array.isArray(state?.internacoes) ? state.internacoes : [];

  const internacoesAtivas = internacoes.filter((registro) => {
    const situacaoKey = normalizeActionKey(registro?.situacao || registro?.situacaoCodigo);
    const cancelado = registro?.cancelado || situacaoKey === 'cancelado';
    const obito = registro?.obitoRegistrado || situacaoKey === 'obito';
    const alta = situacaoKey.includes('alta');
    return !(cancelado || obito || alta);
  });

  const internacoesFiltradas = empresaId
    ? internacoesAtivas.filter((registro) => matchesEmpresaFilter(registro, empresaId))
    : internacoesAtivas;

  if (state?.internacoesLoading) {
    root.innerHTML = buildEmptyState('Carregando internações...');
    return;
  }

  if (state?.internacoesError) {
    root.innerHTML = `
      <div class="rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-center">
        <p class="text-sm font-semibold text-red-700">${escapeHtml(state.internacoesError)}</p>
        <button type="button" class="mt-4 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500" data-internacoes-retry>
          Tentar novamente
        </button>
      </div>
    `;
    return;
  }

  if (!internacoesFiltradas.length) {
    const mensagem = empresaId
      ? 'Nenhuma internação ativa para a empresa selecionada.'
      : 'Nenhuma internação ativa no momento.';
    root.innerHTML = buildEmptyState(mensagem);
    return;
  }

  const total = internacoesFiltradas.length;
  const proximasAltas = internacoesFiltradas.filter((registro) => {
    if (!registro.altaPrevistaISO) return false;
    const alta = new Date(registro.altaPrevistaISO);
    if (Number.isNaN(alta.getTime())) return false;
    const diff = (alta - Date.now()) / (1000 * 60 * 60);
    return diff <= 48;
  }).length;
  const isolamento = internacoesFiltradas.filter((registro) => (registro.situacao || '').toLowerCase().includes('isolamento')).length;

  const resumo = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-2xl bg-primary/10 px-4 py-4 text-primary">
        <p class="text-xs font-semibold uppercase tracking-wide">Internados</p>
        <p class="text-3xl font-bold">${total}</p>
        <p class="text-sm text-primary/80">Fluxo consolidado</p>
      </div>
      <div class="rounded-2xl bg-emerald-50 px-4 py-4 text-emerald-700">
        <p class="text-xs font-semibold uppercase tracking-wide">Altas em 48h</p>
        <p class="text-3xl font-bold">${proximasAltas}</p>
        <p class="text-sm text-emerald-700/80">Planos de alta em revisão</p>
      </div>
      <div class="rounded-2xl bg-amber-50 px-4 py-4 text-amber-700">
        <p class="text-xs font-semibold uppercase tracking-wide">Isolamentos</p>
        <p class="text-3xl font-bold">${isolamento}</p>
        <p class="text-sm text-amber-700/80">Monitorar EPIs e protocolos</p>
      </div>
    </div>
  `;

  const registrosFiltrados = petId
    ? internacoesFiltradas.filter((registro) => registro.filterKey === petId)
    : internacoesFiltradas;

  const cardsContent = registrosFiltrados.length
    ? registrosFiltrados
        .map((registro) => {
          const meta = [registro.pet?.especie, registro.pet?.raca, registro.pet?.peso || registro.pet?.idade]
            .filter(Boolean)
            .join(' · ');
          const admissao = formatDateTime(registro.admissao);
          let altaPrevista = '—';
          if (registro.altaPrevistaISO) {
            altaPrevista = formatDateTime(registro.altaPrevistaISO);
          } else if (registro.altaPrevistaData) {
            const iso = `${registro.altaPrevistaData}T${registro.altaPrevistaHora || '00:00'}`;
            altaPrevista = formatDateTime(iso);
          }
          const riscoClass = getRiscoBadgeClass(registro.riscoCodigo);
          const tutorContato = [registro.tutor?.contato, registro.tutor?.documento].filter(Boolean).join(' · ');
          const recordIdentifier = escapeHtml(registro.id || registro.filterKey || String(registro.codigo || ''));
          return `
            <article class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
              <div class="flex flex-wrap items-start gap-4">
                <div class="flex-1 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-xl font-semibold text-gray-900">
                      <button type="button" class="text-left font-semibold text-gray-900 transition hover:text-primary focus:outline-none" data-open-ficha data-record-id="${recordIdentifier}">
                        ${escapeHtml(registro.pet?.nome || 'Paciente')}
                      </button>
                    </h2>
                    ${registro.situacao ? `<span class="rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 ring-1 ring-gray-100">Situação: ${escapeHtml(registro.situacao)}</span>` : ''}
                    ${registro.risco ? `<span class="rounded-full px-2 py-0.5 text-xs font-semibold ${riscoClass}">Risco: ${escapeHtml(registro.risco)}</span>` : ''}
                  </div>
                  <p class="text-sm text-gray-500">${meta ? escapeHtml(meta) : 'Sem detalhes do paciente'}</p>
                  <p class="text-sm text-gray-500">Tutor: <span class="font-medium text-gray-700">${escapeHtml(registro.tutor?.nome || '—')}</span></p>
                  ${tutorContato ? `<p class="text-xs text-gray-400">${escapeHtml(tutorContato)}</p>` : ''}
                </div>
                <div class="text-right text-sm text-gray-500 space-y-1">
                  <p>Código interno: <span class="font-semibold text-gray-900">${registro.codigo !== null ? `#${registro.codigo}` : '—'}</span></p>
                  <p>Admissão: <span class="font-semibold text-gray-900">${admissao}</span></p>
                  <p>Previsão de alta: <span class="font-semibold text-gray-900">${altaPrevista}</span></p>
                  <p>Box: <span class="font-semibold text-gray-900">${escapeHtml(registro.box || '—')}</span></p>
                </div>
              </div>
              <div class="mt-4 grid gap-4 md:grid-cols-3">
                <div class="rounded-xl bg-gray-50 p-3">
                  <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Equipe</p>
                  <p class="text-sm text-gray-500">Em desenvolvimento</p>
                </div>
                <div class="rounded-xl bg-gray-50 p-3 md:col-span-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Pendências da agenda</p>
                  <p class="text-sm text-gray-500">Em desenvolvimento</p>
                </div>
              </div>
            </article>
          `;
        })
        .join('')
    : buildEmptyState('Nenhuma internação encontrada para o filtro aplicado.');

  root.innerHTML = `${resumo}<div class="space-y-4">${cardsContent}</div>`;
}

export function renderMapaExecucao(root, dataset, state = {}) {
  const petId = state?.petId || '';
  const internacoes = Array.isArray(state?.internacoes) ? state.internacoes : [];
  const selectedDate = state?.execucaoData || getLocalISODate();

  if (state?.internacoesLoading && !internacoes.length) {
    root.innerHTML = buildEmptyState('Carregando mapa de execução...');
    return;
  }

  if (state?.internacoesError) {
    root.innerHTML = `
      <div class="rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-center">
        <p class="text-sm font-semibold text-red-700">${escapeHtml(state.internacoesError)}</p>
        <button type="button" class="mt-4 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500" data-internacoes-retry>
          Tentar novamente
        </button>
      </div>
    `;
    return;
  }

  const ativos = internacoes.filter((registro) => {
    const situacaoKey = normalizeActionKey(registro?.situacao || registro?.situacaoCodigo);
    const alta = registro?.altaRegistrada || situacaoKey.includes('alta');
    return !registro.cancelado && !registro.obitoRegistrado && !alta;
  });
  const filtrados = petId ? ativos.filter((registro) => registro.filterKey === petId) : ativos;

  if (!filtrados.length) {
    root.innerHTML = buildEmptyState(
      petId ? 'Nenhum paciente encontrado para o filtro selecionado.' : 'Nenhum paciente internado no momento.',
    );
    return;
  }

  const pacientes = filtrados.map((registro) => {
    const nome = registro.pet?.nome || (registro.codigo ? `Registro #${registro.codigo}` : 'Paciente');
    const execucoesNormalizadas = normalizeExecucaoItems(registro.execucoes);
    const execucoesDoDia = execucoesNormalizadas.filter(
      (item) =>
        item.dayKey === selectedDate &&
        (!isExecucaoSobDemanda(item) || (isExecucaoConcluida(item) && !isExecucaoInterrompida(item))),
    );
    const quandoNecessarios = Array.isArray(registro.execucoes)
      ? registro.execucoes.filter(
          (item) => isExecucaoSobDemanda(item) && !isExecucaoInterrompida(item) && !isExecucaoConcluida(item),
        )
      : [];
    return {
      key: registro.filterKey || registro.id || nome,
      recordId: registro.id || registro._id || registro.filterKey || nome,
      record: registro,
      nome,
      boxLabel: registro.box || 'Sem box definido',
      servicoLabel: registro.queixa || registro.diagnostico || 'Internação em andamento',
      equipeLabel: registro.veterinario || 'Equipe em definição',
      execucoes: execucoesDoDia,
      quandoNecessarios,
    };
  });

  const headerCells = HOURS.map(
    (hour) => `
      <th class="min-w-[56px] px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">${hour}:00</th>
    `,
  ).join('');

  const rows = pacientes
    .map((paciente) => {
      const hourCells = HOURS.map((hour) => {
        const atividades = (paciente.execucoes || []).filter((acao) => acao.hourKey === hour);
        if (!atividades.length) {
          return `
            <td class="border border-gray-100 px-2 py-2 text-center">
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-300 text-transparent transition hover:border-gray-400"
                aria-label="Registrar procedimentos de ${escapeHtml(paciente.nome)} às ${hour}:00"
                data-exec-trigger
                data-pet-key="${escapeHtml(paciente.key)}"
                data-hour="${hour}"
              >
                <span class="sr-only">Sem procedimentos</span>
              </button>
            </td>
          `;
        }
        return `
          <td class="border border-gray-100 px-2 py-2 text-center">
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white shadow-sm transition hover:bg-primary/90"
              title="${atividades.length} procedimentos"
              aria-label="Ver ${atividades.length} procedimentos de ${escapeHtml(paciente.nome)} às ${hour}:00"
              data-exec-trigger
              data-pet-key="${escapeHtml(paciente.key)}"
              data-hour="${hour}"
            >
              ${atividades.length}
            </button>
          </td>
        `;
      }).join('');

      return `
        <tr class="bg-white text-sm text-gray-700 shadow-sm">
          <td class="min-w-[220px] rounded-l-2xl border border-gray-100 px-4 py-3 align-top">
            <p class="text-base font-semibold text-gray-900">${escapeHtml(paciente.nome)}</p>
            <p class="text-xs text-gray-500">${escapeHtml(paciente.boxLabel)} · ${escapeHtml(paciente.servicoLabel)}</p>
            <p class="text-[11px] text-gray-400">Equipe: ${escapeHtml(paciente.equipeLabel)}</p>
          </td>
          ${hourCells}
        </tr>
      `;
    })
    .join('');

  root.innerHTML = `
    <div class="space-y-5">
      <div class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-[260px] flex-1">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Pet | Horário</p>
            <h2 class="text-xl font-bold text-gray-900">Mapa de execução</h2>
            <p class="text-sm text-gray-500">Clique no círculo para ver ou registrar os procedimentos daquele horário.</p>
          </div>
          <div class="order-3 flex basis-full items-center justify-center sm:order-none sm:flex-1" data-mapa-dia-selector>
            <div class="flex w-full max-w-[440px] flex-nowrap items-center justify-center gap-3 px-2">
              <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 shadow-sm transition hover:bg-gray-50" data-mapa-dia-prev aria-label="Dia anterior">
                <i class="fas fa-chevron-left"></i>
              </button>
              <div class="w-[260px] shrink-0 truncate whitespace-nowrap rounded-lg bg-gray-50 px-4 py-2 text-center text-sm font-semibold text-gray-800" data-mapa-dia-label>
                ${escapeHtml(formatMapaDateLabel(selectedDate))}
              </div>
              <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 shadow-sm transition hover:bg-gray-50" data-mapa-dia-next aria-label="Próximo dia">
                <i class="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>
          <div class="flex min-w-[240px] flex-1 items-center justify-end text-xs text-gray-500">
            <div class="flex items-center gap-3 text-right">
              <span class="inline-flex items-center gap-2"><span class="inline-flex h-3 w-3 rounded-full bg-primary/70"></span>Círculo = quantidade</span>
              <span class="inline-flex items-center gap-2"><span class="h-4 w-4 rounded-full border border-dashed border-gray-300"></span>Sem ações</span>
            </div>
          </div>
        </div>
        <div class="mt-6 overflow-x-auto">
          <table class="min-w-[960px] border-separate border-spacing-y-3">
            <thead>
              <tr>
                <th class="min-w-[220px] rounded-l-2xl bg-gray-50 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pet / Box</th>
                ${headerCells}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  attachExecucaoModalHandlers(root, pacientes, selectedDate);
}

export function renderHistoricoInternacoes(root, dataset, state = {}) {
  const petId = state?.petId || '';
  const internacoes = Array.isArray(state?.internacoes) ? state.internacoes : [];

  if (state?.internacoesLoading && !internacoes.length) {
    root.innerHTML = buildEmptyState('Carregando histórico...');
    return;
  }

  if (state?.internacoesError) {
    root.innerHTML = `
      <div class="rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-center">
        <p class="text-sm font-semibold text-red-700">${escapeHtml(state.internacoesError)}</p>
        <button type="button" class="mt-4 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500" data-internacoes-retry>
          Tentar novamente
        </button>
      </div>
    `;
    return;
  }

  const historicoConcluido = internacoes.filter((registro) => {
    const situacaoKey = normalizeActionKey(registro?.situacao || registro?.situacaoCodigo);
    const cancelado = registro?.cancelado || situacaoKey === 'cancelado';
    const obito = registro?.obitoRegistrado || situacaoKey === 'obito';
    const alta = situacaoKey.includes('alta');
    return cancelado || obito || alta;
  });

  const filtrados = petId ? historicoConcluido.filter((registro) => registro.filterKey === petId) : historicoConcluido;

  if (!filtrados.length) {
    root.innerHTML = buildEmptyState('Nenhuma internação encerrada encontrada para o filtro aplicado.');
    return;
  }

  const cardsContent = filtrados
    .map((registro) => {
      const meta = [registro.pet?.especie, registro.pet?.raca, registro.pet?.peso || registro.pet?.idade]
        .filter(Boolean)
        .join(' · ');
      const admissao = formatDateTime(registro.admissao);
      let altaPrevista = '—';
      if (registro.altaPrevistaISO) {
        altaPrevista = formatDateTime(registro.altaPrevistaISO);
      } else if (registro.altaPrevistaData) {
        const iso = `${registro.altaPrevistaData}T${registro.altaPrevistaHora || '00:00'}`;
        altaPrevista = formatDateTime(iso);
      }
      const riscoClass = getRiscoBadgeClass(registro.riscoCodigo);
      const tutorContato = [registro.tutor?.contato, registro.tutor?.documento].filter(Boolean).join(' · ');
      const situacaoKey = normalizeActionKey(registro?.situacao || registro?.situacaoCodigo);
      const statusLabel = registro.obitoRegistrado
        ? 'Óbito'
        : registro.cancelado || situacaoKey === 'cancelado'
          ? 'Cancelada'
          : registro.situacao || 'Alta registrada';
      const statusTone = registro.obitoRegistrado
        ? 'bg-red-50 text-red-700 ring-red-100'
        : registro.cancelado || situacaoKey === 'cancelado'
          ? 'bg-gray-100 text-gray-700 ring-gray-100'
          : 'bg-emerald-50 text-emerald-700 ring-emerald-100';
      const recordIdentifier = escapeHtml(registro.id || registro.filterKey || String(registro.codigo || ''));

      return `
        <article class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
          <div class="flex flex-wrap items-start gap-4">
            <div class="flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-semibold text-gray-900">
                  <button type="button" class="text-left font-semibold text-gray-900 transition hover:text-primary focus:outline-none" data-open-ficha data-record-id="${recordIdentifier}">
                    ${escapeHtml(registro.pet?.nome || 'Paciente')}
                  </button>
                </h2>
                <span class="rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone}">Situação: ${escapeHtml(statusLabel)}</span>
                ${registro.risco ? `<span class="rounded-full px-2 py-0.5 text-xs font-semibold ${riscoClass}">Risco: ${escapeHtml(registro.risco)}</span>` : ''}
              </div>
              <p class="text-sm text-gray-500">${meta ? escapeHtml(meta) : 'Sem detalhes do paciente'}</p>
              <p class="text-sm text-gray-500">Tutor: <span class="font-medium text-gray-700">${escapeHtml(registro.tutor?.nome || '—')}</span></p>
              ${tutorContato ? `<p class="text-xs text-gray-400">${escapeHtml(tutorContato)}</p>` : ''}
            </div>
            <div class="text-right text-sm text-gray-500 space-y-1">
              <p>Código interno: <span class="font-semibold text-gray-900">${registro.codigo !== null && registro.codigo !== undefined ? `#${registro.codigo}` : '—'}</span></p>
              <p>Admissão: <span class="font-semibold text-gray-900">${admissao}</span></p>
              <p>Previsão de alta: <span class="font-semibold text-gray-900">${altaPrevista}</span></p>
              <p>Box: <span class="font-semibold text-gray-900">${escapeHtml(registro.box || '—')}</span></p>
            </div>
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-3">
            <div class="rounded-xl bg-gray-50 p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Equipe</p>
              <p class="text-sm text-gray-500">Em desenvolvimento</p>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 md:col-span-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Pendências da agenda</p>
              <p class="text-sm text-gray-500">Em desenvolvimento</p>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  root.innerHTML = `<div class="space-y-4">${cardsContent}</div>`;
}

export function renderParametrosClinicos(
  root,
  dataset,
  { petId, parametrosConfig = [], parametrosLoading = false, parametrosError = '' } = {},
) {
  const pacientes = filterPacientes(dataset, petId);
  const configList = Array.isArray(parametrosConfig) ? parametrosConfig : [];

  let configuracoes = '';
  if (parametrosError) {
    configuracoes = `
      <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm text-amber-800">
        <p class="font-semibold">${escapeHtml(parametrosError)}</p>
        <button type="button" class="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100" data-parametros-retry>
          <i class="fas fa-rotate-right"></i>
          Tentar novamente
        </button>
      </div>
    `;
  } else if (parametrosLoading) {
    configuracoes = `
      <div class="flex items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <i class="fas fa-spinner animate-spin"></i>
        </span>
        Carregando parâmetros clínicos...
      </div>
    `;
  } else if (configList.length) {
    configuracoes = `
      <div class="divide-y divide-gray-100" data-parametros-list>
        ${configList
          .map(
            (item) => `
              <div class="flex flex-wrap items-start gap-3 py-3">
                <div class="min-w-[200px] flex-1">
                  <p class="text-sm font-semibold text-gray-900">${escapeHtml(item.nome || 'Parâmetro')}</p>
                  <p class="text-xs text-gray-500">
                    ${item.ordem ? `Ordem de exibição: ${escapeHtml(String(item.ordem))}` : 'Ordenação alfabética'}
                  </p>
                </div>
                <div class="flex flex-1 flex-wrap items-center gap-2 text-xs text-gray-600">
                  ${(Array.isArray(item.opcoes) && item.opcoes.length
                    ? item.opcoes
                        .map(
                          (opcao) =>
                            `<span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-700">${escapeHtml(
                              opcao,
                            )}</span>`,
                        )
                        .join('')
                    : '<span class="text-[11px] text-gray-400">Sem opções cadastradas</span>')}
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-primary/30 hover:text-primary" data-parametro-edit="${escapeHtml(item.id || '')}">
                    <i class="fas fa-pen"></i>
                    Editar
                  </button>
                  <button type="button" class="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50" data-parametro-delete="${escapeHtml(item.id || '')}">
                    <i class="fas fa-trash"></i>
                    Excluir
                  </button>
                </div>
              </div>
            `,
          )
          .join('')}
      </div>
    `;
  } else {
    configuracoes = `
      <div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
        Nenhum parâmetro cadastrado até o momento. Utilize o botão “Adicionar Parametro” para criar o primeiro.
      </div>
    `;
  }

  const blocos = pacientes.map((pet) => `
    <article class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
      <header class="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${pet.internacao.box}</p>
          <h2 class="text-lg font-semibold text-gray-900">${pet.nome}</h2>
        </div>
        <div class="text-right text-sm text-gray-500">
          <p>Último registro: <span class="font-semibold text-gray-800">${pet.internacao.parametros[0]?.coleta || '—'}</span></p>
          <p class="text-xs text-gray-400">Ficha clínica: ${internacaoDataset.agendaReferencia.fichaAtualizada}</p>
        </div>
      </header>
      <div class="mt-4 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th class="px-3 py-2 text-left">Coleta</th>
              <th class="px-3 py-2 text-left">Temp.</th>
              <th class="px-3 py-2 text-left">F. Cardíaca</th>
              <th class="px-3 py-2 text-left">F. Respiratória</th>
              <th class="px-3 py-2 text-left">P.A.</th>
              <th class="px-3 py-2 text-left">Escore de dor</th>
              <th class="px-3 py-2 text-left">Observação</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            ${pet.internacao.parametros.map((registro) => `
              <tr>
                <td class="px-3 py-2 text-gray-700">${registro.coleta}</td>
                <td class="px-3 py-2 text-gray-700">${registro.temp}</td>
                <td class="px-3 py-2 text-gray-700">${registro.fc}</td>
                <td class="px-3 py-2 text-gray-700">${registro.fr}</td>
                <td class="px-3 py-2 text-gray-700">${registro.pam}</td>
                <td class="px-3 py-2 text-gray-700">${registro.dor}</td>
                <td class="px-3 py-2 text-gray-700">${registro.observacao}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `).join('');

  root.innerHTML = `
    <div class="space-y-5">
      <article class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
        <header class="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Configuração</p>
            <h2 class="text-lg font-semibold text-gray-900">Parâmetros cadastrados</h2>
            <p class="text-sm text-gray-500">Revise os parâmetros disponíveis e suas opções de resposta.</p>
          </div>
          <div class="text-right text-xs text-gray-500">
            <p>Ordem menor = aparece primeiro</p>
            <p>Use o botão “Adicionar Parametro” para incluir novos.</p>
          </div>
        </header>
        <div class="mt-4">
          ${configuracoes}
        </div>
      </article>
      ${pacientes.length ? blocos : ''}
    </div>
  `;
}

export function renderModelosPrescricao(root, dataset, { petId } = {}) {
  const pacientes = filterPacientes(dataset, petId);
  if (!pacientes.length) {
    root.innerHTML = buildEmptyState('Nenhum modelo disponível para o filtro aplicado.');
    return;
  }

  const presc = pacientes.flatMap((pet) => (pet.internacao.prescricoes || []).map((modelo) => ({ ...modelo, pet })));

  root.innerHTML = `
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      ${presc.map((modelo) => `
        <article class="rounded-2xl border border-gray-100 p-5 shadow-sm">
          <header class="mb-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${modelo.pet.nome} · ${modelo.pet.internacao.box}</p>
            <h2 class="text-lg font-semibold text-gray-900">${modelo.nome}</h2>
            <p class="text-sm text-gray-500">${modelo.pet.agenda.servico}</p>
          </header>
          <dl class="space-y-2 text-sm text-gray-700">
            <div class="flex justify-between">
              <dt class="text-gray-500">Período</dt>
              <dd class="font-medium">${modelo.periodo}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">Frequência</dt>
              <dd class="font-medium">${modelo.frequencia}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Itens / Conduta</dt>
              <dd class="font-medium text-gray-900">${modelo.itens}</dd>
            </div>
          </dl>
          <footer class="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Responsável: ${modelo.responsavel}</span>
            <span>Integrado à ficha clínica</span>
          </footer>
        </article>
      `).join('')}
    </div>
  `;
}

export function renderBoxes(root, dataset, { petId, boxesLoading, boxesError, boxes } = {}) {
  const highlightNome = petId ? dataset.pacientes.find((pet) => pet.id === petId)?.nome : null;
  const resolvedBoxes = Array.isArray(boxes) ? boxes : Array.isArray(dataset.boxes) ? dataset.boxes : [];

  if (boxesLoading) {
    root.innerHTML = `
      <div class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-white/60 px-6 py-12 text-center text-sm text-gray-500">
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/5 text-primary">
          <i class="fas fa-spinner animate-spin"></i>
        </span>
        Carregando boxes cadastrados...
      </div>
    `;
    return;
  }

  if (boxesError) {
    root.innerHTML = `
      <div class="rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center text-sm text-red-700">
        <p class="font-semibold">${escapeHtml(boxesError)}</p>
        <p class="mt-2 text-red-600/80">Tente novamente ou contate o suporte.</p>
        <button type="button" data-boxes-retry class="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-white">
          <i class="fas fa-rotate"></i>
          Tentar novamente
        </button>
      </div>
    `;
    return;
  }

  if (!resolvedBoxes.length) {
    root.innerHTML = buildEmptyState('Nenhum box cadastrado até o momento. Utilize o botão “Criar box” para começar.');
    return;
  }

  const cards = resolvedBoxes
    .map((box) => {
      const ocupante = box?.ocupante || 'Livre';
      const isTarget = highlightNome && ocupante === highlightNome;
      const observacao = box?.observacao?.trim() ? box.observacao : 'Sem observações registradas.';
      const especialidade = box?.especialidade?.trim() ? box.especialidade : 'Sem especialidade definida';
      return `
        <article class="rounded-2xl border ${isTarget ? 'border-primary ring-1 ring-primary/30' : 'border-gray-100'} p-5 shadow-sm transition hover:-translate-y-0.5">
          <header class="flex items-center justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${escapeHtml(especialidade)}</p>
              <h2 class="text-xl font-semibold text-gray-900">${escapeHtml(box?.box || 'Box')}</h2>
            </div>
            <span class="rounded-full px-3 py-1 text-xs font-semibold ${ocupante === 'Livre' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}">${escapeHtml(box?.status || (ocupante === 'Livre' ? 'Disponível' : 'Em uso'))}</span>
          </header>
          <div class="mt-4 space-y-1 text-sm text-gray-600">
            <p>Ocupante: <span class="font-semibold text-gray-900">${escapeHtml(ocupante)}</span></p>
            <p>Higienização: ${escapeHtml(box?.higienizacao || '—')}</p>
            <p>Observação: ${escapeHtml(observacao)}</p>
          </div>
        </article>
      `;
    })
    .join('');

  root.innerHTML = `<div class="grid grid-cols-1 gap-4 md:grid-cols-2">${cards}</div>`;
}

export function getDataset() {
  return internacaoDataset;
}
