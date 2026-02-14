document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('customer-import-file');
  const fileName = document.getElementById('customer-import-file-name');
  const startButton = document.getElementById('customer-import-start');
  const feedback = document.getElementById('customer-import-feedback');
  const previewEmpty = document.getElementById('customer-import-preview-empty');
  const previewContainer = document.getElementById('customer-import-preview');
  const previewBody = document.getElementById('customer-import-preview-body');

  if (!fileInput || !fileName || !startButton || !feedback || !previewEmpty || !previewContainer || !previewBody) {
    return;
  }

  const state = {
    rows: [],
    validRows: [],
    importing: false,
  };

  const REQUIRED_FIELDS = [
    { key: 'codigoAntigo', label: 'Codigo Antigo' },
    { key: 'nome', label: 'Nome' },
    { key: 'cpfCnpj', label: 'CPF/CNPJ' },
  ];

  const COLUMN_ALIASES = {
    codigoAntigo: ['codigoantigo', 'codigoant', 'codigoar'],
    empresa: ['empresa'],
    nome: ['nome', 'contato'],
    sexo: ['sexo'],
    tipo: ['tipo', 'tip'],
    rgIe: ['rgie', 'rginscricaoestadual', 'rgie', 'rg_ie'],
    cpfCnpj: ['cpfcnpj', 'cpf_cnpj', 'cpfcnp', 'cpfcn'],
    dataNascimento: ['datanascimento', 'datanasc', 'datanasciment'],
    cep: ['cep'],
    endereco: ['endereco', 'logradouro'],
    numero: ['numero'],
    bairro: ['bairro'],
    cidade: ['cidade'],
    uf: ['uf', 'estado'],
    complemento: ['complemento'],
    ddd1: ['ddd1', 'ddd', 'dd'],
    fone: ['fone', 'telefone', 'tel1'],
    ddd2: ['ddd2', 'dd2'],
    fone2: ['fone2', 'telefone2', 'tel2'],
    celular: ['celular', 'cel'],
    email: ['email', 'emailprincipal', 'e-mail', 'e_mail'],
  };

  const TABLE_COLUMNS = [
    'codigoAntigo',
    'empresa',
    'nome',
    'sexo',
    'tipo',
    'rgIe',
    'cpfCnpj',
    'dataNascimento',
    'cep',
    'endereco',
    'numero',
    'bairro',
    'cidade',
    'uf',
    'complemento',
    'ddd1',
    'fone',
    'ddd2',
    'fone2',
    'celular',
    'email',
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

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function normalizePhoneWithDdd(dddValue, phoneValue) {
    let digits = onlyDigits(phoneValue);
    if (!digits) return '';

    if (digits.startsWith('55') && digits.length > 11) {
      digits = digits.slice(2);
    }

    if (digits.length > 11) {
      digits = digits.slice(-11);
    }

    if (digits.length === 8 || digits.length === 9) {
      const ddd = onlyDigits(dddValue).slice(-2) || '21';
      digits = `${ddd}${digits}`;
    }

    if (digits.length < 10) return '';
    if (digits.length > 11) return digits.slice(-11);
    return digits;
  }

  function classifyPhoneNumber(phoneDigits) {
    if (!phoneDigits) return '';
    if (phoneDigits.length === 11) return 'celular';
    if (phoneDigits.length === 10) return 'telefone';
    return '';
  }

  function collectImportPhones(row) {
    const rawCandidates = [
      { source: 'celular', value: normalizePhoneWithDdd('', row.celular) },
      { source: 'fone1', value: normalizePhoneWithDdd(row.ddd1, row.fone) },
      { source: 'fone2', value: normalizePhoneWithDdd(row.ddd2, row.fone2) },
    ];

    const dedupSet = new Set();
    const candidates = rawCandidates
      .filter((entry) => entry.value)
      .filter((entry) => {
        if (dedupSet.has(entry.value)) return false;
        dedupSet.add(entry.value);
        return true;
      })
      .map((entry) => ({ ...entry, type: classifyPhoneNumber(entry.value) }))
      .filter((entry) => entry.type);

    const mobiles = candidates.filter((entry) => entry.type === 'celular');

    const priority = { celular: 1, fone1: 2, fone2: 3 };
    const sortedMobiles = mobiles.sort((a, b) => (priority[a.source] || 99) - (priority[b.source] || 99));

    return {
      celular: sortedMobiles[0]?.value || '',
      celular2: sortedMobiles[1]?.value || '',
    };
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

        const importPhones = collectImportPhones(row);
        row.celular = importPhones.celular;
        row.celular2 = importPhones.celular2;

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

    const rowsHtml = state.rows.map((row) => {
      const statusBadge = row._valid
        ? '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">OK</span>'
        : `<span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700" title="${escapeHtml(row._missing.join(', '))}">Faltando: ${escapeHtml(row._missing.join(', '))}</span>`;

      const cells = TABLE_COLUMNS.map((column) => `<td class="px-3 py-2 text-gray-700 whitespace-nowrap">${escapeHtml(row[column])}</td>`).join('');
      const lineInfo = `<td class="px-3 py-2 whitespace-nowrap">${statusBadge}<div class="text-[10px] text-gray-500 mt-1">Linha ${row._line}</div></td>`;
      return `<tr class="${row._valid ? 'bg-white' : 'bg-red-50/40'}">${lineInfo}${cells}</tr>`;
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
      const response = await fetch(`${API_CONFIG.BASE_URL}/func/clientes/importar-lote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rows: state.validRows }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Falha ao importar clientes.');
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
        window.showToast(error.message || 'Falha ao importar clientes.', 'error', 4500);
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
      state.validRows = parsed.filter((row) => row._valid);
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
