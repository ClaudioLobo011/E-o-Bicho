(() => {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const SERVER_URL =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.SERVER_URL) || '';

  const paymentTypeOrder = {
    avista: 0,
    debito: 1,
    credito: 2,
  };

  const caixaActions = [
    {
      id: 'abertura',
      label: 'Abertura de Caixa',
      icon: 'fa-door-open',
      requiresMotivo: false,
      requiresAmount: false,
      affectsPayments: false,
      hint:
        'Informe os valores iniciais nos meios de pagamento abaixo e abra o caixa.',
      isAvailable: (state) => !state.caixaAberto,
      successMessage: 'Caixa aberto com sucesso.',
    },
    {
      id: 'entrada',
      label: 'Entrada',
      icon: 'fa-arrow-down',
      requiresMotivo: true,
      requiresAmount: true,
      affectsPayments: true,
      hint: 'Use esta opção para registrar reforços de caixa e entradas extraordinárias.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Entrada registrada no caixa.',
    },
    {
      id: 'saida',
      label: 'Saída',
      icon: 'fa-arrow-up',
      requiresMotivo: true,
      requiresAmount: true,
      affectsPayments: true,
      hint: 'Registre retiradas ou sangrias informando o motivo.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Saída registrada no caixa.',
    },
    {
      id: 'envio',
      label: 'Envio à Tesouraria',
      icon: 'fa-building-columns',
      requiresMotivo: true,
      requiresAmount: true,
      affectsPayments: true,
      hint: 'Informe o valor enviado e descreva o motivo do envio.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Envio registrado no caixa.',
    },
    {
      id: 'fechamento',
      label: 'Fechamento de caixa',
      icon: 'fa-lock',
      requiresMotivo: false,
      requiresAmount: false,
      affectsPayments: false,
      hint: 'Finalize o caixa após conferir os valores registrados.',
      isAvailable: (state) => state.caixaAberto,
      successMessage: 'Caixa fechado.',
    },
  ];

  const state = {
    stores: [],
    pdvs: [],
    selectedStore: '',
    selectedPdv: '',
    caixaAberto: false,
    allowApuradoEdit: false,
    printPreferences: { fechamento: 'PM', venda: 'PM' },
    selectedAction: null,
    searchResults: [],
    selectedProduct: null,
    quantidade: 1,
    itens: [],
    vendaCliente: null,
    vendaPet: null,
    paymentMethods: [],
    paymentMethodsLoading: false,
    pendingPagamentosData: null,
    pagamentos: [],
    vendaPagamentos: [],
    vendaDesconto: 0,
    vendaAcrescimo: 0,
    customerSearchResults: [],
    customerSearchLoading: false,
    customerSearchQuery: '',
    customerPets: [],
    customerPetsLoading: false,
    modalSelectedCliente: null,
    modalSelectedPet: null,
    modalActiveTab: 'cliente',
    summary: { abertura: 0, recebido: 0, saldo: 0 },
    caixaInfo: {
      aberturaData: null,
      fechamentoData: null,
      fechamentoPrevisto: 0,
      fechamentoApurado: 0,
      previstoPagamentos: [],
      apuradoPagamentos: [],
    },
    history: [],
    lastMovement: null,
    searchController: null,
    deliveryOrders: [],
    deliveryAddresses: [],
    deliveryAddressesLoading: false,
    deliveryAddressSaving: false,
    deliveryAddressFormVisible: false,
    deliverySelectedAddressId: '',
    deliverySelectedAddress: null,
    activeFinalizeContext: null,
    saleStateBackup: null,
    saleCodeIdentifier: '',
    saleCodeSequence: 1,
    currentSaleCode: '',
    deliveryFinalizingOrderId: '',
    completedSales: [],
    activeSaleCancellationId: '',
    fiscalEmissionStep: '',
    fiscalEmissionModalOpen: false,
  };

  const elements = {};
  const customerPetsCache = new Map();
  const customerAddressesCache = new Map();
  const SALE_CODE_STORAGE_PREFIX = 'pdvSaleSequence:';
  const SALE_CODE_PADDING = 6;
  const deliveryStatusSteps = [
    { id: 'registrado', label: 'Registrado' },
    { id: 'emSeparacao', label: 'Em separação' },
    { id: 'emRota', label: 'Em rota' },
    { id: 'finalizado', label: 'Finalizado' },
  ];
  const deliveryStatusOrder = deliveryStatusSteps.map((step) => step.id);
  let finalizeModalDefaults = { title: '', subtitle: '', confirm: '' };
  let deliveryAddressesController = null;
  let statePersistTimeout = null;
  let statePersistInFlight = false;
  let statePersistPending = false;
  let lastPersistSignature = '';
  const normalizeId = (value) => (value == null ? '' : String(value));
  const normalizeStoreRecord = (store) => {
    if (!store || typeof store !== 'object') return store;
    const normalized = { ...store, _id: normalizeId(store._id) };
    if (store.empresa && typeof store.empresa === 'object') {
      normalized.empresa = { ...store.empresa, _id: normalizeId(store.empresa._id) };
    }
    if (store.store && typeof store.store === 'object') {
      normalized.store = { ...store.store, _id: normalizeId(store.store._id) };
    } else if (store.store != null) {
      normalized.store = normalizeId(store.store);
    }
    return normalized;
  };
  const normalizePdvRecord = (pdv) => {
    if (!pdv || typeof pdv !== 'object') return pdv;
    const normalized = { ...pdv, _id: normalizeId(pdv._id) };
    if (pdv.empresa && typeof pdv.empresa === 'object') {
      normalized.empresa = { ...pdv.empresa, _id: normalizeId(pdv.empresa._id) };
    } else if (pdv.empresa != null) {
      normalized.empresa = normalizeId(pdv.empresa);
    }
    if (pdv.store && typeof pdv.store === 'object') {
      normalized.store = { ...pdv.store, _id: normalizeId(pdv.store._id) };
    } else if (pdv.store != null) {
      normalized.store = normalizeId(pdv.store);
    }
    if (pdv.company && typeof pdv.company === 'object') {
      normalized.company = { ...pdv.company, _id: normalizeId(pdv.company._id) };
    } else if (pdv.company != null) {
      normalized.company = normalizeId(pdv.company);
    }
    return normalized;
  };
  const getSaleSequenceStorageKey = (pdvId) =>
    pdvId ? `${SALE_CODE_STORAGE_PREFIX}${pdvId}` : '';
  const readSaleSequenceFromStorage = (pdvId) => {
    if (typeof window === 'undefined') return 1;
    const key = getSaleSequenceStorageKey(pdvId);
    if (!key) return 1;
    try {
      const raw = window.localStorage?.getItem(key);
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    } catch (_) {
      return 1;
    }
  };
  const persistSaleSequence = (pdvId, sequence) => {
    if (typeof window === 'undefined') return;
    const key = getSaleSequenceStorageKey(pdvId);
    if (!key) return;
    try {
      window.localStorage?.setItem(key, String(Math.max(1, Number.parseInt(sequence, 10) || 1)));
    } catch (_) {
      /* storage indisponível */
    }
  };
  const sanitizeSaleCodeIdentifier = (value) => {
    const raw = String(value ?? '');
    const normalized = typeof raw.normalize === 'function' ? raw.normalize('NFD') : raw;
    const base = normalized
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    if (base) {
      return base.slice(0, 12);
    }
    return 'PDV';
  };
  const buildSaleCodeValue = (identifier, sequence) => {
    const safeIdentifier = identifier || 'PDV';
    const safeSequence = Math.max(1, Number.parseInt(sequence, 10) || 1);
    return `${safeIdentifier}-${String(safeSequence).padStart(SALE_CODE_PADDING, '0')}`;
  };
  const refreshCurrentSaleCode = () => {
    if (!state.saleCodeIdentifier || !state.saleCodeSequence) {
      state.currentSaleCode = '';
      return;
    }
    state.currentSaleCode = buildSaleCodeValue(state.saleCodeIdentifier, state.saleCodeSequence);
  };
  const updateSaleCodeDisplay = () => {
    if (!elements.saleCodeWrapper) return;
    const show = Boolean(state.caixaAberto && state.currentSaleCode);
    elements.saleCodeWrapper.classList.toggle('hidden', !show);
    if (elements.saleCodeValue) {
      elements.saleCodeValue.textContent = show ? state.currentSaleCode : '—';
    }
  };
  const initializeSaleCodeForPdv = (pdv) => {
    const pdvId = normalizeId(state.selectedPdv || pdv?._id);
    if (!pdvId) {
      state.saleCodeIdentifier = '';
      state.saleCodeSequence = 1;
      state.currentSaleCode = '';
      updateSaleCodeDisplay();
      return;
    }
    const identifierSource =
      pdv?.saleCodeIdentifier ||
      pdv?.caixa?.saleCodeIdentifier ||
      pdv?.codigo ||
      pdv?.identificador ||
      pdv?.apelido ||
      pdv?.slug ||
      pdv?.nome ||
      pdvId;
    state.saleCodeIdentifier = sanitizeSaleCodeIdentifier(identifierSource);
    const sequenceSource =
      pdv?.saleCodeSequence ?? pdv?.caixa?.saleCodeSequence ?? readSaleSequenceFromStorage(pdvId);
    const parsedSequence = Number.parseInt(sequenceSource, 10);
    state.saleCodeSequence = Number.isFinite(parsedSequence) && parsedSequence >= 1
      ? parsedSequence
      : readSaleSequenceFromStorage(pdvId);
    refreshCurrentSaleCode();
    persistSaleSequence(pdvId, state.saleCodeSequence);
    updateSaleCodeDisplay();
  };
  const advanceSaleCode = () => {
    const pdvId = normalizeId(state.selectedPdv);
    if (!pdvId || !state.saleCodeIdentifier) {
      return;
    }
    const current = Number.parseInt(state.saleCodeSequence, 10);
    const next = Number.isFinite(current) ? current + 1 : 2;
    state.saleCodeSequence = Math.max(1, next);
    refreshCurrentSaleCode();
    persistSaleSequence(pdvId, state.saleCodeSequence);
    updateSaleCodeDisplay();
    scheduleStatePersist();
  };
  const getPdvCompanyId = (pdv) => {
    if (!pdv) return '';
    if (pdv.empresa && typeof pdv.empresa === 'object') return normalizeId(pdv.empresa._id);
    if (pdv.empresa != null) return normalizeId(pdv.empresa);
    if (pdv.company && typeof pdv.company === 'object') return normalizeId(pdv.company._id);
    if (pdv.company != null) return normalizeId(pdv.company);
    if (pdv.store && typeof pdv.store === 'object') return normalizeId(pdv.store._id);
    if (pdv.store != null) return normalizeId(pdv.store);
    return '';
  };
  const findStoreById = (storeId) =>
    state.stores.find((item) => normalizeId(item._id) === normalizeId(storeId));
  const findPdvById = (pdvId) =>
    state.pdvs.find((item) => normalizeId(item._id) === normalizeId(pdvId));
  let searchTimeout = null;
  let customerSearchTimeout = null;
  let customerSearchController = null;
  let customerPetsController = null;
  let paymentModalState = null;

  const createUid = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const notify = (message, type = 'info') => {
    if (typeof window?.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    if (typeof window?.showModal === 'function') {
      window.showModal({
        title: type === 'error' ? 'Erro' : 'Aviso',
        message,
        confirmText: 'OK',
      });
      return;
    }
    window.alert(message);
  };

  const getToken = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.token || '';
    } catch (error) {
      console.warn('Não foi possível obter o token do usuário logado.', error);
      return '';
    }
  };

  const getLoggedUserPayload = () => {
    try {
      const raw = localStorage.getItem('loggedInUser');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.user && typeof parsed.user === 'object') {
          return parsed.user;
        }
        if (parsed.usuario && typeof parsed.usuario === 'object') {
          return parsed.usuario;
        }
      }
      return parsed || {};
    } catch (error) {
      console.warn('Não foi possível obter os dados do usuário logado.', error);
      return {};
    }
  };

  const getLoggedUserName = () => {
    const payload = getLoggedUserPayload();
    return (
      payload?.nome ||
      payload?.name ||
      payload?.usuario?.nome ||
      payload?.usuario?.name ||
      payload?.user?.nome ||
      payload?.user?.name ||
      payload?.login ||
      ''
    );
  };

  const onlyDigits = (value) => String(value || '').replace(/\D+/g, '');

  const sanitizeCepDigits = (value) => onlyDigits(value).slice(0, 8);

  const formatCep = (value) => {
    const digits = sanitizeCepDigits(value);
    if (!digits) return '';
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
  };

  let deliveryCepLookupController = null;
  let deliveryCepLastDigits = '';
  let deliveryCepLastResult = null;
  let deliveryCepLastNotifiedDigits = '';

  const fetchDeliveryCepData = async (cepDigits, signal) => {
    if (!cepDigits || cepDigits.length !== 8) {
      throw new Error('Informe um CEP com 8 dígitos.');
    }
    const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, { signal });
    if (!response.ok) {
      throw new Error('Não foi possível consultar o CEP informado.');
    }
    const data = await response.json();
    if (data?.erro) {
      throw new Error('CEP não encontrado.');
    }
    return {
      cep: formatCep(cepDigits),
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: (data.uf || '').toUpperCase(),
      complemento: data.complemento || '',
    };
  };

  const applyDeliveryAddressFromCep = (data) => {
    if (!data) return;
    const fields = elements.deliveryAddressFields || {};
    if (fields.cep) fields.cep.value = data.cep || '';
    if (fields.logradouro) fields.logradouro.value = data.logradouro || '';
    if (fields.bairro) fields.bairro.value = data.bairro || '';
    if (fields.cidade) fields.cidade.value = data.cidade || '';
    if (fields.uf) fields.uf.value = data.uf || '';
    if (fields.complemento && data.complemento) {
      fields.complemento.value = data.complemento;
    }
  };

  const handleDeliveryCepLookup = async ({ force = false } = {}) => {
    const fields = elements.deliveryAddressFields || {};
    const input = fields.cep;
    if (!input) return null;
    const digits = sanitizeCepDigits(input.value || '');
    input.value = formatCep(digits);
    if (digits.length !== 8) return null;

    if (deliveryCepLastDigits === digits && deliveryCepLastResult) {
      applyDeliveryAddressFromCep(deliveryCepLastResult);
      if (!force) {
        return deliveryCepLastResult;
      }
    }

    if (deliveryCepLookupController) {
      deliveryCepLookupController.abort();
    }
    deliveryCepLookupController = new AbortController();
    try {
      const result = await fetchDeliveryCepData(digits, deliveryCepLookupController.signal);
      deliveryCepLastDigits = digits;
      deliveryCepLastResult = result;
      applyDeliveryAddressFromCep(result);
      if (deliveryCepLastNotifiedDigits !== digits) {
        notify('Endereço preenchido automaticamente pelo CEP.', 'success');
        deliveryCepLastNotifiedDigits = digits;
      }
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return null;
      }
      console.error('Erro ao consultar CEP para o delivery:', error);
      notify(error.message || 'Não foi possível buscar o CEP informado.', 'error');
      return null;
    } finally {
      deliveryCepLookupController = null;
    }
  };

  const buildDeliveryAddressLine = (address) => {
    if (!address) return '';
    const firstLine = [address.logradouro, address.numero].filter(Boolean).join(', ');
    const cityLine = address.cidade && address.uf ? `${address.cidade} - ${address.uf}` : address.cidade || address.uf || '';
    const parts = [firstLine, address.complemento, address.bairro, cityLine];
    if (address.cep) {
      parts.push(`CEP: ${formatCep(address.cep)}`);
    }
    return parts.filter(Boolean).join(' • ');
  };

  const normalizeCustomerAddressRecord = (address, index = 0) => {
    if (!address || typeof address !== 'object') return null;
    const idSource =
      address._id ||
      address.id ||
      address.codigo ||
      address.code ||
      `${Date.now()}-${index}`;
    const apelido =
      address.apelido ||
      address.label ||
      address.nome ||
      address.alias ||
      address.descricao ||
      '';
    const cep = address.cep || address.zip || address.cepFormatado || '';
    const logradouro = address.logradouro || address.endereco || address.street || '';
    const numero = address.numero || address.number || '';
    const complemento = address.complemento || address.complement || '';
    const bairro = address.bairro || address.neighborhood || '';
    const cidade = address.cidade || address.city || '';
    const uf = (address.uf || address.estado || address.state || '').toString().toUpperCase();
    const isDefault = Boolean(address.isDefault || address.principal || address.default);
    const normalized = {
      id: String(idSource),
      apelido: apelido || 'Principal',
      cep,
      logradouro,
      numero,
      complemento,
      bairro,
      cidade,
      uf,
      isDefault,
    };
    normalized.formatted = buildDeliveryAddressLine(normalized);
    return normalized;
  };

  const extractInlineCustomerAddresses = (cliente) => {
    if (!cliente || typeof cliente !== 'object') return [];
    const sources = [];
    if (Array.isArray(cliente.enderecos)) sources.push(...cliente.enderecos);
    if (Array.isArray(cliente.addresses)) sources.push(...cliente.addresses);
    if (cliente.address && typeof cliente.address === 'object') sources.push(cliente.address);
    if (cliente.endereco && typeof cliente.endereco === 'string') {
      sources.push({ logradouro: cliente.endereco });
    }
    return sources;
  };

  const getDeliveryStatusIndex = (statusId) => {
    const index = deliveryStatusOrder.indexOf(statusId);
    return index >= 0 ? index : 0;
  };

  const getDeliveryStatusLabel = (statusId) => {
    const found = deliveryStatusSteps.find((step) => step.id === statusId);
    return found ? found.label : deliveryStatusSteps[0].label;
  };

  const shouldRetryWithoutAuth = (error) =>
    error instanceof TypeError || error?.status === 401 || error?.status === 403;

  const fetchJson = async (url, { errorMessage, ...options } = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      let details = null;
      try {
        details = await response.json();
      } catch (parseError) {
        details = null;
      }
      const message = details?.message || errorMessage || 'Não foi possível carregar os dados solicitados.';
      const requestError = new Error(message);
      requestError.status = response.status;
      requestError.details = details;
      throw requestError;
    }
    return response.json();
  };

  const fetchWithOptionalAuth = async (url, { token, errorMessage, ...options } = {}) => {
    const baseHeaders = { ...(options.headers || {}) };
    if (token) {
      try {
        return await fetchJson(url, {
          ...options,
          headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
          errorMessage,
        });
      } catch (error) {
        if (shouldRetryWithoutAuth(error)) {
          console.warn('Requisição autenticada falhou, tentando novamente sem token:', url, error);
          return fetchJson(url, { ...options, headers: baseHeaders, errorMessage });
        }
        throw error;
      }
    }
    return fetchJson(url, { ...options, headers: baseHeaders, errorMessage });
  };

  const formatCurrency = (value) => {
    const number = Number(value || 0);
    return `R$ ${number.toFixed(2).replace('.', ',')}`;
  };

  const safeNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };

  const normalizePrintMode = (value, fallback = 'PM') => {
    const normalized = (value || '').toString().trim().toUpperCase();
    if (!normalized) return fallback;
    const aliasMap = {
      SIM: 'M',
      MATRICIAL: 'M',
      CUPOM: 'M',
      FISCAL: 'F',
      FIS: 'F',
      PERGUNTAR: 'PM',
      'PERGUNTAR_MATRICIAL': 'PM',
      'PERGUNTAR-FISCAL': 'PF',
      'PERGUNTAR_FISCAL': 'PF',
      PM: 'PM',
      PF: 'PF',
      M: 'M',
      F: 'F',
      NAO: 'NONE',
      'NÃO': 'NONE',
      N: 'NONE',
      NENHUM: 'NONE',
      DESATIVADO: 'NONE',
    };
    if (aliasMap[normalized]) {
      return aliasMap[normalized];
    }
    if (['F', 'M', 'PF', 'PM'].includes(normalized)) {
      return normalized;
    }
    return fallback;
  };

  const resolvePrintVariant = (mode) =>
    mode === 'F' || mode === 'PF' ? 'fiscal' : 'matricial';

  const getPrintBaseMode = (mode) => {
    const normalized = normalizePrintMode(mode, 'M');
    if (normalized === 'PF' || normalized === 'F') {
      return 'F';
    }
    return 'M';
  };

  const isPrintPromptEnabled = (mode) => {
    const normalized = normalizePrintMode(mode, 'PM');
    return normalized === 'PF' || normalized === 'PM';
  };

  const buildPrintMode = (baseMode, promptEnabled) => {
    if (promptEnabled) {
      return baseMode === 'F' ? 'PF' : 'PM';
    }
    return baseMode === 'F' ? 'F' : 'M';
  };

  const PRINT_MODE_LABELS = {
    M: 'Matricial',
    F: 'Fiscal',
    PM: 'Perguntar Matricial',
    PF: 'Perguntar Fiscal',
    NONE: 'Sem impressão',
  };
  const PRINT_PROMPT_LABELS = {
    ask: 'Perguntar',
    skip: 'Não perguntar',
  };

  const getPrintTypeLabel = (type) => (type === 'fechamento' ? 'fechamento' : 'venda');

  const getPrintPromptDescription = (type, promptEnabled, baseMode) => {
    const label = getPrintTypeLabel(type);
    if (promptEnabled) {
      return `Perguntar antes de imprimir ${label} no modo ${
        baseMode === 'F' ? 'Fiscal' : 'Matricial'
      }.`;
    }
    return `Imprimir ${label} imediatamente no modo ${
      baseMode === 'F' ? 'Fiscal' : 'Matricial'
    }.`;
  };

  const getPrintModeDescription = (type, mode) => {
    const label = getPrintTypeLabel(type);
    const normalized =
      type === 'venda' && (mode === 'PF' || mode === 'PM')
        ? mode === 'PF'
          ? 'F'
          : 'M'
        : mode;
    switch (normalized) {
      case 'F':
        return `Imprimir ${label} no modo Fiscal.`;
      case 'M':
        return `Imprimir ${label} no modo Matricial.`;
      case 'PF':
        return `Perguntar antes de imprimir ${label} no modo Fiscal.`;
      case 'PM':
        return `Perguntar antes de imprimir ${label} no modo Matricial.`;
      case 'NONE':
        return `Não imprimir automaticamente o ${label}.`;
      default:
        return `Definir preferência de impressão para ${label}.`;
    }
  };

  const canApplyGeneralPromotion = () => Boolean(state.vendaCliente);

  const hasGeneralPromotion = (product) =>
    Boolean(product?.promocao?.ativa && safeNumber(product.promocao.porcentagem) > 0);

  const buildProductSnapshot = (product) => {
    if (!product || typeof product !== 'object') return {};
    return {
      _id: product._id || product.id || '',
      nome: product.nome || product.descricao || '',
      codigoInterno: product.codigoInterno || product.codInterno || '',
      codigo:
        product.codigo ||
        product.codigoReferencia ||
        product.sku ||
        product.codigoInterno ||
        product.codInterno ||
        '',
      codigoBarras:
        product.codigoBarras ||
        product.codigoDeBarras ||
        product.barras ||
        product.ean ||
        product.codbarras ||
        '',
      promocao: product.promocao ? { ...product.promocao } : null,
      precoClube: product.precoClube || null,
      venda: product.venda,
      precoVenda: product.precoVenda,
      preco: product.preco,
      valor: product.valor,
      price: product.price,
    };
  };

  const parseDateValue = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const getStoreLabel = () => {
    const store = findStoreById(state.selectedStore);
    return (
      store?.nome ||
      store?.nomeFantasia ||
      store?.razaoSocial ||
      store?.razao ||
      store?.fantasia ||
      '—'
    );
  };

  const getPdvLabel = () => {
    const pdv = findPdvById(state.selectedPdv);
    return pdv?.nome || pdv?.codigo || pdv?.identificador || pdv?._id || '—';
  };

  const formatPrintLine = (label, value, width = 58) => {
    const left = String(label ?? '').trim();
    const right = String(value ?? '').trim();
    const space = Math.max(width - left.length - right.length - 2, 2);
    const filler = '-'.repeat(space);
    return `${left} ${filler} ${right}`;
  };

  const clonePayments = (payments) =>
    Array.isArray(payments) ? payments.map((item) => ({ ...item })) : [];

  const sumPayments = (payments) =>
    Array.isArray(payments)
      ? payments.reduce((total, payment) => total + safeNumber(payment?.valor), 0)
      : 0;

  const describePaymentValues = (payments) =>
    (Array.isArray(payments) ? payments : [])
      .filter((payment) => safeNumber(payment?.valor) > 0)
      .map((payment) => `${payment.label || 'Pagamento'} ${formatCurrency(payment.valor)}`)
      .join(' | ');

  const createPaymentItems = (payments, { hideZero = true } = {}) => {
    const items = (Array.isArray(payments) ? payments : []).map((payment) => {
      const label =
        payment?.label ||
        payment?.nome ||
        payment?.name ||
        payment?.descricao ||
        'Meio de pagamento';
      const value = safeNumber(payment?.valor);
      return {
        label,
        value,
        formattedValue: formatCurrency(value),
      };
    });

    if (!hideZero) {
      return items;
    }

    const filtered = items.filter((item) => Math.abs(item.value) > 0.009);
    return filtered.length ? filtered : items;
  };

  const getFechamentoSnapshot = () => {
    if (!state.selectedStore || !state.selectedPdv) {
      return null;
    }

    const aberturaLabel = toDateLabel(state.caixaInfo.aberturaData);
    const fechamentoLabel = toDateLabel(state.caixaInfo.fechamentoData);

    const aberturaValor = safeNumber(state.summary.abertura);
    const recebidoValor = safeNumber(state.summary.recebido);
    const saldoValor = safeNumber(state.summary.saldo);

    const recebimentosItems = createPaymentItems(state.pagamentos);
    const recebimentosTotal = sumPayments(state.pagamentos);

    const hasPrevistoPagamentos = Array.isArray(state.caixaInfo.previstoPagamentos)
      ? state.caixaInfo.previstoPagamentos.length > 0
      : false;
    const previstoFonte = hasPrevistoPagamentos
      ? state.caixaInfo.previstoPagamentos
      : state.pagamentos;
    const previstoItems = createPaymentItems(previstoFonte);
    const previstoTotal = state.caixaInfo.fechamentoPrevisto || sumPayments(previstoFonte);

    const apuradoFonte = state.allowApuradoEdit
      ? state.pagamentos
      : state.caixaInfo.apuradoPagamentos || [];
    const apuradoItems = createPaymentItems(apuradoFonte);
    const apuradoTotal = state.caixaInfo.fechamentoApurado || sumPayments(apuradoFonte);

    return {
      meta: {
        store: getStoreLabel(),
        pdv: getPdvLabel(),
        abertura: aberturaLabel,
        fechamento: fechamentoLabel === '—' ? 'Em aberto' : fechamentoLabel,
      },
      resumo: {
        abertura: {
          value: aberturaValor,
          formatted: formatCurrency(aberturaValor),
        },
        recebido: {
          value: recebidoValor,
          formatted: formatCurrency(recebidoValor),
        },
        saldo: {
          value: saldoValor,
          formatted: formatCurrency(saldoValor),
        },
      },
      recebimentos: {
        items: recebimentosItems,
        total: recebimentosTotal,
        formattedTotal: formatCurrency(recebimentosTotal),
      },
      previsto: {
        items: previstoItems,
        total: previstoTotal,
        formattedTotal: formatCurrency(previstoTotal),
      },
      apurado: {
        items: apuradoItems,
        total: apuradoTotal,
        formattedTotal: formatCurrency(apuradoTotal),
      },
    };

  };

  const getSaleReceiptSnapshot = (
    items = state.itens,
    payments = state.vendaPagamentos,
    options = {}
  ) => {
    const saleItems = Array.isArray(items) ? items : [];
    if (!state.selectedStore || !state.selectedPdv || !saleItems.length) {
      return null;
    }

    const nowLabel = toDateLabel(new Date().toISOString());
    const operatorName = getLoggedUserName();
    const saleCode = options.saleCode || state.currentSaleCode || '';

    const normalizeQuantity = (value) => {
      const number = safeNumber(value);
      return number.toLocaleString('pt-BR', {
        minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
        maximumFractionDigits: 3,
      });
    };

    const itens = saleItems.map((item, index) => {
      const codes = [];
      if (item.codigoInterno) {
        codes.push(`Int.: ${item.codigoInterno}`);
      }
      if (item.codigoBarras) {
        codes.push(`Barras: ${item.codigoBarras}`);
      }
      if (!codes.length && item.codigo) {
        codes.push(`Cód.: ${item.codigo}`);
      }
      return {
        index: String(index + 1).padStart(2, '0'),
        nome: item.nome || 'Item da venda',
        codigo: codes.join(' • '),
        quantidade: normalizeQuantity(item.quantidade || 0),
        unitario: formatCurrency(item.valor || item.preco || 0),
        subtotal: formatCurrency(item.subtotal || 0),
      };
    });

    const descontoValor = Math.max(0, safeNumber(state.vendaDesconto));
    const acrescimoValor = Math.max(0, safeNumber(state.vendaAcrescimo));
    const bruto = saleItems.reduce((sum, item) => sum + safeNumber(item.subtotal), 0);
    const liquidoValor = Math.max(0, bruto + acrescimoValor - descontoValor);
    const pagamentoItems = (Array.isArray(payments) ? payments : []).map((payment) => {
      const parcelasLabel = payment.parcelas && payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
      return {
        label: `${payment.label || 'Pagamento'}${parcelasLabel}`,
        formatted: formatCurrency(payment.valor || 0),
        valor: safeNumber(payment.valor),
      };
    });
    const pagoValor = pagamentoItems.reduce((sum, item) => sum + safeNumber(item.valor), 0);
    const trocoValor = Math.max(0, pagoValor - liquidoValor);

    const cliente = state.vendaCliente
      ? {
          nome:
            state.vendaCliente.nome ||
            state.vendaCliente.razaoSocial ||
            state.vendaCliente.fantasia ||
            'Cliente',
          documento:
            state.vendaCliente.cpf ||
            state.vendaCliente.cnpj ||
            state.vendaCliente.documento ||
            '',
          contato:
            state.vendaCliente.telefone ||
            state.vendaCliente.celular ||
            state.vendaCliente.email ||
            '',
          pet: state.vendaPet?.nome || '',
        }
      : null;

    const deliverySource = options.deliveryAddress || state.deliverySelectedAddress || null;
    const deliveryAddress = deliverySource
      ? {
          apelido: deliverySource.apelido || 'Entrega',
          formatted: buildDeliveryAddressLine(deliverySource),
          cep: deliverySource.cep || '',
          logradouro: deliverySource.logradouro || '',
          numero: deliverySource.numero || '',
          complemento: deliverySource.complemento || '',
          bairro: deliverySource.bairro || '',
          cidade: deliverySource.cidade || '',
          uf: deliverySource.uf || '',
        }
      : null;

    return {
      meta: {
        store: getStoreLabel(),
        pdv: getPdvLabel(),
        data: nowLabel,
        operador: operatorName,
        saleCode,
      },
      cliente,
      delivery: deliveryAddress,
      itens,
      totais: {
        bruto: formatCurrency(bruto),
        desconto: formatCurrency(descontoValor),
        descontoValor,
        acrescimo: formatCurrency(acrescimoValor),
        acrescimoValor,
        liquido: formatCurrency(liquidoValor),
        pago: formatCurrency(pagoValor),
        troco: formatCurrency(trocoValor),
        trocoValor,
      },
      pagamentos: {
        items: pagamentoItems,
        total: pagoValor,
        formattedTotal: formatCurrency(pagoValor),
      },
    };
  };

  const toDateLabel = (isoString) => {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const normalizePaymentMethod = (method) => {
    if (!method) {
      return null;
    }
    const idSource =
      method._id || method.id || method.code || method.nome || method.name || method.label;
    const id = idSource ? String(idSource) : createUid();
    const label =
      method.name || method.nome || method.label || method.code || 'Meio de pagamento';
    const type = (method.type || 'avista').toLowerCase();
    const code = method.code ? String(method.code) : '';
    const rawInstallments = Array.isArray(method.installmentConfigurations)
      ? method.installmentConfigurations
      : [];
    const installmentConfigurations = rawInstallments
      .map((config) => ({
        number:
          Number(
            config?.number ?? config?.installment ?? config?.parcelas ?? config?.parcela ?? 0
          ) || 0,
        discount: safeNumber(config?.discount ?? config?.desconto ?? 0),
        days: safeNumber(config?.days ?? config?.prazo ?? config?.dias ?? method?.days ?? 0),
      }))
      .filter((config) => Number.isFinite(config.number) && config.number >= 1)
      .sort((a, b) => a.number - b.number);
    let installments = installmentConfigurations.map((config) => config.number);
    if (!installments.length) {
      const total = Number(method.installments) || 0;
      if (total > 0) {
        installments = Array.from({ length: total }, (_, index) => index + 1);
      } else {
        installments = [1];
      }
    }
    const uniqueInstallments = Array.from(
      new Set(
        installments
          .map((value) => Number(value) || 0)
          .filter((value) => Number.isFinite(value) && value >= 1)
      )
    ).sort((a, b) => a - b);
    const aliases = Array.from(
      new Set(
        [
          id,
          code,
          label,
          method.nome,
          method.name,
          method.label,
          method.codigo,
          method.slug,
          method.tipo,
          method.type,
        ]
          .filter(Boolean)
          .map((value) => String(value))
      )
    );
    return {
      id,
      label,
      type,
      code,
      installments: uniqueInstallments,
      installmentConfigurations,
      aliases,
      raw: method,
    };
  };

  const extractPaymentAmount = (value) => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' || typeof value === 'string') {
      return safeNumber(value);
    }
    if (typeof value === 'object') {
      if ('valor' in value) return extractPaymentAmount(value.valor);
      if ('value' in value) return extractPaymentAmount(value.value);
      if ('amount' in value) return extractPaymentAmount(value.amount);
      if ('total' in value) return extractPaymentAmount(value.total);
      if ('saldo' in value) return extractPaymentAmount(value.saldo);
    }
    return 0;
  };

  const buildPaymentValuesMap = (data) => {
    const map = new Map();
    const register = (key, amount) => {
      if (key === undefined || key === null) return;
      const normalizedKey = String(key).trim();
      if (!normalizedKey) return;
      const value = safeNumber(amount);
      map.set(normalizedKey, value);
      map.set(normalizedKey.toLowerCase(), value);
    };
    if (Array.isArray(data)) {
      data.forEach((item) => {
        const value = extractPaymentAmount(
          item?.valor ?? item?.value ?? item?.amount ?? item?.total ?? item?.saldo ?? item
        );
        [
          item?.id,
          item?._id,
          item?.code,
          item?.codigo,
          item?.label,
          item?.nome,
          item?.name,
          item?.tipo,
          item?.type,
          item?.payment,
          item?.forma,
        ].forEach((key) => register(key, value));
      });
    } else if (data && typeof data === 'object') {
      Object.entries(data).forEach(([key, rawValue]) => {
        const value = extractPaymentAmount(rawValue);
        register(key, value);
        if (rawValue && typeof rawValue === 'object') {
          [
            rawValue?.id,
            rawValue?._id,
            rawValue?.code,
            rawValue?.codigo,
            rawValue?.label,
            rawValue?.nome,
            rawValue?.name,
            rawValue?.tipo,
            rawValue?.type,
          ].forEach((nested) => register(nested, value));
        }
      });
    }
    return map;
  };

  const updatePaymentMethods = (methods) => {
    const normalized = Array.isArray(methods)
      ? methods
          .map((method) => normalizePaymentMethod(method))
          .filter(Boolean)
          .sort((a, b) => {
            const typeDiff =
              (paymentTypeOrder[a.type] ?? Number.MAX_SAFE_INTEGER) -
              (paymentTypeOrder[b.type] ?? Number.MAX_SAFE_INTEGER);
            if (typeDiff !== 0) return typeDiff;
            return a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' });
          })
      : [];
    const previousValues = new Map(
      state.pagamentos.map((item) => [item.id, safeNumber(item.valor)])
    );
    state.paymentMethods = normalized;
    state.pagamentos = normalized.map((method) => ({
      ...method,
      valor: previousValues.has(method.id) ? previousValues.get(method.id) : 0,
    }));
    renderSalePaymentMethods();
    if (state.pendingPagamentosData) {
      const pending = state.pendingPagamentosData;
      state.pendingPagamentosData = null;
      applyPagamentosData(pending);
      return;
    }
    renderPayments();
    updateSummary();
    populatePaymentSelect();
  };

  const applyPagamentosData = (data) => {
    if (!state.paymentMethods.length) {
      state.pendingPagamentosData = data;
      return;
    }
    const valuesMap = buildPaymentValuesMap(data);
    const updated = state.paymentMethods.map((method) => {
      const candidates = [method.id, method.code, method.label, ...(method.aliases || [])];
      let valor = 0;
      for (const candidate of candidates) {
        if (!candidate) continue;
        const key = String(candidate);
        if (valuesMap.has(key)) {
          valor = safeNumber(valuesMap.get(key));
          break;
        }
        const lower = key.toLowerCase();
        if (valuesMap.has(lower)) {
          valor = safeNumber(valuesMap.get(lower));
          break;
        }
      }
      return { ...method, valor };
    });
    state.pagamentos = updated;
    state.pendingPagamentosData = null;
    renderPayments();
    updateSummary();
    populatePaymentSelect();
  };

  const normalizePaymentSnapshotForPersist = (payment) => {
    if (!payment || typeof payment !== 'object') return null;
    const id = payment.id ? String(payment.id) : createUid();
    const label = payment.label ? String(payment.label) : 'Pagamento';
    const type = payment.type ? String(payment.type) : 'avista';
    const aliases = Array.isArray(payment.aliases)
      ? payment.aliases.map((alias) => String(alias)).filter(Boolean)
      : [];
    const valor = safeNumber(payment.valor ?? payment.value ?? 0);
    const parcelasRaw = payment.parcelas ?? payment.installments ?? 1;
    const parcelas = Math.max(1, Number.parseInt(parcelasRaw, 10) || 1);
    return { id, label, type, aliases, valor, parcelas };
  };

  const normalizeHistoryEntryForPersist = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    return {
      id: entry.id ? String(entry.id) : createUid(),
      label: entry.label ? String(entry.label) : 'Movimentação',
      amount: safeNumber(entry.amount ?? entry.valor ?? 0),
      delta: safeNumber(entry.delta ?? entry.valor ?? 0),
      motivo: entry.motivo ? String(entry.motivo) : '',
      paymentLabel: entry.paymentLabel ? String(entry.paymentLabel) : '',
      paymentId: entry.paymentId ? String(entry.paymentId) : '',
      timestamp: timestamp.toISOString(),
    };
  };

  const normalizeSaleRecordForPersist = (record) => {
    if (!record || typeof record !== 'object') return null;
    const createdAt = record.createdAt ? new Date(record.createdAt) : new Date();
    return {
      id: record.id ? String(record.id) : createUid(),
      type: record.type ? String(record.type) : 'venda',
      typeLabel: record.typeLabel ? String(record.typeLabel) : '',
      saleCode: record.saleCode ? String(record.saleCode) : '',
      saleCodeLabel: record.saleCodeLabel ? String(record.saleCodeLabel) : '',
      customerName: record.customerName ? String(record.customerName) : 'Cliente não informado',
      customerDocument: record.customerDocument ? String(record.customerDocument) : '',
      paymentTags: Array.isArray(record.paymentTags)
        ? record.paymentTags.map((tag) => String(tag)).filter(Boolean)
        : [],
      items: Array.isArray(record.items) ? record.items.map((item) => ({ ...item })) : [],
      discountValue: safeNumber(record.discountValue ?? 0),
      discountLabel: record.discountLabel ? String(record.discountLabel) : '',
      additionValue: safeNumber(record.additionValue ?? 0),
      createdAt: createdAt.toISOString(),
      createdAtLabel: record.createdAtLabel ? String(record.createdAtLabel) : '',
      receiptSnapshot: record.receiptSnapshot || null,
      fiscalStatus: record.fiscalStatus ? String(record.fiscalStatus) : '',
      fiscalEmittedAt: record.fiscalEmittedAt ? new Date(record.fiscalEmittedAt).toISOString() : null,
      fiscalEmittedAtLabel: record.fiscalEmittedAtLabel ? String(record.fiscalEmittedAtLabel) : '',
      fiscalDriveFileId: record.fiscalDriveFileId ? String(record.fiscalDriveFileId) : '',
      fiscalXmlUrl: record.fiscalXmlUrl ? String(record.fiscalXmlUrl) : '',
      fiscalXmlName: record.fiscalXmlName ? String(record.fiscalXmlName) : '',
      fiscalXmlContent: record.fiscalXmlContent ? String(record.fiscalXmlContent) : '',
      fiscalQrCodeData: record.fiscalQrCodeData ? String(record.fiscalQrCodeData) : '',
      fiscalQrCodeImage: record.fiscalQrCodeImage ? String(record.fiscalQrCodeImage) : '',
      fiscalEnvironment: record.fiscalEnvironment ? String(record.fiscalEnvironment) : '',
      fiscalSerie: record.fiscalSerie ? String(record.fiscalSerie) : '',
      fiscalNumber:
        record.fiscalNumber !== undefined && record.fiscalNumber !== null
          ? (() => {
              const numeric = Number(record.fiscalNumber);
              if (!Number.isFinite(numeric)) return null;
              const integer = Math.floor(numeric);
              return integer >= 0 ? integer : null;
            })()
          : null,
      fiscalAccessKey: record.fiscalAccessKey ? String(record.fiscalAccessKey) : '',
      fiscalDigestValue: record.fiscalDigestValue ? String(record.fiscalDigestValue) : '',
      fiscalSignature: record.fiscalSignature ? String(record.fiscalSignature) : '',
      fiscalProtocol: record.fiscalProtocol ? String(record.fiscalProtocol) : '',
      fiscalItemsSnapshot: Array.isArray(record.fiscalItemsSnapshot)
        ? record.fiscalItemsSnapshot.map((item) => (item && typeof item === 'object' ? { ...item } : item))
        : [],
      expanded: Boolean(record.expanded),
      status: record.status ? String(record.status) : 'completed',
      cancellationReason: record.cancellationReason ? String(record.cancellationReason) : '',
      cancellationAt: record.cancellationAt ? new Date(record.cancellationAt).toISOString() : null,
      cancellationAtLabel: record.cancellationAtLabel ? String(record.cancellationAtLabel) : '',
    };
  };

  const buildStatePersistPayload = () => {
    const pagamentos = (Array.isArray(state.pagamentos) ? state.pagamentos : [])
      .map((payment) => normalizePaymentSnapshotForPersist(payment))
      .filter(Boolean);
    const previstoPagamentos = (Array.isArray(state.caixaInfo.previstoPagamentos)
      ? state.caixaInfo.previstoPagamentos
      : [])
      .map((payment) => normalizePaymentSnapshotForPersist(payment))
      .filter(Boolean);
    const apuradoPagamentos = (Array.isArray(state.caixaInfo.apuradoPagamentos)
      ? state.caixaInfo.apuradoPagamentos
      : [])
      .map((payment) => normalizePaymentSnapshotForPersist(payment))
      .filter(Boolean);
    const history = (Array.isArray(state.history) ? state.history : [])
      .map((entry) => normalizeHistoryEntryForPersist(entry))
      .filter(Boolean);
    const completedSales = (Array.isArray(state.completedSales) ? state.completedSales : [])
      .map((sale) => normalizeSaleRecordForPersist(sale))
      .filter(Boolean);

    return {
      caixaAberto: Boolean(state.caixaAberto),
      summary: {
        abertura: safeNumber(state.summary.abertura),
        recebido: safeNumber(state.summary.recebido),
        saldo: safeNumber(state.summary.saldo),
      },
      caixaInfo: {
        aberturaData: state.caixaInfo.aberturaData || null,
        fechamentoData: state.caixaInfo.fechamentoData || null,
        fechamentoPrevisto: safeNumber(state.caixaInfo.fechamentoPrevisto),
        fechamentoApurado: safeNumber(state.caixaInfo.fechamentoApurado),
        previstoPagamentos,
        apuradoPagamentos,
      },
      pagamentos,
      history,
      completedSales,
      lastMovement: state.lastMovement ? normalizeHistoryEntryForPersist(state.lastMovement) : null,
      saleCodeIdentifier: state.saleCodeIdentifier || '',
      saleCodeSequence: Math.max(1, Number.parseInt(state.saleCodeSequence, 10) || 1),
      printPreferences:
        state.printPreferences && typeof state.printPreferences === 'object'
          ? { ...state.printPreferences }
          : { fechamento: 'PM', venda: 'PM' },
    };
  };

  const sendStatePersistRequest = async (payload) => {
    const pdvId = normalizeId(state.selectedPdv);
    if (!pdvId) return;
    const token = getToken();
    await fetchWithOptionalAuth(`${API_BASE}/pdvs/${encodeURIComponent(pdvId)}/state`, {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      errorMessage: 'Não foi possível salvar o estado do PDV.',
    });
  };

  const flushStatePersist = async () => {
    const pdvId = normalizeId(state.selectedPdv);
    if (!pdvId) return;
    const payload = buildStatePersistPayload();
    const signature = JSON.stringify(payload);
    if (signature === lastPersistSignature) {
      return;
    }
    try {
      await sendStatePersistRequest(payload);
      lastPersistSignature = signature;
    } catch (error) {
      console.error('Erro ao salvar estado do PDV:', error);
    }
  };

  const scheduleStatePersist = ({ immediate = false } = {}) => {
    if (!state.selectedPdv) return;
    if (typeof window === 'undefined') return;
    if (statePersistTimeout) {
      window.clearTimeout(statePersistTimeout);
      statePersistTimeout = null;
    }
    const delay = immediate ? 0 : 400;
    statePersistTimeout = window.setTimeout(async () => {
      statePersistTimeout = null;
      if (statePersistInFlight) {
        statePersistPending = true;
        return;
      }
      statePersistInFlight = true;
      try {
        await flushStatePersist();
      } finally {
        statePersistInFlight = false;
        if (statePersistPending) {
          statePersistPending = false;
          scheduleStatePersist({ immediate: true });
        }
      }
    }, delay);
  };

  const getProductCode = (product) => {
    return (
      product?.codigoInterno ||
      product?.codigo ||
      product?.codInterno ||
      product?.codigoReferencia ||
      product?.sku ||
      product?._id ||
      product?.id ||
      ''
    );
  };

  const getProductBarcode = (product) => {
    return (
      product?.codigoBarras ||
      product?.codigoDeBarras ||
      product?.barras ||
      product?.ean ||
      product?.codbarras ||
      ''
    );
  };

  const normalizeBarcodeValue = (value) => String(value ?? '').replace(/\s+/g, '');

  const getImageUrl = (product) => {
    const path =
      product?.imagemPrincipal ||
      product?.imagem ||
      product?.foto ||
      product?.capa ||
      '';
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const base = SERVER_URL.endsWith('/') ? SERVER_URL.slice(0, -1) : SERVER_URL;
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const getBasePrice = (product) => {
    return safeNumber(
      product?.venda ||
        product?.precoVenda ||
        product?.preco ||
        product?.price ||
        product?.valor ||
        0
    );
  };

  const getFinalPrice = (product) => {
    const base = getBasePrice(product);
    if (!product) return base;
    if (hasGeneralPromotion(product)) {
      if (!canApplyGeneralPromotion()) {
        return base;
      }
      const desconto = base * (safeNumber(product.promocao.porcentagem) / 100);
      return Math.max(base - desconto, 0);
    }
    if (product?.precoClube && safeNumber(product.precoClube) > 0 && product.precoClube < base) {
      return safeNumber(product.precoClube);
    }
    return base;
  };

  const queryElements = () => {
    elements.companySelect = document.getElementById('company-select');
    elements.pdvSelect = document.getElementById('pdv-select');
    elements.selectionHint = document.getElementById('pdv-selection-hint');

    elements.emptyState = document.getElementById('pdv-empty-state');
    elements.workspace = document.getElementById('pdv-workspace');
    elements.statusBadge = document.getElementById('pdv-status-badge');
    elements.saleCodeWrapper = document.getElementById('pdv-sale-code-wrapper');
    elements.saleCodeValue = document.getElementById('pdv-sale-code');
    elements.printControls = document.getElementById('pdv-print-controls');
    elements.companyLabel = document.getElementById('pdv-company-label');
    elements.pdvLabel = document.getElementById('pdv-name-label');
    elements.selectedInfo = document.getElementById('pdv-selected-info');

    elements.tabTriggers = document.querySelectorAll('.pdv-tab-trigger');
    elements.tabPanels = document.querySelectorAll('[data-tab-panel]');

    elements.searchInput = document.getElementById('pdv-product-search');
    elements.searchResults = document.getElementById('pdv-product-results');

    elements.selectedImage = document.getElementById('pdv-selected-image');
    elements.selectedPlaceholder = document.getElementById('pdv-selected-placeholder');
    elements.selectedName = document.getElementById('pdv-selected-name');
    elements.selectedSku = document.getElementById('pdv-selected-sku');
    elements.selectedPrice = document.getElementById('pdv-selected-price');
    elements.selectedOriginalPrice = document.getElementById('pdv-selected-original-price');
    elements.selectedPromoBadge = document.getElementById('pdv-selected-promo');
    elements.selectedGeneralWarning = document.getElementById('pdv-selected-general-warning');

    elements.itemValue = document.getElementById('pdv-item-value');
    elements.itemQuantity = document.getElementById('pdv-item-quantity');
    elements.itemTotal = document.getElementById('pdv-item-total');
    elements.addItem = document.getElementById('pdv-add-item');
    elements.quantityButtons = document.querySelectorAll('.quantity-button');

    elements.itemsList = document.getElementById('pdv-items-list');
    elements.itemsEmpty = document.getElementById('pdv-items-empty');
    elements.itemsCount = document.getElementById('pdv-items-count');
    elements.itemsTotal = document.getElementById('pdv-items-total');
    elements.finalizeButton = document.getElementById('pdv-finalize-sale');
    elements.saleActionButtons = document.querySelectorAll('[data-sale-action]');

    elements.customerOpenButton = document.getElementById('pdv-open-customer');
    elements.customerOpenButtonLabel = document.getElementById('pdv-open-customer-label');
    elements.customerSummaryEmpty = document.getElementById('pdv-customer-summary-empty');
    elements.customerSummaryInfo = document.getElementById('pdv-customer-summary-info');
    elements.customerName = document.getElementById('pdv-customer-name');
    elements.customerDoc = document.getElementById('pdv-customer-doc');
    elements.customerContact = document.getElementById('pdv-customer-contact');
    elements.customerPet = document.getElementById('pdv-customer-pet');
    elements.customerRemove = document.getElementById('pdv-customer-remove');

    elements.customerModal = document.getElementById('pdv-customer-modal');
    elements.customerModalClose = document.getElementById('pdv-customer-close');
    elements.customerModalBackdrop =
      elements.customerModal?.querySelector('[data-pdv-customer-dismiss]') || null;
    elements.customerTabButtons =
      elements.customerModal?.querySelectorAll('[data-pdv-customer-tab]') || [];
    elements.customerModalPanels =
      elements.customerModal?.querySelectorAll('[data-pdv-customer-panel]') || [];
    elements.customerSearchInput = document.getElementById('pdv-customer-search');
    elements.customerResultsList = document.getElementById('pdv-customer-results');
    elements.customerResultsEmpty = document.getElementById('pdv-customer-results-empty');
    elements.customerResultsLoading = document.getElementById('pdv-customer-results-loading');
    elements.customerPetsList = document.getElementById('pdv-customer-pets');
    elements.customerPetsEmpty = document.getElementById('pdv-customer-pets-empty');
    elements.customerPetsLoading = document.getElementById('pdv-customer-pets-loading');
    elements.customerConfirm = document.getElementById('pdv-customer-confirm');
    elements.customerClear = document.getElementById('pdv-customer-clear');
    elements.customerCancel = document.getElementById('pdv-customer-cancel');

    elements.caixaActions = document.getElementById('pdv-caixa-actions');
    elements.caixaStateLabel = document.getElementById('pdv-caixa-state-label');
    elements.actionDetails = document.getElementById('pdv-caixa-action-details');
    elements.actionValuesWrapper = document.getElementById('pdv-action-values-wrapper');
    elements.actionAmount = document.getElementById('pdv-action-amount');
    elements.paymentSelect = document.getElementById('pdv-opening-payment');
    elements.motivoWrapper = document.getElementById('pdv-caixa-motivo-wrapper');
    elements.motivoInput = document.getElementById('pdv-caixa-motivo');
    elements.actionHint = document.getElementById('pdv-caixa-action-hint');
    elements.actionConfirm = document.getElementById('pdv-caixa-action-confirm');

    elements.paymentList = document.getElementById('pdv-payment-list');
    elements.resetPayments = document.getElementById('pdv-reset-payments');

    elements.summaryPrint = document.getElementById('pdv-summary-print');
    elements.summaryLastMove = document.getElementById('pdv-summary-last-move');

    elements.historyList = document.getElementById('pdv-history-list');
    elements.historyEmpty = document.getElementById('pdv-history-empty');
    elements.clearHistory = document.getElementById('pdv-clear-history');

    elements.salesList = document.getElementById('pdv-sales-list');
    elements.salesEmpty = document.getElementById('pdv-sales-empty');

    elements.saleCancelModal = document.getElementById('pdv-sale-cancel-modal');
    elements.saleCancelClose = document.getElementById('pdv-sale-cancel-close');
    elements.saleCancelCancel = document.getElementById('pdv-sale-cancel-cancel');
    elements.saleCancelConfirm = document.getElementById('pdv-sale-cancel-confirm');
    elements.saleCancelReason = document.getElementById('pdv-sale-cancel-reason');
    elements.saleCancelError = document.getElementById('pdv-sale-cancel-error');
    elements.saleCancelBackdrop =
      elements.saleCancelModal?.querySelector('[data-sale-cancel-dismiss="backdrop"]') || null;

    elements.finalizeModal = document.getElementById('pdv-finalize-modal');
    elements.finalizeClose = document.getElementById('pdv-finalize-close');
    elements.finalizeBack = document.getElementById('pdv-sale-back');
    elements.finalizeConfirm = document.getElementById('pdv-sale-confirm');
    elements.finalizeDifference = document.getElementById('pdv-sale-difference');
    elements.finalizeBackdrop = elements.finalizeModal?.querySelector('[data-pdv-finalize-dismiss]') || null;
    elements.saleMethods = document.getElementById('pdv-sale-methods');
    elements.salePaymentsList = document.getElementById('pdv-sale-payments-preview');
    elements.salePaymentsEmpty = document.getElementById('pdv-sale-payments-empty');
    elements.saleTotal = document.getElementById('pdv-sale-total');
    elements.saleDiscount = document.getElementById('pdv-sale-discount');
    elements.salePaid = document.getElementById('pdv-sale-paid');
    elements.saleAdjust = document.getElementById('pdv-sale-adjust');
    elements.saleItemAdjust = document.getElementById('pdv-sale-item-adjust');

    elements.fiscalStatusModal = document.getElementById('pdv-fiscal-status-modal');
    elements.fiscalStatusTitle = document.getElementById('pdv-fiscal-status-title');
    elements.fiscalStatusSteps = document.getElementById('pdv-fiscal-status-steps');

    elements.deliveryList = document.getElementById('pdv-delivery-list');
    elements.deliveryEmpty = document.getElementById('pdv-delivery-empty');

    elements.paymentValueModal = document.getElementById('pdv-payment-value-modal');
    elements.paymentValueTitle = document.getElementById('pdv-payment-value-title');
    elements.paymentValueSubtitle = document.getElementById('pdv-payment-value-subtitle');
    elements.paymentValueInput = document.getElementById('pdv-payment-value-input');
    elements.paymentValueHint = document.getElementById('pdv-payment-value-hint');
    elements.paymentValueConfirm = document.getElementById('pdv-payment-value-confirm');
    elements.paymentValueCancel = document.getElementById('pdv-payment-value-cancel');
    elements.paymentValueBackdrop = elements.paymentValueModal?.querySelector('[data-pdv-payment-dismiss]') || null;

    elements.deliveryAddressModal = document.getElementById('pdv-delivery-address-modal');
    elements.deliveryAddressBackdrop =
      elements.deliveryAddressModal?.querySelector('[data-delivery-address-dismiss="backdrop"]') || null;
    elements.deliveryAddressClose =
      elements.deliveryAddressModal?.querySelector('[data-delivery-address-dismiss="close"]') || null;
    elements.deliveryAddressList = document.getElementById('pdv-delivery-address-list');
    elements.deliveryAddressLoading = document.getElementById('pdv-delivery-address-loading');
    elements.deliveryAddressEmpty = document.getElementById('pdv-delivery-address-empty');
    elements.deliveryAddressAdd = document.getElementById('pdv-delivery-address-add');
    elements.deliveryAddressForm = document.getElementById('pdv-delivery-address-form');
    elements.deliveryAddressCancelForm = document.getElementById('pdv-delivery-address-cancel-form');
    elements.deliveryAddressConfirm = document.getElementById('pdv-delivery-address-confirm');
    elements.deliveryAddressCancel = document.getElementById('pdv-delivery-address-cancel');
    elements.deliveryAddressFields = {
      apelido: document.getElementById('pdv-delivery-address-apelido'),
      cep: document.getElementById('pdv-delivery-address-cep'),
      logradouro: document.getElementById('pdv-delivery-address-logradouro'),
      numero: document.getElementById('pdv-delivery-address-numero'),
      bairro: document.getElementById('pdv-delivery-address-bairro'),
      cidade: document.getElementById('pdv-delivery-address-cidade'),
      uf: document.getElementById('pdv-delivery-address-uf'),
      complemento: document.getElementById('pdv-delivery-address-complemento'),
      isDefault: document.getElementById('pdv-delivery-address-default'),
    };

    elements.finalizeTitle = elements.finalizeModal?.querySelector('h2') || null;
    elements.finalizeSubtitle = elements.finalizeModal?.querySelector('h2 + p') || null;
    if (elements.finalizeTitle) {
      finalizeModalDefaults.title = elements.finalizeTitle.textContent?.trim() || finalizeModalDefaults.title;
    }
    if (elements.finalizeSubtitle) {
      finalizeModalDefaults.subtitle =
        elements.finalizeSubtitle.textContent?.trim() || finalizeModalDefaults.subtitle;
    }
    if (elements.finalizeConfirm) {
      finalizeModalDefaults.confirm = elements.finalizeConfirm.textContent?.trim() || finalizeModalDefaults.confirm;
    }
  };
  const updateWorkspaceVisibility = (visible) => {
    if (elements.workspace) {
      elements.workspace.classList.toggle('hidden', !visible);
    }
    if (elements.emptyState) {
      elements.emptyState.classList.toggle('hidden', visible);
    }
  };

  const setActiveTab = (targetId) => {
    if (targetId === 'pdv-tab' && !state.caixaAberto) {
      targetId = 'caixa-tab';
    }
    if (!elements.tabTriggers || !elements.tabPanels) return;
    elements.tabTriggers.forEach((trigger) => {
      const target = trigger.getAttribute('data-tab-target');
      const isActive = target === targetId;
      trigger.classList.toggle('text-primary', isActive);
      trigger.classList.toggle('border-primary', isActive);
      trigger.classList.toggle('border-transparent', !isActive);
      trigger.classList.toggle('text-gray-500', !isActive);
    });
    elements.tabPanels.forEach((panel) => {
      const panelId = panel.getAttribute('data-tab-panel');
      panel.classList.toggle('hidden', panelId !== targetId);
    });
  };

  const updateTabAvailability = () => {
    if (!elements.tabTriggers) return;
    elements.tabTriggers.forEach((trigger) => {
      const target = trigger.getAttribute('data-tab-target');
      if (target !== 'pdv-tab') return;
      const disabled = !state.caixaAberto;
      trigger.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      trigger.tabIndex = disabled ? -1 : 0;
      trigger.classList.toggle('cursor-not-allowed', disabled);
      trigger.classList.toggle('opacity-60', disabled);
      trigger.classList.toggle('hover:text-primary', !disabled);
    });
  };

  const updateStatusBadge = () => {
    if (!elements.statusBadge) return;
    const badge = elements.statusBadge;
    badge.classList.remove(
      'border-gray-200',
      'bg-gray-100',
      'text-gray-600',
      'border-emerald-200',
      'bg-emerald-50',
      'text-emerald-700'
    );
    const icon = state.caixaAberto ? 'fa-circle-check' : 'fa-lock';
    const text = state.caixaAberto ? 'Caixa aberto' : 'Caixa fechado';
    if (state.caixaAberto) {
      badge.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
    } else {
      badge.classList.add('border-gray-200', 'bg-gray-100', 'text-gray-600');
    }
    const indicatorClass = state.caixaAberto
      ? 'h-2.5 w-2.5 rounded-full border border-emerald-200 bg-emerald-500'
      : 'h-2.5 w-2.5 rounded-full border border-gray-300 bg-gray-400';
    badge.innerHTML = `
      <span class="${indicatorClass}"></span>
      <span class="flex items-center gap-1.5">
        <i class="fas ${icon} text-[10px]"></i>
        ${text}
      </span>
    `;
    if (elements.caixaStateLabel) {
      elements.caixaStateLabel.textContent = text;
    }
    if (elements.selectedInfo) {
      elements.selectedInfo.textContent = state.caixaAberto
        ? 'Caixa aberto e pronto para registrar vendas.'
        : 'Abra o caixa para iniciar as vendas.';
    }
    updateSaleCodeDisplay();
    updateFinalizeButton();
  };

  const updatePrintControls = () => {
    if (!elements.printControls) return;
    const preferences = state.printPreferences || {};
    elements.printControls.querySelectorAll('[data-print-type]').forEach((button) => {
      const type = button.getAttribute('data-print-type');
      if (!type) return;
      const labelElement = button.querySelector('[data-print-mode-label]');
      const mode = preferences[type];
      const baseMode = getPrintBaseMode(mode);
      const promptEnabled = isPrintPromptEnabled(mode);
      const label = PRINT_MODE_LABELS[baseMode] || PRINT_MODE_LABELS.M;
      if (labelElement) {
        labelElement.textContent = label;
      }
      button.dataset.printMode = baseMode;
      button.dataset.printPrompt = promptEnabled ? 'ask' : 'skip';
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('title', getPrintModeDescription(type, baseMode));
    });
    elements.printControls.querySelectorAll('[data-print-confirmation]').forEach((button) => {
      const type = button.getAttribute('data-print-confirmation');
      if (!type) return;
      const labelElement = button.querySelector('[data-print-confirmation-label]');
      const mode = preferences[type];
      const baseMode = getPrintBaseMode(mode);
      const promptEnabled = isPrintPromptEnabled(mode);
      if (labelElement) {
        labelElement.textContent = PRINT_PROMPT_LABELS[promptEnabled ? 'ask' : 'skip'];
      }
      button.dataset.printMode = baseMode;
      button.dataset.printPrompt = promptEnabled ? 'ask' : 'skip';
      button.setAttribute('aria-pressed', promptEnabled ? 'true' : 'false');
      button.setAttribute('title', getPrintPromptDescription(type, promptEnabled, baseMode));
    });
  };

  const handlePrintToggleClick = (event) => {
    if (!elements.printControls) return;
    const typeButton = event.target.closest('[data-print-type]');
    const confirmationButton = event.target.closest('[data-print-confirmation]');
    if (typeButton && elements.printControls.contains(typeButton)) {
      event.preventDefault();
      const type = typeButton.getAttribute('data-print-type');
      if (!type) return;
      const currentMode = state.printPreferences?.[type];
      const currentBase = getPrintBaseMode(currentMode);
      const promptEnabled = isPrintPromptEnabled(currentMode);
      const nextBase = currentBase === 'F' ? 'M' : 'F';
      const nextMode = buildPrintMode(nextBase, promptEnabled);
      if (!state.printPreferences || typeof state.printPreferences !== 'object') {
        state.printPreferences = {};
      }
      state.printPreferences = { ...state.printPreferences, [type]: nextMode };
      updatePrintControls();
      const modeLabel = PRINT_MODE_LABELS[nextMode] || PRINT_MODE_LABELS[nextBase] || PRINT_MODE_LABELS.M;
      const typeLabel = getPrintTypeLabel(type);
      notify(`Impressão de ${typeLabel} definida para ${modeLabel}.`, 'info');
      scheduleStatePersist();
      return;
    }
    if (confirmationButton && elements.printControls.contains(confirmationButton)) {
      event.preventDefault();
      const type = confirmationButton.getAttribute('data-print-confirmation');
      if (!type) return;
      const currentMode = state.printPreferences?.[type];
      const baseMode = getPrintBaseMode(currentMode);
      const promptEnabled = isPrintPromptEnabled(currentMode);
      const nextPrompt = !promptEnabled;
      const nextMode = buildPrintMode(baseMode, nextPrompt);
      if (!state.printPreferences || typeof state.printPreferences !== 'object') {
        state.printPreferences = {};
      }
      state.printPreferences = { ...state.printPreferences, [type]: nextMode };
      updatePrintControls();
      const typeLabel = getPrintTypeLabel(type);
      const promptLabel = PRINT_PROMPT_LABELS[nextPrompt ? 'ask' : 'skip'];
      notify(`Confirmação de impressão para ${typeLabel} definida para ${promptLabel.toLowerCase()}.`, 'info');
      scheduleStatePersist();
    }
  };

  const updateWorkspaceInfo = () => {
    if (elements.companyLabel) {
      const label = getStoreLabel();
      elements.companyLabel.textContent = label === '—' ? '—' : label;
    }
    if (elements.pdvLabel) {
      const label = getPdvLabel();
      elements.pdvLabel.textContent = label === '—' ? '—' : label;
    }
  };

  const clearSelectedProduct = () => {
    state.selectedProduct = null;
    state.quantidade = 1;
    if (elements.selectedImage) {
      elements.selectedImage.classList.add('hidden');
      elements.selectedImage.src = '';
    }
    if (elements.selectedPlaceholder) {
      elements.selectedPlaceholder.classList.remove('hidden');
    }
    if (elements.selectedName) {
      elements.selectedName.textContent = 'Nenhum produto selecionado.';
    }
    if (elements.selectedSku) {
      elements.selectedSku.textContent = 'Escolha um item para visualizar os detalhes.';
    }
    if (elements.selectedPrice) {
      elements.selectedPrice.textContent = formatCurrency(0);
    }
    if (elements.selectedOriginalPrice) {
      elements.selectedOriginalPrice.classList.add('hidden');
    }
    if (elements.selectedPromoBadge) {
      elements.selectedPromoBadge.classList.add('hidden');
    }
    if (elements.selectedGeneralWarning) {
      elements.selectedGeneralWarning.classList.add('hidden');
    }
    if (elements.itemQuantity) {
      elements.itemQuantity.value = 1;
    }
    updateItemTotals();
  };

  const updateSelectedProductView = () => {
    const product = state.selectedProduct;
    if (!product) {
      clearSelectedProduct();
      return;
    }
    const imageUrl = getImageUrl(product);
    if (imageUrl && elements.selectedImage) {
      elements.selectedImage.src = imageUrl;
      elements.selectedImage.classList.remove('hidden');
      elements.selectedPlaceholder?.classList.add('hidden');
    } else if (elements.selectedPlaceholder) {
      elements.selectedPlaceholder.classList.remove('hidden');
      elements.selectedImage?.classList.add('hidden');
    }
    const name = product?.nome || product?.descricao || 'Produto sem nome';
    const code = getProductCode(product);
    const barcode = getProductBarcode(product);
    const basePrice = getBasePrice(product);
    const finalPrice = getFinalPrice(product);
    const generalPromo = hasGeneralPromotion(product);
    const showGeneralWarning = generalPromo && !canApplyGeneralPromotion();
    if (elements.selectedName) {
      elements.selectedName.textContent = name;
    }
    if (elements.selectedSku) {
      const info = [code ? `Cód.: ${code}` : null, barcode ? `Barras: ${barcode}` : null]
        .filter(Boolean)
        .join(' • ');
      elements.selectedSku.textContent = info || 'Detalhes indisponíveis para o item selecionado.';
    }
    if (elements.selectedPrice) {
      elements.selectedPrice.textContent = formatCurrency(finalPrice);
    }
    if (elements.selectedOriginalPrice) {
      if (finalPrice < basePrice) {
        elements.selectedOriginalPrice.textContent = formatCurrency(basePrice);
        elements.selectedOriginalPrice.classList.remove('hidden');
      } else {
        elements.selectedOriginalPrice.classList.add('hidden');
      }
    }
    if (elements.selectedPromoBadge) {
      if (generalPromo) {
        elements.selectedPromoBadge.textContent = 'Promoção geral';
      } else {
        elements.selectedPromoBadge.textContent = 'Promoção ativa';
      }
      elements.selectedPromoBadge.classList.toggle('hidden', !(finalPrice < basePrice));
    }
    if (elements.selectedGeneralWarning) {
      elements.selectedGeneralWarning.classList.toggle('hidden', !showGeneralWarning);
    }
    if (elements.itemQuantity) {
      elements.itemQuantity.value = state.quantidade;
    }
    updateItemTotals();
  };

  const updateItemTotals = () => {
    const product = state.selectedProduct;
    const quantidade = Math.max(1, Math.trunc(state.quantidade));
    const unitPrice = product ? getFinalPrice(product) : 0;
    const total = unitPrice * quantidade;
    if (elements.itemValue) {
      elements.itemValue.textContent = formatCurrency(unitPrice);
    }
    if (elements.itemTotal) {
      elements.itemTotal.textContent = formatCurrency(total);
    }
  };

  const updateSaleCustomerSummary = () => {
    if (elements.customerOpenButtonLabel) {
      elements.customerOpenButtonLabel.textContent = state.vendaCliente
        ? 'Trocar cliente'
        : 'Adicionar cliente';
    }
    const hasCustomer = Boolean(state.vendaCliente);
    if (elements.customerSummaryEmpty) {
      elements.customerSummaryEmpty.classList.toggle('hidden', hasCustomer);
    }
    if (elements.customerSummaryInfo) {
      elements.customerSummaryInfo.classList.toggle('hidden', !hasCustomer);
    }
    if (!hasCustomer) {
      if (elements.customerPet) {
        elements.customerPet.classList.add('hidden');
      }
      return;
    }
    const cliente = state.vendaCliente;
    if (elements.customerName) {
      elements.customerName.textContent = cliente.nome || 'Cliente sem nome';
    }
    if (elements.customerDoc) {
      const doc = cliente.doc || cliente.cpf || cliente.cnpj || cliente.inscricaoEstadual || '';
      elements.customerDoc.textContent = doc ? `Documento: ${doc}` : 'Documento não informado';
    }
    if (elements.customerContact) {
      const contacts = [cliente.email, cliente.celular].filter(Boolean);
      elements.customerContact.textContent = contacts.length
        ? `Contato: ${contacts.join(' • ')}`
        : 'Contato não informado';
    }
    if (elements.customerPet) {
      if (state.vendaPet) {
        const details = [state.vendaPet.tipo, state.vendaPet.raca].filter(Boolean).join(' • ');
        const detailText = details ? ` (${details})` : '';
        elements.customerPet.textContent = `Pet: ${state.vendaPet.nome || 'Pet sem nome'}${detailText}`;
        elements.customerPet.classList.remove('hidden');
      } else {
        elements.customerPet.classList.add('hidden');
      }
    }
  };

  const recalculateItemsForCustomerChange = () => {
    if (!state.itens.length) {
      updateFinalizeButton();
      updateSaleSummary();
      return;
    }
    state.itens = state.itens.map((item) => {
      if (!item.productSnapshot) {
        return {
          ...item,
          generalPromo: Boolean(item.generalPromo && state.vendaCliente),
        };
      }
      const snapshot = item.productSnapshot;
      const valor = getFinalPrice(snapshot);
      return {
        ...item,
        valor,
        subtotal: valor * item.quantidade,
        generalPromo: hasGeneralPromotion(snapshot),
        codigoInterno:
          item.codigoInterno ||
          snapshot.codigoInterno ||
          snapshot.codigo ||
          item.codigo ||
          '',
        codigoBarras: item.codigoBarras || snapshot.codigoBarras || '',
        productSnapshot: snapshot,
      };
    });
    renderItemsList();
  };

  const setSaleCustomer = (cliente, pet = null) => {
    state.vendaCliente = cliente ? { ...cliente } : null;
    state.vendaPet = cliente && pet ? { ...pet } : null;
    if (!cliente) {
      state.vendaPet = null;
    }
    updateSaleCustomerSummary();
    recalculateItemsForCustomerChange();
    if (state.selectedProduct) {
      updateSelectedProductView();
    }
    if (
      elements.searchResults &&
      !elements.searchResults.classList.contains('hidden') &&
      state.searchResults.length &&
      elements.searchInput &&
      elements.searchInput.value.trim()
    ) {
      renderSearchResults(state.searchResults, elements.searchInput.value.trim());
    }
  };

  const updateCustomerModalTabs = () => {
    const buttons = Array.from(elements.customerTabButtons || []);
    const panels = Array.from(elements.customerModalPanels || []);
    buttons.forEach((button) => {
      const tab = button.getAttribute('data-pdv-customer-tab');
      const isActive = tab === state.modalActiveTab;
      const isPetTab = tab === 'pet';
      const disabled = isPetTab && !state.modalSelectedCliente;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary', isActive);
      button.classList.toggle('text-gray-500', !isActive);
      button.classList.toggle('border-transparent', !isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.disabled = disabled;
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      button.classList.toggle('opacity-60', disabled);
      button.classList.toggle('cursor-not-allowed', disabled);
    });
    panels.forEach((panel) => {
      const tab = panel.getAttribute('data-pdv-customer-panel');
      panel.classList.toggle('hidden', tab !== state.modalActiveTab);
    });
  };

  const updateCustomerModalActions = () => {
    const hasSelection = Boolean(state.modalSelectedCliente);
    if (elements.customerConfirm) {
      elements.customerConfirm.disabled = !hasSelection;
      elements.customerConfirm.classList.toggle('opacity-60', !hasSelection);
      elements.customerConfirm.textContent = state.vendaCliente
        ? 'Atualizar vínculo'
        : 'Vincular cliente';
    }
    if (elements.customerClear) {
      elements.customerClear.disabled = !hasSelection;
      elements.customerClear.classList.toggle('opacity-60', !hasSelection);
    }
  };

  const renderCustomerSearchResults = () => {
    if (!elements.customerResultsList || !elements.customerResultsEmpty || !elements.customerResultsLoading) {
      return;
    }
    elements.customerResultsList.innerHTML = '';
    if (state.customerSearchLoading) {
      elements.customerResultsLoading.classList.remove('hidden');
      elements.customerResultsEmpty.classList.add('hidden');
      return;
    }
    elements.customerResultsLoading.classList.add('hidden');
    const query = state.customerSearchQuery.trim();
    if (!query) {
      elements.customerResultsEmpty.textContent = 'Digite para buscar clientes.';
      elements.customerResultsEmpty.classList.remove('hidden');
      return;
    }
    if (!state.customerSearchResults.length) {
      elements.customerResultsEmpty.textContent = 'Nenhum cliente encontrado para a busca informada.';
      elements.customerResultsEmpty.classList.remove('hidden');
      return;
    }
    elements.customerResultsEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.customerSearchResults.forEach((cliente) => {
      const isSelected = Boolean(state.modalSelectedCliente && state.modalSelectedCliente._id === cliente._id);
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-customer-id', cliente._id);
      button.className = [
        'w-full text-left rounded-lg border px-4 py-3 transition flex flex-col gap-1',
        isSelected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-gray-200 text-gray-700 hover:border-primary hover:bg-primary/5',
      ].join(' ');
      const documento = cliente.doc || cliente.cpf || cliente.cnpj || '';
      const contato = [cliente.email, cliente.celular].filter(Boolean).join(' • ');
      button.innerHTML = `
        <span class="text-sm font-semibold">${cliente.nome || 'Cliente sem nome'}</span>
        <span class="text-xs text-gray-500">${documento ? `Documento: ${documento}` : 'Documento não informado'}</span>
        <span class="text-xs text-gray-500">${contato || 'Contato não informado'}</span>
      `;
      fragment.appendChild(button);
    });
    elements.customerResultsList.appendChild(fragment);
  };

  const renderCustomerPets = () => {
    if (!elements.customerPetsList || !elements.customerPetsEmpty || !elements.customerPetsLoading) {
      return;
    }
    elements.customerPetsList.innerHTML = '';
    if (!state.modalSelectedCliente) {
      elements.customerPetsLoading.classList.add('hidden');
      elements.customerPetsEmpty.textContent = 'Selecione um cliente para visualizar os pets vinculados.';
      elements.customerPetsEmpty.classList.remove('hidden');
      return;
    }
    if (state.customerPetsLoading) {
      elements.customerPetsLoading.classList.remove('hidden');
      elements.customerPetsEmpty.classList.add('hidden');
      return;
    }
    elements.customerPetsLoading.classList.add('hidden');
    if (!state.customerPets.length) {
      elements.customerPetsEmpty.textContent = 'Nenhum pet cadastrado para este cliente.';
      elements.customerPetsEmpty.classList.remove('hidden');
      return;
    }
    elements.customerPetsEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.customerPets.forEach((pet) => {
      const isSelected = Boolean(state.modalSelectedPet && state.modalSelectedPet._id === pet._id);
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-pet-id', pet._id);
      button.className = [
        'w-full text-left rounded-lg border px-4 py-3 transition flex flex-col gap-1',
        isSelected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-gray-200 text-gray-700 hover:border-primary hover:bg-primary/5',
      ].join(' ');
      const details = [pet.tipo, pet.raca].filter(Boolean).join(' • ');
      button.innerHTML = `
        <span class="text-sm font-semibold">${pet.nome || 'Pet sem nome'}</span>
        <span class="text-xs text-gray-500">${details || 'Detalhes não informados'}</span>
      `;
      fragment.appendChild(button);
    });
    elements.customerPetsList.appendChild(fragment);
  };

  const clearProductSearchArea = () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    if (state.searchController) {
      state.searchController.abort();
      state.searchController = null;
    }
    state.searchResults = [];
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }
    if (elements.searchResults) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
    }
  };

  const clearCustomerSearchArea = () => {
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
      customerSearchTimeout = null;
    }
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    state.customerSearchQuery = '';
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    renderCustomerSearchResults();
  };

  const clearSaleSearchAreas = () => {
    clearProductSearchArea();
    clearCustomerSearchArea();
  };

  const performCustomerSearch = async (term) => {
    const query = term.trim();
    state.customerSearchQuery = term;
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    if (!query) {
      state.customerSearchResults = [];
      state.customerSearchLoading = false;
      renderCustomerSearchResults();
      return;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    state.customerSearchLoading = true;
    renderCustomerSearchResults();
    customerSearchController = new AbortController();
    try {
      const response = await fetch(
        `${API_BASE}/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=8`,
        { headers, signal: customerSearchController.signal }
      );
      if (!response.ok) {
        throw new Error('Não foi possível buscar clientes.');
      }
      const payload = await response.json();
      state.customerSearchResults = Array.isArray(payload) ? payload : [];
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao buscar clientes:', error);
      notify(error.message || 'Não foi possível buscar clientes.', 'error');
      state.customerSearchResults = [];
    } finally {
      state.customerSearchLoading = false;
      customerSearchController = null;
      renderCustomerSearchResults();
    }
  };

  const fetchCustomerPets = async (clienteId) => {
    if (!clienteId) return;
    const cached = customerPetsCache.get(clienteId);
    if (cached) {
      state.customerPets = cached;
      state.customerPetsLoading = false;
      renderCustomerPets();
      updateCustomerModalActions();
      return;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    state.customerPetsLoading = true;
    renderCustomerPets();
    if (customerPetsController) {
      customerPetsController.abort();
    }
    customerPetsController = new AbortController();
    try {
      const response = await fetch(`${API_BASE}/func/clientes/${clienteId}/pets`, {
        headers,
        signal: customerPetsController.signal,
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os pets do cliente.');
      }
      const payload = await response.json();
      const pets = Array.isArray(payload) ? payload : [];
      customerPetsCache.set(clienteId, pets);
      if (state.modalSelectedCliente && state.modalSelectedCliente._id === clienteId) {
        state.customerPets = pets;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao carregar pets do cliente:', error);
      notify(error.message || 'Não foi possível carregar os pets do cliente selecionado.', 'error');
      if (state.modalSelectedCliente && state.modalSelectedCliente._id === clienteId) {
        state.customerPets = [];
      }
    } finally {
      if (state.modalSelectedCliente && state.modalSelectedCliente._id === clienteId) {
        state.customerPetsLoading = false;
        renderCustomerPets();
        updateCustomerModalActions();
      }
      customerPetsController = null;
    }
  };

  const setModalSelectedCliente = (cliente) => {
    state.modalSelectedCliente = cliente ? { ...cliente } : null;
    state.modalSelectedPet = null;
    if (state.modalSelectedCliente && state.modalSelectedCliente._id) {
      const cached = customerPetsCache.get(state.modalSelectedCliente._id);
      if (cached) {
        state.customerPets = cached;
        state.customerPetsLoading = false;
      } else {
        state.customerPets = [];
        state.customerPetsLoading = true;
        fetchCustomerPets(state.modalSelectedCliente._id);
      }
    } else {
      state.customerPets = [];
      state.customerPetsLoading = false;
    }
    renderCustomerSearchResults();
    renderCustomerPets();
    updateCustomerModalTabs();
    updateCustomerModalActions();
  };

  const openCustomerModal = () => {
    if (!elements.customerModal) return;
    state.modalActiveTab = 'cliente';
    state.customerSearchQuery = '';
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    state.customerPetsLoading = false;
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    setModalSelectedCliente(state.vendaCliente ? { ...state.vendaCliente } : null);
    if (
      state.vendaPet &&
      state.modalSelectedCliente &&
      state.modalSelectedCliente._id &&
      state.vendaCliente &&
      state.vendaCliente._id === state.modalSelectedCliente._id
    ) {
      state.modalSelectedPet = { ...state.vendaPet };
      renderCustomerPets();
      updateCustomerModalActions();
    }
    elements.customerModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    updateCustomerModalTabs();
    renderCustomerSearchResults();
    renderCustomerPets();
    updateCustomerModalActions();
    setTimeout(() => {
      elements.customerSearchInput?.focus();
    }, 150);
  };

  const closeCustomerModal = () => {
    if (!elements.customerModal) return;
    elements.customerModal.classList.add('hidden');
    if (
      (!elements.finalizeModal || elements.finalizeModal.classList.contains('hidden')) &&
      (!elements.paymentValueModal || elements.paymentValueModal.classList.contains('hidden'))
    ) {
      document.body.classList.remove('overflow-hidden');
    }
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
      customerSearchTimeout = null;
    }
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    if (customerPetsController) {
      customerPetsController.abort();
      customerPetsController = null;
    }
    state.customerSearchLoading = false;
    state.customerPetsLoading = false;
  };

  const handleCustomerSearchInput = (event) => {
    const value = event.target.value || '';
    state.customerSearchQuery = value;
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
    }
    customerSearchTimeout = setTimeout(() => performCustomerSearch(value), 300);
    if (!value.trim()) {
      state.customerSearchResults = [];
      state.customerSearchLoading = false;
      renderCustomerSearchResults();
    }
  };

  const handleCustomerResultsClick = (event) => {
    const button = event.target.closest('[data-customer-id]');
    if (!button) return;
    const id = button.getAttribute('data-customer-id');
    const cliente = state.customerSearchResults.find((item) => item._id === id);
    if (!cliente) return;
    setModalSelectedCliente(cliente);
  };

  const handleCustomerPetsClick = (event) => {
    const button = event.target.closest('[data-pet-id]');
    if (!button) return;
    const id = button.getAttribute('data-pet-id');
    const pet = state.customerPets.find((item) => item._id === id);
    if (!pet) return;
    if (state.modalSelectedPet && state.modalSelectedPet._id === id) {
      state.modalSelectedPet = null;
    } else {
      state.modalSelectedPet = { ...pet };
    }
    renderCustomerPets();
    updateCustomerModalActions();
  };

  const handleCustomerTabClick = (event) => {
    const tab = event.currentTarget.getAttribute('data-pdv-customer-tab');
    if (!tab) return;
    if (tab === 'pet' && !state.modalSelectedCliente) {
      event.preventDefault();
      notify('Selecione um cliente para visualizar os pets.', 'info');
      return;
    }
    state.modalActiveTab = tab;
    updateCustomerModalTabs();
    if (tab === 'pet' && state.modalSelectedCliente && state.modalSelectedCliente._id) {
      if (!customerPetsCache.has(state.modalSelectedCliente._id) && !state.customerPetsLoading) {
        fetchCustomerPets(state.modalSelectedCliente._id);
      }
    }
  };

  const handleCustomerConfirm = () => {
    if (!state.modalSelectedCliente) {
      notify('Selecione um cliente para vincular à venda.', 'warning');
      return;
    }
    setSaleCustomer(state.modalSelectedCliente, state.modalSelectedPet);
    closeCustomerModal();
  };

  const handleCustomerClearSelection = () => {
    state.modalSelectedCliente = null;
    state.modalSelectedPet = null;
    state.customerPets = [];
    state.customerPetsLoading = false;
    state.customerSearchQuery = '';
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    state.modalActiveTab = 'cliente';
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    renderCustomerSearchResults();
    renderCustomerPets();
    updateCustomerModalTabs();
    updateCustomerModalActions();
  };

  const handleCustomerRemove = () => {
    if (!state.vendaCliente) return;
    setSaleCustomer(null, null);
  };

  const handleCustomerModalKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCustomerModal();
    }
  };

  const renderItemsList = () => {
    if (!elements.itemsList || !elements.itemsEmpty || !elements.itemsCount || !elements.itemsTotal)
      return;
    elements.itemsList.innerHTML = '';
    if (!state.itens.length) {
      elements.itemsList.classList.add('hidden');
      elements.itemsEmpty.classList.remove('hidden');
      elements.itemsCount.textContent = '0 itens';
      elements.itemsTotal.textContent = formatCurrency(0);
      updateFinalizeButton();
      updateSaleSummary();
      return;
    }
    const fragment = document.createDocumentFragment();
    state.itens.forEach((item, index) => {
      const li = document.createElement('li');
      li.dataset.index = String(index);
      li.className = 'flex items-start gap-3 py-3';
      const codigoInterno = item.codigoInterno || item.codigo || '—';
      const codigoBarras = item.codigoBarras || '—';
      const generalNotice = !state.vendaCliente && item.generalPromo
        ? '<p class="text-[11px] text-amber-600">Vincule um cliente para aplicar a promoção geral.</p>'
        : '';
      li.innerHTML = `
        <div class="flex-1 min-w-0 space-y-1">
          <p class="text-sm font-semibold text-gray-800 leading-snug">${item.nome}</p>
          <p class="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
            <span>Cód. Interno: ${codigoInterno}</span>
            <span>Barras: ${codigoBarras}</span>
          </p>
          <p class="text-xs text-gray-500">Qtde: ${item.quantidade} • Valor: ${formatCurrency(item.valor)}</p>
          ${generalNotice}
        </div>
        <div class="flex flex-col items-end gap-2 text-right">
          <span class="text-sm font-semibold text-gray-700">${formatCurrency(item.subtotal)}</span>
          <button type="button" class="text-xs text-red-500 transition hover:text-red-600" data-remove-index="${index}" aria-label="Remover item">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      fragment.appendChild(li);
    });
    elements.itemsList.appendChild(fragment);
    elements.itemsList.classList.remove('hidden');
    elements.itemsEmpty.classList.add('hidden');
    elements.itemsCount.textContent =
      state.itens.length === 1 ? '1 item' : `${state.itens.length} itens`;
    const total = state.itens.reduce((sum, item) => sum + item.subtotal, 0);
    elements.itemsTotal.textContent = formatCurrency(total);
    updateFinalizeButton();
    updateSaleSummary();
  };

  const getSaleTotalBruto = () => state.itens.reduce((sum, item) => sum + item.subtotal, 0);
  const getSaleTotalLiquido = () => {
    const bruto = getSaleTotalBruto();
    const liquido = bruto + state.vendaAcrescimo - state.vendaDesconto;
    return liquido < 0 ? 0 : liquido;
  };
  const getSalePagoTotal = () =>
    state.vendaPagamentos.reduce((sum, payment) => sum + safeNumber(payment.valor), 0);

  const updateFinalizeButton = () => {
    if (!elements.finalizeButton) return;
    const disabled = !state.caixaAberto || !state.itens.length;
    elements.finalizeButton.disabled = disabled;
    elements.finalizeButton.classList.toggle('opacity-60', disabled);
    elements.finalizeButton.classList.toggle('cursor-not-allowed', disabled);
  };

  const renderSalePaymentsPreview = () => {
    if (!elements.salePaymentsList || !elements.salePaymentsEmpty) return;
    elements.salePaymentsList.innerHTML = '';
    if (!state.vendaPagamentos.length) {
      elements.salePaymentsList.classList.add('hidden');
      elements.salePaymentsEmpty.classList.remove('hidden');
      updateSaleSummary();
      return;
    }
    const fragment = document.createDocumentFragment();
    state.vendaPagamentos.forEach((payment) => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2';
      const installmentsLabel = payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
      li.innerHTML = `
        <div class="flex-1">
          <p class="text-sm font-semibold text-gray-700">${payment.label}${installmentsLabel}</p>
          <p class="text-xs text-gray-500">${formatCurrency(payment.valor)}</p>
        </div>
        <button type="button" class="text-xs text-red-500 hover:text-red-600" data-sale-remove="${payment.uid}">
          <i class="fas fa-times"></i>
        </button>
      `;
      fragment.appendChild(li);
    });
    elements.salePaymentsList.appendChild(fragment);
    elements.salePaymentsList.classList.remove('hidden');
    elements.salePaymentsEmpty.classList.add('hidden');
    updateSaleSummary();
  };

  const renderSalePaymentMethods = () => {
    if (!elements.saleMethods) return;
    if (state.paymentMethodsLoading) {
      elements.saleMethods.innerHTML =
        '<li class="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">Carregando meios de pagamento...</li>';
      return;
    }
    if (!state.paymentMethods.length) {
      const message = state.selectedStore
        ? 'Cadastre meios de pagamento para finalizar vendas neste PDV.'
        : 'Selecione uma empresa para carregar os meios de pagamento disponíveis.';
      elements.saleMethods.innerHTML = `<li class="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">${message}</li>`;
      return;
    }
    const html = state.paymentMethods
      .map((method) => {
        const installments = Array.isArray(method.installments)
          ? method.installments.filter((value) => Number.isFinite(value) && value >= 1)
          : [1];
        const uniqueInstallments = Array.from(new Set(installments)).sort((a, b) => a - b);
        if (method.type === 'credito' && uniqueInstallments.length > 1) {
          const buttons = uniqueInstallments
            .map((installment) => {
              const label = installment === 1 ? 'À vista' : `${installment}x`;
              return `<button type="button" class="rounded border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary hover:text-primary" data-sale-installment="${method.id}:${installment}">${label}</button>`;
            })
            .join('');
          return `
            <li class="rounded-xl border border-gray-200 bg-white p-4">
              <button type="button" class="flex w-full items-center justify-between text-sm font-semibold text-gray-700" data-sale-method-toggle="${method.id}">
                <span>${method.label}</span>
                <i class="fas fa-chevron-down text-xs" aria-hidden="true"></i>
              </button>
              <div class="mt-3 hidden flex flex-wrap gap-2" data-sale-options="${method.id}">
                ${buttons}
              </div>
            </li>
          `;
        }
        const parcelas = method.type === 'credito' ? uniqueInstallments[0] || 1 : 1;
        const parcelasLabel = parcelas > 1 ? ` (${parcelas}x)` : '';
        return `
          <li>
            <button type="button" class="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-primary hover:text-primary" data-sale-method="${method.id}" data-sale-parcelas="${parcelas}">
              <span>${method.label}${parcelasLabel}</span>
              <i class="fas fa-arrow-right text-xs"></i>
            </button>
          </li>
        `;
      })
      .join('');
    elements.saleMethods.innerHTML = html;
  };

  const resetDeliveryAddressForm = () => {
    const fields = elements.deliveryAddressFields || {};
    if (fields.apelido) fields.apelido.value = '';
    if (fields.cep) fields.cep.value = '';
    if (fields.logradouro) fields.logradouro.value = '';
    if (fields.numero) fields.numero.value = '';
    if (fields.bairro) fields.bairro.value = '';
    if (fields.cidade) fields.cidade.value = '';
    if (fields.uf) fields.uf.value = '';
    if (fields.complemento) fields.complemento.value = '';
    if (fields.isDefault) fields.isDefault.checked = !state.deliveryAddresses.length;
    deliveryCepLastDigits = '';
    deliveryCepLastResult = null;
    deliveryCepLastNotifiedDigits = '';
  };

  const setDeliveryAddressFormVisible = (visible) => {
    state.deliveryAddressFormVisible = visible;
    if (elements.deliveryAddressForm) {
      elements.deliveryAddressForm.classList.toggle('hidden', !visible);
    }
    if (elements.deliveryAddressAdd) {
      const label = elements.deliveryAddressAdd.querySelector('span');
      if (label) {
        label.textContent = visible ? 'Cancelar cadastro' : 'Cadastrar novo endereço';
      }
    }
  };

  const updateDeliveryAddressConfirmState = () => {
    if (!elements.deliveryAddressConfirm) return;
    const disabled = state.deliveryAddressesLoading || !state.deliverySelectedAddressId;
    elements.deliveryAddressConfirm.disabled = disabled;
    elements.deliveryAddressConfirm.classList.toggle('opacity-60', disabled);
  };

  const setDeliverySelectedAddressId = (addressId) => {
    const normalizedId = addressId ? String(addressId) : '';
    state.deliverySelectedAddressId = normalizedId;
    const selected = state.deliveryAddresses.find((item) => item.id === normalizedId) || null;
    state.deliverySelectedAddress = selected ? { ...selected } : null;
    updateDeliveryAddressConfirmState();
  };

  const applyDefaultDeliveryAddressSelection = () => {
    if (!state.deliveryAddresses.length) {
      setDeliverySelectedAddressId('');
      return;
    }
    if (state.deliverySelectedAddressId) {
      const existing = state.deliveryAddresses.find((item) => item.id === state.deliverySelectedAddressId);
      if (existing) {
        state.deliverySelectedAddress = { ...existing };
        return;
      }
    }
    const preferred = state.deliveryAddresses.find((item) => item.isDefault) || state.deliveryAddresses[0];
    setDeliverySelectedAddressId(preferred.id);
  };

  const renderDeliveryAddresses = () => {
    if (!elements.deliveryAddressList || !elements.deliveryAddressLoading || !elements.deliveryAddressEmpty) {
      return;
    }
    elements.deliveryAddressList.innerHTML = '';
    if (state.deliveryAddressesLoading) {
      elements.deliveryAddressLoading.classList.remove('hidden');
    } else {
      elements.deliveryAddressLoading.classList.add('hidden');
    }
    if (!state.deliveryAddressesLoading && !state.deliveryAddresses.length) {
      elements.deliveryAddressEmpty.classList.remove('hidden');
      updateDeliveryAddressConfirmState();
      return;
    }
    elements.deliveryAddressEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.deliveryAddresses.forEach((address) => {
      const isSelected = state.deliverySelectedAddressId === address.id;
      const label = document.createElement('label');
      label.className = [
        'flex items-start gap-3 rounded-xl border px-4 py-3 transition',
        isSelected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-gray-200 text-gray-700 hover:border-primary hover:bg-primary/5',
      ].join(' ');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'pdv-delivery-address';
      input.value = address.id;
      input.checked = isSelected;
      input.className = 'mt-1 h-4 w-4 text-primary focus:ring-primary';
      const content = document.createElement('div');
      content.className = 'flex-1 space-y-1';
      const title = document.createElement('p');
      title.className = 'text-sm font-semibold';
      title.textContent = address.apelido || 'Endereço';
      const detail = document.createElement('p');
      detail.className = 'text-xs text-gray-500';
      detail.textContent = address.formatted || 'Endereço não informado';
      content.append(title, detail);
      if (address.isDefault) {
        const badge = document.createElement('span');
        badge.className =
          'inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700';
        badge.textContent = 'Principal';
        content.appendChild(badge);
      }
      label.append(input, content);
      fragment.appendChild(label);
    });
    elements.deliveryAddressList.appendChild(fragment);
    updateDeliveryAddressConfirmState();
  };

  const loadDeliveryAddresses = async () => {
    const cliente = state.vendaCliente;
    const clienteId = cliente?._id || cliente?.id || cliente?._idCliente || '';
    const inlineFallback = extractInlineCustomerAddresses(cliente)
      .map((item, index) => normalizeCustomerAddressRecord(item, index))
      .filter(Boolean);

    if (!clienteId) {
      state.deliveryAddresses = inlineFallback.map((item) => ({ ...item }));
      state.deliveryAddressesLoading = false;
      applyDefaultDeliveryAddressSelection();
      renderDeliveryAddresses();
      return;
    }

    const cached = customerAddressesCache.get(clienteId);
    if (cached) {
      state.deliveryAddresses = cached.map((item) => ({ ...item }));
      state.deliveryAddressesLoading = false;
      applyDefaultDeliveryAddressSelection();
      renderDeliveryAddresses();
      return;
    }

    state.deliveryAddressesLoading = true;
    renderDeliveryAddresses();
    if (deliveryAddressesController) {
      deliveryAddressesController.abort();
    }
    deliveryAddressesController = new AbortController();
    try {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/addresses/${clienteId}`, {
        headers,
        signal: deliveryAddressesController.signal,
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os endereços do cliente.');
      }
      const payload = await response.json();
      const normalized = Array.isArray(payload)
        ? payload.map((item, index) => normalizeCustomerAddressRecord(item, index)).filter(Boolean)
        : [];
      const addresses = normalized.length ? normalized : inlineFallback;
      state.deliveryAddresses = addresses.map((item) => ({ ...item }));
      customerAddressesCache.set(
        clienteId,
        state.deliveryAddresses.map((item) => ({ ...item }))
      );
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Erro ao carregar endereços do cliente:', error);
        notify(error.message || 'Não foi possível carregar os endereços do cliente.', 'error');
        state.deliveryAddresses = inlineFallback.map((item) => ({ ...item }));
      }
    } finally {
      state.deliveryAddressesLoading = false;
      deliveryAddressesController = null;
      applyDefaultDeliveryAddressSelection();
      renderDeliveryAddresses();
    }
  };

  const openDeliveryAddressModal = async () => {
    if (!elements.deliveryAddressModal) return;
    setDeliveryAddressFormVisible(false);
    resetDeliveryAddressForm();
    await loadDeliveryAddresses();
    elements.deliveryAddressModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  };

  const closeDeliveryAddressModal = () => {
    if (!elements.deliveryAddressModal) return;
    elements.deliveryAddressModal.classList.add('hidden');
    if (!elements.finalizeModal || elements.finalizeModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
  };

  const handleDeliveryAddressConfirm = () => {
    if (!state.deliverySelectedAddress) {
      notify('Selecione um endereço para continuar com o delivery.', 'warning');
      return;
    }
    closeDeliveryAddressModal();
    openFinalizeModal('delivery');
  };

  const handleDeliveryAddressToggle = () => {
    const nextVisible = !state.deliveryAddressFormVisible;
    setDeliveryAddressFormVisible(nextVisible);
    if (!nextVisible) {
      resetDeliveryAddressForm();
    } else if (elements.deliveryAddressFields?.apelido && !elements.deliveryAddressFields.apelido.value) {
      elements.deliveryAddressFields.apelido.value = state.deliveryAddresses.length ? '' : 'Principal';
    }
  };

  const handleDeliveryAddressCancelForm = () => {
    setDeliveryAddressFormVisible(false);
    resetDeliveryAddressForm();
  };

  const handleDeliveryAddressFormSubmit = async (event) => {
    event.preventDefault();
    if (!state.vendaCliente || !state.vendaCliente._id) {
      notify('Selecione um cliente para cadastrar o endereço.', 'warning');
      return;
    }
    if (state.deliveryAddressSaving) return;
    const fields = elements.deliveryAddressFields || {};
    const cepValue = fields.cep?.value?.trim() || '';
    const numeroValue = fields.numero?.value?.trim() || '';
    const logradouroValue = fields.logradouro?.value?.trim() || '';
    if (!cepValue || !numeroValue || !logradouroValue) {
      notify('Informe CEP, número e endereço para salvar.', 'warning');
      return;
    }
    const payload = {
      userId: state.vendaCliente._id,
      apelido: fields.apelido?.value?.trim(),
      cep: cepValue.replace(/\D+/g, ''),
      logradouro: logradouroValue,
      numero: numeroValue,
      complemento: fields.complemento?.value?.trim() || '',
      bairro: fields.bairro?.value?.trim() || '',
      cidade: fields.cidade?.value?.trim() || '',
      uf: (fields.uf?.value || '').trim().toUpperCase(),
      isDefault: Boolean(fields.isDefault?.checked || !state.deliveryAddresses.length),
    };
    state.deliveryAddressSaving = true;
    const submitButton = elements.deliveryAddressForm?.querySelector('button[type="submit"]');
    if (elements.deliveryAddressForm) {
      elements.deliveryAddressForm.classList.add('opacity-60');
    }
    if (submitButton) submitButton.disabled = true;
    try {
      const token = getToken();
      if (!token) {
        throw new Error('É necessário estar autenticado para salvar o endereço.');
      }
      const response = await fetch(`${API_BASE}/addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error('Não foi possível salvar o endereço do cliente.');
      }
      const saved = await response.json();
      const normalized = normalizeCustomerAddressRecord(saved, state.deliveryAddresses.length);
      if (normalized) {
        const clienteId = state.vendaCliente._id;
        state.deliveryAddresses.push({ ...normalized });
        customerAddressesCache.set(
          clienteId,
          state.deliveryAddresses.map((item) => ({ ...item }))
        );
        setDeliverySelectedAddressId(normalized.id);
        renderDeliveryAddresses();
        setDeliveryAddressFormVisible(false);
        resetDeliveryAddressForm();
        notify('Endereço cadastrado com sucesso.', 'success');
      }
    } catch (error) {
      console.error('Erro ao salvar endereço do cliente:', error);
      notify(error.message || 'Não foi possível salvar o endereço do cliente.', 'error');
    } finally {
      state.deliveryAddressSaving = false;
      if (elements.deliveryAddressForm) {
        elements.deliveryAddressForm.classList.remove('opacity-60');
      }
      if (submitButton) submitButton.disabled = false;
    }
  };

  const handleDeliveryAddressSelection = (event) => {
    const input = event.target.closest('input[type="radio"][name="pdv-delivery-address"]');
    if (!input) return;
    setDeliverySelectedAddressId(input.value);
    renderDeliveryAddresses();
  };

  const handleDeliveryAction = async () => {
    if (!state.caixaAberto) {
      notify('Abra o caixa para registrar um delivery.', 'warning');
      return;
    }
    if (!state.vendaCliente) {
      notify('Selecione um cliente para iniciar o delivery.', 'warning');
      return;
    }
    if (!state.itens.length) {
      notify('Adicione itens à venda para iniciar o delivery.', 'warning');
      return;
    }
    try {
      await openDeliveryAddressModal();
    } catch (error) {
      console.error('Erro ao iniciar fluxo de delivery:', error);
      notify('Não foi possível iniciar o fluxo de delivery.', 'error');
    }
  };

  const summarizeDeliveryPayments = (payments) => {
    if (!Array.isArray(payments) || !payments.length) return '';
    return payments
      .map((payment) => {
        const parcelas = payment.parcelas && payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
        return `${payment.label || 'Pagamento'}${parcelas}`;
      })
      .join(' • ');
  };

  const createDeliveryOrderRecord = (
    snapshot,
    address,
    pagamentos,
    total,
    items = [],
    desconto = 0,
    acrescimo = 0,
    saleCode = ''
  ) => {
    const nowIso = new Date().toISOString();
    const clienteBase = snapshot?.cliente || {};
    const order = {
      id: createUid(),
      status: 'registrado',
      createdAt: nowIso,
      updatedAt: nowIso,
      statusUpdatedAt: nowIso,
      total,
      payments: pagamentos.map((payment) => ({ ...payment })),
      paymentsLabel: summarizeDeliveryPayments(pagamentos),
      discount: safeNumber(desconto),
      addition: safeNumber(acrescimo),
      items: Array.isArray(items) ? items.map((item) => ({ ...item })) : [],
      finalizedAt: null,
      customer: {
        nome:
          clienteBase.nome ||
          state.vendaCliente?.nome ||
          state.vendaCliente?.razaoSocial ||
          state.vendaCliente?.fantasia ||
          'Cliente',
        documento:
          clienteBase.documento ||
          state.vendaCliente?.cpf ||
          state.vendaCliente?.cnpj ||
          state.vendaCliente?.documento ||
          '',
        contato:
          clienteBase.contato ||
          state.vendaCliente?.telefone ||
          state.vendaCliente?.celular ||
          state.vendaCliente?.email ||
          '',
      },
      address: {
        ...address,
        formatted: address.formatted || buildDeliveryAddressLine(address),
      },
      receiptSnapshot: snapshot,
      saleCode: saleCode || snapshot?.meta?.saleCode || '',
    };
    return order;
  };

  const renderDeliveryOrders = () => {
    if (!elements.deliveryList || !elements.deliveryEmpty) return;
    const hasOrders = state.deliveryOrders.length > 0;
    elements.deliveryEmpty.classList.toggle('hidden', hasOrders);
    elements.deliveryList.classList.toggle('hidden', !hasOrders);
    elements.deliveryList.innerHTML = '';
    if (!hasOrders) return;
    const fragment = document.createDocumentFragment();
    state.deliveryOrders.forEach((order) => {
      const li = document.createElement('li');
      li.dataset.deliveryId = order.id;
      li.className = 'rounded-xl border border-gray-200 bg-white p-5 space-y-4';

      const header = document.createElement('div');
      header.className = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';
      const customerBox = document.createElement('div');
      const nameEl = document.createElement('p');
      nameEl.className = 'text-sm font-semibold text-gray-800';
      nameEl.textContent = order.customer.nome;
      customerBox.appendChild(nameEl);
      if (order.customer.documento) {
        const docEl = document.createElement('p');
        docEl.className = 'text-xs text-gray-500';
        docEl.textContent = `Documento: ${order.customer.documento}`;
        customerBox.appendChild(docEl);
      }
      if (order.customer.contato) {
        const contactEl = document.createElement('p');
        contactEl.className = 'text-xs text-gray-500';
        contactEl.textContent = order.customer.contato;
        customerBox.appendChild(contactEl);
      }
      header.appendChild(customerBox);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary';
      statusBadge.textContent = getDeliveryStatusLabel(order.status);
      header.appendChild(statusBadge);
      li.appendChild(header);

      const details = document.createElement('div');
      details.className = 'space-y-2 text-sm text-gray-600';

      const addressRow = document.createElement('p');
      addressRow.className = 'flex items-start gap-2';
      const addressIcon = document.createElement('i');
      addressIcon.className = 'fas fa-location-dot mt-0.5 text-gray-400';
      const addressText = document.createElement('span');
      addressText.textContent = order.address.formatted || 'Endereço não informado';
      addressRow.append(addressIcon, addressText);
      details.appendChild(addressRow);

      const totalRow = document.createElement('p');
      const totalLabel = document.createElement('span');
      totalLabel.textContent = 'Total: ';
      const totalValue = document.createElement('span');
      totalValue.className = 'font-semibold text-gray-800';
      totalValue.textContent = formatCurrency(order.total);
      totalRow.append(totalLabel, totalValue);
      details.appendChild(totalRow);

      if (order.paymentsLabel) {
        const paymentRow = document.createElement('p');
        paymentRow.className = 'text-xs text-gray-500';
        paymentRow.textContent = `Pagamentos: ${order.paymentsLabel}`;
        details.appendChild(paymentRow);
      }

      const updatedRow = document.createElement('p');
      updatedRow.className = 'text-xs text-gray-400';
      updatedRow.textContent = `Atualizado em ${toDateLabel(order.statusUpdatedAt || order.updatedAt)}`;
      details.appendChild(updatedRow);

      li.appendChild(details);

      const steps = document.createElement('div');
      steps.className = 'flex flex-wrap gap-2';
      const currentIndex = getDeliveryStatusIndex(order.status);
      deliveryStatusSteps.forEach((step, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.deliveryId = order.id;
        button.dataset.deliveryStatus = step.id;
        const baseClass = 'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition';
        let styleClass = 'border-gray-200 text-gray-500 hover:border-primary hover:text-primary';
        if (index < currentIndex) {
          styleClass = 'border-emerald-200 bg-emerald-50 text-emerald-700';
        }
        if (index === currentIndex) {
          styleClass = 'border-primary bg-primary/10 text-primary';
        }
        button.className = `${baseClass} ${styleClass}`;
        button.textContent = step.label;
        steps.appendChild(button);
      });
      li.appendChild(steps);

      const actions = document.createElement('div');
      actions.className = 'flex flex-wrap items-center justify-between gap-2';

      const advanceButton = document.createElement('button');
      advanceButton.type = 'button';
      advanceButton.dataset.deliveryAdvance = order.id;
      advanceButton.className = 'rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary hover:text-primary';
      advanceButton.textContent = 'Avançar status';
      if (currentIndex >= deliveryStatusSteps.length - 1) {
        advanceButton.disabled = true;
        advanceButton.classList.add('opacity-60', 'cursor-not-allowed');
      }
      actions.appendChild(advanceButton);

      const printButton = document.createElement('button');
      printButton.type = 'button';
      printButton.dataset.deliveryPrint = order.id;
      printButton.className = 'rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-white transition hover:bg-secondary';
      printButton.textContent = 'Imprimir comprovante';
      actions.appendChild(printButton);

      li.appendChild(actions);
      fragment.appendChild(li);
    });
    elements.deliveryList.appendChild(fragment);
  };

  const updateDeliveryStatus = (orderId, nextStatus) => {
    if (!orderId || !nextStatus) return;
    const order = state.deliveryOrders.find((item) => item.id === orderId);
    if (!order || order.status === nextStatus) return;
    if (order.finalizedAt) {
      notify('Este delivery já foi finalizado e não pode ter o status alterado.', 'info');
      return;
    }
    if (nextStatus === 'finalizado') {
      openDeliveryFinalizeModalForOrder(order);
      return;
    }
    order.status = nextStatus;
    const nowIso = new Date().toISOString();
    order.statusUpdatedAt = nowIso;
    order.updatedAt = nowIso;
    renderDeliveryOrders();
    notify(`Status do delivery atualizado para ${getDeliveryStatusLabel(nextStatus)}.`, 'success');
  };

  const advanceDeliveryStatus = (orderId) => {
    const order = state.deliveryOrders.find((item) => item.id === orderId);
    if (!order) return;
    const currentIndex = getDeliveryStatusIndex(order.status);
    if (currentIndex >= deliveryStatusSteps.length - 1) {
      notify('Este delivery já está finalizado.', 'info');
      return;
    }
    const nextStatus = deliveryStatusSteps[currentIndex + 1].id;
    updateDeliveryStatus(orderId, nextStatus);
  };

  const handleDeliveryListClick = (event) => {
    const statusButton = event.target.closest('button[data-delivery-status]');
    if (statusButton) {
      const orderId = statusButton.getAttribute('data-delivery-id');
      const statusId = statusButton.getAttribute('data-delivery-status');
      updateDeliveryStatus(orderId, statusId);
      return;
    }
    const advanceButton = event.target.closest('button[data-delivery-advance]');
    if (advanceButton) {
      const orderId = advanceButton.getAttribute('data-delivery-advance');
      advanceDeliveryStatus(orderId);
      return;
    }
    const printButton = event.target.closest('button[data-delivery-print]');
    if (printButton) {
      const orderId = printButton.getAttribute('data-delivery-print');
      const order = state.deliveryOrders.find((item) => item.id === orderId);
      if (order?.receiptSnapshot) {
        handleConfiguredPrint('venda', { snapshot: order.receiptSnapshot });
      }
    }
  };

  const promptDeliveryPrint = (snapshot) => {
    if (!snapshot) return;
    const shouldPrint = window.confirm('Deseja imprimir o comprovante de delivery?');
    if (shouldPrint) {
      handleConfiguredPrint('venda', { snapshot });
    }
  };

  const captureSaleStateSnapshot = () => ({
    itens: state.itens.map((item) => ({ ...item })),
    vendaPagamentos: state.vendaPagamentos.map((payment) => ({ ...payment })),
    vendaDesconto: state.vendaDesconto,
    vendaAcrescimo: state.vendaAcrescimo,
    selectedProduct: state.selectedProduct ? { ...state.selectedProduct } : null,
    quantidade: state.quantidade,
  });

  const applySaleStateSnapshot = (snapshot = {}) => {
    const itens = Array.isArray(snapshot.itens) ? snapshot.itens : [];
    const pagamentos = Array.isArray(snapshot.vendaPagamentos)
      ? snapshot.vendaPagamentos
      : [];
    state.itens = itens.map((item) => ({ ...item }));
    state.vendaPagamentos = pagamentos.map((payment) => ({ ...payment }));
    state.vendaDesconto = safeNumber(snapshot.vendaDesconto);
    state.vendaAcrescimo = safeNumber(snapshot.vendaAcrescimo);
    state.selectedProduct = snapshot.selectedProduct
      ? { ...snapshot.selectedProduct }
      : null;
    state.quantidade = snapshot.quantidade && snapshot.quantidade > 0 ? snapshot.quantidade : 1;
    updateSelectedProductView();
  };

  const restoreSaleStateFromBackup = () => {
    if (!state.saleStateBackup) return;
    applySaleStateSnapshot(state.saleStateBackup);
    state.saleStateBackup = null;
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
  };

  const openDeliveryFinalizeModalForOrder = (order) => {
    if (!order) return;
    if (order.finalizedAt) {
      notify('Este delivery já foi finalizado e registrado no caixa.', 'info');
      return;
    }
    if (order.status === 'finalizado') {
      notify('Este delivery já está finalizado.', 'info');
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para finalizar o delivery.', 'warning');
      return;
    }
    if (state.paymentMethodsLoading) {
      notify('Aguarde o carregamento dos meios de pagamento.', 'info');
      return;
    }
    if (!state.paymentMethods.length) {
      notify('Cadastre meios de pagamento para concluir a operação.', 'warning');
      return;
    }
    const hasItems = Array.isArray(order.items) && order.items.length > 0;
    if (!hasItems) {
      notify('Itens do delivery indisponíveis para finalização.', 'error');
      return;
    }
    state.saleStateBackup = captureSaleStateSnapshot();
    state.deliveryFinalizingOrderId = order.id;
    applySaleStateSnapshot({
      itens: order.items,
      vendaPagamentos: order.payments,
      vendaDesconto: order.discount,
      vendaAcrescimo: order.addition,
      selectedProduct: null,
      quantidade: 1,
    });
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    openFinalizeModal('delivery-complete');
  };

  const getFinalizeContextActionLabel = (context) => {
    if (context === 'delivery') return 'registrar o delivery';
    if (context === 'delivery-complete') return 'finalizar o delivery';
    return 'finalizar a venda';
  };

  const applyFinalizeModalContext = (context) => {
    if (context === 'delivery') {
      if (elements.finalizeTitle) {
        elements.finalizeTitle.textContent = 'Pagamento do delivery';
      }
      if (elements.finalizeSubtitle) {
        elements.finalizeSubtitle.textContent =
          'Informe as formas de pagamento e confirme o envio para entrega.';
      }
      if (elements.finalizeConfirm) {
        elements.finalizeConfirm.textContent = 'Concluir delivery';
      }
    } else if (context === 'delivery-complete') {
      if (elements.finalizeTitle) {
        elements.finalizeTitle.textContent = 'Finalizar delivery';
      }
      if (elements.finalizeSubtitle) {
        elements.finalizeSubtitle.textContent =
          'Confirme os pagamentos recebidos antes de registrar no caixa.';
      }
      if (elements.finalizeConfirm) {
        elements.finalizeConfirm.textContent = 'Finalizar delivery';
      }
    } else {
      if (elements.finalizeTitle) {
        elements.finalizeTitle.textContent = finalizeModalDefaults.title || 'Finalizar venda';
      }
      if (elements.finalizeSubtitle) {
        elements.finalizeSubtitle.textContent =
          finalizeModalDefaults.subtitle ||
          'Defina as formas de pagamento e confirme o fechamento da venda.';
      }
      if (elements.finalizeConfirm) {
        elements.finalizeConfirm.textContent =
          finalizeModalDefaults.confirm || 'Finalizar venda';
      }
    }
  };

  const openFinalizeModal = (context = 'sale') => {
    if (!state.caixaAberto) {
      notify(`Abra o caixa para ${getFinalizeContextActionLabel(context)}.`, 'warning');
      return;
    }
    if (!state.itens.length) {
      notify(`Adicione itens para ${getFinalizeContextActionLabel(context)}.`, 'warning');
      return;
    }
    if (state.paymentMethodsLoading) {
      notify('Aguarde o carregamento dos meios de pagamento.', 'info');
      return;
    }
    if (!state.paymentMethods.length) {
      notify('Cadastre meios de pagamento para concluir a operação.', 'warning');
      return;
    }
    if (context === 'delivery' && !state.deliverySelectedAddress) {
      notify('Selecione um endereço de entrega para continuar.', 'warning');
      return;
    }
    state.activeFinalizeContext = context;
    applyFinalizeModalContext(context);
    renderSalePaymentMethods();
    renderSalePaymentsPreview();
    updateSaleSummary();
    if (elements.finalizeModal) {
      elements.finalizeModal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    }
  };

  const toggleFinalizeOptions = (methodId) => {
    if (!elements.saleMethods || !methodId) return;
    const options = elements.saleMethods.querySelector(`[data-sale-options="${methodId}"]`);
    const toggle = elements.saleMethods.querySelector(`[data-sale-method-toggle="${methodId}"] i`);
    if (options) {
      options.classList.toggle('hidden');
      if (toggle) {
        toggle.classList.toggle('rotate-180', !options.classList.contains('hidden'));
      }
    }
  };

  const closePaymentValueModal = (preserveBodyScroll = false) => {
    if (elements.paymentValueModal) {
      elements.paymentValueModal.classList.add('hidden');
    }
    if (elements.paymentValueInput) {
      elements.paymentValueInput.value = '';
    }
    if (elements.paymentValueHint) {
      elements.paymentValueHint.textContent = '';
    }
    paymentModalState = null;
    if (!preserveBodyScroll) {
      document.body.classList.remove('overflow-hidden');
    }
  };

  const closeFinalizeModal = () => {
    if (!elements.finalizeModal) return;
    const context = state.activeFinalizeContext;
    elements.finalizeModal.classList.add('hidden');
    closePaymentValueModal(true);
    if (!elements.deliveryAddressModal || elements.deliveryAddressModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
    if (context === 'delivery-complete') {
      state.deliveryFinalizingOrderId = '';
      restoreSaleStateFromBackup();
    }
    applyFinalizeModalContext('sale');
    state.activeFinalizeContext = null;
  };

  const fiscalEmissionStepOrder = ['montando', 'assinando', 'transmitindo'];

  const updateFiscalEmissionStepIndicators = (activeStep = fiscalEmissionStepOrder[0]) => {
    state.fiscalEmissionStep = activeStep;
    if (!elements.fiscalStatusSteps) return;
    const items = elements.fiscalStatusSteps.querySelectorAll('[data-fiscal-step]');
    const activeIndex = fiscalEmissionStepOrder.indexOf(activeStep);
    items.forEach((item) => {
      const stepId = item.getAttribute('data-fiscal-step');
      const index = fiscalEmissionStepOrder.indexOf(stepId);
      const iconWrapper = item.querySelector('[data-fiscal-step-icon]');
      const iconElement = iconWrapper?.querySelector('i');
      const status = item.querySelector('[data-fiscal-step-status]');

      item.classList.remove('border-primary', 'bg-primary/5', 'text-primary', 'border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
      item.classList.add('border-gray-200', 'bg-gray-50', 'text-gray-600');

      if (iconWrapper) {
        iconWrapper.classList.remove('bg-primary/10', 'text-primary', 'bg-emerald-100', 'text-emerald-600');
        iconWrapper.classList.add('bg-gray-100', 'text-gray-400');
      }

      if (iconElement) {
        iconElement.classList.remove('fa-circle-notch', 'fa-check', 'animate-spin');
        iconElement.classList.add('fa-circle');
      }

      if (status) {
        status.textContent = 'Aguardando...';
        status.classList.remove('text-primary', 'text-emerald-600');
        status.classList.add('text-gray-400');
      }

      if (index === -1 || activeIndex === -1) {
        return;
      }

      if (index < activeIndex) {
        item.classList.remove('border-gray-200', 'bg-gray-50', 'text-gray-600');
        item.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
        if (iconWrapper) {
          iconWrapper.classList.remove('bg-gray-100', 'text-gray-400');
          iconWrapper.classList.add('bg-emerald-100', 'text-emerald-600');
        }
        if (iconElement) {
          iconElement.classList.remove('fa-circle');
          iconElement.classList.add('fa-check');
        }
        if (status) {
          status.textContent = 'Concluído';
          status.classList.remove('text-gray-400');
          status.classList.add('text-emerald-600');
        }
        return;
      }

      if (index === activeIndex) {
        item.classList.remove('border-gray-200', 'bg-gray-50', 'text-gray-600');
        item.classList.add('border-primary', 'bg-primary/5', 'text-primary');
        if (iconWrapper) {
          iconWrapper.classList.remove('bg-gray-100', 'text-gray-400');
          iconWrapper.classList.add('bg-primary/10', 'text-primary');
        }
        if (iconElement) {
          iconElement.classList.remove('fa-circle');
          iconElement.classList.add('fa-circle-notch', 'animate-spin');
        }
        if (status) {
          status.textContent = 'Em andamento';
          status.classList.remove('text-gray-400');
          status.classList.add('text-primary');
        }
      }
    });
  };

  const markFiscalEmissionCompleted = () => {
    state.fiscalEmissionStep = 'completed';
    if (!elements.fiscalStatusSteps) return;
    const items = elements.fiscalStatusSteps.querySelectorAll('[data-fiscal-step]');
    items.forEach((item) => {
      const iconWrapper = item.querySelector('[data-fiscal-step-icon]');
      const iconElement = iconWrapper?.querySelector('i');
      const status = item.querySelector('[data-fiscal-step-status]');

      item.classList.remove(
        'border-gray-200',
        'bg-gray-50',
        'text-gray-600',
        'border-primary',
        'bg-primary/5',
        'text-primary'
      );
      item.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');

      if (iconWrapper) {
        iconWrapper.classList.remove('bg-gray-100', 'text-gray-400', 'bg-primary/10', 'text-primary');
        iconWrapper.classList.add('bg-emerald-100', 'text-emerald-600');
      }

      if (iconElement) {
        iconElement.classList.remove('fa-circle', 'fa-circle-notch', 'animate-spin');
        iconElement.classList.add('fa-check');
      }

      if (status) {
        status.textContent = 'Concluído';
        status.classList.remove('text-gray-400', 'text-primary');
        status.classList.add('text-emerald-600');
      }
    });
  };

  const openFiscalEmissionModal = (initialStep = fiscalEmissionStepOrder[0]) => {
    state.fiscalEmissionModalOpen = true;
    if (!elements.fiscalStatusModal) return;
    elements.fiscalStatusModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    if (elements.fiscalStatusTitle) {
      elements.fiscalStatusTitle.textContent = 'Emitindo nota fiscal...';
    }
    updateFiscalEmissionStepIndicators(initialStep);
  };

  const closeFiscalEmissionModal = () => {
    if (!state.fiscalEmissionModalOpen) return;
    state.fiscalEmissionModalOpen = false;
    if (!elements.fiscalStatusModal) return;
    elements.fiscalStatusModal.classList.add('hidden');
    if (!elements.finalizeModal || elements.finalizeModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
  };

  const openPaymentValueModal = (method, parcelas) => {
    return new Promise((resolve, reject) => {
      if (!elements.paymentValueModal || !elements.paymentValueInput) {
        reject(new Error('Modal de pagamento indisponível.'));
        return;
      }
      if (paymentModalState) {
        paymentModalState.reject?.(new Error('Substituído'));
      }
      const restante = Math.max(getSaleTotalLiquido() - getSalePagoTotal(), 0);
      const parcelasLabel = parcelas > 1 ? `${parcelas}x` : 'à vista';
      if (elements.paymentValueTitle) {
        elements.paymentValueTitle.textContent = `Receber em ${method.label}`;
      }
      if (elements.paymentValueSubtitle) {
        elements.paymentValueSubtitle.textContent = `Pagamento ${parcelasLabel}.`;
      }
      if (elements.paymentValueHint) {
        elements.paymentValueHint.textContent = restante > 0
          ? `Restante sugerido: ${formatCurrency(restante)}.`
          : 'Informe o valor recebido para este pagamento.';
      }
      elements.paymentValueInput.value = restante > 0 ? restante.toFixed(2) : '';
      paymentModalState = { resolve, reject, method, parcelas };
      elements.paymentValueModal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      setTimeout(() => elements.paymentValueInput?.focus(), 60);
    });
  };

  const handlePaymentValueConfirm = () => {
    if (!paymentModalState) return;
    const value = safeNumber(elements.paymentValueInput?.value || 0);
    if (value <= 0) {
      notify('Informe um valor válido para o pagamento.', 'warning');
      elements.paymentValueInput?.focus();
      return;
    }
    paymentModalState.resolve({
      valor: value,
      method: paymentModalState.method,
      parcelas: paymentModalState.parcelas,
    });
    const preserve =
      elements.finalizeModal && !elements.finalizeModal.classList.contains('hidden');
    closePaymentValueModal(preserve);
  };

  const handlePaymentValueCancel = () => {
    if (!paymentModalState) {
      const preserve =
        elements.finalizeModal && !elements.finalizeModal.classList.contains('hidden');
      closePaymentValueModal(preserve);
      return;
    }
    paymentModalState.reject?.(new Error('Cancelado'));
    const preserve =
      elements.finalizeModal && !elements.finalizeModal.classList.contains('hidden');
    closePaymentValueModal(preserve);
  };

  const handleSaleMethodsClick = async (event) => {
    const toggleButton = event.target.closest('[data-sale-method-toggle]');
    if (toggleButton) {
      const methodId = toggleButton.getAttribute('data-sale-method-toggle');
      toggleFinalizeOptions(methodId);
      return;
    }
    const installmentButton = event.target.closest('[data-sale-installment]');
    if (installmentButton) {
      const value = installmentButton.getAttribute('data-sale-installment');
      if (!value) return;
      const [methodId, parcelasStr] = value.split(':');
      const parcelas = Math.max(1, Number(parcelasStr) || 1);
      const method = state.paymentMethods.find((item) => item.id === methodId);
      if (!method) return;
      if (!state.itens.length) {
        notify('Adicione itens para lançar pagamentos.', 'warning');
        return;
      }
      try {
        const result = await openPaymentValueModal(method, parcelas);
        state.vendaPagamentos.push({
          uid: createUid(),
          id: method.id,
          label: method.label,
          parcelas,
          valor: safeNumber(result.valor),
        });
        renderSalePaymentsPreview();
      } catch (_) {
        /* cancelado */
      }
      return;
    }
    const methodButton = event.target.closest('[data-sale-method]');
    if (!methodButton) return;
    const methodId = methodButton.getAttribute('data-sale-method');
    const method = state.paymentMethods.find((item) => item.id === methodId);
    if (!method) return;
    const parcelasAttr = methodButton.getAttribute('data-sale-parcelas');
    const parcelas = Math.max(1, Number(parcelasAttr) || 1);
    if (!state.itens.length) {
      notify('Adicione itens para lançar pagamentos.', 'warning');
      return;
    }
    try {
      const result = await openPaymentValueModal(method, parcelas);
      state.vendaPagamentos.push({
        uid: createUid(),
        id: method.id,
        label: method.label,
        parcelas,
        valor: safeNumber(result.valor),
      });
      renderSalePaymentsPreview();
    } catch (_) {
      /* cancelado */
    }
  };

  const handleSalePaymentsListClick = (event) => {
    const button = event.target.closest('[data-sale-remove]');
    if (!button) return;
    const uid = button.getAttribute('data-sale-remove');
    state.vendaPagamentos = state.vendaPagamentos.filter((payment) => payment.uid !== uid);
    renderSalePaymentsPreview();
  };

  const handleFinalizeButtonClick = () => {
    if (elements.finalizeButton?.disabled) return;
    openFinalizeModal('sale');
  };

  const describeSalePayments = (payments) => {
    if (!payments.length) return '';
    return payments
      .map((payment) => {
        const parcelas = payment.parcelas && payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
        return `${payment.label || 'Pagamento'}${parcelas}`;
      })
      .join(' + ');
  };

  const registerSaleOnCaixa = (payments, total, saleCode = '') => {
    if (!state.caixaAberto || !payments.length) {
      return;
    }
    payments.forEach((payment) => {
      const method = state.pagamentos.find((item) => item.id === payment.id);
      if (method) {
        method.valor += safeNumber(payment.valor);
        return;
      }
      const fallback =
        state.paymentMethods.find((item) => item.id === payment.id) ||
        state.paymentMethods.find((item) => item.label === payment.label);
      const base = fallback
        ? { ...fallback }
        : {
            id: payment.id || createUid(),
            label: payment.label || 'Pagamento',
            type: 'avista',
            aliases: [],
          };
      state.pagamentos.push({ ...base, valor: safeNumber(payment.valor) });
    });
    renderPayments();
    const paymentsSummary = describeSalePayments(payments);
    const historyPaymentLabel = [saleCode, paymentsSummary].filter(Boolean).join(' • ');
    const historyTitle = saleCode ? `Venda ${saleCode} finalizada` : 'Venda finalizada';
    addHistoryEntry({ id: 'venda', label: historyTitle }, total, '', historyPaymentLabel);
    updateStatusBadge();
  };

  const emitFiscalForSale = async (saleId, { notifyOnSuccess = true } = {}) => {
    const sale = findCompletedSaleById(saleId);
    if (!sale || sale.fiscalStatus === 'emitted' || sale.fiscalStatus === 'emitting') {
      return { success: false, reason: 'unavailable' };
    }
    if (sale.status === 'cancelled') {
      notify('Não é possível emitir fiscal para uma venda cancelada.', 'info');
      return { success: false, reason: 'cancelled' };
    }
    if (!sale.receiptSnapshot) {
      notify('Não há dados suficientes para gerar o XML fiscal desta venda.', 'warning');
      return { success: false, reason: 'missing-snapshot' };
    }
    if (!state.selectedPdv) {
      notify('Selecione um PDV para emitir a nota fiscal.', 'warning');
      return { success: false, reason: 'missing-pdv' };
    }
    sale.fiscalStatus = 'emitting';
    renderSalesList();
    let emissionModalOpened = false;
    const ensureEmissionModal = (initialStep = fiscalEmissionStepOrder[0]) => {
      if (emissionModalOpened) return;
      openFiscalEmissionModal(initialStep);
      emissionModalOpened = true;
    };
    ensureEmissionModal('montando');
    // Garante que o backend conheça a venda antes da emissão fiscal
    if (statePersistTimeout) {
      window.clearTimeout(statePersistTimeout);
      statePersistTimeout = null;
    }
    while (statePersistInFlight) {
      // Aguarda persistências anteriores concluírem para evitar condições de corrida
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    updateFiscalEmissionStepIndicators('montando');
    await flushStatePersist();
    updateFiscalEmissionStepIndicators('assinando');
    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      updateFiscalEmissionStepIndicators('transmitindo');
      const response = await fetch(
        `${API_BASE}/pdvs/${encodeURIComponent(state.selectedPdv)}/sales/${encodeURIComponent(
          saleId
        )}/fiscal`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            snapshot: sale.receiptSnapshot || null,
            saleCode: sale.saleCode || '',
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.message || 'Não foi possível emitir a nota fiscal.';
        throw new Error(message);
      }
      updateCompletedSaleRecord(saleId, {
        fiscalStatus: data?.fiscalStatus || 'emitted',
        fiscalEmittedAt: data?.fiscalEmittedAt || new Date().toISOString(),
        fiscalEmittedAtLabel: data?.fiscalEmittedAtLabel || '',
        fiscalDriveFileId: data?.fiscalDriveFileId || '',
        fiscalXmlUrl: data?.fiscalXmlUrl || '',
        fiscalXmlName: data?.fiscalXmlName || '',
        fiscalXmlContent: data?.fiscalXmlContent || sale.fiscalXmlContent || '',
        fiscalQrCodeData: data?.fiscalQrCodeData || sale.fiscalQrCodeData || '',
        fiscalQrCodeImage: data?.fiscalQrCodeImage || sale.fiscalQrCodeImage || '',
        fiscalEnvironment: data?.fiscalEnvironment || '',
        fiscalSerie: data?.fiscalSerie || '',
        fiscalNumber:
          data?.fiscalNumber !== undefined && data?.fiscalNumber !== null
            ? (() => {
                const numeric = Number(data.fiscalNumber);
                return Number.isFinite(numeric) ? numeric : sale.fiscalNumber ?? null;
              })()
            : sale.fiscalNumber ?? null,
        fiscalAccessKey: data?.fiscalAccessKey || sale.fiscalAccessKey || '',
        fiscalDigestValue: data?.fiscalDigestValue || sale.fiscalDigestValue || '',
        fiscalSignature: data?.fiscalSignature || sale.fiscalSignature || '',
        fiscalProtocol: data?.fiscalProtocol || sale.fiscalProtocol || '',
        fiscalItemsSnapshot: Array.isArray(data?.fiscalItemsSnapshot)
          ? data.fiscalItemsSnapshot
          : sale.fiscalItemsSnapshot,
      });
      if (elements.fiscalStatusTitle) {
        elements.fiscalStatusTitle.textContent = 'Nota fiscal emitida com sucesso!';
      }
      markFiscalEmissionCompleted();
      if (notifyOnSuccess) {
        notify('Nota fiscal emitida e salva no Drive.', 'success');
      }
      scheduleStatePersist({ immediate: true });
      if (emissionModalOpened) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
      return { success: true, data: data || null };
    } catch (error) {
      console.error('Erro ao emitir fiscal', error);
      sale.fiscalStatus = 'pending';
      renderSalesList();
      notify(error?.message || 'Não foi possível emitir a nota fiscal.', 'error');
      return { success: false, reason: 'error', error };
    }
    finally {
      if (emissionModalOpened) {
        closeFiscalEmissionModal();
      }
    }
  };

  const finalizeSaleFlow = async () => {
    const total = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    if (!state.itens.length) {
      notify('Adicione itens para finalizar a venda.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para finalizar a venda.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (Math.abs(total - pago) >= 0.01) {
      notify('O valor pago deve ser igual ao total da venda.', 'warning');
      return;
    }
    const saleCode = state.currentSaleCode || '';
    const itensSnapshot = state.itens.map((item) => ({ ...item }));
    const pagamentosVenda = state.vendaPagamentos.map((payment) => ({ ...payment }));
    const saleSnapshot = getSaleReceiptSnapshot(itensSnapshot, pagamentosVenda, { saleCode });
    registerSaleOnCaixa(pagamentosVenda, total, saleCode);
    const saleRecord = registerCompletedSaleRecord({
      type: 'venda',
      saleCode,
      snapshot: saleSnapshot,
      payments: pagamentosVenda,
      items: itensSnapshot,
      discount: state.vendaDesconto,
      addition: state.vendaAcrescimo,
      customer: state.vendaCliente,
    });
    const successMessage = saleCode
      ? `Venda ${saleCode} finalizada com sucesso.`
      : 'Venda finalizada com sucesso.';
    notify(successMessage, 'success');
    state.itens = [];
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    setSaleCustomer(null, null);
    clearSelectedProduct();
    clearSaleSearchAreas();
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    closeFinalizeModal();
    advanceSaleCode();
    const preferences = state.printPreferences || {};
    const mode = normalizePrintMode(preferences.venda, 'PM');
    const shouldEmitFiscal = resolvePrintVariant(mode) === 'fiscal';
    if (shouldEmitFiscal && saleRecord) {
      const emissionResult = await emitFiscalForSale(saleRecord.id);
      const updatedSale = findCompletedSaleById(saleRecord.id) || saleRecord;
      if (emissionResult?.success) {
        handleConfiguredPrint('venda', {
          snapshot: updatedSale.receiptSnapshot || saleSnapshot,
          xmlContent: updatedSale.fiscalXmlContent || '',
          qrCodeDataUrl: updatedSale.fiscalQrCodeImage || '',
          qrCodePayload: updatedSale.fiscalQrCodeData || '',
        });
      } else {
        handleConfiguredPrint('venda', { snapshot: saleSnapshot });
      }
    } else {
      handleConfiguredPrint('venda', { snapshot: saleSnapshot });
    }
  };

  const finalizeDeliveryFlow = () => {
    const total = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    if (!state.itens.length) {
      notify('Adicione itens para registrar o delivery.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para registrar o delivery.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (!state.deliverySelectedAddress) {
      notify('Selecione um endereço de entrega para continuar.', 'warning');
      closeFinalizeModal();
      void openDeliveryAddressModal();
      return;
    }
    if (Math.abs(total - pago) >= 0.01) {
      notify('O valor pago deve ser igual ao total da entrega.', 'warning');
      return;
    }
    const saleCode = state.currentSaleCode || '';
    const itensSnapshot = state.itens.map((item) => ({ ...item }));
    const pagamentosVenda = state.vendaPagamentos.map((payment) => ({ ...payment }));
    const saleSnapshot = getSaleReceiptSnapshot(itensSnapshot, pagamentosVenda, {
      deliveryAddress: state.deliverySelectedAddress,
      saleCode,
    });
    const orderRecord = createDeliveryOrderRecord(
      saleSnapshot,
      state.deliverySelectedAddress,
      pagamentosVenda,
      total,
      itensSnapshot,
      state.vendaDesconto,
      state.vendaAcrescimo,
      saleCode
    );
    const saleRecord = registerCompletedSaleRecord({
      type: 'delivery',
      saleCode,
      snapshot: saleSnapshot,
      payments: pagamentosVenda,
      items: itensSnapshot,
      discount: state.vendaDesconto,
      addition: state.vendaAcrescimo,
      customer: state.vendaCliente,
      createdAt: orderRecord.createdAt,
    });
    if (saleRecord) {
      orderRecord.saleRecordId = saleRecord.id;
    }
    state.deliveryOrders.unshift(orderRecord);
    renderDeliveryOrders();
    registerSaleOnCaixa(pagamentosVenda, total, saleCode);
    const successMessage = saleCode
      ? `Delivery ${saleCode} registrado com sucesso.`
      : 'Delivery registrado com sucesso.';
    notify(successMessage, 'success');
    state.itens = [];
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    setSaleCustomer(null, null);
    clearSelectedProduct();
    clearSaleSearchAreas();
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    closeFinalizeModal();
    advanceSaleCode();
    promptDeliveryPrint(saleSnapshot);
    state.deliverySelectedAddress = null;
    state.deliverySelectedAddressId = '';
  };

  const finalizeRegisteredDeliveryOrder = () => {
    const orderId = state.deliveryFinalizingOrderId;
    if (!orderId) {
      notify('Nenhum delivery selecionado para finalização.', 'warning');
      closeFinalizeModal();
      return;
    }
    const order = state.deliveryOrders.find((item) => item.id === orderId);
    if (!order) {
      notify('Não foi possível localizar o delivery para finalizar.', 'error');
      closeFinalizeModal();
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para finalizar o delivery.', 'warning');
      closeFinalizeModal();
      return;
    }
    const total = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    if (Math.abs(total - pago) >= 0.01) {
      notify('O valor pago deve ser igual ao total da entrega.', 'warning');
      return;
    }
    const saleCode = state.currentSaleCode || '';
    const itensSnapshot = state.itens.map((item) => ({ ...item }));
    const pagamentosVenda = state.vendaPagamentos.map((payment) => ({ ...payment }));
    const saleSnapshot = getSaleReceiptSnapshot(itensSnapshot, pagamentosVenda, {
      deliveryAddress: order.address,
      saleCode,
    });
    if (!saleSnapshot) {
      notify('Não foi possível gerar o comprovante do delivery.', 'error');
      return;
    }
    registerSaleOnCaixa(pagamentosVenda, total, saleCode);
    order.payments = pagamentosVenda;
    order.paymentsLabel = summarizeDeliveryPayments(pagamentosVenda);
    order.total = total;
    order.items = itensSnapshot;
    order.discount = state.vendaDesconto;
    order.addition = state.vendaAcrescimo;
    order.receiptSnapshot = saleSnapshot;
    order.saleCode = saleCode || order.saleCode;
    order.status = 'finalizado';
    const nowIso = new Date().toISOString();
    order.statusUpdatedAt = nowIso;
    order.updatedAt = nowIso;
    order.finalizedAt = nowIso;
    renderDeliveryOrders();
    const saleRecordId = order.saleRecordId;
    if (saleRecordId) {
      updateCompletedSaleRecord(saleRecordId, {
        saleCode: order.saleCode,
        snapshot: saleSnapshot,
        payments: pagamentosVenda,
        items: itensSnapshot,
        discount: state.vendaDesconto,
        addition: state.vendaAcrescimo,
        customer: state.vendaCliente,
      });
    } else {
      const saleRecord = registerCompletedSaleRecord({
        type: 'delivery',
        saleCode,
        snapshot: saleSnapshot,
        payments: pagamentosVenda,
        items: itensSnapshot,
        discount: state.vendaDesconto,
        addition: state.vendaAcrescimo,
        customer: state.vendaCliente,
        createdAt: order.createdAt,
      });
      if (saleRecord) {
        order.saleRecordId = saleRecord.id;
      }
    }
    const successMessage = saleCode
      ? `Delivery ${saleCode} finalizado e registrado no caixa.`
      : 'Delivery finalizado e registrado no caixa.';
    notify(successMessage, 'success');
    setSaleCustomer(null, null);
    clearSaleSearchAreas();
    closeFinalizeModal();
    advanceSaleCode();
    promptDeliveryPrint(saleSnapshot);
  };

  const handleFinalizeConfirm = async () => {
    if (state.activeFinalizeContext === 'delivery') {
      finalizeDeliveryFlow();
      return;
    }
    if (state.activeFinalizeContext === 'delivery-complete') {
      finalizeRegisteredDeliveryOrder();
      return;
    }
    try {
      await finalizeSaleFlow();
    } catch (error) {
      console.error('Erro ao finalizar venda', error);
    }
  };

  const handleSaleAdjust = () => {
    notify('Funcionalidade de acréscimo/desconto em desenvolvimento.', 'info');
  };

  const handleSaleItemAdjust = () => {
    notify('Funcionalidade de ajuste por item em desenvolvimento.', 'info');
  };

  const updateSaleSummary = () => {
    const totalLiquido = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    const desconto = state.vendaDesconto > 0 ? state.vendaDesconto : 0;
    if (elements.saleTotal) {
      elements.saleTotal.textContent = formatCurrency(totalLiquido);
    }
    if (elements.saleDiscount) {
      elements.saleDiscount.textContent = formatCurrency(desconto);
    }
    if (elements.salePaid) {
      elements.salePaid.textContent = formatCurrency(pago);
    }
    if (elements.finalizeConfirm) {
      const difference = Math.abs(totalLiquido - pago);
      const canFinalize = totalLiquido > 0 && difference < 0.01;
      elements.finalizeConfirm.disabled = !canFinalize;
      elements.finalizeConfirm.classList.toggle('opacity-60', !canFinalize);
      if (elements.finalizeDifference) {
        if (totalLiquido === 0) {
          elements.finalizeDifference.textContent = 'Adicione itens para finalizar a venda.';
        } else if (difference >= 0.01) {
          const remaining = totalLiquido - pago;
          const label = remaining > 0 ? `Faltam ${formatCurrency(remaining)}` : `Pago a maior ${formatCurrency(Math.abs(remaining))}`;
          elements.finalizeDifference.textContent = label;
        } else {
          elements.finalizeDifference.textContent = '';
        }
      }
    }
  };

  const populatePaymentSelect = () => {
    if (!elements.paymentSelect) return;
    if (state.paymentMethodsLoading) {
      elements.paymentSelect.innerHTML =
        '<option value="">Carregando meios de pagamento...</option>';
      elements.paymentSelect.disabled = true;
      return;
    }
    if (!state.pagamentos.length) {
      const label = state.selectedStore
        ? 'Nenhum meio de pagamento disponível'
        : 'Selecione uma empresa para carregar os meios de pagamento';
      elements.paymentSelect.innerHTML = `<option value="">${label}</option>`;
      elements.paymentSelect.disabled = true;
      return;
    }
    const previous = elements.paymentSelect.value;
    const options = state.pagamentos.map(
      (payment) => `<option value="${payment.id}">${payment.label}</option>`
    );
    elements.paymentSelect.innerHTML = options.join('');
    if (previous && state.pagamentos.some((payment) => payment.id === previous)) {
      elements.paymentSelect.value = previous;
    } else {
      elements.paymentSelect.value = state.pagamentos[0].id;
    }
    elements.paymentSelect.disabled = false;
  };

  const buildSummaryPrint = (snapshot = getFechamentoSnapshot()) => {
    if (!snapshot) {
      return 'Selecione uma empresa e um PDV para visualizar os dados do caixa.';
    }

    const lines = [];
    lines.push(`Empresa: ${snapshot.meta.store} | PDV: ${snapshot.meta.pdv}`);
    lines.push(`Período: ${snapshot.meta.abertura} → ${snapshot.meta.fechamento}`);
    lines.push('');
    lines.push('Resumo financeiro');
    lines.push(formatPrintLine('Abertura', snapshot.resumo.abertura.formatted));
    lines.push(formatPrintLine('Recebido', snapshot.resumo.recebido.formatted));
    lines.push(formatPrintLine('Saldo', snapshot.resumo.saldo.formatted));
    lines.push('');
    lines.push('Recebimentos por meio');
    if (snapshot.recebimentos.items.length) {
      snapshot.recebimentos.items.forEach((item) => {
        lines.push(formatPrintLine(item.label, item.formattedValue));
      });
      lines.push(formatPrintLine('Total recebido', snapshot.recebimentos.formattedTotal));
    } else {
      lines.push('Nenhum meio de pagamento configurado.');
    }
    lines.push('');
    lines.push('Fechamento previsto');
    if (snapshot.previsto.items.length) {
      snapshot.previsto.items.forEach((item) => {
        lines.push(formatPrintLine(item.label, item.formattedValue));
      });
      lines.push(formatPrintLine('Total previsto', snapshot.previsto.formattedTotal));
    } else {
      lines.push('Nenhum valor previsto.');
    }
    lines.push('');
    lines.push('Fechamento apurado');
    if (snapshot.apurado.items.length) {
      snapshot.apurado.items.forEach((item) => {
        lines.push(formatPrintLine(item.label, item.formattedValue));
      });
      lines.push(formatPrintLine('Total apurado', snapshot.apurado.formattedTotal));
    } else {
      lines.push('Aguardando fechamento.');
    }

    return lines.join('\n');
  };

  const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const getReceiptStyles = (variant = 'matricial') => {
    const accent = variant === 'fiscal' ? '#0b3d91' : '#111111';
    return `
      :root { color-scheme: light; }
      *, *::before, *::after { box-sizing: border-box; }
      @page { size: 80mm auto; margin: 0; }
      body {
        margin: 0;
        padding: 0;
        background: #fff;
        font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 11px;
        color: #111;
        font-weight: 500;
        -webkit-font-smoothing: antialiased;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        --receipt-accent: ${accent};
      }
      main.receipt {
        width: 74mm;
        margin: 0 auto;
        padding: 3mm 2mm 5mm;
        display: flex;
        flex-direction: column;
        gap: 2.2mm;
      }
      .receipt__header { text-align: center; }
      .receipt__title {
        margin: 0;
        font-size: 12.4px;
        font-weight: 800;
        letter-spacing: 0.55px;
        text-transform: uppercase;
      }
      .receipt__badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 1.4mm;
        margin-top: 1.2mm;
        padding: 0.6mm 2.2mm;
        font-size: 9.6px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.45px;
        border: 1px solid var(--receipt-accent);
        border-radius: 999px;
        color: var(--receipt-accent);
      }
      .receipt__meta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.7mm;
        font-size: 10.3px;
        line-height: 1.35;
        color: #222;
      }
      .receipt__meta-item {
        display: block;
        text-align: center;
        max-width: 64mm;
      }
      .receipt__section {
        border-top: 1px solid rgba(17, 17, 17, 0.85);
        padding-top: 2mm;
        display: flex;
        flex-direction: column;
        gap: 1.6mm;
      }
      .receipt__section:first-of-type {
        border-top: none;
        padding-top: 0;
      }
      .receipt__section-title {
        margin: 0;
        font-size: 10.7px;
        font-weight: 700;
        letter-spacing: 0.45px;
        text-transform: uppercase;
        color: #111;
      }
      .receipt__cards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.6mm;
      }
      .receipt-card {
        border: 1px solid rgba(17, 17, 17, 0.85);
        border-radius: 1.6mm;
        padding: 1.6mm 1.8mm;
        display: flex;
        flex-direction: column;
        gap: 0.4mm;
        background: rgba(17, 17, 17, 0.05);
      }
      .receipt-card__label {
        font-size: 9.8px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #333;
      }
      .receipt-card__value {
        font-size: 11.3px;
        font-weight: 700;
        color: #000;
      }
      .receipt-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 1.05mm;
      }
      .receipt-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.2mm;
        font-size: 10.4px;
      }
      .receipt-row__label {
        flex: 1;
        color: #333;
      }
      .receipt-row__value {
        font-weight: 700;
        color: #000;
      }
      .receipt-row--total .receipt-row__label {
        text-transform: uppercase;
        letter-spacing: 0.35px;
        font-weight: 700;
      }
      .receipt-row--total .receipt-row__value {
        font-size: 11.1px;
      }
      .receipt-list__empty {
        font-size: 10px;
        text-align: center;
        color: #666;
        padding: 1.6mm 0;
        border: 1px dashed rgba(102, 102, 102, 0.4);
        border-radius: 1.6mm;
        background: rgba(0, 0, 0, 0.03);
      }
      .receipt-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10.1px;
      }
      .receipt-table thead th {
        text-align: left;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.35px;
        padding-bottom: 0.8mm;
        border-bottom: 1px solid rgba(17, 17, 17, 0.85);
      }
      .receipt-table tbody td {
        padding: 0.6mm 0;
        border-bottom: 1px dashed rgba(17, 17, 17, 0.25);
        vertical-align: top;
      }
      .receipt-table tbody td:last-child {
        text-align: right;
        font-weight: 600;
      }
      .receipt-table__muted {
        display: block;
        font-size: 9.4px;
        color: #555;
      }
      .receipt__footer {
        margin-top: 2mm;
        text-align: center;
        font-size: 9.4px;
        color: #555;
        line-height: 1.45;
      }
      .receipt__footer-strong {
        font-weight: 600;
        color: #222;
      }
      main.receipt.receipt--nfce {
        padding: 2mm 1.4mm 3.4mm;
        gap: 1mm;
        font-size: 10px;
      }
      .receipt--nfce .nfce-compact__header {
        display: flex;
        flex-direction: column;
        gap: 0.6mm;
        border-bottom: 1px solid rgba(17, 17, 17, 0.65);
        padding-bottom: 1.2mm;
      }
      .nfce-compact__company {
        display: flex;
        flex-direction: column;
        gap: 0.3mm;
      }
      .nfce-compact__company-name {
        margin: 0;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.35px;
        text-transform: uppercase;
        color: #111;
      }
      .nfce-compact__company-secondary {
        margin: 0;
        font-size: 9.3px;
        color: #333;
        line-height: 1.3;
      }
      .nfce-compact__company-line {
        margin: 0;
        font-size: 9px;
        color: #222;
        line-height: 1.3;
      }
      .nfce-compact__header-meta {
        display: flex;
        flex-direction: column;
        gap: 0.6mm;
      }
      .nfce-compact__tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6mm;
      }
      .nfce-compact__tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.4mm 1mm;
        border: 1px solid var(--receipt-accent);
        border-radius: 1mm;
        font-size: 8.6px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.35px;
        color: var(--receipt-accent);
        background: rgba(17, 17, 17, 0.04);
      }
      .nfce-compact__reference {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.6mm;
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        color: #333;
      }
      .nfce-compact__reference-left,
      .nfce-compact__reference-right {
        flex: 1 1 auto;
      }
      .nfce-compact__reference-divider {
        flex: 0 0 auto;
        font-size: 9px;
        font-weight: 700;
        color: rgba(17, 17, 17, 0.65);
      }
      .nfce-compact__section {
        border-top: 1px solid rgba(17, 17, 17, 0.65);
        padding-top: 1.1mm;
        display: flex;
        flex-direction: column;
        gap: 0.6mm;
      }
      .nfce-compact__section-title {
        margin: 0;
        font-size: 9.2px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.35px;
        color: #111;
      }
      .nfce-compact__items-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 9px;
      }
      .nfce-compact__items-table thead th {
        text-align: left;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        padding-bottom: 0.4mm;
        border-bottom: 1px solid rgba(17, 17, 17, 0.65);
      }
      .nfce-compact__items-table thead th:nth-child(2) {
        text-align: center;
      }
      .nfce-compact__items-table thead th:last-child {
        text-align: right;
      }
      .nfce-compact__items-table tbody td {
        padding: 0.45mm 0;
        border-bottom: 1px dashed rgba(17, 17, 17, 0.25);
        vertical-align: top;
      }
      .nfce-compact__items-table tbody td:nth-child(2) {
        text-align: center;
        white-space: nowrap;
      }
      .nfce-compact__items-table tbody td:last-child {
        text-align: right;
        font-weight: 700;
      }
      .nfce-compact__item-name {
        display: block;
        font-weight: 700;
        color: #111;
      }
      .nfce-compact__item-code {
        display: block;
        font-size: 8px;
        color: #555;
      }
      .nfce-compact__totals-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4mm;
      }
      .nfce-compact__total {
        display: flex;
        justify-content: space-between;
        gap: 0.6mm;
        font-size: 9.2px;
        color: #222;
      }
      .nfce-compact__total span:last-child {
        font-weight: 700;
      }
      .nfce-compact__total--highlight span:first-child {
        text-transform: uppercase;
        letter-spacing: 0.35px;
      }
      .nfce-compact__total--highlight span:last-child {
        font-size: 10px;
      }
      .nfce-compact__text {
        margin: 0;
        font-size: 9px;
        line-height: 1.35;
        color: #222;
      }
      .nfce-compact__qr {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 2mm;
      }
      .nfce-compact__qr img {
        width: 30mm;
        height: 30mm;
        border: 1px solid rgba(17, 17, 17, 0.35);
        border-radius: 1.2mm;
        padding: 1mm;
        background: #fff;
        image-rendering: pixelated;
      }
      .nfce-compact__qr-payload {
        flex: 1 1 30mm;
        margin: 0;
        font-size: 8.6px;
        color: #333;
        line-height: 1.4;
        text-align: center;
        word-break: break-word;
      }
      .nfce-compact__access-key {
        margin: 0;
        font-size: 9.6px;
        font-weight: 700;
        letter-spacing: 0.45px;
        text-align: center;
        word-break: break-word;
      }
      .nfce-compact__muted {
        color: #777;
        font-weight: 500;
      }
      .nfce-compact__info-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4mm;
        font-size: 8.8px;
        color: #333;
      }
      .nfce-compact__info-list li {
        line-height: 1.35;
      }
      .nfce-compact__empty {
        font-size: 8.8px;
        text-align: center;
        color: #666;
        padding: 1mm 0;
      }
      .receipt__divider {
        width: 100%;
        border: none;
        border-top: 1px dashed rgba(17, 17, 17, 0.3);
        margin: 1.8mm 0 0;
      }
      .receipt-empty {
        margin: 0;
        padding: 7mm 0;
        text-align: center;
        font-size: 11px;
        color: #666;
        font-weight: 600;
      }
      .receipt-fallback {
        margin: 0;
        font-size: 9.8px;
        color: #666;
        line-height: 1.45;
        text-align: center;
        white-space: pre-wrap;
      }
      @media print {
        body { margin: 0; }
      }
    `;
  };

  const createReceiptDocument = ({ title, variant = 'matricial', body }) => {
    const safeTitle = escapeHtml(title || 'Documento para impressão');
    const styles = getReceiptStyles(variant);
    return `<!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>${safeTitle}</title>
          <style>${styles}</style>
        </head>
        <body data-variant="${escapeHtml(variant)}">${body}</body>
      </html>`;
  };

  const buildFechamentoReceiptMarkup = (snapshot, variant, fallbackText) => {
    if (!snapshot) {
      const fallback = fallbackText && fallbackText.trim()
        ? `<pre class="receipt-fallback">${escapeHtml(fallbackText)}</pre>`
        : '';
      return `<main class="receipt"><p class="receipt-empty">Fechamento sem conteúdo para impressão.</p>${fallback}</main>`;
    }

    const badgeLabel = variant === 'fiscal' ? 'Fiscal' : 'Matricial';
    const metaLines = [
      snapshot.meta.store,
      `PDV: ${snapshot.meta.pdv}`,
      `Período: ${snapshot.meta.abertura} → ${snapshot.meta.fechamento}`,
    ]
      .filter(Boolean)
      .map((line) => `<span class="receipt__meta-item">${escapeHtml(line)}</span>`)
      .join('');

    const resumoCards = `
      <div class="receipt__cards">
        <div class="receipt-card">
          <span class="receipt-card__label">Abertura</span>
          <span class="receipt-card__value">${escapeHtml(snapshot.resumo.abertura.formatted)}</span>
        </div>
        <div class="receipt-card">
          <span class="receipt-card__label">Recebido</span>
          <span class="receipt-card__value">${escapeHtml(snapshot.resumo.recebido.formatted)}</span>
        </div>
        <div class="receipt-card">
          <span class="receipt-card__label">Saldo</span>
          <span class="receipt-card__value">${escapeHtml(snapshot.resumo.saldo.formatted)}</span>
        </div>
      </div>`;

    const renderRows = (items, { totalLabel, totalValue, emptyLabel }) => {
      if (!items.length) {
        return `<li class="receipt-list__empty">${escapeHtml(emptyLabel)}</li>`;
      }
      const rows = items
        .map(
          (item) => `
            <li class="receipt-row">
              <span class="receipt-row__label">${escapeHtml(item.label)}</span>
              <span class="receipt-row__value">${escapeHtml(item.formattedValue)}</span>
            </li>`
        )
        .join('');
      const totalRow = totalLabel && totalValue
        ? `
            <li class="receipt-row receipt-row--total">
              <span class="receipt-row__label">${escapeHtml(totalLabel)}</span>
              <span class="receipt-row__value">${escapeHtml(totalValue)}</span>
            </li>`
        : '';
      return `${rows}${totalRow}`;
    };

    const recebimentosList = renderRows(snapshot.recebimentos.items, {
      totalLabel: 'Total recebido',
      totalValue: snapshot.recebimentos.formattedTotal,
      emptyLabel: 'Nenhum meio de pagamento configurado.',
    });
    const previstoList = renderRows(snapshot.previsto.items, {
      totalLabel: 'Total previsto',
      totalValue: snapshot.previsto.formattedTotal,
      emptyLabel: 'Nenhum valor previsto.',
    });
    const apuradoList = renderRows(snapshot.apurado.items, {
      totalLabel: 'Total apurado',
      totalValue: snapshot.apurado.formattedTotal,
      emptyLabel: 'Aguardando fechamento.',
    });

    return `
      <main class="receipt">
        <header class="receipt__header">
          <h1 class="receipt__title">Fechamento de Caixa</h1>
          <span class="receipt__badge">${escapeHtml(badgeLabel)}</span>
        </header>
        <section class="receipt__meta">${metaLines}</section>
        <section class="receipt__section">
          <h2 class="receipt__section-title">Resumo</h2>
          ${resumoCards}
        </section>
        <section class="receipt__section">
          <h2 class="receipt__section-title">Recebimentos</h2>
          <ul class="receipt-list">${recebimentosList}</ul>
        </section>
        <section class="receipt__section">
          <h2 class="receipt__section-title">Fechamento previsto</h2>
          <ul class="receipt-list">${previstoList}</ul>
        </section>
        <section class="receipt__section">
          <h2 class="receipt__section-title">Fechamento apurado</h2>
          <ul class="receipt-list">${apuradoList}</ul>
        </section>
      </main>`;
  };

  const formatEnvironmentLabel = (environment) => {
    if (!environment) return '';
    let normalized = String(environment).toLowerCase();
    if (normalized === '1') {
      normalized = 'producao';
    } else if (normalized === '2') {
      normalized = 'homologacao';
    }
    if (normalized === 'producao') {
      return 'Ambiente de Produção';
    }
    if (normalized === 'homologacao') {
      return 'Ambiente de Homologação';
    }
    return `Ambiente: ${environment}`;
  };

  const formatXmlDateTime = (value) => {
    if (!value) return '';
    try {
      const candidate = new Date(value);
      if (!Number.isNaN(candidate.getTime())) {
        return toDateLabel(candidate.toISOString());
      }
    } catch (_) {
      /* ignore */
    }
    return String(value);
  };

  const parseFiscalXmlDocument = (xmlContent) => {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return null;
    }
    if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
      return null;
    }
    try {
      const parser = new window.DOMParser();
      const doc = parser.parseFromString(xmlContent, 'application/xml');
      if (!doc) {
        return null;
      }
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        console.warn('XML fiscal inválido:', parseError.textContent);
        return null;
      }
      const root = doc.documentElement;
      if (!root) {
        return null;
      }
      const rootName = root.nodeName ? root.nodeName.toLowerCase() : '';
      const getChildText = (parent, tagName) => {
        if (!parent) return '';
        const node = parent.getElementsByTagName(tagName)[0];
        return node && node.textContent ? node.textContent.trim() : '';
      };

      const parseLegacyLayout = () => {
        const identificacaoNode = root.getElementsByTagName('Identificacao')[0];
        const emitenteNode = root.getElementsByTagName('Emitente')[0];
        const destinatarioNode = root.getElementsByTagName('Destinatario')[0];
        const entregaNode = root.getElementsByTagName('Entrega')[0];
        const itensNode = root.getElementsByTagName('Itens')[0];
        const totaisNode = root.getElementsByTagName('Totais')[0];
        const pagamentosNode = root.getElementsByTagName('Pagamentos')[0];
        const qrCodePayloadNode = root.getElementsByTagName('QrCode')[0];
        const qrCodeImageNode = root.getElementsByTagName('QrCodeImagem')[0];

        const identificacao = identificacaoNode
          ? {
              ambiente: getChildText(identificacaoNode, 'Ambiente'),
              pdvCodigo: getChildText(identificacaoNode, 'PdvCodigo'),
              pdvNome: getChildText(identificacaoNode, 'PdvNome'),
              vendaCodigo: getChildText(identificacaoNode, 'VendaCodigo'),
              serieFiscal: getChildText(identificacaoNode, 'SerieFiscal'),
              numeroFiscal: getChildText(identificacaoNode, 'NumeroFiscal'),
              dataRegistro: getChildText(identificacaoNode, 'DataRegistro'),
              dataEmissao: getChildText(identificacaoNode, 'DataEmissao'),
              operador: getChildText(identificacaoNode, 'Operador'),
              accessKey: '',
              digestValue: '',
              signatureValue: '',
              protocolo: '',
            }
          : {};

        const emitente = emitenteNode
          ? {
              razaoSocial: getChildText(emitenteNode, 'RazaoSocial'),
              nomeFantasia: getChildText(emitenteNode, 'NomeFantasia'),
              cnpj: getChildText(emitenteNode, 'CNPJ'),
              inscricaoEstadual: getChildText(emitenteNode, 'InscricaoEstadual'),
            }
          : {};

        const destinatario = destinatarioNode
          ? {
              nome: getChildText(destinatarioNode, 'Nome'),
              documento: getChildText(destinatarioNode, 'Documento'),
              contato: getChildText(destinatarioNode, 'Contato'),
              pet: getChildText(destinatarioNode, 'Pet'),
              apelido: getChildText(destinatarioNode, 'Apelido'),
              endereco: getChildText(destinatarioNode, 'Endereco'),
              logradouro: getChildText(destinatarioNode, 'Logradouro'),
              numero: getChildText(destinatarioNode, 'Numero'),
              complemento: getChildText(destinatarioNode, 'Complemento'),
              bairro: getChildText(destinatarioNode, 'Bairro'),
              municipio: getChildText(destinatarioNode, 'Municipio'),
              uf: getChildText(destinatarioNode, 'UF'),
              cep: getChildText(destinatarioNode, 'CEP'),
            }
          : null;

        const entrega = entregaNode
          ? {
              apelido: getChildText(entregaNode, 'Apelido'),
              endereco: getChildText(entregaNode, 'Endereco'),
              cep: getChildText(entregaNode, 'CEP'),
              logradouro: getChildText(entregaNode, 'Logradouro'),
              numero: getChildText(entregaNode, 'Numero'),
              complemento: getChildText(entregaNode, 'Complemento'),
              bairro: getChildText(entregaNode, 'Bairro'),
              municipio: getChildText(entregaNode, 'Municipio'),
              uf: getChildText(entregaNode, 'UF'),
            }
          : null;

        const itens = itensNode
          ? Array.from(itensNode.getElementsByTagName('Item')).map((node, index) => ({
              numero: getChildText(node, 'Numero') || String(index + 1),
              descricao: getChildText(node, 'Descricao'),
              codigos: getChildText(node, 'Codigos'),
              quantidade: getChildText(node, 'Quantidade'),
              unitario: getChildText(node, 'ValorUnitario'),
              total: getChildText(node, 'ValorTotal'),
            }))
          : [];

        const descontoNode = totaisNode?.getElementsByTagName('Desconto')[0] || null;
        const acrescimoNode = totaisNode?.getElementsByTagName('Acrescimo')[0] || null;
        const trocoNode = totaisNode?.getElementsByTagName('Troco')[0] || null;

        const totais = totaisNode
          ? {
              bruto: getChildText(totaisNode, 'Bruto'),
              desconto: descontoNode && descontoNode.textContent ? descontoNode.textContent.trim() : '',
              descontoValor: descontoNode?.getAttribute('valor') || '',
              acrescimo: acrescimoNode && acrescimoNode.textContent ? acrescimoNode.textContent.trim() : '',
              acrescimoValor: acrescimoNode?.getAttribute('valor') || '',
              liquido: getChildText(totaisNode, 'Liquido'),
              pago: getChildText(totaisNode, 'Pago'),
              troco: trocoNode && trocoNode.textContent ? trocoNode.textContent.trim() : '',
              trocoValor: trocoNode?.getAttribute('valor') || '',
            }
          : {};

        const pagamentos = pagamentosNode
          ? {
              total: getChildText(pagamentosNode, 'Total'),
              items: Array.from(pagamentosNode.getElementsByTagName('Pagamento')).map((node) => ({
                descricao: getChildText(node, 'Descricao'),
                valor: getChildText(node, 'Valor'),
              })),
            }
          : { total: '', items: [] };

        const qrCode = {
          payload: qrCodePayloadNode && qrCodePayloadNode.textContent ? qrCodePayloadNode.textContent.trim() : '',
          image: qrCodeImageNode && qrCodeImageNode.textContent ? qrCodeImageNode.textContent.trim() : '',
        };

        return { identificacao, emitente, destinatario, entrega, itens, totais, pagamentos, qrCode };
      };

      const parseOfficialLayout = () => {
        const infNFe = root.getElementsByTagName('infNFe')[0];
        if (!infNFe) {
          return null;
        }
        const ide = infNFe.getElementsByTagName('ide')[0];
        const emit = infNFe.getElementsByTagName('emit')[0];
        const dest = infNFe.getElementsByTagName('dest')[0];
        const entregaNode = infNFe.getElementsByTagName('entrega')[0];
        const totalNode = infNFe.getElementsByTagName('total')[0];
        const icmsTotNode = totalNode?.getElementsByTagName('ICMSTot')[0] || null;
        const pagNode = infNFe.getElementsByTagName('pag')[0];
        const infAdic = infNFe.getElementsByTagName('infAdic')[0];
        const suplNode = root.getElementsByTagName('infNFeSupl')[0];
        const signatureNode = root.getElementsByTagName('Signature')[0];

        const obsMap = (() => {
          const map = {};
          if (!infAdic) return map;
          const obsNodes = Array.from(infAdic.getElementsByTagName('obsCont'));
          obsNodes.forEach((node) => {
            const campo = node.getAttribute('xCampo');
            const valueNode = node.getElementsByTagName('xTexto')[0];
            const value = valueNode && valueNode.textContent ? valueNode.textContent.trim() : '';
            if (campo && value) {
              map[campo] = value;
            }
          });
          return map;
        })();

        const ambienteCodigo = getChildText(ide, 'tpAmb');
        const ambiente = ambienteCodigo === '1' ? 'producao' : ambienteCodigo === '2' ? 'homologacao' : ambienteCodigo;
        const accessKeyRaw = infNFe.getAttribute('Id') || '';
        const accessKey = accessKeyRaw.replace(/^NFe/i, '');
        const dhEmi = getChildText(ide, 'dhEmi');

        const identificacao = {
          ambiente,
          pdvCodigo: obsMap.PDVCodigo || '',
          pdvNome: obsMap.PDVNome || '',
          vendaCodigo: obsMap.VendaCodigo || getChildText(ide, 'cNF'),
          serieFiscal: getChildText(ide, 'serie'),
          numeroFiscal: getChildText(ide, 'nNF'),
          dataEmissao: dhEmi,
          dataRegistro: obsMap.RegistradoEm || '',
          operador: obsMap.Operador || '',
          accessKey,
          digestValue: '',
          signatureValue: '',
          protocolo: obsMap.Protocolo || '',
        };

        if (signatureNode) {
          const digestNode = signatureNode.getElementsByTagName('DigestValue')[0];
          const signatureValueNode = signatureNode.getElementsByTagName('SignatureValue')[0];
          if (digestNode && digestNode.textContent) {
            identificacao.digestValue = digestNode.textContent.trim();
          }
          if (signatureValueNode && signatureValueNode.textContent) {
            identificacao.signatureValue = signatureValueNode.textContent.trim();
          }
        }

        const emitente = emit
          ? {
              razaoSocial: getChildText(emit, 'xNome'),
              nomeFantasia: getChildText(emit, 'xFant'),
              cnpj: getChildText(emit, 'CNPJ'),
              inscricaoEstadual: getChildText(emit, 'IE'),
            }
          : {};

        const destinatarioEnderecoNode = dest?.getElementsByTagName('enderDest')[0] || null;
        const destinatarioEndereco = destinatarioEnderecoNode
          ? {
              endereco: `${getChildText(destinatarioEnderecoNode, 'xLgr')} ${getChildText(destinatarioEnderecoNode, 'nro')}`.trim(),
              logradouro: getChildText(destinatarioEnderecoNode, 'xLgr'),
              numero: getChildText(destinatarioEnderecoNode, 'nro'),
              complemento: getChildText(destinatarioEnderecoNode, 'xCpl'),
              bairro: getChildText(destinatarioEnderecoNode, 'xBairro'),
              municipio: getChildText(destinatarioEnderecoNode, 'xMun'),
              uf: getChildText(destinatarioEnderecoNode, 'UF'),
              cep: getChildText(destinatarioEnderecoNode, 'CEP'),
            }
          : null;

        const destinatario = dest
          ? {
              nome: getChildText(dest, 'xNome'),
              documento: getChildText(dest, 'CNPJ') || getChildText(dest, 'CPF'),
              contato: getChildText(dest, 'email') || getChildText(dest, 'fone'),
              pet: '',
              apelido: '',
              endereco: destinatarioEndereco,
              logradouro: destinatarioEndereco?.logradouro || '',
              numero: destinatarioEndereco?.numero || '',
              complemento: destinatarioEndereco?.complemento || '',
              bairro: destinatarioEndereco?.bairro || '',
              municipio: destinatarioEndereco?.municipio || '',
              uf: destinatarioEndereco?.uf || '',
              cep: destinatarioEndereco?.cep || '',
            }
          : null;

        const enderecoEntrega = entregaNode || dest?.getElementsByTagName('enderDest')[0] || null;
        const entrega = enderecoEntrega
          ? {
              apelido: '',
              endereco: `${getChildText(enderecoEntrega, 'xLgr')} ${getChildText(enderecoEntrega, 'nro')}`.trim(),
              cep: getChildText(enderecoEntrega, 'CEP'),
              logradouro: getChildText(enderecoEntrega, 'xLgr'),
              numero: getChildText(enderecoEntrega, 'nro'),
              complemento: getChildText(enderecoEntrega, 'xCpl'),
              bairro: getChildText(enderecoEntrega, 'xBairro'),
              municipio: getChildText(enderecoEntrega, 'xMun'),
              uf: getChildText(enderecoEntrega, 'UF'),
            }
          : null;

        const detNodes = Array.from(infNFe.getElementsByTagName('det'));
        const itens = detNodes.map((node, index) => {
          const prod = node.getElementsByTagName('prod')[0];
          const numero = node.getAttribute('nItem') || String(index + 1);
          const descricao = prod ? getChildText(prod, 'xProd') : '';
          const quantidade = prod ? getChildText(prod, 'qCom') : '';
          const unitario = prod ? getChildText(prod, 'vUnCom') : '';
          const total = prod ? getChildText(prod, 'vProd') : '';
          const codigos = prod ? getChildText(prod, 'cEAN') || getChildText(prod, 'cProd') : '';
          return {
            numero,
            descricao,
            codigos,
            quantidade,
            unitario,
            total,
          };
        });

        const bruto = safeNumber(getChildText(icmsTotNode, 'vProd'));
        const desconto = safeNumber(getChildText(icmsTotNode, 'vDesc'));
        const acrescimo = safeNumber(getChildText(icmsTotNode, 'vOutro'));
        const liquido = safeNumber(getChildText(icmsTotNode, 'vNF'));
        const pagoValores = [];
        const pagamentosItems = Array.from(pagNode ? pagNode.getElementsByTagName('detPag') : []).map((detPag) => {
          const code = getChildText(detPag, 'tPag');
          const valor = safeNumber(getChildText(detPag, 'vPag'));
          pagoValores.push(valor);
          const labels = {
            '01': 'Dinheiro',
            '02': 'Cheque',
            '03': 'Cartão de Crédito',
            '04': 'Cartão de Débito',
            '05': 'Crédito Loja',
            '10': 'Vale Alimentação',
            '11': 'Vale Refeição',
            '12': 'Vale Presente',
            '13': 'Vale Combustível',
            '14': 'Duplicata Mercantil',
            '15': 'Boleto Bancário',
            '16': 'Depósito Bancário',
            '17': 'PIX',
            '18': 'Transferência Bancária',
            '19': 'Programa de Fidelidade',
            '90': 'Sem pagamento',
            '99': 'Outros',
          };
          const descricao = labels[code] || (code ? `Código ${code}` : 'Pagamento');
          return {
            descricao,
            valor: formatCurrency(valor),
          };
        });
        const totalPago = pagoValores.reduce((sum, value) => sum + value, 0);
        const troco = safeNumber(getChildText(pagNode, 'vTroco'));

        const totais = {
          bruto: formatCurrency(bruto),
          desconto: formatCurrency(desconto),
          descontoValor: desconto.toFixed(2),
          acrescimo: formatCurrency(acrescimo),
          acrescimoValor: acrescimo.toFixed(2),
          liquido: formatCurrency(liquido),
          pago: formatCurrency(totalPago),
          troco: formatCurrency(troco),
          trocoValor: troco.toFixed(2),
        };

        const pagamentos = {
          total: formatCurrency(totalPago),
          items: pagamentosItems,
        };

        const qrCodeNode = suplNode?.getElementsByTagName('qrCode')[0] || null;
        const qrCode = {
          payload: qrCodeNode && qrCodeNode.textContent ? qrCodeNode.textContent.trim() : '',
          image: '',
        };

        return { identificacao, emitente, destinatario, entrega, itens, totais, pagamentos, qrCode };
      };

      if (rootName === 'nfe') {
        const parsed = parseOfficialLayout();
        if (parsed) {
          return parsed;
        }
      }

      if (rootName === 'nfce') {
        return parseLegacyLayout();
      }

      console.warn('Documento fiscal não reconhecido para impressão.');
      return null;
    } catch (error) {
      console.error('Erro ao interpretar XML fiscal para impressão:', error);
      return null;
    }
  };

  const buildNfceReceiptMarkup = (data) => {
    if (!data) {
      return '<main class="receipt"><p class="receipt-empty">Documento fiscal indisponível para impressão.</p></main>';
    }

    const { identificacao = {}, emitente = {}, destinatario, entrega, itens = [], totais = {}, qrCode = {} } = data;
    const ambienteLabel = formatEnvironmentLabel(identificacao.ambiente);
    const companyPrimaryName = emitente.nomeFantasia || emitente.razaoSocial || 'Emitente não informado';
    const companySecondaryName =
      emitente.nomeFantasia && emitente.razaoSocial && emitente.nomeFantasia !== emitente.razaoSocial
        ? emitente.razaoSocial
        : '';
    const companyDocuments = [
      emitente.cnpj ? `CNPJ: ${emitente.cnpj}` : '',
      emitente.inscricaoEstadual ? `IE: ${emitente.inscricaoEstadual}` : '',
    ]
      .filter(Boolean)
      .join(' • ');
    const companyAddressParts = [
      [emitente.logradouro || emitente.endereco, emitente.numero].filter(Boolean).join(', '),
      emitente.bairro ? `Bairro: ${emitente.bairro}` : '',
      [emitente.municipio, emitente.uf].filter(Boolean).join(' - '),
      emitente.cep ? `CEP: ${emitente.cep}` : '',
    ]
      .filter((part) => part && part.trim().length)
      .map((part) => part.trim());
    const companyAddress = companyAddressParts.join(' • ');

    const pdvParts = [
      identificacao.pdvNome ? `PDV ${identificacao.pdvNome}` : '',
      identificacao.pdvCodigo ? `Cód. PDV ${identificacao.pdvCodigo}` : '',
      identificacao.vendaCodigo ? `Venda ${identificacao.vendaCodigo}` : '',
    ].filter(Boolean);
    const documentoParts = [
      identificacao.serieFiscal ? `Série ${identificacao.serieFiscal}` : '',
      identificacao.numeroFiscal ? `NFC-e ${identificacao.numeroFiscal}` : '',
    ].filter(Boolean);

    const tags = [];
    if (ambienteLabel) {
      tags.push(`<span class="nfce-compact__tag">${escapeHtml(ambienteLabel)}</span>`);
    }
    const tagsMarkup = tags.length ? `<div class="nfce-compact__tags">${tags.join('')}</div>` : '';

    const referenceLeft = pdvParts.join(' • ');
    const referenceRight = documentoParts.join(' • ');
    const referenceSegments = [];
    if (referenceLeft) {
      referenceSegments.push(`<span class="nfce-compact__reference-left">${escapeHtml(referenceLeft)}</span>`);
    }
    if (referenceLeft && referenceRight) {
      referenceSegments.push('<span class="nfce-compact__reference-divider">|</span>');
    }
    if (referenceRight) {
      referenceSegments.push(`<span class="nfce-compact__reference-right">${escapeHtml(referenceRight)}</span>`);
    }
    const referenceMarkup = referenceSegments.length
      ? `<div class="nfce-compact__reference">${referenceSegments.join('')}</div>`
      : '';
    const headerMetaContent = [tagsMarkup, referenceMarkup].filter(Boolean).join('');
    const headerMeta = headerMetaContent ? `<div class="nfce-compact__header-meta">${headerMetaContent}</div>` : '';

    const itensRows = itens.length
      ? itens
          .map((item) => {
            const description = `${item.numero ? `${item.numero}. ` : ''}${item.descricao || 'Item'}`;
            const quantityParts = [];
            if (item.quantidade) quantityParts.push(item.quantidade);
            if (item.unitario) quantityParts.push(item.unitario);
            const quantity = quantityParts.length ? quantityParts.join(' × ') : '1';
            const codes = item.codigos
              ? `<span class="nfce-compact__item-code">${escapeHtml(item.codigos)}</span>`
              : '';
            return `
              <tr>
                <td>
                  <span class="nfce-compact__item-name">${escapeHtml(description)}</span>
                  ${codes}
                </td>
                <td>${escapeHtml(quantity)}</td>
                <td>${escapeHtml(item.total || '')}</td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="3" class="nfce-compact__empty">Nenhum item informado.</td></tr>';

    const totalsRows = [
      totais.bruto ? { label: 'Subtotal', value: totais.bruto } : null,
      totais.desconto
        ? { label: 'Desconto', value: totais.desconto.trim().startsWith('-') ? totais.desconto : `- ${totais.desconto}` }
        : null,
      totais.acrescimo
        ? { label: 'Acréscimos', value: totais.acrescimo.trim().startsWith('+') ? totais.acrescimo : totais.acrescimo }
        : null,
      totais.liquido ? { label: 'Total', value: totais.liquido, isTotal: true } : null,
      totais.pago ? { label: 'Pago', value: totais.pago } : null,
      totais.troco
        ? { label: 'Troco', value: totais.troco.trim().startsWith('-') ? totais.troco : totais.troco }
        : null,
    ].filter(Boolean);
    const totalsMarkup = totalsRows.length
      ? `<ul class="nfce-compact__totals-list">${totalsRows
          .map(
            (row) => `
              <li class="nfce-compact__total${row.isTotal ? ' nfce-compact__total--highlight' : ''}">
                <span>${escapeHtml(row.label)}</span>
                <span>${escapeHtml(row.value)}</span>
              </li>`
          )
          .join('')}</ul>`
      : '<p class="nfce-compact__empty">Totais indisponíveis.</p>';

    const destinatarioLines = [];
    if (destinatario?.nome) destinatarioLines.push(destinatario.nome);
    if (destinatario?.documento) destinatarioLines.push(`Doc.: ${destinatario.documento}`);
    if (destinatario?.contato) destinatarioLines.push(`Contato: ${destinatario.contato}`);
    if (destinatario?.pet) destinatarioLines.push(`Pet: ${destinatario.pet}`);
    const destinatarioSection = destinatarioLines.length
      ? `<section class="nfce-compact__section nfce-compact__section--info">
          <h2 class="nfce-compact__section-title">Destinatário</h2>
          <p class="nfce-compact__text">${destinatarioLines.map((line) => escapeHtml(line)).join('<br>')}</p>
        </section>`
      : '';

    const enderecoLines = [];
    const pickAddressField = (...candidates) => {
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
      return '';
    };

    const enderecoFonte = entrega || destinatario?.endereco || destinatario || null;
    const enderecoApelido = pickAddressField(entrega?.apelido, destinatario?.apelido);
    if (enderecoApelido) {
      enderecoLines.push(enderecoApelido);
    }

    const logradouro = pickAddressField(
      entrega?.logradouro,
      destinatario?.endereco?.logradouro,
      destinatario?.logradouro,
      enderecoFonte?.logradouro,
      enderecoFonte?.endereco
    );
    const numero = pickAddressField(entrega?.numero, destinatario?.endereco?.numero, destinatario?.numero, enderecoFonte?.numero);
    const enderecoPrincipal = logradouro || numero ? [logradouro, numero].filter(Boolean).join(', ') : pickAddressField(entrega?.endereco, destinatario?.endereco?.endereco, destinatario?.endereco, enderecoFonte?.endereco);
    if (enderecoPrincipal) {
      enderecoLines.push(enderecoPrincipal);
    }

    const complemento = pickAddressField(
      entrega?.complemento,
      destinatario?.endereco?.complemento,
      destinatario?.complemento,
      enderecoFonte?.complemento
    );
    if (complemento) {
      enderecoLines.push(`Compl.: ${complemento}`);
    }

    const bairro = pickAddressField(
      entrega?.bairro,
      destinatario?.endereco?.bairro,
      destinatario?.bairro,
      enderecoFonte?.bairro
    );
    if (bairro) {
      enderecoLines.push(`Bairro: ${bairro}`);
    }

    const municipio = pickAddressField(
      entrega?.municipio,
      destinatario?.endereco?.municipio,
      destinatario?.municipio,
      enderecoFonte?.municipio
    );
    const uf = pickAddressField(entrega?.uf, destinatario?.endereco?.uf, destinatario?.uf, enderecoFonte?.uf);
    const cidadeLinha = [municipio, uf].filter(Boolean).join(' - ');
    if (cidadeLinha) {
      enderecoLines.push(cidadeLinha);
    }

    const cep = pickAddressField(entrega?.cep, destinatario?.endereco?.cep, destinatario?.cep, enderecoFonte?.cep);
    if (cep) {
      enderecoLines.push(`CEP: ${cep}`);
    }
    const enderecoSection = enderecoLines.length
      ? `<section class="nfce-compact__section nfce-compact__section--info">
          <h2 class="nfce-compact__section-title">Endereço</h2>
          <p class="nfce-compact__text">${enderecoLines.map((line) => escapeHtml(line)).join('<br>')}</p>
        </section>`
      : '';

    const qrImage = qrCode.image || '';
    const qrPayload = qrCode.payload || '';
    const qrPayloadText = qrPayload ? escapeHtml(qrPayload) : escapeHtml('QR Code indisponível.');
    const qrImageMarkup = qrImage ? `<img src="${escapeHtml(qrImage)}" alt="QR Code da NFC-e" />` : '';
    const qrSection = `<section class="nfce-compact__section nfce-compact__section--qr">
        <h2 class="nfce-compact__section-title">Consulta</h2>
        <div class="nfce-compact__qr">
          ${qrImageMarkup}
          <p class="nfce-compact__qr-payload">${qrPayloadText}</p>
        </div>
      </section>`;

    const accessKeyRaw = (identificacao.accessKey || '').replace(/\s+/g, '');
    const accessKeyFormatted = accessKeyRaw ? accessKeyRaw.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '';
    const accessKeyDisplay = accessKeyFormatted || 'Chave de acesso não disponível.';
    const accessKeyClass = accessKeyFormatted
      ? 'nfce-compact__access-key'
      : 'nfce-compact__access-key nfce-compact__muted';
    const accessKeySection = `<section class="nfce-compact__section nfce-compact__section--key">
        <h2 class="nfce-compact__section-title">Chave de acesso</h2>
        <p class="${accessKeyClass}">${escapeHtml(accessKeyDisplay)}</p>
      </section>`;

    const infoLines = [
      ambienteLabel ? `Ambiente: ${ambienteLabel}` : '',
      identificacao.protocolo ? `Protocolo: ${identificacao.protocolo}` : '',
      identificacao.dataEmissao ? `Emissão: ${formatXmlDateTime(identificacao.dataEmissao)}` : '',
      identificacao.dataRegistro ? `Registro: ${formatXmlDateTime(identificacao.dataRegistro)}` : '',
      identificacao.digestValue ? `Digest: ${identificacao.digestValue}` : '',
      identificacao.operador ? `Operador: ${identificacao.operador}` : '',
    ].filter(Boolean);
    infoLines.push('Documento emitido eletronicamente. Consulte pelo QR Code ou portal da SEFAZ.');
    const infoSection = `<section class="nfce-compact__section nfce-compact__section--notes">
        <h2 class="nfce-compact__section-title">Informações obrigatórias</h2>
        <ul class="nfce-compact__info-list">
          ${infoLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>
      </section>`;

    return `
      <main class="receipt receipt--nfce nfce-compact">
        <header class="nfce-compact__header">
          <div class="nfce-compact__company">
            <h1 class="nfce-compact__company-name">${escapeHtml(companyPrimaryName)}</h1>
            ${
              companySecondaryName
                ? `<p class="nfce-compact__company-secondary">${escapeHtml(companySecondaryName)}</p>`
                : ''
            }
            ${
              companyDocuments
                ? `<p class="nfce-compact__company-line">${escapeHtml(companyDocuments)}</p>`
                : ''
            }
            ${
              companyAddress
                ? `<p class="nfce-compact__company-line">${escapeHtml(companyAddress)}</p>`
                : ''
            }
          </div>
          ${headerMeta}
        </header>
        <section class="nfce-compact__section nfce-compact__section--items">
          <h2 class="nfce-compact__section-title">Produtos</h2>
          <table class="nfce-compact__items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd × Vlr</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${itensRows}</tbody>
          </table>
        </section>
        <section class="nfce-compact__section nfce-compact__section--totals">
          <h2 class="nfce-compact__section-title">Totais</h2>
          ${totalsMarkup}
        </section>
        ${destinatarioSection}
        ${enderecoSection}
        ${qrSection}
        ${accessKeySection}
        ${infoSection}
      </main>`;
  };

  const buildSaleReceiptMarkup = (snapshot, variant) => {
    if (!snapshot) {
      return '<main class="receipt"><p class="receipt-empty">Nenhuma venda disponível para impressão.</p></main>';
    }

    const badgeLabel = variant === 'fiscal' ? 'Fiscal' : 'Matricial';
    const metaLines = [
      snapshot.meta.store,
      `PDV: ${snapshot.meta.pdv}`,
      snapshot.meta.saleCode ? `Venda: ${snapshot.meta.saleCode}` : '',
      snapshot.meta.operador ? `Operador: ${snapshot.meta.operador}` : '',
      snapshot.meta.data,
    ]
      .filter(Boolean)
      .map((line) => `<span class="receipt__meta-item">${escapeHtml(line)}</span>`)
      .join('');

    const itemsRows = snapshot.itens
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.index)}</td>
            <td>
              <strong>${escapeHtml(item.nome)}</strong>
              ${item.codigo ? `<span class="receipt-table__muted">${escapeHtml(item.codigo)}</span>` : ''}
            </td>
            <td>${escapeHtml(item.quantidade)} × ${escapeHtml(item.unitario)}</td>
            <td>${escapeHtml(item.subtotal)}</td>
          </tr>`
      )
      .join('');

    const totalsRows = [
      { label: 'Subtotal', value: snapshot.totais.bruto },
      snapshot.totais.descontoValor > 0
        ? { label: 'Descontos', value: `- ${snapshot.totais.desconto}` }
        : null,
      snapshot.totais.acrescimoValor > 0
        ? { label: 'Acréscimos', value: snapshot.totais.acrescimo }
        : null,
      { label: 'Total da venda', value: snapshot.totais.liquido, isTotal: true },
      { label: 'Pago', value: snapshot.totais.pago },
      snapshot.totais.trocoValor > 0
        ? { label: 'Troco', value: snapshot.totais.troco }
        : null,
    ]
      .filter(Boolean)
      .map((row) => `
        <li class="receipt-row${row.isTotal ? ' receipt-row--total' : ''}">
          <span class="receipt-row__label">${escapeHtml(row.label)}</span>
          <span class="receipt-row__value">${escapeHtml(row.value)}</span>
        </li>`)
      .join('');

    const pagamentosRows = snapshot.pagamentos.items.length
      ? snapshot.pagamentos.items
          .map(
            (payment) => `
              <li class="receipt-row">
                <span class="receipt-row__label">${escapeHtml(payment.label)}</span>
                <span class="receipt-row__value">${escapeHtml(payment.formatted)}</span>
              </li>`
          )
          .join('')
      : '<li class="receipt-list__empty">Nenhum pagamento registrado.</li>';

    const clienteSection = snapshot.cliente
      ? `
          <section class="receipt__section">
            <h2 class="receipt__section-title">Cliente</h2>
            <ul class="receipt-list">
              <li class="receipt-row">
                <span class="receipt-row__label">Nome</span>
                <span class="receipt-row__value">${escapeHtml(snapshot.cliente.nome)}</span>
              </li>
              ${snapshot.cliente.documento
                ? `<li class="receipt-row"><span class="receipt-row__label">Documento</span><span class="receipt-row__value">${escapeHtml(snapshot.cliente.documento)}</span></li>`
                : ''}
              ${snapshot.cliente.contato
                ? `<li class="receipt-row"><span class="receipt-row__label">Contato</span><span class="receipt-row__value">${escapeHtml(snapshot.cliente.contato)}</span></li>`
                : ''}
              ${snapshot.cliente.pet
                ? `<li class="receipt-row"><span class="receipt-row__label">Pet</span><span class="receipt-row__value">${escapeHtml(snapshot.cliente.pet)}</span></li>`
                : ''}
            </ul>
          </section>`
      : '';

    const deliverySection = snapshot.delivery
      ? `
          <section class="receipt__section">
            <h2 class="receipt__section-title">Entrega</h2>
            <ul class="receipt-list">
              <li class="receipt-row">
                <span class="receipt-row__label">Destino</span>
                <span class="receipt-row__value">${escapeHtml(snapshot.delivery.apelido || 'Entrega')}</span>
              </li>
              ${snapshot.delivery.formatted
                ? `<li class="receipt-row"><span class="receipt-row__label">Endereço</span><span class="receipt-row__value">${escapeHtml(snapshot.delivery.formatted)}</span></li>`
                : ''}
            </ul>
          </section>`
      : '';

    return `
      <main class="receipt">
        <header class="receipt__header">
          <h1 class="receipt__title">Comprovante de venda</h1>
          <span class="receipt__badge">${escapeHtml(badgeLabel)}</span>
        </header>
        <section class="receipt__meta">${metaLines}</section>
        ${clienteSection}
        ${deliverySection}
        <section class="receipt__section">
          <h2 class="receipt__section-title">Itens</h2>
          <table class="receipt-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Descrição</th>
                <th>Qtde × Valor</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
          </table>
        </section>
        <section class="receipt__section">
          <h2 class="receipt__section-title">Totais</h2>
          <ul class="receipt-list">${totalsRows}</ul>
        </section>
        <section class="receipt__section">
          <h2 class="receipt__section-title">Pagamentos</h2>
          <ul class="receipt-list">${pagamentosRows}</ul>
        </section>
        <footer class="receipt__footer">
          <p class="receipt__footer-strong">Obrigado pela preferência!</p>
          <p>Volte sempre.</p>
        </footer>
      </main>`;
  };

  const printHtmlDocument = (documentHtml, { logPrefix = 'documento' } = {}) => {
    if (typeof window === 'undefined') return false;

    const urlFactory = window.URL || window.webkitURL || null;
    const supportsBlobUrl =
      typeof Blob !== 'undefined' &&
      !!urlFactory &&
      typeof urlFactory.createObjectURL === 'function';

    let printWindow = null;
    let blobUrl = '';
    let fallbackTimer = null;
    let readinessTimer = null;
    let readyAttempts = 0;
    let printed = false;

    const clearTimers = () => {
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (readinessTimer) {
        window.clearTimeout(readinessTimer);
        readinessTimer = null;
      }
    };

    const releaseBlob = () => {
      if (blobUrl && urlFactory && typeof urlFactory.revokeObjectURL === 'function') {
        try {
          urlFactory.revokeObjectURL(blobUrl);
        } catch (_) {
          /* ignore */
        }
        blobUrl = '';
      }
    };

    const cleanup = () => {
      clearTimers();
      releaseBlob();
    };

    const triggerPrint = () => {
      if (printed || !printWindow) return;
      printed = true;
      try {
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        console.warn(`Falha ao acionar impressão automática do ${logPrefix}.`, error);
      } finally {
        window.setTimeout(releaseBlob, 1500);
      }
    };

    const waitForReady = () => {
      if (!printWindow) return;

      let isReady = true;
      try {
        const doc = printWindow.document;
        isReady = !!doc && doc.readyState === 'complete';
      } catch (error) {
        isReady = true;
      }

      if (!isReady && readyAttempts < 15) {
        readyAttempts += 1;
        readinessTimer = window.setTimeout(waitForReady, 120);
        return;
      }

      clearTimers();
      window.setTimeout(triggerPrint, 120);
    };

    try {
      if (supportsBlobUrl) {
        const blob = new Blob([documentHtml], { type: 'text/html' });
        blobUrl = urlFactory.createObjectURL(blob);
        printWindow = window.open(blobUrl, '_blank', 'noopener');
      } else {
        printWindow = window.open('', '_blank', 'noopener');
      }

      if (!printWindow) {
        cleanup();
        console.warn(`Não foi possível abrir a janela de impressão do ${logPrefix}.`);
        return false;
      }

      const handleLoad = () => {
        readyAttempts = 0;
        waitForReady();
      };

      if (!blobUrl) {
        const printDocument = printWindow.document;
        if (!printDocument) {
          if (typeof printWindow.close === 'function') {
            try {
              printWindow.close();
            } catch (_) {
              /* ignore */
            }
          }
          cleanup();
          return false;
        }

        printDocument.open();
        printDocument.write(documentHtml);
        printDocument.close();

        if (printWindow.addEventListener) {
          printWindow.addEventListener('load', handleLoad, { once: true });
        }

        if (printDocument.readyState === 'complete') {
          handleLoad();
        } else if (printDocument.addEventListener) {
          const readyListener = () => {
            if (printDocument.readyState === 'complete') {
              printDocument.removeEventListener('readystatechange', readyListener);
              handleLoad();
            }
          };
          printDocument.addEventListener('readystatechange', readyListener);
        }
      } else if (printWindow.addEventListener) {
        printWindow.addEventListener('load', handleLoad, { once: true });
      }

      if (printWindow.addEventListener) {
        printWindow.addEventListener('afterprint', cleanup);
        printWindow.addEventListener('beforeunload', cleanup);
      }

      fallbackTimer = window.setTimeout(() => {
        readyAttempts = 0;
        waitForReady();
      }, blobUrl ? 900 : 600);

      return true;
    } catch (error) {
      console.warn(`Falha ao preparar a impressão do ${logPrefix}.`, error);
      if (printWindow && typeof printWindow.close === 'function') {
        try {
          printWindow.close();
        } catch (_) {
          /* ignore */
        }
      }
      cleanup();
      return false;
    }
  };

  const printReceipt = (
    type,
    variant,
    { snapshot, fallbackText, xmlContent, qrCodeDataUrl, qrCodePayload } = {}
  ) => {
    const resolvedVariant = variant || 'matricial';
    let bodyHtml = '';
    let title = '';

    if (type === 'fechamento') {
      const effectiveSnapshot = snapshot || getFechamentoSnapshot();
      if (!effectiveSnapshot) {
        notify('Nenhum dado disponível para imprimir o fechamento.', 'warning');
        return false;
      }
      bodyHtml = buildFechamentoReceiptMarkup(effectiveSnapshot, resolvedVariant, fallbackText || buildSummaryPrint(effectiveSnapshot));
      title = 'Fechamento do caixa';
    } else if (type === 'venda') {
      const effectiveSnapshot = snapshot || getSaleReceiptSnapshot();
      if (!effectiveSnapshot) {
        notify('Nenhum dado disponível para imprimir a venda.', 'warning');
        return false;
      }
      let markup = '';
      if (resolvedVariant === 'fiscal') {
        const xmlSource =
          xmlContent || (effectiveSnapshot && typeof effectiveSnapshot === 'object'
            ? effectiveSnapshot.fiscalXmlContent || effectiveSnapshot.xml || ''
            : '');
        const fiscalData = parseFiscalXmlDocument(xmlSource);
        if (fiscalData) {
          if (!fiscalData.qrCode?.image && qrCodeDataUrl) {
            fiscalData.qrCode = { ...fiscalData.qrCode, image: qrCodeDataUrl };
          }
          if (!fiscalData.qrCode?.payload && qrCodePayload) {
            fiscalData.qrCode = { ...fiscalData.qrCode, payload: qrCodePayload };
          }
          markup = buildNfceReceiptMarkup(fiscalData);
        }
      }
      if (!markup) {
        markup = buildSaleReceiptMarkup(effectiveSnapshot, resolvedVariant);
      }
      bodyHtml = markup;
      title = resolvedVariant === 'fiscal' ? 'Cupom fiscal NFC-e' : 'Comprovante de venda';
    } else {
      return false;
    }

    const documentHtml = createReceiptDocument({ title, variant: resolvedVariant, body: bodyHtml });
    return printHtmlDocument(documentHtml, { logPrefix: title.toLowerCase() });
  };

  const executePrintMode = (type, mode, options = {}) => {
    if (!mode || mode === 'NONE') {
      return false;
    }
    const variant = resolvePrintVariant(mode);
    const requiresConfirmation = mode === 'PF' || mode === 'PM';
    if (requiresConfirmation) {
      const question = variant === 'fiscal'
        ? 'Deseja imprimir em Fiscal?'
        : 'Deseja imprimir em Matricial?';
      const confirmed = window.confirm(question);
      if (!confirmed) {
        return false;
      }
    }
    return printReceipt(type, variant, options);
  };

  const handleConfiguredPrint = (type, options = {}) => {
    if (typeof window === 'undefined') {
      return false;
    }
    const preferences = state.printPreferences || {};
    const mode = normalizePrintMode(preferences[type], 'PM');
    return executePrintMode(type, mode, options);
  };

  const updateSummary = () => {
    const total = sumPayments(state.pagamentos);
    state.summary.saldo = total;
    state.summary.recebido = Math.max(total - state.summary.abertura, 0);
    if (state.caixaAberto && !state.allowApuradoEdit) {
      state.caixaInfo.previstoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.fechamentoPrevisto = total;
    }
    if (!state.caixaAberto && !state.allowApuradoEdit) {
      state.caixaInfo.apuradoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.fechamentoApurado = sumPayments(state.caixaInfo.apuradoPagamentos);
      if (!state.caixaInfo.fechamentoPrevisto) {
        state.caixaInfo.fechamentoPrevisto = sumPayments(state.caixaInfo.previstoPagamentos || []);
      }
    }
    if (elements.summaryPrint) {
      elements.summaryPrint.textContent = buildSummaryPrint();
    }
  };

  const setLastMovement = (entry) => {
    state.lastMovement = entry || null;
    if (!elements.summaryLastMove) return;
    if (!entry) {
      elements.summaryLastMove.textContent = 'Nenhuma movimentação registrada.';
      return;
    }
    const amount = Math.abs(entry.delta);
    const amountLabel =
      entry.delta < 0 ? `- ${formatCurrency(amount)}` : formatCurrency(amount);
    const details = [amountLabel, entry.paymentLabel].filter(Boolean).join(' • ');
    elements.summaryLastMove.textContent = `${entry.label}${details ? ` • ${details}` : ''} • ${toDateLabel(
      entry.timestamp
    )}`;
  };

  const createCompletedSaleRecord = ({
    type = 'venda',
    saleCode = '',
    snapshot = null,
    payments = [],
    items = [],
    discount = 0,
    addition = 0,
    customer = null,
    createdAt = null,
  } = {}) => {
    const normalizedType = type === 'delivery' ? 'delivery' : 'venda';
    const typeLabel = normalizedType === 'delivery' ? 'Delivery' : 'Venda';
    const saleItems = Array.isArray(items) ? items : [];
    const paymentTags = Array.from(
      new Set(
        (Array.isArray(payments) ? payments : [])
          .map((payment) => {
            const label = payment?.label || 'Pagamento';
            const parcelas = payment?.parcelas && payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
            return `${label}${parcelas}`;
          })
          .filter(Boolean)
      )
    );
    const snapshotCustomer = snapshot?.cliente || {};
    const customerSource = customer || {};
    const customerName =
      snapshotCustomer?.nome ||
      snapshotCustomer?.razaoSocial ||
      customerSource?.nome ||
      customerSource?.razaoSocial ||
      customerSource?.fantasia ||
      'Cliente não informado';
    const customerDocument =
      snapshotCustomer?.documento ||
      snapshotCustomer?.cpf ||
      snapshotCustomer?.cnpj ||
      customerSource?.cpf ||
      customerSource?.cnpj ||
      customerSource?.documento ||
      '';
    const createdIso = createdAt || new Date().toISOString();
    const discountValue = Math.max(
      0,
      safeNumber(snapshot?.totais?.descontoValor ?? snapshot?.totais?.desconto ?? discount ?? 0)
    );
    const additionValue = Math.max(
      0,
      safeNumber(snapshot?.totais?.acrescimoValor ?? snapshot?.totais?.acrescimo ?? addition ?? 0)
    );
    const itemDisplays = saleItems.map((item, index) => {
      const barcode = item?.codigoBarras || item?.codigo || item?.barcode || '—';
      const productName = item?.nome || item?.descricao || item?.produto || `Item ${index + 1}`;
      const quantityValue = safeNumber(item?.quantidade ?? item?.qtd ?? 0);
      const quantityLabel = quantityValue.toLocaleString('pt-BR', {
        minimumFractionDigits: Number.isInteger(quantityValue) ? 0 : 2,
        maximumFractionDigits: 3,
      });
      const unitValue = safeNumber(item?.valor ?? item?.valorUnitario ?? item?.preco ?? 0);
      const subtotalValue = safeNumber(item?.subtotal ?? item?.total ?? unitValue * quantityValue);
      return {
        id: item?.id || `${Date.now()}-${index}`,
        barcode: barcode || '—',
        product: productName,
        quantityLabel,
        unitLabel: formatCurrency(unitValue),
        totalLabel: formatCurrency(subtotalValue),
      };
    });
    const fiscalItemsSnapshot = saleItems.map((item) => ({
      productId: item?.id || item?.productSnapshot?._id || null,
      quantity: safeNumber(item?.quantidade ?? item?.qtd ?? 0),
      unitPrice: safeNumber(item?.valor ?? item?.valorUnitario ?? item?.preco ?? 0),
      totalPrice: safeNumber(item?.subtotal ?? item?.total ?? 0),
      name: item?.nome || item?.descricao || item?.produto || '',
      barcode: item?.codigoBarras || item?.codigo || '',
      internalCode: item?.codigoInterno || '',
      unit: item?.unidade || item?.productSnapshot?.unidade || 'UN',
      productSnapshot: item?.productSnapshot ? { ...item.productSnapshot } : null,
    }));
    return {
      id: createUid(),
      type: normalizedType,
      typeLabel,
      saleCode: saleCode || '',
      saleCodeLabel: saleCode || 'Sem código',
      customerName,
      customerDocument,
      paymentTags,
      items: itemDisplays,
      discountValue,
      discountLabel: formatCurrency(discountValue),
      additionValue,
      createdAt: createdIso,
      createdAtLabel: toDateLabel(createdIso),
      receiptSnapshot: snapshot,
      fiscalStatus: 'pending',
      fiscalEmittedAt: null,
      fiscalEmittedAtLabel: '',
      fiscalDriveFileId: '',
      fiscalXmlUrl: '',
      fiscalXmlName: '',
      fiscalXmlContent: '',
      fiscalQrCodeData: '',
      fiscalQrCodeImage: '',
      fiscalEnvironment: '',
      fiscalSerie: '',
      fiscalNumber: null,
      fiscalAccessKey: '',
      fiscalDigestValue: '',
      fiscalSignature: '',
      fiscalProtocol: '',
      fiscalItemsSnapshot,
      expanded: false,
      status: 'completed',
      cancellationReason: '',
      cancellationAt: null,
      cancellationAtLabel: '',
    };
  };

  const renderSalesList = () => {
    if (!elements.salesList || !elements.salesEmpty) return;
    elements.salesList.innerHTML = '';
    const hasSales = state.completedSales.length > 0;
    elements.salesEmpty.classList.toggle('hidden', hasSales);
    elements.salesList.classList.toggle('hidden', !hasSales);
    if (!hasSales) {
      return;
    }
    const fragment = document.createDocumentFragment();
    state.completedSales.forEach((sale) => {
      const saleId = sale.id;
      const chevronIcon = sale.expanded ? 'fa-chevron-up' : 'fa-chevron-down';
      const paymentTagsHtml = sale.paymentTags
        .map(
          (tag) =>
            `<span class="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600">${escapeHtml(
              tag
            )}</span>`
        )
        .join('');
      const isCancelled = sale.status === 'cancelled';
      const cancellationDateLabel =
        sale.cancellationAtLabel || (sale.cancellationAt ? toDateLabel(sale.cancellationAt) : '');
      const cancellationInfo = isCancelled
        ? `<div class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <p class="font-semibold">Venda cancelada</p>
            ${
              sale.cancellationReason
                ? `<p class="mt-1 text-rose-600">${escapeHtml(sale.cancellationReason)}</p>`
                : ''
            }
            ${
              cancellationDateLabel
                ? `<p class="mt-1 text-[11px] uppercase tracking-wide text-rose-500">${escapeHtml(
                    cancellationDateLabel
                  )}</p>`
                : ''
            }
          </div>`
        : '';
      const itemsRows = sale.items.length
        ? sale.items
            .map(
              (item) => `
                  <tr>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-600">${escapeHtml(item.barcode || '—')}</td>
                    <td class="px-3 py-2 text-gray-700">${escapeHtml(item.product)}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-600">${escapeHtml(item.quantityLabel)}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-600">${escapeHtml(item.unitLabel)}</td>
                    <td class="px-3 py-2 whitespace-nowrap text-gray-600">${escapeHtml(item.totalLabel)}</td>
                  </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="px-3 py-4 text-center text-xs text-gray-500">Nenhum produto registrado nesta venda.</td></tr>';
      const printControl = isCancelled
        ? ''
        : `<button type="button" class="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary hover:text-primary" data-sale-print data-sale-id="${escapeHtml(
            saleId
          )}">
            <i class="fas fa-print text-[11px]"></i>
            <span>Imprimir</span>
          </button>`;
      let fiscalControl = '';
      if (isCancelled || !sale.receiptSnapshot) {
        fiscalControl = `<span class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500"><i class="fas fa-ban text-[11px]"></i><span>Fiscal indisponível</span></span>`;
      } else if (sale.fiscalStatus === 'emitting') {
        fiscalControl = `<span class="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><i class="fas fa-circle-notch fa-spin text-[11px]"></i><span>Emitindo...</span></span>`;
      } else if (sale.fiscalStatus === 'emitted') {
        const fiscalTooltip = [sale.fiscalEmittedAtLabel, sale.fiscalXmlName]
          .filter(Boolean)
          .join(' • ');
        const baseClass =
          'inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700';
        if (sale.fiscalXmlUrl) {
          fiscalControl = `<a class="${baseClass}" href="${escapeHtml(
            sale.fiscalXmlUrl
          )}" target="_blank" rel="noopener" ${
            fiscalTooltip ? `title="${escapeHtml(fiscalTooltip)}"` : ''
          }><i class="fas fa-file-circle-check text-[11px]"></i><span>XML emitida</span></a>`;
        } else {
          fiscalControl = `<span class="${baseClass}" ${
            fiscalTooltip ? `title="${escapeHtml(fiscalTooltip)}"` : ''
          }><i class="fas fa-file-circle-check text-[11px]"></i><span>XML emitida</span></span>`;
        }
      } else {
        fiscalControl = `<button type="button" class="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-primary hover:text-primary" data-sale-fiscal data-sale-id="${escapeHtml(
          saleId
        )}"><i class="fas fa-file-invoice text-[11px]"></i><span>Emitir Fiscal</span></button>`;
      }
      const cancelControl = isCancelled
        ? `<span class="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"><i class="fas fa-ban text-[11px]"></i><span>Cancelada</span></span>`
        : `<button type="button" class="inline-flex items-center gap-2 rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700" data-sale-cancel data-sale-id="${escapeHtml(
            saleId
          )}"><i class="fas fa-ban text-[11px]"></i><span>Cancelar</span></button>`;
      const li = document.createElement('li');
      li.dataset.saleId = saleId;
      li.innerHTML = `
        <article class="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div class="space-y-4 p-4 sm:p-5">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <button type="button" class="flex-1 text-left" data-sale-toggle data-sale-id="${escapeHtml(
                saleId
              )}" aria-expanded="${sale.expanded ? 'true' : 'false'}">
                <div class="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800">
                  <span>${escapeHtml(sale.saleCodeLabel)}</span>
                  <span class="text-gray-300">|</span>
                  <span class="truncate text-gray-700">${escapeHtml(sale.customerName)}</span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
                  <span>${escapeHtml(sale.createdAtLabel)}</span>
                  ${sale.customerDocument ? `<span>${escapeHtml(sale.customerDocument)}</span>` : ''}
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">${escapeHtml(
                    sale.typeLabel
                  )}</span>
                  ${paymentTagsHtml}
                </div>
                <div class="mt-3 inline-flex items-center gap-2 text-xs text-gray-400">
                  <span>${sale.expanded ? 'Ocultar produtos' : 'Ver produtos'}</span>
                  <i class="fas ${chevronIcon}"></i>
                </div>
              </button>
              <div class="flex items-center gap-2">
                ${printControl}
                ${fiscalControl}
                ${cancelControl}
              </div>
            </div>
            <div class="${sale.expanded ? '' : 'hidden'} border-t border-gray-100 pt-4" data-sale-details>
              ${cancellationInfo}
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 text-xs text-gray-600">
                  <thead class="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" class="px-3 py-2 text-left font-semibold">Código de barras</th>
                      <th scope="col" class="px-3 py-2 text-left font-semibold">Produto</th>
                      <th scope="col" class="px-3 py-2 text-left font-semibold">Qtd</th>
                      <th scope="col" class="px-3 py-2 text-left font-semibold">Valor un.</th>
                      <th scope="col" class="px-3 py-2 text-left font-semibold">Valor total</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    ${itemsRows}
                  </tbody>
                </table>
              </div>
              <p class="mt-4 text-xs text-gray-500"><span class="font-semibold text-gray-700">Desconto aplicado:</span> ${
                sale.discountValue > 0 ? escapeHtml(sale.discountLabel) : 'Nenhum'
              }</p>
            </div>
          </div>
        </article>
      `;
      fragment.appendChild(li);
    });
    elements.salesList.appendChild(fragment);
  };

  const registerCompletedSaleRecord = (options = {}) => {
    const record = createCompletedSaleRecord(options);
    if (!record) return null;
    state.completedSales.unshift(record);
    renderSalesList();
    scheduleStatePersist();
    return record;
  };

  const updateCompletedSaleRecord = (saleId, updates = {}) => {
    const sale = findCompletedSaleById(saleId);
    if (!sale) return null;
    const {
      saleCode,
      snapshot,
      payments,
      items,
      discount,
      addition,
      customer,
      status,
      cancellationReason,
      cancellationAt,
      fiscalStatus,
      fiscalEmittedAt,
      fiscalDriveFileId,
      fiscalXmlUrl,
      fiscalXmlName,
      fiscalEnvironment,
      fiscalEmittedAtLabel,
      fiscalSerie,
      fiscalNumber,
      fiscalXmlContent,
      fiscalQrCodeData,
      fiscalQrCodeImage,
      fiscalAccessKey,
      fiscalDigestValue,
      fiscalSignature,
      fiscalProtocol,
      fiscalItemsSnapshot,
    } = updates;
    if (saleCode !== undefined) {
      sale.saleCode = saleCode || '';
      sale.saleCodeLabel = sale.saleCode || 'Sem código';
    }
    if (snapshot !== undefined) {
      sale.receiptSnapshot = snapshot || null;
    }
    if (fiscalStatus !== undefined) {
      sale.fiscalStatus = fiscalStatus || 'pending';
    }
    if (fiscalEmittedAt !== undefined) {
      sale.fiscalEmittedAt = fiscalEmittedAt ? new Date(fiscalEmittedAt).toISOString() : null;
      sale.fiscalEmittedAtLabel = sale.fiscalEmittedAt
        ? toDateLabel(sale.fiscalEmittedAt)
        : '';
    }
    if (fiscalEmittedAtLabel !== undefined) {
      sale.fiscalEmittedAtLabel = fiscalEmittedAtLabel || sale.fiscalEmittedAtLabel || '';
    }
    if (fiscalDriveFileId !== undefined) {
      sale.fiscalDriveFileId = fiscalDriveFileId || '';
    }
    if (fiscalXmlUrl !== undefined) {
      sale.fiscalXmlUrl = fiscalXmlUrl || '';
    }
    if (fiscalXmlName !== undefined) {
      sale.fiscalXmlName = fiscalXmlName || '';
    }
    if (fiscalXmlContent !== undefined) {
      sale.fiscalXmlContent = fiscalXmlContent || '';
    }
    if (fiscalQrCodeData !== undefined) {
      sale.fiscalQrCodeData = fiscalQrCodeData || '';
    }
    if (fiscalQrCodeImage !== undefined) {
      sale.fiscalQrCodeImage = fiscalQrCodeImage || '';
    }
    if (fiscalAccessKey !== undefined) {
      sale.fiscalAccessKey = fiscalAccessKey || '';
    }
    if (fiscalDigestValue !== undefined) {
      sale.fiscalDigestValue = fiscalDigestValue || '';
    }
    if (fiscalSignature !== undefined) {
      sale.fiscalSignature = fiscalSignature || '';
    }
    if (fiscalProtocol !== undefined) {
      sale.fiscalProtocol = fiscalProtocol || '';
    }
    if (fiscalEnvironment !== undefined) {
      sale.fiscalEnvironment = fiscalEnvironment || '';
    }
    if (fiscalSerie !== undefined) {
      sale.fiscalSerie = fiscalSerie || '';
    }
    if (fiscalNumber !== undefined) {
      if (fiscalNumber === null) {
        sale.fiscalNumber = null;
      } else {
        const numeric = Number(fiscalNumber);
        sale.fiscalNumber = Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
      }
    }
    const resolvedPayments = Array.isArray(payments) ? payments : null;
    if (resolvedPayments) {
      sale.paymentTags = Array.from(
        new Set(
          resolvedPayments
            .map((payment) => {
              const label = payment?.label || 'Pagamento';
              const parcelas = payment?.parcelas && payment.parcelas > 1 ? ` (${payment.parcelas}x)` : '';
              return `${label}${parcelas}`;
            })
            .filter(Boolean)
        )
      );
    }
    if (Array.isArray(items)) {
      sale.items = items.map((item, index) => {
        const barcode = item?.codigoBarras || item?.codigo || item?.barcode || '—';
        const productName = item?.nome || item?.descricao || item?.produto || `Item ${index + 1}`;
        const quantityValue = safeNumber(item?.quantidade ?? item?.qtd ?? 0);
        const quantityLabel = quantityValue.toLocaleString('pt-BR', {
          minimumFractionDigits: Number.isInteger(quantityValue) ? 0 : 2,
          maximumFractionDigits: 3,
        });
        const unitValue = safeNumber(item?.valor ?? item?.valorUnitario ?? item?.preco ?? 0);
        const subtotalValue = safeNumber(item?.subtotal ?? item?.total ?? unitValue * quantityValue);
        return {
          id: item?.id || `${Date.now()}-${index}`,
          barcode: barcode || '—',
          product: productName,
          quantityLabel,
          unitLabel: formatCurrency(unitValue),
          totalLabel: formatCurrency(subtotalValue),
        };
      });
    }
    if (Array.isArray(fiscalItemsSnapshot)) {
      sale.fiscalItemsSnapshot = fiscalItemsSnapshot.map((entry) =>
        entry && typeof entry === 'object' ? { ...entry } : entry
      );
    }
    const discountSource =
      discount !== undefined
        ? discount
        : snapshot?.totais?.descontoValor ?? snapshot?.totais?.desconto ?? sale.discountValue;
    const additionSource =
      addition !== undefined
        ? addition
        : snapshot?.totais?.acrescimoValor ?? snapshot?.totais?.acrescimo ?? sale.additionValue;
    sale.discountValue = Math.max(0, safeNumber(discountSource));
    sale.discountLabel = formatCurrency(sale.discountValue);
    sale.additionValue = Math.max(0, safeNumber(additionSource));
    if (customer || snapshot?.cliente) {
      const customerSource = customer || {};
      const snapshotCustomer = snapshot?.cliente || {};
      sale.customerName =
        snapshotCustomer?.nome ||
        snapshotCustomer?.razaoSocial ||
        customerSource?.nome ||
        customerSource?.razaoSocial ||
        customerSource?.fantasia ||
        sale.customerName;
      sale.customerDocument =
        snapshotCustomer?.documento ||
        snapshotCustomer?.cpf ||
        snapshotCustomer?.cnpj ||
        customerSource?.cpf ||
        customerSource?.cnpj ||
        customerSource?.documento ||
        sale.customerDocument;
    }
    if (status) {
      sale.status = status;
    }
    if (cancellationReason !== undefined) {
      sale.cancellationReason = cancellationReason;
    }
    if (cancellationAt !== undefined) {
      sale.cancellationAt = cancellationAt;
      sale.cancellationAtLabel = cancellationAt ? toDateLabel(cancellationAt) : '';
    }
    renderSalesList();
    scheduleStatePersist();
    return sale;
  };

  const findCompletedSaleById = (saleId) =>
    state.completedSales.find((sale) => sale.id === saleId);

  const handleSaleCardToggle = (saleId) => {
    const sale = findCompletedSaleById(saleId);
    if (!sale) return;
    sale.expanded = !sale.expanded;
    renderSalesList();
  };

  const handleSalePrint = (saleId) => {
    const sale = findCompletedSaleById(saleId);
    if (!sale) return;
    if (sale.status === 'cancelled') {
      notify('Esta venda foi cancelada e não pode ser impressa.', 'info');
      return;
    }
    if (!sale.receiptSnapshot) {
      notify('Não foi possível localizar o comprovante desta venda para impressão.', 'warning');
      return;
    }
    if (sale.fiscalStatus === 'emitted') {
      printReceipt('venda', 'fiscal', {
        snapshot: sale.receiptSnapshot,
        xmlContent: sale.fiscalXmlContent,
        qrCodeDataUrl: sale.fiscalQrCodeImage,
        qrCodePayload: sale.fiscalQrCodeData,
      });
      return;
    }
    handleConfiguredPrint('venda', {
      snapshot: sale.receiptSnapshot,
      xmlContent: sale.fiscalXmlContent,
      qrCodeDataUrl: sale.fiscalQrCodeImage,
      qrCodePayload: sale.fiscalQrCodeData,
    });
  };

  const handleSaleEmitFiscal = (saleId) => emitFiscalForSale(saleId);

  const isModalActive = (modal) => Boolean(modal && !modal.classList.contains('hidden'));

  const clearSaleCancelError = () => {
    if (elements.saleCancelReason) {
      elements.saleCancelReason.classList.remove('border-rose-400', 'focus:border-rose-400', 'focus:ring-rose-200');
    }
    if (elements.saleCancelError) {
      elements.saleCancelError.classList.add('hidden');
      elements.saleCancelError.textContent = 'Informe o motivo para cancelar a venda.';
    }
  };

  const showSaleCancelError = (message) => {
    if (elements.saleCancelError) {
      elements.saleCancelError.textContent = message;
      elements.saleCancelError.classList.remove('hidden');
    }
    if (elements.saleCancelReason) {
      elements.saleCancelReason.classList.add('border-rose-400', 'focus:border-rose-400', 'focus:ring-rose-200');
    }
  };

  const openSaleCancelModal = (saleId) => {
    const sale = findCompletedSaleById(saleId);
    if (!sale || sale.status === 'cancelled' || !elements.saleCancelModal) return;
    state.activeSaleCancellationId = saleId;
    if (elements.saleCancelReason) {
      elements.saleCancelReason.value = '';
    }
    clearSaleCancelError();
    elements.saleCancelModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    window.setTimeout(() => {
      elements.saleCancelReason?.focus();
    }, 50);
  };

  const closeSaleCancelModal = () => {
    if (elements.saleCancelModal) {
      elements.saleCancelModal.classList.add('hidden');
    }
    state.activeSaleCancellationId = '';
    if (elements.saleCancelReason) {
      elements.saleCancelReason.value = '';
    }
    clearSaleCancelError();
    if (
      !isModalActive(elements.finalizeModal) &&
      !isModalActive(elements.paymentValueModal) &&
      !isModalActive(elements.deliveryAddressModal) &&
      !isModalActive(elements.customerModal)
    ) {
      document.body.classList.remove('overflow-hidden');
    }
  };

  const handleSaleCancelConfirm = () => {
    const saleId = state.activeSaleCancellationId;
    const reason = elements.saleCancelReason?.value?.trim() || '';
    if (!saleId) {
      closeSaleCancelModal();
      return;
    }
    if (!reason) {
      showSaleCancelError('Informe o motivo para cancelar a venda.');
      elements.saleCancelReason?.focus();
      return;
    }
    const sale = findCompletedSaleById(saleId);
    if (!sale) {
      closeSaleCancelModal();
      return;
    }
    sale.status = 'cancelled';
    sale.cancellationReason = reason;
    sale.cancellationAt = new Date().toISOString();
    sale.cancellationAtLabel = toDateLabel(sale.cancellationAt);
    renderSalesList();
    closeSaleCancelModal();
    notify('Venda cancelada com sucesso.', 'success');
    scheduleStatePersist({ immediate: true });
  };

  const handleSaleCancelModalKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSaleCancelModal();
    }
  };

  const handleSalesListClick = (event) => {
    const toggleButton = event.target.closest('[data-sale-toggle]');
    if (toggleButton) {
      const saleId = toggleButton.getAttribute('data-sale-id');
      if (saleId) {
        handleSaleCardToggle(saleId);
      }
      return;
    }
    const cancelButton = event.target.closest('[data-sale-cancel]');
    if (cancelButton) {
      const saleId = cancelButton.getAttribute('data-sale-id');
      if (saleId) {
        openSaleCancelModal(saleId);
      }
      return;
    }
    const printButton = event.target.closest('[data-sale-print]');
    if (printButton) {
      const saleId = printButton.getAttribute('data-sale-id');
      if (saleId) {
        handleSalePrint(saleId);
      }
      return;
    }
    const fiscalButton = event.target.closest('[data-sale-fiscal]');
    if (fiscalButton) {
      const saleId = fiscalButton.getAttribute('data-sale-id');
      if (saleId) {
        handleSaleEmitFiscal(saleId);
      }
    }
  };

  const renderHistory = () => {
    if (!elements.historyList || !elements.historyEmpty) return;
    elements.historyList.querySelectorAll('li[data-history-entry]').forEach((node) => node.remove());
    if (!state.history.length) {
      elements.historyEmpty.classList.remove('hidden');
      return;
    }
    elements.historyEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.history.forEach((entry) => {
      const li = document.createElement('li');
      li.dataset.historyEntry = 'true';
      li.className = 'rounded-lg border border-gray-200 bg-white px-4 py-3';
      const amountLabel =
        entry.delta < 0 ? `- ${formatCurrency(Math.abs(entry.delta))}` : formatCurrency(entry.delta);
      const motivoLine = entry.motivo ? `<p class="text-xs text-gray-500 mt-2">Motivo: ${entry.motivo}</p>` : '';
      const paymentLine = entry.paymentLabel
        ? `<p class="text-xs text-gray-500">Meio: ${entry.paymentLabel}</p>`
        : '';
      li.innerHTML = `
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm font-semibold text-gray-700">${entry.label}</p>
          <span class="text-sm font-semibold text-gray-800">${amountLabel}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1">${toDateLabel(entry.timestamp)}</p>
        ${paymentLine}
        ${motivoLine}
      `;
      fragment.appendChild(li);
    });
    elements.historyList.appendChild(fragment);
  };
  const renderCaixaActions = () => {
    if (!elements.caixaActions) return;
    const available = caixaActions.filter((action) => action.isAvailable(state));
    elements.caixaActions.innerHTML = '';
    if (!available.length) {
      elements.caixaActions.innerHTML =
        '<p class="text-xs text-gray-500">Nenhuma ação disponível para o caixa neste momento.</p>';
      return;
    }
    const fragment = document.createDocumentFragment();
    available.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action.id;
      const isActive = state.selectedAction === action.id;
      button.className = [
        'flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold transition',
        isActive ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-700 hover:border-primary/60',
      ].join(' ');
      button.innerHTML = `
        <span class="flex items-center gap-3">
          <span class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <i class="fas ${action.icon}"></i>
          </span>
          ${action.label}
        </span>
        <i class="fas fa-chevron-right text-xs text-gray-400"></i>
      `;
      fragment.appendChild(button);
    });
    elements.caixaActions.appendChild(fragment);
  };

  const updateActionDetails = () => {
    if (!elements.actionDetails) return;
    const action = caixaActions.find((item) => item.id === state.selectedAction);
    const visible = Boolean(action);
    elements.actionDetails.classList.toggle('hidden', !visible);
    if (!action) {
      return;
    }
    if (elements.actionHint) {
      elements.actionHint.textContent = action.hint;
    }
    if (elements.actionValuesWrapper) {
      elements.actionValuesWrapper.classList.toggle('hidden', !action.requiresAmount);
    }
    if (elements.actionAmount) {
      elements.actionAmount.value = '';
      elements.actionAmount.disabled = !action.requiresAmount;
    }
    if (elements.paymentSelect) {
      const shouldDisable =
        !action.affectsPayments || state.paymentMethodsLoading || !state.pagamentos.length;
      elements.paymentSelect.disabled = shouldDisable;
      if (!action.affectsPayments && state.pagamentos.length) {
        elements.paymentSelect.value = state.pagamentos[0].id;
      }
      if (shouldDisable && action.affectsPayments && elements.actionHint) {
        elements.actionHint.textContent = state.paymentMethodsLoading
          ? 'Aguarde o carregamento dos meios de pagamento.'
          : 'Cadastre ou habilite meios de pagamento para registrar esta operação.';
      }
    }
    if (elements.motivoWrapper && elements.motivoInput) {
      elements.motivoWrapper.classList.toggle('hidden', !action.requiresMotivo);
      elements.motivoInput.value = '';
    }
    if (elements.actionConfirm) {
      const labels = {
        abertura: 'Abrir caixa',
        entrada: 'Registrar entrada',
        saida: 'Registrar saída',
        envio: 'Registrar envio',
        fechamento: 'Fechar caixa',
      };
      const labelSpan = elements.actionConfirm.querySelector('span');
      if (labelSpan) {
        labelSpan.textContent = labels[action.id] || 'Registrar';
      }
    }
  };

  const addHistoryEntry = (action, amount, motivo, paymentLabel, deltaOverride) => {
    const delta = typeof deltaOverride === 'number'
      ? deltaOverride
      : action.id === 'saida' || action.id === 'envio' || action.id === 'fechamento'
      ? -Math.abs(amount)
      : Math.abs(amount);
    const entry = {
      id: action.id,
      label: action.label,
      amount: Math.abs(amount),
      delta,
      motivo: motivo || '',
      paymentLabel: paymentLabel || '',
      timestamp: new Date().toISOString(),
    };
    state.history.unshift(entry);
    renderHistory();
    setLastMovement(entry);
    scheduleStatePersist();
  };

  const resetPagamentos = () => {
    state.pagamentos = state.pagamentos.map((payment) => ({ ...payment, valor: 0 }));
    state.summary.abertura = 0;
    state.allowApuradoEdit = false;
    state.caixaInfo.previstoPagamentos = [];
    state.caixaInfo.apuradoPagamentos = [];
    state.caixaInfo.fechamentoPrevisto = 0;
    state.caixaInfo.fechamentoApurado = 0;
    updateSummary();
    renderPayments();
  };

  const resetWorkspace = () => {
    state.caixaAberto = false;
    state.allowApuradoEdit = false;
    state.selectedAction = null;
    state.searchResults = [];
    state.selectedProduct = null;
    state.quantidade = 1;
    state.itens = [];
    state.vendaCliente = null;
    state.vendaPet = null;
    state.summary = { abertura: 0, recebido: 0, saldo: 0 };
    state.caixaInfo = {
      aberturaData: null,
      fechamentoData: null,
      fechamentoPrevisto: 0,
      fechamentoApurado: 0,
      previstoPagamentos: [],
      apuradoPagamentos: [],
    };
    state.history = [];
    state.lastMovement = null;
    state.pendingPagamentosData = null;
    state.pagamentos = state.paymentMethods.map((method) => ({ ...method, valor: 0 }));
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    state.saleCodeIdentifier = '';
    state.saleCodeSequence = 1;
    state.currentSaleCode = '';
    state.customerSearchResults = [];
    state.customerSearchLoading = false;
    state.customerSearchQuery = '';
    state.customerPets = [];
    state.customerPetsLoading = false;
    state.modalSelectedCliente = null;
    state.modalSelectedPet = null;
    state.modalActiveTab = 'cliente';
    state.printPreferences = { fechamento: 'PM', venda: 'PM' };
    state.deliveryOrders = [];
    state.completedSales = [];
    state.activeSaleCancellationId = '';
    state.deliveryAddresses = [];
    state.deliveryAddressesLoading = false;
    state.deliveryAddressSaving = false;
    state.deliveryAddressFormVisible = false;
    state.deliverySelectedAddressId = '';
    state.deliverySelectedAddress = null;
    state.activeFinalizeContext = null;
    customerAddressesCache.clear();
    updatePrintControls();
    if (customerSearchTimeout) {
      clearTimeout(customerSearchTimeout);
      customerSearchTimeout = null;
    }
    if (customerSearchController) {
      customerSearchController.abort();
      customerSearchController = null;
    }
    if (customerPetsController) {
      customerPetsController.abort();
      customerPetsController = null;
    }
    if (elements.customerSearchInput) {
      elements.customerSearchInput.value = '';
    }
    if (elements.customerResultsList) {
      elements.customerResultsList.innerHTML = '';
    }
    if (elements.customerResultsLoading) {
      elements.customerResultsLoading.classList.add('hidden');
    }
    if (elements.customerResultsEmpty) {
      elements.customerResultsEmpty.textContent = 'Digite para buscar clientes.';
      elements.customerResultsEmpty.classList.remove('hidden');
    }
    if (elements.customerPetsList) {
      elements.customerPetsList.innerHTML = '';
    }
    if (elements.customerPetsLoading) {
      elements.customerPetsLoading.classList.add('hidden');
    }
    if (elements.customerPetsEmpty) {
      elements.customerPetsEmpty.textContent = 'Nenhum pet disponível.';
    }
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }
    if (elements.searchResults) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
    }
    clearSelectedProduct();
    updateSaleCustomerSummary();
    renderItemsList();
    renderPayments();
    renderSalePaymentMethods();
    renderSalePaymentsPreview();
    setDeliveryAddressFormVisible(false);
    resetDeliveryAddressForm();
    updateDeliveryAddressConfirmState();
    renderDeliveryAddresses();
    renderDeliveryOrders();
    renderSalesList();
    if (elements.deliveryAddressModal) {
      elements.deliveryAddressModal.classList.add('hidden');
    }
    renderHistory();
    setLastMovement(null);
    populatePaymentSelect();
    renderCaixaActions();
    updateActionDetails();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    updateFinalizeButton();
    updateCustomerModalTabs();
    updateCustomerModalActions();
    renderCustomerSearchResults();
    renderCustomerPets();
    setActiveTab('caixa-tab');
    updateSaleCodeDisplay();
    lastPersistSignature = '';
  };

  const updateSelectionHint = (message) => {
    if (elements.selectionHint && message) {
      elements.selectionHint.textContent = message;
    }
  };

  const populateCompanySelect = () => {
    if (!elements.companySelect) return;
    const previous = elements.companySelect.value;
    const options = ['<option value="">Selecione uma empresa</option>'];
    state.stores.forEach((store) => {
      const storeId = normalizeId(store?._id);
      options.push(
        `<option value="${storeId}">${store?.nome || store?.nomeFantasia || 'Empresa sem nome'}</option>`
      );
    });
    elements.companySelect.innerHTML = options.join('');
    const selectedValue = normalizeId(state.selectedStore || previous);
    if (selectedValue && findStoreById(selectedValue)) {
      elements.companySelect.value = selectedValue;
    } else if (state.selectedStore && !findStoreById(state.selectedStore)) {
      state.selectedStore = '';
    }
    elements.companySelect.disabled = state.stores.length === 0;
  };

  const extractStoresPayload = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.stores)) return payload.stores;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.stores)) return payload.data.stores;
    if (Array.isArray(payload?.docs)) return payload.docs;
    if (Array.isArray(payload?.results)) return payload.results;
    return [];
  };

  const populatePdvSelect = () => {
    if (!elements.pdvSelect) return;
    const options = ['<option value="">Selecione um PDV</option>'];
    state.pdvs.forEach((pdv) => {
      const pdvId = normalizeId(pdv?._id);
      options.push(
        `<option value="${pdvId}">${pdv?.nome || pdv?.codigo || pdvId}</option>`
      );
    });
    elements.pdvSelect.innerHTML = options.join('');
    const selectedValue = normalizeId(state.selectedPdv);
    if (selectedValue && findPdvById(selectedValue)) {
      elements.pdvSelect.value = selectedValue;
    }
    elements.pdvSelect.disabled = state.pdvs.length === 0;
  };

  const fetchStores = async () => {
    const token = getToken();
    let payload;
    try {
      payload = await fetchWithOptionalAuth(`${API_BASE}/stores`, {
        token,
        errorMessage: 'Não foi possível carregar as empresas cadastradas.',
      });
    } catch (error) {
      console.error('Erro ao carregar empresas para o PDV:', error);
      throw error;
    }
    state.stores = extractStoresPayload(payload).map((store) => normalizeStoreRecord(store));
    populateCompanySelect();
  };

  const fetchPaymentMethods = async (storeId) => {
    state.paymentMethods = [];
    state.pagamentos = [];
    state.paymentMethodsLoading = true;
    renderPayments();
    renderSalePaymentMethods();
    populatePaymentSelect();
    if (!storeId) {
      state.paymentMethodsLoading = false;
      updatePaymentMethods([]);
      return;
    }
    try {
      const token = getToken();
      const payload = await fetchWithOptionalAuth(
        `${API_BASE}/payment-methods?company=${encodeURIComponent(storeId)}`,
        {
          token,
          errorMessage: 'Não foi possível carregar os meios de pagamento cadastrados.',
        }
      );
      const methods = Array.isArray(payload?.paymentMethods)
        ? payload.paymentMethods
        : Array.isArray(payload)
        ? payload
        : [];
      state.paymentMethodsLoading = false;
      updatePaymentMethods(methods);
    } catch (error) {
      state.paymentMethodsLoading = false;
      updatePaymentMethods([]);
      console.error('Erro ao carregar meios de pagamento para o PDV:', error);
      notify(error.message || 'Não foi possível carregar os meios de pagamento.', 'error');
    }
  };

  const fetchPdvs = async (storeId) => {
    const query = storeId ? `?empresa=${encodeURIComponent(storeId)}` : '';
    const token = getToken();
    const payload = await fetchWithOptionalAuth(`${API_BASE}/pdvs${query}`, {
      token,
      errorMessage: 'Não foi possível carregar os PDVs da empresa.',
    });
    state.pdvs = Array.isArray(payload?.pdvs)
      ? payload.pdvs
      : Array.isArray(payload)
      ? payload
      : [];
    state.pdvs = state.pdvs.map((pdv) => normalizePdvRecord(pdv));
    populatePdvSelect();
  };

  const fetchPdvDetails = async (pdvId) => {
    const token = getToken();
    const payload = await fetchWithOptionalAuth(`${API_BASE}/pdvs/${pdvId}`, {
      token,
      errorMessage: 'Não foi possível carregar os dados do PDV selecionado.',
    });
    return normalizePdvRecord(payload);
  };
  const applyPdvData = (pdv) => {
    const companyId = getPdvCompanyId(pdv);
    if (companyId && companyId !== state.selectedStore) {
      state.selectedStore = companyId;
      if (elements.companySelect) {
        elements.companySelect.value = companyId;
      }
      populateCompanySelect();
    }
    const caixaAberto = Boolean(
      pdv?.caixa?.aberto ||
        pdv?.caixaAberto ||
        pdv?.statusCaixa === 'aberto' ||
        pdv?.status === 'aberto'
    );
    state.caixaAberto = caixaAberto;
    const summarySource = pdv?.summary || pdv?.caixa?.resumo || {};
    state.summary.abertura = safeNumber(
      summarySource.abertura ||
        summarySource.valorAbertura ||
        pdv?.caixa?.abertura ||
        pdv?.caixa?.valorAbertura ||
        pdv?.valorAbertura ||
        0
    );
    state.summary.recebido = safeNumber(summarySource.recebido ?? state.summary.recebido ?? 0);
    state.summary.saldo = safeNumber(summarySource.saldo ?? state.summary.saldo ?? 0);
    const aberturaData =
      pdv?.caixa?.dataAbertura ||
      pdv?.caixa?.aberturaData ||
      pdv?.caixa?.abertura ||
      pdv?.caixa?.abertoEm ||
      pdv?.caixa?.inicio ||
      pdv?.caixa?.openedAt ||
      pdv?.dataAbertura ||
      pdv?.abertura;
    const fechamentoData =
      pdv?.caixa?.dataFechamento ||
      pdv?.caixa?.fechamentoData ||
      pdv?.caixa?.fechamento ||
      pdv?.caixa?.fechadoEm ||
      pdv?.caixa?.fim ||
      pdv?.caixa?.closedAt ||
      pdv?.dataFechamento ||
      pdv?.fechamento;
    const previstoPagamentosData = Array.isArray(pdv?.caixa?.previstoPagamentos)
      ? pdv.caixa.previstoPagamentos
      : Array.isArray(pdv?.caixa?.pagamentosPrevistos)
      ? pdv.caixa.pagamentosPrevistos
      : Array.isArray(pdv?.previstoPagamentos)
      ? pdv.previstoPagamentos
      : [];
    const apuradoPagamentosData = Array.isArray(pdv?.caixa?.apuradoPagamentos)
      ? pdv.caixa.apuradoPagamentos
      : Array.isArray(pdv?.caixa?.pagamentosApurados)
      ? pdv.caixa.pagamentosApurados
      : Array.isArray(pdv?.apuradoPagamentos)
      ? pdv.apuradoPagamentos
      : [];
    state.caixaInfo = {
      aberturaData: parseDateValue(aberturaData),
      fechamentoData: parseDateValue(fechamentoData),
      fechamentoPrevisto: safeNumber(
        pdv?.caixa?.fechamentoPrevisto ||
          pdv?.caixa?.valorPrevisto ||
          pdv?.caixa?.saldoPrevisto ||
          pdv?.fechamentoPrevisto ||
          summarySource.fechamentoPrevisto ||
          0
      ),
      fechamentoApurado: safeNumber(
        pdv?.caixa?.fechamentoApurado ||
          pdv?.caixa?.valorApurado ||
          pdv?.fechamentoApurado ||
          summarySource.fechamentoApurado ||
          0
      ),
      previstoPagamentos: previstoPagamentosData
        .map((payment) => normalizePaymentSnapshotForPersist(payment))
        .filter(Boolean),
      apuradoPagamentos: apuradoPagamentosData
        .map((payment) => normalizePaymentSnapshotForPersist(payment))
        .filter(Boolean),
    };
    const impressaoConfig = pdv?.configuracoesImpressao || {};
    const fechamentoMode = normalizePrintMode(
      impressaoConfig.fechamento ||
        impressaoConfig.modoFechamento ||
        impressaoConfig.imprimirFechamento ||
        impressaoConfig.comprovanteFechamento ||
        impressaoConfig.fechamentoAutomatico ||
        impressaoConfig.impressaoFechamento
    );
    const vendaMode = normalizePrintMode(
      impressaoConfig.venda ||
        impressaoConfig.modoVenda ||
        impressaoConfig.imprimirVenda ||
        impressaoConfig.comprovanteVenda ||
        impressaoConfig.vendaAutomatica ||
        impressaoConfig.sempreImprimir ||
        impressaoConfig.impressaoVenda
    );
    const storedPreferences =
      pdv?.printPreferences && typeof pdv.printPreferences === 'object' ? pdv.printPreferences : null;
    state.printPreferences = {
      fechamento: normalizePrintMode(storedPreferences?.fechamento, fechamentoMode),
      venda: normalizePrintMode(storedPreferences?.venda, vendaMode),
    };
    updatePrintControls();
    const pagamentosData = pdv?.caixa?.pagamentos || pdv?.pagamentos || {};
    applyPagamentosData(pagamentosData);
    if (state.summary.abertura > 0 && !state.pagamentos.some((payment) => payment.valor > 0)) {
      state.pagamentos = state.pagamentos.map((payment, index) =>
        index === 0 ? { ...payment, valor: state.summary.abertura } : payment
      );
    }
    const historicoFonte = Array.isArray(pdv?.history)
      ? pdv.history
      : Array.isArray(pdv?.caixa?.historico)
      ? pdv.caixa.historico
      : [];
    state.history = historicoFonte
      .map((entry) => normalizeHistoryEntryForPersist(entry))
      .filter(Boolean);
    const vendasFonte = Array.isArray(pdv?.completedSales)
      ? pdv.completedSales
      : Array.isArray(pdv?.caixa?.vendas)
      ? pdv.caixa.vendas
      : [];
    state.completedSales = vendasFonte
      .map((sale) => normalizeSaleRecordForPersist(sale))
      .filter(Boolean)
      .map((sale) => ({
        ...sale,
        paymentTags: Array.isArray(sale.paymentTags) ? sale.paymentTags : [],
        items: Array.isArray(sale.items) ? sale.items : [],
      }));
    renderPayments();
    renderHistory();
    setLastMovement(state.history[0] || null);
    renderItemsList();
    renderSalesList();
    clearSelectedProduct();
    updateWorkspaceInfo();
    renderCaixaActions();
    updateActionDetails();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    initializeSaleCodeForPdv(pdv);
    setActiveTab(state.caixaAberto ? 'pdv-tab' : 'caixa-tab');
    lastPersistSignature = JSON.stringify(buildStatePersistPayload());
  };

  const renderSearchResults = (results, term) => {
    if (!elements.searchResults) return;
    if (!results.length) {
      elements.searchResults.innerHTML = `<div class="p-4 text-sm text-gray-500">Nenhum produto encontrado para "${term}".</div>`;
      return;
    }
    const toReais = (value) => formatCurrency(value).replace('R$', '').trim();
    const html = results
      .map((product, index) => {
        const finalPrice = getFinalPrice(product);
        const basePrice = getBasePrice(product);
        const generalPromo = hasGeneralPromotion(product);
        const showGeneralWarning = generalPromo && !canApplyGeneralPromotion();
        const badge = finalPrice < basePrice
          ? '<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Promo</span>'
          : '';
        const generalBadge = showGeneralWarning
          ? '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Cliente necessário</span>'
          : '';
        const badges = [badge, generalBadge].filter(Boolean).join('');
        const priceLine = finalPrice < basePrice
          ? `<span class="text-sm font-semibold text-primary">R$ ${toReais(finalPrice)}</span><span class="text-xs text-gray-400 line-through">R$ ${toReais(basePrice)}</span>`
          : `<span class="text-sm font-semibold text-gray-800">R$ ${toReais(finalPrice)}</span>`;
        const image = getImageUrl(product);
        const extraNotice = showGeneralWarning
          ? '<span class="block text-[11px] text-amber-600 mt-1">Vincule um cliente para aplicar a promoção geral.</span>'
          : '';
        return `
          <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary/5" data-result-index="${index}">
            <span class="h-14 w-14 flex items-center justify-center rounded border border-gray-200 bg-white overflow-hidden">
              ${image ? `<img src="${image}" alt="${product.nome}" class="h-full w-full object-contain">` : '<i class="fas fa-image text-gray-300"></i>'}
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-semibold text-gray-800 truncate">${product.nome || 'Produto sem nome'}</span>
              <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                ${priceLine}
                ${badges}
              </span>
              ${extraNotice}
              <span class="block text-[11px] text-gray-400 mt-1">Cód: ${getProductCode(product) || '—'} • Barras: ${getProductBarcode(product) || '—'}</span>
            </span>
          </button>
        `;
      })
      .join('');
    elements.searchResults.innerHTML = html;
  };

  const performSearch = async (term) => {
    if (!elements.searchResults) return;
    const normalized = term.trim();
    if (!normalized) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
      return;
    }
    const minLength = /^\d+$/.test(normalized) ? 1 : 2;
    if (normalized.length < minLength) {
      elements.searchResults.classList.add('hidden');
      elements.searchResults.innerHTML = '';
      return;
    }
    if (state.searchController) {
      state.searchController.abort();
    }
    state.searchController = new AbortController();
    elements.searchResults.classList.remove('hidden');
    elements.searchResults.innerHTML = '<div class="p-4 text-sm text-gray-500">Buscando produtos...</div>';
    try {
      const response = await fetch(
        `${API_BASE}/products?search=${encodeURIComponent(normalized)}&limit=8`,
        { signal: state.searchController.signal }
      );
      if (!response.ok) {
        throw new Error('Não foi possível buscar produtos.');
      }
      const payload = await response.json();
      const products = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload) ? payload : [];
      state.searchResults = products;
      renderSearchResults(products, normalized);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao pesquisar produtos no PDV:', error);
      elements.searchResults.innerHTML = '<div class="p-4 text-sm text-red-500">Falha ao carregar produtos. Tente novamente.</div>';
    }
  };

  const findProductByLookupValue = (products, lookupValue) => {
    const normalized = normalizeBarcodeValue(lookupValue);
    if (!normalized) return null;
    const barcodeMatch = products.find(
      (product) => normalizeBarcodeValue(getProductBarcode(product)) === normalized
    );
    if (barcodeMatch) return barcodeMatch;
    return (
      products.find((product) => {
        const identifiers = [
          product?.codigoInterno,
          product?.codInterno,
          product?.codigo,
          product?.codigoReferencia,
          product?.sku,
        ];
        return identifiers.some((value) => normalizeBarcodeValue(value) === normalized);
      }) || null
    );
  };

  const fetchProductByBarcode = async (barcode) => {
    const normalized = normalizeBarcodeValue(barcode);
    if (!normalized) return null;
    try {
      const response = await fetch(
        `${API_BASE}/products?search=${encodeURIComponent(normalized)}&limit=6`
      );
      if (!response.ok) {
        throw new Error('Não foi possível buscar o produto pelo código informado.');
      }
      const payload = await response.json();
      const products = Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload)
        ? payload
        : [];
      if (!products.length) return null;
      return findProductByLookupValue(products, normalized) || products[0] || null;
    } catch (error) {
      console.error('Erro ao buscar produto por código de barras no PDV:', error);
      throw error;
    }
  };

  const selectProduct = (index) => {
    const product = state.searchResults[index];
    if (!product) return;
    state.selectedProduct = product;
    state.quantidade = 1;
    updateSelectedProductView();
    if (elements.searchInput) {
      elements.searchInput.value = product?.nome || getProductCode(product) || '';
      elements.searchInput.focus();
    }
    if (elements.searchResults) {
      elements.searchResults.classList.add('hidden');
    }
  };

  const appendProductToSale = (product, quantidade = 1) => {
    if (!product) return false;
    const quantidadeFinal = Math.max(1, Math.trunc(Number(quantidade) || 1));
    const unitPrice = getFinalPrice(product);
    const subtotal = unitPrice * quantidadeFinal;
    const codigo = getProductCode(product);
    const codigoInterno = product?.codigoInterno || product?.codInterno || codigo;
    const codigoBarras = getProductBarcode(product);
    const nome = product?.nome || 'Produto sem nome';
    const generalPromo = hasGeneralPromotion(product);
    const snapshot = buildProductSnapshot(product);
    const existingIndex = state.itens.findIndex(
      (item) =>
        item.id === product._id ||
        item.codigo === codigo ||
        (!!codigoInterno && item.codigoInterno === codigoInterno)
    );
    if (existingIndex >= 0) {
      const current = state.itens[existingIndex];
      current.quantidade += quantidadeFinal;
      current.valor = unitPrice;
      current.subtotal = current.quantidade * current.valor;
      current.codigoInterno = codigoInterno || current.codigoInterno;
      current.codigoBarras = codigoBarras || current.codigoBarras;
      current.generalPromo = generalPromo;
      current.productSnapshot = snapshot;
    } else {
      state.itens.push({
        id: product._id || product.id || codigo || String(Date.now()),
        codigo,
        codigoInterno,
        codigoBarras,
        nome,
        quantidade: quantidadeFinal,
        valor: unitPrice,
        subtotal,
        generalPromo,
        productSnapshot: snapshot,
      });
    }
    renderItemsList();
    notify('Item adicionado à pré-visualização.', 'success');
    clearSaleSearchAreas();
    return true;
  };

  const addItemToList = () => {
    if (!state.selectedProduct) {
      notify('Selecione um produto para adicionar à venda.', 'warning');
      return;
    }
    const quantidade = Math.max(
      1,
      Math.trunc(Number(elements.itemQuantity?.value || state.quantidade || 1))
    );
    state.quantidade = quantidade;
    const product = state.selectedProduct;
    appendProductToSale(product, quantidade);
  };

  const handleSearchKeydown = async (event) => {
    if (event.key !== 'Enter') return;
    const input = event.currentTarget;
    if (!input) return;
    const rawValue = typeof input.value === 'string' ? input.value : '';
    const term = rawValue.trim();
    if (!term) return;

    event.preventDefault();

    const normalized = normalizeBarcodeValue(term);
    const lowerTerm = term.toLowerCase();

    const matchesProduct = (product) => {
      if (!product) return false;
      const code = normalizeBarcodeValue(getProductCode(product));
      const barcode = normalizeBarcodeValue(getProductBarcode(product));
      const name = (product.nome || product.descricao || '').toLowerCase();
      return (
        (!!code && code === normalized) ||
        (!!barcode && barcode === normalized) ||
        (!!name && name === lowerTerm)
      );
    };

    const clearSearchOverlay = () => {
      if (elements.searchResults) {
        elements.searchResults.classList.add('hidden');
        elements.searchResults.innerHTML = '';
      }
      if (state.searchController) {
        state.searchController.abort();
        state.searchController = null;
      }
      state.searchResults = [];
    };

    const applySelectionAndAppend = (product) => {
      state.selectedProduct = product;
      state.quantidade = 1;
      if (elements.itemQuantity) {
        elements.itemQuantity.value = 1;
      }
      updateSelectedProductView();
      appendProductToSale(product, 1);
      clearSearchOverlay();
      if (elements.searchInput) {
        elements.searchInput.value = '';
        elements.searchInput.focus();
      }
    };

    if (matchesProduct(state.selectedProduct)) {
      applySelectionAndAppend(state.selectedProduct);
      return;
    }

    if (state.searchResults.length) {
      const fromResults =
        findProductByLookupValue(state.searchResults, term) ||
        state.searchResults.find((item) => (item?.nome || '').toLowerCase() === lowerTerm) ||
        null;
      if (fromResults) {
        applySelectionAndAppend(fromResults);
        return;
      }
    }

    input.disabled = true;

    try {
      const product = await fetchProductByBarcode(term);
      if (!product) {
        notify('Nenhum produto encontrado para o código informado.', 'warning');
        return;
      }
      applySelectionAndAppend(product);
    } catch (error) {
      console.error('Falha ao adicionar produto pela busca no PDV:', error);
      notify('Falha ao buscar o produto informado.', 'error');
    } finally {
      input.disabled = false;
      if (elements.searchInput) {
        elements.searchInput.focus();
      }
    }
  };

  const updatePaymentRow = (paymentId) => {
    if (!elements.paymentList) return;
    const display = elements.paymentList.querySelector(`[data-payment-display="${paymentId}"]`);
    if (display) {
      const payment = state.pagamentos.find((item) => item.id === paymentId);
      display.textContent = formatCurrency(payment?.valor || 0);
    }
  };

  const renderPayments = () => {
    if (!elements.paymentList) return;
    elements.paymentList.innerHTML = '';
    const inputsLocked = state.caixaAberto && !state.allowApuradoEdit;
    const helperText = state.allowApuradoEdit
      ? 'Informe o valor apurado'
      : state.caixaAberto
      ? 'Saldo previsto'
      : 'Valor inicial / apurado';
    if (state.paymentMethodsLoading) {
      elements.paymentList.innerHTML =
        '<li class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">Carregando meios de pagamento...</li>';
    } else if (!state.pagamentos.length) {
      const message = state.selectedStore
        ? 'Nenhum meio de pagamento cadastrado para esta empresa.'
        : 'Selecione uma empresa para visualizar os meios de pagamento disponíveis.';
      elements.paymentList.innerHTML = `<li class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">${message}</li>`;
    } else {
      const fragment = document.createDocumentFragment();
      state.pagamentos.forEach((payment) => {
        const li = document.createElement('li');
        li.className =
          'flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3';
        const inputClasses = [
          'w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right focus:border-primary focus:ring-2 focus:ring-primary/20',
          inputsLocked ? 'cursor-not-allowed bg-gray-100 text-gray-500' : '',
          state.allowApuradoEdit ? 'bg-white text-gray-800' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const disabledAttr = inputsLocked ? 'disabled' : '';
        li.innerHTML = `
          <div>
            <p class="text-sm font-semibold text-gray-700">${payment.label}</p>
            <p class="text-xs text-gray-500">${helperText}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">R$</span>
            <input type="number" min="0" step="0.01" value="${payment.valor.toFixed(2)}" data-payment-input="${payment.id}" class="${inputClasses}" aria-label="Atualizar ${payment.label}" ${disabledAttr}>
            <span class="text-sm font-semibold text-gray-800" data-payment-display="${payment.id}">${formatCurrency(payment.valor)}</span>
          </div>
        `;
        fragment.appendChild(li);
      });
      elements.paymentList.appendChild(fragment);
    }
    if (elements.resetPayments) {
      const disableReset =
        inputsLocked || state.paymentMethodsLoading || !state.pagamentos.length;
      elements.resetPayments.disabled = disableReset;
      elements.resetPayments.classList.toggle('opacity-50', disableReset);
      elements.resetPayments.classList.toggle('cursor-not-allowed', disableReset);
    }
    populatePaymentSelect();
    updateSummary();
  };

  const handlePaymentInput = (event) => {
    const input = event.target.closest('input[data-payment-input]');
    if (!input) return;
    const id = input.getAttribute('data-payment-input');
    const value = safeNumber(input.value);
    const payment = state.pagamentos.find((item) => item.id === id);
    if (!payment) return;
    if (state.caixaAberto && !state.allowApuradoEdit) {
      input.value = payment.valor.toFixed(2);
      return;
    }
    payment.valor = value < 0 ? 0 : value;
    input.value = payment.valor.toFixed(2);
    updatePaymentRow(id);
    updateSummary();
    scheduleStatePersist();
  };

  const handleResetPayments = () => {
    if (state.caixaAberto) {
      notify('Não é possível zerar os valores com o caixa aberto.', 'warning');
      return;
    }
    resetPagamentos();
    notify('Valores dos meios de pagamento zerados.', 'info');
    scheduleStatePersist();
  };

  const handleClearHistory = () => {
    state.history = [];
    setLastMovement(null);
    renderHistory();
    notify('Histórico de movimentações limpo.', 'info');
    scheduleStatePersist();
  };

  const handleSearchInput = (event) => {
    const term = event.target.value || '';
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    searchTimeout = setTimeout(() => performSearch(term), 250);
  };

  const handleSearchResultsClick = (event) => {
    const button = event.target.closest('[data-result-index]');
    if (!button) return;
    const index = Number(button.getAttribute('data-result-index'));
    if (!Number.isInteger(index)) return;
    selectProduct(index);
  };

  const handleDocumentClick = (event) => {
    if (!elements.searchResults || !elements.searchInput) return;
    if (
      elements.searchResults.contains(event.target) ||
      event.target === elements.searchInput
    ) {
      return;
    }
    elements.searchResults.classList.add('hidden');
  };

  const handleItemsListClick = (event) => {
    const button = event.target.closest('[data-remove-index]');
    if (!button) return;
    const index = Number(button.getAttribute('data-remove-index'));
    if (!Number.isInteger(index) || index < 0 || index >= state.itens.length) return;
    state.itens.splice(index, 1);
    renderItemsList();
    if (!state.itens.length) {
      state.vendaPagamentos = [];
      renderSalePaymentsPreview();
    } else {
      const total = getSaleTotalLiquido();
      const pago = getSalePagoTotal();
      if (pago > total) {
        state.vendaPagamentos = [];
        renderSalePaymentsPreview();
      } else {
        updateSaleSummary();
      }
    }
  };

  const changeQuantity = (delta) => {
    const newValue = Math.max(1, Math.trunc(Number(elements.itemQuantity?.value || state.quantidade || 1)) + delta);
    state.quantidade = newValue;
    if (elements.itemQuantity) {
      elements.itemQuantity.value = newValue;
    }
    updateItemTotals();
  };

  const handleQuantityInput = () => {
    const value = Math.max(1, Math.trunc(Number(elements.itemQuantity?.value || 1)));
    state.quantidade = value;
    if (elements.itemQuantity) {
      elements.itemQuantity.value = value;
    }
    updateItemTotals();
  };

  const handleActionClick = (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const actionId = button.getAttribute('data-action');
    if (state.allowApuradoEdit && actionId !== 'fechamento' && state.caixaAberto) {
      state.pagamentos = clonePayments(state.caixaInfo.previstoPagamentos || state.pagamentos);
      state.allowApuradoEdit = false;
    }
    state.selectedAction = actionId;
    if (actionId === 'fechamento' && state.caixaAberto) {
      state.caixaInfo.previstoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.fechamentoPrevisto = sumPayments(state.caixaInfo.previstoPagamentos);
      state.allowApuradoEdit = true;
    } else if (actionId !== 'fechamento') {
      state.allowApuradoEdit = false;
    }
    renderCaixaActions();
    renderPayments();
    updateActionDetails();
  };

  const handleActionConfirm = () => {
    const action = caixaActions.find((item) => item.id === state.selectedAction);
    if (!action) {
      notify('Selecione uma operação para o caixa.', 'warning');
      return;
    }
    const amountValue = safeNumber(elements.actionAmount?.value || 0);
    const paymentId = elements.paymentSelect?.value || (state.pagamentos[0]?.id ?? '');
    const payment = state.pagamentos.find((item) => item.id === paymentId) || state.pagamentos[0];
    const motivo = elements.motivoInput?.value.trim();

    if (action.requiresAmount && amountValue <= 0) {
      notify('Informe um valor válido para a operação.', 'warning');
      elements.actionAmount?.focus();
      return;
    }
    if (action.requiresMotivo && !motivo) {
      notify('Descreva o motivo da movimentação.', 'warning');
      elements.motivoInput?.focus();
      return;
    }

    if (action.id === 'abertura') {
      if (state.caixaAberto) {
        notify('O caixa já está aberto.', 'warning');
        return;
      }
      const aberturaTotal = sumPayments(state.pagamentos);
      state.caixaAberto = true;
      state.allowApuradoEdit = false;
      state.summary.abertura = aberturaTotal;
      state.caixaInfo.aberturaData = new Date().toISOString();
      state.caixaInfo.fechamentoData = null;
      state.caixaInfo.fechamentoApurado = 0;
      state.caixaInfo.previstoPagamentos = clonePayments(state.pagamentos);
      state.caixaInfo.apuradoPagamentos = [];
      state.caixaInfo.fechamentoPrevisto = aberturaTotal;
      addHistoryEntry(action, aberturaTotal, motivo, describePaymentValues(state.pagamentos));
      notify(action.successMessage, 'success');
      setActiveTab('pdv-tab');
    } else if (action.id === 'fechamento') {
      if (!state.caixaAberto) {
        notify('Abra o caixa antes de realizar o fechamento.', 'warning');
        return;
      }
      const previstoPagamentos =
        state.caixaInfo.previstoPagamentos?.length
          ? state.caixaInfo.previstoPagamentos
          : clonePayments(state.pagamentos);
      const apuradoPagamentos = clonePayments(state.pagamentos);
      const previstoTotal = sumPayments(previstoPagamentos);
      const apuradoTotal = sumPayments(apuradoPagamentos);
      addHistoryEntry(
        action,
        apuradoTotal,
        motivo,
        describePaymentValues(apuradoPagamentos),
        -Math.abs(apuradoTotal)
      );
      state.caixaInfo.fechamentoData = new Date().toISOString();
      state.caixaInfo.previstoPagamentos = clonePayments(previstoPagamentos);
      state.caixaInfo.apuradoPagamentos = clonePayments(apuradoPagamentos);
      state.caixaInfo.fechamentoPrevisto = previstoTotal;
      state.caixaInfo.fechamentoApurado = apuradoTotal;
      state.caixaAberto = false;
      state.allowApuradoEdit = false;
      notify(action.successMessage, 'success');
      updateTabAvailability();
      setActiveTab('caixa-tab');
      handleConfiguredPrint('fechamento');
    } else {
      if (!state.caixaAberto) {
        notify('Abra o caixa antes de registrar movimentações.', 'warning');
        return;
      }
      if (!payment) {
        notify(
          state.pagamentos.length
            ? 'Selecione um meio de pagamento válido.'
            : 'Cadastre meios de pagamento antes de registrar esta movimentação.',
          'warning'
        );
        return;
      }
      if (action.id === 'entrada') {
        payment.valor += amountValue;
        addHistoryEntry(action, amountValue, motivo, payment.label);
      } else {
        payment.valor = Math.max(0, payment.valor - amountValue);
        addHistoryEntry(action, amountValue, motivo, payment.label, -Math.abs(amountValue));
      }
      notify(action.successMessage, 'success');
    }

    renderPayments();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    state.selectedAction = null;
    state.allowApuradoEdit = false;
    renderCaixaActions();
    updateActionDetails();
    elements.actionAmount && (elements.actionAmount.value = '');
    elements.motivoInput && (elements.motivoInput.value = '');
    scheduleStatePersist({ immediate: action.id === 'fechamento' });
  };

  const handleCompanyChange = async () => {
    const value = normalizeId(elements.companySelect?.value || '');
    state.selectedStore = value;
    state.selectedPdv = '';
    state.paymentMethods = [];
    state.paymentMethodsLoading = false;
    resetWorkspace();
    updateWorkspaceVisibility(false);
    populatePdvSelect();
    if (!value) {
      await fetchPaymentMethods('');
      updateSelectionHint('Escolha a empresa para carregar os PDVs disponíveis.');
      return;
    }
    updateSelectionHint('Carregando PDVs disponíveis...');
    elements.pdvSelect.disabled = true;
    try {
      await Promise.all([fetchPdvs(value), fetchPaymentMethods(value)]);
      if (!state.pdvs.length) {
        updateSelectionHint('Nenhum PDV encontrado para a empresa selecionada.');
      } else {
        updateSelectionHint('Selecione o PDV desejado para iniciar.');
      }
    } catch (error) {
      console.error('Erro ao carregar PDVs da empresa selecionada:', error);
      notify(error.message || 'Erro ao carregar os PDVs da empresa.', 'error');
      state.pdvs = [];
      populatePdvSelect();
      updateSelectionHint('Não foi possível carregar os PDVs. Tente novamente.');
    } finally {
      elements.pdvSelect.disabled = state.pdvs.length === 0;
    }
  };

  const handlePdvChange = async () => {
    const value = normalizeId(elements.pdvSelect?.value || '');
    state.selectedPdv = value;
    resetWorkspace();
    if (!value) {
      updateWorkspaceVisibility(false);
      return;
    }
    updateSelectionHint('Carregando dados do PDV selecionado...');
    try {
      const pdv = await fetchPdvDetails(value);
      updateWorkspaceVisibility(true);
      applyPdvData(pdv);
      updateSelectionHint('PDV carregado com sucesso.');
    } catch (error) {
      console.error('Erro ao carregar PDV selecionado:', error);
      notify(error.message || 'Não foi possível carregar o PDV selecionado.', 'error');
      updateWorkspaceVisibility(false);
      updateSelectionHint('Erro ao carregar o PDV. Selecione novamente.');
    }
  };

  const bindEvents = () => {
    elements.companySelect?.addEventListener('change', handleCompanyChange);
    elements.pdvSelect?.addEventListener('change', handlePdvChange);
    elements.searchInput?.addEventListener('input', handleSearchInput);
    elements.searchInput?.addEventListener('keydown', handleSearchKeydown);
    elements.searchResults?.addEventListener('click', handleSearchResultsClick);
    document.addEventListener('click', handleDocumentClick);
    elements.addItem?.addEventListener('click', addItemToList);
    elements.itemQuantity?.addEventListener('input', handleQuantityInput);
    elements.quantityButtons?.forEach((button) => {
      const delta = Number(button.getAttribute('data-quantity-change')) || 0;
      button.addEventListener('click', () => changeQuantity(delta));
    });
    elements.itemsList?.addEventListener('click', handleItemsListClick);
    elements.paymentList?.addEventListener('input', handlePaymentInput);
    elements.resetPayments?.addEventListener('click', handleResetPayments);
    elements.clearHistory?.addEventListener('click', handleClearHistory);
    elements.caixaActions?.addEventListener('click', handleActionClick);
    elements.actionConfirm?.addEventListener('click', handleActionConfirm);
    elements.printControls?.addEventListener('click', handlePrintToggleClick);
    elements.finalizeButton?.addEventListener('click', handleFinalizeButtonClick);
    elements.finalizeClose?.addEventListener('click', closeFinalizeModal);
    elements.finalizeBack?.addEventListener('click', closeFinalizeModal);
    elements.finalizeBackdrop?.addEventListener('click', closeFinalizeModal);
    elements.finalizeConfirm?.addEventListener('click', handleFinalizeConfirm);
    elements.saleMethods?.addEventListener('click', handleSaleMethodsClick);
    elements.salePaymentsList?.addEventListener('click', handleSalePaymentsListClick);
    elements.saleAdjust?.addEventListener('click', handleSaleAdjust);
    elements.saleItemAdjust?.addEventListener('click', handleSaleItemAdjust);
    elements.paymentValueConfirm?.addEventListener('click', handlePaymentValueConfirm);
    elements.paymentValueCancel?.addEventListener('click', handlePaymentValueCancel);
    elements.paymentValueBackdrop?.addEventListener('click', handlePaymentValueCancel);
    elements.tabTriggers?.forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        const target = trigger.getAttribute('data-tab-target');
        if (!target) return;
        if (target === 'pdv-tab' && !state.caixaAberto) {
          event.preventDefault();
          notify('Abra o caixa para acessar a aba de vendas.', 'warning');
          setActiveTab('caixa-tab');
          return;
        }
        setActiveTab(target);
      });
    });
    Array.from(elements.saleActionButtons || []).forEach((button) => {
      const action = button.getAttribute('data-sale-action');
      if (!action) return;
      if (action === 'customer') {
        button.addEventListener('click', openCustomerModal);
        return;
      }
      if (action === 'delivery') {
        button.addEventListener('click', handleDeliveryAction);
        return;
      }
      button.addEventListener('click', () => {
        notify('Funcionalidade em desenvolvimento.', 'info');
      });
    });
    elements.customerRemove?.addEventListener('click', handleCustomerRemove);
    elements.customerModalClose?.addEventListener('click', closeCustomerModal);
    elements.customerModalBackdrop?.addEventListener('click', closeCustomerModal);
    elements.customerCancel?.addEventListener('click', closeCustomerModal);
    elements.customerConfirm?.addEventListener('click', handleCustomerConfirm);
    elements.customerClear?.addEventListener('click', handleCustomerClearSelection);
    elements.customerSearchInput?.addEventListener('input', handleCustomerSearchInput);
    elements.customerResultsList?.addEventListener('click', handleCustomerResultsClick);
    elements.customerPetsList?.addEventListener('click', handleCustomerPetsClick);
    Array.from(elements.customerTabButtons || []).forEach((button) => {
      button.addEventListener('click', handleCustomerTabClick);
    });
    elements.customerModal?.addEventListener('keydown', handleCustomerModalKeydown);
    elements.deliveryAddressList?.addEventListener('change', handleDeliveryAddressSelection);
    elements.deliveryAddressConfirm?.addEventListener('click', handleDeliveryAddressConfirm);
    elements.deliveryAddressCancel?.addEventListener('click', closeDeliveryAddressModal);
    elements.deliveryAddressBackdrop?.addEventListener('click', closeDeliveryAddressModal);
    elements.deliveryAddressClose?.addEventListener('click', closeDeliveryAddressModal);
    elements.deliveryAddressAdd?.addEventListener('click', handleDeliveryAddressToggle);
    elements.deliveryAddressCancelForm?.addEventListener('click', handleDeliveryAddressCancelForm);
    elements.deliveryAddressForm?.addEventListener('submit', handleDeliveryAddressFormSubmit);
    elements.deliveryList?.addEventListener('click', handleDeliveryListClick);
    elements.salesList?.addEventListener('click', handleSalesListClick);
    elements.saleCancelConfirm?.addEventListener('click', handleSaleCancelConfirm);
    elements.saleCancelCancel?.addEventListener('click', closeSaleCancelModal);
    elements.saleCancelClose?.addEventListener('click', closeSaleCancelModal);
    elements.saleCancelBackdrop?.addEventListener('click', closeSaleCancelModal);
    elements.saleCancelModal?.addEventListener('keydown', handleSaleCancelModalKeydown);
    elements.saleCancelReason?.addEventListener('input', clearSaleCancelError);
    if (elements.deliveryAddressFields?.cep) {
      const cepInput = elements.deliveryAddressFields.cep;
      cepInput.addEventListener('input', () => {
        const digits = sanitizeCepDigits(cepInput.value || '');
        const formatted = formatCep(digits);
        if (cepInput.value !== formatted) {
          cepInput.value = formatted;
        }
        if (digits.length === 8) {
          handleDeliveryCepLookup();
        }
      });
      cepInput.addEventListener('blur', () => {
        handleDeliveryCepLookup({ force: true });
      });
    }
    if (elements.deliveryAddressFields?.uf) {
      elements.deliveryAddressFields.uf.addEventListener('input', () => {
        const input = elements.deliveryAddressFields?.uf;
        if (input) {
          input.value = input.value.toUpperCase();
        }
      });
    }
  };

  const init = async () => {
    queryElements();
    resetWorkspace();
    updateWorkspaceVisibility(false);
    bindEvents();
    renderSalePaymentMethods();
    updateTabAvailability();
    try {
      await fetchStores();
      if (state.stores.length > 0) {
        updateSelectionHint('Escolha a empresa para carregar os PDVs disponíveis.');
      } else {
        updateSelectionHint('Cadastre uma empresa para habilitar o PDV.');
      }
    } catch (error) {
      console.error('Erro ao carregar empresas para o PDV:', error);
      notify(error.message || 'Erro ao carregar a lista de empresas.', 'error');
      updateSelectionHint('Não foi possível carregar as empresas.');
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
