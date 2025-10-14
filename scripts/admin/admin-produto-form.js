document.addEventListener('DOMContentLoaded', () => {
    
    // --- REFERÊNCIAS AO DOM ---
    const form = document.getElementById('edit-product-form');
    const submitButton = form?.querySelector('button[type="submit"]');
    const clearFormButton = document.getElementById('clear-form-button');
    const imageUploadInput = document.getElementById('imageUpload');
    const existingImagesGrid = document.getElementById('existing-images-grid');
    const pageTitle = document.getElementById('product-page-title');
    const pageDescription = document.getElementById('product-page-description');
    const categoryTagsContainer = document.getElementById('category-tags-container');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const categoryModal = document.getElementById('category-modal');
    const categoryTreeContainer = document.getElementById('category-tree-container');
    const saveCategoryModalBtn = document.getElementById('save-category-modal-btn');
    const cancelCategoryModalBtn = document.getElementById('cancel-category-modal-btn');
    const closeCategoryModalBtn = document.getElementById('close-category-modal-btn');
    const supplierNameInput = document.getElementById('supplier-name');
    const supplierProductNameInput = document.getElementById('supplier-product-name');
    const supplierProductCodeInput = document.getElementById('supplier-product-code');
    const supplierEntryUnitSelect = document.getElementById('supplier-entry-unit');
    const supplierCalcTypeSelect = document.getElementById('supplier-calc-type');
    const supplierCalcValueInput = document.getElementById('supplier-calc-value');
    const addSupplierBtn = document.getElementById('add-supplier-btn');
    const supplierListContainer = document.getElementById('supplier-list');
    const supplierSuggestionsContainer = document.getElementById('supplier-suggestions');
    const depositTableBody = document.getElementById('deposit-stock-tbody');
    const depositEmptyState = document.getElementById('deposit-empty-state');
    const depositTableWrapper = document.getElementById('deposit-table-wrapper');
    const depositTotalDisplay = document.getElementById('deposit-total-display');
    const skuInput = document.getElementById('cod');
    const nameInput = document.getElementById('nome');
    const barcodeInput = document.getElementById('codbarras');
    const detailedDescriptionInput = document.getElementById('descricao');
    const unitSelect = document.getElementById('unidade');
    const inactiveCheckbox = document.getElementById('inativo');
    const fiscalCompanySelect = document.getElementById('fiscal-company-select');
    const fiscalCompanySummary = document.getElementById('fiscal-company-summary');

    const FISCAL_GENERAL_KEY = '__general__';
    const fiscalStatusLabels = {
        pendente: 'Pendente',
        parcial: 'Parcial',
        aprovado: 'Aprovado',
    };
    const fiscalStatusStyles = {
        pendente: 'bg-amber-100 text-amber-800 border border-amber-200',
        parcial: 'bg-sky-100 text-sky-800 border border-sky-200',
        aprovado: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    };

    let storesList = [];
    let storeNameMap = new Map();
    let fiscalByCompany = new Map([[FISCAL_GENERAL_KEY, {}]]);
    let activeFiscalCompanyKey = FISCAL_GENERAL_KEY;

    const fiscalInputs = {
        origem: document.getElementById('fiscal-origem'),
        csosn: document.getElementById('fiscal-csosn'),
        cst: document.getElementById('fiscal-cst'),
        cest: document.getElementById('fiscal-cest'),
        statusNfe: document.getElementById('fiscal-status-nfe'),
        statusNfce: document.getElementById('fiscal-status-nfce'),
        cfop: {
            nfe: {
                interno: document.getElementById('fiscal-cfop-nfe-interno'),
                interestadual: document.getElementById('fiscal-cfop-nfe-interestadual'),
                transferencia: document.getElementById('fiscal-cfop-nfe-transferencia'),
                devolucao: document.getElementById('fiscal-cfop-nfe-devolucao'),
                industrializacao: document.getElementById('fiscal-cfop-nfe-industrializacao'),
            },
            nfce: {
                interno: document.getElementById('fiscal-cfop-nfce-interno'),
                interestadual: document.getElementById('fiscal-cfop-nfce-interestadual'),
                transferencia: document.getElementById('fiscal-cfop-nfce-transferencia'),
                devolucao: document.getElementById('fiscal-cfop-nfce-devolucao'),
                industrializacao: document.getElementById('fiscal-cfop-nfce-industrializacao'),
            },
        },
        pis: {
            codigo: document.getElementById('fiscal-pis-codigo'),
            cst: document.getElementById('fiscal-pis-cst'),
            aliquota: document.getElementById('fiscal-pis-aliquota'),
            tipo: document.getElementById('fiscal-pis-tipo'),
        },
        cofins: {
            codigo: document.getElementById('fiscal-cofins-codigo'),
            cst: document.getElementById('fiscal-cofins-cst'),
            aliquota: document.getElementById('fiscal-cofins-aliquota'),
            tipo: document.getElementById('fiscal-cofins-tipo'),
        },
        ipi: {
            cst: document.getElementById('fiscal-ipi-cst'),
            enquadramento: document.getElementById('fiscal-ipi-enquadramento'),
            aliquota: document.getElementById('fiscal-ipi-aliquota'),
            tipo: document.getElementById('fiscal-ipi-tipo'),
        },
        fcp: {
            indicador: document.getElementById('fiscal-fcp-indicador'),
            aliquota: document.getElementById('fiscal-fcp-aliquota'),
            aplica: document.getElementById('fiscal-fcp-aplica'),
        },
    };

    const parseNullableNumber = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const setInputValue = (input, value) => {
        if (!input) return;
        if (input.type === 'checkbox') {
            input.checked = Boolean(value);
        } else if (input.tagName === 'SELECT') {
            input.value = value !== undefined && value !== null ? String(value) : '';
        } else {
            input.value = value !== undefined && value !== null ? value : '';
        }
    };

    const populateFiscalFields = (fiscal = {}) => {
        setInputValue(fiscalInputs.origem, fiscal?.origem || '0');
        setInputValue(fiscalInputs.csosn, fiscal?.csosn || '');
        setInputValue(fiscalInputs.cst, fiscal?.cst || '');
        setInputValue(fiscalInputs.cest, fiscal?.cest || '');
        setInputValue(fiscalInputs.statusNfe, fiscal?.status?.nfe || 'pendente');
        setInputValue(fiscalInputs.statusNfce, fiscal?.status?.nfce || 'pendente');

        const cfopNfe = fiscal?.cfop?.nfe || {};
        const cfopNfce = fiscal?.cfop?.nfce || {};
        setInputValue(fiscalInputs.cfop.nfe.interno, cfopNfe?.dentroEstado || '');
        setInputValue(fiscalInputs.cfop.nfe.interestadual, cfopNfe?.foraEstado || '');
        setInputValue(fiscalInputs.cfop.nfe.transferencia, cfopNfe?.transferencia || '');
        setInputValue(fiscalInputs.cfop.nfe.devolucao, cfopNfe?.devolucao || '');
        setInputValue(fiscalInputs.cfop.nfe.industrializacao, cfopNfe?.industrializacao || '');
        setInputValue(fiscalInputs.cfop.nfce.interno, cfopNfce?.dentroEstado || '');
        setInputValue(fiscalInputs.cfop.nfce.interestadual, cfopNfce?.foraEstado || '');
        setInputValue(fiscalInputs.cfop.nfce.transferencia, cfopNfce?.transferencia || '');
        setInputValue(fiscalInputs.cfop.nfce.devolucao, cfopNfce?.devolucao || '');
        setInputValue(fiscalInputs.cfop.nfce.industrializacao, cfopNfce?.industrializacao || '');

        const pis = fiscal?.pis || {};
        setInputValue(fiscalInputs.pis.codigo, pis?.codigo || '');
        setInputValue(fiscalInputs.pis.cst, pis?.cst || '');
        setInputValue(fiscalInputs.pis.aliquota, pis?.aliquota ?? '');
        setInputValue(fiscalInputs.pis.tipo, pis?.tipoCalculo || 'percentual');

        const cofins = fiscal?.cofins || {};
        setInputValue(fiscalInputs.cofins.codigo, cofins?.codigo || '');
        setInputValue(fiscalInputs.cofins.cst, cofins?.cst || '');
        setInputValue(fiscalInputs.cofins.aliquota, cofins?.aliquota ?? '');
        setInputValue(fiscalInputs.cofins.tipo, cofins?.tipoCalculo || 'percentual');

        const ipi = fiscal?.ipi || {};
        setInputValue(fiscalInputs.ipi.cst, ipi?.cst || '');
        setInputValue(fiscalInputs.ipi.enquadramento, ipi?.codigoEnquadramento || '');
        setInputValue(fiscalInputs.ipi.aliquota, ipi?.aliquota ?? '');
        setInputValue(fiscalInputs.ipi.tipo, ipi?.tipoCalculo || 'percentual');

        const fcp = fiscal?.fcp || {};
        setInputValue(fiscalInputs.fcp.indicador, fcp?.indicador || '0');
        setInputValue(fiscalInputs.fcp.aliquota, fcp?.aliquota ?? '');
        setInputValue(fiscalInputs.fcp.aplica, fcp?.aplica || false);
    };

    const collectFiscalData = () => ({
        origem: fiscalInputs.origem?.value || '0',
        csosn: fiscalInputs.csosn?.value?.trim() || '',
        cst: fiscalInputs.cst?.value?.trim() || '',
        cest: fiscalInputs.cest?.value?.trim() || '',
        status: {
            nfe: fiscalInputs.statusNfe?.value || 'pendente',
            nfce: fiscalInputs.statusNfce?.value || 'pendente',
        },
        cfop: {
            nfe: {
                dentroEstado: fiscalInputs.cfop.nfe.interno?.value?.trim() || '',
                foraEstado: fiscalInputs.cfop.nfe.interestadual?.value?.trim() || '',
                transferencia: fiscalInputs.cfop.nfe.transferencia?.value?.trim() || '',
                devolucao: fiscalInputs.cfop.nfe.devolucao?.value?.trim() || '',
                industrializacao: fiscalInputs.cfop.nfe.industrializacao?.value?.trim() || '',
            },
            nfce: {
                dentroEstado: fiscalInputs.cfop.nfce.interno?.value?.trim() || '',
                foraEstado: fiscalInputs.cfop.nfce.interestadual?.value?.trim() || '',
                transferencia: fiscalInputs.cfop.nfce.transferencia?.value?.trim() || '',
                devolucao: fiscalInputs.cfop.nfce.devolucao?.value?.trim() || '',
                industrializacao: fiscalInputs.cfop.nfce.industrializacao?.value?.trim() || '',
            },
        },
        pis: {
            codigo: fiscalInputs.pis.codigo?.value?.trim() || '',
            cst: fiscalInputs.pis.cst?.value?.trim() || '',
            aliquota: parseNullableNumber(fiscalInputs.pis.aliquota?.value ?? null),
            tipoCalculo: fiscalInputs.pis.tipo?.value || 'percentual',
        },
        cofins: {
            codigo: fiscalInputs.cofins.codigo?.value?.trim() || '',
            cst: fiscalInputs.cofins.cst?.value?.trim() || '',
            aliquota: parseNullableNumber(fiscalInputs.cofins.aliquota?.value ?? null),
            tipoCalculo: fiscalInputs.cofins.tipo?.value || 'percentual',
        },
        ipi: {
            cst: fiscalInputs.ipi.cst?.value?.trim() || '',
            codigoEnquadramento: fiscalInputs.ipi.enquadramento?.value?.trim() || '',
            aliquota: parseNullableNumber(fiscalInputs.ipi.aliquota?.value ?? null),
            tipoCalculo: fiscalInputs.ipi.tipo?.value || 'percentual',
        },
        fcp: {
            indicador: fiscalInputs.fcp.indicador?.value || '0',
            aliquota: parseNullableNumber(fiscalInputs.fcp.aliquota?.value ?? null),
            aplica: Boolean(fiscalInputs.fcp.aplica?.checked),
        },
    });

    const getSelectedProductUnit = () => (unitSelect?.value || '').trim();

    const cloneFiscalObject = (fiscal = {}) => JSON.parse(JSON.stringify(fiscal || {}));

    const getDefaultFiscalSnapshot = () => ({
        origem: '0',
        csosn: '',
        cst: '',
        cest: '',
        status: { nfe: 'pendente', nfce: 'pendente' },
        cfop: {
            nfe: {
                dentroEstado: '',
                foraEstado: '',
                transferencia: '',
                devolucao: '',
                industrializacao: '',
            },
            nfce: {
                dentroEstado: '',
                foraEstado: '',
                transferencia: '',
                devolucao: '',
                industrializacao: '',
            },
        },
        pis: { codigo: '', cst: '', aliquota: null, tipoCalculo: 'percentual' },
        cofins: { codigo: '', cst: '', aliquota: null, tipoCalculo: 'percentual' },
        ipi: { cst: '', codigoEnquadramento: '', aliquota: null, tipoCalculo: 'percentual' },
        fcp: { indicador: '0', aliquota: null, aplica: false },
    });

    const isEmptyString = (value) => {
        if (value === null || value === undefined) return true;
        return String(value).trim() === '';
    };

    const isFiscalSnapshotDefault = (snapshot = {}) => {
        if (!snapshot || typeof snapshot !== 'object') return true;

        const {
            origem = '0',
            csosn = '',
            cst = '',
            cest = '',
            status = {},
            cfop = {},
            pis = {},
            cofins = {},
            ipi = {},
            fcp = {},
        } = snapshot;

        if (origem !== '0') return false;
        if (!isEmptyString(csosn)) return false;
        if (!isEmptyString(cst)) return false;
        if (!isEmptyString(cest)) return false;

        const statusNfe = status.nfe || 'pendente';
        const statusNfce = status.nfce || 'pendente';
        if (statusNfe !== 'pendente' || statusNfce !== 'pendente') return false;

        const cfopFields = ['dentroEstado', 'foraEstado', 'transferencia', 'devolucao', 'industrializacao'];
        const cfopNfe = cfop.nfe || {};
        const cfopNfce = cfop.nfce || {};
        if (cfopFields.some((field) => !isEmptyString(cfopNfe[field] || ''))) return false;
        if (cfopFields.some((field) => !isEmptyString(cfopNfce[field] || ''))) return false;

        const checkTax = (tax = {}) => {
            const codigo = tax.codigo || '';
            const cstValue = tax.cst || '';
            const aliquota = tax.aliquota;
            const tipo = tax.tipoCalculo || 'percentual';
            if (!isEmptyString(codigo)) return false;
            if (!isEmptyString(cstValue)) return false;
            if (Number.isFinite(aliquota)) return false;
            if (tipo !== 'percentual') return false;
            return true;
        };

        if (!checkTax(pis)) return false;
        if (!checkTax(cofins)) return false;

        const ipiCst = ipi.cst || '';
        const ipiEnquadramento = ipi.codigoEnquadramento || '';
        const ipiAliquota = ipi.aliquota;
        const ipiTipo = ipi.tipoCalculo || 'percentual';
        if (!isEmptyString(ipiCst)) return false;
        if (!isEmptyString(ipiEnquadramento)) return false;
        if (Number.isFinite(ipiAliquota)) return false;
        if (ipiTipo !== 'percentual') return false;

        const fcpIndicador = fcp.indicador || '0';
        const fcpAliquota = fcp.aliquota;
        const fcpAplica = Boolean(fcp.aplica);
        if (fcpIndicador !== '0') return false;
        if (Number.isFinite(fcpAliquota)) return false;
        if (fcpAplica) return false;

        return true;
    };

    const getStoreDisplayName = (store = {}) => store.nome || store.nomeFantasia || store.razaoSocial || 'Empresa sem nome';

    const isKnownCompanyKey = (key) => {
        if (!key) return false;
        if (key === FISCAL_GENERAL_KEY) return true;
        if (storeNameMap.has(key)) return true;
        return fiscalByCompany.has(key);
    };

    const getCompanyNameByKey = (key) => {
        if (key === FISCAL_GENERAL_KEY) return 'Configuração geral do produto';
        return storeNameMap.get(key) || `Empresa não encontrada (${key})`;
    };

    const buildStatusBadge = (label, statusValue) => {
        const normalizedStatus = fiscalStatusLabels[statusValue] ? statusValue : 'pendente';
        const text = fiscalStatusLabels[normalizedStatus];
        const classes = fiscalStatusStyles[normalizedStatus] || fiscalStatusStyles.pendente;
        return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${classes}">${label}: ${text}</span>`;
    };

    const updateFiscalCompanySummary = () => {
        if (!fiscalCompanySummary) return;
        const currentData = fiscalByCompany.get(activeFiscalCompanyKey) || getDefaultFiscalSnapshot();
        const statusNfe = currentData?.status?.nfe || 'pendente';
        const statusNfce = currentData?.status?.nfce || 'pendente';
        const companyName = getCompanyNameByKey(activeFiscalCompanyKey);
        const note = activeFiscalCompanyKey === FISCAL_GENERAL_KEY
            ? 'Aplica-se como padrão para empresas sem configuração específica.'
            : 'Configuração exclusiva para a empresa selecionada.';

        fiscalCompanySummary.innerHTML = `
            <div class="flex flex-col gap-2 text-sm text-gray-600 md:items-end">
                <span class="font-medium text-gray-700">${companyName}</span>
                <div class="flex flex-wrap gap-2">
                    ${buildStatusBadge('NF-e', statusNfe)}
                    ${buildStatusBadge('NFC-e', statusNfce)}
                </div>
                <p class="text-xs text-gray-500 md:text-right">${note}</p>
            </div>
        `;
    };

    const populateFiscalCompanySelect = (preferredKey = FISCAL_GENERAL_KEY) => {
        if (!fiscalCompanySelect) return;
        const knownStoreIds = new Set(storesList.map((store) => store._id));
        const options = [
            `<option value="${FISCAL_GENERAL_KEY}">Configuração geral</option>`,
        ];

        storesList.forEach((store) => {
            const label = getStoreDisplayName(store);
            options.push(`<option value="${store._id}">${label}</option>`);
            storeNameMap.set(store._id, label);
        });

        const extraKeys = Array.from(fiscalByCompany.keys())
            .filter((key) => key !== FISCAL_GENERAL_KEY && !knownStoreIds.has(key));

        extraKeys.forEach((key) => {
            if (!storeNameMap.has(key)) {
                storeNameMap.set(key, `Empresa não encontrada (${key})`);
            }
            options.push(`<option value="${key}">${storeNameMap.get(key)}</option>`);
        });

        fiscalCompanySelect.innerHTML = options.join('');
        const normalizedPreferred = isKnownCompanyKey(preferredKey) ? preferredKey : FISCAL_GENERAL_KEY;
        fiscalCompanySelect.value = normalizedPreferred;
        activeFiscalCompanyKey = normalizedPreferred;
    };

    const persistActiveFiscalData = () => {
        if (!activeFiscalCompanyKey) return;
        const snapshot = collectFiscalData();
        if (activeFiscalCompanyKey === FISCAL_GENERAL_KEY) {
            fiscalByCompany.set(FISCAL_GENERAL_KEY, snapshot);
            return;
        }
        if (isFiscalSnapshotDefault(snapshot)) {
            fiscalByCompany.delete(activeFiscalCompanyKey);
        } else {
            fiscalByCompany.set(activeFiscalCompanyKey, snapshot);
        }
    };

    // --- LÓGICA DAS ABAS (Geral / Especificações) ---
    const productTabLinks = document.querySelectorAll('#product-tabs .tab-link');
    const productTabContents = {};
    productTabLinks.forEach((btn) => {
        const tabId = btn.dataset.tab;
        if (tabId) {
            productTabContents[tabId] = document.getElementById(tabId);
        }
    });

    function activateProductTab(tabId) {
        Object.entries(productTabContents).forEach(([id, el]) => {
            if (!el) return;
            if (id === tabId) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        productTabLinks.forEach((btn) => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('text-primary', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.classList.toggle('border-primary', isActive);
            btn.classList.toggle('border-transparent', !isActive);
        });
    }

    if (productTabLinks.length) {
        productTabLinks.forEach((btn) => {
            btn.addEventListener('click', () => activateProductTab(btn.dataset.tab));
        });
        const initialTab = document.querySelector('#product-tabs .tab-link.text-primary')?.dataset.tab || productTabLinks[0]?.dataset.tab;
        if (initialTab) activateProductTab(initialTab);
    }

    // --- ESTADO DA PÁGINA ---
    const urlParams = new URLSearchParams(window.location.search);
    let productId = urlParams.get('id');
    let isEditMode = Boolean(productId);
    let productCategories = []; // Array de IDs das categorias selecionadas
    let allHierarchicalCategories = []; // Guarda a árvore de categorias
    let allFlatCategories = []; // Lista plana de categorias para consultas rápidas
    let supplierEntries = [];
    let allDeposits = [];
    const depositStockMap = new Map();
    let lastSelectedProductUnit = getSelectedProductUnit();
    let duplicateCheckInProgress = false;

    const supplierDirectoryState = {
        items: [],
        loadingPromise: null,
        error: null,
        matches: [],
    };
    let supplierSearchDebounce = null;

    const digitsOnly = (value = '') => {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\D+/g, '');
    };

    const normalizeSearchText = (value = '') => {
        if (value === null || value === undefined) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
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

    const formatDocument = (value) => {
        const digits = digitsOnly(value);
        if (digits.length === 14) {
            return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }
        if (digits.length === 11) {
            return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        return digits;
    };

    const formatPhone = (value) => {
        const digits = digitsOnly(value);
        if (digits.length === 11) {
            return digits.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2$3-$4');
        }
        if (digits.length === 10) {
            return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
        }
        if (digits.length === 9) {
            return digits.replace(/(\d{5})(\d{4})/, '$1-$2');
        }
        if (digits.length === 8) {
            return digits.replace(/(\d{4})(\d{4})/, '$1-$2');
        }
        return digits;
    };

    const getSupplierDisplayName = (supplier) => {
        if (!supplier || typeof supplier !== 'object') return '';
        const fantasy = typeof supplier.fantasyName === 'string' ? supplier.fantasyName.trim() : '';
        const legal = typeof supplier.legalName === 'string' ? supplier.legalName.trim() : '';
        const generic = typeof supplier.name === 'string' ? supplier.name.trim() : '';
        return fantasy || legal || generic;
    };

    const getSupplierInitials = (supplier) => {
        const displayName = getSupplierDisplayName(supplier);
        if (!displayName) return 'F';
        const parts = displayName.trim().split(/\s+/).slice(0, 2);
        const initials = parts
            .map((part) => part.charAt(0).toUpperCase())
            .join('');
        return initials || displayName.charAt(0).toUpperCase();
    };

    const loadSupplierDirectory = async () => {
        try {
            let token = null;
            try {
                token = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || null;
            } catch (storageError) {
                console.error('Erro ao recuperar token do usuário logado:', storageError);
            }

            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`${API_CONFIG.BASE_URL}/suppliers`, { headers });
            if (!response.ok) {
                const error = new Error(
                    response.status === 401
                        ? 'Sua sessão expirou. Faça login novamente para carregar os fornecedores.'
                        : `Erro ao carregar fornecedores (${response.status})`,
                );
                error.status = response.status;
                throw error;
            }
            const payload = await response.json();
            const suppliers = Array.isArray(payload?.suppliers) ? payload.suppliers : [];
            supplierDirectoryState.items = suppliers;
            supplierDirectoryState.error = null;
            return suppliers;
        } catch (error) {
            supplierDirectoryState.items = [];
            supplierDirectoryState.error = error;
            throw error;
        }
    };

    const ensureSuppliersLoaded = async () => {
        if (supplierDirectoryState.items.length) return supplierDirectoryState.items;
        if (!supplierDirectoryState.loadingPromise) {
            supplierDirectoryState.loadingPromise = loadSupplierDirectory().finally(() => {
                supplierDirectoryState.loadingPromise = null;
            });
        }
        return supplierDirectoryState.loadingPromise;
    };

    const setSupplierInputExpanded = (expanded) => {
        if (!supplierNameInput) return;
        supplierNameInput.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };

    const hideSupplierSuggestions = () => {
        if (!supplierSuggestionsContainer) return;
        supplierSuggestionsContainer.classList.add('hidden');
        supplierSuggestionsContainer.innerHTML = '';
        supplierDirectoryState.matches = [];
        setSupplierInputExpanded(false);
        supplierNameInput?.removeAttribute('aria-busy');
    };

    const showSupplierSuggestionsMessage = (message, { tone = 'info', actionLabel = null, onAction = null } = {}) => {
        if (!supplierSuggestionsContainer) return;
        supplierDirectoryState.matches = [];
        const iconClass = tone === 'error'
            ? 'fa-triangle-exclamation text-red-500'
            : tone === 'loading'
                ? 'fa-circle-notch fa-spin text-primary'
                : 'fa-circle-info text-primary';
        const textClass = tone === 'error' ? 'text-red-600' : 'text-gray-600';
        const actionHtml = actionLabel
            ? `<button type="button" class="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-supplier-suggestions-action="primary">${escapeHtml(actionLabel)}</button>`
            : '';
        supplierSuggestionsContainer.innerHTML = `
            <div class="px-4 py-4 text-sm">
                <div class="flex items-start gap-3">
                    <i class="fas ${iconClass} mt-1"></i>
                    <div class="flex-1">
                        <p class="${textClass}">${message}</p>
                        ${actionHtml ? `<div class="flex flex-wrap gap-2">${actionHtml}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
        supplierSuggestionsContainer.classList.remove('hidden');
        setSupplierInputExpanded(true);
        if (tone === 'loading') {
            supplierNameInput?.setAttribute('aria-busy', 'true');
        } else {
            supplierNameInput?.removeAttribute('aria-busy');
        }
        if (actionHtml && typeof onAction === 'function') {
            const actionButton = supplierSuggestionsContainer.querySelector('[data-supplier-suggestions-action="primary"]');
            actionButton?.addEventListener('click', (event) => {
                event.preventDefault();
                onAction();
            });
        }
    };

    const filterSupplierDirectory = (term, { allowEmpty = false } = {}) => {
        const trimmed = typeof term === 'string' ? term.trim() : '';
        if (!trimmed) {
            return allowEmpty ? supplierDirectoryState.items.slice(0, 6) : [];
        }
        const normalizedTerm = normalizeSearchText(trimmed);
        const digitsTerm = digitsOnly(trimmed);
        const hasText = normalizedTerm.length > 0;
        const hasDigits = digitsTerm.length > 0;
        if (!hasText && !hasDigits) return [];
        const matches = supplierDirectoryState.items.filter((supplier) => {
            let matched = false;
            if (hasText) {
                const candidates = [
                    supplier?.legalName,
                    supplier?.fantasyName,
                    supplier?.name,
                    supplier?.contact?.responsible,
                    supplier?.address?.cidade,
                    supplier?.address?.bairro,
                ];
                matched = candidates.some((field) => normalizeSearchText(field).includes(normalizedTerm));
            }
            if (!matched && hasDigits) {
                const digitCandidates = [
                    supplier?.cnpj,
                    supplier?.contact?.phone,
                    supplier?.contact?.mobile,
                    supplier?.contact?.secondaryPhone,
                    supplier?.codeNumber,
                    supplier?.code,
                ];
                matched = digitCandidates.some((field) => digitsOnly(field).includes(digitsTerm));
            }
            return matched;
        });
        return matches.slice(0, 8);
    };

    const handleSupplierButtonKeydown = (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const next = target.nextElementSibling;
            if (next instanceof HTMLElement) {
                next.focus();
            } else {
                supplierNameInput?.focus();
            }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const previous = target.previousElementSibling;
            if (previous instanceof HTMLElement) {
                previous.focus();
            } else {
                supplierNameInput?.focus();
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            hideSupplierSuggestions();
            supplierNameInput?.focus();
        }
    };

    const selectSupplierSuggestion = (index) => {
        const supplier = supplierDirectoryState.matches[index];
        if (!supplier || !supplierNameInput) return;
        const displayName = getSupplierDisplayName(supplier) || supplier.fornecedor || supplier.nome || '';
        supplierNameInput.value = displayName;
        if (supplier?._id) {
            supplierNameInput.dataset.selectedSupplierId = supplier._id;
        } else {
            delete supplierNameInput.dataset.selectedSupplierId;
        }
        if (supplier?.cnpj) {
            supplierNameInput.dataset.selectedSupplierDocument = digitsOnly(supplier.cnpj);
        } else {
            delete supplierNameInput.dataset.selectedSupplierDocument;
        }
        supplierNameInput.removeAttribute('aria-busy');
        hideSupplierSuggestions();
        supplierNameInput.focus();
    };

    const renderSupplierSuggestionCards = (results, term) => {
        if (!supplierSuggestionsContainer) return;
        supplierDirectoryState.matches = results;
        if (!results.length) {
            const message = term
                ? `Nenhum fornecedor encontrado para "${escapeHtml(term)}".`
                : 'Cadastre fornecedores para vinculá-los aos produtos.';
            showSupplierSuggestionsMessage(message, { tone: 'info' });
            return;
        }
        const cards = results
            .map((supplier, index) => {
                const displayName = getSupplierDisplayName(supplier) || 'Fornecedor sem nome';
                const documentLabel = supplier?.cnpj ? formatDocument(supplier.cnpj) : '';
                const supplierCode = supplier?.code
                    || (typeof supplier?.codeNumber === 'number' ? String(supplier.codeNumber).padStart(4, '0') : '');
                const locationParts = [supplier?.address?.cidade, supplier?.address?.uf]
                    .map((part) => (typeof part === 'string' ? part.trim() : ''))
                    .filter(Boolean);
                const locationLabel = locationParts.join(' - ');
                const contactBits = [];
                if (supplier?.contact?.responsible) {
                    contactBits.push(`<span class="inline-flex items-center gap-1"><i class="fas fa-user text-[10px]"></i>${escapeHtml(supplier.contact.responsible)}</span>`);
                }
                const phoneLabel = supplier?.contact?.mobile || supplier?.contact?.phone || '';
                if (phoneLabel) {
                    contactBits.push(`<span class="inline-flex items-center gap-1"><i class="fas fa-phone text-[10px]"></i>${escapeHtml(formatPhone(phoneLabel))}</span>`);
                }
                if (supplier?.contact?.email) {
                    contactBits.push(`<span class="inline-flex items-center gap-1"><i class="fas fa-envelope text-[10px]"></i>${escapeHtml(supplier.contact.email)}</span>`);
                }
                const badges = [];
                if (supplier?.flags?.inactive) {
                    badges.push('<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Inativo</span>');
                }
                if (supplier?.flags?.ong) {
                    badges.push('<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">ONG</span>');
                }
                if (supplier?.flags?.bankSupplier) {
                    badges.push('<span class="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Fornecedor bancário</span>');
                }
                const badgesLine = badges.length ? `<div class="mt-1 flex flex-wrap items-center gap-2">${badges.join('')}</div>` : '';
                const metadata = [];
                if (documentLabel) {
                    metadata.push(`<span class="inline-flex items-center gap-1"><i class="fas fa-id-card text-[10px]"></i>${escapeHtml(documentLabel)}</span>`);
                }
                if (supplierCode) {
                    metadata.push(`<span class="inline-flex items-center gap-1"><i class="fas fa-hashtag text-[10px]"></i>${escapeHtml(supplierCode)}</span>`);
                }
                const metadataLine = metadata.length
                    ? `<div class="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">${metadata.join('<span class="text-gray-300">•</span>')}</div>`
                    : '';
                const locationLine = locationLabel
                    ? `<div class="mt-1 text-[11px] text-gray-500"><i class="fas fa-location-dot text-[10px] mr-1"></i>${escapeHtml(locationLabel)}</div>`
                    : '';
                const contactLine = contactBits.length
                    ? `<div class="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">${contactBits.join('<span class="text-gray-300">•</span>')}</div>`
                    : '';
                const initials = getSupplierInitials(supplier);
                return `
                    <button type="button" class="supplier-suggestion flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-primary/5 focus:bg-primary/10 focus:outline-none" data-supplier-index="${index}" role="option" aria-selected="false">
                        <span class="mt-1 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">${escapeHtml(initials)}</span>
                        <span class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-gray-800 truncate">${escapeHtml(displayName)}</span>
                            ${metadataLine}
                            ${badgesLine}
                            ${locationLine}
                            ${contactLine}
                        </span>
                    </button>
                `;
            })
            .join('');
        supplierSuggestionsContainer.innerHTML = cards;
        supplierSuggestionsContainer.classList.remove('hidden');
        setSupplierInputExpanded(true);
        supplierNameInput?.removeAttribute('aria-busy');
        const buttons = supplierSuggestionsContainer.querySelectorAll('[data-supplier-index]');
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number(button.dataset.supplierIndex);
                selectSupplierSuggestion(Number.isFinite(index) ? index : 0);
            });
            button.addEventListener('keydown', handleSupplierButtonKeydown);
        });
    };

    const requestSupplierSuggestions = async (term, { allowEmpty = false } = {}) => {
        const value = typeof term === 'string' ? term : '';
        const trimmed = value.trim();
        if (!trimmed && !allowEmpty) {
            hideSupplierSuggestions();
            return;
        }
        if (!supplierDirectoryState.items.length) {
            showSupplierSuggestionsMessage('Carregando fornecedores cadastrados...', { tone: 'loading' });
            try {
                await ensureSuppliersLoaded();
            } catch (error) {
                console.error('Erro ao carregar fornecedores para sugestão:', error);
                const unauthorized = Number(error?.status) === 401;
                showSupplierSuggestionsMessage(
                    unauthorized
                        ? 'Sua sessão expirou. Faça login novamente para buscar fornecedores.'
                        : 'Não foi possível carregar os fornecedores cadastrados. Tente novamente.',
                    {
                        tone: 'error',
                        actionLabel: unauthorized ? 'Ir para login' : 'Tentar novamente',
                        onAction: unauthorized
                            ? () => {
                                window.location.href = '/pages/login.html';
                            }
                            : () => requestSupplierSuggestions(term, { allowEmpty }),
                    },
                );
                return;
            }
        }
        if (!supplierDirectoryState.items.length) {
            showSupplierSuggestionsMessage('Cadastre fornecedores para vinculá-los aos produtos.', { tone: 'info' });
            return;
        }
        const results = filterSupplierDirectory(trimmed, { allowEmpty });
        if (!results.length) {
            if (trimmed || !allowEmpty) {
                showSupplierSuggestionsMessage(`Nenhum fornecedor encontrado para "${escapeHtml(trimmed)}".`, { tone: 'info' });
            } else {
                showSupplierSuggestionsMessage('Cadastre fornecedores para vinculá-los aos produtos.', { tone: 'info' });
            }
            return;
        }
        renderSupplierSuggestionCards(results, trimmed);
    };

    const makeFieldEditable = (input) => {
        if (!input) return;
        input.disabled = false;
        input.classList.remove('bg-gray-100', 'cursor-not-allowed');
    };

    const setSubmitButtonIdleText = () => {
        if (!submitButton) return;
        submitButton.innerHTML = isEditMode ? 'Salvar Alterações' : 'Cadastrar Produto';
    };

    setSubmitButtonIdleText();

    const ensureDepositEntry = (depositId) => {
        if (!depositStockMap.has(depositId)) {
            depositStockMap.set(depositId, { quantidade: null, unidade: getSelectedProductUnit() });
        }
    };

    const updateDepositTotalDisplay = () => {
        if (!depositTotalDisplay) return;
        let total = 0;
        depositStockMap.forEach((entry) => {
            const value = Number(entry?.quantidade);
            if (Number.isFinite(value)) {
                total += value;
            }
        });
        depositTotalDisplay.textContent = total.toLocaleString('pt-BR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 3,
        });
    };

    const renderDepositStockRows = () => {
        if (!depositTableBody) return;
        const selectedUnit = getSelectedProductUnit();

        if (!Array.isArray(allDeposits) || allDeposits.length === 0) {
            depositTableBody.innerHTML = '';
            depositEmptyState?.classList.remove('hidden');
            depositTableWrapper?.classList.add('hidden');
            updateDepositTotalDisplay();
            return;
        }

        depositEmptyState?.classList.add('hidden');
        depositTableWrapper?.classList.remove('hidden');
        depositTableBody.innerHTML = '';

        allDeposits.forEach((deposit) => {
            const depositId = deposit._id;
            ensureDepositEntry(depositId);
            const entry = depositStockMap.get(depositId) || { quantidade: null, unidade: selectedUnit };
            const normalizedUnit = (entry?.unidade || '').trim() || selectedUnit;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-4 py-3 text-gray-700">
                    <div class="font-medium text-gray-800">${deposit.nome}</div>
                    <div class="text-xs text-gray-500">${deposit.codigo}${deposit?.empresa?.nome ? ` • ${deposit.empresa.nome}` : ''}</div>
                </td>
                <td class="px-4 py-3">
                    <input type="number" step="0.001" class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary" data-deposit-id="${depositId}" data-deposit-field="quantidade">
                </td>
                <td class="px-4 py-3">
                    <input type="text" class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary" data-deposit-id="${depositId}" data-deposit-field="unidade" placeholder="Ex.: UN, CX">
                </td>
            `;

            const qtyInput = tr.querySelector('input[data-deposit-field="quantidade"]');
            const unitInput = tr.querySelector('input[data-deposit-field="unidade"]');

            depositStockMap.set(depositId, {
                quantidade: entry?.quantidade ?? null,
                unidade: normalizedUnit,
            });

            if (qtyInput) {
                const quantityValue = entry?.quantidade;
                qtyInput.value = quantityValue === null || quantityValue === undefined ? '' : quantityValue;
                qtyInput.addEventListener('input', (event) => {
                    const rawValue = event.target.value;
                    const parsed = rawValue === '' ? null : Number(rawValue);
                    const current = depositStockMap.get(depositId) || { quantidade: null, unidade: selectedUnit };
                    const currentUnit = (current?.unidade || '').trim() || selectedUnit;
                    depositStockMap.set(depositId, {
                        quantidade: rawValue === '' ? null : (Number.isFinite(parsed) ? parsed : current.quantidade),
                        unidade: currentUnit,
                    });
                    updateDepositTotalDisplay();
                });
            }

            if (unitInput) {
                unitInput.value = normalizedUnit;
                unitInput.addEventListener('input', (event) => {
                    const current = depositStockMap.get(depositId) || { quantidade: null, unidade: selectedUnit };
                    depositStockMap.set(depositId, {
                        quantidade: current.quantidade,
                        unidade: event.target.value.trim(),
                    });
                });
            }

            depositTableBody.appendChild(tr);
        });

        updateDepositTotalDisplay();
        lastSelectedProductUnit = getSelectedProductUnit();
    };

    const applyDepositsFromProduct = (product) => {
        depositStockMap.clear();
        if (Array.isArray(allDeposits)) {
            allDeposits.forEach((deposit) => {
                depositStockMap.set(deposit._id, { quantidade: null, unidade: getSelectedProductUnit() });
            });
        }

        if (Array.isArray(product?.estoques)) {
            product.estoques.forEach((estoque) => {
                const depositId = estoque?.deposito?._id || estoque?.deposito;
                if (!depositId) return;
                const quantidadeNumber = Number(estoque?.quantidade);
                depositStockMap.set(depositId, {
                    quantidade: Number.isFinite(quantidadeNumber) ? quantidadeNumber : null,
                    unidade: (estoque?.unidade || '').trim() || getSelectedProductUnit(),
                });
            });
        }

        renderDepositStockRows();
    };

    const resetSupplierForm = () => {
        if (supplierNameInput) {
            supplierNameInput.value = '';
            delete supplierNameInput.dataset.selectedSupplierId;
            delete supplierNameInput.dataset.selectedSupplierDocument;
        }
        if (supplierProductNameInput) supplierProductNameInput.value = '';
        if (supplierProductCodeInput) supplierProductCodeInput.value = '';
        if (supplierEntryUnitSelect) supplierEntryUnitSelect.value = '';
        if (supplierCalcTypeSelect) supplierCalcTypeSelect.value = '';
        if (supplierCalcValueInput) supplierCalcValueInput.value = '';
        hideSupplierSuggestions();
    };

    const renderSupplierEntries = () => {
        if (!supplierListContainer) return;
        supplierListContainer.innerHTML = '';

        if (!supplierEntries.length) {
            supplierListContainer.innerHTML = '<p class="text-sm text-gray-500">Nenhum fornecedor adicional adicionado.</p>';
            return;
        }

        supplierEntries.forEach((entry, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'border border-gray-200 rounded-md p-4 bg-gray-50';

            const title = document.createElement('div');
            title.className = 'flex items-start justify-between gap-4';

            const infoContainer = document.createElement('div');
            infoContainer.className = 'space-y-1 text-sm text-gray-700';

            const supplierLine = document.createElement('p');
            const supplierName = escapeHtml(entry.fornecedor || '—');
            const supplierDocument = entry.documentoFornecedor ? formatDocument(entry.documentoFornecedor) : '';
            const supplierDocumentHtml = supplierDocument
                ? ` <span class="ml-2 inline-flex items-center gap-1 text-xs text-gray-500"><i class="fas fa-id-card text-[10px]"></i>${escapeHtml(supplierDocument)}</span>`
                : '';
            supplierLine.innerHTML = `<span class="font-semibold">Fornecedor:</span> ${supplierName}${supplierDocumentHtml}`;
            const productNameLine = document.createElement('p');
            productNameLine.innerHTML = `<span class="font-semibold">Nome do produto no fornecedor:</span> ${escapeHtml(entry.nomeProdutoFornecedor || '—')}`;
            const codeLine = document.createElement('p');
            codeLine.innerHTML = `<span class="font-semibold">Código do produto:</span> ${escapeHtml(entry.codigoProduto || '—')}`;
            const unitLine = document.createElement('p');
            unitLine.innerHTML = `<span class="font-semibold">Unidade de entrada:</span> ${escapeHtml(entry.unidadeEntrada || '—')}`;
            const calcLine = document.createElement('p');
            const valorCalculo = Number.isFinite(entry.valorCalculo) ? entry.valorCalculo : '—';
            const calcLabel = escapeHtml(entry.tipoCalculo || '—');
            const calcValueLabel = valorCalculo !== '—' ? ` (${valorCalculo})` : '';
            calcLine.innerHTML = `<span class="font-semibold">Cálculo:</span> ${calcLabel}${calcValueLabel}`;

            infoContainer.appendChild(supplierLine);
            infoContainer.appendChild(productNameLine);
            infoContainer.appendChild(codeLine);
            infoContainer.appendChild(unitLine);
            infoContainer.appendChild(calcLine);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'text-xs font-semibold text-red-600 hover:text-red-700';
            removeBtn.textContent = 'Remover';
            removeBtn.addEventListener('click', () => {
                supplierEntries.splice(index, 1);
                renderSupplierEntries();
            });

            title.appendChild(infoContainer);
            title.appendChild(removeBtn);
            wrapper.appendChild(title);
            supplierListContainer.appendChild(wrapper);
        });
    };

    // --- CAMPOS RELACIONADOS A PREÇOS ---
    const costInput = document.getElementById('custo');
    const saleInput = document.getElementById('venda');
    const markupInput = document.getElementById('markup');
    let isUpdatingFromMarkup = false;
    let isUpdatingFromPrice = false;

    const updateMarkupFromValues = () => {
        if (!costInput || !saleInput || !markupInput || isUpdatingFromMarkup) return;
        const cost = parseFloat(costInput.value);
        const sale = parseFloat(saleInput.value);

        if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(sale)) {
            markupInput.value = '';
            return;
        }

        const markup = ((sale - cost) / cost) * 100;
        isUpdatingFromPrice = true;
        markupInput.value = Number.isFinite(markup) ? markup.toFixed(2) : '';
        isUpdatingFromPrice = false;
    };

    const updateSaleFromMarkup = () => {
        if (!costInput || !saleInput || !markupInput || isUpdatingFromPrice) return;
        const cost = parseFloat(costInput.value);
        const markup = parseFloat(markupInput.value);

        if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(markup)) return;

        const sale = cost * (1 + (markup / 100));
        isUpdatingFromMarkup = true;
        saleInput.value = Number.isFinite(sale) ? sale.toFixed(2) : '';
        isUpdatingFromMarkup = false;
        updateMarkupFromValues();
    };

    costInput?.addEventListener('input', updateMarkupFromValues);
    saleInput?.addEventListener('input', updateMarkupFromValues);
    markupInput?.addEventListener('input', updateSaleFromMarkup);

    // --- FUNÇÕES DE LÓGICA ---
    const renderCategoryTags = (categories) => {
        categoryTagsContainer.innerHTML = '';
        if (categories.length === 0) {
            categoryTagsContainer.innerHTML = `<span class="text-sm text-gray-500">Nenhuma categoria associada.</span>`;
            return;
        }
        categories.forEach(cat => {
            const tag = document.createElement('span');
            tag.className = "inline-flex items-center bg-gray-200 text-gray-700 text-xs font-medium px-2 py-1 rounded-full";
            tag.textContent = cat.nome;
            categoryTagsContainer.appendChild(tag);
        });
    };

    const populateCategoryTree = (categories, selectedIds) => {
        const createList = (categories, depth = 0) => {
            const ul = document.createElement('ul');
            if (depth > 0) ul.className = 'pl-5';
            
            categories.forEach(cat => {
                const li = document.createElement('li');
                li.className = 'mb-2';
                
                const label = document.createElement('label');
                label.className = 'inline-flex items-center space-x-2';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = cat._id;
                checkbox.checked = selectedIds.includes(cat._id);
                
                const span = document.createElement('span');
                span.textContent = cat.nome;
                
                label.appendChild(checkbox);
                label.appendChild(span);
                li.appendChild(label);

                if (cat.children && cat.children.length > 0) {
                    li.appendChild(createList(cat.children, depth + 1));
                }

                ul.appendChild(li);
            });
            return ul;
        };
        categoryTreeContainer.innerHTML = '';
        categoryTreeContainer.appendChild(createList(categories));
    };

    const prepareFormForCreation = () => {
        duplicateCheckInProgress = false;
        form?.reset();
        pageTitle.textContent = 'Cadastrar Produto';
        if (pageDescription) {
            pageDescription.textContent = 'Preencha os dados do novo produto abaixo.';
        }

        makeFieldEditable(skuInput);
        makeFieldEditable(nameInput);
        makeFieldEditable(barcodeInput);

        if (skuInput) skuInput.value = '';
        if (nameInput) nameInput.value = '';
        if (barcodeInput) barcodeInput.value = '';
        if (detailedDescriptionInput) detailedDescriptionInput.value = '';
        if (imageUploadInput) imageUploadInput.value = '';

        productCategories = [];
        renderCategoryTags([]);

        supplierEntries = [];
        renderSupplierEntries();
        resetSupplierForm();

        fiscalByCompany = new Map();
        fiscalByCompany.set(FISCAL_GENERAL_KEY, getDefaultFiscalSnapshot());
        activeFiscalCompanyKey = FISCAL_GENERAL_KEY;
        populateFiscalCompanySelect(FISCAL_GENERAL_KEY);
        populateFiscalFields(fiscalByCompany.get(FISCAL_GENERAL_KEY));
        updateFiscalCompanySummary();

        depositStockMap.clear();
        renderDepositStockRows();
        updateDepositTotalDisplay();
        lastSelectedProductUnit = getSelectedProductUnit();

        if (existingImagesGrid) {
            existingImagesGrid.innerHTML = '<p class="text-sm text-gray-500">Nenhuma imagem cadastrada até o momento.</p>';
        }

        document.querySelectorAll('input[name="spec-idade"], input[name="spec-pet"], input[name="spec-porte"]').forEach((input) => {
            if (input instanceof HTMLInputElement) {
                input.checked = false;
            }
        });

        updateMarkupFromValues();
        setSubmitButtonIdleText();
    };

    const fetchProductSummaryByIdentifier = async (identifierType, identifierValue) => {
        const params = new URLSearchParams();
        params.set(identifierType, identifierValue);
        const response = await fetch(`${API_CONFIG.BASE_URL}/products/check-unique?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Não foi possível verificar o produto informado.');
        }
        const payload = await response.json();
        if (!payload?.exists || !payload?.product) {
            return null;
        }
        return payload.product;
    };

    const loadProductForEditing = async (targetProductId) => {
        if (!targetProductId) {
            throw new Error('Produto não informado.');
        }
        const productResponse = await fetch(`${API_CONFIG.BASE_URL}/products/${targetProductId}`);
        if (!productResponse.ok) {
            throw new Error('Não foi possível carregar o produto selecionado.');
        }
        const productPayload = await productResponse.json();
        populateForm(productPayload);
    };

    const handleDuplicateIdentifier = (identifierType) => async () => {
        if (duplicateCheckInProgress) return;

        const inputRef = identifierType === 'cod' ? skuInput : barcodeInput;
        const rawValue = inputRef?.value ?? '';
        const trimmedValue = rawValue.trim();
        if (!trimmedValue) return;

        duplicateCheckInProgress = true;

        try {
            const productSummary = await fetchProductSummaryByIdentifier(identifierType, trimmedValue);
            if (!productSummary) {
                if (identifierType === 'cod') {
                    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                        window.showToast('Produto não foi encontrado.', 'warning', 4000);
                    }
                    if (inputRef) {
                        inputRef.value = '';
                        inputRef.focus();
                    }
                }
                return;
            }

            const currentProductId = productId ? String(productId) : null;
            const duplicateProductId = productSummary?._id ? String(productSummary._id) : null;
            if (currentProductId && duplicateProductId && currentProductId === duplicateProductId) {
                return;
            }

            await showModal({
                title: 'Produto já cadastrado',
                message: `O produto "${productSummary.nome}" já está cadastrado. Deseja visualizá-lo?`,
                confirmText: 'Sim',
                cancelText: 'Não',
                onConfirm: async () => {
                    productId = productSummary._id;
                    isEditMode = true;
                    setSubmitButtonIdleText();
                    try {
                        await loadProductForEditing(productId);
                    } catch (error) {
                        console.error('Falha ao carregar produto existente:', error);
                        showModal({ title: 'Erro', message: error.message || 'Não foi possível carregar o produto selecionado.', confirmText: 'Entendi' });
                    }
                },
                onCancel: () => {
                    productId = null;
                    isEditMode = false;
                    prepareFormForCreation();
                },
            });
        } catch (error) {
            console.error('Erro ao verificar duplicidade de produto:', error);
            showModal({ title: 'Erro', message: error.message || 'Não foi possível verificar o produto informado.', confirmText: 'Entendi' });
        } finally {
            duplicateCheckInProgress = false;
        }
    };

    const populateForm = (product) => {
        duplicateCheckInProgress = false;
        makeFieldEditable(skuInput);
        makeFieldEditable(nameInput);
        makeFieldEditable(barcodeInput);
        setSubmitButtonIdleText();
        pageTitle.textContent = `Editar Produto: ${product.nome}`;
        if (pageDescription) {
            pageDescription.textContent = 'Altere os dados do produto abaixo.';
        }
        form.querySelector('#nome').value = product.nome || '';
        form.querySelector('#marca').value = product.marca || '';
        form.querySelector('#cod').value = product.cod || '';
        form.querySelector('#codbarras').value = product.codbarras || '';
        form.querySelector('#descricao').value = product.descricao || '';
        setInputValue(inactiveCheckbox, product.inativo);
        if (unitSelect) {
            unitSelect.value = product.unidade || '';
            lastSelectedProductUnit = getSelectedProductUnit();
        }
        if (form.querySelector('#referencia')) {
            form.querySelector('#referencia').value = product.referencia || '';
        }
        const dataCadastroInput = form.querySelector('#data-cadastro');
        if (dataCadastroInput) {
            const rawDate = product.dataCadastro || product.createdAt || '';
            if (rawDate) {
                const rawDateStr = String(rawDate);
                const [datePart] = rawDateStr.split('T');
                if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
                    dataCadastroInput.value = datePart;
                } else {
                    const parsedDate = new Date(rawDateStr);
                    dataCadastroInput.value = Number.isNaN(parsedDate.getTime())
                        ? ''
                        : parsedDate.toISOString().split('T')[0];
                }
            } else {
                dataCadastroInput.value = '';
            }
        }
        const pesoInput = form.querySelector('#peso');
        if (pesoInput) {
            const pesoValue = Number(product.peso);
            pesoInput.value = Number.isFinite(pesoValue) ? pesoValue : '';
        }
        const iatSelect = form.querySelector('#iat');
        if (iatSelect) {
            iatSelect.value = product.iat || '';
        }
        const tipoProdutoSelect = form.querySelector('#tipo-produto');
        if (tipoProdutoSelect) {
            tipoProdutoSelect.value = product.tipoProduto || '';
        }
        const ncmInput = form.querySelector('#ncm');
        if (ncmInput) {
            ncmInput.value = product.ncm || '';
        }

        const preferredCompanyKey = fiscalCompanySelect?.value || activeFiscalCompanyKey || FISCAL_GENERAL_KEY;
        fiscalByCompany = new Map();
        fiscalByCompany.set(FISCAL_GENERAL_KEY, cloneFiscalObject(product.fiscal || {}));
        if (product.fiscalPorEmpresa && typeof product.fiscalPorEmpresa === 'object') {
            Object.entries(product.fiscalPorEmpresa).forEach(([storeId, fiscalData]) => {
                fiscalByCompany.set(storeId, cloneFiscalObject(fiscalData || {}));
                if (!storeNameMap.has(storeId)) {
                    storeNameMap.set(storeId, `Empresa não encontrada (${storeId})`);
                }
            });
        }

        populateFiscalCompanySelect(preferredCompanyKey);
        const activeFiscalData = fiscalByCompany.get(activeFiscalCompanyKey) || getDefaultFiscalSnapshot();
        populateFiscalFields(activeFiscalData);
        updateFiscalCompanySummary();
        supplierEntries = Array.isArray(product.fornecedores)
            ? product.fornecedores.map((item) => ({
                fornecedor: item.fornecedor || '',
                fornecedorId: item.fornecedorId || item.supplierId || null,
                documentoFornecedor: item.documentoFornecedor || item.cnpjFornecedor || item.cnpj || '',
                nomeProdutoFornecedor: item.nomeProdutoFornecedor || '',
                codigoProduto: item.codigoProduto || item.codigo || '',
                unidadeEntrada: item.unidadeEntrada || item.unidade || '',
                tipoCalculo: item.tipoCalculo || '',
                valorCalculo: Number.isFinite(Number(item.valorCalculo)) ? Number(item.valorCalculo) : null,
            }))
            : [];
        renderSupplierEntries();
        resetSupplierForm();
        applyDepositsFromProduct(product);
        if (form.querySelector('#barcode-additional')) {
            form.querySelector('#barcode-additional').value = Array.isArray(product.codigosComplementares) ? product.codigosComplementares.join('\n') : '';
        }
        const custoNumber = Number(product.custo);
        const vendaNumber = Number(product.venda);
        form.querySelector('#custo').value = Number.isFinite(custoNumber) ? custoNumber.toFixed(2) : '';
        form.querySelector('#venda').value = Number.isFinite(vendaNumber) ? vendaNumber.toFixed(2) : '';
        if (markupInput) {
            const cost = parseFloat(costInput?.value || '0');
            const sale = parseFloat(saleInput?.value || '0');
            if (Number.isFinite(cost) && cost > 0 && Number.isFinite(sale)) {
                const markup = ((sale - cost) / cost) * 100;
                markupInput.value = Number.isFinite(markup) ? markup.toFixed(2) : '';
            } else {
                markupInput.value = '';
            }
        }

        const categoriasAtuais = Array.isArray(product.categorias) ? product.categorias : [];
        productCategories = categoriasAtuais.map(cat => cat._id);
        renderCategoryTags(categoriasAtuais);

        const imagens = Array.isArray(product.imagens) ? product.imagens : [];
        if (existingImagesGrid) {
            if (imagens.length > 0) {
                existingImagesGrid.innerHTML = imagens.map(imgUrl => `
                    <div class="relative group">
                        <img src="${API_CONFIG.SERVER_URL}${imgUrl}" alt="Imagem do produto" class="w-full h-24 object-cover rounded-md border">
                        <div class="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button" class="delete-image-btn text-white text-xs bg-red-600 hover:bg-red-700 px-2 py-1 rounded" data-image-url="${imgUrl}">Apagar</button>
                        </div>
                    </div>
                `).join('');
            } else {
                existingImagesGrid.innerHTML = '<p class="text-sm text-gray-500">Nenhuma imagem cadastrada até o momento.</p>';
            }
        }

        // --- Especificações ---
        const espec = product.especificacoes || {};
        // Idade
        document.querySelectorAll('input[name="spec-idade"]').forEach(cb => {
            cb.checked = Array.isArray(espec.idade) ? espec.idade.includes(cb.value) : false;
        });
        // Pet
        document.querySelectorAll('input[name="spec-pet"]').forEach(cb => {
            cb.checked = Array.isArray(espec.pet) ? espec.pet.includes(cb.value) : false;
        });
        // Porte Raça
        document.querySelectorAll('input[name="spec-porte"]').forEach(cb => {
            cb.checked = Array.isArray(espec.porteRaca) ? espec.porteRaca.includes(cb.value) : false;
        });
        // Apresentação
        const apInput = document.getElementById('spec-apresentacao');
        if (apInput) apInput.value = espec.apresentacao || '';
        // Código de barras (somente visual)
        const eanInput = document.getElementById('spec-codbarras');
        if (eanInput) eanInput.value = product.codbarras || '';

        updateMarkupFromValues();
    };

    const getBrandFromCategories = (selectedCategoryObjects) => {
        if (!selectedCategoryObjects?.length || !allFlatCategories?.length) return '';
        const categoryMap = new Map(allFlatCategories.map(cat => [cat._id.toString(), cat]));
        for (const selectedCat of selectedCategoryObjects) {
            let current = selectedCat;
            while (current && current.parent) {
                const parent = categoryMap.get(current.parent.toString());
                if (parent && parent.nome === 'Marcas') {
                    return selectedCat.nome;
                }
                current = parent;
            }
        }
        return '';
    };

    const initializePage = async () => {
        try {
            const fetchers = [
                fetch(`${API_CONFIG.BASE_URL}/categories/hierarchical`),
                fetch(`${API_CONFIG.BASE_URL}/categories`),
                fetch(`${API_CONFIG.BASE_URL}/deposits`),
                fetch(`${API_CONFIG.BASE_URL}/stores`),
            ];

            let productPromise = null;
            if (isEditMode && productId) {
                productPromise = fetch(`${API_CONFIG.BASE_URL}/products/${productId}`);
                fetchers.unshift(productPromise);
            }

            const responses = await Promise.all(fetchers);

            let index = 0;
            let productResponse = null;
            if (isEditMode && productId) {
                productResponse = responses[index++];
            }

            const hierarchicalRes = responses[index++];
            const flatRes = responses[index++];
            const depositsRes = responses[index++];
            const storesRes = responses[index++];

            if (isEditMode && productId && productResponse?.status === 404) {
                console.warn('Produto não encontrado. A página será aberta para cadastro de um novo item.');
                isEditMode = false;
                productId = null;
                productResponse = null;
            }

            const hasErrored =
                !hierarchicalRes.ok ||
                !flatRes.ok ||
                !depositsRes.ok ||
                !storesRes.ok ||
                (isEditMode && productId && !productResponse?.ok);

            if (hasErrored) {
                throw new Error('Falha ao carregar os dados iniciais da página.');
            }

            allHierarchicalCategories = await hierarchicalRes.json();
            allFlatCategories = await flatRes.json();
            const depositsPayload = await depositsRes.json();
            allDeposits = Array.isArray(depositsPayload?.deposits)
                ? depositsPayload.deposits
                : Array.isArray(depositsPayload)
                    ? depositsPayload
                    : [];
            const storesPayload = await storesRes.json();
            storesList = Array.isArray(storesPayload) ? storesPayload : [];
            storeNameMap = new Map(storesList.map((store) => [store._id, getStoreDisplayName(store)]));

            if (isEditMode && productId && productResponse) {
                const product = await productResponse.json();
                populateForm(product);
            } else {
                prepareFormForCreation();
            }

            populateCategoryTree(allHierarchicalCategories, productCategories);

        } catch (error) {
            console.error('Erro ao inicializar a página:', error);
            showModal({ title: 'Erro', message: error.message, confirmText: 'Voltar', onConfirm: () => window.location.href = 'admin-produtos.html' });
        }

    };
    
    // --- EVENT LISTENERS ---
    fiscalCompanySelect?.addEventListener('change', () => {
        persistActiveFiscalData();
        const selectedKey = fiscalCompanySelect.value || FISCAL_GENERAL_KEY;
        activeFiscalCompanyKey = isKnownCompanyKey(selectedKey) ? selectedKey : FISCAL_GENERAL_KEY;
        if (!storeNameMap.has(activeFiscalCompanyKey) && activeFiscalCompanyKey !== FISCAL_GENERAL_KEY) {
            storeNameMap.set(activeFiscalCompanyKey, `Empresa não encontrada (${activeFiscalCompanyKey})`);
        }
        const nextFiscalData = fiscalByCompany.get(activeFiscalCompanyKey) || getDefaultFiscalSnapshot();
        populateFiscalFields(nextFiscalData);
        updateFiscalCompanySummary();
    });

    [fiscalInputs.statusNfe, fiscalInputs.statusNfce].forEach((statusInput) => {
        statusInput?.addEventListener('change', () => {
            persistActiveFiscalData();
            updateFiscalCompanySummary();
        });
    });

    addCategoryBtn.addEventListener('click', () => {
        populateCategoryTree(allHierarchicalCategories, productCategories);
        categoryModal.classList.remove('hidden');
    });
    cancelCategoryModalBtn.addEventListener('click', () => categoryModal.classList.add('hidden'));
    closeCategoryModalBtn.addEventListener('click', () => categoryModal.classList.add('hidden'));

    const debounceSupplierSuggestions = (value, allowEmpty) => {
        if (supplierSearchDebounce) {
            clearTimeout(supplierSearchDebounce);
        }
        supplierSearchDebounce = window.setTimeout(() => {
            requestSupplierSuggestions(value, { allowEmpty });
        }, 180);
    };

    const handleSupplierInputEvent = () => {
        if (!supplierNameInput) return;
        delete supplierNameInput.dataset.selectedSupplierId;
        delete supplierNameInput.dataset.selectedSupplierDocument;
        debounceSupplierSuggestions(supplierNameInput.value || '', false);
    };

    const handleAddSupplier = () => {
        const fornecedor = supplierNameInput?.value.trim();
        const nomeProdutoFornecedor = supplierProductNameInput?.value.trim();
        const codigoProduto = supplierProductCodeInput?.value.trim();
        const unidadeEntrada = supplierEntryUnitSelect?.value;
        const tipoCalculo = supplierCalcTypeSelect?.value;
        const valorCalculoRaw = supplierCalcValueInput?.value.trim();

        const fornecedorId = supplierNameInput?.dataset?.selectedSupplierId || null;
        const documentoFornecedor = supplierNameInput?.dataset?.selectedSupplierDocument || '';

        if (!fornecedor) {
            alert('Informe o nome do fornecedor.');
            return;
        }
        if (!unidadeEntrada) {
            alert('Selecione a unidade de entrada.');
            return;
        }
        if (!tipoCalculo) {
            alert('Selecione o tipo de cálculo.');
            return;
        }

        let valorCalculo = null;
        if (valorCalculoRaw) {
            const parsed = Number(valorCalculoRaw);
            if (!Number.isFinite(parsed)) {
                alert('Informe um valor de cálculo válido.');
                return;
            }
            valorCalculo = parsed;
        }

        supplierEntries.push({
            fornecedor,
            fornecedorId,
            documentoFornecedor,
            nomeProdutoFornecedor,
            codigoProduto,
            unidadeEntrada,
            tipoCalculo,
            valorCalculo,
        });
        renderSupplierEntries();
        resetSupplierForm();
    };

    supplierNameInput?.addEventListener('input', handleSupplierInputEvent);
    supplierNameInput?.addEventListener('focus', () => {
        if (!supplierNameInput) return;
        debounceSupplierSuggestions(supplierNameInput.value || '', true);
    });
    supplierNameInput?.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            const firstOption = supplierSuggestionsContainer?.querySelector('[data-supplier-index="0"]');
            if (firstOption instanceof HTMLElement) {
                event.preventDefault();
                firstOption.focus();
            }
        } else if (event.key === 'Escape') {
            hideSupplierSuggestions();
        }
    });
    supplierNameInput?.addEventListener('blur', () => {
        window.setTimeout(() => {
            const active = document.activeElement;
            if (supplierSuggestionsContainer && supplierSuggestionsContainer.contains(active)) {
                return;
            }
            hideSupplierSuggestions();
        }, 120);
    });

    supplierSuggestionsContainer?.addEventListener('focusout', () => {
        window.setTimeout(() => {
            const active = document.activeElement;
            if (supplierSuggestionsContainer &&
                supplierSuggestionsContainer.contains(active)) {
                return;
            }
            if (active === supplierNameInput) return;
            hideSupplierSuggestions();
        }, 120);
    });

    document.addEventListener('click', (event) => {
        if (!supplierSuggestionsContainer || !supplierNameInput) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (supplierSuggestionsContainer.contains(target) || target === supplierNameInput) {
            return;
        }
        hideSupplierSuggestions();
    });

    addSupplierBtn?.addEventListener('click', handleAddSupplier);

    skuInput?.addEventListener('blur', handleDuplicateIdentifier('cod'));
    barcodeInput?.addEventListener('blur', handleDuplicateIdentifier('codbarras'));

    clearFormButton?.addEventListener('click', () => {
        productId = null;
        isEditMode = false;
        duplicateCheckInProgress = false;
        prepareFormForCreation();
        try {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.delete('id');
            window.history.replaceState({}, '', currentUrl.toString());
        } catch (urlError) {
            console.warn('Não foi possível atualizar a URL ao limpar o formulário.', urlError);
        }
    });

    unitSelect?.addEventListener('change', () => {
        const newUnit = getSelectedProductUnit();
        depositStockMap.forEach((entry, depositId) => {
            const quantidade = entry?.quantidade ?? null;
            const currentUnit = (entry?.unidade || '').trim();
            if (!currentUnit || currentUnit === lastSelectedProductUnit) {
                depositStockMap.set(depositId, { quantidade, unidade: newUnit });
            } else {
                depositStockMap.set(depositId, { quantidade, unidade: currentUnit });
            }
        });
        lastSelectedProductUnit = newUnit;
        renderDepositStockRows();
    });

    const handleSaveCategories = () => {
        const selectedCheckboxes = categoryTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
        productCategories = Array.from(selectedCheckboxes).map(cb => cb.value);

        const selectedCategoryObjects = allFlatCategories.filter(cat => productCategories.includes(cat._id));
        renderCategoryTags(selectedCategoryObjects);

        const brandName = getBrandFromCategories(selectedCategoryObjects);
        if (brandName) {
            form.querySelector('#marca').value = brandName;
        }

        categoryModal.classList.add('hidden');
    };

    saveCategoryModalBtn.addEventListener('click', handleSaveCategories);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!submitButton) return;

        submitButton.disabled = true;
        const loadingText = isEditMode ? 'Salvando...' : 'Cadastrando...';
        submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>${loadingText}`;

        const formData = new FormData(form);
        const additionalBarcodesRaw = (formData.get('barcode-additional') || '')
            .split('\n')
            .map((code) => code.trim())
            .filter(Boolean);

        const depositPayload = [];
        depositStockMap.forEach((entry, depositId) => {
            if (!depositId) return;
            const unidade = (entry?.unidade || '').trim();
            const quantidadeValue = entry?.quantidade;
            const hasQuantity = quantidadeValue !== null && quantidadeValue !== undefined && quantidadeValue !== '';
            if (!hasQuantity && !unidade) return;
            const parsedQuantity = Number(quantidadeValue);
            depositPayload.push({
                deposito: depositId,
                quantidade: Number.isFinite(parsedQuantity) ? parsedQuantity : 0,
                unidade,
            });
        });

        const totalStock = depositPayload.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);

        persistActiveFiscalData();
        const generalFiscal = cloneFiscalObject(fiscalByCompany.get(FISCAL_GENERAL_KEY) || collectFiscalData());
        const fiscalPerCompanyPayload = {};
        fiscalByCompany.forEach((value, key) => {
            if (key === FISCAL_GENERAL_KEY) return;
            fiscalPerCompanyPayload[key] = cloneFiscalObject(value);
        });

        const updateData = {
            nome: (formData.get('nome') || '').trim(),
            cod: (formData.get('cod') || '').trim(),
            codbarras: (formData.get('codbarras') || '').trim(),
            descricao: detailedDescriptionInput ? detailedDescriptionInput.value : formData.get('descricao'),
            marca: formData.get('marca'),
            unidade: formData.get('unidade'),
            referencia: formData.get('referencia'),
            custo: formData.get('custo'),
            venda: formData.get('venda'),
            categorias: productCategories,
            fornecedores: supplierEntries.map((item) => ({
                fornecedor: item.fornecedor,
                nomeProdutoFornecedor: item.nomeProdutoFornecedor || null,
                codigoProduto: item.codigoProduto || null,
                unidadeEntrada: item.unidadeEntrada || null,
                tipoCalculo: item.tipoCalculo || null,
                valorCalculo: item.valorCalculo,
            })),
            especificacoes: {
                idade: Array.from(form.querySelectorAll('input[name="spec-idade"]:checked')).map(i => i.value),
                pet: Array.from(form.querySelectorAll('input[name="spec-pet"]:checked')).map(i => i.value),
                porteRaca: Array.from(form.querySelectorAll('input[name="spec-porte"]:checked')).map(i => i.value),
                apresentacao: (document.getElementById('spec-apresentacao')?.value || '').trim()
            },
            codigosComplementares: additionalBarcodesRaw,
            estoques: depositPayload,
            stock: totalStock,
            fiscal: generalFiscal,
            fiscalPorEmpresa: fiscalPerCompanyPayload,
            inativo: Boolean(inactiveCheckbox?.checked),
        };

        const dataCadastroValue = formData.get('data-cadastro');
        const pesoValue = formData.get('peso');
        const iatValue = formData.get('iat');
        const tipoProdutoValue = formData.get('tipo-produto');
        const ncmValue = formData.get('ncm');

        updateData.dataCadastro = dataCadastroValue ? dataCadastroValue : null;
        const parsedPeso = pesoValue ? Number(pesoValue) : null;
        updateData.peso = Number.isFinite(parsedPeso) ? parsedPeso : null;
        updateData.iat = iatValue || null;
        updateData.tipoProduto = tipoProdutoValue || null;
        updateData.ncm = ncmValue ? ncmValue.trim() : null;

        let responseJson = null;
        let createdProductId = null;

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;

            const endpoint = isEditMode
                ? `${API_CONFIG.BASE_URL}/products/${productId}`
                : `${API_CONFIG.BASE_URL}/products`;
            const method = isEditMode ? 'PUT' : 'POST';
            const textResponse = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updateData),
            });

            if (!textResponse.ok) {
                const actionLabel = isEditMode ? 'salvar os dados do produto' : 'cadastrar o produto';
                throw new Error(`Falha ao ${actionLabel}.`);
            }

            try {
                responseJson = await textResponse.json();
            } catch (parseError) {
                responseJson = null;
            }

            if (!isEditMode) {
                const extractedId = responseJson?.product?._id
                    || responseJson?.product?.id
                    || responseJson?._id
                    || responseJson?.id;
                createdProductId = extractedId || null;
                if (!createdProductId) {
                    const locationHeader = textResponse.headers.get('Location');
                    if (locationHeader) {
                        const segments = locationHeader.split('/').filter(Boolean);
                        createdProductId = segments[segments.length - 1] || null;
                    }
                }
            }

            const files = imageUploadInput?.files || [];
            const targetProductId = isEditMode ? productId : createdProductId;
            if (files.length > 0) {
                if (!targetProductId) {
                    throw new Error('Não foi possível identificar o produto para enviar as imagens.');
                }
                const imageFormData = new FormData();
                for (const file of files) {
                    imageFormData.append('imagens', file);
                }
                const uploadResponse = await fetch(`${API_CONFIG.BASE_URL}/products/${targetProductId}/upload`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: imageFormData,
                });
                if (!uploadResponse.ok) throw new Error('Falha ao enviar as imagens.');
            }

            if (isEditMode) {
                try {
                    const productRes = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}`);
                    if (productRes.ok) {
                        const updatedProduct = await productRes.json();
                        populateForm(updatedProduct);
                    }
                } catch (e) {
                    console.warn('Não foi possível recarregar o produto após salvar.', e);
                }

                showModal({
                    title: 'Sucesso!',
                    message: 'Produto atualizado com sucesso.',
                    confirmText: 'OK'
                });
            } else {
                if (createdProductId) {
                    productId = createdProductId;
                    isEditMode = true;
                    try {
                        const productRes = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}`);
                        if (productRes.ok) {
                            const createdProduct = await productRes.json();
                            populateForm(createdProduct);
                        }
                    } catch (e) {
                        console.warn('Não foi possível carregar o produto recém-criado.', e);
                    }

                    try {
                        const currentUrl = new URL(window.location.href);
                        currentUrl.searchParams.set('id', productId);
                        window.history.replaceState({}, '', currentUrl.toString());
                    } catch (urlError) {
                        console.warn('Não foi possível atualizar a URL após o cadastro do produto.', urlError);
                    }
                } else {
                    console.warn('Produto criado, mas nenhum identificador foi retornado pela API.');
                }

                showModal({
                    title: 'Sucesso!',
                    message: createdProductId
                        ? 'Produto cadastrado com sucesso. Continue preenchendo as demais informações.'
                        : 'Produto cadastrado com sucesso.',
                    confirmText: 'OK'
                });
            }

        } catch (error) {
            const baseMessage = isEditMode ? 'Não foi possível salvar' : 'Não foi possível cadastrar';
            showModal({ title: 'Erro', message: `${baseMessage}: ${error.message}`, confirmText: 'Tentar Novamente' });
        } finally {
            submitButton.disabled = false;
            setSubmitButtonIdleText();
        }
    });

    existingImagesGrid.addEventListener('click', async (event) => {
        if (event.target.classList.contains('delete-image-btn')) {
            const button = event.target;
            const imageUrlToDelete = button.dataset.imageUrl;

            showModal({
                title: 'Confirmar Exclusão',
                message: `Tem a certeza de que deseja apagar esta imagem? Esta ação não pode ser desfeita.`,
                confirmText: 'Apagar',
                cancelText: 'Cancelar',
                onConfirm: async () => {
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;
                        const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/images`, {
                            method: 'DELETE',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ imageUrl: imageUrlToDelete })
                        });
                        
                        const result = await response.json();
                        if (!response.ok) {
                            throw new Error(result.message || 'Falha ao apagar a imagem.');
                        }
                        showModal({ title: 'Sucesso!', message: result.message, confirmText: 'OK' });
                        button.closest('.relative.group').remove();
                    } catch (error) {
                        showModal({ title: 'Erro', message: `Não foi possível excluir a imagem: ${error.message}`, confirmText: 'Ok' });
                    }
                }
            });
        }
    });

    initializePage();
});
