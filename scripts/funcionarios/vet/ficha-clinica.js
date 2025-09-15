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
        petTipoRaca: document.getElementById('vet-pet-type-raca'),
        petNascimentoPeso: document.getElementById('vet-pet-nascimento-peso'),
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
        pageContent: document.getElementById('vet-ficha-content')
    };

    const state = {
        selectedCliente: null,
        selectedPetId: null,
        petsById: {},
        currentCardMode: 'tutor',
    };

    const STORAGE_KEYS = {
        cliente: 'vetFichaSelectedCliente',
        petId: 'vetFichaSelectedPetId',
    };

    const CARD_TUTOR_ACTIVE_CLASSES = ['bg-sky-100', 'text-sky-700'];
    const CARD_PET_ACTIVE_CLASSES = ['bg-emerald-100', 'text-emerald-700'];
    const CARD_BUTTON_INACTIVE_CLASSES = ['bg-gray-100', 'text-gray-600'];
    const CARD_BUTTON_DISABLED_CLASSES = ['opacity-50', 'cursor-not-allowed'];
    const PET_PLACEHOLDERS = {
        nome: 'Nome do Pet',
        tipoRaca: 'Tipo de Pet - Raça',
        nascimentoPeso: 'Data Nascimento - Peso (Kg)',
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
            if (cli && cli._id) {
                localStorage.setItem(STORAGE_KEYS.cliente, JSON.stringify(cli));
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
        return { cliente, petId };
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

    function getSelectedPet() {
        const petId = state.selectedPetId;
        if (!petId) return null;
        return (state.petsById && state.petsById[petId]) || null;
    }

    function setPetPlaceholders() {
        if (els.petNome) els.petNome.textContent = PET_PLACEHOLDERS.nome;
        if (els.petTipoRaca) els.petTipoRaca.textContent = PET_PLACEHOLDERS.tipoRaca;
        if (els.petNascimentoPeso) els.petNascimentoPeso.textContent = PET_PLACEHOLDERS.nascimentoPeso;
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
        let tipoRaca = '—';
        if (tipo && raca) tipoRaca = `${tipo} - ${raca}`;
        else if (tipo) tipoRaca = tipo;
        else if (raca) tipoRaca = raca;
        if (els.petTipoRaca) els.petTipoRaca.textContent = tipoRaca;

        const nascimento = formatDateDisplay(pet.dataNascimento || pet.nascimento);
        const peso = formatPetWeight(pet.peso || pet.pesoAtual);
        let nascimentoPeso = '—';
        if (nascimento && peso) nascimentoPeso = `${nascimento} - ${peso}`;
        else if (nascimento) nascimentoPeso = nascimento;
        else if (peso) nascimentoPeso = peso;
        if (els.petNascimentoPeso) els.petNascimentoPeso.textContent = nascimentoPeso;

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
        state.selectedCliente = cli || null;
        state.selectedPetId = null;
        state.petsById = {};
        state.currentCardMode = 'tutor';
        if (!skipPersistCliente) {
            persistCliente(state.selectedCliente);
        }
        if (clearPersistedPet) {
            persistPetId(null);
        }
        updatePageVisibility();
        if (els.cliInput) els.cliInput.value = cli?.nome || '';
        hideSugestoes();

        // preenche card do tutor
        if (els.tutorNome) els.tutorNome.textContent = cli?.nome || '—';
        if (els.tutorEmail) els.tutorEmail.textContent = (cli?.email || '').trim() ? `${cli.email}` : '—';
        if (els.tutorTelefone) els.tutorTelefone.textContent = (cli?.celular || '').trim()
            ? formatPhone(cli.celular)
            : '—';

        updateCardDisplay();

        // carrega pets do tutor e popular select
        try {
            if (els.petSelect) {
                els.petSelect.innerHTML = `<option value="">Carregando pets…</option>`;
            }
            const resp = await api(`/func/clientes/${cli._id}/pets`);
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
                            onSelectPet(persistedPetId);
                            petSelecionado = true;
                        } else if (!clearPersistedPet) {
                            persistPetId(null);
                        }
                    }
                    // se só houver 1 pet, selecionar automaticamente
                    if (!petSelecionado && pets.length === 1) {
                        els.petSelect.value = pets[0]._id;
                        onSelectPet(pets[0]._id);
                    }
                } else {
                    els.petSelect.innerHTML = `<option value="">Nenhum pet encontrado</option>`;
                }
            }
        } catch { }
        updateCardDisplay();
        updatePageVisibility();
    }

    function onSelectPet(petId, opts = {}) {
        const { skipPersistPet = false } = opts;
        state.selectedPetId = petId || null;
        if (!skipPersistPet) {
            persistPetId(state.selectedPetId);
        }
        updateCardDisplay();
        updatePageVisibility();
    }

    function clearCliente() {
        state.selectedCliente = null;
        state.petsById = {};
        state.currentCardMode = 'tutor';
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
    }

    function clearPet() {
        state.selectedPetId = null;
        if (els.petSelect) els.petSelect.value = '';
        persistPetId(null);
        state.currentCardMode = 'tutor';
        updateCardDisplay();
        updatePageVisibility();
    }

    function restorePersistedSelection() {
        const { cliente, petId } = getPersistedState();
        if (cliente) {
            onSelectCliente(cliente, {
                clearPersistedPet: false,
                persistedPetId: petId,
            });
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
        els.petSelect.addEventListener('change', (e) => onSelectPet(e.target.value));
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
    updateCardDisplay();
    restorePersistedSelection();
    updatePageVisibility();
})();
