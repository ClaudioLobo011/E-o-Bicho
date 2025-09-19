// Documento modal handling for the Vet ficha clínica
import {
  state,
  api,
  notify,
  pickFirst,
  formatPhone,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatPetSex,
  formatPetWeight,
  formatPetMicrochip,
  getSelectedPet,
  getAgendaStoreId,
  normalizeId,
} from './core.js';
import { ensureTutorAndPetSelected, updateConsultaAgendaCard, getConsultasKey } from './consultas.js';
import {
  KEYWORD_GROUPS,
  renderPreviewFrameContent,
  getPreviewText,
  openDocumentPrintWindow,
  applyKeywordReplacements,
  keywordAppearsInContent,
} from '../document-utils.js';

const documentoModal = {
  overlay: null,
  dialog: null,
  select: null,
  previewFrame: null,
  previewTitle: null,
  previewEmpty: null,
  loadingState: null,
  emptyState: null,
  saveBtn: null,
  printBtn: null,
  keywordContainer: null,
  previewDefaultMessage: '',
  keywordItems: [],
  documents: [],
  isLoading: false,
  isGenerating: false,
  selectedId: '',
  keydownHandler: null,
};

const PREVIEW_LOADING_MESSAGE = 'Carregando pré-visualização com os dados do atendimento...';
const PREVIEW_ERROR_MESSAGE = 'Erro ao gerar pré-visualização do documento.';
const storeCache = new Map();
const storePromiseCache = new Map();
let previewUpdateToken = 0;

function renderKeywordReference() {
  if (!documentoModal.keywordContainer) return;
  documentoModal.keywordContainer.innerHTML = '';
  documentoModal.keywordItems = [];

  KEYWORD_GROUPS.forEach((group) => {
    if (!group || !Array.isArray(group.items) || !group.items.length) return;

    const section = document.createElement('div');
    section.className = 'space-y-2';

    const heading = document.createElement('h3');
    heading.className = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
    heading.textContent = group.title;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'grid gap-2';

    group.items.forEach((item) => {
      const token = typeof item?.token === 'string' ? item.token.trim() : '';
      if (!token) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm transition';

      const tokenEl = document.createElement('div');
      tokenEl.className = 'font-mono text-[11px] font-semibold text-slate-700';
      tokenEl.textContent = token;
      wrapper.appendChild(tokenEl);

      if (item.description) {
        const description = document.createElement('p');
        description.className = 'mt-1 text-xs text-slate-500';
        description.textContent = item.description;
        wrapper.appendChild(description);
      }

      documentoModal.keywordItems.push({ token, element: wrapper, label: tokenEl });
      list.appendChild(wrapper);
    });

    if (list.children.length) {
      section.appendChild(list);
      documentoModal.keywordContainer.appendChild(section);
    }
  });
}

function highlightKeywords(content) {
  const value = typeof content === 'string' ? content : '';
  documentoModal.keywordItems.forEach((item) => {
    const found = keywordAppearsInContent(value, item.token);
    item.element.classList.toggle('border-emerald-300', found);
    item.element.classList.toggle('bg-emerald-50', found);
    item.element.classList.toggle('text-emerald-700', found);
    if (item.label) {
      item.label.classList.toggle('text-emerald-700', found);
    }
  });
}

function setModalLoading(isLoading) {
  documentoModal.isLoading = !!isLoading;
  if (documentoModal.loadingState) {
    documentoModal.loadingState.classList.toggle('hidden', !isLoading);
  }
  if (documentoModal.select) {
    documentoModal.select.disabled = !!isLoading;
    documentoModal.select.classList.toggle('opacity-60', !!isLoading);
  }
  updateButtonsState();
}

function updateButtonsState() {
  const hasSelection = !!getSelectedDocument();
  const disabled = documentoModal.isLoading || documentoModal.isGenerating || !hasSelection;
  if (documentoModal.saveBtn) {
    documentoModal.saveBtn.disabled = disabled;
    documentoModal.saveBtn.classList.toggle('opacity-60', disabled);
    documentoModal.saveBtn.classList.toggle('cursor-not-allowed', disabled);
  }
  if (documentoModal.printBtn) {
    documentoModal.printBtn.disabled = disabled;
    documentoModal.printBtn.classList.toggle('opacity-60', disabled);
    documentoModal.printBtn.classList.toggle('cursor-not-allowed', disabled);
  }
}

function normalizeDocumentRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw._id || '').trim();
  if (!id) return null;
  const descricao = typeof raw.descricao === 'string' ? raw.descricao.trim() : '';
  const conteudo = typeof raw.conteudo === 'string' ? raw.conteudo : '';
  const createdAt = raw.createdAt ? new Date(raw.createdAt).toISOString() : null;
  const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).toISOString() : createdAt;
  return { id, descricao, conteudo, createdAt, updatedAt };
}

