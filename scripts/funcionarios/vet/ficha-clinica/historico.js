// Histórico management and rendering for the Vet ficha clínica
import {
  state,
  els,
  pickFirst,
  normalizeId,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatMoney,
  getStatusLabel,
  HISTORICO_STORAGE_PREFIX,
  CONSULTA_PLACEHOLDER_CLASSNAMES,
  CONSULTA_CARD_CLASSNAMES,
  isAdminRole,
} from './core.js';
import { updateMainTabLayout } from './consultas.js';

const historicoHandlers = {
  onReopen: null,
};

export function setHistoricoReopenHandler(handler) {
  historicoHandlers.onReopen = typeof handler === 'function' ? handler : null;
}

function getHistoricoStorageKey(clienteId, petId) {
  const tutor = normalizeId(clienteId);
  const pet = normalizeId(petId);
  if (!(tutor && pet)) return null;
  return `${HISTORICO_STORAGE_PREFIX}${tutor}|${pet}`;
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeHistoricoEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeId(raw.id || raw._id || raw.key);
  const clienteId = normalizeId(raw.clienteId || raw.cliente);
  const petId = normalizeId(raw.petId || raw.pet);
  const appointmentId = normalizeId(raw.appointmentId || raw.appointment);
  if (!(id && clienteId && petId)) return null;

  const finalizadoEm = (() => {
    const value = raw.finalizadoEm || raw.createdAt || raw.updatedAt;
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
  })();

  const agenda = raw.agenda && typeof raw.agenda === 'object' ? safeClone(raw.agenda) || {} : {};
  const consultas = Array.isArray(raw.consultas) ? safeClone(raw.consultas) || [] : [];
  const vacinas = Array.isArray(raw.vacinas) ? safeClone(raw.vacinas) || [] : [];
  const anexos = Array.isArray(raw.anexos) ? safeClone(raw.anexos) || [] : [];
  const exames = Array.isArray(raw.exames) ? safeClone(raw.exames) || [] : [];
  const pesos = Array.isArray(raw.pesos) ? safeClone(raw.pesos) || [] : [];
  const observacoes = Array.isArray(raw.observacoes) ? safeClone(raw.observacoes) || [] : [];
  const documentos = Array.isArray(raw.documentos) ? safeClone(raw.documentos) || [] : [];
  const receitas = Array.isArray(raw.receitas) ? safeClone(raw.receitas) || [] : [];

  return {
    id,
    clienteId,
    petId,
    appointmentId,
    finalizadoEm,
    agenda,
    consultas,
    vacinas,
    anexos,
    exames,
    pesos,
    observacoes,
    documentos,
    receitas,
  };
}

function sortHistoricoEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const aTime = a?.finalizadoEm ? new Date(a.finalizadoEm).getTime() : 0;
    const bTime = b?.finalizadoEm ? new Date(b.finalizadoEm).getTime() : 0;
    return bTime - aTime;
  });
  return sorted;
}

function persistHistoricoForSelection() {
  const key = getHistoricoStorageKey(state.selectedCliente?._id, state.selectedPetId);
  state.historicosLoadKey = key;
  if (!key) return;
  try {
    if (Array.isArray(state.historicos) && state.historicos.length) {
      localStorage.setItem(key, JSON.stringify(state.historicos));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore persistence errors
  }
}

export function loadHistoricoForSelection() {
  const key = getHistoricoStorageKey(state.selectedCliente?._id, state.selectedPetId);
  state.historicosLoadKey = key;
  if (!key) {
    state.historicos = [];
    renderHistoricoArea();
    return;
  }

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      state.historicos = [];
      renderHistoricoArea();
      return;
    }
    const parsed = JSON.parse(raw);
    const normalized = Array.isArray(parsed)
      ? parsed.map(normalizeHistoricoEntry).filter(Boolean)
      : [];
    state.historicos = sortHistoricoEntries(normalized);
  } catch {
    state.historicos = [];
  }
  renderHistoricoArea();
}

