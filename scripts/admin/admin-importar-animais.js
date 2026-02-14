document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('animals-import-file');
  const fileName = document.getElementById('animals-import-file-name');
  const startButton = document.getElementById('animals-import-start');
  const feedback = document.getElementById('animals-import-feedback');
  const previewEmpty = document.getElementById('animals-import-preview-empty');
  const previewContainer = document.getElementById('animals-import-preview');
  const previewBody = document.getElementById('animals-import-preview-body');

  if (!fileInput || !fileName || !startButton || !feedback || !previewEmpty || !previewContainer || !previewBody) {
    return;
  }

  const state = {
    rows: [],
    validRows: [],
    importing: false,
    ownerLookup: new Map(),
  };

  const REQUIRED_FIELDS = [
    { key: 'codigo', label: 'Codigo' },
    { key: 'nome', label: 'Nome' },
    { key: 'codProprietario', label: 'Cod. Proprietario' },
  ];

  const COLUMN_ALIASES = {
    codigo: ['codigo'],
    nome: ['nome'],
    codProprietario: ['codproprietario', 'codproprietario', 'proprietario', 'codigoproprietario'],
    especie: ['especie', 'tipo', 'tipopet'],
    raca: ['raca'],
    pelagem: ['pelagem', 'cor'],
    sexo: ['sexo'],
    dataNascimento: ['datanascimento', 'datanasc'],
    rga: ['rga'],
    chip: ['chip', 'microchip'],
    peso: ['peso'],
  };

  const TABLE_COLUMNS = [
    'codigo',
    'nome',
    'codProprietario',
    'especie',
    'raca',
    'pelagem',
    'sexo',
    'dataNascimento',
    'rga',
    'chip',
    'peso',
  ];

  function normalizeHeader(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function normalizeCell(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function normalizeOwnerKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function buildHeaderIndex(headerRow) {
    const index = new Map();
    headerRow.forEach((header, idx) => {
      const key = normalizeHeader(header);
      if (key && !index.has(key)) {
        index.set(key, idx);
      }
    });
    return index;
  }

  function getValueByAliases(rawRow, headerIndex, aliases) {
    for (let i = 0; i < aliases.length; i += 1) {
      const idx = headerIndex.get(aliases[i]);
      if (typeof idx === 'number') {
        return normalizeCell(rawRow[idx]);
      }
    }
    return '';
  }

  function parseWorkbook(file) {
    return file.arrayBuffer().then((buffer) => {
      if (typeof XLSX === 'undefined') {
        throw new Error('Biblioteca de planilha nao carregada.');
      }

      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames?.[0];
      if (!firstSheetName) {
        throw new Error('A planilha nao possui abas.');
      }

      const sheet = workbook.Sheets[firstSheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
      });

      if (!Array.isArray(matrix) || matrix.length < 2) {
        throw new Error('A planilha precisa ter cabecalho e ao menos uma linha.');
      }

      const headerIndex = buildHeaderIndex(matrix[0]);
      const parsedRows = [];

      for (let i = 1; i < matrix.length; i += 1) {
        const rawRow = Array.isArray(matrix[i]) ? matrix[i] : [];
        const hasAnyValue = rawRow.some((cell) => normalizeCell(cell) !== '');
        if (!hasAnyValue) continue;

        const row = {};
        Object.keys(COLUMN_ALIASES).forEach((field) => {
          row[field] = getValueByAliases(rawRow, headerIndex, COLUMN_ALIASES[field]).trim();
        });

        row._line = i + 1;
        row._missing = REQUIRED_FIELDS
          .filter((required) => !row[required.key])
          .map((required) => required.label);
        row._valid = row._missing.length === 0;
        parsedRows.push(row);
      }

      return parsedRows;
    });
  }

  function updateFeedback() {
    const total = state.rows.length;
    const valid = state.validRows.length;
    const invalid = total - valid;

    feedback.textContent = total
      ? `${total} linha(s) lida(s) | ${valid} valida(s) | ${invalid} com erro(s).`
      : '';
  }

  function updateStartButtonState() {
    startButton.disabled = state.importing || state.validRows.length === 0;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderPreview() {
    previewBody.innerHTML = '';

    if (!state.rows.length) {
      previewContainer.classList.add('hidden');
      previewEmpty.classList.remove('hidden');
      return;
    }

    const grouped = new Map();
    state.rows.forEach((row) => {
      const ownerCode = row.codProprietario || 'SEM_PROPRIETARIO';
      if (!grouped.has(ownerCode)) grouped.set(ownerCode, []);
      grouped.get(ownerCode).push(row);
    });

    const rowsHtml = Array.from(grouped.entries()).map(([ownerCode, pets]) => {
      const ownerInfo = state.ownerLookup.get(normalizeOwnerKey(ownerCode))
        || state.ownerLookup.get(onlyDigits(ownerCode))
        || null;
      let ownerLabel = 'Proprietario nao informado';
      if (ownerCode !== 'SEM_PROPRIETARIO') {
        if (ownerInfo?.encontrado) {
          ownerLabel = `Proprietario: ${escapeHtml(ownerInfo.codigoAntigo || ownerCode)} - ${escapeHtml(ownerInfo.nome || 'Sem nome')}`;
        } else {
          ownerLabel = `Proprietario: ${escapeHtml(ownerCode)} - Nao encontrado no Codigo Antigo`;
        }
      }
      const ownerRow = `
        <tr class="bg-slate-100">
          <td colspan="12" class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
            ${ownerLabel}
            <span class="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] normal-case">${pets.length} pet(s)</span>
          </td>
        </tr>
      `;

      const petRows = pets.map((row) => {
        const ownerMissing = !!row._ownerMissing;
        const statusBadge = row._valid
          ? '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">OK</span>'
          : `<span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700" title="${escapeHtml([...row._missing, ...(ownerMissing ? ['Cod. Proprietario nao encontrado no banco'] : [])].join(', '))}">Faltando: ${escapeHtml([...row._missing, ...(ownerMissing ? ['Cod. Proprietario nao encontrado no banco'] : [])].join(', '))}</span>`;

        const cells = TABLE_COLUMNS.map((column) => `<td class="px-3 py-2 text-gray-700 whitespace-nowrap">${escapeHtml(row[column])}</td>`).join('');
        const lineInfo = `<td class="px-3 py-2 whitespace-nowrap">${statusBadge}<div class="text-[10px] text-gray-500 mt-1">Linha ${row._line}</div></td>`;
        return `<tr class="${row._valid ? 'bg-white' : 'bg-red-50/40'}">${lineInfo}${cells}</tr>`;
      }).join('');

      return ownerRow + petRows;
    }).join('');

    previewBody.innerHTML = rowsHtml;
    previewEmpty.classList.add('hidden');
    previewContainer.classList.remove('hidden');
  }

  function setImporting(isImporting) {
    state.importing = isImporting;
    const icon = startButton.querySelector('i');
    const label = startButton.querySelector('span');
    if (icon) {
      icon.className = isImporting ? 'fas fa-spinner fa-spin' : 'fas fa-file-import';
    }
    if (label) {
      label.textContent = isImporting ? 'Importando...' : 'Iniciar importacao';
    }
    updateStartButtonState();
  }

  function getToken() {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch (_) {
      return '';
    }
  }

  async function loadOwnersByCodigoAntigo(rows) {
    const token = getToken();
    if (!token) {
      state.ownerLookup = new Map();
      return;
    }

    const codes = Array.from(new Set(rows
      .map((row) => normalizeCell(row.codProprietario))
      .filter(Boolean)));
    if (!codes.length) {
      state.ownerLookup = new Map();
      return;
    }

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/func/clientes/lookup-codigo-antigo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ codes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Falha ao consultar proprietarios.');
      }

      const lookup = new Map();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      items.forEach((item) => {
        const query = normalizeCell(item?.query);
        if (!query) return;
        const info = {
          encontrado: !!item?.encontrado,
          ownerId: normalizeCell(item?.ownerId),
          codigoAntigo: normalizeCell(item?.codigoAntigo),
          nome: normalizeCell(item?.nome),
        };
        lookup.set(normalizeOwnerKey(query), info);
        const digits = onlyDigits(query);
        if (digits && !lookup.has(digits)) {
          lookup.set(digits, info);
        }
      });
      state.ownerLookup = lookup;
    } catch (error) {
      state.ownerLookup = new Map();
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Nao foi possivel consultar os proprietarios.', 'warning', 4000);
      }
    }
  }

  function applyOwnerValidation() {
    state.rows.forEach((row) => {
      const code = normalizeCell(row.codProprietario);
      if (!code) {
        row._ownerMissing = false;
      } else {
        const info = state.ownerLookup.get(normalizeOwnerKey(code))
          || state.ownerLookup.get(onlyDigits(code))
          || null;
        row._ownerMissing = !info?.encontrado;
      }
      row._valid = row._missing.length === 0 && !row._ownerMissing;
    });
    state.validRows = state.rows.filter((row) => row._valid);
  }

  async function importRows() {
    if (!state.validRows.length) {
      return;
    }

    const token = getToken();
    if (!token) {
      if (typeof window.showToast === 'function') {
        window.showToast('Sessao expirada. Faca login novamente.', 'error', 4000);
      }
      return;
    }

    setImporting(true);

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/func/pets/importar-lote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rows: state.validRows }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Falha ao importar animais.');
      }

      const created = Number(payload?.summary?.created || 0);
      const updated = Number(payload?.summary?.updated || 0);
      const failed = Number(payload?.summary?.failed || 0);
      const skipped = Number(payload?.summary?.skipped || 0);
      const message = `Importacao concluida. Cadastrados: ${created} | Atualizados: ${updated} | Ignorados: ${skipped} | Falhas: ${failed}.`;

      if (typeof window.showToast === 'function') {
        window.showToast(message, failed ? 'warning' : 'success', 4500);
      }

      if (Array.isArray(payload?.errors) && payload.errors.length) {
        feedback.textContent = `${message} Erros: ${payload.errors.slice(0, 5).map((item) => `linha ${item.line}`).join(', ')}.`;
      } else {
        feedback.textContent = message;
      }
    } catch (error) {
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Falha ao importar animais.', 'error', 4500);
      }
    } finally {
      setImporting(false);
    }
  }

  fileInput.addEventListener('change', async () => {
    const selectedFile = fileInput.files?.[0] || null;
    fileName.textContent = selectedFile ? selectedFile.name : 'Nenhum arquivo selecionado.';
    state.rows = [];
    state.validRows = [];
    updateFeedback();
    renderPreview();
    updateStartButtonState();

    if (!selectedFile) return;

    try {
      const parsed = await parseWorkbook(selectedFile);
      state.rows = parsed;
      await loadOwnersByCodigoAntigo(state.rows);
      applyOwnerValidation();
      updateFeedback();
      renderPreview();
      updateStartButtonState();
    } catch (error) {
      state.rows = [];
      state.validRows = [];
      updateFeedback();
      renderPreview();
      updateStartButtonState();
      if (typeof window.showToast === 'function') {
        window.showToast(error.message || 'Nao foi possivel ler a planilha.', 'error', 4500);
      }
    }
  });

  startButton.addEventListener('click', importRows);
});
