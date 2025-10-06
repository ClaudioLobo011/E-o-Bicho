(function () {
  const API_BASE = API_CONFIG?.BASE_URL || 'http://localhost:3000/api';

  const UF_CODE_MAP = {
    AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23', DF: '53', ES: '32', GO: '52',
    MA: '21', MG: '31', MS: '50', MT: '51', PA: '15', PB: '25', PE: '26', PI: '22', PR: '41',
    RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42', SE: '28', SP: '35', TO: '17',
  };

  function onlyDigits(value = '') {
    return String(value || '').replace(/\D/g, '');
  }

  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const currencyInputFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function parseCurrency(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const cleaned = trimmed
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
      .replace(/(?!^)-/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return fallback;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatCurrencyBRL(value = 0) {
    const numeric = Number.isFinite(value) ? value : 0;
    return currencyFormatter.format(numeric);
  }

  function formatCurrencyInput(value = 0) {
    const numeric = Number.isFinite(value) ? value : 0;
    return currencyInputFormatter.format(numeric);
  }

  function toSafeNumber(value, fallback = 0) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : fallback;
    }
    if (typeof value === 'string') {
      return parseCurrency(value, fallback);
    }
    return fallback;
  }

  function formatCpf(value = '') {
    const digits = onlyDigits(value).slice(0, 11);
    if (!digits) return '';
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  function formatCnpj(value = '') {
    const digits = onlyDigits(value).slice(0, 14);
    if (!digits) return '';
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  function formatPhone(value = '') {
    const digits = onlyDigits(value).slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 10) {
      return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }

  function formatCep(value = '') {
    const digits = onlyDigits(value).slice(0, 8);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  function formatDocumento(value = '') {
    const digits = onlyDigits(value);
    if (digits.length === 11) return formatCpf(digits);
    if (digits.length === 14) return formatCnpj(digits);
    return value || '';
  }

  function toISODateInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function notify(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type, 4000);
    } else {
      const prefix = type === 'error' ? '[Erro]' : type === 'success' ? '[Sucesso]' : '[Info]';
      console.log(prefix, message);
    }
  }

  function getAuthToken() {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (err) {
      console.error('Erro ao obter token', err);
      return '';
    }
  }

  async function apiFetch(path, options = {}) {
    const token = getAuthToken();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const config = Object.assign({}, options, { headers });
    const resp = await fetch(`${API_BASE}${path}`, config);
    if (!resp.ok) {
      let message = 'Erro inesperado.';
      try {
        const data = await resp.json();
        if (data?.message) message = data.message;
      } catch (_) {
        message = `${message} (status ${resp.status})`;
      }
      const error = new Error(message);
      error.status = resp.status;
      throw error;
    }
    if (resp.status === 204) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return resp.json();
    }
    return resp.text();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const defaultPendencias = () => ({
      valorPendente: 0,
      limiteCredito: 0,
      saldoUsado: 0,
      saldoDisponivel: 0,
    });

    const state = {
      currentClienteId: null,
      enderecos: [],
      enderecoEditandoId: null,
      pets: [],
      petEditandoId: null,
      tabAtual: 'endereco',
      pagination: { page: 1, totalPages: 1, total: 0, limit: 10 },
      busca: '',
      empresas: [],
      cepAbort: null,
      pendencias: defaultPendencias(),
    };

    const elements = {
      form: document.getElementById('cliente-form'),
      btnNovo: document.getElementById('btn-novo-cliente'),
      btnSalvar: document.getElementById('btn-salvar-cliente'),
      inputId: document.getElementById('cliente-id'),
      inputCodigo: document.getElementById('cliente-codigo'),
      selectTipo: document.getElementById('cliente-tipo'),
      inputPais: document.getElementById('cliente-pais'),
      selectEmpresa: document.getElementById('cliente-empresa'),
      pfFields: document.getElementById('pf-fields'),
      pjFields: document.getElementById('pj-fields'),
      inputNome: document.getElementById('cliente-nome'),
      inputApelido: document.getElementById('cliente-apelido'),
      inputCpf: document.getElementById('cliente-cpf'),
      inputRg: document.getElementById('cliente-rg'),
      inputNascimento: document.getElementById('cliente-nascimento'),
      selectSexo: document.getElementById('cliente-sexo'),
      inputRazao: document.getElementById('cliente-razao-social'),
      inputFantasia: document.getElementById('cliente-nome-fantasia'),
      inputContato: document.getElementById('cliente-nome-contato'),
      inputIE: document.getElementById('cliente-inscricao-estadual'),
      checkboxIsentoIE: document.getElementById('cliente-isento-ie'),
      selectEstadoIE: document.getElementById('cliente-estado-ie'),
      tabButtons: Array.from(document.querySelectorAll('.tab-button')),
      tabPanels: Array.from(document.querySelectorAll('.tab-panel')),
      endereco: {
        cep: document.getElementById('endereco-cep'),
        logradouro: document.getElementById('endereco-logradouro'),
        numero: document.getElementById('endereco-numero'),
        complemento: document.getElementById('endereco-complemento'),
        bairro: document.getElementById('endereco-bairro'),
        cidade: document.getElementById('endereco-cidade'),
        apelido: document.getElementById('endereco-apelido'),
        codIbge: document.getElementById('endereco-cod-ibge'),
        codUf: document.getElementById('endereco-cod-uf'),
        pais: document.getElementById('endereco-pais'),
      },
      btnEnderecoSalvar: document.getElementById('btn-endereco-salvar'),
      btnEnderecoCancelar: document.getElementById('btn-endereco-cancelar'),
      enderecosLista: document.getElementById('enderecos-lista'),
      enderecosVazio: document.getElementById('enderecos-vazio'),
      contato: {
        email: document.getElementById('cliente-email'),
        celular: document.getElementById('cliente-celular'),
        telefone: document.getElementById('cliente-telefone'),
        celular2: document.getElementById('cliente-celular2'),
        telefone2: document.getElementById('cliente-telefone2'),
      },
      pets: {
        nome: document.getElementById('pet-nome'),
        tipo: document.getElementById('pet-tipo'),
        porte: document.getElementById('pet-porte'),
        raca: document.getElementById('pet-raca'),
        pelagem: document.getElementById('pet-pelagem'),
        nascimento: document.getElementById('pet-nascimento'),
        peso: document.getElementById('pet-peso'),
        sexo: document.getElementById('pet-sexo'),
        rga: document.getElementById('pet-rga'),
        microchip: document.getElementById('pet-microchip'),
      },
      btnPetSalvar: document.getElementById('btn-pet-salvar'),
      btnPetCancelar: document.getElementById('btn-pet-cancelar'),
      petsLista: document.getElementById('pets-lista'),
      petsVazio: document.getElementById('pets-vazio'),
      busca: document.getElementById('cliente-busca'),
      btnBusca: document.getElementById('btn-busca-cliente'),
      tabelaBody: document.getElementById('clientes-tbody'),
      info: document.getElementById('clientes-info'),
      btnPrev: document.getElementById('clientes-prev'),
      btnNext: document.getElementById('clientes-next'),
      pendencias: {
        valorPendente: document.getElementById('pendencias-valor-pendente'),
        valorStatus: document.getElementById('pendencias-valor-pendente-status'),
        limiteCredito: document.getElementById('pendencias-limite-credito'),
        saldoDisponivel: document.getElementById('pendencias-saldo-disponivel'),
        saldoUsado: document.getElementById('pendencias-saldo-usado'),
      },
    };

    const petAutocomplete = {
      instance: null,
      speciesMap: null,
    };

    const normalizeText = (value) => String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();

    const normalizePorteLabel = (value) => {
      const key = normalizeText(value);
      if (key.startsWith('mini')) return 'mini';
      if (key.startsWith('peq')) return 'pequeno';
      if (key.startsWith('med')) return 'medio';
      if (key.startsWith('gra')) return 'grande';
      if (key.startsWith('gig')) return 'gigante';
      return 'medio';
    };

    function fixEncoding(value) {
      if (value == null) return value;
      const text = String(value);
      try {
        if (typeof escape === 'function') {
          return decodeURIComponent(escape(text));
        }
      } catch (_) {
        return text;
      }
      return text;
    }

    async function loadSpeciesMap() {
      if (petAutocomplete.speciesMap) return petAutocomplete.speciesMap;
      const base = window.basePath || '../';
      const jsonUrl = `${base}data/racas.json`;
      const legacyUrl = `${base}data/Racas-leitura.js`;

      const cleanList = (body) => body.split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//') && line !== '...')
        .map((line) => line.replace(/\*.*?\*/g, ''))
        .map((line) => line.replace(/\s*\(duplicata.*$/i, ''))
        .map((line) => line.replace(/\s*[—-].*$/, '').replace(/\s*-\s*registro.*$/i, ''));

      const buildFromJson = (payload) => {
        if (!payload || typeof payload !== 'object') throw new Error('payload inválido');
        const species = {};
        const dogPayload = payload.cachorro || {};
        const portes = dogPayload.portes || {};
        const dogMap = {
          mini: Array.from(new Set(portes.mini || [])),
          pequeno: Array.from(new Set(portes.pequeno || [])),
          medio: Array.from(new Set(portes.medio || [])),
          grande: Array.from(new Set(portes.grande || [])),
          gigante: Array.from(new Set(portes.gigante || [])),
        };
        const dogAll = Array.from(new Set(dogPayload.all || [
          ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante,
        ]));
        const dogLookup = {};
        const dogMapPayload = dogPayload.map || {};
        dogAll.forEach((nome) => {
          const normalized = normalizeText(nome);
          const porte = dogMapPayload[normalized] || dogMapPayload[nome]
            || (dogMap.mini.includes(nome) ? 'mini'
              : dogMap.pequeno.includes(nome) ? 'pequeno'
                : dogMap.medio.includes(nome) ? 'medio'
                  : dogMap.grande.includes(nome) ? 'grande'
                    : 'gigante');
          dogLookup[normalized] = porte;
        });
        species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

        const simples = ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga'];
        simples.forEach((tipo) => {
          const arr = Array.isArray(payload[tipo]) ? payload[tipo] : [];
          species[tipo] = Array.from(new Set(arr.filter(Boolean)));
        });
        return species;
      };

      const buildFromLegacy = (text) => {
        if (!text) throw new Error('conteúdo vazio');
        const species = {};
        const dogMap = { mini: [], pequeno: [], medio: [], grande: [], gigante: [] };
        const reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
        let match;
        while ((match = reDogGlobal.exec(text))) {
          const key = match[1].toLowerCase();
          const list = cleanList(match[2]);
          dogMap[key] = Array.from(new Set(list));
        }
        const dogAll = Array.from(new Set([
          ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante,
        ]));
        const dogLookup = {};
        dogAll.forEach((nome) => {
          const normalized = normalizeText(nome);
          dogLookup[normalized] = dogMap.mini.includes(nome) ? 'mini'
            : dogMap.pequeno.includes(nome) ? 'pequeno'
              : dogMap.medio.includes(nome) ? 'medio'
                : dogMap.grande.includes(nome) ? 'grande'
                  : 'gigante';
        });
        species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

        const simpleSpecies = ['gatos', 'gato', 'passaros', 'passaro', 'peixes', 'peixe', 'roedores', 'roedor', 'lagartos', 'lagarto', 'tartarugas', 'tartaruga'];
        simpleSpecies.forEach((sp) => {
          const result = new RegExp(`${sp}\\s*{([\\s\\S]*?)}`, 'i').exec(text);
          if (!result) return;
          const list = cleanList(result[1]);
          const singular = /roedores$/i.test(sp) ? 'roedor'
            : /gatos$/i.test(sp) ? 'gato'
              : /passaros$/i.test(sp) ? 'passaro'
                : /peixes$/i.test(sp) ? 'peixe'
                  : /lagartos$/i.test(sp) ? 'lagarto'
                    : /tartarugas$/i.test(sp) ? 'tartaruga'
                      : sp.replace(/s$/, '');
          species[singular] = Array.from(new Set(list));
        });
        return species;
      };

      try {
        const response = await fetch(jsonUrl, { headers: { Accept: 'application/json' } });
        if (response.ok) {
          petAutocomplete.speciesMap = buildFromJson(await response.json());
          return petAutocomplete.speciesMap;
        }
        if (response.status && response.status !== 404) {
          console.warn('clientes: falha ao obter racas.json', response.status);
        }
      } catch (error) {
        console.warn('clientes: erro ao ler racas.json', error);
      }

      try {
        const response = await fetch(legacyUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        petAutocomplete.speciesMap = buildFromLegacy(text);
        return petAutocomplete.speciesMap;
      } catch (error) {
        console.warn('clientes: falha ao carregar Racas-leitura.js', error);
        petAutocomplete.speciesMap = null;
        return null;
      }
    }

    function ensurePetTypeOptions() {
      const select = elements.pets.tipo;
      if (!select) return;
      const desired = [
        ['cachorro', 'Cachorro'],
        ['gato', 'Gato'],
        ['passaro', 'Pássaro'],
        ['peixe', 'Peixe'],
        ['roedor', 'Roedor'],
        ['lagarto', 'Lagarto'],
        ['tartaruga', 'Tartaruga'],
      ];
      const existing = new Set(Array.from(select.options).map((opt) => (opt.value || '').toLowerCase()));
      desired.forEach(([value, label]) => {
        if (!existing.has(value)) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
      });
      Array.from(select.options).forEach((opt) => {
        if ((opt.value || '').toLowerCase() === 'passaro') {
          opt.textContent = 'Pássaro';
        }
      });
    }

    function normalizePetStaticLabels() {
      const sexoSelect = elements.pets.sexo;
      if (sexoSelect) {
        Array.from(sexoSelect.options).forEach((opt) => {
          if (/f[eê]mea/i.test(opt.textContent || '')) {
            opt.textContent = 'Fêmea';
          }
        });
      }
      const porteSelect = elements.pets.porte;
      if (porteSelect) {
        let noneOption = Array.from(porteSelect.options).find((opt) => (opt.textContent || '').toLowerCase().includes('sem porte'));
        if (!noneOption) {
          noneOption = document.createElement('option');
          noneOption.textContent = 'Sem porte definido';
          noneOption.value = 'Sem porte definido';
          porteSelect.insertBefore(noneOption, porteSelect.firstChild);
        }
        Array.from(porteSelect.options).forEach((opt) => {
          if (/m[eê]dio/i.test(opt.textContent || '')) {
            opt.textContent = 'Médio';
          }
        });
      }
    }

    function updatePendenciasUI(options = {}) {
      const { preserveInput = false } = options;
      const {
        valorPendente = 0,
        limiteCredito = 0,
        saldoDisponivel = 0,
        saldoUsado = 0,
      } = state.pendencias || defaultPendencias();

      if (elements.pendencias.valorPendente) {
        const valueEl = elements.pendencias.valorPendente;
        valueEl.textContent = formatCurrencyBRL(valorPendente);
        valueEl.classList.remove('text-red-600', 'text-sky-600', 'text-gray-700');
        let statusText = '';
        const statusEl = elements.pendencias.valorStatus;
        if (valorPendente < 0) {
          valueEl.classList.add('text-red-600');
          statusText = 'Em aberto';
          if (statusEl) {
            statusEl.classList.remove('text-sky-600', 'text-gray-500', 'text-emerald-600');
            statusEl.classList.add('text-red-600');
          }
        } else if (valorPendente > 0) {
          valueEl.classList.add('text-sky-600');
          statusText = 'Crédito';
          if (statusEl) {
            statusEl.classList.remove('text-red-600', 'text-gray-500', 'text-emerald-600');
            statusEl.classList.add('text-sky-600');
          }
        } else {
          valueEl.classList.add('text-gray-700');
          statusText = 'Em dia';
          if (statusEl) {
            statusEl.classList.remove('text-red-600', 'text-sky-600');
            statusEl.classList.add('text-gray-500');
          }
        }
        if (statusEl) {
          statusEl.textContent = statusText;
        }
      }

      if (elements.pendencias.saldoDisponivel) {
        const disponivel = Number.isFinite(saldoDisponivel)
          ? saldoDisponivel
          : limiteCredito - saldoUsado;
        elements.pendencias.saldoDisponivel.textContent = formatCurrencyBRL(disponivel);
      }

      if (elements.pendencias.saldoUsado) {
        const usado = Number.isFinite(saldoUsado) ? saldoUsado : 0;
        elements.pendencias.saldoUsado.textContent = formatCurrencyBRL(usado);
      }

      if (!preserveInput && elements.pendencias.limiteCredito) {
        elements.pendencias.limiteCredito.value = formatCurrencyInput(limiteCredito);
      }
    }

    function resetPendencias() {
      state.pendencias = defaultPendencias();
      updatePendenciasUI();
    }

    function applyPendenciasFromCliente(cliente = {}) {
      const financeiro = cliente.financeiro || cliente.pendencias || {};
      const valorPendente = toSafeNumber(
        financeiro.valorPendente ?? cliente.valorPendente,
        0,
      );
      const limiteCredito = toSafeNumber(
        financeiro.limiteCredito ?? cliente.limiteCredito,
        0,
      );
      const saldoUsado = toSafeNumber(
        financeiro.saldoUsado ?? cliente.saldoUsado,
        0,
      );
      const saldoDisponivelRaw = financeiro.saldoDisponivel ?? cliente.saldoDisponivel;
      const saldoDisponivel = saldoDisponivelRaw == null
        ? limiteCredito - saldoUsado
        : toSafeNumber(saldoDisponivelRaw, limiteCredito - saldoUsado);

      state.pendencias = {
        valorPendente,
        limiteCredito,
        saldoUsado,
        saldoDisponivel,
      };
      updatePendenciasUI();
    }

    function handleLimiteCreditoInput() {
      if (!elements.pendencias.limiteCredito) return;
      const raw = elements.pendencias.limiteCredito.value;
      const novoLimite = parseCurrency(raw, state.pendencias.limiteCredito || 0);
      state.pendencias.limiteCredito = novoLimite;
      state.pendencias.saldoDisponivel = novoLimite - (state.pendencias.saldoUsado || 0);
      updatePendenciasUI({ preserveInput: true });
    }

    function handleLimiteCreditoBlur() {
      handleLimiteCreditoInput();
      updatePendenciasUI();
    }

    function setSelectValue(select, value) {
      if (!select) return;
      const raw = value == null ? '' : String(value);
      const options = Array.from(select.options || []);
      const exact = options.find((opt) => (opt.value || '') === raw);
      if (exact) {
        select.value = exact.value;
        return;
      }
      const lower = raw.toLowerCase();
      const match = options.find((opt) => (opt.value || '').toLowerCase() === lower);
      if (match) {
        select.value = match.value;
        return;
      }
      const normalizedRaw = normalizeText(raw);
      const normalized = options.find((opt) => normalizeText(opt.value || opt.textContent || '') === normalizedRaw);
      if (normalized) {
        select.value = normalized.value || normalized.textContent;
        return;
      }
      select.value = raw;
    }

    function setPorteFromBreedIfDog() {
      const porteSelect = elements.pets.porte;
      const tipoSelect = elements.pets.tipo;
      const racaInput = elements.pets.raca;
      if (!porteSelect || !tipoSelect || !racaInput) return;
      const isDog = normalizeText(tipoSelect.value) === 'cachorro';
      if (!isDog) return;
      const map = petAutocomplete.speciesMap?.cachorro?.map;
      if (!map) return;
      const breedKey = normalizeText(racaInput.value);
      const desired = map[breedKey] || 'medio';
      const match = Array.from(porteSelect.options).find((opt) => normalizePorteLabel(opt.textContent) === desired);
      if (match) {
        porteSelect.value = match.value || match.textContent;
      }
    }

    function syncPorteDisabled() {
      const porteSelect = elements.pets.porte;
      const tipoSelect = elements.pets.tipo;
      if (!porteSelect || !tipoSelect) return;
      const isDog = normalizeText(tipoSelect.value) === 'cachorro';
      porteSelect.disabled = true;
      if (isDog) {
        setPorteFromBreedIfDog();
      } else {
        const noneOption = Array.from(porteSelect.options).find((opt) => (opt.textContent || '').toLowerCase().includes('sem porte'));
        if (noneOption && !porteSelect.value) {
          porteSelect.value = noneOption.value || noneOption.textContent;
        }
      }
    }

    async function updateBreedOptions() {
      const tipoSelect = elements.pets.tipo;
      const racaInput = elements.pets.raca;
      if (!tipoSelect || !racaInput) return;
      const selectedType = normalizeText(tipoSelect.value);
      await loadSpeciesMap().catch(() => {});
      let breeds = [];
      if (selectedType === 'cachorro') {
        breeds = (petAutocomplete.speciesMap?.cachorro?.all || []).slice();
      } else if (selectedType === 'gato') {
        breeds = (petAutocomplete.speciesMap?.gato || petAutocomplete.speciesMap?.gatos || []).slice();
      } else if (selectedType === 'passaro') {
        breeds = (petAutocomplete.speciesMap?.passaro || petAutocomplete.speciesMap?.passaros || []).slice();
      } else if (['peixe', 'roedor', 'lagarto', 'tartaruga'].includes(selectedType)) {
        breeds = (petAutocomplete.speciesMap?.[selectedType] || []).slice();
      } else {
        breeds = [];
      }
      breeds = breeds.map((item) => fixEncoding(item)).sort((a, b) => a.localeCompare(b));

      if (racaInput) {
        racaInput.setAttribute('autocomplete', 'off');
      }

      if (typeof Awesomplete === 'function') {
        if (!petAutocomplete.instance || petAutocomplete.instance.input !== racaInput) {
          petAutocomplete.instance = new Awesomplete(racaInput, {
            minChars: 1,
            list: breeds,
            autoFirst: true,
          });
        } else {
          petAutocomplete.instance.list = breeds;
        }

        if (petAutocomplete.instance) {
          if (typeof petAutocomplete.instance.evaluate === 'function') {
            petAutocomplete.instance.evaluate();
          }
          if (document.activeElement === racaInput
            && typeof petAutocomplete.instance.open === 'function') {
            petAutocomplete.instance.open();
          }
        }
      }
    }

    function refreshPetFormOptions() {
      ensurePetTypeOptions();
      normalizePetStaticLabels();
      updateBreedOptions().then(() => {
        syncPorteDisabled();
        setPorteFromBreedIfDog();
      });
    }

    function switchTipo(tipo) {
      const isPJ = tipo === 'pessoa_juridica';
      elements.selectTipo.value = tipo;
      elements.pfFields.classList.toggle('hidden', isPJ);
      elements.pjFields.classList.toggle('hidden', !isPJ);
    }

    function switchTab(tab) {
      state.tabAtual = tab;
      elements.tabButtons.forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('bg-indigo-100', isActive);
        btn.classList.toggle('text-indigo-700', isActive);
        btn.classList.toggle('text-gray-600', !isActive);
      });
      elements.tabPanels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab);
      });
    }

    function clearEnderecoForm() {
      state.enderecoEditandoId = null;
      Object.values(elements.endereco).forEach((input) => {
        if (input) input.value = input.id === 'endereco-pais' ? 'Brasil' : '';
      });
      elements.btnEnderecoCancelar.classList.add('hidden');
      elements.btnEnderecoSalvar.textContent = 'Salvar endereço';
    }

    function clearPetForm() {
      state.petEditandoId = null;
      Object.values(elements.pets).forEach((input) => {
        if (input) input.value = '';
      });
      elements.btnPetCancelar.classList.add('hidden');
      elements.btnPetSalvar.textContent = 'Adicionar pet';
      if (elements.pets.porte) {
        elements.pets.porte.disabled = true;
      }
      refreshPetFormOptions();
    }

    function clearForm() {
      state.currentClienteId = null;
      elements.inputId.value = '';
      elements.inputCodigo.value = '';
      elements.inputPais.value = 'Brasil';
      elements.selectEmpresa.value = '';
      elements.inputNome.value = '';
      elements.inputApelido.value = '';
      elements.inputCpf.value = '';
      elements.inputRg.value = '';
      elements.inputNascimento.value = '';
      elements.selectSexo.value = '';
      elements.inputRazao.value = '';
      elements.inputFantasia.value = '';
      elements.inputContato.value = '';
      elements.inputIE.value = '';
      elements.checkboxIsentoIE.checked = false;
      elements.inputIE.removeAttribute('disabled');
      elements.selectEstadoIE.value = '';
      switchTipo('pessoa_fisica');
      Object.values(elements.contato).forEach((input) => { if (input) input.value = ''; });
      state.enderecos = [];
      renderEnderecos();
      state.pets = [];
      renderPets();
      clearEnderecoForm();
      clearPetForm();
      resetPendencias();
    }

    async function loadEmpresas() {
      try {
        const lojas = await fetch(`${API_BASE}/stores`).then((r) => r.json());
        state.empresas = Array.isArray(lojas) ? lojas : [];
        elements.selectEmpresa.innerHTML = '<option value="">Selecione uma empresa</option>' +
          state.empresas.map((loja) => `<option value="${loja._id}">${loja.nomeFantasia || loja.nome || loja.razaoSocial || 'Empresa sem nome'}</option>`).join('');
      } catch (err) {
        console.error('Erro ao carregar empresas', err);
      }
    }

    function renderEnderecos() {
      const lista = elements.enderecosLista;
      lista.innerHTML = '';
      if (!state.enderecos.length) {
        elements.enderecosVazio.classList.remove('hidden');
        return;
      }
      elements.enderecosVazio.classList.add('hidden');
      state.enderecos.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'rounded-lg border border-gray-200 p-4 shadow-sm bg-gray-50';
        const linhas = [
          `${item.apelido || 'Endereço'}${item.isDefault ? ' <span class="ml-1 inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Principal</span>' : ''}`,
          `${item.logradouro || ''} ${item.numero || ''}`.trim(),
          `${item.bairro || ''} - ${item.cidade || ''}/${item.uf || ''}`,
          `${item.cep ? formatCep(item.cep) : ''}`,
          item.codIbgeMunicipio ? `IBGE: ${item.codIbgeMunicipio}` : '',
          item.codUf ? `Cod. UF: ${item.codUf}` : '',
        ].filter(Boolean);
        card.innerHTML = `
          <div class="flex flex-col gap-2 text-sm text-gray-700">
            ${linhas.map((linha, index) => index === 0 ? `<div class="font-semibold text-gray-800">${linha}</div>` : `<div>${linha}</div>`).join('')}
          </div>
          <div class="mt-3 flex items-center gap-2">
            <button data-id="${item._id}" data-action="editar" class="px-3 py-1.5 rounded border border-indigo-200 text-indigo-600 text-xs font-medium hover:bg-indigo-50">Editar</button>
            <button data-id="${item._id}" data-action="remover" class="px-3 py-1.5 rounded border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50">Remover</button>
          </div>
        `;
        lista.appendChild(card);
      });
    }

    function renderPets() {
      const lista = elements.petsLista;
      lista.innerHTML = '';
      if (!state.pets.length) {
        elements.petsVazio.classList.remove('hidden');
        return;
      }
      elements.petsVazio.classList.add('hidden');
      state.pets.forEach((pet) => {
        const card = document.createElement('div');
        card.className = 'rounded-lg border border-gray-200 p-4 shadow-sm bg-white';
        const nascimento = pet.dataNascimento ? toISODateInput(pet.dataNascimento) : '';
        const nome = fixEncoding(pet.nome || '');
        const tipo = fixEncoding(pet.tipo || '');
        const raca = fixEncoding(pet.raca || '');
        const porte = fixEncoding(pet.porte || '');
        const pelagem = fixEncoding(pet.pelagemCor || pet.pelagem || '');
        const sexo = fixEncoding(pet.sexo || '');
        const peso = fixEncoding(pet.peso || '');
        const rga = fixEncoding(pet.rga || '');
        const microchip = fixEncoding(pet.microchip || '');
        const detalhes = [
          tipo ? `Tipo: ${tipo}` : '',
          raca ? `Raça: ${raca}` : '',
          porte ? `Porte: ${porte}` : '',
          pelagem ? `Pelagem: ${pelagem}` : '',
          nascimento ? `Nascimento: ${nascimento.split('-').reverse().join('/')}` : '',
          peso ? `Peso: ${peso}` : '',
          sexo ? `Sexo: ${sexo}` : '',
          rga ? `RGA: ${rga}` : '',
          microchip ? `Microchip: ${microchip}` : '',
        ].filter(Boolean);
        card.innerHTML = `
          <div class="flex flex-col gap-1 text-sm text-gray-700">
            <div class="text-base font-semibold text-gray-800">${nome || 'Sem nome'}</div>
            ${detalhes.map((linha) => `<div>${linha}</div>`).join('')}
          </div>
          <div class="mt-3 flex items-center gap-2">
            <button data-id="${pet._id}" data-action="editar-pet" class="px-3 py-1.5 rounded border border-indigo-200 text-indigo-600 text-xs font-medium hover:bg-indigo-50">Editar</button>
            <button data-id="${pet._id}" data-action="remover-pet" class="px-3 py-1.5 rounded border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50">Remover</button>
          </div>
        `;
        lista.appendChild(card);
      });
    }

    function renderClientes(items = [], pagination) {
      if (!Array.isArray(items) || !items.length) {
        elements.tabelaBody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-gray-500 text-sm">Nenhum cliente encontrado.</td></tr>';
      } else {
        elements.tabelaBody.innerHTML = items.map((cliente) => {
          const tipo = cliente.tipoConta === 'pessoa_juridica' ? 'Jurídica' : 'Física';
          const contato = [cliente.email, cliente.celular ? formatPhone(cliente.celular) : ''].filter(Boolean).join('<br>');
          return `
            <tr class="hover:bg-gray-50">
              <td class="px-4 py-3 align-top text-sm text-gray-700">${cliente.codigo || cliente._id || '—'}</td>
              <td class="px-4 py-3 align-top text-sm text-gray-900 font-medium">${cliente.nome || '—'}</td>
              <td class="px-4 py-3 align-top text-sm text-gray-700">${tipo}</td>
              <td class="px-4 py-3 align-top text-sm text-gray-700">${formatDocumento(cliente.documento) || '—'}</td>
              <td class="px-4 py-3 align-top text-sm text-gray-700">${cliente.empresa || '—'}</td>
              <td class="px-4 py-3 align-top text-sm text-gray-700">${contato || '—'}</td>
              <td class="px-4 py-3 align-top text-right text-sm">
                <button data-id="${cliente._id}" class="btn-editar-cliente px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700">Editar</button>
              </td>
            </tr>
          `;
        }).join('');
      }
      if (pagination) {
        state.pagination = pagination;
        const { page, totalPages, total } = pagination;
        elements.info.textContent = `Página ${page} de ${totalPages} — ${total} cliente(s)`;
        elements.btnPrev.disabled = page <= 1;
        elements.btnNext.disabled = page >= totalPages;
        elements.btnPrev.classList.toggle('opacity-50', elements.btnPrev.disabled);
        elements.btnNext.classList.toggle('opacity-50', elements.btnNext.disabled);
      }
    }

    async function loadClientes(page = 1) {
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(state.pagination.limit), search: state.busca || '' });
        const data = await apiFetch(`/func/clientes?${params.toString()}`);
        renderClientes(data.items || [], data.pagination || state.pagination);
      } catch (err) {
        console.error('Erro ao listar clientes', err);
        notify(err.message || 'Erro ao listar clientes', 'error');
      }
    }

    async function loadEnderecos() {
      if (!state.currentClienteId) return;
      try {
        const data = await apiFetch(`/func/clientes/${state.currentClienteId}/enderecos`);
        state.enderecos = Array.isArray(data) ? data : [];
        renderEnderecos();
      } catch (err) {
        console.error('Erro ao carregar endereços', err);
      }
    }

    async function loadPets() {
      if (!state.currentClienteId) return;
      try {
        const data = await apiFetch(`/func/clientes/${state.currentClienteId}/pets`);
        state.pets = Array.isArray(data) ? data : [];
        renderPets();
      } catch (err) {
        console.error('Erro ao carregar pets', err);
      }
    }

    async function loadCliente(id) {
      try {
        const data = await apiFetch(`/func/clientes/${id}`);
        state.currentClienteId = data._id;
        elements.inputId.value = data._id;
        elements.inputCodigo.value = data.codigo || data._id || '';
        elements.selectTipo.value = data.tipoConta || 'pessoa_fisica';
        switchTipo(elements.selectTipo.value);
        elements.inputPais.value = data.pais || 'Brasil';
        if (data.empresaPrincipal?._id) {
          elements.selectEmpresa.value = data.empresaPrincipal._id;
        } else {
          elements.selectEmpresa.value = '';
        }
        elements.inputNome.value = data.nome || data.nomeCompleto || '';
        elements.inputApelido.value = data.apelido || '';
        elements.inputCpf.value = formatCpf(data.cpf || '');
        elements.inputRg.value = data.rgNumero || '';
        elements.inputNascimento.value = data.dataNascimento || '';
        elements.selectSexo.value = data.genero || '';
        elements.inputRazao.value = data.razaoSocial || '';
        elements.inputFantasia.value = data.nomeFantasia || '';
        elements.inputContato.value = data.nomeContato || '';
        elements.inputIE.value = data.inscricaoEstadual || '';
        elements.checkboxIsentoIE.checked = !!data.isentoIE;
        if (elements.checkboxIsentoIE.checked) {
          elements.inputIE.value = 'ISENTO';
          elements.inputIE.setAttribute('disabled', 'disabled');
        } else {
          elements.inputIE.removeAttribute('disabled');
        }
        elements.selectEstadoIE.value = data.estadoIE || '';
        elements.contato.email.value = data.email || '';
        elements.contato.celular.value = formatPhone(data.celular || '');
        elements.contato.telefone.value = formatPhone(data.telefone || '');
        elements.contato.celular2.value = formatPhone(data.celularSecundario || '');
        elements.contato.telefone2.value = formatPhone(data.telefoneSecundario || '');
        applyPendenciasFromCliente(data);
        state.enderecos = Array.isArray(data.enderecos) ? data.enderecos : [];
        renderEnderecos();
        await loadPets();
        notify('Cliente carregado.', 'success');
      } catch (err) {
        console.error('Erro ao carregar cliente', err);
        notify(err.message || 'Erro ao carregar cliente.', 'error');
      }
    }

    async function salvarCliente(event) {
      event.preventDefault();
      const tipoConta = elements.selectTipo.value === 'pessoa_juridica' ? 'pessoa_juridica' : 'pessoa_fisica';
      const payload = {
        tipoConta,
        pais: elements.inputPais.value.trim() || 'Brasil',
        empresaId: elements.selectEmpresa.value || '',
        email: elements.contato.email.value.trim(),
        celular: onlyDigits(elements.contato.celular.value),
        telefone: onlyDigits(elements.contato.telefone.value),
        celular2: onlyDigits(elements.contato.celular2.value),
        telefone2: onlyDigits(elements.contato.telefone2.value),
        limiteCredito: Number.isFinite(state.pendencias?.limiteCredito)
          ? state.pendencias.limiteCredito
          : 0,
      };

      if (tipoConta === 'pessoa_fisica') {
        payload.nome = elements.inputNome.value.trim();
        payload.apelido = elements.inputApelido.value.trim();
        payload.cpf = onlyDigits(elements.inputCpf.value);
        payload.rg = elements.inputRg.value.trim();
        payload.nascimento = elements.inputNascimento.value;
        payload.sexo = elements.selectSexo.value;
      } else {
        payload.razaoSocial = elements.inputRazao.value.trim();
        payload.nomeFantasia = elements.inputFantasia.value.trim();
        payload.nomeContato = elements.inputContato.value.trim();
        payload.inscricaoEstadual = elements.inputIE.value.trim();
        payload.estadoIE = elements.selectEstadoIE.value;
        payload.isentoIE = elements.checkboxIsentoIE.checked;
      }

      const method = state.currentClienteId ? 'PUT' : 'POST';
      const path = state.currentClienteId ? `/func/clientes/${state.currentClienteId}` : '/func/clientes';

      try {
        const data = await apiFetch(path, {
          method,
          body: JSON.stringify(payload),
        });
        notify(method === 'POST' ? 'Cliente cadastrado com sucesso.' : 'Cliente atualizado com sucesso.', 'success');
        await loadClientes(method === 'POST' ? 1 : state.pagination.page);
        if (method === 'POST' && data?.id) {
          await loadCliente(data.id);
        } else if (state.currentClienteId) {
          await loadCliente(state.currentClienteId);
        }
      } catch (err) {
        console.error('Erro ao salvar cliente', err);
        notify(err.message || 'Erro ao salvar cliente.', 'error');
      }
    }

    async function salvarEndereco() {
      if (!state.currentClienteId) {
        notify('Salve o cliente antes de adicionar endereços.', 'warning');
        return;
      }
      const cep = elements.endereco.cep.value;
      const payload = {
        cep,
        logradouro: elements.endereco.logradouro.value,
        numero: elements.endereco.numero.value,
        complemento: elements.endereco.complemento.value,
        bairro: elements.endereco.bairro.value,
        cidade: elements.endereco.cidade.value,
        apelido: elements.endereco.apelido.value,
        codIbgeMunicipio: elements.endereco.codIbge.value,
        codUf: elements.endereco.codUf.value,
        pais: elements.endereco.pais.value,
      };
      const isEdicao = !!state.enderecoEditandoId;
      const path = isEdicao
        ? `/func/clientes/${state.currentClienteId}/enderecos/${state.enderecoEditandoId}`
        : `/func/clientes/${state.currentClienteId}/enderecos`;
      try {
        await apiFetch(path, {
          method: isEdicao ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        notify(isEdicao ? 'Endereço atualizado.' : 'Endereço adicionado.', 'success');
        clearEnderecoForm();
        await loadEnderecos();
      } catch (err) {
        console.error('Erro ao salvar endereço', err);
        notify(err.message || 'Erro ao salvar endereço.', 'error');
      }
    }

    async function removerEndereco(id) {
      if (!state.currentClienteId) return;
      const confirmar = window.confirm('Deseja remover este endereço?');
      if (!confirmar) return;
      try {
        await apiFetch(`/func/clientes/${state.currentClienteId}/enderecos/${id}`, { method: 'DELETE' });
        notify('Endereço removido.', 'success');
        if (state.enderecoEditandoId === id) {
          clearEnderecoForm();
        }
        await loadEnderecos();
      } catch (err) {
        console.error('Erro ao remover endereço', err);
        notify(err.message || 'Erro ao remover endereço.', 'error');
      }
    }

    async function salvarPet() {
      if (!state.currentClienteId) {
        notify('Salve o cliente antes de adicionar animais.', 'warning');
        return;
      }
      const payload = {
        nome: elements.pets.nome.value.trim(),
        tipo: elements.pets.tipo.value,
        porte: elements.pets.porte.value,
        raca: elements.pets.raca.value.trim(),
        pelagem: elements.pets.pelagem.value.trim(),
        nascimento: elements.pets.nascimento.value,
        peso: elements.pets.peso.value.trim(),
        sexo: elements.pets.sexo.value,
        rga: elements.pets.rga.value.trim(),
        microchip: elements.pets.microchip.value.trim(),
      };
      const isEdicao = !!state.petEditandoId;
      const path = isEdicao
        ? `/func/clientes/${state.currentClienteId}/pets/${state.petEditandoId}`
        : `/func/clientes/${state.currentClienteId}/pets`;
      try {
        await apiFetch(path, {
          method: isEdicao ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        notify(isEdicao ? 'Pet atualizado.' : 'Pet cadastrado.', 'success');
        clearPetForm();
        await loadPets();
      } catch (err) {
        console.error('Erro ao salvar pet', err);
        notify(err.message || 'Erro ao salvar pet.', 'error');
      }
    }

    async function removerPet(id) {
      if (!state.currentClienteId) return;
      const confirmar = window.confirm('Deseja remover este pet?');
      if (!confirmar) return;
      try {
        await apiFetch(`/func/clientes/${state.currentClienteId}/pets/${id}`, { method: 'DELETE' });
        notify('Pet removido.', 'success');
        if (state.petEditandoId === id) {
          clearPetForm();
        }
        await loadPets();
      } catch (err) {
        console.error('Erro ao remover pet', err);
        notify(err.message || 'Erro ao remover pet.', 'error');
      }
    }

    async function consultarCep(value) {
      const digits = onlyDigits(value);
      if (digits.length !== 8) return;
      if (state.cepAbort) {
        state.cepAbort.abort();
      }
      state.cepAbort = new AbortController();
      try {
        const resp = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: state.cepAbort.signal });
        if (!resp.ok) throw new Error('CEP não encontrado.');
        const data = await resp.json();
        if (data.erro) throw new Error('CEP não encontrado.');
        elements.endereco.logradouro.value = data.logradouro || '';
        elements.endereco.bairro.value = data.bairro || '';
        elements.endereco.cidade.value = data.localidade || '';
        if (!elements.endereco.apelido.value) {
          elements.endereco.apelido.value = 'Principal';
        }
        elements.endereco.cep.value = formatCep(digits);
        elements.endereco.codIbge.value = data.ibge || '';
        const uf = (data.uf || '').toUpperCase();
        if (uf) {
          elements.endereco.codUf.value = UF_CODE_MAP[uf] || '';
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Erro ao consultar CEP', err);
      }
    }

    elements.selectTipo.addEventListener('change', () => {
      switchTipo(elements.selectTipo.value);
    });

    elements.checkboxIsentoIE.addEventListener('change', () => {
      if (elements.checkboxIsentoIE.checked) {
        elements.inputIE.value = 'ISENTO';
        elements.inputIE.setAttribute('disabled', 'disabled');
      } else {
        elements.inputIE.removeAttribute('disabled');
        elements.inputIE.value = '';
      }
    });

    elements.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    switchTab('endereco');

    elements.form.addEventListener('submit', salvarCliente);
    elements.btnNovo.addEventListener('click', () => {
      clearForm();
      notify('Formulário limpo.', 'info');
    });

    elements.btnEnderecoSalvar.addEventListener('click', salvarEndereco);
    elements.btnEnderecoCancelar.addEventListener('click', () => {
      clearEnderecoForm();
    });

    elements.btnPetSalvar.addEventListener('click', salvarPet);
    elements.btnPetCancelar.addEventListener('click', () => {
      clearPetForm();
    });

    if (elements.pets.tipo) {
      elements.pets.tipo.addEventListener('change', async () => {
        await updateBreedOptions();
        syncPorteDisabled();
        setPorteFromBreedIfDog();
      });
    }

    if (elements.pets.raca) {
      ['change', 'blur'].forEach((evt) => {
        elements.pets.raca.addEventListener(evt, () => setTimeout(setPorteFromBreedIfDog, 0));
      });
      elements.pets.raca.addEventListener('awesomplete-selectcomplete', () => setTimeout(setPorteFromBreedIfDog, 0));
      elements.pets.raca.addEventListener('focus', () => {
        updateBreedOptions();
        if (petAutocomplete.instance && typeof petAutocomplete.instance.open === 'function') {
          petAutocomplete.instance.open();
        }
      });
      elements.pets.raca.addEventListener('input', () => {
        if (petAutocomplete.instance) {
          if (typeof petAutocomplete.instance.evaluate === 'function') {
            petAutocomplete.instance.evaluate();
          }
          if (typeof petAutocomplete.instance.open === 'function') {
            petAutocomplete.instance.open();
          }
        }
      });
    }

    elements.enderecosLista.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      const endereco = state.enderecos.find((item) => item._id === id);
      if (action === 'editar' && endereco) {
        state.enderecoEditandoId = id;
        elements.endereco.cep.value = formatCep(endereco.cep || '');
        elements.endereco.logradouro.value = endereco.logradouro || '';
        elements.endereco.numero.value = endereco.numero || '';
        elements.endereco.complemento.value = endereco.complemento || '';
        elements.endereco.bairro.value = endereco.bairro || '';
        elements.endereco.cidade.value = endereco.cidade || '';
        elements.endereco.apelido.value = endereco.apelido || '';
        elements.endereco.codIbge.value = endereco.codIbgeMunicipio || '';
        elements.endereco.codUf.value = endereco.codUf || '';
        elements.endereco.pais.value = endereco.pais || 'Brasil';
        elements.btnEnderecoCancelar.classList.remove('hidden');
        elements.btnEnderecoSalvar.textContent = 'Atualizar endereço';
        switchTab('endereco');
      } else if (action === 'remover') {
        removerEndereco(id);
      }
    });

    elements.petsLista.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      const pet = state.pets.find((item) => item._id === id);
      if (action === 'editar-pet' && pet) {
        state.petEditandoId = id;
        elements.pets.nome.value = fixEncoding(pet.nome || '');
        setSelectValue(elements.pets.tipo, pet.tipo || '');
        await updateBreedOptions();
        elements.pets.raca.value = fixEncoding(pet.raca || '');
        setSelectValue(elements.pets.porte, pet.porte || '');
        elements.pets.pelagem.value = fixEncoding(pet.pelagemCor || pet.pelagem || '');
        elements.pets.nascimento.value = toISODateInput(pet.dataNascimento);
        elements.pets.peso.value = fixEncoding(pet.peso || '');
        setSelectValue(elements.pets.sexo, pet.sexo || '');
        elements.pets.rga.value = fixEncoding(pet.rga || '');
        elements.pets.microchip.value = fixEncoding(pet.microchip || '');
        elements.btnPetCancelar.classList.remove('hidden');
        elements.btnPetSalvar.textContent = 'Atualizar pet';
        syncPorteDisabled();
        setPorteFromBreedIfDog();
        switchTab('animais');
      } else if (action === 'remover-pet') {
        removerPet(id);
      }
    });

    elements.tabelaBody.addEventListener('click', (event) => {
      const button = event.target.closest('.btn-editar-cliente');
      if (!button) return;
      const id = button.dataset.id;
      if (!id) return;
      loadCliente(id);
    });

    elements.btnPrev.addEventListener('click', () => {
      if (state.pagination.page > 1) {
        loadClientes(state.pagination.page - 1);
      }
    });

    elements.btnNext.addEventListener('click', () => {
      if (state.pagination.page < state.pagination.totalPages) {
        loadClientes(state.pagination.page + 1);
      }
    });

    elements.btnBusca.addEventListener('click', () => {
      state.busca = elements.busca.value.trim();
      loadClientes(1);
    });

    elements.busca.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        state.busca = elements.busca.value.trim();
        loadClientes(1);
      }
    });

    elements.endereco.cep.addEventListener('blur', () => {
      consultarCep(elements.endereco.cep.value);
    });

    if (elements.pendencias.limiteCredito) {
      elements.pendencias.limiteCredito.addEventListener('input', handleLimiteCreditoInput);
      elements.pendencias.limiteCredito.addEventListener('blur', handleLimiteCreditoBlur);
    }

    clearForm();
    loadEmpresas();
    loadClientes();
  });
})();
