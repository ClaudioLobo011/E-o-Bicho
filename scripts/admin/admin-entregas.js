document.addEventListener('DOMContentLoaded', () => {
    // --- REFERÊNCIAS GERAIS E LÓGICA DAS ABAS ---
    const tabs = document.querySelectorAll('.tab-link');
    const contents = {
        veiculos: document.getElementById('content-veiculos'),
        mapa: document.getElementById('content-mapa')
    };

    if (tabs.length > 0) {
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                tabs.forEach(t => {
                    t.classList.remove('border-primary', 'text-primary');
                    t.classList.add('border-transparent', 'text-gray-500', 'hover:border-gray-300');
                });
                e.target.classList.add('border-primary', 'text-primary');
                e.target.classList.remove('border-transparent', 'text-gray-500', 'hover:border-gray-300');
                
                Object.values(contents).forEach(c => {
                    if(c) c.classList.add('hidden');
                });
                
                const contentId = e.target.id.replace('tab-', 'content-');
                const contentElement = document.getElementById(contentId);
                if(contentElement) contentElement.classList.remove('hidden');

                if (contentId === 'content-mapa' && map) {
                    setTimeout(() => {
                        map.invalidateSize();
                    }, 100);
                }
            });
        });
    }

    // ==========================================================
    // ================= LÓGICA ABA VEÍCULOS ====================
    // ==========================================================
    const vehiclesTableBody = document.getElementById('vehicles-table-body');
    const vehicleModal = document.getElementById('vehicle-modal');
    const vehicleForm = document.getElementById('vehicle-form');
    const addVehicleBtn = document.getElementById('add-vehicle-btn');
    const cancelVehicleBtn = document.getElementById('cancel-vehicle-modal-btn');
    const vehicleModalTitle = document.getElementById('vehicle-modal-title');
    const hiddenVehicleId = document.getElementById('vehicle-id');

    const openVehicleModal = (vehicle = null) => {
        if (!vehicleForm) return;
        vehicleForm.reset();
        if (vehicle) {
            vehicleModalTitle.textContent = 'Editar Veículo';
            hiddenVehicleId.value = vehicle._id;
            document.getElementById('vehicle-tipo').value = vehicle.tipo;
            document.getElementById('vehicle-pesoMax').value = vehicle.pesoMax;
            document.getElementById('vehicle-taxaMin').value = vehicle.taxaMin;
            document.getElementById('vehicle-taxaKm').value = vehicle.taxaKm;
        } else {
            vehicleModalTitle.textContent = 'Adicionar Veículo';
            hiddenVehicleId.value = '';
        }
        vehicleModal.classList.remove('hidden');
    };
    const closeVehicleModal = () => vehicleModal.classList.add('hidden');

    async function fetchAndRenderVehicles() {
        if (!vehiclesTableBody) return;
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/vehicles`);
            const vehicles = await response.json();
            vehiclesTableBody.innerHTML = '';
            if (vehicles.length === 0) {
                vehiclesTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-gray-400">Nenhum veículo cadastrado.</td></tr>`;
                return;
            }
            vehicles.forEach(v => {
                const row = `
                    <tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-6 py-4 font-medium">${v.tipo}</td>
                        <td class="px-6 py-4">${v.pesoMax} kg</td>
                        <td class="px-6 py-4">R$ ${v.taxaMin.toFixed(2).replace('.', ',')}</td>
                        <td class="px-6 py-4">R$ ${v.taxaKm.toFixed(2).replace('.', ',')}</td>
                        <td class="px-6 py-4 text-center">
                            <button data-action="edit-vehicle" data-vehicle='${JSON.stringify(v)}' class="font-medium text-blue-600 hover:underline mr-3">Editar</button>
                            <button data-action="delete-vehicle" data-id="${v._id}" class="font-medium text-red-600 hover:underline">Apagar</button>
                        </td>
                    </tr>`;
                vehiclesTableBody.innerHTML += row;
            });
        } catch (error) { console.error('Erro ao buscar veículos:', error); }
    }

    if(vehicleForm) {
        vehicleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = hiddenVehicleId.value;
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_CONFIG.BASE_URL}/vehicles/${id}` : `${API_CONFIG.BASE_URL}/vehicles`;
            const body = {
                tipo: document.getElementById('vehicle-tipo').value,
                pesoMax: document.getElementById('vehicle-pesoMax').value,
                taxaMin: document.getElementById('vehicle-taxaMin').value,
                taxaKm: document.getElementById('vehicle-taxaKm').value
            };
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body) });
            closeVehicleModal();
            fetchAndRenderVehicles();
        });
    }

    if (addVehicleBtn) addVehicleBtn.addEventListener('click', () => openVehicleModal());
    if (cancelVehicleBtn) cancelVehicleBtn.addEventListener('click', closeVehicleModal);
    if (vehiclesTableBody) {
        vehiclesTableBody.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'edit-vehicle') {
                openVehicleModal(JSON.parse(e.target.dataset.vehicle));
            } else if (action === 'delete-vehicle') {
                showModal({
                    title: 'Confirmar Exclusão', message: 'Tem a certeza de que deseja apagar este veículo?', confirmText: 'Sim, apagar', cancelText: 'Cancelar',
                    onConfirm: async () => {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;
                        await fetch(`${API_CONFIG.BASE_URL}/vehicles/${e.target.dataset.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                        fetchAndRenderVehicles();
                    }
                });
            }
        });
    }

    // ==========================================================
    // =================== LÓGICA ABA MAPA ======================
    // ==========================================================
    const storeSelect = document.getElementById('store-select');
    const raioInput = document.getElementById('raio-input');
    const raioControls = document.getElementById('raio-controls');
    const bairroControls = document.getElementById('bairro-controls');
    const saveZoneBtn = document.getElementById('save-zone-btn');
    const cancelZoneBtn = document.getElementById('cancel-zone-btn'); // botão que deve existir no HTML
    const areaTypeRadios = document.querySelectorAll('input[name="area_type"]');
    const bairroSearchInput = document.getElementById('bairro-search');
    const bairrosListContainer = document.getElementById('bairros-list');
    const selectAllBtn = document.getElementById('select-all-bairros');
    const deselectAllBtn = document.getElementById('deselect-all-bairros');
    
    let map = null;
    let marker = null;
    let allStores = [];
    let allBairrosFeatures = [];
    let bairrosLayerGroup = null;
    let raiosLayerGroup = null;
    let editingZoneId = null; // null = criar; id = editar

    function resetZoneForm() {
        const nomeInput = document.getElementById('zone-name');
        if (nomeInput) nomeInput.value = '';
        const gratisCheckbox = document.getElementById('zone-free');
        if (gratisCheckbox) gratisCheckbox.checked = false;
        document.querySelectorAll('.bairro-checkbox').forEach(cb => cb.checked = false);
        if (raioInput) raioInput.value = '';

        if (raiosLayerGroup) raiosLayerGroup.clearLayers();
        if (bairrosLayerGroup) bairrosLayerGroup.clearLayers();

        // volta pro modo padrão (Raio)
        const radioRaio = document.querySelector('input[name="area_type"][value="raio"]');
        if (radioRaio) radioRaio.checked = true;
        raioControls.classList.remove('hidden');
        bairroControls.classList.add('hidden');

        editingZoneId = null;
    }

    async function initializeMapaTab() {
        if (!document.getElementById('map')) return;

        map = L.map('map').setView([-22.9068, -43.1729], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        bairrosLayerGroup = L.layerGroup().addTo(map);
        raiosLayerGroup = L.layerGroup().addTo(map);

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
            allStores = await response.json();
            if (storeSelect) {
                storeSelect.innerHTML = '<option value="">Selecione uma loja...</option>';
                allStores.forEach(store => {
                    storeSelect.innerHTML += `<option value="${store._id}">${store.nome}</option>`;
                });
            }
        } catch (error) {
            console.error('Erro ao buscar lojas:', error);
        }

        await loadBairrosData();
    }

    async function loadBairrosData() {
        try {
            const response = await fetch(`${API_CONFIG.SERVER_URL}/data/bairros_rio.geojson`);
            const geojsonData = await response.json();

            allBairrosFeatures = (geojsonData.features || []).filter(
                feature => feature.properties && feature.properties.NOME
            );
            allBairrosFeatures.sort((a, b) =>
                a.properties.NOME.localeCompare(b.properties.NOME)
            );

            populateBairrosList();
        } catch (error) {
            console.error("Erro ao carregar o ficheiro GeoJSON dos bairros:", error);
            if (bairrosListContainer) {
                bairrosListContainer.innerHTML = '<p class="text-red-500">Falha ao carregar bairros.</p>';
            }
        }
    }

    function populateBairrosList() {
        if (!bairrosListContainer) return;
        bairrosListContainer.innerHTML = '';

        allBairrosFeatures.forEach(bairro => {
            const bairroName = bairro.properties.NOME;
            // escapando valores simples pode ser necessário se nomes tiverem aspas; assumimos nomes simples
            const checkboxHtml = `
                <label class="flex items-center cursor-pointer bairro-item">
                    <input type="checkbox" data-bairro-name="${bairroName}" class="form-checkbox h-4 w-4 text-primary rounded bairro-checkbox">
                    <span class="ml-2 text-gray-800">${bairroName}</span>
                </label>
            `;
            bairrosListContainer.innerHTML += checkboxHtml;
        });
    }

    function updateBairroOnMap(bairroName, isSelected) {
        const feature = allBairrosFeatures.find(f => f.properties.NOME === bairroName);
        if (!feature) return;

        if (isSelected) {
            const layer = L.geoJSON(feature, {
                style: { color: '#007BFF', weight: 2, fillOpacity: 0.3 }
            });
            // marcar o layer com o nome do bairro para permitir remoção posterior
            layer.bairroName = bairroName;
            bairrosLayerGroup.addLayer(layer);
        } else {
            // remove layers correspondentes
            bairrosLayerGroup.eachLayer(layer => {
                if (layer.bairroName === bairroName) {
                    bairrosLayerGroup.removeLayer(layer);
                }
            });
        }
    }

    async function geocodeCep(store) {
        const fullAddress = `${store.endereco || ''}, ${store.cep || ''}`;
        if (fullAddress.trim() === ',') return null;
        const queryString = encodeURIComponent(fullAddress);
        const url = `https://nominatim.openstreetmap.org/search?q=${queryString}&countrycodes=br&format=json&limit=1`;

        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            if (data && data.length > 0) {
                return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async function renderZones(storeId) {
        const container = document.getElementById('zones-list');
        if (!container) return;

        container.innerHTML = '';
        if (!storeId) {
            container.innerHTML = '<p class="text-gray-500">Selecione uma loja para ver as zonas configuradas.</p>';
            return;
        }

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/delivery-zones/by-store/${storeId}`);
            if (!response.ok) {
                container.innerHTML = '<p class="text-gray-500">Nenhuma zona configurada ainda.</p>';
                return;
            }

            const json = await response.json();
            const zones = Array.isArray(json) ? json : (json ? [json] : []);

            if (zones.length === 0) {
                container.innerHTML = '<p class="text-gray-500">Nenhuma zona configurada ainda.</p>';
                return;
            }

            zones.forEach(zone => {
                const row = document.createElement('div');
                row.className = 'p-2 border-b flex justify-between items-center text-sm';
                row.innerHTML = `
                    <div>
                        <div><b>Nome:</b> ${zone.nome}</div>
                        <div><b>Tipo:</b> ${zone.tipo}</div>
                        ${zone.tipo === 'raio'
                            ? `<div><b>Raio:</b> ${Number(zone.raioKm) || 0} km</div>`
                            : `<div><b>Bairros:</b> ${Array.isArray(zone.bairros) ? zone.bairros.join(', ') : ''}</div>`
                        }
                        <div><b>Entrega:</b> ${zone.gratis ? 'Grátis' : 'Paga'}</div>
                    </div>
                    <div class="flex items-center gap-3">
                        <button class="text-blue-600 hover:underline" 
                            data-action="edit" 
                            data-zone='${JSON.stringify(zone)}'>Editar</button>
                        <button class="text-red-600 hover:underline" 
                            data-id="${zone._id}" 
                            data-action="delete">Excluir</button>
                    </div>
                `;
                container.appendChild(row);
            });

            // DELETE
            container.querySelectorAll('button[data-action="delete"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    showModal({
                        title: 'Confirmar Exclusão',
                        message: 'Tem certeza que deseja excluir esta zona?',
                        confirmText: 'Sim, excluir',
                        cancelText: 'Cancelar',
                        onConfirm: async () => {
                            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                            const token = loggedInUser?.token;
                            await fetch(`${API_CONFIG.BASE_URL}/delivery-zones/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                            await renderZones(storeId);
                        }
                    });
                });
            });

            // EDITAR
            container.querySelectorAll('button[data-action="edit"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const zone = JSON.parse(btn.dataset.zone);
                    editingZoneId = zone._id;

                    // reset mínimo e limpa camadas antigas antes de preencher
                    document.getElementById('zone-name').value = zone.nome || '';
                    document.getElementById('zone-free').checked = !!zone.gratis;
                    document.querySelectorAll('.bairro-checkbox').forEach(cb => cb.checked = false);
                    if (raioInput) raioInput.value = '';

                    if (raiosLayerGroup) raiosLayerGroup.clearLayers();
                    if (bairrosLayerGroup) bairrosLayerGroup.clearLayers();

                    // marca o tipo e ajusta controles
                    const tipoRadio = document.querySelector(`input[name="area_type"][value="${zone.tipo}"]`);
                    if (tipoRadio) tipoRadio.checked = true;
                    raioControls.classList.toggle('hidden', zone.tipo !== 'raio');
                    bairroControls.classList.toggle('hidden', zone.tipo !== 'bairro');

                    // caso raio
                    if (zone.tipo === 'raio') {
                        if (raioInput) raioInput.value = zone.raioKm || 0;

                        if (marker && Number(zone.raioKm) > 0) {
                            const rMeters = Number(zone.raioKm) * 1000;
                            const circleLayer = L.circle(marker.getLatLng(), { radius: rMeters, color: '#007BFF' });
                            raiosLayerGroup.addLayer(circleLayer);
                            map.fitBounds(circleLayer.getBounds());
                        }
                    }

                    // caso bairros
                    if (zone.tipo === 'bairro' && Array.isArray(zone.bairros)) {
                        zone.bairros.forEach(bairroName => {
                            const checkbox = document.querySelector(`.bairro-checkbox[data-bairro-name="${bairroName}"]`);
                            if (checkbox) {
                                checkbox.checked = true;
                            }
                            updateBairroOnMap(bairroName, true);
                        });

                        // centraliza para os layers adicionados
                        const layers = bairrosLayerGroup.getLayers();
                        if (layers.length > 0) {
                            const group = L.featureGroup(layers);
                            map.fitBounds(group.getBounds());
                        }
                    }
                });
            });

        } catch (err) {
            console.error('Erro ao carregar zonas:', err);
            container.innerHTML = '<p class="text-red-500">Erro ao carregar zonas.</p>';
        }
    }


    if (storeSelect) {
        storeSelect.addEventListener('change', async () => {
            const storeId = storeSelect.value;

            // RESET TOTAL do formulário para começar nova zona (sempre Raio + zerado)
            resetZoneForm();

            if (!storeId) {
                if (marker) {
                    map.removeLayer(marker);
                    marker = null;
                }
                await renderZones('');
                return;
            }

            // encontra a loja
            const selectedStore = allStores.find(s => s._id === storeId);
            let coords = null;

            if (selectedStore && selectedStore.latitude && selectedStore.longitude) {
                coords = { lat: selectedStore.latitude, lng: selectedStore.longitude };
            } else if (selectedStore) {
                coords = await geocodeCep(selectedStore);
            }

            if (!coords) {
                showModal({
                    title: 'Atenção',
                    message: 'Não foi possível encontrar a localização para esta loja.',
                    confirmText: 'OK'
                });
                // ainda renderiza a lista para gerenciamento
                await renderZones(storeId);
                return;
            }

            // posiciona no mapa
            map.setView([coords.lat, coords.lng], 15);
            if (marker) {
                marker.setLatLng([coords.lat, coords.lng]);
            } else {
                marker = L.marker([coords.lat, coords.lng]).addTo(map);
            }
            marker.bindPopup(`<b>${selectedStore.nome}</b>`).openPopup();

            // NÃO desenhar automaticamente zonas existentes aqui: apenas exibir lista.
            await renderZones(storeId);
        });
    }


    function updateMapVisualization() {
        if (raiosLayerGroup) raiosLayerGroup.clearLayers();

        const tipoRaio = document.querySelector('input[name="area_type"][value="raio"]');
        if (tipoRaio && tipoRaio.checked && marker) {
            const radius = parseFloat(raioInput.value) * 1000;
            if (radius > 0) {
                const circleLayer = L.circle(marker.getLatLng(), { radius: radius });
                raiosLayerGroup.addLayer(circleLayer);
                map.fitBounds(circleLayer.getBounds());
            }
        }
    }

    if (raioInput) raioInput.addEventListener('input', updateMapVisualization);
    if (areaTypeRadios) {
        areaTypeRadios.forEach(radio => radio.addEventListener('change', (e) => {
            // alterna UI
            raioControls.classList.toggle('hidden', e.target.value !== 'raio');
            bairroControls.classList.toggle('hidden', e.target.value !== 'bairro');

            // limpa camadas do tipo não selecionado
            if (e.target.value === 'raio') {
                if (bairrosLayerGroup) bairrosLayerGroup.clearLayers();
            } else {
                if (raiosLayerGroup) raiosLayerGroup.clearLayers();
            }

            updateMapVisualization();
        }));
    }
    
    if (bairroSearchInput) {
        bairroSearchInput.addEventListener('input', () => {
            const searchTerm = bairroSearchInput.value.toLowerCase();
            document.querySelectorAll('.bairro-item').forEach(item => {
                const name = item.querySelector('span').textContent.toLowerCase();
                item.style.display = name.includes(searchTerm) ? '' : 'none';
            });
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.bairro-checkbox').forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    updateBairroOnMap(cb.dataset.bairroName, true);
                }
            });
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            if (bairrosLayerGroup) bairrosLayerGroup.clearLayers();
            document.querySelectorAll('.bairro-checkbox').forEach(cb => {
                cb.checked = false;
            });
        });
    }

    if (bairrosListContainer) {
        bairrosListContainer.addEventListener('change', (e) => {
            if (e.target.classList.contains('bairro-checkbox')) {
                const name = e.target.dataset.bairroName;
                const isSelected = e.target.checked;
                updateBairroOnMap(name, isSelected);
            }
        });
    }

    // SALVAR ZONA (POST ou PUT dependendo do modo)
    if (saveZoneBtn) {
        saveZoneBtn.addEventListener('click', async () => {
            const storeId = storeSelect ? storeSelect.value : '';
            if (!storeId) {
                return showModal({ title: 'Atenção', message: 'Selecione uma loja primeiro.', confirmText: 'OK' });
            }

            const nomeInput = document.getElementById('zone-name');
            const nome = nomeInput ? nomeInput.value.trim() : '';
            if (!nome) {
                return showModal({ title: 'Atenção', message: 'Informe um nome para a zona.', confirmText: 'OK' });
            }

            const tipoSelecionado = document.querySelector('input[name="area_type"]:checked');
            const tipo = tipoSelecionado ? tipoSelecionado.value : 'raio';

            const selectedBairros = [];
            if (tipo === 'bairro') {
                document.querySelectorAll('.bairro-checkbox:checked').forEach(cb => {
                    selectedBairros.push(cb.dataset.bairroName);
                });
                if (selectedBairros.length === 0) {
                    return showModal({ title: 'Atenção', message: 'Selecione ao menos um bairro.', confirmText: 'OK' });
                }
            }

            const payload = {
                store: storeId,
                nome: nome,
                tipo: tipo,
                raioKm: tipo === 'raio' ? (parseFloat(raioInput.value) || 0) : 0,
                bairros: tipo === 'bairro' ? selectedBairros : [],
                gratis: document.getElementById('zone-free').checked
            };

            try {
                let resp;
                if (editingZoneId) {
                    // EDITAR
                    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                    const token = loggedInUser?.token;
                    resp = await fetch(`${API_CONFIG.BASE_URL}/delivery-zones/${editingZoneId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(payload)
                    });
                } else {
                    // CRIAR
                    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                    const token = loggedInUser?.token;
                    resp = await fetch(`${API_CONFIG.BASE_URL}/delivery-zones`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(payload)
                    });
                }

                if (!resp.ok) throw new Error('Falha ao salvar a zona.');

                showModal({ title: 'Sucesso!', message: editingZoneId ? 'Zona atualizada com sucesso.' : 'Zona criada com sucesso.', confirmText: 'OK' });

                await renderZones(storeId);
                resetZoneForm();
            } catch (e) {
                console.error(e);
                showModal({ title: 'Erro', message: 'Não foi possível salvar a zona.', confirmText: 'OK' });
            }
        });
    }

    // CANCELAR edição / limpar formulário
    if (cancelZoneBtn) {
        cancelZoneBtn.addEventListener('click', () => {
            resetZoneForm();
        });
    }

    // --- CARGA INICIAL ---
    if(document.getElementById('map')) {
        initializeMapaTab();
    }
    if(vehiclesTableBody) {
        fetchAndRenderVehicles();
    }
});
