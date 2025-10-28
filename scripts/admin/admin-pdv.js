(() => {
  const API_BASE =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.BASE_URL) || '/api';
  const SERVER_URL =
    (typeof API_CONFIG !== 'undefined' && API_CONFIG && API_CONFIG.SERVER_URL) || '';

  const PDV_NO_CUSTOMER_LABEL = 'Sem Cliente na Venda';
  const RECEIVABLES_RESIDUAL_THRESHOLD = 0.009;

  const paymentTypeOrder = {
    avista: 0,
    debito: 1,
    credito: 2,
    crediario: 3,
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
    financeSettings: { contaCorrente: null, contaContabilReceber: null },
    accountsReceivable: [],
    receivablesSearchQuery: '',
    receivablesSearchResults: [],
    receivablesSearchLoading: false,
    receivablesSelectedCustomer: null,
    receivablesListLoading: false,
    receivablesListError: '',
    receivablesCustomerLoading: false,
    receivablesSelectedIds: [],
    receivablesSelectedTotal: 0,
    receivablesPaymentLoading: false,
    receivablesPaymentContext: null,
    receivablesSaleBackup: null,
    receivablesResidualValue: 0,
    receivablesResidualDueDate: '',
    receivablesResidualError: '',
    crediarioModalMethod: null,
    crediarioInstallments: [],
    crediarioNextParcelNumber: 1,
    crediarioLastDate: '',
    crediarioEditingPayment: null,
    crediarioEditingIndex: -1,
    crediarioModalOpen: false,
    summary: { abertura: 0, recebido: 0, saldo: 0, recebimentosCliente: 0 },
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
    finalizeProcessing: false,
    completedSales: [],
    budgets: [],
    selectedBudgetId: '',
    activeBudgetId: '',
    pendingBudgetValidityDays: null,
    budgetSequence: 1,
    budgetFilters: { preset: 'todos', start: '', end: '' },
    appointments: [],
    appointmentsLoading: false,
    appointmentFilters: { preset: 'today', start: '', end: '' },
    appointmentMetrics: { today: 0, week: 0, month: 0 },
    appointmentScrollPending: false,
    activeAppointmentId: '',
    activeSaleCancellationId: '',
    fiscalEmissionStep: '',
    fiscalEmissionModalOpen: false,
    activePdvStoreId: '',
    fullscreenActive: false,
  };

  const elements = {};
  let budgetImportDefaultLabel = 'Importar orçamento';
  const BUDGET_IMPORT_FINALIZED_LABEL = 'Orçamento finalizado';
  const customerPetsCache = new Map();
  const customerAddressesCache = new Map();
  const appointmentCache = new Map();
  const appointmentCustomerCache = new Map();
  const appointmentCustomerRequestCache = new Map();
  const customerReceivablesCache = new Map();
  const customerReceivablesDetailsCache = new Map();

  const generateBudgetCode = () => {
    const sequence = Math.max(1, Number.parseInt(state.budgetSequence, 10) || 1);
    const code = `${BUDGET_CODE_PREFIX}-${String(sequence).padStart(BUDGET_CODE_PADDING, '0')}`;
    state.budgetSequence = sequence + 1;
    return code;
  };
  const SALE_CODE_STORAGE_PREFIX = 'pdvSaleSequence:';
  const SALE_CODE_PADDING = 6;
  const BUDGET_CODE_PREFIX = 'ORC';
  const BUDGET_CODE_PADDING = 6;
  const ACTIVE_TAB_STORAGE_KEY = 'adminPdvActiveTab';
  let pendingActiveTabPreference = '';
  const loadActiveTabPreference = () => {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      return window.localStorage?.getItem(ACTIVE_TAB_STORAGE_KEY) || '';
    } catch (error) {
      return '';
    }
  };
  const persistActiveTabPreference = (tabId) => {
    if (typeof window === 'undefined' || !tabId) {
      return;
    }
    try {
      window.localStorage?.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
    } catch (error) {
      // Ignore storage persistence errors
    }
  };
  const DEFAULT_BUDGET_VALIDITY_DAYS = 7;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
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
  const getDefaultPdvSelectionPreference = () => ({ storeId: '', pdvId: '' });
  const PDV_SELECTION_STORAGE_KEY = 'adminPdvSelection';
  const loadPdvSelectionPreference = () => {
    if (typeof window === 'undefined') {
      return getDefaultPdvSelectionPreference();
    }
    try {
      const raw = window.localStorage?.getItem(PDV_SELECTION_STORAGE_KEY);
      if (!raw) {
        return getDefaultPdvSelectionPreference();
      }
      const parsed = JSON.parse(raw);
      const storeId = normalizeId(parsed.storeId ?? parsed.companyId ?? '');
      const pdvId = normalizeId(parsed.pdvId ?? parsed.pdv ?? '');
      return { storeId, pdvId };
    } catch (error) {
      return getDefaultPdvSelectionPreference();
    }
  };
  const persistPdvSelectionPreference = (partialSelection = {}) => {
    if (typeof window === 'undefined' || !partialSelection || typeof partialSelection !== 'object') {
      return;
    }
    try {
      const current = loadPdvSelectionPreference();
      const next = { ...current };
      if (Object.prototype.hasOwnProperty.call(partialSelection, 'storeId')) {
        next.storeId = normalizeId(partialSelection.storeId);
      }
      if (Object.prototype.hasOwnProperty.call(partialSelection, 'pdvId')) {
        next.pdvId = normalizeId(partialSelection.pdvId);
      }
      if (!next.storeId && !next.pdvId) {
        window.localStorage?.removeItem(PDV_SELECTION_STORAGE_KEY);
        return;
      }
      window.localStorage?.setItem(PDV_SELECTION_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      // Ignore storage persistence errors
    }
  };
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
  const extractNormalizedId = (value) => {
    if (value == null) return '';
    if (typeof value === 'object') {
      const directKeys = ['_id', 'id', 'value', 'codigo', 'codigoInterno'];
      for (const key of directKeys) {
        if (value[key] != null) {
          return normalizeId(value[key]);
        }
      }
      if (typeof value.toString === 'function') {
        const stringValue = value.toString();
        if (stringValue && stringValue !== '[object Object]') {
          return normalizeId(stringValue);
        }
      }
      return '';
    }
    return normalizeId(value);
  };

  const normalizePdvRecord = (pdv) => {
    if (!pdv || typeof pdv !== 'object') return pdv;
    const normalized = { ...pdv, _id: normalizeId(pdv._id) };
    if (pdv.empresa && typeof pdv.empresa === 'object') {
      normalized.empresa = { ...pdv.empresa, _id: normalizeId(pdv.empresa._id) };
    } else if (pdv.empresa != null) {
      normalized.empresa = normalizeId(pdv.empresa);
    }
    if (pdv.empresaId != null) {
      normalized.empresaId = normalizeId(pdv.empresaId);
    }
    if (pdv.store && typeof pdv.store === 'object') {
      normalized.store = { ...pdv.store, _id: normalizeId(pdv.store._id) };
    } else if (pdv.store != null) {
      normalized.store = normalizeId(pdv.store);
    }
    if (pdv.storeId != null) {
      normalized.storeId = normalizeId(pdv.storeId);
    }
    if (pdv.company && typeof pdv.company === 'object') {
      normalized.company = { ...pdv.company, _id: normalizeId(pdv.company._id) };
    } else if (pdv.company != null) {
      normalized.company = normalizeId(pdv.company);
    }
    if (pdv.companyId != null) {
      normalized.companyId = normalizeId(pdv.companyId);
    }
    return normalized;
  };

  const formatFinanceReferenceLabel = (reference) => {
    if (!reference || typeof reference !== 'object') {
      return '';
    }
    const code =
      reference.codigo ||
      reference.code ||
      reference.numero ||
      reference.number ||
      '';
    const name = reference.nome || reference.name || reference.descricao || reference.description || '';
    const parts = [code, name].filter(Boolean);
    return parts.join(' • ') || name || code || '';
  };

  const normalizeFinanceReference = (reference) => {
    if (!reference) {
      return null;
    }
    if (typeof reference === 'object') {
      const id = normalizeId(reference._id || reference.id || reference.codigo || reference.code || '');
      return {
        id,
        label: formatFinanceReferenceLabel(reference) || 'Conta',
        raw: { ...reference },
      };
    }
    const id = normalizeId(reference);
    if (!id) {
      return null;
    }
    return { id, label: '', raw: null };
  };

  const formatDateLabel = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR');
  };

  const resolveCustomerName = (customer) => {
    if (!customer || typeof customer !== 'object') return '';
    return (
      customer.nomeCompleto ||
      customer.nome ||
      customer.razaoSocial ||
      customer.fantasia ||
      customer.name ||
      customer.socialReason ||
      customer.displayName ||
      ''
    );
  };

  const resolveCustomerDocument = (customer) => {
    if (!customer || typeof customer !== 'object') return '';
    return (
      customer.documento ||
      customer.document ||
      customer.cpf ||
      customer.cnpj ||
      customer.doc ||
      ''
    );
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
    const candidates = [
      pdv.company,
      pdv.companyId,
      pdv.empresa,
      pdv.empresaId,
      pdv.store?.empresa,
      pdv.store?.company,
      pdv.store,
      pdv.storeId,
    ];
    for (const candidate of candidates) {
      const id = extractNormalizedId(candidate);
      if (id) return id;
    }
    return '';
  };
  const getPdvStoreId = (pdv) => {
    if (!pdv) return '';
    const candidates = [
      pdv.store,
      pdv.storeId,
      pdv.empresa,
      pdv.empresaId,
      pdv.company,
      pdv.companyId,
    ];
    for (const candidate of candidates) {
      const id = extractNormalizedId(candidate);
      if (id) return id;
    }
    return '';
  };
  const getActiveAppointmentStoreId = () => {
    if (state.activePdvStoreId) {
      return state.activePdvStoreId;
    }
    const pdv = findPdvById(state.selectedPdv);
    const pdvStoreId = getPdvStoreId(pdv);
    if (pdvStoreId) {
      return pdvStoreId;
    }
    return state.selectedStore || '';
  };
  const findStoreById = (storeId) =>
    state.stores.find((item) => normalizeId(item._id) === normalizeId(storeId));
  const findPdvById = (pdvId) =>
    state.pdvs.find((item) => normalizeId(item._id) === normalizeId(pdvId));
  let searchTimeout = null;
  let customerSearchTimeout = null;
  let customerSearchController = null;
  let customerPetsController = null;
  let receivablesSearchTimeout = null;
  let receivablesSearchController = null;
  let receivablesCustomerController = null;
  let receivablesCustomerDetailsController = null;
  let activeReceivablesRequestId = 0;
  let receivablesRequestSequence = 0;
  let activeReceivablesDetailsRequestId = 0;
  let receivablesDetailsRequestSequence = 0;
  let paymentModalState = null;
  let appointmentsRequestId = 0;

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

  const abbreviateOperatorName = (name) => {
    if (!name) return '';
    const normalized = String(name).replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    const parts = normalized.split(' ').filter(Boolean);
    if (!parts.length) return '';

    const toTitleCase = (value) => {
      if (!value) return '';
      const first = value.charAt(0).toUpperCase();
      const rest = value.slice(1).toLowerCase();
      return `${first}${rest}`;
    };

    const connectors = new Set(['da', 'de', 'di', 'do', 'du', 'das', 'dos', 'e']);
    const firstPart = toTitleCase(parts[0]);
    let secondPart = '';
    for (let index = 1; index < parts.length; index += 1) {
      const candidate = parts[index];
      if (!candidate) continue;
      const normalizedCandidate = candidate.toLowerCase();
      const letters = normalizedCandidate.replace(/[^a-zà-ú]/gi, '');
      if (!letters) {
        continue;
      }
      if (connectors.has(normalizedCandidate) || letters.length <= 2) {
        if (!secondPart && index === parts.length - 1) {
          secondPart = toTitleCase(candidate);
        }
        continue;
      }
      secondPart = toTitleCase(candidate);
      break;
    }

    if (!secondPart && parts.length > 1) {
      secondPart = toTitleCase(parts[1]);
    }

    if (secondPart) {
      secondPart = secondPart.slice(0, 4);
    }

    return secondPart ? `${firstPart} ${secondPart}` : firstPart;
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

  const resolveCustomerAddressRecord = (cliente) => {
    if (!cliente || typeof cliente !== 'object') return null;

    const inlineAddresses = extractInlineCustomerAddresses(cliente);
    for (let index = 0; index < inlineAddresses.length; index += 1) {
      const normalized = normalizeCustomerAddressRecord(inlineAddresses[index], index);
      if (normalized?.formatted) {
        return normalized;
      }
    }

    const fallback = {
      logradouro:
        cliente.logradouro ||
        cliente.endereco ||
        cliente.rua ||
        cliente.street ||
        cliente.address ||
        '',
      numero: cliente.numero || cliente.num || cliente.number || cliente.addressNumber || '',
      complemento: cliente.complemento || cliente.complement || cliente.comp || cliente.addressComplement || '',
      bairro: cliente.bairro || cliente.distrito || cliente.neighborhood || cliente.bairroResidencia || '',
      cidade: cliente.cidade || cliente.municipio || cliente.city || cliente.cidadeResidencia || '',
      uf: (cliente.uf || cliente.estado || cliente.state || cliente.ufResidencia || '').toString().toUpperCase(),
      cep: cliente.cep || cliente.cepFormatado || cliente.zip || cliente.postalCode || cliente.cepResidencia || '',
    };

    const hasMeaningfulValue = Object.values(fallback).some((value) => {
      if (value == null) return false;
      return String(value).trim() !== '';
    });

    if (!hasMeaningfulValue) {
      return null;
    }

    return { ...fallback, formatted: buildDeliveryAddressLine(fallback) };
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

  const parsePrazoDays = (value) => {
    if (value == null) {
      return 0;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) {
        return 0;
      }
      const match = normalized.match(/-?\d+/);
      if (match) {
        const parsed = Number.parseInt(match[0], 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      const coerced = Number(normalized.replace(',', '.'));
      return Number.isFinite(coerced) ? coerced : 0;
    }
    if (typeof value === 'object') {
      const candidates = [
        value.days,
        value.dias,
        value.prazo,
        value.prazoRecebimento,
        value.prazo_recebimento,
      ];
      for (const candidate of candidates) {
        if (candidate == null) {
          continue;
        }
        if (candidate === value) {
          continue;
        }
        const parsed = parsePrazoDays(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : 0;
  };

  const resolveAnticipationFlag = (method, payment) => {
    const truthyStrings = new Set(['1', 'true', 't', 'y', 'yes', 'sim', 's', 'ativo', 'ligado', 'on']);
    const candidates = [
      payment?.antecipado,
      payment?.anticipated,
      payment?.anticipation,
      method?.raw?.anticipated,
      method?.raw?.antecipado,
      method?.raw?.antecipacao,
      method?.raw?.antecipacaoAutomatica,
      method?.raw?.antecipar,
      method?.raw?.anticipation,
      method?.raw?.recebimentoAntecipado,
      method?.raw?.configuracaoAntecipacao?.ativo,
      method?.raw?.configuracaoAntecipacao?.active,
      method?.raw?.configuracaoRecebimento?.antecipado,
      method?.raw?.config?.antecipado,
      method?.raw?.config?.anticipated,
    ];
    return candidates.some((candidate) => {
      if (typeof candidate === 'boolean') {
        return candidate;
      }
      if (typeof candidate === 'number') {
        return Number.isFinite(candidate) && candidate > 0;
      }
      if (typeof candidate === 'string') {
        const normalized = candidate.trim().toLowerCase();
        if (!normalized) {
          return false;
        }
        return truthyStrings.has(normalized);
      }
      return false;
    });
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

  const parseDateInputValue = (value) => {
    if (!value) return null;
    const normalized = `${value}T00:00:00`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const toStartOfDay = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const toEndOfDay = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(23, 59, 59, 999);
    return date;
  };
  const addDays = (value, days) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + Number(days || 0));
    return date;
  };
  const startOfWeek = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day; // segunda-feira como início
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const endOfWeek = (value) => {
    const start = startOfWeek(value);
    if (!start) return null;
    const end = addDays(start, 7);
    return end;
  };
  const startOfMonth = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const endOfMonth = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setMonth(date.getMonth() + 1, 1);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const formatDateParam = (value) => {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const formatHourMinute = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const formatDayMonth = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };
  const getAppointmentScheduleLabel = (appointment) => {
    if (!appointment) return 'Data não informada';
    const source = appointment.scheduledAt || appointment.h || appointment.data || appointment.scheduledAtIso;
    if (!source) return 'Data não informada';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return 'Data não informada';
    const dayMonth = formatDayMonth(date);
    const time = formatHourMinute(date);
    return `${dayMonth} • ${time}`;
  };

  const clampBudgetValidityDays = (days) => {
    const numeric = Math.floor(Number(days) || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return DEFAULT_BUDGET_VALIDITY_DAYS;
    }
    return Math.min(365, Math.max(1, numeric));
  };

  const isDateWithinRange = (date, start, end) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    const timestamp = date.getTime();
    if (start instanceof Date && !Number.isNaN(start.getTime()) && timestamp < start.getTime()) {
      return false;
    }
    if (end instanceof Date && !Number.isNaN(end.getTime()) && timestamp > end.getTime()) {
      return false;
    }
    return true;
  };

  const getTimeValue = (value) => {
    if (!value) return 0;
    const date = value instanceof Date ? value : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
    return date.getTime();
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
    const recebimentosClienteValor = safeNumber(state.summary.recebimentosCliente);

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
        recebimentosCliente: {
          value: recebimentosClienteValor,
          formatted: formatCurrency(recebimentosClienteValor),
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

    const clienteAddress = resolveCustomerAddressRecord(state.vendaCliente);

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
          endereco: clienteAddress?.formatted || '',
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

  const resolvePaymentMethodType = (method) => {
    if (!method) return '';
    const classify = (value) => {
      const normalized = normalizeKeyword(value);
      if (!normalized) {
        return '';
      }
      if (
        normalized.includes('crediario') ||
        normalized.includes('fiado') ||
        normalized.includes('caderneta') ||
        normalized.includes('carne') ||
        normalized.includes('carn')
      ) {
        return 'crediario';
      }
      if (
        normalized.includes('debito') ||
        normalized.includes('debit') ||
        normalized.includes('maestro') ||
        normalized.includes('electron') ||
        (normalized.includes('hiper') && normalized.includes('deb')) ||
        normalized.includes('banricompras') ||
        (normalized.includes('sodexo') && normalized.includes('deb')) ||
        normalized.includes('cartao debito') ||
        normalized.includes('cartao_debito')
      ) {
        return 'debito';
      }
      if (
        normalized.includes('credito') ||
        normalized.includes('credit') ||
        normalized.includes('parcelad') ||
        normalized.includes('cartao credito') ||
        normalized.includes('cartao_credito') ||
        normalized.includes('cartao') ||
        normalized.includes('visa') ||
        normalized.includes('master') ||
        normalized.includes('amex') ||
        normalized.includes('elo')
      ) {
        return 'credito';
      }
      if (
        normalized.includes('dinheiro') ||
        normalized.includes('especie') ||
        normalized.includes('espécie') ||
        normalized.includes('cash') ||
        normalized.includes('numerario') ||
        normalized.includes('avista') ||
        normalized.includes('a vista') ||
        normalized.includes('pix') ||
        normalized.includes('transferencia') ||
        normalized.includes('boleto') ||
        normalized.includes('cheque')
      ) {
        return 'avista';
      }
      return '';
    };
    const candidates = [
      method.type,
      method.tipo,
      method.paymentType,
      method.payment_type,
      method.formaPagamento,
      method.forma_pagamento,
      method.formaRecebimento,
      method.forma_recebimento,
      method.modalidade,
      method.modalidadeRecebimento,
      method.categoria,
      method.category,
      method.codigoTipo,
      method.codigo_tipo,
      method.codigo,
      method.code,
      method.nome,
      method.name,
      method.label,
      method.slug,
      method.displayName,
      method.descricao,
      method.description,
    ];
    for (const candidate of candidates) {
      const resolved = classify(candidate);
      if (resolved) {
        return resolved;
      }
    }
    return '';
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
    const resolvedType = resolvePaymentMethodType(method);
    const type = (resolvedType || 'avista').toLowerCase();
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
          method.displayName,
          method.descricao,
          method.description,
          method.tipo,
          method.type,
          method.paymentType,
          method.payment_type,
          method.formaPagamento,
          method.forma_pagamento,
          method.formaRecebimento,
          method.forma_recebimento,
          method.modalidade,
          method.modalidadeRecebimento,
          method.categoria,
          method.category,
          method.codigoTipo,
          method.codigo_tipo,
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
    renderReceivablesSelectionSummary();
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

  const normalizeReceivableForPersist = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const value = safeNumber(entry.value ?? entry.valor ?? entry.amount ?? 0);
    const dueSource = entry.dueDate ?? entry.vencimento ?? null;
    const dueDate = dueSource ? new Date(dueSource) : null;
    return {
      id: entry.id ? String(entry.id) : createUid(),
      parcelNumber: (() => {
        const raw = entry.parcelNumber ?? entry.parcela ?? entry.numeroParcela;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      })(),
      value,
      formattedValue: entry.formattedValue ? String(entry.formattedValue) : formatCurrency(value),
      dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null,
      dueDateLabel: entry.dueDateLabel ? String(entry.dueDateLabel) : formatDateLabel(dueDate),
      paymentMethodId: entry.paymentMethodId ? String(entry.paymentMethodId) : '',
      paymentMethodLabel: entry.paymentMethodLabel ? String(entry.paymentMethodLabel) : '',
      paymentMethodType: entry.paymentMethodType ? String(entry.paymentMethodType) : '',
      contaCorrente:
        entry.contaCorrente && typeof entry.contaCorrente === 'object'
          ? { ...entry.contaCorrente }
          : null,
      contaContabil:
        entry.contaContabil && typeof entry.contaContabil === 'object'
          ? { ...entry.contaContabil }
          : null,
      saleCode: entry.saleCode ? String(entry.saleCode) : '',
      crediarioMethodId: entry.crediarioMethodId ? String(entry.crediarioMethodId) : '',
      clienteId: entry.clienteId ? String(entry.clienteId) : '',
      clienteNome: entry.clienteNome ? String(entry.clienteNome) : '',
      saleId: entry.saleId ? String(entry.saleId) : '',
      salePaymentId: entry.salePaymentId ? String(entry.salePaymentId) : '',
      accountReceivableId: entry.accountReceivableId ? String(entry.accountReceivableId) : '',
      documentNumber: entry.documentNumber ? String(entry.documentNumber) : '',
      status: entry.status ? String(entry.status) : '',
      notes: entry.notes ? String(entry.notes) : '',
      locked: Boolean(entry.locked),
      lockReason: entry.lockReason ? String(entry.lockReason) : '',
      origin: entry.origin ? String(entry.origin) : '',
      metadata:
        entry.metadata && typeof entry.metadata === 'object' ? { ...entry.metadata } : null,
    };
  };

  const normalizeSaleRecordForPersist = (record) => {
    if (!record || typeof record !== 'object') return null;
    const createdAt = record.createdAt ? new Date(record.createdAt) : new Date();
    const inventoryProcessed = Boolean(record.inventoryProcessed);
    let inventoryProcessedAt = null;
    if (record.inventoryProcessedAt) {
      const processedAt = new Date(record.inventoryProcessedAt);
      if (!Number.isNaN(processedAt.getTime())) {
        inventoryProcessedAt = processedAt.toISOString();
      }
    }
    const rawFiscalStatus = record.fiscalStatus ? String(record.fiscalStatus) : '';
    const normalizedFiscalStatus = rawFiscalStatus === 'emitting' ? 'pending' : rawFiscalStatus;
    const normalizedReceivables = Array.isArray(record.receivables)
      ? record.receivables
          .map((entry) => {
            const normalized = normalizeReceivableForPersist(entry);
            if (normalized && !normalized.saleId && record.id) {
              normalized.saleId = String(record.id);
            }
            return normalized;
          })
          .filter(Boolean)
      : [];

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
      fiscalStatus: normalizedFiscalStatus,
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
      receivables: normalizedReceivables,
      expanded: Boolean(record.expanded),
      status: record.status ? String(record.status) : 'completed',
      cancellationReason: record.cancellationReason ? String(record.cancellationReason) : '',
      cancellationAt: record.cancellationAt ? new Date(record.cancellationAt).toISOString() : null,
      cancellationAtLabel: record.cancellationAtLabel ? String(record.cancellationAtLabel) : '',
      inventoryProcessed,
      inventoryProcessedAt,
    };
  };

  const normalizeBudgetRecordForPersist = (budget) => {
    if (!budget || typeof budget !== 'object') return null;
    const rawId = budget.id || budget._id || createUid();
    const id = String(rawId);
    const createdSource =
      budget.createdAt || budget.criadoEm || budget.criado || budget.created_at || budget.dataCriacao;
    const createdDate = createdSource ? new Date(createdSource) : new Date();
    const createdAt = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
    const createdAtIso = createdAt.toISOString();
    const updatedSource = budget.updatedAt || budget.atualizadoEm || budget.updated_at || budget.dataAtualizacao;
    const updatedDate = updatedSource ? new Date(updatedSource) : createdAt;
    const updatedAtIso = Number.isNaN(updatedDate.getTime()) ? createdAtIso : updatedDate.toISOString();
    const validityDays = clampBudgetValidityDays(budget.validityDays ?? budget.validadeDias ?? budget.validade);
    let validUntilDate = null;
    const validUntilSource = budget.validUntil || budget.validadeAte || budget.validadeFim;
    if (validUntilSource) {
      const parsed = new Date(validUntilSource);
      if (!Number.isNaN(parsed.getTime())) {
        validUntilDate = parsed;
      }
    }
    if (!validUntilDate) {
      const base = toStartOfDay(createdAt) || createdAt;
      validUntilDate = new Date(base.getTime() + validityDays * MS_PER_DAY);
    }
    const validUntilIso = validUntilDate.toISOString();
    const customerSource = budget.customer || budget.cliente || null;
    const petSource = budget.pet || budget.petCliente || budget.petClienteSelecionado || null;
    const paymentsSource = Array.isArray(budget.payments)
      ? budget.payments
      : Array.isArray(budget.pagamentos)
      ? budget.pagamentos
      : [];
    const itemsSource = Array.isArray(budget.items)
      ? budget.items
      : Array.isArray(budget.itens)
      ? budget.itens
      : [];
    const normalizedPayments = paymentsSource.map((payment) => ({ ...payment }));
    const normalizedItems = itemsSource.map((item, index) => {
      const quantidade = safeNumber(item?.quantidade ?? item?.qtd ?? item?.quant ?? 0);
      const valor = safeNumber(item?.valor ?? item?.valorUnitario ?? item?.preco ?? item?.unitario ?? 0);
      const subtotal = safeNumber(item?.subtotal ?? item?.total ?? valor * quantidade);
      return {
        ...item,
        id: item?.id || `${id}-item-${index}`,
        codigo: item?.codigo || item?.codigoInterno || item?.sku || '',
        codigoBarras: item?.codigoBarras || item?.barcode || item?.ean || '',
        nome: item?.nome || item?.descricao || item?.produto || `Item ${index + 1}`,
        quantidade,
        valor,
        subtotal,
      };
    });
    const finalizedSource =
      budget.finalizedAt ||
      budget.finalizadoEm ||
      budget.finalizado_at ||
      budget.dataFinalizacao ||
      budget.finalizacaoEm ||
      budget.dataFinalizada;
    let finalizedAtIso = null;
    if (finalizedSource) {
      const parsed = new Date(finalizedSource);
      if (!Number.isNaN(parsed.getTime())) {
        finalizedAtIso = parsed.toISOString();
      }
    }
    const finalizedSaleIdSource =
      budget.finalizedSaleId ||
      budget.vendaFinalizadaId ||
      budget.vendaIdFinalizada ||
      budget.finalizedSale ||
      budget.saleFinalizedId ||
      budget.vendaRelacionadaId;
    return {
      id,
      code: String(budget.code || budget.codigo || budget.numero || id),
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      validityDays,
      validUntil: validUntilIso,
      total: safeNumber(budget.total ?? budget.valorTotal ?? 0),
      discount: safeNumber(budget.discount ?? budget.desconto ?? 0),
      addition: safeNumber(budget.addition ?? budget.acrescimo ?? 0),
      customer: customerSource && typeof customerSource === 'object' ? { ...customerSource } : null,
      pet: petSource && typeof petSource === 'object' ? { ...petSource } : null,
      items: normalizedItems,
      payments: normalizedPayments,
      paymentLabel: budget.paymentLabel ? String(budget.paymentLabel) : '',
      status: budget.status ? String(budget.status) : 'aberto',
      importedAt:
        budget.importedAt || budget.importadoEm
          ? (() => {
              const parsed = new Date(budget.importedAt || budget.importadoEm);
              return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
            })()
          : null,
      finalizedAt: finalizedAtIso,
      finalizedSaleId:
        finalizedSaleIdSource !== undefined && finalizedSaleIdSource !== null && finalizedSaleIdSource !== ''
          ? String(finalizedSaleIdSource)
          : '',
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
    const budgets = (Array.isArray(state.budgets) ? state.budgets : [])
      .map((budget) => normalizeBudgetRecordForPersist(budget))
      .filter(Boolean);
    const accountsReceivable = (Array.isArray(state.accountsReceivable)
      ? state.accountsReceivable
      : [])
      .map((entry) => normalizeReceivableForPersist(entry))
      .filter(Boolean);

    return {
      caixaAberto: Boolean(state.caixaAberto),
      summary: {
        abertura: safeNumber(state.summary.abertura),
        recebido: safeNumber(state.summary.recebido),
        saldo: safeNumber(state.summary.saldo),
        recebimentosCliente: safeNumber(state.summary.recebimentosCliente),
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
      budgets,
      lastMovement: state.lastMovement ? normalizeHistoryEntryForPersist(state.lastMovement) : null,
      saleCodeIdentifier: state.saleCodeIdentifier || '',
      saleCodeSequence: Math.max(1, Number.parseInt(state.saleCodeSequence, 10) || 1),
      budgetSequence: Math.max(1, Number.parseInt(state.budgetSequence, 10) || 1),
      printPreferences:
        state.printPreferences && typeof state.printPreferences === 'object'
          ? { ...state.printPreferences }
          : { fechamento: 'PM', venda: 'PM' },
      accountsReceivable,
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
    elements.selectionSection = document.getElementById('pdv-selection-section');

    elements.emptyState = document.getElementById('pdv-empty-state');
    elements.workspace = document.getElementById('pdv-workspace');
    elements.statusBadge = document.getElementById('pdv-status-badge');
    elements.saleCodeWrapper = document.getElementById('pdv-sale-code-wrapper');
    elements.saleCodeValue = document.getElementById('pdv-sale-code');
    elements.printControls = document.getElementById('pdv-print-controls');
    elements.fullscreenToggle = document.getElementById('pdv-fullscreen-toggle');
    elements.fullscreenLabel = document.getElementById('pdv-fullscreen-label');
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

    elements.receivablesSearchInput = document.getElementById('pdv-receivables-search');
    elements.receivablesSearchResults = document.getElementById('pdv-receivables-search-results');
    elements.receivablesSearchEmpty = document.getElementById('pdv-receivables-search-empty');
    elements.receivablesSearchLoading = document.getElementById('pdv-receivables-search-loading');
    elements.receivablesSearchWrapper = document.getElementById('pdv-receivables-search-wrapper');
    elements.receivablesSelected = document.getElementById('pdv-receivables-selected');
    elements.receivablesName = document.getElementById('pdv-receivables-customer-name');
    elements.receivablesDoc = document.getElementById('pdv-receivables-customer-doc');
    elements.receivablesContact = document.getElementById('pdv-receivables-customer-contact');
    elements.receivablesLimit = document.getElementById('pdv-receivables-customer-limit');
    elements.receivablesPending = document.getElementById('pdv-receivables-customer-pending');
    elements.receivablesClear = document.getElementById('pdv-receivables-clear');
    elements.receivablesLoading = document.getElementById('pdv-receivables-loading');
    elements.receivablesError = document.getElementById('pdv-receivables-error');
    elements.receivablesEmpty = document.getElementById('pdv-receivables-empty');
    elements.receivablesTable = document.getElementById('pdv-receivables-table');
    elements.receivablesList = document.getElementById('pdv-receivables-list');
    elements.receivablesTotal = document.getElementById('pdv-receivables-total');
    elements.receivablesActions = document.getElementById('pdv-receivables-actions');
    elements.receivablesSelectedCount = document.getElementById('pdv-receivables-selected-count');
    elements.receivablesSelectedTotalLabel = document.getElementById('pdv-receivables-selected-total');
    elements.receivablesPayButton = document.getElementById('pdv-receivables-pay');

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

    elements.budgetPresets = document.getElementById('pdv-budget-presets');
    elements.budgetStart = document.getElementById('pdv-budget-start');
    elements.budgetEnd = document.getElementById('pdv-budget-end');
    elements.budgetKpiToday = document.getElementById('pdv-budget-kpi-today');
    elements.budgetKpiWeek = document.getElementById('pdv-budget-kpi-week');
    elements.budgetKpiMonth = document.getElementById('pdv-budget-kpi-month');
    elements.budgetKpiAll = document.getElementById('pdv-budget-kpi-all');
    elements.budgetCount = document.getElementById('pdv-budget-count');
    elements.budgetList = document.getElementById('pdv-budget-list');
    elements.budgetEmpty = document.getElementById('pdv-budget-empty');
    elements.budgetDetailsHint = document.getElementById('pdv-budget-details-hint');
    elements.budgetImport = document.getElementById('pdv-budget-import');
    elements.budgetDelete = document.getElementById('pdv-budget-delete');
    elements.budgetCode = document.getElementById('pdv-budget-code');
    elements.budgetCustomer = document.getElementById('pdv-budget-customer');
    elements.budgetValidity = document.getElementById('pdv-budget-validity');
    elements.budgetStatus = document.getElementById('pdv-budget-status');
    elements.budgetTotal = document.getElementById('pdv-budget-total');
    elements.budgetItems = document.getElementById('pdv-budget-items');
    elements.budgetItemsEmpty = document.getElementById('pdv-budget-items-empty');

    elements.appointmentModal = document.getElementById('pdv-appointment-modal');
    elements.appointmentScrollContainer = document.querySelector('[data-appointment-scroll-container]');
    elements.appointmentBackdrop =
      elements.appointmentModal?.querySelector('[data-appointment-dismiss="backdrop"]') || null;
    elements.appointmentClose = document.getElementById('pdv-appointment-close');
    elements.appointmentPresets = document.getElementById('pdv-appointment-presets');
    elements.appointmentStart = document.getElementById('pdv-appointment-start');
    elements.appointmentEnd = document.getElementById('pdv-appointment-end');
    elements.appointmentApply = document.getElementById('pdv-appointment-apply');
    elements.appointmentReload = document.getElementById('pdv-appointment-reload');
    elements.appointmentCount = document.getElementById('pdv-appointment-count');
    elements.appointmentList = document.getElementById('pdv-appointment-list');
    elements.appointmentEmpty = document.getElementById('pdv-appointment-empty');
    elements.appointmentLoading = document.getElementById('pdv-appointment-loading');

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
    elements.receivablesResidualContainer = document.getElementById('pdv-receivables-residual');
    elements.receivablesResidualAmount = document.getElementById('pdv-receivables-residual-amount');
    elements.receivablesResidualDue = document.getElementById('pdv-receivables-residual-due');
    elements.receivablesResidualError = document.getElementById('pdv-receivables-residual-error');
    elements.saleAdjust = document.getElementById('pdv-sale-adjust');
    elements.saleItemAdjust = document.getElementById('pdv-sale-item-adjust');

    elements.budgetModal = document.getElementById('pdv-budget-modal');
    elements.budgetModalInput = document.getElementById('pdv-budget-validity');
    elements.budgetModalError = document.getElementById('pdv-budget-error');
    elements.budgetModalConfirm = document.getElementById('pdv-budget-confirm');
    elements.budgetModalCancel = document.getElementById('pdv-budget-cancel');
    elements.budgetModalClose = document.getElementById('pdv-budget-close');
    elements.budgetModalBackdrop =
      elements.budgetModal?.querySelector('[data-budget-dismiss="backdrop"]') || null;
    if (elements.budgetImport) {
      budgetImportDefaultLabel =
        elements.budgetImport.textContent?.trim() || budgetImportDefaultLabel;
    }

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

    elements.crediarioModal = document.getElementById('pdv-crediario-modal');
    elements.crediarioBackdrop =
      elements.crediarioModal?.querySelector('[data-crediario-dismiss]') || null;
    elements.crediarioClose = document.getElementById('pdv-crediario-close');
    elements.crediarioCancel = document.getElementById('pdv-crediario-cancel');
    elements.crediarioConfirm = document.getElementById('pdv-crediario-confirm');
    elements.crediarioCustomerButton = document.getElementById('pdv-crediario-customer-select');
    elements.crediarioCustomerName = document.getElementById('pdv-crediario-customer-name');
    elements.crediarioCustomerDoc = document.getElementById('pdv-crediario-customer-doc');
    elements.crediarioLimit = document.getElementById('pdv-crediario-limit');
    elements.crediarioPending = document.getElementById('pdv-crediario-pending');
    elements.crediarioFidelity = document.getElementById('pdv-crediario-fidelity');
    elements.crediarioError = document.getElementById('pdv-crediario-error');
    elements.crediarioMethodSelect = document.getElementById('pdv-crediario-method');
    elements.crediarioDateInput = document.getElementById('pdv-crediario-date');
    elements.crediarioParcelInput = document.getElementById('pdv-crediario-parcela');
    elements.crediarioValueInput = document.getElementById('pdv-crediario-value');
    elements.crediarioAddButton = document.getElementById('pdv-crediario-add');
    elements.crediarioList = document.getElementById('pdv-crediario-list');
    elements.crediarioListEmpty = document.getElementById('pdv-crediario-list-empty');
    elements.crediarioListHead = document.getElementById('pdv-crediario-list-head');
    elements.crediarioTotal = document.getElementById('pdv-crediario-total');
    elements.crediarioRemaining = document.getElementById('pdv-crediario-remaining');
    elements.crediarioRemainingStatus = document.getElementById('pdv-crediario-remaining-status');

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

  const setActiveTab = (targetId, options = {}) => {
    const { persist = true } = options;
    if (!elements.tabTriggers?.length || !elements.tabPanels?.length) return;
    let resolvedTarget = targetId || 'caixa-tab';
    if (resolvedTarget === 'pdv-tab' && !state.caixaAberto) {
      resolvedTarget = 'caixa-tab';
    }
    const availableTargets = Array.from(elements.tabPanels)
      .map((panel) => panel.getAttribute('data-tab-panel') || '')
      .filter(Boolean);
    if (!availableTargets.length) {
      return;
    }
    if (!availableTargets.includes(resolvedTarget)) {
      resolvedTarget = availableTargets.includes('caixa-tab')
        ? 'caixa-tab'
        : availableTargets[0];
    }
    elements.tabTriggers.forEach((trigger) => {
      const target = trigger.getAttribute('data-tab-target');
      const isActive = target === resolvedTarget;
      trigger.classList.toggle('text-primary', isActive);
      trigger.classList.toggle('border-primary', isActive);
      trigger.classList.toggle('border-transparent', !isActive);
      trigger.classList.toggle('text-gray-500', !isActive);
    });
    elements.tabPanels.forEach((panel) => {
      const panelId = panel.getAttribute('data-tab-panel');
      panel.classList.toggle('hidden', panelId !== resolvedTarget);
    });
    if (persist && resolvedTarget) {
      persistActiveTabPreference(resolvedTarget);
    }
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

  const getFullscreenElement = () => {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null
    );
  };

  const requestAppFullscreen = () => {
    const target = document.documentElement;
    if (!target) {
      throw new Error('Elemento inválido para ativar tela cheia.');
    }
    if (target.requestFullscreen) {
      return target.requestFullscreen();
    }
    if (target.webkitRequestFullscreen) {
      target.webkitRequestFullscreen();
      return Promise.resolve();
    }
    if (target.mozRequestFullScreen) {
      target.mozRequestFullScreen();
      return Promise.resolve();
    }
    if (target.msRequestFullscreen) {
      target.msRequestFullscreen();
      return Promise.resolve();
    }
    throw new Error('Modo tela cheia não é suportado neste navegador.');
  };

  const exitAppFullscreen = () => {
    if (document.exitFullscreen) {
      return document.exitFullscreen();
    }
    if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
      return Promise.resolve();
    }
    if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
      return Promise.resolve();
    }
    if (document.msExitFullscreen) {
      document.msExitFullscreen();
      return Promise.resolve();
    }
    return Promise.resolve();
  };

  const applyFullscreenState = () => {
    const active = Boolean(getFullscreenElement());
    state.fullscreenActive = active;
    if (document.body) {
      document.body.classList.toggle('pdv-fullscreen-active', active);
    }
    if (elements.fullscreenToggle) {
      elements.fullscreenToggle.setAttribute('aria-pressed', active ? 'true' : 'false');
      elements.fullscreenToggle.classList.toggle('border-primary', active);
      elements.fullscreenToggle.classList.toggle('text-primary', active);
      elements.fullscreenToggle.classList.toggle('bg-primary/5', active);
      elements.fullscreenToggle.classList.toggle('bg-white', !active);
      elements.fullscreenToggle.classList.toggle('border-gray-200', !active);
      elements.fullscreenToggle.classList.toggle('text-gray-600', !active);
      elements.fullscreenToggle.setAttribute(
        'title',
        active ? 'Sair do modo tela cheia' : 'Ativar modo tela cheia'
      );
    }
    if (elements.fullscreenLabel) {
      elements.fullscreenLabel.textContent = active ? 'Sair' : 'Ativar';
    }
    if (elements.selectionSection) {
      elements.selectionSection.classList.toggle('hidden', active);
    }
  };

  const handleFullscreenToggle = async (event) => {
    event.preventDefault();
    try {
      if (getFullscreenElement()) {
        await exitAppFullscreen();
        applyFullscreenState();
      } else {
        await requestAppFullscreen();
        applyFullscreenState();
      }
    } catch (error) {
      console.error('Erro ao alternar tela cheia no PDV:', error);
      notify(error.message || 'Não foi possível alternar o modo tela cheia.', 'error');
      applyFullscreenState();
    }
  };

  const handleFullscreenChange = () => {
    applyFullscreenState();
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

  const setSaleCustomer = (cliente, pet = null, options = {}) => {
    const skipRecalculate = Boolean(options.skipRecalculate);
    state.vendaCliente = cliente ? { ...cliente } : null;
    state.vendaPet = cliente && pet ? { ...pet } : null;
    if (!cliente) {
      state.vendaPet = null;
    }
    if (cliente && !state.receivablesSelectedCustomer) {
      setReceivablesSelectedCustomer(cliente);
    }
    updateSaleCustomerSummary();
    updateCrediarioCustomerSummary();
    if (elements.crediarioError) {
      elements.crediarioError.classList.add('hidden');
      elements.crediarioError.textContent = '';
    }
    if (!skipRecalculate) {
      recalculateItemsForCustomerChange();
    }
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

  const normalizeReceivableCustomerId = (entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const candidate =
      entry.clienteId ||
      entry.cliente_id ||
      entry.customerId ||
      entry.cliente ||
      entry.customer ||
      (entry.cliente && typeof entry.cliente === 'object'
        ? entry.cliente._id || entry.cliente.id
        : '') ||
      (entry.customer && typeof entry.customer === 'object'
        ? entry.customer._id || entry.customer.id
        : '');
    return candidate ? String(candidate) : '';
  };

  const resolveCustomerId = (customer) => {
    if (!customer || typeof customer !== 'object') return '';
    const candidate = customer._id || customer.id || customer.codigo || customer.code || '';
    return candidate ? String(candidate) : '';
  };

  const normalizeKeyword = (value) => {
    if (value == null) return '';
    const raw = String(value).trim().toLowerCase();
    if (!raw) return '';
    const normalized = typeof raw.normalize === 'function' ? raw.normalize('NFD') : raw;
    return normalized.replace(/[\u0300-\u036f]/g, '');
  };

  const isCrediarioReceivable = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const status = String(entry.status || '').toLowerCase();
    if (status && ['finalized', 'received', 'cancelled', 'canceled'].includes(status)) {
      return false;
    }
    if (entry.origin === 'sale') {
      return true;
    }
    if (entry.crediarioMethodId) return true;
    const methodType = normalizeKeyword(entry.paymentMethodType);
    if (methodType) {
      if (methodType.includes('crediario')) {
        return true;
      }
      return false;
    }
    const methodLabel = normalizeKeyword(entry.paymentMethodLabel || entry.paymentLabel);
    return methodLabel.includes('crediario');
  };

  const getReceivablesForCustomer = (customerId) => {
    const id = customerId ? String(customerId) : '';
    if (!id) return [];
    const entries = Array.isArray(state.accountsReceivable) ? state.accountsReceivable : [];
    return entries.filter((entry) => {
      if (!isCrediarioReceivable(entry)) return false;
      const entryId = normalizeReceivableCustomerId(entry);
      return entryId && entryId === id;
    });
  };

  const setCachedReceivablesForCustomer = (customerId, receivables) => {
    const id = customerId ? String(customerId) : '';
    if (!id) return;
    const list = Array.isArray(receivables)
      ? receivables.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry))
      : [];
    customerReceivablesCache.set(id, list);
  };

  const getCachedReceivablesForCustomer = (customerId) => {
    const id = customerId ? String(customerId) : '';
    if (!id || !customerReceivablesCache.has(id)) return null;
    const cached = customerReceivablesCache.get(id) || [];
    return cached.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry));
  };

  const clearReceivablesCache = () => {
    customerReceivablesCache.clear();
    customerReceivablesDetailsCache.clear();
  };

  const getReceivableValue = (entry) =>
    safeNumber(entry?.value ?? entry?.valor ?? entry?.amount ?? entry?.remaining ?? 0);

  const refreshReceivablesSelection = () => {
    const customerId = resolveCustomerId(state.receivablesSelectedCustomer);
    if (!customerId) {
      if (state.receivablesSelectedIds.length || state.receivablesSelectedTotal) {
        state.receivablesSelectedIds = [];
        state.receivablesSelectedTotal = 0;
      }
      return [];
    }
    const receivables = getReceivablesForCustomer(customerId);
    const selectedSet = new Set(state.receivablesSelectedIds);
    const entries = receivables.filter((entry) => selectedSet.has(entry.id));
    const validIds = entries.map((entry) => entry.id);
    if (validIds.length !== state.receivablesSelectedIds.length) {
      state.receivablesSelectedIds = validIds;
    }
    const total = entries.reduce((sum, entry) => sum + getReceivableValue(entry), 0);
    state.receivablesSelectedTotal = total;
    return entries;
  };

  const renderReceivablesSelectionSummary = () => {
    if (!elements.receivablesActions) return;
    const entries = refreshReceivablesSelection();
    const hasSelection = entries.length > 0;
    elements.receivablesActions.classList.toggle('hidden', !hasSelection);
    if (elements.receivablesSelectedCount) {
      elements.receivablesSelectedCount.textContent = hasSelection
        ? `${entries.length} parcela${entries.length > 1 ? 's' : ''} selecionada${
            entries.length > 1 ? 's' : ''
          }`
        : 'Nenhuma parcela selecionada';
    }
    if (elements.receivablesSelectedTotalLabel) {
      elements.receivablesSelectedTotalLabel.textContent = formatCurrency(
        state.receivablesSelectedTotal
      );
    }
    if (elements.receivablesPayButton) {
      const hasEligibleMethod = state.paymentMethods.some((method) => {
        const type = String(method?.type || '').toLowerCase();
        return type !== 'crediario';
      });
      const disabled =
        !hasSelection ||
        state.paymentMethodsLoading ||
        !hasEligibleMethod ||
        !state.caixaAberto ||
        state.receivablesPaymentLoading ||
        state.activeFinalizeContext === 'receivables';
      elements.receivablesPayButton.disabled = disabled;
      elements.receivablesPayButton.classList.toggle('opacity-60', disabled);
      elements.receivablesPayButton.classList.toggle('cursor-not-allowed', disabled);
    }
  };

  const clearReceivablesSelectionState = () => {
    state.receivablesSelectedIds = [];
    state.receivablesSelectedTotal = 0;
    renderReceivablesSelectionSummary();
  };

  const clearReceivablesPaymentContext = () => {
    state.receivablesPaymentContext = null;
    state.receivablesSaleBackup = null;
    state.receivablesPaymentLoading = false;
    renderReceivablesSelectionSummary();
  };

  const cloneReceivablesCustomerDetails = (details) => {
    if (!details || typeof details !== 'object') {
      return {};
    }
    const clone = { ...details };
    if (details.financeiro && typeof details.financeiro === 'object') {
      clone.financeiro = { ...details.financeiro };
    }
    return clone;
  };

  const applyReceivablesCustomerDetails = (customerId, details) => {
    const id = customerId ? String(customerId) : '';
    if (!id || !details || typeof details !== 'object') {
      return;
    }
    const selected = state.receivablesSelectedCustomer;
    if (!selected || resolveCustomerId(selected) !== id) {
      return;
    }
    const merged = {
      ...selected,
      ...details,
    };
    if (selected.financeiro || details.financeiro) {
      merged.financeiro = {
        ...(selected.financeiro && typeof selected.financeiro === 'object' ? selected.financeiro : {}),
        ...(details.financeiro && typeof details.financeiro === 'object' ? details.financeiro : {}),
      };
    }
    state.receivablesSelectedCustomer = merged;
  };

  const flattenReceivableRecords = (records) => {
    if (!Array.isArray(records)) return [];
    const flattened = [];
    records.forEach((record) => {
      if (!record || typeof record !== 'object') return;
      const receivableId = record._id ? String(record._id) : '';
      const customerId = record.customer && typeof record.customer === 'object'
        ? resolveCustomerId(record.customer)
        : '';
      const customerName =
        (record.customer && typeof record.customer === 'object' && record.customer.name) ||
        record.customerNome ||
        '';
      const baseMethod = record.paymentMethod || null;
      const saleCode = record.code || record.saleCode || '';
      const installments = Array.isArray(record.installments) && record.installments.length
        ? record.installments
        : [
            {
              number: record.installmentsCount || 1,
              dueDate: record.dueDate || record.issueDate || null,
              value: record.totalValue,
              status: record.status || '',
              paymentMethod: record.paymentMethod || null,
            },
          ];
      installments.forEach((installment, index) => {
        if (!installment) return;
        const parcelNumber =
          installment.parcelNumber ??
          installment.numeroParcela ??
          installment.number ??
          installment.installmentNumber ??
          index + 1;
        const dueDate = installment.dueDate || record.dueDate || record.issueDate || null;
        const paymentMethod = installment.paymentMethod || baseMethod || null;
        const value = safeNumber(
          installment.value ?? installment.originalValue ?? record.totalValue ?? 0
        );
        const normalized = {
          id: receivableId ? `${receivableId}:${parcelNumber}` : createUid(),
          parcelNumber,
          installmentNumber: parcelNumber,
          value,
          formattedValue: formatCurrency(value),
          dueDate,
          dueDateLabel: formatDateLabel(dueDate),
          paymentMethodId: paymentMethod?._id ? String(paymentMethod._id) : '',
          paymentMethodLabel: paymentMethod?.name || 'Crediário',
          paymentMethodType: (paymentMethod?.type || '').toLowerCase(),
          saleCode,
          crediarioMethodId: paymentMethod?._id ? String(paymentMethod._id) : '',
          clienteId: customerId,
          clienteNome: customerName,
          origin: 'remote',
          receivableId,
          status: typeof installment.status === 'string' && installment.status
            ? installment.status
            : record.status || '',
          accountReceivableId: receivableId,
          documentNumber: record.documentNumber || record.document || saleCode,
          notes: record.notes || '',
          locked: !!record.locked,
          lockReason: record.lockReason || '',
          metadata: record.metadata || null,
        };
        flattened.push(normalized);
      });
    });
    return flattened;
  };

  const mergeReceivablesForCustomer = (customerId, receivables) => {
    const id = customerId ? String(customerId) : '';
    if (!id) return;
    const existing = Array.isArray(state.accountsReceivable) ? state.accountsReceivable : [];
    const filtered = existing.filter((entry) => normalizeReceivableCustomerId(entry) !== id);
    const normalizedList = Array.isArray(receivables)
      ? receivables
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const clone = { ...entry };
            if (!clone.id) {
              clone.id = createUid();
            }
            if (!normalizeReceivableCustomerId(clone)) {
              clone.clienteId = id;
            }
            if (!clone.formattedValue) {
              clone.formattedValue = formatCurrency(
                safeNumber(clone.value ?? clone.valor ?? clone.amount ?? 0)
              );
            }
            if (!clone.dueDateLabel) {
              clone.dueDateLabel = formatDateLabel(clone.dueDate);
            }
            if (clone.installmentNumber == null && clone.parcelNumber != null) {
              clone.installmentNumber = clone.parcelNumber;
            } else if (clone.parcelNumber == null && clone.installmentNumber != null) {
              clone.parcelNumber = clone.installmentNumber;
            }
            if (!clone.origin) {
              clone.origin = 'remote';
            }
            return clone;
          })
          .filter(Boolean)
      : [];
    state.accountsReceivable = [...filtered, ...normalizedList];
  };

  const abortReceivablesCustomerFetch = () => {
    if (receivablesCustomerController) {
      receivablesCustomerController.abort();
      receivablesCustomerController = null;
    }
    if (receivablesCustomerDetailsController) {
      receivablesCustomerDetailsController.abort();
      receivablesCustomerDetailsController = null;
    }
    activeReceivablesDetailsRequestId = 0;
    state.receivablesCustomerLoading = false;
  };

  const renderReceivablesSearchResults = () => {
    if (
      !elements.receivablesSearchResults ||
      !elements.receivablesSearchEmpty ||
      !elements.receivablesSearchLoading
    ) {
      return;
    }
    const query = state.receivablesSearchQuery.trim();
    const shouldHideFeedback = Boolean(state.receivablesSelectedCustomer) && !query;
    if (elements.receivablesSearchWrapper) {
      elements.receivablesSearchWrapper.classList.toggle('hidden', shouldHideFeedback);
    }
    elements.receivablesSearchResults.classList.toggle('hidden', shouldHideFeedback);
    elements.receivablesSearchResults.innerHTML = '';
    if (shouldHideFeedback) {
      elements.receivablesSearchLoading.classList.add('hidden');
      elements.receivablesSearchEmpty.classList.add('hidden');
      return;
    }
    if (state.receivablesSearchLoading) {
      elements.receivablesSearchLoading.classList.remove('hidden');
      elements.receivablesSearchEmpty.classList.add('hidden');
      return;
    }
    elements.receivablesSearchLoading.classList.add('hidden');
    if (!query) {
      elements.receivablesSearchEmpty.textContent = 'Digite para buscar clientes.';
      elements.receivablesSearchEmpty.classList.remove('hidden');
      return;
    }
    if (!state.receivablesSearchResults.length) {
      elements.receivablesSearchEmpty.textContent = 'Nenhum cliente encontrado para a busca informada.';
      elements.receivablesSearchEmpty.classList.remove('hidden');
      return;
    }
    elements.receivablesSearchEmpty.classList.add('hidden');
    elements.receivablesSearchResults.classList.remove('hidden');
    const fragment = document.createDocumentFragment();
    state.receivablesSearchResults.forEach((cliente) => {
      const button = document.createElement('button');
      button.type = 'button';
      const rawId = cliente?._id || cliente?.id || '';
      const id = rawId ? String(rawId) : '';
      if (id) {
        button.setAttribute('data-receivables-customer-id', id);
      }
      const selectedId =
        state.receivablesSelectedCustomer?._id || state.receivablesSelectedCustomer?.id || '';
      const isSelected = selectedId && id && String(selectedId) === id;
      button.className = [
        'w-full text-left rounded-lg border px-3 py-2 transition flex flex-col gap-1',
        isSelected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-gray-200 text-gray-700 hover:border-primary hover:bg-primary/5',
      ].join(' ');
      const name =
        resolveCustomerName(cliente) ||
        cliente.nomeCompleto ||
        cliente.nomeContato ||
        'Cliente sem nome';
      const documento = resolveCustomerDocument(cliente);
      const contato = [cliente.email, cliente.celular, cliente.telefone]
        .filter(Boolean)
        .join(' • ');
      const documentLabel = documento ? `Documento: ${documento}` : 'Documento não informado';
      const contactLabel = contato || 'Contato não informado';
      button.innerHTML = `
        <span class="text-sm font-semibold">${escapeHtml(name)}</span>
        <span class="text-xs text-gray-500">${escapeHtml(documentLabel)}</span>
        <span class="text-xs text-gray-500">${escapeHtml(contactLabel)}</span>
      `;
      fragment.appendChild(button);
    });
    elements.receivablesSearchResults.appendChild(fragment);
  };

  const renderReceivablesSelectedCustomer = () => {
    if (!elements.receivablesSelected) return;
    const customer = state.receivablesSelectedCustomer;
    if (!customer) {
      elements.receivablesSelected.classList.add('hidden');
      if (elements.receivablesName) elements.receivablesName.textContent = 'Nenhum cliente selecionado';
      if (elements.receivablesDoc)
        elements.receivablesDoc.textContent = 'Selecione um cliente para visualizar pendências.';
      if (elements.receivablesContact) elements.receivablesContact.textContent = 'Contato: —';
      if (elements.receivablesLimit) elements.receivablesLimit.textContent = '—';
      if (elements.receivablesPending) elements.receivablesPending.textContent = formatCurrency(0);
      return;
    }
    elements.receivablesSelected.classList.remove('hidden');
    const name =
      resolveCustomerName(customer) ||
      customer.nomeCompleto ||
      customer.nomeContato ||
      'Cliente selecionado';
    const documento = resolveCustomerDocument(customer);
    const contato = [customer.email, customer.celular, customer.telefone]
      .filter(Boolean)
      .join(' • ');
    if (elements.receivablesName) {
      elements.receivablesName.textContent = name;
    }
    if (elements.receivablesDoc) {
      elements.receivablesDoc.textContent = documento
        ? `Documento: ${documento}`
        : 'Documento não informado';
    }
    if (elements.receivablesContact) {
      elements.receivablesContact.textContent = contato
        ? `Contato: ${contato}`
        : 'Contato não informado';
    }
    if (elements.receivablesLimit) {
      if (state.receivablesCustomerLoading) {
        elements.receivablesLimit.textContent = 'Carregando...';
      } else {
        const limit =
          customer.financeiro?.limiteCredito ??
          customer.financeiro?.limite_credito ??
          customer.limiteCredito ??
          customer.limite_credito ??
          customer.creditLimit ??
          customer.limite ??
          null;
        elements.receivablesLimit.textContent =
          limit !== null && limit !== undefined
            ? formatCurrency(safeNumber(limit))
            : 'Não informado';
      }
    }
    if (elements.receivablesPending) {
      if (state.receivablesListLoading) {
        elements.receivablesPending.textContent = 'Carregando...';
      } else {
        const customerId = resolveCustomerId(customer);
        const receivables = getReceivablesForCustomer(customerId);
        const total = receivables.reduce(
          (sum, entry) => sum + safeNumber(entry.value ?? entry.valor ?? entry.amount ?? 0),
          0
        );
        elements.receivablesPending.textContent = formatCurrency(total);
      }
    }
  };

  const loadReceivablesCustomerDetails = async (cliente, { force = false } = {}) => {
    const customerId = resolveCustomerId(cliente);
    if (!customerId) {
      return;
    }
    if (!force && customerReceivablesDetailsCache.has(customerId)) {
      const cached = cloneReceivablesCustomerDetails(customerReceivablesDetailsCache.get(customerId));
      applyReceivablesCustomerDetails(customerId, cached);
      renderReceivablesSelectedCustomer();
      return;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (receivablesCustomerDetailsController) {
      receivablesCustomerDetailsController.abort();
    }
    const requestId = ++receivablesDetailsRequestSequence;
    activeReceivablesDetailsRequestId = requestId;
    receivablesCustomerDetailsController = new AbortController();
    state.receivablesCustomerLoading = true;
    renderReceivablesSelectedCustomer();
    try {
      const response = await fetch(`${API_BASE}/func/clientes/${customerId}`, {
        headers,
        signal: receivablesCustomerDetailsController.signal,
      });
      if (!response.ok) {
        throw new Error('Não foi possível carregar os detalhes do cliente.');
      }
      const payload = await response.json();
      const details = cloneReceivablesCustomerDetails(payload);
      customerReceivablesDetailsCache.set(customerId, details);
      applyReceivablesCustomerDetails(customerId, details);
      renderReceivablesSelectedCustomer();
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Erro ao carregar dados do cliente (contas a receber):', error);
      notify(
        error?.message || 'Não foi possível carregar os detalhes do cliente selecionado.',
        'error'
      );
    } finally {
      if (activeReceivablesDetailsRequestId === requestId) {
        state.receivablesCustomerLoading = false;
        receivablesCustomerDetailsController = null;
        renderReceivablesSelectedCustomer();
      }
    }
  };

  const renderReceivablesList = () => {
    if (
      !elements.receivablesList ||
      !elements.receivablesEmpty ||
      !elements.receivablesTable ||
      !elements.receivablesTotal
    ) {
      return;
    }
    renderReceivablesSelectionSummary();
    const customer = state.receivablesSelectedCustomer;
    const customerId = resolveCustomerId(customer);
    const { receivablesLoading, receivablesError } = elements;
    if (!customerId) {
      elements.receivablesList.innerHTML = '';
      elements.receivablesTable.classList.add('hidden');
      elements.receivablesEmpty.textContent =
        'Selecione um cliente para visualizar as pendências de crediário.';
      elements.receivablesEmpty.classList.remove('hidden');
      elements.receivablesTotal.textContent = formatCurrency(0);
      if (elements.receivablesPending) {
        elements.receivablesPending.textContent = formatCurrency(0);
      }
      if (receivablesLoading) {
        receivablesLoading.classList.add('hidden');
      }
      if (receivablesError) {
        receivablesError.classList.add('hidden');
      }
      return;
    }
    if (state.receivablesListLoading) {
      elements.receivablesList.innerHTML = '';
      elements.receivablesTable.classList.add('hidden');
      elements.receivablesEmpty.classList.add('hidden');
      elements.receivablesTotal.textContent = '—';
      if (elements.receivablesPending) {
        elements.receivablesPending.textContent = 'Carregando...';
      }
      if (receivablesError) {
        receivablesError.classList.add('hidden');
      }
      if (receivablesLoading) {
        receivablesLoading.textContent = 'Carregando pendências do cliente selecionado...';
        receivablesLoading.classList.remove('hidden');
      }
      return;
    }
    if (receivablesLoading) {
      receivablesLoading.classList.add('hidden');
    }
    if (state.receivablesListError) {
      elements.receivablesList.innerHTML = '';
      elements.receivablesTable.classList.add('hidden');
      elements.receivablesEmpty.classList.add('hidden');
      elements.receivablesTotal.textContent = formatCurrency(0);
      if (elements.receivablesPending) {
        elements.receivablesPending.textContent = formatCurrency(0);
      }
      if (receivablesError) {
        receivablesError.textContent = state.receivablesListError;
        receivablesError.classList.remove('hidden');
      }
      return;
    }
    if (receivablesError) {
      receivablesError.classList.add('hidden');
    }
    const receivables = getReceivablesForCustomer(customerId).map((entry) => ({ ...entry }));
    receivables.sort((a, b) => {
      const dueA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const dueB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      if (dueA && dueB && dueA !== dueB) {
        return dueA - dueB;
      }
      const parcelA = Number.parseInt(a.parcelNumber ?? a.parcela ?? a.numeroParcela, 10) || 0;
      const parcelB = Number.parseInt(b.parcelNumber ?? b.parcela ?? b.numeroParcela, 10) || 0;
      return parcelA - parcelB;
    });
    const total = receivables.reduce((sum, entry) => sum + getReceivableValue(entry), 0);
    elements.receivablesTotal.textContent = formatCurrency(total);
    if (elements.receivablesPending) {
      elements.receivablesPending.textContent = formatCurrency(total);
    }
    if (!receivables.length) {
      elements.receivablesList.innerHTML = '';
      elements.receivablesTable.classList.add('hidden');
      elements.receivablesEmpty.textContent =
        'Nenhuma pendência de crediário encontrada para este cliente.';
      elements.receivablesEmpty.classList.remove('hidden');
      return;
    }
    elements.receivablesEmpty.classList.add('hidden');
    elements.receivablesTable.classList.remove('hidden');
    elements.receivablesList.innerHTML = '';
    const selectedIds = new Set(state.receivablesSelectedIds);
    const fragment = document.createDocumentFragment();
    receivables.forEach((entry) => {
      const rawEntryId = entry.id ? String(entry.id) : createUid();
      if (!entry.id) {
        entry.id = rawEntryId;
      }
      const sanitizedId = rawEntryId.replace(/[^a-zA-Z0-9_-]/g, '');
      const checkboxId = `receivable-${sanitizedId || createUid()}`;
      const isSelected = selectedIds.has(entry.id);
      const tr = document.createElement('tr');
      tr.className = 'transition-colors hover:bg-primary/5';
      if (isSelected) {
        tr.classList.add('bg-primary/5');
      }
      const saleCode = entry.saleCode || entry.sale || '—';
      const parcel = entry.parcelNumber ?? entry.parcela ?? entry.numeroParcela ?? '—';
      const dueLabel = entry.dueDateLabel || formatDateLabel(entry.dueDate) || 'Sem vencimento';
      const valueLabel = formatCurrency(getReceivableValue(entry));
      const methodLabel = entry.paymentMethodLabel || 'Crediário';
      tr.innerHTML = `
        <td class="px-3 py-2 align-middle">
          <input id="${checkboxId}" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/50" data-receivable-select="${escapeHtml(rawEntryId)}" ${
            isSelected ? 'checked' : ''
          }>
        </td>
        <td class="px-3 py-2 whitespace-nowrap text-gray-700">
          <label for="${checkboxId}" class="cursor-pointer">${escapeHtml(saleCode || '—')}</label>
        </td>
        <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(String(parcel))}</td>
        <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(dueLabel)}</td>
        <td class="px-3 py-2 whitespace-nowrap text-gray-700">${escapeHtml(valueLabel)}</td>
        <td class="px-3 py-2">${escapeHtml(methodLabel)}</td>
      `;
      fragment.appendChild(tr);
    });
    elements.receivablesList.appendChild(fragment);
  };

  const loadReceivablesForCustomer = async (cliente, { force = false } = {}) => {
    const customerId = resolveCustomerId(cliente);
    if (!customerId) {
      state.receivablesListLoading = false;
      state.receivablesListError = '';
      renderReceivablesList();
      return;
    }
    if (!force) {
      const cached = getCachedReceivablesForCustomer(customerId);
      if (cached) {
        state.receivablesListError = '';
        mergeReceivablesForCustomer(customerId, cached);
        state.receivablesListLoading = false;
        renderReceivablesList();
        renderReceivablesSelectedCustomer();
        return;
      }
    }
    abortReceivablesCustomerFetch();
    const params = new URLSearchParams();
    params.set('customer', customerId);
    const companyId = state.activePdvStoreId || state.selectedStore || '';
    if (companyId) {
      params.set('company', companyId);
    }
    const token = getToken();
    const requestId = ++receivablesRequestSequence;
    activeReceivablesRequestId = requestId;
    receivablesCustomerController = new AbortController();
    state.receivablesListLoading = true;
    state.receivablesListError = '';
    renderReceivablesList();
    try {
      const payload = await fetchWithOptionalAuth(
        `${API_BASE}/accounts-receivable?${params.toString()}`,
        {
          token,
          signal: receivablesCustomerController.signal,
          errorMessage: 'Não foi possível carregar as contas a receber do cliente selecionado.',
        }
      );
      const flattened = flattenReceivableRecords(payload?.receivables);
      setCachedReceivablesForCustomer(customerId, flattened);
      if (resolveCustomerId(state.receivablesSelectedCustomer) === customerId) {
        mergeReceivablesForCustomer(customerId, flattened);
        state.receivablesListError = '';
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Erro ao carregar contas a receber do cliente:', error);
      if (resolveCustomerId(state.receivablesSelectedCustomer) === customerId) {
        state.receivablesListError =
          error?.message || 'Não foi possível carregar as contas a receber do cliente.';
        notify(state.receivablesListError, 'error');
      }
    } finally {
      if (activeReceivablesRequestId === requestId) {
        state.receivablesListLoading = false;
        receivablesCustomerController = null;
        renderReceivablesList();
        if (resolveCustomerId(state.receivablesSelectedCustomer) === customerId) {
          renderReceivablesSelectedCustomer();
        }
      }
    }
  };

  const setReceivablesSelectedCustomer = (cliente, { force = false } = {}) => {
    if (!cliente) {
      abortReceivablesCustomerFetch();
      state.receivablesSelectedCustomer = null;
      state.receivablesListLoading = false;
      state.receivablesListError = '';
      state.receivablesCustomerLoading = false;
      clearReceivablesPaymentContext();
      clearReceivablesSelectionState();
      renderReceivablesSelectedCustomer();
      renderReceivablesSearchResults();
      renderReceivablesList();
      return;
    }
    const previousId = resolveCustomerId(state.receivablesSelectedCustomer);
    const nextId = resolveCustomerId(cliente);
    state.receivablesSelectedCustomer = { ...cliente };
    if (previousId !== nextId) {
      clearReceivablesPaymentContext();
      clearReceivablesSelectionState();
    }
    const customerId = resolveCustomerId(cliente);
    if (customerId && customerReceivablesDetailsCache.has(customerId)) {
      const cachedDetails = cloneReceivablesCustomerDetails(
        customerReceivablesDetailsCache.get(customerId)
      );
      applyReceivablesCustomerDetails(customerId, cachedDetails);
    }
    state.receivablesCustomerLoading = Boolean(customerId) && !customerReceivablesDetailsCache.has(customerId);
    renderReceivablesSelectedCustomer();
    renderReceivablesSearchResults();
    renderReceivablesList();
    loadReceivablesForCustomer(cliente, { force });
    loadReceivablesCustomerDetails(cliente, { force });
  };

  const clearReceivablesSelection = () => {
    state.receivablesSearchLoading = false;
    setReceivablesSelectedCustomer(null);
    elements.receivablesSearchInput?.focus();
  };

  const performReceivablesSearch = async (term) => {
    const query = term.trim();
    state.receivablesSearchQuery = term;
    if (receivablesSearchController) {
      receivablesSearchController.abort();
      receivablesSearchController = null;
    }
    if (!query) {
      state.receivablesSearchResults = [];
      state.receivablesSearchLoading = false;
      renderReceivablesSearchResults();
      return;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    state.receivablesSearchLoading = true;
    renderReceivablesSearchResults();
    receivablesSearchController = new AbortController();
    try {
      const response = await fetch(
        `${API_BASE}/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=8`,
        { headers, signal: receivablesSearchController.signal }
      );
      if (!response.ok) {
        throw new Error('Não foi possível buscar clientes.');
      }
      const payload = await response.json();
      state.receivablesSearchResults = Array.isArray(payload) ? payload : [];
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Erro ao buscar clientes (contas a receber):', error);
      notify(error.message || 'Não foi possível buscar clientes.', 'error');
      state.receivablesSearchResults = [];
    } finally {
      state.receivablesSearchLoading = false;
      receivablesSearchController = null;
      renderReceivablesSearchResults();
    }
  };

  const handleReceivablesSearchInput = (event) => {
    const value = event.target.value || '';
    state.receivablesSearchQuery = value;
    if (receivablesSearchTimeout) {
      clearTimeout(receivablesSearchTimeout);
    }
    receivablesSearchTimeout = setTimeout(() => performReceivablesSearch(value), 300);
    if (!value.trim()) {
      state.receivablesSearchResults = [];
      state.receivablesSearchLoading = false;
      renderReceivablesSearchResults();
    }
  };

  const handleReceivablesResultsClick = (event) => {
    const button = event.target.closest('[data-receivables-customer-id]');
    if (!button) return;
    const id = button.getAttribute('data-receivables-customer-id');
    if (!id) return;
    const cliente = state.receivablesSearchResults.find((item) => {
      const itemId = item?._id || item?.id || '';
      return itemId && String(itemId) === id;
    });
    if (!cliente) return;
    state.receivablesSearchQuery = '';
    state.receivablesSearchResults = [];
    state.receivablesSearchLoading = false;
    if (elements.receivablesSearchInput) {
      elements.receivablesSearchInput.value = '';
    }
    setReceivablesSelectedCustomer(cliente);
    window.setTimeout(() => {
      elements.receivablesTable?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const handleReceivablesClear = () => {
    clearReceivablesSelection();
    elements.receivablesSearchInput?.focus();
  };

  const handleReceivablesListChange = (event) => {
    const checkbox = event.target.closest('input[data-receivable-select]');
    if (!checkbox) return;
    const id = checkbox.getAttribute('data-receivable-select') || '';
    if (!id) return;
    const normalizedId = String(id);
    const selectedSet = new Set(state.receivablesSelectedIds);
    if (checkbox.checked) {
      selectedSet.add(normalizedId);
    } else {
      selectedSet.delete(normalizedId);
    }
    state.receivablesSelectedIds = Array.from(selectedSet);
    if (state.activeFinalizeContext !== 'receivables') {
      state.receivablesPaymentContext = null;
      state.receivablesSaleBackup = null;
    }
    renderReceivablesSelectionSummary();
    const row = checkbox.closest('tr');
    if (row) {
      row.classList.add('transition-colors', 'hover:bg-primary/5');
      row.classList.toggle('bg-primary/5', checkbox.checked);
    }
  };

  const handleReceivablesPay = () => {
    if (state.receivablesPaymentLoading || state.activeFinalizeContext === 'receivables') {
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para registrar o recebimento.', 'warning');
      return;
    }
    if (state.paymentMethodsLoading) {
      notify('Aguarde o carregamento dos meios de pagamento.', 'info');
      return;
    }
    const hasEligibleMethod = state.paymentMethods.some(
      (method) => String(method.type || '').toLowerCase() !== 'crediario'
    );
    if (!hasEligibleMethod) {
      notify('Cadastre meios de pagamento para registrar o recebimento.', 'warning');
      return;
    }
    const selection = refreshReceivablesSelection();
    if (!selection.length) {
      notify('Selecione as parcelas do crediário que deseja receber.', 'warning');
      return;
    }
    state.receivablesSaleBackup = captureSaleStateSnapshot();
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    state.receivablesPaymentContext = {
      entries: selection.map((entry) => ({ ...entry })),
      total: state.receivablesSelectedTotal,
      customer: state.receivablesSelectedCustomer
        ? { ...state.receivablesSelectedCustomer }
        : null,
    };
    renderSalePaymentsPreview();
    openFinalizeModal('receivables');
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
      if (state.activeAppointmentId) {
        state.activeAppointmentId = '';
        renderAppointments();
      }
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

  const getSaleTotalBruto = () => {
    if (state.activeFinalizeContext === 'receivables') {
      if (state.receivablesPaymentContext?.total != null) {
        return state.receivablesPaymentContext.total;
      }
      return state.receivablesSelectedTotal || 0;
    }
    return state.itens.reduce((sum, item) => sum + item.subtotal, 0);
  };
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
    const isReceivablesContext = state.activeFinalizeContext === 'receivables';
    const availableMethods = isReceivablesContext
      ? state.paymentMethods.filter(
          (method) => String(method.type || '').toLowerCase() !== 'crediario'
        )
      : state.paymentMethods;
    if (!availableMethods.length) {
      const message = isReceivablesContext
        ? 'Cadastre meios de pagamento para registrar recebimentos de clientes.'
        : state.selectedStore
        ? 'Cadastre meios de pagamento para finalizar vendas neste PDV.'
        : 'Selecione uma empresa para carregar os meios de pagamento disponíveis.';
      elements.saleMethods.innerHTML = `<li class="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">${message}</li>`;
      return;
    }
    const html = availableMethods
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

  const resolveDeliveryOrderCustomer = (order) => {
    if (!order || typeof order !== 'object') return null;
    if (order.customerDetails && typeof order.customerDetails === 'object') {
      return { ...order.customerDetails };
    }
    const customer = order.customer && typeof order.customer === 'object' ? order.customer : {};
    const candidateId = order.customerId || resolveCustomerId(customer);
    const candidateDocument =
      order.customerDocument || customer.documento || customer.document || '';
    const candidateName =
      customer.nome || customer.nomeCompleto || customer.razaoSocial || order.customerName || '';
    const candidateContact =
      order.customerContact || customer.contato || customer.telefone || customer.celular || '';
    if (!candidateId && !candidateDocument && !candidateName && !candidateContact) {
      return null;
    }
    const reference = {};
    if (candidateId) {
      reference._id = String(candidateId);
      reference.id = reference._id;
      reference.codigo = reference.codigo || reference._id;
      reference.code = reference.code || reference._id;
    }
    if (candidateName) {
      reference.nome = candidateName;
      reference.nomeCompleto = reference.nomeCompleto || candidateName;
      reference.razaoSocial = reference.razaoSocial || candidateName;
      reference.fantasia = reference.fantasia || candidateName;
    }
    if (candidateDocument) {
      reference.documento = candidateDocument;
      const digits = String(candidateDocument).replace(/\D+/g, '');
      if (digits.length === 11) {
        reference.cpf = reference.cpf || digits;
      } else if (digits.length === 14) {
        reference.cnpj = reference.cnpj || digits;
      }
    }
    if (candidateContact) {
      if (candidateContact.includes('@')) {
        reference.email = reference.email || candidateContact;
      } else {
        reference.telefone = reference.telefone || candidateContact;
        reference.celular = reference.celular || candidateContact;
      }
    }
    return reference;
  };

  const normalizeDocumentDigits = (value) => {
    if (!value) return '';
    return String(value).replace(/\D+/g, '');
  };

  const fetchDeliveryCustomerByDocument = async (document) => {
    const normalized = (document || '').toString().trim();
    if (!normalized) {
      return null;
    }
    const query = normalizeDocumentDigits(normalized) || normalized;
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const response = await fetch(
        `${API_BASE}/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=5`,
        { headers }
      );
      if (!response.ok) {
        return null;
      }
      const payload = await response.json().catch(() => []);
      if (!Array.isArray(payload) || !payload.length) {
        return null;
      }
      const targetDigits = normalizeDocumentDigits(normalized);
      const matched = payload.find((entry) => {
        const entryDoc = resolveCustomerDocument(entry) || '';
        if (!entryDoc) return false;
        return normalizeDocumentDigits(entryDoc) === targetDigits;
      });
      if (targetDigits) {
        return matched ? { ...matched } : null;
      }
      return matched ? { ...matched } : { ...payload[0] };
    } catch (error) {
      console.error('Erro ao localizar cliente para o delivery:', error);
      return null;
    }
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
    const customerDetails = state.vendaCliente ? { ...state.vendaCliente } : null;
    const customerId = resolveCustomerId(customerDetails);
    const customerName =
      resolveCustomerName(customerDetails) ||
      clienteBase.nome ||
      state.vendaCliente?.razaoSocial ||
      state.vendaCliente?.fantasia ||
      'Cliente';
    const customerDocument =
      resolveCustomerDocument(customerDetails) ||
      clienteBase.documento ||
      state.vendaCliente?.documento ||
      '';
    const customerContact =
      state.vendaCliente?.telefone ||
      state.vendaCliente?.celular ||
      state.vendaCliente?.email ||
      clienteBase.contato ||
      '';
    const customerAddress =
      clienteBase.endereco || resolveCustomerAddressRecord(state.vendaCliente)?.formatted || '';
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
        id: customerId || '',
        nome: customerName,
        documento: customerDocument,
        contato: customerContact,
        endereco: customerAddress,
      },
      customerId: customerId || '',
      customerDocument,
      customerContact,
      customerDetails,
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
    vendaCliente: state.vendaCliente ? { ...state.vendaCliente } : null,
    vendaPet: state.vendaPet ? { ...state.vendaPet } : null,
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
    const snapshotCustomer = snapshot.vendaCliente || null;
    const snapshotPet = snapshotCustomer ? snapshot.vendaPet || null : null;
    if (snapshotCustomer || state.vendaCliente) {
      const skipRecalculate = snapshotCustomer ? Boolean(snapshot.preserveItemTotals) : false;
      setSaleCustomer(snapshotCustomer, snapshotPet, { skipRecalculate });
    }
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

  const restoreReceivablesSaleState = () => {
    if (!state.receivablesSaleBackup) return;
    applySaleStateSnapshot(state.receivablesSaleBackup);
    state.receivablesSaleBackup = null;
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
    const orderCustomer = resolveDeliveryOrderCustomer(order);
    applySaleStateSnapshot({
      itens: order.items,
      vendaPagamentos: order.payments,
      vendaDesconto: order.discount,
      vendaAcrescimo: order.addition,
      selectedProduct: null,
      quantidade: 1,
      vendaCliente: orderCustomer,
      preserveItemTotals: true,
    });
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    openFinalizeModal('delivery-complete');
  };

  const getFinalizeContextActionLabel = (context) => {
    if (context === 'orcamento') return 'salvar o orçamento';
    if (context === 'delivery') return 'registrar o delivery';
    if (context === 'delivery-complete') return 'finalizar o delivery';
    return 'finalizar a venda';
  };

  const syncFinalizeConfirmLabel = () => {
    if (!elements.finalizeConfirm) return;
    const label = elements.finalizeConfirm.textContent?.trim() || '';
    elements.finalizeConfirm.dataset.defaultLabel = label;
    if (!state.finalizeProcessing) {
      elements.finalizeConfirm.innerHTML = label;
    }
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
    } else if (context === 'receivables') {
      if (elements.finalizeTitle) {
        elements.finalizeTitle.textContent = 'Registrar recebimento';
      }
      if (elements.finalizeSubtitle) {
        elements.finalizeSubtitle.textContent =
          'Informe como o cliente pagou as parcelas selecionadas.';
      }
      if (elements.finalizeConfirm) {
        elements.finalizeConfirm.textContent = 'Confirmar recebimento';
      }
    } else if (context === 'orcamento') {
      if (elements.finalizeTitle) {
        elements.finalizeTitle.textContent = 'Finalizar orçamento';
      }
      if (elements.finalizeSubtitle) {
        elements.finalizeSubtitle.textContent =
          'Revise os meios de pagamento sugeridos antes de concluir o orçamento.';
      }
      if (elements.finalizeConfirm) {
        elements.finalizeConfirm.textContent = 'Finalizar orçamento';
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
    syncFinalizeConfirmLabel();
    const hideAdjustments = context === 'receivables';
    if (elements.saleAdjust) {
      elements.saleAdjust.classList.toggle('hidden', hideAdjustments);
      elements.saleAdjust.disabled = hideAdjustments;
      elements.saleAdjust.classList.toggle('opacity-60', hideAdjustments);
      elements.saleAdjust.classList.toggle('cursor-not-allowed', hideAdjustments);
    }
    if (elements.saleItemAdjust) {
      elements.saleItemAdjust.classList.toggle('hidden', hideAdjustments);
      elements.saleItemAdjust.disabled = hideAdjustments;
      elements.saleItemAdjust.classList.toggle('opacity-60', hideAdjustments);
      elements.saleItemAdjust.classList.toggle('cursor-not-allowed', hideAdjustments);
    }
  };

  const openFinalizeModal = (context = 'sale') => {
    const isBudget = context === 'orcamento';
    const isReceivables = context === 'receivables';
    if (!isBudget && !state.caixaAberto) {
      notify(`Abra o caixa para ${getFinalizeContextActionLabel(context)}.`, 'warning');
      return;
    }
    if (!isReceivables && !state.itens.length) {
      notify(`Adicione itens para ${getFinalizeContextActionLabel(context)}.`, 'warning');
      return;
    }
    if (!isBudget && !isReceivables && state.paymentMethodsLoading) {
      notify('Aguarde o carregamento dos meios de pagamento.', 'info');
      return;
    }
    if (!isBudget && !isReceivables && !state.paymentMethods.length) {
      notify('Cadastre meios de pagamento para concluir a operação.', 'warning');
      return;
    }
    if (context === 'delivery' && !state.deliverySelectedAddress) {
      notify('Selecione um endereço de entrega para continuar.', 'warning');
      return;
    }
    if (isReceivables) {
      const hasEligibleMethod = state.paymentMethods.some(
        (method) => String(method.type || '').toLowerCase() !== 'crediario'
      );
      if (state.paymentMethodsLoading) {
        notify('Aguarde o carregamento dos meios de pagamento.', 'info');
        return;
      }
      if (!hasEligibleMethod) {
        notify('Cadastre meios de pagamento para registrar o recebimento.', 'warning');
        return;
      }
      const selection = refreshReceivablesSelection();
      if (
        !state.receivablesPaymentContext ||
        !Array.isArray(state.receivablesPaymentContext.entries) ||
        !state.receivablesPaymentContext.entries.length ||
        !selection.length
      ) {
        notify('Selecione as parcelas do crediário que deseja receber.', 'warning');
        return;
      }
      resetReceivablesResidualState();
      state.receivablesPaymentContext.total =
        state.receivablesPaymentContext.total ?? state.receivablesSelectedTotal;
      state.receivablesPaymentContext.entries = selection.map((entry) => ({ ...entry }));
    }
    state.activeFinalizeContext = context;
    applyFinalizeModalContext(context);
    renderSalePaymentMethods();
    renderSalePaymentsPreview();
    updateSaleSummary();
    renderReceivablesSelectionSummary();
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
    if (state.finalizeProcessing) {
      setFinalizeProcessing(false);
    }
    elements.finalizeModal.classList.add('hidden');
    closePaymentValueModal(true);
    if (!elements.deliveryAddressModal || elements.deliveryAddressModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
    if (context === 'orcamento') {
      state.pendingBudgetValidityDays = null;
    }
    if (context === 'delivery-complete') {
      state.deliveryFinalizingOrderId = '';
      restoreSaleStateFromBackup();
    }
    if (context === 'receivables') {
      restoreReceivablesSaleState();
      clearReceivablesPaymentContext();
      resetReceivablesResidualState();
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

  const getCrediarioInstallmentsTotal = () =>
    state.crediarioInstallments.reduce((sum, installment) => sum + safeNumber(installment.valor), 0);

  const getCrediarioRemainingAmount = () => {
    const total = getSaleTotalLiquido();
    const currentPaid = getSalePagoTotal();
    const allocated = getCrediarioInstallmentsTotal();
    const remaining = total - (currentPaid + allocated);
    return remaining < 0 ? 0 : remaining;
  };

  const updateCrediarioTotals = () => {
    if (elements.crediarioTotal) {
      const total = getCrediarioInstallmentsTotal();
      elements.crediarioTotal.textContent = `Total: ${formatCurrency(total)}`;
    }
    if (elements.crediarioRemaining) {
      const remaining = getCrediarioRemainingAmount();
      const hasRemaining = remaining > 0.009;
      const normalized = hasRemaining ? remaining : 0;
      elements.crediarioRemaining.textContent = formatCurrency(normalized);
      elements.crediarioRemaining.classList.toggle('text-emerald-600', !hasRemaining);
      elements.crediarioRemaining.classList.toggle('text-gray-800', hasRemaining);
      if (elements.crediarioRemainingStatus) {
        elements.crediarioRemainingStatus.textContent = hasRemaining
          ? 'Distribua o valor para prosseguir.'
          : 'Tudo certo! Nenhum valor restante.';
        elements.crediarioRemainingStatus.classList.toggle('text-emerald-600', !hasRemaining);
        elements.crediarioRemainingStatus.classList.toggle('text-gray-500', hasRemaining);
      }
    }
    if (elements.crediarioAddButton) {
      const remaining = getCrediarioRemainingAmount();
      const disabled = remaining <= 0.009;
      elements.crediarioAddButton.disabled = disabled;
      elements.crediarioAddButton.classList.toggle('opacity-60', disabled);
      elements.crediarioAddButton.classList.toggle('cursor-not-allowed', disabled);
    }
  };

  const updateCrediarioCustomerSummary = () => {
    if (!elements.crediarioCustomerName || !elements.crediarioCustomerDoc) {
      return;
    }
    const customer = state.vendaCliente;
    if (!customer) {
      elements.crediarioCustomerName.textContent = 'Nenhum cliente selecionado';
      elements.crediarioCustomerDoc.textContent = 'Selecione um cliente para continuar.';
      if (elements.crediarioLimit) elements.crediarioLimit.textContent = '—';
      if (elements.crediarioPending) elements.crediarioPending.textContent = '—';
      if (elements.crediarioFidelity) elements.crediarioFidelity.textContent = 'Em desenvolvimento';
      return;
    }
    const name = resolveCustomerName(customer) || 'Cliente selecionado';
    const document = resolveCustomerDocument(customer);
    elements.crediarioCustomerName.textContent = name;
    elements.crediarioCustomerDoc.textContent = document
      ? `Documento: ${document}`
      : 'Documento não informado.';
    const limitValue =
      customer.financeiro?.limiteCredito ??
      customer.financeiro?.limite_credito ??
      customer.limiteCredito ??
      customer.limite_credito ??
      customer.creditLimit ??
      customer.limite ??
      null;
    const pendingValue =
      customer.pendencias ?? customer.saldoDevedor ?? customer.debitos ?? customer.emAberto ?? null;
    if (elements.crediarioLimit) {
      elements.crediarioLimit.textContent =
        limitValue !== null && limitValue !== undefined
          ? formatCurrency(safeNumber(limitValue))
          : 'Não informado';
    }
    if (elements.crediarioPending) {
      elements.crediarioPending.textContent =
        pendingValue !== null && pendingValue !== undefined
          ? formatCurrency(safeNumber(pendingValue))
          : 'Sem pendências registradas';
    }
    if (elements.crediarioFidelity) {
      const fidelity = customer.fidelidade ?? customer.fidelity ?? null;
      elements.crediarioFidelity.textContent = fidelity ? String(fidelity) : 'Em desenvolvimento';
    }
  };

  const populateCrediarioMethodOptions = () => {
    if (!elements.crediarioMethodSelect) return;
    const available = state.paymentMethods.filter(
      (method) => method.type !== 'crediario' && method.id !== (state.crediarioModalMethod?.id || '')
    );
    if (!available.length) {
      elements.crediarioMethodSelect.innerHTML =
        '<option value="">Nenhum meio de pagamento disponível</option>';
      elements.crediarioMethodSelect.disabled = true;
      return;
    }
    const previous = elements.crediarioMethodSelect.value;
    const options = available
      .map((method) => `<option value="${method.id}">${escapeHtml(method.label)}</option>`)
      .join('');
    elements.crediarioMethodSelect.innerHTML = options;
    if (previous && available.some((method) => method.id === previous)) {
      elements.crediarioMethodSelect.value = previous;
    } else {
      elements.crediarioMethodSelect.selectedIndex = 0;
    }
    elements.crediarioMethodSelect.disabled = false;
  };

  const updateCrediarioInputs = () => {
    if (elements.crediarioParcelInput) {
      elements.crediarioParcelInput.value = String(state.crediarioNextParcelNumber);
    }
    const remaining = getCrediarioRemainingAmount();
    if (elements.crediarioValueInput) {
      elements.crediarioValueInput.value = remaining > 0.009 ? remaining.toFixed(2) : '';
    }
    if (elements.crediarioDateInput) {
      const fallback = formatDateParam(new Date());
      const last = state.crediarioLastDate || fallback;
      elements.crediarioDateInput.value = last;
    }
    updateCrediarioTotals();
  };

  const renderCrediarioInstallments = () => {
    if (!elements.crediarioList) return;
    elements.crediarioList.innerHTML = '';
    if (!state.crediarioInstallments.length) {
      elements.crediarioList.classList.add('hidden');
      elements.crediarioListEmpty?.classList.remove('hidden');
      elements.crediarioListHead?.classList.add('hidden');
      updateCrediarioTotals();
      return;
    }
    const fragment = document.createDocumentFragment();
    const sorted = [...state.crediarioInstallments].sort(
      (a, b) => (Number(a.parcela) || 0) - (Number(b.parcela) || 0)
    );
    sorted.forEach((installment) => {
      const li = document.createElement('li');
      li.className =
        'space-y-3 rounded-xl border border-gray-200 bg-white/95 p-4 text-sm text-gray-700 shadow-sm transition hover:border-primary/40 hover:shadow-md';
      const label = installment.methodLabel || 'Meio de pagamento';
      const dueDateLabel =
        installment.dueDateLabel || formatDateLabel(installment.dueDate) || '—';
      const formattedValue = formatCurrency(safeNumber(installment.valor));
      li.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <span class="block text-sm font-semibold leading-tight text-gray-800">Parcela ${
              installment.parcela || 1
            }</span>
            <span class="inline-flex items-center gap-1.5 text-xs text-gray-500 leading-tight">
              <i class="fas fa-credit-card text-[10px] text-gray-400"></i>
              <span class="break-words">${escapeHtml(label)}</span>
            </span>
          </div>
          <button type="button" class="flex h-7 w-7 items-center justify-center rounded-full border border-red-100 bg-red-50 text-[11px] text-red-500 transition hover:bg-red-100" data-crediario-remove="${
            installment.uid
          }" aria-label="Remover parcela">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
            <i class="fas fa-calendar-day text-[10px] text-gray-400"></i>
            ${escapeHtml(dueDateLabel)}
          </span>
          <span class="ml-auto text-base font-semibold text-gray-800">${formattedValue}</span>
        </div>
      `;
      fragment.appendChild(li);
    });
    elements.crediarioList.appendChild(fragment);
    elements.crediarioList.classList.remove('hidden');
    elements.crediarioListEmpty?.classList.add('hidden');
    elements.crediarioListHead?.classList.remove('hidden');
    updateCrediarioTotals();
  };

  const restoreCrediarioEditingPayment = () => {
    if (!state.crediarioEditingPayment) return;
    const payment = state.crediarioEditingPayment;
    const index = Number.isInteger(state.crediarioEditingIndex)
      ? state.crediarioEditingIndex
      : -1;
    if (index >= 0 && index <= state.vendaPagamentos.length) {
      state.vendaPagamentos.splice(index, 0, payment);
    } else {
      state.vendaPagamentos.push(payment);
    }
    state.crediarioEditingPayment = null;
    state.crediarioEditingIndex = -1;
    renderSalePaymentsPreview();
  };

  const resetCrediarioState = () => {
    state.crediarioInstallments = [];
    state.crediarioNextParcelNumber = 1;
    state.crediarioLastDate = formatDateParam(new Date());
    state.crediarioModalMethod = null;
  };

  const openCrediarioModal = (method, { resume = false } = {}) => {
    if (!elements.crediarioModal || !method) return;
    if (!resume) {
      resetCrediarioState();
      state.crediarioModalMethod = { ...method };
      const existingIndex = state.vendaPagamentos.findIndex(
        (payment) =>
          payment.id === method.id &&
          (payment.type === 'crediario' || (payment.crediarioData && payment.crediarioData.installments))
      );
      if (existingIndex >= 0) {
        const existing = state.vendaPagamentos.splice(existingIndex, 1)[0];
        state.crediarioEditingPayment = existing;
        state.crediarioEditingIndex = existingIndex;
        const installments = Array.isArray(existing.crediarioData?.installments)
          ? existing.crediarioData.installments
          : [];
        state.crediarioInstallments = installments.map((item, index) => {
          const parcela = Number.parseInt(item.parcela, 10);
          const dueDate = item.dueDate || item.vencimento || '';
          return {
            uid: createUid(),
            parcela: Number.isFinite(parcela) ? parcela : index + 1,
            valor: safeNumber(item.valor ?? item.value ?? item.amount ?? 0),
            methodId: item.methodId || item.paymentMethodId || method.id,
            methodLabel: item.methodLabel || item.paymentMethodLabel || method.label,
            dueDate,
            dueDateLabel: item.dueDateLabel || formatDateLabel(dueDate),
          };
        });
        if (state.crediarioInstallments.length) {
          const highest = Math.max(
            ...state.crediarioInstallments.map((item, index) =>
              Number.isFinite(Number(item.parcela)) ? Number(item.parcela) : index + 1
            )
          );
          state.crediarioNextParcelNumber = Math.max(highest + 1, state.crediarioInstallments.length + 1);
          const last = state.crediarioInstallments[state.crediarioInstallments.length - 1];
          if (last?.dueDate) {
            const parsed = new Date(last.dueDate);
            state.crediarioLastDate = Number.isNaN(parsed.getTime())
              ? formatDateParam(new Date())
              : formatDateParam(parsed);
          }
        }
        renderSalePaymentsPreview();
      }
    }
    state.crediarioModalOpen = true;
    populateCrediarioMethodOptions();
    updateCrediarioCustomerSummary();
    renderCrediarioInstallments();
    updateCrediarioInputs();
    if (elements.crediarioError) {
      elements.crediarioError.classList.add('hidden');
      elements.crediarioError.textContent = '';
    }
    elements.crediarioModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    window.setTimeout(() => {
      elements.crediarioValueInput?.focus();
      elements.crediarioValueInput?.select?.();
    }, 120);
  };

  const closeCrediarioModal = ({ restorePayment = false } = {}) => {
    if (!elements.crediarioModal) return;
    elements.crediarioModal.classList.add('hidden');
    state.crediarioModalOpen = false;
    if (restorePayment) {
      restoreCrediarioEditingPayment();
    } else {
      state.crediarioEditingPayment = null;
      state.crediarioEditingIndex = -1;
    }
    if (
      (!elements.finalizeModal || elements.finalizeModal.classList.contains('hidden')) &&
      (!elements.customerModal || elements.customerModal.classList.contains('hidden')) &&
      (!elements.paymentValueModal || elements.paymentValueModal.classList.contains('hidden'))
    ) {
      document.body.classList.remove('overflow-hidden');
    }
  };

  const handleCrediarioAddInstallment = () => {
    if (!state.crediarioModalMethod) return;
    if (!elements.crediarioMethodSelect) return;
    const methodId = elements.crediarioMethodSelect.value;
    const method = state.paymentMethods.find((item) => item.id === methodId);
    if (!method) {
      notify('Selecione um meio de pagamento para a parcela.', 'warning');
      elements.crediarioMethodSelect.focus();
      return;
    }
    const dateValue = elements.crediarioDateInput?.value || '';
    const parsedDate = parseDateInputValue(dateValue);
    if (!parsedDate) {
      notify('Informe uma data válida para o vencimento.', 'warning');
      elements.crediarioDateInput?.focus();
      return;
    }
    const value = safeNumber(elements.crediarioValueInput?.value || 0);
    if (!(value > 0)) {
      notify('Informe um valor válido para a parcela.', 'warning');
      elements.crediarioValueInput?.focus();
      return;
    }
    const remaining = getCrediarioRemainingAmount();
    if (value - remaining > 0.009) {
      notify('O valor informado ultrapassa o restante da venda.', 'warning');
      elements.crediarioValueInput?.focus();
      return;
    }
    const dueDate = toStartOfDay(parsedDate);
    const dueDateIso = dueDate ? dueDate.toISOString() : null;
    const parcelNumber = state.crediarioNextParcelNumber;
    state.crediarioInstallments.push({
      uid: createUid(),
      parcela: parcelNumber,
      valor: value,
      methodId: method.id,
      methodLabel: method.label,
      dueDate: dueDateIso,
      dueDateLabel: formatDateLabel(dueDateIso),
    });
    state.crediarioNextParcelNumber += 1;
    const nextDate = addDays(parsedDate, 30) || parsedDate;
    state.crediarioLastDate = formatDateParam(nextDate);
    if (elements.crediarioError) {
      elements.crediarioError.classList.add('hidden');
      elements.crediarioError.textContent = '';
    }
    renderCrediarioInstallments();
    updateCrediarioInputs();
  };

  const handleCrediarioListClick = (event) => {
    const button = event.target.closest('[data-crediario-remove]');
    if (!button) return;
    const uid = button.getAttribute('data-crediario-remove');
    state.crediarioInstallments = state.crediarioInstallments.filter((item) => item.uid !== uid);
    if (!state.crediarioInstallments.length) {
      state.crediarioNextParcelNumber = 1;
      state.crediarioLastDate = formatDateParam(new Date());
    } else {
      const highest = Math.max(
        ...state.crediarioInstallments.map((item, index) =>
          Number.isFinite(Number(item.parcela)) ? Number(item.parcela) : index + 1
        )
      );
      state.crediarioNextParcelNumber = Math.max(highest + 1, state.crediarioInstallments.length + 1);
      const last = state.crediarioInstallments[state.crediarioInstallments.length - 1];
      if (last?.dueDate) {
        const parsed = new Date(last.dueDate);
        state.crediarioLastDate = Number.isNaN(parsed.getTime())
          ? formatDateParam(new Date())
          : formatDateParam(parsed);
      } else {
        state.crediarioLastDate = formatDateParam(new Date());
      }
    }
    renderCrediarioInstallments();
    updateCrediarioInputs();
  };

  const handleCrediarioConfirm = () => {
    if (!state.crediarioModalMethod) {
      notify('Selecione um meio de pagamento de crediário.', 'warning');
      return;
    }
    if (!state.vendaCliente) {
      if (elements.crediarioError) {
        elements.crediarioError.textContent = 'Selecione um cliente para registrar o crediário.';
        elements.crediarioError.classList.remove('hidden');
      }
      notify('Selecione um cliente para vincular o crediário.', 'warning');
      return;
    }
    if (!state.crediarioInstallments.length) {
      notify('Adicione ao menos uma parcela para o crediário.', 'warning');
      return;
    }
    const remaining = getCrediarioRemainingAmount();
    if (remaining > 0.009) {
      notify('Distribua todo o valor da venda entre as parcelas do crediário.', 'warning');
      return;
    }
    const total = getCrediarioInstallmentsTotal();
    const installments = state.crediarioInstallments.map((installment) => ({
      parcela: installment.parcela,
      valor: safeNumber(installment.valor),
      methodId: installment.methodId,
      methodLabel: installment.methodLabel,
      dueDate: installment.dueDate,
      dueDateLabel: installment.dueDateLabel,
    }));
    const customerId =
      state.vendaCliente._id || state.vendaCliente.id || state.vendaCliente.codigo || state.vendaCliente.code || '';
    const paymentEntry = {
      uid: createUid(),
      id: state.crediarioModalMethod.id,
      label: state.crediarioModalMethod.label,
      parcelas: installments.length,
      valor: total,
      type: 'crediario',
      crediarioData: {
        clienteId: customerId ? String(customerId) : '',
        clienteNome: resolveCustomerName(state.vendaCliente) || '',
        installments,
      },
    };
    state.vendaPagamentos.push(paymentEntry);
    renderSalePaymentsPreview();
    updateSaleSummary();
    closeCrediarioModal({ restorePayment: false });
    resetCrediarioState();
  };

  const handleCrediarioCancel = () => {
    closeCrediarioModal({ restorePayment: true });
    resetCrediarioState();
  };

  const handleCrediarioCustomerSelect = () => {
    if (elements.crediarioError) {
      elements.crediarioError.classList.add('hidden');
      elements.crediarioError.textContent = '';
    }
    openCustomerModal();
  };

  const handleSaleMethodsClick = async (event) => {
    const requiresItems = state.activeFinalizeContext !== 'receivables';
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
      if (method.type === 'crediario') {
        if (state.activeFinalizeContext === 'receivables') {
          notify('Utilize meios de pagamento à vista para registrar o recebimento.', 'info');
          return;
        }
        if (requiresItems && !state.itens.length) {
          notify('Adicione itens para lançar pagamentos.', 'warning');
          return;
        }
        openCrediarioModal(method);
        return;
      }
      if (requiresItems && !state.itens.length) {
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
    if (method.type === 'crediario') {
      if (state.activeFinalizeContext === 'receivables') {
        notify('Utilize meios de pagamento à vista para registrar o recebimento.', 'info');
        return;
      }
      if (requiresItems && !state.itens.length) {
        notify('Adicione itens para lançar pagamentos.', 'warning');
        return;
      }
      openCrediarioModal(method);
      return;
    }
    const parcelasAttr = methodButton.getAttribute('data-sale-parcelas');
    const parcelas = Math.max(1, Number(parcelasAttr) || 1);
    if (requiresItems && !state.itens.length) {
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

  const openBudgetModal = () => {
    if (!elements.budgetModal) return;
    const activeBudget = state.activeBudgetId
      ? findBudgetById(state.activeBudgetId)
      : state.selectedBudgetId
      ? findBudgetById(state.selectedBudgetId)
      : null;
    const defaultDays = state.pendingBudgetValidityDays ?? activeBudget?.validityDays ?? DEFAULT_BUDGET_VALIDITY_DAYS;
    const clamped = clampBudgetValidityDays(defaultDays);
    if (elements.budgetModalInput) {
      elements.budgetModalInput.value = String(clamped);
      elements.budgetModalInput.focus();
      elements.budgetModalInput.select?.();
    }
    if (elements.budgetModalError) {
      elements.budgetModalError.classList.add('hidden');
    }
    elements.budgetModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  };

  const closeBudgetModal = ({ preserveValidity = false } = {}) => {
    if (!elements.budgetModal) return;
    elements.budgetModal.classList.add('hidden');
    if (!preserveValidity) {
      state.pendingBudgetValidityDays = null;
    }
    if (elements.budgetModalError) {
      elements.budgetModalError.classList.add('hidden');
    }
    document.body.classList.remove('overflow-hidden');
  };

  const confirmBudgetValidity = () => {
    const rawValue = Number(elements.budgetModalInput?.value || DEFAULT_BUDGET_VALIDITY_DAYS);
    if (!Number.isFinite(rawValue) || rawValue < 1 || rawValue > 365) {
      elements.budgetModalError?.classList.remove('hidden');
      return;
    }
    if (elements.budgetModalError) {
      elements.budgetModalError.classList.add('hidden');
    }
    state.pendingBudgetValidityDays = clampBudgetValidityDays(rawValue);
    closeBudgetModal({ preserveValidity: true });
    openFinalizeModal('orcamento');
  };

  const handleBudgetAction = () => {
    if (!state.itens.length) {
      notify('Adicione itens para salvar o orçamento.', 'warning');
      return;
    }
    if (!state.vendaCliente) {
      notify('Vincule um cliente para salvar o orçamento.', 'warning');
      return;
    }
    openBudgetModal();
  };

  const handleBudgetPresetClick = (event) => {
    const button = event.target.closest('[data-budget-preset]');
    if (!button) return;
    event.preventDefault();
    const preset = button.getAttribute('data-budget-preset');
    if (!preset) return;
    state.budgetFilters = { preset, start: '', end: '' };
    renderBudgets();
  };

  const handleBudgetDateChange = () => {
    const startInput = elements.budgetStart;
    const endInput = elements.budgetEnd;
    let startValue = startInput?.value || '';
    let endValue = endInput?.value || '';
    const startDate = parseDateInputValue(startValue || '');
    const endDate = parseDateInputValue(endValue || '');
    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      const temp = startValue;
      startValue = endValue;
      endValue = temp;
    }
    state.budgetFilters = {
      preset: startValue || endValue ? 'custom' : 'todos',
      start: startValue,
      end: endValue,
    };
    renderBudgets();
  };

  const handleBudgetListClick = (event) => {
    const row = event.target.closest('tr[data-budget-id]');
    if (!row) return;
    const budgetId = row.getAttribute('data-budget-id');
    if (!budgetId || state.selectedBudgetId === budgetId) return;
    state.selectedBudgetId = budgetId;
    renderBudgets();
  };

  const handleBudgetImport = () => {
    const budget = findBudgetById(state.selectedBudgetId);
    if (!budget) {
      notify('Selecione um orçamento para importar.', 'info');
      return;
    }
    if (isBudgetFinalized(budget)) {
      notify('Este orçamento já foi finalizado e não pode ser importado novamente.', 'info');
      return;
    }
    state.activeBudgetId = budget.id;
    state.pendingBudgetValidityDays = clampBudgetValidityDays(budget.validityDays);
    applySaleStateSnapshot({
      itens: Array.isArray(budget.items) ? budget.items.map((item) => ({ ...item })) : [],
      vendaPagamentos: Array.isArray(budget.payments)
        ? budget.payments.map((payment) => ({ ...payment }))
        : [],
      vendaDesconto: safeNumber(budget.discount ?? 0),
      vendaAcrescimo: safeNumber(budget.addition ?? 0),
      selectedProduct: null,
      quantidade: 1,
    });
    state.vendaCliente = budget.customer ? { ...budget.customer } : null;
    state.vendaPet = budget.pet ? { ...budget.pet } : null;
    updateSaleCustomerSummary();
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    clearSaleSearchAreas();
    const nowIso = new Date().toISOString();
    budget.importedAt = nowIso;
    budget.updatedAt = nowIso;
    renderBudgets();
    scheduleStatePersist();
    notify('Orçamento importado para o PDV. Finalize a venda ou salve novamente para atualizar.', 'success');
    setActiveTab('pdv-tab');
  };

  const handleBudgetDelete = () => {
    const budget = findBudgetById(state.selectedBudgetId);
    if (!budget) {
      notify('Selecione um orçamento para excluir.', 'info');
      return;
    }
    const confirmed = window.confirm(`Deseja realmente excluir o orçamento ${budget.code}?`);
    if (!confirmed) return;
    state.budgets = state.budgets.filter((item) => item.id !== budget.id);
    if (state.activeBudgetId === budget.id) {
      state.activeBudgetId = '';
      state.pendingBudgetValidityDays = null;
    }
    state.selectedBudgetId = '';
    renderBudgets();
    scheduleStatePersist({ immediate: true });
    notify('Orçamento excluído com sucesso.', 'success');
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

  const methodAllowsChange = (method) => {
    if (!method) return false;
    const raw = method.raw || {};
    if (typeof raw.permiteTroco === 'boolean') {
      return raw.permiteTroco;
    }
    if (typeof raw.allowChange === 'boolean') {
      return raw.allowChange;
    }
    const type = String(method.type || '').toLowerCase();
    if (['dinheiro', 'cash', 'especie'].includes(type)) {
      return true;
    }
    if (['credito', 'debito', 'pix', 'boleto', 'transferencia'].includes(type)) {
      return false;
    }
    const normalize = (value) => String(value || '').toLowerCase();
    const label = normalize(method.label);
    const labelAllows = /(dinheiro|esp[eé]cie|cash|moeda)/.test(label);
    if (labelAllows) {
      return true;
    }
    const aliasAllows = Array.isArray(method.aliases)
      ? method.aliases.some((alias) => /(dinheiro|esp[eé]cie|cash|moeda)/.test(normalize(alias)))
      : false;
    if (aliasAllows) {
      return true;
    }
    const rawName = normalize(raw.nome || raw.name || raw.label || '');
    return /(dinheiro|esp[eé]cie|cash|moeda)/.test(rawName);
  };

  const applyPaymentsToCaixa = ({ payments = [], total = 0, historyAction = null, paymentLabel = '' } = {}) => {
    if (!state.caixaAberto || !Array.isArray(payments) || !payments.length) {
      return [];
    }
    const totalPaid = payments.reduce((sum, payment) => sum + safeNumber(payment.valor), 0);
    let remainingChange = Math.max(0, totalPaid - safeNumber(total));
    const processed = [];
    const contributionsMap = new Map();

    const recordContribution = (method, amount) => {
      if (!method || amount === 0) return;
      const paymentId = method.id || method.raw?._id || '';
      const paymentType = String(method.type || method.raw?.tipo || method.raw?.type || '')
        .toLowerCase()
        .trim();
      const key = paymentId || method.label || method.raw?.nome || Math.random().toString(16).slice(2);
      if (!contributionsMap.has(key)) {
        contributionsMap.set(key, {
          paymentId: paymentId || '',
          paymentLabel: method.label || method.raw?.nome || 'Pagamento',
          paymentType,
          amount: 0,
        });
      }
      const entry = contributionsMap.get(key);
      entry.amount += amount;
    };

    payments.forEach((payment) => {
      const amount = safeNumber(payment.valor);
      if (!(amount > 0)) {
        return;
      }
      let method = state.pagamentos.find((item) => item.id === payment.id);
      if (!method) {
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
        method = { ...base, valor: 0 };
        state.pagamentos.push(method);
      }
      const paymentType = String(payment.type || method?.type || '').toLowerCase();
      if (paymentType === 'crediario') {
        method.valor += amount;
        recordContribution(method, amount);
        processed.push(method);
        return;
      }
      let valueToRegister = amount;
      if (remainingChange > 0 && methodAllowsChange(method)) {
        const deduction = Math.min(remainingChange, valueToRegister);
        valueToRegister -= deduction;
        remainingChange -= deduction;
      }
      method.valor += valueToRegister;
      recordContribution(method, valueToRegister);
      processed.push(method);
    });
    if (remainingChange > 0 && processed.length) {
      const fallbackEntry = processed.find((method) => methodAllowsChange(method)) || processed[0];
      if (fallbackEntry) {
        const deduction = Math.min(remainingChange, fallbackEntry.valor);
        fallbackEntry.valor = Math.max(0, fallbackEntry.valor - deduction);
        recordContribution(fallbackEntry, -deduction);
        remainingChange -= deduction;
      }
    }
    renderPayments();
    if (historyAction) {
      addHistoryEntry(historyAction, total, '', paymentLabel);
    }
    updateStatusBadge();
    return Array.from(contributionsMap.values()).filter((entry) => entry.amount !== 0);
  };

  const registerSaleOnCaixa = (payments, total, saleCode = '') => {
    const paymentsSummary = describeSalePayments(payments);
    const historyPaymentLabel = [saleCode, paymentsSummary].filter(Boolean).join(' • ');
    const historyAction = {
      id: 'venda',
      label: saleCode ? `Venda ${saleCode} finalizada` : 'Venda finalizada',
    };
    return applyPaymentsToCaixa({ payments, total, historyAction, paymentLabel: historyPaymentLabel });
  };

  const registerReceivablesOnCaixa = (payments, total, customer = null) => {
    const historyAction = { id: 'recebimento-cliente', label: 'Recebimentos de Cliente' };
    const customerName =
      resolveCustomerName(customer) ||
      resolveCustomerName(state.receivablesSelectedCustomer) ||
      PDV_NO_CUSTOMER_LABEL;
    const paymentsSummary = describeSalePayments(payments);
    const historyPaymentLabel = [customerName, paymentsSummary].filter(Boolean).join(' • ');
    applyPaymentsToCaixa({ payments, total, historyAction, paymentLabel: historyPaymentLabel });
    const receivedValue = safeNumber(total);
    if (receivedValue > 0) {
      state.summary.recebimentosCliente = safeNumber(state.summary.recebimentosCliente) + receivedValue;
      updateSummary();
    }
  };

  const buildReceivablesPaymentOperations = (entries, payments, options = {}) => {
    const methodMap = new Map(state.paymentMethods.map((method) => [method.id, method]));
    const allocations = payments
      .map((payment) => {
        const method =
          methodMap.get(payment.id) ||
          state.paymentMethods.find((item) => item.label === payment.label);
        const rawId = method?.raw?._id ? String(method.raw._id) : method?.id || payment.id || '';
        return {
          paymentMethodId: rawId,
          remainingCents: Math.round(safeNumber(payment.valor) * 100),
        };
      })
      .filter((allocation) => allocation.remainingCents > 0);
    if (!allocations.length) {
      throw new Error('Informe as formas de pagamento recebidas.');
    }
    const operations = [];
    const processedEntries = [];
    const residualDue = typeof options.residualDueDate === 'string' ? options.residualDueDate : '';
    let residualProcessed = false;
    let residualTotalValue = 0;
    for (const entry of entries) {
      const accountIdSource = entry.accountReceivableId || entry.receivableId || '';
      const accountId = accountIdSource ? String(accountIdSource) : '';
      const installmentRaw =
        entry.installmentNumber ?? entry.parcelNumber ?? entry.numeroParcela ?? entry.parcela;
      const installmentNumber = Number.parseInt(installmentRaw, 10);
      const amountCents = Math.round(getReceivableValue(entry) * 100);
      if (!accountId || !Number.isFinite(installmentNumber) || !(amountCents > 0)) {
        throw new Error('Não foi possível identificar as parcelas selecionadas para o recebimento.');
      }
      const hasAvailableAllocation = allocations.some((item) => item.remainingCents > 0);
      if (!hasAvailableAllocation) {
        break;
      }
      let allocatedCents = 0;
      const usedMethods = new Set();
      while (allocatedCents < amountCents) {
        const allocation = allocations.find((item) => item.remainingCents > 0);
        if (!allocation) {
          break;
        }
        const portionCents = Math.min(allocation.remainingCents, amountCents - allocatedCents);
        if (portionCents <= 0) {
          break;
        }
        allocation.remainingCents -= portionCents;
        allocatedCents += portionCents;
        if (allocation.paymentMethodId) {
          usedMethods.add(allocation.paymentMethodId);
        }
        if (allocatedCents >= amountCents) {
          break;
        }
      }
      if (allocatedCents <= 0) {
        continue;
      }
      const missingCents = Math.max(amountCents - allocatedCents, 0);
      let residualValue = 0;
      let residualDueDate = '';
      if (missingCents > RECEIVABLES_RESIDUAL_THRESHOLD * 100) {
        if (residualProcessed) {
          throw new Error('Distribua o valor recebido entre as parcelas selecionadas.');
        }
        residualValue = missingCents / 100;
        residualDueDate = residualDue;
        if (!residualDueDate) {
          throw new Error('Informe uma nova data de vencimento para o resíduo.');
        }
        residualProcessed = true;
        residualTotalValue = residualValue;
      }
      const methodId = usedMethods.size === 1 ? Array.from(usedMethods)[0] : '';
      operations.push({
        accountId,
        installmentNumber,
        paidValue: allocatedCents / 100,
        paymentMethodId: methodId || undefined,
        residualValue,
        residualDueDate: residualValue > RECEIVABLES_RESIDUAL_THRESHOLD ? residualDueDate : undefined,
        entryId: entry.id,
      });
      processedEntries.push(entry);
      if (missingCents > 0) {
        break;
      }
    }
    if (!operations.length) {
      throw new Error('Informe as formas de pagamento recebidas.');
    }
    return { operations, processedEntries, residualValue: residualTotalValue };
  };

  const buildSaleReceivables = ({
    payments = [],
    customer = null,
    saleCode = '',
    items = [],
    saleDate = new Date(),
  } = {}) => {
    if (!Array.isArray(payments) || !payments.length) {
      return { entries: [], backendRequests: [], saleDate: new Date().toISOString() };
    }

    const contaCorrente = state.financeSettings?.contaCorrente || null;
    const contaContabil = state.financeSettings?.contaContabilReceber || null;
    const fallbackCustomerId =
      customer?._id || customer?.id || customer?.codigo || customer?.code || '';
    const fallbackCustomerName = resolveCustomerName(customer) || PDV_NO_CUSTOMER_LABEL;
    const fallbackCustomerDocument = resolveCustomerDocument(customer) || '';

    const saleDateObj = saleDate instanceof Date ? saleDate : new Date(saleDate || Date.now());
    const saleDateIso = saleDateObj.toISOString();

    const methodMap = new Map(state.paymentMethods.map((method) => [method.id, method]));
    const receivables = [];
    const backendRequests = [];

    const toDateValue = (value) => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    };

    const addDays = (base, days) => {
      const reference = base instanceof Date ? new Date(base.getTime()) : new Date();
      const offset = parsePrazoDays(days);
      if (!Number.isFinite(offset) || !offset) {
        return reference;
      }
      reference.setDate(reference.getDate() + offset);
      return reference;
    };

    const createInstallmentEntry = ({
      parcelNumber,
      value,
      dueDate,
      paymentMethodId,
      paymentMethodLabel,
      paymentMethodType,
      salePaymentId,
      clienteId,
      clienteNome,
    }) => {
      const dueIso = dueDate ? dueDate.toISOString() : null;
      return {
        id: createUid(),
        parcelNumber,
        installmentNumber: parcelNumber,
        value,
        formattedValue: formatCurrency(value),
        dueDate: dueIso,
        dueDateLabel: formatDateLabel(dueIso),
        paymentMethodId: paymentMethodId || '',
        paymentMethodLabel: paymentMethodLabel || 'Pagamento',
        paymentMethodType,
        contaCorrente: contaCorrente ? { ...contaCorrente } : null,
        contaContabil: contaContabil ? { ...contaContabil } : null,
        saleCode: saleCode || '',
        crediarioMethodId: paymentMethodType === 'crediario' ? paymentMethodId || salePaymentId || '' : '',
        clienteId: clienteId ? String(clienteId) : '',
        clienteNome,
        origin: 'sale',
        salePaymentId,
        status: 'open',
        documentNumber: '',
        accountReceivableId: '',
        notes: '',
        locked: true,
        lockReason: '',
      };
    };

    payments.forEach((payment, paymentIndex) => {
      const method = methodMap.get(payment.id) || null;
      const resolvedType = String(payment.type || method?.type || '').toLowerCase();
      const paymentMethodId = method?.raw?._id ? String(method.raw._id) : '';
      const paymentMethodLabel = payment.label || method?.label || 'Pagamento';
      const paymentMethodType = resolvedType || 'avista';
      const totalValue = safeNumber(payment.valor ?? 0);
      if (!(totalValue > 0)) {
        return;
      }

      const salePaymentId = payment.id || method?.id || createUid();

      if (paymentMethodType === 'crediario' || payment.crediarioData) {
        const data = payment.crediarioData || {};
        const installments = Array.isArray(data.installments) ? data.installments : [];
        const clienteId = data.clienteId || fallbackCustomerId;
        const clienteNome = data.clienteNome || fallbackCustomerName;
        const normalizedInstallments = [];
        installments.forEach((installment, index) => {
          const valor = safeNumber(installment.valor ?? installment.value ?? installment.amount ?? 0);
          if (!(valor > 0)) return;
          const rawDue = installment.dueDate || installment.vencimento || null;
          const dueDate = toDateValue(rawDue) || addDays(saleDateObj, 0);
          const parcelNumber = (() => {
            const parsed = Number.parseInt(installment.parcela ?? installment.number, 10);
            return Number.isFinite(parsed) ? parsed : index + 1;
          })();
          receivables.push(
            createInstallmentEntry({
              parcelNumber,
              value: valor,
              dueDate,
              paymentMethodId: installment.methodId || paymentMethodId,
              paymentMethodLabel: installment.methodLabel || paymentMethodLabel,
              paymentMethodType,
              salePaymentId,
              clienteId,
              clienteNome,
            })
          );
          normalizedInstallments.push({
            number: parcelNumber,
            value: valor,
            dueDate,
          });
        });
        if (!normalizedInstallments.length) {
          return;
        }
        const installmentsTotal = normalizedInstallments.reduce(
          (sum, installment) => sum + safeNumber(installment.value ?? installment.valor ?? installment.amount ?? 0),
          0
        );
        const requestTotalValue = installmentsTotal > 0 ? Math.round(installmentsTotal * 100) / 100 : totalValue;
        const installmentMethodIds = [];
        const installmentMethodLabels = [];
        installments.forEach((installment) => {
          const rawId =
            installment.methodId ||
            installment.paymentMethodId ||
            installment.paymentMethod ||
            '';
          const normalizedId = rawId !== null && rawId !== undefined ? String(rawId).trim() : '';
          if (normalizedId) {
            installmentMethodIds.push(normalizedId);
          }
          const rawLabel = installment.methodLabel || installment.paymentMethodLabel || '';
          const normalizedLabel = rawLabel !== null && rawLabel !== undefined ? String(rawLabel).trim() : '';
          if (normalizedLabel) {
            installmentMethodLabels.push(normalizedLabel);
          }
        });
        const uniqueInstallmentMethodIds = Array.from(new Set(installmentMethodIds));
        const uniqueInstallmentMethodLabels = Array.from(new Set(installmentMethodLabels));
        const requestPaymentMethodId =
          uniqueInstallmentMethodIds.length === 1
            ? uniqueInstallmentMethodIds[0]
            : paymentMethodId || '';
        const requestPaymentLabel =
          uniqueInstallmentMethodLabels.length === 1
            ? uniqueInstallmentMethodLabels[0]
            : paymentMethodLabel;

        backendRequests.push({
          paymentId: salePaymentId,
          paymentLabel: requestPaymentLabel,
          methodType: paymentMethodType,
          paymentMethodId: requestPaymentMethodId || '',
          totalValue: requestTotalValue,
          installments: normalizedInstallments,
          customerId: clienteId ? String(clienteId) : '',
          customerName: clienteNome,
          customerDocument: fallbackCustomerDocument,
          markAsPaid: false,
          salePaymentId,
        });
        return;
      }

      if (paymentMethodType === 'credito') {
        const parcelasRaw = payment.parcelas ?? payment.parcelas ?? 1;
        const parcelas = Math.max(1, Number.parseInt(parcelasRaw, 10) || 1);
        const configs = Array.isArray(method?.installmentConfigurations)
          ? method.installmentConfigurations
          : [];
        const configMap = new Map();
        configs.forEach((config) => {
          const rawNumber =
            config?.number ??
            config?.parcela ??
            config?.parcel ??
            config?.installment ??
            config?.sequencia ??
            config?.sequence;
          const parcelNumber = Number.parseInt(rawNumber, 10);
          if (!Number.isFinite(parcelNumber) || parcelNumber < 1) {
            return;
          }
          const days = parsePrazoDays(
            config?.days ??
              config?.prazo ??
              config?.dias ??
              config?.prazoRecebimento ??
              config?.prazo_recebimento ??
              config?.delay
          );
          if (!Number.isFinite(days)) {
            return;
          }
          configMap.set(parcelNumber, days);
        });
        const baseDays = parsePrazoDays(
          payment?.prazo ??
            method?.raw?.prazoRecebimento ??
            method?.raw?.prazo_recebimento ??
            method?.raw?.prazo ??
            method?.raw?.days ??
            method?.raw?.prazoRecebimentoDias ??
            method?.raw?.prazoDias ??
            0
        );
        const anticipated = resolveAnticipationFlag(method, payment);
        const normalizedInstallments = [];
        const firstParcelOffset = configMap.has(1) ? configMap.get(1) : baseDays;
        const scheduledDueDates = [];
        if (anticipated) {
          const dueDate = addDays(saleDateObj, firstParcelOffset);
          receivables.push(
            createInstallmentEntry({
              parcelNumber: 1,
              value: totalValue,
              dueDate,
              paymentMethodId,
              paymentMethodLabel,
              paymentMethodType,
              salePaymentId,
              clienteId: fallbackCustomerId,
              clienteNome: fallbackCustomerName,
            })
          );
          normalizedInstallments.push({ number: 1, value: totalValue, dueDate });
        } else {
          const totalCents = Math.round(totalValue * 100);
          const baseCents = parcelas > 0 ? Math.floor(totalCents / parcelas) : totalCents;
          const remainder = totalCents - baseCents * parcelas;
          const firstDue = addDays(saleDateObj, firstParcelOffset);
          for (let index = 0; index < parcelas; index += 1) {
            const parcelNumber = index + 1;
            const amountCents = baseCents + (index < remainder ? 1 : 0);
            const valor = amountCents / 100;
            let dueDate;
            if (configMap.has(parcelNumber)) {
              dueDate = addDays(saleDateObj, configMap.get(parcelNumber));
            } else if (parcelNumber === 1) {
              dueDate = firstDue;
            } else {
              const previousDue = scheduledDueDates[scheduledDueDates.length - 1] || firstDue;
              dueDate = addDays(previousDue, 30);
            }
            const lastScheduled = scheduledDueDates[scheduledDueDates.length - 1] || null;
            if (lastScheduled && dueDate.getTime() <= lastScheduled.getTime()) {
              dueDate = addDays(lastScheduled, 30);
            }
            scheduledDueDates.push(dueDate);
            receivables.push(
              createInstallmentEntry({
                parcelNumber,
                value: valor,
                dueDate,
                paymentMethodId,
                paymentMethodLabel,
                paymentMethodType,
                salePaymentId,
                clienteId: fallbackCustomerId,
                clienteNome: fallbackCustomerName,
              })
            );
            normalizedInstallments.push({ number: parcelNumber, value: valor, dueDate });
          }
        }
        const dueNow = normalizedInstallments[0]?.dueDate || saleDateObj;
        const markAsPaid = dueNow && dueNow.getTime() <= saleDateObj.getTime();
        backendRequests.push({
          paymentId: salePaymentId,
          paymentLabel: paymentMethodLabel,
          methodType: paymentMethodType,
          paymentMethodId: paymentMethodId || '',
          totalValue,
          installments: normalizedInstallments,
          customerId: fallbackCustomerId,
          customerName: fallbackCustomerName,
          customerDocument: fallbackCustomerDocument,
          markAsPaid,
          salePaymentId,
        });
        return;
      }

      // Pagamentos à vista, débito, PIX etc.
      const immediateDue = addDays(
        saleDateObj,
        method?.raw?.days ?? method?.raw?.prazo ?? method?.raw?.prazoRecebimento ?? 0
      );
      receivables.push(
        createInstallmentEntry({
          parcelNumber: 1,
          value: totalValue,
          dueDate: immediateDue,
          paymentMethodId,
          paymentMethodLabel,
          paymentMethodType,
          salePaymentId,
          clienteId: fallbackCustomerId,
          clienteNome: fallbackCustomerName,
        })
      );
      backendRequests.push({
        paymentId: salePaymentId,
        paymentLabel: paymentMethodLabel,
        methodType: paymentMethodType,
        paymentMethodId: paymentMethodId || '',
        totalValue,
        installments: [{ number: 1, value: totalValue, dueDate: immediateDue }],
        customerId: fallbackCustomerId,
        customerName: fallbackCustomerName,
        customerDocument: fallbackCustomerDocument,
        markAsPaid: true,
        salePaymentId,
      });
    });

    return { entries: receivables, backendRequests, saleDate: saleDateIso, saleItems: items };
  };

  const syncAccountsReceivableForSale = async (
    saleRecord,
    receivables,
    backendRequests,
    context = {}
  ) => {
    if (!saleRecord || !saleRecord.id) return;
    const saleId = saleRecord.id;

    const commitReceivablesToState = () => {
      state.accountsReceivable = state.accountsReceivable.filter((entry) => entry.saleId !== saleId);
      if (Array.isArray(receivables) && receivables.length) {
        const enriched = receivables.map((entry) => ({ ...entry, saleId }));
        state.accountsReceivable.push(...enriched);
        saleRecord.receivables = enriched.map((entry) => ({ ...entry }));
      }
      renderReceivablesList();
      renderReceivablesSelectedCustomer();
    };

    commitReceivablesToState();

    if (!Array.isArray(backendRequests) || !backendRequests.length) {
      return;
    }

    const pdv = findPdvById(state.selectedPdv);
    const companyId = getPdvCompanyId(pdv);
    const contaCorrente = state.financeSettings?.contaCorrente || null;
    const contaContabil = state.financeSettings?.contaContabilReceber || null;
    const bankAccountId = contaCorrente?.id || contaCorrente?.raw?._id || '';
    const accountingAccountId = contaContabil?.id || contaContabil?.raw?._id || '';
    if (!companyId || !bankAccountId || !accountingAccountId) {
      notify(
        'Configure a empresa, a conta corrente e a conta contábil do PDV para registrar contas a receber automaticamente.',
        'warning'
      );
      return;
    }

    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const saleCode = context.saleCode || saleRecord.saleCode || '';
    const saleDateIso = context.saleDate || saleRecord.createdAt || new Date().toISOString();
    const saleDateLabel = toDateLabel(saleDateIso);
    const saleItems = Array.isArray(context.items) ? context.items : [];
    const customerName =
      resolveCustomerName(context.customer || state.vendaCliente) || PDV_NO_CUSTOMER_LABEL;
    const customerDocument = resolveCustomerDocument(context.customer || state.vendaCliente) || '';
    const pdvCode = pdv?.codigo || pdv?.code || state.saleCodeIdentifier || 'PDV';
    const pdvName = pdv?.nome || pdv?.apelido || pdv?.descricao || 'PDV';
    const observationLines = [];
    observationLines.push(
      `Venda finalizada pelo PDV ${pdvName}${pdvCode ? ` (cód. ${pdvCode})` : ''} em ${saleDateLabel}.`
    );
    if (saleCode) {
      observationLines.push(`Código da venda: ${saleCode}.`);
    }
    if (customerName) {
      const documentInfo = customerDocument ? ` (${customerDocument})` : '';
      observationLines.push(`Cliente: ${customerName}${documentInfo}.`);
    }
    if (saleItems.length) {
      observationLines.push('Itens vendidos:');
      saleItems.forEach((item) => {
        const itemName =
          item?.nome || item?.descricao || item?.produto || item?.product || 'Item da venda';
        const quantityValue = safeNumber(item?.quantidade ?? item?.qtd ?? 0);
        const quantityLabel = quantityValue.toLocaleString('pt-BR', {
          minimumFractionDigits: Number.isInteger(quantityValue) ? 0 : 2,
          maximumFractionDigits: 3,
        });
        const unitLabel = item?.unidade || item?.productSnapshot?.unidade || '';
        observationLines.push(`- ${itemName} • ${quantityLabel}${unitLabel ? ` ${unitLabel}` : ''}`);
      });
    }
    const observationBase = observationLines.join('\n');
    const lockReasonMessage =
      'Lançamento gerado automaticamente pelo PDV. Edite apenas pelo PDV.';

    let requestIndex = 0;
    for (const request of backendRequests) {
      requestIndex += 1;
      try {
        const installmentsData = Array.isArray(request.installments)
          ? request.installments.map((installment) => ({
              number: installment.number,
              dueDate: installment.dueDate ? installment.dueDate.toISOString() : saleDateIso,
              bankAccount: bankAccountId,
              value: safeNumber(installment.value ?? installment.valor ?? installment.amount ?? 0),
            }))
          : [];
        const documentNumberParts = [pdvCode || 'PDV', saleCode || saleId, requestIndex];
        const documentNumber = documentNumberParts.filter(Boolean).join('-');
        const payload = {
          company: companyId,
          customer: request.customerId || undefined,
          bankAccount: bankAccountId,
          accountingAccount: accountingAccountId,
          paymentMethod: request.paymentMethodId || undefined,
          issueDate: saleDateIso,
          dueDate: installmentsData[0]?.dueDate || saleDateIso,
          totalValue: request.totalValue,
          installmentsCount: installmentsData.length,
          installmentsData,
          documentNumber,
          notes: [observationBase, `Meio de pagamento: ${request.paymentLabel}`].filter(Boolean).join('\n\n'),
          locked: true,
          lockReason: lockReasonMessage,
          origin: 'pdv-sale',
          originReference: `${saleId}:${request.paymentId}`,
          metadata: {
            pdvId: state.selectedPdv || '',
            pdvCode,
            pdvName,
            saleId,
            saleCode,
            paymentId: request.paymentId,
            paymentLabel: request.paymentLabel,
            methodType: request.methodType,
          },
        };

        const response = await fetch(`${API_BASE}/accounts-receivable`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data?.message || 'Não foi possível registrar as contas a receber da venda.';
          throw new Error(message);
        }
        const receivable = data?.receivable || data || {};
        const accountId = receivable._id || '';
        const documentNumberResponse = receivable.documentNumber || payload.documentNumber;

        const updateEntries = (entries) => {
          entries.forEach((entry) => {
            if (entry.salePaymentId === request.salePaymentId) {
              entry.accountReceivableId = accountId;
              entry.documentNumber = documentNumberResponse;
              entry.locked = true;
              entry.lockReason = lockReasonMessage;
              entry.notes = payload.notes;
              if (request.markAsPaid) {
                entry.status = 'finalized';
              }
              entry.metadata = payload.metadata;
            }
          });
        };

        updateEntries(receivables);
        if (Array.isArray(saleRecord.receivables)) {
          updateEntries(saleRecord.receivables);
        }

        if (request.markAsPaid && accountId) {
          for (const installment of request.installments) {
            const paymentResponse = await fetch(
              `${API_BASE}/accounts-receivable/${accountId}/payments`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  installmentNumber: installment.number,
                  paymentDate: saleDateIso,
                  paidValue: installment.value,
                  bankAccount: bankAccountId,
                  paymentMethod: request.paymentMethodId || undefined,
                  allowLockedUpdate: true,
                }),
              }
            );
            if (!paymentResponse.ok) {
              const paymentError = await paymentResponse.json().catch(() => ({}));
              const message = paymentError?.message || 'Não foi possível marcar a conta como recebida.';
              throw new Error(message);
            }
          }
        }
      } catch (error) {
        console.error('Erro ao sincronizar contas a receber da venda:', error);
        notify(error.message || 'Não foi possível registrar as contas a receber da venda.', 'error');
      }
    }

    commitReceivablesToState();
    scheduleStatePersist({ immediate: true });
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
      scheduleStatePersist({ immediate: true });
      notify(error?.message || 'Não foi possível emitir a nota fiscal.', 'error');
      return { success: false, reason: 'error', error };
    }
    finally {
      if (emissionModalOpened) {
        closeFiscalEmissionModal();
      }
    }
  };

  const finalizeBudgetFlow = async () => {
    if (!state.itens.length) {
      notify('Adicione itens para salvar o orçamento.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (!state.vendaCliente) {
      notify('Vincule um cliente para salvar o orçamento.', 'warning');
      closeFinalizeModal();
      return;
    }
    const validityDays = clampBudgetValidityDays(
      state.pendingBudgetValidityDays ?? DEFAULT_BUDGET_VALIDITY_DAYS
    );
    const now = new Date();
    const nowIso = now.toISOString();
    const validUntil = new Date((toStartOfDay(now) || now).getTime() + validityDays * MS_PER_DAY);
    const itensSnapshot = state.itens.map((item) => ({ ...item }));
    const pagamentosSnapshot = state.vendaPagamentos.map((payment) => ({ ...payment }));
    const discount = state.vendaDesconto;
    const addition = state.vendaAcrescimo;
    const total = getSaleTotalLiquido();
    const customerSnapshot = state.vendaCliente ? { ...state.vendaCliente } : null;
    const petSnapshot = state.vendaPet ? { ...state.vendaPet } : null;
    const budgetId = state.activeBudgetId || '';
    const existingBudget = budgetId ? findBudgetById(budgetId) : null;
    let budget = existingBudget;
    if (existingBudget) {
      existingBudget.items = itensSnapshot;
      existingBudget.payments = pagamentosSnapshot;
      existingBudget.discount = discount;
      existingBudget.addition = addition;
      existingBudget.total = total;
      existingBudget.customer = customerSnapshot;
      existingBudget.pet = petSnapshot;
      existingBudget.validityDays = validityDays;
      existingBudget.validUntil = validUntil.toISOString();
      existingBudget.updatedAt = nowIso;
      existingBudget.paymentLabel = describeSalePayments(pagamentosSnapshot);
    } else {
      budget = {
        id: createUid(),
        code: generateBudgetCode(),
        createdAt: nowIso,
        updatedAt: nowIso,
        validityDays,
        validUntil: validUntil.toISOString(),
        total,
        discount,
        addition,
        customer: customerSnapshot,
        pet: petSnapshot,
        items: itensSnapshot,
        payments: pagamentosSnapshot,
        paymentLabel: describeSalePayments(pagamentosSnapshot),
        status: 'aberto',
        importedAt: null,
      };
      state.budgets.unshift(budget);
    }
    state.selectedBudgetId = budget?.id || existingBudget?.id || '';
    state.pendingBudgetValidityDays = null;
    state.activeBudgetId = '';
    notify(
      budget?.code
        ? `Orçamento ${budget.code} salvo com sucesso.`
        : existingBudget?.code
        ? `Orçamento ${existingBudget.code} atualizado com sucesso.`
        : 'Orçamento salvo com sucesso.',
      'success'
    );
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
    renderBudgets();
    scheduleStatePersist({ immediate: true });
    closeFinalizeModal();
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
    if (total > 0 && pago + 0.009 < total) {
      notify('O valor pago é insuficiente para finalizar a venda.', 'warning');
      return;
    }
    const budgetIdToFinalize = state.activeBudgetId || '';
    const budgetToFinalize = budgetIdToFinalize ? findBudgetById(budgetIdToFinalize) : null;
    const saleCode = state.currentSaleCode || '';
    const itensSnapshot = state.itens.map((item) => ({ ...item }));
    const pagamentosVenda = state.vendaPagamentos.map((payment) => ({ ...payment }));
    const saleSnapshot = getSaleReceiptSnapshot(itensSnapshot, pagamentosVenda, { saleCode });
    const saleDate = new Date();
    const saleReceivables = buildSaleReceivables({
      payments: pagamentosVenda,
      customer: state.vendaCliente,
      saleCode,
      items: itensSnapshot,
      saleDate,
    });
    const cashContributions = normalizeCashContributions(
      registerSaleOnCaixa(pagamentosVenda, total, saleCode)
    );
    const saleRecord = registerCompletedSaleRecord({
      type: 'venda',
      saleCode,
      snapshot: saleSnapshot,
      payments: pagamentosVenda,
      items: itensSnapshot,
      discount: state.vendaDesconto,
      addition: state.vendaAcrescimo,
      customer: state.vendaCliente,
      createdAt: saleReceivables.saleDate,
      receivables: saleReceivables.entries,
      cashContributions,
      appointmentId: state.activeAppointmentId || '',
    });
    if (saleRecord) {
      saleRecord.cashContributions = cashContributions;
      saleRecord.receivables = saleReceivables.entries.map((entry) => ({ ...entry }));
      scheduleStatePersist();
      await syncAccountsReceivableForSale(
        saleRecord,
        saleReceivables.entries,
        saleReceivables.backendRequests,
        {
          saleCode,
          customer: state.vendaCliente,
          items: saleReceivables.saleItems,
          saleDate: saleReceivables.saleDate,
        }
      );
    }
    if (budgetToFinalize) {
      const finalizeIso = new Date().toISOString();
      budgetToFinalize.status = 'finalizado';
      budgetToFinalize.finalizedAt = finalizeIso;
      budgetToFinalize.updatedAt = finalizeIso;
      if (saleRecord?.id) {
        budgetToFinalize.finalizedSaleId = saleRecord.id;
      }
      state.selectedBudgetId = budgetToFinalize.id;
    }
    const successMessage = saleCode
      ? `Venda ${saleCode} finalizada com sucesso.`
      : 'Venda finalizada com sucesso.';
    notify(successMessage, 'success');
    if (state.activeAppointmentId) {
      await syncAppointmentAfterSale(state.activeAppointmentId, saleCode);
    }
    state.activeBudgetId = '';
    state.pendingBudgetValidityDays = null;
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
    if (budgetToFinalize) {
      renderBudgets();
      scheduleStatePersist({ immediate: true });
    }
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

  const finalizeReceivablesPaymentFlow = async () => {
    const context = state.receivablesPaymentContext || {};
    const payments = state.vendaPagamentos.map((payment) => ({ ...payment }));
    const entries = Array.isArray(context.entries) && context.entries.length
      ? context.entries.map((entry) => ({ ...entry }))
      : refreshReceivablesSelection();
    if (!entries.length) {
      notify('Selecione as parcelas do crediário que deseja receber.', 'warning');
      closeFinalizeModal();
      return;
    }
    if (!payments.length) {
      notify('Informe as formas de pagamento recebidas.', 'warning');
      return;
    }
    state.receivablesPaymentLoading = true;
    renderReceivablesSelectionSummary();
    try {
      const { operations, processedEntries, residualValue } = buildReceivablesPaymentOperations(
        entries,
        payments,
        { residualDueDate: state.receivablesResidualDueDate }
      );
      if (residualValue > RECEIVABLES_RESIDUAL_THRESHOLD) {
        const dueValue = state.receivablesResidualDueDate || '';
        const parsedDue = parseDateInputValue(dueValue);
        if (!dueValue) {
          elements.receivablesResidualDue?.focus();
          throw new Error('Informe uma nova data de vencimento para o resíduo.');
        }
        if (!parsedDue) {
          elements.receivablesResidualDue?.focus();
          throw new Error('Informe uma data de vencimento válida para o resíduo.');
        }
      }
      if (!operations.length) {
        throw new Error('Informe as formas de pagamento recebidas.');
      }
      const contaCorrente = state.financeSettings?.contaCorrente || null;
      const bankAccountId = contaCorrente?.id || contaCorrente?.raw?._id || '';
      if (!bankAccountId) {
        throw new Error('Configure uma conta corrente para registrar o recebimento.');
      }
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const paymentDateIso = new Date().toISOString();
      for (const operation of operations) {
        const response = await fetch(
          `${API_BASE}/accounts-receivable/${encodeURIComponent(operation.accountId)}/payments`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              installmentNumber: operation.installmentNumber,
              paymentDate: paymentDateIso,
              paidValue: operation.paidValue,
              bankAccount: bankAccountId,
              paymentMethod: operation.paymentMethodId || undefined,
              residualValue:
                operation.residualValue &&
                operation.residualValue > RECEIVABLES_RESIDUAL_THRESHOLD
                  ? operation.residualValue
                  : undefined,
              residualDueDate: operation.residualDueDate || undefined,
              allowLockedUpdate: true,
            }),
          }
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const message =
            payload?.message ||
            'Não foi possível registrar o pagamento das parcelas selecionadas.';
          throw new Error(message);
        }
      }

      const customer = context.customer || state.receivablesSelectedCustomer;
      const receivedTotal = operations.reduce((sum, operation) => sum + operation.paidValue, 0);
      registerReceivablesOnCaixa(payments, receivedTotal, customer);

      const customerId = resolveCustomerId(customer);
      if (customerId) {
        customerReceivablesCache.delete(customerId);
        customerReceivablesDetailsCache.delete(customerId);
      }

      const paidIds = new Set(processedEntries.map((entry) => entry.id));
      state.receivablesSelectedIds = state.receivablesSelectedIds.filter((id) => !paidIds.has(id));
      state.vendaPagamentos = [];
      renderSalePaymentsPreview();
      resetReceivablesResidualState();
      notify('Recebimento registrado com sucesso.', 'success');
      if (state.receivablesSelectedCustomer) {
        await loadReceivablesForCustomer(state.receivablesSelectedCustomer, { force: true });
        loadReceivablesCustomerDetails(state.receivablesSelectedCustomer, { force: true });
      }
      closeFinalizeModal();
    } catch (error) {
      console.error('Erro ao registrar recebimento de crediário:', error);
      notify(
        error.message || 'Não foi possível registrar o recebimento das parcelas selecionadas.',
        'error'
      );
    } finally {
      state.receivablesPaymentLoading = false;
      renderReceivablesSelectionSummary();
    }
  };

  const finalizeDeliveryFlow = async () => {
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
    if (total > 0 && pago + 0.009 < total) {
      notify('O valor pago é insuficiente para registrar o delivery.', 'warning');
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
    const saleReceivables = buildSaleReceivables({
      payments: pagamentosVenda,
      customer: state.vendaCliente,
      saleCode,
      items: itensSnapshot,
      saleDate: orderRecord.createdAt,
    });
    const cashContributions = normalizeCashContributions([]);
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
      receivables: saleReceivables.entries,
      cashContributions,
    });
    if (saleRecord) {
      saleRecord.cashContributions = cashContributions;
      saleRecord.receivables = saleReceivables.entries.map((entry) => ({ ...entry }));
      scheduleStatePersist();
      orderRecord.saleRecordId = saleRecord.id;
    }
    state.deliveryOrders.unshift(orderRecord);
    renderDeliveryOrders();
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

  const finalizeRegisteredDeliveryOrder = async () => {
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
    if (total > 0 && pago + 0.009 < total) {
      notify('O valor pago é insuficiente para finalizar o delivery.', 'warning');
      return;
    }
    const existingSaleCode =
      order.saleCode ||
      order.receiptSnapshot?.meta?.saleCode ||
      '';
    const saleCode = existingSaleCode || state.currentSaleCode || '';
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
    const orderCustomer = resolveDeliveryOrderCustomer(order);
    if (orderCustomer) {
      order.customerDetails = { ...orderCustomer };
      const resolvedId = resolveCustomerId(orderCustomer);
      if (resolvedId) {
        order.customerId = resolvedId;
        if (order.customer && typeof order.customer === 'object') {
          order.customer.id = order.customer.id || resolvedId;
        }
      }
      if (!order.customerDocument) {
        order.customerDocument = resolveCustomerDocument(orderCustomer) || '';
      }
      if (!order.customerContact) {
        const contactCandidate =
          orderCustomer.telefone || orderCustomer.celular || orderCustomer.email || '';
        order.customerContact = contactCandidate;
        if (order.customer && typeof order.customer === 'object' && !order.customer.contato) {
          order.customer.contato = contactCandidate;
        }
      }
    }
    let saleCustomer = state.vendaCliente || orderCustomer;
    if (!resolveCustomerId(saleCustomer)) {
      const lookupDocument =
        resolveCustomerDocument(orderCustomer) ||
        order.customerDocument ||
        resolveCustomerDocument(state.vendaCliente) ||
        '';
      if (lookupDocument) {
        const fetchedCustomer = await fetchDeliveryCustomerByDocument(lookupDocument);
        if (fetchedCustomer && resolveCustomerId(fetchedCustomer)) {
          saleCustomer = fetchedCustomer;
          setSaleCustomer(fetchedCustomer, null, { skipRecalculate: true });
          order.customerDetails = { ...fetchedCustomer };
          const fetchedId = resolveCustomerId(fetchedCustomer);
          if (fetchedId) {
            order.customerId = fetchedId;
            if (order.customer && typeof order.customer === 'object') {
              order.customer.id = order.customer.id || fetchedId;
            }
          }
          order.customerDocument =
            resolveCustomerDocument(fetchedCustomer) || order.customerDocument || '';
          const fetchedContact =
            fetchedCustomer.telefone ||
            fetchedCustomer.celular ||
            fetchedCustomer.email ||
            order.customerContact ||
            '';
          if (fetchedContact) {
            order.customerContact = fetchedContact;
            if (order.customer && typeof order.customer === 'object' && !order.customer.contato) {
              order.customer.contato = fetchedContact;
            }
          }
        }
      }
    }
    const saleCustomerId = resolveCustomerId(saleCustomer);
    if (!saleCustomerId) {
      notify('Selecione novamente o cliente do delivery antes de finalizar.', 'warning');
      return;
    }
    const saleReceivables = buildSaleReceivables({
      payments: pagamentosVenda,
      customer: saleCustomer,
      saleCode,
      items: itensSnapshot,
      saleDate: order.createdAt || new Date(),
    });
    const cashContributions = normalizeCashContributions(
      registerSaleOnCaixa(pagamentosVenda, total, saleCode)
    );
    order.payments = pagamentosVenda;
    order.paymentsLabel = summarizeDeliveryPayments(pagamentosVenda);
    order.total = total;
    order.items = itensSnapshot;
    order.discount = state.vendaDesconto;
    order.addition = state.vendaAcrescimo;
    order.receiptSnapshot = saleSnapshot;
    order.saleCode = saleCode;
    order.status = 'finalizado';
    const nowIso = new Date().toISOString();
    order.statusUpdatedAt = nowIso;
    order.updatedAt = nowIso;
    order.finalizedAt = nowIso;
    renderDeliveryOrders();
    const saleRecordId = order.saleRecordId;
    if (saleRecordId) {
      const saleRecord = updateCompletedSaleRecord(saleRecordId, {
        saleCode: order.saleCode,
        snapshot: saleSnapshot,
        payments: pagamentosVenda,
        items: itensSnapshot,
        discount: state.vendaDesconto,
        addition: state.vendaAcrescimo,
        customer: saleCustomer,
        receivables: saleReceivables.entries,
        cashContributions,
      });
      if (saleRecord) {
        saleRecord.cashContributions = cashContributions;
        saleRecord.receivables = saleReceivables.entries.map((entry) => ({ ...entry }));
        scheduleStatePersist();
        await syncAccountsReceivableForSale(
          saleRecord,
          saleReceivables.entries,
          saleReceivables.backendRequests,
          {
            saleCode,
            customer: saleCustomer,
            items: saleReceivables.saleItems,
            saleDate: saleReceivables.saleDate,
          }
        );
      }
    } else {
      const saleRecord = registerCompletedSaleRecord({
        type: 'delivery',
        saleCode,
        snapshot: saleSnapshot,
        payments: pagamentosVenda,
        items: itensSnapshot,
        discount: state.vendaDesconto,
        addition: state.vendaAcrescimo,
        customer: saleCustomer,
        createdAt: order.createdAt,
        receivables: saleReceivables.entries,
        cashContributions,
      });
      if (saleRecord) {
        saleRecord.cashContributions = cashContributions;
        saleRecord.receivables = saleReceivables.entries.map((entry) => ({ ...entry }));
        scheduleStatePersist();
        await syncAccountsReceivableForSale(
          saleRecord,
          saleReceivables.entries,
          saleReceivables.backendRequests,
          {
            saleCode,
            customer: saleCustomer,
            items: saleReceivables.saleItems,
            saleDate: saleReceivables.saleDate,
          }
        );
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
    if (!existingSaleCode && saleCode) {
      advanceSaleCode();
    }
    promptDeliveryPrint(saleSnapshot);
  };

  const handleFinalizeConfirm = async () => {
    if (state.finalizeProcessing) {
      return;
    }
    setFinalizeProcessing(true);
    try {
      if (state.activeFinalizeContext === 'delivery') {
        await finalizeDeliveryFlow();
        return;
      }
      if (state.activeFinalizeContext === 'delivery-complete') {
        await finalizeRegisteredDeliveryOrder();
        return;
      }
      if (state.activeFinalizeContext === 'receivables') {
        await finalizeReceivablesPaymentFlow();
        return;
      }
      if (state.activeFinalizeContext === 'orcamento') {
        await finalizeBudgetFlow();
        return;
      }
      await finalizeSaleFlow();
    } catch (error) {
      console.error('Erro ao confirmar finalização', error);
      const message =
        (error && typeof error.message === 'string' && error.message) ||
        'Não foi possível concluir a operação.';
      notify(message, 'error');
    } finally {
      setFinalizeProcessing(false);
    }
  };

  const handleSaleAdjust = () => {
    notify('Funcionalidade de acréscimo/desconto em desenvolvimento.', 'info');
  };

  const handleSaleItemAdjust = () => {
    notify('Funcionalidade de ajuste por item em desenvolvimento.', 'info');
  };

  const setReceivablesResidualError = (message = '') => {
    const normalized = typeof message === 'string' ? message : '';
    state.receivablesResidualError = normalized;
    if (!elements.receivablesResidualError) return;
    const hasError = Boolean(normalized);
    elements.receivablesResidualError.textContent = normalized;
    elements.receivablesResidualError.classList.toggle('hidden', !hasError);
    if (elements.receivablesResidualDue) {
      elements.receivablesResidualDue.classList.toggle('border-red-300', hasError);
    }
  };

  const resetReceivablesResidualState = () => {
    state.receivablesResidualValue = 0;
    state.receivablesResidualDueDate = '';
    state.receivablesResidualError = '';
    if (elements.receivablesResidualContainer) {
      elements.receivablesResidualContainer.classList.add('hidden');
    }
    if (elements.receivablesResidualDue) {
      elements.receivablesResidualDue.value = '';
      elements.receivablesResidualDue.classList.remove('border-red-300');
    }
    setReceivablesResidualError('');
  };

  const updateReceivablesResidualSection = (remaining) => {
    if (!elements.receivablesResidualContainer) return;
    const isReceivables = state.activeFinalizeContext === 'receivables';
    const showResidual = isReceivables && remaining > RECEIVABLES_RESIDUAL_THRESHOLD;
    elements.receivablesResidualContainer.classList.toggle('hidden', !showResidual);
    if (!showResidual) {
      state.receivablesResidualValue = 0;
      state.receivablesResidualDueDate = '';
      if (elements.receivablesResidualDue) {
        elements.receivablesResidualDue.value = '';
        elements.receivablesResidualDue.classList.remove('border-red-300');
      }
      setReceivablesResidualError('');
      return;
    }
    const residualValue = Math.max(remaining, 0);
    state.receivablesResidualValue = residualValue;
    if (elements.receivablesResidualAmount) {
      elements.receivablesResidualAmount.textContent = formatCurrency(residualValue);
    }
    if (elements.receivablesResidualDue) {
      if (state.receivablesResidualDueDate) {
        elements.receivablesResidualDue.value = state.receivablesResidualDueDate;
      } else if (elements.receivablesResidualDue.value) {
        elements.receivablesResidualDue.value = '';
      }
    }
    const dueValue = state.receivablesResidualDueDate || '';
    if (!dueValue) {
      setReceivablesResidualError('Informe uma nova data de vencimento para o resíduo.');
      return;
    }
    if (!parseDateInputValue(dueValue)) {
      setReceivablesResidualError('Informe uma data de vencimento válida para o resíduo.');
      return;
    }
    setReceivablesResidualError('');
  };

  const handleReceivablesResidualDueInput = (event) => {
    if (state.activeFinalizeContext !== 'receivables') {
      return;
    }
    const value = typeof event?.target?.value === 'string' ? event.target.value : '';
    state.receivablesResidualDueDate = value;
    if (!value) {
      setReceivablesResidualError('Informe uma nova data de vencimento para o resíduo.');
      updateSaleSummary();
      return;
    }
    if (!parseDateInputValue(value)) {
      setReceivablesResidualError('Informe uma data de vencimento válida para o resíduo.');
      updateSaleSummary();
      return;
    }
    setReceivablesResidualError('');
    updateSaleSummary();
  };

  const updateSaleSummary = () => {
    const totalLiquido = getSaleTotalLiquido();
    const pago = getSalePagoTotal();
    const desconto = state.vendaDesconto > 0 ? state.vendaDesconto : 0;
    const isBudgetContext = state.activeFinalizeContext === 'orcamento';
    const isReceivablesContext = state.activeFinalizeContext === 'receivables';
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
      const tolerance = RECEIVABLES_RESIDUAL_THRESHOLD;
      const remaining = totalLiquido - pago;
      updateReceivablesResidualSection(remaining);
      const hasInsufficient = totalLiquido > 0 && remaining > tolerance;
      const hasChange = totalLiquido > 0 && pago - totalLiquido > tolerance;
      const residualDueValue = state.receivablesResidualDueDate || '';
      const residualDueValid = !residualDueValue || Boolean(parseDateInputValue(residualDueValue));
      const hasPayments = state.vendaPagamentos.length > 0;
      const isProcessing = state.finalizeProcessing;
      let canFinalize = false;
      if (!totalLiquido) {
        canFinalize = false;
      } else if (isBudgetContext) {
        canFinalize = true;
      } else if (isReceivablesContext) {
        canFinalize = hasPayments;
      } else {
        canFinalize = !hasInsufficient;
      }
      const shouldDisable = !canFinalize || isProcessing;
      elements.finalizeConfirm.disabled = shouldDisable;
      elements.finalizeConfirm.classList.toggle('opacity-60', shouldDisable);
      elements.finalizeConfirm.classList.toggle('cursor-not-allowed', shouldDisable);
      if (elements.finalizeDifference) {
        if (totalLiquido === 0) {
          elements.finalizeDifference.textContent = 'Adicione itens para finalizar a venda.';
        } else if (isBudgetContext) {
          if (!state.vendaPagamentos.length) {
            elements.finalizeDifference.textContent = 'Pagamentos são opcionais para o orçamento.';
          } else if (hasInsufficient) {
            elements.finalizeDifference.textContent = `Faltam ${formatCurrency(Math.max(remaining, 0))}`;
          } else if (hasChange) {
            elements.finalizeDifference.textContent = `Troco previsto ${formatCurrency(Math.max(pago - totalLiquido, 0))}`;
          } else {
            elements.finalizeDifference.textContent = '';
          }
        } else if (isReceivablesContext) {
          if (!state.vendaPagamentos.length) {
            elements.finalizeDifference.textContent = 'Informe as formas de pagamento recebidas.';
          } else if (hasInsufficient) {
            const residualLabel = formatCurrency(Math.max(remaining, 0));
            elements.finalizeDifference.textContent = residualDueValid
              ? `Resíduo pendente de ${residualLabel}.`
              : `Defina o vencimento para o resíduo de ${residualLabel}.`;
          } else if (hasChange) {
            elements.finalizeDifference.textContent = `Troco ${formatCurrency(Math.max(pago - totalLiquido, 0))}`;
          } else {
            elements.finalizeDifference.textContent = '';
          }
        } else if (hasInsufficient) {
          elements.finalizeDifference.textContent = `Faltam ${formatCurrency(Math.max(remaining, 0))}`;
        } else if (hasChange) {
          elements.finalizeDifference.textContent = `Troco ${formatCurrency(Math.max(pago - totalLiquido, 0))}`;
        } else {
          elements.finalizeDifference.textContent = '';
        }
      }
    }
  };

  const setFinalizeProcessing = (processing) => {
    const normalized = Boolean(processing);
    state.finalizeProcessing = normalized;
    if (elements.finalizeConfirm) {
      const defaultLabel =
        elements.finalizeConfirm.dataset.defaultLabel ||
        elements.finalizeConfirm.textContent?.trim() ||
        '';
      elements.finalizeConfirm.dataset.defaultLabel = defaultLabel;
      if (normalized) {
        elements.finalizeConfirm.innerHTML = `<i class="fas fa-circle-notch fa-sm animate-spin mr-2"></i>${defaultLabel}`;
      } else {
        elements.finalizeConfirm.innerHTML = defaultLabel;
      }
      elements.finalizeConfirm.setAttribute('aria-busy', normalized ? 'true' : 'false');
    }
    if (elements.finalizeBack) {
      elements.finalizeBack.disabled = normalized;
      elements.finalizeBack.classList.toggle('opacity-60', normalized);
      elements.finalizeBack.classList.toggle('cursor-not-allowed', normalized);
      elements.finalizeBack.setAttribute('aria-disabled', normalized ? 'true' : 'false');
    }
    if (elements.finalizeClose) {
      elements.finalizeClose.disabled = normalized;
      elements.finalizeClose.classList.toggle('opacity-60', normalized);
      elements.finalizeClose.classList.toggle('cursor-not-allowed', normalized);
      elements.finalizeClose.setAttribute('aria-disabled', normalized ? 'true' : 'false');
    }
    if (elements.finalizeBackdrop) {
      elements.finalizeBackdrop.classList.toggle('pointer-events-none', normalized);
    }
    updateSaleSummary();
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
    const recebimentosClienteFormatted =
      snapshot.resumo?.recebimentosCliente?.formatted ||
      formatCurrency(snapshot.resumo?.recebimentosCliente?.value || 0);

    lines.push('Resumo financeiro');
    lines.push(formatPrintLine('Abertura', snapshot.resumo.abertura.formatted));
    lines.push(formatPrintLine('Recebido', snapshot.resumo.recebido.formatted));
    lines.push(formatPrintLine('Recebimentos de Cliente', recebimentosClienteFormatted));
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
    const accent = '#000000';
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
        color: #000;
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
        color: #111;
      }
      .receipt__meta-item {
        display: block;
        text-align: center;
        max-width: 64mm;
      }
      .receipt__section {
        border-top: 1px solid #000;
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
        color: #000;
      }
      .receipt__cards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.6mm;
      }
      .receipt-card {
        border: 1px solid #000;
        border-radius: 1.6mm;
        padding: 1.6mm 1.8mm;
        display: flex;
        flex-direction: column;
        gap: 0.4mm;
        background: rgba(0, 0, 0, 0.04);
      }
      .receipt-card__label {
        font-size: 9.8px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #111;
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
        color: #111;
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
        color: #333;
        padding: 1.6mm 0;
        border: 1px dashed rgba(0, 0, 0, 0.4);
        border-radius: 1.6mm;
        background: rgba(0, 0, 0, 0.02);
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
        border-bottom: 1px solid #000;
      }
      .receipt-table tbody td {
        padding: 0.6mm 0;
        border-bottom: 1px dashed rgba(0, 0, 0, 0.35);
        vertical-align: top;
      }
      .receipt-table tbody td:last-child {
        text-align: right;
        font-weight: 600;
      }
      .receipt-table__muted {
        display: block;
        font-size: 9.4px;
        color: #333;
      }
      .receipt__footer {
        margin-top: 2mm;
        text-align: center;
        font-size: 9.4px;
        color: #333;
        line-height: 1.45;
      }
      .receipt__footer-strong {
        font-weight: 600;
        color: #000;
      }
      main.receipt.receipt--nfce {
        width: 80mm;
        margin: 0 auto;
        padding: 2mm 0 4mm;
        gap: 1.6mm;
        font-size: 9.4px;
        background: #fff;
      }
      .receipt--nfce .nfce-compact__header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.2mm;
        text-align: center;
        padding: 0 2mm;
      }
      .nfce-compact__operator {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.8mm;
        font-size: 9.8px;
        font-weight: 700;
        color: #000;
        margin-bottom: 0.4mm;
      }
      .nfce-compact__operator strong {
        font-weight: 800;
      }
      .receipt--nfce .nfce-compact__divider {
        width: 100%;
        height: 0.6px;
        background: rgba(0, 0, 0, 0.35);
      }
      .nfce-compact__company {
        display: flex;
        flex-direction: column;
        gap: 0.6mm;
        align-items: center;
      }
      .nfce-compact__company-name {
        margin: 0;
        font-size: 11.4px;
        font-weight: 800;
        letter-spacing: 0.45px;
        text-transform: uppercase;
        color: #111;
      }
      .nfce-compact__company-secondary {
        margin: 0;
        font-size: 9.2px;
        color: #111;
        line-height: 1.35;
      }
      .nfce-compact__company-line {
        margin: 0;
        font-size: 9px;
        color: #111;
        line-height: 1.35;
        text-align: center;
      }
      .nfce-compact__header-meta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.8mm;
        width: 100%;
      }
      .nfce-compact__tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6mm;
        justify-content: center;
        font-size: 8.4px;
        text-transform: uppercase;
        letter-spacing: 0.35px;
        color: var(--receipt-accent);
      }
      .nfce-compact__tag {
        font-weight: 700;
      }
      .nfce-compact__reference {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.6mm;
        font-size: 8.6px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.35px;
        color: #111;
      }
      .nfce-compact__reference-left,
      .nfce-compact__reference-right {
        text-align: center;
      }
      .nfce-compact__reference-divider {
        flex: 0 0 auto;
        font-size: 8.8px;
        font-weight: 700;
        color: rgba(0, 0, 0, 0.7);
      }
      .nfce-compact__header-details {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.6mm;
        font-size: 8.2px;
        color: #333;
        text-transform: uppercase;
        letter-spacing: 0.25px;
        text-align: center;
        align-items: center;
      }
      .nfce-compact__section {
        display: flex;
        flex-direction: column;
        gap: 0.8mm;
        padding: 0 2mm;
      }
      .nfce-compact__section--items {
        padding-top: 1.2mm;
      }
      .nfce-compact__section-title {
        margin: 0;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        color: #111;
        text-align: left;
      }
      .nfce-compact__items-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8.6px;
      }
      .nfce-compact__items-table thead th {
        text-align: left;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        padding: 0.8mm 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.6);
      }
      .nfce-compact__items-table thead th:nth-child(2) {
        text-align: center;
      }
      .nfce-compact__items-table thead th:last-child {
        text-align: right;
      }
      .nfce-compact__items-table tbody td {
        padding: 0.6mm 0;
        border-bottom: 1px dashed rgba(0, 0, 0, 0.3);
        vertical-align: top;
      }
      .nfce-compact__items-table tbody tr:last-child td {
        border-bottom: none;
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
        color: #000;
      }
      .nfce-compact__item-code {
        display: block;
        font-size: 7.4px;
        color: #333;
        margin-top: 0.3mm;
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
        align-items: baseline;
        gap: 0.6mm;
        font-size: 9px;
        color: #111;
      }
      .nfce-compact__total span:first-child {
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .nfce-compact__total span:last-child {
        font-weight: 700;
      }
      .nfce-compact__total--highlight {
        margin-top: 0.6mm;
        padding-top: 0.6mm;
        border-top: 1px solid rgba(0, 0, 0, 0.7);
      }
      .nfce-compact__text {
        margin: 0;
        font-size: 8.6px;
        line-height: 1.35;
        color: #111;
        text-align: left;
      }
      .nfce-compact__text--small {
        font-size: 8.2px;
      }
      .nfce-compact__qr {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 2mm;
      }
      .nfce-compact__qr img {
        width: 30mm;
        height: 30mm;
        image-rendering: pixelated;
      }
      .nfce-compact__qr-details {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.8mm;
        font-size: 8.2px;
        color: #111;
      }
      .nfce-compact__qr-payload {
        margin: 0;
        line-height: 1.4;
        word-break: break-word;
      }
      .nfce-compact__qr-note {
        margin: 0;
        font-weight: 600;
        line-height: 1.4;
      }
      .nfce-compact__access-key {
        margin: 0;
        font-size: 9.4px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-align: center;
        word-break: break-word;
      }
      .nfce-compact__muted {
        color: #444;
        font-weight: 500;
      }
      .nfce-compact__empty {
        font-size: 8.4px;
        text-align: left;
        color: #444;
        padding: 0.6mm 0;
      }
      .receipt__divider {
        width: 100%;
        border: none;
        border-top: 1px dashed rgba(0, 0, 0, 0.5);
        margin: 1.8mm 0 0;
      }
      .receipt-empty {
        margin: 0;
        padding: 7mm 0;
        text-align: center;
        font-size: 11px;
        color: #444;
        font-weight: 600;
      }
      .receipt-fallback {
        margin: 0;
        font-size: 9.8px;
        color: #444;
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

    const resumoRecebimentosCliente =
      snapshot.resumo?.recebimentosCliente?.formatted ||
      formatCurrency(snapshot.resumo?.recebimentosCliente?.value || 0);

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
          <span class="receipt-card__label">Recebimentos de Cliente</span>
          <span class="receipt-card__value">${escapeHtml(resumoRecebimentosCliente)}</span>
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
    const headerDetails = [];
    if (identificacao.dataEmissao) {
      headerDetails.push(`Emissão: ${formatXmlDateTime(identificacao.dataEmissao)}`);
    }
    if (identificacao.dataRegistro) {
      headerDetails.push(`Registro: ${formatXmlDateTime(identificacao.dataRegistro)}`);
    }
    if (identificacao.protocolo) {
      headerDetails.push(`Protocolo: ${identificacao.protocolo}`);
    }
    const headerDetailsMarkup = headerDetails.length
      ? `<ul class="nfce-compact__header-details">${headerDetails
          .map((detail) => `<li>${escapeHtml(detail)}</li>`)
          .join('')}</ul>`
      : '';
    const headerMetaContent = [tagsMarkup, referenceMarkup, headerDetailsMarkup].filter(Boolean).join('');
    const headerMeta = headerMetaContent ? `<div class="nfce-compact__header-meta">${headerMetaContent}</div>` : '';
    const headerDivider = headerMetaContent ? '<span class="nfce-compact__divider" aria-hidden="true"></span>' : '';

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
    const qrPayloadText = qrPayload
      ? escapeHtml(qrPayload)
      : escapeHtml('Consulta disponível via portal da SEFAZ.');
    const qrNoteText = qrPayload
      ? 'Aponte a câmera do celular para validar a NFC-e.'
      : 'Use a chave de acesso informada para consultar a NFC-e no portal da SEFAZ.';
    const qrImageMarkup = qrImage
      ? `<img src="${escapeHtml(qrImage)}" alt="QR Code da NFC-e" />`
      : `<span class="nfce-compact__empty">QR Code indisponível.</span>`;
    const qrSection = `<section class="nfce-compact__section nfce-compact__section--qr">
        <h2 class="nfce-compact__section-title">Consulta</h2>
        <div class="nfce-compact__qr">
          ${qrImageMarkup}
          <div class="nfce-compact__qr-details">
            <p class="nfce-compact__qr-note">${escapeHtml(qrNoteText)}</p>
            <p class="nfce-compact__qr-payload">${qrPayloadText}</p>
          </div>
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
      !tags.length && ambienteLabel ? `Ambiente: ${ambienteLabel}` : '',
      identificacao.protocolo ? `Protocolo: ${identificacao.protocolo}` : '',
      identificacao.dataEmissao ? `Emissão: ${formatXmlDateTime(identificacao.dataEmissao)}` : '',
      identificacao.dataRegistro ? `Registro: ${formatXmlDateTime(identificacao.dataRegistro)}` : '',
      identificacao.digestValue ? `Digest: ${identificacao.digestValue}` : '',
      identificacao.operador ? `Operador: ${identificacao.operador}` : '',
    ].filter(Boolean);
    infoLines.push('Documento emitido eletronicamente. Consulte pelo QR Code ou portal da SEFAZ.');
    const infoSection = `<section class="nfce-compact__section nfce-compact__section--notes">
        <h2 class="nfce-compact__section-title">Informações obrigatórias</h2>
        <p class="nfce-compact__text nfce-compact__text--small">${infoLines
          .map((line) => escapeHtml(line))
          .join('<br>')}</p>
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
          ${headerDivider}
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

  const buildMatricialReceiptMarkup = (snapshot) => {
    if (!snapshot) {
      return '<main class="receipt"><p class="receipt-empty">Nenhuma venda disponível para impressão.</p></main>';
    }

    const store = findStoreById(state.selectedStore);
    const storeCompany = store?.empresa && typeof store.empresa === 'object' ? store.empresa : {};
    const pickValue = (...candidates) => {
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
      return '';
    };

    const companyPrimaryName = pickValue(
      store?.nomeFantasia,
      store?.nome,
      storeCompany?.nomeFantasia,
      storeCompany?.nome,
      store?.razaoSocial,
      storeCompany?.razaoSocial,
      snapshot.meta?.store,
      'Estabelecimento'
    );

    const secondaryCandidates = [
      store?.razaoSocial,
      storeCompany?.razaoSocial,
      storeCompany?.nomeFantasia,
      storeCompany?.nome,
      snapshot.meta?.store,
    ];
    const companySecondaryNameRaw = secondaryCandidates.find(
      (value) => typeof value === 'string' && value.trim() && value.trim() !== companyPrimaryName
    );
    const companySecondaryName = companySecondaryNameRaw ? companySecondaryNameRaw.trim() : '';

    const documents = [];
    const appendDocument = (value, label) => {
      const raw = (value ?? '').toString().trim();
      if (raw) {
        documents.push(`${label}: ${raw}`);
      }
    };
    appendDocument(store?.cnpj || storeCompany?.cnpj, 'CNPJ');
    appendDocument(store?.cpf || storeCompany?.cpf, 'CPF');
    appendDocument(
      store?.inscricaoEstadual || store?.ie || storeCompany?.inscricaoEstadual || storeCompany?.ie,
      'IE'
    );
    appendDocument(
      store?.inscricaoMunicipal || store?.im || storeCompany?.inscricaoMunicipal || storeCompany?.im,
      'IM'
    );
    appendDocument(store?.telefone || store?.celular || storeCompany?.telefone || storeCompany?.celular, 'Tel');
    const companyDocuments = documents.join(' • ');

    const street = pickValue(
      store?.logradouro,
      store?.endereco,
      store?.rua,
      storeCompany?.logradouro,
      storeCompany?.endereco,
      storeCompany?.rua
    );
    const number = pickValue(store?.numero, store?.num, storeCompany?.numero, storeCompany?.num);
    const mainAddress = [street, number].filter(Boolean).join(', ');
    const neighborhood = pickValue(store?.bairro, storeCompany?.bairro, store?.distrito, storeCompany?.distrito);
    const city = pickValue(
      store?.cidade,
      store?.municipio,
      storeCompany?.cidade,
      storeCompany?.municipio,
      store?.city,
      storeCompany?.city
    );
    const stateUf = pickValue(store?.uf, store?.estado, storeCompany?.uf, storeCompany?.estado);
    const cityLine = [city, stateUf].filter(Boolean).join(' - ');
    const cep = pickValue(store?.cep, storeCompany?.cep);
    const addressParts = [mainAddress, neighborhood, cityLine, cep ? `CEP: ${cep}` : '']
      .filter(Boolean)
      .map((value) => value.trim());
    const companyAddress = addressParts.join(' • ');

    const operatorShort = abbreviateOperatorName(snapshot.meta?.operador || '');
    const operatorMarkup = operatorShort
      ? `<div class="nfce-compact__operator"><span>Operador:</span><strong>${escapeHtml(operatorShort)}</strong></div>`
      : '';

    const referenceLeftParts = [];
    if (snapshot.meta?.pdv) referenceLeftParts.push(`PDV ${snapshot.meta.pdv}`);
    if (snapshot.meta?.saleCode) referenceLeftParts.push(`Venda ${snapshot.meta.saleCode}`);
    const referenceLeft = referenceLeftParts.join(' • ');
    const referenceRightParts = [];
    if (snapshot.meta?.data) referenceRightParts.push(snapshot.meta.data);
    const referenceRight = referenceRightParts.join(' • ');

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

    const headerDetails = [];
    if (snapshot.meta?.store && snapshot.meta.store !== companyPrimaryName) {
      headerDetails.push(snapshot.meta.store);
    }
    const headerDetailsMarkup = headerDetails.length
      ? `<ul class="nfce-compact__header-details">${headerDetails
          .map((detail) => `<li>${escapeHtml(detail)}</li>`)
          .join('')}</ul>`
      : '';
    const headerMetaContent = [referenceMarkup, headerDetailsMarkup].filter(Boolean).join('');
    const headerMeta = headerMetaContent ? `<div class="nfce-compact__header-meta">${headerMetaContent}</div>` : '';
    const headerDivider = headerMetaContent ? '<span class="nfce-compact__divider" aria-hidden="true"></span>' : '';

    const itemsRows = Array.isArray(snapshot.itens) && snapshot.itens.length
      ? snapshot.itens
          .map((item) => {
            const description = `${item.index ? `${item.index}. ` : ''}${item.nome || 'Item'}`;
            const quantity = `${item.quantidade} × ${item.unitario}`;
            const codes = item.codigo
              ? `<span class="nfce-compact__item-code">${escapeHtml(item.codigo)}</span>`
              : '';
            return `
              <tr>
                <td>
                  <span class="nfce-compact__item-name">${escapeHtml(description)}</span>
                  ${codes}
                </td>
                <td>${escapeHtml(quantity)}</td>
                <td>${escapeHtml(item.subtotal || '')}</td>
              </tr>`;
          })
          .join('')
      : '<tr><td colspan="3" class="nfce-compact__empty">Nenhum item informado.</td></tr>';

    const normalizeCurrency = (raw) => {
      if (typeof raw === 'string') return raw;
      if (raw == null) return '';
      return String(raw);
    };

    const totalsEntries = [];
    const subtotalValue = normalizeCurrency(snapshot.totais?.bruto).trim();
    if (subtotalValue) {
      totalsEntries.push({ label: 'Subtotal', value: subtotalValue });
    }

    const descontoValue = normalizeCurrency(snapshot.totais?.desconto).trim();
    if (snapshot.totais?.descontoValor > 0 && descontoValue) {
      totalsEntries.push({
        label: 'Descontos',
        value: descontoValue.startsWith('-') ? descontoValue : `- ${descontoValue}`,
      });
    }

    const acrescimoValue = normalizeCurrency(snapshot.totais?.acrescimo).trim();
    if (snapshot.totais?.acrescimoValor > 0 && acrescimoValue) {
      totalsEntries.push({ label: 'Acréscimos', value: acrescimoValue });
    }

    const totalValue = normalizeCurrency(snapshot.totais?.liquido).trim();
    if (totalValue) {
      totalsEntries.push({ label: 'Total da venda', value: totalValue, isTotal: true });
    }

    const pagoValue = normalizeCurrency(snapshot.totais?.pago).trim();
    if (pagoValue) {
      totalsEntries.push({ label: 'Pago', value: pagoValue });
    }

    const trocoValue = normalizeCurrency(snapshot.totais?.troco).trim();
    if (snapshot.totais?.trocoValor > 0 && trocoValue) {
      totalsEntries.push({ label: 'Troco', value: trocoValue });
    }

    const totalsRows = totalsEntries
      .map(
        (row) => `
          <li class="nfce-compact__total${row.isTotal ? ' nfce-compact__total--highlight' : ''}">
            <span>${escapeHtml(row.label)}</span>
            <span>${escapeHtml(row.value)}</span>
          </li>`
      )
      .join('');

    const totalsMarkup = totalsRows
      ? `<ul class="nfce-compact__totals-list">${totalsRows}</ul>`
      : '<p class="nfce-compact__empty">Totais indisponíveis.</p>';

    const pagamentosRows = Array.isArray(snapshot.pagamentos?.items) && snapshot.pagamentos.items.length
      ? snapshot.pagamentos.items
          .map(
            (payment) => `
              <li class="nfce-compact__total">
                <span>${escapeHtml(payment.label)}</span>
                <span>${escapeHtml(payment.formatted)}</span>
              </li>`
          )
          .join('')
      : '';

    const pagamentosMarkup = pagamentosRows
      ? `<ul class="nfce-compact__totals-list">${pagamentosRows}</ul>`
      : '<p class="nfce-compact__empty">Nenhum pagamento registrado.</p>';

    const clienteLines = [];
    if (snapshot.cliente?.nome) clienteLines.push(snapshot.cliente.nome);
    if (snapshot.cliente?.documento) clienteLines.push(`Doc.: ${snapshot.cliente.documento}`);
    if (snapshot.cliente?.contato) clienteLines.push(`Contato: ${snapshot.cliente.contato}`);
    if (snapshot.cliente?.endereco) clienteLines.push(`End.: ${snapshot.cliente.endereco}`);
    if (snapshot.cliente?.pet) clienteLines.push(`Pet: ${snapshot.cliente.pet}`);
    const clienteSection = clienteLines.length
      ? `<section class="nfce-compact__section nfce-compact__section--info">
          <h2 class="nfce-compact__section-title">Cliente</h2>
          <p class="nfce-compact__text">${clienteLines.map((line) => escapeHtml(line)).join('<br>')}</p>
        </section>`
      : '';

    const deliveryLines = [];
    if (snapshot.delivery?.apelido) deliveryLines.push(snapshot.delivery.apelido);
    if (snapshot.delivery?.formatted) deliveryLines.push(snapshot.delivery.formatted);
    const deliverySection = deliveryLines.length
      ? `<section class="nfce-compact__section nfce-compact__section--info">
          <h2 class="nfce-compact__section-title">Entrega</h2>
          <p class="nfce-compact__text">${deliveryLines.map((line) => escapeHtml(line)).join('<br>')}</p>
        </section>`
      : '';

    const thankYouSection = `<section class="nfce-compact__section">
        <p class="nfce-compact__text">Obrigado pela preferência! Volte sempre.</p>
      </section>`;

    return `
      <main class="receipt receipt--nfce nfce-compact nfce-compact--matricial">
        <header class="nfce-compact__header">
          ${operatorMarkup}
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
          ${headerDivider}
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
            <tbody>${itemsRows}</tbody>
          </table>
        </section>
        <section class="nfce-compact__section nfce-compact__section--totals">
          <h2 class="nfce-compact__section-title">Totais</h2>
          ${totalsMarkup}
        </section>
        <section class="nfce-compact__section nfce-compact__section--payments">
          <h2 class="nfce-compact__section-title">Pagamentos</h2>
          ${pagamentosMarkup}
        </section>
        ${clienteSection}
        ${deliverySection}
        ${thankYouSection}
      </main>`;
  };

  const buildSaleReceiptMarkup = (snapshot, variant) => {
    if (!snapshot) {
      return '<main class="receipt"><p class="receipt-empty">Nenhuma venda disponível para impressão.</p></main>';
    }

    if (variant === 'matricial') {
      return buildMatricialReceiptMarkup(snapshot);
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
              ${snapshot.cliente.endereco
                ? `<li class="receipt-row"><span class="receipt-row__label">Endereço</span><span class="receipt-row__value">${escapeHtml(snapshot.cliente.endereco)}</span></li>`
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

  const normalizeCashContributions = (entries) => {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const amount = safeNumber(entry.amount ?? entry.valor ?? entry.total ?? 0);
        if (!(amount > 0)) return null;
        const paymentTypeRaw =
          entry.paymentType ?? entry.type ?? entry.paymentMethodType ?? entry.methodType ?? entry.forma ?? '';
        const paymentType =
          typeof paymentTypeRaw === 'string'
            ? paymentTypeRaw.toLowerCase().trim()
            : String(paymentTypeRaw || '').toLowerCase().trim();
        return {
          paymentId: entry.paymentId || entry.id || '',
          paymentLabel: entry.paymentLabel || entry.label || 'Pagamento',
          paymentType,
          amount,
        };
      })
      .filter(Boolean);
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
    receivables = [],
    cashContributions = [],
    appointmentId = '',
  } = {}) => {
    const normalizedType = type === 'delivery' ? 'delivery' : 'venda';
    const typeLabel = normalizedType === 'delivery' ? 'Delivery' : 'Venda';
    const normalizedAppointmentId = normalizeId(appointmentId);
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
    const normalizedCashContributions = normalizeCashContributions(cashContributions);

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
      receivables: Array.isArray(receivables)
        ? receivables.map((entry) => ({ ...entry }))
        : [],
      expanded: false,
      status: 'completed',
      cancellationReason: '',
      cancellationAt: null,
      cancellationAtLabel: '',
      inventoryProcessed: false,
      inventoryProcessedAt: null,
      cashContributions: normalizedCashContributions,
      appointmentId: normalizedAppointmentId,
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
        const emitindoBadge = `<span class="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><i class="fas fa-circle-notch fa-spin text-[11px]"></i><span>Emitindo...</span></span>`;
        const resetButton = `<button type="button" class="inline-flex items-center gap-2 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-600 transition hover:border-amber-300 hover:text-amber-700" data-sale-fiscal-reset data-sale-id="${escapeHtml(
          saleId
        )}"><i class="fas fa-rotate-left text-[11px]"></i><span>Reiniciar emissão</span></button>`;
        fiscalControl = `<div class="flex flex-wrap items-center gap-2">${emitindoBadge}${resetButton}</div>`;
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

  const findBudgetById = (budgetId) => {
    if (!budgetId) return null;
    return state.budgets.find((budget) => budget.id === budgetId) || null;
  };

  const getBudgetCustomerLabel = (budget) => {
    if (!budget) return 'Cliente não informado';
    const customer = budget.customer || {};
    return (
      customer.nome ||
      customer.nomeFantasia ||
      customer.razaoSocial ||
      customer.fantasia ||
      'Cliente não informado'
    );
  };

  const isBudgetFinalized = (budget) => {
    const status = budget?.status ? String(budget.status).toLowerCase() : '';
    return status === 'finalizado' || status === 'finalizada';
  };

  const describeBudgetStatus = (budget) => {
    if (!budget) return '—';
    if (isBudgetFinalized(budget)) {
      if (budget.finalizedAt) {
        const label = toDateLabel(budget.finalizedAt);
        return label ? `Finalizado em ${label}` : 'Finalizado';
      }
      return 'Finalizado';
    }
    const status = budget.status ? String(budget.status).toLowerCase() : 'aberto';
    if (status === 'cancelado' || status === 'cancelada') {
      return 'Cancelado';
    }
    return 'Aberto';
  };

  const getBudgetValidityLabel = (budget) => {
    if (!budget) return '—';
    const days = clampBudgetValidityDays(budget.validityDays);
    const untilIso = budget.validUntil || '';
    if (!untilIso) {
      return `${days} ${days === 1 ? 'dia' : 'dias'}`;
    }
    const label = toDateLabel(untilIso);
    return `${label} (${days} ${days === 1 ? 'dia' : 'dias'})`;
  };

  const describeBudgetPayments = (budget) => {
    if (!budget) return '';
    if (budget.paymentLabel) return budget.paymentLabel;
    const payments = Array.isArray(budget.payments) ? budget.payments : [];
    return describeSalePayments(payments);
  };

  const getBudgetNetTotal = (budget) => {
    if (!budget) return 0;
    const total = safeNumber(budget.total ?? 0);
    const addition = safeNumber(budget.addition ?? 0);
    const discount = safeNumber(budget.discount ?? 0);
    return total + addition - discount;
  };

  const computeBudgetKpis = () => {
    const budgets = Array.isArray(state.budgets) ? state.budgets : [];
    const now = new Date();
    const todayStart = toStartOfDay(now);
    const todayEnd = toEndOfDay(now);
    const weekStart = toStartOfDay(new Date(now.getTime() - 6 * MS_PER_DAY));
    const monthStart = toStartOfDay(new Date(now.getTime() - 29 * MS_PER_DAY));
    let today = 0;
    let week = 0;
    let month = 0;
    budgets.forEach((budget) => {
      const createdAt = budget.createdAt ? new Date(budget.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return;
      if (isDateWithinRange(createdAt, todayStart, todayEnd)) {
        today += 1;
      }
      if (isDateWithinRange(createdAt, weekStart, todayEnd)) {
        week += 1;
      }
      if (isDateWithinRange(createdAt, monthStart, todayEnd)) {
        month += 1;
      }
    });
    return { today, week, month, all: budgets.length };
  };

  const getFilteredBudgets = () => {
    const budgets = Array.isArray(state.budgets) ? state.budgets : [];
    const filters = state.budgetFilters || { preset: 'todos', start: '', end: '' };
    const now = new Date();
    let start = null;
    let end = null;
    if (filters.preset === 'hoje') {
      start = toStartOfDay(now);
      end = toEndOfDay(now);
    } else if (filters.preset === 'semana') {
      start = toStartOfDay(new Date(now.getTime() - 6 * MS_PER_DAY));
      end = toEndOfDay(now);
    } else if (filters.preset === 'mes') {
      start = toStartOfDay(new Date(now.getTime() - 29 * MS_PER_DAY));
      end = toEndOfDay(now);
    } else if (filters.preset === 'custom') {
      const parsedStart = parseDateInputValue(filters.start || '') || null;
      const parsedEnd = parseDateInputValue(filters.end || '') || null;
      start = parsedStart ? toStartOfDay(parsedStart) : null;
      end = parsedEnd ? toEndOfDay(parsedEnd) : null;
    }
    const filtered = start || end
      ? budgets.filter((budget) => {
          const createdAt = budget.createdAt ? new Date(budget.createdAt) : null;
          if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
          return isDateWithinRange(createdAt, start, end);
        })
      : budgets;
    return filtered
      .slice()
      .sort((a, b) => getTimeValue(b.updatedAt || b.createdAt) - getTimeValue(a.updatedAt || a.createdAt));
  };

  const renderBudgetFilters = () => {
    if (elements.budgetPresets) {
      const buttons = elements.budgetPresets.querySelectorAll('[data-budget-preset]');
      buttons.forEach((button) => {
        const preset = button.getAttribute('data-budget-preset');
        const active = preset && state.budgetFilters.preset === preset;
        button.classList.toggle('border-primary', active);
        button.classList.toggle('text-primary', active);
        button.classList.toggle('bg-primary/10', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (elements.budgetStart) {
      elements.budgetStart.value = state.budgetFilters.start || '';
    }
    if (elements.budgetEnd) {
      elements.budgetEnd.value = state.budgetFilters.end || '';
    }
  };

  const renderBudgetKpis = () => {
    const kpis = computeBudgetKpis();
    if (elements.budgetKpiToday) {
      elements.budgetKpiToday.textContent = String(kpis.today);
    }
    if (elements.budgetKpiWeek) {
      elements.budgetKpiWeek.textContent = String(kpis.week);
    }
    if (elements.budgetKpiMonth) {
      elements.budgetKpiMonth.textContent = String(kpis.month);
    }
    if (elements.budgetKpiAll) {
      elements.budgetKpiAll.textContent = String(kpis.all);
    }
  };

  const renderBudgetList = () => {
    if (!elements.budgetList || !elements.budgetEmpty) return;
    const budgets = getFilteredBudgets();
    const hasBudgets = budgets.length > 0;
    elements.budgetList.innerHTML = '';
    elements.budgetEmpty.classList.toggle('hidden', hasBudgets);
    if (elements.budgetCount) {
      const countLabel = budgets.length === 1 ? '1 registro' : `${budgets.length} registros`;
      elements.budgetCount.textContent = countLabel;
    }
    if (!hasBudgets) {
      if (state.selectedBudgetId) {
        state.selectedBudgetId = '';
        renderBudgetDetails();
      }
      return;
    }
    if (state.selectedBudgetId && !budgets.some((budget) => budget.id === state.selectedBudgetId)) {
      state.selectedBudgetId = '';
    }
    const fragment = document.createDocumentFragment();
    budgets.forEach((budget) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-budget-id', budget.id);
      tr.className = 'cursor-pointer transition hover:bg-primary/5';
      const finalized = isBudgetFinalized(budget);
      if (budget.id === state.selectedBudgetId) {
        tr.classList.add('bg-primary/10');
      }
      if (finalized) {
        tr.classList.add('bg-gray-50');
      }
      const validityLabel = escapeHtml(getBudgetValidityLabel(budget));
      const statusBadge = finalized
        ? ' <span class="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Finalizado</span>'
        : '';
      tr.innerHTML = `
        <td class="px-4 py-3 font-semibold text-gray-700">${escapeHtml(budget.code)}</td>
        <td class="px-4 py-3 text-gray-600">${escapeHtml(getBudgetCustomerLabel(budget))}</td>
        <td class="px-4 py-3 text-gray-600">${validityLabel}${statusBadge}</td>
      `;
      fragment.appendChild(tr);
    });
    elements.budgetList.appendChild(fragment);
  };

  const renderBudgetDetails = () => {
    const budget = findBudgetById(state.selectedBudgetId);
    const hasBudget = Boolean(budget);
    const budgetFinalized = isBudgetFinalized(budget);
    if (elements.budgetImport) {
      const canImport = hasBudget && !budgetFinalized;
      elements.budgetImport.disabled = !canImport;
      if (!hasBudget) {
        elements.budgetImport.textContent = budgetImportDefaultLabel;
        elements.budgetImport.title = '';
      } else if (budgetFinalized) {
        elements.budgetImport.textContent = BUDGET_IMPORT_FINALIZED_LABEL;
        elements.budgetImport.title = 'Este orçamento já foi finalizado e não pode ser importado novamente.';
      } else {
        elements.budgetImport.textContent = budgetImportDefaultLabel;
        elements.budgetImport.title = 'Importe este orçamento para o PDV.';
      }
    }
    if (elements.budgetDelete) {
      elements.budgetDelete.disabled = !hasBudget;
    }
    if (!budget) {
      if (elements.budgetCode) elements.budgetCode.textContent = '—';
      if (elements.budgetCustomer) elements.budgetCustomer.textContent = '—';
      if (elements.budgetValidity) elements.budgetValidity.textContent = '—';
      if (elements.budgetStatus) elements.budgetStatus.textContent = '—';
      if (elements.budgetTotal) elements.budgetTotal.textContent = formatCurrency(0);
      if (elements.budgetItems) elements.budgetItems.innerHTML = '';
      if (elements.budgetItemsEmpty) elements.budgetItemsEmpty.classList.remove('hidden');
      if (elements.budgetDetailsHint) {
        elements.budgetDetailsHint.textContent = 'Selecione um orçamento para visualizar os detalhes.';
      }
      return;
    }
    if (elements.budgetCode) {
      elements.budgetCode.textContent = budget.code;
    }
    if (elements.budgetCustomer) {
      elements.budgetCustomer.textContent = getBudgetCustomerLabel(budget);
    }
    if (elements.budgetValidity) {
      elements.budgetValidity.textContent = getBudgetValidityLabel(budget);
    }
    if (elements.budgetStatus) {
      elements.budgetStatus.textContent = describeBudgetStatus(budget);
    }
    if (elements.budgetTotal) {
      elements.budgetTotal.textContent = formatCurrency(getBudgetNetTotal(budget));
    }
    if (elements.budgetDetailsHint) {
      const paymentsLabel = describeBudgetPayments(budget);
      const messages = [];
      if (paymentsLabel) {
        messages.push(`Pagamentos sugeridos: ${paymentsLabel}.`);
      } else {
        messages.push('Nenhum pagamento sugerido para este orçamento.');
      }
      if (budgetFinalized) {
        messages.push('Este orçamento foi finalizado e não pode ser importado novamente.');
      }
      elements.budgetDetailsHint.textContent = messages.join(' ');
    }
    if (elements.budgetItems) {
      elements.budgetItems.innerHTML = '';
      const items = Array.isArray(budget.items) ? budget.items : [];
      if (!items.length) {
        if (elements.budgetItemsEmpty) elements.budgetItemsEmpty.classList.remove('hidden');
      } else {
        if (elements.budgetItemsEmpty) elements.budgetItemsEmpty.classList.add('hidden');
        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => {
          const tr = document.createElement('tr');
          const quantityValue = safeNumber(item?.quantidade ?? item?.qtd ?? 0);
          const quantityLabel = quantityValue.toLocaleString('pt-BR', {
            minimumFractionDigits: Number.isInteger(quantityValue) ? 0 : 2,
            maximumFractionDigits: 3,
          });
          const unitValue = safeNumber(item?.valor ?? item?.valorUnitario ?? 0);
          const subtotalValue = safeNumber(item?.subtotal ?? item?.total ?? unitValue * quantityValue);
          const discountValue = safeNumber(item?.desconto ?? 0);
          tr.innerHTML = `
            <td class="px-4 py-3 text-gray-600">${escapeHtml(item?.codigoBarras || item?.codigo || '—')}</td>
            <td class="px-4 py-3 text-gray-700">${escapeHtml(item?.nome || item?.descricao || `Item ${index + 1}`)}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(quantityLabel)}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(formatCurrency(unitValue))}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(formatCurrency(discountValue))}</td>
            <td class="px-4 py-3 text-gray-600">${escapeHtml(formatCurrency(subtotalValue))}</td>
          `;
          fragment.appendChild(tr);
        });
        elements.budgetItems.appendChild(fragment);
      }
    }
  };

  const renderBudgets = () => {
    renderBudgetFilters();
    renderBudgetKpis();
    renderBudgetList();
    renderBudgetDetails();
  };

  const cloneAppointmentRecord = (appointment) => {
    if (!appointment || typeof appointment !== 'object') return null;
    return {
      ...appointment,
      services: Array.isArray(appointment.services)
        ? appointment.services.map((service) => ({ ...service }))
        : [],
    };
  };
  const getAppointmentStatusMeta = (status) => {
    const normalized = (status || 'agendado').toLowerCase();
    const map = {
      agendado: { label: 'Agendado', badgeClass: 'bg-blue-100 text-blue-700' },
      em_espera: { label: 'Em espera', badgeClass: 'bg-amber-100 text-amber-700' },
      em_atendimento: { label: 'Em atendimento', badgeClass: 'bg-indigo-100 text-indigo-700' },
      finalizado: { label: 'Finalizado', badgeClass: 'bg-emerald-100 text-emerald-700' },
      cancelado: { label: 'Cancelado', badgeClass: 'bg-rose-100 text-rose-700' },
    };
    return map[normalized] || { label: 'Status indeterminado', badgeClass: 'bg-gray-100 text-gray-600' };
  };
  const normalizeAppointmentRecord = (appointment) => {
    if (!appointment || typeof appointment !== 'object') return null;
    const id = normalizeId(appointment._id || appointment.id);
    if (!id) return null;
    const scheduledIso =
      parseDateValue(
        appointment.scheduledAt ||
          appointment.h ||
          appointment.data ||
          appointment.scheduled_at ||
          appointment.date ||
          appointment.scheduledAtIso
      ) || null;
    const servicesSource = Array.isArray(appointment.servicos)
      ? appointment.servicos
      : Array.isArray(appointment.itens)
      ? appointment.itens
      : [];
    const services = servicesSource
      .map((service, index) => {
        const serviceData =
          service && typeof service === 'object' && service.servico && typeof service.servico === 'object'
            ? service.servico
            : service || {};
        const serviceId =
          normalizeId(service?._id || service?.id || serviceData?._id || serviceData?.id) ||
          `${id}:svc:${index}`;
        const quantidade =
          safeNumber(service?.quantidade ?? service?.qtd ?? serviceData?.quantidade ?? 1) || 1;
        const unitValue = safeNumber(
          service?.valor ??
            service?.preco ??
            service?.price ??
            serviceData?.valor ??
            serviceData?.preco ??
            serviceData?.price ??
            0
        );
        return {
          id: serviceId,
          nome:
            serviceData?.nome ||
            service?.nome ||
            service?.descricao ||
            service?.descricaoServico ||
            `Serviço ${index + 1}`,
          quantidade,
          valor: unitValue,
          subtotal: unitValue * quantidade,
        };
      })
      .filter(Boolean);
    const totalInformado = safeNumber(
      appointment.total ||
        appointment.valor ||
        appointment.valorTotal ||
        appointment.price ||
        appointment.totalValue ||
        0
    );
    const totalCalculado = services.reduce((sum, service) => sum + safeNumber(service.subtotal), 0);
    const total = totalCalculado > 0 ? totalCalculado : totalInformado;
    return {
      id,
      storeId: normalizeId(
        appointment.storeId ||
          appointment.store ||
          appointment.store?._id ||
          appointment.empresa ||
          appointment.loja
      ),
      customerId: normalizeId(
        appointment.clienteId ||
          appointment.customerId ||
          appointment.cliente?._id ||
          appointment.cliente?.id ||
          appointment.cliente?._id
      ),
      customerName:
        appointment.clienteNome ||
        appointment.customerName ||
        appointment.tutor ||
        appointment.tutorNome ||
        appointment.tutor?.nomeCompleto ||
        appointment.tutor?.nomeContato ||
        appointment.tutor?.razaoSocial ||
        appointment.tutor?.nome ||
        appointment.cliente?.nomeCompleto ||
        appointment.cliente?.nomeContato ||
        appointment.cliente?.razaoSocial ||
        appointment.cliente?.nome ||
        '',
      customerDocument:
        appointment.cliente?.cpf ||
        appointment.cliente?.cnpj ||
        appointment.cliente?.documento ||
        appointment.clienteDocumento ||
        appointment.documento ||
        '',
      customerEmail:
        appointment.cliente?.email ||
        appointment.email ||
        appointment.tutorEmail ||
        appointment.emailTutor ||
        appointment.clienteEmail ||
        '',
      customerPhone:
        appointment.cliente?.celular ||
        appointment.cliente?.telefone ||
        appointment.telefone ||
        appointment.celular ||
        appointment.telefoneTutor ||
        appointment.celularTutor ||
        appointment.tutorTelefone ||
        appointment.tutorCelular ||
        appointment.clienteCelular ||
        appointment.clienteTelefone ||
        '',
      petId: normalizeId(appointment.petId || appointment.pet?._id),
      petName:
        appointment.petNome || appointment.petName || appointment.pet?.nome || appointment.pet || '',
      services,
      total,
      status: (appointment.status || 'agendado').toLowerCase(),
      scheduledAt: scheduledIso,
      notes:
        appointment.observacoes ||
        appointment.obs ||
        appointment.anotacoes ||
        appointment.notes ||
        '',
      paid: Boolean(appointment.pago || appointment.paid || appointment.quitado),
      saleCode: appointment.codigoVenda || appointment.saleCode || '',
      professionalId: normalizeId(
        appointment.profissionalId ||
          appointment.professionalId ||
          appointment.profissional?._id ||
          appointment.profissional?.id
      ),
      professionalName:
        appointment.profissionalNome ||
        appointment.profissional ||
        appointment.professionalName ||
        appointment.professional ||
        appointment.profissional?.nomeCompleto ||
        appointment.profissional?.nomeContato ||
        appointment.profissional?.razaoSocial ||
        '',
      updatedAt: parseDateValue(appointment.updatedAt || appointment.atualizadoEm),
    };
  };
  const findAppointmentById = (appointmentId) => {
    const normalized = normalizeId(appointmentId);
    if (!normalized) return null;
    const inState = state.appointments.find((item) => item.id === normalized);
    if (inState) return cloneAppointmentRecord(inState);
    for (const list of appointmentCache.values()) {
      const found = list.find((item) => item.id === normalized);
      if (found) {
        return cloneAppointmentRecord(found);
      }
    }
    return null;
  };
  const getAppointmentRangeFromFilters = (filters = state.appointmentFilters) => {
    const preset = (filters?.preset || 'today').toLowerCase();
    if (preset === 'custom') {
      const startValue = filters.start || '';
      const endValue = filters.end || '';
      const startInput = parseDateInputValue(startValue);
      const endInput = parseDateInputValue(endValue);
      if (!startInput || !endInput) return null;
      let startDate = toStartOfDay(startInput);
      let endDate = toStartOfDay(endInput);
      if (!startDate || !endDate) return null;
      if (startDate.getTime() > endDate.getTime()) {
        const temp = startDate;
        startDate = endDate;
        endDate = temp;
      }
      const endExclusive = addDays(endDate, 1);
      return {
        preset,
        startDate,
        endDate,
        startParam: formatDateParam(startDate),
        endParam: formatDateParam(endExclusive),
      };
    }
    const reference = new Date();
    let startDate = null;
    let endExclusive = null;
    if (preset === 'week') {
      startDate = startOfWeek(reference);
      endExclusive = endOfWeek(reference);
    } else if (preset === 'month') {
      startDate = startOfMonth(reference);
      endExclusive = endOfMonth(reference);
    } else {
      startDate = toStartOfDay(reference);
      endExclusive = addDays(startDate, 1);
    }
    if (!startDate || !endExclusive) return null;
    const endDate = addDays(endExclusive, -1);
    return {
      preset,
      startDate,
      endDate,
      startParam: formatDateParam(startDate),
      endParam: formatDateParam(endExclusive),
    };
  };
  const loadAppointmentsDataset = async ({ startParam, endParam, storeId, force = false }) => {
    const normalizedStoreId = storeId ? normalizeId(storeId) : '';
    const key = `${normalizedStoreId || 'all'}|${startParam}|${endParam}`;
    if (!force && appointmentCache.has(key)) {
      return appointmentCache
        .get(key)
        .map((item) => cloneAppointmentRecord(item))
        .filter(Boolean);
    }
    const params = new URLSearchParams();
    if (startParam) params.set('start', startParam);
    if (endParam) params.set('end', endParam);
    if (normalizedStoreId) params.set('storeId', normalizedStoreId);
    params.set('status', 'all');
    params.set('includePaid', '1');
    const token = getToken();
    const payload = await fetchWithOptionalAuth(
      `${API_BASE}/func/agendamentos/range?${params.toString()}`,
      {
        token,
        errorMessage: 'Não foi possível carregar os atendimentos da agenda.',
      }
    );
    const rawList = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.agendamentos)
      ? payload.agendamentos
      : Array.isArray(payload?.appointments)
      ? payload.appointments
      : [];
    const normalized = rawList.map((item) => normalizeAppointmentRecord(item)).filter(Boolean);
    appointmentCache.set(
      key,
      normalized.map((item) => cloneAppointmentRecord(item)).filter(Boolean)
    );
    return normalized.map((item) => cloneAppointmentRecord(item)).filter(Boolean);
  };
  const refreshAppointmentMetrics = async ({ force = false } = {}) => {
    const storeId = getActiveAppointmentStoreId();
    if (!storeId) {
      state.appointmentMetrics = { today: 0, week: 0, month: 0 };
      return;
    }
    const presets = ['today', 'week', 'month'];
    for (const preset of presets) {
      const range = getAppointmentRangeFromFilters({ preset });
      if (!range) continue;
      try {
        const dataset = await loadAppointmentsDataset({
          startParam: range.startParam,
          endParam: range.endParam,
          storeId,
          force,
        });
        state.appointmentMetrics[preset] = dataset.length;
      } catch (error) {
        console.error('Erro ao atualizar indicadores de atendimentos:', error);
      }
    }
  };
  const renderAppointmentFilters = () => {
    const filters = state.appointmentFilters || { preset: 'today', start: '', end: '' };
    if (elements.appointmentPresets) {
      const buttons = elements.appointmentPresets.querySelectorAll('[data-appointment-preset]');
      buttons.forEach((button) => {
        const preset = button.getAttribute('data-appointment-preset');
        const isActive = preset === filters.preset && preset !== 'custom';
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.classList.toggle('border-primary', isActive);
        button.classList.toggle('text-primary', isActive);
        button.classList.toggle('bg-primary/10', isActive);
        button.classList.toggle('border-gray-200', !isActive);
        button.classList.toggle('bg-white', !isActive);
        button.classList.toggle('text-gray-600', !isActive);
      });
    }
    if (elements.appointmentStart) {
      elements.appointmentStart.value = filters.start || '';
    }
    if (elements.appointmentEnd) {
      elements.appointmentEnd.value = filters.end || '';
    }
    if (elements.appointmentCount) {
      const count = state.appointments.length;
      const label = count === 1 ? '1 atendimento encontrado.' : `${count} atendimentos encontrados.`;
      elements.appointmentCount.textContent = label;
    }
  };
  const renderAppointmentList = () => {
    if (!elements.appointmentList || !elements.appointmentEmpty || !elements.appointmentLoading) return;
    const scrollContainer = elements.appointmentScrollContainer;
    const maybeResetScroll = (smooth = false) => {
      if (!state.appointmentScrollPending) return;
      if (scrollContainer) {
        if (typeof scrollContainer.scrollTo === 'function') {
          scrollContainer.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
        } else {
          scrollContainer.scrollTop = 0;
        }
      }
      state.appointmentScrollPending = false;
    };
    elements.appointmentLoading.classList.toggle('hidden', !state.appointmentsLoading);
    if (state.appointmentsLoading) {
      elements.appointmentEmpty.classList.add('hidden');
      elements.appointmentList.innerHTML = '';
      maybeResetScroll(false);
      return;
    }
    const appointments = Array.isArray(state.appointments) ? state.appointments : [];
    if (!appointments.length) {
      elements.appointmentList.innerHTML = '';
      elements.appointmentEmpty.classList.remove('hidden');
      maybeResetScroll(false);
      return;
    }
    elements.appointmentEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    appointments.forEach((appointment) => {
      const isActive = state.activeAppointmentId && state.activeAppointmentId === appointment.id;
      const alreadyPaid = Boolean(appointment.paid || appointment.saleCode);
      const scheduleLabel = getAppointmentScheduleLabel(appointment);
      const statusMeta = getAppointmentStatusMeta(appointment.status);
      const paidBadge = appointment.paid
        ? '<span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"><i class="fas fa-check-circle"></i><span>Pago</span></span>'
        : '';
      const saleBadge = appointment.saleCode
        ? `<span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Venda ${escapeHtml(appointment.saleCode)}</span>`
        : '';
      const services = Array.isArray(appointment.services) ? appointment.services : [];
      const serviceBadges = services.slice(0, 4).map((service) => `
          <span class="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600">
            <i class="fas fa-paw"></i>
            <span>${escapeHtml(service.nome || 'Serviço')}</span>
          </span>
        `);
      const extraServices = services.length > 4 ? services.length - 4 : 0;
      if (!services.length) {
        serviceBadges.push('<span class="text-xs text-gray-500">Nenhum serviço vinculado ao atendimento.</span>');
      } else if (extraServices > 0) {
        serviceBadges.push(
          `<span class="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-500">+${extraServices} serviço(s)</span>`
        );
      }
      const professionalLine = appointment.professionalName
        ? `<p class="text-xs text-gray-500">Profissional: ${escapeHtml(appointment.professionalName)}</p>`
        : '';
      const notes = appointment.notes
        ? `<p class="text-xs text-gray-500 italic">Obs.: ${escapeHtml(appointment.notes)}</p>`
        : '';
      const buttonDisabled = alreadyPaid && !isActive;
      const buttonClasses = buttonDisabled
        ? 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-400 cursor-not-allowed'
        : 'inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20';
      const buttonLabel = buttonDisabled
        ? appointment.saleCode
          ? `Venda ${escapeHtml(appointment.saleCode)}`
          : 'Atendimento pago'
        : isActive
        ? 'Atendimento selecionado'
        : 'Importar serviços';
      const buttonAttributes = buttonDisabled
        ? 'type="button" disabled'
        : `type="button" data-appointment-import="${escapeHtml(appointment.id)}"`;
      const card = document.createElement('article');
      card.dataset.appointmentId = appointment.id;
      card.className = `rounded-xl border ${
        isActive ? 'border-primary shadow-lg shadow-primary/10' : 'border-gray-200'
      } bg-white p-4 transition`;
      card.innerHTML = `
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              <i class="fas fa-clock"></i>
              <span>${escapeHtml(scheduleLabel)}</span>
            </span>
            <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${escapeHtml(
              statusMeta.badgeClass
            )}">
              <i class="fas fa-calendar-check"></i>
              <span>${escapeHtml(statusMeta.label)}</span>
            </span>
            ${paidBadge}
            ${saleBadge}
          </div>
          <button ${buttonAttributes} class="${buttonClasses}">
            <i class="fas fa-file-import"></i>
            <span>${escapeHtml(buttonLabel)}</span>
          </button>
        </div>
        <div class="mt-3 space-y-2">
          <div>
            <p class="text-sm font-semibold text-gray-800">${escapeHtml(
              appointment.customerName || 'Cliente não informado'
            )}</p>
            <p class="text-xs text-gray-500">${
              appointment.petName
                ? `Pet: ${escapeHtml(appointment.petName)}`
                : 'Pet não informado'
            }</p>
            ${professionalLine}
          </div>
          <div class="flex flex-wrap gap-2">${serviceBadges.join('')}</div>
          ${notes}
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
          <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">Total</span>
          <span class="text-base font-semibold text-gray-800">${formatCurrency(appointment.total)}</span>
        </div>
      `;
      fragment.appendChild(card);
    });
    elements.appointmentList.innerHTML = '';
    elements.appointmentList.appendChild(fragment);
    maybeResetScroll(true);
  };
  const renderAppointments = () => {
    renderAppointmentFilters();
    renderAppointmentList();
  };
  const openAppointmentModal = async () => {
    if (!elements.appointmentModal) return;
    elements.appointmentModal.classList.remove('hidden');
    renderAppointments();
    try {
      await loadAppointmentsForCurrentFilter();
    } catch (error) {
      console.error('Erro ao carregar atendimentos na abertura do modal:', error);
    }
    refreshAppointmentMetrics().catch((error) =>
      console.error('Erro ao atualizar métricas de atendimentos:', error)
    );
  };
  const closeAppointmentModal = () => {
    if (!elements.appointmentModal) return;
    elements.appointmentModal.classList.add('hidden');
  };
  const cloneCustomerDetailsForAppointment = (customer) => {
    if (!customer || typeof customer !== 'object') return null;
    const clone = { ...customer };
    if (customer.financeiro && typeof customer.financeiro === 'object') {
      clone.financeiro = { ...customer.financeiro };
    }
    if (customer.contato && typeof customer.contato === 'object') {
      clone.contato = { ...customer.contato };
    }
    return clone;
  };
  const matchesCustomerId = (record, targetId) => {
    if (!record || !targetId) return false;
    const recordId =
      resolveCustomerId(record) ||
      normalizeId(record._id || record.id || record.codigo || record.codigoInterno);
    return recordId === targetId;
  };
  const getCachedCustomerDetailsForAppointment = (customerId) => {
    const normalizedId = normalizeId(customerId);
    if (!normalizedId) return null;
    const directCandidates = [
      state.vendaCliente,
      state.modalSelectedCliente,
      state.receivablesSelectedCustomer,
    ];
    for (const candidate of directCandidates) {
      if (matchesCustomerId(candidate, normalizedId)) {
        return cloneCustomerDetailsForAppointment(candidate);
      }
    }
    if (Array.isArray(state.customerSearchResults)) {
      for (const entry of state.customerSearchResults) {
        if (matchesCustomerId(entry, normalizedId)) {
          return cloneCustomerDetailsForAppointment(entry);
        }
      }
    }
    if (customerReceivablesDetailsCache.has(normalizedId)) {
      return cloneReceivablesCustomerDetails(customerReceivablesDetailsCache.get(normalizedId));
    }
    if (appointmentCustomerCache.has(normalizedId)) {
      return cloneCustomerDetailsForAppointment(appointmentCustomerCache.get(normalizedId));
    }
    return null;
  };
  const fetchAppointmentCustomerDetails = async (customerId) => {
    const normalizedId = normalizeId(customerId);
    if (!normalizedId) return null;
    if (appointmentCustomerCache.has(normalizedId)) {
      return cloneCustomerDetailsForAppointment(appointmentCustomerCache.get(normalizedId));
    }
    if (appointmentCustomerRequestCache.has(normalizedId)) {
      const pending = await appointmentCustomerRequestCache.get(normalizedId);
      return pending ? cloneCustomerDetailsForAppointment(pending) : null;
    }
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const request = (async () => {
      try {
        const response = await fetch(`${API_BASE}/func/clientes/${normalizedId}`, { headers });
        if (!response.ok) {
          return null;
        }
        const payload = await response.json();
        if (!payload || typeof payload !== 'object') {
          return null;
        }
        const details = cloneReceivablesCustomerDetails(payload);
        appointmentCustomerCache.set(normalizedId, details);
        if (!customerReceivablesDetailsCache.has(normalizedId)) {
          customerReceivablesDetailsCache.set(normalizedId, details);
        }
        return details;
      } catch (error) {
        console.error('Erro ao carregar detalhes do cliente do atendimento:', error);
        return null;
      } finally {
        appointmentCustomerRequestCache.delete(normalizedId);
      }
    })();
    appointmentCustomerRequestCache.set(normalizedId, request);
    const resolved = await request;
    return resolved ? cloneCustomerDetailsForAppointment(resolved) : null;
  };
  const mergeCustomerDetailsIntoSaleCustomer = (customer, details) => {
    if (!customer || !details) return customer;
    const resolvedId =
      resolveCustomerId(details) ||
      normalizeId(details._id || details.id || details.codigo || details.codigoInterno);
    if (resolvedId) {
      customer._id = customer._id || resolvedId;
      customer.id = customer.id || resolvedId;
      customer.codigo = customer.codigo || resolvedId;
      customer.codigoInterno = customer.codigoInterno || resolvedId;
    }
    const nameCandidate =
      resolveCustomerName(details) ||
      details.nomeCompleto ||
      details.nomeContato ||
      details.razaoSocial ||
      details.fantasia ||
      details.nome ||
      '';
    if (nameCandidate) {
      if (!customer.nome || customer.nome === 'Cliente da agenda') {
        customer.nome = nameCandidate;
      }
      customer.nomeCompleto = nameCandidate;
    }
    const documentCandidate =
      resolveCustomerDocument(details) ||
      details.documento ||
      details.doc ||
      details.cpf ||
      details.cnpj ||
      (details.document && details.document.numero) ||
      (details.pessoaFisica && details.pessoaFisica.cpf) ||
      (details.pessoaJuridica && details.pessoaJuridica.cnpj) ||
      '';
    if (!documentCandidate && Array.isArray(details.documentos)) {
      const docEntry = details.documentos.find((entry) => entry && entry.numero);
      if (docEntry && docEntry.numero) {
        customer.doc = String(docEntry.numero).trim();
      }
    }
    if (documentCandidate) {
      const normalizedDoc = String(documentCandidate).trim();
      if (normalizedDoc) {
        customer.doc = normalizedDoc;
        customer.documento = normalizedDoc;
        customer.document = normalizedDoc;
        const digits = normalizeDocumentDigits(normalizedDoc);
        if (digits.length === 11) {
          customer.cpf = normalizedDoc;
          delete customer.cnpj;
        } else if (digits.length === 14) {
          customer.cnpj = normalizedDoc;
          delete customer.cpf;
        }
      }
    }
    const emailCandidates = [];
    const addEmail = (value) => {
      if (!value) return;
      const email = String(value).trim();
      if (!email) return;
      if (!emailCandidates.includes(email)) {
        emailCandidates.push(email);
      }
    };
    addEmail(customer.email);
    addEmail(details.email);
    addEmail(details.emailPrincipal);
    addEmail(details.emailContato);
    if (details.contato && typeof details.contato === 'object') {
      addEmail(details.contato.email);
    }
    if (Array.isArray(details.emails)) {
      details.emails.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'string') {
          addEmail(entry);
        } else {
          addEmail(entry.email || entry.contato || entry.valor);
        }
      });
    }
    if (Array.isArray(details.contatos)) {
      details.contatos.forEach((entry) => {
        if (entry && typeof entry === 'object') {
          addEmail(entry.email);
        }
      });
    }
    if (emailCandidates.length) {
      customer.email = emailCandidates[0];
    }
    const phoneCandidates = [];
    const addPhone = (value) => {
      if (!value && value !== 0) return;
      const phone = String(value).trim();
      if (!phone) return;
      if (!phoneCandidates.includes(phone)) {
        phoneCandidates.push(phone);
      }
    };
    addPhone(customer.telefone);
    addPhone(customer.celular);
    addPhone(details.telefone);
    addPhone(details.celular);
    addPhone(details.telefoneContato);
    addPhone(details.celularContato);
    addPhone(details.telefonePrincipal);
    addPhone(details.celularPrincipal);
    addPhone(details.telefoneComercial);
    addPhone(details.telefoneResidencial);
    addPhone(details.telefoneSecundario);
    addPhone(details.telefone1);
    addPhone(details.telefone2);
    addPhone(details.telefone3);
    addPhone(details.fone);
    addPhone(details.phone);
    addPhone(details.mobile);
    addPhone(details.whatsapp);
    addPhone(details.whatsApp);
    addPhone(details.whatsappNumber);
    addPhone(details.contactPhone);
    if (details.contato && typeof details.contato === 'object') {
      addPhone(details.contato.telefone);
      addPhone(details.contato.celular);
      addPhone(details.contato.whatsapp);
    }
    const collectPhoneEntries = (entries) => {
      if (!Array.isArray(entries)) return;
      entries.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'string') {
          addPhone(entry);
        } else if (typeof entry === 'object') {
          addPhone(entry.telefone || entry.celular || entry.whatsapp || entry.numero || entry.number || entry.fone || entry.phone || entry.mobile);
          if (entry.email) {
            addEmail(entry.email);
          }
        }
      });
    };
    collectPhoneEntries(details.telefones);
    collectPhoneEntries(details.phones);
    collectPhoneEntries(details.contatos);
    collectPhoneEntries(details.contatosPrincipais);
    collectPhoneEntries(details.meiosContato);
    if (phoneCandidates.length) {
      customer.telefone = phoneCandidates[0];
      const secondary = phoneCandidates.find((value) => value !== customer.telefone) || phoneCandidates[0];
      customer.celular = secondary;
    }
    return customer;
  };
  const enrichSaleCustomerFromAppointment = async (customer, appointment) => {
    if (!customer || !appointment) return customer;
    const candidateId =
      appointment.customerId ||
      appointment.clienteId ||
      (appointment.cliente && (appointment.cliente._id || appointment.cliente.id));
    const normalizedId = normalizeId(candidateId);
    let hasDocument = Boolean(
      customer.doc || customer.documento || customer.document || customer.cpf || customer.cnpj
    );
    let hasContact = Boolean(customer.email || customer.telefone || customer.celular);
    let hasName = Boolean(customer.nome && customer.nome !== 'Cliente da agenda');
    let cachedDetails = null;
    if (normalizedId) {
      cachedDetails = getCachedCustomerDetailsForAppointment(normalizedId);
      if (cachedDetails) {
        mergeCustomerDetailsIntoSaleCustomer(customer, cachedDetails);
        hasDocument = Boolean(
          customer.doc || customer.documento || customer.document || customer.cpf || customer.cnpj
        );
        hasContact = Boolean(customer.email || customer.telefone || customer.celular);
        hasName = Boolean(customer.nome && customer.nome !== 'Cliente da agenda');
      }
    }
    if (normalizedId && (!hasDocument || !hasContact || !hasName)) {
      const fetched = await fetchAppointmentCustomerDetails(normalizedId);
      if (fetched) {
        mergeCustomerDetailsIntoSaleCustomer(customer, fetched);
        hasDocument = Boolean(
          customer.doc || customer.documento || customer.document || customer.cpf || customer.cnpj
        );
        hasContact = Boolean(customer.email || customer.telefone || customer.celular);
        hasName = Boolean(customer.nome && customer.nome !== 'Cliente da agenda');
      }
    }
    if (normalizedId) {
      customer._id = customer._id || normalizedId;
      customer.id = customer.id || normalizedId;
      customer.codigo = customer.codigo || normalizedId;
      customer.codigoInterno = customer.codigoInterno || normalizedId;
    }
    const finalDocument =
      customer.doc || customer.documento || customer.document || customer.cpf || customer.cnpj || '';
    if (finalDocument) {
      const normalizedDoc = String(finalDocument).trim();
      if (normalizedDoc) {
        customer.doc = normalizedDoc;
        customer.documento = normalizedDoc;
        customer.document = normalizedDoc;
        const digits = normalizeDocumentDigits(normalizedDoc);
        if (digits.length === 11) {
          customer.cpf = normalizedDoc;
          delete customer.cnpj;
        } else if (digits.length === 14) {
          customer.cnpj = normalizedDoc;
          delete customer.cpf;
        }
      }
    }
    if (!customer.nomeCompleto && customer.nome) {
      customer.nomeCompleto = customer.nome;
    }
    if (!customer.telefone && customer.celular) {
      customer.telefone = customer.celular;
    }
    if (!customer.celular && customer.telefone) {
      customer.celular = customer.telefone;
    }
    return customer;
  };
  const applyAppointmentToSale = async (appointment) => {
    if (!appointment) return false;
    const services = Array.isArray(appointment.services) ? appointment.services : [];
    if (!services.length && safeNumber(appointment.total) <= 0) {
      notify('Este atendimento não possui serviços cadastrados para importar.', 'info');
      return false;
    }
    const hasItems = state.itens.length > 0;
    const isDifferentAppointment =
      hasItems && state.activeAppointmentId && state.activeAppointmentId !== appointment.id;
    if (hasItems && isDifferentAppointment) {
      const confirmed = window.confirm(
        'Os itens atuais da venda serão substituídos pelos serviços do atendimento selecionado. Deseja continuar?'
      );
      if (!confirmed) return false;
    }
    const itemsToApply = services.length
      ? services.map((service, index) => {
          const quantity = safeNumber(service.quantidade) > 0 ? safeNumber(service.quantidade) : 1;
          const value = safeNumber(service.valor);
          return {
            id: service.id || `${appointment.id}:${index}`,
            codigo: service.id || '',
            codigoInterno: service.id || '',
            codigoBarras: '',
            nome: service.nome || `Serviço ${index + 1}`,
            quantidade: quantity,
            valor: value,
            subtotal: value * quantity,
            generalPromo: false,
          };
        })
      : [
          {
            id: `${appointment.id}:svc`,
            codigo: appointment.id,
            codigoInterno: appointment.id,
            codigoBarras: '',
            nome: 'Serviços do atendimento',
            quantidade: 1,
            valor: safeNumber(appointment.total),
            subtotal: safeNumber(appointment.total),
            generalPromo: false,
          },
        ];
    applySaleStateSnapshot({
      itens: itemsToApply,
      vendaPagamentos: [],
      vendaDesconto: 0,
      vendaAcrescimo: 0,
      selectedProduct: null,
      quantidade: 1,
    });
    state.vendaPagamentos = [];
    state.vendaDesconto = 0;
    state.vendaAcrescimo = 0;
    const documentValue = appointment.customerDocument || '';
    const documentDigits = normalizeDocumentDigits(documentValue);
    const normalizedDocument = documentValue || '';
    const customerId = normalizeId(
      appointment.customerId ||
        appointment.clienteId ||
        (appointment.cliente && (appointment.cliente._id || appointment.cliente.id))
    );
    const customer = {
      nome: appointment.customerName || 'Cliente da agenda',
      nomeCompleto: appointment.customerName || 'Cliente da agenda',
      doc: normalizedDocument,
      documento: normalizedDocument,
      document: normalizedDocument,
      email: appointment.customerEmail || '',
      celular: appointment.customerPhone || '',
      telefone: appointment.customerPhone || '',
    };
    if (customerId) {
      customer._id = customerId;
      customer.id = customerId;
      customer.codigo = customerId;
      customer.codigoInterno = customerId;
    }
    if (documentDigits && documentDigits.length === 11) {
      customer.cpf = normalizedDocument;
    } else if (documentDigits && documentDigits.length === 14) {
      customer.cnpj = normalizedDocument;
    }
    await enrichSaleCustomerFromAppointment(customer, appointment);
    const pet = appointment.petName
      ? {
          nome: appointment.petName,
        }
      : null;
    if (pet && appointment.petId) {
      pet._id = appointment.petId;
      pet.id = appointment.petId;
    }
    setSaleCustomer(customer, pet);
    renderItemsList();
    renderSalePaymentsPreview();
    updateFinalizeButton();
    updateSaleSummary();
    clearSaleSearchAreas();
    state.activeAppointmentId = appointment.id;
    setActiveTab('pdv-tab');
    notify('Serviços do atendimento importados para a venda.', 'success');
    renderAppointments();
    return true;
  };
  const loadAppointmentsForCurrentFilter = async ({ forceReload = false } = {}) => {
    const range = getAppointmentRangeFromFilters(state.appointmentFilters);
    if (!range) {
      notify('Informe um período válido para buscar atendimentos.', 'warning');
      return;
    }
    const storeId = getActiveAppointmentStoreId();
    if (!storeId) {
      notify('Selecione a empresa e o PDV para importar atendimentos.', 'warning');
      return;
    }
    const requestId = ++appointmentsRequestId;
    state.appointmentsLoading = true;
    state.appointmentScrollPending = true;
    renderAppointments();
    try {
      const dataset = await loadAppointmentsDataset({
        startParam: range.startParam,
        endParam: range.endParam,
        storeId,
        force: forceReload,
      });
      if (requestId !== appointmentsRequestId) return;
      const normalizedList = dataset.map((item) => cloneAppointmentRecord(item)).filter(Boolean);
      normalizedList.sort((a, b) => getTimeValue(a?.scheduledAt) - getTimeValue(b?.scheduledAt));
      state.appointments = normalizedList;
      if (state.activeAppointmentId) {
        const stillExists = state.appointments.some((item) => item.id === state.activeAppointmentId);
        if (!stillExists) {
          state.activeAppointmentId = '';
        }
      }
      state.appointmentsLoading = false;
      const presetKey = (state.appointmentFilters.preset || 'today').toLowerCase();
      if (['today', 'week', 'month'].includes(presetKey)) {
        state.appointmentMetrics[presetKey] = state.appointments.length;
      }
      renderAppointments();
    } catch (error) {
      if (requestId !== appointmentsRequestId) return;
      console.error('Erro ao carregar atendimentos da agenda:', error);
      state.appointments = [];
      state.appointmentsLoading = false;
      renderAppointments();
      notify(error.message || 'Não foi possível carregar os atendimentos da agenda.', 'error');
    }
  };
  const handleAppointmentAction = () => {
    if (!state.selectedStore || !state.selectedPdv) {
      notify('Selecione a empresa e o PDV para importar atendimentos.', 'warning');
      return;
    }
    if (!state.caixaAberto) {
      notify('Abra o caixa para registrar o pagamento do atendimento importado.', 'info');
    }
    openAppointmentModal();
  };
  const handleAppointmentPresetClick = async (event) => {
    const button = event.target.closest('[data-appointment-preset]');
    if (!button) return;
    event.preventDefault();
    const preset = button.getAttribute('data-appointment-preset');
    if (!preset) return;
    if (state.appointmentFilters.preset === preset && preset !== 'custom') {
      await loadAppointmentsForCurrentFilter();
      return;
    }
    state.appointmentFilters = { preset, start: '', end: '' };
    renderAppointmentFilters();
    await loadAppointmentsForCurrentFilter();
  };
  const handleAppointmentApply = async () => {
    const startInput = elements.appointmentStart?.value || '';
    const endInput = elements.appointmentEnd?.value || '';
    if (!startInput || !endInput) {
      notify('Informe as datas inicial e final para aplicar o filtro por período.', 'warning');
      return;
    }
    let startDate = parseDateInputValue(startInput);
    let endDate = parseDateInputValue(endInput);
    if (!startDate || !endDate) {
      notify('Período inválido. Verifique as datas informadas.', 'warning');
      return;
    }
    if (startDate.getTime() > endDate.getTime()) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }
    const normalizedStart = formatDateParam(startDate);
    const normalizedEnd = formatDateParam(endDate);
    state.appointmentFilters = {
      preset: 'custom',
      start: normalizedStart,
      end: normalizedEnd,
    };
    renderAppointmentFilters();
    await loadAppointmentsForCurrentFilter({ forceReload: true });
  };
  const handleAppointmentListClick = async (event) => {
    const button = event.target.closest('[data-appointment-import]');
    if (!button) return;
    const appointmentId = button.getAttribute('data-appointment-import');
    if (!appointmentId) return;
    const appointment = findAppointmentById(appointmentId);
    if (!appointment) {
      notify('Não foi possível localizar os dados do atendimento selecionado.', 'error');
      return;
    }
    if (appointment.paid || appointment.saleCode) {
      notify('Este atendimento já foi faturado e não pode ser importado novamente.', 'info');
      return;
    }
    const wasDisabled = button.disabled;
    const hadCursorWait = button.classList.contains('cursor-wait');
    const hadOpacity = button.classList.contains('opacity-60');
    if (!wasDisabled) {
      button.disabled = true;
      if (!hadCursorWait) {
        button.classList.add('cursor-wait');
      }
      if (!hadOpacity) {
        button.classList.add('opacity-60');
      }
    }
    let applied = false;
    try {
      applied = await applyAppointmentToSale(appointment);
      if (applied) {
        closeAppointmentModal();
      }
    } catch (error) {
      console.error('Erro ao importar atendimento no PDV:', error);
      notify('Não foi possível importar os serviços do atendimento selecionado.', 'error');
    } finally {
      if (!applied && button.isConnected) {
        button.disabled = wasDisabled;
        if (!wasDisabled) {
          if (!hadCursorWait) {
            button.classList.remove('cursor-wait');
          }
          if (!hadOpacity) {
            button.classList.remove('opacity-60');
          }
        }
      }
    }
  };
  const handleAppointmentRefresh = () => {
    loadAppointmentsForCurrentFilter({ forceReload: true }).catch((error) =>
      console.error('Erro ao atualizar atendimentos:', error)
    );
    refreshAppointmentMetrics({ force: true }).catch((error) =>
      console.error('Erro ao atualizar métricas de atendimentos:', error)
    );
  };
  const updateAppointmentRecord = (appointmentId, updates = {}) => {
    const normalized = normalizeId(appointmentId);
    if (!normalized) return;
    const applyUpdates = (appointment) => {
      if (!appointment) return;
      Object.assign(appointment, updates);
      if (updates.status) {
        appointment.status = (updates.status || '').toLowerCase();
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'saleCode')) {
        appointment.saleCode = updates.saleCode || '';
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'paid')) {
        appointment.paid = Boolean(updates.paid);
      }
      if (Array.isArray(appointment.services)) {
        appointment.services = appointment.services.map((service) => ({ ...service }));
      }
    };
    const target = state.appointments.find((item) => item.id === normalized);
    if (target) {
      applyUpdates(target);
    }
    appointmentCache.forEach((list) => {
      const cached = list.find((item) => item.id === normalized);
      if (cached) {
        applyUpdates(cached);
      }
    });
    renderAppointments();
  };
  const syncAppointmentAfterSale = async (appointmentId, saleCode) => {
    const normalized = normalizeId(appointmentId);
    if (!normalized) return;
    const previousState = findAppointmentById(normalized);
    const optimisticUpdates = {
      paid: true,
      saleCode: saleCode || '',
      status: 'finalizado',
    };
    updateAppointmentRecord(normalized, optimisticUpdates);
    const token = getToken();
    let syncSucceeded = false;
    try {
      await fetchWithOptionalAuth(`${API_BASE}/func/agendamentos/${normalized}`, {
        token,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigoVenda: saleCode || '', pago: true, status: 'finalizado' }),
        errorMessage: 'Não foi possível atualizar o atendimento como pago.',
      });
      syncSucceeded = true;
      refreshAppointmentMetrics({ force: true }).catch((error) =>
        console.error('Erro ao atualizar indicadores após finalizar venda do atendimento:', error)
      );
    } catch (error) {
      console.error('Erro ao sincronizar atendimento após a venda:', error);
      if (previousState) {
        updateAppointmentRecord(normalized, {
          paid: Boolean(previousState.paid),
          saleCode: previousState.saleCode || '',
          status: previousState.status || 'agendado',
        });
      }
      notify(
        'Venda finalizada, porém não foi possível atualizar o atendimento na agenda.',
        'warning'
      );
    } finally {
      if (!syncSucceeded && !previousState) {
        updateAppointmentRecord(normalized, {
          paid: false,
          saleCode: '',
          status: 'agendado',
        });
      }
      state.activeAppointmentId = '';
    }
  };

  const revertAppointmentAfterSaleCancellation = async (sale) => {
    if (!sale) return false;
    const normalizedAppointmentId = normalizeId(
      sale.appointmentId || sale.receiptSnapshot?.meta?.appointmentId || ''
    );
    if (!normalizedAppointmentId) {
      return false;
    }
    const previousState = findAppointmentById(normalizedAppointmentId);
    updateAppointmentRecord(normalizedAppointmentId, {
      paid: false,
      saleCode: '',
    });
    const token = getToken();
    try {
      await fetchWithOptionalAuth(`${API_BASE}/func/agendamentos/${normalizedAppointmentId}`, {
        token,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigoVenda: '', pago: false }),
        errorMessage: 'Não foi possível atualizar o atendimento após cancelar a venda.',
      });
      refreshAppointmentMetrics({ force: true }).catch((error) =>
        console.error('Erro ao atualizar indicadores após cancelar venda do atendimento:', error)
      );
      return true;
    } catch (error) {
      console.error('Erro ao sincronizar atendimento após cancelar a venda:', error);
      if (previousState) {
        updateAppointmentRecord(normalizedAppointmentId, {
          paid: Boolean(previousState.paid),
          saleCode: previousState.saleCode || '',
          status: previousState.status || 'agendado',
        });
      }
      notify(
        'Venda cancelada, porém não foi possível atualizar o atendimento na agenda.',
        'warning'
      );
      return false;
    }
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
      cashContributions,
      appointmentId,
    } = updates;
    if (saleCode !== undefined) {
      sale.saleCode = saleCode || '';
      sale.saleCodeLabel = sale.saleCode || 'Sem código';
    }
    if (snapshot !== undefined) {
      sale.receiptSnapshot = snapshot || null;
      if (!updates.appointmentId && snapshot?.meta?.appointmentId) {
        sale.appointmentId = normalizeId(snapshot.meta.appointmentId);
      }
    }
    if (appointmentId !== undefined) {
      sale.appointmentId = normalizeId(appointmentId);
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
    if (cashContributions !== undefined) {
      sale.cashContributions = normalizeCashContributions(cashContributions);
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

  const handleSaleResetFiscalStatus = (saleId) => {
    const sale = findCompletedSaleById(saleId);
    if (!sale) {
      return;
    }
    if (sale.fiscalStatus !== 'emitting') {
      notify('Esta venda não está com emissão em andamento.', 'info');
      return;
    }
    updateCompletedSaleRecord(saleId, { fiscalStatus: 'pending' });
    notify('Status da emissão fiscal redefinido. Tente emitir novamente.', 'info');
    scheduleStatePersist({ immediate: true });
  };

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

  const revertSaleCashMovements = (sale) => {
    const contributions = normalizeCashContributions(sale.cashContributions || []);
    if (!contributions.length) {
      return 0;
    }
    let totalRemoved = 0;
    contributions.forEach((entry) => {
      const amount = safeNumber(entry.amount);
      if (!(amount > 0)) {
        return;
      }
      totalRemoved += amount;
      const paymentId = entry.paymentId || '';
      const paymentLabel = entry.paymentLabel || '';
      const paymentType = entry.paymentType || '';
      let method = null;
      if (paymentId) {
        method =
          state.pagamentos.find((item) => item.id === paymentId) ||
          state.pagamentos.find((item) => String(item.raw?._id || '') === paymentId);
      }
      if (!method && paymentLabel) {
        method = state.pagamentos.find((item) => item.label === paymentLabel);
      }
      if (!method && paymentLabel) {
        const normalizedLabel = String(paymentLabel || '').toLowerCase();
        method = state.pagamentos.find((item) => {
          const baseLabel = String(item.label || '').toLowerCase();
          if (baseLabel === normalizedLabel) {
            return true;
          }
          const rawLabel = String(item.raw?.nome || item.raw?.label || '').toLowerCase();
          if (rawLabel === normalizedLabel) {
            return true;
          }
          if (Array.isArray(item.aliases)) {
            return item.aliases.some(
              (alias) => String(alias || '').toLowerCase() === normalizedLabel
            );
          }
          return false;
        });
      }
      if (!method && paymentType) {
        const normalizedType = paymentType.toLowerCase();
        method = state.pagamentos.find((item) => {
          const baseType = String(item.type || '').toLowerCase();
          if (baseType === normalizedType) {
            return true;
          }
          const rawType = String(item.raw?.tipo || item.raw?.type || '').toLowerCase();
          return rawType === normalizedType;
        });
      }
      if (method) {
        method.valor = Math.max(0, safeNumber(method.valor) - amount);
      }
    });
    renderPayments();
    updateSummary();
    updateStatusBadge();
    scheduleStatePersist();
    if (totalRemoved > 0) {
      const saleCode = sale.saleCode || sale.saleCodeLabel || '';
      const action = {
        id: 'cancelamento-venda',
        label: saleCode ? `Cancelamento da venda ${saleCode}` : 'Cancelamento de venda',
      };
      const paymentLabel = contributions
        .map((entry) => `${entry.paymentLabel || 'Pagamento'} • ${formatCurrency(entry.amount)}`)
        .join(' + ');
      addHistoryEntry(action, totalRemoved, sale.cancellationReason || '', paymentLabel, -Math.abs(totalRemoved));
    }
    return totalRemoved;
  };

  const removeSaleAccountsReceivable = async (sale) => {
    const receivables = Array.isArray(sale.receivables) ? sale.receivables : [];
    if (!receivables.length) {
      return;
    }
    const saleId = sale.id;
    state.accountsReceivable = state.accountsReceivable.filter((entry) => entry.saleId !== saleId);
    renderReceivablesList();
    renderReceivablesSelectedCustomer();
    const customerIds = new Set();
    const accountIds = new Set();
    receivables.forEach((entry) => {
      if (entry?.clienteId) {
        customerIds.add(entry.clienteId);
      }
      const accountIdSource = entry?.accountReceivableId || entry?.receivableId;
      if (accountIdSource) {
        accountIds.add(accountIdSource);
      }
    });
    customerIds.forEach((id) => {
      if (!id) return;
      customerReceivablesCache.delete(id);
      customerReceivablesDetailsCache.delete(id);
    });
    scheduleStatePersist();
    if (!accountIds.size) {
      sale.receivables = [];
      return;
    }
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const errors = [];
    for (const accountId of accountIds) {
      try {
        const response = await fetch(
          `${API_BASE}/accounts-receivable/${encodeURIComponent(accountId)}`,
          {
            method: 'DELETE',
            headers,
          }
        );
        if (!response.ok && response.status !== 404) {
          const payload = await response.json().catch(() => ({}));
          const message =
            payload?.message || 'Não foi possível remover uma conta a receber vinculada à venda.';
          errors.push(message);
        }
      } catch (error) {
        console.error('Erro ao remover conta a receber vinculada à venda cancelada:', error);
        errors.push(
          error?.message || 'Não foi possível remover uma conta a receber vinculada à venda.'
        );
      }
    }
    sale.receivables = [];
    if (errors.length) {
      notify(errors[0], 'warning');
    }
  };

  const handleSaleCancelConfirm = async () => {
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
    const confirmButton = elements.saleCancelConfirm;
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.classList.add('opacity-60', 'cursor-not-allowed');
    }
    try {
      sale.status = 'cancelled';
      sale.cancellationReason = reason;
      sale.cancellationAt = new Date().toISOString();
      sale.cancellationAtLabel = toDateLabel(sale.cancellationAt);
      sale.inventoryProcessed = false;
      sale.inventoryProcessedAt = null;
      revertSaleCashMovements(sale);
      await removeSaleAccountsReceivable(sale);
      renderSalesList();
      await revertAppointmentAfterSaleCancellation(sale);
      closeSaleCancelModal();
      notify('Venda cancelada com sucesso.', 'success');
      scheduleStatePersist({ immediate: true });
    } catch (error) {
      console.error('Erro ao cancelar venda no PDV:', error);
      notify(error?.message || 'Não foi possível cancelar a venda.', 'error');
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
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
    const fiscalResetButton = event.target.closest('[data-sale-fiscal-reset]');
    if (fiscalResetButton) {
      const saleId = fiscalResetButton.getAttribute('data-sale-id');
      if (saleId) {
        handleSaleResetFiscalStatus(saleId);
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
    state.summary.recebimentosCliente = 0;
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
    state.accountsReceivable = [];
    state.summary = { abertura: 0, recebido: 0, saldo: 0, recebimentosCliente: 0 };
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
    state.receivablesSearchQuery = '';
    state.receivablesSearchResults = [];
    state.receivablesSearchLoading = false;
    state.receivablesSelectedCustomer = null;
    state.receivablesListLoading = false;
    state.receivablesListError = '';
    state.receivablesSelectedIds = [];
    state.receivablesSelectedTotal = 0;
    state.receivablesPaymentLoading = false;
    state.receivablesPaymentContext = null;
    state.receivablesSaleBackup = null;
    state.modalSelectedCliente = null;
    state.modalSelectedPet = null;
    state.modalActiveTab = 'cliente';
    state.printPreferences = { fechamento: 'PM', venda: 'PM' };
    state.deliveryOrders = [];
    state.completedSales = [];
    state.budgets = [];
    state.selectedBudgetId = '';
    state.activeBudgetId = '';
    state.pendingBudgetValidityDays = null;
    state.budgetSequence = 1;
    state.budgetFilters = { preset: 'todos', start: '', end: '' };
    state.appointments = [];
    state.appointmentsLoading = false;
    state.appointmentFilters = { preset: 'today', start: '', end: '' };
    state.appointmentMetrics = { today: 0, week: 0, month: 0 };
    state.appointmentScrollPending = false;
    state.activeAppointmentId = '';
    state.activeSaleCancellationId = '';
    state.activePdvStoreId = '';
    state.deliveryAddresses = [];
    state.deliveryAddressesLoading = false;
    state.deliveryAddressSaving = false;
    state.deliveryAddressFormVisible = false;
    state.deliverySelectedAddressId = '';
    state.deliverySelectedAddress = null;
    state.activeFinalizeContext = null;
    customerAddressesCache.clear();
    appointmentCache.clear();
    appointmentsRequestId = 0;
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
    if (receivablesSearchTimeout) {
      clearTimeout(receivablesSearchTimeout);
      receivablesSearchTimeout = null;
    }
    if (receivablesSearchController) {
      receivablesSearchController.abort();
      receivablesSearchController = null;
    }
    abortReceivablesCustomerFetch();
    clearReceivablesCache();
    renderReceivablesSelectionSummary();
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
    if (elements.receivablesSearchInput) {
      elements.receivablesSearchInput.value = '';
    }
    renderReceivablesSearchResults();
    renderReceivablesSelectedCustomer();
    renderReceivablesList();
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
    renderBudgets();
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
    setActiveTab('caixa-tab', { persist: false });
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
    renderReceivablesSelectionSummary();
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
    const appointmentStoreId = getPdvStoreId(pdv) || companyId || state.selectedStore || '';
    state.activePdvStoreId = appointmentStoreId;
    const caixaAberto = Boolean(
      pdv?.caixa?.aberto ||
        pdv?.caixaAberto ||
        pdv?.statusCaixa === 'aberto' ||
        pdv?.status === 'aberto'
    );
    state.caixaAberto = caixaAberto;
    renderReceivablesSelectionSummary();
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
    state.summary.recebimentosCliente = safeNumber(
      summarySource.recebimentosCliente ??
        summarySource.recebimentosClientes ??
        summarySource.recebimentoCliente ??
        summarySource.recebimentoClientes ??
        state.summary.recebimentosCliente ??
        0
    );
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
    const financeConfig = pdv?.configuracoesFinanceiro || {};
    state.financeSettings = {
      contaCorrente: normalizeFinanceReference(financeConfig.contaCorrente),
      contaContabilReceber: normalizeFinanceReference(financeConfig.contaContabilReceber),
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
    const rootReceivablesData = Array.isArray(pdv?.accountsReceivable)
      ? pdv.accountsReceivable
      : Array.isArray(pdv?.contasReceber)
      ? pdv.contasReceber
      : Array.isArray(pdv?.caixa?.accountsReceivable)
      ? pdv.caixa.accountsReceivable
      : [];
    const normalizedRootReceivables = rootReceivablesData
      .map((entry) => normalizeReceivableForPersist(entry))
      .filter(Boolean);
    const vendasFonte = Array.isArray(pdv?.completedSales)
      ? pdv.completedSales
      : Array.isArray(pdv?.caixa?.vendas)
      ? pdv.caixa.vendas
      : [];
    const saleReceivables = [];
    state.completedSales = vendasFonte
      .map((sale) => normalizeSaleRecordForPersist(sale))
      .filter(Boolean)
      .map((sale) => {
        const normalizedFiscalStatus =
          sale.fiscalStatus === 'emitting' || !sale.fiscalStatus ? 'pending' : sale.fiscalStatus;
        const normalizedReceivables = Array.isArray(sale.receivables)
          ? sale.receivables.map((entry) => {
              const normalized = normalizeReceivableForPersist(entry);
              if (normalized) {
                normalized.saleId = sale.id;
                saleReceivables.push(normalized);
                return { ...normalized };
              }
              return null;
            })
          : [];
        return {
          ...sale,
          fiscalStatus: normalizedFiscalStatus,
          paymentTags: Array.isArray(sale.paymentTags) ? sale.paymentTags : [],
          items: Array.isArray(sale.items) ? sale.items : [],
          receivables: normalizedReceivables.filter(Boolean),
        };
      });
    const mergedReceivables = [...saleReceivables];
    normalizedRootReceivables.forEach((entry) => {
      const alreadyRegistered = mergedReceivables.some((item) => item.id === entry.id);
      if (!alreadyRegistered) {
        mergedReceivables.push(entry);
      }
    });
    state.accountsReceivable = mergedReceivables;
    clearReceivablesCache();
    state.receivablesListLoading = false;
    state.receivablesListError = '';
    renderReceivablesList();
    renderReceivablesSelectedCustomer();
    const budgetsFonte = Array.isArray(pdv?.budgets)
      ? pdv.budgets
      : Array.isArray(pdv?.orcamentos)
      ? pdv.orcamentos
      : [];
    state.budgets = budgetsFonte.map((budget) => normalizeBudgetRecordForPersist(budget)).filter(Boolean);
    if (pdv?.budgetSequence != null) {
      state.budgetSequence = Math.max(1, Number.parseInt(pdv.budgetSequence, 10) || 1);
    } else if (pdv?.orcamentoSequencia != null) {
      state.budgetSequence = Math.max(1, Number.parseInt(pdv.orcamentoSequencia, 10) || 1);
    } else {
      state.budgetSequence = state.budgets.length + 1;
    }
    state.selectedBudgetId = '';
    state.activeBudgetId = '';
    state.pendingBudgetValidityDays = null;
    state.appointments = [];
    state.appointmentsLoading = false;
    state.appointmentFilters = { preset: 'today', start: '', end: '' };
    state.appointmentMetrics = { today: 0, week: 0, month: 0 };
    state.appointmentScrollPending = false;
    state.activeAppointmentId = '';
    appointmentCache.clear();
    appointmentsRequestId = 0;
    renderPayments();
    renderHistory();
    setLastMovement(state.history[0] || null);
    renderItemsList();
    renderSalesList();
    renderBudgets();
    renderAppointments();
    clearSelectedProduct();
    updateWorkspaceInfo();
    renderCaixaActions();
    updateActionDetails();
    updateSummary();
    updateStatusBadge();
    updateTabAvailability();
    initializeSaleCodeForPdv(pdv);
    const fallbackTab = state.caixaAberto ? 'pdv-tab' : 'caixa-tab';
    let targetTab = fallbackTab;
    if (pendingActiveTabPreference) {
      targetTab =
        pendingActiveTabPreference === 'pdv-tab' && !state.caixaAberto
          ? 'caixa-tab'
          : pendingActiveTabPreference;
    }
    pendingActiveTabPreference = '';
    setActiveTab(targetTab);
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
      const token = getToken();
      const endpoint =
        `${API_BASE}/products?search=${encodeURIComponent(normalized)}&limit=8&includeHidden=true&audience=pdv`;
      const payload = await fetchWithOptionalAuth(endpoint, {
        token,
        signal: state.searchController.signal,
        errorMessage: 'Não foi possível buscar produtos.',
      });
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
      const token = getToken();
      const endpoint =
        `${API_BASE}/products?search=${encodeURIComponent(normalized)}&limit=6&includeHidden=true&audience=pdv`;
      const payload = await fetchWithOptionalAuth(endpoint, {
        token,
        errorMessage: 'Não foi possível buscar o produto pelo código informado.',
      });
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
    renderReceivablesSelectionSummary();
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
    persistPdvSelectionPreference({ storeId: value, pdvId: '' });
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
    persistPdvSelectionPreference({ pdvId: value });
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

  const restorePersistedSelection = async (selection) => {
    if (!selection || typeof selection !== 'object') {
      return false;
    }
    const storeId = normalizeId(selection.storeId);
    const pdvId = normalizeId(selection.pdvId);
    if (!storeId) {
      if (pdvId) {
        persistPdvSelectionPreference({ pdvId: '' });
      }
      return false;
    }
    if (!findStoreById(storeId)) {
      persistPdvSelectionPreference({ storeId: '', pdvId: '' });
      return false;
    }
    if (elements.companySelect) {
      elements.companySelect.value = storeId;
    }
    await handleCompanyChange();
    let restored = Boolean(state.selectedStore);
    if (pdvId && findPdvById(pdvId)) {
      if (elements.pdvSelect) {
        elements.pdvSelect.value = pdvId;
      }
      await handlePdvChange();
      restored = Boolean(state.selectedPdv);
    } else if (pdvId) {
      persistPdvSelectionPreference({ pdvId: '' });
    }
    return restored;
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
    elements.fullscreenToggle?.addEventListener('click', handleFullscreenToggle);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
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
    elements.crediarioAddButton?.addEventListener('click', handleCrediarioAddInstallment);
    elements.crediarioList?.addEventListener('click', handleCrediarioListClick);
    elements.crediarioConfirm?.addEventListener('click', handleCrediarioConfirm);
    elements.crediarioCancel?.addEventListener('click', handleCrediarioCancel);
    elements.crediarioClose?.addEventListener('click', handleCrediarioCancel);
    elements.crediarioBackdrop?.addEventListener('click', handleCrediarioCancel);
    elements.crediarioCustomerButton?.addEventListener('click', handleCrediarioCustomerSelect);
    elements.crediarioDateInput?.addEventListener('change', () => {
      if (elements.crediarioError) {
        elements.crediarioError.classList.add('hidden');
        elements.crediarioError.textContent = '';
      }
    });
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
      if (action === 'orcamento') {
        button.addEventListener('click', handleBudgetAction);
        return;
      }
      if (action === 'importar-atendimento') {
        button.addEventListener('click', handleAppointmentAction);
        return;
      }
      button.addEventListener('click', () => {
        notify('Funcionalidade em desenvolvimento.', 'info');
      });
    });
    elements.budgetPresets?.addEventListener('click', handleBudgetPresetClick);
    elements.budgetStart?.addEventListener('change', handleBudgetDateChange);
    elements.budgetEnd?.addEventListener('change', handleBudgetDateChange);
    elements.budgetList?.addEventListener('click', handleBudgetListClick);
    elements.budgetImport?.addEventListener('click', handleBudgetImport);
    elements.budgetDelete?.addEventListener('click', handleBudgetDelete);
    elements.budgetModalConfirm?.addEventListener('click', confirmBudgetValidity);
    elements.budgetModalCancel?.addEventListener('click', () => closeBudgetModal());
    elements.budgetModalClose?.addEventListener('click', () => closeBudgetModal());
    elements.budgetModalBackdrop?.addEventListener('click', () => closeBudgetModal());
    elements.customerRemove?.addEventListener('click', handleCustomerRemove);
    elements.customerModalClose?.addEventListener('click', closeCustomerModal);
    elements.customerModalBackdrop?.addEventListener('click', closeCustomerModal);
    elements.customerCancel?.addEventListener('click', closeCustomerModal);
    elements.customerConfirm?.addEventListener('click', handleCustomerConfirm);
    elements.customerClear?.addEventListener('click', handleCustomerClearSelection);
    elements.customerSearchInput?.addEventListener('input', handleCustomerSearchInput);
    elements.customerResultsList?.addEventListener('click', handleCustomerResultsClick);
    elements.customerPetsList?.addEventListener('click', handleCustomerPetsClick);
    elements.receivablesSearchInput?.addEventListener('input', handleReceivablesSearchInput);
    elements.receivablesSearchResults?.addEventListener('click', handleReceivablesResultsClick);
    elements.receivablesClear?.addEventListener('click', handleReceivablesClear);
    elements.receivablesList?.addEventListener('change', handleReceivablesListChange);
    elements.receivablesPayButton?.addEventListener('click', handleReceivablesPay);
    elements.receivablesResidualDue?.addEventListener('input', handleReceivablesResidualDueInput);
    elements.receivablesResidualDue?.addEventListener('change', handleReceivablesResidualDueInput);
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
    elements.appointmentPresets?.addEventListener('click', handleAppointmentPresetClick);
    elements.appointmentApply?.addEventListener('click', handleAppointmentApply);
    elements.appointmentList?.addEventListener('click', handleAppointmentListClick);
    elements.appointmentReload?.addEventListener('click', handleAppointmentRefresh);
    elements.appointmentClose?.addEventListener('click', closeAppointmentModal);
    elements.appointmentBackdrop?.addEventListener('click', closeAppointmentModal);
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
    applyFullscreenState();
    pendingActiveTabPreference = loadActiveTabPreference();
    const selectionPreference = loadPdvSelectionPreference();
    setActiveTab(pendingActiveTabPreference || 'caixa-tab', { persist: false });
    resetWorkspace();
    updateWorkspaceVisibility(false);
    bindEvents();
    renderSalePaymentMethods();
    renderBudgets();
    renderAppointments();
    updateTabAvailability();
    try {
      await fetchStores();
      await restorePersistedSelection(selectionPreference);
      if (!state.selectedStore) {
        if (state.stores.length > 0) {
          updateSelectionHint('Escolha a empresa para carregar os PDVs disponíveis.');
        } else {
          updateSelectionHint('Cadastre uma empresa para habilitar o PDV.');
        }
      }
      if (state.stores.length === 0) {
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
