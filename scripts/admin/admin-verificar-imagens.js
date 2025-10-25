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
    currentFolders: [],
    folderSearch: '',
    showFoldersOnly: false,
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
    elements.toggleFolderViewBtn = document.getElementById('toggle-folder-view-btn');
    elements.folderResults = document.getElementById('folder-results');
    elements.folderEmptyState = document.getElementById('folder-empty-state');
    elements.folderPanel = document.getElementById('folder-panel');
    elements.folderCount = document.getElementById('folder-count');
    elements.folderIdFilter = document.getElementById('filter-folder-id');
    elements.productPanel = document.getElementById('product-panel');

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
    elements.toggleFolderViewBtn?.addEventListener('click', handleToggleFolderView);
    elements.folderIdFilter?.addEventListener('input', handleFolderSearchChange);

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
    updateFolderCount(0, 0);
    renderFolders();
    renderViewMode();
  }

  async function handleStartVerification() {
    if (state.isProcessing) {
      appendLog('Uma verificação já está em andamento. Aguarde a conclusão antes de iniciar outra.', 'warning');
      return;
    }

    setProcessing(true);
    state.awaitingBackgroundResult = false;
    appendLog('Enviando solicitação para verificar imagens no drive...', 'info');

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
          state.currentFolders = [];
          state.showFoldersOnly = false;
          renderStats();
          renderProducts();
          renderFolders();
          renderViewMode();
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
    renderFolders();

    let status = data.status || payload.status || null;

    if (!status) {
      if (data.error) {
        status = 'failed';
      } else if (data.finishedAt) {
        status = 'completed';
      }
    }

    if (status === 'processing') {
      if (!state.isProcessing) {
        setProcessing(true);
      }
      state.awaitingBackgroundResult = true;
      if (!fromPolling) {
        startStatusPolling();
      }
      return;
    }

    if (status === 'failed') {
      state.awaitingBackgroundResult = false;
      stopStatusPolling();
      setProcessing(false);
      const errorMessage = data.error || payload.message || 'A verificação de imagens foi finalizada com erro.';
      appendLog(errorMessage, 'error');
      return;
    }

    if (status === 'completed') {
      const shouldLogCompletion = !skipCompletionMessage || state.awaitingBackgroundResult;
      state.awaitingBackgroundResult = false;
      stopStatusPolling();
      setProcessing(false);

      if (shouldLogCompletion) {
        appendLog(
          `Verificação finalizada. ${state.stats.linked} imagem(ns) vinculada(s) e ${state.stats.already} já vinculada(s).`,
          'success'
        );
      }
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

    const rawDriveFolder = rawProduct.driveFolder && typeof rawProduct.driveFolder === 'object'
      ? rawProduct.driveFolder
      : null;
    const rawDriveFolderId = rawDriveFolder?.id ?? rawProduct.driveFolderId ?? null;
    const rawDriveFolderName = rawDriveFolder?.name ?? rawProduct.driveFolderName ?? null;
    const rawDriveFolderPath = rawDriveFolder?.path ?? rawProduct.driveFolderPath ?? null;

    const normalizedFolderId = typeof rawDriveFolderId === 'string' && rawDriveFolderId.trim()
      ? rawDriveFolderId.trim()
      : rawDriveFolderId !== null && rawDriveFolderId !== undefined
        ? String(rawDriveFolderId).trim()
        : '';
    const normalizedFolderName = typeof rawDriveFolderName === 'string' && rawDriveFolderName.trim()
      ? rawDriveFolderName.trim()
      : '';
    const normalizedFolderPath = typeof rawDriveFolderPath === 'string' && rawDriveFolderPath.trim()
      ? rawDriveFolderPath.trim()
      : '';

    const driveFolder = (normalizedFolderId || normalizedFolderName || normalizedFolderPath)
      ? {
          id: normalizedFolderId || '',
          name: normalizedFolderName || '',
          path: normalizedFolderPath || '',
        }
      : null;

    return {
      id: String(rawProduct.id ?? rawProduct.codigo ?? rawProduct.code ?? Math.random()).trim(),
      name: String(rawProduct.nome ?? rawProduct.name ?? 'Produto sem nome').trim(),
      code: String(rawProduct.codigo ?? rawProduct.code ?? '').trim(),
      barcode: String(rawProduct.codbarras ?? rawProduct.barcode ?? '').trim(),
      images: images.map((image, index) => ({
        sequence: image?.sequencia ?? image?.sequence ?? index + 1,
        linkedNow: Boolean(image?.vinculadaAgora ?? image?.linkedNow),
        alreadyLinked: Boolean(image?.jaVinculada ?? image?.alreadyLinked),
        path: String(image?.path ?? image?.caminho ?? image?.url ?? '').trim(),
      })),
      driveFolder,
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
      const linkedNow = product.images.filter((img) => img.linkedNow).length;
      const alreadyLinked = product.images.filter((img) => img.alreadyLinked && !img.linkedNow).length;

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
            <span>Novas: ${linkedNow} • Existentes: ${alreadyLinked}</span>
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

  function renderFolders() {
    if (!elements.folderResults) {
      if (state.showFoldersOnly) {
        state.showFoldersOnly = false;
        renderViewMode();
      }
      return;
    }

    const filteredProducts = Array.isArray(state.filteredProducts) ? state.filteredProducts : applyFilters(state.products);
    const folders = buildDriveFolderMirror(filteredProducts);
    const totalFolders = folders.length;
    const searchTerm = typeof state.folderSearch === 'string' ? state.folderSearch.trim().toLowerCase() : '';
    const searchActive = Boolean(searchTerm);
    const filteredFolders = searchTerm
      ? folders.filter((folder) => (folder.id || '').toLowerCase().includes(searchTerm))
      : folders;

    state.currentFolders = filteredFolders;

    updateFolderCount(totalFolders, filteredFolders.length);

    const hasFolders = filteredFolders.length > 0;

    if (elements.toggleFolderViewBtn) {
      const disableToggle = !hasFolders;
      elements.toggleFolderViewBtn.disabled = disableToggle;
      elements.toggleFolderViewBtn.classList.toggle('opacity-60', disableToggle);
      elements.toggleFolderViewBtn.classList.toggle('cursor-not-allowed', disableToggle);
      elements.toggleFolderViewBtn.setAttribute('aria-disabled', disableToggle ? 'true' : 'false');
    }

    if (!hasFolders) {
      if (elements.folderEmptyState) {
        elements.folderEmptyState.textContent = searchActive
          ? 'Nenhuma pasta encontrada para o ID informado.'
          : 'Nenhuma pasta disponível. Execute uma verificação para carregar os dados.';
        elements.folderEmptyState.classList.remove('hidden');
      }
      elements.folderResults.classList.add('hidden');
      elements.folderResults.innerHTML = '';
      if (state.showFoldersOnly) {
        state.showFoldersOnly = false;
      }
      renderViewMode();
      return;
    }

    if (elements.folderEmptyState) {
      elements.folderEmptyState.classList.add('hidden');
      elements.folderEmptyState.textContent = 'Nenhuma pasta disponível. Execute uma verificação para carregar os dados.';
    }
    elements.folderResults.classList.remove('hidden');

    const fragment = document.createDocumentFragment();

    filteredFolders.forEach((folder) => {
      const item = document.createElement('li');
      item.className = 'px-4 py-3 text-sm text-gray-700';

      const folderName = escapeHtml(folder.name || 'Pasta sem nome');
      const folderId = folder.id ? `drive://${escapeHtml(folder.id)}` : 'Não informado';
      const folderPath = folder.path ? escapeHtml(folder.path) : '';
      const folderPathTitle = folder.path ? escapeHtml(folder.path) : '';
      const count = Number(folder.productCount) || 0;

      item.innerHTML = `
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-gray-800">${folderName}</span>
            <span class="text-xs text-gray-500">${count} produto(s)</span>
          </div>
          <p class="text-xs text-gray-500 break-all">ID: ${folderId}</p>
          ${folderPath
            ? `<p class="text-xs text-gray-500 truncate" title="${folderPathTitle}">${folderPath}</p>`
            : ''}
        </div>
      `;

      fragment.appendChild(item);
    });

    elements.folderResults.innerHTML = '';
    elements.folderResults.appendChild(fragment);

    renderViewMode();
  }

  function buildDriveFolderMirror(products) {
    if (!Array.isArray(products)) {
      return [];
    }

    const foldersMap = new Map();

    products.forEach((product) => {
      const folder = product?.driveFolder;
      if (!folder || typeof folder !== 'object') {
        return;
      }

      const rawId = folder.id;
      const rawName = folder.name;
      const rawPath = folder.path;

      const id = typeof rawId === 'string' && rawId.trim()
        ? rawId.trim()
        : rawId !== null && rawId !== undefined
          ? String(rawId).trim()
          : '';
      const path = typeof rawPath === 'string' ? rawPath.trim() : '';
      const name = typeof rawName === 'string' && rawName.trim()
        ? rawName.trim()
        : path || id;

      if (!(id || name || path)) {
        return;
      }

      const key = id || path || name;
      if (!foldersMap.has(key)) {
        foldersMap.set(key, {
          id,
          name,
          path,
          productCount: 0,
        });
      }

      const entry = foldersMap.get(key);
      entry.productCount += 1;
      if (!entry.name && name) {
        entry.name = name;
      }
      if (!entry.path && path) {
        entry.path = path;
      }
      if (!entry.id && id) {
        entry.id = id;
      }
    });

    return Array.from(foldersMap.values()).sort((a, b) => {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB, 'pt-BR', { numeric: true, sensitivity: 'base' });
    });
  }

  function renderViewMode() {
    const showOnlyFolders = Boolean(state.showFoldersOnly);

    if (elements.productPanel) {
      elements.productPanel.classList.toggle('hidden', showOnlyFolders);
    }

    if (elements.folderPanel) {
      if (showOnlyFolders) {
        elements.folderPanel.classList.remove('lg:col-span-2');
        elements.folderPanel.classList.add('lg:col-span-5');
      } else {
        elements.folderPanel.classList.remove('lg:col-span-5');
        elements.folderPanel.classList.add('lg:col-span-2');
      }
    }

    if (elements.toggleFolderViewBtn) {
      const label = elements.toggleFolderViewBtn.querySelector('span');
      const icon = elements.toggleFolderViewBtn.querySelector('i');
      if (label) {
        label.textContent = showOnlyFolders ? 'Mostrar produtos e pastas' : 'Listar apenas pastas';
      }
      if (icon) {
        icon.className = showOnlyFolders ? 'fas fa-layer-group' : 'fas fa-folder-open';
      }
      elements.toggleFolderViewBtn.setAttribute('aria-pressed', showOnlyFolders ? 'true' : 'false');
    }
  }

  function handleFolderSearchChange(event) {
    const value = typeof event?.target?.value === 'string' ? event.target.value : '';
    state.folderSearch = value;
    renderFolders();
  }

  function handleToggleFolderView() {
    if (elements.toggleFolderViewBtn?.disabled) {
      appendLog('Nenhuma pasta disponível para exibição no momento.', 'warning');
      return;
    }

    if (!Array.isArray(state.currentFolders) || !state.currentFolders.length) {
      appendLog('Nenhuma pasta disponível para exibição no momento.', 'warning');
      return;
    }

    state.showFoldersOnly = !state.showFoldersOnly;
    renderViewMode();
  }

  function renderImages(images) {
    if (!images.length) {
      return '<p class="text-sm text-gray-500">Nenhuma imagem vinculada.</p>';
    }

    return images
      .map((image) => {
        const badges = [];
        if (image.linkedNow) {
          badges.push('<span class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Vinculada agora</span>');
        }
        if (image.alreadyLinked) {
          badges.push('<span class="inline-flex items-center rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">Já vinculada</span>');
        }

        return `
          <div class="flex flex-col gap-1 rounded border border-gray-200 bg-white px-3 py-2">
            <div class="flex items-center justify-between text-xs text-gray-500">
              <span>Sequência: ${escapeHtml(String(image.sequence ?? '—'))}</span>
              <div class="flex flex-wrap gap-1">${badges.join(' ')}</div>
            </div>
            <span class="truncate text-sm text-gray-700" title="${escapeHtml(image.path || 'Sem caminho definido')}">${escapeHtml(image.path || 'Sem caminho definido')}</span>
          </div>
        `;
      })
      .join('');
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
    renderFolders();
  }

  function updateFolderCount(total, visible) {
    if (!elements.folderCount) {
      return;
    }

    const safeTotal = normalizeFolderCount(total);
    const safeVisible = normalizeFolderCount(visible);

    let text;
    if (safeTotal === 0) {
      text = '0 pastas';
    } else if (safeTotal === safeVisible) {
      text = formatFolderCountLabel(safeVisible);
    } else {
      text = `${formatFolderCountLabel(safeVisible)} de ${formatFolderCountLabel(safeTotal)}`;
    }

    elements.folderCount.textContent = text;
  }

  function formatFolderCountLabel(value) {
    const normalized = normalizeFolderCount(value);
    return normalized === 1 ? '1 pasta' : `${normalized} pastas`;
  }

  function normalizeFolderCount(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }

    return 0;
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
