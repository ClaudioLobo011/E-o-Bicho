(function () {
  const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const BARCODE_REGEX = /\d{8,14}/g;

  const state = {
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
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', () => {
    elements.folderInput = document.getElementById('image-folder-input');
    elements.uploadButton = document.getElementById('start-upload-btn');
    elements.statusMessage = document.getElementById('status-message');
    elements.summaryProducts = document.getElementById('summary-products');
    elements.summaryImages = document.getElementById('summary-images');
    elements.summaryUploaded = document.getElementById('summary-uploaded');
    elements.summaryFailed = document.getElementById('summary-failed');
    elements.productMatches = document.getElementById('product-matches');
    elements.unmatchedSection = document.getElementById('unmatched-section');
    elements.unmatchedList = document.getElementById('unmatched-list');

    if (!elements.folderInput || !elements.uploadButton || !elements.productMatches) {
      return;
    }

    elements.folderInput.addEventListener('change', handleFolderSelection);
    elements.uploadButton.addEventListener('click', handleUpload);

    updateSummary();
  });

  function handleFolderSelection(event) {
    const files = Array.from(event.target.files || []);
    resetState();

    if (!files.length) {
      setStatus('Nenhum arquivo foi selecionado.', 'warning');
      updateSummary();
      renderProductMatches();
      return;
    }

    const imageFiles = files.filter(isImageFile);
    if (!imageFiles.length) {
      setStatus('Os arquivos selecionados não possuem extensões de imagem suportadas.', 'warning');
      updateSummary();
      renderProductMatches();
      return;
    }

    state.stats.imagesTotal = imageFiles.length;
    setStatus('Analisando nomes dos arquivos e procurando produtos...', 'info');

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
      setStatus(
        'Nenhum código de barras foi identificado nos nomes dos arquivos. Ajuste os nomes e tente novamente.',
        'warning'
      );
      elements.uploadButton.disabled = true;
      updateSummary();
      renderProductMatches();
      renderUnmatched();
      return;
    }

    resolveBarcodes(Array.from(allBarcodes))
      .then(() => {
        associateFilesToProducts();
        renderProductMatches();
        renderUnmatched();
        updateSummary();

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
          elements.uploadButton.disabled = true;
        } else {
          if (warnings.length) {
            setStatus(`Análise concluída com avisos. ${warnings.join(' ')}`, 'warning');
          } else {
            setStatus('Análise concluída. Revise os agrupamentos e inicie o upload quando estiver pronto.', 'success');
          }
          elements.uploadButton.disabled = false;
        }
      })
      .catch((error) => {
        console.error('Erro ao analisar códigos de barras:', error);
        setStatus('Ocorreu um erro durante a análise das imagens. Tente novamente mais tarde.', 'error');
        elements.uploadButton.disabled = true;
        renderProductMatches();
        renderUnmatched();
        updateSummary();
      });
  }

  function resetState() {
    state.files = [];
    state.products.clear();
    state.unmatched = [];
    state.barcodeCache.clear();
    state.notFoundBarcodes.clear();
    state.errorBarcodes.clear();
    state.stats.imagesTotal = 0;
    state.stats.productsTotal = 0;
    state.stats.uploaded = 0;
    state.stats.failed = 0;
    elements.uploadButton.disabled = true;
    clearStatus();
    renderProductMatches();
    renderUnmatched();
    updateSummary();
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

  async function resolveBarcodes(barcodes) {
    for (const barcode of barcodes) {
      if (state.barcodeCache.has(barcode)) {
        continue;
      }
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/products/by-barcode/${encodeURIComponent(barcode)}`);
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
    state.products.clear();
    state.unmatched = [];

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
        state.unmatched.push({
          file: entry.file,
          relativePath: entry.relativePath,
          barcodesTried: entry.barcodes,
          sequence: entry.sequence,
        });
        return;
      }

      matchedProducts.forEach((payload, productId) => {
        const { product, barcodes } = payload;
        if (!state.products.has(productId)) {
          state.products.set(productId, {
            product,
            files: [],
            barcodes: new Set(),
            safeId: generateSafeId(productId),
          });
        }
        const productEntry = state.products.get(productId);
        barcodes.forEach((barcode) => productEntry.barcodes.add(barcode));
        productEntry.files.push({
          file: entry.file,
          relativePath: entry.relativePath,
          barcodes: Array.from(barcodes),
          sequence: entry.sequence,
          status: 'pending',
          error: null,
        });
      });
    });

    state.stats.productsTotal = state.products.size;
  }

  function renderProductMatches() {
    if (!elements.productMatches) return;
    elements.productMatches.innerHTML = '';

    if (!state.products.size) {
      const emptyState = document.createElement('div');
      emptyState.className = 'rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500';
      emptyState.textContent = 'Nenhum produto associado até o momento.';
      elements.productMatches.appendChild(emptyState);
      return;
    }

    state.products.forEach((group, productId) => {
      const card = document.createElement('article');
      card.className = 'rounded-lg border border-gray-200 p-4 shadow-sm';

      const rawName = group.product?.nome || group.product?.name || 'Produto sem nome';
      const rawCode = group.product?.cod || group.product?.codigo || group.product?.codigoInterno || '—';
      const rawBarcode = group.product?.codbarras || group.product?.codigoBarras || '—';
      const productName = String(rawName);
      const productCode = rawCode ? String(rawCode) : '—';
      const barcode = rawBarcode ? String(rawBarcode) : '—';
      const safeId = group.safeId || generateSafeId(productId);

      const matchesMarkup = group.barcodes.size
        ? Array.from(group.barcodes)
            .map((code) => `<code class="text-[11px] bg-gray-100 px-1 py-0.5 rounded">${escapeHtml(String(code))}</code>`)
            .join(' ')
        : '<span class="text-gray-300">—</span>';

      const header = document.createElement('div');
      header.className = 'flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between';

      const info = document.createElement('div');
      info.innerHTML = `
        <h3 class="text-base font-semibold text-gray-800">${escapeHtml(productName)}</h3>
        <p class="text-sm text-gray-500">Cód.: <span class="font-medium text-gray-700">${escapeHtml(productCode)}</span> • Barras: <span class="font-medium text-gray-700">${escapeHtml(barcode)}</span></p>
        <p class="text-xs text-gray-400">Correspondências: ${matchesMarkup}</p>
      `;

      header.appendChild(info);
      card.appendChild(header);

      const list = document.createElement('ul');
      list.className = 'mt-3 space-y-2';

      group.files.forEach((fileEntry, index) => {
        const item = document.createElement('li');
        item.className = 'rounded border border-gray-200 bg-white px-3 py-2 text-sm flex flex-col gap-1';
        item.dataset.productId = safeId;
        item.dataset.fileIndex = String(index);

        const fileName = fileEntry.file?.name || fileEntry.relativePath;
        const sequenceLabel = fileEntry.sequence
          ? `<span class="text-xs text-gray-400">Sequência: ${escapeHtml(fileEntry.sequence)}</span>`
          : '';
        const barcodesMarkup = (fileEntry.barcodes || []).length
          ? fileEntry.barcodes
              .map((code) => `<code class="text-[11px] bg-gray-100 px-1 py-0.5 rounded">${escapeHtml(String(code))}</code>`)
              .join(' ')
          : '<span class="text-gray-300">—</span>';

        item.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium text-gray-700 truncate" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
            ${sequenceLabel}
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span class="text-gray-500">Status: <span class="font-semibold text-gray-700" data-status>aguardando</span></span>
            <span class="text-gray-400">Códigos detectados: ${barcodesMarkup}</span>
          </div>
          <p class="text-xs text-red-500 hidden" data-error></p>
        `;

        list.appendChild(item);
      });

      card.appendChild(list);
      elements.productMatches.appendChild(card);
    });
  }

  function renderUnmatched() {
    if (!elements.unmatchedSection || !elements.unmatchedList) return;

    elements.unmatchedList.innerHTML = '';

    if (!state.unmatched.length) {
      elements.unmatchedSection.classList.add('hidden');
      return;
    }

    elements.unmatchedSection.classList.remove('hidden');

    state.unmatched.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800';
      const fileName = entry.file?.name || entry.relativePath;
      const hasBarcodeErrors = entry.barcodesTried.some((code) => state.errorBarcodes.has(code));
      let reason;
      if (!entry.barcodesTried.length) {
        reason = 'Nenhum código de barras foi identificado no nome do arquivo.';
      } else if (hasBarcodeErrors) {
        reason = 'Não foi possível consultar alguns códigos de barras. Tente novamente mais tarde.';
      } else {
        reason = 'Nenhum produto encontrado com os códigos identificados.';
      }
      item.innerHTML = `
        <div class="font-medium">${escapeHtml(fileName)}</div>
        <div class="text-xs">${escapeHtml(reason)}</div>
        ${entry.barcodesTried.length
          ? `<div class="text-xs mt-1 text-amber-700">Códigos identificados: ${entry.barcodesTried
              .map((code) => `<code class="bg-amber-100 px-1 py-0.5 rounded">${escapeHtml(String(code))}</code>`)
              .join(' ')}</div>`
          : ''}
      `;
      elements.unmatchedList.appendChild(item);
    });
  }

  async function handleUpload(event) {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (!state.products.size) {
      setStatus('Nenhum produto disponível para upload.', 'warning');
      return;
    }

    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
    const token = loggedInUser?.token;
    if (!token) {
      setStatus('Sessão expirada. Faça login novamente antes de enviar as imagens.', 'error');
      return;
    }

    elements.uploadButton.disabled = true;
    elements.uploadButton.classList.add('opacity-75');
    setStatus('Enviando imagens. Aguarde a conclusão para verificar o resultado.', 'info');

    state.stats.uploaded = 0;
    state.stats.failed = 0;
    updateSummary();

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
        const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/upload`, {
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
          fileEntry.error = null;
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

      updateSummary();
    }

    elements.uploadButton.disabled = false;
    elements.uploadButton.classList.remove('opacity-75');

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
    const selectorId = group?.safeId || generateSafeId(productId);
    const items = elements.productMatches?.querySelectorAll(`li[data-product-id="${selectorId}"] [data-status]`);
    if (!items) return;
    items.forEach((statusElement) => {
      statusElement.textContent = status === 'enviando' ? 'enviando...' : status;
      statusElement.classList.remove('text-gray-700', 'text-green-600', 'text-red-600', 'text-blue-600');
      if (status === 'enviando') {
        statusElement.classList.add('text-blue-600');
      }
    });
  }

  function updateFileStatus(productId, index, status, errorMessage = '') {
    const group = state.products.get(productId);
    const selectorId = group?.safeId || generateSafeId(productId);
    const item = elements.productMatches?.querySelector(
      `li[data-product-id="${selectorId}"][data-file-index="${index}"]`
    );
    if (!item) return;

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

  function updateSummary() {
    if (elements.summaryProducts) {
      elements.summaryProducts.textContent = state.stats.productsTotal;
    }
    if (elements.summaryImages) {
      elements.summaryImages.textContent = state.stats.imagesTotal;
    }
    if (elements.summaryUploaded) {
      elements.summaryUploaded.textContent = state.stats.uploaded;
    }
    if (elements.summaryFailed) {
      elements.summaryFailed.textContent = state.stats.failed;
    }
  }

  function clearStatus() {
    if (!elements.statusMessage) return;
    elements.statusMessage.textContent = '';
    elements.statusMessage.className = 'hidden rounded-lg border px-4 py-3 text-sm';
  }

  function setStatus(message, type = 'info') {
    if (!elements.statusMessage) return;
    const baseClasses = 'rounded-lg border px-4 py-3 text-sm';
    const variants = {
      info: 'border-blue-200 bg-blue-50 text-blue-800',
      success: 'border-green-200 bg-green-50 text-green-800',
      warning: 'border-amber-200 bg-amber-50 text-amber-800',
      error: 'border-red-200 bg-red-50 text-red-800',
    };
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = `${baseClasses} ${variants[type] || variants.info}`;
  }

  function escapeHtml(value) {
    if (typeof value !== 'string') return value;
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