function formatDocumentNumber(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';
  const digits = str.replace(/\D+/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return str;
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === 'number') {
    const dateFromNumber = new Date(value);
    return Number.isNaN(dateFromNumber.getTime()) ? null : dateFromNumber;
  }
  const str = String(value).trim();
  if (!str) return null;
  let parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const match = str.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    parsed = new Date(`${year}-${month}-${day}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function formatTimeDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return '';
  }
}

function formatPetAge(pet) {
  if (!pet) return '';
  const birthRaw = pickFirst(pet?.dataNascimento, pet?.nascimento);
  const birthDate = parseDateValue(birthRaw);
  if (!birthDate) return '';
  const now = new Date();
  if (Number.isNaN(now.getTime()) || birthDate > now) return '';

  let totalMonths = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());
  if (now.getDate() < birthDate.getDate()) {
    totalMonths -= 1;
  }
  if (totalMonths < 0) totalMonths = 0;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ano${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} mês${months === 1 ? '' : 'es'}`);
  if (!parts.length) {
    const diffMs = now.getTime() - birthDate.getTime();
    const days = Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 0);
    if (days > 0) {
      parts.push(`${days} dia${days === 1 ? '' : 's'}`);
    } else {
      parts.push('Recém-nascido');
    }
  }
  return parts.join(' e ');
}

function getLatestPetWeightValue() {
  const entries = Array.isArray(state.pesos) ? state.pesos.slice() : [];
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  const recent = entries.find((entry) => entry && entry.peso !== null && entry.peso !== undefined && !entry.isInitial);
  const fallback = entries.find((entry) => entry && entry.peso !== null && entry.peso !== undefined);
  const target = recent || fallback || null;
  if (!target) return null;
  const value = target.peso;
  if (value === null || value === undefined) return null;
  return value;
}

function getLatestConsultaWithData() {
  const consultas = Array.isArray(state.consultas) ? state.consultas.slice() : [];
  if (!consultas.length) return null;
  consultas.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  for (const consulta of consultas) {
    if (!consulta) continue;
    if (pickFirst(consulta.anamnese, consulta.diagnostico, consulta.exameFisico, consulta.servicoNome)) {
      return consulta;
    }
  }
  return consultas[0] || null;
}

function extractServiceName(consulta, agenda) {
  const consultaName = pickFirst(consulta?.servicoNome);
  if (consultaName) return consultaName;
  const services = Array.isArray(agenda?.servicos) ? agenda.servicos : [];
  for (const service of services) {
    const name = pickFirst(
      service?.nome,
      service?.servicoNome,
      service?.descricao,
      service?.label,
      service?.servico?.nome,
      typeof service === 'string' ? service : '',
    );
    if (name) return name;
  }
  return pickFirst(
    agenda?.servicoNome,
    agenda?.servico,
    agenda?.nomeServico,
    agenda?.descricaoServico,
  );
}

function getAgendaScheduledDate(agenda, consulta) {
  const candidates = [
    agenda?.scheduledAt,
    agenda?.data,
    agenda?.dataHora,
    agenda?.horario,
    agenda?.inicio,
    consulta?.createdAt,
  ];
  for (const candidate of candidates) {
    const parsed = parseDateValue(candidate);
    if (parsed) return parsed;
  }
  return null;
}

async function fetchStoreInfoById(storeId) {
  const normalized = typeof storeId === 'string' ? storeId.trim() : '';
  if (!normalized) return null;
  if (storeCache.has(normalized)) return storeCache.get(normalized);
  if (storePromiseCache.has(normalized)) return storePromiseCache.get(normalized);

  const promise = api(`/stores/${encodeURIComponent(normalized)}`)
    .then((resp) => {
      if (!resp.ok) return null;
      return resp.json().catch(() => null);
    })
    .then((data) => {
      if (data && data._id) {
        storeCache.set(normalized, data);
        return data;
      }
      return null;
    })
    .catch((error) => {
      console.error('fetchStoreInfoById', error);
      return null;
    })
    .finally(() => {
      storePromiseCache.delete(normalized);
    });

  storePromiseCache.set(normalized, promise);
  return promise;
}

function buildClinicLogoReplacement({ agenda, store, clinicName }) {
  const fallbackUrl = '/public/image/logo.svg';
  const alt = pickFirst(
    clinicName,
    store?.nome,
    agenda?.storeNome,
    agenda?.empresaNome,
    'Logo da clínica',
  );

  return {
    __kind: 'logo',
    url: fallbackUrl,
    alt: alt || 'Logo da clínica',
    defaultMaxWidth: '240px',
  };
}

