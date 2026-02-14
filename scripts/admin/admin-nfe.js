(() => {
  const statusBadge = document.getElementById('nfe-status-badge');
  const itemsBody = document.getElementById('nfe-items-body');
  const itemsEmpty = document.getElementById('nfe-items-empty');
  const itemsAlert = document.getElementById('nfe-items-alert');
  const volumesHead = document.getElementById('nfe-volumes-head');
  const volumesBody = document.getElementById('nfe-volumes-body');
  const volumesEmpty = document.getElementById('nfe-volumes-empty');
  const refHead = document.getElementById('nfe-ref-head');
  const refBody = document.getElementById('nfe-ref-body');
  const refEmpty = document.getElementById('nfe-ref-empty');
  const refFields = {
    chave: document.getElementById('nfe-ref-chave'),
    add: document.getElementById('nfe-ref-add'),
  };
  const volumeFields = {
    identificacao: document.getElementById('nfe-volume-identificacao'),
    especie: document.getElementById('nfe-volume-especie'),
    marca: document.getElementById('nfe-volume-marca'),
    quantidade: document.getElementById('nfe-volume-quantidade'),
    pesoBruto: document.getElementById('nfe-volume-peso-bruto'),
    pesoLiquido: document.getElementById('nfe-volume-peso-liquido'),
    cubagem: document.getElementById('nfe-volume-cubagem'),
    add: document.getElementById('nfe-volume-add'),
    reset: document.getElementById('nfe-volume-new'),
  };
  const productModal = document.getElementById('nfe-product-modal');
  const productModalFields = {
    product: document.getElementById('nfe-modal-product'),
    qty: document.getElementById('nfe-modal-qty'),
    unit: document.getElementById('nfe-modal-unit'),
    subtotal: document.getElementById('nfe-modal-subtotal'),
    discountPercent: document.getElementById('nfe-modal-discount-percent'),
    discountValue: document.getElementById('nfe-modal-discount-value'),
    otherExpenses: document.getElementById('nfe-modal-other-expenses'),
    total: document.getElementById('nfe-modal-total'),
    icmsBasePercent: document.getElementById('nfe-modal-icms-base-percent'),
    icmsBaseValue: document.getElementById('nfe-modal-icms-base-value'),
    icmsCst: document.getElementById('nfe-modal-icms-cst'),
    icmsModalidade: document.getElementById('nfe-modal-icms-modalidade'),
    icmsAliq: document.getElementById('nfe-modal-icms-aliq'),
    icmsValor: document.getElementById('nfe-modal-icms-valor'),
    fcpAliq: document.getElementById('nfe-modal-icms-aliq-fcp'),
    fcpValor: document.getElementById('nfe-modal-icms-valor-fcp'),
    ipiCst: document.getElementById('nfe-modal-ipi-st'),
    ipiBase: document.getElementById('nfe-modal-ipi-base'),
    ipiAliq: document.getElementById('nfe-modal-ipi-aliq'),
    ipiValor: document.getElementById('nfe-modal-ipi-valor'),
    pisCst: document.getElementById('nfe-modal-pis-st'),
    pisBase: document.getElementById('nfe-modal-pis-base'),
    pisAliq: document.getElementById('nfe-modal-pis-aliq'),
    pisValor: document.getElementById('nfe-modal-pis-valor'),
    cofinsCst: document.getElementById('nfe-modal-cofins-st'),
    cofinsBase: document.getElementById('nfe-modal-cofins-base'),
    cofinsAliq: document.getElementById('nfe-modal-cofins-aliq'),
    cofinsValor: document.getElementById('nfe-modal-cofins-valor'),
    pisExcluirIcms: document.getElementById('nfe-modal-pis-excluir-icms'),
    cofinsExcluirIcms: document.getElementById('nfe-modal-cofins-excluir-icms'),
    unidadeComercial: document.getElementById('nfe-modal-unidade-comercial'),
    peso: document.getElementById('nfe-modal-peso'),
    qtyTrib: document.getElementById('nfe-modal-qty-trib'),
    unidadeTributavel: document.getElementById('nfe-modal-unidade-tributavel'),
    unitTrib: document.getElementById('nfe-modal-unit-trib'),
    ncm: document.getElementById('nfe-modal-ncm'),
    cfop: document.getElementById('nfe-modal-cfop'),
    cest: document.getElementById('nfe-modal-cest'),
    codigoBeneficioFiscal: document.getElementById('nfe-modal-beneficio'),
    numeroPedido: document.getElementById('nfe-modal-numero-pedido'),
    numeroItemPedido: document.getElementById('nfe-modal-numero-item-pedido'),
    save: document.getElementById('nfe-modal-save'),
    cancel: document.getElementById('nfe-modal-cancel'),
  };
  const ITEM_COLUMNS = [
    { key: 'item', label: 'Item', align: 'text-right', readOnly: true },
    { key: 'code', label: 'C\u00f3digo' },
    { key: 'name', label: 'Descri\u00e7\u00e3o' },
    { key: 'qty', label: 'Qtde.', align: 'text-right' },
    { key: 'unit', label: 'Valor Unit\u00e1rio', align: 'text-right' },
    { key: 'discount', label: 'Valor Desconto (R$)', align: 'text-right' },
    { key: 'otherExpenses', label: 'Outras Despesas (R$)', align: 'text-right' },
    { key: 'freight', label: 'Frete (R$)', align: 'text-right' },
    { key: 'insurance', label: 'Seguro (R$)', align: 'text-right' },
    { key: 'total', label: 'Valor Total (R$)', align: 'text-right', readOnly: true },
    { key: 'cfop', label: 'CFOP' },
    { key: 'ncm', label: 'NCM' },
    { key: 'unidadeComercial', label: 'Unidade Comercial' },
    { key: 'unidadeTributavel', label: 'Unidade Tribut\u00e1vel' },
    { key: 'qtyTrib', label: 'Qtde. Tribut\u00e1vel', align: 'text-right' },
    { key: 'unitTrib', label: 'Valor Unit\u00e1rio Tribut\u00e1vel', align: 'text-right' },
    { key: 'peso', label: 'Peso (Kg)', align: 'text-right' },
    { key: 'cest', label: 'CEST' },
    { key: 'cst', label: 'CST' },
    { key: 'baseIcms', label: 'Base ICMS (R$)', align: 'text-right' },
    { key: 'icms', label: 'Al\u00edq. ICMS (%)', align: 'text-right' },
    { key: 'valorIcms', label: 'Valor ICMS (R$)', align: 'text-right' },
    { key: 'bcIcmsStRetAnt', label: 'BC ICMS ST retido anteriormente (R$)', align: 'text-right' },
    { key: 'aliqSuportadaConsumidor', label: 'Al\u00edq. Suportada pelo Consumidor (%)', align: 'text-right' },
    { key: 'valorIcmsProprioSubstituto', label: 'Valor de ICMS pr\u00f3prio do Substituto (R$)', align: 'text-right' },
    { key: 'valorIcmsStRetAnt', label: 'Valor ICMS ST retido anteriormente (R$)', align: 'text-right' },
    { key: 'baseIcmsStUfDestino', label: 'Base ICMS ST da UF destino (R$)', align: 'text-right' },
    { key: 'valorIcmsStUfDestino', label: 'Valor ICMS ST da UF destino (R$)', align: 'text-right' },
    { key: 'modalidadeBcIcmsSt', label: 'Modalidade de determina\u00e7\u00e3o da BC ICMS ST' },
    { key: 'diferimentoIcms', label: 'Diferimento ICMS (%)', align: 'text-right' },
    { key: 'valorIcmsDiferido', label: 'Valor de ICMS Diferido (R$)', align: 'text-right' },
    { key: 'valorIcmsAntesDiferimento', label: 'Valor de ICMS Antes do Diferimento (R$)', align: 'text-right' },
    { key: 'diferimentoFcp', label: 'Diferimento FCP (%)', align: 'text-right' },
    { key: 'valorFcpDiferido', label: 'Valor de FCP Diferido (R$)', align: 'text-right' },
    { key: 'valorFcpAntesDiferimento', label: 'Valor do FCP Antes do Diferimento (R$)', align: 'text-right' },
    { key: 'valorIcmsDesonerado', label: 'Valor ICMS Desonerado (R$)', align: 'text-right' },
    { key: 'motivoDesoneracaoIcms', label: 'Motivo da Desonera\u00e7\u00e3o do ICMS' },
    { key: 'baseIcmsEfetiva', label: 'Base ICMS Efetiva (R$)', align: 'text-right' },
    { key: 'aliqIcmsEfetiva', label: 'Al\u00edquota ICMS Efetiva (%)', align: 'text-right' },
    { key: 'aliqFcpEfetiva', label: 'Al\u00edquota FCP Efetiva (%)', align: 'text-right' },
    { key: 'aliqFcp', label: 'Al\u00edq. FCP (%)', align: 'text-right' },
    { key: 'valorFcp', label: 'Valor FCP (R$)', align: 'text-right' },
    { key: 'iva', label: 'IVA (%)', align: 'text-right' },
    { key: 'pauta', label: 'Pauta (R$)', align: 'text-right' },
    { key: 'baseIcmsSt', label: 'Base ICMS ST (R$)', align: 'text-right' },
    { key: 'aliqIcmsSt', label: 'Al\u00edq. ICMS ST (%)', align: 'text-right' },
    { key: 'valorIcmsSt', label: 'Valor ICMS ST (R$)', align: 'text-right' },
    { key: 'stIpi', label: 'ST IPI' },
    { key: 'cEnqIpi', label: 'C. Enq. IPI' },
    { key: 'baseIpi', label: 'Base IPI (R$)', align: 'text-right' },
    { key: 'ipi', label: 'Al\u00edq. IPI (%)', align: 'text-right' },
    { key: 'valorIpi', label: 'Valor IPI (R$)', align: 'text-right' },
    { key: 'stPis', label: 'ST PIS' },
    { key: 'pis', label: 'Al\u00edq. PIS (%)', align: 'text-right' },
    { key: 'basePis', label: 'Base PIS (R$)', align: 'text-right' },
    { key: 'valorPis', label: 'Valor PIS (R$)', align: 'text-right' },
    { key: 'aliqPisSt', label: 'Al\u00edq. PIS ST (%)', align: 'text-right' },
    { key: 'basePisSt', label: 'Base PIS ST (R$)', align: 'text-right' },
    { key: 'valorPisSt', label: 'Valor PIS ST (R$)', align: 'text-right' },
    { key: 'valorExcluidoBasePis', label: 'Valor exclu\u00eddo da base PIS (R$)', align: 'text-right' },
    { key: 'stCofins', label: 'ST COFINS' },
    { key: 'cofins', label: 'Al\u00edq. COFINS (%)', align: 'text-right' },
    { key: 'baseCofins', label: 'Base COFINS (R$)', align: 'text-right' },
    { key: 'valorCofins', label: 'Valor COFINS (R$)', align: 'text-right' },
    { key: 'aliqCofinsSt', label: 'Al\u00edq. COFINS ST (%)', align: 'text-right' },
    { key: 'baseCofinsSt', label: 'Base COFINS ST (R$)', align: 'text-right' },
    { key: 'valorCofinsSt', label: 'Valor COFINS ST (R$)', align: 'text-right' },
    { key: 'valorExcluidoBaseCofins', label: 'Valor exclu\u00eddo da base COFINS (R$)', align: 'text-right' },
    { key: 'aliqIi', label: 'Al\u00edq. II (%)', align: 'text-right' },
    { key: 'baseIi', label: 'Base II (R$)', align: 'text-right' },
    { key: 'valorIi', label: 'Valor II (R$)', align: 'text-right' },
    { key: 'percIpiDevolv', label: 'Perc. IPI Devolv. (%)', align: 'text-right' },
    { key: 'valorIpiDevolv', label: 'Valor IPI Devolv. (R$)', align: 'text-right' },
    { key: 'codigoBeneficioFiscal', label: 'C\u00f3digo do Benef\u00edcio Fiscal' },
    { key: 'numeroPedido', label: 'N\u00famero Pedido' },
    { key: 'numeroItemPedido', label: 'N\u00famero Item Pedido' },
    { key: 'lote', label: 'Lote' },
    { key: 'codigoBarras', label: 'C\u00f3digo de Barras' },
    { key: 'referencia', label: 'Refer\u00eancia' },
    { key: 'baseFcpSt', label: 'Base C\u00e1lculo FCP ST (R$)', align: 'text-right' },
    { key: 'aliqFcpSt', label: 'Al\u00edq. FCP ST (%)', align: 'text-right' },
    { key: 'valorFcpSt', label: 'Valor FCP ST (R$)', align: 'text-right' },
  ];
  const ITEM_QTY_KEYS = new Set(['qty', 'qtyTrib', 'peso']);
  const ITEM_PERCENT_KEYS = new Set([
    'icms',
    'aliqSuportadaConsumidor',
    'diferimentoIcms',
    'diferimentoFcp',
    'aliqIcmsEfetiva',
    'aliqFcpEfetiva',
    'aliqFcp',
    'iva',
    'aliqIcmsSt',
    'ipi',
    'pis',
    'aliqPisSt',
    'cofins',
    'aliqCofinsSt',
    'aliqIi',
    'percIpiDevolv',
    'aliqFcpSt',
  ]);
  const ITEM_CURRENCY_KEYS = new Set([
    'unit',
    'discount',
    'otherExpenses',
    'freight',
    'insurance',
    'total',
    'unitTrib',
    'baseIcms',
    'valorIcms',
    'bcIcmsStRetAnt',
    'valorIcmsProprioSubstituto',
    'valorIcmsStRetAnt',
    'baseIcmsStUfDestino',
    'valorIcmsStUfDestino',
    'valorIcmsDiferido',
    'valorIcmsAntesDiferimento',
    'valorFcpDiferido',
    'valorFcpAntesDiferimento',
    'valorIcmsDesonerado',
    'baseIcmsEfetiva',
    'valorFcp',
    'pauta',
    'baseIcmsSt',
    'valorIcmsSt',
    'baseIpi',
    'valorIpi',
    'basePis',
    'valorPis',
    'basePisSt',
    'valorPisSt',
    'valorExcluidoBasePis',
    'baseCofins',
    'valorCofins',
    'baseCofinsSt',
    'valorCofinsSt',
    'valorExcluidoBaseCofins',
    'baseIi',
    'valorIi',
    'valorIpiDevolv',
    'baseFcpSt',
    'valorFcpSt',
  ]);

  const VOLUME_COLUMNS = [
    { key: 'identificacao', label: 'N\u00b0 identifica\u00e7\u00e3o dos volumes' },
    { key: 'especie', label: 'Esp\u00e9cie' },
    { key: 'marca', label: 'Marca' },
    { key: 'quantidade', label: 'Quantidade total de volumes', align: 'text-right' },
    { key: 'pesoBruto', label: 'Peso Bruto (KG)', align: 'text-right' },
    { key: 'pesoLiquido', label: 'Peso L\u00edquido (KG)', align: 'text-right' },
    { key: 'cubagem', label: 'Cubagem (M\u00b3)', align: 'text-right' },
  ];

  const UNIT_OPTIONS = [
    { value: 'UN', label: 'Unidade (UN)' },
    { value: 'KG', label: 'Quilograma (KG)' },
    { value: 'G', label: 'Grama (G)' },
    { value: 'MG', label: 'Miligrama (MG)' },
    { value: 'L', label: 'Litro (L)' },
    { value: 'ML', label: 'Mililitro (ML)' },
    { value: 'CX', label: 'Caixa (CX)' },
    { value: 'PCT', label: 'Pacote (PCT)' },
    { value: 'SC', label: 'Saco (SC)' },
    { value: 'FD', label: 'Fardo (FD)' },
    { value: 'DZ', label: 'D\u00fazia (DZ)' },
  ];

  const REF_COLUMNS = [
    { key: 'numero', label: 'N\u00b0 NF' },
    { key: 'dataEmissao', label: 'Data de Emiss\u00e3o' },
    { key: 'emissor', label: 'Emissor' },
  ];

  const buildItemTableState = () => ({
    filters: ITEM_COLUMNS.reduce((acc, col) => {
      acc[col.key] = '';
      return acc;
    }, {}),
    selections: ITEM_COLUMNS.reduce((acc, col) => {
      acc[col.key] = new Set();
      return acc;
    }, {}),
    sort: { key: '', direction: 'asc' },
  });

  const itemTableState = buildItemTableState();
  const itemTableControls = {
    filterInputs: new Map(),
    sortButtons: new Map(),
    sortHeaders: new Map(),
    filterTriggers: new Map(),
    activeDropdown: null,
    activeKey: null,
  };
  const buildVolumeTableState = () => ({
    filters: VOLUME_COLUMNS.reduce((acc, col) => {
      acc[col.key] = '';
      return acc;
    }, {}),
    selections: VOLUME_COLUMNS.reduce((acc, col) => {
      acc[col.key] = new Set();
      return acc;
    }, {}),
    sort: { key: '', direction: 'asc' },
  });
  const volumeTableState = buildVolumeTableState();
  const volumeTableControls = {
    filterInputs: new Map(),
    sortButtons: new Map(),
    sortHeaders: new Map(),
    filterTriggers: new Map(),
    activeDropdown: null,
    activeKey: null,
  };
  let volumeRowSequence = 0;

  const buildRefTableState = () => ({
    filters: REF_COLUMNS.reduce((acc, col) => {
      acc[col.key] = '';
      return acc;
    }, {}),
    selections: REF_COLUMNS.reduce((acc, col) => {
      acc[col.key] = new Set();
      return acc;
    }, {}),
    sort: { key: '', direction: 'asc' },
  });
  const refTableState = buildRefTableState();
  const refTableControls = {
    filterInputs: new Map(),
    sortButtons: new Map(),
    sortHeaders: new Map(),
    filterTriggers: new Map(),
    activeDropdown: null,
    activeKey: null,
  };
  let refRowSequence = 0;
  let itemRowSequence = 0;
  let icmsSimplesCache = {
    companyId: '',
    map: null,
    list: [],
    loading: false,
  };

  const actionButtons = {
    save: document.getElementById('nfe-action-save'),
    manage: document.getElementById('nfe-action-manage'),
    validate: document.getElementById('nfe-action-validate'),
    emit: document.getElementById('nfe-action-emit'),
    view: document.getElementById('nfe-action-view'),
    status: document.getElementById('nfe-action-status'),
    cancel: document.getElementById('nfe-action-cancel'),
  };

  const totals = {
    products: document.getElementById('nfe-total-products'),
    discounts: document.getElementById('nfe-total-discounts'),
    baseIcms: document.getElementById('nfe-base-icms'),
    icms: document.getElementById('nfe-total-icms'),
    ipi: document.getElementById('nfe-total-ipi'),
    pis: document.getElementById('nfe-total-pis'),
    cofins: document.getElementById('nfe-total-cofins'),
    note: document.getElementById('nfe-total-note'),
  };

  const paymentKpis = {
    total: document.getElementById('nfe-payment-kpi-total'),
    remaining: document.getElementById('nfe-payment-kpi-remaining'),
    change: document.getElementById('nfe-payment-kpi-change'),
  };

  const extraInputs = {
    frete: document.getElementById('nfe-frete'),
    outros: document.getElementById('nfe-outros'),
    paymentValue: document.getElementById('nfe-payment-value'),
  };

  const serieFields = {
    select: document.getElementById('nfe-serie'),
    model: document.getElementById('nfe-model'),
  };

  const crediarioFields = {
    type: document.getElementById('nfe-crediario-type'),
    due: document.getElementById('nfe-crediario-due'),
    installments: document.getElementById('nfe-crediario-installments'),
    value: document.getElementById('nfe-crediario-value'),
    bankAccount: document.getElementById('nfe-crediario-bank-account'),
    accountingAccount: document.getElementById('nfe-crediario-accounting-account'),
    add: document.getElementById('nfe-crediario-add'),
    reset: document.getElementById('nfe-crediario-new'),
    table: document.getElementById('nfe-crediario-table'),
    empty: document.getElementById('nfe-crediario-empty'),
  };

  const chequeFields = {
    date: document.getElementById('nfe-cheque-date'),
    value: document.getElementById('nfe-cheque-value'),
    bank: document.getElementById('nfe-cheque-bank'),
    account: document.getElementById('nfe-cheque-account'),
    agency: document.getElementById('nfe-cheque-agency'),
    number: document.getElementById('nfe-cheque-number'),
    client: document.getElementById('nfe-cheque-client'),
    holder: document.getElementById('nfe-cheque-holder'),
    holderType: document.getElementById('nfe-cheque-holder-type'),
    cpf: document.getElementById('nfe-cheque-cpf'),
    phone: document.getElementById('nfe-cheque-phone'),
    address: document.getElementById('nfe-cheque-address'),
    add: document.getElementById('nfe-cheque-add'),
    reset: document.getElementById('nfe-cheque-new'),
    table: document.getElementById('nfe-cheque-table'),
    empty: document.getElementById('nfe-cheque-empty'),
    tableWrapper: document.querySelector('[data-payment-cheque-table]'),
  };

  const cardFields = {
    method: document.getElementById('nfe-card-method'),
    value: document.getElementById('nfe-card-value'),
    add: document.getElementById('nfe-card-add'),
    reset: document.getElementById('nfe-card-new'),
    table: document.getElementById('nfe-card-table'),
    empty: document.getElementById('nfe-card-empty'),
    tableWrapper: document.querySelector('[data-payment-card-table]'),
    methods: [],
  };

  const cashFields = {
    value: document.getElementById('nfe-cash-value'),
    add: document.getElementById('nfe-cash-add'),
    reset: document.getElementById('nfe-cash-new'),
    table: document.getElementById('nfe-cash-table'),
    empty: document.getElementById('nfe-cash-empty'),
    tableWrapper: document.querySelector('[data-payment-cash-table]'),
  };

  const pixFields = {
    value: document.getElementById('nfe-pix-value'),
    add: document.getElementById('nfe-pix-add'),
    reset: document.getElementById('nfe-pix-new'),
    table: document.getElementById('nfe-pix-table'),
    empty: document.getElementById('nfe-pix-empty'),
    tableWrapper: document.querySelector('[data-payment-pix-table]'),
  };

  const otherFields = {
    method: document.getElementById('nfe-other-method'),
    value: document.getElementById('nfe-other-value'),
    add: document.getElementById('nfe-other-add'),
    reset: document.getElementById('nfe-other-new'),
    table: document.getElementById('nfe-other-table'),
    empty: document.getElementById('nfe-other-empty'),
    tableWrapper: document.querySelector('[data-payment-other-table]'),
  };

  const STATUS_CONFIG = {
    draft: {
      label: 'Rascunho',
      classes: ['bg-amber-100', 'text-amber-700'],
      actions: { save: true, validate: true, emit: false, view: false, status: false, cancel: false },
    },
    ready: {
      label: 'Pronta para envio',
      classes: ['bg-blue-100', 'text-blue-700'],
      actions: { save: true, validate: true, emit: true, view: false, status: false, cancel: false },
    },
    authorized: {
      label: 'Autorizada',
      classes: ['bg-emerald-100', 'text-emerald-700'],
      actions: { save: false, validate: false, emit: false, view: true, status: true, cancel: true },
    },
    rejected: {
      label: 'Rejeitada',
      classes: ['bg-red-100', 'text-red-700'],
      actions: { save: true, validate: true, emit: true, view: false, status: true, cancel: false },
    },
    canceled: {
      label: 'Cancelada',
      classes: ['bg-gray-200', 'text-gray-600'],
      actions: { save: false, validate: false, emit: false, view: true, status: true, cancel: false },
    },
  };

  let currentStatus = 'draft';
  let currentDraftId = '';
  let currentDraftCode = '';
  let currentDraftMetadata = {};
  let currentDraftXmlAmbient = '';
  let nfeEventEntries = [];
  const INVALID_CODE_FLAG = 'nfe:invalid-code';
  let defaultFormState = null;

  const requiredFields = Array.from(document.querySelectorAll('[data-required]'));

  const emitenteFields = {
    razao: document.getElementById('nfe-emitente-razao'),
    fantasia: document.getElementById('nfe-emitente-fantasia'),
    cnpj: document.getElementById('nfe-emitente-cnpj'),
    ie: document.getElementById('nfe-emitente-ie'),
    regime: document.getElementById('nfe-emitente-regime'),
    endereco: document.getElementById('nfe-emitente-endereco'),
  };
  const emitenteSelectButton = document.getElementById('nfe-emitente-select');

  const infoFields = {
    contribuinte: document.getElementById('nfe-info-contribuinte'),
    contribuinteAuto: document.getElementById('nfe-info-contribuinte-auto'),
    fisco: document.getElementById('nfe-info-fisco'),
    microchip: document.getElementById('nfe-info-microchip'),
  };

  const clientFields = {
    name: document.getElementById('nfe-client-name'),
    doc: document.getElementById('nfe-client-doc'),
    docAlert: document.getElementById('nfe-client-doc-alert'),
    ie: document.getElementById('nfe-client-ie'),
    phone: document.getElementById('nfe-client-phone'),
    consumerFinal: document.getElementById('nfe-client-consumer-final'),
    address: document.getElementById('nfe-client-address'),
    number: document.getElementById('nfe-client-number'),
    complement: document.getElementById('nfe-client-complement'),
    neighborhood: document.getElementById('nfe-client-neighborhood'),
    zip: document.getElementById('nfe-client-zip'),
    city: document.getElementById('nfe-client-city'),
    state: document.getElementById('nfe-client-state'),
    country: document.getElementById('nfe-client-country'),
  };

  const codeInput = document.getElementById('nfe-codigo');
  const partyTypeSelect = document.getElementById('nfe-party-type');
  const partySearchInput = document.getElementById('nfe-client-search');
  const productCodeInput = document.getElementById('nfe-product-code');
  const serviceTypeSelect = document.getElementById('nfe-service-type');
  const operationSelect = document.getElementById('nfe-operacao');
  const naturezaOperacaoSelect = document.getElementById('nfe-natureza-operacao');
  const naturezaSelect = document.getElementById('nfe-natureza');
  const finalidadeSelect = document.getElementById('nfe-finalidade');
  const stockMovementSelect = document.getElementById('nfe-stock-movement');
  const stockDepositSelect = document.getElementById('nfe-stock-deposit');
  const freightModeSelect = document.getElementById('nfe-frete-modalidade');
  const paymentDeliveryInput = document.getElementById('nfe-payment-delivery');

  const issueDateInput = document.getElementById('nfe-issue-date');
  const exitDateInput = document.getElementById('nfe-exit-date');
  const numberInput = document.getElementById('nfe-number');

  const historyList = document.getElementById('nfe-history');
  const headerActionSelector = '[data-nfe-action]';
  const manageModalId = 'nfe-manage-modal';
  const eventsModalId = 'nfe-events-modal';
  const manageModalTitle = 'Gerenciar NF';

  const MONEY_FORMAT = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const API_BASE =
    typeof API_CONFIG !== 'undefined' && API_CONFIG?.BASE_URL
      ? API_CONFIG.BASE_URL
      : '/api';

  const PARTY_TYPES = {
    client: 'cliente',
    supplier: 'fornecedor',
  };
  const SUPPLIER_CACHE_TTL_MS = 2 * 60 * 1000;
  const CUSTOMER_SEARCH_LIMIT = 8;

  let partySearchTimeout = null;
  let partyModalOpen = false;
  let partySearchSilent = false;
  let partyModalObserver = null;
  let partyModalState = null;
  let supplierCache = null;
  let supplierCacheFetchedAt = 0;
  let chequeSearchTimeout = null;
  let chequeModalOpen = false;
  let chequeModalState = null;
  let chequeModalObserver = null;
  let fiscalSeries = [];
  let cestOptionsCache = {
    loaded: false,
    loading: false,
    values: [],
    descriptions: new Map(),
  };
  let cestDropdownOpen = false;
  let modalProductFiscalSnapshot = null;
  let modalProductSnapshot = null;
  let applyingFiscalRules = false;
  let emitenteModalOpen = false;
  let emitenteModalState = null;
  let emitenteModalObserver = null;
  let emitenteStoresCache = null;

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeDigits(value) {
    return normalizeString(value).replace(/\D/g, '');
  }

  function normalizeKeyword(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function resolveEmitenteName(store) {
    if (!store || typeof store !== 'object') return '';
    return store.razaoSocial || store.nomeFantasia || store.nome || '';
  }

  function resolveEmitenteFantasy(store) {
    if (!store || typeof store !== 'object') return '';
    return store.nomeFantasia || store.nome || '';
  }

  function resolveEmitenteDocument(store) {
    if (!store || typeof store !== 'object') return '';
    return store.cnpj || store.documento || '';
  }

  async function fetchEmitenteStores() {
    if (emitenteStoresCache) return emitenteStoresCache;
    if (typeof fetchAllowedStores !== 'function') return [];
    const stores = await fetchAllowedStores();
    emitenteStoresCache = Array.isArray(stores) ? stores : [];
    return emitenteStoresCache;
  }

  function filterEmitenteStores(query, stores) {
    const trimmed = normalizeString(query);
    if (!trimmed) return stores;
    const digits = normalizeDigits(trimmed);
    if (digits) {
      return stores.filter((store) => normalizeDigits(resolveEmitenteDocument(store)).includes(digits));
    }
    const keyword = normalizeKeyword(trimmed);
    if (!keyword) return stores;
    return stores.filter((store) => {
      const razao = normalizeKeyword(resolveEmitenteName(store));
      const fantasia = normalizeKeyword(resolveEmitenteFantasy(store));
      return (razao && razao.includes(keyword)) || (fantasia && fantasia.includes(keyword));
    });
  }

  function applyEmitenteSelection(store) {
    if (!store) return;
    emitenteFields.razao.value = store.razaoSocial || store.nome || '';
    emitenteFields.fantasia.value = store.nomeFantasia || store.nome || '';
    emitenteFields.cnpj.value = store.cnpj || '';
    emitenteFields.ie.value = store.inscricaoEstadual || '';
    emitenteFields.regime.value = formatRegime(store.regimeTributario || '');
    emitenteFields.endereco.value = store.endereco || formatAddress(store);
    const storeId = store._id || store.id || '';
    if (storeId && typeof setActiveCompanyId === 'function') {
      setActiveCompanyId(String(storeId));
    }
    icmsSimplesCache = { companyId: '', map: null, list: [], loading: false };
    loadFiscalSeries();
    loadStockDeposits();
    loadCrediarioAccounts();
    loadCardMethods();
    captureDefaultState(true);
  }

  function closeEmitenteSearchModal() {
    const modal = document.getElementById('info-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    emitenteModalOpen = false;
    emitenteModalState = null;
    if (emitenteModalObserver) {
      emitenteModalObserver.disconnect();
      emitenteModalObserver = null;
    }
  }

  function observeEmitenteModalClose() {
    const modal = document.getElementById('info-modal');
    if (!modal || emitenteModalObserver) return;
    emitenteModalObserver = new MutationObserver(() => {
      if (modal.classList.contains('hidden')) {
        emitenteModalOpen = false;
        emitenteModalState = null;
        emitenteModalObserver?.disconnect();
        emitenteModalObserver = null;
      }
    });
    emitenteModalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function renderEmitenteModalResults() {
    if (!emitenteModalState) return;
    const { results, list, empty, query, loading, error } = emitenteModalState;
    if (!list || !empty) return;
    list.innerHTML = '';
    empty.textContent = '';

    if (loading) {
      empty.textContent = 'Carregando resultados...';
      return;
    }

    if (error) {
      empty.textContent = error;
      return;
    }

    if (!query) {
      empty.textContent = 'Digite para buscar por CNPJ, razão social ou nome fantasia.';
      return;
    }

    if (!results.length) {
      empty.textContent = `Nenhuma empresa encontrada para "${query}".`;
      return;
    }

    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.emitenteIndex = String(index);
      button.className =
        'flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary/5';
      const razao = resolveEmitenteName(item);
      const fantasia = resolveEmitenteFantasy(item);
      const cnpj = resolveEmitenteDocument(item);
      button.innerHTML = `
        <div class="flex flex-col">
          <span class="font-semibold text-gray-800">${razao || 'Sem razão social'}</span>
          <span class="text-xs text-gray-500">${fantasia ? `Fantasia: ${fantasia}` : 'Fantasia não informada'}</span>
          <span class="text-[11px] text-gray-400">${cnpj ? `CNPJ: ${cnpj}` : ''}</span>
        </div>
        <span class="text-[11px] font-semibold text-primary">Selecionar</span>
      `;
      list.appendChild(button);
    });
  }

  async function loadEmitenteModalResults(query) {
    if (!emitenteModalState) return;
    emitenteModalState.loading = true;
    emitenteModalState.error = '';
    emitenteModalState.query = query;
    renderEmitenteModalResults();
    try {
      const stores = await fetchEmitenteStores();
      emitenteModalState.results = filterEmitenteStores(query, stores);
    } catch (error) {
      emitenteModalState.error = error?.message || 'Nao foi possivel buscar empresas.';
      emitenteModalState.results = [];
    } finally {
      emitenteModalState.loading = false;
      renderEmitenteModalResults();
    }
  }

  async function openEmitenteSearchModal(query) {
    if (typeof showModal !== 'function') {
      if (typeof showToast === 'function') {
        showToast('Modal de busca indisponivel.', 'warning');
      }
      return;
    }

    if (emitenteModalOpen && emitenteModalState) {
      emitenteModalState.query = query;
      if (emitenteModalState.input) {
        emitenteModalState.input.value = query || '';
      }
      loadEmitenteModalResults(query);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'text-left flex flex-col gap-3';
    wrapper.style.maxHeight = '70vh';
    wrapper.style.overflow = 'hidden';
    wrapper.innerHTML = `
      <div class="space-y-1">
        <label class="block text-xs font-semibold text-gray-500">Buscar empresa emitente</label>
        <input id="nfe-emitente-modal-search" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      <div id="nfe-emitente-modal-results" class="max-h-60 space-y-2 overflow-y-auto"></div>
      <p id="nfe-emitente-modal-empty" class="text-xs text-gray-500"></p>
    `;

    emitenteModalState = {
      wrapper,
      input: wrapper.querySelector('#nfe-emitente-modal-search'),
      list: wrapper.querySelector('#nfe-emitente-modal-results'),
      empty: wrapper.querySelector('#nfe-emitente-modal-empty'),
      results: [],
      query,
      loading: false,
      error: '',
    };

    showModal({
      title: 'Selecione a Empresa Emitente',
      message: wrapper,
      confirmText: 'Fechar',
      onConfirm: () => {
        closeEmitenteSearchModal();
        return true;
      },
    });

    emitenteModalOpen = true;
    observeEmitenteModalClose();

    if (emitenteModalState.input) {
      emitenteModalState.input.value = query || '';
      emitenteModalState.input.addEventListener('input', (event) => {
        const nextQuery = normalizeString(event.target.value);
        loadEmitenteModalResults(nextQuery);
      });
    }

    emitenteModalState.list?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-emitente-index]');
      if (!target) return;
      const index = Number(target.dataset.emitenteIndex || '-1');
      const selected = emitenteModalState?.results?.[index];
      if (!selected) return;
      applyEmitenteSelection(selected);
      closeEmitenteSearchModal();
    });

    loadEmitenteModalResults(query);
  }

  function normalizeItemText(value) {
    return normalizeKeyword(value);
  }

  function escapeItemRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildItemFilterRegex(rawValue) {
    const normalized = normalizeItemText(rawValue || '');
    if (!normalized) return null;
    const pattern = normalized
      .split('*')
      .map((segment) => escapeItemRegex(segment))
      .join('.*');
    if (!pattern) return null;
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      console.warn('Filtro inv\u00e1lido ignorado na tabela de itens.', error);
      return null;
    }
  }

  function getItemFieldValue(row, key) {
    if (!row) return '';
    const input = row.querySelector(`[data-field="${key}"]`);
    if (input) {
      if (input.tagName === 'INPUT' || input.tagName === 'SELECT') {
        return input.value || '';
      }
      return input.textContent || '';
    }
    return '';
  }

  function getItemCandidates(row, key) {
    return [getItemFieldValue(row, key)];
  }

  function matchesItemFilter(row, key, filterValue) {
    const regex = buildItemFilterRegex(filterValue);
    if (!regex) return true;
    const candidates = getItemCandidates(row, key);
    return candidates.some((candidate) => regex.test(normalizeItemText(candidate)));
  }

  function matchesItemSelection(row, key) {
    const selection = itemTableState.selections?.[key];
    if (!selection || selection.size === 0) return true;
    const normalizedSelection = new Set(Array.from(selection).map((value) => normalizeItemText(value)));
    return getItemCandidates(row, key).some((candidate) => normalizedSelection.has(normalizeItemText(candidate)));
  }

  function applyItemFilters(rows) {
    const list = Array.from(rows || []);
    const activeFilters = Object.entries(itemTableState.filters).filter(([, value]) => value.trim() !== '');
    const selectionKeys = Object.keys(itemTableState.selections).filter((key) => itemTableState.selections[key].size);
    if (!activeFilters.length && !selectionKeys.length) return list;
    return list.filter((row) =>
      activeFilters.every(([key, value]) => matchesItemFilter(row, key, value)) &&
      selectionKeys.every((key) => matchesItemSelection(row, key)),
    );
  }

  function getItemSortValue(row, key) {
    const value = getItemFieldValue(row, key);
    const numericKeys = new Set([
      'qty',
      'unit',
      'discount',
      'otherExpenses',
      'freight',
      'insurance',
      'total',
      'qtyTrib',
      'unitTrib',
      'peso',
      'baseIcms',
      'icms',
      'valorIcms',
      'bcIcmsStRetAnt',
      'aliqSuportadaConsumidor',
      'valorIcmsProprioSubstituto',
      'valorIcmsStRetAnt',
      'baseIcmsStUfDestino',
      'valorIcmsStUfDestino',
      'diferimentoIcms',
      'valorIcmsDiferido',
      'valorIcmsAntesDiferimento',
      'diferimentoFcp',
      'valorFcpDiferido',
      'valorFcpAntesDiferimento',
      'valorIcmsDesonerado',
      'baseIcmsEfetiva',
      'aliqIcmsEfetiva',
      'aliqFcpEfetiva',
      'aliqFcp',
      'valorFcp',
      'iva',
      'pauta',
      'baseIcmsSt',
      'aliqIcmsSt',
      'valorIcmsSt',
      'baseIpi',
      'ipi',
      'valorIpi',
      'pis',
      'basePis',
      'valorPis',
      'aliqPisSt',
      'basePisSt',
      'valorPisSt',
      'valorExcluidoBasePis',
      'cofins',
      'baseCofins',
      'valorCofins',
      'aliqCofinsSt',
      'baseCofinsSt',
      'valorCofinsSt',
      'valorExcluidoBaseCofins',
      'aliqIi',
      'baseIi',
      'valorIi',
      'percIpiDevolv',
      'valorIpiDevolv',
      'baseFcpSt',
      'aliqFcpSt',
      'valorFcpSt',
    ]);
    if (numericKeys.has(key)) {
      return parseNumber(value);
    }
    return normalizeItemText(value);
  }

  function applyItemSort(rows) {
    const list = Array.from(rows || []);
    const { key: sortKey, direction } = itemTableState.sort;
    if (!sortKey) return list;
    const multiplier = direction === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const valueA = getItemSortValue(a, sortKey);
      const valueB = getItemSortValue(b, sortKey);
      const isNumber = typeof valueA === 'number' && typeof valueB === 'number';
      if (isNumber) {
        if (valueA === valueB) {
          return Number(a.dataset.order || 0) - Number(b.dataset.order || 0);
        }
        return valueA > valueB ? multiplier : -multiplier;
      }
      const comparison = String(valueA).localeCompare(String(valueB), 'pt-BR', { sensitivity: 'base', numeric: true });
      if (comparison === 0) {
        return Number(a.dataset.order || 0) - Number(b.dataset.order || 0);
      }
      return comparison * multiplier;
    });
  }

  function applyItemFiltersAndSort() {
    if (!itemsBody) return;
    const rows = Array.from(itemsBody.querySelectorAll('tr[data-item-row]'));
    if (!rows.length) return;
    rows.forEach((row) => {
      if (!row.dataset.order) {
        row.dataset.order = String(itemRowSequence++);
      }
    });
    const filtered = applyItemFilters(rows);
    const sorted = applyItemSort(rows);
    const filteredSet = new Set(filtered);
    sorted.forEach((row) => {
      row.classList.toggle('hidden', !filteredSet.has(row));
      itemsBody.appendChild(row);
    });
  }

  function renderItemTableHeader() {
      const head = document.getElementById('nfe-items-head');
      if (!head) return;
      const headerCells = ITEM_COLUMNS.map((column, index) => {
        const alignClass = column.align || 'text-left';
        return `
          <th class="relative px-3 py-2 ${alignClass}" data-nfe-item-sort-header="${column.key}" data-nfe-item-col-index="${index}">
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between gap-1">
                <span class="whitespace-nowrap">${column.label}</span>
                <div class="flex flex-col items-center justify-center gap-px text-gray-400">
                  <button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-item-sort="${column.key}" data-sort-direction="asc" aria-label="Ordenar crescente por ${column.label}">
                    <i class="fas fa-sort-up text-[9px]"></i>
                  </button>
                  <button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-item-sort="${column.key}" data-sort-direction="desc" aria-label="Ordenar decrescente por ${column.label}">
                    <i class="fas fa-sort-down text-[9px]"></i>
                  </button>
                </div>
              </div>
              <div class="relative">
                <button type="button" class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-item-filter-trigger="${column.key}" aria-label="Abrir filtro de ${column.label}">
                  <i class="fas fa-magnifying-glass"></i>
                </button>
                <input type="text" placeholder="Filtrar" class="w-full rounded border border-gray-200 bg-white pl-6 pr-2 py-1 text-[10px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${alignClass === 'text-right' ? 'text-right' : ''}" data-nfe-item-filter="${column.key}">
              </div>
            </div>
            <span class="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none" data-nfe-item-resize="${column.key}" aria-hidden="true"></span>
          </th>
        `;
      }).join('');
      head.innerHTML = `<tr>${headerCells}</tr>`;
      if (itemsEmpty) {
        itemsEmpty.setAttribute('colspan', String(ITEM_COLUMNS.length));
      }
    }

    function applyItemColumnWidth(index, width) {
      const headCell = document.querySelector(`[data-nfe-item-col-index="${index}"]`);
      if (headCell) headCell.style.width = `${width}px`;
      const rows = Array.from(itemsBody?.querySelectorAll('tr[data-item-row]') || []);
      rows.forEach((row) => {
        const cell = row.children[index];
        if (cell) cell.style.width = `${width}px`;
      });
    }

  function syncItemColumnWidths() {
    const headCells = Array.from(document.querySelectorAll('[data-nfe-item-col-index]'));
    headCells.forEach((cell) => {
      const index = Number(cell.dataset.nfeItemColIndex);
      if (Number.isNaN(index)) return;
      const width = cell.getBoundingClientRect().width;
      if (width > 0) applyItemColumnWidth(index, width);
    });
  }

  function renderVolumeTableHeader() {
    if (!volumesHead) return;
    const headerCells = VOLUME_COLUMNS.map((column) => {
      const alignClass = column.align || 'text-left';
      return `
        <th class="px-3 py-2 ${alignClass}" data-nfe-volume-sort-header="${column.key}">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-1">
              <span class="whitespace-nowrap">${column.label}</span>
              <div class="flex flex-col items-center justify-center gap-px text-gray-400">
                <button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-volume-sort="${column.key}" data-sort-direction="asc" aria-label="Ordenar crescente por ${column.label}">
                  <i class="fas fa-sort-up text-[9px]"></i>
                </button>
                <button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-volume-sort="${column.key}" data-sort-direction="desc" aria-label="Ordenar decrescente por ${column.label}">
                  <i class="fas fa-sort-down text-[9px]"></i>
                </button>
              </div>
            </div>
            <div class="relative">
              <button type="button" class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-volume-filter-trigger="${column.key}" aria-label="Abrir filtro de ${column.label}">
                <i class="fas fa-magnifying-glass"></i>
              </button>
              <input type="text" placeholder="Filtrar" class="w-full rounded border border-gray-200 bg-white pl-6 pr-2 py-1 text-[10px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${alignClass === 'text-right' ? 'text-right' : ''}" data-nfe-volume-filter="${column.key}">
            </div>
          </div>
        </th>
      `;
    }).join('');
    volumesHead.innerHTML = `<tr>${headerCells}</tr>`;
    if (volumesEmpty) volumesEmpty.setAttribute('colspan', String(VOLUME_COLUMNS.length));
  }

  function setVolumeFilter(key, value) {
    if (!key) return;
    const nextValue = typeof value === 'string' ? value : '';
    if (volumeTableState.filters[key] === nextValue) return;
    volumeTableState.filters[key] = nextValue;
    applyVolumeFiltersAndSort();
  }

  function setVolumeSort(key, direction) {
    if (!key) return;
    const nextDirection = direction === 'desc' ? 'desc' : 'asc';
    if (volumeTableState.sort.key === key && volumeTableState.sort.direction === nextDirection) {
      volumeTableState.sort = { key: '', direction: 'asc' };
    } else {
      volumeTableState.sort = { key, direction: nextDirection };
    }
    updateVolumeSortButtons();
    applyVolumeFiltersAndSort();
  }

  function updateVolumeSortButtons() {
    const activeKey = volumeTableState.sort.key;
    const activeDirection = volumeTableState.sort.direction;
    volumeTableControls.sortHeaders.forEach((header, key) => {
      if (!header) return;
      if (activeKey && key === activeKey) {
        header.setAttribute('aria-sort', activeDirection === 'desc' ? 'descending' : 'ascending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });
    volumeTableControls.sortButtons.forEach((meta, button) => {
      if (!button) return;
      const isActive = meta.key === activeKey && meta.direction === activeDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/60', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updateVolumeFilterTriggerState(key) {
    const trigger = volumeTableControls.filterTriggers.get(key);
    if (!trigger) return;
    const hasSelection = volumeTableState.selections[key]?.size;
    trigger.classList.toggle('text-primary', !!hasSelection);
  }

  function closeVolumeFilterDropdown() {
    if (volumeTableControls.activeDropdown) {
      volumeTableControls.activeDropdown.remove();
      volumeTableControls.activeDropdown = null;
      volumeTableControls.activeKey = null;
    }
  }

  function getVolumeFieldValue(row, key) {
    if (!row) return '';
    const input = row.querySelector(`[data-volume-field="${key}"]`);
    if (input) {
      if (input.tagName === 'INPUT' || input.tagName === 'SELECT') return input.value || '';
      return input.textContent || '';
    }
    return row.querySelector(`[data-volume-cell="${key}"]`)?.textContent || '';
  }

  function getVolumeCandidates(row, key) {
    return [getVolumeFieldValue(row, key)];
  }

  function buildVolumeFilterRegex(rawValue) {
    const normalized = normalizeItemText(rawValue || '');
    if (!normalized) return null;
    const pattern = normalized
      .split('*')
      .map((segment) => escapeItemRegex(segment))
      .join('.*');
    if (!pattern) return null;
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      console.warn('Filtro invalido ignorado na tabela de volumes.', error);
      return null;
    }
  }

  function matchesVolumeFilter(row, key, filterValue) {
    const regex = buildVolumeFilterRegex(filterValue);
    if (!regex) return true;
    const candidates = getVolumeCandidates(row, key);
    return candidates.some((candidate) => regex.test(normalizeItemText(candidate)));
  }

  function matchesVolumeSelection(row, key) {
    const selection = volumeTableState.selections?.[key];
    if (!selection || selection.size === 0) return true;
    const normalizedSelection = new Set(Array.from(selection).map((value) => normalizeItemText(value)));
    return getVolumeCandidates(row, key).some((candidate) => normalizedSelection.has(normalizeItemText(candidate)));
  }

  function applyVolumeFilters(rows) {
    const list = Array.from(rows || []);
    const activeFilters = Object.entries(volumeTableState.filters).filter(([, value]) => value.trim() !== '');
    const selectionKeys = Object.keys(volumeTableState.selections).filter((key) => volumeTableState.selections[key].size);
    if (!activeFilters.length && !selectionKeys.length) return list;
    return list.filter((row) =>
      activeFilters.every(([key, value]) => matchesVolumeFilter(row, key, value)) &&
      selectionKeys.every((key) => matchesVolumeSelection(row, key)),
    );
  }

  function getVolumeSortValue(row, key) {
    const value = getVolumeFieldValue(row, key);
    const numericKeys = new Set(['quantidade', 'pesoBruto', 'pesoLiquido', 'cubagem']);
    if (numericKeys.has(key)) return parseNumber(value);
    return normalizeItemText(value);
  }

  function applyVolumeSort(rows) {
    const list = Array.from(rows || []);
    const { key: sortKey, direction } = volumeTableState.sort;
    if (!sortKey) return list;
    const multiplier = direction === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const valueA = getVolumeSortValue(a, sortKey);
      const valueB = getVolumeSortValue(b, sortKey);
      const isNumber = typeof valueA === 'number' && typeof valueB === 'number';
      if (isNumber) {
        if (valueA === valueB) return Number(a.dataset.order || 0) - Number(b.dataset.order || 0);
        return valueA > valueB ? multiplier : -multiplier;
      }
      const comparison = String(valueA).localeCompare(String(valueB), 'pt-BR', { sensitivity: 'base', numeric: true });
      if (comparison === 0) return Number(a.dataset.order || 0) - Number(b.dataset.order || 0);
      return comparison * multiplier;
    });
  }

  function applyVolumeFiltersAndSort() {
    if (!volumesBody) return;
    const rows = Array.from(volumesBody.querySelectorAll('tr[data-volume-row]'));
    if (!rows.length) return;
    rows.forEach((row) => {
      if (!row.dataset.order) row.dataset.order = String(volumeRowSequence++);
    });
    const filtered = applyVolumeFilters(rows);
    const sorted = applyVolumeSort(rows);
    const filteredSet = new Set(filtered);
    sorted.forEach((row) => {
      row.classList.toggle('hidden', !filteredSet.has(row));
      volumesBody.appendChild(row);
    });
  }

  function getVolumeUniqueValues(key) {
    const values = new Set();
    const rows = Array.from(volumesBody?.querySelectorAll('tr[data-volume-row]') || []);
    rows.forEach((row) => {
      getVolumeCandidates(row, key).forEach((candidate) => {
        const value = normalizeString(candidate);
        if (value) values.add(value);
      });
    });
    return Array.from(values).sort((a, b) =>
      normalizeItemText(a).localeCompare(normalizeItemText(b), 'pt-BR', { sensitivity: 'base', numeric: true }),
    );
  }

  function applyVolumeSelectionFilter(key, values, totalOptions = 0) {
    const selection = volumeTableState.selections[key];
    if (!selection) return;
    selection.clear();
    if (values.length && totalOptions && values.length >= totalOptions) {
      updateVolumeFilterTriggerState(key);
      applyVolumeFiltersAndSort();
      return;
    }
    values.forEach((value) => selection.add(value));
    updateVolumeFilterTriggerState(key);
    applyVolumeFiltersAndSort();
  }

  function buildVolumeFilterDropdown(key, anchor) {
    const existingSelection = volumeTableState.selections[key] || new Set();
    const values = getVolumeUniqueValues(key);
    const dropdown = document.createElement('div');
    dropdown.className =
      'absolute z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg';
    dropdown.innerHTML = `
      <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Opcoes
        <button type="button" class="text-gray-400 hover:text-gray-600" data-volume-close>&times;</button>
      </div>
      <div class="max-h-56 overflow-y-auto px-3 py-2 text-xs text-gray-600" data-volume-options></div>
      <div class="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-[10px] text-gray-500">
        <button type="button" class="text-primary" data-volume-select-all>Selecionar tudo</button>
        <button type="button" class="text-gray-500" data-volume-clear>Limpar</button>
      </div>
    `;
    const optionsContainer = dropdown.querySelector('[data-volume-options]');
    const hasStoredSelection = existingSelection.size > 0;
    values.forEach((value) => {
      const item = document.createElement('label');
      item.className = 'flex items-center gap-2 py-1';
      const checked = hasStoredSelection ? existingSelection.has(value) : true;
      item.innerHTML = `
        <input type="checkbox" class="h-3 w-3 rounded border-gray-300 text-primary focus:ring-primary/30" value="${value}" ${checked ? 'checked' : ''}>
        <span class="flex-1 truncate">${value}</span>
      `;
      optionsContainer?.appendChild(item);
    });
    const updateSelection = () => {
      const selectedValues = Array.from(dropdown.querySelectorAll('input[type="checkbox"]'))
        .filter((input) => input.checked)
        .map((input) => input.value);
      applyVolumeSelectionFilter(key, selectedValues, values.length);
    };
    dropdown.addEventListener('change', updateSelection);
    dropdown.querySelector('[data-volume-close]')?.addEventListener('click', () => closeVolumeFilterDropdown());
    dropdown.querySelector('[data-volume-select-all]')?.addEventListener('click', () => {
      dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.checked = true;
      });
      updateSelection();
    });
    dropdown.querySelector('[data-volume-clear]')?.addEventListener('click', () => {
      dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.checked = false;
      });
      updateSelection();
    });
    anchor.parentElement?.appendChild(dropdown);
    volumeTableControls.activeDropdown = dropdown;
    volumeTableControls.activeKey = key;
  }

  function handleVolumeFilterTriggerClick(event, key) {
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (volumeTableControls.activeDropdown && volumeTableControls.activeKey === key) {
      closeVolumeFilterDropdown();
      return;
    }
    closeVolumeFilterDropdown();
    buildVolumeFilterDropdown(key, trigger);
  }

  function setupVolumeTableControls() {
    document.querySelectorAll('[data-nfe-volume-filter]').forEach((input) => {
      const key = input.dataset.nfeVolumeFilter;
      if (!key) return;
      volumeTableControls.filterInputs.set(key, input);
      input.addEventListener('input', (event) => {
        setVolumeFilter(key, event.target.value || '');
      });
    });
    document.querySelectorAll('[data-nfe-volume-sort]').forEach((button) => {
      const key = button.dataset.nfeVolumeSort;
      if (!key) return;
      const direction = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
      volumeTableControls.sortButtons.set(button, { key, direction });
      const header = button.closest('[data-nfe-volume-sort-header]');
      if (header && !volumeTableControls.sortHeaders.has(key)) {
        volumeTableControls.sortHeaders.set(key, header);
      }
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setVolumeSort(key, direction);
      });
    });
    document.querySelectorAll('[data-nfe-volume-filter-trigger]').forEach((button) => {
      const key = button.dataset.nfeVolumeFilterTrigger;
      if (!key) return;
      volumeTableControls.filterTriggers.set(key, button);
      updateVolumeFilterTriggerState(key);
      button.addEventListener('click', (event) => handleVolumeFilterTriggerClick(event, key));
    });
    updateVolumeSortButtons();
  }

  function renderRefTableHeader() {
    if (!refHead) return;
    const headerCells = REF_COLUMNS.map((column) => {
      const alignClass = column.align || 'text-left';
      return `
        <th class="px-3 py-2 ${alignClass}" data-nfe-ref-sort-header="${column.key}">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-1">
              <span class="whitespace-nowrap">${column.label}</span>
              <div class="flex flex-col items-center justify-center gap-px text-gray-400">
                <button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-ref-sort="${column.key}" data-sort-direction="asc" aria-label="Ordenar crescente por ${column.label}">
                  <i class="fas fa-sort-up text-[9px]"></i>
                </button>
                <button type="button" class="flex h-3 w-3 items-center justify-center rounded border border-transparent text-gray-400 transition hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-ref-sort="${column.key}" data-sort-direction="desc" aria-label="Ordenar decrescente por ${column.label}">
                  <i class="fas fa-sort-down text-[9px]"></i>
                </button>
              </div>
            </div>
            <div class="relative">
              <button type="button" class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30" data-nfe-ref-filter-trigger="${column.key}" aria-label="Abrir filtro de ${column.label}">
                <i class="fas fa-magnifying-glass"></i>
              </button>
              <input type="text" placeholder="Filtrar" class="w-full rounded border border-gray-200 bg-white pl-6 pr-2 py-1 text-[10px] font-medium text-gray-600 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${alignClass === 'text-right' ? 'text-right' : ''}" data-nfe-ref-filter="${column.key}">
            </div>
          </div>
        </th>
      `;
    }).join('');
    refHead.innerHTML = `<tr>${headerCells}</tr>`;
    if (refEmpty) refEmpty.setAttribute('colspan', String(REF_COLUMNS.length));
  }

  function setRefFilter(key, value) {
    if (!key) return;
    const nextValue = typeof value === 'string' ? value : '';
    if (refTableState.filters[key] === nextValue) return;
    refTableState.filters[key] = nextValue;
    applyRefFiltersAndSort();
  }

  function setRefSort(key, direction) {
    if (!key) return;
    const nextDirection = direction === 'desc' ? 'desc' : 'asc';
    if (refTableState.sort.key === key && refTableState.sort.direction === nextDirection) {
      refTableState.sort = { key: '', direction: 'asc' };
    } else {
      refTableState.sort = { key, direction: nextDirection };
    }
    updateRefSortButtons();
    applyRefFiltersAndSort();
  }

  function updateRefSortButtons() {
    const activeKey = refTableState.sort.key;
    const activeDirection = refTableState.sort.direction;
    refTableControls.sortHeaders.forEach((header, key) => {
      if (!header) return;
      if (activeKey && key === activeKey) {
        header.setAttribute('aria-sort', activeDirection === 'desc' ? 'descending' : 'ascending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });
    refTableControls.sortButtons.forEach((meta, button) => {
      if (!button) return;
      const isActive = meta.key === activeKey && meta.direction === activeDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/60', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updateRefFilterTriggerState(key) {
    const trigger = refTableControls.filterTriggers.get(key);
    if (!trigger) return;
    const hasSelection = refTableState.selections[key]?.size;
    trigger.classList.toggle('text-primary', !!hasSelection);
  }

  function closeRefFilterDropdown() {
    if (refTableControls.activeDropdown) {
      refTableControls.activeDropdown.remove();
      refTableControls.activeDropdown = null;
      refTableControls.activeKey = null;
    }
  }

  function getRefFieldValue(row, key) {
    if (!row) return '';
    const cell = row.querySelector(`[data-ref-cell="${key}"]`);
    return cell?.textContent || '';
  }

  function getRefCandidates(row, key) {
    return [getRefFieldValue(row, key)];
  }

  function matchesRefFilter(row, key, filterValue) {
    const regex = buildVolumeFilterRegex(filterValue);
    if (!regex) return true;
    const candidates = getRefCandidates(row, key);
    return candidates.some((candidate) => regex.test(normalizeItemText(candidate)));
  }

  function matchesRefSelection(row, key) {
    const selection = refTableState.selections?.[key];
    if (!selection || selection.size === 0) return true;
    const normalizedSelection = new Set(Array.from(selection).map((value) => normalizeItemText(value)));
    return getRefCandidates(row, key).some((candidate) => normalizedSelection.has(normalizeItemText(candidate)));
  }

  function applyRefFilters(rows) {
    const list = Array.from(rows || []);
    const activeFilters = Object.entries(refTableState.filters).filter(([, value]) => value.trim() !== '');
    const selectionKeys = Object.keys(refTableState.selections).filter((key) => refTableState.selections[key].size);
    if (!activeFilters.length && !selectionKeys.length) return list;
    return list.filter((row) =>
      activeFilters.every(([key, value]) => matchesRefFilter(row, key, value)) &&
      selectionKeys.every((key) => matchesRefSelection(row, key)),
    );
  }

  function getRefSortValue(row, key) {
    const value = getRefFieldValue(row, key);
    return normalizeItemText(value);
  }

  function applyRefSort(rows) {
    const list = Array.from(rows || []);
    const { key: sortKey, direction } = refTableState.sort;
    if (!sortKey) return list;
    const multiplier = direction === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const valueA = getRefSortValue(a, sortKey);
      const valueB = getRefSortValue(b, sortKey);
      const comparison = String(valueA).localeCompare(String(valueB), 'pt-BR', { sensitivity: 'base', numeric: true });
      if (comparison === 0) return Number(a.dataset.order || 0) - Number(b.dataset.order || 0);
      return comparison * multiplier;
    });
  }

  function applyRefFiltersAndSort() {
    if (!refBody) return;
    const rows = Array.from(refBody.querySelectorAll('tr[data-ref-row]'));
    if (!rows.length) return;
    rows.forEach((row) => {
      if (!row.dataset.order) row.dataset.order = String(refRowSequence++);
    });
    const filtered = applyRefFilters(rows);
    const sorted = applyRefSort(rows);
    const filteredSet = new Set(filtered);
    sorted.forEach((row) => {
      row.classList.toggle('hidden', !filteredSet.has(row));
      refBody.appendChild(row);
    });
  }

  function getRefUniqueValues(key) {
    const values = new Set();
    const rows = Array.from(refBody?.querySelectorAll('tr[data-ref-row]') || []);
    rows.forEach((row) => {
      getRefCandidates(row, key).forEach((candidate) => {
        const value = normalizeString(candidate);
        if (value) values.add(value);
      });
    });
    return Array.from(values).sort((a, b) =>
      normalizeItemText(a).localeCompare(normalizeItemText(b), 'pt-BR', { sensitivity: 'base', numeric: true }),
    );
  }

  function applyRefSelectionFilter(key, values, totalOptions = 0) {
    const selection = refTableState.selections[key];
    if (!selection) return;
    selection.clear();
    if (values.length && totalOptions && values.length >= totalOptions) {
      updateRefFilterTriggerState(key);
      applyRefFiltersAndSort();
      return;
    }
    values.forEach((value) => selection.add(value));
    updateRefFilterTriggerState(key);
    applyRefFiltersAndSort();
  }

  function buildRefFilterDropdown(key, anchor) {
    const existingSelection = refTableState.selections[key] || new Set();
    const values = getRefUniqueValues(key);
    const dropdown = document.createElement('div');
    dropdown.className = 'absolute z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg';
    dropdown.innerHTML = `
      <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Opcoes
        <button type="button" class="text-gray-400 hover:text-gray-600" data-ref-close>&times;</button>
      </div>
      <div class="max-h-56 overflow-y-auto px-3 py-2 text-xs text-gray-600" data-ref-options></div>
      <div class="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-[10px] text-gray-500">
        <button type="button" class="text-primary" data-ref-select-all>Selecionar tudo</button>
        <button type="button" class="text-gray-500" data-ref-clear>Limpar</button>
      </div>
    `;
    const optionsContainer = dropdown.querySelector('[data-ref-options]');
    const hasStoredSelection = existingSelection.size > 0;
    values.forEach((value) => {
      const item = document.createElement('label');
      item.className = 'flex items-center gap-2 py-1';
      const checked = hasStoredSelection ? existingSelection.has(value) : true;
      item.innerHTML = `
        <input type="checkbox" class="h-3 w-3 rounded border-gray-300 text-primary focus:ring-primary/30" value="${value}" ${checked ? 'checked' : ''}>
        <span class="flex-1 truncate">${value}</span>
      `;
      optionsContainer?.appendChild(item);
    });
    const updateSelection = () => {
      const selectedValues = Array.from(dropdown.querySelectorAll('input[type="checkbox"]'))
        .filter((input) => input.checked)
        .map((input) => input.value);
      applyRefSelectionFilter(key, selectedValues, values.length);
    };
    dropdown.addEventListener('change', updateSelection);
    dropdown.querySelector('[data-ref-close]')?.addEventListener('click', () => closeRefFilterDropdown());
    dropdown.querySelector('[data-ref-select-all]')?.addEventListener('click', () => {
      dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.checked = true;
      });
      updateSelection();
    });
    dropdown.querySelector('[data-ref-clear]')?.addEventListener('click', () => {
      dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.checked = false;
      });
      updateSelection();
    });
    anchor.parentElement?.appendChild(dropdown);
    refTableControls.activeDropdown = dropdown;
    refTableControls.activeKey = key;
  }

  function handleRefFilterTriggerClick(event, key) {
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (refTableControls.activeDropdown && refTableControls.activeKey === key) {
      closeRefFilterDropdown();
      return;
    }
    closeRefFilterDropdown();
    buildRefFilterDropdown(key, trigger);
  }

  function setupRefTableControls() {
    document.querySelectorAll('[data-nfe-ref-filter]').forEach((input) => {
      const key = input.dataset.nfeRefFilter;
      if (!key) return;
      refTableControls.filterInputs.set(key, input);
      input.addEventListener('input', (event) => {
        setRefFilter(key, event.target.value || '');
      });
    });
    document.querySelectorAll('[data-nfe-ref-sort]').forEach((button) => {
      const key = button.dataset.nfeRefSort;
      if (!key) return;
      const direction = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
      refTableControls.sortButtons.set(button, { key, direction });
      const header = button.closest('[data-nfe-ref-sort-header]');
      if (header && !refTableControls.sortHeaders.has(key)) {
        refTableControls.sortHeaders.set(key, header);
      }
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setRefSort(key, direction);
      });
    });
    document.querySelectorAll('[data-nfe-ref-filter-trigger]').forEach((button) => {
      const key = button.dataset.nfeRefFilterTrigger;
      if (!key) return;
      refTableControls.filterTriggers.set(key, button);
      updateRefFilterTriggerState(key);
      button.addEventListener('click', (event) => handleRefFilterTriggerClick(event, key));
    });
    updateRefSortButtons();
  }

  function addRefRow(prefill = {}) {
    if (!refBody) return;
    if (refEmpty) refEmpty.remove();
    const row = document.createElement('tr');
    row.dataset.refRow = 'true';
    row.dataset.order = String(refRowSequence++);
    const cells = REF_COLUMNS.map((column) => {
      const value = prefill[column.key] || '';
      return `<td class="px-3 py-2" data-ref-cell="${column.key}">${value}</td>`;
    }).join('');
    row.innerHTML = cells;
    refBody.appendChild(row);
    applyRefFiltersAndSort();
  }

  function addVolumeRow(prefill = {}) {
    if (!volumesBody) return;
    if (volumesEmpty) volumesEmpty.remove();
    const row = document.createElement('tr');
    row.dataset.volumeRow = 'true';
    row.dataset.order = String(volumeRowSequence++);
    const cells = VOLUME_COLUMNS.map((column) => {
      const alignClass = column.align ? ` ${column.align}` : '';
      const value = prefill[column.key] || '';
      return `
        <td class="px-3 py-2${alignClass}" data-volume-cell="${column.key}">${value}</td>
      `;
    }).join('');
    row.innerHTML = cells;
    volumesBody.appendChild(row);
    applyVolumeFiltersAndSort();
  }

  function resetVolumeFields() {
    if (!volumeFields.identificacao) return;
    Object.entries(volumeFields).forEach(([key, field]) => {
      if (!field || key === 'add' || key === 'reset') return;
      if (field.tagName === 'INPUT') {
        field.value = '';
      }
    });
    if (volumeFields.quantidade) volumeFields.quantidade.value = '0';
    if (volumeFields.pesoBruto) volumeFields.pesoBruto.value = '0,000';
    if (volumeFields.pesoLiquido) volumeFields.pesoLiquido.value = '0,000';
    if (volumeFields.cubagem) volumeFields.cubagem.value = '0,000';
  }

  function openProductModal() {
    if (!productModal) return;
    productModal.classList.remove('hidden');
    productModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
    populateUnitOptions();
    ensureCestOptions();
    syncModalCfopOptionsFromNatureza();
    modalProductSnapshot = null;
    modalProductFiscalSnapshot = null;
    getIcmsSimplesDataForCompany().then(() => applyFiscalRules());
    setProductModalTab('icms');
    updateProductModalTotals();
    productModalFields.product?.focus();
  }

  function setDadosTab(tabKey) {
    const buttons = Array.from(document.querySelectorAll('[data-nfe-dados-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-nfe-dados-panel]'));
    buttons.forEach((button) => {
      const isActive = button.dataset.nfeDadosTab === tabKey;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('text-gray-600', !isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.nfeDadosPanel !== tabKey);
    });
  }

  function closeProductModal() {
    if (!productModal) return;
    productModal.classList.add('hidden');
    productModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('overflow-hidden');
  }

  function setModalInputValue(input, value) {
    if (!input) return;
    input.value = value;
  }

  function updateProductModalTotals(source) {
    if (!productModal) return;
    const qty = parseNumber(productModalFields.qty?.value);
    const unit = parseNumber(productModalFields.unit?.value);
    const subtotal = qty * unit;
    let discountPercent = parseNumber(productModalFields.discountPercent?.value);
    let discountValue = parseNumber(productModalFields.discountValue?.value);

    if (source === 'percent') {
      discountValue = subtotal * (discountPercent / 100);
      setModalInputValue(productModalFields.discountValue, formatInputValue(discountValue));
    } else if (source === 'value') {
      discountPercent = subtotal ? (discountValue / subtotal) * 100 : 0;
      setModalInputValue(productModalFields.discountPercent, formatRateValue(discountPercent.toFixed(2)));
    }

    const otherExpenses = parseNumber(productModalFields.otherExpenses?.value);
    const total = Math.max(0, subtotal - discountValue + otherExpenses);
    setModalInputValue(productModalFields.subtotal, formatInputValue(subtotal));
    setModalInputValue(productModalFields.total, formatInputValue(total));
    applyFiscalRules();
  }

  function populateUnitOptions() {
    const selects = [productModalFields.unidadeComercial, productModalFields.unidadeTributavel];
    selects.forEach((select) => {
      if (!select) return;
      if (select.options.length > 1) return;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '--SELECIONE--';
      select.appendChild(placeholder);
      UNIT_OPTIONS.forEach((unit) => {
        const option = document.createElement('option');
        option.value = unit.value;
        option.textContent = unit.label;
        select.appendChild(option);
      });
    });
  }

  function setModalFieldValueById(id, value) {
    const field = document.getElementById(id);
    if (!field) return;
    field.value = value;
  }

  function fillProductModal(prefill = {}, product = {}) {
    populateUnitOptions();
    modalProductSnapshot = product && typeof product === 'object' ? product : null;
    modalProductFiscalSnapshot = resolveProductFiscal(product);
    setModalInputValue(productModalFields.product, prefill.name || '');
    setModalInputValue(productModalFields.qty, prefill.qty || '1');
    setModalInputValue(productModalFields.unit, prefill.unit || '0,00');
    setModalInputValue(productModalFields.discountValue, prefill.discount || '0,00');
    setModalInputValue(productModalFields.otherExpenses, prefill.otherExpenses || '0,00');
    setModalInputValue(productModalFields.qtyTrib, prefill.qtyTrib || prefill.qty || '1');
    setModalInputValue(productModalFields.unitTrib, prefill.unitTrib || prefill.unit || '0,00');
    setModalInputValue(productModalFields.ncm, prefill.ncm || '');
    setModalInputValue(productModalFields.cfop, prefill.cfop || '');
    const cestValue = prefill.cest || product?.cest || '';
    if (productModalFields.cest) {
      ensureCestOptions();
      if (cestValue && !cestOptionsCache.values.includes(cestValue)) {
        cestOptionsCache.values = Array.from(new Set([...cestOptionsCache.values, cestValue]));
        populateCestSelectOptions(cestValue);
      }
      productModalFields.cest.value = cestValue;
    }
    setModalInputValue(productModalFields.peso, prefill.peso || formatInputValue(product?.peso || 0));
    setModalInputValue(productModalFields.codigoBeneficioFiscal, prefill.codigoBeneficioFiscal || '');
    setModalInputValue(productModalFields.numeroPedido, prefill.numeroPedido || '');
    setModalInputValue(productModalFields.numeroItemPedido, prefill.numeroItemPedido || '');
    if (productModalFields.unidadeComercial) {
      productModalFields.unidadeComercial.value = prefill.unidadeComercial || '';
    }
    if (productModalFields.unidadeTributavel) {
      productModalFields.unidadeTributavel.value = prefill.unidadeTributavel || '';
    }

    setModalFieldValueById('nfe-modal-icms-cst', normalizeCstValue(prefill.cst || ''));
    setModalFieldValueById('nfe-modal-icms-base-percent', prefill.icmsBasePercent || '100');
    setModalFieldValueById('nfe-modal-icms-base-value', prefill.icmsBaseValue || '0,00');
    setModalFieldValueById('nfe-modal-icms-aliq', prefill.icms || '0');
    setModalFieldValueById('nfe-modal-ipi-st', normalizeCstValue(prefill.ipiCst || ''));
    setModalFieldValueById('nfe-modal-ipi-aliq', prefill.ipi || '0');
    setModalFieldValueById('nfe-modal-ipi-enquadramento', prefill.ipiEnq || '');
    setModalFieldValueById('nfe-modal-pis-st', normalizeCstValue(prefill.pisCst || ''));
    setModalFieldValueById('nfe-modal-pis-aliq', prefill.pis || '0');
    setModalFieldValueById('nfe-modal-cofins-st', normalizeCstValue(prefill.cofinsCst || ''));
    setModalFieldValueById('nfe-modal-cofins-aliq', prefill.cofins || '0');

    updateProductModalTotals();
    applyFiscalRules();
  }

  async function fillProductModalByCode(rawCode) {
    const trimmed = normalizeString(rawCode);
    if (!trimmed) return;
    if (productModalFields.product) {
      productModalFields.product.disabled = true;
    }
    try {
      const product = await fetchProductByCode(trimmed);
      if (!product) {
        if (typeof showToast === 'function') {
          showToast('Produto nao encontrado para o codigo informado.', 'warning');
        }
        return;
      }
      modalProductSnapshot = product;
      const icmsSimplesData = await getIcmsSimplesDataForCompany();
      const prefill = buildProductPrefill(product);
      applyIcmsSimplesBase(prefill, product, icmsSimplesData);
      fillProductModal(prefill, product);
    } catch (error) {
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao buscar produto.', 'error');
      }
    } finally {
      if (productModalFields.product) {
        productModalFields.product.disabled = false;
      }
    }
  }

  function setProductModalTab(tabKey) {
    if (!productModal) return;
    const buttons = Array.from(productModal.querySelectorAll('[data-nfe-modal-tab]'));
    const panels = Array.from(productModal.querySelectorAll('[data-nfe-modal-panel]'));
    buttons.forEach((button) => {
      const isActive = button.dataset.nfeModalTab === tabKey;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      const isActive = panel.dataset.nfeModalPanel === tabKey;
      panel.classList.toggle('hidden', !isActive);
    });
  }

  function setItemFilter(key, value) {
    if (!key) return;
    const nextValue = typeof value === 'string' ? value : '';
    if (itemTableState.filters[key] === nextValue) return;
    itemTableState.filters[key] = nextValue;
    applyItemFiltersAndSort();
  }

  function setItemSort(key, direction) {
    if (!key) return;
    const nextDirection = direction === 'desc' ? 'desc' : 'asc';
    if (itemTableState.sort.key === key && itemTableState.sort.direction === nextDirection) {
      itemTableState.sort = { key: '', direction: 'asc' };
    } else {
      itemTableState.sort = { key, direction: nextDirection };
    }
    updateItemSortButtons();
    applyItemFiltersAndSort();
  }

  function updateItemSortButtons() {
    const activeKey = itemTableState.sort.key;
    const activeDirection = itemTableState.sort.direction;
    itemTableControls.sortHeaders.forEach((header, key) => {
      if (!header) return;
      if (activeKey && key === activeKey) {
        header.setAttribute('aria-sort', activeDirection === 'desc' ? 'descending' : 'ascending');
      } else {
        header.removeAttribute('aria-sort');
      }
    });
    itemTableControls.sortButtons.forEach((meta, button) => {
      if (!button) return;
      const isActive = meta.key === activeKey && meta.direction === activeDirection;
      button.classList.toggle('text-primary', isActive);
      button.classList.toggle('border-primary/60', isActive);
      button.classList.toggle('bg-primary/10', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updateItemFilterTriggerState(key) {
    const trigger = itemTableControls.filterTriggers.get(key);
    if (!trigger) return;
    const hasSelection = itemTableState.selections[key]?.size;
    trigger.classList.toggle('text-primary', !!hasSelection);
  }

  function closeItemFilterDropdown() {
    if (itemTableControls.activeDropdown) {
      itemTableControls.activeDropdown.remove();
      itemTableControls.activeDropdown = null;
      itemTableControls.activeKey = null;
    }
  }

  function getItemUniqueValues(key) {
    const values = new Set();
    const rows = Array.from(itemsBody?.querySelectorAll('tr[data-item-row]') || []);
    rows.forEach((row) => {
      getItemCandidates(row, key).forEach((candidate) => {
        const value = normalizeString(candidate);
        if (value) values.add(value);
      });
    });
    return Array.from(values).sort((a, b) =>
      normalizeItemText(a).localeCompare(normalizeItemText(b), 'pt-BR', { sensitivity: 'base', numeric: true }),
    );
  }

  function applyItemSelectionFilter(key, values, totalOptions = 0) {
    const selection = itemTableState.selections[key];
    if (!selection) return;
    selection.clear();
    if (values.length && totalOptions && values.length >= totalOptions) {
      updateItemFilterTriggerState(key);
      applyItemFiltersAndSort();
      return;
    }
    values.forEach((value) => selection.add(value));
    updateItemFilterTriggerState(key);
    applyItemFiltersAndSort();
  }

  function buildItemFilterDropdown(key, anchor) {
    const existingSelection = itemTableState.selections[key] || new Set();
    const options = getItemUniqueValues(key);
    const hasStoredSelection = existingSelection.size > 0;

    const dropdown = document.createElement('div');
    dropdown.className =
      'absolute z-50 mt-1 w-60 rounded-lg border border-gray-200 bg-white shadow-xl p-2 text-xs text-gray-600';
    dropdown.innerHTML = `
      <div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-gray-500 uppercase">
        <span>Opcoes</span>
        <button type="button" class="text-gray-400 hover:text-primary" data-action="close" aria-label="Fechar">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="max-h-40 overflow-y-auto px-2 py-1 space-y-1" data-options></div>
      <div class="flex items-center justify-between gap-2 px-2 pt-2">
        <button type="button" class="text-[11px] text-gray-500 hover:text-primary" data-action="select-all">Selecionar tudo</button>
        <button type="button" class="text-[11px] text-gray-500 hover:text-primary" data-action="clear">Limpar</button>
        <button type="button" class="ml-auto rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90" data-action="apply">Aplicar</button>
      </div>
    `;

    const optionsWrapper = dropdown.querySelector('[data-options]');
    options.forEach((value) => {
      const checked = hasStoredSelection ? existingSelection.has(value) : true;
      const optionRow = document.createElement('label');
      optionRow.className = 'flex items-center gap-2 text-[11px] text-gray-600';
      optionRow.innerHTML = `
        <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary/20" value="${value.replace(/\"/g, '&quot;')}" ${
          checked ? 'checked' : ''
        }>
        <span class="truncate">${value}</span>
      `;
      optionsWrapper.appendChild(optionRow);
    });

    dropdown.addEventListener('click', (event) => {
      event.stopPropagation();
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'close') {
        closeItemFilterDropdown();
        return;
      }
      if (action === 'select-all') {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = true;
        });
        return;
      }
      if (action === 'clear') {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = false;
        });
        return;
      }
      if (action === 'apply') {
        const values = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked')).map((input) =>
          normalizeString(input.value),
        );
        applyItemSelectionFilter(key, values, options.length);
        closeItemFilterDropdown();
      }
    });

    anchor.appendChild(dropdown);
    return dropdown;
  }

  function handleItemFilterTriggerClick(event, key) {
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget.closest('.relative');
    if (!anchor) return;
    if (itemTableControls.activeKey === key) {
      closeItemFilterDropdown();
      return;
    }
    closeItemFilterDropdown();
    itemTableControls.activeKey = key;
    itemTableControls.activeDropdown = buildItemFilterDropdown(key, anchor);
  }

  function setupItemTableControls() {
    document.querySelectorAll('[data-nfe-item-filter]').forEach((input) => {
      const key = input.dataset.nfeItemFilter;
      if (!key) return;
      itemTableControls.filterInputs.set(key, input);
      input.addEventListener('input', (event) => {
        setItemFilter(key, event.target.value || '');
      });
    });

    document.querySelectorAll('[data-nfe-item-sort]').forEach((button) => {
      const key = button.dataset.nfeItemSort;
      if (!key) return;
      const direction = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
      itemTableControls.sortButtons.set(button, { key, direction });
      const header = button.closest('[data-nfe-item-sort-header]');
      if (header && !itemTableControls.sortHeaders.has(key)) {
        itemTableControls.sortHeaders.set(key, header);
      }
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setItemSort(key, direction);
      });
    });

      document.querySelectorAll('[data-nfe-item-filter-trigger]').forEach((button) => {
        const key = button.dataset.nfeItemFilterTrigger;
        if (!key) return;
        itemTableControls.filterTriggers.set(key, button);
        updateItemFilterTriggerState(key);
        button.addEventListener('click', (event) => handleItemFilterTriggerClick(event, key));
      });

      document.querySelectorAll('[data-nfe-item-resize]').forEach((handle) => {
        handle.addEventListener('mousedown', (event) => {
          event.preventDefault();
          const headCell = event.target.closest('[data-nfe-item-col-index]');
          if (!headCell) return;
          const colIndex = Number(headCell.dataset.nfeItemColIndex);
          if (Number.isNaN(colIndex)) return;
          const startX = event.clientX;
          const startWidth = headCell.getBoundingClientRect().width;
          const minWidth = 80;
          const onMouseMove = (moveEvent) => {
            const nextWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
            applyItemColumnWidth(colIndex, nextWidth);
          };
          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        });
      });

      updateItemSortButtons();
    }

  function hasLetters(value) {
    return /[A-Za-z]/.test(String(value || ''));
  }

  function matchCode(inputCode, candidateCode) {
    const normalizedInput = normalizeDigits(inputCode);
    const normalizedCandidate = normalizeDigits(candidateCode);
    if (!normalizedInput || !normalizedCandidate) return false;
    if (normalizedInput === normalizedCandidate) return true;
    const trimInput = normalizedInput.replace(/^0+/, '') || '0';
    const trimCandidate = normalizedCandidate.replace(/^0+/, '') || '0';
    return trimInput === trimCandidate;
  }

  function getPartyType() {
    return partyTypeSelect?.value === PARTY_TYPES.supplier ? PARTY_TYPES.supplier : PARTY_TYPES.client;
  }

  function getAuthHeaders() {
    const token = typeof getToken === 'function' ? getToken() : '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function parseNumber(raw) {
    if (typeof raw === 'number') return raw;
    const value = String(raw || '').trim();
    if (!value) return 0;
    const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const masks = new WeakMap();

  function applyMask(element, options) {
    if (typeof IMask === 'undefined' || !element) return null;
    const existing = masks.get(element);
    if (existing && typeof existing.destroy === 'function') {
      existing.destroy();
    }
    const mask = IMask(element, { ...options });
    masks.set(element, mask);
    return mask;
  }

  function createNumberMask(scale) {
    return {
      mask: Number,
      scale,
      signed: false,
      thousandsSeparator: '.',
      radix: ',',
      mapToRadix: ['.'],
      padFractionalZeros: true,
      normalizeZeros: true,
    };
  }

  function createPhoneMaskOptions() {
    return {
      mask: [
        { mask: '(00) 0000-0000' },
        { mask: '(00) 00000-0000' },
      ],
      dispatch(appended, dynamicMasked) {
        const number = (dynamicMasked.unmaskedValue + appended).replace(/\D+/g, '');
        return dynamicMasked.compiledMasks[number.length > 10 ? 1 : 0];
      },
    };
  }

  function getInputValue(input) {
    if (!input) return '';
    return String(input.value || '').trim();
  }

  function getCellText(node) {
    if (!node) return '';
    return String(node.textContent || '').trim();
  }

  function collectItemRows() {
    if (!itemsBody) return [];
    const rows = Array.from(itemsBody.querySelectorAll('tr[data-item-row]'));
    return rows.map((row) => {
      const item = {};
      ITEM_COLUMNS.forEach((column) => {
        item[column.key] = getItemFieldValue(row, column.key);
      });
      const productId = normalizeString(row.dataset.productId || '');
      if (productId) item.productId = productId;
      const productCode = normalizeString(row.dataset.productCode || '');
      if (productCode) item.productCode = productCode;
      const productBarcode = normalizeString(row.dataset.productBarcode || '');
      if (productBarcode) item.productBarcode = productBarcode;
      return item;
    });
  }

  function collectVolumeRows() {
    if (!volumesBody) return [];
    const rows = Array.from(volumesBody.querySelectorAll('tr[data-volume-row]'));
    return rows.map((row) => {
      const record = {};
      VOLUME_COLUMNS.forEach((column) => {
        const cell = row.querySelector(`[data-volume-cell="${column.key}"]`);
        record[column.key] = getCellText(cell);
      });
      return record;
    });
  }

  function collectRefRows() {
    if (!refBody) return [];
    const rows = Array.from(refBody.querySelectorAll('tr[data-ref-row]'));
    return rows.map((row) => {
      const record = {};
      REF_COLUMNS.forEach((column) => {
        const cell = row.querySelector(`[data-ref-cell="${column.key}"]`);
        record[column.key] = getCellText(cell);
      });
      return record;
    });
  }

  function collectCrediarioRows() {
    if (!crediarioFields.table) return [];
    const rows = Array.from(crediarioFields.table.querySelectorAll('tr[data-crediario-row]'));
    return rows.map((row, index) => {
      const inputs = Array.from(row.querySelectorAll('input'));
      return {
        index: index + 1,
        due: getInputValue(inputs[0]),
        value: getInputValue(inputs[1]),
      };
    });
  }

  function collectChequeRows() {
    if (!chequeFields.table) return [];
    const rows = Array.from(chequeFields.table.querySelectorAll('tr[data-cheque-row]'));
    return rows.map((row) => {
      const inputs = Array.from(row.querySelectorAll('input'));
      const selects = Array.from(row.querySelectorAll('select'));
      return {
        date: getInputValue(inputs[0]),
        value: getInputValue(inputs[1]),
        bank: getInputValue(inputs[2]),
        account: getInputValue(inputs[3]),
        agency: getInputValue(inputs[4]),
        number: getInputValue(inputs[5]),
        client: getInputValue(inputs[6]),
        holder: getInputValue(inputs[7]),
        holderType: getInputValue(selects[0]),
        cpf: getInputValue(inputs[8]),
        phone: getInputValue(inputs[9]),
        address: getInputValue(inputs[10]),
      };
    });
  }

  function collectCardRows() {
    if (!cardFields.table) return [];
    const rows = Array.from(cardFields.table.querySelectorAll('tr[data-card-row]'));
    return rows.map((row) => {
      const inputs = Array.from(row.querySelectorAll('input'));
      return {
        method: getInputValue(inputs[0]),
        value: getInputValue(inputs[1]),
      };
    });
  }

  function collectCashRows() {
    if (!cashFields.table) return [];
    const rows = Array.from(cashFields.table.querySelectorAll('tr[data-cash-row]'));
    return rows.map((row) => {
      const input = row.querySelector('input');
      return { value: getInputValue(input) };
    });
  }

  function collectPixRows() {
    if (!pixFields.table) return [];
    const rows = Array.from(pixFields.table.querySelectorAll('tr[data-pix-row]'));
    return rows.map((row) => {
      const input = row.querySelector('input');
      return { value: getInputValue(input) };
    });
  }

  function collectOtherRows() {
    if (!otherFields.table) return [];
    const rows = Array.from(otherFields.table.querySelectorAll('tr[data-other-row]'));
    return rows.map((row) => {
      const inputs = Array.from(row.querySelectorAll('input'));
      return {
        method: getInputValue(inputs[0]),
        value: getInputValue(inputs[1]),
      };
    });
  }

  function buildClientAddressText() {
    const parts = [
      getInputValue(clientFields.address),
      getInputValue(clientFields.number),
      getInputValue(clientFields.complement),
      getInputValue(clientFields.neighborhood),
      getInputValue(clientFields.city),
      getInputValue(clientFields.state),
      getInputValue(clientFields.zip),
      getInputValue(clientFields.country),
    ].filter(Boolean);
    return parts.join(' - ');
  }

  let selectedPartyIsentoIE = false;

  async function buildDraftPayload() {
    const companyId = await resolvePaymentCompanyId();
    const depositId = await resolveDepositCompanyId();
    const header = {
      code: getInputValue(codeInput),
      number: getInputValue(numberInput),
      serie: getInputValue(serieFields.select),
      type: getInputValue(operationSelect),
      model: getInputValue(serieFields.model),
      issueDate: getInputValue(issueDateInput),
      entryDate: getInputValue(exitDateInput),
    };

    const totalsRecord = {
      products: parseNumber(totals.products?.textContent),
      icmsBase: parseNumber(totals.baseIcms?.textContent),
      icmsValue: parseNumber(totals.icms?.textContent),
      icmsSt: 0,
      fcpSt: 0,
      discount: parseNumber(totals.discounts?.textContent),
      other: parseNumber(extraInputs.outros?.value),
      freight: parseNumber(extraInputs.frete?.value),
      ipi: parseNumber(totals.ipi?.textContent),
      insurance: 0,
      dollar: 0,
      totalValue: parseNumber(totals.note?.textContent),
    };

    const ieInputValue = getInputValue(clientFields.ie);
    const ieIsento = /^isento$/i.test(ieInputValue.trim());
    const supplierRecord = {
      name: getInputValue(clientFields.name),
      document: getInputValue(clientFields.doc),
      stateRegistration: ieInputValue,
      isentoIE: selectedPartyIsentoIE || ieIsento,
      email: '',
      addressText: buildClientAddressText(),
      address: getInputValue(clientFields.address),
      number: getInputValue(clientFields.number),
      complement: getInputValue(clientFields.complement),
      neighborhood: getInputValue(clientFields.neighborhood),
      city: getInputValue(clientFields.city),
      state: getInputValue(clientFields.state),
      zip: normalizeDigits(getInputValue(clientFields.zip)),
      country: getInputValue(clientFields.country),
    };

    const transporter = {
      name: getInputValue(document.getElementById('nfe-transportadora-nome')),
      document: getInputValue(document.getElementById('nfe-transportadora-cnpj')),
      city: getInputValue(document.getElementById('nfe-transportadora-municipio')),
      stateRegistration: getInputValue(document.getElementById('nfe-transportadora-ie')),
      address: getInputValue(document.getElementById('nfe-transportadora-endereco')),
      number: getInputValue(document.getElementById('nfe-transportadora-numero')),
      uf: getInputValue(document.getElementById('nfe-transportadora-uf')),
    };

    const vehicle = {
      plate: getInputValue(document.getElementById('nfe-transportadora-placa')),
      uf: getInputValue(document.getElementById('nfe-transportadora-uf-placa')),
    };

    const volumes = collectVolumeRows();
    const volumeSummary = {
      identificacao: getInputValue(volumeFields.identificacao),
      especie: getInputValue(volumeFields.especie),
      marca: getInputValue(volumeFields.marca),
      quantidade: getInputValue(volumeFields.quantidade),
      pesoBruto: getInputValue(volumeFields.pesoBruto),
      pesoLiquido: getInputValue(volumeFields.pesoLiquido),
      cubagem: getInputValue(volumeFields.cubagem),
    };

    const crediarioRows = collectCrediarioRows();
    const crediarioTypeValue = getInputValue(crediarioFields.type);
    const crediarioTypeLabel =
      crediarioFields.type?.selectedOptions?.[0]?.textContent?.trim() || '';
    const crediarioBankAccount = getInputValue(crediarioFields.bankAccount);
    const crediarioAccountingAccount = getInputValue(crediarioFields.accountingAccount);

    const payments = {
      delivery: Boolean(paymentDeliveryInput?.checked),
      totalValue: getInputValue(extraInputs.paymentValue),
      crediario: crediarioRows,
      cheque: collectChequeRows(),
      card: collectCardRows(),
      cash: collectCashRows(),
      pix: collectPixRows(),
      other: collectOtherRows(),
    };

    return {
      header,
      company: { id: companyId },
      supplier: supplierRecord,
      totals: totalsRecord,
      items: collectItemRows(),
      references: collectRefRows(),
      duplicates: crediarioRows.map((row) => ({
        number: row.index,
        dueDate: row.due,
        value: row.value,
        paymentType: 'crediario',
        paymentMethod: crediarioTypeValue,
        paymentDescription: crediarioTypeLabel,
        bankAccount: crediarioBankAccount,
        accountingAccountId: crediarioAccountingAccount,
      })),
      payments,
      selection: {
        companyId,
        depositId,
        bankAccountId: crediarioBankAccount,
        accountingAccount: crediarioAccountingAccount,
        duplicataEmissionDate: getInputValue(crediarioFields.due),
      },
      transport: {
        mode: getInputValue(freightModeSelect),
        transporter,
        vehicle,
        volume: volumeSummary,
        volumes,
      },
      additionalInfo: {
        observation: getInputValue(infoFields.contribuinte),
        complementaryFiscal: getInputValue(infoFields.fisco),
        paymentCondition: '',
        paymentForm: '',
      },
      metadata: {
        partyType: getPartyType(),
        finalidade: getInputValue(finalidadeSelect),
        natureza: getInputValue(naturezaSelect),
        naturezaOperacao: getInputValue(naturezaOperacaoSelect),
        serviceType: getInputValue(serviceTypeSelect),
        stockMovement: getInputValue(stockMovementSelect),
        stockDeposit: getInputValue(stockDepositSelect),
        infoContribuinteAuto: getInputValue(infoFields.contribuinteAuto),
        infoMicrochip: getInputValue(infoFields.microchip),
        emitente: {
          razao: getInputValue(emitenteFields.razao),
          fantasia: getInputValue(emitenteFields.fantasia),
          cnpj: getInputValue(emitenteFields.cnpj),
          ie: getInputValue(emitenteFields.ie),
          regime: getInputValue(emitenteFields.regime),
          endereco: getInputValue(emitenteFields.endereco),
        },
      },
    };
  }

  async function saveDraft() {
    const isNewDraft = !currentDraftId;
    const payload = await buildDraftPayload();
    const endpoint = currentDraftId
      ? `${API_BASE}/nfe/drafts/${currentDraftId}`
      : `${API_BASE}/nfe/drafts`;
    const method = currentDraftId ? 'PUT' : 'POST';
    const headers = {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    };
    const response = await fetch(endpoint, {
      method,
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload?.message || 'Nao foi possivel gravar a NF-e.');
    }
    const data = await response.json().catch(() => ({}));
    const draft = data?.draft || data || {};
    currentDraftMetadata = draft?.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
    currentDraftXmlAmbient = normalizeString(draft?.xml?.ambient || payload?.xml?.ambient || '');
    nfeEventEntries = normalizeNfeEventList(currentDraftMetadata?.events);
    const draftId = draft._id || draft.id || '';
    if (draftId) {
      currentDraftId = String(draftId);
    }
    const draftCode = Number.isFinite(draft.code) ? draft.code : draft?.code;
    if (codeInput && draftCode) {
      codeInput.value = String(draftCode);
      currentDraftCode = String(draftCode);
    } else if (codeInput && draft?.header?.code) {
      codeInput.value = String(draft.header.code);
      currentDraftCode = String(draft.header.code);
    }
    const serieId = draft?.header?.serie || payload?.header?.serie || '';
    const savedNumber = draft?.header?.number || payload?.header?.number || '';
    if (isNewDraft && serieId && savedNumber && Array.isArray(fiscalSeries)) {
      const serie = fiscalSeries.find((entry) => String(entry?._id || entry?.id || '') === String(serieId));
      if (serie) {
        const companyId = await resolvePaymentCompanyId();
        const parametros = Array.isArray(serie.parametros) ? serie.parametros : [];
        const param = companyId
          ? parametros.find((item) => resolveSerieParamCompanyId(item) === String(companyId))
          : parametros[0];
        if (param) {
          param.ultimaNotaEmitida = String(savedNumber);
        } else if (companyId) {
          parametros.push({ empresa: companyId, ultimaNotaEmitida: String(savedNumber) });
          serie.parametros = parametros;
        }
      }
    }
    setStatus('draft');
    addHistory('Rascunho gravado no sistema.');
  }

  function formatMoney(value) {
    return MONEY_FORMAT.format(Number.isFinite(value) ? value : 0);
  }

  function formatMoneyInput(input) {
    if (!input) return;
    const value = parseNumber(input.value);
    input.value = value.toFixed(2).replace('.', ',');
  }

  function setStatus(statusKey, { log = true } = {}) {
    const config = STATUS_CONFIG[statusKey] || STATUS_CONFIG.draft;
    currentStatus = statusKey in STATUS_CONFIG ? statusKey : 'draft';
    if (!statusBadge) return;

    statusBadge.dataset.status = currentStatus;
    statusBadge.innerHTML = `<i class="fas fa-circle text-[7px]"></i> ${config.label}`;

    const resetClasses = Object.values(STATUS_CONFIG)
      .flatMap((entry) => entry.classes)
      .filter(Boolean);

    statusBadge.classList.remove(...resetClasses);
    statusBadge.classList.add(...config.classes);

    if (log) {
      addHistory(`Status atualizado para ${config.label}.`);
    }

    if (currentStatus === 'authorized') {
      ensureLocalAuthorizationEvent();
    }

    updateActionAvailability();
  }

  function updateActionAvailability() {
    const config = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.draft;
    Object.entries(actionButtons).forEach(([key, button]) => {
      if (!button) return;
      const allowed = !!config.actions[key];
      button.disabled = !allowed || button.dataset.loading === 'true';
      button.classList.toggle('opacity-50', !allowed);
      button.classList.toggle('cursor-not-allowed', !allowed);
    });
    if (actionButtons.manage) {
      const hasDraft = Boolean(currentDraftId || currentDraftCode);
      actionButtons.manage.disabled = !hasDraft;
      actionButtons.manage.classList.toggle('opacity-50', !hasDraft);
      actionButtons.manage.classList.toggle('cursor-not-allowed', !hasDraft);
    }
  }

  function setLoading(button, isLoading, label) {
    if (!button) return;
    if (isLoading) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }
      button.dataset.wasDisabled = button.disabled ? 'true' : 'false';
      button.dataset.loading = 'true';
      button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label || 'Processando...'}`;
      button.disabled = true;
    } else {
      button.dataset.loading = 'false';
      const original = button.dataset.originalHtml || button.innerHTML;
      button.innerHTML = original;
      button.disabled = button.dataset.wasDisabled === 'true';
    }
  }

  async function withLoading(button, handler, label) {
    if (!button) return;
    if (button.dataset.loading === 'true') return;
    setLoading(button, true, label);
    try {
      await handler();
    } finally {
      setLoading(button, false);
      updateActionAvailability();
    }
  }

  function addHistory(message) {
    if (!historyList) return;
    const now = new Date();
    const time = now.toLocaleString('pt-BR');
    if (historyList.querySelector('li')?.textContent?.includes('Nenhuma a\u00e7\u00e3o')) {
      historyList.innerHTML = '';
    }
    const item = document.createElement('li');
    item.textContent = `${time} - ${message}`;
    historyList.prepend(item);
  }

  function resetHistoryList() {
    if (!historyList) return;
    historyList.innerHTML = '<li>Nenhuma a\u00e7\u00e3o registrada.</li>';
  }

  function renderHistoryFromMetadata(metadata = {}) {
    if (!historyList) return;
    const logs = Array.isArray(metadata.logs) ? metadata.logs : [];
    if (!logs.length) {
      const lastStatus = metadata.lastStatus;
      const lastAt = metadata.lastStatusAt;
      if (lastStatus) {
        const date = lastAt ? new Date(lastAt) : new Date();
        const time = Number.isNaN(date.getTime()) ? new Date().toLocaleString('pt-BR') : date.toLocaleString('pt-BR');
        historyList.innerHTML = `<li>${time} - ${lastStatus}</li>`;
      } else {
        resetHistoryList();
      }
      return;
    }
    const sorted = logs
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a?.at || '');
        const bTime = Date.parse(b?.at || '');
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      });
    historyList.innerHTML = sorted
      .map((entry) => {
        const date = entry?.at ? new Date(entry.at) : new Date();
        const time = Number.isNaN(date.getTime()) ? new Date().toLocaleString('pt-BR') : date.toLocaleString('pt-BR');
        const message = entry?.message || '';
        return `<li>${time} - ${message}</li>`;
      })
      .join('');
  }

  function normalizeNfeEventName(value) {
    const normalized = normalizeKeyword(value);
    if (normalized === 'cancelamento') return 'Cancelamento';
    if (normalized === 'carta de correcao' || normalized === 'carta_correcao') return 'Carta de Correcao';
    if (
      normalized === 'autorizado o uso da nf-e' ||
      normalized === 'autorizado o uso da nfe' ||
      normalized === 'autorizacao'
    ) {
      return 'Autorizado o Uso da NF-e';
    }
    return '';
  }

  function isCurrentDraftHomologation() {
    const ambient = normalizeKeyword(currentDraftXmlAmbient);
    return ambient === '2' || ambient === 'homologacao';
  }

  function formatNfeEventDate(value) {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString('pt-BR');
  }

  function normalizeNfeEventList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((entry) => {
        const eventName = normalizeNfeEventName(entry?.event || entry?.type);
        if (!eventName) return null;
        return {
          event: eventName,
          protocol: normalizeString(entry?.protocol || ''),
          justification: normalizeString(entry?.justification || ''),
          createdAt: normalizeString(entry?.createdAt || entry?.at || ''),
        };
      })
      .filter(Boolean);
  }

  function ensureLocalAuthorizationEvent() {
    if (currentStatus !== 'authorized') return;
    const hasAuthorizationEvent = nfeEventEntries.some(
      (entry) => normalizeNfeEventName(entry?.event || '') === 'Autorizado o Uso da NF-e'
    );
    if (hasAuthorizationEvent) return;
    nfeEventEntries.unshift({
      event: 'Autorizado o Uso da NF-e',
      protocol: normalizeString(currentDraftMetadata?.sefazProtocol || ''),
      justification: '',
      createdAt: normalizeString(currentDraftMetadata?.sefazProcessedAt || new Date().toISOString()),
    });
  }

  function renderNfeEventsTable() {
    const tbody = document.getElementById('nfe-events-table-body');
    if (!tbody) return;
    ensureLocalAuthorizationEvent();
    if (!nfeEventEntries.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-xs text-gray-500">Nenhum evento registrado.</td></tr>';
      return;
    }
    tbody.innerHTML = nfeEventEntries
      .map((entry, index) => {
        const event = entry?.event || '-';
        const protocol = entry?.protocol || '-';
        const date = formatNfeEventDate(entry?.createdAt);
        return `
          <tr class="border-t border-gray-100">
            <td class="px-3 py-2 text-xs text-gray-700">${index + 1}</td>
            <td class="px-3 py-2 text-xs text-gray-700">${event}</td>
            <td class="px-3 py-2 text-xs text-gray-700">${protocol}</td>
            <td class="px-3 py-2 text-xs text-gray-700">${date}</td>
          </tr>
        `;
      })
      .join('');
  }

  function buildEventsModal() {
    if (document.getElementById(eventsModalId)) return;
    const modal = document.createElement('div');
    modal.id = eventsModalId;
    modal.className = 'fixed inset-0 z-[70] hidden overflow-y-auto bg-black/40 p-4';
    modal.innerHTML = `
      <div class="mx-auto w-full max-w-4xl rounded-xl bg-white shadow-xl">
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 class="text-base font-semibold text-gray-800">Eventos da NF-e</h3>
          <button type="button" class="text-gray-400 hover:text-gray-600" data-events-close>
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="space-y-4 px-4 py-4 text-sm text-gray-700">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo de Evento</span>
              <select id="nfe-events-type" class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <option value="Cancelamento">Cancelamento</option>
                <option value="Carta de Correcao">Carta de Correcao</option>
              </select>
            </label>
            <label class="flex flex-col gap-1 md:col-span-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">Justificativa</span>
              <textarea id="nfe-events-justification" rows="4" class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700" placeholder="Descreva a justificativa do evento..."></textarea>
            </label>
          </div>
          <div class="overflow-hidden rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">id</th>
                  <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Evento</th>
                  <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Protocolo</th>
                  <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Data</th>
                </tr>
              </thead>
              <tbody id="nfe-events-table-body" class="bg-white"></tbody>
            </table>
          </div>
          <div class="flex justify-end">
            <button
              type="button"
              id="nfe-events-send"
              class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <i class="fas fa-paper-plane"></i>
              Enviar
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function openEventsModal() {
    buildEventsModal();
    renderNfeEventsTable();
    const modal = document.getElementById(eventsModalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
  }

  function closeEventsModal() {
    const modal = document.getElementById(eventsModalId);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    const manageModal = document.getElementById(manageModalId);
    if (!manageModal || manageModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
  }

  async function submitNfeEvent() {
    if (!currentDraftId) {
      throw new Error('Salve a NF-e antes de registrar eventos.');
    }
    const hasAuthorizationProtocol = Boolean(
      normalizeString(currentDraftMetadata?.sefazProtocol || '').replace(/\D/g, '').length >= 10
    );
    if (currentStatus !== 'authorized' && !hasAuthorizationProtocol) {
      throw new Error('Apenas NF-e autorizada permite registrar eventos.');
    }
    const eventSelect = document.getElementById('nfe-events-type');
    const justificationInput = document.getElementById('nfe-events-justification');
    const selectedEvent = normalizeNfeEventName(eventSelect?.value || '');
    const justification = normalizeString(justificationInput?.value || '');
    if (!selectedEvent || selectedEvent === 'Autorizado o Uso da NF-e') {
      throw new Error('Tipo de evento invalido.');
    }
    if (!justification) {
      throw new Error('Informe a justificativa do evento.');
    }

    const response = await fetch(`${API_BASE}/nfe/drafts/${currentDraftId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        event: selectedEvent,
        justification,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.message || 'Nao foi possivel registrar o evento.');
    }
    const payload = await response.json().catch(() => ({}));
    nfeEventEntries = normalizeNfeEventList(payload?.events);
    if (String(payload?.status || '').toLowerCase() === 'canceled') {
      setStatus('canceled', { log: false });
    }
    ensureLocalAuthorizationEvent();
    renderNfeEventsTable();
    if (justificationInput) justificationInput.value = '';
    addHistory(`Evento registrado: ${selectedEvent}.`);
    updateManageModalContent();
    if (typeof showToast === 'function') {
      showToast('Evento registrado com sucesso.', 'success');
    }
  }

  function buildManageModal() {
    if (document.getElementById(manageModalId)) return;
    const modal = document.createElement('div');
    modal.id = manageModalId;
    modal.className = 'fixed inset-0 z-[60] hidden overflow-y-auto bg-black/40 p-4';
    modal.innerHTML = `
      <div class="mx-auto w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 class="text-base font-semibold text-gray-800">${manageModalTitle}</h3>
          <button type="button" class="text-gray-400 hover:text-gray-600" data-manage-close>
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="space-y-4 px-4 py-4 text-sm text-gray-700">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</span>
            <span id="nfe-manage-status" class="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-700">
              <i class="fas fa-circle text-[7px]"></i>
              ${statusBadge?.textContent?.trim() || 'Rascunho'}
            </span>
          </div>
          <div>
            <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">Log</span>
            <div class="mt-2 h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
              <ul id="nfe-manage-log" class="space-y-1"></ul>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Gerar XML</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Assinar</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Transmitir</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Consultar</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Download XML</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Imprimir</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Eventos</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Enviar E-mail</button>
            <button type="button" class="manage-action-btn rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Imprimir DANFE Simplificado</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function updateManageModalContent() {
    const modal = document.getElementById(manageModalId);
    if (!modal) return;
    const status = modal.querySelector('#nfe-manage-status');
    if (status) {
      status.textContent = statusBadge?.textContent?.trim() || 'Rascunho';
    }
    const logList = modal.querySelector('#nfe-manage-log');
    if (logList && historyList) {
      const items = Array.from(historyList.querySelectorAll('li')).slice(0, 12);
      logList.innerHTML = items.length
        ? items.map((item) => `<li>${item.textContent || ''}</li>`).join('')
        : '<li>Nenhum log registrado.</li>';
    }
  }

  function openManageModal() {
    buildManageModal();
    updateManageModalContent();
    const modal = document.getElementById(manageModalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
  }

  function closeManageModal() {
    const modal = document.getElementById(manageModalId);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    const eventsModal = document.getElementById(eventsModalId);
    if (!eventsModal || eventsModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
  }

  async function fetchNfeXmlOrGenerate(draftId) {
    const url = `${API_BASE}/nfe/drafts/${draftId}/xml`;
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (response.ok) {
      return response.text();
    }
    const generateResponse = await fetch(`${API_BASE}/nfe/drafts/${draftId}/xml`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });
    if (!generateResponse.ok) {
      const payload = await generateResponse.json().catch(() => ({}));
      throw new Error(payload?.message || 'Nao foi possivel gerar o XML.');
    }
    const retry = await fetch(url, { headers: getAuthHeaders() });
    if (!retry.ok) {
      const payload = await retry.json().catch(() => ({}));
      throw new Error(payload?.message || 'Nao foi possivel obter o XML.');
    }
    return retry.text();
  }

  function parseXml(xmlText) {
    const parser = new DOMParser();
    return parser.parseFromString(xmlText || '', 'text/xml');
  }

  function xmlGetText(node, selector) {
    if (!node) return '';
    const target = selector ? node.querySelector(selector) : node;
    return target?.textContent?.trim() || '';
  }

  function parseXmlNumber(raw) {
    if (typeof raw === 'number') return raw;
    const value = String(raw || '').trim();
    if (!value) return 0;
    const hasComma = value.includes(',');
    const hasDot = value.includes('.');
    let normalized = value;
    if (hasComma && hasDot) {
      normalized = value.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      normalized = value.replace(/\./g, '').replace(',', '.');
    } else if (hasDot) {
      normalized = value.replace(/,/g, '');
    } else {
      normalized = value;
    }
    normalized = normalized.replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value, decimals = 2) {
    const num = parseXmlNumber(value);
    return Number.isFinite(num) ? num.toFixed(decimals).replace('.', ',') : '0,00';
  }

  function formatBRL(value) {
    return formatNumber(value, 2);
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    const normalized = iso.replace('T', ' ');
    return normalized.length > 19 ? normalized.slice(0, 19) : normalized;
  }


  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatCep(value) {
    const digits = onlyDigits(value);
    return digits ? digits.slice(0, 8) : '';
  }

  function formatChave(value) {
    const digits = onlyDigits(value);
    if (!digits) return '';
    return digits.replace(/(.{4})/g, '$1 ').trim();
  }

  function formatDateTimeBR(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return formatDateTime(String(value));
    }
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function buildDanfeHtml(xmlDoc, { mode = 'full' } = {}) {
    const infNFe = xmlDoc.querySelector('infNFe');
    const ide = xmlDoc.querySelector('ide');
    const emit = xmlDoc.querySelector('emit');
    const dest = xmlDoc.querySelector('dest');
    const total = xmlDoc.querySelector('total ICMSTot');
    const prot = xmlDoc.querySelector('protNFe infProt');
    const transp = xmlDoc.querySelector('transp');
    const volumes = Array.from(xmlDoc.querySelectorAll('vol'));
    const cobr = xmlDoc.querySelector('cobr');
    const dupList = Array.from(xmlDoc.querySelectorAll('dup'));
    const dets = Array.from(xmlDoc.querySelectorAll('det'));

    const modeKey = mode === 'simple' || mode === 'simplified' ? 'simple' : 'full';
    const chave = (infNFe?.getAttribute('Id') || '').replace(/^NFe/, '');
    const chaveFormatada = formatChave(chave);
    const numero = xmlGetText(ide, 'nNF');
    const serie = xmlGetText(ide, 'serie');
    const natOp = xmlGetText(ide, 'natOp');
    const naturezaCodigo = xmlGetText(dets[0]?.querySelector('prod'), 'CFOP');
    const naturezaDescricao = natOp;
    const naturezaLabel =
      naturezaCodigo && naturezaDescricao
        ? normalizeDigits(naturezaDescricao).startsWith(naturezaCodigo)
          ? naturezaDescricao
          : `${naturezaCodigo} - ${naturezaDescricao}`
        : naturezaDescricao || naturezaCodigo || '';
    const dhEmiRaw = xmlGetText(ide, 'dhEmi') || xmlGetText(ide, 'dEmi');
    const dhEmi = formatDateTimeBR(dhEmiRaw);
    const tpNF = xmlGetText(ide, 'tpNF');
    const tpAmb = xmlGetText(ide, 'tpAmb');
    const mod = xmlGetText(ide, 'mod');
    const dhSaiEntRaw = xmlGetText(ide, 'dhSaiEnt') || '';
    const dSaiEnt = xmlGetText(ide, 'dSaiEnt');
    const hSaiEnt = xmlGetText(ide, 'hSaiEnt');
    const saidaDateTime = dhSaiEntRaw ? formatDateTimeBR(dhSaiEntRaw) : '';
    const saidaDate = saidaDateTime ? saidaDateTime.split(' ')[0] : dSaiEnt || '';
    const saidaTime = saidaDateTime ? saidaDateTime.split(' ')[1] : hSaiEnt || '';
    const protocolo = prot
      ? `${xmlGetText(prot, 'nProt')} - ${formatDateTimeBR(xmlGetText(prot, 'dhRecbto'))}`
      : 'SEM PROTOCOLO';
    const adicionais = xmlGetText(xmlDoc, 'infAdic infCpl') || xmlGetText(xmlDoc, 'infAdic infAdFisco') || '';
    const isHomologacao = tpAmb === '2';
    const emitFant = xmlGetText(emit, 'xFant');
    const emitFantHtml = emitFant ? `<div>${emitFant}</div>` : '';
    const homologRowFull = isHomologacao
      ? '<tr><td colspan="4" class="homolog">NF-e EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</td></tr>'
      : '';
    const homologRowSimple = isHomologacao
      ? '<tr><td colspan="3" class="homolog">NF-e EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</td></tr>'
      : '';

    const emitAddressLine = [
      xmlGetText(emit, 'enderEmit xLgr'),
      xmlGetText(emit, 'enderEmit nro'),
      xmlGetText(emit, 'enderEmit xCpl'),
      xmlGetText(emit, 'enderEmit xBairro'),
      xmlGetText(emit, 'enderEmit xMun'),
      xmlGetText(emit, 'enderEmit UF'),
    ]
      .filter(Boolean)
      .join(' - ');

    const emitCep = formatCep(xmlGetText(emit, 'enderEmit CEP'));

    const destStreet = xmlGetText(dest, 'enderDest xLgr');
    const destNumber = xmlGetText(dest, 'enderDest nro');
    const destComplement = xmlGetText(dest, 'enderDest xCpl');
    const destBairro = xmlGetText(dest, 'enderDest xBairro');
    const destMunicipio = xmlGetText(dest, 'enderDest xMun');
    const destUf = xmlGetText(dest, 'enderDest UF');
    const destCep = formatCep(xmlGetText(dest, 'enderDest CEP'));
    const destFone = xmlGetText(dest, 'fone') || xmlGetText(dest, 'enderDest fone');
    const destAddress = [
      destStreet,
      destNumber,
      destComplement,
      destBairro,
      destMunicipio && destUf ? `${destMunicipio} - ${destUf}` : destMunicipio || destUf,
    ]
      .filter(Boolean)
      .join(' - ');

    const transportName = xmlGetText(transp, 'transporta xNome');
    const transportDoc = xmlGetText(transp, 'transporta CNPJ') || xmlGetText(transp, 'transporta CPF');
    const transportIe = xmlGetText(transp, 'transporta IE');
    const transportAddress = xmlGetText(transp, 'transporta xEnder');
    const transportMun = xmlGetText(transp, 'transporta xMun');
    const transportUf = xmlGetText(transp, 'transporta UF');
    const modFrete = xmlGetText(transp, 'modFrete');

    const productsRows = dets
      .map((det, index) => {
        const prod = det.querySelector('prod');
        const imposto = det.querySelector('imposto');
        const icmsNode = imposto?.querySelector('ICMS')?.firstElementChild || null;
        const ipiNode = imposto?.querySelector('IPI')?.firstElementChild || null;
        const cst = xmlGetText(icmsNode, 'CST') || xmlGetText(icmsNode, 'CSOSN');
        const cfop = xmlGetText(prod, 'CFOP');
        const vBC = xmlGetText(icmsNode, 'vBC');
        const vICMS = xmlGetText(icmsNode, 'vICMS');
        const pICMS = xmlGetText(icmsNode, 'pICMS');
        const vIPI = xmlGetText(ipiNode, 'vIPI');
        const pIPI = xmlGetText(ipiNode, 'pIPI');
        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${xmlGetText(prod, 'cProd')}</td>
            <td>${xmlGetText(prod, 'xProd')}</td>
            <td class="center ncm">${xmlGetText(prod, 'NCM')}</td>
            <td class="center">${cst || '0'}</td>
            <td class="center">${cfop}</td>
            <td class="center">${xmlGetText(prod, 'uCom')}</td>
            <td class="num">${formatNumber(xmlGetText(prod, 'qCom'), 4)}</td>
            <td class="num">${formatNumber(xmlGetText(prod, 'vUnCom'), 3)}</td>
            <td class="num">${formatNumber(xmlGetText(prod, 'vProd'), 2)}</td>
            <td class="num">${formatNumber(vBC, 2)}</td>
            <td class="num">${formatNumber(vICMS, 2)}</td>
            <td class="num">${formatNumber(vIPI, 2)}</td>
            <td class="num">${formatNumber(pICMS, 2)}</td>
            <td class="num">${formatNumber(pIPI, 2)}</td>
          </tr>
        `;
      })
      .join('');

    const dupCards = dupList.map(
      (dup) => `
        <table class="dup-card">
          <tr>
            <td class="label">Num.</td>
            <td class="value right">${xmlGetText(dup, 'nDup')}</td>
          </tr>
          <tr>
            <td class="label">Venc.</td>
            <td class="value right">${xmlGetText(dup, 'dVenc')}</td>
          </tr>
          <tr>
            <td class="label">Valor</td>
            <td class="value right">${formatBRL(xmlGetText(dup, 'vDup'))}</td>
          </tr>
        </table>
      `,
    );

    const dupGridRows = (() => {
      if (!dupCards.length) {
        return '<tr><td class="value">Sem duplicatas.</td></tr>';
      }
      const rows = [];
      const columns = 6;
      for (let i = 0; i < dupCards.length; i += columns) {
        const chunk = dupCards.slice(i, i + columns);
        rows.push(`<tr>${chunk.map((card) => `<td>${card}</td>`).join('')}</tr>`);
      }
      return rows.join('');
    })();

    const faturaHtml = cobr
      ? `
        <table class="block grid small">
          <colgroup>
            <col style="width:20%">
            <col style="width:30%">
            <col style="width:20%">
            <col style="width:30%">
          </colgroup>
          <tr>
            <td colspan="4" class="section-title">FATURA / DUPLICATA</td>
          </tr>
          <tr>
            <td class="label">Numero</td>
            <td class="value">${xmlGetText(cobr, 'fat nFat')}</td>
            <td class="label">Valor</td>
            <td class="value right">${formatBRL(xmlGetText(cobr, 'fat vLiq'))}</td>
          </tr>
          <tr>
            <td colspan="4" class="dup-grid-wrapper">
              <table class="dup-grid">
                <tbody>
                  ${dupGridRows}
                </tbody>
              </table>
            </td>
          </tr>
        </table>
      `
      : '';

    const volumesHtml = volumes.length
      ? volumes
          .map(
            (vol) => `
              <tr>
                <td class="label">Qtd</td>
                <td class="value right">${xmlGetText(vol, 'qVol')}</td>
                <td class="label">Especie</td>
                <td class="value">${xmlGetText(vol, 'esp')}</td>
                <td class="label">Marca</td>
                <td class="value">${xmlGetText(vol, 'marca')}</td>
                <td class="label">Peso Bruto</td>
                <td class="value right">${xmlGetText(vol, 'pesoB')}</td>
              </tr>
            `,
          )
          .join('')
      : `
        <tr>
          <td colspan="8" class="value">Sem volumes informados.</td>
        </tr>
      `;
    if (modeKey === 'simple') {
      return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>DANFE Simplificado</title>
  <style>
    @page { size: A4; margin: 6mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #111; line-height: 1.25; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #000; padding: 2px 3px; vertical-align: top; }
    .label { font-size: 6.3pt; text-transform: uppercase; }
    .value { font-size: 7.5pt; font-weight: 600; }
    .center { text-align: center; }
    .right { text-align: right; }
    .num { text-align: right; white-space: nowrap; }
    .block { margin-bottom: 4px; }
    .section-title { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; text-align: center; }
    .barcode-box { display: flex; flex-direction: column; gap: 2px; }
    .barcode-fallback { border: 1px solid #000; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 7pt; }
    .homolog { font-weight: 700; text-align: center; }
    thead { display: table-header-group; }
    .items { table-layout: fixed; }
    .items thead th { background: #f5f5f5; }
    .items tbody tr { page-break-inside: avoid; }
    .items .ncm { font-size: 6.2pt; letter-spacing: -0.2px; white-space: nowrap; }
  </style>
</head>
<body>
  <table>
    <tr>
      <td colspan="3" class="section-title">DANFE SIMPLIFICADO</td>
    </tr>
    <tr>
      <td>
        <div class="label">Emitente</div>
        <div class="value">${xmlGetText(emit, 'xNome')}</div>
        <div>${emitAddressLine}</div>
      </td>
      <td class="center">
        <div class="label">NF-e</div>
        <div class="value">${numero}</div>
        <div class="label">Serie</div>
        <div class="value">${serie}</div>
        <div class="label">Modelo</div>
        <div class="value">${mod || '55'}</div>
      </td>
      <td class="center">
        <div class="label">Chave de Acesso</div>
        <div class="value">${chaveFormatada}</div>
        <svg id="danfe-barcode"></svg>
        <div class="barcode-fallback" data-barcode-fallback>${chave}</div>
      </td>
    </tr>
    <tr>
      <td colspan="3">
        <div class="label">Destinatario</div>
        <div class="value">${xmlGetText(dest, 'xNome')}</div>
        <div>${destAddress}</div>
      </td>
    </tr>
    ${homologRowSimple}
    <tr>
      <td colspan="3" class="section-title">DADOS DOS PRODUTOS / SERVICOS</td>
    </tr>
  </table>
  <table class="items">
    <colgroup>
      <col style="width:6%">
      <col style="width:44%">
      <col style="width:12%">
      <col style="width:12%">
      <col style="width:12%">
      <col style="width:14%">
    </colgroup>
    <thead>
      <tr>
        <th class="center">Item</th>
        <th>Descricao</th>
        <th class="center">Qtde</th>
        <th class="center">V. Unit</th>
        <th class="center">V. Total</th>
        <th class="center">CFOP</th>
      </tr>
    </thead>
    <tbody>
      ${
        dets.length
          ? dets
              .map((det, index) => {
                const prod = det.querySelector('prod');
                return `
                  <tr>
                    <td class="center">${index + 1}</td>
                    <td>${xmlGetText(prod, 'xProd')}</td>
                    <td class="right">${formatNumber(xmlGetText(prod, 'qCom'), 4)}</td>
                    <td class="right">${formatNumber(xmlGetText(prod, 'vUnCom'), 3)}</td>
                    <td class="right">${formatNumber(xmlGetText(prod, 'vProd'), 2)}</td>
                    <td class="center">${xmlGetText(prod, 'CFOP')}</td>
                  </tr>
                `;
              })
              .join('')
          : '<tr><td colspan="6" class="center">Nenhum item informado.</td></tr>'
      }
    </tbody>
  </table>
  <table>
    <tr>
      <td>
        <div class="label">Total NF-e</div>
        <div class="value right">${formatBRL(xmlGetText(total, 'vNF'))}</div>
      </td>
      <td>
        <div class="label">Data de Emissao</div>
        <div class="value">${dhEmi}</div>
      </td>
      <td>
        <div class="label">Protocolo</div>
        <div class="value">${protocolo}</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
    }

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>DANFE</title>
  <style>
    @page { size: A4; margin: 6mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #111; line-height: 1.25; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #000; padding: 2px 3px; vertical-align: top; }
    .danfe { width: 100%; }
    .label { font-size: 6.2pt; text-transform: uppercase; }
    .value { font-size: 7.5pt; font-weight: 600; }
    .center { text-align: center; }
    .right { text-align: right; }
    .num { text-align: right; white-space: nowrap; }
    .nowrap { white-space: nowrap; }
    .block { margin-bottom: 4px; }
    .small { font-size: 6.8pt; }
    .section-title { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; text-align: center; }
    .muted { font-weight: 400; font-size: 6.5pt; }
    .barcode-box { display: flex; flex-direction: column; gap: 2px; }
    .barcode-fallback { border: 1px solid #000; height: 38px; display: flex; align-items: center; justify-content: center; font-size: 7pt; }
    .homolog { font-weight: 700; text-align: center; font-size: 7.5pt; }
    .items { table-layout: fixed; }
    .items thead th { background: #f5f5f5; }
    .items tbody tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    .danfe-box { display: flex; flex-direction: column; gap: 2px; align-items: stretch; }
    .danfe-title { font-size: 12pt; font-weight: 700; letter-spacing: 0.5px; }
    .danfe-subtitle { font-size: 6.5pt; text-transform: uppercase; }
    .danfe-entry-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .danfe-entry-text { font-size: 6.5pt; text-transform: uppercase; text-align: left; line-height: 1.2; }
    .danfe-entry-box { width: 18px; height: 18px; border: 1px solid #000; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 9pt; }
    .danfe-meta { font-size: 8pt; font-weight: 700; }
    .danfe-folha { font-size: 7pt; text-transform: uppercase; font-weight: 600; }
    .dup-grid { width: auto; border-collapse: collapse; table-layout: fixed; }
    .dup-grid td { border: 1px solid #000; padding: 1px 2px; vertical-align: top; width: 86px; text-align: left; }
    .dup-grid-wrapper { padding: 0; text-align: left; }
    .dup-card { width: 100%; border-collapse: collapse; font-size: 6pt; text-align: left; }
    .dup-card td { border: none; padding: 0 1px; line-height: 1.1; text-align: left; }
    .dup-card .label { font-size: 5.2pt; }
    .dup-card .value { font-size: 6pt; font-weight: 700; }
  </style>
</head>
<body>
  <div class="danfe">
    <table class="block">
      <colgroup>
        <col style="width:82%">
        <col style="width:18%">
      </colgroup>
      <tr>
        <td class="label">
          RECEBEMOS DE ${xmlGetText(emit, 'xNome')} OS PRODUTOS E/OU SERVICOS CONSTANTES DA NOTA FISCAL
          ELETRONICA INDICADA ABAIXO. EMISSAO: ${dhEmi} VALOR TOTAL: ${formatBRL(xmlGetText(total, 'vNF'))}
          DESTINATARIO: ${xmlGetText(dest, 'xNome')} - ${destAddress}
        </td>
        <td class="center" rowspan="2">
          <div class="section-title">NF-e</div>
          <div class="value">Nº ${numero}</div>
          <div class="value">Serie ${serie}</div>
        </td>
      </tr>
      <tr>
        <td>
          <table style="width:100%; border-collapse:collapse;">
            <colgroup>
              <col style="width:20%">
              <col style="width:80%">
            </colgroup>
            <tr>
              <td style="height:14px; position:relative;">
                <span style="font-size:5pt; text-transform:uppercase; position:absolute; left:2px; bottom:2px;">Data de Recebimento</span>
              </td>
              <td style="height:14px; position:relative;">
                <span style="font-size:5pt; text-transform:uppercase; position:absolute; left:2px; bottom:2px;">Identificacao e Assinatura do Recebedor</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table class="block">
      <colgroup>
        <col style="width:46%">
        <col style="width:24%">
        <col style="width:30%">
      </colgroup>
      <tr>
        <td>
          <div class="section-title" style="font-style:italic;">Identificacao do Emitente</div>
          <div class="value">${xmlGetText(emit, 'xNome')}</div>
          ${emitFantHtml}
          <div>${emitAddressLine}</div>
          <div class="muted">CEP ${emitCep}</div>
          <div class="muted">CNPJ ${xmlGetText(emit, 'CNPJ')}</div>
          <div class="muted">IE ${xmlGetText(emit, 'IE')}</div>
        </td>
        <td class="center">
          <div class="danfe-box">
            <div class="danfe-title">DANFE</div>
            <div class="danfe-subtitle">Documento Auxiliar da Nota Fiscal Eletronica</div>
            <div class="danfe-entry-row">
              <div class="danfe-entry-text">
                0 - ENTRADA<br>
                1 - SAIDA
              </div>
              <div class="danfe-entry-box">${tpNF || ''}</div>
            </div>
            <div class="danfe-meta">Nº ${numero}</div>
            <div class="danfe-meta">Serie ${serie}</div>
            <div class="danfe-folha">Folha 1/1</div>
          </div>
        </td>
        <td>
          <table style="width:100%; border-collapse:collapse;">
            <tr>
              <td style="border:1px solid #000; padding:2px 3px;">
                <div class="barcode-box">
                  <svg id="danfe-barcode"></svg>
                  <div class="barcode-fallback" data-barcode-fallback>${chave}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="border:1px solid #000; padding:2px 3px;">
                <div class="label center">Chave de Acesso</div>
                <div class="value center">${chaveFormatada}</div>
              </td>
            </tr>
            <tr>
              <td style="border:1px solid #000; padding:2px 3px;">
                <div class="muted center">
                  Consulta de autenticidade no portal nacional da NF-e
                  www.nfe.fazenda.gov.br/portal
                  ou no site da SEFAZ Autorizadora
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table class="block">
      <colgroup>
        <col style="width:70%">
        <col style="width:30%">
      </colgroup>
      <tr>
        <td>
          <div class="label">Natureza da Operacao</div>
          <div class="value">${naturezaLabel}</div>
        </td>
        <td>
          <div class="label">Protocolo de Autorizacao de Uso</div>
          <div class="value">${protocolo}</div>
        </td>
      </tr>
    </table>

    <table class="block">
      <colgroup>
        <col style="width:48%">
        <col style="width:17%">
        <col style="width:13%">
        <col style="width:22%">
      </colgroup>
      <tr>
        <td>
          <div class="label">Destinatario / Remetente</div>
          <div class="value">${xmlGetText(dest, 'xNome')}</div>
        </td>
        <td>
          <div class="label">CNPJ/CPF</div>
          <div class="value">${xmlGetText(dest, 'CPF') || xmlGetText(dest, 'CNPJ')}</div>
        </td>
        <td>
          <div class="label">IE</div>
          <div class="value">${xmlGetText(dest, 'IE')}</div>
        </td>
        <td>
          <div class="label">Data Emissao</div>
          <div class="value">${dhEmi}</div>
        </td>
      </tr>
      <tr>
        <td>
          <div class="label">Endereco</div>
          <div class="value">${[destStreet, destNumber, destComplement].filter(Boolean).join(', ')}</div>
        </td>
        <td>
          <div class="label">Bairro</div>
          <div class="value">${destBairro}</div>
        </td>
        <td>
          <div class="label">CEP</div>
          <div class="value">${destCep}</div>
        </td>
        <td>
          <div class="label">Data Saida/Entrada</div>
          <div class="value">${saidaDate}</div>
        </td>
      </tr>
      <tr>
        <td>
          <div class="label">Municipio</div>
          <div class="value">${destMunicipio}</div>
        </td>
        <td>
          <div class="label">UF</div>
          <div class="value">${destUf}</div>
        </td>
        <td>
          <div class="label">Fone/Fax</div>
          <div class="value">${destFone}</div>
        </td>
        <td>
          <div class="label">Hora Saida/Entrada</div>
          <div class="value">${saidaTime}</div>
        </td>
      </tr>
      ${homologRowFull}
    </table>

    ${faturaHtml}

    <table class="block">
      <colgroup>
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
        <col style="width:8.33%">
      </colgroup>
      <tr>
        <td colspan="12" class="section-title">Calculo do Imposto</td>
      </tr>
      <tr>
        <td class="label">BC ICMS</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vBC'))}</td>
        <td class="label">V. ICMS</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vICMS'))}</td>
        <td class="label">BC ICMS ST</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vBCST'))}</td>
        <td class="label">V. ICMS ST</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vST'))}</td>
        <td class="label">V. IPI</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vIPI'))}</td>
        <td class="label">V. Total NF-e</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vNF'))}</td>
      </tr>
      <tr>
        <td class="label">V. Frete</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vFrete'))}</td>
        <td class="label">V. Seguro</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vSeg'))}</td>
        <td class="label">Desconto</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vDesc'))}</td>
        <td class="label">Outras Desp.</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vOutro'))}</td>
        <td class="label">V. Produtos</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vProd'))}</td>
        <td class="label">V. Tot. Trib.</td>
        <td class="value right">${formatBRL(xmlGetText(total, 'vTotTrib'))}</td>
      </tr>
    </table>

    <table class="block small">
      <colgroup>
        <col style="width:35%">
        <col style="width:15%">
        <col style="width:15%">
        <col style="width:35%">
      </colgroup>
      <tr>
        <td colspan="4" class="section-title">Transportador / Volumes Transportados</td>
      </tr>
      <tr>
        <td>
          <div class="label">Nome / Razao Social</div>
          <div class="value">${transportName}</div>
        </td>
        <td>
          <div class="label">Frete</div>
          <div class="value">${modFrete}</div>
        </td>
        <td>
          <div class="label">CNPJ/CPF</div>
          <div class="value">${transportDoc}</div>
        </td>
        <td>
          <div class="label">Endereco</div>
          <div class="value">${transportAddress}</div>
        </td>
      </tr>
      <tr>
        <td>
          <div class="label">Municipio</div>
          <div class="value">${transportMun}</div>
        </td>
        <td>
          <div class="label">UF</div>
          <div class="value">${transportUf}</div>
        </td>
        <td>
          <div class="label">IE</div>
          <div class="value">${transportIe}</div>
        </td>
        <td></td>
      </tr>
      ${volumesHtml}
    </table>

    <table class="items">
      <colgroup>
        <col style="width:4%">
        <col style="width:6%">
        <col style="width:22%">
        <col style="width:6%">
        <col style="width:5%">
        <col style="width:5%">
        <col style="width:4%">
        <col style="width:6%">
        <col style="width:7%">
        <col style="width:7%">
        <col style="width:7%">
        <col style="width:6%">
        <col style="width:5%">
        <col style="width:5%">
        <col style="width:5%">
      </colgroup>
      <thead>
        <tr>
          <th class="center">Item</th>
          <th class="center">Cod</th>
          <th>Descricao</th>
          <th class="center ncm">NCM</th>
          <th class="center">CST</th>
          <th class="center">CFOP</th>
          <th class="center">UN</th>
          <th class="center">QTD</th>
          <th class="center">V. Unit</th>
          <th class="center">V. Total</th>
          <th class="center">BC ICMS</th>
          <th class="center">V. ICMS</th>
          <th class="center">V. IPI</th>
          <th class="center">Aliq ICMS</th>
          <th class="center">Aliq IPI</th>
        </tr>
      </thead>
      <tbody>
        ${productsRows || '<tr><td colspan="15" class="center">Nenhum item informado.</td></tr>'}
      </tbody>
    </table>

    <table class="block">
      <colgroup>
        <col style="width:75%">
        <col style="width:25%">
      </colgroup>
      <tr>
        <td class="section-title">Dados Adicionais</td>
        <td class="section-title">Reservado ao Fisco</td>
      </tr>
      <tr>
        <td>${adicionais || 'Sem informacoes adicionais.'}</td>
        <td></td>
      </tr>
    </table>
  </div>
</body>
</html>`;
  }

  function openPrintWindow(html, title, { withBarcode = false, chave = '' } = {}) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error('Nao foi possivel abrir a janela de impressao.');
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    if (withBarcode && chave) {
      const script = printWindow.document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
      script.onload = () => {
        try {
          const svg = printWindow.document.getElementById('danfe-barcode');
          if (svg && typeof printWindow.JsBarcode === 'function') {
            printWindow.JsBarcode(svg, chave, {
              format: 'CODE128',
              displayValue: false,
              height: 48,
              margin: 0,
              width: 1.2,
            });
            const fallback = printWindow.document.querySelector('[data-barcode-fallback]');
            if (fallback) fallback.style.display = 'none';
          }
        } catch (_) {
          // ignore
        } finally {
          printWindow.focus();
          setTimeout(() => printWindow.print(), 250);
        }
      };
      script.onerror = () => {
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
      };
      printWindow.document.head.appendChild(script);
    } else {
      printWindow.focus();
      setTimeout(() => printWindow.print(), 250);
    }
  }

  async function handleManageAction(label) {
    if (!currentDraftId) {
      if (typeof showToast === 'function') {
        showToast('Selecione ou grave uma NF-e para gerenciar.', 'warning');
      }
      return;
    }
    if (label === 'Gerar XML') {
      const response = await fetch(`${API_BASE}/nfe/drafts/${currentDraftId}/xml`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Nao foi possivel gerar o XML.');
      }
      const payload = await response.json().catch(() => ({}));
      addHistory('XML da NF-e gerado.');
      updateManageModalContent();
      if (typeof showToast === 'function') {
        const envLabel = payload?.environment === 'producao' ? 'Produção' : 'Homologação';
        showToast(`XML gerado (${envLabel}).`, 'success');
      }
      return;
    }
    if (label === 'Assinar') {
      const response = await fetch(`${API_BASE}/nfe/drafts/${currentDraftId}/xml/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Nao foi possivel assinar o XML.');
      }
      const payload = await response.json().catch(() => ({}));
      addHistory('XML da NF-e assinado.');
      updateManageModalContent();
      if (typeof showToast === 'function') {
        const envLabel = payload?.environment === 'producao' ? 'ProduÃ§Ã£o' : 'HomologaÃ§Ã£o';
        showToast(`XML assinado (${envLabel}).`, 'success');
      }
      return;
    }
    if (label === 'Transmitir') {
      const response = await fetch(`${API_BASE}/nfe/drafts/${currentDraftId}/xml/transmit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Nao foi possivel transmitir a NF-e.');
      }
      const payload = await response.json().catch(() => ({}));
      addHistory('NF-e transmitida para a SEFAZ.');
      if (['100', '150'].includes(String(payload?.status || ''))) {
        currentDraftMetadata = {
          ...(currentDraftMetadata || {}),
          sefazProtocol: normalizeString(payload?.protocol || ''),
          sefazProcessedAt: normalizeString(payload?.processedAt || new Date().toISOString()),
        };
        setStatus('authorized', { log: false });
        ensureLocalAuthorizationEvent();
      } else {
        setStatus('rejected', { log: false });
      }
      updateManageModalContent();
      await bumpNextNumberAfterTransmit();
      if (typeof showToast === 'function') {
        const statusLabel = payload?.status ? ` (status ${payload.status})` : '';
        showToast(`NF-e transmitida${statusLabel}.`, 'success');
      }
      return;
    }
    if (label === 'Consultar') {
      const response = await fetch(`${API_BASE}/nfe/drafts/${currentDraftId}/sefaz/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Nao foi possivel consultar o status da NF-e na SEFAZ.');
      }
      const payload = await response.json().catch(() => ({}));
      const statusCode = String(payload?.status || '');
      if (['100', '150'].includes(statusCode)) {
        currentDraftMetadata = {
          ...(currentDraftMetadata || {}),
          sefazProtocol: normalizeString(payload?.protocol || currentDraftMetadata?.sefazProtocol || ''),
          sefazProcessedAt: normalizeString(payload?.processedAt || currentDraftMetadata?.sefazProcessedAt || ''),
        };
        setStatus('authorized', { log: false });
        ensureLocalAuthorizationEvent();
      } else if (['101', '151', '155'].includes(statusCode) || String(payload?.draftStatus || '') === 'canceled') {
        setStatus('canceled', { log: false });
      } else if (statusCode) {
        setStatus('rejected', { log: false });
      }
      const statusMessage = payload?.message || 'Consulta realizada.';
      addHistory(`Consulta SEFAZ: ${statusCode || 'sem status'} - ${statusMessage}`);
      updateManageModalContent();
      if (typeof showToast === 'function') {
        showToast(`SEFAZ: ${statusCode || 'sem status'} - ${statusMessage}`, 'info');
      }
      return;
    }
    if (label === 'Download XML') {
      const url = `${API_BASE}/nfe/drafts/${currentDraftId}/xml`;
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Nao foi possivel baixar o XML.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/i);
      const fileName = match?.[1] || `${currentDraftCode || currentDraftId}.xml`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return;
    }
    if (label === 'Imprimir') {
      const xmlText = await fetchNfeXmlOrGenerate(currentDraftId);
      const xmlDoc = parseXml(xmlText);
      const chave = (xmlDoc.querySelector('infNFe')?.getAttribute('Id') || '').replace(/^NFe/, '');
      const html = buildDanfeHtml(xmlDoc, { mode: 'full' });
      openPrintWindow(html, 'DANFE', { withBarcode: true, chave });
      return;
    }
    if (label === 'Imprimir DANFE Simplificado') {
      const xmlText = await fetchNfeXmlOrGenerate(currentDraftId);
      const xmlDoc = parseXml(xmlText);
      const html = buildDanfeHtml(xmlDoc, { mode: 'simple' });
      openPrintWindow(html, 'DANFE Simplificado');
      return;
    }
    if (label === 'Eventos') {
      const hasAuthorizationProtocol = Boolean(
        normalizeString(currentDraftMetadata?.sefazProtocol || '').replace(/\D/g, '').length >= 10
      );
      if (currentStatus !== 'authorized' && !hasAuthorizationProtocol) {
        if (typeof showToast === 'function') {
          showToast('Apenas NF-e autorizada permite registrar eventos.', 'warning');
        }
        return;
      }
      openEventsModal();
      return;
    }
    if (typeof showToast === 'function') {
      showToast('Funcionalidade pendente de integra\u00e7\u00e3o.', 'info');
    }
  }

  function setIssueDate() {
    if (!issueDateInput) return;
    const today = new Date();
    issueDateInput.value = today.toISOString().slice(0, 10);
  }

  function nextNumber() {
    const key = 'nfe:lastNumber';
    const current = parseInt(localStorage.getItem(key) || '0', 10);
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(key, String(next));
    return next;
  }

  function setNewNumber() {
    if (!numberInput) return;
    numberInput.value = String(nextNumber()).padStart(6, '0');
  }

  function captureDefaultState(force = false) {
    if (defaultFormState && !force) return;
    const snapshot = {};
    document.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.id) return;
      snapshot[field.id] = {
        value: field.value,
        checked: field.checked,
        type: field.type,
      };
    });
    defaultFormState = snapshot;
  }

  function applyDefaultState() {
    if (!defaultFormState) {
      resetForm();
      clearDraftTables();
    } else {
      Object.entries(defaultFormState).forEach(([id, state]) => {
        const field = document.getElementById(id);
        if (!field) return;
        if (state.type === 'checkbox' || state.type === 'radio') {
          field.checked = Boolean(state.checked);
        } else {
          field.value = state.value ?? '';
        }
      });
      clearDraftTables();
    }

    if (itemsAlert) {
      itemsAlert.classList.add('hidden');
      itemsAlert.textContent = '';
    }
    updatePartySearchPlaceholder();
    setStatus('draft', { log: false });
    currentDraftMetadata = {};
    currentDraftXmlAmbient = '';
    nfeEventEntries = [];
    resetHistoryList();
    updateTotals();
    updatePaymentKpis();
    updateActionAvailability();
    updateSerieSelectDisplay(false);
  }

  function resetForm({ keepNumber = false } = {}) {
    document.querySelectorAll('input, select, textarea').forEach((field) => {
      if (field === issueDateInput) return;
      if (field === numberInput && keepNumber) return;
      if (field.hasAttribute('readonly') || field.disabled) return;
      if (field.type === 'checkbox' || field.type === 'radio') {
        field.checked = false;
        return;
      }
      field.value = '';
    });

    if (extraInputs.frete) extraInputs.frete.value = '0,00';
    if (extraInputs.outros) extraInputs.outros.value = '0,00';
    if (extraInputs.paymentValue) extraInputs.paymentValue.value = '0,00';

    if (!keepNumber) {
      setNewNumber();
    }

    if (itemsBody) {
      itemsBody.innerHTML = '';
      if (itemsEmpty) itemsBody.appendChild(itemsEmpty);
    }

    if (itemsAlert) {
      itemsAlert.classList.add('hidden');
      itemsAlert.textContent = '';
    }

    if (partyTypeSelect) partyTypeSelect.value = PARTY_TYPES.client;
    if (partySearchInput) partySearchInput.value = '';
    updatePartySearchPlaceholder();
    if (serviceTypeSelect) serviceTypeSelect.value = 'nao-aplica';
    if (stockMovementSelect) stockMovementSelect.value = 'remover';
    if (stockDepositSelect) stockDepositSelect.value = '';

    setStatus('draft', { log: false });
    updateTotals();
  }

  function formatAddress(store = {}) {
    const parts = [
      store.logradouro,
      store.numero,
      store.bairro ? `Bairro ${store.bairro}` : '',
      store.municipio ? `${store.municipio}/${store.uf || ''}` : '',
      store.cep ? `CEP ${store.cep}` : '',
    ]
      .map((value) => (value ? String(value).trim() : ''))
      .filter(Boolean);
    return parts.join(' - ');
  }

  function formatPartyAddress(rawAddress) {
    if (!rawAddress) return '';
    if (typeof rawAddress === 'string') return rawAddress;
    const source =
      rawAddress && typeof rawAddress === 'object' && rawAddress.address && typeof rawAddress.address === 'object'
        ? rawAddress.address
        : rawAddress;
    const street = normalizeString(source.logradouro || source.rua || source.street || source.address || '');
    const number = normalizeString(source.numero || source.num || source.number || '');
    const complement = normalizeString(source.complemento || source.complement || source.complementoEndereco || '');
    const bairro = normalizeString(source.bairro || source.neighborhood || source.distrito || '');
    const cidade = normalizeString(source.cidade || source.municipio || source.city || '');
    const uf = normalizeString(source.uf || source.estado || source.state || '');
    const cep = normalizeString(source.cep || source.postalCode || source.zip || '');
    const line1 = [street, number].filter(Boolean).join(', ');
    const line2 = [complement, bairro].filter(Boolean).join(' - ');
    const cityLine = [cidade, uf].filter(Boolean).join('/');
    const cepLine = cep ? `CEP ${cep}` : '';
    return [line1, line2, cityLine, cepLine].filter(Boolean).join(' - ');
  }

  function resolveCustomerName(customer) {
    if (!customer || typeof customer !== 'object') return '';
    return (
      customer.nome ||
      customer.nomeCompleto ||
      customer.nomeContato ||
      customer.razaoSocial ||
      customer.nomeFantasia ||
      customer.fantasia ||
      customer.email ||
      ''
    );
  }

  function resolveCustomerDocument(customer) {
    if (!customer || typeof customer !== 'object') return '';
    return (
      customer.documento ||
      customer.documentoPrincipal ||
      customer.doc ||
      customer.cpf ||
      customer.cnpj ||
      customer.inscricaoEstadual ||
      ''
    );
  }

  function resolveCustomerCode(customer) {
    if (!customer || typeof customer !== 'object') return '';
    return normalizeDigits(
      customer.codigo || customer.codigoCliente || customer.codigo_cliente || customer.codigoCliente || ''
    );
  }

  function resolveSupplierName(supplier) {
    if (!supplier || typeof supplier !== 'object') return '';
    return supplier.legalName || supplier.fantasyName || supplier.nomeFantasia || supplier.razaoSocial || '';
  }

  function resolveSupplierCode(supplier) {
    if (!supplier || typeof supplier !== 'object') return '';
    return normalizeDigits(supplier.code || supplier.codeNumber || supplier.codigo || '');
  }

  function resolveSupplierDocument(supplier) {
    if (!supplier || typeof supplier !== 'object') return '';
    return supplier.cnpj || supplier.documento || '';
  }

  function resolvePartyPhone(record) {
    if (!record || typeof record !== 'object') return '';
    return (
      record.celular ||
      record.telefone ||
      record.phone ||
      record.contact?.phone ||
      record.contact?.mobile ||
      record.contact?.secondaryPhone ||
      ''
    );
  }

  function resolvePartyEmail(record) {
    if (!record || typeof record !== 'object') return '';
    return record.email || record.contact?.email || '';
  }

  function resolvePartyAddress(record) {
    if (!record || typeof record !== 'object') return '';
    const raw =
      record.address ||
      record.endereco ||
      (Array.isArray(record.enderecos) && record.enderecos.length ? record.enderecos[0] : null);
    return formatPartyAddress(raw);
  }

  function extractPartyAddressParts(record) {
    if (!record) return {};
    if (typeof record === 'string') {
      return { address: record };
    }
    const raw =
      record.address ||
      record.endereco ||
      (Array.isArray(record.enderecos) && record.enderecos.length ? record.enderecos[0] : null) ||
      record;
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const source = raw.address && typeof raw.address === 'object' ? raw.address : raw;
    return {
      address: normalizeString(source.logradouro || source.rua || source.street || source.address || ''),
      number: normalizeString(source.numero || source.num || source.number || ''),
      complement: normalizeString(source.complemento || source.complement || source.complementoEndereco || ''),
      neighborhood: normalizeString(source.bairro || source.neighborhood || source.distrito || ''),
      city: normalizeString(source.cidade || source.municipio || source.city || ''),
      state: normalizeString(source.uf || source.estado || source.state || ''),
      zip: normalizeString(source.cep || source.postalCode || source.zip || ''),
      country: normalizeString(source.pais || source.country || ''),
    };
  }

  function setClientAddressFields(parts) {
    if (!parts || typeof parts !== 'object') return;
    if (clientFields.address && parts.address) clientFields.address.value = parts.address;
    if (clientFields.number && parts.number) clientFields.number.value = parts.number;
    if (clientFields.complement && parts.complement) clientFields.complement.value = parts.complement;
    if (clientFields.neighborhood && parts.neighborhood) clientFields.neighborhood.value = parts.neighborhood;
    if (clientFields.zip && parts.zip) clientFields.zip.value = parts.zip;
    if (clientFields.city && parts.city) clientFields.city.value = parts.city;
    if (clientFields.state && parts.state) clientFields.state.value = parts.state;
    if (clientFields.country && parts.country) clientFields.country.value = parts.country;
  }

  function setPartySearchValue(value) {
    if (!partySearchInput) return;
    partySearchSilent = true;
    partySearchInput.value = value || '';
    setTimeout(() => {
      partySearchSilent = false;
    }, 0);
  }

  function formatRegime(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'mei') return 'MEI';
    if (normalized === 'simples') return 'Simples Nacional';
    if (normalized === 'normal') return 'Regime Normal';
    return value || '';
  }

  async function fetchCustomerList(query) {
    const trimmed = normalizeString(query);
    if (!trimmed) return [];
    const url =
      `${API_BASE}/func/clientes/buscar?q=` + encodeURIComponent(trimmed) + `&limit=${CUSTOMER_SEARCH_LIMIT}`;
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) {
      throw new Error('Nao foi possivel buscar clientes.');
    }
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload : [];
  }

  async function fetchCustomerDetails(customerId) {
    if (!customerId) return null;
    const response = await fetch(`${API_BASE}/func/clientes/${customerId}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error('Nao foi possivel carregar o cliente.');
    }
    return response.json();
  }

  async function fetchCustomerByCode(code) {
    const normalized = normalizeDigits(code);
    if (!normalized) return null;
    const list = await fetchCustomerList(normalized);
    return list.find((customer) => matchCode(normalized, resolveCustomerCode(customer))) || null;
  }

  async function fetchSuppliers({ force = false } = {}) {
    const cacheAge = Date.now() - supplierCacheFetchedAt;
    if (!force && supplierCache && cacheAge < SUPPLIER_CACHE_TTL_MS) {
      return supplierCache;
    }
    const response = await fetch(`${API_BASE}/suppliers`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('Nao foi possivel carregar fornecedores.');
    }
    const payload = await response.json().catch(() => ({}));
    const suppliers = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.suppliers)
        ? payload.suppliers
        : [];
    supplierCache = suppliers;
    supplierCacheFetchedAt = Date.now();
    return suppliers;
  }

  function findSupplierByCode(code, suppliers = []) {
    const normalized = normalizeDigits(code);
    if (!normalized) return null;
    return suppliers.find((supplier) => matchCode(normalized, resolveSupplierCode(supplier))) || null;
  }

  function applyCustomerSelection(customer, details) {
    if (!customer && !details) return;
    const source = details || customer;
    const name = resolveCustomerName(source);
    const docRaw = resolveCustomerDocument(source);
    const docDigits = normalizeDigits(docRaw);
    const ieValue = source.inscricaoEstadual || source.estadoIE || '';
    selectedPartyIsentoIE = Boolean(source?.isentoIE) || /^isento$/i.test(String(ieValue || '').trim());

    if (clientFields.name) clientFields.name.value = name;
    if (clientFields.doc) clientFields.doc.value = docDigits || docRaw || '';
    if (clientFields.phone) clientFields.phone.value = resolvePartyPhone(source);
    if (clientFields.ie) clientFields.ie.value = ieValue || '';
    const addressParts = extractPartyAddressParts(source);
    if (Object.keys(addressParts).length) {
      setClientAddressFields(addressParts);
    } else if (clientFields.address) {
      clientFields.address.value = resolvePartyAddress(source);
    }
    updateConsumerFinalFromDoc();

    const codeValue = resolveCustomerCode(customer || source);
    setPartySearchValue(codeValue || name);
    validateDocument();
  }

  function applyChequeCustomerSelection(customer, details) {
    if (!customer && !details) return;
    const source = details || customer;
    const name = resolveCustomerName(source);
    const docRaw = resolveCustomerDocument(source);
    const docDigits = normalizeDigits(docRaw);
    const docType = docDigits.length === 11 ? 'fisico' : docDigits.length === 14 ? 'juridico' : '';

    if (chequeFields.holder) chequeFields.holder.value = name || '';
    if (chequeFields.cpf) chequeFields.cpf.value = docDigits || docRaw || '';
    if (chequeFields.phone) chequeFields.phone.value = resolvePartyPhone(source);
    if (chequeFields.address) chequeFields.address.value = resolvePartyAddress(source);
    if (chequeFields.holderType && docType) chequeFields.holderType.value = docType;

    const codeValue = resolveCustomerCode(customer || source);
    if (chequeFields.client) {
      chequeFields.client.value = codeValue || name || '';
    }
  }

  function closeChequeSearchModal() {
    const modal = document.getElementById('info-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    chequeModalOpen = false;
    chequeModalState = null;
    if (chequeModalObserver) {
      chequeModalObserver.disconnect();
      chequeModalObserver = null;
    }
  }

  function observeChequeModalClose() {
    const modal = document.getElementById('info-modal');
    if (!modal || chequeModalObserver) return;
    chequeModalObserver = new MutationObserver(() => {
      if (modal.classList.contains('hidden')) {
        chequeModalOpen = false;
        chequeModalState = null;
        chequeModalObserver?.disconnect();
        chequeModalObserver = null;
      }
    });
    chequeModalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function renderChequeModalResults() {
    if (!chequeModalState) return;
    const { results, list, empty, query, loading, error } = chequeModalState;
    if (!list || !empty) return;
    list.innerHTML = '';
    empty.textContent = '';

    if (loading) {
      empty.textContent = 'Carregando resultados...';
      return;
    }

    if (error) {
      empty.textContent = error;
      return;
    }

    if (!query) {
      empty.textContent = 'Digite para buscar.';
      return;
    }

    if (!results.length) {
      empty.textContent = `Nenhum cliente encontrado para \"${query}\".`;
      return;
    }

    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.chequeIndex = String(index);
      button.className =
        'flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary/5';
      const name = resolveCustomerName(item);
      const code = item.codigo || item.codigoCliente || item.codigo_cliente || '';
      const doc = resolveCustomerDocument(item);
      button.innerHTML = `
        <div class="flex flex-col">
          <span class="font-semibold text-gray-800">${name || 'Sem nome'}</span>
          <span class="text-xs text-gray-500">${code ? `Codigo: ${code}` : 'Codigo nao informado'}</span>
          <span class="text-[11px] text-gray-400">${doc ? `Doc: ${doc}` : ''}</span>
        </div>
        <span class="text-[11px] font-semibold text-primary">Selecionar</span>
      `;
      list.appendChild(button);
    });
  }

  async function loadChequeModalResults(query) {
    if (!chequeModalState) return;
    chequeModalState.loading = true;
    chequeModalState.error = '';
    chequeModalState.query = query;
    renderChequeModalResults();
    try {
      chequeModalState.results = await fetchCustomerList(query);
    } catch (error) {
      chequeModalState.error = error?.message || 'Nao foi possivel buscar clientes.';
      chequeModalState.results = [];
    } finally {
      chequeModalState.loading = false;
      renderChequeModalResults();
    }
  }

  async function openChequeSearchModal(query) {
    if (typeof showModal !== 'function') {
      if (typeof showToast === 'function') {
        showToast('Modal de busca indisponivel.', 'warning');
      }
      return;
    }

    if (chequeModalOpen && chequeModalState) {
      chequeModalState.query = query;
      if (chequeModalState.input) {
        chequeModalState.input.value = query || '';
      }
      loadChequeModalResults(query);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'text-left space-y-3';
    wrapper.innerHTML = `
      <div class="space-y-1">
        <label class="block text-xs font-semibold text-gray-500">Buscar cliente</label>
        <input id="nfe-cheque-modal-search" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      <div id="nfe-cheque-modal-results" class="space-y-2 overflow-y-auto pr-1"></div>
      <p id="nfe-cheque-modal-empty" class="text-xs text-gray-500"></p>
    `;

    chequeModalState = {
      wrapper,
      input: wrapper.querySelector('#nfe-cheque-modal-search'),
      list: wrapper.querySelector('#nfe-cheque-modal-results'),
      empty: wrapper.querySelector('#nfe-cheque-modal-empty'),
      results: [],
      query,
      loading: false,
      error: '',
    };
    if (chequeModalState.list) {
      chequeModalState.list.style.maxHeight = '45vh';
      chequeModalState.list.style.overflowY = 'auto';
    }

    showModal({
      message: wrapper,
      confirmText: 'Fechar',
      onConfirm: () => {
        closeChequeSearchModal();
        return true;
      },
    });

    chequeModalOpen = true;
    observeChequeModalClose();

    if (chequeModalState.input) {
      chequeModalState.input.value = query || '';
      chequeModalState.input.addEventListener('input', (event) => {
        const nextQuery = normalizeString(event.target.value);
        loadChequeModalResults(nextQuery);
      });
    }

    chequeModalState.list?.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-cheque-index]');
      if (!target) return;
      const index = Number(target.dataset.chequeIndex || '-1');
      const selected = chequeModalState?.results?.[index];
      if (!selected) return;
      try {
        const details = await fetchCustomerDetails(selected._id || selected.id);
        applyChequeCustomerSelection(selected, details);
      } catch (error) {
        applyChequeCustomerSelection(selected, null);
      }
      closeChequeSearchModal();
    });

    loadChequeModalResults(query);
  }

  async function searchChequeCustomerByCode(rawCode) {
    const code = normalizeDigits(rawCode);
    if (!code) return;
    try {
      const customer = await fetchCustomerByCode(code);
      if (!customer) {
        if (typeof showToast === 'function') {
          showToast('Cliente nao encontrado para o codigo informado.', 'warning');
        }
        return;
      }
      let details = null;
      try {
        details = await fetchCustomerDetails(customer._id || customer.id);
      } catch (error) {
        details = null;
      }
      applyChequeCustomerSelection(customer, details);
    } catch (error) {
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao buscar cliente.', 'error');
      }
    }
  }

  function handleChequeClientInput(event) {
    if (!chequeFields.client) return;
    const raw = event?.target?.value || '';
    const trimmed = normalizeString(raw);
    if (!trimmed) return;

    if (hasLetters(trimmed)) {
      if (chequeSearchTimeout) {
        clearTimeout(chequeSearchTimeout);
        chequeSearchTimeout = null;
      }
      openChequeSearchModal(trimmed);
      return;
    }

    const code = normalizeDigits(trimmed);
    if (!code) return;
    if (chequeSearchTimeout) clearTimeout(chequeSearchTimeout);
    chequeSearchTimeout = setTimeout(() => {
      searchChequeCustomerByCode(code);
    }, 400);
  }

  function handleChequeClientBlur() {
    if (chequeSearchTimeout) {
      clearTimeout(chequeSearchTimeout);
      chequeSearchTimeout = null;
    }
    const value = chequeFields.client?.value || '';
    if (!value) return;
    if (hasLetters(value)) return;
    searchChequeCustomerByCode(value);
  }

  function handleChequeClientKeyDown(event) {
    if (event.key !== 'Enter') return;
    const value = chequeFields.client?.value || '';
    const trimmed = normalizeString(value);
    if (!trimmed) return;
    if (hasLetters(trimmed)) {
      openChequeSearchModal(trimmed);
      return;
    }
    searchChequeCustomerByCode(trimmed);
  }

  function resetChequeFields() {
    Object.values(chequeFields).forEach((field) => {
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)) return;
      if (field.type === 'checkbox' || field.type === 'radio') {
        field.checked = false;
        return;
      }
      field.value = '';
    });
    if (chequeFields.value) chequeFields.value.value = '0,00';
  }

  function setChequeEmptyState(visible) {
    if (!chequeFields.table || !chequeFields.empty) return;
    chequeFields.empty.classList.toggle('hidden', !visible);
    if (visible) {
      chequeFields.table.innerHTML = '';
      chequeFields.table.appendChild(chequeFields.empty);
    }
  }

  function setCardEmptyState(visible) {
    if (!cardFields.table || !cardFields.empty) return;
    cardFields.empty.classList.toggle('hidden', !visible);
    if (visible) {
      cardFields.table.innerHTML = '';
      cardFields.table.appendChild(cardFields.empty);
    }
  }

  function setCashEmptyState(visible) {
    if (!cashFields.table || !cashFields.empty) return;
    cashFields.empty.classList.toggle('hidden', !visible);
    if (visible) {
      cashFields.table.innerHTML = '';
      cashFields.table.appendChild(cashFields.empty);
    }
  }

  function setPixEmptyState(visible) {
    if (!pixFields.table || !pixFields.empty) return;
    pixFields.empty.classList.toggle('hidden', !visible);
    if (visible) {
      pixFields.table.innerHTML = '';
      pixFields.table.appendChild(pixFields.empty);
    }
  }

  function setOtherEmptyState(visible) {
    if (!otherFields.table || !otherFields.empty) return;
    otherFields.empty.classList.toggle('hidden', !visible);
    if (visible) {
      otherFields.table.innerHTML = '';
      otherFields.table.appendChild(otherFields.empty);
    }
  }

  function renderCardRow(payload) {
    if (!cardFields.table) return;
    if (cardFields.empty) cardFields.empty.classList.add('hidden');
    const row = document.createElement('tr');
    row.dataset.cardRow = 'true';
    row.innerHTML = `
      <td class="px-4 py-3"><input type="text" class="w-56 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.method}"></td>
      <td class="px-4 py-3"><input type="text" data-card-value class="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-right" value="${payload.value}"></td>
      <td class="px-4 py-3">
        <button type="button" class="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50" data-card-action="remove">
          <i class="fas fa-trash"></i>
          Remover
        </button>
      </td>
    `;
    cardFields.table.appendChild(row);
    applyMaskToPaymentRow(row, 'card');
  }

  function renderCashRow(payload) {
    if (!cashFields.table) return;
    if (cashFields.empty) cashFields.empty.classList.add('hidden');
    const row = document.createElement('tr');
    row.dataset.cashRow = 'true';
    row.innerHTML = `
      <td class="px-4 py-3"><input type="text" data-cash-value class="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-right" value="${payload.value}"></td>
      <td class="px-4 py-3">
        <button type="button" class="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50" data-cash-action="remove">
          <i class="fas fa-trash"></i>
          Remover
        </button>
      </td>
    `;
    cashFields.table.appendChild(row);
    applyMaskToPaymentRow(row, 'cash');
  }

  function renderPixRow(payload) {
    if (!pixFields.table) return;
    if (pixFields.empty) pixFields.empty.classList.add('hidden');
    const row = document.createElement('tr');
    row.dataset.pixRow = 'true';
    row.innerHTML = `
      <td class="px-4 py-3"><input type="text" data-pix-value class="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-right" value="${payload.value}"></td>
      <td class="px-4 py-3">
        <button type="button" class="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50" data-pix-action="remove">
          <i class="fas fa-trash"></i>
          Remover
        </button>
      </td>
    `;
    pixFields.table.appendChild(row);
    applyMaskToPaymentRow(row, 'pix');
  }

  function renderOtherRow(payload) {
    if (!otherFields.table) return;
    if (otherFields.empty) otherFields.empty.classList.add('hidden');
    const row = document.createElement('tr');
    row.dataset.otherRow = 'true';
    row.innerHTML = `
      <td class="px-4 py-3"><input type="text" class="w-56 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.method}"></td>
      <td class="px-4 py-3"><input type="text" data-other-value class="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-right" value="${payload.value}"></td>
      <td class="px-4 py-3">
        <button type="button" class="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50" data-other-action="remove">
          <i class="fas fa-trash"></i>
          Remover
        </button>
      </td>
    `;
    otherFields.table.appendChild(row);
    applyMaskToPaymentRow(row, 'other');
  }

  function renderChequeRow(payload) {
    if (!chequeFields.table) return;
    if (chequeFields.empty) chequeFields.empty.classList.add('hidden');
    const row = document.createElement('tr');
    row.dataset.chequeRow = 'true';
    row.innerHTML = `
      <td class="px-4 py-3"><input type="date" class="w-36 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.date}"></td>
      <td class="px-4 py-3"><input type="text" data-cheque-value class="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-right" value="${payload.value}"></td>
      <td class="px-4 py-3"><input type="text" class="w-28 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.bank}"></td>
      <td class="px-4 py-3"><input type="text" class="w-24 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.account}"></td>
      <td class="px-4 py-3"><input type="text" class="w-20 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.agency}"></td>
      <td class="px-4 py-3"><input type="text" class="w-20 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.number}"></td>
      <td class="px-4 py-3"><input type="text" class="w-28 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.client}"></td>
      <td class="px-4 py-3"><input type="text" class="w-32 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.holder}"></td>
      <td class="px-4 py-3">
        <select class="w-24 rounded border border-gray-200 px-2 py-1 text-xs">
          <option value="">Selecione</option>
          <option value="fisico" ${payload.holderType === 'fisico' ? 'selected' : ''}>Fisico</option>
          <option value="juridico" ${payload.holderType === 'juridico' ? 'selected' : ''}>Juridico</option>
        </select>
      </td>
      <td class="px-4 py-3"><input type="text" class="w-28 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.cpf}"></td>
      <td class="px-4 py-3"><input type="text" class="w-28 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.phone}"></td>
      <td class="px-4 py-3"><input type="text" class="w-48 rounded border border-gray-200 px-2 py-1 text-xs" value="${payload.address}"></td>
      <td class="px-4 py-3">
        <button type="button" class="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50" data-cheque-action="remove">
          <i class="fas fa-trash"></i>
          Remover
        </button>
      </td>
    `;
    chequeFields.table.appendChild(row);
    applyMaskToPaymentRow(row, 'cheque');
  }

  function handleChequeAdd() {
    if (!chequeFields.date) return;
    const payload = {
      date: chequeFields.date.value || '',
      value: chequeFields.value?.value || '0,00',
      bank: chequeFields.bank?.value || '',
      account: chequeFields.account?.value || '',
      agency: chequeFields.agency?.value || '',
      number: chequeFields.number?.value || '',
      client: chequeFields.client?.value || '',
      holder: chequeFields.holder?.value || '',
      holderType: chequeFields.holderType?.value || '',
      cpf: chequeFields.cpf?.value || '',
      phone: chequeFields.phone?.value || '',
      address: chequeFields.address?.value || '',
    };

    renderChequeRow(payload);
    updatePaymentKpis();
  }

  function handleChequeTableBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'text' || !input.hasAttribute('data-cheque-value')) return;
    formatMoneyInput(input);
  }

  function handleChequeTableClick(event) {
    const button = event.target.closest('[data-cheque-action="remove"]');
    if (!button) return;
    const row = button.closest('tr[data-cheque-row]');
    if (row) row.remove();
    if (!chequeFields.table?.querySelector('tr[data-cheque-row]')) {
      setChequeEmptyState(true);
    }
    updatePaymentKpis();
  }

  function handleCardAdd() {
    if (!cardFields.method) return;
    const selectedId = cardFields.method.value || '';
    const method = cardFields.methods.find((item) => String(item._id || item.id) === String(selectedId));
    const payload = {
      method: method ? buildPaymentMethodLabel(method) : '',
      value: cardFields.value?.value || '0,00',
    };

    if (!payload.method) {
      if (typeof showToast === 'function') {
        showToast('Selecione um cartao antes de adicionar.', 'warning');
      }
      return;
    }

    renderCardRow(payload);
    updatePaymentKpis();
  }

  function resetCardFields() {
    if (cardFields.method) cardFields.method.value = '';
    if (cardFields.value) cardFields.value.value = '0,00';
  }

  function handleCashAdd() {
    if (!cashFields.value) return;
    const payload = { value: cashFields.value.value || '0,00' };
    renderCashRow(payload);
    updatePaymentKpis();
  }

  function resetCashFields() {
    if (cashFields.value) cashFields.value.value = '0,00';
  }

  function handlePixAdd() {
    if (!pixFields.value) return;
    const payload = { value: pixFields.value.value || '0,00' };
    renderPixRow(payload);
    updatePaymentKpis();
  }

  function resetPixFields() {
    if (pixFields.value) pixFields.value.value = '0,00';
  }

  function handleOtherAdd() {
    if (!otherFields.method) return;
    const option = otherFields.method.selectedOptions?.[0];
    const label = option?.textContent?.trim() || '';
    if (!label || !otherFields.method.value) {
      if (typeof showToast === 'function') {
        showToast('Selecione o meio de pagamento antes de adicionar.', 'warning');
      }
      return;
    }
    const payload = {
      method: label,
      value: otherFields.value?.value || '0,00',
    };
    renderOtherRow(payload);
    updatePaymentKpis();
  }

  function resetOtherFields() {
    if (otherFields.method) otherFields.method.value = '';
    if (otherFields.value) otherFields.value.value = '0,00';
  }

  function handleCardTableBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'text' || !input.hasAttribute('data-card-value')) return;
    formatMoneyInput(input);
  }

  function handleCardTableClick(event) {
    const button = event.target.closest('[data-card-action="remove"]');
    if (!button) return;
    const row = button.closest('tr[data-card-row]');
    if (row) row.remove();
    if (!cardFields.table?.querySelector('tr[data-card-row]')) {
      setCardEmptyState(true);
    }
    updatePaymentKpis();
  }

  function handleCashTableBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'text' || !input.hasAttribute('data-cash-value')) return;
    formatMoneyInput(input);
  }

  function handleCashTableClick(event) {
    const button = event.target.closest('[data-cash-action="remove"]');
    if (!button) return;
    const row = button.closest('tr[data-cash-row]');
    if (row) row.remove();
    if (!cashFields.table?.querySelector('tr[data-cash-row]')) {
      setCashEmptyState(true);
    }
    updatePaymentKpis();
  }

  function handlePixTableBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'text' || !input.hasAttribute('data-pix-value')) return;
    formatMoneyInput(input);
  }

  function handlePixTableClick(event) {
    const button = event.target.closest('[data-pix-action="remove"]');
    if (!button) return;
    const row = button.closest('tr[data-pix-row]');
    if (row) row.remove();
    if (!pixFields.table?.querySelector('tr[data-pix-row]')) {
      setPixEmptyState(true);
    }
    updatePaymentKpis();
  }

  function handleOtherTableBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'text' || !input.hasAttribute('data-other-value')) return;
    formatMoneyInput(input);
  }

  function handleOtherTableClick(event) {
    const button = event.target.closest('[data-other-action="remove"]');
    if (!button) return;
    const row = button.closest('tr[data-other-row]');
    if (row) row.remove();
    if (!otherFields.table?.querySelector('tr[data-other-row]')) {
      setOtherEmptyState(true);
    }
    updatePaymentKpis();
  }


  function applySupplierSelection(supplier) {
    if (!supplier) return;
    const name = resolveSupplierName(supplier);
    const docRaw = resolveSupplierDocument(supplier);
    const docDigits = normalizeDigits(docRaw);
    const ieValue = supplier.stateRegistration || '';
    selectedPartyIsentoIE = Boolean(supplier?.isentoIE) || /^isento$/i.test(String(ieValue || '').trim());

    if (clientFields.name) clientFields.name.value = name;
    if (clientFields.doc) clientFields.doc.value = docDigits || docRaw || '';
    if (clientFields.phone) clientFields.phone.value = resolvePartyPhone(supplier);
    if (clientFields.ie) clientFields.ie.value = ieValue || '';
    const addressParts = extractPartyAddressParts(supplier);
    if (Object.keys(addressParts).length) {
      setClientAddressFields(addressParts);
    } else if (clientFields.address) {
      clientFields.address.value = resolvePartyAddress(supplier);
    }
    updateConsumerFinalFromDoc();

    const codeValue = supplier.code || supplier.codeNumber || '';
    setPartySearchValue(codeValue || name);
    validateDocument();
  }

  function closePartySearchModal() {
    const modal = document.getElementById('info-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    partyModalOpen = false;
    partyModalState = null;
    if (partyModalObserver) {
      partyModalObserver.disconnect();
      partyModalObserver = null;
    }
  }

  function observePartyModalClose() {
    const modal = document.getElementById('info-modal');
    if (!modal || partyModalObserver) return;
    partyModalObserver = new MutationObserver(() => {
      if (modal.classList.contains('hidden')) {
        partyModalOpen = false;
        partyModalState = null;
        partyModalObserver?.disconnect();
        partyModalObserver = null;
      }
    });
    partyModalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function renderPartyModalResults() {
    if (!partyModalState) return;
    const { results, list, empty, type, query, loading, error } = partyModalState;
    if (!list || !empty) return;
    list.innerHTML = '';
    empty.textContent = '';

    if (loading) {
      empty.textContent = 'Carregando resultados...';
      return;
    }

    if (error) {
      empty.textContent = error;
      return;
    }

    if (!query) {
      empty.textContent = 'Digite para buscar.';
      return;
    }

    if (!results.length) {
      empty.textContent =
        type === PARTY_TYPES.supplier
          ? `Nenhum fornecedor encontrado para "${query}".`
          : `Nenhum cliente encontrado para "${query}".`;
      return;
    }

    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.partyIndex = String(index);
      button.className =
        'flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary/5';
      const name =
        type === PARTY_TYPES.supplier ? resolveSupplierName(item) : resolveCustomerName(item);
      const code =
        type === PARTY_TYPES.supplier
          ? item.code || item.codeNumber || ''
          : item.codigo || item.codigoCliente || item.codigo_cliente || '';
      const doc =
        type === PARTY_TYPES.supplier ? resolveSupplierDocument(item) : resolveCustomerDocument(item);
      button.innerHTML = `
        <div class="flex flex-col">
          <span class="font-semibold text-gray-800">${name || 'Sem nome'}</span>
          <span class="text-xs text-gray-500">${code ? `Codigo: ${code}` : 'Codigo nao informado'}</span>
          <span class="text-[11px] text-gray-400">${doc ? `Doc: ${doc}` : ''}</span>
        </div>
        <span class="text-[11px] font-semibold text-primary">Selecionar</span>
      `;
      list.appendChild(button);
    });
  }

  async function loadPartyModalResults(query, type) {
    if (!partyModalState) return;
    partyModalState.loading = true;
    partyModalState.error = '';
    partyModalState.query = query;
    renderPartyModalResults();
    try {
      if (type === PARTY_TYPES.supplier) {
        const suppliers = await fetchSuppliers();
        const normalized = normalizeKeyword(query);
        partyModalState.results = suppliers.filter((supplier) => {
          const name = normalizeKeyword(resolveSupplierName(supplier));
          return normalized && name.includes(normalized);
        });
      } else {
        const customers = await fetchCustomerList(query);
        partyModalState.results = customers;
      }
    } catch (error) {
      partyModalState.error = error?.message || 'Nao foi possivel buscar registros.';
      partyModalState.results = [];
    } finally {
      partyModalState.loading = false;
      renderPartyModalResults();
    }
  }

  async function openPartySearchModal(query, type) {
    if (typeof showModal !== 'function') {
      if (typeof showToast === 'function') {
        showToast('Modal de busca indisponivel.', 'warning');
      }
      return;
    }

    if (partyModalOpen && partyModalState) {
      partyModalState.type = type;
      partyModalState.query = query;
      if (partyModalState.input) {
        partyModalState.input.value = query || '';
      }
      loadPartyModalResults(query, type);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'text-left flex flex-col gap-3';
    wrapper.style.maxHeight = '70vh';
    wrapper.style.overflow = 'hidden';
    wrapper.innerHTML = `
      <div class="space-y-1">
        <label class="block text-xs font-semibold text-gray-500">Buscar ${type}</label>
        <input id="nfe-party-modal-search" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      <div id="nfe-party-modal-results" class="space-y-2 overflow-y-auto pr-1"></div>
      <p id="nfe-party-modal-empty" class="text-xs text-gray-500"></p>
    `;

    partyModalState = {
      wrapper,
      input: wrapper.querySelector('#nfe-party-modal-search'),
      list: wrapper.querySelector('#nfe-party-modal-results'),
      empty: wrapper.querySelector('#nfe-party-modal-empty'),
      results: [],
      type,
      query,
      loading: false,
      error: '',
    };
    if (partyModalState.list) {
      partyModalState.list.style.maxHeight = '45vh';
      partyModalState.list.style.overflowY = 'auto';
    }

    showModal({
      message: wrapper,
      confirmText: 'Fechar',
      onConfirm: () => {
        closePartySearchModal();
        return true;
      },
    });

    partyModalOpen = true;
    observePartyModalClose();

    if (partyModalState.input) {
      partyModalState.input.value = query || '';
      partyModalState.input.addEventListener('input', (event) => {
        const nextQuery = normalizeString(event.target.value);
        loadPartyModalResults(nextQuery, partyModalState.type);
      });
    }

    partyModalState.list?.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-party-index]');
      if (!target) return;
      const index = Number(target.dataset.partyIndex || '-1');
      const selected = partyModalState?.results?.[index];
      if (!selected) return;
      if (partyModalState.type === PARTY_TYPES.supplier) {
        applySupplierSelection(selected);
        closePartySearchModal();
        return;
      }
      try {
        const details = await fetchCustomerDetails(selected._id || selected.id);
        applyCustomerSelection(selected, details);
      } catch (error) {
        applyCustomerSelection(selected, null);
      }
      closePartySearchModal();
    });

    loadPartyModalResults(query, type);
  }

  async function searchPartyByCode(rawCode) {
    const code = normalizeDigits(rawCode);
    if (!code) return;
    const type = getPartyType();
    if (type === PARTY_TYPES.supplier) {
      try {
        const suppliers = await fetchSuppliers();
        const supplier = findSupplierByCode(code, suppliers);
        if (supplier) {
          applySupplierSelection(supplier);
        } else if (typeof showToast === 'function') {
          showToast('Fornecedor nao encontrado para o codigo informado.', 'warning');
        }
      } catch (error) {
        if (typeof showToast === 'function') {
          showToast(error?.message || 'Erro ao buscar fornecedor.', 'error');
        }
      }
      return;
    }

    try {
      const customer = await fetchCustomerByCode(code);
      if (!customer) {
        if (typeof showToast === 'function') {
          showToast('Cliente nao encontrado para o codigo informado.', 'warning');
        }
        return;
      }
      let details = null;
      try {
        details = await fetchCustomerDetails(customer._id || customer.id);
      } catch (error) {
        details = null;
      }
      applyCustomerSelection(customer, details);
    } catch (error) {
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao buscar cliente.', 'error');
      }
    }
  }

  function updatePartySearchPlaceholder() {
    if (!partySearchInput) return;
    const type = getPartyType();
    partySearchInput.placeholder =
      type === PARTY_TYPES.supplier ? 'Buscar codigo do fornecedor ou nome' : 'Buscar codigo do cliente ou nome';
  }

  function handlePartySearchInput(event) {
    if (!partySearchInput || partySearchSilent) return;
    const raw = event?.target?.value || '';
    const trimmed = normalizeString(raw);
    if (!trimmed) return;

    if (hasLetters(trimmed)) {
      if (partySearchTimeout) {
        clearTimeout(partySearchTimeout);
        partySearchTimeout = null;
      }
      openPartySearchModal(trimmed, getPartyType());
      return;
    }

    const code = normalizeDigits(trimmed);
    if (!code) return;
    if (partySearchTimeout) clearTimeout(partySearchTimeout);
    partySearchTimeout = setTimeout(() => {
      searchPartyByCode(code);
    }, 400);
  }

  function handlePartySearchBlur() {
    if (partySearchTimeout) {
      clearTimeout(partySearchTimeout);
      partySearchTimeout = null;
    }
    const value = partySearchInput?.value || '';
    if (!value) return;
    if (hasLetters(value)) return;
    searchPartyByCode(value);
  }

  function handlePartySearchKeyDown(event) {
    if (event.key !== 'Enter') return;
    const value = partySearchInput?.value || '';
    const trimmed = normalizeString(value);
    if (!trimmed) return;
    if (hasLetters(trimmed)) {
      openPartySearchModal(trimmed, getPartyType());
      return;
    }
    searchPartyByCode(trimmed);
  }

  function handlePartyTypeChange() {
    updatePartySearchPlaceholder();
    const value = partySearchInput?.value || '';
    if (!value) return;
    if (hasLetters(value)) {
      openPartySearchModal(normalizeString(value), getPartyType());
      return;
    }
    searchPartyByCode(value);
  }

  function setDepositSelectMessage(message, disabled = true) {
    if (!stockDepositSelect) return;
    stockDepositSelect.innerHTML = `<option value="">${message}</option>`;
    stockDepositSelect.disabled = disabled;
  }

  function setCrediarioSelectMessage(select, message, disabled = true) {
    if (!select) return;
    select.innerHTML = `<option value="">${message}</option>`;
    select.disabled = disabled;
  }

  function setCardSelectMessage(message, disabled = true) {
    if (!cardFields.method) return;
    cardFields.method.innerHTML = `<option value="">${message}</option>`;
    cardFields.method.disabled = disabled;
  }

  function setCrediarioEmptyState(visible) {
    if (!crediarioFields.table || !crediarioFields.empty) return;
    crediarioFields.empty.classList.toggle('hidden', !visible);
    if (visible) {
      crediarioFields.table.innerHTML = '';
      crediarioFields.table.appendChild(crediarioFields.empty);
    }
  }

  function addMonthsToDate(base, months) {
    const date = new Date(base.getTime());
    const day = date.getDate();
    date.setMonth(date.getMonth() + months);
    if (date.getDate() < day) {
      date.setDate(0);
    }
    return date;
  }

  function formatDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function parseDateInput(value) {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function renderCrediarioRows(rows) {
    if (!crediarioFields.table) return;
    if (!rows.length) {
      setCrediarioEmptyState(true);
      return;
    }

    crediarioFields.table.innerHTML = rows
      .map((row) => `
        <tr data-crediario-row>
          <td class="px-4 py-3 text-gray-700">${row.index}</td>
          <td class="px-4 py-3">
            <input type="date" class="w-40 rounded border border-gray-200 px-2 py-1 text-xs" value="${row.due}">
          </td>
          <td class="px-4 py-3">
            <input type="text" class="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-right" value="${row.value}">
          </td>
          <td class="px-4 py-3">
            <button type="button" class="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50" data-crediario-action="remove">
              <i class="fas fa-trash"></i>
              Remover
            </button>
          </td>
        </tr>
      `)
      .join('');
  }

  function handleCrediarioGenerate() {
    if (!crediarioFields.installments || !crediarioFields.value || !crediarioFields.due) return;
    const total = parseNumber(crediarioFields.value.value);
    const count = Math.max(1, parseInt(crediarioFields.installments.value || '1', 10));
    const firstDue = parseDateInput(crediarioFields.due.value);

    if (!firstDue) {
      if (typeof showToast === 'function') {
        showToast('Informe o vencimento inicial para gerar as parcelas.', 'warning');
      }
      return;
    }

    const per = count > 0 ? Math.floor((total / count) * 100) / 100 : 0;
    const rows = [];
    let allocated = 0;

    for (let i = 0; i < count; i += 1) {
      const value = i === count - 1 ? total - allocated : per;
      allocated += i === count - 1 ? value : per;
      const dueDate = addMonthsToDate(firstDue, i);
      rows.push({
        index: i + 1,
        due: formatDateInputValue(dueDate),
        value: value.toFixed(2).replace('.', ','),
      });
    }

    renderCrediarioRows(rows);
    updatePaymentKpis();
  }

  function resetCrediarioRows() {
    setCrediarioEmptyState(true);
    updatePaymentKpis();
  }

  function handleCrediarioTableBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'text') return;
    formatMoneyInput(input);
    updatePaymentKpis();
  }

  function handleCrediarioTableClick(event) {
    const button = event.target.closest('[data-crediario-action="remove"]');
    if (!button) return;
    const row = button.closest('tr[data-crediario-row]');
    if (row) row.remove();
    if (!crediarioFields.table?.querySelector('tr[data-crediario-row]')) {
      setCrediarioEmptyState(true);
    }
    updatePaymentKpis();
  }

  async function resolveDepositCompanyId() {
    if (typeof getActiveCompanyId === 'function') {
      const active = getActiveCompanyId();
      if (active) return active;
    }
    if (typeof fetchAllowedStores !== 'function') return '';
    try {
      const stores = await fetchAllowedStores();
      const first = Array.isArray(stores) ? stores[0] : null;
      return first?._id || first?.id || '';
    } catch (error) {
      return '';
    }
  }

  async function resolvePaymentCompanyId() {
    if (typeof getActiveCompanyId === 'function') {
      const active = getActiveCompanyId();
      if (active) return active;
    }
    if (typeof fetchAllowedStores !== 'function') return '';
    try {
      const stores = await fetchAllowedStores();
      const first = Array.isArray(stores) ? stores[0] : null;
      return first?._id || first?.id || '';
    } catch (error) {
      return '';
    }
  }

  function resolveSerieParamCompanyId(param) {
    if (!param) return '';
    if (typeof param.empresa === 'object') {
      return String(param.empresa._id || param.empresa.id || param.empresa || '').trim();
    }
    return String(param.empresa || '').trim();
  }

  function buildSerieLabel(serie) {
    const serieValue = normalizeString(serie?.serie);
    const descricao = normalizeString(serie?.descricao);
    const modelo = normalizeString(serie?.modelo);
    const parts = [];
    if (serieValue) parts.push(`Serie ${serieValue}`);
    if (descricao) parts.push(descricao);
    const label = parts.length ? parts.join(' - ') : 'Serie fiscal';
    return modelo ? `${label} (Modelo ${modelo})` : label;
  }

  function clearDraftTables() {
    if (itemsBody) {
      itemsBody.innerHTML = '';
      if (itemsEmpty) itemsBody.appendChild(itemsEmpty);
    }
    if (volumesBody) {
      volumesBody.innerHTML = '';
      if (volumesEmpty) volumesBody.appendChild(volumesEmpty);
    }
    if (refBody) {
      refBody.innerHTML = '';
      if (refEmpty) refBody.appendChild(refEmpty);
    }
    setCrediarioEmptyState(true);
    setChequeEmptyState(true);
    setCardEmptyState(true);
    setCashEmptyState(true);
    setPixEmptyState(true);
    setOtherEmptyState(true);
    resetCrediarioRows();
    resetChequeFields();
    resetCardFields();
    resetCashFields();
    resetPixFields();
    resetOtherFields();
  }

  function applyDraftToForm(draft = {}) {
    const payload = draft?.payload || {};
    resetForm({ keepNumber: true });
    clearDraftTables();

    const draftId = draft?._id || draft?.id || '';
    currentDraftId = draftId ? String(draftId) : '';

    const draftCode = draft?.code ?? payload?.header?.code ?? draft?.header?.code ?? '';
    if (codeInput) codeInput.value = draftCode ? String(draftCode) : '';
    currentDraftCode = draftCode ? String(draftCode) : '';
    currentDraftMetadata = draft?.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
    currentDraftXmlAmbient = normalizeString(draft?.xml?.ambient || payload?.xml?.ambient || '');
    nfeEventEntries = normalizeNfeEventList(currentDraftMetadata?.events);

    if (numberInput) numberInput.value = payload?.header?.number || draft?.header?.number || '';
    if (serieFields.select) serieFields.select.value = payload?.header?.serie || draft?.header?.serie || '';
    if (serieFields.model) serieFields.model.value = payload?.header?.model || draft?.header?.model || '';
    if (issueDateInput) issueDateInput.value = payload?.header?.issueDate || draft?.header?.issueDate || issueDateInput.value;
    if (exitDateInput) exitDateInput.value = payload?.header?.entryDate || draft?.header?.entryDate || '';

    if (operationSelect) operationSelect.value = payload?.header?.type || draft?.header?.type || '';
    if (naturezaOperacaoSelect) naturezaOperacaoSelect.value = payload?.metadata?.naturezaOperacao || '';
    if (naturezaSelect) naturezaSelect.value = payload?.metadata?.natureza || '';
    if (finalidadeSelect) finalidadeSelect.value = payload?.metadata?.finalidade || '';
    if (serviceTypeSelect) serviceTypeSelect.value = payload?.metadata?.serviceType || serviceTypeSelect.value;
    if (stockMovementSelect) stockMovementSelect.value = payload?.metadata?.stockMovement || stockMovementSelect.value;
    if (stockDepositSelect) stockDepositSelect.value = payload?.metadata?.stockDeposit || stockDepositSelect.value;

    if (partyTypeSelect) {
      const party = payload?.metadata?.partyType || '';
      partyTypeSelect.value = party === PARTY_TYPES.supplier ? PARTY_TYPES.supplier : PARTY_TYPES.client;
    }
    updatePartySearchPlaceholder();

    if (clientFields.name) clientFields.name.value = payload?.supplier?.name || '';
    if (clientFields.doc) clientFields.doc.value = payload?.supplier?.document || '';
    if (clientFields.ie) clientFields.ie.value = payload?.supplier?.stateRegistration || '';
    selectedPartyIsentoIE =
      Boolean(payload?.supplier?.isentoIE) ||
      /^isento$/i.test(String(payload?.supplier?.stateRegistration || '').trim());
    if (clientFields.address) {
      clientFields.address.value =
        payload?.supplier?.address || payload?.supplier?.addressText || '';
    }
    if (clientFields.number) clientFields.number.value = payload?.supplier?.number || '';
    if (clientFields.complement) clientFields.complement.value = payload?.supplier?.complement || '';
    if (clientFields.neighborhood) clientFields.neighborhood.value = payload?.supplier?.neighborhood || '';
    if (clientFields.city) clientFields.city.value = payload?.supplier?.city || '';
    if (clientFields.state) clientFields.state.value = payload?.supplier?.state || '';
    if (clientFields.zip) clientFields.zip.value = payload?.supplier?.zip || '';
    if (clientFields.country) {
      clientFields.country.value = payload?.supplier?.country || clientFields.country.value;
    }

    if (extraInputs.frete) extraInputs.frete.value = formatInputValue(payload?.totals?.freight ?? 0);
    if (extraInputs.outros) extraInputs.outros.value = formatInputValue(payload?.totals?.other ?? 0);
    if (extraInputs.paymentValue) {
      extraInputs.paymentValue.value = formatInputValue(payload?.payments?.totalValue ?? 0);
    }

    if (freightModeSelect) freightModeSelect.value = payload?.transport?.mode || '';
    if (paymentDeliveryInput) paymentDeliveryInput.checked = Boolean(payload?.payments?.delivery);

    if (infoFields.contribuinte) infoFields.contribuinte.value = payload?.additionalInfo?.observation || '';
    if (infoFields.contribuinteAuto) infoFields.contribuinteAuto.value = payload?.metadata?.infoContribuinteAuto || '';
    if (infoFields.fisco) infoFields.fisco.value = payload?.additionalInfo?.complementaryFiscal || '';
    if (infoFields.microchip) infoFields.microchip.value = payload?.metadata?.infoMicrochip || '';

    if (payload?.transport?.transporter) {
      const transporter = payload.transport.transporter;
      const nameInput = document.getElementById('nfe-transportadora-nome');
      const docInput = document.getElementById('nfe-transportadora-cnpj');
      const cityInput = document.getElementById('nfe-transportadora-municipio');
      const ieInput = document.getElementById('nfe-transportadora-ie');
      const addressInput = document.getElementById('nfe-transportadora-endereco');
      const numberInputField = document.getElementById('nfe-transportadora-numero');
      const ufSelect = document.getElementById('nfe-transportadora-uf');
      if (nameInput) nameInput.value = transporter.name || '';
      if (docInput) docInput.value = transporter.document || '';
      if (cityInput) cityInput.value = transporter.city || '';
      if (ieInput) ieInput.value = transporter.stateRegistration || '';
      if (addressInput) addressInput.value = transporter.address || '';
      if (numberInputField) numberInputField.value = transporter.number || '';
      if (ufSelect) ufSelect.value = transporter.uf || '';
    }

    if (payload?.transport?.vehicle) {
      const vehicle = payload.transport.vehicle;
      const plateInput = document.getElementById('nfe-transportadora-placa');
      const ufPlateSelect = document.getElementById('nfe-transportadora-uf-placa');
      if (plateInput) plateInput.value = vehicle.plate || '';
      if (ufPlateSelect) ufPlateSelect.value = vehicle.uf || '';
    }

    if (payload?.transport?.volume) {
      if (volumeFields.identificacao) volumeFields.identificacao.value = payload.transport.volume.identificacao || '';
      if (volumeFields.especie) volumeFields.especie.value = payload.transport.volume.especie || '';
      if (volumeFields.marca) volumeFields.marca.value = payload.transport.volume.marca || '';
      if (volumeFields.quantidade) volumeFields.quantidade.value = payload.transport.volume.quantidade || '0';
      if (volumeFields.pesoBruto) volumeFields.pesoBruto.value = payload.transport.volume.pesoBruto || '0,000';
      if (volumeFields.pesoLiquido) volumeFields.pesoLiquido.value = payload.transport.volume.pesoLiquido || '0,000';
      if (volumeFields.cubagem) volumeFields.cubagem.value = payload.transport.volume.cubagem || '0,000';
    }

    const itemList = Array.isArray(payload?.items) ? payload.items : [];
    itemList.forEach((item) => addItemRow(item));

    const volumes = Array.isArray(payload?.transport?.volumes) ? payload.transport.volumes : [];
    volumes.forEach((volume) => addVolumeRow(volume));

    const refs = Array.isArray(payload?.references) ? payload.references : [];
    refs.forEach((ref) => addRefRow(ref));

    const crediario = Array.isArray(payload?.payments?.crediario) ? payload.payments.crediario : [];
    if (crediario.length) {
      renderCrediarioRows(crediario);
    }

    const cheques = Array.isArray(payload?.payments?.cheque) ? payload.payments.cheque : [];
    cheques.forEach((entry) => renderChequeRow(entry));

    const cards = Array.isArray(payload?.payments?.card) ? payload.payments.card : [];
    cards.forEach((entry) => renderCardRow(entry));

    const cashes = Array.isArray(payload?.payments?.cash) ? payload.payments.cash : [];
    cashes.forEach((entry) => renderCashRow(entry));

    const pixes = Array.isArray(payload?.payments?.pix) ? payload.payments.pix : [];
    pixes.forEach((entry) => renderPixRow(entry));

    const others = Array.isArray(payload?.payments?.other) ? payload.payments.other : [];
    others.forEach((entry) => renderOtherRow(entry));

    if (crediarioFields.bankAccount) {
      crediarioFields.bankAccount.value = payload?.selection?.bankAccountId || '';
    }
    if (crediarioFields.accountingAccount) {
      crediarioFields.accountingAccount.value = payload?.selection?.accountingAccount || '';
    }
    if (crediarioFields.due) {
      crediarioFields.due.value = payload?.selection?.duplicataEmissionDate || '';
    }

    updateTotals();
    applyItemFiltersAndSort();
    applyVolumeFiltersAndSort();
    applyRefFiltersAndSort();
    updateActionAvailability();
    updateSerieSelectDisplay(false);
    setStatus(draft?.status || 'draft', { log: false });
    renderHistoryFromMetadata(draft?.metadata || {});
  }

  async function loadDraftByCode() {
    if (!codeInput) return;
    const rawCode = getInputValue(codeInput);
    if (!rawCode) return;
    const normalized = normalizeDigits(rawCode);
    if (currentDraftCode && normalizeDigits(currentDraftCode) === normalized) return;

    const companyId = await resolvePaymentCompanyId();
    const url = companyId
      ? `${API_BASE}/nfe/drafts?companyId=${encodeURIComponent(companyId)}`
      : `${API_BASE}/nfe/drafts`;
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) {
      throw new Error('Nao foi possivel consultar os rascunhos.');
    }
    const payload = await response.json().catch(() => ({}));
    const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
    const numericCode = normalized ? Number.parseInt(normalized, 10) : null;
    const match = drafts.find((draft) => {
      if (!draft) return false;
      const draftCode = Number.isFinite(draft.code) ? Number(draft.code) : null;
      if (numericCode !== null && Number.isFinite(draftCode) && draftCode === numericCode) return true;
      const headerCode = normalizeDigits(draft.headerCode || '');
      return normalized && headerCode === normalized;
    });

    if (!match || !match.id) {
      applyDefaultState();
      currentDraftId = '';
      currentDraftCode = '';
      if (codeInput) codeInput.value = '';
      try {
        sessionStorage.setItem(INVALID_CODE_FLAG, '1');
      } catch (_) {
        // ignore storage errors
      }
      if (typeof showToast === 'function') {
        showToast('Nao ha nenhum registro com o codigo informado.', 'warning');
      }
      return;
    }

    const detailsResponse = await fetch(`${API_BASE}/nfe/drafts/${match.id}`, {
      headers: getAuthHeaders(),
    });
    if (!detailsResponse.ok) {
      throw new Error('Nao foi possivel carregar o rascunho informado.');
    }
    const details = await detailsResponse.json().catch(() => ({}));
    const draft = details?.draft || details || {};
    applyDraftToForm(draft);
    if (typeof showToast === 'function') {
      showToast('Rascunho carregado.', 'success');
    }
  }

  async function loadDraftByNumber() {
    if (!numberInput) return;
    const rawNumber = getInputValue(numberInput);
    const normalizedNumber = normalizeDigits(rawNumber);
    if (!normalizedNumber) return;

    const serieId = serieFields.select?.value || '';
    if (!serieId) return;

    const companyId = await resolvePaymentCompanyId();
    const url = companyId
      ? `${API_BASE}/nfe/drafts?companyId=${encodeURIComponent(companyId)}`
      : `${API_BASE}/nfe/drafts`;
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) {
      throw new Error('Nao foi possivel consultar os rascunhos.');
    }
    const payload = await response.json().catch(() => ({}));
    const drafts = Array.isArray(payload?.drafts) ? payload.drafts : [];
    const match = drafts.find((draft) => {
      if (!draft) return false;
      const draftNumber = normalizeDigits(draft.number || '');
      if (draftNumber !== normalizedNumber) return false;
      const draftSerie = String(draft.serie || '');
      return String(serieId) === draftSerie;
    });

    if (!match || !match.id) {
      applyDefaultState();
      currentDraftId = '';
      currentDraftCode = '';
      await refreshNextNumberFromSerie();
      if (typeof showToast === 'function') {
        showToast('Nao ha nenhuma NF-e gravada com o numero e serie informados.', 'warning');
      }
      return;
    }

    const detailsResponse = await fetch(`${API_BASE}/nfe/drafts/${match.id}`, {
      headers: getAuthHeaders(),
    });
    if (!detailsResponse.ok) {
      throw new Error('Nao foi possivel carregar a NF-e informada.');
    }
    const details = await detailsResponse.json().catch(() => ({}));
    const draft = details?.draft || details || {};
    applyDraftToForm(draft);
    if (typeof showToast === 'function') {
      showToast('NF-e carregada.', 'success');
    }
  }

  async function refreshNextNumberFromSerie() {
    if (!numberInput || !serieFields.select) return;
    const companyId = await resolvePaymentCompanyId();
    const serieId = serieFields.select.value || '';
    if (!serieId) return;
    let serie = Array.isArray(fiscalSeries)
      ? fiscalSeries.find((entry) => String(entry?._id || entry?.id || '') === String(serieId))
      : null;
    if (!serie) {
      await loadFiscalSeries();
      serie = Array.isArray(fiscalSeries)
        ? fiscalSeries.find((entry) => String(entry?._id || entry?.id || '') === String(serieId))
        : null;
    }
    if (!serie) return;
    applySerieSelection(serie, companyId);
  }

  function getSerieNumber(serie) {
    return normalizeString(serie?.serie);
  }

  function updateSerieSelectDisplay(forceFull = false) {
    if (!serieFields.select) return;
    const options = Array.from(serieFields.select.options || []);
    const selectedValue = serieFields.select.value;
    options.forEach((option) => {
      const fullLabel = option.dataset.fullLabel || option.textContent;
      const serieNumber = option.dataset.serieNumber || '';
      if (forceFull) {
        option.textContent = fullLabel;
        return;
      }
      if (option.value && option.value === selectedValue && serieNumber) {
        option.textContent = serieNumber;
      } else {
        option.textContent = fullLabel;
      }
    });
  }

  function computeNextSerieNumber(rawLast) {
    const digits = normalizeDigits(rawLast);
    const width = digits.length || 6;
    const current = Number(digits || '0');
    const next = Number.isFinite(current) ? current + 1 : 1;
    return String(next).padStart(width, '0');
  }

  async function bumpNextNumberAfterTransmit() {
    if (!numberInput) return;
    const nextNumberValue = computeNextSerieNumber(numberInput.value);
    numberInput.value = nextNumberValue;

    const companyId = await resolvePaymentCompanyId();
    const serieId = serieFields.select?.value || '';
    if (serieId && Array.isArray(fiscalSeries)) {
      const serie = fiscalSeries.find((entry) => String(entry?._id || entry?.id || '') === String(serieId));
      if (serie) {
        const parametros = Array.isArray(serie.parametros) ? serie.parametros : [];
        const param = companyId
          ? parametros.find((item) => resolveSerieParamCompanyId(item) === String(companyId))
          : parametros[0];
        if (param) {
          param.ultimaNotaEmitida = String(nextNumberValue);
        }
      }
    }

    captureDefaultState(true);
  }

  function applySerieSelection(serie, companyId) {
    if (serieFields.model) serieFields.model.value = serie?.modelo || '';
    if (!numberInput) return;
    const parametros = Array.isArray(serie?.parametros) ? serie.parametros : [];
    const param = companyId
      ? parametros.find((item) => resolveSerieParamCompanyId(item) === String(companyId))
      : parametros[0];
    numberInput.value = computeNextSerieNumber(param?.ultimaNotaEmitida);
  }

  async function loadFiscalSeries() {
    if (!serieFields.select) return;
    const companyId = await resolvePaymentCompanyId();
    serieFields.select.innerHTML = '<option value=\"\">Carregando...</option>';
    serieFields.select.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/fiscal/series`, { headers: getAuthHeaders() });
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as series fiscais.');
      }
      const payload = await response.json().catch(() => ({}));
      const list = Array.isArray(payload?.series) ? payload.series : (Array.isArray(payload) ? payload : []);
      fiscalSeries = Array.isArray(list) ? list : [];
      if (companyId) {
        fiscalSeries = fiscalSeries.filter((serie) => {
          const parametros = Array.isArray(serie?.parametros) ? serie.parametros : [];
          return parametros.some((param) => resolveSerieParamCompanyId(param) === String(companyId));
        });
      }

      if (!fiscalSeries.length) {
        serieFields.select.innerHTML = '<option value=\"\">Nenhuma serie cadastrada</option>';
        serieFields.select.disabled = true;
        if (serieFields.model) serieFields.model.value = '';
        if (numberInput) numberInput.value = '';
        captureDefaultState(true);
        return;
      }

      const previous = serieFields.select.value;
        const options = ['<option value=\"\" data-full-label=\"Selecione\">Selecione</option>'];
        fiscalSeries.forEach((serie) => {
          const id = serie?._id || serie?.id || '';
          if (!id) return;
          const label = buildSerieLabel(serie);
          const serieNumber = getSerieNumber(serie);
          options.push(
            `<option value=\"${id}\" data-full-label=\"${label}\" data-serie-number=\"${serieNumber}\">${label}</option>`,
          );
        });
        serieFields.select.innerHTML = options.join('');
        serieFields.select.disabled = false;
      if (previous && fiscalSeries.some((serie) => String(serie._id || serie.id) === String(previous))) {
        serieFields.select.value = previous;
      } else {
        serieFields.select.value = fiscalSeries[0]?._id || fiscalSeries[0]?.id || '';
      }
        const selected = fiscalSeries.find(
          (serie) => String(serie._id || serie.id) === String(serieFields.select.value)
        );
        if (selected) {
          applySerieSelection(selected, companyId);
        }
        updateSerieSelectDisplay(false);
        captureDefaultState(true);
    } catch (error) {
      console.error('nfe:series', error);
      serieFields.select.innerHTML = '<option value=\"\">Erro ao carregar series</option>';
      serieFields.select.disabled = true;
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao carregar series fiscais.', 'error');
      }
    }
  }

  function buildBankAccountLabel(account) {
    if (!account) return 'Conta corrente';
    const alias = normalizeString(account.alias);
    const bankName = normalizeString(account.bankName);
    const agency = normalizeString(account.agency);
    const number = normalizeString(account.accountNumber);
    const digit = normalizeString(account.accountDigit);
    const parts = [];
    if (alias) parts.push(alias);
    if (bankName) parts.push(bankName);
    const numberLabel = number ? `${number}${digit ? `-${digit}` : ''}` : '';
    const details = [agency ? `Ag. ${agency}` : '', numberLabel].filter(Boolean).join(' ');
    if (details) parts.push(details);
    return parts.join(' - ') || 'Conta corrente';
  }

  function buildAccountingLabel(account) {
    if (!account) return 'Conta contabil';
    const code = normalizeString(account.code);
    const name = normalizeString(account.name);
    return [code, name].filter(Boolean).join(' - ') || 'Conta contabil';
  }

  async function loadCrediarioBankAccounts() {
    if (!crediarioFields.bankAccount) return;
    const companyId = await resolvePaymentCompanyId();
    if (!companyId) {
      setCrediarioSelectMessage(crediarioFields.bankAccount, 'Selecione a empresa para listar contas.');
      return;
    }

    setCrediarioSelectMessage(crediarioFields.bankAccount, 'Carregando contas correntes...');
    try {
      const response = await fetch(
        `${API_BASE}/bank-accounts?company=${encodeURIComponent(companyId)}`,
        { headers: getAuthHeaders() }
      );
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as contas correntes.');
      }
      const payload = await response.json().catch(() => ({}));
      const accounts = Array.isArray(payload?.accounts)
        ? payload.accounts
        : Array.isArray(payload)
          ? payload
          : [];
      if (!accounts.length) {
        setCrediarioSelectMessage(crediarioFields.bankAccount, 'Nenhuma conta corrente encontrada.');
        return;
      }
      const options = ['<option value="">Selecione</option>'];
      accounts.forEach((account) => {
        const id = account?._id || account?.id;
        if (!id) return;
        options.push(`<option value="${id}">${buildBankAccountLabel(account)}</option>`);
      });
      crediarioFields.bankAccount.innerHTML = options.join('');
      crediarioFields.bankAccount.disabled = false;
    } catch (error) {
      console.error('nfe:crediario:bank', error);
      setCrediarioSelectMessage(crediarioFields.bankAccount, 'Erro ao carregar contas correntes.');
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao carregar contas correntes.', 'error');
      }
    }
  }

  async function loadCrediarioAccountingAccounts() {
    if (!crediarioFields.accountingAccount) return;
    const companyId = await resolvePaymentCompanyId();
    if (!companyId) {
      setCrediarioSelectMessage(crediarioFields.accountingAccount, 'Selecione a empresa para listar contas.');
      return;
    }

    setCrediarioSelectMessage(crediarioFields.accountingAccount, 'Carregando contas contabeis...');
    try {
      const response = await fetch(
        `${API_BASE}/accounting-accounts?company=${encodeURIComponent(companyId)}&paymentNature=contas_receber`,
        { headers: getAuthHeaders() }
      );
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as contas contabeis.');
      }
      const payload = await response.json().catch(() => ({}));
      const accounts = Array.isArray(payload?.accounts)
        ? payload.accounts
        : Array.isArray(payload)
          ? payload
          : [];
      if (!accounts.length) {
        setCrediarioSelectMessage(crediarioFields.accountingAccount, 'Nenhuma conta a receber encontrada.');
        return;
      }
      const options = ['<option value="">Selecione</option>'];
      accounts.forEach((account) => {
        const id = account?._id || account?.id;
        if (!id) return;
        options.push(`<option value="${id}">${buildAccountingLabel(account)}</option>`);
      });
      crediarioFields.accountingAccount.innerHTML = options.join('');
      crediarioFields.accountingAccount.disabled = false;
    } catch (error) {
      console.error('nfe:crediario:accounting', error);
      setCrediarioSelectMessage(crediarioFields.accountingAccount, 'Erro ao carregar contas contabeis.');
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao carregar contas contabeis.', 'error');
      }
    }
  }

  async function loadCrediarioAccounts() {
    await Promise.all([loadCrediarioBankAccounts(), loadCrediarioAccountingAccounts()]);
  }

  function buildPaymentMethodLabel(method) {
    if (!method) return 'Cartao';
    const name = normalizeString(method.name);
    const code = normalizeString(method.code);
    const type = normalizeString(method.type);
    const parts = [];
    if (code) parts.push(code);
    if (name) parts.push(name);
    if (type) {
      const label = type === 'debito' ? 'Debito' : type === 'credito' ? 'Credito' : type;
      parts.push(label);
    }
    return parts.join(' - ') || 'Cartao';
  }

  async function loadCardMethods() {
    if (!cardFields.method) return;
    const companyId = await resolvePaymentCompanyId();
    if (!companyId) {
      setCardSelectMessage('Selecione a empresa para listar cartoes.');
      return;
    }

    setCardSelectMessage('Carregando cartoes...');
    try {
      const response = await fetch(
        `${API_BASE}/payment-methods?company=${encodeURIComponent(companyId)}`,
        { headers: getAuthHeaders() }
      );
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar os cartoes.');
      }
      const payload = await response.json().catch(() => ({}));
      const methods = Array.isArray(payload?.paymentMethods)
        ? payload.paymentMethods
        : Array.isArray(payload)
          ? payload
          : [];
      cardFields.methods = methods.filter((method) => ['debito', 'credito'].includes(method?.type));
      if (!cardFields.methods.length) {
        setCardSelectMessage('Nenhum cartao encontrado.');
        return;
      }
      const options = ['<option value="">Selecione</option>'];
      cardFields.methods.forEach((method) => {
        const id = method?._id || method?.id;
        if (!id) return;
        options.push(`<option value="${id}">${buildPaymentMethodLabel(method)}</option>`);
      });
      cardFields.method.innerHTML = options.join('');
      cardFields.method.disabled = false;
    } catch (error) {
      console.error('nfe:cartao:metodos', error);
      setCardSelectMessage('Erro ao carregar cartoes.');
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao carregar cartoes.', 'error');
      }
    }
  }

  async function loadStockDeposits() {
    if (!stockDepositSelect) return;
    const companyId = await resolveDepositCompanyId();
    if (!companyId) {
      setDepositSelectMessage('Selecione a empresa para listar dep\u00f3sitos.');
      return;
    }

    setDepositSelectMessage('Carregando dep\u00f3sitos...');
    try {
      const response = await fetch(
        `${API_BASE}/deposits?empresa=${encodeURIComponent(companyId)}`,
        { headers: getAuthHeaders() }
      );
      if (!response.ok) {
        throw new Error('N\u00e3o foi poss\u00edvel carregar os dep\u00f3sitos.');
      }
      const payload = await response.json().catch(() => ({}));
      const deposits = Array.isArray(payload?.deposits)
        ? payload.deposits
        : Array.isArray(payload)
          ? payload
          : [];
      if (!deposits.length) {
        setDepositSelectMessage('Nenhum dep\u00f3sito cadastrado para esta empresa.');
        return;
      }
      const options = ['<option value="">Selecione o dep\u00f3sito</option>'];
      let firstDepositId = '';
      deposits.forEach((deposit) => {
        const id = deposit?._id || deposit?.id || '';
        if (!id) return;
        if (!firstDepositId) firstDepositId = id;
        const code = deposit?.codigo ? String(deposit.codigo).trim() : '';
        const name = deposit?.nome || deposit?.name || '';
        const label = [code, name].filter(Boolean).join(' - ') || 'Dep\u00f3sito';
        options.push(`<option value="${id}">${label}</option>`);
      });
      stockDepositSelect.innerHTML = options.join('');
      stockDepositSelect.disabled = false;
      if (firstDepositId) {
        stockDepositSelect.value = firstDepositId;
      }
    } catch (error) {
      console.error('nfe:depositos', error);
      setDepositSelectMessage('Erro ao carregar dep\u00f3sitos.');
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao carregar dep\u00f3sitos.', 'error');
      }
    }
  }

  function initTabs() {
    const buttons = Array.from(document.querySelectorAll('[data-nfe-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-nfe-panel]'));
    if (!buttons.length || !panels.length) return;

    const setActiveTab = (target) => {
      const tabId = target || buttons[0]?.dataset.nfeTab;
      if (!tabId) return;
      buttons.forEach((button) => {
        const active = button.dataset.nfeTab === tabId;
        button.classList.toggle('bg-primary', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('border-primary', active);
        button.classList.toggle('bg-white', !active);
        button.classList.toggle('text-gray-600', !active);
        button.classList.toggle('border-gray-200', !active);
        button.setAttribute('aria-selected', String(active));
      });
      panels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.nfePanel !== tabId);
      });
    };

    const defaultButton = buttons.find((button) => button.getAttribute('aria-selected') === 'true') || buttons[0];
    setActiveTab(defaultButton?.dataset.nfeTab);

    buttons.forEach((button) => {
      button.addEventListener('click', () => setActiveTab(button.dataset.nfeTab));
    });
  }

  function initPaymentTabs() {
    const buttons = Array.from(document.querySelectorAll('[data-payment-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-payment-panel]'));
    const methodSelect = document.getElementById('nfe-payment-method');
    if (!buttons.length || !panels.length) return;

    const methodMap = {
      credario: 'crediario',
      cheque: 'cheque',
      cartao: 'cartao',
      dinheiro: 'dinheiro',
      pix: 'pix',
      outras: 'outros',
    };

    const setActiveTab = (target) => {
      const tabId = target || buttons[0]?.dataset.paymentTab;
      if (!tabId) return;
      buttons.forEach((button) => {
        const active = button.dataset.paymentTab === tabId;
        button.classList.toggle('bg-primary', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('border-primary', active);
        button.classList.toggle('bg-white', !active);
        button.classList.toggle('text-gray-600', !active);
        button.classList.toggle('border-gray-200', !active);
        button.setAttribute('aria-selected', String(active));
      });
      panels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.paymentPanel !== tabId);
      });

      if (chequeFields.tableWrapper) {
        chequeFields.tableWrapper.classList.toggle('hidden', tabId !== 'cheque');
      }
      if (cardFields.tableWrapper) {
        cardFields.tableWrapper.classList.toggle('hidden', tabId !== 'cartao');
      }
      if (cashFields.tableWrapper) {
        cashFields.tableWrapper.classList.toggle('hidden', tabId !== 'dinheiro');
      }
      if (pixFields.tableWrapper) {
        pixFields.tableWrapper.classList.toggle('hidden', tabId !== 'pix');
      }
      if (otherFields.tableWrapper) {
        otherFields.tableWrapper.classList.toggle('hidden', tabId !== 'outras');
      }

      if (tabId === 'credario') {
        loadCrediarioAccounts();
      }
      if (tabId === 'cartao') {
        loadCardMethods();
      }

      const mapped = methodMap[tabId];
      if (methodSelect && mapped) {
        methodSelect.value = mapped;
      }
    };

    const defaultButton = buttons.find((button) => button.getAttribute('aria-selected') === 'true') || buttons[0];
    setActiveTab(defaultButton?.dataset.paymentTab);

    buttons.forEach((button) => {
      button.addEventListener('click', () => setActiveTab(button.dataset.paymentTab));
    });
  }

  function formatInputValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '0,00';
    return parsed.toFixed(2).replace('.', ',');
  }

  function formatQtyValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '0,000';
    return parsed.toFixed(3).replace('.', ',');
  }

  function formatRateValue(value) {
    const parsed = parseNumber(value);
    if (!Number.isFinite(parsed)) return '0';
    const asString = String(parsed);
    return asString.includes('.') ? asString.replace('.', ',') : asString;
  }

  function resolveProductFiscal(product) {
    if (!product || typeof product !== 'object') return {};
    const companyId = typeof getActiveCompanyId === 'function' ? getActiveCompanyId() : '';
    const fiscalByCompany = companyId ? product.fiscalPorEmpresa?.[companyId] || product.fiscalPorEmpresa?.[String(companyId)] : null;
    return fiscalByCompany || product.fiscal || {};
  }

  function resolveProductCfop(fiscal) {
    if (!fiscal || typeof fiscal !== 'object') return '';
    const cfop = fiscal.cfop?.nfe || fiscal.cfop?.nfce || fiscal.cfop || {};
    return (
      cfop.dentroEstado ||
      cfop.foraEstado ||
      cfop.transferencia ||
      cfop.devolucao ||
      cfop.industrializacao ||
      (typeof cfop === 'string' ? cfop : '')
    );
  }

  function resolveProductCst(fiscal) {
    if (!fiscal || typeof fiscal !== 'object') return '';
    return fiscal.csosn || fiscal.cst || '';
  }

  function normalizeCstValue(raw) {
    return normalizeDigits(raw);
  }

  function setModalFieldLocked(field, locked) {
    if (!field) return;
    const shouldLock = Boolean(locked);
    if (field.tagName === 'SELECT') {
      field.disabled = shouldLock;
    } else {
      field.readOnly = shouldLock;
    }
    field.classList.toggle('bg-gray-50', shouldLock);
    field.classList.toggle('text-gray-600', shouldLock);
  }

  function setCheckboxLocked(field, locked, checkedValue) {
    if (!field) return;
    field.disabled = Boolean(locked);
    if (locked) {
      field.checked = Boolean(checkedValue);
    }
  }

  function normalizeModalCstValue(value) {
    return normalizeCstValue(value || '');
  }

  function getIcmsRateFromCadastro() {
    const data = icmsSimplesCache?.map ? icmsSimplesCache : null;
    if (!data) return null;
    const fiscal = modalProductFiscalSnapshot || {};
    const rate = resolveIcmsSimplesValue(fiscal, data);
    return Number.isFinite(rate) ? rate : null;
  }

  function applyFiscalRules() {
    if (applyingFiscalRules) return;
    applyingFiscalRules = true;
    try {
      if (!icmsSimplesCache.map && !icmsSimplesCache.loading) {
        getIcmsSimplesDataForCompany().then(() => applyFiscalRules());
      }
      const cstValue = normalizeModalCstValue(productModalFields.icmsCst?.value);
      const totalValue = parseNumber(productModalFields.total?.value);
      const otherExpenses = parseNumber(productModalFields.otherExpenses?.value);
      const valorIpiAtual = parseNumber(productModalFields.ipiValor?.value);
      const baseTotal = totalValue + otherExpenses + valorIpiAtual;

      const simplesSemIcms = new Set(['101', '102', '103', '300', '400']);
      const icmsPermitido = new Set(['201', '202', '203', '500', '900']);
      const isSimplesSemIcms = simplesSemIcms.has(cstValue);
      const isIcmsPermitido = icmsPermitido.has(cstValue) || (!isSimplesSemIcms);

      const icmsFields = [
        productModalFields.icmsModalidade,
        productModalFields.icmsBasePercent,
        productModalFields.icmsBaseValue,
        productModalFields.icmsAliq,
        productModalFields.icmsValor,
        productModalFields.fcpAliq,
        productModalFields.fcpValor,
      ];

      if (isSimplesSemIcms) {
        if (productModalFields.icmsModalidade) {
          productModalFields.icmsModalidade.value = 'nao-aplica';
        }
        icmsFields.forEach((field) => setModalFieldLocked(field, true));
        setModalInputValue(productModalFields.icmsBasePercent, '0');
        setModalInputValue(productModalFields.icmsBaseValue, '0,00');
        setModalInputValue(productModalFields.icmsAliq, '0');
        setModalInputValue(productModalFields.icmsValor, '0,00');
        setModalInputValue(productModalFields.fcpAliq, '0');
        setModalInputValue(productModalFields.fcpValor, '0,00');
        setCheckboxLocked(productModalFields.pisExcluirIcms, true, false);
        setCheckboxLocked(productModalFields.cofinsExcluirIcms, true, false);
      } else {
        icmsFields.forEach((field) => setModalFieldLocked(field, false));
        setCheckboxLocked(productModalFields.pisExcluirIcms, false);
        setCheckboxLocked(productModalFields.cofinsExcluirIcms, false);
      }

      if (isIcmsPermitido) {
        const basePercent = parseNumber(productModalFields.icmsBasePercent?.value || '100');
        const baseValue = baseTotal * (basePercent / 100);
        setModalInputValue(productModalFields.icmsBaseValue, formatInputValue(baseValue));

        const icmsRate = getIcmsRateFromCadastro();
        if (Number.isFinite(icmsRate) && productModalFields.icmsAliq) {
          productModalFields.icmsAliq.value = formatRateValue(icmsRate);
        }
        const icmsAliq = parseNumber(productModalFields.icmsAliq?.value || 0);
        const valorIcms = baseValue * (icmsAliq / 100);
        setModalInputValue(productModalFields.icmsValor, formatInputValue(valorIcms));

        const fcpAliq = parseNumber(productModalFields.fcpAliq?.value || 0);
        const valorFcp = valorIcms > 0 ? baseValue * (fcpAliq / 100) : 0;
        setModalInputValue(productModalFields.fcpValor, formatInputValue(valorFcp));
      }

      const ipiCst = normalizeModalCstValue(productModalFields.ipiCst?.value);
      if (ipiCst === '53') {
        setModalInputValue(productModalFields.ipiBase, '0,00');
        setModalInputValue(productModalFields.ipiAliq, '0');
        setModalInputValue(productModalFields.ipiValor, '0,00');
      } else if (productModalFields.ipiBase && productModalFields.ipiAliq) {
        const ipiBase = parseNumber(productModalFields.ipiBase.value);
        const ipiAliq = parseNumber(productModalFields.ipiAliq.value);
        setModalInputValue(productModalFields.ipiValor, formatInputValue(ipiBase * (ipiAliq / 100)));
      }

      const pisCst = normalizeModalCstValue(productModalFields.pisCst?.value);
      if (pisCst === '01') {
        const pisBase = totalValue;
        const pisAliq = parseNumber(productModalFields.pisAliq?.value || 0);
        setModalInputValue(productModalFields.pisBase, formatInputValue(pisBase));
        setModalInputValue(productModalFields.pisValor, formatInputValue(pisBase * (pisAliq / 100)));
      }

      const cofinsCst = normalizeModalCstValue(productModalFields.cofinsCst?.value);
      if (cofinsCst === '01') {
        const cofinsBase = totalValue;
        const cofinsAliq = parseNumber(productModalFields.cofinsAliq?.value || 0);
        setModalInputValue(productModalFields.cofinsBase, formatInputValue(cofinsBase));
        setModalInputValue(productModalFields.cofinsValor, formatInputValue(cofinsBase * (cofinsAliq / 100)));
      }

      const unidadeComercial = normalizeString(productModalFields.unidadeComercial?.value || '');
      const unidadeTributavel = normalizeString(productModalFields.unidadeTributavel?.value || '');
      const valorUnitario = parseNumber(productModalFields.unit?.value || 0);
      const qtdTrib = parseNumber(productModalFields.qtyTrib?.value || 0);
      if (unidadeComercial && unidadeTributavel) {
        if (unidadeComercial === unidadeTributavel) {
          if (productModalFields.qty && productModalFields.qtyTrib) {
            const qtyValue = productModalFields.qty.value;
            if (qtyValue && qtyValue !== productModalFields.qtyTrib.value) {
              setModalInputValue(productModalFields.qtyTrib, qtyValue);
            }
          }
          setModalInputValue(productModalFields.unitTrib, formatInputValue(valorUnitario));
        } else if (qtdTrib > 0) {
          setModalInputValue(productModalFields.unitTrib, formatInputValue(totalValue / qtdTrib));
        }
      }
    } finally {
      applyingFiscalRules = false;
    }
  }

  let syncingModalQty = false;
  function syncModalQuantities(changedField) {
    if (syncingModalQty) return;
    const unidadeComercial = normalizeString(productModalFields.unidadeComercial?.value || '');
    const unidadeTributavel = normalizeString(productModalFields.unidadeTributavel?.value || '');
    if (!unidadeComercial || !unidadeTributavel || unidadeComercial !== unidadeTributavel) return;
    if (!productModalFields.qty || !productModalFields.qtyTrib) return;
    syncingModalQty = true;
    try {
      if (changedField === 'qty') {
        const value = productModalFields.qty.value;
        if (value !== productModalFields.qtyTrib.value) {
          setModalInputValue(productModalFields.qtyTrib, value);
        }
      } else if (changedField === 'qtyTrib') {
        const value = productModalFields.qtyTrib.value;
        if (value !== productModalFields.qty.value) {
          setModalInputValue(productModalFields.qty, value);
        }
      }
    } finally {
      syncingModalQty = false;
    }
  }

  function populateCestSelectOptions(selectedValue = '') {
    if (!productModalFields.cest) return;
    const input = productModalFields.cest;
    const current = selectedValue || input.value || '';
    const values = Array.from(new Set(cestOptionsCache.values.filter(Boolean)));
    values.sort((a, b) =>
      normalizeItemText(a).localeCompare(normalizeItemText(b), 'pt-BR', { sensitivity: 'base', numeric: true }),
    );
    const dropdown = getCestDropdown();
    if (dropdown) {
      renderCestDropdown(values, current);
    }
    if (current) {
      input.value = current;
    }
  }

  async function ensureCestOptions() {
    if (!productModalFields.cest) return;
    if (cestOptionsCache.loaded || cestOptionsCache.loading) {
      populateCestSelectOptions(productModalFields.cest.value || '');
      return;
    }
    cestOptionsCache.loading = true;
    try {
      const fromFile = await loadCestOptionsFromFile();
      if (fromFile && fromFile.length) {
        const values = [];
        const descriptions = new Map();
        fromFile.forEach((item) => {
          if (!item?.cest) return;
          values.push(item.cest);
          if (item.descricao) {
            descriptions.set(item.cest, item.descricao);
          }
        });
        cestOptionsCache.values = values;
        cestOptionsCache.descriptions = descriptions;
        cestOptionsCache.loaded = true;
        populateCestSelectOptions(productModalFields.cest.value || '');
        return;
      }
      const limit = 200;
      let page = 1;
      let totalPages = 1;
      const values = new Set();
      const descriptions = new Map();

      do {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          includeHidden: 'true',
          audience: 'pdv',
        });
        const response = await fetch(`${API_BASE}/products?${params.toString()}`, {
          headers: getAuthHeaders(),
        });
        if (!response.ok) {
          throw new Error('Nao foi possivel carregar os CESTs dos produtos.');
        }
        const payload = await response.json().catch(() => ({}));
        const products = Array.isArray(payload?.products)
          ? payload.products
          : Array.isArray(payload)
            ? payload
            : [];
        products.forEach((product) => {
          const cestValue = normalizeString(product?.cest || product?.fiscal?.cest || '');
          if (cestValue) values.add(cestValue);
        });
        totalPages = Number(payload?.pages) || 1;
        page += 1;
      } while (page <= totalPages);

      cestOptionsCache.values = Array.from(values);
      cestOptionsCache.descriptions = descriptions;
      cestOptionsCache.loaded = true;
      populateCestSelectOptions(productModalFields.cest.value || '');
    } catch (error) {
      console.warn('Erro ao carregar CESTs:', error);
    } finally {
      cestOptionsCache.loading = false;
    }
  }

  async function loadCestOptionsFromFile() {
    try {
      const response = await fetch('/data/cest.json');
      if (!response.ok) return [];
      const payload = await response.json().catch(() => ({}));
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
      const normalized = [];
      items.forEach((item) => {
        const cestValue = normalizeString(item?.cest || item?.CEST || '');
        const descricao = normalizeString(item?.descricao || item?.descricaoCest || item?.descricao_cest || item?.Descrição || '');
        if (cestValue) {
          normalized.push({ cest: cestValue, descricao });
        }
      });
      return normalized;
    } catch (error) {
      return [];
    }
  }

  function getCestDropdown() {
    return productModal?.querySelector('[data-cest-dropdown]');
  }

  function renderCestDropdown(values, filterValue = '') {
    const dropdown = getCestDropdown();
    if (!dropdown) return;
    const normalizedFilter = normalizeItemText(filterValue || '');
    const filtered = normalizedFilter
      ? values.filter((value) => {
        const desc = normalizeItemText(cestOptionsCache.descriptions.get(value) || '');
        return normalizeItemText(value).includes(normalizedFilter) || desc.includes(normalizedFilter);
      })
      : values;
    dropdown.innerHTML = '';
    if (!filtered.length) {
      dropdown.innerHTML = '<div class="px-3 py-2 text-[11px] text-gray-400">Nenhum CEST encontrado.</div>';
      return;
    }
    filtered.forEach((value) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'w-full text-left px-3 py-2 hover:bg-gray-100 transition';
      const description = cestOptionsCache.descriptions.get(value) || '';
      item.innerHTML = `
        <div class="flex items-baseline gap-2">
          <span class="font-semibold text-gray-800">${value}</span>
          ${description ? `<span class="text-[10px] text-gray-500 truncate">${description}</span>` : ''}
        </div>
      `;
      item.addEventListener('click', () => {
        if (productModalFields.cest) {
          productModalFields.cest.value = value;
        }
        closeCestDropdown();
      });
      dropdown.appendChild(item);
    });
  }

  function openCestDropdown() {
    const dropdown = getCestDropdown();
    if (!dropdown) return;
    renderCestDropdown(Array.from(new Set(cestOptionsCache.values.filter(Boolean))), productModalFields.cest?.value || '');
    dropdown.classList.remove('hidden');
    cestDropdownOpen = true;
  }

  function closeCestDropdown() {
    const dropdown = getCestDropdown();
    if (!dropdown) return;
    dropdown.classList.add('hidden');
    cestDropdownOpen = false;
  }

  async function getIcmsSimplesDataForCompany() {
    const companyId = typeof getActiveCompanyId === 'function' ? getActiveCompanyId() : '';
    if (!companyId) return null;
    if (icmsSimplesCache.companyId === companyId && icmsSimplesCache.map) {
      return icmsSimplesCache;
    }
    if (icmsSimplesCache.loading) {
      return icmsSimplesCache.map ? icmsSimplesCache : null;
    }
    icmsSimplesCache.loading = true;
    try {
      const response = await fetch(
        `${API_BASE}/fiscal/icms-simples?empresa=${encodeURIComponent(companyId)}`,
        { headers: getAuthHeaders() },
      );
      if (!response.ok) throw new Error('Nao foi possivel carregar o ICMS do Simples Nacional.');
      const payload = await response.json().catch(() => ({}));
      const registros = Array.isArray(payload?.registros)
        ? payload.registros
        : Array.isArray(payload)
          ? payload
          : [];
      const list = registros
        .map((entry) => ({
          codigo: Number(entry?.codigo),
          valor: Number(entry?.valor),
        }))
        .filter((entry) => Number.isFinite(entry.codigo) && Number.isFinite(entry.valor))
        .sort((a, b) => a.codigo - b.codigo);
      const map = {};
      list.forEach((entry) => {
        map[entry.codigo] = entry.valor;
      });
      icmsSimplesCache = { companyId, map, list, loading: false };
      return icmsSimplesCache;
    } catch (error) {
      console.warn('Erro ao carregar ICMS do Simples Nacional.', error);
      return null;
    } finally {
      icmsSimplesCache.loading = false;
    }
  }

  function resolveIcmsSimplesValue(fiscal, icmsSimplesData) {
    if (!icmsSimplesData) return null;
    const map = icmsSimplesData.map || {};
    const list = icmsSimplesData.list || [];
    const fiscalCodeRaw = fiscal?.icms?.codigo || fiscal?.icmsSimplesCodigo || '';
    const fiscalCode = Number(normalizeDigits(fiscalCodeRaw));
    if (Number.isFinite(fiscalCode) && map[fiscalCode] !== undefined) {
      return map[fiscalCode];
    }
    if (map[1] !== undefined) return map[1];
    if (list.length) return list[0].valor;
    return null;
  }

  function applyIcmsSimplesBase(prefill, product, icmsSimplesData) {
    if (!prefill || !product) return;
    const fiscal = resolveProductFiscal(product);
    const icmsRate = resolveIcmsSimplesValue(fiscal, icmsSimplesData);
    const unitValue = parseNumber(prefill.unit || 0);
    const qtyValue = parseNumber(prefill.qty || 1);
    const basePercent = parseNumber(prefill.icmsBasePercent || 100);
    const baseValue = unitValue * qtyValue * (basePercent / 100);
    prefill.icmsBasePercent = formatRateValue(basePercent);
    prefill.icmsBaseValue = formatInputValue(baseValue);
    prefill.baseIcms = formatInputValue(baseValue);
    if (Number.isFinite(icmsRate)) {
      prefill.icms = formatRateValue(icmsRate);
    }
  }

  function matchesProductCode(product, target) {
    const normalized = normalizeString(target);
    if (!normalized || !product || typeof product !== 'object') return false;
    const candidates = [
      product.cod,
      product.codbarras,
      product.referencia,
      ...(Array.isArray(product.codigosComplementares) ? product.codigosComplementares : []),
      ...(Array.isArray(product.fornecedores) ? product.fornecedores.map((entry) => entry?.codigoProduto) : []),
    ]
      .map((value) => normalizeString(value))
      .filter(Boolean);
    return candidates.some((value) => value === normalized);
  }

  async function fetchProductByCode(code) {
    const trimmed = normalizeString(code);
    if (!trimmed) return null;
    const params = new URLSearchParams({
      search: trimmed,
      limit: '5',
      includeHidden: 'true',
      audience: 'pdv',
    });
    const response = await fetch(`${API_BASE}/products?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error('Nao foi possivel buscar o produto.');
    }
    const payload = await response.json().catch(() => ({}));
    const products = Array.isArray(payload?.products)
      ? payload.products
      : Array.isArray(payload)
        ? payload
        : [];
    if (!products.length) return null;
    const match = products.find((product) => matchesProductCode(product, trimmed));
    return match || products[0];
  }

  function buildProductPrefill(product) {
    const fiscal = resolveProductFiscal(product);
    const cfop = resolveProductCfop(fiscal);
    const cst = normalizeCstValue(resolveProductCst(fiscal));
    const pisCst = normalizeCstValue(fiscal?.pis?.cst || '');
    const cofinsCst = normalizeCstValue(fiscal?.cofins?.cst || '');
    const ipiCst = normalizeCstValue(fiscal?.ipi?.cst || '');
    const ipiEnq = normalizeString(fiscal?.ipi?.codigoEnquadramento || '');
    const unidadeBase = product?.unidade || product?.unidadeVenda || '';
    return {
      productId: product?._id || product?.id || '',
      code: product?.cod || product?.codbarras || '',
      codigoBarras: product?.codbarras || '',
      name: product?.nome || '',
      ncm: product?.ncm || '',
      cfop,
      qty: '1',
      unit: formatInputValue(product?.venda),
      discount: '0,00',
      unidadeComercial: unidadeBase,
      unidadeTributavel: product?.unidadeTributavel || unidadeBase,
      cst,
      pisCst,
      cofinsCst,
      ipiCst,
      ipiEnq,
      icms: formatRateValue(fiscal?.icms?.aliquota || 0),
      ipi: formatRateValue(fiscal?.ipi?.aliquota || 0),
      pis: formatRateValue(fiscal?.pis?.aliquota || 0),
      cofins: formatRateValue(fiscal?.cofins?.aliquota || 0),
    };
  }

  async function addProductByCode(rawCode) {
    if (!rawCode) return;
    if (productCodeInput) {
      productCodeInput.disabled = true;
    }
    try {
      const product = await fetchProductByCode(rawCode);
      if (!product) {
        if (typeof showToast === 'function') {
          showToast('Produto nao encontrado para o codigo informado.', 'warning');
        }
        return;
      }
      const icmsSimplesData = await getIcmsSimplesDataForCompany();
      const prefill = buildProductPrefill(product);
      applyIcmsSimplesBase(prefill, product, icmsSimplesData);
      addItemRow(prefill);
      addHistory(`Produto ${product?.nome || ''} adicionado.`);
    } catch (error) {
      if (typeof showToast === 'function') {
        showToast(error?.message || 'Erro ao buscar produto.', 'error');
      }
    } finally {
      if (productCodeInput) {
        productCodeInput.disabled = false;
        productCodeInput.value = '';
        productCodeInput.focus();
      }
    }
  }

  function handleProductCodeKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = normalizeString(productCodeInput?.value || '');
    if (!value) return;
    addProductByCode(value);
  }

  async function loadEmitente() {
    if (typeof fetchAllowedStores !== 'function') return;
    try {
      const stores = await fetchAllowedStores();
      const activeId = typeof getActiveCompanyId === 'function' ? getActiveCompanyId() : '';
      let store = null;
      if (activeId) {
        store = stores.find((item) => String(item._id || item.id) === String(activeId));
      }
      if (!store && stores.length) store = stores[0];
    if (!store) return;

    emitenteFields.razao.value = store.razaoSocial || store.nome || '';
    emitenteFields.fantasia.value = store.nomeFantasia || store.nome || '';
    emitenteFields.cnpj.value = store.cnpj || '';
    emitenteFields.ie.value = store.inscricaoEstadual || '';
    emitenteFields.regime.value = formatRegime(store.regimeTributario || '');
    emitenteFields.endereco.value = store.endereco || formatAddress(store);
    captureDefaultState(true);
  } catch (error) {
    console.error('nfe:emitente', error);
  }
}

  function validateRequiredFields() {
    let valid = true;
    requiredFields.forEach((field) => {
      const value = field.value ? field.value.trim() : '';
      if (!value) {
        field.classList.add('border-red-300', 'bg-red-50');
        valid = false;
      } else {
        field.classList.remove('border-red-300', 'bg-red-50');
      }
    });
    return valid;
  }

  function isRepeatedDigits(value) {
    return /^(\d)\1+$/.test(value);
  }

  function isValidCpf(value) {
    const cpf = String(value || '').replace(/\D/g, '');
    if (cpf.length !== 11 || isRepeatedDigits(cpf)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i += 1) {
      sum += parseInt(cpf.charAt(i), 10) * (10 - i);
    }
    let check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    if (check !== parseInt(cpf.charAt(9), 10)) return false;
    sum = 0;
    for (let i = 0; i < 10; i += 1) {
      sum += parseInt(cpf.charAt(i), 10) * (11 - i);
    }
    check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    return check === parseInt(cpf.charAt(10), 10);
  }

  function isValidCnpj(value) {
    const cnpj = String(value || '').replace(/\D/g, '');
    if (cnpj.length !== 14 || isRepeatedDigits(cnpj)) return false;
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < weights1.length; i += 1) {
      sum += parseInt(cnpj.charAt(i), 10) * weights1[i];
    }
    let check = sum % 11;
    check = check < 2 ? 0 : 11 - check;
    if (check !== parseInt(cnpj.charAt(12), 10)) return false;
    sum = 0;
    for (let i = 0; i < weights2.length; i += 1) {
      sum += parseInt(cnpj.charAt(i), 10) * weights2[i];
    }
    check = sum % 11;
    check = check < 2 ? 0 : 11 - check;
    return check === parseInt(cnpj.charAt(13), 10);
  }

  function resolveDocumentType(value) {
    const digits = normalizeDigits(value);
    if (digits.length > 11) return 'cnpj';
    if (digits.length === 11) return 'cpf';
    return digits.length ? 'cpf' : '';
  }

  function updateConsumerFinalFromDoc() {
    if (!clientFields.consumerFinal || !clientFields.doc) return;
    const type = resolveDocumentType(clientFields.doc.value);
    if (type === 'cnpj') {
      clientFields.consumerFinal.value = 'nao';
    } else if (type === 'cpf') {
      clientFields.consumerFinal.value = 'sim';
    }
  }

  function validateDocument() {
    if (!clientFields.doc || !clientFields.docAlert) return true;
    const doc = clientFields.doc.value;
    if (!doc) {
      clientFields.docAlert.classList.add('hidden');
      clientFields.doc.classList.remove('border-red-300', 'bg-red-50');
      return true;
    }

    const type = resolveDocumentType(doc);
    const isValid =
      type === 'cpf' ? isValidCpf(doc) : type === 'cnpj' ? isValidCnpj(doc) : false;
    clientFields.docAlert.classList.toggle('hidden', isValid);
    clientFields.doc.classList.toggle('border-red-300', !isValid);
    clientFields.doc.classList.toggle('bg-red-50', !isValid);
    return isValid;
  }

  function initClientDocumentMask() {
    if (!clientFields.doc) return;
    applyMask(clientFields.doc, {
      mask: [{ mask: '000.000.000-00' }, { mask: '00.000.000/0000-00' }],
      dispatch(appended, dynamicMasked) {
        const value = (dynamicMasked.value + appended).replace(/\D/g, '');
        return value.length > 11 ? dynamicMasked.compiledMasks[1] : dynamicMasked.compiledMasks[0];
      },
    });
  }

  function applyMaskToItemRow(row) {
    if (!row) return;
    ITEM_COLUMNS.forEach((column) => {
      const input = row.querySelector(`[data-field="${column.key}"]`);
      if (!input) return;
      if (ITEM_QTY_KEYS.has(column.key)) {
        applyMask(input, createNumberMask(3));
        return;
      }
      if (ITEM_CURRENCY_KEYS.has(column.key)) {
        applyMask(input, createNumberMask(2));
        return;
      }
      if (ITEM_PERCENT_KEYS.has(column.key)) {
        applyMask(input, createNumberMask(2));
        return;
      }
      if (column.key === 'cfop') {
        applyMask(input, { mask: '0000', lazy: true });
        return;
      }
      if (column.key === 'ncm') {
        applyMask(input, { mask: '00000000', lazy: true });
        return;
      }
      if (column.key === 'cest') {
        applyMask(input, { mask: '00.000.00', lazy: true });
      }
    });
  }

  function applyMaskToPaymentRow(row, type) {
    if (!row) return;
    if (type === 'card') {
      const valueInput = row.querySelector('input[data-card-value]');
      applyMask(valueInput, createNumberMask(2));
      return;
    }
    if (type === 'cheque') {
      const valueInput = row.querySelector('input[data-cheque-value]');
      applyMask(valueInput, createNumberMask(2));
      return;
    }
    if (type === 'cash') {
      const valueInput = row.querySelector('input[data-cash-value]');
      applyMask(valueInput, createNumberMask(2));
      return;
    }
    if (type === 'pix') {
      const valueInput = row.querySelector('input[data-pix-value]');
      applyMask(valueInput, createNumberMask(2));
      return;
    }
    if (type === 'other') {
      const valueInput = row.querySelector('input[data-other-value]');
      applyMask(valueInput, createNumberMask(2));
    }
  }

  function initMasks() {
    if (typeof IMask === 'undefined') return;

    initClientDocumentMask();
    applyMask(codeInput, createNumberMask(0));
    applyMask(refFields.chave, { mask: '00000000000000000000000000000000000000000000', lazy: true });
    applyMask(clientFields.phone, createPhoneMaskOptions());
    applyMask(clientFields.zip, { mask: '00000-000', lazy: true });

    applyMask(document.getElementById('nfe-transportadora-cnpj'), { mask: '00.000.000/0000-00', lazy: true });

    applyMask(extraInputs.frete, createNumberMask(2));
    applyMask(extraInputs.outros, createNumberMask(2));
    applyMask(extraInputs.paymentValue, createNumberMask(2));
    applyMask(crediarioFields.value, createNumberMask(2));
    applyMask(chequeFields.value, createNumberMask(2));
    applyMask(cardFields.value, createNumberMask(2));
    applyMask(cashFields.value, createNumberMask(2));
    applyMask(pixFields.value, createNumberMask(2));
    applyMask(otherFields.value, createNumberMask(2));

    applyMask(volumeFields.quantidade, createNumberMask(0));
    applyMask(volumeFields.pesoBruto, createNumberMask(3));
    applyMask(volumeFields.pesoLiquido, createNumberMask(3));
    applyMask(volumeFields.cubagem, createNumberMask(3));

    applyMask(productModalFields.qty, createNumberMask(3));
    applyMask(productModalFields.unit, createNumberMask(2));
    applyMask(productModalFields.subtotal, createNumberMask(2));
    applyMask(productModalFields.discountPercent, createNumberMask(2));
    applyMask(productModalFields.discountValue, createNumberMask(2));
    applyMask(productModalFields.otherExpenses, createNumberMask(2));
    applyMask(productModalFields.total, createNumberMask(2));
    applyMask(productModalFields.icmsBasePercent, createNumberMask(2));
    applyMask(productModalFields.icmsBaseValue, createNumberMask(2));
    applyMask(productModalFields.icmsAliq, createNumberMask(2));
    applyMask(productModalFields.icmsValor, createNumberMask(2));
    applyMask(productModalFields.fcpAliq, createNumberMask(2));
    applyMask(productModalFields.fcpValor, createNumberMask(2));
    applyMask(productModalFields.ipiBase, createNumberMask(2));
    applyMask(productModalFields.ipiAliq, createNumberMask(2));
    applyMask(productModalFields.ipiValor, createNumberMask(2));
    applyMask(productModalFields.pisBase, createNumberMask(2));
    applyMask(productModalFields.pisAliq, createNumberMask(2));
    applyMask(productModalFields.pisValor, createNumberMask(2));
    applyMask(productModalFields.cofinsBase, createNumberMask(2));
    applyMask(productModalFields.cofinsAliq, createNumberMask(2));
    applyMask(productModalFields.cofinsValor, createNumberMask(2));
    applyMask(productModalFields.peso, createNumberMask(3));
    applyMask(productModalFields.qtyTrib, createNumberMask(3));
    applyMask(productModalFields.unitTrib, createNumberMask(2));
    applyMask(productModalFields.ncm, { mask: '00000000', lazy: true });
    applyMask(productModalFields.cfop, { mask: '0000', lazy: true });
    applyMask(productModalFields.cest, { mask: '00.000.00', lazy: true });
  }

  async function handleSerieChange() {
    if (!serieFields.select) return;
    const selectedId = serieFields.select.value || '';
    const serie = fiscalSeries.find((item) => String(item._id || item.id) === String(selectedId));
    if (!serie) {
      if (serieFields.model) serieFields.model.value = '';
      if (numberInput) numberInput.value = '';
      return;
    }
    const companyId = await resolvePaymentCompanyId();
    applySerieSelection(serie, companyId);
    updateSerieSelectDisplay(false);
  }

  function validateItems() {
    const rows = Array.from(itemsBody?.querySelectorAll('tr[data-item-row]') || []);
    let invalidCount = 0;
    rows.forEach((row) => {
      const required = row.querySelectorAll('[data-item-required]');
      let rowValid = true;
      required.forEach((field) => {
        const value = field.value ? field.value.trim() : '';
        if (!value) {
          rowValid = false;
          field.classList.add('border-amber-300', 'bg-amber-50');
        } else {
          field.classList.remove('border-amber-300', 'bg-amber-50');
        }
      });
      row.classList.toggle('bg-amber-50', !rowValid);
      if (!rowValid) invalidCount += 1;
    });

    if (itemsAlert) {
      if (invalidCount > 0) {
        itemsAlert.textContent = `Existem ${invalidCount} item(ns) com inconsist\u00eancias fiscais.`;
        itemsAlert.classList.remove('hidden');
      } else {
        itemsAlert.classList.add('hidden');
      }
    }
    return invalidCount === 0;
  }

  function updateTotals() {
    const rows = Array.from(itemsBody?.querySelectorAll('tr[data-item-row]') || []);
    let totalProducts = 0;
    let totalDiscounts = 0;
    let totalIcms = 0;
    let totalIpi = 0;
    let totalPis = 0;
    let totalCofins = 0;

    rows.forEach((row) => {
      const qty = parseNumber(row.querySelector('[data-field="qty"]')?.value);
      const unit = parseNumber(row.querySelector('[data-field="unit"]')?.value);
      const discount = parseNumber(row.querySelector('[data-field="discount"]')?.value);
      const total = Math.max(0, qty * unit - discount);
      const totalInput = row.querySelector('[data-field="total"]');
      if (totalInput) totalInput.value = formatMoney(total);

      const icmsPercent = parseNumber(row.querySelector('[data-field="icms"]')?.value);
      const ipiPercent = parseNumber(row.querySelector('[data-field="ipi"]')?.value);
      const pisPercent = parseNumber(row.querySelector('[data-field="pis"]')?.value);
      const cofinsPercent = parseNumber(row.querySelector('[data-field="cofins"]')?.value);

      totalProducts += total;
      totalDiscounts += discount;
      totalIcms += total * (icmsPercent / 100);
      totalIpi += total * (ipiPercent / 100);
      totalPis += total * (pisPercent / 100);
      totalCofins += total * (cofinsPercent / 100);
    });

    const baseIcms = totalProducts;
    const frete = parseNumber(extraInputs.frete?.value);
    const outros = parseNumber(extraInputs.outros?.value);
    const totalNote = totalProducts + frete + outros;

    if (totals.products) totals.products.textContent = formatMoney(totalProducts);
    if (totals.discounts) totals.discounts.textContent = formatMoney(totalDiscounts);
    if (totals.baseIcms) totals.baseIcms.textContent = formatMoney(baseIcms);
    if (totals.icms) totals.icms.textContent = formatMoney(totalIcms);
    if (totals.ipi) totals.ipi.textContent = formatMoney(totalIpi);
    if (totals.pis) totals.pis.textContent = formatMoney(totalPis);
    if (totals.cofins) totals.cofins.textContent = formatMoney(totalCofins);
    if (totals.note) totals.note.textContent = formatMoney(totalNote);

    if (extraInputs.paymentValue && parseNumber(extraInputs.paymentValue.value) === 0) {
      extraInputs.paymentValue.value = totalNote.toFixed(2).replace('.', ',');
    }

    updatePaymentKpis();
    validateItems();
  }

  function sumCrediarioRows() {
    if (!crediarioFields.table) return 0;
    const inputs = Array.from(crediarioFields.table.querySelectorAll('input[type="text"]'));
    return inputs.reduce((sum, input) => sum + parseNumber(input.value), 0);
  }

  function sumChequeRows() {
    if (!chequeFields.table) return 0;
    const inputs = Array.from(chequeFields.table.querySelectorAll('input[data-cheque-value]'));
    return inputs.reduce((sum, input) => sum + parseNumber(input.value), 0);
  }

  function sumCardRows() {
    if (!cardFields.table) return 0;
    const inputs = Array.from(cardFields.table.querySelectorAll('input[data-card-value]'));
    return inputs.reduce((sum, input) => sum + parseNumber(input.value), 0);
  }

  function sumCashRows() {
    if (!cashFields.table) return 0;
    const inputs = Array.from(cashFields.table.querySelectorAll('input[data-cash-value]'));
    return inputs.reduce((sum, input) => sum + parseNumber(input.value), 0);
  }

  function sumPixRows() {
    if (!pixFields.table) return 0;
    const inputs = Array.from(pixFields.table.querySelectorAll('input[data-pix-value]'));
    return inputs.reduce((sum, input) => sum + parseNumber(input.value), 0);
  }

  function sumOtherRows() {
    if (!otherFields.table) return 0;
    const inputs = Array.from(otherFields.table.querySelectorAll('input[data-other-value]'));
    return inputs.reduce((sum, input) => sum + parseNumber(input.value), 0);
  }

  function updatePaymentKpis() {
    if (!paymentKpis.total || !paymentKpis.remaining || !paymentKpis.change) return;

    const totalNote = parseNumber(totals.note?.textContent || '0');
    const generalPayment = extraInputs.paymentValue ? parseNumber(extraInputs.paymentValue.value) : 0;
    const crediarioTotal = sumCrediarioRows();
    const chequeTotal = sumChequeRows();
    const cardTotal = sumCardRows();
    const cashTotal = sumCashRows();
    const pixTotal = sumPixRows();
    const otherTotal = sumOtherRows();
    const paid = generalPayment + crediarioTotal + chequeTotal + cardTotal + cashTotal + pixTotal + otherTotal;
    const remaining = Math.max(0, totalNote - paid);
    const change = Math.max(0, paid - totalNote);

    paymentKpis.total.textContent = formatMoney(totalNote);
    paymentKpis.remaining.textContent = formatMoney(remaining);
    paymentKpis.change.textContent = formatMoney(change);
  }

  function addItemRow(prefill = {}) {
    if (!itemsBody) return;
    if (itemsEmpty) itemsEmpty.remove();

    const row = document.createElement('tr');
    row.dataset.itemRow = 'true';
    row.dataset.order = String(itemRowSequence++);
    const productId = normalizeString(prefill?.productId || prefill?._id || prefill?.id || '');
    if (productId) row.dataset.productId = productId;
    const productCode = normalizeString(prefill?.productCode || prefill?.code || '');
    if (productCode) row.dataset.productCode = productCode;
    const productBarcode = normalizeString(prefill?.productBarcode || prefill?.codigoBarras || prefill?.codbarras || '');
    if (productBarcode) row.dataset.productBarcode = productBarcode;

    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    const getDefaultItemValue = (key) => {
      if (ITEM_QTY_KEYS.has(key)) return formatQtyValue(0);
      if (ITEM_CURRENCY_KEYS.has(key)) return formatInputValue(0);
      if (ITEM_PERCENT_KEYS.has(key)) return formatRateValue(0);
      return '';
    };
    const cells = ITEM_COLUMNS.map((column) => {
      const alignClass = column.align ? ` ${column.align}` : '';
      const value = hasValue(prefill[column.key]) ? prefill[column.key] : getDefaultItemValue(column.key);
      const isReadOnly = column.readOnly ? 'readonly' : '';
      const inputClass = `w-full rounded border border-gray-200 px-2 py-1 text-xs${alignClass}`;
      const defaultValue = column.key === 'item' ? String(itemsBody.querySelectorAll('tr[data-item-row]').length + 1) : value;
      return `
        <td class="px-3 py-2">
          <input type="text" class="${inputClass}" data-field="${column.key}" value="${defaultValue}" ${isReadOnly}>
        </td>
      `;
    }).join('');

      row.innerHTML = cells;
      itemsBody.appendChild(row);
      applyMaskToItemRow(row);
      syncItemColumnWidths();
      updateTotals();
      applyItemFiltersAndSort();
    }

  function handleItemInput(event) {
    const row = event.target.closest('tr[data-item-row]');
    if (!row) return;
    updateTotals();
    applyItemFiltersAndSort();
  }

  function handleItemClick(event) {
    const removeButton = event.target.closest('[data-item-action="remove"]');
    if (!removeButton) return;
    const row = removeButton.closest('tr[data-item-row]');
    if (row) row.remove();
    if (!itemsBody?.querySelector('tr[data-item-row]') && itemsEmpty) {
      itemsBody.appendChild(itemsEmpty);
    }
    updateTotals();
    applyItemFiltersAndSort();
  }

  function openQuickClientModal() {
    if (typeof showModal !== 'function') return;
    const wrapper = document.createElement('div');
    wrapper.className = 'space-y-3 text-sm';
    wrapper.innerHTML = `
      <div class="grid grid-cols-1 gap-2">
        <label class="font-semibold text-gray-700">Nome</label>
        <input id="quick-client-name" class="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      </div>
      <div class="grid grid-cols-1 gap-2">
        <label class="font-semibold text-gray-700">Documento</label>
        <input id="quick-client-doc" class="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      </div>
      <div class="grid grid-cols-1 gap-2">
        <label class="font-semibold text-gray-700">Telefone</label>
        <input id="quick-client-phone" class="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      </div>
    `;

    showModal({
      title: 'Cadastro r\u00e1pido de cliente',
      message: wrapper,
      confirmText: 'Aplicar',
      cancelText: 'Cancelar',
      onConfirm: () => {
        const name = wrapper.querySelector('#quick-client-name')?.value || '';
        const doc = wrapper.querySelector('#quick-client-doc')?.value || '';
                const phone = wrapper.querySelector('#quick-client-phone')?.value || '';
        if (clientFields.name) clientFields.name.value = name;
        if (clientFields.doc) clientFields.doc.value = doc;
                if (clientFields.phone) clientFields.phone.value = phone;
        updateConsumerFinalFromDoc();
        validateDocument();
        addHistory('Cliente preenchido via cadastro r\u00e1pido.');
        return true;
      },
    });
  }

  function handleHeaderAction(action) {
    if (action === 'new' || action === 'clear' || action === 'novo') {
      applyDefaultState();
      currentDraftId = '';
      currentDraftCode = '';
      if (codeInput) codeInput.value = '';
      refreshNextNumberFromSerie().catch((error) => {
        console.error('nfe:refresh-number', error);
      });
      addHistory('Nova NF-e iniciada.');
      return;
    }
    if (action === 'load-sale') {
      if (typeof showModal === 'function') {
        showModal({
          title: 'Carregar venda',
          message: 'Informe o n\u00famero da venda para carregar os itens (integra\u00e7\u00e3o pendente).',
          confirmText: 'Ok',
        });
      }
      return;
    }
    if (action === 'help') {
      if (typeof showModal === 'function') {
        showModal({
          title: 'Ajuda Fiscal',
          message: 'Preencha os campos obrigat\u00f3rios, valide a NF-e e emita apenas ap\u00f3s revisar as tributa\u00e7\u00f5es.',
          confirmText: 'Entendi',
        });
      }
      return;
    }
      if (action === 'add-item') {
        openProductModal();
        return;
      }
    if (action === 'quick-client') {
      openQuickClientModal();
    }
  }

  function matchesCfopOperation(cfopCode, operation) {
    const normalized = normalizeDigits(cfopCode);
    if (!normalized) return false;
    const prefix = normalized.charAt(0);
    if (operation === 'entrada') return ['1', '2', '3'].includes(prefix);
    if (operation === 'saida') return ['5', '6', '7'].includes(prefix);
    return true;
  }

  function buildNaturezaOptionLabel(entry) {
    const codigo = normalizeDigits(entry?.cfop) || '';
    const descricao = normalizeString(entry?.descricao) || '';
    return descricao ? `${codigo} - ${descricao}` : codigo;
  }

  async function loadNaturezaOperacaoOptions() {
    if (!naturezaOperacaoSelect) return;
    const selectedOperation = operationSelect?.value || 'saida';
    const selectedValue = naturezaOperacaoSelect.value || '';

    naturezaOperacaoSelect.innerHTML = '<option value="">Selecione</option>';

    try {
      const response = await fetch(`${API_BASE}/fiscal/cfop`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar os CFOPs ativos.');
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
        const filtered = items
          .filter((item) => item?.ativo)
          .filter((item) => matchesCfopOperation(item?.cfop, selectedOperation))
          .sort((a, b) => normalizeDigits(a?.cfop).localeCompare(normalizeDigits(b?.cfop)));

      if (!filtered.length) {
        naturezaOperacaoSelect.innerHTML = '<option value="">Nenhum CFOP ativo para este tipo</option>';
        return;
      }

      filtered.forEach((item) => {
        const codigo = normalizeDigits(item?.cfop);
        if (!codigo) return;
        const option = document.createElement('option');
        option.value = codigo;
        option.textContent = buildNaturezaOptionLabel(item);
        naturezaOperacaoSelect.appendChild(option);
      });

      if (selectedValue && Array.from(naturezaOperacaoSelect.options).some((opt) => opt.value === selectedValue)) {
        naturezaOperacaoSelect.value = selectedValue;
      }
      syncModalCfopOptionsFromNatureza();
    } catch (error) {
      console.error('Erro ao carregar natureza da operacao:', error);
      if (typeof showToast === 'function') {
        showToast('Nao foi possivel carregar os CFOPs ativos.', 'error');
      }
    }
  }

  function syncModalCfopOptionsFromNatureza() {
    if (!productModalFields.cfop || !naturezaOperacaoSelect) return;
    const modalSelect = productModalFields.cfop;
    const currentValue = normalizeDigits(modalSelect.value || '');
    const naturezaValue = normalizeDigits(naturezaOperacaoSelect.value || '');
    const desiredValue = currentValue || naturezaValue;

    const options = Array.from(naturezaOperacaoSelect.options || [])
      .filter((opt) => opt.value);

    modalSelect.innerHTML = '<option value="">--SELECIONE--</option>';
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.textContent || opt.value;
      modalSelect.appendChild(option);
    });

    if (desiredValue) {
      const hasValue = Array.from(modalSelect.options).some((opt) => opt.value === desiredValue);
      if (!hasValue) {
        const fallback = document.createElement('option');
        fallback.value = desiredValue;
        fallback.textContent = desiredValue;
        modalSelect.appendChild(fallback);
      }
      modalSelect.value = desiredValue;
    }
  }

  function syncStockMovementWithOperation() {
    if (!operationSelect || !stockMovementSelect) return;
    const operation = operationSelect.value;
    if (operation === 'saida') {
      stockMovementSelect.value = 'remover';
    } else if (operation === 'entrada') {
      stockMovementSelect.value = 'adicionar';
    }
  }

  function validateBeforeEmit() {
    const requiredOk = validateRequiredFields();
    const docOk = validateDocument();
    const itemsOk = validateItems();
    const totalsOk = (itemsBody?.querySelector('tr[data-item-row]') || null) !== null;
    if (!totalsOk && typeof showToast === 'function') {
      showToast('Adicione ao menos um item na NF-e.', 'warning');
    }
    return requiredOk && docOk && itemsOk && totalsOk;
  }

  function bindEvents() {
      document.addEventListener('click', (event) => {
        const button = event.target.closest(headerActionSelector);
        if (!button) return;
        const action = button.dataset.nfeAction;
        if (action) handleHeaderAction(action);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeProductModal();
      });
      document.addEventListener('click', (event) => {
        closeItemFilterDropdown();
        closeVolumeFilterDropdown();
        closeRefFilterDropdown();
        if (cestDropdownOpen) {
          const target = event.target;
          const dropdown = getCestDropdown();
          const toggle = productModal?.querySelector('[data-cest-toggle]');
          const input = productModalFields.cest;
          if (
            target instanceof Node &&
            (
              (dropdown && dropdown.contains(target)) ||
              (toggle && toggle.contains(target)) ||
              (input && input.contains(target))
            )
          ) {
            return;
          }
          closeCestDropdown();
        }
      });

      itemsBody?.addEventListener('input', handleItemInput);
      itemsBody?.addEventListener('click', handleItemClick);

      emitenteSelectButton?.addEventListener('click', () => {
        openEmitenteSearchModal('');
      });

      productModal?.addEventListener('click', (event) => {
        if (event.target === productModal) closeProductModal();
      });
      productModal?.querySelectorAll('[data-nfe-modal-close]').forEach((button) => {
        button.addEventListener('click', closeProductModal);
      });
      productModalFields.cancel?.addEventListener('click', closeProductModal);
      productModal?.querySelectorAll('[data-nfe-modal-tab]').forEach((button) => {
        button.addEventListener('click', () => setProductModalTab(button.dataset.nfeModalTab || 'icms'));
      });
      productModalFields.save?.addEventListener('click', () => {
        const codeValue = modalProductSnapshot?.cod || modalProductSnapshot?.codbarras || '';
        const barcodeValue = modalProductSnapshot?.codbarras || '';
        const prefill = {
          productId: modalProductSnapshot?._id || modalProductSnapshot?.id || '',
          code: codeValue,
          codigoBarras: barcodeValue,
          name: productModalFields.product?.value || '',
          qty: productModalFields.qty?.value || '',
          unit: productModalFields.unit?.value || '',
          discount: productModalFields.discountValue?.value || '',
          otherExpenses: productModalFields.otherExpenses?.value || '',
          total: productModalFields.total?.value || '',
          baseIcms: productModalFields.icmsBaseValue?.value || '',
          unidadeComercial: productModalFields.unidadeComercial?.value || '',
          peso: productModalFields.peso?.value || '',
          qtyTrib: productModalFields.qtyTrib?.value || '',
          unidadeTributavel: productModalFields.unidadeTributavel?.value || '',
          unitTrib: productModalFields.unitTrib?.value || '',
          ncm: productModalFields.ncm?.value || '',
          cfop: productModalFields.cfop?.value || '',
          cest: productModalFields.cest?.value || '',
          codigoBeneficioFiscal: productModalFields.codigoBeneficioFiscal?.value || '',
          numeroPedido: productModalFields.numeroPedido?.value || '',
          numeroItemPedido: productModalFields.numeroItemPedido?.value || '',
        };
        addItemRow(prefill);
        closeProductModal();
      });
      productModalFields.product?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const code = normalizeString(productModalFields.product?.value || '');
        if (!code) return;
        fillProductModalByCode(code);
      });
      const cestToggle = productModal?.querySelector('[data-cest-toggle]');
      cestToggle?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (cestDropdownOpen) {
          closeCestDropdown();
        } else {
          ensureCestOptions();
          openCestDropdown();
        }
      });
      productModalFields.cest?.addEventListener('focus', (event) => {
        event.stopPropagation();
        ensureCestOptions();
        openCestDropdown();
      });
      productModalFields.cest?.addEventListener('click', (event) => {
        event.stopPropagation();
        ensureCestOptions();
        openCestDropdown();
      });
      productModalFields.cest?.addEventListener('input', () => {
        ensureCestOptions();
        openCestDropdown();
      });
      [
        productModalFields.qty,
        productModalFields.unit,
        productModalFields.otherExpenses,
      ].forEach((input) => input?.addEventListener('input', () => updateProductModalTotals()));
      productModalFields.qty?.addEventListener('input', () => {
        syncModalQuantities('qty');
        applyFiscalRules();
      });
      productModalFields.discountPercent?.addEventListener('input', () => updateProductModalTotals('percent'));
      productModalFields.discountValue?.addEventListener('input', () => updateProductModalTotals('value'));
      productModalFields.icmsBasePercent?.addEventListener('input', () => updateProductModalTotals());
      productModalFields.icmsAliq?.addEventListener('input', () => applyFiscalRules());
      productModalFields.fcpAliq?.addEventListener('input', () => applyFiscalRules());
      productModalFields.icmsCst?.addEventListener('change', () => applyFiscalRules());
      productModalFields.icmsModalidade?.addEventListener('change', () => applyFiscalRules());
      productModalFields.ipiCst?.addEventListener('change', () => applyFiscalRules());
      productModalFields.ipiBase?.addEventListener('input', () => applyFiscalRules());
      productModalFields.ipiAliq?.addEventListener('input', () => applyFiscalRules());
      productModalFields.pisCst?.addEventListener('change', () => applyFiscalRules());
      productModalFields.pisAliq?.addEventListener('input', () => applyFiscalRules());
      productModalFields.cofinsCst?.addEventListener('change', () => applyFiscalRules());
      productModalFields.cofinsAliq?.addEventListener('input', () => applyFiscalRules());
      productModalFields.qtyTrib?.addEventListener('input', () => {
        syncModalQuantities('qtyTrib');
        applyFiscalRules();
      });
      productModalFields.unidadeComercial?.addEventListener('change', () => {
        syncModalQuantities('qty');
        applyFiscalRules();
      });
      productModalFields.unidadeTributavel?.addEventListener('change', () => {
        syncModalQuantities('qty');
        applyFiscalRules();
      });

      actionButtons.manage?.addEventListener('click', () => {
        openManageModal();
      });

      document.addEventListener('click', (event) => {
        const modal = document.getElementById(manageModalId);
        if (!modal || modal.classList.contains('hidden')) return;
        if (event.target === modal) closeManageModal();
      });
      document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-manage-close]');
        if (button) closeManageModal();
      });
      document.addEventListener('click', (event) => {
        const button = event.target.closest('.manage-action-btn');
        if (!button) return;
        const label = button.textContent?.trim() || '';
        handleManageAction(label).catch((error) => {
          console.error('nfe:manage-action', error);
          if (typeof showToast === 'function') {
            showToast(error?.message || 'Nao foi possivel executar a acao.', 'error');
          }
          if (error?.message) {
            addHistory(error.message);
            updateManageModalContent();
          }
        });
      });
      document.addEventListener('click', (event) => {
        const modal = document.getElementById(eventsModalId);
        if (!modal || modal.classList.contains('hidden')) return;
        if (event.target === modal) closeEventsModal();
      });
      document.addEventListener('click', (event) => {
        const closeButton = event.target.closest('[data-events-close]');
        if (closeButton) {
          closeEventsModal();
          return;
        }
        const sendButton = event.target.closest('#nfe-events-send');
        if (!sendButton) return;
        if (sendButton.dataset.loading === 'true') return;
        withLoading(
          sendButton,
          async () => {
            try {
              await submitNfeEvent();
            } catch (error) {
              if (typeof showToast === 'function') {
                showToast(error?.message || 'Nao foi possivel registrar o evento.', 'error');
              }
              throw error;
            }
          },
          'Enviando...'
        ).catch(() => null);
      });

    extraInputs.frete?.addEventListener('input', updateTotals);
    extraInputs.outros?.addEventListener('input', updateTotals);
    extraInputs.frete?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    extraInputs.outros?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    crediarioFields.value?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    chequeFields.value?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    extraInputs.paymentValue?.addEventListener('input', updatePaymentKpis);
    extraInputs.paymentValue?.addEventListener('blur', (event) => {
      formatMoneyInput(event.target);
      updatePaymentKpis();
    });
    crediarioFields.add?.addEventListener('click', handleCrediarioGenerate);
    crediarioFields.reset?.addEventListener('click', resetCrediarioRows);
    crediarioFields.table?.addEventListener('blur', handleCrediarioTableBlur, true);
    crediarioFields.table?.addEventListener('input', updatePaymentKpis);
    crediarioFields.table?.addEventListener('click', handleCrediarioTableClick);
    chequeFields.client?.addEventListener('input', handleChequeClientInput);
    chequeFields.client?.addEventListener('blur', handleChequeClientBlur);
    chequeFields.client?.addEventListener('keydown', handleChequeClientKeyDown);
    chequeFields.reset?.addEventListener('click', resetChequeFields);
    chequeFields.add?.addEventListener('click', handleChequeAdd);
    chequeFields.table?.addEventListener('blur', handleChequeTableBlur, true);
    chequeFields.table?.addEventListener('input', updatePaymentKpis);
    chequeFields.table?.addEventListener('click', handleChequeTableClick);
    cardFields.value?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    cardFields.add?.addEventListener('click', handleCardAdd);
    cardFields.reset?.addEventListener('click', resetCardFields);
    cardFields.table?.addEventListener('blur', handleCardTableBlur, true);
    cardFields.table?.addEventListener('input', updatePaymentKpis);
    cardFields.table?.addEventListener('click', handleCardTableClick);
    cashFields.value?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    cashFields.add?.addEventListener('click', handleCashAdd);
    cashFields.reset?.addEventListener('click', resetCashFields);
    cashFields.table?.addEventListener('blur', handleCashTableBlur, true);
    cashFields.table?.addEventListener('input', updatePaymentKpis);
    cashFields.table?.addEventListener('click', handleCashTableClick);
    pixFields.value?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    pixFields.add?.addEventListener('click', handlePixAdd);
    pixFields.reset?.addEventListener('click', resetPixFields);
    pixFields.table?.addEventListener('blur', handlePixTableBlur, true);
    pixFields.table?.addEventListener('input', updatePaymentKpis);
    pixFields.table?.addEventListener('click', handlePixTableClick);
    otherFields.value?.addEventListener('blur', (event) => formatMoneyInput(event.target));
    otherFields.add?.addEventListener('click', handleOtherAdd);
    otherFields.reset?.addEventListener('click', resetOtherFields);
      otherFields.table?.addEventListener('blur', handleOtherTableBlur, true);
      otherFields.table?.addEventListener('input', updatePaymentKpis);
      otherFields.table?.addEventListener('click', handleOtherTableClick);

      volumeFields.add?.addEventListener('click', () => {
        const prefill = {
          identificacao: volumeFields.identificacao?.value || '',
          especie: volumeFields.especie?.value || '',
          marca: volumeFields.marca?.value || '',
          quantidade: volumeFields.quantidade?.value || '',
          pesoBruto: volumeFields.pesoBruto?.value || '',
          pesoLiquido: volumeFields.pesoLiquido?.value || '',
          cubagem: volumeFields.cubagem?.value || '',
        };
        addVolumeRow(prefill);
      });
      volumeFields.reset?.addEventListener('click', resetVolumeFields);
      volumesBody?.addEventListener('dblclick', (event) => {
        const row = event.target.closest('tr[data-volume-row]');
        if (!row) return;
        row.remove();
        if (!volumesBody.querySelector('tr[data-volume-row]') && volumesEmpty) {
          volumesBody.appendChild(volumesEmpty);
        }
      });

      refFields.add?.addEventListener('click', () => {
        const chave = refFields.chave?.value?.trim() || '';
        if (!chave) return;
        addRefRow({ numero: chave, dataEmissao: '', emissor: '' });
        refFields.chave.value = '';
      });

      document.querySelectorAll('[data-nfe-dados-tab]').forEach((button) => {
        button.addEventListener('click', () => setDadosTab(button.dataset.nfeDadosTab || 'dados'));
      });

    clientFields.doc?.addEventListener('blur', () => {
      validateDocument();
      updateConsumerFinalFromDoc();
    });
    clientFields.doc?.addEventListener('input', () => {
      validateDocument();
      updateConsumerFinalFromDoc();
    });

    clientFields.ie?.addEventListener('input', () => {
      selectedPartyIsentoIE = /^isento$/i.test(String(clientFields.ie.value || '').trim());
    });

    partyTypeSelect?.addEventListener('change', handlePartyTypeChange);
    partySearchInput?.addEventListener('input', handlePartySearchInput);
    partySearchInput?.addEventListener('blur', handlePartySearchBlur);
    partySearchInput?.addEventListener('keydown', handlePartySearchKeyDown);
    codeInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      loadDraftByCode().catch((error) => {
        console.error('nfe:load-by-code', error);
        if (typeof showToast === 'function') {
          showToast(error?.message || 'Nao foi possivel carregar o registro.', 'error');
        }
      });
    });
    codeInput?.addEventListener('blur', () => {
      if (!getInputValue(codeInput)) return;
      loadDraftByCode().catch((error) => {
        console.error('nfe:load-by-code', error);
        if (typeof showToast === 'function') {
          showToast(error?.message || 'Nao foi possivel carregar o registro.', 'error');
        }
      });
    });
    numberInput?.addEventListener('blur', () => {
      if (!getInputValue(numberInput)) return;
      loadDraftByNumber().catch((error) => {
        console.error('nfe:load-by-number', error);
        if (typeof showToast === 'function') {
          showToast(error?.message || 'Nao foi possivel carregar a NF-e.', 'error');
        }
      });
    });
    productCodeInput?.addEventListener('keydown', handleProductCodeKeydown);
    naturezaOperacaoSelect?.addEventListener('change', () => {
      syncModalCfopOptionsFromNatureza();
    });
      operationSelect?.addEventListener('change', () => {
        syncStockMovementWithOperation();
        loadNaturezaOperacaoOptions();
      });
      serieFields.select?.addEventListener('change', handleSerieChange);
      serieFields.select?.addEventListener('focus', () => updateSerieSelectDisplay(true));
      serieFields.select?.addEventListener('blur', () => updateSerieSelectDisplay(false));

    actionButtons.save?.addEventListener('click', () => {
      withLoading(actionButtons.save, async () => {
        try {
          await saveDraft();
          if (typeof showToast === 'function') {
            showToast('Rascunho salvo com sucesso.', 'success');
          }
        } catch (error) {
          console.error('nfe:save', error);
          if (typeof showToast === 'function') {
            showToast(error?.message || 'Nao foi possivel salvar o rascunho.', 'error');
          }
        }
      }, 'Salvando...');
    });

    actionButtons.validate?.addEventListener('click', () => {
      withLoading(actionButtons.validate, async () => {
        const ok = validateBeforeEmit();
        if (!ok) {
          if (typeof showToast === 'function') {
            showToast('Revise os campos obrigat\u00f3rios antes de validar.', 'warning');
          }
          return;
        }
        setStatus('ready');
        if (typeof showToast === 'function') {
          showToast('NF-e validada e pronta para envio.', 'success');
        }
      }, 'Validando...');
    });

    actionButtons.emit?.addEventListener('click', () => {
      withLoading(actionButtons.emit, async () => {
        const ok = validateBeforeEmit();
        if (!ok) {
          if (typeof showToast === 'function') {
            showToast('Corrija os itens e impostos antes de emitir.', 'error');
          }
          return;
        }
        setStatus('authorized');
        if (typeof showToast === 'function') {
          showToast('NF-e emitida com sucesso.', 'success');
        }
      }, 'Emitindo...');
    });

    actionButtons.view?.addEventListener('click', () => {
      if (typeof showModal === 'function') {
        showModal({
          title: 'Visualizar DANFE',
          message: 'Pr\u00e9-visualiza\u00e7\u00e3o do DANFE ser\u00e1 exibida ap\u00f3s integra\u00e7\u00e3o com o m\u00f3dulo fiscal.',
          confirmText: 'Ok',
        });
      }
    });

    actionButtons.status?.addEventListener('click', () => {
      if (typeof showModal === 'function') {
        showModal({
          title: 'Status SEFAZ',
          message: 'Consulta SEFAZ pendente de integra\u00e7\u00e3o. Mantenha o certificado fiscal atualizado.',
          confirmText: 'Ok',
        });
      }
    });

    actionButtons.cancel?.addEventListener('click', () => {
      if (currentStatus !== 'authorized') return;
      if (typeof showModal !== 'function') return;
      showModal({
        title: 'Cancelar NF-e',
        message: 'Deseja cancelar esta NF-e autorizada?',
        confirmText: 'Cancelar NF-e',
        cancelText: 'Voltar',
        onConfirm: () => {
          setStatus('canceled');
          if (typeof showToast === 'function') {
            showToast('NF-e cancelada com sucesso.', 'success');
          }
          return true;
        },
      });
    });
  }

  function init() {
    setIssueDate();
    setNewNumber();
    updateTotals();
    updateActionAvailability();
    updatePartySearchPlaceholder();
    loadEmitente();
    loadStockDeposits();
      loadFiscalSeries();
      loadNaturezaOperacaoOptions();
    captureDefaultState(true);
      bindEvents();
      renderItemTableHeader();
      setupItemTableControls();
      syncItemColumnWidths();
      renderVolumeTableHeader();
      setupVolumeTableControls();
      renderRefTableHeader();
      setupRefTableControls();
      populateUnitOptions();
      setDadosTab('dados');
      initTabs();
      initPaymentTabs();
      initMasks();
      try {
        if (sessionStorage.getItem(INVALID_CODE_FLAG) === '1') {
          sessionStorage.removeItem(INVALID_CODE_FLAG);
          applyDefaultState();
          if (codeInput) codeInput.value = '';
          currentDraftId = '';
          currentDraftCode = '';
        }
      } catch (_) {
        // ignore storage errors
      }
    }

  init();
})();
