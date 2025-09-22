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
  isFinalizadoSelection,
} from './core.js';
import {
  loadConsultasFromServer,
  loadWaitingAppointments,
  updateConsultaAgendaCard,
} from './consultas.js';
import { loadVacinasForSelection } from './vacinas.js';
import { loadAnexosForSelection, loadAnexosFromServer } from './anexos.js';
import { loadExamesForSelection } from './exames.js';
import { loadObservacoesForSelection } from './observacoes.js';
import { loadPesosFromServer } from './pesos.js';
import { loadDocumentosFromServer } from './documentos.js';
import { loadReceitasFromServer } from './receitas.js';
import { updateCardDisplay, updatePageVisibility, setCardMode } from './ui.js';
import { loadHistoricoForSelection, setActiveMainTab } from './historico.js';
import { updateFichaRealTimeSelection } from './real-time.js';

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
<li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${u._id}" data-nome="${u.nome}" data-email="${u.email || ''}" data-celular="${u.celular || ''}" data-documento="${u.doc || u.cpf || u.cnpj || u.inscricaoEstadual || ''}" data-cpf="${u.cpf || ''}" data-cnpj="${u.cnpj || ''}" data-inscricao-estadual="${u.inscricaoEstadual || ''}" data-tipo-conta="${u.tipoConta || ''}">
  <div class="font-medium text-gray-900">${u.nome}</div>
  <div class="text-xs text-gray-500">${u.email || ''}</div>
</li>`).join('');
    els.cliSug.classList.remove('hidden');

    Array.from(els.cliSug.querySelectorAll('li')).forEach((li) => {
      li.addEventListener('click', () => {
        const rawDoc = li.dataset.documento || '';
        const cpf = li.dataset.cpf || '';
        const cnpj = li.dataset.cnpj || '';
        const inscricaoEstadual = li.dataset.inscricaoEstadual || '';
        const tipoConta = li.dataset.tipoConta || '';
        const resolvedDoc = pickFirst(rawDoc, cpf, cnpj, inscricaoEstadual);
        const selection = {
          _id: li.dataset.id,
          nome: li.dataset.nome,
          email: li.dataset.email || '',
          celular: li.dataset.celular || '',
        };
        if (tipoConta) selection.tipoConta = tipoConta;
        if (cpf) selection.cpf = cpf;
        if (cnpj) selection.cnpj = cnpj;
        if (inscricaoEstadual) selection.inscricaoEstadual = inscricaoEstadual;
        if (resolvedDoc) {
          const digits = String(resolvedDoc).replace(/\D+/g, '');
          selection.documento = resolvedDoc;
          selection.documentoPrincipal = resolvedDoc;
          selection.doc = resolvedDoc;
          selection.cpfCnpj = pickFirst(cpf, cnpj, resolvedDoc);
          if (!selection.cpf && digits.length === 11) {
            selection.cpf = resolvedDoc;
          } else if (!selection.cnpj && digits.length === 14) {
            selection.cnpj = resolvedDoc;
          }
        }
        onSelectCliente(selection);
      });
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
  const existingDocument = pickFirst(
    cliente?.documento,
    cliente?.documentoPrincipal,
    cliente?.cpf,
    cliente?.cpfCnpj,
    cliente?.cnpj,
    cliente?.inscricaoEstadual,
    cliente?.doc,
  );
  const needsHydration =
    !existingNome ||
    !existingEmail ||
    !pickFirst(existingCelular, existingTelefone) ||
    !existingDocument;

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
      ...data,
      _id: clienteId,
      nome: pickFirst(existingNome, data.nome),
      email: pickFirst(existingEmail, data.email),
    };
    if (primaryPhone) {
      payload.celular = primaryPhone;
    }
    if (secondaryPhone) {
      payload.telefone = secondaryPhone;
    }
    const hydratedDocument = pickFirst(
      existingDocument,
      data?.documento,
      data?.documentoPrincipal,
      data?.cpf,
      data?.cpfCnpj,
      data?.cnpj,
      data?.inscricaoEstadual,
    );
    if (hydratedDocument) {
      const digits = String(hydratedDocument).replace(/\D+/g, '');
      if (!payload.documento) payload.documento = hydratedDocument;
      if (!payload.documentoPrincipal) payload.documentoPrincipal = hydratedDocument;
      if (!payload.doc) payload.doc = hydratedDocument;
      if (!payload.cpfCnpj) {
        payload.cpfCnpj = pickFirst(data?.cpfCnpj, data?.cpf, data?.cnpj, hydratedDocument);
      }
      if (!payload.cpf && digits.length === 11) {
        payload.cpf = hydratedDocument;
      } else if (!payload.cnpj && digits.length === 14) {
        payload.cnpj = hydratedDocument;
      }
    }
    if (data?.inscricaoEstadual && !payload.inscricaoEstadual) {
      payload.inscricaoEstadual = data.inscricaoEstadual;
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
  state.waitingAppointments = [];
  state.waitingAppointmentsLoadKey = null;
  state.waitingAppointmentsLoading = false;

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

  updateFichaRealTimeSelection().catch(() => {});

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
  updateFichaRealTimeSelection().catch(() => {});
  const defaultToHistorico = isFinalizadoSelection(state.selectedCliente?._id, state.selectedPetId);
  setActiveMainTab(defaultToHistorico ? 'historico' : 'consulta');
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
  state.waitingAppointments = [];
  state.waitingAppointmentsLoadKey = null;
  state.waitingAppointmentsLoading = false;
  loadVacinasForSelection();
  loadAnexosForSelection();
  loadExamesForSelection();
  loadObservacoesForSelection();
  loadHistoricoForSelection();
  updateCardDisplay();
  updatePageVisibility();
  if (!state.selectedPetId) {
    updateConsultaAgendaCard();
    return;
  }
  await Promise.all([
    loadWaitingAppointments({ force: true }),
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
  state.waitingAppointments = [];
  state.waitingAppointmentsLoadKey = null;
  state.waitingAppointmentsLoading = false;
  state.historicos = [];
  state.historicosLoadKey = null;
  state.historicosLoading = false;
  persistAgendaContext(null);
  if (els.cliInput) els.cliInput.value = '';
  hideSugestoes();
  if (els.petSelect) {
    els.petSelect.innerHTML = `<option value="">Selecione o tutor para listar os pets</option>`;
  }
  setActiveMainTab('consulta');
  loadHistoricoForSelection();
  setCardMode('tutor');
  if (els.tutorNome) els.tutorNome.textContent = 'Nome Tutor';
  if (els.tutorEmail) els.tutorEmail.textContent = '—';
  persistCliente(null);
  updatePageVisibility();
  updateConsultaAgendaCard();
  updateFichaRealTimeSelection().catch(() => {});
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
  state.waitingAppointments = [];
  state.waitingAppointmentsLoadKey = null;
  state.waitingAppointmentsLoading = false;
  state.historicos = [];
  state.historicosLoadKey = null;
  state.historicosLoading = false;
  setActiveMainTab('consulta');
  loadHistoricoForSelection();
  updateCardDisplay();
  updatePageVisibility();
  updateFichaRealTimeSelection().catch(() => {});
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
  updateFichaRealTimeSelection().catch(() => {});
}
