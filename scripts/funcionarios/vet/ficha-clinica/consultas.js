// Consulta management and agenda integration for the Vet ficha clínica
import {
  state,
  els,
  api,
  notify,
  pickFirst,
  normalizeId,
  normalizeForCompare,
  toIsoOrNull,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatMoney,
  getVetServices,
  getStatusLabel,
  CONSULTA_PLACEHOLDER_CLASSNAMES,
  CONSULTA_CARD_CLASSNAMES,
  CONSULTA_PLACEHOLDER_TEXT,
  consultaModal,
  getSelectedPet,
  formatFileSize,
} from './core.js';

function normalizeConsultaRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeId(raw.id || raw._id);
  if (!id) return null;

  const clienteId = normalizeId(raw.clienteId || raw.cliente);
  const petId = normalizeId(raw.petId || raw.pet);
  const servicoId = normalizeId(raw.servicoId || raw?.servico?._id || raw?.servico);
  const appointmentId = normalizeId(raw.appointmentId || raw.appointment);

  const servicoNome = pickFirst(
    raw.servicoNome,
    raw.servicoLabel,
    raw.servicoDescricao,
    raw?.servico?.nome,
  );

  const createdAt = toIsoOrNull(raw.createdAt || raw.criadoEm || raw.dataCriacao);
  const updatedAt = toIsoOrNull(raw.updatedAt || raw.atualizadoEm || raw.dataAtualizacao) || createdAt;

  return {
    id,
    _id: id,
    clienteId,
    petId,
    servicoId,
    servicoNome: servicoNome || '',
    appointmentId,
    anamnese: typeof raw.anamnese === 'string' ? raw.anamnese : '',
    exameFisico: typeof raw.exameFisico === 'string' ? raw.exameFisico : '',
    diagnostico: typeof raw.diagnostico === 'string' ? raw.diagnostico : '',
    createdAt,
    updatedAt,
  };
}

export function getConsultasKey(clienteId, petId) {
  const tutor = normalizeId(clienteId);
  const pet = normalizeId(petId);
  if (!(tutor && pet)) return null;
  return `${tutor}|${pet}`;
}

function getCurrentAgendaService() {
  const context = state.agendaContext || null;
  if (!context) return null;

  const services = Array.isArray(context.servicos) ? context.servicos : [];
  const normalized = services
    .map((svc) => {
      const id = normalizeId(svc?._id || svc?.id || svc?.servicoId || svc?.servico);
      if (!id) return null;
      const nome = pickFirst(
        svc?.nome,
        svc?.servicoNome,
        svc?.descricao,
        typeof svc === 'string' ? svc : '',
      );
      const categoriasRaw = Array.isArray(svc?.categorias)
        ? svc.categorias
        : (svc?.categorias ? [svc.categorias] : []);
      const categorias = categoriasRaw.map((cat) => String(cat || '').trim()).filter(Boolean);
      return {
        id,
        nome: nome || '',
        categorias,
      };
    })
    .filter(Boolean);

  const vetServices = normalized.filter((svc) => svc.categorias.some((cat) => normalizeForCompare(cat) === 'veterinario'));
  const chosen = vetServices[0] || normalized[0] || null;
  if (chosen) {
    return { id: chosen.id, nome: chosen.nome || '' };
  }

  const fallbackId = normalizeId(context.servicoId || context.servico);
  if (fallbackId) {
    const fallbackNome = pickFirst(context.servicoNome, context.servico);
    return { id: fallbackId, nome: fallbackNome || '' };
  }

  return null;
}

function findConsultaById(consultaId) {
  const targetId = normalizeId(consultaId);
  if (!targetId) return null;
  return (state.consultas || []).find((consulta) => normalizeId(consulta?.id || consulta?._id) === targetId) || null;
}

function setConsultaModalSubmitting(isSubmitting) {
  consultaModal.isSubmitting = !!isSubmitting;
  if (consultaModal.submitBtn) {
    consultaModal.submitBtn.disabled = !!isSubmitting;
    consultaModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
    consultaModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
    consultaModal.submitBtn.textContent = isSubmitting
      ? 'Salvando...'
      : (consultaModal.mode === 'edit' ? 'Salvar alterações' : 'Adicionar');
  }
  if (consultaModal.cancelBtn) {
    consultaModal.cancelBtn.disabled = !!isSubmitting;
    consultaModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
    consultaModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
  }
}