async function buildKeywordReplacements() {
  const replacements = {};
  KEYWORD_GROUPS.forEach((group) => {
    if (!group || !Array.isArray(group.items)) return;
    group.items.forEach((item) => {
      const token = typeof item?.token === 'string' ? item.token : '';
      if (token && !(token in replacements)) {
        replacements[token] = '';
      }
    });
  });

  if (Object.prototype.hasOwnProperty.call(replacements, '<LogoClinica>')) {
    replacements['<LogoClinica>'] = buildClinicLogoReplacement({ agenda: null, store: null, clinicName: '' });
  }

  try {
    const tutor = state.selectedCliente || null;
    const pet = getSelectedPet();
    const agenda = state.agendaContext || {};
    const consulta = getLatestConsultaWithData();
    const now = new Date();

    replacements['<NomeTutor>'] = pickFirst(
      tutor?.nome,
      tutor?.nomeCompleto,
      tutor?.razaoSocial,
      tutor?.nomeFantasia,
      tutor?.nomeContato,
      tutor?.apelido,
      tutor?.displayName,
    );
    replacements['<EmailTutor>'] = pickFirst(tutor?.email);
    const tutorPhone = pickFirst(
      tutor?.celular,
      tutor?.telefone,
      tutor?.whatsapp,
      tutor?.phone,
      tutor?.mobile,
    );
    replacements['<TelefoneTutor>'] = tutorPhone ? formatPhone(tutorPhone) : '';
    const tutorDocument = pickFirst(
      formatDocumentNumber(tutor?.documento),
      formatDocumentNumber(tutor?.documentoPrincipal),
      formatDocumentNumber(tutor?.cpf),
      formatDocumentNumber(tutor?.cpfCnpj),
      formatDocumentNumber(tutor?.cnpj),
      formatDocumentNumber(tutor?.inscricaoEstadual),
    );
    replacements['<DocumentoTutor>'] = tutorDocument;

    replacements['<NomePet>'] = pickFirst(
      pet?.nome,
      pet?.nomePet,
      pet?.apelido,
    );
    replacements['<EspeciePet>'] = pickFirst(
      pet?.especie,
      pet?.tipo,
      pet?.tipoPet,
      pet?.categoria,
      pet?.porte,
      pet?.especiePet,
    );
    replacements['<RacaPet>'] = pickFirst(
      pet?.raca,
      pet?.breed,
      pet?.racaNome,
      pet?.racaDescricao,
      pet?.racaPrincipal,
      pet?.racaOriginal,
      pet?.racaPet,
      pet?.racaLabel,
      pet?.raca?.nome,
      pet?.raca?.descricao,
      pet?.raca?.label,
    );
    replacements['<SexoPet>'] = pet ? formatPetSex(pet.sexo) : '';

    const nascimento = parseDateValue(pickFirst(pet?.dataNascimento, pet?.nascimento));
    replacements['<NascimentoPet>'] = nascimento ? formatDateDisplay(nascimento) : '';
    replacements['<IdadePet>'] = formatPetAge(pet);

    const latestPeso = getLatestPetWeightValue();
    const pesoFonte = latestPeso !== null ? latestPeso : pickFirst(pet?.pesoAtual, pet?.peso, pet?.ultimoPeso);
    replacements['<PesoPet>'] =
      pesoFonte !== null && pesoFonte !== undefined && pesoFonte !== ''
        ? formatPetWeight(pesoFonte)
        : '';

    const microchip = pickFirst(pet?.microchip, pet?.microChip, pet?.chip);
    replacements['<MicrochipPet>'] = microchip ? formatPetMicrochip(microchip) : '';

    const atendimentoDate = getAgendaScheduledDate(agenda, consulta);
    replacements['<DataAtendimento>'] = atendimentoDate ? formatDateDisplay(atendimentoDate) : '';
    replacements['<HoraAtendimento>'] = atendimentoDate ? formatTimeDisplay(atendimentoDate) : '';

    replacements['<NomeServico>'] = extractServiceName(consulta, agenda);

    replacements['<MotivoConsulta>'] = pickFirst(
      consulta?.anamnese,
      agenda?.observacoes,
      agenda?.observacao,
      agenda?.nota,
      agenda?.motivo,
    );
    replacements['<DiagnosticoConsulta>'] = pickFirst(consulta?.diagnostico);
    replacements['<ExameFisicoConsulta>'] = pickFirst(consulta?.exameFisico);
    replacements['<NomeVeterinario>'] = pickFirst(
      agenda?.profissionalNome,
      agenda?.veterinarioNome,
      agenda?.profissional?.nome,
      agenda?.profissional?.nomeCompleto,
    );

    const storeId = getAgendaStoreId({ persist: false });
    const store = storeId ? await fetchStoreInfoById(storeId) : null;

    replacements['<NomeClinica>'] = pickFirst(
      agenda?.storeNome,
      agenda?.lojaNome,
      agenda?.filialNome,
      agenda?.empresaNome,
      agenda?.empresa,
      store?.nome,
    );
    replacements['<EnderecoClinica>'] = pickFirst(
      agenda?.storeEndereco,
      agenda?.lojaEndereco,
      agenda?.endereco,
      store?.endereco,
    );
    const clinicPhone = pickFirst(agenda?.storeTelefone, agenda?.telefone, store?.telefone);
    replacements['<TelefoneClinica>'] = clinicPhone ? formatPhone(clinicPhone) : '';
    const clinicWhatsapp = pickFirst(agenda?.storeWhatsapp, agenda?.whatsapp, store?.whatsapp);
    replacements['<WhatsappClinica>'] = clinicWhatsapp ? formatPhone(clinicWhatsapp) : '';

    replacements['<DataAtual>'] = formatDateDisplay(now);
    replacements['<HoraAtual>'] = formatTimeDisplay(now);
    replacements['<DataHoraAtual>'] = formatDateTimeDisplay(now);

    const clinicName = replacements['<NomeClinica>'] || '';
    if (Object.prototype.hasOwnProperty.call(replacements, '<LogoClinica>')) {
      replacements['<LogoClinica>'] = buildClinicLogoReplacement({ agenda, store, clinicName });
    }
  } catch (error) {
    console.error('buildKeywordReplacements', error);
  }

  return replacements;
}

