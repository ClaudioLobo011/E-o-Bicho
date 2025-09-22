import {
  KEYWORD_GROUPS,
  sanitizeDocumentHtml,
  extractPlainText,
  getPreviewText,
  renderPreviewFrameContent,
} from './document-utils.js';
import { confirmWithModal } from '../shared/confirm-modal.js';

const state = {
  documents: [],
  editingId: null,
  isLoading: false,
  isSaving: false,
};

let form;
let descriptionInput;
let editorContainer;
let formTitleEl;
let saveBtn;
let cancelBtn;
let listEl;
let emptyEl;
let loadingEl;
let errorEl;
let countBadge;
let quill = null;
let fallbackTextarea = null;
let isRedirecting = false;
let keywordsContainer;
let keywordButtons = [];
let modeToggle = null;
let modeButtons = [];
let codeTextarea = null;
let editorMode = 'visual';
let previewContainer = null;
let previewFrame = null;
let visualMode = 'editor';
let previewHtml = '';
let previewModeKeywordNoticeShown = false;

function getAuthToken() {
  try {
    const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    return cached?.token || null;
  } catch (err) {
    console.error('Erro ao recuperar token do usuário logado.', err);
    return null;
  }
}

function request(path, options = {}) {
  const token = getAuthToken();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${API_CONFIG.BASE_URL}${path}`, {
    ...options,
    headers,
  });
}

function handleUnauthorized(response) {
  if (response.status === 401 || response.status === 403) {
    if (!isRedirecting) {
      isRedirecting = true;
      showToastMessage('Sua sessão expirou. Faça login novamente.', 'warning');
      setTimeout(() => {
        window.location.replace('/pages/login.html');
      }, 1500);
    }
    return true;
  }
  return false;
}

function showToastMessage(message, type = 'info') {
  const text = String(message || '').trim();
  if (!text) return;
  if (typeof window.showToast === 'function') {
    window.showToast(text, type);
  } else if (typeof window.alert === 'function') {
    window.alert(text);
  } else {
    console.log(text);
  }
}

function showError(message) {
  if (!errorEl) return;
  const text = String(message || '').trim() || 'Ocorreu um erro inesperado.';
  errorEl.textContent = text;
  errorEl.classList.remove('hidden');
}

function clearError() {
  if (!errorEl) return;
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

function setListLoading(value) {
  state.isLoading = !!value;
  if (loadingEl) {
    loadingEl.classList.toggle('hidden', !state.isLoading);
  }
  if (listEl) {
    listEl.classList.toggle('opacity-50', state.isLoading);
    listEl.classList.toggle('pointer-events-none', state.isLoading);
  }
  updateEmptyState();
}

function updateEmptyState() {
  if (!emptyEl) return;
  if (state.isLoading) {
    emptyEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.toggle('hidden', state.documents.length > 0);
}

function updateCount() {
  if (!countBadge) return;
  countBadge.textContent = String(state.documents.length);
}

function normalizeIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeUserRef(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id ? { id, nome: '', email: '' } : null;
  }
  if (typeof raw === 'object') {
    const id = String(raw.id || raw._id || '').trim();
    if (!id) return null;
    const nome = typeof raw.nome === 'string' ? raw.nome.trim() : '';
    const email = typeof raw.email === 'string' ? raw.email.trim() : '';
    return { id, nome, email };
  }
  return null;
}

function normalizeDocument(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw._id || '').trim();
  if (!id) return null;
  const descricao = typeof raw.descricao === 'string' ? raw.descricao.trim() : '';
  const conteudo = typeof raw.conteudo === 'string' ? raw.conteudo : '';
  const createdAt = normalizeIso(raw.createdAt);
  const updatedAt = normalizeIso(raw.updatedAt) || createdAt;
  const createdBy = normalizeUserRef(raw.createdBy);
  const updatedBy = normalizeUserRef(raw.updatedBy);
  return { id, descricao, conteudo, createdAt, updatedAt, createdBy, updatedBy };
}

function getDocumentTime(doc) {
  const updated = doc?.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
  if (Number.isFinite(updated) && updated > 0) {
    return updated;
  }
  const created = doc?.createdAt ? new Date(doc.createdAt).getTime() : 0;
  return Number.isFinite(created) ? created : 0;
}

function sortDocuments() {
  state.documents.sort((a, b) => getDocumentTime(b) - getDocumentTime(a));
}

function formatUserDisplay(user) {
  if (!user) return '';
  return (user.nome || user.email || '').trim();
}

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = date.toLocaleDateString('pt-BR');
  const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} às ${timePart}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCodeEditorValue(html) {
  if (!html) return '';
  const value = String(html)
    .replace(/\r?\n/g, '\n')
    .replace(/></g, '>\n<')
    .replace(/&nbsp;/g, ' ');
  return value.replace(/\n{3,}/g, '\n\n');
}

function setCodeEditorContent(html) {
  if (!codeTextarea) return;
  const value = typeof html === 'string' ? html : '';
  codeTextarea.value = value ? formatCodeEditorValue(value) : '';
}

function getCodeEditorValue() {
  return codeTextarea ? codeTextarea.value || '' : '';
}

function syncCodeEditorFromVisual() {
  if (!codeTextarea) return;
  setCodeEditorContent(getVisualEditorHtml());
}

function updateModeToggleButtons() {
  if (!modeButtons.length) return;
  modeButtons.forEach((button) => {
    if (!button) return;
    const mode = button.dataset.mode === 'code' ? 'code' : 'visual';
    const isActive = mode === editorMode;
    button.classList.toggle('vet-doc-mode-btn-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setModeToggleDisabled(disabled) {
  if (!modeButtons.length) return;
  modeButtons.forEach((button) => {
    if (!button) return;
    button.disabled = !!disabled;
  });
}

function updateEditorModeVisibility() {
  const showCode = editorMode === 'code';
  const showPreview = editorMode === 'visual' && visualMode === 'preview';
  const showEditor = editorMode === 'visual' && visualMode !== 'preview';

  if (editorContainer) {
    editorContainer.classList.toggle('hidden', !showEditor);
  }
  if (previewContainer) {
    previewContainer.classList.toggle('hidden', !showPreview);
  }
  if (codeTextarea) {
    codeTextarea.classList.toggle('hidden', !showCode);
  }
}

function focusCurrentEditor() {
  if (state.isSaving) return;
  if (editorMode === 'code') {
    if (codeTextarea && !codeTextarea.disabled) {
      const length = codeTextarea.value.length;
      codeTextarea.focus();
      try {
        codeTextarea.setSelectionRange(length, length);
      } catch (_) {
        /* ignore selection errors */
      }
    }
    return;
  }
  if (editorMode === 'visual' && visualMode === 'preview') {
    if (previewContainer) {
      if (!previewContainer.hasAttribute('tabindex')) {
        previewContainer.setAttribute('tabindex', '-1');
      }
      try {
        previewContainer.focus({ preventScroll: true });
      } catch (_) {
        previewContainer.focus();
      }
    }
    return;
  }
  if (quill) {
    quill.focus();
    return;
  }
  if (fallbackTextarea && !fallbackTextarea.disabled) {
    fallbackTextarea.focus();
    try {
      const length = fallbackTextarea.value.length;
      fallbackTextarea.setSelectionRange(length, length);
    } catch (_) {
      /* ignore selection errors */
    }
  }
}

function setEditorMode(mode, { focus = true, sync = true } = {}) {
  const target = mode === 'code' ? 'code' : 'visual';
  if (target === editorMode) {
    if (target === 'code' && sync) {
      syncCodeEditorFromVisual();
    }
    updateEditorModeVisibility();
    updateModeToggleButtons();
    setEditorDisabled(state.isSaving);
    if (focus) focusCurrentEditor();
    return;
  }

  if (target === 'code' && sync) {
    syncCodeEditorFromVisual();
  }

  if (target === 'visual' && sync) {
    const codeValue = getCodeEditorValue();
    applyVisualEditorContent(codeValue);
    syncCodeEditorFromVisual();
  }

  editorMode = target;
  updateEditorModeVisibility();
  updateModeToggleButtons();
  setEditorDisabled(state.isSaving);
  if (focus) focusCurrentEditor();
}

function initEditorModeToggle() {
  if (!modeToggle) return;
  modeButtons = Array.from(modeToggle.querySelectorAll('[data-mode]')).filter(Boolean);
  modeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (state.isSaving) return;
      const targetMode = button.dataset.mode === 'code' ? 'code' : 'visual';
      setEditorMode(targetMode);
    });
  });
  updateModeToggleButtons();
  updateEditorModeVisibility();
}

function insertIntoCodeEditor(text) {
  if (!codeTextarea) return;
  const textarea = codeTextarea;
  const value = textarea.value || '';
  const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : value.length;
  const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const scroll = textarea.scrollTop;
  textarea.value = `${before}${text}${after}`;
  const cursor = start + text.length;
  try {
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  } catch (_) {
    /* ignore selection errors */
  }
  textarea.scrollTop = scroll;
}

function insertKeyword(token) {
  const text = typeof token === 'string' ? token : String(token || '');
  if (!text || state.isSaving) return;

  if (visualMode === 'preview' && codeTextarea) {
    if (editorMode !== 'code') {
      setEditorMode('code');
      if (!previewModeKeywordNoticeShown) {
        showToastMessage(
          'Este documento possui um layout avançado. Inserimos a palavra-chave diretamente no modo Código.',
          'info'
        );
        previewModeKeywordNoticeShown = true;
      }
    }
    insertIntoCodeEditor(text);
    return;
  }

  if (editorMode === 'code' && codeTextarea) {
    insertIntoCodeEditor(text);
    return;
  }

  if (quill) {
    quill.focus();
    let range = quill.getSelection(true);
    if (!range) {
      const length = Math.max(quill.getLength(), 0);
      range = { index: length, length: 0 };
    }
    if (range.length > 0) {
      quill.deleteText(range.index, range.length, 'user');
    }
    quill.insertText(range.index, text, 'user');
    quill.setSelection(range.index + text.length, 0, 'silent');
    return;
  }

  if (fallbackTextarea) {
    const value = fallbackTextarea.value || '';
    const start = typeof fallbackTextarea.selectionStart === 'number'
      ? fallbackTextarea.selectionStart
      : value.length;
    const end = typeof fallbackTextarea.selectionEnd === 'number'
      ? fallbackTextarea.selectionEnd
      : start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    fallbackTextarea.value = `${before}${text}${after}`;
    const cursor = start + text.length;
    fallbackTextarea.focus();
    fallbackTextarea.setSelectionRange(cursor, cursor);
  }
}

function setKeywordsDisabled(disabled) {
  if (!keywordButtons.length) return;
  keywordButtons.forEach((button) => {
    if (!button) return;
    button.disabled = !!disabled;
    button.classList.toggle('opacity-60', !!disabled);
    button.classList.toggle('cursor-not-allowed', !!disabled);
  });
}

function renderKeywords() {
  if (!keywordsContainer) return;
  keywordsContainer.innerHTML = '';
  keywordButtons = [];

  KEYWORD_GROUPS.forEach((group) => {
    if (!group || !Array.isArray(group.items) || !group.items.length) return;

    const section = document.createElement('div');
    section.className = 'space-y-2';

    const heading = document.createElement('h3');
    heading.className = 'text-xs font-semibold uppercase tracking-wide text-primary';
    heading.textContent = group.title;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'grid gap-2 sm:grid-cols-2';

    group.items.forEach((item) => {
      const token = typeof item?.token === 'string' ? item.token.trim() : '';
      if (!token) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.token = token;
      button.className = 'flex w-full flex-col rounded-lg border border-primary/30 bg-white px-3 py-2 text-left text-sm text-primary shadow-sm transition hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40';
      const description = typeof item.description === 'string' ? item.description : '';
      button.innerHTML = `
        <span class="font-mono text-xs font-semibold tracking-tight text-primary/90">${escapeHtml(token)}</span>
        ${description ? `<span class="mt-1 text-xs text-slate-500">${escapeHtml(description)}</span>` : ''}
      `;
      button.addEventListener('click', () => insertKeyword(token));
      keywordButtons.push(button);
      list.appendChild(button);
    });

    if (list.children.length > 0) {
      section.appendChild(list);
      keywordsContainer.appendChild(section);
    }
  });

  setKeywordsDisabled(state.isSaving);
}

function shouldRenderAsPreview(html) {
  if (!html || typeof html !== 'string') return false;
  const value = html.trim();
  if (!value) return false;
  if (/<style[\s>]/i.test(value)) return true;
  if (/(class|id|style)=/i.test(value)) return true;
  if (/<(table|section|article|aside|header|footer|nav|figure|figcaption|canvas|svg|iframe|video|audio|form|input|textarea|button|select|option|label|fieldset)/i.test(value)) {
    return true;
  }
  return false;
}

function initEditor() {
  if (!editorContainer) return;
  if (window.Quill) {
    quill = new window.Quill(editorContainer, {
      theme: 'snow',
      placeholder: 'Escreva o conteúdo do documento...',
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ align: [] }, { indent: '-1' }, { indent: '+1' }],
          ['blockquote', 'code-block'],
          ['link'],
          ['clean'],
        ],
      },
    });
    return;
  }
  editorContainer.innerHTML = '';
  const textarea = document.createElement('textarea');
  textarea.id = 'vet-doc-editor-fallback';
  textarea.className = 'vet-doc-textarea';
  textarea.placeholder = 'Editor avançado indisponível. Utilize este campo para redigir o documento.';
  editorContainer.appendChild(textarea);
  fallbackTextarea = textarea;
  showToastMessage('Editor avançado não pôde ser carregado. Utilizando editor simples.', 'warning');
}

function applyVisualEditorContent(html) {
  const value = typeof html === 'string' ? html : '';
  const trimmed = value.trim();
  const canPreview = shouldRenderAsPreview(value) && !!previewFrame;

  if (!trimmed) {
    visualMode = 'editor';
    previewHtml = '';
    previewModeKeywordNoticeShown = false;
    if (quill) {
      quill.setText('', 'silent');
    }
    if (fallbackTextarea) {
      fallbackTextarea.value = '';
    }
    if (previewFrame) {
      renderPreviewFrameContent(previewFrame, '', { minHeight: 320 });
    }
    return;
  }

  if (canPreview) {
    visualMode = 'preview';
    previewModeKeywordNoticeShown = false;
    previewHtml = renderPreviewFrameContent(previewFrame, value, { minHeight: 320 });
    if (quill) {
      quill.setText('', 'silent');
    }
    if (fallbackTextarea) {
      fallbackTextarea.value = extractPlainText(previewHtml);
      fallbackTextarea.disabled = true;
    }
    return;
  }

  visualMode = 'editor';
  previewHtml = '';
  previewModeKeywordNoticeShown = false;
  if (quill) {
    const delta = quill.clipboard.convert(value);
    quill.setContents(delta, 'silent');
  } else if (fallbackTextarea) {
    fallbackTextarea.value = extractPlainText(value);
  }
  if (previewFrame) {
    renderPreviewFrameContent(previewFrame, '', { minHeight: 320 });
  }
}

function setEditorContent(html) {
  applyVisualEditorContent(html);
  syncCodeEditorFromVisual();
  updateEditorModeVisibility();
  setEditorDisabled(state.isSaving);
}

function clearEditor() {
  setEditorContent('');
}

function getVisualEditorHtml() {
  if (visualMode === 'preview') {
    return previewHtml || '';
  }
  if (quill) {
    return quill.root.innerHTML;
  }
  if (fallbackTextarea) {
    const value = fallbackTextarea.value || '';
    if (!value.trim()) return '';
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
  }
  return '';
}

function getEditorHtml() {
  if (editorMode === 'code' && codeTextarea) {
    return getCodeEditorValue();
  }
  return getVisualEditorHtml();
}

function getEditorPlainText() {
  if (editorMode === 'code' && codeTextarea) {
    return (codeTextarea.value || '').trim();
  }
  if (visualMode === 'preview') {
    return extractPlainText(previewHtml).trim();
  }
  if (quill) {
    return quill.getText().trim();
  }
  if (fallbackTextarea) {
    return (fallbackTextarea.value || '').trim();
  }
  return '';
}

function setEditorDisabled(disabled) {
  if (quill) {
    const shouldEnable = !disabled && editorMode === 'visual' && visualMode !== 'preview';
    quill.enable(shouldEnable);
  }
  if (fallbackTextarea) {
    fallbackTextarea.disabled = !!disabled || editorMode === 'code' || visualMode === 'preview';
  }
  if (codeTextarea) {
    codeTextarea.disabled = !!disabled || editorMode !== 'code';
  }
  if (previewContainer) {
    previewContainer.classList.toggle('opacity-60', !!disabled);
    previewContainer.classList.toggle('pointer-events-none', !!disabled);
  }
  setModeToggleDisabled(disabled);
}

function updateSaveButton() {
  if (!saveBtn) return;
  if (state.isSaving) {
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>' + (state.editingId ? 'Atualizando...' : 'Salvando...') + '</span>';
  } else {
    saveBtn.innerHTML = '<i class="fas fa-save"></i><span>' + (state.editingId ? 'Atualizar documento' : 'Salvar documento') + '</span>';
  }
}

function updateFormMode() {
  if (formTitleEl) {
    formTitleEl.textContent = state.editingId ? 'Editar documento' : 'Novo documento';
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !state.editingId);
  }
  if (form) {
    form.dataset.mode = state.editingId ? 'edit' : 'create';
  }
  updateSaveButton();
}

function setFormBusy(busy) {
  state.isSaving = !!busy;
  updateSaveButton();
  if (saveBtn) {
    saveBtn.disabled = state.isSaving;
    saveBtn.classList.toggle('opacity-60', state.isSaving);
    saveBtn.classList.toggle('cursor-not-allowed', state.isSaving);
  }
  if (cancelBtn) {
    cancelBtn.disabled = state.isSaving;
    cancelBtn.classList.toggle('opacity-60', state.isSaving);
    cancelBtn.classList.toggle('cursor-not-allowed', state.isSaving);
  }
  if (descriptionInput) {
    descriptionInput.disabled = state.isSaving;
  }
  setEditorDisabled(state.isSaving);
  setKeywordsDisabled(state.isSaving);
}

function resetForm() {
  state.editingId = null;
  if (form) form.reset();
  clearEditor();
  updateFormMode();
}

function setButtonBusy(button, busy) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    button.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
    button.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

function createDocumentCard(doc) {
  if (!doc) return null;
  const article = document.createElement('article');
  article.className = 'vet-doc-card rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300';
  article.dataset.docId = doc.id;
  if (state.editingId === doc.id) {
    article.classList.add('ring-2', 'ring-primary/60', 'bg-primary/5');
  }

  const preview = getPreviewText(doc.conteudo);
  const metaParts = [];
  const author = formatUserDisplay(doc.createdBy);
  if (author) metaParts.push(`Por ${author}`);
  const createdText = formatDateTime(doc.createdAt);
  if (createdText) metaParts.push(`Criado em ${createdText}`);
  const updatedText = formatDateTime(doc.updatedAt);
  if (updatedText && updatedText !== createdText) {
    metaParts.push(`Atualizado em ${updatedText}`);
  }
  const metaHtml = metaParts.length ? `<p class="mt-1 text-xs text-gray-500">${escapeHtml(metaParts.join(' · '))}</p>` : '';
  const previewHtml = preview ? `<p class="mt-3 text-sm text-gray-600 leading-relaxed">${escapeHtml(preview)}</p>` : '';
  const detailsHtml = doc.conteudo
    ? `<details class="mt-3">
         <summary class="flex items-center gap-2 text-sm font-medium text-primary">
           <i class="fas fa-chevron-down vet-doc-summary-icon transition-transform duration-200"></i>
           <span>Visualizar conteúdo</span>
         </summary>
         <div class="mt-3 rounded-lg border border-gray-100 bg-gray-50 vet-doc-body" data-doc-body>
           <div class="vet-doc-preview-bar">
             <i class="fas fa-eye"></i>
             <span>Pré-visualização do documento</span>
           </div>
           <iframe class="vet-doc-preview-embed" data-doc-preview title="Pré-visualização do documento" loading="lazy"></iframe>
         </div>
       </details>`
    : '';

  article.innerHTML = `
    <div class="flex items-start gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-start gap-3">
          <div class="hidden h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary sm:grid">
            <i class="fas fa-file-alt"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="break-words text-base font-semibold text-gray-800">${escapeHtml(doc.descricao || 'Documento')}</h3>
            ${metaHtml}
          </div>
        </div>
        ${previewHtml}
        ${detailsHtml}
      </div>
      <div class="flex shrink-0 flex-col items-end gap-2">
        <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" data-action="edit">
          <i class="fas fa-pen"></i>
          <span>Editar</span>
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" data-action="delete">
          <i class="fas fa-trash"></i>
          <span>Excluir</span>
        </button>
      </div>
    </div>
  `;

  const previewFrameEl = article.querySelector('[data-doc-preview]');
  if (previewFrameEl) {
    renderPreviewFrameContent(previewFrameEl, doc.conteudo || '', { minHeight: 280, padding: 16, background: '#f8fafc' });
  }

  const editBtn = article.querySelector('[data-action="edit"]');
  if (editBtn) {
    editBtn.addEventListener('click', () => startEditing(doc.id));
  }

  const deleteBtn = article.querySelector('[data-action="delete"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => handleDelete(doc.id, deleteBtn));
  }

  return article;
}

function renderList() {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.documents.length) {
    updateEmptyState();
    return;
  }
  state.documents.forEach((doc) => {
    const card = createDocumentCard(doc);
    if (card) listEl.appendChild(card);
  });
  updateEmptyState();
}

function confirmAction(title, message, confirmText = 'Excluir') {
  return confirmWithModal({
    title: title || 'Confirmação',
    message: message || 'Deseja prosseguir?',
    confirmText,
    cancelText: 'Cancelar',
  });
}

async function handleDelete(id, button) {
  const doc = state.documents.find((item) => item.id === id);
  if (!doc) return;
  const confirmed = await confirmAction(
    'Excluir documento',
    `Tem certeza de que deseja excluir "${doc.descricao || 'documento'}"?`,
    'Excluir'
  );
  if (!confirmed) return;

  clearError();
  setButtonBusy(button, true);
  try {
    const resp = await request(`/func/vet/documentos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (handleUnauthorized(resp)) return;
    if (!resp.ok) {
      const payload = await resp.json().catch(() => null);
      throw new Error(payload?.message || 'Erro ao remover documento.');
    }
    state.documents = state.documents.filter((item) => item.id !== id);
    if (state.editingId === id) {
      resetForm();
    }
    renderList();
    updateCount();
    updateEmptyState();
    showToastMessage('Documento removido com sucesso.', 'success');
  } catch (error) {
    console.error('Excluir documento', error);
    showToastMessage(error.message || 'Erro ao remover documento.', 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

function startEditing(id) {
  const doc = state.documents.find((item) => item.id === id);
  if (!doc) return;
  state.editingId = id;
  if (descriptionInput) {
    descriptionInput.value = doc.descricao || '';
  }
  setEditorContent(doc.conteudo || '');
  updateFormMode();
  renderList();
  clearError();
  if (descriptionInput) {
    try {
      descriptionInput.focus({ preventScroll: true });
    } catch (_) {
      descriptionInput.focus();
    }
  }
  if (form) {
    const top = form.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 100), behavior: 'smooth' });
  }
}

