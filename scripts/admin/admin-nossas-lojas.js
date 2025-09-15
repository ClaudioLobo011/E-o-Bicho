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
    const enderecoInput = document.getElementById('store-endereco');

    // -- REFERÊNCIAS PARA O MAPA DE LOCALIZAÇÃO --
    let locationMap = null;
    let locationMarker = null;
    const latInput = document.getElementById('store-latitude');
    const lonInput = document.getElementById('store-longitude');

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
        diasDaSemana.forEach(({ key }) => {
            const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
            const inputs = dayRow.querySelectorAll('.time-input');
            const checkbox = dayRow.querySelector('.fechada-checkbox');
            inputs.forEach(input => input.disabled = false);
            checkbox.checked = false;
        });
        imagePreview.src = '/public/image/placeholder.png';
        imageInput.value = '';
        modal.classList.remove('hidden');

        setTimeout(() => {
            if (locationMap) {
                locationMap.invalidateSize();
                locationMap.setView([-22.9068, -43.1729], 12);
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
            document.getElementById('store-nome').value = store.nome;
            enderecoInput.value = store.endereco;
            cepInput.value = store.cep;
            document.getElementById('store-telefone').value = store.telefone;
            document.getElementById('store-whatsapp').value = store.whatsapp;
            selectedServices = store.servicos || [];
            renderServiceTags();

            diasDaSemana.forEach(({ key }) => {
                const horarioDia = store.horario ? store.horario[key] : null;
                const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
                const abreInput = dayRow.querySelector('input[name="abre"]');
                const fechaInput = dayRow.querySelector('input[name="fecha"]');
                const fechadaCheckbox = dayRow.querySelector('input[name="fechada"]');
                if (horarioDia) {
                    abreInput.value = horarioDia.abre || '';
                    fechaInput.value = horarioDia.fecha || '';
                    fechadaCheckbox.checked = horarioDia.fechada;
                    abreInput.disabled = horarioDia.fechada;
                    fechaInput.disabled = horarioDia.fechada;
                }
            });
            imagePreview.src = `${API_CONFIG.SERVER_URL}${store.imagem}`;
            imageInput.value = '';
            modal.classList.remove('hidden');

            setTimeout(async () => {
                if (locationMap) {
                    locationMap.invalidateSize();
                    if (locationMarker) locationMarker.remove();

                    let initialCoords = null;
                    let initialZoom = 12;

                    // 1. Prioriza as coordenadas exatas já salvas.
                    if (store.latitude && store.longitude) {
                        initialCoords = { lat: store.latitude, lng: store.longitude };
                        initialZoom = 17;
                    // 2. Se não existirem, tenta buscar pelo endereço completo como fallback.
                    } else {
                        const foundCoords = await geocodeAddress(store.endereco, store.cep);
                        if (foundCoords) {
                            initialCoords = foundCoords;
                            initialZoom = 17;
                        }
                    }

                    // 3. Se tudo falhar, usa a localização padrão.
                    if (!initialCoords) {
                        initialCoords = { lat: -22.9068, lng: -43.1729 };
                    }

                    locationMap.setView([initialCoords.lat, initialCoords.lng], initialZoom);

                    // Se a loja já tiver coordenadas salvas, coloca o marcador e os valores nos inputs.
                    if (store.latitude && store.longitude) {
                        locationMarker = L.marker(initialCoords).addTo(locationMap);
                        latInput.value = store.latitude;
                        lonInput.value = store.longitude;
                    } else {
                        locationMarker = null;
                        latInput.value = '';
                        lonInput.value = '';
                    }
                }
            }, 100);
        } catch (error) {
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    };

    const closeModal = () => modal.classList.add('hidden');

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
        const enderecoValue = enderecoInput.value;
        if (cepValue.replace(/\D/g, '').length === 8) {
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

        const storeData = {
            nome: document.getElementById('store-nome').value,
            endereco: enderecoInput.value,
            cep: cepInput.value,
            latitude: parseFloat(latInput.value) || null,
            longitude: parseFloat(lonInput.value) || null,
            telefone: document.getElementById('store-telefone').value,
            whatsapp: document.getElementById('store-whatsapp').value,
            servicos: selectedServices,
            horario: {}
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