async function resolveDocumentContent(doc) {
  const rawContent = typeof doc?.conteudo === 'string' ? doc.conteudo : '';
  const replacements = await buildKeywordReplacements();
  const html = applyKeywordReplacements(rawContent, replacements);
  return { html, replacements };
}

function ensureDocumentoModal() {
  if (documentoModal.overlay) return documentoModal;

  const overlay = document.createElement('div');
  overlay.id = 'vet-documento-modal';
  overlay.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4';
  overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.5)';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'w-full overflow-hidden rounded-xl bg-white shadow-2xl focus:outline-none';
  dialog.style.maxWidth = '72rem';
  dialog.style.maxHeight = 'calc(100vh - 2rem)';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  overlay.appendChild(dialog);

  const layout = document.createElement('div');
  layout.className = 'flex flex-col overflow-hidden';
  layout.style.maxHeight = '90vh';
  dialog.appendChild(layout);

  const header = document.createElement('div');
  header.className = 'flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-6 py-4';
  layout.appendChild(header);

  const titleWrap = document.createElement('div');
  header.appendChild(titleWrap);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-gray-900';
  title.textContent = 'Gerar documento';
  titleWrap.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-gray-600';
  subtitle.textContent = 'Selecione um documento salvo para utilizar durante o atendimento.';
  titleWrap.appendChild(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'h-9 w-9 grid place-content-center rounded-lg bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700';
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.addEventListener('click', () => closeDocumentoModal());
  header.appendChild(closeBtn);

  const content = document.createElement('div');
  content.className = 'flex flex-1 flex-col overflow-y-auto px-6 py-5';
  content.style.minHeight = '0';
  layout.appendChild(content);

  const bodyWrapper = document.createElement('div');
  bodyWrapper.className = 'flex flex-1 flex-col gap-5 lg:flex-row';
  bodyWrapper.style.minHeight = '0';
  content.appendChild(bodyWrapper);

  const leftColumn = document.createElement('div');
  leftColumn.className = 'flex min-w-0 flex-1 flex-col gap-4';
  leftColumn.style.minHeight = '0';
  bodyWrapper.appendChild(leftColumn);

  const rightColumn = document.createElement('div');
  rightColumn.className = 'flex flex-1 flex-col';
  rightColumn.style.minHeight = '0';
  bodyWrapper.appendChild(rightColumn);

  const selectCard = document.createElement('div');
  selectCard.className = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm';
  leftColumn.appendChild(selectCard);

  const selectField = document.createElement('div');
  selectField.className = 'space-y-2';
  selectCard.appendChild(selectField);

  const selectLabel = document.createElement('label');
  selectLabel.className = 'text-sm font-medium text-gray-700';
  selectLabel.textContent = 'Documento salvo';
  selectLabel.setAttribute('for', 'vet-documento-select');
  selectField.appendChild(selectLabel);

  const select = document.createElement('select');
  select.id = 'vet-documento-select';
  select.className = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200';
  select.addEventListener('change', () => handleSelectChange());
  selectField.appendChild(select);

  const selectHelp = document.createElement('p');
  selectHelp.className = 'text-xs text-gray-500';
  selectHelp.textContent = 'Os modelos utilizam palavras-chave que serão substituídas automaticamente pelos dados do tutor, pet e atendimento.';
  selectField.appendChild(selectHelp);

  const loadingState = document.createElement('div');
  loadingState.className = 'hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 shadow-inner';
  loadingState.textContent = 'Carregando documentos salvos...';
  leftColumn.appendChild(loadingState);

  const emptyState = document.createElement('div');
  emptyState.className = 'hidden rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm';
  emptyState.textContent = 'Nenhum documento salvo foi encontrado.';
  leftColumn.appendChild(emptyState);

  const previewCard = document.createElement('div');
  previewCard.className = 'flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-inner';
  previewCard.style.minHeight = '260px';
  leftColumn.appendChild(previewCard);

  const previewBar = document.createElement('div');
  previewBar.className = 'flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600';
  previewBar.innerHTML = '<i class="fas fa-eye text-sky-600"></i><span>Pré-visualização</span>';
  previewCard.appendChild(previewBar);

  const previewTitle = document.createElement('p');
  previewTitle.className = 'px-4 py-2 text-sm font-semibold text-slate-700';
  previewTitle.textContent = 'Nenhum documento selecionado.';
  previewCard.appendChild(previewTitle);

  const previewWrapper = document.createElement('div');
  previewWrapper.className = 'relative flex-1 bg-white';
  previewWrapper.style.minHeight = '0';
  previewCard.appendChild(previewWrapper);

  const previewFrame = document.createElement('iframe');
  previewFrame.className = 'block h-full w-full bg-white';
  previewFrame.style.minHeight = '260px';
  previewFrame.id = 'vet-documento-preview-frame';
  previewFrame.setAttribute('loading', 'lazy');
  previewWrapper.appendChild(previewFrame);

  const previewEmpty = document.createElement('div');
  previewEmpty.className = 'absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-500';
  previewEmpty.textContent = 'Selecione um documento para visualizar com as palavras-chave atualizadas.';
  previewEmpty.dataset.defaultMessage = previewEmpty.textContent;
  previewWrapper.appendChild(previewEmpty);

  const keywordsSection = document.createElement('div');
  keywordsSection.className = 'flex flex-1 flex-col rounded-xl border border-dashed border-slate-300 bg-white p-4 shadow-sm';
  keywordsSection.style.minHeight = '0';
  rightColumn.appendChild(keywordsSection);

  const keywordsTitle = document.createElement('h3');
  keywordsTitle.className = 'text-sm font-semibold text-slate-700';
  keywordsTitle.textContent = 'Palavras-chave disponíveis';
  keywordsSection.appendChild(keywordsTitle);

  const keywordsHelp = document.createElement('p');
  keywordsHelp.className = 'mt-1 text-xs text-slate-500';
  keywordsHelp.textContent = 'As palavras abaixo são substituídas automaticamente pelos dados atuais do atendimento.';
  keywordsSection.appendChild(keywordsHelp);

  const keywordsScroll = document.createElement('div');
  keywordsScroll.className = 'mt-3 flex-1 overflow-y-auto pr-2';
  keywordsScroll.style.minHeight = '0';
  keywordsSection.appendChild(keywordsScroll);

  const keywordsContainer = document.createElement('div');
  keywordsContainer.className = 'grid gap-2 md:grid-cols-2';
  keywordsScroll.appendChild(keywordsContainer);

  const footer = document.createElement('div');
  footer.className = 'flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-slate-50 px-6 py-4';
  layout.appendChild(footer);

  const footerInfo = document.createElement('p');
  footerInfo.className = 'text-xs text-slate-500';
  footerInfo.textContent = 'Salve para registrar o documento na aba de consultas ou imprima imediatamente.';
  footer.appendChild(footerInfo);

  const footerActions = document.createElement('div');
  footerActions.className = 'flex flex-wrap items-center gap-2';
  footer.appendChild(footerActions);

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200';
  printBtn.innerHTML = '<i class="fas fa-print"></i><span>Imprimir</span>';
  printBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const result = handlePrint();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  });
  footerActions.appendChild(printBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-300';
  saveBtn.innerHTML = '<i class="fas fa-save"></i><span>Salvar no atendimento</span>';
  saveBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const result = handleSave();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  });
  footerActions.appendChild(saveBtn);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDocumentoModal();
    }
  });

  documentoModal.overlay = overlay;
  documentoModal.dialog = dialog;
  documentoModal.select = select;
  documentoModal.previewFrame = previewFrame;
  documentoModal.previewTitle = previewTitle;
  documentoModal.previewEmpty = previewEmpty;
  documentoModal.previewDefaultMessage = previewEmpty.textContent || '';
  documentoModal.loadingState = loadingState;
  documentoModal.emptyState = emptyState;
  documentoModal.saveBtn = saveBtn;
  documentoModal.printBtn = printBtn;
  documentoModal.keywordContainer = keywordsContainer;
  documentoModal.keywordItems = [];
  documentoModal.documents = [];
  documentoModal.selectedId = '';
  documentoModal.isLoading = false;
  documentoModal.isGenerating = false;

  renderKeywordReference();
  document.body.appendChild(overlay);
  return documentoModal;
}

