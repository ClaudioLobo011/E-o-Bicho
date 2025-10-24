(function () {
  const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const BARCODE_REGEX = /\d{8,14}/g;

  const createInitialState = () => ({
    files: [],
    products: new Map(),
    unmatched: [],
    barcodeCache: new Map(),
    notFoundBarcodes: new Set(),
    errorBarcodes: new Set(),
    stats: {
      imagesTotal: 0,
      productsTotal: 0,
      uploaded: 0,
      failed: 0,
    },
    status: {
      type: '',
      message: '',
    },
    uploading: false,
  });

  let state = createInitialState();
  let root = null;
  const refs = {};
  let analysisRunId = 0;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  function setup() {
    root = document.getElementById('importar-imagens-root');
    if (!root) {
      return;
    }

    renderLayout();
    cacheRefs();
    attachEvents();
    updateEntireUI();
  }

  function renderLayout() {
    root.innerHTML = `
      <section class="bg-white p-6 rounded-lg shadow space-y-6">
        <header class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-800">Importar Imagens de Produtos</h1>
            <p class="text-gray-600 mt-1 max-w-3xl">
              Escolha uma pasta com imagens nomeadas com códigos de barras para que o sistema identifique os produtos e envie as fotos automaticamente.
            </p>
          </div>
        </header>

        <div class="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
          <label for="image-folder-input" class="block text-sm font-medium text-gray-700">Selecionar pasta com imagens</label>
          <div class="flex flex-col sm:flex-row sm:items-center sm:gap-3">
            <input type="file" id="image-folder-input" data-folder-input webkitdirectory multiple class="text-sm text-gray-600" />
            <button type="button" data-upload-button class="bg-primary hover:bg-secondary text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
              <span class="inline-flex items-center gap-2">
                <i class="fas fa-cloud-upload-alt"></i>
                <span>Iniciar Upload</span>
              </span>
            </button>
          </div>
          <p class="text-xs text-gray-500">
            Arquivos aceitos: JPG, JPEG, PNG, WEBP, GIF e BMP. Utilize nomes que contenham códigos de barras para que o produto seja identificado automaticamente.
          </p>
        </div>

        <div data-status class="hidden rounded-lg border px-4 py-3 text-sm"></div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p class="text-xs uppercase text-gray-500">Produtos encontrados</p>
            <p data-summary-products class="mt-1 text-2xl font-semibold text-gray-800">0</p>
          </div>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p class="text-xs uppercase text-gray-500">Imagens reconhecidas</p>
            <p data-summary-images class="mt-1 text-2xl font-semibold text-gray-800">0</p>
          </div>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p class="text-xs uppercase text-gray-500">Uploads concluídos</p>
            <p data-summary-uploaded class="mt-1 text-2xl font-semibold text-gray-800">0</p>
          </div>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p class="text-xs uppercase text-gray-500">Falhas</p>
            <p data-summary-failed class="mt-1 text-2xl font-semibold text-gray-800">0</p>
          </div>
        </div>

        <section class="space-y-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">Resumo por produto</h2>
            <p class="text-sm text-gray-500">Veja como cada imagem foi relacionada e acompanhe o status durante o upload.</p>
          </div>
          <div data-product-matches class="space-y-4"></div>
        </section>

        <section data-unmatched-section class="hidden space-y-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-800">Imagens não vinculadas</h2>
            <p class="text-sm text-gray-500">Revise os nomes dos arquivos para incluir códigos de barras válidos ou cadastre os produtos faltantes.</p>
          </div>
          <div data-unmatched-list class="space-y-2"></div>
        </section>
      </section>
    `;
  }

  function cacheRefs() {
    refs.folderInput = root.querySelector('[data-folder-input]');
    refs.uploadButton = root.querySelector('[data-upload-button]');
    refs.statusMessage = root.querySelector('[data-status]');
    refs.summaryProducts = root.querySelector('[data-summary-products]');
    refs.summaryImages = root.querySelector('[data-summary-images]');
    refs.summaryUploaded = root.querySelector('[data-summary-uploaded]');
    refs.summaryFailed = root.querySelector('[data-summary-failed]');
    refs.productMatches = root.querySelector('[data-product-matches]');
    refs.unmatchedSection = root.querySelector('[data-unmatched-section]');
    refs.unmatchedList = root.querySelector('[data-unmatched-list]');
  }

  function attachEvents() {
    if (refs.folderInput) {
      refs.folderInput.addEventListener('change', handleFolderSelection);
    }

    if (refs.uploadButton) {
      refs.uploadButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleUpload().catch((error) => {
          console.error('Erro inesperado durante o upload de imagens:', error);
          state.uploading = false;
          updateControlStates();
          setStatus('Não foi possível concluir o upload. Verifique os erros e tente novamente.', 'error');
        });
      });
    }
  }

  function updateEntireUI() {
    updateSummaryIndicators();
    renderProductMatches();
    renderUnmatchedList();
    updateStatusMessage();
    updateControlStates();
  }

  function updateSummaryIndicators() {
    if (refs.summaryProducts) {
      refs.summaryProducts.textContent = state.stats.productsTotal;
    }
    if (refs.summaryImages) {
      refs.summaryImages.textContent = state.stats.imagesTotal;
    }
    if (refs.summaryUploaded) {
      refs.summaryUploaded.textContent = state.stats.uploaded;
    }
    if (refs.summaryFailed) {
      refs.summaryFailed.textContent = state.stats.failed;
    }
  }

  function updateStatusMessage() {
    if (!refs.statusMessage) {
      return;
    }

    if (!state.status.message) {
      refs.statusMessage.textContent = '';
      refs.statusMessage.className = 'hidden rounded-lg border px-4 py-3 text-sm';
      return;
    }

    const variants = {
      info: 'border-blue-200 bg-blue-50 text-blue-800',
      success: 'border-green-200 bg-green-50 text-green-800',
      warning: 'border-amber-200 bg-amber-50 text-amber-800',
      error: 'border-red-200 bg-red-50 text-red-800',
    };

    const variantClass = variants[state.status.type] || variants.info;
    refs.statusMessage.textContent = state.status.message;
    refs.statusMessage.className = `rounded-lg border px-4 py-3 text-sm ${variantClass}`;
  }

  function updateControlStates() {
    const hasProducts = state.products.size > 0;
    if (refs.uploadButton) {
      refs.uploadButton.disabled = !hasProducts || state.uploading;
      refs.uploadButton.setAttribute('aria-busy', state.uploading ? 'true' : 'false');
      refs.uploadButton.innerHTML = state.uploading
        ? '<span class="inline-flex items-center gap-2"><i class="fas fa-spinner fa-spin"></i><span>Enviando...</span></span>'
        : '<span class="inline-flex items-center gap-2"><i class="fas fa-cloud-upload-alt"></i><span>Iniciar Upload</span></span>';
    }

    if (refs.folderInput) {
      refs.folderInput.disabled = state.uploading;
    }
  }

  function renderProductMatches() {
    if (!refs.productMatches) {
      return;
    }

    if (!state.products.size) {
      refs.productMatches.innerHTML = `
        <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Nenhum produto associado até o momento.
        </div>
      `;
      return;
    }

    const fragments = [];
    state.products.forEach((group, productId) => {
      const productName = escapeHtml(String(group.product?.nome || group.product?.name || 'Produto sem nome'));
      const productCode = escapeHtml(String(group.product?.cod || group.product?.codigo || group.product?.codigoInterno || '—'));
      const barcode = escapeHtml(String(group.product?.codbarras || group.product?.codigoBarras || '—'));
      const matchesMarkup = group.barcodes.size
        ? Array.from(group.barcodes)
            .map((code) => `<code class="text-[11px] bg-gray-100 px-1 py-0.5 rounded">${escapeHtml(String(code))}</code>`)
            .join(' ')
        : '<span class="text-gray-300">—</span>';

      const filesMarkup = group.files
        .map((fileEntry, index) => {
          const fileName = escapeHtml(String(fileEntry.file?.name || fileEntry.relativePath || 'Arquivo sem nome'));
          const sequenceLabel = fileEntry.sequence
            ? `<span class="text-xs text-gray-400">Sequência: ${escapeHtml(String(fileEntry.sequence))}</span>`
            : '';
          const barcodesMarkup = fileEntry.barcodes && fileEntry.barcodes.length
            ? fileEntry.barcodes
                .map((code) => `<code class="text-[11px] bg-gray-100 px-1 py-0.5 rounded">${escapeHtml(String(code))}</code>`)
                .join(' ')
            : '<span class="text-gray-300">—</span>';
          const status = translateStatus(fileEntry.status || 'pending');
          const statusClass = statusToClass(fileEntry.status || 'pending');
          const errorText = fileEntry.error ? escapeHtml(String(fileEntry.error)) : '';
          const errorClass = fileEntry.error ? 'text-xs text-red-500' : 'text-xs text-red-500 hidden';

          return `
            <li class="rounded border border-gray-200 bg-white px-3 py-2 text-sm flex flex-col gap-1" data-product-id="${group.safeId}" data-file-index="${index}">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-medium text-gray-700 truncate" title="${fileName}">${fileName}</span>
                ${sequenceLabel}
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span class="text-gray-500">Status: <span class="font-semibold ${statusClass}" data-status>${status}</span></span>
                <span class="text-gray-400">Códigos detectados: ${barcodesMarkup}</span>
              </div>
              <p class="${errorClass}" data-error>${errorText}</p>
            </li>
          `;
        })
        .join('');

      fragments.push(`
        <article class="rounded-lg border border-gray-200 p-4 shadow-sm">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 class="text-base font-semibold text-gray-800">${productName}</h3>
              <p class="text-sm text-gray-500">Cód.: <span class="font-medium text-gray-700">${productCode}</span> • Barras: <span class="font-medium text-gray-700">${barcode}</span></p>
              <p class="text-xs text-gray-400">Correspondências: ${matchesMarkup}</p>
            </div>
          </div>
          <ul class="mt-3 space-y-2">
            ${filesMarkup}
          </ul>
        </article>
      `);
    });

    refs.productMatches.innerHTML = fragments.join('');
  }

  function renderUnmatchedList() {
    if (!refs.unmatchedSection || !refs.unmatchedList) {
      return;
    }

    if (!state.unmatched.length) {
      refs.unmatchedSection.classList.add('hidden');
      refs.unmatchedList.innerHTML = '';
      return;
    }

    refs.unmatchedSection.classList.remove('hidden');
    const fragments = state.unmatched.map((entry) => {
      const fileName = escapeHtml(String(entry.file?.name || entry.relativePath || 'Arquivo sem nome'));
      const hasBarcodeErrors = entry.barcodesTried.some((code) => state.errorBarcodes.has(code));
      let reason;
      if (!entry.barcodesTried.length) {
        reason = 'Nenhum código de barras foi identificado no nome do arquivo.';
      } else if (hasBarcodeErrors) {
        reason = 'Não foi possível consultar alguns códigos de barras. Tente novamente mais tarde.';
      } else {
        reason = 'Nenhum produto encontrado com os códigos identificados.';
      }

      const codesMarkup = entry.barcodesTried.length
        ? `<div class="text-xs mt-1 text-amber-700">Códigos identificados: ${entry.barcodesTried
            .map((code) => `<code class="bg-amber-100 px-1 py-0.5 rounded">${escapeHtml(String(code))}</code>`)
            .join(' ')}</div>`
        : '';

      return `
        <div class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div class="font-medium">${fileName}</div>
          <div class="text-xs">${escapeHtml(reason)}</div>
          ${codesMarkup}
        </div>
      `;
    });

    refs.unmatchedList.innerHTML = fragments.join('');
  }

  async function handleFolderSelection(event) {
    const runId = ++analysisRunId;
    const files = Array.from(event.target?.files || []);

    state = createInitialState();
    updateEntireUI();

    if (!files.length) {
      setStatus('Nenhum arquivo foi selecionado.', 'warning');
      updateControlStates();
      return;
    }

    const imageFiles = files.filter(isImageFile);
    if (!imageFiles.length) {
      setStatus('Os arquivos selecionados não possuem extensões de imagem suportadas.', 'warning');
      updateControlStates();
      return;
    }

    state.stats.imagesTotal = imageFiles.length;
    updateSummaryIndicators();

    const allBarcodes = new Set();
    state.files = imageFiles.map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const barcodes = extractBarcodes(relativePath);
      barcodes.forEach((code) => allBarcodes.add(code));
      return {
        file,
        relativePath,
        barcodes,
        sequence: extractSequence(relativePath),
      };
    });

    if (!allBarcodes.size) {
      setStatus('Nenhum código de barras foi identificado nos nomes dos arquivos. Ajuste os nomes e tente novamente.', 'warning');
      renderProductMatches();
      renderUnmatchedList();
      updateControlStates();
      return;
    }

    setStatus('Analisando nomes dos arquivos e procurando produtos...', 'info');
    updateStatusMessage();
    updateControlStates();

    try {
      await resolveBarcodes(Array.from(allBarcodes), runId);
      if (runId !== analysisRunId) {
        return;
      }

      associateFilesToProducts();
      if (runId !== analysisRunId) {
        return;
      }

      renderProductMatches();
      renderUnmatchedList();
      updateSummaryIndicators();

      const warnings = [];
      if (state.notFoundBarcodes.size) {
        warnings.push(`${state.notFoundBarcodes.size} código(s) sem produto correspondente.`);
      }
      if (state.errorBarcodes.size) {
        warnings.push(`${state.errorBarcodes.size} código(s) não puderam ser consultados.`);
      }

      if (!state.products.size) {
        if (warnings.length) {
          setStatus(`Nenhum produto foi associado. ${warnings.join(' ')}`, 'warning');
        } else {
          setStatus('Nenhum produto foi associado às imagens selecionadas.', 'warning');
        }
        updateControlStates();
        return;
      }

      if (warnings.length) {
        setStatus(`Análise concluída com avisos. ${warnings.join(' ')}`, 'warning');
      } else {
        setStatus('Análise concluída. Revise os agrupamentos e inicie o upload quando estiver pronto.', 'success');
      }
    } catch (error) {
      if (runId !== analysisRunId) {
        return;
      }
      console.error('Erro ao analisar códigos de barras:', error);
      setStatus('Ocorreu um erro durante a análise das imagens. Tente novamente mais tarde.', 'error');
      renderProductMatches();
      renderUnmatchedList();
      updateSummaryIndicators();
    }

    updateControlStates();
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    const name = (file.name || '').toLowerCase();
    const dotIndex = name.lastIndexOf('.');
    const extension = dotIndex >= 0 ? name.slice(dotIndex) : '';
    return ACCEPTED_EXTENSIONS.includes(extension);
  }

  function extractBarcodes(value) {
    if (!value) return [];
    const matches = value.match(BARCODE_REGEX);
    if (!matches) return [];
    const unique = new Set();
    matches.forEach((code) => {
      const normalized = code.trim();
      if (normalized.length >= 8 && normalized.length <= 14) {
        unique.add(normalized);
      }
    });
    return Array.from(unique);
  }

  function extractSequence(value) {
    if (!value) return '';
    const cleaned = value.replace(/\.[^.]+$/, '');
    const parts = cleaned.split(/[_\-\s]+/).filter(Boolean);
    const reversed = [...parts].reverse();
    for (const part of reversed) {
      if (/^\d{1,3}$/.test(part) && (part.length < 8 || Number(part) < 1000)) {
        return part;
      }
    }
    return '';
  }

  async function resolveBarcodes(barcodes, runId) {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('Configuração da API não encontrada.');
    }

    for (const barcode of barcodes) {
      if (runId !== analysisRunId) {
        return;
      }

      if (state.barcodeCache.has(barcode)) {
        continue;
      }
      try {
        const response = await fetch(`${baseUrl}/products/by-barcode/${encodeURIComponent(barcode)}`);
        if (!response.ok) {
          if (response.status === 404) {
            state.barcodeCache.set(barcode, { status: 'not_found' });
            state.notFoundBarcodes.add(barcode);
            continue;
          }
          throw new Error(`Falha na consulta (${response.status})`);
        }
        const data = await response.json();
        const product = Array.isArray(data?.products) ? data.products[0] : null;
        if (product) {
          state.barcodeCache.set(barcode, { status: 'found', product });
        } else {
          state.barcodeCache.set(barcode, { status: 'not_found' });
          state.notFoundBarcodes.add(barcode);
        }
      } catch (error) {
        console.error(`Erro ao buscar produto pelo código de barras ${barcode}:`, error);
        state.barcodeCache.set(barcode, { status: 'error', error });
        state.errorBarcodes.add(barcode);
      }
    }
  }

  function associateFilesToProducts() {
    const products = new Map();
    const unmatched = [];

    state.files.forEach((entry) => {
      const matchedProducts = new Map();

      entry.barcodes.forEach((barcode) => {
        const cache = state.barcodeCache.get(barcode);
        if (cache?.status !== 'found' || !cache.product) {
          return;
        }
        const product = cache.product;
        const productId = product?._id || product?.id || product?.uuid || String(barcode);
        if (!matchedProducts.has(productId)) {
          matchedProducts.set(productId, { product, barcodes: new Set() });
        }
        matchedProducts.get(productId).barcodes.add(barcode);
      });

      if (!matchedProducts.size) {
        unmatched.push({
          file: entry.file,
          relativePath: entry.relativePath,
          barcodesTried: entry.barcodes,
          sequence: entry.sequence,
        });
        return;
      }

      matchedProducts.forEach((payload, productId) => {
        const { product, barcodes } = payload;
        if (!products.has(productId)) {
          products.set(productId, {
            product,
            files: [],
            barcodes: new Set(),
            safeId: generateSafeId(productId),
          });
        }
        const productEntry = products.get(productId);
        barcodes.forEach((code) => productEntry.barcodes.add(code));
        productEntry.files.push({
          file: entry.file,
          relativePath: entry.relativePath,
          barcodes: Array.from(barcodes),
          sequence: entry.sequence,
          status: 'pending',
          error: '',
        });
      });
    });

    state.products = products;
    state.unmatched = unmatched;
    state.stats.productsTotal = state.products.size;
    state.stats.uploaded = 0;
    state.stats.failed = 0;
  }

  async function handleUpload() {
    if (state.uploading) {
      return;
    }

    if (!state.products.size) {
      setStatus('Nenhum produto disponível para upload.', 'warning');
      return;
    }

    const token = getToken();
    if (!token) {
      setStatus('Sessão expirada. Faça login novamente antes de enviar as imagens.', 'error');
      return;
    }

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      setStatus('Configuração da API não encontrada. Verifique as definições antes de prosseguir.', 'error');
      return;
    }

    state.uploading = true;
    setStatus('Enviando imagens. Aguarde a conclusão para verificar o resultado.', 'info');
    state.stats.uploaded = 0;
    state.stats.failed = 0;
    updateSummaryIndicators();
    updateControlStates();

    for (const [productId, group] of state.products.entries()) {
      if (!group.files.length) {
        continue;
      }

      updateGroupStatus(productId, 'enviando');

      const formData = new FormData();
      group.files.forEach((fileEntry) => {
        formData.append('imagens', fileEntry.file);
      });

      try {
        const response = await fetch(`${baseUrl}/products/${productId}/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Falha ao enviar imagens para este produto.');
        }

        group.files.forEach((fileEntry, index) => {
          fileEntry.status = 'success';
          fileEntry.error = '';
          updateFileStatus(productId, index, 'success');
        });
        state.stats.uploaded += group.files.length;
      } catch (error) {
        console.error(`Erro ao enviar imagens do produto ${productId}:`, error);
        group.files.forEach((fileEntry, index) => {
          fileEntry.status = 'error';
          fileEntry.error = error?.message || 'Erro desconhecido durante o upload.';
          updateFileStatus(productId, index, 'error', fileEntry.error);
        });
        state.stats.failed += group.files.length;
      }

      updateSummaryIndicators();
    }

    state.uploading = false;
    updateControlStates();

    if (state.stats.failed > 0 && state.stats.uploaded > 0) {
      setStatus('Upload finalizado com algumas falhas. Revise os itens destacados em vermelho.', 'warning');
    } else if (state.stats.failed > 0) {
      setStatus('Nenhum arquivo foi enviado. Confira os erros e tente novamente.', 'error');
    } else {
      setStatus('Upload concluído com sucesso! Todas as imagens foram enviadas.', 'success');
    }
  }

  function updateGroupStatus(productId, status) {
    const group = state.products.get(productId);
    if (!group || !refs.productMatches) {
      return;
    }

    const selectorId = group.safeId || generateSafeId(productId);
    const items = refs.productMatches.querySelectorAll(`li[data-product-id="${selectorId}"] [data-status]`);
    items.forEach((statusElement) => {
      statusElement.textContent = status === 'enviando' ? 'enviando...' : translateStatus(status);
      statusElement.classList.remove('text-gray-700', 'text-green-600', 'text-red-600', 'text-blue-600');
      if (status === 'success') {
        statusElement.classList.add('text-green-600');
      } else if (status === 'error') {
        statusElement.classList.add('text-red-600');
      } else if (status === 'enviando') {
        statusElement.classList.add('text-blue-600');
      } else {
        statusElement.classList.add('text-gray-700');
      }
    });
  }

  function updateFileStatus(productId, index, status, errorMessage = '') {
    const group = state.products.get(productId);
    if (!group || !refs.productMatches) {
      return;
    }

    const selectorId = group.safeId || generateSafeId(productId);
    const item = refs.productMatches.querySelector(`li[data-product-id="${selectorId}"][data-file-index="${index}"]`);
    if (!item) {
      return;
    }

    const statusElement = item.querySelector('[data-status]');
    const errorElement = item.querySelector('[data-error]');

    if (statusElement) {
      statusElement.textContent = translateStatus(status);
      statusElement.classList.remove('text-gray-700', 'text-green-600', 'text-red-600', 'text-blue-600');
      if (status === 'success') {
        statusElement.classList.add('text-green-600');
      } else if (status === 'error') {
        statusElement.classList.add('text-red-600');
      } else if (status === 'enviando') {
        statusElement.classList.add('text-blue-600');
      } else {
        statusElement.classList.add('text-gray-700');
      }
    }

    if (errorElement) {
      if (status === 'error' && errorMessage) {
        errorElement.textContent = errorMessage;
        errorElement.classList.remove('hidden');
      } else {
        errorElement.textContent = '';
        errorElement.classList.add('hidden');
      }
    }
  }

  function translateStatus(status) {
    switch (status) {
      case 'success':
        return 'enviado';
      case 'error':
        return 'erro';
      case 'enviando':
        return 'enviando...';
      default:
        return 'aguardando';
    }
  }

  function statusToClass(status) {
    switch (status) {
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'enviando':
        return 'text-blue-600';
      default:
        return 'text-gray-700';
    }
  }

  function setStatus(message, type = 'info') {
    state.status = { message, type };
    updateStatusMessage();
  }

  function getToken() {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token do usuário logado.', error);
      return '';
    }
  }

  function getApiBaseUrl() {
    if (typeof API_CONFIG === 'object' && API_CONFIG && typeof API_CONFIG.BASE_URL === 'string') {
      return API_CONFIG.BASE_URL;
    }
    return '';
  }

  function escapeHtml(value) {
    if (typeof value !== 'string') {
      return value;
    }
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function generateSafeId(value) {
    return String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_{2,}/g, '_');
  }
})();