export function ensureTutorAndPetSelected() {
  const tutorId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (tutorId && petId) return true;
  notify('Selecione um tutor e um pet para registrar a consulta.', 'warning');
  return false;
}

function ensureAgendaServiceAvailable() {
  const service = getCurrentAgendaService();
  if (service && service.id) return service;
  notify('Nenhum serviço veterinário disponível para vincular à consulta. Abra a ficha pela agenda com um serviço veterinário.', 'warning');
  return null;
}

function upsertConsultaInState(record) {
  const normalized = normalizeConsultaRecord(record);
  if (!normalized) return null;
  const targetId = normalizeId(normalized.id || normalized._id);
  if (!targetId) return null;

  const next = Array.isArray(state.consultas) ? [...state.consultas] : [];
  const existingIdx = next.findIndex((item) => normalizeId(item?.id || item?._id) === targetId);
  const payload = { ...normalized, id: targetId, _id: targetId };
  if (existingIdx >= 0) {
    next[existingIdx] = { ...next[existingIdx], ...payload };
  } else {
    next.unshift(payload);
  }

  const deduped = [];
  const seen = new Set();
  next.forEach((item) => {
    const cid = normalizeId(item?.id || item?._id);
    if (!cid || seen.has(cid)) return;
    seen.add(cid);
    const createdAt = item.createdAt ? toIsoOrNull(item.createdAt) : null;
    const updatedAt = item.updatedAt ? toIsoOrNull(item.updatedAt) : createdAt;
    deduped.push({
      ...item,
      id: cid,
      _id: cid,
      createdAt,
      updatedAt,
    });
  });

  deduped.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  state.consultas = deduped;
  const key = getConsultasKey(state.selectedCliente?._id, state.selectedPetId);
  if (key) state.consultasLoadKey = key;

  return deduped.find((item) => normalizeId(item?.id || item?._id) === targetId) || payload;
}

export async function loadConsultasFromServer(options = {}) {
  const { force = false } = options || {};
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  if (!(clienteId && petId)) {
    state.consultas = [];
    state.consultasLoadKey = null;
    state.consultasLoading = false;
    updateConsultaAgendaCard();
    return;
  }

  const key = getConsultasKey(clienteId, petId);
  if (!force && key && state.consultasLoadKey === key) return;

  state.consultasLoading = true;
  updateConsultaAgendaCard();

  try {
    const params = new URLSearchParams({ clienteId, petId });
    const appointmentId = normalizeId(state.agendaContext?.appointmentId);
    if (appointmentId) params.set('appointmentId', appointmentId);

    const resp = await api(`/func/vet/consultas?${params.toString()}`);
    const payload = await resp.json().catch(() => (resp.ok ? [] : {}));
    if (!resp.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar consultas.';
      throw new Error(message);
    }

    const data = Array.isArray(payload) ? payload : [];
    const normalized = data.map(normalizeConsultaRecord).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    state.consultas = normalized;
    state.consultasLoadKey = key;
  } catch (error) {
    console.error('loadConsultasFromServer', error);
    state.consultas = [];
    state.consultasLoadKey = null;
    notify(error.message || 'Erro ao carregar consultas.', 'error');
  } finally {
    state.consultasLoading = false;
    updateConsultaAgendaCard();
  }
}

function createConsultaFieldSection(label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-1';

  const labelEl = document.createElement('span');
  labelEl.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  const valueEl = document.createElement('p');
  valueEl.className = 'text-sm text-gray-800 whitespace-pre-wrap break-words';
  valueEl.textContent = value ? value : '—';
  wrapper.appendChild(valueEl);

  return wrapper;
}