function getSelectedDocument() {
  const id = String(documentoModal.selectedId || '').trim();
  if (!id) return null;
  return documentoModal.documents.find((doc) => doc.id === id) || null;
}

function populateDocumentOptions() {
  if (!documentoModal.select) return;

  const docs = Array.isArray(documentoModal.documents) ? documentoModal.documents : [];
  documentoModal.select.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = docs.length ? 'Selecione um documento salvo' : 'Nenhum documento encontrado';
  placeholder.disabled = !!docs.length;
  placeholder.selected = true;
  documentoModal.select.appendChild(placeholder);

  docs.forEach((doc) => {
    const option = document.createElement('option');
    option.value = doc.id;
    option.textContent = doc.descricao || 'Documento';
    documentoModal.select.appendChild(option);
  });

  if (documentoModal.emptyState) {
    documentoModal.emptyState.classList.toggle('hidden', docs.length > 0);
  }

  if (docs.length) {
    const hasPreviousSelection = docs.some((doc) => doc.id === documentoModal.selectedId);
    const targetId = hasPreviousSelection ? documentoModal.selectedId : docs[0].id;
    documentoModal.selectedId = targetId;
    documentoModal.select.value = targetId;
    updatePreview().catch(() => {});
  } else {
    documentoModal.selectedId = '';
    updatePreview().catch(() => {});
  }

  updateButtonsState();
}