export function addHistoricoEntry(entry) {
  const normalized = normalizeHistoricoEntry(entry);
  if (!normalized) return;
  const existing = Array.isArray(state.historicos) ? [...state.historicos] : [];
  const filtered = existing.filter((item) => normalizeId(item?.id) !== normalized.id);
  state.historicos = sortHistoricoEntries([normalized, ...filtered]);
  persistHistoricoForSelection();
  renderHistoricoArea();
}

export function removeHistoricoEntry(entryId) {
  const targetId = normalizeId(entryId);
  const next = (Array.isArray(state.historicos) ? state.historicos : []).filter(
    (entry) => normalizeId(entry?.id) !== targetId,
  );
  state.historicos = next;
  persistHistoricoForSelection();
  renderHistoricoArea();
}

export function getHistoricoEntryById(entryId) {
  const targetId = normalizeId(entryId);
  if (!targetId) return null;
  return (state.historicos || []).find((entry) => normalizeId(entry?.id) === targetId) || null;
}

const TAG_STYLE_MAP = {
  consulta: 'border-sky-200 bg-sky-50 text-sky-700',
  vacina: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  exame: 'border-rose-200 bg-rose-50 text-rose-700',
  anexo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  observacao: 'border-amber-200 bg-amber-50 text-amber-700',
  peso: 'border-orange-200 bg-orange-50 text-orange-700',
  documento: 'border-teal-200 bg-teal-50 text-teal-700',
  receita: 'border-blue-200 bg-blue-50 text-blue-700',
  default: 'border-gray-200 bg-gray-100 text-gray-700',
};