async function onSubmit(event) {
  event.preventDefault();
  if (state.isSaving) return;

  const descricao = (descriptionInput?.value || '').trim();
  if (!descricao) {
    showToastMessage('Informe a descrição do documento.', 'warning');
    if (descriptionInput) descriptionInput.focus();
    return;
  }

  const plainContent = getEditorPlainText();
  if (!plainContent) {
    showToastMessage('Escreva o conteúdo do documento antes de salvar.', 'warning');
    return;
  }

  const conteudoHtml = getEditorHtml();
  const editingId = state.editingId;
  const wasEditing = !!editingId;
  const payload = { descricao, conteudo: conteudoHtml };

  clearError();
  setFormBusy(true);
  try {
    const endpoint = wasEditing
      ? `/func/vet/documentos/${encodeURIComponent(editingId)}`
      : '/func/vet/documentos';
    const method = wasEditing ? 'PUT' : 'POST';
    const resp = await request(endpoint, {
      method,
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(resp)) return;
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.message || 'Erro ao salvar documento.');
    }
    const doc = normalizeDocument(data);
    if (!doc) {
      throw new Error('Resposta inesperada do servidor.');
    }
    const existingIndex = state.documents.findIndex((item) => item.id === doc.id);
    if (existingIndex >= 0) {
      state.documents.splice(existingIndex, 1, doc);
    } else {
      state.documents.unshift(doc);
    }
    sortDocuments();
    resetForm();
    renderList();
    updateCount();
    updateEmptyState();
    showToastMessage(wasEditing ? 'Documento atualizado com sucesso.' : 'Documento salvo com sucesso.', 'success');
  } catch (error) {
    console.error('Salvar documento', error);
    showToastMessage(error.message || 'Erro ao salvar documento.', 'error');
  } finally {
    setFormBusy(false);
  }
}