async function updatePreview() {
  const doc = getSelectedDocument();
  const previewFrame = documentoModal.previewFrame;
  const previewTitle = documentoModal.previewTitle;
  const previewEmpty = documentoModal.previewEmpty;
  const defaultMessage = documentoModal.previewDefaultMessage
    || previewEmpty?.dataset?.defaultMessage
    || 'Selecione um documento para visualizar com as palavras-chave atualizadas.';

  if (!doc) {
    if (previewTitle) {
      previewTitle.textContent = 'Nenhum documento selecionado.';
    }
    if (previewEmpty) {
      previewEmpty.textContent = defaultMessage;
      previewEmpty.classList.remove('hidden');
    }
    if (previewFrame) {
      renderPreviewFrameContent(previewFrame, '', { minHeight: 260, background: '#f8fafc' });
    }
    highlightKeywords('');
    documentoModal.isGenerating = false;
    updateButtonsState();
    return;
  }

  if (previewTitle) {
    previewTitle.textContent = doc.descricao || 'Documento salvo';
  }
  highlightKeywords(doc.conteudo || '');
  if (previewEmpty) {
    previewEmpty.textContent = PREVIEW_LOADING_MESSAGE;
    previewEmpty.classList.remove('hidden');
  }
  if (previewFrame) {
    renderPreviewFrameContent(previewFrame, '', { minHeight: 260, background: '#f8fafc' });
  }

  const requestId = ++previewUpdateToken;
  documentoModal.isGenerating = true;
  updateButtonsState();

  try {
    const { html } = await resolveDocumentContent(doc);
    if (requestId !== previewUpdateToken) return;
    if (previewFrame) {
      renderPreviewFrameContent(previewFrame, html, { minHeight: 260, background: '#f8fafc' });
    }
    if (previewEmpty) {
      previewEmpty.textContent = defaultMessage;
      previewEmpty.classList.add('hidden');
    }
  } catch (error) {
    console.error('updatePreview', error);
    if (requestId !== previewUpdateToken) return;
    if (previewEmpty) {
      previewEmpty.textContent = PREVIEW_ERROR_MESSAGE;
      previewEmpty.classList.remove('hidden');
    }
    if (previewFrame) {
      renderPreviewFrameContent(previewFrame, '', { minHeight: 260, background: '#f8fafc' });
    }
  } finally {
    if (requestId === previewUpdateToken) {
      documentoModal.isGenerating = false;
      updateButtonsState();
    }
  }
}

function handleSelectChange() {
  if (!documentoModal.select) return;
  documentoModal.selectedId = documentoModal.select.value || '';
  updatePreview().catch(() => {});
}

async function loadDocuments({ force = false } = {}) {
  const modal = ensureDocumentoModal();
  if (modal.isLoading) return;
  if (!force && Array.isArray(modal.documents) && modal.documents.length) {
    populateDocumentOptions();
    return;
  }

  setModalLoading(true);
  try {
    const resp = await api('/func/vet/documentos');
    const payload = await resp.json().catch(() => (resp.ok ? [] : {}));
    if (!resp.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar documentos.';
      throw new Error(message);
    }

    const docs = Array.isArray(payload) ? payload : [];
    const normalized = docs.map(normalizeDocumentRecord).filter(Boolean);
    normalized.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });

    modal.documents = normalized;
    populateDocumentOptions();
  } catch (error) {
    console.error('loadDocumentos', error);
    notify(error.message || 'Erro ao carregar documentos salvos.', 'error');
    modal.documents = [];
    populateDocumentOptions();
  } finally {
    setModalLoading(false);
  }
}