function createManualConsultaCard(consulta) {
  const card = document.createElement('article');
  card.className = 'group relative cursor-pointer rounded-xl border border-sky-200 bg-white p-4 shadow-sm transition hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400';
  card.tabIndex = 0;
  const consultaId = normalizeId(consulta?.id || consulta?._id);
  card.dataset.consultaId = consultaId || '';
  card.setAttribute('role', 'button');
  card.setAttribute('title', 'Clique para editar a consulta');

  const header = document.createElement('div');
  header.className = 'flex items-start gap-3';
  card.appendChild(header);

  const icon = document.createElement('div');
  icon.className = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600';
  icon.innerHTML = '<i class="fas fa-stethoscope"></i>';
  header.appendChild(icon);

  const headerText = document.createElement('div');
  headerText.className = 'flex-1';
  header.appendChild(headerText);

  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold text-sky-700';
  title.textContent = 'Registro de consulta';
  headerText.appendChild(title);

  const serviceName = pickFirst(consulta?.servicoNome);
  if (serviceName) {
    const serviceBadge = document.createElement('span');
    serviceBadge.className = 'mt-1 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700';
    const iconEl = document.createElement('i');
    iconEl.className = 'fas fa-paw text-[10px]';
    serviceBadge.appendChild(iconEl);
    const textEl = document.createElement('span');
    textEl.className = 'leading-none';
    textEl.textContent = serviceName;
    serviceBadge.appendChild(textEl);
    headerText.appendChild(serviceBadge);
  }

  const metaParts = [];
  if (consulta?.createdAt) {
    const created = formatDateTimeDisplay(consulta.createdAt);
    if (created) metaParts.push(`Registrado em ${created}`);
  }
  if (consulta?.updatedAt && consulta.updatedAt !== consulta.createdAt) {
    const updated = formatDateTimeDisplay(consulta.updatedAt);
    if (updated) metaParts.push(`Atualizado em ${updated}`);
  }
  if (metaParts.length) {
    const meta = document.createElement('p');
    meta.className = 'mt-0.5 text-xs text-gray-500';
    meta.textContent = metaParts.join(' · ');
    headerText.appendChild(meta);
  }

  const content = document.createElement('div');
  content.className = 'mt-4 grid gap-3';
  content.appendChild(createConsultaFieldSection('Anamnese', consulta?.anamnese || ''));
  content.appendChild(createConsultaFieldSection('Exame Físico', consulta?.exameFisico || ''));
  content.appendChild(createConsultaFieldSection('Diagnóstico', consulta?.diagnostico || ''));
  card.appendChild(content);

  const openForEdit = (event) => {
    event.preventDefault();
    openConsultaModal(consultaId || null);
  };
  card.addEventListener('click', openForEdit);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openForEdit(event);
    }
  });

  return card;
}

function getAnexoFileIconClass(file) {
  const ext = String(file?.extension || '').toLowerCase();
  if (ext === '.pdf') return 'fas fa-file-pdf';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'fas fa-file-image';
  return 'fas fa-file';
}

