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
    stats: {
      linked: 0,
      already: 0,
      products: 0,
      images: 0,
    },
    console: [],
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

    if (!elements.startButton || !elements.console || !elements.productResults) {
      console.error('Não foi possível inicializar a tela de verificação de imagens. Elementos não encontrados.');
      return;
    }

    elements.startButton.addEventListener('click', handleStartVerification);
    elements.clearConsoleBtn?.addEventListener('click', () => {
      state.console = [];
      renderConsole();
    });

    elements.filterName?.addEventListener('input', handleFilterChange);
    elements.filterCode?.addEventListener('input', handleFilterChange);
    elements.filterBarcode?.addEventListener('input', handleFilterChange);

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
    loadCurrentStatus();
  }

  async function handleStartVerification() {
    if (state.isProcessing) {
      return;
    }

    setProcessing(true);
    appendLog('Iniciando verificação de imagens no drive...', 'info');

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
      setProcessing(false);
    }
  }

  async function loadCurrentStatus() {
    try {
      const token = getAuthToken();
      if (!token) {
        appendLog('Sessão expirada. Faça login novamente para consultar o histórico.', 'warning');
        return;
      }

      const response = await fetch(API_ENDPOINT_STATUS, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        if (response.status !== 404) {
          const errorPayload = await safeJson(response);
          const message = errorPayload?.message || `Status ${response.status}`;
          throw new Error(message);
        }
        appendLog('Nenhum histórico de verificação foi encontrado.', 'warning');
        return;
      }

      const payload = await safeJson(response);
      processVerificationResult(payload, { silentConsole: true });
      appendLog('Status de verificação carregado com sucesso.', 'success');
    } catch (error) {
      console.warn('Não foi possível carregar o status atual de imagens:', error);
      if (error?.message) {
        appendLog(error.message, 'warning');
      }
      appendLog('Não foi possível carregar o status atual de imagens.', 'warning');
    }
  }

  function processVerificationResult(payload, options = {}) {
    const { silentConsole = false } = options;

    if (!payload || typeof payload !== 'object') {
      appendLog('Resposta inesperada do servidor durante a verificação de imagens.', 'error');
      return;
    }

    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    const data = payload.data || {};

    if (!silentConsole) {
      logs.forEach((entry) => appendLog(entry.message || String(entry), entry.type || 'info'));
    }

    const summary = data.summary || {};

    state.stats.linked = Number(summary.linked) || 0;
    state.stats.already = Number(summary.already) || 0;
    state.stats.products = Number(summary.products) || 0;
    state.stats.images = Number(summary.images) || 0;

    const products = Array.isArray(data.products) ? data.products : [];
    state.products = products.map(normalizeProduct);

    renderStats();
    renderProducts();

    if (!silentConsole) {
      appendLog(
        `Verificação finalizada. ${state.stats.linked} imagem(ns) vinculada(s) e ${state.stats.already} já vinculada(s).`,
        'success'
      );
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
        linkedNow: Boolean(image?.vinculadaAgora ?? image?.linkedNow),
        alreadyLinked: Boolean(image?.jaVinculada ?? image?.alreadyLinked),
        path: String(image?.path ?? image?.caminho ?? image?.url ?? '').trim(),
      })),
    };
  }

  function renderProducts() {
    if (!elements.productResults) {
      return;
    }

    elements.productResults.innerHTML = '';

    const filtered = applyFilters(state.products);

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
      elements.statsProducts.textContent = state.stats.products || state.products.length;
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

  function setProcessing(isProcessing) {
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

  function appendLog(message, type = 'info') {
    if (!message) {
      return;
    }

    state.console.push({ message: String(message), type, timestamp: new Date() });
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