export async function loadDocumentosFromServer(options = {}) {
  const { force = false } = options || {};
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);

  if (!(clienteId && petId)) {
    state.documentos = [];
    state.documentosLoadKey = null;
    state.documentosLoading = false;
    updateConsultaAgendaCard();
    return;
  }

  const key = getConsultasKey(clienteId, petId);
  if (!force && key && state.documentosLoadKey === key) return;

  state.documentosLoading = true;
  updateConsultaAgendaCard();

  try {
    const params = new URLSearchParams({ clienteId, petId });
    const appointmentId = normalizeId(state.agendaContext?.appointmentId);
    if (appointmentId) params.set('appointmentId', appointmentId);

    const resp = await api(`/func/vet/documentos-registros?${params.toString()}`);
    const payload = await resp.json().catch(() => (resp.ok ? [] : {}));
    if (!resp.ok) {
      const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar documentos do atendimento.';
      throw new Error(message);
    }

    setDocumentoRegistrosInState(Array.isArray(payload) ? payload : []);
  } catch (error) {
    console.error('loadDocumentosFromServer', error);
    state.documentos = [];
    state.documentosLoadKey = null;
    notify(error.message || 'Erro ao carregar documentos do atendimento.', 'error');
  } finally {
    state.documentosLoading = false;
    updateConsultaAgendaCard();
  }
}

function prepareDocumentRecordPayload(doc, resolvedHtml = '') {
  if (!doc || typeof doc !== 'object') return null;
  const docId = normalizeId(doc.id || doc._id);
  if (!docId) return null;
  const finalHtml = typeof resolvedHtml === 'string' ? resolvedHtml : '';
  const previewSource = finalHtml || (typeof doc.conteudo === 'string' ? doc.conteudo : '');
  return {
    documentoId: docId,
    descricao: typeof doc.descricao === 'string' && doc.descricao.trim()
      ? doc.descricao.trim()
      : 'Documento',
    conteudo: finalHtml,
    conteudoOriginal: typeof doc.conteudo === 'string' ? doc.conteudo : '',
    preview: getPreviewText(previewSource),
  };
}

function normalizeDocumentoRegistroRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeId(raw.id || raw._id);
  if (!id) return null;

  const documentoId = normalizeId(raw.documentoId || raw.documento);
  const descricao = typeof raw.descricao === 'string' ? raw.descricao.trim() : '';
  const conteudo = typeof raw.conteudo === 'string' ? raw.conteudo : '';
  const conteudoOriginal = typeof raw.conteudoOriginal === 'string' ? raw.conteudoOriginal : '';
  const previewSource = typeof raw.preview === 'string' && raw.preview
    ? raw.preview
    : getPreviewText(conteudo || conteudoOriginal);

  const clienteId = normalizeId(raw.clienteId || raw.cliente);
  const petId = normalizeId(raw.petId || raw.pet);
  const appointmentId = normalizeId(raw.appointmentId || raw.appointment);

  const createdAtDate = parseDateValue(raw.createdAt || raw.criadoEm || raw.dataCriacao);
  const updatedAtDate = parseDateValue(raw.updatedAt || raw.atualizadoEm || raw.dataAtualizacao) || createdAtDate;
  const createdAt = createdAtDate ? createdAtDate.toISOString() : null;
  const updatedAt = updatedAtDate ? updatedAtDate.toISOString() : createdAt;

  return {
    id,
    _id: id,
    documentoId,
    descricao,
    conteudo,
    conteudoOriginal,
    preview: previewSource,
    createdAt,
    updatedAt,
    clienteId,
    petId,
    appointmentId,
  };
}

function upsertDocumentoRegistroInState(record) {
  const normalized = normalizeDocumentoRegistroRecord(record);
  if (!normalized) return null;

  const list = Array.isArray(state.documentos) ? [...state.documentos] : [];
  const targetId = normalizeId(normalized.id || normalized._id);
  const existingIdx = list.findIndex((item) => normalizeId(item?.id || item?._id) === targetId);

  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], ...normalized };
  } else {
    list.unshift(normalized);
  }

  list.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  state.documentos = list;
  const key = getConsultasKey(state.selectedCliente?._id, state.selectedPetId);
  if (key) state.documentosLoadKey = key;

  return list.find((item) => normalizeId(item?.id || item?._id) === targetId) || normalized;
}

function setDocumentoRegistrosInState(records) {
  const list = Array.isArray(records)
    ? records.map(normalizeDocumentoRegistroRecord).filter(Boolean)
    : [];

  list.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  state.documentos = list;
  const key = getConsultasKey(state.selectedCliente?._id, state.selectedPetId);
  if (key) state.documentosLoadKey = key;

  return list;
}