async function loadDocuments() {
  clearError();
  setListLoading(true);
  try {
    const resp = await request('/func/vet/documentos');
    if (handleUnauthorized(resp)) return;
    const payload = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(payload?.message || 'Erro ao listar documentos.');
    }
    const docs = Array.isArray(payload) ? payload : [];
    state.documents = docs.map(normalizeDocument).filter(Boolean);
    sortDocuments();
    renderList();
    updateCount();
    updateEmptyState();
  } catch (error) {
    console.error('Listar documentos', error);
    state.documents = [];
    renderList();
    updateCount();
    updateEmptyState();
    showError(error.message || 'Erro ao carregar documentos.');
  } finally {
    setListLoading(false);
  }
}

function init() {
  form = document.getElementById('vet-doc-form');
  descriptionInput = document.getElementById('vet-doc-descricao');
  editorContainer = document.getElementById('vet-doc-editor');
  formTitleEl = document.getElementById('vet-doc-form-title');
  saveBtn = document.getElementById('vet-doc-save');
  cancelBtn = document.getElementById('vet-doc-cancel-edit');
  listEl = document.getElementById('vet-doc-list');
  emptyEl = document.getElementById('vet-doc-empty');
  loadingEl = document.getElementById('vet-doc-loading');
  errorEl = document.getElementById('vet-doc-error');
  countBadge = document.getElementById('vet-doc-count');
  keywordsContainer = document.getElementById('vet-doc-keywords');
  modeToggle = document.getElementById('vet-doc-mode-toggle');
  codeTextarea = document.getElementById('vet-doc-code');
  previewContainer = document.getElementById('vet-doc-preview');
  previewFrame = document.getElementById('vet-doc-preview-frame');
  if (previewFrame) {
    previewFrame.setAttribute('loading', 'lazy');
  }

  if (!form || !descriptionInput || !editorContainer || !listEl) {
    console.error('Elementos essenciais não encontrados na página de documentos.');
    return;
  }

  updateFormMode();
  updateEmptyState();
  initEditor();
  syncCodeEditorFromVisual();
  initEditorModeToggle();
  setEditorMode(editorMode, { focus: false, sync: true });
  setEditorDisabled(state.isSaving);
  renderKeywords();

  form.addEventListener('submit', onSubmit);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      resetForm();
      renderList();
      updateEmptyState();
    });
  }

  loadDocuments();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
