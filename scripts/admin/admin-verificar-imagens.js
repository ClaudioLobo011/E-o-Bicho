(function () {
  function resolveApiBaseUrl() {
    if (typeof API_CONFIG === 'undefined' || API_CONFIG === null) {
      console.error('API_CONFIG não definido. Usando fallback "/api".');
      return '/api';
    }

    const baseUrl = typeof API_CONFIG.BASE_URL === 'string' ? API_CONFIG.BASE_URL.trim() : '';
    const serverUrl = typeof API_CONFIG.SERVER_URL === 'string' ? API_CONFIG.SERVER_URL.trim() : '';

    const normalize = (value) => (value || '').replace(/\/+$/, '');

    if (baseUrl) {
      if (/^https?:\/\//i.test(baseUrl)) {
        return normalize(baseUrl);
      }

      const sanitizedBase = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
      if (serverUrl && /^https?:\/\//i.test(serverUrl)) {
        return `${normalize(serverUrl)}${sanitizedBase}`;
      }

      if (window?.location?.origin) {
        return `${normalize(window.location.origin)}${sanitizedBase}`;
      }

      return sanitizedBase;
    }

    if (serverUrl && /^https?:\/\//i.test(serverUrl)) {
      return `${normalize(serverUrl)}/api`;
    }

    if (window?.location?.origin) {
      return `${normalize(window.location.origin)}/api`;
    }

    console.error('Não foi possível determinar a BASE_URL da API. Usando fallback "/api".');
    return '/api';
  }

  const API_BASE_URL = resolveApiBaseUrl();
  const API_ENDPOINT_VERIFY = `${API_BASE_URL}/admin/produtos/imagens/verificar`;
  const API_ENDPOINT_STATUS = `${API_BASE_URL}/admin/produtos/imagens/status`;
  const API_ENDPOINT_UPLOAD = `${API_BASE_URL}/admin/produtos/imagens/upload-local`;
  const CONSOLE_MAX_LINES = 200;

  const state = {
    isProcessing: false,
    filters: {
      name: '',
      code: '',
      barcode: '',
    },
    products: [],
    filteredProducts: [],
    stats: {
      linked: 0,
      already: 0,
      products: 0,
      images: 0,
    },
    console: [],
    serverLogIds: new Set(),
    meta: {
      totalProducts: 0,
      processedProducts: 0,
    },
    polling: {
      timerId: null,
      delay: 4000,
    },
    isLoadingStatus: false,
    awaitingBackgroundResult: false,
    uploads: {
      files: [],
      recognized: [],
      ignoredCount: 0,
      products: new Map(),
      isUploading: false,
    },
  };

  const elements = {};

  function initialize() {
    elements.startButton = document.getElementById('start-verification-btn');
    elements.console = document.getElementById('verification-console');
    elements.clearConsoleBtn = document.getElementById('clear-console-btn');
    elements.filterName = document.getElementById('filter-name');
    elements.filterCode = document.getElementById('filter-code');
    elements.filterBarcode = document.getElementById('filter-barcode');
    elements.productResults = document.getElementById('product-results');
    elements.productEmptyState = document.getElementById('product-empty-state');
    elements.statsLinked = document.getElementById('stats-linked');
    elements.statsAlready = document.getElementById('stats-already');
    elements.statsProducts = document.getElementById('stats-products');
    elements.statsImages = document.getElementById('stats-images');
    elements.productPanel = document.getElementById('product-panel');
    elements.folderInput = document.getElementById('folder-input');
    elements.folderTotal = document.getElementById('folder-total');
    elements.folderRecognized = document.getElementById('folder-recognized');
    elements.folderIgnored = document.getElementById('folder-ignored');
    elements.folderStatus = document.getElementById('folder-status');
    elements.folderProducts = document.getElementById('folder-products');
    elements.folderImages = document.getElementById('folder-images');
    elements.folderFeedback = document.getElementById('folder-feedback');
    elements.folderResults = document.getElementById('folder-results');
    elements.folderEmpty = document.getElementById('folder-empty');
    elements.folderUploadBtn = document.getElementById('folder-upload-btn');

    if (!elements.startButton || !elements.console || !elements.productResults) {
      console.error('Não foi possível inicializar a tela de verificação de imagens. Elementos não encontrados.');
      return;
    }

    elements.startButton.addEventListener('click', handleStartVerification);
    elements.clearConsoleBtn?.addEventListener('click', () => {
      state.console = [];
      state.serverLogIds.clear();
      renderConsole();
    });

    elements.filterName?.addEventListener('input', handleFilterChange);
    elements.filterCode?.addEventListener('input', handleFilterChange);
    elements.filterBarcode?.addEventListener('input', handleFilterChange);

    elements.folderInput?.addEventListener('change', handleFolderSelection);
    elements.folderUploadBtn?.addEventListener('click', handleFolderUpload);

    elements.productResults.addEventListener('click', (event) => {
      const button = event.target.closest('[data-product-toggle]');
      if (!button) {
        return;
      }

      const targetId = button.getAttribute('data-product-toggle');
      const details = elements.productResults.querySelector(`[data-product-details="${targetId}"]`);
      if (!details) {
        return;
      }

      const isOpen = details.getAttribute('data-open') === 'true';
      if (isOpen) {
        details.classList.add('hidden');
        details.setAttribute('data-open', 'false');
        button.setAttribute('aria-expanded', 'false');
        button.querySelector('[data-chevron]')?.classList.remove('rotate-180');
      } else {
        details.classList.remove('hidden');
        details.setAttribute('data-open', 'true');
        button.setAttribute('aria-expanded', 'true');
        button.querySelector('[data-chevron]')?.classList.add('rotate-180');
      }
    });

    appendLog('Tela pronta para iniciar a verificação.', 'info');
    loadCurrentStatus({ skipCompletionMessage: true });
  }

  async function handleStartVerification() {
    if (state.isProcessing) {
      appendLog('Uma verificação já está em andamento. Aguarde a conclusão antes de iniciar outra.', 'warning');
      return;
    }

    setProcessing(true);
    state.awaitingBackgroundResult = false;
    appendLog('Enviando solicitação para verificar imagens e enviar à Cloudflare...', 'info');

    let waitingForBackground = false;

    try {
      const token = getAuthToken();
      if (!token) {
        appendLog('Sessão expirada. Faça login novamente para continuar.', 'error');
        setProcessing(false);
        return;
      }

      const response = await fetch(API_ENDPOINT_VERIFY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ acionadoEm: new Date().toISOString() }),
      });

      if (response.status === 202) {
        waitingForBackground = true;
        state.awaitingBackgroundResult = true;

        const payload = await safeJson(response);
        if (payload?.message) {
          appendLog(payload.message, 'info');
        } else {
          appendLog('Verificação iniciada. Acompanhe o progresso no console.', 'info');
        }

        startStatusPolling();
        await loadCurrentStatus({ fromPolling: true, suppressNotFound: true, skipCompletionMessage: true });
        return;
      }

      if (!response.ok) {
        const errorPayload = await safeJson(response);
        const message = errorPayload?.message || `Falha na requisição: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      const payload = await safeJson(response);
      processVerificationResult(payload);
    } catch (error) {
      console.error('Erro ao executar verificação de imagens:', error);
      if (error?.message) {
        appendLog(error.message, 'error');
      }
      appendLog('Não foi possível concluir a verificação. Verifique sua conexão ou tente novamente mais tarde.', 'error');
    } finally {
      if (!waitingForBackground) {
        stopStatusPolling();
        setProcessing(false);
        state.awaitingBackgroundResult = false;
      }
    }
  }

  async function loadCurrentStatus(options = {}) {
    const { fromPolling = false, suppressNotFound = false, skipCompletionMessage = false } = options;

    if (state.isLoadingStatus) {
      return;
    }

    state.isLoadingStatus = true;

    try {
      const token = getAuthToken();
      if (!token) {
        if (!fromPolling) {
          appendLog('Sessão expirada. Faça login novamente para consultar o histórico.', 'warning');
        }
        stopStatusPolling();
        setProcessing(false);
        state.awaitingBackgroundResult = false;
        return;
      }

      const response = await fetch(API_ENDPOINT_STATUS, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          if (!suppressNotFound && !fromPolling) {
            appendLog('Nenhum histórico de verificação foi encontrado.', 'warning');
          }
          state.products = [];
          state.stats.linked = 0;
          state.stats.already = 0;
          state.stats.products = 0;
          state.stats.images = 0;
          state.meta.totalProducts = 0;
          state.meta.processedProducts = 0;
          state.filteredProducts = [];
          renderStats();
          renderProducts();
          return;
        }

        const errorPayload = await safeJson(response);
        const message = errorPayload?.message || `Status ${response.status}`;
        throw new Error(message);
      }

      const payload = await safeJson(response);
      processVerificationResult(payload, { fromPolling, skipCompletionMessage });
    } catch (error) {
      console.warn('Não foi possível carregar o status atual de imagens:', error);
      if (!fromPolling) {
        if (error?.message) {
          appendLog(error.message, 'warning');
        }
        appendLog('Não foi possível carregar o status atual de imagens.', 'warning');
      }
    } finally {
      state.isLoadingStatus = false;
    }
  }

  function processVerificationResult(payload, options = {}) {
    const { fromPolling = false, skipCompletionMessage = false } = options;

    if (!payload || typeof payload !== 'object') {
      appendLog('Resposta inesperada do servidor durante a verificação de imagens.', 'error');
      return;
    }

    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    logs.forEach((entry) => {
      const message = entry?.message ?? String(entry);
      const type = entry?.type || 'info';
      const timestamp = entry?.timestamp || Date.now();
      const id = typeof entry?.id === 'string' && entry.id.trim()
        ? entry.id.trim()
        : `${entry?.timestamp || ''}::${entry?.message || ''}::${entry?.type || ''}`;

      appendLog(message, type, {
        timestamp,
        id,
        skipDuplicates: true,
        fromServer: true,
      });
    });

    const data = payload.data || {};
    const summary = data.summary || {};

    if (Object.prototype.hasOwnProperty.call(summary, 'linked')) {
      state.stats.linked = Number(summary.linked) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(summary, 'already')) {
      state.stats.already = Number(summary.already) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(summary, 'products')) {
      state.stats.products = Number(summary.products) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(summary, 'images')) {
      state.stats.images = Number(summary.images) || 0;
    }

    const meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : (data.meta || {});
    if (meta && typeof meta === 'object') {
      if (Object.prototype.hasOwnProperty.call(meta, 'totalProducts')) {
        state.meta.totalProducts = Number(meta.totalProducts) || 0;
      }
      if (Object.prototype.hasOwnProperty.call(meta, 'processedProducts')) {
        state.meta.processedProducts = Number(meta.processedProducts) || 0;
      }
    }

    const products = Array.isArray(data.products) ? data.products : [];
    state.products = products.map(normalizeProduct);

    renderStats();
    renderProducts();

    let status = data.status || payload.status || null;

    if (!status) {
      if (data.error) {
        status = 'failed';
      } else if (data.finishedAt) {
        status = 'completed';
      }
    }

    if (!fromPolling && !skipCompletionMessage) {
      if (status === 'completed') {
        appendLog('Verificação concluída.', 'success');
      } else if (status === 'failed') {
        appendLog('A verificação de imagens foi finalizada com erros.', 'error');
      }
    }

    const expectBackground = status === 'processing' || status === 'queued' || state.awaitingBackgroundResult;
    if (expectBackground) {
      startStatusPolling();
    } else {
      stopStatusPolling();
      setProcessing(false);
      state.awaitingBackgroundResult = false;
    }
  }

  function normalizeProduct(rawProduct) {
    if (!rawProduct || typeof rawProduct !== 'object') {
      const fallbackId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      return {
        id: fallbackId,
        name: 'Produto desconhecido',
        code: '',
        barcode: '',
        images: [],
      };
    }

    const images = Array.isArray(rawProduct.images) ? rawProduct.images : [];

    return {
      id: String(rawProduct.id ?? rawProduct.codigo ?? rawProduct.code ?? Math.random()).trim(),
      name: String(rawProduct.nome ?? rawProduct.name ?? 'Produto sem nome').trim(),
      code: String(rawProduct.codigo ?? rawProduct.code ?? '').trim(),
      barcode: String(rawProduct.codbarras ?? rawProduct.barcode ?? '').trim(),
      images: images.map((image, index) => ({
        sequence: image?.sequencia ?? image?.sequence ?? index + 1,
        status: image?.status || 'unknown',
        source: String(image?.origem ?? image?.source ?? image?.path ?? '').trim(),
        destination: String(image?.destino ?? image?.destination ?? image?.newUrl ?? '').trim(),
        message: String(image?.mensagem ?? image?.message ?? '').trim(),
      })),
    };
  }

  function renderProducts() {
    if (!elements.productResults) {
      return;
    }

    elements.productResults.innerHTML = '';

    const filtered = applyFilters(state.products);
    state.filteredProducts = filtered;

    if (!filtered.length) {
      elements.productEmptyState?.classList.remove('hidden');
      return;
    }

    elements.productEmptyState?.classList.add('hidden');

    const fragment = document.createDocumentFragment();

    filtered.forEach((product, index) => {
      const itemId = `${product.id}-${index}`;
      const imagesCount = product.images.length;
      const uploaded = product.images.filter((img) => img.status === 'uploaded').length;
      const already = product.images.filter((img) => img.status === 'already').length;
      const failures = product.images.filter((img) => img.status === 'failed').length;

      const wrapper = document.createElement('article');
      wrapper.className = 'overflow-hidden rounded-lg border border-gray-200 shadow-sm';
      wrapper.innerHTML = `
        <button
          type="button"
          class="flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-left text-sm text-gray-700 transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-product-toggle="${itemId}"
          aria-expanded="false"
        >
          <div class="flex flex-1 flex-col">
            <span class="text-base font-semibold text-gray-800">${escapeHtml(product.name)}</span>
            <span class="text-xs text-gray-500">Código: ${escapeHtml(product.code || '—')} • Código de barras: ${escapeHtml(product.barcode || '—')}</span>
          </div>
          <div class="flex flex-col items-end text-xs text-gray-500">
            <span class="font-semibold text-gray-700">${imagesCount} imagem(ns)</span>
            <span>Uploads: ${uploaded} • Cloudflare: ${already} • Falhas: ${failures}</span>
          </div>
          <i class="fas fa-chevron-down text-gray-400 transition-transform" data-chevron></i>
        </button>
        <div class="hidden border-t border-gray-200 bg-gray-50" data-product-details="${itemId}" data-open="false">
          <div class="space-y-2 px-4 py-3 text-sm text-gray-700">
            ${renderImages(product.images)}
          </div>
        </div>
      `;

      fragment.appendChild(wrapper);
    });

    elements.productResults.appendChild(fragment);
  }

  function renderImages(images) {
    if (!images.length) {
      return '<p class="text-sm text-gray-500">Nenhuma imagem processada.</p>';
    }

    return images
      .map((image) => {
        const badges = [];
        if (image.status === 'uploaded') {
          badges.push('<span class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Enviada</span>');
        } else if (image.status === 'already') {
          badges.push('<span class="inline-flex items-center rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">Já estava</span>');
        } else if (image.status === 'failed') {
          badges.push('<span class="inline-flex items-center rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">Falha</span>');
        }

        const destination = image.destination || 'Sem URL gerada';
        const source = image.source || 'Origem não informada';
        const message = image.message ? `<p class="text-xs text-amber-700">${escapeHtml(image.message)}</p>` : '';

        return `
          <div class="flex flex-col gap-1 rounded border border-gray-200 bg-white px-3 py-2">
            <div class="flex items-center justify-between text-xs text-gray-500">
              <span>Sequência: ${escapeHtml(String(image.sequence ?? '—'))}</span>
              <div class="flex flex-wrap gap-1">${badges.join(' ')}</div>
            </div>
            <div class="space-y-1 text-sm text-gray-700">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-semibold text-gray-500">Origem</span>
                <span class="truncate" title="${escapeHtml(source)}">${escapeHtml(source)}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-semibold text-gray-500">Destino</span>
                <span class="truncate" title="${escapeHtml(destination)}">${escapeHtml(destination)}</span>
              </div>
              ${message}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function handleFolderSelection(event) {
    const files = Array.from(event?.target?.files || []);
    state.uploads.files = files;
    state.uploads.ignoredCount = 0;
    state.uploads.recognized = [];
    state.uploads.products = new Map();

    if (!files.length) {
      renderFolderSummary();
      renderFolderResults();
      return;
    }

    const recognized = [];

    files.forEach((file) => {
      const parsed = parseFileName(file?.name);
      if (!parsed) {
        state.uploads.ignoredCount += 1;
        return;
      }

      recognized.push({ ...parsed, file });
    });

    state.uploads.recognized = recognized;
    renderFolderSummary();
    renderFolderResults();
    if (recognized.length) {
      preloadProductsForFolder(recognized.map((item) => item.barcode));
    }
  }

  async function preloadProductsForFolder(barcodes) {
    if (!Array.isArray(barcodes) || !barcodes.length) {
      return;
    }

    const unique = Array.from(new Set(barcodes.filter(Boolean)));
    for (const barcode of unique) {
      if (state.uploads.products.has(barcode)) {
        continue;
      }

      const product = await fetchProductByBarcode(barcode);
      state.uploads.products.set(barcode, product);
      renderFolderResults();
    }
  }

  function parseFileName(name) {
    if (typeof name !== 'string') {
      return null;
    }

    const cleaned = name.trim().split(/[/\\]/).pop();
    const match = cleaned.match(/^(.+?)-(\d+)\.[^.]+$/);
    if (!match) {
      return null;
    }

    const rawBarcode = match[1].replace(/[^0-9a-zA-Z]/g, '');
    const sequence = parseInt(match[2], 10);

    if (!rawBarcode || Number.isNaN(sequence) || sequence <= 0) {
      return null;
    }

    return {
      barcode: rawBarcode,
      sequence,
    };
  }

  async function fetchProductByBarcode(barcode) {
    if (!barcode) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/products/by-barcode/${encodeURIComponent(barcode)}?includeHidden=true`);
      if (!response.ok) {
        return null;
      }

      const payload = await safeJson(response);
      if (payload?.products?.length) {
        const product = payload.products[0];
        return {
          id: String(product._id || product.id || product.cod || product.cod_produto || product.codbarras),
          name: product.nome || product.name || 'Produto sem nome',
          barcode: product.codbarras || barcode,
          code: product.cod || product.codigo || '',
        };
      }
    } catch (error) {
      console.warn('Erro ao buscar produto por código de barras:', error);
    }

    return null;
  }

  function renderFolderSummary() {
    if (!elements.folderTotal) {
      return;
    }

    const total = state.uploads.files.length;
    const recognized = state.uploads.recognized.length;
    const ignored = state.uploads.ignoredCount;
    const products = new Set(state.uploads.recognized.map((item) => item.barcode)).size;

    elements.folderTotal.textContent = total;
    elements.folderRecognized.textContent = recognized;
    elements.folderIgnored.textContent = ignored;
    elements.folderStatus.textContent = recognized
      ? 'Arquivos prontos para enviar.'
      : total
        ? 'Nenhum arquivo no padrão codbarras-1.ext foi reconhecido.'
        : 'Nenhuma pasta selecionada.';

    elements.folderProducts.textContent = `${products} produto${products === 1 ? '' : 's'}`;
    elements.folderImages.textContent = `${recognized} imagem${recognized === 1 ? '' : 's'}`;
    elements.folderFeedback.textContent = recognized
      ? 'Confirme abaixo os produtos identificados e envie quando estiver tudo certo.'
      : 'Selecione uma pasta para visualizar os produtos encontrados.';

    if (elements.folderUploadBtn) {
      elements.folderUploadBtn.disabled = !recognized || state.uploads.isUploading;
    }
  }

  function renderFolderResults() {
    if (!elements.folderResults) {
      return;
    }

    elements.folderResults.innerHTML = '';

    const grouped = new Map();
    state.uploads.recognized.forEach((item) => {
      const list = grouped.get(item.barcode) || [];
      list.push(item);
      grouped.set(item.barcode, list);
    });

    if (!grouped.size) {
      if (elements.folderEmpty) {
        elements.folderResults.appendChild(elements.folderEmpty);
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    grouped.forEach((items, barcode) => {
      const product = state.uploads.products.get(barcode) || null;
      const sorted = items.slice().sort((a, b) => a.sequence - b.sequence);

      const card = document.createElement('article');
      card.className = 'rounded-lg border border-gray-200 bg-white p-4 shadow-sm';
      card.innerHTML = `
        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-base font-semibold text-gray-800">${escapeHtml(product?.name || 'Produto não encontrado')}</h3>
            <p class="text-sm text-gray-500">Código de barras: ${escapeHtml(barcode)}${product?.code ? ` • Código: ${escapeHtml(product.code)}` : ''}</p>
          </div>
          <span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">${sorted.length} imagem${sorted.length === 1 ? '' : 's'}</span>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          ${sorted
            .map((item) => `<div class="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"><span class="text-xs uppercase text-gray-500">Sequência</span><p class="font-semibold text-gray-800">${escapeHtml(item.sequence)}</p><p class="truncate text-xs text-gray-500" title="${escapeHtml(item.file?.name || '')}">${escapeHtml(item.file?.name || '')}</p></div>`)
            .join('')}
        </div>
      `;

      fragment.appendChild(card);
    });

    elements.folderResults.appendChild(fragment);
  }

  async function handleFolderUpload() {
    if (state.uploads.isUploading || !state.uploads.recognized.length) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      appendLog('Sessão expirada. Faça login novamente para enviar imagens.', 'error');
      return;
    }

    const formData = new FormData();
    state.uploads.recognized.forEach((item) => {
      if (item.file) {
        formData.append('files', item.file, item.file.name);
      }
    });

    setUploading(true);
    appendLog('Enviando imagens para a Cloudflare...', 'info');

    try {
      const response = await fetch(API_ENDPOINT_UPLOAD, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const payload = await safeJson(response);

      if (!response.ok) {
        const message = payload?.message || 'Falha ao enviar imagens. Verifique o padrão dos arquivos e tente novamente.';
        throw new Error(message);
      }

      appendLog(payload?.message || 'Upload concluído.', 'success');
      if (Array.isArray(payload?.products)) {
        state.products = payload.products.map(normalizeProduct);
        renderProducts();
      }

      if (payload?.summary) {
        state.stats.linked = Number(payload.summary.linked || payload.summary.uploaded || 0);
        state.stats.images = Number(payload.summary.images || state.stats.images);
        state.stats.products = Number(payload.summary.products || state.stats.products);
        renderStats();
      }
    } catch (error) {
      console.error('Erro ao enviar imagens da pasta:', error);
      appendLog(error?.message || 'Não foi possível concluir o upload das imagens.', 'error');
    } finally {
      setUploading(false);
    }
  }

  function setUploading(isUploading) {
    state.uploads.isUploading = isUploading;
    if (elements.folderUploadBtn) {
      elements.folderUploadBtn.disabled = isUploading || !state.uploads.recognized.length;
      const icon = elements.folderUploadBtn.querySelector('i');
      const label = elements.folderUploadBtn.querySelector('span');
      if (icon) {
        icon.className = isUploading ? 'fas fa-spinner fa-spin' : 'fas fa-cloud-upload-alt';
      }
      if (label) {
        label.textContent = isUploading ? 'Enviando...' : 'Enviar para Cloudflare';
      }
    }
  }

  function renderStats() {
    if (elements.statsLinked) {
      elements.statsLinked.textContent = state.stats.linked;
    }
    if (elements.statsAlready) {
      elements.statsAlready.textContent = state.stats.already;
    }
    if (elements.statsProducts) {
      const productsValue = state.stats.products || state.products.length || 0;
      let productsText = String(productsValue);

      if (state.meta.totalProducts > 0 && (state.awaitingBackgroundResult || state.meta.processedProducts > 0)) {
        const processed = Math.min(state.meta.processedProducts || 0, state.meta.totalProducts);
        productsText += ` (${processed}/${state.meta.totalProducts})`;
      }

      elements.statsProducts.textContent = productsText;
    }
    if (elements.statsImages) {
      const totalImages = state.stats.images || state.products.reduce((total, product) => total + product.images.length, 0);
      elements.statsImages.textContent = totalImages;
    }
  }

  function handleFilterChange() {
    state.filters.name = elements.filterName?.value?.trim().toLowerCase() || '';
    state.filters.code = elements.filterCode?.value?.trim().toLowerCase() || '';
    state.filters.barcode = elements.filterBarcode?.value?.trim().toLowerCase() || '';
    renderProducts();
  }

  function applyFilters(products) {
    const nameFilter = state.filters.name;
    const codeFilter = state.filters.code;
    const barcodeFilter = state.filters.barcode;

    if (!nameFilter && !codeFilter && !barcodeFilter) {
      return products;
    }

    return products.filter((product) => {
      const name = product.name?.toLowerCase?.() || '';
      const code = product.code?.toLowerCase?.() || '';
      const barcode = product.barcode?.toLowerCase?.() || '';

      const matchesName = !nameFilter || name.includes(nameFilter);
      const matchesCode = !codeFilter || code.includes(codeFilter);
      const matchesBarcode = !barcodeFilter || barcode.includes(barcodeFilter);

      return matchesName && matchesCode && matchesBarcode;
    });
  }

  function startStatusPolling() {
    const delay = Number(state.polling?.delay) > 0 ? Number(state.polling.delay) : 4000;

    if (state.polling.timerId) {
      return;
    }

    state.polling.timerId = window.setInterval(() => {
      loadCurrentStatus({ fromPolling: true });
    }, delay);
  }

  function stopStatusPolling() {
    if (!state.polling.timerId) {
      return;
    }

    window.clearInterval(state.polling.timerId);
    state.polling.timerId = null;
  }

  function setProcessing(isProcessing) {
    if (state.isProcessing === isProcessing) {
      return;
    }

    state.isProcessing = isProcessing;

    if (elements.startButton) {
      elements.startButton.disabled = isProcessing;
      elements.startButton.classList.toggle('opacity-60', isProcessing);
      elements.startButton.classList.toggle('cursor-not-allowed', isProcessing);
      const label = elements.startButton.querySelector('span');
      if (label) {
        label.textContent = isProcessing ? 'Verificando...' : 'Iniciar Verificação';
      }
      const icon = elements.startButton.querySelector('i');
      if (icon) {
        icon.className = isProcessing ? 'fas fa-spinner fa-spin' : 'fas fa-play';
      }
    }
  }

  function appendLog(message, type = 'info', options = {}) {
    if (!message) {
      return;
    }

    const baseId = typeof options.id === 'string' && options.id.trim() ? options.id.trim() : null;
    const logId = baseId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    if (options.skipDuplicates && baseId && state.serverLogIds.has(baseId)) {
      return;
    }

    if (options.fromServer && baseId) {
      state.serverLogIds.add(baseId);
    }

    const providedTimestamp = options.timestamp instanceof Date ? options.timestamp : new Date(options.timestamp || Date.now());
    const isValidTimestamp = providedTimestamp instanceof Date && !Number.isNaN(providedTimestamp.getTime());
    const timestamp = isValidTimestamp ? providedTimestamp : new Date();

    state.console.push({ message: String(message), type, timestamp, id: logId });
    if (state.console.length > CONSOLE_MAX_LINES) {
      state.console.splice(0, state.console.length - CONSOLE_MAX_LINES);
    }
    renderConsole();
  }

  function renderConsole() {
    if (!elements.console) {
      return;
    }

    if (!state.console.length) {
      elements.console.innerHTML = '<p class="text-sm text-gray-500">Console vazio.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();

    state.console.forEach((entry) => {
      const line = document.createElement('div');
      line.className = `mb-1 text-xs last:mb-0 ${getConsoleColor(entry.type)}`;
      const time = entry.timestamp instanceof Date ? entry.timestamp.toLocaleTimeString() : '';
      line.innerHTML = `<span class="font-semibold">[${time}]</span> ${escapeHtml(entry.message)}`;
      fragment.appendChild(line);
    });

    elements.console.innerHTML = '';
    elements.console.appendChild(fragment);
    elements.console.scrollTop = elements.console.scrollHeight;
  }

  function getConsoleColor(type) {
    switch (type) {
      case 'error':
        return 'text-red-600';
      case 'warning':
        return 'text-amber-600';
      case 'success':
        return 'text-emerald-600';
      default:
        return 'text-gray-700';
    }
  }

  async function safeJson(response) {
    if (response.status === 204) {
      return {};
    }

    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      appendLog('Não foi possível interpretar a resposta do servidor.', 'error');
      throw error;
    }
  }

  function getAuthToken() {
    try {
      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
      return loggedInUser?.token || '';
    } catch (error) {
      console.error('Não foi possível obter o token de autenticação:', error);
      return '';
    }
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