export async function deleteDocumentoRegistro(target, options = {}) {
  const { suppressNotify = false } = options;
  const targetId = normalizeId(
    target && typeof target === 'object' ? target.id || target._id : target,
  );
  if (!targetId) return false;

  const current = Array.isArray(state.documentos) ? state.documentos : [];
  const filtered = current.filter((item) => normalizeId(item?.id || item?._id) !== targetId);
  const hadEntry = filtered.length !== current.length;

  try {
    const resp = await api(`/func/vet/documentos-registros/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
    });

    if (!resp.ok) {
      if (resp.status === 404 && hadEntry) {
        state.documentos = filtered;
        if (!suppressNotify) {
          notify('Documento removido com sucesso.', 'success');
        }
        updateConsultaAgendaCard();
        return true;
      }

      const payload = await resp.json().catch(() => ({}));
      const message = typeof payload?.message === 'string'
        ? payload.message
        : 'Não foi possível remover o documento.';
      throw new Error(message);
    }

    state.documentos = filtered;
    if (!suppressNotify) {
      notify('Documento removido com sucesso.', 'success');
    }
    updateConsultaAgendaCard();
    return true;
  } catch (error) {
    console.error('deleteDocumentoRegistro', error);
    notify(error.message || 'Não foi possível remover o documento.', 'error');
    return false;
  }
}

state.deleteDocumento = deleteDocumentoRegistro;

async function handleSave() {
  if (documentoModal.isLoading || documentoModal.isGenerating) return;
  const doc = getSelectedDocument();
  if (!doc) {
    notify('Selecione um documento salvo para registrar.', 'warning');
    return;
  }

  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) {
    notify('Selecione um tutor e um pet para registrar o documento no atendimento.', 'warning');
    return;
  }

  documentoModal.isGenerating = true;
  updateButtonsState();

  try {
    const { html } = await resolveDocumentContent(doc);
    const finalHtml = typeof html === 'string' ? html : (doc.conteudo || '');
    const recordPayload = prepareDocumentRecordPayload(doc, finalHtml);
    if (!recordPayload) {
      throw new Error('Não foi possível preparar os dados do documento.');
    }

    const payload = {
      ...recordPayload,
      clienteId,
      petId,
    };

    const appointmentId = normalizeId(state.agendaContext?.appointmentId);
    if (appointmentId) {
      payload.appointmentId = appointmentId;
    }

    const resp = await api('/func/vet/documentos-registros', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Não foi possível salvar o documento.';
      throw new Error(message);
    }

    const fallbackRecord = {
      ...recordPayload,
      id: normalizeId(data?.id || data?._id) || `doc-reg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      _id: data?._id,
      createdAt: data?.createdAt || new Date().toISOString(),
      updatedAt: data?.updatedAt || data?.createdAt || new Date().toISOString(),
      clienteId,
      petId,
      appointmentId,
    };

    const saved = upsertDocumentoRegistroInState(data || fallbackRecord);
    if (!saved && fallbackRecord) {
      upsertDocumentoRegistroInState(fallbackRecord);
    }

    notify('Documento adicionado na aba de consultas.', 'success');
    closeDocumentoModal();
    updateConsultaAgendaCard();
  } catch (error) {
    console.error('handleSave', error);
    notify(error.message || 'Não foi possível preparar o documento para salvar.', 'error');
  } finally {
    documentoModal.isGenerating = false;
    updateButtonsState();
  }
}

async function handlePrint() {
  if (documentoModal.isLoading || documentoModal.isGenerating) return;
  const doc = getSelectedDocument();
  if (!doc) {
    notify('Selecione um documento salvo para imprimir.', 'warning');
    return;
  }

  documentoModal.isGenerating = true;
  updateButtonsState();

  try {
    const { html } = await resolveDocumentContent(doc);
    const finalHtml = typeof html === 'string' && html.length ? html : (doc.conteudo || '');
    const success = openDocumentPrintWindow(finalHtml, { title: doc.descricao || 'Documento' });
    if (!success) {
      notify('Não foi possível abrir a impressão. Verifique se o navegador bloqueou pop-ups.', 'error');
    }
  } catch (error) {
    console.error('handlePrint', error);
    notify('Não foi possível preparar o documento para impressão.', 'error');
  } finally {
    documentoModal.isGenerating = false;
    updateButtonsState();
  }
}

export function closeDocumentoModal() {
  if (!documentoModal.overlay) return;
  documentoModal.overlay.classList.add('hidden');
  documentoModal.overlay.setAttribute('aria-hidden', 'true');
  documentoModal.isGenerating = false;
  updateButtonsState();
  if (documentoModal.keydownHandler) {
    document.removeEventListener('keydown', documentoModal.keydownHandler);
    documentoModal.keydownHandler = null;
  }
}

export function openDocumentoModal() {
  if (!ensureTutorAndPetSelected()) return;

  const modal = ensureDocumentoModal();
  modal.overlay.classList.remove('hidden');
  modal.overlay.setAttribute('aria-hidden', 'false');
  try {
    modal.dialog.focus({ preventScroll: true });
  } catch (_) {
    modal.dialog.focus();
  }

  if (!modal.keydownHandler) {
    modal.keydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDocumentoModal();
      }
    };
    document.addEventListener('keydown', modal.keydownHandler);
  }

  loadDocuments({ force: true });
  updateButtonsState();
}