function createAnexoCard(anexo) {
  if (!anexo) return null;
  const arquivos = Array.isArray(anexo.arquivos) ? anexo.arquivos.filter(Boolean) : [];
  if (!arquivos.length) return null;

  const card = document.createElement('article');
  card.className = 'rounded-xl border border-indigo-200 bg-white p-4 shadow-sm';

  const header = document.createElement('div');
  header.className = 'flex items-start gap-3';
  card.appendChild(header);

  const icon = document.createElement('div');
  icon.className = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600';
  icon.innerHTML = '<i class="fas fa-paperclip"></i>';
  header.appendChild(icon);

  const headerText = document.createElement('div');
  headerText.className = 'flex-1';
  header.appendChild(headerText);

  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold text-indigo-700';
  title.textContent = 'Anexos';
  headerText.appendChild(title);

  const fileCount = arquivos.length;
  if (fileCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'mt-1 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700';
    const badgeIcon = document.createElement('i');
    badgeIcon.className = 'fas fa-files text-[10px]';
    badge.appendChild(badgeIcon);
    const badgeText = document.createElement('span');
    badgeText.className = 'leading-none';
    badgeText.textContent = `${fileCount} arquivo${fileCount === 1 ? '' : 's'}`;
    badge.appendChild(badgeText);
    headerText.appendChild(badge);
  }

  const metaParts = [];
  if (anexo.createdAt) {
    const created = formatDateTimeDisplay(anexo.createdAt);
    if (created) metaParts.push(`Registrado em ${created}`);
  }
  if (anexo.updatedAt && anexo.updatedAt !== anexo.createdAt) {
    const updated = formatDateTimeDisplay(anexo.updatedAt);
    if (updated) metaParts.push(`Atualizado em ${updated}`);
  }
  if (metaParts.length) {
    const meta = document.createElement('p');
    meta.className = 'mt-0.5 text-xs text-gray-500';
    meta.textContent = metaParts.join(' · ');
    headerText.appendChild(meta);
  }

  const list = document.createElement('div');
  list.className = 'mt-4 space-y-3';
  card.appendChild(list);

  arquivos.forEach((file) => {
    const item = document.createElement('div');
    item.className = 'flex flex-col gap-2 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between';
    list.appendChild(item);

    const info = document.createElement('div');
    info.className = 'flex items-start gap-3 text-sm text-indigo-700';
    item.appendChild(info);

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600';
    const fileIcon = document.createElement('i');
    fileIcon.className = getAnexoFileIconClass(file);
    iconWrapper.appendChild(fileIcon);
    info.appendChild(iconWrapper);

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0';
    info.appendChild(textWrap);

    const nameEl = document.createElement('p');
    nameEl.className = 'font-semibold leading-tight text-indigo-700 break-words';
    nameEl.textContent = file.nome || file.originalName || 'Arquivo';
    textWrap.appendChild(nameEl);

    const meta = document.createElement('p');
    meta.className = 'text-xs text-indigo-600';
    const metaPieces = [];
    if (file.originalName && file.originalName !== file.nome) metaPieces.push(file.originalName);
    const extension = String(file.extension || '').replace('.', '').toUpperCase();
    if (extension) metaPieces.push(extension);
    if (file.size) metaPieces.push(formatFileSize(file.size));
    meta.textContent = metaPieces.length ? metaPieces.join(' · ') : '—';
    textWrap.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2';
    let hasAction = false;
    if (file.url) {
      const link = document.createElement('a');
      link.href = file.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'inline-flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-600 hover:text-white';
      link.innerHTML = '<i class="fas fa-arrow-up-right-from-square text-[10px]"></i><span>Abrir</span>';
      if (file.originalName) {
        link.download = file.originalName;
      }
      actions.appendChild(link);
      hasAction = true;
    } else {
      const pending = document.createElement('span');
      pending.className = 'text-xs text-indigo-500';
      pending.textContent = 'Link disponível após sincronização.';
      actions.appendChild(pending);
      hasAction = true;
    }
    if (hasAction) {
      item.appendChild(actions);
    }
  });

  return card;
}

function createVacinaDetail(label, value) {
  const detail = document.createElement('div');
  detail.className = 'flex flex-wrap items-center gap-2 text-xs text-emerald-700';

  const badge = document.createElement('span');
  badge.className = 'inline-flex items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide';
  badge.textContent = label;
  detail.appendChild(badge);

  const text = document.createElement('span');
  text.className = 'font-medium text-emerald-700';
  text.textContent = value || '—';
  detail.appendChild(text);

  return detail;
}

function createVacinaCard(vacina) {
  if (!vacina) return null;

  const card = document.createElement('article');
  card.className = 'rounded-xl border border-emerald-200 bg-white p-4 shadow-sm';

  const header = document.createElement('div');
  header.className = 'flex items-start gap-3';
  card.appendChild(header);

  const icon = document.createElement('div');
  icon.className = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600';
  icon.innerHTML = '<i class="fas fa-syringe"></i>';
  header.appendChild(icon);

  const headerText = document.createElement('div');
  headerText.className = 'flex-1';
  header.appendChild(headerText);

  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold text-emerald-700';
  title.textContent = vacina?.servicoNome || 'Vacina';
  headerText.appendChild(title);

  const metaParts = [];
  if (vacina.createdAt) {
    const created = formatDateTimeDisplay(vacina.createdAt);
    if (created) metaParts.push(`Registrado em ${created}`);
  }
  if (metaParts.length) {
    const meta = document.createElement('p');
    meta.className = 'mt-0.5 text-xs text-emerald-600';
    meta.textContent = metaParts.join(' · ');
    headerText.appendChild(meta);
  }

  const details = document.createElement('div');
  details.className = 'mt-4 grid gap-2';
  card.appendChild(details);

  if (vacina.quantidade) {
    details.appendChild(createVacinaDetail('Quantidade', `${vacina.quantidade}`));
  }
  if (vacina.valorTotal) {
    details.appendChild(createVacinaDetail('Valor', formatMoney(vacina.valorTotal)));
  }
  if (vacina.aplicacao) {
    details.appendChild(createVacinaDetail('Aplicação', formatDateDisplay(vacina.aplicacao)));
  }
  if (vacina.renovacao) {
    details.appendChild(createVacinaDetail('Renovação', formatDateDisplay(vacina.renovacao)));
  }
  if (vacina.validade) {
    details.appendChild(createVacinaDetail('Validade', formatDateDisplay(vacina.validade)));
  }
  if (vacina.lote) {
    details.appendChild(createVacinaDetail('Lote', vacina.lote));
  }

  return card;
}

