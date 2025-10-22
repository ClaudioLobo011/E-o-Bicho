(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const folderInput = document.getElementById('folder-input');
    const folderInfo = document.getElementById('folder-info');
    const logContainer = document.getElementById('log-container');
    const clearLogBtn = document.getElementById('clear-log-btn');
    const startUploadBtn = document.getElementById('start-upload-btn');
    const previewSummary = document.getElementById('preview-summary');
    const matchedCount = document.getElementById('matched-count');
    const unmatchedCount = document.getElementById('unmatched-count');
    const matchedList = document.getElementById('matched-list');
    const unmatchedList = document.getElementById('unmatched-list');

    if (!folderInput || !logContainer || !startUploadBtn || !previewSummary || !matchedList || !unmatchedList) {
      return;
    }

    const state = {
      entries: [],
      isProcessing: false,
      isUploading: false,
      productCache: new Map(),
    };

    const imageMimePattern = /^image\//i;

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const normalizeBarcode = (value) => String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^0-9A-Za-z]/g, '')
      .trim();

    const hasValidDigits = (value) => /\d{6,}/.test(String(value ?? ''));

    const logMessage = (message, type = 'info') => {
      const prefix = {
        info: '[INFO]',
        success: '[SUCESSO]',
        error: '[ERRO]',
        warn: '[AVISO]'
      }[type] || '[INFO]';

      const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
      logContainer.textContent += `${timestamp} ${prefix} ${message}\n`;
      logContainer.scrollTop = logContainer.scrollHeight;
    };

    const clearLog = () => {
      logContainer.textContent = '';
    };

    const parseFileName = (file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const segments = relativePath.split('/');
      const fileName = segments[segments.length - 1];
      const folderName = segments.length > 1 ? segments[segments.length - 2] : '';
      const lastDot = fileName.lastIndexOf('.');
      const extension = lastDot >= 0 ? fileName.slice(lastDot) : '';
      const baseName = lastDot >= 0 ? fileName.slice(0, lastDot) : fileName;
      const lastDash = baseName.lastIndexOf('-');
      const buildLegacyResult = () => {
        const barcodeRaw = baseName.slice(0, lastDash).trim();
        const sequencePart = baseName.slice(lastDash + 1).trim();
        const sequence = Number.parseInt(sequencePart, 10);

        if (!barcodeRaw) {
          return {
            folderName,
            fileName,
            extension,
            error: 'Código de barras ausente no nome do arquivo.'
          };
        }

        if (!Number.isInteger(sequence)) {
          return {
            folderName,
            fileName,
            extension,
            barcodeRaw,
            error: 'Sequência numérica inválida no nome do arquivo.'
          };
        }

        const normalizedBarcode = normalizeBarcode(barcodeRaw);

        if (!hasValidDigits(normalizedBarcode)) {
          return {
            folderName,
            fileName,
            extension,
            barcodeRaw,
            error: 'Nenhum código de barras válido foi identificado no nome do arquivo.'
          };
        }

        return {
          folderName,
          fileName,
          extension,
          barcodeRaw,
          normalizedBarcode,
          sequence,
          barcodeEntries: [{ barcodeRaw, normalizedBarcode }],
          format: 'legacy',
          includeSequenceInFileName: true,
        };
      };

      const buildMultiBarcodeResult = () => {
        const normalizedBase = baseName.replace(/_/g, ' ').trim();
        const parts = normalizedBase.split(/\s+/).filter(Boolean);

        if (parts.length < 2) {
          return {
            folderName,
            fileName,
            extension,
            error: 'Nome do arquivo fora do padrão esperado para múltiplos códigos de barras.'
          };
        }

        const sequencePart = parts.shift();
        const sequence = Number.parseInt(sequencePart, 10);

        if (!Number.isInteger(sequence)) {
          return {
            folderName,
            fileName,
            extension,
            error: 'Sequência numérica inválida no nome do arquivo.'
          };
        }

        const barcodeEntries = parts
          .map((barcodeRaw) => ({
            barcodeRaw,
            normalizedBarcode: normalizeBarcode(barcodeRaw)
          }))
          .filter((entry) => entry.barcodeRaw && hasValidDigits(entry.normalizedBarcode));

        if (!barcodeEntries.length) {
          return {
            folderName,
            fileName,
            extension,
            error: 'Nenhum código de barras foi identificado no nome do arquivo.'
          };
        }

        return {
          folderName,
          fileName,
          extension,
          barcodeRaw: barcodeEntries[0].barcodeRaw,
          normalizedBarcode: barcodeEntries[0].normalizedBarcode,
          sequence,
          barcodeEntries,
          format: 'multi-barcode',
          includeSequenceInFileName: false,
        };
      };

      if (lastDash > 0) {
        return buildLegacyResult();
      }

      return buildMultiBarcodeResult();
    };

    const getMatchedEntries = () => state.entries.filter((entry) => entry.status === 'matched');
    const getUnmatchedEntries = () => state.entries.filter((entry) => entry.status !== 'matched');

    const getUploadSummary = () => {
      const matchedEntries = getMatchedEntries();
      const success = matchedEntries.filter((entry) => entry.uploadStatus === 'success').length;
      const failures = matchedEntries.filter((entry) => entry.uploadStatus === 'error').length;
      const uploading = matchedEntries.filter((entry) => entry.uploadStatus === 'uploading').length;
      return { success, failures, uploading };
    };

    const renderSummary = () => {
      const total = state.entries.length;
      const matched = getMatchedEntries().length;
      const unmatched = getUnmatchedEntries().length;
      const { success, failures, uploading } = getUploadSummary();

      if (total === 0) {
        previewSummary.innerHTML = '<p>Nenhuma imagem carregada até o momento.</p>';
        return;
      }

      const lines = [
        `<p>Total de imagens analisadas: <strong>${total}</strong></p>`,
        `<p>Produtos identificados: <strong>${matched}</strong></p>`,
        `<p>Imagens sem correspondência: <strong>${unmatched}</strong></p>`
      ];

      if (matched > 0) {
        lines.push(`<p>Prontas para envio: <strong>${matched - success - failures - uploading}</strong></p>`);
        lines.push(`<p>Enviadas com sucesso: <strong class="text-green-600">${success}</strong></p>`);
        lines.push(`<p>Falhas no envio: <strong class="text-red-600">${failures}</strong></p>`);
        if (uploading > 0) {
          lines.push(`<p>Enviando agora: <strong>${uploading}</strong></p>`);
        }
      }

      previewSummary.innerHTML = lines.join('');
    };

    const buildUploadBadge = (entry) => {
      switch (entry.uploadStatus) {
        case 'success':
          return '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold bg-green-100 text-green-700 rounded-full">Enviado</span>';
        case 'error':
          return '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold bg-red-100 text-red-700 rounded-full">Falha</span>';
        case 'uploading':
          return '<span class="inline-flex items-center px-2 py-1 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">Enviando...</span>';
        default:
          return '';
      }
    };

    const renderMatchedList = () => {
      const entries = getMatchedEntries();

      if (!entries.length) {
        matchedList.innerHTML = '<p class="text-sm text-gray-500">Nenhuma imagem foi vinculada a produtos ainda.</p>';
        matchedCount.textContent = '0 itens';
        return;
      }

      matchedCount.textContent = `${entries.length} ${entries.length === 1 ? 'item' : 'itens'}`;

      const cards = entries.map((entry) => {
        const product = entry.product || {};
        const productName = product.nome || product.descricao || product.name || 'Produto sem nome';
        const productCode = product.codigoInterno || product.codigo || product.sku || '';
        const barcode = product.codigoBarras || product.codigoDeBarras || product.codbarras || product.ean || '';
        const badge = buildUploadBadge(entry);
        const extraCodes = [
          productCode ? `Cód.: ${escapeHtml(productCode)}` : null,
          barcode ? `EAN: ${escapeHtml(barcode)}` : null
        ].filter(Boolean).join(' • ');
        const sequenceInfo = Number.isInteger(entry.sequence)
          ? `<p class="text-xs text-gray-500 mt-1">Sequência: ${entry.sequence}</p>`
          : '';
        const sharedInfo = entry.multiTarget
          ? `<p class="text-xs text-gray-500 mt-1">Imagem compartilhada (${entry.targetIndex} de ${entry.targetTotal})</p>`
          : '';

        return `
          <div class="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-gray-800">${escapeHtml(productName)}</p>
                <p class="text-xs text-gray-500 mt-1">Arquivo: ${escapeHtml(entry.file.name)}</p>
                ${sequenceInfo}
                ${sharedInfo}
                ${extraCodes ? `<p class="text-xs text-gray-500 mt-1">${extraCodes}</p>` : ''}
              </div>
              ${badge}
            </div>
          </div>
        `;
      }).join('');

      matchedList.innerHTML = cards;
    };

    const renderUnmatchedList = () => {
      const entries = getUnmatchedEntries();

      if (!entries.length) {
        unmatchedList.innerHTML = '<p class="text-sm text-gray-500">Tudo pronto! Nenhum arquivo pendente.</p>';
        unmatchedCount.textContent = '0 itens';
        return;
      }

      unmatchedCount.textContent = `${entries.length} ${entries.length === 1 ? 'item' : 'itens'}`;

      const cards = entries.map((entry) => {
        const sequenceInfo = Number.isInteger(entry.sequence)
          ? `<p class="text-xs text-red-600 mt-1">Sequência: ${entry.sequence}</p>`
          : '';
        const barcodeInfo = entry.barcodeRaw
          ? `<p class="text-xs text-red-600 mt-1">Código informado: ${escapeHtml(entry.barcodeRaw)}</p>`
          : '';
        const sharedInfo = entry.multiTarget
          ? `<p class="text-xs text-red-600 mt-1">Associação ${entry.targetIndex} de ${entry.targetTotal}</p>`
          : '';

        return `
          <div class="border border-red-200 rounded-lg p-4 bg-white shadow-sm">
            <p class="text-sm font-semibold text-red-700">${escapeHtml(entry.file.name)}</p>
            <p class="text-xs text-red-600 mt-1">${escapeHtml(entry.message || 'Não foi possível vincular esta imagem.')}</p>
            ${barcodeInfo}
            ${sequenceInfo}
            ${sharedInfo}
          </div>
        `;
      }).join('');

      unmatchedList.innerHTML = cards;
    };

    const refreshPreview = () => {
      renderSummary();
      renderMatchedList();
      renderUnmatchedList();
      updateControls();
    };

    const updateControls = () => {
      const hasMatched = getMatchedEntries().length > 0;
      startUploadBtn.disabled = state.isProcessing || state.isUploading || !hasMatched;
    };

    const resetState = () => {
      state.entries = [];
      state.isProcessing = false;
      state.isUploading = false;
      state.productCache.clear();
    };

    const extractProductId = (product) => product?._id || product?.id || product?.productId || null;

    const collectProductsFromResponse = (data) => {
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.docs)) return data.docs;
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.results)) return data.results;
      if (Array.isArray(data.data)) return data.data;
      const firstArray = Object.values(data).find((value) => Array.isArray(value));
      return Array.isArray(firstArray) ? firstArray : [];
    };

    const findProductForBarcode = async (parsed) => {
      if (!parsed.normalizedBarcode) {
        return { product: null, error: 'Código de barras inválido.' };
      }

      if (state.productCache.has(parsed.normalizedBarcode)) {
        return state.productCache.get(parsed.normalizedBarcode);
      }

      const searchParams = new URLSearchParams({
        search: parsed.barcodeRaw,
        limit: '25'
      });

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/products?${searchParams.toString()}`);
        if (!response.ok) {
          throw new Error(`Resposta ${response.status} ao consultar produtos.`);
        }

        let payload = null;
        try {
          payload = await response.json();
        } catch (parseError) {
          throw new Error('Não foi possível interpretar a resposta do servidor.');
        }

        const items = collectProductsFromResponse(payload);
        const normalized = parsed.normalizedBarcode;
        const match = items.find((product) => {
          const candidates = [
            product?.codigoBarras,
            product?.codigoDeBarras,
            product?.codbarras,
            product?.ean,
            product?.barcode
          ].map((value) => normalizeBarcode(value)).filter(Boolean);
          return candidates.includes(normalized);
        }) || items[0] || null;

        const result = { product: match, error: null };
        state.productCache.set(parsed.normalizedBarcode, result);
        return result;
      } catch (error) {
        const result = { product: null, error: error.message };
        state.productCache.set(parsed.normalizedBarcode, result);
        return result;
      }
    };

    const handleFolderChange = async () => {
      const files = Array.from(folderInput.files || []);
      resetState();
      clearLog();

      if (!files.length) {
        if (folderInfo) folderInfo.textContent = 'Nenhuma pasta selecionada.';
        refreshPreview();
        return;
      }

      const imageFiles = files.filter((file) => imageMimePattern.test(file.type) || /\.(jpe?g|png|gif|bmp|webp)$/i.test(file.name));
      const nonImageCount = files.length - imageFiles.length;

      if (folderInfo) {
        const first = imageFiles[0] || files[0];
        const relativePath = first.webkitRelativePath || first.name;
        const folderName = relativePath.includes('/') ? relativePath.split('/')[0] : 'Arquivos selecionados';
        folderInfo.textContent = `${imageFiles.length} ${imageFiles.length === 1 ? 'imagem' : 'imagens'} detectadas em "${folderName}".`;
      }

      if (!imageFiles.length) {
        logMessage('Nenhuma imagem foi encontrada na pasta selecionada.', 'warn');
        refreshPreview();
        return;
      }

      if (nonImageCount > 0) {
        logMessage(`${nonImageCount} arquivo(s) não são imagens e foram ignorados.`, 'warn');
      }

      state.isProcessing = true;
      updateControls();
      logMessage(`Processando ${imageFiles.length} imagem(ns)...`, 'info');

      const sortedFiles = imageFiles.sort((a, b) => {
        const pathA = a.webkitRelativePath || a.name;
        const pathB = b.webkitRelativePath || b.name;
        return pathA.localeCompare(pathB, 'pt-BR');
      });

      for (let index = 0; index < sortedFiles.length; index += 1) {
        const file = sortedFiles[index];
        const parsed = parseFileName(file);

        logMessage(`(${index + 1}/${sortedFiles.length}) Lendo ${file.name}`, 'info');

        if (parsed.error) {
          const invalidEntry = {
            id: (typeof crypto !== 'undefined' && crypto.randomUUID)
              ? crypto.randomUUID()
              : `entry-${Date.now()}-${index}`,
            file,
            folderName: parsed.folderName,
            sequence: parsed.sequence,
            barcodeRaw: parsed.barcodeRaw,
            barcodeNormalized: parsed.normalizedBarcode,
            extension: parsed.extension,
            status: 'invalid-name',
            uploadStatus: 'pending',
            message: parsed.error,
            product: null,
            productId: null,
            multiTarget: false,
            targetIndex: 1,
            targetTotal: 1,
            shouldIncludeSequenceInFileName: parsed?.includeSequenceInFileName !== false,
          };
          logMessage(`Arquivo ignorado: ${parsed.error}`, 'warn');
          state.entries.push(invalidEntry);
          refreshPreview();
          continue;
        }

        const barcodeEntries = Array.isArray(parsed.barcodeEntries) && parsed.barcodeEntries.length
          ? parsed.barcodeEntries
          : [{ barcodeRaw: parsed.barcodeRaw, normalizedBarcode: parsed.normalizedBarcode }];
        const multiTarget = barcodeEntries.length > 1;
        const shouldIncludeSequenceInFileName = parsed?.includeSequenceInFileName !== false;

        for (let targetIndex = 0; targetIndex < barcodeEntries.length; targetIndex += 1) {
          const barcodeEntry = barcodeEntries[targetIndex];
          const entryId = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `entry-${Date.now()}-${index}-${targetIndex}`;
          const entry = {
            id: entryId,
            file,
            folderName: parsed.folderName,
            sequence: parsed.sequence,
            barcodeRaw: barcodeEntry?.barcodeRaw,
            barcodeNormalized: barcodeEntry?.normalizedBarcode,
            extension: parsed.extension,
            status: 'pending',
            uploadStatus: 'pending',
            message: '',
            product: null,
            productId: null,
            multiTarget,
            targetIndex: targetIndex + 1,
            targetTotal: barcodeEntries.length,
            shouldIncludeSequenceInFileName,
          };

          if (multiTarget) {
            logMessage(`  Associação ${entry.targetIndex}/${entry.targetTotal}: código ${barcodeEntry?.barcodeRaw || '(vazio)'}`, 'info');
          }

          if (!entry.barcodeNormalized) {
            entry.status = 'invalid-barcode';
            entry.message = 'Não foi possível extrair o código de barras do arquivo.';
            logMessage(`Arquivo ignorado: ${file.name} sem código de barras válido.`, 'warn');
            state.entries.push(entry);
            refreshPreview();
            continue;
          }

          const lookup = await findProductForBarcode({
            barcodeRaw: entry.barcodeRaw,
            normalizedBarcode: entry.barcodeNormalized,
          });

          if (lookup.error) {
            entry.status = 'lookup-error';
            entry.message = lookup.error;
            logMessage(`Falha ao buscar produto para ${entry.barcodeRaw}: ${lookup.error}`, 'error');
            state.entries.push(entry);
            refreshPreview();
            continue;
          }

          const product = lookup.product;
          const productId = extractProductId(product);

          if (!product || !productId) {
            entry.status = 'not-found';
            entry.message = 'Nenhum produto correspondente foi encontrado.';
            logMessage(`Nenhum produto encontrado para ${entry.barcodeRaw}.`, 'warn');
            state.entries.push(entry);
            refreshPreview();
            continue;
          }

          entry.status = 'matched';
          entry.product = product;
          entry.productId = productId;
          entry.message = 'Produto identificado.';
          const logSuffix = multiTarget
            ? ` (associação ${entry.targetIndex}/${entry.targetTotal})`
            : '';
          logMessage(`Produto identificado: ${product?.nome || product?.descricao || productId} para ${file.name}${logSuffix}.`, 'success');

          state.entries.push(entry);
          refreshPreview();
        }
      }

      state.isProcessing = false;
      refreshPreview();
      logMessage('Processamento concluído.', 'success');
    };

    const startUpload = async () => {
      if (state.isProcessing || state.isUploading) {
        return;
      }

      const matchedEntries = getMatchedEntries();
      if (!matchedEntries.length) {
        logMessage('Nenhuma imagem pronta para envio.', 'warn');
        window.showModal?.({
          title: 'Atenção',
          message: 'Selecione uma pasta com imagens válidas antes de iniciar o envio.',
          confirmText: 'Entendi'
        });
        return;
      }

      const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
      const token = loggedInUser?.token;

      if (!token) {
        logMessage('Envio cancelado: token de autenticação não encontrado.', 'error');
        window.showModal?.({
          title: 'Sessão expirada',
          message: 'Faça login novamente para enviar as imagens.',
          confirmText: 'OK'
        });
        return;
      }

      state.isUploading = true;
      updateControls();
      folderInput.disabled = true;
      logMessage(`Iniciando envio de ${matchedEntries.length} imagem(ns).`, 'info');

      let successCount = 0;
      let failureCount = 0;
      let cancelled = false;

      for (let index = 0; index < matchedEntries.length; index += 1) {
        const entry = matchedEntries[index];
        entry.uploadStatus = 'uploading';
        refreshPreview();

        const hasSequence = Number.isInteger(entry.sequence);
        const includeSequence = entry.shouldIncludeSequenceInFileName && hasSequence;
        const sanitizedBaseName = [entry.barcodeRaw, includeSequence ? entry.sequence : null]
          .filter((part) => part !== null && part !== undefined && String(part).length > 0)
          .join('-') || entry.barcodeNormalized || 'imagem';
        const sanitizedName = `${sanitizedBaseName}${entry.extension || ''}`;
        const formData = new FormData();
        const fileToSend = (typeof File === 'function')
          ? new File([entry.file], sanitizedName, { type: entry.file.type })
          : entry.file;

        formData.append('imagens', fileToSend, sanitizedName);
        formData.append('codigoBarras', entry.barcodeRaw || '');
        formData.append('sequencia', String(entry.sequence ?? ''));
        formData.append('nomeOriginal', entry.file.name);

        try {
          const response = await fetch(`${API_CONFIG.BASE_URL}/products/${entry.productId}/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData,
          });

          if (response.status === 401 || response.status === 403) {
            entry.uploadStatus = 'error';
            failureCount += 1;
            logMessage(`Envio interrompido: autorização necessária para ${entry.file.name}.`, 'error');
            window.showModal?.({
              title: 'Sessão expirada',
              message: 'Faça login novamente para continuar o envio das imagens.',
              confirmText: 'OK'
            });
            cancelled = true;
            refreshPreview();
            break;
          }

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            entry.uploadStatus = 'error';
            failureCount += 1;
            logMessage(`Falha ao enviar ${entry.file.name}: resposta ${response.status} ${response.statusText}.`, 'error');
            if (errorText) {
              logMessage(`Detalhes: ${errorText.substring(0, 500)}`, 'error');
            }
            refreshPreview();
            continue;
          }

          entry.uploadStatus = 'success';
          successCount += 1;
          logMessage(`Imagem ${entry.file.name} enviada com sucesso.`, 'success');
        } catch (error) {
          entry.uploadStatus = 'error';
          failureCount += 1;
          logMessage(`Erro inesperado ao enviar ${entry.file.name}: ${error.message}`, 'error');
        }

        refreshPreview();
      }

      state.isUploading = false;
      folderInput.disabled = false;
      updateControls();

      if (!cancelled) {
        const statusType = failureCount > 0 ? 'warn' : 'success';
        logMessage(`Envio concluído. Sucesso: ${successCount}. Falhas: ${failureCount}.`, statusType);
        window.showModal?.({
          title: failureCount > 0 ? 'Envio finalizado com alertas' : 'Envio concluído',
          message: failureCount > 0
            ? `Algumas imagens não foram enviadas. Sucesso: ${successCount}. Falhas: ${failureCount}. Consulte o console para detalhes.`
            : `Todas as ${successCount} imagem(ns) foram enviadas com sucesso!`,
          confirmText: 'OK'
        });
      }
    };

    folderInput.addEventListener('change', () => {
      handleFolderChange().catch((error) => {
        logMessage(`Erro inesperado: ${error.message}`, 'error');
        state.isProcessing = false;
        refreshPreview();
      });
    });

    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', (event) => {
        event.preventDefault();
        clearLog();
      });
    }

    startUploadBtn.addEventListener('click', (event) => {
      event.preventDefault();
      startUpload().catch((error) => {
        logMessage(`Erro inesperado durante o envio: ${error.message}`, 'error');
        state.isUploading = false;
        folderInput.disabled = false;
        updateControls();
      });
    });

    refreshPreview();
  });
})();
