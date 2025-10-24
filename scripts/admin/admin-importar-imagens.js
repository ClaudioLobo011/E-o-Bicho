(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const folderInput = document.getElementById('folder-input');
    const folderInfo = document.getElementById('folder-info');
    const startUploadBtn = document.getElementById('start-upload-btn');
    const logContainer = document.getElementById('log-container');
    const clearLogBtn = document.getElementById('clear-log-btn');
    const summaryTotal = document.getElementById('summary-total');
    const summaryMatched = document.getElementById('summary-matched');
    const summaryPending = document.getElementById('summary-pending');
    const summaryErrors = document.getElementById('summary-errors');
    const entriesTable = document.getElementById('entries-table');
    const tableHelper = document.getElementById('table-helper');

    if (!folderInput || !startUploadBtn || !logContainer || !entriesTable) {
      console.warn('Elementos essenciais da página de importação não foram encontrados.');
      return;
    }

    const state = {
      entries: [],
      productCache: new Map(),
      isProcessing: false,
      isUploading: false,
    };

    const imagePattern = /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i;

    const logMessage = (message, type = 'info') => {
      const prefixMap = {
        info: '[INFO]',
        success: '[SUCESSO]',
        error: '[ERRO]',
        warn: '[AVISO]'
      };
      const prefix = prefixMap[type] || prefixMap.info;
      const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
      logContainer.textContent += `${timestamp} ${prefix} ${message}\n`;
      logContainer.scrollTop = logContainer.scrollHeight;
    };

    const clearLog = () => {
      logContainer.textContent = '';
    };

    const normalizeBarcode = (value) => String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^0-9A-Za-z]/g, '')
      .trim();

    const hasValidDigits = (value) => /\d{6,}/.test(String(value ?? ''));

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

    const renderSummary = () => {
      const total = state.entries.length;
      const matched = state.entries.filter((entry) => entry.status === 'matched' || entry.status === 'uploaded').length;
      const pending = state.entries.filter((entry) => entry.status === 'pending' || entry.status === 'uploading').length;
      const errors = state.entries.filter((entry) => ['error', 'not-found', 'lookup-error'].includes(entry.status)).length;

      if (summaryTotal) summaryTotal.textContent = `${total} ${total === 1 ? 'arquivo' : 'arquivos'}`;
      if (summaryMatched) summaryMatched.textContent = `${matched} ${matched === 1 ? 'pronto' : 'prontos'}`;
      if (summaryPending) summaryPending.textContent = `${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`;
      if (summaryErrors) summaryErrors.textContent = `${errors} ${errors === 1 ? 'erro' : 'erros'}`;
    };

    const describeStatus = (entry) => {
      switch (entry.status) {
        case 'pending': return 'Aguardando análise';
        case 'matched': return 'Pronto para envio';
        case 'uploaded': return 'Enviado';
        case 'uploading': return 'Enviando...';
        case 'not-found': return 'Produto não encontrado';
        case 'lookup-error': return 'Erro ao buscar produto';
        case 'error': default: return 'Erro';
      }
    };

    const renderTable = () => {
      if (!state.entries.length) {
        entriesTable.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-gray-500">Nenhum arquivo processado.</td></tr>';
        if (tableHelper) {
          tableHelper.textContent = 'Nenhum arquivo foi carregado.';
        }
        return;
      }

      const rows = state.entries.map((entry) => {
        const productName = entry.product?.nome || entry.product?.descricao || entry.productId || '--';
        const statusText = describeStatus(entry);
        const statusClass = {
          pending: 'text-amber-600',
          matched: 'text-emerald-600',
          uploaded: 'text-emerald-700 font-semibold',
          uploading: 'text-sky-600',
          'not-found': 'text-rose-600',
          'lookup-error': 'text-rose-600',
          error: 'text-rose-700 font-semibold'
        }[entry.status] || 'text-gray-600';

        const message = entry.message || '';

        return `
          <tr>
            <td class="px-4 py-2 text-gray-700">${entry.file?.name || '--'}</td>
            <td class="px-4 py-2 text-gray-600">${entry.barcodeRaw || '--'}</td>
            <td class="px-4 py-2 text-gray-600">${productName}</td>
            <td class="px-4 py-2 ${statusClass}">${statusText}</td>
            <td class="px-4 py-2 text-gray-500">${message}</td>
          </tr>
        `;
      }).join('');

      entriesTable.innerHTML = rows;
      if (tableHelper) {
        tableHelper.textContent = `${state.entries.length} arquivo(s) processado(s).`;
      }
    };

    const updateControls = () => {
      const hasReadyEntries = state.entries.some((entry) => entry.status === 'matched');
      startUploadBtn.disabled = state.isProcessing || state.isUploading || !hasReadyEntries;
      if (folderInput) {
        folderInput.disabled = state.isUploading;
      }
    };

    const parseFileInfo = (file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const segments = relativePath.split('/');
      const fileName = segments[segments.length - 1] || file.name;
      const folderName = segments.length > 1 ? segments[segments.length - 2] : '';
      const extensionIndex = fileName.lastIndexOf('.');
      const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : '';
      const baseName = extensionIndex >= 0 ? fileName.slice(0, extensionIndex) : fileName;
      const sequenceMatch = baseName.match(/-(\d{1,4})$/);
      const sequence = sequenceMatch ? Number.parseInt(sequenceMatch[1], 10) : null;
      const barcodePart = sequenceMatch ? baseName.slice(0, -sequenceMatch[0].length) : baseName;
      const trimmedBarcode = barcodePart.trim();
      const normalizedBarcode = normalizeBarcode(trimmedBarcode);

      return {
        relativePath,
        relativePathSegments: segments.slice(0, -1),
        folderName,
        extension,
        barcodeRaw: trimmedBarcode,
        normalizedBarcode,
        sequence,
      };
    };

    const extractProductId = (product) => product?._id || product?.id || product?.productId || null;

    const findProductForBarcode = async (entry) => {
      const cacheKey = entry.barcodeNormalized;
      if (!cacheKey || !hasValidDigits(cacheKey)) {
        return { product: null, error: 'Código de barras inválido.' };
      }

      if (state.productCache.has(cacheKey)) {
        return state.productCache.get(cacheKey);
      }

      const searchParams = new URLSearchParams({
        search: entry.barcodeRaw || entry.barcodeNormalized,
        limit: '25',
      });

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/products?${searchParams.toString()}`);
        if (!response.ok) {
          throw new Error(`Resposta ${response.status} da API.`);
        }
        const payload = await response.json();
        const items = collectProductsFromResponse(payload);
        const normalized = entry.barcodeNormalized;
        const product = items.find((item) => {
          const candidates = [
            item?.codigoBarras,
            item?.codigoDeBarras,
            item?.codbarras,
            item?.ean,
            item?.barcode,
          ].map((value) => normalizeBarcode(value)).filter(Boolean);
          return candidates.includes(normalized);
        }) || items[0] || null;

        const result = { product, error: null };
        state.productCache.set(cacheKey, result);
        return result;
      } catch (error) {
        const result = { product: null, error: error.message || 'Falha ao consultar produto.' };
        state.productCache.set(cacheKey, result);
        return result;
      }
    };

    const resetState = () => {
      state.entries = [];
      state.productCache.clear();
      state.isProcessing = false;
      state.isUploading = false;
    };

    const handleSelection = async (files) => {
      if (state.isUploading) {
        logMessage('Aguarde o término do envio atual antes de selecionar novos arquivos.', 'warn');
        return;
      }

      resetState();
      clearLog();
      renderSummary();
      renderTable();
      updateControls();

      if (!files.length) {
        if (folderInfo) {
          folderInfo.textContent = 'Nenhuma pasta selecionada.';
        }
        return;
      }

      const imageFiles = files.filter((file) => imagePattern.test(file.name) || file.type.startsWith('image/'));
      if (!imageFiles.length) {
        logMessage('Nenhuma imagem encontrada na pasta selecionada.', 'warn');
        if (folderInfo) {
          folderInfo.textContent = 'A pasta selecionada não contém imagens reconhecidas.';
        }
        return;
      }

      const firstFile = imageFiles[0];
      const relativePath = firstFile.webkitRelativePath || firstFile.name;
      const folderName = relativePath.includes('/') ? relativePath.split('/')[0] : 'Arquivos selecionados';
      if (folderInfo) {
        folderInfo.textContent = `${imageFiles.length} ${imageFiles.length === 1 ? 'imagem' : 'imagens'} detectadas em "${folderName}".`;
      }

      state.isProcessing = true;
      updateControls();
      logMessage(`Processando ${imageFiles.length} arquivo(s) de imagem...`, 'info');

      const sortedFiles = imageFiles.sort((a, b) => {
        const pathA = a.webkitRelativePath || a.name;
        const pathB = b.webkitRelativePath || b.name;
        return pathA.localeCompare(pathB, 'pt-BR');
      });

      sortedFiles.forEach((file, index) => {
        const parsed = parseFileInfo(file);
        const entry = {
          id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `entry-${Date.now()}-${index}`,
          file,
          fileName: file.name,
          folderName: parsed.folderName,
          relativePath: parsed.relativePath,
          relativePathSegments: parsed.relativePathSegments,
          barcodeRaw: parsed.barcodeRaw,
          barcodeNormalized: parsed.normalizedBarcode,
          sequence: parsed.sequence,
          extension: parsed.extension,
          status: 'pending',
          message: '',
          product: null,
          productId: null,
        };

        if (!hasValidDigits(parsed.normalizedBarcode)) {
          entry.status = 'error';
          entry.message = 'Nome do arquivo não contém código de barras válido.';
        }

        state.entries.push(entry);
      });

      renderSummary();
      renderTable();

      for (const entry of state.entries) {
        if (entry.status !== 'pending') {
          continue;
        }

        logMessage(`Buscando produto para ${entry.fileName} (${entry.barcodeRaw || 'sem código'})...`, 'info');
        const lookup = await findProductForBarcode(entry);
        if (lookup.error) {
          entry.status = 'lookup-error';
          entry.message = lookup.error;
          logMessage(`Erro na consulta de produto para ${entry.fileName}: ${lookup.error}`, 'error');
        } else if (!lookup.product) {
          entry.status = 'not-found';
          entry.message = 'Produto não encontrado.';
          logMessage(`Produto não encontrado para ${entry.fileName}.`, 'warn');
        } else {
          const productId = extractProductId(lookup.product);
          if (!productId) {
            entry.status = 'lookup-error';
            entry.message = 'Resposta sem identificador de produto.';
            logMessage(`Produto sem identificador válido para ${entry.fileName}.`, 'error');
          } else {
            entry.status = 'matched';
            entry.product = lookup.product;
            entry.productId = productId;
            entry.message = 'Produto identificado.';
            logMessage(`Produto associado: ${lookup.product?.nome || productId} <- ${entry.fileName}.`, 'success');
          }
        }

        renderSummary();
        renderTable();
        updateControls();
      }

      state.isProcessing = false;
      updateControls();
      logMessage('Processamento concluído.', 'success');
    };

    const startUpload = async () => {
      if (state.isProcessing || state.isUploading) {
        return;
      }

      const readyEntries = state.entries.filter((entry) => entry.status === 'matched');
      if (!readyEntries.length) {
        logMessage('Nenhum arquivo pronto para envio.', 'warn');
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
        logMessage('Envio cancelado: sessão expirada ou inválida.', 'error');
        window.showModal?.({
          title: 'Sessão expirada',
          message: 'Faça login novamente para continuar o envio das imagens.',
          confirmText: 'OK'
        });
        return;
      }

      state.isUploading = true;
      updateControls();
      logMessage(`Iniciando envio de ${readyEntries.length} imagem(ns)...`, 'info');

      let successCount = 0;
      let failureCount = 0;

      for (const entry of readyEntries) {
        entry.status = 'uploading';
        entry.message = 'Enviando...';
        renderTable();
        renderSummary();

        try {
          const includeSequence = Number.isInteger(entry.sequence);
          const baseName = [entry.barcodeRaw, includeSequence ? entry.sequence : null]
            .filter((part) => part !== null && part !== undefined && String(part).length > 0)
            .join('-') || entry.barcodeNormalized || 'imagem';
          const sanitizedName = `${baseName}${entry.extension || ''}`;

          const formData = new FormData();
          const fileToSend = (typeof File === 'function' && entry.file instanceof Blob)
            ? new File([entry.file], sanitizedName, { type: entry.file.type || 'application/octet-stream' })
            : entry.file;

          if (!(fileToSend instanceof Blob)) {
            throw new Error('Arquivo inválido para upload.');
          }

          formData.append('imagens', fileToSend, sanitizedName);
          formData.append('codigoBarras', entry.barcodeRaw || '');
          formData.append('sequencia', String(entry.sequence ?? ''));
          formData.append('nomeOriginal', entry.file?.name || sanitizedName);
          formData.append('folderName', entry.folderName || '');
          formData.append('relativePath', entry.relativePath || '');
          try {
            formData.append('driveFolderSegments', JSON.stringify(entry.relativePathSegments || []));
          } catch (error) {
            console.warn('Não foi possível serializar as pastas relativas.', error);
          }

          const response = await fetch(`${API_CONFIG.BASE_URL}/products/${entry.productId}/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
            body: formData,
          });

          if (response.status === 401 || response.status === 403) {
            throw new Error('Sessão expirada. Faça login novamente.');
          }

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(errorText || `Falha no envio (${response.status}).`);
          }

          entry.status = 'uploaded';
          entry.message = 'Imagem enviada com sucesso.';
          successCount += 1;
          logMessage(`Upload concluído: ${entry.file?.name} -> ${sanitizedName}.`, 'success');
        } catch (error) {
          entry.status = 'error';
          entry.message = error.message || 'Erro desconhecido durante o envio.';
          failureCount += 1;
          logMessage(`Erro ao enviar ${entry.file?.name}: ${entry.message}`, 'error');
        }

        renderTable();
        renderSummary();
      }

      state.isUploading = false;
      updateControls();

      const resumeParts = [];
      if (successCount) resumeParts.push(`${successCount} enviado(s) com sucesso`);
      if (failureCount) resumeParts.push(`${failureCount} falha(s)`);
      const resumeText = resumeParts.length ? resumeParts.join(' e ') : 'nenhum arquivo foi processado';
      logMessage(`Envio finalizado: ${resumeText}.`, failureCount ? 'warn' : 'success');
    };

    folderInput.addEventListener('change', (event) => {
      const files = Array.from(event.target.files || []);
      handleSelection(files);
    });

    startUploadBtn.addEventListener('click', startUpload);
    clearLogBtn?.addEventListener('click', clearLog);

    renderSummary();
    renderTable();
    updateControls();
  });
})();