function createModalTextareaField(label, fieldName) {
  const wrapper = document.createElement('label');
  wrapper.className = 'grid gap-1';

  const span = document.createElement('span');
  span.className = 'text-sm font-medium text-gray-700';
  span.textContent = label;
  wrapper.appendChild(span);

  const textarea = document.createElement('textarea');
  textarea.name = fieldName;
  textarea.rows = 4;
  textarea.className = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300';
  wrapper.appendChild(textarea);

  return { wrapper, textarea };
}

export function ensureConsultaModal() {
  if (consultaModal.overlay) return consultaModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-consulta-modal';
  overlay.className = 'hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-3xl rounded-xl bg-white shadow-xl focus:outline-none';
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.appendChild(dialog);

  const form = document.createElement('form');
  form.className = 'flex flex-col gap-6 p-6';
  dialog.appendChild(form);

  const header = document.createElement('div');
  header.className = 'flex items-start justify-between gap-3';
  form.appendChild(header);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-gray-800';
  title.textContent = 'Nova consulta';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeConsultaModal();
  });
  header.appendChild(closeBtn);

  const fieldsWrapper = document.createElement('div');
  fieldsWrapper.className = 'grid gap-4';
  form.appendChild(fieldsWrapper);

  const contextInfo = document.createElement('div');
  contextInfo.className = 'hidden rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700';
  fieldsWrapper.appendChild(contextInfo);

  const anamneseField = createModalTextareaField('Anamnese', 'anamnese');
  fieldsWrapper.appendChild(anamneseField.wrapper);

  const exameField = createModalTextareaField('Exame Físico', 'exameFisico');
  fieldsWrapper.appendChild(exameField.wrapper);

  const diagnosticoField = createModalTextareaField('Diagnóstico', 'diagnostico');
  fieldsWrapper.appendChild(diagnosticoField.wrapper);

  const footer = document.createElement('div');
  footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
  form.appendChild(footer);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeConsultaModal();
  });
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:w-auto';
  submitBtn.textContent = 'Adicionar';
  footer.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleConsultaSubmit();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeConsultaModal();
    }
  });

  document.body.appendChild(overlay);

  consultaModal.overlay = overlay;
  consultaModal.dialog = dialog;
  consultaModal.form = form;
  consultaModal.titleEl = title;
  consultaModal.submitBtn = submitBtn;
  consultaModal.cancelBtn = cancelBtn;
  consultaModal.fields = {
    anamnese: anamneseField.textarea,
    exameFisico: exameField.textarea,
    diagnostico: diagnosticoField.textarea,
  };
  consultaModal.contextInfo = contextInfo;

  return consultaModal;
}

export function closeConsultaModal() {
  if (!consultaModal.overlay) return;
  consultaModal.overlay.classList.add('hidden');
  consultaModal.overlay.setAttribute('aria-hidden', 'true');
  if (consultaModal.form) consultaModal.form.reset();
  consultaModal.mode = 'create';
  consultaModal.editingId = null;
  consultaModal.activeServiceId = null;
  consultaModal.activeServiceName = '';
  setConsultaModalSubmitting(false);
  if (consultaModal.contextInfo) {
    consultaModal.contextInfo.textContent = '';
    consultaModal.contextInfo.classList.add('hidden');
  }
  if (consultaModal.keydownHandler) {
    document.removeEventListener('keydown', consultaModal.keydownHandler);
    consultaModal.keydownHandler = null;
  }
}

