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
        consultaTab: document.getElementById('vet-tab-consulta')
    };

    const state = {
        selectedCliente: null,
        selectedPetId: null,
        petsById: {},
        currentCardMode: 'tutor',
        agendaContext: null,
    };

    const STORAGE_KEYS = {
        cliente: 'vetFichaSelectedCliente',
        petId: 'vetFichaSelectedPetId',
        agenda: 'vetFichaAgendaContext',
    };

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

        const applyPlaceholder = (message = CONSULTA_PLACEHOLDER_TEXT) => {
            area.className = CONSULTA_PLACEHOLDER_CLASSNAMES;
            area.innerHTML = '';
            const paragraph = document.createElement('p');
            paragraph.textContent = message;
            area.appendChild(paragraph);
        };

        const context = state.agendaContext;
        const selectedPetId = normalizeId(state.selectedPetId);
        const selectedTutorId = normalizeId(state.selectedCliente?._id);
        const contextPetId = normalizeId(context?.petId);
        const contextTutorId = normalizeId(context?.tutorId);

        if (!context || !selectedPetId || !selectedTutorId || !contextPetId || !contextTutorId || contextPetId !== selectedPetId || contextTutorId !== selectedTutorId) {
            applyPlaceholder();
            return;
        }

        const allServices = Array.isArray(context.servicos) ? context.servicos : [];
        const vetServices = getVetServices(allServices);
        const filteredOut = Math.max(allServices.length - vetServices.length, 0);

        if (!vetServices.length) {
            area.className = `${CONSULTA_CARD_CLASSNAMES} flex flex-col items-center justify-center p-5`;
            area.innerHTML = '';
            const emptyBox = document.createElement('div');
            emptyBox.className = 'w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center text-sm text-slate-600';
            emptyBox.textContent = 'Nenhum serviço veterinário encontrado para este agendamento.';
            area.appendChild(emptyBox);
            if (filteredOut > 0) {
                const note = document.createElement('p');
                note.className = 'mt-3 text-xs text-slate-500 text-center';
                note.textContent = `${filteredOut} serviço(s) de outras categorias foram ocultados.`;
                area.appendChild(note);
            }
            return;
        }

        area.className = CONSULTA_CARD_CLASSNAMES;
        area.innerHTML = '';
        const scroll = document.createElement('div');
        scroll.className = 'h-full w-full overflow-y-auto p-5';
        area.appendChild(scroll);

        const card = document.createElement('div');
        card.className = 'bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-4';
        scroll.appendChild(card);

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
        state.selectedCliente = cli || null;
        state.selectedPetId = null;
        state.petsById = {};
        state.currentCardMode = 'tutor';
        const tutorId = normalizeId(cli?._id);
        if (state.agendaContext) {
            const contextTutorId = normalizeId(state.agendaContext.tutorId);
            if (!tutorId || !contextTutorId || contextTutorId !== tutorId) {
                state.agendaContext = null;
            }
        }
        if (!skipPersistCliente) {
            persistCliente(state.selectedCliente);
        }
        if (clearPersistedPet) {
            persistPetId(null);
        }
        updatePageVisibility();
        updateConsultaAgendaCard();
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
        state.agendaContext = null;
        try { localStorage.removeItem(STORAGE_KEYS.agenda); } catch { }
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
        updateConsultaAgendaCard();
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