function createTag(label, type) {
  const span = document.createElement('span');
  span.className = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TAG_STYLE_MAP[type] || TAG_STYLE_MAP.default}`;
  span.textContent = label;
  return span;
}

function collectEntryTags(entry) {
  const tags = [];
  const pushTag = (label, type) => {
    const text = String(label || '').trim();
    if (!text) return;
    tags.push({ label: text, type });
  };

  (entry.consultas || []).forEach((consulta) => {
    pushTag(pickFirst(consulta?.servicoNome), 'consulta');
  });
  (entry.vacinas || []).forEach((vacina) => {
    pushTag(pickFirst(vacina?.servicoNome), 'vacina');
  });
  (entry.exames || []).forEach((exame) => {
    pushTag(pickFirst(exame?.servicoNome), 'exame');
  });
  (entry.anexos || []).forEach((anexo) => {
    const arquivos = Array.isArray(anexo?.arquivos) ? anexo.arquivos : [];
    arquivos.forEach((arquivo) => {
      pushTag(pickFirst(arquivo?.nome, arquivo?.originalName), 'anexo');
    });
  });
  (entry.observacoes || []).forEach((obs) => {
    pushTag(pickFirst(obs?.titulo, 'Observação'), 'observacao');
  });
  (entry.pesos || []).forEach((peso) => {
    if (peso?.peso) {
      const texto = `${peso.peso} kg`;
      pushTag(texto, 'peso');
    }
  });
  (entry.documentos || []).forEach((doc) => {
    pushTag(pickFirst(doc?.titulo, doc?.nome), 'documento');
  });
  (entry.receitas || []).forEach((rec) => {
    pushTag(pickFirst(rec?.titulo, rec?.nome, rec?.modeloNome), 'receita');
  });

  return tags;
}

function createHistoricoCard(entry) {
  const card = document.createElement('article');
  card.className = 'group relative cursor-pointer rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400';
  card.tabIndex = 0;
  card.dataset.historicoId = entry.id;

  const header = document.createElement('div');
  header.className = 'flex items-start justify-between gap-3';
  card.appendChild(header);

  const info = document.createElement('div');
  info.className = 'space-y-1';
  header.appendChild(info);

  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold text-gray-800';
  title.textContent = 'Atendimento finalizado';
  info.appendChild(title);

  const when = formatDateTimeDisplay(entry.finalizadoEm);
  if (when) {
    const whenEl = document.createElement('p');
    whenEl.className = 'text-xs text-gray-500';
    whenEl.textContent = `Finalizado em ${when}`;
    info.appendChild(whenEl);
  }

  const professional = pickFirst(entry.agenda?.profissionalNome, entry.agenda?.profissional);
  if (professional) {
    const profEl = document.createElement('p');
    profEl.className = 'text-xs text-gray-500';
    profEl.textContent = `Profissional: ${professional}`;
    info.appendChild(profEl);
  }

  const statusLabel = getStatusLabel(entry.agenda?.status || 'finalizado');
  const statusBadge = document.createElement('span');
  statusBadge.className = 'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700';
  statusBadge.textContent = statusLabel || 'Finalizado';
  header.appendChild(statusBadge);

  const tags = collectEntryTags(entry);
  if (tags.length) {
    const tagList = document.createElement('div');
    tagList.className = 'mt-3 flex flex-wrap gap-2';
    tags.slice(0, 12).forEach((tag) => {
      tagList.appendChild(createTag(tag.label, tag.type));
    });
    if (tags.length > 12) {
      const remaining = tags.length - 12;
      tagList.appendChild(createTag(`+${remaining}`, 'default'));
    }
    card.appendChild(tagList);
  } else {
    const emptyInfo = document.createElement('p');
    emptyInfo.className = 'mt-3 text-xs text-gray-500';
    emptyInfo.textContent = 'Nenhum registro adicional foi associado ao atendimento.';
    card.appendChild(emptyInfo);
  }

  const openModal = (event) => {
    event.preventDefault();
    openHistoricoEntryModal(entry.id);
  };

  card.addEventListener('click', openModal);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openModal(event);
    }
  });

  return card;
}

export function renderHistoricoArea() {
  const area = els.historicoArea;
  if (!area) return;

  const historicos = Array.isArray(state.historicos) ? state.historicos : [];
  const hasEntries = historicos.length > 0;

  if (!hasEntries) {
    area.className = CONSULTA_PLACEHOLDER_CLASSNAMES;
    area.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Nenhum atendimento finalizado para exibir.';
    area.appendChild(paragraph);
    updateMainTabLayout();
    return;
  }

  area.className = CONSULTA_CARD_CLASSNAMES;
  area.innerHTML = '';

  const scroll = document.createElement('div');
  scroll.className = 'h-full w-full overflow-y-auto p-5 space-y-4';
  area.appendChild(scroll);

  historicos.forEach((entry) => {
    const card = createHistoricoCard(entry);
    if (card) scroll.appendChild(card);
  });
  updateMainTabLayout();
}

function createDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'flex flex-col';
  const labelEl = document.createElement('span');
  labelEl.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
  labelEl.textContent = label;
  row.appendChild(labelEl);
  const valueEl = document.createElement('p');
  valueEl.className = 'text-sm text-gray-800 whitespace-pre-wrap break-words';
  valueEl.textContent = value || '—';
  row.appendChild(valueEl);
  return row;
}

function appendSection(container, title) {
  const section = document.createElement('section');
  section.className = 'rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3';
  const heading = document.createElement('h3');
  heading.className = 'text-sm font-semibold text-gray-800';
  heading.textContent = title;
  section.appendChild(heading);
  container.appendChild(section);
  return section;
}

function renderListSection(container, title, items, renderItem) {
  if (!Array.isArray(items) || !items.length) return;
  const section = appendSection(container, title);
  const list = document.createElement('div');
  list.className = 'space-y-3';
  items.forEach((item, index) => {
    const node = renderItem(item, index);
    if (node) list.appendChild(node);
  });
  if (list.children.length) {
    section.appendChild(list);
  } else {
    const empty = document.createElement('p');
    empty.className = 'text-sm text-gray-600';
    empty.textContent = 'Sem registros.';
    section.appendChild(empty);
  }
}

function renderConsultasSection(container, consultas) {
  renderListSection(container, 'Consultas', consultas, (consulta) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-sky-200 bg-white p-3 space-y-2';
    const title = document.createElement('div');
    title.className = 'flex items-center justify-between';
    const name = document.createElement('h4');
    name.className = 'text-sm font-semibold text-sky-700';
    name.textContent = pickFirst(consulta?.servicoNome) || 'Registro de consulta';
    title.appendChild(name);
    if (consulta?.createdAt) {
      const when = document.createElement('span');
      when.className = 'text-xs text-gray-500';
      when.textContent = formatDateTimeDisplay(consulta.createdAt);
      title.appendChild(when);
    }
    card.appendChild(title);

    card.appendChild(createDetailRow('Anamnese', consulta?.anamnese));
    card.appendChild(createDetailRow('Exame físico', consulta?.exameFisico));
    card.appendChild(createDetailRow('Diagnóstico', consulta?.diagnostico));
    return card;
  });
}

function renderVacinasSection(container, vacinas) {
  renderListSection(container, 'Vacinas aplicadas', vacinas, (vacina) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-emerald-200 bg-white p-3 space-y-2';
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between';
    const name = document.createElement('h4');
    name.className = 'text-sm font-semibold text-emerald-700';
    name.textContent = pickFirst(vacina?.servicoNome) || 'Vacina';
    header.appendChild(name);
    if (vacina?.aplicacao) {
      const date = document.createElement('span');
      date.className = 'text-xs text-gray-500';
      date.textContent = `Aplicação: ${formatDateDisplay(vacina.aplicacao)}`;
      header.appendChild(date);
    }
    card.appendChild(header);

    const details = document.createElement('div');
    details.className = 'grid gap-2 sm:grid-cols-2';
    details.appendChild(createDetailRow('Quantidade', String(vacina?.quantidade || 0)));
    details.appendChild(createDetailRow('Valor total', formatMoney(vacina?.valorTotal || 0)));
    if (vacina?.validade) details.appendChild(createDetailRow('Validade', formatDateDisplay(vacina.validade)));
    if (vacina?.renovacao) details.appendChild(createDetailRow('Reaplicação', formatDateDisplay(vacina.renovacao)));
    if (vacina?.lote) details.appendChild(createDetailRow('Lote', vacina.lote));
    card.appendChild(details);
    return card;
  });
}

function renderExamesSection(container, exames) {
  renderListSection(container, 'Exames solicitados', exames, (exame) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-rose-200 bg-white p-3 space-y-2';
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between';
    const name = document.createElement('h4');
    name.className = 'text-sm font-semibold text-rose-700';
    name.textContent = pickFirst(exame?.servicoNome) || 'Exame';
    header.appendChild(name);
    if (exame?.createdAt) {
      const when = document.createElement('span');
      when.className = 'text-xs text-gray-500';
      when.textContent = formatDateTimeDisplay(exame.createdAt);
      header.appendChild(when);
    }
    card.appendChild(header);

    if (exame?.observacao) {
      card.appendChild(createDetailRow('Observação', exame.observacao));
    }

    const arquivos = Array.isArray(exame?.arquivos) ? exame.arquivos : [];
    if (arquivos.length) {
      const filesWrapper = document.createElement('div');
      filesWrapper.className = 'space-y-1';
      const label = document.createElement('span');
      label.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
      label.textContent = 'Arquivos';
      filesWrapper.appendChild(label);
      const list = document.createElement('ul');
      list.className = 'space-y-1 text-sm text-gray-700';
      arquivos.forEach((arquivo) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'text-sky-600 hover:underline';
        link.textContent = pickFirst(arquivo?.nome, arquivo?.originalName) || 'Arquivo';
        const url = pickFirst(arquivo?.url);
        if (url) {
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        } else {
          link.href = '#';
          link.addEventListener('click', (event) => event.preventDefault());
        }
        item.appendChild(link);
        list.appendChild(item);
      });
      filesWrapper.appendChild(list);
      card.appendChild(filesWrapper);
    }
    return card;
  });
}

function renderAnexosSection(container, anexos) {
  renderListSection(container, 'Anexos do atendimento', anexos, (anexo) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-indigo-200 bg-white p-3 space-y-2';
    if (anexo?.observacao) {
      card.appendChild(createDetailRow('Observação', anexo.observacao));
    }
    const arquivos = Array.isArray(anexo?.arquivos) ? anexo.arquivos : [];
    if (arquivos.length) {
      const list = document.createElement('ul');
      list.className = 'space-y-1 text-sm text-gray-700';
      arquivos.forEach((arquivo) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'text-indigo-600 hover:underline';
        link.textContent = pickFirst(arquivo?.nome, arquivo?.originalName) || 'Arquivo';
        const url = pickFirst(arquivo?.url);
        if (url) {
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        } else {
          link.href = '#';
          link.addEventListener('click', (event) => event.preventDefault());
        }
        item.appendChild(link);
        list.appendChild(item);
      });
      card.appendChild(list);
    }
    return card;
  });
}

function renderObservacoesSection(container, observacoes) {
  renderListSection(container, 'Observações adicionais', observacoes, (obs) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-amber-200 bg-white p-3 space-y-2';
    const title = pickFirst(obs?.titulo);
    if (title) {
      const heading = document.createElement('h4');
      heading.className = 'text-sm font-semibold text-amber-700';
      heading.textContent = title;
      card.appendChild(heading);
    }
    card.appendChild(createDetailRow('Observação', obs?.observacao));
    if (obs?.createdAt) {
      const when = document.createElement('p');
      when.className = 'text-xs text-gray-500';
      when.textContent = formatDateTimeDisplay(obs.createdAt);
      card.appendChild(when);
    }
    return card;
  });
}

function renderPesosSection(container, pesos) {
  renderListSection(container, 'Pesagens registradas', pesos, (peso) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-orange-200 bg-white p-3 space-y-2';
    card.appendChild(createDetailRow('Peso (kg)', String(peso?.peso || '—')));
    if (peso?.createdAt) {
      card.appendChild(createDetailRow('Registrado em', formatDateTimeDisplay(peso.createdAt)));
    }
    if (peso?.observacao) {
      card.appendChild(createDetailRow('Observação', peso.observacao));
    }
    return card;
  });
}

function renderDocumentosSection(container, documentos) {
  renderListSection(container, 'Documentos gerados', documentos, (doc) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-teal-200 bg-white p-3 space-y-2';
    card.appendChild(createDetailRow('Documento', pickFirst(doc?.titulo, doc?.nome)));
    if (doc?.createdAt) {
      card.appendChild(createDetailRow('Registrado em', formatDateTimeDisplay(doc.createdAt)));
    }
    if (doc?.observacao) {
      card.appendChild(createDetailRow('Observação', doc.observacao));
    }
    return card;
  });
}

function renderReceitasSection(container, receitas) {
  renderListSection(container, 'Receitas emitidas', receitas, (rec) => {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-blue-200 bg-white p-3 space-y-2';
    card.appendChild(createDetailRow('Receita', pickFirst(rec?.titulo, rec?.nome, rec?.modeloNome)));
    if (rec?.createdAt) {
      card.appendChild(createDetailRow('Registrado em', formatDateTimeDisplay(rec.createdAt)));
    }
    if (rec?.observacao) {
      card.appendChild(createDetailRow('Observação', rec.observacao));
    }
    return card;
  });
}

function buildHistoricoModal(entry) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 overflow-y-auto';

  const dialog = document.createElement('div');
  dialog.className = 'relative w-full max-w-4xl rounded-2xl bg-white shadow-xl';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  overlay.appendChild(dialog);

  const header = document.createElement('header');
  header.className = 'flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4';
  dialog.appendChild(header);

  const titleWrapper = document.createElement('div');
  titleWrapper.className = 'space-y-1';
  header.appendChild(titleWrapper);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-gray-800';
  title.textContent = 'Detalhes do atendimento finalizado';
  titleWrapper.appendChild(title);

  const subtitleParts = [];
  const when = formatDateTimeDisplay(entry.finalizadoEm);
  if (when) subtitleParts.push(`Finalizado em ${when}`);
  const profissional = pickFirst(entry.agenda?.profissionalNome, entry.agenda?.profissional);
  if (profissional) subtitleParts.push(`Profissional: ${profissional}`);
  if (subtitleParts.length) {
    const subtitle = document.createElement('p');
    subtitle.className = 'text-sm text-gray-500';
    subtitle.textContent = subtitleParts.join(' · ');
    titleWrapper.appendChild(subtitle);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'rounded-full bg-gray-100 p-2 text-gray-600 hover:bg-gray-200';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'space-y-4 px-6 py-5';
  dialog.appendChild(body);

  const resumo = appendSection(body, 'Resumo do atendimento');
  const resumoContent = document.createElement('div');
  resumoContent.className = 'grid gap-3 sm:grid-cols-2';
  resumoContent.appendChild(createDetailRow('Status do agendamento', getStatusLabel(entry.agenda?.status || 'finalizado')));
  if (entry.agenda?.scheduledAt) {
    resumoContent.appendChild(createDetailRow('Atendimento agendado', formatDateTimeDisplay(entry.agenda.scheduledAt)));
  }
  if (entry.agenda?.valor != null) {
    resumoContent.appendChild(createDetailRow('Valor total', formatMoney(entry.agenda.valor)));
  }
  if (entry.agenda?.observacao) {
    resumoContent.appendChild(createDetailRow('Observações do agendamento', entry.agenda.observacao));
  }
  resumo.appendChild(resumoContent);

  renderConsultasSection(body, entry.consultas);
  renderVacinasSection(body, entry.vacinas);
  renderExamesSection(body, entry.exames);
  renderAnexosSection(body, entry.anexos);
  renderPesosSection(body, entry.pesos);
  renderObservacoesSection(body, entry.observacoes);
  renderDocumentosSection(body, entry.documentos);
  renderReceitasSection(body, entry.receitas);

  const footer = document.createElement('footer');
  footer.className = 'flex flex-col gap-2 border-t border-gray-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end';
  dialog.appendChild(footer);

  if (isAdminRole() && typeof historicoHandlers.onReopen === 'function') {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400';
    editBtn.innerHTML = '<i class="fas fa-pen"></i><span>Editar atendimento</span>';
    editBtn.addEventListener('click', async () => {
      if (editBtn.disabled) return;
      editBtn.disabled = true;
      editBtn.classList.add('opacity-60', 'cursor-not-allowed');
      try {
        await Promise.resolve(historicoHandlers.onReopen(entry, () => overlay.remove()));
      } catch (error) {
        console.error('historico:onReopen', error);
      } finally {
        editBtn.disabled = false;
        editBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    });
    footer.appendChild(editBtn);
  }

  const closeAction = document.createElement('button');
  closeAction.type = 'button';
  closeAction.className = 'inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300';
  closeAction.textContent = 'Fechar';
  closeAction.addEventListener('click', () => overlay.remove());
  footer.appendChild(closeAction);

  closeBtn.addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        overlay.remove();
      }
    },
    { once: true },
  );

  return overlay;
}

export function openHistoricoEntryModal(entryId) {
  const entry = getHistoricoEntryById(entryId);
  if (!entry) {
    return;
  }
  const modal = buildHistoricoModal(entry);
  if (modal) {
    document.body.appendChild(modal);
  }
}

export function setActiveMainTab(tab) {
  const normalized = tab === 'historico' ? 'historico' : 'consulta';
  if (state.activeMainTab === normalized) {
    updateMainTabLayout();
    return;
  }
  state.activeMainTab = normalized;
  updateMainTabLayout();
}
