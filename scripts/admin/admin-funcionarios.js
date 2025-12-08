document.addEventListener('DOMContentLoaded', () => {
  const tabela = document.getElementById('tabela-funcionarios');
  const btnAdd = document.getElementById('btn-add-funcionario');

  // Modal Edit
  const modal = document.getElementById('modal-edit-funcionario');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('edit-funcionario-form');
  const inputId = document.getElementById('edit-id');
  const inputCodigo = document.getElementById('edit-codigo');
  const inputDataCadastro = document.getElementById('edit-data-cadastro');
  const selectSituacao = document.getElementById('edit-situacao');
  const inputNome = document.getElementById('edit-nome');
  const inputEmail = document.getElementById('edit-email');
  const inputCelular = document.getElementById('edit-celular');
  const inputTelefone = document.getElementById('edit-telefone');
  const inputPassword = document.getElementById('edit-password');
  const togglePassword = document.getElementById('toggle-password');
  const togglePasswordIcon = document.getElementById('toggle-password-icon');
  const roleSelect = document.getElementById('edit-role');
  const passwordBar = document.getElementById('password-bar');
  const modalCard = document.querySelector('[data-edit-modal-card]');
  const gruposBox = document.getElementById('edit-grupos');
  const empresasBox = document.getElementById('edit-empresas');
  const selectSexo = document.getElementById('edit-sexo');
  const dataNascimentoInput = document.getElementById('edit-data-nascimento');
  const racaCorSelect = document.getElementById('edit-raca-cor');
  const deficienciaSelect = document.getElementById('edit-deficiencia');
  const estadoCivilSelect = document.getElementById('edit-estado-civil');
  const empresaContratualSelect = document.getElementById('edit-empresa-contratual');
  const enderecoCep = document.getElementById('edit-endereco-cep');
  const enderecoLogradouro = document.getElementById('edit-endereco-endereco');
  const enderecoNumero = document.getElementById('edit-endereco-numero');
  const enderecoComplemento = document.getElementById('edit-endereco-complemento');
  const enderecoBairro = document.getElementById('edit-endereco-bairro');
  const enderecoCidade = document.getElementById('edit-endereco-cidade');
  const enderecoApelido = document.getElementById('edit-endereco-apelido');
  const btnAddEndereco = document.getElementById('btn-add-endereco');
  const listaEnderecos = document.getElementById('lista-enderecos');
  const periodoExperienciaInicioInput = document.getElementById('edit-periodo-experiencia-inicio');
  const periodoExperienciaFimInput = document.getElementById('edit-periodo-experiencia-fim');
  const dataAdmissaoInput = document.getElementById('edit-data-admissao');
  const diasProrrogacaoInput = document.getElementById('edit-dias-prorrogacao');
  const exameMedicoInput = document.getElementById('edit-exame-medico');
  const dataDemissaoInput = document.getElementById('edit-data-demissao');
  const cargoCarteiraInput = document.getElementById('edit-cargo-carteira');
  const salarioContratualInput = document.getElementById('edit-salario-contratual');
  const nomeMaeInput = document.getElementById('edit-nome-mae');
  const nascimentoMaeInput = document.getElementById('edit-nascimento-mae');
  const nomeConjugeInput = document.getElementById('edit-nome-conjuge');
  const formaPagamentoSelect = document.getElementById('edit-forma-pagamento');
  const tipoContratoSelect = document.getElementById('edit-tipo-contrato');
  const horasSemanaisInput = document.getElementById('edit-horas-semanais');
  const horasMensaisInput = document.getElementById('edit-horas-mensais');
  const passagensPorDiaInput = document.getElementById('edit-passagens-dia');
  const valorPassagemInput = document.getElementById('edit-valor-passagem');
  const bancoInput = document.getElementById('edit-banco');
  const tipoContaBancariaSelect = document.getElementById('edit-tipo-conta-bancaria');
  const agenciaInput = document.getElementById('edit-agencia');
  const contaInput = document.getElementById('edit-conta');
  const tipoChavePixSelect = document.getElementById('edit-tipo-chave-pix');
  const chavePixInput = document.getElementById('edit-chave-pix');
  const emissaoRgInput = document.getElementById('edit-emissao-rg');
  const rgInput = document.getElementById('edit-rg');
  const rgOrgaoInput = document.getElementById('edit-rg-orgao');
  const cpfInput = document.getElementById('edit-cpf');
  const habilitacaoInput = document.getElementById('edit-habilitacao');
  const habilitacaoCategoriaInput = document.getElementById('edit-habilitacao-categoria');
  const habilitacaoOrgaoInput = document.getElementById('edit-habilitacao-orgao');
  const habilitacaoValidadeInput = document.getElementById('edit-habilitacao-validade');
  const cursoNomeInput = document.getElementById('edit-curso-nome');
  const cursoDataInput = document.getElementById('edit-curso-data');
  const cursoSituacaoSelect = document.getElementById('edit-curso-situacao');
  const cursoObservacaoInput = document.getElementById('edit-curso-observacao');
  const btnAddCurso = document.getElementById('btn-add-curso');
  const listaCursos = document.getElementById('lista-cursos');
  const tipoJornadaSelect = document.getElementById('edit-tipo-jornada');
  const modalidadeJornadaSelect = document.getElementById('edit-modalidade-jornada');
  const horarioInicioInput = document.getElementById('edit-horario-inicio');
  const horarioFimInput = document.getElementById('edit-horario-fim');
  const almocoInicioInput = document.getElementById('edit-almoco-inicio');
  const almocoFimInput = document.getElementById('edit-almoco-fim');
  const btnAddHorario = document.getElementById('btn-add-horario');
  const btnCancelarHorario = document.getElementById('btn-cancelar-horario');
  const gradeHorariosContainer = document.getElementById('grade-horarios');
  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
  // Modal Search
  const modalSearch = document.getElementById('modal-search-user');
  const searchInput = document.getElementById('search-term');
  const searchResults = document.getElementById('search-results');

  // Auth
  const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
  const token = cached?.token || '';
  let ACTOR_ROLE = cached?.role || null;

  const API = {
    list:   `${API_CONFIG.BASE_URL}/admin/funcionarios`,
    create: `${API_CONFIG.BASE_URL}/admin/funcionarios`,
    update: (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
    get:    (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
    remove: (id) => `${API_CONFIG.BASE_URL}/admin/funcionarios/${id}`,
    searchUsers: (q = '', limit = 5) =>
      `${API_CONFIG.BASE_URL}/admin/funcionarios/buscar-usuarios?q=${encodeURIComponent(q)}&limit=${limit}`,
    transform: `${API_CONFIG.BASE_URL}/admin/funcionarios/transformar`,
    authCheck: `${API_CONFIG.BASE_URL}/auth/check`,
  };

  const ROLE_LABEL = {
    funcionario: 'Funcionário',
    admin: 'Administrador',
    admin_master: 'Admin Master',
  };
  const roleRank = { cliente: 0, funcionario: 1, admin: 2, admin_master: 3 };
  function getEmpresaNomeById(id) {
    if (!id || !Array.isArray(empresasDisponiveis)) return '';
    const found = empresasDisponiveis.find((empresa) => empresa?._id === id || empresa?.id === id);
    return (found?.nome || found?.razaoSocial || found?.fantasia || '').trim();
  }
  function getEmpresasSelecionadas(funcionario) {
    if (!funcionario || !Array.isArray(funcionario.empresas)) return [];
    const seen = new Set();
    const nomes = [];

    funcionario.empresas.forEach((empresa) => {
      const id = typeof empresa === 'string' ? empresa : (empresa?._id || empresa?.id || '');
      const nomeDireto = (empresa && typeof empresa === 'object')
        ? (empresa.nome || empresa.razaoSocial || empresa.fantasia || empresa.label || '')
        : '';
      const nome = (nomeDireto || getEmpresaNomeById(id) || id || '').trim();
      if (!nome) return;
      const normalized = nome.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      nomes.push(nome);
    });

    return nomes;
  }
  const funcTableColumns = [
    {
      key: 'nome',
      label: 'Nome',
      minWidth: 72,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 font-semibold text-gray-800',
      getDisplay: (f) => getNome(f) || '-',
      getComparable: (f) => (getNome(f) || '').toLowerCase(),
    },
    {
      key: 'email',
      label: 'Email',
      minWidth: 72,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px] text-gray-700',
      getDisplay: (f) => f.email || '-',
      getComparable: (f) => (f.email || '').toLowerCase(),
    },
    {
      key: 'role',
      label: 'Cargo',
      minWidth: 60,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 capitalize text-[11px] text-gray-700',
      getDisplay: (f) => ROLE_LABEL[f.role] || f.role || '-',
      getComparable: (f) => roleRank[f.role] ?? -1,
    },
    {
      key: 'empresas',
      label: 'Empresa',
      minWidth: 96,
      headerClass: 'px-3 py-2',
      cellClass: 'px-3 py-2.5 text-[11px] text-gray-700',
      getDisplay: (f) => {
        const nomes = getEmpresasSelecionadas(f);
        return nomes.length ? nomes.join(', ') : '-';
      },
      getComparable: (f) => getEmpresasSelecionadas(f).join(', ').toLowerCase(),
    },
    {
      key: 'acoes',
      label: 'Ações',
      minWidth: 84,
      headerClass: 'px-3 py-2 text-right',
      cellClass: 'px-3 py-2 text-right text-[11px]',
      disableFilter: true,
      disableSort: true,
      disableResize: false,
    },
  ];
  const funcTableElements = {
    wrapper: null,
    counter: null,
    table: null,
    tableHead: null,
    tableBody: null,
  };
  const funcTableState = {
    data: [],
    filters: {},
    filterSearch: {},
    valueFilters: {},
    sort: { key: null, direction: null },
    openPopover: null,
    columnWidths: {},
  };
  let funcActivePopover = null;
  let funcActivePopoverCleanup = null;

  funcTableColumns.forEach((column) => {
    if (!column.disableFilter) {
      funcTableState.filters[column.key] = '';
      funcTableState.filterSearch[column.key] = '';
      funcTableState.valueFilters[column.key] = null;
    }
  });
  let enderecos = [];
  let empresasDisponiveis = [];
  let enderecoEditandoIndex = null;
  let cursos = [];
  let cursoEditandoIndex = null;
  let horariosSemana = [];
  let horarioEditandoDia = null;
  let lastCepConsultado = '';
  let lastEnderecoViaCep = null;

  function onlyDigits(value = '') {
    return String(value || '').replace(/\D/g, '');
  }

  function normalizeCodigoCliente(value) {
    const digits = onlyDigits(value).replace(/^0+/, '');
    return digits ? String(Number.parseInt(digits, 10)) : '';
  }

  function formatCEP(value = '') {
    const digits = onlyDigits(value).slice(0, 8);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  function formatCPF(value = '') {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) {
      return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    }
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  function formatPhone(value = '') {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length >= 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
    }
    if (digits.length >= 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
    }
    if (digits.length >= 6) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
    }
    if (digits.length > 2) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    }
    return digits;
  }

  async function consultarViaCep(valorCep) {
    const clean = onlyDigits(valorCep);
    if (clean.length !== 8) {
      throw new Error('Informe um CEP com 8 dígitos.');
    }
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) throw new Error('Não foi possível consultar o CEP informado.');
    const data = await res.json();
    if (data?.erro) throw new Error('CEP não encontrado.');
    return {
      cep: formatCEP(clean),
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
      ibge: data.ibge || '',
    };
  }

  function aplicarViaCepNosCampos(dados) {
    if (!dados) return;
    if (enderecoCep) enderecoCep.value = dados.cep || '';
    if (enderecoLogradouro) enderecoLogradouro.value = dados.logradouro || '';
    if (enderecoBairro) enderecoBairro.value = dados.bairro || '';
    if (enderecoCidade) enderecoCidade.value = dados.cidade || '';
    if (enderecoApelido && !enderecoApelido.value) enderecoApelido.value = 'Principal';
  }

  async function garantirPreenchimentoPorCep(force = false) {
    if (!enderecoCep) return null;
    const raw = enderecoCep.value || '';
    const clean = onlyDigits(raw);
    if (clean.length !== 8) return null;
    if (!force && clean === lastCepConsultado) return lastEnderecoViaCep;

    try {
      const via = await consultarViaCep(clean);
      lastCepConsultado = clean;
      lastEnderecoViaCep = via;
      aplicarViaCepNosCampos(via);
      if (typeof window.showToast === 'function') {
        window.showToast('Endereço preenchido pelo CEP.', 'success', 1500);
      }
      return via;
    } catch (err) {
      console.error(err);
      toastWarn(err.message || 'Não foi possível buscar o CEP informado.');
      return null;
    }
  }

  function formatDateDisplay(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function setCodigoValue(value) {
    if (!inputCodigo) return;
    const normalized = normalizeCodigoCliente(value);
    if (normalized) {
      inputCodigo.value = normalized;
      inputCodigo.dataset.originalValue = normalized;
      inputCodigo.dataset.hasValue = 'true';
    } else if (value) {
      inputCodigo.value = value;
      inputCodigo.dataset.originalValue = value;
      inputCodigo.dataset.hasValue = 'true';
    } else {
      inputCodigo.value = 'Gerado automaticamente';
      inputCodigo.dataset.originalValue = '';
      inputCodigo.dataset.hasValue = 'false';
    }
  }

  function setDataCadastroValue(value) {
    if (!inputDataCadastro) return;
    if (value) {
      inputDataCadastro.value = formatDateDisplay(value);
      inputDataCadastro.dataset.originalValue = value;
      inputDataCadastro.dataset.hasValue = 'true';
    } else {
      const now = new Date();
      inputDataCadastro.value = formatDateDisplay(now.toISOString());
      inputDataCadastro.dataset.originalValue = '';
      inputDataCadastro.dataset.hasValue = 'false';
    }
  }

  function formatDateForInput(value) {
    if (!value) return '';

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      const [datePart] = trimmed.split('T');
      if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    }

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseNumberValue(raw, allowFloat = false) {
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(',', '.');
    const value = allowFloat ? Number.parseFloat(normalized) : Number.parseInt(normalized, 10);
    return Number.isFinite(value) ? value : null;
  }

  const DIAS_SEMANA_ORDER = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  const DIA_LABEL = {
    segunda: 'Segunda',
    terca: 'Terça',
    quarta: 'Quarta',
    quinta: 'Quinta',
    sexta: 'Sexta',
    sabado: 'Sábado',
    domingo: 'Domingo',
  };

  const JORNADA_MODALIDADES = [
    { value: 'diurna', label: 'Diurna' },
    { value: 'noturna', label: 'Noturna' },
    { value: 'integral', label: 'Integral' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'extraordinaria', label: 'Extraordinária' },
    { value: 'intermitente', label: 'Intermitente' },
    { value: 'estagio', label: 'Estágio' },
    { value: 'remota', label: 'Remota' },
    { value: 'reduzida', label: 'Reduzida' },
  ];

  const ESCALA_MODALIDADES = [
    { value: '6x1', label: '6 por 1' },
    { value: '5x1', label: '5 por 1' },
    { value: '12x36', label: '12 por 36' },
  ];

  function setEmpresaContratualValue(value, label = 'Empresa selecionada') {
    if (!empresaContratualSelect) return;
    if (value) {
      const exists = Array.from(empresaContratualSelect.options || []).some((opt) => opt.value === value);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label || 'Empresa selecionada';
        empresaContratualSelect.appendChild(opt);
      }
      empresaContratualSelect.value = value;
    } else {
      empresaContratualSelect.value = '';
    }
    empresaContratualSelect.dataset.selectedValue = value || '';
  }

  function setSelectValue(selectEl, value) {
    if (!selectEl) return;
    if (value === undefined || value === null) {
      selectEl.value = '';
      return;
    }
    const raw = String(value).trim();
    if (!raw) {
      selectEl.value = '';
      return;
    }
    const options = Array.from(selectEl.options || []);
    const lower = raw.toLowerCase();
    if (options.some((opt) => opt.value === lower)) {
      selectEl.value = lower;
      return;
    }
    const normalized = raw
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const matched = options.find((opt) => opt.value === normalized);
    selectEl.value = matched ? matched.value : '';
  }

  function normalizeSexoValue(value) {
    if (!value) return '';
    const normalized = String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    if (['masculino', 'm', 'male', 'homem'].includes(normalized)) return 'masculino';
    if (['feminino', 'f', 'female', 'mulher'].includes(normalized)) return 'feminino';
    if (
      [
        'nao_informar',
        'naoinformar',
        'nao informar',
        'nao informado',
        'nao declarado',
        'prefere nao dizer',
        'prefere nao informar',
        'prefere_nao_dizer',
        'na',
        'n/a',
        'indefinido',
      ].includes(normalized)
    ) {
      return 'nao_informar';
    }
    if (['masculina', 'masculine'].includes(normalized)) return 'masculino';
    if (['feminina', 'feminine'].includes(normalized)) return 'feminino';
    return '';
  }

  function normalizeEndereco(item = {}) {
    return {
      _id: item._id || item.id || null,
      cep: formatCEP(item.cep || ''),
      logradouro: item.logradouro || item.endereco || '',
      numero: item.numero || '',
      complemento: item.complemento || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      apelido: item.apelido || '',
      uf: item.uf || '',
      ibge: item.ibge || '',
      isDefault: item.isDefault === true,
    };
  }

  function clearEnderecoForm() {
    if (!enderecoCep) return;
    enderecoCep.value = '';
    enderecoLogradouro.value = '';
    enderecoNumero.value = '';
    enderecoComplemento.value = '';
    enderecoBairro.value = '';
    enderecoCidade.value = '';
    if (enderecoApelido) enderecoApelido.value = 'Principal';
    lastCepConsultado = '';
    lastEnderecoViaCep = null;
    enderecoEditandoIndex = null;
    updateEnderecoButtonLabel();
  }

  function renderEnderecosList() {
    if (!listaEnderecos) return;
    if (!Array.isArray(enderecos) || enderecos.length === 0) {
      listaEnderecos.innerHTML = '<p class="text-xs text-gray-500">Nenhum endereço cadastrado.</p>';
      return;
    }
    const cards = enderecos.map((item, index) => {
      const titulo = item.apelido || item.logradouro || '-';
      const linha2 = [item.numero, item.complemento].filter(Boolean).join(' • ');
      const cidadeUf = [item.cidade, item.uf].filter(Boolean).join(' - ');
      const linha3 = [item.bairro, cidadeUf].filter(Boolean).join(' - ');
      const cep = item.cep ? `CEP: ${formatCEP(item.cep)}` : '';
      const badge = item.isDefault ? '<span class="ml-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full uppercase">Principal</span>' : '';
      return `
        <div class="border rounded-lg px-3 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2" data-endereco-index="${index}">
          <div class="text-xs text-gray-700">
            <p class="font-semibold flex items-center gap-1">${titulo}${badge}</p>
            ${linha2 ? `<p class="text-gray-600">${linha2}</p>` : ''}
            ${linha3 ? `<p class="text-gray-600">${linha3}</p>` : ''}
            ${cep ? `<p class="text-gray-500 text-xs">${cep}</p>` : ''}
          </div>
          <div class="flex justify-end gap-3">
            <button type="button" class="text-xs font-medium text-emerald-600 hover:text-emerald-800" data-edit-endereco="${index}">Editar</button>
            <button type="button" class="text-xs font-medium text-red-600 hover:text-red-800" data-remove-endereco="${index}">Excluir</button>
          </div>
        </div>
      `;
    }).join('');
    listaEnderecos.innerHTML = cards;
  }

  function updateEnderecoButtonLabel() {
    if (!btnAddEndereco) return;
    btnAddEndereco.textContent = enderecoEditandoIndex !== null ? 'Salvar alterações' : 'Adicionar endereço';
  }

  function preencherEnderecoForm(item = {}) {
    if (!enderecoCep) return;
    enderecoCep.value = formatCEP(item.cep || '');
    enderecoLogradouro.value = item.logradouro || '';
    enderecoNumero.value = item.numero || '';
    enderecoComplemento.value = item.complemento || '';
    enderecoBairro.value = item.bairro || '';
    enderecoCidade.value = item.cidade || '';
    if (enderecoApelido) enderecoApelido.value = item.apelido || '';
    lastCepConsultado = onlyDigits(item.cep || '');
    lastEnderecoViaCep = item.cep ? {
      cep: formatCEP(item.cep),
      logradouro: item.logradouro || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      uf: item.uf || '',
      ibge: item.ibge || '',
    } : null;
  }

  async function carregarEnderecosFuncionario(userId) {
    if (!listaEnderecos) return;
    if (!userId) {
      renderEnderecosList();
      return;
    }
    listaEnderecos.innerHTML = '<p class="text-xs text-gray-500">Carregando endereços cadastrados...</p>';
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/addresses/${userId}`, { headers: headers() });
      if (!res.ok) throw new Error('Falha ao carregar endereços');
      const data = await res.json();
      enderecos = Array.isArray(data) ? data.map(normalizeEndereco) : [];
      renderEnderecosList();
    } catch (err) {
      console.error(err);
      listaEnderecos.innerHTML = '<p class="text-xs text-red-600">Não foi possível carregar os endereços.</p>';
    }
  }

  async function salvarEnderecoRemoto(userId, payload, enderecoId = null) {
    if (!userId) return null;
    const body = JSON.stringify({ ...payload, userId });
    const url = enderecoId ? `${API_CONFIG.BASE_URL}/addresses/${enderecoId}` : `${API_CONFIG.BASE_URL}/addresses`;
    const method = enderecoId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: headers(), body });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(errorBody || 'Falha ao salvar endereço');
    }
    return res.json().catch(() => null);
  }

  async function removerEnderecoRemoto(enderecoId) {
    if (!enderecoId) return;
    const res = await fetch(`${API_CONFIG.BASE_URL}/addresses/${enderecoId}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(errorBody || 'Falha ao remover endereço');
    }
  }

  function normalizeCurso(item = {}) {
    if (!item || typeof item !== 'object') {
      return { _id: null, nome: '', data: '', situacao: '', observacao: '' };
    }
    const nome = (item.nome || item.curso || item.formacao || '').trim();
    const rawData = item.data || item.dataConclusao || item.dataFim || item.dataInicio || '';
    const data = rawData ? (formatDateForInput(rawData) || rawData) : '';
    const situacaoRaw = (item.situacao || item.status || '').toLowerCase();
    const situacao = ['concluido', 'cursando'].includes(situacaoRaw) ? situacaoRaw : '';
    const observacao = (item.observacao || item.obs || '').trim();
    return {
      _id: item._id ? String(item._id) : null,
      nome,
      data,
      situacao,
      observacao,
    };
  }

  function renderCursosList() {
    if (!listaCursos) return;
    if (!Array.isArray(cursos) || cursos.length === 0) {
      listaCursos.innerHTML = '<p class="text-xs text-gray-500">Nenhum curso cadastrado.</p>';
      return;
    }
    const cards = cursos.map((item, index) => {
      const titulo = item.nome || '(Sem nome)';
      const data = item.data ? formatDateDisplay(item.data) : '';
      const situacao = item.situacao === 'concluido'
        ? 'Concluído'
        : item.situacao === 'cursando'
          ? 'Cursando'
          : '';
      const observacao = item.observacao ? `<p class="text-gray-600">${item.observacao}</p>` : '';
      const detalhes = [data, situacao].filter(Boolean).join(' • ');
      return `
        <div class="border rounded-lg px-3 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2" data-curso-index="${index}">
          <div class="text-xs text-gray-700">
            <p class="font-semibold">${titulo}</p>
            ${detalhes ? `<p class="text-gray-600">${detalhes}</p>` : ''}
            ${observacao}
          </div>
          <div class="flex justify-end gap-3">
            <button type="button" class="text-xs font-medium text-emerald-600 hover:text-emerald-800" data-edit-curso="${index}">Editar</button>
            <button type="button" class="text-xs font-medium text-red-600 hover:text-red-800" data-remove-curso="${index}">Excluir</button>
          </div>
        </div>
      `;
    }).join('');
    listaCursos.innerHTML = cards;
  }

  function updateCursoButtonLabel() {
    if (!btnAddCurso) return;
    btnAddCurso.textContent = cursoEditandoIndex !== null ? 'Salvar alterações' : 'Adicionar curso';
  }

  function clearCursoForm() {
    if (cursoNomeInput) cursoNomeInput.value = '';
    if (cursoDataInput) cursoDataInput.value = '';
    if (cursoSituacaoSelect) cursoSituacaoSelect.value = '';
    if (cursoObservacaoInput) cursoObservacaoInput.value = '';
    cursoEditandoIndex = null;
    updateCursoButtonLabel();
  }

  function preencherCursoForm(item = {}) {
    if (cursoNomeInput) cursoNomeInput.value = item.nome || '';
    if (cursoDataInput) cursoDataInput.value = item.data || '';
    if (cursoSituacaoSelect) cursoSituacaoSelect.value = item.situacao || '';
    if (cursoObservacaoInput) cursoObservacaoInput.value = item.observacao || '';
  }

  function sanitizeCursosForPayload(list = []) {
    if (!Array.isArray(list)) return [];
    return list
      .map((curso) => {
        const normalized = normalizeCurso(curso);
        if (!normalized.nome) return null;
        const payloadCurso = {
          nome: normalized.nome,
          data: normalized.data || null,
          situacao: normalized.situacao || null,
          observacao: normalized.observacao || null,
        };
        if (normalized._id) payloadCurso._id = normalized._id;
        return payloadCurso;
      })
      .filter(Boolean);
  }

  function normalizeDiaValue(value) {
    if (!value) return null;
    const normalized = String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    if (normalized.startsWith('seg')) return 'segunda';
    if (normalized.startsWith('ter')) return 'terca';
    if (normalized.startsWith('qua')) return 'quarta';
    if (normalized.startsWith('qui')) return 'quinta';
    if (normalized.startsWith('sex')) return 'sexta';
    if (normalized.startsWith('sab')) return 'sabado';
    if (normalized.startsWith('dom')) return 'domingo';
    return null;
  }

  function normalizeModalidadeValue(tipo, value) {
    if (!value) return '';
    const normalized = String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    const compact = normalized.replace(/[^a-z0-9]/g, '');

    if (tipo === 'escala') {
      if (compact.includes('6') && compact.includes('1')) return '6x1';
      if (compact.includes('5') && compact.includes('1')) return '5x1';
      if (compact.includes('12') && (compact.includes('36') || compact.includes('3') && compact.includes('6'))) return '12x36';
      const allowed = ESCALA_MODALIDADES.map((o) => o.value);
      if (allowed.includes(value)) return value;
      if (allowed.includes(normalized)) return normalized;
      if (allowed.includes(compact)) return compact;
      return '';
    }

    if (tipo === 'jornada') {
      if (normalized.includes('diurn')) return 'diurna';
      if (normalized.includes('noturn')) return 'noturna';
      if (normalized.includes('integral')) return 'integral';
      if (normalized.includes('parcial')) return 'parcial';
      if (normalized.includes('extra')) return 'extraordinaria';
      if (normalized.includes('intermit')) return 'intermitente';
      if (normalized.includes('estag')) return 'estagio';
      if (normalized.includes('remot')) return 'remota';
      if (normalized.includes('reduz')) return 'reduzida';
      const allowed = JORNADA_MODALIDADES.map((o) => o.value);
      if (allowed.includes(value)) return value;
      if (allowed.includes(normalized)) return normalized;
      return '';
    }

    return '';
  }

  function sanitizeTimeValue(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{2}:\d{2}$/.test(raw)) return raw;
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const [h, m] = raw.split(':');
      const hour = String(Math.min(Number.parseInt(h, 10), 23)).padStart(2, '0');
      const minute = String(Math.min(Number.parseInt(m, 10), 59)).padStart(2, '0');
      return `${hour}:${minute}`;
    }
    if (/^\d{3,4}$/.test(raw)) {
      const padded = raw.padStart(4, '0');
      const hour = String(Math.min(Number.parseInt(padded.slice(0, 2), 10), 23)).padStart(2, '0');
      const minute = String(Math.min(Number.parseInt(padded.slice(2), 10), 59)).padStart(2, '0');
      return `${hour}:${minute}`;
    }
    const attempt = new Date(`1970-01-01T${raw}`);
    if (!Number.isNaN(attempt.getTime())) {
      const hour = String(attempt.getHours()).padStart(2, '0');
      const minute = String(attempt.getMinutes()).padStart(2, '0');
      return `${hour}:${minute}`;
    }
    return '';
  }

  function createHorarioDia(dia) {
    return {
      dia,
      tipoJornada: '',
      modalidade: '',
      horaInicio: '',
      horaFim: '',
      almocoInicio: '',
      almocoFim: '',
    };
  }

  function createDefaultHorarios() {
    return DIAS_SEMANA_ORDER.map((dia) => createHorarioDia(dia));
  }

  function normalizeHorario(item = {}) {
    if (!item || typeof item !== 'object') return null;
    const dia = normalizeDiaValue(item.dia || item.diaSemana || item.dia_semana || item.day || item.weekday);
    if (!dia) return null;
    const tipoRaw = (item.tipoJornada || item.tipo || item.categoria || '').toString().toLowerCase().trim();
    const tipoJornada = ['jornada', 'escala'].includes(tipoRaw) ? tipoRaw : '';
    const modalidadeRaw = item.modalidade || item.modalidadeJornada || item.jornada || item.escala || item.modelo || '';
    const modalidade = tipoJornada ? normalizeModalidadeValue(tipoJornada, modalidadeRaw) : '';
    return {
      dia,
      tipoJornada,
      modalidade,
      horaInicio: sanitizeTimeValue(item.horaInicio || item.horarioInicio || item.inicio || item.hora_inicio || item.hora || ''),
      horaFim: sanitizeTimeValue(item.horaFim || item.horarioFim || item.termino || item.hora_fim || ''),
      almocoInicio: sanitizeTimeValue(item.almocoInicio || item.intervaloInicio || item.almoco_inicio || item.almoco || ''),
      almocoFim: sanitizeTimeValue(item.almocoFim || item.intervaloFim || item.almoco_fim || ''),
    };
  }

  function mergeHorariosWithDefaults(list = []) {
    const base = createDefaultHorarios();
    if (!Array.isArray(list)) return base;
    list.forEach((item) => {
      const normalized = normalizeHorario(item);
      if (!normalized || !normalized.dia) return;
      const idx = base.findIndex((d) => d.dia === normalized.dia);
      if (idx >= 0) {
        base[idx] = { ...base[idx], ...normalized };
      }
    });
    return base;
  }

  function updateModalidadeOptions(tipo, selectedValue = '') {
    if (!modalidadeJornadaSelect) return;
    modalidadeJornadaSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione';
    modalidadeJornadaSelect.appendChild(placeholder);

    const source = tipo === 'escala' ? ESCALA_MODALIDADES : tipo === 'jornada' ? JORNADA_MODALIDADES : [];
    source.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      modalidadeJornadaSelect.appendChild(option);
    });

    if (selectedValue) {
      const exists = source.some((opt) => opt.value === selectedValue);
      modalidadeJornadaSelect.value = exists ? selectedValue : '';
    } else {
      modalidadeJornadaSelect.value = '';
    }
  }

  function updateHorarioButtonLabel() {
    if (!btnAddHorario) return;
    if (horarioEditandoDia !== null && horarioEditandoDia >= 0 && horarioEditandoDia < DIAS_SEMANA_ORDER.length) {
      const dia = DIAS_SEMANA_ORDER[horarioEditandoDia];
      const label = DIA_LABEL[dia] || 'dia';
      btnAddHorario.textContent = `Salvar ${label.toLowerCase()}`;
      if (btnCancelarHorario) btnCancelarHorario.classList.remove('hidden');
    } else {
      btnAddHorario.textContent = 'Adicionar horário';
      if (btnCancelarHorario) btnCancelarHorario.classList.add('hidden');
    }
  }

  function clearHorarioForm(preserveTipo = false) {
    if (!preserveTipo && tipoJornadaSelect) {
      tipoJornadaSelect.value = '';
    }
    if (!preserveTipo) {
      updateModalidadeOptions(tipoJornadaSelect ? tipoJornadaSelect.value : '', '');
    }
    if (!preserveTipo && modalidadeJornadaSelect) modalidadeJornadaSelect.value = '';
    if (horarioInicioInput) horarioInicioInput.value = '';
    if (horarioFimInput) horarioFimInput.value = '';
    if (almocoInicioInput) almocoInicioInput.value = '';
    if (almocoFimInput) almocoFimInput.value = '';
    horarioEditandoDia = null;
    updateHorarioButtonLabel();
  }

  function preencherHorarioForm(item = {}) {
    if (tipoJornadaSelect) {
      tipoJornadaSelect.value = item.tipoJornada || '';
    }
    updateModalidadeOptions(tipoJornadaSelect ? tipoJornadaSelect.value : '', item.modalidade || '');
    if (modalidadeJornadaSelect) modalidadeJornadaSelect.value = item.modalidade || '';
    if (horarioInicioInput) horarioInicioInput.value = item.horaInicio || '';
    if (horarioFimInput) horarioFimInput.value = item.horaFim || '';
    if (almocoInicioInput) almocoInicioInput.value = item.almocoInicio || '';
    if (almocoFimInput) almocoFimInput.value = item.almocoFim || '';
  }

  function renderHorariosGrade() {
    if (!gradeHorariosContainer) return;
    if (!Array.isArray(horariosSemana) || horariosSemana.length === 0) {
      gradeHorariosContainer.innerHTML = '<p class="text-xs text-gray-500">Nenhum horário cadastrado.</p>';
      return;
    }

    const rows = horariosSemana.map((item, index) => {
      const diaLabel = DIA_LABEL[item.dia] || item.dia;
      const tipo = item.tipoJornada ? (item.tipoJornada === 'jornada' ? 'Jornada' : 'Escala') : '-';
      const modalidadeSource = item.tipoJornada === 'escala' ? ESCALA_MODALIDADES : JORNADA_MODALIDADES;
      const modalidadeLabel = (modalidadeSource.find((opt) => opt.value === item.modalidade) || {}).label || '-';
      const horaInicio = item.horaInicio || '-';
      const almocoInicio = item.almocoInicio || '-';
      const almocoFim = item.almocoFim || '-';
      const horaFim = item.horaFim || '-';
      const hasDados = item.tipoJornada || item.modalidade || item.horaInicio || item.horaFim || item.almocoInicio || item.almocoFim;
      const badge = hasDados ? '' : '<span class="text-[10px] text-gray-400 uppercase">Sem horário</span>';
      return `
        <tr class="border-b" data-horario-dia="${index}">
          <td class="px-3 py-2 text-xs font-semibold text-gray-700">${diaLabel}${badge ? `<div>${badge}</div>` : ''}</td>
          <td class="px-3 py-2 text-xs text-gray-600">${tipo}</td>
          <td class="px-3 py-2 text-xs text-gray-600">${modalidadeLabel}</td>
          <td class="px-3 py-2 text-xs text-gray-700">${horaInicio}</td>
          <td class="px-3 py-2 text-xs text-gray-700">${almocoInicio}</td>
          <td class="px-3 py-2 text-xs text-gray-700">${almocoFim}</td>
          <td class="px-3 py-2 text-xs text-gray-700">${horaFim}</td>
          <td class="px-3 py-2 text-xs text-right">
            <div class="flex justify-end gap-2">
              <button type="button" class="text-xs font-medium text-emerald-600 hover:text-emerald-800" data-edit-horario="${index}">Editar</button>
              <button type="button" class="text-xs font-medium text-red-600 hover:text-red-800" data-clear-horario="${index}">Limpar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    gradeHorariosContainer.innerHTML = `
      <table class="min-w-full border rounded-lg overflow-hidden">
        <thead class="bg-gray-50">
          <tr class="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th class="px-3 py-2">Dia</th>
            <th class="px-3 py-2">Tipo</th>
            <th class="px-3 py-2">Modalidade</th>
            <th class="px-3 py-2">Início</th>
            <th class="px-3 py-2">Almoço início</th>
            <th class="px-3 py-2">Almoço fim</th>
            <th class="px-3 py-2">Término</th>
            <th class="px-3 py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody class="bg-white text-xs">${rows}</tbody>
      </table>
    `;
  }

  function sanitizeHorariosForPayload(list = []) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => {
        const normalized = normalizeHorario(item);
        if (!normalized || !normalized.dia) return null;
        const hasDados = normalized.tipoJornada || normalized.modalidade || normalized.horaInicio || normalized.horaFim || normalized.almocoInicio || normalized.almocoFim;
        if (!hasDados) return null;
        const payloadItem = {
          dia: normalized.dia,
        };
        if (normalized.tipoJornada) payloadItem.tipoJornada = normalized.tipoJornada;
        if (normalized.modalidade) payloadItem.modalidade = normalized.modalidade;
        if (normalized.horaInicio) payloadItem.horaInicio = normalized.horaInicio;
        if (normalized.horaFim) payloadItem.horaFim = normalized.horaFim;
        if (normalized.almocoInicio) payloadItem.almocoInicio = normalized.almocoInicio;
        if (normalized.almocoFim) payloadItem.almocoFim = normalized.almocoFim;
        return payloadItem;
      })
      .filter(Boolean);
  }

  function activateTab(target) {
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tabTarget === target;
      btn.classList.toggle('bg-emerald-50', isActive);
      btn.classList.toggle('text-emerald-700', isActive);
      btn.classList.toggle('text-gray-600', !isActive);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tabTarget || 'dados';
      activateTab(target);
    });
  });
  activateTab('dados');

  horariosSemana = createDefaultHorarios();
  renderHorariosGrade();
  updateHorarioButtonLabel();
  updateModalidadeOptions(tipoJornadaSelect ? tipoJornadaSelect.value : '');

  tipoJornadaSelect?.addEventListener('change', () => {
    const tipo = tipoJornadaSelect.value || '';
    updateModalidadeOptions(tipo, '');
    if (!tipo && modalidadeJornadaSelect) modalidadeJornadaSelect.value = '';
  });

  btnAddHorario?.addEventListener('click', () => {
    const tipo = tipoJornadaSelect?.value || '';
    if (!tipo) {
      toastWarn('Selecione o tipo de jornada.');
      tipoJornadaSelect?.focus();
      return;
    }
    const modalidade = modalidadeJornadaSelect?.value || '';
    if (!modalidade) {
      toastWarn('Selecione a modalidade da jornada.');
      modalidadeJornadaSelect?.focus();
      return;
    }
    const horaInicio = sanitizeTimeValue(horarioInicioInput?.value || '');
    if (!horaInicio) {
      toastWarn('Informe a hora de início.');
      horarioInicioInput?.focus();
      return;
    }
    const horaFim = sanitizeTimeValue(horarioFimInput?.value || '');
    if (!horaFim) {
      toastWarn('Informe a hora de término.');
      horarioFimInput?.focus();
      return;
    }
    const almocoInicio = sanitizeTimeValue(almocoInicioInput?.value || '');
    const almocoFim = sanitizeTimeValue(almocoFimInput?.value || '');

    if (horarioInicioInput) horarioInicioInput.value = horaInicio;
    if (horarioFimInput) horarioFimInput.value = horaFim;
    if (almocoInicioInput) almocoInicioInput.value = almocoInicio;
    if (almocoFimInput) almocoFimInput.value = almocoFim;

    const dados = {
      tipoJornada: tipo,
      modalidade,
      horaInicio,
      horaFim,
      almocoInicio,
      almocoFim,
    };

    if (horarioEditandoDia !== null && horariosSemana[horarioEditandoDia]) {
      const diaLabel = DIA_LABEL[horariosSemana[horarioEditandoDia].dia] || 'dia';
      horariosSemana[horarioEditandoDia] = { ...horariosSemana[horarioEditandoDia], ...dados };
      toastOk(`Horário atualizado para ${diaLabel.toLowerCase()}.`);
    } else {
      horariosSemana = horariosSemana.map((item) => ({ ...item, ...dados, dia: item.dia }));
      toastOk('Horário padrão aplicado para toda a semana.');
    }

    renderHorariosGrade();
    clearHorarioForm(true);
  });

  btnCancelarHorario?.addEventListener('click', () => {
    clearHorarioForm(true);
  });

  gradeHorariosContainer?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('button[data-edit-horario]');
    if (editBtn) {
      const index = Number(editBtn.getAttribute('data-edit-horario'));
      if (!Number.isNaN(index) && horariosSemana[index]) {
        horarioEditandoDia = index;
        preencherHorarioForm(horariosSemana[index]);
        updateHorarioButtonLabel();
        tipoJornadaSelect?.focus();
      }
      return;
    }

    const clearBtn = e.target.closest('button[data-clear-horario]');
    if (!clearBtn) return;
    const index = Number(clearBtn.getAttribute('data-clear-horario'));
    if (Number.isNaN(index) || !horariosSemana[index]) return;
    const diaAtual = horariosSemana[index].dia;
    horariosSemana[index] = createHorarioDia(diaAtual);
    renderHorariosGrade();
    if (horarioEditandoDia === index) {
      clearHorarioForm(true);
    }
    const diaLabel = DIA_LABEL[diaAtual] || 'dia';
    toastOk(`Horário limpo para ${diaLabel.toLowerCase()}.`);
  });

  if (enderecoCep) {
    enderecoCep.addEventListener('input', () => {
      const formatted = formatCEP(enderecoCep.value || '');
      if (enderecoCep.value !== formatted) {
        enderecoCep.value = formatted;
        if (typeof enderecoCep.selectionStart === 'number') {
          const pos = formatted.length;
          enderecoCep.setSelectionRange(pos, pos);
        }
      }
    });
    enderecoCep.addEventListener('blur', () => { void garantirPreenchimentoPorCep(false); });
    enderecoCep.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void garantirPreenchimentoPorCep(true);
      }
    });
  }

  btnAddEndereco?.addEventListener('click', async () => {
    const logradouroAntes = enderecoLogradouro?.value || '';
    if (!logradouroAntes) {
      await garantirPreenchimentoPorCep(true);
    }
    const cepDigits = onlyDigits(enderecoCep?.value || '');
    const viaCepData = (lastEnderecoViaCep && onlyDigits(lastEnderecoViaCep.cep || '') === cepDigits)
      ? lastEnderecoViaCep
      : null;
    const enderecoAnterior = (typeof enderecoEditandoIndex === 'number' && enderecos[enderecoEditandoIndex])
      ? enderecos[enderecoEditandoIndex]
      : {};
    const novo = normalizeEndereco({
      cep: (enderecoCep?.value || '').trim(),
      logradouro: (enderecoLogradouro?.value || '').trim(),
      numero: (enderecoNumero?.value || '').trim(),
      complemento: (enderecoComplemento?.value || '').trim(),
      bairro: (enderecoBairro?.value || '').trim(),
      cidade: (enderecoCidade?.value || '').trim(),
      apelido: (enderecoApelido?.value || '').trim(),
      uf: (viaCepData?.uf ?? enderecoAnterior.uf) || undefined,
      ibge: (viaCepData?.ibge ?? enderecoAnterior.ibge) || undefined,
    });
    if (!novo.logradouro) {
      toastWarn('Informe ao menos o endereço para adicionar.');
      return;
    }
    const funcionarioId = (inputId?.value || '').trim();
    const editing = typeof enderecoEditandoIndex === 'number' && enderecos[enderecoEditandoIndex];

    try {
      if (funcionarioId) {
        const targetId = editing ? enderecos[enderecoEditandoIndex]._id : null;
        await salvarEnderecoRemoto(funcionarioId, novo, targetId);
        await carregarEnderecosFuncionario(funcionarioId);
        toastOk(editing ? 'Endereço atualizado com sucesso.' : 'Endereço adicionado ao cadastro.');
      } else {
        if (editing) {
          enderecos[enderecoEditandoIndex] = { ...enderecos[enderecoEditandoIndex], ...novo };
        } else {
          enderecos.push(novo);
        }
        renderEnderecosList();
      }
      clearEnderecoForm();
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao salvar endereço.');
    }
  });

  listaEnderecos?.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('button[data-edit-endereco]');
    if (btnEditar) {
      const index = Number(btnEditar.getAttribute('data-edit-endereco'));
      if (!Number.isNaN(index) && enderecos[index]) {
        enderecoEditandoIndex = index;
        preencherEnderecoForm(enderecos[index]);
        updateEnderecoButtonLabel();
      }
      return;
    }

    const btnRemover = e.target.closest('button[data-remove-endereco]');
    if (!btnRemover) return;
    const index = Number(btnRemover.getAttribute('data-remove-endereco'));
    if (Number.isNaN(index) || !enderecos[index]) return;

    const confirmar = await confirmAction({
      title: 'Remover endereço',
      message: 'Tem certeza que deseja remover este endereço do cadastro?',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
    });
    if (!confirmar) return;

    const funcionarioId = (inputId?.value || '').trim();
    const alvo = enderecos[index];
    try {
      if (funcionarioId && alvo?._id) {
        await removerEnderecoRemoto(alvo._id);
        toastOk('Endereço removido com sucesso.');
        await carregarEnderecosFuncionario(funcionarioId);
      } else {
        enderecos.splice(index, 1);
        renderEnderecosList();
      }
      if (enderecoEditandoIndex === index) {
        clearEnderecoForm();
      }
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao remover endereço.');
    }
  });

  btnAddCurso?.addEventListener('click', () => {
    const nome = (cursoNomeInput?.value || '').trim();
    if (!nome) {
      toastWarn('Informe a formação ou curso.');
      cursoNomeInput?.focus();
      return;
    }
    const situacaoRaw = (cursoSituacaoSelect?.value || '').toLowerCase();
    if (!['concluido', 'cursando'].includes(situacaoRaw)) {
      toastWarn('Selecione a situação do curso.');
      cursoSituacaoSelect?.focus();
      return;
    }
    const novo = normalizeCurso({
      _id: (typeof cursoEditandoIndex === 'number' && cursos[cursoEditandoIndex]) ? cursos[cursoEditandoIndex]._id : null,
      nome,
      data: cursoDataInput?.value || '',
      situacao: situacaoRaw,
      observacao: (cursoObservacaoInput?.value || '').trim(),
    });

    if (typeof cursoEditandoIndex === 'number' && cursos[cursoEditandoIndex]) {
      cursos[cursoEditandoIndex] = { ...cursos[cursoEditandoIndex], ...novo };
    } else {
      cursos.push(novo);
    }

    renderCursosList();
    clearCursoForm();
  });

  listaCursos?.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('button[data-edit-curso]');
    if (btnEditar) {
      const index = Number(btnEditar.getAttribute('data-edit-curso'));
      if (!Number.isNaN(index) && cursos[index]) {
        cursoEditandoIndex = index;
        preencherCursoForm(cursos[index]);
        updateCursoButtonLabel();
      }
      return;
    }

    const btnRemover = e.target.closest('button[data-remove-curso]');
    if (!btnRemover) return;

    const index = Number(btnRemover.getAttribute('data-remove-curso'));
    if (Number.isNaN(index) || !cursos[index]) return;

    const confirmar = await confirmAction({
      title: 'Remover curso',
      message: 'Tem certeza que deseja remover este curso do cadastro?',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
    });
    if (!confirmar) return;

    cursos.splice(index, 1);
    if (cursoEditandoIndex === index) {
      clearCursoForm();
    } else if (typeof cursoEditandoIndex === 'number' && cursoEditandoIndex > index) {
      cursoEditandoIndex -= 1;
    }
    renderCursosList();
  });

  function headers(extra = {}) {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...extra };
  }

  async function ensureActorRole() {
    if (ACTOR_ROLE) return ACTOR_ROLE;
    try {
      const resp = await fetch(API.authCheck, { headers: headers() });
      if (resp.ok) {
        const data = await resp.json();
        ACTOR_ROLE = data?.role || null;
        const cur = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
        localStorage.setItem('loggedInUser', JSON.stringify({ ...cur, role: ACTOR_ROLE }));
      }
    } catch {}
    return ACTOR_ROLE;
  }

  const getNome = (u) =>
    (u?.nome || u?.nomeCompleto || u?.nomeContato || u?.razaoSocial || '').trim();

  function isModalOpen(m) { return m && !m.classList.contains('hidden'); }

  function optionsForActor(actorRole) {
    if (actorRole === 'admin_master') return ['funcionario', 'admin', 'admin_master'];
    if (actorRole === 'admin')        return ['funcionario', 'admin'];
    return [];
  }

  // helpers bonitos
  async function confirmAction({
    title = 'Atenção',
    message = 'Tem certeza?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar'
  }) {
    return new Promise((resolve) => {
      if (typeof window.showModal === 'function') {
        window.showModal({
          title,
          message,
          confirmText,
          cancelText,
          onConfirm: () => resolve(true),
          onCancel:  () => resolve(false),
        });
      } else {
        // Fallback só se showModal NÃO existir
        resolve(window.confirm(message));
      }
    });
  }

  function toastOk(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'success');
    } else {
      // Fallback só se showToast NÃO existir
      alert(msg);
    }
  }
  function toastWarn(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'warning');
    } else {
      alert(msg);
    }
  }
  function toastError(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'error');
    } else {
      alert(msg);
    }
  }

  function openModal(mode, data = null) {
    const opts = optionsForActor(ACTOR_ROLE);
    roleSelect.innerHTML = opts.map(v => `<option value="${v}">${ROLE_LABEL[v]}</option>`).join('');
    const codigoValor = normalizeCodigoCliente(
      data?.codigoCliente ?? data?.codigo ?? data?.codigoFuncionario ?? data?.matricula,
    );
    const dataCadastroValor = data?.dataCadastro || data?.criadoEm || data?.createdAt || '';
    const situacaoValor = data?.situacao || 'ativo';
    const sexoValor = normalizeSexoValue(data?.genero ?? data?.sexo);
    const empresaContratualValor = data?.empresaContratual || data?.empresaContratualId || '';
    const empresaContratualLabel = data?.empresaContratualNome || '';

    if (mode === 'create') {
      modalTitle.textContent = 'Adicionar Funcionário';
      inputId.value = '';
      setCodigoValue('');
      setDataCadastroValue('');
      inputNome.value = '';
      inputEmail.value = '';
      if (inputCelular) inputCelular.value = '';
      if (inputTelefone) inputTelefone.value = '';
      inputPassword.value = '';
      if (selectSituacao) selectSituacao.value = 'ativo';
      if (selectSexo) selectSexo.value = '';
      if (dataNascimentoInput) dataNascimentoInput.value = '';
      if (racaCorSelect) racaCorSelect.value = '';
      if (deficienciaSelect) deficienciaSelect.value = '';
      if (estadoCivilSelect) estadoCivilSelect.value = '';
      setEmpresaContratualValue('');
      roleSelect.value = opts[0] || 'funcionario';
      passwordBar.style.width = '0%';
      setGruposSelected([]);
      setEmpresasSelected([]);
      enderecos = [];
      enderecoEditandoIndex = null;
      cursos = [];
      cursoEditandoIndex = null;
      horariosSemana = createDefaultHorarios();
      horarioEditandoDia = null;
      if (periodoExperienciaInicioInput) periodoExperienciaInicioInput.value = '';
      if (periodoExperienciaFimInput) periodoExperienciaFimInput.value = '';
      if (dataAdmissaoInput) dataAdmissaoInput.value = '';
      if (diasProrrogacaoInput) diasProrrogacaoInput.value = '';
      if (exameMedicoInput) exameMedicoInput.value = '';
      if (dataDemissaoInput) dataDemissaoInput.value = '';
      if (cargoCarteiraInput) cargoCarteiraInput.value = '';
      if (salarioContratualInput) salarioContratualInput.value = '';
      if (nomeMaeInput) nomeMaeInput.value = '';
      if (nascimentoMaeInput) nascimentoMaeInput.value = '';
      if (nomeConjugeInput) nomeConjugeInput.value = '';
      if (formaPagamentoSelect) formaPagamentoSelect.value = '';
      if (tipoContratoSelect) tipoContratoSelect.value = '';
      if (horasSemanaisInput) horasSemanaisInput.value = '';
      if (horasMensaisInput) horasMensaisInput.value = '';
      if (passagensPorDiaInput) passagensPorDiaInput.value = '';
      if (valorPassagemInput) valorPassagemInput.value = '';
      if (bancoInput) bancoInput.value = '';
      if (tipoContaBancariaSelect) tipoContaBancariaSelect.value = '';
      if (agenciaInput) agenciaInput.value = '';
      if (contaInput) contaInput.value = '';
      if (tipoChavePixSelect) tipoChavePixSelect.value = '';
      if (chavePixInput) chavePixInput.value = '';
      if (emissaoRgInput) emissaoRgInput.value = '';
      if (rgInput) rgInput.value = '';
      if (rgOrgaoInput) rgOrgaoInput.value = '';
      if (cpfInput) cpfInput.value = '';
      if (habilitacaoInput) habilitacaoInput.value = '';
      if (habilitacaoCategoriaInput) habilitacaoCategoriaInput.value = '';
      if (habilitacaoOrgaoInput) habilitacaoOrgaoInput.value = '';
      if (habilitacaoValidadeInput) habilitacaoValidadeInput.value = '';
    } else {
      modalTitle.textContent = 'Editar Funcionário';
      inputId.value = data._id;
      setCodigoValue(codigoValor || data?._id || '');
      setDataCadastroValue(dataCadastroValor);
      inputNome.value = getNome(data);
      inputEmail.value = data.email || '';
      if (inputCelular) inputCelular.value = formatPhone(data.celular || '');
      if (inputTelefone) inputTelefone.value = formatPhone(data.telefone || '');
      inputPassword.value = '';
      if (selectSituacao) selectSituacao.value = situacaoValor;
      if (selectSexo) selectSexo.value = sexoValor;
      if (dataNascimentoInput) dataNascimentoInput.value = formatDateForInput(data.dataNascimento);
      setSelectValue(racaCorSelect, data.racaCor);
      setSelectValue(deficienciaSelect, data.deficiencia);
      setSelectValue(estadoCivilSelect, data.estadoCivil);
      setEmpresaContratualValue(empresaContratualValor, empresaContratualLabel);
      roleSelect.value = opts.includes(data.role) ? data.role : (opts[0] || 'funcionario');
      passwordBar.style.width = '0%';
      setGruposSelected(Array.isArray(data.grupos) ? data.grupos : []);
      setEmpresasSelected(Array.isArray(data.empresas) ? data.empresas : []);
      enderecos = Array.isArray(data.enderecos) ? data.enderecos.map(normalizeEndereco) : [];
      enderecoEditandoIndex = null;
      cursos = Array.isArray(data.cursos) ? data.cursos.map(normalizeCurso) : [];
      cursoEditandoIndex = null;
      horariosSemana = Array.isArray(data.horarios) && data.horarios.length
        ? mergeHorariosWithDefaults(data.horarios)
        : createDefaultHorarios();
      horarioEditandoDia = null;
      if (periodoExperienciaInicioInput) periodoExperienciaInicioInput.value = formatDateForInput(data.periodoExperienciaInicio);
      if (periodoExperienciaFimInput) periodoExperienciaFimInput.value = formatDateForInput(data.periodoExperienciaFim);
      if (dataAdmissaoInput) dataAdmissaoInput.value = formatDateForInput(data.dataAdmissao);
      if (diasProrrogacaoInput) diasProrrogacaoInput.value = data.diasProrrogacaoExperiencia ?? '';
      if (exameMedicoInput) exameMedicoInput.value = formatDateForInput(data.exameMedico);
      if (dataDemissaoInput) dataDemissaoInput.value = formatDateForInput(data.dataDemissao);
      if (cargoCarteiraInput) cargoCarteiraInput.value = data.cargoCarteira || '';
      if (salarioContratualInput) salarioContratualInput.value = typeof data.salarioContratual === 'number' ? data.salarioContratual : (data.salarioContratual || '');
      if (nomeMaeInput) nomeMaeInput.value = data.nomeMae || '';
      if (nascimentoMaeInput) nascimentoMaeInput.value = formatDateForInput(data.nascimentoMae);
      if (nomeConjugeInput) nomeConjugeInput.value = data.nomeConjuge || '';
      if (formaPagamentoSelect) formaPagamentoSelect.value = data.formaPagamento || '';
      if (tipoContratoSelect) tipoContratoSelect.value = data.tipoContrato || '';
      if (horasSemanaisInput) horasSemanaisInput.value = typeof data.horasSemanais === 'number' ? data.horasSemanais : (data.horasSemanais || '');
      if (horasMensaisInput) horasMensaisInput.value = typeof data.horasMensais === 'number' ? data.horasMensais : (data.horasMensais || '');
      if (passagensPorDiaInput) passagensPorDiaInput.value = typeof data.passagensPorDia === 'number' ? data.passagensPorDia : (data.passagensPorDia || '');
      if (valorPassagemInput) valorPassagemInput.value = typeof data.valorPassagem === 'number' ? data.valorPassagem : (data.valorPassagem || '');
      if (bancoInput) bancoInput.value = data.banco || '';
      if (tipoContaBancariaSelect) tipoContaBancariaSelect.value = data.tipoContaBancaria || '';
      if (agenciaInput) agenciaInput.value = data.agencia || '';
      if (contaInput) contaInput.value = data.conta || '';
      if (tipoChavePixSelect) tipoChavePixSelect.value = data.tipoChavePix || '';
      if (chavePixInput) chavePixInput.value = data.chavePix || '';
      if (emissaoRgInput) emissaoRgInput.value = formatDateForInput(data.rgEmissao);
      if (rgInput) rgInput.value = data.rgNumero || '';
      if (rgOrgaoInput) rgOrgaoInput.value = data.rgOrgaoExpedidor || '';
      if (cpfInput) cpfInput.value = formatCPF(data.cpf || '');
      if (habilitacaoInput) habilitacaoInput.value = data.habilitacaoNumero || '';
      if (habilitacaoCategoriaInput) habilitacaoCategoriaInput.value = data.habilitacaoCategoria || '';
      if (habilitacaoOrgaoInput) habilitacaoOrgaoInput.value = data.habilitacaoOrgaoEmissor || '';
      if (habilitacaoValidadeInput) habilitacaoValidadeInput.value = formatDateForInput(data.habilitacaoValidade);
    }

    if (mode === 'create' && empresaContratualSelect) {
      empresaContratualSelect.dataset.selectedValue = '';
    }
    if (mode === 'edit' && empresaContratualSelect) {
      empresaContratualSelect.dataset.selectedValue = empresaContratualValor || '';
    }

    renderEnderecosList();
    renderCursosList();
    renderHorariosGrade();
    clearEnderecoForm();
    clearCursoForm();
    clearHorarioForm(false);
    activateTab('dados');
    if (form) form.scrollTop = 0;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    requestAnimationFrame(() => {
      if (modalCard) {
        modalCard.classList.remove('opacity-0', 'scale-95');
        modalCard.classList.add('opacity-100', 'scale-100');
      }
    });

    if (mode === 'edit' && data?._id) {
      carregarEnderecosFuncionario(data._id);
    }
  }
  function closeModal() {
    if (modalCard) {
      modalCard.classList.add('opacity-0', 'scale-95');
      modalCard.classList.remove('opacity-100', 'scale-100');
    }
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }, 180);
  }
  function openSearchModal() { modalSearch.classList.remove('hidden'); modalSearch.classList.add('flex'); searchInput.value = ''; searchUsers(''); }
  function closeSearchModal(){ modalSearch.classList.add('hidden'); modalSearch.classList.remove('flex'); }

  function passwordScore(pwd) {
    if (!pwd) return 0; let s = 0;
    if (pwd.length >= 8) s += 25;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s += 25;
    if (/\d/.test(pwd)) s += 25;
    if (/[^A-Za-z0-9]/.test(pwd)) s += 25;
    return Math.min(100, s);
  }

  const normalizeTextValue = (value) => {
    if (value === null || value === undefined) return '';
    try {
      return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    } catch (_err) {
      return String(value).toLowerCase();
    }
  };

  const escapeRegexValue = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildFilterRegex = (rawValue) => {
    const normalized = normalizeTextValue(rawValue || '').trim();
    if (!normalized) return null;

    const pattern = normalized
      .split('*')
      .map((segment) => escapeRegexValue(segment))
      .join('.*');

    if (!pattern) return null;

    try {
      return new RegExp(pattern, 'i');
    } catch (_error) {
      return null;
    }
  };

  const getFuncColumnMinWidth = (key) => {
    const column = funcTableColumns.find((col) => col.key === key);
    return column?.minWidth || 32;
  };

  const ensureFuncTableLayout = () => {
    if (!funcTableElements.table) return;
    funcTableElements.table.style.tableLayout = 'fixed';
    funcTableElements.table.style.width = 'max-content';
    funcTableElements.table.style.minWidth = '100%';
  };

  const ensureFuncColGroup = () => {
    if (!funcTableElements.table) return null;
    let colgroup = funcTableElements.table.querySelector('colgroup[data-func-columns]');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      colgroup.dataset.funcColumns = 'true';
      funcTableColumns.forEach((column) => {
        const col = document.createElement('col');
        col.dataset.columnKey = column.key;
        colgroup.appendChild(col);
      });
      funcTableElements.table.insertBefore(colgroup, funcTableElements.table.firstChild);
    } else {
      const columns = Array.from(colgroup.querySelectorAll('col'));
      const isOutdated =
        columns.length !== funcTableColumns.length ||
        columns.some((col, index) => col.dataset.columnKey !== funcTableColumns[index].key);

      if (isOutdated) {
        colgroup.innerHTML = '';
        funcTableColumns.forEach((column) => {
          const col = document.createElement('col');
          col.dataset.columnKey = column.key;
          colgroup.appendChild(col);
        });
      }
    }
    return colgroup;
  };

  const updateFuncionarioCounter = (count) => {
    if (!funcTableElements.counter) return;
    const plural = count === 1 ? 'encontrado' : 'encontrados';
    const labelPlural = count === 1 ? 'funcionário' : 'funcionários';
    funcTableElements.counter.innerHTML = `<i class="fas fa-magnifying-glass"></i>${count} ${labelPlural} ${plural}`;
  };

  const resetFuncTableShell = () => {
    closeFuncionarioFilterPopover();
    funcTableElements.wrapper = null;
    funcTableElements.counter = null;
    funcTableElements.table = null;
    funcTableElements.tableHead = null;
    funcTableElements.tableBody = null;
  };

  const ensureFuncTableShell = () => {
    const isTableMounted = funcTableElements.table && tabela.contains(funcTableElements.table);
    if (isTableMounted) return;

    resetFuncTableShell();
    tabela.innerHTML = '';

    const wrapper = document.createElement('section');
    wrapper.className = 'space-y-3';

    const header = document.createElement('div');
    header.className = 'flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600';

    const counter = document.createElement('span');
    counter.className = 'inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1';
    counter.innerHTML = '<i class="fas fa-magnifying-glass"></i>Nenhum funcionário carregado';

    header.appendChild(counter);

    const shell = document.createElement('div');
    shell.className = 'overflow-hidden rounded-xl border border-gray-100';

    const scroll = document.createElement('div');
    scroll.className = 'overflow-x-auto';

    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-100 text-left text-[11px] leading-[1.35] text-gray-700';

    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500';

    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-100 bg-white text-[11px] text-gray-700';

    table.append(thead, tbody);
    scroll.appendChild(table);
    shell.appendChild(scroll);

    wrapper.append(header, shell);
    tabela.appendChild(wrapper);

    funcTableElements.wrapper = wrapper;
    funcTableElements.counter = counter;
    funcTableElements.table = table;
    funcTableElements.tableHead = thead;
    funcTableElements.tableBody = tbody;
  };

  const getFuncionarioDisplayValue = (funcionario, column) => {
    if (typeof column.getDisplay === 'function') return column.getDisplay(funcionario);
    return funcionario[column.key] ?? column.fallback ?? '—';
  };

  const getFuncionarioComparableValue = (funcionario, column) => {
    if (typeof column.getComparable === 'function') return column.getComparable(funcionario);
    const value = getFuncionarioDisplayValue(funcionario, column);
    return typeof value === 'string' ? value.toLowerCase() : value;
  };

  const getFuncionarioColumnOptions = (column) => {
    const unique = new Map();
    funcTableState.data.forEach((item) => {
      const displayValue = getFuncionarioDisplayValue(item, column);
      const normalized = normalizeTextValue(displayValue) || '__vazio__';
      if (!unique.has(normalized)) {
        unique.set(normalized, {
          normalized,
          label: displayValue === '' || displayValue === undefined || displayValue === null ? 'Vazio' : String(displayValue),
        });
      }
    });

    return Array.from(unique.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base', numeric: true })
    );
  };

  const syncFuncionarioValueFilters = () => {
    funcTableColumns.forEach((column) => {
      if (column.disableFilter) return;
      const selected = funcTableState.valueFilters[column.key];
      if (!(selected instanceof Set)) return;

      const options = getFuncionarioColumnOptions(column);
      const allowed = new Set(options.map((option) => option.normalized));
      const next = new Set([...selected].filter((value) => allowed.has(value)));

      if (next.size === allowed.size || allowed.size === 0) {
        funcTableState.valueFilters[column.key] = null;
      } else {
        funcTableState.valueFilters[column.key] = next;
      }
    });
  };

  const applyFuncionarioTableState = (items) => {
    const baseItems = Array.isArray(items) ? items : [];
    const filtered = baseItems.filter((funcionario) => {
      return funcTableColumns.every((column) => {
        if (column.disableFilter) return true;
        const term = funcTableState.filters[column.key] || '';
        const regex = buildFilterRegex(term);
        const hasValueFilter = funcTableState.valueFilters[column.key] instanceof Set;
        const display = getFuncionarioDisplayValue(funcionario, column);
        const normalizedDisplay = normalizeTextValue(display ?? '');

        if (hasValueFilter) {
          const selectedValues = funcTableState.valueFilters[column.key];
          const optionKey = normalizeTextValue(display) || '__vazio__';
          if (!selectedValues.has(optionKey)) return false;
        }

        if (!regex) return true;
        return regex.test(normalizedDisplay);
      });
    });

    const { key, direction } = funcTableState.sort;
    const defaultSorted = [...filtered].sort((a, b) => {
      const r = (roleRank[b.role] ?? -1) - (roleRank[a.role] ?? -1);
      if (r !== 0) return r;
      return getNome(a).localeCompare(getNome(b), 'pt-BR');
    });

    if (!key || !direction) return defaultSorted;

    const targetColumn = funcTableColumns.find((column) => column.key === key);
    if (!targetColumn) return defaultSorted;

    const directionMultiplier = direction === 'asc' ? 1 : -1;

    return [...defaultSorted].sort((a, b) => {
      const valueA = getFuncionarioComparableValue(a, targetColumn);
      const valueB = getFuncionarioComparableValue(b, targetColumn);

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        if (!Number.isFinite(valueA) && !Number.isFinite(valueB)) return 0;
        if (!Number.isFinite(valueA)) return -1 * directionMultiplier;
        if (!Number.isFinite(valueB)) return 1 * directionMultiplier;
        if (valueA === valueB) return 0;
        return valueA > valueB ? directionMultiplier : -directionMultiplier;
      }

      const textA = String(valueA ?? '');
      const textB = String(valueB ?? '');
      return textA.localeCompare(textB, 'pt-BR', { sensitivity: 'base', numeric: true }) * directionMultiplier;
    });
  };

  const updateFuncSortIndicators = () => {
    if (!funcTableElements.tableHead) return;
    const buttons = funcTableElements.tableHead.querySelectorAll('[data-func-sort-button]');
    buttons.forEach((button) => {
      const { columnKey, sortDirection } = button.dataset;
      const isActive = funcTableState.sort.key === columnKey && funcTableState.sort.direction === sortDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/40', isActive);
      button.classList.toggle('bg-primary/5', isActive);
      button.classList.toggle('text-gray-400', !isActive);
      button.classList.toggle('border-transparent', !isActive);
    });
  };

  const setFuncTableSort = (key, direction) => {
    const isSame = funcTableState.sort.key === key && funcTableState.sort.direction === direction;
    funcTableState.sort = isSame ? { key: null, direction: null } : { key, direction };
    updateFuncSortIndicators();
    renderTable();
  };

  const applyFuncColumnWidths = (syncFromDom = false) => {
    if (!funcTableElements.tableHead) return;

    ensureFuncTableLayout();
    const colgroup = ensureFuncColGroup();
    const colMap = colgroup
      ? new Map(Array.from(colgroup.querySelectorAll('col')).map((col) => [col.dataset.columnKey, col]))
      : null;

    const headerCells = Array.from(funcTableElements.tableHead.querySelectorAll('th[data-column-key]'));

    headerCells.forEach((th) => {
      const columnKey = th.dataset.columnKey;
      const minWidth = getFuncColumnMinWidth(columnKey);

      if (syncFromDom && !Number.isFinite(funcTableState.columnWidths[columnKey])) {
        funcTableState.columnWidths[columnKey] = Math.max(minWidth, th.getBoundingClientRect().width);
      }

      const storedWidth = funcTableState.columnWidths[columnKey];
      const width = Number.isFinite(storedWidth) ? Math.max(minWidth, storedWidth) : minWidth;

      th.style.width = `${width}px`;
      th.style.minWidth = `${minWidth}px`;

      const colEl = colMap?.get(columnKey);
      if (colEl) {
        colEl.style.width = `${width}px`;
        colEl.style.minWidth = `${minWidth}px`;
      }

      const cells = funcTableElements.tableBody?.querySelectorAll(`td[data-column-key="${columnKey}"]`);
      cells?.forEach((cell) => {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${minWidth}px`;
      });
    });
  };

  const startFuncColumnResize = (column, th, startEvent) => {
    if (!th) return;
    startEvent.preventDefault();
    closeFuncionarioFilterPopover();

    const minWidth = getFuncColumnMinWidth(column.key);
    const startX = startEvent.touches?.[0]?.clientX ?? startEvent.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const originalUserSelect = document.body.style.userSelect;
    const originalCursor = document.body.style.cursor;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMove = (moveEvent) => {
      const currentX = moveEvent.touches?.[0]?.clientX ?? moveEvent.clientX;
      if (!Number.isFinite(currentX)) return;
      const delta = currentX - startX;
      const nextWidth = Math.max(minWidth, startWidth + delta);
      funcTableState.columnWidths[column.key] = nextWidth;
      applyFuncColumnWidths();
    };

    const handleEnd = () => {
      document.body.style.userSelect = originalUserSelect;
      document.body.style.cursor = originalCursor;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
  };

  const closeFuncionarioFilterPopover = () => {
    if (typeof funcActivePopoverCleanup === 'function') {
      funcActivePopoverCleanup();
      funcActivePopoverCleanup = null;
    }

    if (funcActivePopover?.element?.parentNode) {
      funcActivePopover.element.parentNode.removeChild(funcActivePopover.element);
    }

    funcActivePopover = null;
    funcTableState.openPopover = null;
  };

  const renderFuncionarioFilterPopover = (column, anchor) => {
    if (!anchor) return;

    const parentCell = anchor.closest('th');
    if (!parentCell) return;

    closeFuncionarioFilterPopover();

    const options = getFuncionarioColumnOptions(column);

    const popover = document.createElement('div');
    popover.className = 'fixed z-40 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg';
    popover.dataset.popoverFor = column.key;

    const title = document.createElement('div');
    title.className = 'mb-2 text-xs font-semibold uppercase text-gray-600';
    title.textContent = `Filtrar ${column.label}`;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Procurar valores';
    searchInput.value = funcTableState.filterSearch[column.key] || '';
    searchInput.className =
      'mb-2 w-full rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

    const selectAllWrapper = document.createElement('label');
    selectAllWrapper.className = 'mb-2 flex cursor-pointer items-center gap-2 text-sm text-gray-700';

    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.className = 'h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/50';

    const selectAllLabel = document.createElement('span');
    selectAllLabel.textContent = 'Selecionar todos';
    selectAllWrapper.append(selectAllCheckbox, selectAllLabel);

    const list = document.createElement('div');
    list.className = 'max-h-48 space-y-1 overflow-y-auto rounded border border-gray-100 bg-gray-50 px-2 py-2';

    const actions = document.createElement('div');
    actions.className = 'mt-3 flex items-center justify-between gap-2';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className =
      'inline-flex items-center gap-1 rounded border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50';
    clearButton.innerHTML = '<i class="fas fa-eraser"></i>Limpar';

    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className =
      'inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-secondary';
    applyButton.innerHTML = '<i class="fas fa-check"></i>Aplicar';

    actions.append(clearButton, applyButton);

    const renderOptions = () => {
      list.innerHTML = '';

      const searchTerm = normalizeTextValue(funcTableState.filterSearch[column.key] || '');
      const filteredOptions = options.filter((option) => normalizeTextValue(option.label).includes(searchTerm));

      const selectedSet = funcTableState.valueFilters[column.key];
      const isAllSelected = !(selectedSet instanceof Set) || selectedSet.size === options.length;
      selectAllCheckbox.checked = isAllSelected;
      selectAllCheckbox.indeterminate = selectedSet instanceof Set && selectedSet.size > 0 && !isAllSelected;

      if (!filteredOptions.length) {
        const empty = document.createElement('p');
        empty.className = 'py-2 text-center text-xs text-gray-500';
        empty.textContent = 'Nenhum valor encontrado';
        list.appendChild(empty);
        return;
      }

      filteredOptions.forEach((option) => {
        const item = document.createElement('label');
        item.className = 'flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-white';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/50';

        const isSelected =
          !(selectedSet instanceof Set) || selectedSet.size === options.length
            ? true
            : selectedSet.has(option.normalized);
        checkbox.checked = isSelected;

        checkbox.addEventListener('change', () => {
          if (!(funcTableState.valueFilters[column.key] instanceof Set)) {
            funcTableState.valueFilters[column.key] = new Set(options.map((opt) => opt.normalized));
          }
          const targetSet = funcTableState.valueFilters[column.key];
          if (checkbox.checked) {
            targetSet.add(option.normalized);
          } else {
            targetSet.delete(option.normalized);
          }

          if (targetSet.size === options.length) {
            funcTableState.valueFilters[column.key] = null;
          }

          renderTable();
          renderOptions();
        });

        const text = document.createElement('span');
        text.textContent = option.label;

        item.append(checkbox, text);
        list.appendChild(item);
      });
    };

    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        funcTableState.valueFilters[column.key] = null;
      } else {
        funcTableState.valueFilters[column.key] = new Set();
      }
      renderTable();
      renderOptions();
    });

    searchInput.addEventListener('input', (event) => {
      funcTableState.filterSearch[column.key] = event.target.value || '';
      renderOptions();
    });

    clearButton.addEventListener('click', () => {
      funcTableState.filterSearch[column.key] = '';
      funcTableState.valueFilters[column.key] = null;
      renderTable();
      renderOptions();
    });

    applyButton.addEventListener('click', () => {
      closeFuncionarioFilterPopover();
    });

    popover.append(title, searchInput, selectAllWrapper, list, actions);
    document.body.appendChild(popover);

    const anchorRect = anchor.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const top = anchorRect.bottom + window.scrollY + 4;
    const left = Math.min(anchorRect.left + window.scrollX, window.innerWidth - popRect.width - 8);

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    const handleClickOutside = (event) => {
      if (popover.contains(event.target)) return;
      if (anchor.contains(event.target)) return;
      closeFuncionarioFilterPopover();
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') closeFuncionarioFilterPopover();
    };

    const handleScroll = () => closeFuncionarioFilterPopover();
    const handleResize = () => closeFuncionarioFilterPopover();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    funcActivePopover = { key: column.key, element: popover };
    funcTableState.openPopover = column.key;

    funcActivePopoverCleanup = () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };

    renderOptions();
  };

  const toggleFuncionarioFilterPopover = (column, anchor) => {
    if (funcTableState.openPopover === column.key) {
      closeFuncionarioFilterPopover();
      return;
    }
    renderFuncionarioFilterPopover(column, anchor);
  };

  const buildFuncionarioTableHead = () => {
    if (!funcTableElements.tableHead) return;
    funcTableElements.tableHead.innerHTML = '';

    const row = document.createElement('tr');

    funcTableColumns.forEach((column) => {
      const th = document.createElement('th');
      th.dataset.columnKey = column.key;
      th.className = `${column.headerClass || ''} relative align-top bg-gray-50 whitespace-nowrap`;

      const wrapper = document.createElement('div');
      wrapper.className = 'flex flex-col gap-1';

      const labelRow = document.createElement('div');
      labelRow.className = 'flex items-center justify-between gap-1';

      const label = document.createElement('span');
      label.textContent = column.label;
      label.className = 'flex-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-600';
      if (column.headerClass?.includes('text-right')) label.classList.add('text-right');
      labelRow.appendChild(label);

      if (!column.disableSort) {
        const sortGroup = document.createElement('div');
        sortGroup.className = 'flex flex-col items-center justify-center gap-px text-gray-400';

        ['asc', 'desc'].forEach((direction) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.funcSortButton = 'true';
          button.dataset.columnKey = column.key;
          button.dataset.sortDirection = direction;
          button.className = 'flex h-4 w-4 items-center justify-center rounded border border-transparent text-gray-400 transition';
          button.setAttribute('aria-label', `Ordenar ${direction === 'asc' ? 'crescente' : 'decrescente'} por ${column.label}`);
          button.innerHTML = `<i class="fas fa-sort-${direction === 'asc' ? 'up' : 'down'} text-[10px]"></i>`;
          button.addEventListener('click', () => setFuncTableSort(column.key, direction));
          sortGroup.appendChild(button);
        });

        labelRow.appendChild(sortGroup);
      }

      wrapper.appendChild(labelRow);

      const filterRow = document.createElement('div');
      filterRow.className = 'flex items-center gap-1';

      if (!column.disableFilter) {
        const filter = document.createElement('input');
        filter.type = 'text';
        filter.placeholder = 'Filtrar';
        filter.value = funcTableState.filters[column.key] || '';
        filter.className =
          'flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
        filter.addEventListener('input', (event) => {
          funcTableState.filters[column.key] = event.target.value || '';
          renderTable();
        });

        const popoverButton = document.createElement('button');
        popoverButton.type = 'button';
        popoverButton.className =
          'flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-primary/50 hover:text-primary';
        popoverButton.setAttribute('aria-label', `Filtrar valores da coluna ${column.label}`);
        popoverButton.innerHTML = '<i class="fas fa-magnifying-glass"></i>';
        popoverButton.addEventListener('click', (event) => {
          event.preventDefault();
          toggleFuncionarioFilterPopover(column, popoverButton);
        });

        filterRow.append(filter, popoverButton);
      } else {
        const spacer = document.createElement('div');
        spacer.className = 'h-8';
        filterRow.appendChild(spacer);
      }

      wrapper.appendChild(filterRow);
      th.appendChild(wrapper);

      if (!column.disableResize) {
        const resizeHandle = document.createElement('div');
        resizeHandle.className =
          'absolute inset-y-0 right-0 flex w-2 cursor-col-resize select-none items-center justify-center px-px';
        resizeHandle.setAttribute('aria-label', `Redimensionar coluna ${column.label}`);
        resizeHandle.innerHTML = '<span class="pointer-events-none block h-8 w-px rounded-full bg-gray-200"></span>';
        resizeHandle.addEventListener('mousedown', (event) => startFuncColumnResize(column, th, event));
        resizeHandle.addEventListener('touchstart', (event) => startFuncColumnResize(column, th, event));
        th.appendChild(resizeHandle);
      }

      row.appendChild(th);
    });

    funcTableElements.tableHead.appendChild(row);
    updateFuncSortIndicators();
    applyFuncColumnWidths(true);
  };

  // Render com filtros, ordenação e redimensionamento
  function renderTable(funcionarios) {
    ensureFuncTableShell();
    if (Array.isArray(funcionarios)) {
      funcTableState.data = funcionarios;
      syncFuncionarioValueFilters();
      buildFuncionarioTableHead();
    }

    if (!funcTableElements.tableBody) return;
    funcTableElements.tableBody.innerHTML = '';

    const visible = applyFuncionarioTableState(funcTableState.data);

    if (!visible.length) {
      const emptyRow = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = funcTableColumns.length;
      td.className = 'px-4 py-6 text-center text-gray-500';
      td.textContent = 'Nenhum funcionário cadastrado.';
      emptyRow.appendChild(td);
      funcTableElements.tableBody.appendChild(emptyRow);
      updateFuncionarioCounter(0);
      applyFuncColumnWidths();
      return;
    }

    visible.forEach((f) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50';

      funcTableColumns.forEach((column) => {
        const cell = document.createElement('td');
        cell.dataset.columnKey = column.key;
        cell.className = column.cellClass || 'px-4 py-3';

        if (column.key === 'acoes') {
          cell.innerHTML = `
            <div class="flex justify-end gap-2 text-[11px]">
              <button class="inline-flex items-center gap-1 rounded-lg border border-emerald-100 px-2 py-1 font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-50" data-action="edit" data-id="${f._id}">
                <i class="fa-solid fa-pen-to-square"></i>
                Editar
              </button>
              <button class="inline-flex items-center gap-1 rounded-lg border border-red-100 px-2 py-1 font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50" data-action="delete" data-id="${f._id}">
                <i class="fa-solid fa-trash"></i>
                Remover
              </button>
            </div>
          `;
        } else {
          cell.textContent = getFuncionarioDisplayValue(f, column);
        }

        row.appendChild(cell);
      });

      funcTableElements.tableBody.appendChild(row);
    });

    updateFuncionarioCounter(visible.length);
    applyFuncColumnWidths();
  }

  async function loadFuncionarios() {
    resetFuncTableShell();
    tabela.innerHTML = `<p class="text-gray-600">Carregando funcionários...</p>`;
    try {
      const res = await fetch(API.list, { headers: headers() });
      if (!res.ok) throw new Error('Falha ao listar funcionários');
      renderTable(await res.json());
    } catch (e) {
      console.error(e);
      tabela.innerHTML = `<p class="text-red-600">Erro ao carregar funcionários.</p>`;
      toastError('Não foi possível carregar os funcionários.');
    }
  }

  // ===== Pesquisa (backend já não retorna quem está no quadro) =====
  function renderSearchResults(items) {
    if (!Array.isArray(items) || items.length === 0) {
      searchResults.innerHTML = `<div class="p-4 text-gray-500">Nenhum usuário encontrado.</div>`;
      return;
    }
    const allowed = optionsForActor(ACTOR_ROLE);

    const html = items.slice(0, 5).map(u => {
      const nome = getNome(u) || '(Sem nome)';
      const doc = u.cpf || u.cnpj || '';
      const opts = allowed.map(v => `<option value="${v}">${ROLE_LABEL[v]}</option>`).join('');
      return `
        <div class="p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div class="flex-1">
            <div class="font-medium">${nome}</div>
            <div class="text-sm text-gray-600">${u.email || '-'}</div>
            <div class="text-xs text-gray-500">${doc ? `Doc: ${doc}` : ''}</div>
          </div>
          <div class="flex items-center gap-2">
            <select class="border rounded px-2 py-1" data-role-select="${u._id}">
              ${opts}
            </select>
            <button class="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    data-action="promote" data-id="${u._id}">
              Adicionar
            </button>
          </div>
        </div>
      `;
    }).join('');
    searchResults.innerHTML = html;
  }

  async function searchUsers(q) {
    try {
      const res = await fetch(API.searchUsers(q, 5), { headers: headers() });
      if (!res.ok) throw new Error('Falha na busca');
      renderSearchResults(await res.json());
    } catch (e) {
      console.error(e);
      searchResults.innerHTML = `<div class="p-4 text-red-600">Erro ao buscar usuários.</div>`;
      toastError('Não foi possível buscar usuários.');
    }
  }

  function debounce(fn, wait = 300) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }
  const debouncedSearch = debounce((val) => searchUsers((val || '').trim()), 300);

  // ===== Eventos globais / modais =====
  btnAdd?.addEventListener('click', openSearchModal);

  modal.addEventListener('click', (e) => {
    const back = e.target === modal || e.target.hasAttribute('data-close-modal');
    const x = e.target.closest('#modal-close');
    const cancel = e.target.closest('#btn-cancelar');
    if (back || x || cancel) { e.preventDefault(); closeModal(); }
  });
  modalSearch.addEventListener('click', (e) => {
    const back = e.target === modalSearch;
    const x = e.target.closest('#modal-search-close');
    const cancel = e.target.closest('#btn-search-cancel');
    if (back || x || cancel) { e.preventDefault(); closeSearchModal(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen(modal)) closeModal();
    if (e.key === 'Escape' && isModalOpen(modalSearch)) closeSearchModal();
  });

  togglePassword?.addEventListener('click', () => {
    const willShow = inputPassword.type === 'password';
    inputPassword.type = willShow ? 'text' : 'password';
    togglePassword.setAttribute('aria-label', willShow ? 'Ocultar senha' : 'Mostrar senha');
    if (togglePasswordIcon) {
      togglePasswordIcon.classList.remove('fa-eye', 'fa-eye-slash');
      togglePasswordIcon.classList.add(willShow ? 'fa-eye-slash' : 'fa-eye');
    }
  });
  inputPassword.addEventListener('input', () => passwordBar.style.width = `${passwordScore(inputPassword.value)}%`);

  function attachPhoneMask(input) {
    if (!input) return;
    input.addEventListener('input', (event) => {
      const digits = onlyDigits(event.target.value);
      event.target.value = formatPhone(digits);
    });
    input.addEventListener('blur', (event) => {
      event.target.value = formatPhone(event.target.value);
    });
  }

  attachPhoneMask(inputCelular);
  attachPhoneMask(inputTelefone);

  if (cpfInput) {
    cpfInput.addEventListener('input', (event) => {
      event.target.value = formatCPF(event.target.value);
    });
    cpfInput.addEventListener('blur', (event) => {
      event.target.value = formatCPF(event.target.value);
    });
  }

  function getSelectedGrupos() {
    if (!gruposBox) return [];
    return Array.from(gruposBox.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  }
  function setGruposSelected(arr) {
    if (!gruposBox) return;
    const sel = new Set(arr || []);
    gruposBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = sel.has(cb.value));
  }

  // --- Empresas (Lojas) ---
  async function loadEmpresasOptions() {
    if (!empresasBox) return;
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/stores`);
      if (!res.ok) throw new Error('Falha ao carregar empresas');
      const stores = await res.json();
      empresasDisponiveis = Array.isArray(stores) ? stores : [];
      empresasBox.innerHTML = empresasDisponiveis.map(s => `
        <label class="inline-flex items-center gap-2">
          <input type="checkbox" value="${s._id}" class="rounded border-gray-300">
          <span>${s.nome || 'Sem nome'}</span>
        </label>
      `).join('');

      if (empresaContratualSelect) {
        const selected = empresaContratualSelect.dataset.selectedValue || '';
        const selectOptions = ['<option value="">Selecione uma empresa</option>',
          ...empresasDisponiveis.map(s => `<option value="${s._id}">${s.nome || 'Sem nome'}</option>`)
        ];
        empresaContratualSelect.innerHTML = selectOptions.join('');
        const selectedEmpresa = empresasDisponiveis.find((s) => s._id === selected);
        setEmpresaContratualValue(selected, selectedEmpresa?.nome || 'Empresa selecionada');
      }
    } catch (err) {
      console.error(err);
      empresasBox.innerHTML = '<p class="text-sm text-red-600">Erro ao carregar empresas.</p>';
      if (empresaContratualSelect) {
        empresaContratualSelect.innerHTML = '<option value="">Selecione uma empresa</option>';
      }
    }
  }
  function getSelectedEmpresas() {
    if (!empresasBox) return [];
    return Array.from(empresasBox.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  }
  function setEmpresasSelected(arr) {
    if (!empresasBox) return;
    const sel = new Set(arr || []);
    empresasBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = sel.has(cb.value));
  }

  searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));

  // transformar usuário (selecionado na busca)
  searchResults.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="promote"]');
    if (!btn) return;
    const userId = btn.getAttribute('data-id');
    const select = searchResults.querySelector(`select[data-role-select="${userId}"]`);
    const newRole = select?.value || 'funcionario';

    btn.disabled = true;
    try {
      const res = await fetch(API.transform, { method: 'POST', headers: headers(), body: JSON.stringify({ userId, role: newRole }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Falha ao transformar usuário.');
      }
      toastOk(`Usuário adicionado ao quadro como ${ROLE_LABEL[newRole]}.`);
      await loadFuncionarios();
      closeSearchModal();
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao transformar usuário.');
    } finally {
      btn.disabled = false;
    }
  });

  // Ações da tabela (editar/remover)
  tabela.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'edit') {
      try {
        const res = await fetch(API.get(id), { headers: headers() });
        if (!res.ok) throw new Error('Falha ao obter funcionário');
        openModal('edit', await res.json());
      } catch (err) {
        console.error(err);
        toastError('Não foi possível abrir o funcionário.');
      }
    }

    if (action === 'delete') {
      const ok = await confirmAction({
        title: 'Remover do quadro',
        message: 'Tem certeza que deseja remover este funcionário do quadro? (o usuário volta a ser cliente)',
        confirmText: 'Remover', cancelText: 'Cancelar'
      });
      if (!ok) return;

      try {
        const res = await fetch(API.remove(id), { method: 'DELETE', headers: headers() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'Falha ao remover');
        toastOk('Funcionário removido com sucesso.');
        await loadFuncionarios();
      } catch (err) {
        console.error(err);
        toastError(err.message || 'Erro ao remover funcionário.');
      }
    }
  });

  // Submit Edit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      nome: inputNome.value.trim(),
      email: inputEmail.value.trim(),
      role: roleSelect.value,
      grupos: getSelectedGrupos(),
      empresas: getSelectedEmpresas(),
    };

    if (periodoExperienciaInicioInput) {
      payload.periodoExperienciaInicio = periodoExperienciaInicioInput.value || null;
    }
    if (periodoExperienciaFimInput) {
      payload.periodoExperienciaFim = periodoExperienciaFimInput.value || null;
    }
    if (dataAdmissaoInput) {
      payload.dataAdmissao = dataAdmissaoInput.value || null;
    }
    if (diasProrrogacaoInput) {
      payload.diasProrrogacaoExperiencia = parseNumberValue(diasProrrogacaoInput.value, false);
    }
    if (exameMedicoInput) {
      payload.exameMedico = exameMedicoInput.value || null;
    }
    if (dataDemissaoInput) {
      payload.dataDemissao = dataDemissaoInput.value || null;
    }
    if (cargoCarteiraInput) {
      const cargoCarteira = cargoCarteiraInput.value.trim();
      payload.cargoCarteira = cargoCarteira || null;
    }
    if (salarioContratualInput) {
      payload.salarioContratual = parseNumberValue(salarioContratualInput.value, true);
    }
    if (nomeMaeInput) {
      const nomeMae = nomeMaeInput.value.trim();
      payload.nomeMae = nomeMae || null;
    }
    if (nascimentoMaeInput) {
      payload.nascimentoMae = nascimentoMaeInput.value || null;
    }
    if (nomeConjugeInput) {
      const nomeConjuge = nomeConjugeInput.value.trim();
      payload.nomeConjuge = nomeConjuge || null;
    }
    if (formaPagamentoSelect) {
      payload.formaPagamento = formaPagamentoSelect.value || null;
    }
    if (tipoContratoSelect) {
      payload.tipoContrato = tipoContratoSelect.value || null;
    }
    if (horasSemanaisInput) {
      payload.horasSemanais = parseNumberValue(horasSemanaisInput.value, true);
    }
    if (horasMensaisInput) {
      payload.horasMensais = parseNumberValue(horasMensaisInput.value, true);
    }
    if (passagensPorDiaInput) {
      payload.passagensPorDia = parseNumberValue(passagensPorDiaInput.value, false);
    }
    if (valorPassagemInput) {
      payload.valorPassagem = parseNumberValue(valorPassagemInput.value, true);
    }
    if (bancoInput) {
      const banco = bancoInput.value.trim();
      payload.banco = banco || null;
    }
    if (tipoContaBancariaSelect) {
      payload.tipoContaBancaria = tipoContaBancariaSelect.value || null;
    }
    if (agenciaInput) {
      const agencia = agenciaInput.value.trim();
      payload.agencia = agencia || null;
    }
    if (contaInput) {
      const conta = contaInput.value.trim();
      payload.conta = conta || null;
    }
    if (tipoChavePixSelect) {
      payload.tipoChavePix = tipoChavePixSelect.value || null;
    }
    if (chavePixInput) {
      const chavePix = chavePixInput.value.trim();
      payload.chavePix = chavePix || null;
    }
    if (emissaoRgInput) {
      payload.rgEmissao = emissaoRgInput.value || null;
    }
    if (rgInput) {
      const rgNumero = rgInput.value.trim();
      payload.rgNumero = rgNumero || null;
    }
    if (rgOrgaoInput) {
      const rgOrgao = rgOrgaoInput.value.trim();
      payload.rgOrgaoExpedidor = rgOrgao || null;
    }
    if (cpfInput) {
      const cpfDigits = onlyDigits(cpfInput.value);
      if (cpfDigits && cpfDigits.length !== 11) {
        toastWarn('Informe um CPF válido com 11 dígitos.');
        cpfInput.focus();
        return;
      }
      payload.cpf = cpfDigits || null;
    }
    if (habilitacaoInput) {
      const habilitacaoNumero = habilitacaoInput.value.trim();
      payload.habilitacaoNumero = habilitacaoNumero || null;
    }
    if (habilitacaoCategoriaInput) {
      const categoria = habilitacaoCategoriaInput.value.trim();
      payload.habilitacaoCategoria = categoria || null;
    }
    if (habilitacaoOrgaoInput) {
      const orgao = habilitacaoOrgaoInput.value.trim();
      payload.habilitacaoOrgaoEmissor = orgao || null;
    }
    if (habilitacaoValidadeInput) {
      payload.habilitacaoValidade = habilitacaoValidadeInput.value || null;
    }

    if (inputCelular) {
      const celularDigits = onlyDigits(inputCelular.value);
      if (!celularDigits) {
        toastWarn('Informe um celular válido.');
        inputCelular.focus();
        return;
      }
      payload.celular = celularDigits;
    }

    if (inputTelefone) {
      const telefoneDigits = onlyDigits(inputTelefone.value);
      payload.telefone = telefoneDigits;
    }
    if (selectSituacao) {
      payload.situacao = selectSituacao.value || 'ativo';
    }
    if (selectSexo) {
      const sexoVal = selectSexo.value || '';
      payload.genero = sexoVal;
    }
    if (dataNascimentoInput) {
      payload.dataNascimento = dataNascimentoInput.value || null;
    }
    if (racaCorSelect) {
      payload.racaCor = racaCorSelect.value || null;
    }
    if (deficienciaSelect) {
      payload.deficiencia = deficienciaSelect.value || null;
    }
    if (estadoCivilSelect) {
      payload.estadoCivil = estadoCivilSelect.value || null;
    }
    if (empresaContratualSelect) {
      const contratualVal = empresaContratualSelect.value || '';
      if (contratualVal) payload.empresaContratual = contratualVal;
    }
    if (Array.isArray(enderecos)) {
      payload.enderecos = enderecos;
    }
    if (Array.isArray(cursos)) {
      payload.cursos = sanitizeCursosForPayload(cursos);
    }
    if (Array.isArray(horariosSemana)) {
      payload.horarios = sanitizeHorariosForPayload(horariosSemana);
    }
    if (inputCodigo && inputCodigo.dataset?.hasValue === 'true') {
      payload.codigo = inputCodigo.dataset.originalValue || inputCodigo.value;
    }
    if (inputDataCadastro && inputDataCadastro.dataset?.hasValue === 'true') {
      payload.dataCadastro = inputDataCadastro.dataset.originalValue || inputDataCadastro.value;
    }
    const pwd = inputPassword.value.trim();
    if (pwd) payload.senha = pwd;

    const id = inputId.value.trim();
    const isCreate = !id;

    try {
      const res = await fetch(isCreate ? API.create : API.update(id), {
        method: isCreate ? 'POST' : 'PUT',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Falha ao salvar');

      closeModal();
      toastOk('Dados do funcionário salvos.');
      await loadFuncionarios();
    } catch (err) {
      console.error(err);
      toastError(err.message || 'Erro ao salvar funcionário.');
    }
  });

  // Init
  (async () => {
    await ensureActorRole();
    await loadEmpresasOptions();
    await loadFuncionarios();
  })()
});
