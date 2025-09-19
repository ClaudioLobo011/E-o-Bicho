// Tutor and pet selection logic for the Vet ficha clínica
import {
  state,
  els,
  api,
  pickFirst,
  formatPhone,
  normalizeId,
  persistCliente,
  persistPetId,
  persistAgendaContext,
  getPersistedState,
} from './core.js';
import { loadConsultasFromServer, updateConsultaAgendaCard } from './consultas.js';
import { loadVacinasForSelection } from './vacinas.js';
import { loadAnexosForSelection, loadAnexosFromServer } from './anexos.js';
import { loadExamesForSelection } from './exames.js';
import { loadObservacoesForSelection } from './observacoes.js';
import { loadPesosFromServer } from './pesos.js';
import { loadDocumentosFromServer } from './documentos.js';
import { loadReceitasFromServer } from './receitas.js';
import { updateCardDisplay, updatePageVisibility, setCardMode } from './ui.js';

function hideSugestoes() {
  if (els.cliSug) {
    els.cliSug.innerHTML = '';
    els.cliSug.classList.add('hidden');
  }
}

export async function searchClientes(term) {
  if (!term || term.trim().length < 2) {
    hideSugestoes();
    return;
  }
  try {
    const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(term)}&limit=8`);
    const list = await resp.json().catch(() => []);
    if (!Array.isArray(list) || !els.cliSug) return;

    els.cliSug.innerHTML = list.map((u) => `
<li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${u._id}" data-nome="${u.nome}" data-email="${u.email || ''}" data-celular="${u.celular || ''}">
  <div class="font-medium text-gray-900">${u.nome}</div>
  <div class="text-xs text-gray-500">${u.email || ''}</div>
</li>`).join('');
    els.cliSug.classList.remove('hidden');

    Array.from(els.cliSug.querySelectorAll('li')).forEach((li) => {
      li.addEventListener('click', () => onSelectCliente({
        _id: li.dataset.id,
        nome: li.dataset.nome,
        email: li.dataset.email || '',
        celular: li.dataset.celular || '',
      }));
    });
  } catch {
    // silent failure
  }
}

export { hideSugestoes };

async function fetchClienteWithPhones(cliente) {
  const clienteId = normalizeId(cliente?._id);
  if (!clienteId) return null;

  const existingNome = pickFirst(cliente?.nome);
  const existingEmail = pickFirst(cliente?.email);
  const existingCelular = pickFirst(cliente?.celular);
  const existingTelefone = pickFirst(cliente?.telefone);
  const needsHydration = !existingNome || !existingEmail || !pickFirst(existingCelular, existingTelefone);

  if (!needsHydration) {
    return {
      ...cliente,
      _id: clienteId,
      nome: existingNome,
      email: existingEmail,
      celular: existingCelular,
      telefone: existingTelefone,
    };
  }

  try {
    const resp = await api(`/func/clientes/${clienteId}`);
    if (!resp.ok) return { ...cliente, _id: clienteId };
    const data = await resp.json().catch(() => null);
    if (!data || !data._id) return { ...cliente, _id: clienteId };

    const fetchedCelular = pickFirst(data.celular, data.telefone);
    const fetchedTelefone = pickFirst(data.telefone, data.celular);
    const phoneCandidates = [existingCelular, existingTelefone, fetchedCelular, fetchedTelefone]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const uniquePhones = [];
    phoneCandidates.forEach((phone) => {
      if (!uniquePhones.includes(phone)) uniquePhones.push(phone);
    });
    const primaryPhone = uniquePhones[0] || '';
    const secondaryPhone = uniquePhones[1] || '';

    const payload = {
      ...cliente,
      _id: clienteId,
      nome: pickFirst(existingNome, data.nome),
      email: pickFirst(existingEmail, data.email),
      celular: primaryPhone,
    };
    if (secondaryPhone) {
      payload.telefone = secondaryPhone;
    }
    return payload;
  } catch {
    return { ...cliente, _id: clienteId };
  }
}

export async function onSelectCliente(cli, opts = {}) {
  const {
    skipPersistCliente = false,
    clearPersistedPet = true,
    persistedPetId = null,
  } = opts;

  let cliente = cli ? { ...cli } : null;
  const clienteId = normalizeId(cliente?._id);
  if (clienteId) {
    cliente = await fetchClienteWithPhones({ ...cliente, _id: clienteId });
  } else {
    cliente = null;
  }

  state.selectedCliente = cliente;
  state.selectedPetId = null;
  state.petsById = {};
  state.currentCardMode = 'tutor';
  state.consultas = [];
  state.consultasLoadKey = null;
  state.consultasLoading = false;
  state.vacinas = [];
  state.anexos = [];
  state.anexosLoadKey = null;
  state.anexosLoading = false;
  state.exames = [];
  state.examesLoadKey = null;
  state.examesLoading = false;
  state.pesos = [];
  state.pesosLoadKey = null;
  state.pesosLoading = false;
  state.pesos = [];
  state.pesosLoadKey = null;
  state.pesosLoading = false;
  state.documentos = [];
  state.documentosLoadKey = null;
  state.documentosLoading = false;
  state.receitas = [];
  state.receitasLoadKey = null;
  state.receitasLoading = false;

  if (state.agendaContext) {
    const contextTutorId = normalizeId(state.agendaContext.tutorId);
    if (!clienteId || !contextTutorId || contextTutorId !== clienteId) {
      state.agendaContext = null;
    }
  }
  persistAgendaContext(state.agendaContext);

  if (!skipPersistCliente) {
    persistCliente(state.selectedCliente);
  }
  if (clearPersistedPet) {
    persistPetId(null);
  }

  updatePageVisibility();
  updateConsultaAgendaCard();

  if (els.cliInput) els.cliInput.value = state.selectedCliente?.nome || '';
  hideSugestoes();

  const tutorNome = pickFirst(state.selectedCliente?.nome);
  const tutorEmail = pickFirst(state.selectedCliente?.email);
  const tutorPhone = pickFirst(state.selectedCliente?.celular, state.selectedCliente?.telefone);
  if (els.tutorNome) els.tutorNome.textContent = tutorNome || '—';
  if (els.tutorEmail) els.tutorEmail.textContent = tutorEmail || '—';
  if (els.tutorTelefone) {
    els.tutorTelefone.textContent = tutorPhone ? formatPhone(tutorPhone) : '—';
  }

  updateCardDisplay();

  const normalizedTutorId = clienteId;
  if (!normalizedTutorId) {
    if (els.petSelect) {
      els.petSelect.innerHTML = `<option value="">Selecione o tutor para listar os pets</option>`;
    }
    updatePageVisibility();
    return;
  }

  try {
    if (els.petSelect) {
      els.petSelect.innerHTML = `<option value="">Carregando pets…</option>`;
    }
    const resp = await api(`/func/clientes/${normalizedTutorId}/pets`);
    const pets = await resp.json().catch(() => []);
    state.petsById = {};
    if (Array.isArray(pets)) {
      pets.forEach((p) => {
        if (p && p._id) {
          state.petsById[p._id] = p;
        }
      });
    }
    if (els.petSelect) {
      if (Array.isArray(pets) && pets.length) {
        els.petSelect.innerHTML = ['<option value="">Selecione o pet</option>']
          .concat(pets.map((p) => `<option value="${p._id}">${p.nome}</option>`))
          .join('');
        let petSelecionado = false;
        if (persistedPetId) {
          const match = pets.find((p) => p._id === persistedPetId);
          if (match) {
            els.petSelect.value = persistedPetId;
            await onSelectPet(persistedPetId, { skipPersistPet: true });
            petSelecionado = true;
          } else if (!clearPersistedPet) {
            persistPetId(null);
          }
        }
        if (!petSelecionado && pets.length === 1) {
          els.petSelect.value = pets[0]._id;
          await onSelectPet(pets[0]._id);
        }
      } else {
        els.petSelect.innerHTML = `<option value="">Nenhum pet encontrado</option>`;
      }
    }
  } catch {
    // silent
  }
  updateCardDisplay();
  updatePageVisibility();
}

export async function onSelectPet(petId, opts = {}) {
  const { skipPersistPet = false } = opts;
  state.selectedPetId = petId || null;
  if (!skipPersistPet) {
    persistPetId(state.selectedPetId);
  }
  state.consultas = [];
  state.consultasLoadKey = null;
  state.consultasLoading = false;
  state.anexos = [];
  state.anexosLoadKey = null;
  state.anexosLoading = false;
  state.exames = [];
  state.examesLoadKey = null;
  state.examesLoading = false;
  state.pesos = [];
  state.pesosLoadKey = null;
  state.pesosLoading = false;
  state.observacoes = [];
  state.documentos = [];
  state.documentosLoadKey = null;
  state.documentosLoading = false;
  state.receitas = [];
  state.receitasLoadKey = null;
  state.receitasLoading = false;
  loadVacinasForSelection();
  loadAnexosForSelection();
  loadExamesForSelection();
  loadObservacoesForSelection();
  updateCardDisplay();
  updatePageVisibility();
  if (!state.selectedPetId) {
    updateConsultaAgendaCard();
    return;
  }
  await Promise.all([
    loadConsultasFromServer({ force: true }),
    loadAnexosFromServer({ force: true }),
    loadPesosFromServer({ force: true }),
    loadDocumentosFromServer({ force: true }),
    loadReceitasFromServer({ force: true }),
  ]);
}

export function clearCliente() {
  state.selectedCliente = null;
  state.petsById = {};
  state.currentCardMode = 'tutor';
  state.agendaContext = null;
  state.consultas = [];
  state.consultasLoadKey = null;
  state.consultasLoading = false;
  state.vacinas = [];
  state.anexos = [];
  state.anexosLoadKey = null;
  state.anexosLoading = false;
  state.exames = [];
  state.examesLoadKey = null;
  state.examesLoading = false;
  state.pesos = [];
  state.pesosLoadKey = null;
  state.pesosLoading = false;
  state.observacoes = [];
  state.documentos = [];
  state.documentosLoadKey = null;
  state.documentosLoading = false;
  state.receitas = [];
  state.receitasLoadKey = null;
  state.receitasLoading = false;
  persistAgendaContext(null);
  if (els.cliInput) els.cliInput.value = '';
  hideSugestoes();
  if (els.petSelect) {
    els.petSelect.innerHTML = `<option value="">Selecione o tutor para listar os pets</option>`;
  }
  setCardMode('tutor');
  if (els.tutorNome) els.tutorNome.textContent = 'Nome Tutor';
  if (els.tutorEmail) els.tutorEmail.textContent = '—';
  persistCliente(null);
  updatePageVisibility();
  updateConsultaAgendaCard();
}

export function clearPet() {
  state.selectedPetId = null;
  if (els.petSelect) els.petSelect.value = '';
  persistPetId(null);
  state.currentCardMode = 'tutor';
  state.consultas = [];
  state.consultasLoadKey = null;
  state.consultasLoading = false;
  state.vacinas = [];
  state.anexos = [];
  state.anexosLoadKey = null;
  state.anexosLoading = false;
  state.exames = [];
  state.examesLoadKey = null;
  state.examesLoading = false;
  state.observacoes = [];
  state.documentos = [];
  state.documentosLoadKey = null;
  state.documentosLoading = false;
  state.receitas = [];
  state.receitasLoadKey = null;
  state.receitasLoading = false;
  updateCardDisplay();
  updatePageVisibility();
}

export function restorePersistedSelection() {
  const { cliente, petId, agendaContext } = getPersistedState();
  state.agendaContext = agendaContext || null;
  if (state.agendaContext && cliente) {
    const contextTutorId = normalizeId(state.agendaContext.tutorId);
    const clienteId = normalizeId(cliente._id);
    if (!contextTutorId || !clienteId || contextTutorId !== clienteId) {
      state.agendaContext = null;
    }
  } else if (state.agendaContext && !cliente) {
    state.agendaContext = null;
  }
  if (state.agendaContext) {
    persistAgendaContext(state.agendaContext);
  }
  updateConsultaAgendaCard();
  if (cliente) {
    const promise = onSelectCliente(cliente, {
      clearPersistedPet: false,
      persistedPetId: petId,
    });
    if (promise && typeof promise.then === 'function') {
      promise.catch(() => {});
    }
  } else if (petId) {
    persistPetId(null);
  }
}
