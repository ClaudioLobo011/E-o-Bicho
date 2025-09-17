document.addEventListener('DOMContentLoaded', () => {
    // --- ReferÃƒÂªncias aos elementos do DOM ---
    const petsListContainer = document.getElementById('pets-list-container');
    const addPetBtnContainer = document.getElementById('add-pet-button-container');
    const petFormContainer = document.getElementById('pet-form-container');
    const addPetBtn = document.getElementById('add-pet-btn');
    const petForm = document.getElementById('new-pet-form');
    const cancelPetBtn = document.getElementById('cancel-pet-btn');
    const petTypeSelect = document.getElementById('pet-type');
    const breedInput = document.getElementById('pet-raca');
    const porteSelect = document.getElementById('pet-porte');
    const hiddenPetIdInput = document.getElementById('pet-id');
    let awesompleteInstance;
    let SPECIES_MAP = null;         // { cachorro:{portes:{mini:[],...}, all:[], map:{breed->porte}}, gato:[...], passaro:[...], peixe:[...], roedor:[...], lagarto:[...], tartaruga:[...] }

    // Helpers para normalizar strings (ignora acentos/maiÃƒÂºsculas)
    const norm = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
    const normSize = (s) => {
      const k = norm(s);
      if (k.startsWith('mini')) return 'mini';
      if (k.startsWith('peq')) return 'pequeno';
      if (k.startsWith('med')) return 'medio';
      if (k.startsWith('gra')) return 'grande';
      if (k.startsWith('gig')) return 'gigante';
      return 'medio';
    };

    // Corrige sequÃªncias comuns de texto corrompidas por encoding (UTF-8 vs ISO-8859-1)
    function fixEncoding(s) {
      if (!s) return s;
      return String(s)
        .replace(/ÃƒÂ¡/g,'Ã¡').replace(/ÃƒÂ¢/g,'Ã¢').replace(/ÃƒÂ£/g,'Ã£').replace(/ÃƒÂ¤/g,'Ã¤')
        .replace(/ÃƒÂ/g,'Ã').replace(/Ãƒâ€š/g,'Ã‚').replace(/ÃƒÆ’/g,'Ãƒ')
        .replace(/ÃƒÂ©/g,'Ã©').replace(/ÃƒÂª/g,'Ãª').replace(/ÃƒÂ¨/g,'Ã¨').replace(/Ãƒâ€°/g,'Ã‰').replace(/ÃƒÅ /g,'ÃŠ')
        .replace(/ÃƒÂ­/g,'Ã­').replace(/ÃƒÂ¬/g,'Ã¬').replace(/ÃƒÂ/g,'Ã')
        .replace(/ÃƒÂ³/g,'Ã³').replace(/ÃƒÂ´/g,'Ã´').replace(/ÃƒÂµ/g,'Ãµ').replace(/Ãƒâ€œ/g,'Ã“').replace(/Ãƒâ€/g,'Ã”')
        .replace(/ÃƒÂº/g,'Ãº').replace(/ÃƒÂ¼/g,'Ã¼').replace(/ÃƒÅ¡/g,'Ãš')
        .replace(/ÃƒÂ§/g,'Ã§').replace(/ÃƒÂ‡/g,'Ã‡')
        .replace(/ÃƒÂ /g,'Ã ').replace(/ÃƒÂ¸/g,'Ã¸')
        .replace(/Ã‚Âº/g,'Âº').replace(/Ã‚Âª/g,'Âª')
        .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“/g,'â€“').replace(/Ã¢â‚¬â€œ/g,'â€“').replace(/Ã¢â‚¬â€/g,'â€”')
        .replace(/Ã¢â‚¬Ëœ/g,'â€˜').replace(/Ã¢â‚¬â„¢/g,'â€™').replace(/Ã¢â‚¬Å“/g,'â€œ').replace(/Ã¢â‚¬Â/g,'â€')
        .replace(/Ã¢â‚¬Â¢/g,'â€¢').replace(/Ã¢â‚¬Â¦/g,'â€¦');
    }

    async function loadSpeciesMap() {
      if (SPECIES_MAP) return SPECIES_MAP;
      const base = (window.basePath || '../');
      const jsonUrl = base + 'data/racas.json';
      const legacyUrl = base + 'data/Racas-leitura.js';

      const cleanList = (body) => body.split(/\n+/)
        .map(x => x.trim())
        .filter(x => x && !x.startsWith('//') && x !== '...')
        .map(x => x.replace(/\*.*?\*/g, ''))
        .map(x => x.replace(/\s*\(duplicata.*$/i, ''))
        .map(x => x.replace(/\s*[—-].*$/,'').replace(/\s*-\s*registro.*$/i,''));

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
          ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante
        ]));
        const dogLookup = {};
        const dogMapPayload = dogPayload.map || {};
        dogAll.forEach(nome => {
          const normalized = norm(nome);
          const porte = dogMapPayload[normalized] || dogMapPayload[nome] ||
            (dogMap.mini.includes(nome) ? 'mini' :
              dogMap.pequeno.includes(nome) ? 'pequeno' :
              dogMap.medio.includes(nome) ? 'medio' :
              dogMap.grande.includes(nome) ? 'grande' : 'gigante');
          dogLookup[normalized] = porte;
        });
        species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

        const simples = ['gato','passaro','peixe','roedor','lagarto','tartaruga'];
        simples.forEach(tipo => {
          const arr = Array.isArray(payload[tipo]) ? payload[tipo] : [];
          species[tipo] = Array.from(new Set(arr.filter(Boolean)));
        });
        return species;
      };

      const buildFromLegacy = (txt) => {
        if (!txt) throw new Error('conteúdo vazio');
        const species = {};
        let dogMap = { mini:[], pequeno:[], medio:[], grande:[], gigante:[] };
        const reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
        let m;
        while ((m = reDogGlobal.exec(txt))) {
          const key = m[1].toLowerCase();
          const list = cleanList(m[2]);
          dogMap[key] = Array.from(new Set(list));
        }
        const dogAll = Array.from(new Set([
          ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante
        ]));
        const dogLookup = {};
        dogAll.forEach(n => {
          const k = norm(n);
          dogLookup[k] =
            dogMap.mini.includes(n)    ? 'mini'    :
            dogMap.pequeno.includes(n) ? 'pequeno' :
            dogMap.medio.includes(n)   ? 'medio'   :
            dogMap.grande.includes(n)  ? 'grande'  : 'gigante';
        });
        species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

        const simpleSpecies = ['gatos','gato','passaros','passaro','peixes','peixe','roedores','roedor','lagartos','lagarto','tartarugas','tartaruga'];
        for (const sp of simpleSpecies) {
          const match = new RegExp(sp + "\\s*{([\\s\\S]*?)}","i").exec(txt);
          if (!match) continue;
          const list = cleanList(match[1]);
          const singular =
            /roedores$/i.test(sp)   ? 'roedor'     :
            /gatos$/i.test(sp)      ? 'gato'       :
            /passaros$/i.test(sp)   ? 'passaro'    :
            /peixes$/i.test(sp)     ? 'peixe'      :
            /lagartos$/i.test(sp)   ? 'lagarto'    :
            /tartarugas$/i.test(sp) ? 'tartaruga'  :
            sp.replace(/s$/, '');
          species[singular] = Array.from(new Set(list));
        }
        return species;
      };

      try {
        const res = await fetch(jsonUrl, { headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          SPECIES_MAP = buildFromJson(await res.json());
          return SPECIES_MAP;
        }
        if (res.status && res.status !== 404) {
          console.warn('pets: falha ao obter racas.json', res.status);
        }
      } catch (err) {
        console.warn('pets: erro ao ler racas.json', err);
      }

      try {
        const res = await fetch(legacyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text();
        SPECIES_MAP = buildFromLegacy(txt);
        return SPECIES_MAP;
      } catch (e) {
        console.warn('Falha ao ler Racas-leitura.js', e);
        SPECIES_MAP = null;
        return null;
      }
    }

    function setPorteFromBreedIfDog() {
      if (!porteSelect) return;
      const isDog = petTypeSelect && norm(petTypeSelect.value) === 'cachorro';
      if (!isDog) return;
      const map = SPECIES_MAP?.cachorro?.map;
      const b = norm(breedInput?.value || '');
      const k = map ? map[b] : null;
      const desired = k || 'medio';
      // encontra a option pelo texto (normalizado)
      const opts = Array.from(porteSelect.options || []);
      const match = opts.find(o => normSize(o.textContent) === desired);
      if (match) porteSelect.value = match.value || match.textContent;
    }

    function syncPorteDisabled() {
      if (!porteSelect) return;
      const isDog = petTypeSelect && norm(petTypeSelect.value) === 'cachorro';
      // Nunca esconder; apenas bloquear com o valor apropriado
      porteSelect.disabled = true;
      if (isDog) {
        setPorteFromBreedIfDog();
      } else {
        const none = Array.from(porteSelect.options).find(o => (o.textContent||'').toLowerCase().includes('sem porte'));
        if (none) porteSelect.value = none.value || none.textContent;
      }
    }

    // --- Funções de Visibilidade do Formulário ---

    const showForm = () => {
        if (addPetBtnContainer && petFormContainer) {
            addPetBtnContainer.classList.add('hidden');
            petFormContainer.classList.remove('hidden');
        }
    };

    const hideForm = () => {
        if (addPetBtnContainer && petFormContainer) {
            petFormContainer.classList.add('hidden');
            addPetBtnContainer.classList.remove('hidden');
            petForm.reset();
            hiddenPetIdInput.value = '';
        }
    };

    function normalizeStaticLabels() {
        try {
            const sexoSel = document.getElementById('pet-sexo');
            if (sexoSel) {
                Array.from(sexoSel.options).forEach(o => {
                    if (/Fêmea/i.test(o.textContent)) o.textContent = 'Fêmea';
                });
            }
            if (porteSelect) {
                let none = Array.from(porteSelect.options).find(o => (o.textContent||'').toLowerCase().includes('sem porte'));
                if (!none) {
                    none = document.createElement('option');
                    none.textContent = 'Sem porte definido';
                    none.value = 'Sem porte definido';
                    porteSelect.insertBefore(none, porteSelect.firstChild);
                }
                Array.from(porteSelect.options).forEach(o => {
                    if (/Médio/i.test(o.textContent)) o.textContent = 'Médio';
                });
            }
        } catch(_) {}
    }

    // Garante que o select de tipos tenha todas as opções desejadas
    function ensurePetTypeOptions() {
        if (!petTypeSelect) return;
        const want = [
          ['cachorro','Cachorro'],
          ['gato','Gato'],
          ['passaro','Pássaro'],
          ['peixe','Peixe'],
          ['roedor','Roedor'],
          ['lagarto','Lagarto'],
          ['tartaruga','Tartaruga']
        ];
        const existing = new Set(Array.from(petTypeSelect.options).map(o => (o.value||'').toLowerCase()));
        for (const [val,label] of want) {
          if (!existing.has(val)) { const op=document.createElement('option'); op.value=val; op.textContent=label; petTypeSelect.appendChild(op); }
        }
        Array.from(petTypeSelect.options).forEach(o => { if ((o.value||'').toLowerCase()==='passaro') o.textContent='Pássaro'; });
    }

    // --- Função Principal para Exibir os Pets ---

    async function fetchAndDisplayPets() {
        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
        if (!loggedInUser?.id || !loggedInUser.token || !petsListContainer) return;

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/pets/user/${loggedInUser.id}`, {
                headers: {
                    'Authorization': `Bearer ${loggedInUser.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error('Não foi possível buscar os pets.');
            const pets = await response.json();

            petsListContainer.innerHTML = '';

            pets.forEach(pet => {
                const petCard = `
                <div class="bg-white px-4 py-3 border rounded-lg shadow-sm flex items-center w-full max-w-md">
                    <div class="flex-grow pr-4">
                    <h3 class="font-bold text-lg text-primary">${fixEncoding(pet.nome)}</h3>
                    <p class="text-sm text-gray-600">${fixEncoding(pet.raca)} | ${fixEncoding(pet.tipo)}</p>
                    </div>
                    <div class="flex flex-col space-y-1">
                    <button onclick="handleEditPet('${pet._id}')" class="text-blue-500 hover:text-blue-700 transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-blue-500/10">
                        <div data-icon="edit" class="w-10 h-10"></div>
                        <span class="sr-only">Editar</span>
                    </button>
                    <button onclick="handleDeletePet('${pet._id}', '${pet.nome}')" class="text-red-500 hover:text-red-700 transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-red-500/10">
                        <div data-icon="trash-pet" class="w-10 h-10"></div>
                        <span class="sr-only">Excluir</span>
                    </button>
                    </div>
                </div>
                `;
                petsListContainer.innerHTML += petCard;
            });
            
            await loadIcons();
        } catch (error) {
            console.error('Erro ao buscar pets:', error);
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    }

    // --- Funções de Edição, Exclusão e Submissão ---

    window.handleEditPet = async (petId) => {
        try {
        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
        if (!loggedInUser?.token) {
            showModal({ title: 'Erro', message: 'Você precisa estar logado.', confirmText: 'OK' });
            return;
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/pets/${petId}`, {
            headers: {
                'Authorization': `Bearer ${loggedInUser.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Pet não encontrado.');
        const petData = await response.json();

            hiddenPetIdInput.value = petData._id;
            petForm.querySelector('#pet-name').value = petData.nome;
            petForm.querySelector('#pet-type').value = petData.tipo;
            petForm.querySelector('#pet-raca').value = petData.raca;
            petForm.querySelector('#pet-porte').value = petData.porte;
            petForm.querySelector('#pet-sexo').value = petData.sexo;
            if (petData.dataNascimento) {
                petForm.querySelector('#pet-nascimento').value = new Date(petData.dataNascimento).toISOString().split('T')[0];
            }
            petForm.querySelector('#pet-microchip').value = petData.microchip || '';
            petForm.querySelector('#pet-pelagem').value = petData.pelagemCor || '';
            petForm.querySelector('#pet-rga').value = petData.rga || '';
            petForm.querySelector('#pet-peso').value = petData.peso || '';

            updateBreedOptions();
            showForm();
            // aplica bloqueio/porte automático se cachorro
            syncPorteDisabled();
            setPorteFromBreedIfDog();
        } catch (error) {
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    };

    /**
     * NOVA FUNÇÃO: Lida com a exclusão de um pet, pedindo confirmação.
     * @param {string} petId O ID do pet a ser excluído.
     * @param {string} petName O nome do pet para usar na mensagem de confirmação.
     */
    window.handleDeletePet = (petId, petName) => {
        showModal({
            title: 'Confirmar Exclusão',
            message: `Tem a certeza que deseja excluir o pet "${petName}"? Esta ação não pode ser desfeita.`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                    if (!loggedInUser?.token) {
                        showModal({ title: 'Erro', message: 'Você precisa estar logado.', confirmText: 'OK' });
                        return;
                    }

                    const response = await fetch(`${API_CONFIG.BASE_URL}/pets/${petId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${loggedInUser.token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        const result = await response.json();
                        throw new Error(result.message || 'Não foi possível excluir o pet.');
                    }
                    
                    showModal({
                        title: 'Sucesso!',
                        message: `O pet "${petName}" foi excluído.`,
                        confirmText: 'OK',
                        onConfirm: () => window.location.reload()
                    });

                } catch (error) {
                    showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
                }
            }
        });
    };

    if (petForm) {
        petForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const submitButton = petForm.querySelector('button[type="submit"]');
            const originalButtonHtml = submitButton.innerHTML;
            submitButton.disabled = true;
            submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...`;

            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            if (!loggedInUser) {
                alert('Utilizador não está logado!');
                return;
            }

            const formData = new FormData(petForm);
            const petData = Object.fromEntries(formData.entries());
            if (porteSelect && porteSelect.disabled) {
                petData['pet_porte'] = porteSelect.value;
            }
            
            const petId = hiddenPetIdInput.value;
            const isEditing = !!petId;

            const method = isEditing ? 'PUT' : 'POST';
            const url = isEditing ? `${API_CONFIG.BASE_URL}/pets/${petId}` : `${API_CONFIG.BASE_URL}/pets`;

            if (!isEditing) {
                petData.owner = loggedInUser.id;
            }

            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                if (!loggedInUser?.token) {
                    showModal({ title: 'Erro', message: 'Token não fornecido.', confirmText: 'OK' });
                    return;
                }

                const response = await fetch(url, {
                    method: method,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${loggedInUser.token}`
                    },
                    body: JSON.stringify(petData),
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                
                showModal({
                    title: 'Sucesso!',
                    message: isEditing ? 'Os dados do seu pet foram atualizados.' : 'O seu novo pet foi adicionado.',
                    confirmText: 'OK',
                    onConfirm: () => window.location.reload()
                });

            } catch (error) {
                showModal({ title: 'Erro', message: `Não foi possível salvar o pet: ${error.message}`, confirmText: 'Tentar novamente' });
            } finally {
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonHtml;
            }
        });
    }

    // --- Lógica para Sugestão de Raças (Awesomplete) ---

    async function updateBreedOptions() {
    if (!petTypeSelect || !breedInput) return;
    const selectedType = petTypeSelect.value;
    await loadSpeciesMap().catch(()=>{});
    let breeds = [];
    const typeKey = norm(selectedType);

    if (typeKey === 'cachorro') {
        breeds = (SPECIES_MAP?.cachorro?.all || []).slice();
    } else if (typeKey === 'gato') {
        breeds = (SPECIES_MAP?.gato || SPECIES_MAP?.gatos || []).slice();
    } else if (typeKey === 'passaro') {
        breeds = (SPECIES_MAP?.passaro || SPECIES_MAP?.passaros || []).slice();
    } else if (['peixe','roedor','lagarto','tartaruga'].includes(typeKey)) {
        breeds = (SPECIES_MAP?.[typeKey] || []).slice();
    } else {
        breeds = [];
    }

    breeds = breeds.map(fixEncoding).sort((a,b)=> a.localeCompare(b));

    if (awesompleteInstance) {
        awesompleteInstance.list = breeds;
    } else {
        awesompleteInstance = new Awesomplete(breedInput, {
        minChars: 1,
        list: breeds,
        autoFirst: true
        });
    }
    }

    // --- Event Listeners Iniciais ---

    if (addPetBtn) addPetBtn.addEventListener('click', () => {
        petForm.reset();
        hiddenPetIdInput.value = '';
        updateBreedOptions();
        syncPorteDisabled();
        showForm();
        ensurePetTypeOptions();
        normalizeStaticLabels();
    });
    if (cancelPetBtn) cancelPetBtn.addEventListener('click', hideForm);
    if (petTypeSelect) petTypeSelect.addEventListener('change', async () => {
      await updateBreedOptions();
      syncPorteDisabled();
      setPorteFromBreedIfDog();
    });

    // Atualiza porte ao escolher uma raÃƒÂ§a (para cachorro)
    if (breedInput) {
      breedInput.addEventListener('change', () => setTimeout(setPorteFromBreedIfDog, 0));
      breedInput.addEventListener('blur', () => setTimeout(setPorteFromBreedIfDog, 0));
      breedInput.addEventListener('awesomplete-selectcomplete', () => setTimeout(setPorteFromBreedIfDog, 0));
    }

    // --- ExecuÃƒÂ§ÃƒÂ£o Inicial ---
    fetchAndDisplayPets();
    ensurePetTypeOptions();
    normalizeStaticLabels();
    updateBreedOptions();
    syncPorteDisabled();
});
