// scripts/funcionarios/vet/ficha-clinica.js
// Busca de Tutor/Pet igual à Agenda e autopreenchimento na Ficha Clínica

(function () {
    // --- helpers de auth/API, mantendo padrão da Agenda ---
    let token = null;
    try {
        const u = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
        token = u?.token || null;
    } catch { }

    function api(path, opts = {}) {
        return fetch(`${API_CONFIG.BASE_URL}${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...(opts.headers || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        });
    }

    function notify(message, type = 'info') {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            try {
                window.showToast(text, type);
                return;
            } catch (err) {
                console.error('notify/showToast', err);
            }
        }
        try {
            alert(text);
        } catch (_) {
            console.log(text);
        }
    }

    // --- debounce simples (mesmo comportamento da Agenda) ---
    function debounce(fn, wait) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }
    function formatPhone(v) {
        const d = String(v || '').replace(/\D/g, '');
        if (d.length >= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
        if (d.length >= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6, 10)}`;
        return d || '';
    }

    // --- elementos da página ---
    const els = {
        cliInput: document.getElementById('vet-cli-input'),
        cliSug: document.getElementById('vet-cli-sug'),
        cliClear: document.getElementById('vet-cli-clear'),
        petSelect: document.getElementById('vet-pet-select'),
        petClear: document.getElementById('vet-pet-clear'),
        cardIcon: document.getElementById('vet-info-icon'),
        cardIconSymbol: document.getElementById('vet-info-icon-symbol'),
        tutorInfo: document.getElementById('vet-tutor-info'),
        tutorNome: document.getElementById('vet-tutor-nome'),
        tutorEmail: document.getElementById('vet-tutor-email'),
        tutorTelefone: document.getElementById('vet-tutor-telefone'),
        petInfo: document.getElementById('vet-pet-info'),
        petNome: document.getElementById('vet-pet-nome'),
        petMainDetails: document.getElementById('vet-pet-main-details'),
        petTipoWrapper: document.getElementById('vet-pet-tipo-wrapper'),
        petTipo: document.getElementById('vet-pet-tipo'),
        petRacaWrapper: document.getElementById('vet-pet-raca-wrapper'),
        petRaca: document.getElementById('vet-pet-raca'),
        petNascimentoWrapper: document.getElementById('vet-pet-nascimento-wrapper'),
        petNascimento: document.getElementById('vet-pet-nascimento'),
        petPesoWrapper: document.getElementById('vet-pet-peso-wrapper'),
        petPeso: document.getElementById('vet-pet-peso'),
        petExtraContainer: document.getElementById('vet-pet-extra'),
        petCorWrapper: document.getElementById('vet-pet-cor-wrapper'),
        petCor: document.getElementById('vet-pet-cor'),
        petSexoWrapper: document.getElementById('vet-pet-sexo-wrapper'),
        petSexo: document.getElementById('vet-pet-sexo'),
        petRgaWrapper: document.getElementById('vet-pet-rga-wrapper'),
        petRga: document.getElementById('vet-pet-rga'),
        petMicrochipWrapper: document.getElementById('vet-pet-microchip-wrapper'),
        petMicrochip: document.getElementById('vet-pet-microchip'),
        toggleTutor: document.getElementById('vet-card-show-tutor'),
        togglePet: document.getElementById('vet-card-show-pet'),
        pageContent: document.getElementById('vet-ficha-content'),
        consultaArea: document.getElementById('vet-consulta-area'),
        historicoTab: document.getElementById('vet-tab-historico'),
        consultaTab: document.getElementById('vet-tab-consulta'),
        addConsultaBtn: document.getElementById('vet-add-consulta-btn'),
        addVacinaBtn: document.getElementById('vet-add-vacina-btn'),
    };

    const state = {
        selectedCliente: null,
        selectedPetId: null,
        petsById: {},
        currentCardMode: 'tutor',
        agendaContext: null,
        consultas: [],
        consultasLoading: false,
        consultasLoadKey: null,
        vacinas: [],
    };

    const consultaModal = {
        overlay: null,
        dialog: null,
        form: null,
        titleEl: null,
        submitBtn: null,
        cancelBtn: null,
        fields: {},
        contextInfo: null,
        mode: 'create',
        editingId: null,
        keydownHandler: null,
        isSubmitting: false,
        activeServiceId: null,
        activeServiceName: '',
    };

    const vacinaModal = {
        overlay: null,
        dialog: null,
        form: null,
        submitBtn: null,
        cancelBtn: null,
        titleEl: null,
        closeBtn: null,
        fields: {},
        suggestionsEl: null,
        priceDisplay: null,
        selectedService: null,
        isSubmitting: false,
        keydownHandler: null,
        searchAbortController: null,
    };

    const STORAGE_KEYS = {
        cliente: 'vetFichaSelectedCliente',
        petId: 'vetFichaSelectedPetId',
        agenda: 'vetFichaAgendaContext',
    };
    const VACINA_STORAGE_PREFIX = 'vetFichaVacinas:';
    const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

    const CARD_TUTOR_ACTIVE_CLASSES = ['bg-sky-100', 'text-sky-700'];
    const CARD_PET_ACTIVE_CLASSES = ['bg-emerald-100', 'text-emerald-700'];
    const CARD_BUTTON_INACTIVE_CLASSES = ['bg-gray-100', 'text-gray-600'];
    const CARD_BUTTON_DISABLED_CLASSES = ['opacity-50', 'cursor-not-allowed'];
    const CONSULTA_PLACEHOLDER_CLASSNAMES = 'h-[420px] rounded-lg bg-white border border-dashed border-gray-300 flex flex-col items-center justify-center text-sm text-gray-500 text-center px-6';
    const CONSULTA_CARD_CLASSNAMES = 'h-[420px] rounded-lg bg-white border border-gray-200 shadow-sm overflow-hidden';
    const CONSULTA_PLACEHOLDER_TEXT = 'Selecione um agendamento na agenda para carregar os serviços veterinários.';
    const STATUS_LABELS = {
        agendado: 'Agendado',
        em_espera: 'Em espera',
        em_atendimento: 'Em atendimento',
        finalizado: 'Finalizado',
    };
    const PET_PLACEHOLDERS = {
        nome: 'Nome do Pet',
        tipo: '—',
        raca: '—',
        nascimento: '—',
        peso: '—',
    };

    function pickFirst(...values) {
        for (const value of values) {
            if (value === null || value === undefined) continue;
            const str = String(value).trim();
            if (str) return str;
        }
        return '';
    }

    function normalizeForCompare(value) {
        const str = String(value || '');
        if (typeof String.prototype.normalize === 'function') {
            return str
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
        }
        return str.toLowerCase();
    }

    function normalizeId(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') {
            if (value._id) return String(value._id).trim();
            if (value.id) return String(value.id).trim();
        }
        if (typeof value === 'number') return String(value);
        return String(value).trim();
    }

    function sanitizeObjectId(value) {
        const raw = normalizeId(value);
        if (!raw) return '';
        const cleaned = raw
            .replace(/^ObjectId\(["']?/, '')
            .replace(/["']?\)$/, '');
        return OBJECT_ID_REGEX.test(cleaned) ? cleaned : '';
    }

    function capitalize(value) {
        const str = String(value || '').trim();
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function formatPetSex(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const normalized = normalizeForCompare(raw);
        if (['m', 'macho', 'male', 'masculino'].includes(normalized)) return 'Macho';
        if (['f', 'femea', 'female', 'feminino'].includes(normalized)) return 'Fêmea';
        return capitalize(raw);
    }

    function formatPetRga(value) {
        const raw = String(value || '').trim();
        return raw ? raw.toUpperCase() : '';
    }

    function formatPetMicrochip(value) {
        return String(value || '').trim();
    }

    function setPetDetailField(value, valueEl, wrapperEl, { forceShow = false } = {}) {
        if (!valueEl || !wrapperEl) return false;
        const str = String(value || '').trim();
        if (str) {
            valueEl.textContent = str;
            wrapperEl.classList.remove('hidden');
            return true;
        }
        valueEl.textContent = '—';
        if (forceShow) {
            wrapperEl.classList.remove('hidden');
        } else {
            wrapperEl.classList.add('hidden');
        }
        return false;
    }

    function setPetExtraField(value, valueEl, wrapperEl) {
        if (!valueEl || !wrapperEl) return false;
        const str = String(value || '').trim();
        if (str) {
            valueEl.textContent = str;
            wrapperEl.classList.remove('hidden');
            return true;
        }
        valueEl.textContent = '—';
        wrapperEl.classList.add('hidden');
        return false;
    }

    function clearPetExtras() {
        if (els.petExtraContainer) {
            els.petExtraContainer.classList.add('hidden');
        }
        [els.petCorWrapper, els.petSexoWrapper, els.petRgaWrapper, els.petMicrochipWrapper].forEach((wrapper) => {
            if (wrapper) wrapper.classList.add('hidden');
        });
        if (els.petCor) els.petCor.textContent = '—';
        if (els.petSexo) els.petSexo.textContent = '—';
        if (els.petRga) els.petRga.textContent = '—';
        if (els.petMicrochip) els.petMicrochip.textContent = '—';
    }

    function persistCliente(cli) {
        try {
            const id = normalizeId(cli?._id);
            if (id) {
                const nome = pickFirst(cli?.nome);
                const email = pickFirst(cli?.email);
                const primaryPhone = pickFirst(cli?.celular, cli?.telefone);
                const secondaryPhone = pickFirst(
                    cli?.telefone && cli?.telefone !== primaryPhone ? cli.telefone : '',
                    cli?.celular && cli?.celular !== primaryPhone ? cli.celular : ''
                );
                const payload = {
                    _id: id,
                    nome,
                    email,
                    celular: primaryPhone,
                };
                if (secondaryPhone) {
                    payload.telefone = secondaryPhone;
                }
                localStorage.setItem(STORAGE_KEYS.cliente, JSON.stringify(payload));
            } else {
                localStorage.removeItem(STORAGE_KEYS.cliente);
            }
        } catch { }
    }

    function persistPetId(petId) {
        try {
            if (petId) {
                localStorage.setItem(STORAGE_KEYS.petId, petId);
            } else {
                localStorage.removeItem(STORAGE_KEYS.petId);
            }
        } catch { }
    }

    function persistAgendaContext(context) {
        try {
            if (context && typeof context === 'object') {
                localStorage.setItem(STORAGE_KEYS.agenda, JSON.stringify(context));
            } else {
                localStorage.removeItem(STORAGE_KEYS.agenda);
            }
        } catch { }
    }

    function getAgendaStoreId(options = {}) {
        const { persist = true } = options || {};
        if (!state.agendaContext || typeof state.agendaContext !== 'object') return '';

        const current = sanitizeObjectId(state.agendaContext.storeId);
        if (current) {
            state.agendaContext.storeId = current;
            if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
                state.agendaContext.storeIdCandidates = [];
            }
            if (!state.agendaContext.storeIdCandidates.includes(current)) {
                state.agendaContext.storeIdCandidates.push(current);
            }
            if (persist) {
                persistAgendaContext(state.agendaContext);
            }
            return current;
        }

        const candidates = [
            state.agendaContext.store,
            state.agendaContext.store_id,
            state.agendaContext.storeID,
            state.agendaContext.empresaId,
            state.agendaContext.empresa,
            state.agendaContext.lojaId,
            state.agendaContext.loja,
            state.agendaContext.companyId,
            state.agendaContext.company,
            state.agendaContext.filialId,
            state.agendaContext.filial,
            state.agendaContext.selectedStoreId,
        ];

        if (Array.isArray(state.agendaContext.storeIdCandidates)) {
            candidates.push(...state.agendaContext.storeIdCandidates);
        }

        for (const candidate of candidates) {
            if (Array.isArray(candidate)) {
                for (const nested of candidate) {
                    const normalizedNested = sanitizeObjectId(nested);
                    if (normalizedNested) {
                        state.agendaContext.storeId = normalizedNested;
                        if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
                            state.agendaContext.storeIdCandidates = [];
                        }
                        if (!state.agendaContext.storeIdCandidates.includes(normalizedNested)) {
                            state.agendaContext.storeIdCandidates.push(normalizedNested);
                        }
                        if (persist) {
                            persistAgendaContext(state.agendaContext);
                        }
                        return normalizedNested;
                    }
                }
                continue;
            }
            const normalized = sanitizeObjectId(candidate);
            if (normalized) {
                state.agendaContext.storeId = normalized;
                if (!Array.isArray(state.agendaContext.storeIdCandidates)) {
                    state.agendaContext.storeIdCandidates = [];
                }
                if (!state.agendaContext.storeIdCandidates.includes(normalized)) {
                    state.agendaContext.storeIdCandidates.push(normalized);
                }
                if (persist) {
                    persistAgendaContext(state.agendaContext);
                }
                return normalized;
            }
        }

        return '';
    }

    function getPersistedState() {
        let cliente = null;
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.cliente);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed._id) {
                    cliente = parsed;
                }
            }
        } catch { }
        const petId = localStorage.getItem(STORAGE_KEYS.petId) || null;
        let agendaContext = null;
        try {
            const rawAgenda = localStorage.getItem(STORAGE_KEYS.agenda);
            if (rawAgenda) {
                const parsedAgenda = JSON.parse(rawAgenda);
                if (parsedAgenda && typeof parsedAgenda === 'object') {
                    agendaContext = parsedAgenda;
                }
            }
        } catch { }
        return { cliente, petId, agendaContext };
    }

    async function fetchClienteById(id) {
        const normalizedId = normalizeId(id);
        if (!normalizedId) return null;
        try {
            const resp = await api(`/func/clientes/${normalizedId}`);
            if (!resp.ok) return null;
            const data = await resp.json().catch(() => null);
            if (!data || !data._id) return null;
            return {
                _id: normalizeId(data._id),
                nome: pickFirst(data.nome),
                email: pickFirst(data.email),
                celular: pickFirst(data.celular, data.telefone),
                telefone: pickFirst(data.telefone, data.celular),
            };
        } catch {
            return null;
        }
    }

    function updatePageVisibility() {
        if (!els.pageContent) return;
        const hasTutor = !!(state.selectedCliente && state.selectedCliente._id);
        const hasPet = !!state.selectedPetId;
        if (hasTutor && hasPet) {
            els.pageContent.classList.remove('hidden');
        } else {
            els.pageContent.classList.add('hidden');
        }
    }

    function formatDateDisplay(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('pt-BR').format(date);
        } catch {
            return date.toLocaleDateString('pt-BR');
        }
    }

    function formatDateTimeDisplay(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        try {
            const dateStr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
            const timeStr = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
            return `${dateStr} às ${timeStr}`;
        } catch {
            const dateStr = date.toLocaleDateString('pt-BR');
            const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return `${dateStr} às ${timeStr}`;
        }
    }

    function formatPetWeight(value) {
        if (value === null || value === undefined || value === '') return '';
        const num = Number(value);
        if (Number.isFinite(num)) {
            return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kg`;
        }
        const str = String(value).trim();
        if (!str) return '';
        return /kg$/i.test(str) ? str : `${str} Kg`;
    }

    function formatMoney(value) {
        const num = Number(value || 0);
        if (Number.isNaN(num)) return 'R$ 0,00';
        try {
            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
        } catch {
            return `R$ ${num.toFixed(2).replace('.', ',')}`;
        }
    }

    function normalizeBreedName(value) {
        if (!value) return '';
        if (Array.isArray(value)) {
            for (const item of value) {
                const nested = normalizeBreedName(item);
                if (nested) return nested;
            }
            return '';
        }
        if (typeof value === 'object') {
            if (value.nome) return String(value.nome).trim();
            if (value.name) return String(value.name).trim();
            if (value.descricao) return String(value.descricao).trim();
            if (value.label) return String(value.label).trim();
            if (value.title) return String(value.title).trim();
            return '';
        }
        return String(value || '').trim();
    }

    function mapPetTipoForPrice(value) {
        const norm = normalizeForCompare(value);
        if (!norm) return '';
        if (/cachorr|cao|canin|canid|dog/.test(norm)) return 'cachorro';
        if (/gat|felin|cat/.test(norm)) return 'gato';
        if (/passar|ave|bird|galinh|periquit|papagai|canar|calops|aves/.test(norm)) return 'passaro';
        if (/peix|fish|aquat/.test(norm)) return 'peixe';
        if (/roedor|hamst|coelh|porquinho|chinchil|rat|camundong|gerbil|rodent/.test(norm)) return 'roedor';
        if (/lagart|iguana|geco|gecko|tegu/.test(norm)) return 'lagarto';
        if (/tartarug|jabuti|quelon|caga/.test(norm)) return 'tartaruga';
        if (/exot|selvag|silvest|outro/.test(norm)) return 'exotico';
        return norm;
    }

    function getPetPriceCriteria() {
        const pet = getSelectedPet();
        if (!pet) return { tipo: '', raca: '' };

        const tipoCandidates = [
            pet.tipo,
            pet.tipoPet,
            pet.especie,
            pet.especiePet,
            pet.categoria,
            pet.category,
            pet.porte,
            pet.tipoAnimal,
            pet.tipoEspecie,
        ];
        let tipo = '';
        for (const candidate of tipoCandidates) {
            const mapped = mapPetTipoForPrice(candidate);
            if (mapped) {
                tipo = mapped;
                break;
            }
        }

        const racaCandidates = [
            pet.raca,
            pet.breed,
            pet.racaNome,
            pet.racaDescricao,
            pet.racaPrincipal,
            pet.racaOriginal,
            pet.racaPet,
            pet.racaLabel,
            pet?.raca?.nome,
            pet?.raca?.name,
            pet?.raca?.descricao,
            pet?.raca?.label,
        ];
        let raca = '';
        for (const candidate of racaCandidates) {
            const value = normalizeBreedName(candidate);
            if (value) {
                raca = value;
                break;
            }
        }

        return { tipo, raca };
    }

    function isVetCategory(value) {
        const norm = normalizeForCompare(value);
        if (!norm) return false;
        return norm.replace(/[^a-z]/g, '').includes('veterinario');
    }

    function isVetService(service) {
        if (!service) return false;
        const categories = [];
        if (Array.isArray(service.categorias)) categories.push(...service.categorias);
        if (Array.isArray(service.category)) categories.push(...service.category);
        if (service.categoria) categories.push(service.categoria);
        if (Array.isArray(service?.servico?.categorias)) categories.push(...service.servico.categorias);
        if (service.grupoNome) categories.push(service.grupoNome);
        if (service.grupo && service.grupo.nome) categories.push(service.grupo.nome);
        if (Array.isArray(service.tiposPermitidos)) categories.push(...service.tiposPermitidos);
        if (Array.isArray(service.allowedTipos)) categories.push(...service.allowedTipos);
        if (Array.isArray(service.allowedStaffTypes)) categories.push(...service.allowedStaffTypes);
        if (Array.isArray(service.allowedStaff)) categories.push(...service.allowedStaff);
        if (Array.isArray(service.grupoTiposPermitidos)) categories.push(...service.grupoTiposPermitidos);
        if (Array.isArray(service?.grupo?.tiposPermitidos)) categories.push(...service.grupo.tiposPermitidos);
        if (Array.isArray(service?.servico?.tiposPermitidos)) categories.push(...service.servico.tiposPermitidos);
        if (Array.isArray(service?.servico?.grupo?.tiposPermitidos)) categories.push(...service.servico.grupo.tiposPermitidos);
        if (service.tipoPermitido) categories.push(service.tipoPermitido);
        if (service.staffTipo) categories.push(service.staffTipo);
        if (service.tipo) categories.push(service.tipo);
        if (categories.some(isVetCategory)) return true;
        const nomeNorm = normalizeForCompare(service.nome || service.descricao || service.titulo || '');
        if (nomeNorm.includes('veterin')) return true;
        return false;
    }

    function mapServiceForDisplay(service) {
        if (!service) return null;
        const nome = pickFirst(
            service.nome,
            service.descricao,
            service.titulo,
            typeof service === 'string' ? service : ''
        );
        return {
            _id: normalizeId(service._id || service.id || service.servico || service.servicoId),
            nome: nome || '—',
            valor: Number(service.valor || 0),
        };
    }

    function getVetServices(list) {
        if (!Array.isArray(list)) return [];
        return list
            .filter(isVetService)
            .map(mapServiceForDisplay)
            .filter(Boolean);
    }

    function getStatusKey(status) {
        if (!status) return '';
        return String(status).trim().toLowerCase().replace(/\s+/g, '_');
    }

    function getStatusLabel(status) {
        const key = getStatusKey(status);
        return STATUS_LABELS[key] || (status ? capitalize(status) : '');
    }

    function toIsoOrNull(value) {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        try {
            return date.toISOString();
        } catch (_) {
            return null;
        }
    }

    function normalizeConsultaRecord(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id = normalizeId(raw.id || raw._id);
        if (!id) return null;

        const clienteId = normalizeId(raw.clienteId || raw.cliente);
        const petId = normalizeId(raw.petId || raw.pet);
        const servicoId = normalizeId(raw.servicoId || raw?.servico?._id || raw?.servico);
        const appointmentId = normalizeId(raw.appointmentId || raw.appointment);

        const servicoNome = pickFirst(
            raw.servicoNome,
            raw.servicoLabel,
            raw.servicoDescricao,
            raw?.servico?.nome,
        );

        const createdAt = toIsoOrNull(raw.createdAt || raw.criadoEm || raw.dataCriacao);
        const updatedAt = toIsoOrNull(raw.updatedAt || raw.atualizadoEm || raw.dataAtualizacao) || createdAt;

        return {
            id,
            _id: id,
            clienteId,
            petId,
            servicoId,
            servicoNome: servicoNome || '',
            appointmentId,
            anamnese: typeof raw.anamnese === 'string' ? raw.anamnese : '',
            exameFisico: typeof raw.exameFisico === 'string' ? raw.exameFisico : '',
            diagnostico: typeof raw.diagnostico === 'string' ? raw.diagnostico : '',
            createdAt,
            updatedAt,
        };
    }

    function getConsultasKey(clienteId, petId) {
        const tutor = normalizeId(clienteId);
        const pet = normalizeId(petId);
        if (!(tutor && pet)) return null;
        return `${tutor}|${pet}`;
    }

    function getVacinaStorageKey(clienteId, petId) {
        const base = getConsultasKey(clienteId, petId);
        return base ? `${VACINA_STORAGE_PREFIX}${base}` : null;
    }

    function generateVacinaId() {
        return `vac-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    }

    function normalizeDateInputValue(value) {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            try {
                return value.toISOString().slice(0, 10);
            } catch {
                return '';
            }
        }
        const str = String(value || '').trim();
        if (!str) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const date = new Date(str);
        if (Number.isNaN(date.getTime())) return '';
        try {
            return date.toISOString().slice(0, 10);
        } catch {
            return '';
        }
    }

    function normalizeVacinaRecord(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const servicoId = normalizeId(raw.servicoId || raw.servico || raw.serviceId);
        if (!servicoId) return null;
        const id = normalizeId(raw.id || raw._id || raw.uid || raw.key) || generateVacinaId();
        const nome = pickFirst(raw.servicoNome, raw.nome, raw.serviceName) || '';
        const quantidadeRaw = Number(raw.quantidade || raw.qty || raw.quant || 0);
        const quantidade = Number.isFinite(quantidadeRaw) && quantidadeRaw > 0
            ? Math.max(1, Math.round(quantidadeRaw))
            : 1;
        let valorUnitario = 0;
        const unitCandidates = [raw.valorUnitario, raw.valorUnit, raw.valor];
        for (const candidate of unitCandidates) {
            const num = Number(candidate);
            if (!Number.isNaN(num) && num > 0) {
                valorUnitario = Number(num);
                break;
            }
        }
        let valorTotal = Number(raw.valorTotal);
        if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
            valorTotal = valorUnitario * quantidade;
        }
        const validade = normalizeDateInputValue(raw.validade || raw.dataValidade);
        const aplicacao = normalizeDateInputValue(raw.aplicacao || raw.dataAplicacao);
        const renovacao = normalizeDateInputValue(raw.renovacao || raw.dataRenovacao);
        const lote = String(raw.lote || raw.loteNumero || '').trim();
        const createdAt = toIsoOrNull(raw.createdAt) || new Date().toISOString();

        return {
            id,
            servicoId,
            servicoNome: nome,
            quantidade,
            valorUnitario,
            valorTotal,
            validade,
            aplicacao,
            renovacao,
            lote,
            createdAt,
        };
    }

    function persistVacinasForSelection() {
        const key = getVacinaStorageKey(state.selectedCliente?._id, state.selectedPetId);
        if (!key) return;
        try {
            if (Array.isArray(state.vacinas) && state.vacinas.length) {
                localStorage.setItem(key, JSON.stringify(state.vacinas));
            } else {
                localStorage.removeItem(key);
            }
        } catch { }
    }

    function loadVacinasForSelection() {
        const key = getVacinaStorageKey(state.selectedCliente?._id, state.selectedPetId);
        if (!key) {
            state.vacinas = [];
            return;
        }
        try {
            const raw = localStorage.getItem(key);
            if (!raw) {
                state.vacinas = [];
                return;
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                state.vacinas = [];
                return;
            }
            const normalized = parsed.map(normalizeVacinaRecord).filter(Boolean);
            normalized.sort((a, b) => {
                const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });
            state.vacinas = normalized;
        } catch {
            state.vacinas = [];
        }
    }

    function getCurrentAgendaService() {
        const context = state.agendaContext || null;
        if (!context) return null;

        const services = Array.isArray(context.servicos) ? context.servicos : [];
        const normalized = services
            .map((svc) => {
                const id = normalizeId(svc?._id || svc?.id || svc?.servicoId || svc?.servico);
                if (!id) return null;
                const nome = pickFirst(
                    svc?.nome,
                    svc?.servicoNome,
                    svc?.descricao,
                    typeof svc === 'string' ? svc : '',
                );
                const categoriasRaw = Array.isArray(svc?.categorias)
                    ? svc.categorias
                    : (svc?.categorias ? [svc.categorias] : []);
                const categorias = categoriasRaw.map((cat) => String(cat || '').trim()).filter(Boolean);
                return {
                    id,
                    nome: nome || '',
                    categorias,
                };
            })
            .filter(Boolean);

        const vetServices = normalized.filter((svc) => svc.categorias.some((cat) => normalizeForCompare(cat) === 'veterinario'));
        const chosen = vetServices[0] || normalized[0] || null;
        if (chosen) {
            return { id: chosen.id, nome: chosen.nome || '' };
        }

        const fallbackId = normalizeId(context.servicoId || context.servico);
        if (fallbackId) {
            const fallbackNome = pickFirst(context.servicoNome, context.servico);
            return { id: fallbackId, nome: fallbackNome || '' };
        }

        return null;
    }

    function findConsultaById(consultaId) {
        const targetId = normalizeId(consultaId);
        if (!targetId) return null;
        return (state.consultas || []).find((consulta) => normalizeId(consulta?.id || consulta?._id) === targetId) || null;
    }

    function setConsultaModalSubmitting(isSubmitting) {
        consultaModal.isSubmitting = !!isSubmitting;
        if (consultaModal.submitBtn) {
            consultaModal.submitBtn.disabled = !!isSubmitting;
            consultaModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
            consultaModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
            consultaModal.submitBtn.textContent = isSubmitting
                ? 'Salvando...'
                : (consultaModal.mode === 'edit' ? 'Salvar alterações' : 'Adicionar');
        }
        if (consultaModal.cancelBtn) {
            consultaModal.cancelBtn.disabled = !!isSubmitting;
            consultaModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
            consultaModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
        }
    }

    function ensureTutorAndPetSelected() {
        const tutorId = normalizeId(state.selectedCliente?._id);
        const petId = normalizeId(state.selectedPetId);
        if (tutorId && petId) return true;
        notify('Selecione um tutor e um pet para registrar a consulta.', 'warning');
        return false;
    }

    function ensureAgendaServiceAvailable() {
        const service = getCurrentAgendaService();
        if (service && service.id) return service;
        notify('Nenhum serviço veterinário disponível para vincular à consulta. Abra a ficha pela agenda com um serviço veterinário.', 'warning');
        return null;
    }

    function upsertConsultaInState(record) {
        const normalized = normalizeConsultaRecord(record);
        if (!normalized) return null;
        const targetId = normalizeId(normalized.id || normalized._id);
        if (!targetId) return null;

        const next = Array.isArray(state.consultas) ? [...state.consultas] : [];
        const existingIdx = next.findIndex((item) => normalizeId(item?.id || item?._id) === targetId);
        const payload = { ...normalized, id: targetId, _id: targetId };
        if (existingIdx >= 0) {
            next[existingIdx] = { ...next[existingIdx], ...payload };
        } else {
            next.unshift(payload);
        }

        const deduped = [];
        const seen = new Set();
        next.forEach((item) => {
            const cid = normalizeId(item?.id || item?._id);
            if (!cid || seen.has(cid)) return;
            seen.add(cid);
            const createdAt = item.createdAt ? toIsoOrNull(item.createdAt) : null;
            const updatedAt = item.updatedAt ? toIsoOrNull(item.updatedAt) : createdAt;
            deduped.push({
                ...item,
                id: cid,
                _id: cid,
                createdAt,
                updatedAt,
            });
        });

        deduped.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
        });

        state.consultas = deduped;
        const key = getConsultasKey(state.selectedCliente?._id, state.selectedPetId);
        if (key) state.consultasLoadKey = key;

        return deduped.find((item) => normalizeId(item?.id || item?._id) === targetId) || payload;
    }

    async function loadConsultasFromServer(options = {}) {
        const { force = false } = options || {};
        const clienteId = normalizeId(state.selectedCliente?._id);
        const petId = normalizeId(state.selectedPetId);

        if (!(clienteId && petId)) {
            state.consultas = [];
            state.consultasLoadKey = null;
            state.consultasLoading = false;
            updateConsultaAgendaCard();
            return;
        }

        const key = getConsultasKey(clienteId, petId);
        if (!force && key && state.consultasLoadKey === key) return;

        state.consultasLoading = true;
        updateConsultaAgendaCard();

        try {
            const params = new URLSearchParams({ clienteId, petId });
            const appointmentId = normalizeId(state.agendaContext?.appointmentId);
            if (appointmentId) params.set('appointmentId', appointmentId);

            const resp = await api(`/func/vet/consultas?${params.toString()}`);
            const payload = await resp.json().catch(() => (resp.ok ? [] : {}));
            if (!resp.ok) {
                const message = typeof payload?.message === 'string' ? payload.message : 'Erro ao carregar consultas.';
                throw new Error(message);
            }

            const data = Array.isArray(payload) ? payload : [];
            const normalized = data.map(normalizeConsultaRecord).filter(Boolean);
            normalized.sort((a, b) => {
                const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });

            state.consultas = normalized;
            state.consultasLoadKey = key;
        } catch (error) {
            console.error('loadConsultasFromServer', error);
            state.consultas = [];
            state.consultasLoadKey = null;
            notify(error.message || 'Erro ao carregar consultas.', 'error');
        } finally {
            state.consultasLoading = false;
            updateConsultaAgendaCard();
        }
    }

    function createConsultaFieldSection(label, value) {
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-1';

        const labelEl = document.createElement('span');
        labelEl.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);

        const valueEl = document.createElement('p');
        valueEl.className = 'text-sm text-gray-800 whitespace-pre-wrap break-words';
        valueEl.textContent = value ? value : '—';
        wrapper.appendChild(valueEl);

        return wrapper;
    }

    function createManualConsultaCard(consulta) {
        const card = document.createElement('article');
        card.className = 'group relative cursor-pointer rounded-xl border border-sky-200 bg-white p-4 shadow-sm transition hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400';
        card.tabIndex = 0;
        const consultaId = normalizeId(consulta?.id || consulta?._id);
        card.dataset.consultaId = consultaId || '';
        card.setAttribute('role', 'button');
        card.setAttribute('title', 'Clique para editar a consulta');

        const header = document.createElement('div');
        header.className = 'flex items-start gap-3';
        card.appendChild(header);

        const icon = document.createElement('div');
        icon.className = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600';
        icon.innerHTML = '<i class="fas fa-stethoscope"></i>';
        header.appendChild(icon);

        const headerText = document.createElement('div');
        headerText.className = 'flex-1';
        header.appendChild(headerText);

        const title = document.createElement('h3');
        title.className = 'text-sm font-semibold text-sky-700';
        title.textContent = 'Registro de consulta';
        headerText.appendChild(title);

        const serviceName = pickFirst(consulta?.servicoNome);
        if (serviceName) {
            const serviceBadge = document.createElement('span');
            serviceBadge.className = 'mt-1 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700';
            const iconEl = document.createElement('i');
            iconEl.className = 'fas fa-paw text-[10px]';
            serviceBadge.appendChild(iconEl);
            const textEl = document.createElement('span');
            textEl.className = 'leading-none';
            textEl.textContent = serviceName;
            serviceBadge.appendChild(textEl);
            headerText.appendChild(serviceBadge);
        }

        const metaParts = [];
        if (consulta?.createdAt) {
            const created = formatDateTimeDisplay(consulta.createdAt);
            if (created) metaParts.push(`Registrado em ${created}`);
        }
        if (consulta?.updatedAt && consulta.updatedAt !== consulta.createdAt) {
            const updated = formatDateTimeDisplay(consulta.updatedAt);
            if (updated) metaParts.push(`Atualizado em ${updated}`);
        }
        if (metaParts.length) {
            const meta = document.createElement('p');
            meta.className = 'mt-0.5 text-xs text-gray-500';
            meta.textContent = metaParts.join(' · ');
            headerText.appendChild(meta);
        }

        const content = document.createElement('div');
        content.className = 'mt-4 grid gap-3';
        content.appendChild(createConsultaFieldSection('Anamnese', consulta?.anamnese || ''));
        content.appendChild(createConsultaFieldSection('Exame Físico', consulta?.exameFisico || ''));
        content.appendChild(createConsultaFieldSection('Diagnóstico', consulta?.diagnostico || ''));
        card.appendChild(content);

        const openForEdit = (event) => {
            event.preventDefault();
            openConsultaModal(consultaId || null);
        };
        card.addEventListener('click', openForEdit);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openForEdit(event);
            }
        });

        return card;
    }

    function createVacinaDetail(label, value) {
        const wrapper = document.createElement('div');
        wrapper.className = 'space-y-1';

        const labelEl = document.createElement('span');
        labelEl.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);

        const valueEl = document.createElement('p');
        valueEl.className = 'text-sm text-gray-800 break-words';
        valueEl.textContent = value ? value : '—';
        wrapper.appendChild(valueEl);

        return wrapper;
    }

    function createVacinaCard(vacina) {
        if (!vacina) return null;
        const serviceName = pickFirst(vacina.servicoNome);
        const card = document.createElement('article');
        card.className = 'rounded-xl border border-emerald-200 bg-white p-4 shadow-sm';

        const header = document.createElement('div');
        header.className = 'flex items-start gap-3';
        card.appendChild(header);

        const icon = document.createElement('div');
        icon.className = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600';
        icon.innerHTML = '<i class="fas fa-syringe"></i>';
        header.appendChild(icon);

        const headerText = document.createElement('div');
        headerText.className = 'flex-1';
        header.appendChild(headerText);

        const title = document.createElement('h3');
        title.className = 'text-sm font-semibold text-emerald-700';
        title.textContent = 'Aplicação de vacina';
        headerText.appendChild(title);

        if (serviceName) {
            const badge = document.createElement('span');
            badge.className = 'mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700';
            const iconEl = document.createElement('i');
            iconEl.className = 'fas fa-paw text-[10px]';
            badge.appendChild(iconEl);
            const textEl = document.createElement('span');
            textEl.className = 'leading-none';
            textEl.textContent = serviceName;
            badge.appendChild(textEl);
            headerText.appendChild(badge);
        }

        const metaParts = [];
        if (vacina?.createdAt) {
            const created = formatDateTimeDisplay(vacina.createdAt);
            if (created) metaParts.push(`Registrado em ${created}`);
        }
        if (metaParts.length) {
            const meta = document.createElement('p');
            meta.className = 'mt-0.5 text-xs text-gray-500';
            meta.textContent = metaParts.join(' · ');
            headerText.appendChild(meta);
        }

        const quantity = Number(vacina.quantidade || 0) || 1;
        const unitValue = Number(vacina.valorUnitario || 0);
        const totalValue = Number(vacina.valorTotal || unitValue * quantity || 0);
        const summary = document.createElement('p');
        summary.className = 'mt-2 text-sm text-gray-700';
        summary.textContent = `Quantidade: ${quantity} · Valor unitário: ${formatMoney(unitValue)} · Total: ${formatMoney(totalValue)}`;
        headerText.appendChild(summary);

        const grid = document.createElement('div');
        grid.className = 'mt-4 grid gap-3 sm:grid-cols-2';
        card.appendChild(grid);

        grid.appendChild(createVacinaDetail('Lote', vacina.lote ? vacina.lote : '—'));
        const validade = vacina.validade ? formatDateDisplay(vacina.validade) : '';
        grid.appendChild(createVacinaDetail('Validade', validade || '—'));
        const aplicacao = vacina.aplicacao ? formatDateDisplay(vacina.aplicacao) : '';
        grid.appendChild(createVacinaDetail('Data de aplicação', aplicacao || '—'));
        const renovacao = vacina.renovacao ? formatDateDisplay(vacina.renovacao) : '';
        grid.appendChild(createVacinaDetail('Data de renovação', renovacao || '—'));

        return card;
    }

    function createModalTextareaField(label, fieldName) {
        const id = `vet-consulta-${fieldName}`;
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-2';

        const labelEl = document.createElement('label');
        labelEl.className = 'text-sm font-medium text-gray-700';
        labelEl.setAttribute('for', id);
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);

        const textarea = document.createElement('textarea');
        textarea.id = id;
        textarea.name = fieldName;
        textarea.className = 'min-h-[120px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200';
        textarea.placeholder = `Descreva ${label.toLowerCase()}`;
        wrapper.appendChild(textarea);

        return { wrapper, textarea };
    }

    function ensureConsultaModal() {
        if (consultaModal.overlay) return consultaModal;

        const overlay = document.createElement('div');
        overlay.id = 'vet-consulta-modal';
        overlay.className = 'hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
        overlay.setAttribute('aria-hidden', 'true');

        const dialog = document.createElement('div');
        dialog.className = 'w-full max-w-3xl rounded-xl bg-white shadow-xl focus:outline-none';
        dialog.tabIndex = -1;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        overlay.appendChild(dialog);

        const form = document.createElement('form');
        form.className = 'flex flex-col gap-6 p-6';
        dialog.appendChild(form);

        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-3';
        form.appendChild(header);

        const title = document.createElement('h2');
        title.className = 'text-lg font-semibold text-gray-800';
        title.textContent = 'Nova consulta';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
        closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeConsultaModal();
        });
        header.appendChild(closeBtn);

        const fieldsWrapper = document.createElement('div');
        fieldsWrapper.className = 'grid gap-4';
        form.appendChild(fieldsWrapper);

        const contextInfo = document.createElement('div');
        contextInfo.className = 'hidden rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700';
        fieldsWrapper.appendChild(contextInfo);

        const anamneseField = createModalTextareaField('Anamnese', 'anamnese');
        fieldsWrapper.appendChild(anamneseField.wrapper);

        const exameField = createModalTextareaField('Exame Físico', 'exameFisico');
        fieldsWrapper.appendChild(exameField.wrapper);

        const diagnosticoField = createModalTextareaField('Diagnóstico', 'diagnostico');
        fieldsWrapper.appendChild(diagnosticoField.wrapper);

        const footer = document.createElement('div');
        footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
        form.appendChild(footer);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeConsultaModal();
        });
        footer.appendChild(cancelBtn);

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:w-auto';
        submitBtn.textContent = 'Adicionar';
        footer.appendChild(submitBtn);

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await handleConsultaSubmit();
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                event.preventDefault();
                closeConsultaModal();
            }
        });

        document.body.appendChild(overlay);

        consultaModal.overlay = overlay;
        consultaModal.dialog = dialog;
        consultaModal.form = form;
        consultaModal.titleEl = title;
        consultaModal.submitBtn = submitBtn;
        consultaModal.cancelBtn = cancelBtn;
        consultaModal.fields = {
            anamnese: anamneseField.textarea,
            exameFisico: exameField.textarea,
            diagnostico: diagnosticoField.textarea,
        };
        consultaModal.contextInfo = contextInfo;

        return consultaModal;
    }

    function closeConsultaModal() {
        if (!consultaModal.overlay) return;
        consultaModal.overlay.classList.add('hidden');
        consultaModal.overlay.setAttribute('aria-hidden', 'true');
        if (consultaModal.form) consultaModal.form.reset();
        consultaModal.mode = 'create';
        consultaModal.editingId = null;
        consultaModal.activeServiceId = null;
        consultaModal.activeServiceName = '';
        setConsultaModalSubmitting(false);
        if (consultaModal.contextInfo) {
            consultaModal.contextInfo.textContent = '';
            consultaModal.contextInfo.classList.add('hidden');
        }
        if (consultaModal.keydownHandler) {
            document.removeEventListener('keydown', consultaModal.keydownHandler);
            consultaModal.keydownHandler = null;
        }
    }

    function openConsultaModal(consultaId = null) {
        if (!consultaId && !ensureTutorAndPetSelected()) {
            return;
        }

        const modal = ensureConsultaModal();
        const isEditing = !!consultaId;
        const existing = isEditing ? findConsultaById(consultaId) : null;

        modal.mode = isEditing && existing ? 'edit' : 'create';
        modal.editingId = modal.mode === 'edit' ? normalizeId(existing?.id || existing?._id || consultaId) : null;

        if (modal.mode === 'edit' && !existing) {
            notify('Não foi possível localizar os dados da consulta selecionada.', 'error');
            return;
        }

        if (modal.mode === 'create') {
            const service = ensureAgendaServiceAvailable();
            if (!service) {
                return;
            }
            modal.activeServiceId = normalizeId(service.id);
            modal.activeServiceName = pickFirst(service.nome);
        } else {
            modal.activeServiceId = normalizeId(existing?.servicoId || existing?.servico);
            modal.activeServiceName = pickFirst(existing?.servicoNome);
        }

        if (modal.mode === 'create' && !modal.activeServiceId) {
            notify('Nenhum serviço veterinário disponível para vincular à consulta.', 'warning');
            return;
        }

        if (modal.titleEl) {
            modal.titleEl.textContent = modal.mode === 'edit' ? 'Editar consulta' : 'Nova consulta';
        }
        setConsultaModalSubmitting(false);

        if (modal.fields.anamnese) {
            modal.fields.anamnese.value = existing?.anamnese || '';
        }
        if (modal.fields.exameFisico) {
            modal.fields.exameFisico.value = existing?.exameFisico || '';
        }
        if (modal.fields.diagnostico) {
            modal.fields.diagnostico.value = existing?.diagnostico || '';
        }

        if (modal.contextInfo) {
            const tutorNome = pickFirst(
                state.selectedCliente?.nome,
                state.selectedCliente?.nomeCompleto,
                state.selectedCliente?.nomeContato,
                state.selectedCliente?.razaoSocial,
            );
            const pet = getSelectedPet();
            const petNome = pickFirst(pet?.nome, pet?.name);
            const parts = [];
            if (tutorNome) parts.push(`Tutor: ${tutorNome}`);
            if (petNome) parts.push(`Pet: ${petNome}`);
            if (modal.activeServiceName) parts.push(`Serviço: ${modal.activeServiceName}`);
            modal.contextInfo.textContent = parts.join(' · ');
            modal.contextInfo.classList.toggle('hidden', parts.length === 0);
        }

        modal.overlay.classList.remove('hidden');
        modal.overlay.removeAttribute('aria-hidden');
        if (modal.dialog) {
            modal.dialog.focus();
        }

        if (modal.keydownHandler) {
            document.removeEventListener('keydown', modal.keydownHandler);
        }
        modal.keydownHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeConsultaModal();
            }
        };
        document.addEventListener('keydown', modal.keydownHandler);

        setTimeout(() => {
            if (modal.fields.anamnese) {
                modal.fields.anamnese.focus();
            }
        }, 50);
    }

    async function handleConsultaSubmit() {
        const modal = ensureConsultaModal();
        if (modal.isSubmitting) return;

        const clienteId = normalizeId(state.selectedCliente?._id);
        const petId = normalizeId(state.selectedPetId);
        if (!(clienteId && petId)) {
            notify('Selecione um tutor e um pet para registrar a consulta.', 'warning');
            return;
        }

        const values = {
            anamnese: (modal.fields.anamnese?.value || '').trim(),
            exameFisico: (modal.fields.exameFisico?.value || '').trim(),
            diagnostico: (modal.fields.diagnostico?.value || '').trim(),
        };

        const editingConsulta = modal.mode === 'edit' && modal.editingId
            ? findConsultaById(modal.editingId)
            : null;

        const servicoId = normalizeId(
            modal.mode === 'edit'
                ? (editingConsulta?.servicoId || editingConsulta?.servico || modal.activeServiceId)
                : modal.activeServiceId,
        );
        if (!servicoId) {
            notify('Nenhum serviço veterinário disponível para vincular à consulta.', 'warning');
            return;
        }

        const appointmentId = normalizeId(
            modal.mode === 'edit'
                ? (editingConsulta?.appointmentId || editingConsulta?.appointment || state.agendaContext?.appointmentId)
                : state.agendaContext?.appointmentId,
        );

        const payload = {
            clienteId,
            petId,
            servicoId,
            anamnese: values.anamnese,
            exameFisico: values.exameFisico,
            diagnostico: values.diagnostico,
        };
        if (appointmentId) payload.appointmentId = appointmentId;

        setConsultaModalSubmitting(true);

        try {
            let response;
            let data;
            const isEdit = modal.mode === 'edit' && !!modal.editingId;
            if (isEdit) {
                response = await api(`/func/vet/consultas/${modal.editingId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload),
                });
            } else {
                response = await api('/func/vet/consultas', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            }

            data = await response.json().catch(() => (response.ok ? {} : {}));
            if (!response.ok) {
                const message = typeof data?.message === 'string'
                    ? data.message
                    : (isEdit ? 'Erro ao atualizar consulta.' : 'Erro ao salvar consulta.');
                throw new Error(message);
            }

            const saved = upsertConsultaInState(data);
            if (!saved) {
                await loadConsultasFromServer({ force: true });
            } else {
                updateConsultaAgendaCard();
            }

            const wasEdit = isEdit;
            closeConsultaModal();
            notify(wasEdit ? 'Consulta atualizada com sucesso.' : 'Consulta registrada com sucesso.', 'success');
        } catch (error) {
            console.error('handleConsultaSubmit', error);
            notify(error.message || 'Erro ao salvar consulta.', 'error');
        } finally {
            setConsultaModalSubmitting(false);
        }
    }

    function hideVacinaSuggestions() {
        if (vacinaModal.suggestionsEl) {
            vacinaModal.suggestionsEl.innerHTML = '';
            vacinaModal.suggestionsEl.classList.add('hidden');
        }
    }

    function setVacinaModalSubmitting(isSubmitting) {
        vacinaModal.isSubmitting = !!isSubmitting;
        if (vacinaModal.submitBtn) {
            vacinaModal.submitBtn.disabled = !!isSubmitting;
            vacinaModal.submitBtn.classList.toggle('opacity-60', !!isSubmitting);
            vacinaModal.submitBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
            vacinaModal.submitBtn.textContent = isSubmitting ? 'Salvando...' : 'Adicionar';
        }
        if (vacinaModal.cancelBtn) {
            vacinaModal.cancelBtn.disabled = !!isSubmitting;
            vacinaModal.cancelBtn.classList.toggle('opacity-50', !!isSubmitting);
            vacinaModal.cancelBtn.classList.toggle('cursor-not-allowed', !!isSubmitting);
        }
    }

    function updateVacinaPriceSummary() {
        if (!vacinaModal.priceDisplay) return;
        const service = vacinaModal.selectedService;
        if (!service) {
            vacinaModal.priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
            return;
        }
        const quantityInput = vacinaModal.fields?.quantidade;
        let quantidade = Number(quantityInput?.value || 0);
        if (!Number.isFinite(quantidade) || quantidade <= 0) quantidade = 1;
        quantidade = Math.max(1, Math.round(quantidade));
        if (quantityInput) quantityInput.value = String(quantidade);
        const unit = Number(service.valor || 0);
        const total = unit * quantidade;
        vacinaModal.priceDisplay.textContent = `Valor unitário: ${formatMoney(unit)} · Total (${quantidade}×): ${formatMoney(total)}`;
    }

    function ensureVacinaModal() {
        if (vacinaModal.overlay) return vacinaModal;

        const overlay = document.createElement('div');
        overlay.id = 'vet-vacina-modal';
        overlay.className = 'hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
        overlay.setAttribute('aria-hidden', 'true');

        const dialog = document.createElement('div');
        dialog.className = 'w-full max-w-2xl rounded-xl bg-white shadow-xl focus:outline-none';
        dialog.tabIndex = -1;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        overlay.appendChild(dialog);

        const form = document.createElement('form');
        form.className = 'flex flex-col gap-6 p-6';
        dialog.appendChild(form);

        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-3';
        form.appendChild(header);

        const title = document.createElement('h2');
        title.className = 'text-lg font-semibold text-gray-800';
        title.textContent = 'Nova vacina';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'text-gray-400 transition hover:text-gray-600';
        closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeVacinaModal();
        });
        header.appendChild(closeBtn);

        const fieldsWrapper = document.createElement('div');
        fieldsWrapper.className = 'grid gap-4';
        form.appendChild(fieldsWrapper);

        const serviceWrapper = document.createElement('div');
        serviceWrapper.className = 'flex flex-col gap-2';
        fieldsWrapper.appendChild(serviceWrapper);

        const serviceLabel = document.createElement('label');
        serviceLabel.className = 'text-sm font-medium text-gray-700';
        serviceLabel.textContent = 'Vacina';
        serviceWrapper.appendChild(serviceLabel);

        const serviceInputWrapper = document.createElement('div');
        serviceInputWrapper.className = 'relative';
        serviceWrapper.appendChild(serviceInputWrapper);

        const serviceInput = document.createElement('input');
        serviceInput.type = 'text';
        serviceInput.name = 'vacinaServico';
        serviceInput.placeholder = 'Pesquise a vacina pelo nome';
        serviceInput.autocomplete = 'off';
        serviceInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
        serviceInputWrapper.appendChild(serviceInput);

        const suggestions = document.createElement('ul');
        suggestions.className = 'hidden absolute left-0 right-0 top-full mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-10';
        serviceInputWrapper.appendChild(suggestions);

        const priceDisplay = document.createElement('p');
        priceDisplay.className = 'text-xs text-gray-500';
        priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
        serviceWrapper.appendChild(priceDisplay);

        const quantityWrapper = document.createElement('div');
        quantityWrapper.className = 'flex flex-col gap-2';
        fieldsWrapper.appendChild(quantityWrapper);

        const quantityLabel = document.createElement('label');
        quantityLabel.className = 'text-sm font-medium text-gray-700';
        quantityLabel.textContent = 'Quantidade';
        quantityWrapper.appendChild(quantityLabel);

        const quantityInput = document.createElement('input');
        quantityInput.type = 'number';
        quantityInput.min = '1';
        quantityInput.step = '1';
        quantityInput.value = '1';
        quantityInput.name = 'vacinaQuantidade';
        quantityInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
        quantityWrapper.appendChild(quantityInput);

        const validadeWrapper = document.createElement('div');
        validadeWrapper.className = 'flex flex-col gap-2';
        fieldsWrapper.appendChild(validadeWrapper);

        const validadeLabel = document.createElement('label');
        validadeLabel.className = 'text-sm font-medium text-gray-700';
        validadeLabel.textContent = 'Validade';
        validadeWrapper.appendChild(validadeLabel);

        const validadeInput = document.createElement('input');
        validadeInput.type = 'date';
        validadeInput.name = 'vacinaValidade';
        validadeInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
        validadeWrapper.appendChild(validadeInput);

        const loteWrapper = document.createElement('div');
        loteWrapper.className = 'flex flex-col gap-2';
        fieldsWrapper.appendChild(loteWrapper);

        const loteLabel = document.createElement('label');
        loteLabel.className = 'text-sm font-medium text-gray-700';
        loteLabel.textContent = 'Lote';
        loteWrapper.appendChild(loteLabel);

        const loteInput = document.createElement('input');
        loteInput.type = 'text';
        loteInput.name = 'vacinaLote';
        loteInput.placeholder = 'Informe o lote';
        loteInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
        loteWrapper.appendChild(loteInput);

        const datesGrid = document.createElement('div');
        datesGrid.className = 'grid gap-4 sm:grid-cols-2';
        fieldsWrapper.appendChild(datesGrid);

        const aplicacaoWrapper = document.createElement('div');
        aplicacaoWrapper.className = 'flex flex-col gap-2';
        datesGrid.appendChild(aplicacaoWrapper);

        const aplicacaoLabel = document.createElement('label');
        aplicacaoLabel.className = 'text-sm font-medium text-gray-700';
        aplicacaoLabel.textContent = 'Data de aplicação';
        aplicacaoWrapper.appendChild(aplicacaoLabel);

        const aplicacaoInput = document.createElement('input');
        aplicacaoInput.type = 'date';
        aplicacaoInput.name = 'vacinaAplicacao';
        aplicacaoInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
        aplicacaoWrapper.appendChild(aplicacaoInput);

        const renovacaoWrapper = document.createElement('div');
        renovacaoWrapper.className = 'flex flex-col gap-2';
        datesGrid.appendChild(renovacaoWrapper);

        const renovacaoLabel = document.createElement('label');
        renovacaoLabel.className = 'text-sm font-medium text-gray-700';
        renovacaoLabel.textContent = 'Data de renovação';
        renovacaoWrapper.appendChild(renovacaoLabel);

        const renovacaoInput = document.createElement('input');
        renovacaoInput.type = 'date';
        renovacaoInput.name = 'vacinaRenovacao';
        renovacaoInput.className = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200';
        renovacaoWrapper.appendChild(renovacaoInput);

        const footer = document.createElement('div');
        footer.className = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3';
        form.appendChild(footer);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeVacinaModal();
        });
        footer.appendChild(cancelBtn);

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 sm:w-auto';
        submitBtn.textContent = 'Adicionar';
        footer.appendChild(submitBtn);

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await handleVacinaSubmit();
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                event.preventDefault();
                closeVacinaModal();
            }
        });

        document.body.appendChild(overlay);

        vacinaModal.overlay = overlay;
        vacinaModal.dialog = dialog;
        vacinaModal.form = form;
        vacinaModal.submitBtn = submitBtn;
        vacinaModal.cancelBtn = cancelBtn;
        vacinaModal.titleEl = title;
        vacinaModal.closeBtn = closeBtn;
        vacinaModal.fields = {
            servico: serviceInput,
            quantidade: quantityInput,
            validade: validadeInput,
            lote: loteInput,
            aplicacao: aplicacaoInput,
            renovacao: renovacaoInput,
            servicoWrapper: serviceInputWrapper,
        };
        vacinaModal.suggestionsEl = suggestions;
        vacinaModal.priceDisplay = priceDisplay;

        const debouncedSearch = debounce((value) => searchVacinaServices(value), 300);
        serviceInput.addEventListener('input', (event) => {
            vacinaModal.selectedService = null;
            updateVacinaPriceSummary();
            debouncedSearch(event.target.value);
        });
        serviceInput.addEventListener('focus', () => {
            if (vacinaModal.suggestionsEl && vacinaModal.suggestionsEl.children.length) {
                vacinaModal.suggestionsEl.classList.remove('hidden');
            }
        });

        quantityInput.addEventListener('input', updateVacinaPriceSummary);

        document.addEventListener('click', (event) => {
            if (!vacinaModal.overlay || vacinaModal.overlay.classList.contains('hidden')) return;
            const container = vacinaModal.fields?.servicoWrapper;
            if (!container) return;
            if (container.contains(event.target)) return;
            hideVacinaSuggestions();
        });

        return vacinaModal;
    }

    function closeVacinaModal() {
        if (!vacinaModal.overlay) return;
        vacinaModal.overlay.classList.add('hidden');
        vacinaModal.overlay.setAttribute('aria-hidden', 'true');
        if (vacinaModal.form) vacinaModal.form.reset();
        vacinaModal.selectedService = null;
        hideVacinaSuggestions();
        setVacinaModalSubmitting(false);
        if (vacinaModal.priceDisplay) {
            vacinaModal.priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
        }
        if (vacinaModal.keydownHandler) {
            document.removeEventListener('keydown', vacinaModal.keydownHandler);
            vacinaModal.keydownHandler = null;
        }
        if (vacinaModal.searchAbortController) {
            try { vacinaModal.searchAbortController.abort(); } catch { }
            vacinaModal.searchAbortController = null;
        }
    }

    function openVacinaModal() {
        if (!ensureTutorAndPetSelected()) {
            return;
        }
        const appointmentId = normalizeId(state.agendaContext?.appointmentId);
        if (!appointmentId) {
            notify('Abra a ficha pela agenda para registrar vacinas vinculadas a um agendamento.', 'warning');
            return;
        }

        const modal = ensureVacinaModal();
        setVacinaModalSubmitting(false);
        if (modal.form) modal.form.reset();
        if (modal.fields.quantidade) modal.fields.quantidade.value = '1';
        vacinaModal.selectedService = null;
        hideVacinaSuggestions();
        if (vacinaModal.priceDisplay) {
            vacinaModal.priceDisplay.textContent = 'Selecione uma vacina para ver o valor.';
        }

        vacinaModal.overlay.classList.remove('hidden');
        vacinaModal.overlay.removeAttribute('aria-hidden');
        if (vacinaModal.dialog) {
            vacinaModal.dialog.focus();
        }

        if (vacinaModal.keydownHandler) {
            document.removeEventListener('keydown', vacinaModal.keydownHandler);
        }
        vacinaModal.keydownHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeVacinaModal();
            }
        };
        document.addEventListener('keydown', vacinaModal.keydownHandler);

        setTimeout(() => {
            if (vacinaModal.fields.servico) {
                try { vacinaModal.fields.servico.focus(); } catch { }
            }
        }, 50);

        const storeId = getAgendaStoreId();
        if (!storeId) {
            notify('Não foi possível identificar a empresa do agendamento. Os valores podem considerar apenas o preço padrão do serviço.', 'warning');
        }
    }

    function isVacinaServiceCandidate(service) {
        if (!service) return false;
        const categorias = [];
        if (Array.isArray(service.categorias)) categorias.push(...service.categorias);
        if (Array.isArray(service.category)) categorias.push(...service.category);
        if (service.categoria) categorias.push(service.categoria);
        if (categorias.some((cat) => normalizeForCompare(cat) === 'vacina')) return true;
        const nomeNorm = normalizeForCompare(service.nome || '');
        if (nomeNorm.includes('vacina')) return true;
        if (service?.grupo?.nome) {
            const groupNorm = normalizeForCompare(service.grupo.nome);
            if (groupNorm.includes('vacina')) return true;
        }
        return false;
    }

    async function searchVacinaServices(term) {
        const query = String(term || '').trim();
        if (!query || query.length < 2) {
            hideVacinaSuggestions();
            return;
        }

        if (vacinaModal.searchAbortController) {
            try { vacinaModal.searchAbortController.abort(); } catch { }
        }
        const controller = new AbortController();
        vacinaModal.searchAbortController = controller;

        try {
            const params = new URLSearchParams({ q: query, limit: '8' });
            const resp = await api(`/func/servicos/buscar?${params.toString()}`, { signal: controller.signal });
            if (!resp.ok) {
                hideVacinaSuggestions();
                return;
            }
            const payload = await resp.json().catch(() => []);
            if (controller.signal.aborted) return;
            const list = Array.isArray(payload) ? payload : [];
            const filtered = list.filter(isVacinaServiceCandidate);
            const normalized = filtered
                .map((svc) => ({
                    _id: normalizeId(svc._id),
                    nome: pickFirst(svc.nome),
                    valor: Number(svc.valor || 0),
                }))
                .filter((svc) => svc._id && svc.nome);
            if (!normalized.length) {
                hideVacinaSuggestions();
                return;
            }
            if (vacinaModal.suggestionsEl) {
                vacinaModal.suggestionsEl.innerHTML = '';
                normalized.forEach((svc) => {
                    const li = document.createElement('li');
                    li.className = 'px-3 py-2 hover:bg-gray-50 cursor-pointer';
                    li.dataset.serviceId = svc._id;
                    const nameEl = document.createElement('div');
                    nameEl.className = 'font-medium text-gray-900';
                    nameEl.textContent = svc.nome;
                    const priceEl = document.createElement('div');
                    priceEl.className = 'text-xs text-gray-500';
                    priceEl.textContent = formatMoney(Number(svc.valor || 0));
                    svc.priceEl = priceEl;
                    li.appendChild(nameEl);
                    li.appendChild(priceEl);
                    li.addEventListener('click', async () => {
                        await selectVacinaService(svc);
                    });
                    vacinaModal.suggestionsEl.appendChild(li);
                });
                vacinaModal.suggestionsEl.classList.remove('hidden');

                const storeId = getAgendaStoreId({ persist: false });
                if (storeId) {
                    const petId = normalizeId(state.selectedPetId);
                    const { tipo, raca } = getPetPriceCriteria();
                    normalized.forEach((svc) => {
                        const params = new URLSearchParams({ serviceId: svc._id, storeId });
                        if (petId) params.set('petId', petId);
                        if (tipo) params.set('tipo', tipo);
                        if (raca) params.set('raca', raca);
                        api(`/func/servicos/preco?${params.toString()}`, { signal: controller.signal })
                            .then((res) => (res && res.ok ? res.json().catch(() => null) : null))
                            .then((data) => {
                                if (!data || typeof data.valor !== 'number' || controller.signal.aborted) return;
                                const price = Number(data.valor || 0);
                                svc.valor = price;
                                if (svc.priceEl) {
                                    svc.priceEl.textContent = formatMoney(price);
                                }
                            })
                            .catch((err) => {
                                if (controller.signal.aborted) return;
                                if (err && err.name === 'AbortError') return;
                            });
                    });
                }
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            hideVacinaSuggestions();
        } finally {
            if (vacinaModal.searchAbortController === controller) {
                vacinaModal.searchAbortController = null;
            }
        }
    }

    async function fetchServicePrice(serviceId) {
        const storeId = getAgendaStoreId();
        if (!serviceId || !storeId) return null;
        const petId = normalizeId(state.selectedPetId);
        const params = new URLSearchParams({ serviceId, storeId });
        if (petId) params.set('petId', petId);
        const { tipo, raca } = getPetPriceCriteria();
        if (tipo) params.set('tipo', tipo);
        if (raca) params.set('raca', raca);
        try {
            const resp = await api(`/func/servicos/preco?${params.toString()}`);
            if (!resp.ok) return null;
            const data = await resp.json().catch(() => null);
            if (!data || typeof data.valor !== 'number') return null;
            return Number(data.valor || 0);
        } catch {
            return null;
        }
    }

    async function selectVacinaService(service) {
        if (!service || !service._id) return;
        ensureVacinaModal();
        vacinaModal.selectedService = {
            _id: service._id,
            nome: service.nome || '',
            valor: Number(service.valor || 0),
        };
        if (vacinaModal.fields?.servico) {
            vacinaModal.fields.servico.value = service.nome || '';
        }
        hideVacinaSuggestions();
        updateVacinaPriceSummary();

        try {
            const price = await fetchServicePrice(service._id);
            if (price != null) {
                vacinaModal.selectedService.valor = Number(price);
                updateVacinaPriceSummary();
            }
        } catch (error) {
            // silencioso
        }
    }

    async function handleVacinaSubmit() {
        const modal = ensureVacinaModal();
        if (modal.isSubmitting) return;

        if (!ensureTutorAndPetSelected()) {
            return;
        }

        const appointmentId = normalizeId(state.agendaContext?.appointmentId);
        if (!appointmentId) {
            notify('Abra a ficha pela agenda para registrar vacinas vinculadas a um agendamento.', 'warning');
            return;
        }

        const service = vacinaModal.selectedService;
        if (!service || !service._id) {
            notify('Selecione uma vacina para registrar.', 'warning');
            return;
        }

        let quantidade = Number(vacinaModal.fields?.quantidade?.value || 0);
        if (!Number.isFinite(quantidade) || quantidade <= 0) {
            notify('Informe uma quantidade válida para a vacina.', 'warning');
            return;
        }
        quantidade = Math.max(1, Math.round(quantidade));
        if (vacinaModal.fields?.quantidade) {
            vacinaModal.fields.quantidade.value = String(quantidade);
        }

        const validade = normalizeDateInputValue(vacinaModal.fields?.validade?.value);
        const lote = String(vacinaModal.fields?.lote?.value || '').trim();
        const aplicacao = normalizeDateInputValue(vacinaModal.fields?.aplicacao?.value);
        const renovacao = normalizeDateInputValue(vacinaModal.fields?.renovacao?.value);

        let valorUnitario = Number(service.valor || 0);
        if (!Number.isFinite(valorUnitario) || valorUnitario < 0) {
            valorUnitario = 0;
        }
        const valorTotal = valorUnitario * quantidade;

        const record = {
            id: generateVacinaId(),
            servicoId: service._id,
            servicoNome: service.nome || '',
            quantidade,
            valorUnitario,
            valorTotal,
            validade,
            aplicacao,
            renovacao,
            lote,
            createdAt: new Date().toISOString(),
        };

        const existingServices = Array.isArray(state.agendaContext?.servicos) ? state.agendaContext.servicos : [];
        const payloadServicos = existingServices
            .map((svc) => {
                const sid = normalizeId(svc._id || svc.id || svc.servicoId || svc.servico);
                if (!sid) return null;
                const valor = Number(svc.valor || 0);
                return {
                    servicoId: sid,
                    valor: Number.isFinite(valor) ? valor : 0,
                };
            })
            .filter(Boolean);

        payloadServicos.push({ servicoId: service._id, valor: valorTotal });

        setVacinaModalSubmitting(true);

        try {
            const response = await api(`/func/agendamentos/${appointmentId}`, {
                method: 'PUT',
                body: JSON.stringify({ servicos: payloadServicos }),
            });
            const data = await response.json().catch(() => (response.ok ? {} : {}));
            if (!response.ok) {
                const message = typeof data?.message === 'string' ? data.message : 'Erro ao atualizar os serviços do agendamento.';
                throw new Error(message);
            }

            if (!state.agendaContext) state.agendaContext = {};
            if (Array.isArray(data?.servicos)) {
                state.agendaContext.servicos = data.servicos;
            }
            if (typeof data?.valor === 'number') {
                state.agendaContext.valor = Number(data.valor);
            }
            if (Array.isArray(state.agendaContext?.servicos)) {
                state.agendaContext.totalServicos = state.agendaContext.servicos.length;
            }
            persistAgendaContext(state.agendaContext);

            state.vacinas = [record, ...(Array.isArray(state.vacinas) ? state.vacinas : [])];
            persistVacinasForSelection();
            updateConsultaAgendaCard();
            closeVacinaModal();
            notify('Vacina registrada com sucesso.', 'success');
        } catch (error) {
            console.error('handleVacinaSubmit', error);
            notify(error.message || 'Erro ao registrar vacina.', 'error');
        } finally {
            setVacinaModalSubmitting(false);
        }
    }

    function getSelectedPet() {
        const petId = state.selectedPetId;
        if (!petId) return null;
        return (state.petsById && state.petsById[petId]) || null;
    }

    function setPetPlaceholders() {
        if (els.petNome) els.petNome.textContent = PET_PLACEHOLDERS.nome;
        setPetDetailField(PET_PLACEHOLDERS.tipo, els.petTipo, els.petTipoWrapper, { forceShow: true });
        setPetDetailField(PET_PLACEHOLDERS.raca, els.petRaca, els.petRacaWrapper, { forceShow: true });
        setPetDetailField(PET_PLACEHOLDERS.nascimento, els.petNascimento, els.petNascimentoWrapper, { forceShow: true });
        setPetDetailField(PET_PLACEHOLDERS.peso, els.petPeso, els.petPesoWrapper, { forceShow: true });
        if (els.petMainDetails) {
            els.petMainDetails.classList.remove('hidden');
        }
        clearPetExtras();
    }

    function updatePetInfo(pet = getSelectedPet()) {
        if (!pet) {
            setPetPlaceholders();
            return;
        }
        clearPetExtras();
        const nome = (pet.nome || '').trim();
        if (els.petNome) els.petNome.textContent = nome || '—';

        const tipo = (pet.tipo || pet.tipoPet || pet.especie || pet.porte || '').trim();
        const raca = (pet.raca || pet.breed || '').trim();
        const nascimento = formatDateDisplay(pet.dataNascimento || pet.nascimento);
        const peso = formatPetWeight(pet.peso || pet.pesoAtual);

        const hasTipo = setPetDetailField(tipo, els.petTipo, els.petTipoWrapper);
        const hasRaca = setPetDetailField(raca, els.petRaca, els.petRacaWrapper);
        const hasNascimento = setPetDetailField(nascimento, els.petNascimento, els.petNascimentoWrapper);
        const hasPeso = setPetDetailField(peso, els.petPeso, els.petPesoWrapper);
        if (els.petMainDetails) {
            const hasMainDetails = hasTipo || hasRaca || hasNascimento || hasPeso;
            els.petMainDetails.classList.toggle('hidden', !hasMainDetails);
        }

        const cor = pickFirst(pet.pelagemCor, pet.cor, pet.corPelagem, pet.corPelo);
        const sexo = formatPetSex(pet.sexo);
        const rga = formatPetRga(pickFirst(pet.rga, pet.rg));
        const microchip = formatPetMicrochip(pickFirst(pet.microchip, pet.microChip, pet.chip));

        const hasCor = setPetExtraField(cor, els.petCor, els.petCorWrapper);
        const hasSexo = setPetExtraField(sexo, els.petSexo, els.petSexoWrapper);
        const hasRga = setPetExtraField(rga, els.petRga, els.petRgaWrapper);
        const hasMicrochip = setPetExtraField(microchip, els.petMicrochip, els.petMicrochipWrapper);
        const hasExtras = hasCor || hasSexo || hasRga || hasMicrochip;
        if (els.petExtraContainer) {
            els.petExtraContainer.classList.toggle('hidden', !hasExtras);
        }
    }

    function updateToggleButtons(showPet, petAvailable) {
        const toggleStates = [...CARD_TUTOR_ACTIVE_CLASSES, ...CARD_PET_ACTIVE_CLASSES, ...CARD_BUTTON_INACTIVE_CLASSES];
        if (els.toggleTutor) {
            els.toggleTutor.classList.remove(...toggleStates);
            els.toggleTutor.classList.add(...(showPet ? CARD_BUTTON_INACTIVE_CLASSES : CARD_TUTOR_ACTIVE_CLASSES));
        }
        if (els.togglePet) {
            els.togglePet.classList.remove(...toggleStates, ...CARD_BUTTON_DISABLED_CLASSES);
            if (petAvailable) {
                els.togglePet.classList.add(...(showPet ? CARD_PET_ACTIVE_CLASSES : CARD_BUTTON_INACTIVE_CLASSES));
                els.togglePet.removeAttribute('disabled');
            } else {
                els.togglePet.classList.add(...CARD_BUTTON_INACTIVE_CLASSES, ...CARD_BUTTON_DISABLED_CLASSES);
                els.togglePet.setAttribute('disabled', 'disabled');
            }
        }
    }

    function setConsultaTabActive() {
        if (els.consultaTab) {
            els.consultaTab.classList.remove('bg-gray-100', 'text-gray-700', 'hover:bg-gray-50');
            els.consultaTab.classList.add('bg-sky-600', 'text-white');
        }
        if (els.historicoTab) {
            els.historicoTab.classList.remove('bg-sky-600', 'text-white');
            els.historicoTab.classList.add('bg-gray-100', 'text-gray-700', 'hover:bg-gray-50');
        }
    }

    function updateConsultaAgendaCard() {
        const area = els.consultaArea;
        if (!area) return;
        setConsultaTabActive();

        const consultas = Array.isArray(state.consultas) ? state.consultas : [];
        const manualConsultas = consultas.filter((consulta) => !!normalizeId(consulta?.id || consulta?._id));
        const hasManualConsultas = manualConsultas.length > 0;
        const isLoadingConsultas = !!state.consultasLoading;
        const vacinas = Array.isArray(state.vacinas) ? state.vacinas : [];
        const hasVacinas = vacinas.length > 0;
        const context = state.agendaContext;
        const selectedPetId = normalizeId(state.selectedPetId);
        const selectedTutorId = normalizeId(state.selectedCliente?._id);
        const contextPetId = normalizeId(context?.petId);
        const contextTutorId = normalizeId(context?.tutorId);

        let agendaElement = null;
        let hasAgendaContent = false;

        const contextMatches = !!(context && selectedPetId && selectedTutorId && contextPetId && contextTutorId && contextPetId === selectedPetId && contextTutorId === selectedTutorId);

        if (contextMatches) {
            const allServices = Array.isArray(context.servicos) ? context.servicos : [];
            const vetServices = getVetServices(allServices);
            const filteredOut = Math.max(allServices.length - vetServices.length, 0);

            if (!vetServices.length) {
                const wrapper = document.createElement('div');
                wrapper.className = 'rounded-xl border border-gray-200 bg-white p-5 text-sm text-slate-600 shadow-sm text-center';

                const emptyBox = document.createElement('div');
                emptyBox.className = 'w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-sm text-slate-600';
                emptyBox.textContent = 'Nenhum serviço veterinário encontrado para este agendamento.';
                wrapper.appendChild(emptyBox);

                if (filteredOut > 0) {
                    const note = document.createElement('p');
                    note.className = 'mt-3 text-xs text-slate-500';
                    note.textContent = `${filteredOut} serviço(s) de outras categorias foram ocultados.`;
                    wrapper.appendChild(note);
                }

                agendaElement = wrapper;
                hasAgendaContent = true;
            } else {
                const card = document.createElement('div');
                card.className = 'bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-4';

                const header = document.createElement('div');
                header.className = 'flex flex-wrap items-start justify-between gap-3';
                card.appendChild(header);

                const info = document.createElement('div');
                header.appendChild(info);

                const title = document.createElement('h3');
                title.className = 'text-base font-semibold text-gray-800';
                title.textContent = 'Serviços veterinários agendados';
                info.appendChild(title);

                const metaList = document.createElement('div');
                metaList.className = 'mt-1 space-y-1 text-sm text-gray-600';
                const when = formatDateTimeDisplay(context.scheduledAt);
                if (when) {
                    const whenEl = document.createElement('div');
                    whenEl.textContent = `Atendimento em ${when}`;
                    metaList.appendChild(whenEl);
                }
                if (context.profissionalNome) {
                    const profEl = document.createElement('div');
                    profEl.textContent = `Profissional: ${context.profissionalNome}`;
                    metaList.appendChild(profEl);
                }
                if (metaList.children.length) info.appendChild(metaList);

                if (context.status) {
                    const statusEl = document.createElement('span');
                    statusEl.className = 'inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700';
                    statusEl.textContent = getStatusLabel(context.status);
                    header.appendChild(statusEl);
                }

                const list = document.createElement('div');
                list.className = 'rounded-lg border border-gray-200 overflow-hidden';
                card.appendChild(list);

                let total = 0;
                vetServices.forEach((service, idx) => {
                    const row = document.createElement('div');
                    row.className = 'flex items-center justify-between px-4 py-2 text-sm text-gray-700 bg-white';
                    if (idx > 0) row.classList.add('border-t', 'border-gray-200');
                    const nameEl = document.createElement('span');
                    nameEl.className = 'pr-3';
                    nameEl.textContent = service.nome || '—';
                    const valueEl = document.createElement('span');
                    valueEl.className = 'font-semibold text-gray-900';
                    valueEl.textContent = formatMoney(service.valor);
                    row.appendChild(nameEl);
                    row.appendChild(valueEl);
                    list.appendChild(row);
                    total += Number(service.valor || 0);
                });

                const totalRow = document.createElement('div');
                totalRow.className = 'flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-gray-800 border border-gray-200';
                const totalLabel = document.createElement('span');
                totalLabel.textContent = 'Total dos serviços';
                const totalValue = document.createElement('span');
                totalValue.textContent = formatMoney(total);
                totalRow.appendChild(totalLabel);
                totalRow.appendChild(totalValue);
                card.appendChild(totalRow);

                if (filteredOut > 0) {
                    const note = document.createElement('p');
                    note.className = 'text-xs text-gray-500';
                    note.textContent = `${filteredOut} serviço(s) de outras categorias foram ocultados.`;
                    card.appendChild(note);
                }

                if (context.observacoes) {
                    const obsWrap = document.createElement('div');
                    obsWrap.className = 'rounded-lg border border-gray-200 bg-slate-50 p-3';
                    const obsTitle = document.createElement('div');
                    obsTitle.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
                    obsTitle.textContent = 'Observações';
                    const obsText = document.createElement('p');
                    obsText.className = 'mt-1 text-sm text-gray-700';
                    obsText.style.whiteSpace = 'pre-line';
                    obsText.textContent = context.observacoes;
                    obsWrap.appendChild(obsTitle);
                    obsWrap.appendChild(obsText);
                    card.appendChild(obsWrap);
                }

                agendaElement = card;
                hasAgendaContent = true;
            }
        }

        const shouldShowPlaceholder = !hasManualConsultas && !hasAgendaContent && !hasVacinas;

        if (isLoadingConsultas && !hasManualConsultas && !hasAgendaContent && !hasVacinas) {
            area.className = CONSULTA_PLACEHOLDER_CLASSNAMES;
            area.innerHTML = '';
            const paragraph = document.createElement('p');
            paragraph.textContent = 'Carregando consultas...';
            area.appendChild(paragraph);
            return;
        }

        if (shouldShowPlaceholder) {
            area.className = CONSULTA_PLACEHOLDER_CLASSNAMES;
            area.innerHTML = '';
            const paragraph = document.createElement('p');
            paragraph.textContent = CONSULTA_PLACEHOLDER_TEXT;
            area.appendChild(paragraph);
            return;
        }

        area.className = CONSULTA_CARD_CLASSNAMES;
        area.innerHTML = '';

        const scroll = document.createElement('div');
        scroll.className = 'h-full w-full overflow-y-auto p-5 space-y-4';
        area.appendChild(scroll);

        if (hasVacinas) {
            const orderedVacinas = [...vacinas];
            orderedVacinas.sort((a, b) => {
                const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
                return bTime - aTime;
            });
            orderedVacinas.forEach((vacina) => {
                const card = createVacinaCard(vacina);
                if (card) scroll.appendChild(card);
            });
        }

        if (hasManualConsultas) {
            manualConsultas.forEach((consulta) => {
                const card = createManualConsultaCard(consulta);
                scroll.appendChild(card);
            });
        }

        if (agendaElement) {
            scroll.appendChild(agendaElement);
        }
    }

    function updateCardDisplay() {
        const pet = getSelectedPet();
        const hasPet = !!pet;
        if (hasPet) {
            updatePetInfo(pet);
        } else {
            setPetPlaceholders();
        }
        const wantsPet = state.currentCardMode === 'pet';
        const showPet = wantsPet && hasPet;
        if (wantsPet && !hasPet) {
            state.currentCardMode = 'tutor';
        }
        if (els.tutorInfo) els.tutorInfo.classList.toggle('hidden', showPet);
        if (els.petInfo) els.petInfo.classList.toggle('hidden', !showPet);
        if (els.cardIcon) {
            els.cardIcon.classList.remove(...CARD_TUTOR_ACTIVE_CLASSES, ...CARD_PET_ACTIVE_CLASSES);
            els.cardIcon.classList.add(...(showPet ? CARD_PET_ACTIVE_CLASSES : CARD_TUTOR_ACTIVE_CLASSES));
        }
        if (els.cardIconSymbol) {
            els.cardIconSymbol.className = `fas ${showPet ? 'fa-paw' : 'fa-user'} text-xl`;
        }
        updateToggleButtons(showPet, hasPet);
        updateConsultaAgendaCard();
    }

    function setCardMode(mode) {
        state.currentCardMode = mode === 'pet' ? 'pet' : 'tutor';
        updateCardDisplay();
    }

    // --- busca clientes (igual fluxo da Agenda) ---
    async function searchClientes(term) {
        if (!term || term.trim().length < 2) {
            hideSugestoes();
            return;
        }
        try {
            const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(term)}&limit=8`);
            const list = await resp.json().catch(() => []);
            if (!Array.isArray(list) || !els.cliSug) return;

            els.cliSug.innerHTML = list.map(u => `
        <li class="px-3 py-2 hover:bg-gray-50 cursor-pointer" data-id="${u._id}" data-nome="${u.nome}" data-email="${u.email || ''}" data-celular="${u.celular || ''}">
            <div class="font-medium text-gray-900">${u.nome}</div>
            <div class="text-xs text-gray-500">${u.email || ''}</div>
        </li>`).join('');
            els.cliSug.classList.remove('hidden');

            Array.from(els.cliSug.querySelectorAll('li')).forEach(li => {
                li.addEventListener('click', () => onSelectCliente({
                    _id: li.dataset.id,
                    nome: li.dataset.nome,
                    email: li.dataset.email || '',
                    celular: li.dataset.celular || ''
                }));
            });
        } catch (e) {
            // silencioso
        }
    }

    function hideSugestoes() {
        if (els.cliSug) {
            els.cliSug.innerHTML = '';
            els.cliSug.classList.add('hidden');
        }
    }

    async function onSelectCliente(cli, opts = {}) {
        const {
            skipPersistCliente = false,
            clearPersistedPet = true,
            persistedPetId = null,
        } = opts;

        let cliente = cli ? { ...cli } : null;
        const clienteId = normalizeId(cliente?._id);
        if (clienteId) {
            const existingNome = pickFirst(cliente?.nome);
            const existingEmail = pickFirst(cliente?.email);
            const existingCelular = pickFirst(cliente?.celular);
            const existingTelefone = pickFirst(cliente?.telefone);
            const needsHydration = !existingNome || !existingEmail || !pickFirst(existingCelular, existingTelefone);
            let fetched = null;
            if (needsHydration) {
                fetched = await fetchClienteById(clienteId);
            }
            const fetchedNome = pickFirst(fetched?.nome);
            const fetchedEmail = pickFirst(fetched?.email);
            const fetchedCelular = pickFirst(fetched?.celular);
            const fetchedTelefone = pickFirst(fetched?.telefone);
            const phoneCandidates = [existingCelular, existingTelefone, fetchedCelular, fetchedTelefone]
                .map(value => String(value || '').trim())
                .filter(Boolean);
            const uniquePhones = [];
            phoneCandidates.forEach((phone) => {
                if (!uniquePhones.includes(phone)) uniquePhones.push(phone);
            });
            const primaryPhone = uniquePhones[0] || '';
            const secondaryPhone = uniquePhones[1] || '';
            cliente = {
                ...cliente,
                _id: clienteId,
                nome: pickFirst(existingNome, fetchedNome),
                email: pickFirst(existingEmail, fetchedEmail),
                celular: primaryPhone,
            };
            if (secondaryPhone) {
                cliente.telefone = secondaryPhone;
            } else {
                delete cliente.telefone;
            }
        } else {
            cliente = null;
        }

        state.selectedCliente = cliente;
        state.selectedPetId = null;
        state.petsById = {};
        state.currentCardMode = 'tutor';
        state.consultas = [];
        state.consultasLoadKey = null;
        state.consultasLoading = false;
        state.vacinas = [];
        const tutorId = normalizeId(state.selectedCliente?._id);
        if (state.agendaContext) {
            const contextTutorId = normalizeId(state.agendaContext.tutorId);
            if (!tutorId || !contextTutorId || contextTutorId !== tutorId) {
                state.agendaContext = null;
            }
        }
        persistAgendaContext(state.agendaContext);
        if (!skipPersistCliente) {
            persistCliente(state.selectedCliente);
        }
        if (clearPersistedPet) {
            persistPetId(null);
        }
        updatePageVisibility();
        updateConsultaAgendaCard();
        if (els.cliInput) els.cliInput.value = state.selectedCliente?.nome || '';
        hideSugestoes();

        const tutorNome = pickFirst(state.selectedCliente?.nome);
        const tutorEmail = pickFirst(state.selectedCliente?.email);
        const tutorPhone = pickFirst(state.selectedCliente?.celular, state.selectedCliente?.telefone);
        if (els.tutorNome) els.tutorNome.textContent = tutorNome || '—';
        if (els.tutorEmail) els.tutorEmail.textContent = tutorEmail || '—';
        if (els.tutorTelefone) {
            els.tutorTelefone.textContent = tutorPhone ? formatPhone(tutorPhone) : '—';
        }

        updateCardDisplay();

        const normalizedTutorId = tutorId;
        if (!normalizedTutorId) {
            if (els.petSelect) {
                els.petSelect.innerHTML = `<option value="">Selecione o tutor para listar os pets</option>`;
            }
            updatePageVisibility();
            return;
        }

        try {
            if (els.petSelect) {
                els.petSelect.innerHTML = `<option value="">Carregando pets…</option>`;
            }
            const resp = await api(`/func/clientes/${normalizedTutorId}/pets`);
            const pets = await resp.json().catch(() => []);
            state.petsById = {};
            if (Array.isArray(pets)) {
                pets.forEach(p => {
                    if (p && p._id) {
                        state.petsById[p._id] = p;
                    }
                });
            }
            if (els.petSelect) {
                if (Array.isArray(pets) && pets.length) {
                    els.petSelect.innerHTML = [`<option value="">Selecione o pet</option>`]
                        .concat(pets.map(p => `<option value="${p._id}">${p.nome}</option>`))
                        .join('');
                    let petSelecionado = false;
                    if (persistedPetId) {
                        const match = pets.find(p => p._id === persistedPetId);
                        if (match) {
                            els.petSelect.value = persistedPetId;
                            await onSelectPet(persistedPetId, { skipPersistPet: true });
                            petSelecionado = true;
                        } else if (!clearPersistedPet) {
                            persistPetId(null);
                        }
                    }
                    if (!petSelecionado && pets.length === 1) {
                        els.petSelect.value = pets[0]._id;
                        await onSelectPet(pets[0]._id);
                    }
                } else {
                    els.petSelect.innerHTML = `<option value="">Nenhum pet encontrado</option>`;
                }
            }
        } catch { }
        updateCardDisplay();
        updatePageVisibility();
    }

    async function onSelectPet(petId, opts = {}) {
        const { skipPersistPet = false } = opts;
        state.selectedPetId = petId || null;
        if (!skipPersistPet) {
            persistPetId(state.selectedPetId);
        }
        state.consultas = [];
        state.consultasLoadKey = null;
        state.consultasLoading = false;
        loadVacinasForSelection();
        updateCardDisplay();
        updatePageVisibility();
        if (!state.selectedPetId) {
            updateConsultaAgendaCard();
            return;
        }
        await loadConsultasFromServer({ force: true });
    }

    function clearCliente() {
        state.selectedCliente = null;
        state.petsById = {};
        state.currentCardMode = 'tutor';
        state.agendaContext = null;
        state.consultas = [];
        state.consultasLoadKey = null;
        state.consultasLoading = false;
        state.vacinas = [];
        persistAgendaContext(null);
        if (els.cliInput) els.cliInput.value = '';
        hideSugestoes();
        if (els.petSelect) {
            els.petSelect.innerHTML = `<option value="">Selecione o tutor para listar os pets</option>`;
        }
        clearPet();
        if (els.tutorNome) els.tutorNome.textContent = 'Nome Tutor';
        if (els.tutorEmail) els.tutorEmail.textContent = '—';
        // não forçamos limpar telefone se a UI já tiver valor útil
        persistCliente(null);
        updatePageVisibility();
        updateConsultaAgendaCard();
    }

    function clearPet() {
        state.selectedPetId = null;
        if (els.petSelect) els.petSelect.value = '';
        persistPetId(null);
        state.currentCardMode = 'tutor';
        state.consultas = [];
        state.consultasLoadKey = null;
        state.consultasLoading = false;
        state.vacinas = [];
        updateCardDisplay();
        updatePageVisibility();
    }

    function restorePersistedSelection() {
        const { cliente, petId, agendaContext } = getPersistedState();
        state.agendaContext = agendaContext || null;
        if (state.agendaContext && cliente) {
            const contextTutorId = normalizeId(state.agendaContext.tutorId);
            const clienteId = normalizeId(cliente._id);
            if (!contextTutorId || !clienteId || contextTutorId !== clienteId) {
                state.agendaContext = null;
            }
        } else if (state.agendaContext && !cliente) {
            state.agendaContext = null;
        }
        if (state.agendaContext) {
            getAgendaStoreId();
        }
        persistAgendaContext(state.agendaContext);
        updateConsultaAgendaCard();
        if (cliente) {
            const promise = onSelectCliente(cliente, {
                clearPersistedPet: false,
                persistedPetId: petId,
            });
            if (promise && typeof promise.then === 'function') {
                promise.catch(() => {});
            }
        } else if (petId) {
            // pet salvo sem tutor selecionado não é válido
            persistPetId(null);
        }
    }

    // --- eventos ---
    if (els.cliInput) {
        els.cliInput.addEventListener('input', debounce(e => searchClientes(e.target.value), 300));
        // esconder sugestões clicando fora
        document.addEventListener('click', (ev) => {
            if (!els.cliSug || els.cliSug.classList.contains('hidden')) return;
            const within = ev.target === els.cliInput || els.cliSug.contains(ev.target);
            if (!within) hideSugestoes();
        });
    }
    if (els.cliClear) {
        els.cliClear.addEventListener('click', (e) => { e.preventDefault(); clearCliente(); });
    }
    if (els.petSelect) {
        els.petSelect.addEventListener('change', (e) => {
            const result = onSelectPet(e.target.value);
            if (result && typeof result.then === 'function') {
                result.catch(() => {});
            }
        });
    }
    if (els.petClear) {
        els.petClear.addEventListener('click', (e) => { e.preventDefault(); clearPet(); });
    }
    if (els.toggleTutor) {
        els.toggleTutor.addEventListener('click', (e) => {
            e.preventDefault();
            setCardMode('tutor');
        });
    }
    if (els.togglePet) {
        els.togglePet.addEventListener('click', (e) => {
            e.preventDefault();
            setCardMode('pet');
        });
    }
    if (els.addConsultaBtn) {
        els.addConsultaBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openConsultaModal();
        });
    }
    if (els.addVacinaBtn) {
        els.addVacinaBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openVacinaModal();
        });
    }
    updateCardDisplay();
    restorePersistedSelection();
    updatePageVisibility();
})();