export function openConsultaModal(consultaId = null) {
  if (!consultaId && !ensureTutorAndPetSelected()) {
    return;
  }

  const modal = ensureConsultaModal();
  const isEditing = !!consultaId;
  const existing = isEditing ? findConsultaById(consultaId) : null;

  modal.mode = isEditing && existing ? 'edit' : 'create';
  modal.editingId = modal.mode === 'edit' ? normalizeId(existing?.id || existing?._id || consultaId) : null;

  if (modal.mode === 'edit' && !existing) {
    notify('Não foi possível localizar os dados da consulta selecionada.', 'error');
    return;
  }

  if (modal.mode === 'create') {
    const service = ensureAgendaServiceAvailable();
    if (!service) {
      return;
    }
    modal.activeServiceId = normalizeId(service.id);
    modal.activeServiceName = pickFirst(service.nome);
  } else {
    modal.activeServiceId = normalizeId(existing?.servicoId || existing?.servico);
    modal.activeServiceName = pickFirst(existing?.servicoNome);
  }

  if (modal.mode === 'create' && !modal.activeServiceId) {
    notify('Nenhum serviço veterinário disponível para vincular à consulta.', 'warning');
    return;
  }

  if (modal.titleEl) {
    modal.titleEl.textContent = modal.mode === 'edit' ? 'Editar consulta' : 'Nova consulta';
  }
  setConsultaModalSubmitting(false);

  if (modal.fields.anamnese) {
    modal.fields.anamnese.value = existing?.anamnese || '';
  }
  if (modal.fields.exameFisico) {
    modal.fields.exameFisico.value = existing?.exameFisico || '';
  }
  if (modal.fields.diagnostico) {
    modal.fields.diagnostico.value = existing?.diagnostico || '';
  }

  if (modal.contextInfo) {
    const tutorNome = pickFirst(
      state.selectedCliente?.nome,
      state.selectedCliente?.nomeCompleto,
      state.selectedCliente?.nomeContato,
      state.selectedCliente?.razaoSocial,
    );
    const pet = getSelectedPet();
    const petNome = pickFirst(pet?.nome, pet?.name);
    const parts = [];
    if (tutorNome) parts.push(`Tutor: ${tutorNome}`);
    if (petNome) parts.push(`Pet: ${petNome}`);
    if (modal.activeServiceName) parts.push(`Serviço: ${modal.activeServiceName}`);
    modal.contextInfo.textContent = parts.join(' · ');
    modal.contextInfo.classList.toggle('hidden', parts.length === 0);
  }

  modal.overlay.classList.remove('hidden');
  modal.overlay.removeAttribute('aria-hidden');
  if (modal.dialog) {
    modal.dialog.focus();
  }

  if (modal.keydownHandler) {
    document.removeEventListener('keydown', modal.keydownHandler);
  }
  modal.keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConsultaModal();
    }
  };
  document.addEventListener('keydown', modal.keydownHandler);

  setTimeout(() => {
    if (modal.fields.anamnese) {
      modal.fields.anamnese.focus();
    }
  }, 50);
}

