import { internacaoDataset } from './data.js';

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

const statusColors = {
  'Em observação': 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
  'Isolamento respiratório': 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  'Estável': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
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

function openExecucaoModal(pet, hourLabel, items) {
  if (!pet || !items?.length) return;

  const existing = document.getElementById('internacao-exec-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'internacao-exec-modal';
  overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 py-6';
  overlay.innerHTML = `
    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <div class="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-primary">Mapa de execução</p>
          <h2 class="text-lg font-bold text-gray-900">${pet.nome}</h2>
          <p class="text-sm text-gray-500">${pet.internacao.box} · ${pet.agenda.servico}</p>
          <p class="text-xs text-gray-400">Horário: ${hourLabel}</p>
        </div>
        <button type="button" class="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" data-close-modal>
          <i class="fas fa-xmark text-lg"></i>
        </button>
      </div>
      <div class="mt-4 space-y-3">
        ${items
          .map(
            (item) => `
              <div class="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p class="text-sm font-semibold text-gray-900">${item.descricao}</p>
                <p class="text-xs text-gray-500">Responsável: ${item.responsavel}</p>
                <p class="text-xs text-gray-400">Status: ${item.status}</p>
              </div>
            `,
          )
          .join('')}
      </div>
      <div class="mt-6 flex justify-end">
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

  document.body.appendChild(overlay);
}

function attachExecucaoModalHandlers(root, dataset) {
  root.querySelectorAll('[data-exec-trigger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { petId, hour } = btn.dataset;
      const pet = dataset.pacientes.find((p) => p.id === petId);
      if (!pet) return;
      const items = (pet.internacao.execucoes || []).filter((acao) => acao.horario?.startsWith(hour));
      if (!items.length) return;
      openExecucaoModal(pet, `${hour}:00`, items);
    });
  });
}

export function renderAnimaisInternados(root, dataset, { petId } = {}) {
  const pacientes = filterPacientes(dataset, petId);
  if (!pacientes.length) {
    root.innerHTML = buildEmptyState('Nenhum pet da agenda está em internação no momento.');
    return;
  }

  const total = pacientes.length;
  const proximasAltas = pacientes.filter((pet) => {
    const alta = new Date(pet.internacao.previsaoAlta);
    if (Number.isNaN(alta.getTime())) return false;
    const diff = (alta - Date.now()) / (1000 * 60 * 60);
    return diff <= 48;
  }).length;
  const isolamento = pacientes.filter((pet) => pet.internacao.status.toLowerCase().includes('isolamento')).length;

  const resumo = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-2xl bg-primary/10 px-4 py-4 text-primary">
        <p class="text-xs font-semibold uppercase tracking-wide">Internados</p>
        <p class="text-3xl font-bold">${total}</p>
        <p class="text-sm text-primary/80">Conforme agenda e fichas clínicas</p>
      </div>
      <div class="rounded-2xl bg-emerald-50 px-4 py-4 text-emerald-700">
        <p class="text-xs font-semibold uppercase tracking-wide">Altas em 48h</p>
        <p class="text-3xl font-bold">${proximasAltas}</p>
        <p class="text-sm text-emerald-700/80">Planos já aprovados pela equipe</p>
      </div>
      <div class="rounded-2xl bg-amber-50 px-4 py-4 text-amber-700">
        <p class="text-xs font-semibold uppercase tracking-wide">Isolamentos</p>
        <p class="text-3xl font-bold">${isolamento}</p>
        <p class="text-sm text-amber-700/80">Fluxo alinhado com protocolos</p>
      </div>
    </div>
  `;

  const cards = pacientes.map((pet) => {
    const statusClass = statusColors[pet.internacao.status] || 'bg-gray-100 text-gray-700';
    return `
      <article class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
        <div class="flex flex-wrap items-start gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-semibold text-gray-900">${pet.nome}</h2>
              <span class="rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}">${pet.internacao.status}</span>
            </div>
            <p class="text-sm text-gray-500">${pet.especie} · ${pet.raca} · ${pet.idade} · ${pet.peso}</p>
            <p class="text-sm text-gray-500">Tutor: <span class="font-medium text-gray-700">${pet.tutor.nome}</span></p>
          </div>
          <div class="text-right text-sm text-gray-500">
            <p>Admissão: <span class="font-semibold text-gray-800">${formatDateTime(pet.internacao.admissao)}</span></p>
            <p>Previsão de alta: <span class="font-semibold text-gray-800">${formatDateTime(pet.internacao.previsaoAlta)}</span></p>
            <p>Box: <span class="font-semibold text-gray-800">${pet.internacao.box}</span></p>
          </div>
        </div>
        <div class="mt-4 grid gap-4 md:grid-cols-3">
          <div class="rounded-xl bg-gray-50 p-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Equipe</p>
            <p class="text-sm text-gray-800">${pet.internacao.equipeMedica}</p>
            <p class="text-sm text-gray-800">${pet.internacao.equipeEnfermagem}</p>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 md:col-span-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Pendências da agenda</p>
            ${buildPendencias(pet.internacao.pendencias)}
          </div>
        </div>
      </article>
    `;
  }).join('');

  root.innerHTML = `${resumo}<div class="space-y-4">${cards}</div>`;
}

export function renderMapaExecucao(root, dataset, { petId } = {}) {
  const pacientes = filterPacientes(dataset, petId);
  if (!pacientes.length) {
    root.innerHTML = buildEmptyState('Nenhum procedimento programado para o filtro informado.');
    return;
  }

  const headerRow = `
    <div class="grid grid-cols-[160px_repeat(${HOURS.length},minmax(44px,1fr))] items-center gap-2 rounded-xl bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      <div>Pet / Box</div>
      ${HOURS.map((hour) => `<div class="text-center">${hour}:00</div>`).join('')}
    </div>
  `;

  const rows = pacientes
    .map((pet) => {
      const execucoes = pet.internacao.execucoes || [];
      const hourCells = HOURS.map((hour) => {
        const atividades = execucoes.filter((acao) => acao.horario?.startsWith(hour));
        if (!atividades.length) {
          return '<div class="flex h-10 w-full items-center justify-center"><div class="h-10 w-10 rounded-xl border border-dashed border-gray-200 bg-white"></div></div>';
        }
        return `
          <div class="flex h-10 w-full items-center justify-center">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/40 bg-primary/5">
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white shadow-sm"
                title="${atividades.length} procedimentos"
                aria-label="Ver ${atividades.length} procedimentos de ${pet.nome} às ${hour}:00"
                data-exec-trigger
                data-pet-id="${pet.id}"
                data-hour="${hour}"
              >
                ${atividades.length}
              </button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="grid grid-cols-[160px_repeat(${HOURS.length},minmax(44px,1fr))] items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <div>
            <p class="text-sm font-semibold text-gray-900">${pet.nome}</p>
            <p class="text-xs text-gray-500">${pet.internacao.box} · ${pet.agenda.servico}</p>
            <p class="text-[11px] text-gray-400">Equipe: ${pet.internacao.equipeMedica}</p>
          </div>
          ${hourCells}
        </div>
      `;
    })
    .join('');

  root.innerHTML = `
    <div class="space-y-5">
      <div class="rounded-2xl border border-gray-100 px-5 py-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Pet | Horário</p>
            <h2 class="text-xl font-bold text-gray-900">Mapa de execução</h2>
            <p class="text-sm text-gray-500">Clique no círculo para ver os procedimentos daquele horário.</p>
          </div>
          <div class="flex items-center gap-3 text-xs text-gray-500">
            <span class="inline-flex items-center gap-2"><span class="inline-flex h-3 w-3 rounded-full bg-primary/70"></span>Círculo = quantidade</span>
            <span class="inline-flex items-center gap-2"><span class="h-4 w-4 rounded-lg border border-dashed border-gray-300"></span>Sem ações</span>
          </div>
        </div>
        <div class="mt-6 overflow-x-auto">
          <div class="min-w-[960px] space-y-3">
            ${headerRow}
            ${rows}
          </div>
        </div>
      </div>
    </div>
  `;

  attachExecucaoModalHandlers(root, dataset);
}

export function renderHistoricoInternacoes(root, dataset, { petId } = {}) {
  const pacientes = filterPacientes(dataset, petId);
  if (!pacientes.length) {
    root.innerHTML = buildEmptyState('Nenhum histórico encontrado.');
    return;
  }

  const linhas = pacientes.flatMap((pet) => {
    const atuais = [{
      periodo: `${formatDate(pet.internacao.admissao)} · ${formatDate(pet.internacao.previsaoAlta)}`,
      motivo: pet.internacao.motivo,
      resultado: pet.internacao.status,
      responsavel: pet.internacao.equipeMedica,
      pet,
    }];
    const previas = (pet.internacao.historico || []).map((item) => ({ ...item, pet }));
    return [...atuais, ...previas];
  });

  root.innerHTML = `
    <div class="overflow-x-auto rounded-2xl border border-gray-100">
      <table class="min-w-full divide-y divide-gray-100 text-sm">
        <thead class="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-3">Período</th>
            <th class="px-4 py-3">Pet / Tutor</th>
            <th class="px-4 py-3">Motivo</th>
            <th class="px-4 py-3">Resultado / Status</th>
            <th class="px-4 py-3">Responsável</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 bg-white">
          ${linhas.map((linha) => `
            <tr>
              <td class="px-4 py-3 text-gray-700">${linha.periodo}</td>
              <td class="px-4 py-3">
                <p class="font-semibold text-gray-900">${linha.pet.nome}</p>
                <p class="text-xs text-gray-500">Tutor: ${linha.pet.tutor.nome}</p>
              </td>
              <td class="px-4 py-3 text-gray-700">${linha.motivo}</td>
              <td class="px-4 py-3 text-gray-700">${linha.resultado}</td>
              <td class="px-4 py-3 text-gray-700">${linha.responsavel}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderParametrosClinicos(root, dataset, { petId } = {}) {
  const pacientes = filterPacientes(dataset, petId);
  if (!pacientes.length) {
    root.innerHTML = buildEmptyState('Nenhum parâmetro clínico disponível.');
    return;
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

  root.innerHTML = `<div class="space-y-5">${blocos}</div>`;
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

export function renderBoxes(root, dataset, { petId } = {}) {
  const highlightNome = petId ? dataset.pacientes.find((pet) => pet.id === petId)?.nome : null;

  const cards = dataset.boxes.map((box) => {
    const isTarget = highlightNome && box.ocupante === highlightNome;
    return `
      <article class="rounded-2xl border ${isTarget ? 'border-primary ring-1 ring-primary/30' : 'border-gray-100'} p-5 shadow-sm">
        <header class="flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${box.especialidade}</p>
            <h2 class="text-xl font-semibold text-gray-900">${box.box}</h2>
          </div>
          <span class="rounded-full px-3 py-1 text-xs font-semibold ${box.ocupante === 'Livre' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}">${box.status}</span>
        </header>
        <div class="mt-4 text-sm text-gray-600">
          <p>Ocupante: <span class="font-semibold text-gray-900">${box.ocupante}</span></p>
          <p>Higienização: ${box.higienizacao}</p>
          <p>Observação: ${box.observacao}</p>
        </div>
      </article>
    `;
  }).join('');

  root.innerHTML = `<div class="grid grid-cols-1 gap-4 md:grid-cols-2">${cards}</div>`;
}

export function getDataset() {
  return internacaoDataset;
}
