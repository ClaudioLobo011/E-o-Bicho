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
        tutorNome: document.getElementById('vet-tutor-nome'),
        tutorEmail: document.getElementById('vet-tutor-email'),
        tutorTelefone: document.getElementById('vet-tutor-telefone'),
        pageContent: document.getElementById('vet-ficha-content')
    };

    const state = {
        selectedCliente: null,
        selectedPetId: null,
    };

    const STORAGE_KEYS = {
        cliente: 'vetFichaSelectedCliente',
        petId: 'vetFichaSelectedPetId',
    };

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

        // carrega pets do tutor e popular select
        try {
            if (els.petSelect) {
                els.petSelect.innerHTML = `<option value="">Carregando pets…</option>`;
            }
            const resp = await api(`/func/clientes/${cli._id}/pets`);
            const pets = await resp.json().catch(() => []);
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
        updatePageVisibility();
    }

    function onSelectPet(petId, opts = {}) {
        const { skipPersistPet = false } = opts;
        state.selectedPetId = petId || null;
        if (!skipPersistPet) {
            persistPetId(state.selectedPetId);
        }
        // aqui poderemos preencher outros campos específicos do pet, caso a página venha a ter (ex.: raça/porte).
        // por enquanto, mantemos o comportamento: seleção do pet no topo + tutor no card.
        updatePageVisibility();
    }

    function clearCliente() {
        state.selectedCliente = null;
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
    restorePersistedSelection();
    updatePageVisibility();
})();