async function handleConsultaSubmit() {
  const modal = ensureConsultaModal();
  if (modal.isSubmitting) return;

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para registrar a consulta.', 'warning');
    return;
  }

  const values = {
    anamnese: (modal.fields.anamnese?.value || '').trim(),
    exameFisico: (modal.fields.exameFisico?.value || '').trim(),
    diagnostico: (modal.fields.diagnostico?.value || '').trim(),
  };

  const editingConsulta = modal.mode === 'edit' && modal.editingId
    ? findConsultaById(modal.editingId)
    : null;

  const servicoId = normalizeId(
    modal.mode === 'edit'
      ? (editingConsulta?.servicoId || editingConsulta?.servico || modal.activeServiceId)
      : modal.activeServiceId,
  );
  if (!servicoId) {
    notify('Nenhum serviço veterinário disponível para vincular à consulta.', 'warning');
    return;
  }

  const appointmentId = normalizeId(
    modal.mode === 'edit'
      ? (editingConsulta?.appointmentId || editingConsulta?.appointment || state.agendaContext?.appointmentId)
      : state.agendaContext?.appointmentId,
  );

  const payload = {
    clienteId,
    petId,
    servicoId,
    anamnese: values.anamnese,
    exameFisico: values.exameFisico,
    diagnostico: values.diagnostico,
  };
  if (appointmentId) payload.appointmentId = appointmentId;

  setConsultaModalSubmitting(true);

  try {
    let response;
    let data;
    const isEdit = modal.mode === 'edit' && !!modal.editingId;
    if (isEdit) {
      response = await api(`/func/vet/consultas/${modal.editingId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      response = await api('/func/vet/consultas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    data = await response.json().catch(() => (response.ok ? {} : {}));
    if (!response.ok) {
      const message = typeof data?.message === 'string'
        ? data.message
        : (isEdit ? 'Erro ao atualizar consulta.' : 'Erro ao salvar consulta.');
      throw new Error(message);
    }

    const saved = upsertConsultaInState(data);
    if (!saved) {
      await loadConsultasFromServer({ force: true });
    } else {
      updateConsultaAgendaCard();
    }

    const wasEdit = isEdit;
    closeConsultaModal();
    notify(wasEdit ? 'Consulta atualizada com sucesso.' : 'Consulta registrada com sucesso.', 'success');
  } catch (error) {
    console.error('handleConsultaSubmit', error);
    notify(error.message || 'Erro ao salvar consulta.', 'error');
  } finally {
    setConsultaModalSubmitting(false);
  }
}

function setConsultaTabActive() {
  if (els.consultaTab) {
    els.consultaTab.classList.remove('bg-gray-100', 'text-gray-700', 'hover:bg-gray-50');
    els.consultaTab.classList.add('bg-sky-600', 'text-white');
  }
  if (els.historicoTab) {
    els.historicoTab.classList.remove('bg-sky-600', 'text-white');
    els.historicoTab.classList.add('bg-gray-100', 'text-gray-700', 'hover:bg-gray-50');
  }
}

export function updateConsultaAgendaCard() {
  const area = els.consultaArea;
  if (!area) return;
  setConsultaTabActive();

  const consultas = Array.isArray(state.consultas) ? state.consultas : [];
  const manualConsultas = consultas.filter((consulta) => !!normalizeId(consulta?.id || consulta?._id));
  const hasManualConsultas = manualConsultas.length > 0;
  const isLoadingConsultas = !!state.consultasLoading;
  const vacinas = Array.isArray(state.vacinas) ? state.vacinas : [];
  const hasVacinas = vacinas.length > 0;
  const anexos = Array.isArray(state.anexos) ? state.anexos : [];
  const hasAnexos = anexos.length > 0;
  const isLoadingAnexos = !!state.anexosLoading;
  const context = state.agendaContext;
  const selectedPetId = normalizeId(state.selectedPetId);
  const selectedTutorId = normalizeId(state.selectedCliente?._id);
  const contextPetId = normalizeId(context?.petId);
  const contextTutorId = normalizeId(context?.tutorId);

  let agendaElement = null;
  let hasAgendaContent = false;

  const contextMatches = !!(context && selectedPetId && selectedTutorId && contextPetId && contextTutorId && contextPetId === selectedPetId && contextTutorId === selectedTutorId);

  if (contextMatches) {
    const allServices = Array.isArray(context.servicos) ? context.servicos : [];
    const vetServices = getVetServices(allServices);
    const filteredOut = Math.max(allServices.length - vetServices.length, 0);

    if (!vetServices.length) {
      const wrapper = document.createElement('div');
      wrapper.className = 'rounded-xl border border-gray-200 bg-white p-5 text-sm text-slate-600 shadow-sm text-center';

      const emptyBox = document.createElement('div');
      emptyBox.className = 'w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-600';
      emptyBox.textContent = 'Nenhum serviço veterinário encontrado para este agendamento.';
      wrapper.appendChild(emptyBox);

      if (filteredOut > 0) {
        const note = document.createElement('p');
        note.className = 'mt-3 text-xs text-slate-500';
        note.textContent = `${filteredOut} serviço(s) de outras categorias foram ocultados.`;
        wrapper.appendChild(note);
      }

      agendaElement = wrapper;
      hasAgendaContent = true;
    } else {
      const card = document.createElement('div');
      card.className = 'bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-4';

      const header = document.createElement('div');
      header.className = 'flex flex-wrap items-start justify-between gap-3';
      card.appendChild(header);

      const info = document.createElement('div');
      header.appendChild(info);

      const title = document.createElement('h3');
      title.className = 'text-base font-semibold text-gray-800';
      title.textContent = 'Serviços veterinários agendados';
      info.appendChild(title);

      const metaList = document.createElement('div');
      metaList.className = 'mt-1 space-y-1 text-sm text-gray-600';
      const when = formatDateTimeDisplay(context.scheduledAt);
      if (when) {
        const whenEl = document.createElement('div');
        whenEl.textContent = `Atendimento em ${when}`;
        metaList.appendChild(whenEl);
      }
      if (context.profissionalNome) {
        const profEl = document.createElement('div');
        profEl.textContent = `Profissional: ${context.profissionalNome}`;
        metaList.appendChild(profEl);
      }
      if (metaList.children.length) info.appendChild(metaList);

      if (context.status) {
        const statusEl = document.createElement('span');
        statusEl.className = 'inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700';
        statusEl.textContent = getStatusLabel(context.status);
        header.appendChild(statusEl);
      }

      const list = document.createElement('div');
      list.className = 'rounded-lg border border-gray-200 overflow-hidden';
      card.appendChild(list);

      let total = 0;
      vetServices.forEach((service, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between px-4 py-2 text-sm text-gray-700 bg-white';
        if (idx % 2 === 1) {
          row.classList.add('bg-gray-50');
        }

        const name = document.createElement('span');
        name.textContent = service.nome || 'Serviço';
        row.appendChild(name);

        const price = document.createElement('span');
        price.className = 'font-semibold text-gray-900';
        price.textContent = formatMoney(service.valor || 0);
        row.appendChild(price);

        total += Number(service.valor || 0) || 0;
        list.appendChild(row);
      });

      if (context.valor || total) {
        const footer = document.createElement('div');
        footer.className = 'flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900';
        footer.innerHTML = `<span>Total</span><span>${formatMoney(context.valor || total)}</span>`;
        card.appendChild(footer);
      }

      const obs = pickFirst(context.observacao, context.observacoes, context.nota, context.notes);
      if (obs) {
        const obsWrap = document.createElement('div');
        obsWrap.className = 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600';
        const obsLabel = document.createElement('p');
        obsLabel.className = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
        obsLabel.textContent = 'Observações do agendamento';
        obsWrap.appendChild(obsLabel);
        const obsText = document.createElement('p');
        obsText.className = 'mt-1 whitespace-pre-wrap text-sm';
        obsText.textContent = obs;
        obsWrap.appendChild(obsText);
        card.appendChild(obsWrap);
      }

      agendaElement = card;
      hasAgendaContent = true;
    }
  }

  const hasAnyContent = hasManualConsultas || hasAgendaContent || hasVacinas || hasAnexos;
  const shouldShowPlaceholder = !hasAnyContent;

  if ((isLoadingConsultas || isLoadingAnexos) && !hasAnyContent) {
    area.className = CONSULTA_PLACEHOLDER_CLASSNAMES;
    area.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Carregando registros...';
    area.appendChild(paragraph);
    return;
  }

  if (shouldShowPlaceholder) {
    area.className = CONSULTA_PLACEHOLDER_CLASSNAMES;
    area.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = CONSULTA_PLACEHOLDER_TEXT;
    area.appendChild(paragraph);
    return;
  }

  area.className = CONSULTA_CARD_CLASSNAMES;
  area.innerHTML = '';

  const scroll = document.createElement('div');
  scroll.className = 'h-full w-full overflow-y-auto p-5 space-y-4';
  area.appendChild(scroll);

  if (hasAnexos) {
    const orderedAnexos = [...anexos];
    orderedAnexos.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    orderedAnexos.forEach((anexo) => {
      const card = createAnexoCard(anexo);
      if (card) scroll.appendChild(card);
    });
  }

  if (hasVacinas) {
    const orderedVacinas = [...vacinas];
    orderedVacinas.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    orderedVacinas.forEach((vacina) => {
      const card = createVacinaCard(vacina);
      if (card) scroll.appendChild(card);
    });
  }

  if (hasManualConsultas) {
    manualConsultas.forEach((consulta) => {
      const card = createManualConsultaCard(consulta);
      scroll.appendChild(card);
    });
  }

  if (agendaElement) {
    scroll.appendChild(agendaElement);
  }
}
