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
      suppressNextFolderChange: false,
      ignoreNextEmptySelection: false,
      productCache: new Map(),
      lastSelectionSignature: '',
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
      const pathSegments = segments
        .slice(0, -1)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      const folderName = pathSegments.length ? pathSegments[pathSegments.length - 1] : '';
      const lastDot = fileName.lastIndexOf('.');
      const extension = lastDot >= 0 ? fileName.slice(lastDot) : '';
      const baseName = lastDot >= 0 ? fileName.slice(0, lastDot) : fileName;
      const trimmedBaseName = baseName.trim();
      const legacyMatch = trimmedBaseName.match(/^(.*?)-(\d{1,4})$/);
      const buildLegacyResult = () => {
        const barcodeRaw = legacyMatch[1]?.trim();
        const sequencePart = legacyMatch[2]?.trim();
        const sequence = Number.parseInt(sequencePart, 10);

        if (!barcodeRaw) {
          return {
            folderName,
            pathSegments,
            relativePath: pathSegments.join('/'),
            fileName,
            extension,
            error: 'Código de barras ausente no nome do arquivo.'
          };
        }

        if (!Number.isInteger(sequence)) {
          return {
            folderName,
            pathSegments,
            relativePath: pathSegments.join('/'),
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
            pathSegments,
            relativePath: pathSegments.join('/'),
            fileName,
            extension,
            barcodeRaw,
            error: 'Nenhum código de barras válido foi identificado no nome do arquivo.'
          };
        }

        return {
          folderName,
          pathSegments,
          relativePath: pathSegments.join('/'),
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
        const numericPattern = /\d+/g;
        const matches = [];
        let match;

        while ((match = numericPattern.exec(baseName)) !== null) {
          matches.push({
            raw: match[0],
            index: match.index,
            preceding: match.index > 0 ? baseName[match.index - 1] : '',
            following: match.index + match[0].length < baseName.length
              ? baseName[match.index + match[0].length]
              : '',
          });
        }

        const barcodeMatches = [];
        const seen = new Set();

        matches.forEach((item) => {
          const normalizedBarcode = normalizeBarcode(item.raw);
          if (!hasValidDigits(normalizedBarcode)) {
            return;
          }

          if (seen.has(normalizedBarcode)) {
            return;
          }

          seen.add(normalizedBarcode);
          barcodeMatches.push({ ...item, normalizedBarcode });
        });

        if (!barcodeMatches.length) {
          return {
            folderName,
            pathSegments,
            relativePath: pathSegments.join('/'),
            fileName,
            extension,
            error: 'Nenhum código de barras foi identificado no nome do arquivo.'
          };
        }

        const firstBarcodeIndex = barcodeMatches[0].index;
        const sequenceCandidate = matches.find((item) => {
          if (item.index >= firstBarcodeIndex) {
            return false;
          }

          if (item.raw.length === 0 || item.raw.length > 2) {
            return false;
          }

          if (item.preceding && /[0-9.]/.test(item.preceding)) {
            return false;
          }

          if (item.following && /[0-9.]/.test(item.following)) {
            return false;
          }

          return true;
        });

        const sequence = sequenceCandidate ? Number.parseInt(sequenceCandidate.raw, 10) : null;

        const barcodeEntries = barcodeMatches.map((item) => ({
          barcodeRaw: item.raw,
          normalizedBarcode: item.normalizedBarcode,
        }));

        return {
          folderName,
          pathSegments,
          relativePath: pathSegments.join('/'),
          fileName,
          extension,
          barcodeRaw: barcodeEntries[0].barcodeRaw,
          normalizedBarcode: barcodeEntries[0].normalizedBarcode,
          sequence,
          barcodeEntries,
          format: 'multi-barcode',
          includeSequenceInFileName: Number.isInteger(sequence),
        };
      };

      if (legacyMatch) {
        return buildLegacyResult();
      }

      return buildMultiBarcodeResult();
    };

    const computeSelectionSignature = (files) => {
      if (!Array.isArray(files) || !files.length) {
        return '';
      }

      return files
        .map((file) => (file?.webkitRelativePath || file?.name || '').trim())
        .filter((value) => value.length > 0)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .join('||');
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

      const grouped = new Map();

      entries.forEach((entry) => {
        const key = entry.productId
          || entry.product?._id
          || entry.product?.id
          || `produto-${entry.barcodeNormalized || entry.barcodeRaw || entry.file.name}`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            product: entry.product || {},
            items: [],
          });
        }

        grouped.get(key).items.push(entry);
      });

      const groups = Array.from(grouped.values()).sort((a, b) => {
        const nameA = (a.product?.nome || a.product?.descricao || a.product?.name || '').toLocaleLowerCase('pt-BR');
        const nameB = (b.product?.nome || b.product?.descricao || b.product?.name || '').toLocaleLowerCase('pt-BR');
        return nameA.localeCompare(nameB, 'pt-BR');
      });

      matchedCount.textContent = `${groups.length} ${groups.length === 1 ? 'produto' : 'produtos'}`;

      const cards = groups.map((group) => {
        const product = group.product || {};
        const productName = product.nome || product.descricao || product.name || 'Produto sem nome';
        const productCode = product.codigoInterno || product.codigo || product.sku || '';
        const barcode = product.codigoBarras || product.codigoDeBarras || product.codbarras || product.ean || '';
        const extraCodes = [
          productCode ? `Cód.: ${escapeHtml(productCode)}` : null,
          barcode ? `EAN: ${escapeHtml(barcode)}` : null
        ].filter(Boolean).join(' • ');

        const items = group.items.slice().sort((a, b) => {
          const hasSeqA = Number.isInteger(a.sequence);
          const hasSeqB = Number.isInteger(b.sequence);

          if (hasSeqA && hasSeqB && a.sequence !== b.sequence) {
            return a.sequence - b.sequence;
          }

          if (hasSeqA && !hasSeqB) return -1;
          if (!hasSeqA && hasSeqB) return 1;

          const nameA = a.file?.name || '';
          const nameB = b.file?.name || '';
          return nameA.localeCompare(nameB, 'pt-BR');
        });

        const fileLines = items.map((item) => {
          const badge = buildUploadBadge(item);
          const sequenceInfo = Number.isInteger(item.sequence)
            ? `<span class="text-xs text-gray-500 block">Sequência ${item.sequence}</span>`
            : '';
          const sharedInfo = item.multiTarget
            ? `<span class="text-xs text-gray-400 block">Associação ${item.targetIndex} de ${item.targetTotal}</span>`
            : '';
          const renamedInfo = item.generatedFileName
            ? `<span class="text-xs text-gray-500 break-all block">Renomeado: ${escapeHtml(item.generatedFileName)}</span>`
            : '';
          const uploadedInfo = item.uploadedImageUrl
            ? `<span class="text-xs text-gray-500 break-all block">URL salva: ${escapeHtml(item.uploadedImageUrl)}</span>`
            : '';
          const metaPieces = [sequenceInfo, sharedInfo, renamedInfo, uploadedInfo].filter(Boolean).join('');
          const metaInfo = metaPieces
            ? `<div class="mt-1 flex flex-col gap-1">${metaPieces}</div>`
            : '';

          return `
            <li class="flex items-start justify-between gap-3 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
              <div>
                <p class="text-xs font-medium text-gray-700">${escapeHtml(item.file?.name || 'Arquivo')}</p>
                ${metaInfo || ''}
              </div>
              ${badge}
            </li>
          `;
        }).join('');

        return `
          <div class="border border-gray-200 rounded-lg p-4 bg-white shadow-sm space-y-3">
            <div>
              <p class="text-sm font-semibold text-gray-800">${escapeHtml(productName)}</p>
              ${extraCodes ? `<p class="text-xs text-gray-500 mt-1">${extraCodes}</p>` : ''}
            </div>
            <ul class="space-y-2">${fileLines}</ul>
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

      const grouped = new Map();

      entries.forEach((entry) => {
        const key = entry.file?.webkitRelativePath || entry.file?.name || entry.id;
        if (!grouped.has(key)) {
          grouped.set(key, {
            file: entry.file,
            items: [],
          });
        }

        grouped.get(key).items.push(entry);
      });

      const groups = Array.from(grouped.values()).sort((a, b) => {
        const nameA = (a.file?.webkitRelativePath || a.file?.name || '').toLocaleLowerCase('pt-BR');
        const nameB = (b.file?.webkitRelativePath || b.file?.name || '').toLocaleLowerCase('pt-BR');
        return nameA.localeCompare(nameB, 'pt-BR');
      });

      unmatchedCount.textContent = `${groups.length} ${groups.length === 1 ? 'arquivo' : 'arquivos'}`;

      const cards = groups.map((group) => {
        const fileName = group.file?.webkitRelativePath || group.file?.name || 'Arquivo não identificado';
        const issues = group.items.map((item) => {
          const highlights = [];
          if (item.barcodeRaw) {
            highlights.push(`<span class="font-semibold">Código: ${escapeHtml(item.barcodeRaw)}</span>`);
          }
          if (Number.isInteger(item.sequence)) {
            highlights.push(`<span>Sequência ${item.sequence}</span>`);
          }
          if (item.multiTarget) {
            highlights.push(`<span>Associação ${item.targetIndex} de ${item.targetTotal}</span>`);
          }

          const detail = highlights.length
            ? `<div class="flex flex-wrap gap-x-2 gap-y-1 text-xs text-red-600">${highlights.join(' • ')}</div>`
            : '';

          return `
            <li class="border-l-2 border-red-300 pl-3">
              ${detail}
              <p class="text-xs text-red-500 mt-1">${escapeHtml(item.message || 'Não foi possível vincular esta imagem.')}</p>
            </li>
          `;
        }).join('');

        return `
          <div class="border border-red-200 rounded-lg p-4 bg-white shadow-sm space-y-2">
            <p class="text-sm font-semibold text-red-700">${escapeHtml(fileName)}</p>
            <ul class="space-y-2">${issues}</ul>
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
      state.lastSelectionSignature = '';
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

    const handleFolderChange = async (selectedFiles, options = {}) => {
      const {
        keepPreviousSelectionOnEmpty = false,
      } = options;
      if (state.isUploading) {
        logMessage('Aguarde o término do envio antes de selecionar outra pasta.', 'warn');
        return;
      }

      let files = [];
      if (Array.isArray(selectedFiles)) {
        files = selectedFiles.slice();
      } else if (selectedFiles) {
        files = Array.from(selectedFiles);
      } else if (folderInput?.files) {
        files = Array.from(folderInput.files);
      }

      const currentSignature = computeSelectionSignature(files);

      if (state.suppressNextFolderChange) {
        const isSameSelection = currentSignature && currentSignature === state.lastSelectionSignature;
        state.suppressNextFolderChange = false;

        if (!files.length) {
          state.ignoreNextEmptySelection = false;
          return;
        }

        if (isSameSelection) {
          return;
        }
      }

      if (!files.length) {
        if (state.ignoreNextEmptySelection) {
          state.ignoreNextEmptySelection = false;
          return;
        }
        if (keepPreviousSelectionOnEmpty && state.entries.length) {
          logMessage('Nenhum novo arquivo foi selecionado. Mantendo a seleção atual.', 'info');
          return;
        }
        resetState();
        clearLog();
        if (folderInfo) folderInfo.textContent = 'Nenhuma pasta selecionada.';
        refreshPreview();
        return;
      }

      state.ignoreNextEmptySelection = false;
      const nextSignature = computeSelectionSignature(files);
      resetState();
      state.lastSelectionSignature = nextSignature;
      clearLog();

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
            relativePathSegments: Array.isArray(parsed.pathSegments) ? parsed.pathSegments.slice() : [],
            relativePath: typeof parsed.relativePath === 'string' ? parsed.relativePath : '',
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
            relativePathSegments: Array.isArray(parsed.pathSegments) ? parsed.pathSegments.slice() : [],
            relativePath: typeof parsed.relativePath === 'string' ? parsed.relativePath : '',
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
      if (folderInput) {
        state.suppressNextFolderChange = true;
        state.ignoreNextEmptySelection = true;
        folderInput.disabled = true;
      }
      logMessage(`Iniciando envio de ${matchedEntries.length} imagem(ns).`, 'info');

      let successCount = 0;
      let failureCount = 0;
      let cancelled = false;

      for (let index = 0; index < matchedEntries.length; index += 1) {
        const entry = matchedEntries[index];
        entry.uploadStatus = 'uploading';
        refreshPreview();

        let sanitizedName = '';
        let formData;

        try {
          const hasSequence = Number.isInteger(entry.sequence);
          const includeSequence = entry.shouldIncludeSequenceInFileName && hasSequence;
          const sanitizedBaseName = [entry.barcodeRaw, includeSequence ? entry.sequence : null]
            .filter((part) => part !== null && part !== undefined && String(part).length > 0)
            .join('-') || entry.barcodeNormalized || 'imagem';

          sanitizedName = `${sanitizedBaseName}${entry.extension || ''}`;
          entry.generatedFileName = sanitizedName;

          formData = new FormData();
          let fileToSend = entry.file;

          if (typeof File === 'function' && typeof Blob !== 'undefined' && entry.file instanceof Blob) {
            try {
              fileToSend = new File([entry.file], sanitizedName, { type: entry.file.type || 'application/octet-stream' });
            } catch (fileError) {
              console.warn('Falha ao preparar arquivo renomeado para upload. Enviando arquivo original.', fileError);
              fileToSend = entry.file;
            }
          }

          if (typeof Blob === 'undefined' || !(fileToSend instanceof Blob)) {
            throw new Error('Arquivo de imagem inválido ou ausente.');
          }

          formData.append('imagens', fileToSend, sanitizedName);
          formData.append('codigoBarras', entry.barcodeRaw || '');
          formData.append('sequencia', String(entry.sequence ?? ''));
          formData.append('nomeOriginal', entry.file?.name || sanitizedName);
          formData.append('folderName', entry.folderName || '');
          formData.append('relativePath', entry.relativePath || '');
          const driveSegments = Array.isArray(entry.relativePathSegments) ? entry.relativePathSegments : [];
          try {
            formData.append('driveFolderSegments', JSON.stringify(driveSegments));
          } catch (serializationError) {
            console.warn('Não foi possível serializar as pastas relativas para upload:', serializationError);
          }
          formData.append('multiTarget', entry.multiTarget ? 'true' : 'false');
          formData.append('targetIndex', String(entry.targetIndex ?? ''));
          formData.append('targetTotal', String(entry.targetTotal ?? ''));
        } catch (prepareError) {
          entry.uploadStatus = 'error';
          failureCount += 1;
          const readableName = entry.file?.name || sanitizedName || entry.generatedFileName || 'arquivo';
          logMessage(`Falha ao preparar ${readableName} para envio: ${prepareError.message}`, 'error');
          refreshPreview();
          continue;
        }

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

          let responsePayload = null;
          try {
            responsePayload = await response.json();
          } catch (parseError) {
            responsePayload = null;
          }

          if (responsePayload && typeof responsePayload === 'object') {
            entry.uploadResponse = responsePayload;
            const images = Array.isArray(responsePayload.imagens)
              ? responsePayload.imagens
              : Array.isArray(responsePayload.product?.imagens)
                ? responsePayload.product.imagens
                : null;
            if (images && images.length) {
              entry.uploadedImageUrl = images[images.length - 1];
            }
          }

          entry.uploadStatus = 'success';
          successCount += 1;
          const successDetails = [
            `Imagem ${entry.file.name} enviada com sucesso.`,
            entry.generatedFileName ? `Renomeada para ${entry.generatedFileName}.` : null,
            entry.uploadedImageUrl ? `URL salva: ${entry.uploadedImageUrl}` : null,
          ].filter(Boolean).join(' ');
          logMessage(successDetails, 'success');
        } catch (error) {
          entry.uploadStatus = 'error';
          failureCount += 1;
          const fileName = entry.file?.name || sanitizedName || entry.generatedFileName || 'arquivo';
          logMessage(`Erro inesperado ao enviar ${fileName}: ${error.message}`, 'error');
        }

        refreshPreview();
      }

      state.isUploading = false;
      if (folderInput) {
        folderInput.disabled = false;
      }
      updateControls();

      state.suppressNextFolderChange = false;
      state.ignoreNextEmptySelection = false;

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

    folderInput.addEventListener('change', (event) => {
      const files = folderInput?.files ? Array.from(folderInput.files) : [];

      if (state.isUploading) {
        event?.preventDefault?.();
        logMessage('Seleção de pasta ignorada enquanto o envio está em andamento.', 'warn');
        return;
      }

      const keepPreviousSelection = state.entries.length > 0;
      handleFolderChange(files, { keepPreviousSelectionOnEmpty: keepPreviousSelection }).catch((error) => {
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
        state.suppressNextFolderChange = false;
        state.ignoreNextEmptySelection = false;
        if (folderInput) {
          folderInput.disabled = false;
        }
        updateControls();
      });
    });

    refreshPreview();
  });
})();
