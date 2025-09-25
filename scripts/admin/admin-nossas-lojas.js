document.addEventListener('DOMContentLoaded', () => {
    // --- Referências ao DOM ---
    const tableBody = document.getElementById('stores-table-body');
    const addStoreBtn = document.getElementById('add-store-btn');
    const modal = document.getElementById('store-modal');
    const form = document.getElementById('store-form');
    const cancelBtn = document.getElementById('cancel-store-modal-btn');
    const modalTitle = document.getElementById('store-modal-title');
    const hiddenStoreId = document.getElementById('store-id');
    const horarioContainer = document.getElementById('horario-inputs-container');
    const openServicesModalBtn = document.getElementById('open-services-modal-btn');
    const servicesModal = document.getElementById('services-modal');
    const saveServicesModalBtn = document.getElementById('save-services-modal-btn');
    const servicesCheckboxContainer = document.getElementById('services-checkbox-container');
    const serviceTagsContainer = document.getElementById('service-tags-container');
    const imagePreview = document.getElementById('image-preview');
    const imageInput = document.getElementById('store-image-input');
    const cepInput = document.getElementById('store-cep');
    const enderecoHiddenInput = document.getElementById('store-endereco');
    const razaoSocialInput = document.getElementById('store-razao-social');
    const nomeFantasiaInput = document.getElementById('store-nome');
    const cnpjInput = document.getElementById('store-cnpj');
    const cnaeInput = document.getElementById('store-cnae');
    const inscricaoEstadualInput = document.getElementById('store-inscricao-estadual');
    const inscricaoMunicipalInput = document.getElementById('store-inscricao-municipal');
    const regimeTributarioSelect = document.getElementById('store-regime-tributario');
    const emailFiscalInput = document.getElementById('store-email-fiscal');
    const telefoneInput = document.getElementById('store-telefone');
    const celularInput = document.getElementById('store-whatsapp');
    const municipioInput = document.getElementById('store-municipio');
    const ufInput = document.getElementById('store-uf');
    const logradouroInput = document.getElementById('store-logradouro');
    const numeroInput = document.getElementById('store-numero');
    const complementoInput = document.getElementById('store-complemento');
    const codIbgeMunicipioInput = document.getElementById('store-cod-ibge-municipio');
    const codUfInput = document.getElementById('store-cod-uf');
    const certificadoArquivoInput = document.getElementById('store-certificado-arquivo');
    const certificadoSenhaInput = document.getElementById('store-certificado-senha');
    const certificadoValidadeInput = document.getElementById('store-certificado-validade');
    const contadorNomeInput = document.getElementById('store-contador-nome');
    const contadorEmailInput = document.getElementById('store-contador-email');
    const contadorTelefoneInput = document.getElementById('store-contador-telefone');
    const contadorCrcInput = document.getElementById('store-contador-crc');
    const closeModalBtn = document.getElementById('close-store-modal');
    const tabButtons = Array.from(document.querySelectorAll('#store-modal .tab-button'));
    const tabPanels = Array.from(document.querySelectorAll('#store-modal .tab-panel'));

    // -- REFERÊNCIAS PARA O MAPA DE LOCALIZAÇÃO --
    let locationMap = null;
    let locationMarker = null;
    const latInput = document.getElementById('store-latitude');
    const lonInput = document.getElementById('store-longitude');

    // --- Utilidades de formulário ---
    const enderecoFields = [logradouroInput, numeroInput, complementoInput, municipioInput, ufInput];

    const buildEnderecoCompleto = () => {
        const logradouro = (logradouroInput?.value || '').trim();
        const numero = (numeroInput?.value || '').trim();
        const complemento = (complementoInput?.value || '').trim();
        const municipio = (municipioInput?.value || '').trim();
        const uf = (ufInput?.value || '').trim();

        const partes = [];
        if (logradouro) {
            partes.push(numero ? `${logradouro}, ${numero}` : logradouro);
        }
        if (complemento) {
            partes.push(complemento);
        }
        if (municipio || uf) {
            const regiao = [municipio, uf].filter(Boolean).join(' - ');
            if (regiao) partes.push(regiao);
        }

        const enderecoCompleto = partes.join(' | ');
        if (enderecoHiddenInput) enderecoHiddenInput.value = enderecoCompleto;
        return enderecoCompleto;
    };

    enderecoFields.forEach(field => field?.addEventListener('input', buildEnderecoCompleto));

    const activateTab = (target) => {
        tabButtons.forEach((button) => {
            const isActive = button.dataset.tabTarget === target;
            button.classList.toggle('bg-emerald-50', isActive);
            button.classList.toggle('text-emerald-700', isActive);
            button.classList.toggle('text-gray-600', !isActive);
            button.classList.toggle('hover:text-gray-800', !isActive);
        });
        tabPanels.forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
        });
        if (target === 'endereco') {
            setTimeout(() => {
                if (locationMap) {
                    locationMap.invalidateSize();
                }
            }, 50);
        }
    };

    tabButtons.forEach((button) => {
        button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
    });

    activateTab('endereco');

    // --- Dados e Constantes ---
    const diasDaSemana = [
        { key: 'domingo', label: 'Domingo' },
        { key: 'segunda', label: 'Segunda-feira' },
        { key: 'terca', label: 'Terça-feira' },
        { key: 'quarta', label: 'Quarta-feira' },
        { key: 'quinta', label: 'Quinta-feira' },
        { key: 'sexta', label: 'Sexta-feira' },
        { key: 'sabado', label: 'Sábado' },
    ];
    const availableServices = ['Banho e Tosa', 'Veterinária', 'Farmácia'];
    let selectedServices = [];

    const ufIbgeCodes = {
        AC: '12',
        AL: '27',
        AP: '16',
        AM: '13',
        BA: '29',
        CE: '23',
        DF: '53',
        ES: '32',
        GO: '52',
        MA: '21',
        MT: '51',
        MS: '50',
        MG: '31',
        PA: '15',
        PB: '25',
        PR: '41',
        PE: '26',
        PI: '22',
        RJ: '33',
        RN: '24',
        RS: '43',
        RO: '11',
        RR: '14',
        SC: '42',
        SP: '35',
        SE: '28',
        TO: '17',
    };

    // --- Funções do Modal de Serviços ---
    const openServicesModal = () => {
        servicesCheckboxContainer.innerHTML = '';
        availableServices.forEach(service => {
            const isChecked = selectedServices.includes(service) ? 'checked' : '';
            const checkboxHtml = `
                <label class="flex items-center">
                    <input type="checkbox" value="${service}" ${isChecked} class="form-checkbox h-5 w-5 text-primary rounded service-checkbox">
                    <span class="ml-2 text-gray-700">${service}</span>
                </label>`;
            servicesCheckboxContainer.innerHTML += checkboxHtml;
        });
        servicesModal.classList.remove('hidden');
    };
    const closeServicesModal = () => servicesModal.classList.add('hidden');
    const saveServicesSelection = () => {
        selectedServices = Array.from(servicesCheckboxContainer.querySelectorAll('.service-checkbox:checked')).map(cb => cb.value);
        renderServiceTags();
        closeServicesModal();
    };
    const renderServiceTags = () => {
        serviceTagsContainer.innerHTML = '';
        selectedServices.forEach(service => {
            const tagHtml = `<span class="bg-primary/10 text-primary text-sm font-semibold px-2.5 py-1 rounded-full">${service}</span>`;
            serviceTagsContainer.innerHTML += tagHtml;
        });
    };

    // --- Pré-visualização da Imagem ---
    imageInput.addEventListener('change', () => {
        const file = imageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    // --- Criação Dinâmica dos Horários ---
    const createHorarioInputs = () => {
        horarioContainer.innerHTML = '';
        diasDaSemana.forEach(({ key, label }) => {
            const dayHtml = `
                <div data-day="${key}" class="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                    <label class="font-medium text-sm sm:col-span-1">${label}</label>
                    <div class="sm:col-span-2 flex items-center gap-2">
                        <input type="time" name="abre" class="time-input block w-full border-gray-300 rounded-md shadow-sm text-sm">
                        <span>às</span>
                        <input type="time" name="fecha" class="time-input block w-full border-gray-300 rounded-md shadow-sm text-sm">
                    </div>
                    <div class="sm:col-span-1 flex items-center justify-end sm:justify-start">
                        <input type="checkbox" name="fechada" class="fechada-checkbox h-4 w-4 text-primary rounded">
                        <label class="ml-2 text-sm">Fechada</label>
                    </div>
                </div>`;
            horarioContainer.innerHTML += dayHtml;
        });
    };
    
    async function buscarEnderecoPorCep(cep) {
        const sanitizedCep = cep.replace(/\D/g, '');
        if (sanitizedCep.length !== 8) return null;

        const url = `https://viacep.com.br/ws/${sanitizedCep}/json/`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Não foi possível consultar o CEP no momento.');
            }
            const data = await response.json();
            if (data.erro) {
                return null;
            }
            return data;
        } catch (error) {
            console.error('Erro ao consultar CEP:', error);
            throw error;
        }
    }

    // --- FUNÇÃO DE GEOCODIFICAÇÃO ROBUSTA ---
    async function geocodeAddress(address, cep) {
        const fullAddress = `${address || ''}, ${cep || ''}`;
        if (fullAddress.trim() === ',') return null;

        const queryString = encodeURIComponent(fullAddress);
        const url = `https://nominatim.openstreetmap.org/search?q=${queryString}&countrycodes=br&format=json&limit=1`;
        console.log(`Buscando coordenadas para o endereço completo: "${fullAddress}"`);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Falha na rede.');
            const data = await response.json();

            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                return { lat, lng };
            } else {
                console.warn(`Nenhuma coordenada encontrada para o endereço: "${fullAddress}"`);
                return null;
            }
        } catch (error) {
            console.error('Erro na geocodificação:', error);
            return null;
        }
    }

    // --- FUNÇÃO PARA INICIAR O MAPA NO MODAL ---
    const initializeLocationPicker = () => {
        if (locationMap || !document.getElementById('location-picker-map')) return;

        locationMap = L.map('location-picker-map').setView([-22.9068, -43.1729], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(locationMap);

        locationMap.on('click', (e) => {
            const coords = e.latlng;
            latInput.value = coords.lat;
            lonInput.value = coords.lng;

            if (!locationMarker) {
                locationMarker = L.marker(coords).addTo(locationMap);
            } else {
                locationMarker.setLatLng(coords);
            }
        });
    };

    // --- Funções do Modal Principal (Adicionar/Editar Loja) ---
    const openModalForNew = () => {
        modalTitle.textContent = 'Adicionar Nova Loja';
        hiddenStoreId.value = '';
        form.reset();
        selectedServices = [];
        renderServiceTags();
        activateTab('endereco');
        buildEnderecoCompleto();

        diasDaSemana.forEach(({ key }) => {
            const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
            const inputs = dayRow.querySelectorAll('.time-input');
            const checkbox = dayRow.querySelector('.fechada-checkbox');
            inputs.forEach(input => {
                input.disabled = false;
                input.value = '';
            });
            checkbox.checked = false;
        });

        imagePreview.src = '/public/image/placeholder.png';
        imageInput.value = '';
        if (certificadoArquivoInput) certificadoArquivoInput.value = '';

        modal.classList.remove('hidden');

        setTimeout(() => {
            if (locationMap) {
                locationMap.setView([-22.9068, -43.1729], 12);
                locationMap.invalidateSize();
                if (locationMarker) {
                    locationMarker.remove();
                    locationMarker = null;
                }
                latInput.value = '';
                lonInput.value = '';
            }
        }, 100);
    };

    const openModalForEdit = async (storeId) => {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores/${storeId}`);
            if (!response.ok) throw new Error('Falha ao carregar dados da loja.');
            const store = await response.json();

            modalTitle.textContent = 'Editar Loja';
            hiddenStoreId.value = store._id;
            razaoSocialInput.value = store.razaoSocial || '';
            nomeFantasiaInput.value = store.nomeFantasia || store.nome || '';
            cnpjInput.value = store.cnpj || '';
            cnaeInput.value = store.cnaePrincipal || store.cnae || '';
            inscricaoEstadualInput.value = store.inscricaoEstadual || '';
            inscricaoMunicipalInput.value = store.inscricaoMunicipal || '';
            regimeTributarioSelect.value = store.regimeTributario || '';
            emailFiscalInput.value = store.emailFiscal || '';
            telefoneInput.value = store.telefone || '';
            celularInput.value = store.whatsapp || store.celular || '';
            cepInput.value = store.cep || '';
            municipioInput.value = store.municipio || '';
            ufInput.value = store.uf || '';
            logradouroInput.value = store.logradouro || '';
            numeroInput.value = store.numero || '';
            complementoInput.value = store.complemento || '';
            codIbgeMunicipioInput.value = store.codigoIbgeMunicipio || store.codIbgeMunicipio || '';
            codUfInput.value = store.codigoUf || store.codUf || '';
            contadorNomeInput.value = store.contadorNome || store.contador?.nome || '';
            contadorEmailInput.value = store.contadorEmail || store.contador?.email || '';
            contadorTelefoneInput.value = store.contadorTelefone || store.contador?.telefone || '';
            contadorCrcInput.value = store.contadorCrc || store.contador?.crc || '';
            certificadoSenhaInput.value = store.certificadoSenha || '';
            certificadoValidadeInput.value = store.certificadoValidade || '';
            if (enderecoHiddenInput) enderecoHiddenInput.value = store.endereco || '';
            if (!logradouroInput.value && store.endereco) logradouroInput.value = store.endereco;
            buildEnderecoCompleto();

            selectedServices = store.servicos || [];
            renderServiceTags();
            activateTab('endereco');

            diasDaSemana.forEach(({ key }) => {
                const horarioDia = store.horario ? store.horario[key] : null;
                const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
                const abreInput = dayRow.querySelector('input[name="abre"]');
                const fechaInput = dayRow.querySelector('input[name="fecha"]');
                const fechadaCheckbox = dayRow.querySelector('input[name="fechada"]');
                if (horarioDia) {
                    abreInput.value = horarioDia.abre || '';
                    fechaInput.value = horarioDia.fecha || '';
                    fechadaCheckbox.checked = Boolean(horarioDia.fechada);
                    abreInput.disabled = horarioDia.fechada;
                    fechaInput.disabled = horarioDia.fechada;
                } else {
                    abreInput.value = '';
                    fechaInput.value = '';
                    fechadaCheckbox.checked = false;
                    abreInput.disabled = false;
                    fechaInput.disabled = false;
                }
            });

            if (store.imagem) {
                const isAbsolute = /^https?:/i.test(store.imagem);
                imagePreview.src = isAbsolute ? store.imagem : `${API_CONFIG.SERVER_URL}${store.imagem}`;
            } else {
                imagePreview.src = '/public/image/placeholder.png';
            }
            imageInput.value = '';
            if (certificadoArquivoInput) certificadoArquivoInput.value = '';

            modal.classList.remove('hidden');

            setTimeout(async () => {
                if (locationMap) {
                    locationMap.invalidateSize();
                    if (locationMarker) {
                        locationMarker.remove();
                        locationMarker = null;
                    }

                    let initialCoords = null;
                    let initialZoom = 12;

                    if (store.latitude && store.longitude) {
                        initialCoords = { lat: store.latitude, lng: store.longitude };
                        initialZoom = 17;
                    } else {
                        const enderecoConsulta = buildEnderecoCompleto() || store.endereco;
                        const foundCoords = await geocodeAddress(enderecoConsulta, store.cep);
                        if (foundCoords) {
                            initialCoords = foundCoords;
                            initialZoom = 17;
                        }
                    }

                    if (!initialCoords) {
                        initialCoords = { lat: -22.9068, lng: -43.1729 };
                    }

                    locationMap.setView([initialCoords.lat, initialCoords.lng], initialZoom);

                    if (store.latitude && store.longitude) {
                        locationMarker = L.marker(initialCoords).addTo(locationMap);
                        latInput.value = store.latitude;
                        lonInput.value = store.longitude;
                    } else {
                        latInput.value = '';
                        lonInput.value = '';
                    }
                }
            }, 100);
        } catch (error) {
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    };

    const closeModal = () => {
        modal.classList.add('hidden');
        form.reset();
        selectedServices = [];
        renderServiceTags();
        activateTab('endereco');
        buildEnderecoCompleto();
        imagePreview.src = '/public/image/placeholder.png';
        imageInput.value = '';
        if (certificadoArquivoInput) certificadoArquivoInput.value = '';
        if (locationMarker) {
            locationMarker.remove();
            locationMarker = null;
        }
        latInput.value = '';
        lonInput.value = '';
    };

    // --- Renderização da Tabela ---
    async function fetchAndDisplayStores() {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
            const stores = await response.json();
            
            tableBody.innerHTML = '';
            stores.forEach(store => {
                const rowHtml = `
                    <tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-6 py-4 font-medium text-gray-900">${store.nome}</td>
                        <td class="px-6 py-4">${store.endereco}</td>
                        <td class="px-6 py-4 text-center">
                            <button data-action="edit" data-id="${store._id}" class="font-medium text-blue-600 hover:underline mr-3">Editar</button>
                            <button data-action="delete" data-id="${store._id}" class="font-medium text-red-600 hover:underline">Apagar</button>
                        </td>
                    </tr>
                `;
                tableBody.innerHTML += rowHtml;
            });
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="3" class="text-center py-10 text-red-500">Não foi possível carregar as lojas.</td></tr>`;
        }
    }

    // --- Event Listeners ---
    addStoreBtn.addEventListener('click', openModalForNew);
    cancelBtn.addEventListener('click', closeModal);
    closeModalBtn?.addEventListener('click', closeModal);
    openServicesModalBtn.addEventListener('click', openServicesModal);
    saveServicesModalBtn.addEventListener('click', saveServicesSelection);

    horarioContainer.addEventListener('change', (event) => {
        if (event.target.classList.contains('fechada-checkbox')) {
            const dayRow = event.target.closest('[data-day]');
            const inputs = dayRow.querySelectorAll('.time-input');
            inputs.forEach(input => {
                input.disabled = event.target.checked;
                if (event.target.checked) {
                    input.value = '';
                }
            });
        }
    });
    
    cepInput.addEventListener('blur', async () => {
        const cepValue = cepInput.value;
        const sanitizedCep = cepValue.replace(/\D/g, '');
        if (sanitizedCep.length !== 8) {
            return;
        }

        let cepData = null;
        try {
            cepData = await buscarEnderecoPorCep(sanitizedCep);
        } catch (error) {
            showModal({ title: 'Erro', message: error.message || 'Não foi possível consultar o CEP. Tente novamente.', confirmText: 'OK' });
            return;
        }

        if (!cepData) {
            showModal({ title: 'CEP não encontrado', message: 'Revise o CEP informado ou preencha os campos manualmente.', confirmText: 'OK' });
            return;
        }

        logradouroInput.value = cepData.logradouro || '';
        complementoInput.value = cepData.complemento || '';
        municipioInput.value = cepData.localidade || '';
        ufInput.value = (cepData.uf || '').toUpperCase();
        codIbgeMunicipioInput.value = cepData.ibge || '';
        codUfInput.value = ufIbgeCodes[ufInput.value] || '';
        buildEnderecoCompleto();

        const enderecoValue = buildEnderecoCompleto() || enderecoHiddenInput?.value;
        const coords = await geocodeAddress(enderecoValue, cepValue);
        if (coords && locationMap) {
            locationMap.setView([coords.lat, coords.lng], 17);
            showModal({
                title: 'Localização Encontrada',
                message: 'O mapa foi centralizado na morada informada. Agora, clique no local exato da loja para ajustar.',
                confirmText: 'Entendi'
            });
        } else {
            showModal({
                title: 'Endereço não encontrado',
                message: 'Não foi possível encontrar este endereço. Verifique os dados ou aponte a localização manualmente no mapa.',
                confirmText: 'OK'
            });
        }
    });

    tableBody.addEventListener('click', (event) => {
        const target = event.target;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (!action || !id) return;

        if (action === 'edit') {
            openModalForEdit(id);
        } else if (action === 'delete') {
            showModal({
                title: 'Confirmar Exclusão',
                message: 'Tem a certeza de que deseja apagar esta loja? Esta ação não pode ser desfeita.',
                confirmText: 'Sim, apagar',
                cancelText: 'Cancelar',
                onConfirm: async () => {
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;

                        await fetch(`${API_CONFIG.BASE_URL}/stores/${id}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        });
                        fetchAndDisplayStores();
                    } catch (error) {
                        showModal({ title: 'Erro', message: 'Não foi possível apagar a loja.', confirmText: 'OK'});
                    }
                }
            });
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const storeId = hiddenStoreId.value;
        const submitButton = document.getElementById('save-store-modal-btn');
        submitButton.disabled = true;

        const enderecoCompleto = buildEnderecoCompleto();
        const storeData = {
            nome: nomeFantasiaInput.value,
            nomeFantasia: nomeFantasiaInput.value,
            razaoSocial: razaoSocialInput.value,
            cnpj: cnpjInput.value,
            cnaePrincipal: cnaeInput.value,
            inscricaoEstadual: inscricaoEstadualInput.value,
            inscricaoMunicipal: inscricaoMunicipalInput.value,
            regimeTributario: regimeTributarioSelect.value,
            emailFiscal: emailFiscalInput.value,
            telefone: telefoneInput.value,
            whatsapp: celularInput.value,
            cep: cepInput.value,
            municipio: municipioInput.value,
            uf: ufInput.value,
            logradouro: logradouroInput.value,
            numero: numeroInput.value,
            complemento: complementoInput.value,
            codigoIbgeMunicipio: codIbgeMunicipioInput.value,
            codigoUf: codUfInput.value,
            endereco: enderecoCompleto,
            latitude: parseFloat(latInput.value) || null,
            longitude: parseFloat(lonInput.value) || null,
            servicos: selectedServices,
            horario: {},
            contadorNome: contadorNomeInput.value,
            contadorEmail: contadorEmailInput.value,
            contadorTelefone: contadorTelefoneInput.value,
            contadorCrc: contadorCrcInput.value,
            certificadoValidade: certificadoValidadeInput.value,
            certificadoSenha: certificadoSenhaInput.value,
            certificadoArquivoNome: certificadoArquivoInput?.files?.[0]?.name || ''
        };
        
        diasDaSemana.forEach(({ key }) => {
            const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
            storeData.horario[key] = {
                abre: dayRow.querySelector('input[name="abre"]').value,
                fecha: dayRow.querySelector('input[name="fecha"]').value,
                fechada: dayRow.querySelector('input[name="fechada"]').checked
            };
        });

        const method = storeId ? 'PUT' : 'POST';
        const url = storeId ? `${API_CONFIG.BASE_URL}/stores/${storeId}` : `${API_CONFIG.BASE_URL}/stores`;

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(storeData) });
            const savedStore = await response.json();
            if (!response.ok) throw new Error('Falha ao salvar os dados da loja.');

            if (imageInput.files[0]) {
                const formData = new FormData();
                formData.append('imagem', imageInput.files[0]);
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                await fetch(`${API_CONFIG.BASE_URL}/stores/${savedStore._id}/upload`, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }

            closeModal();
            fetchAndDisplayStores();
            showModal({ title: 'Sucesso!', message: `Loja ${storeId ? 'atualizada' : 'adicionada'} com sucesso.`, confirmText: 'OK' });
        } catch (error) {
            showModal({ title: 'Erro', message: error.message, confirmText: 'Tentar Novamente' });
        } finally {
            submitButton.disabled = false;
        }
    });

    // --- Carga Inicial ---
    createHorarioInputs();
    fetchAndDisplayStores();
    initializeLocationPicker();
});